import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deriveExecutionState } from '../execution-state.mjs';
import { dependencyRequirementBlockers } from '../intent-dependencies.mjs';
import { validateTaskReport } from '../task-graph.mjs';
import { projectPaths } from '../paths.mjs';
import { openRuntimeDatabase } from './database.mjs';
import { syncWorkItems } from './work.mjs';

const defaultDurationMs = 15 * 60 * 1000;
const maximumDurationMs = 24 * 60 * 60 * 1000;

function required(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`Execution lease requires ${label}.`);
  return normalized;
}

function duration(value) {
  const milliseconds = Number(value ?? defaultDurationMs);
  if (!Number.isInteger(milliseconds) || milliseconds < 1_000 || milliseconds > maximumDurationMs) {
    throw new Error(`Execution lease duration must be between 1000 and ${maximumDurationMs} milliseconds.`);
  }
  return milliseconds;
}

function timestamp(value = new Date()) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowToLease(row) {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    taskId: row.task_id,
    ownerId: row.owner_id,
    tool: row.tool,
    runId: row.run_id,
    token: row.token,
    status: row.status,
    acquiredAt: row.acquired_at,
    heartbeatAt: row.heartbeat_at,
    expiresAt: row.expires_at,
    releasedAt: row.released_at,
    outcome: row.outcome,
  };
}

function rowToIntent(row) {
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

function findWorkItem(database, reference) {
  const direct = database.prepare('SELECT * FROM work_items WHERE id = ?').get(reference);
  if (direct) return direct;
  const matches = database.prepare('SELECT * FROM work_items WHERE slug = ? ORDER BY id LIMIT 2').all(reference);
  if (matches.length > 1) throw new Error(`Ambiguous work item slug: ${reference}`);
  if (!matches.length) throw new Error(`Unknown work item: ${reference}`);
  return matches[0];
}

function expireStale(database, at) {
  database.prepare(`
    UPDATE execution_leases
    SET status = 'expired', released_at = ?, outcome = CASE WHEN outcome = '' THEN 'lease-expired' ELSE outcome END
    WHERE status = 'active' AND expires_at <= ?
  `).run(at, at);
}

function executionReadiness(projectRoot, database, item, taskId) {
  const intentCatalog = new Map(database.prepare('SELECT * FROM intents ORDER BY id').all().map((row) => {
    const intent = rowToIntent(row);
    return [intent.id, intent];
  }));
  const intent = intentCatalog.get(item.intent_id);
  if (!intent) throw new Error(`Cannot lease ${taskId}: intent projection ${item.intent_id} does not exist.`);
  const leases = database.prepare(`
    SELECT id, work_item_id, task_id, owner_id, tool, run_id, status,
      acquired_at, heartbeat_at, expires_at, released_at, outcome
    FROM execution_leases WHERE work_item_id = ? AND status = 'active' AND expires_at > ?
  `).all(item.id, new Date().toISOString()).map((lease) => ({
    id: lease.id,
    workItemId: lease.work_item_id,
    taskId: lease.task_id,
    ownerId: lease.owner_id,
    tool: lease.tool,
    runId: lease.run_id,
    status: lease.status,
    acquiredAt: lease.acquired_at,
    heartbeatAt: lease.heartbeat_at,
    expiresAt: lease.expires_at,
    releasedAt: lease.released_at,
    outcome: lease.outcome,
  }));
  const execution = deriveExecutionState(projectRoot, intent, { leases, intentCatalog });
  if (!execution.valid) {
    const reasons = execution.blockers.map((blocker) => blocker.message).join('; ');
    throw new Error(`Cannot lease ${taskId}: delivery evidence is invalid or inconsistent${reasons ? `: ${reasons}` : '.'}`);
  }
  const dependencyBlockers = dependencyRequirementBlockers(projectRoot, intent, intentCatalog, 'build');
  if (dependencyBlockers.length) {
    throw new Error(`Cannot lease ${taskId}: ${dependencyBlockers.map((blocker) => blocker.message).join('; ')}`);
  }
  const task = execution.tasks.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`Cannot lease ${taskId}: task does not exist in task-graph.json.`);
  return { execution, task };
}

