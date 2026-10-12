import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { configurePersonaLicence, parsePersonaRelease, parsePersonaSubscription } from '../src/persona-website-provider.mjs';
import { inspectPersonaEntitlement, syncPersonaPack, premiumPackRoot, premiumPackReceiptPath, premiumPersonaRoot, installedPackId, STARTER_PACK_ID, PREMIUM_PACK_ID, STARTER_PACK_URL, PROFESSIONAL_PACK_URL } from '../src/persona-entitlements.mjs';
import { listPersonas } from '../src/personas.mjs';
import { companionOpening } from '../src/companion-opening.mjs';
import { crc32 } from '../src/persona-zip.mjs';

const server = 'https://www.conversationalcoding.dev';
const config = { personas: { premium: { provider: 'wordpress-edd' } } };

function zip(files) {
  let offset = 0;
  const chunks = [], central = [];
  for (const [name, text] of files) {
    const n = Buffer.from(name), b = Buffer.from(text), h = Buffer.alloc(30), c = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc32(b), 14);
    h.writeUInt32LE(b.length, 18); h.writeUInt32LE(b.length, 22); h.writeUInt16LE(n.length, 26);
    c.writeUInt32LE(0x02014b50); c.writeUInt16LE(0x0314, 4); c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc32(b), 16); c.writeUInt32LE(b.length, 20); c.writeUInt32LE(b.length, 24);
    c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    chunks.push(h, n, b); central.push(c, n); offset += h.length + n.length + b.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}
function pack(id, personas) {
  const files = [
    ['pack.yaml', `schema: ewai.persona-pack/v1\nid: ${id}\nversion: 1.0.0\ncontent:\n  personas: premium-personas\n`],
    ['manifest.json', JSON.stringify({ schema: 'ewai.persona-pack/v1', id, version: '1.0.0', persona_count: personas.length, collection_count: 1 })],
    ...personas.map((name) => [`premium-personas/engineering/${name}.md`, `# ${name}\nA synthetic test persona.\n`]),
  ];
  const archive = zip(files);
  return { archive, release: { schema: 'ewai.persona-pack/v1', id, version: '1.0.0', artefact: { sha256: createHash('sha256').update(archive).digest('hex'), size: archive.length } } };
}
const plans = {
  'STARTER-KEY': { plan: 'free', seat: 'seat-free', subscription: 'subscription-free', ...pack(STARTER_PACK_ID, ['architect', 'ciso']) },
  'PROFESSIONAL-KEY': { plan: 'individual', seat: 'seat-pro', subscription: 'subscription-pro', ...pack(PREMIUM_PACK_ID, ['architect', 'ciso', 'dpo', 'cfo']) },
};
function fixture(t) {
  const home = mkdtempSync(resolve(tmpdir(), 'ewai-starter-test-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const state = { current: null, status: 'active', access: 'available', calls: [], failDownload: false };
  const sub = () => ({ id: plans[state.current].subscription, plan_type: plans[state.current].plan, status: state.status, ends_at: state.status === 'expired' ? '2020-01-01T00:00:00Z' : '2099-01-01T00:00:00Z' });
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url), path = u.pathname;
    state.calls.push(path);
    if (path.endsWith('/activations')) {
      state.current = JSON.parse(options.body).licence_key;
      return Response.json({ schema: 'cce.activation/v1', activation_id: 'activation-test', activation_token: 'test-private-activation-token', seat_id: plans[state.current].seat, subscription: sub(), machines_used: 1, machine_limit: 3 });
    }
    const p = plans[state.current];
    if (path.endsWith('/status')) return Response.json({ schema: 'cce.entitlement-status/v1', access: state.access, activation: { id: 'activation-test' }, seat: { id: p.seat }, subscription: sub(), release: state.access === 'available' ? p.release : null });
    if (path.endsWith('/download-grants')) return Response.json({ schema: 'cce.download-grant/v1', download_url: server + '/?cce-download=test-grant', expires_at: '2099-01-01T00:00:00Z', release: p.release });
    if (u.searchParams.has('cce-download')) {
      if (state.failDownload) return new Response(Buffer.from('not a zip'));
      return new Response(p.archive);
    }
    throw new Error('Unexpected fixture URL');
  };
  const options = (licenceKey) => ({ home, fetchImpl, machineName: 'Test workstation', licenceKey });
  return { home, state, options };
}
async function setup(f, key, extra = {}) {
  await configurePersonaLicence(f.options(key));
  return syncPersonaPack(config, { ...f.options(key), confirmed: true, ...extra });
}
const count = (home) => listPersonas([premiumPersonaRoot(home)]).length;

test('the release contract accepts the starter pack, the free plan, and nothing else', () => {
  const release = (id) => ({ schema: 'ewai.persona-pack/v1', id, version: '0.1.0', artefact: { sha256: 'a'.repeat(64), size: 1000 } });
  assert.equal(parsePersonaRelease(release(STARTER_PACK_ID)).id, STARTER_PACK_ID);
  assert.equal(parsePersonaRelease(release(PREMIUM_PACK_ID)).id, PREMIUM_PACK_ID);
  assert.throws(() => parsePersonaRelease(release('ewai.personas.other')), /could not be verified/);
  const subscription = (plan_type) => ({ id: 'sub-1', plan_type, status: 'active', ends_at: '2099-01-01T00:00:00Z' });
  assert.equal(parsePersonaSubscription(subscription('free')).planType, 'free');
  assert.throws(() => parsePersonaSubscription(subscription('trial')), /could not be verified/);
});

