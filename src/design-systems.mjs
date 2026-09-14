import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { z } from 'zod';
import { defaultPackRoot } from './packs.mjs';
import { loadProjectConfig } from './project.mjs';
import {
  listOrganisationBlueprints,
  organisationDesignSystemRecommendations,
  resolveOrganisationBlueprint,
} from './organisation-blueprints.mjs';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const packageVersion = JSON.parse(readFileSync(resolve(moduleDirectory, '../package.json'), 'utf8')).version;
const currentEwaiMajor = Number(packageVersion.split('.')[0]);

export const DEFAULT_DESIGN_SYSTEM_ID = 'ewai.design-system.default';
export const DESIGN_SYSTEM_EVIDENCE_PATH = 'SPECS/5.Strategy/design-system.md';

const packId = z.string().regex(/^(?:ewai\.[a-z0-9.-]+|org\.[a-z0-9-]+\.[a-z0-9.-]+)$/);
const contributionId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const relativeContentPath = z.string().min(1).max(240).refine((value) => {
  if (isAbsolute(value) || value.includes('\0') || value.split(/[\\/]+/).includes('..')) return false;
  try {
    new URL(value);
    return false;
  } catch {
    return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
  }
}, 'must be a bounded relative path and may not be a remote URL');

const contributionSchema = z.object({
  id: contributionId,
  kind: z.enum(['experience', 'principles', 'foundations', 'tokens', 'components', 'interaction', 'content', 'states', 'responsive', 'accessibility', 'motion', 'prohibited', 'review']),
  title: z.string().min(1).max(160),
  source: relativeContentPath,
  applicability: z.array(contributionId).min(1).max(30).refine((values) => new Set(values).size === values.length, 'must not contain duplicates'),
  required: z.boolean(),
  replaces: z.array(z.string().regex(/^(?:ewai\.[a-z0-9.-]+|org\.[a-z0-9-]+\.[a-z0-9.-]+):[a-z0-9]+(?:-[a-z0-9]+)*$/)).max(30).default([]),
}).strict();

const designSystemPackSchema = z.object({
  schema: z.literal('ewai.pack/v1'),
  id: packId,
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  type: z.literal('design-system'),
  requires: z.array(packId).default([]),
  design_system: z.object({
    compatibility: z.object({ ewai: z.string().regex(/^\d+\.x$/) }).strict(),
    provenance: z.object({
      kind: z.enum(['owner-declared', 'observed', 'inferred', 'adapted']),
      summary: z.string().min(1).max(500),
      source: z.string().min(1).max(500).optional(),
    }).strict(),
    contributions: z.array(contributionSchema).min(1).max(200),
  }).strict(),
}).strict().superRefine((pack, context) => {
  const requires = new Set();
  for (const [index, id] of pack.requires.entries()) {
    if (id === pack.id) context.addIssue({ code: 'custom', path: ['requires', index], message: 'a design system may not require itself' });
    if (requires.has(id)) context.addIssue({ code: 'custom', path: ['requires', index], message: `duplicate dependency: ${id}` });
    requires.add(id);
  }
  const contributions = new Set();
  for (const [index, contribution] of pack.design_system.contributions.entries()) {
    if (contributions.has(contribution.id)) context.addIssue({ code: 'custom', path: ['design_system', 'contributions', index, 'id'], message: `duplicate contribution id: ${contribution.id}` });
    contributions.add(contribution.id);
    if (new Set(contribution.replaces).size !== contribution.replaces.length) {
      context.addIssue({ code: 'custom', path: ['design_system', 'contributions', index, 'replaces'], message: 'duplicate replacement target' });
    }
  }
});

export const DEFAULT_DESIGN_SYSTEM_LIMITS = Object.freeze({
  manifestBytes: 256 * 1024,
  itemBytes: 1024 * 1024,
  totalBytes: 8 * 1024 * 1024,
  maximumDepth: 8,
  maximumFiles: 240,
});

