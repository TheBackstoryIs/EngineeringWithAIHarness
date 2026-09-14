import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const cli = resolve(root, 'bin/ewai');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

test('packages the governed context skill and operating guide', () => {
  const skillPath = 'skills-src/ewai-context/SKILL.md';
  const guidePath = 'Docs/context-management-and-token-efficiency.md';
  assert.equal(existsSync(resolve(root, skillPath)), true);
  assert.equal(existsSync(resolve(root, guidePath)), true);

  const skill = read(skillPath);
  const guide = read(guidePath);
  const docsIndex = read('Docs/README.md');
  const guideCatalogue = read('Docs/guide-catalogue.md');
  assert.match(skill, /^---\nname: ewai-context\n/);
  assert.match(skill, /seven.+profiles|seven governed profiles/is);
  assert.match(skill, /mandatory.+100%|100%.+mandatory/is);
  assert.match(skill, /active persona.+name.+tier.+engagement reason/is);
  for (const tier of ['project', 'core', 'premium', 'personal']) assert.match(skill, new RegExp(tier, 'i'));
  assert.match(skill, /premium.+installed/is);
  assert.doesNotMatch(skill, /persona premium sync|premium persona (?:sync|download|update)/i);
  assert.match(skill, /non-ready.+mandatory-overflow/is);
  assert.match(skill, /cannot approve Build or Manual QA/i);
  assert.match(skill, /context benchmark/);

  assert.match(guide, /AI context diagnostics/);
  assert.match(guide, /Configuration.+enable.+save/is);
  assert.match(guide, /ewai context prepare/);
  assert.match(guide, /ewai context benchmark/);
  assert.match(guide, /maintainers\/context-benchmarks\.md/);
  const benchmarks = read('Docs/maintainers/context-benchmarks.md');
  assert.match(benchmarks, /40%/);
  assert.match(benchmarks, /75 ms/);
  assert.match(benchmarks, /32 MiB/);
  assert.match(guide, /provider-reported.+estimated/is);
  assert.match(guide, /mandatory-overflow/);
  assert.match(guide, /active persona/i);
  assert.match(guide, /(?:does not|doesn't|cannot) approve Build/i);
  assert.match(docsIndex, /guide-catalogue\.md/);
  assert.match(guideCatalogue, /context-management-and-token-efficiency/);
});

test('runs the committed seven-profile engineering performance benchmark', () => {
  const result = spawnSync(process.execPath, [cli, 'context', 'benchmark', '--samples', '3', '--json'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema, 'ewai.context-benchmark/v1');
  assert.equal(report.status, 'pass');
  assert.equal(report.profiles.length, 7);
  assert.equal(report.aggregate.profileCoverage, true);
  assert.ok(report.aggregate.medianReductionPercent >= 40);
  assert.ok(report.performance.medianPreparationMs <= 75);
  assert.ok(report.performance.peakRssGrowthBytes <= 32 * 1024 * 1024);
  assert.equal(report.profiles.every((profile) => profile.mandatoryRecall === 1), true);
});

test('declares benchmark assets and syntax checks in the npm package contract', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.scripts['context:benchmark'], 'node bin/ewai context benchmark --json');
  assert.equal(packageJson.files.includes('tests/fixtures/context-benchmarks.json'), true);
  assert.match(packageJson.scripts.check, /src\/runtime\/context-assembly\.mjs/);
  assert.match(packageJson.scripts.check, /src\/runtime\/context-benchmarks\.mjs/);
});
