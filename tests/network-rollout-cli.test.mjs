import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { initProject } from '../src/project.mjs';
import { ROLLOUT_ADVISORY_NOTICE, ROLLOUT_ASSURANCE_NOTICE } from '../src/network-rollout.mjs';

const cli = resolve(import.meta.dirname, '../bin/ewai');

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-rollout-cli-'));
  initProject(root, { name: 'Rollout CLI fixture' });
  const configPath = resolve(root, 'SPECS/pipeline.yaml');
  const config = YAML.parse(readFileSync(configPath, 'utf8'));
  config.blueprints = { organisation: {
    root: { id: 'org.example.standard', version: '1.0.0', digest: `sha256:${'b'.repeat(64)}` },
    packs: [{ id: 'org.example.standard', version: '1.0.0', digest: `sha256:${'b'.repeat(64)}` }],
    selection_digest: `sha256:${'b'.repeat(64)}`,
    enabled_modules: ['core'], applied_modules: ['core'], approved_by: 'Owner',
    approved_at: '2026-08-20T10:00:00.000Z', evidence: 'SPECS/5.Strategy/organisation-blueprint.md',
  } };
  writeFileSync(configPath, YAML.stringify(config, { lineWidth: 0 }));
  mkdirSync(resolve(root, 'SPECS/1.Scope'), { recursive: true });
  writeFileSync(resolve(root, 'SPECS/1.Scope/portfolio.yaml'), YAML.stringify({
    schema: 'ewai.portfolio/v1', id: 'cli-portfolio', name: 'CLI portfolio', owner: 'Portfolio Owner',
    members: [
      { id: 'network', kind: 'portfolio', name: 'Network', owner: 'Portfolio Owner' },
      { id: 'host', kind: 'project', name: 'Host project', owner: 'Host Owner', parent: 'network', repository: 'application', project_path: '.' },
    ],
    dependencies: [],
  }, { lineWidth: 0 }));
  writeFileSync(resolve(root, 'SPECS/1.Scope/rollout.yaml'), YAML.stringify({
    schema: 'ewai.rollout/v1', id: 'cli-rollout', name: 'CLI rollout', owner: 'Practice Owner', stale_after_days: 30,
    baselines: [{ id: 'standard', name: 'Standard', owner: 'Architecture Owner', pack: { id: 'org.example.standard', version: '1.0.0', digest: `sha256:${'b'.repeat(64)}` } }],
    cohorts: [{ id: 'wave-one', name: 'Wave one', baseline: 'standard', owner: 'Cohort Owner', review_by: '2026-09-30', required_evidence: ['blueprint'], projects: [{ id: 'host', owner: 'Host Owner' }] }],
  }, { lineWidth: 0 }));
  return root;
}

function runJson(root, args) {
  return JSON.parse(execFileSync(process.execPath, [cli, ...args, '--project', root, '--json'], { encoding: 'utf8' }));
}

test('documents and serves rollout validate status and assurance commands', () => {
  const root = fixture();
  try {
    const help = execFileSync(process.execPath, [cli, 'help'], { encoding: 'utf8' });
    assert.match(help, /rollout validate/);
    assert.match(help, /rollout status/);
    assert.match(help, /rollout assurance PROJECT_ID/);

    const validation = runJson(root, ['rollout', 'validate']);
    assert.equal(validation.schema, 'ewai.rollout-validation/v1');
    assert.equal(validation.valid, true);
    assert.equal(validation.cohortCount, 1);
    assert.equal(validation.notices.advisory, ROLLOUT_ADVISORY_NOTICE);

    const status = runJson(root, ['rollout', 'status', '--focus', 'cohort adoption']);
    assert.equal(status.schema, 'ewai.rollout-workspace/v1');
    assert.equal(status.cohorts[0].projects[0].adoption.state, 'aligned');
    assert.equal(status.notices.security, ROLLOUT_ASSURANCE_NOTICE);

    const assurance = runJson(root, ['rollout', 'assurance', 'host']);
    assert.equal(assurance.selectedAssurance.project.id, 'host');
    assert.equal(assurance.selectedAssurance.structuralOnly, true);
    assert.equal(assurance.selectedAssurance.adequacyVerdict, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects unsupported rollout authority and reports safe non-zero JSON', () => {
  const root = fixture();
  try {
    for (const args of [
      ['rollout', 'status', '--root', '/tmp/untrusted'],
      ['rollout', 'status', '--focus', 'x'.repeat(501)],
      ['rollout', 'assurance', 'unassigned'],
      ['rollout', 'validate', '--tenant', 'other'],
    ]) {
      const result = spawnSync(process.execPath, [cli, ...args, '--project', root, '--json'], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      const error = JSON.parse(result.stderr);
      assert.equal(error.notices.advisory, ROLLOUT_ADVISORY_NOTICE);
      assert.equal(error.notices.security, ROLLOUT_ASSURANCE_NOTICE);
      assert.equal(JSON.stringify(error).includes(root), false);
      assert.equal(JSON.stringify(error).includes('/tmp/untrusted'), false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
