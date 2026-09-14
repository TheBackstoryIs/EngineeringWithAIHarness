import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { readPortfolioResolution } from './portfolio.mjs';
import { projectPaths } from './paths.mjs';
import { loadProjectConfig } from './project.mjs';
import { ASSURANCE_NOTICE, normaliseSecurityValidationConfig } from './security-validation-config.mjs';
import { selectContextualPersonas } from './runtime/persona-engagement.mjs';
import { listSecurityRuns } from './runtime/security-validation.mjs';

export const ROLLOUT_SCHEMA = 'ewai.rollout/v1';
export const ROLLOUT_WORKSPACE_SCHEMA = 'ewai.rollout-workspace/v1';
export const ROLLOUT_ASSURANCE_NOTICE = ASSURANCE_NOTICE;
export const ROLLOUT_ADVISORY_NOTICE = 'Rollout and persona analysis is advisory. Organisation Blueprint adoption, evidence adequacy, accepted risk, Manual QA, deployment and release decisions remain with named accountable humans.';

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_CHILD_FILE_BYTES = 512 * 1024;
const EVIDENCE_CLASSES = Object.freeze(['blueprint', 'delivery', 'standards', 'manual-qa', 'security']);
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100);
const boundedText = (maximum) => z.string().trim().min(1).max(maximum);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const packSchema = z.object({
  id: z.string().regex(/^org\.[a-z0-9-]+\.[a-z0-9.-]+$/).max(160),
  version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/).max(40),
  digest: digest.optional(),
}).strict();
const baselineSchema = z.object({
  id: slug,
  name: boundedText(160),
  owner: boundedText(160),
  pack: packSchema,
}).strict();
const assignmentSchema = z.object({
  id: slug,
  owner: boundedText(160),
  review_owner: boundedText(160).optional(),
}).strict();
const reviewDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}, 'Review date must be a valid ISO date.');
const cohortSchema = z.object({
  id: slug,
  name: boundedText(160),
  baseline: slug,
  owner: boundedText(160),
  review_by: reviewDate,
  required_evidence: z.array(z.enum(EVIDENCE_CLASSES)).min(1).max(5),
  projects: z.array(assignmentSchema).min(1).max(100),
}).strict();
const manifestSchema = z.object({
  schema: z.literal(ROLLOUT_SCHEMA),
  id: slug,
  name: boundedText(160),
  owner: boundedText(160),
  stale_after_days: z.number().int().min(1).max(3650),
  baselines: z.array(baselineSchema).min(1).max(25),
  cohorts: z.array(cohortSchema).min(1).max(50),
}).strict();

function diagnostic(code, message, path = '') {
  return { code, message, ...(path ? { path } : {}) };
}

function duplicate(values) {
  const seen = new Set();
  return values.find((value) => seen.has(value) || !seen.add(value));
}

export function validateRolloutManifest(input, options = {}) {
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      diagnostics: parsed.error.issues.map((issue) => diagnostic('rollout.schema', issue.message, issue.path.join('.'))),
    };
  }
  const manifest = parsed.data;
  const diagnostics = [];
  const duplicateBaseline = duplicate(manifest.baselines.map((baseline) => baseline.id));
  if (duplicateBaseline) diagnostics.push(diagnostic('rollout.duplicate-baseline', `Duplicate baseline ID: ${duplicateBaseline}`, 'baselines'));
  const duplicateCohort = duplicate(manifest.cohorts.map((cohort) => cohort.id));
  if (duplicateCohort) diagnostics.push(diagnostic('rollout.duplicate-cohort', `Duplicate cohort ID: ${duplicateCohort}`, 'cohorts'));
  const baselineIds = new Set(manifest.baselines.map((baseline) => baseline.id));
  const assignments = [];
  for (const cohort of manifest.cohorts) {
    if (!baselineIds.has(cohort.baseline)) diagnostics.push(diagnostic('rollout.unknown-baseline', `Cohort ${cohort.id} references an unknown baseline.`, `cohorts.${cohort.id}.baseline`));
    const duplicateEvidence = duplicate(cohort.required_evidence);
    if (duplicateEvidence) diagnostics.push(diagnostic('rollout.duplicate-evidence', `Cohort ${cohort.id} repeats evidence class ${duplicateEvidence}.`, `cohorts.${cohort.id}.required_evidence`));
    assignments.push(...cohort.projects.map((project) => ({ id: project.id, cohort: cohort.id })));
  }
  if (assignments.length > 100) diagnostics.push(diagnostic('rollout.assignment-limit', 'Rollout policy may contain at most 100 project assignments.', 'cohorts'));
  const duplicateAssignment = duplicate(assignments.map((assignment) => assignment.id));
  if (duplicateAssignment) diagnostics.push(diagnostic('rollout.duplicate-assignment', `Project ${duplicateAssignment} may be assigned to one cohort only.`, 'cohorts'));
  if (Array.isArray(options.portfolioProjectIds)) {
    const allowed = new Set(options.portfolioProjectIds);
    for (const assignment of assignments) {
      if (!allowed.has(assignment.id)) diagnostics.push(diagnostic('rollout.unknown-project', `Project ${assignment.id} is not a Portfolio project member.`, `cohorts.${assignment.cohort}.projects`));
    }
  }
  return { valid: diagnostics.length === 0, diagnostics, manifest };
}

