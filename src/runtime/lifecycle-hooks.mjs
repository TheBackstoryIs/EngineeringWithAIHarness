import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectConfig } from '../project.mjs';
import { listPersonas, personalPersonaRoot, projectPersonaRoot } from '../personas.mjs';
import { openRuntimeDatabase } from './database.mjs';
import { assessSecurityReadiness } from './security-validation.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const installRoot = resolve(moduleDir, '../..');
const HANDLER_SCHEMA = 'ewai.lifecycle-handler/v1';
const EVENT_SCHEMA = 'ewai.lifecycle-event/v1';
const ACK_SCHEMA = 'ewai.lifecycle-hook-ack/v1';
const PROTOCOL_VERSION = '1';
const EVENT_SCHEMA_VERSION = '1';
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = Object.freeze([1_000, 5_000]);
const AUTOMATIC_ATTEMPTS = 3;
const CLAIM_RECOVERY_MS = 60_000;
const MAX_EVENT_BYTES = 32 * 1024;
const MAX_FACT_STRING = 500;
const SAFE_TIERS = new Set(['core', 'premium', 'personal', 'project']);
const identifierPattern = /^[a-z0-9][a-z0-9._-]{0,159}$/;
const semverPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;
const digestPattern = /^sha256:([a-f0-9]{64})$/;
const unsafeKeyPattern = /(secret|token|password|credential|authorization|cookie|command|argument|entrypoint|executable|working.?directory|raw|stdout|stderr|prompt|body|absolute.?path)/i;

export const LIFECYCLE_EVENT_CATALOGUE = Object.freeze([
  Object.freeze({
    name: 'ewai.project.discovery.completed',
    label: 'Discovery completed',
    description: 'The project Discovery outputs and configuration were committed.',
    allowedFacts: Object.freeze(['status', 'selectedPacks', 'minimumStandards', 'complianceReviews', 'organisationBlueprintId']),
  }),
  Object.freeze({
    name: 'ewai.project.starter.materialised',
    label: 'Governed starter materialised',
    description: 'An approved Governed Starter Pack was additively materialised and its canonical evidence was persisted.',
    allowedFacts: Object.freeze([
      'receiptId',
      'adapterId',
      'treeDigest',
      'targetCount',
      'repositoryCount',
      'createdCount',
      'identicalCount',
      'completedAt',
    ]),
  }),
  Object.freeze({
    name: 'ewai.meeting-evidence.promoted',
    label: 'Meeting evidence promoted',
    description: 'A named approver promoted a digest-bound reviewed meeting-evidence pair after canonical persistence.',
    allowedFacts: Object.freeze(['sourceId', 'evidenceDigest', 'candidateCount', 'approvedAt']),
  }),
  Object.freeze({
    name: 'ewai.knowledge-proposals.materialised',
    label: 'Knowledge proposals materialised',
    description: 'A named approver additively materialised a digest-bound reviewed knowledge proposal bundle after canonical persistence.',
    allowedFacts: Object.freeze([
      'bundleId',
      'materialisationDigest',
      'addedCount',
      'alreadyCurrentCount',
      'conflictCount',
      'materialisedAt',
    ]),
  }),
  Object.freeze({
    name: 'ewai.intent.created',
    label: 'Intent created',
    description: 'A project Intent Markdown document and structured state were created.',
    allowedFacts: Object.freeze(['status', 'domain', 'slug']),
  }),
  ...['facts.confirmed', 'evaluation.recorded', 'review.recorded', 'exception.recorded'].map((suffix) => Object.freeze({
    name: `ewai.policy.${suffix}`,
    label: `Policy ${suffix.replace('.', ' ')}`,
    description: 'A bounded organisation-policy design artefact was persisted before this advisory lifecycle event.',
    allowedFacts: Object.freeze(['status', 'intentReference', 'evidenceDigest', 'ruleId']),
  })),
  Object.freeze({
    name: 'ewai.delivery.phase.entered',
    label: 'Delivery phase entered',
    description: 'A guarded EWAI delivery phase entered running state.',
    allowedFacts: Object.freeze(['status', 'phase']),
  }),
  Object.freeze({
    name: 'ewai.delivery.phase.completed',
    label: 'Delivery phase completed',
    description: 'A guarded EWAI delivery phase completed with passing gate evidence.',
    allowedFacts: Object.freeze(['status', 'phase']),
  }),
  Object.freeze({
    name: 'ewai.delivery.build.approved',
    label: 'Build approved',
    description: 'The durable human Build approval was recorded.',
    allowedFacts: Object.freeze(['status', 'decision']),
  }),
  Object.freeze({
    name: 'ewai.delivery.manual-qa.approved',
    label: 'Manual QA approved',
    description: 'The durable human Manual QA approval was recorded.',
    allowedFacts: Object.freeze(['status', 'decision']),
  }),
  Object.freeze({
    name: 'ewai.delivery.completed',
    label: 'Delivery completed',
    description: 'The EWAI Delivery phase completed and handed off to Manual QA.',
    allowedFacts: Object.freeze(['status']),
  }),
  Object.freeze({
    name: 'ewai.delivery.release-ready',
    label: 'Release ready',
    description: 'Delivery is complete and every required human gate is approved.',
    allowedFacts: Object.freeze(['status']),
    derived: true,
  }),
]);

const catalogueByName = new Map(LIFECYCLE_EVENT_CATALOGUE.map((entry) => [entry.name, entry]));

function isoNow(options = {}) {
  const value = typeof options.now === 'function' ? options.now() : options.now;
  return new Date(value ?? Date.now()).toISOString();
}

