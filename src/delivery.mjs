import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  rmSync
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { updateIntentDeliveryState, validateIntentStateCopies } from './intents.mjs';
import { loadProjectConfig } from './project.mjs';
import { readRuntimeIntent } from './runtime/intents.mjs';
import { withIntentMutation, assertIntentMutation, intentOwnershipError } from './runtime/intent-ownership.mjs';
import {
  addActivityEvent,
  finishActiveSession,
  readWorkItemView,
  setPhase,
  startActiveSession,
  updateWorkItem
} from './runtime/work.mjs';
import { finishCommandRun, startCommandRun } from './runtime/runs.mjs';
import { publishLifecycleEventSafely } from './runtime/lifecycle-hooks.mjs';
import { assessSecurityReadiness, captureSecurityPolicy } from './runtime/security-validation.mjs';
import {
  atomicJson,
  atomicText,
  deliveryPaths,
  isWithin,
  now,
  sha256,
  writeDeliveryDocuments
} from './delivery-documents.mjs';
import { validatePhaseArtefacts } from './delivery-artifacts.mjs';
import {
  canonicalValidationProvider,
  effectiveValidationConfig,
  VALIDATION_PROVIDERS,
  validationCheckpointForPhase,
} from './validation-config.mjs';
import {
  assertCompletedEvidenceFresh,
  evidenceAbsolute,
  phaseGateTemplateAtPaths,
  readPassingGate,
  recordPhaseGateAtPaths,
  validatePhaseGateAtPaths
} from './delivery-gates.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const deliveryContract = YAML.parse(readFileSync(resolve(moduleDir, '../config/delivery-stages.yaml'), 'utf8'));
const terminalPhaseStatuses = new Set(['completed', 'approved', 'skipped', 'not-supported', 'waived']);
const acceptedIntentStatuses = new Set(['ready', 'approved']);

function newPhase(stage, options, validation) {
  let status = 'pending';
  let reason = '';
  const checkpointName = validationCheckpointForPhase(stage.id);
  const checkpoint = checkpointName ? validation.checkpoints[checkpointName] : null;
  if (stage.id === 'ideate' && !options.ideate) {
    status = 'skipped';
    reason = 'An intent already exists.';
  } else if (stage.id === 'reconcile' && !options.existingCode) {
    status = 'skipped';
    reason = 'No existing implementation is in scope.';
  } else if (stage.required === 'provider-gated' && !checkpoint?.enabled) {
    status = 'not-supported';
    reason = 'This external validation checkpoint is disabled in the project configuration.';
  } else if (stage.required === 'provider-gated' && !checkpoint?.validators.length) {
    status = 'not-supported';
    reason = validation.orchestrator === 'manual'
      ? 'No independent external validation provider is enabled for this checkpoint.'
      : `No independent external validator remains after excluding the ${validation.orchestrator} orchestrator.`;
  }
  return {
    number: stage.number,
    id: stage.id,
    required: stage.required,
    condition: stage.condition ?? null,
    approval: stage.approval ?? null,
    status,
    statusReason: reason,
    startedAt: null,
    completedAt: status === 'skipped' || status === 'not-supported' ? now() : null,
    gatePath: null,
    gateSha256: null,
    artefactPath: null,
    iterations: 0,
    validation: checkpoint
      ? {
          checkpoint: checkpointName,
          enabled: checkpoint.enabled,
          maxCycles: checkpoint.max_cycles,
          providers: [...checkpoint.validators],
          breadth: checkpoint.review.breadth,
          depth: checkpoint.review.depth,
          output: checkpoint.review.output,
          cycles: [],
        }
      : null,
  };
}

function assertExternalValidationComplete(phase) {
  for (const provider of phase.validation.providers) {
    const cycles = phase.validation.cycles.filter((cycle) => cycle.provider === provider);
    if (!cycles.length) {
      throw new Error(
        `Phase ${phase.id} requires at least one recorded validation cycle from ${provider}.`,
      );
    }
    const latest = cycles.at(-1);
    if (latest.outcome !== 'pass') {
      const exhausted = cycles.length >= phase.validation.maxCycles;
      throw new Error(exhausted
        ? `Phase ${phase.id} is blocked: ${provider} still reports issues after the configured ${phase.validation.maxCycles} cycle(s).`
        : `Phase ${phase.id} cannot complete: fix ${provider}'s findings and run validation cycle ${cycles.length + 1} of ${phase.validation.maxCycles}.`);
    }
  }
}

function validationEvidencePath(paths, relativePath) {
  const absolute = resolve(paths.deliveryRoot, relativePath);
  if (!isWithin(paths.deliveryRoot, absolute)) {
    throw new Error(`Validation evidence must remain inside ${paths.deliveryRoot}`);
  }
  if (!existsSync(absolute)) throw new Error(`Validation evidence does not exist: ${absolute}`);
  return absolute;
}

function phaseSequence(state) {
  const result = [];
  for (const phase of state.phases) {
    result.push(phase);
    if (phase.id === 'reconcile') result.push(state.adjuncts.find((item) => item.id === 'ui-design'));
    if (phase.id === 'build') result.splice(result.length - 1, 0, state.adjuncts.find((item) => item.id === 'fit-check'));
    if (phase.id === 'retro') result.splice(result.length - 1, 0, state.humanGates.find((item) => item.id === 'manual-qa'));
  }
  return result.filter(Boolean);
}

function nextRequiredPhase(state) {
  const running = phaseSequence(state).find((phase) => phase.status === 'running');
  if (running) return running.id;
  const next = phaseSequence(state).find((phase) => !terminalPhaseStatuses.has(phase.status));
  return next?.id ?? 'complete';
}

function findTrackedPhase(state, phaseId) {
  const phase = [...state.phases, ...state.adjuncts, ...state.humanGates].find((candidate) => candidate.id === phaseId);
  if (!phase) throw new Error(`Unknown EWAI delivery phase: ${phaseId}`);
  return phase;
}

function progressFor(state) {
  const applicable = state.phases.filter((phase) => !['skipped', 'not-supported'].includes(phase.status));
  const completed = applicable.filter((phase) => phase.status === 'completed').length;
  return applicable.length ? Math.round((completed / applicable.length) * 100) : 0;
}

function syncOperationalProjection(paths, state) {
  const next = ['shelf-ready', 'complete-dry-run'].includes(state.currentPhase)
    ? state.currentPhase
    : nextRequiredPhase(state);
  const shelfReady = next === 'shelf-ready';
  const finished = next === 'complete' || next === 'complete-dry-run';
  const waiting = next === 'manual-qa';
  for (const tracked of [...state.phases, ...state.adjuncts, ...state.humanGates]) {
    setPhase(paths.projectRoot, state.intent.id, tracked.id, {
      status: tracked.status,
      startedAt: tracked.startedAt,
      completedAt: tracked.completedAt,
      artefactPath: tracked.artefactPath ?? tracked.evidencePath ?? '',
      iterationCount: tracked.iterations ?? 0,
      notes: tracked.statusReason ?? ''
    });
  }
  return updateWorkItem(paths.projectRoot, state.intent.id, {
    lane: finished ? 'done' : shelfReady ? 'ready' : waiting ? 'qa' : 'active',
    state: state.status,
    intentState: state.intent.status,
    completionPercent: progressFor(state),
    currentSprint: !finished && !shelfReady,
    currentPhase: next,
    blockedBy: state.blockedReason ?? '',
    notes: `Durable delivery state: SPECS/6.Build/${state.slug}/delivery-state.json`
  });
}

function persistedIntentStatus(state) {
  if (state.currentPhase === 'complete') return 'delivered';
  if (state.phases.find((phase) => phase.id === 'intent')?.status === 'completed') return 'in-progress';
  return state.intent.status;
}

function lifecycleScope(state, phase = '') {
  return {
    intent: state.intent.id,
    delivery: state.slug,
    ...(phase ? { phase } : {}),
  };
}

