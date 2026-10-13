import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { initProject } from '../src/project.mjs';
import { createIntent } from '../src/intents.mjs';
import { fileBehaviourContext } from '../src/runtime/behaviour-context.mjs';
import { refreshRepositoryIndex } from '../src/runtime/repository-index.mjs';
import { previewImpactAssessment, confirmImpactAssessment } from '../src/runtime/impact-analysis.mjs';
import { prepareProjectContext, safeContextManifest } from '../src/runtime/context-assembly.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
function write(root, path, value) {
  mkdirSync(dirname(resolve(root, path)), { recursive: true });
  writeFileSync(resolve(root, path), typeof value === 'string' ? value : JSON.stringify(value));
}
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-behaviour-refinement-'));
  initProject(root, { name: 'Refinement' });
  write(root, 'src/shared.mjs', 'export function shared() { return true; }\n');
  return root;
}
function delivery(root, slug, { claims = 1, symbol = 'shared', direct = true } = {}) {
  const intent = createIntent(root, { slug, domain: 'feature', title: slug });
  writeFileSync(intent.path, readFileSync(intent.path, 'utf8').replace('## Acceptance criteria\n', '## Acceptance criteria\n\n- Broad intent criterion.\n'));
  const base = `SPECS/6.Build/${slug}`;
  const authored = Array.from({ length: claims }, (_, i) => ({ id: `${slug}-C${i}`, statement: `Protect ${slug} outcome ${i}`,
    ...(direct ? { acceptance: ['Direct observable outcome'] } : {}), tests_required: ['Observable outcome'], planned_files: ['src/shared.mjs'], current_code_evidence: [{ source_path: 'src/shared.mjs', symbols: [symbol] }] }));
  write(root, `${base}/gates/plan/claim-ledger.json`, { implementation_claims: authored });
  write(root, `${base}/gates/plan/plan-contract.json`, { test_obligations: [{ id: 'TEST1', task: 'T-001', file: 'tests/shared.test.mjs', obligation: 'Shared code meets the observable outcome' }] });
  write(root, `${base}/task-graph.json`, { tasks: [{ id: 'T-001', repo: 'application', claims: authored.map(c => c.id), evidence_path: 'tasks/T-001/evidence.json', completion_evidence: ['Outcome'], read_set: ['src/shared.mjs'], write_set: ['src/shared.mjs'] }] });
  write(root, `${base}/delivery-state.json`, { intent: { id: `feature/${slug}`, title: slug, path: `SPECS/2.Purpose/intents/feature/${slug}.md` }, status: 'completed', currentPhase: 'complete' });
  write(root, `${base}/tasks/T-001/review.txt`, 'Captured original review');
  write(root, `${base}/tasks/T-001/evidence.json`, { schema: 'ewai.task-evidence/v3', task_id: 'T-001', repository: 'application', commit: 'recorded', changed_files: ['src/shared.mjs'], commands: [],
    review: { status: 'pass', evidence_path: 'tasks/T-001/review.txt', evidence_sha256: hash('Captured original review') },
    completion_checks: [{ name: 'Outcome', status: 'pass', support: 'DETAILED_SUPPORT_CANARY', observation: { evidence_type: 'behaviour', expected: 'Return true', actual: 'Return true', evidence: 'Detailed observed source' }, evidence_path: 'tasks/T-001/review.txt', evidence_sha256: hash('Captured original review') }] });
  return base;
}
function confirmInput(preview) {
  return { summary: preview.summary, targets: preview.targets, indexRunId: preview.index.runId, previewId: preview.previewId,
    acknowledged: true, assessor: 'Reviewer', decisions: Object.fromEntries(preview.reviewRoutes.map(r => [r.id, r.recommendation])) };
}

