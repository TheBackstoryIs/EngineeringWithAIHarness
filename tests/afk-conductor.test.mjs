import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import YAML from 'yaml';
import { createIntent, updateIntentDeliveryState } from '../src/intents.mjs';
import { configureExternalValidation, initProject } from '../src/project.mjs';
import {
  afkRunStatus, cancelAfkRun, pauseAfkRun, preflightAfkRun, resumeAfkRun, selectExecutableTaskIds, startAfkRun,
} from '../src/runtime/afk-conductor.mjs';
import { listExecutionLeases } from '../src/runtime/execution-leases.mjs';
import {readCodingProviders,saveCodingProviders} from '../src/coding-providers.mjs';
import { sha256 } from '../src/delivery-documents.mjs';
import {prepareGrokBuildProvider} from '../src/runtime/provider-adapters.mjs';

test('AFK supplies Grok source standards, implementation diff and recorded checks before review dispatch',{skip:process.platform!=='darwin'},async t=>{
  const root=mkdtempSync(resolve(tmpdir(),'ewai-afk-grok-evidence-')),oldPath=process.env.PATH,oldTestContext=process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  t.after(()=>{process.env.PATH=oldPath;if(oldTestContext===undefined)delete process.env.NODE_TEST_CONTEXT;else process.env.NODE_TEST_CONTEXT=oldTestContext;rmSync(root,{recursive:true,force:true});});
  const bin=prepareProject(root);process.env.PATH=`${bin}${delimiter}${oldPath}`;
  const capability=prepareGrokBuildProvider('review');if(capability.status==='unavailable'){t.skip(capability.code);return;}
  configureExternalValidation(root,'grok','available',true);
  providerPolicy(root,{pool:['codex','grok'],primary:'codex',secondary:'grok',tertiary:'off'});
  const standard=readFileSync(resolve(root,'SPECS/pipeline.yaml'),'utf8'),calls=[];
  const run=await startAfkRun(root,'safe-change',{foreground:true,dependencies:{invokeProvider:async(invocation,options)=>{
    calls.push([invocation.mode,invocation.provider]);
    if(invocation.provider==='grok'){
      assert.ok(invocation.grokEvidence);assert.ok(invocation.prompt.includes(standard));
      assert.match(invocation.prompt,/diff --git a\/src\/output.mjs/);assert.match(invocation.prompt,/\+export const message = 'ready'/);
      for(const stage of ['red','green','refactor'])assert.ok(invocation.prompt.includes('"stage":"'+stage+'"'));
      assert.match(invocation.prompt,/Could not find/);assert.match(invocation.prompt,/pass 1/);
    }
    return fakeProvider(invocation,options);
  }}});
  assert.equal(run.status,'completed',JSON.stringify(run.messages));
  assert.deepEqual(calls,[['implementation','codex'],['review','grok']]);
});

function providerPolicy(root, policy) {
  saveCodingProviders(root,{confirmed:true,expectedDigest:readCodingProviders(root,{probe:()=>false}).digest,policy},{probe:()=>false});
  git(root,['add','-A']);git(root,['commit','-m','fixture provider settings']);
}
function extraProvider(root, provider) {
  const path=resolve(root,'.test-bin',provider==='antigravity'?'agy':provider);
  writeFileSync(path,'#!/bin/sh\nprintf "fixture provider 1\\n"\n');chmodSync(path,0o755);
  configureExternalValidation(root,provider,'available',true);
}

test('saved primary and two distinct review roles reach the real AFK dispatch boundary',async t=>{
  const root=mkdtempSync(resolve(tmpdir(),'ewai-afk-roles-')),oldPath=process.env.PATH;
  t.after(()=>{process.env.PATH=oldPath;rmSync(root,{recursive:true,force:true});});
  const bin=prepareProject(root);process.env.PATH=`${bin}${delimiter}${oldPath}`;
  extraProvider(root,'claude');extraProvider(root,'antigravity');
  providerPolicy(root,{pool:['codex','claude','antigravity'],primary:'codex',secondary:'claude',tertiary:'antigravity'});
  const calls=[];
  const run=await startAfkRun(root,'safe-change',{foreground:true,dependencies:{invokeProvider:async(invocation,options)=>{
    calls.push([invocation.mode,invocation.provider]);return fakeProvider(invocation,options);
  }}});
  assert.equal(run.status,'completed',JSON.stringify(run.messages));
  assert.deepEqual(calls,[['implementation','codex'],['review','claude'],['review','antigravity']]);
});