function publishDeliveryLifecycle(paths, state, eventName, input = {}) {
  assertIntentMutation(paths.projectRoot, state.intent.id);
  let personas = state.intent.personas;
  if (!Array.isArray(personas)) {
    try {
      personas = readRuntimeIntent(paths.projectRoot, state.intent.id)?.personas ?? [];
    } catch {
      personas = [];
    }
  }
  return publishLifecycleEventSafely(paths.projectRoot, eventName, {
    ...input,
    scope: input.scope ?? lifecycleScope(state, input.phase),
    personas,
    streamId: `delivery:${state.slug}`,
  });
}

function syncIntentCopies(paths, state) {
  const status = persistedIntentStatus(state);
  const deliveryStatePath = relative(paths.projectRoot, paths.statePath).replaceAll('\\', '/');
  const updated = updateIntentDeliveryState(
    paths.projectRoot,
    resolve(paths.projectRoot, state.intent.path),
    {
      status,
      deliveryStatus: state.status,
      currentPhase: state.currentPhase,
      deliveryStatePath
    }
  );
  state.intent.status = status;
  return updated;
}

function fileSnapshot(path) {
  return { path, existed: existsSync(path), content: existsSync(path) ? readFileSync(path, 'utf8') : '' };
}

function transitionSnapshot(paths, state) {
  const intentPath = resolve(paths.projectRoot, state.intent.path);
  return {
    files: [
      intentPath,
      intentPath.replace(/\.md$/, '.json'),
      paths.statePath,
      paths.trackerPath,
      paths.contextPath
    ].map(fileSnapshot),
    operational: readWorkItemView(paths.projectRoot, state.intent.id)
  };
}

function restoreTransition(paths, snapshot) {
  for (const file of snapshot.files) {
    if (file.existed) atomicText(file.path, file.content);
    else rmSync(file.path, { force: true });
  }
  const before = snapshot.operational;
  if (!before?.item) return;
  updateWorkItem(paths.projectRoot, before.item.id, {
    lane: before.item.lane,
    state: before.item.state,
    intentState: before.item.intentState,
    completionPercent: before.item.completionPercent,
    priority: before.item.priority,
    currentSprint: before.item.currentSprint,
    currentPhase: before.item.currentPhase,
    blockedBy: before.item.blockedBy,
    notes: before.item.notes
  });
  for (const phase of before.phases) {
    setPhase(paths.projectRoot, before.item.id, phase.phaseKey, {
      status: phase.status,
      startedAt: phase.startedAt,
      completedAt: phase.completedAt,
      artefactPath: phase.artefactPath,
      iterationCount: phase.iterationCount,
      notes: phase.notes
    });
  }
  updateWorkItem(paths.projectRoot, before.item.id, { currentPhase: before.item.currentPhase });
}

function persistTransition(paths, state) {
  assertIntentMutation(paths.projectRoot, state.intent.id);
  const snapshot = transitionSnapshot(paths, state);
  try {
    assertIntentMutation(paths.projectRoot, state.intent.id);
    state.updatedAt = now();
    const copies = syncIntentCopies(paths, state);
    assertIntentMutation(paths.projectRoot, state.intent.id);
    writeDeliveryDocuments(paths, state);
    assertIntentMutation(paths.projectRoot, state.intent.id);
    const item = syncOperationalProjection(paths, state);
    validateIntentStateCopies(paths.projectRoot, copies.markdownPath, {
      status: state.intent.status,
      deliveryStatus: state.status,
      currentPhase: state.currentPhase,
      deliveryStatePath: relative(paths.projectRoot, paths.statePath).replaceAll('\\', '/')
    });
    if (item.currentPhase !== state.currentPhase || item.intentState !== state.intent.status || item.state !== state.status) {
      throw new Error('Intent state drift: SQLite does not match the Markdown, JSON, and durable delivery state.');
    }
    return item;
  } catch (error) {
    try {
      assertIntentMutation(paths.projectRoot, state.intent.id);
      restoreTransition(paths, snapshot);
    } catch (rollbackError) {
      error.rollbackError = rollbackError.message;
    }
    throw error;
  }
}

function assertIntentCopiesConsistent(paths, state) {
  return validateIntentStateCopies(paths.projectRoot, resolve(paths.projectRoot, state.intent.path), {
    status: state.intent.status,
    deliveryStatus: state.status,
    currentPhase: state.currentPhase,
    deliveryStatePath: relative(paths.projectRoot, paths.statePath).replaceAll('\\', '/')
  });
}

function validatePlanFingerprint(paths) {
  const path = resolve(paths.deliveryRoot, 'plan-fingerprint.json');
  if (!existsSync(path)) throw new Error('Shelf-ready delivery requires plan-fingerprint.json before pausing.');
  const fingerprint = JSON.parse(readFileSync(path, 'utf8'));
  for (const key of ['captured_at', 'captured_by_phase', 'run_mode', 'branch_strategy', 'repos', 'files']) {
    if (fingerprint[key] === undefined || fingerprint[key] === null) {
      throw new Error(`Plan fingerprint is missing required field: ${key}`);
    }
  }
  if (fingerprint.run_mode !== 'shelf') throw new Error('Plan fingerprint run_mode must be shelf.');
  if (!Array.isArray(fingerprint.files) || typeof fingerprint.repos !== 'object') {
    throw new Error('Plan fingerprint repos/files have invalid types.');
  }
  return { path, fingerprint };
}

function finishCurrentRun(paths, state, status, summary) {
  const runId = state.runs.at(-1);
  if (!runId) return null;
  const runPath = resolve(paths.runsRoot, `${runId}.json`);
  if (!existsSync(runPath)) throw new Error(`Durable delivery run record is missing: ${relative(paths.projectRoot, runPath)}`);
  const run = JSON.parse(readFileSync(runPath, 'utf8'));
  run.status = status;
  run.completedAt = now();
  run.summary = summary;
  assertIntentMutation(paths.projectRoot, state.intent.id);
  atomicJson(runPath, run);
  finishCommandRun(paths.projectRoot, runId, {
    status,
    completedAt: run.completedAt,
    exitCode: status === 'failed' ? 1 : 0,
    summary
  });
  finishActiveSession(paths.projectRoot, state.intent.id, {
    ownerId: run.id,
    tool: run.tool,
    phaseKey: run.phase,
    status: status === 'failed' ? 'failed' : 'completed',
    summary,
  });
  return run;
}

function legacyDeliveryOrchestrator(paths, state) {
  const runId = state.runs?.at(-1);
  if (!runId) return 'manual';
  const runPath = resolve(paths.runsRoot, `${runId}.json`);
  if (!existsSync(runPath)) return 'manual';
  try {
    return JSON.parse(readFileSync(runPath, 'utf8')).tool ?? 'manual';
  } catch {
    return 'manual';
  }
}

