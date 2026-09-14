import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { loadProjectConfig } from '../project.mjs';
import { projectPaths } from '../paths.mjs';
import {
  analyseRepositoryFile,
  fingerprintRepositoryBuffer,
  fingerprintRepositoryFile,
  resolveSourceMapProfiles,
  selectSourceMapProfile,
  sourceMapProfileFileLimit
} from '../repository-source-map.mjs';
import { openRuntimeDatabase } from './database.mjs';
import { syncWorkItems } from './work.mjs';

// Tree-sitter extractTreeSitterFacts execution is delegated through analyseRepositoryFile.

const skippedDirectories = new Set([
  '.git', '.nuxt', '.output', '.ewai-pipeline', '.phpunit.cache', '.vite',
  'build', 'coverage', 'dist', 'node_modules', 'storage', 'vendor'
]);
const canonicalSpecsDirectories = Object.freeze([
  '1.Scope', '2.Purpose', '3.Evidence', '4.Constraints', '5.Strategy', '6.Build'
]);

function walk(root, files = [], excludedRoots = []) {
  if (!existsSync(root)) return files;
  if (excludedRoots.includes(resolve(root))) return files;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) walk(path, files, excludedRoots);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      files.push({ path, stat: statSync(path) });
    } catch {
      files.push({ path, stat: null, statError: true });
    }
  }
  return files;
}

function repositoryExclusions(repositoryRoot, specsRoot) {
  const relation = relative(repositoryRoot, specsRoot);
  if (relation.startsWith('..')) return [];
  if (relation) return [resolve(specsRoot)];
  return canonicalSpecsDirectories.map((directory) => resolve(specsRoot, directory));
}

function repositories(projectRoot) {
  const { config, paths } = loadProjectConfig(projectRoot);
  return (config.repositories ?? []).map((repository, index) => {
    const root = resolve(paths.projectRoot, repository.path || '.');
    return {
      name: repository.name || `repository-${index + 1}`,
      role: repository.role || 'application',
      root,
      excludedRoots: repositoryExclusions(root, paths.specsRoot)
    };
  });
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value).flatMap(asArray);
  return [];
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function planStandardsEvidence(plan) {
  if (Array.isArray(plan?.standards_evidence)) return plan.standards_evidence;
  return asArray(plan?.standards).map((standard) => ({
    ...standard,
    source_path: standard.source_path ?? standard.path ?? '',
    rule_summary: standard.rule_summary ?? standard.application ?? '',
  }));
}

function capabilityFingerprint(projectRoot, item) {
  const buildRoot = projectPaths(projectRoot).buildRoot;
  const plan = readJson(resolve(buildRoot, item.slug, 'gates/plan/plan-contract.json'))
    ?? readJson(resolve(buildRoot, item.slug, 'plan-contract.json'));
  const endpoints = asArray(plan?.backend_endpoints);
  const chains = asArray(plan?.store_service_chains);
  const components = asArray(plan?.component_contracts);
  const standards = planStandardsEvidence(plan);
  const tests = asArray(plan?.test_obligations);
  const verticalSlices = asArray(plan?.vertical_slices);
  const surfaces = [];
  if (endpoints.length) surfaces.push('api');
  if (chains.length) surfaces.push('state-management');
  if (components.length) surfaces.push('components');
  if (verticalSlices.length) surfaces.push('vertical-slices');
  if (tests.length) surfaces.push('tests');
  return {
    slug: item.slug,
    title: item.title,
    domain: item.domain,
    status: item.state,
    surfaces,
    routeShapes: [...new Set(endpoints.map((entry) => entry.route_class).filter(Boolean))],
    components: [...new Set(components.map((entry) => entry.component ?? entry.name).filter(Boolean))],
    standards: [...new Set(standards.map((entry) => entry.id ?? entry.standard_id ?? entry.source_path).filter(Boolean))],
    standardsEvidence: standards,
    metadata: {
      endpointCount: endpoints.length,
      storeChainCount: chains.length,
      componentCount: components.length,
      testObligationCount: tests.length,
      planContractPresent: Boolean(plan)
    }
  };
}

