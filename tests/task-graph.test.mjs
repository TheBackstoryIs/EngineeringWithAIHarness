import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { validateTaskGraph } from '../src/task-graph.mjs';
import { sha256 } from '../src/delivery-documents.mjs';

function validGraph() {
  return {
    schema_version: 1,
    slug: 'safe-alerting',
    status: 'final',
    parent_branch: 'feature/safe-alerting',
    source: {
      claim_ledger: 'gates/plan/claim-ledger.json',
      plan_contract: 'gates/plan/plan-contract.json',
      destination: 'destination.md',
    },
    parallelism: { allowed: true, rationale: 'Independent files.', max_parallel_tasks: 2 },
    afk_waves: [
      { wave: 1, ready_tasks: ['T-001'], parallel_tasks: [], merge_order: ['T-001'], rationale: 'Tracer first.' },
      { wave: 2, ready_tasks: ['T-002', 'T-003'], parallel_tasks: ['T-002', 'T-003'], merge_order: ['T-002', 'T-003'], rationale: 'Disjoint changes.' },
    ],
    tasks: [
      {
        id: 'T-001', slice: 'SLICE-001', name: 'Tracer', issue_kind: 'tracer-bullet', priority: 10,
        parallel_wave: 1, classification: 'AFK', repo: 'App', branch: 'feature/safe-alerting/T-001-tracer',
        depends_on: [], claims: ['CL-001'], user_visible_outcome: 'Visible alert status.',
        read_set: ['src/alerts.mjs'], write_set: ['src/tracer.mjs'], central_writes_allowed: false,
        module_interface_contract: { module: 'alerts', interface: ['dispatch'], behaviour_owned: ['dispatch'], caller_contract: ['returns status'], test_boundary: 'unit' },
        first_failing_test: 'npm test -- tracer', no_first_test_rationale: '',
        red_green_refactor: { red_command: 'npm test -- tracer', expected_red_failure: 'missing tracer', green_command: 'npm test -- tracer', refactor_boundary: 'alerts' },
        allowed_commands: ['npm test -- tracer'], stop_conditions: ['no established pattern fits'], completion_evidence: ['test passes'],
        ralph_loop: { allowed: false, max_iterations: 0, completion_promise: '<promise>T-001 COMPLETE</promise>' },
        review: { fresh_context_required: true, review_tests_first: true, standards_pushed: ['SPECS/4.Constraints/alerts.md'] },
        merge: { orchestrator_owned: true, post_merge_checks: ['npm test'] },
        report_path: 'tasks/T-001/report.md', evidence_path: 'tasks/T-001/evidence.json',
      },
      {
        id: 'T-002', slice: 'SLICE-002', name: 'API', issue_kind: 'feature-slice', priority: 20,
        parallel_wave: 2, classification: 'AFK', repo: 'App', branch: 'feature/safe-alerting/T-002-api',
        depends_on: ['T-001'], claims: ['CL-002'], user_visible_outcome: 'API reports status.',
        read_set: ['src/tracer.mjs'], write_set: ['src/api.mjs'], central_writes_allowed: false,
        module_interface_contract: { module: 'api', interface: ['status'], behaviour_owned: ['status'], caller_contract: ['JSON'], test_boundary: 'integration' },
        first_failing_test: 'npm test -- api', no_first_test_rationale: '',
        red_green_refactor: { red_command: 'npm test -- api', expected_red_failure: 'missing API', green_command: 'npm test -- api', refactor_boundary: 'api' },
        allowed_commands: ['npm test -- api'], stop_conditions: ['pattern conflict discovered'], completion_evidence: ['test passes'],
        ralph_loop: { allowed: false, max_iterations: 0, completion_promise: '<promise>T-002 COMPLETE</promise>' },
        review: { fresh_context_required: true, review_tests_first: true, standards_pushed: ['SPECS/4.Constraints/api.md'] },
        merge: { orchestrator_owned: true, post_merge_checks: ['npm test'] },
        report_path: 'tasks/T-002/report.md', evidence_path: 'tasks/T-002/evidence.json',
      },
      {
        id: 'T-003', slice: 'SLICE-003', name: 'UI', issue_kind: 'feature-slice', priority: 30,
        parallel_wave: 2, classification: 'AFK', repo: 'App', branch: 'feature/safe-alerting/T-003-ui',
        depends_on: ['T-001'], claims: ['CL-003'], user_visible_outcome: 'Operator sees status.',
        read_set: ['src/tracer.mjs'], write_set: ['src/ui.mjs'], central_writes_allowed: false,
        module_interface_contract: { module: 'ui', interface: ['render'], behaviour_owned: ['status view'], caller_contract: ['status prop'], test_boundary: 'component' },
        first_failing_test: 'npm test -- ui', no_first_test_rationale: '',
        red_green_refactor: { red_command: 'npm test -- ui', expected_red_failure: 'missing UI', green_command: 'npm test -- ui', refactor_boundary: 'ui' },
        allowed_commands: ['npm test -- ui'], stop_conditions: ['pattern conflict discovered'], completion_evidence: ['test passes'],
        ralph_loop: { allowed: false, max_iterations: 0, completion_promise: '<promise>T-003 COMPLETE</promise>' },
        review: { fresh_context_required: true, review_tests_first: true, standards_pushed: ['SPECS/4.Constraints/ui.md'] },
        merge: { orchestrator_owned: true, post_merge_checks: ['npm test'] },
        report_path: 'tasks/T-003/report.md', evidence_path: 'tasks/T-003/evidence.json',
      },
    ],
  };
}

