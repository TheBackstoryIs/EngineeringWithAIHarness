import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { deriveExecutionState } from '../execution-state.mjs';
import { validatePrototypeManifest } from '../delivery-artifacts.mjs';
import { projectPaths } from '../paths.mjs';
import { openRuntimeDatabase } from './database.mjs';
import { readRuntimeIntent, syncIntentIndex } from './intents.mjs';
import { withIntentMutation, assertIntentMutation } from './intent-ownership.mjs';

const lanes = ['backlog', 'ready', 'active', 'qa', 'blocked', 'done'];

function groupName(slug) {
  return String(slug || 'general')
    .split('-')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function intentFromRow(row) {
  return {
    id: row.id,
    slug: row.slug,
    domain: row.domain,
    title: row.title,
    status: row.status,
    deliveryStatus: row.delivery_status,
    currentPhase: row.current_phase,
    deliveryStatePath: row.delivery_state_path,
    path: row.path,
    relationships: JSON.parse(row.relationships_json || '[]'),
  };
}

function executionInputs(database) {
  const intents = database.prepare(`
    SELECT id, slug, domain, title, status, delivery_status, current_phase,
      delivery_state_path, path, relationships_json
    FROM intents ORDER BY id
  `).all();
  const catalog = new Map(intents.map((row) => [row.id, intentFromRow(row)]));
  const current = new Date().toISOString();
  const leases = database.prepare(`
    SELECT id, work_item_id, task_id, owner_id, tool, run_id, status,
      acquired_at, heartbeat_at, expires_at, released_at, outcome
    FROM execution_leases WHERE status = 'active' AND expires_at > ?
  `).all(current).map((row) => ({
    id: row.id,
    workItemId: row.work_item_id,
    taskId: row.task_id,
    ownerId: row.owner_id,
    tool: row.tool,
    runId: row.run_id,
    status: row.status,
    acquiredAt: row.acquired_at,
    heartbeatAt: row.heartbeat_at,
    expiresAt: row.expires_at,
    releasedAt: row.released_at,
    outcome: row.outcome,
  }));
  const byWorkItem = new Map();
  for (const lease of leases) {
    if (!byWorkItem.has(lease.workItemId)) byWorkItem.set(lease.workItemId, []);
    byWorkItem.get(lease.workItemId).push(lease);
  }
  return { intents, catalog, leases: byWorkItem };
}

function rowToWorkItem(row) {
  return {
    id: row.id,
    intentId: row.intent_id,
    slug: row.slug,
    domain: row.domain,
    title: row.title,
    intentPath: row.intent_path,
    lane: row.lane,
    state: row.state,
    intentState: row.intent_state,
    completionPercent: row.completion_percent,
    priority: row.priority,
    currentSprint: Boolean(row.current_sprint),
    currentPhase: row.current_phase,
    blockedBy: row.blocked_by,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToEvent(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    workItemId: row.work_item_id,
    eventType: row.event_type,
    tool: row.tool,
    phaseKey: row.phase_key,
    summary: row.summary,
    details: row.details,
    requiresHuman: Boolean(row.requires_human),
    metadata: JSON.parse(row.metadata_json || '{}'),
    createdAt: row.created_at
  };
}

function rowToSession(row) {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    ownerId: row.owner_id,
    slug: row.slug,
    title: row.title,
    domain: row.domain,
    tool: row.tool,
    phaseKey: row.phase_key,
    status: row.status,
    summary: row.summary,
    awaitingHuman: Boolean(row.awaiting_human),
    question: row.question,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at,
    latestEventId: row.latest_event_id ?? null,
    latestEventType: row.latest_event_type ?? '',
    latestEventSummary: row.latest_event_summary ?? '',
    latestEventAt: row.latest_event_at ?? row.updated_at,
    eventCount: row.event_count ?? 0
  };
}

function withDatabase(projectRoot, supplied, operation) {
  const ownsDatabase = !supplied;
  const database = supplied ?? openRuntimeDatabase(projectRoot);
  try {
    return operation(database);
  } finally {
    if (ownsDatabase) database.close();
  }
}

export function syncWorkItems(projectRoot, suppliedDatabase = null) {
  return withDatabase(projectRoot, suppliedDatabase, (database) => {
    syncIntentIndex(projectRoot, database);
    const execution = executionInputs(database);
    const { intents } = execution;
    const insertItem = database.prepare(`
      INSERT INTO work_items (
        id, intent_id, slug, domain, title, intent_path, lane, state, intent_state,
        completion_percent, current_phase
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        intent_id = excluded.intent_id,
        slug = excluded.slug,
        domain = excluded.domain,
        title = excluded.title,
        intent_path = excluded.intent_path,
        updated_at = CASE
          WHEN work_items.title <> excluded.title OR work_items.domain <> excluded.domain OR work_items.intent_path <> excluded.intent_path
          THEN CURRENT_TIMESTAMP ELSE work_items.updated_at END
    `);
    const insertGroup = database.prepare(`
      INSERT INTO delivery_groups (slug, name, description)
      VALUES (?, ?, 'Derived from the project intent domain.')
      ON CONFLICT(slug) DO UPDATE SET name = excluded.name, updated_at = CURRENT_TIMESTAMP
    `);
    const findGroup = database.prepare('SELECT id FROM delivery_groups WHERE slug = ?');
    const linkGroup = database.prepare(`
      INSERT INTO group_items (group_id, work_item_id, position, source)
      VALUES (?, ?, ?, 'derived')
      ON CONFLICT(group_id, work_item_id) DO UPDATE SET position = excluded.position, source = excluded.source
    `);
    const clearDerivedGroups = database.prepare("DELETE FROM group_items WHERE work_item_id = ? AND source = 'derived'");
    const restoreCommittedState = database.prepare(`
      UPDATE work_items SET lane = ?, state = ?, intent_state = ?, completion_percent = ?,
        current_phase = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `);
    const supersedePrototypes = database.prepare(`
      UPDATE artefacts SET status = 'superseded'
      WHERE work_item_id = ? AND kind = 'prototype' AND status = 'active'
    `);
    const registerPrototype = database.prepare(`
      INSERT INTO artefacts (work_item_id, kind, path, title, status)
      VALUES (?, 'prototype', ?, ?, 'active')
      ON CONFLICT(work_item_id, kind, path) DO UPDATE SET
        title = excluded.title, status = 'active'
    `);

    // Evidence readers may open their own database connection. Derive before
    // taking the projection writer, avoiding self-contention and false stale
    // results. Canonical mutations revalidate under their intent ownership.
    const derivedItems = intents.map(intent => deriveExecutionState(projectRoot, intentFromRow(intent), {
      intentCatalog: execution.catalog,
      leases: execution.leases.get(intent.id) ?? [],
    }));
    database.exec('BEGIN IMMEDIATE;');
    try {
      intents.forEach((intent, index) => {
        const derived = derivedItems[index];
        const defaults = derived.projection;
        insertItem.run(
          intent.id,
          intent.id,
          intent.slug,
          intent.domain,
          intent.title,
          intent.path,
          defaults.lane,
          defaults.state,
          defaults.intentState,
          defaults.progress,
          defaults.phase
        );
        restoreCommittedState.run(
          defaults.lane,
          defaults.state,
          defaults.intentState,
          defaults.progress,
          defaults.phase,
          intent.id
        );
        insertGroup.run(intent.domain, groupName(intent.domain));
        clearDerivedGroups.run(intent.id);
        linkGroup.run(findGroup.get(intent.domain).id, intent.id, index);
        const deliveryRoot = resolve(projectPaths(projectRoot).buildRoot, intent.slug);
        const prototypeManifest = resolve(deliveryRoot, 'ui-design-assets/prototypes/manifest.json');
        if (existsSync(prototypeManifest)) {
          try {
            const manifest = validatePrototypeManifest(deliveryRoot);
            const prototypePath = relative(projectRoot, resolve(deliveryRoot, manifest.selected.path)).replaceAll('\\', '/');
            supersedePrototypes.run(intent.id);
            registerPrototype.run(intent.id, prototypePath, manifest.selected.title);
          } catch {
            // The UI Design gate reports invalid manifests; dashboard sync remains available.
          }
        }
      });
      database.exec(`
        DELETE FROM delivery_groups
        WHERE id NOT IN (SELECT DISTINCT group_id FROM group_items)
      `);
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
    return { count: intents.length };
  });
}

function collectionMaps(database) {
  const groups = new Map();
  for (const row of database.prepare(`
    SELECT gi.work_item_id, dg.id, dg.slug, dg.name, dg.status, dg.priority
    FROM group_items gi JOIN delivery_groups dg ON dg.id = gi.group_id
    ORDER BY dg.name
  `).all()) {
    if (!groups.has(row.work_item_id)) groups.set(row.work_item_id, []);
    groups.get(row.work_item_id).push({ id: row.id, slug: row.slug, name: row.name, status: row.status, priority: row.priority });
  }

  const artefacts = new Map();
  for (const row of database.prepare('SELECT * FROM artefacts ORDER BY kind, title, path').all()) {
    if (!artefacts.has(row.work_item_id)) artefacts.set(row.work_item_id, []);
    artefacts.get(row.work_item_id).push({
      id: row.id, kind: row.kind, path: row.path, title: row.title, status: row.status, createdAt: row.created_at
    });
  }

  const phases = new Map();
  for (const row of database.prepare('SELECT * FROM pipeline_phases ORDER BY id').all()) {
    if (!phases.has(row.work_item_id)) phases.set(row.work_item_id, []);
    phases.get(row.work_item_id).push({
      id: row.id,
      phaseKey: row.phase_key,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      artefactPath: row.artefact_path,
      iterationCount: row.iteration_count,
      notes: row.notes
    });
  }
  return { groups, artefacts, phases };
}

export function listWorkItems(projectRoot, options = {}) {
  return withDatabase(projectRoot, null, (database) => {
    syncWorkItems(projectRoot, database);
    const maps = collectionMaps(database);
    const execution = executionInputs(database);
    const query = String(options.query ?? '').trim().toLowerCase();
    const group = String(options.group ?? '').trim();
    const lane = String(options.lane ?? '').trim();
    const sprint = String(options.sprint ?? '').trim();
    return database.prepare('SELECT * FROM work_items ORDER BY priority, updated_at DESC, title COLLATE NOCASE').all()
      .map((row) => {
        const item = rowToWorkItem(row);
        return {
          ...item,
          groups: maps.groups.get(item.id) ?? [],
          artefacts: maps.artefacts.get(item.id) ?? [],
          phases: maps.phases.get(item.id) ?? [],
          execution: deriveExecutionState(projectRoot, execution.catalog.get(item.intentId), {
            intentCatalog: execution.catalog,
            leases: execution.leases.get(item.id) ?? [],
          }),
        };
      })
      .filter((item) => !lane || item.lane === lane)
      .filter((item) => !group || item.groups.some((candidate) => candidate.slug === group || String(candidate.id) === group))
      .filter((item) => sprint !== 'current' || item.currentSprint)
      .filter((item) => sprint !== 'backlog' || !item.currentSprint)
      .filter((item) => !query || `${item.id} ${item.slug} ${item.domain} ${item.title} ${item.state} ${item.currentPhase}`.toLowerCase().includes(query));
  });
}

export function listGroups(projectRoot) {
  return withDatabase(projectRoot, null, (database) => {
    syncWorkItems(projectRoot, database);
    return database.prepare(`
      SELECT dg.*, COUNT(gi.work_item_id) AS item_count,
        SUM(CASE WHEN wi.current_sprint = 1 THEN 1 ELSE 0 END) AS sprint_count
      FROM delivery_groups dg
      LEFT JOIN group_items gi ON gi.group_id = dg.id
      LEFT JOIN work_items wi ON wi.id = gi.work_item_id
      GROUP BY dg.id
      ORDER BY dg.name COLLATE NOCASE
    `).all().map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      status: row.status,
      priority: row.priority,
      itemCount: row.item_count,
      sprintCount: row.sprint_count
    }));
  });
}

