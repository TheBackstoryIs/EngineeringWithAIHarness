import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { initProject } from '../src/project.mjs';
import { createIntent, updateIntentDeliveryState } from '../src/intents.mjs';
import { ensureDashboard, stopDashboard } from '../src/runtime/dashboard.mjs';
import { readAutonomyPolicy, previewAutonomy } from '../src/autonomy.mjs';

const cli = resolve(import.meta.dirname, '../bin/ewai');
const intentId = 'product/alpha';
function git(root, ...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function commit(root) { git(root, 'add', '-A'); git(root, 'commit', '--allow-empty', '-m', 'fixture state'); }
function fixture(t) {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'ewai-autonomy-interface-')));
  initProject(root, { name: 'Interface consumer', specsRoot: 'knowledge' });
  const intent = createIntent(root, { domain: 'product', slug: 'alpha' });
  updateIntentDeliveryState(root, intent.path, { status: 'ready' });
  git(root, 'init', '-b', 'fixture'); git(root, 'config', 'user.name', 'Fixture'); git(root, 'config', 'user.email', 'fixture@example.invalid'); commit(root);
  t.after(async () => { await stopDashboard(root); rmSync(root, { recursive: true, force: true }); });
  return root;
}
function scope() {
  return { intentIds: [intentId], actions: ['begin-harness'], providers: ['codex'],
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    limits: { maxConcurrentIntents: 1, maxRuntimeMs: 60000, maxOperationMs: 15000, maxAttempts: 2 } };
}
async function http(url, action, input = {}, overrides = {}) {
  const path = action === 'status' ? `/api/autonomy${input.runId ? `?runId=${encodeURIComponent(input.runId)}` : ''}` : `/api/autonomy/${action}`;
  const result = await fetch(url + path, { method: action === 'status' ? 'GET' : 'POST',
    ...(action === 'status' ? {} : { headers: { origin: url, 'content-type': 'application/json' }, body: JSON.stringify(input) }), ...overrides });
  return { status: result.status, body: await result.json() };
}

test('HTTP cannot approve a stale or browser-rooted delegation', async t => {
  const root = fixture(t), { url } = await ensureDashboard(root);
  const preview = await http(url, 'preview', { proposal: scope(), record: true, confirmed: true });
  assert.equal(preview.status, 200, 'a real preview route must support a valid delegation proposal');
  assert.equal(readAutonomyPolicy(root).mode, 'off');
  const approval = { expectedDigest: preview.body.digest, approvedBy: 'Fixture owner', confirmed: true };
  const foreign = await http(url, 'approve', { ...approval, projectRoot: '/private/another-project' });
  assert.equal(foreign.status, 400); assert.equal(foreign.body.code, 'autonomy-invalid-input');
  assert.equal(readAutonomyPolicy(root).mode, 'off');
  writeFileSync(resolve(root, 'knowledge/pipeline.yaml'), readFileSync(resolve(root, 'knowledge/pipeline.yaml'), 'utf8') + '\n# Owner changed configuration\n');
  const stale = await http(url, 'approve', approval);
  assert.equal(stale.status, 409); assert.equal(stale.body.code, 'autonomy-preview-stale');
  assert.equal(readAutonomyPolicy(root).grant, null);
  const fresh = await http(url, 'preview', { proposal: scope(), record: true, confirmed: true });
  const accepted = await http(url, 'approve', { ...approval, expectedDigest: fresh.body.digest });
  assert.equal(accepted.status, 200); assert.deepEqual(accepted.body.scope.intentIds, [intentId]);
  assert.equal(readAutonomyPolicy(root).grant.digest, accepted.body.digest);
});

