import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { z } from 'zod';
import { defaultPackRoot } from './packs.mjs';
import { validateSourceMapProfile } from './repository-source-map.mjs';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const packageVersion = JSON.parse(readFileSync(resolve(moduleDirectory, '../package.json'), 'utf8')).version;
const currentEwaiMajor = Number(packageVersion.split('.')[0]);
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lower-case slug');
const relativeContentPath = z.string().min(1).refine(
  (value) => !isAbsolute(value) && !value.includes('\0') && !value.split(/[\\/]+/).includes('..'),
  'must be a bounded relative path'
);

function safeStarterSource(value) {
  const text = String(value ?? '');
  if (!text || text.length > 2048 || /[\u0000-\u001f\u007f]/.test(text)) return false;
  if (/(?:Bearer\s+[A-Za-z0-9._~+\/-]{12,}|sk-[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i.test(text)) return false;
  try {
    const url = new URL(text);
    return !url.username && !url.password;
  } catch {
    return true;
  }
}

const standardSchema = z.object({
  id: slug,
  title: z.string().min(1),
  source: relativeContentPath
}).strict();

const personaSchema = z.object({
  id: slug,
  name: z.string().min(1).optional(),
  source: relativeContentPath
}).strict();

const policySchema = z.object({
  id: slug,
  title: z.string().min(1),
  source: relativeContentPath
}).strict();

const boilerplateSchema = z.object({
  id: slug,
  name: z.string().min(1),
  source: z.string().min(1).refine(safeStarterSource, 'must not contain credentials, URL user information, or control characters'),
  version: z.string().min(1),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  licence: z.string().min(1),
  compatibility: z.string().min(1)
}).strict();

const starterTargetSchema = z.object({
  role: slug,
  source_path: relativeContentPath
}).strict();

const starterPackSchema = boilerplateSchema.extend({
  targets: z.array(starterTargetSchema).min(1)
}).strict();

const blueprintModuleSchema = z.object({
  id: slug,
  name: z.string().min(1),
  description: z.string().min(1),
  required: z.boolean(),
  standards: z.array(standardSchema).default([]),
  personas: z.array(personaSchema).default([]),
  policies: z.array(policySchema).default([]),
  design_systems: z.array(z.string().regex(/^(?:ewai\.[a-z0-9.-]+|org\.[a-z0-9-]+\.[a-z0-9.-]+)$/)).default([]),
  starter_packs: z.array(starterPackSchema).default([]),
  boilerplates: z.array(boilerplateSchema).default([])
}).strict();

const uniqueStrings = z.array(z.string().min(1)).refine(values => new Set(values).size === values.length, 'must not contain duplicates');
const sourceMapProfileSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
  patterns: uniqueStrings.refine(values => values.length > 0, 'requires at least one pattern'),
  analyser: z.string(),
  classification: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  priority: z.number().int().optional(),
  repositories: uniqueStrings.optional(),
  max_bytes: z.number().int().optional()
}).strict().superRefine((profile, context) => {
  try { validateSourceMapProfile(profile); }
  catch (error) { context.addIssue({ code: 'custom', message: error.message }); }
});

