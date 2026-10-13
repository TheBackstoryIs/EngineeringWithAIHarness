import { lstatSync, opendirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadProjectConfig } from '../project.mjs';
import { selectSourceMapProfile } from '../repository-source-map.mjs';
import { splitStoredPath } from './import-resolution.mjs';

const MAX_BYTES = 900_000;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_DELIVERIES = 1_000;
const MAX_RECORDS = 5_000;
const MAX_TARGETS = 80;
const MAX_DIAGNOSTICS = 100;
const MAX_OUTPUT_BYTES = 512_000;
const hash = value => createHash('sha256').update(value).digest('hex');
const text = value => typeof value === 'string' ? value.slice(0, 2_000) : '';

function safePath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 500
    && !isAbsolute(value) && !/[\\:\u0000-\u001f\u007f]/.test(value)
    && value.split('/').every(part => part && part !== '.' && part !== '..');
}

function reader() {
  const diagnostics = [], snapshots = new Map();
  let bytes = 0, reads = 0, truncated = false;
  const note = (code, path) => {
    if (code.endsWith('-limit')) truncated = true;
    if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push({ code, path });
    else truncated = true;
  };
  function array(value, path, { required = false, maximum = 1_000 } = {}) {
    if (value == null && !required) return [];
    if (!Array.isArray(value)) { note('invalid-array', path); return []; }
    if (value.length > maximum) note('record-limit', path);
    return value.slice(0, maximum);
  }
  // Check every component: a regular final file can still have a symlinked parent.
  function inspect(root, path, directory = false) {
    if (!safePath(path)) return { status: 'unsafe-path' };
    try {
      if (lstatSync(root).isSymbolicLink()) return { status: 'symlink' };
      let current = root;
      const parts = path.split('/');
      for (const [index, part] of parts.entries()) {
        current = resolve(current, part);
        const stat = lstatSync(current);
        if (stat.isSymbolicLink()) return { status: 'symlink' };
        if (index < parts.length - 1 && !stat.isDirectory()) return { status: 'not-directory' };
        if (index === parts.length - 1) {
          if (directory ? !stat.isDirectory() : !stat.isFile()) return { status: 'not-regular' };
          if (!directory && stat.size > MAX_BYTES) return { status: 'oversized' };
          return { status: 'available', absolute: current, size: stat.size };
        }
      }
    } catch (error) { return { status: error.code === 'ENOENT' ? 'missing' : 'unreadable' }; }
  }
  function read(root, path, key) {
    const checked = inspect(root, path);
    let result = { status: checked.status };
    if (checked.status === 'available') {
      if (++reads > MAX_RECORDS || bytes + checked.size > MAX_TOTAL_BYTES) {
        truncated = true;
        result = { status: 'read-limit' };
      } else {
        try {
          const content = readFileSync(checked.absolute);
          bytes += content.length;
          result = content.length > MAX_BYTES ? { status: 'oversized' } : { status: 'available', content, digest: hash(content) };
        } catch { result = { status: 'unreadable' }; }
      }
    }
    snapshots.set(key, result.digest ?? result.status);
    if (result.status !== 'available') note(result.status, key);
    return result;
  }
  function json(root, path, key) {
    const result = read(root, path, key);
    if (result.status !== 'available') return result;
    try {
      const value = JSON.parse(result.content.toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return { status: 'available', value, digest: result.digest };
    } catch { note('invalid-json', key); return { status: 'invalid', digest: result.digest }; }
  }
  function reference(root, base, path, expectedHash) {
    if (!safePath(path)) { note('unsafe-path', base); return { path: '', freshness: 'unavailable' }; }
    const key = `${base}/${path}`, result = read(root, path, key);
    return { path: key, freshness: result.status !== 'available' ? 'unavailable'
      : !/^[a-f0-9]{64}$/.test(expectedHash ?? '') ? 'not-recorded'
        : result.digest === expectedHash ? 'current' : 'changed' };
  }
  return { inspect, read, json, reference, array, note, diagnostics, snapshots, get truncated() { return truncated; } };
}

function parseTarget(input, repositories, options, io) {
  const supplied = typeof input === 'string' ? { path: input } : input;
  if (!supplied || typeof supplied.path !== 'string') throw new Error('Behaviour lookup requires a repository-relative locator.');
  const parsed = splitStoredPath(supplied.path);
  const repository = supplied.repository ?? options.repository ?? parsed.repo;
  if (parsed.repo && repository !== parsed.repo) throw new Error('Conflicting repository locator.');
  const path = parsed.relative, symbol = supplied.symbol ?? options.symbol ?? '';
  if (!safePath(path) || typeof symbol !== 'string' || symbol.length > 240 || /[\u0000-\u001f\u007f]/.test(symbol)) {
    throw new Error('Behaviour lookup requires a safe repository-relative locator and optional symbol.');
  }
  if (repository && !repositories.some(item => item.name === repository)) throw new Error('Unknown repository locator.');
  const candidates = repository ? repositories.filter(item => item.name === repository)
    : repositories.filter(item => item.rootStatus !== 'available' || io.inspect(item.root, path).status !== 'missing');
  if (candidates.length > 1) return { path, symbol, status: 'ambiguous', candidates: candidates.map(item => item.name) };
  const repo = candidates[0] ?? (repositories.length === 1 ? repositories[0] : null);
  if (!repo) return { path, symbol, status: 'not-found', repository: '' };
  // Sensitive source files are never opened merely to establish a lookup fingerprint.
  const sensitive = selectSourceMapProfile(path).id === 'core-sensitive';
  const source = repo.rootStatus !== 'available' ? { status: repo.rootStatus }
    : sensitive ? { status: 'sensitive' } : io.read(repo.root, path, `${repo.name}:${path}`);
  if (repo.rootStatus !== 'available') io.note(repo.rootStatus, `${repo.name}:${path}`);
  if (sensitive) io.note('sensitive', `${repo.name}:${path}`);
  return { path, symbol, repository: repo.name, status: source.status === 'available' ? 'found'
    : source.status === 'missing' ? 'not-found' : 'unavailable', contentDigest: source.digest ?? null };
}

function authoredLocation(value, directory, repositories, io, key) {
  const parsed = splitStoredPath(value?.source_path ?? value?.source_file ?? value?.path ?? '');
  let path = parsed.relative, repository = value?.repository ?? value?.repo ?? parsed.repo;
  if (parsed.repo && parsed.repo !== repository) {
    io.note('conflicting-repository', key);
    return { path: '', repository: '', symbols: [] };
  }
  // Historical ledgers use delivery-relative source_file locators. Normalise only
  // inside a configured repository; this never opens a path supplied by a record.
  if (path.startsWith('../')) {
    const absolute = resolve(directory, path);
    const candidates = repositories.filter(item => safePath(relative(item.root, absolute).replaceAll('\\', '/')));
    if (repository) {
      const repo = candidates.find(item => item.name === repository);
      path = repo ? relative(repo.root, absolute).replaceAll('\\', '/') : '';
    } else if (candidates.length === 1) {
      repository = candidates[0].name;
      path = relative(candidates[0].root, absolute).replaceAll('\\', '/');
    } else path = '';
  }
  return { path, repository,
    symbols: io.array(value?.symbols, key).map(item => typeof item === 'string' ? item : item?.name).filter(Boolean) };
}

function taskProjection(io, directory, base, task, repository) {
  const id = text(task.id), path = task.evidence_path;
  const recorded = io.json(directory, path, `${base}/${safePath(path) ? path : 'unsafe-task-evidence'}`);
  const value = recorded.value;
  const commands = io.array(value?.commands, `${base}/${path}#commands`, { required: Boolean(value) });
  const checks = io.array(value?.completion_checks, `${base}/${path}#completion_checks`, { required: Boolean(value) });
  const changed = io.array(value?.changed_files, `${base}/${path}#changed_files`, { required: Boolean(value) });
  const valid = value && ['ewai.task-evidence/v1', 'ewai.task-evidence/v2', 'ewai.task-evidence/v3'].includes(value.schema)
    && value.task_id === id && (!value.repository || value.repository === repository)
    && Array.isArray(value.commands) && Array.isArray(value.completion_checks) && Array.isArray(value.changed_files)
    && commands.every(item => item && typeof item === 'object' && typeof item.command === 'string')
    && checks.every(item => item && typeof item === 'object' && typeof item.name === 'string' && typeof item.status === 'string')
    && value.review && typeof value.review === 'object' && !Array.isArray(value.review);
  if (value && !valid) io.note('invalid-task-evidence', `${base}/${path}`);
  const evidence = { path: safePath(path) ? `${base}/${path}` : '', status: valid ? 'recorded'
    : recorded.status === 'missing' ? 'missing' : 'invalid', schema: valid ? value.schema : null,
    commit: valid ? text(value.commit) : '', semanticSupport: 'not-assessed' };
  return {
    taskId: id, repository, evidence,
    completionChecks: valid ? checks.map(check => ({
      name: text(check?.name), status: text(check?.status), support: text(check?.support),
      observation: check?.observation ? Object.fromEntries(['evidence_type', 'expected', 'actual', 'evidence'].map(key => [key, text(check.observation[key])])) : null,
      evidence: io.reference(directory, base, check?.evidence_path, check?.evidence_sha256)
    })) : [],
    plannedCompletion: io.array(task.completion_evidence, `${base}/task-graph.json#completion_evidence`).map(text),
    commands: valid ? commands.map(command => ({ stage: text(command?.stage), command: text(command?.command),
      exitCode: Number.isInteger(command?.exit_code) ? command.exit_code : null,
      evidence: io.reference(directory, base, command?.output_path, command?.output_sha256) })) : [],
    review: valid && value.review ? { status: text(value.review.status),
      evidence: io.reference(directory, base, value.review.evidence_path, value.review.evidence_sha256) } : null,
    changedFiles: valid ? changed.filter(safePath) : []
  };
}

/** Disposable projection of authored links, not proof of implementation or acceptance. */
export function readBehaviourContext(projectRoot, inputs, options = {}) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > MAX_TARGETS) throw new Error('Behaviour lookup requires 1 to 80 targets.');
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Behaviour lookup limit must be 1 to 100.');
  const { config, paths } = loadProjectConfig(projectRoot), io = reader();
  const repositories = (config.repositories?.length ? config.repositories : [{ name: 'application', path: '.' }])
    .map(item => {
      const root = resolve(projectRoot, item.path);
      let common = resolve(projectRoot);
      while (relative(common, root).startsWith('..') && dirname(common) !== common) common = dirname(common);
      const rootStatus = root === common ? 'available' : io.inspect(common, relative(common, root).replaceAll('\\', '/'), true).status;
      return { name: item.name, root, rootStatus };
    });
  const targets = inputs.map(input => parseTarget(input, repositories, options, io));
  const claims = [];
  const buildPath = relative(projectRoot, paths.buildRoot).replaceAll('\\', '/');
  const checked = io.inspect(projectRoot, buildPath, true);
  let directories = [];
  if (checked.status === 'available') {
    let handle;
    try {
      handle = opendirSync(checked.absolute);
      for (let entry; directories.length <= MAX_DELIVERIES && (entry = handle.readSync());) directories.push(entry);
      directories.sort((a, b) => a.name.localeCompare(b.name));
    }
    catch { io.note('unreadable', buildPath); }
    finally { handle?.closeSync(); }
  } else if (checked.status !== 'missing') io.note(checked.status, buildPath);
  if (directories.length > MAX_DELIVERIES) io.note('delivery-limit', buildPath);
  let scanned = 0;
  for (const entry of directories.slice(0, MAX_DELIVERIES)) {
    if (!entry.isDirectory()) { if (entry.isSymbolicLink()) io.note('symlink', `${buildPath}/${entry.name}`); continue; }
    const base = `${buildPath}/${entry.name}`, directory = resolve(paths.buildRoot, entry.name);
    if (io.inspect(projectRoot, base, true).status !== 'available') { io.note('unsafe-directory', base); continue; }
    scanned++;
    const ledgerPath = 'gates/plan/claim-ledger.json';
    const ledger = io.json(directory, ledgerPath, `${base}/${ledgerPath}`);
    if (!ledger.value) continue;
    const authored = ledger.value.implementation_claims ?? ledger.value.claims;
    if (!Array.isArray(authored)) { io.note('invalid-claims', `${base}/${ledgerPath}`); continue; }
    const graph = io.json(directory, 'task-graph.json', `${base}/task-graph.json`);
    const planPath = io.inspect(directory, 'gates/plan/plan-contract.json').status === 'missing' ? 'plan-contract.json' : 'gates/plan/plan-contract.json';
    const plan = io.json(directory, planPath, `${base}/${planPath}`);
    const state = io.json(directory, 'delivery-state.json', `${base}/delivery-state.json`);
    const tasks = io.array(graph.value?.tasks, `${base}/task-graph.json#tasks`, { required: true });
    const testObligations = io.array(plan.value?.test_obligations, `${base}/${planPath}#test_obligations`, { required: true });
    if (!Array.isArray(graph.value?.tasks)) io.note('invalid-tasks', `${base}/task-graph.json`);
    if (authored.length > 1_000 || graph.value?.tasks?.length > 1_000) io.note('record-limit', base);
    const projections = new Map();
    let intentAcceptanceCriteria = [];
    const intentPath = state.value?.intent?.path;
    const intentRoot = `${paths.specsRelative}/2.Purpose/intents/`;
    if (safePath(intentPath) && intentPath.startsWith(intentRoot) && intentPath.endsWith('.md')) {
      const intent = io.read(projectRoot, intentPath, intentPath);
      const section = intent.content?.toString('utf8').match(/^## Acceptance criteria\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1] ?? '';
      intentAcceptanceCriteria = section.split('\n').map(value => value.replace(/^\s*-\s*/, '').trim()).filter(Boolean).slice(0, 100).map(text);
    }
    for (const claim of authored.slice(0, 1_000)) {
      const claimId = text(claim?.id ?? claim?.claim_id);
      if (!claimId) { io.note('invalid-claim-id', `${base}/${ledgerPath}`); continue; }
      const owners = tasks.filter(task => io.array(task?.claims, `${base}/task-graph.json#claims`, { required: true }).includes(claimId));
      const matches = [], relevant = new Set();
      for (const target of targets.filter(item => item.repository && item.status !== 'ambiguous')) {
        const eligible = owners.filter(task => task.repo === target.repository);
        const inferredRepo = [...new Set(owners.map(task => task.repo))];
        for (const location of io.array(claim.current_code_evidence, `${base}/${ledgerPath}#current_code_evidence`).map(value => authoredLocation(value, directory, repositories, io, `${base}/${claimId}`))) {
          const repo = location.repository || (inferredRepo.length === 1 ? inferredRepo[0] : '');
          if (!repo && location.path === target.path) io.note('unresolved-repository', `${base}/${claimId}`);
          if (repo !== target.repository || location.path !== target.path) continue;
          if (!target.symbol || !location.symbols.length || location.symbols.includes(target.symbol)) {
            matches.push({ repository: repo, path: target.path, symbol: target.symbol || null,
              scope: target.symbol && location.symbols.includes(target.symbol) ? 'symbol' : 'file', basis: 'authored-code-evidence' });
            eligible.forEach(task => relevant.add(task));
          }
        }
        for (const task of eligible) {
          let projection = projections.get(task);
          const planned = [...io.array(claim.planned_files, `${base}/${ledgerPath}#planned_files`), ...io.array(claim.files_touched, `${base}/${ledgerPath}#files_touched`)].some(value => {
            const location = authoredLocation(typeof value === 'string' ? { source_path: value } : value, directory, repositories, io, `${base}/${claimId}`);
            return location.path === target.path && (!location.repository || location.repository === target.repository);
          });
          // Actual changed_files can identify a path absent from a historical plan.
          // The task is still joined through its explicit claim and repository owner.
          if (!projection) { projection = taskProjection(io, directory, base, task, target.repository); projections.set(task, projection); }
          if (planned || projection.changedFiles.includes(target.path)) {
            matches.push({ repository: target.repository, path: target.path, symbol: null, scope: 'file',
              basis: projection.changedFiles.includes(target.path) ? 'task-changed-file' : 'planned-file' });
            relevant.add(task);
          }
        }
      }
      if (!matches.length) continue;
      const taskRecords = [...relevant].map(task => {
        if (!projections.has(task)) projections.set(task, taskProjection(io, directory, base, task, task.repo));
        return projections.get(task);
      });
      const taskIds = new Set(taskRecords.map(task => task.taskId));
      const slices = new Set([claim.slice, ...[...relevant].map(task => task.slice)].filter(Boolean));
      const obligations = testObligations.filter(item => taskIds.has(item?.task)
        || (!item?.task && slices.has(item?.slice)));
      claims.push({ intent: { slug: entry.name, id: text(state.value?.intent?.id), title: text(state.value?.intent?.title) },
        claimId, statement: text(claim.statement), acceptanceCriteria: io.array(claim.acceptance ?? claim.acceptance_criteria, `${base}/${ledgerPath}#acceptance`)
          .map(value => typeof value === 'string' ? text(value) : { id: text(value?.id), criterion: text(value?.criterion ?? value?.text) }),
        intentAcceptanceCriteria, acceptanceScope: Array.isArray(claim.acceptance ?? claim.acceptance_criteria) ? 'claim' : 'intent-fallback',
        delivery: { status: text(state.value?.status) || 'unknown', phase: text(state.value?.currentPhase) || 'unknown' },
        matches: [...new Map(matches.map(item => [JSON.stringify(item), item])).values()],
        tests: obligations.map(item => ({ id: text(item.id), file: text(item.file), obligation: text(item.obligation),
          basis: item.task ? 'task-obligation' : 'slice-obligation', execution: 'not-established' })),
        requiredTests: io.array(claim.tests_required, `${base}/${ledgerPath}#tests_required`).map(text), tasks: taskRecords,
        sources: { claimLedger: `${base}/${ledgerPath}`, taskGraph: `${base}/task-graph.json`, planContract: `${base}/${planPath}`, deliveryState: `${base}/delivery-state.json`,
          intent: safePath(intentPath) && intentPath.startsWith(intentRoot) ? intentPath : null },
        semanticSupport: 'not-assessed' });
    }
  }
  const selected = [];
  let outputBytes = 0;
  for (const claim of claims.slice(0, limit)) {
    outputBytes += Buffer.byteLength(JSON.stringify(claim));
    if (outputBytes > MAX_OUTPUT_BYTES) { io.note('output-limit', buildPath); break; }
    selected.push(claim);
  }
  const truncated = io.truncated || directories.length > MAX_DELIVERIES || claims.length > selected.length;
  const result = { schema: 'ewai.behaviour-context/v1', status: targets.some(item => item.status === 'ambiguous') ? 'ambiguous'
    : claims.length ? 'has-context' : targets.every(item => item.status === 'not-found') ? 'not-found' : 'no-context',
    targets, claims: selected, coverage: { scannedDeliveries: scanned, matchedClaims: claims.length,
      returnedClaims: selected.length, limit, truncated,
      complete: !truncated && !io.diagnostics.length && targets.every(item => item.status === 'found'), diagnostics: io.diagnostics },
    guidance: { advisory: true, approvalsChanged: false, semanticSupport: 'not-assessed',
      note: 'Authored links and recorded results identify outcomes to recheck. Current hashes do not prove behaviour, executed tests, human acceptance or release. No links is not proof of no impact.' } };
  const linkedDirectories = new Set(claims.map(claim => claim.sources.taskGraph.replace(/\/task-graph\.json$/, '/')));
  const exactSources = new Set([...targets.filter(item => item.repository).map(item => `${item.repository}:${item.path}`),
    ...claims.map(claim => claim.sources.intent).filter(Boolean)]);
  const linkedSnapshots = [...io.snapshots].filter(([path]) => exactSources.has(path)
    || [...linkedDirectories].some(prefix => path.startsWith(prefix))).sort(([a], [b]) => a.localeCompare(b));
  // Publishing an Impact assessment creates a delivery directory. Unrelated
  // unmapped directories must not change the identity of the mapped behaviour.
  return { ...result, digest: hash(JSON.stringify({ targets, claims: claims.map(claim => ({ intent: claim.intent.slug, claimId: claim.claimId, matches: claim.matches })), snapshots: linkedSnapshots })) };
}

export function fileBehaviourContext(projectRoot, input, options = {}) {
  return readBehaviourContext(projectRoot, [input], options);
}
