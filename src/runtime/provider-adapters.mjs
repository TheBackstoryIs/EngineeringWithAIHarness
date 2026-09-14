import { accessSync, constants, createWriteStream, mkdirSync } from 'node:fs';
import { delimiter, isAbsolute, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { CONTEXT_ESTIMATE_METHOD, estimateContextTokens } from './context-assembly.mjs';

export const AFK_PROVIDERS = Object.freeze(['codex', 'claude', 'antigravity']);

export function measureProviderPrompt(prompt) {
  const measurement = estimateContextTokens(prompt);
  return {
    bytes: measurement.bytes,
    estimatedTokens: measurement.estimatedTokens,
    estimateMethod: CONTEXT_ESTIMATE_METHOD,
  };
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function normaliseProviderUsage(provider, usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const inputTokens = nonNegativeInteger(usage.inputTokens ?? usage.input_tokens);
  const cachedInputTokens = nonNegativeInteger(
    usage.cachedInputTokens ?? usage.cached_input_tokens ?? usage.cache_read_input_tokens,
  );
  const outputTokens = nonNegativeInteger(usage.outputTokens ?? usage.output_tokens);
  if (inputTokens === null || outputTokens === null) return null;
  return {
    schema: 'ewai.provider-usage/v1',
    provider: String(provider ?? ''),
    inputTokens,
    cachedInputTokens: cachedInputTokens ?? 0,
    outputTokens,
    source: 'provider-reported',
  };
}

export function providerCommand(provider) {
  return provider === 'antigravity' ? 'agy' : provider;
}

export function commandAvailable(command, env = process.env) {
  const candidates = isAbsolute(command)
    ? [command]
    : String(env.PATH ?? '').split(delimiter).filter(Boolean).map((entry) => resolve(entry, command));
  return candidates.some((candidate) => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function claudeTools(task, mode) {
  if (mode === 'review') return ['Read', 'Glob', 'Grep'];
  const commands = (task?.allowed_commands ?? []).map((command) => `Bash(${command})`);
  return ['Read', 'Edit', 'Write', 'Glob', 'Grep', ...commands];
}

export function buildProviderInvocation(provider, input = {}) {
  if (!AFK_PROVIDERS.includes(provider)) throw new Error(`Unsupported AFK provider: ${provider}`);
  const mode = input.mode === 'review' ? 'review' : 'implementation';
  const cwd = resolve(input.cwd);
  const model = String(input.model ?? '').trim();
  const invocation = {
    provider,
    command: providerCommand(provider),
    cwd,
    prompt: String(input.prompt ?? ''),
    timeoutMs: Number(input.timeoutMs ?? 45 * 60 * 1000),
    mode,
    task: input.task ?? null,
    promptMeasurement: measureProviderPrompt(input.prompt ?? ''),
    providerUsage: normaliseProviderUsage(provider, input.providerUsage),
    args: [],
  };

  if (provider === 'codex') {
    invocation.args = ['--ask-for-approval', 'never', 'exec', '--color', 'never', '--sandbox', mode === 'review' ? 'read-only' : 'workspace-write', '-C', cwd];
    if (mode === 'implementation') invocation.args.splice(3, 0, '--json');
    if (model) invocation.args.push('--model', model);
    invocation.args.push('-');
  } else if (provider === 'claude') {
    invocation.args = [
      '-p',
      '--output-format', mode === 'review' ? 'text' : 'stream-json',
      '--permission-mode', mode === 'review' ? 'plan' : 'dontAsk',
      '--no-session-persistence',
      '--allowedTools', claudeTools(input.task, mode).join(','),
    ];
    if (model) invocation.args.push('--model', model);
    if (Number.isFinite(Number(input.maxBudgetUsd)) && Number(input.maxBudgetUsd) > 0) {
      invocation.args.push('--max-budget-usd', String(input.maxBudgetUsd));
    }
  } else {
    invocation.args = [
      '--print', invocation.prompt,
      '--output-format', mode === 'review' ? 'text' : 'stream-json',
      '--mode', mode === 'review' ? 'plan' : 'accept-edits',
      '--sandbox',
    ];
    if (mode === 'implementation') invocation.args.push('--dangerously-skip-permissions');
    if (model) invocation.args.push('--model', model);
  }
  return invocation;
}

export function invokeProvider(invocation, options = {}) {
  mkdirSync(resolve(invocation.logPath, '..'), { recursive: true });
  const output = createWriteStream(invocation.logPath, { flags: 'a' });
  const startedAt = Date.now();
  const maxCapture = Number(options.maxCaptureBytes ?? 1024 * 1024);

  return new Promise((resolvePromise, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    options.onStart?.(child.pid);
    let captured = '';
    let timedOut = false;
    const capture = (chunk) => {
      output.write(chunk);
      captured = `${captured}${chunk.toString('utf8')}`.slice(-maxCapture);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.once('error', (error) => {
      output.end();
      reject(error);
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, invocation.timeoutMs);
    timeout.unref();
    child.once('close', (exitCode, signal) => {
      clearTimeout(timeout);
      output.end();
      resolvePromise({
        provider: invocation.provider,
        exitCode: exitCode ?? -1,
        signal: signal ?? '',
        timedOut,
        durationMs: Date.now() - startedAt,
        logPath: invocation.logPath,
        output: captured,
        promptMeasurement: invocation.promptMeasurement ?? measureProviderPrompt(invocation.prompt),
        providerUsage: normaliseProviderUsage(
          invocation.provider,
          options.providerUsage ?? invocation.providerUsage,
        ),
      });
    });
    child.stdin.end(invocation.prompt);
  });
}
