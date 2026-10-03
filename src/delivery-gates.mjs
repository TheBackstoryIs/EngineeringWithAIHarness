import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { atomicJson, isWithin, now, sha256 } from './delivery-documents.mjs';
import { writeTaskGraphCheck } from './task-graph.mjs';
import { policyGateRequirementsForPhase, readPolicyEvidenceFreshness } from './policy-gate-integration.mjs';
import { withIntentMutation, assertIntentMutation } from './runtime/intent-ownership.mjs';

const taskGraphPhases = new Set([
  'plan', 'pattern-validation', 'test-plan', 'build', 'delivery',
]);

const phaseGateIds = Object.freeze({
  ideate: ['phase-artifact-written'],
  intent: [
    'knowledge-onboard', 'standing-standards-read', 'intent-dependency-map',
    'intent-dependency-map-check', 'intent-code-disagreements', 'intent-summary-written',
  ],
  reconcile: [
    'repository-truth', 'current-behaviour', 'intent-dependency-map-check',
    'reconcile-disagreements', 'reconcile-artifact-written',
  ],
  'ui-design': [
    'design-system-read', 'reference-implementations-read',
    'ui-design-artifact-written', 'prototype-manifest-check',
  ],
  plan: [
    'task-graph-check', 'intent-dependency-map-check', 'discovery-notes',
    'scope-fit-check', 'repository-truth', 'implementation-flow-contract',
    'local-pattern-research', 'claim-ledger', 'claim-ledger-check',
    'plan-contract', 'plan-contract-check', 'plan-existence-check',
    'standards-coverage-check', 'build-contract-integrity', 'build-plan-source-edited',
  ],
  'pattern-validation': [
    'task-graph-check', 'repository-patterns-verified', 'intent-dependency-map-check',
    'implementation-flow-contract-check', 'local-pattern-research-check',
    'claim-ledger-check', 'plan-contract-check', 'plan-existence-check',
    'standards-coverage-check', 'plan-standards-sweep', 'build-contract-integrity',
  ],
  'test-plan': [
    'task-graph-check', 'test-standards-read', 'intent-to-test-traceability',
    'task-to-test-traceability', 'red-green-refactor-traceability',
    'claim-ledger-check', 'plan-contract-check', 'plan-existence-check',
    'standards-coverage-check', 'build-contract-integrity', 'test-plan-source-edited',
  ],
  'validate-external-plan': [
    'upstream-pattern-validation-gate-check', 'claim-ledger-check',
    'plan-contract-check', 'plan-existence-check', 'standards-coverage-check',
    'review-pack', 'findings-matrix', 'actions-log',
  ],
  'validate-external-test-plan': [
    'upstream-test-plan-gate-check', 'claim-ledger-check', 'plan-contract-check',
    'standards-coverage-check', 'review-pack', 'findings-matrix', 'actions-log',
  ],
  'fit-check': ['phase-artifact-written'],
  build: [
    'task-graph-check', 'fit-check-if-required', 'claim-ledger-check',
    'plan-contract-check', 'standards-coverage-check', 'build-contract-integrity',
    'build-plan-followed', 'changed-files-recorded',
  ],
  'standards-sweep': ['standards-sweep', 'standards-compliance-confirmed'],
  'test-execute': ['planned-tests-run', 'test-execute-report'],
  'validate-external-code': [
    'upstream-standards-sweep-gate-check', 'upstream-test-execute-gate-check',
    'review-pack', 'findings-matrix', 'actions-log',
  ],
  delivery: [
    'task-graph-check', 'delivery-preconditions', 'qa-then-fix',
    'manual-qa-walkthrough', 'delivery-checklist',
  ],
  retro: ['metrics-captured', 'knowledge-curation', 'pipeline-improvements', 'retro-written'],
});

const externalPhases = new Set([
  'validate-external-plan', 'validate-external-test-plan', 'validate-external-code',
]);

function expectedGateIds(phaseId, providers = [], policyRequirements = []) {
  const base = phaseGateIds[phaseId];
  if (!base) throw new Error(`Unknown EWAI phase gate contract: ${phaseId}`);
  if (!externalPhases.has(phaseId)) return [...base, ...policyRequirements.map(({ id }) => id)];
  const reviews = [...new Set(providers.map((provider) => String(provider).trim().toLowerCase()).filter(Boolean))]
    .map((provider) => `${provider}-review`);
  const reviewPack = base.indexOf('review-pack') + 1;
  return [...base.slice(0, reviewPack), ...reviews, ...base.slice(reviewPack)];
}

