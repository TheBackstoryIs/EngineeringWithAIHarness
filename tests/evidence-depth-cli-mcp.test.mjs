import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { initProject } from '../src/project.mjs';
import { ensureDashboard, stopDashboard } from '../src/runtime/dashboard.mjs';
import { refreshRepositoryIndex } from '../src/runtime/repository-index.mjs';

const cli = resolve(import.meta.dirname, '../bin/ewai');

function project(name) {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-depth-adapter-'));
  initProject(root, { name });
  writeFileSync(resolve(root, 'app.mjs'), 'export const answer = 42;\n');
  refreshRepositoryIndex(root);
  return root;
}

function runCli(root, args) {
  return spawnSync(process.execPath, [cli, ...args, '--project', root], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function review(workspace, reviewedBy = 'Project Owner') {
  return {
    schema: 'ewai.evidence-depth-review/v1',
    expectedPreparationDigest: workspace.preparation.preparationDigest,
    reviewedBy,
    dimensions: workspace.preparation.dimensions.map(({ id, recommendedDepth }) => ({ id, selectedDepth: recommendedDepth, rationale: '' })),
    grouping: {
      strategy: 'user-outcome',
      assignments: workspace.preparation.gaps.map((gap, index) => ({ gapId: gap.id, groupId: `owner-gap-${index + 1}`, disposition: 'owned' })),
    },
  };
}

test('CLI prepares records and compares exact evidence-depth runs', () => {
  const root = project('Evidence depth CLI');
  try {
    const prepared = runCli(root, ['archaeology', 'depth-prepare', '--focus', 'hosting security', '--json']);
    assert.equal(prepared.status, 0, prepared.stderr);
    const workspace = JSON.parse(prepared.stdout);
    assert.equal(workspace.schema, 'ewai.evidence-depth-workspace/v1');
    assert.equal(workspace.preparation.dimensions.length, 7);
    assert.equal(JSON.stringify(workspace).includes(root), false);

    writeFileSync(resolve(root, 'depth-review.json'), `${JSON.stringify(review(workspace), null, 2)}\n`);
    const recorded = runCli(root, ['archaeology', 'depth-record', '--input', 'depth-review.json', '--json']);
    assert.equal(recorded.status, 0, recorded.stderr);
    const receipt = JSON.parse(recorded.stdout);
    assert.equal(receipt.status, 'recorded');

    const status = runCli(root, ['archaeology', 'depth-status', '--json']);
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).runs.length, 1);

    const compared = runCli(root, ['archaeology', 'depth-compare', receipt.runId, receipt.runId, '--json']);
    assert.equal(compared.status, 0, compared.stderr);
    assert.equal(JSON.parse(compared.stdout).reproducible, true);
    assert.match(runCli(root, ['help']).stdout, /archaeology depth-prepare/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MCP exposes bounded read prepare record and compare tools', async () => {
  const root = project('Evidence depth MCP');
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp', '--project', root], cwd: root, stderr: 'pipe' });
  const client = new Client({ name: 'evidence-depth-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    for (const name of ['ewai_evidence_depth_status', 'ewai_evidence_depth_prepare', 'ewai_evidence_depth_record', 'ewai_evidence_depth_compare']) {
      assert.equal(tools.tools.some((candidate) => candidate.name === name), true, name);
    }
    assert.equal(tools.tools.find(({ name }) => name === 'ewai_evidence_depth_status').annotations.readOnlyHint, true);
    const prepared = await client.callTool({ name: 'ewai_evidence_depth_prepare', arguments: { focus: 'security' } });
    assert.equal(prepared.structuredContent.preparation.dimensions.length, 7);
    assert.equal(JSON.stringify(prepared.structuredContent).includes(root), false);
    const recorded = await client.callTool({ name: 'ewai_evidence_depth_record', arguments: review(prepared.structuredContent) });
    assert.equal(recorded.structuredContent.status, 'recorded');
    const compared = await client.callTool({ name: 'ewai_evidence_depth_compare', arguments: { leftRunId: recorded.structuredContent.runId, rightRunId: recorded.structuredContent.runId } });
    assert.equal(compared.structuredContent.reproducible, true);
  } finally {
    await client.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});

test('dashboard serves the evidence-depth workspace from server-owned context', async () => {
  const root = project('Evidence depth dashboard');
  try {
    const started = await ensureDashboard(root);
    const initial = await fetch(`${started.url}/api/evidence-depth`, { headers: { 'x-project-root': '/tmp/untrusted' } });
    assert.equal(initial.status, 200);
    assert.equal((await initial.json()).status, 'not-prepared');

    const preparedResponse = await fetch(`${started.url}/api/evidence-depth/prepare`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url }, body: JSON.stringify({ focus: 'delivery' }),
    });
    assert.equal(preparedResponse.status, 200);
    const prepared = await preparedResponse.json();
    assert.equal(prepared.preparation.dimensions.length, 7);
    assert.equal(JSON.stringify(prepared).includes(root), false);
    assert.equal(JSON.stringify(prepared).includes('/tmp/untrusted'), false);

    const recordedResponse = await fetch(`${started.url}/api/evidence-depth/record`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url }, body: JSON.stringify(review(prepared)),
    });
    assert.equal(recordedResponse.status, 200);
    const recorded = await recordedResponse.json();
    const comparison = await fetch(`${started.url}/api/evidence-depth/compare`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ leftRunId: recorded.runId, rightRunId: recorded.runId }),
    }).then((response) => response.json());
    assert.equal(comparison.reproducible, true);

    const override = await fetch(`${started.url}/api/evidence-depth?projectRoot=${encodeURIComponent('/tmp/untrusted')}`);
    assert.equal(override.status, 400);
    const source = [
      readFileSync(resolve(import.meta.dirname, '../src/cli.mjs'), 'utf8'),
      readFileSync(resolve(import.meta.dirname, '../src/runtime/mcp-server.mjs'), 'utf8'),
      readFileSync(resolve(import.meta.dirname, '../src/runtime/dashboard-server.mjs'), 'utf8'),
    ].join('\n');
    assert.doesNotMatch(source, /evidence[-_ ]depth.*(?:hosted feedback|telemetry|production runtime)/is);
  } finally {
    await stopDashboard(root);
    rmSync(root, { recursive: true, force: true });
  }
});

test('Guided Setup renders a responsive seven-dimensional ledger with active personas and comparison', () => {
  const app = readFileSync(resolve(import.meta.dirname, '../public/app.js'), 'utf8');
  const css = readFileSync(resolve(import.meta.dirname, '../public/styles.css'), 'utf8');
  assert.match(app, /function renderEvidenceDepthPanel/);
  assert.match(app, /architecture.*data.*security.*product.*delivery.*governance.*operations/s);
  assert.match(app, /personasByDimension/);
  assert.match(app, /data-evidence-depth-prepare/);
  assert.match(app, /evidenceDepthReview/);
  assert.match(app, /evidenceDepthCompare/);
  assert.match(app, /Default fallback visual system/);
  assert.match(app, /Recording creates immutable evidence only\. It does not approve Build, Manual QA, deployment or release\./);
  assert.match(css, /\.evidence-depth-ledger/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.evidence-depth-row/);
  assert.match(css, /\.evidence-depth-review input:focus/);
});
