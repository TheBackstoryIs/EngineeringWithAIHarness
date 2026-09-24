import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, lstatSync, openSync, closeSync, fstatSync, readFileSync, writeFileSync, mkdirSync, fsyncSync, constants } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { intentMutationPaths, safeIntentMutationPath, resolveIntentMutationReference, recoverStoppedIntentOwnership, assertIntentMutation } from './intent-ownership.mjs';

const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const actions = new Set(['begin-harness', 'prepare-phase', 'afk-build', 'record-gate', 'record-validation', 'start-phase', 'complete-phase',
  'resume-shelf', 'ratify-plan', 'ratify-evidence', 'approve-build', 'approve-manual-qa', 'update-projection', 'update-phase-projection', 'start-session']);
const digest = value => 'sha256:' + createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');

function fail(code, statusCode = 409) {
  const error = new Error(`Autonomy operation cannot continue: ${code}.`); error.code = code; error.statusCode = statusCode; throw error;
}
function readBytes(paths, path) {
  safeIntentMutationPath(paths.projectRoot, path);
  const before = lstatSync(path);
  if (!before.isFile() || before.size > 16 * 1024 * 1024) fail('autonomy-operation-evidence-limit', 413);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd), bytes = readFileSync(fd), after = fstatSync(fd), current = lstatSync(path);
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.nlink !== 1 || after.nlink !== 1
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs || current.ino !== before.ino || current.mtimeMs !== before.mtimeMs) fail('autonomy-operation-evidence-changed');
    return bytes;
  } finally { closeSync(fd); }
}
function readRecord(paths, path) {
  let record; try { record = JSON.parse(readBytes(paths, path)); } catch (error) { if (error.code?.startsWith('autonomy-')) throw error; fail('autonomy-operation-evidence-invalid', 422); }
  const { digest: expected, ...body } = record ?? {};
  if (!digestPattern.test(expected ?? '') || digest(body) !== expected) fail('autonomy-operation-evidence-invalid', 422);
  return record;
}
function writeRecord(paths, path, body) {
  const record = { ...body, digest: digest(body) };
  safeIntentMutationPath(paths.projectRoot, path); mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  safeIntentMutationPath(paths.projectRoot, path);
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(record, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  const directory = openSync(dirname(path), constants.O_RDONLY);
  try { fsyncSync(directory); } finally { closeSync(directory); }
  return record;
}
function operationPaths(root, operationId) {
  if (!idPattern.test(operationId ?? '')) fail('autonomy-operation-id-invalid', 422);
  const paths = intentMutationPaths(root);
  const operationsRoot = safeIntentMutationPath(paths.projectRoot, resolve(paths.specsRoot, '3.Evidence/autonomy/operations'));
  return { ...paths, operationsRoot, operationRoot: safeIntentMutationPath(paths.projectRoot, resolve(operationsRoot, operationId)) };
}

export function readIntentMutationSnapshot(root, reference) {
  const paths = intentMutationPaths(root), intentId = resolveIntentMutationReference(root, reference), slug = intentId.split('/')[1];
  const amendmentLease = resolve(paths.buildRoot, slug, '.evidence-amendment.lock');
  const files = [], captured = new Map(), directories = new Map(), missing = []; let total = 0;
  const same = (before, after) => before.ino === after.ino && before.dev === after.dev && before.size === after.size
    && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && before.nlink === after.nlink;
  const capture = path => {
    const before = lstatSync(path), bytes = readBytes(paths, path);
    if (!same(before, lstatSync(path))) fail('autonomy-operation-evidence-changed');
    captured.set(path, before); total += bytes.length;
    if (total > 128 * 1024 * 1024) fail('autonomy-operation-evidence-limit', 413);
    return bytes;
  };
  const visit = (path, depth = 0) => {
    safeIntentMutationPath(paths.projectRoot, path);
    // The existing amendment lease is disposable coordination, like SQLite
    // ownership, not canonical evidence whose cleanup requires ratification.
    if (path === amendmentLease) return;
    if (!existsSync(path)) { missing.push(path); return; }
    const stat = lstatSync(path);
    if (depth > 20 || files.length >= 10000) fail('autonomy-operation-evidence-limit', 413);
    if (stat.isDirectory()) {
      const names = readdirSync(path).sort(); directories.set(path, { stat, names });
      for (const entry of names) visit(resolve(path, entry), depth + 1);
    } else {
      files.push({ path: relative(paths.projectRoot, path), digest: digest(capture(path)) });
    }
  };
  visit(paths.configPath);
  for (const extension of ['md', 'json']) visit(resolve(paths.specsRoot, '2.Purpose/intents', `${intentId}.${extension}`));
  visit(resolve(paths.buildRoot, slug));
  const core = files.filter(file => /\/2\.Purpose\/intents\//.test(file.path) || file.path.endsWith('/delivery-state.json'));
  const identity = digest(paths.projectRoot), locator = existsSync(paths.runtimeProjectPath) ? digest(capture(paths.runtimeProjectPath)) : null;
  if (locator === null) missing.push(paths.runtimeProjectPath);
  for (const [path, stat] of captured) {
    safeIntentMutationPath(paths.projectRoot, path);
    if (!existsSync(path) || !same(stat, lstatSync(path))) fail('autonomy-operation-evidence-changed');
  }
  for (const [path, before] of directories) {
    safeIntentMutationPath(paths.projectRoot, path);
    if (!existsSync(path) || !same(before.stat, lstatSync(path)) || JSON.stringify(readdirSync(path).sort()) !== JSON.stringify(before.names)) fail('autonomy-operation-evidence-changed');
  }
  if (missing.some(path => existsSync(path))) fail('autonomy-operation-evidence-changed');
  return { digest: digest({ identity, locator, files }), coreDigest: digest({ identity, locator, files: core }), files };
}

export function normaliseAutonomyOperation(input = {}) {
  if (!actions.has(input.action)) fail('autonomy-operation-action-invalid', 422);
  const id = input.id ?? randomUUID(), maxAttempts = input.maxAttempts ?? 1;
  if (!idPattern.test(id) || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) fail('autonomy-operation-input-invalid', 422);
  if (input.phase !== undefined && (typeof input.phase !== 'string' || !/^[a-z]+(?:-[a-z]+)*$/.test(input.phase))) fail('autonomy-operation-input-invalid', 422);
  if (input.provider !== undefined && (typeof input.provider !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(input.provider))) fail('autonomy-operation-input-invalid', 422);
  const inputDigest = input.inputDigest ?? digest({ action: input.action, phase: input.phase ?? null, provider: input.provider ?? null, input: input.input ?? null });
  if (!digestPattern.test(inputDigest) || input.grantDigest !== undefined && input.grantDigest !== null && !digestPattern.test(input.grantDigest)
    || input.expectedPredecessor !== undefined && !digestPattern.test(input.expectedPredecessor)) fail('autonomy-operation-input-invalid', 422);
  return { id, action: input.action, phase: input.phase ?? null, provider: input.provider ?? null, inputDigest, grantDigest: input.grantDigest ?? null, maxAttempts,
    expectedPredecessor: input.expectedPredecessor ?? null, tracked: input.id !== undefined };
}

function readAttempts(paths, operationId) {
  const directory = safeIntentMutationPath(paths.projectRoot, resolve(paths.operationRoot, 'attempts'));
  if (!existsSync(directory)) return [];
  const names = readdirSync(directory);
  if (names.length > 100 || names.some(name => !/^[1-9]\d*\.json$/.test(name))) fail('autonomy-operation-evidence-invalid', 422);
  const attempts = names.sort((a, b) => parseInt(a) - parseInt(b)).map(name => readRecord(paths, resolve(directory, name)));
  attempts.forEach((attempt, index) => {
    if (attempt.schema !== 'ewai.autonomy-operation/v1' || attempt.operationId !== operationId || attempt.attempt !== index + 1
      || attempt.previousDigest !== (attempts[index - 1]?.digest ?? null) || !actions.has(attempt.action)
      || !digestPattern.test(attempt.inputDigest) || attempt.projectIdentity !== digest(paths.projectRoot)
      || !Number.isSafeInteger(attempt.maxAttempts) || attempt.maxAttempts < 1 || attempt.maxAttempts > 100
      || !Number.isInteger(attempt.owner?.pid) || attempt.owner.pid < 1 || typeof attempt.owner.processInstance !== 'string') fail('autonomy-operation-evidence-invalid', 422);
    if (index && ['intentId', 'action', 'phase', 'provider', 'inputDigest', 'grantDigest', 'maxAttempts', 'tracked'].some(key => JSON.stringify(attempt[key]) !== JSON.stringify(attempts[0][key]))) fail('autonomy-operation-evidence-invalid', 422);
  });
  return attempts;
}
function checkIdentity(attempt, intentId, operation) {
  if (attempt && (attempt.intentId !== intentId || ['action', 'phase', 'provider', 'inputDigest', 'grantDigest', 'maxAttempts', 'tracked'].some(key => attempt[key] !== operation[key])
    || operation.expectedPredecessor && operation.expectedPredecessor !== attempt.predecessor.digest)) fail('autonomy-operation-conflict');
}
function stopped(attempt, outcome) {
  if (outcome?.executionStopped === true) return true;
  try { process.kill(attempt.owner.pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH'; }
}

export function reconcileAutonomyOperation(root, operationId) {
  const paths = operationPaths(root, operationId), attempts = readAttempts(paths, operationId), attempt = attempts.at(-1);
  if (!attempt) return { status: 'not-found', operationId, requiresHuman: true, reasons: ['operation-journal-missing'] };
  const receiptPath = safeIntentMutationPath(paths.projectRoot, resolve(paths.operationRoot, 'receipts', `${attempt.attempt}.json`));
  const outcomePath = safeIntentMutationPath(paths.projectRoot, resolve(paths.operationRoot, 'outcomes', `${attempt.attempt}.json`));
  const current = readIntentMutationSnapshot(root, attempt.intentId);
  const common = { operationId, intentId: attempt.intentId, attempt: attempt.attempt };
  if (existsSync(receiptPath)) {
    const receipt = readRecord(paths, receiptPath);
    if (receipt.schema !== 'ewai.autonomy-operation-receipt/v1' || receipt.operationDigest !== attempt.digest
      || receipt.operationId !== operationId || receipt.attempt !== attempt.attempt || receipt.inputDigest !== attempt.inputDigest
      || receipt.grantDigest !== attempt.grantDigest || receipt.intentId !== attempt.intentId) fail('autonomy-operation-evidence-invalid', 422);
    return receipt.result.digest === current.digest
      ? { ...common, status: 'completed', requiresHuman: false, reasons: [], receipt }
      : { ...common, status: 'recovery-required', requiresHuman: true, reasons: ['canonical-receipt-changed'] };
  }
  const outcome = existsSync(outcomePath) ? readRecord(paths, outcomePath) : null;
  if (outcome && (outcome.schema !== 'ewai.autonomy-operation-outcome/v1' || outcome.operationDigest !== attempt.digest)) fail('autonomy-operation-evidence-invalid', 422);
  const reasons = [];
  if (current.digest !== attempt.predecessor.digest) reasons.push('canonical-predecessor-changed');
  if (!stopped(attempt, outcome)) reasons.push('execution-not-confirmed-stopped');
  if (attempt.attempt >= attempt.maxAttempts) reasons.push('attempts-exhausted');
  return { ...common, status: reasons.length ? 'recovery-required' : 'retryable', requiresHuman: reasons.length > 0, reasons };
}

export function inspectAutonomyOperation(root, intentId, operation) {
  const paths = operationPaths(root, operation.id), attempts = readAttempts(paths, operation.id);
  checkIdentity(attempts[0], intentId, operation);
  const state = reconcileAutonomyOperation(root, operation.id);
  if (state.status === 'retryable') recoverStoppedIntentOwnership(root, attempts.at(-1).owner, intentId);
  return state;
}

// Recovery may acknowledge an already completed synchronous mutation, but
// cannot infer provider termination or repeat a side effect from parent death.
export function recoverCompletedAutonomyOperation(root, operationId, expected) {
  const paths = operationPaths(root, operationId), attempt = readAttempts(paths, operationId).at(-1);
  if (!attempt || expected?.action !== 'begin-harness' || ['action', 'intentId', 'grantDigest'].some(key => attempt[key] !== expected[key])) {
    return { status: 'recovery-required', operationId, requiresHuman: true };
  }
  const reconciled = reconcileAutonomyOperation(root, operationId);
  if (reconciled.status !== 'completed' || reconciled.receipt.action !== attempt.action) return { status: 'recovery-required', operationId, requiresHuman: true };
  recoverStoppedIntentOwnership(root, attempt.owner, attempt.intentId);
  return { status: 'completed', operationId, requiresHuman: false };
}

// A new identifier is not a recovery decision. Completed receipts may be
// historical, but an uncertain attempt still owns the intent's recovery work.
export function assertNoUnresolvedIntentOperation(root, intentId, operationId) {
  const base = operationPaths(root, operationId);
  if (!existsSync(base.operationsRoot)) return;
  const ids = readdirSync(base.operationsRoot);
  if (ids.length > 10000 || ids.some(id => !idPattern.test(id))) fail('autonomy-operation-evidence-invalid', 422);
  for (const id of ids) {
    if (id === operationId) continue;
    const paths = operationPaths(root, id), attempt = readAttempts(paths, id).at(-1);
    if (!attempt || attempt.intentId !== intentId) continue;
    const receiptPath = resolve(paths.operationRoot, 'receipts', `${attempt.attempt}.json`);
    if (existsSync(receiptPath)) {
      const receipt = readRecord(paths, receiptPath);
      if (receipt.schema !== 'ewai.autonomy-operation-receipt/v1' || receipt.operationDigest !== attempt.digest) fail('autonomy-operation-evidence-invalid', 422);
      continue;
    }
    const outcomePath = resolve(paths.operationRoot, 'outcomes', `${attempt.attempt}.json`);
    const outcome = existsSync(outcomePath) ? readRecord(paths, outcomePath) : null;
    if (outcome && (outcome.schema !== 'ewai.autonomy-operation-outcome/v1' || outcome.operationDigest !== attempt.digest)) fail('autonomy-operation-evidence-invalid', 422);
    // Only allowlisted checker reports are harmless diagnostic changes. Runs,
    // gate ledgers and all other durable evidence retain recovery ownership.
    if (!attempt.tracked && outcome?.executionStopped === true && outcome.diagnosticOnly === true) continue;
    fail('autonomy-recovery-required');
  }
}

export function beginAutonomyOperation(root, intentId, operation, owner) {
  const paths = operationPaths(root, operation.id), attempts = readAttempts(paths, operation.id);
  checkIdentity(attempts[0], intentId, operation);
  const state = reconcileAutonomyOperation(root, operation.id);
  if (!['not-found', 'retryable'].includes(state.status)) fail(state.status === 'completed' ? 'autonomy-operation-conflict' : 'autonomy-recovery-required');
  const predecessor = readIntentMutationSnapshot(root, intentId);
  if (operation.expectedPredecessor && operation.expectedPredecessor !== predecessor.digest) fail('autonomy-predecessor-stale');
  const attempt = attempts.length + 1;
  assertIntentMutation(root, intentId);
  return writeRecord(paths, resolve(paths.operationRoot, 'attempts', `${attempt}.json`), {
    schema: 'ewai.autonomy-operation/v1', operationId: operation.id, intentId, action: operation.action, phase: operation.phase, provider: operation.provider,
    inputDigest: operation.inputDigest, grantDigest: operation.grantDigest, maxAttempts: operation.maxAttempts, tracked: operation.tracked,
    predecessor, attempt, previousDigest: attempts.at(-1)?.digest ?? null, projectIdentity: digest(paths.projectRoot),
    owner: { epoch: owner.epoch, generation: owner.generation, ownerId: owner.ownerId, pid: process.pid, processInstance: owner.processInstance },
    startedAt: new Date().toISOString(),
  });
}

export function completeAutonomyOperation(root, attempt) {
  const paths = operationPaths(root, attempt.operationId), result = readIntentMutationSnapshot(root, attempt.intentId);
  assertIntentMutation(root, attempt.intentId);
  return writeRecord(paths, resolve(paths.operationRoot, 'receipts', `${attempt.attempt}.json`), {
    schema: 'ewai.autonomy-operation-receipt/v1', operationId: attempt.operationId, operationDigest: attempt.digest,
    intentId: attempt.intentId, action: attempt.action, inputDigest: attempt.inputDigest, grantDigest: attempt.grantDigest,
    attempt: attempt.attempt, owner: attempt.owner, result, completedAt: new Date().toISOString(),
  });
}

export function failAutonomyOperation(root, attempt, { executionStopped = true } = {}) {
  const paths = operationPaths(root, attempt.operationId), result = readIntentMutationSnapshot(root, attempt.intentId);
  const before = new Map(attempt.predecessor.files.map(file => [file.path, file.digest]));
  const after = new Map(result.files.map(file => [file.path, file.digest]));
  const changes = [...new Set([...before.keys(), ...after.keys()])].filter(path => before.get(path) !== after.get(path));
  const diagnosticOnly = result.coreDigest === attempt.predecessor.coreDigest && changes.every(path =>
    /\/gates\/[a-z-]+\/(?:phase-gate-check\.md|task-graph-check\.(?:md|json))$/.test(path));
  return writeRecord(paths, resolve(paths.operationRoot, 'outcomes', `${attempt.attempt}.json`), {
    schema: 'ewai.autonomy-operation-outcome/v1', operationId: attempt.operationId, operationDigest: attempt.digest,
    executionStopped, canonicalChanged: result.digest !== attempt.predecessor.digest,
    coreChanged: result.coreDigest !== attempt.predecessor.coreDigest,
    diagnosticOnly,
    resultDigest: result.digest, finishedAt: new Date().toISOString(),
  });
}
