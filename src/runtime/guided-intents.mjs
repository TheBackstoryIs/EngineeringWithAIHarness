import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { atomicJson } from '../delivery-documents.mjs';
import {
  createIntent,
  intentRelationshipTypes,
  listDraftIntentsForReconciliation,
  readDraftIntentForReconciliation,
  replaceDraftIntent,
} from '../intents.mjs';
import { loadProjectConfig } from '../project.mjs';
import { selectContextualPersonas } from './persona-engagement.mjs';
import { runtimePaths } from './paths.mjs';

const DRAFT_SCHEMA = 'ewai.guided-intent-draft/v1';
const RESPONSE_SCHEMA = 'ewai.guided-intent/v1';
const MAX_FIELD_LENGTH = 8_000;
const MAX_DRAFT_BYTES = 100_000;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const referencePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

const sections = Object.freeze([
  {
    id: 'identity', title: 'Identity', short: 'Name the intent',
    question: 'What should this piece of work be called, and where does it belong?',
    help: 'Choose a stable domain and lower-kebab-case slug. These form the permanent intent reference.',
    perspectiveSignals: ['intent identity', 'project', 'product', 'outcomes', 'naming'],
    fields: ['domain', 'slug', 'title'],
  },
  {
    id: 'problem', title: 'Problem', short: 'Describe the present difficulty',
    question: 'What observable problem are we trying to change?',
    help: 'Describe the current situation and its consequence without jumping straight to a solution.',
    perspectiveSignals: ['problem', 'users', 'evidence', 'product', 'service'],
    fields: ['details.problem'],
  },
  {
    id: 'outcome', title: 'Outcome', short: 'Define a useful result',
    question: 'What should become true for the people or organisation involved?',
    help: 'State an outcome that can be reviewed independently of a preferred implementation.',
    perspectiveSignals: ['outcomes', 'product', 'value', 'users', 'acceptance'],
    fields: ['details.desiredOutcome'],
  },
  {
    id: 'users', title: 'Users', short: 'Name the affected people',
    question: 'Who experiences the problem, the change, or its operational consequences?',
    help: 'Use real roles or groups. A persona is a lens for questions, not evidence that a real stakeholder agrees.',
    perspectiveSignals: ['users', 'personas', 'accessibility', 'stakeholders', 'service-design'],
    fields: ['details.users'],
  },
  {
    id: 'journeys', title: 'Journeys', short: 'Walk through the experience',
    question: 'What are the important happy, alternate, error, and recovery paths?',
    help: 'Describe the sequence from the participant’s point of view, including hand-offs where they matter.',
    perspectiveSignals: ['journeys', 'users', 'service-design', 'operations', 'recovery'],
    fields: ['details.journeys'],
  },
  {
    id: 'acceptance', title: 'Acceptance', short: 'Make success observable',
    question: 'What must be demonstrably true before this intent can be accepted?',
    help: 'Use observable outcomes. Keep automated proof, Manual QA and representative-user evidence distinct.',
    perspectiveSignals: ['acceptance', 'testing', 'outcomes', 'evidence', 'product'],
    fields: ['details.acceptanceCriteria'],
  },
  {
    id: 'constraints', title: 'Constraints', short: 'Protect the boundaries',
    question: 'What technical, operational, legal, data, security, accessibility, or delivery limits apply?',
    help: 'Record real boundaries and non-goals. A persona may expose a question but cannot invent an obligation.',
    perspectiveSignals: ['constraints', 'dependencies', 'testing', 'operations', 'recovery', 'security', 'accessibility'],
    fields: ['details.constraints'],
  },
  {
    id: 'relationships', title: 'Relationships', short: 'Connect related intents',
    question: 'Which existing intents constrain, enable, complement, conflict with, or supersede this one?',
    help: 'Use exact domain/slug references and explain why the connection affects delivery.',
    perspectiveSignals: ['dependencies', 'architecture', 'delivery', 'project', 'planning'],
    fields: ['relationships'],
  },
  {
    id: 'delivery-shape', title: 'Delivery shape', short: 'Keep one or split',
    question: 'Is this one coherent delivery or should it be split into independently valuable child intents?',
    help: 'Record the recommendation, rationale, blocking questions and an explicit reviewed decision.',
    perspectiveSignals: ['delivery', 'architecture', 'planning', 'dependencies', 'outcomes'],
    fields: ['deliveryShape'],
  },
  {
    id: 'evidence', title: 'Evidence', short: 'Separate known from assumed',
    question: 'What evidence supports the problem, outcome, journeys, constraints and acceptance?',
    help: 'Name observed evidence and accountable decisions. Label persona and model suggestions as hypotheses.',
    perspectiveSignals: ['evidence', 'research', 'decisions', 'knowledge', 'assurance'],
    fields: ['details.evidence'],
  },
  {
    id: 'open-decisions', title: 'Open decisions', short: 'Keep uncertainty visible',
    question: 'What still needs a named human decision, specialist review, or representative-user evidence?',
    help: 'Do not hide unresolved questions to make the draft appear complete.',
    perspectiveSignals: ['decisions', 'evidence', 'risk', 'assurance', 'product'],
    fields: ['details.openDecisions'],
  },
  {
    id: 'review', title: 'Review', short: 'Preview and approve intent truth',
    question: 'Is the current revision ready to become canonical intent truth?',
    help: 'Review blockers, changes, active lenses and exact destinations. Intent approval grants no Build or release permission.',
    perspectiveSignals: ['intent-review', 'acceptance', 'evidence', 'delivery-review', 'product'],
    fields: [],
  },
]);

