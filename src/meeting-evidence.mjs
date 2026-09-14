import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { projectPaths } from './paths.mjs';
import {
  listPersonas,
  personalPersonaRoot,
  projectPersonaRoot
} from './personas.mjs';
import { selectContextualPersonas } from './runtime/persona-engagement.mjs';
import { publishLifecycleEventSafely } from './runtime/lifecycle-hooks.mjs';

export const MEETING_EVIDENCE_DISCLAIMER = 'Security validation is evidence, not certification or proof that this system is secure. Tools can miss vulnerabilities and produce false positives. A qualified human must review the scope, findings, limitations and residual risk before release.';

const SOURCE_SCHEMA = 'ewai.meeting-source-private/v1';
const REGISTRATION_SCHEMA = 'ewai.meeting-source-registration/v1';
const EXTRACTION_SCHEMA = 'ewai.meeting-extraction-contract/v1';
const WORKSPACE_SCHEMA = 'ewai.meeting-evidence-workspace/v1';
const CANDIDATE_SCHEMA = 'ewai.meeting-candidate-bundle/v1';
const REVIEW_SCHEMA = 'ewai.meeting-review/v1';
const EVIDENCE_SCHEMA = 'ewai.meeting-evidence/v1';
const sourceIdPattern = /^meeting\.[a-z0-9][a-z0-9-]{0,59}\.[a-f0-9]{12}$/;
const classifications = new Set(['public', 'internal', 'confidential', 'restricted']);
const cloudPolicies = new Set(['allowed', 'denied', 'unknown']);
const supportedExtensions = new Set(['.md', '.markdown', '.txt', '.text', '.vtt', '.srt']);
const allowedCandidateTypes = [
  'task',
  'decision',
  'process',
  'risk',
  'system',
  'policy',
  'requirement',
  'assumption',
  'open-question'
];
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_LINES = 20_000;
const candidateIdPattern = /^MEC-[0-9]{3,}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const reviewDecisions = new Set(['accepted', 'rejected', 'amended', 'deferred']);

function normalized(path) {
  return path.split(sep).join('/');
}

function inside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'source';
}

function cleanText(value, label, max = 200, required = true) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new Error(`Meeting evidence requires ${label}`);
  if (text.length > max) throw new Error(`Meeting evidence ${label} exceeds ${max} characters`);
  return text;
}

function sourceRoot(paths) {
  return resolve(paths.runtimeRoot, 'meeting-evidence/sources');
}

function sourceRecordPath(paths, sourceId) {
  if (!sourceIdPattern.test(String(sourceId ?? ''))) throw new Error(`Invalid meeting source ID: ${sourceId}`);
  const root = sourceRoot(paths);
  const path = resolve(root, `${sourceId}.json`);
  if (!inside(root, path)) throw new Error('Unsafe meeting source path');
  return path;
}

function atomicJson(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, path);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalDigest(value) {
  return sha256(JSON.stringify(value));
}

function safeRelative(projectRoot, path) {
  const value = normalized(relative(projectRoot, path));
  if (!value || value.startsWith('../') || isAbsolute(value)) throw new Error('Meeting evidence path escapes the project');
  return value;
}

function contentFacts(path, stats = statSync(path)) {
  if (stats.size > MAX_SOURCE_BYTES) throw new Error('Meeting source exceeds the 2 MiB limit');
  const content = readFileSync(path);
  const text = content.toString('utf8');
  const lineCount = text ? text.split(/\r?\n/).length - (/\r?\n$/.test(text) ? 1 : 0) : 0;
  if (lineCount > MAX_SOURCE_LINES) throw new Error('Meeting source exceeds the 20,000 lines limit');
  return {
    size: stats.size,
    lineCount,
    digest: createHash('sha256').update(content).digest('hex'),
    modifiedAt: stats.mtime.toISOString()
  };
}

