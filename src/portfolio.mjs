import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { projectPaths } from './paths.mjs';
import { loadProjectConfig } from './project.mjs';
import { ASSURANCE_NOTICE } from './security-validation-config.mjs';
import { selectContextualPersonas } from './runtime/persona-engagement.mjs';

export const PORTFOLIO_SCHEMA = 'ewai.portfolio/v1';
export const PORTFOLIO_WORKSPACE_SCHEMA = 'ewai.portfolio-workspace/v1';
export const PORTFOLIO_ASSURANCE_NOTICE = ASSURANCE_NOTICE;
export const PORTFOLIO_ADVISORY_NOTICE = 'Portfolio and persona analysis is advisory. Child project approvals, accepted risk, Manual QA and release decisions remain with named accountable humans.';

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_CHILD_FILE_BYTES = 512 * 1024;
const MAX_CHILD_FILES = 200;
const DEFAULT_STALE_AFTER_DAYS = 30;
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100);
const boundedText = (maximum) => z.string().trim().min(1).max(maximum);

const memberSchema = z.object({
  id: slug,
  kind: z.enum(['portfolio', 'programme', 'project']),
  name: boundedText(160),
  owner: boundedText(160),
  parent: slug.optional(),
  repository: boundedText(120).optional(),
  project_path: boundedText(500).optional(),
}).strict().superRefine((member, context) => {
  if (member.kind === 'project') {
    if (!member.repository) context.addIssue({ code: 'custom', path: ['repository'], message: 'project member requires repository' });
    if (!member.project_path) context.addIssue({ code: 'custom', path: ['project_path'], message: 'project member requires project_path' });
  } else if (member.repository || member.project_path) {
    context.addIssue({ code: 'custom', message: 'only project members may declare repository and project_path' });
  }
});

const dependencySchema = z.object({
  id: slug,
  from: slug,
  to: slug,
  rationale: boundedText(500),
  owner: boundedText(160),
}).strict();

const manifestSchema = z.object({
  schema: z.literal(PORTFOLIO_SCHEMA),
  id: slug,
  name: boundedText(160),
  owner: boundedText(160),
  members: z.array(memberSchema).min(1).max(100),
  dependencies: z.array(dependencySchema).max(400).default([]),
}).strict();

function diagnostic(code, message, path = '') {
  return { code, message, ...(path ? { path } : {}) };
}

function safeRelative(root, path) {
  return relative(resolve(root), resolve(path)).replaceAll('\\', '/') || '.';
}

function within(root, candidate) {
  const path = relative(resolve(root), resolve(candidate));
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function normaliseRelative(value) {
  const text = String(value ?? '').trim().replaceAll('\\', '/');
  if (!text || text.includes('\0') || text.startsWith('/') || /^[A-Za-z]:\//.test(text)) return null;
  const segments = text.split('/');
  if (segments.includes('..')) return null;
  const normalised = segments.filter((segment) => segment && segment !== '.').join('/');
  return normalised || '.';
}

function assertNoSymbolicTraversal(root, relativePath) {
  if (lstatSync(root).isSymbolicLink()) return false;
  if (relativePath === '.') return true;
  let cursor = root;
  for (const segment of relativePath.split('/')) {
    cursor = resolve(cursor, segment);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) return false;
  }
  return true;
}

function graphCycle(nodes, edges) {
  const outgoing = new Map(nodes.map((node) => [node, []]));
  for (const [from, to] of edges) outgoing.get(from)?.push(to);
  const visiting = new Set();
  const visited = new Set();
  function visit(node) {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const target of outgoing.get(node) ?? []) if (visit(target)) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  }
  return nodes.some(visit);
}

function hierarchyDepth(memberId, byId, trail = new Set()) {
  if (trail.has(memberId)) return Number.POSITIVE_INFINITY;
  const member = byId.get(memberId);
  if (!member?.parent) return 1;
  return 1 + hierarchyDepth(member.parent, byId, new Set([...trail, memberId]));
}