test('a starter key installs the starter personas under their own pack id and receipt', async t => {
  const f = fixture(t);
  const result = await setup(f, 'STARTER-KEY');
  assert.equal(result.status, 'installed'); assert.equal(result.packId, STARTER_PACK_ID);
  assert.equal(installedPackId(f.home), STARTER_PACK_ID);
  assert.equal(count(f.home), 2);
  const receipt = JSON.parse(readFileSync(premiumPackReceiptPath(f.home)));
  assert.equal(receipt.packId, STARTER_PACK_ID); assert.equal(receipt.provenance.planType, 'free');
  assert.equal(existsSync(premiumPackRoot(f.home, PREMIUM_PACK_ID)), false);
  const status = await inspectPersonaEntitlement(config, f.options('STARTER-KEY'));
  assert.equal(status.status, 'current'); assert.equal(status.verified, true); assert.equal(status.starter, true);
  assert.equal(status.packId, STARTER_PACK_ID); assert.equal(status.upgradeUrl, PROFESSIONAL_PACK_URL);
});

test('a professional key replaces a verified starter install in one slot', async t => {
  const f = fixture(t); await setup(f, 'STARTER-KEY');
  await configurePersonaLicence(f.options('PROFESSIONAL-KEY'));
  const before = await inspectPersonaEntitlement(config, f.options('PROFESSIONAL-KEY'));
  assert.equal(before.action.kind, 'offer-upgrade'); assert.equal(before.status, 'upgrade-available');
  const result = await syncPersonaPack(config, { ...f.options('PROFESSIONAL-KEY'), confirmed: true });
  assert.equal(result.status, 'upgraded');
  assert.equal(installedPackId(f.home), PREMIUM_PACK_ID); assert.equal(count(f.home), 4);
  assert.equal(existsSync(premiumPackRoot(f.home, STARTER_PACK_ID)), false);
  assert.equal(existsSync(premiumPackReceiptPath(f.home, STARTER_PACK_ID)), false);
  assert.equal(JSON.parse(readFileSync(premiumPackReceiptPath(f.home))).packId, PREMIUM_PACK_ID);
});

test('a failed upgrade restores the starter install and its receipt', async t => {
  const f = fixture(t); await setup(f, 'STARTER-KEY');
  const receipt = readFileSync(premiumPackReceiptPath(f.home, STARTER_PACK_ID));
  await configurePersonaLicence(f.options('PROFESSIONAL-KEY'));
  for (const failAfterStage of ['candidate-promoted', 'receipt-written']) {
    await assert.rejects(syncPersonaPack(config, { ...f.options('PROFESSIONAL-KEY'), confirmed: true, failAfterStage }), /Injected/);
    assert.equal(installedPackId(f.home), STARTER_PACK_ID); assert.equal(count(f.home), 2);
    assert.deepEqual(readFileSync(premiumPackReceiptPath(f.home, STARTER_PACK_ID)), receipt);
    assert.equal(existsSync(premiumPackReceiptPath(f.home, PREMIUM_PACK_ID)), false);
    assert.equal(existsSync(premiumPackRoot(f.home, PREMIUM_PACK_ID)), false);
  }
  f.state.failDownload = true;
  await assert.rejects(syncPersonaPack(config, { ...f.options('PROFESSIONAL-KEY'), confirmed: true }));
  assert.equal(installedPackId(f.home), STARTER_PACK_ID); assert.equal(count(f.home), 2);
});

test('a starter key does not silently replace an installed professional pack', async t => {
  const f = fixture(t); await setup(f, 'PROFESSIONAL-KEY');
  await configurePersonaLicence(f.options('STARTER-KEY'));
  await assert.rejects(syncPersonaPack(config, { ...f.options('STARTER-KEY'), confirmed: true }), /another provider or licence/);
  assert.equal(installedPackId(f.home), PREMIUM_PACK_ID); assert.equal(count(f.home), 4);
});

test('an expired free plan keeps the installed starter personas and stops updates', async t => {
  const f = fixture(t); await setup(f, 'STARTER-KEY');
  f.state.status = 'expired'; f.state.access = 'unavailable';
  const status = await inspectPersonaEntitlement(config, f.options('STARTER-KEY'));
  assert.equal(status.status, 'expired-individual-retained'); assert.match(status.message, /claim it again/i);
  assert.equal(status.upgradeUrl, PROFESSIONAL_PACK_URL);
  await assert.rejects(syncPersonaPack(config, { ...f.options('STARTER-KEY'), confirmed: true }), /expired/);
  assert.equal(count(f.home), 2);
});

test('unknown access with a starter install never shows an upsell', async t => {
  const f = fixture(t); await setup(f, 'STARTER-KEY');
  const offline = { ...f.options('STARTER-KEY'), fetchImpl: async () => { throw new Error('offline'); } };
  const status = await inspectPersonaEntitlement(config, offline);
  assert.equal(status.access, 'unknown'); assert.equal(status.upgradeUrl, null); assert.equal(status.installed, true);
  assert.equal(companionOpening({ premiumActive: false, starterUpgradeUrl: null }).starterUpgrade, null);
});

test('an unlicensed user is offered the starter pack first, and a starter install adds a quiet upgrade line', async t => {
  const f = fixture(t);
  const status = await inspectPersonaEntitlement(config, f.options('STARTER-KEY'));
  assert.equal(status.accessReason, 'licence-not-configured'); assert.equal(status.upgradeUrl, STARTER_PACK_URL);
  const opening = companionOpening({ licenceNotConfigured: true });
  assert.equal(opening.personaSetup.choices.find((c) => c.key === 'starter').url, STARTER_PACK_URL);
  const active = companionOpening({ hasWork: true, premiumActive: true, starterUpgradeUrl: PROFESSIONAL_PACK_URL });
  assert.equal(active.starterUpgrade.url, PROFESSIONAL_PACK_URL);
  assert.ok(!active.actions.some((a) => a.id === 7 || a.id === 8));
});
