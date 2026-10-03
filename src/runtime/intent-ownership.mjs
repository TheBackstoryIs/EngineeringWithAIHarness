import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, realpathSync, lstatSync, readdirSync, readFileSync, mkdirSync, openSync, closeSync, fstatSync, writeFileSync, fsyncSync, unlinkSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import YAML from 'yaml';
import { projectPaths } from '../paths.mjs';
import { openRuntimeDatabase } from './database.mjs';
import { readAutonomyPolicy } from '../autonomy.mjs';
import { autonomyDigest, readAutonomyFile } from './autonomy-workspace.mjs';
import { normaliseAutonomyOperation, inspectAutonomyOperation, assertNoUnresolvedIntentOperation, beginAutonomyOperation, completeAutonomyOperation, failAutonomyOperation } from './autonomy-operations.mjs';

const context = new AsyncLocalStorage();
const processInstance = randomUUID();
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const intentPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const tokenHash = value => createHash('sha256').update(value).digest('hex');

export function intentOwnershipError(code, statusCode = 409) {
  const error = new Error(`Intent mutation cannot proceed: ${code}.`);
  error.code = code; error.statusCode = statusCode; throw error;
}

export function safeIntentMutationPath(root, path) {
  const local = relative(root, path);
  if (local.startsWith('..') || isAbsolute(local)) intentOwnershipError('intent-mutation-unsafe-path', 403);
  let cursor = root;
  for (const part of local.split('/').filter(Boolean)) {
    cursor = resolve(cursor, part);
    let stat; try { stat = lstatSync(cursor); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink() || !stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1)) intentOwnershipError('intent-mutation-unsafe-path', 403);
  }
  return path;
}

export function intentMutationPaths(root) {
  const realRoot = realpathSync(root), locatorPath = safeIntentMutationPath(realRoot, resolve(realRoot, '.ewai-pipeline/project.json'));
  let locator = {};
  if (existsSync(locatorPath)) {
    try { locator = JSON.parse(readFileSync(locatorPath, 'utf8')); } catch { intentOwnershipError('intent-project-invalid', 422); }
    let recordedRoot = realRoot;
    try { if (locator?.projectRoot !== undefined) recordedRoot = realpathSync(locator.projectRoot); }
    catch { intentOwnershipError('intent-project-invalid', 422); }
    if (locator?.schema !== 'ewai.runtime-project/v1' || locator.specsRoot !== undefined && (typeof locator.specsRoot !== 'string' || !locator.specsRoot.trim())
      || recordedRoot !== realRoot) intentOwnershipError('intent-project-invalid', 422);
  }
  const paths = projectPaths(realRoot, { specsRoot: locator.specsRoot ?? 'SPECS' });
  for (const path of [paths.specsRoot, resolve(paths.runtimeRoot, 'data/pipeline.sqlite')]) safeIntentMutationPath(realRoot, path);
  return { ...paths, ownershipRoot: resolve(paths.runtimeRoot, 'runtime/intent-ownership') };
}

export function resolveIntentMutationReference(root, reference) {
  const paths = intentMutationPaths(root), intentsRoot = resolve(paths.specsRoot, '2.Purpose/intents');
  if (typeof reference !== 'string' || reference.length > 160 || !(intentPattern.test(reference) || slugPattern.test(reference))) intentOwnershipError('intent-reference-invalid', 422);
  const ids = intentPattern.test(reference) ? [reference] : readdirSync(safeIntentMutationPath(paths.projectRoot, intentsRoot), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && slugPattern.test(entry.name)).map(entry => `${entry.name}/${reference}`);
  const matches = ids.filter(id => ['md', 'json'].some(extension => existsSync(safeIntentMutationPath(paths.projectRoot, resolve(intentsRoot, `${id}.${extension}`)))));
  if (matches.length !== 1) intentOwnershipError(matches.length ? 'intent-reference-ambiguous' : 'intent-reference-unknown', 422);
  const id = matches[0], sidecar = resolve(intentsRoot, `${id}.json`);
  if (existsSync(sidecar)) {
    const raw = readAutonomyFile(paths.projectRoot, sidecar);
    let source; try { source = JSON.parse(raw); } catch { intentOwnershipError('intent-state-invalid', 422); }
    if (source?.schema !== 'ewai.intent-state/v1' || `${source.domain}/${source.slug}` !== id) intentOwnershipError('intent-state-invalid', 422);
  } else {
    // Legacy registered Markdown intents remain usable for interactive work;
    // their canonical delivery checks still decide whether advancement is safe.
    const source = readAutonomyFile(paths.projectRoot, resolve(intentsRoot, `${id}.md`));
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    let metadata; try { metadata = match && YAML.parse(match[1], { maxAliasCount: 100 }); } catch { intentOwnershipError('intent-state-invalid', 422); }
    const [domain, slug] = id.split('/');
    if (metadata?.schema !== 'ewai.intent/v1' || metadata.slug !== slug || metadata.domain !== undefined && metadata.domain !== domain) intentOwnershipError('intent-state-invalid', 422);
  }
  return id;
}