function personaAvailability(catalogue) {
  const counts = Object.fromEntries(['project', 'core', 'personal', 'premium'].map((tier) => [tier, catalogue.filter((persona) => String(persona?.tier ?? 'core') === tier).length]));
  return {
    baseline: { available: true, method: 'standard-llm-with-installed-project-and-core-personas' },
    project: { installed: counts.project > 0, count: counts.project },
    core: { installed: counts.core > 0, count: counts.core },
    personal: { installed: counts.personal > 0, count: counts.personal, required: false },
    premium: { installed: counts.premium > 0, count: counts.premium, required: false, syncAttempted: false },
  };
}

function baseWorkspace(catalogue) {
  return {
    schema: ROLLOUT_WORKSPACE_SCHEMA,
    policy: null,
    portfolio: null,
    diagnostics: [],
    cohorts: [],
    selectedAssurance: null,
    activePersonas: [],
    personaAvailability: personaAvailability(catalogue),
    review: {
      standardLlmAvailable: true,
      questions: [
        'Which declared baseline difference needs a named project-owner decision?',
        'Which required evidence is unavailable, stale, missing or not configured?',
        'Which conclusion is observed evidence and which is a persona hypothesis?',
        'Who owns the next topology, adoption or assurance action?',
      ],
      evidenceClasses: ['declared-policy', 'observed-project-evidence', 'automated-check', 'persona-hypothesis', 'human-decision'],
    },
    notices: { advisory: ROLLOUT_ADVISORY_NOTICE, security: ROLLOUT_ASSURANCE_NOTICE },
    guide: 'Docs/consultancy-network-rollout-control-plane-guide.md',
  };
}

function boundedFocus(value) {
  const focus = String(value ?? '').trim();
  if (focus.length > 500 || focus.includes('\0')) throw new Error('Rollout focus must be safe text of at most 500 characters.');
  return focus;
}

function boundedRead(path, label) {
  if (lstatSync(path).isSymbolicLink() || statSync(path).size > MAX_CHILD_FILE_BYTES) throw new Error(`${label} is unavailable or exceeds its size limit.`);
  return readFileSync(path, 'utf8');
}

function freshness(updatedAt, nowValue, staleAfterDays) {
  const updated = Date.parse(String(updatedAt ?? ''));
  const now = Date.parse(String(nowValue ?? ''));
  if (!Number.isFinite(updated) || !Number.isFinite(now)) return { state: 'missing', observedAt: updatedAt || null };
  const ageDays = Math.max(0, Math.floor((now - updated) / 86_400_000));
  return { state: ageDays > staleAfterDays ? 'stale' : 'present', observedAt: updatedAt, ageDays };
}

