import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { initProject } from '../src/project.mjs';
import { ASSURANCE_NOTICE } from '../src/security-validation-config.mjs';
import { READINESS_AUTHORITY_NOTICE } from '../src/solution-readiness.mjs';

const cli = resolve(import.meta.dirname, '../bin/ewai');

function runCli(root, args) {
  return spawnSync(process.execPath, [cli, ...args, '--project', root], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function setup(root) {
  initProject(root, { name: 'Solution Readiness CLI Test' });
  const delivery = resolve(root, 'SPECS/6.Build/sample-delivery');
  mkdirSync(delivery, { recursive: true });
  writeFileSync(resolve(delivery, 'delivery-state.json'), `${JSON.stringify({
    schema: 'ewai.delivery-state/v1', slug: 'sample-delivery', status: 'in-progress', currentPhase: 'delivery',
    phases: [
      { id: 'standards-sweep', status: 'pending' }, { id: 'test-execute', status: 'pending' },
      { id: 'validate-external-plan', status: 'not-supported' }, { id: 'validate-external-test-plan', status: 'not-supported' },
      { id: 'validate-external-code', status: 'not-supported' }, { id: 'delivery', status: 'pending' },
    ],
    humanGates: [{ id: 'manual-qa', status: 'pending' }], approvals: { build: { decision: 'approved' } },
  }, null, 2)}\n`);
  mkdirSync(resolve(root, 'SPECS/2.Purpose/intents/quality'), { recursive: true });
  writeFileSync(resolve(root, 'SPECS/2.Purpose/intents/quality/sample-delivery.md'), '# Sample delivery\n');
}

test('CLI lists profiles, prepares evidence, records review and reports current status', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-readiness-cli-'));
  try {
    setup(root);
    const profilesResult = runCli(root, ['readiness', 'profiles', '--json']);
    assert.equal(profilesResult.status, 0, profilesResult.stderr);
    const profiles = JSON.parse(profilesResult.stdout);
    assert.equal(profiles.schema, 'ewai.solution-readiness-profiles/v1');
    assert.equal(profiles.profiles.length, 5);
    assert.deepEqual(profiles.notices, [ASSURANCE_NOTICE, READINESS_AUTHORITY_NOTICE]);

    const prepareResult = runCli(root, ['readiness', 'prepare', 'sample-delivery', '--profile', 'internal-only', '--json']);
    assert.equal(prepareResult.status, 0, prepareResult.stderr);
    const preparation = JSON.parse(prepareResult.stdout);
    assert.equal(preparation.status, 'prepared');
    assert.equal(preparation.brief.dimensions.length, 11);
    assert.equal(preparation.brief.activePersonas.every((item) => item.id && item.tier && item.engagementReason), true);
    const inputPath = resolve(root, preparation.paths.reviewTemplate);
    const input = JSON.parse(readFileSync(inputPath, 'utf8'));
    for (const decision of input.dimensions) decision.reason = decision.disposition === 'accepted' ? 'Reviewed against cited evidence.' : 'Required evidence is not yet complete.';
    writeFileSync(inputPath, `${JSON.stringify(input, null, 2)}\n`);

    const reviewResult = runCli(root, ['readiness', 'review', preparation.assessmentId, '--input', inputPath, '--reviewed-by', 'Project owner', '--json']);
    assert.equal(reviewResult.status, 0, reviewResult.stderr);
    const review = JSON.parse(reviewResult.stdout);
    assert.equal(review.report.result, 'insufficient-evidence');
    assert.equal(review.report.reviewedBy, 'Project owner');

    const statusResult = runCli(root, ['readiness', 'status', preparation.assessmentId, '--json']);
    assert.equal(statusResult.status, 0, statusResult.stderr);
    assert.equal(JSON.parse(statusResult.stdout).status, 'current');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI help and all readiness presentation paths retain both notices', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-readiness-cli-notices-'));
  try {
    setup(root);
    const help = runCli(root, ['help']);
    assert.equal(help.status, 0, help.stderr);
    for (const command of ['readiness profiles', 'readiness prepare', 'readiness review', 'readiness status']) assert.match(help.stdout, new RegExp(command));

    const text = runCli(root, ['readiness', 'profiles']);
    assert.equal(text.status, 0, text.stderr);
    assert.equal(text.stdout.startsWith(`${ASSURANCE_NOTICE}\n${READINESS_AUTHORITY_NOTICE}\n\n`), true);

    const failure = runCli(root, ['readiness', 'unknown', '--json']);
    assert.equal(failure.status, 1);
    const error = JSON.parse(failure.stderr);
    assert.equal(error.notices.security, ASSURANCE_NOTICE);
    assert.equal(error.notices.authority, READINESS_AUTHORITY_NOTICE);
    assert.match(error.error, /Unknown readiness command/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ships a persona-aware skill and implementation guide with explicit authority boundaries', () => {
  const skill = readFileSync(resolve(import.meta.dirname, '../skills-src/ewai-solution-readiness/SKILL.md'), 'utf8');
  const guide = readFileSync(resolve(import.meta.dirname, '../Docs/solution-readiness-review-guide.md'), 'utf8');
  for (const content of [skill, guide]) {
    assert.match(content, /internal-only/);
    assert.match(content, /critical-regulated/);
    assert.match(content, /active personas/i);
    assert.match(content, /premium.*optional/is);
    assert.match(content, /project.*personal.*core/is);
    assert.match(content, /ready-for-human-decision/);
    assert.match(content, /insufficient-evidence/);
    assert.match(content, new RegExp(ASSURANCE_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(content, /does not.*approve.*release/is);
  }
  assert.match(skill, /readiness prepare/);
  assert.match(skill, /readiness review/);
  assert.match(guide, /Manual QA walkthrough/);
  assert.match(guide, /evidence drift/i);
});
