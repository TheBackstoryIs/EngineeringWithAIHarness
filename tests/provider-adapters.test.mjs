import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  buildProviderInvocation,
  invokeProvider,
  measureProviderPrompt,
  normaliseProviderUsage,
  preparePhaseProvider,
  verifyPhaseProviderConformance,
  invokeRestrictedPhaseProvider,
} from '../src/runtime/provider-adapters.mjs';

test('builds bounded non-interactive CLI invocations for every AFK provider', () => {
  const task = { allowed_commands: ['npm test -- example'] };
  const codex = buildProviderInvocation('codex', { cwd: '.', prompt: 'work', task });
  assert.deepEqual(codex.args.slice(0, 5), ['--ask-for-approval', 'never', 'exec', '--json', '--color']);
  assert.equal(codex.args.includes('workspace-write'), true);
  assert.equal(codex.args.includes('never'), true);
  assert.deepEqual(codex.promptMeasurement, measureProviderPrompt('work'));

  const claude = buildProviderInvocation('claude', { cwd: '.', prompt: 'work', task });
  assert.equal(claude.args.includes('dontAsk'), true);
  assert.match(claude.args.at(claude.args.indexOf('--allowedTools') + 1), /Bash\(npm test -- example\)/);

  const antigravity = buildProviderInvocation('antigravity', { cwd: '.', prompt: 'work', task });
  assert.equal(antigravity.command, 'agy');
  assert.equal(antigravity.args.includes('--sandbox'), true);
  assert.deepEqual(
    antigravity.args.slice(0, 7),
    ['--print', 'work', '--output-format', 'stream-json', '--mode', 'accept-edits', '--sandbox'],
  );
  assert.equal(antigravity.args.includes('--dangerously-skip-permissions'), true);
  assert.equal(antigravity.args.includes('yolo'), false);

  const antigravityReview = buildProviderInvocation('antigravity', {
    cwd: '.', prompt: 'review', task, mode: 'review',
  });
  assert.equal(antigravityReview.args.includes('--dangerously-skip-permissions'), false);
  assert.equal(antigravityReview.args.includes('plan'), true);

  const review = buildProviderInvocation('codex', { cwd: '.', prompt: 'review', task, mode: 'review' });
  assert.equal(review.args.includes('read-only'), true);
  assert.equal(review.args.includes('--json'), false);
});

test('keeps labelled estimates distinct from strict optional provider usage', () => {
  assert.deepEqual(measureProviderPrompt('three bytes'), {
    bytes: 11,
    estimatedTokens: 4,
    estimateMethod: 'utf8-bytes-div-3-v1',
  });
  assert.deepEqual(normaliseProviderUsage('codex', {
    input_tokens: 120,
    cached_input_tokens: 40,
    output_tokens: 25,
  }), {
    schema: 'ewai.provider-usage/v1',
    provider: 'codex',
    inputTokens: 120,
    cachedInputTokens: 40,
    outputTokens: 25,
    source: 'provider-reported',
  });
  assert.equal(normaliseProviderUsage('claude', { input_tokens: -1, output_tokens: '12' }), null);
  assert.equal(normaliseProviderUsage('codex', {}), null);
});

test('unknown and proposal modes cannot silently select AFK implementation permissions', () => {
  for (const provider of ['codex', 'claude', 'antigravity']) {
    for (const mode of ['phase-proposal', 'prepare-phase', 'Review', '', null, {}, false]) {
      assert.throws(() => buildProviderInvocation(provider, { cwd: '.', prompt: 'untrusted', mode }),
        error => error.code === 'phase-provider-mode-unavailable');
    }
  }
});

test('direct AFK invocation rejects unknown modes before opening logs or spawning', t => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-provider-mode-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const mode of ['phase-proposal', 'prepare-phase', '', null, false, {}]) {
    assert.throws(() => invokeProvider({ mode, command: process.execPath, args: [], cwd: root,
      prompt: '', logPath: resolve(root, 'never-opened', 'raw.log'), timeoutMs: 100 }),
    error => error.code === 'phase-provider-mode-unavailable');
  }
  assert.equal(existsSync(resolve(root, 'never-opened')), false);
});