test('AFK saved primary conflicts and unsupported model restrictions block preflight',t=>{
  const root=mkdtempSync(resolve(tmpdir(),'ewai-afk-policy-')),oldPath=process.env.PATH;
  t.after(()=>{process.env.PATH=oldPath;rmSync(root,{recursive:true,force:true});});
  const bin=prepareProject(root);process.env.PATH=`${bin}${delimiter}${oldPath}`;extraProvider(root,'claude');
  providerPolicy(root,{pool:['codex','claude'],primary:'claude',secondary:'off',tertiary:'off'});
  const conflict=preflightAfkRun(root,'safe-change',{provider:'codex'});
  assert.equal(conflict.status,'blocked');assert.match(conflict.failures.join(' '),/conflict|saved primary/i);
  providerPolicy(root,{pool:['codex'],primary:'codex',secondary:'off',tertiary:'off',models:{codex:{permitted_models:['fixture']}}});
  const restricted=preflightAfkRun(root,'safe-change');assert.equal(restricted.status,'blocked');assert.match(restricted.failures.join(' '),/cannot enforce/);
});

test('AFK automatic selection excludes Grok identities without a coding contract',t=>{
  const root=mkdtempSync(resolve(tmpdir(),'ewai-afk-capability-')),oldPath=process.env.PATH;
  t.after(()=>{process.env.PATH=oldPath;rmSync(root,{recursive:true,force:true});});
  const bin=prepareProject(root);process.env.PATH=`${bin}${delimiter}${oldPath}`;
  extraProvider(root,'grok');extraProvider(root,'claude');
  providerPolicy(root,{pool:['grok','codex','claude'],primary:'auto',secondary:'claude',tertiary:'off'});
  const result=preflightAfkRun(root,'safe-change');assert.equal(result.status,'ready',result.failures.join(' '));
  assert.equal(result.codingRoles.primary,'codex');assert.equal(result.providers.includes('grok'),false);
});