function seedSources(root, graph) {
  mkdirSync(resolve(root, 'gates/plan'), { recursive: true });
  const claims = graph.tasks.flatMap((task) => task.claims.map((id) => ({ id, type: 'implementation' })));
  const slices = graph.tasks.map((task) => ({ id: task.slice }));
  writeFileSync(resolve(root, graph.source.claim_ledger), `${JSON.stringify({ implementation_claims: claims, slices }, null, 2)}\n`);
  writeFileSync(resolve(root, graph.source.plan_contract), `${JSON.stringify({ vertical_slices: slices }, null, 2)}\n`);
  writeFileSync(resolve(root, graph.source.destination), '# Destination\n');
}

function seedEvidence(root, task) {
  const evidenceRoot = resolve(root, `tasks/${task.id}/evidence`);
  mkdirSync(evidenceRoot, { recursive: true });
  const commandPath = `tasks/${task.id}/evidence/commands.txt`;
  const reviewPath = `tasks/${task.id}/evidence/review.md`;
  const completionPath = `tasks/${task.id}/evidence/completion.md`;
  writeFileSync(resolve(root, commandPath), 'captured command output\n');
  writeFileSync(resolve(root, reviewPath), '# Review\n\nPass.\n');
  writeFileSync(resolve(root, completionPath), '# Completion\n\nPass.\n');
  const hash = (path) => sha256(Buffer.from(requireEvidence(root, path)));
  writeFileSync(resolve(root, task.evidence_path), `${JSON.stringify({
    schema: 'ewai.task-evidence/v1', task_id: task.id, branch: task.branch, commit: 'abc123',
    changed_files: [task.write_set[0]],
    commands: [
      { stage: 'red', command: task.red_green_refactor.red_command, expected_failure: task.red_green_refactor.expected_red_failure, exit_code: 1, output_path: commandPath, output_sha256: hash(commandPath) },
      { stage: 'green', command: task.red_green_refactor.green_command, exit_code: 0, output_path: commandPath, output_sha256: hash(commandPath) },
      { stage: 'refactor', command: task.red_green_refactor.green_command, exit_code: 0, output_path: commandPath, output_sha256: hash(commandPath) },
    ],
    review: { fresh_context: true, tests_reviewed_first: true, status: 'pass', reviewer: 'independent-test-reviewer', evidence_path: reviewPath, evidence_sha256: hash(reviewPath) },
    completion_checks: task.completion_evidence.map((name) => ({ name, status: 'pass', evidence_path: completionPath, evidence_sha256: hash(completionPath) })),
  }, null, 2)}\n`);
}

