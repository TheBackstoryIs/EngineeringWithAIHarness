import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { projectPaths } from './paths.mjs';
import { ASSURANCE_NOTICE } from './security-validation-config.mjs';
import { selectContextualPersonas } from './runtime/persona-engagement.mjs';
import {
  repositoryIndexFreshness,
  repositorySourceMapCoverage,
  repositorySourceMapFiles,
  repositorySourceMapProfiles
} from './runtime/repository-index.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultFamiliesPath = resolve(moduleDir, '../config/archaeology-record-families.yaml');
const terminalStatuses = new Set(['created', 'not-applicable', 'blocked']);
const reviewDecisions = new Set(['accepted', 'accepted-with-corrections', 'rejected', 'deferred']);
const personaPasses = [
  'purpose-and-actors',
  'user-processes',
  'domain-and-data',
  'architecture-and-integrations',
  'security-and-trust',
  'operations-and-assurance',
  'code-quality'
];
const baselinePersonaIds = ['ewai.core.archaeologist', 'ewai.core.specs-knowledge-curator'];

function inside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function parseYaml(path, label, errors) {
  if (!existsSync(path)) {
    errors.push(`Missing ${label}: ${path}`);
    return null;
  }
  try {
    return YAML.parse(readFileSync(path, 'utf8')) ?? {};
  } catch (error) {
    errors.push(`Invalid ${label}: ${error.message}`);
    return null;
  }
}

function substantive(value, minimum = 20) {
  return typeof value === 'string' && value.trim().length >= minimum;
}

