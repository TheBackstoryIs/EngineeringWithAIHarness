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
