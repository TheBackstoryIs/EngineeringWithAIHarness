import test from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, existsSync, renameSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, relative, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { initProject } from '../src/project.mjs';
import { createIntent, updateIntentDeliveryState } from '../src/intents.mjs';
import { beginDelivery, startDeliveryPhase, completeDeliveryPhase, phaseGateTemplate, recordPhaseGate, recordExternalValidationCycle,
  resumeShelvedDelivery, ratifyDeliveryAmendments, ratifyCompletedEvidenceAmendment, recordBuildApproval, recordManualQaApproval } from '../src/delivery.mjs';
import { startActiveSession, setPhase, updateWorkItem } from '../src/runtime/work.mjs';
import { deliveryPaths } from '../src/delivery-documents.mjs';
import { recordPhaseGateAtPaths } from '../src/delivery-gates.mjs';
import { previewAutonomy, approveAutonomyGrant } from '../src/autonomy.mjs';
import { readLifecycleHookWorkspace } from '../src/runtime/lifecycle-hooks.mjs';

const ownership = () => import('../src/runtime/intent-ownership.mjs');
const deliveryUrl = new URL('../src/delivery.mjs', import.meta.url).href;
const ownershipUrl = new URL('../src/runtime/intent-ownership.mjs', import.meta.url).href;
const operations = () => import('../src/runtime/autonomy-operations.mjs');
const digest = value => 'sha256:' + createHash('sha256').update(value).digest('hex');

function fixtureGrant(root) {
  const proposal = { intentIds: ['product/alpha'], actions: ['begin-harness', 'prepare-phase'], providers: ['codex'],
    expiresAt: new Date(Date.now() + 60000).toISOString(), limits: { maxConcurrentIntents: 1, maxRuntimeMs: 60000, maxOperationMs: 30000, maxAttempts: 2 } };
  const preview = previewAutonomy(root, { proposal, record: true });
  return approveAutonomyGrant(root, { expectedDigest: preview.digest, approvedBy: 'Fixture owner', confirmed: true });
}

function fixture(t) {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'ewai-autonomy-operations-')));
  initProject(root, { name: 'Fenced consumer', specsRoot: 'knowledge' });
  const intent = createIntent(root, { domain: 'product', slug: 'alpha' });
  updateIntentDeliveryState(root, intent.path, { status: 'ready' });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('a stale intent owner cannot persist a canonical transition (PTS-009 / PTS-010)', t => {
  const root = fixture(t);
  const stale = { intentId: 'product/alpha', epoch: randomUUID(), generation: 1,
    ownerId: 'stale-worker', token: randomUUID() };
  assert.throws(() => beginDelivery(root, 'alpha', { tool: 'codex', ownership: stale }),
    error => error.code === 'intent-ownership-stale');
  assert.equal(existsSync(resolve(root, 'knowledge/6.Build/alpha/delivery-state.json')), false);
  assert.equal(existsSync(resolve(root, 'knowledge/6.Build/alpha/runs')), false);
});

test('expired ownership cannot renew or commit after a new generation wins (PTS-009)', async t => {
  const root = fixture(t);
  const { acquireIntentOwnership, renewIntentOwnership, assertIntentOwnership, releaseIntentOwnership } = await ownership();
  const old = acquireIntentOwnership(root, 'product/alpha', { ownerId: 'first-worker', durationMs: 1000 });
  const database = new DatabaseSync(resolve(root, '.ewai-pipeline/data/pipeline.sqlite'));
  try { database.prepare('UPDATE intent_ownership SET expires_at = 0 WHERE intent_id = ?').run('product/alpha'); }
  finally { database.close(); }
  const current = acquireIntentOwnership(root, 'product/alpha', { ownerId: 'second-worker' });
  assert.equal(current.epoch, old.epoch); assert.equal(current.generation, old.generation + 1);
  assert.throws(() => renewIntentOwnership(root, old), error => error.code === 'intent-ownership-stale');
  assert.throws(() => beginDelivery(root, 'alpha', { tool: 'codex', ownership: old }), error => error.code === 'intent-ownership-stale');
  assert.throws(() => releaseIntentOwnership(root, old), error => error.code === 'intent-ownership-stale');
  assert.equal(assertIntentOwnership(root, current).generation, current.generation);
  assert.equal(existsSync(resolve(root, 'knowledge/6.Build/alpha')), false);
  releaseIntentOwnership(root, current);
});

test('rebuilt coordination invalidates stale generations without erasing durable evidence (PTS-010)', async t => {
  const root = fixture(t);
  const { acquireIntentOwnership, assertIntentOwnership, renewIntentOwnership, releaseIntentOwnership } = await ownership();
  const old = acquireIntentOwnership(root, 'product/alpha', { ownerId: 'before-rebuild' });
  const databasePath = resolve(root, '.ewai-pipeline/data/pipeline.sqlite');
  renameSync(databasePath, `${databasePath}.retired-fixture`);
  const current = acquireIntentOwnership(root, 'product/alpha', { ownerId: 'after-rebuild' });
  assert.notEqual(current.epoch, old.epoch);
  assert.throws(() => assertIntentOwnership(root, old), error => error.code === 'intent-ownership-stale');
  assert.throws(() => renewIntentOwnership(root, old), error => error.code === 'intent-ownership-stale');
  assert.throws(() => beginDelivery(root, 'alpha', { ownership: old }), error => error.code === 'intent-ownership-stale');
  assert.equal(existsSync(resolve(root, 'knowledge/2.Purpose/intents/product/alpha.md')), true);
  assert.equal(existsSync(resolve(root, 'knowledge/6.Build/alpha')), false);
  releaseIntentOwnership(root, current);
});