export function validatePortfolioManifest(input) {
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      diagnostics: parsed.error.issues.map((issue) => diagnostic(
        'portfolio.schema',
        issue.message,
        issue.path.join('.'),
      )),
    };
  }
  const manifest = parsed.data;
  const diagnostics = [];
  const byId = new Map();
  for (const member of manifest.members) {
    if (byId.has(member.id)) diagnostics.push(diagnostic('portfolio.duplicate-member', `Duplicate member ID: ${member.id}`, 'members'));
    else byId.set(member.id, member);
  }
  const portfolioRoots = manifest.members.filter((member) => member.kind === 'portfolio' && !member.parent);
  if (portfolioRoots.length !== 1) diagnostics.push(diagnostic('portfolio.root-count', 'Exactly one root portfolio member is required.', 'members'));
  for (const member of manifest.members) {
    if (member.kind === 'portfolio' && member.parent) diagnostics.push(diagnostic('portfolio.portfolio-parent', `Portfolio member ${member.id} may not have a parent.`, `members.${member.id}.parent`));
    if (member.kind !== 'portfolio' && !member.parent) diagnostics.push(diagnostic('portfolio.missing-parent', `Member ${member.id} requires a parent.`, `members.${member.id}.parent`));
    if (!member.parent) continue;
    const parent = byId.get(member.parent);
    if (!parent) diagnostics.push(diagnostic('portfolio.missing-parent', `Member ${member.id} references a missing parent.`, `members.${member.id}.parent`));
    else if (parent.kind === 'project') diagnostics.push(diagnostic('portfolio.project-parent', `Member ${member.id} may not be nested below a project.`, `members.${member.id}.parent`));
  }
  const hierarchyEdges = manifest.members.filter((member) => member.parent && byId.has(member.parent)).map((member) => [member.parent, member.id]);
  if (graphCycle([...byId.keys()], hierarchyEdges)) diagnostics.push(diagnostic('portfolio.hierarchy-cycle', 'Portfolio hierarchy contains a cycle.', 'members'));
  for (const member of manifest.members) {
    if (hierarchyDepth(member.id, byId) > 8) {
      diagnostics.push(diagnostic('portfolio.hierarchy-depth', `Member ${member.id} exceeds hierarchy depth 8.`, `members.${member.id}`));
    }
  }
  const dependencyIds = new Set();
  const dependencyEdges = [];
  for (const dependency of manifest.dependencies) {
    if (dependencyIds.has(dependency.id)) diagnostics.push(diagnostic('portfolio.duplicate-dependency', `Duplicate dependency ID: ${dependency.id}`, 'dependencies'));
    dependencyIds.add(dependency.id);
    const from = byId.get(dependency.from);
    const to = byId.get(dependency.to);
    if (!from || !to) diagnostics.push(diagnostic('portfolio.missing-dependency-target', `Dependency ${dependency.id} references a missing member.`, `dependencies.${dependency.id}`));
    else if (from.kind !== 'project' || to.kind !== 'project') diagnostics.push(diagnostic('portfolio.dependency-kind', `Dependency ${dependency.id} may connect project members only.`, `dependencies.${dependency.id}`));
    if (dependency.from === dependency.to) diagnostics.push(diagnostic('portfolio.self-dependency', `Dependency ${dependency.id} may not target itself.`, `dependencies.${dependency.id}`));
    if (from && to && from.kind === 'project' && to.kind === 'project' && dependency.from !== dependency.to) dependencyEdges.push([dependency.from, dependency.to]);
  }
  const projectIds = manifest.members.filter((member) => member.kind === 'project').map((member) => member.id);
  if (graphCycle(projectIds, dependencyEdges)) diagnostics.push(diagnostic('portfolio.dependency-cycle', 'Portfolio dependencies contain a cycle.', 'dependencies'));
  return { valid: diagnostics.length === 0, diagnostics, manifest };
}

