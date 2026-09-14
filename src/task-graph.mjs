import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { atomicJson, atomicText, isWithin, now, sha256 } from './delivery-documents.mjs';

const taskIdPattern = /^T-\d{3,}$/;
const terminalCentralFiles = new Set([
  'tracker.md',
  'context-packet.md',
  'delivery-checklist.md',
  'delivery-state.json',
]);

function text(value) {
  return String(value ?? '').trim();
}

function list(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function pathStem(value) {
  return text(value)
    .replaceAll('\\', '/')
    .replace(/\*\*.*$/, '')
    .replace(/\*.*$/, '')
    .replace(/\/$/, '');
}

function pathsOverlap(left, right) {
  const a = pathStem(left);
  const b = pathStem(right);
  return Boolean(a && b && (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)));
}

function isCentralWrite(path) {
  const normalized = text(path).replaceAll('\\', '/');
  const name = normalized.split('/').at(-1);
  return terminalCentralFiles.has(name)
    || /\/gates\/[^/]+\/(?:gate-ledger\.json|phase-gate-check\.md)$/.test(`/${normalized}`);
}

function section(content, heading) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start < 0) return '';
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start + 1, end < 0 ? lines.length : end).join('\n').trim();
}

function isRealWithin(root, path) {
  return isWithin(realpathSync(root), realpathSync(path));
}

