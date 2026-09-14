import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { initProject } from '../src/project.mjs';
import { createIntent } from '../src/intents.mjs';
import { refreshRepositoryIndex } from '../src/runtime/repository-index.mjs';
import {
  confirmImpactAssessment,
  previewImpactAssessment,
  readImpactWorkspace
} from '../src/runtime/impact-analysis.mjs';

function personas() {
  return [
    { id: 'project.product-owner', name: 'EWAI Product Owner', tier: 'project', category: 'product', description: 'Protects user outcomes and acceptance evidence.', tags: ['user workflow', 'acceptance', 'outcomes'], capabilities: ['product review'], path: '/private/project.md', rawDefinition: 'hidden' },
    { id: 'premium.identity-reviewer', name: 'Identity and Access Reviewer', tier: 'premium', category: 'security', description: 'Reviews identity, permission, privacy, and access boundaries.', tags: ['security', 'identity', 'permission', 'privacy'], capabilities: ['security review'], path: '/private/premium.md' },
    { id: 'personal.documentation-lead', name: 'Documentation Lead', tier: 'personal', category: 'communication', description: 'Reviews documentation and training impact.', tags: ['documentation', 'training'], capabilities: ['content review'] },
    { id: 'ewai.core.operator', name: 'Service Operator', tier: 'core', category: 'operations', description: 'Reviews operations, recovery, and observable service behaviour.', tags: ['operations', 'recovery'], capabilities: ['operational review'] },
    { id: 'ewai.core.maintainer', name: 'Software Maintainer', tier: 'core', category: 'engineering', description: 'Reviews architecture, testing, and maintainability.', tags: ['maintainability', 'testing'], capabilities: ['code review'] }
  ];
}

function project() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-impact-'));
  initProject(root, { name: 'Impact Test' });
  createIntent(root, { slug: 'customer-access', domain: 'experience', title: 'Customer access' });
  mkdirSync(resolve(root, 'src'), { recursive: true });
  mkdirSync(resolve(root, 'tests'), { recursive: true });
  writeFileSync(resolve(root, 'src/access-form.mjs'), `
    import { canRequestAccess } from './permissions.mjs';
    import { recordAudit } from './audit.mjs';
    export function submitAccessForm(user) {
      if (!canRequestAccess(user)) return false;
      recordAudit(user.id);
      return true;
    }
  `);
  writeFileSync(resolve(root, 'src/permissions.mjs'), `
    export function canRequestAccess(user) { return user.role === 'delegate'; }
  `);
  writeFileSync(resolve(root, 'src/audit.mjs'), `
    export function recordAudit(userId) { return { userId }; }
  `);
  writeFileSync(resolve(root, 'src/dashboard.mjs'), `
    import { submitAccessForm } from './access-form.mjs';
    export function dashboardAction(user) { return submitAccessForm(user); }
  `);
  writeFileSync(resolve(root, 'src/internal-helper.mjs'), `
    export function stableSort(values) { return [...values].sort(); }
  `);
  writeFileSync(resolve(root, 'tests/access-form.test.mjs'), `
    import { submitAccessForm } from '../src/access-form.mjs';
    export const result = submitAccessForm({ id: 1, role: 'delegate' });
  `);
  refreshRepositoryIndex(root);
  return root;
}