function plusMilliseconds(value, milliseconds) {
  return new Date(new Date(value).getTime() + milliseconds).toISOString();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertIdentifier(value, label, options = {}) {
  const clean = String(value ?? '').trim();
  const minimum = options.minimum ?? 1;
  const maximum = options.maximum ?? 160;
  if (!identifierPattern.test(clean) || clean.length < minimum || clean.length > maximum) {
    throw new Error(`${label} is invalid: ${clean}`);
  }
  return clean;
}

function assertShortText(value, label, maximum = 160) {
  const clean = String(value ?? '').trim();
  if (!clean || clean.length > maximum || /[\u0000-\u001f]/.test(clean)) {
    throw new Error(`${label} must be between 1 and ${maximum} safe characters`);
  }
  return clean;
}

function isWithin(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (rel && !rel.startsWith('..') && !isAbsolute(rel));
}

function safeRelativeReference(projectRoot, value) {
  const clean = String(value ?? '').trim().replaceAll('\\', '/');
  if (!clean || clean.length > 400 || isAbsolute(clean) || clean.startsWith('../') || clean.includes('/../') || clean.includes('\u0000')) {
    throw new Error(`Lifecycle evidence reference must be project-relative: ${clean}`);
  }
  const absolute = resolve(projectRoot, clean);
  if (!isWithin(projectRoot, absolute)) throw new Error(`Lifecycle evidence reference escapes the project: ${clean}`);
  return clean;
}

function safeValue(value, key, depth = 0) {
  if (unsafeKeyPattern.test(key)) throw new Error(`Lifecycle field is not allowed: ${key}`);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Lifecycle field is not finite: ${key}`);
    return value;
  }
  if (typeof value === 'string') {
    const clean = value.trim();
    if (clean.length > MAX_FACT_STRING || /[\u0000]/.test(clean)) throw new Error(`Lifecycle field is unsafe or too long: ${key}`);
    return clean;
  }
  if (Array.isArray(value)) {
    if (depth > 1 || value.length > 40) throw new Error(`Lifecycle array is too large: ${key}`);
    return value.map((item, index) => safeValue(item, `${key}.${index}`, depth + 1));
  }
  if (value && typeof value === 'object') {
    if (depth > 1 || Object.keys(value).length > 30) throw new Error(`Lifecycle object is too large: ${key}`);
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, safeValue(child, childKey, depth + 1)]));
  }
  throw new Error(`Lifecycle field has unsupported value: ${key}`);
}

function safeFacts(eventName, facts = {}) {
  assertPlainObject(facts, 'Lifecycle facts');
  const allowed = new Set(catalogueByName.get(eventName).allowedFacts);
  const output = {};
  for (const [key, value] of Object.entries(facts)) {
    if (!allowed.has(key)) throw new Error(`Lifecycle fact is not allowed for ${eventName}: ${key}`);
    output[key] = safeValue(value, key);
  }
  return output;
}

function inferredTier(reference, path = '') {
  if (path.includes('/premium-personas/')) return 'premium';
  if (path.includes('/1.Scope/personas/project/')) return 'project';
  if (path.includes('/.ewai/personas/')) return 'personal';
  if (String(reference).startsWith('project.')) return 'project';
  if (String(reference).includes('premium')) return 'premium';
  return 'core';
}

function personaCatalogue(projectRoot) {
  const roots = [
    resolve(installRoot, 'packs/personas/core/personas'),
    resolve(homedir(), '.ewai/packs/ewai.personas.professional/premium-personas'),
    personalPersonaRoot(),
    projectPersonaRoot(projectRoot),
  ];
  const ranks = { project: 4, premium: 3, personal: 2, core: 1 };
  const found = new Map();
  for (const persona of listPersonas(roots)) {
    const tier = SAFE_TIERS.has(persona.tier) ? persona.tier : inferredTier(persona.id, persona.path);
    const existing = found.get(persona.id);
    if (!existing || ranks[tier] > ranks[existing.tier]) found.set(persona.id, { ...persona, tier });
  }
  return found;
}

export function resolveLifecyclePersonas(projectRoot, attachments = []) {
  const catalogue = personaCatalogue(projectRoot);
  return (Array.isArray(attachments) ? attachments : []).slice(0, 12).map((attachment) => {
    const source = typeof attachment === 'string' ? { ref: attachment } : attachment ?? {};
    const id = assertShortText(source.id ?? source.ref, 'Persona ID');
    const persona = catalogue.get(id);
    const tier = SAFE_TIERS.has(source.tier) ? source.tier : persona?.tier ?? inferredTier(id);
    const role = String(source.role ?? '').trim();
    return {
      id,
      name: assertShortText(source.name ?? persona?.name ?? id, 'Persona name'),
      tier,
      reason: assertShortText(
        source.reason ?? source.engagementReason ?? (role ? `Engaged as ${role} for this lifecycle moment.` : 'Attached to the canonical lifecycle context.'),
        'Persona engagement reason',
        300,
      ),
    };
  });
}

function safeScope(scope = {}) {
  assertPlainObject(scope, 'Lifecycle scope');
  const allowed = new Set(['intent', 'delivery', 'phase']);
  const result = {};
  for (const [key, value] of Object.entries(scope)) {
    if (!allowed.has(key)) throw new Error(`Lifecycle scope is not allowed: ${key}`);
    result[key] = assertShortText(value, `Lifecycle ${key}`, 200);
  }
  return result;
}

function validatePattern(pattern) {
  const clean = String(pattern ?? '').trim();
  const matched = LIFECYCLE_EVENT_CATALOGUE.some((entry) => (
    clean === entry.name || (clean.endsWith('.*') && entry.name.startsWith(clean.slice(0, -1)))
  ));
  if (!matched) throw new Error(`Unsupported lifecycle event pattern: ${clean}`);
  return clean;
}

function patternMatches(pattern, eventName) {
  return pattern === eventName || (pattern.endsWith('.*') && eventName.startsWith(pattern.slice(0, -1)));
}

function validateManifestShape(manifest) {
  assertPlainObject(manifest, 'Lifecycle handler manifest');
  const allowedKeys = new Set(['schema', 'id', 'name', 'publisher', 'version', 'compatibility', 'entrypoint', 'digest', 'events', 'limits', 'description']);
  for (const key of Object.keys(manifest)) {
    if (!allowedKeys.has(key)) throw new Error(`Lifecycle handler manifest field is not allowed: ${key}`);
  }
  if (manifest.schema !== HANDLER_SCHEMA) throw new Error(`Unsupported lifecycle handler schema: ${manifest.schema ?? ''}`);
  const id = assertIdentifier(manifest.id, 'Lifecycle handler ID', { minimum: 3, maximum: 128 });
  const name = assertShortText(manifest.name, 'Lifecycle handler name', 120);
  assertPlainObject(manifest.publisher, 'Lifecycle handler publisher');
  for (const key of Object.keys(manifest.publisher)) {
    if (!['id', 'name'].includes(key)) throw new Error(`Lifecycle handler publisher field is not allowed: ${key}`);
  }
  const publisher = {
    id: assertIdentifier(manifest.publisher.id, 'Lifecycle handler publisher ID', { minimum: 2, maximum: 80 }),
    name: assertShortText(manifest.publisher.name, 'Lifecycle handler publisher name', 120),
  };
  const version = String(manifest.version ?? '').trim();
  if (!semverPattern.test(version)) throw new Error(`Lifecycle handler version must be semantic: ${version}`);
  assertPlainObject(manifest.compatibility, 'Lifecycle handler compatibility');
  for (const key of Object.keys(manifest.compatibility)) {
    if (!['protocols', 'eventSchemas'].includes(key)) throw new Error(`Lifecycle handler compatibility field is not allowed: ${key}`);
  }
  if (!Array.isArray(manifest.compatibility.protocols) || !Array.isArray(manifest.compatibility.eventSchemas)) {
    throw new Error('Lifecycle handler compatibility versions must be arrays');
  }
  const protocols = [...new Set((manifest.compatibility.protocols ?? []).map(String))];
  const eventSchemas = [...new Set((manifest.compatibility.eventSchemas ?? []).map(String))];
  if (!protocols.includes(PROTOCOL_VERSION)) throw new Error(`Lifecycle handler does not support protocol ${PROTOCOL_VERSION}`);
  if (!eventSchemas.includes(EVENT_SCHEMA_VERSION)) throw new Error(`Lifecycle handler does not support event schema ${EVENT_SCHEMA_VERSION}`);
  const entrypoint = String(manifest.entrypoint ?? '').trim().replaceAll('\\', '/');
  if (!entrypoint || entrypoint.length > 240 || isAbsolute(entrypoint) || entrypoint.startsWith('../') || entrypoint.includes('/../')) {
    throw new Error('Lifecycle handler entrypoint must be a bounded relative path');
  }
  const digestMatch = String(manifest.digest ?? '').match(digestPattern);
  if (!digestMatch) throw new Error('Lifecycle handler digest must be sha256:<64 lowercase hex characters>');
  if (!Array.isArray(manifest.events) || !manifest.events.length) throw new Error('Lifecycle handler must declare at least one supported event pattern');
  const events = [...new Set(manifest.events.map(validatePattern))].sort();
  assertPlainObject(manifest.limits, 'Lifecycle handler limits');
  for (const key of Object.keys(manifest.limits)) {
    if (!['timeoutMs', 'maxOutputBytes'].includes(key)) throw new Error(`Lifecycle handler limit field is not allowed: ${key}`);
  }
  const timeoutMs = Number(manifest.limits.timeoutMs);
  const maxOutputBytes = Number(manifest.limits.maxOutputBytes);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new Error('Lifecycle handler timeoutMs must be from 100 to 30000');
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 256 || maxOutputBytes > 65_536) throw new Error('Lifecycle handler maxOutputBytes must be from 256 to 65536');
  return {
    schema: HANDLER_SCHEMA,
    id,
    name,
    publisher,
    version,
    compatibility: { protocols, eventSchemas },
    entrypoint,
    digest: `sha256:${digestMatch[1]}`,
    events,
    limits: { timeoutMs, maxOutputBytes },
    ...(manifest.description ? { description: assertShortText(manifest.description, 'Lifecycle handler description', 500) } : {}),
  };
}

function inspectHandlerPackage(folder) {
  const requestedRoot = resolve(String(folder ?? ''));
  if (!existsSync(requestedRoot) || !lstatSync(requestedRoot).isDirectory()) throw new Error('Lifecycle handler folder does not exist or is not a directory');
  if (lstatSync(requestedRoot).isSymbolicLink()) throw new Error('Lifecycle handler root cannot be a symbolic link');
  const trustedRoot = realpathSync(requestedRoot);
  const manifestPath = resolve(trustedRoot, 'lifecycle-handler.json');
  if (!existsSync(manifestPath) || !lstatSync(manifestPath).isFile() || lstatSync(manifestPath).isSymbolicLink()) {
    throw new Error('Lifecycle handler manifest must be a regular non-symlink lifecycle-handler.json file');
  }
  const manifestBytes = readFileSync(manifestPath);
  let parsed;
  try {
    parsed = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    throw new Error('Lifecycle handler manifest is not valid JSON');
  }
  const manifest = validateManifestShape(parsed);
  const requestedEntry = resolve(trustedRoot, manifest.entrypoint);
  if (!isWithin(trustedRoot, requestedEntry) || !existsSync(requestedEntry)) throw new Error('Lifecycle handler entrypoint escapes the trusted root or is missing');
  if (lstatSync(requestedEntry).isSymbolicLink() || !lstatSync(requestedEntry).isFile()) {
    throw new Error('Lifecycle handler entrypoint must be a regular non-symlink file');
  }
  const entrypointPath = realpathSync(requestedEntry);
  if (!isWithin(trustedRoot, entrypointPath)) throw new Error('Lifecycle handler entrypoint resolves outside the trusted root');
  accessSync(entrypointPath, constants.X_OK);
  const entryBytes = readFileSync(entrypointPath);
  const entryDigest = sha256(entryBytes);
  if (manifest.digest !== `sha256:${entryDigest}`) throw new Error('Lifecycle handler entrypoint digest does not match the manifest');
  const manifestDigest = sha256(manifestBytes);
  const packageDigest = sha256(Buffer.concat([manifestBytes, Buffer.from([0]), entryBytes]));
  return { manifest, trustedRoot, entrypointPath, manifestDigest, packageDigest };
}

function safeHandler(packageInfo) {
  const { manifest, manifestDigest, packageDigest } = packageInfo;
  return {
    schema: 'ewai.lifecycle-handler-validation/v1',
    id: manifest.id,
    name: manifest.name,
    publisher: manifest.publisher,
    version: manifest.version,
    protocolVersion: PROTOCOL_VERSION,
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    events: manifest.events,
    limits: manifest.limits,
    manifestDigest,
    packageDigest,
    valid: true,
  };
}

export function validateLifecycleHandlerPackage(_projectRoot, folder) {
  return safeHandler(inspectHandlerPackage(folder));
}

export function registerLifecycleHandler(projectRoot, folder, input = {}) {
  if (input.confirmed !== true) throw new Error('Lifecycle handler registration requires explicit confirmation');
  const inspected = inspectHandlerPackage(folder);
  const database = openRuntimeDatabase(projectRoot);
  const timestamp = isoNow(input);
  try {
    if (database.prepare('SELECT id FROM lifecycle_handlers WHERE id = ?').get(inspected.manifest.id)) {
      throw new Error(`Lifecycle handler ID is already registered: ${inspected.manifest.id}`);
    }
    database.prepare(`
      INSERT INTO lifecycle_handlers (
        id, name, publisher_id, publisher_name, version, protocol_version,
        event_schema_version, trusted_root, entrypoint, manifest_digest,
        package_digest, manifest_json, registered_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      inspected.manifest.id,
      inspected.manifest.name,
      inspected.manifest.publisher.id,
      inspected.manifest.publisher.name,
      inspected.manifest.version,
      PROTOCOL_VERSION,
      EVENT_SCHEMA_VERSION,
      inspected.trustedRoot,
      inspected.manifest.entrypoint,
      inspected.manifestDigest,
      inspected.packageDigest,
      JSON.stringify(inspected.manifest),
      timestamp,
      timestamp,
    );
    return { ...safeHandler(inspected), registeredAt: timestamp };
  } finally {
    database.close();
  }
}

