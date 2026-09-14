import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import { initProject } from '../src/project.mjs';
import { readPolicyBaselineStatus } from '../src/organisation-policies.mjs';
import {
  approveGuidedDiscovery,
  guidedDiscoveryOwnerEvidence,
  readGuidedDiscovery,
  saveGuidedDiscoveryDraft,
  selectDiscoveryPersonas
} from '../src/runtime/guided-discovery.mjs';
import { runtimePaths } from '../src/runtime/paths.mjs';

function writeOrganisationBlueprint(root) {
  const directory = resolve(root, 'org-acme-engineering');
  const manifest = {
    schema: 'ewai.pack/v1', id: 'org.acme.engineering', name: 'Acme Engineering',
    description: 'Acme project conventions.', version: '1.0.0', type: 'organisation', requires: [],
    blueprint: {
      publisher: { id: 'acme', name: 'Acme' }, compatibility: { ewai: '0.x' },
      modules: [
        {
          id: 'foundation', name: 'Foundation', description: 'Required Acme rules.', required: true,
          standards: [{ id: 'delivery', title: 'Delivery standard', source: 'standards/delivery.md' }],
          personas: [{ id: 'acme-owner', name: 'Acme Owner', source: 'personas/owner.md' }], boilerplates: []
        },
        {
          id: 'regulated', name: 'Regulated delivery', description: 'Optional regulated controls.', required: false,
          standards: [{ id: 'regulated', title: 'Regulated standard', source: 'standards/regulated.md' }],
          personas: [],
          policies: [{ id: 'data-handling', title: 'Data handling policy', source: 'policies/data-handling.yaml' }],
          boilerplates: []
        }
      ]
    }
  };
  const files = {
    'pack.yaml': YAML.stringify(manifest, { lineWidth: 0 }),
    'standards/delivery.md': '# Delivery standard\n\nReview every release.\n',
    'standards/regulated.md': '# Regulated standard\n\nPreserve accountable evidence.\n',
    'policies/data-handling.yaml': YAML.stringify({
      schema: 'ewai.organisation-policy/v1',
      id: 'data-handling',
      title: 'Data handling policy',
      version: '1.0.0',
      publisher: { id: 'acme', name: 'Acme' },
      provenance: {
        kind: 'owner-declared',
        summary: 'Approved Acme data handling rules.',
        sources: [{ id: 'policy-board', label: 'Acme policy board decision' }],
      },
      review_roles: [{ id: 'security-owner', name: 'Security Owner' }],
      unmatched_outcome: 'unassessed',
      rules: [{
        id: 'sensitive-data-review',
        title: 'Review sensitive data use',
        description: 'Sensitive data processing needs an accountable review.',
        when: { data_classification: ['sensitive'] },
        outcome: 'review-required',
        review_role: 'security-owner',
        controls: [],
        exceptions: { permitted: false },
      }],
    }, { lineWidth: 0 }),
    'personas/owner.md': '---\nname: Acme Owner\ndescription: Applies Acme operating context.\ncategory: operations\ntags: [operations, delivery]\n---\n\n# Acme Owner\n\nUse local Acme knowledge.\n'
  };
  for (const [relative, content] of Object.entries(files)) {
    const path = resolve(directory, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return [{ path: root, sourceClass: 'project' }];
}

function validAnswers(name = 'Guided Discovery Test') {
  return {
    schema: 'ewai.discovery-answers/v1',
    project: {
      name,
      purpose: 'Make supplier renewals visible, owned, and calm.',
      problem: 'Service managers cannot see what is due or who owns the next decision.',
      whyNow: 'Renewals are being missed as the supplier estate grows.',
      primaryUsers: ['Service managers', 'Operations colleagues'],
      desiredOutcomes: ['Every renewal has a visible owner and next action'],
      inScope: ['Project-local renewal workflow'],
      nonGoals: ['Hosted collaboration'],
      oneSentence: 'A calm, visible renewal workflow.'
    },
    delivery: { technologyPacks: [], deploymentTarget: 'Local project dashboard' },
    assurance: {
      dataClassification: 'internal', personalData: 'no', sensitiveData: 'no',
      authentication: 'no', multiTenant: 'no', internetFacing: 'no', payments: 'no',
      aiFeatures: 'yes', accessibility: 'yes', availability: 'standard'
    }
  };
}

function personas() {
  return [
    { id: 'ewai.core.end-user', name: 'End User', tier: 'core', category: 'product', description: 'Focus on usability, accessibility, and outcomes.', tags: ['usability', 'accessibility', 'outcomes'], capabilities: ['intent-review'], path: '/private/core.md', rawDefinition: 'hidden' },
    { id: 'ewai.core.archaeologist', name: 'EWAI Archaeologist', tier: 'core', category: 'engineering', description: 'Reconstructs decisions from repository and human evidence.', tags: ['evidence', 'decisions', 'repository'], capabilities: ['project-archaeology'] },
    { id: 'premium.service-designer', name: 'Service Designer', tier: 'premium', category: 'service-design', description: 'Understands users, stakeholders, situations, and service hand-offs.', tags: ['end-user', 'stakeholder', 'service-design'], capabilities: ['design-review'], path: '/private/premium.md' },
    { id: 'personal.user-researcher', name: 'User Researcher', tier: 'personal', category: 'research', description: 'Looks for evidence about user needs and accessibility.', tags: ['end-user', 'evidence'], capabilities: ['research-review'] },
    { id: 'project.renewal-lead', name: 'Renewal Operations Lead', tier: 'project', category: 'operations', description: 'Applies project-specific operational and stakeholder knowledge.', tags: ['operations', 'stakeholder'], capabilities: ['service-review'], path: '/private/project.md' },
    { id: 'premium.finance-auditor', name: 'Finance Auditor', tier: 'premium', category: 'finance', description: 'Reviews account reconciliation and tax.', tags: ['accounting'], capabilities: ['finance-review'] },
    { id: 'ewai.core.maintainer', name: 'Software Maintainer', tier: 'core', category: 'engineering', description: 'Focuses on architecture, testing, and safe change.', tags: ['architecture', 'testing'], capabilities: ['code-review'] },
    { id: 'ewai.core.operator', name: 'Service Operator', tier: 'core', category: 'operations', description: 'Focuses on security, resilience, recovery, and observable operations.', tags: ['operations', 'recovery'], capabilities: ['delivery-review'] }
  ];
}

test('keeps guided discovery drafts project-local and revision-safe', () => {
  const first = mkdtempSync(resolve(tmpdir(), 'ewai-guided-first-'));
  const second = mkdtempSync(resolve(tmpdir(), 'ewai-guided-second-'));
  try {
    initProject(first, { name: 'First Project' });
    initProject(second, { name: 'Second Project' });
    assert.notEqual(runtimePaths(first).guidedDiscoveryDraftPath, runtimePaths(second).guidedDiscoveryDraftPath);

    const initial = readGuidedDiscovery(first, { personas: personas() });
    assert.equal(initial.draft.revision, 0);
    assert.equal(initial.validation.valid, false);
    assert.equal(initial.activePersonas.length >= 2, true);

    const saved = saveGuidedDiscoveryDraft(first, {
      expectedRevision: 0,
      currentSection: 'people',
      answers: validAnswers('First Project')
    }, { personas: personas(), now: '2026-08-16T09:00:00.000Z' });
    assert.equal(saved.draft.revision, 1);
    assert.equal(saved.validation.valid, true);
    assert.equal(saved.preview.outputs.length, 10);
    assert.equal(saved.preview.outputs.some((output) => 'content' in output || 'path' in output), false);
    assert.equal(existsSync(resolve(first, 'SPECS/1.Scope/context.md')), false);
    assert.equal(existsSync(runtimePaths(first).guidedDiscoveryDraftPath), true);

    const resumed = readGuidedDiscovery(first, { personas: personas() });
    assert.equal(resumed.draft.answers.project.purpose, validAnswers().project.purpose);
    assert.equal(resumed.draft.revision, 1);
    assert.equal(readGuidedDiscovery(second, { personas: personas() }).draft.revision, 0);

    assert.throws(() => saveGuidedDiscoveryDraft(first, {
      expectedRevision: 0,
      currentSection: 'assurance',
      answers: validAnswers('Stale overwrite')
    }, { personas: personas() }), /newer revision/);
    assert.equal(readGuidedDiscovery(first, { personas: personas() }).draft.answers.project.name, 'First Project');
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
});

test('projects answered discovery fields as bounded declared evidence without answer bodies', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-guided-depth-evidence-'));
  try {
    initProject(root, { name: 'Guided depth evidence' });
    saveGuidedDiscoveryDraft(root, {
      expectedRevision: 0,
      currentSection: 'assurance',
      answers: validAnswers('Guided depth evidence'),
    }, { personas: personas(), now: '2026-08-28T12:00:00.000Z' });
    const evidence = guidedDiscoveryOwnerEvidence(root);
    assert.equal(evidence.length > 7, true);
    assert.equal(evidence.some(({ dimension }) => dimension === 'data'), true);
    assert.equal(evidence.some(({ dimension }) => dimension === 'security'), true);
    assert.equal(evidence.every(({ authority }) => authority === 'declared'), true);
    assert.equal(evidence.every(({ evidenceDigest }) => /^sha256:[a-f0-9]{64}$/.test(evidenceDigest)), true);
    const serialized = JSON.stringify(evidence);
    assert.equal(serialized.includes(validAnswers().project.purpose), false);
    assert.equal(serialized.includes(validAnswers().delivery.deploymentTarget), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('safely previews installed organisation blueprints and preserves selection in the draft', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-guided-blueprint-'));
  const packsRoot = mkdtempSync(resolve(tmpdir(), 'ewai-guided-blueprint-packs-'));
  try {
    initProject(root, { name: 'Blueprint Guided Project' });
    const organisationBlueprintRoots = writeOrganisationBlueprint(packsRoot);
    const initial = readGuidedDiscovery(root, { personas: personas(), organisationBlueprintRoots });
    assert.equal(initial.organisationBlueprints.length, 1);
    assert.equal(initial.organisationBlueprints[0].id, 'org.acme.engineering');
    assert.equal(initial.policyBaseline.status, 'not-configured');
    assert.equal(JSON.stringify(initial.organisationBlueprints).includes(packsRoot), false);
    assert.equal(JSON.stringify(initial.organisationBlueprints).includes('Use local Acme knowledge'), false);

    const selectedAnswers = validAnswers('Blueprint Guided Project');
    selectedAnswers.delivery.organisationBlueprint = {
      packId: 'org.acme.engineering', enabledModules: ['regulated']
    };
    const saved = saveGuidedDiscoveryDraft(root, {
      expectedRevision: 0,
      currentSection: 'delivery',
      answers: selectedAnswers
    }, { personas: personas(), organisationBlueprintRoots, now: '2026-08-16T09:00:00.000Z' });
    assert.deepEqual(saved.draft.answers.delivery.organisationBlueprint, selectedAnswers.delivery.organisationBlueprint);
    assert.equal(saved.preview.organisationBlueprint.root.id, 'org.acme.engineering');
    assert.deepEqual(saved.preview.organisationBlueprint.enabledModules, ['regulated']);
    assert.equal(saved.policyBaseline.status, 'available');
    assert.equal(saved.policyBaseline.counts.policies, 1);
    assert.equal(saved.policyBaseline.policies[0].required, false);
    assert.equal(JSON.stringify(saved.policyBaseline).includes('Sensitive data processing'), false);
    assert.equal(saved.preview.outputs.length, 14);
    assert.equal(saved.preview.outputs.some((output) => 'content' in output || 'path' in output), false);
    assert.equal(existsSync(resolve(root, 'SPECS/5.Strategy/organisation-blueprint.md')), false);

    assert.throws(() => approveGuidedDiscovery(root, {
      expectedRevision: saved.draft.revision,
      confirmed: true,
      approvedBy: 'Product Owner'
    }, {
      personas: personas(), organisationBlueprintRoots, now: '2026-08-16T09:04:00.000Z',
      commit() { throw new Error('Injected discovery commit failure'); },
    }), /Injected discovery commit failure/);
    assert.equal(readPolicyBaselineStatus(root).status, 'not-configured');
    assert.equal(existsSync(resolve(root, 'SPECS/4.Constraints/organisation-policy/baseline.json')), false);
    assert.equal(existsSync(resolve(root, 'SPECS/1.Scope/context.md')), false);
    assert.equal(existsSync(runtimePaths(root).guidedDiscoveryDraftPath), true);

    const approved = approveGuidedDiscovery(root, {
      expectedRevision: saved.draft.revision,
      confirmed: true,
      approvedBy: 'Product Owner'
    }, { personas: personas(), organisationBlueprintRoots, now: '2026-08-16T09:05:00.000Z' });
    assert.equal(approved.organisationBlueprint.root.id, 'org.acme.engineering');
    assert.equal(approved.policyBaseline.status, 'enabled');
    assert.equal(readPolicyBaselineStatus(root).status, 'enabled');
    assert.equal(existsSync(resolve(root, 'SPECS/4.Constraints/organisation-policy/baseline.json')), true);
    assert.equal(existsSync(resolve(root, 'SPECS/1.Scope/personas/project/acme-acme-owner.md')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(packsRoot, { recursive: true, force: true });
  }
});

test('selects and safely projects a tier-aware contextual persona ensemble', () => {
  const people = selectDiscoveryPersonas('people', personas(), validAnswers());
  assert.equal(people.length >= 2 && people.length <= 4, true);
  assert.equal(people.some((persona) => persona.tier === 'premium'), true);
  assert.equal(people.some((persona) => persona.tier === 'project'), true);
  assert.equal(people.some((persona) => persona.id === 'premium.finance-auditor'), false);
  assert.deepEqual(selectDiscoveryPersonas('people', personas(), validAnswers()), people);
  for (const persona of people) {
    assert.deepEqual(Object.keys(persona).sort(), ['category', 'description', 'engagementReason', 'id', 'matchedSignals', 'name', 'tier']);
    assert.equal(persona.matchedSignals.length > 0, true);
  }

  const assurance = selectDiscoveryPersonas('assurance', personas(), validAnswers());
  assert.notDeepEqual(assurance.map((persona) => persona.id), people.map((persona) => persona.id));
  assert.equal(assurance.some((persona) => persona.id === 'ewai.core.operator'), true);
  const review = selectDiscoveryPersonas('review', personas(), validAnswers());
  assert.equal(review.length >= 2, true);
});

test('requires named explicit approval and retains a recoverable draft after failure', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-guided-approval-'));
  try {
    initProject(root, { name: 'Approval Project' });
    const saved = saveGuidedDiscoveryDraft(root, {
      expectedRevision: 0,
      currentSection: 'review',
      answers: validAnswers('Approval Project')
    }, { personas: personas(), now: '2026-08-16T09:00:00.000Z' });

    assert.throws(() => approveGuidedDiscovery(root, {
      expectedRevision: saved.draft.revision,
      confirmed: false,
      approvedBy: 'Project Owner'
    }, { personas: personas() }), /explicit confirmation/);
    assert.throws(() => approveGuidedDiscovery(root, {
      expectedRevision: saved.draft.revision,
      confirmed: true,
      approvedBy: ''
    }, { personas: personas() }), /approver name/);

    assert.throws(() => approveGuidedDiscovery(root, {
      expectedRevision: saved.draft.revision,
      confirmed: true,
      approvedBy: 'Project Owner'
    }, {
      personas: personas(),
      commit() { throw new Error('Injected canonical failure'); }
    }), /Injected canonical failure/);
    assert.equal(readGuidedDiscovery(root, { personas: personas() }).draft.revision, saved.draft.revision);

    const approved = approveGuidedDiscovery(root, {
      expectedRevision: saved.draft.revision,
      confirmed: true,
      approvedBy: 'Project Owner'
    }, { personas: personas(), now: '2026-08-16T09:05:00.000Z' });
    assert.equal(approved.status, 'completed');
    assert.equal(approved.approval.approvedBy, 'Project Owner');
    assert.equal(existsSync(resolve(root, 'SPECS/1.Scope/context.md')), true);
    assert.equal(existsSync(runtimePaths(root).guidedDiscoveryDraftPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
