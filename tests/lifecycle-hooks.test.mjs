import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createIntent } from '../src/intents.mjs';
import { createPersona } from '../src/personas.mjs';
import { initProject } from '../src/project.mjs';
import { openRuntimeDatabase } from '../src/runtime/database.mjs';
import {
  disableLifecycleSubscription,
  dispatchEligibleLifecycleDeliveries,
  publishLifecycleEvent,
  readLifecycleHookWorkspace,
  reconcileCanonicalLifecycleEvents,
  registerLifecycleHandler,
  retryLifecycleDelivery,
  subscribeLifecycleHandler,
  validateLifecycleHandlerPackage,
} from '../src/runtime/lifecycle-hooks.mjs';

const acceptedHandler = `#!/usr/bin/env node
process.stdin.resume();
process.stdin.once('end', () => {
  process.stdout.write(JSON.stringify({
    schema: 'ewai.lifecycle-hook-ack/v1',
    status: 'accepted',
    code: 'received',
    message: 'The test handler received the milestone.'
  }));
});
`;

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function createProject() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-lifecycle-hooks-'));
  initProject(root, { name: 'Lifecycle Hook Test Project' });
  return root;
}

function createHandler(root, options = {}) {
  const folder = resolve(root, 'test-handler');
  const entrypoint = resolve(folder, 'handler');
  const source = options.source ?? acceptedHandler;
  mkdirSync(folder, { recursive: true });
  writeFileSync(entrypoint, source, 'utf8');
  chmodSync(entrypoint, 0o755);
  writeFileSync(resolve(folder, 'lifecycle-handler.json'), `${JSON.stringify({
    schema: 'ewai.lifecycle-handler/v1',
    id: options.id ?? 'org.example.delivery-observer',
    name: options.name ?? 'Delivery observer',
    publisher: { id: 'org.example', name: 'Example Organisation' },
    version: '1.0.0',
    compatibility: { protocols: ['1'], eventSchemas: ['1'] },
    entrypoint: 'handler',
    digest: `sha256:${digest(source)}`,
    events: options.events ?? ['ewai.delivery.*', 'ewai.intent.created'],
    limits: { timeoutMs: options.timeoutMs ?? 2_000, maxOutputBytes: options.maxOutputBytes ?? 4_096 },
  }, null, 2)}\n`, 'utf8');
  return { folder, entrypoint };
}

function registerAndSubscribe(root, options = {}) {
  const handler = createHandler(root, options);
  const registration = registerLifecycleHandler(root, handler.folder, { confirmed: true, now: '2026-08-20T09:00:00.000Z' });
  const subscription = subscribeLifecycleHandler(
    root,
    registration.id,
    options.patterns ?? ['ewai.delivery.*'],
    { confirmed: true, now: '2026-08-20T09:00:01.000Z' },
  );
  return { handler, registration, subscription };
}