export function subscribeLifecycleHandler(projectRoot, handlerId, patterns, input = {}) {
  if (input.confirmed !== true) throw new Error('Lifecycle handler subscription requires explicit confirmation');
  const requested = [...new Set((Array.isArray(patterns) ? patterns : String(patterns ?? '').split(','))
    .map(validatePattern))].sort();
  if (!requested.length) throw new Error('Lifecycle handler subscription requires at least one event pattern');
  const database = openRuntimeDatabase(projectRoot);
  const timestamp = isoNow(input);
  try {
    const handler = database.prepare('SELECT * FROM lifecycle_handlers WHERE id = ?').get(handlerId);
    if (!handler) throw new Error(`Lifecycle handler is not registered: ${handlerId}`);
    const manifest = parseJson(handler.manifest_json, {});
    for (const pattern of requested) {
      const requestedEvents = LIFECYCLE_EVENT_CATALOGUE.filter((entry) => patternMatches(pattern, entry.name));
      if (requestedEvents.some((entry) => !(manifest.events ?? []).some((declared) => patternMatches(declared, entry.name)))) {
        throw new Error(`Lifecycle handler manifest does not declare support for pattern: ${pattern}`);
      }
    }
    const patternsJson = JSON.stringify(requested);
    const existing = database.prepare('SELECT * FROM lifecycle_subscriptions WHERE handler_id = ? AND patterns_json = ?').get(handlerId, patternsJson);
    if (existing) {
      if (!existing.enabled) {
        database.prepare('UPDATE lifecycle_subscriptions SET enabled = 1, disabled_at = NULL, updated_at = ? WHERE id = ?').run(timestamp, existing.id);
      }
      return { schema: 'ewai.lifecycle-subscription/v1', id: existing.id, handlerId, patterns: requested, enabled: true, created: false };
    }
    const id = randomUUID();
    database.prepare(`
      INSERT INTO lifecycle_subscriptions (id, handler_id, patterns_json, enabled, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `).run(id, handlerId, patternsJson, timestamp, timestamp);
    return { schema: 'ewai.lifecycle-subscription/v1', id, handlerId, patterns: requested, enabled: true, created: true };
  } finally {
    database.close();
  }
}