function isoTimestamp(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function archaeologyBundleRoot(projectRoot, bundlePath) {
  const paths = projectPaths(projectRoot);
  const archaeologyRoot = resolve(paths.specsRoot, '3.Evidence/archaeology');
  const bundleRoot = resolve(paths.projectRoot, bundlePath);
  if (!inside(archaeologyRoot, bundleRoot)) throw new Error('Archaeology bundle must be under SPECS/3.Evidence/archaeology');
  return bundleRoot;
}

function personaRoutingErrors(routing) {
  const errors = [];
  if (!routing || routing.schema !== 'ewai.archaeology-persona-routing/v1') {
    return ['Persona routing must use schema ewai.archaeology-persona-routing/v1'];
  }

  const inventory = Array.isArray(routing.inventory) ? routing.inventory : [];
  const personaIds = new Set(inventory.map((persona) => String(persona?.id ?? '').trim()).filter(Boolean));
  if (!inventory.length) errors.push('Persona routing requires an installed persona inventory');
  for (const baseline of baselinePersonaIds) {
    if (!personaIds.has(baseline)) errors.push(`Persona routing inventory is missing baseline persona ${baseline}`);
  }

  if (routing.reconnaissance?.status !== 'complete') errors.push('Persona routing requires completed initial reconnaissance');
  if (!substantive(routing.reconnaissance?.summary)) errors.push('Persona routing reconnaissance requires a substantive summary');
  if (!Array.isArray(routing.reconnaissance?.evidence) || !routing.reconnaissance.evidence.length) {
    errors.push('Persona routing reconnaissance requires evidence references');
  }

  const assessments = Array.isArray(routing.assessments) ? routing.assessments : [];
  const assessmentsByPass = new Map(assessments.map((assessment) => [assessment?.pass, assessment]));
  for (const pass of personaPasses) {
    const assessment = assessmentsByPass.get(pass);
    if (!assessment) {
      errors.push(`Persona routing is missing assessment pass ${pass}`);
      continue;
    }
    if (assessment.status !== 'assessed') errors.push(`Persona routing pass ${pass} has not been assessed`);
    if (!substantive(assessment.rationale)) errors.push(`Persona routing pass ${pass} requires a substantive rationale`);
    if (!substantive(assessment.expected_benefit)) errors.push(`Persona routing pass ${pass} requires an expected-benefit statement`);
    const recommendedPersonas = Array.isArray(assessment.recommended_personas) ? assessment.recommended_personas : [];
    if (!Array.isArray(assessment.recommended_personas)) errors.push(`Persona routing pass ${pass} requires a recommended-personas list`);
    for (const persona of recommendedPersonas) {
      if (!personaIds.has(persona)) errors.push(`Persona routing pass ${pass} references unavailable persona ${persona}`);
    }
  }

  const review = routing.user_review ?? {};
  if (review.presented_to_user !== true) errors.push('Persona recommendations must be presented to the user before deep Archaeology');
  if (!substantive(review.presented_summary)) errors.push('Persona routing requires the concise recommendation summary shown to the user');
  if (!['confirmed', 'declined'].includes(review.status)) errors.push('Persona routing requires a confirmed or declined user decision');
  if (!substantive(review.decided_by, 2)) errors.push('Persona routing requires an accountable decision maker');
  if (!review.decided_at) errors.push('Persona routing requires a decision timestamp');
  else if (!isoTimestamp(review.decided_at)) errors.push('Persona routing decision timestamp must be ISO-8601');
  if (review.status === 'declined' && !substantive(review.notes)) errors.push('A declined persona ensemble requires explanatory notes');

  const selected = Array.isArray(review.selected_personas) ? review.selected_personas : [];
  if (review.status === 'confirmed' && !selected.some((persona) => !baselinePersonaIds.includes(persona))) {
    errors.push('A confirmed persona ensemble must select at least one non-baseline advisory persona');
  }
  if (review.status === 'declined' && selected.length) errors.push('A declined persona ensemble cannot contain selected personas');
  for (const persona of selected) {
    if (!personaIds.has(persona)) errors.push(`Persona routing selects unavailable persona ${persona}`);
  }

  const assignments = Array.isArray(routing.assignments) ? routing.assignments : [];
  if (review.status === 'declined' && assignments.length) errors.push('A declined persona ensemble cannot contain persona assignments');
  const allowedAssignments = new Set([...baselinePersonaIds, ...selected]);
  for (const assignment of assignments) {
    if (!personaIds.has(assignment?.persona)) errors.push(`Persona assignment references unavailable persona ${assignment?.persona || '(missing)'}`);
    if (!allowedAssignments.has(assignment?.persona)) errors.push(`Persona assignment uses unconfirmed persona ${assignment?.persona || '(missing)'}`);
    if (!personaPasses.includes(assignment?.pass)) errors.push(`Persona assignment has unknown pass ${assignment?.pass || '(missing)'}`);
    if (!substantive(assignment?.contribution)) errors.push(`Persona assignment for ${assignment?.persona || '(missing)'} requires an expected contribution`);
  }
  if (review.status === 'confirmed') {
    const assigned = new Set(assignments.map((assignment) => assignment?.persona));
    for (const persona of selected) {
      if (!assigned.has(persona)) errors.push(`Selected persona ${persona} has no analysis-pass assignment`);
    }
  }
  return errors;
}

export function prepareArchaeologyPersonaGate(projectRoot, bundlePath, personas, options = {}) {
  const bundleRoot = archaeologyBundleRoot(projectRoot, bundlePath);
  const routingPath = resolve(bundleRoot, 'persona-routing.yaml');
  if (existsSync(routingPath) && !options.force) {
    throw new Error('Archaeology persona routing already exists; preserve the user decision or use an explicitly approved force refresh');
  }

  const unique = new Map();
  for (const persona of personas ?? []) {
    const id = String(persona?.id ?? '').trim();
    if (!id) continue;
    unique.set(id, {
      id,
      name: persona.name || id,
      description: persona.description || '',
      category: persona.category || '',
      tier: persona.tier || '',
      tags: Array.isArray(persona.tags) ? persona.tags : [],
      capabilities: Array.isArray(persona.capabilities) ? persona.capabilities : []
    });
  }
  const inventory = [...unique.values()].sort((left, right) => left.name.localeCompare(right.name));
  const countsByTier = {};
  for (const persona of inventory) countsByTier[persona.tier || 'unspecified'] = (countsByTier[persona.tier || 'unspecified'] ?? 0) + 1;

  const routing = {
    schema: 'ewai.archaeology-persona-routing/v1',
    status: 'awaiting-assessment',
    library_summary: { total: inventory.length, by_tier: countsByTier },
    baseline_personas: baselinePersonaIds,
    inventory,
    reconnaissance: { status: 'pending', summary: '', evidence: [] },
    assessments: personaPasses.map((pass) => ({
      pass,
      status: 'pending',
      recommended_personas: [],
      rationale: '',
      expected_benefit: '',
      perspective_gaps: []
    })),
    assignments: [],
    user_review: {
      presented_to_user: false,
      presented_summary: '',
      status: 'pending',
      selected_personas: [],
      decided_by: null,
      decided_at: null,
      notes: ''
    }
  };
  mkdirSync(bundleRoot, { recursive: true });
  writeFileSync(routingPath, YAML.stringify(routing, { lineWidth: 0 }), 'utf8');
  return {
    schema: 'ewai.archaeology-persona-preparation/v1',
    bundleRoot,
    routingPath,
    personaCount: inventory.length,
    passes: personaPasses
  };
}

export function validateArchaeologyPersonaGate(projectRoot, bundlePath) {
  let bundleRoot;
  try {
    bundleRoot = archaeologyBundleRoot(projectRoot, bundlePath);
  } catch (error) {
    return { schema: 'ewai.archaeology-persona-validation/v1', valid: false, errors: [error.message] };
  }
  const errors = [];
  const routing = parseYaml(resolve(bundleRoot, 'persona-routing.yaml'), 'persona routing', errors);
  if (routing) errors.push(...personaRoutingErrors(routing));
  return {
    schema: 'ewai.archaeology-persona-validation/v1',
    valid: errors.length === 0,
    bundleRoot,
    errors
  };
}

export function validateArchaeologyBundle(projectRoot, bundlePath, options = {}) {
  const errors = [];
  const warnings = [];
  const paths = projectPaths(projectRoot);
  const archaeologyRoot = resolve(paths.specsRoot, '3.Evidence/archaeology');
  const bundleRoot = resolve(paths.projectRoot, bundlePath);
  if (!inside(archaeologyRoot, bundleRoot)) {
    return {
      schema: 'ewai.archaeology-validation/v1',
      valid: false,
      errors: ['Archaeology bundle must be under SPECS/3.Evidence/archaeology'],
      warnings,
      bundleRoot
    };
  }

  const families = parseYaml(options.familiesPath ?? defaultFamiliesPath, 'record-family contract', errors);
  const capabilityCatalog = parseYaml(resolve(bundleRoot, 'capability-catalog.yaml'), 'capability catalog', errors);
  const coverageLedger = parseYaml(resolve(bundleRoot, 'coverage-ledger.yaml'), 'coverage ledger', errors);
  const reconstructionLedger = parseYaml(resolve(bundleRoot, 'specs-reconstruction-ledger.yaml'), 'SPECS reconstruction ledger', errors);
  const manifest = parseYaml(resolve(bundleRoot, 'archaeology-artifact-manifest.yaml'), 'archaeology artefact manifest', errors);
  const personaRouting = parseYaml(resolve(bundleRoot, 'persona-routing.yaml'), 'persona routing', errors);

  if (!families || !capabilityCatalog || !coverageLedger || !reconstructionLedger || !manifest || !personaRouting) {
    return {
      schema: 'ewai.archaeology-validation/v1',
      valid: false,
      errors,
      warnings,
      bundleRoot
    };
  }
  errors.push(...personaRoutingErrors(personaRouting));

  if (manifest.depth !== families.depth) {
    errors.push(`Manifest depth must be ${families.depth}`);
  }
  if (capabilityCatalog.schema !== 'ewai.archaeology-capability-catalog/v1') {
    errors.push('Capability catalog must use schema ewai.archaeology-capability-catalog/v1');
  }
  if (coverageLedger.schema !== 'ewai.archaeology-coverage-ledger/v1') {
    errors.push('Coverage ledger must use schema ewai.archaeology-coverage-ledger/v1');
  }
  if (reconstructionLedger.schema !== 'ewai.specs-reconstruction-ledger/v1') {
    errors.push('SPECS reconstruction ledger must use schema ewai.specs-reconstruction-ledger/v1');
  }
  if (manifest.schema !== 'ewai.archaeology-artifact-manifest/v1') {
    errors.push('Artefact manifest must use schema ewai.archaeology-artifact-manifest/v1');
  }
  const coveredSurfaces = Array.isArray(coverageLedger.surfaces) ? coverageLedger.surfaces : [];
  const coverageStatuses = new Set(['mapped', 'partial', 'blocked', 'not-applicable']);
  if (!coveredSurfaces.length) errors.push('Coverage ledger must contain material surfaces');
  for (const surface of coveredSurfaces) {
    if (!surface?.id || !surface?.surface) errors.push('Every coverage surface requires an id and name');
    if (surface?.status === 'unexamined') errors.push(`Coverage surface ${surface.id || '(unknown)'} remains unexamined`);
    else if (!coverageStatuses.has(surface?.status)) errors.push(`Coverage surface ${surface.id || '(unknown)'} has invalid status ${surface?.status || '(missing)'}`);
    if (surface?.status === 'partial') {
      if (!substantive(surface?.limitation)) errors.push(`Partial coverage surface ${surface.id || '(unknown)'} requires a substantive limitation`);
      if (!substantive(surface?.review_owner, 3)) errors.push(`Partial coverage surface ${surface.id || '(unknown)'} requires a review owner`);
      if (surface?.review_status !== 'accepted') errors.push(`Partial coverage surface ${surface.id || '(unknown)'} requires an accepted limitation`);
    }
    if (surface?.status === 'blocked') {
      if (!substantive(surface?.rationale)) errors.push(`Blocked coverage surface ${surface.id || '(unknown)'} requires a substantive rationale`);
      if (!substantive(surface?.review_owner, 3)) errors.push(`Blocked coverage surface ${surface.id || '(unknown)'} requires a review owner`);
      if (!substantive(surface?.next_action)) errors.push(`Blocked coverage surface ${surface.id || '(unknown)'} requires a concrete next action`);
    }
    if (surface?.status === 'not-applicable') {
      if (!substantive(surface?.rationale)) errors.push(`Not-applicable coverage surface ${surface.id || '(unknown)'} requires a substantive rationale`);
      if (!Array.isArray(surface?.investigation_refs) || !surface.investigation_refs.length) {
        errors.push(`Not-applicable coverage surface ${surface.id || '(unknown)'} requires investigation references`);
      }
    }
  }
  if (!Array.isArray(reconstructionLedger.records) || !reconstructionLedger.records.length) {
    errors.push('SPECS reconstruction ledger must contain reconstruction records');
  }
  const capabilities = Array.isArray(capabilityCatalog.capabilities) ? capabilityCatalog.capabilities : [];
  if (!capabilities.length) errors.push('Capability catalog must contain at least one material capability');
  const capabilityIds = new Set();
  for (const capability of capabilities) {
    const id = String(capability?.id ?? '').trim();
    if (!id) {
      errors.push('Every capability requires an id');
      continue;
    }
    if (capabilityIds.has(id)) errors.push(`Duplicate capability id: ${id}`);
    capabilityIds.add(id);
    if (!substantive(capability?.description, 30)) errors.push(`Capability ${id} requires a substantive description`);
    if (!Array.isArray(capability?.evidence) || !capability.evidence.length) errors.push(`Capability ${id} requires evidence references`);
  }

  const records = Array.isArray(manifest.records) ? manifest.records : [];
  if (!records.length) errors.push('Artefact manifest must contain detailed record entries');
  const coverage = new Map();
  const proposedPaths = new Set();
  const recordIds = new Set();
  let created = 0;
  let notApplicable = 0;
  let blocked = 0;

  for (const [index, record] of records.entries()) {
    const prefix = `Record ${record?.id || index + 1}`;
    const recordId = String(record?.id ?? '').trim();
    const subject = String(record?.subject ?? '').trim();
    const family = String(record?.family ?? '').trim();
    const status = String(record?.status ?? '').trim();
    if (!recordId) errors.push(`${prefix} requires an id`);
    else if (recordIds.has(recordId)) errors.push(`Duplicate artefact record id: ${recordId}`);
    else recordIds.add(recordId);
    if (!subject || !family) {
      errors.push(`${prefix} requires subject and family`);
      continue;
    }
    const key = `${subject}|${family}`;
    coverage.set(key, (coverage.get(key) ?? 0) + 1);
    if (!terminalStatuses.has(status)) {
      errors.push(`${prefix} has non-terminal status ${status || '(missing)'}`);
      continue;
    }

    if (status === 'created') {
      created += 1;
      if (!substantive(record?.record_type, 3)) errors.push(`${prefix} requires a record type`);
      if (!substantive(record?.title, 5)) errors.push(`${prefix} requires a substantive title`);
      if (!substantive(record?.review_owner, 3)) errors.push(`${prefix} requires a review owner`);
      const proposedPath = String(record?.proposed_path ?? '').trim();
      if (!proposedPath.startsWith('proposals/SPECS/')) {
        errors.push(`${prefix} must point to an individual file under proposals/SPECS/`);
        continue;
      }
      if (proposedPaths.has(proposedPath)) errors.push(`${prefix} reuses proposed path ${proposedPath}; detailed records require individual files`);
      proposedPaths.add(proposedPath);
      const artefactPath = resolve(bundleRoot, proposedPath);
      if (!inside(resolve(bundleRoot, 'proposals/SPECS'), artefactPath)) {
        errors.push(`${prefix} escapes the proposals/SPECS boundary`);
      } else if (!existsSync(artefactPath) || !lstatSync(artefactPath).isFile()) {
        errors.push(`${prefix} is missing proposed artefact ${proposedPath}`);
      } else if (statSync(artefactPath).size < (options.minimumArtefactBytes ?? 200)) {
        errors.push(`${prefix} proposed artefact is too small to be a detailed reconstruction: ${proposedPath}`);
      }
      if (!Array.isArray(record?.evidence) || !record.evidence.length) errors.push(`${prefix} requires evidence references`);
    }

    if (status === 'not-applicable') {
      notApplicable += 1;
      if (!substantive(record?.rationale)) errors.push(`${prefix} requires a substantive not-applicable rationale`);
      if (!Array.isArray(record?.investigation_refs) || !record.investigation_refs.length) {
        errors.push(`${prefix} requires investigation references supporting not-applicable status`);
      }
    }

    if (status === 'blocked') {
      blocked += 1;
      if (!substantive(record?.rationale)) errors.push(`${prefix} requires a substantive blocked rationale`);
      if (!substantive(record?.review_owner, 3)) errors.push(`${prefix} requires a review owner`);
      if (!substantive(record?.next_action)) errors.push(`${prefix} requires a concrete next action`);
    }
  }

  for (const capabilityId of capabilityIds) {
    for (const family of families.capability_families ?? []) {
      if (!coverage.has(`${capabilityId}|${family}`)) errors.push(`Capability ${capabilityId} is missing record family ${family}`);
    }
  }
  for (const family of families.project_families ?? []) {
    if (!coverage.has(`project|${family}`)) errors.push(`Project reconstruction is missing record family ${family}`);
  }

  const knownFamilies = new Set([...(families.capability_families ?? []), ...(families.project_families ?? [])]);
  for (const record of records) {
    if (record?.family && !knownFamilies.has(record.family)) warnings.push(`Additional record family: ${record.family}`);
    if (record?.subject && record.subject !== 'project' && !capabilityIds.has(record.subject)) {
      errors.push(`Record ${record.id || '(unknown)'} references unknown capability ${record.subject}`);
    }
  }

  return {
    schema: 'ewai.archaeology-validation/v1',
    valid: errors.length === 0,
    depth: manifest.depth,
    bundleRoot,
    counts: {
      capabilities: capabilityIds.size,
      records: records.length,
      created,
      notApplicable,
      blocked
    },
    errors,
    warnings
  };
}

function validatedBundle(projectRoot, bundlePath, options) {
  const validation = validateArchaeologyBundle(projectRoot, bundlePath, options);
  if (!validation.valid) {
    throw new Error(`Archaeology bundle is not ready for review:\n${validation.errors.slice(0, 20).join('\n')}`);
  }
  return validation;
}

function canonicalRelative(proposedPath) {
  return proposedPath.slice('proposals/SPECS/'.length);
}

function fileHash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function prepareArchaeologyReview(projectRoot, bundlePath, options = {}) {
  const validation = validatedBundle(projectRoot, bundlePath, options);
  const manifestPath = resolve(validation.bundleRoot, 'archaeology-artifact-manifest.yaml');
  const manifest = YAML.parse(readFileSync(manifestPath, 'utf8'));
  const decisionsPath = resolve(validation.bundleRoot, 'review-decisions.yaml');
  const guidePath = resolve(validation.bundleRoot, 'review-guide.md');
  const questionPlanPath = resolve(validation.bundleRoot, 'review-question-plan.yaml');
  if ((existsSync(decisionsPath) || existsSync(guidePath) || existsSync(questionPlanPath)) && !options.force) {
    throw new Error('Archaeology review files already exist; preserve existing decisions or use an explicitly approved force refresh');
  }

  const records = manifest.records.map((record) => ({
    id: record.id,
    subject: record.subject,
    family: record.family,
    title: record.title || record.record_type || record.family,
    proposed_path: record.proposed_path || null,
    canonical_path: record.proposed_path ? `SPECS/${canonicalRelative(record.proposed_path)}` : null,
    reconstruction_status: record.status,
    decision: 'pending',
    notes: '',
    corrections_applied: false,
    reviewed_by: null,
    reviewed_at: null
  }));
  writeFileSync(decisionsPath, YAML.stringify({
    schema: 'ewai.archaeology-review-decisions/v1',
    mode: 'undecided',
    records
  }, { lineWidth: 0 }), 'utf8');
  writeFileSync(questionPlanPath, YAML.stringify({
    schema: 'ewai.archaeology-review-question-plan/v1',
    purpose: 'Minimise human review effort by asking evidence-backed questions whose answers apply to clearly named groups of records.',
    questions: []
  }, { lineWidth: 0 }), 'utf8');

  const created = records.filter((record) => record.reconstruction_status === 'created');
  const rows = records.map((record) => `| ${record.id} | ${record.subject} | ${record.family} | ${record.title} | ${record.reconstruction_status} | ${record.canonical_path ?? 'Evidence-backed exception'} | Pending |`).join('\n');
  writeFileSync(guidePath, `# Archaeology review guide\n\nThe maximum-detail investigation passed validation. Choose either self-review or an AI-guided walkthrough. For a guided review, first populate \`review-question-plan.yaml\` with the smallest useful set of cross-record questions. Each question must identify the evidence, decision sought, and every affected record; a clarification must not be treated as approval. Record accept, accept with corrections, reject, or defer decisions in \`review-decisions.yaml\`. Review created records and evidence-backed exceptions. Nothing is filed into canonical SPECS without explicit approval.\n\n## Detailed reconstruction inventory\n\n| ID | Subject | Family | Record | Reconstruction | Canonical destination | Decision |\n|---|---|---|---|---|---|---|\n${rows}\n`, 'utf8');

  return {
    schema: 'ewai.archaeology-review-preparation/v1',
    bundleRoot: validation.bundleRoot,
    guidePath,
    decisionsPath,
    questionPlanPath,
    counts: { total: records.length, created: created.length }
  };
}

export function curateArchaeologyBundle(projectRoot, bundlePath, options = {}) {
  if (!options.confirmed) throw new Error('Automatic Archaeology filing requires explicit user confirmation');
  const validation = validatedBundle(projectRoot, bundlePath, options);
  const paths = projectPaths(projectRoot);
  const manifestPath = resolve(validation.bundleRoot, 'archaeology-artifact-manifest.yaml');
  const manifest = YAML.parse(readFileSync(manifestPath, 'utf8'));
  const decisionsPath = resolve(validation.bundleRoot, 'review-decisions.yaml');
  const review = parseYaml(decisionsPath, 'review decisions', []);
  if (!review || review.schema !== 'ewai.archaeology-review-decisions/v1') {
    throw new Error('Review decisions must use schema ewai.archaeology-review-decisions/v1');
  }
  const decisions = new Map((review.records ?? []).map((record) => [record.id, record]));
  const createdRecords = manifest.records.filter((record) => record.status === 'created');
  const pending = manifest.records.filter((record) => !reviewDecisions.has(decisions.get(record.id)?.decision));
  if (pending.length) throw new Error(`Review decisions remain pending for ${pending.length} reconstruction record(s)`);
  const unowned = manifest.records.filter((record) => !substantive(decisions.get(record.id)?.reviewed_by, 2));
  if (unowned.length) throw new Error(`Review decisions require an accountable reviewer for ${unowned.length} reconstruction record(s)`);
  const unexplained = manifest.records.filter((record) => {
    const decision = decisions.get(record.id);
    return decision?.decision !== 'accepted' && !substantive(decision?.notes);
  });
  if (unexplained.length) {
    throw new Error(`Corrected, rejected, or deferred decisions require explanatory notes for ${unexplained.length} reconstruction record(s)`);
  }
  const unappliedCorrections = manifest.records.filter((record) => {
    const decision = decisions.get(record.id);
    return decision?.decision === 'accepted-with-corrections' && decision?.corrections_applied !== true;
  });
  if (unappliedCorrections.length) {
    throw new Error(`Accepted corrections must be applied to ${unappliedCorrections.length} proposed record(s) before filing`);
  }

  const accepted = createdRecords.filter((record) => {
    const decision = decisions.get(record.id)?.decision;
    return decision === 'accepted' || decision === 'accepted-with-corrections';
  });
  const actions = accepted.map((record) => {
    const source = resolve(validation.bundleRoot, record.proposed_path);
    const canonicalPath = canonicalRelative(record.proposed_path);
    const destination = resolve(paths.specsRoot, canonicalPath);
    if (!inside(paths.specsRoot, destination)) throw new Error(`Canonical destination escapes SPECS: ${canonicalPath}`);
    if (lstatSync(source).isSymbolicLink()) throw new Error(`Symlinked Archaeology proposals cannot be filed: ${record.proposed_path}`);
    if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) {
      throw new Error(`Symlinked canonical SPECS destinations require manual reconciliation: SPECS/${canonicalPath}`);
    }
    const sourceHash = fileHash(source);
    const destinationHash = existsSync(destination) && statSync(destination).isFile() ? fileHash(destination) : null;
    return {
      record,
      decision: decisions.get(record.id),
      source,
      sourceHash,
      destination,
      canonicalPath: `SPECS/${canonicalPath}`,
      destinationHash,
      action: destinationHash === sourceHash ? 'already-current' : destinationHash ? 'conflict' : 'copy'
    };
  });
  const conflicts = actions.filter((action) => action.action === 'conflict');
  if (conflicts.length) {
    throw new Error(`Canonical SPECS conflicts require reconciliation before automatic filing:\n${conflicts.map((item) => item.canonicalPath).join('\n')}`);
  }

  const filedAt = new Date(options.now ?? Date.now()).toISOString();
  for (const record of manifest.records) {
    const decision = decisions.get(record.id);
    record.review_status = decision.decision;
    record.reviewed_by = decision.reviewed_by;
    record.reviewed_at = decision.reviewed_at || filedAt;
    if (decision.decision === 'rejected' || decision.decision === 'deferred' || record.status !== 'created') {
      record.curation_status = 'retained-in-bundle';
    }
  }
  for (const action of actions) {
    if (action.action === 'copy') {
      mkdirSync(dirname(action.destination), { recursive: true });
      cpSync(action.source, action.destination, { errorOnExist: true, force: false });
    }
    action.record.canonical_path = action.canonicalPath;
    action.record.curation_status = action.action === 'copy' ? 'filed' : 'already-current';
  }
  writeFileSync(manifestPath, YAML.stringify(manifest, { lineWidth: 0 }), 'utf8');

  const ledgerPath = resolve(validation.bundleRoot, 'curation-ledger.yaml');
  const actionById = new Map(actions.map((action) => [action.record.id, action]));
  writeFileSync(ledgerPath, YAML.stringify({
    schema: 'ewai.archaeology-curation-ledger/v1',
    filed_at: filedAt,
    approved_by: options.approvedBy || 'Project owner',
    records: manifest.records.map((record) => {
      const decision = decisions.get(record.id);
      const action = actionById.get(record.id);
      return {
        id: record.id,
        reconstruction_status: record.status,
        decision: decision.decision,
        reviewed_by: decision.reviewed_by,
        reviewed_at: decision.reviewed_at || filedAt,
        notes: decision.notes || null,
        source: record.proposed_path || null,
        destination: action ? action.canonicalPath : null,
        sha256: action ? action.sourceHash : null,
        status: action ? record.curation_status : 'retained-in-bundle'
      };
    })
  }, { lineWidth: 0 }), 'utf8');

  return {
    schema: 'ewai.archaeology-curation-result/v1',
    bundleRoot: validation.bundleRoot,
    ledgerPath,
    filed: actions.filter((action) => action.action === 'copy').length,
    alreadyCurrent: actions.filter((action) => action.action === 'already-current').length,
    rejected: manifest.records.filter((record) => decisions.get(record.id)?.decision === 'rejected').length,
    deferred: manifest.records.filter((record) => decisions.get(record.id)?.decision === 'deferred').length
  };
}

