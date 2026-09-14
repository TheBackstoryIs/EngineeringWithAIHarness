import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { validateDesignSystemReceipt } from './design-system-application.mjs';
import { policyGateRequirementsForPhase } from './policy-gate-integration.mjs';

const contractPath = fileURLToPath(new URL('../config/delivery-artifacts.yaml', import.meta.url));
const contract = YAML.parse(readFileSync(contractPath, 'utf8'));

function taskCompletionPaths(deliveryRoot) {
  const graphPath = resolve(deliveryRoot, 'task-graph.json');
  if (!existsSync(graphPath)) return ['task-graph.json'];
  let graph;
  try {
    graph = JSON.parse(readFileSync(graphPath, 'utf8'));
  } catch {
    return ['task-graph.json (valid JSON required)'];
  }
  const tasks = Array.isArray(graph.tasks) ? graph.tasks : [];
  if (!tasks.length) return ['task-graph.json (at least one task required)'];
  return tasks.flatMap((task, index) => {
    const configured = String(task.report_path ?? '').trim();
    const id = String(task.id ?? '').trim();
    const report = configured || (id ? `tasks/${id}/report.md` : `task-graph.json (task ${index + 1} requires id or report_path)`);
    const evidence = String(task.evidence_path ?? '').trim()
      || (id ? `tasks/${id}/evidence.json` : `task-graph.json (task ${index + 1} requires id or evidence_path)`);
    return [report, evidence];
  });
}

function projectRootForDelivery(deliveryRoot) {
  let candidate = resolve(deliveryRoot);
  while (dirname(candidate) !== candidate) {
    if (existsSync(resolve(candidate, '.ewai-pipeline/project.json'))) return candidate;
    candidate = dirname(candidate);
  }
  return null;
}

export function requiredPhaseArtefacts(deliveryRoot, phaseId, providers = [], cycles = []) {
  const definition = contract.phases?.[phaseId];
  if (!definition) return [];
  const required = [...(definition.required ?? [])];
  const projectRoot = projectRootForDelivery(deliveryRoot);
  if (projectRoot && definition.organisation_policy) {
    const slug = basename(resolve(deliveryRoot));
    if (policyGateRequirementsForPhase(projectRoot, slug, phaseId).requirements.length) {
      required.push(...(definition.organisation_policy.required ?? []));
    }
  }
  if (definition.validation_cycles) {
    required.push(`${phaseId}/validation-cycles.json`);
    for (const cycle of cycles) {
      if (cycle.responsePath) required.push(cycle.responsePath);
      if (cycle.fixPath) required.push(cycle.fixPath);
    }
  }
  if (definition.task_reports) required.push(...taskCompletionPaths(deliveryRoot));
  return [...new Set(required)];
}

export function validatePhaseArtefacts(deliveryRoot, phaseId, providers = [], cycles = []) {
  const required = requiredPhaseArtefacts(deliveryRoot, phaseId, providers, cycles);
  const root = resolve(deliveryRoot);
  const missing = required.filter((path) => {
    if (!path || path.includes('(')) return true;
    const absolute = resolve(root, path);
    const rel = relative(root, absolute);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return true;
    return !existsSync(absolute) || !statSync(absolute).isFile();
  });
  if (missing.length) {
    const lines = missing.map((path) => `- ${path}`).join('\n');
    throw new Error(`Phase ${phaseId} is missing canonical delivery artefacts:\n${lines}`);
  }
  if (phaseId === 'ui-design') validatePrototypeManifest(root);
  return required;
}