function configuredRepositories(projectRoot, config) {
  const repositories = new Map();
  const diagnostics = [];
  for (const repository of config.repositories ?? []) {
    const name = String(repository?.name ?? '').trim();
    const path = normaliseRelative(repository?.path);
    if (!name || !path || repositories.has(name)) {
      diagnostics.push(diagnostic('portfolio.invalid-repository', 'Configured repository identity or path is invalid.'));
      continue;
    }
    const absolute = resolve(projectRoot, path);
    if (!within(projectRoot, absolute) || !existsSync(absolute) || !lstatSync(absolute).isDirectory() || lstatSync(absolute).isSymbolicLink()) {
      diagnostics.push(diagnostic('portfolio.invalid-repository', `Configured repository ${name} is unavailable or unsafe.`));
      continue;
    }
    const realRoot = realpathSync(absolute);
    if (!within(realpathSync(projectRoot), realRoot)) {
      diagnostics.push(diagnostic('portfolio.invalid-repository', `Configured repository ${name} escapes the workspace.`));
      continue;
    }
    repositories.set(name, { name, path, root: realRoot });
  }
  return { repositories, diagnostics };
}

export function resolvePortfolioMembers(projectRoot, input) {
  const validation = validatePortfolioManifest(input);
  if (!validation.valid) return { valid: false, members: [], diagnostics: validation.diagnostics };
  let loaded;
  try {
    loaded = loadProjectConfig(projectRoot);
  } catch {
    return { valid: false, members: [], diagnostics: [diagnostic('portfolio.project-config', 'The portfolio host project configuration is unavailable or invalid.')] };
  }
  const configured = configuredRepositories(resolve(projectRoot), loaded.config);
  const diagnostics = [...configured.diagnostics];
  const resolvedRoots = new Map();
  const members = validation.manifest.members.map((member) => {
    const base = { id: member.id, kind: member.kind, name: member.name, owner: member.owner, parent: member.parent ?? null };
    if (member.kind !== 'project') return base;
    const repository = configured.repositories.get(member.repository);
    if (!repository) {
      diagnostics.push(diagnostic('portfolio.unknown-repository', `Project ${member.id} references an unknown configured repository.`, `members.${member.id}.repository`));
      return { ...base, repository: member.repository, projectPath: member.project_path };
    }
    const projectPath = normaliseRelative(member.project_path);
    if (!projectPath) {
      diagnostics.push(diagnostic('portfolio.unsafe-path', `Project ${member.id} has an unsafe project_path.`, `members.${member.id}.project_path`));
      return { ...base, repository: member.repository, projectPath: member.project_path };
    }
    if (!assertNoSymbolicTraversal(repository.root, projectPath)) {
      diagnostics.push(diagnostic('portfolio.symbolic-path', `Project ${member.id} traverses a symbolic path.`, `members.${member.id}.project_path`));
      return { ...base, repository: member.repository, projectPath };
    }
    const absolute = resolve(repository.root, projectPath);
    if (!within(repository.root, absolute)) {
      diagnostics.push(diagnostic('portfolio.unsafe-path', `Project ${member.id} escapes its configured repository.`, `members.${member.id}.project_path`));
      return { ...base, repository: member.repository, projectPath };
    }
    if (!existsSync(absolute) || !lstatSync(absolute).isDirectory() || lstatSync(absolute).isSymbolicLink()) {
      diagnostics.push(diagnostic('portfolio.missing-project', `Project ${member.id} root is unavailable.`, `members.${member.id}.project_path`));
      return { ...base, repository: member.repository, projectPath };
    }
    const realProjectRoot = realpathSync(absolute);
    if (!within(repository.root, realProjectRoot)) {
      diagnostics.push(diagnostic('portfolio.unsafe-path', `Project ${member.id} escapes its configured repository.`, `members.${member.id}.project_path`));
      return { ...base, repository: member.repository, projectPath };
    }
    if (resolvedRoots.has(realProjectRoot)) {
      diagnostics.push(diagnostic('portfolio.duplicate-root', `Projects ${resolvedRoots.get(realProjectRoot)} and ${member.id} resolve to the same root.`, `members.${member.id}.project_path`));
    } else resolvedRoots.set(realProjectRoot, member.id);
    return { ...base, repository: member.repository, projectPath, root: realProjectRoot };
  });
  return { valid: diagnostics.length === 0, members, diagnostics, manifest: validation.manifest };
}