test('existing interactive ownership is checked before begin writes or publishes hooks (PTS-009)', t => {
  const root = fixture(t);
  startActiveSession(root, 'product/alpha', { ownerId: 'interactive-owner', tool: 'codex', phaseKey: 'intent' });
  const before = readLifecycleHookWorkspace(root).events.map(event => event.id);
  assert.throws(() => beginDelivery(root, 'alpha', { tool: 'codex' }), /owned|ownership/i);
  assert.equal(existsSync(resolve(root, 'knowledge/6.Build/alpha')), false);
  assert.deepEqual(readLifecycleHookWorkspace(root).events.map(event => event.id), before);
});

test('every participating completion approval gate and projection mutation rejects stale ownership (PTS-009 / PTS-010)', t => {
  const root = fixture(t); beginDelivery(root, 'alpha', { tool: 'codex' });
  const stale = { intentId: 'product/alpha', epoch: randomUUID(), generation: 1, ownerId: 'expired-worker', token: randomUUID() };
  const statePath = resolve(root, 'knowledge/6.Build/alpha/delivery-state.json'), before = readFileSync(statePath);
  const calls = [
    () => startDeliveryPhase(root, 'alpha', 'intent', { ownership: stale }),
    () => completeDeliveryPhase(root, 'alpha', 'intent', { ownership: stale }),
    () => recordPhaseGate(root, 'alpha', 'intent', { ownership: stale }),
    () => recordPhaseGateAtPaths(deliveryPaths(root, 'alpha'), 'alpha', 'intent', { ownership: stale }),
    () => recordExternalValidationCycle(root, 'alpha', 'intent', { ownership: stale }),
    () => recordBuildApproval(root, 'alpha', { ownership: stale }),
    () => recordManualQaApproval(root, 'alpha', { ownership: stale }),
    () => resumeShelvedDelivery(root, 'alpha', { ownership: stale }),
    () => ratifyDeliveryAmendments(root, 'alpha', { ownership: stale }),
    () => ratifyCompletedEvidenceAmendment(root, 'alpha', { ownership: stale }),
    () => setPhase(root, 'product/alpha', 'intent', { ownership: stale, status: 'completed' }),
    () => updateWorkItem(root, 'product/alpha', { ownership: stale, currentPhase: 'build' }),
  ];
  calls.forEach((call, index) => assert.throws(call, error => error.code === 'intent-ownership-stale', `mutation boundary ${index}`));
  assert.deepEqual(readFileSync(statePath), before);
  assert.equal(existsSync(resolve(root, 'knowledge/6.Build/alpha/gates/intent/gate-ledger.json')), false);
});

test('two supervisors and a manual caller race safely using three real processes (PTS-009)', async t => {
  const root = fixture(t), barrier = resolve(root, 'race-ready');
  const code = `
    import { existsSync, writeFileSync } from 'node:fs';
    import { beginDelivery } from ${JSON.stringify(deliveryUrl)};
    import { acquireIntentOwnership, releaseIntentOwnership } from ${JSON.stringify(ownershipUrl)};
    const [root, barrier, role] = process.argv.slice(1);
    writeFileSync(barrier + '.' + role, 'ready');
    while (!existsSync(barrier)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    let fence;
    try {
      if (role !== 'manual') fence = acquireIntentOwnership(root, 'product/alpha', {ownerId: role});
      const result = beginDelivery(root, 'alpha', {tool: 'codex', ...(fence ? {ownership: fence} : {})});
      console.log(JSON.stringify({status: 'completed', run: result.run.id}));
    } catch(error) { console.log(JSON.stringify({status: 'conflict', code: error.code})); }
    finally { if (fence) { try { releaseIntentOwnership(root, fence); } catch {} } }
  `;
  const children = ['supervisor-one', 'supervisor-two', 'manual'].map(role => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, root, barrier, role], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { errors += data; });
    const done = new Promise((resolveResult, reject) => { child.once('error', reject); child.once('exit', code => {
      try { assert.equal(code, 0, errors); resolveResult(JSON.parse(output.trim())); } catch (error) { reject(error); }
    }); });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); });
    return { child, role, done };
  });
  const deadline = Date.now() + 10000;
  while (children.some(({ role }) => !existsSync(`${barrier}.${role}`))) {
    assert.ok(Date.now() < deadline, 'all three children reached the barrier');
    await new Promise(resolveWait => setTimeout(resolveWait, 10));
  }
  writeFileSync(barrier, 'go');
  const results = await Promise.all(children.map(({ done }) => done));
  assert.equal(results.filter(result => result.status === 'completed').length, 1, JSON.stringify(results));
  for (const result of results.filter(result => result.status === 'conflict')) {
    assert.ok(['intent-ownership-conflict', 'intent-mutation-conflict', 'intent-transition-conflict'].includes(result.code), JSON.stringify(result));
  }
  assert.equal(readdirSync(resolve(root, 'knowledge/6.Build/alpha/runs')).filter(name => name.endsWith('.json')).length, 1);
  assert.equal(readLifecycleHookWorkspace(root).events.filter(event => event.name === 'ewai.delivery.phase.entered').length, 1);
});