function readPrivateSource(paths, sourceId) {
  const path = sourceRecordPath(paths, sourceId);
  if (!existsSync(path)) throw new Error(`Unknown meeting source: ${sourceId}`);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  if (record.schema !== SOURCE_SCHEMA || record.sourceId !== sourceId) {
    throw new Error(`Invalid meeting source record: ${sourceId}`);
  }
  return record;
}

function reviewRoot(paths) {
  return resolve(paths.runtimeRoot, 'meeting-evidence/reviews');
}

function reviewRecordPath(paths, sourceId) {
  const root = reviewRoot(paths);
  const path = resolve(root, `${sourceId}.json`);
  if (!sourceIdPattern.test(String(sourceId ?? '')) || !inside(root, path)) throw new Error(`Invalid meeting source ID: ${sourceId}`);
  return path;
}

function readReview(paths, sourceId) {
  const path = reviewRecordPath(paths, sourceId);
  if (!existsSync(path)) throw new Error(`Meeting source has no current named review: ${sourceId}`);
  const review = JSON.parse(readFileSync(path, 'utf8'));
  if (review.schema !== REVIEW_SCHEMA || review.sourceId !== sourceId) throw new Error(`Invalid meeting review record: ${sourceId}`);
  const { reviewDigest, ...payload } = review;
  if (!digestPattern.test(String(reviewDigest ?? '')) || canonicalDigest(payload) !== reviewDigest) {
    throw new Error(`Meeting review digest is invalid: ${sourceId}`);
  }
  return review;
}

function evidencePaths(paths, sourceId) {
  const root = resolve(paths.specsRoot, '3.Evidence/meeting-evidence', sourceId);
  if (!inside(paths.specsRoot, root)) throw new Error('Unsafe meeting evidence destination');
  return {
    root,
    json: resolve(root, 'evidence.json'),
    markdown: resolve(root, 'evidence.md')
  };
}

function transactionPaths(paths, sourceId) {
  const root = resolve(paths.runtimeRoot, 'meeting-evidence/transactions');
  return { root, journal: resolve(root, `${sourceId}.json`) };
}

function cleanPromotionTransaction(paths, sourceId) {
  const transaction = transactionPaths(paths, sourceId);
  if (!existsSync(transaction.journal)) return;
  const journal = JSON.parse(readFileSync(transaction.journal, 'utf8'));
  const targets = evidencePaths(paths, sourceId);
  for (const staged of [journal.jsonStage, journal.markdownStage]) {
    const path = resolve(String(staged ?? ''));
    if (inside(targets.root, path) && path.endsWith('.tmp')) rmSync(path, { force: true });
  }
  if (journal.phase !== 'committed') {
    rmSync(targets.json, { force: true });
    rmSync(targets.markdown, { force: true });
  }
  rmSync(transaction.journal, { force: true });
}

function safeSource(record, facts) {
  const current = facts ?? sourceCurrentFacts(record);
  const freshness = current.missing
    ? 'missing'
    : current.digest === record.digest && current.size === record.size
      ? 'current'
      : 'stale';
  return {
    sourceId: record.sourceId,
    label: record.label,
    extension: record.extension,
    classification: record.classification,
    cloudProcessing: record.cloudProcessing,
    size: record.size,
    lineCount: record.lineCount,
    digest: record.digest,
    registeredAt: record.registeredAt,
    modifiedAt: record.modifiedAt,
    freshness
  };
}

function sourceCurrentFacts(record) {
  if (!existsSync(record.sourcePath)) return { missing: true };
  try {
    const stats = statSync(record.sourcePath);
    if (!stats.isFile()) return { missing: true };
    return contentFacts(record.sourcePath, stats);
  } catch {
    return { missing: true };
  }
}

