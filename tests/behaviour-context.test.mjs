import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import YAML from 'yaml';
import { initProject } from '../src/project.mjs';
import { createIntent } from '../src/intents.mjs';
import { refreshRepositoryIndex } from '../src/runtime/repository-index.mjs';
import { fileContext, formatFileCard } from '../src/runtime/repository-context.mjs';
import { previewImpactAssessment, confirmImpactAssessment } from '../src/runtime/impact-analysis.mjs';
import { fileBehaviourContext, readBehaviourContext } from '../src/runtime/behaviour-context.mjs';

const cli = resolve(import.meta.dirname, '../bin/ewai');
const hash = value => createHash('sha256').update(value).digest('hex');
function write(root, path, value) {
  mkdirSync(dirname(resolve(root, path)), { recursive: true });
  writeFileSync(resolve(root, path), typeof value === 'string' ? value : JSON.stringify(value));
}
function project() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-behaviour-'));
  initProject(root, { name: 'Behaviour context' });
  write(root, 'src/access.mjs', 'export function requestAccess() { return true; }\nexport function revokeAccess() { return false; }\n');
  write(root, 'src/form.mjs', "import { requestAccess } from './access.mjs';\nexport function submit() { return requestAccess(); }\n");
  return root;
}
function delivery(root, slug, { repo = 'application', symbol = 'requestAccess', completed = true } = {}) {
  createIntent(root, { slug, domain: 'access', title: `Access ${slug}` });
  const base = `SPECS/6.Build/${slug}`;
  const claim = `${slug}-C1`;
  write(root, `${base}/gates/plan/claim-ledger.json`, { slug, implementation_claims: [{ id: claim, statement: `Protect ${slug}`, acceptance: [`${slug}-AC1: Users can ${slug}`], planned_files: ['src/access.mjs'], current_code_evidence: [{ source_path: 'src/access.mjs', symbols: [symbol] }] }] });
  write(root, `${base}/gates/plan/plan-contract.json`, { test_obligations: [{ id: 'TEST1', task: 'T-001', file: `tests/${slug}.test.mjs`, obligation: `Check ${slug}` }] });
  write(root, `${base}/task-graph.json`, { tasks: [{ id: 'T-001', repo, claims: [claim], write_set: ['src/access.mjs'], evidence_path: 'tasks/T-001/evidence.json', completion_evidence: [`${slug} is delivered`] }] });
  write(root, `${base}/delivery-state.json`, { schema: 'ewai.delivery-state/v1', slug, intent: { id: `access/${slug}`, title: `Access ${slug}` }, status: completed ? 'paused-awaiting-manual-qa' : 'in-progress', currentPhase: completed ? 'manual-qa' : 'plan' });
  if (completed) {
    write(root, `${base}/tasks/T-001/review.txt`, `Reviewed ${slug}`);
    write(root, `${base}/tasks/T-001/green.txt`, `Controlled recorded output ${slug}`);
    write(root, `${base}/tasks/T-001/evidence.json`, { schema: 'ewai.task-evidence/v2', task_id: 'T-001', repository: repo, commit: 'recorded-commit', changed_files: ['src/access.mjs'], commands: [{ stage: 'green', command: `node --test tests/${slug}.test.mjs`, exit_code: 0, output_path: 'tasks/T-001/green.txt', output_sha256: hash(`Controlled recorded output ${slug}`) }], review: { status: 'pass', evidence_path: 'tasks/T-001/review.txt', evidence_sha256: hash(`Reviewed ${slug}`) }, completion_checks: [{ name: `${slug} is delivered`, status: 'pass', support: `Check ${slug}`, evidence_path: 'tasks/T-001/review.txt', evidence_sha256: hash(`Reviewed ${slug}`) }] });
  }
  return base;
}

