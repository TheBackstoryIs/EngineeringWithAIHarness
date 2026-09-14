import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import YAML from 'yaml';
import { initProject } from '../src/project.mjs';
import { createIntent, updateIntentDeliveryState } from '../src/intents.mjs';
import { listActiveSessions, listWorkItems, readWorkItemView } from '../src/runtime/work.mjs';
import { openRuntimeDatabase } from '../src/runtime/database.mjs';
import { listCommandRuns, markStaleCommandRuns } from '../src/runtime/runs.mjs';
import {
  beginDelivery,
  completeDeliveryPhase,
  continueDelivery,
  phaseGateTemplate,
  previewCompletedEvidenceAmendment,
  ratifyDeliveryAmendments,
  ratifyCompletedEvidenceAmendment,
  readDeliveryState,
  recordBuildApproval,
  recordExternalValidationCycle,
  recordManualQaApproval,
  recordPhaseGate,
  resumeShelvedDelivery,
  startDeliveryPhase
} from '../src/delivery.mjs';
import { requiredPhaseArtefacts, validatePhaseArtefacts, validatePrototypeManifest } from '../src/delivery-artifacts.mjs';
import { sha256 } from '../src/delivery-documents.mjs';
import { readLifecycleHookWorkspace } from '../src/runtime/lifecycle-hooks.mjs';

function promoteIntent(root, path) {
  updateIntentDeliveryState(root, path, { status: 'ready' });
}

function evidenceFor(root, slug, phase) {
  const path = resolve(root, `SPECS/6.Build/${slug}/evidence/${phase}.md`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `# ${phase}\n\nVerified phase evidence.\n`);
  return relative(root, path).replaceAll('\\', '/');
}

function completedTaskReport(slug) {
  return `# Task Report: T-001

**Task:** Canonical test task
**Branch:** \`feature/${slug}/T-001-canonical-test\`
**Worker context:** AFK
**Model tier:** implementation
**Concrete model/session:** codex/test
**Sandbox mode:** worktree-only
**Commits:** abc123

## Summary
- Implemented the canonical test task.

## Red-green-refactor evidence
| Step | Command | Expected | Actual |
|---|---|---|---|
| Red | \`node --test\` | fails | failed before implementation |
| Green | \`node --test\` | pass | passed |
| Refactor | \`node --test\` | pass | passed |

## Feedback loops run
- \`node --test\` → pass

## Files changed
- \`src/canonical-test.mjs\` — implemented the task.

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

function seedCanonicalArtefacts(root, slug, phase) {
  const deliveryRoot = resolve(root, `SPECS/6.Build/${slug}`);
  const graphPath = resolve(deliveryRoot, 'task-graph.json');
  if (!existsSync(graphPath)) {
    mkdirSync(dirname(graphPath), { recursive: true });
    writeFileSync(graphPath, JSON.stringify({
      schema_version: 1,
      slug,
      status: 'final',
      parent_branch: `feature/${slug}`,
      source: {
        claim_ledger: 'gates/plan/claim-ledger.json',
        plan_contract: 'gates/plan/plan-contract.json',
        destination: 'destination.md'
      },
      parallelism: { allowed: false, rationale: 'Canonical sequential test graph.', max_parallel_tasks: 1 },
      afk_waves: [{ wave: 1, ready_tasks: ['T-001'], parallel_tasks: [], merge_order: ['T-001'], rationale: 'Single task.' }],
      tasks: [{
        id: 'T-001',
        slice: 'SLICE-001',
        name: 'Canonical test task',
        issue_kind: 'tracer-bullet',
        priority: 10,
        parallel_wave: 1,
        classification: 'AFK',
        repo: 'TestProject',
        branch: `feature/${slug}/T-001-canonical-test`,
        depends_on: [],
        claims: ['CL-001'],
        user_visible_outcome: 'The delivery contract is verifiable.',
        read_set: ['SPECS/2.Purpose/intents'],
        write_set: ['src/canonical-test.mjs'],
        central_writes_allowed: false,
        module_interface_contract: { module: 'test', interface: ['verify'], behaviour_owned: ['verification'], caller_contract: ['boolean'], test_boundary: 'unit' },
        first_failing_test: 'node --test',
        no_first_test_rationale: '',
        red_green_refactor: { red_command: 'node --test', expected_red_failure: 'contract missing', green_command: 'node --test', refactor_boundary: 'test' },
        allowed_commands: ['node --test'],
        stop_conditions: ['no established pattern fits'],
        completion_evidence: ['tests pass'],
        ralph_loop: { allowed: false, max_iterations: 0, completion_promise: '<promise>T-001 COMPLETE</promise>' },
        review: { fresh_context_required: true, review_tests_first: true, standards_pushed: ['SPECS/pipeline.yaml'] },
        merge: { orchestrator_owned: true, post_merge_checks: ['node --test'] },
        report_path: 'tasks/T-001/report.md',
        evidence_path: 'tasks/T-001/evidence.json'
      }]
    }, null, 2));
  }
  for (const path of requiredPhaseArtefacts(deliveryRoot, phase)) {
    const absolute = resolve(deliveryRoot, path);
    mkdirSync(dirname(absolute), { recursive: true });
    if (existsSync(absolute)) continue;
    writeFileSync(
      absolute,
      path === 'tasks/T-001/report.md'
        ? completedTaskReport(slug)
        : path.endsWith('.json')
        ? '{"status":"pass","tasks":[{"id":"T-001","report_path":"tasks/T-001/report.md"}]}\n'
        : `# ${phase}\n\nCanonical test evidence.\n`
    );
  }
  mkdirSync(resolve(deliveryRoot, 'gates/plan'), { recursive: true });
  writeFileSync(resolve(deliveryRoot, 'gates/plan/claim-ledger.json'), `${JSON.stringify({
    implementation_claims: [{ id: 'CL-001', type: 'implementation' }],
    slices: [{ id: 'SLICE-001' }],
  }, null, 2)}\n`);
  writeFileSync(resolve(deliveryRoot, 'gates/plan/plan-contract.json'), `${JSON.stringify({
    vertical_slices: [{ id: 'SLICE-001' }],
  }, null, 2)}\n`);
  if (!existsSync(resolve(deliveryRoot, 'destination.md'))) writeFileSync(resolve(deliveryRoot, 'destination.md'), '# Destination\n');
  if (phase === 'ui-design') {
    const prototype = resolve(deliveryRoot, 'ui-design-assets/prototypes/selected.html');
    mkdirSync(dirname(prototype), { recursive: true });
    writeFileSync(prototype, '<!doctype html><title>Prototype</title>\n');
    writeFileSync(resolve(deliveryRoot, 'ui-design-assets/prototypes/manifest.json'), `${JSON.stringify({
      schema: 'ewai.prototype-manifest/v1', status: 'selected',
      selected: { title: 'Selected prototype', path: 'ui-design-assets/prototypes/selected.html', decision: 'Best matches the accepted interaction.' },
      registration: { kind: 'prototype', status: 'active', path: 'ui-design-assets/prototypes/selected.html' },
    }, null, 2)}\n`);
  }
  if (['build', 'delivery'].includes(phase)) {
    const outputPath = 'tasks/T-001/evidence/command.txt';
    const reviewPath = 'tasks/T-001/evidence/review.md';
    const completionPath = 'tasks/T-001/evidence/completion.md';
    for (const [path, content] of [[outputPath, 'captured output\n'], [reviewPath, '# Review\n\nPass.\n'], [completionPath, '# Completion\n\nPass.\n']]) {
      mkdirSync(dirname(resolve(deliveryRoot, path)), { recursive: true });
      writeFileSync(resolve(deliveryRoot, path), content);
    }
    const hash = (path) => sha256(readFileSync(resolve(deliveryRoot, path)));
    writeFileSync(resolve(deliveryRoot, 'tasks/T-001/evidence.json'), `${JSON.stringify({
      schema: 'ewai.task-evidence/v1', task_id: 'T-001', branch: `feature/${slug}/T-001-canonical-test`, commit: 'abc123',
      changed_files: ['src/canonical-test.mjs'],
      commands: [
        { stage: 'red', command: 'node --test', expected_failure: 'contract missing', exit_code: 1, output_path: outputPath, output_sha256: hash(outputPath) },
        { stage: 'green', command: 'node --test', exit_code: 0, output_path: outputPath, output_sha256: hash(outputPath) },
        { stage: 'refactor', command: 'node --test', exit_code: 0, output_path: outputPath, output_sha256: hash(outputPath) },
      ],
      review: { fresh_context: true, tests_reviewed_first: true, status: 'pass', reviewer: 'test-reviewer', evidence_path: reviewPath, evidence_sha256: hash(reviewPath) },
      completion_checks: [{ name: 'tests pass', status: 'pass', evidence_path: completionPath, evidence_sha256: hash(completionPath) }],
    }, null, 2)}\n`);
  }
}