function inferTier(persona) {
  const path = normalized(String(persona.path ?? ''));
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
  const signals = focus.length
    ? focus
    : ['meeting', 'evidence', 'provenance', 'review', source.classification, source.cloudProcessing];
  const catalogue = Array.isArray(options.personaCatalogue)
    ? options.personaCatalogue
    : installedPersonaCatalogue(projectRoot);
  return selectContextualPersonas({
    signals,
    context: {
      source: {
        classification: source.classification,
        cloudProcessing: source.cloudProcessing,
        freshness: source.freshness
      },
      focus
    },
    personaCatalogue: catalogue.map((persona) => ({ ...persona, tier: inferTier(persona) })),
    contextLabel: 'meeting evidence extraction',
    limit: options.personaLimit ?? 4
  });
}

function candidateContract(source) {
  return {
    schema: CANDIDATE_SCHEMA,
    schemaPath: 'config/meeting-evidence-candidate.schema.json',
    sourceId: source.sourceId,
    sourceDigest: source.digest,
    sourceLineCount: source.lineCount,
    allowedTypes: [...allowedCandidateTypes],
    confidenceLabels: ['low', 'medium', 'high'],
    requiredBoundaries: ['observedStatement', 'interpretation', 'lineAnchors', 'confidence'],
    rawSourceExcerptsAllowed: false,
    rawModelOutputAllowed: false
  };
}

function normaliseCandidate(raw, source) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Each meeting candidate must be an object');
  const allowed = new Set(['id', 'type', 'observedStatement', 'interpretation', 'lineAnchors', 'confidence']);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) throw new Error(`Meeting candidate field is not allowed: ${key}`);
  const id = cleanText(raw.id, 'candidate ID', 30);
  if (!candidateIdPattern.test(id)) throw new Error(`Invalid meeting candidate ID: ${id}`);
  const type = cleanText(raw.type, 'candidate type', 40);
  if (!allowedCandidateTypes.includes(type)) throw new Error(`Unsupported meeting candidate type: ${type}`);
  const observedStatement = cleanText(raw.observedStatement, 'candidate observed statement', 600);
  const interpretation = cleanText(raw.interpretation, 'candidate interpretation', 1000);
  const confidence = cleanText(raw.confidence, 'candidate confidence', 20);
  if (!['low', 'medium', 'high'].includes(confidence)) throw new Error(`Unsupported meeting candidate confidence: ${confidence}`);
  if (!Array.isArray(raw.lineAnchors) || !raw.lineAnchors.length || raw.lineAnchors.length > 20) {
    throw new Error(`${id} requires one to 20 line anchors`);
  }
  const lineAnchors = raw.lineAnchors.map((anchor) => {
    const start = Number(anchor?.start);
    const end = Number(anchor?.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > source.lineCount) {
      throw new Error(`${id} has an invalid line anchor`);
    }
    return { start, end };
  });
  return { id, type, observedStatement, interpretation, lineAnchors, confidence };
}

function normaliseBundle(raw, source) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Meeting candidate bundle must be an object');
  const allowed = new Set(['schema', 'sourceId', 'sourceDigest', 'candidates']);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) throw new Error(`Meeting candidate bundle field is not allowed: ${key}`);
  if (raw.schema !== CANDIDATE_SCHEMA) throw new Error(`Meeting candidate bundle schema must be ${CANDIDATE_SCHEMA}`);
  if (raw.sourceId !== source.sourceId) throw new Error('Meeting candidate bundle source does not match');
  if (raw.sourceDigest !== source.digest) throw new Error('Meeting candidate bundle source digest is stale');
  if (!Array.isArray(raw.candidates) || !raw.candidates.length || raw.candidates.length > 500) {
    throw new Error('Meeting candidate bundle must contain one to 500 candidates');
  }
  const candidates = raw.candidates.map((candidate) => normaliseCandidate(candidate, source));
  if (new Set(candidates.map(({ id }) => id)).size !== candidates.length) throw new Error('Meeting candidate bundle contains a duplicate candidate ID');
  return { schema: CANDIDATE_SCHEMA, sourceId: source.sourceId, sourceDigest: source.digest, candidates };
}