function normaliseDeliveryValidation(paths, state) {
  if (state.validation) {
    state.validation.orchestrator = canonicalValidationProvider(state.validation.orchestrator) || 'manual';
    const independentProvider = (provider) => {
      const canonical = canonicalValidationProvider(provider);
      return canonical && canonical !== state.validation.orchestrator;
    };
    if (state.validation.providers?.gemini && !state.validation.providers.antigravity) {
      state.validation.providers.antigravity = state.validation.providers.gemini;
    }
    if (state.validation.providers) delete state.validation.providers.gemini;
    for (const checkpoint of Object.values(state.validation.checkpoints ?? {})) {
      checkpoint.validators = [...new Set(
        (checkpoint.validators ?? [])
          .map(canonicalValidationProvider)
          .filter(independentProvider),
      )];
    }
    state.providers = [...new Set(
      (state.providers ?? [])
        .map(canonicalValidationProvider)
        .filter(independentProvider),
    )];
    for (const phase of state.phases) {
      if (phase.validation) {
        phase.validation.providers = [...new Set(
          (phase.validation.providers ?? [])
            .map(canonicalValidationProvider)
            .filter(independentProvider),
        )];
        phase.validation.cycles ??= [];
        if (phase.status === 'pending' && phase.validation.enabled && !phase.validation.providers.length) {
          phase.status = 'not-supported';
          phase.statusReason = 'No independent external validator remains after provider migration.';
          phase.completedAt = now();
        }
      }
    }
    return state;
  }

  const { config } = loadProjectConfig(paths.projectRoot);
  const orchestrator = legacyDeliveryOrchestrator(paths, state);
  const validation = effectiveValidationConfig(config, orchestrator);
  const legacyProviders = [...new Set(
    (Array.isArray(state.providers) ? state.providers : [])
      .map(canonicalValidationProvider)
      .filter((provider) => VALIDATION_PROVIDERS.includes(provider)),
  )];

  for (const [checkpointName, checkpoint] of Object.entries(validation.checkpoints)) {
    const configured = config.validation.external.checkpoints[checkpointName];
    const configuredValidators = configured.validators === 'auto'
      ? 'auto'
      : [...new Set(configured.validators.map(canonicalValidationProvider))];
    const requested = configuredValidators === 'auto'
      ? legacyProviders
      : configuredValidators.filter((provider) => legacyProviders.includes(provider));
    checkpoint.validators = configured.enabled
      ? requested.filter((provider) => provider !== validation.orchestrator)
      : [];
  }
  validation.migratedFromLegacyState = true;
  state.validation = validation;
  state.providers = [...new Set(
    Object.values(validation.checkpoints).flatMap((checkpoint) => checkpoint.validators),
  )];

  for (const phase of state.phases) {
    const checkpointName = validationCheckpointForPhase(phase.id);
    if (!checkpointName) {
      phase.validation ??= null;
      continue;
    }
    const checkpoint = validation.checkpoints[checkpointName];
    phase.validation = {
      checkpoint: checkpointName,
      enabled: checkpoint.enabled,
      maxCycles: checkpoint.max_cycles,
      providers: [...checkpoint.validators],
      breadth: checkpoint.review.breadth,
      depth: checkpoint.review.depth,
      output: checkpoint.review.output,
      cycles: [],
    };
    if (phase.status === 'pending' && (!checkpoint.enabled || !checkpoint.validators.length)) {
      phase.status = 'not-supported';
      phase.statusReason = checkpoint.enabled
        ? 'No independent external validator remains after legacy-state migration.'
        : 'This external validation checkpoint is disabled in the project configuration.';
      phase.completedAt = now();
    }
  }
  return state;
}

export function readDeliveryState(projectRoot, slug) {
  const paths = deliveryPaths(projectRoot, slug);
  if (!existsSync(paths.statePath)) throw new Error(`No EWAI delivery state exists for ${slug}`);
  const state = JSON.parse(readFileSync(paths.statePath, 'utf8'));
  if (state.schema !== 'ewai.delivery-state/v1' || state.slug !== slug) {
    throw new Error(`Invalid EWAI delivery state for ${slug}`);
  }
  return normaliseDeliveryValidation(paths, state);
}

export function beginDelivery(projectRoot, slug, options = {}) {
  const resolvedOptions = { ...options, tool: options.tool ?? process.env.EWAI_ORCHESTRATOR ?? 'manual' };
  return withIntentMutation(projectRoot, slug, { action: 'begin-harness', provider: resolvedOptions.tool, input: resolvedOptions, ownership: options.ownership }, () => beginOwnedDelivery(projectRoot, slug, resolvedOptions));
}

function beginOwnedDelivery(projectRoot, slug, options) {
  const paths = deliveryPaths(projectRoot, slug);
  if (existsSync(paths.statePath)) intentOwnershipError('intent-transition-conflict');
  const { config } = loadProjectConfig(paths.projectRoot);
  const intent = readRuntimeIntent(paths.projectRoot, slug);
  if (!intent) throw new Error(`Cannot begin delivery without an intent: ${slug}`);
  const currentOwner = readWorkItemView(paths.projectRoot, intent.id)?.activity.session;
  if (currentOwner && !currentOwner.endedAt) intentOwnershipError('intent-ownership-conflict');
  const orchestrator = options.tool;
  const validation = effectiveValidationConfig(config, orchestrator);
  const providers = [...new Set(
    Object.values(validation.checkpoints).flatMap((checkpoint) => checkpoint.validators),
  )];
  const timestamp = now();
  const phases = deliveryContract.stages.map((stage) => newPhase(stage, options, validation));
  const adjuncts = deliveryContract.adjuncts.map((adjunct) => ({
    id: adjunct.id,
    status: adjunct.id === 'ui-design' && options.ui ? 'pending' : 'skipped',
    statusReason: adjunct.id === 'ui-design' && options.ui
      ? ''
      : adjunct.id === 'fit-check' ? 'Not resuming a shelf-ready plan.' : 'No user-facing interface work is in scope.',
    startedAt: null,
    completedAt: adjunct.id === 'ui-design' && options.ui ? null : timestamp,
    gatePath: null,
    gateSha256: null,
    artefactPath: null,
    iterations: 0
  }));
  const firstPhase = phases.find((phase) => phase.id === (options.ideate ? 'ideate' : 'intent'));
  firstPhase.status = 'running';
  firstPhase.startedAt = timestamp;
  const run = {
    schema: 'ewai.delivery-run/v1',
    id: randomUUID(),
    slug,
    tool: orchestrator,
    mode: options.mode ?? 'normal',
    status: 'running',
    phase: firstPhase.id,
    startedAt: timestamp,
    completedAt: null,
    summary: 'Delivery initialized through the EWAI fourteen-stage harness.'
  };
  const state = {
    schema: 'ewai.delivery-state/v1',
    contract: deliveryContract.schema,
    slug,
    intent: {
      id: intent.id,
      slug: intent.slug,
      domain: intent.domain,
      title: intent.title,
      status: intent.status,
      path: relative(paths.projectRoot, intent.path).replaceAll('\\', '/'),
      personas: intent.personas ?? [],
    },
    mode: options.mode ?? 'normal',
    intensity: options.intensity ?? (options.existingCode ? 'scoped' : 'full'),
    status: 'in-progress',
    currentPhase: firstPhase.id,
    startedAt: timestamp,
    updatedAt: timestamp,
    providers,
    validation,
    phases,
    adjuncts,
    humanGates: [{
      id: 'manual-qa',
      status: 'pending',
      startedAt: null,
      completedAt: null,
      approvedBy: null,
      approvedAt: null,
      evidencePath: null
    }],
    approvals: { build: null },
    artefactContracts: { prototype: 'ewai.prototype-manifest/v3' },
    runs: [run.id],
    blockedReason: ''
  };

  assertIntentMutation(paths.projectRoot, intent.id);
  mkdirSync(paths.runsRoot, { recursive: true });
  mkdirSync(paths.gatesRoot, { recursive: true });
  atomicJson(resolve(paths.runsRoot, `${run.id}.json`), run);
  startCommandRun(paths.projectRoot, intent.id, {
    runUuid: run.id,
    phaseKey: run.phase,
    tool: run.tool,
    command: `ewai delivery begin ${slug}`,
    mode: run.mode,
    startedAt: run.startedAt,
    summary: run.summary
  });
  for (const phase of [...phases, ...adjuncts, ...state.humanGates]) {
    setPhase(paths.projectRoot, intent.id, phase.id, {
      status: phase.status,
      startedAt: phase.startedAt,
      completedAt: phase.completedAt,
      notes: phase.statusReason
    });
  }
  persistTransition(paths, state);
  publishDeliveryLifecycle(paths, state, 'ewai.delivery.phase.entered', {
    sourceKey: `delivery:${state.slug}:phase:${firstPhase.id}:entered:${firstPhase.startedAt}`,
    occurredAt: firstPhase.startedAt,
    sourceRevision: state.updatedAt,
    phase: firstPhase.id,
    facts: { status: 'running', phase: firstPhase.id },
    now: firstPhase.startedAt,
  });
  const active = startActiveSession(paths.projectRoot, intent.id, {
    ownerId: run.id,
    tool: run.tool,
    phaseKey: firstPhase.id,
    summary: `Started EWAI delivery at the ${firstPhase.id} phase.`
  });
  return { state, run, active };
}

