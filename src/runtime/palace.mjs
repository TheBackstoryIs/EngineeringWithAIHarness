import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { listKnowledge, readKnowledgeDocument } from './knowledge.mjs';
import { openRuntimeDatabase } from './database.mjs';
import { runtimePaths } from './paths.mjs';

const markdownExtensions = new Set(['.md', '.markdown']);

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function within(root, target) {
  const path = relative(root, target);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function normalized(path) {
  return path.replaceAll('\\', '/');
}

function titleFromPath(path) {
  return basename(path, extname(path)).replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function stripFrontmatter(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function parseSections(document) {
  const content = stripFrontmatter(document.content);
  const lines = content.split(/\r?\n/);
  const headings = [];
  let title = titleFromPath(document.path);
  let hasTitle = false;
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[index]);
    if (!match) continue;
    const level = match[1].length;
    const heading = match[2].replace(/\s+#+\s*$/, '').trim();
    if (level === 1 && !hasTitle) {
      title = heading;
      hasTitle = true;
    }
    headings.push({ index, line: index + 1, level, heading });
  }

  if (!markdownExtensions.has(document.extension) || headings.length === 0) {
    return {
      title,
      hasTitle: !markdownExtensions.has(document.extension),
      sections: [{ heading: title, headingPath: title, line: 1, body: content }]
    };
  }

  const sections = [];
  const stack = [];
  if (headings[0].index > 0 && lines.slice(0, headings[0].index).join('\n').trim()) {
    sections.push({ heading: title, headingPath: title, line: 1, body: lines.slice(0, headings[0].index).join('\n') });
  }
  for (let position = 0; position < headings.length; position += 1) {
    const current = headings[position];
    const end = headings[position + 1]?.index ?? lines.length;
    stack.length = current.level - 1;
    stack[current.level - 1] = current.heading;
    sections.push({
      heading: current.heading,
      headingPath: stack.filter(Boolean).join(' / '),
      line: current.line,
      body: lines.slice(current.index + 1, end).join('\n').trim()
    });
  }
  return { title, hasTitle, sections };
}

function lineFor(content, offset) {
  return content.slice(0, offset).split(/\r?\n/).length;
}

function resolveLink(projectRoot, sourcePath, rawTarget) {
  if (!rawTarget || rawTarget.startsWith('#') || /^(?:https?:|mailto:|tel:|data:)/i.test(rawTarget)) return null;
  const [pathPart, anchor = ''] = rawTarget.replace(/^<|>$/g, '').split('#', 2);
  if (!pathPart) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathPart.split('?')[0]);
  } catch {
    decoded = pathPart.split('?')[0];
  }
  const specsRoot = runtimePaths(projectRoot).specsRoot;
  const sourceAbsolute = resolve(specsRoot, sourcePath);
  let absolute;
  if (decoded.startsWith('SPECS/')) absolute = resolve(specsRoot, decoded.slice('SPECS/'.length));
  else if (isAbsolute(decoded)) absolute = resolve(decoded);
  else absolute = resolve(dirname(sourceAbsolute), decoded);

  if (within(specsRoot, absolute)) {
    return { kind: 'specs', targetPath: normalized(relative(specsRoot, absolute)), anchor, exists: existsSync(absolute) };
  }
  if (within(resolve(projectRoot), absolute)) {
    return { kind: 'project', targetPath: normalized(relative(projectRoot, absolute)), anchor, exists: existsSync(absolute) };
  }
  return { kind: 'absolute-local', targetPath: absolute, anchor, exists: existsSync(absolute) };
}

function parseLinks(projectRoot, document) {
  if (!markdownExtensions.has(document.extension)) return [];
  const links = [];
  const markdownLink = /!?\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  for (const match of document.content.matchAll(markdownLink)) {
    const resolved = resolveLink(projectRoot, document.path, match[1]);
    if (!resolved) continue;
    links.push({ ...resolved, sourcePath: document.path, rawTarget: match[1], line: lineFor(document.content, match.index) });
  }
  const codeReference = /`((?:SPECS|src|app|tests?|public|config|docs)\/[A-Za-z0-9_.@/\-[\]]+(?::\d+)?)`/g;
  for (const match of document.content.matchAll(codeReference)) {
    const rawTarget = match[1].replace(/:\d+$/, '');
    if (links.some((link) => link.rawTarget === rawTarget && link.line === lineFor(document.content, match.index))) continue;
    const projectTarget = rawTarget.startsWith('SPECS/')
      ? resolveLink(projectRoot, document.path, rawTarget)
      : { kind: 'project', targetPath: rawTarget, anchor: '', exists: existsSync(resolve(projectRoot, rawTarget)) };
    if (!projectTarget) continue;
    links.push({ ...projectTarget, sourcePath: document.path, rawTarget, line: lineFor(document.content, match.index) });
  }
  return links;
}

