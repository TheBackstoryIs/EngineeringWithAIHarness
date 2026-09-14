import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createIntent, updateIntentDeliveryState } from '../src/intents.mjs';
import { initProject } from '../src/project.mjs';
import { finishActiveSession, startActiveSession } from '../src/runtime/work.mjs';
import {
  abandonExecutionLeasesForRun,
  acquireExecutionLease,
  heartbeatExecutionLease,
  listExecutionLeases,
  releaseExecutionLease,
} from '../src/runtime/execution-leases.mjs';
import { sha256 } from '../src/delivery-documents.mjs';

function seedTaskGraph(root, slug) {
  const deliveryRoot = resolve(root, `SPECS/6.Build/${slug}`);
  mkdirSync(deliveryRoot, { recursive: true });
  writeFileSync(resolve(deliveryRoot, 'task-graph.json'), `${JSON.stringify({
    schema_version: 1,
    slug,
    status: 'final',
    parent_branch: `feature/${slug}`,
    source: { claim_ledger: 'gates/plan/claim-ledger.json', plan_contract: 'gates/plan/plan-contract.json', destination: 'destination.md' },
    parallelism: { allowed: false, rationale: 'One safe test task.', max_parallel_tasks: 1 },
    afk_waves: [{ wave: 1, ready_tasks: ['T-001'], parallel_tasks: [], merge_order: ['T-001'], rationale: 'One task.' }],
    tasks: [{
      id: 'T-001', slice: 'SLICE-001', name: 'Leased task', issue_kind: 'tracer-bullet', priority: 10,
      parallel_wave: 1, classification: 'AFK', repo: 'Test', branch: `feature/${slug}/T-001-leased`,
      depends_on: [], claims: ['CL-001'], user_visible_outcome: 'Lease is visible.',
      read_set: ['src/input.mjs'], write_set: ['src/output.mjs'], central_writes_allowed: false,
      module_interface_contract: { module: 'lease', interface: ['run'], behaviour_owned: ['ownership'], caller_contract: ['token'], test_boundary: 'unit' },
      first_failing_test: 'node --test', no_first_test_rationale: '',
      red_green_refactor: { red_command: 'node --test', expected_red_failure: 'no lease', green_command: 'node --test', refactor_boundary: 'lease' },
      allowed_commands: ['node --test'], stop_conditions: ['pattern conflict discovered'], completion_evidence: ['tests pass'],
      ralph_loop: { allowed: false, max_iterations: 0, completion_promise: '<promise>T-001 COMPLETE</promise>' },
      review: { fresh_context_required: true, review_tests_first: true, standards_pushed: ['SPECS/pipeline.yaml'] },
      merge: { orchestrator_owned: true, post_merge_checks: ['node --test'] }, report_path: 'tasks/T-001/report.md',
      evidence_path: 'tasks/T-001/evidence.json',
    }],
  }, null, 2)}\n`);
  mkdirSync(resolve(deliveryRoot, 'gates/plan'), { recursive: true });
  writeFileSync(resolve(deliveryRoot, 'gates/plan/claim-ledger.json'), '{"implementation_claims":[{"id":"CL-001","type":"implementation"}],"slices":[{"id":"SLICE-001"}]}\n');
  writeFileSync(resolve(deliveryRoot, 'gates/plan/plan-contract.json'), '{"vertical_slices":[{"id":"SLICE-001"}]}\n');
  writeFileSync(resolve(deliveryRoot, 'destination.md'), '# Destination\n');
}

function seedRunningBuild(root, created, slug) {
  const deliveryRoot = resolve(root, `SPECS/6.Build/${slug}`);
  const statePath = resolve(deliveryRoot, 'delivery-state.json');
  mkdirSync(resolve(deliveryRoot, 'gates/build'), { recursive: true });
  writeFileSync(resolve(deliveryRoot, 'gates/build/build-approval.json'), '{"schema":"ewai.build-approval/v1","decision":"approved"}\n');
  writeFileSync(statePath, `${JSON.stringify({
    schema: 'ewai.delivery-state/v1',
    slug,
    intent: { id: 'delivery/leased-work', slug, status: 'in-progress' },
    status: 'in-progress',
    currentPhase: 'build',
    phases: [{ id: 'build', status: 'running' }],
    adjuncts: [],
    humanGates: [],
    approvals: { build: true },
  }, null, 2)}\n`);
  updateIntentDeliveryState(root, created.path, {
    status: 'in-progress',
    deliveryStatus: 'in-progress',
    currentPhase: 'build',
    deliveryStatePath: `SPECS/6.Build/${slug}/delivery-state.json`,
  });
}

function buildDependency(target) {
  return {
    type: 'depends-on',
    target,
    required_before: 'build',
    required_state: 'plan-complete',
  };
}

function seedPlanCompleteDependency(root, slug) {
  const deliveryRoot = resolve(root, `SPECS/6.Build/${slug}`);
  mkdirSync(deliveryRoot, { recursive: true });
  writeFileSync(resolve(deliveryRoot, 'delivery-state.json'), `${JSON.stringify({
    schema: 'ewai.delivery-state/v1',
    slug,
    phases: [{ id: 'plan', status: 'completed' }],
  }, null, 2)}\n`);
}