export function recordPhaseGate(projectRoot, slug, phaseId, input = {}) {
  return withIntentMutation(projectRoot, slug, { action: 'record-gate', phase: phaseId, input, ownership: input.ownership }, () => recordOwnedPhaseGate(projectRoot, slug, phaseId, input));
}

function recordOwnedPhaseGate(projectRoot, slug, phaseId, input) {
  const paths = deliveryPaths(projectRoot, slug);
  const state = readDeliveryState(projectRoot, slug);
  const phase = findTrackedPhase(state, phaseId);
  return recordPhaseGateAtPaths(paths, slug, phaseId, input, {
    providers: phase.validation?.providers ?? state.providers ?? [],
  });
}

export function recordExternalValidationCycle(projectRoot, slug, phaseId, input = {}) {
  return withIntentMutation(projectRoot, slug, { action: 'record-validation', phase: phaseId, input, ownership: input.ownership }, () => recordOwnedExternalValidationCycle(projectRoot, slug, phaseId, input));
}

function recordOwnedExternalValidationCycle(projectRoot, slug, phaseId, input) {
  const paths = deliveryPaths(projectRoot, slug);
  const state = readDeliveryState(projectRoot, slug);
  const phase = findTrackedPhase(state, phaseId);
  if (phase.status !== 'running') throw new Error(`Phase ${phaseId} is not running.`);
  if (!phase.validation) throw new Error(`Phase ${phaseId} is not an external-validation checkpoint.`);

  const provider = String(input.provider ?? '').trim().toLowerCase();
  if (!phase.validation.providers.includes(provider)) {
    throw new Error(
      `${provider || 'Provider'} is not an independent validator selected for ${phase.validation.checkpoint}.`,
    );
  }
  const outcome = String(input.outcome ?? '').trim().toLowerCase();
  if (!['pass', 'issues'].includes(outcome)) {
    throw new Error('Validation cycle outcome must be pass or issues.');
  }

  const prior = phase.validation.cycles.filter((cycle) => cycle.provider === provider);
  if (prior.at(-1)?.outcome === 'pass') {
    throw new Error(`${provider} has already passed ${phaseId}.`);
  }
  const cycle = prior.length + 1;
  if (cycle > phase.validation.maxCycles) {
    throw new Error(
      `${provider} has exhausted the configured ${phase.validation.maxCycles} validation cycle(s) for ${phaseId}.`,
    );
  }

  const responsePath = input.responsePath
    ?? `${phaseId}/round-${cycle}-${provider}-response.md`;
  const response = validationEvidencePath(paths, responsePath);
  let fixPath = input.fixPath ?? null;
  let fix = null;
  if (outcome === 'issues') {
    if (!fixPath) {
      throw new Error('A validation cycle with issues requires fix evidence via fixPath.');
    }
    fix = validationEvidencePath(paths, fixPath);
  }

  const record = {
    provider,
    cycle,
    outcome,
    breadth: phase.validation.breadth,
    depth: phase.validation.depth,
    output: phase.validation.output,
    responsePath,
    responseSha256: sha256(readFileSync(response)),
    fixPath,
    fixSha256: fix ? sha256(readFileSync(fix)) : null,
    recordedAt: now(),
    notes: String(input.notes ?? '').trim(),
  };
  phase.validation.cycles.push(record);
  phase.iterations = Math.max(
    phase.iterations,
    ...phase.validation.providers.map((candidate) => (
      phase.validation.cycles.filter((item) => item.provider === candidate).length
    )),
  );

  const ledgerPath = resolve(paths.deliveryRoot, phaseId, 'validation-cycles.json');
  assertIntentMutation(paths.projectRoot, state.intent.id);
  atomicJson(ledgerPath, {
    schema: 'ewai.external-validation-cycles/v1',
    slug,
    phase: phaseId,
    checkpoint: phase.validation.checkpoint,
    orchestrator: state.validation?.orchestrator ?? 'manual',
    maxCycles: phase.validation.maxCycles,
    breadth: phase.validation.breadth,
    depth: phase.validation.depth,
    output: phase.validation.output,
    providers: phase.validation.providers,
    cycles: phase.validation.cycles,
  });
  persistTransition(paths, state);
  addActivityEvent(paths.projectRoot, state.intent.id, {
    eventType: 'progress',
    phaseKey: phaseId,
    summary: `${provider} validation cycle ${cycle}/${phase.validation.maxCycles}: ${outcome}.`,
    details: responsePath,
  });
  return { state, record, ledgerPath };
}

export function phaseGateTemplate(projectRoot, slug, phaseId) {
  const paths = deliveryPaths(projectRoot, slug);
  const state = readDeliveryState(projectRoot, slug);
  const phase = findTrackedPhase(state, phaseId);
  return phaseGateTemplateAtPaths(paths, slug, phaseId, {
    providers: phase.validation?.providers ?? state.providers ?? [],
  });
}

export function continueDelivery(projectRoot, slug) {
  const paths = deliveryPaths(projectRoot, slug);
  const state = readDeliveryState(projectRoot, slug);
  assertIntentCopiesConsistent(paths, state);
  assertCompletedEvidenceFresh(paths, state);
  if (state.status === 'shelf-ready') {
    validatePlanFingerprint(paths);
    return {
      slug,
      status: state.status,
      currentPhase: state.currentPhase,
      nextPhase: 'fit-check',
      requiresResume: true,
      command: `ewai delivery resume ${slug}`,
      statePath: relative(paths.projectRoot, paths.statePath).replaceAll('\\', '/')
    };
  }
  if (state.status === 'validated-not-for-build') {
    return {
      slug,
      status: state.status,
      currentPhase: state.currentPhase,
      nextPhase: null,
      requiresResume: false,
      command: null,
      statePath: relative(paths.projectRoot, paths.statePath).replaceAll('\\', '/')
    };
  }
  const nextPhase = nextRequiredPhase(state);
  return {
    slug,
    status: state.status,
    currentPhase: state.currentPhase,
    nextPhase,
    command: `ewai delivery continue ${slug}`,
    statePath: relative(paths.projectRoot, paths.statePath).replaceAll('\\', '/')
  };
}

export function startDeliveryPhase(projectRoot, slug, phaseId, input = {}) {
  return withIntentMutation(projectRoot, slug, { action: 'start-phase', phase: phaseId, input, ownership: input.ownership }, () => startOwnedDeliveryPhase(projectRoot, slug, phaseId));
}