function failure(message, statusCode = 409) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function cleanText(value, label, maxLength = MAX_FIELD_LENGTH) {
  const text = String(value ?? '').trim();
  if (text.length > maxLength) throw failure(`${label} exceeds ${maxLength} characters`, 400);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw failure(`${label} contains unsafe control characters`, 400);
  return text;
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure(`${label} must be an object`, 400);
  return value;
}

function assertKnownFields(value, fields, label) {
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) throw failure(`${label} contains unknown field: ${key}`, 400);
  }
}

function textValue(value, label) {
  if (Array.isArray(value)) {
    if (value.length > 100) throw failure(`${label} exceeds 100 items`, 400);
    return value.map((item, index) => cleanText(item, `${label} item ${index + 1}`)).filter(Boolean);
  }
  return cleanText(value, label);
}

function textPresent(value) {
  return Array.isArray(value) ? value.some((item) => String(item).trim()) : Boolean(String(value ?? '').trim());
}

function normalisePersonaAttachment(value, index) {
  const input = assertObject(value, `Persona attachment ${index + 1}`);
  assertKnownFields(input, ['ref', 'role', 'depth'], `Persona attachment ${index + 1}`);
  const ref = cleanText(input.ref, `Persona attachment ${index + 1} ref`, 160);
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(ref)) throw failure(`Invalid persona reference: ${ref}`, 400);
  const role = cleanText(input.role || 'reviewer', `Persona attachment ${index + 1} role`, 80);
  if (!slugPattern.test(role)) throw failure(`Invalid persona role: ${role}`, 400);
  const depth = Number(input.depth ?? 3);
  if (!Number.isInteger(depth) || depth < 1 || depth > 5) throw failure('Persona depth must be an integer from 1 to 5', 400);
  return { ref, role, depth };
}

