import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import { initProject } from '../src/project.mjs';
import {
  ROLLOUT_ADVISORY_NOTICE,
  ROLLOUT_ASSURANCE_NOTICE,
  readRolloutWorkspace,
  validateRolloutManifest,
} from '../src/network-rollout.mjs';

const digest = `sha256:${'a'.repeat(64)}`;

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function updateConfig(root, mutate) {
  const path = resolve(root, 'SPECS/pipeline.yaml');
  const config = YAML.parse(readFileSync(path, 'utf8'));
  mutate(config);
  writeFileSync(path, YAML.stringify(config, { lineWidth: 0 }));
}

function policy(overrides = {}) {
  return {
    schema: 'ewai.rollout/v1',
    id: 'client-network',
    name: 'Client delivery network',
    owner: 'Practice Owner',
    stale_after_days: 30,
    baselines: [{
      id: 'assured-node',
      name: 'Assured Node baseline',
      owner: 'Architecture Owner',
      pack: { id: 'org.example.assured-node', version: '1.2.0', digest },
    }],
    cohorts: [{
      id: 'wave-one',
      name: 'Wave one',
      baseline: 'assured-node',
      owner: 'Cohort Owner',
      review_by: '2026-09-30',
      required_evidence: ['blueprint', 'delivery', 'standards', 'manual-qa', 'security'],
      projects: [{ id: 'billing', owner: 'Billing Owner', review_owner: 'Assurance Lead' }],
    }],
    ...overrides,
  };
}

function portfolio() {
  return {
    schema: 'ewai.portfolio/v1',
    id: 'network-portfolio',
    name: 'Network portfolio',
    owner: 'Portfolio Owner',
    members: [
      { id: 'network', kind: 'portfolio', name: 'Network', owner: 'Portfolio Owner' },
      {
        id: 'billing', kind: 'project', name: 'Billing', owner: 'Billing Owner', parent: 'network',
        repository: 'application', project_path: 'clients/billing',
      },
    ],
    dependencies: [],
  };
}

function createWorkspace(options = {}) {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-rollout-domain-'));
  initProject(root, { name: 'Network host' });
  const child = resolve(root, 'clients/billing');
  mkdirSync(child, { recursive: true });
  initProject(child, { name: 'Billing' });
  updateConfig(child, (config) => {
    if (options.blueprint !== false) {
      config.blueprints = { organisation: {
        root: {
          id: options.packId ?? 'org.example.assured-node',
          version: options.version ?? '1.2.0',
          digest: options.digest ?? digest,
        },
        packs: [{ id: 'org.example.assured-node', version: '1.2.0', digest }],
        selection_digest: digest,
        enabled_modules: ['core'],
        applied_modules: ['core'],
        approved_by: 'Billing Owner',
        approved_at: '2026-08-20T10:00:00.000Z',
        evidence: 'SPECS/5.Strategy/organisation-blueprint.md',
      } };
    }
    if (options.security !== false) {
      config.security_validation = { enabled: true, profiles: [{
        id: 'source-review', capability: 'source-static', required: true,
        freshness_hours: 168, timeout_seconds: 120, accountable_role: 'Security Lead',
        modes: ['command'], provider: 'agentic-security', checkpoint: 'release',
      }] };
    }
  });
  write(resolve(root, 'SPECS/1.Scope/portfolio.yaml'), YAML.stringify(portfolio(), { lineWidth: 0 }));
  write(resolve(root, 'SPECS/1.Scope/rollout.yaml'), YAML.stringify(policy(options.policy), { lineWidth: 0 }));
  write(resolve(child, 'SPECS/4.Constraints/standards/client-standard.md'), '# Client standard\n\nSENSITIVE-STANDARD-BODY\n');
  write(resolve(child, 'SPECS/5.Strategy/organisation-blueprint.md'), 'SENSITIVE-RECEIPT-BODY\n');
  write(resolve(child, 'SPECS/6.Build/billing/delivery-state.json'), `${JSON.stringify({
    schema: 'ewai.delivery-state/v1', slug: 'billing', status: 'in-progress', currentPhase: 'build',
    updatedAt: options.updatedAt ?? '2026-08-22T12:00:00.000Z', approvals: { build: { approvedBy: 'Billing Owner' } },
    humanGates: [{ id: 'manual-qa', status: options.manualQa ?? 'pending' }],
    hidden: 'SENSITIVE-DELIVERY-BODY',
  }, null, 2)}\n`);
  return { root, child };
}