function passPhase(root, slug, phase) {
  seedCanonicalArtefacts(root, slug, phase);
  const template = phaseGateTemplate(root, slug, phase);
  const requiredGates = template.required_gates.map((gate) => {
    const evidencePath = evidenceFor(root, slug, `${phase}-${gate.id}`);
    if (['intent-dependency-map-check', 'claim-ledger-check', 'plan-contract-check', 'build-contract-integrity', 'standards-coverage-check'].includes(gate.id)) {
      const sidecar = resolve(root, `SPECS/6.Build/${slug}/gates/${phase}/${gate.id}.json`);
      mkdirSync(dirname(sidecar), { recursive: true });
      writeFileSync(sidecar, '{"status":"pass"}\n');
    }
    return {
      id: gate.id,
      commandOrSkill: `test:${gate.id}`,
      outputPath: evidencePath,
      exitStatus: 0,
      status: 'pass'
    };
  });
  recordPhaseGate(root, slug, phase, {
    status: 'pass',
    honestyCheck: {
      sourceSectionsEdited: true,
      staleTextRemoved: true,
      noAppendOnlyCorrections: true,
      allCodeClaimsCited: true
    },
    requiredGates
  });
  const evidencePath = requiredGates[0].outputPath;
  completeDeliveryPhase(root, slug, phase, { artefactPath: evidencePath });
  return evidencePath;
}