export function validateArchaeologyCompletion(projectRoot, bundlePath, options = {}) {
  const reconstruction = validateArchaeologyBundle(projectRoot, bundlePath, options);
  const errors = reconstruction.valid ? [] : reconstruction.errors.map((error) => `Reconstruction: ${error}`);
  const paths = projectPaths(projectRoot);
  const bundleRoot = reconstruction.bundleRoot ?? archaeologyBundleRoot(projectRoot, bundlePath);
  const manifest = parseYaml(resolve(bundleRoot, 'archaeology-artifact-manifest.yaml'), 'archaeology artefact manifest', errors);
  const review = parseYaml(resolve(bundleRoot, 'review-decisions.yaml'), 'review decisions', errors);
  const curation = parseYaml(resolve(bundleRoot, 'curation-ledger.yaml'), 'curation ledger', errors);
  const transition = parseYaml(resolve(bundleRoot, 'future-work-transition.yaml'), 'future-work transition', errors);

  if (review && review.schema !== 'ewai.archaeology-review-decisions/v1') {
    errors.push('Review decisions must use schema ewai.archaeology-review-decisions/v1');
  }
  if (curation && curation.schema !== 'ewai.archaeology-curation-ledger/v1') {
    errors.push('Curation ledger must use schema ewai.archaeology-curation-ledger/v1');
  }

  const manifestRecords = Array.isArray(manifest?.records) ? manifest.records : [];
  const reviewById = new Map((review?.records ?? []).map((record) => [record.id, record]));
  const curationById = new Map((curation?.records ?? []).map((record) => [record.id, record]));
  for (const record of manifestRecords) {
    const decision = reviewById.get(record.id)?.decision;
    if (!reviewDecisions.has(decision)) {
      errors.push(`Completion requires a terminal review decision for ${record.id || '(unknown)'}`);
      continue;
    }
    const curated = curationById.get(record.id);
    if (!curated) {
      errors.push(`Curation ledger is missing reconstruction record ${record.id || '(unknown)'}`);
      continue;
    }
    if (record.status !== 'created' || decision === 'rejected' || decision === 'deferred') {
      if (curated.status !== 'retained-in-bundle') errors.push(`Non-promoted record ${record.id} must remain traceable in the Archaeology bundle`);
      continue;
    }

    if (!['filed', 'already-current'].includes(curated.status)) {
      errors.push(`Accepted record ${record.id} has not been promoted into canonical SPECS`);
      continue;
    }
    const destination = String(curated.destination ?? '');
    if (!destination.startsWith('SPECS/')) {
      errors.push(`Accepted record ${record.id} has an invalid canonical destination`);
      continue;
    }
    const canonicalPath = resolve(paths.specsRoot, destination.slice('SPECS/'.length));
    if (!inside(paths.specsRoot, canonicalPath) || !existsSync(canonicalPath) || lstatSync(canonicalPath).isSymbolicLink() || !statSync(canonicalPath).isFile()) {
      errors.push(`Accepted record ${record.id} is missing from canonical SPECS at ${destination}`);
      continue;
    }
    if (!substantive(curated.sha256, 64) || fileHash(canonicalPath) !== curated.sha256) {
      errors.push(`Accepted record ${record.id} no longer matches its curated canonical evidence`);
    }
  }

  const requiredRoutes = ['interview', 'import', 'recommendations'];
  if (transition) {
    if (transition.schema !== 'ewai.archaeology-future-work-transition/v1') {
      errors.push('Future-work transition must use schema ewai.archaeology-future-work-transition/v1');
    }
    if (transition.offered_to_user !== true) errors.push('The prospective-work routes must be explicitly offered to the user');
    if (!substantive(transition.offer_summary)) errors.push('Future-work transition requires the offer shown to the user');
    const routes = Array.isArray(transition.routes_offered) ? transition.routes_offered : [];
    for (const route of requiredRoutes) {
      if (!routes.includes(route)) errors.push(`Future-work transition did not offer the ${route} route`);
    }
    if (!isoTimestamp(transition.offered_at)) errors.push('Future-work offer requires an ISO-8601 timestamp');
    if (!['interview', 'import', 'recommendations', 'declined'].includes(transition.decision)) {
      errors.push('Future-work transition requires a selected route or explicit decline');
    }
    if (!substantive(transition.decided_by, 2)) errors.push('Future-work transition requires an accountable decision maker');
    if (!isoTimestamp(transition.decided_at)) errors.push('Future-work decision requires an ISO-8601 timestamp');
  }

  return {
    schema: 'ewai.archaeology-completion-validation/v1',
    valid: errors.length === 0,
    bundleRoot,
    counts: {
      reconstructionRecords: manifestRecords.length,
      canonicalRecords: [...curationById.values()].filter((record) => ['filed', 'already-current'].includes(record.status)).length
    },
    errors
  };
}

