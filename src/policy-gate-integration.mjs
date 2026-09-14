import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { atomicJson, deliveryPaths, isWithin } from './delivery-documents.mjs';
import { readPolicyBaselineStatus } from './organisation-policies.mjs';
import { readPolicyEvaluationStatus } from './policy-design-gates.mjs';
import { readImpactWorkspace } from './runtime/impact-analysis.mjs';

export const POLICY_DESIGN_AUTHORITY_NOTICE = 'Organisation Policy Design Gates are design-time evidence only. They do not enforce production traffic, execute production code, certify compliance, approve Build or Manual QA, authorise release, or accept residual risk.';

const APPLICABLE_PHASES = new Set(['intent', 'plan']);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ROUTES = new Set(['claim', 'task', 'automated-test', 'named-human', 'specialist-review']);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const EMPTY_IMPACT = Object.freeze({ actors: [], aiUse: [], data: [], destinations: [], hosting: [], integrations: [] });

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`;
}

function safeIntentReference(value) {
  const reference = String(value ?? '').trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(reference)) {
    throw new Error(`Policy gate requires a project intent reference: ${reference || 'missing'}`);
  }
  return reference;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
}

function deliveryIntentReference(projectRoot, slug) {
  const paths = deliveryPaths(projectRoot, slug);
  if (!existsSync(paths.statePath)) throw new Error(`Policy gate requires delivery truth for ${slug}`);
  const state = readJson(paths.statePath, 'Delivery state');
  return safeIntentReference(state.intent?.id);
}

function gateEvidencePath(projectRoot, slug, phase) {
  return resolve(deliveryPaths(projectRoot, slug).gatesRoot, phase, 'organisation-policy-design.json');
}

function currentImpactDigest(projectRoot, slug, options = {}) {
  if (options.currentImpactDigest != null) {
    const value = String(options.currentImpactDigest);
    if (!DIGEST_PATTERN.test(value)) throw new Error('Current policy-material Impact digest must be SHA-256');
    return value;
  }
  try {
    const workspace = readImpactWorkspace(projectRoot, slug);
    const value = workspace.assessments?.[0]?.policyRelevantDigest;
    return DIGEST_PATTERN.test(String(value ?? '')) ? value : digest(EMPTY_IMPACT);
  } catch {
    return digest(EMPTY_IMPACT);
  }
}

function authority() {
  return {
    designTimeOnly: true,
    productionEnforcement: false,
    productionCodeExecution: false,
    buildApproved: false,
    manualQaApproved: false,
    complianceCertified: false,
    releaseApproved: false,
    residualRiskAccepted: false,
  };
}

function recoveryFor(status, reference) {
  if (status === 'not-evaluated') return [
    `Confirm the current policy design facts for ${reference}.`,
    'Use the deterministic evaluator to evaluate the policy design again.',
  ];
  if (status === 'stale') return ['Review the current material Impact changes, reconfirm the affected policy design facts, and evaluate the policy design again with the deterministic evaluator.'];
  if (status === 'invalid') return ['Restore the approved policy baseline and accepted evidence from a trusted project-local source, then reconfirm facts and evaluate again.'];
  if (status === 'deny') return ['Change the proposed design or obtain a current, rule-permitted, bounded exception from the named accountable role.'];
  if (status === 'review-required') return ['Record the required named human review against the exact current evaluation and role.'];
  if (status === 'unassessed') return ['Extend or correct the approved policy baseline so this design is explicitly assessed, then evaluate again.'];
  return ['Resolve the current organisational policy evidence before completing this design gate.'];
}

function safeProjectFile(projectRoot, reference, label) {
  const value = String(reference ?? '').trim().replaceAll('\\', '/');
  if (!value || isAbsolute(value) || value.includes('\0') || value.split('/').includes('..')) {
    throw new Error(`${label} must be a safe project-relative file`);
  }
  const root = resolve(projectRoot);
  const path = resolve(root, value);
  if (!isWithin(root, path) || !existsSync(path) || !statSync(path).isFile()) throw new Error(`${label} does not identify an existing project file: ${value}`);
  if (!isWithin(realpathSync(root), realpathSync(path))) throw new Error(`${label} may not escape the project through a symbolic link`);
  return relative(root, path).replaceAll('\\', '/');
}

function traceKey(value) {
  return `${value.ruleId}:${value.controlId}`;
}

function controlKey(control) {
  return `${control.ruleId}:${control.id}`;
}

function normalisedControls(policyStatus) {
  return (Array.isArray(policyStatus?.controls) ? policyStatus.controls : []).map((control, index) => {
    if (control.id && Array.isArray(control.evidence)) return control;
    const source = String(control.source ?? 'decision');
    const description = String(control.description ?? '').trim();
    return {
      ...control,
      id: `${source}-control-${digest({ ruleId: control.ruleId, description, index }).slice(7, 19)}`,
      title: control.title ?? `${source === 'exception' ? 'Compensating' : 'Review'} control`,
      description,
      evidence: ['named-human', 'specialist-review'],
    };
  });
}

function policyProjection(policyStatus) {
  return { ...policyStatus, controls: normalisedControls(policyStatus) };
}

export function validatePolicyControlTrace(projectRoot, slug, policyStatus, input = []) {
  const required = normalisedControls(policyStatus);
  if (!Array.isArray(input)) throw new Error('Policy control traces must be an array');
  const byKey = new Map(required.map((control) => [controlKey(control), control]));
  const seen = new Set();
  const traces = input.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Policy control trace ${index + 1} must be an object`);
    const unexpected = Object.keys(raw).filter((key) => !['ruleId', 'controlId', 'route', 'reference', 'owner'].includes(key));
    if (unexpected.length) throw new Error(`Policy control trace contains unsupported field(s): ${unexpected.join(', ')}`);
    const trace = {
      ruleId: String(raw.ruleId ?? '').trim(),
      controlId: String(raw.controlId ?? '').trim(),
      route: String(raw.route ?? '').trim(),
      reference: String(raw.reference ?? '').trim(),
      ...(raw.owner == null ? {} : { owner: String(raw.owner).trim() }),
    };
    const key = traceKey(trace);
    const control = byKey.get(key);
    if (!control) throw new Error(`Policy control trace does not match a required control: ${key}`);
    if (seen.has(key)) throw new Error(`Policy control ${key} has more than one asserted trace; retain one accountable route`);
    seen.add(key);
    if (!ROUTES.has(trace.route) || !control.evidence.includes(trace.route)) {
      throw new Error(`Policy control ${key} does not permit the ${trace.route || 'missing'} route`);
    }
    if (['claim', 'task'].includes(trace.route) && !IDENTIFIER.test(trace.reference)) {
      throw new Error(`Policy control ${key} requires a bounded ${trace.route} identifier`);
    }
    const deliveryRoot = deliveryPaths(projectRoot, slug).deliveryRoot;
    if (trace.route === 'claim') {
      const ledgerPath = resolve(deliveryRoot, 'gates/plan/claim-ledger.json');
      const ledger = existsSync(ledgerPath) ? readJson(ledgerPath, 'Claim Ledger') : {};
      const claims = [...(ledger.implementation_claims ?? []), ...(ledger.claims ?? [])];
      const claim = claims.find(({ id }) => id === trace.reference);
      if (!claim) throw new Error(`Policy control ${key} references an unknown Claim Ledger claim: ${trace.reference}`);
      trace.evidencePath = relative(resolve(projectRoot), ledgerPath).replaceAll('\\', '/');
      trace.evidenceDigest = digest(claim);
    } else if (trace.route === 'task') {
      const graphPath = resolve(deliveryRoot, 'task-graph.json');
      const graph = existsSync(graphPath) ? readJson(graphPath, 'Task graph') : {};
      const task = (graph.tasks ?? []).find(({ id }) => id === trace.reference);
      if (!task) throw new Error(`Policy control ${key} references an unknown bounded task: ${trace.reference}`);
      trace.evidencePath = relative(resolve(projectRoot), graphPath).replaceAll('\\', '/');
      trace.evidenceDigest = digest(task);
    } else {
      trace.reference = safeProjectFile(projectRoot, trace.reference, `Policy control ${key} ${trace.route} evidence`);
      if (trace.route === 'automated-test' && !/(?:^|\/)(?:tests?|specs?)(?:\/|$)|\.(?:test|spec)\.[a-z0-9]+$/i.test(trace.reference)) {
        throw new Error(`Policy control ${key} automated-test evidence must identify a test artefact`);
      }
      if (['named-human', 'specialist-review'].includes(trace.route) && (!trace.owner || trace.owner.length > 160)) {
        throw new Error(`Policy control ${key} ${trace.route} evidence requires a named owner`);
      }
      trace.evidencePath = trace.reference;
      trace.evidenceDigest = digest(readFileSync(resolve(projectRoot, trace.reference), 'utf8'));
    }
    return trace;
  }).sort((left, right) => traceKey(left).localeCompare(traceKey(right)));
  const missing = required.filter((control) => !seen.has(controlKey(control))).map((control) => controlKey(control));
  if (missing.length) throw new Error(`Missing actionable policy control trace(s): ${missing.join(', ')}`);
  return {
    schema: 'ewai.policy-control-trace-validation/v1',
    status: 'pass', required: required.length, traced: traces.length, traces,
    authority: authority(), notices: [POLICY_DESIGN_AUTHORITY_NOTICE],
  };
}

