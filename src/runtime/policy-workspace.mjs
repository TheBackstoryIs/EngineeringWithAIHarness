import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { loadProjectConfig } from '../project.mjs';
import { readPolicyBaselineStatus } from '../organisation-policies.mjs';
import {
  confirmPolicyFacts, evaluatePolicyDesign, readPolicyEvaluationStatus,
  recordPolicyException, recordPolicyReview,
} from '../policy-design-gates.mjs';
import { POLICY_DESIGN_AUTHORITY_NOTICE } from '../policy-gate-integration.mjs';
import { listRuntimeIntents, readRuntimeIntent } from './intents.mjs';
import { selectPolicyPersonas } from './persona-engagement.mjs';
import { publishLifecycleEventSafely } from './lifecycle-hooks.mjs';

const actions = Object.freeze({
  facts: { event: 'ewai.policy.facts.confirmed', allowed: ['intentReference', 'expectedRevision', 'expectedProposalDigest', 'confirmed', 'authority', 'confirmedBy', 'decisions'] },
  evaluation: { event: 'ewai.policy.evaluation.recorded', allowed: ['intentReference', 'expectedIntentRevision', 'expectedPolicyDigest', 'expectedFactsDigest'] },
  review: { event: 'ewai.policy.review.recorded', allowed: ['intentReference', 'evaluationDigest', 'ruleId', 'authority', 'reviewedBy', 'reviewerRole', 'decision', 'rationale', 'evidence', 'controls'] },
  exception: { event: 'ewai.policy.exception.recorded', allowed: ['intentReference', 'evaluationDigest', 'ruleId', 'authority', 'approvedBy', 'owner', 'reviewerRole', 'scope', 'rationale', 'compensatingControls', 'evidence', 'expiresAt'] },
});

export { POLICY_DESIGN_AUTHORITY_NOTICE };

