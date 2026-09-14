import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  EVIDENCE_DEPTH_DIMENSIONS,
  compareEvidenceDepthRuns,
  prepareEvidenceDepth,
  readEvidenceDepthRun,
  readEvidenceDepthStatus,
  recordEvidenceDepthRun,
  validateEvidenceDepthPreparation,
} from '../evidence-depth.mjs';
import { atomicJson } from '../delivery-documents.mjs';
import { projectPaths } from '../paths.mjs';
import { repositoryIndexFreshness, repositoryIndexStatus, repositorySourceMapCoverage } from './repository-index.mjs';
import { runtimePaths } from './paths.mjs';
import { selectEvidenceDepthPersonas } from './persona-engagement.mjs';

const WORKSPACE_SCHEMA = 'ewai.evidence-depth-workspace/v1';
const MAX_PREPARATION_PERSONAS = 8;
const ownerAuthorities = new Set(['declared', 'confirmed']);
const contradictionStates = new Set(['none', 'declared-versus-observed', 'observed-versus-observed', 'declared-versus-declared', 'unresolved']);
const questionText = Object.freeze({
  'missing-owner-boundary': 'Which systems or identities are intended to cross this boundary?',
  'missing-data-classification': 'Which data classifications and handling limits apply here?',
  'missing-product-outcome': 'Which owner-confirmed user outcome should this behaviour support?',
  'missing-delivery-expectation': 'Which delivery and validation expectations must remain mandatory?',
  'missing-governance-owner': 'Who owns the applicable governance decision and review?',
  'missing-recovery-owner': 'Who owns recovery, and what outcome must restoration achieve?',
  'source-map-analysis-failures': 'How should the retained Source Map analysis failures be resolved or bounded?',
});

