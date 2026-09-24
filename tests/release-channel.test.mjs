import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { publishTagForVersion } from '../scripts/publish-tag.mjs';

test('release channel selection keeps beta away from stable and rejects unknown prereleases', () => {
  assert.equal(publishTagForVersion('0.3.0-beta.0'), 'beta');
  assert.equal(publishTagForVersion('0.3.0-beta.12'), 'beta');
  assert.equal(publishTagForVersion('0.3.0'), 'latest');
  assert.throws(() => publishTagForVersion('0.3.0-rc.0'), /Unsupported npm release version/);
});

test('the public beta has a visible release note and a distinct prerelease version', () => {
  const metadata = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(resolve('package-lock.json'), 'utf8'));
  const readme = readFileSync(resolve('README.md'), 'utf8');
  assert.equal(metadata.version, '0.3.0-beta.1');
  assert.equal(lock.version, metadata.version);
  assert.equal(lock.packages[''].version, metadata.version);
  assert.match(readme, /EWAI can now pick up the next ready piece of work/);
  assert.match(readme, /final whole-delivery test stage, Manual QA and release preparation still happen through the normal EWAI workflow/);
  assert.match(readme, /@thebackstoryis\/engineering-with-ai@beta/);
});

test('tag-triggered publication selects beta explicitly and never defaults a beta to latest', () => {
  const workflow = readFileSync(resolve('.github/workflows/publish.yml'), 'utf8');
  assert.match(workflow, /node scripts\/publish-tag\.mjs/);
  assert.match(workflow, /npm publish --tag/);
  assert.doesNotMatch(workflow, /^\s*run:\s*npm publish\s*$/m);
});
