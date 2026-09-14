import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPolicyPersonas } from '../src/runtime/persona-engagement.mjs';

function personas({ premium = true } = {}) {
  return [
    { id: 'ewai.core.operator', name: 'Service Operator', tier: 'core', category: 'operations', description: 'Challenges security, data destinations, recovery, and production controls.', tags: ['security', 'destination', 'production', 'controls'], capabilities: ['policy-review'] },
    { id: 'ewai.core.maintainer', name: 'Software Maintainer', tier: 'core', category: 'engineering', description: 'Examines architecture, evidence, testing, and safe change.', tags: ['architecture', 'evidence', 'testing'], capabilities: ['design-review'] },
    { id: 'project.data-owner', name: 'Project Data Owner', tier: 'project', category: 'data', description: 'Applies project data classification and retention context.', tags: ['data-classification', 'retention', 'data'], capabilities: ['policy-review'], path: '/private/project.md', rawDefinition: 'do not expose' },
    { id: 'personal.risk-adviser', name: 'Risk Adviser', tier: 'personal', category: 'risk', description: 'Challenges exception scope, ownership, expiry, and compensating controls.', tags: ['exception', 'scope', 'expiry', 'controls'], capabilities: ['risk-review'] },
    ...(premium ? [
      { id: 'premium.privacy-officer', name: 'Privacy Officer', tier: 'premium', category: 'privacy', description: 'Examines sensitive data, AI use, destinations, and privacy controls.', tags: ['data-classification', 'ai-use', 'destination', 'privacy'], capabilities: ['policy-review'], path: '/private/premium.md', rawDefinition: 'proprietary body' },
      { id: 'premium.finance-auditor', name: 'Finance Auditor', tier: 'premium', category: 'finance', description: 'Reviews tax and reconciliation.', tags: ['finance', 'tax'], capabilities: ['finance-review'] },
    ] : []),
  ];
}

test('swaps safe project core and installed premium perspectives with visible reasons', () => {
  const facts = selectPolicyPersonas({
    stage: 'facts',
    dimensions: ['data_classification', 'destination', 'ai_use'],
    context: { dataClassification: 'sensitive', destination: 'external-ai', aiUse: 'generative' },
  }, personas());
  assert.equal(facts.activePersonas.some(({ tier }) => tier === 'project'), true);
  assert.equal(facts.activePersonas.some(({ tier }) => tier === 'premium'), true);
  assert.equal(facts.activePersonas.some(({ id }) => id === 'premium.finance-auditor'), false);
  assert.equal(facts.activePersonas.every(({ engagementReason }) => engagementReason.length > 0), true);

  const exceptions = selectPolicyPersonas({
    stage: 'exception',
    dimensions: ['scope'],
    context: { exception: true, expiry: true, controls: true, owner: true },
  }, personas());
  assert.equal(exceptions.activePersonas.some(({ id }) => id === 'personal.risk-adviser'), true);
  assert.notDeepEqual(exceptions.activePersonas.map(({ id }) => id), facts.activePersonas.map(({ id }) => id));
  for (const persona of [...facts.activePersonas, ...exceptions.activePersonas]) {
    assert.deepEqual(Object.keys(persona).sort(), ['category', 'description', 'engagementReason', 'id', 'matchedSignals', 'name', 'tier']);
    assert.equal('path' in persona, false);
    assert.equal('rawDefinition' in persona, false);
  }
  assert.equal(facts.authority.advisory, true);
  assert.equal(facts.authority.mayConfirmFacts, false);
});

test('keeps standard and core policy capability complete when premium is absent', () => {
  const result = selectPolicyPersonas({
    stage: 'evaluation',
    dimensions: ['destination', 'environment'],
    context: { destination: 'approved-internal', environment: 'production' },
  }, personas({ premium: false }));
  assert.equal(result.baseline.standardModelAvailable, true);
  assert.equal(result.baseline.completeWithoutPremium, true);
  assert.equal(result.premium.installed, false);
  assert.match(result.premium.reason, /not installed/i);
  assert.equal(result.activePersonas.some(({ tier }) => tier === 'core'), true);
  assert.equal(result.activePersonas.some(({ tier }) => tier === 'premium'), false);
});