export function auditOperationalState(projectRoot) {
  return withDatabase(projectRoot, null, (database) => {
    syncWorkItems(projectRoot, database);
    const rows = database.prepare(`
      SELECT i.id, i.slug, i.status AS intent_status, i.delivery_status,
        i.current_phase AS intent_phase, w.intent_state, w.state AS delivery_state,
        w.current_phase AS work_phase
      FROM intents i JOIN work_items w ON w.intent_id = i.id
      ORDER BY i.id
    `).all();
    const drift = rows.filter((row) => (
      row.intent_status !== row.intent_state
      || row.delivery_status !== row.delivery_state
      || row.intent_phase !== row.work_phase
    ));
    return {
      schema: 'ewai.operational-state-audit/v1',
      status: drift.length ? 'drift-detected' : 'consistent',
      checked: rows.length,
      drift
    };
  });
}

function findItem(database, reference) {
  const byId = database.prepare('SELECT * FROM work_items WHERE id = ?').get(reference);
  if (byId) return byId;
  const matches = database.prepare('SELECT * FROM work_items WHERE slug = ? ORDER BY id LIMIT 2').all(reference);
  if (matches.length > 1) throw new Error(`Ambiguous work item slug: ${reference}`);
  return matches[0];
}

function isWithin(root, path) {
  const rel = relative(root, path);
  return rel === '' || (rel && !rel.startsWith('..') && !isAbsolute(rel));
}

