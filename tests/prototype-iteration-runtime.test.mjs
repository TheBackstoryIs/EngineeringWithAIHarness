import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { initProject } from '../src/project.mjs';
import {
  preparePrototypeCycleWorkspace,
  preparePrototypePlanWorkspace,
  readPrototypeIterationWorkspace,
  recordPrototypeCycleWorkspaceReview,
  recordPrototypePlanWorkspaceReview,
} from '../src/runtime/prototype-iterations.mjs';

const digest = (character) => `sha256:${character.repeat(64)}`;

function personas() {
  return [
    { id: 'project.product-owner', name: 'Product Owner', tier: 'project', category: 'product', description: 'Owns product outcomes, acceptance and user journeys.', tags: ['product', 'acceptance'], capabilities: ['user journeys'] },
    { id: 'ewai.core.end-user', name: 'End User', tier: 'core', category: 'experience', description: 'Reviews usability and accessibility.', tags: ['usability', 'accessibility'], capabilities: ['journey review'] },
    { id: 'premium.visual-designer', name: 'Visual Designer', tier: 'premium', category: 'design', description: 'Reviews rendered viewports and visual hierarchy.', tags: ['rendered viewport', 'visual hierarchy'], capabilities: ['prototype critique'] },
  ];
}

function project() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-prototype-workspace-'));
  initProject(root, { name: 'Prototype Workspace' });
  return root;
}

function planRequest() {
  return {
    intentDigest: digest('a'),
    designSystem: { id: 'organisation.product-interface', effectiveDigest: digest('b') },
    plan: {
      summary: 'Create a governed review workspace.',
      screens: [{ id: 'review', title: 'Review', purpose: 'Review a prototype.', userOutcomes: ['Understand feedback'], evidenceRefs: ['intent:review'] }],
      journeys: [{ id: 'review-flow', actor: 'product-owner', outcome: 'Assess feedback.', screenRefs: ['review'] }],
    },
    signals: ['product', 'acceptance', 'user journey'],
  };
}

function planSubmission(preparation) {
  const finding = {
    personaId: preparation.engagement.activePersonas[0].id,
    concernCode: 'decision-owner', severity: 'advisory',
    observation: 'The decision owner should remain visible.', recommendation: 'Show the owner beside the next action.',
    evidenceRefs: ['screen:review'],
  };
  return {
    schema: 'ewai.prototype-plan-review-submission/v1',
    expectedPreparationDigest: preparation.preparationDigest,
    reviewedBy: 'host-model-with-human-oversight',
    findings: [finding],
    assessments: [{ findingRef: { personaId: finding.personaId, concernCode: finding.concernCode, evidenceRefs: finding.evidenceRefs }, disposition: 'incorporate', rationale: 'Visible ownership supports accountable prototype selection.' }],
  };
}

function evidenceChannels() {
  return [
    { channel: 'source', status: 'available', evidenceRefs: ['prototype:selected.html'], note: 'Prototype source recorded.' },
    { channel: 'rendered-viewport', status: 'available', evidenceRefs: ['render:desktop', 'render:mobile'], note: 'Desktop and mobile renders recorded.' },
    { channel: 'interaction', status: 'available', evidenceRefs: ['interaction:review-switch'], note: 'Stage switch exercised.' },
    { channel: 'assistive-technology', status: 'not-collected', evidenceRefs: [], note: 'Pending specialist review.' },
    { channel: 'user-research', status: 'not-collected', evidenceRefs: [], note: 'No real-user research in this cycle.' },
    { channel: 'manual-qa', status: 'pending-human', evidenceRefs: [], note: 'Manual QA remains a human gate.' },
    { channel: 'release', status: 'not-collected', evidenceRefs: [], note: 'Release evidence is outside prototype review.' },
  ];
}