function completedTaskReport() {
  return `# Task Report: T-001

**Task:** Leased task
**Branch:** \`feature/leased-work/T-001-leased\`
**Worker context:** AFK
**Model tier:** implementation
**Concrete model/session:** codex/test
**Sandbox mode:** worktree-only
**Commits:** abc123

## Summary
- Implemented the leased task.

## Red-green-refactor evidence
| Step | Command | Expected | Actual |
|---|---|---|---|
| Red | \`node --test\` | fails | failed before implementation |
| Green | \`node --test\` | pass | passed |
| Refactor | \`node --test\` | pass | passed |

## Feedback loops run
- \`node --test\` → pass

## Files changed
- \`src/output.mjs\` — implemented ownership.

## Completion evidence
- Tests — pass

## Stop conditions
- Pattern conflict — not hit

## Review notes
- Tests reviewed first: yes
- Fresh-context review: pass

## QA notes
- none
`;
}

function seedCompletedEvidence(root) {
  const deliveryRoot = resolve(root, 'SPECS/6.Build/leased-work');
  const outputPath = 'tasks/T-001/evidence/command.txt';
  const reviewPath = 'tasks/T-001/evidence/review.md';
  const completionPath = 'tasks/T-001/evidence/completion.md';
  for (const [path, content] of [[outputPath, 'captured output\n'], [reviewPath, '# Review\n\nPass.\n'], [completionPath, '# Completion\n\nPass.\n']]) {
    mkdirSync(resolve(deliveryRoot, path, '..'), { recursive: true });
    writeFileSync(resolve(deliveryRoot, path), content);
  }
  const hash = (path) => sha256(readFileSync(resolve(deliveryRoot, path)));
  writeFileSync(resolve(deliveryRoot, 'tasks/T-001/evidence.json'), `${JSON.stringify({
    schema: 'ewai.task-evidence/v1', task_id: 'T-001', branch: 'feature/leased-work/T-001-leased', commit: 'abc123',
    changed_files: ['src/output.mjs'],
    commands: [
      { stage: 'red', command: 'node --test', expected_failure: 'no lease', exit_code: 1, output_path: outputPath, output_sha256: hash(outputPath) },
      { stage: 'green', command: 'node --test', exit_code: 0, output_path: outputPath, output_sha256: hash(outputPath) },
      { stage: 'refactor', command: 'node --test', exit_code: 0, output_path: outputPath, output_sha256: hash(outputPath) },
    ],
    review: { fresh_context: true, tests_reviewed_first: true, status: 'pass', reviewer: 'test-reviewer', evidence_path: reviewPath, evidence_sha256: hash(reviewPath) },
    completion_checks: [{ name: 'tests pass', status: 'pass', evidence_path: completionPath, evidence_sha256: hash(completionPath) }],
  }, null, 2)}\n`);
}

