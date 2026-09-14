import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildTeamHubEnvelope, validateTeamHubSnapshot } from '../src/team-hub.mjs';
import { openTeamHubDatabase, ingestTeamHubEnvelope, readTeamHubPortfolio } from '../src/runtime/team-hub-database.mjs';
import { createTeamHubHttpServer } from '../src/runtime/team-hub-server.mjs';
import { teamHubStatus, ensureTeamHub, stopTeamHub } from '../src/runtime/team-hub.mjs';

const token = 'team-hub-test-token-with-enough-entropy';

function snapshot(projectId, name, generatedAt = '2026-08-29T12:00:00.000Z', suffix = 'a') {
  return validateTeamHubSnapshot({
    schema: 'ewai.team-hub-snapshot/v1', project: { id: projectId, name }, generatedAt, ewaiVersion: '0.2.1',
    revision: { digest: `sha256:${suffix.repeat(64)}` },
    intents: { total: 2, draft: 0, ready: 1, inProgress: 1, completed: 0, blocked: 0 },
    delivery: null, resources: [],
    authorityNotice: 'Team Hub is an operational evidence projection. It cannot approve Build or Manual QA, accept risk, certify compliance, deploy or release.',
  });
}

test('SQLite ledger replays identical submissions and preserves changed revisions', () => {
  const dataRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-db-'));
  const database = openTeamHubDatabase(dataRoot);
  try {
    const firstEnvelope = buildTeamHubEnvelope(snapshot('project-one', 'Project One'));
    const first = ingestTeamHubEnvelope(database, firstEnvelope, { at: '2026-08-29T12:01:00.000Z', receiptId: 'receipt-first' });
    const replay = ingestTeamHubEnvelope(database, firstEnvelope, { at: '2026-08-29T12:02:00.000Z', receiptId: 'receipt-ignored' });
    assert.equal(first.replayed, false);
    assert.equal(replay.receiptId, first.receiptId);
    assert.equal(replay.replayed, true);

    const changed = ingestTeamHubEnvelope(database, buildTeamHubEnvelope(snapshot('project-one', 'Project One', '2026-08-29T12:03:00.000Z', 'b')), {
      at: '2026-08-29T12:04:00.000Z', receiptId: 'receipt-second',
    });
    assert.notEqual(changed.receiptId, first.receiptId);
    const portfolio = readTeamHubPortfolio(database, { now: '2026-08-29T12:05:00.000Z' });
    assert.equal(portfolio.projects.length, 1);
    assert.equal(portfolio.projects[0].evidence.receiptId, 'receipt-second');
  } finally { database.close(); rmSync(dataRoot, { recursive: true, force: true }); }
});

test('HTTP service exposes non-secret health and protects ingestion and portfolio', async () => {
  const dataRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-http-'));
  const running = await createTeamHubHttpServer({ dataRoot, token, host: '127.0.0.1', port: 0 });
  try {
    const health = await fetch(`${running.url}/health`).then((response) => response.json());
    assert.equal(health.schema, 'ewai.team-hub-health/v1');
    assert.equal(JSON.stringify(health).includes(token), false);
    assert.equal(JSON.stringify(health).includes(dataRoot), false);

    const unauthenticated = await fetch(`${running.url}/api/v1/portfolio`);
    assert.equal(unauthenticated.status, 401);
    assert.equal((await unauthenticated.text()).includes(token), false);
    const wrong = await fetch(`${running.url}/api/v1/portfolio`, { headers: { authorization: 'Bearer wrong-token' } });
    assert.equal(wrong.status, 401);

    const envelope = buildTeamHubEnvelope(snapshot('project-one', 'Project One'));
    const accepted = await fetch(`${running.url}/api/v1/snapshots`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(envelope),
    });
    assert.equal(accepted.status, 202);
    const receipt = await accepted.json();
    assert.equal(receipt.projectId, 'project-one');

    const portfolioResponse = await fetch(`${running.url}/api/v1/portfolio`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(portfolioResponse.status, 200);
    const portfolio = await portfolioResponse.json();
    assert.equal(portfolio.projects[0].name, 'Project One');
    assert.equal(JSON.stringify(portfolio).includes(dataRoot), false);
  } finally { await running.close(); rmSync(dataRoot, { recursive: true, force: true }); }
});

