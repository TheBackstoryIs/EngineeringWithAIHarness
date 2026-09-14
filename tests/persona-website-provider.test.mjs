import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { configurePersonaLicence } from '../src/persona-website-provider.mjs';
import { readPersonaLicence, personaLicencePath } from '../src/persona-licence-config.mjs';
import { extractPersonaZip, crc32 } from '../src/persona-zip.mjs';
import { inspectPersonaEntitlement, syncPersonaPack, premiumPackRoot, premiumPackReceiptPath, premiumPersonaRoot } from '../src/persona-entitlements.mjs';
import { listPersonas } from '../src/personas.mjs';
import { checkinProject } from '../src/checkin.mjs';
import { initProject } from '../src/project.mjs';
import { ensureDashboard } from '../src/runtime/dashboard.mjs';
import { dashboardRuntimeVersion } from '../src/runtime/version.mjs';

const server = 'https://www.conversationalcoding.dev';
const key = 'TEST-PRIVATE-LICENCE';
const token = 'test-private-activation-token';
const config = { personas: { premium: { provider: 'wordpress-edd' } } };
const packFiles = [
  ['pack.yaml', 'schema: ewai.persona-pack/v1\nid: ewai.personas.professional\nversion: 1.0.0\ncontent:\n  personas: premium-personas\n'],
  ['premium-personas/engineering/expert.md', '# Expert\nA synthetic test persona.\n'],
  ['manifest.json', JSON.stringify({ schema: 'ewai.persona-pack/v1', id: 'ewai.personas.professional', version: '1.0.0', persona_count: 1, collection_count: 1 })],
];
function zip(files = packFiles, attributes = 0, compressed = false) {
  let offset = 0;
  const chunks = [], central = [];
  for (const [name, text] of files) {
    const n = Buffer.from(name), b = Buffer.from(text), data = compressed ? deflateRawSync(b) : b, h = Buffer.alloc(30), c = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc32(b), 14);
    h.writeUInt16LE(compressed ? 8 : 0, 8);
    h.writeUInt32LE(data.length, 18); h.writeUInt32LE(b.length, 22); h.writeUInt16LE(n.length, 26);
    c.writeUInt32LE(0x02014b50); c.writeUInt16LE(0x0314, 4); c.writeUInt16LE(20, 6);
    c.writeUInt16LE(compressed ? 8 : 0, 10);
    c.writeUInt32LE(crc32(b), 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(b.length, 24);
    c.writeUInt16LE(n.length, 28); c.writeUInt32LE(attributes >>> 0, 38); c.writeUInt32LE(offset, 42);
    chunks.push(h, n, data); central.push(c, n); offset += h.length + n.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}
function fixture(t) {
  const home = mkdtempSync(resolve(tmpdir(), 'ewai-website-test-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const archive = zip(), digest = createHash('sha256').update(archive).digest('hex');
  const release = { schema: 'ewai.persona-pack/v1', id: 'ewai.personas.professional', version: '1.0.0', artefact: { sha256: digest, size: archive.length } };
  const state = { plan: 'team', status: 'active', seat: 'seat-test', access: 'available', calls: [], failure: null, archive, release };
  const subscription = () => ({ id: 'subscription-test', plan_type: state.plan, status: state.status, ends_at: state.status === 'expired' ? '2020-01-01T00:00:00Z' : '2099-01-01T00:00:00Z' });
  const fetchImpl = async (url, options = {}) => {
    state.calls.push({ url: String(url), method: options.method || 'GET', body: options.body });
    if (state.failure) return state.failure(url, options);
    const path = new URL(url).pathname;
    if (path.endsWith('/activations')) return Response.json({ schema: 'cce.activation/v1', activation_id: 'activation-test', activation_token: token, seat_id: state.seat, subscription: subscription(), machines_used: 1, machine_limit: 3 });
    if (path.endsWith('/status')) return Response.json({ schema: 'cce.entitlement-status/v1', access: state.access, activation: { id: 'activation-test', machine_limit: 3, machines_used: 1 }, seat: { id: state.seat }, subscription: subscription(), release: state.access === 'available' ? state.release : null });
    if (path.endsWith('/download-grants')) return Response.json({ schema: 'cce.download-grant/v1', download_url: server + '/?cce-download=test-grant', expires_at: '2099-01-01T00:00:00Z', release: state.release });
    if (new URL(url).searchParams.has('cce-download')) return new Response(state.archive);
    throw new Error('Unexpected fixture URL');
  };
  const options = { home, fetchImpl, machineName: 'Test workstation', licenceKey: key };
  return { home, state, options };
}
async function install(f) {
  await configurePersonaLicence(f.options);
  return syncPersonaPack(config, { ...f.options, confirmed: true });
}

test('private setup saves key and stable random machine identity, without exposing secrets', async t => {
  const f = fixture(t);
  const result = await configurePersonaLicence(f.options);
  const first = readPersonaLicence(f.home);
  assert.equal(first.licenceKey, key);
  assert.equal(first.activationToken, token);
  assert.match(first.installationSecret, /^[a-f0-9]{64}$/);
  assert.equal(statSync(personaLicencePath(f.home)).mode & 0o777, 0o600);
  await configurePersonaLicence({ ...f.options, machineName: 'Renamed workstation' });
  assert.equal(readPersonaLicence(f.home).installationSecret, first.installationSecret);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(key + '|' + token));
  assert.equal(JSON.parse(f.state.calls[0].body).machine_name, 'Test workstation');
});

test('invalid key and machine cap preserve existing credentials with helpful errors', async t => {
  const f = fixture(t); await configurePersonaLicence(f.options);
  const prior = readFileSync(personaLicencePath(f.home));
  for (const [code, status] of [['invalid_licence_key', 401], ['installation_limit_reached', 409]]) {
    f.state.failure = () => Response.json({ code, message: 'UNSAFE RAW ' + key }, { status });
    await assert.rejects(configurePersonaLicence({ ...f.options, licenceKey: 'bad-key' }), code === 'installation_limit_reached' ? /three machines/i : /licence key/i);
    assert.deepEqual(readFileSync(personaLicencePath(f.home)), prior);
  }
});

test('session status checks are fresh, offer install and never download', async t => {
  const f = fixture(t); await configurePersonaLicence(f.options); f.state.calls = [];
  const a = await inspectPersonaEntitlement(config, f.options);
  const b = await inspectPersonaEntitlement({}, f.options);
  assert.equal(a.provider, 'wordpress-edd'); assert.equal(a.action.kind, 'offer-install');
  assert.equal(b.latestVersion, '1.0.0');
  assert.equal(f.state.calls.length, 2);
  assert.ok(f.state.calls.every(c => c.url.includes('/status?')));
  assert.doesNotMatch(JSON.stringify(a), /TEST-PRIVATE|test-private|test-grant/);
});

test('verified ZIP installation and receipt support current/version update status', async t => {
  const f = fixture(t); assert.equal((await install(f)).status, 'installed');
  const s = await inspectPersonaEntitlement(config, f.options);
  assert.equal(s.status, 'current'); assert.equal(s.verified, true);
  const receipt = JSON.parse(readFileSync(premiumPackReceiptPath(f.home)));
  assert.equal(receipt.provenance.seatId, 'seat-test');
  f.state.release = { ...f.state.release, version: '1.1.0' };
  assert.equal((await inspectPersonaEntitlement(config, f.options)).action.kind, 'offer-update');
});

test('only matching authenticated team expiry removes managed premium content; authored files survive', async t => {
  const f = fixture(t); await install(f);
  const personal = resolve(f.home, '.ewai/personas/my-persona.md');
  const project = resolve(f.home, 'project/SPECS/personas/project/custom.md');
  for (const p of [personal, project]) { mkdirSync(resolve(p, '..'), { recursive: true }); writeFileSync(p, 'KEEP ME\n'); }
  f.state.status = 'expired'; f.state.access = 'unavailable';
  const s = await inspectPersonaEntitlement(config, f.options);
  assert.equal(s.status, 'expired-team-removed'); assert.equal(s.installed, false);
  assert.equal(existsSync(premiumPackRoot(f.home)), false);
  assert.equal(existsSync(premiumPackReceiptPath(f.home)), false);
  for (const p of [personal, project]) assert.equal(readFileSync(p, 'utf8'), 'KEEP ME\n');
});

test('individual expiry retains content, stops updates, denies downloads', async t => {
  const f = fixture(t); f.state.plan = 'individual'; await install(f);
  const prior = readFileSync(resolve(premiumPackRoot(f.home), 'premium-personas/engineering/expert.md'));
  f.state.status = 'expired'; f.state.access = 'unavailable';
  const s = await inspectPersonaEntitlement(config, f.options);
  assert.equal(s.status, 'expired-individual-retained'); assert.match(s.message, /updates/i);
  await assert.rejects(syncPersonaPack(config, { ...f.options, confirmed: true }), /expired|updates/i);
  assert.deepEqual(readFileSync(resolve(premiumPackRoot(f.home), 'premium-personas/engineering/expert.md')), prior);
});

test('unrelated team expiry cannot erase an individual receipt', async t => {
  const f = fixture(t); f.state.plan = 'individual'; await install(f);
  f.state.plan = 'team'; f.state.seat = 'different-seat'; await configurePersonaLicence(f.options);
  f.state.status = 'expired'; f.state.access = 'unavailable';
  const s = await inspectPersonaEntitlement(config, f.options);
  assert.equal(s.installed, true); assert.equal(existsSync(premiumPackRoot(f.home)), true);
});

test('uncertain status and generic denials never delete content or disclose raw errors', async t => {
  const f = fixture(t); await install(f);
  for (const fail of [
    () => { throw new Error('RAW SECRET ' + key); },
    () => Response.json({ code: 'rest_forbidden', message: key }, { status: 403 }),
    () => Response.json({ code: 'invalid_activation', message: key }, { status: 401 }),
    () => Response.json({ schema: 'cce.entitlement-status/v1', access: 'unavailable', subscription: { status: 'expired' }, seat: { id: 'seat-test' } }),
    () => new Response('not-json'),
  ]) {
    f.state.failure = fail;
    const s = await inspectPersonaEntitlement(config, f.options);
    assert.equal(s.installed, true); assert.equal(existsSync(premiumPackRoot(f.home)), true);
    assert.doesNotMatch(JSON.stringify(s), /RAW SECRET|TEST-PRIVATE/);
  }
});

test('consent, digest failure and injected promotion/receipt failure preserve old pack', async t => {
  const f = fixture(t); await install(f);
  const p = resolve(premiumPackRoot(f.home), 'premium-personas/engineering/expert.md'), prior = readFileSync(p);
  await assert.rejects(syncPersonaPack(config, f.options), /confirmation/i);
  const original = f.state.archive;
  f.state.archive = zip([packFiles[0], ['premium-personas/engineering/expert.md', '# Changed\n']]);
  f.state.release = { ...f.state.release, version: '1.1.0' };
  await assert.rejects(syncPersonaPack(config, { ...f.options, confirmed: true }), /digest|size/i);
  assert.deepEqual(readFileSync(p), prior);
  f.state.archive = original;
  for (const failure of ['candidate-promoted', 'receipt-written']) {
    f.state.release = { ...f.state.release, version: '1.0.0' };
    await assert.rejects(syncPersonaPack(config, { ...f.options, confirmed: true, forceRepair: true, failAfterStage: failure }), /Injected/);
    assert.deepEqual(readFileSync(p), prior);
    assert.equal((await inspectPersonaEntitlement(config, f.options)).verified, true);
  }
});

test('archive rejects traversal, duplicate entries, links, executable content and CRC mismatch', t => {
  const f = fixture(t);
  for (const bad of [
    zip([['../escape.md', 'x']]), zip([['/absolute.md', 'x']]), zip([['C:\\escape.md', 'x']]),
    zip([['same.md', 'x'], ['same.md', 'y']]), zip([['link.md', 'x']], 0xa1ff0000),
    zip([['run.js', 'x']]), zip([['.git/config', 'x']]),
  ]) {
    const target = mkdtempSync(resolve(f.home, 'candidate-'));
    assert.throws(() => extractPersonaZip(bad, target));
  }
  const bad = zip(); bad[30 + Buffer.byteLength(packFiles[0][0])] ^= 1;
  assert.throws(() => extractPersonaZip(bad, mkdtempSync(resolve(f.home, 'crc-'))), /CRC/i);
});

test('unsafe private config and managed-cache symlinks stop without following them', async t => {
  const f = fixture(t), external = resolve(f.home, 'outside'); mkdirSync(external);
  mkdirSync(resolve(f.home, '.ewai')); symlinkSync(external, resolve(f.home, '.ewai/entitlements'));
  await assert.rejects(configurePersonaLicence(f.options), /unsafe|symbolic/i);
  assert.equal(existsSync(resolve(external, 'conversational-coding.json')), false);
});

test('check-in shares one website check with a reused dashboard; next launch checks again', async t => {
  const f = fixture(t); await configurePersonaLicence(f.options);
  const project = resolve(f.home, 'project'); mkdirSync(project); initProject(project, { name: 'Website session fixture' });
  const runtime = resolve(project, '.ewai-pipeline/runtime'); mkdirSync(runtime, { recursive: true });
  const url = 'http://127.0.0.1:47999';
  writeFileSync(resolve(runtime, 'dashboard.json'), JSON.stringify({ url, projectRoot: project, pid: process.pid }));
  const previous = globalThis.fetch;
  globalThis.fetch = async target => {
    assert.equal(String(target), url + '/api/health');
    return Response.json({ schema: 'ewai.dashboard-health/v1', projectRoot: project, pid: process.pid, runtimeVersion: dashboardRuntimeVersion });
  };
  t.after(() => { globalThis.fetch = previous; });
  f.state.calls = [];
  const checked = await checkinProject(project, { home: f.home, premiumFetchImpl: f.options.fetchImpl, checkFramework: false });
  assert.equal(checked.premium.provider, 'wordpress-edd'); assert.equal(checked.runtime.dashboard.started, false);
  assert.equal(f.state.calls.length, 1);
  await ensureDashboard(project, { home: f.home, premiumFetchImpl: f.options.fetchImpl });
  assert.equal(f.state.calls.length, 2);
  const safe = readFileSync(resolve(runtime, 'checkin.json'), 'utf8');
  assert.doesNotMatch(safe, /TEST-PRIVATE|test-private|test-grant/);
});

test('cancelled subscriptions keep paid-term access; missing licence offers private setup', async t => {
  const f = fixture(t);
  assert.equal((await inspectPersonaEntitlement(config, f.options)).action.kind, 'offer-configure');
  await configurePersonaLicence(f.options); f.state.status = 'cancelled';
  assert.equal((await inspectPersonaEntitlement(config, f.options)).access, 'available');
});

test('cross-seat replacement requires additional consent and local edits remain blocked', async t => {
  const f = fixture(t); await install(f);
  f.state.seat = 'replacement-seat'; await configurePersonaLicence(f.options);
  await assert.rejects(syncPersonaPack(config, { ...f.options, confirmed: true }), /--replace/);
  assert.equal((await syncPersonaPack(config, { ...f.options, confirmed: true, replaceConfirmed: true })).status, 'updated');
  writeFileSync(resolve(premiumPackRoot(f.home), 'premium-personas/engineering/expert.md'), '# Local change\n');
  await assert.rejects(syncPersonaPack(config, { ...f.options, confirmed: true, replaceConfirmed: true }), /local changes/);
});

test('timeout and oversized JSON preserve installed content', async t => {
  const f = fixture(t); await install(f);
  for (const failure of [
    () => new Promise(() => {}),
    () => new Response(new ReadableStream({ pull() {} })),
    () => new Response('x'.repeat(64 * 1024 + 1)),
  ]) {
    f.state.failure = failure;
    const s = await inspectPersonaEntitlement(config, { ...f.options, timeout: 15 });
    assert.equal(s.access, 'unknown'); assert.equal(s.installed, true);
  }
});

test('foreign download grants are rejected before any credential or grant request leaves the server', async t => {
  const f = fixture(t); await configurePersonaLicence(f.options);
  const base = f.options.fetchImpl, seen = [];
  const fetchImpl = async (url, options) => {
    seen.push(String(url));
    if (String(url).endsWith('/download-grants')) return Response.json({
      schema: 'cce.download-grant/v1', download_url: 'https://attacker.example/?cce-download=secret',
      expires_at: '2099-01-01T00:00:00Z', release: f.state.release,
    });
    return base(url, options);
  };
  await assert.rejects(syncPersonaPack(config, { ...f.options, fetchImpl, confirmed: true }), /grant/);
  assert.ok(seen.every(u => new URL(u).origin === server));
});

test('deflated archives work and forged expansion/file-count headers are rejected', t => {
  const f = fixture(t), target = mkdtempSync(resolve(f.home, 'deflated-'));
  extractPersonaZip(zip(packFiles, 0, true), target);
  assert.equal(readFileSync(resolve(target, 'premium-personas/engineering/expert.md'), 'utf8'), packFiles[1][1]);
  const bad = zip(); const central = bad.readUInt32LE(bad.length - 6);
  bad.writeUInt32LE(1024 * 1024 + 1, central + 24);
  assert.throws(() => extractPersonaZip(bad, mkdtempSync(resolve(f.home, 'bomb-'))), /unsafe|bounds/i);
  const count = zip(); count.writeUInt16LE(1001, count.length - 14); count.writeUInt16LE(1001, count.length - 12);
  assert.throws(() => extractPersonaZip(count, mkdtempSync(resolve(f.home, 'count-'))), /directory/i);
});

test('dirty team expiry preserves modifications and reports blocked cleanup', async t => {
  const f = fixture(t); await install(f);
  const p = resolve(premiumPackRoot(f.home), 'premium-personas/engineering/expert.md');
  writeFileSync(p, '# Local modification\n');
  f.state.status = 'expired'; f.state.access = 'unavailable';
  const s = await inspectPersonaEntitlement(config, f.options);
  assert.equal(s.status, 'expired-team-cleanup-blocked'); assert.equal(s.verified, false);
  assert.equal(readFileSync(p, 'utf8'), '# Local modification\n');
  assert.equal(premiumPersonaRoot(f.home), '');
  assert.deepEqual(listPersonas([premiumPersonaRoot(f.home)]), []);
  f.state.failure = () => { throw new Error('offline'); };
  assert.equal((await inspectPersonaEntitlement(config, f.options)).status, 'expired-team-cleanup-blocked');
  assert.equal(premiumPersonaRoot(f.home), '');
});

test('held mutation lock cannot keep a confirmed expired team pack eligible', async t => {
  const f = fixture(t); await install(f);
  const lock = resolve(f.home, '.ewai/packs/.persona-pack.lock'); mkdirSync(lock);
  f.state.status = 'expired'; f.state.access = 'unavailable';
  assert.equal((await inspectPersonaEntitlement(config, f.options)).status, 'expired-team-cleanup-blocked');
  assert.equal(existsSync(premiumPackRoot(f.home)), true);
  assert.equal(premiumPersonaRoot(f.home), '');
  rmSync(lock, { recursive: true });
  f.state.status = 'active'; f.state.access = 'available';
  await syncPersonaPack(config, { ...f.options, confirmed: true });
  assert.notEqual(premiumPersonaRoot(f.home), '');
  assert.equal((await inspectPersonaEntitlement(config, f.options)).status, 'current');
});

test('delayed expiry cannot delete a freshly renewed installation of the same seat', async t => {
  const f = fixture(t); await install(f);
  let resume, received;
  const arrival = new Promise(resolve => { received = resolve; });
  const delayed = async (url, options) => {
    const response = await f.options.fetchImpl(url, options);
    if (new URL(url).pathname.endsWith('/status')) {
      received();
      return new Promise(resolve => { resume = () => resolve(response); });
    }
    return response;
  };
  f.state.status = 'expired'; f.state.access = 'unavailable';
  const pending = inspectPersonaEntitlement(config, { ...f.options, fetchImpl: delayed });
  await arrival;
  const prior = JSON.parse(readFileSync(premiumPackReceiptPath(f.home))).installationId;
  f.state.status = 'active'; f.state.access = 'available';
  await syncPersonaPack(config, { ...f.options, confirmed: true, forceRepair: true });
  const fresh = JSON.parse(readFileSync(premiumPackReceiptPath(f.home))).installationId;
  assert.notEqual(fresh, prior);
  resume();
  const status = await pending;
  assert.equal(status.accessReason, 'local-generation-changed');
  assert.equal(existsSync(premiumPackRoot(f.home)), true);
  assert.equal(JSON.parse(readFileSync(premiumPackReceiptPath(f.home))).installationId, fresh);
  assert.notEqual(premiumPersonaRoot(f.home), '');
});

test('unsupported cache cannot be acquired, selected or overwritten; website install lock remains exclusive', async t => {
  const f = fixture(t);
  const root = premiumPackRoot(f.home), p = resolve(root, 'premium-personas/engineering/expert.md');
  mkdirSync(resolve(p, '..'), { recursive: true }); writeFileSync(p, '# Preserve old unsupported content\n');
  assert.equal(premiumPersonaRoot(f.home), '');
  await configurePersonaLicence(f.options);
  assert.equal((await inspectPersonaEntitlement(config, f.options)).dirty, true);
  await assert.rejects(syncPersonaPack(config, { ...f.options, confirmed: true, replaceConfirmed: true }), /local changes/);
  assert.equal(readFileSync(p, 'utf8'), '# Preserve old unsupported content\n');
  rmSync(root, { recursive: true });
  const lock = resolve(f.home, '.ewai/packs/.persona-pack.lock'); mkdirSync(lock, { recursive: true });
  await assert.rejects(syncPersonaPack(config, { ...f.options, confirmed: true }), /operation is running/);
});

test('CCE-built server-validated dual-manifest archive installs identical bytes in EWAI', async t => {
  const plugin = process.env.EWAI_CCE_PLUGIN_ROOT || resolve(import.meta.dirname, '../../ConversationalCodingEntitlements');
  if (!existsSync(resolve(plugin, 'scripts/build-persona-release.php'))) {
    t.skip('Optional joint integration needs the CCE source checkout (EWAI_CCE_PLUGIN_ROOT).'); return;
  }
  try {
    if (execFileSync('php', ['-r', 'echo class_exists("ZipArchive") ? "yes" : "no";'], { encoding: 'utf8' }) !== 'yes') {
      t.skip('Optional joint integration requires PHP ZipArchive.'); return;
    }
  } catch (e) {
    if (e.code === 'ENOENT') { t.skip('Optional joint integration requires PHP.'); return; }
    throw e;
  }
  const f = fixture(t), source = resolve(f.home, 'release-source'), output = resolve(f.home, 'release.zip');
  mkdirSync(resolve(source, 'premium-personas/engineering'), { recursive: true });
  writeFileSync(resolve(source, 'pack.yaml'), 'schema: ewai.pack/v1\nid: ewai.personas.professional\nname: EWAI Professional Persona Library\nversion: 1.0.0\ntype: persona\ncontent:\n  personas: premium-personas\ncommercial:\n  entitlement: required\nsource:\n  type: git\nupdates:\n  strategy: manifest-version\ncompatibility:\n  ewai: ">=0.1.0 <1.0.0"\nboilerplates: []\n');
  writeFileSync(resolve(source, 'premium-personas/engineering/expert.md'), packFiles[1][1]);
  const modelSelection = '# Model selection\n\nChoose a capable model for the task and validate its output.\n';
  mkdirSync(resolve(source, 'docs'), { recursive: true });
  writeFileSync(resolve(source, 'docs/model-selection.md'), modelSelection);
  // These are genuine sibling builder/validator calls with synthetic source
  // content, not a replacement implementation or production artefact.
  execFileSync('php', [resolve(plugin, 'scripts/build-persona-release.php'), source, output], { stdio: ['ignore', 'pipe', 'pipe'] });
  const code = 'require $argv[1]."/src/Domain/EntitlementException.php"; require $argv[1]."/src/Releases/ReleaseService.php"; $r=new ReflectionClass("BackstoryGroup\\\\ConversationalCodingEntitlements\\\\Releases\\\\ReleaseService"); $m=$r->getMethod("validateZip"); echo json_encode($m->invoke($r->newInstanceWithoutConstructor(),$argv[2]));';
  const validated = JSON.parse(execFileSync('php', ['-r', code, plugin, output], { encoding: 'utf8' }));
  assert.equal(validated.persona_count, 1); assert.equal(validated.collection_count, 1);
  f.state.archive = readFileSync(output);
  f.state.release = { ...f.state.release, artefact: { sha256: createHash('sha256').update(f.state.archive).digest('hex'), size: f.state.archive.length } };
  await configurePersonaLicence(f.options);
  assert.equal((await syncPersonaPack(config, { ...f.options, confirmed: true })).status, 'installed');
  assert.equal((await inspectPersonaEntitlement(config, f.options)).verified, true);
  assert.equal(readFileSync(resolve(premiumPackRoot(f.home), 'premium-personas/engineering/expert.md'), 'utf8'), packFiles[1][1]);
  assert.equal(readFileSync(resolve(premiumPackRoot(f.home), 'docs/model-selection.md'), 'utf8'), modelSelection);
});
