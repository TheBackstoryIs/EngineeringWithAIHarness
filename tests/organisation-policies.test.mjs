import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import { initProject, loadProjectConfig } from '../src/project.mjs';
import {
  listOrganisationBlueprints,
  resolveOrganisationBlueprint,
} from '../src/organisation-blueprints.mjs';
import {
  materialisePolicyBaseline,
  previewPolicyBaseline,
  readPolicyBaselineStatus,
  resolveOrganisationPolicy,
  validateOrganisationPolicy,
} from '../src/organisation-policies.mjs';

function policy(overrides = {}) {
  return {
    schema: 'ewai.organisation-policy/v1',
    id: 'data-handling',
    title: 'Data handling policy',
    version: '1.0.0',
    publisher: { id: 'northstar', name: 'Northstar Digital' },
    provenance: {
      kind: 'owner-declared',
      summary: 'Approved by the Northstar policy board.',
      sources: [{ id: 'policy-board-2026-08', label: 'Policy board decision, August 2026' }],
    },
    review_roles: [{ id: 'security-owner', name: 'Security Owner' }],
    unmatched_outcome: 'unassessed',
    rules: [
      {
        id: 'sensitive-data-external-ai',
        title: 'Do not send sensitive data to external AI',
        description: 'Sensitive information must remain in an approved destination.',
        when: {
          data_classification: ['sensitive'],
          destination: ['external-ai'],
          ai_use: ['generative'],
        },
        outcome: 'deny',
        controls: [],
        exceptions: { permitted: false },
      },
      {
        id: 'internal-ai-review',
        title: 'Review internal AI processing',
        description: 'Internal AI use needs accountable review.',
        when: { destination: ['approved-internal'], ai_use: ['generative'] },
        outcome: 'review-required',
        review_role: 'security-owner',
        controls: [],
        exceptions: { permitted: true, review_role: 'security-owner' },
      },
    ],
    ...overrides,
  };
}

function blueprintManifest(policySource = 'policies/data-handling.yaml') {
  return {
    schema: 'ewai.pack/v1',
    id: 'org.northstar.engineering',
    name: 'Northstar Engineering Baseline',
    description: 'Reviewed engineering and policy conventions.',
    version: '1.0.0',
    type: 'organisation',
    requires: [],
    blueprint: {
      publisher: { id: 'northstar', name: 'Northstar Digital' },
      compatibility: { ewai: '0.x' },
      modules: [{
        id: 'governance',
        name: 'Governance',
        description: 'Organisation policy and assurance rules.',
        required: true,
        standards: [],
        personas: [],
        design_systems: [],
        policies: [{ id: 'data-handling', title: 'Data handling policy', source: policySource }],
        starter_packs: [],
        boilerplates: [],
      }],
    },
  };
}

function writeBlueprint(root, content = policy(), manifest = blueprintManifest()) {
  const directory = resolve(root, 'org-northstar-engineering');
  mkdirSync(resolve(directory, 'policies'), { recursive: true });
  writeFileSync(resolve(directory, 'pack.yaml'), YAML.stringify(manifest, { lineWidth: 0 }));
  writeFileSync(resolve(directory, 'policies/data-handling.yaml'), YAML.stringify(content, { lineWidth: 0 }));
  return directory;
}

function resolvedPolicy(root) {
  const catalogue = listOrganisationBlueprints({ roots: [{ path: root, sourceClass: 'project' }] });
  return resolveOrganisationPolicy(resolveOrganisationBlueprint('org.northstar.engineering', catalogue));
}

