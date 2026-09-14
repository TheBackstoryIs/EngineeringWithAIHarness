import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  STARTER_ADAPTER_TRUST_NOTICE,
  STARTER_MATERIALISATION_NOTICE,
  canonicalStarterTree,
  classifyStarterSource,
  resolveStarterTargetMappings,
  starterPackDigest,
  starterProjectRevision,
  starterTreeDigest,
  validateStarterAdapterPackage,
} from '../starter-materialisation-contract.mjs';
import {
  listOrganisationBlueprints,
  resolveOrganisationBlueprint,
} from '../organisation-blueprints.mjs';
import { loadProjectConfig } from '../project.mjs';
import { openRuntimeDatabase } from './database.mjs';
import { publishLifecycleEventSafely, resolveLifecyclePersonas } from './lifecycle-hooks.mjs';
import { runtimePaths } from './paths.mjs';

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const rolePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const activeAttemptStates = ['preparing', 'prepared', 'applying', 'recovery-required'];
const previewLifetimeMs = 30 * 60 * 1_000;
const protectedRoots = new Set(['.git', '.ewai-pipeline', '.codex', '.claude', '.agents']);
const protectedFiles = new Set(['agents.md', 'claude.md', '.mcp.json', '.env', '.npmrc', '.netrc']);
const defaultLimits = Object.freeze({
  maximumDepth: 24,
  maximumPathBytes: 512,
  maximumFiles: 5_000,
  maximumFileBytes: 5 * 1024 * 1024,
  maximumTotalBytes: 100 * 1024 * 1024,
  timeoutMs: 5 * 60 * 1_000,
  maximumOutputBytes: 64 * 1024,
});

