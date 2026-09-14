import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { readDeliveryState } from '../delivery.mjs';
import { atomicJson, isWithin } from '../delivery-documents.mjs';
import { deriveExecutionState } from '../execution-state.mjs';
import { loadProjectConfig } from '../project.mjs';
import { listRuntimeIntents, readRuntimeIntent } from './intents.mjs';
import { selectContextualPersonas } from './persona-engagement.mjs';
import { queueDashboardHandoff } from './dashboard-handoffs.mjs';
import { runtimePaths } from './paths.mjs';

const DRAFT_SCHEMA = 'ewai.phase-contribution-draft/v1';
const RESPONSE_SCHEMA = 'ewai.phase-studio/v1';
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const digestPattern = /^[a-f0-9]{64}$/;
const MAX_TEXT = 8_000;
const MAX_NAME = 160;
const MAX_ITEMS = 50;
const MAX_DRAFT_BYTES = 160_000;
const terminalStatuses = new Set(['completed', 'approved', 'skipped', 'not-supported', 'waived']);
const contexts = Object.freeze({
  business: {
    id: 'business', title: 'Business-facing owner', ownerKey: 'business',
    responsibility: 'Contribute outcomes, stakeholder needs, trade-offs, acceptance expectations, communications and named business decisions.',
    priorities: ['outcomes', 'stakeholders', 'trade-offs', 'acceptance', 'communications', 'business decisions'],
    questions: ['What outcome must this phase protect?', 'Who accepts the operational consequence?', 'Which trade-off still needs a named decision?'],
    actions: ['save business evidence', 'request technical input', 'record a named decision', 'prepare an owner hand-off'],
  },
  technical: {
    id: 'technical', title: 'Technical owner', ownerKey: 'technical',
    responsibility: 'Contribute repository evidence, constraints, dependencies, standards, architecture, testing, operations and recovery needs.',
    priorities: ['repository evidence', 'constraints', 'dependencies', 'standards', 'architecture', 'testing', 'operations', 'recovery'],
    questions: ['What repository evidence supports this claim?', 'Which dependency or standard constrains the change?', 'How will failure and recovery be tested?'],
    actions: ['save technical evidence', 'identify a conflict', 'request a business decision', 'prepare an owner hand-off'],
  },
  'shared-review': {
    id: 'shared-review', title: 'Shared review', ownerKey: 'sharedReview',
    responsibility: 'Review both owner perspectives together, preserve disagreement, and record named resolutions or deliberately unresolved items.',
    priorities: ['attribution', 'conflicts', 'decisions', 'unresolved questions', 'limitations', 'acceptance'],
    questions: ['Where do the owner perspectives disagree?', 'Which evidence class and source supports each position?', 'Who owns each unresolved decision?'],
    actions: ['record a shared resolution', 'return an item to a named owner', 'request advisory host review', 'confirm contribution evidence'],
  },
});

const phaseProfiles = Object.freeze({
  reconcile: profile('reconcile', 'Reconcile', [
    topic('observable-behaviour', 'Observable behaviour', 'What does the existing system demonstrably do?'),
    topic('outcomes', 'Protected outcomes', 'Which outcomes must reconciliation preserve?'),
    topic('repository-evidence', 'Repository evidence', 'Which source and history evidence explains the current shape?'),
    topic('constraints', 'Inherited constraints', 'Which constraints are observed, asserted or still uncertain?'),
    topic('decisions', 'Unresolved history', 'Which historical decision needs confirmation?'),
  ], ['reconciliation', 'observable behaviour', 'repository evidence', 'history', 'constraints', 'decisions']),
  plan: profile('plan', 'Plan', [
    topic('outcomes', 'Outcomes', 'What useful result must the implementation protect?'),
    topic('scope', 'Scope and boundaries', 'What is included, excluded and deliberately deferred?'),
    topic('dependencies', 'Dependencies', 'Which business and technical dependencies shape delivery?'),
    topic('trade-offs', 'Trade-offs', 'Which compromise needs visible owner judgement?'),
    topic('acceptance', 'Acceptance', 'What evidence will demonstrate the outcome?'),
    topic('decisions', 'Decisions and questions', 'What remains owned, decided or unresolved?'),
  ], ['planning', 'outcomes', 'dependencies', 'trade-offs', 'acceptance', 'decisions']),
  'test-plan': profile('test-plan', 'Test Plan', [
    topic('journeys', 'Journeys and scenarios', 'Which happy, alternate, failure and recovery paths matter?'),
    topic('acceptance', 'Evidence oracles', 'What observable result proves or disproves each claim?'),
    topic('environments', 'Environments and data', 'Which environments, devices and data conditions are required?'),
    topic('testing', 'Technical coverage', 'Which automated and manual checks are proportionate?'),
    topic('recovery', 'Failure and recovery', 'How will recovery and degraded behaviour be examined?'),
    topic('decisions', 'Acceptance ownership', 'Who reviews each evidence route?'),
  ], ['test plan', 'journeys', 'acceptance', 'testing', 'environments', 'recovery']),
  'delivery-preparation': profile('delivery-preparation', 'Delivery preparation', [
    topic('readiness', 'Readiness', 'What is ready and what remains explicitly incomplete?'),
    topic('operations', 'Operations', 'Who operates, supports and observes the change?'),
    topic('communications', 'Communications', 'Who needs to understand the change and when?'),
    topic('recovery', 'Recovery', 'What rollback or recovery route is available?'),
    topic('acceptance', 'Acceptance evidence', 'Which evidence is ready for accountable review?'),
    topic('decisions', 'Residual decisions', 'Which risk, limitation or decision remains named?'),
  ], ['delivery', 'readiness', 'operations', 'communications', 'recovery', 'acceptance']),
  'manual-qa-preparation': profile('manual-qa-preparation', 'Manual QA preparation', [
    topic('journeys', 'Representative journeys', 'Which participant journeys need human examination?'),
    topic('environments', 'Devices and environments', 'Where must the experience be exercised?'),
    topic('accessibility', 'Accessibility', 'Which keyboard, focus, announcement and responsive behaviours need review?'),
    topic('observations', 'Observations', 'What should the reviewer record rather than infer?'),
    topic('limitations', 'Known limitations', 'Which limitations must remain visible during acceptance?'),
    topic('acceptance', 'Named acceptance', 'Who may accept the Manual QA evidence?'),
  ], ['manual QA', 'journeys', 'accessibility', 'observations', 'limitations', 'acceptance']),
});