for (const boundary of ['start', 'complete']) {
  test(`two supervisors and a manual caller race safely at canonical ${boundary} (PTS-009)`, async t => {
    const root = fixture(t), barrier = resolve(root, 'phase-race-ready');
    beginDelivery(root, 'alpha', { tool: 'codex' });
    if (boundary === 'complete') {
      const build = resolve(root, 'knowledge/6.Build/alpha'), gateRoot = resolve(build, 'gates/intent');
      fs.mkdirSync(gateRoot, { recursive: true });
      writeFileSync(resolve(build, 'intent-summary.md'), '# Intent summary\n\nRace fixture.\n');
      for (const [name, value] of Object.entries({
        'intent-dependency-map.json': { schema_version: 1, slug: 'alpha', status: 'final', dependencies: [] },
        'intent-dependency-map-check.json': { status: 'pass' },
        'intent-code-disagreements.json': { status: 'pass', disagreements: [] },
      })) writeFileSync(resolve(gateRoot, name), JSON.stringify(value));
      writeFileSync(resolve(gateRoot, 'intent-dependency-map-check.md'), '# Dependency map\n\nPass.\n');
      const requiredGates = phaseGateTemplate(root, 'alpha', 'intent').required_gates.map(gate => {
        const path = resolve(build, `evidence/intent-${gate.id}.md`);
        fs.mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `# ${gate.id}\n\nFixture evidence.\n`);
        return { id: gate.id, commandOrSkill: `fixture:${gate.id}`, outputPath: relative(root, path), exitStatus: 0, status: 'pass' };
      });
      recordPhaseGate(root, 'alpha', 'intent', { status: 'pass', requiredGates,
        honestyCheck: { sourceSectionsEdited: true, staleTextRemoved: true, noAppendOnlyCorrections: true, allCodeClaimsCited: true } });
    }
    const { readIntentMutationSnapshot } = await operations();
    const predecessor = readIntentMutationSnapshot(root, 'product/alpha').digest;
    const code = `
      import { existsSync, writeFileSync } from 'node:fs'; import { randomUUID } from 'node:crypto';
      import { startDeliveryPhase, completeDeliveryPhase } from ${JSON.stringify(deliveryUrl)};
      import { withIntentMutation, acquireIntentOwnership, releaseIntentOwnership } from ${JSON.stringify(ownershipUrl)};
      const [root, barrier, role, boundary, predecessor] = process.argv.slice(1);
      writeFileSync(barrier + '.' + role, 'ready');
      while (!existsSync(barrier)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      let fence;
      try {
        if (role !== 'manual') fence = acquireIntentOwnership(root, 'product/alpha', { ownerId: role });
        const result = withIntentMutation(root, 'product/alpha', { id: randomUUID(), action: boundary + '-phase', phase: 'intent',
          expectedPredecessor: predecessor, ...(fence ? { ownership: fence } : {}) }, () =>
          boundary === 'start' ? startDeliveryPhase(root, 'alpha', 'intent') : completeDeliveryPhase(root, 'alpha', 'intent'));
        console.log(JSON.stringify({ status: result.status }));
      } catch(error) { console.log(JSON.stringify({ status: 'conflict', code: error.code })); }
      finally { if (fence) { try { releaseIntentOwnership(root, fence); } catch {} } }
    `;
    const roles = ['supervisor-one', 'supervisor-two', 'manual'];
    const children = roles.map(role => childExecution(t, code, [root, barrier, role, boundary, predecessor]));
    const deadline = Date.now() + 15000;
    while (roles.some(role => !existsSync(`${barrier}.${role}`))) {
      assert.ok(Date.now() < deadline, 'three phase callers reached the barrier');
      await new Promise(resolveWait => setTimeout(resolveWait, 10));
    }
    writeFileSync(barrier, 'go');
    const results = await Promise.all(children.map(async ({ done }) => {
      const result = await done; assert.equal(result.code, 0, result.errors); return JSON.parse(result.output.trim());
    }));
    assert.equal(results.filter(result => result.status === 'completed').length, 1, JSON.stringify(results));
    for (const result of results.filter(result => result.status === 'conflict')) {
      assert.ok(['intent-ownership-conflict', 'intent-mutation-conflict', 'autonomy-predecessor-stale'].includes(result.code), JSON.stringify(result));
    }
    const events = readLifecycleHookWorkspace(root).events;
    assert.equal(events.filter(event => event.name === `ewai.delivery.phase.${boundary === 'start' ? 'entered' : 'completed'}`).length, 1);
    assert.equal(readdirSync(resolve(root, 'knowledge/6.Build/alpha/runs')).length, 1);
  });
}

