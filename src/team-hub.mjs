import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadProjectConfig } from './project.mjs';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const packageVersion = JSON.parse(readFileSync(resolve(moduleDirectory, '../package.json'), 'utf8')).version;

export const TEAM_HUB_SNAPSHOT_SCHEMA = 'ewai.team-hub-snapshot/v1';
export const TEAM_HUB_ENVELOPE_SCHEMA = 'ewai.team-hub-envelope/v1';
export const TEAM_HUB_RECEIPT_SCHEMA = 'ewai.team-hub-receipt/v1';
export const TEAM_HUB_DISCLOSURE_SCHEMA = 'ewai.team-hub-disclosure/v1';
export const TEAM_HUB_AUTHORITY_NOTICE = 'Team Hub is an operational evidence projection. It cannot approve Build or Manual QA, accept risk, certify compliance, deploy or release.';

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/, 'must be a sha256 digest');
const isoDateTime = z.string().datetime({ offset: true });
const slug = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, 'must be a lower-case safe identifier');
const unsafeReference = /(?:\0|https?:\/\/|file:\/\/|(?:^|\s)\/(?:Users|home|private|tmp|var|etc)\/|[A-Za-z]:\\)/i;
const safeText = (maximum, label) => z.string().trim().min(1).max(maximum).refine(
  (value) => !unsafeReference.test(value),
  `${label} contains an unsafe path or remote reference`,
);
const attentionSchema = z.object({
  code: slug,
  severity: z.enum(['info', 'warning', 'blocking']),
  summary: safeText(240, 'attention summary'),
}).strict();
const resourceSchema = z.object({
  kind: z.enum(['organisation-blueprint', 'design-system', 'technology-pack', 'starter-pack']),
  id: z.string().min(1).max(180).regex(/^(?:ewai|org)\.[a-z0-9.-]+$/),
  version: z.string().min(1).max(40).regex(/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/),
  digest,
}).strict();
const intentCountsSchema = z.object({
  total: z.number().int().min(0).max(100_000),
  draft: z.number().int().min(0).max(100_000),
  ready: z.number().int().min(0).max(100_000),
  inProgress: z.number().int().min(0).max(100_000),
  completed: z.number().int().min(0).max(100_000),
  blocked: z.number().int().min(0).max(100_000),
}).strict().superRefine((value, context) => {
  const classified = value.draft + value.ready + value.inProgress + value.completed + value.blocked;
  if (classified !== value.total) context.addIssue({ code: 'custom', message: 'Intent counts must add up to total.' });
});
const deliverySchema = z.object({
  slug,
  title: safeText(200, 'delivery title'),
  status: safeText(80, 'delivery status'),
  currentPhase: safeText(80, 'delivery phase'),
  updatedAt: isoDateTime,
  buildApproved: z.boolean(),
  manualQa: safeText(80, 'Manual QA status'),
  attention: z.array(attentionSchema).max(20),
}).strict();
const snapshotSchema = z.object({
  schema: z.literal(TEAM_HUB_SNAPSHOT_SCHEMA),
  project: z.object({ id: slug, name: safeText(200, 'project name') }).strict(),
  generatedAt: isoDateTime,
  ewaiVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/).max(40),
  revision: z.object({ digest }).strict(),
  intents: intentCountsSchema,
  delivery: deliverySchema.nullable(),
  resources: z.array(resourceSchema).max(25),
  authorityNotice: z.literal(TEAM_HUB_AUTHORITY_NOTICE),
}).strict();
const envelopeSchema = z.object({
  schema: z.literal(TEAM_HUB_ENVELOPE_SCHEMA),
  idempotencyKey: digest,
  snapshotDigest: digest,
  snapshot: snapshotSchema,
}).strict();

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export function teamHubDigest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`;
}

function parse(schema, value, label) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const detail = result.error.issues.map((issue) => `${issue.path.join('.') || label}: ${issue.message}`).join('; ');
  throw new Error(`${label} is invalid or contains an unrecognised field: ${detail}`);
}

export function validateTeamHubSnapshot(value) {
  return parse(snapshotSchema, value, 'Team Hub snapshot');
}

export function validateTeamHubReceipt(value) {
  return parse(z.object({
    schema: z.literal(TEAM_HUB_RECEIPT_SCHEMA),
    receiptId: z.string().regex(/^receipt-[a-zA-Z0-9-]{1,100}$/),
    projectId: slug,
    snapshotDigest: digest,
    idempotencyKey: digest,
    acceptedAt: isoDateTime,
    replayed: z.boolean(),
  }).strict(), value, 'Team Hub receipt');
}

export function buildTeamHubEnvelope(snapshotInput) {
  const snapshot = validateTeamHubSnapshot(snapshotInput);
  const snapshotDigest = teamHubDigest(snapshot);
  return { schema: TEAM_HUB_ENVELOPE_SCHEMA, idempotencyKey: snapshotDigest, snapshotDigest, snapshot };
}

export function validateTeamHubEnvelope(value) {
  const envelope = parse(envelopeSchema, value, 'Team Hub envelope');
  const actual = teamHubDigest(envelope.snapshot);
  if (envelope.snapshotDigest !== actual || envelope.idempotencyKey !== actual) {
    throw new Error('Team Hub envelope digest or idempotency key disagrees with its snapshot.');
  }
  return envelope;
}

const disclosureFields = Object.freeze([
  'project.id', 'project.name', 'generatedAt', 'ewaiVersion', 'revision.digest', 'intents',
  'delivery', 'resources.kind', 'resources.id', 'resources.version', 'resources.digest', 'authorityNotice',
]);
const excludedCategories = Object.freeze([
  'credentials', 'error-report-packages', 'local-paths', 'logs', 'persona-bodies', 'prompts-and-transcripts',
  'repository-remotes', 'source-and-specs-bodies',
]);

export function inspectTeamHubDisclosure() {
  const contract = { schema: TEAM_HUB_SNAPSHOT_SCHEMA, fields: [...disclosureFields], excluded: [...excludedCategories] };
  return {
    schema: TEAM_HUB_DISCLOSURE_SCHEMA,
    title: 'Exact project snapshot disclosure',
    fields: contract.fields,
    excluded: contract.excluded,
    contractDigest: teamHubDigest(contract),
    authorityNotice: TEAM_HUB_AUTHORITY_NOTICE,
  };
}

function filesUnder(root, suffix, maximum = 10_000) {
  if (!existsSync(root) || lstatSync(root).isSymbolicLink()) return [];
  const found = [];
  const queue = [root];
  while (queue.length && found.length < maximum) {
    const current = queue.shift();
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) continue;
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) queue.push(path);
      if (entry.isFile() && entry.name.endsWith(suffix) && statSync(path).size <= 512 * 1024) found.push(path);
    }
  }
  return found;
}

function intentCounts(specsRoot) {
  const counts = { total: 0, draft: 0, ready: 0, inProgress: 0, completed: 0, blocked: 0 };
  for (const path of filesUnder(resolve(specsRoot, '2.Purpose/intents'), '.json')) {
    try {
      const value = JSON.parse(readFileSync(path, 'utf8'));
      if (value.schema !== 'ewai.intent-state/v1') continue;
      counts.total += 1;
      const status = String(value.status ?? '').toLowerCase();
      if (status === 'completed' || status === 'done') counts.completed += 1;
      else if (status === 'blocked') counts.blocked += 1;
      else if (status === 'in-progress' || status === 'in_progress' || value.deliveryStatus === 'in-progress') counts.inProgress += 1;
      else if (status === 'ready' || status === 'approved') counts.ready += 1;
      else counts.draft += 1;
    } catch {
      // Invalid intent state is not promoted into a Hub snapshot.
    }
  }
  return counts;
}

function latestDelivery(specsRoot) {
  const records = [];
  for (const path of filesUnder(resolve(specsRoot, '6.Build'), 'delivery-state.json', 500)) {
    try {
      const state = JSON.parse(readFileSync(path, 'utf8'));
      if (state.schema !== 'ewai.delivery-state/v1' || !state.updatedAt) continue;
      const manualQa = (state.humanGates ?? []).find((gate) => gate.id === 'manual-qa');
      const attention = [];
      if (state.blockedReason || state.status === 'blocked') attention.push({ code: 'delivery-blocked', severity: 'blocking', summary: 'The latest delivery reports a blocker.' });
      if ((manualQa?.status ?? 'pending') !== 'approved') attention.push({ code: 'manual-qa-pending', severity: 'info', summary: 'Manual QA remains pending.' });
      records.push({
        slug: String(state.slug ?? '').slice(0, 120),
        title: String(state.intent?.title ?? state.slug ?? 'Delivery').slice(0, 200),
        status: String(state.status ?? 'unknown').slice(0, 80),
        currentPhase: String(state.currentPhase ?? 'unknown').slice(0, 80),
        updatedAt: String(state.updatedAt), buildApproved: Boolean(state.approvals?.build),
        manualQa: String(manualQa?.status ?? 'pending').slice(0, 80), attention,
      });
    } catch {
      // Invalid delivery state is not promoted into a Hub snapshot.
    }
  }
  return records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
}

function repositoryRevision(projectRoot) {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8', timeout: 2_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return teamHubDigest({ head });
  } catch {
    return teamHubDigest({ head: 'unavailable' });
  }
}

function selectedResources(config) {
  const resources = [];
  const blueprint = config.blueprints?.organisation?.root;
  if (blueprint?.id && blueprint?.version && blueprint?.digest) resources.push({ kind: 'organisation-blueprint', id: blueprint.id, version: blueprint.version, digest: blueprint.digest });
  const design = config.design_system?.root;
  const designDigest = config.design_system?.effective_digest ?? design?.digest;
  if (design?.id && design?.version && designDigest) resources.push({ kind: 'design-system', id: design.id, version: design.version, digest: designDigest });
  return resources.slice(0, 25);
}

export function buildTeamHubSnapshot(projectRoot, options = {}) {
  const { config, paths } = loadProjectConfig(projectRoot);
  const snapshot = {
    schema: TEAM_HUB_SNAPSHOT_SCHEMA,
    project: {
      id: options.projectId ?? 'local-project',
      name: config.project?.name ?? 'EWAI project',
    },
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    ewaiVersion: packageVersion,
    revision: { digest: options.revisionDigest ?? repositoryRevision(paths.projectRoot) },
    intents: options.intents ?? intentCounts(paths.specsRoot),
    delivery: options.delivery === undefined ? latestDelivery(paths.specsRoot) : options.delivery,
    resources: options.resources ?? selectedResources(config),
    authorityNotice: TEAM_HUB_AUTHORITY_NOTICE,
  };
  return validateTeamHubSnapshot(snapshot);
}