function expectedGateIdsAtPaths(paths, slug, phaseId, providers = []) {
  const policy = policyGateRequirementsForPhase(paths.projectRoot, slug, phaseId);
  return expectedGateIds(phaseId, providers, policy.requirements);
}

function gatePathFor(paths, phaseId) {
  return resolve(paths.gatesRoot, phaseId, 'gate-ledger.json');
}

function gateReportPathFor(paths, phaseId) {
  return resolve(paths.gatesRoot, phaseId, 'phase-gate-check.md');
}

function isRealWithin(root, path) {
  return isWithin(realpathSync(root), realpathSync(path));
}

export function evidenceAbsolute(projectRoot, path) {
  const absolute = isAbsolute(path) ? resolve(path) : resolve(projectRoot, path);
  if (!isWithin(projectRoot, absolute)) throw new Error(`Gate evidence must stay inside the project: ${path}`);
  if (!existsSync(absolute)) throw new Error(`Gate evidence does not exist: ${path}`);
  if (!statSync(absolute).isFile()) throw new Error(`Gate evidence must be a file: ${path}`);
  if (!isRealWithin(projectRoot, absolute)) throw new Error(`Gate evidence may not escape the project through a symbolic link: ${path}`);
  return absolute;
}

function renderGateReport(phaseId, errors) {
  const findings = errors.length
    ? errors.map((error) => `- ${error}`).join('\n')
    : '- Every required gate has fresh, project-local evidence.';
  return `# EWAI Phase Gate Check — ${phaseId}\n\n**Verdict:** ${errors.length ? 'FAIL' : 'PASS'}\n**Checked:** ${now()}\n\n## Findings\n\n${findings}\n`;
}

function validatePolicyGateEvidence(paths, phaseId, gate, items, errors) {
  const policyRequirements = policyGateRequirementsForPhase(paths.projectRoot, gate?.slug, phaseId).requirements;
  if (!policyRequirements.length) return;
  let state;
  try {
    state = JSON.parse(readFileSync(paths.statePath, 'utf8'));
  } catch (error) {
    errors.push(`organisation policy gate cannot read delivery truth: ${error.message}`);
    return;
  }
  for (const requirement of policyRequirements) {
    const item = items.get(requirement.id);
    if (!item || item.status !== 'pass') continue;
    if (item.output_path !== requirement.artefactPath) {
      errors.push(`gate ${requirement.id} must use canonical evidence ${requirement.artefactPath}.`);
      continue;
    }
    try {
      const freshness = readPolicyEvidenceFreshness(paths.projectRoot, state.intent?.id, {
        slug: gate.slug,
        phase: phaseId,
      });
      if (freshness.blocking || freshness.status !== 'current') {
        errors.push(`gate ${requirement.id} policy evidence is ${freshness.status}; ${freshness.recovery?.join(' ') || 'restore current non-blocking evidence.'}`);
      }
      const record = JSON.parse(readFileSync(resolve(paths.deliveryRoot, requirement.artefactPath), 'utf8'));
      if (record.blocking !== false || !['allow', 'allow-with-controls'].includes(record.status)) {
        errors.push(`gate ${requirement.id} policy result is blocking or unresolved.`);
      }
      if (phaseId === 'plan' && record.controlTrace?.status !== 'pass') {
        errors.push(`gate ${requirement.id} has no passing actionable control trace.`);
      }
    } catch (error) {
      errors.push(`gate ${requirement.id} policy evidence is invalid: ${error.message}`);
    }
  }
}

