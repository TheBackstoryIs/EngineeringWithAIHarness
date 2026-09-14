import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { atomicJson, isWithin, sha256 } from './delivery-documents.mjs';
import { projectPaths } from './paths.mjs';

export const EVIDENCE_DEPTH_DIMENSIONS = Object.freeze([
  'architecture',
  'data',
  'security',
  'product',
  'delivery',
  'governance',
  'operations',
]);

export const EVIDENCE_DEPTH_LEVELS = Object.freeze(['bounded', 'standard', 'deep']);

const dimensionCodes = Object.freeze({
  architecture: 'ARC', data: 'DAT', security: 'SEC', product: 'PRO',
  delivery: 'DEL', governance: 'GOV', operations: 'OPS',
});
const evidenceAuthorities = new Set(['observed', 'inferred', 'declared', 'confirmed', 'advisory', 'decided']);
const coverageStatuses = new Set(['supported', 'partial', 'owner-evidence-required', 'contradictory', 'blocked', 'not-applicable']);
const contradictionStates = new Set(['none', 'declared-versus-observed', 'observed-versus-observed', 'declared-versus-declared', 'unresolved']);
const gapDispositions = new Set(['open', 'resolved', 'deferred', 'excluded', 'shared']);
const groupingDispositions = new Set(['owned', 'shared', 'deferred', 'excluded']);
const tiers = new Set(['project', 'premium', 'personal', 'core']);
const safeTokenPattern = /^[a-z0-9][a-z0-9._:@/-]{0,199}$/i;
const digestPattern = /^sha256:[a-z0-9._-]{3,200}$/i;