const technologyHostingSchemas = Object.freeze({
  preparation: 'ewai.archaeology-technology-hosting-preparation/v1',
  answers: 'ewai.archaeology-technology-hosting-answers/v1',
  profile: 'ewai.archaeology-technology-hosting-profile/v1',
  status: 'ewai.archaeology-technology-hosting-status/v1'
});

const deploymentModels = new Set([
  'cloud', 'on-premises', 'saas', 'paas', 'iaas', 'managed-service', 'hybrid', 'other', 'unknown'
]);
const operatingModels = new Set([
  'self-managed', 'provider-managed', 'shared', 'third-party-managed', 'hybrid', 'unknown'
]);
const observationReviewStatuses = new Set(['active', 'inactive', 'contradicted', 'uncertain']);
const technologyHostingSourceQueries = Object.freeze([
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'composer.json',
  'pyproject.toml', 'requirements.txt', 'Pipfile', 'go.mod', 'Cargo.toml', 'Gemfile', 'pom.xml',
  'build.gradle', '.csproj', 'global.json', 'nuxt.config', 'next.config', 'angular.json', 'vite.config',
  'schema.prisma', 'Dockerfile', 'docker-compose', 'compose.yaml', 'compose.yml', '.github/workflows',
  '.gitlab-ci', 'azure-pipelines', 'Jenkinsfile', '.tf', 'main.bicep', 'Chart.yaml', 'kustomization', 'deployment.yaml', 'deployment.yml',
  'azure.yaml', 'vercel.json', 'netlify.toml', 'serverless.yml', 'template.yaml', 'cdk.json',
  'amplify.yml', 'firebase.json', 'cloudbuild.yaml', 'app.yaml', 'fly.toml', 'render.yaml',
  'railway.json', 'Procfile', 'sfdx-project.json', 'PowerApps', '.msapp', 'openapi', 'swagger', 'schema.graphql'
]);