function fail(message) {
  const error = new Error(`Evidence depth workspace: ${message}`);
  error.statusCode = 409;
  throw error;
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function knownFields(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label} has unknown field ${key}`);
}

function safeText(value, label, maximum = 200, optional = false) {
  const cleaned = String(value ?? '').trim();
  if (!cleaned && !optional) fail(`${label} is required`);
  if (cleaned.length > maximum || cleaned.includes('..') || cleaned.startsWith('/')) fail(`${label} must be a bounded safe value`);
  return cleaned;
}

function hash(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function statusSummary(status) {
  const run = status?.run ?? {};
  const parsed = (() => {
    try { return typeof run.summary === 'string' ? JSON.parse(run.summary) : run.summary ?? {}; } catch { return {}; }
  })();
  const repositories = Number(status?.repositories ?? parsed.repositories ?? (() => {
    try { return Object.keys(JSON.parse(run.repos_json ?? '{}')).length; } catch { return 0; }
  })());
  return {
    runId: Number(status?.runId ?? run.id ?? 0),
    repositories: Number.isFinite(repositories) ? repositories : 0,
    files: Number(status?.files ?? status?.counts?.files ?? parsed.files ?? 0),
    parsed: Number(status?.parsed ?? status?.counts?.parsed ?? parsed.parsed ?? 0),
    symbols: Number(status?.symbols ?? parsed.symbols ?? 0),
    profileDigest: String(status?.profileDigest ?? run.profile_digest ?? 'unspecified'),
  };
}

function coverageSummary(coverage) {
  const outcomes = coverage?.outcomes ?? {};
  return {
    runId: Number(coverage?.runId ?? 0),
    outcomes: {
      analysed: Number(outcomes.analysed ?? 0),
      inventory_only: Number(outcomes.inventory_only ?? 0),
      skipped_sensitive: Number(outcomes.skipped_sensitive ?? 0),
      skipped_oversized: Number(outcomes.skipped_oversized ?? 0),
      analysis_failed: Number(outcomes.analysis_failed ?? 0),
    },
    warningCount: Array.isArray(coverage?.warnings) ? coverage.warnings.length : 0,
  };
}

function readSourceMap(projectRoot, provided) {
  if (provided) {
    const source = object(provided, 'Source Map fixture');
    return { freshness: source.freshness, status: source.status, coverage: source.coverage };
  }
  return {
    freshness: repositoryIndexFreshness(projectRoot),
    status: repositoryIndexStatus(projectRoot),
    coverage: repositorySourceMapCoverage(projectRoot),
  };
}

function normalizeOwnerEvidence(value = []) {
  if (!Array.isArray(value) || value.length > 50) fail('ownerEvidence must contain at most 50 entries');
  const entries = value.map((item, index) => {
    const entry = object(item, `owner evidence ${index + 1}`);
    knownFields(entry, ['id', 'dimension', 'authority', 'evidenceDigest', 'answerCode', 'reasonCode', 'contradiction'], `owner evidence ${index + 1}`);
    const dimension = safeText(entry.dimension, `owner evidence ${index + 1} dimension`);
    if (!EVIDENCE_DEPTH_DIMENSIONS.includes(dimension)) fail(`owner evidence ${index + 1} dimension is unsupported`);
    const authority = safeText(entry.authority, `owner evidence ${index + 1} authority`);
    if (!ownerAuthorities.has(authority)) fail(`owner evidence ${index + 1} authority must be declared or confirmed`);
    const contradiction = safeText(entry.contradiction ?? 'none', `owner evidence ${index + 1} contradiction`);
    if (!contradictionStates.has(contradiction)) fail(`owner evidence ${index + 1} contradiction is unsupported`);
    return {
      id: safeText(entry.id, `owner evidence ${index + 1} id`),
      dimension,
      authority,
      evidenceDigest: safeText(entry.evidenceDigest, `owner evidence ${index + 1} digest`),
      answerCode: safeText(entry.answerCode, `owner evidence ${index + 1} answer code`),
      reasonCode: safeText(entry.reasonCode, `owner evidence ${index + 1} reason code`),
      contradiction,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(entries.map(({ id }) => id)).size !== entries.length) fail('ownerEvidence contains duplicate IDs');
  return entries;
}

function projectFingerprint(projectRoot) {
  const { configPath } = projectPaths(projectRoot);
  return hash({ pipeline: existsSync(configPath) ? createHash('sha256').update(readFileSync(configPath)).digest('hex') : 'missing' });
}

function recommendation(dimension, summary, coverage, ownerForDimension) {
  const large = summary.files >= 250 || summary.repositories > 1 || summary.symbols >= 1_000;
  const uncertain = coverage.outcomes.analysis_failed > 0 || coverage.outcomes.inventory_only > 0;
  const depth = {
    architecture: large ? 'deep' : 'standard',
    data: coverage.outcomes.skipped_sensitive > 0 || large ? 'deep' : 'standard',
    security: coverage.outcomes.skipped_sensitive > 0 || uncertain ? 'deep' : 'standard',
    product: ownerForDimension.length ? 'standard' : 'deep',
    delivery: uncertain || large ? 'deep' : 'standard',
    governance: large ? 'deep' : 'standard',
    operations: summary.repositories > 1 || !ownerForDimension.length ? 'deep' : 'standard',
  }[dimension];
  return depth;
}

function gapFor(dimension, condition, evidenceRefs, overrides = {}) {
  return {
    dimension,
    condition,
    currentStateCode: overrides.currentStateCode ?? 'repository-evidence-present',
    intendedStateCode: overrides.intendedStateCode ?? 'owner-evidence-required',
    evidenceRefs,
    contradiction: overrides.contradiction ?? 'none',
    owner: overrides.owner ?? 'project-owner',
    disposition: 'open',
  };
}

function filterEngagement(engagement, selectedIds) {
  return {
    ...engagement,
    activePersonas: engagement.activePersonas.filter(({ id }) => selectedIds.has(id)),
  };
}

function boundedPersonaEnsemble(currentEngagement, personasByDimension, currentDimension) {
  const selected = [];
  const selectedIds = new Set();
  const add = (persona, dimension) => {
    if (!persona || selectedIds.has(persona.id) || selected.length >= MAX_PREPARATION_PERSONAS) return;
    selectedIds.add(persona.id);
    selected.push({ persona, dimension });
  };
  const dimensions = [currentDimension, ...EVIDENCE_DEPTH_DIMENSIONS.filter((dimension) => dimension !== currentDimension)];

  add(currentEngagement.activePersonas[0], currentDimension);
  for (const dimension of dimensions) {
    const active = personasByDimension[dimension]?.activePersonas ?? [];
    add(active.find(({ id }) => !selectedIds.has(id)) ?? active[0], dimension);
  }
  for (const persona of currentEngagement.activePersonas) add(persona, currentDimension);
  for (const dimension of dimensions) {
    for (const persona of personasByDimension[dimension]?.activePersonas ?? []) add(persona, dimension);
  }

  return {
    personas: selected.map(({ persona, dimension }) => ({ id: persona.id, tier: persona.tier, reasonCode: `${dimension}-evidence-lens` })),
    currentEngagement: filterEngagement(currentEngagement, selectedIds),
    personasByDimension: Object.fromEntries(EVIDENCE_DEPTH_DIMENSIONS.map((dimension) => [
      dimension,
      filterEngagement(personasByDimension[dimension], selectedIds),
    ])),
  };
}

function buildInput(projectRoot, source, ownerEvidence, personas, input = {}) {
  const summary = statusSummary(source.status);
  const coverage = coverageSummary(source.coverage);
  const mapEvidence = EVIDENCE_DEPTH_DIMENSIONS.map((dimension) => ({
    id: `source-map:${dimension}`,
    authority: 'observed',
    kind: 'repository-fact',
    digest: hash({ runId: summary.runId, dimension, counts: coverage.outcomes, profileDigest: summary.profileDigest }),
  }));
  const ownerEntries = ownerEvidence.map((entry) => ({
    id: entry.id,
    authority: entry.authority,
    kind: 'owner-declaration',
    digest: entry.evidenceDigest,
  }));
  const evidence = [...mapEvidence, ...ownerEntries];
  const gaps = [];
  const dimensions = EVIDENCE_DEPTH_DIMENSIONS.map((dimension) => {
    const ownerForDimension = ownerEvidence.filter((entry) => entry.dimension === dimension);
    const evidenceRefs = [`source-map:${dimension}`, ...ownerForDimension.map(({ id }) => id)];
    const failed = dimension === 'architecture' || dimension === 'delivery' ? coverage.outcomes.analysis_failed : 0;
    const missingOwner = ['data', 'security', 'product', 'delivery', 'governance', 'operations'].includes(dimension) && ownerForDimension.length === 0;
    if (dimension === 'architecture' && coverage.outcomes.analysis_failed > 0) {
      gaps.push(gapFor(dimension, 'source-map-analysis-failures', evidenceRefs, { currentStateCode: 'bounded-analysis-failures-retained', intendedStateCode: 'failures-reviewed-or-bounded', owner: 'technical-owner' }));
    }
    if (missingOwner) {
      const condition = {
        data: 'missing-data-classification', security: 'missing-owner-boundary', product: 'missing-product-outcome',
        delivery: 'missing-delivery-expectation', governance: 'missing-governance-owner', operations: 'missing-recovery-owner',
      }[dimension];
      gaps.push(gapFor(dimension, condition, evidenceRefs));
    }
    for (const owner of ownerForDimension.filter(({ contradiction }) => contradiction !== 'none')) {
      gaps.push(gapFor(dimension, `contradictory-${owner.answerCode}`, evidenceRefs, { contradiction: owner.contradiction, currentStateCode: 'repository-and-owner-evidence-conflict', intendedStateCode: 'named-reconciliation-required' }));
    }
    const required = Math.max(1, 1 + ownerForDimension.length + (failed ? 1 : 0));
    const supported = Math.max(1, required - (missingOwner ? 1 : 0) - (failed ? 1 : 0));
    return {
      id: dimension,
      recommendedDepth: recommendation(dimension, summary, coverage, ownerForDimension),
      drivers: [
        summary.files >= 250 ? 'large-repository-surface' : 'bounded-repository-surface',
        summary.repositories > 1 ? 'multiple-repositories' : 'single-repository',
        coverage.outcomes.analysis_failed > 0 ? 'retained-analysis-failures' : 'analysis-complete-for-supported-files',
        ownerForDimension.length ? 'owner-evidence-present' : 'owner-evidence-missing',
      ],
      evidenceRefs,
      coverage: {
        status: ownerForDimension.some(({ contradiction }) => contradiction !== 'none') ? 'contradictory' : missingOwner ? 'owner-evidence-required' : failed ? 'partial' : 'supported',
        required,
        supported,
        excluded: coverage.outcomes.inventory_only + coverage.outcomes.skipped_sensitive + coverage.outcomes.skipped_oversized,
        failed,
      },
    };
  });
  const allConditions = gaps.map(({ condition }) => condition);
  const currentDimension = EVIDENCE_DEPTH_DIMENSIONS.find((dimension) => gaps.some((gap) => gap.dimension === dimension)) ?? 'architecture';
  const currentEngagement = selectEvidenceDepthPersonas({ dimension: currentDimension, gapConditions: allConditions, context: { focus: input.focus ?? '' } }, personas);
  const candidatePersonasByDimension = {};
  for (const dimension of EVIDENCE_DEPTH_DIMENSIONS) {
    candidatePersonasByDimension[dimension] = selectEvidenceDepthPersonas({ dimension, gapConditions: gaps.filter((gap) => gap.dimension === dimension).map(({ condition }) => condition), context: { focus: input.focus ?? '' } }, personas);
  }
  const bounded = boundedPersonaEnsemble(currentEngagement, candidatePersonasByDimension, currentDimension);
  return {
    input: {
      schema: 'ewai.evidence-depth-input/v1',
      projectFingerprint: projectFingerprint(projectRoot),
      sourceMap: {
        runId: summary.runId,
        digest: hash({ runId: summary.runId, counts: coverage.outcomes, files: summary.files, symbols: summary.symbols }),
        profileDigest: summary.profileDigest.startsWith('sha256:') ? summary.profileDigest : hash(summary.profileDigest),
        freshness: 'fresh',
      },
      contractVersions: ['ewai.archaeology/v1', 'ewai.discovery/v1', 'ewai.evidence-depth/v1'],
      packVersions: [],
      provider: { id: 'host-model', modelFamily: 'provider-neutral', capabilityRevision: 'structured-v1' },
      exclusions: [
        ...(coverage.outcomes.inventory_only ? ['inventory-only-files'] : []),
        ...(coverage.outcomes.skipped_sensitive ? ['sensitive-files'] : []),
        ...(coverage.outcomes.skipped_oversized ? ['oversized-files'] : []),
      ],
      predecessorId: '',
      personas: bounded.personas,
      evidence,
      dimensions,
      gaps,
      grouping: { strategy: 'user-outcome', assignments: [] },
    },
    currentDimension,
    personaEngagement: bounded.currentEngagement,
    personasByDimension: bounded.personasByDimension,
    coverage,
  };
}

function questions(preparation, personasByDimension) {
  return preparation.gaps.filter(({ disposition }) => disposition === 'open').map((gap) => ({
    id: `Q-${gap.id.slice(4)}`,
    gapId: gap.id,
    dimension: gap.dimension,
    prompt: questionText[gap.condition] ?? 'What owner evidence would resolve or appropriately bound this gap?',
    reasonCode: gap.condition,
    evidenceRefs: gap.evidenceRefs,
    activePersonas: personasByDimension[gap.dimension]?.activePersonas ?? [],
    resolutionRoute: gap.condition === 'source-map-analysis-failures' ? 'technical-review-or-explicit-bounded-disposition' : 'named-owner-declaration-or-honest-unknown',
  }));
}

function safeRuns(projectRoot) {
  try { return readEvidenceDepthStatus(projectRoot).runs; } catch { return []; }
}

function staleWorkspace(projectRoot, freshness) {
  return {
    schema: WORKSPACE_SCHEMA,
    status: freshness?.reason === 'no-completed-index-run' ? 'source-map-missing' : 'source-map-stale',
    freshness,
    runs: safeRuns(projectRoot),
    preparation: null,
    questions: [],
    activePersonas: [],
    recovery: { command: 'node bin/ewai index refresh --project .', label: 'Refresh Source Map' },
    authority: { repository: 'Source Map', owner: 'Guided Discovery', personas: 'advisory', depthDecision: 'named owner' },
  };
}

export function prepareEvidenceDepthWorkspace(projectRoot, input = {}, options = {}) {
  const request = object(input, 'prepare request');
  knownFields(request, ['focus'], 'prepare request');
  const source = readSourceMap(projectRoot, options.sourceMap);
  if (source.freshness?.status !== 'fresh' || source.freshness?.stale === true) {
    fail('refresh the Source Map before preparing a governed evidence-depth run');
  }
  const owners = normalizeOwnerEvidence(options.ownerEvidence ?? []);
  const composed = buildInput(projectRoot, source, owners, options.personas ?? [], request);
  const preparation = prepareEvidenceDepth(composed.input, { now: options.now });
  atomicJson(runtimePaths(projectRoot).evidenceDepthPreparationPath, preparation);
  const plannedQuestions = questions(preparation, composed.personasByDimension);
  return {
    schema: WORKSPACE_SCHEMA,
    status: plannedQuestions.length ? 'ready-to-investigate' : 'ready-to-group-gaps',
    freshness: source.freshness,
    coverage: composed.coverage,
    preparation,
    questions: plannedQuestions,
    currentDimension: composed.currentDimension,
    activePersonas: composed.personaEngagement.activePersonas,
    personasByDimension: composed.personasByDimension,
    runs: safeRuns(projectRoot),
    premium: composed.personaEngagement.premium,
    authority: { repository: 'Source Map', owner: 'Guided Discovery', personas: 'advisory', depthDecision: 'named owner' },
    recovery: null,
  };
}

export function readEvidenceDepthWorkspace(projectRoot, options = {}) {
  const source = readSourceMap(projectRoot, options.sourceMap);
  if (source.freshness?.status !== 'fresh' || source.freshness?.stale === true) return staleWorkspace(projectRoot, source.freshness);
  const path = runtimePaths(projectRoot).evidenceDepthPreparationPath;
  if (!existsSync(path)) {
    return {
      schema: WORKSPACE_SCHEMA,
      status: 'not-prepared',
      freshness: source.freshness,
      coverage: coverageSummary(source.coverage),
      preparation: null,
      questions: [],
      activePersonas: [],
      personasByDimension: {},
      runs: safeRuns(projectRoot),
      premium: { installed: (options.personas ?? []).some(({ tier }) => tier === 'premium'), reason: 'Prepare depth to engage relevant personas.' },
      authority: { repository: 'Source Map', owner: 'Guided Discovery', personas: 'advisory', depthDecision: 'named owner' },
      recovery: { command: 'node bin/ewai archaeology depth-prepare --project .', label: 'Prepare evidence depth' },
    };
  }
  const preparation = validateEvidenceDepthPreparation(JSON.parse(readFileSync(path, 'utf8')));
  const selectedIds = new Set(preparation.activePersonas.map(({ id }) => id));
  const personasByDimension = Object.fromEntries(EVIDENCE_DEPTH_DIMENSIONS.map((dimension) => [dimension, filterEngagement(
    selectEvidenceDepthPersonas({ dimension, gapConditions: preparation.gaps.filter((gap) => gap.dimension === dimension).map(({ condition }) => condition) }, options.personas ?? []),
    selectedIds,
  )]));
  const plannedQuestions = questions(preparation, personasByDimension);
  const currentDimension = EVIDENCE_DEPTH_DIMENSIONS.find((dimension) => plannedQuestions.some((question) => question.dimension === dimension)) ?? 'architecture';
  return {
    schema: WORKSPACE_SCHEMA,
    status: plannedQuestions.length ? 'ready-to-investigate' : 'ready-to-group-gaps',
    freshness: source.freshness,
    coverage: coverageSummary(source.coverage),
    preparation,
    questions: plannedQuestions,
    currentDimension,
    activePersonas: personasByDimension[currentDimension].activePersonas,
    personasByDimension,
    runs: safeRuns(projectRoot),
    premium: personasByDimension[currentDimension].premium,
    authority: { repository: 'Source Map', owner: 'Guided Discovery', personas: 'advisory', depthDecision: 'named owner' },
    recovery: null,
  };
}

export function recordEvidenceDepthWorkspaceRun(projectRoot, input, options = {}) {
  const path = runtimePaths(projectRoot).evidenceDepthPreparationPath;
  if (!existsSync(path)) fail('prepare evidence depth before recording a reviewed run');
  const preparation = validateEvidenceDepthPreparation(JSON.parse(readFileSync(path, 'utf8')));
  return recordEvidenceDepthRun(projectRoot, preparation, input, options);
}

export function compareEvidenceDepthWorkspaceRuns(projectRoot, input) {
  const request = object(input, 'comparison request');
  knownFields(request, ['leftRunId', 'rightRunId'], 'comparison request');
  const left = readEvidenceDepthRun(projectRoot, safeText(request.leftRunId, 'left run ID'));
  const right = readEvidenceDepthRun(projectRoot, safeText(request.rightRunId, 'right run ID'));
  return compareEvidenceDepthRuns(left, right);
}
