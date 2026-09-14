import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { initProject } from '../src/project.mjs';
import { ASSURANCE_NOTICE } from '../src/security-validation-config.mjs';
import { openRuntimeDatabase } from '../src/runtime/database.mjs';
import {
  assessSecurityReadiness,
  cancelSecurityRun,
  executeSecurityRun,
  importSecurityArtifacts,
  listSecurityFindings,
  listSecurityRuns,
  prepareSecurityArtifactImport,
  prepareSecurityRun,
  registerSecurityAdapter,
} from '../src/runtime/security-validation.mjs';

function createProject() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-security-runs-'));
  initProject(root, { name: 'Security Runs Test' });
  return root;
}

function configure(root, profiles) {
  const path = resolve(root, 'SPECS/pipeline.yaml');
  const config = YAML.parse(readFileSync(path, 'utf8'));
  config.security_validation = { enabled: true, profiles };
  writeFileSync(path, YAML.stringify(config, { lineWidth: 0 }));
}

function createAdapter(root, id, responseSource) {
  const adapterRoot = resolve(root, `adapter-${id}`);
  mkdirSync(adapterRoot, { recursive: true });
  writeFileSync(resolve(adapterRoot, 'adapter.mjs'), `#!/usr/bin/env node
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const request = JSON.parse(input);
  ${responseSource}
});
`);
  chmodSync(resolve(adapterRoot, 'adapter.mjs'), 0o755);
  writeFileSync(resolve(adapterRoot, 'security-adapter.json'), `${JSON.stringify({
    schema: 'ewai.security-adapter/v1', id, name: id,
    publisher: { id: 'fixture', name: 'Fixture' }, version: '1.0.0', protocolVersion: '1',
    capabilities: ['source-static'], entrypoint: 'adapter.mjs',
  }, null, 2)}\n`);
  registerSecurityAdapter(root, adapterRoot, { confirmed: true });
  return adapterRoot;
}

function sourceProfile(adapter = 'fixture.clean') {
  return {
    id: 'source', capability: 'source-static', required: true, freshness_hours: 24,
    timeout_seconds: 10, accountable_role: 'Security Lead', modes: ['command', 'artifact-import'], adapter,
  };
}