function key(root, intentId) { return `${root}\n${intentId}`; }
function withMutex(paths, intentId, operation, owner = null) {
  if (context.getStore()?.open && context.getStore()?.key === key(paths.projectRoot, intentId)) return operation();
  const directory = safeIntentMutationPath(paths.projectRoot, paths.ownershipRoot);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = safeIntentMutationPath(paths.projectRoot, resolve(directory, `${tokenHash(intentId)}.lock`));
  let fd;
  // A claimant checking the lease may briefly hold this mutex even though the
  // current owner will reject its claim. Give only that verified owner bounded
  // lock-acquisition patience; no callback or journal attempt is repeated.
  for (let attempt = 0; fd === undefined; attempt += 1) {
    try { fd = openSync(path, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!owner || attempt >= 20) intentOwnershipError('intent-mutation-conflict');
      assertIntentOwnership(paths.projectRoot, owner);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  const identity = fstatSync(fd);
  try {
    writeFileSync(fd, JSON.stringify({ schema: 'ewai.intent-mutex/v1', intentId, pid: process.pid, processInstance })); fsyncSync(fd);
    return operation();
  } finally {
    closeSync(fd);
    const current = lstatSync(path);
    if (current.ino !== identity.ino || current.dev !== identity.dev) intentOwnershipError('intent-mutation-lock-changed');
    unlinkSync(path);
  }
}

function withDatabase(paths, operation) {
  const db = openRuntimeDatabase(paths.projectRoot);
  try { return operation(db); } finally { db.close(); }
}
function duration(input) {
  const value = input.durationMs ?? 600000;
  if (!Number.isSafeInteger(value) || value < 1000 || value > 86400000) intentOwnershipError('intent-ownership-duration-invalid', 422);
  return value;
}
function epoch(database) { return database.prepare("SELECT value FROM runtime_meta WHERE key = 'intent_ownership_epoch'").get()?.value; }
function assertHandle(database, handle, intentId = handle?.intentId) {
  if (!handle || !intentPattern.test(intentId ?? '') || typeof handle.token !== 'string' || handle.token.length > 100
      || handle.intentId !== intentId || !Number.isSafeInteger(handle.generation)) intentOwnershipError('intent-ownership-stale');
  const row = database.prepare('SELECT * FROM intent_ownership WHERE intent_id = ?').get(intentId);
  if (!row || epoch(database) !== handle.epoch || row.epoch !== handle.epoch || row.generation !== handle.generation
      || row.owner_id !== handle.ownerId || row.token_hash !== tokenHash(handle.token) || row.status !== 'active' || row.expires_at <= Date.now()) intentOwnershipError('intent-ownership-stale');
  return row;
}

export function acquireIntentOwnership(root, reference, input = {}) {
  const paths = intentMutationPaths(root), intentId = resolveIntentMutationReference(paths.projectRoot, reference), ttl = duration(input);
  const ownerId = input.ownerId ?? `interactive-${processInstance}`;
  if (typeof ownerId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(ownerId)) intentOwnershipError('intent-owner-invalid', 422);
  return withMutex(paths, intentId, () => withDatabase(paths, database => {
    database.exec('BEGIN IMMEDIATE;');
    try {
      const previous = database.prepare('SELECT * FROM intent_ownership WHERE intent_id = ?').get(intentId), currentEpoch = epoch(database);
      if (previous?.status === 'active' && previous.expires_at > Date.now()) intentOwnershipError('intent-ownership-conflict');
      const token = randomUUID(), generation = (previous?.generation ?? 0) + 1, expiresAt = Date.now() + ttl;
      database.prepare(`INSERT INTO intent_ownership (intent_id, epoch, generation, owner_id, token_hash, expires_at, status, pid, process_instance)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?) ON CONFLICT(intent_id) DO UPDATE SET
        epoch=excluded.epoch, generation=excluded.generation, owner_id=excluded.owner_id, token_hash=excluded.token_hash,
        expires_at=excluded.expires_at, status=excluded.status, pid=excluded.pid, process_instance=excluded.process_instance`)
        .run(intentId, currentEpoch, generation, ownerId, tokenHash(token), expiresAt, process.pid, processInstance);
      database.exec('COMMIT;');
      return { intentId, epoch: currentEpoch, generation, ownerId, token, expiresAt };
    } catch (error) { database.exec('ROLLBACK;'); throw error; }
  }));
}

export function assertIntentOwnership(root, handle) {
  const paths = intentMutationPaths(root);
  return withDatabase(paths, database => { assertHandle(database, handle); return { intentId: handle.intentId, epoch: handle.epoch, generation: handle.generation }; });
}
export function renewIntentOwnership(root, handle, input = {}) {
  const paths = intentMutationPaths(root), ttl = duration(input);
  return withMutex(paths, handle?.intentId ?? '', () => withDatabase(paths, database => {
    assertHandle(database, handle); const expiresAt = Date.now() + ttl;
    database.prepare('UPDATE intent_ownership SET expires_at = ? WHERE intent_id = ?').run(expiresAt, handle.intentId);
    return { ...handle, expiresAt };
  }));
}
export function releaseIntentOwnership(root, handle) {
  const paths = intentMutationPaths(root);
  return withMutex(paths, handle?.intentId ?? '', () => withDatabase(paths, database => {
    assertHandle(database, handle);
    database.prepare("UPDATE intent_ownership SET status = 'released' WHERE intent_id = ?").run(handle.intentId);
    return { intentId: handle.intentId, generation: handle.generation, status: 'released' };
  }));
}

export function assertIntentMutation(root, reference, database = null) {
  const paths = intentMutationPaths(root), intentId = resolveIntentMutationReference(paths.projectRoot, reference), active = context.getStore();
  if (!active || active.key !== key(paths.projectRoot, intentId)) intentOwnershipError('intent-mutation-context-required');
  if (!active.open) intentOwnershipError('intent-mutation-context-expired');
  assertMutationAuthority(paths, intentId, active.operation);
  if (database) { assertHandle(database, active.handle); return; }
  return assertIntentOwnership(paths.projectRoot, active.handle);
}

const humanActions = new Set(['approve-build', 'approve-manual-qa', 'ratify-plan', 'ratify-evidence']);
const preparablePhases = new Set(['intent', 'reconcile', 'plan', 'pattern-validation', 'test-plan']);
function assertMutationAuthority(paths, intentId, operation, nested = null) {
  if (nested?.grantDigest && nested.grantDigest !== operation.grantDigest) intentOwnershipError('autonomy-grant-context-mismatch', 403);
  if (!operation.grantDigest) return;
  const policy = readAutonomyPolicy(paths.projectRoot), grant = policy.grant;
  if (policy.status !== 'current' || grant?.digest !== operation.grantDigest) intentOwnershipError('autonomy-grant-not-current');
  if (autonomyDigest(readAutonomyFile(paths.projectRoot, paths.configPath)) !== grant.configDigest) intentOwnershipError('autonomy-grant-policy-changed');
  if (!grant.scope.intentIds.includes(intentId)) intentOwnershipError('autonomy-intent-not-permitted', 403);
  const provider = nested?.provider ?? operation.provider;
  if (provider && !grant.scope.providers.includes(provider)
    || nested?.action === 'begin-harness' && !grant.scope.providers.includes(nested.provider)) intentOwnershipError('autonomy-provider-not-permitted', 403);
  const requested = nested ?? operation;
  if (humanActions.has(requested.action)) intentOwnershipError('autonomy-human-decision-required', 403);
  if (!grant.scope.actions.includes(operation.action) || operation.maxAttempts > grant.scope.limits.maxAttempts) intentOwnershipError('autonomy-action-not-permitted', 403);
  if (operation.action === 'prepare-phase' && !preparablePhases.has(operation.phase)
    || operation.action === 'afk-build' && operation.phase !== 'build') intentOwnershipError('autonomy-phase-not-permitted', 403);
  if (!nested) return;
  if (['update-projection', 'update-phase-projection', 'start-session'].includes(nested.action)) return;
  if (operation.action === 'begin-harness' && nested.action === 'begin-harness') return;
  if (['prepare-phase', 'afk-build'].includes(operation.action)
    && ['record-gate', 'record-validation', 'start-phase', 'complete-phase'].includes(nested.action)
    && nested.phase === operation.phase) return;
  intentOwnershipError('autonomy-action-not-permitted', 403);
}

export function recoverStoppedIntentOwnership(root, owner, intentId) {
  if (!owner || !Number.isInteger(owner.pid) || owner.pid < 1 || !intentPattern.test(intentId ?? '')) intentOwnershipError('intent-recovery-invalid', 422);
  try { process.kill(owner.pid, 0); return; } catch (error) { if (error.code !== 'ESRCH') return; }
  const paths = intentMutationPaths(root), path = safeIntentMutationPath(paths.projectRoot, resolve(paths.ownershipRoot, `${tokenHash(intentId)}.lock`));
  if (existsSync(path)) {
    const before = lstatSync(path), raw = readAutonomyFile(paths.projectRoot, path);
    let lock; try { lock = JSON.parse(raw); } catch { intentOwnershipError('intent-recovery-invalid', 422); }
    if (lock?.schema !== 'ewai.intent-mutex/v1' || lock.intentId !== intentId || lock.pid !== owner.pid || lock.processInstance !== owner.processInstance) intentOwnershipError('intent-recovery-conflict');
    const after = lstatSync(path);
    if (before.ino !== after.ino || before.mtimeMs !== after.mtimeMs) intentOwnershipError('intent-recovery-conflict');
    unlinkSync(path);
  }
  withDatabase(paths, database => database.prepare("UPDATE intent_ownership SET status = 'released' WHERE intent_id = ? AND epoch = ? AND generation = ? AND pid = ? AND process_instance = ?")
    .run(intentId, owner.epoch, owner.generation, owner.pid, owner.processInstance));
}

// Synchronous canonical transitions only. Workers propose outside this critical
// section; acceptance enters it with a still-current ownership capability.
export function withIntentMutation(root, reference, operation, callback) {
  const paths = intentMutationPaths(root), intentId = resolveIntentMutationReference(paths.projectRoot, reference);
  if (typeof callback !== 'function' || !operation || typeof operation !== 'object') intentOwnershipError('intent-mutation-invalid', 422);
  if (callback.constructor?.name === 'AsyncFunction') intentOwnershipError('intent-mutation-must-be-synchronous', 422);
  const active = context.getStore();
  if (active && !active.open) intentOwnershipError('intent-mutation-context-expired');
  if (active?.operation.grantDigest && active.key !== key(paths.projectRoot, intentId)) intentOwnershipError('autonomy-intent-not-permitted', 403);
  if (active?.key === key(paths.projectRoot, intentId)) {
    assertMutationAuthority(paths, intentId, active.operation, normaliseAutonomyOperation(operation));
    if (operation.ownership) assertIntentOwnership(paths.projectRoot, operation.ownership);
    assertIntentMutation(paths.projectRoot, intentId); return synchronousResult(active, callback);
  }
  const description = normaliseAutonomyOperation(operation);
  const existing = inspectAutonomyOperation(paths.projectRoot, intentId, description);
  if (existing.status === 'completed') return { ...existing, replayed: true };
  if (existing.status === 'recovery-required') intentOwnershipError('autonomy-recovery-required');
  assertMutationAuthority(paths, intentId, description);
  const handle = operation.ownership ?? acquireIntentOwnership(paths.projectRoot, intentId, operation);
  const scope = { key: key(paths.projectRoot, intentId), handle, operation: description, open: true, executionStopped: true };
  try {
    return withMutex(paths, intentId, () => context.run(scope, () => {
      try {
        assertIntentMutation(paths.projectRoot, intentId);
        if (handle.intentId !== intentId) intentOwnershipError('intent-ownership-stale');
        assertNoUnresolvedIntentOperation(paths.projectRoot, intentId, description.id);
        const attempt = beginAutonomyOperation(paths.projectRoot, intentId, description, { ...handle, processInstance });
        try {
          const result = synchronousResult(scope, callback);
          assertIntentMutation(paths.projectRoot, intentId);
          const receipt = completeAutonomyOperation(paths.projectRoot, attempt);
          return description.tracked ? { status: 'completed', replayed: false, receipt, result } : result;
        } catch (error) {
          // Raw exceptions and worker output never enter the journal. Unknown
          // asynchronous outcomes cannot be presented as stopped execution.
          try { failAutonomyOperation(paths.projectRoot, attempt, { executionStopped: scope.executionStopped }); } catch {}
          throw error;
        }
      } finally { scope.open = false; }
    }), handle);
  } finally {
    if (!operation.ownership) {
      try { releaseIntentOwnership(paths.projectRoot, handle); }
      catch (error) { if (error.code !== 'intent-ownership-stale') throw error; }
    }
  }
}

function synchronousResult(scope, callback) {
  const result = callback();
  if (result?.then) scope.executionStopped = false;
  if (!scope.executionStopped) intentOwnershipError('intent-mutation-must-be-synchronous', 422);
  return result;
}
