import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import { initProject } from '../src/project.mjs';
import {
  canonicalStarterTree,
  starterPackDigest,
  starterTreeDigest,
} from '../src/starter-materialisation-contract.mjs';
import { openRuntimeDatabase } from '../src/runtime/database.mjs';
import { readLifecycleHookWorkspace } from '../src/runtime/lifecycle-hooks.mjs';
import {
  applyStarterMaterialisation,
  prepareStarterMaterialisation,
  readStarterMaterialisationWorkspace,
  recoverStarterMaterialisation,
  registerStarterAdapter,
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

function aggregateDigest(files) {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-starter-application-digest-'));
  try {
    for (const [path, content] of Object.entries(files)) writeFile(resolve(root, path), content);
    const tree = canonicalStarterTree(root);
    return starterPackDigest([{ role: 'application', digest: starterTreeDigest(tree) }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function aggregateTargetDigest(targets) {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-starter-target-digest-'));
  try {
    const digests = [];
    for (const [role, files] of Object.entries(targets)) {
      const targetRoot = resolve(root, role);
      for (const [path, content] of Object.entries(files)) writeFile(resolve(targetRoot, path), content);
      digests.push({ role, digest: starterTreeDigest(canonicalStarterTree(targetRoot)) });
    }
    return starterPackDigest(digests);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function configureAcceptedPack(root, files) {
  const directory = resolve(root, '.ewai-pipeline/packs/application-starter');
  const pack = {
    schema: 'ewai.pack/v1',
    id: 'org.example.application',
    name: 'Application starter',
    description: 'Application starter used by the materialisation tests.',
    version: '1.0.0',
    type: 'organisation',
    requires: [],
    blueprint: {
      publisher: { id: 'example', name: 'Example Organisation' },
      compatibility: { ewai: '0.x' },
      modules: [{
        id: 'delivery',
        name: 'Delivery',
        description: 'Governed delivery defaults.',
        required: true,
        standards: [],
        personas: [],
        starter_packs: [{
          id: 'application',
          name: 'Application',
          source: 'https://example.invalid/application.tar.gz',
          version: '1.0.0',
          digest: aggregateDigest(files),
          licence: 'MIT',
          compatibility: 'EWAI 0.x',
          targets: [{ role: 'application', source_path: 'application' }],
        }],
      }],
    },
  };
  const manifestPath = resolve(directory, 'pack.yaml');
  writeFile(manifestPath, YAML.stringify(pack, { lineWidth: 0 }));
  const packDigest = `sha256:${createHash('sha256').update(readFileSync(manifestPath)).update('\0').digest('hex')}`;
  const selectionDigest = `sha256:${createHash('sha256').update(JSON.stringify({
    root: pack.id,
    packs: [{ id: pack.id, version: pack.version, digest: packDigest }],
    modules: [`${pack.id}:delivery`],
  })).digest('hex')}`;
  const configPath = resolve(root, 'SPECS/pipeline.yaml');
  const config = YAML.parse(readFileSync(configPath, 'utf8'));
  config.blueprints = { organisation: {
    root: { id: pack.id, version: pack.version, digest: packDigest },
    packs: [{ id: pack.id, version: pack.version, digest: packDigest }],
    selection_digest: selectionDigest,
    enabled_modules: [],
    applied_modules: [`${pack.id}:delivery`],
    approved_by: 'Platform Owner',
    approved_at: '2026-08-22T09:00:00.000Z',
    evidence: 'SPECS/5.Strategy/organisation-blueprint.md',
  } };
  config.starter_materialisation = { targets: [{ role: 'application', repository: 'application', path: '.' }] };
  writeFileSync(configPath, YAML.stringify(config, { lineWidth: 0 }));
}

function writeAdapter(root, files) {
  const directory = resolve(root, 'adapter');
  const entrypoint = resolve(directory, 'adapter.mjs');
  writeFile(resolve(directory, 'starter-adapter.json'), `${JSON.stringify({
    schema: 'ewai.starter-source-adapter/v1',
    id: 'test.application-source',
    name: 'Application source',
    publisher: { id: 'test', name: 'EWAI Test Suite' },
    version: '1.0.0',
    protocolVersion: '1',
    sourceClasses: ['https'],
    entrypoint: 'adapter.mjs',
  }, null, 2)}\n`);
  writeFile(entrypoint, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const request = JSON.parse(raw);
const files = ${JSON.stringify(files)};
for (const [path, content] of Object.entries(files)) {
  const target = resolve(request.stagingRoot, 'application', path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}
process.stdout.write(JSON.stringify({ schema: 'ewai.starter-source-acknowledgement/v1', attemptId: request.attemptId, nonce: request.nonce, status: 'prepared' }));
`);
  chmodSync(entrypoint, 0o755);
  return directory;
}

async function preparedProject(files, options = {}) {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-starter-application-'));
  initProject(root, { name: options.projectName ?? 'Application materialisation test' });
  initialiseGit(root);
  configureAcceptedPack(root, files);
  for (const [path, content] of Object.entries(options.existing ?? {})) writeFile(resolve(root, path), content);
  const adapter = writeAdapter(root, files);
  registerStarterAdapter(root, adapter, { confirmed: true });
  const preview = await prepareStarterMaterialisation(
    root,
    'org.example.application:delivery:application',
    'test.application-source',
    { confirmed: true, timeoutMs: 5_000, ...(options.prepare ?? {}) },
  );
  return { root, preview };
}

test('binds create and identical classifications into an expiring immutable preview', async () => {
  const { root, preview } = await preparedProject(
    { 'new.txt': 'new\n', 'same.txt': 'same\n' },
    { existing: { 'same.txt': 'same\n' }, prepare: { now: '2026-08-22T10:00:00.000Z' } },
  );
  try {
    assert.match(preview.previewId, /^[0-9a-f-]{36}$/);
    assert.match(preview.previewDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(preview.expiresAt, '2026-08-22T10:30:00.000Z');
    assert.deepEqual(preview.classifications, { create: 1, identical: 1, conflict: 0 });
    assert.deepEqual(preview.targets[0].classifications, { create: 1, identical: 1, conflict: 0 });
    const database = openRuntimeDatabase(root);
    const destinations = database.prepare(`
      SELECT destination_path AS path, classification
      FROM starter_files WHERE attempt_id = ? ORDER BY destination_path
    `).all(preview.attemptId);
    database.close();
    assert.deepEqual(destinations.map(({ path, classification }) => ({ path, classification })), [
      { path: 'new.txt', classification: 'create' },
      { path: 'same.txt', classification: 'identical' },
    ]);
    assert.equal(JSON.stringify(preview).includes(root), false);
    assert.equal(JSON.stringify(preview).includes('new.txt'), false);
    const workspace = readStarterMaterialisationWorkspace(root, {
      personas: [{ ref: 'ewai.core.operator', role: 'primary' }],
    });
    assert.equal(workspace.attempts[0].previewId, preview.previewId);
    assert.deepEqual(workspace.attempts[0].classifications, { create: 1, identical: 1, conflict: 0 });
    assert.equal(workspace.activePersonas[0].id, 'ewai.core.operator');
    assert.equal(JSON.stringify(workspace).includes('example.invalid'), false);
    assert.equal(JSON.stringify(workspace).includes('new.txt'), false);
    assert.equal(JSON.stringify(workspace).includes(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('applies additive files only after named approval and emits canonical evidence before lifecycle notification', async () => {
  const { root, preview } = await preparedProject(
    { 'new.txt': 'new\n', 'same.txt': 'same\n' },
    { existing: { 'same.txt': 'same\n' } },
  );
  try {
    const applied = applyStarterMaterialisation(root, preview.previewId, {
      confirmed: true,
      approvedBy: 'Delivery Owner',
      personas: [{ ref: 'ewai.core.operator', role: 'primary' }],
    });
    assert.equal(applied.status, 'completed');
    assert.deepEqual(applied.results, { created: 1, identical: 1 });
    assert.equal(readFileSync(resolve(root, 'new.txt'), 'utf8'), 'new\n');
    assert.equal(readFileSync(resolve(root, 'same.txt'), 'utf8'), 'same\n');
    assert.equal(existsSync(resolve(root, applied.evidence.json)), true);
    assert.equal(existsSync(resolve(root, applied.evidence.markdown)), true);
    const evidence = JSON.parse(readFileSync(resolve(root, applied.evidence.json), 'utf8'));
    assert.equal(evidence.approval.approvedBy, 'Delivery Owner');
    assert.equal(evidence.result.created, 1);
    const event = readLifecycleHookWorkspace(root).events.find(({ name }) => name === 'ewai.project.starter.materialised');
    assert.equal(event.facts.receiptId, 'org.example.application:delivery:application');
    assert.equal(event.personas[0].id, 'ewai.core.operator');
    assert.deepEqual(event.evidence, [applied.evidence.json, applied.evidence.markdown]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps completed materialisation truth when safe lifecycle publication fails', async () => {
  const { root, preview } = await preparedProject(
    { 'new.txt': 'new\n' },
    { projectName: 'x'.repeat(200) },
  );
  try {
    const applied = applyStarterMaterialisation(root, preview.previewId, { confirmed: true, approvedBy: 'Delivery Owner' });
    assert.equal(applied.status, 'completed');
    assert.equal(readFileSync(resolve(root, 'new.txt'), 'utf8'), 'new\n');
    assert.equal(existsSync(resolve(root, applied.evidence.json)), true);
    assert.equal(readLifecycleHookWorkspace(root).events.some(({ name }) => name === 'ewai.project.starter.materialised'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('blocks conflicts, expired previews, repository drift and staged-tree drift', async () => {
  const conflict = await preparedProject({ 'occupied.txt': 'starter\n' }, { existing: { 'occupied.txt': 'local\n' } });
  try {
    assert.equal(conflict.preview.classifications.conflict, 1);
    assert.throws(
      () => applyStarterMaterialisation(conflict.root, conflict.preview.previewId, { confirmed: true, approvedBy: 'Owner' }),
      /conflict/i,
    );
  } finally {
    rmSync(conflict.root, { recursive: true, force: true });
  }

  const expired = await preparedProject({ 'new.txt': 'new\n' }, { prepare: { now: '2026-08-22T10:00:00.000Z' } });
  try {
    assert.throws(
      () => applyStarterMaterialisation(expired.root, expired.preview.previewId, { confirmed: true, approvedBy: 'Owner', now: '2026-08-22T10:31:00.000Z' }),
      /expired/i,
    );
    const replacement = await prepareStarterMaterialisation(
      expired.root,
      'org.example.application:delivery:application',
      'test.application-source',
      { confirmed: true, timeoutMs: 5_000, now: '2026-08-22T10:31:00.000Z' },
    );
    assert.notEqual(replacement.previewId, expired.preview.previewId);
  } finally {
    rmSync(expired.root, { recursive: true, force: true });
  }

  const revision = await preparedProject({ 'new.txt': 'new\n' });
  try {
    writeFile(resolve(revision.root, 'outside.txt'), 'drift\n');
    assert.throws(
      () => applyStarterMaterialisation(revision.root, revision.preview.previewId, { confirmed: true, approvedBy: 'Owner' }),
      /revision.*drift/i,
    );
  } finally {
    rmSync(revision.root, { recursive: true, force: true });
  }

  const staged = await preparedProject({ 'new.txt': 'new\n' });
  try {
    const database = openRuntimeDatabase(staged.root);
    const row = database.prepare('SELECT staging_root FROM starter_attempts WHERE preview_id = ?').get(staged.preview.previewId);
    database.close();
    writeFileSync(resolve(row.staging_root, 'application/new.txt'), 'tampered\n');
    assert.throws(
      () => applyStarterMaterialisation(staged.root, staged.preview.previewId, { confirmed: true, approvedBy: 'Owner' }),
      /staged|tree.*drift|digest/i,
    );
  } finally {
    rmSync(staged.root, { recursive: true, force: true });
  }
});

test('rejects generated children that target protected project content', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-starter-protected-child-'));
  try {
    initProject(root, { name: 'Protected destination test' });
    initialiseGit(root);
    const files = { '.GiT/config': 'unsafe\n' };
    configureAcceptedPack(root, files);
    const adapter = writeAdapter(root, files);
    registerStarterAdapter(root, adapter, { confirmed: true });
    await assert.rejects(
      prepareStarterMaterialisation(
        root,
        'org.example.application:delivery:application',
        'test.application-source',
        { confirmed: true, timeoutMs: 5_000 },
      ),
      /protected project content/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('binds and applies one immutable preview across separate Git repositories', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-starter-multi-repository-'));
  try {
    initProject(root, { name: 'Multi repository starter test' });
    initialiseGit(root);
    mkdirSync(resolve(root, 'api'));
    mkdirSync(resolve(root, 'web'));
    initialiseGit(resolve(root, 'api'));
    initialiseGit(resolve(root, 'web'));
    const targets = { api: { 'service.txt': 'api\n' }, web: { 'client.txt': 'web\n' } };
    const directory = resolve(root, '.ewai-pipeline/packs/multi-starter');
    const pack = {
      schema: 'ewai.pack/v1',
      id: 'org.example.multi',
      name: 'Multi starter',
      description: 'Cross-repository starter.',
      version: '1.0.0',
      type: 'organisation',
      requires: [],
      blueprint: {
        publisher: { id: 'example', name: 'Example Organisation' },
        compatibility: { ewai: '0.x' },
        modules: [{
          id: 'delivery', name: 'Delivery', description: 'Delivery defaults.', required: true, standards: [], personas: [],
          starter_packs: [{
            id: 'multi', name: 'Multi', source: 'https://example.invalid/multi.tar.gz', version: '1.0.0',
            digest: aggregateTargetDigest(targets), licence: 'MIT', compatibility: 'EWAI 0.x',
            targets: [{ role: 'api', source_path: 'api' }, { role: 'web', source_path: 'web' }],
          }],
        }],
      },
    };
    const manifestPath = resolve(directory, 'pack.yaml');
    writeFile(manifestPath, YAML.stringify(pack, { lineWidth: 0 }));
    const packDigest = `sha256:${createHash('sha256').update(readFileSync(manifestPath)).update('\0').digest('hex')}`;
    const selectionDigest = `sha256:${createHash('sha256').update(JSON.stringify({
      root: pack.id,
      packs: [{ id: pack.id, version: pack.version, digest: packDigest }],
      modules: [`${pack.id}:delivery`],
    })).digest('hex')}`;
    const configPath = resolve(root, 'SPECS/pipeline.yaml');
    const config = YAML.parse(readFileSync(configPath, 'utf8'));
    config.repositories = [
      { name: 'api', path: 'api', role: 'service' },
      { name: 'web', path: 'web', role: 'client' },
    ];
    config.blueprints = { organisation: {
      root: { id: pack.id, version: pack.version, digest: packDigest },
      packs: [{ id: pack.id, version: pack.version, digest: packDigest }],
      selection_digest: selectionDigest,
      enabled_modules: [],
      applied_modules: [`${pack.id}:delivery`],
      approved_by: 'Platform Owner',
      approved_at: '2026-08-22T09:00:00.000Z',
      evidence: 'SPECS/5.Strategy/organisation-blueprint.md',
    } };
    config.starter_materialisation = { targets: [
      { role: 'api', repository: 'api', path: '.' },
      { role: 'web', repository: 'web', path: 'src' },
    ] };
    writeFileSync(configPath, YAML.stringify(config, { lineWidth: 0 }));
    const adapterDirectory = resolve(root, 'multi-adapter');
    const entrypoint = resolve(adapterDirectory, 'adapter.mjs');
    writeFile(resolve(adapterDirectory, 'starter-adapter.json'), `${JSON.stringify({
      schema: 'ewai.starter-source-adapter/v1', id: 'test.multi-source', name: 'Multi source',
      publisher: { id: 'test', name: 'EWAI Test Suite' }, version: '1.0.0', protocolVersion: '1',
      sourceClasses: ['https'], entrypoint: 'adapter.mjs',
    }, null, 2)}\n`);
    writeFile(entrypoint, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const request = JSON.parse(raw);
const targets = ${JSON.stringify(targets)};
for (const [role, files] of Object.entries(targets)) for (const [path, content] of Object.entries(files)) {
  const target = resolve(request.stagingRoot, role, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}
process.stdout.write(JSON.stringify({ schema: 'ewai.starter-source-acknowledgement/v1', attemptId: request.attemptId, nonce: request.nonce, status: 'prepared' }));
`);
    chmodSync(entrypoint, 0o755);
    registerStarterAdapter(root, adapterDirectory, { confirmed: true });
    const preview = await prepareStarterMaterialisation(
      root,
      'org.example.multi:delivery:multi',
      'test.multi-source',
      { confirmed: true, timeoutMs: 5_000 },
    );
    assert.deepEqual(preview.targets.map(({ role, repository }) => ({ role, repository })), [
      { role: 'api', repository: 'api' },
      { role: 'web', repository: 'web' },
    ]);
    const applied = applyStarterMaterialisation(root, preview.previewId, { confirmed: true, approvedBy: 'Portfolio Owner' });
    assert.equal(applied.results.created, 2);
    assert.equal(readFileSync(resolve(root, 'api/service.txt'), 'utf8'), 'api\n');
    assert.equal(readFileSync(resolve(root, 'web/src/client.txt'), 'utf8'), 'web\n');
    const evidence = JSON.parse(readFileSync(resolve(root, applied.evidence.json), 'utf8'));
    assert.deepEqual(evidence.repositories.map(({ name }) => name), ['api', 'web']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed on a racing destination and never replaces it', async () => {
  const { root, preview } = await preparedProject({ 'new.txt': 'starter\n' });
  try {
    assert.throws(
      () => applyStarterMaterialisation(root, preview.previewId, {
        confirmed: true,
        approvedBy: 'Owner',
        testHooks: { beforePublish: () => writeFile(resolve(root, 'new.txt'), 'racer\n') },
      }),
      /exist|race|exclusive/i,
    );
    assert.equal(readFileSync(resolve(root, 'new.txt'), 'utf8'), 'racer\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('preserves a changed created file and requires digest-sensitive recovery', async () => {
  const { root, preview } = await preparedProject({ 'a.txt': 'a\n', 'b.txt': 'b\n' });
  try {
    assert.throws(
      () => applyStarterMaterialisation(root, preview.previewId, {
        confirmed: true,
        approvedBy: 'Owner',
        testHooks: {
          afterPublish: ({ created }) => {
            if (created === 1) {
              writeFileSync(resolve(root, 'a.txt'), 'human edit\n');
              throw new Error('simulated interruption');
            }
          },
        },
      }),
      /recovery required/i,
    );
    assert.equal(readFileSync(resolve(root, 'a.txt'), 'utf8'), 'human edit\n');
    assert.equal(existsSync(resolve(root, 'b.txt')), false);
    const recovered = recoverStarterMaterialisation(root, preview.attemptId, { confirmed: true });
    assert.equal(recovered.status, 'recovery-required');
    assert.deepEqual(recovered.preserved, ['a.txt']);
    assert.equal(readFileSync(resolve(root, 'a.txt'), 'utf8'), 'human edit\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
