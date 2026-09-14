import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import { initProject } from '../src/project.mjs';
import {
  PORTFOLIO_ASSURANCE_NOTICE,
  readPortfolioWorkspace,
  resolvePortfolioMembers,
  validatePortfolioManifest,
} from '../src/portfolio.mjs';

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

function portfolio(overrides = {}) {
  return {
    schema: 'ewai.portfolio/v1',
    id: 'northstar-change',
    name: 'Northstar change portfolio',
    owner: 'Transformation Director',
    members: [
      { id: 'northstar', kind: 'portfolio', name: 'Northstar', owner: 'Transformation Director' },
      { id: 'customer', kind: 'programme', name: 'Customer programme', owner: 'Programme Lead', parent: 'northstar' },
      {
        id: 'billing', kind: 'project', name: 'Billing platform', owner: 'Billing Owner',
        parent: 'customer', repository: 'application', project_path: 'services/billing',
      },
    ],
    dependencies: [],
    ...overrides,
  };
}

function writeChild(root, relative = 'services/billing', options = {}) {
  const child = resolve(root, relative);
  mkdirSync(child, { recursive: true });
  initProject(child, { name: options.name ?? 'Billing platform' });
  write(resolve(child, 'SPECS/2.Purpose/intents/platform/billing.md'), `---
schema: ewai.intent/v1
slug: billing
domain: platform
title: Billing
status: ${options.markdownStatus ?? 'in-progress'}
delivery_status: ${options.markdownStatus ?? 'in-progress'}
current_phase: ${options.markdownPhase ?? 'build'}
---

# Billing
`);
  write(resolve(child, 'SPECS/2.Purpose/intents/platform/billing.json'), `${JSON.stringify({
    schema: 'ewai.intent/v1', slug: 'billing', status: options.jsonStatus ?? options.markdownStatus ?? 'in-progress',
  }, null, 2)}\n`);
  write(resolve(child, 'SPECS/6.Build/billing/delivery-state.json'), `${JSON.stringify({
    schema: 'ewai.delivery-state/v1', slug: 'billing', status: options.deliveryStatus ?? 'in-progress',
    currentPhase: options.deliveryPhase ?? 'build', updatedAt: options.updatedAt ?? '2026-08-22T12:00:00.000Z',
    blockedReason: options.blockedReason ?? '', approvals: { build: options.buildApproval ?? null },
    humanGates: [{ id: 'manual-qa', status: options.manualQa ?? 'pending' }],
  }, null, 2)}\n`);
  return child;
}

const personas = [
  {
    id: 'project.product-owner', name: 'Product Owner', tier: 'project', category: 'product',
    description: 'Protects portfolio project outcomes and accountable ownership.', tags: ['portfolio', 'project', 'outcome'],
    body: 'must never appear', path: '/private/project-persona.md',
  },
  {
    id: 'ewai.premium.finance-transformation', name: 'Finance Transformation Lead', tier: 'premium', category: 'finance',
    description: 'Examines programme dependencies, financial controls and transformation risk.',
    tags: ['programme', 'dependency', 'portfolio'], body: 'licensed premium definition', path: '/private/premium.md',
  },
  {
    id: 'ewai.core.operator', name: 'Service Operator', tier: 'core', category: 'operations',
    description: 'Examines delivery operation and recovery.', tags: ['delivery', 'recovery'],
  },
];

test('validates strict bounded hierarchy and dependency topology', () => {
  const valid = validatePortfolioManifest(portfolio({
    dependencies: [{ id: 'billing-needs-identity', from: 'billing', to: 'identity', rationale: 'Shared sign-in', owner: 'Architecture Lead' }],
    members: [
      ...portfolio().members,
      { id: 'identity', kind: 'project', name: 'Identity', owner: 'Identity Owner', parent: 'customer', repository: 'application', project_path: 'services/identity' },
    ],
  }));
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.diagnostics, []);

  const cycle = validatePortfolioManifest(portfolio({
    dependencies: [
      { id: 'one', from: 'billing', to: 'identity', rationale: 'One', owner: 'Owner' },
      { id: 'two', from: 'identity', to: 'billing', rationale: 'Two', owner: 'Owner' },
    ],
    members: [
      ...portfolio().members,
      { id: 'identity', kind: 'project', name: 'Identity', owner: 'Identity Owner', parent: 'customer', repository: 'application', project_path: 'services/identity' },
    ],
  }));
  assert.equal(cycle.valid, false);
  assert.equal(cycle.diagnostics.some((item) => item.code === 'portfolio.dependency-cycle'), true);

  const oversized = portfolio({ members: Array.from({ length: 101 }, (_, index) => ({
    id: `project-${index}`, kind: 'project', name: `Project ${index}`, owner: 'Owner',
    parent: index ? 'project-0' : undefined, repository: 'application', project_path: `projects/${index}`,
  })) });
  const limited = validatePortfolioManifest(oversized);
  assert.equal(limited.valid, false);
  assert.equal(limited.diagnostics.some((item) => item.code === 'portfolio.schema'), true);
});