function normaliseRelationship(value, index) {
  const input = assertObject(value, `Relationship ${index + 1}`);
  assertKnownFields(input, ['type', 'target', 'rationale', 'required_before', 'required_state', 'requiredBefore', 'requiredState'], `Relationship ${index + 1}`);
  const type = cleanText(input.type, `Relationship ${index + 1} type`, 80);
  if (!intentRelationshipTypes.includes(type)) throw failure(`Intent relationship type must be one of: ${intentRelationshipTypes.join(', ')}`, 400);
  const target = cleanText(input.target, `Relationship ${index + 1} target`, 200);
  if (!referencePattern.test(target)) throw failure(`Intent relationship target must be an exact domain/slug reference: ${target}`, 400);
  const rationale = cleanText(input.rationale, `Relationship ${index + 1} rationale`);
  const requiredBefore = cleanText(input.required_before ?? input.requiredBefore, `Relationship ${index + 1} required before`, 40);
  const requiredState = cleanText(input.required_state ?? input.requiredState, `Relationship ${index + 1} required state`, 40);
  if ((requiredBefore || requiredState) && type !== 'depends-on') throw failure('required_before and required_state apply only to depends-on relationships', 400);
  if (requiredBefore && !['build', 'delivery'].includes(requiredBefore)) throw failure('depends-on required_before must be build or delivery', 400);
  if (requiredState && !['plan-complete', 'delivered'].includes(requiredState)) throw failure('depends-on required_state must be plan-complete or delivered', 400);
  return {
    type,
    target,
    ...(rationale ? { rationale } : {}),
    ...(type === 'depends-on' ? { required_before: requiredBefore || 'delivery', required_state: requiredState || 'delivered' } : {}),
  };
}

function normaliseDeliveryShape(value) {
  if (value == null) return null;
  const input = assertObject(value, 'Delivery shape');
  assertKnownFields(input, ['recommendation', 'reason', 'suggestedChildren', 'suggested_children', 'blockingQuestions', 'blocking_questions', 'reviewedDecision', 'reviewed_decision'], 'Delivery shape');
  const recommendation = cleanText(input.recommendation, 'Delivery-shape recommendation', 40);
  if (recommendation && !['single', 'split', 'decision-required'].includes(recommendation)) throw failure('Delivery-shape recommendation must be single, split, or decision-required', 400);
  const reviewedDecision = cleanText(input.reviewedDecision ?? input.reviewed_decision, 'Delivery-shape reviewed decision', 40);
  if (reviewedDecision && !['keep-as-one', 'split', 'refine-split', 'defer'].includes(reviewedDecision)) throw failure('Delivery-shape reviewed decision is invalid', 400);
  const children = input.suggestedChildren ?? input.suggested_children ?? [];
  if (!Array.isArray(children) || children.length > 20) throw failure('Delivery shape supports no more than 20 suggested child intents', 400);
  const suggestedChildren = children.map((child, index) => {
    const item = assertObject(child, `Suggested child ${index + 1}`);
    const domain = cleanText(item.domain, `Suggested child ${index + 1} domain`, 80);
    const slug = cleanText(item.slug, `Suggested child ${index + 1} slug`, 120);
    if (domain && !slugPattern.test(domain)) throw failure(`Suggested child domain must be lower kebab-case: ${domain}`, 400);
    if (slug && !slugPattern.test(slug)) throw failure(`Suggested child slug must be lower kebab-case: ${slug}`, 400);
    return {
      ...(domain ? { domain } : {}),
      ...(slug ? { slug } : {}),
      ...(cleanText(item.title, `Suggested child ${index + 1} title`, 240) ? { title: cleanText(item.title, `Suggested child ${index + 1} title`, 240) } : {}),
      outcome: cleanText(item.outcome, `Suggested child ${index + 1} outcome`),
      ...(Array.isArray(item.depends_on ?? item.dependsOn) ? { depends_on: (item.depends_on ?? item.dependsOn).map((entry) => cleanText(entry, `Suggested child ${index + 1} dependency`, 200)).filter(Boolean) } : {}),
    };
  });
  const questions = input.blockingQuestions ?? input.blocking_questions ?? [];
  if (!Array.isArray(questions) || questions.length > 50) throw failure('Delivery shape supports no more than 50 blocking questions', 400);
  return {
    recommendation,
    reason: cleanText(input.reason, 'Delivery-shape reason'),
    suggestedChildren,
    blockingQuestions: questions.map((question, index) => cleanText(question, `Blocking question ${index + 1}`)).filter(Boolean),
    reviewedDecision: reviewedDecision || null,
  };
}