test('http mutations preserve the strict local boundary (PTS-023)', async t => {
  const root = fixture(t), { url } = await ensureDashboard(root);
  const input = { proposal: scope(), record: true, confirmed: true };
  for (const [headers, status] of [[{ 'content-type': 'application/json' }, 403],
    [{ 'content-type': 'application/json', origin: 'https://foreign.invalid' }, 403],
    [{ 'content-type': 'text/plain', origin: url }, 415]]) {
    assert.equal((await http(url, 'preview', input, { headers })).status, status);
  }
  assert.equal((await http(url, 'preview', input, { method: 'PUT' })).status, 405);
  assert.equal((await http(url, 'preview', input, { body: 'PRIVATE_INVALID_JSON' })).status, 400);
  assert.equal((await http(url, 'preview', input, { body: JSON.stringify({ canary: 'x'.repeat(1024 * 1024) }) })).status, 413);
  for (const extra of [{ root }, { executable: '/bin/sh' }, { credential: 'PRIVATE_CREDENTIAL_CANARY' }, { confirmed: 'yes' }, { record: 'true' }]) {
    const denied = await http(url, 'preview', { ...input, ...extra });
    assert.equal(denied.status, 400); assert.doesNotMatch(JSON.stringify(denied.body), /PRIVATE_CREDENTIAL_CANARY|\/bin\/sh/);
  }
  const query = await fetch(`${url}/api/autonomy?projectRoot=PRIVATE_ROOT_CANARY`);
  assert.equal(query.status, 400); assert.doesNotMatch(await query.text(), /PRIVATE_ROOT_CANARY/);
  for (const host of ['foreign.invalid', '127.0.0.1:1', 'localhost:1']) {
  const invalidHost = await new Promise((done, reject) => {
    const destination = new URL(url);
    const req = request({ hostname: destination.hostname, port: destination.port, path: '/api/autonomy',
      headers: { host } }, response => { response.resume(); response.on('end', () => done(response.statusCode)); });
    req.on('error', reject); req.end();
  });
  assert.equal(invalidHost, 403); assert.equal(readAutonomyPolicy(root).grant, null);
  }
});

