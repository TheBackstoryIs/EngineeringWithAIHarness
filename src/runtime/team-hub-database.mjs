import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TEAM_HUB_AUTHORITY_NOTICE, validateTeamHubEnvelope } from '../team-hub.mjs';
import { projectTeamHubResourceRelease, validateTeamHubResourcePackage } from '../team-hub-resources.mjs';

export function validateTeamHubDataRoot(dataRoot) {
  const root = resolve(String(dataRoot ?? ''));
  if (!String(dataRoot ?? '').trim()) throw new Error('Team Hub requires an explicit data root.');
  if (/(?:^|[/\\])\.ewai-pipeline(?:[/\\]|$)/i.test(root)) throw new Error('Team Hub data must be separate from every project-local .ewai-pipeline runtime.');
  if (/[/\\](?:CloudStorage|OneDrive|Dropbox|Google Drive)(?:[/\\]|$)/i.test(root) || root.startsWith('/Volumes/')) {
    throw new Error('Team Hub SQLite data must not use a network, removable or cloud-synchronised folder.');
  }
  if (existsSync(root) && lstatSync(root).isSymbolicLink()) throw new Error('Team Hub data root must not be a symbolic link.');
  return root;
}

export function teamHubDatabasePath(dataRoot) {
  return resolve(validateTeamHubDataRoot(dataRoot), 'data/team-hub.sqlite');
}