function normaliseDispositions(raw, candidates) {
  if (!Array.isArray(raw) || raw.length !== candidates.length) throw new Error('Meeting review must dispose of every candidate exactly once');
  const known = new Set(candidates.map(({ id }) => id));
  const dispositions = raw.map((item) => {
    const candidateId = cleanText(item?.candidateId, 'review candidate ID', 30);
    if (!known.has(candidateId)) throw new Error(`Meeting review references an unknown candidate: ${candidateId}`);
    const decision = cleanText(item?.decision, 'review decision', 20);
    if (!reviewDecisions.has(decision)) throw new Error(`Unsupported meeting review decision: ${decision}`);
    const replacementText = cleanText(item?.replacementText, 'amendment replacement text', 1000, false);
    const rationale = cleanText(item?.rationale, 'review rationale', 1000, false);
    if (decision === 'amended' && (!replacementText || !rationale)) throw new Error(`${candidateId} amendment requires replacement text and rationale`);
    if (decision !== 'amended' && replacementText) throw new Error(`${candidateId} replacement text is allowed only for an amendment`);
    return { candidateId, decision, ...(replacementText ? { replacementText } : {}), ...(rationale ? { rationale } : {}) };
  });
  if (new Set(dispositions.map(({ candidateId }) => candidateId)).size !== dispositions.length) {
    throw new Error('Meeting review must dispose of every candidate exactly once');
  }
  return dispositions;
}

function renderEvidence(record) {
  const items = record.evidence.map((item) => `### ${item.id} — ${item.type}\n\n- **Statement:** ${item.statement}\n- **Interpretation:** ${item.interpretation}\n- **Confidence:** ${item.confidence}\n- **Source lines:** ${item.lineAnchors.map(({ start, end }) => start === end ? `${start}` : `${start}-${end}`).join(', ')}\n- **Review decision:** ${item.reviewDecision}\n`).join('\n');
  return `# Meeting Evidence — ${record.source.label}\n\n**Schema:** \`${record.schema}\`  \n**Source ID:** \`${record.source.sourceId}\`  \n**Source digest:** \`${record.source.digest}\`  \n**Reviewed by:** ${record.review.reviewedBy}  \n**Approved by:** ${record.promotion.approvedBy}  \n**Approved at:** ${record.promotion.approvedAt}  \n**Evidence digest:** \`${record.evidenceDigest}\`\n\n## Reviewed evidence\n\n${items}\n## Authority boundary\n\nThis pack records reviewed meeting evidence only. It does not create an intent, task, requirement, policy, architecture decision, delivery approval, accepted risk or release authority.\n\n${MEETING_EVIDENCE_DISCLAIMER}\n`;
}

function assertInitialized(paths) {
  if (!existsSync(paths.configPath)) throw new Error('Initialize EWAI before registering meeting evidence');
}