function validateGate(paths, phaseId, gate, providers = [], writeReport = true) {
  const errors = [];
  const expected = expectedGateIdsAtPaths(paths, gate?.slug, phaseId, providers);
  if (gate?.schema_version !== 1) errors.push('schema_version must be 1.');
  if (gate?.phase !== phaseId) errors.push(`phase must be ${phaseId}.`);
  if (gate?.mission !== 'be right, not done') errors.push('mission must be “be right, not done”.');
  if (gate?.status !== 'pass') errors.push('ledger status must be pass.');
  const honesty = gate?.honesty_check ?? {};
  for (const key of ['source_sections_edited', 'stale_text_removed', 'no_append_only_corrections', 'all_code_claims_cited']) {
    if (honesty[key] !== true) errors.push(`honesty_check.${key} must be true.`);
  }
  if (!Array.isArray(gate?.required_gates)) errors.push('required_gates must be an array.');
  const items = new Map((gate?.required_gates ?? []).map((item) => [item.id, item]));
  for (const id of expected) {
    const item = items.get(id);
    if (!item) {
      errors.push(`required gate ${id} is missing.`);
      continue;
    }
    if (item.status === 'not_applicable') {
      if (!String(item.rationale ?? '').trim()) errors.push(`gate ${id} is not applicable without a rationale.`);
      continue;
    }
    if (item.status !== 'pass') {
      errors.push(`gate ${id} is ${item.status ?? 'unrecorded'}.`);
      continue;
    }
    if (!String(item.command_or_skill ?? '').trim()) errors.push(`gate ${id} has no command_or_skill.`);
    if (item.exit_status !== 0) errors.push(`gate ${id} does not have exit_status 0.`);
    const evidencePath = resolve(paths.deliveryRoot, String(item.output_path ?? ''));
    if (!item.output_path || !isWithin(paths.deliveryRoot, evidencePath) || !existsSync(evidencePath)
      || !statSync(evidencePath).isFile() || !isRealWithin(paths.deliveryRoot, evidencePath)) {
      errors.push(`gate ${id} has no valid evidence file inside the delivery root.`);
    } else if (!item.evidence_hash || sha256(readFileSync(evidencePath)) !== item.evidence_hash) {
      errors.push(`gate ${id} evidence is missing its hash or has changed.`);
    }
  }
  for (const id of items.keys()) {
    if (!expected.includes(id)) errors.push(`unexpected gate ${id} is not in the ${phaseId} contract.`);
  }
  validatePolicyGateEvidence(paths, phaseId, gate, items, errors);
  if ((gate?.skipped_gates ?? []).length) errors.push('skipped_gates must be empty; use not_applicable with rationale instead.');
  if ((gate?.deterministic_gate_failures_found_by_external_review ?? []).length) {
    errors.push('deterministic gate failures found by external review remain unresolved.');
  }
  if (writeReport) {
    mkdirSync(dirname(gateReportPathFor(paths, phaseId)), { recursive: true });
    writeFileSync(gateReportPathFor(paths, phaseId), renderGateReport(phaseId, errors), 'utf8');
  }
  if (errors.length) {
    const report = writeReport ? ` See ${relative(paths.projectRoot, gateReportPathFor(paths, phaseId))}.` : '';
    throw new Error(`Phase ${phaseId} failed its EWAI deterministic gate check.${report}`);
  }
  return gate;
}

export function validatePhaseGateAtPaths(paths, phaseId, gate, options = {}) {
  return validateGate(paths, phaseId, gate, options.providers ?? [], false);
}

export function readPassingGate(paths, phaseId, options = {}) {
  const path = gatePathFor(paths, phaseId);
  if (!existsSync(path)) throw new Error(`Phase ${phaseId} requires a passing gate ledger: ${relative(paths.projectRoot, path)}`);
  const gate = JSON.parse(readFileSync(path, 'utf8'));
  validateGate(paths, phaseId, gate, options.providers ?? []);
  return { gate, path, sha256: sha256(readFileSync(path)) };
}

export function assertCompletedEvidenceFresh(paths, state) {
  for (const phase of [...state.phases, ...state.adjuncts]) {
    if (phase.status !== 'completed') continue;
    const path = gatePathFor(paths, phase.id);
    if (!existsSync(path)) throw new Error(`Phase ${phase.id} has no recorded EWAI gate ledger.`);
    const raw = readFileSync(path);
    if (!phase.gateSha256 || sha256(raw) !== phase.gateSha256) {
      throw new Error(`Phase ${phase.id} gate ledger changed after completion.`);
    }
    validateGate(paths, phase.id, JSON.parse(raw), phase.validation?.providers ?? state.providers ?? [], false);
  }
}

