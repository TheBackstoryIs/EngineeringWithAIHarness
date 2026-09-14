import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { initProject } from '../src/project.mjs';
import { createIntent } from '../src/intents.mjs';
import { beginDelivery, phaseGateTemplate, recordPhaseGate } from '../src/delivery.mjs';
import { requiredPhaseArtefacts } from '../src/delivery-artifacts.mjs';
import { listOrganisationBlueprints, resolveOrganisationBlueprint } from '../src/organisation-blueprints.mjs';
import { materialisePolicyBaseline, resolveOrganisationPolicy } from '../src/organisation-policies.mjs';
import { confirmPolicyFacts, evaluatePolicyDesign, preparePolicyFacts } from '../src/policy-design-gates.mjs';
import {
  POLICY_DESIGN_AUTHORITY_NOTICE,
  evaluatePolicyGate,
  policyGateRequirementsForPhase,
  readPolicyEvidenceFreshness,
  validatePolicyControlTrace,
} from '../src/policy-gate-integration.mjs';

function sha(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function policy() {
  return {
    schema: 'ewai.organisation-policy/v1', id: 'delivery-policy', title: 'Delivery policy', version: '1.0.0',
    publisher: { id: 'northstar', name: 'Northstar Digital' },
    provenance: { kind: 'owner-declared', summary: 'Approved fixture.', sources: [{ id: 'board', label: 'Policy board' }] },
    review_roles: [], unmatched_outcome: 'unassessed',
    rules: [{
      id: 'production-control', title: 'Production control', description: 'Production designs require a traceable claim.',
      when: { environment: ['production'] }, outcome: 'allow-with-controls',
      controls: [{ id: 'audit-claim', title: 'Audit claim', description: 'Trace the control to an implementation claim.', evidence: ['claim'] }],
      exceptions: { permitted: false },
    }],
  };
}

function project({ configured = true } = {}) {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-policy-integration-'));
  const packsRoot = mkdtempSync(resolve(tmpdir(), 'ewai-policy-integration-packs-'));
  initProject(root, { name: 'Policy integration' });
  createIntent(root, { slug: 'policy-example', domain: 'platform', title: 'Policy example' });
  beginDelivery(root, 'policy-example', { tool: 'codex', existingCode: false, ui: false });
  if (!configured) return { root, packsRoot, resolved: null };
  const packRoot = resolve(packsRoot, 'org-northstar-delivery');
  mkdirSync(resolve(packRoot, 'policies'), { recursive: true });
  writeFileSync(resolve(packRoot, 'pack.yaml'), YAML.stringify({
    schema: 'ewai.pack/v1', id: 'org.northstar.delivery', name: 'Northstar Delivery', description: 'Governed delivery.',
    version: '1.0.0', type: 'organisation', requires: [],
    blueprint: { publisher: { id: 'northstar', name: 'Northstar Digital' }, compatibility: { ewai: '0.x' }, modules: [{
      id: 'policy', name: 'Policy', description: 'Delivery policy.', required: true,
      standards: [], personas: [], design_systems: [], starter_packs: [], boilerplates: [],
      policies: [{ id: 'delivery-policy', title: 'Delivery policy', source: 'policies/delivery-policy.yaml' }],
    }] },
  }, { lineWidth: 0 }));
  writeFileSync(resolve(packRoot, 'policies/delivery-policy.yaml'), YAML.stringify(policy(), { lineWidth: 0 }));
  const blueprint = resolveOrganisationBlueprint(
    'org.northstar.delivery',
    listOrganisationBlueprints({ roots: [{ path: packsRoot, sourceClass: 'project' }] }),
  );
  const resolved = resolveOrganisationPolicy(blueprint);
  materialisePolicyBaseline(root, resolved, {
    confirmed: true, approvedBy: 'Policy Owner', expectedDigest: resolved.effectiveDigest,
    now: '2026-08-28T18:00:00.000Z',
  });
  return { root, packsRoot, resolved };
}

function evaluate(root, resolved) {
  const intent = { reference: 'platform/policy-example', revision: 1, digest: sha('platform/policy-example:1') };
  const proposal = preparePolicyFacts(root, { intent, facts: [{
    id: 'environment-1', dimension: 'environment', values: ['production'], rationale: 'Production is the confirmed target.',
    source: { kind: 'observed', reference: 'SPECS/2.Purpose/intents/platform/policy-example.md' },
  }] });
  const facts = confirmPolicyFacts(root, {
    intentReference: intent.reference, expectedRevision: proposal.revision, expectedProposalDigest: proposal.proposalDigest,
    confirmed: true, authority: 'human', confirmedBy: 'Product Owner',
    decisions: proposal.facts.map(({ id }) => ({ factId: id, disposition: 'confirmed' })),
  });
  return evaluatePolicyDesign(root, {
    intentReference: intent.reference, expectedIntentRevision: 1,
    expectedPolicyDigest: resolved.effectiveDigest, expectedFactsDigest: facts.factsDigest,
  });
}

test('keeps projects without an approved policy baseline entirely non-blocking', () => {
  const { root, packsRoot } = project({ configured: false });
  try {
    assert.deepEqual(policyGateRequirementsForPhase(root, 'policy-example', 'intent').requirements, []);
    assert.equal(phaseGateTemplate(root, 'policy-example', 'intent').required_gates.some(({ id }) => id === 'organisation-policy-design'), false);
    assert.equal(requiredPhaseArtefacts(resolve(root, 'SPECS/6.Build/policy-example'), 'intent').includes('gates/intent/organisation-policy-design.json'), false);
    const result = evaluatePolicyGate(root, 'policy-example', 'intent');
    assert.equal(result.status, 'not-configured');
    assert.equal(result.blocking, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(packsRoot, { recursive: true, force: true });
  }
});

test('fails closed when enabled evidence is missing and adds only conditional Intent and Plan requirements', () => {
  const { root, packsRoot } = project();
  try {
    assert.equal(policyGateRequirementsForPhase(root, 'policy-example', 'intent').requirements[0].id, 'organisation-policy-design');
    assert.equal(policyGateRequirementsForPhase(root, 'policy-example', 'plan').requirements[0].id, 'organisation-policy-design');
    assert.deepEqual(policyGateRequirementsForPhase(root, 'policy-example', 'build').requirements, []);
    assert.equal(phaseGateTemplate(root, 'policy-example', 'intent').required_gates.some(({ id }) => id === 'organisation-policy-design'), true);
    assert.equal(requiredPhaseArtefacts(resolve(root, 'SPECS/6.Build/policy-example'), 'intent').includes('gates/intent/organisation-policy-design.json'), true);
    const result = evaluatePolicyGate(root, 'policy-example', 'intent');
    assert.equal(result.blocking, true);
    assert.equal(result.status, 'not-evaluated');
    assert.match(result.recovery.join(' '), /confirm.*facts.*evaluate/i);

    const deliveryRoot = resolve(root, 'SPECS/6.Build/policy-example');
    const template = phaseGateTemplate(root, 'policy-example', 'intent');
    const requiredGates = template.required_gates.map(({ id }) => {
      const outputPath = id === 'organisation-policy-design'
        ? 'gates/intent/organisation-policy-design.json'
        : `gates/intent/${id}.md`;
      const absolute = resolve(deliveryRoot, outputPath);
      mkdirSync(resolve(absolute, '..'), { recursive: true });
      writeFileSync(absolute, id === 'organisation-policy-design' ? '{"status":"allow"}\n' : `# ${id}\n`);
      return { id, commandOrSkill: `test:${id}`, outputPath: `SPECS/6.Build/policy-example/${outputPath}`, exitStatus: 0, status: 'pass' };
    });
    assert.throws(() => recordPhaseGate(root, 'policy-example', 'intent', {
      status: 'pass',
      honestyCheck: { sourceSectionsEdited: true, staleTextRemoved: true, noAppendOnlyCorrections: true, allCodeClaimsCited: true },
      requiredGates,
    }), /deterministic gate check/i);
    assert.match(
      readFileSync(resolve(deliveryRoot, 'gates/intent/phase-gate-check.md'), 'utf8'),
      /policy evidence|organisation-policy-design|policy result/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(packsRoot, { recursive: true, force: true });
  }
});

test('requires every Plan control to trace to real allowed delivery evidence', () => {
  const { root, packsRoot, resolved } = project();
  try {
    const evaluation = evaluate(root, resolved);
    const deliveryRoot = resolve(root, 'SPECS/6.Build/policy-example');
    mkdirSync(resolve(deliveryRoot, 'gates/plan'), { recursive: true });
    writeFileSync(resolve(deliveryRoot, 'gates/plan/claim-ledger.json'), `${JSON.stringify({
      implementation_claims: [{ id: 'CL-001', type: 'implementation', statement: 'Auditability is implemented.' }],
    }, null, 2)}\n`);

    const missing = evaluatePolicyGate(root, 'policy-example', 'plan');
    assert.equal(missing.blocking, true);
    assert.match(missing.blockers.join(' '), /control trace/i);
    assert.throws(() => validatePolicyControlTrace(root, 'policy-example', missing.policy, [{
      ruleId: 'delivery-policy:production-control', controlId: 'audit-claim', route: 'task', reference: 'T-404',
    }]), /does not permit.*task|not allowed/i);

    const traces = [{
      ruleId: 'delivery-policy:production-control', controlId: 'audit-claim', route: 'claim', reference: 'CL-001',
    }];
    const validated = validatePolicyControlTrace(root, 'policy-example', missing.policy, traces);
    assert.equal(validated.status, 'pass');
    assert.equal(validated.traced, 1);
    assert.match(validated.traces[0].evidenceDigest, /^sha256:[a-f0-9]{64}$/);
    const passing = evaluatePolicyGate(root, 'policy-example', 'plan', { controlTraces: traces });
    assert.equal(passing.status, 'allow-with-controls');
    assert.equal(passing.blocking, false);
    assert.equal(passing.policy.evaluationDigest, evaluation.evaluationDigest);
    assert.equal(passing.authority.productionEnforcement, false);
    assert.equal(passing.authority.buildApproved, false);
    assert.equal(passing.authority.manualQaApproved, false);
    assert.equal(passing.authority.releaseApproved, false);
    assert.equal(passing.notices.includes(POLICY_DESIGN_AUTHORITY_NOTICE), true);
    const persisted = JSON.parse(readFileSync(resolve(deliveryRoot, 'gates/plan/organisation-policy-design.json'), 'utf8'));
    assert.equal(persisted.policy.evaluationDigest, evaluation.evaluationDigest);
    writeFileSync(resolve(deliveryRoot, 'gates/plan/claim-ledger.json'), `${JSON.stringify({
      implementation_claims: [{ id: 'CL-001', type: 'implementation', statement: 'The accepted claim was materially changed.' }],
    }, null, 2)}\n`);
    const staleTrace = readPolicyEvidenceFreshness(root, 'platform/policy-example', { slug: 'policy-example', phase: 'plan' });
    assert.equal(staleTrace.status, 'stale');
    assert.equal(staleTrace.drift.some(({ kind }) => kind === 'control-trace-evidence'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(packsRoot, { recursive: true, force: true });
  }
});

test('invalidates accepted gate evidence only when the recorded material-impact digest changes', () => {
  const { root, packsRoot, resolved } = project();
  try {
    evaluate(root, resolved);
    const initialImpact = sha('data:internal|destination:approved');
    const changedImpact = sha('data:sensitive|destination:external-ai');
    const gate = evaluatePolicyGate(root, 'policy-example', 'intent', {}, { currentImpactDigest: initialImpact });
    assert.equal(gate.blocking, false);
    assert.equal(readPolicyEvidenceFreshness(root, 'platform/policy-example', {
      slug: 'policy-example', phase: 'intent', currentImpactDigest: initialImpact,
    }).status, 'current');
    const stale = readPolicyEvidenceFreshness(root, 'platform/policy-example', {
      slug: 'policy-example', phase: 'intent', currentImpactDigest: changedImpact,
    });
    assert.equal(stale.status, 'stale');
    assert.equal(stale.blocking, true);
    assert.match(stale.recovery.join(' '), /impact.*facts.*evaluate/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(packsRoot, { recursive: true, force: true });
  }
});