function latestDelivery(specsRoot) {
  const buildRoot = resolve(specsRoot, '6.Build');
  if (!existsSync(buildRoot) || lstatSync(buildRoot).isSymbolicLink()) return null;
  const records = [];
  for (const entry of readdirSync(buildRoot, { withFileTypes: true }).slice(0, 200)) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const path = resolve(buildRoot, entry.name, 'delivery-state.json');
    if (!existsSync(path)) continue;
    try {
      const state = JSON.parse(boundedRead(path, 'Delivery state'));
      if (state.schema !== 'ewai.delivery-state/v1') continue;
      const manualQa = (state.humanGates ?? []).find((gate) => gate.id === 'manual-qa');
      records.push({
        status: String(state.status ?? 'unknown').slice(0, 80),
        currentPhase: String(state.currentPhase ?? 'unknown').slice(0, 80),
        updatedAt: String(state.updatedAt ?? '').slice(0, 80) || null,
        buildApproved: Boolean(state.approvals?.build),
        manualQa: String(manualQa?.status ?? 'missing').slice(0, 80),
      });
    } catch {
      // An unreadable record is not promoted into aggregate evidence.
    }
  }
  return records.sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))[0] ?? null;
}

function hasStandards(specsRoot) {
  const root = resolve(specsRoot, '4.Constraints/standards');
  if (!existsSync(root) || lstatSync(root).isSymbolicLink()) return false;
  const queue = [{ root, depth: 0 }];
  let inspected = 0;
  while (queue.length && inspected < 200) {
    const current = queue.shift();
    for (const entry of readdirSync(current.root, { withFileTypes: true })) {
      inspected += 1;
      if (entry.isSymbolicLink()) continue;
      if (entry.isFile() && entry.name.endsWith('.md')) return true;
      if (entry.isDirectory() && current.depth < 6) queue.push({ root: resolve(current.root, entry.name), depth: current.depth + 1 });
      if (inspected >= 200) break;
    }
  }
  return false;
}

function safeBlueprint(config) {
  const pin = config?.blueprints?.organisation?.root;
  const parsed = packSchema.safeParse(pin);
  return parsed.success ? parsed.data : null;
}

function securityEvidence(childRoot, config, nowValue) {
  let policy;
  try {
    policy = normaliseSecurityValidationConfig(config);
  } catch {
    return { state: 'unavailable', configured: false, profileCount: 0, latestRun: null, limitation: 'Security configuration is invalid or unavailable.' };
  }
  if (!policy.enabled) return { state: 'not-configured', configured: false, profileCount: 0, latestRun: null, limitation: 'Security validation is not configured for this project.' };
  try {
    const latest = listSecurityRuns(childRoot).runs[0] ?? null;
    if (!latest) return { state: 'missing', configured: true, profileCount: policy.profiles.length, latestRun: null, limitation: 'Security validation is configured but no run evidence is available.' };
    const requiredHours = Math.min(...policy.profiles.map((profile) => profile.freshness_hours));
    const observed = freshness(latest.completedAt, nowValue, requiredHours / 24);
    return {
      state: latest.complete ? observed.state : 'missing',
      configured: true,
      profileCount: policy.profiles.length,
      latestRun: { status: latest.status, complete: latest.complete, outcome: latest.outcome, completedAt: latest.completedAt },
      limitation: 'Structural run state only; detailed provider output and adequacy are not projected.',
    };
  } catch {
    return { state: 'unavailable', configured: true, profileCount: policy.profiles.length, latestRun: null, limitation: 'Security run metadata is unavailable.' };
  }
}

function unavailableProject(assignment, portfolioMember, requiredEvidence, portfolioOwner) {
  return {
    id: assignment.id,
    name: portfolioMember?.name ?? assignment.id,
    owner: assignment.owner,
    reviewOwner: assignment.review_owner ?? assignment.owner,
    expectedBlueprint: null,
    observedBlueprint: null,
    adoption: { state: 'unavailable', reason: 'The Portfolio project root is unavailable.', evidenceClass: 'observed-project-evidence' },
    evidence: requiredEvidence.map((item) => ({ class: item, state: 'unavailable', limitation: 'Project-owned evidence is unavailable.' })),
    limitations: ['The project could not be read through the configured Portfolio topology.'],
    nextRoute: { owner: assignment.owner, topologyOwner: portfolioOwner, action: 'Restore Portfolio topology or project availability, then refresh the read-only snapshot.', evidenceClass: 'human-decision' },
  };
}