export function openTeamHubDatabase(dataRoot) {
  const path = teamHubDatabasePath(dataRoot);
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec('PRAGMA busy_timeout = 5000;');
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS team_hub_projects (
      project_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      snapshot_digest TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      receipt_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS team_hub_receipts (
      receipt_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      snapshot_digest TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      accepted_at TEXT NOT NULL,
      receipt_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_team_hub_projects_accepted ON team_hub_projects(accepted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_team_hub_receipts_project ON team_hub_receipts(project_id, accepted_at DESC);
    CREATE TABLE IF NOT EXISTS team_hub_resource_releases (
      resource_id TEXT NOT NULL,
      version TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      publisher_id TEXT NOT NULL,
      publisher_name TEXT NOT NULL,
      compatibility_ewai TEXT NOT NULL,
      package_digest TEXT NOT NULL,
      package_json TEXT NOT NULL,
      published_at TEXT NOT NULL,
      receipt_id TEXT NOT NULL,
      PRIMARY KEY(resource_id, version)
    );
    CREATE TABLE IF NOT EXISTS team_hub_resource_publication_receipts (
      receipt_id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      version TEXT NOT NULL,
      package_digest TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      published_at TEXT NOT NULL,
      receipt_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_team_hub_resource_releases_published
      ON team_hub_resource_releases(resource_id, published_at DESC, version DESC);
  `);
  return database;
}

function publicationReceiptFromRow(row, replayed) {
  return { ...JSON.parse(row.receipt_json), replayed };
}

export function publishTeamHubResource(database, input, options = {}) {
  const resourcePackage = validateTeamHubResourcePackage(input);
  const resource = resourcePackage.resource;
  const idempotencyKey = String(options.idempotencyKey ?? `${resource.id}@${resource.version}:${resourcePackage.digest}`);
  if (!idempotencyKey || idempotencyKey.length > 500 || /[\u0000-\u001f\u007f]/.test(idempotencyKey)) {
    throw Object.assign(new Error('Resource publication idempotency key is invalid.'), { status: 400, code: 'invalid-idempotency-key' });
  }
  const publishedAt = options.at ?? new Date().toISOString();
  const receipt = {
    schema: 'ewai.team-hub-resource-publication-receipt/v1',
    receiptId: options.receiptId ?? `resource-publication-${randomUUID()}`,
    resourceId: resource.id,
    version: resource.version,
    packageDigest: resourcePackage.digest,
    idempotencyKey,
    publishedAt,
    replayed: false,
    authority: 'Publication records immutable transport availability; it does not select or apply this resource.',
  };
  const release = projectTeamHubResourceRelease(resourcePackage);
  database.exec('BEGIN IMMEDIATE;');
  try {
    const replay = database.prepare('SELECT receipt_json FROM team_hub_resource_publication_receipts WHERE idempotency_key = ?').get(idempotencyKey);
    if (replay) {
      database.exec('COMMIT;');
      return publicationReceiptFromRow(replay, true);
    }
    const existing = database.prepare('SELECT package_digest FROM team_hub_resource_releases WHERE resource_id = ? AND version = ?').get(resource.id, resource.version);
    if (existing) {
      if (existing.package_digest !== resourcePackage.digest) {
        throw Object.assign(new Error('A different immutable release already uses this resource ID and version.'), { status: 409, code: 'resource-release-conflict' });
      }
      const prior = database.prepare('SELECT receipt_json FROM team_hub_resource_publication_receipts WHERE resource_id = ? AND version = ? AND package_digest = ? ORDER BY published_at LIMIT 1').get(resource.id, resource.version, resourcePackage.digest);
      if (prior) {
        database.exec('COMMIT;');
        return publicationReceiptFromRow(prior, true);
      }
    }
    database.prepare(`
      INSERT INTO team_hub_resource_releases
        (resource_id, version, kind, name, description, publisher_id, publisher_name,
         compatibility_ewai, package_digest, package_json, published_at, receipt_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      resource.id, resource.version, resource.kind, resource.name, resource.description,
      resource.publisher.id, resource.publisher.name, resource.compatibility.ewai,
      resourcePackage.digest, JSON.stringify(resourcePackage), publishedAt, receipt.receiptId,
    );
    database.prepare(`
      INSERT INTO team_hub_resource_publication_receipts
        (receipt_id, resource_id, version, package_digest, idempotency_key, published_at, receipt_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(receipt.receiptId, resource.id, resource.version, resourcePackage.digest, idempotencyKey, publishedAt, JSON.stringify(receipt));
    database.exec('COMMIT;');
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
  return { ...receipt, release: { ...release, publishedAt, receiptId: receipt.receiptId } };
}

function releaseFromRow(row) {
  const resourcePackage = JSON.parse(row.package_json);
  return {
    schema: 'ewai.team-hub-resource-release/v1',
    kind: row.kind,
    id: row.resource_id,
    name: row.name,
    description: row.description,
    version: row.version,
    publisher: { id: row.publisher_id, name: row.publisher_name },
    compatibility: { ewai: row.compatibility_ewai },
    digest: row.package_digest,
    fileCount: resourcePackage.files.length,
    totalBytes: resourcePackage.files.reduce((sum, file) => sum + file.size, 0),
    publishedAt: row.published_at,
    receiptId: row.receipt_id,
  };
}

export function readTeamHubResourceCatalogue(database) {
  const releases = database.prepare(`
    SELECT resource_id, version, kind, name, description, publisher_id, publisher_name,
      compatibility_ewai, package_digest, package_json, published_at, receipt_id
    FROM team_hub_resource_releases
    ORDER BY resource_id COLLATE NOCASE, published_at DESC, version DESC
  `).all().map(releaseFromRow);
  return {
    schema: 'ewai.team-hub-resource-catalogue/v1',
    releases,
    authority: 'Discovery does not install, select or apply a resource.',
  };
}

export function readTeamHubResourcePackage(database, resourceId, version) {
  const row = database.prepare('SELECT package_json FROM team_hub_resource_releases WHERE resource_id = ? AND version = ?').get(String(resourceId), String(version));
  if (!row) throw Object.assign(new Error('Team Hub resource release was not found.'), { status: 404, code: 'resource-release-not-found' });
  return validateTeamHubResourcePackage(JSON.parse(row.package_json));
}

function receiptFromRow(row, replayed) {
  const receipt = JSON.parse(row.receipt_json);
  return { ...receipt, replayed };
}

export function ingestTeamHubEnvelope(database, input, options = {}) {
  const envelope = validateTeamHubEnvelope(input);
  const acceptedAt = options.at ?? new Date().toISOString();
  const receipt = {
    schema: 'ewai.team-hub-receipt/v1',
    receiptId: options.receiptId ?? `receipt-${randomUUID()}`,
    projectId: envelope.snapshot.project.id,
    snapshotDigest: envelope.snapshotDigest,
    idempotencyKey: envelope.idempotencyKey,
    acceptedAt,
    replayed: false,
  };
  const receiptJson = JSON.stringify(receipt);
  const snapshotJson = JSON.stringify(envelope.snapshot);

  database.exec('BEGIN IMMEDIATE;');
  try {
    const existing = database.prepare('SELECT receipt_json FROM team_hub_receipts WHERE idempotency_key = ?').get(envelope.idempotencyKey);
    if (existing) {
      database.exec('COMMIT;');
      return receiptFromRow(existing, true);
    }
    database.prepare(`
      INSERT INTO team_hub_receipts (receipt_id, project_id, snapshot_digest, idempotency_key, accepted_at, receipt_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(receipt.receiptId, receipt.projectId, receipt.snapshotDigest, receipt.idempotencyKey, receipt.acceptedAt, receiptJson);
    database.prepare(`
      INSERT INTO team_hub_projects (project_id, name, snapshot_json, snapshot_digest, generated_at, accepted_at, receipt_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        name = excluded.name,
        snapshot_json = excluded.snapshot_json,
        snapshot_digest = excluded.snapshot_digest,
        generated_at = excluded.generated_at,
        accepted_at = excluded.accepted_at,
        receipt_id = excluded.receipt_id,
        updated_at = excluded.updated_at
      WHERE excluded.generated_at >= team_hub_projects.generated_at
    `).run(
      receipt.projectId, envelope.snapshot.project.name, snapshotJson, envelope.snapshotDigest,
      envelope.snapshot.generatedAt, receipt.acceptedAt, receipt.receiptId, acceptedAt,
    );
    database.exec('COMMIT;');
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
  return receipt;
}

function freshness(acceptedAt, nowValue, staleAfterHours) {
  const accepted = Date.parse(acceptedAt);
  const now = Date.parse(nowValue);
  if (!Number.isFinite(accepted) || !Number.isFinite(now)) return { state: 'unknown', acceptedAt, ageHours: null };
  const ageHours = Math.max(0, Math.floor((now - accepted) / 3_600_000));
  return { state: ageHours > staleAfterHours ? 'stale' : 'current', acceptedAt, ageHours };
}

export function readTeamHubPortfolio(database, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const staleAfterHours = Math.max(1, Math.min(8_760, Number(options.staleAfterHours ?? 72)));
  const rows = database.prepare('SELECT * FROM team_hub_projects ORDER BY name COLLATE NOCASE, project_id').all();
  const projects = rows.map((row) => {
    const snapshot = JSON.parse(row.snapshot_json);
    const observed = freshness(row.accepted_at, now, staleAfterHours);
    const attention = [...(snapshot.delivery?.attention ?? [])];
    if (observed.state === 'stale') attention.unshift({ code: 'snapshot-stale', severity: 'warning', summary: 'The latest accepted snapshot is stale.' });
    return {
      id: row.project_id,
      name: row.name,
      freshness: observed,
      evidence: {
        submittedAt: snapshot.generatedAt,
        acceptedAt: row.accepted_at,
        snapshotDigest: row.snapshot_digest,
        receiptId: row.receipt_id,
      },
      ewaiVersion: snapshot.ewaiVersion,
      revisionDigest: snapshot.revision.digest,
      intents: snapshot.intents,
      delivery: snapshot.delivery,
      resources: snapshot.resources,
      attention: attention.slice(0, 20),
    };
  });
  return {
    schema: 'ewai.team-hub-portfolio/v1',
    generatedAt: now,
    staleAfterHours,
    projects,
    summary: {
      total: projects.length,
      current: projects.filter(({ freshness: item }) => item.state === 'current').length,
      stale: projects.filter(({ freshness: item }) => item.state === 'stale').length,
      attention: projects.filter(({ attention }) => attention.length > 0).length,
    },
    authority: { canApprove: false, notice: TEAM_HUB_AUTHORITY_NOTICE },
  };
}