test('previews bounded observed reach, inferred consequences, active personas, and human routes', () => {
  const root = project();
  try {
    const preview = previewImpactAssessment(root, 'customer-access', {
      summary: 'Change the delegated customer access form and permission check, including user guidance and recovery.',
      targets: ['src/access-form.mjs', 'canRequestAccess']
    }, { personas: personas() });

    assert.equal(preview.index.fresh, true);
    assert.deepEqual(preview.resolvedTargets.map((target) => target.input), ['src/access-form.mjs', 'canRequestAccess']);
    assert.equal(preview.observed.nodes.some((node) => node.path.endsWith('src/audit.mjs') && node.direction === 'downstream-dependency'), true);
    assert.equal(preview.observed.nodes.some((node) => node.path.endsWith('src/dashboard.mjs') && node.direction === 'upstream-consumer'), true);
    assert.equal(preview.observed.maxDepth, 2);
    assert.equal(preview.impactAreas.some((area) => area.id === 'user-workflow' && area.authority === 'inferred'), true);
    assert.equal(preview.impactAreas.some((area) => area.id === 'security-privacy'), true);
    assert.equal(preview.activePersonas.some((persona) => persona.tier === 'project'), true);
    assert.equal(preview.activePersonas.some((persona) => persona.tier === 'premium'), true);
    assert.equal(JSON.stringify(preview.activePersonas).includes('/private/'), false);
    assert.equal(preview.reviewRoutes.find((route) => route.id === 'product-owner').recommendation, 'required');
    assert.equal(preview.reviewRoutes.find((route) => route.id === 'security-identity').recommendation, 'required');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does not route Product Owner review for a bounded internal refactor without user consequences', () => {
  const root = project();
  try {
    const preview = previewImpactAssessment(root, 'customer-access', {
      summary: 'Refactor the internal helper implementation without changing behaviour or public interfaces.',
      targets: ['src/internal-helper.mjs']
    }, { personas: personas() });
    assert.equal(preview.reviewRoutes.find((route) => route.id === 'product-owner').recommendation, 'not-indicated');
    assert.equal(preview.impactAreas.some((area) => area.id === 'maintainability'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects unsafe input and discloses unresolved and ambiguous targets', () => {
  const root = project();
  try {
    assert.throws(() => previewImpactAssessment(root, 'customer-access', {
      summary: 'Inspect unsafe input.', targets: ['../outside.mjs']
    }, { personas: personas() }), /repository-relative/);

    const preview = previewImpactAssessment(root, 'customer-access', {
      summary: 'Review an unresolved reference.', targets: ['missingSymbol']
    }, { personas: personas() });
    assert.deepEqual(preview.unresolvedTargets, ['missingSymbol']);
    assert.equal(preview.coverage.complete, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rechecks freshness and records idempotent immutable assessment evidence', () => {
  const root = project();
  try {
    const input = {
      summary: 'Change the delegated customer access workflow and permission check.',
      targets: ['src/access-form.mjs']
    };
    const preview = previewImpactAssessment(root, 'customer-access', input, { personas: personas() });
    const decisions = Object.fromEntries(preview.reviewRoutes.map((route) => [route.id, route.recommendation]));
    const confirmed = confirmImpactAssessment(root, 'customer-access', {
      ...input,
      indexRunId: preview.index.runId,
      decisions,
      rationales: {},
      assessor: 'Product Owner',
      acknowledged: true
    }, { personas: personas(), now: '2026-08-16T12:00:00.000Z' });

    assert.equal(confirmed.status, 'recorded');
    assert.equal(existsSync(resolve(root, confirmed.evidence.jsonPath)), true);
    assert.equal(existsSync(resolve(root, confirmed.evidence.markdownPath)), true);
    assert.match(readFileSync(resolve(root, confirmed.evidence.markdownPath), 'utf8'), /does not approve Build, security, compliance, release, or Manual QA/i);

    const repeated = confirmImpactAssessment(root, 'customer-access', {
      ...input,
      indexRunId: preview.index.runId,
      decisions,
      rationales: {},
      assessor: 'Product Owner',
      acknowledged: true
    }, { personas: personas(), now: '2026-08-16T12:00:00.000Z' });
    assert.equal(repeated.assessmentId, confirmed.assessmentId);

    const jsonPath = resolve(root, confirmed.evidence.jsonPath);
    const tampered = JSON.parse(readFileSync(jsonPath, 'utf8'));
    writeFileSync(jsonPath, `${JSON.stringify({ ...tampered, summary: 'Tampered summary' }, null, 2)}\n`);
    assert.throws(() => confirmImpactAssessment(root, 'customer-access', {
      ...input,
      indexRunId: preview.index.runId,
      decisions,
      rationales: {},
      assessor: 'Product Owner',
      acknowledged: true
    }, { personas: personas(), now: '2026-08-16T12:00:00.000Z' }), /already exists and will not be overwritten/i);

    const workspace = readImpactWorkspace(root, 'customer-access');
    assert.equal(workspace.assessments.some((assessment) => assessment.assessmentId === confirmed.assessmentId), true);

    writeFileSync(resolve(root, 'src/access-form.mjs'), 'export function submitAccessForm() { return false; }\n');
    assert.throws(() => confirmImpactAssessment(root, 'customer-access', {
      ...input,
      indexRunId: preview.index.runId,
      decisions,
      rationales: {},
      assessor: 'Product Owner',
      acknowledged: true
    }, { personas: personas() }), /repository map changed|stale/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('requires rationale whenever a human changes a recommended route', () => {
  const root = project();
  try {
    const input = { summary: 'Change the customer access workflow.', targets: ['src/access-form.mjs'] };
    const preview = previewImpactAssessment(root, 'customer-access', input, { personas: personas() });
    const decisions = Object.fromEntries(preview.reviewRoutes.map((route) => [route.id, route.recommendation]));
    decisions.maintainer = decisions.maintainer === 'required' ? 'recommended' : 'required';
    assert.throws(() => confirmImpactAssessment(root, 'customer-access', {
      ...input, indexRunId: preview.index.runId, decisions, rationales: {}, assessor: 'Reviewer', acknowledged: true
    }, { personas: personas() }), /rationale/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('tracks explicit policy-material impact without treating unrelated source churn as policy drift', () => {
  const root = project();
  try {
    const material = { data: ['customer-record'], destinations: ['external-ai'] };
    const first = previewImpactAssessment(root, 'customer-access', {
      summary: 'Change the customer access data route.', targets: ['src/access-form.mjs'], policyDimensions: material,
    }, { personas: personas() });
    const unrelated = previewImpactAssessment(root, 'customer-access', {
      summary: 'Refactor an internal helper without changing policy assumptions.', targets: ['src/internal-helper.mjs'], policyDimensions: material,
    }, { personas: personas() });
    const changed = previewImpactAssessment(root, 'customer-access', {
      summary: 'Move customer access data to an approved internal destination.', targets: ['src/access-form.mjs'],
      policyDimensions: { data: ['customer-record'], destinations: ['approved-internal'] },
    }, { personas: personas() });
    assert.match(first.policyRelevantDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(unrelated.policyRelevantDigest, first.policyRelevantDigest);
    assert.notEqual(changed.policyRelevantDigest, first.policyRelevantDigest);

    const decisions = Object.fromEntries(first.reviewRoutes.map((route) => [route.id, route.recommendation]));
    const confirmed = confirmImpactAssessment(root, 'customer-access', {
      summary: first.summary, targets: first.targets, policyDimensions: material,
      indexRunId: first.index.runId, decisions, rationales: {}, assessor: 'Product Owner', acknowledged: true,
    }, { personas: personas(), now: '2026-08-28T19:00:00.000Z' });
    assert.equal(confirmed.assessment.policyRelevantDigest, first.policyRelevantDigest);
    assert.equal(readImpactWorkspace(root, 'customer-access').assessments[0].policyRelevantDigest, first.policyRelevantDigest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
