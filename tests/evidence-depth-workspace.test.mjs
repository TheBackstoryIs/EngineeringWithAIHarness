import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { initProject } from '../src/project.mjs';
import { EVIDENCE_DEPTH_DIMENSIONS } from '../src/evidence-depth.mjs';
import {
  compareEvidenceDepthWorkspaceRuns,
  prepareEvidenceDepthWorkspace,
  readEvidenceDepthWorkspace,
  recordEvidenceDepthWorkspaceRun,
} from '../src/runtime/evidence-depth-workspace.mjs';
import { selectEvidenceDepthPersonas } from '../src/runtime/persona-engagement.mjs';
import { runtimePaths } from '../src/runtime/paths.mjs';

function project() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-depth-workspace-'));
  initProject(root, { name: 'Depth Workspace' });
  return root;
}

function sourceMap(stale = false) {
  return {
    freshness: {
      schema: 'ewai.repository-freshness/v1', status: stale ? 'stale' : 'fresh', stale,
      runId: 78, reason: stale ? 'working-tree-changed' : '',
      summary: { tracked: 511, current: 511, missing: 0, changed: stale ? 1 : 0, deleted: 0 },
    },
    status: {
      schema: 'ewai.repository-index-status/v1', runId: 78, status: 'completed',
      repositories: 3, files: 511, symbols: 1621, profileDigest: 'sha256:profiles78',
    },
    coverage: {
      schema: 'ewai.repository-source-map-coverage/v1', runId: 78,
      outcomes: { analysed: 474, inventory_only: 15, skipped_sensitive: 2, skipped_oversized: 1, analysis_failed: 19 },
      warnings: ['Nineteen files retained analysis failures.'],
    },
  };
}

function personas() {
  return [
    { id: 'project.product-owner', name: 'Product Owner', tier: 'project', category: 'product', description: 'Protects outcomes and owner decisions.', tags: ['product', 'outcomes', 'governance'], capabilities: ['product review'] },
    { id: 'ewai.core.archaeologist', name: 'EWAI Archaeologist', tier: 'core', category: 'engineering', description: 'Separates repository evidence from inferred claims.', tags: ['evidence', 'architecture', 'archaeology'], capabilities: ['project archaeology'] },
    { id: 'ewai.core.operator', name: 'Service Operator', tier: 'core', category: 'operations', description: 'Challenges hosting recovery and observability.', tags: ['operations', 'hosting', 'recovery'], capabilities: ['operational review'] },
    { id: 'premium.security-architect', name: 'Application Security Architect', tier: 'premium', category: 'security', description: 'Challenges trust boundaries and sensitive data handling.', tags: ['security', 'trust boundary', 'data'], capabilities: ['security review'], path: '/private/premium.md', body: 'managed secret body' },
  ];
}

function ownerEvidence(overrides = []) {
  const entries = [
    { id: 'owner:product-purpose', dimension: 'product', authority: 'confirmed', evidenceDigest: 'sha256:product-owner-evidence', answerCode: 'purpose-confirmed', reasonCode: 'named-owner-review' },
    { id: 'owner:delivery-method', dimension: 'delivery', authority: 'declared', evidenceDigest: 'sha256:delivery-owner-evidence', answerCode: 'governed-pipeline', reasonCode: 'owner-declaration' },
    ...overrides,
  ];
  return entries;
}

function review(workspace, changes = {}) {
  return {
    schema: 'ewai.evidence-depth-review/v1',
    expectedPreparationDigest: workspace.preparation.preparationDigest,
    reviewedBy: 'Andre',
    dimensions: workspace.preparation.dimensions.map(({ id, recommendedDepth }) => ({ id, selectedDepth: recommendedDepth, rationale: '' })),
    grouping: {
      strategy: 'user-outcome',
      assignments: workspace.preparation.gaps.map((gap, index) => ({ gapId: gap.id, groupId: `group-${index + 1}`, disposition: 'owned' })),
    },
    ...changes,
  };
}