function projectSnapshot(member, assignment, baseline, cohort, portfolioOwner, options) {
  if (!member?.root) return unavailableProject(assignment, member, cohort.required_evidence, portfolioOwner);
  try {
    const loaded = loadProjectConfig(member.root);
    const observedBlueprint = safeBlueprint(loaded.config);
    const delivery = latestDelivery(loaded.paths.specsRoot);
    const deliveryFreshness = freshness(delivery?.updatedAt, options.now, options.staleAfterDays);
    const security = securityEvidence(member.root, loaded.config, options.now);
    const evidenceByClass = {
      blueprint: { state: observedBlueprint ? 'present' : 'missing', limitation: 'Exact project-owned Blueprint pin only; receipt bodies are not projected.' },
      delivery: { state: delivery ? deliveryFreshness.state : 'missing', observedAt: delivery?.updatedAt ?? null, limitation: 'Latest structural delivery state only.' },
      standards: { state: hasStandards(loaded.paths.specsRoot) ? 'present' : 'missing', limitation: 'Standards presence only; content and adequacy are not projected.' },
      'manual-qa': { state: ['approved', 'completed', 'passed'].includes(delivery?.manualQa) ? 'present' : 'missing', limitation: 'Named-human gate state only; evidence bodies are not projected.' },
      security,
    };
    let adoption;
    if (delivery && deliveryFreshness.state === 'stale') adoption = { state: 'stale', reason: 'Project delivery evidence is older than the rollout freshness window.' };
    else if (!observedBlueprint) adoption = { state: 'not-adopted', reason: 'No project-owned Organisation Blueprint pin is present.' };
    else {
      const expected = baseline.pack;
      const exact = observedBlueprint.id === expected.id
        && observedBlueprint.version === expected.version
        && (expected.digest === undefined || observedBlueprint.digest === expected.digest);
      adoption = exact
        ? { state: 'aligned', reason: 'The project-owned Blueprint pin exactly matches the declared baseline.' }
        : { state: 'review-required', reason: 'The project-owned Blueprint pin differs from the declared baseline; exact comparison does not infer compatibility or version precedence.' };
    }
    const evidence = cohort.required_evidence.map((item) => ({ class: item, ...evidenceByClass[item] }));
    const unresolved = adoption.state !== 'aligned' || evidence.some((item) => item.state !== 'present');
    return {
      id: assignment.id,
      name: member.name,
      owner: assignment.owner,
      reviewOwner: assignment.review_owner ?? assignment.owner,
      expectedBlueprint: baseline.pack,
      observedBlueprint,
      adoption: { ...adoption, evidenceClass: 'automated-check' },
      evidence,
      delivery: delivery ? { status: delivery.status, currentPhase: delivery.currentPhase, updatedAt: delivery.updatedAt, buildApproved: delivery.buildApproved, manualQa: delivery.manualQa } : null,
      limitations: evidence.filter((item) => item.state !== 'present').map((item) => `${item.class}: ${item.limitation}`),
      nextRoute: {
        owner: assignment.review_owner ?? assignment.owner,
        topologyOwner: portfolioOwner,
        action: unresolved ? 'Review the project-owned adoption or evidence gap.' : 'No aggregate action; project governance retains the next decision.',
        evidenceClass: 'human-decision',
      },
    };
  } catch {
    return { ...unavailableProject(assignment, member, cohort.required_evidence, portfolioOwner), adoption: { state: 'invalid', reason: 'Project configuration or evidence is invalid.', evidenceClass: 'observed-project-evidence' } };
  }
}