function readJsonWithin(root, configuredPath, label, errors) {
  const value = text(configuredPath);
  const absolute = resolve(root, value);
  if (!value || !isWithin(root, absolute)) {
    errors.push({ code: 'task-graph-source-path', message: `${label} must be a path inside the delivery root.`, evidence: value || label });
    return null;
  }
  if (!existsSync(absolute)) {
    errors.push({ code: 'task-graph-source-missing', message: `${label} does not exist: ${value}.`, evidence: value });
    return null;
  }
  if (!statSync(absolute).isFile() || !isRealWithin(root, absolute)) {
    errors.push({ code: 'task-graph-source-path', message: `${label} must be a real file inside the delivery root.`, evidence: value });
    return null;
  }
  try {
    return JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (error) {
    errors.push({ code: 'task-graph-source-invalid', message: `${label} is not valid JSON: ${error.message}`, evidence: value });
    return null;
  }
}

function recordsFrom(document, keys) {
  for (const key of keys) {
    if (Array.isArray(document?.[key])) return document[key];
  }
  return [];
}

function recordId(record) {
  return text(record?.id ?? record?.claim_id ?? record?.slice_id);
}

function actionableClaim(record) {
  return !['defer', 'deferred', 'decision_required', 'decision-required', 'out_of_scope', 'out-of-scope']
    .includes(text(record?.type ?? record?.status).toLowerCase());
}

function pathAllowed(path, writeSet) {
  const candidate = pathStem(path);
  return writeSet.some((allowed) => {
    const boundary = pathStem(allowed);
    return Boolean(candidate && boundary && (candidate === boundary || candidate.startsWith(`${boundary}/`)));
  });
}

function evidenceFile(root, configuredPath, expectedHash, label, errors) {
  const absolute = resolve(root, text(configuredPath));
  if (!text(configuredPath) || !isWithin(root, absolute) || !existsSync(absolute)
    || !statSync(absolute).isFile() || !isRealWithin(root, absolute)) {
    errors.push(`${label} is missing or outside the delivery root`);
    return;
  }
  if (!text(expectedHash) || sha256(readFileSync(absolute)) !== expectedHash) {
    errors.push(`${label} hash is missing or stale`);
  }
}

export function validateTaskEvidence(deliveryRoot, task) {
  const root = resolve(deliveryRoot);
  const configured = text(task?.evidence_path);
  const path = resolve(root, configured);
  const errors = [];
  if (!configured || !isWithin(root, path)) {
    errors.push('evidence_path is missing or escapes the delivery root');
  } else if (!existsSync(path)) {
    return { status: 'missing', path: configured, errors: ['structured task evidence does not exist'] };
  } else if (!statSync(path).isFile() || !isRealWithin(root, path)) {
    errors.push('structured task evidence must be a real file inside the delivery root');
  } else {
    let evidence = null;
    try {
      evidence = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      errors.push(`structured task evidence is not valid JSON: ${error.message}`);
    }
    if (evidence) {
      if (evidence.schema !== 'ewai.task-evidence/v1') errors.push('schema must be ewai.task-evidence/v1');
      if (evidence.task_id !== task.id) errors.push(`task_id must be ${task.id}`);
      if (text(evidence.task_branch)) {
        if (evidence.task_branch !== task.branch) errors.push(`task_branch must be ${task.branch}`);
        if (!text(evidence.branch)) errors.push('branch is required');
      } else if (evidence.branch !== task.branch) {
        errors.push(`branch must be ${task.branch}`);
      }
      if (text(evidence.repository) && evidence.repository !== task.repo) errors.push(`repository must be ${task.repo}`);
      if (!text(evidence.commit)) errors.push('commit is required');
      const changed = list(evidence.changed_files);
      if (!changed.length) errors.push('changed_files must contain at least one file');
      for (const file of changed) {
        if (!pathAllowed(file, list(task.write_set))) errors.push(`changed file is outside the task write_set: ${file}`);
      }
      const commands = Array.isArray(evidence.commands) ? evidence.commands : [];
      const red = commands.find((item) => item.stage === 'red');
      const green = commands.find((item) => item.stage === 'green');
      const refactor = commands.find((item) => item.stage === 'refactor');
      if (!red || red.command !== task.red_green_refactor?.red_command || !Number.isInteger(red.exit_code) || red.exit_code === 0) {
        errors.push('red command must match the task contract and capture a non-zero exit');
      }
      if (red && red.expected_failure !== task.red_green_refactor?.expected_red_failure) {
        errors.push('red expected_failure must match the task contract');
      }
      if (!green || green.command !== task.red_green_refactor?.green_command || green.exit_code !== 0) {
        errors.push('green command must match the task contract and capture exit 0');
      }
      if (!refactor || refactor.exit_code !== 0 || !text(refactor.command)) {
        errors.push('refactor verification must capture a command with exit 0');
      }
      for (const command of commands) {
        if (!list(task.allowed_commands).includes(text(command.command))) {
          errors.push(`evidence contains a command outside allowed_commands: ${command.command ?? '<missing>'}`);
        }
        evidenceFile(root, command.output_path, command.output_sha256, `${command.stage || 'command'} output`, errors);
      }
      const review = evidence.review ?? {};
      if (review.fresh_context !== true) errors.push('review.fresh_context must be true');
      if (review.tests_reviewed_first !== true) errors.push('review.tests_reviewed_first must be true');
      if (review.status !== 'pass') errors.push('review.status must be pass');
      if (!text(review.reviewer)) errors.push('review.reviewer is required');
      evidenceFile(root, review.evidence_path, review.evidence_sha256, 'review evidence', errors);
      const checks = Array.isArray(evidence.completion_checks) ? evidence.completion_checks : [];
      const checksByName = new Map(checks.map((check) => [text(check.name), check]));
      for (const planned of list(task.completion_evidence)) {
        const check = checksByName.get(planned);
        if (!check || check.status !== 'pass') errors.push(`planned completion check has no passing evidence: ${planned}`);
        else evidenceFile(root, check.evidence_path, check.evidence_sha256, `completion check ${planned}`, errors);
      }
    }
  }
  return { status: errors.length ? 'incomplete' : 'complete', path: configured, errors };
}

export function validateTaskReport(deliveryRoot, task) {
  const root = resolve(deliveryRoot);
  const reportPath = resolve(root, text(task?.report_path));
  const errors = [];
  if (!text(task?.report_path) || !isWithin(root, reportPath)) {
    errors.push('report_path is missing or escapes the delivery root');
  } else if (!existsSync(reportPath)) {
    return { status: 'missing', path: relative(root, reportPath).replaceAll('\\', '/'), errors: ['task report does not exist'] };
  } else if (!statSync(reportPath).isFile() || !isRealWithin(root, reportPath)) {
    errors.push('task report must be a real file inside the delivery root');
  } else {
    let content = '';
    let readFailed = false;
    try {
      content = readFileSync(reportPath, 'utf8');
    } catch (error) {
      errors.push(`task report cannot be read: ${error.message}`);
      readFailed = true;
    }
    if (!readFailed) {
      if (!new RegExp(`^# Task Report: ${text(task.id)}\\s*$`, 'm').test(content)) {
        errors.push(`title must identify ${text(task.id)}`);
      }
      const headings = [
        'Summary', 'Red-green-refactor evidence', 'Feedback loops run', 'Files changed',
        'Completion evidence', 'Stop conditions', 'Review notes', 'QA notes',
      ];
      for (const heading of headings) {
        if (!section(content, heading)) errors.push(`${heading} section is missing or empty`);
      }
      if (/\{[^}\n]+\}/.test(content)) errors.push('template placeholders remain');
      const completion = section(content, 'Completion evidence');
      if (!/\bpass(?:ed)?\b/i.test(completion)) errors.push('completion evidence has no passing result');
      if (/\b(?:fail|failed)\b/i.test(completion)) errors.push('completion evidence contains a failing result');
      const review = section(content, 'Review notes');
      if (!/Tests reviewed first:\s*yes\b/i.test(review)) errors.push('tests-first review is not confirmed');
      if (!/Fresh-context review:\s*pass\b/i.test(review)) errors.push('fresh-context review has not passed');
    }
  }
  const evidence = validateTaskEvidence(root, task);
  if (evidence.status !== 'complete') errors.push(...evidence.errors);
  return {
    status: errors.length ? 'incomplete' : 'complete',
    path: text(task?.report_path),
    errors,
    evidence,
  };
}