const technologyHostingSignalRules = Object.freeze([
  { test: /(^|\/)package\.json$/i, category: 'runtime', candidate: 'Node.js', detail: 'Node package manifest' },
  { test: /(^|\/)package-lock\.json$/i, category: 'dependency-management', candidate: 'npm', detail: 'npm lockfile' },
  { test: /(^|\/)pnpm-lock\.ya?ml$/i, category: 'dependency-management', candidate: 'pnpm', detail: 'pnpm lockfile' },
  { test: /(^|\/)yarn\.lock$/i, category: 'dependency-management', candidate: 'Yarn', detail: 'Yarn lockfile' },
  { test: /(^|\/)bun\.lockb?$/i, category: 'runtime', candidate: 'Bun', detail: 'Bun lockfile' },
  { test: /(^|\/)composer\.(json|lock)$/i, category: 'dependency-management', candidate: 'Composer', detail: 'Composer project metadata' },
  { test: /(^|\/)(composer\.json|artisan)$/i, category: 'runtime', candidate: 'PHP', detail: 'PHP project signal' },
  { test: /(^|\/)(pyproject\.toml|requirements[^/]*\.txt|Pipfile)$/i, category: 'runtime', candidate: 'Python', detail: 'Python project metadata' },
  { test: /(^|\/)go\.mod$/i, category: 'runtime', candidate: 'Go', detail: 'Go module manifest' },
  { test: /(^|\/)Cargo\.toml$/i, category: 'runtime', candidate: 'Rust', detail: 'Cargo manifest' },
  { test: /(^|\/)Gemfile$/i, category: 'runtime', candidate: 'Ruby', detail: 'Ruby dependency manifest' },
  { test: /(^|\/)(pom\.xml|build\.gradle(?:\.kts)?)$/i, category: 'runtime', candidate: 'JVM', detail: 'JVM build metadata' },
  { test: /\.csproj$/i, category: 'runtime', candidate: '.NET', detail: '.NET project manifest' },
  { test: /(^|\/)nuxt\.config\.[^/]+$/i, category: 'framework', candidate: 'Nuxt', detail: 'Nuxt configuration' },
  { test: /(^|\/)next\.config\.[^/]+$/i, category: 'framework', candidate: 'Next.js', detail: 'Next.js configuration' },
  { test: /(^|\/)angular\.json$/i, category: 'framework', candidate: 'Angular', detail: 'Angular workspace configuration' },
  { test: /(^|\/)vite\.config\.[^/]+$/i, category: 'build-tool', candidate: 'Vite', detail: 'Vite configuration' },
  { test: /(^|\/)prisma\/schema\.prisma$/i, category: 'data-access', candidate: 'Prisma', detail: 'Prisma schema' },
  { test: /(^|\/)Dockerfile(?:\.[^/]+)?$/i, category: 'container', candidate: 'Docker', detail: 'Docker build definition' },
  { test: /(^|\/)(docker-compose[^/]*|compose)\.ya?ml$/i, category: 'container-orchestration', candidate: 'Docker Compose', detail: 'Compose topology' },
  { test: /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i, category: 'release-automation', candidate: 'GitHub Actions', detail: 'GitHub Actions workflow' },
  { test: /(^|\/)\.gitlab-ci\.ya?ml$/i, category: 'release-automation', candidate: 'GitLab CI/CD', detail: 'GitLab pipeline' },
  { test: /(^|\/)azure-pipelines\.ya?ml$/i, category: 'release-automation', candidate: 'Azure Pipelines', detail: 'Azure pipeline' },
  { test: /(^|\/)Jenkinsfile$/i, category: 'release-automation', candidate: 'Jenkins', detail: 'Jenkins pipeline' },
  { test: /\.tf(?:vars)?$/i, category: 'infrastructure-as-code', candidate: 'Terraform', detail: 'Terraform definition' },
  { test: /\.bicep$/i, category: 'infrastructure-as-code', candidate: 'Azure Bicep', detail: 'Bicep definition' },
  { test: /(^|\/)(Chart\.yaml|values\.ya?ml)$/i, category: 'container-orchestration', candidate: 'Helm', detail: 'Helm chart metadata' },
  { test: /(^|\/)(kustomization\.ya?ml|[^/]*deployment\.ya?ml)$/i, category: 'container-orchestration', candidate: 'Kubernetes', detail: 'Kubernetes deployment metadata' },
  { test: /(^|\/)azure\.ya?ml$/i, category: 'hosting-provider', candidate: 'Microsoft Azure', detail: 'Azure Developer CLI descriptor' },
  { test: /(^|\/)vercel\.json$/i, category: 'hosting-provider', candidate: 'Vercel', detail: 'Vercel deployment descriptor' },
  { test: /(^|\/)netlify\.toml$/i, category: 'hosting-provider', candidate: 'Netlify', detail: 'Netlify deployment descriptor' },
  { test: /(^|\/)(serverless\.ya?ml|template\.ya?ml|cdk\.json|amplify\.ya?ml)$/i, category: 'hosting-provider', candidate: 'Amazon Web Services', detail: 'AWS deployment descriptor' },
  { test: /(^|\/)(firebase\.json|cloudbuild\.ya?ml|app\.yaml)$/i, category: 'hosting-provider', candidate: 'Google Cloud', detail: 'Google Cloud deployment descriptor' },
  { test: /(^|\/)fly\.toml$/i, category: 'hosting-provider', candidate: 'Fly.io', detail: 'Fly.io deployment descriptor' },
  { test: /(^|\/)render\.ya?ml$/i, category: 'hosting-provider', candidate: 'Render', detail: 'Render deployment descriptor' },
  { test: /(^|\/)railway\.json$/i, category: 'hosting-provider', candidate: 'Railway', detail: 'Railway deployment descriptor' },
  { test: /(^|\/)Procfile$/i, category: 'hosting-platform', candidate: 'Heroku-compatible platform', detail: 'Procfile process model' },
  { test: /(^|\/)sfdx-project\.json$/i, category: 'managed-platform', candidate: 'Salesforce', detail: 'Salesforce DX project metadata' },
  { test: /(^|\/)(PowerApps\/|[^/]+\.msapp$)/i, category: 'managed-platform', candidate: 'Microsoft Power Platform', detail: 'Power Apps package evidence' },
  { test: /(^|\/)(openapi|swagger)[^/]*\.(json|ya?ml)$/i, category: 'integration-contract', candidate: 'OpenAPI', detail: 'OpenAPI contract' },
  { test: /(^|\/)schema\.graphqls?$/i, category: 'integration-contract', candidate: 'GraphQL', detail: 'GraphQL schema' }
]);

function technologyHostingDigest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function atomicArchaeologyFiles(entries) {
  const transaction = randomUUID();
  const staged = [];
  const backups = [];
  const installed = [];
  try {
    for (const entry of entries) {
      mkdirSync(dirname(entry.path), { recursive: true });
      const temporary = `${entry.path}.ewai-${transaction}.tmp`;
      writeFileSync(temporary, entry.content, 'utf8');
      staged.push({ ...entry, temporary });
    }
    for (const entry of staged) {
      if (!existsSync(entry.path)) continue;
      const backup = `${entry.path}.ewai-${transaction}.bak`;
      renameSync(entry.path, backup);
      backups.push({ path: entry.path, backup });
    }
    for (const entry of staged) {
      renameSync(entry.temporary, entry.path);
      installed.push(entry.path);
    }
    for (const entry of backups) rmSync(entry.backup, { force: true });
  } catch (error) {
    for (const path of installed) rmSync(path, { force: true });
    for (const entry of backups.reverse()) {
      if (existsSync(entry.backup)) renameSync(entry.backup, entry.path);
    }
    throw error;
  } finally {
    for (const entry of staged) rmSync(entry.temporary, { force: true });
    for (const entry of backups) rmSync(entry.backup, { force: true });
  }
}