test('AFK identity drift stops before a provider result can be integrated',async t=>{
  const root=mkdtempSync(resolve(tmpdir(),'ewai-afk-identity-')),oldPath=process.env.PATH;
  t.after(()=>{process.env.PATH=oldPath;rmSync(root,{recursive:true,force:true});});
  const bin=prepareProject(root);process.env.PATH=`${bin}${delimiter}${oldPath}`;
  providerPolicy(root,{pool:['codex'],primary:'codex',secondary:'off',tertiary:'off'});
  const run=await startAfkRun(root,'safe-change',{foreground:true,dependencies:{invokeProvider:async(invocation,options)=>{
    const result=await fakeProvider(invocation,options);writeFileSync(resolve(bin,'codex'),'#!/bin/sh\nprintf "changed\\n"\n');return result;
  }}});
  assert.equal(run.status,'blocked');assert.match(run.messages.map(v=>JSON.stringify(v)).join(' '),/identity changed/i);
  assert.throws(()=>readFileSync(resolve(root,'src/output.mjs')),{code:'ENOENT'});
});

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
    return { exitCode: 0, timedOut: false, executionStopped: true, output: 'Tests reviewed first. The change is scoped and correct.\n' + invocation.task.completion_evidence.map(name => 'COMPLETION_CHECK: ' + JSON.stringify({name,status:'pass',support:'test/output.test.mjs asserts message equals ready; src/output.mjs exports message.',challenge:{attempt:'Trace missing export and non-ready value',result:'The equality assertion rejects either case'},observation:{evidence_type:'behaviour',expected:'ready',actual:'ready',evidence:'test/output.test.mjs equality assertion and captured green result'}})).join('\n') + '\nVERDICT: PASS\n', logPath: invocation.logPath };
  }
  const root = invocation.cwd;
  mkdirSync(resolve(root, 'src'), { recursive: true });
  mkdirSync(resolve(root, 'test'), { recursive: true });
  writeFileSync(resolve(root, 'src/output.mjs'), "export const message = 'ready';\n");
  writeFileSync(resolve(root, 'test/output.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; import { message } from '../src/output.mjs'; test('ready',()=>assert.equal(message,'ready'));\n");
  mkdirSync(resolve(invocation.logPath, '..'), { recursive: true });
  writeFileSync(invocation.logPath, 'fake provider completed\n');
  return { exitCode: 0, timedOut: false, executionStopped: true, output: 'done', logPath: invocation.logPath };
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
    let entered;
    const providerEntered = new Promise(resolvePromise => { entered = resolvePromise; });
    const delayedProvider = async (...args) => {
      entered();
      await new Promise((done) => setTimeout(done, 40));
      return fakeProvider(...args);
    };
    const pending = startAfkRun(root, 'safe-change', {
      provider: 'codex', foreground: true, dependencies: { invokeProvider: delayedProvider },
    });
    await providerEntered;
    const active = afkRunStatus(root)[0];
    const requested = cancelAfkRun(root, active.id);
    assert.equal(requested.status, 'cancel-requested', 'acknowledgement is not termination evidence');
    assert.equal(listExecutionLeases(root, { activeOnly: true }).length, 1, 'retain ownership until execution settles');
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

test('unknown cancellation retains active leases and refuses integration', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-afk-cancel-unknown-')), oldPath = process.env.PATH;
  try {
    const bin = prepareProject(root); process.env.PATH = `${bin}${delimiter}${oldPath}`;
    let entered;
    const ready = new Promise(done => { entered = done; });
    const pending = startAfkRun(root, 'safe-change', { provider: 'codex', foreground: true, dependencies: {
      invokeProvider: (invocation, options) => new Promise(done => {
        options.onStart(999998); entered();
        options.signal.addEventListener('abort', () => done({ cancelled: true, executionStopped: false, exitCode: -1,
          output: '', logPath: invocation.logPath }), { once: true });
      }),
    } });
    await ready; const active = afkRunStatus(root)[0]; cancelAfkRun(root, active.id);
    const result = await pending;
    assert.equal(result.status, 'cancel-unknown'); assert.equal(result.cancellation.status, 'unknown');
    assert.equal(result.executionStopped, false); assert.equal(result.activeWorkers.length, 1);
    assert.equal(listExecutionLeases(root, { activeOnly: true }).length, 1);
    assert.equal(git(root, ['status', '--porcelain']), '');
  } finally { process.env.PATH = oldPath; rmSync(root, { recursive: true, force: true }); }
});

test('autonomous AFK needs a live authority guard and rechecks it before review and integration', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-afk-authority-')), oldPath = process.env.PATH;
  try {
    const bin = prepareProject(root); process.env.PATH = `${bin}${delimiter}${oldPath}`;
    const autonomy = { runId: '11111111-1111-1111-1111-111111111111', grantDigest: `sha256:${'a'.repeat(64)}` };
    assert.throws(() => startAfkRun(root, 'safe-change', { provider: 'codex', autonomy }), /foreground authority/);
    let runId, allowed = true; const boundaries = [], providers = [];
    const result = await startAfkRun(root, 'safe-change', { provider: 'codex', foreground: true, autonomy, dependencies: {
      onRun: run => { runId = run.id; assert.deepEqual(run.autonomy, autonomy); },
      authority: boundary => { boundaries.push(boundary); if (!allowed) throw new Error('Fixture grant revoked.'); },
      invokeProvider: async (invocation, options) => {
        providers.push(invocation.mode); const value = await fakeProvider(invocation, options);
        if (invocation.mode === 'review') allowed = false;
        return value;
      },
    } });
    assert.equal(runId, result.id); assert.equal(result.status, 'blocked'); assert.equal(result.executionStopped, true);
    assert.deepEqual(providers, ['implementation', 'review']);
    assert.ok(boundaries.some(value => value.stage === 'accept' && value.mode === 'implementation'));
    assert.equal(boundaries.some(value => value.stage === 'integrate'), false, 'revoked review result cannot integrate');
    assert.equal(listExecutionLeases(root, { activeOnly: true }).length, 0);
    assert.equal(git(root, ['status', '--porcelain']), '');
  } finally { process.env.PATH = oldPath; rmSync(root, { recursive: true, force: true }); }
});

