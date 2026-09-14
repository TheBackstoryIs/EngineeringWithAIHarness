import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { projectPaths } from './paths.mjs';
import { listPersonas, personalPersonaRoot, projectPersonaRoot } from './personas.mjs';
import { selectContextualPersonas } from './runtime/persona-engagement.mjs';
import { publishLifecycleEventSafely } from './runtime/lifecycle-hooks.mjs';

export const KNOWLEDGE_PROPOSALS_DISCLAIMER = 'Security validation is evidence, not certification or proof that this system is secure. Tools can miss vulnerabilities and produce false positives. A qualified human must review the scope, findings, limitations and residual risk before release.';

const PREPARATION_SCHEMA = 'ewai.knowledge-proposal-preparation/v1';
const BUNDLE_SCHEMA = 'ewai.knowledge-proposal-bundle/v1';
const RECORDING_SCHEMA = 'ewai.knowledge-proposal-recording/v1';
const REVIEW_SCHEMA = 'ewai.knowledge-proposal-review/v1';
const WORKSPACE_SCHEMA = 'ewai.knowledge-proposal-workspace/v1';
const MATERIALISATION_SCHEMA = 'ewai.knowledge-materialisation/v1';
const sourceRefPattern = /^(meeting-evidence|retrospective):([a-z0-9][a-z0-9.-]{0,119})$/;
const proposalIdPattern = /^KNP-[0-9]{3,}$/;
const bundleIdPattern = /^knowledge\.[a-z0-9][a-z0-9.-]{0,119}\.[a-f0-9]{12}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_PROPOSALS = 200;
const decisions = new Set(['accepted', 'rejected', 'amended', 'deferred']);

const taxonomy = Object.freeze({
  'project-persona': '1.Scope/personas/project',
  system: '1.Scope/domain/systems',
  process: '1.Scope/domain/processes',
  'data-concept': '1.Scope/domain/data',
  journey: '2.Purpose/journeys',
  requirement: '2.Purpose/requirements/pending',
  'feature-candidate': '2.Purpose/explorations/feature-candidates',
  risk: '3.Evidence/risk',
  policy: '4.Constraints/compliance/policies',
  constraint: '4.Constraints',
  standard: '4.Constraints/standards',
  decision: '5.Strategy/decisions',
  pattern: '5.Strategy/patterns',
  'anti-pattern': '5.Strategy/anti-patterns',
  runbook: '5.Strategy/runbooks',
  sop: '5.Strategy/sops'
});

function normalised(path) {
  return path.split(sep).join('/');
}

function inside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalDigest(value) {
  return sha256(JSON.stringify(value));
}

function slugify(value, max = 80) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max) || 'knowledge';
}

function cleanText(value, label, max = 500, required = true) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new Error(`Knowledge proposals require ${label}`);
  if (text.length > max) throw new Error(`Knowledge proposals ${label} exceeds ${max} characters`);
  return text;
}

function safeRelative(projectRoot, path) {
  const value = normalised(relative(projectRoot, path));
  if (!value || value.startsWith('../') || isAbsolute(value)) throw new Error('Knowledge proposal path escapes the project');
  return value;
}

function atomicJson(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, path);
}

function assertInitialized(paths) {
  if (!existsSync(paths.configPath)) throw new Error('Initialize EWAI before using knowledge proposals');
}

function readBoundedFile(path, label) {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`${label} must be a regular non-symbolic file`);
  if (stats.size > MAX_SOURCE_BYTES) throw new Error(`${label} exceeds the 1 MiB limit`);
  return readFileSync(path, 'utf8');
}

function sourceRoots(paths) {
  return {
    meetings: resolve(paths.specsRoot, '3.Evidence/meeting-evidence'),
    retros: resolve(paths.specsRoot, '3.Evidence/retros')
  };
}

