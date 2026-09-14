import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runContextBenchmark } from '../src/runtime/context-benchmarks.mjs';

const fixturePath = fileURLToPath(new URL('./fixtures/context-benchmarks.json', import.meta.url));

test('requires full profile visibility and engineering fidelity before reporting token savings', () => {
  const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const result = runContextBenchmark(fixtures, { samples: 3 });
  assert.equal(result.schema, 'ewai.context-benchmark/v1');
  assert.equal(result.status, 'pass');
  assert.equal(result.profiles.length, 7);
  assert.deepEqual(result.profiles.map(({ profile }) => profile), fixtures.map(({ profile }) => profile));
  assert.equal(result.profiles.every(({ fidelity }) => fidelity.status === 'pass'), true);
  assert.equal(result.profiles.every(({ mandatoryRecall }) => mandatoryRecall === 1), true);
  assert.ok(result.aggregate.medianReductionPercent >= 40);
  assert.ok(result.performance.medianPreparationMs <= 75);
  assert.ok(result.performance.peakRssGrowthBytes <= 32 * 1024 * 1024);
  assert.equal(JSON.stringify(result).includes('MANDATORY:'), false);
});

test('fails the benchmark when one profile loses a mandatory marker', () => {
  const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'));
  fixtures[0].segments[0].requiredMarkers.push('ABSENT_REQUIRED_MARKER');
  const result = runContextBenchmark(fixtures, { samples: 1 });
  assert.equal(result.status, 'fail');
  assert.equal(result.profiles[0].fidelity.status, 'fail');
  assert.equal(result.failures.some((failure) => failure.code === 'mandatory-recall'), true);
});