test('a real conductor crash cannot resume over its surviving tracked provider (T004-R03)', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-afk-crash-')), oldPath = process.env.PATH;
  let conductorPid, providerPid;
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    const bin = prepareProject(root); process.env.PATH = `${bin}${delimiter}${oldPath}`;
    const marker = resolve(root, '.ewai-pipeline/fixture-provider-ready');
    writeFileSync(resolve(bin, 'codex'), `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));process.stdin.resume();setInterval(()=>{},1000);\n`);
    git(root, ['add', '.test-bin/codex']); git(root, ['commit', '-m', 'controlled live process fixture']);
    const run = startAfkRun(root, 'safe-change', { provider: 'codex', timeoutMs: 20000 }); conductorPid = run.pid;
    let active, deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      active = afkRunStatus(root, run.id);
      try { providerPid = Number(readFileSync(marker, 'utf8')); } catch {}
      if (providerPid && active.activeWorkers.some(worker => worker.pid === providerPid)) break;
      await new Promise(done => setTimeout(done, 25));
    }
    assert.ok(providerPid && alive(providerPid), 'fixture provider is demonstrably alive');
    assert.equal(active.executionStopped, false, 'uncertainty was durable before spawning');
    assert.equal(listExecutionLeases(root, { activeOnly: true }).length, 1);
    process.kill(conductorPid, 'SIGKILL');
    deadline = Date.now() + 5000;
    while (alive(conductorPid) && Date.now() < deadline) await new Promise(done => setTimeout(done, 25));
    assert.equal(alive(conductorPid), false); assert.equal(alive(providerPid), true);
    assert.throws(() => resumeAfkRun(root, run.id), /verified recovery/);
    assert.equal(listExecutionLeases(root, { activeOnly: true }).length, 1);
    assert.equal(afkRunStatus(root, run.id).activeWorkers.some(worker => worker.pid === providerPid), true);
  } finally {
    for (const pid of [providerPid, conductorPid]) if (pid) try { process.kill(-pid, 'SIGKILL'); } catch {}
    process.env.PATH = oldPath; rmSync(root, { recursive: true, force: true });
  }
});

test('changes appearing during post-merge checks are not staged or deleted (T004-R01)', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-afk-integration-conflict-')), oldPath = process.env.PATH;
  try {
    const bin = prepareProject(root); process.env.PATH = `${bin}${delimiter}${oldPath}`;
    const graphPath = resolve(root, 'SPECS/6.Build/safe-change/task-graph.json'), graph = JSON.parse(readFileSync(graphPath));
    const command = `node -e "require('node:fs').writeFileSync('human-edit.txt','preserve unrelated work')"`;
    graph.tasks[0].merge.post_merge_checks = [command]; graph.tasks[0].allowed_commands.push(command);
    writeFileSync(graphPath, JSON.stringify(graph)); git(root, ['add', '-A']); git(root, ['commit', '-m', 'post-merge conflict fixture']);
    const before = git(root, ['rev-parse', 'HEAD']);
    const run = await startAfkRun(root, 'safe-change', { provider: 'codex', foreground: true, dependencies: { invokeProvider: fakeProvider } });
    assert.equal(run.status, 'blocked'); assert.equal(git(root, ['rev-parse', 'HEAD']), before);
    assert.equal(readFileSync(resolve(root, 'human-edit.txt'), 'utf8'), 'preserve unrelated work');
    assert.equal(git(root, ['ls-files', 'human-edit.txt']), '');
    assert.ok(git(root, ['rev-parse', '--verify', 'MERGE_HEAD']), 'conflicting checkout is retained for human recovery');
  } finally { process.env.PATH = oldPath; rmSync(root, { recursive: true, force: true }); }
});

