import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { initProject } from '../src/project.mjs';
import { ASSURANCE_NOTICE } from '../src/security-validation-config.mjs';
import {
  assessSecurityReadiness,
  executeSecurityRun,
  listSecurityDispositions,
  listSecurityFindings,
  prepareSecurityRun,
  recordSecurityDisposition,
  registerSecurityAdapter,
} from '../src/runtime/security-validation.mjs';

function createProject() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-security-readiness-'));
  initProject(root, { name: 'Security Readiness Test' });
  return root;
}

function configure(root) {
  const path = resolve(root, 'SPECS/pipeline.yaml');
  const config = YAML.parse(readFileSync(path, 'utf8'));
  config.security_validation = { enabled: true, profiles: [{
    id: 'source', capability: 'source-static', required: true, freshness_hours: 24,
    timeout_seconds: 10, accountable_role: 'Security Lead', modes: ['command'], adapter: 'fixture.readiness',
  }] };
  writeFileSync(path, YAML.stringify(config, { lineWidth: 0 }));
}

function adapter(root, findings) {
  const adapterRoot = resolve(root, 'readiness-adapter');
  mkdirSync(adapterRoot, { recursive: true });
  writeFileSync(resolve(adapterRoot, 'adapter.mjs'), `#!/usr/bin/env node
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const request = JSON.parse(input);
  console.log(JSON.stringify({ schema: 'ewai.security-scan-response/v1', runId: request.runId,
    status: 'complete', complete: true, capabilities: ['source-static'], findings: ${JSON.stringify(findings)}, warnings: [] }));
});
`);
  chmodSync(resolve(adapterRoot, 'adapter.mjs'), 0o755);
  writeFileSync(resolve(adapterRoot, 'security-adapter.json'), `${JSON.stringify({
    schema: 'ewai.security-adapter/v1', id: 'fixture.readiness', name: 'Readiness Fixture',
    publisher: { id: 'fixture', name: 'Fixture' }, version: '1.0.0', protocolVersion: '1',
    capabilities: ['source-static'], entrypoint: 'adapter.mjs',
  }, null, 2)}\n`);
  registerSecurityAdapter(root, adapterRoot, { confirmed: true });
}

async function run(root, revision = 'abc123') {
  const prepared = prepareSecurityRun(root, 'source', { trustedRevision: revision, confirmed: true });
  return executeSecurityRun(root, prepared.run.id);
}

test('preserves legacy release semantics when security validation is not configured', () => {
  const root = createProject();
  try {
    const readiness = assessSecurityReadiness(root, { trustedRevision: 'abc123' });
    assert.equal(readiness.status, 'not-configured');
    assert.equal(readiness.ready, true);
    assert.equal(readiness.assurance_notice, ASSURANCE_NOTICE);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('requires current complete evidence for every required capability profile', async () => {
  const root = createProject();
  try {
    configure(root);
    adapter(root, []);
    assert.equal(assessSecurityReadiness(root, { trustedRevision: 'abc123' }).status, 'blocked');
    await run(root, 'abc123');
    const ready = assessSecurityReadiness(root, { trustedRevision: 'abc123', now: '2026-08-20T12:00:00.000Z' });
    assert.equal(ready.status, 'ready');
    assert.equal(ready.ready, true);
    assert.equal(assessSecurityReadiness(root, { trustedRevision: 'different' }).reasons[0].code, 'revision-mismatch');
    assert.equal(assessSecurityReadiness(root, { trustedRevision: 'abc123', now: '2100-01-01T00:00:00.000Z' }).reasons[0].code, 'stale-evidence');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps blocking findings immutable while accountable dispositions append and expire', async () => {
  const root = createProject();
  try {
    configure(root);
    adapter(root, [{
      id: 'F-ACCESS', capability: 'source-static', severity: 'high', confidence: 0.9,
      summary: 'Ownership check may be bypassed', locations: ['src/auth.mjs:9'],
      remediation: 'Enforce ownership', evidence: ['src/auth.mjs:9'],
    }]);
    await run(root);
    const finding = listSecurityFindings(root).findings[0];
    mkdirSync(resolve(root, 'SPECS/3.Evidence/risk'), { recursive: true });
    writeFileSync(resolve(root, 'SPECS/3.Evidence/risk/acceptance.md'), '# Risk acceptance evidence\n');
    writeFileSync(resolve(root, 'SPECS/risk.md'), '# Risk evidence\n');
    assert.equal(assessSecurityReadiness(root, { trustedRevision: 'abc123' }).status, 'blocked');
    assert.throws(() => recordSecurityDisposition(root, finding.recordId, { decision: 'false-positive', reviewer: 'Reviewer', reason: 'Not reachable' }), /evidence/i);
    assert.throws(() => recordSecurityDisposition(root, finding.recordId, { decision: 'accept-risk', reviewer: 'Reviewer', reason: 'Temporary', evidence: ['SPECS/risk.md'] }), /risk owner|expiry/i);

    const accepted = recordSecurityDisposition(root, finding.recordId, {
      decision: 'accept-risk', reviewer: 'Security Lead', reason: 'Compensating control is active',
      evidence: ['SPECS/3.Evidence/risk/acceptance.md'], riskOwner: 'Product Owner', expiresAt: '2099-01-01T00:00:00.000Z',
    });
    assert.equal(accepted.assurance_notice, ASSURANCE_NOTICE);
    assert.equal(assessSecurityReadiness(root, { trustedRevision: 'abc123', now: '2026-08-20T12:00:00.000Z' }).status, 'ready');
    assert.equal(assessSecurityReadiness(root, { trustedRevision: 'abc123', now: '2100-01-01T00:00:00.000Z' }).reasons.some((reason) => reason.code === 'expired-risk-acceptance'), true);
    assert.equal(listSecurityDispositions(root, finding.recordId).dispositions.length, 1);
    assert.equal(listSecurityFindings(root).findings[0].summary, 'Ownership check may be bypassed');
    assert.throws(() => recordSecurityDisposition(root, finding.recordId, {
      decision: 'false-positive', reviewer: 'Reviewer', reason: 'Attempt', evidence: ['SPECS/missing-evidence.md'],
    }), /existing non-symbolic project evidence/i);
    assert.throws(() => recordSecurityDisposition(root, finding.recordId, {
      decision: 'false-positive', reviewer: 'Reviewer', reason: 'Attempt', evidence: ['SPECS/evidence.md'], readiness: 'ready',
    }), /unknown field/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