function inventory(projectRoot) {
  const documents = listKnowledge(projectRoot).documents
    .map((entry) => readKnowledgeDocument(projectRoot, entry.path))
    .filter(Boolean)
    .map((document) => ({ ...document, contentHash: hash(document.content) }));
  const fingerprint = hash(JSON.stringify(documents.map((document) => [document.path, document.contentHash])));
  return { documents, fingerprint };
}

function currentFingerprint(database) {
  return database.prepare("SELECT value FROM runtime_meta WHERE key = 'palace_source_fingerprint'").get()?.value ?? '';
}

export function refreshPalaceIndex(projectRoot, options = {}) {
  const source = inventory(projectRoot);
  const database = openRuntimeDatabase(projectRoot);
  try {
    const indexedDocuments = database.prepare('SELECT COUNT(*) AS count FROM palace_documents').get().count;
    if (!options.force && currentFingerprint(database) === source.fingerprint && indexedDocuments === source.documents.length) {
      const latest = database.prepare("SELECT * FROM palace_index_runs WHERE status = 'completed' ORDER BY id DESC LIMIT 1").get();
      return {
        schema: 'ewai.palace-index/v1',
        status: 'current',
        runId: latest?.id ?? null,
        documents: indexedDocuments,
        sections: latest?.section_count ?? 0,
        links: latest?.link_count ?? 0,
        fingerprint: source.fingerprint
      };
    }

    const run = database.prepare(`
      INSERT INTO palace_index_runs (status, source_fingerprint)
      VALUES ('running', ?) RETURNING id
    `).get(source.fingerprint);
    let sectionCount = 0;
    let linkCount = 0;
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec('DELETE FROM palace_sections_fts; DELETE FROM palace_links; DELETE FROM palace_documents;');
      const insertDocument = database.prepare(`
        INSERT INTO palace_documents (
          path, title, extension, content_hash, content_length, source_mtime, has_title, section_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertSection = database.prepare(`
        INSERT INTO palace_sections_fts (path, title, heading, body, heading_path, line)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const insertLink = database.prepare(`
        INSERT INTO palace_links (
          source_path, target_path, target_anchor, kind, exists_on_disk, line, raw_target
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const document of source.documents) {
        const parsed = parseSections(document);
        const links = parseLinks(projectRoot, document);
        insertDocument.run(
          document.path, parsed.title, document.extension, document.contentHash,
          document.content.length, document.updatedAt, parsed.hasTitle ? 1 : 0, parsed.sections.length
        );
        for (const section of parsed.sections) {
          insertSection.run(document.path, parsed.title, section.heading, section.body, section.headingPath, section.line);
          sectionCount += 1;
        }
        for (const link of links) {
          insertLink.run(
            link.sourcePath, link.targetPath, link.anchor, link.kind,
            link.exists ? 1 : 0, link.line, link.rawTarget
          );
          linkCount += 1;
        }
      }
      database.prepare(`
        INSERT INTO runtime_meta (key, value, updated_at)
        VALUES ('palace_source_fingerprint', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(source.fingerprint);
      database.prepare(`
        UPDATE palace_index_runs SET
          status = 'completed', document_count = ?, section_count = ?, link_count = ?,
          completed_at = CURRENT_TIMESTAMP, summary = ?
        WHERE id = ?
      `).run(source.documents.length, sectionCount, linkCount, 'SPECS Mind Palace index refreshed.', run.id);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      database.prepare(`UPDATE palace_index_runs SET status = 'failed', completed_at = CURRENT_TIMESTAMP, summary = ? WHERE id = ?`)
        .run(error.message, run.id);
      throw error;
    }
    return {
      schema: 'ewai.palace-index/v1', status: 'completed', runId: run.id,
      documents: source.documents.length, sections: sectionCount, links: linkCount,
      fingerprint: source.fingerprint
    };
  } finally {
    database.close();
  }
}

export function palaceIndexStatus(projectRoot) {
  const source = inventory(projectRoot);
  const database = openRuntimeDatabase(projectRoot);
  try {
    const latest = database.prepare("SELECT * FROM palace_index_runs WHERE status = 'completed' ORDER BY id DESC LIMIT 1").get();
    const counts = database.prepare('SELECT COUNT(*) AS documents, COALESCE(SUM(section_count), 0) AS sections FROM palace_documents').get();
    if (!latest) return { schema: 'ewai.palace-index-status/v1', status: 'missing', documents: 0, sections: 0 };
    return {
      schema: 'ewai.palace-index-status/v1',
      status: currentFingerprint(database) === source.fingerprint ? 'fresh' : 'stale',
      runId: latest.id,
      documents: counts.documents,
      sections: counts.sections,
      indexedAt: latest.completed_at
    };
  } finally {
    database.close();
  }
}

function ftsQuery(query) {
  const terms = String(query).normalize('NFKC').match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' OR ');
}

export function searchPalace(projectRoot, query, options = {}) {
  const index = refreshPalaceIndex(projectRoot);
  const expression = ftsQuery(query);
  if (!expression) return { schema: 'ewai.palace-search/v1', query, index, results: [] };
  const requestedLimit = Number(options.limit ?? 50);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.floor(requestedLimit) : 50;
  const database = openRuntimeDatabase(projectRoot);
  try {
    const rows = database.prepare(`
      SELECT path, title, heading, heading_path, CAST(line AS INTEGER) AS line,
        snippet(palace_sections_fts, 3, '⟦', '⟧', ' … ', 24) AS snippet,
        bm25(palace_sections_fts, 4.0, 3.0, 2.0, 1.0) AS rank
      FROM palace_sections_fts
      WHERE palace_sections_fts MATCH ?
      ORDER BY rank, path, CAST(line AS INTEGER)
      LIMIT ?
    `).all(expression, limit * 3);
    const seen = new Set();
    const results = [];
    for (const row of rows) {
      if (seen.has(row.path)) continue;
      seen.add(row.path);
      results.push(row);
      if (results.length >= limit) break;
    }
    return { schema: 'ewai.palace-search/v1', query, index, results };
  } finally {
    database.close();
  }
}

function finding(code, severity, path, message, details = {}) {
  return { code, severity, path, message, details };
}

export function palaceTidiness(projectRoot) {
  const index = refreshPalaceIndex(projectRoot);
  const database = openRuntimeDatabase(projectRoot);
  try {
    const documents = database.prepare('SELECT * FROM palace_documents ORDER BY path').all();
    const findings = [];
    for (const document of documents) {
      if (document.content_length === 0) findings.push(finding('empty-document', 'warning', document.path, 'The document is empty.'));
      if (markdownExtensions.has(document.extension) && !document.has_title) {
        findings.push(finding('missing-title', 'warning', document.path, 'The Markdown document has no level-one title.'));
      }
    }
    for (const link of database.prepare(`SELECT * FROM palace_links WHERE exists_on_disk = 0 ORDER BY source_path, line`).all()) {
      findings.push(finding(
        'broken-internal-link', 'warning', link.source_path,
        `The reference ${link.raw_target} does not resolve on disk.`,
        { target: link.target_path, kind: link.kind, line: link.line }
      ));
    }
    for (const group of database.prepare(`
      SELECT content_hash, GROUP_CONCAT(path, '||') AS paths, COUNT(*) AS count
      FROM palace_documents WHERE content_length > 0
      GROUP BY content_hash HAVING COUNT(*) > 1
    `).all()) {
      const paths = group.paths.split('||');
      for (const path of paths) findings.push(finding('duplicate-content', 'notice', path, 'Another Palace document has identical content.', { matches: paths.filter((candidate) => candidate !== path) }));
    }
    const linked = new Set();
    for (const link of database.prepare("SELECT source_path, target_path FROM palace_links WHERE kind = 'specs' AND exists_on_disk = 1").all()) {
      linked.add(link.source_path);
      linked.add(link.target_path);
    }
    for (const document of documents) {
      if (!markdownExtensions.has(document.extension) || linked.has(document.path)) continue;
      if (/(?:^|\/)(?:README|_template)\.md$/i.test(document.path)) continue;
      findings.push(finding('orphaned-document', 'notice', document.path, 'No other indexed SPECS document links to or from this document.'));
    }

    const counts = { warning: 0, notice: 0 };
    for (const item of findings) counts[item.severity] = (counts[item.severity] ?? 0) + 1;
    return {
      schema: 'ewai.palace-tidiness/v1',
      status: counts.warning > 0 || counts.notice > 0 ? 'housekeeping-recommended' : 'tidy',
      documents: documents.length,
      sections: index.sections,
      links: index.links,
      counts,
      findings
    };
  } finally {
    database.close();
  }
}

export function palaceHousekeeping(projectRoot) {
  const tidiness = palaceTidiness(projectRoot);
  const grouped = new Map();
  for (const item of tidiness.findings) {
    if (!grouped.has(item.code)) grouped.set(item.code, []);
    grouped.get(item.code).push(item);
  }
  return {
    schema: 'ewai.palace-housekeeping/v1',
    status: tidiness.status,
    requiresApproval: true,
    changedFiles: 0,
    groups: [...grouped.entries()].map(([code, findings]) => ({ code, count: findings.length, findings })),
    guidance: tidiness.status === 'tidy'
      ? 'The Mind Palace is tidy. A no-op is the correct housekeeping result.'
      : 'Use $ewai-palace-housekeeping to review these findings with the user before changing canonical SPECS.',
    tidiness
  };
}
