import { resolve, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { readAutonomyPolicy, previewAutonomy, revokeAutonomyGrant } from '../autonomy.mjs';
import { beginDelivery } from '../delivery.mjs';
import { finishActiveSession } from './work.mjs';
import { autonomyPaths, autonomyFiles, autonomyDigest, autonomyError, readAutonomyFile,
  writeAutonomyRecord, withAutonomyLock, readAutonomyRepositoryState, readAutonomySnapshot } from './autonomy-workspace.mjs';
import { withIntentMutation, acquireIntentOwnership, assertIntentOwnership, releaseIntentOwnership } from './intent-ownership.mjs';
import { readIntentMutationSnapshot, recoverCompletedAutonomyOperation } from './autonomy-operations.mjs';
import { prepareAutonomyPhase, invokePhaseProposal, acceptPhaseProposal } from './autonomy-workers.mjs';
import { preparePhaseProvider, verifyPhaseProviderConformance } from './provider-adapters.mjs';
import { preflightAfkRun, startAfkRun, resumeAfkRun, pauseAfkRun, cancelAfkRun, afkRunStatus } from './afk-conductor.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const terminal = new Set(['completed', 'cancelled', 'revoked', 'expired', 'blocked']);
const statuses = new Set([...terminal, 'starting', 'running', 'paused', 'awaiting-human', 'cancel-requested', 'recovery-required']);
const live = new Map();
const failureCode = error => /^(?:autonomy|phase)-[a-z0-9-]+$/.test(error?.code ?? '') ? error.code : 'autonomy-operation-failed';
function inputKeys(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype
    || Object.keys(input).some(key => !allowed.includes(key))) autonomyError('autonomy-invalid-input', 400);
}
function named(value) { return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 120 && !/[\x00-\x1f\x7f]/.test(value); }
function pathsFor(root, id) {
  if (id !== undefined && !uuid.test(id)) autonomyError('autonomy-run-id-invalid', 400);
  // Runtime control is durable across projection rebuilds, but is not source
  // code or authority. Canonical effects retain their separate SPECS receipts.
  const paths = autonomyPaths(root), runsRoot = resolve(paths.controlRoot, 'supervisor/runs');
  return { ...paths, runsRoot, runRoot: id ? resolve(runsRoot, id) : null };
}
function record(paths, path, body) { const value = { ...body, digest: autonomyDigest(body) }; writeAutonomyRecord(paths.projectRoot, path, value); return value; }
function readRecord(paths, path) {
  let value;
  try { value = JSON.parse(readAutonomyFile(paths.projectRoot, path)); }
  catch { autonomyError('autonomy-run-evidence-invalid'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) autonomyError('autonomy-run-evidence-invalid');
  const { digest, ...body } = value;
  if (digest !== autonomyDigest(body)) autonomyError('autonomy-run-evidence-invalid');
  return value;
}
function readRun(root, id) {
  const paths = pathsFor(root, id), files = autonomyFiles(paths.projectRoot, resolve(paths.runRoot, 'revisions'));
  if (!files.length) autonomyError('autonomy-run-not-found', 404);
  if (files.length > 4096) autonomyError('autonomy-run-evidence-limit');
  const records = files.map(path => ({ path, value: readRecord(paths, path) })).sort((a, b) => a.value.revision - b.value.revision);
  records.forEach(({ path, value }, index) => {
    inputKeys(value, ['schema', 'id', 'revision', 'previousDigest', 'projectIdentity', 'mode', 'provider', 'grantDigest', 'status',
      'desiredState', 'startedAt', 'updatedAt', 'lastClock', 'counters', 'owner', 'current', 'lastResult', 'questions', 'code',
      'cancellation', 'executionStopped', 'requiresHuman', 'ownedFiles', 'repositoryIdentity', 'digest']);
    if (value.schema !== 'ewai.autonomy-run/v1' || value.id !== id || value.revision !== index + 1
      || value.previousDigest !== (records[index - 1]?.value.digest ?? null)
      || value.projectIdentity !== autonomyDigest(paths.projectRoot)
      || !path.endsWith(`/${value.revision}-${value.digest.slice(7)}.json`)) autonomyError('autonomy-run-evidence-invalid');
    if (!statuses.has(value.status) || !['once', 'service'].includes(value.mode) || !['running', 'paused', 'cancelled', 'revoked'].includes(value.desiredState)
      || !digestPattern.test(value.grantDigest ?? '') || !['claude', 'codex', 'antigravity'].includes(value.provider)
      || !Number.isSafeInteger(value.owner?.pid) || value.owner.pid < 1 || !uuid.test(value.owner?.instance ?? '')
      || !Number.isSafeInteger(value.lastClock) || !Number.isFinite(Date.parse(value.startedAt)) || !Number.isFinite(Date.parse(value.updatedAt))
      || !value.counters || Object.keys(value.counters).sort().join(',') !== 'actions,elapsedMs,providerAttempts,reviewCycles'
      || Object.values(value.counters).some(count => !Number.isSafeInteger(count) || count < 0)
      || typeof value.executionStopped !== 'boolean' || typeof value.requiresHuman !== 'boolean'
      || !Array.isArray(value.questions) || value.questions.length > 100
      || !Array.isArray(value.ownedFiles) || value.ownedFiles.length > 4096
      || value.ownedFiles.some(file => typeof file.path !== 'string' || file.path.startsWith('/') || file.path.split('/').includes('..') || !digestPattern.test(file.digest ?? ''))
      || value.repositoryIdentity !== null && !digestPattern.test(value.repositoryIdentity ?? '')) autonomyError('autonomy-run-evidence-invalid');
    const intentId = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
    if (value.current !== null) {
      inputKeys(value.current, ['intentId', 'phase', 'action', 'sortKey', 'reasons', 'operationId', 'workerOperationId', 'afkRunId']);
      if (!intentId(value.current.intentId) || !['begin-harness', 'prepare-phase', 'afk-build'].includes(value.current.action)
        || !uuid.test(value.current.operationId ?? '')) autonomyError('autonomy-run-evidence-invalid');
    }
    if (value.lastResult !== null) {
      inputKeys(value.lastResult, ['status', 'operationId', 'intentId', 'phase', 'phaseCompleted', 'afkRunId']);
      if (!intentId(value.lastResult.intentId) || !['harness-started', 'draft-staged', 'afk-settled', 'reconciled'].includes(value.lastResult.status)) autonomyError('autonomy-run-evidence-invalid');
    }
    for (const q of value.questions) {
      inputKeys(q, ['id', 'intentId', 'phase', 'owner', 'sourceRevision', 'codes', 'authority']);
      if (!/^[a-f0-9]{64}$/.test(q.id ?? '') || !intentId(q.intentId) || !named(q.owner) || q.authority !== 'none'
        || !digestPattern.test(q.sourceRevision ?? '') || !Array.isArray(q.codes) || q.codes.some(code => !/^[a-z0-9-]{1,100}$/.test(code))) autonomyError('autonomy-run-evidence-invalid');
    }
    if (index && (value.grantDigest !== records[0].value.grantDigest || value.mode !== records[0].value.mode
      || Object.keys(value.counters).some(key => value.counters[key] < records[index - 1].value.counters[key]))) autonomyError('autonomy-run-history-invalid');
  });
  return records.at(-1).value;
}
function listRuns(root) {
  const paths = pathsFor(root), ids = new Set(autonomyFiles(paths.projectRoot, paths.runsRoot).map(path => path.slice(paths.runsRoot.length + 1).split('/')[0]));
  if (ids.size > 256) autonomyError('autonomy-run-evidence-limit');
  return [...ids].map(id => readRun(root, id));
}
function save(paths, previous, changes) {
  const { digest: oldDigest, ...old } = previous;
  const body = { ...old, ...changes, revision: previous.revision + 1, previousDigest: oldDigest,
    updatedAt: new Date().toISOString() };
  return record(paths, resolve(paths.runRoot, 'revisions', `${body.revision}-${autonomyDigest(body).slice(7)}.json`), body);
}
function update(root, id, callback) {
  const paths = pathsFor(root, id);
  return withAutonomyLock(paths, () => { const current = readRun(root, id); return save(paths, current, callback(current)); });
}
function safeRun(run) {
  return { schema: run.schema, id: run.id, revision: run.revision, digest: run.digest, mode: run.mode, status: run.status,
    desiredState: run.desiredState, grantDigest: run.grantDigest, provider: run.provider, startedAt: run.startedAt,
    updatedAt: run.updatedAt, counters: run.counters, usage: { providerReported: null, hardMoneyCap: false },
    current: run.current, lastResult: run.lastResult, questions: run.questions, code: run.code,
    cancellation: run.cancellation, executionStopped: run.executionStopped, requiresHuman: run.requiresHuman,
    lifetime: { kind: run.mode, ownerProcessId: run.owner.pid, ownerProcessAlive: ownerAlive(run) },
    authority: 'bounded-grant-only', phaseCompleted: false };
}
function ownerAlive(run) { try { process.kill(run.owner.pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } }
export function readAutonomyRun(root, id) {
  const run = readRun(root, id), safe = safeRun(run);
  return !terminal.has(run.status) && ['starting', 'running', 'cancel-requested'].includes(run.status) && !ownerAlive(run)
    ? { ...safe, status: 'recovery-required', requiresHuman: true, code: 'autonomy-owner-lost' } : safe;
}

function currentGrant(root, expected) {
  const policy = readAutonomyPolicy(root);
  if (policy.status !== 'current' || policy.grant?.digest !== expected) autonomyError(`autonomy-grant-${policy.status === 'current' ? 'stale' : policy.status}`);
  if (Date.now() < Date.parse(policy.grant.approvedAt)) autonomyError('autonomy-clock-rollback');
  const paths = autonomyPaths(root);
  if (autonomyDigest(readAutonomyFile(paths.projectRoot, paths.configPath)) !== policy.grant.configDigest) autonomyError('autonomy-grant-policy-changed');
  return policy.grant;
}
function createRun(root, input, mode) {
  inputKeys(input, mode === 'service' ? ['expectedDigest', 'provider', 'confirmed'] : ['expectedDigest', 'provider']);
  if (!digestPattern.test(input.expectedDigest) || mode === 'service' && input.confirmed !== true) autonomyError('autonomy-run-confirmation-required');
  const paths = pathsFor(root);
  return withAutonomyLock(paths, () => {
    const grant = currentGrant(root, input.expectedDigest);
    if (!grant.scope.providers.includes(input.provider)) autonomyError('autonomy-provider-not-permitted');
    if (listRuns(root).some(run => !terminal.has(run.status))) autonomyError('autonomy-supervisor-busy');
    const id = randomUUID(), at = Date.now();
    const run = { schema: 'ewai.autonomy-run/v1', id, revision: 1, previousDigest: null,
      projectIdentity: autonomyDigest(paths.projectRoot), mode, provider: input.provider, grantDigest: grant.digest,
      status: 'starting', desiredState: 'running', startedAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString(),
      lastClock: at, counters: { elapsedMs: 0, providerAttempts: 0, reviewCycles: 0, actions: 0 },
      owner: { pid: process.pid, instance: randomUUID() }, current: null, lastResult: null, questions: [],
      code: null, cancellation: null, executionStopped: true, requiresHuman: false };
    run.ownedFiles = []; run.repositoryIdentity = null;
    return record(paths, resolve(paths.runsRoot, id, 'revisions', `1-${autonomyDigest(run).slice(7)}.json`), run);
  });
}
function budget(root, run, elapsed = run.counters.elapsedMs) {
  const grant = currentGrant(root, run.grantDigest), prior = listRuns(root).filter(other => other.id !== run.id && other.grantDigest === run.grantDigest);
  const used = prior.reduce((sum, other) => ({ elapsedMs: sum.elapsedMs + other.counters.elapsedMs,
    providerAttempts: sum.providerAttempts + other.counters.providerAttempts }), { elapsedMs: elapsed, providerAttempts: run.counters.providerAttempts });
  if (Date.now() < Math.max(run.lastClock, ...prior.map(other => other.lastClock))) autonomyError('autonomy-clock-rollback');
  if (used.elapsedMs >= grant.scope.limits.maxRuntimeMs) autonomyError('autonomy-runtime-exhausted');
  return { grant, remainingMs: grant.scope.limits.maxRuntimeMs - used.elapsedMs,
    remainingAttempts: grant.scope.limits.maxAttempts - used.providerAttempts };
}
function repositoryReady(root, run) {
  const repository = readAutonomyRepositoryState(root, run.ownedFiles);
  if (repository.status !== 'ready') autonomyError(repository.reasons[0]);
  if (run.repositoryIdentity && run.repositoryIdentity !== repository.digest) autonomyError('autonomy-repository-changed');
  return repository;
}
function question(root, run, candidate, codes) {
  const paths = pathsFor(root, run.id), snapshot = readIntentMutationSnapshot(root, candidate.intentId), grant = readAutonomyPolicy(root).grant;
  const body = { schema: 'ewai.autonomy-question/v1', intentId: candidate.intentId, phase: candidate.phase,
    grantDigest: run.grantDigest, sourceRevision: snapshot.digest, owner: grant.approvedBy,
    codes: [...new Set(codes)].sort(), authority: 'none' };
  const id = autonomyDigest(body).slice(7);
  record(paths, resolve(paths.authorityRoot, 'supervisor/questions', `${id}.json`), { ...body, id });
  return { id, intentId: body.intentId, phase: body.phase, owner: body.owner, sourceRevision: body.sourceRevision, codes: body.codes, authority: 'none' };
}
export function answerAutonomyQuestion(root, input) {
  inputKeys(input, ['runId', 'questionId', 'expectedRevision', 'answeredBy', 'answer']);
  if (!/^[a-f0-9]{64}$/.test(input.questionId ?? '') || !named(input.answeredBy)
    || typeof input.answer !== 'string' || !input.answer.trim() || Buffer.byteLength(input.answer) > 16384) autonomyError('autonomy-answer-invalid', 400);
  const paths = pathsFor(root, input.runId);
  return withAutonomyLock(paths, () => {
    const run = readRun(root, input.runId);
    if (run.revision !== input.expectedRevision) autonomyError('autonomy-run-stale');
    const q = run.questions.find(value => value.id === input.questionId);
    if (!q || q.owner !== input.answeredBy) autonomyError('autonomy-question-owner-required');
    if (readIntentMutationSnapshot(root, q.intentId).digest !== q.sourceRevision) autonomyError('autonomy-question-stale');
    const body = { schema: 'ewai.autonomy-answer/v1', questionId: q.id, sourceRevision: q.sourceRevision,
      answeredBy: input.answeredBy, answer: input.answer, recordedAt: new Date().toISOString(), authority: 'none' };
    const result = record(paths, resolve(paths.authorityRoot, 'supervisor/answers', q.id, `${autonomyDigest(body).slice(7)}.json`), body);
    return { status: 'recorded', questionId: q.id, digest: result.digest, authority: 'none', approvalRecorded: false };
  });
}

export function controlAutonomyRun(root, input) {
  inputKeys(input, ['runId', 'action', 'expectedRevision', 'confirmed', 'revokedBy']);
  if (!['pause', 'cancel', 'resume', 'revoke', 'recover'].includes(input.action) || !Number.isSafeInteger(input.expectedRevision)) autonomyError('autonomy-control-invalid', 400);
  const paths = pathsFor(root, input.runId);
  // Grant revocation owns its own authority lock; never nest that lock.
  if (input.action === 'revoke') {
    const run = readRun(root, input.runId);
    if (run.revision !== input.expectedRevision) autonomyError('autonomy-run-stale');
    revokeAutonomyGrant(root, { expectedDigest: run.grantDigest, confirmed: input.confirmed, revokedBy: input.revokedBy });
  }
  const result = withAutonomyLock(paths, () => {
    const run = readRun(root, input.runId);
    if (input.action !== 'revoke' && run.revision !== input.expectedRevision) autonomyError('autonomy-run-stale');
    if (input.action === 'revoke' && terminal.has(run.status)) return run;
    if (terminal.has(run.status)) autonomyError('autonomy-run-terminal');
    if (input.action === 'recover') {
      if (live.has(`${paths.projectRoot}:${run.id}`) || ownerAlive(run)) autonomyError('autonomy-owner-still-active');
      const operation = run.current;
      // Parent death is not proof that a provider or its descendants stopped.
      // Only a matching canonical receipt for synchronous begin is conclusive.
      const recovered = operation?.action === 'begin-harness'
        ? recoverCompletedAutonomyOperation(root, operation.operationId, { intentId: operation.intentId, grantDigest: run.grantDigest, action: operation.action }) : null;
      const complete = recovered?.status === 'completed';
      return save(paths, run, { status: complete ? 'completed' : 'recovery-required', requiresHuman: !complete,
        executionStopped: complete, current: complete ? null : run.current, code: complete ? null : 'autonomy-execution-unknown',
        lastResult: complete ? { status: 'reconciled', operationId: operation.operationId, intentId: operation.intentId } : run.lastResult,
        counters: { ...run.counters, elapsedMs: run.counters.elapsedMs + Math.max(0, Date.now() - run.lastClock) }, lastClock: Math.max(Date.now(), run.lastClock) });
    }
    if (input.action === 'resume') {
      if (!['paused', 'awaiting-human'].includes(run.status) || run.executionStopped !== true
        || live.has(`${paths.projectRoot}:${run.id}`) || run.owner.pid !== process.pid && ownerAlive(run)) autonomyError('autonomy-recovery-required');
      budget(root, run);
      if (run.questions.some(q => readIntentMutationSnapshot(root, q.intentId).digest === q.sourceRevision)) autonomyError('autonomy-canonical-decision-required');
      const repository = readAutonomyRepositoryState(root);
      if (repository.status !== 'ready') autonomyError(repository.reasons[0]);
      return save(paths, run, { status: 'starting', desiredState: 'running', owner: { pid: process.pid, instance: randomUUID() },
        repositoryIdentity: repository.digest, ownedFiles: [], lastClock: Date.now(), questions: [], code: null });
    }
    const desiredState = input.action === 'pause' ? 'paused' : input.action === 'cancel' ? 'cancelled' : 'revoked';
    const status = run.executionStopped ? desiredState : input.action === 'pause' ? 'running' : 'cancel-requested';
    return save(paths, run, { desiredState, status, cancellation: input.action === 'pause' ? run.cancellation
      : { status: run.executionStopped ? 'confirmed' : 'requested', requestedAt: new Date().toISOString() } });
  });
  const active = live.get(`${paths.projectRoot}:${input.runId}`);
  if (['cancel', 'revoke'].includes(input.action)) active?.controller?.abort();
  const afkId = active?.afkId ?? result.current?.afkRunId;
  if (afkId && ['pause', 'cancel', 'revoke'].includes(input.action)) {
    try {
      const afk = afkRunStatus(root, afkId);
      if (afk.autonomy?.runId !== result.id || afk.autonomy?.grantDigest !== result.grantDigest) autonomyError('autonomy-afk-owner-mismatch');
      if (input.action === 'pause') pauseAfkRun(root, afkId);
      else cancelAfkRun(root, afkId);
    } catch (error) { autonomyError(failureCode(error)); }
  }
  if (input.action === 'resume') return result.mode === 'service' ? launchService(root, result) : executeAutonomyRun(root, result.id);
  return safeRun(result);
}

function assertBuild(root, candidate, initial = false) {
  const paths = autonomyPaths(root), directory = resolve(paths.buildRoot, candidate.intentId.split('/')[1]);
  const state = JSON.parse(readAutonomyFile(paths.projectRoot, resolve(directory, 'delivery-state.json')));
  const approval = JSON.parse(readAutonomyFile(paths.projectRoot, resolve(directory, 'gates/build/build-approval.json')));
  if (approval.schema !== 'ewai.build-approval/v1' || approval.decision !== 'approved' || !named(approval.approvedBy)
    || !approval.scope || state.approvals?.build?.approvedAt !== approval.approvedAt
    || state.approvals?.build?.approvedBy !== approval.approvedBy || state.approvals?.build?.scope !== approval.scope) autonomyError('autonomy-build-approval-stale');
  const item = readAutonomySnapshot(root).items.find(item => item.intentId === candidate.intentId);
  if (!item?.accepted || !item.execution.valid || !item.execution.actions.enterBuild.permitted || initial && !item.execution.actions.acquireTask.permitted) autonomyError('autonomy-build-not-ready');
}

export async function executeAutonomyRun(root, id) {
  const initial = readRun(root, id), paths = pathsFor(root, id), key = `${paths.projectRoot}:${id}`;
  if (initial.status !== 'starting' || initial.owner.pid !== process.pid || live.has(key)) autonomyError('autonomy-run-owner-required');
  const active = { controller: null, afkId: null, executionStopped: true, proposal: null, operationDeadline: null }, start = performance.now(), initialElapsed = initial.counters.elapsedMs;
  live.set(key, active);
  const elapsed = () => initialElapsed + Math.max(0, performance.now() - start, Date.now() - initial.lastClock);
  const check = () => {
    const run = readRun(root, id);
    if (run.owner.instance !== initial.owner.instance || run.owner.pid !== process.pid) autonomyError('autonomy-run-owner-stale');
    if (['cancelled', 'revoked'].includes(run.desiredState)) { active.controller?.abort(); autonomyError(`autonomy-run-${run.desiredState}`); }
    if (active.operationDeadline !== null && performance.now() >= active.operationDeadline) { active.controller?.abort(); autonomyError('autonomy-operation-timeout'); }
    return { run, ...budget(root, run, elapsed()) };
  };
  const settle = (changes = {}) => update(root, id, run => ({ ...changes, counters: { ...run.counters, elapsedMs: Math.ceil(elapsed()) }, lastClock: Math.max(run.lastClock, Date.now()) }));
  let timer;
  try {
    settle({ status: 'running' });
    while (true) {
      const { run, grant, remainingMs, remainingAttempts } = check();
      if (run.desiredState === 'paused') return safeRun(settle({ status: 'paused', executionStopped: true }));
      const preview = previewAutonomy(root), candidate = run.current?.afkRunId ? run.current : preview.executable[0];
      if (!candidate) {
        const pending = [...preview.humanDecisions, ...preview.blocked].find(item => grant.scope.intentIds.includes(item.intentId));
        const questions = pending ? [question(root, run, pending, pending.reasons.map(reason => reason.code))] : [];
        return safeRun(settle({ status: questions.length ? 'awaiting-human' : 'completed', questions, requiresHuman: questions.length > 0, executionStopped: true }));
      }
      const repository = repositoryReady(root, run);
      const operationId = candidate.afkRunId ? candidate.operationId : randomUUID();
      settle({ current: { ...candidate, operationId }, executionStopped: false, repositoryIdentity: repository.digest });
      active.controller = new AbortController();
      active.operationDeadline = performance.now() + Math.min(remainingMs, grant.scope.limits.maxOperationMs);
      timer = setInterval(() => { try { check(); } catch { active.controller?.abort(); } }, 50);
      let result;
      if (candidate.action === 'begin-harness') {
        const predecessor = readIntentMutationSnapshot(root, candidate.intentId).digest;
        check();
        const mutation = withIntentMutation(root, candidate.intentId, { id: operationId, action: 'begin-harness', provider: run.provider,
          grantDigest: grant.digest, expectedPredecessor: predecessor }, () => {
          check();
          const begun = beginDelivery(root, candidate.intentId.split('/')[1], { tool: run.provider });
          finishActiveSession(root, candidate.intentId, { ownerId: begun.run.id, tool: run.provider, summary: 'Autonomous bounded harness start complete.' });
          return { status: 'harness-started', operationId, intentId: candidate.intentId, phaseCompleted: false };
        });
        result = mutation.result;
        const operationFiles = autonomyFiles(paths.projectRoot, resolve(paths.authorityRoot, 'operations', operationId));
        update(root, id, value => ({ ownedFiles: [...new Map([...value.ownedFiles, ...mutation.receipt.result.files,
          ...operationFiles.map(path => ({ path: relative(paths.projectRoot, path), digest: autonomyDigest(readAutonomyFile(paths.projectRoot, path)) }))]
          .map(file => [file.path, file])).values()] }));
      } else if (candidate.action === 'prepare-phase') {
        if (remainingAttempts < 1) autonomyError('autonomy-attempts-exhausted');
        if (remainingMs < grant.scope.limits.maxOperationMs) autonomyError('autonomy-runtime-reservation-unavailable');
        const adapter = preparePhaseProvider(run.provider);
        if (adapter.status === 'unavailable') autonomyError(adapter.code);
        active.executionStopped = false;
        const verified = await verifyPhaseProviderConformance(adapter, { signal: active.controller.signal,
          timeoutMs: Math.max(100, Math.min(600000, Math.floor(active.operationDeadline - performance.now()))) });
        active.executionStopped = verified.executionStopped !== false;
        if (verified.status !== 'verified') autonomyError(verified.code ?? 'autonomy-provider-unavailable');
        check(); repositoryReady(root, readRun(root, id));
        const contract = prepareAutonomyPhase(root, candidate.intentId, candidate.phase);
        if (contract.status !== 'prepared') autonomyError(contract.code);
        update(root, id, current => ({ current: { ...current.current, workerOperationId: contract.operationId },
          counters: { ...current.counters, providerAttempts: current.counters.providerAttempts + 1 } }));
        active.executionStopped = false;
        const proposed = await invokePhaseProposal(contract, adapter, { signal: active.controller.signal });
        active.executionStopped = proposed.executionStopped !== false;
        if (proposed.status === 'draft-ready') active.proposal = { operationId: contract.operationId, result: proposed };
        if (proposed.executionStopped === false) autonomyError('autonomy-execution-unknown');
        check();
        if (proposed.status !== 'draft-ready') autonomyError(proposed.code ?? 'autonomy-phase-not-ready');
        // Worker drafts are isolated evidence, not writes into application code.
        const workerFiles = autonomyFiles(paths.projectRoot, resolve(paths.authorityRoot, 'phase-workers', contract.operationId))
          .map(path => ({ path: relative(paths.projectRoot, path), digest: autonomyDigest(readAutonomyFile(paths.projectRoot, path)) }));
        if (!uuid.test(proposed.reservationOperationId ?? '')) autonomyError('autonomy-reservation-evidence-missing');
        workerFiles.push(...autonomyFiles(paths.projectRoot, resolve(paths.authorityRoot, 'operations', proposed.reservationOperationId))
          .map(path => ({ path: relative(paths.projectRoot, path), digest: autonomyDigest(readAutonomyFile(paths.projectRoot, path)) })));
        const acceptanceRun = readRun(root, id);
        repositoryReady(root, { ...acceptanceRun, ownedFiles: [...acceptanceRun.ownedFiles, ...workerFiles] });
        result = acceptPhaseProposal(root, contract.operationId, proposed);
        active.proposal = null;
        if (result.status !== 'draft-staged') autonomyError(result.code ?? 'autonomy-phase-not-accepted');
        const questions = [question(root, readRun(root, id), candidate, result.questions.map(q => q.code))];
        update(root, id, value => ({ counters: { ...value.counters, actions: value.counters.actions + 1 } }));
        return safeRun(settle({ status: readRun(root, id).desiredState === 'paused' ? 'paused' : 'awaiting-human', current: null, lastResult: { status: result.status,
          operationId: result.operationId, intentId: result.intentId, phase: result.phase }, questions, executionStopped: true, requiresHuman: true }));
      } else if (candidate.action === 'afk-build') {
        if (!grant.scope.actions.includes('afk-build') || !grant.scope.intentIds.includes(candidate.intentId)) autonomyError('autonomy-afk-scope-invalid');
        assertBuild(root, candidate, !candidate.afkRunId);
        const preflight = preflightAfkRun(root, candidate.intentId.split('/')[1], { provider: run.provider, maxParallel: 1, ignoreRunId: candidate.afkRunId });
        if (preflight.status !== 'ready') autonomyError('autonomy-afk-preflight-blocked');
        if (preflight.readyTasks.length && remainingAttempts < 2) autonomyError('autonomy-attempts-exhausted');
        const ownership = acquireIntentOwnership(root, candidate.intentId, { ownerId: `supervisor-${id}`, durationMs: Math.min(86400000, Math.ceil(remainingMs) + 60000) });
        try {
          const options = { provider: run.provider, maxParallel: 1, foreground: true,
            timeoutMs: Math.min(grant.scope.limits.maxOperationMs, Math.floor(remainingMs)), autonomy: { runId: id, grantDigest: grant.digest },
            dependencies: { authority: ({ stage, mode, transitions }) => {
              const current = check(); assertIntentOwnership(root, ownership); assertBuild(root, candidate);
              if (stage === 'worktree' && current.run.desiredState === 'paused') autonomyError('autonomy-run-paused');
              if (stage === 'integrate' || stage === 'dispatch' && mode !== 'command') {
                repositoryReady(root, { ...current.run, ownedFiles: [], repositoryIdentity: active.afkRepository.digest });
              }
              if (stage === 'integrated') {
                const records = active.afkRepository.records.map(record => ({ ...record }));
                for (const change of transitions) {
                  const record = records.find(record => record.root === relative(paths.projectRoot, change.root));
                  if (!record || record.identity !== `${change.before}\n${change.branch}\n`) autonomyError('autonomy-repository-changed');
                  record.identity = `${change.after}\n${change.branch}\n`;
                }
                active.afkRepository = repositoryReady(root, { ...current.run, ownedFiles: [], repositoryIdentity: autonomyDigest(records) });
                update(root, id, () => ({ repositoryIdentity: active.afkRepository.digest }));
              }
              if (stage === 'dispatch' && mode !== 'command') {
                if (current.remainingAttempts < (mode === 'implementation' ? 2 : 1)) autonomyError('autonomy-attempts-exhausted');
                update(root, id, value => ({ counters: { ...value.counters, providerAttempts: value.counters.providerAttempts + 1,
                  reviewCycles: value.counters.reviewCycles + (mode === 'review' ? 1 : 0) } }));
              }
            }, onRun: afk => {
              active.afkId = afk.id;
              active.afkRepository = repositoryReady(root, { ...readRun(root, id), repositoryIdentity: null, ownedFiles: [] });
              const control = update(root, id, value => ({ current: { ...value.current, afkRunId: afk.id } }));
              if (control.desiredState === 'paused') pauseAfkRun(root, afk.id);
              else if (['cancelled', 'revoked'].includes(control.desiredState)) cancelAfkRun(root, afk.id);
              active.executionStopped = false;
            } } };
          result = await (candidate.afkRunId ? resumeAfkRun(root, candidate.afkRunId, options)
            : startAfkRun(root, candidate.intentId.split('/')[1], options));
          active.executionStopped = result.executionStopped === true;
        } finally { if (active.executionStopped) try { releaseIntentOwnership(root, ownership); } catch {} }
        if (result.executionStopped !== true) autonomyError('autonomy-execution-unknown');
        check();
        if (!['completed', 'paused'].includes(result.status)) autonomyError('autonomy-afk-blocked');
        if (result.status === 'paused') return safeRun(settle({ status: 'paused', executionStopped: true, requiresHuman: false }));
        result = { status: 'afk-settled', afkRunId: result.id, intentId: candidate.intentId };
      } else autonomyError('autonomy-action-unavailable');
      clearInterval(timer); timer = null; active.controller = null; active.afkId = null; active.operationDeadline = null;
      const settled = settle({ current: null, lastResult: result, executionStopped: true });
      update(root, id, value => ({ counters: { ...value.counters, actions: value.counters.actions + 1 } }));
      if (initial.mode === 'once') return safeRun(settle({ status: settled.desiredState === 'paused' ? 'paused' : 'completed' }));
    }
  } catch (error) {
    if (active.proposal) {
      // Revoked, expired, cancelled or stale proposals must release their local
      // acceptance capability without publishing an assessment.
      active.controller.abort();
      acceptPhaseProposal(root, active.proposal.operationId, active.proposal.result);
    }
    const run = readRun(root, id), policy = readAutonomyPolicy(root);
    const cancelled = ['cancelled', 'revoked'].includes(run.desiredState);
    const status = !active.executionStopped ? 'recovery-required' : cancelled ? run.desiredState : error.code === 'autonomy-run-paused' ? 'paused'
      : policy.status === 'expired' ? 'expired' : policy.status === 'revoked' ? 'revoked' : 'blocked';
    return safeRun(settle({ status, code: failureCode(error), current: active.executionStopped ? null : run.current, executionStopped: active.executionStopped,
      requiresHuman: !cancelled || !active.executionStopped, cancellation: cancelled ? { ...run.cancellation, status: active.executionStopped ? 'confirmed' : 'unknown' } : run.cancellation }));
  } finally { clearInterval(timer); live.delete(key); }
}

export async function runAutonomyOnce(root, input) { const run = createRun(root, input, 'once'); return executeAutonomyRun(root, run.id); }
export function startAutonomyService(root, input) {
  return launchService(root, createRun(root, input, 'service'));
}
function launchService(root, run) {
  const paths = pathsFor(root, run.id);
  const child = spawn(process.execPath, [new URL('../autonomy-worker.mjs', import.meta.url).pathname, '--project', paths.projectRoot, '--run', run.id],
    { cwd: paths.projectRoot, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const unknown = () => { try { update(root, run.id, () => ({ status: 'recovery-required', code: 'autonomy-service-start-unknown', requiresHuman: true, executionStopped: false })); } catch {} };
  child.once('error', unknown);
  if (!Number.isSafeInteger(child.pid)) { unknown(); return safeRun(readRun(root, run.id)); }
  const started = update(root, run.id, current => ({ owner: { ...current.owner, pid: child.pid } }));
  child.send({ start: true }, error => { if (error) unknown(); if (child.connected) child.disconnect(); }); child.unref();
  return safeRun(started);
}