export function registerMeetingSource(projectRoot, file, options = {}) {
  if (!options.confirmed) throw new Error('Meeting source registration requires explicit user confirmation');
  const paths = projectPaths(projectRoot);
  assertInitialized(paths);

  const rawPath = cleanText(file, 'source file', 4096);
  if (rawPath.split(/[\\/]/).includes('..')) throw new Error('Meeting source path traversal is not allowed');
  const candidate = resolve(rawPath);
  if (!existsSync(candidate)) throw new Error('Meeting source is not a readable regular file');
  const linkStats = lstatSync(candidate);
  if (linkStats.isSymbolicLink()) throw new Error('Meeting source must not be a symbolic link');
  if (!linkStats.isFile()) throw new Error('Meeting source must be a readable regular file');
  const sourcePath = realpathSync(candidate);
  const extension = extname(sourcePath).toLowerCase();
  if (!supportedExtensions.has(extension)) throw new Error(`Unsupported meeting source type: ${extension || '(none)'}`);

  const classification = options.classification ?? 'confidential';
  if (!classifications.has(classification)) throw new Error(`Unsupported meeting source classification: ${classification}`);
  const cloudProcessing = options.cloudProcessing ?? 'unknown';
  if (!cloudPolicies.has(cloudProcessing)) throw new Error(`Unsupported meeting source cloud-processing policy: ${cloudProcessing}`);

  const facts = contentFacts(sourcePath, statSync(sourcePath));
  const existingSource = existsSync(sourceRoot(paths))
    ? readdirSync(sourceRoot(paths), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => {
        try {
          return JSON.parse(readFileSync(resolve(sourceRoot(paths), entry.name), 'utf8'));
        } catch {
          return null;
        }
      })
      .find((record) => record?.schema === SOURCE_SCHEMA && record.sourcePath === sourcePath)
    : null;
  if (existingSource) throw new Error(`Meeting source is already registered: ${existingSource.sourceId}`);
  const project = realpathSync(paths.projectRoot);
  const identity = createHash('sha256').update(`${project}\0${sourcePath}`).digest('hex').slice(0, 12);
  const requestedLabel = String(options.label ?? '').trim();
  const label = requestedLabel
    ? cleanText(requestedLabel, 'source label', 160)
    : `Meeting source ${identity.slice(0, 6)}`;
  const sourceId = `meeting.${slugify(label)}.${identity}`;
  const path = sourceRecordPath(paths, sourceId);
  if (existsSync(path)) throw new Error(`Meeting source is already registered: ${sourceId}`);

  const registeredAt = new Date(options.now ?? Date.now()).toISOString();
  const record = {
    schema: SOURCE_SCHEMA,
    sourceId,
    label,
    sourcePath,
    extension,
    classification,
    cloudProcessing,
    ...facts,
    registeredAt
  };
  atomicJson(path, record);
  return {
    schema: REGISTRATION_SCHEMA,
    source: safeSource(record, facts),
    notices: [
      'Raw meeting material remains in its original file and is not copied into SPECS or the runtime database.',
      'Personas provide advisory lenses; they do not approve evidence or replace accountable human review.',
      MEETING_EVIDENCE_DISCLAIMER
    ]
  };
}

export function prepareMeetingExtraction(projectRoot, sourceId, options = {}) {
  const paths = projectPaths(projectRoot);
  assertInitialized(paths);
  const record = readPrivateSource(paths, sourceId);
  const facts = sourceCurrentFacts(record);
  const source = safeSource(record, facts);
  if (source.freshness !== 'current') throw new Error(`Meeting source is ${source.freshness}; register or review the current source before extraction`);
  const permitted = source.cloudProcessing === 'allowed';
  const activePersonas = contextualPersonas(paths.projectRoot, source, options);
  return {
    schema: EXTRACTION_SCHEMA,
    source,
    processing: {
      permitted,
      route: permitted ? 'host-model-with-skill' : 'manual-local-handoff',
      reason: permitted
        ? 'Cloud processing is explicitly allowed for this registered source.'
        : `Cloud processing is ${source.cloudProcessing}; host-model source inspection is not permitted.`
    },
    candidateContract: candidateContract(source),
    activePersonas,
    authority: {
      personasAreAdvisory: true,
      namedReviewRequired: true,
      promotionRequiresSeparateApproval: true,
      downstreamCanonicalAuthoringAllowed: false
    },
    notices: [
      'Do not copy raw source content, source excerpts, prompts or model output into the candidate record.',
      'The standard host model and project/core personas are complete; installed premium and personal personas are optional enrichment only.',
      MEETING_EVIDENCE_DISCLAIMER
    ]
  };
}

