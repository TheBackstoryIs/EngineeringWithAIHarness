import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import YAML from 'yaml';
import { createIntent, updateIntentDeliveryState } from '../src/intents.mjs';
import { configureExternalValidation, initProject } from '../src/project.mjs';
import {
  afkRunStatus, cancelAfkRun, pauseAfkRun, preflightAfkRun, selectExecutableTaskIds, startAfkRun,
} from '../src/runtime/afk-conductor.mjs';
import { listExecutionLeases } from '../src/runtime/execution-leases.mjs';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function seed(root, options = {}) {
  const parentBranch = options.parentBranch ?? 'feature/safe-change';
  const taskRepository = options.taskRepository ?? 'application';
  initProject(root, { name: 'AFK Test', specsRoot: options.specsRoot });
  const created = createIntent(root, { slug: 'safe-change', domain: 'delivery', title: 'Safe Change' });
  const specsRoot = resolve(root, options.specsRoot ?? 'SPECS');
  const deliveryRoot = resolve(specsRoot, '6.Build/safe-change');
  mkdirSync(resolve(deliveryRoot, 'gates/plan'), { recursive: true });
  mkdirSync(resolve(deliveryRoot, 'gates/build'), { recursive: true });
  writeFileSync(resolve(deliveryRoot, 'gates/plan/claim-ledger.json'), '{"implementation_claims":[{"id":"CL-001","type":"implementation"}],"slices":[{"id":"SLICE-001"}]}\n');
  writeFileSync(resolve(deliveryRoot, 'gates/plan/plan-contract.json'), '{"vertical_slices":[{"id":"SLICE-001"}]}\n');
  writeFileSync(resolve(deliveryRoot, 'destination.md'), '# Destination\n');
  const command = 'node --test test/output.test.mjs';
  writeFileSync(resolve(deliveryRoot, 'task-graph.json'), `${JSON.stringify({
    schema_version: 1,
    slug: 'safe-change',
    status: 'final',
    parent_branch: parentBranch,
    ...(options.repositoryBranches ? { repository_branches: options.repositoryBranches } : {}),
    source: { claim_ledger: 'gates/plan/claim-ledger.json', plan_contract: 'gates/plan/plan-contract.json', destination: 'destination.md' },
    parallelism: { allowed: false, max_parallel_tasks: 1, rationale: 'One bounded task.' },
    afk_waves: [{ wave: 1, ready_tasks: ['T-001'], parallel_tasks: [], merge_order: ['T-001'], rationale: 'Single task.' }],
    tasks: [{
      id: 'T-001', slice: 'SLICE-001', name: 'Safe output', issue_kind: 'tracer-bullet', priority: 1,
      parallel_wave: 1, classification: 'AFK', repo: taskRepository, branch: options.taskBranch ?? 'feature/safe-change/T-001-output',
      depends_on: [], claims: ['CL-001'], user_visible_outcome: 'A verified output module exists.',
      read_set: ['test/output.test.mjs'], write_set: ['src/output.mjs', 'test/output.test.mjs'], central_writes_allowed: false,
      module_interface_contract: { module: 'output', interface: ['message'], behaviour_owned: ['message'], caller_contract: ['returns text'], test_boundary: 'unit' },
      first_failing_test: command, no_first_test_rationale: '',
      red_green_refactor: { red_command: command, expected_red_failure: 'module missing', green_command: command, refactor_boundary: 'output module' },
      allowed_commands: [command], stop_conditions: ['contract conflict'], completion_evidence: ['tests pass'],
      ralph_loop: { allowed: false, max_iterations: 0, completion_promise: '<promise>T-001 COMPLETE</promise>' },
      review: { fresh_context_required: true, review_tests_first: true, standards_pushed: ['SPECS/pipeline.yaml'] },
      merge: { orchestrator_owned: true, post_merge_checks: [command] },
      report_path: 'tasks/T-001/report.md', evidence_path: 'tasks/T-001/evidence.json',
    }],
  }, null, 2)}\n`);
  writeFileSync(resolve(deliveryRoot, 'gates/build/build-approval.json'), '{"schema":"ewai.build-approval/v1","decision":"approved"}\n');
  writeFileSync(resolve(deliveryRoot, 'delivery-state.json'), `${JSON.stringify({
    schema: 'ewai.delivery-state/v1', slug: 'safe-change',
    intent: { id: 'delivery/safe-change', slug: 'safe-change', status: 'in-progress' },
    status: 'in-progress', currentPhase: 'build', phases: [{ id: 'build', status: 'running' }],
    adjuncts: [], humanGates: [], approvals: { build: true },
  }, null, 2)}\n`);
  updateIntentDeliveryState(root, created.path, {
    status: 'in-progress', deliveryStatus: 'in-progress', currentPhase: 'build',
    deliveryStatePath: `${options.specsRoot ?? 'SPECS'}/6.Build/safe-change/delivery-state.json`,
  });
  configureExternalValidation(root, 'codex', 'available', true);
}