export function validatePrototypeManifest(deliveryRoot) {
  const root = resolve(deliveryRoot);
  const manifestPath = resolve(root, 'ui-design-assets/prototypes/manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`UI Design prototype manifest is not valid JSON: ${error.message}`);
  }
  const errors = [];
  const statePath = resolve(root, 'delivery-state.json');
  let requiredContract = '';
  if (existsSync(statePath)) {
    try {
      requiredContract = JSON.parse(readFileSync(statePath, 'utf8'))?.artefactContracts?.prototype ?? '';
    } catch {
      errors.push('delivery-state.json must be valid JSON before validating prototype evidence');
    }
  }
  if (!['ewai.prototype-manifest/v1', 'ewai.prototype-manifest/v2', 'ewai.prototype-manifest/v3'].includes(manifest.schema)) {
    errors.push('schema must be ewai.prototype-manifest/v1, ewai.prototype-manifest/v2 or ewai.prototype-manifest/v3');
  }
  if (['ewai.prototype-manifest/v2', 'ewai.prototype-manifest/v3'].includes(requiredContract) && manifest.schema !== requiredContract) {
    errors.push(`this delivery requires ${requiredContract}; migrate the prototype manifest and link its governed design evidence`);
  }
  if (!['selected', 'approved'].includes(String(manifest.status ?? '').trim().toLowerCase())) {
    errors.push('status must be selected or approved');
  }
  const selected = manifest.selected ?? {};
  for (const key of ['title', 'path', 'decision']) {
    if (!String(selected[key] ?? '').trim()) errors.push(`selected.${key} is required`);
  }
  const prototypePath = resolve(root, String(selected.path ?? ''));
  const prototypeRoot = resolve(root, 'ui-design-assets/prototypes');
  const prototypeRelative = relative(prototypeRoot, prototypePath);
  if (!selected.path || isAbsolute(String(selected.path)) || !prototypeRelative || prototypeRelative.startsWith('..') || isAbsolute(prototypeRelative)) {
    errors.push('selected.path must identify a file inside ui-design-assets/prototypes');
  } else if (!existsSync(prototypePath) || !statSync(prototypePath).isFile()) {
    errors.push(`selected prototype does not exist: ${selected.path}`);
  } else if (lstatSync(prototypeRoot).isSymbolicLink() || lstatSync(prototypePath).isSymbolicLink()) {
    errors.push('selected prototype and prototypes directory may not be a symbolic link');
  } else if (relative(realpathSync(prototypeRoot), realpathSync(prototypePath)).startsWith('..')) {
    errors.push('selected prototype may not escape the prototypes directory through a symbolic link');
  } else if (!['.html', '.htm'].includes(extname(prototypePath).toLowerCase())) {
    errors.push('selected prototype must be an HTML entry point');
  }
  const registration = manifest.registration ?? {};
  if (registration.kind !== 'prototype') errors.push('registration.kind must be prototype');
  if (registration.status !== 'active') errors.push('registration.status must be active');
  if (registration.path !== selected.path) errors.push('registration.path must match selected.path');
  if (['ewai.prototype-manifest/v2', 'ewai.prototype-manifest/v3'].includes(manifest.schema)) {
    const application = manifest.designSystem ?? {};
    let receipt = null;
    try {
      receipt = validateDesignSystemReceipt(root, application.receiptPath);
    } catch (error) {
      errors.push(error.message);
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(String(application.receiptDigest ?? ''))) errors.push('designSystem.receiptDigest must be SHA-256');
    if (!/^sha256:[a-f0-9]{64}$/.test(String(application.effectiveDigest ?? ''))) errors.push('designSystem.effectiveDigest must be SHA-256');
    if (receipt) {
      if (receipt.delivery !== basename(root)) errors.push('design-system receipt delivery must match this delivery');
      if (application.receiptDigest !== receipt.digest) errors.push('designSystem.receiptDigest must match the receipt');
      if (application.effectiveDigest !== receipt.designSystem.effectiveDigest) errors.push('designSystem.effectiveDigest must match the receipt');
    }
  }
  if (manifest.schema === 'ewai.prototype-manifest/v3') {
    const reviews = manifest.reviews ?? {};
    const reviewRoot = resolve(root, 'ui-design-assets/prototype-iterations');
    const reviewRecords = {};
    for (const [key, schema, expectedFolder] of [
      ['plan', 'ewai.prototype-plan-review/v1', 'plans'],
      ['finalCycle', 'ewai.prototype-cycle-review/v1', 'cycles'],
    ]) {
      const link = reviews[key] ?? {};
      if (!String(link.path ?? '').trim()) {
        errors.push(`reviews.${key}.path is required`);
        continue;
      }
      if (!/^sha256:[a-f0-9]{64}$/.test(String(link.digest ?? ''))) errors.push(`reviews.${key}.digest must be SHA-256`);
      const candidate = resolve(root, String(link.path));
      const expectedRoot = resolve(reviewRoot, expectedFolder);
      const rel = relative(expectedRoot, candidate);
      if (isAbsolute(String(link.path)) || !rel || rel.startsWith('..') || isAbsolute(rel)) {
        errors.push(`reviews.${key}.path must identify immutable evidence inside ui-design-assets/prototype-iterations/${expectedFolder}`);
        continue;
      }
      if (!existsSync(candidate) || !statSync(candidate).isFile()) {
        errors.push(`reviews.${key}.path does not exist: ${link.path}`);
        continue;
      }
      if (lstatSync(expectedRoot).isSymbolicLink() || lstatSync(candidate).isSymbolicLink()) {
        errors.push(`reviews.${key}.path and its evidence directory may not be symbolic links`);
        continue;
      }
      try {
        const record = JSON.parse(readFileSync(candidate, 'utf8'));
        reviewRecords[key] = record;
        if (record.schema !== schema) errors.push(`reviews.${key}.path must contain ${schema}`);
        if (record.contentDigest !== link.digest) errors.push(`reviews.${key}.digest must match the immutable review record`);
        if (record.deliverySlug && record.deliverySlug !== basename(root)) errors.push(`reviews.${key} delivery must match this delivery`);
      } catch (error) {
        errors.push(`reviews.${key}.path must contain valid review JSON: ${error.message}`);
      }
    }
    const plan = reviewRecords.plan;
    const cycle = reviewRecords.finalCycle;
    if (cycle) {
      if (!Number.isInteger(reviews.finalCycle?.cycleNumber) || reviews.finalCycle.cycleNumber < 1 || reviews.finalCycle.cycleNumber > 3) {
        errors.push('reviews.finalCycle.cycleNumber must be an integer from 1 to 3');
      } else if (cycle.cycleNumber !== reviews.finalCycle.cycleNumber) {
        errors.push('reviews.finalCycle.cycleNumber must match the immutable cycle review');
      }
      if (plan && cycle.planReviewDigest !== plan.contentDigest) errors.push('the final cycle must reference the linked reviewed plan');
      if (cycle.prototype?.entryPath !== selected.path) errors.push('the final reviewed cycle must reference selected.path');
    }
  }
  if (errors.length) throw new Error(`UI Design prototype manifest is incomplete:\n- ${errors.join('\n- ')}`);
  return manifest;
}

export function deliveryArtefactContract() {
  return structuredClone(contract);
}
