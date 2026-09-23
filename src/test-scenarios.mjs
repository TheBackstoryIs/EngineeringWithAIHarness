import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import YAML from 'yaml';
import { deliveryPaths, isWithin } from './delivery-documents.mjs';
import { loadProjectConfig } from './project.mjs';
import { selectContextualPersonas } from './runtime/persona-engagement.mjs';

const BRIEF_SCHEMA = 'ewai.persona-test-brief/v1';
const SCENARIO_SCHEMA = 'ewai.persona-test-scenarios/v1';
const WORKSPACE_SCHEMA = 'ewai.persona-test-workspace/v1';
const SOURCE_DIGEST_VERSION = 'intent-content-v2';
const BASELINE_SCHEMA = 'ewai.scenario-source-baseline/v1';
const lifecycleMetadata = new Set(['status', 'delivery_status', 'current_phase', 'delivery_state_path', 'updated_at']);
const scenarioIdPattern = /^PTS-[0-9]{3}$/;
const sourceIdPattern = /^[a-z0-9][a-z0-9:._-]{2,159}$/i;
const allowedTypes = new Set([
  'happy-path', 'alternate', 'error', 'permissions', 'accessibility', 'security-privacy',
  'operations', 'recovery', 'data', 'misuse', 'adversarial', 'regression'
]);
const allowedRoutes = new Set(['automated', 'manual-qa', 'specialist-assurance', 'representative-user']);
const allowedAutomation = new Set(['automated', 'manual', 'hybrid']);
const allowedStatuses = new Set(['accepted', 'blocked', 'superseded', 'hypothesis']);
const vagueOraclePattern = /^(?:works?|works correctly|is correct|is successful|succeeds?|passes?|handled correctly|expected result)$/i;
const MAX_FOCUS = 1_000;
const MAX_SOURCES = 240;
const MAX_SCENARIOS = 200;
const MAX_LIST_ITEMS = 50;
const MAX_TEXT = 1_000;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function cleanText(value, label, maximum = MAX_TEXT, required = true) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (required && !text) throw new Error(`${label} is required`);
  if (text.length > maximum) throw new Error(`${label} exceeds ${maximum} characters`);
  return text;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function assertFingerprintMetadata(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Intent metadata contains a non-finite number');
    return;
  }
  if (typeof value !== 'object' || (!Array.isArray(value)
    && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error('Intent metadata contains an unsupported value; use plain mappings, arrays and JSON scalar values');
  }
  if (ancestors.has(value)) throw new Error('Intent metadata contains a cyclic value');
  ancestors.add(value);
  for (const child of Object.values(value)) assertFingerprintMetadata(child, ancestors);
  ancestors.delete(value);
}

function relativePath(root, path) {
  return relative(resolve(root), resolve(path)).replaceAll('\\', '/');
}

function assertSafeProjectPath(root, value, label, { requireExisting = false } = {}) {
  const input = cleanText(value, label, 500);
  if (input.includes('\0') || input.includes('://') || isAbsolute(input)) {
    throw new Error(`${label} must be a safe repository-relative path`);
  }
  const absolute = resolve(root, input);
  const rel = relative(root, absolute);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`${label} must be a safe repository-relative path`);
  }
  if (requireExisting && !existsSync(absolute)) throw new Error(`${label} does not exist: ${input}`);
  return rel.replaceAll('\\', '/');
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
}

function findFiles(root, predicate, found = []) {
  if (!existsSync(root)) return found;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) findFiles(path, predicate, found);
    else if (entry.isFile() && predicate(path, entry.name)) found.push(path);
  }
  return found;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { metadata: {}, body: content };
  let metadata;
  try {
    metadata = YAML.parse(match[1]) ?? {};
  } catch (error) {
    throw new Error(`Intent frontmatter is invalid: ${error.message}`);
  }
  return { metadata, body: content.slice(match[0].length) };
}

function findIntent(projectRoot, slug) {
  const { paths } = loadProjectConfig(projectRoot);
  const intentsRoot = resolve(paths.specsRoot, '2.Purpose/intents');
  const matches = findFiles(intentsRoot, (_path, name) => name.endsWith('.md')).flatMap((path) => {
    const content = readFileSync(path, 'utf8');
    const parsed = parseFrontmatter(content);
    return parsed.metadata.slug === slug ? [{ path, content, ...parsed }] : [];
  });
  if (!matches.length) throw new Error(`Unknown intent slug: ${slug}`);
  if (matches.length > 1) throw new Error(`Intent slug is ambiguous: ${slug}`);
  return { ...matches[0], specsRoot: paths.specsRoot };
}

function section(body, heading) {
  const lines = String(body).split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) return '';
  const content = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) break;
    content.push(lines[index]);
  }
  return content.join('\n').trim();
}

function boundedExcerpt(value, maximum = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function enumeratedLines(value) {
  return String(value ?? '').split(/\r?\n/).map((line) => line.trim())
    .filter((line) => /^(?:[-*]|\d+[.)])\s+/.test(line))
    .map((line) => line.replace(/^(?:[-*]|\d+[.)])\s+/, '').trim())
    .slice(0, 100);
}