const phaseToProfile = Object.freeze({
  reconcile: 'reconcile', plan: 'plan', 'test-plan': 'test-plan', delivery: 'delivery-preparation', 'manual-qa': 'manual-qa-preparation',
});
const evidenceClasses = new Set(['repository-fact', 'participant-statement', 'imported-source', 'persona-hypothesis', 'named-decision', 'unresolved-question']);

function topic(id, title, question) {
  return { id, title, question };
}

function profile(id, title, topics, signals) {
  return { id, title, topics, signals };
}

function failure(message, statusCode = 409) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function hash(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function cleanText(value, label, maxLength = MAX_TEXT) {
  const text = String(value ?? '').trim();
  if (text.length > maxLength) throw failure(`${label} exceeds ${maxLength} characters`, 400);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw failure(`${label} contains unsafe control characters`, 400);
  return text;
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure(`${label} must be an object`, 400);
  return value;
}

function assertKnownFields(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw failure(`${label} contains unknown field: ${key}`, 400);
  }
}

function assertSlug(slug) {
  if (!slugPattern.test(slug)) throw failure(`Delivery slug must be lower kebab-case: ${slug}`, 400);
}

function currentPhaseRecord(state, phase) {
  if (phase === 'manual-qa') return (state.humanGates ?? []).find((item) => item.id === phase) ?? null;
  return [...(state.phases ?? []), ...(state.adjuncts ?? [])].find((item) => item.id === phase) ?? null;
}

function resolveGovernedContext(projectRoot, slug, options = {}) {
  assertSlug(slug);
  const intent = options.intent ?? readRuntimeIntent(projectRoot, slug);
  if (!intent || intent.slug !== slug) throw failure(`Work item not found: ${slug}`, 404);
  const state = options.deliveryState ?? readDeliveryState(projectRoot, slug);
  const catalog = new Map((options.intentCatalogue ?? listRuntimeIntents(projectRoot)).map((item) => [item.id, item]));
  const execution = options.executionState ?? deriveExecutionState(projectRoot, intent, { intentCatalog: catalog });
  const phase = String(state.currentPhase ?? execution.lifecycle?.nextPhase ?? '').trim();
  const profileId = phaseToProfile[phase] ?? null;
  const phaseRecord = currentPhaseRecord(state, phase);
  const profileValue = profileId ? phaseProfiles[profileId] : null;
  const sourceDigest = hash({
    intent: {
      id: intent.id, status: intent.status, deliveryStatus: intent.deliveryStatus, currentPhase: intent.currentPhase,
      contentDigest: hash(intent.markdown ?? { title: intent.title, relationships: intent.relationships, personas: intent.personas }),
    },
    delivery: { schema: state.schema, slug: state.slug, status: state.status, currentPhase: state.currentPhase, updatedAt: state.updatedAt, phaseStatus: phaseRecord?.status ?? null },
    execution: { valid: execution.valid, lifecycle: execution.lifecycle, blockers: execution.blockers ?? [] },
  });
  const profileDigest = profileValue ? hash(profileValue) : null;
  const blockers = [...(execution.blockers ?? [])];
  if (profileValue && (!phaseRecord || terminalStatuses.has(phaseRecord.status) || phaseRecord.status !== 'running')) {
    blockers.push({ code: 'phase-not-contributable', message: `Phase ${phase} is ${phaseRecord?.status ?? 'unavailable'} and is read-only.`, evidence: phase });
  }
  const supported = Boolean(profileValue);
  const contributable = supported && execution.valid === true && blockers.length === 0;
  return { projectRoot: resolve(projectRoot), intent, state, execution, phase, phaseRecord, profile: profileValue, profileDigest, sourceDigest, blockers, supported, contributable };
}