function projectIdentity(projectRoot) {
  const { config, paths } = loadProjectConfig(projectRoot);
  return {
    id: `project-${sha256(realpathSync(paths.projectRoot)).slice(0, 16)}`,
    name: assertShortText(config.project?.name ?? 'EWAI project', 'Project name', 160),
  };
}

function eventFromRow(row, idempotencyKey = '') {
  return {
    schema: idempotencyKey ? EVENT_SCHEMA : 'ewai.lifecycle-event-record/v1',
    id: row.id,
    name: row.name,
    occurredAt: row.occurred_at,
    project: parseJson(row.project_json, {}),
    scope: parseJson(row.scope_json, {}),
    facts: parseJson(row.facts_json, {}),
    source: { key: row.source_key, ...(row.source_revision ? { revision: row.source_revision } : {}) },
    evidence: parseJson(row.evidence_json, []),
    personas: parseJson(row.personas_json, []),
    stream: { id: row.stream_id, sequence: row.stream_sequence },
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

export function publishLifecycleEvent(projectRoot, eventName, input = {}) {
  const catalogue = catalogueByName.get(eventName);
  if (!catalogue) throw new Error(`Unsupported lifecycle event: ${eventName}`);
  const sourceKey = assertShortText(input.sourceKey, 'Lifecycle source key', 400);
  const occurredAt = new Date(input.occurredAt ?? isoNow(input)).toISOString();
  const sourceRevision = String(input.sourceRevision ?? '').trim().slice(0, 200);
  const scope = safeScope(input.scope ?? {});
  const facts = safeFacts(eventName, input.facts ?? {});
  const evidence = [...new Set((input.evidence ?? []).map((value) => safeRelativeReference(resolve(projectRoot), value)))].slice(0, 24);
  const personas = resolveLifecyclePersonas(projectRoot, input.personas ?? []);
  const project = projectIdentity(projectRoot);
  const streamId = assertShortText(input.streamId ?? (scope.delivery ? `delivery:${scope.delivery}` : scope.intent ? `intent:${scope.intent}` : 'project'), 'Lifecycle stream ID', 200);
  const eventBytes = Buffer.byteLength(JSON.stringify({ project, scope, facts, evidence, personas }), 'utf8');
  if (eventBytes > MAX_EVENT_BYTES) throw new Error('Lifecycle event exceeds the safe envelope size');
  const database = openRuntimeDatabase(projectRoot);
  try {
    const existing = database.prepare('SELECT * FROM lifecycle_events WHERE source_key = ?').get(sourceKey);
    if (existing) return { schema: 'ewai.lifecycle-publication/v1', created: false, event: eventFromRow(existing), deliveryCount: 0 };
    database.exec('BEGIN IMMEDIATE;');
    try {
      const duplicate = database.prepare('SELECT * FROM lifecycle_events WHERE source_key = ?').get(sourceKey);
      if (duplicate) {
        database.exec('COMMIT;');
        return { schema: 'ewai.lifecycle-publication/v1', created: false, event: eventFromRow(duplicate), deliveryCount: 0 };
      }
      const sequence = Number(database.prepare('SELECT COALESCE(MAX(stream_sequence), 0) AS value FROM lifecycle_events WHERE stream_id = ?').get(streamId).value) + 1;
      const id = randomUUID();
      const createdAt = isoNow(input);
      database.prepare(`
        INSERT INTO lifecycle_events (
          id, name, schema_version, occurred_at, source_key, source_revision,
          project_json, scope_json, facts_json, evidence_json, personas_json,
          stream_id, stream_sequence, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, eventName, EVENT_SCHEMA_VERSION, occurredAt, sourceKey, sourceRevision,
        JSON.stringify(project), JSON.stringify(scope), JSON.stringify(facts), JSON.stringify(evidence), JSON.stringify(personas),
        streamId, sequence, createdAt,
      );
      const subscriptions = database.prepare(`
        SELECT s.*, h.name AS handler_name, h.publisher_id, h.publisher_name, h.version,
          h.protocol_version, h.event_schema_version, h.trusted_root, h.entrypoint,
          h.manifest_digest, h.package_digest, h.manifest_json
        FROM lifecycle_subscriptions s
        JOIN lifecycle_handlers h ON h.id = s.handler_id
        WHERE s.enabled = 1
      `).all();
      let deliveryCount = 0;
      for (const subscription of subscriptions) {
        const patterns = parseJson(subscription.patterns_json, []);
        if (!patterns.some((pattern) => patternMatches(pattern, eventName))) continue;
        const deliveryId = randomUUID();
        const idempotencyKey = `ewai-${sha256(`${id}:${subscription.id}`).slice(0, 48)}`;
        const snapshot = {
          id: subscription.handler_id,
          name: subscription.handler_name,
          publisher: { id: subscription.publisher_id, name: subscription.publisher_name },
          version: subscription.version,
          protocolVersion: subscription.protocol_version,
          eventSchemaVersion: subscription.event_schema_version,
          trustedRoot: subscription.trusted_root,
          entrypoint: subscription.entrypoint,
          manifestDigest: subscription.manifest_digest,
          packageDigest: subscription.package_digest,
          manifest: parseJson(subscription.manifest_json, {}),
        };
        database.prepare(`
          INSERT INTO lifecycle_deliveries (
            id, event_id, subscription_id, handler_snapshot_json, idempotency_key,
            status, automatic_attempt_count, manual_pending, next_attempt_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'queued', 0, 0, ?, ?, ?)
        `).run(deliveryId, id, subscription.id, JSON.stringify(snapshot), idempotencyKey, createdAt, createdAt, createdAt);
        deliveryCount += 1;
      }
      database.exec('COMMIT;');
      const event = database.prepare('SELECT * FROM lifecycle_events WHERE id = ?').get(id);
      return { schema: 'ewai.lifecycle-publication/v1', created: true, event: eventFromRow(event), deliveryCount };
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  } finally {
    database.close();
  }
}

export function publishLifecycleEventSafely(projectRoot, eventName, input = {}) {
  try {
    return publishLifecycleEvent(projectRoot, eventName, input);
  } catch {
    return { schema: 'ewai.lifecycle-publication/v1', created: false, event: null, deliveryCount: 0, status: 'publication-failed' };
  }
}

function validateAcknowledgement(value) {
  assertPlainObject(value, 'Lifecycle acknowledgement');
  const allowed = new Set(['schema', 'status', 'code', 'message', 'metadata']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Lifecycle acknowledgement field is not allowed: ${key}`);
  }
  if (value.schema !== ACK_SCHEMA) throw new Error('Lifecycle acknowledgement schema is incompatible');
  if (!['accepted', 'rejected'].includes(value.status)) throw new Error('Lifecycle acknowledgement status must be accepted or rejected');
  const acknowledgement = { schema: ACK_SCHEMA, status: value.status };
  if (value.code !== undefined) acknowledgement.code = assertIdentifier(value.code, 'Lifecycle acknowledgement code', { maximum: 80 });
  if (value.message !== undefined) acknowledgement.message = assertShortText(value.message, 'Lifecycle acknowledgement message', 500);
  if (value.metadata !== undefined) {
    assertPlainObject(value.metadata, 'Lifecycle acknowledgement metadata');
    if (Object.keys(value.metadata).length > 12) throw new Error('Lifecycle acknowledgement metadata has too many fields');
    acknowledgement.metadata = Object.fromEntries(Object.entries(value.metadata).map(([key, item]) => {
      if (unsafeKeyPattern.test(key)) throw new Error(`Lifecycle acknowledgement metadata field is not allowed: ${key}`);
      if (!['string', 'number', 'boolean'].includes(typeof item) && item !== null) throw new Error(`Lifecycle acknowledgement metadata must be scalar: ${key}`);
      return [key, typeof item === 'string' ? assertShortText(item, `Lifecycle acknowledgement metadata ${key}`, 200) : item];
    }));
  }
  return acknowledgement;
}

function invokeLifecycleHandler(snapshot, event, options = {}) {
  const limits = snapshot.manifest?.limits ?? { timeoutMs: 15_000, maxOutputBytes: 16_384 };
  return new Promise((resolvePromise) => {
    const started = Date.now();
    let stdout = Buffer.alloc(0);
    let observedBytes = 0;
    let timedOut = false;
    let tooLarge = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolvePromise({ ...result, durationMs: Date.now() - started });
    };
    let child;
    try {
      child = (options.spawn ?? spawn)(resolve(snapshot.trustedRoot, snapshot.entrypoint), [], {
        cwd: snapshot.trustedRoot,
        env: {
          PATH: process.env.PATH ?? '',
          LANG: process.env.LANG ?? 'C',
          LC_ALL: process.env.LC_ALL ?? '',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
    } catch {
      finish({ ok: false, code: 'handler-start-failed', message: 'The lifecycle handler could not be started.' });
      return;
    }
    const observe = (chunk, capture) => {
      observedBytes += chunk.length;
      if (observedBytes > limits.maxOutputBytes) {
        tooLarge = true;
        child.kill('SIGTERM');
        return;
      }
      if (capture) stdout = Buffer.concat([stdout, chunk]);
    };
    child.stdout.on('data', (chunk) => observe(chunk, true));
    child.stderr.on('data', (chunk) => observe(chunk, false));
    child.stdin.once('error', () => {
      // Early handler exit can close stdin before the bounded event write completes.
    });
    child.once('error', () => finish({ ok: false, code: 'handler-start-failed', message: 'The lifecycle handler could not be started.' }));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1_000).unref();
    }, limits.timeoutMs);
    timer.unref();
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer);
      if (tooLarge) return finish({ ok: false, code: 'handler-output-too-large', message: 'The lifecycle handler acknowledgement exceeded its configured limit.' });
      if (timedOut) return finish({ ok: false, code: 'handler-timeout', message: 'The lifecycle handler exceeded its configured timeout.' });
      if (signal) return finish({ ok: false, code: 'handler-signal', message: 'The lifecycle handler ended before acknowledging the event.' });
      if (exitCode !== 0) return finish({ ok: false, code: 'handler-exit', message: 'The lifecycle handler returned a non-zero exit status.' });
      let acknowledgement;
      try {
        acknowledgement = validateAcknowledgement(JSON.parse(stdout.toString('utf8')));
      } catch {
        return finish({ ok: false, code: 'handler-ack-invalid', message: 'The lifecycle handler returned an invalid acknowledgement.' });
      }
      if (acknowledgement.status === 'rejected') {
        return finish({ ok: false, rejected: true, code: acknowledgement.code || 'handler-rejected', message: acknowledgement.message || 'The lifecycle handler rejected the event.', acknowledgement });
      }
      return finish({ ok: true, code: acknowledgement.code || 'accepted', message: acknowledgement.message || 'Event received.', acknowledgement });
    });
    child.stdin.end(`${JSON.stringify(event)}\n`);
  });
}