function sourceRecord(projectRoot, { id, kind, label, path, text, authority = 'authoritative' }) {
  if (!sourceIdPattern.test(id)) throw new Error(`Invalid source reference: ${id}`);
  const safePath = assertSafeProjectPath(projectRoot, relativePath(projectRoot, path), 'Source path', { requireExisting: true });
  const excerpt = boundedExcerpt(text);
  return { id, kind, label: cleanText(label, 'Source label', 200), path: safePath, digest: sha256(readFileSync(path)), excerpt, authority };
}

function explicitOrGeneratedId(text, prefix, index) {
  const explicit = String(text).match(new RegExp(`\\b(${prefix}-\\d{3})\\b`, 'i'))?.[1]?.toUpperCase();
  return explicit ?? `${prefix}-${String(index + 1).padStart(3, '0')}`;
}

function intentSources(projectRoot, intent) {
  const sources = [];
  const specs = [
    ['Problem', 'section', 'problem'],
    ['Desired outcome', 'section', 'desired-outcome'],
    ['Constraints', 'section', 'constraints']
  ];
  for (const [heading, kind, id] of specs) {
    const text = section(intent.body, heading);
    if (text && !/^Not captured\./i.test(text)) {
      sources.push(sourceRecord(projectRoot, { id: `intent:${kind}:${id}`, kind: `intent-${kind}`, label: heading, path: intent.path, text }));
    }
  }
  for (const [index, text] of enumeratedLines(section(intent.body, 'Journeys')).entries()) {
    const id = explicitOrGeneratedId(text, 'J', index);
    sources.push(sourceRecord(projectRoot, { id: `intent:journey:${id}`, kind: 'intent-journey', label: `Journey ${id}`, path: intent.path, text }));
  }
  for (const [index, text] of enumeratedLines(section(intent.body, 'Acceptance criteria')).entries()) {
    const id = explicitOrGeneratedId(text, 'AC', index);
    sources.push(sourceRecord(projectRoot, { id: `intent:acceptance:${id}`, kind: 'intent-acceptance', label: `Acceptance criterion ${id}`, path: intent.path, text }));
  }
  return sources;
}

function planSources(projectRoot, deliveryRoot) {
  const sources = [];
  const planPath = resolve(deliveryRoot, 'gates/plan/plan-contract.json');
  if (existsSync(planPath)) {
    const plan = readJson(planPath, 'Plan Contract');
    if (plan.slug && plan.slug !== deliveryRoot.split('/').at(-1)) throw new Error('Plan Contract slug does not match the intent');
    for (const item of (plan.test_obligations ?? []).slice(0, 100)) {
      const id = cleanText(item.id, 'Plan test obligation ID', 80);
      sources.push(sourceRecord(projectRoot, {
        id: `plan:test:${id}`, kind: 'plan-test-obligation', label: `Test obligation ${id}`, path: planPath,
        text: [item.obligation, item.file, item.type].filter(Boolean).join(' · ')
      }));
    }
  }
  const claimsPath = resolve(deliveryRoot, 'gates/plan/claim-ledger.json');
  if (existsSync(claimsPath)) {
    const claims = readJson(claimsPath, 'Claim Ledger');
    if (claims.slug && claims.slug !== deliveryRoot.split('/').at(-1)) throw new Error('Claim Ledger slug does not match the intent');
    for (const item of (claims.implementation_claims ?? []).slice(0, 100)) {
      const id = cleanText(item.id, 'Plan claim ID', 80);
      sources.push(sourceRecord(projectRoot, {
        id: `plan:claim:${id}`, kind: 'plan-claim', label: `Implementation claim ${id}`, path: claimsPath,
        text: [item.statement, ...(item.tests_required ?? [])].filter(Boolean).join(' · ')
      }));
    }
  }
  const testPlanPath = resolve(deliveryRoot, 'test-plan.md');
  if (existsSync(testPlanPath)) {
    sources.push(sourceRecord(projectRoot, {
      id: 'test-plan:document', kind: 'test-plan', label: 'Accepted test plan', path: testPlanPath,
      text: readFileSync(testPlanPath, 'utf8')
    }));
  }
  return sources;
}

function standardSources(projectRoot, specsRoot) {
  const standardsRoot = resolve(specsRoot, '4.Guidelines');
  return findFiles(standardsRoot, (_path, name) => /\.(?:md|json|ya?ml)$/i.test(name)).sort().slice(0, 20).map((path, index) => sourceRecord(projectRoot, {
    id: `standard:project:${String(index + 1).padStart(3, '0')}`,
    kind: 'project-standard',
    label: relativePath(standardsRoot, path),
    path,
    text: readFileSync(path, 'utf8')
  }));
}

function contextualImpactSources(projectRoot, deliveryRoot) {
  const impactRoot = resolve(deliveryRoot, 'impacts');
  return findFiles(impactRoot, (_path, name) => name.endsWith('.json')).sort().slice(0, 20).flatMap((path) => {
    const record = readJson(path, 'Impact assessment');
    if (record.schema !== 'ewai.impact-assessment/v1' || !record.assessmentId) return [];
    return (record.impactAreas ?? []).slice(0, 20).map((area, index) => sourceRecord(projectRoot, {
      id: `impact:${record.assessmentId}:area:${area.id ?? index + 1}`,
      kind: 'impact-assessment',
      label: area.label ?? area.id ?? `Impact area ${index + 1}`,
      path,
      text: [area.label, ...(area.signals ?? [])].filter(Boolean).join(' · '),
      authority: 'inferred-context'
    }));
  });
}

