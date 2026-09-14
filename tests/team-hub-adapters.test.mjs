import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { initProject } from '../src/project.mjs';

const cli = resolve(import.meta.dirname, '../bin/ewai');

function project() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-cli-'));
  initProject(root, { name: 'Team Hub CLI project' });
  return root;
}

function run(root, args, env = process.env) {
  return spawnSync(process.execPath, [cli, ...args, '--project', root, '--json'], { encoding: 'utf8', env });
}

test('local Team Hub CLI supports status disclosure connect and disconnect with confirmations', () => {
  const root = project();
  try {
    const help = execFileSync(process.execPath, [cli, 'help'], { encoding: 'utf8' });
    assert.match(help, /team status\|disclosure\|connect\|sync\|disconnect/);
    assert.match(help, /team-hub start\|status\|stop/);
    assert.match(help, /team status\|disclosure\|connect\|sync\|disconnect\|resources/);
    assert.match(help, /team resource inspect/);
    assert.match(help, /team resource install/);
    assert.match(help, /team-hub resource publish/);
    const status = JSON.parse(run(root, ['team', 'status']).stdout);
    assert.equal(status.mode, 'single');
    const disclosure = JSON.parse(run(root, ['team', 'disclosure']).stdout);
    assert.equal(disclosure.schema, 'ewai.team-hub-disclosure/v1');

    const unconfirmed = run(root, ['team', 'connect', 'http://127.0.0.1:49001', '--token-env', 'EWAI_TEAM_HUB_CLI_TEST']);
    assert.notEqual(unconfirmed.status, 0);
    assert.match(JSON.parse(unconfirmed.stderr).error, /--yes/);
    const unsafeFlag = run(root, [
      'team', 'connect', 'http://127.0.0.1:49001', '--token-env', 'EWAI_TEAM_HUB_CLI_TEST',
      '--token', 'must-not-be-accepted', '--acknowledge-disclosure', '--yes',
    ]);
    assert.notEqual(unsafeFlag.status, 0);
    assert.match(JSON.parse(unsafeFlag.stderr).error, /Unsupported team argument: --token/);
    const connected = JSON.parse(run(root, [
      'team', 'connect', 'http://127.0.0.1:49001', '--token-env', 'EWAI_TEAM_HUB_CLI_TEST',
      '--project-id', 'cli-project', '--acknowledge-disclosure', '--yes',
    ]).stdout);
    assert.equal(connected.projectId, 'cli-project');
    assert.equal(JSON.parse(run(root, ['team', 'status']).stdout).mode, 'connected');
    const disconnected = JSON.parse(run(root, ['team', 'disconnect', '--yes']).stdout);
    assert.equal(disconnected.mode, 'single');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Team Hub resource CLI publishes, discovers, inspects and explicitly installs one exact release', () => {
  const root = project();
  const dataRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-cli-resource-data-'));
  const packRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-cli-resource-pack-'));
  const readerEnv = 'EWAI_TEAM_HUB_CLI_RESOURCE_READER';
  const publisherEnv = 'EWAI_TEAM_HUB_CLI_RESOURCE_PUBLISHER';
  const env = {
    ...process.env,
    [readerEnv]: 'team-hub-cli-reader-token-value',
    [publisherEnv]: 'team-hub-cli-publisher-token-value',
  };
  mkdirSync(resolve(packRoot, 'standards'), { recursive: true });
  writeFileSync(resolve(packRoot, 'standards/api.md'), '# API standard\n');
  writeFileSync(resolve(packRoot, 'pack.yaml'), `schema: ewai.pack/v1
id: org.acme.cli-baseline
name: Acme CLI baseline
description: CLI registry fixture
version: 1.0.0
type: organisation
requires: []
blueprint:
  publisher: { id: acme, name: Acme }
  compatibility: { ewai: 0.x }
  modules:
    - id: delivery
      name: Delivery
      description: Shared standards
      required: true
      standards: [{ id: api, title: API, source: standards/api.md }]
      personas: []
      policies: []
      design_systems: []
      starter_packs: []
      boilerplates: []
`);
  try {
    const started = run(root, ['team-hub', 'start', '--data', dataRoot, '--token-env', readerEnv, '--publisher-token-env', publisherEnv], env);
    assert.equal(started.status, 0, started.stderr);
    const endpoint = JSON.parse(started.stdout).url;
    const published = run(root, ['team-hub', 'resource', 'publish', packRoot, '--data', dataRoot, '--publisher-token-env', publisherEnv, '--yes'], env);
    assert.equal(published.status, 0, published.stderr);
    const publication = JSON.parse(published.stdout);
    assert.match(publication.packageDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(published.stdout.includes(env[publisherEnv]), false);

    const connected = run(root, ['team', 'connect', endpoint, '--project-id', 'cli-resource-project', '--token-env', readerEnv, '--acknowledge-disclosure', '--yes'], env);
    assert.equal(connected.status, 0, connected.stderr);
    const catalogue = JSON.parse(run(root, ['team', 'resources'], env).stdout);
    assert.equal(catalogue.releases.length, 1);
    const inspected = JSON.parse(run(root, ['team', 'resource', 'inspect', 'org.acme.cli-baseline', '1.0.0'], env).stdout);
    assert.equal(inspected.digest, publication.packageDigest);
    const installed = run(root, ['team', 'resource', 'install', 'org.acme.cli-baseline', '1.0.0', '--expected-digest', inspected.digest, '--approved-by', 'CLI Owner', '--yes'], env);
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(JSON.parse(installed.stdout).receipt.action, 'installed');
    const receipts = JSON.parse(run(root, ['team', 'resource', 'receipts'], env).stdout);
    assert.equal(receipts.receipts.length, 1);
    assert.equal(JSON.stringify(receipts).includes(env[readerEnv]), false);
  } finally {
    run(root, ['team-hub', 'stop', '--data', dataRoot], env);
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(packRoot, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('service Team Hub CLI starts, reports and stops a separate managed process', () => {
  const root = project();
  const dataRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-cli-service-'));
  const env = { ...process.env, EWAI_TEAM_HUB_CLI_SERVICE: 'team-hub-cli-service-token-value' };
  try {
    const started = run(root, ['team-hub', 'start', '--data', dataRoot, '--token-env', 'EWAI_TEAM_HUB_CLI_SERVICE'], env);
    assert.equal(started.status, 0, started.stderr);
    assert.equal(JSON.parse(started.stdout).status, 'running');
    const status = run(root, ['team-hub', 'status', '--data', dataRoot], env);
    assert.equal(JSON.parse(status.stdout).status, 'running');
    assert.equal(status.stdout.includes(env.EWAI_TEAM_HUB_CLI_SERVICE), false);
    const stopped = run(root, ['team-hub', 'stop', '--data', dataRoot], env);
    assert.equal(JSON.parse(stopped.stdout).status, 'stopped');
  } finally {
    run(root, ['team-hub', 'stop', '--data', dataRoot], env);
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
