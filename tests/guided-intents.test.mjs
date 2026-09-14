import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { initProject } from '../src/project.mjs';
import { createIntent, updateIntentDeliveryState } from '../src/intents.mjs';
import {
  approveGuidedIntent,
  discardGuidedIntentDraft,
  readGuidedIntent,
  saveGuidedIntentDraft,
  selectIntentPersonas,
} from '../src/runtime/guided-intents.mjs';
import { runtimePaths } from '../src/runtime/paths.mjs';

function personas({ premium = true } = {}) {
  return [
    { id: 'ewai.core.end-user', name: 'End User', tier: 'core', category: 'product', description: 'Focuses on user outcomes, accessibility, and understandable journeys.', tags: ['users', 'outcomes', 'accessibility'], capabilities: ['intent-review'] },
    { id: 'ewai.core.maintainer', name: 'Software Maintainer', tier: 'core', category: 'engineering', description: 'Focuses on constraints, dependencies, testing, and safe change.', tags: ['constraints', 'dependencies', 'testing'], capabilities: ['delivery-review'] },
    { id: 'project.product-owner', name: 'Project Product Owner', tier: 'project', category: 'product', description: 'Protects local outcomes, acceptance, evidence, and prioritisation.', tags: ['outcomes', 'acceptance', 'evidence'], capabilities: ['intent-review'] },
    { id: 'personal.service-operator', name: 'Service Operator', tier: 'personal', category: 'operations', description: 'Looks for operational constraints and recovery needs.', tags: ['constraints', 'operations', 'recovery'], capabilities: ['delivery-review'] },
    ...(premium ? [{ id: 'premium.service-designer', name: 'Service Designer', tier: 'premium', category: 'service-design', description: 'Challenges user journeys and service hand-offs.', tags: ['users', 'journeys', 'outcomes'], capabilities: ['intent-review'], path: '/private/premium.md', rawDefinition: 'never expose' }] : []),
  ];
}

function completeIntent(overrides = {}) {
  return {
    domain: 'experience',
    slug: 'guided-renewals',
    title: 'Guided renewals',
    personas: [{ ref: 'project.product-owner', role: 'primary', depth: 5 }],
    relationships: [],
    deliveryShape: {
      recommendation: 'single',
      reason: 'One coherent user outcome and one transactional boundary.',
      suggestedChildren: [],
      blockingQuestions: [],
      reviewedDecision: 'keep-as-one',
    },
    details: {
      problem: 'Service managers cannot see the next supplier-renewal decision.',
      desiredOutcome: 'Every renewal has a visible owner and next action.',
      users: ['Service managers', 'Operations colleagues'],
      journeys: ['A manager opens the workspace and records the next decision.'],
      acceptanceCriteria: ['A named owner and next action are visible.'],
      constraints: ['Keep all draft content project-local.'],
      evidence: ['Observed missed renewals in the current workflow.'],
      openDecisions: ['Confirm the first representative-user cohort.'],
    },
    ...overrides,
  };
}