test('resolves configured repository subprojects and returns honest child evidence', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-portfolio-domain-'));
  try {
    initProject(root, { name: 'Portfolio host' });
    writeChild(root);
    const manifest = portfolio({
      dependencies: [],
    });
    write(resolve(root, 'SPECS/1.Scope/portfolio.yaml'), YAML.stringify(manifest, { lineWidth: 0 }));

    const resolved = resolvePortfolioMembers(root, manifest);
    assert.equal(resolved.valid, true);
    assert.equal(resolved.members.find((member) => member.id === 'billing').projectPath, 'services/billing');

    const workspace = readPortfolioWorkspace(root, {
      personas,
      now: '2026-08-23T12:00:00.000Z',
    });
    assert.equal(workspace.schema, 'ewai.portfolio-workspace/v1');
    assert.equal(workspace.status, 'ready');
    const billing = workspace.members.find((member) => member.id === 'billing');
    assert.equal(billing.evidence.status, 'ready');
    assert.equal(billing.evidence.delivery.currentPhase, 'build');
    assert.equal(billing.evidence.delivery.manualQa, 'pending');
    assert.equal(workspace.activePersonas.some((persona) => persona.tier === 'project'), true);
    assert.equal(workspace.activePersonas.some((persona) => persona.tier === 'premium'), true);
    assert.equal(workspace.activePersonas.every((persona) => persona.engagementReason), true);
    assert.equal(workspace.personaAvailability.baseline.available, true);
    assert.equal(workspace.personaAvailability.premium.installed, true);
    assert.equal(workspace.notices.security, PORTFOLIO_ASSURANCE_NOTICE);

    const encoded = JSON.stringify(workspace);
    assert.equal(encoded.includes(root), false);
    assert.equal(encoded.includes('licensed premium definition'), false);
    assert.equal(encoded.includes('/private/'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('works without premium personas and exposes the standard LLM baseline', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-portfolio-baseline-'));
  try {
    initProject(root, { name: 'Portfolio host' });
    writeChild(root);
    write(resolve(root, 'SPECS/1.Scope/portfolio.yaml'), YAML.stringify(portfolio(), { lineWidth: 0 }));
    const workspace = readPortfolioWorkspace(root, { personas: personas.filter((persona) => persona.tier !== 'premium') });

    assert.equal(workspace.status, 'ready');
    assert.equal(workspace.personaAvailability.premium.installed, false);
    assert.equal(workspace.personaAvailability.premium.required, false);
    assert.equal(workspace.review.standardLlmAvailable, true);
    assert.equal(workspace.review.questions.length >= 4, true);
    assert.equal(workspace.activePersonas.some((persona) => persona.tier === 'project'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed on traversal, symbolic traversal and duplicate resolved roots', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-portfolio-paths-'));
  const outside = mkdtempSync(resolve(tmpdir(), 'ewai-portfolio-outside-'));
  try {
    initProject(root, { name: 'Portfolio host' });
    writeChild(outside, '.');
    symlinkSync(outside, resolve(root, 'linked-project'));

    let result = resolvePortfolioMembers(root, portfolio({ members: [
      { id: 'northstar', kind: 'portfolio', name: 'Northstar', owner: 'Owner' },
      { id: 'linked', kind: 'project', name: 'Linked', owner: 'Owner', parent: 'northstar', repository: 'application', project_path: 'linked-project' },
    ] }));
    assert.equal(result.valid, false);
    assert.equal(result.diagnostics.some((item) => item.code === 'portfolio.symbolic-path'), true);

    result = resolvePortfolioMembers(root, portfolio({ members: [
      { id: 'northstar', kind: 'portfolio', name: 'Northstar', owner: 'Owner' },
      { id: 'escape', kind: 'project', name: 'Escape', owner: 'Owner', parent: 'northstar', repository: 'application', project_path: '../outside' },
    ] }));
    assert.equal(result.valid, false);
    assert.equal(result.diagnostics.some((item) => item.code === 'portfolio.unsafe-path'), true);

    writeChild(root);
    result = resolvePortfolioMembers(root, portfolio({ members: [
      ...portfolio().members,
      { id: 'billing-copy', kind: 'project', name: 'Billing copy', owner: 'Owner', parent: 'customer', repository: 'application', project_path: 'services/billing/.' },
    ] }));
    assert.equal(result.valid, false);
    assert.equal(result.diagnostics.some((item) => item.code === 'portfolio.duplicate-root'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('keeps stale and disagreeing child evidence visible and never rewrites it', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-portfolio-evidence-'));
  try {
    initProject(root, { name: 'Portfolio host' });
    const child = writeChild(root, 'services/billing', {
      markdownStatus: 'in-progress', jsonStatus: 'completed', updatedAt: '2020-01-01T00:00:00.000Z',
    });
    write(resolve(root, 'SPECS/1.Scope/portfolio.yaml'), YAML.stringify(portfolio(), { lineWidth: 0 }));
    const before = readFileSync(resolve(child, 'SPECS/6.Build/billing/delivery-state.json'), 'utf8');

    const workspace = readPortfolioWorkspace(root, { now: '2026-08-23T12:00:00.000Z', personas });
    const billing = workspace.members.find((member) => member.id === 'billing');
    assert.equal(workspace.status, 'attention');
    assert.equal(billing.evidence.status, 'disagreement');
    assert.equal(billing.evidence.freshness.status, 'stale');
    assert.equal(workspace.attention.some((item) => item.code === 'portfolio.intent-disagreement'), true);
    assert.equal(workspace.attention.some((item) => item.code === 'portfolio.stale-member'), true);
    assert.equal(readFileSync(resolve(child, 'SPECS/6.Build/billing/delivery-state.json'), 'utf8'), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns a safe non-configured workspace without requiring premium access', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-portfolio-empty-'));
  try {
    initProject(root, { name: 'Portfolio host' });
    const workspace = readPortfolioWorkspace(root, { personas: [] });
    assert.equal(workspace.status, 'not-configured');
    assert.equal(workspace.guide, 'Docs/project-portfolio-orchestration-guide.md');
    assert.equal(workspace.personaAvailability.baseline.available, true);
    assert.equal(workspace.personaAvailability.premium.installed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
