import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createIntent } from '../src/intents.mjs';
import { initProject } from '../src/project.mjs';
import { requestGuidedDashboardWork } from '../src/runtime/dashboard-actions.mjs';
import { listDashboardHandoffs, queueDashboardHandoff, resolveDashboardHandoff } from '../src/runtime/dashboard-handoffs.mjs';

test('queues guided dashboard work without bypassing the delivery harness', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-dashboard-handoff-'));
  try {
    initProject(root, { name: 'Dashboard Handoff Test' });
    createIntent(root, { slug: 'guided-change', domain: 'delivery', title: 'Guided Change' });

    assert.throws(
      () => requestGuidedDashboardWork(root, 'guided-change', { action: 'begin' }),
      /explicit confirmation/i,
    );
    const handoff = requestGuidedDashboardWork(root, 'guided-change', { action: 'begin', confirmed: true });
    assert.equal(handoff.intentId, 'delivery/guided-change');
    assert.equal(handoff.status, 'pending');
    assert.equal(existsSync(resolve(root, 'SPECS/6.Build/guided-change/delivery-state.json')), false);
    assert.deepEqual(listDashboardHandoffs(root, { status: 'pending' }).map((item) => item.id), [handoff.id]);

    const completed = resolveDashboardHandoff(root, handoff.id, { status: 'completed', resolvedBy: 'codex' });
    assert.equal(completed.status, 'completed');
    assert.deepEqual(listDashboardHandoffs(root, { status: 'pending' }), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('supersedes an older pending handoff for the same intent', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-dashboard-handoff-'));
  try {
    initProject(root, { name: 'Dashboard Handoff Test' });
    createIntent(root, { slug: 'selected-change', domain: 'delivery', title: 'Selected Change' });
    const first = requestGuidedDashboardWork(root, 'selected-change', { action: 'begin', confirmed: true });
    const second = requestGuidedDashboardWork(root, 'selected-change', { action: 'begin', confirmed: true });

    assert.equal(listDashboardHandoffs(root, { status: 'pending' })[0].id, second.id);
    assert.equal(listDashboardHandoffs(root).find((item) => item.id === first.id).status, 'superseded');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps authority-free contribution review separate from delivery handoffs', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-dashboard-review-handoff-'));
  try {
    initProject(root, { name: 'Dashboard review handoff' });
    createIntent(root, { slug: 'selected-change', domain: 'delivery', title: 'Selected Change' });
    const delivery = requestGuidedDashboardWork(root, 'selected-change', { action: 'begin', confirmed: true });
    const review = queueDashboardHandoff(root, {
      action: 'review-contribution', intentId: 'delivery/selected-change', slug: 'selected-change', title: 'Selected Change', phase: 'plan',
      authority: 'admin',
      reviewContext: {
        revision: 3, digest: 'a'.repeat(64), ownerContext: 'shared-review',
        summary: '2 attributed entries across outcomes and dependencies; 1 open question; 1 unresolved conflict.',
        activePersonas: [{ id: 'project.product-owner', name: 'Project Product Owner', tier: 'project', matchedSignals: ['outcomes'], engagementReason: 'Reviews outcomes.' }],
      },
    });
    assert.equal(review.authority, 'none');
    assert.equal(review.reviewContext.revision, 3);
    assert.equal('prompt' in review.reviewContext, false);
    assert.equal(listDashboardHandoffs(root, { status: 'pending' }).some((item) => item.id === delivery.id), true);

    const newerReview = queueDashboardHandoff(root, {
      action: 'review-contribution', intentId: 'delivery/selected-change', slug: 'selected-change', title: 'Selected Change', phase: 'plan',
      reviewContext: { revision: 4, digest: 'b'.repeat(64), ownerContext: 'technical', summary: '3 attributed entries; 1 open question.', activePersonas: [] },
    });
    assert.equal(listDashboardHandoffs(root).find((item) => item.id === review.id).status, 'superseded');
    assert.equal(listDashboardHandoffs(root).find((item) => item.id === delivery.id).status, 'pending');
    assert.equal(listDashboardHandoffs(root).find((item) => item.id === newerReview.id).status, 'pending');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
