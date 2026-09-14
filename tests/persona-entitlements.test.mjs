import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { inspectPersonaEntitlement, premiumPackRoot, premiumPackReceiptPath, premiumPersonaRoot, resolvePersonaEntitlement, syncPersonaPack, validatePersonaPack } from '../src/persona-entitlements.mjs';

const server = 'https://www.conversationalcoding.dev';
function home(t) { const p = mkdtempSync(resolve(tmpdir(), 'ewai-only-website-')); t.after(() => rmSync(p, { recursive: true, force: true })); return p; }
function candidate(root) {
  mkdirSync(resolve(root, 'premium-personas'), { recursive: true });
  writeFileSync(resolve(root, 'pack.yaml'), 'schema: ewai.persona-pack/v1\nid: ewai.personas.professional\nversion: 1.2.3\ncontent:\n  personas: premium-personas\n');
  writeFileSync(resolve(root, 'premium-personas/reviewer.md'), '# Synthetic reviewer\n');
}

test('unconfigured premium personas default to website distribution', t => {
  assert.equal(resolvePersonaEntitlement({}, { home: home(t) }).provider, 'wordpress-edd', 'Default premium provider must be wordpress-edd.');
});
test('missing key offers private setup without any provider network request or download', async t => {
  const p = home(t); let calls = 0;
  const status = await inspectPersonaEntitlement({}, { home: p, fetchImpl: async () => { calls++; throw Error('Unexpected request'); } });
  assert.equal(status.provider, 'wordpress-edd'); assert.equal(status.accessReason, 'licence-not-configured');
  assert.equal(status.action.kind, 'offer-configure'); assert.match(status.action.command, /premium configure/);
  assert.equal(calls, 0); assert.equal(existsSync(premiumPackRoot(p)), false);
  assert.equal(existsSync(premiumPackReceiptPath(p)), false); assert.equal(existsSync(resolve(p, '.ewai')), false);
  assert.equal(JSON.stringify(status).includes(p), false);
});
test('obsolete provider and source fields are rejected with safe migration guidance', t => {
  const p = home(t);
  for (const premium of [{ provider: 'removed-provider' }, { repository: 'secret-old-source' }, { branch: 'old-branch' }, { upgrade_url: server }]) {
    assert.throws(() => resolvePersonaEntitlement({ personas: { premium } }, { home: p }), e => /website|configure/i.test(e.message) && !e.message.includes('secret-old-source'));
  }
});
test('unsupported and unreceipted existing cache stays untouched but is excluded', async t => {
  const p = home(t), root = premiumPackRoot(p); candidate(root);
  const body = readFileSync(resolve(root, 'premium-personas/reviewer.md'), 'utf8');
  assert.equal(premiumPersonaRoot(p), '');
  const receipt = premiumPackReceiptPath(p); mkdirSync(resolve(receipt, '..'), { recursive: true });
  writeFileSync(receipt, JSON.stringify({ schema: 'ewai.persona-pack-receipt/v1', packId: 'ewai.personas.professional', providerId: 'retired-source', revision: 'a'.repeat(64), contentDigest: 'sha256:' + 'b'.repeat(64) }));
  const status = await inspectPersonaEntitlement({}, { home: p });
  assert.equal(status.installed, true); assert.equal(status.verified, false); assert.equal(status.dirty, true);
  assert.equal(premiumPersonaRoot(p), '');
  assert.equal(readFileSync(resolve(root, 'premium-personas/reviewer.md'), 'utf8'), body);
  await assert.rejects(syncPersonaPack({}, { home: p, confirmed: true }), /configure/i);
});
test('standalone verifier accepts bounded website content and rejects links, executable content and size breaches', t => {
  const p = home(t), root = resolve(p, 'candidate'); candidate(root);
  const options = { revision: 'a'.repeat(64) };
  assert.equal(validatePersonaPack(root, options).providerId, 'wordpress-edd');
  symlinkSync(resolve(root, 'premium-personas/reviewer.md'), resolve(root, 'premium-personas/link.md'));
  assert.throws(() => validatePersonaPack(root, options), /symbolic links/i);
  rmSync(resolve(root, 'premium-personas/link.md'));
  writeFileSync(resolve(root, 'command.js'), 'throw 1');
  assert.throws(() => validatePersonaPack(root, options), /file type/i); rmSync(resolve(root, 'command.js'));
  mkdirSync(resolve(root, '.git')); assert.throws(() => validatePersonaPack(root, options), /metadata|hidden/i); rmSync(resolve(root, '.git'), { recursive: true });
  writeFileSync(resolve(root, 'premium-personas/large.md'), Buffer.alloc(1024 * 1024 + 1));
  assert.throws(() => validatePersonaPack(root, options), /maximum size/i);
});
test('dangling receipt symlink cannot expose unsupported cache content', async t => {
  const p = home(t), root = premiumPackRoot(p); candidate(root);
  const receipt = premiumPackReceiptPath(p); mkdirSync(resolve(receipt, '..'), { recursive: true });
  symlinkSync(resolve(p, 'missing-receipt'), receipt);
  assert.equal(premiumPersonaRoot(p), '');
  const status = await inspectPersonaEntitlement({}, { home: p });
  assert.equal(status.accessReason, 'unsafe-local-state');
  assert.equal(status.verified, false);
  assert.equal(readFileSync(resolve(root, 'premium-personas/reviewer.md'), 'utf8'), '# Synthetic reviewer\n');
});
test('premium runtime contains no source-control acquisition or fallback implementation', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../src/persona-entitlements.mjs'), 'utf8');
  assert.doesNotMatch(source, /node:child_process|execFile|safeRepository|syncGitPack|verifyGitCandidate|ls-remote|merge-base|DEFAULT_PREMIUM_REPOSITORY/);
  const checkin = readFileSync(resolve(import.meta.dirname, '../src/checkin.mjs'), 'utf8');
  assert.doesNotMatch(checkin, /DEFAULT_FRAMEWORK_REPOSITORY|remoteHead|source: 'git'|\['git'/);
});