export function recordMeetingReview(projectRoot, sourceId, input = {}) {
  const paths = projectPaths(projectRoot);
  assertInitialized(paths);
  const record = readPrivateSource(paths, sourceId);
  const source = safeSource(record);
  if (source.freshness !== 'current') throw new Error(`Meeting source is ${source.freshness}; review requires the current source`);
  const reviewedBy = cleanText(input.reviewedBy, 'named reviewer', 160);
  const bundle = normaliseBundle(input.bundle, source);
  const dispositions = normaliseDispositions(input.dispositions, bundle.candidates);
  const reviewedAt = new Date(input.now ?? Date.now()).toISOString();
  const payload = {
    schema: REVIEW_SCHEMA,
    sourceId,
    sourceDigest: source.digest,
    bundleDigest: canonicalDigest(bundle),
    reviewedBy,
    reviewedAt,
    candidates: bundle.candidates,
    dispositions
  };
  const reviewDigest = canonicalDigest(payload);
  const review = { ...payload, reviewDigest };
  const path = reviewRecordPath(paths, sourceId);
  if (existsSync(path)) {
    const existing = readReview(paths, sourceId);
    if (existing.reviewDigest === reviewDigest) {
      return { schema: 'ewai.meeting-review-recording/v1', sourceId, reviewDigest, reviewedBy, reviewedAt: existing.reviewedAt, idempotent: true };
    }
    throw new Error('Conflicting named meeting review already exists and will not be overwritten');
  }
  atomicJson(path, review);
  const counts = Object.fromEntries([...reviewDecisions].map((decision) => [decision, dispositions.filter((item) => item.decision === decision).length]));
  return { schema: 'ewai.meeting-review-recording/v1', sourceId, reviewDigest, reviewedBy, reviewedAt, counts, idempotent: false };
}

