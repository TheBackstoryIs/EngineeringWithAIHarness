import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { initProject } from '../src/project.mjs';
import { buildTeamHubSnapshot } from '../src/team-hub.mjs';
import { runtimePaths } from '../src/runtime/paths.mjs';
import {
  connectTeamHub,
  disconnectTeamHub,
  readTeamHubWorkspace,
  syncTeamHub,
} from '../src/runtime/team-hub-client.mjs';

function project() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-client-'));
  initProject(root, { name: 'Client Project' });
  return root;
}

test('single mode is the default and performs no network request', async () => {
  const root = project();
  try {
    let calls = 0;
    const workspace = readTeamHubWorkspace(root);
    assert.equal(workspace.mode, 'single');
    assert.equal(workspace.connection, null);
    assert.equal(calls, 0);
    assert.equal(existsSync(runtimePaths(root).teamHubConnectionPath), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('connect stores only an endpoint, project identity and token environment reference', () => {
  const root = project();
  try {
    process.env.EWAI_TEAM_HUB_TEST_TOKEN = 'secret-token-canary';
    assert.throws(() => connectTeamHub(root, { endpoint: 'http://127.0.0.1:49001', tokenEnv: 'EWAI_TEAM_HUB_TEST_TOKEN' }), /confirmation/i);
    const connection = connectTeamHub(root, {
      endpoint: 'http://127.0.0.1:49001', projectId: 'client-project', tokenEnv: 'EWAI_TEAM_HUB_TEST_TOKEN',
      confirmed: true, disclosureAcknowledged: true, at: '2026-08-29T12:00:00.000Z',
    });
    assert.equal(connection.schema, 'ewai.team-hub-connection/v1');
    const persisted = readFileSync(runtimePaths(root).teamHubConnectionPath, 'utf8');
    assert.equal(persisted.includes('secret-token-canary'), false);
    assert.equal(persisted.includes('EWAI_TEAM_HUB_TEST_TOKEN'), true);
    assert.equal(JSON.stringify(readTeamHubWorkspace(root)).includes('secret-token-canary'), false);
  } finally {
    delete process.env.EWAI_TEAM_HUB_TEST_TOKEN;
    rmSync(root, { recursive: true, force: true });
  }
});

test('explicit sync records honest attempts and preserves the last accepted receipt', async () => {
  const root = project();
  try {
    process.env.EWAI_TEAM_HUB_TEST_TOKEN = 'secret-token-canary';
    connectTeamHub(root, {
      endpoint: 'http://127.0.0.1:49001', projectId: 'client-project', tokenEnv: 'EWAI_TEAM_HUB_TEST_TOKEN',
      confirmed: true, disclosureAcknowledged: true, at: '2026-08-29T12:00:00.000Z',
    });
    const snapshot = buildTeamHubSnapshot(root, {
      projectId: 'client-project', generatedAt: '2026-08-29T12:01:00.000Z', revisionDigest: `sha256:${'a'.repeat(64)}`,
      intents: { total: 0, draft: 0, ready: 0, inProgress: 0, completed: 0, blocked: 0 }, resources: [], delivery: null,
    });
    const accepted = await syncTeamHub(root, {
      confirmed: true, at: '2026-08-29T12:01:00.000Z', snapshot,
      fetch: async (_url, request) => {
        assert.equal(request.headers.authorization, 'Bearer secret-token-canary');
        const envelope = JSON.parse(request.body);
        return new Response(JSON.stringify({
          schema: 'ewai.team-hub-receipt/v1', receiptId: 'receipt-accepted-1', projectId: 'client-project',
          snapshotDigest: envelope.snapshotDigest, idempotencyKey: envelope.idempotencyKey,
          acceptedAt: '2026-08-29T12:01:01.000Z', replayed: false,
        }), { status: 202, headers: { 'content-type': 'application/json' } });
      },
    });
    assert.equal(accepted.attempt.status, 'accepted');
    assert.equal(accepted.receipt.receiptId, 'receipt-accepted-1');

    const failed = await syncTeamHub(root, {
      confirmed: true, at: '2026-08-29T12:02:00.000Z', snapshot,
      fetch: async () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } }),
    });
    assert.equal(failed.attempt.status, 'failed');
    const workspace = readTeamHubWorkspace(root);
    assert.equal(workspace.lastAttempt.status, 'failed');
    assert.equal(workspace.lastAcceptedReceipt.receiptId, 'receipt-accepted-1');
    assert.equal(JSON.stringify(workspace).includes('secret-token-canary'), false);
  } finally {
    delete process.env.EWAI_TEAM_HUB_TEST_TOKEN;
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing token records a bounded failed attempt without contacting the Hub', async () => {
  const root = project();
  try {
    connectTeamHub(root, {
      endpoint: 'http://127.0.0.1:49001', projectId: 'client-project', tokenEnv: 'EWAI_TEAM_HUB_MISSING_TOKEN',
      confirmed: true, disclosureAcknowledged: true, at: '2026-08-29T12:00:00.000Z',
    });
    let requests = 0;
    const result = await syncTeamHub(root, {
      confirmed: true, at: '2026-08-29T12:03:00.000Z', env: {},
      fetch: async () => { requests += 1; throw new Error('must not be called'); },
    });
    assert.equal(requests, 0);
    assert.equal(result.attempt.status, 'failed');
    assert.equal(result.attempt.error.code, 'missing-token');
    assert.match(result.attempt.error.message, /environment variable is unavailable/i);
    assert.equal(readTeamHubWorkspace(root).localWorkAvailable, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('disconnect is confirmation-protected and removes connection metadata only', () => {
  const root = project();
  try {
    connectTeamHub(root, {
      endpoint: 'http://127.0.0.1:49001', projectId: 'client-project', tokenEnv: 'EWAI_TEAM_HUB_TEST_TOKEN',
      confirmed: true, disclosureAcknowledged: true,
    });
    assert.throws(() => disconnectTeamHub(root), /confirmation/i);
    const disconnected = disconnectTeamHub(root, { confirmed: true });
    assert.equal(disconnected.mode, 'single');
    assert.equal(existsSync(runtimePaths(root).teamHubConnectionPath), false);
    assert.equal(existsSync(resolve(root, 'SPECS/pipeline.yaml')), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
