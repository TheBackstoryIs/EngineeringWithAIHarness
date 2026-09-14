import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createIntent } from '../src/intents.mjs';
import { initProject } from '../src/project.mjs';
import { ensureDashboard, stopDashboard } from '../src/runtime/dashboard.mjs';
import { POLICY_DESIGN_AUTHORITY_NOTICE } from '../src/runtime/policy-workspace.mjs';

test('CLI MCP HTTP and UI expose the same policy workspace without a production runtime surface', () => {
  const cli = readFileSync('src/cli.mjs', 'utf8');
  const mcp = readFileSync('src/runtime/mcp-server.mjs', 'utf8');
  const server = readFileSync('src/runtime/dashboard-server.mjs', 'utf8');
  const html = readFileSync('public/index.html', 'utf8');
  const app = readFileSync('public/app.js', 'utf8');
  const css = readFileSync('public/styles.css', 'utf8');
  assert.match(cli, /command === 'policy'.*subcommand === 'status'/s);
  assert.match(mcp, /ewai_policy_status/);
  assert.match(mcp, /ewai_policy_confirm_facts/);
  assert.match(mcp, /ewai_policy_evaluate/);
  assert.match(server, /GET.*\/api\/policies/s);
  assert.match(server, /\/api\/policies\/facts\/confirm/);
  assert.match(html, /id="policiesView"/);
  assert.match(app, /activePersonas/);
  assert.match(app, /business.*technical/is);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*policy-workspace/);
  for (const source of [cli, mcp, server]) assert.doesNotMatch(source, /policy.*(?:proxy|gateway|intercept).*production/is);
});

test('serves a safe policy workspace from server-owned context and rejects authority injection', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-policy-dashboard-'));
  try {
    initProject(root, { name: 'Policy dashboard' });
    createIntent(root, { slug: 'safe-design', domain: 'platform', title: 'Safe design' });
    const started = await ensureDashboard(root);
    const response = await fetch(`${started.url}/api/policies?intent=platform%2Fsafe-design&mode=business`, {
      headers: { authorization: 'Bearer ignored', 'x-project-root': '/tmp/untrusted' },
    });
    assert.equal(response.status, 200);
    const workspace = await response.json();
    assert.equal(workspace.schema, 'ewai.policy-workspace/v1');
    assert.equal(workspace.status, 'not-configured');
    assert.equal(workspace.blocking, false);
    assert.equal(workspace.notices.includes(POLICY_DESIGN_AUTHORITY_NOTICE), true);
    assert.equal(JSON.stringify(workspace).includes(root), false);
    assert.equal(JSON.stringify(workspace).includes('/tmp/untrusted'), false);

    const unknownQuery = await fetch(`${started.url}/api/policies?projectRoot=${encodeURIComponent('/tmp/untrusted')}`);
    assert.equal(unknownQuery.status, 400);
    assert.equal((await unknownQuery.json()).authority_notice, POLICY_DESIGN_AUTHORITY_NOTICE);
    const invalidMode = await fetch(`${started.url}/api/policies?mode=production`);
    assert.equal(invalidMode.status, 400);
    assert.equal((await invalidMode.json()).authority_notice, POLICY_DESIGN_AUTHORITY_NOTICE);
    const authorityInjection = await fetch(`${started.url}/api/policies/evaluate`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ intentReference: 'platform/safe-design', projectRoot: '/tmp/untrusted' }),
    });
    assert.equal(authorityInjection.status, 400);
    assert.equal((await authorityInjection.json()).authority_notice, POLICY_DESIGN_AUTHORITY_NOTICE);
  } finally {
    await stopDashboard(root);
    rmSync(root, { recursive: true, force: true });
  }
});
