import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { initProject } from '../src/project.mjs';

const cli = resolve(import.meta.dirname, '../bin/ewai');

function runCli(root, args) {
  return spawnSync(process.execPath, [cli, ...args, '--project', root], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function writePortfolio(root) {
  const manifest = {
    schema: 'ewai.portfolio/v1', id: 'delivery-portfolio', name: 'Delivery portfolio', owner: 'Transformation Owner',
    members: [
      { id: 'delivery', kind: 'portfolio', name: 'Delivery', owner: 'Transformation Owner' },
      { id: 'pipeline', kind: 'project', name: 'Pipeline', owner: 'Product Owner', parent: 'delivery', repository: 'application', project_path: '.' },
    ],
    dependencies: [],
  };
  mkdirSync(resolve(root, 'SPECS/1.Scope'), { recursive: true });
  writeFileSync(resolve(root, 'SPECS/1.Scope/portfolio.yaml'), YAML.stringify(manifest, { lineWidth: 0 }));
}

test('exposes portfolio validate and status through the CLI', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-portfolio-cli-'));
  try {
    initProject(root, { name: 'Portfolio CLI' });
    writePortfolio(root);

    const validationResult = runCli(root, ['portfolio', 'validate', '--json']);
    assert.equal(validationResult.status, 0, validationResult.stderr);
    const validation = JSON.parse(validationResult.stdout);
    assert.equal(validation.schema, 'ewai.portfolio-validation/v1');
    assert.equal(validation.valid, true);
    assert.equal(validation.memberCount, 2);

    const statusResult = runCli(root, ['portfolio', 'status', '--focus', 'delivery ownership', '--json']);
    assert.equal(statusResult.status, 0, statusResult.stderr);
    const workspace = JSON.parse(statusResult.stdout);
    assert.equal(workspace.schema, 'ewai.portfolio-workspace/v1');
    assert.equal(['ready', 'attention'].includes(workspace.status), true);
    assert.equal(workspace.review.standardLlmAvailable, true);
    assert.equal(JSON.stringify(workspace).includes(root), false);

    const invalidFocus = runCli(root, ['portfolio', 'status', '--focus', 'x'.repeat(501), '--json']);
    assert.notEqual(invalidFocus.status, 0);
    assert.match(invalidFocus.stderr, /focus/i);
    const unknown = runCli(root, ['portfolio', 'status', '--root', '/tmp/untrusted', '--json']);
    assert.notEqual(unknown.status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports missing and invalid portfolio configuration with stable CLI semantics', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-portfolio-cli-invalid-'));
  try {
    initProject(root, { name: 'Portfolio CLI invalid' });
    let result = runCli(root, ['portfolio', 'validate', '--json']);
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(result.stdout).status, 'not-configured');

    mkdirSync(resolve(root, 'SPECS/1.Scope'), { recursive: true });
    writeFileSync(resolve(root, 'SPECS/1.Scope/portfolio.yaml'), 'schema: ewai.portfolio/v1\nmembers: []\n');
    result = runCli(root, ['portfolio', 'validate', '--json']);
    assert.notEqual(result.status, 0);
    const invalid = JSON.parse(result.stdout);
    assert.equal(invalid.status, 'invalid');
    assert.equal(invalid.diagnostics.every((item) => item.code.startsWith('portfolio.')), true);
    assert.equal(JSON.stringify(invalid).includes(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exposes one read-only portfolio MCP tool with the same safe snapshot', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-portfolio-mcp-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, 'mcp', '--project', root],
    cwd: root,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'portfolio-test', version: '1.0.0' });
  try {
    initProject(root, { name: 'Portfolio MCP' });
    writePortfolio(root);
    await client.connect(transport);
    const tools = await client.listTools();
    const tool = tools.tools.find((candidate) => candidate.name === 'ewai_portfolio_status');
    assert.equal(Boolean(tool), true);
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tools.tools.some((candidate) => /portfolio.*(?:write|approve|build|release)/i.test(candidate.name)), false);

    const result = await client.callTool({ name: 'ewai_portfolio_status', arguments: { focus: 'programme dependency' } });
    assert.equal(result.structuredContent.schema, 'ewai.portfolio-workspace/v1');
    assert.equal(JSON.stringify(result.structuredContent).includes(root), false);
    assert.equal(result.structuredContent.review.standardLlmAvailable, true);

    const invalid = await client.callTool({ name: 'ewai_portfolio_status', arguments: { focus: 'x'.repeat(501) } });
    assert.equal(invalid.isError, true);
  } finally {
    await client.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});

test('documents portfolio commands in CLI help', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-portfolio-help-'));
  try {
    initProject(root, { name: 'Portfolio help' });
    const result = runCli(root, ['help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ewai portfolio validate/);
    assert.match(result.stdout, /ewai portfolio status/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

