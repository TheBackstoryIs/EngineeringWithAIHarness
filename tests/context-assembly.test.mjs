import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  CONTEXT_ESTIMATE_METHOD,
  compareContextPacks,
  contextProfiles,
  prepareContextPack,
  safeContextManifest,
} from '../src/runtime/context-assembly.mjs';

const candidates = [
  {
    id: 'authority', label: 'Authority boundary', evidenceClass: 'mandatory', priority: 100,
    sourcePath: 'SPECS/4.Constraints/authority.md', content: 'AUTHORITY_NONE Build and Manual QA stay human.',
    requiredMarkers: ['AUTHORITY_NONE', 'Manual QA'], selectionReason: 'Every host must retain human authority.',
  },
  {
    id: 'task', label: 'Task contract', evidenceClass: 'mandatory', priority: 90,
    sourcePath: 'SPECS/6.Build/example/task-graph.json', content: 'TASK_ID T-001 WRITE_SET src/runtime/example.mjs TEST npm test',
    requiredMarkers: ['TASK_ID', 'WRITE_SET', 'TEST'], selectionReason: 'Implementation needs the exact task contract.',
  },
  {
    id: 'focus', label: 'Relevant focus', evidenceClass: 'relevant', priority: 50,
    sourcePath: 'src/runtime/example.mjs', content: 'FOCUS current implementation detail',
    selectionReason: 'The changed module matches the requested focus.',
  },
  {
    id: 'history', label: 'Earlier context', evidenceClass: 'optional', priority: 10,
    sourcePath: 'SPECS/3.Evidence/history.md', content: 'HISTORY older background that can be deferred',
    selectionReason: 'Useful background when budget remains.',
  },
];

const personas = [
  { id: 'project.owner', name: 'Project Owner', tier: 'project', category: 'product', tags: ['outcomes', 'build'] },
  { id: 'premium.performance', name: 'Performance Engineer', tier: 'premium', category: 'engineering', tags: ['performance', 'latency'] },
  { id: 'core.maintainer', name: 'Maintainer', tier: 'core', category: 'engineering', tags: ['build', 'testing'] },
];

test('publishes immutable provider-neutral context profiles including design application', () => {
  assert.deepEqual(Object.keys(contextProfiles), [
    'companion', 'intent', 'plan', 'build-task', 'fresh-context-review', 'phase-contribution-review', 'design-system-apply',
  ]);
  assert.equal(Object.isFrozen(contextProfiles), true);
  assert.equal(CONTEXT_ESTIMATE_METHOD, 'utf8-bytes-div-3-v1');
});

test('selects deterministically, preserves mandatory markers and returns a body-free safe manifest', () => {
  const input = {
    profile: 'build-task', focus: 'build performance', budgetTokens: 140,
    repositoryRevision: 'abc123', deliveryRevision: 'gate456', candidates, personaCatalogue: personas,
  };
  const first = prepareContextPack(input);
  const second = prepareContextPack(input);
  assert.equal(first.status, 'ready');
  assert.equal(first.digest, second.digest);
  assert.deepEqual(first.segments.map(({ id, disposition }) => [id, disposition]), second.segments.map(({ id, disposition }) => [id, disposition]));
  assert.match(first.modelContext, /AUTHORITY_NONE/);
  assert.match(first.modelContext, /WRITE_SET/);
  assert.ok(first.usage.estimatedInputTokens <= first.budget.limitTokens);
  assert.equal(first.usage.estimatedInputTokens, first.budget.usedTokens);
  assert.equal(first.fidelity.status, 'pass');
  assert.equal(first.fidelity.mandatoryRecall, 1);
  assert.deepEqual(first.activePersonas.map(({ tier }) => tier).slice(0, 2), ['project', 'premium']);

  const safe = safeContextManifest(first);
  assert.equal('modelContext' in safe, false);
  assert.equal(JSON.stringify(safe).includes('AUTHORITY_NONE'), false);
  assert.equal(JSON.stringify(safe).includes('Performance Engineer'), true);
  assert.equal(safe.segments.every((segment) => !('content' in segment)), true);
  assert.equal(safe.segments.every((segment) => !segment.sourcePath.startsWith('/')), true);
});

test('mandatory overflow is non-ready and never exposes a provider payload', () => {
  const pack = prepareContextPack({
    profile: 'build-task', focus: 'build', budgetTokens: 4,
    repositoryRevision: 'abc123', deliveryRevision: 'gate456', candidates,
  });
  assert.equal(pack.status, 'non-ready');
  assert.equal(pack.reason, 'mandatory-overflow');
  assert.equal(pack.modelContext, null);
  assert.ok(pack.budget.overflowTokens > 0);
  assert.deepEqual(pack.recovery, ['narrow-focus', 'increase-budget', 'split-operation']);
});