function personaAvailability(catalogue) {
  return Object.fromEntries(['core', 'premium', 'personal', 'project'].map((tier) => {
    const count = catalogue.filter((persona) => String(persona.tier || 'core') === tier).length;
    return [tier, {
      installed: count > 0,
      count,
      reason: count ? `${count} installed ${tier} persona${count === 1 ? '' : 's'} available.` : `No installed ${tier} personas were found.`
    }];
  }));
}

function personaSignals(sources, contextualEvidence, focus) {
  const direct = [focus, ...sources.map((source) => `${source.label} ${source.excerpt}`), ...contextualEvidence.map((source) => `${source.label} ${source.excerpt}`)];
  return [...new Set(direct.flatMap((value) => String(value).toLowerCase().split(/[^a-z0-9-]+/)).filter((word) => word.length >= 4))].slice(0, 120);
}

function briefDigest(sources, contextualEvidence) {
  return sha256(canonicalJson({
    sources: sources.map(({ id, path, digest, authority }) => ({ id, path, digest, authority })),
    contextualEvidence: contextualEvidence.map(({ id, path, digest, authority }) => ({ id, path, digest, authority }))
  }));
}

function prepareBrief(projectRoot, slug, options = {}, sourceDigestVersion = SOURCE_DIGEST_VERSION) {
  const root = resolve(projectRoot);
  const focus = cleanText(options.focus, 'Focus', MAX_FOCUS, false);
  const intent = findIntent(root, cleanText(slug, 'Intent slug', 100));
  const paths = deliveryPaths(root, slug);
  const intentEvidence = intentSources(root, intent);
  // A planning source alone cannot carry the complete intent fingerprint.
  if (!intentEvidence.length) {
    throw new Error('A recognised intent source is required: capture Problem, Desired outcome, Constraints, or a listed Journey or Acceptance criterion');
  }
  const rawIntentDigest = sha256(intent.content);
  // Both policies describe the same captured intent bytes, even if a later read changes.
  for (const source of intentEvidence) source.digest = rawIntentDigest;
  if (sourceDigestVersion === SOURCE_DIGEST_VERSION) {
    if (!intent.metadata || typeof intent.metadata !== 'object' || Array.isArray(intent.metadata)) {
      throw new Error('Intent metadata must be a mapping');
    }
    const metadata = Object.fromEntries(Object.entries(intent.metadata).filter(([key]) => !lifecycleMetadata.has(key)));
    // Reject values canonical() cannot represent faithfully before it can erase their type/content.
    assertFingerprintMetadata(metadata);
    // Cover the complete body and every other metadata value, never the bounded excerpts.
    const content = canonicalJson({ metadata, body: intent.body });
    const digest = sha256(content);
    for (const source of intentEvidence) source.digest = digest;
  }
  const authoritativeSources = [
    ...intentEvidence,
    ...planSources(root, paths.deliveryRoot),
    ...standardSources(root, intent.specsRoot)
  ];
  const contextualEvidence = contextualImpactSources(root, paths.deliveryRoot);
  if (!authoritativeSources.length) throw new Error('No bounded authoritative testing sources are available for this intent');
  if (authoritativeSources.length + contextualEvidence.length > MAX_SOURCES) throw new Error(`Testing brief exceeds ${MAX_SOURCES} sources`);
  const catalogue = Array.isArray(options.personas) ? options.personas : Array.isArray(options.personaCatalogue) ? options.personaCatalogue : [];
  const signals = personaSignals(authoritativeSources, contextualEvidence, focus);
  const activePersonas = selectContextualPersonas({
    signals,
    context: { focus, authoritativeSources, contextualEvidence },
    personaCatalogue: catalogue,
    contextLabel: 'persona-led test scenario design',
    limit: 4
  });
  const sourceDigest = briefDigest(authoritativeSources, contextualEvidence);
  const legacySourceDigest = briefDigest(authoritativeSources.map((source) => source.kind.startsWith('intent-')
    ? { ...source, digest: rawIntentDigest } : source), contextualEvidence);
  return {
    schema: BRIEF_SCHEMA,
    slug,
    focus,
    sourceDigest,
    legacySourceDigest,
    ...(sourceDigestVersion ? { sourceDigestVersion } : {}),
    authoritativeSources,
    contextualEvidence,
    activePersonas,
    availability: personaAvailability(catalogue),
    unresolvedQuestions: activePersonas.length ? [] : ['No installed persona matched the current testing signals; select or create a relevant persona before semantic challenge.'],
    recordingContract: {
      schema: SCENARIO_SCHEMA,
      scenarioTypes: [...allowedTypes], evidenceRoutes: [...allowedRoutes], automation: [...allowedAutomation], statuses: [...allowedStatuses]
    },
    guidance: {
      personaOutputIsAuthority: false,
      hypothesesRequireHumanResolution: true,
      humanEvidenceTakesPriority: true,
      approvalsChanged: false,
      premiumSyncAttempted: false
    }
  };
}

