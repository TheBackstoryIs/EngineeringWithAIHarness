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

const cli = resolve(import.meta.dirname, '../bin/ewai');

function contextProject(name) {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-context-host-'));
  initProject(root, { name });
  createIntent(root, { slug: 'sample-context', domain: 'platform', title: 'Sample Context Outcome' });
  return root;
}

function runCli(root, args) {
  return spawnSync(process.execPath, [cli, ...args, '--project', root], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
}

test('trusted CLI prepares transient context and a body-free safe manifest', () => {
  const root = contextProject('Context CLI');
  try {
    const result = runCli(root, ['context', 'prepare', 'intent', '--slug', 'sample-context', '--focus', 'outcomes', '--budget', '4000', '--json']);
    assert.equal(result.status, 0, result.stderr);
    const pack = JSON.parse(result.stdout);
    assert.equal(pack.schema, 'ewai.context-pack/v1');
    assert.equal(pack.status, 'ready');
    assert.match(pack.modelContext, /Sample Context Outcome/);
    assert.equal(JSON.stringify(pack.segments).includes('Sample Context Outcome'), false);
    assert.equal(JSON.stringify(pack.segments).includes(root), false);

    const unsafe = runCli(root, ['context', 'prepare', 'intent', '--slug', 'sample-context', '--root', '/tmp/untrusted', '--json']);
    assert.notEqual(unsafe.status, 0);
    const help = runCli(root, ['help']);
    assert.match(help.stdout, /ewai context prepare PROFILE/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('trusted MCP context preparation exposes the transient payload without accepting roots', async () => {
  const root = contextProject('Context MCP');
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp', '--project', root], cwd: root, stderr: 'pipe' });
  const client = new Client({ name: 'context-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const tool = tools.tools.find(({ name }) => name === 'ewai_context_prepare');
    assert.equal(Boolean(tool), true);
    assert.equal('projectRoot' in (tool.inputSchema?.properties ?? {}), false);
    assert.equal('path' in (tool.inputSchema?.properties ?? {}), false);

    const result = await client.callTool({
      name: 'ewai_context_prepare',
      arguments: { profile: 'intent', slug: 'sample-context', focus: 'outcomes', budgetTokens: 4000 },
    });
    assert.equal(result.structuredContent.status, 'ready');
    assert.match(result.structuredContent.modelContext, /Sample Context Outcome/);
    assert.equal(JSON.stringify(result.structuredContent.segments).includes(root), false);
  } finally {
    await client.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});