function startOwnedDeliveryPhase(projectRoot, slug, phaseId) {
  const paths = deliveryPaths(projectRoot, slug);
  const state = readDeliveryState(projectRoot, slug);
  assertIntentCopiesConsistent(paths, state);
  assertCompletedEvidenceFresh(paths, state);
  if (state.status === 'shelf-ready') throw new Error('Shelf-ready work must resume through FitCheck before Build.');
  if (state.status === 'validated-not-for-build') throw new Error('A dry-run is validated but explicitly not approved for Build.');
  const expected = nextRequiredPhase(state);
  if (expected !== phaseId) throw new Error(`Cannot start ${phaseId}; the next required phase is ${expected}.`);
  const phase = findTrackedPhase(state, phaseId);
  if (phaseId === 'build') {
    const approvalPath = resolve(paths.gatesRoot, 'build/build-approval.json');
    if (!state.approvals.build || !existsSync(approvalPath)) {
      throw new Error('Build requires explicit Build approval recorded in SPECS before code or branch creation.');
    }
    const approval = JSON.parse(readFileSync(approvalPath, 'utf8'));
    if (approval.schema !== 'ewai.build-approval/v1' || approval.decision !== 'approved') {
      throw new Error('Build requires explicit Build approval recorded in SPECS before code or branch creation.');
    }
  }
  if (phaseId === 'retro') {
    const manualQa = state.humanGates.find((gate) => gate.id === 'manual-qa');
    if (manualQa.status !== 'approved') throw new Error('Retro cannot start until Manual QA is explicitly approved.');
  }
  phase.status = 'running';
  phase.startedAt ??= now();
  state.currentPhase = phaseId;
  persistTransition(paths, state);
  publishDeliveryLifecycle(paths, state, 'ewai.delivery.phase.entered', {
    sourceKey: `delivery:${state.slug}:phase:${phaseId}:entered:${phase.startedAt}`,
    occurredAt: phase.startedAt,
    sourceRevision: state.updatedAt,
    phase: phaseId,
    facts: { status: 'running', phase: phaseId },
    now: phase.startedAt,
  });
  addActivityEvent(paths.projectRoot, state.intent.id, {
    eventType: 'handoff',
    phaseKey: phaseId,
    summary: `Entered EWAI phase: ${phaseId}.`
  });
  return state;
}

export function completeDeliveryPhase(projectRoot, slug, phaseId, options = {}) {
  return withIntentMutation(projectRoot, slug, { action: 'complete-phase', phase: phaseId, input: options, ownership: options.ownership }, () => completeOwnedDeliveryPhase(projectRoot, slug, phaseId, options));
}

function completeOwnedDeliveryPhase(projectRoot, slug, phaseId, options) {
  const paths = deliveryPaths(projectRoot, slug);
  const state = readDeliveryState(projectRoot, slug);
  const phase = findTrackedPhase(state, phaseId);
  if (phase.status !== 'running') throw new Error(`Phase ${phaseId} is not running.`);
  if (phaseId === 'intent') {
    const intent = readRuntimeIntent(paths.projectRoot, state.intent.id);
    if (!intent || !acceptedIntentStatuses.has(String(intent.status).toLowerCase())) {
      throw new Error('Intent cannot complete until its project-owned status is ready or approved.');
    }
    state.intent.status = intent.status;
  }
  assertIntentCopiesConsistent(paths, state);
  const phaseProviders = phase.validation?.providers ?? state.providers;
  if (phase.validation) assertExternalValidationComplete(phase);
  validatePhaseArtefacts(
    paths.deliveryRoot,
    phaseId,
    phaseProviders,
    phase.validation?.cycles ?? [],
  );
  const validated = readPassingGate(paths, phaseId, { providers: phaseProviders });
  phase.status = 'completed';
  phase.completedAt = now();
  phase.gatePath = relative(paths.projectRoot, validated.path).replaceAll('\\', '/');
  phase.gateSha256 = validated.sha256;
  phase.artefactPath = options.artefactPath
    ?? validated.gate.required_gates.find((gate) => gate.status === 'pass')?.output_path
    ?? null;
  state.currentPhase = nextRequiredPhase(state);
  if (state.currentPhase === 'build' && state.mode === 'shelf') {
    validatePlanFingerprint(paths);
    state.currentPhase = 'shelf-ready';
    state.status = 'shelf-ready';
  }
  if (state.currentPhase === 'build' && state.mode === 'dry-run') {
    state.currentPhase = 'complete-dry-run';
    state.status = 'validated-not-for-build';
  }
  if (state.currentPhase === 'manual-qa') {
    const manualQa = state.humanGates.find((gate) => gate.id === 'manual-qa');
    manualQa.status = 'running';
    manualQa.startedAt ??= now();
    state.status = 'paused-awaiting-manual-qa';
  }
  if (state.currentPhase === 'complete') state.status = 'completed';
  persistTransition(paths, state);
  publishDeliveryLifecycle(paths, state, 'ewai.delivery.phase.completed', {
    sourceKey: `delivery:${state.slug}:phase:${phaseId}:completed:${phase.completedAt}`,
    occurredAt: phase.completedAt,
    sourceRevision: state.updatedAt,
    phase: phaseId,
    facts: { status: 'completed', phase: phaseId },
    evidence: phase.gatePath ? [phase.gatePath] : [],
    now: phase.completedAt,
  });
  if (phaseId === 'delivery') publishDeliveryLifecycle(paths, state, 'ewai.delivery.completed', {
    sourceKey: `delivery:${state.slug}:completed:${phase.completedAt}`,
    occurredAt: phase.completedAt,
    sourceRevision: state.updatedAt,
    facts: { status: 'completed' },
    evidence: phase.gatePath ? [phase.gatePath] : [],
    now: phase.completedAt,
  });
  addActivityEvent(paths.projectRoot, state.intent.id, {
    eventType: 'progress',
    phaseKey: phaseId,
    summary: `Completed EWAI phase: ${phaseId}.`,
    details: phase.artefactPath ?? ''
  });
  if (state.status === 'shelf-ready') {
    finishCurrentRun(paths, state, 'shelf-ready', 'Shelf package complete and awaiting Build resume.');
  } else if (state.status === 'validated-not-for-build') {
    finishCurrentRun(paths, state, 'completed', 'Dry-run validation complete; not approved for Build.');
  } else if (state.status === 'completed') {
    finishCurrentRun(paths, state, 'completed', 'EWAI delivery and Retro complete.');
  }
  return state;
}

export function resumeShelvedDelivery(projectRoot, slug, input = {}) {
  return withIntentMutation(projectRoot, slug, { action: 'resume-shelf', input, ownership: input.ownership }, () => resumeOwnedShelvedDelivery(projectRoot, slug, input));
}

function resumeOwnedShelvedDelivery(projectRoot, slug, input) {
  const paths = deliveryPaths(projectRoot, slug);
  const state = readDeliveryState(projectRoot, slug);
  assertIntentCopiesConsistent(paths, state);
  assertCompletedEvidenceFresh(paths, state);
  validatePlanFingerprint(paths);
  if (state.status !== 'shelf-ready') throw new Error(`Delivery ${slug} is not shelf-ready.`);
  const fitCheck = state.adjuncts.find((phase) => phase.id === 'fit-check');
  fitCheck.status = 'pending';
  fitCheck.statusReason = '';
  fitCheck.startedAt = null;
  fitCheck.completedAt = null;
  state.mode = 'resume';
  state.status = 'in-progress';
  state.currentPhase = 'fit-check';
  const run = {
    schema: 'ewai.delivery-run/v1',
    id: randomUUID(),
    slug,
    tool: input.tool ?? 'manual',
    mode: 'resume',
    status: 'running',
    phase: 'fit-check',
    startedAt: now(),
    completedAt: null,
    summary: 'Shelf-ready delivery resumed through mandatory FitCheck.'
  };
  assertIntentMutation(paths.projectRoot, state.intent.id);
  atomicJson(resolve(paths.runsRoot, `${run.id}.json`), run);
  startCommandRun(paths.projectRoot, state.intent.id, {
    runUuid: run.id,
    phaseKey: run.phase,
    tool: run.tool,
    command: `ewai delivery resume ${slug}`,
    mode: run.mode,
    startedAt: run.startedAt,
    summary: run.summary
  });
  state.runs.push(run.id);
  persistTransition(paths, state);
  const active = startActiveSession(paths.projectRoot, state.intent.id, {
    ownerId: run.id,
    tool: run.tool,
    phaseKey: 'fit-check',
    summary: 'Resumed shelf-ready EWAI delivery at FitCheck.'
  });
  return { state, run, active };
}

export function ratifyDeliveryAmendments(projectRoot, slug, input = {}) {
  return withIntentMutation(projectRoot, slug, { action: 'ratify-plan', input, ownership: input.ownership }, () => ratifyOwnedDeliveryAmendments(projectRoot, slug, input));
}