test('prepares seven independent evidence-backed recommendations and adaptive questions', () => {
  const root = project();
  try {
    const workspace = prepareEvidenceDepthWorkspace(root, { focus: 'security recovery product' }, {
      sourceMap: sourceMap(), personas: personas(), ownerEvidence: ownerEvidence(), now: '2026-08-28T12:00:00.000Z',
    });
    assert.equal(workspace.schema, 'ewai.evidence-depth-workspace/v1');
    assert.equal(workspace.status, 'ready-to-investigate');
    assert.equal(workspace.preparation.dimensions.length, 7);
    assert.equal(workspace.preparation.dimensions.find(({ id }) => id === 'architecture').recommendedDepth, 'deep');
    assert.equal(workspace.questions.length > 0, true);
    assert.equal(workspace.questions.every((question) => question.gapId && question.reasonCode && question.evidenceRefs.length), true);
    assert.equal(workspace.questions.some(({ dimension }) => dimension === 'security'), true);
    assert.equal(workspace.coverage.outcomes.analysis_failed, 19);
    assert.equal(existsSync(resolve(root, '.ewai-pipeline/runtime/evidence-depth/preparation.json')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('blocks preparation on stale Source Map evidence with an exact recovery', () => {
  const root = project();
  try {
    assert.throws(() => prepareEvidenceDepthWorkspace(root, {}, { sourceMap: sourceMap(true), personas: personas() }), /refresh.*Source Map|Source Map.*fresh/i);
    const workspace = readEvidenceDepthWorkspace(root, { sourceMap: sourceMap(true), personas: personas() });
    assert.equal(workspace.status, 'source-map-stale');
    assert.match(workspace.recovery.command, /index refresh/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('uses core and project personas without premium and swaps an installed specialist for a relevant gap', () => {
  const baseline = selectEvidenceDepthPersonas({ dimension: 'product', gapConditions: ['missing-owner-purpose'] }, personas().filter(({ tier }) => tier !== 'premium'));
  const security = selectEvidenceDepthPersonas({ dimension: 'security', gapConditions: ['missing-owner-boundary'] }, personas());
  assert.equal(baseline.activePersonas.some(({ tier }) => tier === 'project'), true);
  assert.equal(baseline.premium.installed, false);
  assert.equal(baseline.baseline.completeWithoutPremium, true);
  assert.equal(security.activePersonas.some(({ id }) => id === 'premium.security-architect'), true);
  assert.equal(JSON.stringify(security).includes('/private/'), false);
  assert.equal(JSON.stringify(security).includes('managed secret body'), false);
});

test('bounds a large premium catalogue without losing evidence-dimension coverage', () => {
  const root = project();
  const largeCatalogue = [
    ...personas(),
    ...Array.from({ length: 40 }, (_, index) => ({
      id: `premium.specialist-${index + 1}`,
      name: `Specialist ${index + 1}`,
      tier: 'premium',
      category: EVIDENCE_DEPTH_DIMENSIONS[index % EVIDENCE_DEPTH_DIMENSIONS.length],
      description: 'Challenges architecture data security product delivery governance operations evidence and recovery.',
      tags: ['architecture', 'data', 'security', 'product', 'delivery', 'governance', 'operations', 'evidence', 'recovery'],
      capabilities: ['evidence review'],
    })),
  ];
  try {
    const workspace = prepareEvidenceDepthWorkspace(root, { focus: 'security recovery product' }, {
      sourceMap: sourceMap(), personas: largeCatalogue, ownerEvidence: ownerEvidence(),
    });
    const selectedIds = new Set(workspace.preparation.activePersonas.map(({ id }) => id));
    assert.equal(workspace.preparation.activePersonas.length <= 8, true);
    assert.equal(workspace.questions.every((question) => question.activePersonas.every(({ id }) => selectedIds.has(id))), true);
    assert.equal(Object.values(workspace.personasByDimension).every((engagement) => engagement.activePersonas.every(({ id }) => selectedIds.has(id))), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retains owner evidence as a separate authority and exposes contradictions', () => {
  const root = project();
  try {
    const workspace = prepareEvidenceDepthWorkspace(root, {}, {
      sourceMap: sourceMap(), personas: personas(),
      ownerEvidence: ownerEvidence([{ id: 'owner:security-boundary', dimension: 'security', authority: 'declared', evidenceDigest: 'sha256:security-owner-evidence', answerCode: 'localhost-only', reasonCode: 'owner-declaration', contradiction: 'declared-versus-observed' }]),
    });
    const owner = workspace.preparation.evidence.find(({ id }) => id === 'owner:security-boundary');
    assert.equal(owner.authority, 'declared');
    assert.equal(workspace.preparation.gaps.some(({ contradiction }) => contradiction === 'declared-versus-observed'), true);
    assert.equal(JSON.stringify(workspace).includes('free text'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('records a named owner review against the exact preparation and compares stored runs', () => {
  const root = project();
  try {
    const firstWorkspace = prepareEvidenceDepthWorkspace(root, {}, { sourceMap: sourceMap(), personas: personas(), ownerEvidence: ownerEvidence(), now: '2026-08-28T12:00:00.000Z' });
    const first = recordEvidenceDepthWorkspaceRun(root, review(firstWorkspace), { now: '2026-08-28T12:05:00.000Z' });
    const secondWorkspace = prepareEvidenceDepthWorkspace(root, {}, { sourceMap: sourceMap(), personas: personas(), ownerEvidence: ownerEvidence(), now: '2026-08-28T13:00:00.000Z' });
    const secondReview = review(secondWorkspace);
    secondReview.grouping.strategy = 'assurance-boundary';
    secondReview.grouping.assignments = secondReview.grouping.assignments.map((item) => ({ ...item, groupId: 'one-assurance-group' }));
    const second = recordEvidenceDepthWorkspaceRun(root, secondReview, { now: '2026-08-28T13:05:00.000Z' });
    const comparison = compareEvidenceDepthWorkspaceRuns(root, { leftRunId: first.runId, rightRunId: second.runId });
    assert.equal(comparison.changes.gaps.status, 'same');
    assert.equal(comparison.changes.grouping.status, 'changed');
    assert.equal(comparison.reproducible, true);
    assert.equal(readEvidenceDepthWorkspace(root, { sourceMap: sourceMap(), personas: personas() }).runs.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects unknown owner evidence fields and never persists answer or persona bodies', () => {
  const root = project();
  try {
    assert.throws(() => prepareEvidenceDepthWorkspace(root, {}, {
      sourceMap: sourceMap(), personas: personas(),
      ownerEvidence: [{ id: 'owner:bad', dimension: 'security', authority: 'declared', evidenceDigest: 'sha256:bad-owner-evidence', answerCode: 'known', reasonCode: 'known', answerBody: 'secret' }],
    }), /unknown field|answerBody/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('revalidates disposable preparation state before returning or recording it', () => {
  const root = project();
  try {
    prepareEvidenceDepthWorkspace(root, {}, { sourceMap: sourceMap(), personas: personas(), ownerEvidence: ownerEvidence() });
    const path = runtimePaths(root).evidenceDepthPreparationPath;
    const tampered = JSON.parse(readFileSync(path, 'utf8'));
    tampered.answerBody = 'locally injected private text';
    writeFileSync(path, `${JSON.stringify(tampered, null, 2)}\n`);
    assert.throws(() => readEvidenceDepthWorkspace(root, { sourceMap: sourceMap(), personas: personas() }), /unknown field|answerBody/i);
    assert.throws(() => recordEvidenceDepthWorkspaceRun(root, review({ preparation: tampered })), /unknown field|answerBody/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