export function promoteMeetingEvidence(projectRoot, sourceId, input = {}) {
  if (input.confirmed !== true) throw new Error('Meeting evidence promotion requires exact confirmation');
  const approvedBy = cleanText(input.approvedBy, 'named approver', 160);
  const paths = projectPaths(projectRoot);
  assertInitialized(paths);
  cleanPromotionTransaction(paths, sourceId);
  const privateSource = readPrivateSource(paths, sourceId);
  const source = safeSource(privateSource);
  if (source.freshness !== 'current') throw new Error(`Meeting source is ${source.freshness}; promotion requires the reviewed source digest`);
  const review = readReview(paths, sourceId);
  if (review.sourceDigest !== source.digest) throw new Error('Meeting source is stale relative to the named review');
  const dispositions = new Map(review.dispositions.map((item) => [item.candidateId, item]));
  const evidence = review.candidates.flatMap((candidate) => {
    const decision = dispositions.get(candidate.id);
    if (!['accepted', 'amended'].includes(decision.decision)) return [];
    return [{
      id: candidate.id,
      type: candidate.type,
      statement: decision.decision === 'amended' ? decision.replacementText : candidate.observedStatement,
      interpretation: candidate.interpretation,
      lineAnchors: candidate.lineAnchors,
      confidence: candidate.confidence,
      reviewDecision: decision.decision,
      ...(decision.rationale ? { rationale: decision.rationale } : {})
    }];
  });
  if (!evidence.length) throw new Error('Meeting review has no accepted or amended evidence to promote');
  const targets = evidencePaths(paths, sourceId);
  if (existsSync(targets.json) || existsSync(targets.markdown)) {
    if (!existsSync(targets.json) || !existsSync(targets.markdown)) throw new Error('Existing meeting evidence pair is incomplete');
    const existing = JSON.parse(readFileSync(targets.json, 'utf8'));
    const samePromotion = existing.source?.digest === source.digest
      && existing.review?.digest === review.reviewDigest
      && existing.promotion?.approvedBy === approvedBy
      && JSON.stringify(existing.evidence) === JSON.stringify(evidence)
      && sha256(readFileSync(targets.markdown, 'utf8')) === existing.markdownDigest;
    if (samePromotion) {
      return {
        schema: 'ewai.meeting-promotion-result/v1', sourceId, evidenceDigest: existing.evidenceDigest,
        jsonPath: safeRelative(paths.projectRoot, targets.json), markdownPath: safeRelative(paths.projectRoot, targets.markdown),
        counts: { promoted: evidence.length, rejected: review.dispositions.filter(({ decision }) => decision === 'rejected').length, deferred: review.dispositions.filter(({ decision }) => decision === 'deferred').length },
        lifecycle: { status: 'already-published' }, idempotent: true
      };
    }
    throw new Error('Conflicting meeting evidence already exists and will not be overwritten');
  }
  const approvedAt = new Date(input.now ?? Date.now()).toISOString();
  const payload = {
    schema: EVIDENCE_SCHEMA,
    source: {
      sourceId: source.sourceId,
      label: source.label,
      classification: source.classification,
      digest: source.digest,
      lineCount: source.lineCount
    },
    review: { digest: review.reviewDigest, reviewedBy: review.reviewedBy, reviewedAt: review.reviewedAt },
    promotion: { approvedBy, approvedAt },
    evidence
  };
  const evidenceDigest = canonicalDigest(payload);
  const record = { ...payload, evidenceDigest };
  const markdown = renderEvidence(record);
  record.markdownDigest = sha256(markdown);
  const json = `${JSON.stringify(record, null, 2)}\n`;
  const transaction = transactionPaths(paths, sourceId);
  mkdirSync(targets.root, { recursive: true });
  mkdirSync(transaction.root, { recursive: true });
  const nonce = `${process.pid}-${randomUUID()}`;
  const jsonStage = `${targets.json}.${nonce}.tmp`;
  const markdownStage = `${targets.markdown}.${nonce}.tmp`;
  const journal = { schema: 'ewai.meeting-evidence-transaction/v1', sourceId, phase: 'staged', jsonStage, markdownStage };
  try {
    writeFileSync(jsonStage, json, 'utf8');
    writeFileSync(markdownStage, markdown, 'utf8');
    atomicJson(transaction.journal, journal);
    renameSync(jsonStage, targets.json);
    journal.phase = 'json-committed';
    atomicJson(transaction.journal, journal);
    if (input.testHooks?.failAfterStage === 'json-committed') throw new Error('Meeting evidence write was interrupted after JSON commit');
    renameSync(markdownStage, targets.markdown);
    journal.phase = 'committed';
    atomicJson(transaction.journal, journal);
    rmSync(transaction.journal, { force: true });
  } catch (error) {
    rmSync(jsonStage, { force: true });
    rmSync(markdownStage, { force: true });
    rmSync(targets.json, { force: true });
    rmSync(targets.markdown, { force: true });
    rmSync(transaction.journal, { force: true });
    throw error;
  }

  const jsonPath = safeRelative(paths.projectRoot, targets.json);
  const markdownPath = safeRelative(paths.projectRoot, targets.markdown);
  const publication = publishLifecycleEventSafely(paths.projectRoot, 'ewai.meeting-evidence.promoted', {
    sourceKey: `meeting-evidence:${sourceId}:${evidenceDigest}`,
    sourceRevision: evidenceDigest,
    occurredAt: approvedAt,
    streamId: `meeting-evidence:${sourceId}`,
    facts: { sourceId, evidenceDigest, candidateCount: evidence.length, approvedAt },
    evidence: [jsonPath, markdownPath]
  });
  return {
    schema: 'ewai.meeting-promotion-result/v1', sourceId, evidenceDigest, jsonPath, markdownPath,
    counts: { promoted: evidence.length, rejected: review.dispositions.filter(({ decision }) => decision === 'rejected').length, deferred: review.dispositions.filter(({ decision }) => decision === 'deferred').length },
    lifecycle: { ...publication, status: publication.event ? 'published' : publication.status ?? 'publication-failed' },
    idempotent: false
  };
}

