import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { loadProjectConfig } from './project.mjs';

export const STARTER_MATERIALISATION_NOTICE = 'Governed Starter Pack materialisation runs explicitly trusted local adapter code with the invoking user\'s permissions; it is not OS-sandboxed. EWAI independently verifies staged content, permits additive-only publication, and requires named human approval. Results are evidence, not security certification, code-quality approval, licence approval or release approval.';
export const STARTER_ADAPTER_TRUST_NOTICE = 'A registered starter source adapter is trusted local code. EWAI does not OS-sandbox it, provide credentials, or authorise its output without independent verification.';
export const STARTER_SOURCE_CLASSES = Object.freeze(['https', 'git', 'archive', 'directory', 'package', 'opaque']);

const sourceClassSet = new Set(STARTER_SOURCE_CLASSES);
const slugPattern = /^[a-z][a-z0-9.-]{1,79}$/;
const rolePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const versionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const windowsReserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const credentialPattern = /(?:[a-z][a-z0-9+.-]*:\/\/[^/@\s]+:[^/@\s]+@|Bearer\s+[A-Za-z0-9._~+\/-]{12,}|sk-[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const protectedRoots = new Set(['.git', '.ewai-pipeline', '.codex', '.claude', '.agents']);
const protectedFiles = new Set(['agents.md', 'claude.md', '.mcp.json', '.env', '.npmrc', '.netrc']);
const defaultTreeLimits = Object.freeze({
  maximumDepth: 24,
  maximumPathBytes: 512,
  maximumFiles: 5_000,
  maximumFileBytes: 5 * 1024 * 1024,
  maximumTotalBytes: 100 * 1024 * 1024,
});
const defaultAdapterLimits = Object.freeze({
  maximumFiles: 128,
  maximumBytes: 10 * 1024 * 1024,
  maximumDepth: 12,
});

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function strictObject(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unknown field: ${key}`);
  }
}

function safeText(value, label, maximum = 240) {
  const text = String(value ?? '').trim();
  if (!text || text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`${label} is unsafe.`);
  return text;
}

function within(root, candidate) {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function normaliseRelative(value, label, options = {}) {
  const original = String(value ?? '').trim();
  if (!original || original.includes('\0') || /[\u0000-\u001f\u007f]/.test(original)) throw new Error(`${label} is unsafe.`);
  const text = original.replaceAll('\\', '/');
  if (text !== text.normalize('NFC')) throw new Error(`${label} must be Unicode NFC.`);
  if (isAbsolute(text) || /^[A-Za-z]:/.test(text) || text.startsWith('//')) throw new Error(`${label} must be relative.`);
  if (text === '.' && options.allowDot !== false) return '.';
  const segments = text.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) throw new Error(`${label} must be a bounded relative path.`);
  for (const segment of segments) {
    if (Buffer.byteLength(segment) > 255 || segment.endsWith('.') || segment.endsWith(' ') || windowsReserved.test(segment)) {
      throw new Error(`${label} contains an unsafe path segment: ${segment}`);
    }
  }
  return segments.join('/');
}

function safeSource(source) {
  const text = safeText(source, 'Starter source', 2_048);
  if (credentialPattern.test(text)) throw new Error('Starter source is credential-shaped or contains URL user information.');
  try {
    const url = new URL(text);
    if (url.username || url.password) throw new Error('Starter source contains URL user information.');
  } catch (error) {
    if (/user information/.test(error.message)) throw error;
  }
  return text;
}

export function classifyStarterSource(source) {
  const text = safeSource(source);
  if (/^git\+https?:/i.test(text) || /\.git(?:#|$)/i.test(text)) return 'git';
  if (/^https:/i.test(text)) return 'https';
  if (/^(?:file:|\.?\.?[\\/])/i.test(text)) return 'directory';
  if (/\.(?:zip|tar|tgz|tar\.gz)(?:[?#]|$)/i.test(text)) return 'archive';
  if (/^(?:npm|pkg|package):/i.test(text)) return 'package';
  return 'opaque';
}

function validatePathSegment(path, label) {
  const normalised = normaliseRelative(path, label, { allowDot: false });
  if (Buffer.byteLength(normalised) > defaultTreeLimits.maximumPathBytes) throw new Error(`${label} exceeds the path-byte limit.`);
  return normalised;
}

function walkPackage(root, current, limits, entries, depth = 0) {
  if (depth > limits.maximumDepth) throw new Error('Starter adapter package exceeds its maximum depth.');
  for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = resolve(current, entry.name);
    const metadata = lstatSync(absolute);
    if (metadata.isSymbolicLink()) throw new Error(`Starter adapter package may not contain symbolic links: ${entry.name}`);
    const path = validatePathSegment(relative(root, absolute).replaceAll('\\', '/'), 'Starter adapter package path');
    if (metadata.isDirectory()) {
      walkPackage(root, absolute, limits, entries, depth + 1);
      continue;
    }
    if (!metadata.isFile()) throw new Error(`Starter adapter package contains unsupported content: ${path}`);
    if (metadata.nlink > 1) throw new Error(`Starter adapter package contains a hard-link alias: ${path}`);
    const realFile = realpathSync(absolute);
    if (!within(root, realFile)) throw new Error(`Starter adapter package content escapes its root: ${path}`);
    entries.push({ path, bytes: readFileSync(absolute) });
    if (entries.length > limits.maximumFiles) throw new Error('Starter adapter package exceeds its file-count limit.');
    const total = entries.reduce((sum, item) => sum + item.bytes.length, 0);
    if (total > limits.maximumBytes) throw new Error('Starter adapter package exceeds its byte limit.');
  }
}

export function validateStarterAdapterPackage(folder, options = {}) {
  const requestedRoot = resolve(folder);
  if (!existsSync(requestedRoot)) throw new Error(`Starter adapter package does not exist: ${folder}`);
  if (lstatSync(requestedRoot).isSymbolicLink() || !lstatSync(requestedRoot).isDirectory()) {
    throw new Error('Starter adapter package root must be a non-symbolic directory.');
  }
  const root = realpathSync(requestedRoot);
  const manifestPath = resolve(root, 'starter-adapter.json');
  if (!existsSync(manifestPath) || lstatSync(manifestPath).isSymbolicLink() || !lstatSync(manifestPath).isFile()) {
    throw new Error('Starter adapter package requires a regular starter-adapter.json manifest.');
  }
  if (lstatSync(manifestPath).size > 64 * 1024) throw new Error('Starter adapter manifest exceeds its byte limit.');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Starter adapter manifest is invalid JSON: ${error.message}`);
  }
  strictObject(manifest, new Set(['schema', 'id', 'name', 'publisher', 'version', 'protocolVersion', 'sourceClasses', 'entrypoint']), 'Starter adapter manifest');
  if (manifest.schema !== 'ewai.starter-source-adapter/v1') throw new Error('Unsupported starter adapter schema.');
  const id = safeText(manifest.id, 'Starter adapter ID', 80);
  if (!slugPattern.test(id)) throw new Error('Starter adapter ID is invalid.');
  const name = safeText(manifest.name, 'Starter adapter name');
  strictObject(manifest.publisher, new Set(['id', 'name']), 'Starter adapter publisher');
  const publisher = {
    id: safeText(manifest.publisher.id, 'Starter adapter publisher ID', 80),
    name: safeText(manifest.publisher.name, 'Starter adapter publisher name'),
  };
  if (!rolePattern.test(publisher.id)) throw new Error('Starter adapter publisher ID is invalid.');
  const version = safeText(manifest.version, 'Starter adapter version', 80);
  if (!versionPattern.test(version)) throw new Error('Starter adapter version is invalid.');
  if (String(manifest.protocolVersion) !== '1') throw new Error('Unsupported starter adapter protocol version.');
  if (!Array.isArray(manifest.sourceClasses) || !manifest.sourceClasses.length || manifest.sourceClasses.length > STARTER_SOURCE_CLASSES.length) {
    throw new Error('Starter adapter source classes must be a non-empty bounded array.');
  }
  const sourceClasses = manifest.sourceClasses.map((item) => safeText(item, 'Starter adapter source class', 40));
  if (new Set(sourceClasses).size !== sourceClasses.length || sourceClasses.some((item) => !sourceClassSet.has(item))) {
    throw new Error('Starter adapter source classes are invalid or duplicated.');
  }
  const entrypoint = normaliseRelative(manifest.entrypoint, 'Starter adapter entrypoint', { allowDot: false });
  const entrypointPath = resolve(root, entrypoint);
  if (!within(root, entrypointPath) || !existsSync(entrypointPath) || lstatSync(entrypointPath).isSymbolicLink() || !lstatSync(entrypointPath).isFile()) {
    throw new Error('Starter adapter entrypoint must be a regular file inside its package.');
  }
  accessSync(entrypointPath, constants.X_OK);
  const limits = { ...defaultAdapterLimits, ...(options.limits ?? {}) };
  const entries = [];
  walkPackage(root, root, limits, entries);
  entries.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  const packageHash = createHash('sha256').update('ewai.starter-adapter-package/v1\0');
  for (const entry of entries) packageHash.update(`${Buffer.byteLength(entry.path)}:`).update(entry.path).update(`:${entry.bytes.length}:`).update(entry.bytes).update('\0');
  return {
    schema: manifest.schema,
    id,
    name,
    publisher,
    version,
    protocolVersion: '1',
    sourceClasses,
    entrypoint,
    manifestDigest: sha256(readFileSync(manifestPath)),
    packageDigest: `sha256:${packageHash.digest('hex')}`,
    packageFiles: entries.length,
    packageBytes: entries.reduce((sum, item) => sum + item.bytes.length, 0),
    trustedRoot: root,
    entrypointPath,
  };
}

