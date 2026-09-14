import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { validatePhaseArtefacts } from './delivery-artifacts.mjs';
import { deliveryPaths, isWithin, sha256 } from './delivery-documents.mjs';
import { assertCompletedEvidenceFresh, validatePhaseGateAtPaths } from './delivery-gates.mjs';
import { dependencyRequirementBlockers, validateIntentDependencyGraph } from './intent-dependencies.mjs';
import { validateIntentStateCopies } from './intents.mjs';
import { validateTaskGraph } from './task-graph.mjs';

const terminalPhaseStatuses = new Set(['completed', 'approved', 'skipped', 'not-supported', 'waived']);
const acceptedIntentStatuses = new Set(['ready', 'approved']);

function blocker(code, message, evidence = '') {
  return { code, message, evidence };
}

function action(permitted, blockers = [], extra = {}) {
  return { permitted: Boolean(permitted && blockers.length === 0), blockers, ...extra };
}

function phaseSequence(state) {
  const result = [];
  for (const phase of state.phases ?? []) {
    result.push(phase);
    if (phase.id === 'reconcile') result.push((state.adjuncts ?? []).find((item) => item.id === 'ui-design'));
    if (phase.id === 'build') result.splice(result.length - 1, 0, (state.adjuncts ?? []).find((item) => item.id === 'fit-check'));
    if (phase.id === 'retro') result.splice(result.length - 1, 0, (state.humanGates ?? []).find((item) => item.id === 'manual-qa'));
  }
  return result.filter(Boolean);
}

function nextRequiredPhase(state) {
  const running = phaseSequence(state).find((phase) => phase.status === 'running');
  if (running) return running.id;
  return phaseSequence(state).find((phase) => !terminalPhaseStatuses.has(phase.status))?.id ?? 'complete';
}

function progress(state) {
  const applicable = (state.phases ?? []).filter((phase) => !['skipped', 'not-supported'].includes(phase.status));
  if (!applicable.length) return 0;
  return Math.round((applicable.filter((phase) => phase.status === 'completed').length / applicable.length) * 100);
}

function projection(intent, state, valid) {
  if (!valid) return { lane: 'blocked', state: 'invalid-evidence', intentState: intent.status, progress: 0, phase: state?.currentPhase ?? intent.currentPhase ?? 'backlog' };
  if (!state) {
    const ready = acceptedIntentStatuses.has(String(intent.status).toLowerCase());
    return { lane: ready ? 'ready' : 'backlog', state: 'not-started', intentState: intent.status, progress: 0, phase: 'backlog' };
  }
  if (state.status === 'completed') return { lane: 'done', state: state.status, intentState: state.intent.status, progress: 100, phase: state.currentPhase };
  if (state.status === 'paused-awaiting-manual-qa') return { lane: 'qa', state: state.status, intentState: state.intent.status, progress: progress(state), phase: state.currentPhase };
  if (['shelf-ready', 'validated-not-for-build'].includes(state.status)) {
    return { lane: 'ready', state: state.status, intentState: state.intent.status, progress: progress(state), phase: state.currentPhase };
  }
  return { lane: 'active', state: state.status, intentState: state.intent.status, progress: progress(state), phase: state.currentPhase };
}