function emptyIntent() {
  return {
    domain: 'experience', slug: '', title: '', intentMap: null, personas: [], relationships: [], deliveryShape: null,
    details: { problem: '', desiredOutcome: '', users: [], journeys: [], acceptanceCriteria: [], constraints: [], evidence: [], openDecisions: [] },
  };
}

function normaliseIntent(value, { lockedIdentity = null, lockedRelationships = null } = {}) {
  const input = assertObject(value, 'Guided intent');
  assertKnownFields(input, ['domain', 'slug', 'title', 'intentMap', 'personas', 'relationships', 'deliveryShape', 'details'], 'Guided intent');
  const domain = cleanText(input.domain, 'Intent domain', 80);
  const slug = cleanText(input.slug, 'Intent slug', 120);
  if (domain && !slugPattern.test(domain)) throw failure(`Intent domain must be lower kebab-case: ${domain}`, 400);
  if (slug && !slugPattern.test(slug)) throw failure(`Intent slug must be lower kebab-case: ${slug}`, 400);
  if (lockedIdentity && (domain !== lockedIdentity.domain || slug !== lockedIdentity.slug)) throw failure('Intent identity cannot change during reconciliation', 400);
  const details = assertObject(input.details ?? {}, 'Intent details');
  assertKnownFields(details, ['problem', 'desiredOutcome', 'users', 'journeys', 'acceptanceCriteria', 'constraints', 'evidence', 'openDecisions'], 'Intent details');
  const relationships = input.relationships ?? [];
  if (!Array.isArray(relationships) || relationships.length > 50) throw failure('Intent supports no more than 50 relationships', 400);
  const normalisedRelationships = relationships.map(normaliseRelationship);
  if (lockedRelationships && JSON.stringify(normalisedRelationships) !== JSON.stringify(lockedRelationships)) throw failure('Intent relationships cannot change during reconciliation', 400);
  const personas = input.personas ?? [];
  if (!Array.isArray(personas) || personas.length > 50) throw failure('Intent supports no more than 50 persona attachments', 400);
  const result = {
    domain,
    slug,
    title: cleanText(input.title, 'Intent title', 240),
    intentMap: input.intentMap ? cleanText(input.intentMap, 'Intent map', 120) : null,
    personas: personas.map(normalisePersonaAttachment),
    relationships: normalisedRelationships,
    deliveryShape: normaliseDeliveryShape(input.deliveryShape),
    details: {
      problem: textValue(details.problem, 'Problem'),
      desiredOutcome: textValue(details.desiredOutcome, 'Desired outcome'),
      users: textValue(details.users, 'Users'),
      journeys: textValue(details.journeys, 'Journeys'),
      acceptanceCriteria: textValue(details.acceptanceCriteria, 'Acceptance criteria'),
      constraints: textValue(details.constraints, 'Constraints'),
      evidence: textValue(details.evidence, 'Evidence'),
      openDecisions: textValue(details.openDecisions, 'Open decisions'),
    },
  };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_DRAFT_BYTES) throw failure('Guided intent draft exceeds 100000 bytes', 413);
  return result;
}

function projectRelativeDestinations(projectRoot, intent) {
  const { paths } = loadProjectConfig(projectRoot);
  const base = relative(paths.projectRoot, resolve(paths.specsRoot, '2.Purpose/intents', intent.domain, intent.slug)).replaceAll('\\', '/');
  return [`${base}.md`, `${base}.json`];
}