test('verified receipt prevents duplicate work after a lost response (PTS-011)', async t => {
  const root = fixture(t), { withIntentMutation } = await ownership();
  const operation = { id: randomUUID(), action: 'begin-harness', inputDigest: digest('accepted input'), maxAttempts: 2 };
  let calls = 0;
  const execute = () => { calls += 1; return beginDelivery(root, 'alpha', { tool: 'codex' }); };
  withIntentMutation(root, 'product/alpha', operation, execute);
  const replay = withIntentMutation(root, 'product/alpha', operation, execute);
  assert.equal(calls, 1); assert.equal(replay.status, 'completed'); assert.equal(replay.replayed, true);
  const { reconcileAutonomyOperation } = await operations();
  const recovered = reconcileAutonomyOperation(root, operation.id);
  assert.equal(recovered.status, 'completed'); assert.equal(recovered.receipt.operationId, operation.id);
  assert.equal(recovered.receipt.inputDigest, operation.inputDigest);
  assert.equal(recovered.receipt.attempt, 1);
  assert.equal(readdirSync(resolve(root, 'knowledge/6.Build/alpha/runs')).length, 1);
});

test('receipt reuse requires identical input and still-matching canonical evidence (PTS-011 / PTS-013)', async t => {
  const root = fixture(t), { withIntentMutation } = await ownership();
  const operation = { id: randomUUID(), action: 'begin-harness', inputDigest: digest('approved scope') };
  withIntentMutation(root, 'product/alpha', operation, () => beginDelivery(root, 'alpha', { tool: 'codex' }));
  assert.throws(() => withIntentMutation(root, 'product/alpha', { ...operation, inputDigest: digest('expanded scope') }, () => assert.fail('must not execute')),
    error => error.code === 'autonomy-operation-conflict');
  const statePath = resolve(root, 'knowledge/6.Build/alpha/delivery-state.json');
  const state = JSON.parse(readFileSync(statePath)); state.status = 'tampered-fixture'; writeFileSync(statePath, JSON.stringify(state));
  const { reconcileAutonomyOperation } = await operations();
  const recovered = reconcileAutonomyOperation(root, operation.id);
  assert.equal(recovered.status, 'recovery-required'); assert.equal(recovered.requiresHuman, true);
  assert.throws(() => withIntentMutation(root, 'product/alpha', operation, () => assert.fail('must not repeat')),
    error => error.code === 'autonomy-recovery-required');
});

test('only verified non-completion permits bounded retry and exhaustion stops it (PTS-012)', async t => {
  const root = fixture(t), { withIntentMutation } = await ownership();
  const operation = { id: randomUUID(), action: 'begin-harness', inputDigest: digest('retry input'), maxAttempts: 2 };
  let calls = 0;
  const stopBeforeWrites = () => { calls += 1; throw new Error('fixture stop before canonical writes'); };
  assert.throws(() => withIntentMutation(root, 'product/alpha', operation, stopBeforeWrites));
  const { reconcileAutonomyOperation } = await operations();
  assert.equal(reconcileAutonomyOperation(root, operation.id).status, 'retryable');
  assert.throws(() => withIntentMutation(root, 'product/alpha', operation, stopBeforeWrites));
  const exhausted = reconcileAutonomyOperation(root, operation.id);
  assert.equal(exhausted.status, 'recovery-required'); assert.equal(exhausted.requiresHuman, true);
  assert.ok(exhausted.reasons.includes('attempts-exhausted'));
  assert.throws(() => withIntentMutation(root, 'product/alpha', operation, stopBeforeWrites), error => error.code === 'autonomy-recovery-required');
  assert.equal(calls, 2);
});

test('partial canonical writes remain recovery-required without automatic rollback or retry (PTS-013)', async t => {
  const root = fixture(t), { withIntentMutation } = await ownership();
  const operation = { id: randomUUID(), action: 'begin-harness', inputDigest: digest('partial input'), maxAttempts: 2 };
  assert.throws(() => withIntentMutation(root, 'product/alpha', operation, () => {
    beginDelivery(root, 'alpha', { tool: 'codex' }); throw new Error('lost outcome after canonical publication');
  }));
  const { reconcileAutonomyOperation } = await operations();
  const recovered = reconcileAutonomyOperation(root, operation.id);
  assert.equal(recovered.status, 'recovery-required'); assert.ok(recovered.reasons.includes('canonical-predecessor-changed'));
  assert.equal(existsSync(resolve(root, 'knowledge/6.Build/alpha/delivery-state.json')), true);
  assert.throws(() => withIntentMutation(root, 'product/alpha', operation, () => assert.fail('must not repeat')),
    error => error.code === 'autonomy-recovery-required');
});

function childExecution(t, code, args) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', code, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { errors += data; });
  const done = new Promise(resolveResult => {
    child.once('error', error => resolveResult({ error }));
    child.once('exit', (code, signal) => resolveResult({ code, signal, output, errors }));
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); });
  return { child, done };
}

