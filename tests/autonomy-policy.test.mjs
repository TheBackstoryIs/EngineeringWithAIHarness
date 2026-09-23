import test from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, relative, dirname } from 'node:path';
import YAML from 'yaml';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { initProject } from '../src/project.mjs';
import { createIntent, updateIntentDeliveryState } from '../src/intents.mjs';
import { beginDelivery, phaseGateTemplate, recordPhaseGate, completeDeliveryPhase } from '../src/delivery.mjs';
import { requiredPhaseArtefacts } from '../src/delivery-artifacts.mjs';
import { listOrganisationBlueprints, resolveOrganisationBlueprint } from '../src/organisation-blueprints.mjs';
import { materialisePolicyBaseline, resolveOrganisationPolicy } from '../src/organisation-policies.mjs';
import { confirmPolicyFacts, evaluatePolicyDesign, preparePolicyFacts } from '../src/policy-design-gates.mjs';
import { evaluatePolicyGate, readPolicyEvidenceFreshness } from '../src/policy-gate-integration.mjs';
import { updateWorkItem } from '../src/runtime/work.mjs';
import { deriveExecutionState } from '../src/execution-state.mjs';
import { readRuntimeIntent } from '../src/runtime/intents.mjs';
import { readAutonomyPolicy, previewAutonomy, approveAutonomyGrant } from '../src/autonomy.mjs';

function fixture(t, specsRoot = 'knowledge') {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'ewai-autonomy-policy-')));
  initProject(root, { name: 'Autonomy consumer', specsRoot });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function intent(root, slug, status = 'ready', options = {}) {
  const result = createIntent(root, { domain: 'product', slug, ...options });
  updateIntentDeliveryState(root, result.path, { status });
  return result;
}
function proposal(ids, changes = {}) {
  return { intentIds: ids, actions: ['begin-harness', 'prepare-phase'], providers: ['codex'],
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    limits: { maxConcurrentIntents: 1, maxRuntimeMs: 60000, maxOperationMs: 10000, maxAttempts: 2 }, ...changes };
}
function approve(root, input) {
  const preview = previewAutonomy(root, { proposal: input, record: true });
  return approveAutonomyGrant(root, { expectedDigest: preview.digest, approvedBy: 'Fixture owner', confirmed: true });
}
function inventory(root) {
  const found = [];
  const visit = dir => { for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (entry.isFile()) found.push([relative(root, path), createHash('sha256').update(readFileSync(path)).digest('hex')]);
  } };
  visit(root); return found.sort(([a], [b]) => a.localeCompare(b));
}
const codes = item => item.reasons.map(reason => reason.code);
const previewPath = (root, digest) => resolve(root, '.ewai-pipeline/runtime/autonomy/previews',
  readdirSync(resolve(root, '.ewai-pipeline/runtime/autonomy/previews')).find(name => name.endsWith(`${digest.slice(7)}.json`)));

// PTS-002 / PTS-003: the complete positive flow, not a missing-module assertion.
test('exact approved pool excludes new intents and shadow never invokes delivery', t => {
  const root = fixture(t); intent(root, 'alpha'); intent(root, 'beta');
  assert.equal(readAutonomyPolicy(root).mode, 'off');
  const grant = approve(root, proposal(['product/alpha', 'product/beta']));
  assert.equal(grant.approvedBy, 'Fixture owner');
  intent(root, 'gamma');
  const before = inventory(root);
  const preview = previewAutonomy(root);
  assert.deepEqual(preview.executable.map(item => item.intentId), ['product/alpha', 'product/beta']);
  assert.ok(codes(preview.blocked.find(item => item.intentId === 'product/gamma')).includes('outside-approved-pool'));
  assert.equal(preview.authority, 'none');
  assert.deepEqual(inventory(root), before);
  assert.deepEqual(previewAutonomy(root), preview);
});

test('shadow has no execution side effects (PTS-002)', t => {
  const root = fixture(t); intent(root, 'ready'); intent(root, 'draft', 'draft');
  const before = inventory(root);
  for (let i = 0; i < 3; i++) previewAutonomy(root, { proposal: proposal(['product/ready']) });
  assert.deepEqual(inventory(root), before);
  const draft = previewAutonomy(root, { proposal: proposal(['product/ready']), record: true });
  assert.equal(readAutonomyPolicy(root).mode, 'off');
  const added = inventory(root).filter(([path]) => !before.some(([old]) => old === path));
  assert.deepEqual(added.map(([path]) => path), [relative(root, previewPath(root, draft.digest))]);
});