function anySlugCollision(root, slug, targetReference) {
  const { paths } = loadProjectConfig(root);
  const intentsRoot = resolve(paths.specsRoot, '2.Purpose/intents');
  if (!existsSync(intentsRoot) || !slug) return null;
  const pending = [intentsRoot];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name === `${slug}.json`) {
        try {
          const state = JSON.parse(readFileSync(path, 'utf8'));
          const reference = `${state.domain}/${state.slug}`;
          if (reference !== targetReference) return reference;
        } catch {
          return relative(paths.projectRoot, path).replaceAll('\\', '/');
        }
      }
    }
  }
  return null;
}

function validationFor(projectRoot, draft) {
  const errors = [];
  const require = (path, value, label) => { if (!textPresent(value)) errors.push({ path, message: `${label} is required` }); };
  const intent = draft.intent;
  require('domain', intent.domain, 'Intent domain');
  require('slug', intent.slug, 'Intent slug');
  require('title', intent.title, 'Intent title');
  require('details.problem', intent.details.problem, 'Problem');
  require('details.desiredOutcome', intent.details.desiredOutcome, 'Desired outcome');
  require('details.users', intent.details.users, 'Users');
  require('details.journeys', intent.details.journeys, 'Journeys');
  require('details.acceptanceCriteria', intent.details.acceptanceCriteria, 'Acceptance criteria');
  require('details.constraints', intent.details.constraints, 'Constraints');
  require('details.evidence', intent.details.evidence, 'Evidence');
  require('deliveryShape.recommendation', intent.deliveryShape?.recommendation, 'Delivery-shape recommendation');
  require('deliveryShape.reason', intent.deliveryShape?.reason, 'Delivery-shape reason');
  require('deliveryShape.reviewedDecision', intent.deliveryShape?.reviewedDecision, 'Reviewed delivery-shape decision');
  if (draft.mode === 'create' && intent.domain && intent.slug) {
    const collision = anySlugCollision(projectRoot, intent.slug, `${intent.domain}/${intent.slug}`);
    const exact = projectRelativeDestinations(projectRoot, intent).some((path) => existsSync(resolve(projectRoot, path)));
    if (collision || exact) errors.push({ path: 'slug', message: `Intent already exists${collision ? ` at ${collision}` : ''}` });
  }
  if (draft.mode === 'reconcile') {
    try {
      const current = readDraftIntentForReconciliation(projectRoot, draft.sourceReference);
      if (current.sourceUpdatedAt !== draft.sourceUpdatedAt) errors.push({ path: 'sourceReference', message: 'A newer canonical intent revision exists' });
    } catch (error) {
      errors.push({ path: 'sourceReference', message: error.message });
    }
  }
  return { valid: errors.length === 0, errors };
}

function comparable(value) {
  return JSON.stringify(value ?? null);
}

function changesFor(draft) {
  if (draft.mode !== 'reconcile' || !draft.originalIntent) return [];
  const changes = [];
  for (const key of ['title', 'personas', 'deliveryShape']) {
    if (comparable(draft.originalIntent[key]) !== comparable(draft.intent[key])) changes.push({ section: key, before: draft.originalIntent[key], after: draft.intent[key] });
  }
  for (const key of Object.keys(draft.intent.details)) {
    if (comparable(draft.originalIntent.details[key]) !== comparable(draft.intent.details[key])) changes.push({ section: key, before: draft.originalIntent.details[key], after: draft.intent.details[key] });
  }
  return changes;
}

function sectionById(sectionId) {
  const section = sections.find((candidate) => candidate.id === sectionId);
  if (!section) throw failure(`Unknown intent section: ${sectionId}`, 400);
  return section;
}

export function intentSectionContract() {
  return { schema: 'ewai.guided-intent-sections/v1', sections: structuredClone(sections) };
}

export function selectIntentPersonas(sectionId, personaCatalogue = [], intent = {}) {
  const section = sectionById(sectionId);
  return selectContextualPersonas({
    contextLabel: `${section.title} intent section`,
    signals: section.perspectiveSignals,
    context: intent,
    personaCatalogue,
    limit: 4,
  });
}