test('saves and resumes a non-canonical guided intent draft', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-guided-intent-draft-'));
  try {
    initProject(root, { name: 'Guided intent draft' });
    const initial = readGuidedIntent(root, { personas: personas() });
    assert.equal(initial.schema, 'ewai.guided-intent/v1');
    assert.equal(initial.draft.revision, 0);

    const saved = saveGuidedIntentDraft(root, {
      expectedRevision: 0,
      currentSection: 'outcome',
      mode: 'create',
      intent: completeIntent(),
    }, { personas: personas(), now: '2026-08-24T10:00:00.000Z' });
    assert.equal(saved.draft.revision, 1);
    assert.equal(saved.validation.valid, true);
    assert.equal(existsSync(runtimePaths(root).guidedIntentDraftPath), true);
    assert.equal(existsSync(resolve(root, 'SPECS/2.Purpose/intents/experience/guided-renewals.md')), false);

    const resumed = readGuidedIntent(root, { personas: personas() });
    assert.equal(resumed.draft.intent.details.problem, completeIntent().details.problem);
    assert.equal(resumed.draft.revision, 1);
    assert.throws(() => saveGuidedIntentDraft(root, {
      expectedRevision: 0,
      currentSection: 'constraints',
      mode: 'create',
      intent: completeIntent({ title: 'Stale overwrite' }),
    }, { personas: personas() }), /newer revision/);
    assert.equal(readGuidedIntent(root, { personas: personas() }).draft.intent.title, 'Guided renewals');

    assert.throws(() => discardGuidedIntentDraft(root, { expectedRevision: 1, confirmed: false }), /explicit confirmation/);
    const discarded = discardGuidedIntentDraft(root, { expectedRevision: 1, confirmed: true });
    assert.equal(discarded.status, 'discarded');
    assert.equal(existsSync(runtimePaths(root).guidedIntentDraftPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects unsafe and excessive guided intent content without partial mutation', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-guided-intent-bounds-'));
  try {
    initProject(root, { name: 'Guided intent bounds' });
    const saved = saveGuidedIntentDraft(root, { expectedRevision: 0, mode: 'create', currentSection: 'problem', intent: completeIntent() }, { personas: personas() });
    const before = readFileSync(runtimePaths(root).guidedIntentDraftPath, 'utf8');
    assert.throws(() => saveGuidedIntentDraft(root, {
      expectedRevision: saved.draft.revision,
      mode: 'create',
      currentSection: 'problem',
      intent: completeIntent({ domain: '../outside' }),
    }, { personas: personas() }), /lower kebab-case/);
    assert.throws(() => saveGuidedIntentDraft(root, {
      expectedRevision: saved.draft.revision,
      mode: 'create',
      currentSection: 'problem',
      intent: completeIntent({ details: { ...completeIntent().details, problem: 'x'.repeat(8_001) } }),
    }, { personas: personas() }), /exceeds 8000 characters/);
    assert.equal(readFileSync(runtimePaths(root).guidedIntentDraftPath, 'utf8'), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('replaces the active persona ensemble by section and keeps premium optional', () => {
  const root = mkdtempProject('No premium');
  try {
    const intent = completeIntent();
    const users = selectIntentPersonas('users', personas(), intent);
    const constraints = selectIntentPersonas('constraints', personas(), intent);
    assert.equal(users.length >= 2 && users.length <= 4, true);
    assert.equal(users.some((persona) => persona.tier === 'project'), true);
    assert.equal(users.some((persona) => persona.tier === 'premium'), true);
    assert.equal(constraints.some((persona) => persona.id === 'ewai.core.maintainer'), true);
    assert.notDeepEqual(users.map(({ id }) => id), constraints.map(({ id }) => id));
    for (const persona of users) {
      assert.deepEqual(Object.keys(persona).sort(), ['category', 'description', 'engagementReason', 'id', 'matchedSignals', 'name', 'tier']);
    }

    const noPremium = readGuidedIntent(root, { personas: personas({ premium: false }) });
    assert.equal(noPremium.personaAvailability.premium.installed, false);
    assert.match(noPremium.personaAvailability.premium.reason, /No installed premium personas/);
    assert.equal(noPremium.baseline.completeWithoutPremium, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function mkdtempProject(name) {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-guided-intent-project-'));
  initProject(root, { name });
  return root;
}

test('previews exact destinations and requires explicit named current-revision approval', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-guided-intent-approval-'));
  try {
    initProject(root, { name: 'Guided intent approval' });
    const saved = saveGuidedIntentDraft(root, { expectedRevision: 0, mode: 'create', currentSection: 'review', intent: completeIntent() }, { personas: personas(), now: '2026-08-24T10:00:00.000Z' });
    assert.deepEqual(saved.preview.destinations, [
      'SPECS/2.Purpose/intents/experience/guided-renewals.md',
      'SPECS/2.Purpose/intents/experience/guided-renewals.json',
    ]);
    assert.equal(saved.preview.destinations.some((path) => path.startsWith('/')), false);
    assert.throws(() => approveGuidedIntent(root, { expectedRevision: 1, confirmed: false, approvedBy: 'Owner' }, { personas: personas() }), /explicit confirmation/);
    assert.throws(() => approveGuidedIntent(root, { expectedRevision: 1, confirmed: true, approvedBy: '' }, { personas: personas() }), /approver name/);
    assert.throws(() => approveGuidedIntent(root, { expectedRevision: 0, confirmed: true, approvedBy: 'Owner' }, { personas: personas() }), /newer revision/);

    assert.throws(() => approveGuidedIntent(root, { expectedRevision: 1, confirmed: true, approvedBy: 'Owner' }, {
      personas: personas(),
      create() { throw new Error('Injected canonical failure'); },
    }), /Injected canonical failure/);
    assert.equal(existsSync(runtimePaths(root).guidedIntentDraftPath), true);

    const approved = approveGuidedIntent(root, { expectedRevision: 1, confirmed: true, approvedBy: 'Product Owner' }, { personas: personas(), now: '2026-08-24T10:05:00.000Z' });
    assert.equal(approved.status, 'completed');
    assert.equal(approved.approval.approvedBy, 'Product Owner');
    assert.equal(approved.authority.buildApproved, false);
    assert.equal(approved.authority.manualQaApproved, false);
    assert.equal(existsSync(resolve(root, approved.created.markdownPath)), true);
    assert.equal(existsSync(resolve(root, approved.created.jsonPath)), true);
    assert.equal(existsSync(runtimePaths(root).guidedIntentDraftPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reconciles only consistent eligible draft intents while preserving identity relationships and state', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-guided-intent-reconcile-'));
  try {
    initProject(root, { name: 'Guided intent reconcile' });
    createIntent(root, {
      slug: 'existing-intent', domain: 'experience', title: 'Existing intent',
      personas: [{ ref: 'project.product-owner', role: 'primary', depth: 4 }],
      relationships: [], deliveryShape: completeIntent().deliveryShape, details: completeIntent().details,
    });
    const imported = saveGuidedIntentDraft(root, {
      expectedRevision: 0, mode: 'reconcile', sourceReference: 'experience/existing-intent', currentSection: 'outcome',
    }, { personas: personas(), now: '2026-08-24T10:10:00.000Z' });
    const changed = structuredClone(imported.draft.intent);
    changed.details.desiredOutcome = 'Every renewal has a reviewed owner, next action, and due date.';
    const saved = saveGuidedIntentDraft(root, {
      expectedRevision: imported.draft.revision, mode: 'reconcile', sourceReference: 'experience/existing-intent', currentSection: 'review', intent: changed,
    }, { personas: personas(), now: '2026-08-24T10:11:00.000Z' });
    assert.equal(saved.preview.changes.some((change) => change.section === 'desiredOutcome'), true);
    const approved = approveGuidedIntent(root, { expectedRevision: saved.draft.revision, confirmed: true, approvedBy: 'Product Owner' }, { personas: personas(), now: '2026-08-24T10:12:00.000Z' });
    assert.equal(approved.mode, 'reconcile');
    const state = JSON.parse(readFileSync(resolve(root, 'SPECS/2.Purpose/intents/experience/existing-intent.json'), 'utf8'));
    assert.equal(state.slug, 'existing-intent');
    assert.equal(state.status, 'draft');
    assert.equal(state.deliveryStatus, 'not-started');
    assert.deepEqual(state.relationships, []);

    createIntent(root, { slug: 'active-intent', domain: 'experience', title: 'Active intent', details: completeIntent().details });
    updateIntentDeliveryState(root, resolve(root, 'SPECS/2.Purpose/intents/experience/active-intent.md'), { status: 'in-progress', deliveryStatus: 'in-progress', currentPhase: 'build', deliveryStatePath: 'SPECS/6.Build/active-intent/delivery-state.json' });
    assert.throws(() => saveGuidedIntentDraft(root, {
      expectedRevision: 0, mode: 'reconcile', sourceReference: 'experience/active-intent', currentSection: 'identity',
    }, { personas: personas() }), /cannot be reconciled/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
