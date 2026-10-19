import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { autonomyPaths, readAutonomySnapshot, writeAutonomyRecord } from '../src/runtime/autonomy-workspace.mjs';
import { openRuntimeDatabase } from '../src/runtime/database.mjs';
import { initProject } from '../src/project.mjs';

function project(t) {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'ewai-autonomy-records-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(resolve(root, '.ewai-pipeline'), { recursive: true });
  return root;
}

test('a concurrent reader never observes a partially written autonomy record', async t => {
  const root = project(t), directory = resolve(root, '.ewai-pipeline/runtime/autonomy/supervisor/runs/fixture/revisions');
  mkdirSync(directory, { recursive: true });
  const stop = resolve(root, 'stop-reader');
  const reader = spawn(process.execPath, ['-e', `
    const fs = require('node:fs'), path = require('node:path');
    const [directory, stop] = process.argv.slice(1);
    let reads = 0, partial = 0;
    while (!fs.existsSync(stop)) {
      for (const name of fs.readdirSync(directory)) {
        let text; try { text = fs.readFileSync(path.join(directory, name), 'utf8'); } catch { continue; }
        reads++; try { JSON.parse(text); } catch { partial++; }
      }
    }
    process.stdout.write(JSON.stringify({ reads, partial }));
  `, directory, stop], { stdio: ['ignore', 'pipe', 'inherit'] });
  let output = ''; reader.stdout.on('data', chunk => { output += chunk; });
  const finished = new Promise(done => reader.on('close', done));
  await new Promise(done => setTimeout(done, 200));
  // Large records widen the window between creating and filling a file.
  const payload = 'x'.repeat(2 * 1024 * 1024);
  for (let revision = 1; revision <= 120; revision++) writeAutonomyRecord(root, resolve(directory, `${revision}.json`), { revision, payload });
  writeFileSync(stop, '');
  await finished;
  const { reads, partial } = JSON.parse(output);
  assert.ok(reads > 0, 'the reader observed records while they were written');
  assert.equal(partial, 0, `${partial} of ${reads} reads saw an incomplete record`);
  assert.deepEqual(readdirSync(resolve(autonomyPaths(root).controlRoot, 'staging')), [], 'no staged bytes remain after writing');
});

test('autonomy records stay write-once and reject conflicting rewrites', t => {
  const root = project(t), path = resolve(root, '.ewai-pipeline/runtime/autonomy/previews/record.json');
  writeAutonomyRecord(root, path, { value: 1 });
  writeAutonomyRecord(root, path, { value: 1 });
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { value: 1 });
  assert.throws(() => writeAutonomyRecord(root, path, { value: 2 }), error => error.code === 'autonomy-record-conflict');
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { value: 1 });
  assert.ok(!existsSync(resolve(root, '.ewai-pipeline/runtime/autonomy/previews/staging')), 'staging stays outside listed record folders');
});

test('an autonomy snapshot tolerates other connections writing the runtime projection', async t => {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'ewai-autonomy-projection-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initProject(root, { name: 'Concurrent projection' });
  openRuntimeDatabase(root).close();
  const stop = resolve(root, 'stop-writer');
  const writer = spawn(process.execPath, ['--input-type=module', '-e', `
    const { existsSync } = await import('node:fs');
    const { openRuntimeDatabase } = await import(${JSON.stringify(resolve(import.meta.dirname, '../src/runtime/database.mjs'))});
    const [root, stop] = process.argv.slice(1);
    while (!existsSync(stop)) {
      const db = openRuntimeDatabase(root);
      db.exec('CREATE TABLE IF NOT EXISTS fixture_churn (value INTEGER)');
      db.prepare('INSERT INTO fixture_churn VALUES (?)').run(Date.now());
      db.close();
      await new Promise(done => setTimeout(done, 10));
    }
  `, root, stop], { stdio: ['ignore', 'ignore', 'inherit'] });
  const finished = new Promise(done => writer.on('close', done));
  await new Promise(done => setTimeout(done, 300));
  const failures = [];
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      try { readAutonomySnapshot(root); } catch (error) { failures.push(error.code); }
    }
  } finally { writeFileSync(stop, ''); await finished; }
  assert.deepEqual(failures, []);
});
