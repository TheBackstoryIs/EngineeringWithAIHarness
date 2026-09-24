import { randomUUID } from 'node:crypto';
import {
  copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deliveryPaths, atomicJson, isWithin, sha256, now } from '../delivery-documents.mjs';
import { projectPaths } from '../paths.mjs';
import { loadProjectConfig, validationStatus } from '../project.mjs';
import { validateTaskGraph, validateTaskReport } from '../task-graph.mjs';
import { syncIntentIndex } from './intents.mjs';
import {
  abandonExecutionLeasesForRun,
  acquireExecutionLease,
  heartbeatExecutionLease,
  releaseExecutionLease,
} from './execution-leases.mjs';
import { addActivityEvent } from './work.mjs';
import {
  AFK_PROVIDERS, buildProviderInvocation, commandAvailable, invokeProvider, providerCommand,
} from './provider-adapters.mjs';
import { prepareContextPack } from './context-assembly.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const workerPath = resolve(moduleDir, '../afk-worker.mjs');
const runSchema = 'ewai.afk-run/v1';
const terminalStates = new Set(['completed', 'cancelled']);
const runningControls = new Map();
const authorityChecks = new WeakMap();
const controlKey = (root, id) => `${resolve(root)}:${id}`;

function git(root, args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function pathsFor(projectRoot, runId = '') {
  const root = resolve(projectRoot);
  const afkRoot = resolve(root, '.ewai-pipeline/afk');
  const runRoot = runId ? resolve(afkRoot, 'runs', runId) : '';
  return {
    projectRoot: root,
    afkRoot,
    runsRoot: resolve(afkRoot, 'runs'),
    worktreesRoot: resolve(afkRoot, 'worktrees'),
    runRoot,
    runPath: runRoot ? resolve(runRoot, 'run.json') : '',
  };
}

function requireRun(projectRoot, runId) {
  const paths = pathsFor(projectRoot, runId);
  if (!existsSync(paths.runPath)) throw new Error(`Unknown AFK run: ${runId}`);
  const run = JSON.parse(readFileSync(paths.runPath, 'utf8'));
  if (run.schema !== runSchema) throw new Error(`Unsupported AFK run schema: ${run.schema}`);
  return { paths, run };
}

function saveRun(paths, run, resumeFrom = null) {
  if (existsSync(paths.runPath)) {
    const current = JSON.parse(readFileSync(paths.runPath, 'utf8'));
    if (resumeFrom !== null && JSON.stringify(current) !== resumeFrom) throw new Error('AFK control changed before resume; refresh its current state.');
    if (resumeFrom === null && current.id === run.id && current.desiredState !== 'running' && run.desiredState === 'running') {
      run.desiredState = current.desiredState;
      if (current.desiredState === 'cancelled') run.status = 'cancel-requested';
    }
  }
  run.updatedAt = now();
  atomicJson(paths.runPath, run);
  return run;
}

function event(projectRoot, run, summary, details = '', eventType = 'progress', requiresHuman = false) {
  try {
    addActivityEvent(projectRoot, run.intentId, {
      phaseKey: 'build',
      summary,
      details,
      eventType,
      requiresHuman,
    });
  } catch {
    // The durable AFK run remains authoritative if the live dashboard is unavailable.
  }
}

function configuredProviders(config) {
  const status = validationStatus(config, 'manual');
  return AFK_PROVIDERS.filter((provider) => {
    const setting = status.providers[provider];
    return setting.state === 'available' && setting.enabled && commandAvailable(providerCommand(provider));
  });
}

function readGraph(projectRoot, slug) {
  const delivery = deliveryPaths(projectRoot, slug);
  return JSON.parse(readFileSync(resolve(delivery.deliveryRoot, 'task-graph.json'), 'utf8'));
}

export function selectExecutableTaskIds(graph, taskCheck, maxParallel = 1) {
  const readyIds = taskCheck.tasks
    .filter((task) => task.status === 'ready' && !task.requiresHuman)
    .map((task) => task.id);
  if (!readyIds.length) return [];
  const firstReady = graph.tasks.find((task) => readyIds.includes(task.id));
  const wave = graph.afk_waves.find((candidate) => Number(candidate.wave) === Number(firstReady.parallel_wave));
  const declaredParallel = new Set(wave?.parallel_tasks ?? []);
  const orderedReady = (wave?.merge_order ?? readyIds).filter((id) => readyIds.includes(id));
  return graph.parallelism?.allowed && orderedReady.every((id) => declaredParallel.has(id))
    ? orderedReady.slice(0, maxParallel)
    : orderedReady.slice(0, 1);
}

function gitDirty(root) {
  return git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
}

function repositoryParentBranch(graph, repositoryName) {
  const configured = graph?.repository_branches?.[repositoryName];
  return typeof configured === 'string'
    ? configured
    : configured?.parent_branch ?? graph?.parent_branch ?? '';
}

function resolveRepositoryTopology(projectRoot, specsRoot, config, graph, failures) {
  const configured = config.repositories ?? [];
  const specsRealRoot = existsSync(specsRoot) ? realpathSync(specsRoot) : resolve(specsRoot);
  const taskRepositories = new Set((graph?.tasks ?? []).map((task) => task.repo));
  const names = new Set();
  const repositories = [];
  for (const repository of configured) {
    if (names.has(repository.name)) {
      failures.push(`Configured repository name is duplicated: ${repository.name}.`);
      continue;
    }
    names.add(repository.name);
    const configuredPath = String(repository.path ?? '').trim();
    const candidate = resolve(projectRoot, configuredPath);
    let root = candidate;
    let currentBranch = '';
    let gitRoot = '';
    const taskCount = (graph?.tasks ?? []).filter((task) => task.repo === repository.name).length;
    const ownsSpecs = (() => {
      try { return isWithin(realpathSync(candidate), specsRealRoot); } catch { return false; }
    })();
    const selected = ownsSpecs || taskRepositories.has(repository.name);
    if (selected) {
      try {
        root = realpathSync(candidate);
        gitRoot = realpathSync(git(root, ['rev-parse', '--show-toplevel']));
        currentBranch = git(root, ['branch', '--show-current']);
        if (gitRoot !== root) failures.push(`Configured repository ${repository.name} must point to its Git root: ${configuredPath}.`);
        if (gitDirty(root)) failures.push(`Configured repository ${repository.name} must be clean before unattended execution starts.`);
      } catch (error) {
        failures.push(`Configured repository ${repository.name} is not an accessible Git working tree at ${configuredPath}: ${error.message}`);
      }
    }
    const parentBranch = selected ? repositoryParentBranch(graph, repository.name) : '';
    if (selected && !parentBranch) failures.push(`No parent branch is defined for repository ${repository.name}.`);
    let branchAction = 'none';
    if (selected && parentBranch) {
      if (!validBranchName(root, parentBranch)) {
        failures.push(`Repository ${repository.name} has invalid AFK parent branch name ${parentBranch}.`);
      } else if (currentBranch !== parentBranch) {
        if (!currentBranch) {
          failures.push(`Repository ${repository.name} is detached; check out a base branch before AFK can prepare ${parentBranch}.`);
        } else if (gitBranchExists(root, parentBranch)) {
          failures.push(`Repository ${repository.name} is on ${currentBranch}, but existing AFK parent branch ${parentBranch} is not checked out.`);
        } else {
          branchAction = 'create';
        }
      }
    }
    repositories.push({
      name: repository.name,
      role: repository.role,
      path: configuredPath,
      root,
      parentBranch,
      currentBranch,
      taskCount,
      selected,
      ownsSpecs,
      branchAction,
    });
  }
  const specsRepositories = repositories.filter((repository) => repository.ownsSpecs);
  const specsRepository = specsRepositories[0];
  if (!specsRepository) failures.push('AFK requires a configured Git repository that contains the selected SPECS root so durable evidence can be versioned.');
  if (specsRepositories.length > 1) failures.push(`SPECS root is ambiguously contained by repositories: ${specsRepositories.map((repository) => repository.name).join(', ')}.`);
  for (const name of taskRepositories) {
    if (!names.has(name)) failures.push(`Task graph references unconfigured repository ${name}.`);
  }
  return {
    kind: repositories.length === 1 ? 'simple' : 'multi-repo',
    specsRepository: specsRepository?.name ?? '',
    repositories,
  };
}

function prepareParentBranches(topology) {
  const created = [];
  try {
    for (const repository of topology.repositories.filter((candidate) => candidate.branchAction === 'create')) {
      git(repository.root, ['switch', '-c', repository.parentBranch]);
      created.push({ repository, previousBranch: repository.currentBranch });
      repository.currentBranch = repository.parentBranch;
      repository.branchAction = 'created';
    }
  } catch (error) {
    for (const item of created.reverse()) {
      try {
        git(item.repository.root, ['switch', item.previousBranch]);
        git(item.repository.root, ['branch', '-D', item.repository.parentBranch]);
      } catch {
        // Leave the exact Git state visible if rollback itself cannot be completed safely.
      }
    }
    throw new Error(`Unable to prepare AFK integration branches: ${error.message}`);
  }
  return topology;
}

export function preflightAfkRun(projectRoot, slug, options = {}) {
  const root = resolve(projectRoot);
  const { config, paths: project } = loadProjectConfig(root);
  const failures = [];
  const existingRun = afkRunStatus(root).find((run) => (
    run.slug === slug && run.id !== options.ignoreRunId && !terminalStates.has(run.status)
  ));
  if (existingRun) failures.push(`AFK run ${existingRun.id} is already ${existingRun.status}; resume, pause, or cancel that durable run instead of starting another.`);
  const delivery = deliveryPaths(root, slug);
  let graph = null;
  let graphCheck = null;
  try {
    graph = readGraph(root, slug);
    graphCheck = validateTaskGraph(delivery.deliveryRoot, { slug });
    if (graphCheck.status !== 'pass') {
      failures.push(`Task graph is invalid: ${graphCheck.errors.map((item) => item.message).join('; ')}`);
    }
  } catch (error) {
    failures.push(`Task graph cannot be loaded: ${error.message}`);
  }
  const topology = resolveRepositoryTopology(root, project.specsRoot, config, graph, failures);
  const selectedRoots = new Set(topology.repositories.filter((repository) => repository.selected).map((repository) => repository.root));
  for (const activeRun of afkRunStatus(root).filter((run) => (
    run.id !== options.ignoreRunId && run.slug !== slug && !terminalStates.has(run.status)
  ))) {
    const overlap = (activeRun.topology?.repositories ?? [])
      .filter((repository) => repository.selected)
      .find((repository) => selectedRoots.has(repository.root));
    if (overlap) {
      failures.push(`AFK run ${activeRun.id} for ${activeRun.slug} already owns repository ${overlap.name}; pause, complete, or cancel it first.`);
    }
  }
  const statePath = delivery.statePath;
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    const build = state.phases?.find((phase) => phase.id === 'build');
    if (state.currentPhase !== 'build' || build?.status !== 'running') failures.push('The guarded EWAI delivery must already be running Phase 8 Build.');
    if (!state.approvals?.build || !existsSync(resolve(delivery.gatesRoot, 'build/build-approval.json'))) {
      failures.push('Durable human Build approval is missing.');
    }
  } catch (error) {
    failures.push(`Delivery state cannot be verified: ${error.message}`);
  }
  const ready = graphCheck?.tasks?.filter((task) => task.status === 'ready' && !task.requiresHuman).map((task) => task.id) ?? [];
  if (!ready.length && !(graphCheck?.completedTasks?.length === graph?.tasks?.length)) failures.push('No AFK task is ready to execute.');

  const available = configuredProviders(config);
  const requested = String(options.provider ?? 'auto');
  const providers = requested === 'auto'
    ? available
    : requested.split(',').map((value) => value.trim()).filter(Boolean);
  for (const provider of providers) {
    if (!AFK_PROVIDERS.includes(provider)) failures.push(`Unknown AFK provider: ${provider}.`);
    else if (!available.includes(provider)) failures.push(`${provider} is not both enabled in SPECS/pipeline.yaml and installed in this terminal.`);
  }
  if (!providers.length) failures.push('No configured and installed Claude, Codex, or Antigravity CLI is available.');
  const requestedParallel = Number(options.maxParallel ?? graph?.parallelism?.max_parallel_tasks ?? 1);
  if (!Number.isInteger(requestedParallel) || requestedParallel < 1) failures.push('maxParallel must be a positive integer.');
  const maxParallel = Math.max(1, Math.min(
    requestedParallel || 1,
    graph?.parallelism?.allowed === false ? 1 : Number(graph?.parallelism?.max_parallel_tasks ?? 1),
  ));
  return {
    status: failures.length ? 'blocked' : 'ready',
    failures,
    projectRoot: root,
    specsRoot: project.specsRoot,
    slug,
    branch: topology.repositories.find((repository) => repository.name === topology.specsRepository)?.currentBranch ?? '',
    parentBranch: graph?.parent_branch ?? '',
    topology,
    providers,
    readyTasks: ready,
    maxParallel,
    graphCheck,
  };
}

