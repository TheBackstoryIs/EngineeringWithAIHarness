import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import * as checkin from '../src/checkin.mjs';
import { initProject, loadProjectConfig } from '../src/project.mjs';
import YAML from 'yaml';
import { readPersonaLicence } from '../src/persona-licence-config.mjs';
import { listPersonas, personalPersonaRoot } from '../src/personas.mjs';
import { companionOpening } from '../src/companion-opening.mjs';
import { ensureDashboard, stopDashboard } from '../src/runtime/dashboard.mjs';

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-premium-setup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = resolve(root, 'project'), home = resolve(root, 'home'), pack = resolve(root, 'pack');
  mkdirSync(project); mkdirSync(home); initProject(project); mkdirSync(resolve(pack, 'premium-personas/engineering'), { recursive: true });
  writeFileSync(resolve(pack, 'pack.yaml'), 'schema: ewai.persona-pack/v1\nid: ewai.personas.professional\nversion: 1.2.3\ncontent:\n  personas: premium-personas\n');
  writeFileSync(resolve(pack, 'premium-personas/engineering/expert.md'), '---\nname: Synthetic Expert\nid: ewai.premium.synthetic-expert\ndescription: A synthetic test persona\ntier: premium\ncategory: engineering\n---\n# Expert\nA synthetic test persona.\n');
  writeFileSync(resolve(pack, 'manifest.json'), JSON.stringify({ schema: 'ewai.persona-pack/v1', id: 'ewai.personas.professional', version: '1.2.3', persona_count: 1, collection_count: 1 }));
  const zipPath = resolve(root, 'pack.zip'); execFileSync('zip', ['-qr', zipPath, '.'], { cwd: pack });
  const archive = readFileSync(zipPath), digest = createHash('sha256').update(archive).digest('hex');
  const release = { schema: 'ewai.persona-pack/v1', id: 'ewai.personas.professional', version: '1.2.3', artefact: { sha256: digest, size: archive.length } };
  const subscription = { id: 'sub-synthetic', plan_type: 'team', status: 'active', ends_at: '2099-01-01T00:00:00Z' };
  const state = { calls: [], origins: [], fail: null, archive };
  const fetchImpl = async (url, options = {}) => {
    state.calls.push(new URL(url).pathname);
    state.origins.push(new URL(url).origin);
    if (state.fail) return state.fail(url, options);
    const path = new URL(url).pathname;
    if (path.endsWith('/activations')) return Response.json({ schema: 'cce.activation/v1', activation_id: 'activation-synthetic', activation_token: 'private-synthetic-token-012345', seat_id: 'seat-synthetic', subscription });
    if (path.endsWith('/status')) return Response.json({ schema: 'cce.entitlement-status/v1', access: 'available', activation: { id: 'activation-synthetic' }, seat: { id: 'seat-synthetic' }, subscription, release });
    if (path.endsWith('/download-grants')) return Response.json({ schema: 'cce.download-grant/v1', download_url: new URL(url).origin + '/?cce-download=synthetic-grant', expires_at: '2099-01-01T00:00:00Z', release });
    if (new URL(url).searchParams.has('cce-download')) return new Response(state.archive);
    throw Error('Unexpected synthetic request');
  };
  return { root, project, home, state, options: { home, fetchImpl, confirmed: true, licenceKey: 'SYNTHETIC-PRIVATE-KEY', machineName: 'Test machine' } };
}

test('setup action is permanent and distinct from learning', () => {
  assert.equal(companionOpening().actions.find(action => action.id === 8)?.label, 'Set up premium personas');
  assert.match(companionOpening().actions.find(action => action.id === 8)?.command ?? '', /persona premium configure/);
});

