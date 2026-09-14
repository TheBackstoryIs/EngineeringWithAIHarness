import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { initProject } from '../src/project.mjs';

const cli = resolve(import.meta.dirname, '../bin/ewai');

function runCli(root, args) {
  return spawnSync(process.execPath, [cli, ...args, '--project', root], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

test('starter status returns the safe workspace and active personas', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-starter-cli-status-'));
  try {
    initProject(root, { name: 'Starter CLI Test' });
    const result = runCli(root, ['starter', 'status', '--json']);
    assert.equal(result.status, 0, result.stderr);
    const workspace = JSON.parse(result.stdout);
    assert.equal(workspace.schema, 'ewai.starter-materialisation-workspace/v1');
    assert.equal(workspace.activePersonas.some(({ id }) => id === 'ewai.core.operator'), true);
    assert.equal(workspace.activePersonas.some(({ id }) => id === 'ewai.core.maintainer'), true);
    assert.equal(JSON.stringify(workspace).includes(root), false);
    assert.equal(JSON.stringify(workspace).includes('entrypoint'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('starter command family documents the guarded public operations', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-starter-cli-help-'));
  try {
    initProject(root, { name: 'Starter CLI Help Test' });
    const result = runCli(root, ['help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /starter status/);
    assert.match(result.stdout, /starter digest ROLE=FOLDER/);
    assert.match(result.stdout, /starter adapter-validate FOLDER/);
    assert.match(result.stdout, /starter adapter-register FOLDER --yes/);
    assert.match(result.stdout, /starter preview RECEIPT --adapter ADAPTER --yes/);
    assert.match(result.stdout, /starter apply PREVIEW --yes --approved-by NAME/);
    assert.match(result.stdout, /starter recover ATTEMPT --yes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('starter digest calculates the canonical aggregate without exposing source folders', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-starter-cli-digest-'));
  try {
    initProject(root, { name: 'Starter Digest Test' });
    const api = resolve(root, 'reviewed/api');
    const web = resolve(root, 'reviewed/web');
    mkdirSync(api, { recursive: true });
    mkdirSync(web, { recursive: true });
    writeFileSync(resolve(api, 'service.txt'), 'api\n');
    writeFileSync(resolve(web, 'client.txt'), 'web\n');
    const result = runCli(root, ['starter', 'digest', `api=${api}`, `web=${web}`, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const digest = JSON.parse(result.stdout);
    assert.equal(digest.schema, 'ewai.governed-starter-pack-digest/v1');
    assert.deepEqual(digest.targets.map(({ role, files }) => ({ role, files })), [{ role: 'api', files: 1 }, { role: 'web', files: 1 }]);
    assert.match(digest.digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(digest).includes(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('starter mutations require exact confirmation and named approval', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-starter-cli-guards-'));
  try {
    initProject(root, { name: 'Starter CLI Guard Test' });
    const registration = runCli(root, ['starter', 'adapter-register', resolve(root, 'missing')]);
    assert.equal(registration.status, 1);
    assert.match(registration.stderr, /requires --yes/i);

    const preview = runCli(root, ['starter', 'preview', 'org.example:module:starter', '--adapter', 'org.example.adapter']);
    assert.equal(preview.status, 1);
    assert.match(preview.stderr, /requires --yes/i);

    const apply = runCli(root, ['starter', 'apply', 'preview-id', '--yes']);
    assert.equal(apply.status, 1);
    assert.match(apply.stderr, /requires --approved-by/i);

    const recovery = runCli(root, ['starter', 'recover', 'attempt-id']);
    assert.equal(recovery.status, 1);
    assert.match(recovery.stderr, /requires --yes/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('starter rejects unknown operations without treating them as success', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-starter-cli-unknown-'));
  try {
    initProject(root, { name: 'Starter CLI Unknown Test' });
    const result = runCli(root, ['starter', 'connect-provider', '--json']);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stderr).error, /Unknown starter command/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('starter implementer guide preserves the public safety and topology contract', () => {
  const guide = readFileSync(resolve(import.meta.dirname, '../Docs/governed-starter-project-materialisation-guide.md'), 'utf8');
  assert.match(guide, /single repository, a monorepo, and a workspace containing several independent Git repositories/i);
  assert.match(guide, /starter_packs/);
  assert.match(guide, /ewai starter digest/);
  assert.match(guide, /ewai starter adapter-register/);
  assert.match(guide, /ewai starter preview/);
  assert.match(guide, /ewai starter apply/);
  assert.match(guide, /ewai starter recover/);
  assert.match(guide, /project, premium, and core persona lenses/i);
  assert.match(guide, /evidence, not security certification/i);
  assert.match(guide, /never overwrites, merges, deletes, or forces/i);
});