test('a branch change before integration never aborts the owners unrelated merge (T004-R07)', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-afk-owner-merge-')), oldPath = process.env.PATH;
  try {
    const bin = prepareProject(root); process.env.PATH = `${bin}${delimiter}${oldPath}`;
    let mergeHead, index, head;
    const run = await startAfkRun(root, 'safe-change', { provider: 'codex', foreground: true,
      dependencies: { invokeProvider: async (...args) => {
        const result = await fakeProvider(...args);
        if (args[0].mode === 'review') {
          git(root, ['switch', '-c', 'owner-side']); writeFileSync(resolve(root, 'owner.txt'), 'preserve owner merge');
          git(root, ['add', 'owner.txt']); git(root, ['commit', '-m', 'owner work']);
          git(root, ['switch', '-c', 'owner-integration', 'feature/safe-change']);
          git(root, ['merge', '--no-ff', '--no-commit', 'owner-side']);
          mergeHead = git(root, ['rev-parse', 'MERGE_HEAD']); index = git(root, ['write-tree']); head = git(root, ['rev-parse', 'HEAD']);
        }
        return result;
      } } });
    assert.equal(run.status, 'blocked'); assert.equal(git(root, ['branch', '--show-current']), 'owner-integration');
    assert.equal(git(root, ['rev-parse', 'HEAD']), head); assert.equal(git(root, ['rev-parse', 'MERGE_HEAD']), mergeHead);
    assert.equal(git(root, ['write-tree']), index); assert.equal(readFileSync(resolve(root, 'owner.txt'), 'utf8'), 'preserve owner merge');
  } finally { process.env.PATH = oldPath; rmSync(root, { recursive: true, force: true }); }
});

function configureContinuation(root, maxIterations = 3) {
  const path = resolve(root, 'SPECS/6.Build/safe-change/task-graph.json');
  const graph = JSON.parse(readFileSync(path));
  graph.tasks[0].ralph_loop = { allowed: true, max_iterations: maxIterations, completion_promise: '<promise>T-001 COMPLETE</promise>' };
  writeFileSync(path, JSON.stringify(graph, null, 2));
  git(root, ['add', 'SPECS/6.Build/safe-change/task-graph.json']);
  git(root, ['commit', '-m', 'enable bounded continuation']);
}

function endedTurn(invocation, output = '<promise>T-001 COMPLETE</promise>') {
  mkdirSync(dirname(invocation.logPath), { recursive: true });
  writeFileSync(invocation.logPath, output);
  return { exitCode: 0, executionStopped: true, output, logPath: invocation.logPath };
}

test('AFK continues an opted-in worker after a premature successful exit', async t => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-afk-continue-')), oldPath = process.env.PATH;
  t.after(() => { process.env.PATH = oldPath; rmSync(root, { recursive: true, force: true }); });
  process.env.PATH = `${prepareProject(root)}${delimiter}${oldPath}`;
  configureContinuation(root);
  const calls = [];
  const run = await startAfkRun(root, 'safe-change', { foreground: true, dependencies: { invokeProvider: async (invocation, options) => {
    if (invocation.mode === 'implementation') {
      calls.push(invocation);
      if (calls.length === 1) return endedTurn(invocation);
    }
    return fakeProvider(invocation, options);
  } } });
  assert.equal(run.status, 'completed', JSON.stringify(run.messages));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].cwd, calls[1].cwd, 'continue the same worktree');
  assert.match(calls[1].prompt, /continuation|Continue/i);
  assert.match(calls[1].prompt, /green-iteration-1/);
  const evidence = JSON.parse(readFileSync(resolve(root, 'SPECS/6.Build/safe-change/tasks/T-001/evidence.json')));
  assert.equal(evidence.continuation.iterations.length, 2);
  assert.notEqual(evidence.continuation.iterations[0].verification.exit_code, 0);
  assert.equal(evidence.continuation.iterations[1].verification.exit_code, 0);
  for (const iteration of evidence.continuation.iterations) {
    assert.equal(sha256(readFileSync(resolve(root, 'SPECS/6.Build/safe-change', iteration.verification.output_path))), iteration.verification.output_sha256);
  }
});

test('AFK repairs failed green verification without discarding partial work', async t => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-afk-repair-')), oldPath = process.env.PATH;
  const oldTestContext = process.env.NODE_TEST_CONTEXT;
  // Exercise the real subprocess test-runner exit code, outside its parent's IPC context.
  delete process.env.NODE_TEST_CONTEXT;
  t.after(() => {
    process.env.PATH = oldPath;
    if (oldTestContext === undefined) delete process.env.NODE_TEST_CONTEXT;
    else process.env.NODE_TEST_CONTEXT = oldTestContext;
    rmSync(root, { recursive: true, force: true });
  });
  process.env.PATH = `${prepareProject(root)}${delimiter}${oldPath}`;
  configureContinuation(root);
  let turns = 0;
  const run = await startAfkRun(root, 'safe-change', { foreground: true, dependencies: { invokeProvider: async (invocation, options) => {
    if (invocation.mode === 'implementation' && ++turns === 1) {
      await fakeProvider(invocation, options);
      writeFileSync(resolve(invocation.cwd, 'src/output.mjs'), "export const message = 'partial';\n");
      return endedTurn(invocation);
    }
    if (invocation.mode === 'implementation') assert.match(readFileSync(resolve(invocation.cwd, 'src/output.mjs'), 'utf8'), /partial/);
    return fakeProvider(invocation, options);
  } } });
  assert.equal(run.status, 'completed', JSON.stringify(run.messages));
  assert.equal(turns, 2);
});