test('explicit key submission installs verified personas immediately and preserves authored content', async t => {
  const f = fixture(t);
  mkdirSync(personalPersonaRoot(f.home), { recursive: true });
  const authored = resolve(personalPersonaRoot(f.home), 'mine.md'); writeFileSync(authored, '# My own persona');
  assert.equal(typeof checkin.configureAndInstallPremiumPersonas, 'function');
  const result = await checkin.configureAndInstallPremiumPersonas(f.project, f.options);
  assert.equal(result.status, 'ready'); assert.equal(result.installed, true); assert.equal(result.verified, true);
  assert.equal(result.version, '1.2.3'); assert.equal(result.personaCount, 1);
  assert.equal(listPersonas([checkin.premiumPersonaRoot(f.home)]).length, 1);
  assert.ok(f.state.calls.some(path => path.endsWith('/download-grants')));
  assert.equal(readPersonaLicence(f.home).licenceKey, f.options.licenceKey);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC-PRIVATE|private-synthetic|synthetic-grant/);
  assert.equal(readFileSync(authored, 'utf8'), '# My own persona');
});

test('setup requires consent and invalid licence or machine cap never claim success', async t => {
  const f = fixture(t); assert.equal(typeof checkin.configureAndInstallPremiumPersonas, 'function');
  await assert.rejects(checkin.configureAndInstallPremiumPersonas(f.project, { ...f.options, confirmed: false }), /confirmation/);
  assert.equal(f.state.calls.length, 0);
  for (const code of ['invalid_licence_key', 'installation_limit_reached']) {
    f.state.fail = () => Response.json({ code, message: 'UNSAFE ' + f.options.licenceKey }, { status: 401 });
    const result = await checkin.configureAndInstallPremiumPersonas(f.project, f.options);
    assert.equal(result.status, 'failed'); assert.equal(result.stage, 'activation'); assert.equal(result.verified, false);
    assert.doesNotMatch(JSON.stringify(result), /UNSAFE|SYNTHETIC-PRIVATE/);
  }
  assert.equal(readPersonaLicence(f.home), null);
});

test('setup keeps activation, download and verification on the configured or saved origin', async t => {
  const f = fixture(t), server = 'https://personas.example';
  const { config, paths } = loadProjectConfig(f.project);
  config.personas.premium.server = server;
  writeFileSync(paths.configPath, YAML.stringify(config));
  const result = await checkin.configureAndInstallPremiumPersonas(f.project, f.options);
  assert.equal(result.status, 'ready');
  assert.ok(f.state.origins.length >= 4);
  assert.deepEqual([...new Set(f.state.origins)], [server]);
  assert.equal(readPersonaLicence(f.home).server, server);
  f.state.calls.length = 0;
  const mismatch = await checkin.configureAndInstallPremiumPersonas(f.project, { ...f.options, server: 'https://other.example' });
  assert.equal(mismatch.status, 'failed');
  assert.equal(f.state.calls.length, 0, 'mismatched explicit origin must never receive the key');
  delete config.personas.premium.server;
  writeFileSync(paths.configPath, YAML.stringify(config));
  f.state.origins.length = 0;
  assert.equal((await checkin.configureAndInstallPremiumPersonas(f.project, f.options)).status, 'ready');
  assert.deepEqual([...new Set(f.state.origins)], [server]);
});

test('explicit approved setup origin is retained when the project has no server override', async t => {
  const f = fixture(t), server = 'https://approved-personas.example';
  assert.equal((await checkin.configureAndInstallPremiumPersonas(f.project, { ...f.options, server })).status, 'ready');
  assert.deepEqual([...new Set(f.state.origins)], [server]);
});

test('damaged download never reports readiness or removes authored personas', async t => {
  const f = fixture(t); assert.equal(typeof checkin.configureAndInstallPremiumPersonas, 'function');
  f.state.archive = Buffer.from('not a valid ZIP');
  const result = await checkin.configureAndInstallPremiumPersonas(f.project, f.options);
  assert.equal(result.status, 'failed'); assert.equal(result.stage, 'download'); assert.equal(result.installed, false);
  assert.equal(existsSync(checkin.premiumPersonaRoot(f.home)), false);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC-PRIVATE|synthetic-grant/);
});