test('joins exact code to claims, criteria, planned tests and recorded evidence across intents without mutating records', () => {
  const root = project();
  try {
    const first = delivery(root, 'request');
    delivery(root, 'revoke', { symbol: 'revokeAccess', completed: false });
    const original = readFileSync(resolve(root, `${first}/gates/plan/claim-ledger.json`));
    const result = fileBehaviourContext(root, 'src/access.mjs');
    assert.equal(result.schema, 'ewai.behaviour-context/v1');
    assert.equal(result.status, 'has-context');
    assert.equal(result.claims.length, 2);
    const request = result.claims.find(item => item.claimId === 'request-C1');
    assert.deepEqual(request.acceptanceCriteria, ['request-AC1: Users can request']);
    assert.equal(request.delivery.status, 'paused-awaiting-manual-qa');
    assert.equal(request.tests[0].file, 'tests/request.test.mjs');
    assert.equal(request.tasks[0].evidence.status, 'recorded');
    assert.equal(request.tasks[0].completionChecks[0].evidence.freshness, 'current');
    assert.equal(result.claims.find(item => item.claimId === 'revoke-C1').tasks[0].evidence.status, 'missing');
    assert.equal(result.claims.every(item => item.semanticSupport === 'not-assessed'), true);
    assert.equal(JSON.stringify(result).includes(root), false);
    assert.deepEqual(readFileSync(resolve(root, `${first}/gates/plan/claim-ledger.json`)), original);
    const selected = fileBehaviourContext(root, 'src/access.mjs', { symbol: 'requestAccess' });
    assert.equal(selected.claims.find(item => item.claimId === 'request-C1').matches.some(item => item.scope === 'symbol'), true);
    assert.equal(selected.claims.find(item => item.claimId === 'revoke-C1').matches.every(item => item.scope === 'file'), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('changed review hashes change the digest and never appear current; invalid historical evidence is explicit', () => {
  const root = project();
  try {
    const base = delivery(root, 'request');
    const before = fileBehaviourContext(root, 'application:src/access.mjs');
    write(root, `${base}/tasks/T-001/review.txt`, 'Changed review');
    const after = fileBehaviourContext(root, 'src/access.mjs');
    assert.notEqual(after.digest, before.digest);
    assert.equal(after.claims[0].tasks[0].completionChecks[0].evidence.freshness, 'changed');
    write(root, `${base}/tasks/T-001/evidence.json`, '{secret: do-not-echo-this');
    const invalid = fileBehaviourContext(root, 'src/access.mjs');
    assert.equal(invalid.claims[0].tasks[0].evidence.status, 'invalid');
    assert.equal(JSON.stringify(invalid).includes('do-not-echo-this'), false);
    assert.equal(invalid.coverage.complete, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('historical source_file and files_touched locators preserve intent fallback and actual-only changes', () => {
  const root = project();
  try {
    const base = delivery(root, 'request');
    const ledgerPath = resolve(root, `${base}/gates/plan/claim-ledger.json`);
    const ledger = JSON.parse(readFileSync(ledgerPath));
    const claim = ledger.implementation_claims[0];
    delete claim.acceptance;
    delete claim.planned_files;
    claim.current_code_evidence = [{ source_file: '../../../src/access.mjs', symbols: ['requestAccess'] }];
    claim.files_touched = ['src/access.mjs'];
    write(root, `${base}/gates/plan/claim-ledger.json`, ledger);
    const statePath = `${base}/delivery-state.json`;
    const state = JSON.parse(readFileSync(resolve(root, statePath)));
    state.intent.path = 'SPECS/2.Purpose/intents/access/request.md';
    write(root, statePath, state);
    const intentPath = resolve(root, state.intent.path);
    writeFileSync(intentPath, readFileSync(intentPath, 'utf8').replace('## Acceptance criteria\n', '## Acceptance criteria\n\n- AC1: Users can request access.\n'));
    let result = fileBehaviourContext(root, 'src/access.mjs', { symbol: 'requestAccess' });
    assert.equal(result.claims[0].acceptanceScope, 'intent-fallback');
    assert.deepEqual(result.claims[0].intentAcceptanceCriteria, ['AC1: Users can request access.']);
    assert.equal(result.claims[0].matches.some(item => item.scope === 'symbol'), true);
    claim.current_code_evidence = [];
    claim.files_touched = [];
    write(root, `${base}/gates/plan/claim-ledger.json`, ledger);
    result = fileBehaviourContext(root, 'src/access.mjs');
    assert.equal(result.claims[0].matches[0].basis, 'task-changed-file');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('repository identity rejects ambiguity and keeps same-path claims separate', () => {
  const root = project();
  try {
    const config = YAML.parse(readFileSync(resolve(root, 'SPECS/pipeline.yaml'), 'utf8'));
    config.repositories = [{ name: 'api', path: 'api' }, { name: 'web', path: 'web' }];
    write(root, 'SPECS/pipeline.yaml', YAML.stringify(config));
    write(root, 'api/src/access.mjs', 'export function requestAccess() {}');
    write(root, 'web/src/access.mjs', 'export function requestAccess() {}');
    delivery(root, 'api-access', { repo: 'api' });
    delivery(root, 'web-access', { repo: 'web' });
    assert.equal(fileBehaviourContext(root, 'src/access.mjs').status, 'ambiguous');
    const api = fileBehaviourContext(root, 'api:src/access.mjs');
    assert.deepEqual(api.claims.map(item => item.claimId), ['api-access-C1']);
    assert.equal(api.targets[0].repository, 'api');
    assert.throws(() => fileBehaviourContext(root, 'api:src/access.mjs', { repository: 'web' }), /repository/i);
    refreshRepositoryIndex(root);
    const impact = previewImpactAssessment(root, 'api-access', { summary: 'Change API access.', targets: ['api:src/access.mjs'] });
    assert.deepEqual(impact.behaviourContext.claims.map(item => item.claimId), ['api-access-C1']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('unsafe paths, symlinked records, oversized records and result limits disclose partial coverage', () => {
  const root = project();
  const outside = mkdtempSync(resolve(tmpdir(), 'ewai-behaviour-outside-'));
  try {
    const base = delivery(root, 'request');
    for (const path of ['../outside', '/tmp/outside', 'src/../access.mjs', 'src\\access.mjs', 'src/access.mjs\u0000']) assert.throws(() => fileBehaviourContext(root, path), /relative|locator/i);
    write(outside, 'secret.json', '{"secret":"must-not-leak"}');
    rmSync(resolve(root, `${base}/tasks/T-001/evidence.json`));
    symlinkSync(resolve(outside, 'secret.json'), resolve(root, `${base}/tasks/T-001/evidence.json`));
    let result = fileBehaviourContext(root, 'src/access.mjs');
    assert.equal(result.coverage.complete, false);
    assert.equal(JSON.stringify(result).includes('must-not-leak'), false);
    write(root, 'SPECS/6.Build/oversized/gates/plan/claim-ledger.json', ' '.repeat(900001));
    delivery(root, 'revoke');
    result = fileBehaviourContext(root, 'src/access.mjs', { limit: 1 });
    assert.equal(result.claims.length, 1);
    assert.equal(result.coverage.truncated, true);
    assert.equal(result.coverage.diagnostics.some(item => item.code === 'oversized'), true);
    assert.equal(fileBehaviourContext(root, 'src/missing.mjs').status, 'not-found');
    assert.equal(fileBehaviourContext(root, 'src/form.mjs').status, 'no-context');
    assert.throws(() => readBehaviourContext(root, Array(81).fill('src/access.mjs')), /targets/i);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test('configured repository ancestors cannot traverse a symlink into another tree', () => {
  const root = project(), outside = mkdtempSync(resolve(tmpdir(), 'ewai-behaviour-linked-'));
  try {
    write(outside, 'sub/src/access.mjs', 'PRIVATE_SOURCE_CANARY');
    symlinkSync(outside, resolve(root, 'alias'));
    const config = YAML.parse(readFileSync(resolve(root, 'SPECS/pipeline.yaml'), 'utf8'));
    config.repositories = [{ name: 'external', path: 'alias/sub' }];
    write(root, 'SPECS/pipeline.yaml', YAML.stringify(config));
    const result = fileBehaviourContext(root, 'external:src/access.mjs');
    assert.equal(result.targets[0].status, 'unavailable');
    assert.equal(result.targets[0].contentDigest, null);
    assert.equal(result.coverage.diagnostics.some(item => item.code === 'symlink'), true);
    assert.equal(JSON.stringify(result).includes('PRIVATE_SOURCE_CANARY'), false);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test('malformed evidence shapes, truncated nested records and contradictory repository identities remain uncertain', () => {
  const root = project();
  try {
    const base = delivery(root, 'request');
    const evidencePath = `${base}/tasks/T-001/evidence.json`;
    const original = JSON.parse(readFileSync(resolve(root, evidencePath)));
    write(root, evidencePath, { ...original, commands: 'MALFORMED', completion_checks: 'MALFORMED' });
    write(root, `${base}/gates/plan/plan-contract.json`, { test_obligations: 'MALFORMED' });
    let result = fileBehaviourContext(root, 'src/access.mjs');
    assert.equal(result.claims[0].tasks[0].evidence.status, 'invalid');
    assert.equal(result.coverage.complete, false);
    assert.equal(result.coverage.diagnostics.some(item => item.code === 'invalid-array'), true);
    write(root, evidencePath, { ...original, completion_checks: Array(1001).fill(original.completion_checks[0]) });
    write(root, `${base}/gates/plan/plan-contract.json`, { test_obligations: [] });
    result = fileBehaviourContext(root, 'src/access.mjs');
    assert.equal(result.coverage.complete, false);
    assert.equal(result.coverage.diagnostics.some(item => item.code === 'record-limit'), true);
    assert.equal(result.coverage.truncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 520000);
    write(root, evidencePath, original);
    const ledgerPath = `${base}/gates/plan/claim-ledger.json`;
    const ledger = JSON.parse(readFileSync(resolve(root, ledgerPath)));
    ledger.implementation_claims[0].current_code_evidence = [{ source_path: 'web:src/access.mjs', repository: 'application' }];
    write(root, ledgerPath, ledger);
    result = fileBehaviourContext(root, 'src/access.mjs');
    assert.equal(result.claims[0].matches.some(item => item.basis === 'authored-code-evidence'), false);
    assert.equal(result.coverage.diagnostics.some(item => item.code === 'conflicting-repository'), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CLI, MCP, indexed file cards and Impact reuse the same behaviour projection', async () => {
  const root = project();
  let client;
  try {
    delivery(root, 'request');
    refreshRepositoryIndex(root);
    const result = spawnSync(process.execPath, [cli, 'index', 'behaviour', 'src/access.mjs', '--project', root, '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const reading = JSON.parse(result.stdout);
    const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp', '--project', root], cwd: root, stderr: 'pipe' });
    client = new Client({ name: 'behaviour-test', version: '1.0.0' });
    await client.connect(transport);
    const tools = await client.listTools();
    const tool = tools.tools.find(item => item.name === 'ewai_index_behaviour');
    assert.equal(tool.annotations.readOnlyHint, true);
    const mcp = await client.callTool({ name: 'ewai_index_behaviour', arguments: { file: 'src/access.mjs' } });
    assert.deepEqual(mcp.structuredContent, reading);
    const card = fileContext(root, 'src/access.mjs');
    assert.equal(card.behaviour.claims[0].claimId, 'request-C1');
    assert.match(formatFileCard(card), /request-C1/);
    const impact = previewImpactAssessment(root, 'request', { summary: 'Change customer access behaviour.', targets: ['src/form.mjs'] });
    assert.equal(impact.behaviourContext.claims[0].claimId, 'request-C1');
    assert.equal(impact.guidance.approvalsChanged, false);
    const decisions = Object.fromEntries(impact.reviewRoutes.map(item => [item.id, item.recommendation]));
    const confirmed = confirmImpactAssessment(root, 'request', { summary: impact.summary, targets: impact.targets, indexRunId: impact.index.runId, acknowledged: true, assessor: 'Test reviewer', decisions });
    assert.equal(confirmed.assessment.behaviourContext.digest, impact.behaviourContext.digest);
    write(root, 'SPECS/6.Build/request/tasks/T-001/review.txt', 'Changed review');
    assert.throws(() => confirmImpactAssessment(root, 'request', { summary: impact.summary, targets: impact.targets, indexRunId: impact.index.runId, behaviourDigest: impact.behaviourContext.digest, acknowledged: true, assessor: 'Test reviewer', decisions }), /behaviour evidence changed/i);
  } finally { await client?.close().catch(() => {}); rmSync(root, { recursive: true, force: true }); }
});