test('begins every intent with a durable fourteen-stage delivery contract', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-delivery-'));
  try {
    initProject(root, { name: 'Delivery Contract Test' });
    const intent = createIntent(root, { slug: 'safe-alerts', domain: 'alerts', title: 'Safe Alerts' });

    const result = beginDelivery(root, 'safe-alerts', {
      tool: 'codex',
      existingCode: true,
      ui: true,
      mode: 'normal'
    });

    assert.equal(result.state.schema, 'ewai.delivery-state/v1');
    assert.equal(result.state.phases.length, 14);
    assert.deepEqual(result.state.phases.map((phase) => phase.id), [
      'ideate', 'intent', 'reconcile', 'plan', 'pattern-validation', 'test-plan',
      'validate-external-plan', 'validate-external-test-plan', 'build',
      'standards-sweep', 'test-execute', 'validate-external-code', 'delivery', 'retro'
    ]);
    assert.equal(result.state.phases.find((phase) => phase.id === 'ideate').status, 'skipped');
    assert.equal(result.state.phases.find((phase) => phase.id === 'intent').status, 'running');
    assert.equal(result.state.phases.find((phase) => phase.id === 'reconcile').status, 'pending');
    assert.equal(result.state.phases.find((phase) => phase.id === 'validate-external-plan').status, 'not-supported');
    assert.equal(result.state.adjuncts.find((phase) => phase.id === 'ui-design').status, 'pending');
    assert.equal(result.state.humanGates.find((gate) => gate.id === 'manual-qa').status, 'pending');
    assert.equal(existsSync(resolve(root, 'SPECS/6.Build/safe-alerts/delivery-state.json')), true);
    assert.equal(existsSync(resolve(root, 'SPECS/6.Build/safe-alerts/tracker.md')), true);
    assert.equal(existsSync(resolve(root, 'SPECS/6.Build/safe-alerts/context-packet.md')), true);
    assert.equal(existsSync(resolve(root, 'SPECS/6.Build/safe-alerts/runs', `${result.run.id}.json`)), true);

    const onDisk = JSON.parse(readFileSync(resolve(root, 'SPECS/6.Build/safe-alerts/delivery-state.json')));
    assert.equal(onDisk.currentPhase, 'intent');
    assert.equal(onDisk.intent.path, relative(root, intent.path).replaceAll('\\', '/'));

    const intentMarkdown = readFileSync(intent.path, 'utf8');
    const intentJson = JSON.parse(readFileSync(intent.path.replace(/\.md$/, '.json'), 'utf8'));
    assert.match(intentMarkdown, /delivery_status: in-progress/);
    assert.match(intentMarkdown, /current_phase: intent/);
    assert.equal(intentJson.deliveryStatus, 'in-progress');
    assert.equal(intentJson.currentPhase, 'intent');

    const item = listWorkItems(root).find((candidate) => candidate.slug === 'safe-alerts');
    assert.equal(item.lane, 'active');
    assert.equal(item.currentPhase, 'intent');
    assert.equal(item.intentState, intentJson.status);
    assert.equal(item.phases.find((phase) => phase.phaseKey === 'intent').status, 'running');
    assert.equal(listActiveSessions(root)[0].slug, 'safe-alerts');
    assert.equal(listCommandRuns(root, 'safe-alerts')[0].run_uuid, result.run.id);
    assert.equal(listCommandRuns(root, 'safe-alerts')[0].status, 'running');
    assert.equal(continueDelivery(root, 'safe-alerts').nextPhase, 'intent');

    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(resolve(root, `.ewai-pipeline/data/pipeline.sqlite${suffix}`), { force: true });
    }
    const rebuiltItem = listWorkItems(root).find((candidate) => candidate.slug === 'safe-alerts');
    assert.equal(rebuiltItem.lane, 'active');
    assert.equal(rebuiltItem.state, 'in-progress');
    assert.equal(rebuiltItem.currentPhase, 'intent');
    assert.equal(rebuiltItem.intentState, intentJson.status);
    assert.equal(listCommandRuns(root, 'safe-alerts')[0].run_uuid, result.run.id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runs the conditional Ideate stage when delivery begins from a rough idea', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-ideate-'));
  try {
    initProject(root, { name: 'Ideate Test' });
    createIntent(root, { slug: 'rough-idea', domain: 'discovery', title: 'Rough Idea' });
    const { state, run } = beginDelivery(root, 'rough-idea', { tool: 'claude', ideate: true });
    assert.equal(state.currentPhase, 'ideate');
    assert.equal(state.phases.find((phase) => phase.id === 'ideate').status, 'running');
    assert.equal(state.phases.find((phase) => phase.id === 'intent').status, 'pending');
    assert.equal(run.phase, 'ideate');
    seedCanonicalArtefacts(root, 'rough-idea', 'ideate');
    passPhase(root, 'rough-idea', 'ideate');
    assert.equal(continueDelivery(root, 'rough-idea').nextPhase, 'intent');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('snapshots independent checkpoint policy and requires passing recorded review cycles', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-validation-cycles-'));
  try {
    initProject(root, {
      name: 'Validation Cycle Test',
      validators: ['claude', 'codex'],
    });
    const intent = createIntent(root, {
      slug: 'validated-change',
      domain: 'quality',
      title: 'Validated Change',
    });
    promoteIntent(root, intent.path);
    const { state } = beginDelivery(root, 'validated-change', {
      tool: 'claude',
      existingCode: false,
    });

    const externalPlan = state.phases.find((phase) => phase.id === 'validate-external-plan');
    assert.deepEqual(externalPlan.validation.providers, ['codex']);
    assert.equal(externalPlan.validation.maxCycles, 2);
    assert.equal(state.validation.orchestrator, 'claude');

    passPhase(root, 'validated-change', 'intent');
    for (const phase of ['plan', 'pattern-validation', 'test-plan']) {
      startDeliveryPhase(root, 'validated-change', phase);
      passPhase(root, 'validated-change', phase);
    }
    startDeliveryPhase(root, 'validated-change', 'validate-external-plan');

    const phaseRoot = resolve(
      root,
      'SPECS/6.Build/validated-change/validate-external-plan',
    );
    mkdirSync(phaseRoot, { recursive: true });
    writeFileSync(
      resolve(phaseRoot, 'round-1-codex-response.md'),
      '# Codex review\n\nOne standards issue remains.\n',
    );
    writeFileSync(
      resolve(phaseRoot, 'round-1-codex-fixes.md'),
      '# Fixes\n\nThe issue was corrected.\n',
    );
    recordExternalValidationCycle(
      root,
      'validated-change',
      'validate-external-plan',
      {
        provider: 'codex',
        outcome: 'issues',
        fixPath: 'validate-external-plan/round-1-codex-fixes.md',
      },
    );

    assert.throws(
      () => passPhase(root, 'validated-change', 'validate-external-plan'),
      /run validation cycle 2 of 2/,
    );

    writeFileSync(
      resolve(phaseRoot, 'round-2-codex-response.md'),
      '# Codex review\n\nPass.\n',
    );
    recordExternalValidationCycle(
      root,
      'validated-change',
      'validate-external-plan',
      {
        provider: 'codex',
        outcome: 'pass',
      },
    );
    completeDeliveryPhase(root, 'validated-change', 'validate-external-plan');

    const completed = readDeliveryState(root, 'validated-change');
    const phase = completed.phases.find((candidate) => candidate.id === 'validate-external-plan');
    assert.equal(phase.status, 'completed');
    assert.equal(phase.iterations, 2);
    assert.deepEqual(
      phase.validation.cycles.map((cycle) => cycle.outcome),
      ['issues', 'pass'],
    );
    const ledger = JSON.parse(readFileSync(resolve(phaseRoot, 'validation-cycles.json')));
    assert.equal(ledger.maxCycles, 2);
    assert.equal(ledger.cycles.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('upgrades legacy flat provider state without treating the orchestrator as independent', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-legacy-validation-'));
  try {
    initProject(root, {
      name: 'Legacy Validation Test',
      validators: ['claude', 'codex'],
    });
    createIntent(root, {
      slug: 'legacy-delivery',
      domain: 'quality',
      title: 'Legacy Delivery',
    });
    beginDelivery(root, 'legacy-delivery', { tool: 'claude' });
    const statePath = resolve(root, 'SPECS/6.Build/legacy-delivery/delivery-state.json');
    const legacy = JSON.parse(readFileSync(statePath, 'utf8'));
    delete legacy.validation;
    legacy.providers = ['claude', 'codex'];
    for (const phase of legacy.phases) delete phase.validation;
    writeFileSync(statePath, `${JSON.stringify(legacy, null, 2)}\n`);

    const migrated = readDeliveryState(root, 'legacy-delivery');
    assert.equal(migrated.validation.migratedFromLegacyState, true);
    assert.equal(migrated.validation.orchestrator, 'claude');
    assert.deepEqual(
      migrated.phases.find((phase) => phase.id === 'validate-external-code').validation.providers,
      ['codex'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('canonicalises a legacy flat Gemini provider before independent-validator matching', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-flat-gemini-validation-'));
  try {
    initProject(root, {
      name: 'Flat Gemini Validation',
      validators: ['antigravity'],
    });
    createIntent(root, {
      slug: 'flat-provider-migration',
      domain: 'quality',
      title: 'Flat Provider Migration',
    });
    beginDelivery(root, 'flat-provider-migration', { tool: 'gemini' });
    const statePath = resolve(root, 'SPECS/6.Build/flat-provider-migration/delivery-state.json');
    const legacy = JSON.parse(readFileSync(statePath, 'utf8'));
    delete legacy.validation;
    legacy.providers = ['gemini', 'unsupported-provider'];
    for (const phase of legacy.phases) delete phase.validation;
    writeFileSync(statePath, `${JSON.stringify(legacy, null, 2)}\n`);

    const migrated = readDeliveryState(root, 'flat-provider-migration');
    assert.equal(migrated.validation.orchestrator, 'antigravity');
    assert.deepEqual(migrated.providers, []);
    const externalCode = migrated.phases.find((phase) => phase.id === 'validate-external-code');
    assert.deepEqual(externalCode.validation.providers, []);
    assert.equal(externalCode.status, 'not-supported');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('migrates a snapshotted Gemini delivery provider to Antigravity', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-gemini-delivery-migration-'));
  try {
    initProject(root, {
      name: 'Gemini Delivery Migration',
      validators: ['antigravity'],
    });
    createIntent(root, {
      slug: 'provider-migration',
      domain: 'quality',
      title: 'Provider Migration',
    });
    beginDelivery(root, 'provider-migration', { tool: 'antigravity' });
    const statePath = resolve(root, 'SPECS/6.Build/provider-migration/delivery-state.json');
    const legacy = JSON.parse(readFileSync(statePath, 'utf8'));
    legacy.validation.orchestrator = 'gemini';
    legacy.validation.providers.gemini = legacy.validation.providers.antigravity;
    delete legacy.validation.providers.antigravity;
    legacy.providers = ['gemini'];
    for (const checkpoint of Object.values(legacy.validation.checkpoints)) {
      checkpoint.validators = ['gemini'];
    }
    for (const phase of legacy.phases) {
      if (phase.validation) phase.validation.providers = ['gemini'];
    }
    writeFileSync(statePath, `${JSON.stringify(legacy, null, 2)}\n`);

    const migrated = readDeliveryState(root, 'provider-migration');
    assert.equal(migrated.validation.orchestrator, 'antigravity');
    assert.equal('gemini' in migrated.validation.providers, false);
    assert.deepEqual(migrated.providers, []);
    const externalCode = migrated.phases.find((phase) => phase.id === 'validate-external-code');
    assert.deepEqual(externalCode.validation.providers, []);
    assert.equal(externalCode.status, 'not-supported');
    assert.match(externalCode.statusReason, /No independent external validator/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('preserves authored Context Packet decisions while refreshing managed phase state', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-context-packet-'));
  try {
    initProject(root, { name: 'Context Packet Test' });
    const intent = createIntent(root, { slug: 'durable-context', domain: 'quality', title: 'Durable Context' });
    promoteIntent(root, intent.path);
    beginDelivery(root, 'durable-context', { tool: 'codex' });
    const contextPath = resolve(root, 'SPECS/6.Build/durable-context/context-packet.md');
    const authored = readFileSync(contextPath, 'utf8').replace(
      '| — | No durable decisions recorded yet | — | — | — |',
      '| D-001 | Preserve operator context | Intent | Avoid knowledge loss | Reversible |'
    );
    writeFileSync(contextPath, authored);
    passPhase(root, 'durable-context', 'intent');
    const updated = readFileSync(contextPath, 'utf8');
    assert.match(updated, /Preserve operator context/);
    assert.match(updated, /\*\*Current phase:\*\* plan/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rolls committed state files back when the SQLite projection rejects a transition', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-transition-rollback-'));
  try {
    initProject(root, { name: 'Transition Rollback Test' });
    const intent = createIntent(root, { slug: 'rollback-safe', domain: 'quality', title: 'Rollback Safe' });
    promoteIntent(root, intent.path);
    beginDelivery(root, 'rollback-safe', { tool: 'codex' });
    passPhase(root, 'rollback-safe', 'intent');
    const paths = [
      intent.path,
      intent.path.replace(/\.md$/, '.json'),
      resolve(root, 'SPECS/6.Build/rollback-safe/delivery-state.json'),
      resolve(root, 'SPECS/6.Build/rollback-safe/tracker.md'),
      resolve(root, 'SPECS/6.Build/rollback-safe/context-packet.md')
    ];
    const before = new Map(paths.map((path) => [path, readFileSync(path, 'utf8')]));
    const database = openRuntimeDatabase(root);
    database.exec(`
      CREATE TRIGGER reject_phase_projection
      BEFORE UPDATE OF current_phase ON work_items
      WHEN NEW.current_phase <> OLD.current_phase
      BEGIN SELECT RAISE(ABORT, 'forced projection failure'); END;
    `);
    database.close();
    assert.throws(() => startDeliveryPhase(root, 'rollback-safe', 'plan'), /forced projection failure/i);
    for (const path of paths) assert.equal(readFileSync(path, 'utf8'), before.get(path));
    const check = openRuntimeDatabase(root);
    assert.equal(check.prepare("SELECT current_phase FROM work_items WHERE slug = 'rollback-safe'").get().current_phase, 'plan');
    check.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('marks abandoned command runs stale in durable JSON and SQLite together', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-stale-run-'));
  try {
    initProject(root, { name: 'Stale Run Test' });
    createIntent(root, { slug: 'stale-work', domain: 'operations', title: 'Stale Work' });
    const { run } = beginDelivery(root, 'stale-work', { tool: 'claude' });
    const path = resolve(root, `SPECS/6.Build/stale-work/runs/${run.id}.json`);
    const durable = JSON.parse(readFileSync(path, 'utf8'));
    durable.startedAt = '2020-01-01T00:00:00.000Z';
    writeFileSync(path, `${JSON.stringify(durable, null, 2)}\n`);
    const marked = markStaleCommandRuns(root, { hours: 1 });
    assert.equal(marked.count, 1);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).status, 'stale');
    assert.equal(listCommandRuns(root, 'stale-work')[0].status, 'stale');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses skipped phases and will not complete a phase without fresh JSON gate evidence', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-delivery-gates-'));
  try {
    initProject(root, { name: 'Delivery Gate Test' });
    const intent = createIntent(root, { slug: 'reliable-dispatch', domain: 'alerts', title: 'Reliable Dispatch' });
    beginDelivery(root, 'reliable-dispatch', { tool: 'claude', existingCode: true, ui: false });

    assert.throws(
      () => startDeliveryPhase(root, 'reliable-dispatch', 'plan'),
      /next required phase is intent/i
    );
    assert.throws(
      () => completeDeliveryPhase(root, 'reliable-dispatch', 'intent'),
      /ready or approved/i
    );

    promoteIntent(root, intent.path);
    const intentEvidence = relative(root, intent.path).replaceAll('\\', '/');
    const gatedEvidence = passPhase(root, 'reliable-dispatch', 'intent');

    assert.equal(continueDelivery(root, 'reliable-dispatch').nextPhase, 'reconcile');
    assert.throws(
      () => startDeliveryPhase(root, 'reliable-dispatch', 'plan'),
      /next required phase is reconcile/i
    );

    const gate = JSON.parse(readFileSync(resolve(root, 'SPECS/6.Build/reliable-dispatch/gates/intent/gate-ledger.json')));
    writeFileSync(resolve(root, gatedEvidence), `${readFileSync(resolve(root, gatedEvidence), 'utf8')}\nchanged after gate\n`);
    assert.throws(
      () => startDeliveryPhase(root, 'reliable-dispatch', 'reconcile'),
      /EWAI deterministic gate check/i
    );
    assert.equal(gate.required_gates[0].evidence_hash.length, 64);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses a passing ledger when canonical phase artefacts are missing', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-delivery-artefacts-'));
  try {
    initProject(root, { name: 'Delivery Artefact Test' });
    const intent = createIntent(root, { slug: 'complete-evidence', domain: 'quality', title: 'Complete Evidence' });
    promoteIntent(root, intent.path);
    beginDelivery(root, 'complete-evidence', { tool: 'codex', existingCode: false });
    seedCanonicalArtefacts(root, 'complete-evidence', 'intent');
    const template = phaseGateTemplate(root, 'complete-evidence', 'intent');
    const requiredGates = template.required_gates.map((gate) => ({
      id: gate.id,
      commandOrSkill: `test:${gate.id}`,
      outputPath: evidenceFor(root, 'complete-evidence', `intent-${gate.id}`),
      exitStatus: 0,
      status: 'pass'
    }));
    recordPhaseGate(root, 'complete-evidence', 'intent', {
      status: 'pass',
      honestyCheck: {
        sourceSectionsEdited: true,
        staleTextRemoved: true,
        noAppendOnlyCorrections: true,
        allCodeClaimsCited: true
      },
      requiredGates
    });
    rmSync(resolve(root, 'SPECS/6.Build/complete-evidence/intent-summary.md'));
    assert.throws(
      () => completeDeliveryPhase(root, 'complete-evidence', 'intent'),
      /missing canonical delivery artefacts/i
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects empty, escaping, and directory task-report artefact paths', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-task-reports-'));
  try {
    const deliveryRoot = resolve(root, 'SPECS/6.Build/task-paths');
    mkdirSync(deliveryRoot, { recursive: true });
    writeFileSync(resolve(deliveryRoot, 'task-graph.json'), JSON.stringify({
      tasks: [{ id: '' }, { id: 'T-002', report_path: '../escape.md' }, { id: 'T-003', report_path: 'tasks/T-003/report.md' }]
    }));
    mkdirSync(resolve(deliveryRoot, 'tasks/T-003/report.md'), { recursive: true });
    assert.throws(
      () => validatePhaseArtefacts(deliveryRoot, 'build'),
      /missing canonical delivery artefacts/i
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses a passing Plan gate when the task graph is only a narrative placeholder', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-task-gate-'));
  try {
    initProject(root, { name: 'Task Gate Test' });
    const intent = createIntent(root, { slug: 'unsafe-graph', domain: 'delivery', title: 'Unsafe Graph' });
    promoteIntent(root, intent.path);
    beginDelivery(root, 'unsafe-graph', { tool: 'codex' });
    const deliveryRoot = resolve(root, 'SPECS/6.Build/unsafe-graph');
    writeFileSync(resolve(deliveryRoot, 'task-graph.json'), '{"tasks":[{"id":"T-001"}]}\n');
    assert.throws(
      () => recordPhaseGate(root, 'unsafe-graph', 'plan', {
        status: 'pass',
        honestyCheck: { sourceSectionsEdited: true, staleTextRemoved: true, noAppendOnlyCorrections: true, allCodeClaimsCited: true },
        requiredGates: [],
      }),
      /deterministic task-graph validation/i,
    );
    const check = JSON.parse(readFileSync(resolve(deliveryRoot, 'gates/plan/task-graph-check.json')));
    assert.equal(check.status, 'fail');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('enforces the human Build approval boundary after every required pre-Build phase', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-build-approval-'));
  try {
    initProject(root, { name: 'Build Approval Test' });
    const intent = createIntent(root, { slug: 'safe-change', domain: 'platform', title: 'Safe Change' });
    promoteIntent(root, intent.path);
    beginDelivery(root, 'safe-change', { tool: 'codex', existingCode: true, ui: false, mode: 'normal' });

    passPhase(root, 'safe-change', 'intent');

    for (const phase of ['reconcile', 'plan', 'pattern-validation', 'test-plan']) {
      startDeliveryPhase(root, 'safe-change', phase);
      passPhase(root, 'safe-change', phase);
    }

    assert.equal(continueDelivery(root, 'safe-change').nextPhase, 'build');
    assert.throws(
      () => startDeliveryPhase(root, 'safe-change', 'build'),
      /explicit Build approval/i
    );

    const approval = recordBuildApproval(root, 'safe-change', {
      approvedBy: 'Andre Boyle',
      decision: 'approved',
      scope: 'Approved plan and test plan only.'
    });
    assert.equal(approval.schema, 'ewai.build-approval/v1');
    assert.equal(approval.securityPolicy.schema, 'ewai.security-policy-snapshot/v1');
    assert.equal(approval.securityPolicy.policy.status, 'not-configured');
    assert.equal(existsSync(resolve(root, 'SPECS/6.Build/safe-change/gates/build/build-approval.json')), true);

    const started = startDeliveryPhase(root, 'safe-change', 'build');
    assert.equal(started.currentPhase, 'build');
    assert.equal(readDeliveryState(root, 'safe-change').phases.find((phase) => phase.id === 'build').status, 'running');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('revalidates and durably ratifies amended pre-Build gate evidence before approval', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-build-ratification-'));
  try {
    initProject(root, { name: 'Build Ratification Test' });
    const intent = createIntent(root, { slug: 'amended-change', domain: 'platform', title: 'Amended Change' });
    promoteIntent(root, intent.path);
    beginDelivery(root, 'amended-change', { tool: 'codex', existingCode: true, ui: false, mode: 'normal' });

    passPhase(root, 'amended-change', 'intent');
    for (const phase of ['reconcile', 'plan', 'pattern-validation', 'test-plan']) {
      startDeliveryPhase(root, 'amended-change', phase);
      passPhase(root, 'amended-change', phase);
    }

    const deliveryRoot = resolve(root, 'SPECS/6.Build/amended-change');
    const planLedgerPath = resolve(deliveryRoot, 'gates/plan/gate-ledger.json');
    const originalLedger = JSON.parse(readFileSync(planLedgerPath, 'utf8'));
    const amendedEvidence = resolve(deliveryRoot, originalLedger.required_gates[1].output_path);
    writeFileSync(amendedEvidence, '# amended evidence\n\nHuman-approved correction.\n');
    recordPhaseGate(root, 'amended-change', 'plan', {
      status: 'pass',
      honestyCheck: {
        sourceSectionsEdited: true,
        staleTextRemoved: true,
        noAppendOnlyCorrections: true,
        allCodeClaimsCited: true,
      },
      requiredGates: originalLedger.required_gates
        .filter((gate) => gate.id !== 'task-graph-check')
        .map((gate) => ({
          id: gate.id,
          commandOrSkill: gate.command_or_skill,
          outputPath: relative(root, resolve(deliveryRoot, gate.output_path)).replaceAll('\\', '/'),
          exitStatus: 0,
          status: 'pass',
        })),
    });

    assert.throws(() => continueDelivery(root, 'amended-change'), /gate ledger changed after completion/i);
    assert.throws(
      () => ratifyDeliveryAmendments(root, 'amended-change', { decision: 'approved' }),
      /approving person or role/i,
    );

    const ratification = ratifyDeliveryAmendments(root, 'amended-change', {
      decision: 'approved',
      approvedBy: 'Andre Boyle',
      scope: 'Corrected provider and disclaimer contracts.',
    });
    assert.equal(ratification.schema, 'ewai.delivery-amendment-ratification/v1');
    assert.deepEqual(ratification.changes.map((change) => change.phase), ['plan']);
    assert.equal(
      existsSync(resolve(deliveryRoot, 'gates/build/pre-build-amendment-ratification.json')),
      true,
    );
    assert.equal(continueDelivery(root, 'amended-change').nextPhase, 'build');
    assert.doesNotThrow(() => recordBuildApproval(root, 'amended-change', {
      approvedBy: 'Andre Boyle',
      decision: 'approved',
      scope: 'Ratified plan and test plan.',
    }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function completedBuildWithEvidence(root, slug) {
  initProject(root, { name: `Evidence Amendment ${slug}` });
  const intent = createIntent(root, { slug, domain: 'platform', title: 'Evidence Amendment Test' });
  promoteIntent(root, intent.path);
  beginDelivery(root, slug, { tool: 'codex', existingCode: true, ui: false, mode: 'normal' });
  passPhase(root, slug, 'intent');
  for (const phase of ['reconcile', 'plan', 'pattern-validation', 'test-plan']) {
    startDeliveryPhase(root, slug, phase);
    passPhase(root, slug, phase);
  }
  recordBuildApproval(root, slug, {
    approvedBy: 'Andre Boyle',
    decision: 'approved',
    scope: 'Canonical evidence amendment test build.',
  });
  startDeliveryPhase(root, slug, 'build');
  passPhase(root, slug, 'build');
  const deliveryRoot = resolve(root, `SPECS/6.Build/${slug}`);
  const ledgerPath = resolve(deliveryRoot, 'gates/build/gate-ledger.json');
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const item = ledger.required_gates.find((gate) => gate.id === 'claim-ledger-check');
  const evidencePath = resolve(deliveryRoot, item.output_path);
  return { deliveryRoot, ledgerPath, evidencePath, item };
}

test('previews and ratifies changed completed-phase evidence without changing phase authority', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-completed-evidence-'));
  try {
    const slug = 'corrected-evidence';
    const { deliveryRoot, evidencePath, item } = completedBuildWithEvidence(root, slug);
    const beforeStateBytes = readFileSync(resolve(deliveryRoot, 'delivery-state.json'));
    const beforeState = JSON.parse(beforeStateBytes);
    const beforeOperational = readWorkItemView(root, `platform/${slug}`);

    writeFileSync(evidencePath, '# corrected evidence\n\nFresh standards result.\n');
    assert.throws(() => startDeliveryPhase(root, slug, 'standards-sweep'), /deterministic gate check/i);

    const preview = previewCompletedEvidenceAmendment(root, slug);
    assert.equal(preview.schema, 'ewai.completed-evidence-amendment-preview/v1');
    assert.equal(preview.status, 'changes-found');
    assert.equal(preview.deliveryStateSha256, sha256(beforeStateBytes));
    assert.match(preview.stateSha256, /^[a-f0-9]{64}$/);
    assert.equal(preview.phases.length, 1);
    assert.equal(preview.phases[0].phase, 'build');
    assert.equal(preview.phases[0].evidenceChanges[0].gateId, item.id);
    assert.equal(preview.phases[0].evidenceChanges[0].path, item.output_path);
    assert.equal(preview.phases[0].evidenceChanges[0].previousSha256, item.evidence_hash);
    assert.equal(preview.phases[0].evidenceChanges[0].currentSha256, sha256(readFileSync(evidencePath)));
    assert.doesNotMatch(JSON.stringify(preview), /Fresh standards result/);
    assert.doesNotMatch(JSON.stringify(preview), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.deepEqual(readDeliveryState(root, slug), beforeState);

    assert.throws(
      () => ratifyCompletedEvidenceAmendment(root, slug, {}),
      /explicit confirmation/i,
    );
    assert.throws(
      () => ratifyCompletedEvidenceAmendment(root, slug, {
        confirmed: true,
        approvedBy: 'Andre Boyle',
        reason: 'Ratify the refreshed standards result.',
        expectedStateDigest: '0'.repeat(64),
      }),
      /state digest changed/i,
    );

    const result = ratifyCompletedEvidenceAmendment(root, slug, {
      confirmed: true,
      approvedBy: 'Andre Boyle',
      reason: 'Ratify the refreshed standards result.',
      expectedStateDigest: preview.stateSha256,
    });
    assert.equal(result.action, 'ratified');
    assert.equal(result.receipt.schema, 'ewai.completed-evidence-amendment/v1');
    assert.equal(result.receipt.changes[0].phase, 'build');
    assert.equal(existsSync(resolve(deliveryRoot, result.receiptPath)), true);

    const afterState = readDeliveryState(root, slug);
    assert.deepEqual(
      afterState.phases.map(({ status, startedAt, completedAt }) => ({ status, startedAt, completedAt })),
      beforeState.phases.map(({ status, startedAt, completedAt }) => ({ status, startedAt, completedAt })),
    );
    assert.equal(afterState.currentPhase, beforeState.currentPhase);
    assert.deepEqual(afterState.approvals, beforeState.approvals);
    assert.deepEqual(afterState.humanGates, beforeState.humanGates);
    assert.equal(afterState.evidenceAmendments.length, 1);
    assert.notEqual(
      afterState.phases.find((phase) => phase.id === 'build').gateSha256,
      beforeState.phases.find((phase) => phase.id === 'build').gateSha256,
    );
    assert.equal(readWorkItemView(root, `platform/${slug}`).item.currentPhase, beforeOperational.item.currentPhase);
    assert.doesNotThrow(() => startDeliveryPhase(root, slug, 'standards-sweep'));

    const replay = ratifyCompletedEvidenceAmendment(root, slug, {
      confirmed: true,
      approvedBy: 'Andre Boyle',
      reason: 'Ratify the refreshed standards result.',
      expectedStateDigest: preview.stateSha256,
    });
    assert.equal(replay.action, 'replayed');
    assert.equal(replay.receiptPath, result.receiptPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('completed evidence ratification rejects direct ledger edits and restores interrupted writes', () => {
  const directRoot = mkdtempSync(resolve(tmpdir(), 'ewai-completed-ledger-edit-'));
  const forgedRoot = mkdtempSync(resolve(tmpdir(), 'ewai-completed-evidence-forged-'));
  const rollbackRoot = mkdtempSync(resolve(tmpdir(), 'ewai-completed-evidence-rollback-'));
  try {
    const direct = completedBuildWithEvidence(directRoot, 'direct-ledger-edit');
    const ledger = JSON.parse(readFileSync(direct.ledgerPath, 'utf8'));
    ledger.honesty_check.notes = 'Manually changed ledger.';
    writeFileSync(direct.ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
    assert.throws(
      () => previewCompletedEvidenceAmendment(directRoot, 'direct-ledger-edit'),
      /ledger changed directly/i,
    );

    const forged = completedBuildWithEvidence(forgedRoot, 'forged-receipt');
    writeFileSync(forged.evidencePath, '# corrected evidence\n');
    const forgedPreview = previewCompletedEvidenceAmendment(forgedRoot, 'forged-receipt');
    const forgedAuthority = {
      schema: 'ewai.completed-evidence-amendment-authority/v1',
      slug: 'forged-receipt',
      expectedStateDigest: forgedPreview.stateSha256,
      approvedBy: 'Andre Boyle',
      reason: 'Reject an unrecorded receipt.',
    };
    const forgedReceiptId = sha256(Buffer.from(JSON.stringify(forgedAuthority)));
    const forgedReceiptRoot = resolve(forged.deliveryRoot, 'evidence-amendments');
    mkdirSync(forgedReceiptRoot);
    writeFileSync(resolve(forgedReceiptRoot, `${forgedReceiptId}.json`), `${JSON.stringify({
      schema: 'ewai.completed-evidence-amendment/v1',
      slug: 'forged-receipt',
      approvedBy: forgedAuthority.approvedBy,
      reason: forgedAuthority.reason,
      expectedStateDigest: forgedAuthority.expectedStateDigest,
      changes: forgedPreview.phases,
    }, null, 2)}\n`);
    assert.throws(
      () => ratifyCompletedEvidenceAmendment(forgedRoot, 'forged-receipt', {
        confirmed: true,
        approvedBy: forgedAuthority.approvedBy,
        reason: forgedAuthority.reason,
        expectedStateDigest: forgedAuthority.expectedStateDigest,
      }),
      /does not match the supplied authority/i,
    );

    const rollback = completedBuildWithEvidence(rollbackRoot, 'rollback-correction');
    const statePath = resolve(rollback.deliveryRoot, 'delivery-state.json');
    const originalState = readFileSync(statePath);
    const originalLedger = readFileSync(rollback.ledgerPath);
    const beforeDatabase = openRuntimeDatabase(rollbackRoot);
    const originalOperational = {
      item: beforeDatabase.prepare("SELECT * FROM work_items WHERE id = 'platform/rollback-correction'").get(),
      phases: beforeDatabase.prepare("SELECT * FROM pipeline_phases WHERE work_item_id = 'platform/rollback-correction' ORDER BY phase_key").all(),
    };
    beforeDatabase.close();
    writeFileSync(rollback.evidencePath, '# corrected evidence\n');
    const preview = previewCompletedEvidenceAmendment(rollbackRoot, 'rollback-correction');

    assert.throws(
      () => ratifyCompletedEvidenceAmendment(rollbackRoot, 'rollback-correction', {
        confirmed: true,
        approvedBy: 'Andre Boyle',
        reason: 'Exercise transactional recovery.',
        expectedStateDigest: preview.stateSha256,
        afterAmendmentFilesWritten() {
          throw new Error('injected amendment interruption');
        },
      }),
      /injected amendment interruption/i,
    );
    assert.deepEqual(readFileSync(statePath), originalState);
    assert.deepEqual(readFileSync(rollback.ledgerPath), originalLedger);
    const afterDatabase = openRuntimeDatabase(rollbackRoot);
    const restoredOperational = {
      item: afterDatabase.prepare("SELECT * FROM work_items WHERE id = 'platform/rollback-correction'").get(),
      phases: afterDatabase.prepare("SELECT * FROM pipeline_phases WHERE work_item_id = 'platform/rollback-correction' ORDER BY phase_key").all(),
    };
    afterDatabase.close();
    assert.deepEqual(restoredOperational, originalOperational);
    assert.equal(existsSync(resolve(rollback.deliveryRoot, 'evidence-amendments')), false);
  } finally {
    rmSync(directRoot, { recursive: true, force: true });
    rmSync(forgedRoot, { recursive: true, force: true });
    rmSync(rollbackRoot, { recursive: true, force: true });
  }
});

test('shelves before Build and mandates FitCheck on resume', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-shelf-resume-'));
  try {
    initProject(root, { name: 'Shelf Resume Test' });
    const intent = createIntent(root, { slug: 'shelved-change', domain: 'platform', title: 'Shelved Change' });
    promoteIntent(root, intent.path);
    beginDelivery(root, 'shelved-change', { tool: 'claude', existingCode: false, ui: false, mode: 'shelf' });

    passPhase(root, 'shelved-change', 'intent');
    for (const phase of ['plan', 'pattern-validation']) {
      startDeliveryPhase(root, 'shelved-change', phase);
      passPhase(root, 'shelved-change', phase);
    }
    startDeliveryPhase(root, 'shelved-change', 'test-plan');
    writeFileSync(resolve(root, 'SPECS/6.Build/shelved-change/plan-fingerprint.json'), JSON.stringify({
      captured_at: new Date().toISOString(),
      captured_by_phase: 'TestPlan',
      config_version: 1,
      run_mode: 'shelf',
      branch_strategy: 'no-build-branches',
      build_branch_name: 'feature/shelved-change',
      build_branches_created: false,
      repos: {},
      files: [],
      migrations_head: null,
      enum_groups_referenced: [],
      adrs_referenced: []
    }, null, 2));
    passPhase(root, 'shelved-change', 'test-plan');

    const shelf = continueDelivery(root, 'shelved-change');
    assert.equal(shelf.status, 'shelf-ready');
    assert.equal(shelf.nextPhase, 'fit-check');
    assert.equal(shelf.requiresResume, true);
    const shelvedRun = listCommandRuns(root, 'shelved-change')[0];
    assert.equal(shelvedRun.status, 'shelf-ready');
    assert.equal(JSON.parse(readFileSync(resolve(root, `SPECS/6.Build/shelved-change/runs/${shelvedRun.run_uuid}.json`))).status, 'shelf-ready');
    assert.throws(() => startDeliveryPhase(root, 'shelved-change', 'build'), /resume through FitCheck/i);
    assert.throws(
      () => recordBuildApproval(root, 'shelved-change', {
        decision: 'approved',
        approvedBy: 'Test owner'
      }),
      /active delivery/i
    );

    const resumed = resumeShelvedDelivery(root, 'shelved-change', { tool: 'codex' });
    assert.equal(resumed.state.currentPhase, 'fit-check');
    assert.equal(resumed.state.adjuncts.find((phase) => phase.id === 'fit-check').status, 'pending');
    assert.equal(listCommandRuns(root, 'shelved-change')[0].run_uuid, resumed.run.id);
    startDeliveryPhase(root, 'shelved-change', 'fit-check');
    passPhase(root, 'shelved-change', 'fit-check');
    assert.equal(continueDelivery(root, 'shelved-change').nextPhase, 'build');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dry-run completion cannot be converted into Build approval', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-dry-run-'));
  try {
    initProject(root, { name: 'Dry Run Test' });
    const intent = createIntent(root, { slug: 'dry-change', domain: 'platform', title: 'Dry Change' });
    promoteIntent(root, intent.path);
    beginDelivery(root, 'dry-change', { tool: 'codex', existingCode: false, ui: false, mode: 'dry-run' });
    passPhase(root, 'dry-change', 'intent');
    for (const phase of ['plan', 'pattern-validation', 'test-plan']) {
      startDeliveryPhase(root, 'dry-change', phase);
      passPhase(root, 'dry-change', phase);
    }

    const state = readDeliveryState(root, 'dry-change');
    assert.equal(state.status, 'validated-not-for-build');
    assert.equal(state.currentPhase, 'complete-dry-run');
    assert.throws(
      () => recordBuildApproval(root, 'dry-change', {
        decision: 'approved',
        approvedBy: 'Test owner'
      }),
      /active delivery/i
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('projects Manual QA exactly and completes the full fourteen-stage lifecycle through Retro', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-full-lifecycle-'));
  try {
    initProject(root, { name: 'Full Lifecycle Test' });
    const intent = createIntent(root, {
      slug: 'complete-cycle',
      domain: 'platform',
      title: 'Complete Cycle',
      personas: ['ewai.core.end-user:primary:3', 'ewai.premium.product-owner:consulted:4'],
    });
    promoteIntent(root, intent.path);
    beginDelivery(root, 'complete-cycle', { tool: 'codex' });
    passPhase(root, 'complete-cycle', 'intent');
    for (const phase of ['plan', 'pattern-validation', 'test-plan']) {
      startDeliveryPhase(root, 'complete-cycle', phase);
      passPhase(root, 'complete-cycle', phase);
    }
    recordBuildApproval(root, 'complete-cycle', {
      decision: 'approved',
      approvedBy: 'Test owner',
      scope: 'Approved test lifecycle.'
    });
    for (const phase of ['build', 'standards-sweep', 'test-execute', 'delivery']) {
      startDeliveryPhase(root, 'complete-cycle', phase);
      passPhase(root, 'complete-cycle', phase);
    }
    const paused = readDeliveryState(root, 'complete-cycle');
    assert.equal(paused.currentPhase, 'manual-qa');
    assert.equal(paused.status, 'paused-awaiting-manual-qa');
    const beforeApproval = listWorkItems(root).find((item) => item.slug === 'complete-cycle');
    assert.equal(beforeApproval.lane, 'qa');
    assert.equal(beforeApproval.state, 'paused-awaiting-manual-qa');
    assert.equal(beforeApproval.phases.find((phase) => phase.phaseKey === 'manual-qa').status, 'running');

    const qaEvidence = evidenceFor(root, 'complete-cycle', 'manual-qa-owner-evidence');
    recordManualQaApproval(root, 'complete-cycle', {
      decision: 'approved',
      approvedBy: 'Test owner',
      evidencePath: qaEvidence
    });
    const afterApproval = listWorkItems(root).find((item) => item.slug === 'complete-cycle');
    const qaPhase = afterApproval.phases.find((phase) => phase.phaseKey === 'manual-qa');
    assert.equal(qaPhase.status, 'approved');
    assert.equal(Boolean(qaPhase.completedAt), true);
    assert.equal(afterApproval.currentPhase, 'retro');

    startDeliveryPhase(root, 'complete-cycle', 'retro');
    passPhase(root, 'complete-cycle', 'retro');
    const completed = readDeliveryState(root, 'complete-cycle');
    assert.equal(completed.status, 'completed');
    assert.equal(completed.currentPhase, 'complete');
    assert.match(readFileSync(intent.path, 'utf8'), /status: delivered/);
    const lifecycle = readLifecycleHookWorkspace(root);
    const eventNames = lifecycle.events.map((event) => event.name);
    assert.equal(eventNames.includes('ewai.delivery.build.approved'), true);
    assert.equal(eventNames.includes('ewai.delivery.manual-qa.approved'), true);
    assert.equal(eventNames.includes('ewai.delivery.completed'), true);
    assert.equal(eventNames.includes('ewai.delivery.release-ready'), true);
    assert.equal(eventNames.filter((name) => name === 'ewai.delivery.phase.entered').length, 9);
    assert.equal(eventNames.filter((name) => name === 'ewai.delivery.phase.completed').length, 9);
    const releaseReady = lifecycle.events.find((event) => event.name === 'ewai.delivery.release-ready');
    assert.equal(releaseReady.personas.some((persona) => persona.tier === 'premium'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('preserves Manual QA approval while configured missing security evidence withholds release-ready publication', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-security-release-gate-'));
  try {
    initProject(root, { name: 'Security Release Gate Test' });
    const configPath = resolve(root, 'SPECS/pipeline.yaml');
    const config = YAML.parse(readFileSync(configPath, 'utf8'));
    config.security_validation = { enabled: true, profiles: [{
      id: 'source', capability: 'source-static', required: true, freshness_hours: 24,
      timeout_seconds: 60, accountable_role: 'Security Lead', modes: ['artifact-import'], provider: 'deepsec',
    }] };
    writeFileSync(configPath, YAML.stringify(config, { lineWidth: 0 }));
    const intent = createIntent(root, { slug: 'security-gated-cycle', domain: 'platform', title: 'Security Gated Cycle' });
    promoteIntent(root, intent.path);
    beginDelivery(root, 'security-gated-cycle', { tool: 'codex' });
    passPhase(root, 'security-gated-cycle', 'intent');
    for (const phase of ['plan', 'pattern-validation', 'test-plan']) {
      startDeliveryPhase(root, 'security-gated-cycle', phase);
      passPhase(root, 'security-gated-cycle', phase);
    }
    recordBuildApproval(root, 'security-gated-cycle', { decision: 'approved', approvedBy: 'Test owner', scope: 'Approved.' });
    for (const phase of ['build', 'standards-sweep', 'test-execute', 'delivery']) {
      startDeliveryPhase(root, 'security-gated-cycle', phase);
      passPhase(root, 'security-gated-cycle', phase);
    }
    const approval = recordManualQaApproval(root, 'security-gated-cycle', {
      decision: 'approved', approvedBy: 'Test owner',
      evidencePath: evidenceFor(root, 'security-gated-cycle', 'manual-qa-owner-evidence'),
    });
    assert.equal(approval.releaseReadiness.status, 'blocked');
    assert.equal(readDeliveryState(root, 'security-gated-cycle').humanGates.find((gate) => gate.id === 'manual-qa').status, 'approved');
    assert.equal(readLifecycleHookWorkspace(root).events.some((event) => event.name === 'ewai.delivery.release-ready'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('blocks release readiness when the approved Build security policy is later changed', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-security-policy-snapshot-'));
  try {
    initProject(root, { name: 'Security Policy Snapshot Test' });
    const configPath = resolve(root, 'SPECS/pipeline.yaml');
    const config = YAML.parse(readFileSync(configPath, 'utf8'));
    config.security_validation = { enabled: true, profiles: [{
      id: 'source', capability: 'source-static', required: true, freshness_hours: 24,
      timeout_seconds: 60, accountable_role: 'Security Lead', modes: ['artifact-import'], provider: 'deepsec',
    }] };
    writeFileSync(configPath, YAML.stringify(config, { lineWidth: 0 }));
    const intent = createIntent(root, { slug: 'policy-bound-cycle', domain: 'platform', title: 'Policy Bound Cycle' });
    promoteIntent(root, intent.path);
    beginDelivery(root, 'policy-bound-cycle', { tool: 'codex' });
    passPhase(root, 'policy-bound-cycle', 'intent');
    for (const phase of ['plan', 'pattern-validation', 'test-plan']) {
      startDeliveryPhase(root, 'policy-bound-cycle', phase);
      passPhase(root, 'policy-bound-cycle', phase);
    }
    const buildApproval = recordBuildApproval(root, 'policy-bound-cycle', { decision: 'approved', approvedBy: 'Test owner', scope: 'Approved.' });
    assert.equal(buildApproval.securityPolicy.policy.status, 'configured');

    config.security_validation = { enabled: false };
    writeFileSync(configPath, YAML.stringify(config, { lineWidth: 0 }));
    for (const phase of ['build', 'standards-sweep', 'test-execute', 'delivery']) {
      startDeliveryPhase(root, 'policy-bound-cycle', phase);
      passPhase(root, 'policy-bound-cycle', phase);
    }
    const approval = recordManualQaApproval(root, 'policy-bound-cycle', {
      decision: 'approved', approvedBy: 'Test owner',
      evidencePath: evidenceFor(root, 'policy-bound-cycle', 'manual-qa-owner-evidence'),
    });
    assert.equal(approval.releaseReadiness.status, 'blocked');
    assert.equal(approval.releaseReadiness.reasons.some((reason) => reason.code === 'security-policy-changed'), true);
    assert.equal(readLifecycleHookWorkspace(root).events.some((event) => event.name === 'ewai.delivery.release-ready'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('requires UI Design to select and register a runnable project-local prototype', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-prototype-manifest-'));
  try {
    initProject(root, { name: 'Prototype Registration Test' });
    createIntent(root, { slug: 'designed-change', domain: 'experience', title: 'Designed Change' });
    const deliveryRoot = resolve(root, 'SPECS/6.Build/designed-change');
    mkdirSync(resolve(deliveryRoot, 'ui-design-assets/prototypes'), { recursive: true });
    writeFileSync(resolve(deliveryRoot, 'ui-design.md'), '# UI Design\n');
    writeFileSync(resolve(deliveryRoot, 'ui-design-assets/prototypes/selected.html'), '<!doctype html><title>Selected</title>\n');
    writeFileSync(resolve(deliveryRoot, 'ui-design-assets/prototypes/manifest.json'), JSON.stringify({
      schema: 'ewai.prototype-manifest/v1', status: 'selected',
      selected: { title: 'Selected', path: 'ui-design-assets/prototypes/selected.html', decision: 'Approved interaction.' },
      registration: { kind: 'prototype', status: 'active', path: 'ui-design-assets/prototypes/selected.html' },
    }));
    assert.equal(validatePrototypeManifest(deliveryRoot).status, 'selected');
    const projected = listWorkItems(root).find((item) => item.slug === 'designed-change');
    assert.equal(projected.artefacts.length, 1);
    assert.equal(projected.artefacts[0].kind, 'prototype');
    assert.equal(projected.artefacts[0].path, 'SPECS/6.Build/designed-change/ui-design-assets/prototypes/selected.html');
    writeFileSync(resolve(deliveryRoot, 'ui-design-assets/prototypes/manifest.json'), JSON.stringify({
      schema: 'ewai.prototype-manifest/v1', status: 'selected',
      selected: { title: 'Selected', path: '../../outside.html', decision: 'Invalid path.' },
      registration: { kind: 'prototype', status: 'active', path: '../../outside.html' },
    }));
    assert.throws(() => validatePhaseArtefacts(deliveryRoot, 'ui-design'), /inside ui-design-assets\/prototypes/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