test('executes only a registered adapter with a bounded JSON protocol and stores no raw output', async () => {
  const root = createProject();
  try {
    createAdapter(root, 'fixture.clean', `console.log(JSON.stringify({
      schema: 'ewai.security-scan-response/v1', runId: request.runId, status: 'complete', complete: true,
      capabilities: ['source-static'], tool: { name: 'Fixture', version: '1.0.0' }, findings: [{
        id: 'F-1', capability: 'source-static', severity: 'high', confidence: 0.9,
        summary: 'Unsafe branch can expose data', locations: ['src/example.mjs:4'],
        remediation: 'Validate the branch', evidence: ['src/example.mjs:4']
      }], warnings: []
    }));`);
    configure(root, [sourceProfile()]);
    const prepared = prepareSecurityRun(root, 'source', { trustedRevision: 'abc123', confirmed: true });
    assert.equal(prepared.run.status, 'prepared');
    const completed = await executeSecurityRun(root, prepared.run.id);
    assert.equal(completed.run.status, 'complete');
    assert.equal(completed.run.complete, true);
    assert.deepEqual(completed.run.tool, { name: 'Fixture', version: '1.0.0' });
    assert.equal(completed.run.redactionStatus, 'safe-fields-only');
    assert.equal(completed.assurance_notice, ASSURANCE_NOTICE);
    assert.equal(listSecurityFindings(root).findings[0].summary, 'Unsafe branch can expose data');

    const database = openRuntimeDatabase(root);
    const stored = JSON.stringify({
      runs: database.prepare('SELECT * FROM security_runs').all(),
      attempts: database.prepare('SELECT * FROM security_attempts').all(),
      findings: database.prepare('SELECT * FROM security_findings').all(),
    });
    database.close();
    assert.equal(stored.includes('ewai.security-scan-response'), false);
    assert.equal(stored.includes('Fixture Security Adapter'), false);
    assert.equal(listSecurityRuns(root).runs[0].reportDigest.length, 64);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps malformed, incomplete and credential-bearing responses non-passing', async () => {
  for (const fixture of [
    { id: 'fixture.malformed', source: `process.stdout.write('{bad json');`, expected: 'failed' },
    { id: 'fixture.incomplete', source: `console.log(JSON.stringify({ schema: 'ewai.security-scan-response/v1', runId: request.runId, status: 'incomplete', complete: false, capabilities: ['source-static'], findings: [], warnings: ['partial'] }));`, expected: 'incomplete' },
    { id: 'fixture.credential', source: `console.log(JSON.stringify({ schema: 'ewai.security-scan-response/v1', runId: request.runId, status: 'complete', complete: true, capabilities: ['source-static'], findings: [{ id: 'F-1', capability: 'source-static', severity: 'high', summary: 'Bearer abcdefghijklmnopqrstuvwxyz', locations: [], remediation: '', evidence: [] }], warnings: [] }));`, expected: 'failed' },
  ]) {
    const root = createProject();
    try {
      createAdapter(root, fixture.id, fixture.source);
      configure(root, [sourceProfile(fixture.id)]);
      const prepared = prepareSecurityRun(root, 'source', { trustedRevision: 'abc123', confirmed: true });
      const result = await executeSecurityRun(root, prepared.run.id);
      assert.equal(result.run.status, fixture.expected);
      assert.equal(result.run.complete, false);
      assert.equal(listSecurityFindings(root).findings.length, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('applies the snapshotted project threshold and makes later policy changes stale', async () => {
  const root = createProject();
  try {
    createAdapter(root, 'fixture.threshold', `console.log(JSON.stringify({
      schema: 'ewai.security-scan-response/v1', runId: request.runId, status: 'complete', complete: true,
      capabilities: ['source-static'], findings: [{ id: 'F-MEDIUM', capability: 'source-static', severity: 'medium',
      summary: 'Configured medium severity issue', locations: ['src/example.mjs:1'], remediation: 'Review it', evidence: [] }], warnings: []
    }));`);
    configure(root, [{ ...sourceProfile('fixture.threshold'), thresholds: { blocking_severities: ['medium', 'high', 'critical'] } }]);
    const prepared = prepareSecurityRun(root, 'source', { trustedRevision: 'abc123', confirmed: true });
    await executeSecurityRun(root, prepared.run.id);
    assert.equal(listSecurityFindings(root).findings[0].policyConsequence, 'blocking');

    const current = assessSecurityReadiness(root, { trustedRevision: 'abc123' });
    assert.equal(current.status, 'blocked');
    assert.equal(current.reasons.some((reason) => reason.code === 'blocking-finding'), true);

    configure(root, [{ ...sourceProfile('fixture.threshold'), thresholds: { blocking_severities: ['critical'] } }]);
    const changed = assessSecurityReadiness(root, { trustedRevision: 'abc123' });
    assert.equal(changed.status, 'blocked');
    assert.equal(changed.profiles[0].status, 'stale');
    assert.equal(changed.reasons.some((reason) => reason.code === 'policy-mismatch'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finishes an actively cancelled adapter run as cancelled rather than failed', async () => {
  const root = createProject();
  try {
    createAdapter(root, 'fixture.cancel', `setTimeout(() => console.log(JSON.stringify({
      schema: 'ewai.security-scan-response/v1', runId: request.runId, status: 'complete', complete: true,
      capabilities: ['source-static'], findings: [], warnings: []
    })), 5000);`);
    configure(root, [{ ...sourceProfile('fixture.cancel'), timeout_seconds: 10 }]);
    const prepared = prepareSecurityRun(root, 'source', { trustedRevision: 'abc123', confirmed: true });
    const execution = executeSecurityRun(root, prepared.run.id);
    await assert.rejects(executeSecurityRun(root, prepared.run.id), /not prepared/i);
    const cancelling = cancelSecurityRun(root, prepared.run.id, { confirmed: true });
    assert.equal(['cancelling', 'cancelled'].includes(cancelling.run.status), true);
    const result = await execution;
    assert.equal(result.run.status, 'cancelled');
    assert.equal(result.run.complete, false);
    assert.equal(assessSecurityReadiness(root, { trustedRevision: 'abc123' }).profiles[0].status, 'cancelled');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('bounds adapter execution with the configured timeout', async () => {
  const root = createProject();
  try {
    createAdapter(root, 'fixture.timeout', `setTimeout(() => console.log(JSON.stringify({
      schema: 'ewai.security-scan-response/v1', runId: request.runId, status: 'complete', complete: true,
      capabilities: ['source-static'], findings: [], warnings: []
    })), 5000);`);
    configure(root, [{ ...sourceProfile('fixture.timeout'), timeout_seconds: 1 }]);
    const prepared = prepareSecurityRun(root, 'source', { trustedRevision: 'abc123', confirmed: true });
    const result = await executeSecurityRun(root, prepared.run.id);
    assert.equal(result.run.status, 'failed');
    assert.equal(result.run.complete, false);
    assert.deepEqual(result.run.warnings, ['Adapter timed out.']);
    const database = openRuntimeDatabase(root);
    assert.equal(database.prepare('SELECT timed_out FROM security_attempts WHERE run_id = ?').get(prepared.run.id).timed_out, 1);
    database.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('imports allowlisted Agentic Security and DeepSec artefacts through single-use server tokens without execution', () => {
  const root = createProject();
  try {
    configure(root, [{ ...sourceProfile(), adapter: undefined, provider: 'agentic-security' }]);
    mkdirSync(resolve(root, '.agentic-security'), { recursive: true });
    const marker = resolve(root, 'provider-content-executed');
    writeFileSync(resolve(root, '.agentic-security/findings.json'), `${JSON.stringify([{
      id: 'AS-1', capability: 'source-static', severity: 'medium', confidence: 0.8,
      summary: 'Potential unsafe value', path: 'src/value.mjs:8', remediation: `Do not execute ${marker}`,
    }])}\n`);
    writeFileSync(resolve(root, '.agentic-security/last-scan.json'), `${JSON.stringify({
      status: 'complete', complete: true, revision: 'abc123', capabilities: ['source-static'],
    })}\n`);

    const prepared = prepareSecurityArtifactImport(root, 'source', 'agentic-security', { trustedRevision: 'abc123' });
    assert.equal(prepared.status, 'awaiting-import');
    assert.equal(prepared.token.length > 10, true);
    assert.equal(Object.hasOwn(prepared, 'path'), false);
    const imported = importSecurityArtifacts(root, prepared.token, { confirmed: true });
    assert.equal(imported.run.status, 'complete');
    assert.equal(imported.run.providerId, 'agentic-security');
    assert.equal(listSecurityFindings(root).findings[0].id, 'AS-1');
    assert.equal(existsSync(marker), false);
    assert.throws(() => importSecurityArtifacts(root, prepared.token, { confirmed: true }), /already consumed/i);
    assert.throws(() => importSecurityArtifacts(root, '../arbitrary-path', { confirmed: true }), /discovery token/i);

    configure(root, [{ ...sourceProfile(), adapter: undefined, provider: 'deepsec' }]);
    rmSync(resolve(root, '.agentic-security'), { recursive: true, force: true });
    mkdirSync(resolve(root, '.deepsec'), { recursive: true });
    writeFileSync(resolve(root, '.deepsec/report.json'), `${JSON.stringify({
      status: 'complete', complete: true, revision: 'abc123', capabilities: ['source-static'], findings: [{
        id: 'DS-1', capability: 'source-static', severity: 'high', confidence: 0.75,
        summary: 'Potential access-control gap', locations: ['src/auth.mjs:9'], remediation: 'Check ownership', evidence: ['src/auth.mjs:9'],
      }],
    })}\n`);
    const deepsec = prepareSecurityArtifactImport(root, 'source', 'deepsec', { trustedRevision: 'abc123' });
    assert.equal(importSecurityArtifacts(root, deepsec.token, { confirmed: true }).run.status, 'complete');

    writeFileSync(resolve(root, '.deepsec/report.json'), `${JSON.stringify({
      status: 'complete', complete: true, revision: 'another-revision', capabilities: ['source-static'], findings: [],
    })}\n`);
    const mismatched = prepareSecurityArtifactImport(root, 'source', 'deepsec', { trustedRevision: 'abc123' });
    assert.throws(() => importSecurityArtifacts(root, mismatched.token, { confirmed: true }), /revision does not match/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects symbolic-link provider artefacts and never returns a clean import for mere folder presence', () => {
  const root = createProject();
  const outside = mkdtempSync(resolve(tmpdir(), 'ewai-security-import-outside-'));
  try {
    configure(root, [{ ...sourceProfile(), adapter: undefined, provider: 'deepsec' }]);
    mkdirSync(resolve(root, '.deepsec'), { recursive: true });
    writeFileSync(resolve(outside, 'report.json'), '{}\n');
    symlinkSync(resolve(outside, 'report.json'), resolve(root, '.deepsec/report.json'));
    assert.throws(() => prepareSecurityArtifactImport(root, 'source', 'deepsec', { trustedRevision: 'abc123' }), /supported artefacts|symbolic/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('keeps Visa VVAH on the skill handoff path when dynamic scan artefacts are detected', () => {
  const root = createProject();
  try {
    configure(root, [{ ...sourceProfile(), adapter: undefined, modes: ['artifact-import'], provider: undefined }]);
    mkdirSync(resolve(root, 'security-scan'), { recursive: true });
    writeFileSync(resolve(root, 'security-scan/module_report.sarif'), '{}\n');
    assert.throws(
      () => prepareSecurityArtifactImport(root, 'source', 'visa-vvah', { trustedRevision: 'abc123' }),
      /does not support native artefact import/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