const personas = [
  {
    id: 'project.product-owner', name: 'Product Owner', tier: 'project', category: 'product',
    description: 'Protects rollout outcomes, client ownership and adoption review.',
    tags: ['rollout', 'client', 'adoption'], body: 'SENSITIVE-PERSONA-BODY', path: '/private/product-owner.md',
  },
  {
    id: 'ewai.premium.assurance-lead', name: 'Assurance Lead', tier: 'premium', category: 'assurance',
    description: 'Challenges security evidence, cohort assurance and review boundaries.',
    tags: ['security', 'assurance', 'cohort'], body: 'LICENSED-PREMIUM-BODY', path: '/private/premium.md',
  },
  {
    id: 'ewai.personal.delivery-coach', name: 'Delivery Coach', tier: 'personal', category: 'delivery',
    description: 'Examines delivery evidence and accountable recovery.', tags: ['delivery', 'recovery'],
  },
  {
    id: 'ewai.core.operator', name: 'Service Operator', tier: 'core', category: 'operations',
    description: 'Examines unavailable projects and operational recovery.', tags: ['unavailable', 'recovery'],
  },
];

test('validates a strict bounded policy and rejects competing topology or authority', () => {
  assert.equal(validateRolloutManifest(policy(), { portfolioProjectIds: ['billing'] }).valid, true);

  const unsafe = validateRolloutManifest(policy({
    cohorts: [{ ...policy().cohorts[0], projects: [{ id: 'billing', owner: 'Owner', repository: 'secret', project_path: '../client' }] }],
  }), { portfolioProjectIds: ['billing'] });
  assert.equal(unsafe.valid, false);
  assert.equal(unsafe.diagnostics.some((item) => item.code === 'rollout.schema'), true);

  const duplicate = validateRolloutManifest(policy({
    cohorts: [policy().cohorts[0], { ...policy().cohorts[0], id: 'wave-two' }],
  }), { portfolioProjectIds: ['billing'] });
  assert.equal(duplicate.valid, false);
  assert.equal(duplicate.diagnostics.some((item) => item.code === 'rollout.duplicate-assignment'), true);

  const missing = validateRolloutManifest(policy(), { portfolioProjectIds: ['identity'] });
  assert.equal(missing.valid, false);
  assert.equal(missing.diagnostics.some((item) => item.code === 'rollout.unknown-project'), true);

  const tooMany = validateRolloutManifest(policy({
    baselines: Array.from({ length: 26 }, (_, index) => ({
      id: `baseline-${index}`, name: `Baseline ${index}`, owner: 'Owner',
      pack: { id: 'org.example.assured-node', version: '1.2.0' },
    })),
  }), { portfolioProjectIds: ['billing'] });
  assert.equal(tooMany.valid, false);
});

