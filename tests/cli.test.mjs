import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(import.meta.dirname, '..');

test('CLI documents completed evidence amendment preview and exact apply authority', () => {
  const result = spawnSync(process.execPath, [resolve(projectRoot, 'bin/ewai'), '--help'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ewai delivery evidence-amendment SLUG/);
  assert.match(result.stdout, /--expected-state-digest DIGEST/);
  assert.match(result.stdout, /--approved-by NAME/);
  assert.match(result.stdout, /--reason TEXT/);

  const guide = readFileSync(resolve(projectRoot, 'Docs/completed-phase-evidence-amendments.md'), 'utf8');
  assert.match(guide, /does not reopen/i);
  assert.match(guide, /unchanged.*gate ledger/i);
  assert.match(guide, /Manual QA/i);
});