function updateCapabilityProjections(database, projectRoot, runId) {
  database.exec('DELETE FROM capability_fingerprints; DELETE FROM standards_applicability;');
  const insertFingerprint = database.prepare(`
    INSERT INTO capability_fingerprints (
      slug, title, domain, status, surfaces_json, route_shapes_json,
      components_json, standards_json, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertStandard = database.prepare(`
    INSERT INTO standards_applicability (
      run_id, target_kind, target_path, standard_id, source_path,
      rule_summary, confidence, required, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const items = database.prepare('SELECT * FROM work_items ORDER BY slug').all();
  for (const item of items) {
    const fingerprint = capabilityFingerprint(projectRoot, item);
    insertFingerprint.run(
      fingerprint.slug,
      fingerprint.title,
      fingerprint.domain,
      fingerprint.status,
      JSON.stringify(fingerprint.surfaces),
      JSON.stringify(fingerprint.routeShapes),
      JSON.stringify(fingerprint.components),
      JSON.stringify(fingerprint.standards),
      JSON.stringify(fingerprint.metadata)
    );
    for (const standard of fingerprint.standardsEvidence) {
      const id = standard.id ?? standard.standard_id ?? standard.source_path;
      if (!id) continue;
      const targets = asArray(standard.targets ?? standard.target_paths ?? [item.slug]);
      for (const target of targets.length ? targets : [item.slug]) {
        insertStandard.run(
          runId,
          'delivery-plan',
          typeof target === 'string' ? target : target.path ?? item.slug,
          id,
          standard.source_path ?? standard.sourcePath ?? '',
          standard.rule_summary ?? standard.ruleSummary ?? '',
          Number(standard.confidence ?? 1),
          standard.required === false ? 0 : 1,
          JSON.stringify({ slug: item.slug })
        );
      }
    }
  }
  return { capabilities: items.length };
}

function insertFacts(database, runId, repository, path, facts) {
  const storedPath = `${repository.name}:${relative(repository.root, path).replaceAll('\\', '/')}`;
  database.prepare(`
    INSERT INTO repo_files (
      run_id, repo, path, language, parser, parser_status, content_hash,
      size_bytes, line_count, parse_error_count, classification, profile_id,
      analyser, analysis_depth, analysis_outcome, fingerprint_kind, fingerprint,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId, repository.name, storedPath, facts.file.language, facts.file.parser,
    facts.file.parserStatus, facts.file.fingerprint, facts.file.sizeBytes, facts.file.lineCount,
    facts.file.parseErrorCount, facts.file.classification, facts.file.profileId,
    facts.file.analyser, facts.file.analysisDepth, facts.file.analysisOutcome,
    facts.file.fingerprintKind, facts.file.fingerprint, JSON.stringify(facts.file.metadata ?? {})
  );
  const symbol = database.prepare(`
    INSERT INTO repo_symbols (
      run_id, repo, symbol_kind, symbol_name, path, line, signature,
      tags_json, metadata_json, content_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const item of facts.symbols) {
    symbol.run(
      runId, repository.name, item.kind, item.name, storedPath, item.line ?? null,
      item.signature ?? '', JSON.stringify(item.tags ?? []),
      JSON.stringify(item.metadata ?? {}), facts.file.fingerprint
    );
  }
  const span = database.prepare(`
    INSERT INTO repo_spans (
      run_id, repo, path, symbol_kind, symbol_name, start_line, end_line,
      start_byte, end_byte, evidence_snippet, parser, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const item of facts.spans) {
    span.run(
      runId, repository.name, storedPath, item.symbolKind, item.symbolName,
      item.startLine, item.endLine, item.startByte ?? 0, item.endByte ?? 0,
      item.evidenceSnippet ?? '', item.parser ?? '', JSON.stringify(item.metadata ?? {})
    );
  }
  const imported = database.prepare(`
    INSERT INTO repo_imports (
      run_id, repo, path, source_module, imported_name, local_name,
      import_kind, line, parser, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const item of facts.imports) {
    imported.run(
      runId, repository.name, storedPath, item.sourceModule ?? '', item.importedName ?? '',
      item.localName ?? '', item.importKind ?? '', item.line ?? null, item.parser ?? '',
      JSON.stringify(item.metadata ?? {})
    );
  }
  const relationship = database.prepare(`
    INSERT INTO repo_relationships (
      run_id, source_kind, source_name, source_path, relationship_kind,
      target_kind, target_name, target_path, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const item of facts.relationships) {
    relationship.run(
      runId, item.source_kind, item.source_name, storedPath, item.relationship_kind,
      item.target_kind, item.target_name, item.target_path ?? '',
      JSON.stringify(item.metadata ?? {})
    );
  }
}

function registerProfiles(database, runId, profiles) {
  const insert = database.prepare(`
    INSERT INTO repo_index_profiles (
      run_id, profile_id, source_kind, source_ref, classification,
      analyser, analysis_depth, priority, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const profile of profiles) {
    insert.run(
      runId, profile.id, profile.sourceKind, profile.sourceRef,
      profile.classification, profile.analyser, profile.analysisDepth, profile.priority,
      JSON.stringify({
        ...(profile.sourceVersion ? { source_version: profile.sourceVersion } : {}),
        patterns: [...(profile.patterns ?? [])],
        repositories: [...(profile.repositories ?? [])],
        max_bytes: profile.maxBytes
      })
    );
  }
}

function incrementOutcome(outcomes, outcome) {
  outcomes[outcome] = Number(outcomes[outcome] ?? 0) + 1;
}

export function refreshRepositoryIndex(projectRoot) {
  const started = Date.now();
  const repos = repositories(projectRoot);
  const profileResolution = resolveSourceMapProfiles(projectRoot);
  const database = openRuntimeDatabase(projectRoot);
  syncWorkItems(projectRoot, database);
  const profileDigest = profileResolution.digest;
  const run = database.prepare(`
    INSERT INTO repo_index_runs (status, repos_json, profile_digest, profile_summary_json)
    VALUES ('running', ?, ?, ?) RETURNING id
  `).get(
    JSON.stringify(Object.fromEntries(repos.map((repo) => [repo.name, repo.root]))),
    profileDigest,
    JSON.stringify(profileResolution.profiles.map(({ id, classification, analyser, analysisDepth, sourceKind, sourceRef, sourceVersion }) => ({
      id, classification, analyser, analysisDepth, sourceKind, sourceRef, sourceVersion
    })))
  );
  const summary = {
    repositories: repos.length,
    files: 0,
    parsed: 0,
    failed: 0,
    symbols: 0,
    outcomes: {
      analysed: 0,
      inventory_only: 0,
      skipped_sensitive: 0,
      skipped_oversized: 0,
      analysis_failed: 0
    }
  };
  try {
    database.exec('BEGIN IMMEDIATE;');
    registerProfiles(database, run.id, profileResolution.profiles);
    for (const repository of repos) {
      for (const entry of walk(repository.root, [], repository.excludedRoots)) {
        const { path, stat } = entry;
        const relativePath = relative(repository.root, path).replaceAll('\\', '/');
        const selectedProfile = selectSourceMapProfile(relativePath, {
          profiles: profileResolution.profiles,
          repository
        });
        const fileLimit = sourceMapProfileFileLimit(selectedProfile);
        let buffer = null;
        let readError = Boolean(entry.statError);
        if (!readError && selectedProfile.id !== 'core-sensitive' && Number(stat?.size ?? 0) <= fileLimit) {
          try {
            buffer = readFileSync(path);
          } catch {
            readError = true;
          }
        }
        const fingerprint = buffer
          ? fingerprintRepositoryBuffer(buffer)
          : fingerprintRepositoryFile(path, stat, selectedProfile);
        const facts = analyseRepositoryFile(path, {
          stat,
          buffer,
          readError,
          fingerprint,
          profile: selectedProfile,
          repo: repository.name,
          repoRelative: () => relativePath
        });
        insertFacts(database, run.id, repository, path, facts);
        summary.files += 1;
        summary.symbols += facts.symbols.length;
        incrementOutcome(summary.outcomes, facts.file.analysisOutcome);
        if (facts.file.parserStatus === 'parsed') summary.parsed += 1;
        if (facts.file.analysisOutcome === 'analysis_failed') summary.failed += 1;
      }
    }
    Object.assign(summary, updateCapabilityProjections(database, projectRoot, run.id));
    database.prepare(`
      UPDATE repo_index_runs SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
        duration_ms = ?, summary = ?, outcome_totals_json = ? WHERE id = ?
    `).run(Date.now() - started, JSON.stringify(summary), JSON.stringify(summary.outcomes), run.id);
    database.exec('COMMIT;');
    return {
      schema: 'ewai.repository-index/v1',
      runId: run.id,
      status: 'completed',
      profileDigest,
      ...summary,
      durationMs: Date.now() - started
    };
  } catch (error) {
    database.exec('ROLLBACK;');
    database.prepare(`UPDATE repo_index_runs SET status = 'failed', completed_at = CURRENT_TIMESTAMP, summary = ? WHERE id = ?`)
      .run(error.message, run.id);
    throw error;
  } finally {
    database.close();
  }
}

export function repositoryIndexFreshness(projectRoot) {
  const repos = repositories(projectRoot);
  const profileResolution = resolveSourceMapProfiles(projectRoot);
  const database = openRuntimeDatabase(projectRoot);
  try {
    const run = database.prepare("SELECT * FROM repo_index_runs WHERE status = 'completed' ORDER BY id DESC LIMIT 1").get();
    if (!run) return { schema: 'ewai.repository-freshness/v1', status: 'stale', stale: true, reason: 'no-completed-index-run' };
    if (run.profile_digest !== profileResolution.digest) {
      return {
        schema: 'ewai.repository-freshness/v1',
        status: 'stale',
        stale: true,
        runId: run.id,
        reason: 'profile-catalogue-changed'
      };
    }
    const indexed = new Map(database.prepare('SELECT path, fingerprint FROM repo_files WHERE run_id = ?').all(run.id)
      .map((row) => [row.path, row.fingerprint]));
    const current = new Map();
    for (const repository of repos) {
      for (const entry of walk(repository.root, [], repository.excludedRoots)) {
        const { path, stat } = entry;
        const relativePath = relative(repository.root, path).replaceAll('\\', '/');
        const stored = `${repository.name}:${relativePath}`;
        const selectedProfile = selectSourceMapProfile(relativePath, {
          profiles: profileResolution.profiles,
          repository
        });
        current.set(stored, fingerprintRepositoryFile(path, stat, selectedProfile).value);
      }
    }
    const missing = [...current.keys()].filter((path) => !indexed.has(path));
    const changed = [...current].filter(([path, value]) => indexed.has(path) && indexed.get(path) !== value).map(([path]) => path);
    const deleted = [...indexed.keys()].filter((path) => !current.has(path));
    const stale = Boolean(missing.length || changed.length || deleted.length);
    return {
      schema: 'ewai.repository-freshness/v1',
      status: stale ? 'stale' : 'fresh',
      stale,
      runId: run.id,
      summary: { tracked: indexed.size, current: current.size, missing: missing.length, changed: changed.length, deleted: deleted.length },
      samples: { missing: missing.slice(0, 20), changed: changed.slice(0, 20), deleted: deleted.slice(0, 20) }
    };
  } finally {
    database.close();
  }
}

function parsedFingerprint(row) {
  if (!row) return null;
  return {
    slug: row.slug,
    title: row.title,
    domain: row.domain,
    status: row.status,
    surfaces: JSON.parse(row.surfaces_json || '[]'),
    routeShapes: JSON.parse(row.route_shapes_json || '[]'),
    components: JSON.parse(row.components_json || '[]'),
    standards: JSON.parse(row.standards_json || '[]'),
    metadata: JSON.parse(row.metadata_json || '{}')
  };
}

function similarity(left, right) {
  const weighted = [['surfaces', 3], ['routeShapes', 4], ['components', 2], ['standards', 1]];
  let score = left.domain && left.domain === right.domain ? 1 : 0;
  let maximum = 1;
  for (const [key, weight] of weighted) {
    const a = new Set(left[key] ?? []);
    const b = new Set(right[key] ?? []);
    const union = new Set([...a, ...b]);
    if (!union.size) continue;
    score += ([...a].filter((value) => b.has(value)).length / union.size) * weight;
    maximum += weight;
  }
  return maximum ? score / maximum : 0;
}

export function similarRepositoryCapabilities(projectRoot, slug, options = {}) {
  const database = openRuntimeDatabase(projectRoot);
  try {
    const target = parsedFingerprint(database.prepare('SELECT * FROM capability_fingerprints WHERE slug = ?').get(slug));
    if (!target) return { schema: 'ewai.similar-capabilities/v1', slug, target: null, matches: [] };
    const matches = database.prepare('SELECT * FROM capability_fingerprints WHERE slug <> ?').all(slug)
      .map(parsedFingerprint)
      .map((candidate) => ({ ...candidate, similarity: Number(similarity(target, candidate).toFixed(3)) }))
      .filter((candidate) => candidate.similarity > 0)
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, Number(options.limit ?? 12));
    return { schema: 'ewai.similar-capabilities/v1', slug, target, matches };
  } finally {
    database.close();
  }
}

export function repositoryStandards(projectRoot, target) {
  const database = openRuntimeDatabase(projectRoot);
  try {
    const needle = `%${String(target).toLowerCase()}%`;
    const standards = database.prepare(`
      SELECT * FROM standards_applicability
      WHERE lower(target_path) LIKE ? OR lower(target_kind) LIKE ?
      ORDER BY required DESC, confidence DESC, standard_id LIMIT 100
    `).all(needle, needle).map((row) => ({
      standardId: row.standard_id,
      sourcePath: row.source_path,
      targetKind: row.target_kind,
      targetPath: row.target_path,
      ruleSummary: row.rule_summary,
      confidence: row.confidence,
      required: Boolean(row.required)
    }));
    return { schema: 'ewai.repository-standards/v1', target, standards };
  } finally {
    database.close();
  }
}

export function repositoryTruth(projectRoot, slug, options = {}) {
  const database = openRuntimeDatabase(projectRoot);
  let item;
  try {
    syncWorkItems(projectRoot, database);
    item = database.prepare('SELECT slug, title, domain, state, current_phase FROM work_items WHERE slug = ?').get(slug) ?? null;
  } finally {
    database.close();
  }
  const terms = [...new Set(`${slug} ${item?.title ?? ''} ${item?.domain ?? ''}`
    .toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 3))];
  const searches = terms.map((term) => searchRepositoryIndex(projectRoot, term, options));
  const symbols = [...new Map(searches.flatMap((search) => search.symbols)
    .map((symbol) => [`${symbol.path}:${symbol.line}:${symbol.symbol_name}`, symbol])).values()];
  const files = [...new Map(searches.flatMap((search) => search.files)
    .map((file) => [file.path, file])).values()];
  return {
    schema: 'ewai.repository-truth/v1',
    slug,
    item,
    symbols,
    files,
    similarCapabilities: similarRepositoryCapabilities(projectRoot, slug, options).matches,
    standards: repositoryStandards(projectRoot, slug).standards
  };
}

export function repositoryStandardsCoverage(projectRoot, slug) {
  const deliveryRoot = resolve(projectPaths(projectRoot).buildRoot, slug);
  const planPath = resolve(deliveryRoot, 'gates/plan/plan-contract.json');
  const legacyPlanPath = resolve(deliveryRoot, 'plan-contract.json');
  const claimsPath = resolve(deliveryRoot, 'gates/plan/claim-ledger.json');
  const resolvedPlanPath = existsSync(planPath) ? planPath : legacyPlanPath;
  const plan = readJson(resolvedPlanPath);
  const claims = readJson(claimsPath);
  const freshness = repositoryIndexFreshness(projectRoot);
  const findings = [];
  if (!plan) findings.push({ severity: 'high', id: 'missing-plan-contract', path: resolvedPlanPath });
  if (!claims) findings.push({ severity: 'medium', id: 'missing-claim-ledger', path: claimsPath });
  if (freshness.stale) findings.push({ severity: 'high', id: 'stale-repository-index', details: freshness.summary ?? freshness.reason });
  const evidence = planStandardsEvidence(plan);
  if (plan && !evidence.length) findings.push({ severity: 'high', id: 'missing-standards-evidence', path: resolvedPlanPath });
  return {
    schema: 'ewai.standards-coverage/v1',
    slug,
    status: findings.some((finding) => finding.severity === 'high') ? 'blocked' : 'pass',
    planPath: resolvedPlanPath,
    claimsPath,
    standardsEvidence: evidence,
    freshness,
    findings
  };
}

export function repositoryIndexStatus(projectRoot) {
  const database = openRuntimeDatabase(projectRoot);
  try {
    const run = database.prepare('SELECT * FROM repo_index_runs ORDER BY id DESC LIMIT 1').get();
    if (!run) return { schema: 'ewai.repository-index-status/v1', status: 'missing', run: null };
    const counts = database.prepare(`
      SELECT COUNT(*) AS files,
        SUM(CASE WHEN parser_status = 'parsed' THEN 1 ELSE 0 END) AS parsed,
        SUM(CASE WHEN analysis_outcome = 'analysis_failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN analysis_outcome = 'analysed' THEN 1 ELSE 0 END) AS analysed,
        SUM(CASE WHEN analysis_outcome = 'inventory_only' THEN 1 ELSE 0 END) AS inventory_only,
        SUM(CASE WHEN analysis_outcome = 'skipped_sensitive' THEN 1 ELSE 0 END) AS skipped_sensitive,
        SUM(CASE WHEN analysis_outcome = 'skipped_oversized' THEN 1 ELSE 0 END) AS skipped_oversized
      FROM repo_files WHERE run_id = ?
    `).get(run.id);
    return { schema: 'ewai.repository-index-status/v1', status: run.status, run, counts };
  } finally {
    database.close();
  }
}

function sourceMapCounts(rows, key, expected = []) {
  const counts = Object.fromEntries(expected.map((value) => [value, 0]));
  for (const row of rows) counts[row[key]] = Number(row.count ?? 0);
  return counts;
}

function safeLimit(value, fallback = 50) {
  return Math.max(1, Math.min(200, Number(value ?? fallback) || fallback));
}

function safeFilter(value, label, maxLength, allowed = null) {
  const filter = String(value ?? '').trim();
  if (filter.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters.`);
  if (filter && allowed && !allowed.has(filter)) throw new Error(`Unsupported ${label}: ${filter}`);
  return filter;
}

function latestCompletedRun(database) {
  return database.prepare("SELECT * FROM repo_index_runs WHERE status = 'completed' ORDER BY id DESC LIMIT 1").get() ?? null;
}

function safeStoredPath(stored) {
  const value = String(stored ?? '');
  const separator = value.indexOf(':');
  return separator === -1 ? value : value.slice(separator + 1);
}

export function repositorySourceMapCoverage(projectRoot) {
  const freshness = repositoryIndexFreshness(projectRoot);
  const database = openRuntimeDatabase(projectRoot);
  try {
    const run = latestCompletedRun(database);
    const empty = {
      analysed: 0,
      inventory_only: 0,
      skipped_sensitive: 0,
      skipped_oversized: 0,
      analysis_failed: 0
    };
    if (!run) {
      return {
        schema: 'ewai.repository-source-map-coverage/v1',
        status: 'missing',
        runId: null,
        fresh: false,
        totalFiles: 0,
        outcomes: empty,
        depths: { deep: 0, shallow: 0, inventory: 0 },
        classifications: {},
        analysers: {},
        partial: 0,
        profileCount: 0,
        warnings: ['No completed Source Map run is available.'],
        freshness,
        guidance: { advisory: true, completeUnderstanding: false, humanReviewRequired: true }
      };
    }
    const outcomes = sourceMapCounts(database.prepare(`
      SELECT analysis_outcome AS value, COUNT(*) AS count FROM repo_files
      WHERE run_id = ? GROUP BY analysis_outcome
    `).all(run.id), 'value', Object.keys(empty));
    const depths = sourceMapCounts(database.prepare(`
      SELECT analysis_depth AS value, COUNT(*) AS count FROM repo_files
      WHERE run_id = ? GROUP BY analysis_depth
    `).all(run.id), 'value', ['deep', 'shallow', 'inventory']);
    const classifications = sourceMapCounts(database.prepare(`
      SELECT classification AS value, COUNT(*) AS count FROM repo_files
      WHERE run_id = ? GROUP BY classification ORDER BY classification
    `).all(run.id), 'value');
    const analysers = sourceMapCounts(database.prepare(`
      SELECT analyser AS value, COUNT(*) AS count FROM repo_files
      WHERE run_id = ? GROUP BY analyser ORDER BY analyser
    `).all(run.id), 'value');
    const partial = Number(database.prepare(`
      SELECT COUNT(*) AS count FROM repo_files
      WHERE run_id = ? AND json_extract(metadata_json, '$.partial') = 1
    `).get(run.id).count ?? 0);
    const profileCount = Number(database.prepare('SELECT COUNT(*) AS count FROM repo_index_profiles WHERE run_id = ?').get(run.id).count);
    const totalFiles = Object.values(outcomes).reduce((total, count) => total + Number(count), 0);
    const warnings = [];
    if (outcomes.inventory_only) warnings.push(`${outcomes.inventory_only} file(s) have inventory-only evidence.`);
    if (outcomes.skipped_sensitive) warnings.push(`${outcomes.skipped_sensitive} sensitive file(s) were not opened.`);
    if (outcomes.skipped_oversized) warnings.push(`${outcomes.skipped_oversized} oversized file(s) were not opened.`);
    if (outcomes.analysis_failed) warnings.push(`${outcomes.analysis_failed} file(s) have bounded analysis failure evidence.`);
    if (partial) warnings.push(`${partial} file(s) have partial platform evidence.`);
    if (depths.shallow) warnings.push(`${depths.shallow} file(s) have shallow rather than dependency-level evidence.`);
    return {
      schema: 'ewai.repository-source-map-coverage/v1',
      status: run.status,
      runId: Number(run.id),
      fresh: !freshness.stale,
      totalFiles,
      outcomes,
      depths,
      classifications,
      analysers,
      partial,
      profileCount,
      profileDigest: run.profile_digest,
      warnings,
      freshness,
      guidance: { advisory: true, completeUnderstanding: false, humanReviewRequired: true }
    };
  } finally {
    database.close();
  }
}

export function repositorySourceMapProfiles(projectRoot, options = {}) {
  const database = openRuntimeDatabase(projectRoot);
  try {
    const run = latestCompletedRun(database);
    if (!run) return { schema: 'ewai.repository-source-map-profiles/v1', runId: null, profiles: [] };
    const sourceKind = safeFilter(options.sourceKind, 'Source Map profile source', 20,
      new Set(['core', 'technology', 'stack', 'organisation', 'project']));
    const analyser = safeFilter(options.analyser, 'Source Map analyser', 32,
      new Set(['inventory-only', 'text-summary', 'structured-keys', 'tree-sitter',
        'power-platform-metadata', 'salesforce-metadata']));
    const clauses = ['profiles.run_id = ?'];
    const parameters = [run.id];
    if (sourceKind) {
      clauses.push('profiles.source_kind = ?');
      parameters.push(sourceKind);
    }
    if (analyser) {
      clauses.push('profiles.analyser = ?');
      parameters.push(analyser);
    }
    parameters.push(safeLimit(options.limit, 100));
    const rows = database.prepare(`
      SELECT profiles.profile_id, profiles.source_kind, profiles.source_ref,
        profiles.classification, profiles.analyser, profiles.analysis_depth,
        profiles.priority, profiles.metadata_json,
        (SELECT COUNT(*) FROM repo_files files
          WHERE files.run_id = profiles.run_id AND files.profile_id = profiles.profile_id) AS match_count
      FROM repo_index_profiles profiles WHERE ${clauses.join(' AND ')}
      ORDER BY profiles.source_kind, profiles.priority DESC, profiles.profile_id LIMIT ?
    `).all(...parameters);
    const profiles = rows.map((row) => {
      const metadata = JSON.parse(row.metadata_json || '{}');
      return {
        id: row.profile_id,
        sourceKind: row.source_kind,
        sourceRef: row.source_ref,
        sourceVersion: metadata.source_version ?? '',
        classification: row.classification,
        analyser: row.analyser,
        analysisDepth: row.analysis_depth,
        priority: Number(row.priority),
        patterns: Array.isArray(metadata.patterns) ? metadata.patterns : [],
        repositories: Array.isArray(metadata.repositories) ? metadata.repositories : [],
        maxBytes: Number(metadata.max_bytes ?? 0),
        matchCount: Number(row.match_count ?? 0)
      };
    });
    return { schema: 'ewai.repository-source-map-profiles/v1', runId: Number(run.id), profiles };
  } finally {
    database.close();
  }
}

export function repositorySourceMapFiles(projectRoot, options = {}) {
  const database = openRuntimeDatabase(projectRoot);
  try {
    const run = latestCompletedRun(database);
    if (!run) return { schema: 'ewai.repository-source-map-files/v1', runId: null, filters: {}, files: [] };
    const clauses = ['run_id = ?'];
    const parameters = [run.id];
    const filters = {
      outcome: safeFilter(options.outcome, 'Source Map outcome', 32,
        new Set(['analysed', 'inventory_only', 'skipped_sensitive', 'skipped_oversized', 'analysis_failed'])),
      classification: safeFilter(options.classification, 'Source Map classification', 100),
      profileId: safeFilter(options.profileId, 'Source Map profile ID', 240),
      repository: safeFilter(options.repository, 'Source Map repository', 160),
      query: safeFilter(options.query, 'Source Map path query', 240),
      attentionOnly: options.attentionOnly === true
    };
    for (const [field, column] of [
      ['outcome', 'analysis_outcome'],
      ['classification', 'classification'],
      ['profileId', 'profile_id'],
      ['repository', 'repo']
    ]) {
      if (!filters[field]) continue;
      clauses.push(`${column} = ?`);
      parameters.push(filters[field]);
    }
    if (filters.attentionOnly) {
      clauses.push('analysis_outcome != ?');
      parameters.push('analysed');
    }
    if (filters.query) {
      clauses.push('lower(path) LIKE ?');
      parameters.push(`%${filters.query.toLowerCase()}%`);
    }
    parameters.push(safeLimit(options.limit, 50));
    const rows = database.prepare(`
      SELECT repo, path, language, parser_status, size_bytes, line_count,
        parse_error_count, classification, profile_id, analyser,
        analysis_depth, analysis_outcome
      FROM repo_files WHERE ${clauses.join(' AND ')} ORDER BY path LIMIT ?
    `).all(...parameters);
    return {
      schema: 'ewai.repository-source-map-files/v1',
      runId: Number(run.id),
      filters,
      files: rows.map((row) => ({
        repository: row.repo,
        path: safeStoredPath(row.path),
        language: row.language,
        parserStatus: row.parser_status,
        sizeBytes: Number(row.size_bytes),
        lineCount: Number(row.line_count),
        parseErrorCount: Number(row.parse_error_count),
        classification: row.classification,
        profileId: row.profile_id,
        analyser: row.analyser,
        analysisDepth: row.analysis_depth,
        analysisOutcome: row.analysis_outcome
      }))
    };
  } finally {
    database.close();
  }
}

export function searchRepositoryIndex(projectRoot, query, options = {}) {
  const database = openRuntimeDatabase(projectRoot);
  try {
    const run = database.prepare("SELECT id FROM repo_index_runs WHERE status = 'completed' ORDER BY id DESC LIMIT 1").get();
    if (!run) throw new Error('Repository index is missing; refresh it before searching.');
    const needle = `%${String(query).toLowerCase()}%`;
    const limit = Math.max(1, Math.min(200, Number(options.limit ?? 50)));
    const symbols = database.prepare(`
      SELECT symbol_kind, symbol_name, path, line, signature FROM repo_symbols
      WHERE run_id = ? AND lower(symbol_name || ' ' || path || ' ' || signature) LIKE ?
      ORDER BY symbol_name LIMIT ?
    `).all(run.id, needle, limit);
    const files = database.prepare(`
      SELECT repo, path, language, parser_status, line_count, classification,
        profile_id, analyser, analysis_depth, analysis_outcome
      FROM repo_files
      WHERE run_id = ? AND lower(path) LIKE ? ORDER BY path LIMIT ?
    `).all(run.id, needle, limit);
    return { schema: 'ewai.repository-search/v1', runId: run.id, query, symbols, files };
  } finally {
    database.close();
  }
}

export function repositoryGraph(projectRoot, target, options = {}) {
  const database = openRuntimeDatabase(projectRoot);
  try {
    const run = database.prepare("SELECT id FROM repo_index_runs WHERE status = 'completed' ORDER BY id DESC LIMIT 1").get();
    if (!run) throw new Error('Repository index is missing; refresh it before graph lookup.');
    const needle = `%${String(target).toLowerCase()}%`;
    const limit = Math.max(1, Math.min(200, Number(options.limit ?? 80)));
    const relationships = database.prepare(`
      SELECT * FROM repo_relationships WHERE run_id = ? AND (
        lower(source_name) LIKE ? OR lower(source_path) LIKE ? OR
        lower(target_name) LIKE ? OR lower(target_path) LIKE ?
      ) ORDER BY relationship_kind LIMIT ?
    `).all(run.id, needle, needle, needle, needle, limit);
    const imports = database.prepare(`
      SELECT * FROM repo_imports WHERE run_id = ? AND (
        lower(path) LIKE ? OR lower(source_module) LIKE ? OR lower(imported_name) LIKE ?
      ) ORDER BY path LIMIT ?
    `).all(run.id, needle, needle, needle, limit);
    return { schema: 'ewai.repository-graph/v1', runId: run.id, target, relationships, imports };
  } finally {
    database.close();
  }
}
