import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPANION_ADVISORY_NOTICE,
  COMPANION_ASSURANCE_NOTICE,
  readCompanionGuidance,
} from '../src/companion-guidance.mjs';

function action(permitted, blockers = [], extra = {}) {
  return { permitted, blockers, ...extra };
}

function item(id, options = {}) {
  const permitted = options.permitted ?? '';
  const blockers = options.blockers ?? [];
  return {
    id: `experience/${id}`,
    intentId: `experience/${id}`,
    slug: id,
    domain: 'experience',
    title: options.title ?? id.replaceAll('-', ' '),
    lane: options.lane ?? 'active',
    state: options.state ?? 'in-progress',
    currentPhase: options.phase ?? 'build',
    completionPercent: options.progress ?? 50,
    priority: options.priority ?? 5,
    notes: 'SENSITIVE-NOTES-BODY',
    intentPath: '/private/SPECS/intent.md',
    execution: {
      valid: options.valid !== false,
      blockers,
      lifecycle: { status: options.lifecycle ?? 'in-progress', currentPhase: options.phase ?? 'build' },
      actions: {
        beginHarness: action(permitted === 'beginHarness'),
        continueHarness: action(permitted === 'continueHarness'),
        completeCurrentPhase: action(permitted === 'completeCurrentPhase'),
        approveBuild: action(permitted === 'approveBuild'),
        enterBuild: action(permitted === 'enterBuild'),
        acquireTask: action(permitted === 'acquireTask'),
      },
    },
  };
}

const personas = [
  { id: 'project.product-owner', name: 'Product Owner', tier: 'project', category: 'product', description: 'Protects user outcomes and acceptance.', tags: ['product', 'outcome', 'acceptance'], body: 'SENSITIVE-PERSONA-BODY' },
  { id: 'ewai.core.operator', name: 'Service Operator', tier: 'core', category: 'operations', description: 'Examines blockers and recovery.', tags: ['blocked', 'recovery', 'delivery'] },
  { id: 'ewai.premium.security', name: 'Security Reviewer', tier: 'premium', category: 'security', description: 'Examines security evidence and residual risk.', tags: ['security', 'evidence', 'risk'], body: 'LICENSED-PREMIUM-BODY' },
  { id: 'ewai.premium.irrelevant', name: 'Payroll Specialist', tier: 'premium', category: 'payroll', description: 'Examines payroll.', tags: ['payroll'] },
];

test('ranks deterministic classes from execution actions', () => {
  const items = [
    item('blocked', { blockers: [{ code: 'dependency', message: 'Identity dependency is incomplete.', source: '/private/root' }], lane: 'blocked', priority: 1 }),
    item('ready', { permitted: 'beginHarness', lane: 'ready', priority: 4 }),
    item('continue', { permitted: 'continueHarness', priority: 3 }),
    item('manual-qa', { lane: 'qa', phase: 'delivery', progress: 93, priority: 2 }),
    item('build-decision', { permitted: 'approveBuild', phase: 'test-plan', priority: 5 }),
  ];
  const first = readCompanionGuidance('/unused', { items, personas });
  const second = readCompanionGuidance('/unused', { items: [...items].reverse(), personas });
  assert.equal(first.schema, 'ewai.companion-guidance/v1');
  assert.deepEqual(first.recommendations.map(({ id, class: kind }) => [id, kind]), [
    ['experience/manual-qa', 'human-decision'],
    ['experience/build-decision', 'human-decision'],
    ['experience/continue', 'continue'],
    ['experience/ready', 'start'],
    ['experience/blocked', 'blocked'],
  ]);
  assert.deepEqual(second.recommendations.map(({ id }) => id), first.recommendations.map(({ id }) => id));
  assert.equal(first.recommendations.find(({ id }) => id.endsWith('/blocked')).handoff, null);
  assert.equal(first.recommendations.find(({ id }) => id.endsWith('/ready')).handoff.kind, 'begin');
  assert.equal(first.recommendations.find(({ id }) => id.endsWith('/continue')).handoff.kind, 'continue');
});