function readJsonFile(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error.message}`);
  }
}

function sourceMapTechnologyEvidence(projectRoot, supplied) {
  if (supplied) return supplied;
  const freshness = repositoryIndexFreshness(projectRoot);
  const coverage = repositorySourceMapCoverage(projectRoot);
  const byFile = new Map();
  const collect = (result) => {
    for (const file of result.files ?? []) {
      byFile.set(`${file.repository}:${file.path}`, file);
    }
  };
  collect(repositorySourceMapFiles(projectRoot, { limit: 200 }));
  for (const query of technologyHostingSourceQueries) {
    collect(repositorySourceMapFiles(projectRoot, { query, limit: 200 }));
  }
  const profiles = repositorySourceMapProfiles(projectRoot, { limit: 200 });
  for (const profile of profiles.profiles ?? []) {
    if (profile.sourceKind === 'core' || !profile.matchCount) continue;
    collect(repositorySourceMapFiles(projectRoot, { profileId: profile.id, limit: 200 }));
  }
  return { runId: coverage.runId, freshness, coverage, files: [...byFile.values()] };
}

function technologyHostingFreshness(freshness, projectRoot, bundleRoot) {
  if (!freshness?.stale) return freshness;
  const generated = new Set([
    'technology-hosting-brief.json',
    'technology-hosting-answers.template.json',
    'technology-hosting-brief.md',
    'technology-hosting-profile.json',
    'technology-hosting-profile.md'
  ].map((name) => relative(resolve(projectRoot), resolve(bundleRoot, name)).replaceAll('\\', '/')));
  const samples = freshness.samples ?? {};
  const stripRepository = (value) => {
    const path = String(value ?? '').replaceAll('\\', '/');
    const separator = path.indexOf(':');
    return separator === -1 ? path : path.slice(separator + 1);
  };
  const ownMissing = (samples.missing ?? []).filter((path) => generated.has(stripRepository(path)));
  const ownChanged = (samples.changed ?? []).filter((path) => generated.has(stripRepository(path)));
  const onlyGeneratedChanges = Number(freshness.summary?.deleted ?? 0) === 0
    && Number(freshness.summary?.missing ?? 0) === ownMissing.length
    && Number(freshness.summary?.changed ?? 0) === ownChanged.length;
  if (!onlyGeneratedChanges) return freshness;
  return {
    ...freshness,
    status: 'fresh',
    stale: false,
    reason: 'only-technology-hosting-output-files-changed',
    ignoredGeneratedOutputs: [...generated]
  };
}

function technologyHostingObservations(files) {
  const observations = [];
  for (const file of files ?? []) {
    const path = String(file.path ?? '').replaceAll('\\', '/');
    let matched = false;
    for (const rule of technologyHostingSignalRules) {
      if (!rule.test.test(path)) continue;
      matched = true;
      const key = `${file.repository ?? 'project'}:${path}:${rule.category}:${rule.candidate}`;
      observations.push({
        id: `ATH-OBS-${technologyHostingDigest(key).slice(0, 10).toUpperCase()}`,
        provenance: 'repository-observed',
        repository: file.repository || 'project',
        path,
        category: rule.category,
        candidate: rule.candidate,
        evidence: rule.detail,
        sourceMap: {
          profileId: file.profileId ?? '',
          analyser: file.analyser ?? '',
          analysisOutcome: file.analysisOutcome ?? '',
          classification: file.classification ?? '',
          language: file.language ?? ''
        },
        limitation: 'This repository signal does not prove current runtime use, deployment, hosting location or production state.'
      });
    }
    const profileId = String(file.profileId ?? '').trim();
    if (!matched && profileId && !profileId.startsWith('core-')) {
      const key = `${file.repository ?? 'project'}:${path}:source-map-profile:${profileId}`;
      observations.push({
        id: `ATH-OBS-${technologyHostingDigest(key).slice(0, 10).toUpperCase()}`,
        provenance: 'repository-observed',
        repository: file.repository || 'project',
        path,
        category: 'source-map-profile',
        candidate: profileId,
        evidence: 'An installed technology, stack, organisation or project Source Map profile matched this file.',
        sourceMap: {
          profileId,
          analyser: file.analyser ?? '',
          analysisOutcome: file.analysisOutcome ?? '',
          classification: file.classification ?? '',
          language: file.language ?? ''
        },
        limitation: 'This pack-provided repository signal does not prove current runtime use, deployment, hosting location or production state.'
      });
    }
  }
  return observations.sort((left, right) => (
    left.repository.localeCompare(right.repository)
    || left.path.localeCompare(right.path)
    || left.candidate.localeCompare(right.candidate)
  ));
}

function activeTechnologyHostingPersonas(routing, observations) {
  const inventory = Array.isArray(routing.inventory) ? routing.inventory : [];
  const inventoryById = new Map(inventory.map((persona) => [persona.id, persona]));
  const selectedIds = new Set([
    ...baselinePersonaIds,
    ...(routing.user_review?.status === 'confirmed' ? routing.user_review.selected_personas ?? [] : []),
    ...(routing.assignments ?? []).map((assignment) => assignment.persona)
  ]);
  const signals = [
    'technology', 'architecture', 'hosting', 'cloud', 'infrastructure', 'deployment', 'operations',
    ...observations.map((observation) => `${observation.category} ${observation.candidate}`)
  ];
  const contextual = selectContextualPersonas({
    personaCatalogue: inventory,
    signals,
    context: { observations },
    contextLabel: 'archaeology technology and hosting discovery',
    limit: 8
  });
  const contextualById = new Map(contextual.map((persona) => [persona.id, persona]));
  for (const persona of contextual) selectedIds.add(persona.id);
  return [...selectedIds].map((id) => {
    const persona = inventoryById.get(id);
    if (!persona) return null;
    const assigned = (routing.assignments ?? []).filter((assignment) => assignment.persona === id);
    const contextualPersona = contextualById.get(id);
    return {
      id,
      name: persona.name || id,
      tier: persona.tier || 'core',
      category: persona.category || '',
      active: true,
      passes: [...new Set(assigned.map((assignment) => assignment.pass))],
      engagementReason: contextualPersona?.engagementReason
        || assigned.map((assignment) => assignment.contribution).filter(Boolean).join(' ')
        || `${persona.name || id} is engaged as a required archaeology evidence lens.`
    };
  }).filter(Boolean);
}

function technologyHostingQuestions(observations) {
  const candidates = [...new Set(observations.map((observation) => observation.candidate))];
  return [
    { id: 'actual-technology', prompt: 'Which languages, frameworks, runtimes, databases, integrations and infrastructure components are actually in current use, and at what versions?', context: candidates },
    { id: 'provider', prompt: 'Who is the actual hosting or managed-platform provider for each live environment?' },
    { id: 'platform-service', prompt: 'Which concrete platform, product or service hosts each workload?' },
    { id: 'locations', prompt: 'Which country, region, data centre, tenant or physical location is used by each environment?' },
    { id: 'environments', prompt: 'What development, test, staging, production, disaster-recovery or other environments exist?' },
    { id: 'deployment-model', prompt: 'Is each workload cloud, on-premises, SaaS, PaaS, IaaS, managed-service, hybrid, other or unknown?' },
    { id: 'operating-model', prompt: 'Is each environment self-managed, provider-managed, shared, third-party-managed, hybrid or unknown, and by whom?' },
    { id: 'data-residency', prompt: 'Where is production data stored, processed, backed up and replicated, and who confirms that statement?' },
    { id: 'release-route', prompt: 'What route takes a change from source control to each environment, including approvals, automation and rollback?' },
    { id: 'inactive-signals', prompt: 'Which repository signals are historical, experimental, generated, inactive or otherwise not representative of the current service?' },
    { id: 'contradictions', prompt: 'Where does repository evidence conflict with owner or operator knowledge, and what evidence can resolve each conflict?' },
    { id: 'unresolved', prompt: 'What remains unknown, who owns the answer and what evidence is needed before relying on it?' }
  ];
}

function renderTechnologyHostingBrief(brief) {
  const personaRows = brief.activePersonas.length
    ? brief.activePersonas.map((persona) => `| ${persona.name} | ${persona.tier} | ${persona.passes.join(', ') || 'contextual'} | ${persona.engagementReason} |`).join('\n')
    : '| None | — | — | No approved persona was available. |';
  const observationRows = brief.observations.length
    ? brief.observations.map((observation) => `| ${observation.id} | ${observation.repository} | \`${observation.path}\` | ${observation.category} | ${observation.candidate} | ${observation.sourceMap.analysisOutcome || 'unknown'} |`).join('\n')
    : '| — | — | — | — | No common technology or hosting signals were detected. | — |';
  return `# Archaeology technology and hosting discovery

Status: **${brief.status}**  
Source Map run: **${brief.sourceMap.runId ?? 'missing'}**  
Prepared: **${brief.preparedAt}**

Repository evidence is advisory. A configuration file proves only that the signal exists in the indexed repository; it does not prove current runtime use, deployment, live hosting or production state.

## Active personas

These are the persona lenses actively engaged for this discovery pass.

| Persona | Tier | Passes | Why engaged |
|---|---|---|---|
${personaRows}

## Repository-observed signals

| ID | Repository | Path | Category | Candidate | Analysis outcome |
|---|---|---|---|---|---|
${observationRows}

## Owner questions

${brief.questions.map((question) => `- **${question.id}:** ${question.prompt}`).join('\n')}

## Source Map limitations

${brief.sourceMap.coverageWarnings.length ? brief.sourceMap.coverageWarnings.map((warning) => `- ${warning}`).join('\n') : '- No coverage warning was reported.'}

## Required assurance notice

${ASSURANCE_NOTICE}
`;
}