function gateBlockers(paths, state, phase) {
  const blockers = [];
  try {
    validatePhaseArtefacts(
      paths.deliveryRoot,
      phase.id,
      phase.validation?.providers ?? state.providers ?? [],
      phase.validation?.cycles ?? [],
    );
  } catch (error) {
    blockers.push(blocker('phase-artefacts-incomplete', error.message, relative(paths.projectRoot, paths.deliveryRoot)));
  }
  if (phase.validation) {
    for (const provider of phase.validation.providers ?? []) {
      const cycles = (phase.validation.cycles ?? []).filter((cycle) => cycle.provider === provider);
      if (!cycles.length || cycles.at(-1).outcome !== 'pass') {
        blockers.push(blocker('external-validation-incomplete', `${provider} has not recorded a passing final validation cycle.`, phase.id));
      }
    }
  }

  const gatePath = resolve(paths.gatesRoot, phase.id, 'gate-ledger.json');
  if (!existsSync(gatePath)) {
    blockers.push(blocker('phase-gate-missing', `Phase ${phase.id} has no gate ledger.`, relative(paths.projectRoot, gatePath)));
    return blockers;
  }
  try {
    const gate = JSON.parse(readFileSync(gatePath, 'utf8'));
    if (gate.schema_version !== 1 || gate.phase !== phase.id || gate.status !== 'pass') {
      blockers.push(blocker('phase-gate-not-passing', `Phase ${phase.id} gate ledger is not passing.`, relative(paths.projectRoot, gatePath)));
    }
    const honesty = gate.honesty_check ?? {};
    for (const key of ['source_sections_edited', 'stale_text_removed', 'no_append_only_corrections', 'all_code_claims_cited']) {
      if (honesty[key] !== true) blockers.push(blocker('phase-gate-honesty-incomplete', `Phase ${phase.id} gate is missing honesty confirmation: ${key}.`, relative(paths.projectRoot, gatePath)));
    }
    for (const item of gate.required_gates ?? []) {
      if (item.status === 'not_applicable') continue;
      if (item.status !== 'pass') {
        blockers.push(blocker('required-gate-not-passing', `Required gate ${item.id} is ${item.status ?? 'unrecorded'}.`, item.id));
        continue;
      }
      const evidencePath = resolve(paths.deliveryRoot, item.output_path ?? '');
      if (!item.output_path || !isWithin(paths.deliveryRoot, evidencePath) || !existsSync(evidencePath) || !statSync(evidencePath).isFile()) {
        blockers.push(blocker('gate-evidence-missing', `Required gate ${item.id} has no valid evidence file.`, item.output_path ?? item.id));
      } else if (!item.evidence_hash || sha256(readFileSync(evidencePath)) !== item.evidence_hash) {
        blockers.push(blocker('gate-evidence-stale', `Required gate ${item.id} evidence has changed.`, item.output_path));
      }
    }
    validatePhaseGateAtPaths(paths, phase.id, gate, {
      providers: phase.validation?.providers ?? state.providers ?? [],
    });
  } catch (error) {
    blockers.push(blocker('phase-gate-invalid', `Phase ${phase.id} gate ledger is invalid: ${error.message}`, relative(paths.projectRoot, gatePath)));
  }
  return blockers;
}

function deriveTasks(paths, leases) {
  const graphPath = resolve(paths.deliveryRoot, 'task-graph.json');
  if (!existsSync(graphPath)) {
    return { status: 'not-planned', validation: null, tasks: [], available: [], maxParallelTasks: 1 };
  }
  let graph = null;
  try {
    graph = JSON.parse(readFileSync(graphPath, 'utf8'));
  } catch {
    // The deterministic validator reports the parse failure.
  }
  const validation = validateTaskGraph(paths.deliveryRoot, {
    slug: paths.deliveryRoot.split('/').at(-1),
  });
  const activeByTask = new Map(
    leases.filter((lease) => lease.status === 'active').map((lease) => [lease.taskId, lease]),
  );
  const tasks = validation.tasks.map((task) => {
    const lease = activeByTask.get(task.id) ?? null;
    return { ...task, status: lease ? 'leased' : task.status, lease };
  });
  return {
    status: validation.status === 'pass' ? 'planned' : 'invalid',
    validation,
    tasks,
    available: tasks.filter((task) => task.status === 'ready').map((task) => task.id),
    maxParallelTasks: Number(graph?.parallelism?.max_parallel_tasks ?? 1),
  };
}

