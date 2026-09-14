import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import { initProject } from '../src/project.mjs';
import { listOrganisationBlueprints, resolveOrganisationBlueprint } from '../src/organisation-blueprints.mjs';
import { materialisePolicyBaseline, resolveOrganisationPolicy } from '../src/organisation-policies.mjs';
import {
  confirmPolicyFacts,
  evaluatePolicyDesign,
  preparePolicyFacts,
  readPolicyEvaluationStatus,
  recordPolicyException,
  recordPolicyReview,
} from '../src/policy-design-gates.mjs';

function sha(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function policy() {
  return {
    schema: 'ewai.organisation-policy/v1',
    id: 'design-assurance',
    title: 'Design assurance policy',
    version: '1.0.0',
    publisher: { id: 'northstar', name: 'Northstar Digital' },
    provenance: {
      kind: 'owner-declared',
      summary: 'Approved design-time policy fixture.',
      sources: [{ id: 'policy-board', label: 'Policy board decision' }],
    },
    review_roles: [
      { id: 'security-owner', name: 'Security Owner' },
      { id: 'data-owner', name: 'Data Owner' },
    ],
    unmatched_outcome: 'unassessed',
    rules: [
      {
        id: 'sensitive-external-ai',
        title: 'Sensitive data external AI exception',
        description: 'Sensitive data may not use external AI without a bounded exception.',
        when: { data_classification: ['sensitive'], destination: ['external-ai'] },
        outcome: 'deny',
        controls: [],
        exceptions: { permitted: true, review_role: 'security-owner' },
      },
      {
        id: 'regulated-external-ai',
        title: 'Regulated data external AI prohibition',
        description: 'Regulated data may not use external AI.',
        when: { data_classification: ['regulated'], destination: ['external-ai'] },
        outcome: 'deny',
        controls: [],
        exceptions: { permitted: false },
      },
      {
        id: 'generative-ai-review',
        title: 'Generative AI review',
        description: 'Generative AI use requires a named security review.',
        when: { ai_use: ['generative'] },
        outcome: 'review-required',
        review_role: 'security-owner',
        controls: [],
        exceptions: { permitted: false },
      },
      {
        id: 'production-audit-control',
        title: 'Production audit evidence',
        description: 'Production changes need an auditable design claim.',
        when: { environment: ['production'] },
        outcome: 'allow-with-controls',
        controls: [{
          id: 'audit-claim',
          title: 'Audit claim',
          description: 'Map the design to an auditable Claim Ledger claim.',
          evidence: ['claim', 'named-human'],
        }],
        exceptions: { permitted: false },
      },
      {
        id: 'internal-allow',
        title: 'Internal processing',
        description: 'Internal non-generative processing is allowed.',
        when: { destination: ['approved-internal'], ai_use: ['none'] },
        outcome: 'allow',
        controls: [],
        exceptions: { permitted: false },
      },
    ],
  };
}

function setupProject() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-policy-gates-'));
  const packsRoot = mkdtempSync(resolve(tmpdir(), 'ewai-policy-gates-packs-'));
  initProject(root, { name: 'Policy gates project' });
  const directory = resolve(packsRoot, 'org-northstar-engineering');
  const manifest = {
    schema: 'ewai.pack/v1',
    id: 'org.northstar.engineering',
    name: 'Northstar Engineering',
    description: 'Northstar governed delivery.',
    version: '1.0.0',
    type: 'organisation',
    requires: [],
    blueprint: {
      publisher: { id: 'northstar', name: 'Northstar Digital' },
      compatibility: { ewai: '0.x' },
      modules: [{
        id: 'policy', name: 'Policy', description: 'Design assurance policy.', required: true,
        standards: [], personas: [], design_systems: [], starter_packs: [], boilerplates: [],
        policies: [{ id: 'design-assurance', title: 'Design assurance policy', source: 'policies/design-assurance.yaml' }],
      }],
    },
  };
  mkdirSync(resolve(directory, 'policies'), { recursive: true });
  writeFileSync(resolve(directory, 'pack.yaml'), YAML.stringify(manifest, { lineWidth: 0 }));
  writeFileSync(resolve(directory, 'policies/design-assurance.yaml'), YAML.stringify(policy(), { lineWidth: 0 }));
  const blueprint = resolveOrganisationBlueprint(
    'org.northstar.engineering',
    listOrganisationBlueprints({ roots: [{ path: packsRoot, sourceClass: 'project' }] }),
  );
  const resolved = resolveOrganisationPolicy(blueprint);
  materialisePolicyBaseline(root, resolved, {
    confirmed: true,
    approvedBy: 'Organisation Policy Owner',
    expectedDigest: resolved.effectiveDigest,
    now: '2026-08-28T18:00:00.000Z',
  });
  return { root, packsRoot, resolved };
}