export function recordPhaseGateAtPaths(paths, slug, phaseId, input = {}, options = {}) {
  return withIntentMutation(paths.projectRoot, slug, { action: 'record-gate', phase: phaseId, input: { input, options }, ownership: input.ownership }, () => recordOwnedPhaseGateAtPaths(paths, slug, phaseId, input, options));
}

function recordOwnedPhaseGateAtPaths(paths, slug, phaseId, input, options) {
  let taskGraphCheck = null;
  if (taskGraphPhases.has(phaseId)) {
    taskGraphCheck = writeTaskGraphCheck(paths.deliveryRoot, phaseId, { slug });
    if (taskGraphCheck.status !== 'pass') {
      throw new Error(`Phase ${phaseId} failed deterministic task-graph validation. See ${relative(paths.projectRoot, resolve(paths.gatesRoot, phaseId, 'task-graph-check.md'))}.`);
    }
  }
  const expected = expectedGateIdsAtPaths(paths, slug, phaseId, options.providers ?? []);
  const supplied = new Map((Array.isArray(input.requiredGates) ? input.requiredGates : []).map((item) => [item.id, item]));
  const requiredGates = expected.map((id) => {
    const item = supplied.get(id) ?? { id };
    const taskGraphItem = taskGraphCheck && id === 'task-graph-check';
    const status = taskGraphItem ? 'pass' : item.status ?? 'blocked';
    let evidenceHash = '';
    let outputPath = taskGraphItem
      ? relative(paths.projectRoot, resolve(paths.gatesRoot, phaseId, 'task-graph-check.md')).replaceAll('\\', '/')
      : item.outputPath ?? '';
    if (status === 'pass') {
      const absolute = evidenceAbsolute(paths.projectRoot, outputPath);
      if (!isWithin(paths.deliveryRoot, absolute)) throw new Error(`Gate evidence must stay inside the delivery root: ${outputPath}`);
      outputPath = relative(paths.deliveryRoot, absolute).replaceAll('\\', '/');
      evidenceHash = sha256(readFileSync(absolute));
    }
    return {
      id,
      required: item.required !== false,
      command_or_skill: taskGraphItem ? 'ewai deterministic task-graph validator' : item.commandOrSkill ?? '',
      output_path: outputPath,
      exit_status: taskGraphItem ? 0 : item.exitStatus ?? (status === 'pass' ? 0 : null),
      status,
      evidence_hash: evidenceHash,
      rationale: item.rationale ?? '',
    };
  });
  const gate = {
    schema_version: 1,
    slug,
    phase: phaseId,
    mission: 'be right, not done',
    status: input.status ?? 'blocked',
    honesty_check: {
      source_sections_edited: input.honestyCheck?.sourceSectionsEdited === true,
      stale_text_removed: input.honestyCheck?.staleTextRemoved === true,
      no_append_only_corrections: input.honestyCheck?.noAppendOnlyCorrections === true,
      all_code_claims_cited: input.honestyCheck?.allCodeClaimsCited === true,
      notes: input.honestyCheck?.notes ?? '',
    },
    required_gates: requiredGates,
    skipped_gates: [],
    deterministic_gate_failures_found_by_external_review: input.deterministicGateFailures ?? [],
    generated_at: now(),
  };
  assertIntentMutation(paths.projectRoot, slug);
  if (gate.status === 'pass') validateGate(paths, phaseId, gate, options.providers ?? []);
  assertIntentMutation(paths.projectRoot, slug);
  atomicJson(gatePathFor(paths, phaseId), gate);
  return gate;
}

export function phaseGateTemplateAtPaths(paths, slug, phaseId, options = {}) {
  return {
    schema_version: 1,
    slug,
    phase: phaseId,
    mission: 'be right, not done',
    status: 'blocked',
    honesty_check: {
      source_sections_edited: false,
      stale_text_removed: false,
      no_append_only_corrections: false,
      all_code_claims_cited: false,
      notes: '',
    },
    required_gates: expectedGateIdsAtPaths(paths, slug, phaseId, options.providers ?? []).map((id) => ({
      id, required: true, command_or_skill: '', output_path: '', exit_status: null,
      status: 'blocked', evidence_hash: '', rationale: '',
    })),
    skipped_gates: [],
    deterministic_gate_failures_found_by_external_review: [],
  };
}
