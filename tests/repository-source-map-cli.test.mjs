import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { initProject } from '../src/project.mjs';
import { refreshRepositoryIndex, repositoryIndexFreshness } from '../src/runtime/repository-index.mjs';

const cli = resolve(import.meta.dirname, '../bin/ewai');

function runCli(root, args) {
  return spawnSync(process.execPath, [cli, ...args, '--project', root], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  });
}

test('exposes safe Source Map coverage profile and file projections through the CLI', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-source-map-cli-'));
  try {
    initProject(root, { name: 'Source Map CLI Test' });
    mkdirSync(resolve(root, 'fixtures'), { recursive: true });
    writeFileSync(resolve(root, 'fixtures/app.ts'), 'export function run() { return true; }\n');
    writeFileSync(resolve(root, 'fixtures/config.json'), '{"credential":"must-not-appear"}\n');
    writeFileSync(resolve(root, 'fixtures/image.bin'), Buffer.from([0, 1, 2, 3]));
    refreshRepositoryIndex(root);
    mkdirSync(resolve(root, 'SPECS/3.Evidence/runtime'), { recursive: true });
    writeFileSync(resolve(root, 'SPECS/3.Evidence/runtime/assessment.md'), '# Runtime evidence\n');
    assert.equal(repositoryIndexFreshness(root).status, 'fresh');

    const coverageResult = runCli(root, ['index', 'coverage', '--json']);
    assert.equal(coverageResult.status, 0, coverageResult.stderr);
    const coverage = JSON.parse(coverageResult.stdout);
    assert.equal(coverage.schema, 'ewai.repository-source-map-coverage/v1');
    assert.equal(coverage.totalFiles >= 3, true);
    assert.equal(coverage.outcomes.inventory_only >= 1, true);
    assert.equal(coverage.guidance.advisory, true);

    const profilesResult = runCli(root, ['index', 'profiles', '--source', 'core', '--limit', '5', '--json']);
    assert.equal(profilesResult.status, 0, profilesResult.stderr);
    const profiles = JSON.parse(profilesResult.stdout);
    assert.equal(profiles.schema, 'ewai.repository-source-map-profiles/v1');
    assert.equal(profiles.profiles.length, 5);
    assert.equal(profiles.profiles.every((profile) => profile.sourceKind === 'core'), true);
    assert.equal(profiles.profiles.every((profile) => Number.isInteger(profile.matchCount)), true);

    const filesResult = runCli(root, ['index', 'files', '--outcome', 'inventory_only', '--repository', 'application', '--limit', '10', '--json']);
    assert.equal(filesResult.status, 0, filesResult.stderr);
    const files = JSON.parse(filesResult.stdout);
    assert.equal(files.schema, 'ewai.repository-source-map-files/v1');
    assert.equal(files.files.some((file) => file.path === 'fixtures/image.bin'), true);
    assert.equal(files.files.every((file) => file.analysisOutcome === 'inventory_only'), true);

    const projection = JSON.stringify({ coverage, profiles, files });
    assert.equal(projection.includes(root), false);
    assert.equal(projection.includes('must-not-appear'), false);
    assert.equal(projection.includes('fingerprint'), false);
    assert.equal(projection.includes('metadata_json'), false);

    for (const args of [
      ['index', 'profiles', '--source', 'remote'],
      ['index', 'profiles', '--analyser', './plugin.mjs'],
      ['index', 'files', '--outcome', 'complete'],
      ['index', 'files', '--query', 'x'.repeat(241)]
    ]) {
      const rejected = runCli(root, args);
      assert.notEqual(rejected.status, 0);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('documents Source Map inspection commands in CLI help', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-source-map-cli-help-'));
  try {
    initProject(root, { name: 'Source Map CLI Help Test' });
    const result = runCli(root, ['help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ewai index coverage/);
    assert.match(result.stdout, /ewai index profiles/);
    assert.match(result.stdout, /ewai index files/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('documents Source Map profiles, topologies, personas, and platform export boundaries', () => {
  const guide = readFileSync(resolve(import.meta.dirname, '../Docs/repository-source-map-guide.md'), 'utf8');
  assert.match(guide, /ewai index coverage/);
  assert.match(guide, /ewai_source_map_profiles/);
  assert.match(guide, /### Single repository/);
  assert.match(guide, /### Monorepo/);
  assert.match(guide, /### Folder containing repository subfolders/);
  assert.match(guide, /installed premium personas/);
  assert.match(guide, /project-local personas/);
  assert.match(guide, /Power Platform and Salesforce exports/);
  assert.match(guide, /ewai\.technology\.power-platform/);
  assert.match(guide, /ewai\.technology\.salesforce/);
  assert.match(guide, /power-platform-metadata/);
  assert.match(guide, /salesforce-metadata/);
  assert.match(guide, /does not extract ZIP or `\.msapp` archives/);
  assert.match(guide, /platform-export-analysis-guide\.md/);
  assert.match(guide, /evidence, not approval/);
});
