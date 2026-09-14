import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import YAML from 'yaml';
import { loadProjectConfig } from './project.mjs';
import { validatePersonaRef } from './personas.mjs';
import { publishLifecycleEventSafely } from './runtime/lifecycle-hooks.mjs';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const intentReferencePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const intentRelationshipTypes = Object.freeze([
  'depends-on',
  'enables',
  'complements',
  'conflicts-with',
  'supersedes',
  'relates-to',
]);
const deliveryShapeRecommendations = Object.freeze(['single', 'split', 'decision-required']);
const intentMutationQueues = new Map();
const processInstanceId = randomUUID();

function intentTransactionRoot(projectRoot) {
  return resolve(projectRoot, '.ewai-pipeline/runtime/intent-transactions');
}

function writeTransactionJournal(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function validateTransactionEntry(entry, intentsRoot) {
  const path = resolve(String(entry.path ?? ''));
  const rel = relative(intentsRoot, path);
  if (
    rel.startsWith('..')
    || resolve(intentsRoot, rel) !== path
    || !['.md', '.json'].some((extension) => path.endsWith(extension))
  ) {
    throw new Error(`Intent transaction target is outside the intent library: ${path}`);
  }
  const temporary = String(entry.temporary ?? '');
  const backup = String(entry.backup ?? '');
  if (!temporary.startsWith(`${path}.ewai-`) || !temporary.endsWith('.tmp')) {
    throw new Error(`Intent transaction has an invalid temporary path: ${temporary}`);
  }
  if (!backup.startsWith(`${path}.ewai-`) || !backup.endsWith('.bak')) {
    throw new Error(`Intent transaction has an invalid backup path: ${backup}`);
  }
  return { path, temporary, backup, hadOriginal: entry.hadOriginal === true };
}

function rollbackIntentTransaction(journalPath, intentsRoot) {
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  if (journal.schema !== 'ewai.intent-transaction/v1' || !Array.isArray(journal.entries)) {
    throw new Error(`Invalid intent transaction journal: ${journalPath}`);
  }
  const entries = journal.entries.map((entry) => validateTransactionEntry(entry, intentsRoot));
  for (const entry of entries.reverse()) {
    if (existsSync(entry.backup)) {
      rmSync(entry.path, { force: true });
      renameSync(entry.backup, entry.path);
    } else if (!entry.hadOriginal) {
      rmSync(entry.path, { force: true });
    }
    rmSync(entry.temporary, { force: true });
  }
  rmSync(journalPath, { force: true });
  return journal.id;
}

export function recoverIntentTransactions(projectRoot) {
  const root = intentTransactionRoot(projectRoot);
  if (!existsSync(root)) return { recovered: [] };
  const { paths } = loadProjectConfig(projectRoot);
  const intentsRoot = resolve(paths.specsRoot, '2.Purpose/intents');
  const recovered = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const journalPath = resolve(root, entry.name);
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
    if (journal.owner === processInstanceId) continue;
    if (Number.isInteger(journal.pid) && journal.pid > 0 && journal.pid !== process.pid) {
      try {
        process.kill(journal.pid, 0);
        continue;
      } catch (error) {
        if (error.code !== 'ESRCH') continue;
      }
    }
    recovered.push(rollbackIntentTransaction(journalPath, intentsRoot));
  }
  return { recovered };
}

