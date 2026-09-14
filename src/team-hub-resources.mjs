import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { z } from 'zod';
import YAML from 'yaml';
import { parseOrganisationBlueprintPack } from './organisation-blueprints.mjs';
import { parseDesignSystemPack } from './design-systems.mjs';

export const TEAM_HUB_RESOURCE_LIMITS = Object.freeze({
  maximumFiles: 100,
  maximumFileBytes: 256 * 1024,
  maximumTotalBytes: 2 * 1024 * 1024,
  maximumPackageBytes: (2 * 1024 * 1024) + (512 * 1024),
});

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const resourceId = z.string().regex(/^org\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
const semanticVersion = z.string().regex(/^\d+\.\d+\.\d+$/);
const safeExtensions = new Set(['.md', '.yaml', '.yml', '.json', '.txt', '.toml', '.css']);
const textDecoder = new TextDecoder('utf-8', { fatal: true });

const fileSchema = z.object({
  path: z.string().min(1).max(240),
  size: z.number().int().min(0).max(TEAM_HUB_RESOURCE_LIMITS.maximumFileBytes),
  digest,
  content: z.string(),
}).strict();

const packageSchema = z.object({
  schema: z.literal('ewai.team-hub-resource-package/v1'),
  resource: z.object({
    kind: z.enum(['organisation-blueprint', 'design-system']),
    id: resourceId,
    name: z.string().min(1).max(160),
    description: z.string().max(1_000),
    version: semanticVersion,
    publisher: z.object({
      id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      name: z.string().min(1).max(160),
    }).strict(),
    compatibility: z.object({ ewai: z.string().regex(/^\d+\.x$/) }).strict(),
  }).strict(),
  files: z.array(fileSchema).min(1).max(TEAM_HUB_RESOURCE_LIMITS.maximumFiles),
  digest,
}).strict();

function resourceError(message, code = 'invalid-resource-package', status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function fileDigest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function normalizedPackage(value) {
  return {
    schema: value.schema,
    resource: value.resource,
    files: [...value.files]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map(({ path, size, digest: itemDigest, content }) => ({ path, size, digest: itemDigest, content })),
  };
}

export function teamHubResourcePackageDigest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(normalizedPackage(value))).digest('hex')}`;
}

function safeResourcePath(value) {
  const path = String(value ?? '').replaceAll('\\', '/');
  const segments = path.split('/');
  if (!path || path.length > 240 || isAbsolute(path) || segments.some((segment) => !segment || segment === '..' || segment.startsWith('.'))) {
    throw resourceError(`Resource file path is not safe: ${value}`, 'unsafe-resource-path');
  }
  if (/[^\t\n\r\x20-\x7e]/.test(path) || !safeExtensions.has(extname(path).toLowerCase())) {
    throw resourceError(`Resource file type or path is not supported: ${value}`, 'unsupported-resource-file');
  }
  return path;
}

function readPackFile(root, source) {
  const safePath = safeResourcePath(source);
  const candidate = resolve(root, safePath);
  const boundary = relative(root, candidate);
  if (boundary.startsWith('..') || isAbsolute(boundary)) throw resourceError(`Resource file escapes the pack root: ${safePath}`, 'unsafe-resource-path');
  if (!existsSync(candidate)) throw resourceError(`Resource file does not exist: ${safePath}`, 'missing-resource-file');
  if (lstatSync(candidate).isSymbolicLink()) throw resourceError(`Resource files may not be symbolic links: ${safePath}`, 'unsafe-resource-symlink');
  if (!statSync(candidate).isFile()) throw resourceError(`Resource path must be a file: ${safePath}`, 'invalid-resource-file');
  const realRoot = realpathSync(root);
  const realCandidate = realpathSync(candidate);
  const realBoundary = relative(realRoot, realCandidate);
  if (realBoundary.startsWith('..') || isAbsolute(realBoundary)) throw resourceError(`Resource file escapes the pack root: ${safePath}`, 'unsafe-resource-path');
  const bytes = readFileSync(realCandidate);
  if (bytes.length > TEAM_HUB_RESOURCE_LIMITS.maximumFileBytes) throw resourceError(`Resource file exceeds 256 KiB: ${safePath}`, 'resource-file-too-large');
  let content;
  try { content = textDecoder.decode(bytes); }
  catch { throw resourceError(`Resource file must contain valid UTF-8 text: ${safePath}`, 'invalid-resource-text'); }
  if (content.includes('\0')) throw resourceError(`Resource file contains binary NUL content: ${safePath}`, 'invalid-resource-text');
  return { path: safePath, size: bytes.length, digest: fileDigest(bytes), content };
}

function referencedPaths(pack) {
  if (pack.type === 'organisation') {
    return pack.blueprint.modules.flatMap((module) => [
      ...module.standards.map(({ source }) => source),
      ...module.personas.map(({ source }) => source),
      ...module.policies.map(({ source }) => source),
    ]);
  }
  return pack.design_system.contributions.map(({ source }) => source);
}

function validateManifestBinding(value) {
  const manifestFile = value.files.find(({ path }) => path === 'pack.yaml');
  let manifest;
  try { manifest = YAML.parse(manifestFile?.content ?? ''); }
  catch { throw resourceError('Resource pack.yaml must contain valid YAML.', 'invalid-resource-manifest'); }
  if (!manifest || manifest.schema !== 'ewai.pack/v1') throw resourceError('Resource pack.yaml must use ewai.pack/v1.', 'invalid-resource-manifest');
  const expectedKind = manifest.type === 'organisation' ? 'organisation-blueprint' : manifest.type === 'design-system' ? 'design-system' : null;
  if (!expectedKind || expectedKind !== value.resource.kind) throw resourceError('Resource kind disagrees with pack.yaml.', 'resource-manifest-mismatch');
  for (const [field, expected] of [['id', manifest.id], ['name', manifest.name], ['version', manifest.version]]) {
    if (value.resource[field] !== expected) throw resourceError(`Resource ${field} disagrees with pack.yaml.`, 'resource-manifest-mismatch');
  }
  if (value.resource.description !== String(manifest.description ?? '')) throw resourceError('Resource description disagrees with pack.yaml.', 'resource-manifest-mismatch');

  const definition = manifest.type === 'organisation' ? manifest.blueprint : manifest.design_system;
  if (!definition || value.resource.compatibility.ewai !== definition.compatibility?.ewai) {
    throw resourceError('Resource compatibility disagrees with pack.yaml.', 'resource-manifest-mismatch');
  }
  const expectedPublisherId = manifest.type === 'organisation' ? definition.publisher?.id : String(manifest.id ?? '').split('.')[1];
  if (value.resource.publisher.id !== expectedPublisherId) throw resourceError('Resource publisher disagrees with pack.yaml.', 'resource-manifest-mismatch');
  if (manifest.type === 'organisation' && value.resource.publisher.name !== definition.publisher?.name) {
    throw resourceError('Resource publisher name disagrees with pack.yaml.', 'resource-manifest-mismatch');
  }

  const references = manifest.type === 'organisation'
    ? (definition.modules ?? []).flatMap((module) => [
      ...(module.standards ?? []).map(({ source }) => source),
      ...(module.personas ?? []).map(({ source }) => source),
      ...(module.policies ?? []).map(({ source }) => source),
    ])
    : (definition.contributions ?? []).map(({ source }) => source);
  const expectedPaths = [...new Set(['pack.yaml', ...references.map(safeResourcePath)])].sort();
  const actualPaths = value.files.map(({ path }) => path).sort();
  if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) {
    throw resourceError('Resource file set disagrees with the files referenced by pack.yaml.', 'resource-manifest-mismatch');
  }
}

export function buildTeamHubResourcePackage(folder, options = {}) {
  const root = resolve(String(folder ?? ''));
  if (!String(folder ?? '').trim() || !existsSync(root) || !statSync(root).isDirectory()) {
    throw resourceError('Resource publication requires an existing pack folder.', 'invalid-resource-folder');
  }
  if (lstatSync(root).isSymbolicLink()) throw resourceError('Resource pack folder must not be a symbolic link.', 'unsafe-resource-symlink');
  const manifestPath = resolve(root, 'pack.yaml');
  if (!existsSync(manifestPath) || basename(manifestPath) !== 'pack.yaml') throw resourceError('Resource pack requires pack.yaml.', 'missing-resource-manifest');

  const organisation = parseOrganisationBlueprintPack(manifestPath, 'team-hub-candidate', {
    limits: { manifestBytes: TEAM_HUB_RESOURCE_LIMITS.maximumFileBytes, itemBytes: TEAM_HUB_RESOURCE_LIMITS.maximumFileBytes, totalBytes: TEAM_HUB_RESOURCE_LIMITS.maximumTotalBytes },
  });
  const pack = organisation ?? parseDesignSystemPack(manifestPath, 'team-hub-candidate', {
    limits: { manifestBytes: TEAM_HUB_RESOURCE_LIMITS.maximumFileBytes, itemBytes: TEAM_HUB_RESOURCE_LIMITS.maximumFileBytes, totalBytes: TEAM_HUB_RESOURCE_LIMITS.maximumTotalBytes, maximumFiles: TEAM_HUB_RESOURCE_LIMITS.maximumFiles },
  });
  if (!pack) throw resourceError('Team Hub supports only organisation Blueprint and design-system packs.', 'unsupported-resource-kind');
  if (!pack.id.startsWith('org.')) throw resourceError('Team Hub resources must use an organisation-owned org.* ID.', 'unsupported-resource-id');

  const publisherId = pack.type === 'organisation' ? pack.blueprint.publisher.id : pack.id.split('.')[1];
  const publisherName = pack.type === 'organisation'
    ? pack.blueprint.publisher.name
    : String(options.publisherName ?? '').trim();
  if (!publisherName) throw resourceError('Design-system publication requires a publisher name.', 'missing-publisher-name');
  const compatibility = pack.type === 'organisation' ? pack.blueprint.compatibility : pack.design_system.compatibility;
  const paths = [...new Set(['pack.yaml', ...referencedPaths(pack)])].sort();
  const files = paths.map((path) => readPackFile(root, path));
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (files.length > TEAM_HUB_RESOURCE_LIMITS.maximumFiles) throw resourceError('Resource package exceeds 100 files.', 'resource-file-limit');
  if (total > TEAM_HUB_RESOURCE_LIMITS.maximumTotalBytes) throw resourceError('Resource package exceeds 2 MiB.', 'resource-package-too-large');

  const value = {
    schema: 'ewai.team-hub-resource-package/v1',
    resource: {
      kind: pack.type === 'organisation' ? 'organisation-blueprint' : 'design-system',
      id: pack.id,
      name: pack.name,
      description: pack.description ?? '',
      version: pack.version,
      publisher: { id: publisherId, name: publisherName },
      compatibility: { ...compatibility },
    },
    files,
    digest: `sha256:${'0'.repeat(64)}`,
  };
  value.digest = teamHubResourcePackageDigest(value);
  return validateTeamHubResourcePackage(value);
}

export function validateTeamHubResourcePackage(input) {
  let value;
  try { value = packageSchema.parse(input); }
  catch (error) {
    const details = error.issues?.map((issue) => `${issue.path.join('.') || 'package'} ${issue.message}`).join('; ') ?? error.message;
    throw resourceError(`Team Hub resource package is invalid: ${details}`);
  }
  if (value.resource.id.split('.')[1] !== value.resource.publisher.id) {
    throw resourceError('Resource publisher ID must match the organisation segment in the resource ID.', 'publisher-mismatch');
  }
  const seen = new Set();
  let total = 0;
  for (const file of value.files) {
    const path = safeResourcePath(file.path);
    if (seen.has(path)) throw resourceError(`Resource package repeats a file path: ${path}`, 'duplicate-resource-file');
    seen.add(path);
    let bytes;
    try { bytes = Buffer.from(file.content, 'utf8'); textDecoder.decode(bytes); }
    catch { throw resourceError(`Resource file must contain valid UTF-8 text: ${path}`, 'invalid-resource-text'); }
    if (bytes.length !== file.size) throw resourceError(`Resource file size disagrees with its content: ${path}`, 'resource-size-mismatch');
    if (fileDigest(bytes) !== file.digest) throw resourceError(`Resource file digest disagrees with its content: ${path}`, 'resource-digest-mismatch');
    total += bytes.length;
  }
  if (!seen.has('pack.yaml')) throw resourceError('Resource package must contain pack.yaml.', 'missing-resource-manifest');
  if (total > TEAM_HUB_RESOURCE_LIMITS.maximumTotalBytes) throw resourceError('Resource package exceeds 2 MiB.', 'resource-package-too-large');
  validateManifestBinding(value);
  const expected = teamHubResourcePackageDigest(value);
  if (value.digest !== expected) throw resourceError('Resource package digest disagrees with its content.', 'resource-package-digest-mismatch');
  return { ...value, files: [...value.files].sort((left, right) => left.path.localeCompare(right.path)) };
}

export function projectTeamHubResourceRelease(value) {
  const pack = validateTeamHubResourcePackage(value);
  return {
    schema: 'ewai.team-hub-resource-release/v1',
    ...pack.resource,
    digest: pack.digest,
    fileCount: pack.files.length,
    totalBytes: pack.files.reduce((sum, file) => sum + file.size, 0),
  };
}
