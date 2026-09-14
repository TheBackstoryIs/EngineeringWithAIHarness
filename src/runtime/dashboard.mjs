import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeRuntime } from './database.mjs';
import { syncIntentIndex } from './intents.mjs';
import { runtimePaths } from './paths.mjs';
import { dashboardRuntimeVersion } from './version.mjs';
import { loadProjectConfig } from '../project.mjs';
import { inspectPersonaEntitlement } from '../persona-entitlements.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(moduleDir, 'dashboard-server.mjs');

function readState(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function health(url, timeout = 800) {
  try {
    const target = new URL(url);
    if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1') return null;
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(timeout) });
    if (!response.ok) return null;
    const body = await response.json();
    return body?.schema === 'ewai.dashboard-health/v1' ? body : null;
  } catch {
    return null;
  }
}

function basePort(projectRoot) {
  const digest = createHash('sha256').update(resolve(projectRoot)).digest();
  return 47000 + digest.readUInt16BE(0) % 1000;
}

function candidatePorts(projectRoot, configuredPort = 0) {
  if (configuredPort) return [configuredPort];
  const first = basePort(projectRoot);
  return Array.from({ length: 20 }, (_, index) => 47000 + ((first - 47000 + index) % 1000));
}

function matchesProject(response, projectRoot, pid) {
  return Boolean(response
    && typeof response.projectRoot === 'string'
    && isAbsolute(response.projectRoot)
    && resolve(response.projectRoot) === projectRoot
    && Number.isSafeInteger(response.pid) && response.pid > 0
    && (pid === undefined || (Number.isSafeInteger(pid) && pid > 0 && response.pid === pid)));
}

function compatibleHealth(response, projectRoot, pid) {
  return matchesProject(response, projectRoot, pid)
    && response.runtimeVersion === dashboardRuntimeVersion;
}

function runtimeState(paths, response, port, owned) {
  return { schema: 'ewai.dashboard-state/v1', projectRoot: paths.projectRoot,
    pid: response.pid, port, url: `http://127.0.0.1:${port}`,
    startedAt: response.startedAt, owned };
}

export async function dashboardStatus(projectRoot) {
  const paths = runtimePaths(projectRoot);
  const state = readState(paths.dashboardStatePath);
  if (!state?.url) return { status: 'stopped', state: null };
  const response = await health(state.url);
  if (!matchesProject(response, paths.projectRoot, state.pid)) {
    return { status: 'stale', state };
  }
  if (!compatibleHealth(response, paths.projectRoot, state.pid)) {
    return { status: 'stale', state: { ...state, ...response },
      verified: state.owned !== false && response.pid !== process.pid, reason: 'runtime-version' };
  }
  return { status: 'running', state: { ...state, ...response } };
}

export async function ensureDashboard(projectRoot, options = {}) {
  const paths = runtimePaths(projectRoot);
  initializeRuntime(paths.projectRoot);
  const indexed = syncIntentIndex(paths.projectRoot);

  // Check on every launch, including reuse; check-in shares its own promise.
  const premium = await (options.premiumCheck ?? inspectPersonaEntitlement(loadProjectConfig(paths.projectRoot).config, { home: options.home, fetchImpl: options.premiumFetchImpl }));
  const checkin = readState(paths.checkinStatePath);
  writeState(paths.checkinStatePath, {
    ...(checkin?.schema === 'ewai.checkin-state/v1' ? checkin : {}),
    schema: 'ewai.checkin-state/v1', checkedAt: new Date().toISOString(), premium,
  });

  const current = await dashboardStatus(paths.projectRoot);
  if (current.status === 'running') {
    return { status: 'running', started: false, intentCount: indexed.count, ...current.state };
  }
  if (current.status === 'stale') {
    if (current.verified && current.state?.pid) {
      try {
        process.kill(Number(current.state.pid), 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline && await health(current.state.url, 250)) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
      if (await health(current.state.url, 250)) {
        throw new Error('The previous EWAI dashboard is still running. Close it, restart EWAI and open the new dashboard link. Existing settings and personas are unchanged.');
      }
    }
    rmSync(paths.dashboardStatePath, { force: true });
  }

  mkdirSync(paths.logRoot, { recursive: true });
  const log = openSync(paths.dashboardLogPath, 'a');
  try {
    for (const port of candidatePorts(paths.projectRoot, Number(options.port || 0))) {
      const url = `http://127.0.0.1:${port}`;
      const existing = await health(url);
      if (compatibleHealth(existing, paths.projectRoot)) {
        const state = runtimeState(paths, existing, port, false);
        writeState(paths.dashboardStatePath, state);
        return { status: 'running', started: false, intentCount: indexed.count, ...state };
      }
      if (existing) continue;

      const child = spawn(process.execPath, [serverEntry, '--project', paths.projectRoot, '--port', String(port)], {
        cwd: paths.projectRoot,
        detached: true,
        stdio: ['ignore', log, log],
        env: { ...process.env, ...(options.home ? { HOME: resolve(options.home) } : {}), EWAI_DASHBOARD_CHILD: '1' }
      });
      let spawnFailed = false;
      child.on('error', () => { spawnFailed = true; });
      child.unref();

      const deadline = Date.now() + (options.timeout ?? 5000);
      while (Date.now() < deadline) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
        const response = await health(url, 500);
        if (compatibleHealth(response, paths.projectRoot, child.pid)) {
          const state = runtimeState(paths, response, port, true);
          writeState(paths.dashboardStatePath, state);
          return { status: 'running', started: true, intentCount: indexed.count, ...state };
        }
        if (spawnFailed || child.exitCode !== null) break;
      }
      if (!spawnFailed && child.exitCode === null && Number.isSafeInteger(child.pid)) {
        try { child.kill('SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    }
  } finally {
    closeSync(log);
  }

  throw new Error(`EWAI couldn't open a compatible dashboard. Restart EWAI and open the new dashboard link. If this continues, check the dashboard log: ${paths.dashboardLogPath}`);
}

export async function stopDashboard(projectRoot) {
  const paths = runtimePaths(projectRoot);
  const current = await dashboardStatus(projectRoot);
  if ((current.status !== 'running' && !current.verified) || current.state?.owned === false || current.state?.pid === process.pid) {
    rmSync(paths.dashboardStatePath, { force: true });
    return { status: 'stopped', stopped: false };
  }

  try {
    process.kill(Number(current.state.pid), 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    if (!(await health(current.state.url, 250))) break;
  }
  rmSync(paths.dashboardStatePath, { force: true });
  return { status: 'stopped', stopped: true };
}