for (const window of ['before-journal', 'after-journal', 'after-file-publication', 'after-projection', 'after-receipt']) {
  test(`actual process exit ${window} preserves an evidence-led recovery outcome (PTS-011 / PTS-012 / PTS-013)`, async t => {
    const root = fixture(t), operation = { id: randomUUID(), action: 'begin-harness', inputDigest: digest(window), maxAttempts: 2 };
    const code = `
      import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
      import { beginDelivery } from ${JSON.stringify(deliveryUrl)};
      import { withIntentMutation } from ${JSON.stringify(ownershipUrl)};
      const [root, encoded, window] = process.argv.slice(1), operation = JSON.parse(encoded);
      const originalOpen = fs.openSync, originalRename = fs.renameSync;
      fs.openSync = function(path, ...args) {
        if (window === 'before-journal' && String(path).endsWith('/attempts/1.json')) process.exit(77);
        return originalOpen.call(this, path, ...args);
      };
      fs.renameSync = function(from, to) {
        const result = originalRename.call(this, from, to);
        if (window === 'after-file-publication' && String(to).endsWith('/delivery-state.json')) process.exit(77);
        return result;
      };
      syncBuiltinESMExports();
      withIntentMutation(root, 'product/alpha', operation, () => {
        if (window === 'after-journal') process.exit(77);
        const result = beginDelivery(root, 'alpha', {tool: 'codex'});
        if (window === 'after-projection') process.exit(77);
        return result;
      });
      process.exit(77);
    `;
    const result = await childExecution(t, code, [root, JSON.stringify(operation), window]).done;
    assert.equal(result.code, 77, result.errors);
    const { reconcileAutonomyOperation } = await operations(), { withIntentMutation } = await ownership();
    const recovered = reconcileAutonomyOperation(root, operation.id);
    if (window === 'before-journal') {
      assert.equal(recovered.status, 'not-found'); assert.equal(recovered.requiresHuman, true);
      assert.equal(existsSync(resolve(root, 'knowledge/6.Build/alpha')), false);
      assert.throws(() => withIntentMutation(root, 'product/alpha', operation, () => assert.fail('unrecorded outcome must not retry')),
        error => ['intent-ownership-conflict', 'intent-mutation-conflict'].includes(error.code));
    } else if (window === 'after-journal') {
      assert.equal(recovered.status, 'retryable');
      const retried = withIntentMutation(root, 'product/alpha', operation, () => beginDelivery(root, 'alpha', { tool: 'codex' }));
      assert.equal(retried.status, 'completed'); assert.equal(retried.receipt.attempt, 2);
    } else if (window === 'after-receipt') {
      assert.equal(recovered.status, 'completed');
      const replayed = withIntentMutation(root, 'product/alpha', operation, () => assert.fail('must not repeat completed effects'));
      assert.equal(replayed.replayed, true);
      assert.equal(readLifecycleHookWorkspace(root).events.filter(event => event.name === 'ewai.delivery.phase.entered').length, 1);
    } else {
      assert.equal(recovered.status, 'recovery-required'); assert.equal(recovered.requiresHuman, true);
      assert.throws(() => withIntentMutation(root, 'product/alpha', operation, () => assert.fail('must not repeat uncertain effects')),
        error => error.code === 'autonomy-recovery-required');
    }
  });
}

test('a still-running process is not inferred stopped from an unchanged predecessor (PTS-012 / PTS-013)', async t => {
  const root = fixture(t), checkpoint = resolve(root, 'worker-checkpoint'), release = resolve(root, 'worker-release');
  const operation = { id: randomUUID(), action: 'begin-harness', inputDigest: digest('live worker'), maxAttempts: 2 };
  const code = `
    import {existsSync,writeFileSync} from 'node:fs';
    import {withIntentMutation} from ${JSON.stringify(ownershipUrl)};
    const [root,encoded,checkpoint,release]=process.argv.slice(1);
    try { withIntentMutation(root,'product/alpha',JSON.parse(encoded),()=>{
      writeFileSync(checkpoint,'ready');
      while(!existsSync(release)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
      throw new Error('fixture stopped before canonical work');
    }); } catch {}
  `;
  const running = childExecution(t, code, [root, JSON.stringify(operation), checkpoint, release]), deadline = Date.now() + 10000;
  while (!existsSync(checkpoint)) {
    assert.ok(Date.now() < deadline && running.child.exitCode === null, 'worker reached journal checkpoint');
    await new Promise(resolveWait => setTimeout(resolveWait, 10));
  }
  const { reconcileAutonomyOperation } = await operations();
  const unresolved = reconcileAutonomyOperation(root, operation.id);
  assert.equal(unresolved.status, 'recovery-required'); assert.ok(unresolved.reasons.includes('execution-not-confirmed-stopped'));
  writeFileSync(release, 'stop'); assert.equal((await running.done).code, 0);
  assert.equal(reconcileAutonomyOperation(root, operation.id).status, 'retryable');
});