test('confirmation requires the reviewed receipt and refuses changed historical evidence with an unchanged index', () => {
  const root = fixture();
  try {
    const base = delivery(root, 'historical');
    refreshRepositoryIndex(root);
    const preview = previewImpactAssessment(root, 'historical', { summary: 'Change user-visible shared behaviour.', targets: ['src/shared.mjs'] });
    const input = confirmInput(preview);
    assert.throws(() => confirmImpactAssessment(root, 'historical', { ...input, previewId: undefined }), /preview.*receipt|preview.*required/i);
    write(root, `${base}/tasks/T-001/review.txt`, 'Changed review');
    assert.throws(() => confirmImpactAssessment(root, 'historical', input), /changed.*preview|preview.*changed/i);
    const refreshed = previewImpactAssessment(root, 'historical', { summary: preview.summary, targets: preview.targets });
    const result = confirmImpactAssessment(root, 'historical', confirmInput(refreshed));
    assert.equal(result.status, 'recorded');
    assert.equal(confirmImpactAssessment(root, 'historical', confirmInput(refreshed)).assessmentId, result.assessmentId);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('summary deduplicates task criteria tests and evidence and expands historical detail only on demand', () => {
  const root = fixture();
  try {
    delivery(root, 'historical', { claims: 2 });
    const summary = fileBehaviourContext(root, 'src/shared.mjs');
    assert.equal(summary.schema, 'ewai.behaviour-context/v2');
    assert.equal(summary.mode, 'summary');
    assert.equal(summary.claims.length, 2);
    assert.equal(summary.tasks.length, 1);
    assert.equal(summary.criteria.length, 1);
    assert.equal(summary.tests.length, 1);
    assert.equal(summary.evidence.filter(e => e.path.endsWith('/review.txt')).length, 1);
    assert.equal(JSON.stringify(summary).includes('DETAILED_SUPPORT_CANARY'), false);
    assert.equal(JSON.stringify(summary).includes('Broad intent criterion.'), false);
    const detail = fileBehaviourContext(root, 'src/shared.mjs', { detail: true });
    assert.equal(detail.mode, 'detail');
    assert.equal(detail.tasks.length, 1);
    assert.match(JSON.stringify(detail), /DETAILED_SUPPORT_CANARY/);
    assert.equal(detail.digest, summary.digest);
    delivery(root, 'fallback', { claims: 2, direct: false });
    const expanded = fileBehaviourContext(root, 'src/shared.mjs', { detail: true });
    assert.equal(expanded.criteria.filter(c => c.scope === 'intent-fallback').length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('strong symbol links precede alphabetical fallback and changed evidence precedes equivalent current evidence', () => {
  const root = fixture();
  try {
    delivery(root, 'aaa-fallback', { symbol: 'different' });
    const exact = delivery(root, 'zzz-exact');
    let result = fileBehaviourContext(root, 'src/shared.mjs', { symbol: 'shared', limit: 1 });
    assert.equal(result.claims[0].claimId, 'zzz-exact-C0');
    write(root, `${exact}/tasks/T-001/review.txt`, 'Changed review');
    result = fileBehaviourContext(root, 'src/shared.mjs', { limit: 1 });
    assert.equal(result.claims[0].claimId, 'zzz-exact-C0');
    assert.equal(result.coverage.truncated, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('catalogue uncertainty is separate from matched evidence health and unrelated intents are not opened', () => {
  const root = fixture();
  try {
    delivery(root, 'historical');
    const before = fileBehaviourContext(root, 'src/shared.mjs');
    write(root, 'SPECS/6.Build/unplanned/notes.md', '# Unplanned work');
    // This unreadable/oversized unrelated intent must not consume the byte budget.
    const unrelated = delivery(root, 'unrelated');
    const ledger = JSON.parse(readFileSync(resolve(root, `${unrelated}/gates/plan/claim-ledger.json`)));
    ledger.implementation_claims[0].planned_files = ['src/unrelated.mjs'];
    ledger.implementation_claims[0].current_code_evidence = [{ source_path: 'src/unrelated.mjs' }];
    write(root, `${unrelated}/gates/plan/claim-ledger.json`, ledger);
    const evidence = JSON.parse(readFileSync(resolve(root, `${unrelated}/tasks/T-001/evidence.json`)));
    evidence.changed_files = ['src/unrelated.mjs'];
    write(root, `${unrelated}/tasks/T-001/evidence.json`, evidence);
    write(root, 'SPECS/2.Purpose/intents/feature/unrelated.md', ' '.repeat(900001));
    const result = fileBehaviourContext(root, 'src/shared.mjs');
    assert.equal(result.coverage.catalogue.complete, false);
    assert.equal(result.coverage.matched.complete, true);
    assert.equal(result.coverage.diagnostics.some(d => d.path.includes('/unrelated.md')), false);
    assert.equal(result.digest, before.digest);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Impact persists a compact immutable as-reviewed snapshot with fingerprints instead of a full projection', () => {
  const root = fixture();
  try {
    const base = delivery(root, 'historical', { claims: 2 });
    refreshRepositoryIndex(root);
    const preview = previewImpactAssessment(root, 'historical', { summary: 'Change shared customer behaviour.', targets: ['src/shared.mjs'] });
    const result = confirmImpactAssessment(root, 'historical', confirmInput(preview));
    assert.equal(Object.hasOwn(result.assessment, 'behaviourContext'), false);
    const frozen = result.assessment.behaviourSnapshot;
    assert.equal(frozen.digest, preview.behaviourContext.digest);
    assert.equal(frozen.schema, 'ewai.behaviour-snapshot/v1');
    assert.equal(frozen.claims.length, 2);
    assert.equal(frozen.evidence[0].currentDigest.length, 64);
    assert.equal(JSON.stringify(frozen).includes('DETAILED_SUPPORT_CANARY'), false);
    const saved = readFileSync(resolve(root, result.evidence.jsonPath));
    write(root, `${base}/tasks/T-001/review.txt`, 'Changed after acceptance');
    assert.deepEqual(readFileSync(resolve(root, result.evidence.jsonPath)), saved);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Plan Build and fresh-review select a compact advisory historical segment without changing mandatory fidelity or task scope', () => {
  const root = fixture();
  try {
    delivery(root, 'historical', { claims: 2 });
    const current = delivery(root, 'current');
    write(root, `${current}/build-plan.md`, '# current\n\n## Security\nBoundaries remain intact.\n\n## Tests\nExercise shared code.');
    for (const profile of ['plan', 'build-task', 'fresh-context-review']) {
      const pack = prepareProjectContext(root, { profile, slug: 'current', taskId: 'T-001', focus: 'Change shared code' });
      assert.equal(pack.status, 'ready');
      assert.equal(pack.fidelity.status, 'pass');
      assert.equal(pack.fidelity.mandatoryRecall, 1);
      assert.match(pack.modelContext, /HISTORICAL_OBLIGATIONS_ADVISORY/);
      assert.match(pack.modelContext, /historical-C0/);
      assert.doesNotMatch(pack.modelContext, /current-C0.*recheck/);
      assert.doesNotMatch(pack.modelContext, /DETAILED_SUPPORT_CANARY/);
      const historical = pack.segments.find(s => s.id === 'historical-obligations');
      assert.equal(historical.evidenceClass, 'relevant');
      assert.equal(JSON.stringify(safeContextManifest(pack)).includes('historical-C0'), false);
      const tight = prepareProjectContext(root, { profile, slug: 'current', taskId: 'T-001', focus: 'Change shared code', budgetTokens: pack.budget.mandatoryTokens });
      assert.equal(tight.fidelity.mandatoryRecall, 1);
      assert.doesNotMatch(tight.modelContext, /HISTORICAL_OBLIGATIONS_ADVISORY/);
    }
    write(root, 'src/other.mjs', 'export const other = true;');
    const graph = JSON.parse(readFileSync(resolve(root, `${current}/task-graph.json`)));
    graph.tasks[0].write_set = ['src/other.mjs'];
    graph.tasks[0].read_set = ['src/other.mjs'];
    write(root, `${current}/task-graph.json`, graph);
    const unrelated = prepareProjectContext(root, { profile: 'build-task', slug: 'current', taskId: 'T-001', focus: 'Other code' });
    assert.doesNotMatch(unrelated.modelContext, /historical-C0/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('optional historical enrichment cannot block valid mandatory Plan context on malformed or non-exact scope', () => {
  const root = fixture();
  try {
    delivery(root, 'historical');
    const current = delivery(root, 'current');
    write(root, `${current}/build-plan.md`, '# current\n\n## Security\nRetain boundaries.\n\n## Tests\nVerify outcomes.');
    write(root, `${current}/task-graph.json`, '{invalid');
    let pack = prepareProjectContext(root, { profile: 'plan', slug: 'current', focus: 'Plan scope' });
    assert.equal(pack.status, 'ready');
    assert.equal(pack.fidelity.mandatoryRecall, 1);
    assert.match(pack.modelContext, /historical lookup unavailable/);
    // A malformed current task remains a mandatory failure for implementation.
    assert.throws(() => prepareProjectContext(root, { profile: 'build-task', slug: 'current', taskId: 'T-001' }));
    write(root, `${current}/task-graph.json`, { tasks: [{ id: 'T-001', repo: 'application', claims: ['current-C0'], write_set: ['src/'] }] });
    const ledger = JSON.parse(readFileSync(resolve(root, `${current}/gates/plan/claim-ledger.json`)));
    ledger.implementation_claims[0].planned_files = ['src/'];
    write(root, `${current}/gates/plan/claim-ledger.json`, ledger);
    pack = prepareProjectContext(root, { profile: 'plan', slug: 'current', focus: 'Plan scope' });
    assert.equal(pack.status, 'ready');
    assert.equal(pack.fidelity.mandatoryRecall, 1);
    assert.match(pack.modelContext, /non-exact scope boundaries/);
    assert.doesNotMatch(pack.modelContext, /historical-C0/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
