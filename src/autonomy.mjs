import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { autonomyError, autonomyGuard, autonomyDigest, autonomyPaths, autonomyFiles, readAutonomyFile,
  writeAutonomyRecord, withAutonomyLock, readAutonomySnapshot } from './runtime/autonomy-workspace.mjs';

export const AUTONOMY_ACTIONS = Object.freeze(['begin-harness', 'prepare-phase', 'afk-build']);
export const AUTONOMY_PROVIDERS = Object.freeze(['codex', 'claude', 'antigravity']);
export const AUTONOMY_HUMAN_EXCLUSIONS = Object.freeze(['approve-build', 'select-prototype', 'manual-qa', 'accept-risk', 'policy-exception', 'destructive-action', 'deploy', 'release']);
const intentPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).some(key => !allowed.includes(key))) autonomyError('autonomy-invalid-input', 400);
}
function boundedList(value, valid, maximum = 100) {
  if (!Array.isArray(value) || !value.length || value.length > maximum || new Set(value).size !== value.length
    || value.some(item => typeof item !== 'string' || item.length > 160 || !valid(item))) autonomyError('autonomy-invalid-scope', 400);
  return [...value].sort();
}
export function validateAutonomyScope(input) {
  keys(input, ['intentIds', 'actions', 'providers', 'expiresAt', 'limits']);
  keys(input.limits, ['maxConcurrentIntents', 'maxRuntimeMs', 'maxOperationMs', 'maxAttempts']);
  const limits = input.limits;
  if (limits.maxConcurrentIntents !== 1 || !Number.isSafeInteger(limits.maxRuntimeMs) || limits.maxRuntimeMs < 1 || limits.maxRuntimeMs > 86400000
    || !Number.isSafeInteger(limits.maxOperationMs) || limits.maxOperationMs < 1 || limits.maxOperationMs > limits.maxRuntimeMs
    || !Number.isSafeInteger(limits.maxAttempts) || limits.maxAttempts < 1 || limits.maxAttempts > 100) autonomyError('autonomy-invalid-limits', 400);
  if (typeof input.expiresAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.expiresAt)
    || !Number.isFinite(Date.parse(input.expiresAt)) || new Date(input.expiresAt).toISOString() !== input.expiresAt) autonomyError('autonomy-invalid-expiry', 400);
  return { intentIds: boundedList(input.intentIds, id => intentPattern.test(id)),
    actions: boundedList(input.actions, action => AUTONOMY_ACTIONS.includes(action), AUTONOMY_ACTIONS.length),
    providers: boundedList(input.providers, provider => AUTONOMY_PROVIDERS.includes(provider), AUTONOMY_PROVIDERS.length),
    expiresAt: input.expiresAt, limits: { ...limits } };
}
function readPolicy(root) {
  const paths = autonomyPaths(root);
  const records = autonomyFiles(paths.projectRoot, resolve(paths.authorityRoot, 'grants')).filter(path => path.includes('/revisions/')).map(path => {
    const record = JSON.parse(readAutonomyFile(paths.projectRoot, path));
    keys(record, ['schema', 'id', 'revision', 'previousDigest', 'digest', 'proposalDigest', 'approvedBy', 'approvedAt', 'scope', 'humanExclusions', 'configDigest', 'projectIdentity']);
    const { digest, ...body } = record;
    validateAutonomyScope(record.scope);
    if (record.schema !== 'ewai.autonomy-grant/v1' || !Number.isSafeInteger(record.revision) || record.revision < 1
      || !/^[a-f0-9-]{36}$/.test(record.id) || !digestPattern.test(record.proposalDigest) || !digestPattern.test(record.configDigest)
      || digest !== autonomyDigest(body) || !path.endsWith(`/grants/${record.id}/revisions/${record.revision}-${digest.slice(7)}.json`)
      || record.projectIdentity !== autonomyDigest(paths.projectRoot) || !validApprover(record.approvedBy)
      || !Number.isFinite(Date.parse(record.approvedAt)) || JSON.stringify(record.humanExclusions) !== JSON.stringify(AUTONOMY_HUMAN_EXCLUSIONS)) autonomyError('autonomy-grant-invalid', 422);
    return record;
  }).sort((a, b) => a.revision - b.revision);
  records.forEach((record, index) => {
    if (record.revision !== index + 1 || record.previousDigest !== (records[index - 1]?.digest ?? null)
      || index > 0 && record.id !== records[0].id) autonomyError('autonomy-grant-history-invalid', 422);
  });
  const grant = records.at(-1) ?? null;
  const status = !grant ? 'absent' : Date.parse(grant.scope.expiresAt) <= Date.now() ? 'expired' : 'current';
  return { schema: 'ewai.autonomy-policy/v1', mode: status === 'current' ? 'delegated' : 'off', status, grant,
    digest: grant?.digest ?? autonomyDigest({ mode: 'off', project: paths.projectRoot }),
    humanExclusions: [...AUTONOMY_HUMAN_EXCLUSIONS], serviceStarted: false };
}
export function readAutonomyPolicy(root) { return autonomyGuard(() => readPolicy(root)); }