async function transport(t, kind, root) {
  if (kind === 'http') { const { url } = await ensureDashboard(root); return async (action, input = {}) => http(url, action, input); }
  if (kind === 'mcp') {
    const client = new Client({ name: 'autonomy-interface-fixture', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp', '--project', root], cwd: root, stderr: 'pipe' }));
    t.after(() => client.close());
    return async (action, input = {}) => {
      const result = await client.callTool({ name: `ewai_autonomy_${action}`, arguments: input });
      return { status: result.isError ? result.structuredContent?.statusCode ?? 400 : 200,
        body: result.structuredContent ?? JSON.parse(result.content[0].text) };
    };
  }
  return async (action, input = {}) => {
    const args = ['autonomy', action, '--project', root, '--json'];
    if (action === 'answer') {
      const { confirmed, ...body } = input;
      const path = '.ewai-pipeline/fixture-answer.json'; writeFileSync(resolve(root, path), JSON.stringify(body));
      args.push('--input', path);
      input = { confirmed };
    }
    if (input.proposal) {
      const p = input.proposal;
      for (const [flag, values] of [['--intent', p.intentIds], ['--action', p.actions], ['--provider', p.providers]]) for (const value of values) args.push(flag, value);
      args.push('--expires-at', p.expiresAt, '--max-runtime-ms', String(p.limits.maxRuntimeMs), '--max-operation-ms', String(p.limits.maxOperationMs), '--max-attempts', String(p.limits.maxAttempts));
    }
    for (const [key, flag] of [['expectedDigest', '--expected-digest'], ['approvedBy', '--approved-by'], ['revokedBy', '--revoked-by'],
      ['provider', '--provider'], ['runId', '--run'], ['expectedRevision', '--expected-revision'], ['action', '--action']]) {
      if (input[key] !== undefined) args.push(flag, String(input[key]));
    }
    if (input.record) args.push('--record'); if (input.confirmed) args.push('--yes');
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
    const body = JSON.parse(result.status === 0 ? result.stdout : result.stderr.trim().split('\n').at(-1));
    return { status: result.status === 0 ? 200 : body.statusCode, body };
  };
}

for (const kind of ['cli', 'mcp', 'http']) test(`cli, mcp and http return equivalent domain outcomes: ${kind} (PTS-022)`, async t => {
  const root = fixture(t), call = await transport(t, kind, root);
  const status = await call('status'); assert.equal(status.status, 200); assert.equal(status.body.mode, 'off'); assert.deepEqual(status.body.runs, []);
  const proposal = scope(), expectedPreview = previewAutonomy(root, { proposal });
  const preview = await call('preview', { proposal, record: true, confirmed: true });
  assert.equal(preview.status, 200); assert.deepEqual(preview.body, expectedPreview);
  const approval = { expectedDigest: preview.body.digest, approvedBy: 'Fixture owner', confirmed: true };
  const unconfirmed = await call('approve', { ...approval, confirmed: false });
  assert.equal(unconfirmed.body.code, 'autonomy-confirmation-required'); assert.equal(readAutonomyPolicy(root).grant, null);
  const approved = await call('approve', approval); assert.equal(approved.status, 200);
  assert.deepEqual(approved.body, readAutonomyPolicy(root).grant); commit(root);
  const start = { expectedDigest: approved.body.digest, provider: 'codex', confirmed: true };
  const executed = await call('run', start); assert.equal(executed.status, 200); assert.equal(executed.body.status, 'completed', executed.body.code);
  assert.equal(executed.body.lastResult.status, 'harness-started'); assert.equal(executed.body.counters.providerAttempts, 0);
  assert.equal(executed.body.phaseCompleted, false);
  const singleRun = await call('status', { runId: executed.body.id });
  assert.equal(singleRun.status, 200); assert.equal(singleRun.body.id, executed.body.id); assert.equal(singleRun.body.status, 'completed');
  commit(root);
  const service = await call('service', start); assert.equal(service.status, 200);
  let state, deadline = Date.now() + 20000;
  do {
    await new Promise(done => setTimeout(done, 50));
    const poll = await call('status');
    assert.equal(poll.status, 200, poll.body.code);
    state = poll.body.runs.find(run => run.id === service.body.id);
  } while ((!state || state.lifetime.ownerProcessAlive) && Date.now() < deadline);
  assert.equal(state.status, 'awaiting-human', state.code); assert.equal(state.executionStopped, true);
  const answered = await call('answer', { runId: state.id, questionId: state.questions[0].id,
    expectedRevision: state.revision, answeredBy: 'Fixture owner', answer: 'PRIVATE_ANSWER_CANARY', confirmed: true });
  assert.equal(answered.status, 200); assert.equal(answered.body.approvalRecorded, false); assert.equal(answered.body.authority, 'none');
  assert.doesNotMatch(JSON.stringify((await call('status')).body), /PRIVATE_ANSWER_CANARY/);
  const control = (action, revision) => call(kind === 'cli' ? action : 'control', { runId: state.id,
    ...(kind === 'cli' ? {} : { action }), expectedRevision: revision, confirmed: true });
  const paused = await control('pause', state.revision);
  assert.equal(paused.body.status, 'paused');
  const stale = await call('control', { runId: state.id, action: 'cancel', expectedRevision: state.revision, confirmed: true });
  assert.equal(stale.body.code, 'autonomy-run-stale');
  const resume = await control('resume', paused.body.revision);
  assert.equal(resume.body.code, 'autonomy-canonical-decision-required');
  const cancelled = await control('cancel', paused.body.revision);
  assert.equal(cancelled.body.status, 'cancelled'); assert.equal(cancelled.body.cancellation.status, 'confirmed');
  const revoked = await call('revoke', { expectedDigest: approved.body.digest, revokedBy: 'Fixture owner', confirmed: true });
  assert.equal(revoked.status, 200); assert.equal((await call('status')).body.mode, 'off');
  assert.equal((await call('run', start)).body.code, 'autonomy-grant-revoked');
  const delivery = JSON.parse(readFileSync(resolve(root, 'knowledge/6.Build/alpha/delivery-state.json')));
  assert.equal(delivery.currentPhase, 'intent'); assert.equal(delivery.approvals?.build ?? null, null);
});

test('MCP discovery explains required fields, types, bounds and the closed proposal without stripping unknown inputs', async t => {
  const root = fixture(t), client = new Client({ name: 'autonomy-discovery-fixture', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp', '--project', root], cwd: root, stderr: 'pipe' }));
  t.after(() => client.close());
  const tools = (await client.listTools()).tools.filter(tool => tool.name.startsWith('ewai_autonomy_'));
  assert.equal(tools.length, 8);
  for (const tool of tools) {
    assert.match(tool.description, /Required fields:/);
    assert.match(tool.description, /Unknown fields are rejected/);
    assert.deepEqual(tool.inputSchema.additionalProperties, {}, 'SDK must preserve unexpected fields for shared safe rejection');
    for (const field of Object.values(tool.inputSchema.properties)) assert.ok(field.description?.length > 20);
  }
  const proposal = tools.find(tool => tool.name === 'ewai_autonomy_preview').inputSchema.properties.proposal.description;
  for (const field of ['intentIds', 'actions', 'providers', 'expiresAt', 'limits', 'maxConcurrentIntents', 'maxRuntimeMs', 'maxOperationMs', 'maxAttempts']) assert.ok(proposal.includes(field));
  assert.match(proposal, /86400000/); assert.match(proposal, /100/);
  const control = tools.find(tool => tool.name === 'ewai_autonomy_control');
  assert.match(control.description, /runId, action, expectedRevision, confirmed/);
  assert.match(control.inputSchema.properties.action.description, /pause.*resume.*cancel.*revoke.*recover/);
  assert.match(control.inputSchema.properties.expectedRevision.description, /positive.*integer/);
});

test('MCP preserves unknown fields for rejection and validates all values before granting authority', async t => {
  const root = fixture(t), call = await transport(t, 'mcp', root);
  const preview = await call('preview', { proposal: scope(), record: true, confirmed: true });
  const valid = { expectedDigest: preview.body.digest, approvedBy: 'Fixture owner', confirmed: true };
  for (const extra of [{ projectRoot: '/private/OTHER_PROJECT_CANARY' }, { executable: '/bin/PRIVATE_EXECUTABLE' },
    { credential: 'PRIVATE_CREDENTIAL_CANARY' }, { confirmed: 'yes' }, { approvedBy: 42 }, { expectedDigest: [] }]) {
    const denied = await call('approve', { ...valid, ...extra });
    assert.equal(denied.body.code, 'autonomy-invalid-input'); assert.equal(denied.status, 400);
    assert.doesNotMatch(JSON.stringify(denied.body), /PRIVATE_|OTHER_PROJECT_CANARY/); assert.equal(readAutonomyPolicy(root).grant, null);
  }
  for (const input of [{ runId: '../escape', action: 'cancel', expectedRevision: 1, confirmed: true },
    { runId: '11111111-2222-4333-8444-555555555555', action: 'cancel', expectedRevision: '1', confirmed: true }]) {
    assert.equal((await call('control', input)).body.code, 'autonomy-invalid-input');
  }
});

test('CLI rejects ambiguous, injected and unconfirmed controls without echoing input', t => {
  const root = fixture(t);
  for (const args of [
    ['status', '--credential', 'PRIVATE_CLI_CANARY'],
    ['run', '--provider', 'codex', '--provider', 'claude', '--yes'],
    ['status', '--project', '/private/PRIVATE_ROOT_CANARY'],
    ['control', '--action', 'cancel', '--run', '../PRIVATE_PATH_CANARY', '--expected-revision', '1', '--yes'],
  ]) {
    const result = spawnSync(process.execPath, [cli, 'autonomy', ...args, '--project', root, '--json'], { encoding: 'utf8', cwd: root });
    assert.notEqual(result.status, 0); const body = JSON.parse(result.stderr.trim().split('\n').at(-1));
    assert.equal(body.code, 'autonomy-invalid-input'); assert.doesNotMatch(JSON.stringify(body), /PRIVATE_/);
    assert.equal(readAutonomyPolicy(root).grant, null);
  }
});

for (const kind of ['cli', 'mcp', 'http']) test(`malformed stored run is a safe coded ${kind} error, never a source disclosure`, async t => {
  const root = fixture(t), call = await transport(t, kind, root);
  const directory = resolve(root, '.ewai-pipeline/runtime/autonomy/supervisor/runs/11111111-2222-4333-8444-555555555555/revisions');
  mkdirSync(directory, { recursive: true }); writeFileSync(resolve(directory, 'invalid.json'), 'PRIVATE_RECORD_CANARY');
  const denied = await call('status'); assert.equal(denied.body.code, 'autonomy-run-evidence-invalid');
  assert.equal(denied.status, 409); assert.doesNotMatch(JSON.stringify(denied.body), /PRIVATE_RECORD_CANARY|ewai-autonomy-interface-/);
});