function readRegularFile(root, absolute, path, limits, usage) {
  const beforeRealPath = realpathSync(absolute);
  if (!within(root, beforeRealPath)) throw new Error(`Starter tree file escapes its root: ${path}`);
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const descriptor = openSync(absolute, constants.O_RDONLY | noFollow);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile()) throw new Error(`Starter tree content must be a regular file: ${path}`);
    if (before.nlink > 1) throw new Error(`Starter tree contains a hard-link alias: ${path}`);
    if (before.size > limits.maximumFileBytes) throw new Error(`Starter tree file exceeds its byte limit: ${path}`);
    const content = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const afterRealPath = realpathSync(absolute);
    if (!within(root, afterRealPath) || beforeRealPath !== afterRealPath || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || content.length !== after.size) {
      throw new Error(`Starter tree file changed while it was read: ${path}`);
    }
    usage.totalBytes += content.length;
    if (usage.totalBytes > limits.maximumTotalBytes) throw new Error('Starter tree exceeds its total-byte limit.');
    return { content, metadata: before };
  } finally {
    closeSync(descriptor);
  }
}

function walkTree(root, current, limits, files, collisions, usage, depth = 0) {
  if (depth > limits.maximumDepth) throw new Error('Starter tree exceeds its maximum depth.');
  for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = resolve(current, entry.name);
    const metadata = lstatSync(absolute);
    const path = validatePathSegment(relative(root, absolute).replaceAll('\\', '/'), 'Starter tree path');
    const collisionKey = path.normalize('NFC').toLocaleLowerCase('en-US');
    if (collisions.has(collisionKey)) throw new Error(`Starter tree contains a case or Unicode-equivalent path collision: ${path}`);
    collisions.add(collisionKey);
    if (metadata.isSymbolicLink()) throw new Error(`Starter tree may not contain a symbolic link: ${path}`);
    if (metadata.isDirectory()) {
      walkTree(root, absolute, limits, files, collisions, usage, depth + 1);
      continue;
    }
    if (!metadata.isFile()) throw new Error(`Starter tree contains unsupported special content: ${path}`);
    const { content, metadata: opened } = readRegularFile(root, absolute, path, limits, usage);
    files.push({
      path,
      bytes: content.length,
      digest: sha256(content),
      content,
      absolutePath: absolute,
      device: opened.dev,
      inode: opened.ino,
    });
    if (files.length > limits.maximumFiles) throw new Error('Starter tree exceeds its file-count limit.');
  }
}