test('service rejects unsafe binds, bodies and invalid envelopes before persistence', async () => {
  const dataRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-boundary-'));
  await assert.rejects(() => createTeamHubHttpServer({ dataRoot, token, host: '0.0.0.0', port: 0 }), /allow-network/i);
  const running = await createTeamHubHttpServer({ dataRoot, token, host: '127.0.0.1', port: 0, maximumBodyBytes: 256 });
  try {
    const wrongType = await fetch(`${running.url}/api/v1/snapshots`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' }, body: '{}',
    });
    assert.equal(wrongType.status, 415);
    const oversized = await fetch(`${running.url}/api/v1/snapshots`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ payload: 'x'.repeat(300) }),
    });
    assert.equal(oversized.status, 413);
    const portfolio = await fetch(`${running.url}/api/v1/portfolio`, { headers: { authorization: `Bearer ${token}` } }).then((response) => response.json());
    assert.equal(portfolio.projects.length, 0);
  } finally { await running.close(); rmSync(dataRoot, { recursive: true, force: true }); }
});

test('one portfolio contains independently submitted projects and truthful freshness', async () => {
  const dataRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-portfolio-'));
  const database = openTeamHubDatabase(dataRoot);
  try {
    ingestTeamHubEnvelope(database, buildTeamHubEnvelope(snapshot('project-one', 'Project One')), { at: '2026-08-29T12:00:00.000Z', receiptId: 'receipt-one' });
    ingestTeamHubEnvelope(database, buildTeamHubEnvelope(snapshot('project-two', 'Project Two')), { at: '2026-08-20T12:00:00.000Z', receiptId: 'receipt-two' });
    const portfolio = readTeamHubPortfolio(database, { now: '2026-08-29T12:00:00.000Z', staleAfterHours: 48 });
    assert.deepEqual(portfolio.projects.map(({ id }) => id), ['project-one', 'project-two']);
    assert.equal(portfolio.projects[0].freshness.state, 'current');
    assert.equal(portfolio.projects[1].freshness.state, 'stale');
    assert.equal(portfolio.authority.canApprove, false);
  } finally { database.close(); rmSync(dataRoot, { recursive: true, force: true }); }
});

test('managed Team Hub process starts, reports status and stops without persisting its token', async () => {
  const dataRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-managed-'));
  process.env.EWAI_TEAM_HUB_MANAGED_TEST = token;
  try {
    const started = await ensureTeamHub({ dataRoot, tokenEnv: 'EWAI_TEAM_HUB_MANAGED_TEST', port: 0 });
    assert.equal(started.status, 'running');
    const status = await teamHubStatus({ dataRoot });
    assert.equal(status.status, 'running');
    assert.equal(JSON.stringify(status).includes(token), false);
    assert.equal(readFileSync(resolve(dataRoot, 'runtime/team-hub.json'), 'utf8').includes(token), false);
    const stopped = await stopTeamHub({ dataRoot });
    assert.equal(stopped.status, 'stopped');
  } finally {
    delete process.env.EWAI_TEAM_HUB_MANAGED_TEST;
    await stopTeamHub({ dataRoot }).catch(() => {});
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('central browser assets preserve session-only credentials and authority copy', () => {
  const html = readFileSync(resolve(import.meta.dirname, '../public/team-hub/index.html'), 'utf8');
  const app = readFileSync(resolve(import.meta.dirname, '../public/team-hub/app.js'), 'utf8');
  const styles = readFileSync(resolve(import.meta.dirname, '../public/team-hub/styles.css'), 'utf8');
  assert.match(html, /id="hubToken"/);
  assert.match(html, /id="projectList"/);
  assert.match(html, /id="resourceList"/);
  assert.match(html, /id="resourceDetail"/);
  assert.match(html, /cannot approve Build or Manual QA/i);
  assert.match(app, /sessionStorage/);
  assert.match(app, /\/api\/v1\/resources/);
  assert.match(html, /Published[\s\S]*Downloaded[\s\S]*Verified[\s\S]*Installed[\s\S]*Select\/apply separately/);
  assert.doesNotMatch(app, /localStorage/);
  assert.match(app, /textContent/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /:focus-visible/);
});