function initialDraft() {
  return { schema: DRAFT_SCHEMA, revision: 0, mode: 'create', currentSection: 'identity', sourceReference: null, sourceUpdatedAt: null, originalIntent: null, intent: emptyIntent(), createdAt: null, updatedAt: null };
}

function readDraft(projectRoot) {
  const path = runtimePaths(projectRoot).guidedIntentDraftPath;
  if (!existsSync(path)) return initialDraft();
  let draft;
  try { draft = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { throw failure(`Guided intent draft is not valid JSON: ${error.message}`); }
  if (draft.schema !== DRAFT_SCHEMA || !Number.isInteger(draft.revision) || draft.revision < 1 || !['create', 'reconcile'].includes(draft.mode)) {
    throw failure('Guided intent draft has an unsupported schema revision or mode');
  }
  sectionById(draft.currentSection);
  return draft;
}

function availability(catalogue) {
  const result = {};
  for (const tier of ['core', 'premium', 'personal', 'project']) {
    const count = catalogue.filter((persona) => persona.tier === tier).length;
    result[tier] = { installed: count > 0, count, reason: count ? `${count} installed ${tier} persona${count === 1 ? '' : 's'} available.` : `No installed ${tier} personas were found.` };
  }
  return result;
}

function response(projectRoot, draft, options = {}) {
  const catalogue = Array.isArray(options.personas) ? options.personas : [];
  const activePersonas = selectIntentPersonas(draft.currentSection, catalogue, draft.intent);
  const validation = validationFor(projectRoot, draft);
  const destinations = draft.intent.domain && draft.intent.slug ? projectRelativeDestinations(projectRoot, draft.intent) : [];
  return {
    schema: RESPONSE_SCHEMA,
    sections: structuredClone(sections),
    draft,
    validation,
    preview: {
      operation: draft.mode,
      destinations,
      missingSections: validation.errors.map(({ path, message }) => ({ path, message })),
      changes: changesFor(draft),
      authority: { createsIntentTruthOnly: true, buildApproved: false, manualQaApproved: false, releaseApproved: false },
    },
    eligibleIntents: listDraftIntentsForReconciliation(projectRoot),
    activePersonas,
    personaAvailability: availability(catalogue),
    baseline: {
      completeWithoutPremium: true,
      description: 'Standard host-model questions provide the complete authoring and review baseline. Installed personas add contextual lenses.',
    },
    guidance: {
      advisory: true,
      personasAreEvidence: false,
      section: draft.currentSection,
      baselineQuestions: [sectionById(draft.currentSection).question, sectionById(draft.currentSection).help],
      prompts: activePersonas.map((persona) => ({ personaId: persona.id, text: persona.engagementReason, classification: 'advisory-hypothesis' })),
    },
  };
}

export function readGuidedIntent(projectRoot, options = {}) {
  return response(projectRoot, readDraft(projectRoot), options);
}

export function saveGuidedIntentDraft(projectRoot, input = {}, options = {}) {
  const current = readDraft(projectRoot);
  const expectedRevision = Number(input.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision) throw failure(`A newer revision of this guided intent draft exists (current revision ${current.revision})`);
  const mode = cleanText(input.mode || current.mode, 'Guided intent mode', 20);
  if (!['create', 'reconcile'].includes(mode)) throw failure('Guided intent mode must be create or reconcile', 400);
  const currentSection = cleanText(input.currentSection || current.currentSection, 'Current intent section', 80);
  sectionById(currentSection);
  let sourceReference = null;
  let sourceUpdatedAt = null;
  let originalIntent = null;
  let proposed = input.intent;
  if (mode === 'reconcile') {
    sourceReference = cleanText(input.sourceReference || current.sourceReference, 'Source intent reference', 200);
    if (!referencePattern.test(sourceReference)) throw failure('Reconciliation requires an exact domain/slug source reference', 400);
    const imported = current.mode === 'reconcile' && current.sourceReference === sourceReference && current.originalIntent
      ? { sourceUpdatedAt: current.sourceUpdatedAt, intent: current.originalIntent }
      : readDraftIntentForReconciliation(projectRoot, sourceReference);
    sourceUpdatedAt = imported.sourceUpdatedAt;
    originalIntent = normaliseIntent(imported.intent);
    proposed = proposed ?? originalIntent;
  } else if (!proposed) {
    proposed = current.mode === 'create' ? current.intent : emptyIntent();
  }
  const intent = normaliseIntent(proposed, {
    ...(originalIntent ? { lockedIdentity: originalIntent, lockedRelationships: originalIntent.relationships } : {}),
  });
  const timestamp = options.now ?? new Date().toISOString();
  const draft = {
    schema: DRAFT_SCHEMA,
    revision: current.revision + 1,
    mode,
    currentSection,
    sourceReference,
    sourceUpdatedAt,
    originalIntent,
    intent,
    createdAt: current.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  atomicJson(runtimePaths(projectRoot).guidedIntentDraftPath, draft);
  return response(projectRoot, draft, options);
}

export function discardGuidedIntentDraft(projectRoot, input = {}) {
  if (input.confirmed !== true) throw failure('Discarding a guided intent draft requires explicit confirmation');
  const current = readDraft(projectRoot);
  const expectedRevision = Number(input.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision) throw failure(`A newer revision of this guided intent draft exists (current revision ${current.revision})`);
  rmSync(runtimePaths(projectRoot).guidedIntentDraftPath, { force: true });
  return { schema: 'ewai.guided-intent-discard/v1', status: 'discarded', revision: current.revision };
}

export function approveGuidedIntent(projectRoot, input = {}, options = {}) {
  if (input.confirmed !== true) throw failure('Canonical intent creation requires explicit confirmation');
  const approvedBy = cleanText(input.approvedBy, 'Approver name', 160);
  if (!approvedBy) throw failure('Canonical intent creation requires an accountable approver name');
  const draft = readDraft(projectRoot);
  const expectedRevision = Number(input.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision !== draft.revision) throw failure(`A newer revision of this guided intent draft exists (current revision ${draft.revision})`);
  const validation = validationFor(projectRoot, draft);
  if (!validation.valid) throw failure(`The current guided intent draft is incomplete or invalid: ${validation.errors[0].message}`);
  const approvedAt = options.now ?? new Date().toISOString();
  let created;
  if (draft.mode === 'reconcile') {
    const replace = options.replace ?? replaceDraftIntent;
    created = replace(projectRoot, draft.sourceReference, { expectedUpdatedAt: draft.sourceUpdatedAt, intent: draft.intent, now: approvedAt });
  } else {
    const create = options.create ?? createIntent;
    const result = create(projectRoot, {
      slug: draft.intent.slug,
      domain: draft.intent.domain,
      title: draft.intent.title,
      intentMap: draft.intent.intentMap,
      personas: draft.intent.personas,
      relationships: draft.intent.relationships,
      deliveryShape: draft.intent.deliveryShape,
      details: draft.intent.details,
    });
    created = {
      reference: `${result.domain}/${result.slug}`,
      markdownPath: relative(resolve(projectRoot), result.path).replaceAll('\\', '/'),
      jsonPath: relative(resolve(projectRoot), String(result.path).replace(/\.md$/i, '.json')).replaceAll('\\', '/'),
    };
  }
  rmSync(runtimePaths(projectRoot).guidedIntentDraftPath, { force: true });
  return {
    schema: 'ewai.guided-intent-approval/v1',
    status: 'completed',
    mode: draft.mode,
    approval: { approvedBy, approvedAt, revision: draft.revision },
    created,
    authority: { intentApproved: true, buildApproved: false, manualQaApproved: false, certificationGranted: false, releaseApproved: false },
  };
}
