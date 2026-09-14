import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { beginDelivery } from '../src/delivery.mjs';
import { deriveExecutionState } from '../src/execution-state.mjs';
import { createIntent } from '../src/intents.mjs';
import { initProject } from '../src/project.mjs';
import { readRuntimeIntent } from '../src/runtime/intents.mjs';
import { listWorkItems } from '../src/runtime/work.mjs';

test('derives permitted actions from durable delivery evidence rather than a ready flag', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-execution-state-'));
  try {
    initProject(root, { name: 'Execution State Test' });
    createIntent(root, { slug: 'safe-alerting', domain: 'alerts', title: 'Safe Alerting' });

    const draft = deriveExecutionState(root, readRuntimeIntent(root, 'alerts/safe-alerting'));
    assert.equal(draft.valid, true);
    assert.equal(draft.lifecycle.status, 'not-started');
    assert.equal(draft.actions.beginHarness.permitted, true);
    assert.equal(draft.actions.enterBuild.permitted, false);

    beginDelivery(root, 'safe-alerting', { tool: 'codex' });
    const active = deriveExecutionState(root, readRuntimeIntent(root, 'alerts/safe-alerting'));
    assert.equal(active.valid, true);
    assert.equal(active.lifecycle.currentPhase, 'intent');
    assert.equal(active.tasks.maxParallelTasks, 1);
    assert.equal(active.actions.continueHarness.permitted, true);
    assert.equal(active.actions.completeCurrentPhase.permitted, false);
    assert.equal(
      active.actions.completeCurrentPhase.blockers.some((blocker) => blocker.code === 'intent-not-ready'),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('projects state drift as blocked instead of silently falling back to a status lane', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-execution-drift-'));
  try {
    initProject(root, { name: 'Execution Drift Test' });
    const created = createIntent(root, { slug: 'observable-work', domain: 'delivery', title: 'Observable Work' });
    beginDelivery(root, 'observable-work', { tool: 'codex' });

    const jsonPath = created.path.replace(/\.md$/, '.json');
    const sidecar = JSON.parse(readFileSync(jsonPath, 'utf8'));
    sidecar.status = 'ready';
    writeFileSync(jsonPath, `${JSON.stringify(sidecar, null, 2)}\n`);

    const item = listWorkItems(root)[0];
    assert.equal(item.lane, 'blocked');
    assert.equal(item.execution.valid, false);
    assert.equal(item.execution.blockers.some((blocker) => blocker.code === 'intent-state-drift'), true);
    assert.equal(item.execution.actions.continueHarness.permitted, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