function withDatabase(projectRoot, operation) {
  const database = openRuntimeDatabase(projectRoot);
  try {
    syncWorkItems(projectRoot, database);
    return operation(database);
  } finally {
    database.close();
  }
}

export function acquireExecutionLease(projectRoot, reference, input = {}) {
  const taskId = required(input.taskId, 'taskId');
  const ownerId = required(input.ownerId, 'ownerId');
  const tool = String(input.tool ?? '').trim();
  const runId = required(input.runId, 'runId');
  const at = timestamp(input.now);
  const expiresAt = timestamp(new Date(new Date(at).getTime() + duration(input.durationMs)));

  return withDatabase(projectRoot, (database) => {
    const item = findWorkItem(database, reference);
    const readiness = executionReadiness(projectRoot, database, item, taskId);
    database.exec('BEGIN IMMEDIATE;');
    try {
      expireStale(database, at);
      const existing = database.prepare(`
        SELECT * FROM execution_leases WHERE work_item_id = ? AND task_id = ? AND status = 'active'
      `).get(item.id, taskId);
      if (existing) {
        if (existing.owner_id !== ownerId || existing.run_id !== runId || existing.tool !== tool) {
          throw new Error(`${taskId} is already leased by ${existing.owner_id} (${existing.tool || 'unknown tool'}).`);
        }
        database.prepare(`
          UPDATE execution_leases SET heartbeat_at = ?, expires_at = ? WHERE id = ?
        `).run(at, expiresAt, existing.id);
        const renewed = database.prepare('SELECT * FROM execution_leases WHERE id = ?').get(existing.id);
        database.exec('COMMIT;');
        return rowToLease(renewed);
      }

      if (!readiness.execution.actions.acquireTask.permitted || readiness.task.status !== 'ready') {
        const reason = readiness.execution.actions.acquireTask.blockers[0]?.message ?? `task state is ${readiness.task.status}`;
        throw new Error(`Cannot lease ${taskId}: ${reason}`);
      }

      const activeCount = database.prepare(`
        SELECT COUNT(*) AS count FROM execution_leases WHERE work_item_id = ? AND status = 'active'
      `).get(item.id).count;
      if (activeCount >= readiness.execution.tasks.maxParallelTasks) {
        throw new Error(`Cannot lease ${taskId}: the task graph allows at most ${readiness.execution.tasks.maxParallelTasks} parallel task(s).`);
      }

      const id = randomUUID();
      const token = randomUUID();
      database.prepare(`
        INSERT INTO execution_leases (
          id, work_item_id, task_id, owner_id, tool, run_id, token,
          status, acquired_at, heartbeat_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
      `).run(id, item.id, taskId, ownerId, tool, runId, token, at, at, expiresAt);
      const created = database.prepare('SELECT * FROM execution_leases WHERE id = ?').get(id);
      database.exec('COMMIT;');
      return rowToLease(created);
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  });
}

export function heartbeatExecutionLease(projectRoot, leaseId, input = {}) {
  const token = required(input.token, 'token');
  const at = timestamp(input.now);
  const expiresAt = timestamp(new Date(new Date(at).getTime() + duration(input.durationMs)));
  return withDatabase(projectRoot, (database) => {
    database.exec('BEGIN IMMEDIATE;');
    try {
      expireStale(database, at);
      const lease = database.prepare('SELECT * FROM execution_leases WHERE id = ?').get(leaseId);
      if (!lease) throw new Error(`Unknown execution lease: ${leaseId}`);
      if (lease.token !== token) throw new Error('Execution lease token does not match.');
      if (lease.status !== 'active') throw new Error(`Execution lease is ${lease.status}, not active.`);
      database.prepare('UPDATE execution_leases SET heartbeat_at = ?, expires_at = ? WHERE id = ?')
        .run(at, expiresAt, leaseId);
      const updated = database.prepare('SELECT * FROM execution_leases WHERE id = ?').get(leaseId);
      database.exec('COMMIT;');
      return rowToLease(updated);
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  });
}

export function releaseExecutionLease(projectRoot, leaseId, input = {}) {
  const token = required(input.token, 'token');
  const outcome = String(input.outcome ?? 'released').trim();
  const at = timestamp(input.now);
  return withDatabase(projectRoot, (database) => {
    database.exec('BEGIN IMMEDIATE;');
    try {
      expireStale(database, at);
      const lease = database.prepare('SELECT * FROM execution_leases WHERE id = ?').get(leaseId);
      if (!lease) throw new Error(`Unknown execution lease: ${leaseId}`);
      if (lease.token !== token) throw new Error('Execution lease token does not match.');
      if (lease.status !== 'active') throw new Error(`Execution lease is ${lease.status}, not active.`);
      if (outcome === 'completed') {
        const item = database.prepare('SELECT slug FROM work_items WHERE id = ?').get(lease.work_item_id);
        const deliveryRoot = resolve(projectPaths(projectRoot).buildRoot, item.slug);
        const graph = JSON.parse(readFileSync(resolve(deliveryRoot, 'task-graph.json'), 'utf8'));
        const task = graph.tasks?.find((candidate) => candidate.id === lease.task_id);
        if (!task) throw new Error(`Cannot complete ${lease.task_id}: task is missing from task-graph.json.`);
        const report = validateTaskReport(deliveryRoot, task);
        if (report.status !== 'complete') {
          throw new Error(`Cannot complete ${lease.task_id}: task report is incomplete (${report.errors.join('; ')}).`);
        }
      }
      database.prepare(`
        UPDATE execution_leases SET status = 'released', released_at = ?, outcome = ? WHERE id = ?
      `).run(at, outcome, leaseId);
      const released = database.prepare('SELECT * FROM execution_leases WHERE id = ?').get(leaseId);
      database.exec('COMMIT;');
      return rowToLease(released);
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  });
}

export function listExecutionLeases(projectRoot, options = {}) {
  const at = timestamp(options.now);
  return withDatabase(projectRoot, (database) => {
    database.exec('BEGIN IMMEDIATE;');
    try {
      expireStale(database, at);
      const rows = database.prepare(`
        SELECT * FROM execution_leases
        WHERE (? = 0 OR status = 'active')
          AND (? = '' OR work_item_id = ?)
        ORDER BY acquired_at DESC
      `).all(options.activeOnly === true ? 1 : 0, options.workItemId ?? '', options.workItemId ?? '');
      database.exec('COMMIT;');
      return rows.map((row) => {
        const lease = rowToLease(row);
        if (options.includeTokens !== true) delete lease.token;
        return lease;
      });
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  });
}

// Conductor recovery deliberately does not require the private capability token: it is
// scoped to one durable run ID and can only abandon leases, never complete work.
export function abandonExecutionLeasesForRun(projectRoot, runId, input = {}) {
  const requiredRunId = required(runId, 'runId');
  const at = timestamp(input.now);
  const outcome = String(input.outcome ?? 'conductor-recovered').trim();
  return withDatabase(projectRoot, (database) => {
    database.exec('BEGIN IMMEDIATE;');
    try {
      expireStale(database, at);
      const rows = database.prepare(`
        SELECT * FROM execution_leases WHERE run_id = ? AND status = 'active'
      `).all(requiredRunId);
      database.prepare(`
        UPDATE execution_leases SET status = 'released', released_at = ?, outcome = ?
        WHERE run_id = ? AND status = 'active'
      `).run(at, outcome, requiredRunId);
      database.exec('COMMIT;');
      return rows.map((row) => ({ ...rowToLease(row), status: 'released', releasedAt: at, outcome }));
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  });
}
