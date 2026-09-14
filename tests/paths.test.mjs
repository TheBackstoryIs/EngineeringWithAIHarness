import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { resolveProjectRoot } from '../src/paths.mjs';

test('resolves the nearest Git project from a nested directory', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-paths-'));
  mkdirSync(resolve(root, '.git'));
  mkdirSync(resolve(root, 'apps/web/src'), { recursive: true });

  try {
    assert.equal(resolveProjectRoot(resolve(root, 'apps/web/src')), realpathSync(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails rather than silently binding to an unrelated directory', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-unbound-'));
  try {
    assert.throws(() => resolveProjectRoot(root), /No EWAI project or Git repository/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
