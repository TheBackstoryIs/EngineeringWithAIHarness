import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import { initProject } from '../src/project.mjs';
import {
  STARTER_MATERIALISATION_NOTICE,
  canonicalStarterTree,
  resolveStarterTargetMappings,
  starterPackDigest,
  starterProjectRevision,
  starterTreeDigest,
  validateStarterAdapterPackage,
} from '../src/starter-materialisation-contract.mjs';
import {
  prepareStarterMaterialisation,
  registerStarterAdapter,
  resolveAcceptedStarterReceipts,
} from '../src/runtime/starter-materialisation.mjs';

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function initialiseGit(root) {
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'tests@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'EWAI Tests'], { cwd: root });
}

function expectedStarterDigest() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-starter-expected-'));
  try {
    writeFile(resolve(root, 'index.txt'), 'governed starter\n');
    const files = canonicalStarterTree(root);
    return starterPackDigest([{ role: 'application', digest: starterTreeDigest(files) }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeBlueprint(projectRoot, digest = expectedStarterDigest(), overrides = {}) {
  const directory = resolve(projectRoot, '.ewai-pipeline/packs/northstar-starters');
  const starter = {
    id: 'service-baseline',
    name: 'Service baseline',
    source: 'https://example.invalid/service-baseline.tar.gz',
    version: '2.4.0',
    digest,
    licence: 'MIT',
    compatibility: 'EWAI 0.x',
    targets: [{ role: 'application', source_path: 'application' }],
    ...overrides,
  };
  const pack = {
    schema: 'ewai.pack/v1',
    id: 'org.northstar.starters',
    name: 'Northstar starters',
    description: 'Governed starter project material.',
    version: '1.0.0',
    type: 'organisation',
    requires: [],
    blueprint: {
      publisher: { id: 'northstar', name: 'Northstar Digital' },
      compatibility: { ewai: '0.x' },
      modules: [{
        id: 'delivery',
        name: 'Delivery',
        description: 'Delivery starter material.',
        required: true,
        standards: [],
        personas: [],
        starter_packs: [starter],
      }],
    },
  };
  writeFile(resolve(directory, 'pack.yaml'), YAML.stringify(pack, { lineWidth: 0 }));
  return { directory, pack, starter };
}

function acceptBlueprint(projectRoot, pack, topology = [{ role: 'application', repository: 'application', path: '.' }]) {
  const configPath = resolve(projectRoot, 'SPECS/pipeline.yaml');
  const config = YAML.parse(readFileSync(configPath, 'utf8'));
  const manifestBytes = readFileSync(resolve(projectRoot, '.ewai-pipeline/packs/northstar-starters/pack.yaml'));
  const packDigest = `sha256:${createHash('sha256').update(manifestBytes).update('\0').digest('hex')}`;
  const selectionDigest = `sha256:${createHash('sha256').update(JSON.stringify({
    root: pack.id,
    packs: [{ id: pack.id, version: pack.version, digest: packDigest }],
    modules: [`${pack.id}:delivery`],
  })).digest('hex')}`;
  config.blueprints = {
    organisation: {
      root: { id: pack.id, version: pack.version, digest: packDigest },
      packs: [{ id: pack.id, version: pack.version, digest: packDigest }],
      selection_digest: selectionDigest,
      enabled_modules: [],
      applied_modules: [`${pack.id}:delivery`],
      approved_by: 'Platform Owner',
      approved_at: '2026-08-22T09:00:00.000Z',
      evidence: 'SPECS/5.Strategy/organisation-blueprint.md',
    },
  };
  config.starter_materialisation = { targets: topology };
  writeFileSync(configPath, YAML.stringify(config, { lineWidth: 0 }));
}

function writeAdapter(root, options = {}) {
  const directory = resolve(root, 'adapter');
  const entrypoint = resolve(directory, 'adapter.mjs');
  const manifest = {
    schema: 'ewai.starter-source-adapter/v1',
    id: 'test.generic-source',
    name: 'Generic test source',
    publisher: { id: 'test', name: 'EWAI Test Suite' },
    version: options.version ?? '1.0.0',
    protocolVersion: '1',
    sourceClasses: ['https'],
    entrypoint: 'adapter.mjs',
  };
  writeFile(resolve(directory, 'starter-adapter.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFile(entrypoint, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const request = JSON.parse(raw);
const target = resolve(request.stagingRoot, 'application');
mkdirSync(target, { recursive: true });
writeFileSync(resolve(target, 'index.txt'), 'governed starter\\n');
process.stdout.write(JSON.stringify({ schema: 'ewai.starter-source-acknowledgement/v1', attemptId: request.attemptId, nonce: request.nonce, status: 'prepared' }));
`);
  chmodSync(entrypoint, 0o755);
  return directory;
}

test('canonicalises regular files and rejects aliases and symbolic content', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-starter-tree-'));
  try {
    writeFile(resolve(root, 'nested/a.txt'), 'alpha\n');
    writeFile(resolve(root, 'z.txt'), 'omega\n');
    const files = canonicalStarterTree(root);
    assert.deepEqual(files.map((file) => file.path), ['nested/a.txt', 'z.txt']);
    assert.match(starterTreeDigest(files), /^sha256:[a-f0-9]{64}$/);

    symlinkSync(resolve(root, 'z.txt'), resolve(root, 'link.txt'));
    assert.throws(() => canonicalStarterTree(root), /symbolic link/i);
    rmSync(resolve(root, 'link.txt'));
    linkSync(resolve(root, 'z.txt'), resolve(root, 'alias.txt'));
    assert.throws(() => canonicalStarterTree(root), /hard-link|alias/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validates and registers trusted generic adapter packages without execution', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-starter-adapter-'));
  try {
    initProject(root, { name: 'Adapter test' });
    initialiseGit(root);
    const adapterRoot = writeAdapter(root);
    const validated = validateStarterAdapterPackage(adapterRoot);
    assert.equal(validated.id, 'test.generic-source');
    assert.match(validated.packageDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(validated).includes('governed starter'), false);

    assert.throws(() => registerStarterAdapter(root, adapterRoot), /confirmation/i);
    const registered = registerStarterAdapter(root, adapterRoot, { confirmed: true });
    assert.equal(registered.id, 'test.generic-source');
    assert.match(registered.notice, /trusted local code/i);
    assert.equal(JSON.stringify(registered).includes(adapterRoot), false);

    writeFileSync(resolve(adapterRoot, 'adapter.mjs'), `${readFileSync(resolve(adapterRoot, 'adapter.mjs'), 'utf8')}\n// drift\n`);
    assert.throws(
      () => registerStarterAdapter(root, adapterRoot, { confirmed: true }),
      /same-version.*digest drift/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolves accepted starter receipts and rejects drift and credential-shaped sources', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-starter-receipt-'));
  try {
    initProject(root, { name: 'Receipt test' });
    initialiseGit(root);
    const { pack } = writeBlueprint(root);
    acceptBlueprint(root, pack);
    const [receipt] = resolveAcceptedStarterReceipts(root);
    assert.equal(receipt.id, 'org.northstar.starters:delivery:service-baseline');
    assert.deepEqual(receipt.targets, [{ role: 'application', sourcePath: 'application' }]);
    assert.match(receipt.accepted.approvedBy, /Platform Owner/);

    const manifestPath = resolve(root, '.ewai-pipeline/packs/northstar-starters/pack.yaml');
    writeFileSync(manifestPath, readFileSync(manifestPath, 'utf8').replace('example.invalid', 'user:secret@example.invalid'));
    assert.throws(() => resolveAcceptedStarterReceipts(root), /drift|credential|unsafe/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('maps logical roles across single repositories, monorepos and multi-repository workspaces', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-starter-topology-'));
  try {
    initProject(root, { name: 'Topology test' });
    initialiseGit(root);
    mkdirSync(resolve(root, 'services/api'), { recursive: true });
    mkdirSync(resolve(root, 'web'), { recursive: true });
    initialiseGit(resolve(root, 'services/api'));
    initialiseGit(resolve(root, 'web'));
    const configPath = resolve(root, 'SPECS/pipeline.yaml');
    const config = YAML.parse(readFileSync(configPath, 'utf8'));
    config.repositories = [
      { name: 'application', path: '.', role: 'workspace' },
      { name: 'api', path: 'services/api', role: 'service' },
      { name: 'web', path: 'web', role: 'client' },
    ];
    config.starter_materialisation = { targets: [
      { role: 'api', repository: 'api', path: '.' },
      { role: 'web', repository: 'web', path: 'src' },
    ] };
    writeFileSync(configPath, YAML.stringify(config, { lineWidth: 0 }));
    const receipt = { targets: [
      { role: 'api', sourcePath: 'services/api' },
      { role: 'web', sourcePath: 'clients/web' },
    ] };
    const mappings = resolveStarterTargetMappings(root, receipt);
    assert.deepEqual(mappings.map(({ role, repository, path }) => ({ role, repository, path })), [
      { role: 'api', repository: 'api', path: '.' },
      { role: 'web', repository: 'web', path: 'src' },
    ]);
    assert.equal(starterProjectRevision(mappings).repositories.length, 2);

    config.starter_materialisation.targets[1].repository = 'missing';
    writeFileSync(configPath, YAML.stringify(config, { lineWidth: 0 }));
    assert.throws(() => resolveStarterTargetMappings(root, receipt), /unknown repository/i);

    config.starter_materialisation.targets = [
      { role: 'api', repository: 'application', path: 'apps/api' },
      { role: 'web', repository: 'application', path: 'apps/web' },
    ];
    writeFileSync(configPath, YAML.stringify(config, { lineWidth: 0 }));
    assert.deepEqual(
      resolveStarterTargetMappings(root, receipt).map(({ repository, path }) => ({ repository, path })),
      [{ repository: 'application', path: 'apps/api' }, { repository: 'application', path: 'apps/web' }],
    );

    config.starter_materialisation.targets[1].path = 'apps/api/nested';
    writeFileSync(configPath, YAML.stringify(config, { lineWidth: 0 }));
    assert.throws(() => resolveStarterTargetMappings(root, receipt), /overlap/i);

    config.starter_materialisation.targets = [{ role: 'api', repository: 'application', path: 'SPECS' }];
    writeFileSync(configPath, YAML.stringify(config, { lineWidth: 0 }));
    assert.throws(
      () => resolveStarterTargetMappings(root, { targets: [{ role: 'api', sourcePath: 'services/api' }] }),
      /protected destination/i,
    );

    config.starter_materialisation.targets = [{ role: 'api', repository: 'application', path: 'apps/.GiT/generated' }];
    writeFileSync(configPath, YAML.stringify(config, { lineWidth: 0 }));
    assert.throws(
      () => resolveStarterTargetMappings(root, { targets: [{ role: 'api', sourcePath: 'services/api' }] }),
      /protected destination/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepares an independently verified staged tree without exposing runtime paths', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-starter-prepare-'));
  try {
    initProject(root, { name: 'Prepare test' });
    initialiseGit(root);
    const { pack } = writeBlueprint(root);
    acceptBlueprint(root, pack);
    const adapterRoot = writeAdapter(root);
    registerStarterAdapter(root, adapterRoot, { confirmed: true });
    const prepared = await prepareStarterMaterialisation(
      root,
      'org.northstar.starters:delivery:service-baseline',
      'test.generic-source',
      { confirmed: true, timeoutMs: 5_000 },
    );
    assert.equal(prepared.status, 'prepared');
    assert.equal(prepared.files, 1);
    assert.equal(prepared.targets[0].role, 'application');
    assert.match(prepared.treeDigest, /^sha256:[a-f0-9]{64}$/);
    assert.match(prepared.notice, /additive-only/i);
    assert.equal(JSON.stringify(prepared).includes(root), false);
    assert.equal(JSON.stringify(prepared).includes('index.txt'), false);
    assert.equal(STARTER_MATERIALISATION_NOTICE, prepared.notice);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects independently verified content whose aggregate digest differs from the accepted receipt', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-starter-mismatch-'));
  try {
    initProject(root, { name: 'Digest mismatch test' });
    initialiseGit(root);
    const { pack } = writeBlueprint(root, `sha256:${'f'.repeat(64)}`);
    acceptBlueprint(root, pack);
    const adapterRoot = writeAdapter(root);
    registerStarterAdapter(root, adapterRoot, { confirmed: true });
    await assert.rejects(
      prepareStarterMaterialisation(
        root,
        'org.northstar.starters:delivery:service-baseline',
        'test.generic-source',
        { confirmed: true, timeoutMs: 5_000 },
      ),
      /independently verified.*digest/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects reserved and trailing-dot path segments in staged content', () => {
  for (const name of ['CON.txt', 'unsafe.']) {
    const root = mkdtempSync(resolve(tmpdir(), 'ewai-starter-path-'));
    try {
      writeFile(resolve(root, name), 'unsafe\n');
      assert.throws(() => canonicalStarterTree(root), /unsafe path segment/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
