import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { initProject } from '../src/project.mjs';
import {
  buildTeamHubResourcePackage,
  teamHubResourcePackageDigest,
  validateTeamHubResourcePackage,
} from '../src/team-hub-resources.mjs';
import {
  openTeamHubDatabase,
  publishTeamHubResource,
  readTeamHubResourceCatalogue,
  readTeamHubResourcePackage,
} from '../src/runtime/team-hub-database.mjs';
import { createTeamHubHttpServer } from '../src/runtime/team-hub-server.mjs';
import {
  connectTeamHub,
  inspectConnectedTeamHubResource,
  installConnectedTeamHubResource,
  listConnectedTeamHubResources,
  listTeamHubResourceReceipts,
  readTeamHubResourceState,
} from '../src/runtime/team-hub-client.mjs';
import { runtimePaths } from '../src/runtime/paths.mjs';
import { ensureDashboard, stopDashboard } from '../src/runtime/dashboard.mjs';

test('Team Hub exposes immutable governed resource package interfaces', async () => {
  let registry;
  try {
    registry = await import('../src/team-hub-resources.mjs');
  } catch {
    assert.fail('The Team Hub resource package registry and local install interfaces do not exist.');
  }
  assert.equal(typeof registry.buildTeamHubResourcePackage, 'function');
  assert.equal(typeof registry.validateTeamHubResourcePackage, 'function');
});

function organisationPack(root, version = '1.0.0', content = '# API standard\n') {
  const folder = resolve(root, `organisation-${version}`);
  mkdirSync(resolve(folder, 'standards'), { recursive: true });
  writeFileSync(resolve(folder, 'standards/api.md'), content);
  writeFileSync(resolve(folder, 'pack.yaml'), `schema: ewai.pack/v1
id: org.acme.delivery
name: Acme delivery
description: Governed delivery defaults
version: ${version}
type: organisation
requires: []
blueprint:
  publisher:
    id: acme
    name: Acme
  compatibility:
    ewai: 0.x
  modules:
    - id: delivery
      name: Delivery
      description: Shared delivery standards
      required: true
      standards:
        - id: api
          title: API standard
          source: standards/api.md
      personas: []
      policies: []
      design_systems: []
      starter_packs: []
      boilerplates: []
`);
  return folder;
}

function designSystemPack(root) {
  const folder = resolve(root, 'design-system');
  mkdirSync(resolve(folder, 'principles'), { recursive: true });
  writeFileSync(resolve(folder, 'principles/experience.md'), '# Experience\n\nCalm and accountable.\n');
  writeFileSync(resolve(folder, 'pack.yaml'), `schema: ewai.pack/v1
id: org.acme.product-design
name: Acme product design
description: Governed visual language
version: 1.0.0
type: design-system
requires: []
design_system:
  compatibility:
    ewai: 0.x
  provenance:
    kind: owner-declared
    summary: Approved source
  contributions:
    - id: experience
      kind: principles
      title: Experience
      source: principles/experience.md
      applicability: [ui-design, prototype]
      required: true
`);
  return folder;
}

