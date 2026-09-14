import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { initProject } from '../src/project.mjs';
import { ASSURANCE_NOTICE } from '../src/security-validation-config.mjs';
import {
  POLICY_DESIGN_AUTHORITY_NOTICE,
} from '../src/policy-gate-integration.mjs';
import {
  READINESS_AUTHORITY_NOTICE,
  listSolutionReadinessProfiles,
  prepareSolutionReadinessReview,
  readSolutionReadinessStatus,
  recordSolutionReadinessReview,
} from '../src/solution-readiness.mjs';

const allDimensions = [
  'purpose-acceptance', 'impact', 'standards', 'tests', 'manual-qa', 'external-validation',
  'security', 'technology-hosting', 'deployment-operations', 'documentation-training',
  'governance-specialist-assurance',
];

function createProject() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-readiness-'));
  initProject(root, { name: 'Readiness Test' });
  const deliveryRoot = resolve(root, 'SPECS/6.Build/sample-delivery');
  mkdirSync(deliveryRoot, { recursive: true });
  writeFileSync(resolve(deliveryRoot, 'delivery-state.json'), `${JSON.stringify({
    schema: 'ewai.delivery-state/v1', slug: 'sample-delivery', status: 'in-progress', currentPhase: 'delivery',
    phases: [], humanGates: [{ id: 'manual-qa', status: 'pending' }], approvals: { build: { decision: 'approved' } },
  }, null, 2)}\n`);
  mkdirSync(resolve(root, 'SPECS/2.Purpose/intents/quality'), { recursive: true });
  writeFileSync(resolve(root, 'SPECS/2.Purpose/intents/quality/sample-delivery.md'), '# Sample delivery\n');
  return root;
}

function evidence(root, overrides = {}) {
  const intentPath = 'SPECS/2.Purpose/intents/quality/sample-delivery.md';
  const defaultEntry = (id) => ({
    state: 'satisfied',
    summary: `${id} evidence is present.`,
    citations: [{ sourceType: id, path: intentPath, recordedAt: '2026-08-24T08:00:00.000Z', limitation: 'Fixture evidence only.' }],
  });
  return Object.fromEntries(allDimensions.map((id) => [id, overrides[id] ?? defaultEntry(id)]));
}

function personas() {
  return [
    { id: 'ewai.core.operator', name: 'Operator', tier: 'core', category: 'operations', description: 'Operates releases safely.', tags: ['operations', 'release'], capabilities: ['operations'] },
    { id: 'project.product-owner', name: 'Project Product Owner', tier: 'project', category: 'product', description: 'Owns intended outcomes.', tags: ['readiness', 'acceptance'], capabilities: ['product'] },
    { id: 'premium.security-lead', name: 'Security Lead', tier: 'premium', category: 'security', description: 'Challenges security evidence and residual risk.', tags: ['security', 'risk'], capabilities: ['security-assurance'] },
    { id: 'personal.service-reviewer', name: 'Service Reviewer', tier: 'personal', category: 'operations', description: 'Challenges deployment operations.', tags: ['deployment', 'operations'], capabilities: ['service-assurance'] },
  ];
}

function acceptedReview(preparation, overrides = {}) {
  return {
    schema: 'ewai.solution-readiness-review-input/v1',
    assessmentId: preparation.assessmentId,
    preparedDigest: preparation.brief.digest,
    dimensions: preparation.brief.dimensions.filter((item) => item.required).map((item) => ({
      id: item.id,
      disposition: 'accepted',
      reason: `Reviewed ${item.id} against its cited evidence.`,
      sourceRefs: item.citations.map((citation) => citation.id),
      conditions: [],
      residualRisks: [],
      ...(overrides[item.id] ?? {}),
    })),
    notes: 'Advisory review only.',
  };
}

test('lists five proportionate immutable profiles', () => {
  const profiles = listSolutionReadinessProfiles();
  assert.deepEqual(profiles.map((item) => item.id), ['internal-only', 'internal-sensitive', 'client-facing', 'public-service', 'critical-regulated']);
  assert.equal(profiles.every((item) => item.requiredDimensions.length > 0 && item.requiredHumanRoles.length > 0), true);
  assert.equal(profiles.at(-1).requiredDimensions.length > profiles[0].requiredDimensions.length, true);
  assert.throws(() => { profiles[0].requiredDimensions.push('mutated'); }, /object is not extensible|read only|Cannot add/i);
});

