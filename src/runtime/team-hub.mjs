import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTeamHubDataRoot } from './team-hub-database.mjs';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(moduleDirectory, 'team-hub-server.mjs');

function servicePaths(dataRoot) {
  const root = validateTeamHubDataRoot(dataRoot);
  return { root, state: resolve(root, 'runtime/team-hub.json'), log: resolve(root, 'logs/team-hub.log') };
}

function readState(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function writeState(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function health(url, timeout = 800) {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(timeout) });
    if (!response.ok) return null;
    const value = await response.json();
    return value.schema === 'ewai.team-hub-health/v1' ? value : null;
  } catch { return null; }
}

function basePort(dataRoot) {
  const digest = createHash('sha256').update(resolve(dataRoot)).digest();
  return 48000 + digest.readUInt16BE(0) % 1000;
}

function ports(dataRoot, configured) {
  if (Number(configured) > 0) return [Number(configured)];
  const first = basePort(dataRoot);
  return Array.from({ length: 20 }, (_, index) => 48000 + ((first - 48000 + index) % 1000));
}

export async function teamHubStatus(options = {}) {
  const paths = servicePaths(options.dataRoot);
  const state = readState(paths.state);
  if (!state?.url) return { schema: 'ewai.team-hub-service-status/v1', status: 'stopped', state: null };
  const observed = await health(state.url);
  if (!observed || Number(observed.pid) !== Number(state.pid)) return { schema: 'ewai.team-hub-service-status/v1', status: 'stale', state };
  return { schema: 'ewai.team-hub-service-status/v1', status: 'running', state: { ...state, bind: observed.bind, tls: observed.tls, publisherConfigured: observed.publisherConfigured === true } };
}

export async function ensureTeamHub(options = {}) {
  const paths = servicePaths(options.dataRoot);
  const tokenEnv = String(options.tokenEnv ?? '');
  if (!/^[A-Z][A-Z0-9_]{2,100}$/.test(tokenEnv)) throw new Error('Team Hub requires a safe --token-env name.');
  if (!String((options.env ?? process.env)[tokenEnv] ?? '')) throw new Error(`Team Hub token environment variable is unavailable: ${tokenEnv}`);
  const publisherTokenEnv = String(options.publisherTokenEnv ?? '');
  if (publisherTokenEnv && !/^[A-Z][A-Z0-9_]{2,100}$/.test(publisherTokenEnv)) throw new Error('Team Hub requires a safe --publisher-token-env name.');
  if (publisherTokenEnv && !String((options.env ?? process.env)[publisherTokenEnv] ?? '')) throw new Error(`Team Hub publisher token environment variable is unavailable: ${publisherTokenEnv}`);
  if (publisherTokenEnv && publisherTokenEnv === tokenEnv) throw new Error('Team Hub reader and publisher token environment variables must be different.');
  const host = String(options.host ?? '127.0.0.1');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && options.allowNetwork !== true) throw new Error('A non-loopback Team Hub bind requires --allow-network.');
  const current = await teamHubStatus({ dataRoot: paths.root });
  if (current.status === 'running') return { status: 'running', started: false, ...current.state };
  rmSync(paths.state, { force: true });
  mkdirSync(dirname(paths.log), { recursive: true });
  const log = openSync(paths.log, 'a');
  try {
    for (const port of ports(paths.root, options.port)) {
      const displayHost = host === '::1' ? '[::1]' : host;
      const url = `http://${displayHost}:${port}`;
      if (await health(url, 250)) continue;
      const args = [serverEntry, '--data', paths.root, '--host', host, '--port', String(port), '--token-env', tokenEnv];
      if (publisherTokenEnv) args.push('--publisher-token-env', publisherTokenEnv);
      if (options.allowNetwork) args.push('--allow-network');
      const child = spawn(process.execPath, args, { detached: true, stdio: ['ignore', log, log], env: options.env ?? process.env });
      child.unref();
      const deadline = Date.now() + Number(options.timeoutMs ?? 5_000);
      while (Date.now() < deadline) {
        await new Promise((accept) => setTimeout(accept, 100));
        const observed = await health(url, 400);
        if (observed && Number(observed.pid) === Number(child.pid)) {
          const state = { schema: 'ewai.team-hub-service-state/v1', pid: child.pid, host, port, url, tokenEnv, publisherTokenEnv: publisherTokenEnv || null, startedAt: observed.startedAt };
          writeState(paths.state, state);
          return { status: 'running', started: true, ...state };
        }
        if (child.exitCode !== null) break;
      }
    }
  } finally { closeSync(log); }
  throw new Error(`Unable to start Team Hub. Review the service log under the configured data root.`);
}

export async function stopTeamHub(options = {}) {
  const paths = servicePaths(options.dataRoot);
  const current = await teamHubStatus({ dataRoot: paths.root });
  if (current.status !== 'running') {
    rmSync(paths.state, { force: true });
    return { schema: 'ewai.team-hub-service-status/v1', status: 'stopped', stopped: false };
  }
  try { process.kill(Number(current.state.pid), 'SIGTERM'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && await health(current.state.url, 250)) await new Promise((accept) => setTimeout(accept, 100));
  rmSync(paths.state, { force: true });
  return { schema: 'ewai.team-hub-service-status/v1', status: 'stopped', stopped: true };
}
