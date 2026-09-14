import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { initProject } from '../src/project.mjs';

const cli = resolve(import.meta.dirname, '../bin/ewai');
const disclaimer = 'Security validation is evidence, not certification or proof that this system is secure. Tools can miss vulnerabilities and produce false positives. A qualified human must review the scope, findings, limitations and residual risk before release.';

function runCli(root, args) {
  return spawnSync(process.execPath, [cli, ...args, '--project', root], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

test('meeting command family documents the guarded evidence workflow', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-meeting-cli-help-'));
  try {
    initProject(root, { name: 'Meeting CLI Help' });
    const result = runCli(root, ['help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /meeting register FILE .*--yes/);
    assert.match(result.stdout, /meeting prepare SOURCE_ID/);
    assert.match(result.stdout, /meeting review SOURCE_ID --input FILE --reviewed-by NAME/);
    assert.match(result.stdout, /meeting promote SOURCE_ID --yes --approved-by NAME/);
    assert.match(result.stdout, /meeting status \[SOURCE_ID\]/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('meeting CLI moves from explicit registration to reviewed evidence without exposing raw material', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-meeting-cli-flow-'));
  try {
    initProject(root, { name: 'Meeting CLI Flow' });
    const sourcePath = resolve(root, 'product-sync.txt');
    writeFileSync(sourcePath, 'Decision: retain human approval.\nRisk: source drift.\nAction: document the route.\n');

    const unconfirmed = runCli(root, ['meeting', 'register', sourcePath, '--json']);
    assert.equal(unconfirmed.status, 1);
    assert.match(JSON.parse(unconfirmed.stderr).error, /requires --yes/i);

    const registered = runCli(root, [
      'meeting', 'register', sourcePath, '--yes', '--label', 'Product sync',
      '--classification', 'internal', '--cloud-processing', 'allowed', '--json'
    ]);
    assert.equal(registered.status, 0, registered.stderr);
    const registration = JSON.parse(registered.stdout);
    const sourceId = registration.source.sourceId;
    assert.equal(JSON.stringify(registration).includes(sourcePath), false);
    assert.equal(registration.notices.includes(disclaimer), true);

    const prepared = runCli(root, ['meeting', 'prepare', sourceId, '--json']);
    assert.equal(prepared.status, 0, prepared.stderr);
    const extraction = JSON.parse(prepared.stdout);
    assert.equal(extraction.processing.permitted, true);
    assert.equal(extraction.activePersonas.length > 0, true);
    assert.equal(extraction.notices.includes(disclaimer), true);

    const inputPath = resolve(root, 'meeting-review.json');
    writeFileSync(inputPath, `${JSON.stringify({
      bundle: {
        schema: 'ewai.meeting-candidate-bundle/v1', sourceId,
        sourceDigest: registration.source.digest,
        candidates: [{
          id: 'MEC-001', type: 'decision', observedStatement: 'Human approval remains required.',
          interpretation: 'Automation cannot grant delivery authority.', lineAnchors: [{ start: 1, end: 1 }], confidence: 'high'
        }]
      },
      dispositions: [{ candidateId: 'MEC-001', decision: 'accepted', rationale: 'Confirmed by the product owner.' }]
    }, null, 2)}\n`);
    const reviewed = runCli(root, ['meeting', 'review', sourceId, '--input', inputPath, '--reviewed-by', 'Product Owner', '--json']);
    assert.equal(reviewed.status, 0, reviewed.stderr);
    assert.equal(JSON.parse(reviewed.stdout).reviewedBy, 'Product Owner');

    const unapproved = runCli(root, ['meeting', 'promote', sourceId, '--approved-by', 'Product Owner', '--json']);
    assert.equal(unapproved.status, 1);
    assert.match(JSON.parse(unapproved.stderr).error, /requires --yes/i);
    const promoted = runCli(root, ['meeting', 'promote', sourceId, '--yes', '--approved-by', 'Product Owner', '--json']);
    assert.equal(promoted.status, 0, promoted.stderr);
    assert.equal(JSON.parse(promoted.stdout).counts.promoted, 1);

    const status = runCli(root, ['meeting', 'status', sourceId, '--json']);
    assert.equal(status.status, 0, status.stderr);
    const workspace = JSON.parse(status.stdout);
    assert.equal(workspace.selectedSource.promotionState, 'promoted');
    assert.equal(workspace.candidates[0].disposition.decision, 'accepted');
    assert.equal(workspace.notices.includes(disclaimer), true);
    assert.equal(JSON.stringify(workspace).includes(sourcePath), false);
    assert.equal(JSON.stringify(workspace).includes(readFileSync(sourcePath, 'utf8')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('meeting CLI rejects unsafe review inputs and unknown operations', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-meeting-cli-guards-'));
  try {
    initProject(root, { name: 'Meeting CLI Guards' });
    const missingReview = runCli(root, ['meeting', 'review', 'meeting.missing.aaaaaaaaaaaa', '--reviewed-by', 'Owner', '--json']);
    assert.equal(missingReview.status, 1);
    assert.match(JSON.parse(missingReview.stderr).error, /requires --input/i);
    const unknown = runCli(root, ['meeting', 'connect', '--json']);
    assert.equal(unknown.status, 1);
    assert.match(JSON.parse(unknown.stderr).error, /Unknown meeting command/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
