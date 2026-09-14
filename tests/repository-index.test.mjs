import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initProject } from '../src/project.mjs';
import { createIntent } from '../src/intents.mjs';
import { openRuntimeDatabase } from '../src/runtime/database.mjs';
import { runtimePaths } from '../src/runtime/paths.mjs';
import { analyseRepositoryFile } from '../src/repository-source-map.mjs';
import {
  refreshRepositoryIndex,
  repositoryGraph,
  repositoryIndexFreshness,
  repositoryIndexStatus,
  repositoryStandards,
  repositoryStandardsCoverage,
  repositoryTruth,
  searchRepositoryIndex,
  similarRepositoryCapabilities
} from '../src/runtime/repository-index.mjs';

test('builds a project-local Tree-sitter repository graph', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-repository-index-'));
  try {
    initProject(root, { name: 'Repository Index Test' });
    mkdirSync(resolve(root, 'src'), { recursive: true });
    writeFileSync(resolve(root, 'src/alerts.mjs'), `
      import { send } from './transport';
      export class AlertDispatcher {
        dispatch(message) { return send(message); }
      }
    `);
    writeFileSync(resolve(root, 'src/transport.mjs'), `
      export function send(message) { return { delivered: true, message }; }
    `);
    for (const slug of ['safe-alerts', 'scheduled-alerts']) {
      createIntent(root, { slug, domain: 'alerts', title: slug === 'safe-alerts' ? 'Safe Alerts' : 'Scheduled Alerts' });
      const planRoot = resolve(root, `SPECS/6.Build/${slug}/gates/plan`);
      mkdirSync(planRoot, { recursive: true });
      const standards = slug === 'safe-alerts'
        ? { standards_evidence: [{
          id: 'api-response-standard',
          source_path: 'SPECS/4.Constraints/standards/api-responses.md',
          targets: ['src/alerts.mjs'],
          required: true
        }] }
        : { standards: [{
          id: 'scheduled-delivery-standard',
          path: 'SPECS/4.Constraints/standards/scheduled-delivery.md',
          application: 'Applies scheduled delivery constraints to this capability.'
        }] };
      writeFileSync(resolve(planRoot, 'plan-contract.json'), JSON.stringify({
        backend_endpoints: [{ route_class: 'rest' }],
        test_obligations: [{ id: 'T-001' }],
        ...standards
      }));
      writeFileSync(resolve(planRoot, 'claim-ledger.json'), '{"implementation_claims":[]}\n');
    }

    const refreshed = refreshRepositoryIndex(root);
    assert.equal(refreshed.status, 'completed');
    assert.equal(refreshed.files >= 2, true);
    assert.equal(refreshed.parsed >= 2, true);
    assert.equal(refreshed.symbols > 0, true);

    const status = repositoryIndexStatus(root);
    assert.equal(status.status, 'completed');
    assert.equal(status.counts.files >= 2, true);

    const search = searchRepositoryIndex(root, 'send');
    assert.equal(search.symbols.some((symbol) => symbol.symbol_name === 'send'), true);

    const graph = repositoryGraph(root, 'alerts.mjs');
    assert.equal(graph.imports.some((item) => item.source_module === './transport'), true);

    assert.equal(repositoryIndexFreshness(root).status, 'fresh');
    assert.equal(repositoryTruth(root, 'safe-alerts').files.some((file) => file.path.endsWith('src/alerts.mjs')), true);
    assert.equal(similarRepositoryCapabilities(root, 'safe-alerts').matches[0].slug, 'scheduled-alerts');
    assert.equal(repositoryStandards(root, 'alerts.mjs').standards[0].standardId, 'api-response-standard');
    assert.equal(repositoryStandardsCoverage(root, 'safe-alerts').status, 'pass');
    const currentCoverage = repositoryStandardsCoverage(root, 'scheduled-alerts');
    assert.equal(currentCoverage.status, 'pass');
    assert.equal(currentCoverage.standardsEvidence[0].source_path, 'SPECS/4.Constraints/standards/scheduled-delivery.md');
    assert.equal(currentCoverage.standardsEvidence[0].rule_summary, 'Applies scheduled delivery constraints to this capability.');

    writeFileSync(resolve(root, 'src/transport.mjs'), `
      export function send(message) { return { delivered: false, message }; }
    `);
    assert.equal(repositoryIndexFreshness(root).status, 'stale');
    assert.equal(repositoryStandardsCoverage(root, 'safe-alerts').status, 'blocked');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('inventories every non-excluded regular file with bounded analysis outcomes', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-source-map-inventory-'));
  try {
    initProject(root, { name: 'Source Map Inventory Test' });
    mkdirSync(resolve(root, 'fixtures'), { recursive: true });
    writeFileSync(resolve(root, 'fixtures/config.json'), JSON.stringify({
      api: { token: 'json-secret-must-not-be-stored', enabled: true },
      regions: [{ code: 'uk' }]
    }));
    writeFileSync(resolve(root, 'fixtures/broken.json'), '{"api":');
    writeFileSync(resolve(root, 'fixtures/settings.yaml'), 'service:\n  token: yaml-secret-must-not-be-stored\n');
    writeFileSync(resolve(root, 'fixtures/README.md'), '# Inventory fixture\n\nText must not be projected.\n');
    writeFileSync(resolve(root, 'fixtures/component.tsx'), 'export function Card() { return <section>Safe</section>; }\n');
    writeFileSync(resolve(root, 'fixtures/worker.cts'), 'export function execute() { return true; }\n');
    writeFileSync(resolve(root, 'fixtures/widget.jsx'), 'export function Widget() { return <div />; }\n');
    writeFileSync(resolve(root, 'fixtures/.env'), 'API_TOKEN=environment-secret-must-not-be-stored\n');
    writeFileSync(resolve(root, 'fixtures/image.bin'), Buffer.from([0, 1, 2, 3, 255]));
    writeFileSync(resolve(root, 'fixtures/oversized.txt'), Buffer.alloc(900_001, 65));

    const refreshed = refreshRepositoryIndex(root);
    assert.equal(refreshed.status, 'completed');
    assert.equal(refreshed.outcomes.analysis_failed >= 1, true);
    assert.equal(refreshed.outcomes.inventory_only >= 1, true);
    assert.equal(refreshed.outcomes.skipped_oversized >= 1, true);
    assert.equal(refreshed.outcomes.skipped_sensitive >= 1, true);

    const database = openRuntimeDatabase(root);
    try {
      const run = database.prepare("SELECT id FROM repo_index_runs WHERE status = 'completed' ORDER BY id DESC LIMIT 1").get();
      const files = database.prepare(`
        SELECT path, language, parser_status, classification, profile_id, analyser,
          analysis_depth, analysis_outcome, fingerprint_kind, metadata_json
        FROM repo_files WHERE run_id = ? AND path LIKE '%:fixtures/%' ORDER BY path
      `).all(run.id);
      assert.equal(files.length, 10);

      const byName = new Map(files.map((file) => [file.path.split('/').pop(), file]));
      assert.equal(byName.get('config.json').analysis_outcome, 'analysed');
      assert.equal(byName.get('config.json').analyser, 'structured-keys');
      assert.deepEqual(JSON.parse(byName.get('config.json').metadata_json).structural_keys, [
        'api', 'api.enabled', 'api.token', 'regions', 'regions.code'
      ]);
      assert.equal(byName.get('broken.json').analysis_outcome, 'analysis_failed');
      assert.equal(byName.get('image.bin').analysis_outcome, 'inventory_only');
      assert.equal(byName.get('oversized.txt').analysis_outcome, 'skipped_oversized');
      assert.equal(byName.get('.env').analysis_outcome, 'skipped_sensitive');
      assert.equal(byName.get('component.tsx').parser_status, 'parsed');
      assert.equal(byName.get('worker.cts').parser_status, 'parsed');
      assert.equal(byName.get('widget.jsx').parser_status, 'parsed');
      assert.equal(files.every((file) => file.profile_id && file.analyser && file.fingerprint_kind), true);

      const storedProjection = JSON.stringify(files);
      for (const forbidden of [
        'json-secret-must-not-be-stored',
        'yaml-secret-must-not-be-stored',
        'environment-secret-must-not-be-stored',
        'Text must not be projected'
      ]) {
        assert.equal(storedProjection.includes(forbidden), false);
      }
    } finally {
      database.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('upgrades an existing repository index schema before creating Source Map indexes', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-source-map-migration-'));
  try {
    initProject(root, { name: 'Source Map Migration Test' });
    const legacy = new DatabaseSync(runtimePaths(root).databasePath);
    try {
      legacy.exec(`
        DROP TABLE repo_files;
        DROP TABLE repo_index_runs;
        CREATE TABLE repo_index_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          status TEXT NOT NULL DEFAULT 'running',
          started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at TEXT,
          duration_ms INTEGER,
          summary TEXT NOT NULL DEFAULT '',
          repos_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE repo_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id INTEGER REFERENCES repo_index_runs(id) ON DELETE SET NULL,
          repo TEXT NOT NULL,
          path TEXT NOT NULL,
          language TEXT NOT NULL DEFAULT '',
          parser TEXT NOT NULL DEFAULT '',
          parser_status TEXT NOT NULL DEFAULT 'not_applicable',
          content_hash TEXT NOT NULL DEFAULT '',
          size_bytes INTEGER NOT NULL DEFAULT 0,
          line_count INTEGER NOT NULL DEFAULT 0,
          parse_error_count INTEGER NOT NULL DEFAULT 0,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (run_id, path)
        );
      `);
    } finally {
      legacy.close();
    }

    const reopened = openRuntimeDatabase(root);
    try {
      assert.equal(reopened.prepare("SELECT value FROM runtime_meta WHERE key = 'schema_version'").get().value, '14');
      const columns = reopened.prepare('PRAGMA table_info(repo_files)').all().map((column) => column.name);
      assert.equal(columns.includes('analysis_outcome'), true);
      assert.equal(columns.includes('profile_id'), true);
      const indexes = reopened.prepare('PRAGMA index_list(repo_files)').all().map((index) => index.name);
      assert.equal(indexes.includes('idx_repo_files_outcome'), true);
      assert.equal(indexes.includes('idx_repo_files_profile'), true);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('represents an unreadable file as failed evidence without storing an exception message', () => {
  const facts = analyseRepositoryFile('/project/private.config', {
    stat: { size: 42, mtimeMs: 1000 },
    readError: true
  });
  assert.equal(facts.file.analysisOutcome, 'analysis_failed');
  assert.equal(facts.file.parserStatus, 'failed');
  assert.deepEqual(facts.file.metadata, { failure_code: 'read-failed' });
  assert.equal(JSON.stringify(facts).includes('/project/private.config'), false);
});

test('stores only a stable failure code when Tree-sitter analysis fails', () => {
  const path = resolve('src/runtime/repository-index.mjs');
  const facts = analyseRepositoryFile(path, {
    stat: statSync(path),
    repo: 'application',
    repoRelative: () => 'src/runtime/repository-index.mjs'
  });

  assert.equal(JSON.stringify(facts.file.metadata).includes('Invalid argument'), false);
  if (facts.file.parserStatus === 'failed') {
    assert.deepEqual(facts.file.metadata, { failure_code: 'tree-sitter-analysis-failed' });
  }
});