export function preparePersonaTestScenarioBrief(projectRoot, slug, options = {}) {
  const { legacySourceDigest: _legacySourceDigest, ...brief } = prepareBrief(projectRoot, slug, options);
  return brief;
}

function textList(value, label, { required = true } = {}) {
  if (!Array.isArray(value) || (required && !value.length) || value.length > MAX_LIST_ITEMS) {
    throw new Error(`${label} must contain ${required ? 'one to ' : 'no more than '}${MAX_LIST_ITEMS} items`);
  }
  return value.map((item, index) => cleanText(item, `${label} item ${index + 1}`));
}

function validateScenario(root, raw, knownSources, knownPersonas) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Each test scenario must be an object');
  const id = cleanText(raw.id, 'Scenario ID', 20);
  if (!scenarioIdPattern.test(id)) throw new Error(`Scenario ID must match PTS-###: ${id}`);
  const type = cleanText(raw.type, `${id} type`, 40);
  if (!allowedTypes.has(type)) throw new Error(`${id} has unsupported scenario type: ${type}`);
  const status = cleanText(raw.status, `${id} status`, 40);
  if (!allowedStatuses.has(status)) throw new Error(`${id} has unsupported status: ${status}`);
  const sourceRefs = textList(raw.sourceRefs ?? [], `${id} source references`, { required: status === 'accepted' });
  for (const reference of sourceRefs) if (!knownSources.has(reference)) throw new Error(`${id} has unknown source reference: ${reference}`);
  if (status === 'accepted' && !sourceRefs.length) throw new Error(`${id} accepted scenario requires a source reference`);
  const contributions = raw.personaContributions;
  if (!Array.isArray(contributions) || !contributions.length || contributions.length > 12) throw new Error(`${id} requires persona contributions`);
  const personaContributions = contributions.map((item, index) => {
    const personaId = cleanText(item?.personaId, `${id} persona contribution ${index + 1}`, 160);
    if (!knownPersonas.has(personaId)) throw new Error(`${id} has unknown persona: ${personaId}`);
    return { personaId, concern: cleanText(item?.concern, `${id} persona concern`, 500) };
  });
  const expectedResults = textList(raw.expectedResults, `${id} expected results`);
  if (expectedResults.some((oracle) => vagueOraclePattern.test(oracle) || oracle.length < 12)) {
    throw new Error(`${id} requires an observable expected result rather than a vague oracle`);
  }
  const evidenceRoute = cleanText(raw.evidenceRoute, `${id} evidence route`, 40);
  if (!allowedRoutes.has(evidenceRoute)) throw new Error(`${id} has unsupported evidence route: ${evidenceRoute}`);
  const automation = cleanText(raw.automation, `${id} automation`, 40);
  if (!allowedAutomation.has(automation)) throw new Error(`${id} has unsupported automation classification: ${automation}`);
  let plannedTest = null;
  if (automation === 'automated' || automation === 'hybrid') {
    if (!raw.plannedTest || typeof raw.plannedTest !== 'object') throw new Error(`${id} requires a planned test contract`);
    plannedTest = {
      file: assertSafeProjectPath(root, raw.plannedTest.file, `${id} planned test file`),
      name: cleanText(raw.plannedTest.name, `${id} planned test name`, 300)
    };
  } else if (raw.plannedTest?.file || raw.plannedTest?.name) {
    plannedTest = {
      file: assertSafeProjectPath(root, raw.plannedTest.file, `${id} planned test file`),
      name: cleanText(raw.plannedTest.name, `${id} planned test name`, 300)
    };
  }
  return {
    id,
    title: cleanText(raw.title, `${id} title`, 240),
    type,
    sourceRefs,
    personaContributions,
    preconditions: textList(raw.preconditions, `${id} preconditions`),
    actions: textList(raw.actions, `${id} actions`),
    expectedResults,
    evidenceRoute,
    automation,
    plannedTest,
    owner: cleanText(raw.owner, `${id} owner`, 160),
    status
  };
}