test('accounts for rendered segment headers before declaring a pack within budget', () => {
  const pack = prepareContextPack({
    profile: 'intent', budgetTokens: 2,
    candidates: [
      { id: 'one', label: 'First mandatory segment', evidenceClass: 'mandatory', sourcePath: 'SPECS/one.md', content: 'A', requiredMarkers: ['A'] },
      { id: 'two', label: 'Second mandatory segment', evidenceClass: 'mandatory', sourcePath: 'SPECS/two.md', content: 'B', requiredMarkers: ['B'] },
    ],
  });
  assert.equal(pack.status, 'non-ready');
  assert.ok(pack.budget.mandatoryTokens > 2);
  assert.equal(pack.modelContext, null);
});

test('rejects unsafe sources and unsupported profiles', () => {
  assert.throws(() => prepareContextPack({ profile: 'invented', candidates }), /Unsupported context profile/);
  assert.throws(() => prepareContextPack({
    profile: 'plan', repositoryRevision: 'a', deliveryRevision: 'b',
    candidates: [{ ...candidates[0], sourcePath: '/private/source.md' }],
  }), /project-relative/);
  assert.throws(() => prepareContextPack({
    profile: 'plan', repositoryRevision: 'a', deliveryRevision: 'b',
    candidates: [{ ...candidates[0], sourcePath: '../outside.md' }],
  }), /project-relative/);
});

test('reports exact segment and persona deltas against an exact predecessor digest', () => {
  const first = prepareContextPack({
    profile: 'build-task', focus: 'performance', budgetTokens: 140,
    repositoryRevision: 'one', deliveryRevision: 'one', candidates, personaCatalogue: personas,
  });
  const changed = candidates.map((segment) => segment.id === 'focus' ? { ...segment, content: `${segment.content} changed` } : segment);
  const second = prepareContextPack({
    profile: 'build-task', focus: 'testing', budgetTokens: 140,
    repositoryRevision: 'two', deliveryRevision: 'two', candidates: changed,
    personaCatalogue: personas, previousPack: safeContextManifest(first), previousDigest: first.digest,
  });
  assert.equal(second.delta.predecessorDigest, first.digest);
  assert.ok(second.delta.changedSegments.includes('focus'));
  assert.ok(second.delta.retainedSegments.includes('authority'));
  assert.ok(second.delta.removedPersonas.includes('premium.performance'));
  assert.deepEqual(
    compareContextPacks(safeContextManifest(second), safeContextManifest(first), first.digest),
    second.delta,
  );
  assert.throws(() => prepareContextPack({
    profile: 'build-task', focus: 'testing', budgetTokens: 140,
    repositoryRevision: 'two', deliveryRevision: 'two', candidates: changed,
    previousPack: safeContextManifest(first), previousDigest: 'stale',
  }), /predecessor digest/);
  assert.throws(
    () => compareContextPacks(safeContextManifest(second), safeContextManifest(first), 'stale'),
    /predecessor digest/,
  );
});

test('content-addressed cache is disposable and invalidates changed source content', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-context-cache-'));
  try {
    const first = prepareContextPack({
      profile: 'build-task', focus: 'build', budgetTokens: 140,
      repositoryRevision: 'one', deliveryRevision: 'one', candidates, cacheRoot: root,
    });
    const authority = first.segments.find((segment) => segment.id === 'authority');
    assert.equal(authority.cache.status, 'written');
    assert.equal(existsSync(resolve(root, 'fragments', `${authority.fragmentDigest}.txt`)), true);
    assert.match(readFileSync(resolve(root, 'fragments', `${authority.fragmentDigest}.txt`), 'utf8'), /AUTHORITY_NONE/);

    const warm = prepareContextPack({
      profile: 'build-task', focus: 'build', budgetTokens: 140,
      repositoryRevision: 'one', deliveryRevision: 'one', candidates, cacheRoot: root,
    });
    assert.equal(warm.segments.find((segment) => segment.id === 'authority').cache.status, 'reused');
    assert.equal(warm.digest, first.digest);

    rmSync(root, { recursive: true, force: true });
    const recovered = prepareContextPack({
      profile: 'build-task', focus: 'build', budgetTokens: 140,
      repositoryRevision: 'one', deliveryRevision: 'one', candidates, cacheRoot: root,
    });
    assert.equal(recovered.digest, first.digest);
    assert.equal(recovered.modelContext, first.modelContext);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
