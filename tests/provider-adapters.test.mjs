import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
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
