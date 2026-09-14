import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { initProject } from '../src/project.mjs';
import {
  comparePrototypeReviews,
  preparePrototypePlanReview,
  readPrototypeReviewStatus,
  recordPrototypePlanReview,
} from '../src/prototype-iterations.mjs';

const digest = (character) => `sha256:${character.repeat(64)}`;

function planInput(overrides = {}) {
  return {
    schema: 'ewai.prototype-plan-input/v1',
    deliverySlug: 'persona-guided-prototype',
    intentDigest: digest('a'),
    designSystem: {
      id: 'organisation.product-interface',
      effectiveDigest: digest('b'),
    },
    plan: {
      summary: 'Expose a governed prototype review workspace without replacing human selection.',
      screens: [
        {
          id: 'review-workspace',
          title: 'Prototype review workspace',
          purpose: 'Show active personas, their findings, and accountable dispositions.',
          userOutcomes: ['Understand who is reviewing', 'Decide whether the design should iterate'],
          evidenceRefs: ['intent:journey-review', 'design-system:workspace'],
        },
      ],
      journeys: [
        {
          id: 'review-a-prototype',
          actor: 'product-owner',
          outcome: 'Assess persona feedback before selecting a prototype.',
          screenRefs: ['review-workspace'],
        },
      ],
    },
    engagement: {
      schema: 'ewai.prototype-persona-engagement/v1',
      stage: 'plan',
      activePersonas: [
        {
          id: 'project.product-owner',
          name: 'Product Owner',
          tier: 'project',
          category: 'product',
          matchedSignals: ['user journey', 'acceptance'],
          engagementReason: 'The project product owner is engaged for user journey and acceptance concerns.',
        },
        {
          id: 'ewai.core.end-user',
          name: 'End User',
          tier: 'core',
          category: 'experience',
          matchedSignals: ['usability'],
          engagementReason: 'The end user is engaged to examine usability.',
        },
      ],
      availability: {
        standardModel: { available: true },
        core: { available: true, count: 4 },
        project: { available: true, count: 1 },
        personal: { available: false, count: 0 },
        premium: { available: false, count: 0 },
      },
      baseline: { completeWithoutOptionalPersonas: true },
      authority: { advisory: true, maySelectPrototype: false, mayApproveManualQa: false },
    },
    predecessorDigest: '',
    ...overrides,
  };
}

function review(preparation, overrides = {}) {
  return {
    schema: 'ewai.prototype-plan-review-submission/v1',
    expectedPreparationDigest: preparation.preparationDigest,
    reviewedBy: 'host-model-with-human-oversight',
    findings: [
      {
        personaId: 'project.product-owner',
        concernCode: 'decision-visibility',
        severity: 'material',
        observation: 'The proposed workspace does not yet make the decision owner visible.',
        recommendation: 'Show the accountable decision owner next to the next action.',
        evidenceRefs: ['screen:review-workspace', 'journey:review-a-prototype'],
      },
      {
        personaId: 'ewai.core.end-user',
        concernCode: 'persona-transparency',
        severity: 'advisory',
        observation: 'Users need a concise reason for each active persona.',
        recommendation: 'Keep the matched signals visible beside each persona.',
        evidenceRefs: ['screen:review-workspace'],
      },
    ],
    assessments: [],
    ...overrides,
  };
}

function assessedReview(preparation, overrides = {}) {
  const base = review(preparation);
  const preparedFindings = base.findings.map((finding) => ({
    ...finding,
    id: undefined,
  }));
  const findingIds = preparedFindings.map((finding) => {
    const partial = recordPrototypePlanReview(null, preparation, {
      ...base,
      findings: [finding],
      assessments: [],
    }, { persist: false, allowIncomplete: true }).review;
    return partial.findings[0].id;
  });
  return {
    ...base,
    assessments: [
      {
        findingId: findingIds[0],
        disposition: 'incorporate',
        rationale: 'The accountable owner must be visible before this plan can be implemented.',
      },
      {
        findingId: findingIds[1],
        disposition: 'incorporate-with-modification',
        rationale: 'Show the rationale progressively so the main workspace remains concise.',
        modification: 'Use a short visible reason with full matched signals in the detail view.',
      },
    ],
    ...overrides,
  };
}

function project() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-prototype-review-'));
  initProject(root, { name: 'Prototype Review' });
  return root;
}

test('prepares a stable reviewed-plan contract with visible active and available personas', () => {
  const first = preparePrototypePlanReview(planInput(), { now: '2026-08-29T09:00:00.000Z' });
  const reordered = planInput();
  reordered.engagement.activePersonas.reverse();
  reordered.plan.screens[0].userOutcomes.reverse();
  reordered.plan.screens[0].evidenceRefs.reverse();
  const second = preparePrototypePlanReview(reordered, { now: '2030-01-01T00:00:00.000Z' });

  assert.equal(first.schema, 'ewai.prototype-plan-preparation/v1');
  assert.equal(second.preparationDigest, first.preparationDigest);
  assert.notEqual(second.preparedAt, first.preparedAt);
  assert.deepEqual(first.engagement.activePersonas.map(({ id }) => id), ['ewai.core.end-user', 'project.product-owner']);
  assert.equal(first.engagement.availability.premium.available, false);
  assert.equal(first.engagement.baseline.completeWithoutOptionalPersonas, true);
  assert.equal(first.authority.personasAreAdvisory, true);
  assert.equal(first.authority.humanPrototypeSelectionRequired, true);
});

