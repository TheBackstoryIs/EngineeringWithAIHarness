import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ERROR_REPORT_EXCLUDED_CLASSES,
  createErrorReportDraft,
  errorReportIdentity,
  reviseErrorReport,
} from '../src/error-reporting.mjs';

const base = {
  capability: 'guided-discovery',
  errorCode: 'EWAI-DISCOVERY-INVALID',
  command: 'ewai discover',
  ewaiVersion: '0.2.1',
  nodeVersion: '22',
  osClass: 'darwin',
  installationSource: 'npm',
  title: 'Discovery could not validate its output',
  expected: 'The generated project brief should validate.',
  actual: 'Validation stopped with a structured error.',
  reproductionSteps: ['Initialise an existing project', 'Run guided discovery'],
};

test('creates a closed, bounded, path-neutral error-report draft', () => {
  const draft = createErrorReportDraft(base, {
    id: 'report_fixture',
    at: '2026-08-29T12:00:00.000Z',
    excluded: {
      environment: { TOKEN: 'secret-canary' },
      repositoryName: 'private-repository-canary',
      absolutePath: '/Users/example/private-repository-canary',
      prompt: 'prompt-canary',
      rawLog: 'log-canary',
    },
  });

  assert.equal(draft.schema, 'ewai.error-report/v1');
  assert.equal(draft.status, 'draft');
  assert.equal(draft.revision, 1);
  assert.equal(draft.diagnostics.osClass, 'darwin');
  assert.equal(draft.redactions.schema, 'ewai.error-report-redactions/v1');
  assert.deepEqual(draft.redactions.classes, [
    'absolute-paths', 'environment-values', 'prompts-and-responses', 'raw-logs', 'repository-names',
  ]);
  assert.equal(draft.redactions.classes.every((name) => ERROR_REPORT_EXCLUDED_CLASSES.includes(name)), true);
  const persisted = JSON.stringify(draft);
  for (const canary of ['secret-canary', 'private-repository-canary', 'prompt-canary', 'log-canary', '/Users/example']) {
    assert.equal(persisted.includes(canary), false);
  }
  assert.match(errorReportIdentity(draft), /^sha256:[a-f0-9]{64}$/);
});

test('rejects unknown, unsafe and oversized report input', () => {
  assert.throws(() => createErrorReportDraft({ ...base, rawDiagnostics: { token: 'x' } }), /unknown field/i);
  assert.throws(() => createErrorReportDraft({ ...base, errorCode: '../escape' }), /error code/i);
  assert.throws(() => createErrorReportDraft({ ...base, command: 'ewai discover --token secret' }), /command/i);
  assert.throws(() => createErrorReportDraft({ ...base, title: 'x'.repeat(501) }), /title/i);
  assert.throws(() => createErrorReportDraft({ ...base, reproductionSteps: Array.from({ length: 51 }, () => 'step') }), /reproduction/i);
  assert.throws(() => createErrorReportDraft({ ...base, reproductionSteps: ['/Users/example/project'] }), /absolute path/i);
});

test('identity is stable across input order and absolute roots', () => {
  const first = createErrorReportDraft(base, { id: 'report_fixture', at: '2026-08-29T12:00:00.000Z' });
  const reordered = Object.fromEntries(Object.entries(base).reverse());
  const second = createErrorReportDraft(reordered, {
    id: 'report_fixture',
    at: '2026-08-29T12:00:00.000Z',
    projectRoot: '/different/private/root',
  });
  assert.equal(errorReportIdentity(first), errorReportIdentity(second));
});

test('revises drafts and refuses mutation after finalisation', () => {
  const draft = createErrorReportDraft(base, { id: 'report_fixture', at: '2026-08-29T12:00:00.000Z' });
  const revised = reviseErrorReport(draft, { actual: 'A refined safe description.' }, { at: '2026-08-29T12:05:00.000Z' });
  assert.equal(revised.revision, 2);
  assert.equal(revised.description.actual, 'A refined safe description.');
  assert.notEqual(errorReportIdentity(draft), errorReportIdentity(revised));
  assert.throws(() => reviseErrorReport({ ...revised, status: 'finalised' }, { title: 'Changed' }), /finalised.*immutable/i);
});
