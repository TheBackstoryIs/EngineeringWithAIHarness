import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repositoryRoot = resolve(import.meta.dirname, '..');
function execute(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 90000, ...options });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}
function json(result) { assert.equal(result.status, 0, result.stderr || result.stdout); return JSON.parse(result.stdout); }
function git(root, ...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }

async function packedConsumer(t, options = {}) {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'ewai-autonomy-packed-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packRoot = resolve(root, 'pack'), consumerRoot = resolve(root, 'consumer'), projectRoot = resolve(root, 'project');
  mkdirSync(packRoot); mkdirSync(consumerRoot); mkdirSync(projectRoot);
  if (options.existingProject) {
    const { initProject } = await import('../src/project.mjs');
    const { createIntent } = await import('../src/intents.mjs');
    initProject(projectRoot, { name: 'Existing unconfigured consumer', specsRoot: 'knowledge' });
    createIntent(projectRoot, { domain: 'product', slug: 'alpha', title: 'Existing work' });
  }
  const existingBytes = options.existingProject ? Object.fromEntries([
    '.ewai-pipeline/project.json', 'knowledge/pipeline.yaml',
    'knowledge/2.Purpose/intents/product/alpha.md', 'knowledge/2.Purpose/intents/product/alpha.json',
  ].map(path => [path, readFileSync(resolve(projectRoot, path))])) : null;
  writeFileSync(resolve(consumerRoot, 'package.json'), JSON.stringify({ private: true, name: 'autonomy-fixture-consumer' }));
  const packed = json(execute('npm', ['pack', '--json', '--pack-destination', packRoot], { cwd: repositoryRoot }))[0];
  const paths = new Set(packed.files.map(file => file.path));
  const tarball = resolve(packRoot, packed.filename);
  // Preseed the disposable consumer's dependency cache with local installed
  // bytes. The package itself is installed from the generated npm tarball.
  cpSync(resolve(repositoryRoot, 'node_modules'), resolve(consumerRoot, 'node_modules'), { recursive: true, dereference: true });
  // npm test exports npm_config_* settings from its parent lifecycle. Do not
  // let the engine's script policy become the disposable consumer's policy.
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^npm_config_/i.test(name)));
  const installed = execute('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--no-save', tarball], {
    cwd: consumerRoot, timeout: 120000, env: {
      ...cleanEnv,
      npm_config_cache: resolve(root, 'npm-cache'),
      npm_config_update_notifier: 'false',
    },
  });
  assert.equal(installed.status, 0, installed.stderr || installed.stdout);
  const packageRoot = resolve(consumerRoot, 'node_modules/@thebackstoryis/engineering-with-ai');
  assert.equal(realpathSync(packageRoot).startsWith(realpathSync(consumerRoot)), true);
  const bin = resolve(consumerRoot, 'node_modules/.bin/ewai');
  assert.equal(realpathSync(bin).startsWith(realpathSync(packageRoot)), true);
  const cli = (args, options = {}) => execute(process.execPath, [bin, ...args], { cwd: consumerRoot, ...options });
  const module = path => import(pathToFileURL(resolve(packageRoot, path)).href);
  return { root, packageRoot, projectRoot, paths, cli, module, existingBytes };
}