test('named approval admits only the exact pool (PTS-003)', t => {
  const root = fixture(t); intent(root, 'alpha');
  const input = proposal(['product/alpha']);
  const preview = previewAutonomy(root, { proposal: input, record: true });
  for (const extra of [{ confirmed: false }, { approvedBy: '' }, { approvedBy: 'robot\nowner' }]) {
    assert.throws(() => approveAutonomyGrant(root, { expectedDigest: preview.digest, approvedBy: 'Owner', confirmed: true, ...extra }));
    assert.equal(readAutonomyPolicy(root).mode, 'off');
  }
  const grant = approveAutonomyGrant(root, { expectedDigest: preview.digest, approvedBy: 'Owner', confirmed: true });
  assert.equal(grant.proposalDigest, preview.digest);
  assert.deepEqual(grant.scope, input);
  assert.equal(grant.revision, 1);
  assert.equal(readAutonomyPolicy(root).mode, 'delegated');
  const history = inventory(resolve(root, 'knowledge/3.Evidence/autonomy/grants'));
  assert.throws(() => approveAutonomyGrant(root, { expectedDigest: preview.digest, approvedBy: 'Owner', confirmed: true }), { code: 'autonomy-preview-stale' });
  assert.deepEqual(inventory(resolve(root, 'knowledge/3.Evidence/autonomy/grants')), history);
});

test('stale approval or scope expansion is rejected (PTS-004)', t => {
  const root = fixture(t); const source = intent(root, 'alpha'); intent(root, 'beta');
  const input = proposal(['product/alpha']);
  const preview = previewAutonomy(root, { proposal: input, record: true });
  writeFileSync(source.path, readFileSync(source.path, 'utf8') + '\nChanged outcome.\n');
  assert.throws(() => approveAutonomyGrant(root, { expectedDigest: preview.digest, approvedBy: 'Owner', confirmed: true }), { code: 'autonomy-preview-stale' });
  assert.equal(readAutonomyPolicy(root).mode, 'off');
  const grant = approve(root, input);
  const prior = inventory(resolve(root, 'knowledge/3.Evidence/autonomy/grants'));
  assert.throws(() => approveAutonomyGrant(root, { expectedDigest: grant.proposalDigest, approvedBy: 'Owner', confirmed: true, intentIds: ['product/beta'] }));
  assert.deepEqual(inventory(resolve(root, 'knowledge/3.Evidence/autonomy/grants')), prior);
  const successor = approve(root, proposal(['product/alpha', 'product/beta']));
  assert.equal(successor.revision, 2); assert.equal(successor.id, grant.id);
  assert.equal(inventory(resolve(root, 'knowledge/3.Evidence/autonomy/grants')).length, 2);
});

test('strict scopes reject unknown fields, wildcards, human actions and unenforceable budgets', t => {
  const root = fixture(t); intent(root, 'alpha');
  const input = proposal(['product/alpha']);
  for (const changes of [
    { intentIds: ['product/*'] }, { intentIds: ['../alpha'] }, { intentIds: ['product/alpha', 'product/alpha'] },
    { intentIds: ['product/missing'] }, { providers: ['anything'] }, { providers: [] }, { command: 'secret-canary' },
    { actions: ['approve-build'] }, { actions: ['manual-qa'] }, { actions: ['release'] }, { actions: ['deploy'] },
    { expiresAt: 'yesterday' }, { expiresAt: '2020-01-01T00:00:00.000Z' },
    ...[0, -1, Infinity, NaN, '2', 1.5].map(maxAttempts => ({ limits: { ...input.limits, maxAttempts } })),
    { limits: { ...input.limits, hardMoneyCap: 10 } }, { limits: { ...input.limits, maxConcurrentIntents: 2 } },
  ]) assert.throws(() => previewAutonomy(root, { proposal: { ...input, ...changes }, record: true }));
  assert.equal(readAutonomyPolicy(root).mode, 'off');
});