test('validates a strict inert policy with a closed condition vocabulary', () => {
  const validated = validateOrganisationPolicy(policy(), {
    publisherId: 'northstar',
    contributionId: 'data-handling',
  });
  assert.equal(validated.policy.id, 'data-handling');
  assert.equal(validated.policy.rules.length, 2);
  assert.match(validated.digest, /^sha256:[a-f0-9]{64}$/);

  const unknownCondition = policy();
  unknownCondition.rules[0].when.http_header = ['authorization'];
  assert.throws(() => validateOrganisationPolicy(unknownCondition), /http_header|unrecognized|condition/i);

  const duplicate = policy({ rules: [policy().rules[0], policy().rules[0]] });
  assert.throws(() => validateOrganisationPolicy(duplicate), /duplicate rule/i);

  const ambiguous = policy();
  ambiguous.rules[0].when.destination = [];
  assert.throws(() => validateOrganisationPolicy(ambiguous), /destination|empty|at least one/i);
});

test('rejects executable or authority-confusing policy content', () => {
  for (const mutation of [
    (value) => { value.rules[0].command = 'curl https://example.invalid'; },
    (value) => { value.rules[0].prompt = 'Decide whether to allow this'; },
    (value) => { value.rules[0].when.expression = ['facts.data === "sensitive"']; },
    (value) => { value.rules[0].template = '{{ production.secret }}'; },
    (value) => { value.secret = 'secret-canary-that-must-never-be-accepted'; },
    (value) => { value.remote = 'https://example.invalid/policy.yaml'; },
  ]) {
    const hostile = policy();
    mutation(hostile);
    assert.throws(() => validateOrganisationPolicy(hostile), /command|prompt|expression|template|secret|remote|unrecognized|executable/i);
  }
});