const organisationPackSchema = z.object({
  schema: z.literal('ewai.pack/v1'),
  id: z.string().regex(/^org\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  type: z.literal('organisation'),
  requires: z.array(z.string().regex(/^org\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/)).default([]),
  source_map: z.object({
    profiles: z.array(sourceMapProfileSchema).min(1).refine(profiles => new Set(profiles.map(profile => profile.id)).size === profiles.length, 'duplicate Source Map profile id')
  }).strict().optional(),
  blueprint: z.object({
    publisher: z.object({ id: slug, name: z.string().min(1) }).strict(),
    compatibility: z.object({ ewai: z.string().regex(/^\d+\.x$/) }).strict(),
    modules: z.array(blueprintModuleSchema).min(1)
  }).strict()
}).strict().superRefine((pack, context) => {
  if (pack.id.split('.')[1] !== pack.blueprint.publisher.id) {
    context.addIssue({
      code: 'custom',
      path: ['blueprint', 'publisher', 'id'],
      message: 'publisher id must match the publisher segment in the pack id'
    });
  }
  const duplicate = (items) => items.find((item, index) => items.indexOf(item) !== index);
  const moduleDuplicate = duplicate(pack.blueprint.modules.map((module) => module.id));
  if (moduleDuplicate) {
    context.addIssue({ code: 'custom', path: ['blueprint', 'modules'], message: `duplicate module id: ${moduleDuplicate}` });
  }
  for (const [index, module] of pack.blueprint.modules.entries()) {
    for (const [field, items] of [
      ['standards', module.standards], ['personas', module.personas], ['policies', module.policies],
      ['starter_packs', module.starter_packs], ['boilerplates', module.boilerplates]
    ]) {
      const itemDuplicate = duplicate(items.map((item) => item.id));
      if (itemDuplicate) {
        context.addIssue({
          code: 'custom',
          path: ['blueprint', 'modules', index, field],
          message: `duplicate ${field} id: ${itemDuplicate}`
        });
      }
    }
    const starterDuplicate = duplicate([...module.starter_packs, ...module.boilerplates].map((item) => item.id));
    if (starterDuplicate) {
      context.addIssue({
        code: 'custom',
        path: ['blueprint', 'modules', index],
        message: `duplicate Governed Starter Pack id across starter_packs and legacy boilerplates: ${starterDuplicate}`
      });
    }
  }
});

const defaultLimits = Object.freeze({
  manifestBytes: 256 * 1024,
  itemBytes: 1024 * 1024,
  totalBytes: 5 * 1024 * 1024,
  maximumDepth: 8
});

function within(root, candidate) {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function rootRecords(roots) {
  return roots.map((root, index) => {
    if (typeof root === 'string') return { path: resolve(root), sourceClass: index === 0 ? 'bundled' : 'installed' };
    return {
      path: resolve(root.path),
      sourceClass: String(root.sourceClass ?? (index === 0 ? 'bundled' : 'installed'))
    };
  });
}

function packFiles(root, maximumDepth, depth = 0) {
  if (!existsSync(root) || depth > maximumDepth) return [];
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) found.push(...packFiles(path, maximumDepth, depth + 1));
    if (entry.isFile() && entry.name === 'pack.yaml') found.push(path);
  }
  return found;
}

function contentFile(packRoot, source, limits, usage) {
  if (isAbsolute(source) || source.includes('\0') || source.split(/[\\/]+/).includes('..')) {
    throw new Error(`Blueprint content source must be a bounded relative path: ${source}`);
  }
  const candidate = resolve(packRoot, source);
  if (!within(packRoot, candidate)) throw new Error(`Blueprint content source may not escape its pack root: ${source}`);
  if (!existsSync(candidate)) throw new Error(`Blueprint content source does not exist: ${source}`);
  if (lstatSync(candidate).isSymbolicLink()) throw new Error(`Blueprint content source may not be a symbolic link: ${source}`);
  const realRoot = realpathSync(packRoot);
  const realCandidate = realpathSync(candidate);
  if (!within(realRoot, realCandidate)) throw new Error(`Blueprint content source may not escape its pack root: ${source}`);
  const metadata = statSync(realCandidate);
  if (!metadata.isFile()) throw new Error(`Blueprint content source must be a file: ${source}`);
  if (metadata.size > limits.itemBytes) throw new Error(`Blueprint content source exceeds its size limit: ${source}`);
  usage.total += metadata.size;
  if (usage.total > limits.totalBytes) throw new Error('Blueprint referenced content exceeds its total size limit');
  const bytes = readFileSync(realCandidate);
  return { source, bytes, content: bytes.toString('utf8') };
}

