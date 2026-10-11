import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { projectPaths } from '../paths.mjs';
import { fingerprintRepositoryFile } from '../repository-source-map.mjs';
import { openRuntimeDatabase } from './database.mjs';
import { resolveNamedTarget, resolveSpecifier, splitStoredPath } from './import-resolution.mjs';
import {
  churnCounts,
  coChangingFiles,
  diffNumstat,
  fileHistory,
  gitCommit,
  recentChangeSizes
} from './git-snapshot.mjs';

const callerKinds = new Set(['calls_service_method', 'uses_store', 'uses_component', 'handles_route']);

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function runtimeFile(projectRoot, name) {
  return resolve(projectPaths(projectRoot).runtimeRoot, 'runtime', name);
}

function latestRun(database) {
  return database.prepare("SELECT * FROM repo_index_runs WHERE status = 'completed' ORDER BY id DESC LIMIT 1").get() ?? null;
}

function parsedSummary(run) {
  if (!run?.summary) return {};
  try {
    return JSON.parse(run.summary);
  } catch {
    return {};
  }
}

function shortCommit(value) {
  const text = String(value ?? '');
  return text ? text.slice(0, 7) : '';
}

function trustFields(projectRoot, run) {
  const head = gitCommit(projectRoot);
  const indexedCommit = parsedSummary(run).commit || '';
  return {
    historyAvailable: Boolean(head),
    head,
    indexedCommit,
    indexBehind: Boolean(head && indexedCommit && head !== indexedCommit)
  };
}

function trustLine(reading) {
  if (!reading.historyAvailable) return 'History is not available for this project.';
  const indexed = shortCommit(reading.indexedCommit) || 'unrecorded';
  const head = shortCommit(reading.head) || 'unknown';
  return reading.indexBehind
    ? `Indexed commit ${indexed}. HEAD ${head} is ahead of the index.`
    : `Indexed commit ${indexed}. HEAD ${head} matches the index.`;
}

function decisionPoints(text) {
  return text.match(/\b(?:if|else|elif|for|while|switch|catch|match|unless)\b|&&|\|\||\?/g)?.length ?? 0;
}

function quartile(count, counts) {
  const values = [...counts.values()].sort((left, right) => left - right);
  if (!values.length) return 0;
  const rank = values.filter((value) => value <= count).length / values.length;
  if (rank > 0.75) return 4;
  if (rank > 0.5) return 3;
  if (rank > 0.25) return 2;
  return 1;
}

function nearbyTests(relativePath, files) {
  const stem = basename(relativePath, extname(relativePath));
  return files
    .map((file) => splitStoredPath(file.path).relative)
    .filter((path) => path !== relativePath && /(test|spec)/i.test(path) && (path.includes(stem) || dirname(path) === dirname(relativePath)))
    .slice(0, 8);
}

function walkMarkdown(directory, visit) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) walkMarkdown(path, visit);
    else if (entry.isFile() && entry.name.endsWith('.md')) visit(path);
  }
}

function namedByRecords(projectRoot, relativePath) {
  if (!relativePath) return [];
  const specsRoot = projectPaths(projectRoot).specsRoot;
  const found = [];
  walkMarkdown(specsRoot, (path) => {
    if (found.length >= 8) return;
    let text = '';
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      return;
    }
    if (!text.includes(relativePath)) return;
    const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(path);
    found.push({
      path: relative(projectRoot, path).replaceAll('\\', '/') || basename(path),
      title
    });
  });
  return found;
}

function locate(database, run, input) {
  const raw = String(input ?? '').trim().replaceAll('\\', '/');
  const files = database.prepare('SELECT path, fingerprint, language FROM repo_files WHERE run_id = ?').all(run.id);
  const exact = files.find((file) => file.path === raw || splitStoredPath(file.path).relative === raw);
  if (exact) return exact;
  const suffix = files.filter((file) => {
    const relativePath = splitStoredPath(file.path).relative;
    return relativePath.endsWith(`/${raw}`) || raw.endsWith(`/${relativePath}`);
  });
  return suffix.length === 1 ? suffix[0] : null;
}