function draftPath(projectRoot, slug, profileId) {
  return runtimePaths(projectRoot).phaseContributionDraftPath(slug, profileId);
}

function findOtherDraft(projectRoot, slug, profileId) {
  const folder = resolve(runtimePaths(projectRoot).phaseContributionsRoot, slug);
  if (!existsSync(folder)) return null;
  const candidate = readdirSync(folder).find((name) => name.endsWith('.json') && name !== `${profileId}.json`);
  if (!candidate) return null;
  try { return JSON.parse(readFileSync(resolve(folder, candidate), 'utf8')); }
  catch { return { phase: candidate.replace(/\.json$/, '') }; }
}

function draftDigest(draft) {
  const { digest: _digest, ...content } = draft;
  return hash(content);
}

function initialDraft(context, now) {
  return {
    schema: DRAFT_SCHEMA,
    slug: context.intent.slug,
    intentId: context.intent.id,
    phase: context.phase,
    profileId: context.profile.id,
    profileDigest: context.profileDigest,
    sourceDigest: context.sourceDigest,
    deliveryUpdatedAt: context.state.updatedAt ?? null,
    revision: 0,
    digest: '',
    ownerContext: 'business',
    owners: { business: '', technical: '', sharedReview: '' },
    entries: [],
    openQuestions: [],
    conflicts: [],
    limitations: [],
    handoffs: [],
    confirmations: [],
    activePersonaIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function readDraft(projectRoot, context, options = {}) {
  const path = draftPath(projectRoot, context.intent.slug, context.profile.id);
  if (!existsSync(path)) return initialDraft(context, options.now ?? new Date().toISOString());
  let draft;
  try { draft = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { throw failure(`Phase contribution draft is not valid JSON: ${error.message}`); }
  if (draft.schema !== DRAFT_SCHEMA || draft.slug !== context.intent.slug || draft.profileId !== context.profile.id || !Number.isInteger(draft.revision) || draft.revision < 1) {
    throw failure('Phase contribution draft has an unsupported schema, delivery, profile or revision');
  }
  if (draft.phase !== context.phase) throw failure(`The saved contribution belongs to ${draft.phase}; the current phase changed to ${context.phase}.`);
  if (draft.profileDigest !== context.profileDigest) throw failure('The server-owned phase contribution profile changed; review before continuing.');
  if (draft.sourceDigest !== context.sourceDigest) throw failure('The governed delivery source changed; review the current phase before continuing.');
  if (draft.digest !== draftDigest(draft)) throw failure('The phase contribution draft digest is invalid.');
  return draft;
}

function readDraftForMutation(projectRoot, context, options) {
  const currentPath = draftPath(projectRoot, context.intent.slug, context.profile.id);
  if (!existsSync(currentPath)) {
    const other = findOtherDraft(projectRoot, context.intent.slug, context.profile.id);
    if (other) throw failure(`The saved contribution belongs to ${other.phase ?? other.profileId}; the current phase changed to ${context.phase}.`);
  }
  return readDraft(projectRoot, context, options);
}

function availability(catalogue) {
  const result = {};
  for (const tier of ['core', 'project', 'premium', 'personal']) {
    const count = catalogue.filter((persona) => persona.tier === tier).length;
    result[tier] = {
      installed: count > 0,
      count,
      reason: count ? `${count} installed ${tier} persona${count === 1 ? '' : 's'} available.` : `No installed ${tier} personas were found; this does not block Phase Studio.`,
    };
  }
  return result;
}

function activePersonas(context, draft, catalogue) {
  const projection = contexts[draft.ownerContext];
  return selectContextualPersonas({
    contextLabel: `${context.profile.title} ${projection.title} context`,
    signals: [...context.profile.signals, ...projection.priorities],
    context: { entries: draft.entries.map(({ topic, classification, statement }) => ({ topic, classification, statement })), questions: draft.openQuestions, conflicts: draft.conflicts },
    personaCatalogue: catalogue,
    limit: 4,
  });
}

function personaChanges(previousIds, personas) {
  const currentIds = personas.map(({ id }) => id);
  return {
    joined: personas.filter(({ id }) => !previousIds.includes(id)).map(({ id, name, tier }) => ({ id, name, tier })),
    left: previousIds.filter((id) => !currentIds.includes(id)),
  };
}

function safeDraft(draft) {
  return structuredClone(draft);
}

function response(context, draft, options = {}) {
  const catalogue = Array.isArray(options.personas) ? options.personas : [];
  const personas = context.profile ? activePersonas(context, draft, catalogue) : [];
  const previousIds = options.previousPersonaIds ?? draft.activePersonaIds ?? [];
  const isSaved = draft.revision > 0;
  return {
    schema: RESPONSE_SCHEMA,
    status: !context.supported ? 'unsupported' : context.blockers.length ? 'blocked' : isSaved ? 'draft' : 'empty',
    intent: { id: context.intent.id, slug: context.intent.slug, title: context.intent.title },
    phase: { id: context.phase, status: context.phaseRecord?.status ?? 'unknown', sourceDigest: context.sourceDigest },
    integrity: { valid: context.execution.valid === true, blockers: context.execution.blockers ?? [] },
    blockers: context.blockers,
    profile: context.profile ? structuredClone(context.profile) : null,
    profileDigest: context.profileDigest,
    contexts: structuredClone(contexts),
    context: structuredClone(contexts[draft.ownerContext] ?? contexts.business),
    draft: safeDraft(draft),
    activePersonas: personas,
    personaChanges: personaChanges(previousIds, personas),
    personaAvailability: availability(catalogue),
    guidance: {
      baselineComplete: true,
      baselineQuestions: context.profile ? [...context.profile.topics.map((item) => item.question), ...contexts[draft.ownerContext].questions] : [],
      advisoryNotice: 'Standard host-model reasoning plus installed core and project personas is complete. Personas are advisory lenses, not participant evidence, validation, acceptance or approval.',
      premiumOptional: true,
    },
    capabilities: {
      contribute: context.contributable,
      saveDraft: context.contributable,
      discardDraft: context.contributable && isSaved,
      handoff: context.contributable && isSaved,
      requestReview: context.contributable && isSaved,
      confirmContribution: context.contributable && isSaved,
    },
    destinations: context.profile ? contributionDestination(context, draft) : [],
    authority: {
      delivery: 'none', ownerContextIsAuthentication: false, personasAreEvidence: false,
      phaseCompleted: false, buildApproved: false, manualQaApproved: false, releaseApproved: false,
    },
  };
}

function contributionDestination(context, draft) {
  const { paths } = loadProjectConfig(context.projectRoot);
  const root = relative(paths.projectRoot, resolve(paths.specsRoot, '6.Build', context.intent.slug, 'phase-contributions', context.profile.id)).replaceAll('\\', '/');
  return [`${root}/contribution-<timestamp>-r${draft.revision || '<revision>'}-<digest>.md`, `${root}/contribution-<timestamp>-r${draft.revision || '<revision>'}-<digest>.json`];
}

function normaliseEntry(value, index, context, ownerContext, ownerName, timestamp) {
  const input = assertObject(value, `Evidence entry ${index + 1}`);
  assertKnownFields(input, ['topic', 'classification', 'statement', 'source'], `Evidence entry ${index + 1}`);
  const topicId = cleanText(input.topic, `Evidence entry ${index + 1} topic`, 120);
  if (!context.profile.topics.some((candidate) => candidate.id === topicId)) throw failure(`Unknown ${context.profile.title} evidence topic: ${topicId}`, 400);
  const classification = cleanText(input.classification, `Evidence entry ${index + 1} classification`, 80);
  if (!evidenceClasses.has(classification)) throw failure(`Unsupported evidence classification: ${classification}`, 400);
  const statement = cleanText(input.statement, `Evidence entry ${index + 1} statement`);
  if (!statement) throw failure(`Evidence entry ${index + 1} requires a statement`, 400);
  return {
    id: randomUUID(), topic: topicId, classification, statement,
    source: cleanText(input.source, `Evidence entry ${index + 1} source`, 1_000),
    ownerContext, contributedBy: ownerName, recordedAt: timestamp,
  };
}

function boundedArray(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw failure(`${label} must be an array`, 400);
  if (value.length > MAX_ITEMS) throw failure(`${label} exceeds ${MAX_ITEMS} items`, 400);
  return value;
}

function persistDraft(projectRoot, context, draft, options = {}) {
  const catalogue = Array.isArray(options.personas) ? options.personas : [];
  draft.activePersonaIds = activePersonas(context, draft, catalogue).map(({ id }) => id);
  draft.digest = draftDigest(draft);
  if (Buffer.byteLength(JSON.stringify(draft), 'utf8') > MAX_DRAFT_BYTES) throw failure(`Phase contribution draft exceeds ${MAX_DRAFT_BYTES} bytes`, 413);
  atomicJson(draftPath(projectRoot, context.intent.slug, context.profile.id), draft);
  return draft;
}

function assertContributable(context) {
  if (!context.supported) throw failure(`Phase ${context.phase || '<unknown>'} does not support Phase Studio contributions.`);
  if (!context.contributable) throw failure(context.blockers[0]?.message ?? 'The current delivery state is read-only.');
}

function assertExpectedRevision(input, draft) {
  const revision = Number(input.expectedRevision);
  if (!Number.isInteger(revision) || revision !== draft.revision) throw failure(`A newer revision of this phase contribution draft exists (current revision ${draft.revision}).`);
}

function normaliseSaveInput(input) {
  const value = assertObject(input, 'Phase contribution request');
  assertKnownFields(value, ['expectedRevision', 'ownerContext', 'ownerName', 'entries', 'questions', 'conflicts', 'resolutions', 'limitations'], 'Phase contribution request');
  return value;
}

export function phaseContributionProfiles() {
  return structuredClone(phaseProfiles);
}

export function readPhaseStudio(projectRoot, slug, options = {}) {
  const context = resolveGovernedContext(projectRoot, slug, options);
  if (!context.profile) {
    const draft = { ...initialDraft({ ...context, profile: { id: 'unsupported' } }, options.now ?? new Date().toISOString()), phase: context.phase, profileId: null, profileDigest: null, sourceDigest: context.sourceDigest };
    draft.digest = draftDigest(draft);
    return response(context, draft, options);
  }
  const draft = readDraft(projectRoot, context, options);
  return response(context, draft, options);
}

export function savePhaseContributionDraft(projectRoot, slug, input = {}, options = {}) {
  const value = normaliseSaveInput(input);
  const context = resolveGovernedContext(projectRoot, slug, options);
  assertContributable(context);
  const current = readDraftForMutation(projectRoot, context, options);
  assertExpectedRevision(value, current);
  const ownerContext = cleanText(value.ownerContext || current.ownerContext, 'Owner context', 40);
  if (!contexts[ownerContext]) throw failure(`Owner context must be one of: ${Object.keys(contexts).join(', ')}`, 400);
  const ownerName = cleanText(value.ownerName || current.owners[contexts[ownerContext].ownerKey], 'Owner name', MAX_NAME);
  if (!ownerName) throw failure('Saving a phase contribution requires a real named owner.', 400);
  const timestamp = options.now ?? new Date().toISOString();
  const draft = structuredClone(current);
  const previousPersonaIds = [...(current.activePersonaIds ?? [])];
  draft.revision += 1;
  draft.ownerContext = ownerContext;
  draft.owners[contexts[ownerContext].ownerKey] = ownerName;
  draft.entries.push(...boundedArray(value.entries, 'Evidence entries').map((entry, index) => normaliseEntry(entry, index, context, ownerContext, ownerName, timestamp)));
  draft.openQuestions.push(...boundedArray(value.questions, 'Open questions').map((question, index) => ({
    id: randomUUID(), question: cleanText(question, `Open question ${index + 1}`), ownerContext, raisedBy: ownerName, status: 'open', recordedAt: timestamp,
  })).filter(({ question }) => question));
  draft.conflicts.push(...boundedArray(value.conflicts, 'Conflicts').map((conflict, index) => {
    const item = assertObject(conflict, `Conflict ${index + 1}`);
    assertKnownFields(item, ['summary', 'businessPosition', 'technicalPosition'], `Conflict ${index + 1}`);
    const summary = cleanText(item.summary, `Conflict ${index + 1} summary`);
    if (!summary) throw failure(`Conflict ${index + 1} requires a summary`, 400);
    return {
      id: randomUUID(), summary, businessPosition: cleanText(item.businessPosition, `Conflict ${index + 1} business position`),
      technicalPosition: cleanText(item.technicalPosition, `Conflict ${index + 1} technical position`), ownerContext, raisedBy: ownerName,
      status: 'unresolved', resolution: null, recordedAt: timestamp,
    };
  }));
  for (const [index, resolution] of boundedArray(value.resolutions, 'Conflict resolutions').entries()) {
    const item = assertObject(resolution, `Conflict resolution ${index + 1}`);
    assertKnownFields(item, ['conflictId', 'resolution'], `Conflict resolution ${index + 1}`);
    const conflict = draft.conflicts.find((candidate) => candidate.id === cleanText(item.conflictId, `Conflict resolution ${index + 1} id`, 80));
    if (!conflict) throw failure(`Unknown conflict for resolution ${index + 1}`, 400);
    const resolutionText = cleanText(item.resolution, `Conflict resolution ${index + 1}`);
    if (!resolutionText) throw failure(`Conflict resolution ${index + 1} requires a resolution`, 400);
    conflict.status = 'resolved';
    conflict.resolution = { statement: resolutionText, resolvedBy: ownerName, ownerContext, recordedAt: timestamp };
  }
  draft.limitations.push(...boundedArray(value.limitations, 'Limitations').map((limitation, index) => ({
    id: randomUUID(), statement: cleanText(limitation, `Limitation ${index + 1}`), recordedBy: ownerName, ownerContext, recordedAt: timestamp,
  })).filter(({ statement }) => statement));
  draft.updatedAt = timestamp;
  persistDraft(projectRoot, context, draft, options);
  return response(context, draft, { ...options, previousPersonaIds });
}

export function discardPhaseContributionDraft(projectRoot, slug, input = {}, options = {}) {
  const value = assertObject(input, 'Phase contribution discard request');
  assertKnownFields(value, ['expectedRevision', 'confirmed'], 'Phase contribution discard request');
  if (value.confirmed !== true) throw failure('Discarding a phase contribution draft requires explicit confirmation.');
  const context = resolveGovernedContext(projectRoot, slug, options);
  assertContributable(context);
  const draft = readDraftForMutation(projectRoot, context, options);
  assertExpectedRevision(value, draft);
  rmSync(draftPath(projectRoot, slug, context.profile.id), { force: true });
  return { schema: 'ewai.phase-contribution-discard/v1', status: 'discarded', revision: draft.revision, authority: { delivery: 'none', evidenceDeleted: false } };
}

export function handoffPhaseContribution(projectRoot, slug, input = {}, options = {}) {
  const value = assertObject(input, 'Phase contribution hand-off request');
  assertKnownFields(value, ['expectedRevision', 'currentDigest', 'destinationContext', 'toOwner', 'reason', 'questions'], 'Phase contribution hand-off request');
  const context = resolveGovernedContext(projectRoot, slug, options);
  assertContributable(context);
  const current = readDraftForMutation(projectRoot, context, options);
  assertExpectedRevision(value, current);
  const currentDigest = cleanText(value.currentDigest, 'Current contribution digest', 64);
  if (!digestPattern.test(currentDigest) || currentDigest !== current.digest) throw failure('The current contribution digest does not match the saved draft.');
  const destinationContext = cleanText(value.destinationContext, 'Destination context', 40);
  if (!contexts[destinationContext]) throw failure(`Destination context must be one of: ${Object.keys(contexts).join(', ')}`, 400);
  if (destinationContext === current.ownerContext) throw failure('An owner hand-off requires a distinct destination context.', 400);
  const sourceOwner = current.owners[contexts[current.ownerContext].ownerKey];
  if (!sourceOwner) throw failure('An owner hand-off requires a named source owner.', 400);
  const toOwner = cleanText(value.toOwner, 'Destination owner', MAX_NAME);
  if (!toOwner) throw failure('An owner hand-off requires a named destination owner.', 400);
  const reason = cleanText(value.reason, 'Hand-off reason');
  if (!reason) throw failure('An owner hand-off requires a reason.', 400);
  const questions = boundedArray(value.questions, 'Hand-off questions').map((question, index) => cleanText(question, `Hand-off question ${index + 1}`)).filter(Boolean);
  if (!questions.length) throw failure('An owner hand-off requires at least one next-owner question.', 400);
  const timestamp = options.now ?? new Date().toISOString();
  const draft = structuredClone(current);
  const previousPersonaIds = [...(current.activePersonaIds ?? [])];
  draft.revision += 1;
  draft.handoffs.push({
    id: randomUUID(), fromContext: current.ownerContext, fromOwner: sourceOwner,
    toContext: destinationContext, toOwner, reason, questions,
    sourceRevision: current.revision, sourceDigest: current.digest, handedOffAt: timestamp,
  });
  draft.ownerContext = destinationContext;
  draft.owners[contexts[destinationContext].ownerKey] = toOwner;
  draft.updatedAt = timestamp;
  persistDraft(projectRoot, context, draft, options);
  return response(context, draft, { ...options, previousPersonaIds });
}

export function requestPhaseContributionReview(projectRoot, slug, input = {}, options = {}) {
  const value = assertObject(input, 'Phase contribution review request');
  assertKnownFields(value, ['expectedRevision', 'currentDigest'], 'Phase contribution review request');
  const context = resolveGovernedContext(projectRoot, slug, options);
  assertContributable(context);
  const draft = readDraftForMutation(projectRoot, context, options);
  assertExpectedRevision(value, draft);
  const currentDigest = cleanText(value.currentDigest, 'Current contribution digest', 64);
  if (!digestPattern.test(currentDigest) || currentDigest !== draft.digest) throw failure('The current contribution digest does not match the saved draft.');
  const personas = activePersonas(context, draft, Array.isArray(options.personas) ? options.personas : [])
    .map(({ id, name, tier, matchedSignals, engagementReason }) => ({ id, name, tier, matchedSignals, engagementReason }));
  const topicNames = [...new Set(draft.entries.map(({ topic: topicId }) => topicId))];
  const unresolvedConflicts = draft.conflicts.filter(({ status }) => status !== 'resolved').length;
  const summary = `${draft.entries.length} attributed entr${draft.entries.length === 1 ? 'y' : 'ies'}${topicNames.length ? ` across ${topicNames.join(', ')}` : ''}; ${draft.openQuestions.filter(({ status }) => status !== 'resolved').length} open question(s); ${unresolvedConflicts} unresolved conflict(s); ${draft.limitations.length} recorded limitation(s).`;
  const queueReview = options.queueReview ?? queueDashboardHandoff;
  const handoff = queueReview(projectRoot, {
    action: 'review-contribution', intentId: context.intent.id, slug: context.intent.slug, title: context.intent.title,
    phase: context.profile.id, authority: 'none',
    reviewContext: { revision: draft.revision, digest: draft.digest, ownerContext: draft.ownerContext, summary, activePersonas: personas },
  });
  return {
    schema: 'ewai.phase-contribution-review/v1', status: handoff.status, handoff,
    authority: 'none', draftRevision: draft.revision, draftDigest: draft.digest,
    notice: 'This hand-off requests advisory challenge only. It cannot change delivery state, confirm evidence or approve work.',
  };
}

function relativePath(projectRoot, path) {
  return relative(resolve(projectRoot), path).replaceAll('\\', '/');
}

function uniqueBundlePaths(projectRoot, context, draft, timestamp) {
  const { paths } = loadProjectConfig(projectRoot);
  const root = resolve(paths.specsRoot, '6.Build', context.intent.slug, 'phase-contributions', context.profile.id);
  if (!isWithin(paths.specsRoot, root)) throw failure('Unsafe contribution evidence destination.');
  const compactTime = timestamp.replace(/[^0-9]/g, '').slice(0, 14) || 'undated';
  const base = `contribution-${compactTime}-r${draft.revision}-${draft.digest.slice(0, 8)}`;
  let stem = base;
  while (existsSync(resolve(root, `${stem}.json`)) || existsSync(resolve(root, `${stem}.md`))) stem = `${base}-${randomUUID().slice(0, 8)}`;
  return { root, markdown: resolve(root, `${stem}.md`), json: resolve(root, `${stem}.json`) };
}

function line(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').trim();
}

function renderBundleMarkdown(bundle) {
  const evidence = bundle.evidence.length
    ? bundle.evidence.map((item) => `- **${line(item.classification)} · ${line(item.topic)} · ${line(item.contributedBy)} (${line(item.ownerContext)}):** ${line(item.statement)}${item.source ? ` — Source: ${line(item.source)}` : ''}`).join('\n')
    : '- None recorded.';
  const questions = bundle.openQuestions.length ? bundle.openQuestions.map((item) => `- **${line(item.raisedBy)}:** ${line(item.question)} (${line(item.status)})`).join('\n') : '- None recorded.';
  const conflicts = bundle.conflicts.length ? bundle.conflicts.map((item) => `- **${line(item.summary)}** — ${line(item.status)}${item.resolution ? `; ${line(item.resolution.statement)} (${line(item.resolution.resolvedBy)})` : ''}`).join('\n') : '- None recorded.';
  return `# Phase contribution: ${line(bundle.intent.title)}\n\n**Phase:** ${line(bundle.phase.title)} (\`${line(bundle.phase.id)}\`)\n\n**Confirmed by:** ${line(bundle.confirmation.confirmedBy)} at ${line(bundle.confirmation.confirmedAt)}\n\n**Draft revision:** ${bundle.confirmation.revision} · \`${bundle.confirmation.digest}\`\n\n> ${bundle.assurance.notice}\n\n## Named owners\n\n- Business-facing: ${line(bundle.owners.business) || 'Not named'}\n- Technical: ${line(bundle.owners.technical) || 'Not named'}\n- Shared review: ${line(bundle.owners.sharedReview) || 'Not named'}\n\n## Attributed evidence\n\n${evidence}\n\n## Open questions\n\n${questions}\n\n## Conflicts and resolutions\n\n${conflicts}\n\n## Limitations\n\n${bundle.limitations.length ? bundle.limitations.map((item) => `- ${line(item.statement)} — ${line(item.recordedBy)} (${line(item.ownerContext)})`).join('\n') : '- None recorded.'}\n\n## Owner hand-offs\n\n${bundle.handoffs.length ? bundle.handoffs.map((item) => `- ${line(item.fromOwner)} (${line(item.fromContext)}) → ${line(item.toOwner)} (${line(item.toContext)}), revision ${item.sourceRevision}, digest \`${item.sourceDigest}\`: ${line(item.reason)}`).join('\n') : '- None recorded.'}\n\n## Authority boundary\n\nThis bundle does not complete a phase, approve Build, accept Manual QA, dispose of security findings, deploy, certify or release work.\n`;
}

function writePair(paths, markdown, bundle) {
  mkdirSync(paths.root, { recursive: true });
  const markdownTemporary = `${paths.markdown}.${process.pid}.${randomUUID()}.tmp`;
  const jsonTemporary = `${paths.json}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(markdownTemporary, markdown, 'utf8');
    writeFileSync(jsonTemporary, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    renameSync(markdownTemporary, paths.markdown);
    try { renameSync(jsonTemporary, paths.json); }
    catch (error) { rmSync(paths.markdown, { force: true }); throw error; }
  } finally {
    rmSync(markdownTemporary, { force: true });
    rmSync(jsonTemporary, { force: true });
  }
}

export function confirmPhaseContribution(projectRoot, slug, input = {}, options = {}) {
  const value = assertObject(input, 'Phase contribution confirmation request');
  assertKnownFields(value, ['expectedRevision', 'currentDigest', 'confirmed', 'confirmedBy'], 'Phase contribution confirmation request');
  if (value.confirmed !== true) throw failure('Contribution evidence materialisation requires explicit confirmation.');
  const confirmedBy = cleanText(value.confirmedBy, 'Confirmer name', MAX_NAME);
  if (!confirmedBy) throw failure('Contribution evidence materialisation requires an accountable confirmer name.', 400);
  const context = resolveGovernedContext(projectRoot, slug, options);
  assertContributable(context);
  const current = readDraftForMutation(projectRoot, context, options);
  assertExpectedRevision(value, current);
  if (!current.entries.length) throw failure('Contribution confirmation requires at least one attributed evidence entry.');
  const currentDigest = cleanText(value.currentDigest, 'Current contribution digest', 64);
  if (!digestPattern.test(currentDigest) || currentDigest !== current.digest) throw failure('The current contribution digest does not match the saved draft.');
  const timestamp = options.now ?? new Date().toISOString();
  const paths = uniqueBundlePaths(projectRoot, context, current, timestamp);
  const created = { markdownPath: relativePath(projectRoot, paths.markdown), jsonPath: relativePath(projectRoot, paths.json) };
  const bundle = {
    schema: 'ewai.phase-contribution/v1',
    intent: { id: context.intent.id, slug: context.intent.slug, title: context.intent.title },
    phase: { id: context.profile.id, title: context.profile.title, governedPhase: context.phase, deliveryUpdatedAt: current.deliveryUpdatedAt, sourceDigest: current.sourceDigest, profileDigest: current.profileDigest },
    confirmation: { confirmedBy, confirmedAt: timestamp, revision: current.revision, digest: current.digest },
    owners: structuredClone(current.owners),
    evidence: structuredClone(current.entries), openQuestions: structuredClone(current.openQuestions),
    conflicts: structuredClone(current.conflicts), limitations: structuredClone(current.limitations), handoffs: structuredClone(current.handoffs),
    activePersonas: activePersonas(context, current, Array.isArray(options.personas) ? options.personas : []).map(({ id, name, tier, matchedSignals, engagementReason }) => ({ id, name, tier, matchedSignals, engagementReason })),
    assurance: {
      notice: 'This is supporting evidence only. It is not a phase artefact, gate decision, validation, acceptance, approval, certification or release authority.',
      personasAreAdvisory: true, deliveryAuthority: 'none', deliberatelyUnresolved: current.openQuestions.filter(({ status }) => status !== 'resolved').length + current.conflicts.filter(({ status }) => status !== 'resolved').length,
    },
    created,
  };
  writePair(paths, renderBundleMarkdown(bundle), bundle);

  const draft = structuredClone(current);
  draft.revision += 1;
  draft.confirmations.push({ confirmedBy, confirmedAt: timestamp, sourceRevision: current.revision, sourceDigest: current.digest, ...created });
  draft.updatedAt = timestamp;
  persistDraft(projectRoot, context, draft, options);
  return {
    schema: 'ewai.phase-contribution-confirmation/v1', status: 'confirmed', confirmation: bundle.confirmation, created,
    draftRevision: draft.revision, draftDigest: draft.digest,
    authority: { phaseCompleted: false, buildApproved: false, manualQaApproved: false, securityDispositionRecorded: false, releaseApproved: false },
  };
}
