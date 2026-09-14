import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openRuntimeDatabase } from './database.mjs';
import { syncWorkItems } from './work.mjs';
import { atomicJson } from '../delivery-documents.mjs';
import { projectPaths } from '../paths.mjs';

function resolveWorkItem(database, reference) {
  const exact = database.prepare('SELECT id FROM work_items WHERE id = ?').get(reference);
  if (exact) return exact;
  const matches = database.prepare('SELECT id FROM work_items WHERE slug = ? ORDER BY id').all(reference);
  if (matches.length > 1) throw new Error(`Ambiguous work item slug: ${reference}`);
  if (!matches.length) throw new Error(`Unknown work item: ${reference}`);
  return matches[0];
}

export function syncDurableCommandRuns(projectRoot, suppliedDatabase = null) {
  const ownsDatabase = !suppliedDatabase;
  const database = suppliedDatabase ?? openRuntimeDatabase(projectRoot);
  try {
    syncWorkItems(projectRoot, database);
    const buildRoot = projectPaths(projectRoot).buildRoot;
    if (!existsSync(buildRoot)) return { count: 0 };
    const upsert = database.prepare(`
      INSERT INTO command_runs (
        work_item_id, run_uuid, phase_key, tool, command, mode, status,
        started_at, completed_at, exit_code, summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_uuid) DO UPDATE SET
        work_item_id = excluded.work_item_id,
        phase_key = excluded.phase_key,
        tool = excluded.tool,
        command = excluded.command,
        mode = excluded.mode,
        status = excluded.status,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        exit_code = excluded.exit_code,
        summary = excluded.summary
    `);
    let count = 0;
    for (const slugEntry of readdirSync(buildRoot, { withFileTypes: true })) {
      if (!slugEntry.isDirectory()) continue;
      const item = database.prepare('SELECT id FROM work_items WHERE slug = ? ORDER BY id LIMIT 1').get(slugEntry.name);
      if (!item) continue;
      const runsRoot = resolve(buildRoot, slugEntry.name, 'runs');
      if (!existsSync(runsRoot)) continue;
      for (const entry of readdirSync(runsRoot, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        let run;
        try {
          run = JSON.parse(readFileSync(resolve(runsRoot, entry.name), 'utf8'));
        } catch {
          continue;
        }
        if (run.schema !== 'ewai.delivery-run/v1' || !run.id || run.slug !== slugEntry.name) continue;
        upsert.run(
          item.id,
          run.id,
          run.phase ?? '',
          run.tool ?? '',
          `ewai delivery ${run.mode === 'resume' ? 'resume' : 'begin'} ${run.slug}`,
          run.mode ?? 'normal',
          run.status ?? 'running',
          run.startedAt ?? new Date().toISOString(),
          run.completedAt ?? null,
          ['failed', 'blocked'].includes(run.status) ? 1 : run.completedAt ? 0 : null,
          run.summary ?? ''
        );
        count += 1;
      }
    }
    return { count };
  } finally {
    if (ownsDatabase) database.close();
  }
}

export function startCommandRun(projectRoot, reference, input) {
  const database = openRuntimeDatabase(projectRoot);
  try {
    syncWorkItems(projectRoot, database);
    const item = resolveWorkItem(database, reference);
    database.prepare(`
      INSERT INTO command_runs (
        work_item_id, run_uuid, phase_key, action_id, tool, command, mode,
        status, started_at, summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)
      ON CONFLICT(run_uuid) DO UPDATE SET
        work_item_id = excluded.work_item_id,
        phase_key = excluded.phase_key,
        action_id = excluded.action_id,
        tool = excluded.tool,
        command = excluded.command,
        mode = excluded.mode,
        status = 'running',
        started_at = excluded.started_at,
        completed_at = NULL,
        exit_code = NULL,
        summary = excluded.summary
    `).run(
      item.id,
      input.runUuid,
      input.phaseKey ?? '',
      input.actionId ?? '',
      input.tool ?? '',
      input.command ?? '',
      input.mode ?? 'normal',
      input.startedAt ?? new Date().toISOString(),
      input.summary ?? ''
    );
    return database.prepare('SELECT * FROM command_runs WHERE run_uuid = ?').get(input.runUuid);
  } finally {
    database.close();
  }
}

export function finishCommandRun(projectRoot, runUuid, input = {}) {
  const database = openRuntimeDatabase(projectRoot);
  try {
    syncDurableCommandRuns(projectRoot, database);
    const run = database.prepare('SELECT * FROM command_runs WHERE run_uuid = ?').get(runUuid);
    if (!run) throw new Error(`Unknown EWAI command run: ${runUuid}`);
    database.prepare(`
      UPDATE command_runs SET
        status = ?, completed_at = ?, exit_code = ?, summary = ?
      WHERE run_uuid = ?
    `).run(
      input.status ?? 'completed',
      input.completedAt ?? new Date().toISOString(),
      input.exitCode ?? 0,
      input.summary ?? run.summary,
      runUuid
    );
    return database.prepare('SELECT * FROM command_runs WHERE run_uuid = ?').get(runUuid);
  } finally {
    database.close();
  }
}

export function listCommandRuns(projectRoot, reference = '') {
  const database = openRuntimeDatabase(projectRoot);
  try {
    syncDurableCommandRuns(projectRoot, database);
    if (!reference) return database.prepare('SELECT * FROM command_runs ORDER BY started_at DESC, id DESC').all();
    const item = resolveWorkItem(database, reference);
    return database.prepare('SELECT * FROM command_runs WHERE work_item_id = ? ORDER BY started_at DESC, id DESC').all(item.id);
  } finally {
    database.close();
  }
}

export function markStaleCommandRuns(projectRoot, options = {}) {
  const database = openRuntimeDatabase(projectRoot);
  try {
    syncDurableCommandRuns(projectRoot, database);
    const hours = Math.max(1, Number(options.hours ?? 6));
    const threshold = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const runs = database.prepare(`
      SELECT r.*, w.slug FROM command_runs r
      LEFT JOIN work_items w ON w.id = r.work_item_id
      WHERE r.status = 'running' AND r.started_at < ?
      ORDER BY r.started_at
    `).all(threshold);
    const completedAt = new Date().toISOString();
    const summary = options.summary || `Marked stale after more than ${hours} hour(s) without completion.`;
    for (const run of runs) {
      database.prepare(`
        UPDATE command_runs SET status = 'stale', completed_at = ?, exit_code = 1, summary = ?
        WHERE run_uuid = ?
      `).run(completedAt, summary, run.run_uuid);
      if (!run.slug) continue;
      const path = resolve(projectPaths(projectRoot).buildRoot, run.slug, 'runs', `${run.run_uuid}.json`);
      if (!existsSync(path)) continue;
      const durable = JSON.parse(readFileSync(path, 'utf8'));
      durable.status = 'stale';
      durable.completedAt = completedAt;
      durable.summary = summary;
      atomicJson(path, durable);
    }
    return { schema: 'ewai.stale-runs/v1', threshold, hours, count: runs.length, runs: runs.map((run) => run.run_uuid) };
  } finally {
    database.close();
  }
}
