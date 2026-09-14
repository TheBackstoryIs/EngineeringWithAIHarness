import test from 'node:test';
import {DASHBOARD_VIEWS} from '../src/dashboard-preferences.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createIntent } from '../src/intents.mjs';
import { initProject } from '../src/project.mjs';
import { ensureDashboard, stopDashboard } from '../src/runtime/dashboard.mjs';

function contextProject(name) {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-context-dashboard-'));
  initProject(root, { name });
  createIntent(root, {
    slug: 'private-context',
    domain: 'platform',
    title: 'Private Context Outcome',
  });
  return root;
}

async function prepare(url, input, headers = {}) {
  return fetch(`${url}/api/context-packs/prepare`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: url, ...headers },
    body: JSON.stringify(input),
  });
}

test('serves only body-free context manifests from server-owned loopback context', async () => {
  const root = contextProject('Context Inspector HTTP');
  try {
    const started = await ensureDashboard(root);
    const response = await prepare(started.url, {
      profile: 'intent', slug: 'private-context', focus: 'outcomes', budgetTokens: 4_000,
    }, { authorization: 'Bearer local-user', 'x-project-root': '/tmp/untrusted' });
    assert.equal(response.status, 200);
    const manifest = await response.json();
    assert.equal(manifest.schema, 'ewai.context-pack/v1');
    assert.equal(manifest.status, 'ready');
    assert.equal('modelContext' in manifest, false);
    assert.equal('deltaContext' in manifest, false);
    assert.equal(manifest.segments.every((segment) => !('content' in segment)), true);
    assert.equal(JSON.stringify(manifest).includes('Private Context Outcome'), false);
    assert.equal(JSON.stringify(manifest).includes(root), false);
    assert.equal(JSON.stringify(manifest).includes('/tmp/untrusted'), false);

    const stored = await fetch(`${started.url}/api/context-packs/${manifest.digest}`, {
      headers: { authorization: 'Bearer local-user' },
    });
    assert.equal(stored.status, 200);
    assert.deepEqual(await stored.json(), manifest);

    const manifestPath = resolve(root, '.ewai-pipeline/runtime/context-packs/manifests', `${manifest.digest}.json`);
    const tampered = JSON.parse(readFileSync(manifestPath, 'utf8'));
    tampered.reason = 'tampered-without-changing-digest';
    writeFileSync(manifestPath, `${JSON.stringify(tampered, null, 2)}\n`);
    const invalidStored = await fetch(`${started.url}/api/context-packs/${manifest.digest}`);
    assert.equal(invalidStored.status, 400);

    const overflow = await prepare(started.url, {
      profile: 'intent', slug: 'private-context', budgetTokens: 1,
    });
    assert.equal(overflow.status, 200);
    const blocked = await overflow.json();
    assert.equal(blocked.status, 'non-ready');
    assert.equal(blocked.reason, 'mandatory-overflow');
    assert.ok(blocked.budget.overflowTokens > 0);
    assert.equal('modelContext' in blocked, false);

    const override = await prepare(started.url, {
      profile: 'intent', slug: 'private-context', projectRoot: '/tmp/untrusted',
    });
    assert.equal(override.status, 400);
    assert.match((await override.json()).error, /unknown field: projectRoot/);

    const missing = await fetch(`${started.url}/api/context-packs/${'0'.repeat(64)}`);
    assert.equal(missing.status, 404);
    const malformed = await fetch(`${started.url}/api/context-packs/not-a-digest`);
    assert.equal(malformed.status, 400);
  } finally {
    await stopDashboard(root);
    rmSync(root, { recursive: true, force: true });
  }
});

test('ships an accessible responsive Context Inspector without raw-context controls', () => {
  const root = resolve(import.meta.dirname, '..');
  const html = readFileSync(resolve(root, 'public/index.html'), 'utf8');
  const javascript = readFileSync(resolve(root, 'public/app.js'), 'utf8');
  const css = readFileSync(resolve(root, 'public/styles.css'), 'utf8');
  const inspector = html.match(/<section id="contextInspectorView"[\s\S]*?<\/section>\s*<section id="startersView"/)?.[0] ?? '';

  assert.ok(DASHBOARD_VIEWS.some(view=>view.id==='context-inspector'&&view.title==='AI context diagnostics'));
  assert.match(html, /id="optionalViewLinks"/);
  assert.match(html, /id="contextInspectorView"/);
  assert.match(html, /id="contextInspectorStatus"[^>]+aria-live="polite"/);
  assert.match(html, /id="contextOverflowAlert"[^>]+role="alert"/);
  assert.match(html, /id="contextBudgetRunway"/);
  assert.match(html, /id="contextFidelityRail"/);
  assert.match(html, /id="contextActivePersonas"/);
  assert.doesNotMatch(inspector, /(?:projectRoot|sourcePath|providerCommand|credential)/);

  assert.match(javascript, /\/api\/context-packs\/prepare/);
  assert.match(javascript, /mandatory-overflow/);
  assert.match(javascript, /activePersonas/);
  assert.match(javascript, /aria-current/);
  assert.match(css, /\.context-budget-segment\.mandatory/);
  assert.match(css, /\.context-budget-segment\.reused/);
  assert.match(css, /\.context-budget-segment\.deferred/);
  assert.match(css, /\.context-budget-segment\.overflow/);
  assert.match(css, /@media \(max-width: 960px\)/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