function exact(input, allowed, label) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${label} must be an object`);
  const unsupported = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unsupported.length) throw new Error(`${label} contains unsupported field(s): ${unsupported.join(', ')}`);
  return input;
}

function safeReference(value) {
  const text = String(value ?? '').trim();
  const segments = text.split(/[\\/]+/);
  return isAbsolute(text) || text.includes('/private/') || text.includes('\\') || segments.includes('..')
    ? '[redacted-local-reference]'
    : text.slice(0, 500);
}

function safeFacts(record) {
  if (!record) return null;
  return {
    revision: record.revision, intent: record.intent, policyDigest: record.policyDigest,
    proposalDigest: record.proposalDigest, factsDigest: record.factsDigest,
    facts: (record.facts ?? []).map((fact) => ({
      id: fact.id, dimension: fact.dimension, values: fact.values, rationale: fact.rationale,
      provenance: { ...fact.provenance, reference: safeReference(fact.provenance?.reference), ...(fact.provenance?.persona ? { persona: fact.provenance.persona } : {}) },
    })),
    confirmation: record.confirmation,
    authority: record.authority,
  };
}

function factsRecord(projectRoot, reference) {
  const { paths } = loadProjectConfig(projectRoot);
  const path = resolve(paths.specsRoot, '3.Evidence/policy/facts', `${reference}.json`);
  if (!existsSync(path)) return null;
  try { return safeFacts(JSON.parse(readFileSync(path, 'utf8'))); } catch { return null; }
}

function evaluationRecord(projectRoot, reference, expectedDigest) {
  if (!expectedDigest) return null;
  const { paths } = loadProjectConfig(projectRoot);
  const path = resolve(paths.specsRoot, '3.Evidence/policy/evaluations', `${reference}.json`);
  if (!existsSync(path)) return null;
  try {
    const record = JSON.parse(readFileSync(path, 'utf8'));
    return record.schema === 'ewai.policy-design-evaluation/v1' && record.evaluationDigest === expectedDigest
      ? record
      : null;
  } catch { return null; }
}

function authority() {
  return { advisory: true, designTimeOnly: true, productionEnforcement: false, productionCodeExecution: false, buildApproved: false, manualQaApproved: false, complianceCertified: false, releaseApproved: false, residualRiskAccepted: false };
}

function chosenIntent(projectRoot, reference = '') {
  if (reference) return readRuntimeIntent(projectRoot, reference);
  return listRuntimeIntents(projectRoot)[0] ?? null;
}

export function readPolicyWorkspace(projectRoot, options = {}) {
  if (!['business', 'technical'].includes(options.mode ?? 'business')) throw new Error('Policy workspace mode must be business or technical');
  const intent = chosenIntent(projectRoot, String(options.intentReference ?? ''));
  const baseline = readPolicyBaselineStatus(projectRoot);
  const reference = intent?.id ?? '';
  const policyStatus = reference && baseline.status !== 'not-configured'
    ? readPolicyEvaluationStatus(projectRoot, reference, options)
    : { schema: 'ewai.policy-evaluation-status/v1', status: baseline.status, blocking: false, controls: [] };
  const evaluation = reference ? evaluationRecord(projectRoot, reference, policyStatus.evaluationDigest) : null;
  const policy = {
    ...policyStatus,
    matchedRules: evaluation?.matchedRules ?? [],
    requiredReviews: evaluation?.requiredReviews ?? [],
    unmatchedPolicies: evaluation?.unmatchedPolicies ?? [],
  };
  const facts = reference ? factsRecord(projectRoot, reference) : null;
  const dimensions = [...new Set((facts?.facts ?? []).map(({ dimension }) => dimension))];
  const engagement = selectPolicyPersonas({ stage: options.stage ?? 'facts', dimensions, context: { intent: reference, status: policy.status } }, options.personas ?? []);
  const activePersonas = engagement.activePersonas.map(({ id, name, tier, category, description, matchedSignals, engagementReason }) => ({ id, name, tier, category, description, matchedSignals, engagementReason, advisory: true }));
  const status = policy.status ?? baseline.status;
  const blocking = baseline.status === 'not-configured' ? false : policy.blocking !== false;
  const shared = { intentReference: reference, status, blocking };
  return {
    schema: 'ewai.policy-workspace/v1', ...shared,
    baseline: { status: baseline.status, enabled: baseline.enabled, blocking: baseline.blocking, effectiveDigest: baseline.effectiveDigest ?? null, policyCount: baseline.policyCount ?? 0, ruleCount: baseline.ruleCount ?? 0, approvedBy: baseline.approvedBy ?? null, approvedAt: baseline.approvedAt ?? null },
    facts, policy, activePersonas, personaAvailability: { baseline: engagement.baseline, premium: engagement.premium },
    views: {
      business: { ...shared, outcome: status, nextActions: blocking ? ['Resolve the current policy evidence and named decisions.'] : [], controls: (policy.controls ?? []).map(({ ruleId, id, title, description }) => ({ ruleId, id, title, description })) },
      technical: { ...shared, policyDigest: policy.policyDigest ?? baseline.effectiveDigest ?? null, factsDigest: policy.factsDigest ?? null, evaluationDigest: policy.evaluationDigest ?? null, matchedRules: policy.matchedRules ?? [], controls: policy.controls ?? [] },
    },
    notices: [POLICY_DESIGN_AUTHORITY_NOTICE], authority: authority(),
  };
}

export function policyLifecycleEvent(projectRoot, kind, record, options = {}) {
  const definition = actions[kind];
  if (!definition) throw new Error(`Unsupported policy lifecycle event: ${kind}`);
  if (!record || typeof record !== 'object') throw new Error('Policy lifecycle event requires a persisted policy record');
  const reference = record.intentReference ?? record.intent?.reference;
  const revision = record.evaluationDigest ?? record.factsDigest ?? record.decisionDigest;
  if (!reference || !revision) throw new Error('Policy lifecycle event requires a persisted record identity');
  const status = readPolicyEvaluationStatus(projectRoot, reference);
  const persisted = kind === 'facts'
    ? factsRecord(projectRoot, reference)?.factsDigest === record.factsDigest
    : kind === 'evaluation'
      ? status.evaluationDigest === record.evaluationDigest
      : kind === 'review'
        ? status.reviews?.some(({ decisionDigest }) => decisionDigest === record.decisionDigest)
        : status.exceptions?.some(({ decisionDigest }) => decisionDigest === record.decisionDigest);
  if (!persisted) throw new Error('Policy lifecycle event requires the exact persisted policy record');
  const personas = options.personas ?? [];
  return publishLifecycleEventSafely(projectRoot, definition.event, {
    sourceKey: `policy:${kind}:${reference}:${revision}`,
    sourceRevision: revision,
    scope: { intent: reference },
    facts: {
      status: kind === 'evaluation' ? record.governingOutcome : kind === 'review' ? record.decision : kind === 'exception' ? 'approved' : 'confirmed',
      intentReference: reference,
      evidenceDigest: revision,
      ...(record.ruleId ? { ruleId: record.ruleId } : {}),
    },
    personas,
    streamId: `intent:${reference}`,
  });
}

function resultAfter(projectRoot, kind, record, options) {
  const workspace = readPolicyWorkspace(projectRoot, { intentReference: record.intentReference ?? record.intent?.reference, personas: options.personas, stage: kind });
  return { record, lifecycle: policyLifecycleEvent(projectRoot, kind, record, { personas: workspace.activePersonas }), workspace };
}

export function confirmPolicyFactsAction(projectRoot, input, options = {}) {
  exact(input, actions.facts.allowed, 'Policy fact confirmation request');
  return resultAfter(projectRoot, 'facts', confirmPolicyFacts(projectRoot, input, options), options);
}

export function evaluatePolicyDesignAction(projectRoot, input, options = {}) {
  exact(input, actions.evaluation.allowed, 'Policy evaluation request');
  return resultAfter(projectRoot, 'evaluation', evaluatePolicyDesign(projectRoot, input, options), options);
}

export function recordPolicyReviewAction(projectRoot, input, options = {}) {
  exact(input, actions.review.allowed, 'Policy review request');
  return resultAfter(projectRoot, 'review', recordPolicyReview(projectRoot, input, options), options);
}

export function recordPolicyExceptionAction(projectRoot, input, options = {}) {
  exact(input, actions.exception.allowed, 'Policy exception request');
  return resultAfter(projectRoot, 'exception', recordPolicyException(projectRoot, input, options), options);
}