export function resolvePrototypeAsset(projectRoot, reference, artefactId, assetPath = '') {
  return withDatabase(projectRoot, null, (database) => {
    syncWorkItems(projectRoot, database);
    const item = findItem(database, reference);
    if (!item) return null;
    const artefact = database.prepare(`
      SELECT * FROM artefacts WHERE id = ? AND work_item_id = ? AND kind = 'prototype' AND status = 'active'
    `).get(Number(artefactId), item.id);
    if (!artefact) return null;
    const root = resolve(projectRoot);
    const source = isAbsolute(artefact.path) ? resolve(artefact.path) : resolve(root, artefact.path);
    if (!isWithin(root, source)) return null;
    const prototypeRoot = dirname(source);
    const target = assetPath ? resolve(prototypeRoot, assetPath) : source;
    if (!isWithin(root, target) || !isWithin(prototypeRoot, target) || !existsSync(target) || !statSync(target).isFile()) return null;
    return {
      path: target,
      artefact: { id: artefact.id, kind: artefact.kind, path: artefact.path, title: artefact.title, status: artefact.status },
      item: rowToWorkItem(item)
    };
  });
}

export function updateWorkItem(projectRoot, reference, input) {
  return withIntentMutation(projectRoot, reference, { action: 'update-projection', input, ownership: input.ownership }, () => updateOwnedWorkItem(projectRoot, reference, input));
}

