import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createIntentMap } from '../src/intent-maps.mjs';
import { initProject } from '../src/project.mjs';
import { listRuntimeIntents } from '../src/runtime/intents.mjs';

function request(overrides = {}) {
  return {
    schema: 'ewai.intent-map-request/v1',
    slug: 'accountable-alerting',
    title: 'Accountable alerting',
    idea: 'Make emergency alert delivery observable and recoverable.',
    desiredOutcome: 'Operators can account for every intended recipient and recover failed delivery.',
    users: ['Alert operator', 'Recipient'],
    evidence: ['SPECS/3.Evidence/reviews/dispatch.md'],
    boundaries: ['Preserve blind-relay privacy.'],
    nonGoals: ['Replace the messaging provider.'],
    shapingPersonas: [{ ref: 'product-owner', role: 'facilitator', depth: 4 }],
    intents: [
      {
        domain: 'alerts',
        slug: 'accountable-dispatch',
        title: 'Accountable dispatch',
        problem: 'Recipients can disappear from delivery without a durable disposition.',
        desiredOutcome: 'Every intended recipient has a durable dispatch outcome.',
        users: ['Alert operator'],
        acceptanceCriteria: ['Every recipient produces a delivered, failed, or skipped record.'],
        constraints: ['Do not expose raw recipient contact details.'],
        personas: [{ ref: 'ewai.core.operator', role: 'primary', depth: 5 }],
        relationships: [{
          type: 'enables',
          target: 'alerts/delivery-reconciliation',
          rationale: 'Reconciliation needs a complete dispatch ledger.',
        }],
        deliveryShape: {
          recommendation: 'single',
          reason: 'The ledger outcome is independently valuable and testable.',
          suggested_children: [],
          blocking_questions: [],
          reviewed_decision: 'keep-as-one',
        },
      },
      {
        domain: 'alerts',
        slug: 'delivery-reconciliation',
        title: 'Delivery reconciliation',
        problem: 'Operators cannot reliably identify and recover provider delivery failures.',
        desiredOutcome: 'Operators can reconcile outcomes and trigger governed recovery.',
        users: ['Alert operator'],
        acceptanceCriteria: ['Provider outcomes reconcile to the intended recipient ledger.'],
        relationships: [{
          type: 'depends-on',
          target: 'alerts/accountable-dispatch',
          rationale: 'Recovery relies on complete dispatch outcomes.',
        }],
        deliveryShape: {
          recommendation: 'decision-required',
          reason: 'Recovery ownership must be confirmed before delivery can be responsibly shaped.',
          suggested_children: [],
          blocking_questions: ['Who owns failed-delivery recovery?'],
        },
      },
    ],
    ...overrides,
  };
}

function assertNoMapArtifacts(root, mapRequest) {
  const mapBase = resolve(
    root,
    'SPECS/2.Purpose/explorations/intent-maps',
    mapRequest.slug,
  );
  assert.equal(existsSync(`${mapBase}.md`), false);
  assert.equal(existsSync(`${mapBase}.json`), false);
  for (const intent of mapRequest.intents) {
    const intentBase = resolve(
      root,
      'SPECS/2.Purpose/intents',
      intent.domain ?? 'general',
      intent.slug,
    );
    assert.equal(existsSync(`${intentBase}.md`), false);
    assert.equal(existsSync(`${intentBase}.json`), false);
  }
}

test('atomically creates an approved map and linked durable intents', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-intent-map-'));
  try {
    initProject(root, { name: 'Intent Map Test' });
    const result = createIntentMap(root, request(), {
      confirmed: true,
      approvedBy: 'Andre',
      now: '2026-07-20T12:00:00.000Z',
    });

    assert.equal(result.intents.length, 2);
    assert.equal(result.mapPath, 'SPECS/2.Purpose/explorations/intent-maps/accountable-alerting.md');
    assert.equal(existsSync(resolve(root, result.mapPath)), true);
    assert.match(readFileSync(resolve(root, result.mapPath), 'utf8'), /approved_by: "Andre"/);
    assert.equal(
      JSON.parse(readFileSync(resolve(root, result.jsonPath), 'utf8')).schema,
      'ewai.intent-map/v1',
    );
    assert.match(readFileSync(resolve(root, result.mapPath), 'utf8'), /## Delivery shape preview/);

    const intentPath = resolve(root, 'SPECS/2.Purpose/intents/alerts/accountable-dispatch.md');
    const intentState = JSON.parse(readFileSync(intentPath.replace(/\.md$/, '.json'), 'utf8'));
    assert.match(readFileSync(intentPath, 'utf8'), /## Dependencies and relationships/);
    assert.equal(intentState.intentMap, 'accountable-alerting');
    assert.deepEqual(intentState.relationships, [{
      type: 'enables',
      target: 'alerts/delivery-reconciliation',
      rationale: 'Reconciliation needs a complete dispatch ledger.',
    }]);
    assert.equal(intentState.deliveryShape.recommendation, 'single');

    const projected = listRuntimeIntents(root);
    assert.equal(projected.length, 2);
    assert.equal(projected.find((intent) => intent.slug === 'accountable-dispatch').intentMap, 'accountable-alerting');
    assert.equal(projected.find((intent) => intent.slug === 'accountable-dispatch').relationships[0].target, 'alerts/delivery-reconciliation');
    assert.equal(projected.find((intent) => intent.slug === 'delivery-reconciliation').deliveryShape.recommendation, 'decision-required');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('requires explicit approval and rejects invalid maps without partial files', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-intent-map-guard-'));
  try {
    initProject(root, { name: 'Intent Map Guard Test' });
    const unapproved = request();
    assert.throws(() => createIntentMap(root, unapproved, {}), /explicit user approval/);
    assertNoMapArtifacts(root, unapproved);

    const cyclic = request();
    cyclic.intents[0].relationships[0].type = 'depends-on';
    assert.throws(
      () => createIntentMap(root, cyclic, { confirmed: true }),
      /dependency cycle detected/,
    );
    assertNoMapArtifacts(root, cyclic);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects relationships to intents that do not exist', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-intent-map-target-'));
  try {
    initProject(root, { name: 'Intent Map Target Test' });
    const invalid = request({
      intents: [{
        domain: 'alerts',
        slug: 'orphaned-work',
        title: 'Orphaned work',
        problem: 'The proposed work has an invalid dependency.',
        desiredOutcome: 'The dependency is made explicit.',
        relationships: [{ type: 'depends-on', target: 'alerts/missing-intent' }],
      }],
    });
    assert.throws(
      () => createIntentMap(root, invalid, { confirmed: true }),
      /relates to missing intent alerts\/missing-intent/,
    );
    assertNoMapArtifacts(root, invalid);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
