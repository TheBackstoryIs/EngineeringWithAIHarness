import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { initProject } from '../src/project.mjs';
import {
  archiveErrorReport,
  captureErrorReportFailure,
  createLocalErrorReport,
  deleteErrorReport,
  errorReportSettings,
  finaliseLocalErrorReport,
  listLocalErrorReports,
  prepareErrorReportEmail,
  readLocalErrorReport,
  updateErrorReportSettings,
  updateLocalErrorReport,
} from '../src/runtime/error-reporting.mjs';

const input = {
  capability: 'guided-discovery',
  errorCode: 'EWAI-DISCOVERY-INVALID',
  command: 'ewai discover',
  ewaiVersion: '0.2.1',
  nodeVersion: '22',
  osClass: 'darwin',
  installationSource: 'npm',
  title: 'Discovery did not validate',
  expected: 'A valid project brief.',
  actual: 'Validation stopped.',
  reproductionSteps: ['Run guided discovery'],
};

function project() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-error-report-runtime-'));
  initProject(root, { name: 'Error report test' });
  return root;
}

test('creates deterministic local folders and safe defaults lazily', () => {
  const root = project();
  try {
    const settings = errorReportSettings(root);
    assert.deepEqual(settings, {
      schema: 'ewai.error-report-settings/v1',
      automaticLocalDrafts: false,
      supportEmail: '',
    });
    for (const name of ['drafts', 'packages', 'receipts', 'archive', 'adapters']) {
      assert.equal(existsSync(resolve(root, `.ewai-pipeline/error-reports/${name}`)), true);
    }
    assert.equal(readFileSync(resolve(root, '.ewai-pipeline/.gitignore'), 'utf8'), '*\n!.gitignore\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('creates, revises, finalises and revisions immutable reports', () => {
  const root = project();
  try {
    const created = createLocalErrorReport(root, input, { id: 'report_runtime', at: '2026-08-29T12:00:00.000Z' });
    assert.equal(created.status, 'draft');
    assert.equal(listLocalErrorReports(root).reports.length, 1);
    const revised = updateLocalErrorReport(root, created.id, { actual: 'A safer revised description.' }, { at: '2026-08-29T12:05:00.000Z' });
    assert.equal(revised.revision, 2);
    const finalised = finaliseLocalErrorReport(root, created.id, { at: '2026-08-29T12:10:00.000Z' });
    assert.equal(finalised.report.status, 'finalised');
    assert.match(finalised.report.package.archiveDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(existsSync(resolve(root, finalised.package.relativePath)), true);
    assert.throws(() => finaliseLocalErrorReport(root, created.id), /already finalised/i);

    const newRevision = updateLocalErrorReport(root, created.id, { actual: 'New evidence after finalisation.' }, { at: '2026-08-29T12:20:00.000Z' });
    assert.equal(newRevision.status, 'draft');
    assert.equal(newRevision.revision, 3);
    assert.equal(readLocalErrorReport(root, created.id).revision, 3);
    assert.equal(existsSync(resolve(root, finalised.package.relativePath)), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('automatic capture is opt-in, deduplicated and local-only', () => {
  const root = project();
  try {
    assert.deepEqual(captureErrorReportFailure(root, input), { captured: false, reason: 'automatic-local-drafts-disabled' });
    updateErrorReportSettings(root, { automaticLocalDrafts: true });
    const first = captureErrorReportFailure(root, input, { at: '2026-08-29T12:00:00.000Z' });
    const second = captureErrorReportFailure(root, input, { at: '2026-08-29T12:01:00.000Z' });
    assert.equal(first.captured, true);
    assert.equal(second.deduplicated, true);
    assert.equal(first.report.id, second.report.id);
    assert.equal(listLocalErrorReports(root).reports.length, 1);
    assert.equal(JSON.stringify(second).includes('provider'), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('prepares email honestly, archives and explicitly deletes local material', () => {
  const root = project();
  try {
    updateErrorReportSettings(root, { supportEmail: 'support@example.invalid' });
    const report = createLocalErrorReport(root, input, { id: 'report_email', at: '2026-08-29T12:00:00.000Z' });
    const finalised = finaliseLocalErrorReport(root, report.id, { at: '2026-08-29T12:05:00.000Z' });
    const prepared = prepareErrorReportEmail(root, report.id, { expectedDigest: finalised.report.package.archiveDigest });
    assert.match(prepared.mailto, /^mailto:support@example\.invalid\?/);
    assert.match(prepared.message, /not sent/i);
    assert.match(prepared.message, /attach.*ZIP manually/i);
    assert.equal(prepared.status, 'prepared-not-sent');
    assert.equal(prepared.archiveDigest, finalised.report.package.archiveDigest);

    const archived = archiveErrorReport(root, report.id, { confirmed: true });
    assert.equal(archived.status, 'archived');
    assert.throws(() => deleteErrorReport(root, report.id), /confirmation/i);
    const deleted = deleteErrorReport(root, report.id, { confirmed: true });
    assert.equal(deleted.localMaterialRemoved, true);
    assert.equal(readLocalErrorReport(root, report.id), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('explicit email handoff reveals the package and opens the default client without claiming delivery', () => {
  const root = project();
  try {
    const report = createLocalErrorReport(root, input, { id: 'report_handoff', at: '2026-08-29T12:00:00.000Z' });
    const finalised = finaliseLocalErrorReport(root, report.id, { at: '2026-08-29T12:05:00.000Z' });
    const invocations = [];
    const prepared = prepareErrorReportEmail(root, report.id, {
      expectedDigest: finalised.report.package.archiveDigest,
      launch: true,
      platform: 'darwin',
      launcher(command, args) { invocations.push({ command, args }); return { status: 0, error: null }; },
    });
    assert.equal(prepared.status, 'prepared-not-sent');
    assert.deepEqual(prepared.handoff, {
      requested: true,
      status: 'launch-requested',
      packageReveal: 'launch-requested',
      emailClient: 'launch-requested',
    });
    assert.equal(invocations[0].command, 'open');
    assert.equal(invocations[0].args[0], '-R');
    assert.match(invocations[1].args[0], /^mailto:/);
    assert.doesNotMatch(JSON.stringify(prepared.handoff), /attached|sent|delivered/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
