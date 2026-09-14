import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { initProject } from '../src/project.mjs';
import { createLocalErrorReport, finaliseLocalErrorReport } from '../src/runtime/error-reporting.mjs';
import {
  listErrorReportProviders,
  listErrorReportReceipts,
  registerErrorReportProvider,
  submitErrorReportProvider,
  validateErrorReportProvider,
} from '../src/runtime/error-reporting.mjs';

const input = {
  capability: 'dashboard', errorCode: 'EWAI-UI-LOAD', command: 'ewai dashboard',
  ewaiVersion: '0.2.1', nodeVersion: '22', osClass: 'linux', installationSource: 'npm',
  title: 'Dashboard failed', expected: 'Dashboard loads.', actual: 'It did not.', reproductionSteps: ['Open dashboard'],
};

function project() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-error-report-provider-'));
  initProject(root, { name: 'Provider test' });
  return root;
}

function adapter(root, behaviour = 'accepted') {
  const folder = resolve(root, `provider-${behaviour}`);
  mkdirSync(folder, { recursive: true });
  const marker = resolve(root, `${behaviour}-executed`);
  writeFileSync(resolve(folder, 'error-report-provider.json'), `${JSON.stringify({
    schema: 'ewai.error-report-provider/v1', id: `fixture.${behaviour.replaceAll('_', '-')}`,
    name: `Fixture ${behaviour}`, publisher: { id: 'fixture', name: 'Fixture' },
    version: '1.0.0', protocolVersion: '1', entrypoint: 'adapter.mjs',
  }, null, 2)}\n`);
  const response = behaviour === 'malformed'
    ? "process.stdout.write('not json')"
    : behaviour === 'mismatch'
      ? "process.stdout.write(JSON.stringify({ schema: 'ewai.error-report-provider-ack/v1', attemptId: request.attemptId, archiveDigest: 'sha256:' + '0'.repeat(64), status: 'accepted', externalReference: 'BUG-2' }))"
      : behaviour === 'rejected'
        ? "process.stdout.write(JSON.stringify({ schema: 'ewai.error-report-provider-ack/v1', attemptId: request.attemptId, archiveDigest: request.archiveDigest, status: 'rejected', externalReference: '' }))"
        : "process.stdout.write(JSON.stringify({ schema: 'ewai.error-report-provider-ack/v1', attemptId: request.attemptId, archiveDigest: request.archiveDigest, status: 'accepted', externalReference: 'BUG-1' }))";
  writeFileSync(resolve(folder, 'adapter.mjs'), `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
let raw = ''; for await (const chunk of process.stdin) raw += chunk;
const request = JSON.parse(raw); writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ digest: request.archiveDigest, env: Object.keys(process.env).sort(), runtimeControl: process.env.UV_USE_IO_URING ?? null }));
${response}
`);
  chmodSync(resolve(folder, 'adapter.mjs'), 0o755);
  return { folder, marker, id: `fixture.${behaviour.replaceAll('_', '-')}` };
}

function finalised(root, id = 'report_provider') {
  createLocalErrorReport(root, input, { id, at: '2026-08-29T12:00:00.000Z' });
  return finaliseLocalErrorReport(root, id, { at: '2026-08-29T12:05:00.000Z' }).report;
}

test('validates and explicitly registers trusted provider code without executing it', () => {
  const root = project();
  try {
    const fixture = adapter(root);
    const validated = validateErrorReportProvider(fixture.folder);
    assert.equal(validated.id, fixture.id);
    assert.match(validated.packageDigest, /^sha256:[a-f0-9]{64}$/);
    assert.throws(() => readFileSync(fixture.marker), /ENOENT/);
    assert.throws(() => registerErrorReportProvider(root, fixture.folder), /confirmation/i);
    const registered = registerErrorReportProvider(root, fixture.folder, { confirmed: true });
    assert.equal(registered.id, fixture.id);
    assert.equal(listErrorReportProviders(root).providers.length, 1);
    assert.throws(() => readFileSync(fixture.marker), /ENOENT/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('requires exact digest confirmation and records an accepted digest-bound receipt', async () => {
  const root = project();
  const previousCanary = process.env.EWAI_PROVIDER_SECRET_CANARY;
  process.env.EWAI_PROVIDER_SECRET_CANARY = 'must-stay-in-parent';
  try {
    const fixture = adapter(root);
    registerErrorReportProvider(root, fixture.folder, { confirmed: true });
    const report = finalised(root);
    await assert.rejects(() => submitErrorReportProvider(root, report.id, fixture.id, { expectedDigest: report.package.archiveDigest }), /confirmation/i);
    await assert.rejects(() => submitErrorReportProvider(root, report.id, fixture.id, { confirmed: true, expectedDigest: `sha256:${'0'.repeat(64)}` }), /digest/i);
    const attempt = await submitErrorReportProvider(root, report.id, fixture.id, { confirmed: true, expectedDigest: report.package.archiveDigest });
    assert.equal(attempt.status, 'accepted');
    assert.equal(attempt.archiveDigest, report.package.archiveDigest);
    assert.equal(attempt.externalReference, 'BUG-1');
    const receipts = listErrorReportReceipts(root, report.id);
    assert.equal(receipts.receipts.length, 1);
    assert.equal(receipts.receipts[0].archiveDigest, report.package.archiveDigest);
    const invocation = JSON.parse(readFileSync(fixture.marker, 'utf8'));
    if (invocation.env.includes('UV_USE_IO_URING')) {
      assert.equal(process.platform, 'linux');
      assert.equal(invocation.runtimeControl, '0');
    }
    assert.deepEqual(
      invocation.env.filter((name) => !name.startsWith('__CF_') && name !== 'UV_USE_IO_URING'),
      ['EWAI_ERROR_REPORT_PROTOCOL', 'LANG', 'PATH'],
    );
    assert.equal(invocation.env.some((name) => /token|secret|key|home/i.test(name)), false);
  } finally {
    if (previousCanary === undefined) delete process.env.EWAI_PROVIDER_SECRET_CANARY;
    else process.env.EWAI_PROVIDER_SECRET_CANARY = previousCanary;
    rmSync(root, { recursive: true, force: true });
  }
});

test('preserves malformed, rejected and digest-mismatched attempts without a success receipt', async () => {
  for (const behaviour of ['malformed', 'rejected', 'mismatch']) {
    const root = project();
    try {
      const fixture = adapter(root, behaviour);
      registerErrorReportProvider(root, fixture.folder, { confirmed: true });
      const report = finalised(root, `report_${behaviour}`);
      const attempt = await submitErrorReportProvider(root, report.id, fixture.id, { confirmed: true, expectedDigest: report.package.archiveDigest });
      assert.equal(attempt.status, 'failed');
      assert.equal(listErrorReportReceipts(root, report.id).receipts.length, 0);
      assert.equal(listErrorReportReceipts(root, report.id).attempts.length, 1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});