export function readPortfolioResolution(projectRoot, options = {}) {
  const root = resolve(projectRoot);
  let paths;
  try {
    paths = projectPaths(root);
  } catch {
    return { status: 'invalid', diagnostics: [diagnostic('portfolio.project-root', 'The EWAI project root is invalid.')] };
  }
  const manifestPath = resolve(paths.specsRoot, '1.Scope/portfolio.yaml');
  if (!existsSync(manifestPath)) return { status: 'not-configured', diagnostics: [] };
  if (lstatSync(manifestPath).isSymbolicLink() || statSync(manifestPath).size > MAX_MANIFEST_BYTES) {
    return { status: 'invalid', diagnostics: [diagnostic('portfolio.manifest-file', 'Portfolio manifest is symbolic or exceeds its size limit.')] };
  }
  let raw;
  try {
    raw = YAML.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return { status: 'invalid', diagnostics: [diagnostic('portfolio.manifest-yaml', 'Portfolio manifest is invalid YAML.')] };
  }
  const resolution = resolvePortfolioMembers(root, raw);
  const unavailableCodes = new Set(['portfolio.missing-project']);
  const blocking = options.allowUnavailableProjects
    ? resolution.diagnostics.filter((item) => !unavailableCodes.has(item.code))
    : resolution.diagnostics;
  return {
    status: blocking.length ? 'invalid' : 'ready',
    diagnostics: resolution.diagnostics,
    resolution,
  };
}

function boundedRead(path, label) {
  const size = statSync(path).size;
  if (size > MAX_CHILD_FILE_BYTES) throw new Error(`${label} exceeds its size limit`);
  return readFileSync(path, 'utf8');
}

function parseFrontmatter(content) {
  const match = String(content).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return {};
  return YAML.parse(match[1]) ?? {};
}

function safeFiles(root, predicate, depth = 0, found = []) {
  if (!existsSync(root) || depth > 8 || found.length >= MAX_CHILD_FILES) return found;
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) continue;
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) safeFiles(path, predicate, depth + 1, found);
    else if (entry.isFile() && predicate(path, entry.name)) found.push(path);
    if (found.length >= MAX_CHILD_FILES) break;
  }
  return found;
}

function childIntentEvidence(childRoot, specsRoot) {
  const intentsRoot = resolve(specsRoot, '2.Purpose/intents');
  const markdownFiles = safeFiles(intentsRoot, (_path, name) => name.endsWith('.md'));
  const records = [];
  let disagreement = false;
  for (const path of markdownFiles) {
    try {
      const metadata = parseFrontmatter(boundedRead(path, 'Intent metadata'));
      const slugValue = String(metadata.slug ?? '').trim();
      if (!slugValue) continue;
      const jsonPath = path.replace(/\.md$/i, '.json');
      let structured = null;
      if (existsSync(jsonPath) && !lstatSync(jsonPath).isSymbolicLink()) structured = JSON.parse(boundedRead(jsonPath, 'Intent structured metadata'));
      const markdownStatus = String(metadata.status ?? metadata.delivery_status ?? '').trim() || 'unknown';
      const structuredStatus = String(structured?.status ?? '').trim() || null;
      if (structuredStatus && structuredStatus !== markdownStatus) disagreement = true;
      records.push({
        slug: slugValue.slice(0, 100),
        status: markdownStatus.slice(0, 80),
        structuredStatus: structuredStatus?.slice(0, 80) ?? null,
        reference: safeRelative(childRoot, path),
      });
    } catch {
      records.push({ slug: 'unreadable', status: 'invalid', structuredStatus: null, reference: safeRelative(childRoot, path) });
      disagreement = true;
    }
  }
  return { count: records.length, disagreement, items: records.slice(0, 50) };
}

