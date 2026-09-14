import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { projectPaths } from './paths.mjs';
import { sha256 } from './delivery-documents.mjs';

export const PROTOTYPE_REVIEW_DISPOSITIONS = Object.freeze([
  'incorporate',
  'incorporate-with-modification',
  'defer',
  'reject',
  'escalate',
]);

export const PROTOTYPE_EVIDENCE_CHANNELS = Object.freeze([
  'source',
  'rendered-viewport',
  'interaction',
  'assistive-technology',
  'user-research',
  'manual-qa',
  'release',
]);

const tiers = new Set(['project', 'premium', 'personal', 'core']);
const severities = new Set(['advisory', 'material', 'critical']);
const dispositions = new Set(PROTOTYPE_REVIEW_DISPOSITIONS);
const safeTokenPattern = /^[a-z0-9][a-z0-9._:@/-]{0,199}$/i;
const digestPattern = /^sha256:[a-f0-9]{64}$/;

function fail(message) {
  throw new Error(`Prototype iteration: ${message}`);
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function knownFields(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label} has unknown field ${key}`);
}

function text(value, label, maximum = 200, options = {}) {
  const cleaned = String(value ?? '').trim();
  if (!cleaned && !options.optional) fail(`${label} is required`);
  if (cleaned.length > maximum) fail(`${label} exceeds ${maximum} characters`);
  return cleaned;
}

function token(value, label, options = {}) {
  const cleaned = text(value, label, options.maximum ?? 200, options);
  if (cleaned && (!safeTokenPattern.test(cleaned) || cleaned.includes('..') || cleaned.startsWith('/'))) {
    fail(`${label} must be a bounded safe identifier`);
  }
  return cleaned;
}

function digest(value, label, options = {}) {
  const cleaned = text(value, label, 80, options).toLowerCase();
  if (cleaned && !digestPattern.test(cleaned)) fail(`${label} must be a SHA-256 digest`);
  return cleaned;
}

function list(value, label, maximum = 100) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  if (value.length > maximum) fail(`${label} exceeds ${maximum} entries`);
  return value;
}

function uniqueTokens(value, label, maximum = 100) {
  const result = list(value ?? [], label, maximum).map((entry, index) => token(entry, `${label} ${index + 1}`));
  if (new Set(result).size !== result.length) fail(`${label} contains duplicate values`);
  return result.sort((left, right) => left.localeCompare(right));
}

function uniqueTexts(value, label, maximum = 100, textMaximum = 500) {
  const result = list(value ?? [], label, maximum).map((entry, index) => text(entry, `${label} ${index + 1}`, textMaximum));
  if (new Set(result).size !== result.length) fail(`${label} contains duplicate values`);
  return result.sort((left, right) => left.localeCompare(right));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function hash(value) {
  return `sha256:${sha256(JSON.stringify(canonical(value)))}`;
}

function boundedCount(value, label) {
  const parsed = Number(value ?? 0);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) fail(`${label} must be an integer from 0 to 10000`);
  return parsed;
}

function normalizeAvailabilityEntry(value, label, { countRequired = true } = {}) {
  const entry = object(value, label);
  knownFields(entry, ['available', 'count'], label);
  if (typeof entry.available !== 'boolean') fail(`${label}.available must be boolean`);
  if (countRequired && entry.count === undefined) fail(`${label}.count is required`);
  const result = { available: entry.available };
  if (entry.count !== undefined || countRequired) result.count = boundedCount(entry.count, `${label}.count`);
  if (result.count === 0 && result.available && label !== 'standard model availability') {
    fail(`${label} cannot be available with zero entries`);
  }
  return result;
}

function normalizePersona(persona, index) {
  object(persona, `active persona ${index + 1}`);
  knownFields(persona, ['id', 'name', 'tier', 'category', 'description', 'matchedSignals', 'engagementReason'], `active persona ${index + 1}`);
  const tier = token(persona.tier, `active persona ${index + 1} tier`);
  if (!tiers.has(tier)) fail(`active persona ${index + 1} tier is unsupported`);
  return {
    id: token(persona.id, `active persona ${index + 1} ID`),
    name: text(persona.name, `active persona ${index + 1} name`, 160),
    tier,
    category: text(persona.category ?? '', `active persona ${index + 1} category`, 120, { optional: true }),
    description: text(persona.description ?? '', `active persona ${index + 1} description`, 500, { optional: true }),
    matchedSignals: uniqueTexts(persona.matchedSignals ?? [], `active persona ${index + 1} matched signals`, 20, 120),
    engagementReason: text(persona.engagementReason, `active persona ${index + 1} engagement reason`, 500),
  };
}

export function normalizePrototypePersonaEngagement(value, expectedStage) {
  const engagement = object(value, 'persona engagement');
  knownFields(engagement, ['schema', 'stage', 'selectionFingerprint', 'activePersonas', 'availability', 'baseline', 'notices', 'authority'], 'persona engagement');
  if (engagement.schema !== 'ewai.prototype-persona-engagement/v1') fail('persona engagement schema is unsupported');
  const stage = token(engagement.stage, 'persona engagement stage');
  if (!['plan', 'design'].includes(stage)) fail('persona engagement stage must be plan or design');
  if (expectedStage && stage !== expectedStage) fail(`persona engagement stage must be ${expectedStage}`);
  const activePersonas = list(engagement.activePersonas, 'active personas', 8)
    .map(normalizePersona)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!activePersonas.length) fail('at least one active persona is required');
  if (new Set(activePersonas.map(({ id }) => id)).size !== activePersonas.length) fail('active personas contains duplicate IDs');

  const availability = object(engagement.availability, 'persona availability');
  knownFields(availability, ['standardModel', 'core', 'project', 'personal', 'premium'], 'persona availability');
  const normalizedAvailability = {
    standardModel: normalizeAvailabilityEntry(availability.standardModel, 'standard model availability', { countRequired: false }),
    core: normalizeAvailabilityEntry(availability.core, 'core persona availability'),
    project: normalizeAvailabilityEntry(availability.project, 'project persona availability'),
    personal: normalizeAvailabilityEntry(availability.personal, 'personal persona availability'),
    premium: normalizeAvailabilityEntry(availability.premium, 'premium persona availability'),
  };
  if (!normalizedAvailability.standardModel.available) fail('the standard model baseline must be available');
  for (const tier of ['core', 'project', 'personal', 'premium']) {
    const selected = activePersonas.filter((persona) => persona.tier === tier).length;
    if (selected > normalizedAvailability[tier].count) fail(`active ${tier} personas exceed the available count`);
  }

  const baseline = object(engagement.baseline, 'persona baseline');
  knownFields(baseline, ['completeWithoutOptionalPersonas'], 'persona baseline');
  if (baseline.completeWithoutOptionalPersonas !== true) fail('prototype review must remain complete without optional personal or premium personas');
  const authority = object(engagement.authority, 'persona authority');
  knownFields(authority, ['advisory', 'maySelectPrototype', 'mayApproveManualQa'], 'persona authority');
  if (authority.advisory !== true || authority.maySelectPrototype !== false || authority.mayApproveManualQa !== false) {
    fail('persona authority must remain advisory and may not select prototypes or approve Manual QA');
  }
  const normalized = {
    schema: engagement.schema,
    stage,
    activePersonas,
    availability: normalizedAvailability,
    baseline: { completeWithoutOptionalPersonas: true },
    notices: uniqueTexts(engagement.notices ?? [], 'persona engagement notices', 10, 500),
    authority: { advisory: true, maySelectPrototype: false, mayApproveManualQa: false },
  };
  const calculatedFingerprint = hash({
    stage: normalized.stage,
    activePersonas: normalized.activePersonas.map(({ id, tier, matchedSignals }) => ({ id, tier, matchedSignals })),
    availability: normalized.availability,
  });
  normalized.selectionFingerprint = engagement.selectionFingerprint
    ? digest(engagement.selectionFingerprint, 'persona selection fingerprint')
    : calculatedFingerprint;
  return normalized;
}

function normalizeDesignSystem(value) {
  const designSystem = object(value, 'design system');
  knownFields(designSystem, ['id', 'effectiveDigest'], 'design system');
  return {
    id: token(designSystem.id, 'design system ID'),
    effectiveDigest: digest(designSystem.effectiveDigest, 'design system effective digest'),
  };
}

function normalizeScreen(value, index) {
  const screen = object(value, `plan screen ${index + 1}`);
  knownFields(screen, ['id', 'title', 'purpose', 'userOutcomes', 'evidenceRefs'], `plan screen ${index + 1}`);
  return {
    id: token(screen.id, `plan screen ${index + 1} ID`),
    title: text(screen.title, `plan screen ${index + 1} title`, 160),
    purpose: text(screen.purpose, `plan screen ${index + 1} purpose`, 1000),
    userOutcomes: uniqueTexts(screen.userOutcomes, `plan screen ${index + 1} user outcomes`, 30, 500),
    evidenceRefs: uniqueTokens(screen.evidenceRefs, `plan screen ${index + 1} evidence references`, 50),
  };
}

function normalizeJourney(value, index, screenIds) {
  const journey = object(value, `plan journey ${index + 1}`);
  knownFields(journey, ['id', 'actor', 'outcome', 'screenRefs'], `plan journey ${index + 1}`);
  const screenRefs = uniqueTokens(journey.screenRefs, `plan journey ${index + 1} screen references`, 30);
  for (const reference of screenRefs) if (!screenIds.has(reference)) fail(`plan journey ${index + 1} references unknown screen ${reference}`);
  return {
    id: token(journey.id, `plan journey ${index + 1} ID`),
    actor: token(journey.actor, `plan journey ${index + 1} actor`),
    outcome: text(journey.outcome, `plan journey ${index + 1} outcome`, 1000),
    screenRefs,
  };
}

function normalizePlan(value) {
  const plan = object(value, 'prototype plan');
  knownFields(plan, ['summary', 'screens', 'journeys'], 'prototype plan');
  const screens = list(plan.screens, 'prototype plan screens', 100).map(normalizeScreen).sort((left, right) => left.id.localeCompare(right.id));
  if (!screens.length) fail('prototype plan requires at least one screen');
  if (new Set(screens.map(({ id }) => id)).size !== screens.length) fail('prototype plan contains duplicate screen IDs');
  const screenIds = new Set(screens.map(({ id }) => id));
  const journeys = list(plan.journeys, 'prototype plan journeys', 100).map((journey, index) => normalizeJourney(journey, index, screenIds)).sort((left, right) => left.id.localeCompare(right.id));
  if (!journeys.length) fail('prototype plan requires at least one journey');
  if (new Set(journeys.map(({ id }) => id)).size !== journeys.length) fail('prototype plan contains duplicate journey IDs');
  return {
    summary: text(plan.summary, 'prototype plan summary', 2000),
    screens,
    journeys,
  };
}

function normalizePlanInput(value) {
  const input = object(value, 'prototype plan input');
  knownFields(input, ['schema', 'deliverySlug', 'intentDigest', 'designSystem', 'plan', 'engagement', 'predecessorDigest'], 'prototype plan input');
  if (input.schema !== 'ewai.prototype-plan-input/v1') fail('prototype plan input schema is unsupported');
  return {
    schema: input.schema,
    deliverySlug: token(input.deliverySlug, 'delivery slug'),
    intentDigest: digest(input.intentDigest, 'intent digest'),
    designSystem: normalizeDesignSystem(input.designSystem),
    plan: normalizePlan(input.plan),
    engagement: normalizePrototypePersonaEngagement(input.engagement, 'plan'),
    predecessorDigest: digest(input.predecessorDigest ?? '', 'predecessor digest', { optional: true }),
  };
}

export function preparePrototypePlanReview(input, options = {}) {
  const normalized = normalizePlanInput(input);
  const identity = {
    schema: 'ewai.prototype-plan-identity/v1',
    deliverySlug: normalized.deliverySlug,
    intentDigest: normalized.intentDigest,
    designSystem: normalized.designSystem,
    plan: normalized.plan,
    engagement: normalized.engagement,
    predecessorDigest: normalized.predecessorDigest,
  };
  return {
    schema: 'ewai.prototype-plan-preparation/v1',
    preparedAt: options.now ?? new Date().toISOString(),
    preparationDigest: hash(identity),
    inputFingerprint: hash({
      deliverySlug: normalized.deliverySlug,
      intentDigest: normalized.intentDigest,
      designSystem: normalized.designSystem,
      predecessorDigest: normalized.predecessorDigest,
    }),
    planFingerprint: hash(normalized.plan),
    personaFingerprint: hash(normalized.engagement),
    deliverySlug: normalized.deliverySlug,
    intentDigest: normalized.intentDigest,
    designSystem: normalized.designSystem,
    plan: normalized.plan,
    engagement: normalized.engagement,
    predecessorDigest: normalized.predecessorDigest,
    authority: {
      personasAreAdvisory: true,
      assessmentsMustBeExplicit: true,
      humanPrototypeSelectionRequired: true,
      manualQaRemainsSeparate: true,
    },
  };
}

function validatePlanPreparation(value) {
  const preparation = object(value, 'prototype plan preparation');
  knownFields(preparation, [
    'schema', 'preparedAt', 'preparationDigest', 'inputFingerprint', 'planFingerprint', 'personaFingerprint',
    'deliverySlug', 'intentDigest', 'designSystem', 'plan', 'engagement', 'predecessorDigest', 'authority',
  ], 'prototype plan preparation');
  if (preparation.schema !== 'ewai.prototype-plan-preparation/v1') fail('prototype plan preparation schema is unsupported');
  const rebuilt = preparePrototypePlanReview({
    schema: 'ewai.prototype-plan-input/v1',
    deliverySlug: preparation.deliverySlug,
    intentDigest: preparation.intentDigest,
    designSystem: preparation.designSystem,
    plan: preparation.plan,
    engagement: preparation.engagement,
    predecessorDigest: preparation.predecessorDigest,
  }, { now: preparation.preparedAt });
  for (const field of ['preparationDigest', 'inputFingerprint', 'planFingerprint', 'personaFingerprint']) {
    if (preparation[field] !== rebuilt[field]) fail(`${field} does not match the preparation content`);
  }
  const authority = object(preparation.authority, 'preparation authority');
  if (authority.personasAreAdvisory !== true || authority.assessmentsMustBeExplicit !== true
    || authority.humanPrototypeSelectionRequired !== true || authority.manualQaRemainsSeparate !== true) {
    fail('preparation authority is invalid');
  }
  return rebuilt;
}

function normalizeFinding(value, index, personaIds) {
  const finding = object(value, `finding ${index + 1}`);
  knownFields(finding, ['id', 'personaId', 'concernCode', 'severity', 'observation', 'recommendation', 'evidenceRefs'], `finding ${index + 1}`);
  const identity = {
    personaId: token(finding.personaId, `finding ${index + 1} persona ID`),
    concernCode: token(finding.concernCode, `finding ${index + 1} concern code`),
    evidenceRefs: uniqueTokens(finding.evidenceRefs, `finding ${index + 1} evidence references`, 50),
  };
  if (!personaIds.has(identity.personaId)) fail(`finding ${index + 1} references inactive persona ${identity.personaId}`);
  if (!identity.evidenceRefs.length) fail(`finding ${index + 1} requires evidence references`);
  const severity = token(finding.severity, `finding ${index + 1} severity`);
  if (!severities.has(severity)) fail(`finding ${index + 1} severity is unsupported`);
  const id = prototypeFindingId(identity);
  if (finding.id !== undefined && finding.id !== id) fail(`finding ${index + 1} ID does not match its stable identity`);
  return {
    id,
    ...identity,
    severity,
    observation: text(finding.observation, `finding ${index + 1} observation`, 2000),
    recommendation: text(finding.recommendation, `finding ${index + 1} recommendation`, 2000),
  };
}

export function prototypeFindingId(value) {
  const identity = {
    personaId: token(value?.personaId, 'finding identity persona ID'),
    concernCode: token(value?.concernCode, 'finding identity concern code'),
    evidenceRefs: uniqueTokens(value?.evidenceRefs, 'finding identity evidence references', 50),
  };
  return `FIND-${sha256(JSON.stringify(canonical(identity))).slice(0, 16)}`;
}

function normalizeAssessment(value, index, findingIds) {
  const assessment = object(value, `assessment ${index + 1}`);
  knownFields(assessment, ['findingId', 'disposition', 'rationale', 'modification', 'owner'], `assessment ${index + 1}`);
  const findingId = token(assessment.findingId, `assessment ${index + 1} finding ID`);
  if (!findingIds.has(findingId)) fail(`assessment ${index + 1} references unknown finding ${findingId}`);
  const disposition = token(assessment.disposition, `assessment ${index + 1} disposition`);
  if (!dispositions.has(disposition)) fail(`assessment ${index + 1} disposition is unsupported`);
  const modification = text(assessment.modification ?? '', `assessment ${index + 1} modification`, 2000, { optional: true });
  if (disposition === 'incorporate-with-modification' && modification.length < 12) {
    fail(`assessment ${index + 1} requires a substantive modification`);
  }
  return {
    findingId,
    disposition,
    rationale: text(assessment.rationale, `assessment ${index + 1} rationale`, 2000),
    modification,
    owner: text(assessment.owner ?? '', `assessment ${index + 1} owner`, 160, { optional: true }),
  };
}

function deriveNextAction(findings, assessments) {
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  if (assessments.some(({ disposition }) => disposition === 'escalate')) return 'human-decision-required';
  if (assessments.some((assessment) => assessment.disposition === 'defer' && ['material', 'critical'].includes(byId.get(assessment.findingId)?.severity))) {
    return 'human-decision-required';
  }
  if (assessments.some(({ disposition }) => ['incorporate', 'incorporate-with-modification'].includes(disposition))) return 'iterate';
  return 'ready-for-human-selection';
}

export function recordPrototypePlanReview(projectRoot, preparationInput, submissionInput, options = {}) {
  const preparation = validatePlanPreparation(preparationInput);
  const submission = object(submissionInput, 'prototype plan review submission');
  knownFields(submission, ['schema', 'expectedPreparationDigest', 'reviewedBy', 'findings', 'assessments'], 'prototype plan review submission');
  if (submission.schema !== 'ewai.prototype-plan-review-submission/v1') fail('prototype plan review submission schema is unsupported');
  if (digest(submission.expectedPreparationDigest, 'expected preparation digest') !== preparation.preparationDigest) {
    fail('expected preparation digest does not match; prepare a newer review before recording');
  }
  const personaIds = new Set(preparation.engagement.activePersonas.map(({ id }) => id));
  const findings = list(submission.findings, 'findings', 200).map((finding, index) => normalizeFinding(finding, index, personaIds)).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(findings.map(({ id }) => id)).size !== findings.length) fail('findings contains duplicate stable identities');
  const findingIds = new Set(findings.map(({ id }) => id));
  const assessments = list(submission.assessments, 'assessments', 200).map((assessment, index) => normalizeAssessment(assessment, index, findingIds)).sort((left, right) => left.findingId.localeCompare(right.findingId));
  if (new Set(assessments.map(({ findingId }) => findingId)).size !== assessments.length) fail('duplicate assessment for a finding');
  const unassessed = findings.filter(({ id }) => !assessments.some(({ findingId }) => findingId === id)).map(({ id }) => id);
  if (unassessed.length && !options.allowIncomplete) fail(`an assessment is required for every finding; unassessed: ${unassessed.join(', ')}`);
  if (assessments.length > findings.length) fail('assessments cannot exceed findings');

  const identity = {
    schema: 'ewai.prototype-plan-review-identity/v1',
    preparationDigest: preparation.preparationDigest,
    inputFingerprint: preparation.inputFingerprint,
    planFingerprint: preparation.planFingerprint,
    personaFingerprint: preparation.personaFingerprint,
    reviewedBy: text(submission.reviewedBy, 'reviewed by', 160),
    findings,
    assessments,
  };
  const contentDigest = hash(identity);
  const review = {
    schema: 'ewai.prototype-plan-review/v1',
    reviewedAt: options.now ?? new Date().toISOString(),
    contentDigest,
    predecessorDigest: preparation.predecessorDigest,
    preparationDigest: preparation.preparationDigest,
    inputFingerprint: preparation.inputFingerprint,
    planFingerprint: preparation.planFingerprint,
    personaFingerprint: preparation.personaFingerprint,
    deliverySlug: preparation.deliverySlug,
    reviewedBy: identity.reviewedBy,
    engagement: preparation.engagement,
    findings,
    assessments,
    assessment: {
      complete: unassessed.length === 0,
      findingCount: findings.length,
      assessedCount: assessments.length,
      unassessedFindingIds: unassessed,
    },
    nextAction: unassessed.length ? 'assessment-required' : deriveNextAction(findings, assessments),
    authority: preparation.authority,
  };

  if (options.persist === false || projectRoot === null) return { review, path: '' };
  const root = prototypeReviewEvidenceRoot(projectRoot, preparation.deliverySlug);
  const folder = resolve(root, 'plans');
  mkdirSync(folder, { recursive: true });
  const path = resolve(folder, `plan-${contentDigest.slice(7)}.json`);
  const relativePath = relative(projectPaths(projectRoot).projectRoot, path).replaceAll('\\', '/');
  if (existsSync(path)) {
    const stored = JSON.parse(readFileSync(path, 'utf8'));
    if (stored.contentDigest !== contentDigest) fail('immutable plan review evidence has conflicting content');
    return { review: stored, path: relativePath };
  }
  writeFileSync(path, `${JSON.stringify(review, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return { review, path: relativePath };
}

function boundedCycle(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3) fail(`${label} must be an integer from 1 to 3`);
  return parsed;
}

function normalizePrototype(value) {
  const prototype = object(value, 'prototype');
  knownFields(prototype, ['manifestDigest', 'entryPath'], 'prototype');
  const entryPath = token(prototype.entryPath, 'prototype entry path');
  if (!entryPath.startsWith('ui-design-assets/prototypes/') || !/\.html?$/i.test(entryPath)) {
    fail('prototype entry path must identify an HTML file inside ui-design-assets/prototypes');
  }
  return {
    manifestDigest: digest(prototype.manifestDigest, 'prototype manifest digest'),
    entryPath,
  };
}

function normalizeEvidenceChannels(value) {
  const statuses = new Set(['available', 'not-collected', 'not-applicable', 'pending-human']);
  const byChannel = new Map();
  for (const [index, entry] of list(value, 'evidence channels', PROTOTYPE_EVIDENCE_CHANNELS.length).entries()) {
    const evidence = object(entry, `evidence channel ${index + 1}`);
    knownFields(evidence, ['channel', 'status', 'evidenceRefs', 'note'], `evidence channel ${index + 1}`);
    const channel = token(evidence.channel, `evidence channel ${index + 1} name`);
    if (!PROTOTYPE_EVIDENCE_CHANNELS.includes(channel)) fail(`evidence channel ${channel} is unsupported`);
    if (byChannel.has(channel)) fail(`evidence channel ${channel} is duplicated`);
    const status = token(evidence.status, `${channel} evidence status`);
    if (!statuses.has(status)) fail(`${channel} evidence status is unsupported`);
    const evidenceRefs = uniqueTokens(evidence.evidenceRefs ?? [], `${channel} evidence references`, 100);
    if (status === 'available' && !evidenceRefs.length) fail(`${channel} available evidence requires at least one reference`);
    if (status !== 'available' && evidenceRefs.length) fail(`${channel} unavailable evidence may not claim evidence references`);
    byChannel.set(channel, {
      channel,
      status,
      evidenceRefs,
      note: text(evidence.note, `${channel} evidence note`, 1000),
    });
  }
  if (byChannel.size !== PROTOTYPE_EVIDENCE_CHANNELS.length) fail('every evidence channel must be represented exactly once');
  for (const required of ['source', 'rendered-viewport']) {
    if (byChannel.get(required)?.status !== 'available') fail(`${required} evidence must be available before persona design review`);
  }
  if (byChannel.get('manual-qa')?.status === 'available') fail('Manual QA evidence cannot be granted by persona design review');
  if (byChannel.get('release')?.status === 'available') fail('release evidence cannot be granted by persona design review');
  return PROTOTYPE_EVIDENCE_CHANNELS.map((channel) => byChannel.get(channel));
}

function normalizeCycleInput(value) {
  const input = object(value, 'prototype cycle input');
  knownFields(input, [
    'schema', 'deliverySlug', 'planReviewDigest', 'cycleNumber', 'maxCycles', 'predecessorDigest',
    'prototype', 'evidenceChannels', 'engagement',
  ], 'prototype cycle input');
  if (input.schema !== 'ewai.prototype-cycle-input/v1') fail('prototype cycle input schema is unsupported');
  const cycleNumber = boundedCycle(input.cycleNumber, 'cycle number');
  const maxCycles = boundedCycle(input.maxCycles, 'maximum cycles');
  if (cycleNumber > maxCycles) fail('cycle number cannot exceed maximum cycles');
  const predecessorDigest = digest(input.predecessorDigest ?? '', 'predecessor digest', { optional: true });
  if (cycleNumber === 1 && predecessorDigest) fail('the first cycle may not declare a predecessor digest');
  if (cycleNumber > 1 && !predecessorDigest) fail('cycles after the first require a predecessor digest');
  return {
    schema: input.schema,
    deliverySlug: token(input.deliverySlug, 'delivery slug'),
    planReviewDigest: digest(input.planReviewDigest, 'plan review digest'),
    cycleNumber,
    maxCycles,
    predecessorDigest,
    prototype: normalizePrototype(input.prototype),
    evidenceChannels: normalizeEvidenceChannels(input.evidenceChannels),
    engagement: normalizePrototypePersonaEngagement(input.engagement, 'design'),
  };
}

export function preparePrototypeCycleReview(input, options = {}) {
  const normalized = normalizeCycleInput(input);
  const identity = {
    schema: 'ewai.prototype-cycle-identity/v1',
    deliverySlug: normalized.deliverySlug,
    planReviewDigest: normalized.planReviewDigest,
    cycleNumber: normalized.cycleNumber,
    maxCycles: normalized.maxCycles,
    predecessorDigest: normalized.predecessorDigest,
    prototype: normalized.prototype,
    evidenceChannels: normalized.evidenceChannels,
    engagement: normalized.engagement,
  };
  return {
    ...normalized,
    schema: 'ewai.prototype-cycle-preparation/v1',
    preparedAt: options.now ?? new Date().toISOString(),
    preparationDigest: hash(identity),
    inputFingerprint: hash({
      deliverySlug: normalized.deliverySlug,
      planReviewDigest: normalized.planReviewDigest,
      cycleNumber: normalized.cycleNumber,
      maxCycles: normalized.maxCycles,
      predecessorDigest: normalized.predecessorDigest,
      prototype: normalized.prototype,
    }),
    evidenceFingerprint: hash(normalized.evidenceChannels),
    personaFingerprint: hash(normalized.engagement),
    authority: {
      personasAreAdvisory: true,
      assessmentsMustBeExplicit: true,
      humanPrototypeSelectionRequired: true,
      manualQaRemainsSeparate: true,
      releaseEvidenceRemainsSeparate: true,
    },
  };
}

function validateCyclePreparation(value) {
  const preparation = object(value, 'prototype cycle preparation');
  knownFields(preparation, [
    'schema', 'preparedAt', 'preparationDigest', 'inputFingerprint', 'evidenceFingerprint', 'personaFingerprint',
    'deliverySlug', 'planReviewDigest', 'cycleNumber', 'maxCycles', 'predecessorDigest', 'prototype',
    'evidenceChannels', 'engagement', 'authority',
  ], 'prototype cycle preparation');
  if (preparation.schema !== 'ewai.prototype-cycle-preparation/v1') fail('prototype cycle preparation schema is unsupported');
  const rebuilt = preparePrototypeCycleReview({
    schema: 'ewai.prototype-cycle-input/v1',
    deliverySlug: preparation.deliverySlug,
    planReviewDigest: preparation.planReviewDigest,
    cycleNumber: preparation.cycleNumber,
    maxCycles: preparation.maxCycles,
    predecessorDigest: preparation.predecessorDigest,
    prototype: preparation.prototype,
    evidenceChannels: preparation.evidenceChannels,
    engagement: preparation.engagement,
  }, { now: preparation.preparedAt });
  for (const field of ['preparationDigest', 'inputFingerprint', 'evidenceFingerprint', 'personaFingerprint']) {
    if (preparation[field] !== rebuilt[field]) fail(`${field} does not match the cycle preparation content`);
  }
  return rebuilt;
}

function deriveCycleNextAction(findings, assessments, cycleNumber, maxCycles) {
  const base = deriveNextAction(findings, assessments);
  if (base === 'iterate' && cycleNumber >= maxCycles) return 'human-decision-required';
  return base;
}

export function recordPrototypeCycleReview(projectRoot, preparationInput, submissionInput, options = {}) {
  const preparation = validateCyclePreparation(preparationInput);
  const submission = object(submissionInput, 'prototype cycle review submission');
  knownFields(submission, ['schema', 'expectedPreparationDigest', 'reviewedBy', 'findings', 'assessments'], 'prototype cycle review submission');
  if (submission.schema !== 'ewai.prototype-cycle-review-submission/v1') fail('prototype cycle review submission schema is unsupported');
  if (digest(submission.expectedPreparationDigest, 'expected preparation digest') !== preparation.preparationDigest) {
    fail('expected preparation digest does not match; prepare a newer design cycle before recording');
  }
  const personaIds = new Set(preparation.engagement.activePersonas.map(({ id }) => id));
  const findings = list(submission.findings, 'findings', 200).map((finding, index) => normalizeFinding(finding, index, personaIds)).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(findings.map(({ id }) => id)).size !== findings.length) fail('findings contains duplicate stable identities');
  const findingIds = new Set(findings.map(({ id }) => id));
  const assessments = list(submission.assessments, 'assessments', 200).map((assessment, index) => normalizeAssessment(assessment, index, findingIds)).sort((left, right) => left.findingId.localeCompare(right.findingId));
  if (new Set(assessments.map(({ findingId }) => findingId)).size !== assessments.length) fail('duplicate assessment for a finding');
  const unassessed = findings.filter(({ id }) => !assessments.some(({ findingId }) => findingId === id)).map(({ id }) => id);
  if (unassessed.length && !options.allowIncomplete) fail(`an assessment is required for every finding; unassessed: ${unassessed.join(', ')}`);

  const identity = {
    schema: 'ewai.prototype-cycle-review-identity/v1',
    preparationDigest: preparation.preparationDigest,
    inputFingerprint: preparation.inputFingerprint,
    evidenceFingerprint: preparation.evidenceFingerprint,
    personaFingerprint: preparation.personaFingerprint,
    reviewedBy: text(submission.reviewedBy, 'reviewed by', 160),
    findings,
    assessments,
  };
  const contentDigest = hash(identity);
  const review = {
    schema: 'ewai.prototype-cycle-review/v1',
    reviewedAt: options.now ?? new Date().toISOString(),
    contentDigest,
    predecessorDigest: preparation.predecessorDigest,
    planReviewDigest: preparation.planReviewDigest,
    preparationDigest: preparation.preparationDigest,
    inputFingerprint: preparation.inputFingerprint,
    evidenceFingerprint: preparation.evidenceFingerprint,
    personaFingerprint: preparation.personaFingerprint,
    deliverySlug: preparation.deliverySlug,
    cycleNumber: preparation.cycleNumber,
    maxCycles: preparation.maxCycles,
    prototype: preparation.prototype,
    evidenceChannels: preparation.evidenceChannels,
    engagement: preparation.engagement,
    reviewedBy: identity.reviewedBy,
    findings,
    assessments,
    assessment: {
      complete: unassessed.length === 0,
      findingCount: findings.length,
      assessedCount: assessments.length,
      unassessedFindingIds: unassessed,
    },
    nextAction: unassessed.length
      ? 'assessment-required'
      : deriveCycleNextAction(findings, assessments, preparation.cycleNumber, preparation.maxCycles),
    authority: preparation.authority,
  };

  if (options.persist === false || projectRoot === null) return { review, path: '' };
  const folder = resolve(prototypeReviewEvidenceRoot(projectRoot, preparation.deliverySlug), 'cycles');
  mkdirSync(folder, { recursive: true });
  const path = resolve(folder, `cycle-${preparation.cycleNumber}-${contentDigest.slice(7)}.json`);
  const relativePath = relative(projectPaths(projectRoot).projectRoot, path).replaceAll('\\', '/');
  if (existsSync(path)) {
    const stored = JSON.parse(readFileSync(path, 'utf8'));
    if (stored.contentDigest !== contentDigest) fail('immutable cycle review evidence has conflicting content');
    return { review: stored, path: relativePath };
  }
  writeFileSync(path, `${JSON.stringify(review, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return { review, path: relativePath };
}

function safeDeliveryRoot(projectRoot, slug) {
  const project = projectPaths(projectRoot);
  const safeSlug = token(slug, 'delivery slug');
  const root = resolve(project.buildRoot, safeSlug);
  const rel = relative(project.buildRoot, root);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) fail('delivery slug must resolve inside the Build root');
  return root;
}

function prototypeReviewEvidenceRoot(projectRoot, slug) {
  return resolve(safeDeliveryRoot(projectRoot, slug), 'ui-design-assets/prototype-iterations');
}

function readJsonFiles(folder) {
  if (!existsSync(folder)) return [];
  if (lstatSync(folder).isSymbolicLink()) fail(`evidence folder may not be a symbolic link: ${basename(folder)}`);
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => {
      const path = resolve(folder, entry.name);
      if (lstatSync(path).isSymbolicLink()) fail(`evidence file may not be a symbolic link: ${entry.name}`);
      return JSON.parse(readFileSync(path, 'utf8'));
    });
}

export function readPrototypeReviewStatus(projectRoot, slug) {
  const root = prototypeReviewEvidenceRoot(projectRoot, slug);
  const planReviews = readJsonFiles(resolve(root, 'plans')).sort((left, right) => left.reviewedAt.localeCompare(right.reviewedAt));
  const cycleReviews = readJsonFiles(resolve(root, 'cycles')).sort((left, right) => left.reviewedAt.localeCompare(right.reviewedAt));
  return {
    schema: 'ewai.prototype-review-status/v1',
    deliverySlug: token(slug, 'delivery slug'),
    planReviews,
    cycleReviews,
    currentPlanReview: planReviews.at(-1) ?? null,
    currentCycleReview: cycleReviews.at(-1) ?? null,
    authority: {
      evidenceIsAdvisory: true,
      humanPrototypeSelectionRequired: true,
      manualQaRemainsSeparate: true,
    },
  };
}

function change(left, right, explanation) {
  return { status: left === right ? 'same' : 'changed', left, right, explanation };
}

export function comparePrototypeReviews(leftInput, rightInput) {
  const left = object(leftInput, 'left prototype review');
  const right = object(rightInput, 'right prototype review');
  const changes = {
    inputs: change(left.inputFingerprint, right.inputFingerprint, 'The intent, design system, predecessor, or reviewed prototype input changed.'),
    personas: change(left.personaFingerprint, right.personaFingerprint, 'The stage-specific active or available persona set changed.'),
    findings: change(hash(left.findings ?? []), hash(right.findings ?? []), 'Persona findings changed after input and persona selection.'),
    assessments: change(hash(left.assessments ?? []), hash(right.assessments ?? []), 'Finding dispositions or accountable rationale changed.'),
    output: change(left.contentDigest, right.contentDigest, 'The immutable review output changed.'),
  };
  const upstreamChanged = ['inputs', 'personas', 'findings', 'assessments'].some((field) => changes[field].status === 'changed');
  const unexplained = changes.output.status === 'changed' && !upstreamChanged
    ? [{ field: 'output', reason: 'The output changed without an observable input, persona, finding, or assessment change.' }]
    : [];
  return {
    schema: 'ewai.prototype-review-comparison/v1',
    order: ['inputs', 'personas', 'findings', 'assessments', 'output'],
    changes,
    reproducible: unexplained.length === 0,
    unexplained,
  };
}