export function readMeetingEvidenceWorkspace(projectRoot, options = {}) {
  const paths = projectPaths(projectRoot);
  assertInitialized(paths);
  const root = sourceRoot(paths);
  const sources = existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => {
        const record = JSON.parse(readFileSync(resolve(root, entry.name), 'utf8'));
        if (record.schema !== SOURCE_SCHEMA) return null;
        const source = safeSource(record);
        const reviewPath = reviewRecordPath(paths, source.sourceId);
        const targets = evidencePaths(paths, source.sourceId);
        const privateReview = existsSync(reviewPath) ? readReview(paths, source.sourceId) : null;
        const promoted = existsSync(targets.json) && existsSync(targets.markdown)
          ? JSON.parse(readFileSync(targets.json, 'utf8'))
          : null;
        return {
          ...source,
          reviewState: privateReview ? 'reviewed' : 'pending',
          promotionState: promoted ? 'promoted' : 'not-promoted',
          candidateCount: privateReview?.candidates?.length ?? 0,
          reviewedCount: privateReview?.dispositions?.length ?? 0,
          promotedCount: promoted?.evidence?.length ?? 0
        };
      })
      .filter(Boolean)
    : [];
  const selected = options.sourceId
    ? sources.find((source) => source.sourceId === options.sourceId) ?? null
    : sources[0] ?? null;
  if (options.sourceId && !selected) throw new Error(`Unknown meeting source: ${options.sourceId}`);
  const activePersonas = selected ? contextualPersonas(paths.projectRoot, selected, options) : [];
  let review = null;
  let candidates = [];
  let promotion = null;
  if (selected?.reviewState === 'reviewed') {
    const privateReview = readReview(paths, selected.sourceId);
    const dispositions = new Map(privateReview.dispositions.map((item) => [item.candidateId, item]));
    review = {
      digest: privateReview.reviewDigest,
      reviewedBy: privateReview.reviewedBy,
      reviewedAt: privateReview.reviewedAt,
      sourceDigest: privateReview.sourceDigest,
      fresh: privateReview.sourceDigest === selected.digest && selected.freshness === 'current'
    };
    candidates = privateReview.candidates.map((candidate) => ({
      ...candidate,
      disposition: dispositions.get(candidate.id)
    }));
  }
  if (selected?.promotionState === 'promoted') {
    const targets = evidencePaths(paths, selected.sourceId);
    const recorded = JSON.parse(readFileSync(targets.json, 'utf8'));
    promotion = {
      evidenceDigest: recorded.evidenceDigest,
      approvedBy: recorded.promotion?.approvedBy,
      approvedAt: recorded.promotion?.approvedAt,
      promotedCount: Array.isArray(recorded.evidence) ? recorded.evidence.length : 0,
      evidence: [safeRelative(paths.projectRoot, targets.json), safeRelative(paths.projectRoot, targets.markdown)]
    };
  }
  return {
    schema: WORKSPACE_SCHEMA,
    sources,
    selectedSourceId: selected?.sourceId ?? null,
    selectedSource: selected,
    review,
    candidates,
    promotion,
    activePersonas,
    counts: {
      sources: sources.length,
      current: sources.filter((source) => source.freshness === 'current').length,
      stale: sources.filter((source) => source.freshness !== 'current').length
    },
    candidateCounts: Object.fromEntries([...reviewDecisions].map((decision) => [
      decision,
      candidates.filter((candidate) => candidate.disposition?.decision === decision).length
    ])),
    actions: {
      register: true,
      prepare: Boolean(selected && selected.freshness === 'current' && selected.cloudProcessing === 'allowed'),
      review: Boolean(selected && selected.freshness === 'current'),
      promote: Boolean(selected && selected.freshness === 'current' && selected.reviewState === 'reviewed' && selected.promotionState !== 'promoted')
    },
    notices: [
      'Raw meeting text and absolute source paths are intentionally absent from this workspace.',
      'Persona engagement is contextual and advisory. A named human owns review and promotion.',
      MEETING_EVIDENCE_DISCLAIMER
    ]
  };
}
