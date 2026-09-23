import test from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { beginDelivery } from '../src/delivery.mjs';
import { createIntent } from '../src/intents.mjs';
import {
  materialiseKnowledgeProposals,
  prepareKnowledgeProposals,
  recordKnowledgeProposalBundle,
  recordKnowledgeProposalReview,
} from '../src/knowledge-proposals.mjs';
import { createPersona } from '../src/personas.mjs';
import { promoteMeetingEvidence, recordMeetingReview, registerMeetingSource } from '../src/meeting-evidence.mjs';
import { initProject } from '../src/project.mjs';
import { acquireIntentOwnership, releaseIntentOwnership } from '../src/runtime/intent-ownership.mjs';
import {
  dispatchEligibleLifecycleDeliveries,
  LIFECYCLE_EVENT_CATALOGUE,
  readLifecycleHookWorkspace,
  registerLifecycleHandler,
  subscribeLifecycleHandler,
} from '../src/runtime/lifecycle-hooks.mjs';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('expiry during the transition snapshot cannot write canonical intent copies or publish phase entry', t => {
  const root = fs.realpathSync(mkdtempSync(resolve(tmpdir(), 'ewai-fenced-hook-expiry-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initProject(root, { name: 'Stale snapshot fixture' });
  const intent = createIntent(root, { domain: 'product', slug: 'alpha' });
  const before = readFileSync(intent.path, 'utf8');
  const handle = acquireIntentOwnership(root, 'product/alpha', { ownerId: 'snapshot-fixture-owner' });
  const originalRead = fs.readFileSync, originalNow = Date.now; let expired = false;
  fs.readFileSync = function(path, ...args) {
    const result = originalRead.call(this, path, ...args);
    if (path === intent.path && new Error().stack.includes('fileSnapshot')) {
      expired = true; Date.now = () => handle.expiresAt + 1;
    }
    return result;
  };
  syncBuiltinESMExports();
  try {
    assert.throws(() => beginDelivery(root, 'alpha', { tool: 'codex', ownership: handle }), error => error.code === 'intent-ownership-stale');
    assert.equal(expired, true);
    assert.equal(originalRead(intent.path, 'utf8'), before);
    assert.equal(existsSync(resolve(root, 'SPECS/6.Build/alpha/delivery-state.json')), false);
    assert.equal(readLifecycleHookWorkspace(root).events.some(event => event.name === 'ewai.delivery.phase.entered'), false);
  } finally { fs.readFileSync = originalRead; syncBuiltinESMExports(); Date.now = originalNow; releaseIntentOwnership(root, handle); }
});

function createKnowledgeFixture(root) {
  const sourceRoot = resolve(root, 'SPECS/3.Evidence/retros');
  mkdirSync(sourceRoot, { recursive: true });
  writeFileSync(resolve(sourceRoot, 'delivery-learning.md'), '# Retrospective\n\n## What we learned\n\nUse immutable evidence before lifecycle notification.\n');
  const preparation = prepareKnowledgeProposals(root, 'retrospective:delivery-learning');
  const bundle = {
    schema: 'ewai.knowledge-proposal-bundle/v1',
    sourceRef: preparation.source.ref,
    sourceDigest: preparation.source.digest,
    proposals: [{
      id: 'KNP-001',
      kind: 'pattern',
      title: 'Persist before notification',
      destination: 'SPECS/5.Strategy/patterns/persist-before-notification.md',
      evidenceAnchors: [preparation.source.anchors[0].id],
      rationale: 'The retrospective describes a reusable lifecycle safety pattern.',
      uncertainty: 'Confirm applicability when a future integration requires synchronous acknowledgement.',
      relationships: [],
      proposedMarkdown: '# Persist before notification\n\nPersist canonical evidence before emitting lifecycle events.\n\n## Provenance\n\n- Source: `retrospective:delivery-learning`\n- Anchor: `heading:what-we-learned`\n',
    }],
  };
  const recording = recordKnowledgeProposalBundle(root, preparation.source.ref, {
    bundle,
    activePersonas: preparation.activePersonas,
    now: '2026-08-23T12:00:00.000Z',
  });
  recordKnowledgeProposalReview(root, recording.bundleId, {
    reviewedBy: 'Andre Boyle',
    dispositions: [{ proposalId: 'KNP-001', decision: 'accepted' }],
    now: '2026-08-23T12:05:00.000Z',
  });
  return recording;
}

function registerFailingKnowledgeHandler(root) {
  const folder = resolve(root, 'knowledge-handler');
  const entrypoint = resolve(folder, 'handler');
  const source = '#!/usr/bin/env node\nprocess.exit(7);\n';
  mkdirSync(folder, { recursive: true });
  writeFileSync(entrypoint, source, 'utf8');
  chmodSync(entrypoint, 0o755);
  writeFileSync(resolve(folder, 'lifecycle-handler.json'), `${JSON.stringify({
    schema: 'ewai.lifecycle-handler/v1',
    id: 'org.example.knowledge-observer',
    name: 'Knowledge observer',
    publisher: { id: 'org.example', name: 'Example Organisation' },
    version: '1.0.0',
    compatibility: { protocols: ['1'], eventSchemas: ['1'] },
    entrypoint: 'handler',
    digest: `sha256:${digest(source)}`,
    events: ['ewai.knowledge-proposals.materialised'],
    limits: { timeoutMs: 2_000, maxOutputBytes: 4_096 },
  }, null, 2)}\n`, 'utf8');
  const registration = registerLifecycleHandler(root, folder, { confirmed: true });
  subscribeLifecycleHandler(root, registration.id, ['ewai.knowledge-proposals.materialised'], { confirmed: true });
}

test('catalogues governed starter materialisation as a safe project lifecycle event', () => {
  const event = LIFECYCLE_EVENT_CATALOGUE.find(({ name }) => name === 'ewai.project.starter.materialised');
  assert.deepEqual(event.allowedFacts, [
    'receiptId',
    'adapterId',
    'treeDigest',
    'targetCount',
    'repositoryCount',
    'createdCount',
    'identicalCount',
    'completedAt',
  ]);
});

test('catalogues meeting evidence promotion as a bounded post-persistence event', () => {
  const event = LIFECYCLE_EVENT_CATALOGUE.find(({ name }) => name === 'ewai.meeting-evidence.promoted');
  assert.deepEqual(event.allowedFacts, ['sourceId', 'evidenceDigest', 'candidateCount', 'approvedAt']);
});

test('catalogues knowledge materialisation as a bounded post-persistence event', () => {
  const event = LIFECYCLE_EVENT_CATALOGUE.find(({ name }) => name === 'ewai.knowledge-proposals.materialised');
  assert.deepEqual(event.allowedFacts, [
    'bundleId',
    'materialisationDigest',
    'addedCount',
    'alreadyCurrentCount',
    'conflictCount',
    'materialisedAt',
  ]);
});

test('catalogues only bounded post-persistence policy design events', () => {
  const events = LIFECYCLE_EVENT_CATALOGUE.filter(({ name }) => name.startsWith('ewai.policy.'));
  assert.deepEqual(events.map(({ name }) => name), [
    'ewai.policy.facts.confirmed',
    'ewai.policy.evaluation.recorded',
    'ewai.policy.review.recorded',
    'ewai.policy.exception.recorded',
  ]);
  for (const event of events) {
    assert.deepEqual(event.allowedFacts, ['status', 'intentReference', 'evidenceDigest', 'ruleId']);
    assert.doesNotMatch(JSON.stringify(event), /raw|body|credential|absolute.?path/i);
  }
});

test('knowledge materialisation event is post-persistence safe and handler-failure isolated', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-knowledge-lifecycle-'));
  try {
    initProject(root, { name: 'Knowledge Lifecycle Test' });
    registerFailingKnowledgeHandler(root);
    const recording = createKnowledgeFixture(root);
    const result = materialiseKnowledgeProposals(root, recording.bundleId, {
      confirmed: true,
      approvedBy: 'Andre Boyle',
      now: '2026-08-23T12:10:00.000Z',
    });
    const destination = resolve(root, 'SPECS/5.Strategy/patterns/persist-before-notification.md');
    assert.equal(existsSync(destination), true);
    assert.equal(existsSync(resolve(root, result.ledgerPath)), true);
    assert.equal(result.lifecycle.status, 'published');

    let workspace = readLifecycleHookWorkspace(root);
    const event = workspace.events.find(({ name }) => name === 'ewai.knowledge-proposals.materialised');
    assert.equal(event.facts.bundleId, recording.bundleId);
    assert.equal(event.facts.addedCount, 1);
    assert.equal(event.evidence.includes(result.ledgerPath), true);
    assert.doesNotMatch(JSON.stringify(event), /immutable evidence|Persist canonical|delivery-learning\.md|\/SPECS\/3\.Evidence\/retros\//);

    const dispatch = await dispatchEligibleLifecycleDeliveries(root, { now: '2026-08-24T12:10:01.000Z' });
    assert.equal(dispatch.deliveries[0].status, 'retrying');
    assert.equal(readFileSync(destination, 'utf8').includes('Persist canonical evidence'), true);
    workspace = readLifecycleHookWorkspace(root);
    assert.equal(workspace.attempts[0].code, 'handler-exit');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('meeting promotion event is post-persistence safe and failure-isolated', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-meeting-lifecycle-'));
  try {
    initProject(root, { name: 'Meeting Lifecycle Test' });
    const folder = resolve(root, 'inputs');
    mkdirSync(folder, { recursive: true });
    const source = resolve(folder, 'meeting.txt');
    writeFileSync(source, 'A decision was agreed.\n');
    const registration = registerMeetingSource(root, source, { confirmed: true, label: 'Lifecycle source', cloudProcessing: 'allowed' });
    const sourceId = registration.source.sourceId;
    recordMeetingReview(root, sourceId, {
      reviewedBy: 'Reviewer',
      bundle: {
        schema: 'ewai.meeting-candidate-bundle/v1',
        sourceId,
        sourceDigest: registration.source.digest,
        candidates: [{
          id: 'MEC-001', type: 'decision', observedStatement: 'A decision was agreed.',
          interpretation: 'Candidate decision.', lineAnchors: [{ start: 1, end: 1 }], confidence: 'high'
        }]
      },
      dispositions: [{ candidateId: 'MEC-001', decision: 'accepted' }]
    });

    const result = promoteMeetingEvidence(root, sourceId, { confirmed: true, approvedBy: 'Approver' });
    const workspace = readLifecycleHookWorkspace(root);
    const event = workspace.events.find(({ name }) => name === 'ewai.meeting-evidence.promoted');
    assert.equal(event.facts.sourceId, sourceId);
    assert.equal(event.facts.candidateCount, 1);
    assert.equal(event.evidence.includes(result.jsonPath), true);
    assert.doesNotMatch(JSON.stringify(event), /A decision was agreed|meeting\.txt|\/inputs\//);
    assert.equal(result.lifecycle.status ?? 'published', 'published');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('publishes intent creation and initial phase entry after canonical persistence', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-lifecycle-emissions-'));
  try {
    initProject(root, { name: 'Lifecycle Emission Test' });
    createPersona({ scope: 'project', slug: 'release-owner', name: 'Release Owner', projectRoot: root });
    const intent = createIntent(root, {
      slug: 'safe-handoff',
      domain: 'platform',
      title: 'Safe Handoff',
      personas: [
        'ewai.core.end-user:primary:3',
        'ewai.premium.product-owner:consulted:4',
        'project.release-owner:accountable:5',
      ],
    });

    let workspace = readLifecycleHookWorkspace(root);
    assert.deepEqual(workspace.events.map((event) => event.name), ['ewai.intent.created']);
    assert.deepEqual(workspace.events[0].personas.map(({ id, tier }) => ({ id, tier })), [
      { id: 'ewai.core.end-user', tier: 'core' },
      { id: 'ewai.premium.product-owner', tier: 'premium' },
      { id: 'project.release-owner', tier: 'project' },
    ]);

    const begun = beginDelivery(root, 'safe-handoff', { tool: 'codex' });
    assert.equal(begun.state.intent.personas.length, 3);
    workspace = readLifecycleHookWorkspace(root);
    const phaseEntry = workspace.events.find((event) => event.name === 'ewai.delivery.phase.entered');
    assert.equal(phaseEntry.scope.phase, 'intent');
    assert.equal(phaseEntry.scope.intent, 'platform/safe-handoff');
    assert.equal(phaseEntry.personas.find((persona) => persona.tier === 'premium').id, 'ewai.premium.product-owner');
    assert.equal(phaseEntry.personas.find((persona) => persona.tier === 'project').id, 'project.release-owner');
    assert.equal(phaseEntry.evidence.includes(intent.path), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('source operations remain successful when safe lifecycle publication rejects context', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-lifecycle-fail-open-'));
  try {
    initProject(root, { name: 'x'.repeat(200) });
    const result = createIntent(root, {
      slug: 'canonical-first',
      domain: 'platform',
      title: 'Canonical First',
    });
    assert.equal(result.slug, 'canonical-first');
    assert.equal(readLifecycleHookWorkspace(root).events.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
