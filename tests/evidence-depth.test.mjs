import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { initProject } from '../src/project.mjs';
import {
  EVIDENCE_DEPTH_DIMENSIONS,
  compareEvidenceDepthRuns,
  prepareEvidenceDepth,
  readEvidenceDepthStatus,
  recordEvidenceDepthRun,
} from '../src/evidence-depth.mjs';

function evidence(id, authority = 'observed') {
  return { id, authority, kind: 'repository-fact', digest: `sha256:${Buffer.from(id).toString('hex').padEnd(64, '0').slice(0, 64)}` };
}

function input(overrides = {}) {
  const dimensions = EVIDENCE_DEPTH_DIMENSIONS.map((id, index) => ({
    id,
    recommendedDepth: ['deep', 'standard', 'bounded'][index % 3],
    drivers: [`${id}-complexity`, `${id}-risk`],
    evidenceRefs: [`${id}:primary`],
    coverage: {
      status: index === 2 ? 'owner-evidence-required' : 'supported',
      required: 4,
      supported: index === 2 ? 2 : 4,
      excluded: 0,
      failed: index === 2 ? 1 : 0,
    },
  }));
  return {
    schema: 'ewai.evidence-depth-input/v1',
    projectFingerprint: 'sha256:project000000000000000000000000000000000000000000000000000000000',
    sourceMap: {
      runId: 78,
      digest: 'sha256:map000000000000000000000000000000000000000000000000000000000000',
      profileDigest: 'sha256:profiles00000000000000000000000000000000000000000000000000000000',
      freshness: 'fresh',
    },
    contractVersions: ['ewai.archaeology/v1', 'ewai.discovery/v1'],
    packVersions: ['core@1.0.0'],
    provider: { id: 'codex', modelFamily: 'gpt-5', capabilityRevision: '2026-08' },
    exclusions: ['generated-vendor-files'],
    predecessorId: '',
    personas: [
      { id: 'project.product-owner', tier: 'project', reasonCode: 'product-risk' },
      { id: 'ewai.core.archaeologist', tier: 'core', reasonCode: 'evidence-authority' },
    ],
    evidence: EVIDENCE_DEPTH_DIMENSIONS.map((id) => evidence(`${id}:primary`)),
    dimensions,
    gaps: [
      {
        dimension: 'security',
        condition: 'missing-owner-boundary',
        currentStateCode: 'configurable-exposure-observed',
        intendedStateCode: 'owner-boundary-required',
        evidenceRefs: ['security:primary'],
        contradiction: 'none',
        owner: 'product-owner',
        disposition: 'open',
      },
      {
        dimension: 'operations',
        condition: 'missing-recovery-owner',
        currentStateCode: 'backup-behaviour-observed',
        intendedStateCode: 'named-recovery-owner-required',
        evidenceRefs: ['operations:primary'],
        contradiction: 'declared-versus-observed',
        owner: 'service-owner',
        disposition: 'open',
      },
    ],
    grouping: {
      strategy: 'user-outcome',
      assignments: [],
    },
    ...overrides,
  };
}

function review(preparation, overrides = {}) {
  return {
    schema: 'ewai.evidence-depth-review/v1',
    expectedPreparationDigest: preparation.preparationDigest,
    reviewedBy: 'Andre',
    dimensions: preparation.dimensions.map((dimension) => ({
      id: dimension.id,
      selectedDepth: dimension.recommendedDepth,
      rationale: '',
    })),
    grouping: {
      strategy: 'user-outcome',
      assignments: preparation.gaps.map((gap, index) => ({
        gapId: gap.id,
        groupId: index === 0 ? 'boundary-assurance' : 'operational-ownership',
        disposition: 'owned',
      })),
    },
    ...overrides,
  };
}

function project() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-evidence-depth-'));
  initProject(root, { name: 'Evidence Depth' });
  return root;
}

test('prepares the complete seven-dimensional provider-neutral contract', () => {
  const prepared = prepareEvidenceDepth(input(), { now: '2026-08-28T12:00:00.000Z' });
  assert.equal(prepared.schema, 'ewai.evidence-depth-preparation/v1');
  assert.deepEqual(prepared.dimensions.map(({ id }) => id), EVIDENCE_DEPTH_DIMENSIONS);
  assert.equal(prepared.gaps.length, 2);
  assert.match(prepared.gaps.find(({ dimension }) => dimension === 'security').id, /^GAP-SEC-[a-f0-9]{12}$/);
  assert.equal(prepared.guidance.advisory, true);
  assert.equal(prepared.guidance.intentCountIsDepth, false);
  assert.equal(JSON.stringify(prepared).includes(process.cwd()), false);
});