function repoRoots(run) {
  try {
    return JSON.parse(run.repos_json || '{}');
  } catch {
    return {};
  }
}

function emptyReading(projectRoot, file, trust) {
  return {
    file,
    found: false,
    stale: false,
    ...trust,
    runId: null,
    importers: [],
    routes: [],
    coChanges: [],
    owner: 'unrecorded',
    namedBy: [],
    decisionPoints: 0,
    hotspot: false,
    callerBasis: 'no-index'
  };
}

export function sessionContext(projectRoot) {
  const database = openRuntimeDatabase(projectRoot);
  try {
    const run = latestRun(database);
    const trust = trustFields(projectRoot, run);
    const active = database.prepare("SELECT slug, title FROM work_items WHERE lane = 'active' ORDER BY updated_at DESC LIMIT 1").get() ?? null;
    return {
      schema: 'ewai.repository-session/v1',
      runId: run ? Number(run.id) : null,
      ...trust,
      activeIntent: active
    };
  } finally {
    database.close();
  }
}

export function formatSessionCard(session) {
  const lines = ['Repository context'];
  if (!session?.runId) lines.push('No completed repository index.');
  else if (!session.historyAvailable) lines.push(`Index run ${session.runId}. History is not available for this project.`);
  else {
    const indexed = shortCommit(session.indexedCommit) || 'unrecorded';
    const head = shortCommit(session.head) || 'unknown';
    lines.push(session.indexBehind
      ? `Index run ${session.runId}. Indexed commit ${indexed}. HEAD ${head} is ahead of the index.`
      : `Index run ${session.runId}. Indexed commit ${indexed}. HEAD ${head} matches the index.`);
  }
  if (session?.activeIntent) lines.push(`Active intent: ${session.activeIntent.slug} · ${session.activeIntent.title}`);
  return lines.join('\n');
}

export function fileContext(projectRoot, input) {
  const database = openRuntimeDatabase(projectRoot);
  try {
    const run = latestRun(database);
    const trust = trustFields(projectRoot, run);
    if (!run) return emptyReading(projectRoot, String(input ?? ''), trust);
    const file = locate(database, run, input);
    if (!file) return { ...emptyReading(projectRoot, String(input ?? ''), trust), runId: Number(run.id), callerBasis: 'file-not-indexed' };
    const stored = file.path;
    const relativePath = splitStoredPath(stored).relative;
    const roots = repoRoots(run);
    const repo = splitStoredPath(stored).repo;
    const knownPaths = new Set(database.prepare('SELECT path FROM repo_files WHERE run_id = ?').all(run.id).map((row) => row.path));
    const symbols = database.prepare('SELECT symbol_name, path FROM repo_symbols WHERE run_id = ?').all(run.id);
    const imports = database.prepare('SELECT path, source_module, line FROM repo_imports WHERE run_id = ?').all(run.id);
    const relationships = database.prepare('SELECT source_path, relationship_kind, target_kind, target_name, metadata_json FROM repo_relationships WHERE run_id = ?').all(run.id);
    const importers = [];
    for (const item of imports) {
      if (item.path === stored) continue;
      const resolved = resolveSpecifier({
        importer: item.path,
        sourceModule: item.source_module,
        knownPaths,
        repoRoot: roots[splitStoredPath(item.path).repo] ?? '',
        repoName: splitStoredPath(item.path).repo
      });
      if (resolved.storedPath === stored) {
        importers.push({ file: splitStoredPath(item.path).relative, basis: resolved.basis, line: item.line ?? null });
      }
    }
    const routes = [];
    for (const item of relationships) {
      if (item.relationship_kind === 'handles_route' && item.source_path === stored) {
        const metadata = readJsonText(item.metadata_json);
        routes.push({ verb: metadata.verb || 'ANY', uri: metadata.uri || item.target_name });
      }
      if (!callerKinds.has(item.relationship_kind) || item.source_path === stored || item.target_kind === 'route') continue;
      const resolved = resolveNamedTarget({
        sourcePath: item.source_path,
        targetName: item.target_name,
        targetKind: item.target_kind,
        knownPaths,
        symbols,
        repoRoots: roots
      });
      if (resolved.storedPath === stored) {
        importers.push({ file: splitStoredPath(item.source_path).relative, basis: resolved.basis, line: null, kind: item.relationship_kind });
      }
    }
    const absolute = roots[repo] ? resolve(roots[repo], relativePath) : '';
    let text = '';
    let stale = false;
    if (absolute && existsSync(absolute)) {
      try {
        text = readFileSync(absolute, 'utf8');
        const live = fingerprintRepositoryFile(absolute, statSync(absolute)).value;
        stale = Boolean(file.fingerprint) && live !== file.fingerprint;
      } catch {
        text = '';
      }
    }
    const historyRoot = roots[repo] || projectRoot;
    const history = fileHistory(historyRoot, relativePath);
    const authors = Object.entries(history.blameAuthors ?? {}).sort((left, right) => right[1] - left[1]);
    const top = authors[0];
    const share = history.blameLines && top ? top[1] / history.blameLines : 0;
    const owner = !history.available ? 'unrecorded' : share > 0.8 ? top[0] : 'shared';
    const points = decisionPoints(text);
    const counts = history.available ? churnCounts(historyRoot) : new Map();
    const churn = history.available ? quartile(counts.get(relativePath) ?? 0, counts) : 0;
    return {
      file: relativePath,
      found: true,
      stale,
      ...trust,
      runId: Number(run.id),
      importers,
      routes,
      coChanges: history.available ? coChangingFiles(roots[repo] || projectRoot, relativePath) : [],
      owner,
      namedBy: [...namedByRecords(projectRoot, relativePath), ...standardNames(database, relativePath)],
      decisionPoints: points,
      hotspot: churn >= 4 && points >= 12,
      callerBasis: importers.length ? importers[0].basis : 'no-resolved-edge'
    };
  } finally {
    database.close();
  }
}

