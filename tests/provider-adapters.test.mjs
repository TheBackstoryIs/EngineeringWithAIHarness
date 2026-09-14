import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  buildProviderInvocation,
  invokeProvider,
  measureProviderPrompt,
  normaliseProviderUsage,
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