test('eligibility cannot be overridden by priority (PTS-007)', t => {
  const root = fixture(t); intent(root, 'zulu'); intent(root, 'alpha'); const bad = intent(root, 'blocked');
  approve(root, proposal(['product/blocked', 'product/zulu', 'product/alpha']));
  updateWorkItem(root, 'product/blocked', { priority: -100 });
  updateWorkItem(root, 'product/alpha', { priority: 2 });
  updateWorkItem(root, 'product/zulu', { priority: 2 });
  const json = bad.path.replace(/\.md$/, '.json'); const data = JSON.parse(readFileSync(json));
  data.status = 'draft'; writeFileSync(json, JSON.stringify(data));
  const preview = previewAutonomy(root);
  assert.deepEqual(preview.executable.map(item => item.intentId), ['product/alpha', 'product/zulu']);
  assert.ok(codes(preview.blocked.find(item => item.intentId === 'product/blocked')).includes('intent-state-drift'));
  assert.deepEqual(preview.executable.map(item => item.sortKey), [[2, 'product/alpha'], [2, 'product/zulu']]);
  assert.equal(preview.blocked.find(item => item.intentId === 'product/blocked').sortKey[0], -100);
  updateWorkItem(root, 'product/zulu', { priority: 1 });
  assert.deepEqual(previewAutonomy(root).executable.map(item => item.intentId), ['product/zulu', 'product/alpha']);
});

test('grant expiry, configuration drift and runtime rebuild do not expand authority', t => {
  const root = fixture(t); intent(root, 'alpha'); approve(root, proposal(['product/alpha']));
  const original = readAutonomyPolicy(root).grant;
  rmSync(resolve(root, '.ewai-pipeline/data'), { recursive: true });
  rmSync(resolve(root, '.ewai-pipeline/runtime/autonomy'), { recursive: true });
  assert.deepEqual(readAutonomyPolicy(root).grant, original);
  assert.equal(previewAutonomy(root).executable.length, 1);
  const config = resolve(root, 'knowledge/pipeline.yaml'); writeFileSync(config, readFileSync(config, 'utf8') + '\n# changed policy\n');
  assert.ok(codes(previewAutonomy(root).blocked[0]).includes('grant-policy-changed'));
  t.mock.method(Date, 'now', () => Date.parse(original.scope.expiresAt));
  assert.equal(readAutonomyPolicy(root).status, 'expired');
  assert.equal(readAutonomyPolicy(root).mode, 'off');
  assert.ok(codes(previewAutonomy(root).blocked[0]).includes('grant-expired'));
});

test('dependencies and prototype decisions remain exclusions (PTS-007 / PTS-008)', t => {
  const root = fixture(t); intent(root, 'dependency');
  intent(root, 'dependent', 'ready', { relationships: [{ type: 'depends-on', target: 'product/dependency', required_before: 'build', required_state: 'delivered' }] });
  approve(root, proposal(['product/dependent'], { actions: ['afk-build'] }));
  beginDelivery(root, 'dependent', { tool: 'codex', ui: true });
  const file = resolve(root, 'knowledge/6.Build/dependent/delivery-state.json');
  const state = JSON.parse(readFileSync(file));
  for (const phase of [...state.phases, ...state.adjuncts]) phase.status = 'skipped';
  state.currentPhase = 'build'; state.phases.find(phase => phase.id === 'build').status = 'pending';
  writeFileSync(file, JSON.stringify(state));
  const intentPath = resolve(root, 'knowledge/2.Purpose/intents/product/dependent.md');
  updateIntentDeliveryState(root, intentPath, { status: state.intent.status, deliveryStatus: state.status, currentPhase: 'build', deliveryStatePath: 'knowledge/6.Build/dependent/delivery-state.json' });
  assert.ok(codes(previewAutonomy(root).blocked.find(item => item.intentId === 'product/dependent')).includes('intent-dependency-incomplete'));
  state.currentPhase = 'ui-design'; state.adjuncts.find(phase => phase.id === 'ui-design').status = 'running';
  writeFileSync(file, JSON.stringify(state));
  updateIntentDeliveryState(root, intentPath, { currentPhase: 'ui-design' });
  const preview = previewAutonomy(root);
  assert.ok(codes(preview.humanDecisions.find(item => item.intentId === 'product/dependent')).includes('prototype-selection-required'));
  assert.equal(preview.executable.length, 0);
});

test('schema and safe projections exclude supplied authority and sensitive bodies', t => {
  const root = fixture(t), created = intent(root, 'alpha');
  writeFileSync(created.path, readFileSync(created.path, 'utf8') + '\nprivate-prompt-canary\n');
  const schema = JSON.parse(readFileSync(new URL('../config/autonomy.schema.json', import.meta.url)));
  assert.deepEqual(schema.properties.actions.items.enum, ['begin-harness', 'prepare-phase', 'afk-build']);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.limits.additionalProperties, false);
  assert.throws(() => previewAutonomy(root, { projectRoot: '/tmp', proposal: proposal(['product/alpha']) }));
  const preview = previewAutonomy(root, { proposal: proposal(['product/alpha']), record: true });
  assert.equal(JSON.stringify(preview).includes('private-prompt-canary'), false);
  const receipt = readFileSync(previewPath(root, preview.digest), 'utf8');
  assert.equal(receipt.includes('private-prompt-canary'), false);
});