test('derives exact adoption and structural evidence without exposing child content', () => {
  const { root, child } = createWorkspace();
  try {
    const policyBefore = readFileSync(resolve(root, 'SPECS/1.Scope/rollout.yaml'), 'utf8');
    const portfolioBefore = readFileSync(resolve(root, 'SPECS/1.Scope/portfolio.yaml'), 'utf8');
    const childBefore = readFileSync(resolve(child, 'SPECS/pipeline.yaml'), 'utf8');
    const workspace = readRolloutWorkspace(root, {
      personas,
      focus: 'cohort security assurance',
      now: '2026-08-23T12:00:00.000Z',
    });

    assert.equal(workspace.schema, 'ewai.rollout-workspace/v1');
    assert.equal(workspace.status, 'attention');
    assert.equal(workspace.cohorts[0].projects[0].adoption.state, 'aligned');
    assert.deepEqual(workspace.cohorts[0].projects[0].observedBlueprint, {
      id: 'org.example.assured-node', version: '1.2.0', digest,
    });
    assert.deepEqual(workspace.cohorts[0].projects[0].evidence.map((item) => item.class), [
      'blueprint', 'delivery', 'standards', 'manual-qa', 'security',
    ]);
    assert.equal(workspace.cohorts[0].projects[0].evidence.find((item) => item.class === 'manual-qa').state, 'missing');
    assert.equal(workspace.cohorts[0].projects[0].evidence.find((item) => item.class === 'security').state, 'missing');
    assert.equal(workspace.notices.advisory, ROLLOUT_ADVISORY_NOTICE);
    assert.equal(workspace.notices.security, ROLLOUT_ASSURANCE_NOTICE);
    assert.equal(workspace.activePersonas.some((persona) => persona.tier === 'project'), true);
    assert.equal(workspace.activePersonas.some((persona) => persona.tier === 'premium'), true);

    const encoded = JSON.stringify(workspace);
    for (const forbidden of [root, child, 'SENSITIVE-', 'LICENSED-PREMIUM-BODY', '/private/', '"findings":', '"dispositions":', '"credentials":']) {
      assert.equal(encoded.includes(forbidden), false, `response leaked ${forbidden}`);
    }
    assert.equal(readFileSync(resolve(root, 'SPECS/1.Scope/rollout.yaml'), 'utf8'), policyBefore);
    assert.equal(readFileSync(resolve(root, 'SPECS/1.Scope/portfolio.yaml'), 'utf8'), portfolioBefore);
    assert.equal(readFileSync(resolve(child, 'SPECS/pipeline.yaml'), 'utf8'), childBefore);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('uses literal Blueprint comparison and reports missing or stale project evidence honestly', () => {
  const drift = createWorkspace({ version: '9.0.0' });
  try {
    const workspace = readRolloutWorkspace(drift.root, { now: '2026-08-23T12:00:00.000Z' });
    assert.equal(workspace.cohorts[0].projects[0].adoption.state, 'review-required');
    assert.match(workspace.cohorts[0].projects[0].adoption.reason, /exact/i);
  } finally {
    rmSync(drift.root, { recursive: true, force: true });
  }

  const missing = createWorkspace({ blueprint: false, security: false });
  try {
    const workspace = readRolloutWorkspace(missing.root, { now: '2026-08-23T12:00:00.000Z' });
    const project = workspace.cohorts[0].projects[0];
    assert.equal(project.adoption.state, 'not-adopted');
    assert.equal(project.evidence.find((item) => item.class === 'blueprint').state, 'missing');
    assert.equal(project.evidence.find((item) => item.class === 'security').state, 'not-configured');
  } finally {
    rmSync(missing.root, { recursive: true, force: true });
  }

  const stale = createWorkspace({ updatedAt: '2020-01-01T00:00:00.000Z' });
  try {
    const workspace = readRolloutWorkspace(stale.root, { now: '2026-08-23T12:00:00.000Z' });
    assert.equal(workspace.cohorts[0].projects[0].adoption.state, 'stale');
    assert.equal(workspace.cohorts[0].projects[0].evidence.find((item) => item.class === 'delivery').state, 'stale');
  } finally {
    rmSync(stale.root, { recursive: true, force: true });
  }
});

test('localises an unavailable child but fails the whole aggregate for invalid central policy', () => {
  const { root } = createWorkspace();
  try {
    rmSync(resolve(root, 'clients/billing'), { recursive: true, force: true });
    const unavailable = readRolloutWorkspace(root);
    assert.equal(unavailable.status, 'attention');
    assert.equal(unavailable.cohorts[0].projects[0].adoption.state, 'unavailable');
    assert.equal(unavailable.cohorts[0].projects[0].nextRoute.owner, 'Billing Owner');

    write(resolve(root, 'SPECS/1.Scope/rollout.yaml'), YAML.stringify(policy({
      cohorts: [{ ...policy().cohorts[0], baseline: 'unknown' }],
    }), { lineWidth: 0 }));
    const invalid = readRolloutWorkspace(root);
    assert.equal(invalid.status, 'invalid');
    assert.deepEqual(invalid.cohorts, []);
    assert.equal(invalid.diagnostics.some((item) => item.code === 'rollout.unknown-baseline'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('swaps contextual personas and keeps the standard baseline complete without premium', () => {
  const { root } = createWorkspace();
  try {
    const assurance = readRolloutWorkspace(root, { personas, focus: 'security assurance cohort' });
    const delivery = readRolloutWorkspace(root, { personas, focus: 'delivery recovery' });
    assert.notDeepEqual(assurance.activePersonas.map((persona) => persona.id), delivery.activePersonas.map((persona) => persona.id));
    assert.equal(assurance.activePersonas.every((persona) => persona.name && persona.tier && persona.matchedSignals && persona.engagementReason), true);

    const baseline = readRolloutWorkspace(root, { personas: personas.filter((persona) => !['premium', 'personal'].includes(persona.tier)) });
    assert.equal(baseline.personaAvailability.premium.installed, false);
    assert.equal(baseline.personaAvailability.premium.required, false);
    assert.equal(baseline.personaAvailability.premium.syncAttempted, false);
    assert.equal(baseline.review.standardLlmAvailable, true);
    assert.equal(baseline.review.questions.length >= 4, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