test('acquires, renews, protects, and releases a task execution lease atomically', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-execution-lease-'));
  try {
    initProject(root, { name: 'Lease Test' });
    const created = createIntent(root, { slug: 'leased-work', domain: 'delivery', title: 'Leased Work' });
    seedTaskGraph(root, 'leased-work');
    seedRunningBuild(root, created, 'leased-work');

    const first = acquireExecutionLease(root, 'delivery/leased-work', {
      taskId: 'T-001', ownerId: 'agent-a', tool: 'codex', runId: 'run-a', durationMs: 60_000,
    });
    assert.equal(first.status, 'active');
    assert.equal(first.ownerId, 'agent-a');
    const listed = listExecutionLeases(root, { activeOnly: true });
    assert.equal(listed.length, 1);
    assert.equal('token' in listed[0], false);

    const renewed = acquireExecutionLease(root, 'delivery/leased-work', {
      taskId: 'T-001', ownerId: 'agent-a', tool: 'codex', runId: 'run-a', durationMs: 60_000,
    });
    assert.equal(renewed.token, first.token);

    assert.throws(
      () => acquireExecutionLease(root, 'delivery/leased-work', {
        taskId: 'T-001', ownerId: 'agent-b', tool: 'claude', runId: 'run-b', durationMs: 60_000,
      }),
      /already leased/i,
    );
    assert.throws(
      () => heartbeatExecutionLease(root, first.id, { token: 'wrong-token', durationMs: 60_000 }),
      /token/i,
    );

    const heartbeat = heartbeatExecutionLease(root, first.id, { token: first.token, durationMs: 60_000 });
    assert.equal(heartbeat.status, 'active');
    const released = releaseExecutionLease(root, first.id, { token: first.token, outcome: 'handoff' });
    assert.equal(released.status, 'released');

    const second = acquireExecutionLease(root, 'delivery/leased-work', {
      taskId: 'T-001', ownerId: 'agent-b', tool: 'claude', runId: 'run-b', durationMs: 60_000,
    });
    assert.equal(second.ownerId, 'agent-b');
    assert.notEqual(second.token, first.token);
    assert.throws(
      () => releaseExecutionLease(root, second.id, { token: second.token, outcome: 'completed' }),
      /task report is incomplete/i,
    );
    const reportPath = resolve(root, 'SPECS/6.Build/leased-work/tasks/T-001/report.md');
    mkdirSync(resolve(reportPath, '..'), { recursive: true });
    writeFileSync(reportPath, completedTaskReport());
    seedCompletedEvidence(root);
    const completed = releaseExecutionLease(root, second.id, { token: second.token, outcome: 'completed' });
    assert.equal(completed.outcome, 'completed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('leases a ready task when its Build dependency has completed Plan', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-lease-satisfied-dependency-'));
  try {
    initProject(root, { name: 'Satisfied Dependency Lease Test' });
    createIntent(root, { slug: 'shared-foundation', domain: 'platform', title: 'Shared Foundation' });
    seedPlanCompleteDependency(root, 'shared-foundation');
    const created = createIntent(root, {
      slug: 'leased-work',
      domain: 'delivery',
      title: 'Leased Work',
      relationships: [buildDependency('platform/shared-foundation')],
    });
    seedTaskGraph(root, 'leased-work');
    seedRunningBuild(root, created, 'leased-work');

    const lease = acquireExecutionLease(root, 'delivery/leased-work', {
      taskId: 'T-001', ownerId: 'agent-a', tool: 'codex', runId: 'run-a', durationMs: 60_000,
    });

    assert.equal(lease.status, 'active');
    assert.equal(lease.taskId, 'T-001');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps missing and incomplete Build dependencies blocked', () => {
  for (const scenario of [
    { name: 'missing', createTarget: false, expected: /depends on missing intent platform\/shared-foundation/i },
    { name: 'incomplete', createTarget: true, expected: /must reach plan-complete before build/i },
  ]) {
    const root = mkdtempSync(resolve(tmpdir(), `ewai-lease-${scenario.name}-dependency-`));
    try {
      initProject(root, { name: `${scenario.name} Dependency Lease Test` });
      createIntent(root, { slug: 'shared-foundation', domain: 'platform', title: 'Shared Foundation' });
      const created = createIntent(root, {
        slug: 'leased-work',
        domain: 'delivery',
        title: 'Leased Work',
        relationships: [buildDependency('platform/shared-foundation')],
      });
      if (!scenario.createTarget) {
        rmSync(resolve(root, 'SPECS/2.Purpose/intents/platform/shared-foundation.md'));
        rmSync(resolve(root, 'SPECS/2.Purpose/intents/platform/shared-foundation.json'));
      }
      seedTaskGraph(root, 'leased-work');
      seedRunningBuild(root, created, 'leased-work');

      assert.throws(
        () => acquireExecutionLease(root, 'delivery/leased-work', {
          taskId: 'T-001', ownerId: 'agent-a', tool: 'codex', runId: 'run-a', durationMs: 60_000,
        }),
        scenario.expected,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('recovery abandons only active leases owned by the specified conductor run', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-lease-recovery-'));
  try {
    initProject(root, { name: 'Lease Recovery Test' });
    const created = createIntent(root, { slug: 'leased-work', domain: 'delivery', title: 'Leased Work' });
    seedTaskGraph(root, 'leased-work');
    seedRunningBuild(root, created, 'leased-work');
    acquireExecutionLease(root, 'delivery/leased-work', {
      taskId: 'T-001', ownerId: 'afk-worker', tool: 'codex', runId: 'run-to-recover', durationMs: 60_000,
    });
    const abandoned = abandonExecutionLeasesForRun(root, 'run-to-recover');
    assert.equal(abandoned.length, 1);
    assert.equal(abandoned[0].outcome, 'conductor-recovered');
    assert.equal(listExecutionLeases(root, { activeOnly: true }).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does not silently replace an active intent orchestrator', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-active-owner-'));
  try {
    initProject(root, { name: 'Active Owner Test' });
    createIntent(root, { slug: 'owned-work', domain: 'delivery', title: 'Owned Work' });
    const first = startActiveSession(root, 'delivery/owned-work', {
      ownerId: 'orchestrator-a', tool: 'codex', phaseKey: 'plan', summary: 'Planning.',
    });
    assert.equal(first.session.ownerId, 'orchestrator-a');
    assert.throws(
      () => startActiveSession(root, 'delivery/owned-work', {
        ownerId: 'orchestrator-b', tool: 'claude', phaseKey: 'plan', summary: 'Taking over.',
      }),
      /active session is owned/i,
    );
    finishActiveSession(root, 'delivery/owned-work', { ownerId: 'orchestrator-a', status: 'completed' });
    const second = startActiveSession(root, 'delivery/owned-work', {
      ownerId: 'orchestrator-b', tool: 'claude', phaseKey: 'build', summary: 'Approved handoff.',
    });
    assert.equal(second.session.ownerId, 'orchestrator-b');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