for (const [name, enabled, response, expected] of [
  ['disabled loop', false, {}, /green command failed/],
  ['exhausted loop', true, {}, /iteration limit/],
  ['explicit blocker', true, { output: 'EWAI_BLOCKED: requirement needs an owner decision' }, /worker reported a blocker/],
  ['provider error', true, { exitCode: 1 }, /exited 1/],
  ['provider timeout', true, { timedOut: true }, /timeout/],
  ['unknown termination', true, { executionStopped: false }, /not confirmed stopped/],
]) {
  test(`AFK stops rather than repeating ${name}`, async t => {
    const root = mkdtempSync(resolve(tmpdir(), 'ewai-afk-stop-')), oldPath = process.env.PATH;
    t.after(() => { process.env.PATH = oldPath; rmSync(root, { recursive: true, force: true }); });
    process.env.PATH = `${prepareProject(root)}${delimiter}${oldPath}`;
    if (enabled) configureContinuation(root, 2);
    let calls = 0;
    const run = await startAfkRun(root, 'safe-change', { foreground: true, dependencies: { invokeProvider: async invocation => {
      calls++;
      return { ...endedTurn(invocation), ...response };
    } } });
    assert.equal(run.status, 'blocked');
    assert.match(run.messages.map(x => x.message).join(' '), expected);
    assert.equal(calls, name === 'exhausted loop' ? 2 : 1);
  });
}

test('AFK checks write scope before another continuation turn', async t => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-afk-scope-loop-')), oldPath = process.env.PATH;
  t.after(() => { process.env.PATH = oldPath; rmSync(root, { recursive: true, force: true }); });
  process.env.PATH = `${prepareProject(root)}${delimiter}${oldPath}`;
  configureContinuation(root);
  let calls = 0;
  const run = await startAfkRun(root, 'safe-change', { foreground: true, dependencies: { invokeProvider: async invocation => {
    calls++;
    writeFileSync(resolve(invocation.cwd, 'outside.txt'), 'scope breach');
    return endedTurn(invocation);
  } } });
  assert.equal(run.status, 'blocked');
  assert.match(run.messages.map(x => x.message).join(' '), /outside its write_set/);
  assert.equal(calls, 1);
});

test('AFK continuation shares one deadline instead of resetting it per turn', async t => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-afk-deadline-')), oldPath = process.env.PATH;
  t.after(() => { process.env.PATH = oldPath; rmSync(root, { recursive: true, force: true }); });
  process.env.PATH = `${prepareProject(root)}${delimiter}${oldPath}`;
  configureContinuation(root);
  let elapsed = 0, calls = 0;
  const run = await startAfkRun(root, 'safe-change', { foreground: true, timeoutMs: 60000, dependencies: {
    monotonicNow: () => elapsed,
    invokeProvider: async invocation => { calls++; elapsed = 60001; return endedTurn(invocation); },
  } });
  assert.equal(run.status, 'blocked');
  assert.match(run.messages.map(x => x.message).join(' '), /task deadline/);
  assert.equal(calls, 1);
});

test('AFK pause prevents a new continuation turn after current worker stops', async t => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-afk-pause-loop-')), oldPath = process.env.PATH;
  t.after(() => { process.env.PATH = oldPath; rmSync(root, { recursive: true, force: true }); });
  process.env.PATH = `${prepareProject(root)}${delimiter}${oldPath}`;
  configureContinuation(root);
  let calls = 0;
  const run = await startAfkRun(root, 'safe-change', { foreground: true, dependencies: { invokeProvider: async invocation => {
    calls++;
    const runId = invocation.logPath.split('/runs/')[1].split('/')[0];
    pauseAfkRun(root, runId);
    return endedTurn(invocation);
  } } });
  assert.equal(run.status, 'paused');
  assert.equal(run.executionStopped, true);
  assert.equal(calls, 1);
});