function parseHeadings(markdown) {
  const lines = markdown.split(/\r?\n/);
  const anchors = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^#{2,4}\s+(.+)$/);
    if (!match) continue;
    const level = lines[index].match(/^#+/)?.[0].length ?? 2;
    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const next = lines[cursor].match(/^(#+)\s+/);
      if (next && next[1].length <= level) { end = cursor; break; }
    }
    anchors.push({
      id: `heading:${slugify(match[1])}`,
      label: match[1].trim(),
      lineStart: index + 1,
      lineEnd: end,
      excerpt: lines.slice(index + 1, end).join('\n').trim().slice(0, 1200)
    });
  }
  return anchors;
}

function meetingSource(paths, id) {
  const roots = sourceRoots(paths);
  const root = resolve(roots.meetings, id);
  if (!inside(roots.meetings, root) || !existsSync(root) || lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) {
    throw new Error(`Unknown knowledge source: meeting-evidence:${id}`);
  }
  const jsonPath = resolve(root, 'evidence.json');
  if (!inside(root, jsonPath) || !existsSync(jsonPath)) throw new Error(`Unknown knowledge source: meeting-evidence:${id}`);
  const content = readBoundedFile(jsonPath, 'Meeting evidence');
  let record;
  try { record = JSON.parse(content); } catch { throw new Error(`Invalid meeting evidence source: ${id}`); }
  if (record.schema !== 'ewai.meeting-evidence/v1' || record.source?.sourceId !== id || !Array.isArray(record.evidence)) {
    throw new Error(`Invalid meeting evidence source: ${id}`);
  }
  const anchors = record.evidence.map((item) => ({
    id: `candidate:${cleanText(item?.id, 'meeting evidence candidate ID', 80)}`,
    label: `${String(item?.type ?? 'evidence')} · ${String(item?.id ?? '')}`,
    lineAnchors: Array.isArray(item?.lineAnchors) ? item.lineAnchors : [],
    excerpt: [item?.statement, item?.interpretation].filter(Boolean).join('\n').slice(0, 1200)
  }));
  const modelContext = record.evidence.map((item) => [
    `### ${item.id} · ${item.type}`,
    `Statement: ${item.statement}`,
    `Interpretation: ${item.interpretation}`,
    `Source lines: ${(item.lineAnchors ?? []).map(({ start, end }) => start === end ? start : `${start}-${end}`).join(', ')}`
  ].join('\n')).join('\n\n');
  return {
    ref: `meeting-evidence:${id}`,
    family: 'meeting-evidence',
    id,
    label: record.source?.label || id,
    path: jsonPath,
    projectPath: safeRelative(paths.projectRoot, jsonPath),
    digest: sha256(content),
    anchors,
    modelContext
  };
}

function retrospectiveSource(paths, slug) {
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(slug)) throw new Error(`Invalid knowledge source reference: retrospective:${slug}`);
  const roots = sourceRoots(paths);
  const path = resolve(roots.retros, `${slug}.md`);
  if (!inside(roots.retros, path) || !existsSync(path)) throw new Error(`Unknown knowledge source: retrospective:${slug}`);
  const markdown = readBoundedFile(path, 'Retrospective');
  const title = markdown.match(/^#\s+(?:Retrospective:\s*)?(.+)$/m)?.[1]?.trim() || slug;
  const anchors = parseHeadings(markdown);
  return {
    ref: `retrospective:${slug}`,
    family: 'retrospective',
    id: slug,
    label: title,
    path,
    projectPath: safeRelative(paths.projectRoot, path),
    digest: sha256(markdown),
    anchors,
    modelContext: markdown
  };
}

function resolveSource(paths, sourceRef) {
  const ref = cleanText(sourceRef, 'source reference', 180);
  const match = ref.match(sourceRefPattern);
  if (!match) throw new Error(`Invalid knowledge source reference: ${ref}`);
  if (match[1] === 'meeting-evidence') return meetingSource(paths, match[2]);
  return retrospectiveSource(paths, match[2]);
}

function safeSource(source) {
  return {
    ref: source.ref,
    family: source.family,
    id: source.id,
    label: source.label,
    digest: source.digest,
    anchors: source.anchors.map(({ excerpt: _excerpt, ...anchor }) => anchor),
    anchorCount: source.anchors.length
  };
}

function inferTier(persona) {
  const path = normalised(String(persona.path ?? ''));
  if (persona.tier) return persona.tier;
  if (path.includes('/premium-personas/')) return 'premium';
  if (path.includes('/1.Scope/personas/project/')) return 'project';
  if (path.includes('/.ewai/personas/')) return 'personal';
  return 'core';
}

function installedPersonaCatalogue(projectRoot) {
  const roots = [
    resolve(import.meta.dirname, '../packs/personas/core/personas'),
    resolve(homedir(), '.ewai/packs/ewai.personas.professional/premium-personas'),
    personalPersonaRoot(),
    projectPersonaRoot(projectRoot)
  ];
  const ranks = { project: 4, premium: 3, personal: 2, core: 1 };
  const found = new Map();
  for (const persona of listPersonas(roots)) {
    const candidate = { ...persona, tier: inferTier(persona) };
    const existing = found.get(candidate.id);
    if (!existing || ranks[candidate.tier] > ranks[existing.tier]) found.set(candidate.id, candidate);
  }
  return [...found.values()];
}

function contextualPersonas(projectRoot, source, options = {}) {
  const focus = Array.isArray(options.focus)
    ? options.focus.map((item) => String(item).trim()).filter(Boolean)
    : String(options.focus ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  const signals = focus.length ? focus : [source.family, 'knowledge', 'provenance', 'review', ...source.anchors.slice(0, 8).map(({ label }) => label)];
  const catalogue = Array.isArray(options.personaCatalogue) ? options.personaCatalogue : installedPersonaCatalogue(projectRoot);
  return selectContextualPersonas({
    signals,
    context: { source: safeSource(source), focus },
    personaCatalogue: catalogue.map((persona) => ({ ...persona, tier: inferTier(persona) })),
    contextLabel: 'evidence-to-knowledge proposals',
    limit: options.personaLimit ?? 6
  });
}

function proposalRoot(paths) {
  return resolve(paths.specsRoot, '3.Evidence/knowledge-proposals');
}

function bundlePath(paths, bundleId) {
  if (!bundleIdPattern.test(String(bundleId ?? ''))) throw new Error(`Invalid knowledge proposal bundle ID: ${bundleId}`);
  const root = proposalRoot(paths);
  const path = resolve(root, bundleId);
  if (!inside(root, path)) throw new Error('Unsafe knowledge proposal bundle path');
  return path;
}

function expectedDestination(paths, kind, destination) {
  const root = taxonomy[kind];
  if (!root) throw new Error(`Unsupported knowledge proposal kind: ${kind}`);
  const value = normalised(cleanText(destination, 'proposal destination', 300));
  if (isAbsolute(value) || value.split('/').includes('..') || !value.endsWith('.md')) throw new Error(`Unsafe knowledge proposal destination: ${value}`);
  const prefix = paths.specsRelative === '.' ? '' : `${paths.specsRelative}/`;
  const expectedPrefix = `${prefix}${root}/`;
  if (!value.startsWith(expectedPrefix)) throw new Error(`Knowledge proposal destination does not match kind ${kind}: ${value}`);
  const rest = value.slice(expectedPrefix.length);
  if (!/^[a-z0-9][a-z0-9-]{0,119}\.md$/.test(rest)) throw new Error(`Unsafe knowledge proposal destination: ${value}`);
  const absolute = resolve(paths.projectRoot, value);
  if (!inside(resolve(paths.projectRoot, prefix || '.'), absolute)) throw new Error(`Unsafe knowledge proposal destination: ${value}`);
  return { value, absolute };
}

function normalisePersonas(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 8).map((persona) => ({
    id: cleanText(persona?.id, 'active persona ID', 160),
    name: cleanText(persona?.name, 'active persona name', 160),
    tier: cleanText(persona?.tier || 'core', 'active persona tier', 40),
    category: cleanText(persona?.category, 'active persona category', 100, false),
    description: cleanText(persona?.description, 'active persona description', 240, false),
    matchedSignals: Array.isArray(persona?.matchedSignals) ? persona.matchedSignals.slice(0, 20).map((value) => cleanText(value, 'persona signal', 100)) : [],
    engagementReason: cleanText(persona?.engagementReason, 'persona engagement reason', 400)
  }));
}

function destinationState(path, markdown) {
  if (!existsSync(path)) return 'additive';
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile()) return 'conflict';
  return readFileSync(path, 'utf8') === markdown ? 'already-current' : 'conflict';
}