function fail(message) {
  throw new Error(`Evidence depth: ${message}`);
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function knownFields(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label} has unknown field ${key}`);
}

function text(value, label, maximum = 200, { optional = false } = {}) {
  const cleaned = String(value ?? '').trim();
  if (!cleaned && !optional) fail(`${label} is required`);
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

function digest(value, label) {
  const cleaned = text(value, label, 220);
  if (!digestPattern.test(cleaned)) fail(`${label} must be a sha256 identifier`);
  return cleaned.toLowerCase();
}

function boundedInteger(value, label, maximum = 1_000_000) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maximum) fail(`${label} must be an integer from 0 to ${maximum}`);
  return parsed;
}

function list(value, label, maximum) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  if (value.length > maximum) fail(`${label} exceeds ${maximum} entries`);
  return value;
}

function uniqueSorted(values, label, maximum = 200) {
  const result = list(values ?? [], label, maximum).map((value, index) => token(value, `${label} ${index + 1}`));
  if (new Set(result).size !== result.length) fail(`${label} contains duplicate values`);
  return result.sort((left, right) => left.localeCompare(right));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function hash(value) {
  return `sha256:${sha256(canonicalJson(value))}`;
}

function normalizeProvider(value = {}) {
  const provider = object(value, 'provider');
  knownFields(provider, ['id', 'modelFamily', 'capabilityRevision'], 'provider');
  return {
    id: token(provider.id ?? 'unspecified', 'provider id'),
    modelFamily: token(provider.modelFamily ?? 'unspecified', 'provider model family'),
    capabilityRevision: token(provider.capabilityRevision ?? 'unspecified', 'provider capability revision'),
  };
}

function normalizeSourceMap(value) {
  const source = object(value, 'sourceMap');
  knownFields(source, ['runId', 'digest', 'profileDigest', 'freshness'], 'sourceMap');
  const freshness = token(source.freshness, 'Source Map freshness');
  if (!['fresh', 'stale'].includes(freshness)) fail('Source Map freshness must be fresh or stale');
  return {
    runId: boundedInteger(source.runId, 'Source Map run ID'),
    digest: digest(source.digest, 'Source Map digest'),
    profileDigest: digest(source.profileDigest, 'Source Map profile digest'),
    freshness,
  };
}

function normalizePersonas(value) {
  const personas = list(value, 'personas', 8).map((entry, index) => {
    const persona = object(entry, `persona ${index + 1}`);
    knownFields(persona, ['id', 'tier', 'reasonCode'], `persona ${index + 1}`);
    const tier = token(persona.tier, `persona ${index + 1} tier`);
    if (!tiers.has(tier)) fail(`persona ${index + 1} tier is unsupported`);
    return {
      id: token(persona.id, `persona ${index + 1} id`),
      tier,
      reasonCode: token(persona.reasonCode, `persona ${index + 1} reason code`),
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(personas.map(({ id }) => id)).size !== personas.length) fail('personas contains duplicate IDs');
  return personas;
}

function normalizeEvidence(value) {
  const entries = list(value, 'evidence', 500).map((entry, index) => {
    const item = object(entry, `evidence ${index + 1}`);
    knownFields(item, ['id', 'authority', 'kind', 'digest'], `evidence ${index + 1}`);
    const authority = token(item.authority, `evidence ${index + 1} authority`);
    if (!evidenceAuthorities.has(authority)) fail(`evidence ${index + 1} authority is unsupported`);
    return {
      id: token(item.id, `evidence ${index + 1} id`),
      authority,
      kind: token(item.kind, `evidence ${index + 1} kind`),
      digest: digest(item.digest, `evidence ${index + 1} digest`),
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(entries.map(({ id }) => id)).size !== entries.length) fail('evidence contains duplicate IDs');
  return entries;
}

function normalizeCoverage(value, label) {
  const coverage = object(value, `${label} coverage`);
  knownFields(coverage, ['status', 'required', 'supported', 'excluded', 'failed'], `${label} coverage`);
  const status = token(coverage.status, `${label} coverage status`);
  if (!coverageStatuses.has(status)) fail(`${label} coverage status is unsupported`);
  const normalized = {
    status,
    required: boundedInteger(coverage.required, `${label} required coverage`, 10_000),
    supported: boundedInteger(coverage.supported, `${label} supported coverage`, 10_000),
    excluded: boundedInteger(coverage.excluded ?? 0, `${label} excluded coverage`, 10_000),
    failed: boundedInteger(coverage.failed ?? 0, `${label} failed coverage`, 10_000),
  };
  if (normalized.supported > normalized.required) fail(`${label} supported coverage cannot exceed required coverage`);
  return normalized;
}

function normalizeDimensions(value, evidenceIds) {
  const byId = new Map();
  for (const [index, entry] of list(value, 'dimensions', 7).entries()) {
    const dimension = object(entry, `dimension ${index + 1}`);
    knownFields(dimension, ['id', 'recommendedDepth', 'drivers', 'evidenceRefs', 'coverage'], `dimension ${index + 1}`);
    const id = token(dimension.id, `dimension ${index + 1} id`);
    if (!EVIDENCE_DEPTH_DIMENSIONS.includes(id)) fail(`dimension ${id} is unsupported`);
    if (byId.has(id)) fail(`dimension ${id} is duplicated`);
    const recommendedDepth = token(dimension.recommendedDepth, `${id} recommended depth`);
    if (!EVIDENCE_DEPTH_LEVELS.includes(recommendedDepth)) fail(`${id} recommended depth is unsupported`);
    const evidenceRefs = uniqueSorted(dimension.evidenceRefs, `${id} evidence references`, 100);
    for (const reference of evidenceRefs) if (!evidenceIds.has(reference)) fail(`${id} references unknown evidence ${reference}`);
    byId.set(id, {
      id,
      recommendedDepth,
      drivers: uniqueSorted(dimension.drivers, `${id} drivers`, 20),
      evidenceRefs,
      coverage: normalizeCoverage(dimension.coverage, id),
    });
  }
  if (byId.size !== EVIDENCE_DEPTH_DIMENSIONS.length) fail('dimensions must contain every evidence-depth dimension exactly once');
  return EVIDENCE_DEPTH_DIMENSIONS.map((id) => byId.get(id));
}

function normalizeGaps(value, evidenceIds) {
  const gaps = list(value, 'gaps', 200).map((entry, index) => {
    const gap = object(entry, `gap ${index + 1}`);
    knownFields(gap, ['dimension', 'condition', 'currentStateCode', 'intendedStateCode', 'evidenceRefs', 'contradiction', 'owner', 'disposition'], `gap ${index + 1}`);
    const dimension = token(gap.dimension, `gap ${index + 1} dimension`);
    if (!EVIDENCE_DEPTH_DIMENSIONS.includes(dimension)) fail(`gap ${index + 1} dimension is unsupported`);
    const contradiction = token(gap.contradiction ?? 'none', `gap ${index + 1} contradiction`);
    if (!contradictionStates.has(contradiction)) fail(`gap ${index + 1} contradiction is unsupported`);
    const disposition = token(gap.disposition ?? 'open', `gap ${index + 1} disposition`);
    if (!gapDispositions.has(disposition)) fail(`gap ${index + 1} disposition is unsupported`);
    const identity = {
      dimension,
      condition: token(gap.condition, `gap ${index + 1} condition`),
      currentStateCode: token(gap.currentStateCode, `gap ${index + 1} current state code`),
      intendedStateCode: token(gap.intendedStateCode, `gap ${index + 1} intended state code`),
      evidenceRefs: uniqueSorted(gap.evidenceRefs, `gap ${index + 1} evidence references`, 50),
    };
    for (const reference of identity.evidenceRefs) if (!evidenceIds.has(reference)) fail(`gap ${index + 1} references unknown evidence ${reference}`);
    return {
      id: `GAP-${dimensionCodes[dimension]}-${sha256(canonicalJson(identity)).slice(0, 12)}`,
      ...identity,
      contradiction,
      owner: token(gap.owner ?? 'unassigned', `gap ${index + 1} owner`),
      disposition,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(gaps.map(({ id }) => id)).size !== gaps.length) fail('gaps contains duplicate stable identities');
  return gaps;
}

function normalizeInput(value) {
  const input = object(value, 'input');
  knownFields(input, [
    'schema', 'projectFingerprint', 'sourceMap', 'contractVersions', 'packVersions',
    'provider', 'exclusions', 'predecessorId', 'personas', 'evidence', 'dimensions',
    'gaps', 'grouping',
  ], 'input');
  if (input.schema !== 'ewai.evidence-depth-input/v1') fail('input schema must be ewai.evidence-depth-input/v1');
  const evidence = normalizeEvidence(input.evidence);
  const evidenceIds = new Set(evidence.map(({ id }) => id));
  const grouping = object(input.grouping ?? {}, 'grouping proposal');
  knownFields(grouping, ['strategy', 'assignments'], 'grouping proposal');
  return {
    schema: input.schema,
    projectFingerprint: digest(input.projectFingerprint, 'project fingerprint'),
    sourceMap: normalizeSourceMap(input.sourceMap),
    contractVersions: uniqueSorted(input.contractVersions, 'contract versions', 50),
    packVersions: uniqueSorted(input.packVersions, 'pack versions', 50),
    provider: normalizeProvider(input.provider),
    exclusions: uniqueSorted(input.exclusions, 'exclusions', 100),
    predecessorId: token(input.predecessorId ?? '', 'predecessor ID', { optional: true }),
    personas: normalizePersonas(input.personas),
    evidence,
    dimensions: normalizeDimensions(input.dimensions, evidenceIds),
    gaps: normalizeGaps(input.gaps, evidenceIds),
    groupingStrategy: token(grouping.strategy ?? 'user-outcome', 'grouping strategy'),
  };
}

function preparationIdentity(normalized) {
  return {
    schema: 'ewai.evidence-depth-identity/v1',
    projectFingerprint: normalized.projectFingerprint,
    sourceMap: normalized.sourceMap,
    contractVersions: normalized.contractVersions,
    packVersions: normalized.packVersions,
    provider: normalized.provider,
    exclusions: normalized.exclusions,
    predecessorId: normalized.predecessorId,
    personas: normalized.personas,
    evidence: normalized.evidence,
    dimensions: normalized.dimensions,
    gaps: normalized.gaps,
  };
}

export function prepareEvidenceDepth(input, options = {}) {
  const normalized = normalizeInput(input);
  if (normalized.sourceMap.freshness !== 'fresh') fail('a fresh Source Map is required for preparation');
  const identity = preparationIdentity(normalized);
  const preparationDigest = hash(identity);
  return {
    schema: 'ewai.evidence-depth-preparation/v1',
    preparedAt: options.now ?? new Date().toISOString(),
    preparationDigest,
    inputFingerprint: hash({ projectFingerprint: normalized.projectFingerprint, sourceMap: normalized.sourceMap, contractVersions: normalized.contractVersions, packVersions: normalized.packVersions, provider: normalized.provider, exclusions: normalized.exclusions, predecessorId: normalized.predecessorId }),
    evidenceFingerprint: hash(normalized.evidence),
    personaFingerprint: hash(normalized.personas),
    depthFingerprint: hash(normalized.dimensions.map(({ id, recommendedDepth, drivers }) => ({ id, recommendedDepth, drivers }))),
    coverageFingerprint: hash(normalized.dimensions.map(({ id, coverage }) => ({ id, coverage }))),
    gapFingerprint: hash(normalized.gaps.map(({ id, contradiction, disposition, owner }) => ({ id, contradiction, disposition, owner }))),
    sourceMap: normalized.sourceMap,
    provider: normalized.provider,
    contractVersions: normalized.contractVersions,
    packVersions: normalized.packVersions,
    exclusions: normalized.exclusions,
    predecessorId: normalized.predecessorId,
    activePersonas: normalized.personas,
    evidence: normalized.evidence,
    dimensions: normalized.dimensions,
    gaps: normalized.gaps,
    proposedGroupingStrategy: normalized.groupingStrategy,
    guidance: {
      advisory: true,
      humanReviewRequired: true,
      intentCountIsDepth: false,
      repositoryEvidenceAuthority: 'observed-or-inferred',
      ownerEvidenceAuthority: 'declared-or-confirmed',
    },
  };
}

export function validateEvidenceDepthPreparation(value) {
  const preparation = object(value, 'preparation');
  knownFields(preparation, [
    'schema', 'preparedAt', 'preparationDigest', 'inputFingerprint', 'evidenceFingerprint',
    'personaFingerprint', 'depthFingerprint', 'coverageFingerprint', 'gapFingerprint',
    'sourceMap', 'provider', 'contractVersions', 'packVersions', 'exclusions',
    'predecessorId', 'activePersonas', 'evidence', 'dimensions', 'gaps',
    'proposedGroupingStrategy', 'guidance',
  ], 'preparation');
  if (preparation.schema !== 'ewai.evidence-depth-preparation/v1') fail('preparation schema is unsupported');
  const evidence = normalizeEvidence(preparation.evidence);
  const evidenceIds = new Set(evidence.map(({ id }) => id));
  const dimensions = normalizeDimensions(preparation.dimensions, evidenceIds);
  const gapInputs = list(preparation.gaps, 'prepared gaps', 200).map((entry, index) => {
    const gap = object(entry, `prepared gap ${index + 1}`);
    knownFields(gap, ['id', 'dimension', 'condition', 'currentStateCode', 'intendedStateCode', 'evidenceRefs', 'contradiction', 'owner', 'disposition'], `prepared gap ${index + 1}`);
    const { id, ...input } = gap;
    return { id: token(id, `prepared gap ${index + 1} ID`), input };
  });
  const gaps = normalizeGaps(gapInputs.map(({ input }) => input), evidenceIds);
  for (const gap of gaps) {
    const supplied = gapInputs.find(({ id }) => id === gap.id);
    if (!supplied) fail(`prepared gap identity does not match ${gap.id}`);
  }
  const guidance = object(preparation.guidance, 'preparation guidance');
  knownFields(guidance, ['advisory', 'humanReviewRequired', 'intentCountIsDepth', 'repositoryEvidenceAuthority', 'ownerEvidenceAuthority'], 'preparation guidance');
  if (guidance.advisory !== true || guidance.humanReviewRequired !== true || guidance.intentCountIsDepth !== false) {
    fail('preparation guidance authority is invalid');
  }
  const normalized = {
    schema: preparation.schema,
    preparedAt: text(preparation.preparedAt, 'preparedAt', 80),
    preparationDigest: digest(preparation.preparationDigest, 'preparation digest'),
    inputFingerprint: digest(preparation.inputFingerprint, 'input fingerprint'),
    evidenceFingerprint: digest(preparation.evidenceFingerprint, 'evidence fingerprint'),
    personaFingerprint: digest(preparation.personaFingerprint, 'persona fingerprint'),
    depthFingerprint: digest(preparation.depthFingerprint, 'depth fingerprint'),
    coverageFingerprint: digest(preparation.coverageFingerprint, 'coverage fingerprint'),
    gapFingerprint: digest(preparation.gapFingerprint, 'gap fingerprint'),
    sourceMap: normalizeSourceMap(preparation.sourceMap),
    provider: normalizeProvider(preparation.provider),
    contractVersions: uniqueSorted(preparation.contractVersions, 'contract versions', 50),
    packVersions: uniqueSorted(preparation.packVersions, 'pack versions', 50),
    exclusions: uniqueSorted(preparation.exclusions, 'exclusions', 100),
    predecessorId: token(preparation.predecessorId ?? '', 'predecessor ID', { optional: true }),
    activePersonas: normalizePersonas(preparation.activePersonas),
    evidence,
    dimensions,
    gaps,
    proposedGroupingStrategy: token(preparation.proposedGroupingStrategy, 'proposed grouping strategy'),
    guidance: {
      advisory: true,
      humanReviewRequired: true,
      intentCountIsDepth: false,
      repositoryEvidenceAuthority: token(guidance.repositoryEvidenceAuthority, 'repository evidence authority'),
      ownerEvidenceAuthority: token(guidance.ownerEvidenceAuthority, 'owner evidence authority'),
    },
  };
  for (const field of ['evidenceFingerprint', 'personaFingerprint', 'depthFingerprint', 'coverageFingerprint', 'gapFingerprint']) {
    const expected = {
      evidenceFingerprint: hash(normalized.evidence),
      personaFingerprint: hash(normalized.activePersonas),
      depthFingerprint: hash(normalized.dimensions.map(({ id, recommendedDepth, drivers }) => ({ id, recommendedDepth, drivers }))),
      coverageFingerprint: hash(normalized.dimensions.map(({ id, coverage }) => ({ id, coverage }))),
      gapFingerprint: hash(normalized.gaps.map(({ id, contradiction, disposition, owner }) => ({ id, contradiction, disposition, owner }))),
    }[field];
    if (normalized[field] !== expected) fail(`${field} does not match the preparation content`);
  }
  return normalized;
}

function normalizeDimensionReview(preparation, value) {
  const byId = new Map();
  for (const [index, entry] of list(value, 'review dimensions', 7).entries()) {
    const decision = object(entry, `review dimension ${index + 1}`);
    knownFields(decision, ['id', 'selectedDepth', 'rationale'], `review dimension ${index + 1}`);
    const id = token(decision.id, `review dimension ${index + 1} id`);
    const source = preparation.dimensions.find((dimension) => dimension.id === id);
    if (!source) fail(`review dimension ${id} is unsupported`);
    if (byId.has(id)) fail(`review dimension ${id} is duplicated`);
    const selectedDepth = token(decision.selectedDepth, `${id} selected depth`);
    if (!EVIDENCE_DEPTH_LEVELS.includes(selectedDepth)) fail(`${id} selected depth is unsupported`);
    const rationale = text(decision.rationale ?? '', `${id} rationale`, 500, { optional: true });
    if (EVIDENCE_DEPTH_LEVELS.indexOf(selectedDepth) < EVIDENCE_DEPTH_LEVELS.indexOf(source.recommendedDepth) && rationale.length < 12) {
      fail(`${id} requires a substantive rationale to reduce recommended depth`);
    }
    byId.set(id, { id, recommendedDepth: source.recommendedDepth, selectedDepth, rationale });
  }
  if (byId.size !== 7) fail('review dimensions must contain every evidence-depth dimension exactly once');
  return EVIDENCE_DEPTH_DIMENSIONS.map((id) => byId.get(id));
}

function normalizeGrouping(preparation, value) {
  const grouping = object(value, 'review grouping');
  knownFields(grouping, ['strategy', 'assignments'], 'review grouping');
  const gapIds = new Set(preparation.gaps.map(({ id }) => id));
  const assignments = list(grouping.assignments, 'grouping assignments', 200).map((entry, index) => {
    const assignment = object(entry, `grouping assignment ${index + 1}`);
    knownFields(assignment, ['gapId', 'groupId', 'disposition'], `grouping assignment ${index + 1}`);
    const gapId = token(assignment.gapId, `grouping assignment ${index + 1} gap ID`);
    if (!gapIds.has(gapId)) fail(`grouping assignment references unknown gap ${gapId}`);
    const disposition = token(assignment.disposition, `grouping assignment ${index + 1} disposition`);
    if (!groupingDispositions.has(disposition)) fail(`grouping assignment ${index + 1} disposition is unsupported`);
    return { gapId, groupId: token(assignment.groupId, `grouping assignment ${index + 1} group ID`), disposition };
  }).sort((left, right) => left.gapId.localeCompare(right.gapId));
  if (new Set(assignments.map(({ gapId }) => gapId)).size !== assignments.length) fail('each gap may appear in grouping exactly once');
  if (assignments.length !== preparation.gaps.length) fail('every eligible gap must appear in grouping exactly once');
  return { strategy: token(grouping.strategy, 'grouping strategy'), assignments };
}

function runIdentity(preparation, reviewedBy, dimensions, grouping) {
  return {
    schema: 'ewai.evidence-depth-run-identity/v1',
    preparationDigest: preparation.preparationDigest,
    reviewedBy,
    dimensions: dimensions.map(({ id, recommendedDepth, selectedDepth }) => ({ id, recommendedDepth, selectedDepth })),
    grouping,
  };
}

function evidenceRoot(projectRoot) {
  const { specsRoot } = projectPaths(projectRoot);
  const root = resolve(specsRoot, '3.Evidence/discovery-depth/runs');
  if (!isWithin(specsRoot, root)) fail('configured evidence root is unsafe');
  return root;
}

export function recordEvidenceDepthRun(projectRoot, preparation, input, options = {}) {
  preparation = validateEvidenceDepthPreparation(preparation);
  const review = object(input, 'review');
  knownFields(review, ['schema', 'expectedPreparationDigest', 'reviewedBy', 'dimensions', 'grouping'], 'review');
  if (review.schema !== 'ewai.evidence-depth-review/v1') fail('review schema must be ewai.evidence-depth-review/v1');
  if (review.expectedPreparationDigest !== preparation.preparationDigest) fail('a newer preparation exists or the expected digest is stale');
  const reviewedBy = text(review.reviewedBy, 'reviewedBy', 120);
  const dimensions = normalizeDimensionReview(preparation, review.dimensions);
  const grouping = normalizeGrouping(preparation, review.grouping);
  const identity = runIdentity(preparation, reviewedBy, dimensions, grouping);
  const runId = sha256(canonicalJson(identity)).slice(0, 16);
  const stable = {
    schema: 'ewai.evidence-depth-run/v1',
    runId,
    preparationDigest: preparation.preparationDigest,
    reviewedBy,
    inputFingerprint: preparation.inputFingerprint,
    evidenceFingerprint: preparation.evidenceFingerprint,
    personaFingerprint: preparation.personaFingerprint,
    depthFingerprint: hash(dimensions.map(({ id, recommendedDepth, selectedDepth }) => ({ id, recommendedDepth, selectedDepth }))),
    coverageFingerprint: preparation.coverageFingerprint,
    gapFingerprint: preparation.gapFingerprint,
    groupingFingerprint: hash(grouping),
    sourceMap: preparation.sourceMap,
    provider: preparation.provider,
    activePersonas: preparation.activePersonas,
    dimensions,
    gaps: preparation.gaps,
    grouping,
  };
  const contentDigest = hash(stable);
  const run = { ...stable, contentDigest, recordedAt: options.now ?? new Date().toISOString() };
  if (options.persist !== false) {
    if (!projectRoot) fail('project root is required to persist a reviewed run');
    const root = evidenceRoot(projectRoot);
    const path = resolve(root, `${runId}.json`);
    if (!isWithin(root, path)) fail('run path is unsafe');
    if (existsSync(path)) {
      const existing = JSON.parse(readFileSync(path, 'utf8'));
      if (existing.contentDigest !== contentDigest) fail(`run ${runId} conflicts with existing evidence`);
    } else {
      atomicJson(path, run);
    }
  }
  return {
    schema: 'ewai.evidence-depth-recording/v1',
    status: options.persist === false ? 'prepared' : 'recorded',
    runId,
    contentDigest,
    run,
  };
}

function validateRun(run, label) {
  const value = object(run, label);
  if (value.schema !== 'ewai.evidence-depth-run/v1') fail(`${label} schema is unsupported`);
  token(value.runId, `${label} run ID`);
  for (const field of ['contentDigest', 'preparationDigest', 'inputFingerprint', 'evidenceFingerprint', 'personaFingerprint', 'depthFingerprint', 'coverageFingerprint', 'gapFingerprint', 'groupingFingerprint']) {
    digest(value[field], `${label} ${field}`);
  }
  return value;
}

function change(left, right, explanation) {
  const changed = left !== right;
  return { status: changed ? 'changed' : 'same', explained: !changed || Boolean(explanation), ...(changed && explanation ? { explanation } : {}) };
}

export function compareEvidenceDepthRuns(leftInput, rightInput) {
  const left = validateRun(leftInput, 'left run');
  const right = validateRun(rightInput, 'right run');
  const inputs = change(left.inputFingerprint, right.inputFingerprint, 'The governed project, Source Map, contract, pack, provider or exclusion input changed.');
  const evidence = change(left.evidenceFingerprint, right.evidenceFingerprint, inputs.status === 'changed' ? 'The governed evidence set changed with the run inputs.' : 'The governed evidence set changed.');
  const personas = change(left.personaFingerprint, right.personaFingerprint, 'The active persona identity or tier set changed.');
  const depth = change(left.depthFingerprint, right.depthFingerprint, 'The recommended or owner-selected depth profile changed.');
  const gaps = change(left.gapFingerprint, right.gapFingerprint, evidence.status === 'changed' || depth.status === 'changed' ? 'Stable gaps changed alongside evidence or depth.' : '');
  const grouping = change(left.groupingFingerprint, right.groupingFingerprint, 'The explicit gap-grouping strategy or assignment changed.');
  const coverage = change(left.coverageFingerprint, right.coverageFingerprint, inputs.status === 'changed' || evidence.status === 'changed' || depth.status === 'changed' ? 'Coverage changed alongside a material input, evidence or depth change.' : '');
  const changes = { inputs, evidence, personas, depth, coverage, gaps, grouping };
  const unexplained = Object.entries(changes)
    .filter(([, value]) => value.status === 'changed' && value.explained === false)
    .map(([field]) => ({ field, reason: `The ${field} fingerprint changed without a material upstream explanation.` }));
  return {
    schema: 'ewai.evidence-depth-comparison/v1',
    leftRunId: left.runId,
    rightRunId: right.runId,
    order: ['inputs', 'evidence', 'personas', 'depth', 'coverage', 'gaps', 'grouping'],
    changes,
    unexplained,
    reproducible: unexplained.length === 0,
    guidance: { comparisonIsApproval: false, intentCountIsDepth: false },
  };
}

export function readEvidenceDepthRun(projectRoot, runId) {
  const safeId = token(runId, 'run ID');
  const root = evidenceRoot(projectRoot);
  const path = resolve(root, `${safeId}.json`);
  if (!isWithin(root, path) || !existsSync(path) || lstatSync(path).isSymbolicLink()) fail(`run ${safeId} does not exist`);
  return validateRun(JSON.parse(readFileSync(path, 'utf8')), `run ${safeId}`);
}

export function readEvidenceDepthStatus(projectRoot) {
  const root = evidenceRoot(projectRoot);
  if (!existsSync(root)) return { schema: 'ewai.evidence-depth-status/v1', status: 'not-prepared', runs: [] };
  const runs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && /^[a-f0-9]{16}\.json$/.test(entry.name))
    .map((entry) => validateRun(JSON.parse(readFileSync(resolve(root, entry.name), 'utf8')), entry.name))
    .sort((left, right) => String(right.recordedAt ?? '').localeCompare(String(left.recordedAt ?? '')))
    .map((run) => ({ runId: run.runId, contentDigest: run.contentDigest, preparationDigest: run.preparationDigest, recordedAt: run.recordedAt, reviewedBy: run.reviewedBy }));
  return { schema: 'ewai.evidence-depth-status/v1', status: runs.length ? 'recorded' : 'not-prepared', runs };
}