function within(root, candidate) {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function rootRecords(roots) {
  return roots.map((root, index) => typeof root === 'string'
    ? { path: resolve(root), sourceClass: index === 0 ? 'bundled' : 'installed' }
    : { path: resolve(root.path), sourceClass: String(root.sourceClass ?? (index === 0 ? 'bundled' : 'installed')) });
}

function packFiles(root, limits, depth = 0, usage = { files: 0 }) {
  if (!existsSync(root) || depth > limits.maximumDepth) return [];
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) continue;
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) found.push(...packFiles(path, limits, depth + 1, usage));
    if (entry.isFile() && entry.name === 'pack.yaml') {
      usage.files += 1;
      if (usage.files > limits.maximumFiles) throw new Error('Design-system discovery exceeds its file limit');
      found.push(path);
    }
  }
  return found;
}

function readContent(packRoot, source, limits, usage) {
  const candidate = resolve(packRoot, source);
  if (!within(packRoot, candidate)) throw new Error(`Design-system content may not escape its pack root: ${source}`);
  if (!existsSync(candidate)) throw new Error(`Design-system content source does not exist: ${source}`);
  if (lstatSync(candidate).isSymbolicLink()) throw new Error(`Design-system content may not be a symbolic link: ${source}`);
  const realRoot = realpathSync(packRoot);
  const realCandidate = realpathSync(candidate);
  if (!within(realRoot, realCandidate)) throw new Error(`Design-system content may not escape its pack root: ${source}`);
  const metadata = statSync(realCandidate);
  if (!metadata.isFile()) throw new Error(`Design-system content source must be a file: ${source}`);
  if (metadata.size > limits.itemBytes) throw new Error(`Design-system content exceeds its size limit: ${source}`);
  usage.totalBytes += metadata.size;
  usage.files += 1;
  if (usage.files > limits.maximumFiles) throw new Error('Design-system referenced content exceeds its file limit');
  if (usage.totalBytes > limits.totalBytes) throw new Error('Design-system referenced content exceeds its total size limit');
  const bytes = readFileSync(realCandidate);
  return {
    source,
    bytes,
    content: bytes.toString('utf8'),
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

export function parseDesignSystemPack(manifestPath, sourceClass = 'installed', options = {}) {
  const limits = { ...DEFAULT_DESIGN_SYSTEM_LIMITS, ...(options.limits ?? {}) };
  if (lstatSync(manifestPath).isSymbolicLink()) throw new Error(`Design-system manifest may not be a symbolic link: ${manifestPath}`);
  const metadata = statSync(manifestPath);
  if (metadata.size > limits.manifestBytes) throw new Error(`Design-system manifest exceeds its size limit: ${manifestPath}`);
  const manifestBytes = readFileSync(manifestPath);
  let parsed;
  try {
    parsed = YAML.parse(manifestBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Design-system manifest is invalid YAML: ${error.message}`);
  }
  if (parsed?.type !== 'design-system') return null;
  let pack;
  try {
    pack = designSystemPackSchema.parse(parsed);
  } catch (error) {
    const details = error.issues?.map((issue) => `${issue.path.join('.') || 'manifest'} ${issue.message}`).join('; ') ?? error.message;
    throw new Error(`Design-system manifest is invalid: ${details}`);
  }
  const packRoot = dirname(manifestPath);
  const usage = { totalBytes: 0, files: 0 };
  const files = new Map();
  const contributions = pack.design_system.contributions.map((contribution) => {
    if (!files.has(contribution.source)) files.set(contribution.source, readContent(packRoot, contribution.source, limits, usage));
    const file = files.get(contribution.source);
    return { ...contribution, content: file.content, contentDigest: file.digest };
  });
  const manifestDigest = `sha256:${createHash('sha256').update(manifestBytes).digest('hex')}`;
  const hash = createHash('sha256').update(manifestBytes).update('\0');
  for (const file of [...files.values()].sort((left, right) => left.source.localeCompare(right.source))) {
    hash.update(file.source).update('\0').update(file.bytes).update('\0');
  }
  const requiredMajor = Number(pack.design_system.compatibility.ewai.split('.')[0]);
  return {
    ...pack,
    design_system: { ...pack.design_system, contributions },
    manifestPath,
    packRoot,
    sourceClass,
    manifestDigest,
    digest: `sha256:${hash.digest('hex')}`,
    compatible: requiredMajor === currentEwaiMajor,
    compatibilityReason: requiredMajor === currentEwaiMajor
      ? `Compatible with EWAI ${currentEwaiMajor}.x`
      : `Requires EWAI ${requiredMajor}.x; this runtime is ${packageVersion}`,
  };
}

export function defaultDesignSystemRoots(projectRoot, options = {}) {
  const home = resolve(options.home ?? homedir());
  const roots = [
    { path: defaultPackRoot, sourceClass: 'bundled' },
    { path: resolve(home, '.ewai/packs'), sourceClass: 'personal' },
  ];
  if (projectRoot) roots.push({ path: resolve(projectRoot, '.ewai-pipeline/packs'), sourceClass: 'project' });
  return roots;
}

export function listDesignSystems(options = {}) {
  const limits = { ...DEFAULT_DESIGN_SYSTEM_LIMITS, ...(options.limits ?? {}) };
  const roots = rootRecords(options.roots ?? defaultDesignSystemRoots(options.projectRoot, options));
  const catalogue = [];
  for (const root of roots) {
    for (const manifestPath of packFiles(root.path, limits).sort()) {
      const pack = parseDesignSystemPack(manifestPath, root.sourceClass, { limits });
      if (pack) catalogue.push(pack);
    }
  }
  const byId = new Map();
  for (const pack of catalogue) {
    if (byId.has(pack.id)) throw new Error(`Duplicate design-system id across installed roots: ${pack.id}`);
    byId.set(pack.id, pack);
  }
  return catalogue.sort((left, right) => left.id.localeCompare(right.id) || left.version.localeCompare(right.version));
}

function safeContribution(contribution, pack) {
  return {
    id: contribution.id,
    qualifiedId: `${pack.id}:${contribution.id}`,
    kind: contribution.kind,
    title: contribution.title,
    source: contribution.source,
    applicability: [...contribution.applicability],
    required: contribution.required,
    replaces: [...contribution.replaces],
    contentDigest: contribution.contentDigest,
    packId: pack.id,
    packVersion: pack.version,
    sourceClass: pack.sourceClass,
  };
}

export function projectDesignSystem(pack) {
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    version: pack.version,
    type: pack.type,
    requires: [...pack.requires],
    sourceClass: pack.sourceClass,
    manifestDigest: pack.manifestDigest,
    digest: pack.digest,
    compatible: pack.compatible,
    compatibilityReason: pack.compatibilityReason,
    provenance: { ...pack.design_system.provenance },
    compatibility: { ...pack.design_system.compatibility },
    contributions: pack.design_system.contributions.map((contribution) => safeContribution(contribution, pack)),
  };
}

export function resolveDesignSystem(id, catalogue) {
  const byId = new Map(catalogue.map((pack) => [pack.id, pack]));
  const root = byId.get(id);
  if (!root) throw new Error(`Unknown design system: ${id}`);
  const packs = [];
  const visited = new Set();
  const visiting = [];
  const visit = (candidateId) => {
    if (visiting.includes(candidateId)) throw new Error(`Design-system dependency cycle: ${[...visiting, candidateId].join(' -> ')}`);
    if (visited.has(candidateId)) return;
    const pack = byId.get(candidateId);
    if (!pack) throw new Error(`Design system has a missing dependency: ${candidateId}`);
    if (!pack.compatible) throw new Error(`Design system ${candidateId} is incompatible: ${pack.compatibilityReason}`);
    visiting.push(candidateId);
    for (const dependency of [...pack.requires].sort()) visit(dependency);
    visiting.pop();
    visited.add(candidateId);
    packs.push(pack);
  };
  visit(id);

  const activeById = new Map();
  const activeByQualified = new Map();
  for (const pack of packs) {
    for (const contribution of pack.design_system.contributions) {
      const qualifiedId = `${pack.id}:${contribution.id}`;
      for (const replaced of contribution.replaces) {
        const existing = activeByQualified.get(replaced);
        if (!existing) throw new Error(`Design-system replacement target does not exist: ${replaced}`);
        activeByQualified.delete(replaced);
        activeById.delete(existing.contribution.id);
      }
      if (activeById.has(contribution.id)) {
        throw new Error(`Ambiguous contribution ${contribution.id} in resolved design system; declare a qualified replaces target`);
      }
      const record = { pack, contribution, qualifiedId };
      activeById.set(contribution.id, record);
      activeByQualified.set(qualifiedId, record);
    }
  }
  const contributions = [...activeByQualified.values()].map(({ pack, contribution, qualifiedId }) => ({
    ...contribution,
    qualifiedId,
    packId: pack.id,
    packVersion: pack.version,
    sourceClass: pack.sourceClass,
  }));
  const effectiveDigest = `sha256:${createHash('sha256').update(JSON.stringify({
    root: root.id,
    packs: packs.map((pack) => ({ id: pack.id, version: pack.version, digest: pack.digest })),
    contributions: contributions.map(({ qualifiedId, contentDigest }) => ({ qualifiedId, contentDigest })),
  })).digest('hex')}`;
  return {
    schema: 'ewai.resolved-design-system/v1',
    root,
    packs,
    contributions,
    effectiveDigest,
  };
}

export function projectResolvedDesignSystem(resolved) {
  return {
    schema: resolved.schema,
    root: projectDesignSystem(resolved.root),
    packs: resolved.packs.map(projectDesignSystem),
    contributions: resolved.contributions.map((contribution) => safeContribution(contribution, resolved.packs.find(({ id }) => id === contribution.packId))),
    effectiveDigest: resolved.effectiveDigest,
  };
}

function pin(pack) {
  return { id: pack.id, version: pack.version, digest: pack.digest, source_class: pack.sourceClass };
}

function selectionStatus(resolved, selection = null, recommendationState = { status: 'none', recommendations: [] }) {
  const selected = Boolean(selection);
  return {
    schema: 'ewai.design-system-status/v1',
    status: 'ready',
    mode: selected ? 'selected' : 'fallback',
    approved: selected,
    root: projectDesignSystem(resolved.root),
    packs: resolved.packs.map(projectDesignSystem),
    effectiveDigest: resolved.effectiveDigest,
    approvedBy: selection?.approved_by ?? null,
    approvedAt: selection?.approved_at ?? null,
    evidence: selection?.evidence ?? null,
    organisationRecommendations: recommendationState.recommendations,
    organisationRecommendationStatus: recommendationState.status,
    notice: selected
      ? 'This project design system is explicitly selected and digest-pinned.'
      : 'The bundled design system is an unapproved fallback until an accountable owner selects a project root.',
  };
}

export function designSystemStatus(projectRoot, options = {}) {
  const { config } = loadProjectConfig(projectRoot);
  const catalogue = listDesignSystems({ ...options, projectRoot });
  const selection = config.design_system ?? null;
  const resolved = resolveDesignSystem(selection?.root?.id ?? DEFAULT_DESIGN_SYSTEM_ID, catalogue);
  let recommendationState = { status: 'none', recommendations: [] };
  const blueprint = config.blueprints?.organisation;
  if (blueprint?.root?.id) {
    try {
      const organisationCatalogue = listOrganisationBlueprints({
        projectRoot,
        ...(options.organisationRoots ? { roots: options.organisationRoots } : {}),
        ...(options.home ? { home: options.home } : {}),
      });
      const organisationResolved = resolveOrganisationBlueprint(blueprint.root.id, organisationCatalogue, {
        enabledModules: blueprint.enabled_modules ?? [],
      });
      recommendationState = {
        status: 'available',
        recommendations: organisationDesignSystemRecommendations(organisationResolved),
      };
    } catch {
      recommendationState = { status: 'unavailable', recommendations: [] };
    }
  }
  if (selection) {
    const pinned = JSON.stringify(selection.packs.map(({ id, version, digest, source_class }) => ({ id, version, digest, source_class })));
    const current = JSON.stringify(resolved.packs.map(pin));
    if (selection.effective_digest !== resolved.effectiveDigest || pinned !== current) {
      return {
        ...selectionStatus(resolved, selection, recommendationState),
        status: 'stale',
        approved: false,
        notice: 'The installed design-system content has changed since approval. Re-resolve and obtain a new named selection approval.',
      };
    }
  }
  return selectionStatus(resolved, selection, recommendationState);
}

function strategyMarkdown(resolved, approvedBy, approvedAt) {
  const rows = resolved.packs.map((pack) => `| \`${pack.id}\` | \`${pack.version}\` | ${pack.sourceClass} | \`${pack.digest}\` |`).join('\n');
  const contributions = resolved.contributions.map(({ qualifiedId, kind, required }) => `- \`${qualifiedId}\` — ${kind}${required ? ' (required)' : ''}`).join('\n');
  return `# Project Design System\n\n` +
    `**Root:** \`${resolved.root.id}\`\n` +
    `**Effective digest:** \`${resolved.effectiveDigest}\`\n` +
    `**Approved by:** ${approvedBy}\n` +
    `**Approved at:** ${approvedAt}\n\n` +
    `## Resolved packs\n\n| Pack | Version | Source | Digest |\n|---|---|---|---|\n${rows}\n\n` +
    `## Effective contributions\n\n${contributions}\n\n` +
    `This records project selection authority. Prototype application emits a separate delivery-local receipt.\n`;
}

function atomicSelectionWrite(configPath, configContent, evidencePath, evidenceContent) {
  mkdirSync(dirname(evidencePath), { recursive: true });
  const suffix = `.tmp-${process.pid}-${randomUUID()}`;
  const configTemp = `${configPath}${suffix}`;
  const evidenceTemp = `${evidencePath}${suffix}`;
  const priorConfig = readFileSync(configPath, 'utf8');
  const hadEvidence = existsSync(evidencePath);
  const priorEvidence = hadEvidence ? readFileSync(evidencePath, 'utf8') : null;
  try {
    writeFileSync(configTemp, configContent, { encoding: 'utf8', flag: 'wx' });
    writeFileSync(evidenceTemp, evidenceContent, { encoding: 'utf8', flag: 'wx' });
    renameSync(evidenceTemp, evidencePath);
    try {
      renameSync(configTemp, configPath);
    } catch (error) {
      if (hadEvidence) writeFileSync(evidencePath, priorEvidence, 'utf8');
      else if (existsSync(evidencePath)) unlinkSync(evidencePath);
      throw error;
    }
  } catch (error) {
    if (existsSync(configTemp)) unlinkSync(configTemp);
    if (existsSync(evidenceTemp)) unlinkSync(evidenceTemp);
    if (readFileSync(configPath, 'utf8') !== priorConfig) writeFileSync(configPath, priorConfig, 'utf8');
    throw error;
  }
}

export function selectDesignSystem(projectRoot, id, options = {}) {
  const approvedBy = String(options.approvedBy ?? '').trim();
  if (!approvedBy) throw new Error('Design-system selection requires a named approver');
  const expectedDigest = String(options.expectedDigest ?? '').trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedDigest)) throw new Error('Design-system selection requires an exact expected digest');
  const approvedAt = options.now ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(approvedAt))) throw new Error('Design-system approval time must be an ISO date-time');
  const { config, paths } = loadProjectConfig(projectRoot);
  const resolved = resolveDesignSystem(id, listDesignSystems({ ...options, projectRoot }));
  if (resolved.effectiveDigest !== expectedDigest) {
    throw new Error(`Design-system digest drift: expected ${expectedDigest}, resolved ${resolved.effectiveDigest}`);
  }
  config.design_system = {
    root: pin(resolved.root),
    packs: resolved.packs.map(pin),
    effective_digest: resolved.effectiveDigest,
    approved_by: approvedBy,
    approved_at: approvedAt,
    evidence: DESIGN_SYSTEM_EVIDENCE_PATH,
  };
  const evidencePath = resolve(paths.projectRoot, DESIGN_SYSTEM_EVIDENCE_PATH);
  atomicSelectionWrite(
    paths.configPath,
    YAML.stringify(config, { lineWidth: 0 }),
    evidencePath,
    strategyMarkdown(resolved, approvedBy, approvedAt),
  );
  return selectionStatus(resolved, config.design_system);
}