test('dashboard setup route denies unsafe requests before licence activation', async t => {
  const f = fixture(t);
  const dashboard = await ensureDashboard(f.project, { home: f.home, checkPremium: false });
  t.after(() => stopDashboard(f.project));
  const url = dashboard.url + '/api/personas/premium/setup';
  const body = JSON.stringify({ licenceKey: 'SYNTHETIC-PRIVATE-KEY', confirmed: false });
  for (const options of [
    { headers: { 'content-type': 'application/json', origin: 'https://external.example' }, body, expected: 403 },
    { headers: { 'content-type': 'text/plain', origin: dashboard.url }, body, expected: 415 },
    { headers: { 'content-type': 'application/json', origin: dashboard.url }, body, expected: 400 },
    { headers: { 'content-type': 'application/json', origin: dashboard.url }, body: JSON.stringify({ confirmed: true, licenceKey: '', home: '/untrusted' }), expected: 400 }
  ]) {
    const response = await fetch(url, { method: 'POST', headers: options.headers, body: options.body });
    assert.equal(response.status, options.expected);
    assert.doesNotMatch(await response.text(), /SYNTHETIC-PRIVATE|untrusted/);
  }
});

test('actual dashboard accepts ordinary keys and rejects controls before the provider', async t => {
  const f = fixture(t), callsPath = resolve(f.root, 'provider-calls.txt');
  const reservation = createServer();
  await new Promise(resolveListen => reservation.listen(0, '127.0.0.1', resolveListen));
  const port = reservation.address().port;
  await new Promise(resolveClose => reservation.close(resolveClose));
  const preload = `import {appendFileSync} from 'node:fs'; globalThis.fetch = async (url) => { if (new URL(url).origin !== 'https://www.conversationalcoding.dev') throw Error('Unexpected test origin'); appendFileSync(${JSON.stringify(callsPath)}, 'activation\\n'); return Response.json({code:'invalid_licence_key'}, {status:401}); };`;
  const child = spawn(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(preload), resolve(import.meta.dirname, '../src/runtime/dashboard-server.mjs'), '--project', f.project, '--port', String(port)], { env: { ...process.env, HOME: f.home }, stdio: 'ignore' });
  t.after(async () => { child.kill('SIGTERM'); await new Promise(resolveExit => child.exitCode !== null ? resolveExit() : child.once('exit', resolveExit)); });
  const origin = `http://127.0.0.1:${port}`;
  let healthy = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { healthy = (await fetch(origin + '/api/health')).ok; } catch {}
    if (healthy) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  assert.equal(healthy, true);
  for (const licenceKey of ['SYNTHETIC-PRIVATE-KEY', 'abcdef123456']) {
    const response = await fetch(origin + '/api/personas/premium/setup', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ licenceKey, confirmed: true }) });
    const result = await response.json();
    assert.equal(response.status, 400);
    assert.equal(result.stage, 'activation', 'ordinary keys must reach the synthetic provider, not fail the route validator');
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC-PRIVATE|abcdef123456/);
  }
  assert.equal(readFileSync(callsPath, 'utf8').trim().split('\n').length, 2);
  const denied = await fetch(origin + '/api/personas/premium/setup', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ licenceKey: 'abc\u0001def', confirmed: true }) });
  assert.equal(denied.status, 400);
  assert.equal((await denied.json()).stage, undefined);
  assert.equal(readFileSync(callsPath, 'utf8').trim().split('\n').length, 2);
});

test('CLI setup retains explicit server selection and nonzero failure reporting', () => {
  const cli = readFileSync(resolve(import.meta.dirname, '../src/cli.mjs'), 'utf8');
  const branch = cli.slice(cli.indexOf("if (command === 'persona' && subcommand === 'premium' && args[2] === 'configure')"), cli.indexOf("if (command === 'persona' && subcommand === 'premium' && args[2] === 'sync')"));
  assert.match(branch, /server: option\(args, '--server'\)/);
  assert.match(branch, /server: option\(args, '--server'\) \|\| undefined/);
  assert.match(branch, /if \(result.status !== 'ready'\) process.exitCode = 1/);
});

