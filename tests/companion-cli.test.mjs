import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createIntent } from '../src/intents.mjs';
import { initProject } from '../src/project.mjs';
import { ensureDashboard, stopDashboard } from '../src/runtime/dashboard.mjs';

const cli = resolve(import.meta.dirname, '../bin/ewai');

function runCli(root, args) {
  return spawnSync(process.execPath, [cli, ...args, '--project', root], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function companionProject(name) {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-companion-adapter-'));
  initProject(root, { name });
  createIntent(root, { slug: 'existing-work', domain: 'experience', title: 'Existing Work' });
  return root;
}

test('exposes bounded companion guidance through the CLI', () => {
  const root = companionProject('Companion CLI');
  try {
    const result = runCli(root, ['companion', 'status', '--focus', 'existing-work', '--json']);
    assert.equal(result.status, 0, result.stderr);
    const guidance = JSON.parse(result.stdout);
    assert.equal(guidance.schema, 'ewai.companion-guidance/v1');
    assert.equal(guidance.spotlight.id, 'experience/existing-work');
    assert.equal(guidance.baseline.complete, true);
    assert.equal(JSON.stringify(guidance).includes(root), false);

    const invalid = runCli(root, ['companion', 'status', '--focus', 'x'.repeat(501), '--json']);
    assert.notEqual(invalid.status, 0);
    const unknown = runCli(root, ['companion', 'status', '--root', '/tmp/untrusted', '--json']);
    assert.notEqual(unknown.status, 0);

    const help = runCli(root, ['help']);
    assert.match(help.stdout, /ewai companion status/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exposes one read-only companion MCP tool', async () => {
  const root = companionProject('Companion MCP');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, 'mcp', '--project', root],
    cwd: root,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'companion-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const tool = tools.tools.find((candidate) => candidate.name === 'ewai_companion_status');
    assert.equal(Boolean(tool), true);
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tools.tools.some((candidate) => /companion.*(?:write|approve|build|release)/i.test(candidate.name)), false);

    const result = await client.callTool({ name: 'ewai_companion_status', arguments: { focus: 'existing-work' } });
    assert.equal(result.structuredContent.schema, 'ewai.companion-guidance/v1');
    assert.equal(result.structuredContent.spotlight.id, 'experience/existing-work');
    assert.equal(JSON.stringify(result.structuredContent).includes(root), false);

    const invalid = await client.callTool({ name: 'ewai_companion_status', arguments: { focus: 'x'.repeat(501) } });
    assert.equal(invalid.isError, true);
  } finally {
    await client.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});

test('serves companion guidance from server-owned loopback context', async () => {
  const root = companionProject('Companion HTTP');
  try {
    const started = await ensureDashboard(root);
    const response = await fetch(`${started.url}/api/companion?focus=existing-work`, {
      headers: { authorization: 'Bearer untrusted', 'x-project-root': '/tmp/untrusted' },
    });
    assert.equal(response.status, 200);
    const guidance = await response.json();
    assert.equal(guidance.schema, 'ewai.companion-guidance/v1');
    assert.equal(guidance.spotlight.id, 'experience/existing-work');
    assert.equal(JSON.stringify(guidance).includes(root), false);
    assert.equal(JSON.stringify(guidance).includes('/tmp/untrusted'), false);

    const override = await fetch(`${started.url}/api/companion?root=${encodeURIComponent('/tmp/untrusted')}`);
    assert.equal(override.status, 400);
    const invalid = await fetch(`${started.url}/api/companion?focus=${'x'.repeat(501)}`);
    assert.equal(invalid.status, 400);
    const mutation = await fetch(`${started.url}/api/companion`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url }, body: '{}',
    });
    assert.equal(mutation.status, 404);
  } finally {
    await stopDashboard(root);
    rmSync(root, { recursive: true, force: true });
  }
});