function intent(reference = 'platform/policy-example', revision = 1) {
  return { reference, revision, digest: sha(`${reference}:${revision}`) };
}

function proposedFacts(values, reference = 'platform/policy-example') {
  return Object.entries(values).map(([dimension, factValues], index) => ({
    id: `${dimension.replaceAll('_', '-')}-${index + 1}`,
    dimension,
    values: Array.isArray(factValues) ? factValues : [factValues],
    rationale: `Proposed ${dimension} design fact.`,
    source: index === 0
      ? { kind: 'observed', reference: `SPECS evidence for ${dimension}` }
      : { kind: 'model-proposal', reference: 'Standard LLM design-fact pass' },
  }));
}

function confirm(root, values, reference = 'platform/policy-example', revision = 1) {
  const prepared = preparePolicyFacts(root, { intent: intent(reference, revision), facts: proposedFacts(values, reference) }, {
    now: '2026-08-28T18:10:00.000Z',
  });
  return confirmPolicyFacts(root, {
    intentReference: reference,
    expectedRevision: prepared.revision,
    expectedProposalDigest: prepared.proposalDigest,
    confirmed: true,
    authority: 'human',
    confirmedBy: 'Product Owner',
    decisions: prepared.facts.map(({ id }) => ({ factId: id, disposition: 'confirmed' })),
  }, { now: '2026-08-28T18:11:00.000Z' });
}

