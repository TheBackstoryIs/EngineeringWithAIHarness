import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { initProject } from '../src/project.mjs';
import { ensureDashboard, stopDashboard } from '../src/runtime/dashboard.mjs';

const cli = resolve(import.meta.dirname, '../bin/ewai');

test('exposes prototype review status through CLI without requiring a prepared review', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-prototype-cli-'));
  try {
    initProject(root, { name: 'Prototype CLI' });
    const help = execFileSync(process.execPath, [cli, 'help'], { encoding: 'utf8' });
    assert.match(help, /prototype-review status/);
    assert.match(help, /plan-prepare|plan-record/);
    assert.match(help, /cycle-prepare|cycle-record/);
    const status = JSON.parse(execFileSync(process.execPath, [cli, 'prototype-review', 'status', 'example-ui', '--project', root, '--json'], { encoding: 'utf8' }));
    assert.equal(status.schema, 'ewai.prototype-iteration-workspace/v1');
    assert.equal(status.deliverySlug, 'example-ui');
    assert.deepEqual(status.planReviews, []);
    assert.deepEqual(status.activePersonas, []);
    assert.equal(status.personaAvailability.standardModel.available, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('serves server-owned prototype review routes and rejects unsafe mutation shape', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-prototype-api-'));
  try {
    initProject(root, { name: 'Prototype API' });
    const started = await ensureDashboard(root);
    const statusResponse = await fetch(`${started.url}/api/prototype-reviews/example-ui`);
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.schema, 'ewai.prototype-iteration-workspace/v1');
    assert.equal(status.deliverySlug, 'example-ui');
    assert.equal(JSON.stringify(status).includes(root), false);

    const unsafe = await fetch(`${started.url}/api/prototype-reviews/example-ui/plan/prepare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ root: '/tmp/untrusted' }),
    });
    assert.equal(unsafe.status, 400);
    const noOrigin = await fetch(`${started.url}/api/prototype-reviews/example-ui/plan/prepare`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(noOrigin.status, 403);
  } finally {
    await stopDashboard(root);
    rmSync(root, { recursive: true, force: true });
  }
});

test('publishes MCP tools and a contextual Phase Studio prototype review workspace', () => {
  const mcp = readFileSync(resolve(import.meta.dirname, '../src/runtime/mcp-server.mjs'), 'utf8');
  const html = readFileSync(resolve(import.meta.dirname, '../public/index.html'), 'utf8');
  const browser = readFileSync(resolve(import.meta.dirname, '../public/app.js'), 'utf8');
  const styles = readFileSync(resolve(import.meta.dirname, '../public/styles.css'), 'utf8');

  for (const tool of [
    'ewai_prototype_review_status', 'ewai_prototype_plan_prepare', 'ewai_prototype_plan_record',
    'ewai_prototype_cycle_prepare', 'ewai_prototype_cycle_record', 'ewai_prototype_review_compare',
  ]) assert.match(mcp, new RegExp(tool));
  assert.match(html, /id="prototypeReviewPanel"/);
  assert.match(html, /Actively engaged prototype reviewers/);
  assert.match(browser, /\/api\/prototype-reviews\//);
  assert.match(browser, /renderPrototypeReview/);
  assert.match(browser, /matchedSignals/);
  assert.match(browser, /engagementReason/);
  assert.match(styles, /\.prototype-review-panel/);
  assert.match(styles, /\.prototype-review-persona\[data-tier="premium"\]/);
});