function atomicWriteSet(projectRoot, entries) {
  const transaction = randomUUID();
  const journalPath = resolve(intentTransactionRoot(projectRoot), `${transaction}.json`);
  const staged = [];
  const committed = [];
  let succeeded = false;

  try {
    for (const { path, content } of entries) {
      mkdirSync(dirname(path), { recursive: true });
      const temporary = `${path}.ewai-${process.pid}-${transaction}.tmp`;
      const backup = `${path}.ewai-${process.pid}-${transaction}.bak`;
      staged.push({ path, temporary, backup, hadOriginal: existsSync(path) });
      writeFileSync(temporary, content, 'utf8');
    }

    writeTransactionJournal(journalPath, {
      schema: 'ewai.intent-transaction/v1',
      id: transaction,
      owner: processInstanceId,
      pid: process.pid,
      entries: staged.map(({ path, temporary, backup, hadOriginal }) => ({
        path,
        temporary,
        backup,
        hadOriginal,
      })),
    });

    for (const { path, backup, hadOriginal } of staged) {
      if (hadOriginal) renameSync(path, backup);
    }
    for (const { path, temporary } of staged) {
      renameSync(temporary, path);
      committed.push(path);
    }

    rmSync(journalPath);
    succeeded = true;
  } catch (error) {
    if (existsSync(journalPath)) {
      const { paths } = loadProjectConfig(projectRoot);
      rollbackIntentTransaction(
        journalPath,
        resolve(paths.specsRoot, '2.Purpose/intents'),
      );
    }
    else for (const path of committed.reverse()) rmSync(path, { force: true });
    throw error;
  } finally {
    for (const { temporary } of staged) rmSync(temporary, { force: true });
    if (succeeded) {
      for (const { backup } of staged) rmSync(backup, { force: true });
    }
  }
}

function intentStatePath(path) {
  return path.replace(/\.md$/i, '.json');
}

function parseIntentDocument(path) {
  const content = readFileSync(path, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n[\s\S]*)$/);
  if (!match) throw new Error(`Intent has no valid YAML frontmatter: ${path}`);
  return { content, metadata: YAML.parse(match[1]) ?? {}, body: match[2] };
}

function structuredIntentState(projectRoot, path, metadata) {
  return {
    schema: 'ewai.intent-state/v1',
    slug: metadata.slug,
    domain: metadata.domain,
    title: metadata.title,
    status: metadata.status,
    deliveryStatus: metadata.delivery_status,
    currentPhase: metadata.current_phase,
    deliveryStatePath: metadata.delivery_state_path ?? null,
    intentMap: metadata.intent_map ?? null,
    personas: Array.isArray(metadata.personas) ? metadata.personas : [],
    relationships: Array.isArray(metadata.relationships) ? metadata.relationships : [],
    deliveryShape: metadata.delivery_shape ?? null,
    updatedAt: metadata.updated_at,
    markdownPath: relative(resolve(projectRoot), path).replaceAll('\\', '/')
  };
}

function asMarkdown(value) {
  if (Array.isArray(value)) {
    return value.length ? value.map((item) => `- ${String(item).trim()}`).join('\n') : '';
  }
  return String(value ?? '').trim();
}

function validatedRelationship(value) {
  const type = String(value?.type ?? '').trim();
  const target = String(value?.target ?? '').trim();
  const rationale = String(value?.rationale ?? '').trim();
  const suppliedRequiredBefore = String(value?.required_before ?? '').trim();
  const suppliedRequiredState = String(value?.required_state ?? '').trim();
  if (!intentRelationshipTypes.includes(type)) {
    throw new Error(`Intent relationship type must be one of: ${intentRelationshipTypes.join(', ')}`);
  }
  if (!intentReferencePattern.test(target)) {
    throw new Error(`Intent relationship target must be an exact domain/slug reference: ${target}`);
  }
  if ((suppliedRequiredBefore || suppliedRequiredState) && type !== 'depends-on') {
    throw new Error('required_before and required_state apply only to depends-on relationships');
  }
  const requiredBefore = type === 'depends-on' ? suppliedRequiredBefore || 'delivery' : '';
  const requiredState = type === 'depends-on' ? suppliedRequiredState || 'delivered' : '';
  if (requiredBefore && !['build', 'delivery'].includes(requiredBefore)) {
    throw new Error('depends-on required_before must be build or delivery');
  }
  if (requiredState && !['plan-complete', 'delivered'].includes(requiredState)) {
    throw new Error('depends-on required_state must be plan-complete or delivered');
  }
  return {
    type,
    target,
    ...(rationale ? { rationale } : {}),
    ...(requiredBefore ? { required_before: requiredBefore } : {}),
    ...(requiredState ? { required_state: requiredState } : {}),
  };
}