test('unverified provider modes and copied capability objects cannot invoke phase work (PTS-016)', async () => {
  for (const provider of ['codex', 'antigravity', 'unknown', '', null, {}]) {
    assert.equal(preparePhaseProvider(provider).status, 'unavailable');
  }
  const forged = { status: 'verified', provider: 'claude', command: process.execPath, args: ['-e', 'throw Error("unsafe")'] };
  assert.equal((await verifyPhaseProviderConformance(forged)).status, 'unavailable');
  assert.equal((await invokeRestrictedPhaseProvider(forged, { prompt: 'Draft', timeoutMs: 1000 })).status, 'unavailable');
  for (const input of [null, [], false, 'Draft', 1, {}]) {
    assert.equal((await invokeRestrictedPhaseProvider(forged, input)).code, 'phase-provider-input-invalid');
  }
});

test('installed phase mode proves write prevention, no inherited tools, bounded output and real timeout (PTS-014 / PTS-016 / PTS-017)', async t => {
  const capability = preparePhaseProvider('claude');
  if (capability.status === 'unavailable') {
    assert.equal(capability.requiresHuman, true);
    t.skip(`Restriction conformance unavailable on this host: ${capability.code}; no mode was enabled.`);
    return;
  }
  assert.equal(capability.status, 'requires-conformance');
  assert.equal((await invokeRestrictedPhaseProvider(capability, { prompt: 'Draft', timeoutMs: 1000 })).status, 'unavailable');
  const proof = await verifyPhaseProviderConformance(capability);
  assert.equal(proof.status, 'verified');
  assert.equal(proof.canonicalWritePrevented, true);
  assert.equal(proof.outputBoundEnforced, true);
  assert.equal(proof.timeoutEnforced, true);
  assert.equal(proof.networkIsolated, true);
  assert.equal(proof.childProcessPrevented, true);
  assert.equal(proof.toolsExposed, 0);
  assert.equal(proof.inheritedCapabilitiesBlocked, true);
  assert.equal(proof.forgedToolRefused, true);
  assert.equal(proof.fixtureServiceOnly, true);
  assert.equal(JSON.stringify(proof).includes('EWAI_UNTRUSTED_INSTRUCTIONS_CANARY'), false);
  assert.equal(JSON.stringify(proof).includes('ewai-fixture-not-a-real-key'), false);
  for (const timeoutMs of [0, -1, 600001, 1.5, '1000']) {
    assert.equal((await invokeRestrictedPhaseProvider(capability, { prompt: 'Draft', timeoutMs })).code, 'phase-provider-input-invalid');
  }
  assert.equal((await invokeRestrictedPhaseProvider({ ...capability }, { prompt: 'Draft', timeoutMs: 1000 })).status, 'unavailable');
  t.diagnostic(JSON.stringify(proof));
});