test('keeps preparation and gap identity stable across ordering path time and provider wording', () => {
  const firstInput = input();
  const secondInput = input({
    evidence: [...firstInput.evidence].reverse(),
    personas: [...firstInput.personas].reverse(),
    contractVersions: [...firstInput.contractVersions].reverse(),
    dimensions: [...firstInput.dimensions].reverse().map((dimension) => ({
      ...dimension,
      drivers: [...dimension.drivers].reverse(),
      evidenceRefs: [...dimension.evidenceRefs].reverse(),
    })),
    gaps: [...firstInput.gaps].reverse(),
  });
  const first = prepareEvidenceDepth(firstInput, { now: '2026-08-28T12:00:00.000Z', projectRoot: '/Users/example/project' });
  const second = prepareEvidenceDepth(secondInput, { now: '2030-01-01T00:00:00.000Z', projectRoot: '/Volumes/other/project' });
  assert.equal(second.preparationDigest, first.preparationDigest);
  assert.deepEqual(second.gaps.map(({ id }) => id).sort(), first.gaps.map(({ id }) => id).sort());
  assert.notEqual(second.preparedAt, first.preparedAt);
});

test('records immutable reviewed evidence and requires rationale to reduce depth', () => {
  const root = project();
  try {
    const prepared = prepareEvidenceDepth(input());
    const reduced = review(prepared);
    reduced.dimensions.find(({ id }) => id === 'architecture').selectedDepth = 'bounded';
    assert.throws(() => recordEvidenceDepthRun(root, prepared, reduced), /rationale/i);
    reduced.dimensions.find(({ id }) => id === 'architecture').rationale = 'Prototype-only system with no production users.';
    const receipt = recordEvidenceDepthRun(root, prepared, reduced, { now: '2026-08-28T12:00:00.000Z' });
    const repeated = recordEvidenceDepthRun(root, prepared, reduced, { now: '2030-01-01T00:00:00.000Z' });
    assert.equal(receipt.runId, repeated.runId);
    assert.equal(receipt.contentDigest, repeated.contentDigest);
    assert.equal(readEvidenceDepthStatus(root).runs.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps grouping policy separate from stable gaps and explains grouping-only variance', () => {
  const prepared = prepareEvidenceDepth(input());
  const first = recordEvidenceDepthRun(null, prepared, review(prepared), { persist: false, now: '2026-08-28T12:00:00.000Z' }).run;
  const secondReview = review(prepared, {
    grouping: {
      strategy: 'assurance-boundary',
      assignments: prepared.gaps.map((gap) => ({ gapId: gap.id, groupId: 'one-assurance-intent', disposition: 'owned' })),
    },
  });
  const second = recordEvidenceDepthRun(null, prepared, secondReview, { persist: false, now: '2026-08-28T13:00:00.000Z' }).run;
  const comparison = compareEvidenceDepthRuns(first, second);
  assert.equal(comparison.changes.gaps.status, 'same');
  assert.equal(comparison.changes.grouping.status, 'changed');
  assert.equal(comparison.changes.grouping.explained, true);
  assert.equal(comparison.reproducible, true);
});

test('reports evidence depth and persona changes before output variance', () => {
  const firstPrepared = prepareEvidenceDepth(input());
  const changedInput = input();
  changedInput.dimensions.find(({ id }) => id === 'security').recommendedDepth = 'standard';
  changedInput.personas.push({ id: 'premium.security-architect', tier: 'premium', reasonCode: 'security-gap' });
  changedInput.evidence.push(evidence('security:threat-model', 'declared'));
  changedInput.dimensions.find(({ id }) => id === 'security').evidenceRefs.push('security:threat-model');
  const secondPrepared = prepareEvidenceDepth(changedInput);
  const first = recordEvidenceDepthRun(null, firstPrepared, review(firstPrepared), { persist: false }).run;
  const second = recordEvidenceDepthRun(null, secondPrepared, review(secondPrepared), { persist: false }).run;
  const comparison = compareEvidenceDepthRuns(first, second);
  assert.equal(comparison.changes.evidence.status, 'changed');
  assert.equal(comparison.changes.personas.status, 'changed');
  assert.equal(comparison.changes.depth.status, 'changed');
  assert.equal(comparison.order[0], 'inputs');
});

test('retains contradictory evidence and rejects unsafe or ambiguous input', () => {
  const prepared = prepareEvidenceDepth(input());
  assert.equal(prepared.gaps.some(({ contradiction }) => contradiction === 'declared-versus-observed'), true);
  assert.throws(() => prepareEvidenceDepth(input({ prompt: 'hidden prompt' })), /unknown field/i);
  const unsafe = input();
  unsafe.evidence[0].body = 'secret body';
  assert.throws(() => prepareEvidenceDepth(unsafe), /unknown field|body/i);
  const duplicate = input();
  duplicate.dimensions.push(structuredClone(duplicate.dimensions[0]));
  assert.throws(() => prepareEvidenceDepth(duplicate), /exactly once|duplicate|exceeds 7/i);
  assert.throws(() => recordEvidenceDepthRun(null, prepared, { ...review(prepared), expectedPreparationDigest: 'sha256:stale' }, { persist: false }), /newer|digest/i);
});

test('marks unaccounted derived variance as non-reproducible', () => {
  const prepared = prepareEvidenceDepth(input());
  const first = recordEvidenceDepthRun(null, prepared, review(prepared), { persist: false }).run;
  const tampered = structuredClone(first);
  tampered.coverageFingerprint = 'sha256:unexplained';
  const comparison = compareEvidenceDepthRuns(first, tampered);
  assert.equal(comparison.reproducible, false);
  assert.equal(comparison.unexplained.some(({ field }) => field === 'coverage'), true);
});
