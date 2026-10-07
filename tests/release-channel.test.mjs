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

test('the public release has consistent metadata and channel-specific installation guidance', () => {
  const metadata = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(resolve('package-lock.json'), 'utf8'));
  const readme = readFileSync(resolve('README.md'), 'utf8');
  const channel = publishTagForVersion(metadata.version);
  assert.match(metadata.version, /^\d+\.\d+\.\d+(?:-beta\.\d+)?$/);
  const releaseHeading = '## New in ' + metadata.version.replace(/-beta\.(\d+)$/, ' Beta $1 release');
  assert.ok(readme.includes('`' + metadata.version + '`') || readme.split('\n').includes(releaseHeading), 'README describes the packaged version');
  assert.equal(lock.version, metadata.version);
  assert.equal(lock.packages[''].version, metadata.version);
  assert.match(readme, /EWAI can now pick up the next ready piece of work/);
  assert.match(readme, /final whole-delivery test stage, Manual QA and release preparation still happen through the normal EWAI workflow/);
  assert.match(readme, /brings the capability out of beta/);
  assert.match(readme, /npm install --save-dev @thebackstoryis\/engineering-with-ai\n/);
  if (channel === 'beta') {
    assert.match(readme, /npm install --save-dev @thebackstoryis\/engineering-with-ai@beta\n/);
    const guide = readFileSync(resolve('Docs/context-management-and-token-efficiency.md'), 'utf8');
    assert.ok(guide.includes('`' + metadata.version + '`'), 'User guidance identifies the beta version');
    assert.match(guide, /incremental token or cost saving has been measured/);
    const releaseNote = readFileSync(resolve('Docs/releases', metadata.version + '.md'), 'utf8');
    assert.ok(readme.includes(releaseNote.replace(/^# /, '## ')), 'README and release note contain the same release section');
  } else {
    assert.equal(channel, 'latest');
  }
});

test('tag-triggered publication selects beta explicitly and never defaults a beta to latest', () => {
  const workflow = readFileSync(resolve('.github/workflows/publish.yml'), 'utf8');
  assert.match(workflow, /node scripts\/publish-tag\.mjs/);
  assert.match(workflow, /npm publish --tag/);
  assert.doesNotMatch(workflow, /^\s*run:\s*npm publish\s*$/m);
});