test('prepares and records plan review from project context without downloading personas', () => {
  const root = project();
  try {
    const prepared = preparePrototypePlanWorkspace(root, 'guided-prototype', planRequest(), { personas: personas(), now: '2026-08-29T10:00:00.000Z' });
    assert.equal(prepared.preparation.engagement.stage, 'plan');
    assert.equal(prepared.preparation.engagement.activePersonas.some(({ id }) => id === 'project.product-owner'), true);
    assert.equal(prepared.preparation.engagement.availability.premium.available, true);
    const recorded = recordPrototypePlanWorkspaceReview(root, 'guided-prototype', planSubmission(prepared.preparation));
    assert.equal(recorded.review.assessment.complete, true);
    assert.equal(recorded.review.nextAction, 'iterate');
    assert.equal(readPrototypeIterationWorkspace(root, 'guided-prototype', { personas: personas() }).planReviews.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('recomputes relevant personas for rendered design and records bounded linked cycles', () => {
  const root = project();
  try {
    const planPrepared = preparePrototypePlanWorkspace(root, 'guided-prototype', planRequest(), { personas: personas() });
    const plan = recordPrototypePlanWorkspaceReview(root, 'guided-prototype', planSubmission(planPrepared.preparation)).review;
    const entryPath = resolve(root, 'SPECS/6.Build/guided-prototype/ui-design-assets/prototypes/selected.html');
    mkdirSync(dirname(entryPath), { recursive: true });
    writeFileSync(entryPath, '<!doctype html><title>Prototype</title>');

    const firstPrepared = preparePrototypeCycleWorkspace(root, 'guided-prototype', {
      planReviewDigest: plan.contentDigest,
      cycleNumber: 1,
      maxCycles: 2,
      predecessorDigest: '',
      prototype: { manifestDigest: digest('c'), entryPath: 'ui-design-assets/prototypes/selected.html' },
      evidenceChannels: evidenceChannels(),
      signals: ['rendered viewport', 'visual hierarchy', 'responsive'],
    }, { personas: personas() });
    assert.equal(firstPrepared.preparation.engagement.stage, 'design');
    assert.equal(firstPrepared.preparation.engagement.activePersonas.some(({ id }) => id === 'premium.visual-designer'), true);
    assert.notEqual(firstPrepared.preparation.personaFingerprint, plan.personaFingerprint);

    const personaId = firstPrepared.preparation.engagement.activePersonas.find(({ id }) => id === 'premium.visual-designer').id;
    const first = recordPrototypeCycleWorkspaceReview(root, 'guided-prototype', {
      schema: 'ewai.prototype-cycle-review-submission/v1',
      expectedPreparationDigest: firstPrepared.preparation.preparationDigest,
      reviewedBy: 'host-model-with-human-oversight',
      findings: [{ personaId, concernCode: 'mobile-hierarchy', severity: 'material', observation: 'Mobile hierarchy hides the next action.', recommendation: 'Move the next action above supporting evidence.', evidenceRefs: ['render:mobile'] }],
      assessments: [{ findingRef: { personaId, concernCode: 'mobile-hierarchy', evidenceRefs: ['render:mobile'] }, disposition: 'incorporate', rationale: 'The primary decision must remain clear at mobile widths.' }],
    }).review;
    assert.equal(first.nextAction, 'iterate');

    const secondPrepared = preparePrototypeCycleWorkspace(root, 'guided-prototype', {
      planReviewDigest: plan.contentDigest,
      cycleNumber: 2,
      maxCycles: 2,
      predecessorDigest: first.contentDigest,
      prototype: { manifestDigest: digest('d'), entryPath: 'ui-design-assets/prototypes/selected.html' },
      evidenceChannels: evidenceChannels(),
      signals: ['rendered viewport', 'visual hierarchy', 'responsive'],
    }, { personas: personas() });
    const second = recordPrototypeCycleWorkspaceReview(root, 'guided-prototype', {
      schema: 'ewai.prototype-cycle-review-submission/v1',
      expectedPreparationDigest: secondPrepared.preparation.preparationDigest,
      reviewedBy: 'host-model-with-human-oversight',
      findings: [{ personaId, concernCode: 'mobile-hierarchy', severity: 'material', observation: 'The action remains too low.', recommendation: 'Escalate for an accountable design decision.', evidenceRefs: ['render:mobile'] }],
      assessments: [{ findingRef: { personaId, concernCode: 'mobile-hierarchy', evidenceRefs: ['render:mobile'] }, disposition: 'incorporate', rationale: 'A material concern remains at the configured cycle limit.' }],
    }).review;
    assert.equal(second.nextAction, 'human-decision-required');
    assert.equal(second.predecessorDigest, first.contentDigest);
    assert.equal(readPrototypeIterationWorkspace(root, 'guided-prototype', { personas: personas() }).cycleReviews.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('requires source and viewport evidence, all channels, a valid prototype path, and a one-to-three cycle bound', () => {
  const root = project();
  try {
    const planPrepared = preparePrototypePlanWorkspace(root, 'guided-prototype', planRequest(), { personas: personas() });
    const plan = recordPrototypePlanWorkspaceReview(root, 'guided-prototype', planSubmission(planPrepared.preparation)).review;
    const entryPath = resolve(root, 'SPECS/6.Build/guided-prototype/ui-design-assets/prototypes/selected.html');
    mkdirSync(dirname(entryPath), { recursive: true });
    writeFileSync(entryPath, '<!doctype html><title>Prototype</title>');
    const base = {
      planReviewDigest: plan.contentDigest,
      cycleNumber: 1,
      maxCycles: 2,
      predecessorDigest: '',
      prototype: { manifestDigest: digest('c'), entryPath: 'ui-design-assets/prototypes/selected.html' },
      evidenceChannels: evidenceChannels(),
      signals: ['rendered viewport'],
    };
    assert.throws(() => preparePrototypeCycleWorkspace(root, 'guided-prototype', { ...base, maxCycles: 4 }, { personas: personas() }), /one to three|1 to 3|max/i);
    assert.throws(() => preparePrototypeCycleWorkspace(root, 'guided-prototype', { ...base, prototype: { ...base.prototype, entryPath: '../../secret.html' } }, { personas: personas() }), /inside|path/i);
    assert.throws(() => preparePrototypeCycleWorkspace(root, 'guided-prototype', { ...base, evidenceChannels: base.evidenceChannels.filter(({ channel }) => channel !== 'rendered-viewport') }, { personas: personas() }), /every evidence channel|rendered-viewport/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