function spawnWorker(projectRoot, runId) {
  const child = spawn(process.execPath, [workerPath, '--project', projectRoot, '--run', runId], {
    cwd: projectRoot,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child.pid;
}

export function startAfkRun(projectRoot, slug, options = {}) {
  if (options.autonomy !== undefined) {
    const value = options.autonomy;
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length !== 2
      || !/^[a-f0-9-]{36}$/.test(value.runId ?? '') || !/^sha256:[a-f0-9]{64}$/.test(value.grantDigest ?? '')
      || options.foreground !== true || typeof options.dependencies?.authority !== 'function') {
      throw new Error('Autonomous AFK requires its bounded foreground authority context.');
    }
    options.dependencies.authority({ stage: 'prepare', mode: 'command' });
  }
  const root = resolve(projectRoot);
  const lockParent = resolve(root, '.ewai-pipeline/afk/locks');
  const lockPath = resolve(lockParent, `${slug}.lock`);
  mkdirSync(lockParent, { recursive: true });
  try {
    mkdirSync(lockPath);
  } catch {
    throw new Error(`Another AFK start is already being prepared for ${slug}.`);
  }
  try {
    const preflight = preflightAfkRun(root, slug, options);
    if (preflight.status !== 'ready') throw new Error(`AFK preflight blocked: ${preflight.failures.join(' ')}`);
    const indexed = syncIntentIndex(preflight.projectRoot).intents.find((intent) => intent.slug === slug);
    if (!indexed) throw new Error(`Unknown intent slug: ${slug}`);
    options.dependencies?.authority?.({ stage: 'prepare', mode: 'command' });
    prepareParentBranches(preflight.topology);
    const runId = randomUUID();
    const paths = pathsFor(preflight.projectRoot, runId);
    mkdirSync(paths.runRoot, { recursive: true });
    const run = {
      schema: runSchema,
      id: runId,
      projectRoot: preflight.projectRoot,
      specsRoot: preflight.specsRoot,
      slug,
      intentId: indexed.id,
      parentBranch: preflight.parentBranch,
      topology: preflight.topology,
      status: 'starting',
      desiredState: 'running',
      providers: preflight.providers,
      maxParallel: preflight.maxParallel,
      timeoutMs: Number(options.timeoutMs ?? 45 * 60 * 1000),
      createdAt: now(),
      updatedAt: now(),
      pid: null,
      activeWorkers: [],
      tasks: {},
      messages: [],
      executionStopped: true,
      ...(options.autonomy ? { autonomy: { ...options.autonomy } } : {}),
    };
    saveRun(paths, run);
    options.dependencies?.onRun?.(run);
    event(preflight.projectRoot, run, 'Preparing unattended Build execution.', `${preflight.readyTasks.length} task(s) ready; maximum parallelism ${run.maxParallel}.`);
    if (options.foreground === true) return executeAfkRun(preflight.projectRoot, runId, options.dependencies);
    run.pid = spawnWorker(preflight.projectRoot, runId);
    run.status = 'running';
    saveRun(paths, run);
    return run;
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

export function afkRunStatus(projectRoot, runId = '') {
  const root = resolve(projectRoot);
  if (runId) {
    const { run } = requireRun(root, runId);
    return { ...run, alive: processAlive(run.pid) };
  }
  const { runsRoot } = pathsFor(root);
  if (!existsSync(runsRoot)) return [];
  return readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(resolve(runsRoot, entry.name, 'run.json')))
    .map((entry) => JSON.parse(readFileSync(resolve(runsRoot, entry.name, 'run.json'), 'utf8')))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((run) => ({ ...run, alive: processAlive(run.pid) }));
}

export function pauseAfkRun(projectRoot, runId) {
  const { paths, run } = requireRun(projectRoot, runId);
  if (terminalStates.has(run.status)) throw new Error(`AFK run is already ${run.status}.`);
  if (['blocked', 'failed'].includes(run.status)) throw new Error(`AFK run is ${run.status}; resolve the blocker and resume it, or cancel it.`);
  run.desiredState = 'paused';
  run.messages.push({ at: now(), message: 'Safe pause requested; active task wave will finish before pausing.' });
  return saveRun(paths, run);
}

export function cancelAfkRun(projectRoot, runId) {
  const { paths, run } = requireRun(projectRoot, runId);
  if (terminalStates.has(run.status)) return run;
  run.desiredState = 'cancelled';
  run.status = processAlive(run.pid) ? 'cancel-requested' : 'cancel-unknown';
  run.cancellation = { status: run.status === 'cancel-requested' ? 'requested' : 'unknown', requestedAt: now() };
  // Only the process that owns the child handle may signal it. Another local
  // caller persists the request for that owner's bounded control poll.
  const saved = saveRun(paths, run);
  for (const controller of runningControls.get(controlKey(projectRoot, runId)) ?? []) controller.abort();
  event(paths.projectRoot, run, 'Unattended Build cancellation requested.', 'Termination is not yet confirmed; work and leases are retained.', 'blocked');
  return saved;
}

export function resumeAfkRun(projectRoot, runId, options = {}) {
  const { paths, run } = requireRun(projectRoot, runId);
  const resumeFrom = JSON.stringify(run);
  if (run.status === 'completed' || run.status === 'cancelled') throw new Error(`AFK run is ${run.status} and cannot resume.`);
  if (run.desiredState === 'cancelled' || run.executionStopped !== true) throw new Error('AFK execution needs a verified recovery decision before resuming.');
  if (run.autonomy && (run.status !== 'paused' || run.activeWorkers?.length || options.foreground !== true
    || options.autonomy?.runId !== run.autonomy.runId || options.autonomy?.grantDigest !== run.autonomy.grantDigest
    || typeof options.dependencies?.authority !== 'function')) throw new Error('Autonomous AFK resume requires the same bounded foreground authority context.');
  if (processAlive(run.pid)) throw new Error('AFK conductor is already running.');
  const preflight = preflightAfkRun(paths.projectRoot, run.slug, {
    provider: run.providers.join(','),
    maxParallel: run.maxParallel,
    ignoreRunId: run.id,
  });
  if (preflight.status !== 'ready') throw new Error(`AFK recovery preflight blocked: ${preflight.failures.join(' ')}`);
  if (run.autonomy) options.dependencies.authority({ stage: 'prepare', mode: 'command' });
  else abandonExecutionLeasesForRun(paths.projectRoot, run.id, { outcome: 'conductor-recovered' });
  run.desiredState = 'running';
  run.status = 'running';
  run.topology = preflight.topology;
  run.activeWorkers = [];
  if (run.autonomy) {
    run.timeoutMs = Math.min(run.timeoutMs, options.timeoutMs);
    if (!Number.isFinite(run.timeoutMs) || run.timeoutMs < 1) throw new Error('Autonomous AFK resume requires a bounded timeout.');
    run.pid = null; saveRun(paths, run, resumeFrom); options.dependencies.onRun?.(run);
    return executeAfkRun(paths.projectRoot, run.id, options.dependencies);
  }
  run.pid = null; saveRun(paths, run, resumeFrom);
  run.pid = spawnWorker(paths.projectRoot, run.id);
  event(paths.projectRoot, run, 'Recovering unattended Build execution.', 'Abandoned leases were released; task evidence will be revalidated before continuing.');
  return saveRun(paths, run);
}

function afkMarkers(task) {
  return [
    task.id,
    task.slice,
    ...(task.claims ?? []),
    ...(task.write_set ?? []),
    ...(task.allowed_commands ?? []),
    ...(task.stop_conditions ?? []),
    task.first_failing_test,
    ...(task.review?.standards_pushed ?? []),
    'orchestrator_owned',
  ].map((value) => String(value ?? '').trim()).filter(Boolean);
}

export function prepareAfkContext(projectRoot, task, repository, options = {}) {
  const specsRoot = projectPaths(projectRoot).specsRoot;
  const review = options.mode === 'review';
  const implementationCommit = String(options.implementationCommit ?? '').trim();
  const taskContent = JSON.stringify(task);
  const rules = review
    ? `TESTS_FIRST Read tests before implementation. Read cited standards from ${specsRoot}. Review implementation commit ${implementationCommit}. Check the diff, exact task contract, write_set, desired outcome, stop conditions, test evidence, correctness, standards, security and scope. Do not edit files. End with exactly one line: VERDICT: PASS or VERDICT: FAIL.`
    : `You are an EWAI Build worker in an isolated Git worktree. Read standards from ${specsRoot} and tests before implementation. Repository ${repository.name} (${repository.role}). Work only inside write_set. Run only allowed_commands. Stop on every stop_condition. Make the smallest code and test change. Do not create SPECS records, commit, merge, change delivery state or update phase status. AUTHORITY_NONE. Finish with files changed and commands run.`;
  const ruleMarkers = review
    ? ['TESTS_FIRST', implementationCommit, 'VERDICT: PASS or VERDICT: FAIL', 'Do not edit files']
    : ['AUTHORITY_NONE', 'Work only inside write_set', 'Do not create SPECS records', 'Do not create SPECS records, commit, merge, change delivery state or update phase status'];
  return prepareContextPack({
    profile: review ? 'fresh-context-review' : 'build-task',
    focus: `${task.id} ${task.name} ${review ? 'fresh review' : 'implementation'}`,
    budgetTokens: options.budgetTokens,
    repositoryRevision: options.repositoryRevision ?? implementationCommit ?? task.branch,
    deliveryRevision: options.deliveryRevision ?? task.id,
    personaCatalogue: options.personaCatalogue,
    candidates: [
      {
        id: 'task-contract',
        label: 'Exact task contract',
        evidenceClass: 'mandatory',
        priority: 100,
        sourcePath: 'SPECS/6.Build/task-graph.json',
        content: taskContent,
        requiredMarkers: afkMarkers(task),
        selectionReason: 'The worker and reviewer require the complete governed task boundary.',
      },
      {
        id: review ? 'fresh-review-rules' : 'build-worker-rules',
        label: review ? 'Fresh-context review rules' : 'Build worker rules',
        evidenceClass: 'mandatory',
        priority: 95,
        sourcePath: 'SPECS/4.Constraints/standards/lifecycle-hook-safety.md',
        content: rules,
        requiredMarkers: ruleMarkers.filter(Boolean),
        selectionReason: review ? 'Tests-first review and exact verdict are mandatory.' : 'Write, command and delivery authority boundaries are mandatory.',
      },
    ],
  });
}

function taskPrompt(projectRoot, task, repository) {
  const pack = prepareAfkContext(projectRoot, task, repository, { mode: 'implementation' });
  if (pack.status !== 'ready') throw new Error(`AFK Build context is not ready: ${pack.reason}.`);
  return pack.modelContext;
}

function reviewPrompt(projectRoot, task, implementationCommit) {
  const pack = prepareAfkContext(projectRoot, task, { name: task.repo, role: 'review' }, {
    mode: 'review', implementationCommit, repositoryRevision: implementationCommit,
  });
  if (pack.status !== 'ready') throw new Error(`AFK review context is not ready: ${pack.reason}.`);
  return pack.modelContext;
}

function changedPaths(root) {
  const output = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root });
  const entries = output.toString('utf8').split('\0').filter(Boolean);
  const paths = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    paths.push(entry.slice(3));
    if (entry[0] === 'R' || entry[1] === 'R' || entry[0] === 'C' || entry[1] === 'C') index += 1;
  }
  return paths;
}