test('durable receipts survive disposable SQLite rebuild without leaking inputs or capabilities (PTS-010 / PTS-011)', async t => {
  const root = fixture(t), { withIntentMutation, acquireIntentOwnership, releaseIntentOwnership } = await ownership();
  const handle = acquireIntentOwnership(root, 'product/alpha', { ownerId: 'receipt-worker' });
  const operation = { id: randomUUID(), action: 'begin-harness', input: { source: 'PRIVATE-SOURCE-CANARY', credential: 'SECRET-CANARY' }, ownership: handle };
  withIntentMutation(root, 'product/alpha', operation, () => beginDelivery(root, 'alpha', { tool: 'codex' }));
  releaseIntentOwnership(root, handle);
  const databasePath = resolve(root, '.ewai-pipeline/data/pipeline.sqlite'); renameSync(databasePath, `${databasePath}.retired-fixture`);
  const next = acquireIntentOwnership(root, 'product/alpha', { ownerId: 'new-epoch-worker' });
  assert.notEqual(next.epoch, handle.epoch);
  const { reconcileAutonomyOperation } = await operations();
  const result = reconcileAutonomyOperation(root, operation.id);
  assert.equal(result.status, 'completed');
  const serialized = JSON.stringify(result);
  for (const privateValue of [handle.token, 'PRIVATE-SOURCE-CANARY', 'SECRET-CANARY']) assert.equal(serialized.includes(privateValue), false);
  releaseIntentOwnership(root, next);
});

test('a claimed grant is verified before canonical work and cannot include a different intent (PTS-005 / PTS-006)', async t => {
  const root = fixture(t), { withIntentMutation } = await ownership();
  assert.throws(() => withIntentMutation(root, 'product/alpha', { id: randomUUID(), action: 'begin-harness', grantDigest: digest('forged grant') },
    () => assert.fail('a forged grant cannot dispatch')), error => error.code === 'autonomy-grant-not-current');
  const grant = fixtureGrant(root);
  createIntent(root, { domain: 'product', slug: 'beta' });
  assert.throws(() => withIntentMutation(root, 'product/beta', { id: randomUUID(), action: 'begin-harness', grantDigest: grant.digest },
    () => assert.fail('the approved pool cannot expand')), error => error.code === 'autonomy-intent-not-permitted');
});

test('grant expiry is checked again before accepting a worker result (PTS-005 / PTS-006)', async t => {
  const root = fixture(t), { withIntentMutation } = await ownership(), grant = fixtureGrant(root);
  const originalNow = Date.now;
  try {
    assert.throws(() => withIntentMutation(root, 'product/alpha', { id: randomUUID(), action: 'begin-harness', grantDigest: grant.digest }, () => {
      Date.now = () => Date.parse(grant.scope.expiresAt) + 1;
      return beginDelivery(root, 'alpha', { tool: 'codex' });
    }), error => error.code === 'autonomy-grant-not-current');
    assert.equal(existsSync(resolve(root, 'knowledge/6.Build/alpha')), false);
  } finally { Date.now = originalNow; }
});

test('an autonomous mutation cannot invoke a human approval through a nested canonical call (PTS-008)', async t => {
  const root = fixture(t), { withIntentMutation } = await ownership(), grant = fixtureGrant(root);
  assert.throws(() => withIntentMutation(root, 'product/alpha', { id: randomUUID(), action: 'begin-harness', grantDigest: grant.digest },
    () => recordBuildApproval(root, 'alpha', { decision: 'approved', approvedBy: 'Forged worker' })),
  error => error.code === 'autonomy-human-decision-required');
  assert.equal(existsSync(resolve(root, 'knowledge/6.Build/alpha')), false);
});

test('a grant cannot select a different canonical orchestrator through nested begin (PTS-006)', async t => {
  const root = fixture(t), { withIntentMutation } = await ownership(), grant = fixtureGrant(root);
  assert.throws(() => withIntentMutation(root, 'product/alpha', { id: randomUUID(), action: 'begin-harness', grantDigest: grant.digest },
    () => beginDelivery(root, 'alpha', { tool: 'claude' })), error => error.code === 'autonomy-provider-not-permitted');
  assert.equal(existsSync(resolve(root, 'knowledge/6.Build/alpha')), false);
});

test('provider authority uses the same supported environment fallback as canonical delivery (PTS-006)', async t => {
  const root = fixture(t), { withIntentMutation } = await ownership(), grant = fixtureGrant(root);
  const original = process.env.EWAI_ORCHESTRATOR;
  process.env.EWAI_ORCHESTRATOR = 'codex';
  try {
    const result = withIntentMutation(root, 'product/alpha', { id: randomUUID(), action: 'begin-harness', grantDigest: grant.digest },
      () => beginDelivery(root, 'alpha'));
    assert.equal(result.result.run.tool, 'codex');
    assert.equal(result.result.state.validation.orchestrator, 'codex');
  } finally {
    if (original === undefined) delete process.env.EWAI_ORCHESTRATOR; else process.env.EWAI_ORCHESTRATOR = original;
  }
});