export function canonicalStarterTree(root, options = {}) {
  const requestedRoot = resolve(root);
  if (!existsSync(requestedRoot) || lstatSync(requestedRoot).isSymbolicLink() || !lstatSync(requestedRoot).isDirectory()) {
    throw new Error('Starter tree root must be a non-symbolic directory.');
  }
  const realRoot = realpathSync(requestedRoot);
  const limits = { ...defaultTreeLimits, ...(options.limits ?? options ?? {}) };
  const files = [];
  walkTree(realRoot, realRoot, limits, files, new Set(), { totalBytes: 0 });
  files.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  return files;
}

export function starterTreeDigest(files) {
  if (!Array.isArray(files)) throw new Error('Starter tree digest requires a file inventory.');
  const hash = createHash('sha256').update('ewai.starter-tree/v1\0');
  for (const file of [...files].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)))) {
    const path = validatePathSegment(file.path, 'Starter tree digest path');
    const content = Buffer.isBuffer(file.content) ? file.content : readFileSync(file.absolutePath);
    hash.update(`${Buffer.byteLength(path)}:`).update(path).update(`:${content.length}:`).update(content).update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

export function starterPackDigest(targets) {
  if (!Array.isArray(targets) || !targets.length) throw new Error('Governed Starter Pack digest requires target trees.');
  const hash = createHash('sha256').update('ewai.governed-starter-pack/v1\0');
  for (const target of [...targets].sort((left, right) => left.role.localeCompare(right.role))) {
    const role = String(target.role ?? '');
    if (!rolePattern.test(role) || !digestPattern.test(String(target.digest ?? ''))) throw new Error('Governed Starter Pack target digest is invalid.');
    hash.update(`${Buffer.byteLength(role)}:`).update(role).update(`:${target.digest}\0`);
  }
  return `sha256:${hash.digest('hex')}`;
}

function assertNoSymbolicTraversal(root, relativePath, label) {
  let cursor = root;
  if (relativePath === '.') return;
  for (const segment of relativePath.split('/')) {
    cursor = resolve(cursor, segment);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error(`${label} may not traverse a symbolic link.`);
  }
}

function isProtectedMapping(projectRoot, specsRoot, repositoryRoot, mappingPath) {
  if (mappingPath !== '.') {
    const segments = mappingPath.split('/').map((segment) => segment.toLocaleLowerCase('en-US'));
    const last = segments.at(-1);
    if (segments.some((segment) => protectedRoots.has(segment)) || protectedFiles.has(last)) return true;
  }
  const destination = resolve(repositoryRoot, mappingPath);
  return destination === specsRoot || (within(specsRoot, destination) && destination !== projectRoot);
}

export function resolveStarterTargetMappings(projectRoot, receipt) {
  const root = resolve(projectRoot);
  const { config, paths } = loadProjectConfig(root);
  const realSpecsRoot = existsSync(paths.specsRoot) ? realpathSync(paths.specsRoot) : resolve(paths.specsRoot);
  const repositories = new Map();
  for (const repository of config.repositories ?? []) {
    strictObject(repository, new Set(['name', 'path', 'role']), 'Configured repository');
    const name = safeText(repository.name, 'Configured repository name', 120);
    if (repositories.has(name)) throw new Error(`Duplicate configured repository: ${name}`);
    const path = normaliseRelative(repository.path, `Configured repository ${name} path`);
    const absolute = resolve(root, path);
    if (!within(root, absolute) || !existsSync(absolute) || lstatSync(absolute).isSymbolicLink() || !lstatSync(absolute).isDirectory()) {
      throw new Error(`Configured repository must be a non-symbolic directory inside the workspace: ${name}`);
    }
    const realRoot = realpathSync(absolute);
    repositories.set(name, { name, role: safeText(repository.role, 'Configured repository role'), path, root: realRoot });
  }
  const configuredTargets = config.starter_materialisation?.targets;
  if (!Array.isArray(configuredTargets) || !configuredTargets.length) throw new Error('Project starter_materialisation.targets must map every logical role.');
  const byRole = new Map();
  for (const item of configuredTargets) {
    strictObject(item, new Set(['role', 'repository', 'path']), 'Starter target mapping');
    const role = safeText(item.role, 'Starter target role', 80);
    if (!rolePattern.test(role) || byRole.has(role)) throw new Error(`Starter target role is invalid or duplicated: ${role}`);
    const repository = repositories.get(safeText(item.repository, 'Starter target repository', 120));
    if (!repository) throw new Error(`Starter target references an unknown repository: ${item.repository}`);
    const path = normaliseRelative(item.path, `Starter target ${role} path`);
    assertNoSymbolicTraversal(repository.root, path, `Starter target ${role}`);
    if (isProtectedMapping(root, realSpecsRoot, repository.root, path)) throw new Error(`Starter target ${role} resolves into a protected destination.`);
    byRole.set(role, {
      role,
      repository: repository.name,
      repositoryRole: repository.role,
      repositoryPath: repository.path,
      path,
      repositoryRoot: repository.root,
      destinationRoot: resolve(repository.root, path),
    });
  }
  const receiptTargets = Array.isArray(receipt?.targets) ? receipt.targets : [];
  if (!receiptTargets.length) throw new Error('Governed Starter Pack receipt declares no logical targets.');
  const required = new Set();
  const resolved = receiptTargets.map((item) => {
    const role = safeText(item.role, 'Governed Starter Pack target role', 80);
    if (!rolePattern.test(role) || required.has(role)) throw new Error(`Governed Starter Pack target role is invalid or duplicated: ${role}`);
    required.add(role);
    const mapping = byRole.get(role);
    if (!mapping) throw new Error(`Project topology does not map Governed Starter Pack role: ${role}`);
    return { ...mapping, sourcePath: normaliseRelative(item.sourcePath ?? item.source_path, `Governed Starter Pack ${role} source path`) };
  });
  const unused = [...byRole.keys()].filter((role) => !required.has(role));
  if (unused.length) throw new Error(`Project topology contains roles not declared by this Governed Starter Pack: ${unused.join(', ')}`);
  for (let index = 0; index < resolved.length; index += 1) {
    for (let other = index + 1; other < resolved.length; other += 1) {
      if (resolved[index].repository !== resolved[other].repository) continue;
      const left = resolved[index].path;
      const right = resolved[other].path;
      if (left === right || left === '.' || right === '.' || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)) {
        throw new Error(`Starter target mappings overlap in repository ${resolved[index].repository}: ${left} and ${right}`);
      }
    }
  }
  return resolved.sort((left, right) => left.role.localeCompare(right.role));
}

function gitOutput(root, args, fallback = '') {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return fallback;
  }
}

export function starterProjectRevision(targets) {
  const repositories = new Map();
  for (const target of targets ?? []) {
    if (repositories.has(target.repository)) continue;
    const top = gitOutput(target.repositoryRoot, ['rev-parse', '--show-toplevel']).trim();
    if (!top || realpathSync(top) !== realpathSync(target.repositoryRoot)) throw new Error(`Configured repository is not its own Git working tree: ${target.repository}`);
    const head = gitOutput(target.repositoryRoot, ['rev-parse', '--verify', 'HEAD'], 'unborn').trim() || 'unborn';
    const status = gitOutput(target.repositoryRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    repositories.set(target.repository, {
      name: target.repository,
      revision: sha256(`ewai.starter-repository-revision/v1\0${head}\0${status}`),
      head,
      dirty: Boolean(status),
    });
  }
  const ordered = [...repositories.values()].sort((left, right) => left.name.localeCompare(right.name));
  return {
    schema: 'ewai.starter-project-revision/v1',
    repositories: ordered,
    digest: sha256(JSON.stringify(ordered)),
  };
}