for (const [format, output] of [
  ['Codex JSON', JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'EWAI_BLOCKED: owner decision required' } })],
  ['Claude stream JSON', JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'EWAI_BLOCKED: owner decision required' }] } })],
  ['stream result', JSON.stringify({ type: 'result', result: 'EWAI_BLOCKED: owner decision required' })],
]) {
  test(`AFK stops on an assistant blocker in ${format}`, async t => {
    const root = mkdtempSync(resolve(tmpdir(), 'ewai-native-blocker-')), oldPath = process.env.PATH;
    t.after(() => { process.env.PATH = oldPath; rmSync(root, { recursive: true, force: true }); });
    process.env.PATH = `${prepareProject(root)}${delimiter}${oldPath}`;
    configureContinuation(root);
    let calls = 0;
    const run = await startAfkRun(root, 'safe-change', { foreground: true, dependencies: { invokeProvider: async invocation => {
      calls++; return endedTurn(invocation, output);
    } } });
    assert.equal(run.status, 'blocked');
    assert.equal(calls, 1);
    assert.match(run.messages.map(x => x.message).join(' '), /worker reported a blocker/);
  });
}

test('AFK preserves hashed failed-iteration evidence across explicit resume', async t => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-loop-resume-')), oldPath = process.env.PATH;
  t.after(() => { process.env.PATH = oldPath; rmSync(root, { recursive: true, force: true }); });
  process.env.PATH = `${prepareProject(root)}${delimiter}${oldPath}`;
  configureContinuation(root);
  const autonomy = { runId: '11111111-1111-1111-1111-111111111111', grantDigest: `sha256:${'a'.repeat(64)}` };
  const paused = await startAfkRun(root, 'safe-change', { foreground: true, autonomy, timeoutMs: 60000, dependencies: {
    authority: () => {}, invokeProvider: async invocation => {
      pauseAfkRun(root, invocation.logPath.split('/runs/')[1].split('/')[0]);
      return endedTurn(invocation);
    },
  } });
  assert.equal(paused.status, 'paused');
  const path = paused.tasks['T-001'].continuation.iterations[0].verification.outputPath;
  const before = readFileSync(path), originalHash = paused.tasks['T-001'].continuation.iterations[0].verification.outputSha256;
  assert.equal(sha256(before), originalHash);
  const resumed = await resumeAfkRun(root, paused.id, { foreground: true, autonomy, timeoutMs: 60000, dependencies: { authority: () => {}, invokeProvider: fakeProvider } });
  assert.equal(resumed.status, 'completed', JSON.stringify(resumed.messages));
  assert.equal(resumed.tasks['T-001'].attempt, 2);
  assert.deepEqual(readFileSync(path), before);
  assert.notEqual(resumed.tasks['T-001'].continuation.iterations[0].verification.outputPath, path);
  const manifest = JSON.parse(readFileSync(resolve(dirname(path), 'continuation.json')));
  assert.equal(manifest.iterations[0].verification.outputSha256, originalHash);
});


test('AFK captures complete large command output with quoted log paths before hashing', async t => {
  const root = mkdtempSync(resolve(tmpdir(), "ewai-loop quote'-")), oldPath = process.env.PATH;
  t.after(() => { process.env.PATH = oldPath; rmSync(root, { recursive: true, force: true }); });
  process.env.PATH = `${prepareProject(root)}${delimiter}${oldPath}`;
  configureContinuation(root);
  const path = resolve(root, 'SPECS/6.Build/safe-change/task-graph.json'), graph = JSON.parse(readFileSync(path));
  const command = `node --test test/output.test.mjs && node -e 'process.stdout.write("x".repeat(2097152))'`;
  graph.tasks[0].red_green_refactor.red_command = command;
  graph.tasks[0].red_green_refactor.green_command = command;
  graph.tasks[0].allowed_commands.push(command);
  writeFileSync(path, JSON.stringify(graph));
  git(root, ['add', 'SPECS/6.Build/safe-change/task-graph.json']);
  git(root, ['commit', '-m', 'declare large-output checks']);
  const run = await startAfkRun(root, 'safe-change', { foreground: true, dependencies: { invokeProvider: fakeProvider } });
  assert.equal(run.status, 'completed', JSON.stringify(run.messages));
  const check = run.tasks['T-001'].continuation.iterations[0].verification;
  const output = readFileSync(check.outputPath);
  assert.ok(output.length >= 2097152);
  assert.equal(sha256(output), check.outputSha256);
});