function taskIncomplete(task) {
  const scalar = [
    'id', 'slice', 'name', 'issue_kind', 'classification', 'repo', 'branch',
    'user_visible_outcome', 'report_path', 'evidence_path',
  ];
  const arrays = [
    'depends_on', 'claims', 'read_set', 'write_set', 'allowed_commands',
    'stop_conditions', 'completion_evidence',
  ];
  const missing = scalar.filter((key) => !text(task?.[key]));
  missing.push(...arrays.filter((key) => !Array.isArray(task?.[key])));
  if (!Number.isFinite(Number(task?.priority))) missing.push('priority');
  if (!Number.isInteger(Number(task?.parallel_wave))) missing.push('parallel_wave');
  for (const key of ['module_interface_contract', 'red_green_refactor', 'ralph_loop', 'review', 'merge']) {
    if (!task?.[key] || typeof task[key] !== 'object' || Array.isArray(task[key])) missing.push(key);
  }
  const contract = task?.module_interface_contract ?? {};
  for (const key of ['module', 'test_boundary']) if (!text(contract[key])) missing.push(`module_interface_contract.${key}`);
  for (const key of ['interface', 'behaviour_owned', 'caller_contract']) {
    if (!list(contract[key]).length) missing.push(`module_interface_contract.${key}`);
  }
  const cycle = task?.red_green_refactor ?? {};
  for (const key of ['red_command', 'expected_red_failure', 'green_command', 'refactor_boundary']) {
    if (!text(cycle[key])) missing.push(`red_green_refactor.${key}`);
  }
  if (task?.review?.fresh_context_required !== true) missing.push('review.fresh_context_required');
  if (task?.review?.review_tests_first !== true) missing.push('review.review_tests_first');
  if (!list(task?.review?.standards_pushed).length) missing.push('review.standards_pushed');
  if (task?.merge?.orchestrator_owned !== true) missing.push('merge.orchestrator_owned');
  if (!list(task?.merge?.post_merge_checks).length) missing.push('merge.post_merge_checks');
  return missing;
}

