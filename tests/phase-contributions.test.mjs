import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createIntent } from '../src/intents.mjs';
import { initProject } from '../src/project.mjs';
import {
  confirmPhaseContribution,
  discardPhaseContributionDraft,
  handoffPhaseContribution,
  readPhaseStudio,
  requestPhaseContributionReview,
  savePhaseContributionDraft,
} from '../src/runtime/phase-contributions.mjs';
import { runtimePaths } from '../src/runtime/paths.mjs';

function personaCatalogue({ enrichment = false } = {}) {
  return [
    { id: 'project.product-owner', name: 'Project Product Owner', tier: 'project', category: 'product', description: 'Protects local outcomes and accountable acceptance.', tags: ['outcomes', 'acceptance', 'decisions'], capabilities: ['delivery-review'] },
    { id: 'ewai.core.maintainer', name: 'Software Maintainer', tier: 'core', category: 'engineering', description: 'Examines repository evidence, constraints, testing, operations and recovery.', tags: ['repository', 'constraints', 'testing', 'recovery'], capabilities: ['delivery-review'] },
    { id: 'ewai.core.end-user', name: 'End User', tier: 'core', category: 'product', description: 'Examines journeys, accessibility and useful outcomes.', tags: ['users', 'journeys', 'outcomes', 'accessibility'], capabilities: ['intent-review'] },
    ...(enrichment ? [
      { id: 'premium.service-designer', name: 'Service Design Lead', tier: 'premium', category: 'service-design', description: 'Challenges service hand-offs and participant journeys.', tags: ['journeys', 'stakeholders', 'handoff'], capabilities: ['delivery-review'], path: '/private/persona.md', rawDefinition: 'never expose' },
      { id: 'personal.operations-reviewer', name: 'Operations Reviewer', tier: 'personal', category: 'operations', description: 'Challenges operational readiness and recovery.', tags: ['operations', 'recovery', 'readiness'], capabilities: ['delivery-review'] },
    ] : []),
  ];
}

function projectFixture(name = 'Phase contribution') {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-phase-contribution-'));
  initProject(root, { name });
  createIntent(root, {
    slug: 'guided-service', domain: 'experience', title: 'Guided service',
    details: {
      problem: 'Owners need one shared evidence thread.', desiredOutcome: 'Owners can contribute without changing delivery authority.',
      users: ['Business owner', 'Technical owner'], journeys: ['Contribute, hand off, review and confirm.'],
      acceptanceCriteria: ['Attribution and authority remain clear.'], constraints: ['Keep evidence project-local.'], evidence: [], openDecisions: [],
    },
  });
  return root;
}

function governed(phase = 'plan', status = 'running') {
  const phaseIds = ['reconcile', 'plan', 'test-plan', 'build', 'delivery', 'retro'];
  const state = {
    schema: 'ewai.delivery-state/v1', slug: 'guided-service', status: 'in-progress', currentPhase: phase,
    updatedAt: '2026-08-24T12:00:00.000Z',
    phases: phaseIds.map((id) => ({ id, status: id === phase ? status : 'pending' })),
    adjuncts: [], humanGates: [{ id: 'manual-qa', status: phase === 'manual-qa' ? status : 'pending' }],
    approvals: { build: null },
  };
  const execution = {
    schema: 'ewai.execution-state/v1', valid: true, blockers: [],
    lifecycle: { status: state.status, currentPhase: phase, nextPhase: phase, deliveryStatePath: 'SPECS/6.Build/guided-service/delivery-state.json' },
  };
  return { deliveryState: state, executionState: execution };
}

function options(overrides = {}) {
  return {
    ...governed(), personas: personaCatalogue(), now: '2026-08-24T12:05:00.000Z', ...overrides,
  };
}