function stem(value) {
  return String(value).replaceAll('\\', '/').replace(/\*\*.*$/, '').replace(/\*.*$/, '').replace(/\/$/, '');
}

function allowedPath(candidate, task) {
  const path = stem(candidate);
  return (task.write_set ?? []).some((configured) => {
    const boundary = stem(configured);
    return path === boundary || path.startsWith(`${boundary}/`);
  });
}

function repositoryForTask(run, task) {
  const repository = run.topology?.repositories?.find((candidate) => candidate.name === task.repo);
  if (!repository) throw new Error(`Task ${task.id} references repository ${task.repo}, which is absent from this AFK run topology.`);
  return repository;
}

function gitBranchExists(root, branch) {
  try {
    git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

function validBranchName(root, branch) {
  try {
    git(root, ['check-ref-format', '--branch', branch]);
    return true;
  } catch {
    return false;
  }
}

function branchPrefixCollision(root, branch) {
  const parts = branch.split('/');
  for (let index = 1; index < parts.length; index += 1) {
    if (gitBranchExists(root, parts.slice(0, index).join('/'))) return true;
  }
  try {
    const refs = git(root, ['for-each-ref', '--format=%(refname:short)', `refs/heads/${branch}/`]);
    return Boolean(refs);
  } catch {
    return false;
  }
}

function safeBranchPart(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || 'task';
}

function taskBranch(root, run, task, attempt) {
  const declared = String(task.branch ?? '').trim();
  if (declared && validBranchName(root, declared) && !gitBranchExists(root, declared) && !branchPrefixCollision(root, declared)) {
    return declared;
  }
  const base = `ewai-afk-${safeBranchPart(run.slug)}-${safeBranchPart(task.id)}-${safeBranchPart(task.name)}`;
  let candidate = attempt > 1 ? `${base}-attempt-${attempt}` : base;
  let suffix = attempt;
  while (gitBranchExists(root, candidate) || branchPrefixCollision(root, candidate)) {
    suffix += 1;
    candidate = `${base}-attempt-${suffix}`;
  }
  return candidate;
}

function taskState(run, task, update = {}) {
  run.tasks[task.id] = { ...(run.tasks[task.id] ?? {}), id: task.id, ...update, updatedAt: now() };
}

async function invokeControlled(projectRoot, run, task, invocation, invoke = invokeProvider) {
  const paths = pathsFor(projectRoot, run.id), controller = new AbortController();
  const key = controlKey(projectRoot, run.id), controls = runningControls.get(key) ?? new Set();
  controls.add(controller); runningControls.set(key, controls);
  let authorityError = null;
  const guard = () => {
    try {
      if (requireRun(projectRoot, run.id).run.desiredState === 'cancelled') controller.abort();
      authorityChecks.get(run)?.({ stage: 'check', mode: invocation.mode ?? 'command' });
    }
    catch (error) { authorityError = error; controller.abort(); }
  };
  let timer;
  try {
    guard();
    if (authorityError) throw authorityError;
    authorityChecks.get(run)?.({ stage: 'dispatch', mode: invocation.mode ?? 'command' });
    // Persist uncertainty before the launch. A dead conductor must not leave
    // an old true flag that lets resume abandon a still-running worker's lease.
    run.executionStopped = false;
    saveRun(paths, run);
    timer = setInterval(guard, 50);
    const result = await invoke(invocation, { signal: controller.signal, onStart(pid) {
      taskState(run, task, { pid });
      run.activeWorkers = [...(run.activeWorkers ?? []).filter(worker => worker.taskId !== task.id), { taskId: task.id, pid }];
      saveRun(paths, run);
    } });
    guard();
    if (result.executionStopped === true) run.activeWorkers = (run.activeWorkers ?? []).filter(worker => worker.taskId !== task.id);
    else run.unconfirmedExecution = true;
    if (authorityError) throw authorityError;
    if (run.unconfirmedExecution) throw new Error('AFK execution is not confirmed stopped; recovery is required.');
    run.executionStopped = (run.activeWorkers ?? []).length === 0;
    saveRun(paths, run);
    return result;
  } catch (error) {
    if ((run.activeWorkers ?? []).some(worker => worker.taskId === task.id)) run.unconfirmedExecution = true;
    throw error;
  } finally { clearInterval(timer); controls.delete(controller); if (!controls.size) runningControls.delete(key); }
}

async function executeCommand(command, cwd, outputPath, timeoutMs, projectRoot, run, task) {
  const result = await invokeControlled(projectRoot, run, task, { provider: 'command', command: '/bin/sh',
    args: ['-lc', command], cwd, prompt: '', timeoutMs, logPath: outputPath });
  if (result.cancelled || result.timedOut || requireRun(projectRoot, run.id).run.desiredState === 'cancelled') throw new Error('AFK command stopped before completion.');
  return { command, exitCode: result.exitCode, outputPath };
}

function writeTaskEvidence(projectRoot, run, result, postMerge) {
  const {
    task, implementationCommit, review, reviewer, verifiedCommands, changedFiles, actualBranch, repository,
  } = result;
  const delivery = deliveryPaths(projectRoot, run.slug);
  const evidencePath = resolve(delivery.deliveryRoot, task.evidence_path);
  const reportPath = resolve(delivery.deliveryRoot, task.report_path);
  const reviewRelative = `tasks/${task.id}/evidence/fresh-context-review.md`;
  const reviewPath = resolve(delivery.deliveryRoot, reviewRelative);
  mkdirSync(dirname(reviewPath), { recursive: true });
  writeFileSync(reviewPath, `${review.output.trim()}\n`, 'utf8');
  const commands = verifiedCommands.map((commandResult) => {
    const relativePath = `tasks/${task.id}/evidence/${commandResult.stage}.txt`;
    const destination = resolve(delivery.deliveryRoot, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(commandResult.outputPath, destination);
    return {
      stage: commandResult.stage,
      command: commandResult.command,
      ...(commandResult.stage === 'red' ? { expected_failure: task.red_green_refactor.expected_red_failure } : {}),
      exit_code: commandResult.exitCode,
      output_path: relativePath,
      output_sha256: sha256(readFileSync(destination)),
    };
  });
  const green = commands.find((command) => command.stage === 'green');
  const evidence = {
    schema: 'ewai.task-evidence/v1',
    task_id: task.id,
    repository: repository.name,
    task_branch: task.branch,
    branch: actualBranch,
    base_branch: repository.parentBranch,
    commit: implementationCommit,
    changed_files: changedFiles,
    commands,
    review: {
      fresh_context: true,
      tests_reviewed_first: true,
      status: 'pass',
      reviewer,
      evidence_path: reviewRelative,
      evidence_sha256: sha256(readFileSync(reviewPath)),
    },
    completion_checks: (task.completion_evidence ?? []).map((name) => ({
      name,
      status: 'pass',
      evidence_path: green.output_path,
      evidence_sha256: green.output_sha256,
    })),
    post_merge_checks: postMerge,
  };
  mkdirSync(dirname(evidencePath), { recursive: true });
  atomicJson(evidencePath, evidence);
  const report = `# Task Report: ${task.id}

## Summary
Implemented ${task.name} in repository ${repository.name} on branch \`${actualBranch}\` and integrated it into \`${repository.parentBranch}\`.

## Red-green-refactor evidence
The declared red command failed as expected; the green and refactor verification commands passed. Exact outputs and hashes are recorded in the evidence sidecar.

## Feedback loops run
The conductor ran the task's bounded verification commands, a fresh-context review, and ${postMerge.length} post-merge check(s).

## Files changed
${changedFiles.map((file) => `- ${file}`).join('\n')}

## Completion evidence
${(task.completion_evidence ?? []).map((name) => `- ${name}: pass`).join('\n')}

## Stop conditions
No declared stop condition occurred.

## Review notes
- Tests reviewed first: yes
- Fresh-context review: pass
- Reviewer: ${reviewer}

## QA notes
Automated task and integration evidence passed. Human QA remains governed by the later EWAI delivery gate.
`;
  writeFileSync(reportPath, report, 'utf8');
  return [reportPath, evidencePath, reviewPath, ...commands.map(command => resolve(delivery.deliveryRoot, command.output_path))];
}

async function implementTask(projectRoot, run, task, provider, dependencies = {}) {
  const invoke = dependencies.invokeProvider ?? invokeProvider;
  const paths = pathsFor(projectRoot, run.id);
  const repository = repositoryForTask(run, task);
  const attempt = Number(run.tasks?.[task.id]?.attempt ?? 0) + 1;
  const worktree = resolve(paths.worktreesRoot, run.id, repository.name, `${task.id}-attempt-${attempt}`);
  const actualBranch = taskBranch(repository.root, run, task, attempt);
  const logRoot = resolve(paths.runRoot, 'tasks', task.id);
  let lease = null;
  try {
    lease = acquireExecutionLease(projectRoot, run.intentId, {
      taskId: task.id,
      ownerId: `ewai-afk:${run.id}:${task.id}`,
      tool: provider,
      runId: run.id,
      durationMs: Math.min(86_400_000, run.timeoutMs + 10 * 60 * 1000),
    });
    taskState(run, task, {
      status: 'preparing', provider, leaseId: lease.id, worktree, attempt,
      repository: repository.name, declaredBranch: task.branch, actualBranch, baseBranch: repository.parentBranch,
    });
    saveRun(paths, run);
    event(projectRoot, run, `Preparing isolated worktree for ${task.id}.`, task.name);
    authorityChecks.get(run)?.({ stage: 'worktree', mode: 'command' });
    mkdirSync(dirname(worktree), { recursive: true });
    git(repository.root, ['worktree', 'add', '-b', actualBranch, worktree, repository.parentBranch]);
    const baseHead = git(worktree, ['rev-parse', 'HEAD']);
    const red = await executeCommand(
      task.red_green_refactor.red_command,
      worktree,
      resolve(logRoot, 'red.txt'),
      run.timeoutMs, projectRoot, run, task,
    );
    red.stage = 'red';
    if (red.exitCode === 0) throw new Error(`${task.id} red command already passes; the task contract is stale and must be reconciled.`);
    taskState(run, task, { status: 'implementing' });
    saveRun(paths, run);
    event(projectRoot, run, `Agent implementing ${task.id}.`, `${provider} · ${task.name}`);
    const invocation = buildProviderInvocation(provider, {
      cwd: worktree,
      prompt: taskPrompt(projectRoot, task, repository),
      task,
      timeoutMs: run.timeoutMs,
      mode: 'implementation',
    });
    invocation.logPath = resolve(logRoot, 'implementation.log');
    const result = await invokeControlled(projectRoot, run, task, invocation, invoke);
    if (requireRun(projectRoot, run.id).run.desiredState === 'cancelled') {
      throw new Error('AFK run was cancelled while the task agent was active.');
    }
    if (git(worktree, ['rev-parse', 'HEAD']) !== baseHead) {
      throw new Error(`${task.id} created a commit; commits and merges belong to the conductor.`);
    }
    if (result.timedOut) throw new Error(`${provider} exceeded the ${run.timeoutMs}ms task timeout.`);
    if (result.exitCode !== 0) throw new Error(`${provider} exited ${result.exitCode}; see ${relative(projectRoot, result.logPath)}.`);
    heartbeatExecutionLease(projectRoot, lease.id, {
      token: lease.token,
      durationMs: Math.min(86_400_000, run.timeoutMs + 10 * 60 * 1000),
    });
    const green = await executeCommand(
      task.red_green_refactor.green_command,
      worktree,
      resolve(logRoot, 'green.txt'),
      run.timeoutMs, projectRoot, run, task,
    );
    green.stage = 'green';
    if (green.exitCode !== 0) throw new Error(`${task.id} green command failed after implementation.`);
    const refactor = await executeCommand(
      task.red_green_refactor.green_command,
      worktree,
      resolve(logRoot, 'refactor.txt'),
      run.timeoutMs, projectRoot, run, task,
    );
    refactor.stage = 'refactor';
    if (refactor.exitCode !== 0) throw new Error(`${task.id} refactor verification failed.`);
    const changed = changedPaths(worktree);
    if (!changed.length) throw new Error(`${task.id} produced no changes.`);
    const outside = changed.filter((path) => !allowedPath(path, task));
    if (outside.length) throw new Error(`${task.id} changed files outside its write_set: ${outside.join(', ')}.`);
    taskState(run, task, { status: 'checking-scope', changedFiles: changed });
    saveRun(paths, run);
    event(projectRoot, run, `Checking implementation scope for ${task.id}.`, `${changed.length} changed path(s) in ${repository.name}.`);
    authorityChecks.get(run)?.({ stage: 'accept', mode: 'implementation' });
    git(worktree, ['add', '--', ...changed]);
    git(worktree, ['commit', '-m', `feat(${run.slug}): implement ${task.id}`]);
    const implementationCommit = git(worktree, ['rev-parse', 'HEAD']);

    const reviewer = run.providers.find((candidate) => candidate !== provider) ?? provider;
    const reviewInvocation = buildProviderInvocation(reviewer, {
      cwd: worktree,
      prompt: reviewPrompt(projectRoot, task, implementationCommit),
      task,
      timeoutMs: run.timeoutMs,
      mode: 'review',
    });
    reviewInvocation.logPath = resolve(logRoot, 'review.log');
    const review = await invokeControlled(projectRoot, run, task, reviewInvocation, invoke);
    if (requireRun(projectRoot, run.id).run.desiredState === 'cancelled') {
      throw new Error('AFK run was cancelled during fresh-context review.');
    }
    if (review.timedOut || review.exitCode !== 0 || !/^VERDICT:\s*PASS\s*$/im.test(review.output)) {
      throw new Error(`Fresh-context review did not pass; see ${relative(projectRoot, review.logPath)}.`);
    }
    authorityChecks.get(run)?.({ stage: 'accept', mode: 'review' });
    if (git(worktree, ['rev-parse', 'HEAD']) !== implementationCommit || gitDirty(worktree)) {
      throw new Error('Fresh-context review changed the inspected implementation.');
    }
    heartbeatExecutionLease(projectRoot, lease.id, {
      token: lease.token,
      durationMs: Math.min(86_400_000, run.timeoutMs + 10 * 60 * 1000),
    });
    const branchHead = git(worktree, ['rev-parse', 'HEAD']);
    const reviewerIdentity = `${reviewer}/${reviewer === provider ? 'fresh-session' : 'independent-cli'}`;
    taskState(run, task, { status: 'ready-to-integrate', implementationCommit, branchHead, reviewer: reviewerIdentity });
    saveRun(paths, run);
    return {
      task, lease, worktree, branchHead, implementationCommit, review,
      reviewer: reviewerIdentity, verifiedCommands: [red, green, refactor], changedFiles: changed,
      actualBranch, repository,
    };
  } catch (error) {
    const control = requireRun(projectRoot, run.id).run;
    if (control.desiredState === 'cancelled') {
      return { task, cancelled: true, error };
    }
    if (lease && !run.unconfirmedExecution) {
      try { releaseExecutionLease(projectRoot, lease.id, { token: lease.token, outcome: 'blocked' }); } catch { /* recovery handles it */ }
    }
    taskState(run, task, { status: 'blocked', error: error.message });
    if (!run.unconfirmedExecution) run.activeWorkers = (run.activeWorkers ?? []).filter((item) => item.taskId !== task.id);
    saveRun(paths, run);
    event(projectRoot, run, `${task.id} needs attention.`, error.message, 'blocked', true);
    return { task, error };
  }
}

async function integrateTask(projectRoot, run, result) {
  authorityChecks.get(run)?.({ stage: 'integrate', mode: 'command' });
  const { task, lease } = result;
  const repository = result.repository;
  const specsRepository = run.topology.repositories.find((candidate) => candidate.name === run.topology.specsRepository);
  if (!specsRepository) throw new Error('AFK run has no configured SPECS repository.');
  const paths = pathsFor(projectRoot, run.id);
  taskState(run, task, { status: 'integrating' });
  saveRun(paths, run);
  event(projectRoot, run, `Integrating ${task.id}.`, 'The orchestrator is merging sequentially and running post-merge checks.');
  const delivery = deliveryPaths(projectRoot, run.slug);
  const taskEvidenceRoot = resolve(delivery.deliveryRoot, 'tasks', task.id);
  const evidenceBackup = resolve(paths.runRoot, 'backups', task.id);
  const hadTaskEvidence = existsSync(taskEvidenceRoot);
  if (hadTaskEvidence) {
    rmSync(evidenceBackup, { recursive: true, force: true });
    cpSync(taskEvidenceRoot, evidenceBackup, { recursive: true });
  }
  let codeCommitted = false, integrationConflict = false, mergeStarted = false;
  const baselines = new Map(), ownedEvidence = new Map();
  const assertIntegrationState = (staged = false) => {
    for (const [root, baseline] of baselines) {
      const owned = path => ownedEvidence.has(resolve(root, path))
        && sha256(readFileSync(resolve(root, path))) === ownedEvidence.get(resolve(root, path));
      const stagedDelta = git(root, ['diff', '--cached', '--name-only', '-z', baseline.tree]).split('\0').filter(Boolean);
      const workingDelta = git(root, ['diff', '--name-only', '-z']).split('\0').filter(Boolean);
      const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
      if (git(root, ['rev-parse', 'HEAD']) !== baseline.head || git(root, ['branch', '--show-current']) !== baseline.branch
        || stagedDelta.some(path => !staged || !owned(path) || sha256(execFileSync('git', ['show', `:${path}`],
          { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })) !== ownedEvidence.get(resolve(root, path)))
        || [...workingDelta, ...untracked].some(path => !owned(path))) {
        integrationConflict = true;
        throw new Error('Repository changed outside the owned integration; preserve the checkout for review.');
      }
    }
  };
  try {
    heartbeatExecutionLease(projectRoot, lease.id, {
      token: lease.token,
      durationMs: Math.min(86_400_000, run.timeoutMs + 10 * 60 * 1000),
    });
    const currentBranch = git(repository.root, ['branch', '--show-current']);
    if (currentBranch !== repository.parentBranch) {
      throw new Error(`Repository ${repository.name} moved to ${currentBranch || '<detached>'}; expected ${repository.parentBranch}.`);
    }
    for (const root of new Set([repository.root, specsRepository.root])) {
      if (gitDirty(root)) { integrationConflict = true; throw new Error('Repository must still be clean before integration.'); }
      baselines.set(root, { head: git(root, ['rev-parse', 'HEAD']), branch: git(root, ['branch', '--show-current']), tree: git(root, ['write-tree']) });
    }
    git(repository.root, ['merge', '--no-ff', '--no-commit', result.actualBranch]);
    mergeStarted = true;
    baselines.get(repository.root).tree = git(repository.root, ['write-tree']);
    const postMerge = [];
    for (const [index, command] of (task.merge?.post_merge_checks ?? []).entries()) {
      const outputPath = resolve(delivery.deliveryRoot, 'tasks', task.id, 'evidence', `post-merge-${index + 1}.txt`);
      const check = await executeCommand(command, repository.root, outputPath, run.timeoutMs, projectRoot, run, task);
      const evidencePath = relative(delivery.deliveryRoot, outputPath).replaceAll('\\', '/');
      postMerge.push({ command, exit_code: check.exitCode, output_path: evidencePath, output_sha256: sha256(readFileSync(outputPath)) });
      ownedEvidence.set(realpathSync(outputPath), postMerge.at(-1).output_sha256);
      if (check.exitCode !== 0) throw new Error(`Post-merge check failed: ${command}`);
    }
    authorityChecks.get(run)?.({ stage: 'accept', mode: 'command' });
    assertIntegrationState();
    for (const path of writeTaskEvidence(projectRoot, run, result, postMerge)) ownedEvidence.set(realpathSync(path), sha256(readFileSync(path)));
    const validated = validateTaskReport(deliveryPaths(projectRoot, run.slug).deliveryRoot, task);
    if (validated.status !== 'complete') throw new Error(`Merged task evidence is invalid: ${validated.errors.join('; ')}`);
    assertIntegrationState();
    const evidencePaths = [...ownedEvidence.keys()].map(path => relative(specsRepository.root, path));
    git(specsRepository.root, ['add', '--', ...evidencePaths]);
    assertIntegrationState(true);
    const expectedTrees = new Map([...baselines.keys()].map(root => [root, git(root, ['write-tree'])]));
    const taskCommit = git(repository.root, ['rev-parse', result.actualBranch]);
    git(repository.root, ['commit', '-m', `merge(${run.slug}): integrate ${task.id}`]);
    const codeMergeCommit = git(repository.root, ['rev-parse', 'HEAD']);
    codeCommitted = true;
    if (repository.root !== specsRepository.root) {
      assertIntegrationStateForEvidence();
      git(specsRepository.root, ['commit', '-m', `docs(${run.slug}): record ${task.id} delivery evidence`]);
    }
    function assertIntegrationStateForEvidence() {
      const baseline = baselines.get(specsRepository.root);
      if (git(specsRepository.root, ['rev-parse', 'HEAD']) !== baseline.head
        || git(specsRepository.root, ['branch', '--show-current']) !== baseline.branch
        || git(specsRepository.root, ['write-tree']) !== expectedTrees.get(specsRepository.root)
        || git(specsRepository.root, ['diff', '--name-only']) || git(specsRepository.root, ['ls-files', '--others', '--exclude-standard'])) {
        throw new Error('Evidence repository changed during owned integration; preserve it for review.');
      }
    }
    const evidenceCommit = git(specsRepository.root, ['rev-parse', 'HEAD']);
    const transitions = [...baselines].map(([root, baseline]) => ({ root, before: baseline.head, branch: baseline.branch,
      after: root === repository.root ? codeMergeCommit : evidenceCommit }));
    for (const transition of transitions) {
      if (git(transition.root, ['rev-parse', 'HEAD']) !== transition.after || git(transition.root, ['rev-parse', 'HEAD^1']) !== transition.before
        || git(transition.root, ['rev-parse', 'HEAD^{tree}']) !== expectedTrees.get(transition.root)
        || git(transition.root, ['branch', '--show-current']) !== transition.branch || gitDirty(transition.root)
        || transition.root === repository.root && git(transition.root, ['rev-parse', 'HEAD^2']) !== taskCommit) {
        throw new Error('Owned integration commit changed unexpectedly; preserve the checkout for review.');
      }
    }
    authorityChecks.get(run)?.({ stage: 'integrated', mode: 'command', transitions });
    releaseExecutionLease(projectRoot, lease.id, { token: lease.token, outcome: 'completed' });
    taskState(run, task, {
      status: 'completed', mergeCommit: codeMergeCommit, evidenceCommit,
      repository: repository.name, actualBranch: result.actualBranch,
    });
    saveRun(paths, run);
    event(projectRoot, run, `${task.id} integrated and verified.`, `${postMerge.length} post-merge check(s) passed.`);
    rmSync(evidenceBackup, { recursive: true, force: true });
    try { git(repository.root, ['worktree', 'remove', '--force', result.worktree]); } catch { /* retain for diagnosis */ }
  } catch (error) {
    try { if (!codeCommitted) assertIntegrationState(true); } catch { integrationConflict = true; }
    if (mergeStarted && !codeCommitted && !run.unconfirmedExecution && !integrationConflict) {
      try { git(repository.root, ['merge', '--abort']); } catch { /* no merge to abort */ }
      rmSync(taskEvidenceRoot, { recursive: true, force: true });
      if (hadTaskEvidence) cpSync(evidenceBackup, taskEvidenceRoot, { recursive: true });
    }
    if (!run.unconfirmedExecution) try { releaseExecutionLease(projectRoot, lease.id, { token: lease.token, outcome: 'blocked' }); } catch { /* recovery handles it */ }
    taskState(run, task, { status: 'blocked', error: error.message });
    saveRun(paths, run);
    event(projectRoot, run, `${task.id} integration blocked.`, error.message, 'blocked', true);
    throw error;
  }
}

export async function executeAfkRun(projectRoot, runId, dependencies = {}) {
  const { paths, run } = requireRun(projectRoot, runId);
  if (run.desiredState !== 'running' && run.executionStopped === true && !(run.activeWorkers ?? []).length) {
    run.status = run.desiredState === 'paused' ? 'paused' : 'cancelled'; run.pid = null;
    if (run.desiredState === 'cancelled') run.cancellation = { ...run.cancellation, status: 'confirmed', settledAt: now() };
    return saveRun(paths, run);
  }
  run.pid = process.pid;
  run.status = 'running';
  saveRun(paths, run);
  if (dependencies.authority) authorityChecks.set(run, dependencies.authority);
  try {
    if (run.autonomy && !authorityChecks.has(run)) throw new Error('Autonomous AFK run requires its original live authority context.');
    while (run.desiredState === 'running') {
      const graph = readGraph(paths.projectRoot, run.slug);
      const check = validateTaskGraph(deliveryPaths(paths.projectRoot, run.slug).deliveryRoot, { slug: run.slug });
      if (check.status !== 'pass') throw new Error(`Task graph became invalid: ${check.errors.map((item) => item.message).join('; ')}`);
      if (check.completedTasks.length === graph.tasks.length) {
        run.status = 'completed';
        run.executionStopped = !run.unconfirmedExecution;
        run.pid = null;
        event(paths.projectRoot, run, 'All AFK Build tasks are integrated.', 'EWAI Build remains open for its canonical phase gate and subsequent lifecycle stages.');
        return saveRun(paths, run);
      }
      const executableIds = selectExecutableTaskIds(graph, check, run.maxParallel);
      if (!executableIds.length) throw new Error('No executable AFK task remains; a HITL task, dependency, or evidence blocker needs attention.');
      const firstReady = graph.tasks.find((task) => task.id === executableIds[0]);
      const waveDefinition = graph.afk_waves.find((candidate) => Number(candidate.wave) === Number(firstReady.parallel_wave));
      const wave = executableIds.map((id) => graph.tasks.find((task) => task.id === id));
      const results = await Promise.all(wave.map((task, index) => (
        implementTask(paths.projectRoot, run, task, run.providers[index % run.providers.length], dependencies)
      )));
      const control = requireRun(paths.projectRoot, run.id).run;
      run.desiredState = control.desiredState;
      if (run.desiredState === 'cancelled') {
        run.status = run.unconfirmedExecution ? 'cancel-unknown' : 'cancelled';
        run.cancellation = { ...control.cancellation, status: run.unconfirmedExecution ? 'unknown' : 'confirmed', settledAt: now() };
        run.executionStopped = !run.unconfirmedExecution;
        run.pid = null;
        if (!run.unconfirmedExecution) {
          abandonExecutionLeasesForRun(paths.projectRoot, run.id, { outcome: 'conductor-cancelled' });
          run.activeWorkers = [];
        }
        return saveRun(paths, run);
      }
      const failed = results.find((result) => result.error);
      if (failed) throw failed.error;
      const order = waveDefinition?.merge_order ?? wave.map((task) => task.id);
      for (const id of order) {
        const result = results.find((candidate) => candidate.task.id === id);
        if (result) await integrateTask(paths.projectRoot, run, result);
      }
      const refreshed = requireRun(paths.projectRoot, run.id).run;
      run.desiredState = refreshed.desiredState;
      if (run.desiredState === 'paused') {
        run.status = 'paused';
        run.executionStopped = !run.unconfirmedExecution;
        run.pid = null;
        event(paths.projectRoot, run, 'Unattended Build safely paused.', 'The active wave finished and no new task was leased.');
        return saveRun(paths, run);
      }
    }
    return saveRun(paths, run);
  } catch (error) {
    const control = requireRun(paths.projectRoot, run.id).run;
    run.desiredState = control.desiredState;
    run.status = control.desiredState === 'cancelled' ? run.unconfirmedExecution ? 'cancel-unknown' : 'cancelled' : 'blocked';
    if (control.desiredState === 'cancelled') run.cancellation = { ...control.cancellation,
      status: run.unconfirmedExecution ? 'unknown' : 'confirmed', settledAt: now() };
    run.pid = null;
    run.messages.push({ at: now(), message: error.message });
    run.executionStopped = !run.unconfirmedExecution;
    if (!run.unconfirmedExecution) abandonExecutionLeasesForRun(paths.projectRoot, run.id, { outcome: 'conductor-blocked' });
    event(paths.projectRoot, run, 'Unattended Build is blocked.', error.message, 'blocked', true);
    saveRun(paths, run);
    return run;
  } finally { authorityChecks.delete(run); }
}