test('terminates a provider that exceeds its bounded task timeout', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-provider-timeout-'));
  try {
    const result = await invokeProvider({
      provider: 'codex', command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 10000)'], prompt: '', cwd: root,
      timeoutMs: 25, logPath: resolve(root, 'provider.log'),
    });
    assert.equal(result.timedOut, true);
    assert.notEqual(result.exitCode, 0);
    assert.deepEqual(result.promptMeasurement, measureProviderPrompt(''));
    assert.equal(result.providerUsage, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const seatbeltAvailable = process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec');
const seatbeltOnly = { skip: !seatbeltAvailable && 'The production restriction primitive requires macOS Seatbelt.' };

async function privateTransport({ root = null, uncertainProbe = false, signalsDenied = false, onReady = null } = {}) {
  const url = new URL('../src/runtime/provider-adapters.mjs', import.meta.url);
  // Test-only exposure of the shipped internal process path; no executable
  // override, fixture flag or process-control callback is added to public APIs.
  let source = readFileSync(url, 'utf8').replace(/from (['"])(\.[^'"]+)\1/g,
    (_match, _quote, specifier) => `from ${JSON.stringify(new URL(specifier, url).href)}`);
  if (root) source = source.replace("import { release, tmpdir } from 'node:os';",
    `import { release } from 'node:os'; const tmpdir = () => ${JSON.stringify(root)};`);
  if (uncertainProbe || signalsDenied) source = `const process = Object.create(globalThis.process); process.kill = (pid, signal) => {
    if (${signalsDenied} || signal === 0) throw Object.assign(new Error('probe unavailable'), {code:'EPERM'});
    return globalThis.process.kill(pid, signal);
  };\n` + source;
  // Observe only children launched by this module. The fixture announces
  // readiness after installing its handler; no timing guess or PID search.
  source = source.replace("import { spawn, spawnSync } from 'node:child_process';",
    `import { spawn as nativeSpawn, spawnSync } from 'node:child_process';
    const owned = []; let readyObserver;
    const observeReady = observer => { readyObserver = observer; };
    const spawn = (...args) => { const child = nativeSpawn(...args); owned.push(child);
      child.stdout?.on('data', chunk => { if (chunk.toString().includes('FIXTURE_READY')) readyObserver?.(child); });
      return child; };`);
  const api = await import('data:text/javascript;base64,' + Buffer.from(source + `\nexport { captureRestrictedProcess, owned, observeReady };\n// ${Math.random()}`).toString('base64'));
  api.observeReady(onReady); return api;
}
async function privateCapture(options) { return (await privateTransport(options)).captureRestrictedProcess; }

test('restricted cancellation before dispatch prevents spawning and never discloses its reason (PTS-021)', async () => {
  const capture = await privateCapture(), controller = new AbortController();
  controller.abort('private-cancellation-reason');
  const result = await capture({ sandbox: '/usr/bin/sandbox-exec', executable: process.execPath },
    { prompt: '', timeoutMs: 3000, maxBytes: 1024, signal: controller.signal },
    { command: process.execPath, args: ['-e', 'process.stdout.write("should-not-run")'] });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.executionStopped, true); assert.equal(result.spawned, false);
  assert.equal(result.output, ''); assert.equal(JSON.stringify(result).includes('private-cancellation-reason'), false);
});

test('restricted active cancellation terminates a TERM-resistant process and confirms stop (PTS-021)', seatbeltOnly, async () => {
  const controller = new AbortController();
  const capture = await privateCapture({ onReady: () => controller.abort('private-cancellation-reason') });
  const pending = capture({ sandbox: '/usr/bin/sandbox-exec', executable: process.execPath },
    { prompt: '', timeoutMs: 5000, maxBytes: 1024, signal: controller.signal },
    { command: process.execPath, args: ['-e', 'process.on("SIGTERM",()=>{});process.stdout.write("FIXTURE_READY");setInterval(()=>{},1000)'] });
  const result = await pending;
  assert.equal(result.status, 'cancelled'); assert.equal(result.executionStopped, true);
  assert.equal(result.signal, 'SIGKILL'); assert.equal(result.output, '');
  assert.equal(JSON.stringify(result).includes('private-cancellation-reason'), false);
});

test('uncertain process-group verification is not a confirmed cancellation and preserves scratch', seatbeltOnly, async t => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-cancel-uncertain-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const capture = await privateCapture({ root, uncertainProbe: true }), controller = new AbortController();
  const pending = capture({ sandbox: '/usr/bin/sandbox-exec', executable: process.execPath },
    { prompt: '', timeoutMs: 5000, maxBytes: 1024, signal: controller.signal },
    { command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] });
  const timer = setTimeout(() => controller.abort(), 250);
  let result; try { result = await pending; } finally { clearTimeout(timer); }
  assert.equal(result.status, 'unknown'); assert.equal(result.executionStopped, false);
  assert.equal(result.output, ''); assert.equal(readdirSync(root).length, 1, 'uncertain scratch must be retained');
});

test('late cancellation cannot rewrite an already settled provider result', seatbeltOnly, async () => {
  const capture = await privateCapture(), controller = new AbortController();
  const result = await capture({ sandbox: '/usr/bin/sandbox-exec', executable: process.execPath },
    { prompt: '', timeoutMs: 3000, maxBytes: 1024, signal: controller.signal },
    { command: process.execPath, args: ['-e', 'process.stdout.write("settled")'] });
  assert.equal(result.status, 'complete'); assert.equal(result.executionStopped, true);
  controller.abort(); assert.equal(result.status, 'complete'); assert.equal(result.output, 'settled');
});

for (const restricted of [true, false]) test(`${restricted ? 'restricted' : 'AFK'} failed termination returns unknown within its deadline and retains its owned child`,
  restricted ? seatbeltOnly : { skip: process.platform === 'win32' && 'POSIX signal fault fixture.' }, async t => {
    const root = mkdtempSync(resolve(tmpdir(), 'ewai-cancel-denied-')), controller = new AbortController();
    const api = await privateTransport({ root, signalsDenied: true, onReady: () => controller.abort() });
    t.after(async () => {
      for (const child of api.owned) {
        const closed = new Promise(done => child.once('close', done));
        try { process.kill(-child.pid, 'SIGKILL'); await closed; } catch {}
      }
      rmSync(root, { recursive: true, force: true });
    });
    const args = ['-e', 'process.on("SIGTERM",()=>{});process.stdout.write("FIXTURE_READY");setInterval(()=>{},1000)'];
    const started = performance.now();
    const result = restricted ? await api.captureRestrictedProcess({ sandbox: '/usr/bin/sandbox-exec', executable: process.execPath },
      { prompt: '', timeoutMs: 5000, maxBytes: 1024, signal: controller.signal }, { command: process.execPath, args })
      : await api.invokeProvider({ provider: 'codex', command: process.execPath, args, cwd: root, prompt: '', timeoutMs: 5000,
        logPath: resolve(root, 'provider.log') }, { signal: controller.signal });
    assert.equal(controller.signal.aborted, true, 'fixture became ready before cancellation');
    assert.equal(result.status, 'unknown'); assert.equal(result.executionStopped, false); assert.equal(result.output, '');
    assert.ok(performance.now() - started < 4000, 'does not wait for an impossible close event');
    assert.equal(api.owned.length, 1); assert.doesNotThrow(() => process.kill(api.owned[0].pid, 0), 'owned fixture is still alive');
    if (restricted) assert.equal(readdirSync(root).length, 1, 'uncertain scratch is retained');
  });

test('AFK pre-cancellation prevents logging and spawning', async t => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-afk-pre-cancel-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const controller = new AbortController(); controller.abort('private');
  const result = await invokeProvider({ provider: 'codex', command: process.execPath, args: [], cwd: root,
    prompt: '', timeoutMs: 100, logPath: resolve(root, 'never.log') }, { signal: controller.signal });
  assert.equal(result.cancelled, true); assert.equal(result.executionStopped, true); assert.deepEqual(readdirSync(root), []);
});

test('restriction verification accepts only bounded host cancellation controls', async () => {
  for (const control of [null, [], { signal: {} }, { timeoutMs: 99 }, { timeoutMs: 600001 }, { timeoutMs: '100' }, { command: 'unsafe' }]) {
    assert.equal((await verifyPhaseProviderConformance({}, control)).code, 'phase-provider-input-invalid');
  }
  const controller = new AbortController(); controller.abort('private-reason');
  const result = await verifyPhaseProviderConformance({}, { signal: controller.signal, timeoutMs: 100 });
  assert.equal(result.code, 'phase-cancelled'); assert.equal(result.executionStopped, true);
  assert.equal(JSON.stringify(result).includes('private-reason'), false);
});
