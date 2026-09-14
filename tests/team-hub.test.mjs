import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { initProject } from '../src/project.mjs';
import {
  buildTeamHubEnvelope,
  buildTeamHubSnapshot,
  inspectTeamHubDisclosure,
  validateTeamHubEnvelope,
  validateTeamHubSnapshot,
} from '../src/team-hub.mjs';

function project() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-domain-'));
  initProject(root, { name: 'Safe Example Project' });
  return root;
}

const options = {
  projectId: 'project-safe-example',
  generatedAt: '2026-08-29T12:00:00.000Z',
  revisionDigest: `sha256:${'a'.repeat(64)}`,
  intents: { total: 4, draft: 1, ready: 1, inProgress: 1, completed: 1, blocked: 0 },
  delivery: {
    slug: 'safe-delivery', title: 'Safe delivery', status: 'in-progress', currentPhase: 'build',
    updatedAt: '2026-08-29T11:00:00.000Z', buildApproved: true, manualQa: 'pending',
    attention: [{ code: 'manual-qa-pending', severity: 'info', summary: 'Manual QA remains pending.' }],
  },
  resources: [{ kind: 'organisation-blueprint', id: 'org.example.engineering', version: '1.0.0', digest: `sha256:${'b'.repeat(64)}` }],
};

test('builds a strict path-neutral snapshot and digest-bound envelope', () => {
  const root = project();
  try {
    const snapshot = buildTeamHubSnapshot(root, options);
    assert.equal(snapshot.schema, 'ewai.team-hub-snapshot/v1');
    assert.equal(snapshot.project.name, 'Safe Example Project');
    assert.equal(snapshot.delivery.currentPhase, 'build');
    const envelope = buildTeamHubEnvelope(snapshot);
    assert.match(envelope.snapshotDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(envelope.idempotencyKey, envelope.snapshotDigest);
    assert.deepEqual(validateTeamHubSnapshot(snapshot), snapshot);
    assert.deepEqual(validateTeamHubEnvelope(envelope), envelope);
    assert.equal(JSON.stringify(envelope).includes(root), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('rejects unknown keys, unsafe references, oversized values and digest disagreement', () => {
  const root = project();
  try {
    const snapshot = buildTeamHubSnapshot(root, options);
    assert.throws(() => validateTeamHubSnapshot({ ...snapshot, source: 'private code' }), /unknown|unrecognised/i);
    assert.throws(() => validateTeamHubSnapshot({ ...snapshot, project: { ...snapshot.project, name: '/Users/example/private' } }), /unsafe|path/i);
    assert.throws(() => validateTeamHubSnapshot({ ...snapshot, project: { ...snapshot.project, name: 'x'.repeat(201) } }), /project|too big|maximum/i);
    const envelope = buildTeamHubEnvelope(snapshot);
    assert.throws(() => validateTeamHubEnvelope({ ...envelope, snapshotDigest: `sha256:${'f'.repeat(64)}` }), /digest/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('disclosure is generated from the closed contract and snapshots contain no forbidden content', () => {
  const root = project();
  try {
    const disclosure = inspectTeamHubDisclosure();
    assert.equal(disclosure.schema, 'ewai.team-hub-disclosure/v1');
    assert.deepEqual(disclosure.excluded, [
      'credentials', 'error-report-packages', 'local-paths', 'logs', 'persona-bodies', 'prompts-and-transcripts',
      'repository-remotes', 'source-and-specs-bodies',
    ]);
    const snapshot = buildTeamHubSnapshot(root, options);
    const text = JSON.stringify(snapshot);
    for (const canary of ['/Users/example', 'https://git.example.invalid/private', 'secret-token-canary', 'prompt-canary', 'source-canary', 'persona-body-canary']) {
      assert.equal(text.includes(canary), false);
    }
    assert.match(disclosure.contractDigest, /^sha256:[a-f0-9]{64}$/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
