import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { initProject } from '../src/project.mjs';
import { buildTeamHubResourcePackage } from '../src/team-hub-resources.mjs';
import {
  ingestTeamHubEnvelope,
  openTeamHubDatabase,
  readTeamHubPortfolio,
} from '../src/runtime/team-hub-database.mjs';
import {
  connectTeamHub,
  installConnectedTeamHubResource,
  listTeamHubResourceReceipts,
  readTeamHubResourceState,
} from '../src/runtime/team-hub-client.mjs';
import { runtimePaths } from '../src/runtime/paths.mjs';
import { organisationPack, teamHubEnvelope } from './helpers/team-hub-operational-fixtures.mjs';

const databaseModule = new URL('../src/runtime/team-hub-database.mjs', import.meta.url).href;

const publisherWorker = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const { openTeamHubDatabase, publishTeamHubResource } = await import(workerData.moduleUrl);
  const control = new Int32Array(workerData.control);
  Atomics.add(control, 0, 1);
  parentPort.postMessage({ type: 'ready' });
  Atomics.wait(control, 1, 0);
  const database = openTeamHubDatabase(workerData.dataRoot);
  try {
    const result = publishTeamHubResource(database, workerData.resourcePackage, workerData.options);
    parentPort.postMessage({ type: 'result', result });
  } catch (error) {
    parentPort.postMessage({ type: 'result', error: { code: error.code, status: error.status, message: error.message } });
  } finally {
    database.close();
  }
})().catch((error) => parentPort.postMessage({ type: 'result', error: { message: error.message } }));
`;

async function concurrentPublications(dataRoot, packages) {
  const initial = openTeamHubDatabase(dataRoot);
  initial.close();
  const controlBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
  const control = new Int32Array(controlBuffer);
  const workers = packages.map((resourcePackage, index) => new Worker(publisherWorker, {
    eval: true,
    workerData: {
      moduleUrl: databaseModule,
      dataRoot,
      resourcePackage,
      control: controlBuffer,
      options: { receiptId: `concurrent-${index}`, at: `2026-08-31T09:00:0${index}.000Z` },
    },
  }));
  const results = workers.map((worker) => new Promise((resolveResult, reject) => {
    worker.on('message', (message) => {
      if (message.type === 'result') resolveResult(message);
    });
    worker.on('error', reject);
    worker.on('exit', (code) => { if (code !== 0) reject(new Error(`Publisher worker exited ${code}.`)); });
  }));
  await Promise.all(workers.map((worker) => new Promise((resolveReady, reject) => {
    worker.on('message', (message) => { if (message.type === 'ready') resolveReady(); });
    worker.on('error', reject);
  })));
  assert.equal(Atomics.load(control, 0), workers.length);
  Atomics.store(control, 1, 1);
  Atomics.notify(control, 1, workers.length);
  return Promise.all(results);
}

test('late snapshots retain immutable receipts without regressing current project truth', () => {
  const dataRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-ordering-'));
  let database = openTeamHubDatabase(dataRoot);
  try {
    ingestTeamHubEnvelope(database, teamHubEnvelope('ordered-project', 'New name', '2026-08-31T09:00:00.000Z', 'b'), { receiptId: 'newer-receipt', at: '2026-08-31T09:01:00.000Z' });
    const late = ingestTeamHubEnvelope(database, teamHubEnvelope('ordered-project', 'Old name', '2026-08-30T09:00:00.000Z', 'a'), { receiptId: 'late-receipt', at: '2026-08-31T09:02:00.000Z' });
    assert.equal(late.receiptId, 'late-receipt');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM team_hub_receipts').get().count, 2);
    let portfolio = readTeamHubPortfolio(database, { now: '2026-08-31T09:03:00.000Z' });
    assert.equal(portfolio.projects[0].name, 'New name');
    assert.equal(portfolio.projects[0].evidence.receiptId, 'newer-receipt');
    assert.equal(portfolio.projects[0].evidence.submittedAt, '2026-08-31T09:00:00.000Z');

    database.close();
    database = openTeamHubDatabase(dataRoot);
    portfolio = readTeamHubPortfolio(database, { now: '2026-08-31T09:04:00.000Z' });
    assert.equal(portfolio.projects[0].evidence.receiptId, 'newer-receipt');
    const replay = ingestTeamHubEnvelope(database, teamHubEnvelope('ordered-project', 'Old name', '2026-08-30T09:00:00.000Z', 'a'));
    assert.equal(replay.replayed, true);
    assert.equal(replay.receiptId, 'late-receipt');
  } finally {
    database.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('independent database connections resolve concurrent publication as replay or stable conflict', async () => {
  const dataRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-publication-race-'));
  const sourceRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-publication-source-'));
  try {
    const first = buildTeamHubResourcePackage(organisationPack(sourceRoot, '1.0.0', '# first\n'));
    const identical = await concurrentPublications(dataRoot, [first, first]);
    assert.equal(identical.filter(({ result }) => result && result.replayed === false).length, 1);
    assert.equal(identical.filter(({ result }) => result && result.replayed === true).length, 1);
    assert.equal(identical.some(({ error }) => /SQLITE/i.test(error?.message ?? '')), false);

    const conflictRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-publication-conflict-'));
    try {
      const changed = buildTeamHubResourcePackage(organisationPack(sourceRoot, '1.0.0', '# changed\n', 'org.acme.delivery'));
      const conflicting = await concurrentPublications(conflictRoot, [first, changed]);
      assert.equal(conflicting.filter(({ result }) => result).length, 1);
      assert.equal(conflicting.filter(({ error }) => error?.code === 'resource-release-conflict' && error.status === 409).length, 1);
      assert.equal(conflicting.some(({ error }) => /SQLITE/i.test(error?.message ?? '')), false);
      const database = openTeamHubDatabase(conflictRoot);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM team_hub_resource_releases').get().count, 1);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM team_hub_resource_publication_receipts').get().count, 1);
      database.close();
    } finally { rmSync(conflictRoot, { recursive: true, force: true }); }
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(sourceRoot, { recursive: true, force: true });
  }
});

function connectFixture(projectRoot) {
  initProject(projectRoot, { name: 'Install assurance project' });
  connectTeamHub(projectRoot, {
    endpoint: 'http://127.0.0.1:49001',
    projectId: 'install-assurance',
    tokenEnv: 'EWAI_TEAM_HUB_ASSURANCE',
    confirmed: true,
    disclosureAcknowledged: true,
  });
}

function installInput(resourcePackage, approvedBy = 'Assurance Owner') {
  return {
    id: resourcePackage.resource.id,
    version: resourcePackage.resource.version,
    expectedDigest: resourcePackage.digest,
    approvedBy,
    confirmed: true,
  };
}

test('resource installation refuses a live lease and recovers a dead-owner lease', async () => {
  const sourceRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-lease-source-'));
  const projectRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-lease-project-'));
  const resourcePackage = buildTeamHubResourcePackage(organisationPack(sourceRoot));
  connectFixture(projectRoot);
  const paths = runtimePaths(projectRoot);
  const leaseRoot = resolve(paths.teamHubResourcesRoot, 'install.lock');
  try {
    mkdirSync(leaseRoot, { recursive: true });
    writeFileSync(resolve(leaseRoot, 'lease.json'), `${JSON.stringify({ schema: 'ewai.team-hub-resource-install-lease/v1', leaseId: 'held', pid: process.pid, acquiredAt: '2026-08-31T09:00:00.000Z' })}\n`);
    await assert.rejects(
      installConnectedTeamHubResource(projectRoot, installInput(resourcePackage), { at: '2026-08-31T09:01:00.000Z' }),
      (error) => error.code === 'resource-install-busy' && error.status === 409,
    );
    assert.equal(readTeamHubResourceState(projectRoot).installed.length, 0);
    assert.equal(listTeamHubResourceReceipts(projectRoot).length, 0);

    rmSync(leaseRoot, { recursive: true, force: true });
    mkdirSync(leaseRoot, { recursive: true });
    writeFileSync(resolve(leaseRoot, 'lease.json'), `${JSON.stringify({ schema: 'ewai.team-hub-resource-install-lease/v1', leaseId: 'stale', pid: 2_147_483_647, acquiredAt: '2026-08-31T09:00:00.000Z' })}\n`);
    const installed = await installConnectedTeamHubResource(projectRoot, installInput(resourcePackage), {
      at: '2026-08-31T09:02:00.000Z',
      env: { EWAI_TEAM_HUB_ASSURANCE: 'reader-token-with-enough-entropy' },
      fetch: async () => new Response(JSON.stringify(resourcePackage), { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    assert.equal(installed.receipt.action, 'installed');
    assert.equal(existsSync(leaseRoot), false);

    mkdirSync(leaseRoot, { recursive: true });
    writeFileSync(resolve(leaseRoot, 'lease.json'), '{malformed');
    const staleTime = new Date('2026-08-31T08:00:00.000Z');
    utimesSync(leaseRoot, staleTime, staleTime);
    const recoveredMalformed = await installConnectedTeamHubResource(projectRoot, installInput(resourcePackage), {
      at: '2026-08-31T09:02:00.000Z',
      installLeaseStaleAfterMs: 1_000,
    });
    assert.equal(recoveredMalformed.receipt, null);
    assert.equal(existsSync(leaseRoot), false);
  } finally {
    rmSync(sourceRoot, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('state and receipt write failures preserve the previously accepted installed release', async () => {
  const sourceRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-fault-source-'));
  const projectRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-fault-project-'));
  const first = buildTeamHubResourcePackage(organisationPack(sourceRoot, '1.0.0', '# v1\n'));
  const second = buildTeamHubResourcePackage(organisationPack(sourceRoot, '2.0.0', '# v2\n'));
  connectFixture(projectRoot);
  const optionsFor = (resourcePackage, extra = {}) => ({
    env: { EWAI_TEAM_HUB_ASSURANCE: 'reader-token-with-enough-entropy' },
    fetch: async () => new Response(JSON.stringify(resourcePackage), { status: 200, headers: { 'content-type': 'application/json' } }),
    ...extra,
  });
  try {
    await installConnectedTeamHubResource(projectRoot, installInput(first), optionsFor(first));
    const paths = runtimePaths(projectRoot);
    const activeFile = resolve(paths.teamHubManagedPackRoot, 'org.acme.delivery/standards/api.md');
    const stateBefore = readFileSync(paths.teamHubResourceInstalledPath, 'utf8');
    const receiptCount = listTeamHubResourceReceipts(projectRoot).length;

    for (const [hook, message] of [['beforeStateWrite', 'state write fault'], ['beforeReceiptWrite', 'receipt write fault']]) {
      await assert.rejects(
        installConnectedTeamHubResource(projectRoot, installInput(second), optionsFor(second, { [hook]: () => { throw new Error(message); } })),
        new RegExp(message),
      );
      assert.equal(readFileSync(activeFile, 'utf8'), '# v1\n');
      assert.equal(readFileSync(paths.teamHubResourceInstalledPath, 'utf8'), stateBefore);
      assert.equal(listTeamHubResourceReceipts(projectRoot).length, receiptCount);
      assert.equal(readTeamHubResourceState(projectRoot).installed[0].digest, first.digest);
    }

    const installed = await installConnectedTeamHubResource(projectRoot, installInput(second), optionsFor(second));
    assert.equal(installed.receipt.action, 'updated');
    assert.equal(readTeamHubResourceState(projectRoot).installed[0].digest, second.digest);
  } finally {
    rmSync(sourceRoot, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('download disagreement malformed content and timeout fail before accepted local state changes', async () => {
  const sourceRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-download-source-'));
  const projectRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-download-project-'));
  const wanted = buildTeamHubResourcePackage(organisationPack(sourceRoot, '1.0.0', '# wanted\n'));
  const wrong = buildTeamHubResourcePackage(organisationPack(sourceRoot, '2.0.0', '# wrong\n'));
  connectFixture(projectRoot);
  const base = { env: { EWAI_TEAM_HUB_ASSURANCE: 'reader-token-with-enough-entropy' } };
  try {
    await assert.rejects(installConnectedTeamHubResource(projectRoot, installInput(wanted), {
      ...base,
      fetch: async () => new Response(JSON.stringify(wrong), { status: 200, headers: { 'content-type': 'application/json' } }),
    }), /identity or digest disagrees/i);
    await assert.rejects(installConnectedTeamHubResource(projectRoot, installInput(wanted), {
      ...base,
      fetch: async () => new Response('{bad json', { status: 200, headers: { 'content-type': 'application/json' } }),
    }));
    await assert.rejects(installConnectedTeamHubResource(projectRoot, installInput(wanted), {
      ...base,
      timeoutMs: 5,
      fetch: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
    }), /timeout|abort/i);
    assert.equal(readTeamHubResourceState(projectRoot).installed.length, 0);
    assert.equal(listTeamHubResourceReceipts(projectRoot).length, 0);
  } finally {
    rmSync(sourceRoot, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('corrupt Team Hub storage fails closed with a bounded diagnostic', () => {
  const dataRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-corrupt-'));
  try {
    mkdirSync(resolve(dataRoot, 'data'), { recursive: true });
    writeFileSync(resolve(dataRoot, 'data/team-hub.sqlite'), 'not a sqlite database');
    assert.throws(
      () => openTeamHubDatabase(dataRoot),
      (error) => /database|sqlite|file/i.test(error.message) && !error.message.includes(dataRoot),
    );
  } finally { rmSync(dataRoot, { recursive: true, force: true }); }
});
