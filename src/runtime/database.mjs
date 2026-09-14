import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runtimePaths } from './paths.mjs';

export function openRuntimeDatabase(projectRoot) {
  const { databasePath } = runtimePaths(projectRoot);
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec('PRAGMA busy_timeout = 5000;');
  database.exec('PRAGMA journal_mode = WAL;');
  migrateRuntimeDatabase(database);
  return database;
}

export function migrateRuntimeDatabase(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS runtime_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS intents (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      domain TEXT NOT NULL DEFAULT 'general',
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      delivery_status TEXT NOT NULL DEFAULT 'not-started',
      current_phase TEXT NOT NULL DEFAULT 'backlog',
      delivery_state_path TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL UNIQUE,
      intent_map TEXT,
      personas_json TEXT NOT NULL DEFAULT '[]',
      relationships_json TEXT NOT NULL DEFAULT '[]',
      delivery_shape_json TEXT NOT NULL DEFAULT 'null',
      excerpt TEXT NOT NULL DEFAULT '',
      markdown TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      source_mtime_ms REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_intents_status ON intents(status, title);
    CREATE INDEX IF NOT EXISTS idx_intents_domain ON intents(domain, title);

    CREATE TABLE IF NOT EXISTS delivery_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      priority TEXT NOT NULL DEFAULT 'P2',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS work_items (
      id TEXT PRIMARY KEY,
      intent_id TEXT NOT NULL UNIQUE REFERENCES intents(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      domain TEXT NOT NULL DEFAULT 'general',
      title TEXT NOT NULL,
      intent_path TEXT NOT NULL,
      lane TEXT NOT NULL DEFAULT 'backlog',
      state TEXT NOT NULL DEFAULT 'preparing',
      intent_state TEXT NOT NULL DEFAULT 'intent-draft',
      completion_percent INTEGER NOT NULL DEFAULT 0 CHECK (completion_percent BETWEEN 0 AND 100),
      priority TEXT NOT NULL DEFAULT 'P2',
      current_sprint INTEGER NOT NULL DEFAULT 0,
      current_phase TEXT NOT NULL DEFAULT 'intent',
      blocked_by TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_work_items_lane ON work_items(lane, priority, title);
    CREATE INDEX IF NOT EXISTS idx_work_items_sprint ON work_items(current_sprint, lane);

    CREATE TABLE IF NOT EXISTS group_items (
      group_id INTEGER NOT NULL REFERENCES delivery_groups(id) ON DELETE CASCADE,
      work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual',
      PRIMARY KEY (group_id, work_item_id)
    );

    CREATE TABLE IF NOT EXISTS pipeline_phases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      phase_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TEXT,
      completed_at TEXT,
      artefact_path TEXT NOT NULL DEFAULT '',
      iteration_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      UNIQUE (work_item_id, phase_key)
    );

    CREATE TABLE IF NOT EXISTS artefacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (work_item_id, kind, path)
    );

    CREATE TABLE IF NOT EXISTS active_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_item_id TEXT NOT NULL UNIQUE REFERENCES work_items(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL DEFAULT '',
      tool TEXT NOT NULL DEFAULT '',
      phase_key TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'running',
      summary TEXT NOT NULL DEFAULT '',
      awaiting_human INTEGER NOT NULL DEFAULT 0,
      question TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ended_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_active_sessions_status ON active_sessions(status, updated_at);

    CREATE TABLE IF NOT EXISTS execution_leases (
      id TEXT PRIMARY KEY,
      work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      tool TEXT NOT NULL DEFAULT '',
      run_id TEXT NOT NULL DEFAULT '',
      token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      released_at TEXT,
      outcome TEXT NOT NULL DEFAULT ''
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_leases_active_task
      ON execution_leases(work_item_id, task_id) WHERE status = 'active';
    CREATE INDEX IF NOT EXISTS idx_execution_leases_expiry
      ON execution_leases(status, expires_at);

    CREATE TABLE IF NOT EXISTS activity_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER REFERENCES active_sessions(id) ON DELETE SET NULL,
      work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL DEFAULT 'progress',
      tool TEXT NOT NULL DEFAULT '',
      phase_key TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      details TEXT NOT NULL DEFAULT '',
      requires_human INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_activity_events_work_item ON activity_events(work_item_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_events_session ON activity_events(session_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS command_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL,
      run_uuid TEXT NOT NULL UNIQUE,
      phase_key TEXT NOT NULL DEFAULT '',
      action_id TEXT NOT NULL DEFAULT '',
      tool TEXT NOT NULL DEFAULT '',
      command TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      exit_code INTEGER,
      stdout_path TEXT NOT NULL DEFAULT '',
      stderr_path TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_command_runs_work_item ON command_runs(work_item_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS repo_index_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      duration_ms INTEGER,
      summary TEXT NOT NULL DEFAULT '',
      repos_json TEXT NOT NULL DEFAULT '{}',
      profile_digest TEXT NOT NULL DEFAULT '',
      profile_summary_json TEXT NOT NULL DEFAULT '[]',
      outcome_totals_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS repo_files (
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
      classification TEXT NOT NULL DEFAULT '',
      profile_id TEXT NOT NULL DEFAULT '',
      analyser TEXT NOT NULL DEFAULT '',
      analysis_depth TEXT NOT NULL DEFAULT 'inventory',
      analysis_outcome TEXT NOT NULL DEFAULT 'inventory_only',
      fingerprint_kind TEXT NOT NULL DEFAULT '',
      fingerprint TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (run_id, path)
    );

    CREATE INDEX IF NOT EXISTS idx_repo_files_path ON repo_files(path);
    CREATE INDEX IF NOT EXISTS idx_repo_files_language ON repo_files(language, parser_status);
    CREATE TABLE IF NOT EXISTS repo_index_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES repo_index_runs(id) ON DELETE CASCADE,
      profile_id TEXT NOT NULL,
      source_kind TEXT NOT NULL DEFAULT 'core',
      source_ref TEXT NOT NULL DEFAULT '',
      classification TEXT NOT NULL DEFAULT '',
      analyser TEXT NOT NULL DEFAULT '',
      analysis_depth TEXT NOT NULL DEFAULT 'inventory',
      priority INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE (run_id, profile_id)
    );

    CREATE INDEX IF NOT EXISTS idx_repo_index_profiles_run ON repo_index_profiles(run_id, profile_id);

    CREATE TABLE IF NOT EXISTS repo_symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER REFERENCES repo_index_runs(id) ON DELETE SET NULL,
      repo TEXT NOT NULL,
      symbol_kind TEXT NOT NULL,
      symbol_name TEXT NOT NULL,
      path TEXT NOT NULL,
      line INTEGER,
      signature TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      content_hash TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_repo_symbols_kind_name ON repo_symbols(symbol_kind, symbol_name);
    CREATE INDEX IF NOT EXISTS idx_repo_symbols_path ON repo_symbols(path);

    CREATE TABLE IF NOT EXISTS repo_spans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER REFERENCES repo_index_runs(id) ON DELETE SET NULL,
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      symbol_kind TEXT NOT NULL,
      symbol_name TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      start_byte INTEGER NOT NULL DEFAULT 0,
      end_byte INTEGER NOT NULL DEFAULT 0,
      evidence_snippet TEXT NOT NULL DEFAULT '',
      parser TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_repo_spans_path ON repo_spans(path);
    CREATE INDEX IF NOT EXISTS idx_repo_spans_symbol ON repo_spans(symbol_kind, symbol_name);

    CREATE TABLE IF NOT EXISTS repo_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER REFERENCES repo_index_runs(id) ON DELETE SET NULL,
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      source_module TEXT NOT NULL DEFAULT '',
      imported_name TEXT NOT NULL DEFAULT '',
      local_name TEXT NOT NULL DEFAULT '',
      import_kind TEXT NOT NULL DEFAULT '',
      line INTEGER,
      parser TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_repo_imports_path ON repo_imports(path);
    CREATE INDEX IF NOT EXISTS idx_repo_imports_module ON repo_imports(source_module);

    CREATE TABLE IF NOT EXISTS repo_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER REFERENCES repo_index_runs(id) ON DELETE SET NULL,
      source_kind TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_path TEXT NOT NULL DEFAULT '',
      relationship_kind TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_name TEXT NOT NULL,
      target_path TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_repo_relationships_source ON repo_relationships(source_kind, source_name);
    CREATE INDEX IF NOT EXISTS idx_repo_relationships_target ON repo_relationships(target_kind, target_name);

    CREATE TABLE IF NOT EXISTS standards_applicability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER REFERENCES repo_index_runs(id) ON DELETE SET NULL,
      target_kind TEXT NOT NULL,
      target_path TEXT NOT NULL,
      standard_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      rule_summary TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0.7,
      required INTEGER NOT NULL DEFAULT 1,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_standards_target ON standards_applicability(target_kind, target_path);
    CREATE INDEX IF NOT EXISTS idx_standards_id ON standards_applicability(standard_id);

    CREATE TABLE IF NOT EXISTS capability_fingerprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL DEFAULT '',
      domain TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      surfaces_json TEXT NOT NULL DEFAULT '[]',
      route_shapes_json TEXT NOT NULL DEFAULT '[]',
      components_json TEXT NOT NULL DEFAULT '[]',
      standards_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_capability_fingerprints_domain ON capability_fingerprints(domain);

    CREATE TABLE IF NOT EXISTS validation_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL DEFAULT '',
      phase_key TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      severity TEXT NOT NULL DEFAULT '',
      finding_class TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      surface TEXT NOT NULL DEFAULT '',
      root_cause TEXT NOT NULL DEFAULT '',
      preventable INTEGER NOT NULL DEFAULT 0,
      path TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_validation_findings_slug ON validation_findings(slug);
    CREATE INDEX IF NOT EXISTS idx_validation_findings_class ON validation_findings(finding_class);

    CREATE TABLE IF NOT EXISTS lifecycle_handlers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      publisher_id TEXT NOT NULL,
      publisher_name TEXT NOT NULL,
      version TEXT NOT NULL,
      protocol_version TEXT NOT NULL,
      event_schema_version TEXT NOT NULL,
      trusted_root TEXT NOT NULL,
      entrypoint TEXT NOT NULL,
      manifest_digest TEXT NOT NULL,
      package_digest TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      registered_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lifecycle_subscriptions (
      id TEXT PRIMARY KEY,
      handler_id TEXT NOT NULL REFERENCES lifecycle_handlers(id) ON DELETE RESTRICT,
      patterns_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      disabled_at TEXT,
      UNIQUE (handler_id, patterns_json)
    );

    CREATE INDEX IF NOT EXISTS idx_lifecycle_subscriptions_enabled
      ON lifecycle_subscriptions(enabled, handler_id);

    CREATE TABLE IF NOT EXISTS lifecycle_events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      schema_version TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      source_key TEXT NOT NULL UNIQUE,
      source_revision TEXT NOT NULL DEFAULT '',
      project_json TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      facts_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      personas_json TEXT NOT NULL,
      stream_id TEXT NOT NULL,
      stream_sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (stream_id, stream_sequence)
    );

    CREATE INDEX IF NOT EXISTS idx_lifecycle_events_name_time
      ON lifecycle_events(name, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lifecycle_events_stream
      ON lifecycle_events(stream_id, stream_sequence);

    CREATE TABLE IF NOT EXISTS lifecycle_deliveries (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES lifecycle_events(id) ON DELETE CASCADE,
      subscription_id TEXT NOT NULL REFERENCES lifecycle_subscriptions(id) ON DELETE RESTRICT,
      handler_snapshot_json TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'queued',
      automatic_attempt_count INTEGER NOT NULL DEFAULT 0,
      manual_pending INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      last_code TEXT NOT NULL DEFAULT '',
      last_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      disabled_at TEXT,
      retention_after TEXT,
      UNIQUE (event_id, subscription_id)
    );

    CREATE INDEX IF NOT EXISTS idx_lifecycle_deliveries_dispatch
      ON lifecycle_deliveries(status, next_attempt_at, subscription_id);
    CREATE INDEX IF NOT EXISTS idx_lifecycle_deliveries_event
      ON lifecycle_deliveries(event_id);

    CREATE TABLE IF NOT EXISTS lifecycle_attempts (
      id TEXT PRIMARY KEY,
      delivery_id TEXT NOT NULL REFERENCES lifecycle_deliveries(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      status TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      UNIQUE (delivery_id, ordinal)
    );

    CREATE INDEX IF NOT EXISTS idx_lifecycle_attempts_delivery
      ON lifecycle_attempts(delivery_id, ordinal);

    CREATE TABLE IF NOT EXISTS security_adapters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      publisher_id TEXT NOT NULL,
      publisher_name TEXT NOT NULL,
      version TEXT NOT NULL,
      protocol_version TEXT NOT NULL,
      trusted_root TEXT NOT NULL,
      entrypoint TEXT NOT NULL,
      manifest_digest TEXT NOT NULL,
      package_digest TEXT NOT NULL,
      capabilities_json TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      registered_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS security_runs (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      provider_id TEXT,
      adapter_id TEXT REFERENCES security_adapters(id) ON DELETE RESTRICT,
      interaction_mode TEXT NOT NULL,
      capability TEXT NOT NULL,
      status TEXT NOT NULL,
      revision TEXT NOT NULL DEFAULT '',
      scope_json TEXT NOT NULL DEFAULT '{}',
      target_class TEXT,
      target_ref TEXT,
      complete INTEGER NOT NULL DEFAULT 0,
      outcome TEXT NOT NULL DEFAULT '',
      report_digest TEXT NOT NULL DEFAULT '',
      policy_digest TEXT NOT NULL DEFAULT '',
      profile_snapshot_json TEXT NOT NULL DEFAULT '{}',
      tool_json TEXT NOT NULL DEFAULT '{}',
      redaction_status TEXT NOT NULL DEFAULT '',
      warnings_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_security_runs_profile
      ON security_runs(profile_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_security_runs_status
      ON security_runs(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS security_attempts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES security_runs(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      status TEXT NOT NULL,
      exit_code INTEGER,
      signal TEXT NOT NULL DEFAULT '',
      timed_out INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE (run_id, ordinal)
    );

    CREATE INDEX IF NOT EXISTS idx_security_attempts_run
      ON security_attempts(run_id, ordinal);

    CREATE TABLE IF NOT EXISTS security_findings (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES security_runs(id) ON DELETE RESTRICT,
      finding_key TEXT NOT NULL,
      capability TEXT NOT NULL,
      provider_severity TEXT NOT NULL DEFAULT 'unknown',
      provider_confidence REAL,
      summary TEXT NOT NULL,
      locations_json TEXT NOT NULL DEFAULT '[]',
      remediation TEXT NOT NULL DEFAULT '',
      evidence_json TEXT NOT NULL DEFAULT '[]',
      policy_consequence TEXT NOT NULL DEFAULT 'review',
      created_at TEXT NOT NULL,
      UNIQUE (run_id, finding_key)
    );

    CREATE INDEX IF NOT EXISTS idx_security_findings_run
      ON security_findings(run_id, policy_consequence);

    CREATE TABLE IF NOT EXISTS security_dispositions (
      id TEXT PRIMARY KEY,
      finding_id TEXT NOT NULL REFERENCES security_findings(id) ON DELETE RESTRICT,
      decision TEXT NOT NULL,
      reviewer TEXT NOT NULL,
      reason TEXT NOT NULL,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      risk_owner TEXT,
      expires_at TEXT,
      next_role TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_security_dispositions_finding
      ON security_dispositions(finding_id, created_at);

    CREATE TABLE IF NOT EXISTS security_discovery_tokens (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      artefacts_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_security_discovery_tokens_expiry
      ON security_discovery_tokens(expires_at, consumed_at);

    CREATE TABLE IF NOT EXISTS starter_adapters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      publisher_id TEXT NOT NULL,
      publisher_name TEXT NOT NULL,
      version TEXT NOT NULL,
      protocol_version TEXT NOT NULL,
      source_classes_json TEXT NOT NULL,
      trusted_root TEXT NOT NULL,
      entrypoint TEXT NOT NULL,
      manifest_digest TEXT NOT NULL,
      package_digest TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      registered_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS starter_attempts (
      id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL,
      adapter_id TEXT NOT NULL REFERENCES starter_adapters(id) ON DELETE RESTRICT,
      status TEXT NOT NULL,
      nonce TEXT NOT NULL,
      staging_root TEXT NOT NULL,
      receipt_json TEXT NOT NULL,
      target_mappings_json TEXT NOT NULL DEFAULT '[]',
      adapter_snapshot_json TEXT NOT NULL,
      limits_json TEXT NOT NULL,
      repository_revisions_json TEXT NOT NULL DEFAULT '{}',
      tree_digest TEXT NOT NULL DEFAULT '',
      target_tree_digests_json TEXT NOT NULL DEFAULT '[]',
      preview_id TEXT NOT NULL DEFAULT '',
      preview_digest TEXT NOT NULL DEFAULT '',
      expires_at TEXT,
      journal_json TEXT NOT NULL DEFAULT '[]',
      evidence_path TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_starter_attempts_status
      ON starter_attempts(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_starter_attempts_receipt
      ON starter_attempts(receipt_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS starter_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id TEXT NOT NULL REFERENCES starter_attempts(id) ON DELETE CASCADE,
      target_role TEXT NOT NULL,
      repository_name TEXT NOT NULL,
      source_path TEXT NOT NULL,
      destination_path TEXT NOT NULL,
      content_digest TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      classification TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE (attempt_id, target_role, source_path)
    );

    CREATE INDEX IF NOT EXISTS idx_starter_files_attempt
      ON starter_files(attempt_id, target_role, source_path);

    CREATE TABLE IF NOT EXISTS starter_approvals (
      id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL UNIQUE REFERENCES starter_attempts(id) ON DELETE RESTRICT,
      preview_id TEXT NOT NULL UNIQUE,
      approved_by TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      evidence_path TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS palace_index_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'running',
      source_fingerprint TEXT NOT NULL DEFAULT '',
      document_count INTEGER NOT NULL DEFAULT 0,
      section_count INTEGER NOT NULL DEFAULT 0,
      link_count INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      summary TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS palace_documents (
      path TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      extension TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL,
      content_length INTEGER NOT NULL DEFAULT 0,
      source_mtime TEXT NOT NULL DEFAULT '',
      has_title INTEGER NOT NULL DEFAULT 0,
      section_count INTEGER NOT NULL DEFAULT 0,
      indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_palace_documents_hash ON palace_documents(content_hash);
    CREATE INDEX IF NOT EXISTS idx_palace_documents_title ON palace_documents(title);

    CREATE TABLE IF NOT EXISTS palace_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_path TEXT NOT NULL,
      target_path TEXT NOT NULL DEFAULT '',
      target_anchor TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'project',
      exists_on_disk INTEGER NOT NULL DEFAULT 0,
      line INTEGER,
      raw_target TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_palace_links_source ON palace_links(source_path);
    CREATE INDEX IF NOT EXISTS idx_palace_links_target ON palace_links(kind, target_path);

    CREATE VIRTUAL TABLE IF NOT EXISTS palace_sections_fts USING fts5(
      path UNINDEXED,
      title,
      heading,
      body,
      heading_path UNINDEXED,
      line UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);

  const groupItemColumns = database.prepare('PRAGMA table_info(group_items)').all().map((column) => column.name);
  if (!groupItemColumns.includes('source')) {
    database.exec("ALTER TABLE group_items ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'");
  }

  const intentColumns = database.prepare('PRAGMA table_info(intents)').all().map((column) => column.name);
  if (!intentColumns.includes('delivery_status')) {
    database.exec("ALTER TABLE intents ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'not-started'");
  }
  if (!intentColumns.includes('current_phase')) {
    database.exec("ALTER TABLE intents ADD COLUMN current_phase TEXT NOT NULL DEFAULT 'backlog'");
  }
  if (!intentColumns.includes('delivery_state_path')) {
    database.exec("ALTER TABLE intents ADD COLUMN delivery_state_path TEXT NOT NULL DEFAULT ''");
  }
  if (!intentColumns.includes('intent_map')) {
    database.exec('ALTER TABLE intents ADD COLUMN intent_map TEXT');
  }
  if (!intentColumns.includes('relationships_json')) {
    database.exec("ALTER TABLE intents ADD COLUMN relationships_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!intentColumns.includes('delivery_shape_json')) {
    database.exec("ALTER TABLE intents ADD COLUMN delivery_shape_json TEXT NOT NULL DEFAULT 'null'");
  }

  const activeSessionColumns = database.prepare('PRAGMA table_info(active_sessions)').all().map((column) => column.name);
  if (!activeSessionColumns.includes('owner_id')) {
    database.exec("ALTER TABLE active_sessions ADD COLUMN owner_id TEXT NOT NULL DEFAULT ''");
  }

  const securityRunColumns = database.prepare('PRAGMA table_info(security_runs)').all().map((column) => column.name);
  if (!securityRunColumns.includes('policy_digest')) {
    database.exec("ALTER TABLE security_runs ADD COLUMN policy_digest TEXT NOT NULL DEFAULT ''");
  }
  if (!securityRunColumns.includes('profile_snapshot_json')) {
    database.exec("ALTER TABLE security_runs ADD COLUMN profile_snapshot_json TEXT NOT NULL DEFAULT '{}'");
  }
  if (!securityRunColumns.includes('tool_json')) {
    database.exec("ALTER TABLE security_runs ADD COLUMN tool_json TEXT NOT NULL DEFAULT '{}'");
  }
  if (!securityRunColumns.includes('redaction_status')) {
    database.exec("ALTER TABLE security_runs ADD COLUMN redaction_status TEXT NOT NULL DEFAULT ''");
  }

  const repoIndexRunColumns = database.prepare('PRAGMA table_info(repo_index_runs)').all().map((column) => column.name);
  if (!repoIndexRunColumns.includes('profile_digest')) {
    database.exec("ALTER TABLE repo_index_runs ADD COLUMN profile_digest TEXT NOT NULL DEFAULT ''");
  }
  if (!repoIndexRunColumns.includes('profile_summary_json')) {
    database.exec("ALTER TABLE repo_index_runs ADD COLUMN profile_summary_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!repoIndexRunColumns.includes('outcome_totals_json')) {
    database.exec("ALTER TABLE repo_index_runs ADD COLUMN outcome_totals_json TEXT NOT NULL DEFAULT '{}'");
  }

  const repoFileColumns = database.prepare('PRAGMA table_info(repo_files)').all().map((column) => column.name);
  const repoFileMigrations = [
    ['classification', "TEXT NOT NULL DEFAULT ''"],
    ['profile_id', "TEXT NOT NULL DEFAULT ''"],
    ['analyser', "TEXT NOT NULL DEFAULT ''"],
    ['analysis_depth', "TEXT NOT NULL DEFAULT 'inventory'"],
    ['analysis_outcome', "TEXT NOT NULL DEFAULT 'inventory_only'"],
    ['fingerprint_kind', "TEXT NOT NULL DEFAULT ''"],
    ['fingerprint', "TEXT NOT NULL DEFAULT ''"]
  ];
  for (const [column, definition] of repoFileMigrations) {
    if (!repoFileColumns.includes(column)) database.exec(`ALTER TABLE repo_files ADD COLUMN ${column} ${definition}`);
  }
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_repo_files_outcome ON repo_files(analysis_outcome, classification);
    CREATE INDEX IF NOT EXISTS idx_repo_files_profile ON repo_files(profile_id, analyser);
  `);

  database.prepare(`
    INSERT INTO runtime_meta (key, value, updated_at)
      VALUES ('schema_version', '14', CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run();
}

export function initializeRuntime(projectRoot) {
  const database = openRuntimeDatabase(projectRoot);
  database.close();
  const paths = runtimePaths(projectRoot);
  return {
    schema: 'ewai.runtime/v1',
    databasePath: paths.databasePath
  };
}