async function fakeProvider(invocation, options = {}) {
  options.onStart?.(999999);
  if (invocation.mode === 'review') {
    return { exitCode: 0, timedOut: false, output: 'Tests reviewed first. The change is scoped and correct.\nVERDICT: PASS\n', logPath: invocation.logPath };
  }
  const root = invocation.cwd;
  mkdirSync(resolve(root, 'src'), { recursive: true });
  mkdirSync(resolve(root, 'test'), { recursive: true });
  writeFileSync(resolve(root, 'src/output.mjs'), "export const message = 'ready';\n");
  writeFileSync(resolve(root, 'test/output.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; import { message } from '../src/output.mjs'; test('ready',()=>assert.equal(message,'ready'));\n");
  mkdirSync(resolve(invocation.logPath, '..'), { recursive: true });
  writeFileSync(invocation.logPath, 'fake provider completed\n');
  return { exitCode: 0, timedOut: false, output: 'done', logPath: invocation.logPath };
}

function prepareProject(root) {
  const bin = resolve(root, '.test-bin');
  mkdirSync(bin);
  const codex = resolve(bin, 'codex');
  writeFileSync(codex, '#!/bin/sh\nexit 0\n');
  chmodSync(codex, 0o755);
  git(root, ['init', '-b', 'feature/safe-change']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'EWAI Test']);
  seed(root);
  git(root, ['add', '-A']);
  git(root, ['commit', '-m', 'seed approved build']);
  return bin;
}

function initializeGitRepository(root, branch) {
  mkdirSync(root, { recursive: true });
  git(root, ['init', '-b', branch]);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'EWAI Test']);
}

function prepareMultiRepoProject(base) {
  const project = resolve(base, 'workspace');
  const knowledge = resolve(project, 'knowledge');
  const api = resolve(project, 'api');
  mkdirSync(project, { recursive: true });
  initializeGitRepository(knowledge, 'feature/safe-change-docs');
  initializeGitRepository(api, 'feature/safe-change-api');
  seed(project, {
    specsRoot: 'knowledge/SPECS',
    parentBranch: 'feature/safe-change-docs',
    taskRepository: 'api',
    taskBranch: 'feature/safe-change-api/T-001-output',
    repositoryBranches: {
      knowledge: { parent_branch: 'feature/safe-change-docs' },
      api: { parent_branch: 'feature/safe-change-api' },
    },
  });
  const actualConfigPath = resolve(knowledge, 'SPECS/pipeline.yaml');
  const config = YAML.parse(readFileSync(actualConfigPath, 'utf8'));
  config.repositories = [
    { name: 'knowledge', path: 'knowledge', role: 'knowledge-and-delivery' },
    { name: 'api', path: 'api', role: 'backend' },
  ];
  writeFileSync(actualConfigPath, YAML.stringify(config, { lineWidth: 0 }));
  writeFileSync(resolve(api, 'README.md'), '# API\n');
  const bin = resolve(project, '.test-bin');
  mkdirSync(bin);
  writeFileSync(resolve(bin, 'codex'), '#!/bin/sh\nexit 0\n');
  chmodSync(resolve(bin, 'codex'), 0o755);
  git(api, ['add', '-A']);
  git(api, ['commit', '-m', 'seed api']);
  git(knowledge, ['add', '-A']);
  git(knowledge, ['commit', '-m', 'seed multi-repo delivery']);
  return { project, knowledge, api, bin };
}