test('resolves Blueprint policy contributions separately and deterministically', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-policy-resolve-'));
  try {
    writeBlueprint(root);
    const catalogue = listOrganisationBlueprints({ roots: [{ path: root, sourceClass: 'project' }] });
    const blueprint = resolveOrganisationBlueprint('org.northstar.engineering', catalogue);
    assert.equal(blueprint.counts.policies, 1);
    assert.equal(blueprint.counts.standards, 0);
    const resolved = resolveOrganisationPolicy(blueprint);
    assert.equal(resolved.contributions.length, 1);
    assert.equal(resolved.contributions[0].packId, 'org.northstar.engineering');
    assert.equal(resolved.contributions[0].moduleId, 'governance');
    assert.equal(resolved.contributions[0].policy.id, 'data-handling');
    assert.match(resolved.effectiveDigest, /^sha256:[a-f0-9]{64}$/);

    const preview = previewPolicyBaseline(resolved);
    assert.equal(preview.status, 'available');
    assert.equal(preview.counts.policies, 1);
    assert.equal(preview.counts.rules, 2);
    assert.equal(JSON.stringify(preview).includes(root), false);
    assert.equal(JSON.stringify(preview).includes('Sensitive information must remain'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps projects without a selected policy explicitly non-blocking', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-policy-optional-'));
  try {
    initProject(root, { name: 'Policy Optional Project' });
    const before = readFileSync(resolve(root, 'SPECS/pipeline.yaml'), 'utf8');
    assert.deepEqual(readPolicyBaselineStatus(root), {
      schema: 'ewai.policy-baseline-status/v1',
      status: 'not-configured',
      enabled: false,
      blocking: false,
      notice: 'No organisation policy baseline has been selected for this project.',
    });
    assert.equal(readFileSync(resolve(root, 'SPECS/pipeline.yaml'), 'utf8'), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('requires exact named approval and atomically materialises project-owned evidence', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-policy-project-'));
  const packsRoot = mkdtempSync(resolve(tmpdir(), 'ewai-policy-packs-'));
  try {
    initProject(root, { name: 'Policy Project' });
    writeBlueprint(packsRoot);
    const resolved = resolvedPolicy(packsRoot);
    assert.throws(() => materialisePolicyBaseline(root, resolved, {
      confirmed: false,
      approvedBy: 'Policy Owner',
      expectedDigest: resolved.effectiveDigest,
    }), /explicit confirmation/i);
    assert.throws(() => materialisePolicyBaseline(root, resolved, {
      confirmed: true,
      approvedBy: '',
      expectedDigest: resolved.effectiveDigest,
    }), /named approver/i);
    assert.throws(() => materialisePolicyBaseline(root, resolved, {
      confirmed: true,
      approvedBy: 'Policy Owner',
      expectedDigest: `sha256:${'f'.repeat(64)}`,
    }), /digest drift/i);

    const configPath = resolve(root, 'SPECS/pipeline.yaml');
    const configBeforeFailure = readFileSync(configPath, 'utf8');
    assert.throws(() => materialisePolicyBaseline(root, resolved, {
      confirmed: true,
      approvedBy: 'Policy Owner',
      expectedDigest: resolved.effectiveDigest,
      testHooks: { failAfterEvidence: true },
    }), /injected policy baseline failure/i);
    assert.equal(readFileSync(configPath, 'utf8'), configBeforeFailure);
    assert.throws(
      () => readFileSync(resolve(root, 'SPECS/4.Constraints/organisation-policy/baseline.json'), 'utf8'),
      /ENOENT/,
    );

    const result = materialisePolicyBaseline(root, resolved, {
      confirmed: true,
      approvedBy: 'Policy Owner',
      expectedDigest: resolved.effectiveDigest,
      now: '2026-08-28T18:00:00.000Z',
    });
    assert.equal(result.status, 'enabled');
    assert.equal(result.approvedBy, 'Policy Owner');
    assert.equal(result.blocking, false);
    const { config } = loadProjectConfig(root);
    assert.equal(config.organisation_policy.effective_digest, resolved.effectiveDigest);
    assert.equal(config.organisation_policy.approved_by, 'Policy Owner');
    const evidencePath = resolve(root, config.organisation_policy.evidence);
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    assert.equal(evidence.schema, 'ewai.organisation-policy-baseline/v1');
    assert.equal(evidence.contributions[0].policy.rules.length, 2);
    assert.equal(evidence.authority.designTimeOnly, true);
    assert.equal(evidence.authority.productionEnforcement, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(packsRoot, { recursive: true, force: true });
  }
});

test('reports upstream drift without mutating accepted project evidence', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-policy-drift-project-'));
  const packsRoot = mkdtempSync(resolve(tmpdir(), 'ewai-policy-drift-packs-'));
  try {
    initProject(root, { name: 'Policy Drift Project' });
    const directory = writeBlueprint(packsRoot);
    const accepted = resolvedPolicy(packsRoot);
    materialisePolicyBaseline(root, accepted, {
      confirmed: true,
      approvedBy: 'Policy Owner',
      expectedDigest: accepted.effectiveDigest,
      now: '2026-08-28T18:00:00.000Z',
    });
    const evidencePath = resolve(root, 'SPECS/4.Constraints/organisation-policy/baseline.json');
    const acceptedEvidence = readFileSync(evidencePath, 'utf8');

    const tampered = JSON.parse(acceptedEvidence);
    tampered.contributions[0].policy.rules[0].outcome = 'allow';
    writeFileSync(evidencePath, `${JSON.stringify(tampered, null, 2)}\n`);
    assert.equal(readPolicyBaselineStatus(root).status, 'invalid');
    writeFileSync(evidencePath, acceptedEvidence);

    const changed = policy({ title: 'Updated data handling policy' });
    writeFileSync(resolve(directory, 'policies/data-handling.yaml'), YAML.stringify(changed, { lineWidth: 0 }));
    const current = resolvedPolicy(packsRoot);
    const status = readPolicyBaselineStatus(root, { resolved: current });
    assert.equal(status.status, 'stale');
    assert.equal(status.blocking, true);
    assert.equal(status.acceptedDigest, accepted.effectiveDigest);
    assert.equal(status.currentDigest, current.effectiveDigest);
    assert.equal(readFileSync(evidencePath, 'utf8'), acceptedEvidence);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(packsRoot, { recursive: true, force: true });
  }
});