test('packed consumer starts off and recovers a controlled interrupted run', { timeout: 180000 }, async t => {
  const fixture = await packedConsumer(t);
  const { projectRoot, cli, module } = fixture;
  json(cli(['init', '--project', projectRoot, '--name', 'Packed autonomy consumer', '--specs', 'knowledge', '--json']));
  const locator = JSON.parse(readFileSync(resolve(projectRoot, '.ewai-pipeline/project.json')));
  assert.match(JSON.stringify(locator), /knowledge/);
  const initial = json(cli(['autonomy', 'status', '--project', projectRoot, '--json']));
  assert.equal(initial.mode, 'off'); assert.equal(initial.grant, null); assert.deepEqual(initial.runs, []);

  json(cli(['intent', 'create', 'alpha', '--domain', 'product', '--title', 'Packed consumer intent', '--project', projectRoot, '--json']));
  const { updateIntentDeliveryState } = await module('src/intents.mjs');
  updateIntentDeliveryState(projectRoot, resolve(projectRoot, 'knowledge/2.Purpose/intents/product/alpha.md'), { status: 'ready' });
  const proposal = json(cli(['autonomy', 'preview', '--project', projectRoot, '--intent', 'product/alpha',
    '--action', 'begin-harness', '--action', 'prepare-phase', '--provider', 'claude',
    '--expires-at', new Date(Date.now() + 3600000).toISOString(), '--max-runtime-ms', '60000',
    '--max-operation-ms', '10000', '--max-attempts', '2', '--record', '--json']));
  assert.equal(proposal.executable[0].intentId, 'product/alpha');
  const grant = json(cli(['autonomy', 'approve', '--project', projectRoot, '--expected-digest', proposal.digest,
    '--approved-by', 'Fixture owner', '--yes', '--json']));
  assert.deepEqual(grant.scope.intentIds, ['product/alpha']);
  git(projectRoot, 'init', '-b', 'fixture'); git(projectRoot, 'config', 'user.name', 'Fixture');
  git(projectRoot, 'config', 'user.email', 'fixture@example.invalid'); git(projectRoot, 'add', '-A'); git(projectRoot, 'commit', '-m', 'approved fixture');

  const completed = json(cli(['autonomy', 'run', '--project', projectRoot, '--expected-digest', grant.digest,
    '--provider', 'claude', '--yes', '--json']));
  assert.equal(completed.status, 'completed'); assert.equal(completed.counters.actions, 1);
  assert.equal(completed.counters.providerAttempts, 0);
  const alphaStatePath = resolve(projectRoot, 'knowledge/6.Build/alpha/delivery-state.json');
  const alphaState = readFileSync(alphaStatePath);
  const operationId = completed.lastResult.operationId;
  const { autonomyDigest, writeAutonomyRecord } = await module('src/runtime/autonomy-workspace.mjs');
  const { readAutonomyRun, controlAutonomyRun, answerAutonomyQuestion, startAutonomyService } = await module('src/runtime/autonomy-supervisor.mjs');
  const revisions = resolve(projectRoot, '.ewai-pipeline/runtime/autonomy/supervisor/runs', completed.id, 'revisions');
  const latest = readdirSync(revisions).sort((a, b) => Number(a.split('-')[0]) - Number(b.split('-')[0])).at(-1);
  const saved = JSON.parse(readFileSync(resolve(revisions, latest)));
  const deadPid = execute(process.execPath, ['-e', 'process.exit(0)']).pid;
  const { digest, ...body } = saved;
  const interrupted = { ...body, revision: saved.revision + 1, previousDigest: digest,
    updatedAt: new Date().toISOString(), status: 'running', executionStopped: false, lastResult: null,
    current: { action: 'begin-harness', intentId: 'product/alpha', phase: 'intent', operationId: completed.lastResult.operationId },
    owner: { ...saved.owner, pid: deadPid } };
  interrupted.digest = autonomyDigest(interrupted);
  writeAutonomyRecord(projectRoot, resolve(revisions, `${interrupted.revision}-${interrupted.digest.slice(7)}.json`), interrupted);
  assert.equal(readAutonomyRun(projectRoot, completed.id).status, 'recovery-required');
  const recovered = controlAutonomyRun(projectRoot, { runId: completed.id, action: 'recover', expectedRevision: interrupted.revision });
  assert.equal(recovered.status, 'completed'); assert.equal(recovered.counters.actions, 1);
  assert.equal(recovered.counters.providerAttempts, 0);
  assert.equal(recovered.lastResult.operationId, operationId);
  assert.deepEqual(readFileSync(alphaStatePath), alphaState, 'recovery must not replay the canonical effect');

  git(projectRoot, 'add', '-A'); git(projectRoot, 'commit', '-m', 'canonical harness receipt');
  const fakeBin = resolve(fixture.root, 'controlled-bin'); mkdirSync(fakeBin);
  const marker = resolve(fixture.root, 'provider-invocations');
  const fakeClaude = resolve(fakeBin, 'claude');
  writeFileSync(fakeClaude, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(marker)}\nif [ "$1" = "--version" ]; then printf 'fixture-unverified\\n'; exit 0; fi\nexit 88\n`);
  chmodSync(fakeClaude, 0o755);
  const oldPath = process.env.PATH;
  let service, humanService;
  try {
    process.env.PATH = `${fakeBin}${delimiter}${oldPath}`;
    service = startAutonomyService(projectRoot, { expectedDigest: grant.digest, provider: 'claude', confirmed: true });
    let current = service;
    const deadline = Date.now() + 20000;
    while (['starting', 'running'].includes(current.status) && Date.now() < deadline) {
      await new Promise(resolveWait => setTimeout(resolveWait, 40)); current = readAutonomyRun(projectRoot, service.id);
    }
    assert.equal(current.status, 'blocked');
    assert.equal(current.code, process.platform === 'darwin'
      ? 'phase-provider-version-unverified' : 'phase-provider-mode-unavailable');
    assert.equal(current.counters.providerAttempts, 0);
    if (process.platform === 'darwin') {
      assert.deepEqual(readFileSync(marker, 'utf8').trim().split('\n'), ['--version'], 'no provider work may start');
    } else {
      assert.equal(existsSync(marker), false, 'unsupported platforms must not invoke the provider');
    }

    json(cli(['intent', 'create', 'beta', '--domain', 'product', '--title', 'Human checkpoint fixture', '--project', projectRoot, '--json']));
    updateIntentDeliveryState(projectRoot, resolve(projectRoot, 'knowledge/2.Purpose/intents/product/beta.md'), { status: 'ready' });
    const { readAutonomyPolicy, previewAutonomy } = await module('src/autonomy.mjs');
    assert.deepEqual(readAutonomyPolicy(projectRoot).grant.scope.intentIds, ['product/alpha']);
    previewAutonomy(projectRoot, { proposal: { intentIds: ['product/beta'], actions: ['begin-harness'], providers: ['claude'],
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      limits: { maxConcurrentIntents: 1, maxRuntimeMs: 60000, maxOperationMs: 10000, maxAttempts: 2 } } });
    assert.deepEqual(readAutonomyPolicy(projectRoot).grant.scope.intentIds, ['product/alpha'],
      'previewing a new intent cannot enlarge the earlier approved pool');
    const second = json(cli(['autonomy', 'preview', '--project', projectRoot, '--intent', 'product/beta',
      '--action', 'begin-harness', '--provider', 'claude', '--expires-at', new Date(Date.now() + 3600000).toISOString(),
      '--max-runtime-ms', '60000', '--max-operation-ms', '10000', '--max-attempts', '2', '--record', '--json']));
    const humanGrant = json(cli(['autonomy', 'approve', '--project', projectRoot, '--expected-digest', second.digest,
      '--approved-by', 'Fixture owner', '--yes', '--json']));
    assert.deepEqual(humanGrant.scope.intentIds, ['product/beta']);
    git(projectRoot, 'add', '-A'); git(projectRoot, 'commit', '-m', 'second exact pool');
    humanService = startAutonomyService(projectRoot, { expectedDigest: humanGrant.digest, provider: 'claude', confirmed: true });
    current = humanService;
    const humanDeadline = Date.now() + 20000;
    while (['starting', 'running'].includes(current.status) && Date.now() < humanDeadline) {
      await new Promise(resolveWait => setTimeout(resolveWait, 40)); current = readAutonomyRun(projectRoot, humanService.id);
    }
    assert.equal(current.status, 'awaiting-human', current.code);
    assert.equal(current.counters.providerAttempts, 0);
    assert.ok(current.questions.length > 0);
    const authorityLock = resolve(projectRoot, '.ewai-pipeline/runtime/autonomy/authority.lock');
    const settledDeadline = Date.now() + 5000;
    while (existsSync(authorityLock) && Date.now() < settledDeadline) {
      await new Promise(resolveWait => setTimeout(resolveWait, 20));
    }
    assert.equal(existsSync(authorityLock), false, 'the service must release its local lock before an owner answers');
    const betaStatePath = resolve(projectRoot, 'knowledge/6.Build/beta/delivery-state.json');
    const betaState = readFileSync(betaStatePath);
    const question = current.questions[0];
    const answer = answerAutonomyQuestion(projectRoot, { runId: current.id, questionId: question.id,
      expectedRevision: current.revision, answeredBy: 'Fixture owner', answer: 'Review this separately; no gate is approved.' });
    assert.equal(answer.approvalRecorded, false);
    assert.deepEqual(readFileSync(betaStatePath), betaState, 'answering a question cannot mutate canonical gates');
    assert.equal(existsSync(resolve(projectRoot, 'knowledge/6.Build/beta/gates/build/build-approval.json')), false);
    assert.equal(existsSync(resolve(projectRoot, 'knowledge/6.Build/beta/gates/manual-qa/gate-ledger.json')), false);
    const status = json(cli(['autonomy', 'status', '--project', projectRoot, '--json']));
    assert.equal(JSON.stringify(status).includes('Review this separately'), false);
    assert.deepEqual(readFileSync(marker, 'utf8').trim().split('\n'), ['--version'], 'human pause cannot invoke the provider');
  } finally {
    process.env.PATH = oldPath;
    for (const started of [service, humanService].filter(Boolean)) {
      const current = readAutonomyRun(projectRoot, started.id);
      if (!['completed', 'cancelled', 'recovery-required', 'blocked', 'revoked', 'expired'].includes(current.status)) {
        try { controlAutonomyRun(projectRoot, { runId: started.id, action: 'cancel', expectedRevision: current.revision }); } catch {}
      }
    }
  }
  assert.equal(fixture.paths.has('skills-src/ewai-autonomy/SKILL.md'), true, 'the autonomous operator guidance must be packed');
});

test('package includes autonomy runtime, assets and public guidance but no private authority source', { timeout: 180000 }, async t => {
  const { paths, packageRoot, projectRoot, cli } = await packedConsumer(t);
  for (const path of ['public/autonomy.js', 'public/index.html', 'public/styles.css', 'src/autonomy.mjs',
    'src/autonomy-phase-contracts.mjs', 'src/autonomy-worker.mjs', 'src/runtime/autonomy-supervisor.mjs',
    'src/runtime/autonomy-operations.mjs', 'src/runtime/autonomy-workers.mjs', 'src/runtime/autonomy-workspace.mjs',
    'src/runtime/provider-adapters.mjs', 'Docs/autonomous-intent-delivery.md',
    'skills-src/ewai-autonomy/SKILL.md', 'skills-src/ewai-autonomy/agents/openai.yaml']) {
    assert.equal(paths.has(path), true, path);
    assert.equal(existsSync(resolve(packageRoot, path)), true, path);
  }
  for (const path of paths) {
    if (path !== 'tests/fixtures/context-benchmarks.json') {
      assert.doesNotMatch(path, /^(?:SPECS\/|tests\/|\.ewai-pipeline\/)|(?:\.env|\.npmrc|credential|private-key)/i);
    }
  }
  assert.doesNotMatch(readFileSync(resolve(packageRoot, 'public/autonomy.js'), 'utf8'), /test-only|fixture-provider|ANTHROPIC_API_KEY|projectRoot\s*:/i);
  json(cli(['init', '--project', projectRoot, '--name', 'Packed browser consumer', '--specs', 'knowledge', '--json']));
  json(cli(['intent', 'create', 'alpha', '--domain', 'product', '--title', 'Browser fixture', '--project', projectRoot, '--json']));
  const { updateIntentDeliveryState } = await import(pathToFileURL(resolve(packageRoot, 'src/intents.mjs')).href);
  updateIntentDeliveryState(projectRoot, resolve(projectRoot, 'knowledge/2.Purpose/intents/product/alpha.md'), { status: 'ready' });
  const { ensureDashboard, stopDashboard } = await import(pathToFileURL(resolve(packageRoot, 'src/runtime/dashboard.mjs')).href);
  const dashboard = await ensureDashboard(projectRoot);
  try {
    const status = await (await fetch(new URL('/api/autonomy', dashboard.url))).json();
    assert.equal(status.mode, 'off'); assert.equal(status.grant, null);
    const proposal = { intentIds: ['product/alpha'], actions: ['begin-harness'], providers: ['codex'],
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      limits: { maxConcurrentIntents: 1, maxRuntimeMs: 60000, maxOperationMs: 15000, maxAttempts: 2 } };
    const valid = await fetch(new URL('/api/autonomy/preview', dashboard.url), { method: 'POST',
      headers: { 'content-type': 'application/json', origin: dashboard.url },
      body: JSON.stringify({ proposal, record: false, confirmed: false }) });
    assert.equal(valid.status, 200, await valid.text());
    const response = await fetch(new URL('/api/autonomy/preview', dashboard.url), { method: 'POST',
      headers: { 'content-type': 'application/json', origin: dashboard.url },
      body: JSON.stringify({ projectRoot: '/tmp/another-project', proposal, record: false, confirmed: false }) });
    assert.equal(response.status, 400);
  } finally { await stopDashboard(projectRoot); }
});

test('installing packed engine on existing unconfigured work keeps autonomy off at check-in', { timeout: 180000 }, async t => {
  const { projectRoot, cli, module, existingBytes } = await packedConsumer(t, { existingProject: true });
  const before = json(cli(['autonomy', 'status', '--project', projectRoot, '--json']));
  assert.equal(before.mode, 'off'); assert.equal(before.grant, null); assert.deepEqual(before.runs, []);
  const { stopDashboard } = await module('src/runtime/dashboard.mjs');
  try {
    const checked = json(cli(['checkin', '--project', projectRoot, '--json'], { timeout: 120000 }));
    assert.equal(checked.project.root, projectRoot);
    const after = json(cli(['autonomy', 'status', '--project', projectRoot, '--json']));
    assert.equal(after.mode, 'off'); assert.equal(after.grant, null); assert.deepEqual(after.runs, []);
    assert.equal(existsSync(resolve(projectRoot, '.ewai-pipeline/runtime/autonomy/supervisor/runs')), false);
    for (const [path, bytes] of Object.entries(existingBytes)) {
      assert.deepEqual(readFileSync(resolve(projectRoot, path)), bytes, `check-in must preserve ${path}`);
    }
  } finally { await stopDashboard(projectRoot); }
});

test('packed worker stages a source-bound intent draft with host checks but no phase approval', { timeout: 180000 }, async t => {
  const { projectRoot, packageRoot, cli, module } = await packedConsumer(t);
  json(cli(['init', '--project', projectRoot, '--name', 'Packed phase worker consumer', '--specs', 'knowledge', '--json']));
  json(cli(['intent', 'create', 'alpha', '--domain', 'product', '--title', 'Source-backed draft', '--project', projectRoot, '--json']));
  const { updateIntentDeliveryState } = await module('src/intents.mjs');
  updateIntentDeliveryState(projectRoot, resolve(projectRoot, 'knowledge/2.Purpose/intents/product/alpha.md'), { status: 'ready' });
  const proposal = json(cli(['autonomy', 'preview', '--project', projectRoot, '--intent', 'product/alpha',
    '--action', 'begin-harness', '--action', 'prepare-phase', '--provider', 'claude',
    '--expires-at', new Date(Date.now() + 3600000).toISOString(), '--max-runtime-ms', '60000',
    '--max-operation-ms', '10000', '--max-attempts', '2', '--record', '--json']));
  const grant = json(cli(['autonomy', 'approve', '--project', projectRoot, '--expected-digest', proposal.digest,
    '--approved-by', 'Fixture owner', '--yes', '--json']));
  git(projectRoot, 'init', '-b', 'fixture'); git(projectRoot, 'config', 'user.name', 'Fixture');
  git(projectRoot, 'config', 'user.email', 'fixture@example.invalid'); git(projectRoot, 'add', '-A');
  git(projectRoot, 'commit', '-m', 'approved source-backed fixture');
  const started = json(cli(['autonomy', 'run', '--project', projectRoot, '--expected-digest', grant.digest,
    '--provider', 'claude', '--yes', '--json']));
  assert.equal(started.status, 'completed'); assert.equal(started.counters.providerAttempts, 0);
  const { finishActiveSession } = await module('src/runtime/work.mjs');
  finishActiveSession(projectRoot, 'product/alpha', { tool: 'claude', summary: 'Fixture harness started.' });

  // Substitute only the provider boundary in an import of the installed npm worker.
  // The fixture subprocess makes no network/model call or project write.
  const workerUrl = pathToFileURL(resolve(packageRoot, 'src/runtime/autonomy-workers.mjs'));
  const stub = `import { spawnSync } from 'node:child_process';
export async function invokeRestrictedPhaseProvider(_adapter, input) {
  const child = spawnSync(process.execPath, ['-e', 'const request=JSON.parse(process.argv[1]);process.stdout.write(JSON.stringify({schema:"ewai.autonomy-phase-proposal/v1",phase:request.contract.phase,contractDigest:request.contract.digest,artifacts:[{path:request.contract.paths[0],content:"# Intent summary: accepted intent, owner outcome unresolved.",sourceRefs:["accepted-intent"]}]}));', input.prompt], { encoding: 'utf8', timeout: 5000 });
  if (child.status !== 0) throw new Error('controlled fixture subprocess failed: ' + child.stderr);
  return { status: 'complete', exitCode: child.status, executionStopped: true, output: child.stdout };
}`;
  const stubUrl = 'data:text/javascript;base64,' + Buffer.from(stub).toString('base64');
  const source = readFileSync(workerUrl, 'utf8').replace(/from (['"])(\.[^'"]+)\1/g, (_match, _quote, specifier) =>
    `from ${JSON.stringify(specifier === './provider-adapters.mjs' ? stubUrl : new URL(specifier, workerUrl).href)}`);
  const api = await import('data:text/javascript;base64,' + Buffer.from(source + `\n// ${projectRoot}`).toString('base64'));
  const statePath = resolve(projectRoot, 'knowledge/6.Build/alpha/delivery-state.json');
  const before = readFileSync(statePath);
  const contract = api.prepareAutonomyPhase(projectRoot, 'product/alpha', 'intent');
  assert.equal(contract.status, 'prepared', JSON.stringify(contract));
  assert.equal(contract.context.fidelity.status, 'pass');
  assert.ok(contract.sources.some(source => source.id === 'accepted-intent'));
  const result = await api.invokePhaseProposal(contract, { provider: 'claude' });
  assert.equal(result.status, 'draft-ready', JSON.stringify(result));
  const accepted = api.acceptPhaseProposal(projectRoot, contract.operationId, result);
  assert.equal(accepted.status, 'draft-staged', JSON.stringify(accepted));
  assert.equal(accepted.phaseCompleted, false); assert.equal(accepted.requiresHuman, true);
  assert.equal(accepted.authority, 'none');
  assert.ok(accepted.checks.some(check => check.id === 'intent-dependency-map-check'
    && check.source === 'host-checker' && check.status === 'pass'));
  assert.ok(accepted.questions.some(question => question.code === 'phase-check-needs-human'));
  assert.match(readFileSync(resolve(projectRoot, accepted.proposalRoot, 'intent-summary.md'), 'utf8'), /accepted intent/);
  assert.deepEqual(readFileSync(statePath), before);
  assert.equal(existsSync(resolve(projectRoot, 'knowledge/6.Build/alpha/gates/intent/gate-ledger.json')), false);
});