function now(options = {}) {
  const value = typeof options.now === 'function' ? options.now() : options.now;
  return new Date(value ?? Date.now()).toISOString();
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function within(root, candidate) {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function snapshotMappings(mappings) {
  return mappings.map(({ role, repository, repositoryRole, repositoryPath, path, sourcePath }) => ({
    role,
    repository,
    repositoryRole,
    repositoryPath,
    path,
    sourcePath,
  }));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function protectedDestination(path, specsPath, repositoryPath) {
  const normalised = String(path).replaceAll('\\', '/').normalize('NFC');
  const segments = normalised.split('/').map((segment) => segment.toLocaleLowerCase('en-US'));
  if (segments.some((segment) => protectedRoots.has(segment)) || protectedFiles.has(segments.at(-1))) return true;
  const destination = resolve(repositoryPath, normalised);
  return destination === specsPath || within(specsPath, destination);
}

function assertBoundedDestination(projectRoot, mapping, destinationPath) {
  const { paths } = loadProjectConfig(projectRoot);
  const repositoryRoot = realpathSync(mapping.repositoryRoot);
  const destination = resolve(repositoryRoot, destinationPath);
  if (!within(repositoryRoot, destination)) throw new Error(`Starter destination escapes repository ${mapping.repository}: ${destinationPath}`);
  const specsRoot = existsSync(paths.specsRoot) ? realpathSync(paths.specsRoot) : resolve(paths.specsRoot);
  if (protectedDestination(destinationPath, specsRoot, repositoryRoot)) {
    throw new Error(`Starter destination resolves into protected project content: ${destinationPath}`);
  }
  let cursor = repositoryRoot;
  for (const segment of destinationPath.split('/')) {
    const parent = cursor;
    cursor = resolve(cursor, segment);
    if (!within(repositoryRoot, cursor)) throw new Error(`Starter destination escapes repository ${mapping.repository}: ${destinationPath}`);
    if (!existsSync(cursor)) continue;
    const metadata = lstatSync(cursor);
    if (metadata.isSymbolicLink()) throw new Error(`Starter destination may not traverse a symbolic link: ${destinationPath}`);
    const equivalent = readdirSync(parent).find((name) => name.normalize('NFC').toLocaleLowerCase('en-US') === segment.normalize('NFC').toLocaleLowerCase('en-US'));
    if (equivalent && equivalent !== segment) throw new Error(`Starter destination has a case or Unicode-equivalent collision: ${destinationPath}`);
  }
  return destination;
}

function regularFileDigest(path) {
  if (!existsSync(path)) return null;
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) return null;
  return sha256(readFileSync(path));
}

function classifyDestinations(projectRoot, mappings, files) {
  return files.map((file) => {
    const mapping = mappings.find((candidate) => candidate.role === file.target_role);
    if (!mapping) throw new Error(`Starter target mapping disappeared: ${file.target_role}`);
    const destination = assertBoundedDestination(projectRoot, mapping, file.destination_path);
    let classification = 'create';
    if (existsSync(destination)) classification = regularFileDigest(destination) === file.content_digest ? 'identical' : 'conflict';
    return { ...file, destination, classification };
  });
}

function classificationCounts(files) {
  return files.reduce((counts, file) => {
    counts[file.classification] += 1;
    return counts;
  }, { create: 0, identical: 0, conflict: 0 });
}

function previewBinding({ previewId, attemptId, receipt, adapter, mappings, repositoryRevisions, treeDigest, targetTreeDigests, files, expiresAt }) {
  return {
    schema: 'ewai.starter-materialisation-preview-binding/v1',
    previewId,
    attemptId,
    receipt,
    adapter,
    mappings: snapshotMappings(mappings),
    repositoryRevisions,
    treeDigest,
    targetTreeDigests,
    destinations: files.map(({ target_role, repository_name, destination_path, content_digest, size_bytes, classification }) => ({
      targetRole: target_role,
      repository: repository_name,
      path: destination_path,
      digest: content_digest,
      bytes: size_bytes,
      classification,
    })),
    expiresAt,
  };
}

function strictObject(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label} contains unknown field: ${key}`);
}

function safeName(value, label, maximum = 240) {
  const text = String(value ?? '').trim();
  if (!text || text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`${label} is unsafe.`);
  return text;
}

function sameValues(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function receiptTargets(item) {
  if (!Array.isArray(item.targets) || !item.targets.length) throw new Error(`Governed Starter Pack ${item.id} declares no logical targets.`);
  const seen = new Set();
  const targets = item.targets.map((target) => {
    const role = safeName(target.role, 'Governed Starter Pack target role', 80);
    const sourcePath = safeName(target.sourcePath, `Governed Starter Pack ${role} source path`, 512).replaceAll('\\', '/');
    if (!rolePattern.test(role) || seen.has(role)) throw new Error(`Governed Starter Pack target role is invalid or duplicated: ${role}`);
    seen.add(role);
    if (sourcePath.startsWith('/') || sourcePath.startsWith('../') || sourcePath.includes('/../') || sourcePath.includes('\0')) {
      throw new Error(`Governed Starter Pack target source path is unsafe: ${sourcePath}`);
    }
    return { role, sourcePath };
  });
  for (let index = 0; index < targets.length; index += 1) {
    for (let other = index + 1; other < targets.length; other += 1) {
      const left = targets[index].sourcePath;
      const right = targets[other].sourcePath;
      if (left === right || left === '.' || right === '.' || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)) {
        throw new Error(`Governed Starter Pack source target paths overlap: ${left} and ${right}`);
      }
    }
  }
  return targets.sort((left, right) => left.role.localeCompare(right.role));
}

function safeReceipt(pack, module, item, selection) {
  const sourceClass = classifyStarterSource(item.source);
  if (!digestPattern.test(item.digest)) throw new Error(`Governed Starter Pack ${item.id} requires a canonical SHA-256 digest.`);
  return {
    id: `${pack.id}:${module.id}:${item.id}`,
    name: safeName(item.name, 'Governed Starter Pack name'),
    source: safeName(item.source, 'Governed Starter Pack source', 2_048),
    sourceClass,
    version: safeName(item.version, 'Governed Starter Pack version', 80),
    digest: item.digest,
    licence: safeName(item.licence, 'Governed Starter Pack licence'),
    compatibility: safeName(item.compatibility, 'Governed Starter Pack compatibility', 500),
    targets: receiptTargets(item),
    pack: { id: pack.id, version: pack.version, digest: pack.digest },
    module: { id: module.id, name: module.name },
    accepted: {
      selectionDigest: selection.selection_digest,
      approvedBy: selection.approved_by,
      approvedAt: selection.approved_at,
      evidence: selection.evidence,
    },
    ...(item.legacy ? { legacy: true } : {}),
  };
}

export function resolveAcceptedStarterReceipts(projectRoot, options = {}) {
  const { config } = loadProjectConfig(projectRoot);
  const selection = config.blueprints?.organisation;
  if (!selection) throw new Error('No accepted Organisation Blueprint is configured for this project.');
  const catalogue = listOrganisationBlueprints({
    projectRoot,
    ...(options.roots ? { roots: options.roots } : {}),
    ...(options.home ? { home: options.home } : {}),
  });
  const resolved = resolveOrganisationBlueprint(selection.root.id, catalogue, { enabledModules: selection.enabled_modules });
  if (
    resolved.root.version !== selection.root.version
    || resolved.root.digest !== selection.root.digest
    || resolved.digest !== selection.selection_digest
  ) throw new Error('Accepted Organisation Blueprint root or selection has drifted.');
  const currentPins = resolved.packs.map((pack) => `${pack.id}@${pack.version}:${pack.digest}`);
  const acceptedPins = selection.packs.map((pack) => `${pack.id}@${pack.version}:${pack.digest}`);
  if (!sameValues(currentPins, acceptedPins)) throw new Error('Accepted Organisation Blueprint pack set has drifted.');
  const currentModules = resolved.modules.map(({ packId, module }) => `${packId}:${module.id}`);
  if (!sameValues(currentModules, selection.applied_modules)) throw new Error('Accepted Organisation Blueprint module set has drifted.');
  const receipts = resolved.modules.flatMap(({ packId, module }) => {
    const pack = resolved.packs.find((candidate) => candidate.id === packId);
    return module.starterPacks.map((item) => safeReceipt(pack, module, item, selection));
  }).sort((left, right) => left.id.localeCompare(right.id));
  const duplicates = receipts.find((receipt, index) => receipts.findIndex((candidate) => candidate.id === receipt.id) !== index);
  if (duplicates) throw new Error(`Accepted Governed Starter Pack receipt is duplicated: ${duplicates.id}`);
  if (options.receiptId) {
    const receipt = receipts.find((candidate) => candidate.id === options.receiptId);
    if (!receipt) throw new Error(`Unknown accepted Governed Starter Pack receipt: ${options.receiptId}`);
    return [receipt];
  }
  return receipts;
}

function safeAdapter(row) {
  return {
    id: row.id,
    name: row.name,
    publisher: { id: row.publisher_id, name: row.publisher_name },
    version: row.version,
    protocolVersion: row.protocol_version,
    sourceClasses: JSON.parse(row.source_classes_json),
    manifestDigest: row.manifest_digest,
    packageDigest: row.package_digest,
    registeredAt: row.registered_at,
    updatedAt: row.updated_at,
    notice: STARTER_ADAPTER_TRUST_NOTICE,
  };
}

export function listStarterAdapters(projectRoot) {
  const database = openRuntimeDatabase(projectRoot);
  try {
    return database.prepare('SELECT * FROM starter_adapters ORDER BY id').all().map(safeAdapter);
  } finally {
    database.close();
  }
}

export function registerStarterAdapter(projectRoot, folder, input = {}) {
  if (input.confirmed !== true) throw new Error('Starter adapter registration requires explicit confirmation.');
  const adapter = validateStarterAdapterPackage(folder, input);
  const at = now(input);
  const database = openRuntimeDatabase(projectRoot);
  try {
    const existing = database.prepare('SELECT * FROM starter_adapters WHERE id = ?').get(adapter.id);
    if (existing && (existing.publisher_id !== adapter.publisher.id || existing.publisher_name !== adapter.publisher.name)) {
      throw new Error(`Starter adapter ${adapter.id} publisher identity has drifted.`);
    }
    if (existing && existing.version === adapter.version && existing.package_digest !== adapter.packageDigest) {
      throw new Error(`Starter adapter ${adapter.id} has same-version package digest drift.`);
    }
    database.prepare(`
      INSERT INTO starter_adapters (
        id, name, publisher_id, publisher_name, version, protocol_version,
        source_classes_json, trusted_root, entrypoint, manifest_digest, package_digest,
        manifest_json, registered_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        publisher_id = excluded.publisher_id,
        publisher_name = excluded.publisher_name,
        version = excluded.version,
        protocol_version = excluded.protocol_version,
        source_classes_json = excluded.source_classes_json,
        trusted_root = excluded.trusted_root,
        entrypoint = excluded.entrypoint,
        manifest_digest = excluded.manifest_digest,
        package_digest = excluded.package_digest,
        manifest_json = excluded.manifest_json,
        updated_at = excluded.updated_at
    `).run(
      adapter.id,
      adapter.name,
      adapter.publisher.id,
      adapter.publisher.name,
      adapter.version,
      adapter.protocolVersion,
      JSON.stringify(adapter.sourceClasses),
      adapter.trustedRoot,
      adapter.entrypoint,
      adapter.manifestDigest,
      adapter.packageDigest,
      JSON.stringify({
        schema: adapter.schema,
        id: adapter.id,
        name: adapter.name,
        publisher: adapter.publisher,
        version: adapter.version,
        protocolVersion: adapter.protocolVersion,
        sourceClasses: adapter.sourceClasses,
        entrypoint: adapter.entrypoint,
      }),
      existing?.registered_at ?? at,
      at,
    );
    return safeAdapter(database.prepare('SELECT * FROM starter_adapters WHERE id = ?').get(adapter.id));
  } finally {
    database.close();
  }
}

function revalidateAdapter(row) {
  const current = validateStarterAdapterPackage(row.trusted_root);
  for (const [field, left, right] of [
    ['identity', current.id, row.id],
    ['version', current.version, row.version],
    ['entrypoint', current.entrypoint, row.entrypoint],
    ['manifest digest', current.manifestDigest, row.manifest_digest],
    ['package digest', current.packageDigest, row.package_digest],
  ]) {
    if (left !== right) throw new Error(`Registered starter adapter ${field} has drifted.`);
  }
  return current;
}

function validateAcknowledgement(value, expected) {
  strictObject(value, new Set(['schema', 'attemptId', 'nonce', 'status']), 'Starter adapter acknowledgement');
  if (value.schema !== 'ewai.starter-source-acknowledgement/v1') throw new Error('Unsupported starter adapter acknowledgement schema.');
  if (value.attemptId !== expected.attemptId || value.nonce !== expected.nonce) throw new Error('Starter adapter acknowledgement identity does not match the request.');
  if (value.status !== 'prepared') throw new Error('Starter adapter acknowledgement did not report prepared status.');
  return value;
}

function runAdapter(adapter, request, limits) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(adapter.entrypointPath, [], {
      cwd: request.stagingRoot,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        LANG: 'C',
        LC_ALL: 'C',
        EWAI_STARTER_ADAPTER_PROTOCOL: '1',
      },
    });
    const stdout = [];
    let outputBytes = 0;
    let overflow = false;
    let timedOut = false;
    const consume = (chunk, capture) => {
      outputBytes += chunk.length;
      if (outputBytes > limits.maximumOutputBytes) {
        overflow = true;
        child.kill('SIGKILL');
        return;
      }
      if (capture) stdout.push(chunk);
    };
    child.stdout.on('data', (chunk) => consume(chunk, true));
    child.stderr.on('data', (chunk) => consume(chunk, false));
    child.on('error', rejectRun);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, limits.timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) return rejectRun(new Error('Starter adapter timed out.'));
      if (overflow) return rejectRun(new Error('Starter adapter exceeded its output-byte limit.'));
      if (code !== 0) return rejectRun(new Error(`Starter adapter failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`));
      let acknowledgement;
      try {
        acknowledgement = JSON.parse(Buffer.concat(stdout).toString('utf8'));
      } catch {
        return rejectRun(new Error('Starter adapter returned a malformed acknowledgement.'));
      }
      try {
        resolveRun(validateAcknowledgement(acknowledgement, request));
      } catch (error) {
        rejectRun(error);
      }
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

function boundedStagingRoot(projectRoot, attemptId) {
  const paths = runtimePaths(projectRoot);
  const realRuntimeRoot = realpathSync(paths.runtimeRoot);
  let cursor = realRuntimeRoot;
  for (const segment of ['starter-materialisation', 'staging']) {
    cursor = resolve(cursor, segment);
    if (!existsSync(cursor)) mkdirSync(cursor, { mode: 0o700 });
    if (lstatSync(cursor).isSymbolicLink() || !lstatSync(cursor).isDirectory()) throw new Error('Starter staging path may not traverse symbolic or non-directory content.');
  }
  const realStagingRoot = realpathSync(cursor);
  const runtimeBound = relative(realRuntimeRoot, realStagingRoot);
  if (!runtimeBound || runtimeBound.startsWith('..') || isAbsolute(runtimeBound)) throw new Error('Starter staging root escapes its project runtime root.');
  const stagingRoot = resolve(realStagingRoot, attemptId);
  const bounded = relative(realStagingRoot, stagingRoot);
  if (!bounded || bounded.startsWith('..') || isAbsolute(bounded)) throw new Error('Starter staging path escapes its project runtime root.');
  mkdirSync(stagingRoot, { recursive: false, mode: 0o700 });
  return realpathSync(stagingRoot);
}

function relativeDestination(mapping, filePath) {
  return mapping.path === '.' ? filePath : `${mapping.path}/${filePath}`;
}

function safePreparedProjection(attempt, mappings, targetTrees, files) {
  const counts = classificationCounts(files);
  return {
    schema: 'ewai.starter-materialisation-preview/v1',
    attemptId: attempt.id,
    previewId: attempt.previewId,
    previewDigest: attempt.previewDigest,
    expiresAt: attempt.expiresAt,
    status: 'prepared',
    receiptId: attempt.receiptId,
    adapterId: attempt.adapterId,
    treeDigest: attempt.treeDigest,
    files: targetTrees.reduce((count, target) => count + target.files.length, 0),
    bytes: targetTrees.reduce((count, target) => count + target.files.reduce((sum, file) => sum + file.bytes, 0), 0),
    classifications: counts,
    targets: targetTrees.map((target) => {
      const mapping = mappings.find((candidate) => candidate.role === target.role);
      return {
        role: target.role,
        repository: mapping.repository,
        path: mapping.path,
        files: target.files.length,
        bytes: target.files.reduce((sum, file) => sum + file.bytes, 0),
        digest: target.digest,
        classifications: classificationCounts(files.filter((file) => file.target_role === target.role)),
      };
    }),
    projectRevision: attempt.repositoryRevisions.digest,
    notice: STARTER_MATERIALISATION_NOTICE,
    adapterNotice: STARTER_ADAPTER_TRUST_NOTICE,
  };
}

export async function prepareStarterMaterialisation(projectRoot, receiptId, adapterId, input = {}) {
  if (input.confirmed !== true) throw new Error('Starter materialisation preparation requires explicit confirmation.');
  const timeoutMs = Number(input.timeoutMs ?? defaultLimits.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 15 * 60 * 1_000) throw new Error('Starter adapter timeout must be between 1000 and 900000 milliseconds.');
  const limits = { ...defaultLimits, timeoutMs };
  const [receipt] = resolveAcceptedStarterReceipts(projectRoot, { ...input, receiptId });
  const mappings = resolveStarterTargetMappings(projectRoot, receipt);
  const repositoryRevisions = starterProjectRevision(mappings);
  const database = openRuntimeDatabase(projectRoot);
  const attemptId = randomUUID();
  const nonce = randomUUID();
  const createdAt = now(input);
  let stagingRoot = '';
  try {
    database.prepare(`
      UPDATE starter_attempts SET status = 'expired', error_code = 'preview-expired', updated_at = ?
      WHERE status = 'prepared' AND expires_at IS NOT NULL AND expires_at < ?
    `).run(createdAt, createdAt);
    const active = database.prepare(`SELECT id FROM starter_attempts WHERE status IN (${activeAttemptStates.map(() => '?').join(',')}) ORDER BY created_at LIMIT 1`).get(...activeAttemptStates);
    if (active) throw new Error(`Starter materialisation is busy with attempt ${active.id}.`);
    const row = database.prepare('SELECT * FROM starter_adapters WHERE id = ?').get(adapterId);
    if (!row) throw new Error(`Unknown registered starter adapter: ${adapterId}`);
    const adapter = revalidateAdapter(row);
    if (!adapter.sourceClasses.includes(receipt.sourceClass)) throw new Error(`Starter adapter ${adapter.id} does not support source class ${receipt.sourceClass}.`);
    stagingRoot = boundedStagingRoot(projectRoot, attemptId);
    const adapterSnapshot = safeAdapter(row);
    database.prepare(`
      INSERT INTO starter_attempts (
        id, receipt_id, adapter_id, status, nonce, staging_root, receipt_json,
        target_mappings_json, adapter_snapshot_json, limits_json,
        repository_revisions_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'preparing', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      attemptId,
      receipt.id,
      adapter.id,
      nonce,
      stagingRoot,
      JSON.stringify(receipt),
      JSON.stringify(mappings.map(({ role, repository, repositoryRole, repositoryPath, path, sourcePath }) => ({ role, repository, repositoryRole, repositoryPath, path, sourcePath }))),
      JSON.stringify(adapterSnapshot),
      JSON.stringify(limits),
      JSON.stringify(repositoryRevisions),
      createdAt,
      createdAt,
    );
    const { config } = loadProjectConfig(projectRoot);
    const request = {
      schema: 'ewai.starter-source-request/v1',
      attemptId,
      nonce,
      project: { name: safeName(config.project.name, 'Project name') },
      receipt: {
        id: receipt.id,
        name: receipt.name,
        source: receipt.source,
        sourceClass: receipt.sourceClass,
        version: receipt.version,
        digest: receipt.digest,
        licence: receipt.licence,
        compatibility: receipt.compatibility,
        targets: receipt.targets,
      },
      stagingRoot,
      limits,
    };
    await runAdapter(adapter, request, limits);
    if (!existsSync(stagingRoot) || lstatSync(stagingRoot).isSymbolicLink() || realpathSync(stagingRoot) !== stagingRoot) throw new Error('Starter staging root changed during adapter execution.');
    const fullTree = canonicalStarterTree(stagingRoot, { limits });
    const targetTrees = mappings.map((mapping) => {
      const prefix = mapping.sourcePath === '.' ? '' : `${mapping.sourcePath}/`;
      const files = fullTree.filter((file) => mapping.sourcePath === '.' || file.path.startsWith(prefix)).map((file) => ({
        ...file,
        path: mapping.sourcePath === '.' ? file.path : file.path.slice(prefix.length),
      }));
      if (!files.length) throw new Error(`Starter adapter produced no files for target ${mapping.role}.`);
      return { role: mapping.role, files, digest: starterTreeDigest(files) };
    });
    for (const file of fullTree) {
      const owners = mappings.filter((mapping) => mapping.sourcePath === '.' || file.path.startsWith(`${mapping.sourcePath}/`));
      if (owners.length !== 1) throw new Error(`Starter adapter produced content outside one declared target: ${file.path}`);
    }
    const treeDigest = starterPackDigest(targetTrees);
    if (treeDigest !== receipt.digest) throw new Error('Independently verified starter tree digest does not match the accepted receipt.');
    const materialisationFiles = targetTrees.flatMap((target) => {
      const mapping = mappings.find((candidate) => candidate.role === target.role);
      return target.files.map((file) => ({
        target_role: target.role,
        repository_name: mapping.repository,
        source_path: file.path,
        destination_path: relativeDestination(mapping, file.path),
        content_digest: file.digest,
        size_bytes: file.bytes,
      }));
    });
    const classified = classifyDestinations(projectRoot, mappings, materialisationFiles);
    const previewId = randomUUID();
    const expiresAt = new Date(new Date(createdAt).getTime() + previewLifetimeMs).toISOString();
    const previewDigest = sha256(JSON.stringify(previewBinding({
      previewId,
      attemptId,
      receipt,
      adapter: safeAdapter(row),
      mappings,
      repositoryRevisions,
      treeDigest,
      targetTreeDigests: targetTrees.map(({ role, digest }) => ({ role, digest })),
      files: classified,
      expiresAt,
    })));
    database.exec('BEGIN IMMEDIATE;');
    try {
      for (const file of classified) {
        database.prepare(`
          INSERT INTO starter_files (
            attempt_id, target_role, repository_name, source_path, destination_path,
            content_digest, size_bytes, classification, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          attemptId,
          file.target_role,
          file.repository_name,
          file.source_path,
          file.destination_path,
          file.content_digest,
          file.size_bytes,
          file.classification,
          createdAt,
        );
      }
      database.prepare(`
        UPDATE starter_attempts SET status = 'prepared', tree_digest = ?,
          target_tree_digests_json = ?, preview_id = ?, preview_digest = ?,
          expires_at = ?, updated_at = ? WHERE id = ?
      `).run(
        treeDigest,
        JSON.stringify(targetTrees.map(({ role, digest }) => ({ role, digest }))),
        previewId,
        previewDigest,
        expiresAt,
        now(input),
        attemptId,
      );
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
    return safePreparedProjection({
      id: attemptId,
      receiptId: receipt.id,
      adapterId: adapter.id,
      treeDigest,
      repositoryRevisions,
      previewId,
      previewDigest,
      expiresAt,
    }, mappings, targetTrees, classified);
  } catch (error) {
    const row = database.prepare('SELECT id FROM starter_attempts WHERE id = ?').get(attemptId);
    if (row) database.prepare("UPDATE starter_attempts SET status = 'failed', error_code = 'preparation-failed', updated_at = ? WHERE id = ?").run(now(input), attemptId);
    if (stagingRoot && existsSync(stagingRoot)) rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  } finally {
    database.close();
  }
}

function rebuildPreparedTree(projectRoot, attempt, mappings, files) {
  if (!existsSync(attempt.staging_root) || lstatSync(attempt.staging_root).isSymbolicLink()) {
    throw new Error('Prepared starter staging tree is missing or unsafe.');
  }
  const stagingRoot = realpathSync(attempt.staging_root);
  if (stagingRoot !== attempt.staging_root) throw new Error('Prepared starter staging root has drifted.');
  const limits = parseJson(attempt.limits_json, defaultLimits);
  const fullTree = canonicalStarterTree(stagingRoot, { limits });
  const targetTrees = mappings.map((mapping) => {
    const prefix = mapping.sourcePath === '.' ? '' : `${mapping.sourcePath}/`;
    const targetFiles = fullTree
      .filter((file) => mapping.sourcePath === '.' || file.path.startsWith(prefix))
      .map((file) => ({ ...file, path: mapping.sourcePath === '.' ? file.path : file.path.slice(prefix.length) }));
    if (!targetFiles.length) throw new Error(`Prepared starter staging tree has no files for target ${mapping.role}.`);
    return { role: mapping.role, files: targetFiles, digest: starterTreeDigest(targetFiles) };
  });
  for (const file of fullTree) {
    const owners = mappings.filter((mapping) => mapping.sourcePath === '.' || file.path.startsWith(`${mapping.sourcePath}/`));
    if (owners.length !== 1) throw new Error(`Prepared starter staging tree ownership has drifted: ${file.path}`);
  }
  const treeDigest = starterPackDigest(targetTrees);
  if (treeDigest !== attempt.tree_digest) throw new Error('Prepared starter staging tree digest has drifted.');
  if (!sameJson(targetTrees.map(({ role, digest }) => ({ role, digest })), parseJson(attempt.target_tree_digests_json, []))) {
    throw new Error('Prepared starter target-tree digests have drifted.');
  }
  const staged = new Map();
  for (const target of targetTrees) {
    for (const file of target.files) staged.set(`${target.role}:${file.path}`, file);
  }
  if (staged.size !== files.length) throw new Error('Prepared starter staged-file inventory has drifted.');
  for (const file of files) {
    const current = staged.get(`${file.target_role}:${file.source_path}`);
    if (!current || current.digest !== file.content_digest || current.bytes !== file.size_bytes) {
      throw new Error(`Prepared starter staged file has drifted: ${file.destination_path}`);
    }
  }
  return { targetTrees, staged };
}

function validateCurrentPreview(projectRoot, attempt, input, database) {
  if (attempt.status !== 'prepared') throw new Error(`Starter materialisation preview is not available in prepared state: ${attempt.status}`);
  if (new Date(now(input)).getTime() > new Date(attempt.expires_at).getTime()) throw new Error('Starter materialisation preview has expired and must be prepared again.');
  const [receipt] = resolveAcceptedStarterReceipts(projectRoot, { ...input, receiptId: attempt.receipt_id });
  if (!sameJson(receipt, parseJson(attempt.receipt_json, {}))) throw new Error('Accepted Governed Starter Pack receipt has drifted since preview.');
  const mappings = resolveStarterTargetMappings(projectRoot, receipt);
  if (!sameJson(snapshotMappings(mappings), parseJson(attempt.target_mappings_json, []))) {
    throw new Error('Starter target mappings have drifted since preview.');
  }
  const adapterRow = database.prepare('SELECT * FROM starter_adapters WHERE id = ?').get(attempt.adapter_id);
  if (!adapterRow) throw new Error(`Registered starter adapter disappeared: ${attempt.adapter_id}`);
  revalidateAdapter(adapterRow);
  const adapter = safeAdapter(adapterRow);
  if (!sameJson(adapter, parseJson(attempt.adapter_snapshot_json, {}))) throw new Error('Registered starter adapter has drifted since preview.');
  const repositoryRevisions = starterProjectRevision(mappings);
  if (!sameJson(repositoryRevisions, parseJson(attempt.repository_revisions_json, {}))) {
    throw new Error('Starter materialisation repository revision has drifted since preview.');
  }
  const storedFiles = database.prepare('SELECT * FROM starter_files WHERE attempt_id = ? ORDER BY target_role, source_path').all(attempt.id);
  const { targetTrees, staged } = rebuildPreparedTree(projectRoot, attempt, mappings, storedFiles);
  const classified = classifyDestinations(projectRoot, mappings, storedFiles);
  for (const file of classified) {
    const stored = storedFiles.find((candidate) => candidate.id === file.id);
    if (file.classification !== stored.classification) throw new Error(`Starter destination classification has drifted: ${file.destination_path}`);
  }
  const digest = sha256(JSON.stringify(previewBinding({
    previewId: attempt.preview_id,
    attemptId: attempt.id,
    receipt,
    adapter,
    mappings,
    repositoryRevisions,
    treeDigest: attempt.tree_digest,
    targetTreeDigests: targetTrees.map(({ role, digest: targetDigest }) => ({ role, digest: targetDigest })),
    files: classified,
    expiresAt: attempt.expires_at,
  })));
  if (digest !== attempt.preview_digest) throw new Error('Starter materialisation preview binding has drifted.');
  return { receipt, mappings, adapter, repositoryRevisions, files: classified, staged, targetTrees };
}

function persistJournal(database, attemptId, journal, input = {}) {
  database.prepare('UPDATE starter_attempts SET journal_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(journal), now(input), attemptId);
}

function syncDirectory(path) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY);
    fsyncSync(descriptor);
  } catch {
    // Directory fsync is not available on every supported filesystem.
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function createParents(repositoryRoot, destinationPath, database, attemptId, journal, input) {
  const segments = destinationPath.split('/').slice(0, -1);
  let cursor = repositoryRoot;
  for (const segment of segments) {
    cursor = resolve(cursor, segment);
    if (existsSync(cursor)) {
      const metadata = lstatSync(cursor);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error(`Starter destination parent is not a real directory: ${destinationPath}`);
      continue;
    }
    const entry = { kind: 'directory', state: 'creating', path: cursor, destinationPath: relative(repositoryRoot, cursor).replaceAll('\\', '/') };
    journal.push(entry);
    persistJournal(database, attemptId, journal, input);
    mkdirSync(cursor, { recursive: false, mode: 0o755 });
    entry.state = 'created';
    persistJournal(database, attemptId, journal, input);
    syncDirectory(resolve(cursor, '..'));
  }
}

function publishExclusive(file, content, database, attemptId, journal, input, created) {
  const parent = resolve(file.destination, '..');
  const temporary = resolve(parent, `.ewai-starter-${randomUUID()}.tmp`);
  const entry = {
    kind: 'file',
    state: 'publishing',
    path: file.destination,
    temporary,
    destinationPath: file.destination_path,
    digest: file.content_digest,
  };
  journal.push(entry);
  persistJournal(database, attemptId, journal, input);
  let descriptor;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporary, 0o644);
    input.testHooks?.beforePublish?.({ created });
    linkSync(temporary, file.destination);
    entry.state = 'created';
    persistJournal(database, attemptId, journal, input);
    unlinkSync(temporary);
    syncDirectory(parent);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    const raced = error?.code === 'EEXIST' ? new Error(`Starter destination appeared during exclusive publication: ${file.destination_path}`) : error;
    throw raced;
  }
}

function sameInode(left, right) {
  if (!existsSync(left) || !existsSync(right)) return false;
  const leftMetadata = lstatSync(left);
  const rightMetadata = lstatSync(right);
  return leftMetadata.isFile() && rightMetadata.isFile() && leftMetadata.dev === rightMetadata.dev && leftMetadata.ino === rightMetadata.ino;
}

function rollbackJournal(journal) {
  const preserved = [];
  for (const entry of [...journal].reverse()) {
    if (entry.kind === 'file') {
      const ownsPublished = entry.state === 'created' || (entry.state === 'publishing' && sameInode(entry.path, entry.temporary));
      if (ownsPublished && existsSync(entry.path)) {
        if (regularFileDigest(entry.path) === entry.digest) unlinkSync(entry.path);
        else preserved.push(entry.destinationPath);
      }
      if (existsSync(entry.temporary) && regularFileDigest(entry.temporary) === entry.digest) unlinkSync(entry.temporary);
      continue;
    }
    if (entry.kind === 'directory' && entry.state === 'created' && existsSync(entry.path)) {
      const metadata = lstatSync(entry.path);
      if (!metadata.isSymbolicLink() && metadata.isDirectory() && readdirSync(entry.path).length === 0) rmdirSync(entry.path);
    }
  }
  return [...new Set(preserved)].sort();
}

function writeExclusiveEvidence(path, content) {
  const folder = resolve(path, '..');
  mkdirSync(folder, { recursive: true, mode: 0o755 });
  const temporary = resolve(folder, `.ewai-evidence-${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporary, 0o644);
    linkSync(temporary, path);
    unlinkSync(temporary);
    syncDirectory(folder);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

function materialisationEvidence(projectRoot, attempt, context, approval, personas, completedAt) {
  const { paths } = loadProjectConfig(projectRoot);
  const evidenceFolder = resolve(paths.specsRoot, '3.Evidence/starter-materialisations');
  const jsonPath = resolve(evidenceFolder, `${attempt.id}.json`);
  const markdownPath = resolve(evidenceFolder, `${attempt.id}.md`);
  const relativeJson = relative(resolve(projectRoot), jsonPath).replaceAll('\\', '/');
  const relativeMarkdown = relative(resolve(projectRoot), markdownPath).replaceAll('\\', '/');
  const counts = classificationCounts(context.files);
  const evidence = {
    schema: 'ewai.starter-materialisation-evidence/v1',
    attemptId: attempt.id,
    previewId: attempt.preview_id,
    previewDigest: attempt.preview_digest,
    receiptId: attempt.receipt_id,
    adapterId: attempt.adapter_id,
    treeDigest: attempt.tree_digest,
    approval: { approvedBy: approval.approvedBy, approvedAt: approval.approvedAt },
    result: { created: counts.create, identical: counts.identical, completedAt },
    repositories: context.repositoryRevisions.repositories.map(({ name, revision }) => ({ name, revision })),
    targets: context.targetTrees.map(({ role, digest }) => ({ role, digest })),
    destinations: context.files.map((file) => ({
      targetRole: file.target_role,
      repository: file.repository_name,
      path: file.destination_path,
      digest: file.content_digest,
      classification: file.classification,
    })),
    personas,
    notice: STARTER_MATERIALISATION_NOTICE,
  };
  const markdown = `# Governed Starter Pack materialisation\n\n- Attempt: \`${attempt.id}\`\n- Preview: \`${attempt.preview_id}\`\n- Receipt: \`${attempt.receipt_id}\`\n- Adapter: \`${attempt.adapter_id}\`\n- Tree digest: \`${attempt.tree_digest}\`\n- Approved by: ${approval.approvedBy}\n- Approved at: ${approval.approvedAt}\n- Completed at: ${completedAt}\n- Created: ${counts.create}\n- Already identical: ${counts.identical}\n\n${STARTER_MATERIALISATION_NOTICE}\n`;
  writeExclusiveEvidence(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`);
  try {
    writeExclusiveEvidence(markdownPath, markdown);
  } catch (error) {
    if (existsSync(jsonPath) && sha256(readFileSync(jsonPath)) === sha256(`${JSON.stringify(evidence, null, 2)}\n`)) unlinkSync(jsonPath);
    throw error;
  }
  return { jsonPath, markdownPath, relativeJson, relativeMarkdown, evidence, counts };
}

export function applyStarterMaterialisation(projectRoot, previewId, input = {}) {
  if (input.confirmed !== true) throw new Error('Starter materialisation application requires explicit confirmation.');
  const approvedBy = safeName(input.approvedBy, 'Starter materialisation approver', 160);
  const database = openRuntimeDatabase(projectRoot);
  let applying = false;
  let journal = [];
  let writtenEvidence = null;
  try {
    const attempt = database.prepare('SELECT * FROM starter_attempts WHERE preview_id = ?').get(String(previewId ?? '').trim());
    if (!attempt) throw new Error(`Unknown starter materialisation preview: ${previewId}`);
    const context = validateCurrentPreview(projectRoot, attempt, input, database);
    const counts = classificationCounts(context.files);
    if (counts.conflict) throw new Error(`Starter materialisation preview contains ${counts.conflict} destination conflict(s).`);
    const approvedAt = now(input);
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.prepare(`
        INSERT INTO starter_approvals (id, attempt_id, preview_id, approved_by, approved_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), attempt.id, attempt.preview_id, approvedBy, approvedAt, approvedAt);
      database.prepare("UPDATE starter_attempts SET status = 'applying', updated_at = ? WHERE id = ? AND status = 'prepared'")
        .run(approvedAt, attempt.id);
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
    applying = true;
    let created = 0;
    for (const file of context.files) {
      if (file.classification === 'identical') continue;
      const mapping = context.mappings.find((candidate) => candidate.role === file.target_role);
      createParents(mapping.repositoryRoot, file.destination_path, database, attempt.id, journal, input);
      const staged = context.staged.get(`${file.target_role}:${file.source_path}`);
      publishExclusive(file, staged.content, database, attempt.id, journal, input, created);
      created += 1;
      input.testHooks?.afterPublish?.({ created });
    }
    const completedAt = now(input);
    const personas = resolveLifecyclePersonas(projectRoot, input.personas ?? []);
    writtenEvidence = materialisationEvidence(
      projectRoot,
      attempt,
      context,
      { approvedBy, approvedAt },
      personas,
      completedAt,
    );
    database.prepare(`
      UPDATE starter_attempts SET status = 'completed', evidence_path = ?,
        updated_at = ?, completed_at = ?, error_code = '' WHERE id = ?
    `).run(writtenEvidence.relativeJson, completedAt, completedAt, attempt.id);
    if (existsSync(attempt.staging_root)) rmSync(attempt.staging_root, { recursive: true, force: true });
    publishLifecycleEventSafely(projectRoot, 'ewai.project.starter.materialised', {
      sourceKey: `starter-materialisation:${attempt.id}`,
      sourceRevision: attempt.preview_digest,
      occurredAt: completedAt,
      streamId: 'project',
      facts: {
        receiptId: attempt.receipt_id,
        adapterId: attempt.adapter_id,
        treeDigest: attempt.tree_digest,
        targetCount: context.targetTrees.length,
        repositoryCount: context.repositoryRevisions.repositories.length,
        createdCount: writtenEvidence.counts.create,
        identicalCount: writtenEvidence.counts.identical,
        completedAt,
      },
      evidence: [writtenEvidence.relativeJson, writtenEvidence.relativeMarkdown],
      personas: input.personas ?? [],
    });
    return {
      schema: 'ewai.starter-materialisation-result/v1',
      attemptId: attempt.id,
      previewId: attempt.preview_id,
      status: 'completed',
      results: { created: writtenEvidence.counts.create, identical: writtenEvidence.counts.identical },
      evidence: { json: writtenEvidence.relativeJson, markdown: writtenEvidence.relativeMarkdown },
      personas,
      notice: STARTER_MATERIALISATION_NOTICE,
    };
  } catch (error) {
    if (applying) {
      if (writtenEvidence) {
        for (const path of [writtenEvidence.jsonPath, writtenEvidence.markdownPath]) {
          if (existsSync(path)) unlinkSync(path);
        }
      }
      const preserved = rollbackJournal(journal);
      const status = preserved.length ? 'recovery-required' : 'failed';
      const row = database.prepare("SELECT id FROM starter_attempts WHERE preview_id = ?").get(String(previewId ?? '').trim());
      if (row) database.prepare('UPDATE starter_attempts SET status = ?, error_code = ?, journal_json = ?, updated_at = ? WHERE id = ?')
        .run(status, status === 'recovery-required' ? 'digest-changed' : 'application-failed', JSON.stringify(journal), now(input), row.id);
      if (preserved.length) throw new Error(`${error.message} Recovery required because created content changed: ${preserved.join(', ')}`);
    }
    throw error;
  } finally {
    database.close();
  }
}

export function recoverStarterMaterialisation(projectRoot, attemptId, input = {}) {
  if (input.confirmed !== true) throw new Error('Starter materialisation recovery requires explicit confirmation.');
  const database = openRuntimeDatabase(projectRoot);
  try {
    const attempt = database.prepare('SELECT * FROM starter_attempts WHERE id = ?').get(String(attemptId ?? '').trim());
    if (!attempt) throw new Error(`Unknown starter materialisation attempt: ${attemptId}`);
    if (!['applying', 'recovery-required', 'failed'].includes(attempt.status)) {
      throw new Error(`Starter materialisation attempt cannot be recovered from state ${attempt.status}.`);
    }
    const journal = parseJson(attempt.journal_json, []);
    const preserved = rollbackJournal(journal);
    const status = preserved.length ? 'recovery-required' : 'failed';
    database.prepare('UPDATE starter_attempts SET status = ?, error_code = ?, updated_at = ? WHERE id = ?')
      .run(status, preserved.length ? 'digest-changed' : 'recovered', now(input), attempt.id);
    return {
      schema: 'ewai.starter-materialisation-recovery/v1',
      attemptId: attempt.id,
      status,
      preserved,
      notice: 'Recovery removes only EWAI-created files whose content digest is unchanged. Changed files are preserved for human resolution.',
    };
  } finally {
    database.close();
  }
}

function safeReceiptProjection(receipt) {
  return {
    id: receipt.id,
    name: receipt.name,
    sourceClass: receipt.sourceClass,
    version: receipt.version,
    digest: receipt.digest,
    licence: receipt.licence,
    compatibility: receipt.compatibility,
    targets: receipt.targets.map(({ role }) => ({ role })),
    pack: receipt.pack,
    module: receipt.module,
    accepted: receipt.accepted,
    ...(receipt.legacy ? { legacy: true } : {}),
  };
}

export function selectStarterPersonas(personas, moment = 'review') {
  const catalogue = Array.isArray(personas) ? personas : [];
  const byId = new Map(catalogue.map((persona) => [persona.id, persona]));
  const selected = [];
  const add = (persona, role, reason) => {
    if (!persona || selected.some(({ ref }) => ref === persona.id)) return;
    selected.push({ ref: persona.id, name: persona.name, tier: persona.tier, role, reason });
  };
  const productSignal = (persona) => /product|owner|delivery|platform|architect/i.test([
    persona.id,
    persona.name,
    persona.category,
    ...(persona.tags ?? []),
  ].join(' '));
  const projectPersona = catalogue.find((persona) => persona.tier === 'project' && productSignal(persona));
  const premiumPersonas = catalogue.filter((persona) => persona.tier === 'premium' && productSignal(persona)).slice(0, 2);
  const reasons = {
    review: 'Reviewing intended outcomes, topology, compatibility and the immutable create/identical/conflict summary.',
    apply: 'Challenging operational readiness before named human approval and additive application.',
    recovery: 'Assessing safe recovery while preserving any generated content that has changed.',
  };
  const reason = reasons[moment] ?? reasons.review;
  if (moment !== 'recovery') {
    add(projectPersona, 'consulted', `${reason} Project-local organisational context is active.`);
    for (const persona of premiumPersonas) add(persona, 'consulted', `${reason} Installed premium expertise is active.`);
  }
  const coreIds = moment === 'recovery'
    ? ['ewai.core.operator', 'ewai.core.maintainer']
    : moment === 'apply'
      ? ['ewai.core.operator', 'ewai.core.maintainer', 'ewai.core.end-user']
      : ['ewai.core.operator', 'ewai.core.end-user', 'ewai.core.specs-knowledge-curator', 'ewai.core.maintainer'];
  for (const [index, id] of coreIds.entries()) add(byId.get(id), index === 0 ? 'primary' : 'consulted', reason);
  return selected.slice(0, 8);
}

function safeAttemptProjection(database, attempt) {
  const files = database.prepare(`
    SELECT target_role, repository_name, classification, COUNT(*) AS files, SUM(size_bytes) AS bytes
    FROM starter_files WHERE attempt_id = ?
    GROUP BY target_role, repository_name, classification
    ORDER BY target_role, repository_name, classification
  `).all(attempt.id);
  const mappings = parseJson(attempt.target_mappings_json, []);
  const targets = mappings.map((mapping) => {
    const targetFiles = files.filter((file) => file.target_role === mapping.role);
    const classifications = { create: 0, identical: 0, conflict: 0 };
    for (const file of targetFiles) classifications[file.classification] = Number(file.files);
    return {
      role: mapping.role,
      repository: mapping.repository,
      path: mapping.path,
      files: targetFiles.reduce((total, file) => total + Number(file.files), 0),
      bytes: targetFiles.reduce((total, file) => total + Number(file.bytes), 0),
      classifications,
    };
  });
  const approval = database.prepare(`
    SELECT approved_by, approved_at, evidence_path FROM starter_approvals WHERE attempt_id = ?
  `).get(attempt.id);
  return {
    attemptId: attempt.id,
    receiptId: attempt.receipt_id,
    adapterId: attempt.adapter_id,
    status: attempt.status,
    treeDigest: attempt.tree_digest,
    previewId: attempt.preview_id,
    previewDigest: attempt.preview_digest,
    expiresAt: attempt.expires_at,
    targets,
    classifications: targets.reduce((counts, target) => {
      for (const classification of Object.keys(counts)) counts[classification] += target.classifications[classification];
      return counts;
    }, { create: 0, identical: 0, conflict: 0 }),
    ...(approval ? { approval: { approvedBy: approval.approved_by, approvedAt: approval.approved_at } } : {}),
    ...(attempt.evidence_path ? { evidence: attempt.evidence_path } : {}),
    errorCode: attempt.error_code || '',
    createdAt: attempt.created_at,
    updatedAt: attempt.updated_at,
    completedAt: attempt.completed_at,
  };
}

export function readStarterMaterialisationWorkspace(projectRoot, options = {}) {
  const limit = Number(options.limit ?? 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Starter materialisation workspace limit must be between 1 and 200.');
  let receipts = [];
  let receiptStatus = 'available';
  try {
    receipts = resolveAcceptedStarterReceipts(projectRoot, options).map(safeReceiptProjection);
  } catch {
    receiptStatus = 'unavailable';
  }
  const database = openRuntimeDatabase(projectRoot);
  try {
    const attempts = database.prepare('SELECT * FROM starter_attempts ORDER BY created_at DESC LIMIT ?').all(limit)
      .map((attempt) => safeAttemptProjection(database, attempt));
    return {
      schema: 'ewai.starter-materialisation-workspace/v1',
      receipts,
      receiptStatus,
      adapters: database.prepare('SELECT * FROM starter_adapters ORDER BY id').all().map(safeAdapter),
      attempts,
      activePersonas: resolveLifecyclePersonas(projectRoot, options.personas ?? []),
      notice: STARTER_MATERIALISATION_NOTICE,
      adapterNotice: STARTER_ADAPTER_TRUST_NOTICE,
    };
  } finally {
    database.close();
  }
}
