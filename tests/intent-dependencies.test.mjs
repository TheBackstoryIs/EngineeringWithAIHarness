import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  dependencyRequirementBlockers,
  validateIntentDependencyGraph,
} from '../src/intent-dependencies.mjs';

function intent(id, relationships = [], state = {}) {
  const [domain, slug] = id.split('/');
  return { id, domain, slug, status: state.status ?? 'ready', deliveryStatus: state.deliveryStatus ?? 'not-started', relationships };
}

test('validates missing targets and dependency cycles across the complete intent library', () => {
  const missing = validateIntentDependencyGraph([
    intent('alerts/dispatch', [{ type: 'depends-on', target: 'platform/missing' }]),
  ]);
  assert.equal(missing.status, 'fail');
  assert.equal(missing.errors[0].code, 'intent-dependency-missing');

  const cyclic = validateIntentDependencyGraph([
    intent('alerts/dispatch', [{ type: 'depends-on', target: 'platform/delivery' }]),
    intent('platform/delivery', [{ type: 'depends-on', target: 'alerts/dispatch' }]),
  ]);
  assert.equal(cyclic.errors.some((error) => error.code === 'intent-dependency-cycle'), true);
});

test('defaults dependencies to delivered-before-delivery without blocking earlier thinking', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-dependency-point-'));
  try {
    const source = intent('alerts/dispatch', [{ type: 'depends-on', target: 'platform/delivery' }]);
    const target = intent('platform/delivery');
    const catalog = new Map([[source.id, source], [target.id, target]]);
    assert.deepEqual(dependencyRequirementBlockers(root, source, catalog, 'build'), []);
    assert.equal(dependencyRequirementBlockers(root, source, catalog, 'delivery')[0].code, 'intent-dependency-incomplete');
    target.deliveryStatus = 'completed';
    assert.deepEqual(dependencyRequirementBlockers(root, source, catalog, 'delivery'), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('supports an explicit plan-complete-before-build dependency', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-dependency-plan-'));
  try {
    const source = intent('alerts/dispatch', [{
      type: 'depends-on', target: 'platform/delivery', required_before: 'build', required_state: 'plan-complete',
    }]);
    const target = intent('platform/delivery');
    const catalog = new Map([[source.id, source], [target.id, target]]);
    assert.equal(dependencyRequirementBlockers(root, source, catalog, 'build').length, 1);
    const deliveryRoot = resolve(root, 'SPECS/6.Build/delivery');
    mkdirSync(deliveryRoot, { recursive: true });
    writeFileSync(resolve(deliveryRoot, 'delivery-state.json'), JSON.stringify({
      schema: 'ewai.delivery-state/v1', slug: 'delivery', phases: [{ id: 'plan', status: 'completed' }],
    }));
    assert.deepEqual(dependencyRequirementBlockers(root, source, catalog, 'build'), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('blocks duplicate slug namespaces and dependencies that target them', () => {
  const intents = [
    intent('alerts/shared-capability'),
    intent('billing/shared-capability'),
    intent('platform/dependent', [{ type: 'depends-on', target: 'alerts/shared-capability' }]),
  ];
  const result = validateIntentDependencyGraph(intents);
  assert.equal(result.status, 'fail');
  assert.equal(result.errors.some((error) => error.code === 'intent-slug-collision'), true);
  assert.equal(result.errors.some((error) => error.code === 'intent-dependency-target-collision'), true);
});
