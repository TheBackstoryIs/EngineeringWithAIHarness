import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { registerContextSource } from '../src/context.mjs';
import { initProject } from '../src/project.mjs';

function escaped(value) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

test('registers a context folder without copying raw material into SPECS', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-context-project-'));
  const source = mkdtempSync(resolve(tmpdir(), 'ewai-context-source-'));
  try {
    initProject(root, { name: 'Context Project' });
    mkdirSync(resolve(source, 'meetings'));
    writeFileSync(resolve(source, 'meetings/decision transcript.txt'), 'Agreed to use queued delivery.\n');
    writeFileSync(resolve(source, 'requirements.pdf'), 'test fixture');
    writeFileSync(resolve(source, 'ignored.exe'), 'not indexed');

    const result = registerContextSource(root, source, {
      confirmed: true,
      label: 'Early project material',
      classification: 'confidential',
      cloudProcessing: 'denied',
      now: '2026-07-16T10:00:00.000Z'
    });

    assert.equal(result.inventory.fileCount, 2);
    assert.equal(result.skipped.unsupported, 1);
    const registryText = readFileSync(result.registryPath, 'utf8');
    const registry = YAML.parse(registryText);
    assert.equal(registry.sources[0].classification, 'confidential');
    assert.equal(registry.sources[0].cloud_processing, 'denied');
    assert.doesNotMatch(registryText, escaped(source));
    assert.doesNotMatch(registryText, /decision transcript/);

    const privateManifest = readFileSync(result.privateManifest, 'utf8');
    assert.match(privateManifest, /decision transcript\.txt/);
    assert.match(privateManifest, escaped(source));
    assert.doesNotMatch(readFileSync(result.registrationPath, 'utf8'), escaped(source));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(source, { recursive: true, force: true });
  }
});

test('requires consent and an initialized project before context registration', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-context-project-'));
  const source = mkdtempSync(resolve(tmpdir(), 'ewai-context-source-'));
  try {
    assert.throws(() => registerContextSource(root, source), /explicit user confirmation/);
    assert.throws(() => registerContextSource(root, source, { confirmed: true }), /Initialize EWAI/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(source, { recursive: true, force: true });
  }
});