test('parallel execution is limited to tasks explicitly declared safe in the active wave', () => {
  const graph = {
    parallelism: { allowed: true },
    tasks: [{ id: 'T-001', parallel_wave: 1 }, { id: 'T-002', parallel_wave: 1 }],
    afk_waves: [{ wave: 1, parallel_tasks: [], merge_order: ['T-002', 'T-001'] }],
  };
  const check = { tasks: [{ id: 'T-001', status: 'ready', requiresHuman: false }, { id: 'T-002', status: 'ready', requiresHuman: false }] };
  assert.deepEqual(selectExecutableTaskIds(graph, check, 2), ['T-002']);
  graph.afk_waves[0].parallel_tasks = ['T-001', 'T-002'];
  assert.deepEqual(selectExecutableTaskIds(graph, check, 2), ['T-002', 'T-001']);
});

test('executes an approved AFK task through worktree, review, merge, and durable evidence', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-afk-'));
  const bin = resolve(root, '.test-bin');
  const oldPath = process.env.PATH;
  try {
    prepareProject(root);
    process.env.PATH = `${bin}${delimiter}${oldPath}`;

    const run = await startAfkRun(root, 'safe-change', {
      provider: 'codex', maxParallel: 1, foreground: true, dependencies: { invokeProvider: fakeProvider },
    });
    assert.equal(run.status, 'completed', JSON.stringify(run.messages));
    assert.equal(run.topology.kind, 'simple');
    assert.equal(readFileSync(resolve(root, 'src/output.mjs'), 'utf8'), "export const message = 'ready';\n");
    const evidence = JSON.parse(readFileSync(resolve(root, 'SPECS/6.Build/safe-change/tasks/T-001/evidence.json'), 'utf8'));
    assert.equal(evidence.task_branch, 'feature/safe-change/T-001-output');
    assert.equal(evidence.branch, run.tasks['T-001'].actualBranch);
    assert.notEqual(evidence.branch, evidence.task_branch);
    assert.equal(evidence.repository, 'application');
    assert.equal(evidence.review.status, 'pass');
    assert.equal(evidence.post_merge_checks[0].exit_code, 0);
    assert.equal(listExecutionLeases(root, { activeOnly: true }).length, 0);
    assert.match(git(root, ['log', '-1', '--pretty=%s']), /integrate T-001/);
    assert.equal(git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${evidence.branch}`]), '');
  } finally {
    process.env.PATH = oldPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test('creates a missing integration branch from the clean current branch before task work', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-afk-parent-'));
  const oldPath = process.env.PATH;
  try {
    initializeGitRepository(root, 'main');
    seed(root);
    const bin = resolve(root, '.test-bin');
    mkdirSync(bin);
    writeFileSync(resolve(bin, 'codex'), '#!/bin/sh\nexit 0\n');
    chmodSync(resolve(bin, 'codex'), 0o755);
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'seed on main']);
    process.env.PATH = `${bin}${delimiter}${oldPath}`;

    const preflight = preflightAfkRun(root, 'safe-change', { provider: 'codex' });
    assert.equal(preflight.status, 'ready', preflight.failures.join('\n'));
    assert.equal(preflight.topology.repositories[0].branchAction, 'create');
    const run = await startAfkRun(root, 'safe-change', {
      provider: 'codex', foreground: true, dependencies: { invokeProvider: fakeProvider },
    });
    assert.equal(run.status, 'completed', JSON.stringify(run.messages));
    assert.equal(git(root, ['branch', '--show-current']), 'feature/safe-change');
    assert.equal(run.topology.repositories[0].branchAction, 'created');
  } finally {
    process.env.PATH = oldPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test('maps tasks to configured repositories and integrates real branches in a multi-repo project', async () => {
  const base = mkdtempSync(resolve(tmpdir(), 'ewai-afk-multi-'));
  const oldPath = process.env.PATH;
  try {
    const { project, knowledge, api, bin } = prepareMultiRepoProject(base);
    process.env.PATH = `${bin}${delimiter}${oldPath}`;
    const preflight = preflightAfkRun(project, 'safe-change', { provider: 'codex' });
    assert.equal(preflight.status, 'ready', preflight.failures.join('\n'));
    assert.equal(preflight.topology.kind, 'multi-repo');
    assert.equal(preflight.topology.specsRepository, 'knowledge');

    const run = await startAfkRun(project, 'safe-change', {
      provider: 'codex', foreground: true, dependencies: { invokeProvider: fakeProvider },
    });
    assert.equal(run.status, 'completed', JSON.stringify(run.messages));
    assert.equal(readFileSync(resolve(api, 'src/output.mjs'), 'utf8'), "export const message = 'ready';\n");
    const evidence = JSON.parse(readFileSync(resolve(knowledge, 'SPECS/6.Build/safe-change/tasks/T-001/evidence.json'), 'utf8'));
    assert.equal(evidence.repository, 'api');
    assert.equal(evidence.base_branch, 'feature/safe-change-api');
    assert.equal(evidence.branch, run.tasks['T-001'].actualBranch);
    assert.equal(git(api, ['show-ref', '--verify', '--quiet', `refs/heads/${evidence.branch}`]), '');
    assert.match(git(api, ['log', '-1', '--pretty=%s']), /integrate T-001/);
    assert.match(git(knowledge, ['log', '-1', '--pretty=%s']), /delivery evidence/);
  } finally {
    process.env.PATH = oldPath;
    rmSync(base, { recursive: true, force: true });
  }
});

test('safe pause finishes and integrates the active wave before leasing more work', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-afk-pause-'));
  const oldPath = process.env.PATH;
  try {
    const bin = prepareProject(root);
    process.env.PATH = `${bin}${delimiter}${oldPath}`;
    const delayedProvider = async (...args) => {
      await new Promise((done) => setTimeout(done, 40));
      return fakeProvider(...args);
    };
    const pending = startAfkRun(root, 'safe-change', {
      provider: 'codex', foreground: true, dependencies: { invokeProvider: delayedProvider },
    });
    await new Promise((done) => setTimeout(done, 10));
    const active = afkRunStatus(root)[0];
    pauseAfkRun(root, active.id);
    const run = await pending;
    assert.equal(run.status, 'paused');
    assert.equal(run.tasks['T-001'].status, 'completed');
    assert.equal(listExecutionLeases(root, { activeOnly: true }).length, 0);
  } finally {
    process.env.PATH = oldPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test('cancellation abandons leases and does not integrate late worker output', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-afk-cancel-'));
  const oldPath = process.env.PATH;
  try {
    const bin = prepareProject(root);
    process.env.PATH = `${bin}${delimiter}${oldPath}`;
    const delayedProvider = async (...args) => {
      await new Promise((done) => setTimeout(done, 40));
      return fakeProvider(...args);
    };
    const pending = startAfkRun(root, 'safe-change', {
      provider: 'codex', foreground: true, dependencies: { invokeProvider: delayedProvider },
    });
    await new Promise((done) => setTimeout(done, 10));
    const active = afkRunStatus(root)[0];
    cancelAfkRun(root, active.id);
    const run = await pending;
    assert.equal(run.status, 'cancelled');
    assert.equal(listExecutionLeases(root, { activeOnly: true }).length, 0);
    assert.equal(readFileSync(resolve(root, 'SPECS/6.Build/safe-change/destination.md'), 'utf8'), '# Destination\n');
    assert.equal(git(root, ['status', '--porcelain']), '');
  } finally {
    process.env.PATH = oldPath;
    rmSync(root, { recursive: true, force: true });
  }
});