function updateOwnedWorkItem(projectRoot, reference, input) {
  return withDatabase(projectRoot, null, (database) => {
    syncWorkItems(projectRoot, database);
    const item = findItem(database, reference);
    if (!item) throw new Error(`Unknown work item: ${reference}`);
    const allowed = {
      lane: 'lane',
      state: 'state',
      intentState: 'intent_state',
      completionPercent: 'completion_percent',
      priority: 'priority',
      currentSprint: 'current_sprint',
      currentPhase: 'current_phase',
      blockedBy: 'blocked_by',
      notes: 'notes'
    };
    const entries = Object.entries(input).filter(([key]) => allowed[key]);
    if (entries.some(([key, value]) => key === 'lane' && !lanes.includes(value))) {
      throw new Error(`Unsupported work item lane: ${input.lane}`);
    }
    if (entries.length) {
      const values = entries.map(([key, value]) => {
        if (key === 'currentSprint') return value ? 1 : 0;
        if (key === 'completionPercent') return Math.max(0, Math.min(100, Number(value)));
        return value;
      });
      assertIntentMutation(projectRoot, reference);
      database.prepare(`UPDATE work_items SET ${entries.map(([key]) => `${allowed[key]} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(...values, item.id);
    }
    return rowToWorkItem(findItem(database, item.id));
  });
}

export function setPhase(projectRoot, reference, phaseKey, input = {}) {
  return withIntentMutation(projectRoot, reference, { action: 'update-phase-projection', phase: phaseKey, input, ownership: input.ownership }, () => setOwnedPhase(projectRoot, reference, phaseKey, input));
}

function setOwnedPhase(projectRoot, reference, phaseKey, input) {
  return withDatabase(projectRoot, null, (database) => {
    syncWorkItems(projectRoot, database);
    const item = findItem(database, reference);
    if (!item) throw new Error(`Unknown work item: ${reference}`);
    const existing = database.prepare(`
      SELECT status, iteration_count FROM pipeline_phases WHERE work_item_id = ? AND phase_key = ?
    `).get(item.id, phaseKey);
    assertIntentMutation(projectRoot, reference);
    database.prepare(`
      INSERT INTO pipeline_phases (work_item_id, phase_key, status, started_at, completed_at, artefact_path, iteration_count, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(work_item_id, phase_key) DO UPDATE SET
        status = excluded.status,
        started_at = COALESCE(excluded.started_at, pipeline_phases.started_at),
        completed_at = COALESCE(excluded.completed_at, pipeline_phases.completed_at),
        artefact_path = CASE WHEN excluded.artefact_path = '' THEN pipeline_phases.artefact_path ELSE excluded.artefact_path END,
        iteration_count = excluded.iteration_count,
        notes = CASE WHEN excluded.notes = '' THEN pipeline_phases.notes ELSE excluded.notes END
    `).run(
      item.id,
      phaseKey,
      input.status ?? existing?.status ?? 'pending',
      input.startedAt ?? null,
      input.completedAt ?? null,
      input.artefactPath ?? '',
      input.iterationCount ?? existing?.iteration_count ?? 0,
      input.notes ?? ''
    );
    database.prepare('UPDATE work_items SET current_phase = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(phaseKey, item.id);
    return database.prepare('SELECT * FROM pipeline_phases WHERE work_item_id = ? AND phase_key = ?').get(item.id, phaseKey);
  });
}

export function addArtefact(projectRoot, reference, input) {
  return withDatabase(projectRoot, null, (database) => {
    syncWorkItems(projectRoot, database);
    const item = findItem(database, reference);
    if (!item) throw new Error(`Unknown work item: ${reference}`);
    database.prepare(`
      INSERT INTO artefacts (work_item_id, kind, path, title, status)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(work_item_id, kind, path) DO UPDATE SET
        title = excluded.title, status = excluded.status
    `).run(item.id, input.kind ?? 'reference', input.path, input.title ?? input.path, input.status ?? 'active');
    return database.prepare('SELECT * FROM artefacts WHERE work_item_id = ? AND kind = ? AND path = ?').get(item.id, input.kind ?? 'reference', input.path);
  });
}

export function listActivityEvents(projectRoot, reference, options = {}) {
  return withDatabase(projectRoot, null, (database) => {
    syncWorkItems(projectRoot, database);
    const item = findItem(database, reference);
    if (!item) throw new Error(`Unknown work item: ${reference}`);
    return database.prepare(`
      SELECT * FROM activity_events WHERE work_item_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
    `).all(item.id, Number(options.limit ?? 100)).map(rowToEvent);
  });
}

export function listActiveSessions(projectRoot, options = {}) {
  return withDatabase(projectRoot, null, (database) => {
    syncWorkItems(projectRoot, database);
    const includeCompleted = options.includeCompleted !== false;
    return database.prepare(`
      SELECT s.*, w.slug, w.title, w.domain,
        (SELECT e.id FROM activity_events e WHERE e.work_item_id = s.work_item_id ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS latest_event_id,
        (SELECT e.event_type FROM activity_events e WHERE e.work_item_id = s.work_item_id ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS latest_event_type,
        (SELECT e.summary FROM activity_events e WHERE e.work_item_id = s.work_item_id ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS latest_event_summary,
        (SELECT e.created_at FROM activity_events e WHERE e.work_item_id = s.work_item_id ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS latest_event_at,
        (SELECT COUNT(*) FROM activity_events e WHERE e.work_item_id = s.work_item_id) AS event_count
      FROM active_sessions s JOIN work_items w ON w.id = s.work_item_id
      WHERE (? = 1 OR s.status <> 'completed')
      ORDER BY s.updated_at DESC
    `).all(includeCompleted ? 1 : 0).map(rowToSession);
  });
}

function eventStatus(eventType, fallback = 'running') {
  if (eventType === 'question') return 'awaiting-human';
  if (eventType === 'blocked') return 'blocked';
  if (['completed', 'finish'].includes(eventType)) return 'completed';
  if (eventType === 'stale') return 'stale';
  return fallback;
}

function recordActivity(projectRoot, reference, input, mode) {
  return withDatabase(projectRoot, null, (database) => {
    syncWorkItems(projectRoot, database);
    const item = findItem(database, reference);
    if (!item) throw new Error(`Unknown work item: ${reference}`);
    const eventType = mode === 'start' ? 'start' : mode === 'finish' ? (input.status === 'completed' ? 'completed' : 'finish') : input.eventType ?? 'progress';
    const status = mode === 'start' ? 'running' : mode === 'finish' ? input.status ?? 'completed' : input.status ?? eventStatus(eventType);
    const requiresHuman = input.requiresHuman ?? eventType === 'question';
    const endedAt = mode === 'finish' || status === 'completed' ? new Date().toISOString() : null;
    let session;
    let event;
    database.exec('BEGIN IMMEDIATE;');
    try {
      const existingSession = database.prepare('SELECT * FROM active_sessions WHERE work_item_id = ?').get(item.id);
      if (mode === 'start') assertIntentMutation(projectRoot, reference, database);
      if (mode === 'start' && existingSession && existingSession.ended_at === null) {
        const requestedOwner = String(input.ownerId ?? '').trim();
        const requestedTool = String(input.tool ?? '').trim();
        const ownerConflict = existingSession.owner_id && requestedOwner && existingSession.owner_id !== requestedOwner;
        const toolConflict = existingSession.tool && requestedTool && existingSession.tool !== requestedTool;
        if (ownerConflict || toolConflict) {
          throw new Error(`Active session is owned by ${existingSession.owner_id || existingSession.tool}; finish or hand off that session before starting another.`);
        }
      }
      if (mode !== 'start' && existingSession && existingSession.ended_at === null) {
        const requestedOwner = String(input.ownerId ?? '').trim();
        if (existingSession.owner_id && requestedOwner && existingSession.owner_id !== requestedOwner) {
          throw new Error(`Active session is owned by ${existingSession.owner_id}; this update requires that owner or an explicit handoff.`);
        }
      }
      database.prepare(`
        INSERT INTO active_sessions (work_item_id, owner_id, tool, phase_key, status, summary, awaiting_human, question, ended_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(work_item_id) DO UPDATE SET
          owner_id = CASE WHEN excluded.owner_id = '' THEN active_sessions.owner_id ELSE excluded.owner_id END,
          tool = CASE WHEN excluded.tool = '' THEN active_sessions.tool ELSE excluded.tool END,
          phase_key = CASE WHEN excluded.phase_key = '' THEN active_sessions.phase_key ELSE excluded.phase_key END,
          status = excluded.status,
          summary = CASE WHEN excluded.summary = '' THEN active_sessions.summary ELSE excluded.summary END,
          awaiting_human = excluded.awaiting_human,
          question = excluded.question,
          started_at = CASE WHEN active_sessions.ended_at IS NOT NULL AND excluded.ended_at IS NULL THEN CURRENT_TIMESTAMP ELSE active_sessions.started_at END,
          updated_at = CURRENT_TIMESTAMP,
          ended_at = excluded.ended_at
      `).run(
        item.id,
        input.ownerId ?? '',
        input.tool ?? '',
        input.phaseKey ?? '',
        status,
        input.summary ?? '',
        requiresHuman ? 1 : 0,
        requiresHuman ? input.question ?? input.summary ?? '' : '',
        endedAt
      );
      session = database.prepare('SELECT * FROM active_sessions WHERE work_item_id = ?').get(item.id);
      event = database.prepare(`
        INSERT INTO activity_events (session_id, work_item_id, event_type, tool, phase_key, summary, details, requires_human, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        session.id,
        item.id,
        eventType,
        input.tool ?? session.tool,
        input.phaseKey ?? session.phase_key,
        input.summary ?? (mode === 'start' ? 'Started active work.' : mode === 'finish' ? 'Finished active work.' : ''),
        input.details ?? '',
        requiresHuman ? 1 : 0,
        JSON.stringify(input.metadata ?? {})
      );
      database.prepare('UPDATE work_items SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(item.id);
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
    const insertedEvent = database.prepare('SELECT * FROM activity_events WHERE id = ?').get(event.lastInsertRowid);
    const eventCount = database.prepare('SELECT COUNT(*) AS count FROM activity_events WHERE work_item_id = ?').get(item.id).count;
    return {
      session: rowToSession({
        ...session,
        slug: item.slug,
        title: item.title,
        domain: item.domain,
        latest_event_id: insertedEvent.id,
        latest_event_type: insertedEvent.event_type,
        latest_event_summary: insertedEvent.summary,
        latest_event_at: insertedEvent.created_at,
        event_count: eventCount
      }),
      event: rowToEvent(insertedEvent)
    };
  });
}

export function startActiveSession(projectRoot, reference, input = {}) {
  return withIntentMutation(projectRoot, reference, { action: 'start-session', input, ownership: input.ownership }, () => recordActivity(projectRoot, reference, input, 'start'));
}

export function addActivityEvent(projectRoot, reference, input = {}) {
  return recordActivity(projectRoot, reference, input, 'event');
}

export function finishActiveSession(projectRoot, reference, input = {}) {
  return recordActivity(projectRoot, reference, input, 'finish');
}

export function readWorkItemView(projectRoot, reference) {
  const item = listWorkItems(projectRoot).find((candidate) => candidate.id === reference || candidate.slug === reference);
  if (!item) return null;
  return {
    item,
    intent: readRuntimeIntent(projectRoot, item.intentId),
    phases: item.phases,
    artefacts: item.artefacts,
    activity: {
      session: listActiveSessions(projectRoot).find((candidate) => candidate.workItemId === item.id) ?? null,
      events: listActivityEvents(projectRoot, item.id)
    }
  };
}