function requireEvidence(root, path) {
  return readFileSync(resolve(root, path));
}

function validate(graph) {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-task-graph-'));
  mkdirSync(root, { recursive: true });
  const path = resolve(root, 'task-graph.json');
  writeFileSync(path, `${JSON.stringify(graph, null, 2)}\n`);
  if (graph.source && Array.isArray(graph.tasks)) seedSources(root, graph);
  try {
    return validateTaskGraph(root, { slug: 'safe-alerting' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function completedReport(id = 'T-001') {
  return `# Task Report: ${id}

**Task:** Tracer
**Branch:** \`feature/safe-alerting/${id.toLowerCase()}-tracer\`
**Worker context:** AFK
**Model tier:** implementation
**Concrete model/session:** codex/test
**Sandbox mode:** worktree-only
**Commits:** abc123

## Summary
- Implemented the owned tracer slice.

## Red-green-refactor evidence
| Step | Command | Expected | Actual |
|---|---|---|---|
| Red | \`npm test -- tracer\` | fails | failed before implementation |
| Green | \`npm test -- tracer\` | pass | passed |
| Refactor | \`npm test\` | pass | passed |

## Feedback loops run
- \`npm test\` → pass

## Files changed
- \`src/tracer.mjs\` — implemented the tracer.

## Completion evidence
- Tracer test — pass

## Stop conditions
- Pattern conflict — not hit

## Review notes
- Tests reviewed first: yes
- Fresh-context review: pass

## QA notes
- none
`;
}

test('accepts a complete task graph that safely renders its dependency DAG', () => {
  const result = validate(validGraph());
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.readyTasks, ['T-001']);
  assert.equal(result.errors.length, 0);
});

test('rejects the minimal task graph shape previously accepted by delivery tests', () => {
  const result = validate({ tasks: [{ id: 'T-001', report_path: 'tasks/T-001/report.md' }] });
  assert.equal(result.status, 'fail');
  assert.equal(result.errors.some((error) => error.code === 'task-graph-schema-version'), true);
  assert.equal(result.errors.some((error) => error.code === 'task-incomplete'), true);
});

test('rejects dependency cycles, overlapping parallel writes, and central-file ownership', () => {
  const graph = validGraph();
  graph.tasks[0].depends_on = ['T-003'];
  graph.tasks[2].write_set = ['src/api.mjs', 'SPECS/6.Build/safe-alerting/tracker.md'];
  const result = validate(graph);
  assert.equal(result.status, 'fail');
  assert.equal(result.errors.some((error) => error.code === 'task-dependency-cycle'), true);
  assert.equal(result.errors.some((error) => error.code === 'parallel-write-conflict'), true);
  assert.equal(result.errors.some((error) => error.code === 'central-write-owned-by-worker'), true);
});

test('unlocks dependent tasks only from a complete, reviewed task report', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-task-report-'));
  try {
    const graph = validGraph();
    writeFileSync(resolve(root, 'task-graph.json'), `${JSON.stringify(graph, null, 2)}\n`);
    seedSources(root, graph);
    mkdirSync(resolve(root, 'tasks/T-001'), { recursive: true });
    writeFileSync(resolve(root, 'tasks/T-001/report.md'), '');
    const empty = validateTaskGraph(root, { slug: 'safe-alerting' });
    assert.equal(empty.tasks.find((task) => task.id === 'T-001').report.status, 'incomplete');

    writeFileSync(resolve(root, 'tasks/T-001/report.md'), '# Task Report: T-001\n\n## Summary\n\nPlaceholder.\n');

    const placeholder = validateTaskGraph(root, { slug: 'safe-alerting' });
    assert.equal(placeholder.tasks.find((task) => task.id === 'T-001').status, 'ready');
    assert.equal(placeholder.tasks.find((task) => task.id === 'T-001').report.status, 'incomplete');
    assert.deepEqual(placeholder.readyTasks, ['T-001']);

    writeFileSync(resolve(root, 'tasks/T-001/report.md'), completedReport());
    seedEvidence(root, graph.tasks[0]);
    const completed = validateTaskGraph(root, { slug: 'safe-alerting' });
    assert.equal(completed.tasks.find((task) => task.id === 'T-001').status, 'completed');
    assert.equal(completed.tasks.find((task) => task.id === 'T-001').report.status, 'complete');
    assert.deepEqual(completed.readyTasks, ['T-002', 'T-003']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('requires every task report to be complete at completion gates', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-task-completion-gate-'));
  try {
    const graph = validGraph();
    graph.tasks = [graph.tasks[0]];
    graph.afk_waves = [graph.afk_waves[0]];
    writeFileSync(resolve(root, 'task-graph.json'), `${JSON.stringify(graph, null, 2)}\n`);
    seedSources(root, graph);

    const missing = validateTaskGraph(root, { slug: 'safe-alerting', requireAllTasksCompleted: true });
    assert.equal(missing.status, 'fail');
    assert.equal(missing.errors.some((error) => error.code === 'task-report-incomplete'), true);

    mkdirSync(resolve(root, 'tasks/T-001'), { recursive: true });
    writeFileSync(resolve(root, 'tasks/T-001/report.md'), completedReport());
    seedEvidence(root, graph.tasks[0]);
    const complete = validateTaskGraph(root, { slug: 'safe-alerting', requireAllTasksCompleted: true });
    assert.equal(complete.status, 'pass');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects task claims and slices that are not grounded in planning artefacts', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-task-cross-artifact-'));
  try {
    const graph = validGraph();
    writeFileSync(resolve(root, 'task-graph.json'), `${JSON.stringify(graph, null, 2)}\n`);
    seedSources(root, graph);
    writeFileSync(resolve(root, graph.source.claim_ledger), JSON.stringify({
      implementation_claims: [{ id: 'CL-001', type: 'implementation' }, { id: 'CL-999', type: 'implementation' }],
      slices: [{ id: 'SLICE-001' }],
    }));
    const result = validateTaskGraph(root, { slug: 'safe-alerting' });
    assert.equal(result.status, 'fail');
    assert.equal(result.errors.some((error) => error.code === 'task-claim-unknown'), true);
    assert.equal(result.errors.some((error) => error.code === 'task-claim-unowned'), true);
    assert.equal(result.errors.some((error) => error.code === 'task-slice-not-in-ledger'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does not accept a narrative task report when captured evidence has changed', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-task-tamper-'));
  try {
    const graph = validGraph();
    writeFileSync(resolve(root, 'task-graph.json'), `${JSON.stringify(graph, null, 2)}\n`);
    seedSources(root, graph);
    mkdirSync(resolve(root, 'tasks/T-001'), { recursive: true });
    writeFileSync(resolve(root, 'tasks/T-001/report.md'), completedReport());
    seedEvidence(root, graph.tasks[0]);
    writeFileSync(resolve(root, 'tasks/T-001/evidence/commands.txt'), 'tampered output\n');
    const result = validateTaskGraph(root, { slug: 'safe-alerting' });
    const task = result.tasks.find((item) => item.id === 'T-001');
    assert.equal(task.status, 'ready');
    assert.equal(task.report.status, 'incomplete');
    assert.match(task.report.errors.join(' '), /hash is missing or stale/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects red and green commands that were not explicitly allowed', () => {
  const graph = validGraph();
  graph.tasks[0].allowed_commands = ['npm test -- something-else'];
  const result = validate(graph);
  assert.equal(result.status, 'fail');
  assert.equal(result.errors.some((error) => error.code === 'task-command-not-allowed'), true);
});
