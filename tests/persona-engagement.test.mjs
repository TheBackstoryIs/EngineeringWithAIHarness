import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPrototypeReviewPersonas } from '../src/runtime/persona-engagement.mjs';

function catalogue() {
  return [
    {
      id: 'project.product-owner', name: 'Product Owner', tier: 'project', category: 'product',
      description: 'Owns product outcomes, acceptance criteria, user journeys and accountable decisions.',
      tags: ['product', 'acceptance', 'journey'], capabilities: ['prioritisation', 'user outcomes'],
    },
    {
      id: 'ewai.core.end-user', name: 'End User', tier: 'core', category: 'experience',
      description: 'Challenges usability, accessibility, comprehension and task completion.',
      tags: ['usability', 'accessibility'], capabilities: ['user journey review'],
    },
    {
      id: 'personal.platform-operator', name: 'Platform Operator', tier: 'personal', category: 'operations',
      description: 'Examines deployment, support and operational recovery.',
      tags: ['hosting', 'operations'], capabilities: ['recovery'],
    },
    {
      id: 'premium.visual-designer', name: 'Visual Designer', tier: 'premium', category: 'design',
      description: 'Reviews rendered interfaces, visual hierarchy, typography, spacing and responsive layouts.',
      tags: ['visual hierarchy', 'rendered viewport', 'responsive'], capabilities: ['prototype critique'],
    },
  ];
}

test('selects and explains relevant installed personas independently for plan and rendered-design review', () => {
  const personas = catalogue();
  const plan = selectPrototypeReviewPersonas({
    stage: 'plan',
    signals: ['product outcomes', 'acceptance', 'user journey'],
    context: { summary: 'Plan user journeys and decision ownership before prototyping.' },
  }, personas);
  const design = selectPrototypeReviewPersonas({
    stage: 'design',
    signals: ['rendered viewport', 'visual hierarchy', 'responsive'],
    context: { summary: 'Review the rendered prototype at desktop and mobile viewports.' },
  }, personas);

  assert.equal(plan.schema, 'ewai.prototype-persona-engagement/v1');
  assert.equal(plan.stage, 'plan');
  assert.equal(design.stage, 'design');
  assert.equal(plan.activePersonas.some(({ id }) => id === 'project.product-owner'), true);
  assert.equal(design.activePersonas.some(({ id }) => id === 'premium.visual-designer'), true);
  assert.notEqual(design.selectionFingerprint, plan.selectionFingerprint);
  for (const persona of [...plan.activePersonas, ...design.activePersonas]) {
    assert.ok(persona.matchedSignals.length > 0);
    assert.match(persona.engagementReason, /engaged/i);
    assert.equal('path' in persona, false);
  }
});

test('shows every persona tier as availability while keeping premium and personal optional', () => {
  const withPremium = selectPrototypeReviewPersonas({ stage: 'design', signals: ['rendered viewport'] }, catalogue());
  assert.deepEqual(withPremium.availability.premium, { available: true, count: 1 });
  assert.deepEqual(withPremium.availability.personal, { available: true, count: 1 });
  assert.equal(withPremium.baseline.completeWithoutOptionalPersonas, true);
  assert.equal(withPremium.authority.maySelectPrototype, false);
  assert.equal(withPremium.authority.mayApproveManualQa, false);

  const baseline = selectPrototypeReviewPersonas({ stage: 'plan', signals: ['product'] }, catalogue().filter(({ tier }) => !['premium', 'personal'].includes(tier)));
  assert.deepEqual(baseline.availability.premium, { available: false, count: 0 });
  assert.equal(baseline.activePersonas.some(({ tier }) => tier === 'premium'), false);
  assert.equal(baseline.baseline.completeWithoutOptionalPersonas, true);
  assert.equal(baseline.notices.some((notice) => /not installed.*complete/i.test(notice)), true);
});

test('returns a core fallback when supplied signals do not match the installed catalogue', () => {
  const result = selectPrototypeReviewPersonas({ stage: 'design', signals: ['unmapped-specialism'] }, catalogue());
  assert.ok(result.activePersonas.length >= 1);
  assert.equal(result.activePersonas.every(({ tier }) => ['core', 'project'].includes(tier)), true);
  assert.equal(result.activePersonas.every(({ engagementReason }) => /baseline/i.test(engagementReason)), true);
});