function emptyTechnologyHostingAnswers(digest) {
  const answer = () => ({ value: 'unknown', confirmed: false, observationRefs: [], evidence: [], notes: '' });
  return {
    schema: technologyHostingSchemas.answers,
    preparedDigest: digest,
    technology: [],
    hosting: {
      provider: answer(),
      platformService: answer(),
      locations: [],
      environments: [],
      deploymentModel: answer(),
      operatingModel: answer(),
      dataResidency: answer(),
      releaseRoute: answer(),
      operatingOwner: answer()
    },
    observationReviews: [],
    contradictions: [],
    unresolvedQuestions: []
  };
}

export function prepareArchaeologyTechnologyHosting(projectRoot, bundlePath, options = {}) {
  const bundleRoot = archaeologyBundleRoot(projectRoot, bundlePath);
  const personaValidation = validateArchaeologyPersonaGate(projectRoot, bundlePath);
  if (!personaValidation.valid) {
    throw new Error(`Technology and hosting discovery requires a valid, user-reviewed persona gate: ${personaValidation.errors.join('; ')}`);
  }
  const briefPath = resolve(bundleRoot, 'technology-hosting-brief.json');
  const templatePath = resolve(bundleRoot, 'technology-hosting-answers.template.json');
  const markdownPath = resolve(bundleRoot, 'technology-hosting-brief.md');
  if (!options.force && [briefPath, templatePath, markdownPath].some(existsSync)) {
    throw new Error('Technology and hosting discovery already exists; use an explicitly approved force refresh to replace the preparation artefacts.');
  }

  const repositoryEvidence = sourceMapTechnologyEvidence(projectRoot, options.repositoryEvidence);
  if (repositoryEvidence.freshness?.stale || repositoryEvidence.freshness?.status !== 'fresh') {
    throw new Error(`Refresh the Repository Source Map before technology and hosting discovery (${repositoryEvidence.freshness?.reason || repositoryEvidence.freshness?.status || 'freshness unknown'}).`);
  }
  if (!repositoryEvidence.runId) throw new Error('Refresh the Repository Source Map before technology and hosting discovery; no completed run is available.');

  const routing = YAML.parse(readFileSync(resolve(bundleRoot, 'persona-routing.yaml'), 'utf8')) ?? {};
  const observations = technologyHostingObservations(repositoryEvidence.files);
  const activePersonas = activeTechnologyHostingPersonas(routing, observations);
  const tierCounts = {};
  for (const persona of routing.inventory ?? []) tierCounts[persona.tier || 'core'] = (tierCounts[persona.tier || 'core'] ?? 0) + 1;
  const preparedAt = options.now || new Date().toISOString();
  const body = {
    schema: technologyHostingSchemas.preparation,
    status: 'awaiting-owner-answers',
    preparedAt,
    sourceMap: {
      runId: Number(repositoryEvidence.runId),
      freshness: repositoryEvidence.freshness,
      outcomes: repositoryEvidence.coverage?.outcomes ?? {},
      coverageWarnings: repositoryEvidence.coverage?.warnings ?? [],
      guidance: {
        repositoryEvidenceIsAdvisory: true,
        currentRuntimeRequiresHumanConfirmation: true
      }
    },
    observations,
    personaAvailability: { total: (routing.inventory ?? []).length, byTier: tierCounts },
    activePersonas,
    questions: technologyHostingQuestions(observations),
    notices: [ASSURANCE_NOTICE]
  };
  const brief = { ...body, digest: technologyHostingDigest(body) };
  const template = emptyTechnologyHostingAnswers(brief.digest);
  atomicArchaeologyFiles([
    { path: briefPath, content: `${JSON.stringify(brief, null, 2)}\n` },
    { path: templatePath, content: `${JSON.stringify(template, null, 2)}\n` },
    { path: markdownPath, content: renderTechnologyHostingBrief(brief) }
  ]);
  return {
    schema: technologyHostingSchemas.preparation,
    status: brief.status,
    bundleRoot,
    briefPath,
    templatePath,
    markdownPath,
    brief
  };
}

function cleanStringList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`);
  return [...new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))];
}

function normaliseTechnologyHostingAnswer(value, label, observationIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an answer object.`);
  const selected = String(value.value ?? '').trim();
  if (!selected) throw new Error(`${label} requires a value; use unknown when it has not been established.`);
  const observationRefs = cleanStringList(value.observationRefs, `${label}.observationRefs`);
  for (const reference of observationRefs) {
    if (!observationIds.has(reference)) throw new Error(`${label} contains unknown observation reference ${reference}.`);
  }
  const evidence = cleanStringList(value.evidence, `${label}.evidence`);
  if (value.confirmed === true && !evidence.length) throw new Error(`${label} requires evidence before it can be human-confirmed.`);
  return {
    value: selected,
    provenance: value.confirmed === true ? 'human-confirmed' : 'owner-declared',
    confirmed: value.confirmed === true,
    observationRefs,
    evidence,
    notes: String(value.notes ?? '').trim()
  };
}

function technologyHostingInputErrors(input, brief) {
  const errors = [];
  if (!input || input.schema !== technologyHostingSchemas.answers) errors.push(`Answers must use schema ${technologyHostingSchemas.answers}.`);
  if (input?.preparedDigest !== brief.digest) errors.push('Answers were not prepared from the current technology and hosting brief digest.');
  if (!Array.isArray(input?.technology)) errors.push('Technology answers must be a list.');
  if (!input?.hosting || typeof input.hosting !== 'object' || Array.isArray(input.hosting)) errors.push('Hosting answers must be an object.');
  if (input?.hosting && !Array.isArray(input.hosting.locations)) errors.push('Hosting locations must be a list.');
  if (input?.hosting && !Array.isArray(input.hosting.environments)) errors.push('Hosting environments must be a list.');
  if (!Array.isArray(input?.observationReviews)) errors.push('Observation reviews must be a list.');
  if (!Array.isArray(input?.contradictions)) errors.push('Contradictions must be a list.');
  if (!Array.isArray(input?.unresolvedQuestions)) errors.push('Unresolved questions must be a list.');
  return errors;
}

function normaliseTechnologyItem(item, index, observationIds) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`technology[${index}] must be an object.`);
  const category = String(item.category ?? '').trim();
  const name = String(item.name ?? '').trim();
  if (!category || !name) throw new Error(`technology[${index}] requires category and name.`);
  const answer = normaliseTechnologyHostingAnswer({ ...item, value: name }, `technology[${index}]`, observationIds);
  return { category, name: answer.value, version: String(item.version ?? '').trim(), ...answer, value: undefined };
}

function cleanUndefined(value) {
  if (Array.isArray(value)) return value.map(cleanUndefined);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).map(([key, entry]) => [key, cleanUndefined(entry)]));
}

function renderTechnologyHostingProfile(profile) {
  const technologyRows = profile.technology.length
    ? profile.technology.map((item) => `| ${item.category} | ${item.name} | ${item.version || '—'} | ${item.provenance} | ${item.observationRefs.join(', ') || '—'} |`).join('\n')
    : '| — | No technology answer recorded | — | — | — |';
  const environmentRows = profile.hosting.environments.length
    ? profile.hosting.environments.map((environment) => `| ${environment.name} | ${environment.provider} | ${environment.platformService} | ${environment.location} | ${environment.deploymentModel} | ${environment.operatingModel} | ${environment.provenance} |`).join('\n')
    : '| — | — | — | — | unknown | unknown | owner-declared |';
  const hostingRows = ['provider', 'platformService', 'deploymentModel', 'operatingModel', 'dataResidency', 'releaseRoute', 'operatingOwner']
    .map((field) => `| ${field} | ${profile.hosting[field].value} | ${profile.hosting[field].provenance} | ${profile.hosting[field].observationRefs.join(', ') || '—'} |`).join('\n');
  return `# Archaeology technology and hosting profile

Recorded: **${profile.recordedAt}**  
Reviewed by: **${profile.review.reviewedBy}**  
Source Map run: **${profile.sourceMap.runId}**

## Evidence language

- **repository-observed** means the indexed repository contains a signal. It is not proof of live use.
- **owner-declared** means a person supplied the answer but it still requires accountable confirmation.
- **human-confirmed** means the individual answer was explicitly marked confirmed and carries its evidence references.

## Technology

| Category | Name | Version | Provenance | Observation references |
|---|---|---|---|---|
${technologyRows}

## Hosting and operation

| Field | Value | Provenance | Observation references |
|---|---|---|---|
${hostingRows}

### Locations

${profile.hosting.locations.length ? profile.hosting.locations.map((location) => `- ${location.value} (${location.provenance})`).join('\n') : '- None recorded.'}

### Environments

| Environment | Provider | Platform/service | Location | Deployment | Operation | Provenance |
|---|---|---|---|---|---|---|
${environmentRows}

## Repository observations and disposition

${profile.observations.length ? profile.observations.map((observation) => `- **${observation.id}** ${observation.repository}/\`${observation.path}\`: ${observation.candidate} — ${observation.review.status}. ${observation.review.notes || observation.limitation}`).join('\n') : '- No common repository signals detected.'}