test('real dashboard HTTP setup installs a verified synthetic ZIP with unchanged protected host config', async t => {
  const f = fixture(t);
  const authored = resolve(personalPersonaRoot(f.home), 'mine.md');
  mkdirSync(personalPersonaRoot(f.home), { recursive: true });
  writeFileSync(authored, '# Our own persona');
  chmodSync(resolve(f.project, '.codex/config.toml'), 0o444);
  const reservation = createServer();
  await new Promise(done => reservation.listen(0, '127.0.0.1', done));
  const port = reservation.address().port;
  await new Promise(done => reservation.close(done));
  const release = { schema: 'ewai.persona-pack/v1', id: 'ewai.personas.professional', version: '1.2.3', artefact: { sha256: createHash('sha256').update(f.state.archive).digest('hex'), size: f.state.archive.length } };
  const subscription = { id: 'sub-synthetic', plan_type: 'team', status: 'active', ends_at: '2099-01-01T00:00:00Z' };
  const preload = `import {readFileSync} from 'node:fs'; const release=${JSON.stringify(release)},subscription=${JSON.stringify(subscription)};globalThis.fetch=async url=>{const u=new URL(url);if(u.origin!=='https://www.conversationalcoding.dev')throw Error('Unexpected synthetic origin');if(u.pathname.endsWith('/activations'))return Response.json({schema:'cce.activation/v1',activation_id:'activation-synthetic',activation_token:'private-synthetic-token-012345',seat_id:'seat-synthetic',subscription});if(u.pathname.endsWith('/status'))return Response.json({schema:'cce.entitlement-status/v1',access:'available',activation:{id:'activation-synthetic'},seat:{id:'seat-synthetic'},subscription,release});if(u.pathname.endsWith('/download-grants'))return Response.json({schema:'cce.download-grant/v1',download_url:u.origin+'/?cce-download=synthetic-grant',expires_at:'2099-01-01T00:00:00Z',release});if(u.searchParams.has('cce-download'))return new Response(readFileSync(${JSON.stringify(resolve(f.root,'pack.zip'))}));throw Error('Unexpected synthetic request');};`;
  const child = spawn(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(preload), resolve(import.meta.dirname, '../src/runtime/dashboard-server.mjs'), '--project', f.project, '--port', String(port)], { env: { ...process.env, HOME: f.home }, stdio: 'ignore' });
  t.after(async () => { child.kill('SIGTERM'); await new Promise(done => child.exitCode !== null || child.signalCode !== null ? done() : child.once('exit', done)); });
  const origin = 'http://127.0.0.1:' + port;
  let healthy = false;
  for (let i = 0; i < 50; i++) {
    try { healthy = (await fetch(origin + '/api/health')).ok; } catch {}
    if (healthy) break;
    await new Promise(done => setTimeout(done, 100));
  }
  assert.equal(healthy, true);
  const response = await fetch(origin + '/api/personas/premium/setup', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ licenceKey: 'SYNTHETIC-PRIVATE-KEY', confirmed: true }) });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.status, 'ready'); assert.equal(result.installed, true); assert.equal(result.verified, true);
  assert.equal(result.version, '1.2.3'); assert.equal(result.personaCount, 1);
  assert.equal(listPersonas([checkin.premiumPersonaRoot(f.home)]).length, 1);
  assert.equal(readFileSync(authored, 'utf8'), '# Our own persona');
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC-PRIVATE|private-synthetic|synthetic-grant/);
  const catalogue = await fetch(origin + '/api/personas').then(r => r.json());
  assert.ok(catalogue.personas.some(p => p.name === 'Synthetic Expert'));
});