function readJsonText(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function standardNames(database, relativePath) {
  const needle = `%${relativePath.toLowerCase()}%`;
  return database.prepare(`
    SELECT standard_id, source_path FROM standards_applicability
    WHERE lower(target_path) LIKE ? LIMIT 8
  `).all(needle).map((row) => ({ path: row.source_path, title: row.standard_id }));
}

export function formatFileCard(reading) {
  if (!reading) return '';
  if (!reading.found) {
    return [`Repository context · ${reading.file || 'unknown file'}`, 'This file is not in the completed index.'].join('\n');
  }
  if (reading.stale) {
    return [
      `Repository context · ${reading.file}`,
      trustLine(reading),
      'This file differs from the index. The reading stops here.'
    ].join('\n');
  }
  const callers = reading.importers.length
    ? `Callers: ${reading.importers.slice(0, 4).map((item) => `${item.file} (${item.basis})`).join(', ')}`
    : 'No resolved caller in the index. An empty list is not proof that nothing calls this.';
  const routes = reading.routes.length
    ? `Routes: ${reading.routes.slice(0, 3).map((route) => `${route.verb} ${route.uri}`).join(', ')}`
    : 'Routes: none recorded on this file.';
  const history = reading.historyAvailable
    ? `Owner: ${reading.owner}. Co-changes: ${reading.coChanges.map((item) => item.path).join(', ') || 'none recorded'}.`
    : 'Ownership and co-change need a git history, which is not available.';
  const names = reading.namedBy.length
    ? `Named by ${reading.namedBy.slice(0, 3).map((item) => item.title).join('; ')}.`
    : 'Named by no project record in this reading.';
  const density = reading.hotspot
    ? `Hotspot: high churn and dense decision points (${reading.decisionPoints}). This density is a hint, not cyclomatic complexity.`
    : `Decision points: ${reading.decisionPoints}. This density is a hint, not cyclomatic complexity.`;
  return [
    `Repository context · ${reading.file}`,
    trustLine(reading),
    callers,
    routes,
    history,
    names,
    density
  ].join('\n');
}

function bandFor(rank) {
  if (rank >= 8) return 'steady';
  if (rank >= 6) return 'watch';
  if (rank >= 4) return 'review';
  return 'maintenance';
}

function reviewFocus(band) {
  if (band === 'steady') return 'Recent history does not single this file out.';
  if (band === 'watch') return 'Worth a look before a large edit.';
  if (band === 'review') return 'Review this file before the next change.';
  return 'Choose this file when planning maintenance.';
}

export function healthPacket(projectRoot, input) {
  const reading = fileContext(projectRoot, input);
  const database = openRuntimeDatabase(projectRoot);
  let tests = [];
  try {
    const run = latestRun(database);
    if (run && reading.found) {
      const files = database.prepare('SELECT path FROM repo_files WHERE run_id = ?').all(run.id);
      tests = nearbyTests(reading.file, files);
    }
  } finally {
    database.close();
  }
  let rank = 9;
  if (reading.hotspot) rank -= 2;
  else if (reading.decisionPoints > 40) rank -= 2;
  else if (reading.decisionPoints > 15) rank -= 1;
  if (reading.owner !== 'shared' && reading.owner !== 'unrecorded') rank -= 1;
  if (!tests.length) rank -= 1;
  else rank += 1;
  rank = Math.max(1, Math.min(10, rank));
  const band = bandFor(rank);
  return {
    schema: 'ewai.repository-health/v1',
    file: reading.file,
    found: reading.found,
    rank,
    band,
    markers: [
      reading.hotspot ? 'hotspot' : '',
      reading.owner !== 'shared' && reading.owner !== 'unrecorded' ? 'concentrated-authorship' : '',
      tests.length ? 'nearby-tests' : 'no-nearby-test'
    ].filter(Boolean),
    reviewFocus: reviewFocus(band),
    coChangingFiles: reading.coChanges,
    tests,
    decisionPoints: reading.decisionPoints,
    decisionPointNote: 'Decision-point density is a keyword hint, not cyclomatic complexity.',
    createsIntent: false,
    note: 'This packet does not create an intent. Creating an intent stays on the existing approved route after a person accepts it.'
  };
}

export function fileCitations(projectRoot, input) {
  const database = openRuntimeDatabase(projectRoot);
  try {
    const run = latestRun(database);
    const located = run ? locate(database, run, input) : null;
    const relativePath = located ? splitStoredPath(located.path).relative : String(input ?? '').replaceAll('\\', '/');
    const namedBy = [
      ...namedByRecords(projectRoot, relativePath),
      ...(run ? standardNames(database, relativePath) : [])
    ];
    const unique = [];
    const seen = new Set();
    for (const item of namedBy) {
      const key = `${item.path}:${item.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({ path: item.path, title: item.title });
    }
    return { schema: 'ewai.repository-citations/v1', file: relativePath, namedBy: unique };
  } finally {
    database.close();
  }
}

function looksLikeTest(path) {
  return /(test|spec)/i.test(path);
}

function sourceTouched(path) {
  return !looksLikeTest(path) && /\.(php|js|mjs|cjs|jsx|ts|tsx|vue|py|go|rb|java|kt|cs)$/.test(path);
}

export function changeRisk(projectRoot) {
  const working = diffNumstat(projectRoot, 'HEAD');
  const lastCommit = working.length ? [] : diffNumstat(projectRoot, 'HEAD~1');
  const usingLastCommit = !working.length && lastCommit.length > 0;
  const diff = working.length ? working : lastCommit;
  const lines = diff.reduce((total, entry) => total + entry.added + entry.removed, 0);
  const samples = recentChangeSizes(projectRoot);
  const percentile = samples.length ? Math.round((samples.filter((size) => size <= lines).length / samples.length) * 100) : null;
  const directives = [];
  if (diff.length) {
    const changed = new Set(diff.map((entry) => entry.path));
    const missingPartners = [];
    for (const entry of diff) {
      if (!sourceTouched(entry.path)) continue;
      for (const partner of coChangingFiles(projectRoot, entry.path, 3)) {
        if (!changed.has(partner.path)) missingPartners.push(partner.path);
      }
    }
    const uniquePartners = [...new Set(missingPartners)].slice(0, 5);
    if (uniquePartners.length) directives.push(`Files that usually change with this diff are absent: ${uniquePartners.join(', ')}.`);
    if (diff.some((entry) => sourceTouched(entry.path)) && !diff.some((entry) => looksLikeTest(entry.path))) {
      directives.push('No test file is in this diff.');
    }
    const database = openRuntimeDatabase(projectRoot);
    try {
      const run = latestRun(database);
      if (run) {
        const routes = database.prepare("SELECT source_path FROM repo_relationships WHERE run_id = ? AND relationship_kind = 'handles_route'").all(run.id)
          .map((row) => splitStoredPath(row.source_path).relative);
        const imported = new Set(database.prepare('SELECT source_module, path FROM repo_imports WHERE run_id = ?').all(run.id).map((row) => splitStoredPath(row.path).relative));
        if (diff.some((entry) => routes.includes(entry.path) || imported.has(entry.path))) {
          directives.push('This diff touches a recorded route or a file other indexed files import.');
        }
        const cited = diff.filter((entry) => namedByRecords(projectRoot, entry.path).length);
        if (cited.length) directives.push('A project record names a file in this diff. A citation does not change that record.');
      }
    } finally {
      database.close();
    }
  }
  const silent = !diff.length || (directives.length === 0 && (percentile == null || percentile < 60));
  return {
    schema: 'ewai.repository-change-risk/v1',
    silent,
    percentile,
    lines,
    basis: usingLastCommit ? 'last-commit' : diff.length ? 'working-tree' : 'none',
    files: diff.map((entry) => entry.path),
    directives,
    note: 'This rank orders the change against this repository’s recent commits. It is not a probability.'
  };
}

export function formatChangeRisk(risk) {
  if (!risk || risk.silent) return '';
  const lines = [];
  if (risk.percentile != null) lines.push(`This diff is at the ${risk.percentile}th percentile of recent commits in this repository. That rank is not a probability.`);
  lines.push(...risk.directives);
  lines.push(risk.note);
  return lines.join('\n');
}

const adoptionKeys = ['fileCards', 'sessionCards', 'suppressedRepeats', 'indexSearch', 'indexGraph', 'distillRuns'];

export function readAdoption(projectRoot) {
  const stored = readJson(runtimeFile(projectRoot, 'context-adoption.json')) ?? {};
  return {
    schema: 'ewai.repository-adoption/v1',
    ...Object.fromEntries(adoptionKeys.map((key) => [key, Number(stored[key] ?? 0)]))
  };
}

export function recordAdoption(projectRoot, key) {
  if (!adoptionKeys.includes(key)) return readAdoption(projectRoot);
  try {
    const current = readAdoption(projectRoot);
    current[key] += 1;
    const { schema: _schema, ...counts } = current;
    writeJson(runtimeFile(projectRoot, 'context-adoption.json'), counts);
    return { ...current, [key]: counts[key] };
  } catch {
    return readAdoption(projectRoot);
  }
}

function cardBucket() {
  return process.env.EWAI_SESSION_ID || process.env.CLAUDE_SESSION_ID || String(Math.floor(Date.now() / (15 * 60 * 1000)));
}

export function claimCard(projectRoot, key) {
  const path = runtimeFile(projectRoot, 'context-cards.json');
  const bucket = cardBucket();
  const current = readJson(path) ?? { bucket: '', keys: {} };
  const keys = current.bucket === bucket ? { ...current.keys } : {};
  if (keys[key]) return false;
  keys[key] = Date.now();
  writeJson(path, { bucket, keys });
  return true;
}

export function repositoryOverview(projectRoot, file = '') {
  const session = sessionContext(projectRoot);
  const risk = changeRisk(projectRoot);
  const reading = file ? fileContext(projectRoot, file) : null;
  return {
    schema: 'ewai.repository-context/v1',
    session,
    changeRisk: risk,
    adoption: readAdoption(projectRoot),
    file: reading ? {
      card: formatFileCard(reading),
      health: healthPacket(projectRoot, file),
      citations: fileCitations(projectRoot, file)
    } : null,
    guidance: {
      advisory: true,
      humanReviewRequired: true,
      personasAdvise: true,
      healthDoesNotCreateIntent: true
    }
  };
}