test('prepares a revision-bound cited brief with visible baseline and optional specialist personas', () => {
  const root = createProject();
  try {
    const preparation = prepareSolutionReadinessReview(root, 'sample-delivery', 'critical-regulated', {
      revision: 'HEAD:fixture-a', evidence: evidence(root), personaCatalogue: personas(), now: '2026-08-24T09:00:00.000Z',
    });
    assert.equal(preparation.status, 'prepared');
    assert.match(preparation.assessmentId, /^[a-f0-9]{16}$/);
    assert.equal(preparation.brief.profile.id, 'critical-regulated');
    assert.equal(preparation.brief.repositoryRevision, 'HEAD:fixture-a');
    assert.deepEqual(preparation.brief.dimensions.map((item) => item.id), allDimensions);
    assert.equal(preparation.brief.dimensions.every((item) => ['satisfied', 'conditional', 'blocking', 'missing', 'stale', 'not-applicable', 'not-configured'].includes(item.state)), true);
    assert.equal(preparation.brief.dimensions.every((item) => item.citations.every((citation) => !citation.path.startsWith('/'))), true);
    assert.deepEqual(new Set(preparation.brief.activePersonas.map((item) => item.tier)), new Set(['core', 'project', 'premium', 'personal']));
    assert.equal(preparation.brief.activePersonas.every((item) => item.engagementReason && !('body' in item)), true);
    assert.equal(preparation.brief.notices.includes(ASSURANCE_NOTICE), true);
    assert.equal(preparation.brief.notices.includes(READINESS_AUTHORITY_NOTICE), true);
    assert.equal(preparation.brief.notices.includes(POLICY_DESIGN_AUTHORITY_NOTICE), true);
    assert.equal(existsSync(resolve(root, preparation.paths.briefJson)), true);
    assert.equal(existsSync(resolve(root, preparation.paths.briefMarkdown)), true);
    assert.equal(existsSync(resolve(root, preparation.paths.reviewTemplate)), true);
    assert.match(readFileSync(resolve(root, preparation.paths.briefMarkdown), 'utf8'), /Security validation is evidence/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps missing evidence honest and rejects unsafe delivery and citation paths', () => {
  const root = createProject();
  try {
    const sparse = evidence(root, {
      impact: { state: 'missing', summary: 'No Impact assessment exists.', citations: [] },
      'technology-hosting': { state: 'not-configured', summary: 'No reviewed profile exists.', citations: [] },
    });
    const preparation = prepareSolutionReadinessReview(root, 'sample-delivery', 'client-facing', { revision: 'fixture', evidence: sparse, personaCatalogue: personas() });
    assert.equal(preparation.brief.dimensions.find((item) => item.id === 'impact').state, 'missing');
    assert.equal(preparation.brief.dimensions.find((item) => item.id === 'technology-hosting').state, 'not-configured');
    assert.throws(() => prepareSolutionReadinessReview(root, '../escape', 'internal-only', { revision: 'fixture', evidence: sparse }), /slug|kebab/i);
    const unsafe = evidence(root, { impact: { state: 'satisfied', summary: 'Unsafe.', citations: [{ sourceType: 'impact', path: '/private/report.json', recordedAt: '2026-08-24T08:00:00.000Z', limitation: '' }] } });
    assert.throws(() => prepareSolutionReadinessReview(root, 'sample-delivery', 'client-facing', { revision: 'fixture', evidence: unsafe }), /project-relative|citation/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('records immutable named reviews, derives conservative results and detects drift', () => {
  const root = createProject();
  try {
    const preparation = prepareSolutionReadinessReview(root, 'sample-delivery', 'internal-only', {
      revision: 'HEAD:fixture-a', evidence: evidence(root), personaCatalogue: personas(), now: '2026-08-24T09:00:00.000Z',
    });
    const conditionalId = preparation.brief.dimensions.find((item) => item.required).id;
    const input = acceptedReview(preparation, {
      [conditionalId]: {
        disposition: 'conditional',
        reason: 'A controlled rollout condition remains.',
        conditions: [{ text: 'Complete the monitored pilot.', owner: 'Service Owner', reviewBy: '2026-09-30T12:00:00.000Z' }],
        residualRisks: [{ summary: 'Pilot traffic may not represent peak load.', owner: 'Service Owner', reviewBy: '2026-09-30T12:00:00.000Z' }],
      },
    });
    const recorded = recordSolutionReadinessReview(root, preparation.assessmentId, input, { reviewedBy: 'Andre Boyle', now: '2026-08-24T10:00:00.000Z' });
    assert.equal(recorded.status, 'recorded');
    assert.equal(recorded.report.result, 'conditional');
    assert.equal(recorded.report.reviewedBy, 'Andre Boyle');
    assert.equal(recorded.report.conditions[0].owner, 'Service Owner');
    assert.equal(recorded.report.notices.includes(ASSURANCE_NOTICE), true);
    assert.equal(recorded.report.notices.includes(POLICY_DESIGN_AUTHORITY_NOTICE), true);
    assert.equal(recorded.report.authority.policyDecisionChanged, false);
    assert.throws(() => recordSolutionReadinessReview(root, preparation.assessmentId, input, { reviewedBy: 'Another reviewer' }), /already exists/i);
    assert.equal(readSolutionReadinessStatus(root, preparation.assessmentId, { revision: 'HEAD:fixture-a' }).status, 'current');
    const stale = readSolutionReadinessStatus(root, preparation.assessmentId, { revision: 'HEAD:fixture-b' });
    assert.equal(stale.status, 'stale');
    assert.equal(stale.drift.some((item) => item.kind === 'repository-revision'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does not allow a required missing dimension to be accepted', () => {
  const root = createProject();
  try {
    const preparation = prepareSolutionReadinessReview(root, 'sample-delivery', 'client-facing', {
      revision: 'fixture', evidence: evidence(root, { impact: { state: 'missing', summary: 'No Impact assessment exists.', citations: [] } }), personaCatalogue: personas(),
    });
    const input = acceptedReview(preparation);
    const impact = input.dimensions.find((item) => item.id === 'impact');
    impact.disposition = 'accepted';
    impact.reason = 'Proceed anyway.';
    assert.throws(() => recordSolutionReadinessReview(root, preparation.assessmentId, input, { reviewedBy: 'Owner' }), /cannot be accepted|missing/i);
    assert.equal(existsSync(resolve(root, 'SPECS/3.Evidence/readiness/sample-delivery', preparation.assessmentId, 'readiness-report.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validates digest, evidence references and accountable review dates', () => {
  const root = createProject();
  try {
    const preparation = prepareSolutionReadinessReview(root, 'sample-delivery', 'internal-only', {
      revision: 'fixture-validation', evidence: evidence(root), personaCatalogue: personas(), now: '2026-08-24T09:00:00.000Z',
    });
    const badDigest = acceptedReview(preparation);
    badDigest.preparedDigest = 'wrong';
    assert.throws(() => recordSolutionReadinessReview(root, preparation.assessmentId, badDigest, { reviewedBy: 'Owner' }), /digest does not match/i);
    const badReference = acceptedReview(preparation);
    badReference.dimensions[0].sourceRefs = ['EVD-unknown'];
    assert.throws(() => recordSolutionReadinessReview(root, preparation.assessmentId, badReference, { reviewedBy: 'Owner' }), /unknown evidence/i);
    const expired = acceptedReview(preparation, {
      [preparation.brief.dimensions.find((item) => item.required).id]: {
        disposition: 'conditional', reason: 'Temporary condition.',
        conditions: [{ text: 'Resolve the condition.', owner: 'Owner', reviewBy: '2026-08-24T08:00:00.000Z' }],
      },
    });
    assert.throws(() => recordSolutionReadinessReview(root, preparation.assessmentId, expired, { reviewedBy: 'Owner', now: '2026-08-24T10:00:00.000Z' }), /future/i);
    const unknownDimension = acceptedReview(preparation);
    unknownDimension.dimensions.push({ id: 'invented', disposition: 'accepted', reason: 'Invented.', sourceRefs: [], conditions: [], residualRisks: [] });
    assert.throws(() => recordSolutionReadinessReview(root, preparation.assessmentId, unknownDimension, { reviewedBy: 'Owner' }), /unknown|required dimension/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('derives blocked, insufficient and ready-for-human-decision without averaging evidence', () => {
  const root = createProject();
  try {
    const blockedPreparation = prepareSolutionReadinessReview(root, 'sample-delivery', 'internal-only', {
      revision: 'fixture-blocked', evidence: evidence(root), personaCatalogue: personas(),
    });
    const blockedInput = acceptedReview(blockedPreparation);
    blockedInput.dimensions[0].disposition = 'blocked';
    blockedInput.dimensions[0].reason = 'An accountable reviewer found a release blocker.';
    assert.equal(recordSolutionReadinessReview(root, blockedPreparation.assessmentId, blockedInput, { reviewedBy: 'Owner' }).report.result, 'blocked');

    const insufficientPreparation = prepareSolutionReadinessReview(root, 'sample-delivery', 'client-facing', {
      revision: 'fixture-insufficient', evidence: evidence(root, { impact: { state: 'missing', summary: 'Impact is missing.', citations: [] } }), personaCatalogue: personas(),
    });
    const insufficientInput = acceptedReview(insufficientPreparation);
    const impact = insufficientInput.dimensions.find((item) => item.id === 'impact');
    impact.disposition = 'insufficient-evidence';
    impact.reason = 'Impact evidence must be completed.';
    assert.equal(recordSolutionReadinessReview(root, insufficientPreparation.assessmentId, insufficientInput, { reviewedBy: 'Owner' }).report.result, 'insufficient-evidence');

    const readyPreparation = prepareSolutionReadinessReview(root, 'sample-delivery', 'internal-only', {
      revision: 'fixture-ready', evidence: evidence(root), personaCatalogue: personas(),
    });
    assert.equal(recordSolutionReadinessReview(root, readyPreparation.assessmentId, acceptedReview(readyPreparation), { reviewedBy: 'Owner' }).report.result, 'ready-for-human-decision');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('detects cited evidence drift independently of repository revision', () => {
  const root = createProject();
  try {
    const preparation = prepareSolutionReadinessReview(root, 'sample-delivery', 'internal-only', {
      revision: 'fixture-same', evidence: evidence(root), personaCatalogue: personas(),
    });
    recordSolutionReadinessReview(root, preparation.assessmentId, acceptedReview(preparation), { reviewedBy: 'Owner' });
    writeFileSync(resolve(root, 'SPECS/2.Purpose/intents/quality/sample-delivery.md'), '# Changed intent\n');
    const status = readSolutionReadinessStatus(root, preparation.assessmentId, { revision: 'fixture-same' });
    assert.equal(status.status, 'stale');
    assert.equal(status.drift.some((item) => item.kind === 'cited-evidence' && item.status === 'changed'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reuses an unchanged preparation and detects digest tampering', () => {
  const root = createProject();
  try {
    const options = { revision: 'revision-repeatable', evidence: evidence(root), personaCatalogue: personas(), now: '2030-01-01T00:00:00.000Z' };
    const first = prepareSolutionReadinessReview(root, 'sample-delivery', 'internal-only', options);
    const second = prepareSolutionReadinessReview(root, 'sample-delivery', 'internal-only', { ...options, now: '2031-01-01T00:00:00.000Z' });
    assert.equal(second.assessmentId, first.assessmentId);
    assert.equal(second.brief.preparedAt, first.brief.preparedAt);
    assert.equal(second.reviewTemplate.preparedDigest, first.brief.digest);

    const briefPath = resolve(root, second.paths.briefJson);
    const tampered = JSON.parse(readFileSync(briefPath, 'utf8'));
    tampered.dimensions[0].summary = 'Tampered summary';
    writeFileSync(briefPath, `${JSON.stringify(tampered, null, 2)}\n`);
    const status = readSolutionReadinessStatus(root, first.assessmentId, { revision: 'revision-repeatable' });
    assert.equal(status.status, 'stale');
    assert.equal(status.drift.some((item) => item.kind === 'brief-digest'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