function normaliseProposal(paths, source, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Each knowledge proposal must be an object');
  const allowed = new Set(['id', 'kind', 'title', 'destination', 'evidenceAnchors', 'rationale', 'uncertainty', 'relationships', 'proposedMarkdown']);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) throw new Error(`Knowledge proposal field is not allowed: ${key}`);
  const id = cleanText(raw.id, 'proposal ID', 30);
  if (!proposalIdPattern.test(id)) throw new Error(`Invalid knowledge proposal ID: ${id}`);
  const kind = cleanText(raw.kind, 'proposal kind', 50);
  const title = cleanText(raw.title, 'proposal title', 200);
  const destination = expectedDestination(paths, kind, raw.destination);
  if (!Array.isArray(raw.evidenceAnchors) || !raw.evidenceAnchors.length || raw.evidenceAnchors.length > 30) throw new Error(`${id} requires one to 30 evidence anchors`);
  const knownAnchors = new Set(source.anchors.map(({ id: anchorId }) => anchorId));
  const evidenceAnchors = raw.evidenceAnchors.map((anchor) => cleanText(anchor, 'evidence anchor', 180));
  if (evidenceAnchors.some((anchor) => !knownAnchors.has(anchor))) throw new Error(`${id} references an unknown evidence anchor`);
  const rationale = cleanText(raw.rationale, 'proposal rationale', 1600);
  const uncertainty = cleanText(raw.uncertainty, 'proposal uncertainty', 1200, false);
  const relationships = Array.isArray(raw.relationships) ? raw.relationships.slice(0, 30).map((item) => cleanText(item, 'proposal relationship', 300)) : [];
  const proposedMarkdown = cleanText(raw.proposedMarkdown, 'proposed Markdown', 100_000);
  if (!/^#\s+.+/m.test(proposedMarkdown) || !/^##\s+Provenance\s*$/mi.test(proposedMarkdown)) throw new Error(`${id} proposed Markdown requires a provenance section`);
  if (!proposedMarkdown.includes(source.ref) || evidenceAnchors.some((anchor) => !proposedMarkdown.includes(anchor))) throw new Error(`${id} proposed Markdown provenance does not cite its source and anchors`);
  if (/<script\b|javascript:|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\u0000/i.test(proposedMarkdown)) throw new Error(`${id} proposed Markdown contains executable content or credentials`);
  return {
    id, kind, title, destination: destination.value, evidenceAnchors, rationale, uncertainty, relationships, proposedMarkdown,
    state: destinationState(destination.absolute, proposedMarkdown)
  };
}