function classify(item, scope, policy, snapshot, isProposal) {
  const reasons = [], add = code => reasons.push({ code });
  const state = item.execution, actions = state.actions;
  let phase = state.lifecycle.nextPhase, action = null, human = false;
  if (!scope?.intentIds.includes(item.intentId)) add('outside-approved-pool');
  if (!item.accepted) add('intent-not-accepted');
  if (!state.valid) state.blockers.forEach(blocker => add(/^[a-z0-9-]{1,100}$/.test(blocker.code) ? blocker.code : 'canonical-evidence-invalid'));
  if (!scope) add('autonomy-off');
  else if (Date.parse(scope.expiresAt) <= Date.now()) add('grant-expired');
  if (!isProposal && policy.grant && policy.grant.configDigest !== snapshot.configDigest) add('grant-policy-changed');
  if (phase === 'manual-qa') { add('manual-qa-required'); human = true; }
  else if (phase === 'ui-design') { add('prototype-selection-required'); human = true; }
  else if (actions.approveBuild.permitted) { add('build-approval-required'); human = true; }
  else if (actions.beginHarness.permitted && state.valid) { action = 'begin-harness'; phase = 'intent'; }
  else if (phase === 'build') {
    action = 'afk-build';
    for (const blocker of actions.enterBuild.blockers ?? []) if (/^intent-dependency-/.test(blocker.code)) add(blocker.code);
    if (!actions.acquireTask.permitted) add('afk-preflight-required');
    add('afk-handoff-unavailable'); // T-004 supplies guarded handoff, never inferred from a label.
  } else if (actions.continueHarness.permitted && ['intent', 'reconcile', 'plan', 'pattern-validation', 'test-plan'].includes(phase)) {
    action = 'prepare-phase'; add('restricted-phase-contract-unavailable'); // T-003 installs verified contracts.
  } else add('autonomy-phase-unavailable');
  if (action && !scope?.actions.includes(action)) add('action-not-approved');
  if (item.repositoryBusy) add('repository-ownership-conflict');
  return { intentId: item.intentId, phase, action, sortKey: [item.priority, item.intentId],
    reasons: [...new Map(reasons.map(reason => [reason.code, reason])).values()],
    bucket: human ? 'humanDecisions' : reasons.length ? 'blocked' : 'executable' };
}
function latestProposalPreview(root) {
  const paths = autonomyPaths(root);
  const records = autonomyFiles(paths.projectRoot, resolve(paths.controlRoot, 'previews'))
    .filter(path => /\/\d+-[a-f0-9]{64}\.json$/.test(path))
    .map(path => {
      const value = JSON.parse(readAutonomyFile(paths.projectRoot, path));
      if (!Number.isSafeInteger(value.previewRevision) || value.previewRevision < 1 || !digestPattern.test(value.digest)
        || !path.endsWith(`/${value.previewRevision}-${value.digest.slice(7)}.json`)) autonomyError('autonomy-preview-invalid');
      return value;
    }).sort((a, b) => a.previewRevision - b.previewRevision);
  if (records.some((record, index) => record.previewRevision !== index + 1)) autonomyError('autonomy-preview-history-invalid');
  return records.at(-1) ?? null;
}
function createPreview(root, input, recordedRevision = null) {
  keys(input, ['proposal', 'record']);
  if (input.record !== undefined && typeof input.record !== 'boolean') autonomyError('autonomy-invalid-input', 400);
  const snapshot = readAutonomySnapshot(root), policy = readPolicy(root);
  const proposal = input.proposal === undefined ? null : validateAutonomyScope(input.proposal);
  if (proposal && Date.parse(proposal.expiresAt) <= Date.now()) autonomyError('autonomy-expired-proposal', 400);
  if (proposal && proposal.intentIds.some(id => !snapshot.items.some(item => item.intentId === id))) autonomyError('autonomy-intent-unknown', 400);
  const scope = proposal ?? policy.grant?.scope ?? null;
  const basis = { schema: 'ewai.autonomy-preview/v1', evidenceRevision: snapshot.revision, policyDigest: policy.digest,
    configDigest: snapshot.configDigest, projectIdentity: snapshot.projectIdentity, proposal,
    previewRevision: proposal ? recordedRevision ?? (latestProposalPreview(root)?.previewRevision ?? 0) + 1 : null };
  const result = { ...basis, digest: autonomyDigest(basis), authority: 'none', mode: 'shadow',
    executable: [], humanDecisions: [], blocked: [], humanExclusions: [...AUTONOMY_HUMAN_EXCLUSIONS],
    ordering: 'Ascending explicit numeric priority; missing or non-numeric priority is neutral zero; then intent ID.' };
  for (const item of snapshot.items) {
    const { bucket, ...candidate } = classify(item, scope, policy, snapshot, Boolean(proposal)); result[bucket].push(candidate);
  }
  for (const bucket of ['executable', 'humanDecisions', 'blocked']) result[bucket].sort((a, b) => a.sortKey[0] - b.sortKey[0] || (a.intentId < b.intentId ? -1 : a.intentId > b.intentId ? 1 : 0));
  return result;
}
export function previewAutonomy(root, input = {}) {
  return autonomyGuard(() => {
    if (!input.record) return createPreview(root, input);
    const paths = autonomyPaths(root);
    return withAutonomyLock(paths, () => {
      const result = createPreview(root, input);
      writeAutonomyRecord(paths.projectRoot, resolve(paths.controlRoot, 'previews', `${result.proposal ? result.previewRevision + '-' : ''}${result.digest.slice(7)}.json`), result);
      return result;
    });
  });
}
function validApprover(value) { return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 120 && !/[\x00-\x1f\x7f]/.test(value); }
export function approveAutonomyGrant(root, input) {
  return autonomyGuard(() => {
    keys(input, ['expectedDigest', 'approvedBy', 'confirmed']);
    if (input.confirmed !== true || !validApprover(input.approvedBy) || !digestPattern.test(input.expectedDigest)) autonomyError('autonomy-approval-required', 400);
    const paths = autonomyPaths(root);
    return withAutonomyLock(paths, () => {
      const displayed = latestProposalPreview(root);
      if (!displayed) autonomyError('autonomy-preview-required');
      if (displayed.digest !== input.expectedDigest) autonomyError('autonomy-preview-stale');
      const current = createPreview(root, { proposal: displayed.proposal }, displayed.previewRevision);
      if (current.digest !== input.expectedDigest || autonomyDigest(current) !== autonomyDigest(displayed)) autonomyError('autonomy-preview-stale');
      if ([...current.blocked, ...current.humanDecisions].some(item => current.proposal.intentIds.includes(item.intentId)
        && item.reasons.some(reason => ['intent-not-accepted', 'intent-state-drift'].includes(reason.code)))) autonomyError('autonomy-intent-not-accepted');
      const previous = readPolicy(root).grant;
      const body = { schema: 'ewai.autonomy-grant/v1', id: previous?.id ?? randomUUID(), revision: (previous?.revision ?? 0) + 1,
        previousDigest: previous?.digest ?? null, proposalDigest: current.digest, approvedBy: input.approvedBy, approvedAt: new Date().toISOString(),
        scope: current.proposal, humanExclusions: [...AUTONOMY_HUMAN_EXCLUSIONS], configDigest: current.configDigest, projectIdentity: current.projectIdentity };
      const grant = { ...body, digest: autonomyDigest(body) };
      if (createPreview(root, { proposal: displayed.proposal }, displayed.previewRevision).digest !== current.digest) autonomyError('autonomy-preview-stale');
      writeAutonomyRecord(paths.projectRoot, resolve(paths.authorityRoot, 'grants', grant.id, 'revisions', `${grant.revision}-${grant.digest.slice(7)}.json`), grant);
      return grant;
    });
  });
}