export function parseOrganisationBlueprintPack(manifestPath, sourceClass = 'installed', options = {}) {
  const limits = { ...defaultLimits, ...(options.limits ?? {}) };
  const manifestMetadata = statSync(manifestPath);
  if (manifestMetadata.size > limits.manifestBytes) {
    throw new Error(`Organisation blueprint manifest exceeds its size limit: ${manifestPath}`);
  }
  const manifestBytes = readFileSync(manifestPath);
  let parsed;
  try {
    parsed = YAML.parse(manifestBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Organisation blueprint manifest is invalid YAML at ${manifestPath}: ${error.message}`);
  }
  if (parsed?.type !== 'organisation') return null;
  let pack;
  try {
    pack = organisationPackSchema.parse(parsed);
  } catch (error) {
    const details = error.issues?.map((issue) => `${issue.path.join('.') || 'manifest'} ${issue.message}`).join('; ') ?? error.message;
    throw new Error(`Organisation blueprint manifest is invalid at ${manifestPath}: ${details}`);
  }

  const packRoot = dirname(manifestPath);
  const usage = { total: 0 };
  const files = new Map();
  const readContent = (source) => {
    if (!files.has(source)) files.set(source, contentFile(packRoot, source, limits, usage));
    return files.get(source).content;
  };
  const modules = pack.blueprint.modules.map((module) => ({
    ...module,
    standards: module.standards.map((item) => ({ ...item, content: readContent(item.source) })),
    personas: module.personas.map((item) => ({ ...item, content: readContent(item.source) })),
    policies: module.policies.map((item) => ({ ...item, content: readContent(item.source) })),
    starterPacks: [
      ...module.starter_packs.map((item) => ({
        ...item,
        targets: item.targets.map((target) => ({ role: target.role, sourcePath: target.source_path })),
        legacy: false
      })),
      ...module.boilerplates.map((item) => ({
        ...item,
        targets: [{ role: 'application', sourcePath: '.' }],
        legacy: true
      }))
    ],
    boilerplates: module.boilerplates.map((item) => ({ ...item }))
  }));
  const hash = createHash('sha256').update(manifestBytes).update('\0');
  for (const file of [...files.values()].sort((left, right) => left.source.localeCompare(right.source))) {
    hash.update(file.source).update('\0').update(file.bytes).update('\0');
  }
  const requiredMajor = Number(pack.blueprint.compatibility.ewai.split('.')[0]);
  return {
    ...pack,
    blueprint: { ...pack.blueprint, modules },
    manifestPath,
    packRoot,
    sourceClass,
    digest: `sha256:${hash.digest('hex')}`,
    compatible: requiredMajor === currentEwaiMajor,
    compatibilityReason: requiredMajor === currentEwaiMajor
      ? `Compatible with EWAI ${currentEwaiMajor}.x`
      : `Requires EWAI ${requiredMajor}.x; this runtime is ${packageVersion}`
  };
}

export function defaultOrganisationBlueprintRoots(projectRoot, options = {}) {
  const home = resolve(options.home ?? homedir());
  const roots = [
    { path: defaultPackRoot, sourceClass: 'bundled' },
    { path: resolve(home, '.ewai/packs'), sourceClass: 'personal' }
  ];
  if (projectRoot) roots.push({ path: resolve(projectRoot, '.ewai-pipeline/packs'), sourceClass: 'project' });
  return roots;
}

export function listOrganisationBlueprints(options = {}) {
  const limits = { ...defaultLimits, ...(options.limits ?? {}) };
  const roots = rootRecords(options.roots ?? defaultOrganisationBlueprintRoots(options.projectRoot, options));
  const catalogue = [];
  for (const root of roots) {
    for (const manifestPath of packFiles(root.path, limits.maximumDepth).sort()) {
      const pack = parseOrganisationBlueprintPack(manifestPath, root.sourceClass, { limits });
      if (pack) catalogue.push(pack);
    }
  }
  const byId = new Map();
  for (const pack of catalogue) {
    if (byId.has(pack.id)) {
      throw new Error(`Duplicate organisation blueprint id across installed roots: ${pack.id}`);
    }
    byId.set(pack.id, pack);
  }
  return catalogue.sort((left, right) => left.id.localeCompare(right.id) || left.version.localeCompare(right.version));
}

function safeModule(module) {
  const starterPacks = module.starterPacks.map(({ id, name, source, version, digest, licence, compatibility, targets, legacy }) => ({
    id, name, source, version, digest, licence, compatibility,
    targets: targets.map((target) => ({ ...target })),
    ...(legacy ? { legacy: true } : {})
  }));
  return {
    id: module.id,
    name: module.name,
    description: module.description,
    required: module.required,
    standards: module.standards.map(({ id, title }) => ({ id, title })),
    personas: module.personas.map(({ id, name }) => ({ id, ...(name ? { name } : {}) })),
    policies: module.policies.map(({ id, title }) => ({ id, title })),
    designSystems: [...module.design_systems],
    boilerplates: module.boilerplates.map(({ id, name, source, version, digest, licence, compatibility }) => ({
      id, name, source, version, digest, licence, compatibility
    })),
    starterPacks,
    counts: {
      standards: module.standards.length,
      personas: module.personas.length,
      policies: module.policies.length,
      designSystems: module.design_systems.length,
      boilerplates: module.boilerplates.length,
      starterPacks: starterPacks.length
    }
  };
}

function safePack(pack) {
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description ?? '',
    version: pack.version,
    publisher: { ...pack.blueprint.publisher },
    compatibility: { ...pack.blueprint.compatibility },
    compatible: pack.compatible,
    compatibilityReason: pack.compatibilityReason,
    sourceClass: pack.sourceClass,
    digest: pack.digest,
    requires: [...pack.requires],
    modules: pack.blueprint.modules.map(safeModule)
  };
}

export function projectOrganisationBlueprint(value) {
  if (Array.isArray(value?.packs) && value.root) {
    return {
      schema: 'ewai.organisation-blueprint-selection/v1',
      root: safePack(value.root),
      packs: value.packs.map(safePack),
      enabledModules: [...value.enabledModules],
      modules: value.modules.map(({ packId, module }) => ({ packId, ...safeModule(module) })),
      digest: value.digest,
      counts: { ...value.counts }
    };
  }
  return safePack(value);
}

export function resolveOrganisationBlueprint(packId, catalogue, options = {}) {
  const byId = new Map(catalogue.map((pack) => [pack.id, pack]));
  const root = byId.get(packId);
  if (!root) throw new Error(`Unknown organisation blueprint: ${packId}`);
  const ordered = [];
  const visiting = [];
  const visited = new Set();
  const visit = (id) => {
    if (visiting.includes(id)) throw new Error(`Organisation blueprint dependency cycle: ${[...visiting, id].join(' -> ')}`);
    if (visited.has(id)) return;
    const pack = byId.get(id);
    if (!pack) throw new Error(`Organisation blueprint has a missing dependency: ${id}`);
    if (!pack.compatible) throw new Error(`Organisation blueprint ${id} is incompatible: ${pack.compatibilityReason}`);
    visiting.push(id);
    for (const dependency of [...pack.requires].sort()) visit(dependency);
    visiting.pop();
    visited.add(id);
    ordered.push(pack);
  };
  visit(packId);

  const optional = new Set(root.blueprint.modules.filter((module) => !module.required).map((module) => module.id));
  const enabledModules = [...new Set(options.enabledModules ?? [])].sort();
  const invalid = enabledModules.find((id) => !optional.has(id));
  if (invalid) throw new Error(`Organisation blueprint optional module is not declared: ${invalid}`);
  const rootModules = root.blueprint.modules.filter((module) => module.required || enabledModules.includes(module.id));
  const modules = ordered.flatMap((pack) => {
    const selected = pack.id === root.id
      ? rootModules
      : pack.blueprint.modules.filter((module) => module.required);
    return selected.map((module) => ({ packId: pack.id, module }));
  });
  const digest = `sha256:${createHash('sha256').update(JSON.stringify({
    root: root.id,
    packs: ordered.map((pack) => ({ id: pack.id, version: pack.version, digest: pack.digest })),
    modules: modules.map(({ packId: id, module }) => `${id}:${module.id}`)
  })).digest('hex')}`;
  return {
    schema: 'ewai.resolved-organisation-blueprint/v1',
    root,
    packs: ordered,
    rootModules,
    enabledModules,
    modules,
    digest,
    counts: {
      standards: modules.reduce((count, { module }) => count + module.standards.length, 0),
      personas: modules.reduce((count, { module }) => count + module.personas.length, 0),
      policies: modules.reduce((count, { module }) => count + module.policies.length, 0),
      designSystems: modules.reduce((count, { module }) => count + module.design_systems.length, 0),
      boilerplates: modules.reduce((count, { module }) => count + module.boilerplates.length, 0),
      starterPacks: modules.reduce((count, { module }) => count + module.starterPacks.length, 0)
    }
  };
}

export function organisationDesignSystemRecommendations(resolved) {
  const recommendations = [];
  const seen = new Set();
  for (const { packId, module } of resolved?.modules ?? []) {
    for (const id of module.design_systems ?? []) {
      const key = `${packId}:${module.id}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      recommendations.push({ packId, moduleId: module.id, id });
    }
  }
  return recommendations.sort((left, right) => left.id.localeCompare(right.id) || left.packId.localeCompare(right.packId) || left.moduleId.localeCompare(right.moduleId));
}