function normaliseBundle(paths, source, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Knowledge proposal bundle must be an object');
  const allowed = new Set(['schema', 'sourceRef', 'sourceDigest', 'proposals']);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) throw new Error(`Knowledge proposal bundle field is not allowed: ${key}`);
  if (raw.schema !== BUNDLE_SCHEMA) throw new Error(`Knowledge proposal bundle schema must be ${BUNDLE_SCHEMA}`);
  if (raw.sourceRef !== source.ref) throw new Error('Knowledge proposal bundle source does not match');
  if (raw.sourceDigest !== source.digest) throw new Error('Knowledge proposal bundle source digest is stale');
  if (!Array.isArray(raw.proposals) || !raw.proposals.length || raw.proposals.length > MAX_PROPOSALS) throw new Error(`Knowledge proposal bundle must contain one to ${MAX_PROPOSALS} proposals`);
  const proposals = raw.proposals.map((proposal) => normaliseProposal(paths, source, proposal));
  if (new Set(proposals.map(({ id }) => id)).size !== proposals.length) throw new Error('Knowledge proposal bundle contains a duplicate proposal ID');
  if (new Set(proposals.map(({ destination }) => destination)).size !== proposals.length) throw new Error('Knowledge proposal bundle contains a duplicate proposal destination');
  return { schema: BUNDLE_SCHEMA, sourceRef: source.ref, sourceDigest: source.digest, proposals };
}

function readBundle(paths, bundleId) {
  const root = bundlePath(paths, bundleId);
  const path = resolve(root, 'bundle.json');
  if (!existsSync(path)) throw new Error(`Unknown knowledge proposal bundle: ${bundleId}`);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  if (record.schema !== BUNDLE_SCHEMA || record.bundleId !== bundleId) throw new Error(`Invalid knowledge proposal bundle: ${bundleId}`);
  const { bundleDigest, ...payload } = record;
  if (!digestPattern.test(String(bundleDigest ?? '')) || canonicalDigest(payload) !== bundleDigest) throw new Error(`Knowledge proposal bundle digest is invalid: ${bundleId}`);
  return record;
}

function reviewPath(paths, bundleId) {
  return resolve(bundlePath(paths, bundleId), 'review.json');
}

function readReview(paths, bundleId) {
  const path = reviewPath(paths, bundleId);
  if (!existsSync(path)) throw new Error(`Knowledge proposal bundle has no named review: ${bundleId}`);
  const review = JSON.parse(readFileSync(path, 'utf8'));
  const { reviewDigest, ...payload } = review;
  if (review.schema !== REVIEW_SCHEMA || review.bundleId !== bundleId || canonicalDigest(payload) !== reviewDigest) throw new Error(`Knowledge proposal review digest is invalid: ${bundleId}`);
  return review;
}

function materialisationPath(paths, bundleId) {
  return resolve(bundlePath(paths, bundleId), 'materialisation.json');
}

function journalPath(paths, bundleId) {
  return resolve(paths.runtimeRoot, 'knowledge-proposals/transactions', `${bundleId}.json`);
}

function materialisedProposal(bundleProposal, disposition) {
  if (disposition.decision !== 'amended') return { ...bundleProposal };
  return {
    ...bundleProposal,
    title: disposition.replacementTitle,
    proposedMarkdown: disposition.replacementMarkdown,
    state: undefined
  };
}

export function listKnowledgeSources(projectRoot) {
  const paths = projectPaths(projectRoot);
  assertInitialized(paths);
  const roots = sourceRoots(paths);
  const sources = [];
  if (existsSync(roots.meetings)) {
    for (const entry of readdirSync(roots.meetings, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      try { sources.push(safeSource(meetingSource(paths, entry.name))); } catch { /* malformed evidence is not eligible */ }
    }
  }
  if (existsSync(roots.retros)) {
    for (const entry of readdirSync(roots.retros, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || entry.isSymbolicLink() || extname(entry.name).toLowerCase() !== '.md') continue;
      const slug = basename(entry.name, '.md');
      if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(slug)) continue;
      try { sources.push(safeSource(retrospectiveSource(paths, slug))); } catch { /* malformed evidence is not eligible */ }
    }
  }
  return sources.sort((left, right) => left.ref.localeCompare(right.ref));
}

export function prepareKnowledgeProposals(projectRoot, sourceRef, options = {}) {
  const paths = projectPaths(projectRoot);
  assertInitialized(paths);
  const source = resolveSource(paths, sourceRef);
  const activePersonas = contextualPersonas(paths.projectRoot, source, options);
  return {
    schema: PREPARATION_SCHEMA,
    source: safeSource(source),
    modelContext: source.modelContext,
    proposalContract: {
      schema: BUNDLE_SCHEMA,
      schemaPath: 'config/knowledge-proposals-proposal.schema.json',
      allowedKinds: Object.keys(taxonomy),
      destinationRoots: Object.fromEntries(Object.entries(taxonomy).map(([kind, root]) => [kind, `${paths.specsRelative === '.' ? '' : `${paths.specsRelative}/`}${root}`])),
      proposalIdPattern: proposalIdPattern.source,
      maxProposals: MAX_PROPOSALS,
      provenanceRequired: true,
      canonicalWritesAllowed: false
    },
    activePersonas,
    authority: { personasAreAdvisory: true, namedReviewRequired: true, materialisationRequiresSeparateApproval: true, overwriteMergeDeleteAllowed: false },
    notices: [
      'Preparation is advisory and writes no canonical project knowledge.',
      'Project/core personas are complete; relevant installed premium and personal personas are optional visible enrichment only.',
      KNOWLEDGE_PROPOSALS_DISCLAIMER
    ]
  };
}

