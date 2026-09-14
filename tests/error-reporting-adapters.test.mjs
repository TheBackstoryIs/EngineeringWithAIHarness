import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { initProject } from '../src/project.mjs';
import { ensureDashboard, stopDashboard } from '../src/runtime/dashboard.mjs';

const reportInput = {
  capability: 'dashboard', errorCode: 'EWAI-UI-LOAD', command: 'ewai dashboard',
  ewaiVersion: '0.2.1', nodeVersion: process.versions.node, osClass: process.platform === 'darwin' ? 'darwin' : 'linux',
  installationSource: 'npm', title: 'Dashboard failed to load', expected: 'The local dashboard loads.',
  actual: 'A bounded failure was shown.', reproductionSteps: ['Open the local dashboard'],
};
const reportRequest = Object.fromEntries(Object.entries(reportInput).filter(([key]) => !['ewaiVersion', 'nodeVersion', 'osClass', 'installationSource'].includes(key)));

function project() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-error-report-adapters-'));
  initProject(root, { name: 'Error report adapters' });
  return root;
}

function cli(root, args) {
  return JSON.parse(execFileSync(process.execPath, [resolve(import.meta.dirname, '../bin/ewai'), ...args, '--project', root, '--json'], { encoding: 'utf8' }));
}

test('CLI exposes the complete local lifecycle without a provider', () => {
  const root = project();
  try {
    const created = cli(root, ['error-report', 'create',
      '--capability', reportInput.capability, '--error-code', reportInput.errorCode,
      '--command', reportInput.command, '--title', reportInput.title, '--expected', reportInput.expected,
      '--actual', reportInput.actual, '--step', reportInput.reproductionSteps[0],
    ]);
    assert.equal(created.status, 'draft');
    const status = cli(root, ['error-report', 'status']);
    assert.equal(status.localOnly, true);
    assert.equal(status.reports.length, 1);
    const finalised = cli(root, ['error-report', 'finalise', created.id]);
    assert.equal(finalised.report.status, 'finalised');
    const email = cli(root, ['error-report', 'prepare-email', created.id, '--expected-digest', finalised.report.package.archiveDigest]);
    assert.equal(email.status, 'prepared-not-sent');
    assert.match(email.message, /attach the ZIP manually/i);
    assert.equal(cli(root, ['error-report', 'providers']).providers.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('opt-in automatic CLI capture creates a generic local draft without masking the original failure', () => {
  const root = project();
  try {
    cli(root, ['error-report', 'settings', '--automatic-local-drafts', 'true']);
    const failed = spawnSync(process.execPath, [resolve(import.meta.dirname, '../bin/ewai'), 'unknown-operation', '--project', root, '--json'], { encoding: 'utf8' });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /Unknown command/);
    const status = cli(root, ['error-report', 'status']);
    assert.equal(status.reports.length, 1);
    assert.equal(status.reports[0].diagnostics.errorCode, 'EWAI-CLI-FAILED');
    assert.equal(status.reports[0].diagnostics.command, 'ewai unknown-operation');
    assert.match(status.reports[0].description.actual, /original error.+not copied/i);
    assert.equal(JSON.stringify(status.reports[0]).includes(root), false);
    assert.equal(JSON.stringify(status.reports[0]).includes('Unknown command'), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('MCP uses project-bound safe input and returns the same local report state', async () => {
  const root = project();
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve(import.meta.dirname, '../src/runtime/mcp-server.mjs'), '--project', root] });
  const client = new Client({ name: 'error-report-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.some(({ name }) => name === 'ewai_error_report_create'), true);
    assert.equal(tools.tools.some(({ name }) => name === 'ewai_error_report_send_provider'), true);
    const created = await client.callTool({ name: 'ewai_error_report_create', arguments: reportRequest });
    assert.equal(created.structuredContent.status, 'draft');
    const status = await client.callTool({ name: 'ewai_error_report_status', arguments: {} });
    assert.equal(status.structuredContent.localOnly, true);
    assert.equal(status.structuredContent.reports[0].id, created.structuredContent.id);
    const schema = tools.tools.find(({ name }) => name === 'ewai_error_report_create').inputSchema;
    assert.equal(JSON.stringify(schema).includes('projectRoot'), false);
    assert.equal(JSON.stringify(schema).includes('rawDiagnostics'), false);
    assert.equal(JSON.stringify(schema).includes('environment'), false);
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('loopback API enforces safe bodies, exact digest and explicit deletion', async () => {
  const root = project();
  try {
    const started = await ensureDashboard(root);
    const originHeaders = { 'content-type': 'application/json', origin: started.url };
    const initial = await fetch(`${started.url}/api/error-reports`).then((response) => response.json());
    assert.equal(initial.localOnly, true);

    const unsafe = await fetch(`${started.url}/api/error-reports`, {
      method: 'POST', headers: originHeaders, body: JSON.stringify({ ...reportRequest, rawDiagnostics: { env: process.env } }),
    });
    assert.equal(unsafe.status, 400);
    assert.equal(JSON.stringify(await unsafe.json()).includes(root), false);

    const createdResponse = await fetch(`${started.url}/api/error-reports`, {
      method: 'POST', headers: originHeaders, body: JSON.stringify(reportRequest),
    });
    const created = await createdResponse.json();
    assert.equal(createdResponse.status, 201, JSON.stringify(created));
    const finalised = await fetch(`${started.url}/api/error-reports/${created.id}/finalise`, {
      method: 'POST', headers: originHeaders, body: '{}',
    }).then((response) => response.json());
    assert.equal(finalised.report.status, 'finalised');

    const badEmail = await fetch(`${started.url}/api/error-reports/${created.id}/prepare-email`, {
      method: 'POST', headers: originHeaders, body: JSON.stringify({ expectedDigest: `sha256:${'0'.repeat(64)}` }),
    });
    assert.equal(badEmail.status, 400);
    const email = await fetch(`${started.url}/api/error-reports/${created.id}/prepare-email`, {
      method: 'POST', headers: originHeaders, body: JSON.stringify({ expectedDigest: finalised.report.package.archiveDigest }),
    }).then((response) => response.json());
    assert.equal(email.status, 'prepared-not-sent');

    const preference = await fetch(`${started.url}/api/error-reports/settings`, {
      method: 'PATCH', headers: originHeaders, body: JSON.stringify({ automaticLocalDrafts: true }),
    }).then((response) => response.json());
    assert.equal(preference.automaticLocalDrafts, true);
    assert.equal('transmission' in preference, false);

    const deniedDelete = await fetch(`${started.url}/api/error-reports/${created.id}`, {
      method: 'DELETE', headers: originHeaders, body: JSON.stringify({ confirmed: false }),
    });
    assert.equal(deniedDelete.status, 400);
    const deleted = await fetch(`${started.url}/api/error-reports/${created.id}`, {
      method: 'DELETE', headers: originHeaders, body: JSON.stringify({ confirmed: true }),
    }).then((response) => response.json());
    assert.equal(deleted.localMaterialRemoved, true);

    const traversal = await fetch(`${started.url}/api/error-reports/${encodeURIComponent('../outside')}`);
    assert.equal(traversal.status >= 400, true);
  } finally {
    await stopDashboard(root);
    rmSync(root, { recursive: true, force: true });
  }
});

test('ships an accessible responsive Error Reporting custody workspace', () => {
  const html = readFileSync(resolve(import.meta.dirname, '../public/index.html'), 'utf8');
  const app = readFileSync(resolve(import.meta.dirname, '../public/app.js'), 'utf8');
  const styles = readFileSync(resolve(import.meta.dirname, '../public/styles.css'), 'utf8');
  assert.match(html, /data-view="error-reporting"/);
  assert.match(html, /id="errorReportingView"/);
  assert.match(html, /id="errorReportList"/);
  assert.match(html, /id="errorReportViewer"[^>]*aria-live="polite"/);
  assert.match(html, /id="errorReportStatus"[^>]*aria-live="polite"/);
  assert.match(html, /Automatic local drafts/);
  assert.match(html, /No report leaves this device automatically/);
  assert.match(app, /async function loadErrorReports/);
  assert.match(app, /function renderErrorReports/);
  assert.match(app, /data-error-report-finalise/);
  assert.match(app, /data-error-report-email/);
  assert.match(app, /data-error-report-provider/);
  assert.match(app, /data-report-problem/);
  assert.match(app, /prepared-not-sent/);
  assert.match(app, /attach the ZIP manually/i);
  assert.doesNotMatch(app, /automaticLocalDrafts[\s\S]{0,120}(?:send|provider-attempts)/i);
  assert.match(styles, /\.error-reporting-layout/);
  assert.match(styles, /@media \(max-width: 960px\)[\s\S]*\.error-reporting-layout/);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*\.error-report-actions/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
