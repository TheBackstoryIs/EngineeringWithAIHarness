import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { attachPersonaToIntent, auditIntentStateCopies, createIntent, parsePersonaAttachment, recoverIntentTransactions } from '../src/intents.mjs';
import { initProject } from '../src/project.mjs';

test('creates a project-local persona-grounded intent', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-intent-'));
  try {
    initProject(root, { name: 'Intent Test' });
    const result = createIntent(root, {
      slug: 'supplier-renewal',
      domain: 'supplier-management',
      title: 'Supplier Renewal',
      intentMap: '   ',
      personas: ['ewai.vendor-risk-manager:primary:5', 'project.finance-controller:consulted:3']
    });
    const content = readFileSync(result.path, 'utf8');
    assert.match(content, /schema: ewai.intent\/v1/);
    assert.match(content, /ref: ewai.vendor-risk-manager/);
    assert.match(content, /depth: 5/);
    assert.match(content, /# Supplier Renewal/);
    const state = JSON.parse(readFileSync(result.path.replace(/\.md$/, '.json'), 'utf8'));
    assert.equal(state.schema, 'ewai.intent-state/v1');
    assert.equal(state.status, 'draft');
    assert.equal(state.deliveryStatus, 'not-started');
    assert.equal(state.currentPhase, 'backlog');
    assert.equal(state.intentMap, null);
    assert.deepEqual(state.relationships, []);
    assert.equal(state.deliveryShape, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('captures delivery-shape preview in Markdown and structured JSON', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-intent-shape-'));
  try {
    initProject(root, { name: 'Intent Shape Test' });
    const result = createIntent(root, {
      slug: 'accountable-alerting',
      domain: 'alerts',
      title: 'Accountable Alerting',
      deliveryShape: {
        recommendation: 'split',
        reason: 'The request contains dispatch recording, fallback, and escalation outcomes.',
        suggestedChildren: [
          {
            domain: 'alerts',
            slug: 'dispatch-recording',
            outcome: 'Every intended recipient receives a durable dispatch disposition.',
          },
          {
            domain: 'alerts',
            slug: 'channel-fallback',
            outcome: 'Failed preferred channels can fall back to the next allowed channel.',
            dependsOn: ['alerts/dispatch-recording'],
          },
        ],
        blockingQuestions: ['What acknowledgement threshold should stop escalation?'],
      },
    });
    const content = readFileSync(result.path, 'utf8');
    const state = JSON.parse(readFileSync(result.path.replace(/\.md$/, '.json'), 'utf8'));
    assert.match(content, /delivery_shape:/);
    assert.match(content, /## Delivery shape preview/);
    assert.match(content, /Recommendation:\*\* split/);
    assert.match(content, /alerts\/channel-fallback/);
    assert.equal(state.deliveryShape.recommendation, 'split');
    assert.equal(state.deliveryShape.reviewed_decision, null);
    assert.deepEqual(state.deliveryShape.blocking_questions, [
      'What acknowledgement threshold should stop escalation?',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('creates an intent with a delivery-shape preview from the CLI', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-intent-cli-shape-'));
  try {
    initProject(root, { name: 'Intent CLI Shape Test' });
    const shapePath = resolve(root, 'shape.yaml');
    writeFileSync(shapePath, [
      'recommendation: single',
      'reason: This is one reviewable delivery outcome.',
      'suggested_children: []',
      'blocking_questions: []',
      'reviewed_decision: keep-as-one',
      '',
    ].join('\n'));
    execFileSync(process.execPath, [
      resolve(process.cwd(), 'bin/ewai'),
      'intent',
      'create',
      'cli-shaped',
      '--project',
      root,
      '--domain',
      'delivery',
      '--delivery-shape',
      shapePath,
      '--json',
    ], { cwd: process.cwd(), encoding: 'utf8' });
    const state = JSON.parse(readFileSync(resolve(root, 'SPECS/2.Purpose/intents/delivery/cli-shaped.json'), 'utf8'));
    assert.equal(state.deliveryShape.recommendation, 'single');
    assert.equal(state.deliveryShape.reviewed_decision, 'keep-as-one');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('backs up intent-map membership and relationships in Markdown and JSON', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-intent-links-'));
  try {
    initProject(root, { name: 'Intent Relationship Test' });
    createIntent(root, {
      slug: 'accountable-dispatch',
      domain: 'alerts',
      title: 'Accountable Dispatch',
    });
    const result = createIntent(root, {
      slug: 'reconcile-delivery',
      domain: 'alerts',
      title: 'Reconcile Delivery',
      intentMap: 'safe-alerting',
      relationships: [{
        type: 'depends-on',
        target: 'alerts/accountable-dispatch',
        rationale: 'A complete dispatch ledger is required.',
      }],
    });
    const content = readFileSync(result.path, 'utf8');
    const state = JSON.parse(readFileSync(result.path.replace(/\.md$/, '.json'), 'utf8'));
    assert.match(content, /intent_map: safe-alerting/);
    assert.match(content, /depends-on.*alerts\/accountable-dispatch/s);
    assert.equal(state.intentMap, 'safe-alerting');
    assert.deepEqual(state.relationships, [{
      type: 'depends-on',
      target: 'alerts/accountable-dispatch',
      rationale: 'A complete dispatch ledger is required.',
      required_before: 'delivery',
      required_state: 'delivered',
    }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('materializes complete dependency qualifiers for omitted and partial inputs', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-intent-dependency-defaults-'));
  try {
    initProject(root, { name: 'Intent Dependency Defaults Test' });
    for (const slug of ['default-target', 'state-target', 'before-target']) {
      createIntent(root, { slug, domain: 'platform', title: slug });
    }
    const result = createIntent(root, {
      slug: 'dependent-work',
      domain: 'platform',
      title: 'Dependent Work',
      relationships: [
        { type: 'depends-on', target: 'platform/default-target' },
        { type: 'depends-on', target: 'platform/state-target', required_state: 'plan-complete' },
        { type: 'depends-on', target: 'platform/before-target', required_before: 'build' },
      ],
    });
    const state = JSON.parse(readFileSync(result.path.replace(/\.md$/, '.json'), 'utf8'));
    assert.deepEqual(state.relationships, [
      { type: 'depends-on', target: 'platform/default-target', required_before: 'delivery', required_state: 'delivered' },
      { type: 'depends-on', target: 'platform/state-target', required_before: 'delivery', required_state: 'plan-complete' },
      { type: 'depends-on', target: 'platform/before-target', required_before: 'build', required_state: 'delivered' },
    ]);
    const markdown = readFileSync(result.path, 'utf8');
    assert.match(markdown, /requires delivered before delivery/);
    assert.match(markdown, /requires plan-complete before delivery/);
    assert.match(markdown, /requires delivered before build/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a duplicate slug across domains because delivery folders are slug-keyed', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-intent-slug-namespace-'));
  try {
    initProject(root, { name: 'Intent Slug Namespace Test' });
    createIntent(root, { slug: 'shared-name', domain: 'alerts', title: 'Alert capability' });
    assert.throws(
      () => createIntent(root, { slug: 'shared-name', domain: 'billing', title: 'Billing capability' }),
      /project-wide unique/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('recovers an interrupted Markdown and JSON transaction before reading intent state', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-intent-recovery-'));
  try {
    initProject(root, { name: 'Intent Recovery Test' });
    const intent = createIntent(root, {
      slug: 'recoverable-intent',
      domain: 'quality',
      title: 'Recoverable Intent',
    });
    const original = readFileSync(intent.path, 'utf8');
    const transactionId = 'interrupted-test-transaction';
    const backup = `${intent.path}.ewai-test.bak`;
    const temporary = `${intent.path}.ewai-test.tmp`;
    renameSync(intent.path, backup);
    writeFileSync(intent.path, original.replace('status: draft', 'status: ready'));

    const journalRoot = resolve(root, '.ewai-pipeline/runtime/intent-transactions');
    mkdirSync(journalRoot, { recursive: true });
    writeFileSync(resolve(journalRoot, `${transactionId}.json`), JSON.stringify({
      schema: 'ewai.intent-transaction/v1',
      id: transactionId,
      entries: [{
        path: intent.path,
        temporary,
        backup,
        hadOriginal: true,
      }],
    }));

    assert.deepEqual(recoverIntentTransactions(root), { recovered: [transactionId] });
    assert.equal(readFileSync(intent.path, 'utf8'), original);
    assert.equal(existsSync(backup), false);
    assert.equal(existsSync(resolve(journalRoot, `${transactionId}.json`)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects unsafe slugs and invalid persona depth', () => {
  assert.throws(() => parsePersonaAttachment('ewai.dpo:assurance:6'), /integer from 1 to 5/);
  assert.throws(() => parsePersonaAttachment('Bad Persona:reviewer:3'), /Invalid persona reference/);
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-intent-invalid-'));
  try {
    initProject(root, { name: 'Intent Test' });
    assert.throws(() => createIntent(root, { slug: '../escape' }), /lower kebab-case/);
    assert.throws(
      () => createIntent(root, {
        slug: 'bad-shape',
        deliveryShape: { recommendation: 'huge', reason: 'Invalid recommendation.' },
      }),
      /Delivery-shape recommendation/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('serializes concurrent persona attachments without losing an ensemble member', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-intent-personas-'));
  try {
    initProject(root, { name: 'Persona Attachment Test' });
    const intent = createIntent(root, { slug: 'safe-ensemble', domain: 'delivery', personas: [] });
    await Promise.all([
      attachPersonaToIntent(root, 'delivery/safe-ensemble', { personaRef: 'ewai.core.maintainer', role: 'reviewer', depth: 3 }),
      attachPersonaToIntent(root, 'delivery/safe-ensemble', { personaRef: 'ewai.core.operator', role: 'validator', depth: 4 })
    ]);
    const content = readFileSync(intent.path, 'utf8');
    const metadata = YAML.parse(content.match(/^---\n([\s\S]*?)\n---/)[1]);
    assert.deepEqual(metadata.personas, [
      { ref: 'ewai.core.maintainer', role: 'reviewer', depth: 3 },
      { ref: 'ewai.core.operator', role: 'validator', depth: 4 }
    ]);
    assert.match(content, /# Safe Ensemble/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('backfills missing structured intent state and reports later drift', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-intent-state-audit-'));
  try {
    initProject(root, { name: 'Intent State Audit Test' });
    const intent = createIntent(root, { slug: 'stateful-intent', domain: 'delivery', personas: [] });
    const jsonPath = intent.path.replace(/\.md$/, '.json');
    rmSync(jsonPath);

    const repaired = auditIntentStateCopies(root, { repairMissing: true });
    assert.equal(repaired.status, 'consistent');
    assert.equal(repaired.created.length, 1);
    assert.equal(existsSync(jsonPath), true);

    const structured = JSON.parse(readFileSync(jsonPath, 'utf8'));
    structured.currentPhase = 'build';
    writeFileSync(jsonPath, JSON.stringify(structured));
    const drift = auditIntentStateCopies(root, { repairMissing: true });
    assert.equal(drift.status, 'drift-detected');
    assert.match(drift.drift[0].message, /Markdown and JSON disagree/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