test('validates trusted packages and delivers a safe persona-aware event', async () => {
  const root = createProject();
  try {
    createPersona({ scope: 'project', slug: 'release-owner', name: 'Release Owner', projectRoot: root });
    const handler = createHandler(root);
    const validation = validateLifecycleHandlerPackage(root, handler.folder);

    assert.equal(validation.valid, true);
    assert.equal(validation.id, 'org.example.delivery-observer');
    assert.equal('trustedRoot' in validation, false);
    assert.throws(() => registerLifecycleHandler(root, handler.folder), /explicit confirmation/);

    const unsafeManifestPath = resolve(handler.folder, 'lifecycle-handler.json');
    const unsafeManifest = JSON.parse(readFileSync(unsafeManifestPath, 'utf8'));
    unsafeManifest.publisher.command = 'do-not-run';
    writeFileSync(unsafeManifestPath, `${JSON.stringify(unsafeManifest, null, 2)}\n`, 'utf8');
    assert.throws(() => validateLifecycleHandlerPackage(root, handler.folder), /publisher field is not allowed/);
    delete unsafeManifest.publisher.command;
    writeFileSync(unsafeManifestPath, `${JSON.stringify(unsafeManifest, null, 2)}\n`, 'utf8');

    const registration = registerLifecycleHandler(root, handler.folder, { confirmed: true, now: '2026-08-20T09:00:00.000Z' });
    const subscription = subscribeLifecycleHandler(root, registration.id, ['ewai.delivery.*'], {
      confirmed: true,
      now: '2026-08-20T09:00:01.000Z',
    });
    const publication = publishLifecycleEvent(root, 'ewai.delivery.build.approved', {
      sourceKey: 'delivery:sample:build.approved:2026-08-20T09:01:00.000Z',
      occurredAt: '2026-08-20T09:01:00.000Z',
      scope: { intent: 'platform/sample', delivery: 'sample' },
      facts: { status: 'approved', decision: 'approved' },
      evidence: ['SPECS/6.Build/sample/build-approval.json'],
      personas: [
        { ref: 'ewai.core.end-user', reason: 'Checks whether the approved build remains useful.' },
        { ref: 'project.release-owner', reason: 'Owns the local release decision.' },
      ],
      now: '2026-08-20T09:01:00.000Z',
    });

    assert.equal(subscription.created, true);
    assert.equal(publication.created, true);
    assert.equal(publication.deliveryCount, 1);
    assert.deepEqual(publication.event.personas.map(({ id, tier }) => ({ id, tier })), [
      { id: 'ewai.core.end-user', tier: 'core' },
      { id: 'project.release-owner', tier: 'project' },
    ]);
    const duplicate = publishLifecycleEvent(root, 'ewai.delivery.build.approved', {
      sourceKey: 'delivery:sample:build.approved:2026-08-20T09:01:00.000Z',
    });
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.event.id, publication.event.id);

    const dispatched = await dispatchEligibleLifecycleDeliveries(root, { now: '2026-08-20T09:01:01.000Z' });
    assert.equal(dispatched.attempted, 1);
    assert.equal(dispatched.deliveries[0].status, 'succeeded');

    const workspace = readLifecycleHookWorkspace(root);
    assert.equal(workspace.summary.succeeded, 1);
    assert.equal(workspace.attempts[0].code, 'received');
    assert.equal(workspace.events[0].personas[1].name, 'Release Owner');
    assert.equal(JSON.stringify(workspace).includes(root), false);
    assert.equal(JSON.stringify(workspace).includes('entrypoint'), false);
    assert.equal(JSON.stringify(workspace).includes('stdout'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('uses bounded automatic retry and preserves the delivery identity for manual recovery', async () => {
  const root = createProject();
  try {
    registerAndSubscribe(root);
    const publication = publishLifecycleEvent(root, 'ewai.delivery.phase.completed', {
      sourceKey: 'delivery:sample:phase:plan:completed:2026-08-20T10:00:00.000Z',
      occurredAt: '2026-08-20T10:00:00.000Z',
      scope: { delivery: 'sample', phase: 'plan' },
      facts: { status: 'completed', phase: 'plan' },
      streamId: 'delivery:sample',
      now: '2026-08-20T10:00:00.000Z',
    });
    const seenKeys = [];
    const fail = async ({ event }) => {
      seenKeys.push(event.idempotencyKey);
      return { ok: false, code: 'temporarily-unavailable', message: 'Try again later.', durationMs: 2 };
    };

    assert.equal((await dispatchEligibleLifecycleDeliveries(root, { now: '2026-08-20T10:00:00.000Z', invoke: fail })).deliveries[0].status, 'retrying');
    assert.equal((await dispatchEligibleLifecycleDeliveries(root, { now: '2026-08-20T10:00:00.500Z', invoke: fail })).attempted, 0);
    assert.equal((await dispatchEligibleLifecycleDeliveries(root, { now: '2026-08-20T10:00:01.000Z', invoke: fail })).deliveries[0].status, 'retrying');
    assert.equal((await dispatchEligibleLifecycleDeliveries(root, { now: '2026-08-20T10:00:06.000Z', invoke: fail })).deliveries[0].status, 'exhausted');

    let workspace = readLifecycleHookWorkspace(root);
    const delivery = workspace.deliveries[0];
    assert.equal(delivery.eventId, publication.event.id);
    assert.equal(delivery.automaticAttemptCount, 3);
    assert.equal(new Set(seenKeys).size, 1);
    assert.throws(() => retryLifecycleDelivery(root, delivery.id), /explicit confirmation/);

    const retry = retryLifecycleDelivery(root, delivery.id, { confirmed: true, now: '2026-08-20T10:01:00.000Z' });
    assert.equal(retry.idempotencyKey, seenKeys[0]);
    const recovered = await dispatchEligibleLifecycleDeliveries(root, {
      now: '2026-08-20T10:01:00.000Z',
      invoke: async ({ event }) => {
        seenKeys.push(event.idempotencyKey);
        return { ok: true, code: 'recovered', message: 'Recovered.', durationMs: 1 };
      },
    });
    assert.equal(recovered.deliveries[0].status, 'succeeded');
    assert.equal(new Set(seenKeys).size, 1);

    workspace = readLifecycleHookWorkspace(root);
    assert.deepEqual(workspace.attempts.map((attempt) => attempt.kind), ['manual', 'automatic', 'automatic', 'automatic']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('recovers a stale in-flight claim without changing its delivery identity', async () => {
  const root = createProject();
  try {
    registerAndSubscribe(root);
    const publication = publishLifecycleEvent(root, 'ewai.delivery.phase.completed', {
      sourceKey: 'delivery:sample:phase:plan:completed:2026-08-20T10:00:00.000Z',
      occurredAt: '2026-08-20T10:00:00.000Z',
      scope: { delivery: 'sample', phase: 'plan' },
      facts: { status: 'completed', phase: 'plan' },
      streamId: 'delivery:sample',
      now: '2026-08-20T10:00:00.000Z',
    });
    const database = openRuntimeDatabase(root);
    database.prepare(`
      UPDATE lifecycle_deliveries SET status = 'delivering', updated_at = ?
      WHERE event_id = ?
    `).run('2026-08-20T10:00:00.000Z', publication.event.id);
    database.close();

    const seenKeys = [];
    const recovered = await dispatchEligibleLifecycleDeliveries(root, {
      now: '2026-08-20T10:01:01.000Z',
      invoke: async ({ event }) => {
        seenKeys.push(event.idempotencyKey);
        return { ok: true, code: 'recovered', message: 'Recovered after restart.', durationMs: 1 };
      },
    });

    assert.equal(recovered.recoveredClaims, 1);
    assert.equal(recovered.attempted, 1);
    assert.equal(recovered.deliveries[0].status, 'succeeded');
    const workspace = readLifecycleHookWorkspace(root);
    assert.equal(workspace.deliveries[0].eventId, publication.event.id);
    assert.equal(workspace.deliveries[0].automaticAttemptCount, 2);
    assert.equal(new Set(seenKeys).size, 1);
    assert.deepEqual(workspace.attempts.map((attempt) => attempt.code), ['recovered', 'worker-interrupted']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('disables unresolved deliveries and detects handler package tampering', async () => {
  const root = createProject();
  try {
    const { handler, subscription } = registerAndSubscribe(root);
    publishLifecycleEvent(root, 'ewai.delivery.phase.entered', {
      sourceKey: 'delivery:sample:phase:build:entered:2026-08-20T11:00:00.000Z',
      occurredAt: '2026-08-20T11:00:00.000Z',
      scope: { delivery: 'sample', phase: 'build' },
      facts: { status: 'running', phase: 'build' },
      now: '2026-08-20T11:00:00.000Z',
    });
    writeFileSync(handler.entrypoint, `${readFileSync(handler.entrypoint, 'utf8')}\n// changed after registration\n`, 'utf8');

    const result = await dispatchEligibleLifecycleDeliveries(root, { now: '2026-08-20T11:00:01.000Z' });
    assert.equal(result.deliveries[0].status, 'incompatible');
    assert.equal(readLifecycleHookWorkspace(root).attempts[0].code, 'handler-incompatible');

    assert.throws(() => disableLifecycleSubscription(root, subscription.id), /explicit confirmation/);
    const disabled = disableLifecycleSubscription(root, subscription.id, { confirmed: true, now: '2026-08-20T11:01:00.000Z' });
    assert.equal(disabled.enabled, false);
    const workspace = readLifecycleHookWorkspace(root);
    assert.equal(workspace.deliveries[0].status, 'disabled');
    assert.equal(workspace.summary.disabled, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects unsafe package roots, executable state, duplicate identity and incompatible manifests', () => {
  const root = createProject();
  try {
    const handler = createHandler(root);
    const linkedRoot = resolve(root, 'linked-handler');
    symlinkSync(handler.folder, linkedRoot, 'dir');
    assert.throws(() => validateLifecycleHandlerPackage(root, linkedRoot));

    chmodSync(handler.entrypoint, 0o644);
    assert.throws(() => validateLifecycleHandlerPackage(root, handler.folder));
    chmodSync(handler.entrypoint, 0o755);

    registerLifecycleHandler(root, handler.folder, { confirmed: true });
    assert.throws(
      () => registerLifecycleHandler(root, handler.folder, { confirmed: true }),
      /already registered/,
    );

    const manifestPath = resolve(handler.folder, 'lifecycle-handler.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.compatibility.protocols = ['2'];
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(() => validateLifecycleHandlerPackage(root, handler.folder), /does not support protocol 1/);

    manifest.compatibility.protocols = ['1'];
    manifest.entrypoint = '../outside-handler';
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(() => validateLifecycleHandlerPackage(root, handler.folder), /entrypoint/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('normalises real handler rejection, process, timeout and acknowledgement failures', async () => {
  const afterInput = (body) => `#!/usr/bin/env node
process.stdin.resume();
process.stdin.once('end', () => { ${body} });
`;
  const scenarios = [
    {
      name: 'rejection',
      source: afterInput("process.stdout.write(JSON.stringify({ schema: 'ewai.lifecycle-hook-ack/v1', status: 'rejected', code: 'policy-review', message: 'Review required.' }));"),
      code: 'policy-review',
      status: 'rejected',
    },
    { name: 'non-zero exit', source: '#!/usr/bin/env node\nprocess.exit(7);\n', code: 'handler-exit', status: 'retrying' },
    { name: 'signal', source: afterInput("process.kill(process.pid, 'SIGTERM');"), code: 'handler-signal', status: 'retrying' },
    { name: 'malformed acknowledgement', source: afterInput("process.stdout.write('{');"), code: 'handler-ack-invalid', status: 'retrying' },
    { name: 'oversized output', source: afterInput("process.stdout.write('x'.repeat(512));"), maxOutputBytes: 256, code: 'handler-output-too-large', status: 'retrying' },
    { name: 'timeout', source: afterInput('setInterval(() => {}, 1000);'), timeoutMs: 100, code: 'handler-timeout', status: 'retrying' },
  ];

  for (const scenario of scenarios) {
    const root = createProject();
    try {
      registerAndSubscribe(root, scenario);
      publishLifecycleEvent(root, 'ewai.delivery.phase.completed', {
        sourceKey: `delivery:sample:phase:plan:completed:${scenario.name}`,
        occurredAt: '2026-08-20T10:00:00.000Z',
        scope: { delivery: 'sample', phase: 'plan' },
        facts: { status: 'completed', phase: 'plan' },
        now: '2026-08-20T10:00:00.000Z',
      });
      const result = await dispatchEligibleLifecycleDeliveries(root, { now: '2026-08-20T10:00:00.000Z' });
      assert.equal(result.deliveries[0].status, scenario.status, scenario.name);
      assert.equal(readLifecycleHookWorkspace(root).attempts[0].code, scenario.code, scenario.name);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('keeps reconciliation and the Hooks workspace available when one canonical event is unsafe', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-lifecycle-reconciliation-'));
  try {
    initProject(root, { name: 'x'.repeat(200) });
    createPersona({ scope: 'project', slug: 'release-owner', name: 'Release Owner', projectRoot: root });
    const intent = createIntent(root, { slug: 'unsafe-context', domain: 'platform', title: 'Unsafe Context' });
    assert.equal(intent.slug, 'unsafe-context');

    const reconciliation = reconcileCanonicalLifecycleEvents(root);
    assert.equal(reconciliation.observed, 1);
    assert.equal(reconciliation.failed, 1);
    assert.equal(readLifecycleHookWorkspace(root).summary.events, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ships the three public lifecycle hook JSON schemas', () => {
  for (const filename of [
    'lifecycle-handler.schema.json',
    'lifecycle-event.schema.json',
    'lifecycle-hook-ack.schema.json',
  ]) {
    const schema = JSON.parse(readFileSync(resolve(import.meta.dirname, '../config', filename), 'utf8'));
    assert.match(schema.$id, /^https:\/\/engineeringwithai\.dev\/schemas\//);
    assert.equal(schema.additionalProperties, false);
  }

  const packageManifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'));
  assert.equal(packageManifest.files.includes('Docs/'), true);
  assert.match(readFileSync(resolve(import.meta.dirname, '../Docs/using-lifecycle-hooks.md'), 'utf8'), /# Using EWAI lifecycle hooks/);
});

test('exposes explicit validation, registration, subscription and inspection CLI commands', () => {
  const root = createProject();
  try {
    const handler = createHandler(root);
    const cli = (...args) => JSON.parse(execFileSync(process.execPath, [
      resolve(import.meta.dirname, '../bin/ewai'),
      ...args,
      '--project', root,
      '--json',
    ], { encoding: 'utf8' }));

    const catalogue = cli('hook', 'catalogue');
    assert.equal(catalogue.events.length, 15);
    assert.equal(catalogue.events.some(({ name }) => name === 'ewai.project.starter.materialised'), true);
    assert.equal(catalogue.events.some(({ name }) => name === 'ewai.meeting-evidence.promoted'), true);
    assert.equal(catalogue.events.some(({ name }) => name === 'ewai.knowledge-proposals.materialised'), true);
    for (const name of [
      'ewai.policy.facts.confirmed',
      'ewai.policy.evaluation.recorded',
      'ewai.policy.review.recorded',
      'ewai.policy.exception.recorded',
    ]) {
      assert.equal(catalogue.events.some((event) => event.name === name), true);
    }
    assert.equal(cli('hook', 'validate', handler.folder).valid, true);
    assert.equal(cli('hook', 'register', handler.folder, '--yes').id, 'org.example.delivery-observer');
    const subscribed = cli('hook', 'subscribe', 'org.example.delivery-observer', '--events', 'ewai.delivery.*', '--yes');
    assert.equal(subscribed.enabled, true);
    const listed = cli('hook', 'list');
    assert.equal(listed.handlers.length, 1);
    assert.equal(listed.subscriptions.length, 1);
    assert.equal(JSON.stringify(listed).includes(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