export function readRolloutWorkspace(projectRoot, options = {}) {
  const root = resolve(projectRoot);
  const catalogue = Array.isArray(options.personas) ? options.personas : Array.isArray(options.personaCatalogue) ? options.personaCatalogue : [];
  const base = baseWorkspace(catalogue);
  const focus = boundedFocus(options.focus);
  let paths;
  try {
    paths = projectPaths(root);
  } catch {
    return { ...base, status: 'invalid', diagnostics: [diagnostic('rollout.project-root', 'The EWAI project root is invalid.')] };
  }
  const policyPath = resolve(paths.specsRoot, '1.Scope/rollout.yaml');
  if (!existsSync(policyPath)) return { ...base, status: 'not-configured' };
  if (lstatSync(policyPath).isSymbolicLink() || statSync(policyPath).size > MAX_MANIFEST_BYTES) {
    return { ...base, status: 'invalid', diagnostics: [diagnostic('rollout.policy-file', 'Rollout policy is symbolic or exceeds its size limit.')] };
  }
  let raw;
  try {
    raw = YAML.parse(readFileSync(policyPath, 'utf8'));
  } catch {
    return { ...base, status: 'invalid', diagnostics: [diagnostic('rollout.policy-yaml', 'Rollout policy is invalid YAML.')] };
  }
  const portfolioRead = readPortfolioResolution(root, { allowUnavailableProjects: true });
  if (portfolioRead.status !== 'ready') {
    return { ...base, status: 'invalid', diagnostics: [diagnostic('rollout.portfolio', 'A valid Portfolio is required before rollout status can be derived.')] };
  }
  const projectMembers = portfolioRead.resolution.members.filter((member) => member.kind === 'project');
  const validation = validateRolloutManifest(raw, { portfolioProjectIds: projectMembers.map((member) => member.id) });
  if (!validation.valid) return { ...base, status: 'invalid', diagnostics: validation.diagnostics };
  const manifest = validation.manifest;
  const baselines = new Map(manifest.baselines.map((baseline) => [baseline.id, baseline]));
  const portfolioMembers = new Map(projectMembers.map((member) => [member.id, member]));
  const now = options.now ?? new Date().toISOString();
  const cohorts = manifest.cohorts.map((cohort) => {
    const baseline = baselines.get(cohort.baseline);
    return {
      id: cohort.id,
      name: cohort.name,
      owner: cohort.owner,
      reviewBy: cohort.review_by,
      requiredEvidence: [...cohort.required_evidence],
      baseline: { id: baseline.id, name: baseline.name, owner: baseline.owner, pack: baseline.pack },
      projects: cohort.projects.map((assignment) => projectSnapshot(
        portfolioMembers.get(assignment.id), assignment, baseline, cohort,
        portfolioRead.resolution.manifest.owner,
        { now, staleAfterDays: manifest.stale_after_days },
      )),
    };
  });
  const projects = cohorts.flatMap((cohort) => cohort.projects.map((project) => ({ cohort, project })));
  let selectedAssurance = null;
  if (options.projectId !== undefined) {
    const projectId = String(options.projectId ?? '').trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(projectId) || projectId.length > 100) throw new Error('Rollout project ID is invalid or unassigned.');
    const selected = projects.find((candidate) => candidate.project.id === projectId);
    if (!selected) throw new Error('Rollout project ID is invalid or unassigned.');
    selectedAssurance = {
      project: selected.project,
      cohort: { id: selected.cohort.id, name: selected.cohort.name, owner: selected.cohort.owner, reviewBy: selected.cohort.reviewBy },
      structuralOnly: true,
      adequacyVerdict: null,
    };
  }
  const signals = [
    'rollout', 'adoption', manifest.name, manifest.owner, focus,
    ...(selectedAssurance ? [selectedAssurance.project.name, selectedAssurance.project.adoption.state] : []),
  ];
  const activePersonas = selectContextualPersonas({
    signals,
    context: { rollout: manifest.id, focus, selectedProject: selectedAssurance?.project.id ?? null },
    contextLabel: focus ? `rollout context: ${focus.slice(0, 120)}` : 'rollout adoption and accountable ownership',
    personaCatalogue: catalogue,
    limit: 3,
  });
  const attention = cohorts.some((cohort) => cohort.projects.some((project) => project.adoption.state !== 'aligned' || project.evidence.some((item) => item.state !== 'present')));
  return {
    ...base,
    status: attention ? 'attention' : 'ready',
    policy: { id: manifest.id, name: manifest.name, owner: manifest.owner, staleAfterDays: manifest.stale_after_days },
    portfolio: { id: portfolioRead.resolution.manifest.id, name: portfolioRead.resolution.manifest.name, owner: portfolioRead.resolution.manifest.owner },
    cohorts,
    selectedAssurance,
    activePersonas,
  };
}
