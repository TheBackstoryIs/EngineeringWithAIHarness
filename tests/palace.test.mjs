import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { initProject } from '../src/project.mjs';
import { openRuntimeDatabase } from '../src/runtime/database.mjs';
import {
  palaceHousekeeping,
  palaceIndexStatus,
  palaceTidiness,
  refreshPalaceIndex,
  searchPalace
} from '../src/runtime/palace.mjs';

function write(root, path, content) {
  const target = resolve(root, 'SPECS', path);
  mkdirSync(resolve(target, '..'), { recursive: true });
  writeFileSync(target, content, 'utf8');
  return target;
}

test('indexes SPECS as a searchable project Mind Palace', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-palace-search-'));
  try {
    initProject(root, { name: 'Mind Palace Search Test' });
    write(root, '5.Strategy/decisions/alert-delivery.md', `# Alert delivery

## Privacy boundary

The blind relay invariant prevents administrators from seeing recipient details.
`);

    const refreshed = refreshPalaceIndex(root, { force: true });
    assert.equal(refreshed.schema, 'ewai.palace-index/v1');
    assert.equal(refreshed.status, 'completed');
    assert.equal(refreshed.documents > 0, true);
    assert.equal(refreshed.sections >= refreshed.documents, true);

    const result = searchPalace(root, 'blind relay');
    assert.equal(result.schema, 'ewai.palace-search/v1');
    assert.equal(result.results[0].path, '5.Strategy/decisions/alert-delivery.md');
    assert.equal(result.results[0].heading, 'Privacy boundary');
    assert.match(result.results[0].snippet, /blind.*relay/i);

    const malformedLimit = searchPalace(root, 'blind relay', { limit: 'not-a-number' });
    assert.equal(malformedLimit.results[0].path, '5.Strategy/decisions/alert-delivery.md');

    const status = palaceIndexStatus(root);
    assert.equal(status.status, 'fresh');
    assert.equal(status.documents, refreshed.documents);

    const database = openRuntimeDatabase(root);
    database.prepare("INSERT INTO palace_index_runs (status, source_fingerprint) VALUES ('failed', 'failed-refresh')").run();
    database.close();
    const statusAfterFailure = palaceIndexStatus(root);
    assert.equal(statusAfterFailure.status, 'fresh');
    assert.equal(statusAfterFailure.runId, refreshed.runId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports deterministic Palace tidiness findings without changing SPECS', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-palace-tidiness-'));
  try {
    initProject(root, { name: 'Mind Palace Tidiness Test' });
    write(root, '1.Scope/README.md', '# Scope\n\n[Decision](../5.Strategy/decisions/dispatch.md)\n');
    write(root, '5.Strategy/decisions/dispatch.md', '# Dispatch decision\n\n[Missing standard](../../4.Constraints/standards/missing.md)\n');
    write(root, '5.Strategy/patterns/duplicate-a.md', '# Shared pattern\n\nUse the same delivery boundary.\n');
    write(root, '5.Strategy/patterns/duplicate-b.md', '# Shared pattern\n\nUse the same delivery boundary.\n');
    write(root, '1.Scope/personas/project/orphaned-operator.md', '# Orphaned operator\n\nA project actor with no links.\n');
    write(root, '3.Evidence/untitled.md', 'Evidence without a document title.\n');

    const before = refreshPalaceIndex(root, { force: true });
    const report = palaceTidiness(root);
    assert.equal(report.schema, 'ewai.palace-tidiness/v1');
    assert.equal(report.documents, before.documents);
    assert.equal(report.findings.some((finding) => finding.code === 'broken-internal-link'), true);
    assert.equal(report.findings.some((finding) => finding.code === 'duplicate-content'), true);
    assert.equal(report.findings.some((finding) => finding.code === 'orphaned-document'), true);
    assert.equal(report.findings.some((finding) => finding.code === 'missing-title'), true);
    assert.equal(report.status, 'housekeeping-recommended');

    const housekeeping = palaceHousekeeping(root);
    assert.equal(housekeeping.schema, 'ewai.palace-housekeeping/v1');
    assert.equal(housekeeping.changedFiles, 0);
    assert.equal(housekeeping.requiresApproval, true);
    assert.equal(housekeeping.groups.length > 0, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exposes Mind Palace search and tidiness through the public CLI', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-palace-cli-'));
  try {
    initProject(root, { name: 'Mind Palace CLI Test' });
    write(root, '4.Constraints/standards/reliable-alerts.md', '# Reliable alerts\n\nDelivery attempts must be observable.\n');
    const bin = resolve(import.meta.dirname, '../bin/ewai');

    const searched = spawnSync(process.execPath, [bin, 'palace', 'search', 'observable', '--project', root, '--json'], { encoding: 'utf8' });
    assert.equal(searched.status, 0, searched.stderr);
    assert.equal(JSON.parse(searched.stdout).results[0].path, '4.Constraints/standards/reliable-alerts.md');

    const tidiness = spawnSync(process.execPath, [bin, 'palace', 'tidiness', '--project', root, '--json'], { encoding: 'utf8' });
    assert.equal(tidiness.status, 0, tidiness.stderr);
    assert.equal(JSON.parse(tidiness.stdout).schema, 'ewai.palace-tidiness/v1');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