test('creates stable finding IDs independent of semantic wording', () => {
  const prepared = preparePrototypePlanReview(planInput());
  const firstSubmission = assessedReview(prepared);
  const first = recordPrototypePlanReview(null, prepared, firstSubmission, { persist: false }).review;
  const reworded = structuredClone(firstSubmission);
  reworded.findings[0].observation = 'The owner of the eventual decision is not apparent.';
  reworded.findings[0].recommendation = 'Make ownership explicit.';
  const second = recordPrototypePlanReview(null, prepared, reworded, { persist: false }).review;

  assert.equal(second.findings[0].id, first.findings[0].id);
  assert.notEqual(second.contentDigest, first.contentDigest);
});

test('requires one complete assessment per finding and keeps findings separate', () => {
  const prepared = preparePrototypePlanReview(planInput());
  const incomplete = review(prepared);
  assert.throws(() => recordPrototypePlanReview(null, prepared, incomplete, { persist: false }), /assessment.*every finding|unassessed/i);

  const submission = assessedReview(prepared);
  submission.assessments.push(structuredClone(submission.assessments[0]));
  assert.throws(() => recordPrototypePlanReview(null, prepared, submission, { persist: false }), /duplicate assessment/i);

  const unknown = assessedReview(prepared);
  unknown.assessments[0].findingId = 'FIND-unknown';
  assert.throws(() => recordPrototypePlanReview(null, prepared, unknown, { persist: false }), /unknown finding/i);
});

test('derives iteration and human-decision actions from assessed material concerns', () => {
  const prepared = preparePrototypePlanReview(planInput());
  const iterative = recordPrototypePlanReview(null, prepared, assessedReview(prepared), { persist: false }).review;
  assert.equal(iterative.nextAction, 'iterate');
  assert.equal(iterative.assessment.complete, true);

  const escalatedSubmission = assessedReview(prepared);
  escalatedSubmission.assessments[0] = {
    ...escalatedSubmission.assessments[0],
    disposition: 'escalate',
    rationale: 'The accountable owner must resolve this before implementation proceeds.',
  };
  const escalated = recordPrototypePlanReview(null, prepared, escalatedSubmission, { persist: false }).review;
  assert.equal(escalated.nextAction, 'human-decision-required');
});

test('writes immutable digest-addressed plan reviews and reports current status', () => {
  const root = project();
  try {
    const prepared = preparePrototypePlanReview(planInput());
    const submission = assessedReview(prepared);
    const first = recordPrototypePlanReview(root, prepared, submission, { now: '2026-08-29T09:00:00.000Z' });
    const repeated = recordPrototypePlanReview(root, prepared, submission, { now: '2030-01-01T00:00:00.000Z' });
    assert.equal(repeated.path, first.path);
    assert.equal(repeated.review.contentDigest, first.review.contentDigest);
    const status = readPrototypeReviewStatus(root, 'persona-guided-prototype');
    assert.equal(status.planReviews.length, 1);
    assert.equal(status.currentPlanReview.contentDigest, first.review.contentDigest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('explains plan review variance in input, personas, findings, assessments, then output order', () => {
  const firstPrepared = preparePrototypePlanReview(planInput());
  const secondInput = planInput();
  secondInput.engagement.activePersonas.push({
    id: 'premium.ux-researcher',
    name: 'UX Researcher',
    tier: 'premium',
    category: 'experience',
    matchedSignals: ['usability'],
    engagementReason: 'The installed UX researcher adds specialist usability challenge.',
  });
  secondInput.engagement.availability.premium = { available: true, count: 1 };
  const secondPrepared = preparePrototypePlanReview(secondInput);
  const first = recordPrototypePlanReview(null, firstPrepared, assessedReview(firstPrepared), { persist: false }).review;
  const second = recordPrototypePlanReview(null, secondPrepared, assessedReview(secondPrepared), { persist: false }).review;
  const comparison = comparePrototypeReviews(first, second);

  assert.deepEqual(comparison.order, ['inputs', 'personas', 'findings', 'assessments', 'output']);
  assert.equal(comparison.changes.personas.status, 'changed');
  assert.equal(comparison.reproducible, true);
});

test('rejects unsafe fields, stale preparations, invalid tiers and unsupported dispositions', () => {
  assert.throws(() => preparePrototypePlanReview({ ...planInput(), hiddenPrompt: 'secret' }), /unknown field/i);
  const invalidTier = planInput();
  invalidTier.engagement.activePersonas[0].tier = 'remote';
  assert.throws(() => preparePrototypePlanReview(invalidTier), /tier/i);
  const prepared = preparePrototypePlanReview(planInput());
  assert.throws(() => recordPrototypePlanReview(null, prepared, {
    ...assessedReview(prepared),
    expectedPreparationDigest: digest('f'),
  }, { persist: false }), /digest|newer preparation/i);
  const invalidDisposition = assessedReview(prepared);
  invalidDisposition.assessments[0].disposition = 'ignore';
  assert.throws(() => recordPrototypePlanReview(null, prepared, invalidDisposition, { persist: false }), /disposition/i);
});