test('preserves fact provenance while requiring complete named human confirmation', () => {
  const { root, packsRoot, resolved } = setupProject();
  try {
    const prepared = preparePolicyFacts(root, {
      intent: intent(),
      facts: [
        ...proposedFacts({ data_classification: 'sensitive' }),
        {
          id: 'destination-2',
          dimension: 'destination',
          values: ['external-ai'],
          rationale: 'A persona suggests checking the proposed external destination.',
          source: {
            kind: 'persona-hypothesis',
            reference: 'Policy fact challenge',
            persona: { id: 'premium.privacy-officer', name: 'Privacy Officer', tier: 'premium', rawDefinition: 'must not persist' },
          },
        },
      ],
    }, { now: '2026-08-28T18:10:00.000Z' });
    assert.equal(prepared.authority.authoritative, false);
    assert.equal(JSON.parse(readFileSync('config/policy-facts.schema.json', 'utf8')).$defs.confirmed.type, 'object');
    assert.equal(JSON.parse(readFileSync('config/policy-evaluation.schema.json', 'utf8')).$defs.evaluation.type, 'object');
    assert.equal(prepared.policyDigest, resolved.effectiveDigest);
    assert.equal(JSON.stringify(prepared).includes('must not persist'), false);
    assert.equal(existsSync(resolve(root, 'SPECS/3.Evidence/policy/facts/platform/policy-example.json')), false);

    const base = {
      intentReference: 'platform/policy-example', expectedRevision: prepared.revision,
      expectedProposalDigest: prepared.proposalDigest, confirmed: true, confirmedBy: 'Product Owner',
      decisions: prepared.facts.map(({ id }) => ({ factId: id, disposition: 'confirmed' })),
    };
    assert.throws(() => confirmPolicyFacts(root, { ...base, authority: 'model' }), /named human authority/i);
    assert.throws(() => confirmPolicyFacts(root, { ...base, authority: 'human', confirmedBy: '' }), /named confirmer/i);
    assert.throws(() => confirmPolicyFacts(root, { ...base, authority: 'human', decisions: base.decisions.slice(0, 1) }), /every proposed fact/i);
    assert.throws(() => confirmPolicyFacts(root, { ...base, authority: 'human', expectedRevision: 0 }), /newer revision/i);

    const confirmed = confirmPolicyFacts(root, { ...base, authority: 'human' }, { now: '2026-08-28T18:11:00.000Z' });
    assert.equal(confirmed.authority.authoritative, true);
    assert.equal(confirmed.confirmation.confirmedBy, 'Product Owner');
    assert.equal(confirmed.confirmation.decisions.length, prepared.facts.length);
    assert.match(confirmed.factsDigest, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(confirmed.facts.map(({ provenance }) => provenance.kind), ['observed', 'persona-hypothesis']);
    assert.equal(JSON.stringify(confirmed).includes('rawDefinition'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(packsRoot, { recursive: true, force: true });
  }
});

test('matches closed facts with restrictive precedence and keeps every matched rule visible', () => {
  const { root, packsRoot, resolved } = setupProject();
  try {
    const cases = [
      {
        reference: 'platform/deny-case',
        facts: { data_classification: 'sensitive', destination: 'external-ai', ai_use: 'generative', environment: 'production' },
        outcome: 'deny',
        matched: ['generative-ai-review', 'production-audit-control', 'sensitive-external-ai'],
      },
      { reference: 'platform/review-case', facts: { ai_use: 'generative', destination: 'approved-internal' }, outcome: 'review-required', matched: ['generative-ai-review'] },
      { reference: 'platform/control-case', facts: { environment: 'production', ai_use: 'none' }, outcome: 'allow-with-controls', matched: ['production-audit-control'] },
      { reference: 'platform/allow-case', facts: { destination: 'approved-internal', ai_use: 'none' }, outcome: 'allow', matched: ['internal-allow'] },
      { reference: 'platform/unassessed-case', facts: { destination: 'new-destination', ai_use: 'none' }, outcome: 'unassessed', matched: [] },
    ];
    for (const scenario of cases) {
      const facts = confirm(root, scenario.facts, scenario.reference);
      const evaluation = evaluatePolicyDesign(root, {
        intentReference: scenario.reference,
        expectedIntentRevision: 1,
        expectedPolicyDigest: resolved.effectiveDigest,
        expectedFactsDigest: facts.factsDigest,
      });
      assert.equal(evaluation.governingOutcome, scenario.outcome, scenario.reference);
      assert.deepEqual(evaluation.matchedRules.map(({ ruleId }) => ruleId).sort(), scenario.matched, scenario.reference);
      assert.equal(evaluation.authority.designTimeOnly, true);
      assert.equal(evaluation.authority.productionEnforcement, false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(packsRoot, { recursive: true, force: true });
  }
});

test('produces stable evaluation digests and stays within the bounded evaluator budget', () => {
  const { root, packsRoot, resolved } = setupProject();
  try {
    const facts = confirm(root, { environment: 'production', destination: 'approved-internal', ai_use: 'none' }, 'platform/deterministic');
    const input = {
      intentReference: 'platform/deterministic', expectedIntentRevision: 1,
      expectedPolicyDigest: resolved.effectiveDigest, expectedFactsDigest: facts.factsDigest,
    };
    const first = evaluatePolicyDesign(root, input);
    const second = evaluatePolicyDesign(root, input);
    assert.deepEqual(second, first);
    assert.equal(second.evaluationDigest, first.evaluationDigest);

    const evaluationPath = resolve(root, 'SPECS/3.Evidence/policy/evaluations/platform/deterministic.json');
    const acceptedEvaluation = readFileSync(evaluationPath, 'utf8');
    const tamperedEvaluation = JSON.parse(acceptedEvaluation);
    tamperedEvaluation.governingOutcome = 'allow';
    writeFileSync(evaluationPath, `${JSON.stringify(tamperedEvaluation, null, 2)}\n`);
    assert.equal(readPolicyEvaluationStatus(root, 'platform/deterministic').status, 'invalid');
    writeFileSync(evaluationPath, acceptedEvaluation);

    const rssBefore = process.memoryUsage().rss;
    const durations = [];
    for (let index = 0; index < 31; index += 1) {
      const started = process.hrtime.bigint();
      evaluatePolicyDesign(root, input, { persist: false });
      durations.push(Number(process.hrtime.bigint() - started) / 1_000_000);
    }
    durations.sort((left, right) => left - right);
    assert.equal(durations[Math.floor(durations.length / 2)] < 50, true, `median ${durations[Math.floor(durations.length / 2)]}ms`);
    assert.equal(process.memoryUsage().rss - rssBefore < 24 * 1024 * 1024, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(packsRoot, { recursive: true, force: true });
  }
});

test('binds named reviews to the exact evaluation and rejects stale or wrong-role decisions', () => {
  const { root, packsRoot, resolved } = setupProject();
  try {
    const reference = 'platform/review-decision';
    const facts = confirm(root, { ai_use: 'generative', destination: 'approved-internal' }, reference);
    const evaluation = evaluatePolicyDesign(root, {
      intentReference: reference, expectedIntentRevision: 1,
      expectedPolicyDigest: resolved.effectiveDigest, expectedFactsDigest: facts.factsDigest,
    });
    const input = {
      intentReference: reference,
      evaluationDigest: evaluation.evaluationDigest,
      ruleId: 'design-assurance:generative-ai-review',
      authority: 'human',
      reviewedBy: 'Security Reviewer',
      reviewerRole: 'security-owner',
      decision: 'allow',
      rationale: 'The bounded internal design and evidence are acceptable.',
      evidence: ['SPECS/3.Evidence/security/internal-ai-review.md'],
    };
    assert.throws(() => recordPolicyReview(root, { ...input, authority: 'model' }), /named human authority/i);
    assert.throws(() => recordPolicyReview(root, { ...input, reviewerRole: 'data-owner' }), /required review role/i);
    assert.throws(() => recordPolicyReview(root, { ...input, evaluationDigest: sha('stale') }), /stale evaluation/i);
    const review = recordPolicyReview(root, input, { now: '2026-08-28T18:20:00.000Z' });
    assert.equal(review.reviewedBy, 'Security Reviewer');
    assert.equal(review.evaluationDigest, evaluation.evaluationDigest);
    assert.equal(readPolicyEvaluationStatus(root, reference).status, 'allow');
    assert.deepEqual(recordPolicyReview(root, input, { now: '2026-08-28T18:20:00.000Z' }), review);
    assert.throws(() => recordPolicyReview(root, { ...input, decision: 'deny' }), /already has a current decision|new evaluation/i);

    const reviewRoot = resolve(root, 'SPECS/3.Evidence/policy/reviews/platform/review-decision');
    const reviewPath = resolve(reviewRoot, readdirSync(reviewRoot).find((name) => name.endsWith('.json')));
    const acceptedReview = readFileSync(reviewPath, 'utf8');
    const tamperedReview = JSON.parse(acceptedReview);
    tamperedReview.decision = 'deny';
    writeFileSync(reviewPath, `${JSON.stringify(tamperedReview, null, 2)}\n`);
    assert.equal(readPolicyEvaluationStatus(root, reference).status, 'review-required');
    writeFileSync(reviewPath, acceptedReview);

    confirm(root, { ai_use: 'none', destination: 'approved-internal' }, reference, 2);
    assert.equal(readPolicyEvaluationStatus(root, reference).status, 'stale');
    assert.throws(() => recordPolicyReview(root, input), /stale evaluation/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(packsRoot, { recursive: true, force: true });
  }
});

test('permits only bounded owned current rule-authorised exceptions with compensating controls', () => {
  const { root, packsRoot, resolved } = setupProject();
  try {
    const reference = 'platform/exception-decision';
    const facts = confirm(root, { data_classification: 'sensitive', destination: 'external-ai', ai_use: 'none' }, reference);
    const evaluation = evaluatePolicyDesign(root, {
      intentReference: reference, expectedIntentRevision: 1,
      expectedPolicyDigest: resolved.effectiveDigest, expectedFactsDigest: facts.factsDigest,
    });
    const input = {
      intentReference: reference,
      evaluationDigest: evaluation.evaluationDigest,
      ruleId: 'design-assurance:sensitive-external-ai',
      authority: 'human',
      approvedBy: 'Security Exception Owner',
      owner: 'Service Owner',
      reviewerRole: 'security-owner',
      scope: { data_classification: ['sensitive'], destination: ['external-ai'] },
      rationale: 'A bounded time-limited migration needs this exact route.',
      compensatingControls: ['Redact direct identifiers', 'Review every generated output'],
      evidence: ['SPECS/3.Evidence/security/migration-exception.md'],
      expiresAt: '2026-09-30T00:00:00.000Z',
    };
    assert.throws(() => recordPolicyException(root, { ...input, authority: 'model' }, { now: '2026-08-28T18:30:00.000Z' }), /named human authority/i);
    assert.throws(() => recordPolicyException(root, { ...input, scope: { environment: ['production'] } }, { now: '2026-08-28T18:30:00.000Z' }), /bounded by the matched rule/i);
    assert.throws(() => recordPolicyException(root, { ...input, compensatingControls: [] }, { now: '2026-08-28T18:30:00.000Z' }), /compensating control/i);
    assert.throws(() => recordPolicyException(root, { ...input, owner: '' }, { now: '2026-08-28T18:30:00.000Z' }), /owner/i);
    assert.throws(() => recordPolicyException(root, { ...input, expiresAt: '2026-08-01T00:00:00.000Z' }, { now: '2026-08-28T18:30:00.000Z' }), /future expiry/i);

    const exception = recordPolicyException(root, input, { now: '2026-08-28T18:30:00.000Z' });
    assert.equal(exception.owner, 'Service Owner');
    assert.throws(() => recordPolicyException(root, {
      ...input,
      rationale: 'A different rationale must not silently supersede the accepted exception.',
    }, { now: '2026-08-28T18:31:00.000Z' }), /already has a current decision|new evaluation/i);
    assert.equal(readPolicyEvaluationStatus(root, reference, { now: '2026-08-29T00:00:00.000Z' }).status, 'allow-with-controls');

    const exceptionRoot = resolve(root, 'SPECS/3.Evidence/policy/exceptions/platform/exception-decision');
    const exceptionPath = resolve(exceptionRoot, readdirSync(exceptionRoot).find((name) => name.endsWith('.json')));
    const acceptedException = readFileSync(exceptionPath, 'utf8');
    const tamperedException = JSON.parse(acceptedException);
    tamperedException.compensatingControls = ['Removed the accepted safeguards'];
    writeFileSync(exceptionPath, `${JSON.stringify(tamperedException, null, 2)}\n`);
    assert.equal(readPolicyEvaluationStatus(root, reference, { now: '2026-08-29T00:00:00.000Z' }).status, 'deny');
    writeFileSync(exceptionPath, acceptedException);
    assert.equal(readPolicyEvaluationStatus(root, reference, { now: '2026-10-01T00:00:00.000Z' }).status, 'deny');

    const prohibitedReference = 'platform/prohibited-exception';
    const prohibitedFacts = confirm(root, { data_classification: 'regulated', destination: 'external-ai', ai_use: 'none' }, prohibitedReference);
    const prohibited = evaluatePolicyDesign(root, {
      intentReference: prohibitedReference, expectedIntentRevision: 1,
      expectedPolicyDigest: resolved.effectiveDigest, expectedFactsDigest: prohibitedFacts.factsDigest,
    });
    assert.throws(() => recordPolicyException(root, {
      ...input,
      intentReference: prohibitedReference,
      evaluationDigest: prohibited.evaluationDigest,
      ruleId: 'design-assurance:regulated-external-ai',
    }, { now: '2026-08-28T18:30:00.000Z' }), /does not permit exceptions/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(packsRoot, { recursive: true, force: true });
  }
});