function firstContribution(expectedRevision = 0) {
  return {
    expectedRevision,
    ownerContext: 'business',
    ownerName: 'Casey Morgan',
    entries: [{
      topic: 'outcomes', classification: 'participant-statement',
      statement: 'Service owners need a clear outcome and acceptance owner.', source: 'Owner workshop 4',
    }],
    questions: ['Which operational group accepts the first release?'],
    conflicts: [], limitations: ['Representative users have not yet reviewed the journey.'],
  };
}

test('derives supported phase profiles and keeps unsupported or inconsistent state read-only', () => {
  const root = projectFixture('Profiles');
  try {
    for (const [phase, profile] of [
      ['reconcile', 'reconcile'], ['plan', 'plan'], ['test-plan', 'test-plan'],
      ['delivery', 'delivery-preparation'], ['manual-qa', 'manual-qa-preparation'],
    ]) {
      const workspace = readPhaseStudio(root, 'guided-service', options(governed(phase)));
      assert.equal(workspace.profile.id, profile);
      assert.equal(workspace.capabilities.contribute, true);
      assert.equal(workspace.authority.delivery, 'none');
    }

    const unsupported = readPhaseStudio(root, 'guided-service', options(governed('build')));
    assert.equal(unsupported.status, 'unsupported');
    assert.equal(unsupported.capabilities.contribute, false);

    const completed = readPhaseStudio(root, 'guided-service', options(governed('plan', 'completed')));
    assert.equal(completed.status, 'blocked');
    assert.equal(completed.capabilities.contribute, false);

    const invalidContext = governed('plan');
    invalidContext.executionState = { ...invalidContext.executionState, valid: false, blockers: [{ code: 'intent-state-drift', message: 'State copies disagree.', evidence: 'intent' }] };
    const inconsistent = readPhaseStudio(root, 'guided-service', options(invalidContext));
    assert.equal(inconsistent.status, 'blocked');
    assert.match(inconsistent.blockers[0].message, /disagree/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('recovers one attributed draft and rejects stale revision phase and profile writes', () => {
  const root = projectFixture('Revisions');
  try {
    const saved = savePhaseContributionDraft(root, 'guided-service', firstContribution(), options());
    assert.equal(saved.draft.revision, 1);
    assert.equal(saved.draft.entries[0].contributedBy, 'Casey Morgan');
    assert.equal(saved.draft.entries[0].ownerContext, 'business');
    assert.equal(saved.draft.entries[0].classification, 'participant-statement');
    assert.equal(existsSync(runtimePaths(root).phaseContributionsRoot), true);

    const restarted = readPhaseStudio(root, 'guided-service', options());
    assert.equal(restarted.draft.digest, saved.draft.digest);
    const before = readFileSync(runtimePaths(root).phaseContributionDraftPath('guided-service', 'plan'), 'utf8');

    assert.throws(() => savePhaseContributionDraft(root, 'guided-service', firstContribution(0), options()), /newer revision/);
    assert.throws(() => savePhaseContributionDraft(root, 'guided-service', { ...firstContribution(1), expectedPhase: 'reconcile' }, options()), /unknown field|current phase/);
    const changed = governed('test-plan');
    assert.throws(() => savePhaseContributionDraft(root, 'guided-service', { ...firstContribution(1), ownerContext: 'technical', ownerName: 'Ravi Shah' }, options(changed)), /belongs to plan|current phase changed/);
    assert.equal(readFileSync(runtimePaths(root).phaseContributionDraftPath('guided-service', 'plan'), 'utf8'), before);

    assert.throws(() => discardPhaseContributionDraft(root, 'guided-service', { expectedRevision: 1, confirmed: false }, options()), /explicit confirmation/);
    assert.equal(discardPhaseContributionDraft(root, 'guided-service', { expectedRevision: 1, confirmed: true }, options()).status, 'discarded');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('projects business technical and shared-review contexts over one thread and swaps safe personas', () => {
  const root = projectFixture('Context projection');
  try {
    const business = savePhaseContributionDraft(root, 'guided-service', firstContribution(), options({ personas: personaCatalogue({ enrichment: true }) }));
    const technical = savePhaseContributionDraft(root, 'guided-service', {
      expectedRevision: business.draft.revision, ownerContext: 'technical', ownerName: 'Ravi Shah',
      entries: [{ topic: 'dependencies', classification: 'repository-fact', statement: 'The loopback server owns the project root.', source: 'src/runtime/dashboard-server.mjs' }],
      questions: ['What recovery evidence is required?'],
      conflicts: [{ summary: 'Release readiness evidence is incomplete.', businessPosition: 'Proceed to representative review.', technicalPosition: 'Complete recovery testing first.' }],
      limitations: [],
    }, options({ personas: personaCatalogue({ enrichment: true }), now: '2026-08-24T12:06:00.000Z' }));
    assert.equal(technical.draft.entries.length, 2);
    assert.equal(technical.draft.entries[0].contributedBy, 'Casey Morgan');
    assert.notDeepEqual(business.activePersonas.map(({ id }) => id), technical.activePersonas.map(({ id }) => id));
    assert.equal(technical.activePersonas.every((persona) => !('path' in persona) && !('rawDefinition' in persona)), true);
    assert.equal(technical.activePersonas.length <= 4, true);

    const shared = savePhaseContributionDraft(root, 'guided-service', {
      expectedRevision: technical.draft.revision, ownerContext: 'shared-review', ownerName: 'Morgan Lee',
      entries: [{ topic: 'decisions', classification: 'named-decision', statement: 'Recovery testing remains visible as a release limitation.', source: 'Shared review' }],
      questions: [], conflicts: [], limitations: [],
    }, options({ personas: personaCatalogue({ enrichment: true }), now: '2026-08-24T12:07:00.000Z' }));
    assert.equal(shared.draft.entries.length, 3);
    assert.deepEqual(shared.draft.owners, { business: 'Casey Morgan', technical: 'Ravi Shah', sharedReview: 'Morgan Lee' });
    assert.equal(shared.context.id, 'shared-review');
    assert.match(shared.guidance.advisoryNotice, /personas.*lenses/i);
    assert.equal(shared.personaAvailability.premium.installed, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('appends digest-bound named owner handoffs without forking the evidence thread', () => {
  const root = projectFixture('Hand-offs');
  try {
    const saved = savePhaseContributionDraft(root, 'guided-service', firstContribution(), options());
    assert.throws(() => handoffPhaseContribution(root, 'guided-service', {
      expectedRevision: 1, currentDigest: saved.draft.digest, destinationContext: 'technical', toOwner: '', reason: 'Technical review', questions: ['Check recovery.'],
    }, options()), /destination owner/);
    assert.throws(() => handoffPhaseContribution(root, 'guided-service', {
      expectedRevision: 1, currentDigest: '0'.repeat(64), destinationContext: 'technical', toOwner: 'Ravi Shah', reason: 'Technical review', questions: ['Check recovery.'],
    }, options()), /digest/);

    const handed = handoffPhaseContribution(root, 'guided-service', {
      expectedRevision: 1, currentDigest: saved.draft.digest, destinationContext: 'technical', toOwner: 'Ravi Shah',
      reason: 'Validate dependencies and recovery.', questions: ['Which tests prove safe recovery?'],
    }, options({ now: '2026-08-24T12:08:00.000Z' }));
    assert.equal(handed.draft.revision, 2);
    assert.equal(handed.draft.entries.length, 1);
    assert.equal(handed.draft.handoffs.length, 1);
    assert.equal(handed.draft.handoffs[0].sourceDigest, saved.draft.digest);
    assert.equal(handed.draft.handoffs[0].fromOwner, 'Casey Morgan');
    assert.equal(handed.draft.handoffs[0].toOwner, 'Ravi Shah');
    assert.equal(handed.draft.ownerContext, 'technical');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('materialises paired immutable contribution evidence without delivery authority', () => {
  const root = projectFixture('Confirmation');
  try {
    const saved = savePhaseContributionDraft(root, 'guided-service', firstContribution(), options());
    const statePath = resolve(root, 'SPECS/6.Build/guided-service/delivery-state.json');
    const gatePath = resolve(root, 'SPECS/6.Build/guided-service/gates/plan/gate-ledger.json');
    const stateBefore = existsSync(statePath) ? readFileSync(statePath, 'utf8') : null;
    const gateBefore = existsSync(gatePath) ? readFileSync(gatePath, 'utf8') : null;

    assert.throws(() => confirmPhaseContribution(root, 'guided-service', { expectedRevision: 1, confirmed: false, confirmedBy: 'Morgan Lee' }, options()), /explicit confirmation/);
    assert.throws(() => confirmPhaseContribution(root, 'guided-service', { expectedRevision: 1, confirmed: true, confirmedBy: '' }, options()), /confirmer name/);
    const confirmed = confirmPhaseContribution(root, 'guided-service', {
      expectedRevision: saved.draft.revision, currentDigest: saved.draft.digest, confirmed: true, confirmedBy: 'Morgan Lee',
    }, options({ now: '2026-08-24T12:09:00.000Z' }));
    assert.equal(confirmed.schema, 'ewai.phase-contribution-confirmation/v1');
    assert.equal(confirmed.authority.phaseCompleted, false);
    assert.equal(confirmed.authority.buildApproved, false);
    assert.equal(confirmed.authority.manualQaApproved, false);
    assert.equal(existsSync(resolve(root, confirmed.created.markdownPath)), true);
    assert.equal(existsSync(resolve(root, confirmed.created.jsonPath)), true);
    const bundle = JSON.parse(readFileSync(resolve(root, confirmed.created.jsonPath), 'utf8'));
    assert.equal(bundle.schema, 'ewai.phase-contribution/v1');
    assert.equal(bundle.confirmation.confirmedBy, 'Morgan Lee');
    assert.match(bundle.assurance.notice, /supporting evidence only/i);
    assert.equal(JSON.stringify(bundle).includes('build-approval'), false);

    const repeated = confirmPhaseContribution(root, 'guided-service', {
      expectedRevision: confirmed.draftRevision, currentDigest: confirmed.draftDigest, confirmed: true, confirmedBy: 'Morgan Lee',
    }, options({ now: '2026-08-24T12:09:00.000Z' }));
    assert.notEqual(repeated.created.jsonPath, confirmed.created.jsonPath);
    assert.equal(existsSync(statePath) ? readFileSync(statePath, 'utf8') : null, stateBefore);
    assert.equal(existsSync(gatePath) ? readFileSync(gatePath, 'utf8') : null, gateBefore);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('queues a bounded authority-free host review without exposing contribution bodies', () => {
  const root = projectFixture('Review');
  try {
    const saved = savePhaseContributionDraft(root, 'guided-service', firstContribution(), options({ personas: personaCatalogue({ enrichment: true }) }));
    let queuedInput = null;
    const receipt = requestPhaseContributionReview(root, 'guided-service', {
      expectedRevision: saved.draft.revision, currentDigest: saved.draft.digest,
    }, options({
      personas: personaCatalogue({ enrichment: true }),
      queueReview(_root, input) { queuedInput = input; return { id: 'review-1', status: 'pending', ...input, authority: 'none' }; },
    }));
    assert.equal(receipt.authority, 'none');
    assert.equal(queuedInput.action, 'review-contribution');
    assert.equal(queuedInput.reviewContext.revision, 1);
    assert.equal(queuedInput.reviewContext.digest, saved.draft.digest);
    assert.equal(queuedInput.reviewContext.activePersonas.length <= 4, true);
    assert.equal(JSON.stringify(queuedInput).includes(saved.draft.entries[0].statement), false);
    assert.equal(JSON.stringify(queuedInput).includes('never expose'), false);
    assert.equal('prompt' in queuedInput.reviewContext, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