function scenarioPayload(slug, brief, input, reviewer) {
  if (input.schema !== SCENARIO_SCHEMA) throw new Error(`Scenario pack schema must be ${SCENARIO_SCHEMA}`);
  if (input.slug !== slug) throw new Error('Scenario pack slug does not match the requested intent');
  if (input.preparedSourceDigest !== brief.sourceDigest) throw new Error('Prepared source digest is stale or does not match this intent');
  if (!Array.isArray(input.scenarios) || !input.scenarios.length || input.scenarios.length > MAX_SCENARIOS) {
    throw new Error(`Scenario pack must contain one to ${MAX_SCENARIOS} scenarios`);
  }
  const knownSources = new Set(brief.authoritativeSources.map(({ id }) => id));
  const knownPersonas = new Set(brief.activePersonas.map(({ id }) => id));
  const scenarios = input.scenarios.map((scenario) => validateScenario(brief.projectRoot ?? '', scenario, knownSources, knownPersonas));
  const ids = scenarios.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error('Scenario pack contains duplicate scenario IDs');
  const gaps = Array.isArray(input.gaps) ? input.gaps.slice(0, 100).map((gap, index) => {
    if (typeof gap === 'string') return { id: `GAP-${String(index + 1).padStart(3, '0')}`, question: cleanText(gap, 'Gap', 500), status: 'open' };
    return {
      id: cleanText(gap?.id ?? `GAP-${String(index + 1).padStart(3, '0')}`, 'Gap ID', 40),
      question: cleanText(gap?.question, 'Gap question', 500),
      status: cleanText(gap?.status ?? 'open', 'Gap status', 40)
    };
  }) : [];
  return {
    schema: SCENARIO_SCHEMA,
    slug,
    preparedSourceDigest: brief.sourceDigest,
    ...(brief.sourceDigestVersion ? { sourceDigestVersion: brief.sourceDigestVersion } : {}),
    reviewer,
    focus: brief.focus,
    sources: brief.authoritativeSources.map(({ id, kind, label, path, digest, authority }) => ({ id, kind, label, path, digest, authority })),
    contextualEvidence: brief.contextualEvidence.map(({ id, kind, label, path, digest, authority }) => ({ id, kind, label, path, digest, authority })),
    activePersonas: brief.activePersonas,
    availability: brief.availability,
    scenarios,
    gaps,
    authority: {
      personaPerspectivesAreAdvisory: true,
      humanEvidenceTakesPriority: true,
      approvalsChanged: false,
      premiumSyncAttempted: false
    }
  };
}

function recordDigestPayload(record) {
  const { contentDigest: _digest, markdownDigest: _markdownDigest, reviewedAt: _reviewedAt, ...payload } = record;
  return payload;
}

function renderMarkdown(record) {
  const personaRows = record.activePersonas.length
    ? record.activePersonas.map((persona) => `| ${persona.name.replaceAll('|', '\\|')} | ${persona.tier} | ${persona.matchedSignals.join(', ')} | ${persona.engagementReason.replaceAll('|', '\\|')} |`).join('\n')
    : '| No installed persona matched | — | — | — |';
  const scenarioSections = record.scenarios.map((scenario) => `### ${scenario.id} — ${scenario.title}\n\n- **Status:** ${scenario.status}\n- **Type:** ${scenario.type}\n- **Sources:** ${scenario.sourceRefs.map((id) => `\`${id}\``).join(', ') || 'Unresolved hypothesis'}\n- **Evidence route:** ${scenario.evidenceRoute}\n- **Automation:** ${scenario.automation}\n- **Owner:** ${scenario.owner}\n- **Preconditions:** ${scenario.preconditions.join('; ')}\n- **Actions:** ${scenario.actions.join('; ')}\n- **Expected results:** ${scenario.expectedResults.join('; ')}\n- **Planned test:** ${scenario.plannedTest ? `\`${scenario.plannedTest.file}\` — ${scenario.plannedTest.name}` : 'human evidence route'}\n`).join('\n');
  const gapRows = record.gaps.length ? record.gaps.map((gap) => `- **${gap.id}:** ${gap.question} (${gap.status})`).join('\n') : '- None recorded.';
  return `# Persona-Driven Test Scenarios — ${record.slug}\n\n**Schema:** \`${record.schema}\`  \n**Reviewed by:** ${record.reviewer}  \n**Reviewed at:** ${record.reviewedAt}  \n**Content digest:** \`${record.contentDigest}\`  \n**Prepared source digest:** \`${record.preparedSourceDigest}\`\n\n## Active personas\n\n| Persona | Tier | Matched concerns | Engagement reason |\n| --- | --- | --- | --- |\n${personaRows}\n\n## Scenarios\n\n${scenarioSections}\n## Gaps and unresolved hypotheses\n\n${gapRows}\n\n## Authority boundary\n\nPersona perspectives are advisory. They do not create requirements, approve delivery, complete Manual QA, provide specialist assurance, or replace representative users. Human evidence and accountable decisions retain authority.\n`;
}

function transactionPaths(projectRoot, slug) {
  const root = resolve(projectRoot, '.ewai-pipeline/runtime/test-scenario-transactions');
  return { root, journal: resolve(root, `${slug}.json`) };
}

function transactionStagePath(value, targetPath, deliveryRoot, label) {
  const candidate = resolve(String(value ?? ''));
  if (
    !value
    || !isWithin(deliveryRoot, candidate)
    || !candidate.startsWith(`${targetPath}.`)
    || !candidate.endsWith('.tmp')
  ) {
    throw new Error(`Unsafe test-scenario transaction ${label} path`);
  }
  return candidate;
}

