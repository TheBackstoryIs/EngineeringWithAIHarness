import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVIDENCE_DEPTH_DIMENSIONS,
  compareEvidenceDepthRuns,
  prepareEvidenceDepth,
  recordEvidenceDepthRun,
} from '../src/evidence-depth.mjs';

function fixture() {
  const evidence = [];
  const dimensions = EVIDENCE_DEPTH_DIMENSIONS.map((id) => {
    const refs = Array.from({ length: 40 }, (_, index) => `${id}:evidence-${index}`);
    evidence.push(...refs.map((ref) => ({ id: ref, authority: 'observed', kind: 'repository-fact', digest: `sha256:${Buffer.from(ref).toString('hex').padEnd(64, '0').slice(0, 64)}` })));
    return { id, recommendedDepth: 'deep', drivers: [`${id}-complexity`], evidenceRefs: refs, coverage: { status: 'supported', required: 40, supported: 40, excluded: 0, failed: 0 } };
  });
  return {
    schema: 'ewai.evidence-depth-input/v1',
    projectFingerprint: 'sha256:project-performance',
    sourceMap: { runId: 78, digest: 'sha256:map-performance', profileDigest: 'sha256:profiles-performance', freshness: 'fresh' },
    contractVersions: ['archaeology/v1'], packVersions: [], provider: {}, exclusions: [], predecessorId: '',
    personas: [{ id: 'ewai.core.archaeologist', tier: 'core', reasonCode: 'evidence' }],
    evidence, dimensions, gaps: [], grouping: { strategy: 'user-outcome', assignments: [] },
  };
}

test('keeps preparation and comparison within bounded local overhead', () => {
  const source = fixture();
  const durations = [];
  const before = process.memoryUsage().rss;
  let prepared;
  for (let index = 0; index < 25; index += 1) {
    const started = performance.now();
    prepared = prepareEvidenceDepth(source, { now: '2026-08-28T12:00:00.000Z' });
    durations.push(performance.now() - started);
  }
  durations.sort((left, right) => left - right);
  const median = durations[Math.floor(durations.length / 2)];
  const memoryDelta = Math.max(0, process.memoryUsage().rss - before);
  assert.ok(median < 100, `preparation median ${median.toFixed(2)} ms exceeded 100 ms`);
  assert.ok(memoryDelta < 24 * 1024 * 1024, `preparation RSS delta ${memoryDelta} exceeded 24 MiB`);

  const review = {
    schema: 'ewai.evidence-depth-review/v1', expectedPreparationDigest: prepared.preparationDigest, reviewedBy: 'Performance test',
    dimensions: prepared.dimensions.map(({ id, recommendedDepth }) => ({ id, selectedDepth: recommendedDepth, rationale: '' })),
    grouping: { strategy: 'user-outcome', assignments: [] },
  };
  const run = recordEvidenceDepthRun(null, prepared, review, { persist: false }).run;
  const comparisonDurations = [];
  for (let index = 0; index < 100; index += 1) {
    const started = performance.now();
    compareEvidenceDepthRuns(run, run);
    comparisonDurations.push(performance.now() - started);
  }
  comparisonDurations.sort((left, right) => left - right);
  assert.ok(comparisonDurations[50] < 20, `comparison median ${comparisonDurations[50].toFixed(2)} ms exceeded 20 ms`);
});
