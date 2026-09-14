import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { initProject } from '../src/project.mjs';
import { ASSURANCE_NOTICE } from '../src/security-validation-config.mjs';

const cli = resolve(import.meta.dirname, '../bin/ewai');

function runCli(root, args) {
  return spawnSync(process.execPath, [cli, ...args, '--project', root], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

test('security status returns the complete safe workspace contract as JSON', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-security-cli-'));
  try {
    initProject(root, { name: 'Security CLI Test' });
    const result = runCli(root, ['security', 'status', '--json']);
    assert.equal(result.status, 0, result.stderr);
    const workspace = JSON.parse(result.stdout);
    assert.equal(workspace.schema, 'ewai.security-workspace/v1');
    assert.equal(workspace.assurance_notice, ASSURANCE_NOTICE);
    assert.equal(workspace.policy.status, 'not-configured');
    assert.equal(workspace.readiness.status, 'not-configured');
    assert.equal(Array.isArray(workspace.active_personas), true);
    assert.equal(Array.isArray(workspace.providers), true);
    assert.equal(workspace.providers.every((provider) => !('path' in provider) && !('entrypoint' in provider)), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('security provider guidance exposes official sources, capabilities and cautions', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-security-cli-providers-'));
  try {
    initProject(root, { name: 'Security Provider CLI Test' });
    const result = runCli(root, ['security', 'providers', '--json']);
    assert.equal(result.status, 0, result.stderr);
    const discovery = JSON.parse(result.stdout);
    assert.equal(discovery.assurance_notice, ASSURANCE_NOTICE);
    assert.deepEqual(discovery.providers.map((provider) => provider.id), ['agentic-security', 'deepsec', 'visa-vvah']);
    assert.equal(discovery.providers[0].official_sources[0], 'https://github.com/Clear-Capabilities/agentic-security');
    assert.deepEqual(discovery.providers[1].official_sources, [
      'https://github.com/vercel-labs/deepsec',
      'https://www.npmjs.com/package/deepsec',
    ]);
    assert.deepEqual(discovery.providers[2].official_sources, [
      'https://github.com/visa/visa-vulnerability-agentic-harness',
    ]);
    assert.deepEqual(discovery.providers[2].capabilities, ['source-static']);
    assert.equal(discovery.providers[2].artifact_import_supported, false);
    assert.equal(discovery.providers[2].cautions.some((caution) => caution.includes('--stop-after s9')), true);
    assert.equal(discovery.providers.every((provider) => provider.capabilities.length && provider.cautions.length), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('security output and errors always lead with the assurance notice', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-security-cli-notice-'));
  try {
    initProject(root, { name: 'Security Notice CLI Test' });
    const textResult = runCli(root, ['security', 'status']);
    assert.equal(textResult.status, 0, textResult.stderr);
    assert.equal(textResult.stdout.startsWith(`${ASSURANCE_NOTICE}\n\n`), true);

    const errorResult = runCli(root, ['security', 'unknown', '--json']);
    assert.equal(errorResult.status, 1);
    const error = JSON.parse(errorResult.stderr);
    assert.equal(error.assurance_notice, ASSURANCE_NOTICE);
    assert.match(error.error, /Unknown security command/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