export function policyGateRequirementsForPhase(projectRoot, slug, phase) {
  const baseline = readPolicyBaselineStatus(projectRoot);
  if (baseline.status === 'not-configured' || !APPLICABLE_PHASES.has(phase)) {
    return { schema: 'ewai.policy-phase-requirements/v1', configured: baseline.status !== 'not-configured', status: baseline.status, phase, requirements: [] };
  }
  return {
    schema: 'ewai.policy-phase-requirements/v1', configured: true, status: baseline.status, phase,
    requirements: [{
      id: 'organisation-policy-design',
      artefactPath: `gates/${phase}/organisation-policy-design.json`,
      controlTraceRequired: phase === 'plan',
    }],
  };
}

function verifyGateDigest(record) {
  const { evidenceDigest, ...body } = record;
  return DIGEST_PATTERN.test(String(evidenceDigest ?? '')) && digest(body) === evidenceDigest;
}

export function readPolicyEvidenceFreshness(projectRoot, intentReference, options = {}) {
  const reference = safeIntentReference(intentReference);
  const slug = String(options.slug ?? reference.split('/')[1]);
  const phase = String(options.phase ?? 'plan');
  const baseline = readPolicyBaselineStatus(projectRoot);
  if (baseline.status === 'not-configured') {
    return { schema: 'ewai.policy-evidence-freshness/v1', status: 'not-configured', blocking: false, drift: [], recovery: [], notices: [POLICY_DESIGN_AUTHORITY_NOTICE] };
  }
  const policy = policyProjection(readPolicyEvaluationStatus(projectRoot, reference, options));
  const path = gateEvidencePath(projectRoot, slug, phase);
  if (!existsSync(path)) {
    return { schema: 'ewai.policy-evidence-freshness/v1', status: 'missing', blocking: true, drift: [{ kind: 'gate-evidence', status: 'missing' }], recovery: recoveryFor(policy.status, reference), policy, notices: [POLICY_DESIGN_AUTHORITY_NOTICE] };
  }
  let accepted;
  try { accepted = readJson(path, 'Organisation policy gate evidence'); } catch (error) {
    return { schema: 'ewai.policy-evidence-freshness/v1', status: 'invalid', blocking: true, drift: [{ kind: 'gate-evidence', status: 'invalid', message: error.message }], recovery: recoveryFor('invalid', reference), policy, notices: [POLICY_DESIGN_AUTHORITY_NOTICE] };
  }
  const drift = [];
  if (accepted.schema !== 'ewai.policy-phase-gate/v1' || accepted.phase !== phase || accepted.intentReference !== reference || !verifyGateDigest(accepted)) {
    drift.push({ kind: 'gate-evidence', status: 'changed' });
  }
  if (accepted.policy?.evaluationDigest !== policy.evaluationDigest) drift.push({ kind: 'evaluation-digest', prepared: accepted.policy?.evaluationDigest ?? null, current: policy.evaluationDigest ?? null });
  if (accepted.policy?.policyDigest !== policy.policyDigest) drift.push({ kind: 'policy-digest', prepared: accepted.policy?.policyDigest ?? null, current: policy.policyDigest ?? null });
  if (accepted.policy?.factsDigest !== policy.factsDigest) drift.push({ kind: 'facts-digest', prepared: accepted.policy?.factsDigest ?? null, current: policy.factsDigest ?? null });
  const impactDigest = currentImpactDigest(projectRoot, slug, options);
  if (accepted.impactDigest !== impactDigest) drift.push({ kind: 'policy-material-impact', prepared: accepted.impactDigest ?? null, current: impactDigest });
  if (phase === 'plan' && accepted.controlTrace?.status === 'pass') {
    try {
      const traceInput = accepted.controlTrace.traces.map(({ ruleId, controlId, route, reference: evidenceReference, owner }) => ({
        ruleId, controlId, route, reference: evidenceReference, ...(owner ? { owner } : {}),
      }));
      const currentTrace = validatePolicyControlTrace(projectRoot, slug, policy, traceInput);
      if (JSON.stringify(currentTrace) !== JSON.stringify(accepted.controlTrace)) drift.push({ kind: 'control-trace-evidence', status: 'changed' });
    } catch (error) {
      drift.push({ kind: 'control-trace-evidence', status: 'invalid', message: error.message });
    }
  }
  const stale = drift.length > 0 || policy.blocking === true;
  return {
    schema: 'ewai.policy-evidence-freshness/v1', status: stale ? 'stale' : 'current', blocking: stale,
    drift, recovery: stale ? recoveryFor(drift.some(({ kind }) => kind === 'policy-material-impact') ? 'stale' : policy.status, reference) : [],
    policy, impactDigest, evidencePath: relative(resolve(projectRoot), path).replaceAll('\\', '/'), notices: [POLICY_DESIGN_AUTHORITY_NOTICE],
  };
}