export function recordKnowledgeProposalBundle(projectRoot, sourceRef, input = {}) {
  const paths = projectPaths(projectRoot);
  assertInitialized(paths);
  const source = resolveSource(paths, sourceRef);
  const bundle = normaliseBundle(paths, source, input.bundle);
  const activePersonas = normalisePersonas(input.activePersonas);
  const bundleId = `knowledge.${slugify(`${source.family}-${source.id}`, 110)}.${source.digest.slice(0, 12)}`;
  const root = bundlePath(paths, bundleId);
  const recordedAt = new Date(input.now ?? Date.now()).toISOString();
  const payload = { ...bundle, bundleId, recordedAt, activePersonas };
  const bundleDigest = canonicalDigest(payload);
  const record = { ...payload, bundleDigest };
  if (existsSync(root)) {
    const existing = readBundle(paths, bundleId);
    if (existing.bundleDigest === bundleDigest) return { schema: RECORDING_SCHEMA, bundleId, bundleDigest, bundlePath: safeRelative(paths.projectRoot, resolve(root, 'bundle.json')), counts: stateCounts(existing.proposals), idempotent: true };
    throw new Error('Conflicting knowledge proposal bundle already exists and will not be overwritten');
  }
  const stage = `${root}.${process.pid}.${randomUUID()}.tmp`;
  try {
    mkdirSync(stage, { recursive: true });
    writeFileSync(resolve(stage, 'bundle.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    for (const proposal of bundle.proposals) {
      const path = resolve(stage, 'proposals', proposal.destination);
      if (!inside(stage, path)) throw new Error('Unsafe staged knowledge proposal path');
      mkdirSync(resolve(path, '..'), { recursive: true });
      writeFileSync(path, proposal.proposedMarkdown, 'utf8');
    }
    mkdirSync(resolve(root, '..'), { recursive: true });
    renameSync(stage, root);
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
  return { schema: RECORDING_SCHEMA, bundleId, bundleDigest, bundlePath: safeRelative(paths.projectRoot, resolve(root, 'bundle.json')), counts: stateCounts(bundle.proposals), idempotent: false };
}

function stateCounts(proposals) {
  return {
    proposals: proposals.length,
    additive: proposals.filter(({ state }) => state === 'additive').length,
    alreadyCurrent: proposals.filter(({ state }) => state === 'already-current').length,
    conflicts: proposals.filter(({ state }) => state === 'conflict').length
  };
}

function normaliseDispositions(bundle, raw) {
  if (!Array.isArray(raw) || raw.length !== bundle.proposals.length) throw new Error('Knowledge proposal review must dispose of every proposal exactly once');
  const known = new Map(bundle.proposals.map((proposal) => [proposal.id, proposal]));
  const dispositions = raw.map((item) => {
    const proposalId = cleanText(item?.proposalId, 'review proposal ID', 30);
    if (!known.has(proposalId)) throw new Error(`Knowledge proposal review references an unknown proposal: ${proposalId}`);
    const decision = cleanText(item?.decision, 'review decision', 20);
    if (!decisions.has(decision)) throw new Error(`Unsupported knowledge proposal review decision: ${decision}`);
    const rationale = cleanText(item?.rationale, 'review rationale', 1600, false);
    const replacementTitle = cleanText(item?.replacementTitle, 'amendment replacement title', 200, false);
    const replacementMarkdown = cleanText(item?.replacementMarkdown, 'amendment replacement Markdown', 100_000, false);
    if (decision === 'amended') {
      if (!replacementTitle || !replacementMarkdown || !rationale) throw new Error(`${proposalId} amendment requires replacement title, Markdown and rationale`);
      if (!/^##\s+Provenance\s*$/mi.test(replacementMarkdown) || !replacementMarkdown.includes(bundle.sourceRef)) throw new Error(`${proposalId} amendment requires source provenance`);
    } else if (replacementTitle || replacementMarkdown) {
      throw new Error(`${proposalId} replacement content is allowed only for an amendment`);
    }
    if (['rejected', 'deferred'].includes(decision) && !rationale) throw new Error(`${proposalId} ${decision} decision requires rationale`);
    return { proposalId, decision, ...(rationale ? { rationale } : {}), ...(replacementTitle ? { replacementTitle, replacementMarkdown } : {}) };
  });
  if (new Set(dispositions.map(({ proposalId }) => proposalId)).size !== dispositions.length) throw new Error('Knowledge proposal review must dispose of every proposal exactly once');
  return dispositions;
}

export function recordKnowledgeProposalReview(projectRoot, bundleId, input = {}) {
  const paths = projectPaths(projectRoot);
  assertInitialized(paths);
  const reviewedBy = cleanText(input.reviewedBy, 'named reviewer', 160);
  const bundle = readBundle(paths, bundleId);
  const source = resolveSource(paths, bundle.sourceRef);
  if (source.digest !== bundle.sourceDigest) throw new Error('Knowledge proposal source is stale relative to the recorded bundle');
  const dispositions = normaliseDispositions(bundle, input.dispositions);
  const reviewedAt = new Date(input.now ?? Date.now()).toISOString();
  const payload = { schema: REVIEW_SCHEMA, bundleId, bundleDigest: bundle.bundleDigest, sourceDigest: source.digest, reviewedBy, reviewedAt, dispositions };
  const reviewDigest = canonicalDigest(payload);
  const review = { ...payload, reviewDigest };
  const path = reviewPath(paths, bundleId);
  if (existsSync(path)) {
    const existing = readReview(paths, bundleId);
    if (existing.reviewDigest === reviewDigest) return { schema: 'ewai.knowledge-proposal-review-recording/v1', bundleId, reviewDigest, reviewedBy, reviewedAt: existing.reviewedAt, counts: decisionCounts(existing.dispositions), idempotent: true };
    throw new Error('Conflicting knowledge proposal review already exists and will not be overwritten');
  }
  atomicJson(path, review);
  return { schema: 'ewai.knowledge-proposal-review-recording/v1', bundleId, reviewDigest, reviewedBy, reviewedAt, counts: decisionCounts(dispositions), idempotent: false };
}

function decisionCounts(dispositions) {
  return Object.fromEntries([...decisions].map((decision) => [decision, dispositions.filter((item) => item.decision === decision).length]));
}

export function materialiseKnowledgeProposals(projectRoot, bundleId, input = {}) {
  if (input.confirmed !== true) throw new Error('Knowledge proposal materialisation requires exact confirmation');
  const approvedBy = cleanText(input.approvedBy, 'named approver', 160);
  const paths = projectPaths(projectRoot);
  assertInitialized(paths);
  const existingLedgerPath = materialisationPath(paths, bundleId);
  if (existsSync(existingLedgerPath)) {
    const existing = JSON.parse(readFileSync(existingLedgerPath, 'utf8'));
    if (existsSync(journalPath(paths, bundleId))) rmSync(journalPath(paths, bundleId), { force: true });
    return { ...existing.result, ledgerPath: safeRelative(paths.projectRoot, existingLedgerPath), idempotent: true };
  }
  if (existsSync(journalPath(paths, bundleId))) throw new Error('Knowledge materialisation has an interrupted transaction; recover it before retrying');
  const bundle = readBundle(paths, bundleId);
  const review = readReview(paths, bundleId);
  const source = resolveSource(paths, bundle.sourceRef);
  if (source.digest !== bundle.sourceDigest || source.digest !== review.sourceDigest) throw new Error('Knowledge proposal source is stale relative to review');
  if (review.bundleDigest !== bundle.bundleDigest) throw new Error('Knowledge proposal bundle changed after review');
  const byId = new Map(bundle.proposals.map((proposal) => [proposal.id, proposal]));
  const selected = review.dispositions.filter(({ decision }) => ['accepted', 'amended'].includes(decision)).map((disposition) => materialisedProposal(byId.get(disposition.proposalId), disposition));
  if (!selected.length) throw new Error('Knowledge proposal review has no accepted or amended records to materialise');
  const outcomes = selected.map((proposal) => {
    const destination = expectedDestination(paths, proposal.kind, proposal.destination);
    return { proposalId: proposal.id, destination: proposal.destination, absolute: destination.absolute, markdown: proposal.proposedMarkdown, state: destinationState(destination.absolute, proposal.proposedMarkdown) };
  });
  const toWrite = outcomes.filter(({ state }) => state === 'additive');
  const journal = { schema: 'ewai.knowledge-materialisation-transaction/v1', bundleId, phase: 'prepared', created: [], createdDigests: {}, destinations: toWrite.map(({ destination }) => destination) };
  const transactionPath = journalPath(paths, bundleId);
  atomicJson(transactionPath, journal);
  try {
    let writeCount = 0;
    for (const item of toWrite) {
      if (destinationState(item.absolute, item.markdown) !== 'additive') throw new Error(`Knowledge destination changed during materialisation: ${item.destination}`);
      mkdirSync(resolve(item.absolute, '..'), { recursive: true });
      writeFileSync(item.absolute, item.markdown, { encoding: 'utf8', flag: 'wx' });
      journal.created.push(item.destination);
      journal.createdDigests[item.destination] = sha256(item.markdown);
      journal.phase = 'writing';
      atomicJson(transactionPath, journal);
      writeCount += 1;
      if (input.testHooks?.failAfterWrites === writeCount) throw new Error('Knowledge materialisation was interrupted after a canonical write');
    }
  } catch (error) {
    throw error;
  }
  const materialisedAt = new Date(input.now ?? Date.now()).toISOString();
  const result = {
    schema: 'ewai.knowledge-materialisation-result/v1',
    bundleId,
    approvedBy,
    materialisedAt,
    counts: { added: outcomes.filter(({ state }) => state === 'additive').length, alreadyCurrent: outcomes.filter(({ state }) => state === 'already-current').length, conflicts: outcomes.filter(({ state }) => state === 'conflict').length },
    outcomes: outcomes.map(({ absolute: _absolute, markdown: _markdown, ...outcome }) => outcome),
    idempotent: false
  };
  const ledgerPayload = { schema: MATERIALISATION_SCHEMA, bundleId, sourceDigest: source.digest, bundleDigest: bundle.bundleDigest, reviewDigest: review.reviewDigest, approvedBy, materialisedAt, result };
  const ledger = { ...ledgerPayload, materialisationDigest: canonicalDigest(ledgerPayload) };
  atomicJson(existingLedgerPath, ledger);
  if (input.testHooks?.failAfterLedger === true) throw new Error('Knowledge materialisation was interrupted after the immutable ledger was persisted');
  rmSync(transactionPath, { force: true });
  const ledgerRelative = safeRelative(paths.projectRoot, existingLedgerPath);
  const publication = publishLifecycleEventSafely(paths.projectRoot, 'ewai.knowledge-proposals.materialised', {
    now: materialisedAt,
    sourceKey: `knowledge-proposals:${bundleId}:${ledger.materialisationDigest}`,
    sourceRevision: ledger.materialisationDigest,
    occurredAt: materialisedAt,
    streamId: `knowledge-proposals:${bundleId}`,
    facts: { bundleId, materialisationDigest: ledger.materialisationDigest, addedCount: result.counts.added, alreadyCurrentCount: result.counts.alreadyCurrent, conflictCount: result.counts.conflicts, materialisedAt },
    evidence: [ledgerRelative]
  });
  return { ...result, ledgerPath: ledgerRelative, lifecycle: { ...publication, status: publication.event ? 'published' : publication.status ?? 'publication-failed' } };
}

function recoveryFileState(paths, absolute, expectedDigest) {
  // Inspect each component before reading: a lexical SPECS prefix alone does
  // not prevent a replaced parent directory from redirecting recovery.
  let current = paths.projectRoot;
  const components = ['', ...relative(paths.projectRoot, absolute).split(sep)];
  try {
    for (let index = 0; index < components.length; index += 1) {
      current = resolve(current, components[index]);
      const stats = lstatSync(current, { throwIfNoEntry: false });
      if (!stats) return { state: 'missing' };
      if (stats.isSymbolicLink()) return { state: 'preserved', reason: 'symbolic link' };
      if (index < components.length - 1) {
        if (!stats.isDirectory()) return { state: 'preserved', reason: 'parent is not a directory' };
        continue;
      }
      if (!stats.isFile() || stats.nlink !== 1) return { state: 'preserved', reason: 'not a single regular file' };
      if (typeof expectedDigest !== 'string' || !digestPattern.test(expectedDigest)) return { state: 'preserved', reason: 'original digest unavailable' };
      if (stats.size > MAX_SOURCE_BYTES) return { state: 'preserved', reason: 'file exceeds the recovery read limit' };
      if (sha256(readFileSync(current)) !== expectedDigest) return { state: 'preserved', reason: 'content changed' };
      const after = lstatSync(current);
      if (!after.isFile() || after.nlink !== 1 || after.dev !== stats.dev || after.ino !== stats.ino || after.size !== stats.size || after.mtimeMs !== stats.mtimeMs || after.ctimeMs !== stats.ctimeMs) {
        return { state: 'preserved', reason: 'file changed during inspection' };
      }
      return { state: 'unchanged' };
    }
  } catch {
    return { state: 'preserved', reason: 'could not safely inspect the file' };
  }
}

export function recoverKnowledgeMaterialisation(projectRoot, bundleId, input = {}) {
  if (input.confirmed !== true) throw new Error('Knowledge materialisation recovery requires exact confirmation');
  const paths = projectPaths(projectRoot);
  assertInitialized(paths);
  const path = journalPath(paths, bundleId);
  if (!existsSync(path)) return { schema: 'ewai.knowledge-materialisation-recovery/v1', bundleId, status: 'not-required', removed: [] };
  if (existsSync(materialisationPath(paths, bundleId))) {
    rmSync(path, { force: true });
    return { schema: 'ewai.knowledge-materialisation-recovery/v1', bundleId, status: 'finalised', removed: [] };
  }
  const journal = JSON.parse(readFileSync(path, 'utf8'));
  if (journal.schema !== 'ewai.knowledge-materialisation-transaction/v1' || journal.bundleId !== bundleId || !['prepared', 'writing', 'committed'].includes(journal.phase) || !Array.isArray(journal.created) || !Array.isArray(journal.destinations)) throw new Error('Knowledge materialisation journal is not recoverable');
  // Validate every owned path before removing any. Old v1 journals remain
  // readable, but missing digests are not permission to delete existing files.
  const owned = journal.created.map(destination => {
    const valid = typeof destination === 'string' && journal.destinations.includes(destination) && Object.keys(taxonomy).some(kind => {
      try { return expectedDestination(paths, kind, destination).value === destination; } catch { return false; }
    });
    if (!valid) throw new Error('Knowledge materialisation journal contains an unsafe destination');
    return { destination, absolute: resolve(paths.projectRoot, destination) };
  });
  const removed = [];
  const preserved = [];
  for (const { destination, absolute } of owned) {
    const state = recoveryFileState(paths, absolute, journal.createdDigests?.[destination]);
    if (state.state === 'unchanged') { rmSync(absolute); removed.push(destination); }
    else if (state.state === 'preserved') preserved.push({ destination, reason: state.reason });
  }
  if (preserved.length) {
    const details = preserved.slice(0, 5).map(item => `${item.destination} (${item.reason})`).join('; ');
    const extra = preserved.length > 5 ? `; and ${preserved.length - 5} more` : '';
    const error = new Error(`Recovery paused: ${preserved.length} file(s) preserved: ${details}${extra}. The transaction journal has been kept. Review and back up those files before resolving them and retrying recovery.`);
    error.code = 'KNOWLEDGE_RECOVERY_REQUIRES_REVIEW';
    error.preserved = preserved;
    error.removed = removed;
    throw error;
  }
  rmSync(path, { force: true });
  return { schema: 'ewai.knowledge-materialisation-recovery/v1', bundleId, status: 'recovered', removed };
}

export function readKnowledgeProposalWorkspace(projectRoot, options = {}) {
  const paths = projectPaths(projectRoot);
  assertInitialized(paths);
  const sources = listKnowledgeSources(paths.projectRoot);
  const root = proposalRoot(paths);
  const bundles = existsSync(root)
    ? readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && bundleIdPattern.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
      try {
        const bundle = readBundle(paths, entry.name);
        const review = existsSync(reviewPath(paths, entry.name)) ? readReview(paths, entry.name) : null;
        const materialisation = existsSync(materialisationPath(paths, entry.name)) ? JSON.parse(readFileSync(materialisationPath(paths, entry.name), 'utf8')) : null;
        return [{ bundleId: entry.name, sourceRef: bundle.sourceRef, sourceDigest: bundle.sourceDigest, bundleDigest: bundle.bundleDigest, recordedAt: bundle.recordedAt, proposalCount: bundle.proposals.length, reviewState: review ? 'reviewed' : 'pending', materialisationState: materialisation ? 'materialised' : existsSync(journalPath(paths, entry.name)) ? 'recovery-required' : 'not-materialised', counts: stateCounts(bundle.proposals) }];
      } catch { return []; }
    }) : [];
  const selectedBundleId = options.bundleId ?? bundles[0]?.bundleId ?? null;
  if (options.bundleId && !bundles.some(({ bundleId }) => bundleId === options.bundleId)) throw new Error(`Unknown knowledge proposal bundle: ${options.bundleId}`);
  let bundle = null;
  let review = null;
  let materialisation = null;
  let activePersonas = [];
  if (selectedBundleId) {
    const record = readBundle(paths, selectedBundleId);
    const source = resolveSource(paths, record.sourceRef);
    const dispositionMap = existsSync(reviewPath(paths, selectedBundleId)) ? new Map(readReview(paths, selectedBundleId).dispositions.map((item) => [item.proposalId, item])) : new Map();
    bundle = { bundleId: record.bundleId, sourceRef: record.sourceRef, sourceDigest: record.sourceDigest, bundleDigest: record.bundleDigest, recordedAt: record.recordedAt, proposals: record.proposals.map((proposal) => ({ ...proposal, state: destinationState(resolve(paths.projectRoot, proposal.destination), proposal.proposedMarkdown), disposition: dispositionMap.get(proposal.id) ?? null })) };
    review = existsSync(reviewPath(paths, selectedBundleId)) ? readReview(paths, selectedBundleId) : null;
    materialisation = existsSync(materialisationPath(paths, selectedBundleId)) ? JSON.parse(readFileSync(materialisationPath(paths, selectedBundleId), 'utf8')) : null;
    activePersonas = record.activePersonas?.length ? normalisePersonas(record.activePersonas) : contextualPersonas(paths.projectRoot, source, options);
  }
  return {
    schema: WORKSPACE_SCHEMA,
    sources,
    bundles,
    selectedBundleId,
    bundle,
    review: review ? { reviewDigest: review.reviewDigest, reviewedBy: review.reviewedBy, reviewedAt: review.reviewedAt, dispositions: review.dispositions } : null,
    materialisation: materialisation?.result ?? null,
    activePersonas,
    permittedActions: { prepare: sources.length > 0, record: false, review: Boolean(bundle && !review), materialise: Boolean(review && !materialisation), recover: Boolean(selectedBundleId && existsSync(journalPath(paths, selectedBundleId))) },
    authority: { personasAreAdvisory: true, reviewIsNotMaterialisation: true, conflictsRequireSeparateReconciliation: true, releaseAuthorityGranted: false },
    notices: ['Proposals are advisory until named review and separate named materialisation.', 'Existing differing knowledge remains unchanged and is shown as a conflict.', KNOWLEDGE_PROPOSALS_DISCLAIMER]
  };
}
