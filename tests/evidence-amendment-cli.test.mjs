import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createCompletedEvidenceFixture } from './helpers/team-hub-operational-fixtures.mjs';

const cli = resolve(import.meta.dirname, '../bin/ewai');

function run(root, slug, extra = []) {
  return spawnSync(process.execPath, [
    cli, 'delivery', 'evidence-amendment', slug,
    ...extra,
    '--project', root,
    '--json',
  ], { encoding: 'utf8' });
}

function jsonOutput(result) {
  return JSON.parse(result.status === 0 ? result.stdout : result.stderr);
}

test('the public CLI previews, refuses stale authority, applies and exactly replays completed evidence', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-evidence-cli-'));
  const slug = 'cli-evidence';
  try {
    createCompletedEvidenceFixture(root, slug);
    const previewResult = run(root, slug);
    assert.equal(previewResult.status, 0, previewResult.stderr);
    const preview = jsonOutput(previewResult);
    assert.equal(preview.schema, 'ewai.completed-evidence-amendment-preview/v1');
    assert.equal(preview.status, 'changes-found');
    assert.match(preview.stateSha256, /^[a-f0-9]{64}$/);

    const missingAuthority = run(root, slug, ['--yes']);
    assert.notEqual(missingAuthority.status, 0);
    assert.match(jsonOutput(missingAuthority).error, /approving person or role/i);

    const abandonedLease = resolve(root, `SPECS/6.Build/${slug}/.evidence-amendment.lock`);
    mkdirSync(abandonedLease);
    writeFileSync(resolve(abandonedLease, 'lease.json'), `${JSON.stringify({
      schema: 'ewai.completed-evidence-amendment-lease/v1',
      leaseId: 'abandoned',
      pid: 2_147_483_647,
      acquiredAt: '2026-08-31T08:00:00.000Z',
    })}\n`);
    const stale = run(root, slug, [
      '--yes', '--approved-by', 'Andre Boyle', '--reason', 'Correct operational evidence.',
      '--expected-state-digest', '0'.repeat(64),
    ]);
    assert.notEqual(stale.status, 0);
    assert.match(jsonOutput(stale).error, /state digest changed/i);

    const authority = [
      '--yes', '--approved-by', 'Andre Boyle', '--reason', 'Correct operational evidence.',
      '--expected-state-digest', preview.stateSha256,
    ];
    const applied = run(root, slug, authority);
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(jsonOutput(applied).action, 'ratified');

    const replay = run(root, slug, authority);
    assert.equal(replay.status, 0, replay.stderr);
    assert.equal(jsonOutput(replay).action, 'replayed');
    assert.equal(jsonOutput(replay).receiptPath, jsonOutput(applied).receiptPath);

    const after = run(root, slug);
    assert.equal(jsonOutput(after).status, 'no-changes');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const concurrentCliWorker = `
const { parentPort, workerData } = require('node:worker_threads');
const { spawnSync } = require('node:child_process');
const control = new Int32Array(workerData.control);
Atomics.add(control, 0, 1);
parentPort.postMessage({ type: 'ready' });
Atomics.wait(control, 1, 0);
const result = spawnSync(process.execPath, workerData.args, { encoding: 'utf8' });
parentPort.postMessage({ type: 'result', status: result.status, stdout: result.stdout, stderr: result.stderr });
`;

async function runConcurrentCli(args) {
  const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
  const control = new Int32Array(buffer);
  const workers = [0, 1].map(() => new Worker(concurrentCliWorker, { eval: true, workerData: { args, control: buffer } }));
  const results = workers.map((worker) => new Promise((resolveResult, reject) => {
    worker.on('message', (message) => { if (message.type === 'result') resolveResult(message); });
    worker.on('error', reject);
  }));
  await Promise.all(workers.map((worker) => new Promise((resolveReady, reject) => {
    worker.on('message', (message) => { if (message.type === 'ready') resolveReady(); });
    worker.on('error', reject);
  })));
  assert.equal(Atomics.load(control, 0), 2);
  Atomics.store(control, 1, 1);
  Atomics.notify(control, 1, 2);
  return Promise.all(results);
}

test('two exact CLI authorities resolve without partial completed-evidence state', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-evidence-cli-concurrent-'));
  const slug = 'concurrent-evidence';
  try {
    const fixture = createCompletedEvidenceFixture(root, slug);
    const preview = jsonOutput(run(root, slug));
    const args = [
      cli, 'delivery', 'evidence-amendment', slug,
      '--yes', '--approved-by', 'Andre Boyle', '--reason', 'Concurrent exact authority.',
      '--expected-state-digest', preview.stateSha256,
      '--project', root, '--json',
    ];
    const results = await runConcurrentCli(args);
    const successful = results.filter(({ status }) => status === 0).map(({ stdout }) => JSON.parse(stdout));
    const refused = results.filter(({ status }) => status !== 0).map(({ stderr }) => JSON.parse(stderr).error);
    assert.ok(successful.some(({ action }) => action === 'ratified'));
    assert.ok(results.every(({ stdout, stderr }) => !/SQLITE|ENOENT|Unexpected token/i.test(`${stdout}${stderr}`)));
    assert.ok(successful.length + refused.length === 2);
    assert.ok(
      refused.every((message) => /state digest changed|no changed completed-phase evidence|replay|ratification is in progress/i.test(message)),
      `unexpected competing CLI outcome: ${JSON.stringify({ successful, refused })}`,
    );

    const after = jsonOutput(run(root, slug));
    assert.equal(after.status, 'no-changes');
    const state = JSON.parse(readFileSync(resolve(fixture.deliveryRoot, 'delivery-state.json'), 'utf8'));
    assert.equal(state.evidenceAmendments.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