function childDeliveryEvidence(childRoot, specsRoot) {
  const buildRoot = resolve(specsRoot, '6.Build');
  const paths = existsSync(buildRoot) ? readdirSync(buildRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => resolve(buildRoot, entry.name, 'delivery-state.json'))
    .filter((path) => existsSync(path) && !lstatSync(path).isSymbolicLink())
    .slice(0, MAX_CHILD_FILES) : [];
  const states = paths.flatMap((path) => {
    try {
      const state = JSON.parse(boundedRead(path, 'Delivery state'));
      if (state.schema !== 'ewai.delivery-state/v1') return [];
      const manualQa = (state.humanGates ?? []).find((gate) => gate.id === 'manual-qa');
      return [{
        slug: String(state.slug ?? '').slice(0, 100),
        status: String(state.status ?? 'unknown').slice(0, 80),
        currentPhase: String(state.currentPhase ?? 'unknown').slice(0, 80),
        blockedReason: String(state.blockedReason ?? '').slice(0, 240),
        updatedAt: String(state.updatedAt ?? '').slice(0, 80) || null,
        buildApproved: Boolean(state.approvals?.build),
        manualQa: String(manualQa?.status ?? 'missing').slice(0, 80),
        reference: safeRelative(childRoot, path),
      }];
    } catch {
      return [];
    }
  }).sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')));
  const current = states.find((state) => !['completed', 'cancelled'].includes(state.status)) ?? states[0] ?? null;
  return {
    count: states.length,
    status: current?.status ?? 'missing',
    currentPhase: current?.currentPhase ?? 'missing',
    blockedReason: current?.blockedReason ?? '',
    updatedAt: current?.updatedAt ?? null,
    buildApproved: current?.buildApproved ?? false,
    manualQa: current?.manualQa ?? 'missing',
    reference: current?.reference ?? null,
  };
}

function freshness(updatedAt, nowValue, staleAfterDays) {
  if (!updatedAt) return { status: 'unknown', updatedAt: null };
  const updated = Date.parse(updatedAt);
  const now = Date.parse(nowValue);
  if (!Number.isFinite(updated) || !Number.isFinite(now)) return { status: 'unknown', updatedAt };
  const ageDays = Math.max(0, Math.floor((now - updated) / 86_400_000));
  return { status: ageDays > staleAfterDays ? 'stale' : 'current', updatedAt, ageDays };
}

function readChildEvidence(member, options) {
  try {
    const paths = projectPaths(member.root);
    if (!existsSync(paths.configPath)) return { status: 'unavailable', reason: 'missing-project-config' };
    const loaded = loadProjectConfig(member.root);
    const intents = childIntentEvidence(member.root, loaded.paths.specsRoot);
    const delivery = childDeliveryEvidence(member.root, loaded.paths.specsRoot);
    const evidenceFreshness = freshness(delivery.updatedAt, options.now, options.staleAfterDays);
    let status = 'ready';
    if (!delivery.count) status = 'missing';
    if (evidenceFreshness.status === 'stale') status = 'stale';
    if (intents.disagreement) status = 'disagreement';
    return {
      status,
      project: { schema: loaded.config.schema, name: String(loaded.config.project?.name ?? member.name).slice(0, 160) },
      intents,
      delivery,
      freshness: evidenceFreshness,
    };
  } catch {
    return { status: 'unavailable', reason: 'invalid-project-evidence' };
  }
}

function hierarchyMembers(members) {
  const children = new Map();
  for (const member of members) {
    const parent = member.parent ?? '__root__';
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(member);
  }
  for (const values of children.values()) values.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const ordered = [];
  function append(parent, depth) {
    for (const member of children.get(parent) ?? []) {
      const { root: _root, ...safe } = member;
      ordered.push({ ...safe, depth });
      append(member.id, depth + 1);
    }
  }
  append('__root__', 0);
  return ordered;
}

function personaAvailability(catalogue) {
  const counts = Object.fromEntries(['project', 'premium', 'personal', 'core'].map((tier) => [tier, catalogue.filter((persona) => String(persona.tier || 'core') === tier).length]));
  return {
    baseline: { available: true, method: 'standard-llm-with-installed-project-and-core-personas' },
    project: { installed: counts.project > 0, count: counts.project },
    core: { installed: counts.core > 0, count: counts.core },
    personal: { installed: counts.personal > 0, count: counts.personal, required: false },
    premium: { installed: counts.premium > 0, count: counts.premium, required: false, syncAttempted: false },
  };
}

function baseWorkspace(catalogue) {
  return {
    schema: PORTFOLIO_WORKSPACE_SCHEMA,
    personaAvailability: personaAvailability(catalogue),
    review: {
      standardLlmAvailable: true,
      questions: [
        'Which declared dependency is most exposed to missing or stale evidence?',
        'Which child owner needs to make the next decision?',
        'Where does observed evidence support or challenge a declared relationship?',
        'Which conclusion is a persona hypothesis rather than a project fact?',
      ],
      evidenceClasses: ['declared', 'observed', 'inferred', 'persona-hypothesis', 'human-decision'],
    },
    notices: { advisory: PORTFOLIO_ADVISORY_NOTICE, security: PORTFOLIO_ASSURANCE_NOTICE },
    guide: 'Docs/project-portfolio-orchestration-guide.md',
  };
}

