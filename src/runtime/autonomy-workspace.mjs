import { constants, existsSync, lstatSync, openSync, closeSync, fstatSync, readFileSync, writeFileSync, fsyncSync, mkdirSync, readdirSync, unlinkSync, realpathSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, relative, dirname, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import YAML from 'yaml';
import { projectPaths } from '../paths.mjs';
import { deriveExecutionState } from '../execution-state.mjs';
import { ORGANISATION_POLICY_BASELINE_PATH } from '../organisation-policies.mjs';

export function autonomyError(code, statusCode = 409) {
  const error = new Error(`Autonomy cannot continue: ${code}. Refresh the preview or resolve the recorded prerequisite.`);
  error.code = code; error.statusCode = statusCode; error.autonomyError = true;
  throw error;
}
export function autonomyGuard(operation) {
  try { return operation(); } catch (error) {
    if (error.autonomyError) throw error;
    autonomyError('autonomy-evidence-unavailable');
  }
}
export function autonomyDigest(value) {
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  return 'sha256:' + createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(stable(value))).digest('hex');
}
export function autonomyPaths(root) {
  const realRoot = realpathSync(root);
  const locatorPath = resolve(realRoot, '.ewai-pipeline/project.json');
  safeAutonomyPath(realRoot, locatorPath);
  let locatorText = '', locator = {};
  if (existsSync(locatorPath)) {
    locatorText = readAutonomyFile(realRoot, locatorPath);
    try { locator = JSON.parse(locatorText); } catch { autonomyError('autonomy-project-invalid', 422); }
    if (!locator || typeof locator !== 'object' || Array.isArray(locator)
      || locator.schema !== 'ewai.runtime-project/v1'
      || locator.specsRoot !== undefined && (typeof locator.specsRoot !== 'string' || !locator.specsRoot.trim())
      || locator.projectRoot !== undefined && resolve(locator.projectRoot) !== realRoot) autonomyError('autonomy-project-invalid', 422);
  }
  const paths = projectPaths(realRoot, { specsRoot: locator.specsRoot ?? 'SPECS' });
  return { ...paths, authorityRoot: resolve(paths.specsRoot, '3.Evidence/autonomy'),
    controlRoot: resolve(paths.runtimeRoot, 'runtime/autonomy'), locatorDigest: autonomyDigest(locatorText) };
}
// Check every component, including dangling links. The local OS user remains trusted.
export function safeAutonomyPath(root, path) {
  const rel = relative(root, path);
  if (rel.startsWith('..') || isAbsolute(rel)) autonomyError('autonomy-unsafe-path', 403);
  let cursor = root;
  for (const part of rel.split('/').filter(Boolean)) {
    cursor = resolve(cursor, part);
    let stat; try { stat = lstatSync(cursor); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))) autonomyError('autonomy-unsafe-path', 403);
  }
}
export function readAutonomyFile(root, path) {
  return readAutonomyBytes(root, path).toString('utf8');
}
function readAutonomyBytes(root, path, limit = 2 * 1024 * 1024) {
  safeAutonomyPath(root, path);
  const before = lstatSync(path);
  if (!before.isFile() || before.size > limit) autonomyError('autonomy-invalid-evidence', 422);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (before.ino !== opened.ino || before.dev !== opened.dev) autonomyError('autonomy-evidence-changed');
    const bytes = readFileSync(fd), after = fstatSync(fd);
    if (bytes.length > limit || after.mtimeMs !== opened.mtimeMs || after.size !== opened.size) autonomyError('autonomy-evidence-changed');
    return bytes;
  } finally { closeSync(fd); }
}
export function autonomyFiles(root, directory) {
  safeAutonomyPath(root, directory);
  if (!existsSync(directory)) return [];
  const files = [];
  const visit = (dir, depth) => {
    if (depth > 20 || files.length > 10000) autonomyError('autonomy-evidence-limit', 413);
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(dir, entry.name); safeAutonomyPath(root, path);
      if (entry.isDirectory()) visit(path, depth + 1);
      else if (entry.isFile()) files.push(path);
      else autonomyError('autonomy-unsafe-path', 403);
    }
  };
  visit(directory, 0); return files;
}
export function writeAutonomyRecord(root, path, value) {
  safeAutonomyPath(root, path); mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  safeAutonomyPath(root, path);
  const text = JSON.stringify(value, null, 2) + '\n';
  if (existsSync(path)) {
    if (readAutonomyFile(root, path) !== text) autonomyError('autonomy-record-conflict');
    return;
  }
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  const directory = openSync(dirname(path), constants.O_RDONLY);
  try { fsyncSync(directory); } finally { closeSync(directory); }
}
export function withAutonomyLock(paths, operation) {
  safeAutonomyPath(paths.projectRoot, paths.controlRoot); mkdirSync(paths.controlRoot, { recursive: true, mode: 0o700 });
  const path = resolve(paths.controlRoot, 'authority.lock'); let fd;
  try {
    try { fd = openSync(path, 'wx', 0o600); } catch { autonomyError('autonomy-authority-busy'); }
    return operation();
  } finally { if (fd !== undefined) { closeSync(fd); unlinkSync(path); } }
}
function operationalSnapshot(paths) {
  const path = resolve(paths.runtimeRoot, 'data/pipeline.sqlite'); safeAutonomyPath(paths.projectRoot, path);
  if (!existsSync(path)) return { priorities: new Map(), owners: [], leases: [] };
  // SQLite readOnly still creates WAL/SHM files. Query a verified private copy so
  // shadow does not mutate the project or recover its disposable projection.
  const temporary = mkdtempSync(resolve(tmpdir(), 'ewai-autonomy-snapshot-'));
  let db;
  try {
    const sources = [path, `${path}-wal`].filter(file => existsSync(file));
    const signatures = sources.map(file => {
      safeAutonomyPath(paths.projectRoot, file);
      const before = lstatSync(file);
      if (before.size > 128 * 1024 * 1024) autonomyError('autonomy-evidence-limit', 413);
      const bytes = readFileSync(file), after = lstatSync(file);
      if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) autonomyError('autonomy-evidence-changed');
      writeFileSync(resolve(temporary, file === path ? 'snapshot.sqlite' : 'snapshot.sqlite-wal'), bytes, { flag: 'wx', mode: 0o600 });
      return [file, after];
    });
    if (existsSync(`${path}-wal`) !== sources.includes(`${path}-wal`)) autonomyError('autonomy-evidence-changed');
    for (const [file, before] of signatures) {
      const after = lstatSync(file);
      if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) autonomyError('autonomy-evidence-changed');
    }
    db = new DatabaseSync(resolve(temporary, 'snapshot.sqlite'), { readOnly: true });
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    const priorities = tables.has('work_items') ? new Map(db.prepare('SELECT intent_id, priority FROM work_items').all().map(row => [row.intent_id, row.priority])) : new Map();
    const owners = tables.has('active_sessions') ? db.prepare("SELECT work_item_id, status FROM active_sessions WHERE status NOT IN ('completed','cancelled')").all() : [];
    const leases = tables.has('execution_leases') ? db.prepare("SELECT work_item_id, task_id FROM execution_leases WHERE status='active'").all() : [];
    return { priorities, owners, leases };
  } finally { db?.close(); rmSync(temporary, { recursive: true, force: true }); }
}
export const AUTONOMY_PHASES = Object.freeze(['ideate', 'intent', 'reconcile', 'ui-design', 'plan', 'pattern-validation', 'test-plan',
  'validate-external-plan', 'validate-external-test-plan', 'fit-check', 'build', 'standards-sweep', 'test-execute',
  'validate-external-code', 'delivery', 'manual-qa', 'retro', 'complete', 'backlog']);

