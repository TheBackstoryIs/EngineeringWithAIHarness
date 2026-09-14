import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import { buildTeamHubEnvelope, buildTeamHubSnapshot, inspectTeamHubDisclosure, validateTeamHubReceipt } from '../team-hub.mjs';
import { runtimePaths } from './paths.mjs';
import { validateTeamHubResourcePackage } from '../team-hub-resources.mjs';
import { parseOrganisationBlueprintPack } from '../organisation-blueprints.mjs';
import { parseDesignSystemPack } from '../design-systems.mjs';
import { defaultPackRoot, listPacks } from '../packs.mjs';
import { homedir } from 'node:os';

const connectionSchema = z.object({
  schema: z.literal('ewai.team-hub-connection/v1'),
  endpoint: z.string().url().max(500),
  projectId: z.string().min(1).max(120).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
  tokenEnv: z.string().regex(/^[A-Z][A-Z0-9_]{2,100}$/),
  disclosureDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  connectedAt: z.string().datetime({ offset: true }),
}).strict();

function safeEndpoint(value) {
  let url;
  try { url = new URL(String(value ?? '')); } catch { throw new Error('Team Hub endpoint must be a valid URL.'); }
  if (url.username || url.password || url.search || url.hash) throw new Error('Team Hub endpoint must not contain credentials, query parameters or fragments.');
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('Team Hub endpoint must use HTTPS, except for loopback development.');
  return url.toString().replace(/\/$/, '');
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function localMetadata(path) {
  try { return lstatSync(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function assertLocalDirectoryChain(projectRoot, target, options = {}) {
  const root = resolve(projectRoot);
  const destination = resolve(target);
  const boundary = relative(root, destination);
  if (!boundary || boundary.startsWith('..') || isAbsolute(boundary)) throw new Error('Team Hub managed path escapes the project root.');
  let cursor = root;
  for (const segment of boundary.split(/[/\\]/)) {
    cursor = resolve(cursor, segment);
    let metadata = localMetadata(cursor);
    if (!metadata) {
      if (options.create === true) mkdirSync(cursor, { mode: 0o700 });
      else return destination;
      metadata = lstatSync(cursor);
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error('Team Hub managed paths may not traverse symbolic or non-directory content.');
  }
  return destination;
}

function assertLocalRegularFile(path) {
  const metadata = localMetadata(path);
  if (!metadata) return;
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error('Team Hub managed state must be a regular file.');
}

function privateJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}

function safeConnection(path) {
  const parsed = connectionSchema.safeParse(readJson(path));
  return parsed.success ? parsed.data : null;
}

function attemptFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((name) => /^attempt-[a-zA-Z0-9-]+\.json$/.test(name)).sort().reverse();
}

export function readTeamHubWorkspace(projectRoot) {
  const paths = runtimePaths(projectRoot);
  const connection = safeConnection(paths.teamHubConnectionPath);
  const latestAttemptPath = attemptFiles(paths.teamHubAttemptsRoot)[0];
  const lastAttempt = latestAttemptPath ? readJson(resolve(paths.teamHubAttemptsRoot, latestAttemptPath)) : null;
  const lastAcceptedReceipt = readJson(paths.teamHubAcceptedReceiptPath);
  return {
    schema: 'ewai.team-hub-workspace/v1',
    mode: connection ? 'connected' : 'single',
    connection,
    disclosure: inspectTeamHubDisclosure(),
    lastAttempt,
    lastAcceptedReceipt,
    resources: readTeamHubResourceState(projectRoot),
    localWorkAvailable: true,
    authorityNotice: inspectTeamHubDisclosure().authorityNotice,
  };
}

function safeResourceIdentity(id, version = '') {
  if (!/^org\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(String(id ?? ''))) throw new Error('Team Hub resource ID is invalid.');
  if (version && !/^\d+\.\d+\.\d+$/.test(String(version))) throw new Error('Team Hub resource version is invalid.');
  return { id: String(id), version: String(version) };
}

function connectionToken(connection, options = {}) {
  const token = String((options.env ?? process.env)[connection.tokenEnv] ?? '');
  if (!token) throw Object.assign(new Error(`Team Hub token environment variable is unavailable: ${connection.tokenEnv}`), { code: 'missing-token' });
  return token;
}

async function resourceRequest(connection, path, options = {}) {
  const token = connectionToken(connection, options);
  const response = await (options.fetch ?? globalThis.fetch)(`${connection.endpoint}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? `Hub rejected the resource request with HTTP ${response.status}.`);
  return body;
}

function installedState(projectRoot) {
  const path = runtimePaths(projectRoot).teamHubResourceInstalledPath;
  assertLocalDirectoryChain(projectRoot, dirname(path));
  assertLocalRegularFile(path);
  const value = readJson(path);
  return value?.schema === 'ewai.team-hub-resource-installed-state/v1' && value.resources && typeof value.resources === 'object'
    ? value
    : { schema: 'ewai.team-hub-resource-installed-state/v1', resources: {} };
}

export function listTeamHubResourceReceipts(projectRoot) {
  const root = runtimePaths(projectRoot).teamHubResourceReceiptsRoot;
  assertLocalDirectoryChain(projectRoot, root);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => /^receipt-[a-zA-Z0-9-]+\.json$/.test(name))
    .sort()
    .map((name) => {
      const path = resolve(root, name);
      assertLocalRegularFile(path);
      return readJson(path);
    })
    .filter((value) => value?.schema === 'ewai.team-hub-resource-install-receipt/v1')
    .reverse();
}

export function readTeamHubResourceState(projectRoot) {
  const state = installedState(projectRoot);
  return projectTeamHubResourceState(state, listTeamHubResourceReceipts(projectRoot));
}

function projectTeamHubResourceState(state, receipts) {
  return {
    schema: 'ewai.team-hub-resource-workspace/v1',
    installed: Object.values(state.resources).sort((left, right) => left.id.localeCompare(right.id)),
    receipts,
    authority: 'Installed means available locally. Select or apply the resource separately.',
  };
}

export async function listConnectedTeamHubResources(projectRoot, options = {}) {
  const connection = safeConnection(runtimePaths(projectRoot).teamHubConnectionPath);
  if (!connection) throw new Error('Team Hub is not connected.');
  const catalogue = await resourceRequest(connection, '/api/v1/resources', options);
  if (catalogue?.schema !== 'ewai.team-hub-resource-catalogue/v1' || !Array.isArray(catalogue.releases)) throw new Error('Team Hub returned an invalid resource catalogue.');
  return { ...catalogue, local: readTeamHubResourceState(projectRoot) };
}

export async function inspectConnectedTeamHubResource(projectRoot, id, version, options = {}) {
  const identity = safeResourceIdentity(id, version);
  const connection = safeConnection(runtimePaths(projectRoot).teamHubConnectionPath);
  if (!connection) throw new Error('Team Hub is not connected.');
  const value = await resourceRequest(connection, `/api/v1/resources/${encodeURIComponent(identity.id)}/releases/${encodeURIComponent(identity.version)}`, options);
  const resourcePackage = validateTeamHubResourcePackage(value);
  if (resourcePackage.resource.id !== identity.id || resourcePackage.resource.version !== identity.version) throw new Error('Team Hub resource identity disagrees with the requested release.');
  return {
    schema: 'ewai.team-hub-resource-inspection/v1',
    resource: resourcePackage.resource,
    digest: resourcePackage.digest,
    files: resourcePackage.files.map(({ path, size, digest }) => ({ path, size, digest })),
    installed: installedState(projectRoot).resources[identity.id] ?? null,
    authority: 'Inspection does not install, select or apply this resource.',
  };
}

function writePackageFolder(folder, resourcePackage) {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  for (const file of resourcePackage.files) {
    const destination = resolve(folder, file.path);
    if (!destination.startsWith(`${resolve(folder)}/`)) throw new Error(`Resource file escapes staging: ${file.path}`);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    writeFileSync(destination, file.content, { encoding: 'utf8', mode: 0o600 });
  }
}

function validateStagedResource(folder, resourcePackage) {
  const manifest = resolve(folder, 'pack.yaml');
  const parsed = resourcePackage.resource.kind === 'organisation-blueprint'
    ? parseOrganisationBlueprintPack(manifest, 'team-hub-managed')
    : parseDesignSystemPack(manifest, 'team-hub-managed');
  if (!parsed || parsed.id !== resourcePackage.resource.id || parsed.version !== resourcePackage.resource.version) {
    throw new Error('Staged resource identity disagrees with its package.');
  }
  return parsed;
}

function outsideCollision(projectRoot, id, managedPath, options = {}) {
  const roots = [defaultPackRoot, resolve(options.home ?? homedir(), '.ewai/packs'), resolve(projectRoot, '.ewai-pipeline/packs')];
  for (const root of roots) {
    for (const pack of listPacks(root)) {
      if (pack.id === id && resolve(dirname(pack.path)) !== resolve(managedPath)) return pack.path;
    }
  }
  return null;
}

function compareVersion(left, right) {
  const a = String(left).split('.').map(Number);
  const b = String(right).split('.').map(Number);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

function processIsActive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function acquireResourceInstallLease(projectRoot, paths, options = {}) {
  const leasePath = resolve(paths.teamHubResourcesRoot, 'install.lock');
  const metadataPath = resolve(leasePath, 'lease.json');
  const now = options.at ?? new Date().toISOString();
  const staleAfterMs = Math.max(1_000, Number(options.installLeaseStaleAfterMs ?? 15 * 60_000));
  const leaseId = randomUUID();

  const create = () => {
    try {
      mkdirSync(leasePath, { mode: 0o700 });
      privateJson(metadataPath, {
        schema: 'ewai.team-hub-resource-install-lease/v1',
        leaseId,
        pid: process.pid,
        acquiredAt: now,
      });
      return true;
    } catch (error) {
      if (error?.code === 'EEXIST') return false;
      rmSync(leasePath, { recursive: true, force: true });
      throw error;
    }
  };

  if (!create()) {
    const current = readJson(metadataPath);
    const acquiredAt = Date.parse(current?.acquiredAt ?? '');
    const leaseModifiedAt = localMetadata(leasePath)?.mtimeMs;
    const observedAt = Number.isFinite(Date.parse(now)) ? Date.parse(now) : Date.now();
    const age = Number.isFinite(acquiredAt)
      ? Math.max(0, observedAt - acquiredAt)
      : Math.max(0, observedAt - Number(leaseModifiedAt ?? observedAt));
    const validMetadata = current?.schema === 'ewai.team-hub-resource-install-lease/v1';
    const stale = validMetadata
      ? !processIsActive(Number(current.pid))
      : age > staleAfterMs;
    if (stale) {
      rmSync(leasePath, { recursive: true, force: true });
      if (!create()) throw Object.assign(new Error('Another Team Hub resource installation is already in progress.'), { code: 'resource-install-busy', status: 409 });
    } else {
      throw Object.assign(new Error('Another Team Hub resource installation is already in progress.'), { code: 'resource-install-busy', status: 409 });
    }
  }

  return () => {
    const current = readJson(metadataPath);
    if (current?.leaseId === leaseId) rmSync(leasePath, { recursive: true, force: true });
  };
}

export async function installConnectedTeamHubResource(projectRoot, input = {}, options = {}) {
  if (input.confirmed !== true) throw new Error('Team Hub resource installation requires explicit confirmation.');
  const approvedBy = String(input.approvedBy ?? '').trim();
  if (!approvedBy) throw new Error('Team Hub resource installation requires the approving person or role.');
  const expectedDigest = String(input.expectedDigest ?? '');
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedDigest)) throw new Error('Team Hub resource installation requires an exact expected digest.');
  const identity = safeResourceIdentity(input.id, input.version);
  const paths = runtimePaths(projectRoot);
  for (const root of [
    dirname(paths.teamHubResourceInstalledPath), paths.teamHubResourceCacheRoot,
    paths.teamHubResourceStagingRoot, paths.teamHubResourceReceiptsRoot, paths.teamHubManagedPackRoot,
  ]) assertLocalDirectoryChain(projectRoot, root, { create: true });
  const releaseLease = acquireResourceInstallLease(projectRoot, paths, options);
  const attemptId = randomUUID();
  const staging = resolve(paths.teamHubResourceStagingRoot, `attempt-${attemptId}`);
  const managedPath = resolve(paths.teamHubManagedPackRoot, identity.id);
  const candidate = resolve(paths.teamHubManagedPackRoot, `.candidate-${attemptId}`);
  const backup = resolve(paths.teamHubManagedPackRoot, `.backup-${identity.id}`);
  try {
    const cacheRoot = resolve(paths.teamHubResourceCacheRoot, identity.id, identity.version, expectedDigest.slice(7));
    assertLocalDirectoryChain(projectRoot, cacheRoot);
    assertLocalRegularFile(resolve(cacheRoot, 'package.json'));
    let resourcePackage = readJson(resolve(cacheRoot, 'package.json'));
    if (resourcePackage) resourcePackage = validateTeamHubResourcePackage(resourcePackage);
    if (!resourcePackage) {
      const connection = safeConnection(paths.teamHubConnectionPath);
      if (!connection) throw new Error('Team Hub is not connected and this exact release is not cached.');
      resourcePackage = validateTeamHubResourcePackage(await resourceRequest(
        connection,
        `/api/v1/resources/${encodeURIComponent(identity.id)}/releases/${encodeURIComponent(identity.version)}`,
        options,
      ));
    }
    if (resourcePackage.resource.id !== identity.id || resourcePackage.resource.version !== identity.version || resourcePackage.digest !== expectedDigest) {
      throw new Error('Downloaded Team Hub resource identity or digest disagrees with the confirmed release.');
    }

    const collision = outsideCollision(projectRoot, identity.id, managedPath, options);
    if (collision) throw new Error(`Resource ID collides with a pack outside Team Hub management: ${identity.id}`);
    writePackageFolder(staging, resourcePackage);
    validateStagedResource(staging, resourcePackage);
    if (!existsSync(cacheRoot)) {
      mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
      assertLocalDirectoryChain(projectRoot, cacheRoot);
      writePackageFolder(resolve(cacheRoot, 'files'), resourcePackage);
      privateJson(resolve(cacheRoot, 'package.json'), resourcePackage);
    }
    writePackageFolder(candidate, resourcePackage);
    validateStagedResource(candidate, resourcePackage);

    const statePathExisted = existsSync(paths.teamHubResourceInstalledPath);
    const state = installedState(projectRoot);
    const previousState = structuredClone(state);
    const previous = state.resources[identity.id] ?? null;
    if (previous?.digest === expectedDigest && existsSync(managedPath)) {
      return { schema: 'ewai.team-hub-resource-install-result/v1', replayed: true, receipt: null, workspace: readTeamHubResourceState(projectRoot) };
    }
    const previousReceipts = listTeamHubResourceReceipts(projectRoot);
    rmSync(backup, { recursive: true, force: true });
    if (existsSync(managedPath)) renameSync(managedPath, backup);
    try { renameSync(candidate, managedPath); }
    catch (error) {
      if (existsSync(backup) && !existsSync(managedPath)) renameSync(backup, managedPath);
      throw error;
    }
    try {
      validateStagedResource(managedPath, resourcePackage);
      if (typeof options.afterPromotion === 'function') options.afterPromotion();
      const action = previous ? (compareVersion(identity.version, previous.version) < 0 ? 'restored' : 'updated') : 'installed';
      const installedAt = input.at ?? new Date().toISOString();
      const current = {
        id: identity.id,
        name: resourcePackage.resource.name,
        kind: resourcePackage.resource.kind,
        version: identity.version,
        digest: expectedDigest,
        publisher: resourcePackage.resource.publisher,
        installedAt,
        installedBy: approvedBy,
      };
      const receipt = {
        schema: 'ewai.team-hub-resource-install-receipt/v1',
        receiptId: `receipt-${randomUUID()}`,
        resourceId: identity.id,
        action,
        previous: previous ? { version: previous.version, digest: previous.digest } : null,
        installed: { version: identity.version, digest: expectedDigest },
        approvedBy,
        installedAt,
        authority: 'Installation made this release available locally; it did not select or apply it.',
      };
      state.resources[identity.id] = current;
      if (typeof options.beforeStateWrite === 'function') options.beforeStateWrite();
      privateJson(paths.teamHubResourceInstalledPath, state);
      if (typeof options.beforeReceiptWrite === 'function') options.beforeReceiptWrite();
      privateJson(resolve(paths.teamHubResourceReceiptsRoot, `${receipt.receiptId}.json`), receipt);
      try { rmSync(backup, { recursive: true, force: true }); } catch { /* A later install safely clears a stale backup. */ }
      return {
        schema: 'ewai.team-hub-resource-install-result/v1', replayed: false, receipt,
        workspace: projectTeamHubResourceState(state, [receipt, ...previousReceipts]),
      };
    } catch (error) {
      rmSync(managedPath, { recursive: true, force: true });
      if (existsSync(backup)) renameSync(backup, managedPath);
      if (statePathExisted) privateJson(paths.teamHubResourceInstalledPath, previousState);
      else rmSync(paths.teamHubResourceInstalledPath, { force: true });
      throw error;
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(candidate, { recursive: true, force: true });
    releaseLease();
  }
}

export function connectTeamHub(projectRoot, input = {}) {
  if (input.confirmed !== true) throw new Error('Team Hub connection requires explicit confirmation.');
  if (input.disclosureAcknowledged !== true) throw new Error('Team Hub connection requires acknowledgement of the disclosure contract.');
  const disclosure = inspectTeamHubDisclosure();
  const value = {
    schema: 'ewai.team-hub-connection/v1',
    endpoint: safeEndpoint(input.endpoint),
    projectId: input.projectId ?? `project-${randomUUID()}`,
    tokenEnv: String(input.tokenEnv ?? ''),
    disclosureDigest: disclosure.contractDigest,
    connectedAt: input.at ?? new Date().toISOString(),
  };
  const parsed = connectionSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Team Hub connection is invalid: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
  privateJson(runtimePaths(projectRoot).teamHubConnectionPath, parsed.data);
  return parsed.data;
}

function recordAttempt(projectRoot, attempt) {
  const paths = runtimePaths(projectRoot);
  const path = resolve(paths.teamHubAttemptsRoot, `attempt-${attempt.at.replace(/[^0-9]/g, '')}-${attempt.attemptId}.json`);
  privateJson(path, attempt);
  return attempt;
}

export async function syncTeamHub(projectRoot, options = {}) {
  if (options.confirmed !== true) throw new Error('Team Hub sync requires explicit confirmation.');
  const paths = runtimePaths(projectRoot);
  const connection = safeConnection(paths.teamHubConnectionPath);
  if (!connection) throw new Error('Team Hub is not connected.');
  const snapshot = options.snapshot ?? buildTeamHubSnapshot(projectRoot, { projectId: connection.projectId });
  if (snapshot.project.id !== connection.projectId) throw new Error('Team Hub snapshot project identity disagrees with the connection.');
  const envelope = buildTeamHubEnvelope(snapshot);
  const attemptId = randomUUID();
  const at = options.at ?? new Date().toISOString();
  const base = { schema: 'ewai.team-hub-attempt/v1', attemptId, at, projectId: connection.projectId, snapshotDigest: envelope.snapshotDigest };
  let attempt;
  let receipt = null;
  try {
    const token = String((options.env ?? process.env)[connection.tokenEnv] ?? '');
    if (!token) {
      const error = new Error(`Team Hub token environment variable is unavailable: ${connection.tokenEnv}`);
      error.code = 'missing-token';
      throw error;
    }
    const fetcher = options.fetch ?? globalThis.fetch;
    const response = await fetcher(`${connection.endpoint}/api/v1/snapshots`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
    });
    if (!response.ok) throw new Error(`Hub rejected the snapshot with HTTP ${response.status}.`);
    receipt = validateTeamHubReceipt(await response.json());
    if (receipt.projectId !== connection.projectId || receipt.snapshotDigest !== envelope.snapshotDigest || receipt.idempotencyKey !== envelope.idempotencyKey) {
      throw new Error('Hub receipt identity or digest disagrees with the submitted snapshot.');
    }
    attempt = { ...base, status: 'accepted', receiptId: receipt.receiptId, error: null };
    privateJson(paths.teamHubAcceptedReceiptPath, receipt);
  } catch (error) {
    attempt = {
      ...base, status: 'failed', receiptId: null,
      error: { code: error?.code === 'missing-token' ? 'missing-token' : error?.name === 'TimeoutError' ? 'timeout' : 'submission-failed', message: String(error?.message ?? 'Team Hub submission failed.').slice(0, 240) },
    };
    receipt = null;
  }
  recordAttempt(projectRoot, attempt);
  return { attempt, receipt, workspace: readTeamHubWorkspace(projectRoot) };
}

export function disconnectTeamHub(projectRoot, options = {}) {
  if (options.confirmed !== true) throw new Error('Team Hub disconnect requires explicit confirmation.');
  rmSync(runtimePaths(projectRoot).teamHubConnectionPath, { force: true });
  return readTeamHubWorkspace(projectRoot);
}