test('a claimed nested grant cannot disappear inside an ungranted interactive context (PTS-005 / PTS-006)', async t => {
  const root = fixture(t), { withIntentMutation } = await ownership();
  assert.throws(() => withIntentMutation(root, 'product/alpha', { action: 'begin-harness' }, () =>
    withIntentMutation(root, 'product/alpha', { action: 'begin-harness', grantDigest: digest('forged nested grant') },
      () => beginDelivery(root, 'alpha', { tool: 'codex' }))), error => error.code === 'autonomy-grant-context-mismatch');
  assert.equal(existsSync(resolve(root, 'knowledge/6.Build/alpha')), false);
});

test('a current scoped grant permits begin but changing configuration invalidates later acceptance (PTS-005 / PTS-006)', async t => {
  const root = fixture(t), { withIntentMutation } = await ownership(), grant = fixtureGrant(root);
  const result = withIntentMutation(root, 'product/alpha', { id: randomUUID(), action: 'begin-harness', grantDigest: grant.digest },
    () => beginDelivery(root, 'alpha', { tool: 'codex' }));
  assert.equal(result.status, 'completed');
  const config = resolve(root, 'knowledge/pipeline.yaml');
  writeFileSync(config, readFileSync(config, 'utf8') + '\n# changed fixture configuration\n');
  assert.throws(() => withIntentMutation(root, 'product/alpha', { id: randomUUID(), action: 'prepare-phase', phase: 'intent', grantDigest: grant.digest },
    () => assert.fail('changed configuration cannot be accepted')), error => error.code === 'autonomy-grant-policy-changed');
});

test('an unresolved operation cannot evade recovery or its attempt limit by changing operation ID (PTS-012 / PTS-013)', async t => {
  const root = fixture(t), { withIntentMutation } = await ownership();
  const first = { id: randomUUID(), action: 'begin-harness', maxAttempts: 1 };
  assert.throws(() => withIntentMutation(root, 'product/alpha', first, () => { throw new Error('stopped fixture'); }));
  assert.throws(() => withIntentMutation(root, 'product/alpha', { ...first, id: randomUUID() }, () => assert.fail('cannot reset attempts with a new ID')),
    error => error.code === 'autonomy-recovery-required');
  assert.throws(() => beginDelivery(root, 'alpha', { tool: 'codex' }), error => error.code === 'autonomy-recovery-required');
});

test('nested work cannot escape the grant by switching intent or phase (PTS-006 / PTS-008)', async t => {
  const root = fixture(t), { withIntentMutation } = await ownership(), grant = fixtureGrant(root);
  createIntent(root, { domain: 'product', slug: 'beta' });
  assert.throws(() => withIntentMutation(root, 'product/alpha', { id: randomUUID(), action: 'begin-harness', grantDigest: grant.digest },
    () => beginDelivery(root, 'beta', { tool: 'codex' })), error => error.code === 'autonomy-intent-not-permitted');
  assert.equal(existsSync(resolve(root, 'knowledge/6.Build/beta')), false);
});

test('phase-scoped delegation binds canonical calls to the approved phase (PTS-006)', async t => {
  const root = fixture(t), { withIntentMutation } = await ownership(), grant = fixtureGrant(root);
  beginDelivery(root, 'alpha', { tool: 'codex' });
  const result = withIntentMutation(root, 'product/alpha', { id: randomUUID(), action: 'prepare-phase', phase: 'intent', grantDigest: grant.digest },
    () => startDeliveryPhase(root, 'alpha', 'intent'));
  assert.equal(result.status, 'completed');
  assert.throws(() => withIntentMutation(root, 'product/alpha', { id: randomUUID(), action: 'prepare-phase', phase: 'intent', grantDigest: grant.digest },
    () => startDeliveryPhase(root, 'alpha', 'plan')), error => error.code === 'autonomy-action-not-permitted');
});

for (const mutation of ['earlier-file', 'new-directory-entry']) {
  test(`canonical snapshot rejects concurrent ${mutation} changes (PTS-013)`, async t => {
    const root = fixture(t), { readIntentMutationSnapshot } = await operations();
    beginDelivery(root, 'alpha', { tool: 'codex' });
    const locator = fs.statSync(resolve(root, '.ewai-pipeline/project.json'));
    const originalRead = fs.readFileSync; let changed = false;
    fs.readFileSync = function(path, ...args) {
      const result = originalRead.call(this, path, ...args);
      if (!changed && typeof path === 'number' && fs.fstatSync(path).ino === locator.ino) {
        changed = true;
        const target = mutation === 'earlier-file' ? resolve(root, 'knowledge/2.Purpose/intents/product/alpha.md')
          : resolve(root, 'knowledge/6.Build/alpha/late-evidence.md');
        fs.writeFileSync(target, mutation === 'earlier-file' ? originalRead(target, 'utf8') + '\nConcurrent edit\n' : 'New concurrent evidence');
      }
      return result;
    };
    syncBuiltinESMExports();
    try {
      assert.throws(() => readIntentMutationSnapshot(root, 'product/alpha'), error => error.code === 'autonomy-operation-evidence-changed');
      assert.equal(changed, true);
    } finally { fs.readFileSync = originalRead; syncBuiltinESMExports(); }
  });
}