export function readAutonomySnapshot(root) {
  const temporary = realpathSync(mkdtempSync(resolve(tmpdir(), 'ewai-autonomy-canonical-')));
  try { return readSnapshot(root, temporary); }
  finally { rmSync(temporary, { recursive: true, force: true }); }
}
function readSnapshot(root, temporary) {
  const paths = autonomyPaths(root);
  const requireNoRecovery = () => {
    if (autonomyFiles(paths.projectRoot, resolve(paths.runtimeRoot, 'runtime/intent-transactions')).some(path => path.endsWith('.json'))) autonomyError('autonomy-recovery-required');
  };
  requireNoRecovery();
  const captured = new Map(); let totalBytes = 0;
  const capture = path => {
    const before = lstatSync(path);
    const bytes = readAutonomyBytes(paths.projectRoot, path, 128 * 1024 * 1024);
    const after = lstatSync(path);
    if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs) autonomyError('autonomy-evidence-changed');
    totalBytes += bytes.length;
    if (totalBytes > 128 * 1024 * 1024 || captured.size >= 10000) autonomyError('autonomy-evidence-limit', 413);
    const target = resolve(temporary, relative(paths.projectRoot, path));
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
    captured.set(path, before); return target;
  };
  mkdirSync(resolve(temporary, '.ewai-pipeline'), { mode: 0o700 });
  writeFileSync(resolve(temporary, '.ewai-pipeline/project.json'), JSON.stringify({ schema: 'ewai.runtime-project/v1', projectRoot: temporary, specsRoot: paths.specsRelative }), { flag: 'wx', mode: 0o600 });
  const configText = readAutonomyFile(temporary, capture(paths.configPath));
  const config = YAML.parse(configText, { maxAliasCount: 100 });
  if (config?.schema !== 'ewai.project/v1' || config.specs?.root !== paths.specsRelative) autonomyError('autonomy-project-invalid', 422);
  const intentsRoot = resolve(paths.specsRoot, '2.Purpose/intents');
  const intents = autonomyFiles(paths.projectRoot, intentsRoot).filter(path => path.endsWith('.md')).map(path => {
    const snapshotPath = capture(path);
    const source = readAutonomyFile(temporary, snapshotPath), match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) autonomyError('autonomy-intent-invalid', 422);
    const metadata = YAML.parse(match[1], { maxAliasCount: 100 });
    const id = relative(intentsRoot, path).replace(/\.md$/, '');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)
      || metadata.schema !== 'ewai.intent/v1' || id !== `${metadata.domain}/${metadata.slug}`) autonomyError('autonomy-intent-invalid', 422);
    const sidecarText = readAutonomyFile(temporary, capture(path.replace(/\.md$/, '.json')));
    const sidecar = JSON.parse(sidecarText);
    if (sidecar?.schema !== 'ewai.intent-state/v1' || sidecar.slug !== metadata.slug || sidecar.domain !== metadata.domain) autonomyError('autonomy-intent-invalid', 422);
    const comparisons = { status: metadata.status, currentPhase: metadata.current_phase,
      deliveryStatus: metadata.delivery_status, deliveryStatePath: metadata.delivery_state_path ?? null,
      relationships: metadata.relationships ?? [], personas: metadata.personas ?? [],
      intentMap: metadata.intent_map ?? null, deliveryShape: metadata.delivery_shape ?? null };
    const consistent = Object.entries(comparisons).every(([key, value]) => JSON.stringify(sidecar[key]) === JSON.stringify(value));
    return { id, slug: metadata.slug, domain: metadata.domain, status: metadata.status, path: snapshotPath,
      ...comparisons, sourceDigest: autonomyDigest([source, sidecarText]), consistent };
  });
  const catalog = new Map(intents.map(intent => [intent.id, intent]));
  const operational = operationalSnapshot(paths);
  const policyInventories = [resolve(paths.projectRoot, dirname(ORGANISATION_POLICY_BASELINE_PATH)), resolve(paths.specsRoot, '3.Evidence/policy')].map(directory => {
    const files = autonomyFiles(paths.projectRoot, directory);
    for (const file of files) capture(file);
    return [directory, files];
  });
  const deliveryInventories = intents.map(intent => {
    const directory = resolve(paths.buildRoot, intent.slug);
    const files = autonomyFiles(paths.projectRoot, directory);
    for (const file of files) capture(file);
    return [directory, files];
  });
  // Canonical Plan controls may cite files outside SPECS. Follow only their
  // bounded data references, never commands, and let canonical validation
  // decide whether the copied evidence actually satisfies the accepted gate.
  const traceEvidence = new Map();
  for (const intent of intents) {
    const gatePath = resolve(temporary, paths.specsRelative, '6.Build', intent.slug, 'gates/plan/organisation-policy-design.json');
    if (!existsSync(gatePath)) continue;
    const gate = JSON.parse(readAutonomyFile(temporary, gatePath));
    if (gate.schema !== 'ewai.policy-phase-gate/v1' || gate.phase !== 'plan' || gate.controlTrace?.status !== 'pass') continue;
    if (!Array.isArray(gate.controlTrace.traces)) autonomyError('autonomy-invalid-evidence', 422);
    for (const trace of gate.controlTrace.traces) {
      if (!['automated-test', 'named-human', 'specialist-review'].includes(trace.route)) continue;
      const reference = trace.reference;
      if (typeof reference !== 'string' || !reference || reference.length > 4096 || /[\\\x00-\x1f\x7f]/.test(reference)
        || isAbsolute(reference) || reference.split('/').includes('..')) autonomyError('autonomy-unsafe-path', 403);
      const path = resolve(paths.projectRoot, reference);
      safeAutonomyPath(paths.projectRoot, path);
      if (traceEvidence.has(path)) continue;
      if (!existsSync(path)) { traceEvidence.set(path, null); continue; }
      const copied = captured.has(path) ? resolve(temporary, relative(paths.projectRoot, path)) : capture(path);
      traceEvidence.set(path, autonomyDigest(readAutonomyFile(temporary, copied)));
    }
  }
  requireNoRecovery();
  const items = intents.map(intent => {
    const deliveryRoot = resolve(temporary, paths.specsRelative, '6.Build', intent.slug);
    const statePath = resolve(deliveryRoot, 'delivery-state.json');
    const stateText = existsSync(statePath) ? readAutonomyFile(temporary, statePath) : '';
    const state = stateText ? JSON.parse(stateText) : null;
    const phasesValid = !state || [...AUTONOMY_PHASES, 'shelf-ready', 'complete-dry-run'].includes(state.currentPhase)
      && [...(state.phases ?? []), ...(state.adjuncts ?? []), ...(state.humanGates ?? [])].every(phase => AUTONOMY_PHASES.includes(phase.id));
    // Recovery-capable canonical checks see only the disposable private copy.
    const execution = phasesValid ? deriveExecutionState(temporary, intent, { intentCatalog: catalog }) : {
      valid: false, blockers: [{ code: 'canonical-phase-invalid' }], lifecycle: { nextPhase: null },
      actions: Object.fromEntries(['beginHarness', 'continueHarness', 'approveBuild', 'enterBuild', 'acquireTask'].map(key => [key, { permitted: false, blockers: [] }])),
    };
    if (!intent.consistent) { execution.valid = false; execution.blockers.push({ code: 'intent-state-drift' }); }
    const rawPriority = operational.priorities.get(intent.id);
    // Existing P2/string labels are not inferred numeric authority: neutral priority is zero.
    const priority = (typeof rawPriority === 'number' || typeof rawPriority === 'string' && /^-?\d+(?:\.\d+)?$/.test(rawPriority))
      && Number.isFinite(Number(rawPriority)) ? Number(rawPriority) : 0;
    const accepted = ['ready', 'approved'].includes(intent.status)
      || intent.status === 'in-progress' && state?.phases?.some(phase => phase.id === 'intent' && phase.status === 'completed');
    return { intentId: intent.id, status: intent.status, accepted: Boolean(accepted), execution, priority,
      sourceDigest: autonomyDigest([intent.sourceDigest, stateText]),
      repositoryBusy: operational.owners.length > 0 || operational.leases.length > 0 };
  });
  requireNoRecovery();
  if (autonomyPaths(root).locatorDigest !== paths.locatorDigest) autonomyError('autonomy-evidence-changed');
  for (const [path, before] of captured) {
    const after = lstatSync(path);
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) autonomyError('autonomy-evidence-changed');
  }
  for (const [path, digest] of traceEvidence) if (digest === null && existsSync(path)) autonomyError('autonomy-evidence-changed');
  for (const [directory, files] of [...deliveryInventories, ...policyInventories]) if (JSON.stringify(autonomyFiles(paths.projectRoot, directory)) !== JSON.stringify(files)) autonomyError('autonomy-evidence-changed');
  const configDigest = autonomyDigest(configText);
  return { items, configDigest, projectIdentity: autonomyDigest(paths.projectRoot),
    revision: autonomyDigest({ configDigest, locatorDigest: paths.locatorDigest,
      traceEvidence: [...traceEvidence].map(([path, digest]) => [relative(paths.projectRoot, path), digest]), items: items.map(item => ({ ...item, execution: {
      valid: item.execution.valid, lifecycle: item.execution.lifecycle, actions: Object.fromEntries(Object.entries(item.execution.actions).map(([key, action]) => [key, {
        permitted: action.permitted, phase: action.phase ?? null, nextPhase: action.nextPhase ?? null,
        candidates: action.candidates ?? [], blockers: action.blockers.map(blocker => blocker.code),
      }])),
      blockers: item.execution.blockers.map(blocker => blocker.code),
    } })) }) };
}