function cleanTransaction(projectRoot, slug) {
  const paths = deliveryPaths(projectRoot, slug);
  const transaction = transactionPaths(projectRoot, slug);
  if (!existsSync(transaction.journal)) return;
  let journal;
  try {
    journal = JSON.parse(readFileSync(transaction.journal, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid test-scenario transaction journal: ${error.message}`);
  }
  if (
    !journal
    || typeof journal !== 'object'
    || ![undefined, 'ewai.test-scenario-transaction/v1'].includes(journal.schema)
    || journal.slug !== slug
    || !['staged', 'json-committed', 'committed'].includes(journal.phase)
  ) {
    throw new Error('Invalid test-scenario transaction journal contract');
  }
  const jsonPath = resolve(paths.deliveryRoot, 'test-scenarios.json');
  const markdownPath = resolve(paths.deliveryRoot, 'test-scenarios.md');
  const stages = [
    transactionStagePath(journal.jsonStage, jsonPath, paths.deliveryRoot, 'JSON stage'),
    transactionStagePath(journal.markdownStage, markdownPath, paths.deliveryRoot, 'Markdown stage')
  ];
  for (const path of stages) rmSync(path, { force: true });
  if (journal.phase !== 'committed') {
    rmSync(jsonPath, { force: true });
    rmSync(markdownPath, { force: true });
  }
  rmSync(transaction.journal, { force: true });
}

function writePair(projectRoot, slug, jsonContent, markdownContent, options = {}) {
  const paths = deliveryPaths(projectRoot, slug);
  const jsonPath = resolve(paths.deliveryRoot, 'test-scenarios.json');
  const markdownPath = resolve(paths.deliveryRoot, 'test-scenarios.md');
  const transaction = transactionPaths(projectRoot, slug);
  mkdirSync(paths.deliveryRoot, { recursive: true });
  mkdirSync(transaction.root, { recursive: true });
  const nonce = `${process.pid}-${randomUUID()}`;
  const jsonStage = `${jsonPath}.${nonce}.tmp`;
  const markdownStage = `${markdownPath}.${nonce}.tmp`;
  const journal = { schema: 'ewai.test-scenario-transaction/v1', slug, phase: 'staged', jsonStage, markdownStage };
  try {
    writeFileSync(jsonStage, jsonContent, 'utf8');
    writeFileSync(markdownStage, markdownContent, 'utf8');
    writeFileSync(transaction.journal, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
    renameSync(jsonStage, jsonPath);
    journal.phase = 'json-committed';
    writeFileSync(transaction.journal, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
    if (options.failAfterStage === 'json-committed') throw new Error('Test-scenario write was interrupted after JSON commit');
    renameSync(markdownStage, markdownPath);
    journal.phase = 'committed';
    writeFileSync(transaction.journal, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
    rmSync(transaction.journal, { force: true });
  } catch (error) {
    rmSync(jsonStage, { force: true });
    rmSync(markdownStage, { force: true });
    rmSync(jsonPath, { force: true });
    rmSync(markdownPath, { force: true });
    rmSync(transaction.journal, { force: true });
    throw error;
  }
  return { jsonPath, markdownPath };
}

function evidenceFile(root, path, label, maximum = Infinity) {
  let stat;
  try { stat = lstatSync(path); } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || !isWithin(realpathSync(root), realpathSync(path)) || stat.size > maximum) {
    throw new Error(`${label} must be a bounded regular file inside the project`);
  }
  return true;
}

function readRecordedPair(root, paths, slug) {
  const jsonPath = resolve(paths.deliveryRoot, 'test-scenarios.json');
  const markdownPath = resolve(paths.deliveryRoot, 'test-scenarios.md');
  const hasJson = evidenceFile(root, jsonPath, 'Scenario JSON');
  const hasMarkdown = evidenceFile(root, markdownPath, 'Scenario Markdown');
  if (!hasJson && !hasMarkdown) return null;
  if (!hasJson || !hasMarkdown) throw new Error('Existing persona test-scenario evidence is incomplete and will not be overwritten');
  const record = readJson(jsonPath, 'Persona test-scenario evidence');
  if (record.schema !== SCENARIO_SCHEMA || record.slug !== slug) throw new Error('Persona test-scenario JSON schema or slug is invalid');
  if (record.sourceDigestVersion !== undefined && record.sourceDigestVersion !== SOURCE_DIGEST_VERSION) {
    throw new Error('Unsupported persona test-scenario source digest version');
  }
  if (sha256(canonicalJson(recordDigestPayload(record))) !== record.contentDigest) throw new Error('Persona test-scenario content digest does not match');
  if (sha256(readFileSync(markdownPath, 'utf8')) !== record.markdownDigest) throw new Error('Persona test-scenario Markdown digest does not match');
  return record;
}

function readSourceBaseline(root, paths, record) {
  const path = resolve(paths.deliveryRoot, 'test-scenarios.source-baseline.json');
  if (!evidenceFile(root, path, 'Scenario source baseline', 8192)) return null;
  const baseline = readJson(path, 'Scenario source baseline');
  const { digest, ...payload } = baseline;
  const keys = ['schema', 'slug', 'recordDigest', 'legacySourceDigest', 'sourceDigestVersion', 'sourceDigest', 'reviewedBy', 'recordedAt', 'digest'];
  if (Object.keys(baseline).sort().join() !== keys.sort().join()
    || baseline.schema !== BASELINE_SCHEMA || baseline.slug !== record.slug
    || record.sourceDigestVersion !== undefined
    || baseline.recordDigest !== record.contentDigest || baseline.legacySourceDigest !== record.preparedSourceDigest
    || baseline.sourceDigestVersion !== SOURCE_DIGEST_VERSION || !/^[a-f0-9]{64}$/.test(baseline.sourceDigest)
    || baseline.reviewedBy !== record.reviewer || typeof baseline.recordedAt !== 'string' || !Number.isFinite(Date.parse(baseline.recordedAt))
    || digest !== sha256(canonicalJson(payload))) {
    throw new Error('Scenario source baseline is invalid or bound to different accepted evidence');
  }
  return baseline;
}

function writeSourceBaseline(root, paths, record, brief) {
  const path = resolve(paths.deliveryRoot, 'test-scenarios.source-baseline.json');
  const existing = readSourceBaseline(root, paths, record);
  if (existing) {
    if (existing.sourceDigest !== brief.sourceDigest) throw new Error('Scenario source baseline is stale');
    return existing;
  }
  if (!isWithin(realpathSync(root), realpathSync(paths.deliveryRoot))) throw new Error('Scenario source baseline is outside the project');
  const payload = {
    schema: BASELINE_SCHEMA, slug: record.slug, recordDigest: record.contentDigest,
    legacySourceDigest: record.preparedSourceDigest, sourceDigestVersion: SOURCE_DIGEST_VERSION,
    sourceDigest: brief.sourceDigest, reviewedBy: record.reviewer, recordedAt: new Date().toISOString()
  };
  const baseline = { ...payload, digest: sha256(canonicalJson(payload)) };
  const stage = `${path}.${process.pid}-${randomUUID()}.tmp`;
  try {
    writeFileSync(stage, `${JSON.stringify(baseline, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    // A hard-link publish is atomic and cannot overwrite a competing or historical receipt.
    try { linkSync(stage, path); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const concurrent = readSourceBaseline(root, paths, record);
      if (!concurrent || concurrent.sourceDigest !== brief.sourceDigest) throw new Error('Conflicting scenario source baseline');
      return concurrent;
    }
  } finally { rmSync(stage, { force: true }); }
  return baseline;
}

export function recordPersonaTestScenarios(projectRoot, slug, input = {}, options = {}) {
  const root = resolve(projectRoot);
  findIntent(root, slug);
  cleanTransaction(root, slug);
  const reviewer = cleanText(options.reviewedBy ?? input.reviewedBy, 'Named reviewer', 160);
  if (input.sourceDigestVersion !== undefined && input.sourceDigestVersion !== SOURCE_DIGEST_VERSION) {
    throw new Error('Unsupported persona test-scenario source digest version');
  }
  const catalogue = Array.isArray(options.personas) ? options.personas : Array.isArray(options.personaCatalogue) ? options.personaCatalogue : [];
  const prepareOptions = { focus: input.focus ?? options.focus ?? '', personas: catalogue };
  const { legacySourceDigest, ...brief } = prepareBrief(root, slug, prepareOptions);
  const paths = deliveryPaths(root, slug);
  const jsonPath = resolve(paths.deliveryRoot, 'test-scenarios.json');
  const markdownPath = resolve(paths.deliveryRoot, 'test-scenarios.md');
  const existing = readRecordedPair(root, paths, slug);
  if (!existing && evidenceFile(root, resolve(paths.deliveryRoot, 'test-scenarios.source-baseline.json'), 'Scenario source baseline', 8192)) {
    throw new Error('Scenario source baseline has no accepted evidence pair');
  }
  const baseline = existing ? readSourceBaseline(root, paths, existing) : null;
  let validationBrief = brief;
  let validationInput = input;
  if (existing && existing.sourceDigestVersion === undefined) {
    const currentDigest = baseline ? brief.sourceDigest : legacySourceDigest;
    if (currentDigest !== (baseline?.sourceDigest ?? existing.preparedSourceDigest)) {
      throw new Error('Existing accepted scenario sources are stale; legacy evidence cannot be silently rebound');
    }
    if (![existing.preparedSourceDigest, brief.sourceDigest].includes(input.preparedSourceDigest)) {
      throw new Error('Prepared source digest is stale or does not match this intent');
    }
    // Compare the reviewed payload exactly, retaining its historical source and reviewer metadata.
    validationBrief = { ...brief, sourceDigest: existing.preparedSourceDigest, authoritativeSources: existing.sources, contextualEvidence: existing.contextualEvidence };
    delete validationBrief.sourceDigestVersion;
    validationInput = { ...input, preparedSourceDigest: existing.preparedSourceDigest };
  }
  const payload = scenarioPayload(slug, { ...validationBrief, projectRoot: root }, validationInput, reviewer);
  const contentDigest = sha256(canonicalJson(payload));
  if (existing) {
    if (existing.contentDigest === contentDigest) {
      const legacy = existing.sourceDigestVersion === undefined;
      if (legacy) writeSourceBaseline(root, paths, existing, brief);
      return {
        schema: 'ewai.persona-test-recording/v1', status: 'recorded', digest: contentDigest,
        jsonPath: relativePath(root, jsonPath), markdownPath: relativePath(root, markdownPath), idempotent: true,
        ...(legacy ? { sourceBaselinePath: relativePath(root, resolve(paths.deliveryRoot, 'test-scenarios.source-baseline.json')) } : {})
      };
    }
    throw new Error('Conflicting accepted persona test-scenario evidence already exists and will not be overwritten');
  }
  const record = { ...payload, reviewedAt: options.now ?? new Date().toISOString(), contentDigest };
  const markdown = renderMarkdown(record);
  record.markdownDigest = sha256(markdown);
  const json = `${JSON.stringify(record, null, 2)}\n`;
  writePair(root, slug, json, markdown, options);
  return { schema: 'ewai.persona-test-recording/v1', status: 'recorded', digest: contentDigest, jsonPath: relativePath(root, jsonPath), markdownPath: relativePath(root, markdownPath), idempotent: false };
}

function safeWorkspaceRecord(record, status, reason = '') {
  return {
    schema: WORKSPACE_SCHEMA,
    slug: record.slug,
    status,
    reason,
    reviewer: record.reviewer,
    reviewedAt: record.reviewedAt,
    digest: record.contentDigest,
    preparedSourceDigest: record.preparedSourceDigest,
    sources: record.sources,
    contextualEvidence: record.contextualEvidence,
    activePersonas: record.activePersonas,
    availability: record.availability,
    scenarios: record.scenarios,
    gaps: record.gaps,
    evidenceRoutes: [...new Set(record.scenarios.map(({ evidenceRoute }) => evidenceRoute))],
    guidance: { advisory: true, humanEvidenceTakesPriority: true, approvalsChanged: false, readOnly: true }
  };
}

export function readPersonaTestScenarioWorkspace(projectRoot, slug, options = {}) {
  const root = resolve(projectRoot);
  const safeSlug = cleanText(slug, 'Intent slug', 100);
  // Validate the intent before recovery so a malformed or arbitrary slug cannot create a phantom workspace.
  findIntent(root, safeSlug);
  try {
    cleanTransaction(root, safeSlug);
  } catch (error) {
    return {
      schema: WORKSPACE_SCHEMA,
      slug: safeSlug,
      status: 'invalid',
      reason: error.message,
      activePersonas: [], sources: [], contextualEvidence: [], scenarios: [], gaps: [], evidenceRoutes: [],
      guidance: { advisory: true, humanEvidenceTakesPriority: true, approvalsChanged: false, readOnly: true }
    };
  }
  const paths = deliveryPaths(root, safeSlug);
  const jsonPath = resolve(paths.deliveryRoot, 'test-scenarios.json');
  const markdownPath = resolve(paths.deliveryRoot, 'test-scenarios.md');
  if (!existsSync(jsonPath) && !existsSync(markdownPath)) {
    const catalogue = Array.isArray(options.personas) ? options.personas : Array.isArray(options.personaCatalogue) ? options.personaCatalogue : [];
    return {
      schema: WORKSPACE_SCHEMA,
      slug: safeSlug,
      status: 'missing',
      reason: 'No reviewed persona test-scenario pack has been recorded.',
      activePersonas: [],
      availability: personaAvailability(catalogue),
      sources: [], contextualEvidence: [], scenarios: [], gaps: [], evidenceRoutes: [],
      nextAction: `ewai test-scenarios prepare ${safeSlug} --project .`,
      guidance: { advisory: true, humanEvidenceTakesPriority: true, approvalsChanged: false, readOnly: true }
    };
  }
  if (!existsSync(jsonPath) || !existsSync(markdownPath)) {
    return { schema: WORKSPACE_SCHEMA, slug: safeSlug, status: 'invalid', reason: 'The paired persona test-scenario evidence is incomplete.', activePersonas: [], sources: [], scenarios: [], gaps: [], evidenceRoutes: [], guidance: { readOnly: true } };
  }
  let record;
  try {
    record = readRecordedPair(root, paths, safeSlug);
  } catch (error) {
    return { schema: WORKSPACE_SCHEMA, slug: safeSlug, status: 'invalid', reason: error.message, activePersonas: [], sources: [], scenarios: [], gaps: [], evidenceRoutes: [], guidance: { readOnly: true } };
  }
  const catalogue = Array.isArray(options.personas) ? options.personas : Array.isArray(options.personaCatalogue) ? options.personaCatalogue : [];
  let current;
  let expectedDigest = record.preparedSourceDigest;
  try {
    const baseline = readSourceBaseline(root, paths, record);
    current = prepareBrief(root, safeSlug, { focus: record.focus, personas: catalogue },
      record.sourceDigestVersion ?? (baseline ? SOURCE_DIGEST_VERSION : null));
    expectedDigest = baseline?.sourceDigest ?? expectedDigest;
  } catch (error) {
    return safeWorkspaceRecord(record, 'invalid', `Current authoritative sources cannot be read: ${error.message}`);
  }
  if (current.sourceDigest !== expectedDigest) {
    return safeWorkspaceRecord(record, 'stale', 'Authoritative source evidence changed after this pack was reviewed. Prepare and review it again.');
  }
  return safeWorkspaceRecord(record, 'recorded');
}
