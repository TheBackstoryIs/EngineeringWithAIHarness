import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAfkContext } from '../src/runtime/afk-conductor.mjs';

const task = {
  id: 'T-001', slice: 'GCA-S1', name: 'Context contract', issue_kind: 'tracer-bullet',
  classification: 'AFK', repo: 'application', branch: 'codex/gca-t001', depends_on: [],
  claims: ['GCA-CL001'], user_visible_outcome: 'Prepare minimum sufficient context.',
  read_set: ['src/existing.mjs'], write_set: ['src/runtime/context-assembly.mjs'],
  module_interface_contract: { module: 'src/runtime/context-assembly.mjs', interface: ['prepareContextPack'], behaviour_owned: ['budget'], caller_contract: ['no arbitrary roots'], test_boundary: 'temporary roots' },
  first_failing_test: 'node --test tests/context-assembly.test.mjs',
  red_green_refactor: { red_command: 'node --test tests/context-assembly.test.mjs', expected_red_failure: 'module absent', green_command: 'node --test tests/context-assembly.test.mjs', refactor_boundary: 'after green' },
  allowed_commands: ['node --test tests/context-assembly.test.mjs'],
  stop_conditions: ['mandatory evidence is lost'],
  completion_evidence: ['focused tests pass'],
  review: { fresh_context_required: true, review_tests_first: true, standards_pushed: ['SPECS/4.Constraints/standards/lifecycle-hook-safety.md'] },
  merge: { orchestrator_owned: true, post_merge_checks: ['npm run check'] },
};

const repository = { name: 'application', role: 'primary', parentBranch: 'codex/feature' };

test('build-task context retains the complete task and human authority boundary', () => {
  const pack = prepareAfkContext('.', task, repository, { mode: 'implementation', repositoryRevision: 'abc' });
  assert.equal(pack.profile, 'build-task');
  assert.equal(pack.status, 'ready');
  for (const marker of [
    task.id, task.slice, task.claims[0], task.write_set[0], task.allowed_commands[0],
    task.stop_conditions[0], task.first_failing_test, task.review.standards_pushed[0],
    'orchestrator_owned', 'AUTHORITY_NONE',
  ]) assert.match(pack.modelContext, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(pack.fidelity.status, 'pass');
});

test('fresh-context review keeps tests first, diff commit and exact verdict', () => {
  const pack = prepareAfkContext('.', task, repository, {
    mode: 'review', implementationCommit: 'deadbeef', repositoryRevision: 'deadbeef',
  });
  assert.equal(pack.profile, 'fresh-context-review');
  assert.match(pack.modelContext, /TESTS_FIRST/);
  assert.match(pack.modelContext, /deadbeef/);
  assert.match(pack.modelContext, /VERDICT: PASS or VERDICT: FAIL/);
  assert.match(pack.modelContext, /mandatory evidence is lost/);
  assert.equal(pack.fidelity.status, 'pass');
});

test('AFK context refuses provider-ready output when mandatory task context overflows', () => {
  const pack = prepareAfkContext('.', task, repository, { mode: 'implementation', budgetTokens: 4 });
  assert.equal(pack.status, 'non-ready');
  assert.equal(pack.modelContext, null);
});