test('human decisions stay separate from executable work (PTS-008)', t => {
  const root = fixture(t); intent(root, 'human');
  approve(root, proposal(['product/human']));
  beginDelivery(root, 'human', { tool: 'codex' });
  const statePath = resolve(root, 'knowledge/6.Build/human/delivery-state.json');
  const state = JSON.parse(readFileSync(statePath));
  for (const phase of [...state.phases, ...state.adjuncts]) phase.status = 'skipped';
  state.currentPhase = 'manual-qa'; state.status = 'paused-awaiting-manual-qa';
  state.humanGates.find(phase => phase.id === 'manual-qa').status = 'running';
  writeFileSync(statePath, JSON.stringify(state));
  updateIntentDeliveryState(root, resolve(root, 'knowledge/2.Purpose/intents/product/human.md'), {
    status: state.intent.status, deliveryStatus: state.status, currentPhase: state.currentPhase,
    deliveryStatePath: 'knowledge/6.Build/human/delivery-state.json',
  });
  const before = inventory(root), preview = previewAutonomy(root);
  assert.equal(preview.executable.length, 0);
  assert.ok(codes(preview.humanDecisions[0]).includes('manual-qa-required'));
  assert.deepEqual(inventory(root), before);
});

test('pending canonical recovery and unsafe storage never become shadow side effects', t => {
  const root = fixture(t); intent(root, 'alpha');
  const pending = resolve(root, '.ewai-pipeline/runtime/intent-transactions'); mkdirSync(pending, { recursive: true });
  writeFileSync(resolve(pending, 'interrupted.json'), JSON.stringify({ schema: 'ewai.intent-transaction/v1', entries: [] }));
  const before = inventory(root);
  assert.throws(() => previewAutonomy(root), { code: 'autonomy-recovery-required' });
  assert.deepEqual(inventory(root), before);
  rmSync(resolve(pending, 'interrupted.json'));
  const outside = resolve(root, 'outside'); mkdirSync(outside);
  mkdirSync(resolve(root, 'knowledge/3.Evidence/autonomy'), { recursive: true });
  symlinkSync(outside, resolve(root, 'knowledge/3.Evidence/autonomy/grants'));
  assert.throws(() => approve(root, proposal(['product/alpha'])));
  assert.deepEqual(readdirSync(outside), []);
});