## Contradictions

${profile.contradictions.length ? profile.contradictions.map((item) => `- ${item.summary}${item.notes ? ` — ${item.notes}` : ''}`).join('\n') : '- None recorded.'}

## Unresolved questions

${profile.unresolvedQuestions.length ? profile.unresolvedQuestions.map((question) => `- ${question}`).join('\n') : '- None recorded.'}

## Required assurance notice

${ASSURANCE_NOTICE}
`;
}

export function recordArchaeologyTechnologyHosting(projectRoot, bundlePath, input, options = {}) {
  const bundleRoot = archaeologyBundleRoot(projectRoot, bundlePath);
  const briefPath = resolve(bundleRoot, 'technology-hosting-brief.json');
  const profilePath = resolve(bundleRoot, 'technology-hosting-profile.json');
  const markdownPath = resolve(bundleRoot, 'technology-hosting-profile.md');
  if (!existsSync(briefPath)) throw new Error('Prepare technology and hosting discovery before recording answers.');
  if (existsSync(profilePath) || existsSync(markdownPath)) throw new Error('Technology and hosting profile already exists; preserve the reviewed record and prepare a new Archaeology bundle or explicit refresh.');
  const reviewedBy = String(options.reviewedBy ?? '').trim();
  if (reviewedBy.length < 2) throw new Error('Technology and hosting recording requires --reviewed-by NAME.');
  const brief = readJsonFile(briefPath, 'technology and hosting brief');
  const errors = technologyHostingInputErrors(input, brief);
  if (errors.length) throw new Error(errors.join(' '));
  const observationIds = new Set(brief.observations.map((observation) => observation.id));
  const technology = input.technology.map((item, index) => cleanUndefined(normaliseTechnologyItem(item, index, observationIds)));
  const hostingInput = input.hosting;
  const hosting = {};
  for (const field of ['provider', 'platformService', 'deploymentModel', 'operatingModel', 'dataResidency', 'releaseRoute', 'operatingOwner']) {
    hosting[field] = normaliseTechnologyHostingAnswer(hostingInput[field], `hosting.${field}`, observationIds);
  }
  if (!deploymentModels.has(hosting.deploymentModel.value.toLowerCase())) throw new Error(`Unsupported deployment model: ${hosting.deploymentModel.value}.`);
  if (!operatingModels.has(hosting.operatingModel.value.toLowerCase())) throw new Error(`Unsupported operating model: ${hosting.operatingModel.value}.`);
  hosting.locations = (hostingInput.locations ?? []).map((location, index) => normaliseTechnologyHostingAnswer(location, `hosting.locations[${index}]`, observationIds));
  hosting.environments = (hostingInput.environments ?? []).map((environment, index) => {
    if (!environment || typeof environment !== 'object' || Array.isArray(environment)) throw new Error(`hosting.environments[${index}] must be an object.`);
    const name = String(environment.name ?? '').trim();
    if (!name) throw new Error(`hosting.environments[${index}] requires a name.`);
    const deploymentModel = String(environment.deploymentModel ?? 'unknown').trim().toLowerCase();
    const operatingModel = String(environment.operatingModel ?? 'unknown').trim().toLowerCase();
    if (!deploymentModels.has(deploymentModel)) throw new Error(`Unsupported deployment model in hosting.environments[${index}]: ${deploymentModel}.`);
    if (!operatingModels.has(operatingModel)) throw new Error(`Unsupported operating model in hosting.environments[${index}]: ${operatingModel}.`);
    const answer = normaliseTechnologyHostingAnswer({ ...environment, value: name }, `hosting.environments[${index}]`, observationIds);
    return cleanUndefined({
      name,
      provider: String(environment.provider ?? 'unknown').trim() || 'unknown',
      platformService: String(environment.platformService ?? 'unknown').trim() || 'unknown',
      location: String(environment.location ?? 'unknown').trim() || 'unknown',
      deploymentModel,
      operatingModel,
      provenance: answer.provenance,
      confirmed: answer.confirmed,
      observationRefs: answer.observationRefs,
      evidence: answer.evidence,
      notes: answer.notes
    });
  });

  const reviewByObservation = new Map();
  for (const [index, review] of (input.observationReviews ?? []).entries()) {
    const observationId = String(review?.observationId ?? '').trim();
    if (!observationIds.has(observationId)) throw new Error(`observationReviews[${index}] contains unknown observation reference ${observationId}.`);
    const status = String(review.status ?? '').trim();
    if (!observationReviewStatuses.has(status)) throw new Error(`observationReviews[${index}] has unsupported status ${status}.`);
    reviewByObservation.set(observationId, { status, notes: String(review.notes ?? '').trim() });
  }
  const observations = brief.observations.map((observation) => ({
    ...observation,
    review: reviewByObservation.get(observation.id) ?? { status: 'uncertain', notes: 'No owner disposition was recorded.' }
  }));
  const contradictions = (input.contradictions ?? []).map((contradiction, index) => {
    const summary = String(contradiction?.summary ?? '').trim();
    if (!summary) throw new Error(`contradictions[${index}] requires a summary.`);
    const observationRefs = cleanStringList(contradiction.observationRefs, `contradictions[${index}].observationRefs`);
    for (const reference of observationRefs) {
      if (!observationIds.has(reference)) throw new Error(`contradictions[${index}] contains unknown observation reference ${reference}.`);
    }
    return { summary, observationRefs, notes: String(contradiction.notes ?? '').trim() };
  });
  const unresolvedQuestions = cleanStringList(input.unresolvedQuestions, 'unresolvedQuestions');
  const recordedAt = options.now || new Date().toISOString();
  const body = {
    schema: technologyHostingSchemas.profile,
    status: 'recorded',
    preparedDigest: brief.digest,
    recordedAt,
    sourceMap: brief.sourceMap,
    review: { reviewedBy, reviewedAt: recordedAt, confirmationScope: 'Individual answers with confirmed=true only' },
    activePersonas: brief.activePersonas,
    observations,
    technology,
    hosting,
    contradictions,
    unresolvedQuestions,
    notices: [ASSURANCE_NOTICE]
  };
  const profile = { ...body, digest: technologyHostingDigest(body) };
  atomicArchaeologyFiles([
    { path: profilePath, content: `${JSON.stringify(profile, null, 2)}\n` },
    { path: markdownPath, content: renderTechnologyHostingProfile(profile) }
  ]);
  return { schema: technologyHostingSchemas.profile, status: 'recorded', bundleRoot, profilePath, markdownPath, profile };
}

export function readArchaeologyTechnologyHosting(projectRoot, bundlePath, options = {}) {
  const bundleRoot = archaeologyBundleRoot(projectRoot, bundlePath);
  const briefPath = resolve(bundleRoot, 'technology-hosting-brief.json');
  const profilePath = resolve(bundleRoot, 'technology-hosting-profile.json');
  if (!existsSync(briefPath)) {
    return { schema: technologyHostingSchemas.status, status: 'missing', bundleRoot, notices: [ASSURANCE_NOTICE] };
  }
  try {
    const brief = readJsonFile(briefPath, 'technology and hosting brief');
    const repositoryEvidence = sourceMapTechnologyEvidence(projectRoot, options.repositoryEvidence);
    const effectiveFreshness = technologyHostingFreshness(repositoryEvidence.freshness, projectRoot, bundleRoot);
    const stale = effectiveFreshness?.stale
      || effectiveFreshness?.status !== 'fresh'
      || Number(repositoryEvidence.runId) !== Number(brief.sourceMap?.runId);
    const profile = existsSync(profilePath) ? readJsonFile(profilePath, 'technology and hosting profile') : null;
    if (profile && profile.preparedDigest !== brief.digest) {
      return { schema: technologyHostingSchemas.status, status: 'stale', reason: 'profile-preparation-digest-mismatch', bundleRoot, brief, profile, notices: [ASSURANCE_NOTICE] };
    }
    return {
      schema: technologyHostingSchemas.status,
      status: stale ? 'stale' : profile ? 'recorded' : 'prepared',
      reason: stale ? 'repository-source-map-changed-or-stale' : null,
      freshness: effectiveFreshness,
      bundleRoot,
      brief,
      profile,
      notices: [ASSURANCE_NOTICE]
    };
  } catch (error) {
    return { schema: technologyHostingSchemas.status, status: 'invalid', bundleRoot, errors: [error.message], notices: [ASSURANCE_NOTICE] };
  }
}