function validatedDeliveryShape(value) {
  if (value == null) return null;
  const recommendation = String(value.recommendation ?? '').trim();
  if (!deliveryShapeRecommendations.includes(recommendation)) {
    throw new Error(`Delivery-shape recommendation must be one of: ${deliveryShapeRecommendations.join(', ')}`);
  }
  const reason = String(value.reason ?? '').trim();
  if (!reason) throw new Error('Delivery-shape preview requires a reason');
  const suggestedChildren = (value.suggested_children ?? value.suggestedChildren ?? []).map((child) => {
    const slug = String(child?.slug ?? '').trim();
    if (slug && !slugPattern.test(slug)) {
      throw new Error(`Suggested child slug must be lower kebab-case: ${slug}`);
    }
    const domain = String(child?.domain ?? '').trim();
    if (domain && !slugPattern.test(domain)) {
      throw new Error(`Suggested child domain must be lower kebab-case: ${domain}`);
    }
    const title = String(child?.title ?? '').trim();
    const outcome = String(child?.outcome ?? '').trim();
    const dependsOn = Array.isArray(child?.depends_on ?? child?.dependsOn)
      ? (child.depends_on ?? child.dependsOn).map((item) => String(item).trim()).filter(Boolean)
      : [];
    return {
      ...(domain ? { domain } : {}),
      ...(slug ? { slug } : {}),
      ...(title ? { title } : {}),
      outcome,
      ...(dependsOn.length ? { depends_on: dependsOn } : {}),
    };
  });
  const blockingQuestions = Array.isArray(value.blocking_questions ?? value.blockingQuestions)
    ? (value.blocking_questions ?? value.blockingQuestions).map((item) => String(item).trim()).filter(Boolean)
    : [];
  const reviewedDecision = String(value.reviewed_decision ?? value.reviewedDecision ?? '').trim();
  if (reviewedDecision && !['keep-as-one', 'split', 'refine-split', 'defer'].includes(reviewedDecision)) {
    throw new Error('Delivery-shape reviewed_decision must be keep-as-one, split, refine-split, or defer');
  }
  return {
    recommendation,
    reason,
    suggested_children: suggestedChildren,
    blocking_questions: blockingQuestions,
    reviewed_decision: reviewedDecision || null,
  };
}

function renderDeliveryShape(deliveryShape) {
  if (!deliveryShape) return '';
  const children = deliveryShape.suggested_children.length
    ? deliveryShape.suggested_children.map((child) => {
        const label = child.slug
          ? `\`${child.domain ? `${child.domain}/` : ''}${child.slug}\``
          : child.title || 'Suggested child intent';
        const dependencies = child.depends_on?.length ? ` Depends on: ${child.depends_on.join(', ')}.` : '';
        return `- ${label}: ${child.outcome}${dependencies}`;
      }).join('\n')
    : '- No child intents suggested.';
  const questions = deliveryShape.blocking_questions.length
    ? deliveryShape.blocking_questions.map((question) => `- ${question}`).join('\n')
    : '- No blocking split questions recorded.';
  return [
    `- **Recommendation:** ${deliveryShape.recommendation}`,
    `- **Reason:** ${deliveryShape.reason}`,
    `- **Reviewed decision:** ${deliveryShape.reviewed_decision ?? 'not-reviewed'}`,
    '',
    '### Suggested child intents',
    '',
    children,
    '',
    '### Blocking split questions',
    '',
    questions,
  ].join('\n');
}