test('initial CLI shares exact preview and deliberate named approval', t => {
  const root = fixture(t); intent(root, 'alpha');
  const cli = resolve(import.meta.dirname, '../bin/ewai');
  const run = args => JSON.parse(execFileSync(process.execPath, [cli, 'autonomy', ...args, '--project', root, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(run(['status']).mode, 'off');
  const preview = run(['preview', '--intent', 'product/alpha', '--action', 'begin-harness', '--provider', 'codex',
    '--expires-at', new Date(Date.now() + 3600000).toISOString(), '--max-runtime-ms', '60000', '--max-operation-ms', '10000', '--max-attempts', '2', '--record']);
  assert.throws(() => run(['approve', '--expected-digest', preview.digest, '--approved-by', 'Fixture owner']));
  const grant = run(['approve', '--expected-digest', preview.digest, '--approved-by', 'Fixture owner', '--yes']);
  assert.deepEqual(grant.scope.intentIds, ['product/alpha']);
  assert.throws(() => run(['status', '--unexpected', 'canary']));
});

test('AUT-R01 shadow cannot recover a transaction appearing after its initial scan', t => {
  const root = fixture(t); intent(root, 'alpha'); beginDelivery(root, 'alpha', { tool: 'codex' });
  const state = resolve(root, 'knowledge/6.Build/alpha/delivery-state.json');
  const inode = fs.statSync(state).ino;
  const journal = resolve(root, '.ewai-pipeline/runtime/intent-transactions/injected.json');
  const original = fs.readFileSync; let injected = false;
  t.mock.method(fs, 'readFileSync', function(path, ...args) {
    const matches = path === state || typeof path === 'number' && fs.fstatSync(path).ino === inode;
    if (!injected && matches) {
      injected = true; mkdirSync(resolve(root, '.ewai-pipeline/runtime/intent-transactions'), { recursive: true });
      writeFileSync(journal, JSON.stringify({ schema: 'ewai.intent-transaction/v1', entries: [] }));
    }
    return original(path, ...args);
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => previewAutonomy(root), { code: 'autonomy-recovery-required' });
    assert.equal(injected, true); assert.equal(fs.existsSync(journal), true);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('AUT-R02 a newer displayed scope invalidates the previous approval digest', t => {
  const root = fixture(t); intent(root, 'alpha'); intent(root, 'beta');
  const broad = previewAutonomy(root, { proposal: proposal(['product/alpha', 'product/beta']), record: true });
  const narrow = previewAutonomy(root, { proposal: proposal(['product/alpha']), record: true });
  assert.throws(() => approveAutonomyGrant(root, { expectedDigest: broad.digest, approvedBy: 'Owner', confirmed: true }), { code: 'autonomy-preview-stale' });
  assert.equal(readAutonomyPolicy(root).mode, 'off');
  const grant = approveAutonomyGrant(root, { expectedDigest: narrow.digest, approvedBy: 'Owner', confirmed: true });
  assert.deepEqual(grant.scope.intentIds, ['product/alpha']);
});

test('AUT-R03 malformed existing project locator fails closed after preview', t => {
  const root = fixture(t, 'SPECS'); intent(root, 'alpha');
  const preview = previewAutonomy(root, { proposal: proposal(['product/alpha']), record: true });
  const locator = resolve(root, '.ewai-pipeline/project.json');
  writeFileSync(locator, '{private-locator-canary');
  assert.throws(() => approveAutonomyGrant(root, { expectedDigest: preview.digest, approvedBy: 'Owner', confirmed: true }));
  assert.equal(fs.existsSync(resolve(root, 'SPECS/3.Evidence/autonomy/grants')), false);
  assert.throws(() => readAutonomyPolicy(root), error => !error.message.includes('private-locator-canary'));
});

test('AUT-R04 unknown Markdown and sidecar intent schemas cannot receive grants', t => {
  for (const format of ['markdown', 'json']) {
    const root = fixture(t), created = intent(root, 'alpha');
    const file = format === 'markdown' ? created.path : created.path.replace(/\.md$/, '.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace(/ewai.intent(?:-state)?\/v1/, 'unrecognised.intent/v99'));
    assert.throws(() => approve(root, proposal(['product/alpha'])), { code: 'autonomy-intent-invalid' });
    assert.equal(readAutonomyPolicy(root).mode, 'off');
  }
});

test('AUT-R05 unknown phase text cannot enter returned or persisted projections', t => {
  const root = fixture(t); intent(root, 'alpha'); beginDelivery(root, 'alpha', { tool: 'codex' });
  const file = resolve(root, 'knowledge/6.Build/alpha/delivery-state.json');
  const state = JSON.parse(readFileSync(file));
  state.phases.find(phase => phase.status === 'running').id = 'private-prompt-canary';
  writeFileSync(file, JSON.stringify(state));
  const preview = previewAutonomy(root, { record: true });
  assert.equal(JSON.stringify(preview).includes('private-prompt-canary'), false);
  assert.equal(readFileSync(previewPath(root, preview.digest), 'utf8').includes('private-prompt-canary'), false);
  assert.ok(codes(preview.blocked[0]).includes('canonical-phase-invalid'));
});

test('AUT-R06 grant approval detects a live change after snapshot bytes were read', t => {
  const root = fixture(t), created = intent(root, 'alpha');
  const preview = previewAutonomy(root, { proposal: proposal(['product/alpha']), record: true });
  const sidecar = created.path.replace(/\.md$/, '.json'), changed = JSON.parse(readFileSync(sidecar));
  changed.status = 'draft';
  const original = fs.writeFileSync; let copies = 0, injected = false;
  t.mock.method(fs, 'writeFileSync', function(path, ...args) {
    const result = original(path, ...args);
    if (typeof path === 'string' && path !== sidecar && path.endsWith('/knowledge/2.Purpose/intents/product/alpha.json') && ++copies === 2) {
      injected = true; original(sidecar, JSON.stringify(changed));
    }
    return result;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => approveAutonomyGrant(root, { expectedDigest: preview.digest, approvedBy: 'Owner', confirmed: true }), { code: 'autonomy-evidence-changed' });
    assert.equal(injected, true); assert.equal(readAutonomyPolicy(root).mode, 'off');
    assert.equal(JSON.parse(readFileSync(sidecar)).status, 'draft');
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('AUT-R08 canonical shelf-ready and dry-run sentinels retain human decisions', t => {
  for (const sentinel of ['shelf-ready', 'complete-dry-run']) {
    const root = fixture(t), created = intent(root, 'alpha');
    approve(root, proposal(['product/alpha'])); beginDelivery(root, 'alpha', { tool: 'codex' });
    const file = resolve(root, 'knowledge/6.Build/alpha/delivery-state.json'), state = JSON.parse(readFileSync(file));
    for (const phase of [...state.phases, ...state.adjuncts]) phase.status = 'skipped';
    state.phases.find(phase => phase.id === 'build').status = 'pending';
    state.currentPhase = sentinel; state.status = sentinel === 'shelf-ready' ? 'shelf-ready' : 'validated-not-for-build';
    state.mode = sentinel === 'shelf-ready' ? 'shelf' : 'dry-run'; writeFileSync(file, JSON.stringify(state));
    updateIntentDeliveryState(root, created.path, { status: state.intent.status, deliveryStatus: state.status, currentPhase: sentinel, deliveryStatePath: 'knowledge/6.Build/alpha/delivery-state.json' });
    const canonical = deriveExecutionState(root, readRuntimeIntent(root, 'product/alpha'));
    assert.equal(canonical.valid, true); assert.equal(canonical.actions.approveBuild.permitted, true);
    const preview = previewAutonomy(root);
    assert.ok(codes(preview.humanDecisions.find(item => item.intentId === 'product/alpha')).includes('build-approval-required'));
    assert.equal(preview.executable.length, 0);
  }
});

function policyFixture(t, evidence = ['claim']) {
  const root = fixture(t, 'SPECS'); intent(root, 'alpha'); beginDelivery(root, 'alpha', { tool: 'codex', existingCode: false, ui: false });
  const packsRoot = resolve(root, 'fixture-packs'), packRoot = resolve(packsRoot, 'org-fixture-delivery');
  mkdirSync(resolve(packRoot, 'policies'), { recursive: true });
  writeFileSync(resolve(packRoot, 'pack.yaml'), YAML.stringify({
    schema: 'ewai.pack/v1', id: 'org.fixture.delivery', name: 'Fixture Delivery', description: 'Governed fixture.', version: '1.0.0', type: 'organisation', requires: [],
    blueprint: { publisher: { id: 'fixture', name: 'Fixture owner' }, compatibility: { ewai: '0.x' }, modules: [{
      id: 'policy', name: 'Policy', description: 'Delivery policy.', required: true,
      standards: [], personas: [], design_systems: [], starter_packs: [], boilerplates: [],
      policies: [{ id: 'delivery-policy', title: 'Delivery policy', source: 'policies/delivery-policy.yaml' }],
    }] },
  }));
  writeFileSync(resolve(packRoot, 'policies/delivery-policy.yaml'), YAML.stringify({
    schema: 'ewai.organisation-policy/v1', id: 'delivery-policy', title: 'Delivery policy', version: '1.0.0',
    publisher: { id: 'fixture', name: 'Fixture owner' },
    provenance: { kind: 'owner-declared', summary: 'Approved fixture.', sources: [{ id: 'board', label: 'Fixture board' }] },
    review_roles: [], unmatched_outcome: 'unassessed', rules: [{
      id: 'production-control', title: 'Production control', description: 'A traceable claim is required.',
      when: { environment: ['production'] }, outcome: 'allow-with-controls',
      controls: evidence.map(route => ({ id: `audit-${route}`, title: 'Audit control', description: 'Trace the accepted control.', evidence: [route] })), exceptions: { permitted: false },
    }],
  }));
  const resolved = resolveOrganisationPolicy(resolveOrganisationBlueprint('org.fixture.delivery', listOrganisationBlueprints({ roots: [{ path: packsRoot, sourceClass: 'project' }] })));
  materialisePolicyBaseline(root, resolved, { confirmed: true, approvedBy: 'Fixture owner', expectedDigest: resolved.effectiveDigest });
  const factsProposal = preparePolicyFacts(root, {
    intent: { reference: 'product/alpha', revision: 1, digest: 'sha256:' + createHash('sha256').update('product/alpha:1').digest('hex') },
    facts: [{ id: 'environment-1', dimension: 'environment', values: ['production'], rationale: 'Confirmed fixture target.',
      source: { kind: 'observed', reference: 'SPECS/2.Purpose/intents/product/alpha.md' } }],
  });
  const facts = confirmPolicyFacts(root, { intentReference: 'product/alpha', expectedRevision: factsProposal.revision, expectedProposalDigest: factsProposal.proposalDigest,
    confirmed: true, authority: 'human', confirmedBy: 'Fixture owner', decisions: factsProposal.facts.map(({ id }) => ({ factId: id, disposition: 'confirmed' })) });
  evaluatePolicyDesign(root, { intentReference: 'product/alpha', expectedIntentRevision: 1, expectedPolicyDigest: resolved.effectiveDigest, expectedFactsDigest: facts.factsDigest });
  return root;
}

function recordFixtureGate(root, phase) {
  const deliveryRoot = resolve(root, 'SPECS/6.Build/alpha');
  const ensure = (path, text) => { if (!fs.existsSync(path)) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); } };
  for (const path of requiredPhaseArtefacts(deliveryRoot, phase)) ensure(resolve(deliveryRoot, path), path.endsWith('.json') ? '{"status":"pass"}\n' : '# Fixture artefact\n');
  const gates = phaseGateTemplate(root, 'alpha', phase).required_gates.map(({ id }) => {
    const path = id === 'organisation-policy-design' ? `gates/${phase}/organisation-policy-design.json` : `gates/${phase}/${id}.md`;
    ensure(resolve(deliveryRoot, path), `# ${id}\n`);
    return { id, commandOrSkill: `fixture:${id}`, outputPath: `SPECS/6.Build/alpha/${path}`, exitStatus: 0, status: 'pass' };
  });
  recordPhaseGate(root, 'alpha', phase, { status: 'pass', requiredGates: gates,
    honestyCheck: { sourceSectionsEdited: true, staleTextRemoved: true, noAppendOnlyCorrections: true, allCodeClaimsCited: true } });
}

test('AUT-R07 shadow preserves genuinely current completed organisation-policy evidence', t => {
  const root = policyFixture(t);
  assert.equal(evaluatePolicyGate(root, 'alpha', 'intent').blocking, false);
  recordFixtureGate(root, 'intent');
  completeDeliveryPhase(root, 'alpha', 'intent');
  const canonical = deriveExecutionState(root, readRuntimeIntent(root, 'product/alpha'));
  assert.equal(canonical.valid, true); assert.deepEqual(canonical.blockers, []); assert.equal(canonical.lifecycle.nextPhase, 'plan');
  assert.equal(readPolicyEvidenceFreshness(root, 'product/alpha', { phase: 'intent' }).status, 'current');
  // Canonical fixture setup can leave failed migration connections for GC.
  // Keep an explicit reader open so their later disposal cannot checkpoint the
  // WAL during this byte-for-byte check. No transaction or write lock is held.
  const database = new DatabaseSync(resolve(root, '.ewai-pipeline/data/pipeline.sqlite'), { readOnly: true });
  try {
    database.prepare('SELECT COUNT(*) FROM sqlite_master').get();
    const before = inventory(root);
    const preview = previewAutonomy(root, { proposal: proposal(['product/alpha'], { actions: ['prepare-phase'] }) });
    const candidate = preview.blocked.find(item => item.intentId === 'product/alpha');
    assert.equal(codes(candidate).includes('completed-evidence-stale'), false);
    assert.equal(candidate.action, 'prepare-phase');
    assert.ok(codes(candidate).includes('restricted-phase-contract-unavailable'));
    assert.deepEqual(inventory(root), before);
  } finally { database.close(); }
});

// A persisted-history fixture isolates snapshot equivalence from operational
// projection. Real policy evaluation and deterministic gate validation are used;
// the fixture is not evidence that this test completed a real project Plan.
function completedPolicyPlan(t) {
  const routes = ['automated-test', 'named-human', 'specialist-review'];
  const root = policyFixture(t, routes), deliveryRoot = resolve(root, 'SPECS/6.Build/alpha');
  const write = (path, value) => { const target = resolve(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value)); };
  const references = ['tests/control.test.mjs', 'reviews/owner.md', 'assurance/specialist.md'];
  references.forEach(path => write(path, '# Accepted fixture control evidence\n'));
  const source = { claim_ledger: 'gates/plan/claim-ledger.json', plan_contract: 'gates/plan/plan-contract.json', destination: 'destination.md' };
  const task = { id: 'T-001', slice: 'S1', name: 'Fixture implementation', issue_kind: 'feature', priority: 1, parallel_wave: 1, classification: 'AFK',
    repo: Object.keys(YAML.parse(readFileSync(resolve(root, 'SPECS/pipeline.yaml'), 'utf8')).repositories)[0], branch: 'feature/fixture-task', depends_on: [], claims: ['C1'],
    user_visible_outcome: 'Fixture control', read_set: ['SPECS/pipeline.yaml'], write_set: ['tests/control.test.mjs'], central_writes_allowed: false,
    module_interface_contract: { module: 'fixture', interface: ['control'], behaviour_owned: ['control'], caller_contract: ['bounded'], test_boundary: 'unit' },
    first_failing_test: 'fixture control', red_green_refactor: { red_command: 'node --test', green_command: 'node --test', expected_red_failure: 'control', refactor_boundary: 'fixture' },
    allowed_commands: ['node --test'], stop_conditions: ['failure'], completion_evidence: ['tests pass'],
    ralph_loop: { allowed: false, max_iterations: 0, completion_promise: 'fixture' },
    review: { fresh_context_required: true, review_tests_first: true, standards_pushed: ['SPECS/pipeline.yaml'] },
    merge: { orchestrator_owned: true, post_merge_checks: ['node --test'] }, report_path: 'tasks/T-001/report.md', evidence_path: 'tasks/T-001/evidence.json' };
  write('SPECS/6.Build/alpha/task-graph.json', { schema_version: 1, slug: 'alpha', status: 'final', parent_branch: 'feature/fixture', source,
    parallelism: { allowed: false, max_parallel_tasks: 1, rationale: 'Fixture' },
    afk_waves: [{ wave: 1, ready_tasks: ['T-001'], parallel_tasks: [], merge_order: ['T-001'], rationale: 'Fixture' }], tasks: [task] });
  write('SPECS/6.Build/alpha/gates/plan/claim-ledger.json', { implementation_claims: [{ id: 'C1', type: 'implementation' }], slices: [{ id: 'S1' }] });
  write('SPECS/6.Build/alpha/gates/plan/plan-contract.json', { vertical_slices: [{ id: 'S1' }] });
  write('SPECS/6.Build/alpha/destination.md', '# Fixture destination\n');
  assert.equal(evaluatePolicyGate(root, 'alpha', 'intent').blocking, false);
  assert.equal(evaluatePolicyGate(root, 'alpha', 'plan', { controlTraces: routes.map((route, i) => ({
    ruleId: 'delivery-policy:production-control', controlId: `audit-${route}`, route, reference: references[i],
    ...(route === 'automated-test' ? {} : { owner: 'Fixture owner' }),
  })) }).blocking, false);
  for (const phase of ['intent', 'plan']) recordFixtureGate(root, phase);
  const statePath = resolve(deliveryRoot, 'delivery-state.json'), state = JSON.parse(readFileSync(statePath));
  for (const phase of state.phases.filter(phase => ['intent', 'plan'].includes(phase.id))) {
    phase.status = 'completed'; phase.completedAt = new Date().toISOString();
    phase.gateSha256 = createHash('sha256').update(readFileSync(resolve(deliveryRoot, 'gates', phase.id, 'gate-ledger.json'))).digest('hex');
  }
  state.currentPhase = 'pattern-validation'; state.intent.status = 'in-progress';
  writeFileSync(statePath, JSON.stringify(state));
  updateIntentDeliveryState(root, resolve(root, 'SPECS/2.Purpose/intents/product/alpha.md'), { status: 'in-progress', currentPhase: 'pattern-validation' });
  assert.equal(readPolicyEvidenceFreshness(root, 'product/alpha', { phase: 'plan' }).status, 'current');
  const canonical = deriveExecutionState(root, readRuntimeIntent(root, 'product/alpha'));
  assert.equal(canonical.valid, true, JSON.stringify(canonical.blockers));
  assert.equal(canonical.lifecycle.nextPhase, 'pattern-validation');
  return { root, references };
}

test('AUT-R09 shadow retains exact external Plan control-trace evidence without live writes (PTS-002 / PTS-007)', t => {
  const { root, references } = completedPolicyPlan(t), before = inventory(root);
  const input = { proposal: proposal(['product/alpha']) };
  const candidate = previewAutonomy(root, input).blocked.find(item => item.intentId === 'product/alpha');
  assert.equal(codes(candidate).includes('completed-evidence-stale'), false);
  assert.equal(candidate.action, 'prepare-phase');
  assert.deepEqual(inventory(root), before);
  for (const reference of references) {
    const path = resolve(root, reference), saved = readFileSync(path);
    writeFileSync(path, 'changed');
    assert.ok(codes(previewAutonomy(root, input).blocked[0]).includes('completed-evidence-stale'));
    rmSync(path);
    assert.ok(codes(previewAutonomy(root, input).blocked[0]).includes('completed-evidence-stale'));
    symlinkSync(resolve(root, 'SPECS/pipeline.yaml'), path);
    assert.throws(() => previewAutonomy(root, input), { code: 'autonomy-unsafe-path' });
    rmSync(path); writeFileSync(path, saved);
  }
  assert.deepEqual(inventory(root), before);
});