test('AFK blocks a generic review PASS without per-claim validation', async t => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-claim-review-')), oldPath = process.env.PATH;
  t.after(() => { process.env.PATH = oldPath; rmSync(root, { recursive: true, force: true }); });
  process.env.PATH = `${prepareProject(root)}${delimiter}${oldPath}`;
  const run = await startAfkRun(root, 'safe-change', { foreground: true, dependencies: { invokeProvider: async (invocation, options) => {
    if (invocation.mode === 'review') return endedTurn(invocation, 'VERDICT: PASS\n');
    return fakeProvider(invocation, options);
  } } });
  assert.equal(run.status, 'blocked');
  assert.match(run.messages.map(item => item.message).join(' '), /completion claim/i);
  assert.throws(() => readFileSync(resolve(root, 'src/output.mjs')), /ENOENT/, 'unsupported completion must not integrate');
});


test('AFK checkpoint reports verified work and refuses tampered completion or unknown recovery', async t => {
  const root=mkdtempSync(resolve(tmpdir(),'ewai-checkpoint-')),oldPath=process.env.PATH;
  t.after(()=>{process.env.PATH=oldPath;rmSync(root,{recursive:true,force:true});});
  process.env.PATH=`${prepareProject(root)}${delimiter}${oldPath}`;
  const run=await startAfkRun(root,'safe-change',{foreground:true,dependencies:{invokeProvider:fakeProvider}});
  const status=afkRunStatus(root,run.id);
  assert.equal(status.checkpoint.done.length,1);
  assert.deepEqual(status.checkpoint.done[0].claims,['tests pass']);
  assert.equal(status.checkpoint.repositories[0].integrationBranch,'feature/safe-change');
  assert.equal(status.checkpoint.tasks[0].actualBranch,run.tasks['T-001'].actualBranch);
  assert.equal(status.checkpoint.next.action,'complete-build-gate');
  const runPath=resolve(root,'.ewai-pipeline/afk/runs',run.id,'run.json');
  assert.equal(JSON.parse(readFileSync(runPath)).checkpoint.done.length,1,'checkpoint persisted atomically with run');
  writeFileSync(resolve(root,'SPECS/6.Build/safe-change/tasks/T-001/evidence/green.txt'),'changed output');
  const stale=afkRunStatus(root,run.id).checkpoint;
  assert.equal(stale.done.length,0);
  assert.equal(stale.next.action,'inspect-evidence');
  assert.match(stale.openQuestions.join(' '),/evidence/i);
  const saved=JSON.parse(readFileSync(runPath));saved.status='blocked';saved.executionStopped=false;saved.unconfirmedExecution=true;
  writeFileSync(runPath,JSON.stringify(saved));
  assert.equal(afkRunStatus(root,run.id).checkpoint.next.action,'confirm-worker-termination');
  saved.status='running';saved.pid=999999;writeFileSync(runPath,JSON.stringify(saved));
  assert.equal(afkRunStatus(root,run.id).checkpoint.next.action,'confirm-worker-termination','lost conductor is not active work');
  writeFileSync(resolve(root,'SPECS/6.Build/safe-change/task-graph.json'),JSON.stringify({tasks:{corrupt:true}}));
  const corrupt=afkRunStatus(root,run.id).checkpoint;assert.equal(corrupt.done.length,0);assert.match(corrupt.openQuestions.join(' '),/task graph/);
  writeFileSync(resolve(root,'SPECS/6.Build/safe-change/task-graph.json'),JSON.stringify({tasks:[null]}));
  assert.equal(afkRunStatus(root,run.id).checkpoint.done.length,0);
  const cancelled=cancelAfkRun(root,run.id);assert.equal(cancelled.desiredState,'cancelled');
  assert.equal(JSON.parse(readFileSync(runPath)).desiredState,'cancelled','bad checkpoint cannot obstruct cancellation');
});