function ratifyOwnedDeliveryAmendments(projectRoot, slug, input) {
  const paths = deliveryPaths(projectRoot, slug);
  const state = readDeliveryState(projectRoot, slug);
  assertIntentCopiesConsistent(paths, state);
  if (state.status !== 'in-progress' || state.currentPhase !== 'build' || nextRequiredPhase(state) !== 'build') {
    throw new Error('Pre-Build amendments can be ratified only after all planning phases are complete and before Build starts.');
  }
  if (state.approvals.build) throw new Error('Pre-Build amendments must be ratified before Build approval is recorded.');
  if (input.decision !== 'approved') throw new Error('Amendment ratification decision must be approved.');
  if (!input.approvedBy) throw new Error('Amendment ratification requires the approving person or role.');
  if (!String(input.scope ?? '').trim()) throw new Error('Amendment ratification requires the approved amendment scope.');

  const validatedPhases = [];
  for (const phase of [...state.phases, ...state.adjuncts]) {
    if (phase.status !== 'completed') continue;
    const providers = phase.validation?.providers ?? state.providers ?? [];
    if (phase.validation) assertExternalValidationComplete(phase);
    validatePhaseArtefacts(paths.deliveryRoot, phase.id, providers, phase.validation?.cycles ?? []);
    const validated = readPassingGate(paths, phase.id, { providers });
    validatedPhases.push({
      phase: phase.id,
      previousGateSha256: phase.gateSha256,
      ratifiedGateSha256: validated.sha256,
      gatePath: relative(paths.projectRoot, validated.path).replaceAll('\\', '/'),
      tracked: phase,
    });
  }

  const changes = validatedPhases.filter((phase) => phase.previousGateSha256 !== phase.ratifiedGateSha256);
  if (!changes.length) throw new Error('No changed completed-phase gate evidence requires ratification.');

  const approvedAt = now();
  const ratification = {
    schema: 'ewai.delivery-amendment-ratification/v1',
    slug,
    decision: 'approved',
    approvedBy: input.approvedBy,
    approvedAt,
    scope: String(input.scope).trim(),
    stateSha256BeforeRatification: sha256(readFileSync(paths.statePath)),
    changes: changes.map(({ tracked, ...change }) => change),
    validatedPhases: validatedPhases.map(({ tracked, ...phase }) => ({
      phase: phase.phase,
      gatePath: phase.gatePath,
      gateSha256: phase.ratifiedGateSha256,
    })),
  };
  const ratificationPath = resolve(paths.gatesRoot, 'build/pre-build-amendment-ratification.json');
  const ratificationBefore = fileSnapshot(ratificationPath);

  for (const phase of validatedPhases) {
    phase.tracked.gatePath = phase.gatePath;
    phase.tracked.gateSha256 = phase.ratifiedGateSha256;
  }
  state.amendments = [
    ...(Array.isArray(state.amendments) ? state.amendments : []),
    {
      path: relative(paths.projectRoot, ratificationPath).replaceAll('\\', '/'),
      approvedBy: ratification.approvedBy,
      approvedAt,
      scope: ratification.scope,
      phases: changes.map((change) => change.phase),
    },
  ];

  assertIntentMutation(paths.projectRoot, state.intent.id);
  atomicJson(ratificationPath, ratification);
  try {
    persistTransition(paths, state);
  } catch (error) {
    assertIntentMutation(paths.projectRoot, state.intent.id);
    if (ratificationBefore.existed) atomicText(ratificationPath, ratificationBefore.content);
    else rmSync(ratificationPath, { force: true });
    throw error;
  }
  addActivityEvent(paths.projectRoot, state.intent.id, {
    eventType: 'decision',
    phaseKey: 'build',
    summary: `Pre-Build amendments ratified by ${ratification.approvedBy}.`,
    details: ratification.scope,
  });
  return ratification;
}

function completedEvidenceAmendmentReceiptId(slug, expectedStateDigest, approvedBy, reason) {
  return sha256(Buffer.from(JSON.stringify({
    schema: 'ewai.completed-evidence-amendment-authority/v1',
    slug,
    expectedStateDigest,
    approvedBy,
    reason,
  })));
}

function completedEvidenceAmendmentRoot(paths, { create = false } = {}) {
  const root = resolve(paths.deliveryRoot, 'evidence-amendments');
  if (existsSync(root)) {
    const details = lstatSync(root);
    if (details.isSymbolicLink() || !details.isDirectory()) {
      throw new Error('Completed evidence amendment storage must be a real directory inside the delivery root.');
    }
  } else if (create) {
    mkdirSync(root);
  }
  return root;
}

function completedEvidenceAmendmentReceiptPath(paths, receiptId) {
  const root = completedEvidenceAmendmentRoot(paths);
  const path = resolve(root, `${receiptId}.json`);
  if (!isWithin(root, path)) throw new Error('Unsafe completed evidence amendment receipt path.');
  return path;
}

function deliveryProcessIsActive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function acquireCompletedEvidenceAmendmentLease(paths) {
  const leasePath = resolve(paths.deliveryRoot, '.evidence-amendment.lock');
  const metadataPath = resolve(leasePath, 'lease.json');
  const leaseId = randomUUID();
  const acquiredAt = now();

  const create = () => {
    try {
      mkdirSync(leasePath);
      atomicJson(metadataPath, {
        schema: 'ewai.completed-evidence-amendment-lease/v1',
        leaseId,
        pid: process.pid,
        acquiredAt,
      });
      return true;
    } catch (error) {
      if (error?.code === 'EEXIST') return false;
      rmSync(leasePath, { recursive: true, force: true });
      throw error;
    }
  };

  if (!create()) {
    let current = null;
    try { current = JSON.parse(readFileSync(metadataPath, 'utf8')); } catch { /* malformed metadata is handled by age */ }
    const valid = current?.schema === 'ewai.completed-evidence-amendment-lease/v1';
    const age = Date.now() - lstatSync(leasePath).mtimeMs;
    const stale = valid ? !deliveryProcessIsActive(Number(current.pid)) : age > 15 * 60_000;
    if (!stale) throw new Error('Another completed evidence amendment ratification is in progress. Preview again after it finishes.');
    rmSync(leasePath, { recursive: true, force: true });
    if (!create()) throw new Error('Another completed evidence amendment ratification is in progress. Preview again after it finishes.');
  }

  return () => {
    let current = null;
    try { current = JSON.parse(readFileSync(metadataPath, 'utf8')); } catch { /* never remove a lock we cannot identify */ }
    if (current?.leaseId === leaseId) rmSync(leasePath, { recursive: true, force: true });
  };
}