function cycleIn(tasksById) {
  const visiting = new Set();
  const visited = new Set();
  const visit = (id, trail = []) => {
    if (visiting.has(id)) return [...trail, id];
    if (visited.has(id)) return null;
    visiting.add(id);
    for (const dependency of list(tasksById.get(id)?.depends_on)) {
      if (!tasksById.has(dependency)) continue;
      const cycle = visit(dependency, [...trail, id]);
      if (cycle) return cycle;
    }
    visiting.delete(id);
    visited.add(id);
    return null;
  };
  for (const id of tasksById.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;
}

function taskReadiness(tasks, completedIds = new Set(), reports = new Map()) {
  const executableWave = tasks
    .filter((task) => !completedIds.has(task.id) && list(task.depends_on).every((id) => completedIds.has(id)))
    .reduce((lowest, task) => Math.min(lowest, Number(task.parallel_wave)), Number.POSITIVE_INFINITY);
  return tasks.map((task) => {
    const dependencies = list(task.depends_on);
    const waitingFor = dependencies.filter((id) => !completedIds.has(id));
    const completed = completedIds.has(task.id);
    const requiresHuman = text(task.classification).toUpperCase() === 'HITL';
    const status = completed
      ? 'completed'
      : waitingFor.length
        ? 'blocked-dependency'
        : Number(task.parallel_wave) > executableWave
          ? 'blocked-wave'
          : requiresHuman ? 'awaiting-human' : 'ready';
    return { id: task.id, status, waitingFor, requiresHuman, report: reports.get(task.id) ?? null };
  });
}

export function validateTaskGraph(deliveryRoot, options = {}) {
  const root = resolve(deliveryRoot);
  const path = resolve(root, 'task-graph.json');
  const errors = [];
  const warnings = [];
  const add = (code, message, evidence = '') => errors.push({ code, message, evidence });
  let graph = null;

  if (!existsSync(path)) {
    add('task-graph-missing', 'task-graph.json does not exist.', relative(root, path));
  } else {
    try {
      graph = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      add('task-graph-invalid-json', `task-graph.json is not valid JSON: ${error.message}`, 'task-graph.json');
    }
  }

  if (graph) {
    if (graph.schema_version !== 1) add('task-graph-schema-version', 'schema_version must be 1.', 'schema_version');
    if (options.slug && graph.slug !== options.slug) add('task-graph-slug', `slug must be ${options.slug}.`, 'slug');
    if (!['final', 'ready', 'pass'].includes(text(graph.status).toLowerCase())) {
      add('task-graph-status', 'status must be final, ready, or pass.', 'status');
    }
    if (!text(graph.parent_branch)) add('task-graph-parent-branch', 'parent_branch is required.', 'parent_branch');
    if (graph.repository_branches !== undefined) {
      if (!graph.repository_branches || typeof graph.repository_branches !== 'object' || Array.isArray(graph.repository_branches)) {
        add('task-graph-repository-branches', 'repository_branches must be an object keyed by configured repository name.', 'repository_branches');
      } else {
        for (const [repository, configured] of Object.entries(graph.repository_branches)) {
          const branch = typeof configured === 'string' ? configured : configured?.parent_branch;
          if (!text(repository) || !text(branch)) {
            add('task-graph-repository-branches', 'Every repository_branches entry requires a parent_branch.', `repository_branches.${repository}`);
          }
        }
      }
    }
    for (const key of ['claim_ledger', 'plan_contract', 'destination']) {
      if (!text(graph.source?.[key])) add('task-graph-source', `source.${key} is required.`, `source.${key}`);
    }
    const claimLedger = readJsonWithin(root, graph.source?.claim_ledger, 'source.claim_ledger', errors);
    const planContract = readJsonWithin(root, graph.source?.plan_contract, 'source.plan_contract', errors);
    const destinationPath = resolve(root, text(graph.source?.destination));
    if (text(graph.source?.destination) && (!isWithin(root, destinationPath) || !existsSync(destinationPath))) {
      add('task-graph-source-missing', 'source.destination must be an existing file inside the delivery root.', graph.source.destination);
    }
    if (!graph.parallelism || typeof graph.parallelism !== 'object') {
      add('task-graph-parallelism', 'parallelism is required.', 'parallelism');
    } else {
      if (typeof graph.parallelism.allowed !== 'boolean') add('task-graph-parallelism', 'parallelism.allowed must be boolean.', 'parallelism.allowed');
      if (!Number.isInteger(graph.parallelism.max_parallel_tasks) || graph.parallelism.max_parallel_tasks < 1) {
        add('task-graph-parallelism', 'parallelism.max_parallel_tasks must be a positive integer.', 'parallelism.max_parallel_tasks');
      }
      if (!text(graph.parallelism.rationale)) add('task-graph-parallelism', 'parallelism.rationale is required.', 'parallelism.rationale');
    }

    const tasks = Array.isArray(graph.tasks) ? graph.tasks : [];
    const waves = Array.isArray(graph.afk_waves) ? graph.afk_waves : [];
    if (!tasks.length) add('task-graph-empty', 'tasks must contain at least one task.', 'tasks');
    if (!waves.length) add('task-graph-waves', 'afk_waves must contain at least one execution wave.', 'afk_waves');

    const ids = tasks.map((task) => text(task?.id)).filter(Boolean);
    const tasksById = new Map(tasks.map((task) => [text(task?.id), task]));
    if (new Set(ids).size !== ids.length) add('task-id-duplicate', 'Task IDs must be unique.', 'tasks[].id');
    const branches = tasks.map((task) => text(task?.branch)).filter(Boolean);
    if (new Set(branches).size !== branches.length) add('task-branch-duplicate', 'Task branches must be unique.', 'tasks[].branch');

    const claimOwners = new Map();
    for (const task of tasks) {
      const id = text(task?.id) || '<missing-id>';
      const missing = taskIncomplete(task);
      if (missing.length) add('task-incomplete', `${id} is missing required fields: ${missing.join(', ')}.`, id);
      for (const command of [task?.red_green_refactor?.red_command, task?.red_green_refactor?.green_command].map(text).filter(Boolean)) {
        if (!list(task?.allowed_commands).includes(command)) {
          add('task-command-not-allowed', `${id} red/green command is absent from allowed_commands: ${command}.`, id);
        }
      }
      if (text(task?.id) && !taskIdPattern.test(task.id)) add('task-id-format', `${id} must match T-###.`, id);
      if (!['AFK', 'HITL'].includes(text(task?.classification).toUpperCase())) {
        add('task-classification', `${id} classification must be AFK or HITL.`, id);
      }
      for (const dependency of list(task?.depends_on)) {
        if (!tasksById.has(dependency)) add('task-dependency-missing', `${id} depends on missing task ${dependency}.`, id);
        if (dependency === id) add('task-dependency-self', `${id} cannot depend on itself.`, id);
      }
      for (const claim of list(task?.claims)) {
        if (claimOwners.has(claim)) add('task-claim-duplicate', `${claim} is owned by both ${claimOwners.get(claim)} and ${id}.`, claim);
        else claimOwners.set(claim, id);
      }
      for (const write of list(task?.write_set)) {
        if (isCentralWrite(write) && task?.central_writes_allowed !== true) {
          add('central-write-owned-by-worker', `${id} cannot own central delivery file ${write}.`, id);
        }
      }
      if (text(task?.classification).toUpperCase() === 'AFK') {
        if (!text(task.first_failing_test) && !text(task.no_first_test_rationale)) {
          add('afk-first-test-missing', `${id} requires a first failing test or rationale.`, id);
        }
        if (!list(task.write_set).length) add('afk-write-set-missing', `${id} requires a write_set.`, id);
        if (!list(task.stop_conditions).length) add('afk-stop-conditions-missing', `${id} requires stop conditions.`, id);
        if (!list(task.completion_evidence).length) add('afk-completion-evidence-missing', `${id} requires completion evidence.`, id);
      }
      if (task?.ralph_loop?.allowed === true) {
        if (!Number.isInteger(task.ralph_loop.max_iterations) || task.ralph_loop.max_iterations < 1) {
          add('ralph-loop-unbounded', `${id} Ralph loop requires a finite positive max_iterations.`, id);
        }
        if (!text(task.ralph_loop.completion_promise)) add('ralph-loop-promise-missing', `${id} Ralph loop requires a completion promise.`, id);
      }
      if (task?.merge?.orchestrator_owned !== true) add('merge-not-orchestrator-owned', `${id} merge must be orchestrator-owned.`, id);
      if (task?.review?.fresh_context_required !== true) add('fresh-review-required', `${id} requires fresh-context review.`, id);
    }

    const ledgerClaims = recordsFrom(claimLedger, ['implementation_claims', 'claims']);
    const actionableClaims = new Set(ledgerClaims.filter(actionableClaim).map(recordId).filter(Boolean));
    if (!ledgerClaims.length) add('claim-ledger-empty', 'The Claim Ledger must contain implementation claims.', graph.source?.claim_ledger);
    for (const claim of claimOwners.keys()) {
      if (!actionableClaims.has(claim)) add('task-claim-unknown', `${claim} is not an actionable Claim Ledger claim.`, claim);
    }
    for (const claim of actionableClaims) {
      if (!claimOwners.has(claim)) add('task-claim-unowned', `${claim} is actionable but has no task owner.`, claim);
    }

    const ledgerSlices = new Set(recordsFrom(claimLedger, ['slices', 'vertical_slices']).map(recordId).filter(Boolean));
    const planSlices = new Set(recordsFrom(planContract, ['vertical_slices', 'slices']).map(recordId).filter(Boolean));
    if (!ledgerSlices.size) add('claim-ledger-slices-empty', 'The Claim Ledger must identify delivery slices.', graph.source?.claim_ledger);
    if (!planSlices.size) add('plan-contract-slices-empty', 'The Plan Contract must identify vertical slices.', graph.source?.plan_contract);
    for (const task of tasks) {
      if (['orchestration', 'migration-checkpoint'].includes(text(task.issue_kind).toLowerCase())) continue;
      if (!ledgerSlices.has(text(task.slice))) add('task-slice-not-in-ledger', `${task.id} slice ${task.slice} is absent from the Claim Ledger.`, task.id);
      if (!planSlices.has(text(task.slice))) add('task-slice-not-in-plan', `${task.id} slice ${task.slice} is absent from the Plan Contract.`, task.id);
    }

    const cycle = cycleIn(tasksById);
    if (cycle) add('task-dependency-cycle', `Task dependency cycle detected: ${cycle.join(' -> ')}.`, cycle.join(' -> '));

    const seenWaves = new Set();
    for (const wave of waves) {
      if (!Number.isInteger(wave?.wave) || wave.wave < 1) add('wave-id-invalid', 'Every wave needs a positive integer wave number.', 'afk_waves');
      if (seenWaves.has(wave?.wave)) add('wave-id-duplicate', `Wave ${wave.wave} is duplicated.`, `wave ${wave.wave}`);
      seenWaves.add(wave?.wave);
      const ready = list(wave?.ready_tasks);
      const parallel = list(wave?.parallel_tasks);
      const mergeOrder = list(wave?.merge_order);
      for (const id of new Set([...ready, ...parallel, ...mergeOrder])) {
        const task = tasksById.get(id);
        if (!task) add('wave-task-missing', `Wave ${wave.wave} references missing task ${id}.`, `wave ${wave.wave}`);
        else if (Number(task.parallel_wave) !== wave.wave) add('wave-task-mismatch', `${id} is assigned to wave ${task.parallel_wave}, not ${wave.wave}.`, id);
      }
      if (new Set(mergeOrder).size !== mergeOrder.length) add('wave-merge-order-duplicate', `Wave ${wave.wave} merge_order contains duplicates.`, `wave ${wave.wave}`);
      for (const id of parallel) {
        if (text(tasksById.get(id)?.classification).toUpperCase() !== 'AFK') {
          add('parallel-task-not-afk', `${id} cannot run in parallel because it is not AFK.`, id);
        }
      }
      for (let left = 0; left < parallel.length; left += 1) {
        for (let right = left + 1; right < parallel.length; right += 1) {
          const a = tasksById.get(parallel[left]);
          const b = tasksById.get(parallel[right]);
          for (const aPath of list(a?.write_set)) {
            for (const bPath of list(b?.write_set)) {
              if (pathsOverlap(aPath, bPath)) {
                add('parallel-write-conflict', `${a.id} and ${b.id} overlap at ${aPath} / ${bPath}.`, `wave ${wave.wave}`);
              }
            }
          }
        }
      }
    }
    for (const task of tasks) {
      if (!seenWaves.has(Number(task.parallel_wave))) add('task-wave-missing', `${task.id} references missing wave ${task.parallel_wave}.`, task.id);
      for (const dependency of list(task.depends_on)) {
        const target = tasksById.get(dependency);
        if (target && Number(target.parallel_wave) >= Number(task.parallel_wave)) {
          add('task-dependency-wave-order', `${task.id} must run after dependency ${dependency}.`, task.id);
        }
      }
    }
  }

  const tasks = Array.isArray(graph?.tasks) ? graph.tasks : [];
  const reports = new Map(tasks.map((task) => [task.id, validateTaskReport(root, task)]));
  if (options.requireAllTasksCompleted === true) {
    for (const task of tasks) {
      const report = reports.get(task.id);
      if (report?.status !== 'complete') {
        add(
          'task-report-incomplete',
          `${task.id} cannot pass this gate because its task report is ${report?.status ?? 'missing'}: ${report?.errors?.join('; ') || 'completion evidence is absent'}.`,
          report?.path ?? task.report_path ?? task.id,
        );
      }
    }
  }
  const completedIds = new Set(options.completedTaskIds ?? tasks
    .filter((task) => reports.get(task.id)?.status === 'complete')
    .map((task) => task.id));
  const readiness = taskReadiness(tasks, completedIds, reports);
  return {
    schema: 'ewai.task-graph-check/v1',
    status: errors.length ? 'fail' : 'pass',
    slug: graph?.slug ?? options.slug ?? '',
    graphPath: relative(root, path).replaceAll('\\', '/'),
    checkedAt: now(),
    errors,
    warnings,
    tasks: readiness,
    readyTasks: readiness.filter((task) => task.status === 'ready').map((task) => task.id),
    completedTasks: readiness.filter((task) => task.status === 'completed').map((task) => task.id),
  };
}

export function renderTaskGraphCheck(result) {
  const findings = result.errors.length
    ? result.errors.map((error) => `- **${error.code}:** ${error.message}`).join('\n')
    : '- No task-graph safety failures found.';
  const rows = result.tasks.map((task) => (
    `| ${task.id} | ${task.status} | ${task.waitingFor.join(', ') || '—'} | ${task.requiresHuman ? 'yes' : 'no'} |`
  )).join('\n');
  return `# Task Graph Check — ${result.slug}\n\n**Verdict:** ${result.status.toUpperCase()}\n**Checked:** ${result.checkedAt}\n\n## Findings\n\n${findings}\n\n## Derived task readiness\n\n| Task | State | Waiting for | Human required |\n|---|---|---|---|\n${rows || '| — | — | — | — |'}\n`;
}

export function writeTaskGraphCheck(deliveryRoot, phase = 'pattern-validation', options = {}) {
  const root = resolve(deliveryRoot);
  const result = validateTaskGraph(root, {
    ...options,
    requireAllTasksCompleted: options.requireAllTasksCompleted ?? ['build', 'delivery'].includes(phase),
  });
  const gateRoot = resolve(root, 'gates', phase);
  if (!isWithin(root, gateRoot)) throw new Error(`Unsafe task-graph gate path: ${gateRoot}`);
  atomicJson(resolve(gateRoot, 'task-graph-check.json'), result);
  atomicText(resolve(gateRoot, 'task-graph-check.md'), renderTaskGraphCheck(result));
  return result;
}
