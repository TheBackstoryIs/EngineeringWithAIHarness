import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { atomicJson, now } from '../delivery-documents.mjs';
import { runtimePaths } from './paths.mjs';

const schema = 'ewai.dashboard-handoffs/v1';
const statuses = new Set(['pending', 'claimed', 'completed', 'cancelled', 'superseded']);
const reviewDigestPattern = /^[a-f0-9]{64}$/;

function boundedText(value, label, maximum = 1_000) {
  const text = String(value ?? '').trim();
  if (text.length > maximum) throw new Error(`${label} exceeds ${maximum} characters.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error(`${label} contains unsafe control characters.`);
  return text;
}

function normaliseReviewContext(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Contribution review context must be an object.');
  const allowed = ['revision', 'digest', 'ownerContext', 'summary', 'activePersonas'];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`Contribution review context contains unknown field: ${key}`);
  }
  const revision = Number(value.revision);
  if (!Number.isInteger(revision) || revision < 1) throw new Error('Contribution review context requires a positive revision.');
  const digest = boundedText(value.digest, 'Contribution review digest', 64);
  if (!reviewDigestPattern.test(digest)) throw new Error('Contribution review context requires a SHA-256 digest.');
  const ownerContext = boundedText(value.ownerContext, 'Contribution review owner context', 40);
  if (!['business', 'technical', 'shared-review'].includes(ownerContext)) throw new Error('Contribution review owner context is invalid.');
  const summary = boundedText(value.summary, 'Contribution review summary');
  if (!summary) throw new Error('Contribution review context requires a bounded summary.');
  if (!Array.isArray(value.activePersonas) || value.activePersonas.length > 4) throw new Error('Contribution review supports no more than four safe active personas.');
  const activePersonas = value.activePersonas.map((persona, index) => {
    if (!persona || typeof persona !== 'object' || Array.isArray(persona)) throw new Error(`Contribution review persona ${index + 1} must be an object.`);
    const personaAllowed = ['id', 'name', 'tier', 'matchedSignals', 'engagementReason'];
    for (const key of Object.keys(persona)) {
      if (!personaAllowed.includes(key)) throw new Error(`Contribution review persona ${index + 1} contains unknown field: ${key}`);
    }
    if (!Array.isArray(persona.matchedSignals) || persona.matchedSignals.length > 12) throw new Error(`Contribution review persona ${index + 1} has invalid matched signals.`);
    return {
      id: boundedText(persona.id, `Contribution review persona ${index + 1} id`, 160),
      name: boundedText(persona.name, `Contribution review persona ${index + 1} name`, 160),
      tier: boundedText(persona.tier, `Contribution review persona ${index + 1} tier`, 40),
      matchedSignals: persona.matchedSignals.map((signal) => boundedText(signal, `Contribution review persona ${index + 1} signal`, 120)),
      engagementReason: boundedText(persona.engagementReason, `Contribution review persona ${index + 1} reason`, 500),
    };
  });
  return { revision, digest, ownerContext, summary, activePersonas };
}

function handoffPath(projectRoot) {
  return resolve(runtimePaths(projectRoot).runtimeStateRoot, 'dashboard-handoffs.json');
}

function readState(projectRoot) {
  const path = handoffPath(projectRoot);
  if (!existsSync(path)) return { schema, items: [] };
  const state = JSON.parse(readFileSync(path, 'utf8'));
  if (state.schema !== schema || !Array.isArray(state.items)) {
    throw new Error(`Unsupported dashboard handoff state: ${path}`);
  }
  return state;
}

function writeState(projectRoot, state) {
  atomicJson(handoffPath(projectRoot), state);
  return state;
}

export function listDashboardHandoffs(projectRoot, options = {}) {
  const state = readState(projectRoot);
  const requestedStatus = String(options.status ?? '').trim();
  return state.items
    .filter((item) => !requestedStatus || item.status === requestedStatus)
    .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
}

export function dashboardHandoffStatus(projectRoot) {
  try {
    return { status: 'available', handoffs: listDashboardHandoffs(projectRoot, { status: 'pending' }), error: null };
  } catch (error) {
    return { status: 'invalid', handoffs: [], error: error.message };
  }
}

export function queueDashboardHandoff(projectRoot, input = {}) {
  const action = String(input.action ?? '').trim();
  if (!['begin', 'continue', 'review-contribution'].includes(action)) throw new Error(`Unsupported dashboard handoff action: ${action || '<missing>'}`);
  if (!input.intentId || !input.slug || !input.title) throw new Error('Dashboard handoff requires an intent id, slug, and title.');
  const contributionReview = action === 'review-contribution';
  const reviewContext = contributionReview ? normaliseReviewContext(input.reviewContext) : null;

  const state = readState(projectRoot);
  const timestamp = now();
  for (const item of state.items) {
    const sameReview = contributionReview && item.action === 'review-contribution' && item.phase === String(input.phase ?? '');
    const sameDeliveryRequest = !contributionReview && ['begin', 'continue'].includes(item.action);
    if (item.intentId === input.intentId && item.status === 'pending' && (sameReview || sameDeliveryRequest)) {
      item.status = 'superseded';
      item.updatedAt = timestamp;
    }
  }
  const handoff = {
    schema: 'ewai.dashboard-handoff/v1',
    id: randomUUID(),
    intentId: input.intentId,
    slug: input.slug,
    title: input.title,
    action,
    phase: String(input.phase ?? (action === 'begin' ? 'intent' : '')),
    authority: contributionReview ? 'none' : 'guarded-delivery-handoff',
    reviewContext,
    status: 'pending',
    requestedAt: timestamp,
    updatedAt: timestamp,
    resolvedAt: null,
    resolvedBy: null,
    claimedAt: null,
    claimedBy: null,
    notes: '',
  };
  state.items.push(handoff);
  writeState(projectRoot, state);
  return handoff;
}

export function resolveDashboardHandoff(projectRoot, id, input = {}) {
  const status = String(input.status ?? '').trim();
  if (!statuses.has(status) || status === 'pending') throw new Error(`Unsupported dashboard handoff outcome: ${status || '<missing>'}`);
  const state = readState(projectRoot);
  const handoff = state.items.find((item) => item.id === id);
  if (!handoff) throw new Error(`Unknown dashboard handoff: ${id}`);
  if (!['pending', 'claimed'].includes(handoff.status)) {
    throw new Error(`Dashboard handoff ${id} is already ${handoff.status}.`);
  }
  handoff.status = status;
  handoff.updatedAt = now();
  const actor = String(input.resolvedBy ?? '').trim() || null;
  if (status === 'claimed') {
    handoff.claimedAt = handoff.updatedAt;
    handoff.claimedBy = actor;
  } else {
    handoff.resolvedAt = handoff.updatedAt;
    handoff.resolvedBy = actor;
  }
  handoff.notes = String(input.notes ?? '').trim();
  writeState(projectRoot, state);
  return handoff;
}