function completedEvidenceAmendmentAssessment(paths, state) {
  const deliveryStateSha256 = sha256(readFileSync(paths.statePath));
  const phases = [];

  for (const phase of [...state.phases, ...state.adjuncts]) {
    if (phase.status !== 'completed') continue;
    const ledgerPath = resolve(paths.gatesRoot, phase.id, 'gate-ledger.json');
    if (!existsSync(ledgerPath)) throw new Error(`Completed phase ${phase.id} has no gate ledger.`);
    const ledgerRaw = readFileSync(ledgerPath);
    if (!phase.gateSha256 || sha256(ledgerRaw) !== phase.gateSha256) {
      throw new Error(`Completed phase ${phase.id} gate ledger changed directly after completion.`);
    }

    const candidate = structuredClone(JSON.parse(ledgerRaw));
    const evidenceChanges = [];
    for (const item of candidate.required_gates ?? []) {
      if (item.status !== 'pass') continue;
      const evidencePath = resolve(paths.deliveryRoot, String(item.output_path ?? ''));
      if (!item.output_path || !isWithin(paths.deliveryRoot, evidencePath)) {
        throw new Error(`Completed phase ${phase.id} gate ${item.id} has an unsafe evidence path.`);
      }
      const absolute = evidenceAbsolute(paths.projectRoot, evidencePath);
      const currentSha256 = sha256(readFileSync(absolute));
      if (currentSha256 === item.evidence_hash) continue;
      evidenceChanges.push({
        gateId: item.id,
        path: item.output_path,
        previousSha256: item.evidence_hash,
        currentSha256,
      });
      item.evidence_hash = currentSha256;
    }

    const providers = phase.validation?.providers ?? state.providers ?? [];
    validatePhaseGateAtPaths(paths, phase.id, candidate, { providers });
    if (!evidenceChanges.length) continue;
    const candidateRaw = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`);
    phases.push({
      phase: phase.id,
      gatePath: relative(paths.deliveryRoot, ledgerPath).replaceAll('\\', '/'),
      previousGateSha256: phase.gateSha256,
      newGateSha256: sha256(candidateRaw),
      evidenceChanges,
      candidate,
      candidateRaw,
      ledgerPath,
    });
  }

  const publicPhases = phases.map(({ candidate, candidateRaw, ledgerPath, ...phase }) => phase);
  const revision = {
    schema: 'ewai.completed-evidence-amendment-revision/v1',
    slug: state.slug,
    deliveryStateSha256,
    phases: publicPhases,
  };
  return {
    schema: 'ewai.completed-evidence-amendment-preview/v1',
    slug: state.slug,
    status: phases.length ? 'changes-found' : 'no-changes',
    deliveryStateSha256,
    stateSha256: sha256(Buffer.from(JSON.stringify(revision))),
    phases: publicPhases,
    internalPhases: phases,
  };
}

export function previewCompletedEvidenceAmendment(projectRoot, slug) {
  const paths = deliveryPaths(projectRoot, slug);
  const state = readDeliveryState(projectRoot, slug);
  assertIntentCopiesConsistent(paths, state);
  const { internalPhases, ...preview } = completedEvidenceAmendmentAssessment(paths, state);
  return preview;
}

function replayCompletedEvidenceAmendment(paths, state, receiptPath, input) {
  if (!existsSync(receiptPath)) return null;
  const details = lstatSync(receiptPath);
  if (details.isSymbolicLink() || !details.isFile()) {
    throw new Error('Completed evidence amendment receipt must be a real file.');
  }
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  const receiptRelative = relative(paths.deliveryRoot, receiptPath).replaceAll('\\', '/');
  const recorded = (state.evidenceAmendments ?? []).find((amendment) => amendment.receiptPath === receiptRelative);
  if (receipt.schema !== 'ewai.completed-evidence-amendment/v1'
    || receipt.slug !== state.slug
    || receipt.expectedStateDigest !== input.expectedStateDigest
    || receipt.approvedBy !== input.approvedBy
    || receipt.reason !== input.reason
    || !Array.isArray(receipt.changes)
    || !receipt.changes.length
    || !recorded
    || recorded.approvedBy !== receipt.approvedBy
    || recorded.reason !== receipt.reason
    || recorded.expectedStateDigest !== receipt.expectedStateDigest
    || JSON.stringify(recorded.phases) !== JSON.stringify(receipt.changes.map((change) => change.phase))) {
    throw new Error('Existing completed evidence amendment receipt does not match the supplied authority.');
  }
  for (const change of receipt.changes ?? []) {
    const phase = [...state.phases, ...state.adjuncts].find((candidate) => candidate.id === change.phase);
    const ledgerPath = resolve(paths.deliveryRoot, change.gatePath);
    if (!phase || phase.status !== 'completed' || phase.gateSha256 !== change.newGateSha256
      || !isWithin(paths.deliveryRoot, ledgerPath) || !existsSync(ledgerPath)
      || sha256(readFileSync(ledgerPath)) !== change.newGateSha256) {
      throw new Error('Completed evidence amendment replay no longer matches current delivery truth.');
    }
    validatePhaseGateAtPaths(paths, phase.id, JSON.parse(readFileSync(ledgerPath, 'utf8')), {
      providers: phase.validation?.providers ?? state.providers ?? [],
    });
  }
  return {
    action: 'replayed',
    receipt,
    receiptPath: receiptRelative,
    state,
  };
}

export function ratifyCompletedEvidenceAmendment(projectRoot, slug, input = {}) {
  try {
    return withIntentMutation(projectRoot, slug, { action: 'ratify-evidence', input, ownership: input.ownership }, () => ratifyOwnedCompletedEvidenceAmendment(projectRoot, slug, input));
  } catch (error) {
    if (['intent-mutation-conflict', 'intent-ownership-conflict'].includes(error.code)) {
      error.message = 'Another completed evidence amendment ratification is in progress. Preview again after it finishes.';
    }
    throw error;
  }
}

function ratifyOwnedCompletedEvidenceAmendment(projectRoot, slug, input) {
  if (input.confirmed !== true) {
    throw new Error('Completed evidence amendment requires explicit confirmation.');
  }
  const approvedBy = String(input.approvedBy ?? '').trim();
  const reason = String(input.reason ?? '').trim();
  const expectedStateDigest = String(input.expectedStateDigest ?? '').trim();
  if (!approvedBy) throw new Error('Completed evidence amendment requires the approving person or role.');
  if (!reason) throw new Error('Completed evidence amendment requires a reason.');
  if (!/^[a-f0-9]{64}$/.test(expectedStateDigest)) {
    throw new Error('Completed evidence amendment requires the exact preview state digest.');
  }

  const paths = deliveryPaths(projectRoot, slug);
  const releaseLease = acquireCompletedEvidenceAmendmentLease(paths);
  try {
    return ratifyCompletedEvidenceAmendmentUnderLease(projectRoot, slug, paths, input, approvedBy, reason, expectedStateDigest);
  } finally {
    releaseLease();
  }
}

function ratifyCompletedEvidenceAmendmentUnderLease(projectRoot, slug, paths, input, approvedBy, reason, expectedStateDigest) {
  const state = readDeliveryState(projectRoot, slug);
  assertIntentCopiesConsistent(paths, state);
  const receiptId = completedEvidenceAmendmentReceiptId(
    state.slug,
    expectedStateDigest,
    approvedBy,
    reason,
  );
  const receiptPath = completedEvidenceAmendmentReceiptPath(paths, receiptId);
  const replay = replayCompletedEvidenceAmendment(paths, state, receiptPath, {
    expectedStateDigest,
    approvedBy,
    reason,
  });
  if (replay) return replay;

  const assessment = completedEvidenceAmendmentAssessment(paths, state);
  if (expectedStateDigest !== assessment.stateSha256) {
    throw new Error('Completed evidence amendment state digest changed after preview; preview again.');
  }
  if (!assessment.internalPhases.length) {
    throw new Error('No changed completed-phase evidence requires ratification.');
  }

  const amendmentRoot = resolve(paths.deliveryRoot, 'evidence-amendments');
  const rootExisted = existsSync(amendmentRoot);
  assertIntentMutation(paths.projectRoot, state.intent.id);
  completedEvidenceAmendmentRoot(paths, { create: true });
  const ledgerSnapshots = assessment.internalPhases.map(({ ledgerPath }) => fileSnapshot(ledgerPath));
  const receiptSnapshot = fileSnapshot(receiptPath);
  const approvedAt = now();
  const receipt = {
    schema: 'ewai.completed-evidence-amendment/v1',
    slug: state.slug,
    approvedBy,
    approvedAt,
    reason,
    expectedStateDigest,
    deliveryStateSha256Before: assessment.deliveryStateSha256,
    changes: assessment.phases,
  };

  for (const amendment of assessment.internalPhases) {
    const phase = [...state.phases, ...state.adjuncts].find((candidate) => candidate.id === amendment.phase);
    phase.gateSha256 = amendment.newGateSha256;
  }
  state.evidenceAmendments = [
    ...(Array.isArray(state.evidenceAmendments) ? state.evidenceAmendments : []),
    {
      receiptPath: relative(paths.deliveryRoot, receiptPath).replaceAll('\\', '/'),
      approvedBy,
      approvedAt,
      reason,
      expectedStateDigest,
      phases: assessment.phases.map((phase) => phase.phase),
    },
  ];

  try {
    for (const amendment of assessment.internalPhases) {
      assertIntentMutation(paths.projectRoot, state.intent.id);
      atomicText(amendment.ledgerPath, amendment.candidateRaw.toString('utf8'));
      validatePhaseGateAtPaths(paths, amendment.phase, JSON.parse(readFileSync(amendment.ledgerPath, 'utf8')), {
        providers: [...state.phases, ...state.adjuncts]
          .find((phase) => phase.id === amendment.phase)?.validation?.providers ?? state.providers ?? [],
      });
    }
    assertIntentMutation(paths.projectRoot, state.intent.id);
    atomicJson(receiptPath, receipt);
    input.afterAmendmentFilesWritten?.();
    persistTransition(paths, state);
  } catch (error) {
    assertIntentMutation(paths.projectRoot, state.intent.id);
    for (const snapshot of ledgerSnapshots) {
      if (snapshot.existed) atomicText(snapshot.path, snapshot.content);
      else rmSync(snapshot.path, { force: true });
    }
    if (receiptSnapshot.existed) atomicText(receiptSnapshot.path, receiptSnapshot.content);
    else rmSync(receiptPath, { force: true });
    if (!rootExisted && existsSync(amendmentRoot)) rmdirSync(amendmentRoot);
    throw error;
  }

  return {
    action: 'ratified',
    receipt,
    receiptPath: relative(paths.deliveryRoot, receiptPath).replaceAll('\\', '/'),
    state,
  };
}

export function recordBuildApproval(projectRoot, slug, input = {}) {
  return withIntentMutation(projectRoot, slug, { action: 'approve-build', input, ownership: input.ownership }, () => recordOwnedBuildApproval(projectRoot, slug, input));
}

function recordOwnedBuildApproval(projectRoot, slug, input) {
  const paths = deliveryPaths(projectRoot, slug);
  const state = readDeliveryState(projectRoot, slug);
  assertIntentCopiesConsistent(paths, state);
  assertCompletedEvidenceFresh(paths, state);
  if (state.status !== 'in-progress' || state.currentPhase !== 'build' || nextRequiredPhase(state) !== 'build') {
    throw new Error('Build approval can be recorded only after all pre-Build gates are complete in an active delivery.');
  }
  if (!input.approvedBy) throw new Error('Build approval requires the approving person or role.');
  if (input.decision !== 'approved') throw new Error('Build approval decision must be approved.');
  const approvedAt = now();
  const securityPolicy = captureSecurityPolicy(paths.projectRoot, { capturedAt: approvedAt });
  const approval = {
    schema: 'ewai.build-approval/v1',
    slug,
    decision: 'approved',
    approvedBy: input.approvedBy,
    approvedAt,
    scope: input.scope ?? '',
    stateSha256: sha256(readFileSync(paths.statePath)),
    securityPolicy,
  };
  const approvalPath = resolve(paths.gatesRoot, 'build/build-approval.json');
  const approvalBefore = fileSnapshot(approvalPath);
  assertIntentMutation(paths.projectRoot, state.intent.id);
  atomicJson(approvalPath, approval);
  state.approvals.build = {
    path: relative(paths.projectRoot, approvalPath).replaceAll('\\', '/'),
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
    scope: approval.scope,
    securityPolicy,
  };
  try {
    persistTransition(paths, state);
  } catch (error) {
    assertIntentMutation(paths.projectRoot, state.intent.id);
    if (approvalBefore.existed) atomicText(approvalPath, approvalBefore.content);
    else rmSync(approvalPath, { force: true });
    throw error;
  }
  publishDeliveryLifecycle(paths, state, 'ewai.delivery.build.approved', {
    sourceKey: `delivery:${state.slug}:build.approved:${approval.approvedAt}`,
    occurredAt: approval.approvedAt,
    sourceRevision: state.updatedAt,
    facts: { status: 'approved', decision: 'approved' },
    evidence: [relative(paths.projectRoot, approvalPath).replaceAll('\\', '/')],
    now: approval.approvedAt,
  });
  addActivityEvent(paths.projectRoot, state.intent.id, {
    eventType: 'decision',
    phaseKey: 'build',
    summary: `Build approved by ${approval.approvedBy}.`,
    details: approval.scope
  });
  return approval;
}

export function recordManualQaApproval(projectRoot, slug, input = {}) {
  return withIntentMutation(projectRoot, slug, { action: 'approve-manual-qa', input, ownership: input.ownership }, () => recordOwnedManualQaApproval(projectRoot, slug, input));
}

function recordOwnedManualQaApproval(projectRoot, slug, input) {
  const paths = deliveryPaths(projectRoot, slug);
  const state = readDeliveryState(projectRoot, slug);
  assertIntentCopiesConsistent(paths, state);
  assertCompletedEvidenceFresh(paths, state);
  if (nextRequiredPhase(state) !== 'manual-qa') {
    throw new Error('Manual QA approval can be recorded only after Delivery is complete.');
  }
  if (!input.approvedBy) throw new Error('Manual QA approval requires the approving person or role.');
  if (input.decision !== 'approved') throw new Error('Manual QA decision must be approved.');
  if (!input.evidencePath) throw new Error('Manual QA approval requires a project-owned evidence file.');
  const evidence = evidenceAbsolute(paths.projectRoot, input.evidencePath);
  const approval = {
    schema: 'ewai.manual-qa-approval/v1',
    slug,
    decision: 'approved',
    approvedBy: input.approvedBy,
    approvedAt: now(),
    evidencePath: relative(paths.projectRoot, evidence).replaceAll('\\', '/'),
    evidenceSha256: sha256(readFileSync(evidence)),
    notes: input.notes ?? ''
  };
  const approvalPath = resolve(paths.gatesRoot, 'manual-qa/approval.json');
  const approvalBefore = fileSnapshot(approvalPath);
  assertIntentMutation(paths.projectRoot, state.intent.id);
  atomicJson(approvalPath, approval);
  const gate = state.humanGates.find((candidate) => candidate.id === 'manual-qa');
  gate.status = 'approved';
  gate.completedAt = approval.approvedAt;
  gate.approvedBy = approval.approvedBy;
  gate.approvedAt = approval.approvedAt;
  gate.evidencePath = approval.evidencePath;
  state.currentPhase = nextRequiredPhase(state);
  state.status = 'in-progress';
  try {
    persistTransition(paths, state);
  } catch (error) {
    assertIntentMutation(paths.projectRoot, state.intent.id);
    if (approvalBefore.existed) atomicText(approvalPath, approvalBefore.content);
    else rmSync(approvalPath, { force: true });
    throw error;
  }
  publishDeliveryLifecycle(paths, state, 'ewai.delivery.manual-qa.approved', {
    sourceKey: `delivery:${state.slug}:manual-qa.approved:${approval.approvedAt}`,
    occurredAt: approval.approvedAt,
    sourceRevision: state.updatedAt,
    facts: { status: 'approved', decision: 'approved' },
    evidence: [approval.evidencePath],
    now: approval.approvedAt,
  });
  const releaseReadiness = assessSecurityReadiness(paths.projectRoot, {
    policySnapshot: state.approvals?.build?.securityPolicy,
  });
  if (releaseReadiness.ready) {
    publishDeliveryLifecycle(paths, state, 'ewai.delivery.release-ready', {
      sourceKey: `delivery:${state.slug}:release-ready:${approval.approvedAt}`,
      occurredAt: approval.approvedAt,
      sourceRevision: state.updatedAt,
      facts: { status: 'ready' },
      evidence: [approval.evidencePath],
      now: approval.approvedAt,
    });
  }
  addActivityEvent(paths.projectRoot, state.intent.id, {
    eventType: 'decision',
    phaseKey: 'manual-qa',
    summary: `Manual QA approved by ${approval.approvedBy}.`,
    details: approval.evidencePath
  });
  return { ...approval, releaseReadiness };
}