function verifyHandlerSnapshot(snapshot) {
  const inspected = inspectHandlerPackage(snapshot.trustedRoot);
  if (
    inspected.manifest.id !== snapshot.id
    || inspected.manifest.version !== snapshot.version
    || inspected.manifest.entrypoint !== snapshot.entrypoint
    || inspected.manifestDigest !== snapshot.manifestDigest
    || inspected.packageDigest !== snapshot.packageDigest
  ) {
    throw new Error('Lifecycle handler package identity or digest changed after registration');
  }
  return inspected;
}

function recordAttempt(database, delivery, kind, result, timestamp) {
  const last = database.prepare('SELECT COALESCE(MAX(ordinal), 0) AS value FROM lifecycle_attempts WHERE delivery_id = ?').get(delivery.id);
  const ordinal = Number(last.value) + 1;
  database.prepare(`
    INSERT INTO lifecycle_attempts (
      id, delivery_id, kind, ordinal, started_at, completed_at, status, code, message, duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), delivery.id, kind, ordinal, timestamp, timestamp,
    result.ok ? 'accepted' : result.rejected ? 'rejected' : 'failed',
    String(result.code ?? '').slice(0, 80),
    String(result.message ?? '').slice(0, 500),
    Math.max(0, Number(result.durationMs ?? 0)),
  );
  return ordinal;
}

function terminalRetention(timestamp) {
  return plusMilliseconds(timestamp, RETENTION_MS);
}

function recoverStaleLifecycleClaims(database, timestamp) {
  const cutoff = plusMilliseconds(timestamp, -CLAIM_RECOVERY_MS);
  database.exec('BEGIN IMMEDIATE;');
  try {
    const stale = database.prepare(`
      SELECT * FROM lifecycle_deliveries
      WHERE status = 'delivering' AND updated_at <= ?
      ORDER BY updated_at, created_at
    `).all(cutoff);
    let recovered = 0;
    for (const delivery of stale) {
      const current = database.prepare(`
        SELECT * FROM lifecycle_deliveries
        WHERE id = ? AND status = 'delivering' AND updated_at <= ?
      `).get(delivery.id, cutoff);
      if (!current) continue;
      const kind = current.manual_pending ? 'manual' : 'automatic';
      const outcome = {
        ok: false,
        code: 'worker-interrupted',
        message: 'The previous lifecycle delivery worker stopped before completing the attempt.',
        durationMs: 0,
      };
      recordAttempt(database, current, kind, outcome, timestamp);
      const automaticCount = current.automatic_attempt_count + (kind === 'automatic' ? 1 : 0);
      if (kind === 'automatic' && automaticCount < AUTOMATIC_ATTEMPTS) {
        database.prepare(`
          UPDATE lifecycle_deliveries SET status = 'retrying', automatic_attempt_count = ?,
            manual_pending = 0, next_attempt_at = ?, last_code = ?, last_message = ?,
            updated_at = ? WHERE id = ?
        `).run(automaticCount, timestamp, outcome.code, outcome.message, timestamp, current.id);
      } else {
        database.prepare(`
          UPDATE lifecycle_deliveries SET status = 'exhausted', automatic_attempt_count = ?,
            manual_pending = 0, next_attempt_at = NULL, last_code = ?, last_message = ?,
            updated_at = ? WHERE id = ?
        `).run(automaticCount, outcome.code, outcome.message, timestamp, current.id);
      }
      recovered += 1;
    }
    database.exec('COMMIT;');
    return recovered;
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
}

export function cleanupLifecycleHookRecords(projectRoot, options = {}) {
  const database = openRuntimeDatabase(projectRoot);
  const timestamp = isoNow(options);
  try {
    const deliveries = database.prepare(`
      SELECT id FROM lifecycle_deliveries
      WHERE retention_after IS NOT NULL AND retention_after <= ?
    `).all(timestamp);
    for (const delivery of deliveries) database.prepare('DELETE FROM lifecycle_deliveries WHERE id = ?').run(delivery.id);
    const orphanCutoff = new Date(new Date(timestamp).getTime() - RETENTION_MS).toISOString();
    database.prepare(`
      DELETE FROM lifecycle_events
      WHERE occurred_at <= ? AND NOT EXISTS (
        SELECT 1 FROM lifecycle_deliveries d WHERE d.event_id = lifecycle_events.id
      )
    `).run(orphanCutoff);
    return { schema: 'ewai.lifecycle-cleanup/v1', removedDeliveries: deliveries.length };
  } finally {
    database.close();
  }
}

export async function dispatchEligibleLifecycleDeliveries(projectRoot, options = {}) {
  cleanupLifecycleHookRecords(projectRoot, options);
  const database = openRuntimeDatabase(projectRoot);
  const timestamp = isoNow(options);
  const limit = Math.max(1, Math.min(50, Number(options.limit ?? 10)));
  let recoveredClaims = 0;
  let candidates;
  try {
    recoveredClaims = recoverStaleLifecycleClaims(database, timestamp);
    candidates = database.prepare(`
      SELECT d.*, e.name AS event_name, e.stream_id, e.stream_sequence,
        e.schema_version, e.occurred_at, e.source_key, e.source_revision,
        e.project_json, e.scope_json, e.facts_json, e.evidence_json, e.personas_json,
        s.enabled AS subscription_enabled
      FROM lifecycle_deliveries d
      JOIN lifecycle_events e ON e.id = d.event_id
      JOIN lifecycle_subscriptions s ON s.id = d.subscription_id
      WHERE d.status IN ('queued', 'retrying')
        AND d.next_attempt_at IS NOT NULL
        AND d.next_attempt_at <= ?
        AND NOT EXISTS (
          SELECT 1
          FROM lifecycle_deliveries earlier
          JOIN lifecycle_events earlier_event ON earlier_event.id = earlier.event_id
          WHERE earlier.subscription_id = d.subscription_id
            AND earlier_event.stream_id = e.stream_id
            AND earlier_event.stream_sequence < e.stream_sequence
            AND earlier.status IN ('queued', 'retrying', 'delivering')
        )
      ORDER BY e.occurred_at, e.stream_sequence, d.created_at
      LIMIT ?
    `).all(timestamp, limit);
  } finally {
    database.close();
  }

  const results = [];
  for (const candidate of candidates) {
    const claimDatabase = openRuntimeDatabase(projectRoot);
    let claimed = false;
    try {
      const update = claimDatabase.prepare(`
        UPDATE lifecycle_deliveries SET status = 'delivering', updated_at = ?
        WHERE id = ? AND status IN ('queued', 'retrying')
      `).run(timestamp, candidate.id);
      claimed = update.changes === 1;
    } finally {
      claimDatabase.close();
    }
    if (!claimed) continue;

    const snapshot = parseJson(candidate.handler_snapshot_json, {});
    let outcome;
    if (!candidate.subscription_enabled) {
      outcome = { ok: false, disabled: true, code: 'subscription-disabled', message: 'The lifecycle subscription is disabled.', durationMs: 0 };
    } else {
      try {
        verifyHandlerSnapshot(snapshot);
        const event = eventFromRow({
          id: candidate.event_id,
          name: candidate.event_name,
          occurred_at: candidate.occurred_at,
          source_key: candidate.source_key,
          source_revision: candidate.source_revision,
          project_json: candidate.project_json,
          scope_json: candidate.scope_json,
          facts_json: candidate.facts_json,
          evidence_json: candidate.evidence_json,
          personas_json: candidate.personas_json,
          stream_id: candidate.stream_id,
          stream_sequence: candidate.stream_sequence,
        }, candidate.idempotency_key);
        outcome = options.invoke
          ? await options.invoke({ snapshot, event, delivery: candidate })
          : await invokeLifecycleHandler(snapshot, event, options);
      } catch {
        outcome = { ok: false, incompatible: true, code: 'handler-incompatible', message: 'The registered lifecycle handler package no longer matches its trusted identity.', durationMs: 0 };
      }
    }

    const resultTime = isoNow(options);
    const resultDatabase = openRuntimeDatabase(projectRoot);
    try {
      const current = resultDatabase.prepare('SELECT * FROM lifecycle_deliveries WHERE id = ?').get(candidate.id);
      if (!current) continue;
      const kind = current.manual_pending ? 'manual' : 'automatic';
      recordAttempt(resultDatabase, current, kind, outcome, resultTime);
      const automaticCount = current.automatic_attempt_count + (kind === 'automatic' ? 1 : 0);
      if (outcome.disabled) {
        resultDatabase.prepare(`
          UPDATE lifecycle_deliveries SET status = 'disabled', manual_pending = 0,
            next_attempt_at = NULL, last_code = ?, last_message = ?, updated_at = ?,
            disabled_at = ?, resolved_at = ?, retention_after = ? WHERE id = ?
        `).run(outcome.code, outcome.message, resultTime, resultTime, resultTime, terminalRetention(resultTime), current.id);
      } else if (outcome.ok) {
        resultDatabase.prepare(`
          UPDATE lifecycle_deliveries SET status = 'succeeded', automatic_attempt_count = ?,
            manual_pending = 0, next_attempt_at = NULL, last_code = ?, last_message = ?,
            updated_at = ?, resolved_at = ?, retention_after = ? WHERE id = ?
        `).run(automaticCount, outcome.code ?? 'accepted', outcome.message ?? 'Event received.', resultTime, resultTime, terminalRetention(resultTime), current.id);
      } else if (outcome.rejected || outcome.incompatible || kind === 'manual') {
        const status = outcome.rejected ? 'rejected' : outcome.incompatible ? 'incompatible' : 'exhausted';
        resultDatabase.prepare(`
          UPDATE lifecycle_deliveries SET status = ?, automatic_attempt_count = ?,
            manual_pending = 0, next_attempt_at = NULL, last_code = ?, last_message = ?,
            updated_at = ? WHERE id = ?
        `).run(status, automaticCount, outcome.code ?? 'handler-failed', outcome.message ?? 'Lifecycle delivery failed.', resultTime, current.id);
      } else if (automaticCount < AUTOMATIC_ATTEMPTS) {
        const next = plusMilliseconds(resultTime, RETRY_DELAYS_MS[automaticCount - 1]);
        resultDatabase.prepare(`
          UPDATE lifecycle_deliveries SET status = 'retrying', automatic_attempt_count = ?,
            manual_pending = 0, next_attempt_at = ?, last_code = ?, last_message = ?,
            updated_at = ? WHERE id = ?
        `).run(automaticCount, next, outcome.code ?? 'handler-failed', outcome.message ?? 'Lifecycle delivery failed.', resultTime, current.id);
      } else {
        resultDatabase.prepare(`
          UPDATE lifecycle_deliveries SET status = 'exhausted', automatic_attempt_count = ?,
            manual_pending = 0, next_attempt_at = NULL, last_code = ?, last_message = ?,
            updated_at = ? WHERE id = ?
        `).run(automaticCount, outcome.code ?? 'handler-failed', outcome.message ?? 'Lifecycle delivery failed.', resultTime, current.id);
      }
      results.push({ id: current.id, status: resultDatabase.prepare('SELECT status FROM lifecycle_deliveries WHERE id = ?').get(current.id).status });
    } finally {
      resultDatabase.close();
    }
  }
  return { schema: 'ewai.lifecycle-dispatch/v1', recoveredClaims, attempted: results.length, deliveries: results };
}

export function retryLifecycleDelivery(projectRoot, deliveryId, input = {}) {
  if (input.confirmed !== true) throw new Error('Lifecycle delivery retry requires explicit confirmation');
  const database = openRuntimeDatabase(projectRoot);
  const timestamp = isoNow(input);
  try {
    const delivery = database.prepare('SELECT * FROM lifecycle_deliveries WHERE id = ?').get(deliveryId);
    if (!delivery) throw new Error(`Lifecycle delivery not found: ${deliveryId}`);
    if (!['exhausted', 'rejected', 'incompatible'].includes(delivery.status)) {
      throw new Error(`Lifecycle delivery is not eligible for manual retry: ${delivery.status}`);
    }
    const subscription = database.prepare('SELECT enabled FROM lifecycle_subscriptions WHERE id = ?').get(delivery.subscription_id);
    if (!subscription?.enabled) throw new Error('Lifecycle delivery cannot retry while its subscription is disabled');
    database.prepare(`
      UPDATE lifecycle_deliveries SET status = 'queued', manual_pending = 1,
        next_attempt_at = ?, updated_at = ?, last_code = '', last_message = ''
      WHERE id = ?
    `).run(timestamp, timestamp, deliveryId);
    return { schema: 'ewai.lifecycle-retry/v1', id: deliveryId, status: 'queued', eventId: delivery.event_id, idempotencyKey: delivery.idempotency_key };
  } finally {
    database.close();
  }
}

export function disableLifecycleSubscription(projectRoot, subscriptionId, input = {}) {
  if (input.confirmed !== true) throw new Error('Lifecycle subscription disable requires explicit confirmation');
  const database = openRuntimeDatabase(projectRoot);
  const timestamp = isoNow(input);
  try {
    const subscription = database.prepare('SELECT * FROM lifecycle_subscriptions WHERE id = ?').get(subscriptionId);
    if (!subscription) throw new Error(`Lifecycle subscription not found: ${subscriptionId}`);
    database.prepare(`
      UPDATE lifecycle_subscriptions SET enabled = 0, disabled_at = ?, updated_at = ? WHERE id = ?
    `).run(timestamp, timestamp, subscriptionId);
    database.prepare(`
      UPDATE lifecycle_deliveries SET status = 'disabled', manual_pending = 0,
        next_attempt_at = NULL, last_code = 'subscription-disabled',
        last_message = 'The lifecycle subscription was disabled.', updated_at = ?,
        disabled_at = ?, resolved_at = COALESCE(resolved_at, ?),
        retention_after = COALESCE(retention_after, ?)
      WHERE subscription_id = ? AND status != 'succeeded' AND status != 'delivering'
    `).run(timestamp, timestamp, timestamp, terminalRetention(timestamp), subscriptionId);
    return { schema: 'ewai.lifecycle-disable/v1', id: subscriptionId, handlerId: subscription.handler_id, enabled: false, disabledAt: timestamp };
  } finally {
    database.close();
  }
}

function safeWorkspaceHandler(row) {
  const manifest = parseJson(row.manifest_json, {});
  return {
    id: row.id,
    name: row.name,
    publisher: { id: row.publisher_id, name: row.publisher_name },
    version: row.version,
    protocolVersion: row.protocol_version,
    eventSchemaVersion: row.event_schema_version,
    events: manifest.events ?? [],
    packageDigest: `sha256:${row.package_digest}`,
    digestStatus: 'verified-at-registration',
    registeredAt: row.registered_at,
  };
}

export function readLifecycleHookWorkspace(projectRoot, filters = {}) {
  const database = openRuntimeDatabase(projectRoot);
  try {
    const handlers = database.prepare('SELECT * FROM lifecycle_handlers ORDER BY name, id').all().map(safeWorkspaceHandler);
    const subscriptions = database.prepare('SELECT * FROM lifecycle_subscriptions ORDER BY created_at DESC').all().map((row) => ({
      id: row.id,
      handlerId: row.handler_id,
      patterns: parseJson(row.patterns_json, []),
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      disabledAt: row.disabled_at,
    }));
    const eventRows = database.prepare('SELECT * FROM lifecycle_events ORDER BY occurred_at DESC, stream_sequence DESC LIMIT 200').all();
    const events = eventRows.map((row) => eventFromRow(row));
    let deliveries = database.prepare(`
      SELECT d.*, e.name AS event_name, e.occurred_at, e.stream_id, e.stream_sequence,
        s.handler_id, h.name AS handler_name
      FROM lifecycle_deliveries d
      JOIN lifecycle_events e ON e.id = d.event_id
      JOIN lifecycle_subscriptions s ON s.id = d.subscription_id
      JOIN lifecycle_handlers h ON h.id = s.handler_id
      ORDER BY e.occurred_at DESC, e.stream_sequence DESC
      LIMIT 300
    `).all();
    if (filters.status) deliveries = deliveries.filter((row) => row.status === filters.status);
    if (filters.event) deliveries = deliveries.filter((row) => row.event_name === filters.event);
    if (filters.handler) deliveries = deliveries.filter((row) => row.handler_id === filters.handler);
    const deliveryIds = new Set(deliveries.map((row) => row.id));
    const attempts = database.prepare('SELECT * FROM lifecycle_attempts ORDER BY completed_at DESC, ordinal DESC LIMIT 500').all()
      .filter((row) => deliveryIds.has(row.delivery_id))
      .map((row) => ({
        id: row.id,
        deliveryId: row.delivery_id,
        kind: row.kind,
        ordinal: row.ordinal,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        status: row.status,
        code: row.code,
        message: row.message,
        durationMs: row.duration_ms,
      }));
    const safeDeliveries = deliveries.map((row) => {
      const snapshot = parseJson(row.handler_snapshot_json, {});
      return ({
        id: row.id,
        eventId: row.event_id,
        eventName: row.event_name,
        occurredAt: row.occurred_at,
        subscriptionId: row.subscription_id,
        handlerId: row.handler_id,
        handlerName: row.handler_name,
        handlerVersion: snapshot.version ?? '',
        packageDigest: snapshot.packageDigest ? `sha256:${snapshot.packageDigest}` : '',
        idempotencyKey: row.idempotency_key,
        stream: { id: row.stream_id, sequence: row.stream_sequence },
        status: row.status,
        automaticAttemptCount: row.automatic_attempt_count,
        manualPending: Boolean(row.manual_pending),
        nextAttemptAt: row.next_attempt_at,
        lastCode: row.last_code,
        lastMessage: row.last_message,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        resolvedAt: row.resolved_at,
        disabledAt: row.disabled_at,
        retentionAfter: row.retention_after,
      });
    });
    const counts = Object.fromEntries(['queued', 'retrying', 'delivering', 'succeeded', 'exhausted', 'rejected', 'incompatible', 'disabled']
      .map((status) => [status, safeDeliveries.filter((delivery) => delivery.status === status).length]));
    return {
      schema: 'ewai.lifecycle-hook-workspace/v1',
      catalogue: LIFECYCLE_EVENT_CATALOGUE,
      summary: {
        handlers: handlers.length,
        subscriptions: subscriptions.filter((subscription) => subscription.enabled).length,
        events: events.length,
        deliveries: safeDeliveries.length,
        ...counts,
      },
      handlers,
      subscriptions,
      events,
      deliveries: safeDeliveries,
      attempts,
    };
  } finally {
    database.close();
  }
}

function jsonFiles(root, found = []) {
  if (!existsSync(root)) return found;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) jsonFiles(path, found);
    else if (entry.isFile() && entry.name.endsWith('.json')) found.push(path);
  }
  return found;
}

function deliveryReleaseReady(state, projectRoot) {
  const delivery = (state.phases ?? []).find((phase) => phase.id === 'delivery');
  const canonicalReady = delivery?.status === 'completed'
    && Boolean(state.approvals?.build)
    && (state.humanGates ?? []).filter((gate) => gate.id).every((gate) => gate.status === 'approved');
  return canonicalReady && assessSecurityReadiness(projectRoot, {
    policySnapshot: state.approvals?.build?.securityPolicy,
  }).ready;
}

function deliveryPersonaAttachments(projectRoot, state) {
  if (Array.isArray(state.intent?.personas)) return state.intent.personas;
  const intentPath = String(state.intent?.path ?? '');
  if (!intentPath) return [];
  const sidecar = resolve(projectRoot, intentPath.replace(/\.md$/i, '.json'));
  if (!isWithin(resolve(projectRoot), sidecar) || !existsSync(sidecar)) return [];
  const intent = parseJson(readFileSync(sidecar, 'utf8'), {});
  return Array.isArray(intent.personas) ? intent.personas : [];
}

export function reconcileCanonicalLifecycleEvents(projectRoot, options = {}) {
  const { config, paths } = loadProjectConfig(projectRoot);
  const publications = [];
  const discovery = config.project?.discovery;
  if (discovery?.status === 'complete' && discovery.completed_at) {
    publications.push(publishLifecycleEventSafely(projectRoot, 'ewai.project.discovery.completed', {
      sourceKey: `project.discovery.completed:${discovery.completed_at}`,
      occurredAt: discovery.completed_at,
      sourceRevision: discovery.completed_at,
      facts: { status: 'complete' },
      evidence: discovery.evidence ? [discovery.evidence] : [],
      streamId: 'project',
      now: options.now,
    }));
  }
  for (const path of jsonFiles(resolve(paths.specsRoot, '2.Purpose/intents'))) {
    const state = parseJson(readFileSync(path, 'utf8'), {});
    if (state.schema !== 'ewai.intent-state/v1' || !state.slug || !state.domain) continue;
    publications.push(publishLifecycleEventSafely(projectRoot, 'ewai.intent.created', {
      sourceKey: `intent.created:${state.domain}/${state.slug}`,
      occurredAt: state.updatedAt,
      sourceRevision: state.updatedAt,
      scope: { intent: `${state.domain}/${state.slug}` },
      facts: { status: state.status ?? 'draft', domain: state.domain, slug: state.slug },
      evidence: state.markdownPath ? [state.markdownPath] : [],
      personas: state.personas ?? [],
      streamId: `intent:${state.domain}/${state.slug}`,
      now: options.now,
    }));
  }
  const buildRoot = resolve(paths.specsRoot, '6.Build');
  if (existsSync(buildRoot)) {
    for (const entry of readdirSync(buildRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const statePath = resolve(buildRoot, entry.name, 'delivery-state.json');
      if (!existsSync(statePath)) continue;
      const state = parseJson(readFileSync(statePath, 'utf8'), {});
      if (state.schema !== 'ewai.delivery-state/v1' || !state.slug) continue;
      const scope = { intent: state.intent?.id ?? state.slug, delivery: state.slug };
      const personas = deliveryPersonaAttachments(paths.projectRoot, state);
      for (const phase of state.phases ?? []) {
        if (phase.startedAt) publications.push(publishLifecycleEventSafely(projectRoot, 'ewai.delivery.phase.entered', {
          sourceKey: `delivery:${state.slug}:phase:${phase.id}:entered:${phase.startedAt}`,
          occurredAt: phase.startedAt,
          sourceRevision: state.updatedAt,
          scope: { ...scope, phase: phase.id },
          facts: { status: 'running', phase: phase.id },
          personas,
          streamId: `delivery:${state.slug}`,
          now: options.now,
        }));
        if (phase.completedAt && phase.status === 'completed') publications.push(publishLifecycleEventSafely(projectRoot, 'ewai.delivery.phase.completed', {
          sourceKey: `delivery:${state.slug}:phase:${phase.id}:completed:${phase.completedAt}`,
          occurredAt: phase.completedAt,
          sourceRevision: state.updatedAt,
          scope: { ...scope, phase: phase.id },
          facts: { status: 'completed', phase: phase.id },
          evidence: phase.gatePath ? [phase.gatePath] : [],
          personas,
          streamId: `delivery:${state.slug}`,
          now: options.now,
        }));
      }
      if (state.approvals?.build?.approvedAt) publications.push(publishLifecycleEventSafely(projectRoot, 'ewai.delivery.build.approved', {
        sourceKey: `delivery:${state.slug}:build.approved:${state.approvals.build.approvedAt}`,
        occurredAt: state.approvals.build.approvedAt,
        sourceRevision: state.updatedAt,
        scope,
        facts: { status: 'approved', decision: 'approved' },
        evidence: state.approvals.build.path ? [state.approvals.build.path] : [],
        personas,
        streamId: `delivery:${state.slug}`,
        now: options.now,
      }));
      const manual = (state.humanGates ?? []).find((gate) => gate.id === 'manual-qa');
      if (manual?.status === 'approved' && manual.approvedAt) publications.push(publishLifecycleEventSafely(projectRoot, 'ewai.delivery.manual-qa.approved', {
        sourceKey: `delivery:${state.slug}:manual-qa.approved:${manual.approvedAt}`,
        occurredAt: manual.approvedAt,
        sourceRevision: state.updatedAt,
        scope,
        facts: { status: 'approved', decision: 'approved' },
        evidence: manual.evidencePath ? [manual.evidencePath] : [],
        personas,
        streamId: `delivery:${state.slug}`,
        now: options.now,
      }));
      const delivery = (state.phases ?? []).find((phase) => phase.id === 'delivery');
      if (delivery?.status === 'completed' && delivery.completedAt) publications.push(publishLifecycleEventSafely(projectRoot, 'ewai.delivery.completed', {
        sourceKey: `delivery:${state.slug}:completed:${delivery.completedAt}`,
        occurredAt: delivery.completedAt,
        sourceRevision: state.updatedAt,
        scope,
        facts: { status: 'completed' },
        evidence: delivery.gatePath ? [delivery.gatePath] : [],
        personas,
        streamId: `delivery:${state.slug}`,
        now: options.now,
      }));
      if (deliveryReleaseReady(state, paths.projectRoot)) {
        const readyAt = manual?.approvedAt ?? state.updatedAt;
        publications.push(publishLifecycleEventSafely(projectRoot, 'ewai.delivery.release-ready', {
          sourceKey: `delivery:${state.slug}:release-ready:${readyAt}`,
          occurredAt: readyAt,
          sourceRevision: state.updatedAt,
          scope,
          facts: { status: 'ready' },
          personas,
          streamId: `delivery:${state.slug}`,
          now: options.now,
        }));
      }
    }
  }
  return {
    schema: 'ewai.lifecycle-reconciliation/v1',
    observed: publications.length,
    created: publications.filter((publication) => publication.created).length,
    failed: publications.filter((publication) => publication.status === 'publication-failed').length,
  };
}