function renderIntentBody(title, details = {}, relationships = [], deliveryShape = null) {
  const relationshipContent = relationships.map((relationship) => (
    `- **${relationship.type}:** \`${relationship.target}\`${
      relationship.rationale ? ` — ${relationship.rationale}` : ''
    }${relationship.required_before ? ` (requires ${relationship.required_state ?? 'delivered'} before ${relationship.required_before})` : ''}`
  )).join('\n');
  const sections = [
    ['Problem', details.problem],
    ['Desired outcome', details.desiredOutcome],
    ['Users and personas', details.users],
    ['Journeys', details.journeys],
    ['Acceptance criteria', details.acceptanceCriteria],
    ['Constraints', details.constraints],
    ['Dependencies and relationships', relationshipContent],
    ['Delivery shape preview', renderDeliveryShape(deliveryShape)],
    ['Evidence', details.evidence],
    ['Open decisions', details.openDecisions],
  ];
  return `# ${title}\n\n${sections.map(([heading, value]) => (
    `## ${heading}\n\n${asMarkdown(value)}`
  )).join('\n\n')}\n`;
}

function parseIntentBodyDetails(body) {
  const matches = [...String(body ?? '').matchAll(/^##\s+(.+)\r?\n\r?\n([\s\S]*?)(?=\r?\n##\s+|$)/gm)];
  const sections = new Map(matches.map((match) => [match[1].trim(), match[2].trim()]));
  const value = (heading) => sections.get(heading) ?? '';
  return {
    problem: value('Problem'),
    desiredOutcome: value('Desired outcome'),
    users: value('Users and personas'),
    journeys: value('Journeys'),
    acceptanceCriteria: value('Acceptance criteria'),
    constraints: value('Constraints'),
    evidence: value('Evidence'),
    openDecisions: value('Open decisions'),
  };
}

export function parsePersonaAttachment(value) {
  const [ref, role = 'primary', depthValue = '3'] = value.split(':');
  const depth = Number(depthValue);
  validatePersonaRef(ref);
  if (!slugPattern.test(role)) throw new Error(`Invalid persona role: ${role}`);
  if (!Number.isInteger(depth) || depth < 1 || depth > 5) {
    throw new Error(`Persona depth must be an integer from 1 to 5: ${depthValue}`);
  }
  return { ref, role, depth };
}

export function createIntent(projectRoot, options) {
  recoverIntentTransactions(projectRoot);
  const slug = options.slug ?? '';
  const domain = options.domain ?? 'general';
  if (!slugPattern.test(slug)) throw new Error(`Intent slug must be lower kebab-case: ${slug}`);
  if (!slugPattern.test(domain)) throw new Error(`Intent domain must be lower kebab-case: ${domain}`);

  const { paths } = loadProjectConfig(projectRoot);
  const path = resolve(paths.specsRoot, '2.Purpose/intents', domain, `${slug}.md`);
  if (existsSync(path) && !options.force) throw new Error(`Intent already exists: ${path}`);
  const intentsRoot = resolve(paths.specsRoot, '2.Purpose/intents');
  const slugCollision = intentMarkdownFiles(intentsRoot).find((candidate) => {
    if (candidate === path) return false;
    try {
      return String(parseIntentDocument(candidate).metadata.slug ?? '').trim() === slug;
    } catch {
      return false;
    }
  });
  if (slugCollision) {
    throw new Error(`Intent slugs must be project-wide unique because delivery folders are slug-keyed: ${slug} already exists at ${relative(paths.projectRoot, slugCollision)}.`);
  }

  const title = options.title || slug.split('-').map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join(' ');
  const personas = (options.personas ?? []).map((persona) => validatedAttachment(
    typeof persona === 'string' ? parsePersonaAttachment(persona) : persona
  ));
  const rawIntentMap = options.intentMap == null ? null : String(options.intentMap).trim();
  const intentMap = rawIntentMap || null;
  if (intentMap && !slugPattern.test(intentMap)) {
    throw new Error(`Intent map reference must be lower kebab-case: ${intentMap}`);
  }
  const relationships = (options.relationships ?? []).map(validatedRelationship);
  const deliveryShape = validatedDeliveryShape(options.deliveryShape ?? options.delivery_shape ?? null);
  const ownReference = `${domain}/${slug}`;
  if (relationships.some((relationship) => relationship.target === ownReference)) {
    throw new Error(`Intent cannot relate to itself: ${ownReference}`);
  }
  const allowedRelationshipTargets = new Set(options.allowedRelationshipTargets ?? []);
  for (const relationship of relationships) {
    const [targetDomain, targetSlug] = relationship.target.split('/');
    const targetRoot = resolve(paths.specsRoot, '2.Purpose/intents', targetDomain, targetSlug);
    if (!allowedRelationshipTargets.has(relationship.target)
      && !existsSync(`${targetRoot}.md`)
      && !existsSync(`${targetRoot}.json`)) {
      throw new Error(`Intent ${ownReference} relates to missing intent ${relationship.target}`);
    }
  }
  const metadata = {
    schema: 'ewai.intent/v1',
    slug,
    domain,
    title,
    status: 'draft',
    delivery_status: 'not-started',
    current_phase: 'backlog',
    delivery_state_path: null,
    updated_at: new Date().toISOString(),
    intent_map: intentMap,
    personas,
    relationships,
    delivery_shape: deliveryShape,
  };
  const body = renderIntentBody(title, options.details, relationships, deliveryShape);
  const content = `---\n${YAML.stringify(metadata).trimEnd()}\n---\n\n${body}`;

  atomicWriteSet(paths.projectRoot, [
    { path, content },
    {
      path: intentStatePath(path),
      content: `${JSON.stringify(structuredIntentState(paths.projectRoot, path, metadata), null, 2)}\n`,
    },
  ]);
  publishLifecycleEventSafely(paths.projectRoot, 'ewai.intent.created', {
    sourceKey: `intent.created:${domain}/${slug}`,
    occurredAt: metadata.updated_at,
    sourceRevision: metadata.updated_at,
    scope: { intent: `${domain}/${slug}` },
    facts: { status: metadata.status, domain, slug },
    evidence: [relative(paths.projectRoot, path).replaceAll('\\', '/')],
    personas,
    streamId: `intent:${domain}/${slug}`,
    now: metadata.updated_at,
  });
  return { slug, domain, title, path, intentMap, personas, relationships };
}

export function updateIntentDeliveryState(projectRoot, path, input = {}) {
  const root = resolve(projectRoot);
  recoverIntentTransactions(root);
  const absolute = resolve(path);
  if (!absolute.endsWith('.md') || relative(root, absolute).startsWith('..') || !existsSync(absolute)) {
    throw new Error(`Intent Markdown is outside the project or missing: ${path}`);
  }
  const document = parseIntentDocument(absolute);
  if (input.status) document.metadata.status = input.status;
  if (input.deliveryStatus) document.metadata.delivery_status = input.deliveryStatus;
  if (input.currentPhase) document.metadata.current_phase = input.currentPhase;
  if (input.deliveryStatePath) document.metadata.delivery_state_path = input.deliveryStatePath;
  document.metadata.updated_at = new Date().toISOString();
  const structured = structuredIntentState(root, absolute, document.metadata);
  atomicWriteSet(root, [
    {
      path: absolute,
      content: `---\n${YAML.stringify(document.metadata).trimEnd()}\n---${document.body}`,
    },
    {
      path: intentStatePath(absolute),
      content: `${JSON.stringify(structured, null, 2)}\n`,
    },
  ]);
  return { markdownPath: absolute, jsonPath: intentStatePath(absolute), state: structured };
}

export function validateIntentStateCopies(projectRoot, path, expected = {}) {
  const root = resolve(projectRoot);
  recoverIntentTransactions(root);
  const absolute = resolve(path);
  const document = parseIntentDocument(absolute);
  const jsonPath = intentStatePath(absolute);
  if (!existsSync(jsonPath)) throw new Error(`Intent JSON state is missing: ${relative(root, jsonPath)}`);
  const structured = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const comparisons = {
    status: document.metadata.status,
    deliveryStatus: document.metadata.delivery_status,
    currentPhase: document.metadata.current_phase,
    deliveryStatePath: document.metadata.delivery_state_path ?? null
  };
  for (const [key, value] of Object.entries(comparisons)) {
    if (structured[key] !== value) throw new Error(`Intent state drift: Markdown and JSON disagree on ${key}.`);
    if (expected[key] !== undefined && expected[key] !== value) {
      throw new Error(`Intent state drift: delivery state and intent copies disagree on ${key}.`);
    }
  }
  for (const [key, value] of Object.entries({
    intentMap: document.metadata.intent_map ?? null,
    personas: Array.isArray(document.metadata.personas) ? document.metadata.personas : [],
    relationships: Array.isArray(document.metadata.relationships) ? document.metadata.relationships : [],
    deliveryShape: document.metadata.delivery_shape ?? null,
  })) {
    if (JSON.stringify(structured[key]) !== JSON.stringify(value)) {
      throw new Error(`Intent state drift: Markdown and JSON disagree on ${key}.`);
    }
  }
  return { markdown: comparisons, json: structured };
}

export function readDraftIntentForReconciliation(projectRoot, reference) {
  const root = resolve(projectRoot);
  recoverIntentTransactions(root);
  const path = intentSource(root, reference);
  const document = parseIntentDocument(path);
  if (document.metadata.schema !== 'ewai.intent/v1') {
    throw new Error(`Intent cannot be reconciled because its schema is unsupported: ${reference}`);
  }
  const checked = validateIntentStateCopies(root, path);
  const structured = checked.json;
  for (const [key, value] of Object.entries({
    slug: document.metadata.slug,
    domain: document.metadata.domain,
    title: document.metadata.title,
    updatedAt: document.metadata.updated_at,
    markdownPath: relative(root, path).replaceAll('\\', '/'),
  })) {
    if (structured[key] !== value) {
      throw new Error(`Intent cannot be reconciled because Markdown and JSON disagree on ${key}.`);
    }
  }
  const eligible = document.metadata.status === 'draft'
    && document.metadata.delivery_status === 'not-started'
    && document.metadata.current_phase === 'backlog'
    && !document.metadata.delivery_state_path;
  if (!eligible) {
    throw new Error(`Intent cannot be reconciled after governed delivery has started: ${reference}`);
  }
  return {
    reference,
    sourceUpdatedAt: document.metadata.updated_at,
    intent: {
      domain: document.metadata.domain,
      slug: document.metadata.slug,
      title: document.metadata.title,
      intentMap: document.metadata.intent_map ?? null,
      personas: Array.isArray(document.metadata.personas) ? structuredClone(document.metadata.personas) : [],
      relationships: Array.isArray(document.metadata.relationships) ? structuredClone(document.metadata.relationships) : [],
      deliveryShape: document.metadata.delivery_shape ? structuredClone(document.metadata.delivery_shape) : null,
      details: parseIntentBodyDetails(document.body),
    },
    state: {
      status: document.metadata.status,
      deliveryStatus: document.metadata.delivery_status,
      currentPhase: document.metadata.current_phase,
      deliveryStatePath: document.metadata.delivery_state_path ?? null,
    },
    destinations: [
      relative(root, path).replaceAll('\\', '/'),
      relative(root, intentStatePath(path)).replaceAll('\\', '/'),
    ],
  };
}

export function listDraftIntentsForReconciliation(projectRoot) {
  const { paths } = loadProjectConfig(projectRoot);
  const root = resolve(paths.specsRoot, '2.Purpose/intents');
  const intents = [];
  for (const path of intentMarkdownFiles(root)) {
    try {
      const document = parseIntentDocument(path);
      const reference = `${document.metadata.domain}/${document.metadata.slug}`;
      const candidate = readDraftIntentForReconciliation(paths.projectRoot, reference);
      intents.push({ reference, title: candidate.intent.title, updatedAt: candidate.sourceUpdatedAt });
    } catch {
      // Ineligible or divergent records remain available through governed delivery, not this editor.
    }
  }
  return intents.sort((left, right) => left.title.localeCompare(right.title) || left.reference.localeCompare(right.reference));
}

export function replaceDraftIntent(projectRoot, reference, options = {}) {
  const root = resolve(projectRoot);
  const current = readDraftIntentForReconciliation(root, reference);
  if (!options.expectedUpdatedAt || options.expectedUpdatedAt !== current.sourceUpdatedAt) {
    throw new Error(`Intent cannot be reconciled because a newer canonical revision exists: ${reference}`);
  }
  const proposed = options.intent ?? {};
  if ((proposed.domain && proposed.domain !== current.intent.domain)
    || (proposed.slug && proposed.slug !== current.intent.slug)) {
    throw new Error('Intent identity cannot change during reconciliation');
  }
  if (proposed.relationships
    && JSON.stringify(proposed.relationships) !== JSON.stringify(current.intent.relationships)) {
    throw new Error('Intent relationships cannot change during reconciliation');
  }
  const title = String(proposed.title ?? current.intent.title).trim();
  if (!title) throw new Error('Intent title is required');
  const personas = (proposed.personas ?? current.intent.personas).map((persona) => validatedAttachment(persona));
  const deliveryShape = validatedDeliveryShape(proposed.deliveryShape ?? proposed.delivery_shape ?? current.intent.deliveryShape);
  const path = intentSource(root, reference);
  const document = parseIntentDocument(path);
  const metadata = {
    ...document.metadata,
    title,
    personas,
    relationships: current.intent.relationships,
    delivery_shape: deliveryShape,
    updated_at: options.now ?? new Date().toISOString(),
  };
  const body = renderIntentBody(title, proposed.details ?? current.intent.details, metadata.relationships, deliveryShape);
  atomicWriteSet(root, [
    { path, content: `---\n${YAML.stringify(metadata).trimEnd()}\n---\n\n${body}` },
    { path: intentStatePath(path), content: `${JSON.stringify(structuredIntentState(root, path, metadata), null, 2)}\n` },
  ]);
  publishLifecycleEventSafely(root, 'ewai.intent.reconciled', {
    sourceKey: `intent.reconciled:${reference}:${metadata.updated_at}`,
    occurredAt: metadata.updated_at,
    sourceRevision: metadata.updated_at,
    scope: { intent: reference },
    facts: { status: metadata.status, domain: metadata.domain, slug: metadata.slug },
    evidence: [relative(root, path).replaceAll('\\', '/')],
    personas,
    streamId: `intent:${reference}`,
    now: metadata.updated_at,
  });
  return {
    reference,
    markdownPath: relative(root, path).replaceAll('\\', '/'),
    jsonPath: relative(root, intentStatePath(path)).replaceAll('\\', '/'),
    updatedAt: metadata.updated_at,
  };
}

function intentMarkdownFiles(root, found = []) {
  if (!existsSync(root)) return found;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) intentMarkdownFiles(path, found);
    else if (entry.isFile() && entry.name.endsWith('.md')) found.push(path);
  }
  return found;
}

export function auditIntentStateCopies(projectRoot, options = {}) {
  recoverIntentTransactions(projectRoot);
  const { paths } = loadProjectConfig(projectRoot);
  const root = resolve(paths.specsRoot, '2.Purpose/intents');
  const result = { schema: 'ewai.intent-state-audit/v1', checked: 0, created: [], drift: [] };
  for (const path of intentMarkdownFiles(root)) {
    const document = parseIntentDocument(path);
    if (document.metadata.schema !== 'ewai.intent/v1') continue;
    result.checked += 1;
    const sidecar = intentStatePath(path);
    const slug = document.metadata.slug;
    const deliveryPath = resolve(paths.specsRoot, `6.Build/${slug}/delivery-state.json`);
    const delivery = existsSync(deliveryPath) ? JSON.parse(readFileSync(deliveryPath, 'utf8')) : null;
    const expected = delivery ? {
      status: delivery.intent?.status,
      deliveryStatus: delivery.status,
      currentPhase: delivery.currentPhase,
      deliveryStatePath: relative(paths.projectRoot, deliveryPath).replaceAll('\\', '/')
    } : {};
    if (!existsSync(sidecar) && options.repairMissing !== false) {
      const updated = updateIntentDeliveryState(paths.projectRoot, path, {
        status: expected.status ?? document.metadata.status ?? 'draft',
        deliveryStatus: expected.deliveryStatus ?? document.metadata.delivery_status ?? 'not-started',
        currentPhase: expected.currentPhase ?? document.metadata.current_phase ?? 'backlog',
        deliveryStatePath: expected.deliveryStatePath ?? document.metadata.delivery_state_path ?? null
      });
      result.created.push(relative(paths.projectRoot, updated.jsonPath).replaceAll('\\', '/'));
      continue;
    }
    try {
      validateIntentStateCopies(paths.projectRoot, path, expected);
    } catch (error) {
      result.drift.push({
        intent: relative(paths.projectRoot, path).replaceAll('\\', '/'),
        message: error.message
      });
    }
  }
  result.status = result.drift.length ? 'drift-detected' : 'consistent';
  return result;
}

function intentSource(projectRoot, reference) {
  const { paths } = loadProjectConfig(projectRoot);
  const parts = String(reference ?? '').split('/');
  const [domain, slug] = parts;
  if (parts.length !== 2 || !slugPattern.test(domain) || !slugPattern.test(slug)) {
    throw new Error(`Intent persona changes require an exact domain/slug reference: ${reference}`);
  }
  const root = resolve(paths.specsRoot, '2.Purpose/intents');
  const path = resolve(root, domain, `${slug}.md`);
  const rel = relative(root, path);
  if (rel.startsWith('..') || !existsSync(path)) throw new Error(`Intent not found: ${reference}`);
  return path;
}

async function updateIntentMetadata(projectRoot, reference, mutate) {
  recoverIntentTransactions(projectRoot);
  const path = intentSource(projectRoot, reference);
  const previous = intentMutationQueues.get(path) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(() => {
    const document = parseIntentDocument(path);
    const metadata = document.metadata;
    mutate(metadata);
    metadata.updated_at = new Date().toISOString();
    atomicWriteSet(projectRoot, [
      {
        path,
        content: `---\n${YAML.stringify(metadata).trimEnd()}\n---${document.body}`,
      },
      {
        path: intentStatePath(path),
        content: `${JSON.stringify(structuredIntentState(projectRoot, path, metadata), null, 2)}\n`,
      },
    ]);
    return { path, metadata };
  });
  intentMutationQueues.set(path, operation);
  try {
    return await operation;
  } finally {
    if (intentMutationQueues.get(path) === operation) intentMutationQueues.delete(path);
  }
}

function validatedAttachment(input) {
  const ref = String(input.ref ?? input.personaRef ?? '').trim();
  const role = String(input.role ?? 'reviewer').trim();
  const depth = Number(input.depth ?? 3);
  validatePersonaRef(ref);
  if (!slugPattern.test(role)) throw new Error(`Invalid persona role: ${role}`);
  if (!Number.isInteger(depth) || depth < 1 || depth > 5) throw new Error('Persona depth must be an integer from 1 to 5');
  return { ref, role, depth };
}

export async function attachPersonaToIntent(projectRoot, reference, input) {
  const attachment = validatedAttachment(input);
  const updated = await updateIntentMetadata(projectRoot, reference, (metadata) => {
    const personas = Array.isArray(metadata.personas) ? metadata.personas : [];
    const existing = personas.findIndex((persona) => persona?.ref === attachment.ref);
    if (existing === -1) personas.push(attachment);
    else personas[existing] = attachment;
    metadata.personas = personas;
  });
  return { reference, attachment, path: updated.path, personas: updated.metadata.personas };
}

export async function detachPersonaFromIntent(projectRoot, reference, personaRef) {
  const ref = validatedAttachment({ ref: personaRef, role: 'reviewer', depth: 3 }).ref;
  const updated = await updateIntentMetadata(projectRoot, reference, (metadata) => {
    metadata.personas = (Array.isArray(metadata.personas) ? metadata.personas : []).filter((persona) => persona?.ref !== ref);
  });
  return { reference, detached: ref, path: updated.path, personas: updated.metadata.personas };
}
