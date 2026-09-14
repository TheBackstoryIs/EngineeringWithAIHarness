import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { initProject } from '../src/project.mjs';

const cli = resolve(import.meta.dirname, '../bin/ewai');

function fixture() {
  const project = mkdtempSync(resolve(tmpdir(), 'ewai-design-author-cli-project-'));
  const source = mkdtempSync(resolve(tmpdir(), 'ewai-design-author-cli-source-'));
  const home = mkdtempSync(resolve(tmpdir(), 'ewai-design-author-cli-home-'));
  initProject(project, { name: 'Author CLI fixture' });
  const folder = resolve(source, 'candidate');
  mkdirSync(resolve(folder, 'principles'), { recursive: true });
  writeFileSync(resolve(folder, 'pack.yaml'), YAML.stringify({
    schema: 'ewai.pack/v1', id: 'org.northstar.author-cli', name: 'Author CLI', description: 'Candidate.',
    version: '1.0.0', type: 'design-system', requires: [], design_system: {
      compatibility: { ewai: '0.x' }, provenance: { kind: 'owner-declared', summary: 'Owner evidence.' },
      contributions: [{ id: 'principles', kind: 'principles', title: 'Principles', source: 'principles/core.md', applicability: ['prototype'], required: true }],
    },
  }, { lineWidth: 0 }));
  writeFileSync(resolve(folder, 'principles/core.md'), '# Principles\n');
  return { project, source, home, folder };
}

function runJson(fixtureValue, args) {
  return JSON.parse(execFileSync(process.execPath, [cli, ...args, '--project', fixtureValue.project, '--json'], {
    encoding: 'utf8', env: { ...process.env, EWAI_TEST_HOME: fixtureValue.home },
  }));
}

test('documents validates and installs a design-system candidate through the CLI', () => {
  const value = fixture();
  try {
    const help = execFileSync(process.execPath, [cli, 'help'], { encoding: 'utf8' });
    assert.match(help, /design-system validate FOLDER/);
    assert.match(help, /design-system install FOLDER/);
    const validated = runJson(value, ['design-system', 'validate', value.folder]);
    assert.equal(validated.id, 'org.northstar.author-cli');
    const installed = runJson(value, [
      'design-system', 'install', value.folder, '--scope', 'project',
      '--expected-digest', validated.digest, '--yes',
    ]);
    assert.equal(installed.status, 'installed');
  } finally {
    rmSync(value.project, { recursive: true, force: true });
    rmSync(value.source, { recursive: true, force: true });
    rmSync(value.home, { recursive: true, force: true });
  }
});

test('CLI refuses unknown scope, root injection, missing confirmation and stale digest', () => {
  const value = fixture();
  try {
    const validated = runJson(value, ['design-system', 'validate', value.folder]);
    for (const args of [
      ['design-system', 'install', value.folder, '--scope', 'unknown', '--expected-digest', validated.digest, '--yes'],
      ['design-system', 'validate', value.folder, '--root', '/tmp/untrusted'],
      ['design-system', 'install', value.folder, '--scope', 'project', '--expected-digest', validated.digest],
      ['design-system', 'install', value.folder, '--scope', 'project', '--expected-digest', `sha256:${'0'.repeat(64)}`, '--yes'],
    ]) {
      const result = spawnSync(process.execPath, [cli, ...args, '--project', value.project, '--json'], {
        encoding: 'utf8', env: { ...process.env, EWAI_TEST_HOME: value.home },
      });
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stderr, new RegExp(value.project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  } finally {
    rmSync(value.project, { recursive: true, force: true });
    rmSync(value.source, { recursive: true, force: true });
    rmSync(value.home, { recursive: true, force: true });
  }
});
