import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { initProject } from '../src/project.mjs';

const cli = resolve(import.meta.dirname, '../bin/ewai');

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-design-cli-'));
  initProject(root, { name: 'Design CLI fixture' });
  const directory = resolve(root, '.ewai-pipeline/packs/northstar');
  mkdirSync(resolve(directory, 'principles'), { recursive: true });
  writeFileSync(resolve(directory, 'pack.yaml'), YAML.stringify({
    schema: 'ewai.pack/v1', id: 'org.northstar.design-system', name: 'Northstar',
    description: 'Northstar design.', version: '1.0.0', type: 'design-system', requires: [],
    design_system: {
      compatibility: { ewai: '0.x' },
      provenance: { kind: 'owner-declared', summary: 'Owner design guidance.' },
      contributions: [{ id: 'experience', kind: 'principles', title: 'Experience', source: 'principles/experience.md', applicability: ['prototype'], required: true }],
    },
  }, { lineWidth: 0 }));
  writeFileSync(resolve(directory, 'principles/experience.md'), '# Experience\n\nClear and calm.\n');
  return root;
}

function runJson(root, args) {
  return JSON.parse(execFileSync(process.execPath, [cli, ...args, '--project', root, '--json'], { encoding: 'utf8' }));
}

test('documents and serves design-system status list inspect resolve and select', () => {
  const root = fixture();
  try {
    const help = execFileSync(process.execPath, [cli, 'help'], { encoding: 'utf8' });
    assert.match(help, /design-system status\|list\|inspect\|resolve\|select/);
    assert.equal(runJson(root, ['design-system', 'status']).mode, 'fallback');
    assert.equal(runJson(root, ['design-system', 'list']).systems.some(({ id }) => id === 'org.northstar.design-system'), true);
    assert.equal(runJson(root, ['design-system', 'inspect', 'org.northstar.design-system']).id, 'org.northstar.design-system');
    const resolved = runJson(root, ['design-system', 'resolve', 'org.northstar.design-system']);
    assert.match(resolved.effectiveDigest, /^sha256:/);
    const selected = runJson(root, [
      'design-system', 'select', 'org.northstar.design-system', '--expected-digest', resolved.effectiveDigest,
      '--approved-by', 'Design Owner', '--yes',
    ]);
    assert.equal(selected.mode, 'selected');
    assert.equal(runJson(root, ['design-system', 'status']).approvedBy, 'Design Owner');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('design-system CLI rejects unconfirmed selection, root injection and digest drift', () => {
  const root = fixture();
  try {
    const resolved = runJson(root, ['design-system', 'resolve', 'org.northstar.design-system']);
    for (const args of [
      ['design-system', 'select', 'org.northstar.design-system', '--expected-digest', resolved.effectiveDigest, '--approved-by', 'Owner'],
      ['design-system', 'status', '--root', '/tmp/untrusted'],
      ['design-system', 'select', 'org.northstar.design-system', '--expected-digest', `sha256:${'0'.repeat(64)}`, '--approved-by', 'Owner', '--yes'],
    ]) {
      const result = spawnSync(process.execPath, [cli, ...args, '--project', root, '--json'], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stderr, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('companion status includes a safe effective design-system projection', () => {
  const root = fixture();
  try {
    const companion = runJson(root, ['companion', 'status']);
    assert.equal(companion.designSystem.mode, 'fallback');
    assert.equal(companion.designSystem.approved, false);
    assert.equal(JSON.stringify(companion.designSystem).includes(root), false);
    assert.equal(JSON.stringify(companion.designSystem).includes('Clear and calm'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
