import {
  recordBuildApproval,
  startDeliveryPhase,
} from '../delivery.mjs';
import { readRuntimeIntent } from './intents.mjs';
import { readWorkItemView } from './work.mjs';
import {
  afkRunStatus,
  cancelAfkRun,
  pauseAfkRun,
  preflightAfkRun,
  resumeAfkRun,
  startAfkRun,
} from './afk-conductor.mjs';
import { queueDashboardHandoff } from './dashboard-handoffs.mjs';
import { readAutonomyPolicy, previewAutonomy, approveAutonomyGrant, revokeAutonomyGrant } from '../autonomy.mjs';
import { readAutonomyRun, runAutonomyOnce, startAutonomyService, controlAutonomyRun, answerAutonomyQuestion } from './autonomy-supervisor.mjs';
import { autonomyError, autonomyRunIds } from './autonomy-workspace.mjs';

// All three transports retain the complete request until this closed validator
// accepts it. No adapter may strip unknown authority-bearing fields first.
export const AUTONOMY_INTERFACE_FIELDS = Object.freeze({
  status: ['runId'], preview: ['proposal', 'record', 'confirmed'],
  approve: ['expectedDigest', 'approvedBy', 'confirmed'], revoke: ['expectedDigest', 'revokedBy', 'confirmed'],
  run: ['expectedDigest', 'provider', 'confirmed'], service: ['expectedDigest', 'provider', 'confirmed'],
  control: ['runId', 'action', 'expectedRevision', 'confirmed', 'revokedBy'],
  answer: ['runId', 'questionId', 'expectedRevision', 'answeredBy', 'answer', 'confirmed'],
});

export function safeAutonomyInterfaceError(error) {
  const code = /^(?:autonomy|phase)-[a-z0-9-]{1,100}$/.test(error?.code ?? '') ? error.code : 'autonomy-invalid-input';
  const statusCode = [400, 403, 404, 405, 409, 413, 415, 422].includes(error?.statusCode) ? error.statusCode : 400;
  return { code, statusCode, error: `Autonomy cannot continue: ${code}. Refresh the preview or resolve the recorded prerequisite.` };
}

function validateAutonomyInterfaceInput(action, input) {
  const fields = AUTONOMY_INTERFACE_FIELDS[action];
  if (!fields || !input || Object.getPrototypeOf(input) !== Object.prototype || Array.isArray(input)
    || Object.keys(input).some(key => !fields.includes(key))) autonomyError('autonomy-invalid-input', 400);
  const checks = {
    confirmed: value => typeof value === 'boolean', record: value => typeof value === 'boolean',
    expectedDigest: value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value),
    runId: value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value),
    expectedRevision: value => Number.isSafeInteger(value) && value > 0,
    questionId: value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value),
    provider: value => ['codex', 'claude', 'antigravity'].includes(value),
    action: value => ['pause', 'resume', 'cancel', 'revoke', 'recover'].includes(value),
    answer: value => typeof value === 'string' && !!value.trim() && Buffer.byteLength(value) <= 16384,
    proposal: value => !!value && Object.getPrototypeOf(value) === Object.prototype,
  };
  const named = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 120 && !/[\x00-\x1f\x7f]/.test(value);
  for (const key of ['approvedBy', 'revokedBy', 'answeredBy']) checks[key] = named;
  for (const [key, value] of Object.entries(input)) if (!checks[key]?.(value)) autonomyError('autonomy-invalid-input', 400);
  if (action !== 'status' && action !== 'preview' && input.confirmed !== true
    || action === 'preview' && input.record === true && input.confirmed !== true) autonomyError('autonomy-confirmation-required', 409);
  const required = { approve: ['expectedDigest', 'approvedBy'], revoke: ['expectedDigest', 'revokedBy'],
    run: ['expectedDigest', 'provider'], service: ['expectedDigest', 'provider'], control: ['runId', 'action', 'expectedRevision'],
    answer: ['runId', 'questionId', 'expectedRevision', 'answeredBy', 'answer'] }[action] ?? [];
  if (required.some(key => input[key] === undefined)) autonomyError('autonomy-invalid-input', 400);
}

export async function autonomyInterfaceAction(projectRoot, action, input = {}) {
  try {
    validateAutonomyInterfaceInput(action, input);
    const { confirmed, ...data } = input;
    if (action === 'status') {
      if (input.runId) return readAutonomyRun(projectRoot, input.runId);
      const policy = readAutonomyPolicy(projectRoot), runs = autonomyRunIds(projectRoot).map(id => readAutonomyRun(projectRoot, id));
      return { ...policy, runs, serviceStarted: runs.some(run => run.mode === 'service' && run.lifetime.ownerProcessAlive
        && ['starting', 'running', 'cancel-requested'].includes(run.status)) };
    }
    if (action === 'preview') return previewAutonomy(projectRoot, data);
    if (action === 'approve') return approveAutonomyGrant(projectRoot, input);
    if (action === 'revoke') return revokeAutonomyGrant(projectRoot, input);
    if (action === 'run') return await runAutonomyOnce(projectRoot, data);
    if (action === 'service') return startAutonomyService(projectRoot, input);
    if (action === 'control') return await controlAutonomyRun(projectRoot, input);
    if (action === 'answer') return answerAutonomyQuestion(projectRoot, data);
    autonomyError('autonomy-invalid-input', 400);
  } catch (error) {
    const safe = safeAutonomyInterfaceError(error);
    autonomyError(safe.code, safe.statusCode);
  }
}

