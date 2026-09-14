import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import YAML from 'yaml';
import { recoverIntentTransactions } from '../intents.mjs';
import { openRuntimeDatabase } from './database.mjs';
import { runtimePaths } from './paths.mjs';

function findMarkdown(root) {
  if (!existsSync(root)) return [];
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) found.push(...findMarkdown(path));
    if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') found.push(path);
  }
  return found;
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  try {
    return YAML.parse(match[1]) ?? {};
  } catch {
    return {};
  }
}

function titleFromSlug(slug) {
  return slug.split('-').map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`).join(' ');
}

function problemExcerpt(markdown) {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const lines = body.split(/\r?\n/);
  const problemStart = lines.findIndex((line) => /^##\s+Problem\s*$/i.test(line));
  const problemEnd = problemStart === -1
    ? -1
    : lines.findIndex((line, index) => index > problemStart && /^##\s+/.test(line));
  const problem = problemStart === -1
    ? ''
    : lines.slice(problemStart + 1, problemEnd === -1 ? undefined : problemEnd).join(' ');
  const fallback = body.replace(/^#.+$/m, '');
  return (problem || fallback)
    .replace(/[`*_>#\[\]]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function sourceIntent(intentsRoot, path) {
  const markdown = readFileSync(path, 'utf8');
  const metadata = parseFrontmatter(markdown);
  const sourcePath = relative(intentsRoot, path).replace(/\\/g, '/');
  const id = sourcePath.replace(/\.md$/i, '');
  const segments = id.split('/');
  const filenameSlug = segments.at(-1);
  const slug = metadata.slug || filenameSlug;
  const domain = metadata.domain || (segments.length > 1 ? segments[0] : 'general');
  return {
    id,
    slug,
    domain,
    title: metadata.title || titleFromSlug(slug),
    status: metadata.status || 'draft',
    deliveryStatus: metadata.delivery_status || 'not-started',
    currentPhase: metadata.current_phase || 'backlog',
    deliveryStatePath: metadata.delivery_state_path || '',
    path,
    intentMap: metadata.intent_map || null,
    personas: Array.isArray(metadata.personas) ? metadata.personas : [],
    relationships: Array.isArray(metadata.relationships) ? metadata.relationships : [],
    deliveryShape: metadata.delivery_shape ?? null,
    excerpt: problemExcerpt(markdown),
    markdown,
    contentHash: createHash('sha256').update(markdown).digest('hex'),
    sourceMtimeMs: statSync(path).mtimeMs
  };
}

export function syncIntentIndex(projectRoot, database = null) {
  recoverIntentTransactions(projectRoot);
  const ownsDatabase = !database;
  const db = database ?? openRuntimeDatabase(projectRoot);
  const { intentsRoot } = runtimePaths(projectRoot);
  const intents = findMarkdown(intentsRoot).map((path) => sourceIntent(intentsRoot, path));
  const upsert = db.prepare(`
    INSERT INTO intents (
      id, slug, domain, title, status, delivery_status, current_phase,
      delivery_state_path, path, intent_map, personas_json, relationships_json,
      delivery_shape_json,
      excerpt, markdown, content_hash, source_mtime_ms, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      slug = excluded.slug,
      domain = excluded.domain,
      title = excluded.title,
      status = excluded.status,
      delivery_status = excluded.delivery_status,
      current_phase = excluded.current_phase,
      delivery_state_path = excluded.delivery_state_path,
      path = excluded.path,
      intent_map = excluded.intent_map,
      personas_json = excluded.personas_json,
      relationships_json = excluded.relationships_json,
      delivery_shape_json = excluded.delivery_shape_json,
      excerpt = excluded.excerpt,
      markdown = excluded.markdown,
      content_hash = excluded.content_hash,
      source_mtime_ms = excluded.source_mtime_ms,
      updated_at = CURRENT_TIMESTAMP
  `);

  db.exec('BEGIN IMMEDIATE;');
  try {
    for (const intent of intents) {
      upsert.run(
        intent.id,
        intent.slug,
        intent.domain,
        intent.title,
        intent.status,
        intent.deliveryStatus,
        intent.currentPhase,
        intent.deliveryStatePath,
        intent.path,
        intent.intentMap,
        JSON.stringify(intent.personas),
        JSON.stringify(intent.relationships),
        JSON.stringify(intent.deliveryShape),
        intent.excerpt,
        intent.markdown,
        intent.contentHash,
        intent.sourceMtimeMs
      );
    }
    if (intents.length) {
      const placeholders = intents.map(() => '?').join(', ');
      db.prepare(`DELETE FROM intents WHERE id NOT IN (${placeholders})`).run(...intents.map((intent) => intent.id));
    } else {
      db.exec('DELETE FROM intents;');
    }
    db.prepare(`
      INSERT INTO runtime_meta (key, value, updated_at)
      VALUES ('intents_last_synced_at', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(new Date().toISOString());
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }

  if (ownsDatabase) db.close();
  return { count: intents.length, intents };
}

function rowToIntent(row, includeMarkdown = false) {
  if (!row) return null;
  const intent = {
    id: row.id,
    slug: row.slug,
    domain: row.domain,
    title: row.title,
    status: row.status,
    deliveryStatus: row.delivery_status,
    currentPhase: row.current_phase,
    deliveryStatePath: row.delivery_state_path,
    path: row.path,
    intentMap: row.intent_map || null,
    personas: JSON.parse(row.personas_json || '[]'),
    relationships: JSON.parse(row.relationships_json || '[]'),
    deliveryShape: JSON.parse(row.delivery_shape_json || 'null'),
    excerpt: row.excerpt,
    updatedAt: row.updated_at
  };
  if (includeMarkdown) intent.markdown = row.markdown;
  return intent;
}

export function listRuntimeIntents(projectRoot, options = {}) {
  const database = openRuntimeDatabase(projectRoot);
  try {
    syncIntentIndex(projectRoot, database);
    const query = String(options.query ?? '').trim().toLowerCase();
    const status = String(options.status ?? '').trim();
    const rows = database.prepare(`
      SELECT * FROM intents
      WHERE (? = '' OR status = ?)
        AND (? = '' OR lower(title || ' ' || slug || ' ' || domain || ' ' || coalesce(intent_map, '') || ' ' || coalesce(relationships_json, '') || ' ' || coalesce(delivery_shape_json, '') || ' ' || excerpt) LIKE '%' || ? || '%')
      ORDER BY CASE status WHEN 'ready' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, title COLLATE NOCASE
    `).all(status, status, query, query);
    return rows.map((row) => rowToIntent(row));
  } finally {
    database.close();
  }
}

export function readRuntimeIntent(projectRoot, reference) {
  const database = openRuntimeDatabase(projectRoot);
  try {
    syncIntentIndex(projectRoot, database);
    const exact = database.prepare('SELECT * FROM intents WHERE id = ?').get(reference);
    if (exact) return rowToIntent(exact, true);
    const matches = database.prepare('SELECT * FROM intents WHERE slug = ? ORDER BY id LIMIT 2').all(reference);
    if (matches.length > 1) throw new Error(`Ambiguous intent slug: ${reference}; use the exact domain/slug reference.`);
    return rowToIntent(matches[0], true);
  } finally {
    database.close();
  }
}

export function runtimeIntentSummary(projectRoot) {
  const intents = listRuntimeIntents(projectRoot);
  const byStatus = intents.reduce((summary, intent) => {
    summary[intent.status] = (summary[intent.status] ?? 0) + 1;
    return summary;
  }, {});
  return { count: intents.length, byStatus };
}