export function deriveExecutionState(projectRoot, intent, options = {}) {
  if (!intent) throw new Error('Execution state requires an intent.');
  const paths = deliveryPaths(projectRoot, intent.slug);
  const blockers = [];
  let state = null;

  if (existsSync(paths.statePath)) {
    try {
      state = JSON.parse(readFileSync(paths.statePath, 'utf8'));
      if (state.schema !== 'ewai.delivery-state/v1' || state.slug !== intent.slug) {
        blockers.push(blocker('delivery-state-invalid', 'Durable delivery state has the wrong schema or slug.', relative(paths.projectRoot, paths.statePath)));
      } else {
        try {
          validateIntentStateCopies(paths.projectRoot, intent.path, {
            status: state.intent.status,
            deliveryStatus: state.status,
            currentPhase: state.currentPhase,
            deliveryStatePath: relative(paths.projectRoot, paths.statePath).replaceAll('\\', '/'),
          });
        } catch (error) {
          blockers.push(blocker('intent-state-drift', error.message, relative(paths.projectRoot, intent.path)));
        }
        try {
          assertCompletedEvidenceFresh(paths, state);
        } catch (error) {
          blockers.push(blocker('completed-evidence-stale', error.message, relative(paths.projectRoot, paths.deliveryRoot)));
        }
      }
    } catch (error) {
      blockers.push(blocker('delivery-state-invalid', `Durable delivery state cannot be read: ${error.message}`, relative(paths.projectRoot, paths.statePath)));
    }
  }

  const catalog = options.intentCatalog instanceof Map ? options.intentCatalog : new Map();
  if (!catalog.has(intent.id)) catalog.set(intent.id, intent);
  const dependencyAudit = validateIntentDependencyGraph([...catalog.values()]);
  for (const error of dependencyAudit.errors) {
    if (error.source === intent.id || error.target === intent.id || error.cycle?.includes(intent.id)) {
      blockers.push(blocker(error.code, error.message, error.target ?? intent.id));
    }
  }
  const valid = blockers.length === 0;
  const taskState = state ? deriveTasks(paths, options.leases ?? []) : { status: 'not-planned', validation: null, tasks: [], available: [], maxParallelTasks: 1 };
  const runningPhase = state ? phaseSequence(state).find((phase) => phase.status === 'running') : null;
  const completeBlockers = [...blockers];
  if (runningPhase?.id === 'intent' && !acceptedIntentStatuses.has(String(intent.status).toLowerCase())) {
    completeBlockers.push(blocker('intent-not-ready', 'Intent must be ready or approved before the Intent phase can complete.', intent.id));
  }
  if (runningPhase?.id === 'delivery') completeBlockers.push(...dependencyRequirementBlockers(projectRoot, intent, catalog, 'delivery'));
  if (runningPhase && valid) completeBlockers.push(...gateBlockers(paths, state, runningPhase));

  const nextPhase = state ? nextRequiredPhase(state) : null;
  const buildApprovalPath = resolve(paths.gatesRoot, 'build/build-approval.json');
  const buildApproved = Boolean(state?.approvals?.build && existsSync(buildApprovalPath));
  const buildDependencyBlockers = dependencyRequirementBlockers(projectRoot, intent, catalog, 'build');
  const buildReadinessBlockers = [
    ...blockers,
    ...buildDependencyBlockers,
    ...(nextPhase === 'build' ? [] : [blocker('build-not-next', `Build is not next; current required phase is ${nextPhase ?? 'none'}.`, nextPhase ?? '')]),
  ];
  const taskBlockers = [...blockers];
  if (taskState.status === 'not-planned') taskBlockers.push(blocker('task-graph-not-planned', 'No task graph exists yet.', relative(paths.projectRoot, resolve(paths.deliveryRoot, 'task-graph.json'))));
  if (taskState.status === 'invalid') taskBlockers.push(blocker('task-graph-invalid', 'Task graph failed deterministic validation.', taskState.validation?.graphPath ?? 'task-graph.json'));
  if (!taskState.available.length) taskBlockers.push(blocker('no-afk-task-ready', 'No unleased AFK task currently has satisfied dependencies.', 'task-graph.json'));
  const buildRunning = state?.currentPhase === 'build'
    && state.phases?.find((phase) => phase.id === 'build')?.status === 'running';
  if (!buildRunning) taskBlockers.push(blocker('build-not-running', 'Tasks can be leased only after the guarded harness has entered Build.', state?.currentPhase ?? 'not-started'));

  const actions = {
    beginHarness: action(!state && valid, state ? [blocker('delivery-already-started', 'The delivery harness has already started.', relative(paths.projectRoot, paths.statePath))] : blockers),
    continueHarness: action(Boolean(state) && valid && !['completed', 'validated-not-for-build'].includes(state?.status), blockers, { nextPhase }),
    completeCurrentPhase: action(Boolean(runningPhase) && valid, completeBlockers, { phase: runningPhase?.id ?? null }),
    approveBuild: action(nextPhase === 'build' && !buildApproved && valid, [
      ...buildReadinessBlockers,
      ...(buildApproved ? [blocker('build-already-approved', 'Build has already been approved.', relative(paths.projectRoot, buildApprovalPath))] : []),
    ]),
    enterBuild: action(nextPhase === 'build' && buildApproved && valid, [
      ...buildReadinessBlockers,
      ...(buildApproved ? [] : [blocker('build-approval-missing', 'Build requires explicit recorded approval.', relative(paths.projectRoot, buildApprovalPath))]),
    ]),
    acquireTask: action(valid && buildRunning && taskState.status === 'planned' && taskState.available.length > 0, taskBlockers, { candidates: taskState.available }),
  };

  return {
    schema: 'ewai.execution-state/v1',
    valid,
    intent: { id: intent.id, slug: intent.slug, status: intent.status },
    lifecycle: {
      status: state?.status ?? 'not-started',
      currentPhase: state?.currentPhase ?? 'backlog',
      nextPhase,
      deliveryStatePath: state ? relative(paths.projectRoot, paths.statePath).replaceAll('\\', '/') : null,
    },
    blockers,
    actions,
    tasks: taskState,
    projection: projection(intent, state, valid),
  };
}
