import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCompletedEvidenceFixture } from './helpers/team-hub-operational-fixtures.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 60_000,
    ...options,
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

function installedCli(consumerRoot, args, options = {}) {
  return execute(process.execPath, [resolve(consumerRoot, 'node_modules/.bin/ewai'), ...args], options);
}

function parsed(result) {
  const value = result.status === 0 ? result.stdout : result.stderr;
  return JSON.parse(value);
}

test('the packed npm artefact operates independently for Team Hub and evidence recovery', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-packed-consumer-'));
  const packRoot = resolve(root, 'packed');
  const consumerRoot = resolve(root, 'consumer');
  const dataRoot = resolve(root, 'hub-data');
  const evidenceRoot = resolve(root, 'evidence-project');
  const tokenEnv = 'EWAI_PACKED_TEAM_HUB_TOKEN';
  mkdirSync(packRoot, { recursive: true });
  mkdirSync(consumerRoot, { recursive: true });
  writeFileSync(resolve(consumerRoot, 'package.json'), `${JSON.stringify({ private: true }, null, 2)}\n`);

  let started = false;
  try {
    const packed = execute('npm', ['pack', '--json', '--pack-destination', packRoot], { cwd: repositoryRoot });
    assert.equal(packed.status, 0, packed.stderr);
    const manifest = JSON.parse(packed.stdout);
    assert.equal(manifest.length, 1);
    const tarball = resolve(packRoot, manifest[0].filename);

    const packageRoot = resolve(consumerRoot, 'node_modules/@thebackstoryis/engineering-with-ai');
    mkdirSync(packageRoot, { recursive: true });
    const extracted = execute('tar', ['-xzf', tarball, '--strip-components=1', '-C', packageRoot]);
    assert.equal(extracted.status, 0, extracted.stderr);

    const packedManifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
    for (const dependency of Object.keys(packedManifest.dependencies ?? {})) {
      const destination = resolve(consumerRoot, 'node_modules', dependency);
      mkdirSync(dirname(destination), { recursive: true });
      symlinkSync(resolve(repositoryRoot, 'node_modules', dependency), destination, 'dir');
    }
    const binRoot = resolve(consumerRoot, 'node_modules/.bin');
    mkdirSync(binRoot, { recursive: true });
    symlinkSync(resolve(packageRoot, packedManifest.bin.ewai), resolve(binRoot, 'ewai'));

    const cliPath = resolve(consumerRoot, 'node_modules/.bin/ewai');
    const resolvedCli = realpathSync(cliPath);
    assert.equal(resolvedCli.startsWith(repositoryRoot), false, 'the test must execute the consumer-installed CLI');
    assert.equal(resolvedCli.startsWith(realpathSync(consumerRoot)), true);

    const help = installedCli(consumerRoot, ['help']);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /team-hub start\|status\|stop/);
    assert.match(help.stdout, /delivery evidence-amendment SLUG/);

    const environment = { ...process.env, [tokenEnv]: 'packed-team-hub-token-with-enough-entropy' };
    const start = installedCli(consumerRoot, [
      'team-hub', 'start', '--data', dataRoot, '--token-env', tokenEnv, '--json',
    ], { env: environment });
    assert.equal(start.status, 0, start.stderr);
    assert.equal(parsed(start).status, 'running');
    started = true;

    const status = installedCli(consumerRoot, ['team-hub', 'status', '--data', dataRoot, '--json'], { env: environment });
    assert.equal(status.status, 0, status.stderr);
    assert.equal(parsed(status).status, 'running');

    mkdirSync(evidenceRoot, { recursive: true });
    createCompletedEvidenceFixture(evidenceRoot, 'packed-evidence');
    const preview = installedCli(consumerRoot, [
      'delivery', 'evidence-amendment', 'packed-evidence', '--project', evidenceRoot, '--json',
    ], { env: environment });
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(parsed(preview).status, 'changes-found');

    const installedPackage = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
    assert.equal(installedPackage.name, '@thebackstoryis/engineering-with-ai');
  } finally {
    if (started) installedCli(consumerRoot, ['team-hub', 'stop', '--data', dataRoot, '--json']);
    rmSync(root, { recursive: true, force: true });
  }
});