function attentionFor(member) {
  const evidence = member.evidence;
  if (!evidence) return [];
  const items = [];
  if (evidence.status === 'unavailable') items.push({ code: 'portfolio.unavailable-member', member: member.id, owner: member.owner, reason: evidence.reason, evidenceClass: 'observed' });
  if (evidence.status === 'missing') items.push({ code: 'portfolio.missing-delivery-state', member: member.id, owner: member.owner, reason: 'No readable child delivery state exists.', evidenceClass: 'observed' });
  if (evidence.freshness?.status === 'stale') items.push({ code: 'portfolio.stale-member', member: member.id, owner: member.owner, reason: 'Child delivery evidence is older than the configured freshness window.', evidenceClass: 'observed' });
  if (evidence.intents?.disagreement) items.push({ code: 'portfolio.intent-disagreement', member: member.id, owner: member.owner, reason: 'Markdown and structured intent status disagree.', evidenceClass: 'observed' });
  if (evidence.delivery?.blockedReason) items.push({ code: 'portfolio.child-blocked', member: member.id, owner: member.owner, reason: evidence.delivery.blockedReason, evidenceClass: 'declared-child-state' });
  return items;
}

export function readPortfolioWorkspace(projectRoot, options = {}) {
  const root = resolve(projectRoot);
  const catalogue = Array.isArray(options.personas) ? options.personas : Array.isArray(options.personaCatalogue) ? options.personaCatalogue : [];
  const base = baseWorkspace(catalogue);
  const portfolioResolution = readPortfolioResolution(root);
  if (portfolioResolution.status !== 'ready') return { ...base, status: portfolioResolution.status, diagnostics: portfolioResolution.diagnostics, members: [], dependencies: [], observedDependencies: [], attention: [], activePersonas: [] };
  const { resolution } = portfolioResolution;
  const now = options.now ?? new Date().toISOString();
  const staleAfterDays = Math.max(1, Math.min(3650, Number(options.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS)));
  const members = hierarchyMembers(resolution.members).map((member) => member.kind === 'project'
    ? { ...member, evidence: readChildEvidence(resolution.members.find((candidate) => candidate.id === member.id), { now, staleAfterDays }) }
    : { ...member, evidence: { status: 'declared', evidenceClass: 'declared' } });
  const dependencies = resolution.manifest.dependencies.map((dependency) => ({ ...dependency, evidenceClass: 'declared' }));
  const attention = members.flatMap(attentionFor);
  const signals = [
    'portfolio', 'programme', 'project', 'outcome', 'ownership', 'delivery', 'dependency', 'evidence', 'risk',
    resolution.manifest.name, resolution.manifest.owner,
    ...members.flatMap((member) => [member.name, member.owner, member.evidence?.status]),
    ...dependencies.flatMap((dependency) => [dependency.rationale, dependency.owner]),
    ...attention.flatMap((item) => [item.code, item.reason]),
    String(options.focus ?? '').slice(0, 500),
  ];
  const activePersonas = selectContextualPersonas({
    signals,
    context: { portfolio: resolution.manifest.id, memberStates: members.map((member) => [member.id, member.evidence?.status]), dependencyCount: dependencies.length, focus: String(options.focus ?? '').slice(0, 500) },
    contextLabel: options.focus ? `portfolio context: ${String(options.focus).slice(0, 120)}` : 'portfolio hierarchy, evidence and dependencies',
    personaCatalogue: catalogue,
    limit: 6,
  });
  return {
    ...base,
    status: attention.length ? 'attention' : 'ready',
    portfolio: { id: resolution.manifest.id, name: resolution.manifest.name, owner: resolution.manifest.owner },
    diagnostics: [],
    members,
    dependencies,
    observedDependencies: [],
    observedEvidence: { status: 'not-available', reason: 'No bounded cross-project Source Map dependency evidence is projected in V1.' },
    attention,
    activePersonas,
  };
}