test('bounds guidance and redacts source and persona content', () => {
  const items = Array.from({ length: 12 }, (_, index) => item(`work-${index}`, {
    blockers: [{ code: 'blocked', message: `Safe blocker ${index} ${'x'.repeat(400)}`, source: '/private/source' }],
    title: `Work ${index}`,
  }));
  const result = readCompanionGuidance('/unused', { items, personas });
  const serialised = JSON.stringify(result);
  assert.equal(result.recommendations.length, 8);
  assert.equal(result.activePersonas.length <= 4, true);
  assert.doesNotMatch(serialised, /SENSITIVE-NOTES-BODY|SENSITIVE-PERSONA-BODY|LICENSED-PREMIUM-BODY|\/private\//);
  assert.equal(result.recommendations.every(({ blockers }) => blockers.length <= 3 && blockers.every(({ message }) => message.length <= 240)), true);
  assert.equal(result.notices.advisory, COMPANION_ADVISORY_NOTICE);
  assert.equal(result.notices.security, COMPANION_ASSURANCE_NOTICE);
});

test('replaces personas and questions when focus changes', () => {
  const items = [
    item('product-outcome', { title: 'Product acceptance outcome', permitted: 'continueHarness' }),
    item('security-review', { title: 'Security evidence review', lane: 'qa', phase: 'delivery' }),
  ];
  const product = readCompanionGuidance('/unused', { items, personas, focus: 'product-outcome' });
  const security = readCompanionGuidance('/unused', { items, personas, focus: 'security-review' });
  assert.equal(product.spotlight.id, 'experience/product-outcome');
  assert.equal(security.spotlight.id, 'experience/security-review');
  assert.equal(product.activePersonas.some(({ id }) => id === 'project.product-owner'), true);
  assert.equal(security.activePersonas.some(({ id }) => id === 'ewai.premium.security'), true);
  assert.equal(security.activePersonas.some(({ id }) => id === 'ewai.premium.irrelevant'), false);
  assert.notDeepEqual(product.review.questions, security.review.questions);
});

test('keeps the standard project and core baseline complete without premium', () => {
  const result = readCompanionGuidance('/unused', {
    items: [item('product-outcome', { title: 'Product outcome', permitted: 'continueHarness' })],
    personas: personas.filter(({ tier }) => tier !== 'premium'),
  });
  assert.equal(result.baseline.standardModel, true);
  assert.equal(result.baseline.complete, true);
  assert.equal(result.personaAvailability.premium.installed, false);
  assert.match(result.personaAvailability.premium.reason, /No installed premium/);
  assert.equal(result.activePersonas.some(({ tier }) => tier === 'project'), true);
});

test('returns honest empty state and rejects invalid focus', () => {
  const empty = readCompanionGuidance('/unused', { items: [], personas });
  assert.equal(empty.status, 'empty');
  assert.equal(empty.spotlight, null);
  assert.deepEqual(empty.recommendations, []);
  assert.throws(() => readCompanionGuidance('/unused', { items: [], focus: 'x'.repeat(501) }), /500 characters/);
  assert.throws(() => readCompanionGuidance('/unused', { items: [], focus: 'bad\u0000focus' }), /unsafe control/);
});

test('preserves advisory and security authority boundaries', () => {
  const result = readCompanionGuidance('/unused', {
    items: [item('security-review', { title: 'Security evidence review', lane: 'qa', phase: 'delivery' })],
    personas,
  });
  assert.equal(result.notices.security, 'Security validation is evidence, not certification or proof that this system is secure. Tools can miss vulnerabilities and produce false positives. A qualified human must review the scope, findings, limitations and residual risk before release.');
  assert.match(result.notices.advisory, /advisory/i);
  assert.equal(result.spotlight.class, 'human-decision');
  assert.equal(result.spotlight.handoff, null);
});