test('package creation is deterministic, bounded and tamper evident', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-resource-package-'));
  try {
    const folder = organisationPack(root);
    const first = buildTeamHubResourcePackage(folder);
    const second = buildTeamHubResourcePackage(folder);
    assert.equal(first.resource.kind, 'organisation-blueprint');
    assert.equal(first.resource.id, 'org.acme.delivery');
    assert.equal(first.digest, second.digest);
    assert.deepEqual(first.files.map(({ path }) => path), ['pack.yaml', 'standards/api.md']);
    assert.equal(first.digest, teamHubResourcePackageDigest(first));
    const designSystem = buildTeamHubResourcePackage(designSystemPack(root), { publisherName: 'Acme Design' });
    assert.equal(designSystem.resource.kind, 'design-system');
    assert.deepEqual(designSystem.files.map(({ path }) => path), ['pack.yaml', 'principles/experience.md']);
    const tampered = structuredClone(first);
    tampered.files[1].content = '# changed\n';
    assert.throws(() => validateTeamHubResourcePackage(tampered), /size|digest/i);
    const mislabelled = structuredClone(first);
    mislabelled.resource.version = '2.0.0';
    mislabelled.digest = teamHubResourcePackageDigest(mislabelled);
    assert.throws(() => validateTeamHubResourcePackage(mislabelled), /version disagrees/i);
    const excessiveFiles = structuredClone(first);
    excessiveFiles.files = Array.from({ length: 101 }, (_, index) => ({ ...first.files[1], path: `standards/api-${index}.md` }));
    excessiveFiles.digest = teamHubResourcePackageDigest(excessiveFiles);
    assert.throws(() => validateTeamHubResourcePackage(excessiveFiles), /100|too big/i);
    rmSync(resolve(folder, 'standards/api.md'));
    symlinkSync(resolve(root, 'outside.md'), resolve(folder, 'standards/api.md'));
    writeFileSync(resolve(root, 'outside.md'), '# Outside\n');
    assert.throws(() => buildTeamHubResourcePackage(folder), /symbolic link/i);
    assert.throws(() => buildTeamHubResourcePackage(resolve(root, 'missing')), /existing pack folder/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('publication can stay disabled while authenticated discovery remains available', async () => {
  const dataRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-resource-disabled-'));
  const readerToken = 'reader-token-for-disabled-publishing';
  const running = await createTeamHubHttpServer({ dataRoot, token: readerToken, host: '127.0.0.1', port: 0 });
  try {
    const health = await fetch(`${running.url}/health`).then((response) => response.json());
    assert.equal(health.publisherConfigured, false);
    const disabled = await fetch(`${running.url}/api/v1/resources`, { method: 'POST', headers: { authorization: `Bearer ${readerToken}`, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(disabled.status, 503);
    const catalogue = await fetch(`${running.url}/api/v1/resources`, { headers: { authorization: `Bearer ${readerToken}` } });
    assert.equal(catalogue.status, 200);
    assert.equal((await catalogue.json()).releases.length, 0);
    const unexpectedQuery = await fetch(`${running.url}/api/v1/resources?latest=true`, { headers: { authorization: `Bearer ${readerToken}` } });
    assert.equal(unexpectedQuery.status, 400);
  } finally {
    await running.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('local installation refuses a resource identity owned outside Team Hub management', async () => {
  const sourceRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-resource-collision-source-'));
  const projectRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-resource-collision-project-'));
  const resourcePackage = buildTeamHubResourcePackage(organisationPack(sourceRoot));
  initProject(projectRoot, { name: 'Collision client' });
  const outsidePack = organisationPack(resolve(projectRoot, '.ewai-pipeline/packs'));
  connectTeamHub(projectRoot, {
    endpoint: 'http://127.0.0.1:49001', projectId: 'collision-client', tokenEnv: 'EWAI_TEAM_HUB_COLLISION_TOKEN',
    confirmed: true, disclosureAcknowledged: true,
  });
  try {
    await assert.rejects(installConnectedTeamHubResource(projectRoot, {
      id: 'org.acme.delivery', version: '1.0.0', expectedDigest: resourcePackage.digest,
      approvedBy: 'Collision Owner', confirmed: true,
    }, {
      env: { EWAI_TEAM_HUB_COLLISION_TOKEN: 'collision-reader-token-value' },
      fetch: async () => new Response(JSON.stringify(resourcePackage), { status: 200, headers: { 'content-type': 'application/json' } }),
    }), /collides with a pack outside Team Hub management/i);
    assert.equal(existsSync(resolve(outsidePack, 'pack.yaml')), true);
    assert.equal(existsSync(resolve(runtimePaths(projectRoot).teamHubManagedPackRoot, 'org.acme.delivery')), false);
  } finally {
    rmSync(sourceRoot, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('local installation refuses a symbolic managed cache before reading or writing through it', async () => {
  const projectRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-resource-symlink-project-'));
  const outsideRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-resource-symlink-outside-'));
  initProject(projectRoot, { name: 'Symbolic cache client' });
  const paths = runtimePaths(projectRoot);
  mkdirSync(resolve(paths.teamHubResourceCacheRoot, '..'), { recursive: true });
  symlinkSync(outsideRoot, paths.teamHubResourceCacheRoot);
  try {
    await assert.rejects(installConnectedTeamHubResource(projectRoot, {
      id: 'org.acme.delivery', version: '1.0.0', expectedDigest: `sha256:${'a'.repeat(64)}`,
      approvedBy: 'Security Owner', confirmed: true,
    }), /may not traverse symbolic/i);
    assert.deepEqual(readdirSync(outsideRoot), []);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('central resource ledger replays exact publication and rejects mutable identity', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-resource-ledger-'));
  const packRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-resource-source-'));
  const database = openTeamHubDatabase(root);
  try {
    const firstPackage = buildTeamHubResourcePackage(organisationPack(packRoot));
    const first = publishTeamHubResource(database, firstPackage, { receiptId: 'publication-one', at: '2026-08-29T12:00:00.000Z' });
    const replay = publishTeamHubResource(database, firstPackage, { receiptId: 'ignored', at: '2026-08-29T12:01:00.000Z' });
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(readTeamHubResourceCatalogue(database).releases.length, 1);
    assert.equal(readTeamHubResourcePackage(database, 'org.acme.delivery', '1.0.0').digest, firstPackage.digest);

    writeFileSync(resolve(packRoot, 'organisation-1.0.0/standards/api.md'), '# materially changed\n');
    const changed = buildTeamHubResourcePackage(resolve(packRoot, 'organisation-1.0.0'));
    assert.throws(() => publishTeamHubResource(database, changed), (error) => error.code === 'resource-release-conflict' && error.status === 409);
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(packRoot, { recursive: true, force: true });
  }
});

test('separate credentials protect publication and exact local install remains separate from apply', async () => {
  const dataRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-resource-http-'));
  const sourceRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-resource-pack-'));
  const projectRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-resource-project-'));
  const readerToken = 'reader-token-with-enough-test-entropy';
  const publisherToken = 'publisher-token-with-enough-test-entropy';
  const resourcePackage = buildTeamHubResourcePackage(organisationPack(sourceRoot));
  initProject(projectRoot, { name: 'Resource client' });
  const running = await createTeamHubHttpServer({ dataRoot, token: readerToken, publisherToken, host: '127.0.0.1', port: 0 });
  let runningClosed = false;
  try {
    const unauthenticated = await fetch(`${running.url}/api/v1/resources`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(resourcePackage) });
    assert.equal(unauthenticated.status, 401);
    const readerPublish = await fetch(`${running.url}/api/v1/resources`, { method: 'POST', headers: { authorization: `Bearer ${readerToken}`, 'content-type': 'application/json' }, body: JSON.stringify(resourcePackage) });
    assert.equal(readerPublish.status, 401);
    const published = await fetch(`${running.url}/api/v1/resources`, { method: 'POST', headers: { authorization: `Bearer ${publisherToken}`, 'content-type': 'application/json' }, body: JSON.stringify(resourcePackage) });
    assert.equal(published.status, 202);

    const env = { EWAI_TEAM_HUB_RESOURCE_READER: readerToken };
    connectTeamHub(projectRoot, {
      endpoint: running.url,
      projectId: 'resource-client',
      tokenEnv: 'EWAI_TEAM_HUB_RESOURCE_READER',
      confirmed: true,
      disclosureAcknowledged: true,
    });
    const catalogue = await listConnectedTeamHubResources(projectRoot, { env });
    assert.equal(catalogue.releases[0].digest, resourcePackage.digest);
    assert.equal(catalogue.releases[0].fileCount, resourcePackage.files.length);
    assert.equal(catalogue.releases[0].files, undefined);
    const inspected = await inspectConnectedTeamHubResource(projectRoot, 'org.acme.delivery', '1.0.0', { env });
    assert.equal(inspected.digest, resourcePackage.digest);
    assert.equal(readTeamHubResourceState(projectRoot).installed.length, 0);

    const installed = await installConnectedTeamHubResource(projectRoot, {
      id: 'org.acme.delivery', version: '1.0.0', expectedDigest: resourcePackage.digest,
      approvedBy: 'Test Maintainer', confirmed: true, at: '2026-08-29T12:05:00.000Z',
    }, { env });
    assert.equal(installed.receipt.action, 'installed');
    assert.equal(installed.receipt.authority.includes('did not select or apply'), true);
    assert.equal(existsSync(resolve(runtimePaths(projectRoot).teamHubManagedPackRoot, 'org.acme.delivery/pack.yaml')), true);
    assert.equal(existsSync(resolve(projectRoot, 'SPECS/5.Strategy/design-system.md')), false);
    const persisted = readFileSync(runtimePaths(projectRoot).teamHubResourceInstalledPath, 'utf8');
    assert.equal(persisted.includes(readerToken), false);

    const replay = await installConnectedTeamHubResource(projectRoot, {
      id: 'org.acme.delivery', version: '1.0.0', expectedDigest: resourcePackage.digest,
      approvedBy: 'Test Maintainer', confirmed: true,
    }, { env: {} });
    assert.equal(replay.replayed, true);

    const secondPackage = buildTeamHubResourcePackage(organisationPack(sourceRoot, '2.0.0', '# API standard v2\n'));
    const secondPublication = await fetch(`${running.url}/api/v1/resources`, { method: 'POST', headers: { authorization: `Bearer ${publisherToken}`, 'content-type': 'application/json' }, body: JSON.stringify(secondPackage) });
    assert.equal(secondPublication.status, 202);
    const updated = await installConnectedTeamHubResource(projectRoot, {
      id: 'org.acme.delivery', version: '2.0.0', expectedDigest: secondPackage.digest,
      approvedBy: 'Test Maintainer', confirmed: true,
    }, { env });
    assert.equal(updated.receipt.action, 'updated');

    await running.close();
    runningClosed = true;
    const restored = await installConnectedTeamHubResource(projectRoot, {
      id: 'org.acme.delivery', version: '1.0.0', expectedDigest: resourcePackage.digest,
      approvedBy: 'Recovery Owner', confirmed: true,
    }, { env: {} });
    assert.equal(restored.receipt.action, 'restored');
    const updatedOffline = await installConnectedTeamHubResource(projectRoot, {
      id: 'org.acme.delivery', version: '2.0.0', expectedDigest: secondPackage.digest,
      approvedBy: 'Recovery Owner', confirmed: true,
    }, { env: {} });
    assert.equal(updatedOffline.receipt.action, 'updated');

    const receiptsBeforeFailure = listTeamHubResourceReceipts(projectRoot).length;
    await assert.rejects(installConnectedTeamHubResource(projectRoot, {
      id: 'org.acme.delivery', version: '1.0.0', expectedDigest: resourcePackage.digest,
      approvedBy: 'Recovery Owner', confirmed: true,
    }, { env: {}, afterPromotion: () => { throw new Error('injected promotion failure'); } }), /injected promotion failure/);
    assert.equal(readTeamHubResourceState(projectRoot).installed[0].version, '2.0.0');
    assert.equal(readFileSync(resolve(runtimePaths(projectRoot).teamHubManagedPackRoot, 'org.acme.delivery/standards/api.md'), 'utf8'), '# API standard v2\n');
    assert.equal(listTeamHubResourceReceipts(projectRoot).length, receiptsBeforeFailure);
  } finally {
    if (!runningClosed) await running.close();
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(sourceRoot, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('local dashboard keeps registry access server-owned and installation same-origin', async () => {
  const dataRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-resource-dashboard-data-'));
  const sourceRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-resource-dashboard-pack-'));
  const projectRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-resource-dashboard-project-'));
  const readerToken = 'dashboard-reader-token-with-enough-entropy';
  const publisherToken = 'dashboard-publisher-token-with-enough-entropy';
  const tokenEnv = 'EWAI_TEAM_HUB_RESOURCE_DASHBOARD';
  const resourcePackage = buildTeamHubResourcePackage(organisationPack(sourceRoot));
  initProject(projectRoot, { name: 'Dashboard resource client' });
  const hub = await createTeamHubHttpServer({ dataRoot, token: readerToken, publisherToken, host: '127.0.0.1', port: 0 });
  process.env[tokenEnv] = readerToken;
  let dashboard;
  try {
    assert.equal((await fetch(`${hub.url}/api/v1/resources`, { method: 'POST', headers: { authorization: `Bearer ${publisherToken}`, 'content-type': 'application/json' }, body: JSON.stringify(resourcePackage) })).status, 202);
    connectTeamHub(projectRoot, { endpoint: hub.url, projectId: 'dashboard-resource-client', tokenEnv, confirmed: true, disclosureAcknowledged: true });
    dashboard = await ensureDashboard(projectRoot);
    const catalogue = await fetch(`${dashboard.url}/api/team-hub/resources`).then((response) => response.json());
    assert.equal(catalogue.releases[0].digest, resourcePackage.digest);
    const inspectionResponse = await fetch(`${dashboard.url}/api/team-hub/resources/org.acme.delivery/releases/1.0.0`);
    assert.equal(inspectionResponse.status, 200);
    const wrongOrigin = await fetch(`${dashboard.url}/api/team-hub/resources/install`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://example.invalid' },
      body: JSON.stringify({ id: 'org.acme.delivery', version: '1.0.0', expectedDigest: resourcePackage.digest, approvedBy: 'Dashboard Owner', confirmed: true }),
    });
    assert.equal(wrongOrigin.status, 403);
    const installed = await fetch(`${dashboard.url}/api/team-hub/resources/install`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: dashboard.url },
      body: JSON.stringify({ id: 'org.acme.delivery', version: '1.0.0', expectedDigest: resourcePackage.digest, approvedBy: 'Dashboard Owner', confirmed: true }),
    });
    assert.equal(installed.status, 200);
    const receipts = await fetch(`${dashboard.url}/api/team-hub/resource-receipts`).then((response) => response.json());
    assert.equal(receipts.receipts.length, 1);
    assert.equal(JSON.stringify(receipts).includes(readerToken), false);
  } finally {
    if (dashboard) await stopDashboard(projectRoot);
    await hub.close();
    delete process.env[tokenEnv];
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(sourceRoot, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