export function evaluatePolicyGate(projectRoot, slug, phase, input = {}, options = {}) {
  const requirements = policyGateRequirementsForPhase(projectRoot, slug, phase);
  if (!requirements.requirements.length) {
    return {
      schema: 'ewai.policy-phase-gate/v1', slug, phase, status: requirements.status,
      configured: false, blocking: false, blockers: [], recovery: [], notices: [POLICY_DESIGN_AUTHORITY_NOTICE], authority: authority(),
    };
  }
  const intentReference = deliveryIntentReference(projectRoot, slug);
  const policy = policyProjection(readPolicyEvaluationStatus(projectRoot, intentReference, options));
  const blockers = [];
  if (policy.blocking) blockers.push(policy.notice ?? `Organisation policy status is ${policy.status}.`);
  let controlTrace = null;
  if (!policy.blocking && phase === 'plan') {
    try {
      controlTrace = validatePolicyControlTrace(projectRoot, slug, policy, input.controlTraces ?? []);
    } catch (error) {
      blockers.push(error.message);
    }
  }
  const path = gateEvidencePath(projectRoot, slug, phase);
  if (existsSync(path)) {
    const accepted = readJson(path, 'Organisation policy gate evidence');
    const freshness = readPolicyEvidenceFreshness(projectRoot, intentReference, { ...options, slug, phase });
    const impactOnlyDrift = freshness.drift?.some(({ kind }) => kind === 'policy-material-impact')
      && freshness.policy?.evaluationDigest === accepted.policy?.evaluationDigest;
    const integrityDrift = freshness.drift?.some(({ kind }) => kind === 'gate-evidence');
    if (integrityDrift || impactOnlyDrift) {
      return {
        schema: 'ewai.policy-phase-gate/v1', slug, phase, intentReference, status: freshness.status,
        configured: true, blocking: true, blockers: freshness.drift.map(({ kind }) => `Policy evidence drift: ${kind}`),
        recovery: freshness.recovery, policy, impactDigest: freshness.impactDigest, notices: [POLICY_DESIGN_AUTHORITY_NOTICE], authority: authority(),
      };
    }
    const sameTrace = phase !== 'plan'
      || JSON.stringify(accepted.controlTrace?.traces ?? []) === JSON.stringify(controlTrace?.traces ?? []);
    if (!freshness.blocking && blockers.length === 0 && accepted.blocking === false && sameTrace) return accepted;
  }
  const record = {
    schema: 'ewai.policy-phase-gate/v1', slug, phase, intentReference,
    status: policy.status, configured: true, blocking: blockers.length > 0, blockers,
    recovery: blockers.length
      ? phase === 'plan' && blockers.some((item) => /control trace/i.test(item))
        ? ['Map every required policy control to an allowed Claim Ledger claim, bounded task, automated test, or named human or specialist evidence route.']
        : recoveryFor(policy.status, intentReference)
      : [],
    policy, impactDigest: currentImpactDigest(projectRoot, slug, options), controlTrace,
    notices: [POLICY_DESIGN_AUTHORITY_NOTICE], authority: authority(),
  };
  record.evidenceDigest = digest(record);
  atomicJson(path, record);
  return record;
}