function requireConfirmation(input, action) {
  if (input?.confirmed !== true) throw new Error(`${action} requires explicit confirmation.`);
}

function context(projectRoot, reference) {
  const intent = readRuntimeIntent(projectRoot, reference);
  if (!intent) throw new Error(`Unknown intent: ${reference}`);
  const view = readWorkItemView(projectRoot, intent.id);
  if (!view) throw new Error(`No work item is available for intent: ${reference}`);
  return { intent, view };
}

function requireAction(view, actionName) {
  const action = view.item.execution?.actions?.[actionName];
  if (!action?.permitted) {
    const reason = action?.blockers?.map((item) => item.message).join(' ') || 'The evidence-derived action is not available.';
    throw new Error(reason);
  }
  return action;
}

export function requestGuidedDashboardWork(projectRoot, reference, input = {}) {
  requireConfirmation(input, 'Guided EWAI work');
  const requested = String(input.action ?? '').trim();
  const actionName = requested === 'begin' ? 'beginHarness' : requested === 'continue' ? 'continueHarness' : '';
  if (!actionName) throw new Error(`Unsupported guided action: ${requested || '<missing>'}`);
  const { intent, view } = context(projectRoot, reference);
  const action = requireAction(view, actionName);
  return queueDashboardHandoff(projectRoot, {
    intentId: intent.id,
    slug: intent.slug,
    title: intent.title,
    action: requested,
    phase: action.nextPhase ?? view.item.currentPhase ?? (requested === 'begin' ? 'intent' : ''),
  });
}

export function approveBuildFromDashboard(projectRoot, reference, input = {}) {
  requireConfirmation(input, 'Build approval');
  const approvedBy = String(input.approvedBy ?? '').trim();
  if (!approvedBy) throw new Error('Build approval requires the approving person’s name.');
  const { intent, view } = context(projectRoot, reference);
  requireAction(view, 'approveBuild');
  const result = recordBuildApproval(projectRoot, intent.slug, {
    decision: 'approved',
    approvedBy,
    scope: String(input.scope ?? '').trim(),
  });
  return { approval: result, view: readWorkItemView(projectRoot, intent.id) };
}

export function enterBuildFromDashboard(projectRoot, reference, input = {}) {
  requireConfirmation(input, 'Entering Build');
  const { intent, view } = context(projectRoot, reference);
  requireAction(view, 'enterBuild');
  const state = startDeliveryPhase(projectRoot, intent.slug, 'build');
  return { state, view: readWorkItemView(projectRoot, intent.id) };
}

export function preflightAfkFromDashboard(projectRoot, reference, input = {}) {
  const { intent } = context(projectRoot, reference);
  return preflightAfkRun(projectRoot, intent.slug, {
    provider: input.provider ?? 'auto',
    maxParallel: Number(input.maxParallel ?? 1),
  });
}

export function startAfkFromDashboard(projectRoot, reference, input = {}) {
  requireConfirmation(input, 'Starting AFK Build');
  const { intent, view } = context(projectRoot, reference);
  requireAction(view, 'acquireTask');
  const timeoutMinutes = Number(input.timeoutMinutes ?? 45);
  if (!Number.isInteger(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > 1440) {
    throw new Error('AFK timeout must be between 1 and 1440 minutes.');
  }
  return startAfkRun(projectRoot, intent.slug, {
    provider: input.provider ?? 'auto',
    maxParallel: Number(input.maxParallel ?? 1),
    timeoutMs: timeoutMinutes * 60 * 1000,
  });
}

export function controlAfkFromDashboard(projectRoot, runId, input = {}) {
  requireConfirmation(input, `AFK ${input.action ?? 'control'}`);
  if (input.action === 'pause') return pauseAfkRun(projectRoot, runId);
  if (input.action === 'resume') return resumeAfkRun(projectRoot, runId);
  if (input.action === 'cancel') return cancelAfkRun(projectRoot, runId);
  throw new Error(`Unsupported AFK control: ${input.action ?? '<missing>'}`);
}

export function dashboardAfkRuns(projectRoot, slug = '') {
  return afkRunStatus(projectRoot).filter((run) => !slug || run.slug === slug);
}
