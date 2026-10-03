import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, readFileSync, existsSync, writeFileSync, readdirSync, chmodSync, mkdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { initProject } from '../src/project.mjs';
import { createIntent, updateIntentDeliveryState } from '../src/intents.mjs';
import { beginDelivery } from '../src/delivery.mjs';
import { finishActiveSession } from '../src/runtime/work.mjs';
import { previewAutonomy, approveAutonomyGrant, readAutonomyPolicy, revokeAutonomyGrant } from '../src/autonomy.mjs';
import { autonomyDigest, writeAutonomyRecord, readAutonomyRepositoryState } from '../src/runtime/autonomy-workspace.mjs';
import { runAutonomyOnce, readAutonomyRun, controlAutonomyRun, startAutonomyService, answerAutonomyQuestion } from '../src/runtime/autonomy-supervisor.mjs';
import { afkRunStatus } from '../src/runtime/afk-conductor.mjs';
import { validateTaskGraph } from '../src/task-graph.mjs';

function git(root, ...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function commit(root) { git(root, 'add', '-A'); git(root, 'commit', '--allow-empty', '-m', 'fixture baseline'); }
function consumer(t, options = {}) {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'ewai-supervisor-consumer-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initProject(root, { name: 'Supervisor consumer', specsRoot: 'knowledge' });
  const intent = createIntent(root, { domain: 'product', slug: 'alpha' });
  updateIntentDeliveryState(root, intent.path, { status: 'ready' });
  const preview = previewAutonomy(root, { record: true, proposal: {
    intentIds: ['product/alpha'], actions: options.actions ?? ['begin-harness', 'prepare-phase'], providers: ['claude'],
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    limits: { maxConcurrentIntents: 1, maxRuntimeMs: 60000, maxOperationMs: 10000, maxAttempts: 2, ...options.limits },
  } });
  const grant = approveAutonomyGrant(root, { expectedDigest: preview.digest, approvedBy: 'Fixture owner', confirmed: true });
  git(root, 'init', '-b', 'fixture'); git(root, 'config', 'user.name', 'Fixture'); git(root, 'config', 'user.email', 'fixture@example.invalid'); commit(root);
  return { root, grant };
}

// A durable, named revocation is input evidence. This first RED exercises the
// real existing policy and worker readers, not an absent supervisor module.
function revokedEvidence(root, grant) {
  const body = { schema: 'ewai.autonomy-revocation/v1', id: grant.id, grantRevision: grant.revision,
    grantDigest: grant.digest, revokedBy: 'Fixture owner', revokedAt: new Date().toISOString(), projectIdentity: grant.projectIdentity };
  const record = { ...body, digest: autonomyDigest(body) };
  writeAutonomyRecord(root, resolve(root, 'knowledge/3.Evidence/autonomy/grants', grant.id,
    'revocations', `${grant.revision}-${record.digest.slice(7)}.json`), record);
  return record;
}

async function controlledWorker(root, observe) {
  const url = new URL('../src/runtime/autonomy-workers.mjs', import.meta.url);
  const stub = `export async function invokeRestrictedPhaseProvider(adapter,input) {
    const request=JSON.parse(input.prompt); await adapter.observe();
    return {status:'complete',exitCode:0,executionStopped:true,output:JSON.stringify({
      schema:'ewai.autonomy-phase-proposal/v1',phase:request.contract.phase,contractDigest:request.contract.digest,
      artifacts:[{path:request.contract.paths[0],content:'Useful source-bound draft retained for human review.',sourceRefs:['accepted-intent']}]
    })};
  }`;
  const stubUrl = 'data:text/javascript;base64,' + Buffer.from(stub).toString('base64');
  const source = readFileSync(url, 'utf8').replace(/from (['"])(\.[^'"]+)\1/g, (_match, _quote, specifier) =>
    `from ${JSON.stringify(specifier === './provider-adapters.mjs' ? stubUrl : new URL(specifier, url).href)}`);
  const api = await import('data:text/javascript;base64,' + Buffer.from(source + `\n// ${root}`).toString('base64'));
  return { api, adapter: { provider: 'claude', observe } };
}

test('revocation prevents the next dispatch and acceptance under the old grant', async t => {
  const { root, grant } = consumer(t);
  beginDelivery(root, 'alpha', { tool: 'claude' });
  finishActiveSession(root, 'product/alpha', { tool: 'claude', summary: 'Fixture ready.' });
  const { api, adapter } = await controlledWorker(root, () => revokedEvidence(root, grant));
  const contract = api.prepareAutonomyPhase(root, 'product/alpha', 'intent');
  assert.equal(contract.status, 'prepared');
  const result = await api.invokePhaseProposal(contract, adapter);
  assert.equal(readAutonomyPolicy(root).mode, 'off', 'revocation must turn shared authority off');
  assert.equal(readAutonomyPolicy(root).status, 'revoked');
  assert.equal(previewAutonomy(root).executable.length, 0, 'no new dispatch under a revoked grant');
  assert.equal(result.status, 'unaccepted-draft', 'late work is retained without acceptance');
  assert.equal(existsSync(resolve(root, result.proposalRoot, 'intent-summary.md')), true);
  assert.equal(api.acceptPhaseProposal(root, contract.operationId, result).status, 'blocked');
  assert.equal(existsSync(resolve(root, 'knowledge/3.Evidence/autonomy/phase-workers', contract.operationId, 'assessment.json')), false);
  assert.equal(api.prepareAutonomyPhase(root, 'product/alpha', 'intent').status, 'blocked');
});

async function controlledSupervisor(root, observe = async () => {}, verify = async () => ({status:'verified', executionStopped:true}), afkProvider = null) {
  const providerSource = `let observe = async () => {}, verify; export function setObserver(value, verifier) { observe = value; verify = verifier; }
    export function preparePhaseProvider(provider) { return {status:'requires-conformance', provider}; }
    export async function verifyPhaseProviderConformance(handle, control) { return verify(control); }
    export async function invokeRestrictedPhaseProvider(adapter,input) {
      const request = JSON.parse(input.prompt), override = await observe(input);
      return override ?? {status:'complete',exitCode:0,executionStopped:true,output:JSON.stringify({
        schema:'ewai.autonomy-phase-proposal/v1',phase:request.contract.phase,contractDigest:request.contract.digest,
        artifacts:[{path:request.contract.paths[0],content:'Source-bound fixture draft for human review.',sourceRefs:['accepted-intent']}]
      })};
    } // ${root}`;
  const providerUrl = 'data:text/javascript;base64,' + Buffer.from(providerSource).toString('base64');
  (await import(providerUrl)).setObserver(observe, verify);
  const workerUrl = new URL('../src/runtime/autonomy-workers.mjs', import.meta.url);
  const rewrite = (source, base, overrides = {}) => source.replace(/from (['"])(\.[^'"]+)\1/g,
    (_match, _quote, specifier) => `from ${JSON.stringify(overrides[specifier] ?? new URL(specifier, base).href)}`);
  const workerSource = rewrite(readFileSync(workerUrl, 'utf8'), workerUrl, { './provider-adapters.mjs': providerUrl });
  const workerModule = 'data:text/javascript;base64,' + Buffer.from(workerSource).toString('base64');
  const supervisorUrl = new URL('../src/runtime/autonomy-supervisor.mjs', import.meta.url);
  const overrides = { './provider-adapters.mjs': providerUrl, './autonomy-workers.mjs': workerModule };
  if (afkProvider) {
    const original = new URL('../src/runtime/afk-conductor.mjs', import.meta.url).href;
    const afkSource = `import {startAfkRun as start, resumeAfkRun as resume} from ${JSON.stringify(original)};
      export {preflightAfkRun, pauseAfkRun, cancelAfkRun, afkRunStatus} from ${JSON.stringify(original)};
      let invokeProvider; export function setProvider(value) { invokeProvider = value; }
      export function startAfkRun(root, slug, options) { return start(root, slug, {...options,
        dependencies:{...options.dependencies, invokeProvider}}); }
      export function resumeAfkRun(root, id, options) { return resume(root, id, {...options,
        dependencies:{...options.dependencies, invokeProvider}}); } // ${root}`;
    overrides['./afk-conductor.mjs'] = 'data:text/javascript;base64,' + Buffer.from(afkSource).toString('base64');
    (await import(overrides['./afk-conductor.mjs'])).setProvider(afkProvider);
  }
  const source = rewrite(readFileSync(supervisorUrl, 'utf8'), supervisorUrl,
    overrides)
    .replace("new URL('../autonomy-worker.mjs', import.meta.url).pathname", JSON.stringify(new URL('../src/autonomy-worker.mjs', import.meta.url).pathname));
  return import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { createRun, listRuns };').toString('base64'));
}
function phaseFixture(t, options) {
  const fixture = consumer(t, options); beginDelivery(fixture.root, 'alpha', { tool: 'claude' });
  finishActiveSession(fixture.root, 'product/alpha', { tool: 'claude', summary: 'Fixture ready.' }); commit(fixture.root); return fixture;
}

test('run once begins exactly one harness through the canonical mutation path', async t => {
  const { root, grant } = consumer(t);
  const result = await runAutonomyOnce(root, { expectedDigest: grant.digest, provider: 'claude' });
  assert.equal(result.status, 'completed'); assert.equal(result.lastResult.status, 'harness-started');
  assert.equal(result.counters.actions, 1); assert.equal(result.counters.providerAttempts, 0);
  assert.equal(result.phaseCompleted, false); assert.equal(result.usage.providerReported, null); assert.equal(result.usage.hardMoneyCap, false);
  assert.equal(readAutonomyRun(root, result.id).digest, result.digest);
  const state = JSON.parse(readFileSync(resolve(root, 'knowledge/6.Build/alpha/delivery-state.json')));
  assert.equal(state.currentPhase, 'intent'); assert.equal(state.approvals?.build ?? null, null);
});

async function approvedBuildFixture(t, limits = {}) {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'ewai-supervisor-build-'))), oldPath = process.env.PATH;
  t.after(() => { process.env.PATH = oldPath; rmSync(root, { recursive: true, force: true }); });
  // Reuse the existing AFK domain fixture and fake paid-provider boundary.
  // Suppress test registration only; actual preflight, leases, git, command
  // execution, report validation and integration remain production code.
  const url = new URL('./afk-conductor.test.mjs', import.meta.url);
  const original = readFileSync(url, 'utf8'), importsEnd = original.indexOf('function git(');
  const source = original.slice(0, importsEnd).replace("import test from 'node:test';", 'const test = () => {};')
    .replace("from 'yaml'", `from ${JSON.stringify(import.meta.resolve('yaml'))}`)
    .replace(/from (['"])(\.[^'"]+)\1/g, (_match, _quote, specifier) => `from ${JSON.stringify(new URL(specifier, url).href)}`) + original.slice(importsEnd);
  const fixture = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport {prepareProject, fakeProvider};').toString('base64'));
  process.env.PATH = `${fixture.prepareProject(root)}:${oldPath}`;
  const directory = resolve(root, 'SPECS/6.Build/safe-change'), statePath = resolve(directory, 'delivery-state.json');
  const state = JSON.parse(readFileSync(statePath)), approval = { schema: 'ewai.build-approval/v1', decision: 'approved',
    approvedBy: 'Fixture owner', approvedAt: new Date().toISOString(), scope: 'One fixture task only.' };
  // This focused fixture asserts current handoff authority, not evidence of a
  // completed fourteen-stage delivery. Keep its accepted intent copies aligned.
  state.intent.status = 'ready';
  updateIntentDeliveryState(root, resolve(root, 'SPECS/2.Purpose/intents/delivery/safe-change.md'), { status: 'ready' });
  state.approvals.build = { approvedBy: approval.approvedBy, approvedAt: approval.approvedAt, scope: approval.scope };
  writeFileSync(statePath, JSON.stringify(state)); writeFileSync(resolve(directory, 'gates/build/build-approval.json'), JSON.stringify(approval));
  const preview = previewAutonomy(root, { record: true, proposal: {
    intentIds: ['delivery/safe-change'], actions: ['afk-build'], providers: ['codex'], expiresAt: new Date(Date.now() + 3600000).toISOString(),
    limits: { maxConcurrentIntents: 1, maxRuntimeMs: 120000, maxOperationMs: 60000, maxAttempts: 2, ...limits },
  } });
  const grant = approveAutonomyGrant(root, { expectedDigest: preview.digest, approvedBy: 'Fixture owner', confirmed: true }); commit(root);
  return { root, grant, fixture, directory, statePath };
}

test('supervisor hands current Build authority to real AFK and charges implementation plus review', async t => {
  const { root, grant, fixture } = await approvedBuildFixture(t), modes = [];
  const api = await controlledSupervisor(root, undefined, undefined, async (...args) => { modes.push(args[0].mode); return fixture.fakeProvider(...args); });
  const result = await api.runAutonomyOnce(root, { expectedDigest: grant.digest, provider: 'codex' });
  assert.equal(result.status, 'completed', result.code); assert.equal(result.lastResult.status, 'afk-settled');
  assert.deepEqual(modes, ['implementation', 'review']); assert.equal(result.counters.providerAttempts, 2); assert.equal(result.counters.reviewCycles, 1);
  assert.equal(result.executionStopped, true); assert.equal(result.phaseCompleted, false);
});

test('AFK reserves the required fresh review before spending its last implementation attempt', async t => {
  const { root, grant, fixture } = await approvedBuildFixture(t, { maxAttempts: 1 }); let calls = 0;
  const api = await controlledSupervisor(root, undefined, undefined, async (...args) => { calls++; return fixture.fakeProvider(...args); });
  const result = await api.runAutonomyOnce(root, { expectedDigest: grant.digest, provider: 'codex' });
  assert.equal(result.code, 'autonomy-attempts-exhausted'); assert.equal(calls, 0); assert.equal(result.counters.providerAttempts, 0);
});

test('stale named Build approval blocks before AFK preflight or provider dispatch (PTS-019)', async t => {
  const { root, grant, fixture, directory } = await approvedBuildFixture(t); let calls = 0;
  const path = resolve(directory, 'gates/build/build-approval.json'), approval = JSON.parse(readFileSync(path));
  approval.scope = 'Changed without matching durable approval.'; writeFileSync(path, JSON.stringify(approval)); commit(root);
  const api = await controlledSupervisor(root, undefined, undefined, async (...args) => { calls++; return fixture.fakeProvider(...args); });
  const result = await api.runAutonomyOnce(root, { expectedDigest: grant.digest, provider: 'codex' });
  assert.equal(result.code, 'autonomy-build-approval-stale'); assert.equal(calls, 0);
});

test('review cannot smuggle unrelated parent edits into AFK integration (T004-R01)', async t => {
  const { root, grant, fixture } = await approvedBuildFixture(t);
  const before = git(root, 'rev-parse', 'HEAD');
  const api = await controlledSupervisor(root, undefined, undefined, async (...args) => {
    const result = await fixture.fakeProvider(...args);
    if (args[0].mode === 'review') writeFileSync(resolve(root, 'human-edit.txt'), 'preserve unrelated work');
    return result;
  });
  const result = await api.runAutonomyOnce(root, { expectedDigest: grant.digest, provider: 'codex' });
  assert.equal(result.status, 'blocked'); assert.equal(git(root, 'rev-parse', 'HEAD'), before);
  assert.equal(readFileSync(resolve(root, 'human-edit.txt'), 'utf8'), 'preserve unrelated work');
  assert.equal(git(root, 'ls-files', 'human-edit.txt'), '');
});

test('malformed supervisor evidence never discloses its contents through public operations (T004-R02)', async t => {
  const { root, grant } = consumer(t), api = await controlledSupervisor(root);
  const run = api.createRun(root, { expectedDigest: grant.digest, provider: 'claude' }, 'once');
  const directory = resolve(root, '.ewai-pipeline/runtime/autonomy/supervisor/runs', run.id, 'revisions');
  writeFileSync(resolve(directory, readdirSync(directory)[0]), '{"PRIVATE_EVIDENCE_CANARY":');
  const safe = error => error.code === 'autonomy-run-evidence-invalid' && !error.message.includes('PRIVATE_EVIDENCE_CANARY') && !error.message.includes(root);
  assert.throws(() => readAutonomyRun(root, run.id), safe);
  assert.throws(() => controlAutonomyRun(root, { runId: run.id, action: 'cancel', expectedRevision: run.revision }), safe);
  await assert.rejects(runAutonomyOnce(root, { expectedDigest: grant.digest, provider: 'claude' }), safe);
});

for (const malformed of ['{"PRIVATE_AFK_CANARY":', 'PRIVATE_AFK_CANARY']) test(`malformed delegated AFK control evidence is redacted: ${malformed} (T004-R02)`, async t => {
  const { root, grant } = consumer(t), api = await controlledSupervisor(root);
  const run = api.createRun(root, { expectedDigest: grant.digest, provider: 'claude' }, 'once');
  const afkRunId = '11111111-2222-4333-8444-555555555555';
  const delegated = crashRecord(root, run, { current: { action: 'afk-build', intentId: 'product/alpha', phase: 'build',
    operationId: afkRunId, afkRunId } });
  const directory = resolve(root, '.ewai-pipeline/afk/runs', afkRunId); mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'run.json'), malformed);
  assert.throws(() => controlAutonomyRun(root, { runId: run.id, action: 'pause', expectedRevision: delegated.revision }),
    error => error.code === 'autonomy-operation-failed' && !error.message.includes('PRIVATE_AFK_CANARY') && !error.message.includes(root));
});

async function twoTaskBuildFixture(t) {
  const { root, grant, directory } = await approvedBuildFixture(t, { maxAttempts: 4 });
  const graphPath = resolve(directory, 'task-graph.json'), graph = JSON.parse(readFileSync(graphPath));
  const second = structuredClone(graph.tasks[0]), command = 'node --test test/second.test.mjs';
  const ledgerPath = resolve(directory, 'gates/plan/claim-ledger.json'), ledger = JSON.parse(readFileSync(ledgerPath));
  ledger.implementation_claims.push({ id: 'CL-002', type: 'implementation' }); writeFileSync(ledgerPath, JSON.stringify(ledger));
  Object.assign(second, { id: 'T-002', name: 'Second fixture task', parallel_wave: 2, branch: 'feature/safe-change/T-002-second',
    claims: ['CL-002'],
    depends_on: ['T-001'], write_set: ['src/second.mjs', 'test/second.test.mjs'], read_set: ['test/second.test.mjs'],
    first_failing_test: command, red_green_refactor: { ...second.red_green_refactor, red_command: command, green_command: command },
    allowed_commands: [command], merge: { ...second.merge, post_merge_checks: [command] },
    ralph_loop: { ...second.ralph_loop, completion_promise: '<promise>T-002 COMPLETE</promise>' },
    report_path: 'tasks/T-002/report.md', evidence_path: 'tasks/T-002/evidence.json' });
  graph.tasks.push(second); graph.afk_waves.push({ wave: 2, ready_tasks: ['T-002'], parallel_tasks: [], merge_order: ['T-002'], rationale: 'Second bounded task.' });
  writeFileSync(graphPath, JSON.stringify(graph));
  const checked = validateTaskGraph(directory, { slug: 'safe-change' });
  assert.equal(checked.status, 'pass', JSON.stringify(checked.errors));
  return { root, grant, directory };
}

for (const pause of [false, true]) test(`two-task service ${pause ? 'pauses across processes then resumes the same run' : 'continues after its owned merge'} (T004-R05/R06)`, async t => {
  const { root, grant } = await twoTaskBuildFixture(t);
  const marker = resolve(root, '.ewai-pipeline/fixture-phase-ready'), release = resolve(root, '.ewai-pipeline/fixture-phase-release');
  const cli = resolve(root, '.test-bin/codex');
  writeFileSync(cli, `#!/usr/bin/env node
const fs=require('node:fs'); process.stdin.resume();
if(process.argv.includes('read-only')) { process.stdout.write('Tests reviewed first.\\nVERDICT: PASS\\n'); }
else {
  fs.writeFileSync(${JSON.stringify(marker)},String(process.pid));
  const timer=setInterval(()=>{
    if(!fs.existsSync(${JSON.stringify(release)}))return;
    clearInterval(timer); fs.mkdirSync('src',{recursive:true}); fs.mkdirSync('test',{recursive:true});
    const name=fs.existsSync('src/output.mjs')?'second':'output';
    fs.writeFileSync('src/'+name+'.mjs',"export const message = 'ready';\\n");
    fs.writeFileSync('test/'+name+'.test.mjs',"import test from 'node:test';import assert from 'node:assert/strict';import {message} from '../src/"+name+".mjs';test('ready',()=>assert.equal(message,'ready'));\\n");
    process.stdout.write('fixture implementation complete');
  },25);
}
`); chmodSync(cli, 0o755); commit(root);
  let started, providerPid, serviceStopped = false;
  try {
    started = startAutonomyService(root, { expectedDigest: grant.digest, provider: 'codex', confirmed: true });
    // Wait for the declared operation deadline, not an unrelated short fixture
    // deadline that fails while a valid two-task run is still executing.
    const settleTimeout = grant.scope.limits.maxOperationMs + 5000;
    let current = started, deadline = Date.now() + settleTimeout;
    while (!existsSync(marker) && Date.now() < deadline && ['starting', 'running'].includes(current.status)) {
      await new Promise(done => setTimeout(done, 25)); current = readAutonomyRun(root, started.id);
    }
    assert.ok(existsSync(marker), `controlled implementation reached: ${current.status} ${current.code} ${JSON.stringify(current.questions)}`);
    providerPid = Number(readFileSync(marker, 'utf8')); current = readAutonomyRun(root, started.id);
    assert.notEqual(current.lifetime.ownerProcessId, process.pid, 'controller is a separate process from the service');
    const originalAfkId = current.current.afkRunId;
    if (pause) {
      const paused = controlAutonomyRun(root, { runId: current.id, action: 'pause', expectedRevision: current.revision });
      assert.equal(afkRunStatus(root, originalAfkId).desiredState, 'paused', 'pause reached durable AFK control');
      assert.equal(paused.executionStopped, false);
    }
    writeFileSync(release, 'settle the current task');
    deadline = Date.now() + settleTimeout;
    while (Date.now() < deadline) {
      await new Promise(done => setTimeout(done, 25)); current = readAutonomyRun(root, started.id);
      if (['paused', 'awaiting-human', 'completed'].includes(current.status) && !current.lifetime.ownerProcessAlive) { serviceStopped = true; break; }
      if (['blocked', 'recovery-required'].includes(current.status)) break;
    }
    if (pause) {
      assert.equal(current.status, 'paused', current.code); assert.equal(current.executionStopped, true);
      const afk = afkRunStatus(root)[0]; assert.equal(afk.tasks['T-001'].status, 'completed'); assert.equal(afk.tasks['T-002'], undefined);
      assert.equal(current.counters.providerAttempts, 2); assert.equal(serviceStopped, true);
      const elapsed = current.counters.elapsedMs;
      started = controlAutonomyRun(root, { runId: current.id, action: 'resume', expectedRevision: current.revision });
      assert.equal(started.id, current.id); serviceStopped = false; deadline = Date.now() + settleTimeout;
      while (Date.now() < deadline) {
        await new Promise(done => setTimeout(done, 25)); current = readAutonomyRun(root, started.id);
        if (['awaiting-human', 'completed', 'blocked', 'recovery-required'].includes(current.status) && !current.lifetime.ownerProcessAlive) { serviceStopped = true; break; }
      }
      assert.ok(current.counters.elapsedMs >= elapsed);
    }
    assert.ok(['awaiting-human', 'completed'].includes(current.status), `${current.status}: ${current.code}`);
    const runs = afkRunStatus(root); assert.equal(runs.length, 1); assert.equal(runs[0].id, originalAfkId);
    assert.equal(runs[0].tasks['T-002'].status, 'completed'); assert.equal(current.counters.providerAttempts, 4);
    assert.equal(current.counters.reviewCycles, 2); assert.equal(serviceStopped, true);
  } finally {
    if (!serviceStopped && started) {
      try { const current = readAutonomyRun(root, started.id); controlAutonomyRun(root, { runId: current.id, action: 'cancel', expectedRevision: current.revision }); } catch {}
      for (const pid of [providerPid, started.lifetime.ownerProcessId]) if (pid && pid !== process.pid) try { process.kill(-pid, 'SIGKILL'); } catch {}
    }
  }
});

test('unknown phase termination retains recovery ownership and prevents another run', async t => {
  const { root, grant } = phaseFixture(t); let entered;
  const ready = new Promise(done => { entered = done; });
  const api = await controlledSupervisor(root, input => new Promise(done => {
    entered(); input.signal.addEventListener('abort', () => done({ status: 'unknown', executionStopped: false, output: '' }), { once: true });
  }));
  const run = api.createRun(root, { expectedDigest: grant.digest, provider: 'claude' }, 'once');
  const pending = api.executeAutonomyRun(root, run.id); await ready;
  api.controlAutonomyRun(root, { runId: run.id, action: 'cancel', expectedRevision: api.readAutonomyRun(root, run.id).revision });
  const result = await pending;
  assert.equal(result.status, 'recovery-required'); assert.equal(result.executionStopped, false);
  assert.ok(result.current.workerOperationId); assert.equal(result.cancellation.status, 'unknown');
  await assert.rejects(api.runAutonomyOnce(root, { expectedDigest: grant.digest, provider: 'claude' }), { code: 'autonomy-supervisor-busy' });
  assert.throws(() => api.controlAutonomyRun(root, { runId: run.id, action: 'resume', expectedRevision: result.revision }), { code: 'autonomy-recovery-required' });
});

test('an unavailable conformance result with unknown termination is never treated as stopped', async t => {
  const { root, grant } = phaseFixture(t); let calls = 0;
  const api = await controlledSupervisor(root, () => { calls++; }, async () => ({ status: 'unavailable', code: 'phase-execution-unknown', executionStopped: false }));
  const result = await api.runAutonomyOnce(root, { expectedDigest: grant.digest, provider: 'claude' });
  assert.equal(result.status, 'recovery-required'); assert.equal(result.executionStopped, false); assert.equal(calls, 0); assert.ok(result.current);
});

for (const clockCase of ['expired', 'rollback']) test(`dispatch rejects ${clockCase} clock authority (PTS-005)`, async t => {
  const { root, grant } = consumer(t), api = await controlledSupervisor(root);
  const run = api.createRun(root, { expectedDigest: grant.digest, provider: 'claude' }, 'once'), realNow = Date.now;
  let result;
  try {
    Date.now = () => clockCase === 'expired' ? Date.parse(grant.scope.expiresAt) + 1 : run.lastClock - 1000;
    result = await api.executeAutonomyRun(root, run.id);
  } finally { Date.now = realNow; }
  assert.equal(result.status, clockCase === 'expired' ? 'expired' : 'blocked');
  assert.equal(result.code, clockCase === 'expired' ? 'autonomy-grant-expired' : 'autonomy-clock-rollback');
  assert.equal(existsSync(resolve(root, 'knowledge/6.Build/alpha/delivery-state.json')), false);
});

test('provider attempts remain charged across new run identifiers and projection rebuild', async t => {
  const { root, grant } = phaseFixture(t, { limits: { maxAttempts: 1 } }); let calls = 0;
  const api = await controlledSupervisor(root, () => { calls++; return { status: 'failed', executionStopped: true, exitCode: 1, output: '' }; });
  const first = await api.runAutonomyOnce(root, { expectedDigest: grant.digest, provider: 'claude' });
  assert.equal(first.status, 'blocked'); assert.equal(first.counters.providerAttempts, 1); commit(root);
  rmSync(resolve(root, '.ewai-pipeline/data'), { recursive: true });
  const second = await api.runAutonomyOnce(root, { expectedDigest: grant.digest, provider: 'claude' });
  assert.equal(second.code, 'autonomy-attempts-exhausted'); assert.equal(calls, 1); assert.notEqual(first.id, second.id);
});

test('a forward wall-clock jump exhausts runtime before accepting a late draft', async t => {
  const { root, grant } = phaseFixture(t), realNow = Date.now;
  const api = await controlledSupervisor(root, () => { const future = realNow() + grant.scope.limits.maxRuntimeMs + 1000; Date.now = () => future; });
  let result;
  try { result = await api.runAutonomyOnce(root, { expectedDigest: grant.digest, provider: 'claude' }); }
  finally { Date.now = realNow; }
  assert.equal(result.code, 'autonomy-runtime-exhausted'); assert.equal(result.lastResult, null);
  assert.ok(result.counters.elapsedMs >= grant.scope.limits.maxRuntimeMs); assert.equal(result.counters.providerAttempts, 1);
});

test('operation deadline aborts only its own phase and does not accept output', async t => {
  const { root, grant } = phaseFixture(t, { limits: { maxOperationMs: 1000 } });
  const api = await controlledSupervisor(root, input => new Promise(done => input.signal.addEventListener('abort',
    () => done({ status: 'cancelled', executionStopped: true, exitCode: -1, output: '' }), { once: true })));
  const result = await api.runAutonomyOnce(root, { expectedDigest: grant.digest, provider: 'claude' });
  assert.equal(result.status, 'blocked'); assert.equal(result.code, 'autonomy-operation-timeout');
  assert.equal(result.executionStopped, true); assert.equal(result.lastResult, null);
});

test('repository topology overlap is a blocker, even when both checkouts are clean', t => {
  const { root } = consumer(t), path = resolve(root, 'knowledge/pipeline.yaml'), config = YAML.parse(readFileSync(path, 'utf8'));
  config.repositories.push({ ...config.repositories[0], name: 'duplicate' }); writeFileSync(path, YAML.stringify(config)); commit(root);
  assert.ok(readAutonomyRepositoryState(root).reasons.includes('autonomy-repository-topology-overlap'));
});

test('resume executes the same run with preserved counters and stale controls are rejected', async t => {
  const { root, grant } = consumer(t), api = await controlledSupervisor(root);
  const created = api.createRun(root, { expectedDigest: grant.digest, provider: 'claude' }, 'once');
  const paused = api.controlAutonomyRun(root, { runId: created.id, action: 'pause', expectedRevision: created.revision });
  assert.equal(paused.status, 'paused');
  assert.throws(() => api.controlAutonomyRun(root, { runId: created.id, action: 'resume', expectedRevision: created.revision }), { code: 'autonomy-run-stale' });
  const result = await api.controlAutonomyRun(root, { runId: created.id, action: 'resume', expectedRevision: paused.revision });
  assert.equal(result.id, created.id); assert.equal(result.status, 'completed'); assert.equal(result.counters.actions, 1);
  assert.ok(result.counters.elapsedMs >= paused.counters.elapsedMs);
});

test('a pause does not extend expiry or allow clock rollback on resume', async t => {
  const { root, grant } = consumer(t), api = await controlledSupervisor(root), realNow = Date.now;
  const created = api.createRun(root, { expectedDigest: grant.digest, provider: 'claude' }, 'once');
  const paused = api.controlAutonomyRun(root, { runId: created.id, action: 'pause', expectedRevision: created.revision });
  try {
    Date.now = () => Date.parse(grant.scope.expiresAt) + 1;
    assert.throws(() => api.controlAutonomyRun(root, { runId: created.id, action: 'resume', expectedRevision: paused.revision }), { code: 'autonomy-grant-expired' });
    Date.now = () => created.lastClock - 1000;
    assert.throws(() => api.controlAutonomyRun(root, { runId: created.id, action: 'resume', expectedRevision: paused.revision }), { code: 'autonomy-clock-rollback' });
  } finally { Date.now = realNow; }
  assert.equal(api.readAutonomyRun(root, created.id).status, 'paused');
});

test('late unrelated repository edits prevent phase acceptance and are preserved', async t => {
  const { root, grant } = phaseFixture(t);
  const api = await controlledSupervisor(root, () => { writeFileSync(resolve(root, 'human-edit.txt'), 'keep'); });
  const result = await api.runAutonomyOnce(root, { expectedDigest: grant.digest, provider: 'claude' });
  assert.equal(result.code, 'autonomy-repository-dirty'); assert.equal(result.lastResult, null);
  assert.equal(readFileSync(resolve(root, 'human-edit.txt'), 'utf8'), 'keep');
});

test('shared revocation disables new foreground and service requests without starting them', async t => {
  const { root, grant } = consumer(t);
  revokeAutonomyGrant(root, { expectedDigest: grant.digest, revokedBy: 'Fixture owner', confirmed: true });
  await assert.rejects(runAutonomyOnce(root, { expectedDigest: grant.digest, provider: 'claude' }), { code: 'autonomy-grant-revoked' });
  assert.throws(() => startAutonomyService(root, { expectedDigest: grant.digest, provider: 'claude', confirmed: true }), { code: 'autonomy-grant-revoked' });
  assert.equal(existsSync(resolve(root, '.ewai-pipeline/runtime/autonomy/supervisor/runs')), false);
});

function crashRecord(root, run, changes) {
  const { digest, ...body } = run, next = { ...body, ...changes, revision: run.revision + 1, previousDigest: digest, updatedAt: new Date().toISOString() };
  const value = { ...next, digest: autonomyDigest(next) };
  writeAutonomyRecord(root, resolve(root, '.ewai-pipeline/runtime/autonomy/supervisor/runs', run.id, 'revisions',
    `${value.revision}-${value.digest.slice(7)}.json`), value); return value;
}

for (const changed of [false, true]) test(`lost begin response recovers ${changed ? 'only to a human question after conflicting edits' : 'from the canonical receipt without repeating begin'}`, async t => {
  const { root, grant } = consumer(t), api = await controlledSupervisor(root);
  const complete = await api.runAutonomyOnce(root, { expectedDigest: grant.digest, provider: 'claude' });
  assert.equal(complete.status, 'completed');
  const saved = api.listRuns(root)[0], deadPid = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid;
  const lost = crashRecord(root, saved, { status: 'running', executionStopped: false, lastResult: null,
    current: { action: 'begin-harness', intentId: 'product/alpha', phase: 'intent', operationId: complete.lastResult.operationId },
    owner: { ...saved.owner, pid: deadPid } });
  if (changed) writeFileSync(resolve(root, 'knowledge/6.Build/alpha/human-note.md'), 'A changed canonical input.');
  assert.equal(api.readAutonomyRun(root, saved.id).status, 'recovery-required');
  const result = api.controlAutonomyRun(root, { runId: saved.id, action: 'recover', expectedRevision: lost.revision });
  assert.equal(result.status, changed ? 'recovery-required' : 'completed'); assert.equal(result.executionStopped, !changed);
  assert.equal(result.counters.actions, 1); assert.equal(result.counters.providerAttempts, 0);
});

test('service launch is explicit and its child stops at the bounded human decision', async t => {
  const { root, grant } = consumer(t, { actions: ['begin-harness'] });
  assert.throws(() => startAutonomyService(root, { expectedDigest: grant.digest, provider: 'claude' }), { code: 'autonomy-run-confirmation-required' });
  const started = startAutonomyService(root, { expectedDigest: grant.digest, provider: 'claude', confirmed: true });
  assert.equal(started.mode, 'service');
  let result = started;
  const deadline = Date.now() + 15000;
  while (['starting', 'running'].includes(result.status) && Date.now() < deadline) {
    await new Promise(done => setTimeout(done, 50)); result = readAutonomyRun(root, started.id);
  }
  assert.equal(result.status, 'awaiting-human', result.code); assert.equal(result.counters.actions, 1);
  assert.equal(result.counters.providerAttempts, 0); assert.equal(result.executionStopped, true);
  while (result.lifetime.ownerProcessAlive && Date.now() < deadline) {
    await new Promise(done => setTimeout(done, 25)); result = readAutonomyRun(root, started.id);
  }
  assert.equal(result.lifetime.ownerProcessAlive, false, 'explicit service process exits at its decision boundary');
  const cancelled = controlAutonomyRun(root, { runId: result.id, action: 'cancel', expectedRevision: result.revision });
  assert.equal(cancelled.status, 'cancelled');
  const again = await runAutonomyOnce(root, { expectedDigest: grant.digest, provider: 'claude' });
  assert.equal(again.questions[0].id, result.questions[0].id, 'unchanged owned question is deduplicated across runs');
});

test('a dirty repository blocks before beginning or invoking any provider', async t => {
  const { root, grant } = consumer(t); writeFileSync(resolve(root, 'owner-work.txt'), 'preserve me');
  const result = await runAutonomyOnce(root, { expectedDigest: grant.digest, provider: 'claude' });
  assert.equal(result.status, 'blocked'); assert.equal(result.code, 'autonomy-repository-dirty');
  assert.equal(existsSync(resolve(root, 'knowledge/6.Build/alpha/delivery-state.json')), false);
  assert.equal(readFileSync(resolve(root, 'owner-work.txt'), 'utf8'), 'preserve me');
});

test('a supervised phase stages a draft and asks an owned question without approving a gate (PTS-018)', async t => {
  const { root, grant } = phaseFixture(t), api = await controlledSupervisor(root);
  const result = await api.runAutonomyOnce(root, { expectedDigest: grant.digest, provider: 'claude' });
  assert.equal(result.status, 'awaiting-human', `${result.code}: ${git(root, 'status', '--porcelain=v1', '--untracked-files=all')}`); assert.equal(result.lastResult.status, 'draft-staged');
  assert.equal(result.counters.providerAttempts, 1); assert.equal(result.questions.length, 1);
  const q = result.questions[0]; assert.equal(q.owner, 'Fixture owner'); assert.equal(q.authority, 'none');
  assert.throws(() => api.answerAutonomyQuestion(root, { runId: result.id, questionId: q.id, expectedRevision: result.revision,
    answeredBy: 'Different owner', answer: 'Approve' }), error => error.code === 'autonomy-question-owner-required');
  const answer = api.answerAutonomyQuestion(root, { runId: result.id, questionId: q.id, expectedRevision: result.revision,
    answeredBy: 'Fixture owner', answer: 'Private answer, not an approval.' });
  assert.equal(answer.approvalRecorded, false); assert.equal(JSON.stringify(api.readAutonomyRun(root, result.id)).includes('Private answer'), false);
  assert.throws(() => api.controlAutonomyRun(root, { runId: result.id, action: 'resume', expectedRevision: result.revision }),
    error => error.code === 'autonomy-canonical-decision-required');
});

for (const action of ['pause', 'cancel', 'revoke']) test(`${action} during an active phase preserves the correct stop and acceptance boundary`, async t => {
  const { root, grant } = phaseFixture(t); let entered, release;
  const ready = new Promise(done => { entered = done; }), held = new Promise(done => { release = done; });
  const api = await controlledSupervisor(root, async () => { entered(); await held; });
  const run = api.createRun(root, { expectedDigest: grant.digest, provider: 'claude' }, 'once');
  const pending = api.executeAutonomyRun(root, run.id); await ready;
  const current = api.readAutonomyRun(root, run.id);
  await assert.rejects(api.runAutonomyOnce(root, { expectedDigest: grant.digest, provider: 'claude' }), error => error.code === 'autonomy-supervisor-busy');
  const requested = api.controlAutonomyRun(root, { runId: run.id, action, expectedRevision: current.revision,
    ...(action === 'revoke' ? { confirmed: true, revokedBy: 'Fixture owner' } : {}) });
  assert.equal(requested.executionStopped, false);
  if (action !== 'pause') assert.equal(requested.cancellation.status, 'requested');
  release(); const settled = await pending;
  assert.equal(settled.executionStopped, true);
  assert.equal(settled.status, action === 'pause' ? 'paused' : action === 'revoke' ? 'revoked' : 'cancelled', settled.code);
  if (action !== 'pause') { assert.equal(settled.cancellation.status, 'confirmed'); assert.equal(settled.lastResult, null); }
});

test('revocation after a worker settles still prevents assessment acceptance', async t => {
  const { root, grant } = consumer(t);
  beginDelivery(root, 'alpha', { tool: 'claude' });
  finishActiveSession(root, 'product/alpha', { tool: 'claude', summary: 'Fixture ready.' });
  const { api, adapter } = await controlledWorker(root, () => {});
  const contract = api.prepareAutonomyPhase(root, 'product/alpha', 'intent');
  const result = await api.invokePhaseProposal(contract, adapter);
  assert.equal(result.status, 'draft-ready');
  revokeAutonomyGrant(root, { expectedDigest: grant.digest, revokedBy: 'Fixture owner', confirmed: true });
  const assessment = api.acceptPhaseProposal(root, contract.operationId, result);
  assert.equal(assessment.status, 'blocked'); assert.equal(assessment.code, 'phase-grant-stale');
  assert.equal(existsSync(resolve(root, result.proposalRoot, 'intent-summary.md')), true);
  assert.equal(existsSync(resolve(root, 'knowledge/3.Evidence/autonomy/phase-workers', contract.operationId, 'assessment.json')), false);
});
