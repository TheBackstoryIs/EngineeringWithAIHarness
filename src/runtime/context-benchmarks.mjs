import { performance } from 'node:perf_hooks';
import { contextProfiles, estimateContextTokens, prepareContextPack } from './context-assembly.mjs';

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function expandSegments(segments = []) {
  return segments.map((segment) => ({
    ...segment,
    content: String(segment.content ?? '').repeat(Math.max(1, Math.min(1_000, Number(segment.repeat ?? 1)))),
  }));
}

function baselineContext(segments) {
  return segments.map((segment) => `## ${segment.label} [${segment.id}]\n${segment.content}`).join('\n\n');
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

export function runContextBenchmark(fixtures = [], options = {}) {
  const samples = Math.max(1, Math.min(100, Number(options.samples ?? 7)));
  const thresholds = {
    minimumReductionPercent: Number(options.minimumReductionPercent ?? 40),
    maximumMedianPreparationMs: Number(options.maximumMedianPreparationMs ?? 75),
    maximumPeakRssGrowthBytes: Number(options.maximumPeakRssGrowthBytes ?? 32 * 1024 * 1024),
  };
  const expectedProfiles = Object.keys(contextProfiles);
  const fixtureProfiles = fixtures.map(({ profile }) => profile);
  const durations = [];
  const rssStart = process.memoryUsage().rss;
  let peakRss = rssStart;

  // Warm the JS paths before recording local measurements.
  for (const fixture of fixtures) {
    const segments = expandSegments(fixture.segments);
    prepareContextPack({ ...fixture, candidates: segments, repositoryRevision: 'benchmark', deliveryRevision: 'benchmark' });
  }

  const profiles = fixtures.map((fixture) => {
    const segments = expandSegments(fixture.segments);
    const baseline = estimateContextTokens(baselineContext(segments));
    let pack = null;
    for (let index = 0; index < samples; index += 1) {
      const started = performance.now();
      pack = prepareContextPack({ ...fixture, candidates: segments, repositoryRevision: 'benchmark', deliveryRevision: 'benchmark' });
      durations.push(performance.now() - started);
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }
    const candidateTokens = pack.usage.estimatedInputTokens;
    const reductionPercent = baseline.estimatedTokens
      ? ((baseline.estimatedTokens - candidateTokens) / baseline.estimatedTokens) * 100
      : 0;
    return {
      profile: fixture.profile,
      status: pack.status,
      baseline: { bytes: baseline.bytes, estimatedTokens: baseline.estimatedTokens },
      candidate: { bytes: pack.usage.estimatedInputBytes, estimatedTokens: candidateTokens },
      reductionPercent: rounded(reductionPercent),
      mandatoryRecall: pack.fidelity.mandatoryRecall,
      fidelity: { status: pack.fidelity.status, requiredCount: pack.fidelity.requiredCount, presentCount: pack.fidelity.presentCount, missing: pack.fidelity.missing },
      segmentCounts: {
        selected: pack.segments.filter(({ disposition }) => disposition === 'selected').length,
        reused: pack.segments.filter(({ disposition }) => disposition === 'reused').length,
        deferred: pack.segments.filter(({ disposition }) => disposition === 'deferred').length,
        overflow: pack.segments.filter(({ disposition }) => disposition === 'overflow').length,
      },
    };
  });

  const failures = [];
  for (const profile of profiles) {
    if (profile.status !== 'ready' || profile.fidelity.status !== 'pass' || profile.mandatoryRecall !== 1) {
      failures.push({ code: 'mandatory-recall', profile: profile.profile, message: 'Mandatory evidence recall is below 100 percent.' });
    }
  }
  const profileCoverage = expectedProfiles.every((profile) => fixtureProfiles.includes(profile))
    && fixtureProfiles.every((profile) => expectedProfiles.includes(profile))
    && new Set(fixtureProfiles).size === expectedProfiles.length;
  if (!profileCoverage) failures.push({ code: 'profile-coverage', message: 'Every supported profile must appear exactly once.' });
  const medianReductionPercent = rounded(median(profiles.map(({ reductionPercent }) => reductionPercent)));
  if (medianReductionPercent < thresholds.minimumReductionPercent) {
    failures.push({ code: 'token-reduction', message: `Median reduction ${medianReductionPercent} is below ${thresholds.minimumReductionPercent}.` });
  }
  const medianPreparationMs = rounded(median(durations));
  const peakRssGrowthBytes = Math.max(0, peakRss - rssStart);
  if (medianPreparationMs > thresholds.maximumMedianPreparationMs) {
    failures.push({ code: 'preparation-latency', message: `Median local preparation ${medianPreparationMs}ms exceeds ${thresholds.maximumMedianPreparationMs}ms.` });
  }
  if (peakRssGrowthBytes > thresholds.maximumPeakRssGrowthBytes) {
    failures.push({ code: 'preparation-memory', message: `Peak RSS growth ${peakRssGrowthBytes} exceeds ${thresholds.maximumPeakRssGrowthBytes}.` });
  }

  return {
    schema: 'ewai.context-benchmark/v1',
    status: failures.length ? 'fail' : 'pass',
    method: {
      corpus: 'committed-equal-input-fixtures',
      estimator: 'utf8-bytes-div-3-v1',
      samples,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
    },
    thresholds,
    profiles,
    aggregate: { profileCoverage, medianReductionPercent },
    performance: { medianPreparationMs, peakRssGrowthBytes },
    failures,
  };
}
