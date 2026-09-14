import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildErrorReportPackage,
  createErrorReportDraft,
  finaliseErrorReport,
} from '../src/error-reporting.mjs';

const input = {
  capability: 'dashboard',
  errorCode: 'EWAI-UI-LOAD',
  command: 'ewai dashboard',
  ewaiVersion: '0.2.1',
  nodeVersion: '22',
  osClass: 'linux',
  installationSource: 'npm',
  title: 'Error Reporting view did not load',
  expected: 'The local report ledger should load.',
  actual: 'The dashboard showed a bounded error.',
  reproductionSteps: ['Open the local dashboard', 'Choose Error Reporting'],
};

function parseStoredZip(bytes) {
  const members = new Map();
  let offset = 0;
  while (offset + 4 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8);
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    assert.equal(method, 0);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    members.set(name, bytes.subarray(start, start + size));
    offset = start + size;
  }
  return members;
}

test('creates a deterministic ZIP with the canonical members and digests', () => {
  const draft = createErrorReportDraft(input, { id: 'report_zip', at: '2026-08-29T12:00:00.000Z' });
  const first = buildErrorReportPackage(draft);
  const second = buildErrorReportPackage(draft);
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.archiveDigest, `sha256:${createHash('sha256').update(first.bytes).digest('hex')}`);
  const members = parseStoredZip(first.bytes);
  assert.deepEqual([...members.keys()], ['diagnostics.json', 'redaction-report.json', 'summary.md', 'manifest.json']);
  const manifest = JSON.parse(members.get('manifest.json').toString('utf8'));
  assert.equal(manifest.schema, 'ewai.error-report-package/v1');
  assert.match(manifest.packageDigest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(manifest.members.map(({ name }) => name), ['diagnostics.json', 'redaction-report.json', 'summary.md']);
  for (const member of manifest.members) {
    assert.equal(member.digest, `sha256:${createHash('sha256').update(members.get(member.name)).digest('hex')}`);
  }
});

test('includes only explicit safe attachments and rejects unsafe members', () => {
  const draft = createErrorReportDraft(input, { id: 'report_attachment', at: '2026-08-29T12:00:00.000Z' });
  const packaged = buildErrorReportPackage(draft, {
    attachments: [{ name: 'screenshot.txt', bytes: Buffer.from('safe fixture\n') }],
  });
  assert.deepEqual([...parseStoredZip(packaged.bytes).keys()], [
    'diagnostics.json', 'redaction-report.json', 'summary.md', 'attachments/screenshot.txt', 'manifest.json',
  ]);
  assert.throws(() => buildErrorReportPackage(draft, { attachments: [{ name: '../secret.txt', bytes: Buffer.from('x') }] }), /attachment name/i);
  assert.throws(() => buildErrorReportPackage(draft, { attachments: [{ name: 'large.txt', bytes: Buffer.alloc(5 * 1024 * 1024 + 1) }] }), /attachment.*large/i);
});

test('finalisation is immutable and changes the digest when material content changes', () => {
  const draft = createErrorReportDraft(input, { id: 'report_final', at: '2026-08-29T12:00:00.000Z' });
  const finalised = finaliseErrorReport(draft, { at: '2026-08-29T12:10:00.000Z' });
  assert.equal(finalised.report.status, 'finalised');
  assert.equal(finalised.report.package.archiveDigest, finalised.package.archiveDigest);
  assert.throws(() => finaliseErrorReport(finalised.report), /already finalised/i);
  const changed = createErrorReportDraft({ ...input, actual: 'A materially different safe result.' }, { id: 'report_changed', at: '2026-08-29T12:00:00.000Z' });
  assert.notEqual(buildErrorReportPackage(draft).archiveDigest, buildErrorReportPackage(changed).archiveDigest);
});