test('discarded nested asynchronous work cannot outlive the canonical critical section (PTS-009 / PTS-013)', async t => {
  const root = fixture(t), { acquireIntentOwnership, releaseIntentOwnership, withIntentMutation } = await ownership();
  const handle = acquireIntentOwnership(root, 'product/alpha', { ownerId: 'retained-fixture-owner' });
  let lateWork, outerError;
  try {
    try {
      withIntentMutation(root, 'product/alpha', { id: randomUUID(), action: 'begin-harness', ownership: handle }, () => {
        lateWork = withIntentMutation(root, 'product/alpha', { action: 'begin-harness' }, () => {
          const promise = new Promise(resolveLater => setTimeout(() => {
            try { resolveLater({ value: beginDelivery(root, 'alpha') }); }
            catch (error) { resolveLater({ error }); }
          }, 10));
          lateWork = promise;
          return promise;
        });
        return { queued: true };
      });
    } catch (error) { outerError = error; }
    const late = await lateWork;
    assert.equal(outerError?.code, 'intent-mutation-must-be-synchronous');
    assert.equal(late?.error?.code, 'intent-mutation-context-expired');
    assert.equal(existsSync(resolve(root, 'knowledge/6.Build/alpha')), false);
  } finally { releaseIntentOwnership(root, handle); }
});

test('session ownership expiry rolls back before activity is persisted (PTS-009)', async t => {
  const root = fixture(t), { acquireIntentOwnership, releaseIntentOwnership } = await ownership();
  const handle = acquireIntentOwnership(root, 'product/alpha', { ownerId: 'expiring-fixture-owner' });
  const originalExec = DatabaseSync.prototype.exec, originalNow = Date.now;
  let injected = false;
  DatabaseSync.prototype.exec = function(sql) {
    const stack = new Error().stack;
    if (/^BEGIN IMMEDIATE/.test(sql) && stack.includes('recordActivity') && !stack.includes('syncWorkItems')) {
      injected = true; Date.now = () => handle.expiresAt + 1;
    }
    return originalExec.call(this, sql);
  };
  try {
    assert.throws(() => startActiveSession(root, 'product/alpha', { ownership: handle, ownerId: 'expiring-fixture-owner' }),
      error => error.code === 'intent-ownership-stale');
    assert.equal(injected, true);
    const database = new DatabaseSync(resolve(root, '.ewai-pipeline/data/pipeline.sqlite'));
    try {
      assert.equal(database.prepare('SELECT count(*) AS n FROM active_sessions').get().n, 0);
      assert.equal(database.prepare('SELECT count(*) AS n FROM activity_events').get().n, 0);
    } finally { database.close(); }
  } finally { DatabaseSync.prototype.exec = originalExec; Date.now = originalNow; releaseIntentOwnership(root, handle); }
});

test('a failed interactive run publication cannot evade recovery with a fresh operation ID (PTS-013)', async t => {
  const root = fixture(t), originalRename = fs.renameSync;
  let injected = false;
  fs.renameSync = function(from, to) {
    const result = originalRename.call(this, from, to);
    if (!injected && String(to).includes('/6.Build/alpha/runs/') && String(to).endsWith('.json')) {
      injected = true; throw new Error('fixture failure after durable run publication');
    }
    return result;
  };
  syncBuiltinESMExports();
  try { assert.throws(() => beginDelivery(root, 'alpha'), /fixture failure/); }
  finally { fs.renameSync = originalRename; syncBuiltinESMExports(); }
  assert.equal(injected, true);
  assert.throws(() => beginDelivery(root, 'alpha'), error => error.code === 'autonomy-recovery-required');
  assert.equal(readdirSync(resolve(root, 'knowledge/6.Build/alpha/runs')).length, 1);
});

test('malformed intent and recovery records return safe structured errors without source text (PTS-013)', async t => {
  const root = fixture(t), sidecar = resolve(root, 'knowledge/2.Purpose/intents/product/alpha.json');
  const original = readFileSync(sidecar), canary = 'PRIVATE-SOURCE-CANARY';
  const safe = code => error => error.code === code && !error.message.includes(canary);
  for (const invalid of [`{${canary}`, 'null']) {
    writeFileSync(sidecar, invalid);
    assert.throws(() => beginDelivery(root, 'alpha'), safe('intent-state-invalid'));
  }
  writeFileSync(sidecar, original);
  const lock = resolve(root, '.ewai-pipeline/runtime/intent-ownership', `${digest('product/alpha').slice(7)}.lock`);
  fs.mkdirSync(dirname(lock), { recursive: true }); writeFileSync(lock, `{${canary}`);
  const { recoverStoppedIntentOwnership } = await ownership();
  assert.throws(() => recoverStoppedIntentOwnership(root, { pid: 2147483647 }, 'product/alpha'), safe('intent-recovery-invalid'));
  assert.equal(readFileSync(lock, 'utf8'), `{${canary}`);
});
