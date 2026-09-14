import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { loadProjectConfig } from './project.mjs';

export const ORGANISATION_POLICY_BASELINE_PATH = 'SPECS/4.Constraints/organisation-policy/baseline.json';

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lower-case slug');
const organisationPackId = z.string().regex(/^org\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
const valueId = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, 'must be a bounded lower-case identifier');
const text = (maximum) => z.string().trim().min(1).max(maximum);
const uniqueIds = (values) => new Set(values).size === values.length;
const outcomes = ['allow', 'deny', 'review-required', 'allow-with-controls', 'unassessed'];

const sourceReferenceSchema = z.object({
  id: slug,
  label: text(240),
}).strict();

const reviewRoleSchema = z.object({
  id: slug,
  name: text(160),
}).strict();

const conditionValues = z.array(valueId).min(1).max(40).refine(uniqueIds, 'must not contain duplicates');
const conditionSchema = z.object({
  resource: conditionValues.optional(),
  operation: conditionValues.optional(),
  data_entity: conditionValues.optional(),
  data_classification: conditionValues.optional(),
  actor: conditionValues.optional(),
  environment: conditionValues.optional(),
  destination: conditionValues.optional(),
  model: conditionValues.optional(),
  ai_use: conditionValues.optional(),
  retention: conditionValues.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'must define at least one condition');

const controlSchema = z.object({
  id: slug,
  title: text(160),
  description: text(800),
  evidence: z.array(z.enum(['claim', 'task', 'automated-test', 'named-human', 'specialist-review'])).min(1).max(5).refine(uniqueIds, 'must not contain duplicate evidence routes'),
}).strict();

const exceptionSchema = z.object({
  permitted: z.boolean(),
  review_role: slug.optional(),
}).strict();

const ruleSchema = z.object({
  id: slug,
  title: text(160),
  description: text(1200),
  when: conditionSchema,
  outcome: z.enum(outcomes),
  review_role: slug.optional(),
  controls: z.array(controlSchema).max(40).default([]),
  exceptions: exceptionSchema,
}).strict();

const policySchema = z.object({
  schema: z.literal('ewai.organisation-policy/v1'),
  id: slug,
  title: text(160),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  publisher: z.object({ id: slug, name: text(160) }).strict(),
  provenance: z.object({
    kind: z.enum(['owner-declared', 'regulatory', 'contractual', 'adapted']),
    summary: text(800),
    sources: z.array(sourceReferenceSchema).min(1).max(40),
  }).strict(),
  review_roles: z.array(reviewRoleSchema).max(40).default([]),
  unmatched_outcome: z.enum(outcomes),
  rules: z.array(ruleSchema).min(1).max(500),
}).strict().superRefine((policy, context) => {
  const duplicate = (items) => items.find((item, index) => items.indexOf(item) !== index);
  const sourceDuplicate = duplicate(policy.provenance.sources.map(({ id }) => id));
  if (sourceDuplicate) context.addIssue({ code: 'custom', path: ['provenance', 'sources'], message: `duplicate source reference: ${sourceDuplicate}` });
  const roleDuplicate = duplicate(policy.review_roles.map(({ id }) => id));
  if (roleDuplicate) context.addIssue({ code: 'custom', path: ['review_roles'], message: `duplicate review role: ${roleDuplicate}` });
  const ruleDuplicate = duplicate(policy.rules.map(({ id }) => id));
  if (ruleDuplicate) context.addIssue({ code: 'custom', path: ['rules'], message: `duplicate rule id: ${ruleDuplicate}` });
  const roles = new Set(policy.review_roles.map(({ id }) => id));
  for (const [index, rule] of policy.rules.entries()) {
    const controlDuplicate = duplicate(rule.controls.map(({ id }) => id));
    if (controlDuplicate) context.addIssue({ code: 'custom', path: ['rules', index, 'controls'], message: `duplicate control id: ${controlDuplicate}` });
    if (rule.outcome === 'review-required' && !rule.review_role) {
      context.addIssue({ code: 'custom', path: ['rules', index, 'review_role'], message: 'review-required rules must identify a review role' });
    }
    if (rule.outcome === 'allow-with-controls' && rule.controls.length === 0) {
      context.addIssue({ code: 'custom', path: ['rules', index, 'controls'], message: 'allow-with-controls rules must define at least one control' });
    }
    if (rule.review_role && !roles.has(rule.review_role)) {
      context.addIssue({ code: 'custom', path: ['rules', index, 'review_role'], message: `unknown review role: ${rule.review_role}` });
    }
    if (rule.exceptions.review_role && !roles.has(rule.exceptions.review_role)) {
      context.addIssue({ code: 'custom', path: ['rules', index, 'exceptions', 'review_role'], message: `unknown review role: ${rule.exceptions.review_role}` });
    }
    if (rule.exceptions.permitted && !rule.exceptions.review_role) {
      context.addIssue({ code: 'custom', path: ['rules', index, 'exceptions', 'review_role'], message: 'permitted exceptions require a review role' });
    }
    if (!rule.exceptions.permitted && rule.exceptions.review_role) {
      context.addIssue({ code: 'custom', path: ['rules', index, 'exceptions', 'review_role'], message: 'prohibited exceptions may not nominate a review role' });
    }
  }
});

const forbiddenKeys = /^(?:script|scripts|command|commands|prompt|prompts|template|templates|expression|expressions|executable|secret|secrets|credential|credentials|token|tokens|remote|fetch|url|uri|endpoint|handler|hook)$/i;

function assertInert(value, path = 'policy') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertInert(item, `${path}.${index}`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenKeys.test(key)) throw new Error(`Organisation policy contains forbidden executable or remote field at ${path}.${key}`);
    assertInert(item, `${path}.${key}`);
  }
}

function parsePolicy(value) {
  if (typeof value !== 'string') return value;
  try {
    return YAML.parse(value);
  } catch (error) {
    throw new Error(`Organisation policy is invalid YAML or JSON: ${error.message}`);
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`;
}

function validationError(error) {
  return error.issues?.map((issue) => `${issue.path.join('.') || 'policy'} ${issue.message}`).join('; ') ?? error.message;
}

export function validateOrganisationPolicy(value, options = {}) {
  const parsed = parsePolicy(value);
  assertInert(parsed);
  let policy;
  try {
    policy = policySchema.parse(parsed);
  } catch (error) {
    throw new Error(`Organisation policy is invalid: ${validationError(error)}`);
  }
  if (options.publisherId && policy.publisher.id !== options.publisherId) {
    throw new Error(`Organisation policy publisher ${policy.publisher.id} does not match Blueprint publisher ${options.publisherId}`);
  }
  if (options.contributionId && policy.id !== options.contributionId) {
    throw new Error(`Organisation policy id ${policy.id} does not match Blueprint contribution ${options.contributionId}`);
  }
  return { policy, digest: digest(policy) };
}

function packPin(pack) {
  return {
    id: pack.id,
    version: pack.version,
    digest: pack.digest,
    sourceClass: pack.sourceClass,
  };
}

function effectivePolicyDigest(blueprintDigest, packs, contributions) {
  return digest({
    blueprintDigest,
    packs,
    contributions: contributions.map(({ packId, moduleId, contributionId, required, policyDigest }) => ({ packId, moduleId, contributionId, required, policyDigest })),
  });
}

export function resolveOrganisationPolicy(blueprint) {
  if (!blueprint || blueprint.schema !== 'ewai.resolved-organisation-blueprint/v1') {
    throw new Error('A resolved Organisation Blueprint is required to resolve policy');
  }
  const packById = new Map(blueprint.packs.map((pack) => [pack.id, pack]));
  const contributions = [];
  const policyIds = new Set();
  for (const { packId, module } of blueprint.modules) {
    const pack = packById.get(packId);
    if (!pack) throw new Error(`Policy contribution references unresolved Blueprint pack: ${packId}`);
    for (const contribution of module.policies ?? []) {
      const validated = validateOrganisationPolicy(contribution.content, {
        publisherId: pack.blueprint.publisher.id,
        contributionId: contribution.id,
      });
      if (policyIds.has(validated.policy.id)) {
        throw new Error(`Ambiguous organisation policy id across selected Blueprint modules: ${validated.policy.id}`);
      }
      policyIds.add(validated.policy.id);
      contributions.push({
        packId,
        moduleId: module.id,
        contributionId: contribution.id,
        required: module.required,
        policyDigest: validated.digest,
        policy: validated.policy,
      });
    }
  }
  contributions.sort((left, right) => left.policy.id.localeCompare(right.policy.id) || left.packId.localeCompare(right.packId));
  const packs = blueprint.packs.map(packPin);
  const effectiveDigest = contributions.length === 0 ? null : effectivePolicyDigest(blueprint.digest, packs, contributions);
  return {
    schema: 'ewai.resolved-organisation-policy/v1',
    blueprintDigest: blueprint.digest,
    packs,
    contributions,
    effectiveDigest,
  };
}

export function previewPolicyBaseline(resolved) {
  if (!resolved || resolved.contributions?.length === 0) {
    return {
      schema: 'ewai.policy-baseline-preview/v1',
      status: 'not-configured',
      enabled: false,
      blocking: false,
      notice: 'No organisation policy baseline has been selected for this project.',
      counts: { policies: 0, rules: 0 },
      policies: [],
    };
  }
  if (resolved.schema !== 'ewai.resolved-organisation-policy/v1' || !resolved.effectiveDigest) {
    throw new Error('A resolved organisation policy is required for preview');
  }
  return {
    schema: 'ewai.policy-baseline-preview/v1',
    status: 'available',
    enabled: false,
    blocking: false,
    effectiveDigest: resolved.effectiveDigest,
    counts: {
      policies: resolved.contributions.length,
      rules: resolved.contributions.reduce((count, contribution) => count + contribution.policy.rules.length, 0),
    },
    policies: resolved.contributions.map((contribution) => ({
      id: contribution.policy.id,
      title: contribution.policy.title,
      version: contribution.policy.version,
      publisher: { ...contribution.policy.publisher },
      packId: contribution.packId,
      moduleId: contribution.moduleId,
      required: contribution.required,
      policyDigest: contribution.policyDigest,
      unmatchedOutcome: contribution.policy.unmatched_outcome,
      ruleCount: contribution.policy.rules.length,
      outcomes: [...new Set(contribution.policy.rules.map(({ outcome }) => outcome))].sort(),
      reviewRoles: contribution.policy.review_roles.map(({ id, name }) => ({ id, name })),
    })),
    authority: {
      advisoryUntilApproved: true,
      designTimeOnly: true,
      productionEnforcement: false,
    },
  };
}

function baselineStatus(selection, status, extra = {}) {
  return {
    schema: 'ewai.policy-baseline-status/v1',
    status,
    enabled: status !== 'not-configured' && status !== 'invalid',
    blocking: ['invalid', 'stale'].includes(status),
    ...(selection ? {
      effectiveDigest: selection.effective_digest,
      approvedBy: selection.approved_by,
      approvedAt: selection.approved_at,
      evidence: selection.evidence,
    } : {}),
    ...extra,
  };
}

function atomicBaselineWrite(configPath, configContent, evidencePath, evidenceContent, testHooks = {}) {
  mkdirSync(dirname(evidencePath), { recursive: true });
  const suffix = `.tmp-${process.pid}-${randomUUID()}`;
  const configTemp = `${configPath}${suffix}`;
  const evidenceTemp = `${evidencePath}${suffix}`;
  const priorConfig = readFileSync(configPath, 'utf8');
  const hadEvidence = existsSync(evidencePath);
  const priorEvidence = hadEvidence ? readFileSync(evidencePath, 'utf8') : null;
  try {
    writeFileSync(configTemp, configContent, { encoding: 'utf8', flag: 'wx' });
    writeFileSync(evidenceTemp, evidenceContent, { encoding: 'utf8', flag: 'wx' });
    renameSync(evidenceTemp, evidencePath);
    if (testHooks.failAfterEvidence) throw new Error('Injected policy baseline failure');
    renameSync(configTemp, configPath);
  } catch (error) {
    if (existsSync(configTemp)) unlinkSync(configTemp);
    if (existsSync(evidenceTemp)) unlinkSync(evidenceTemp);
    if (hadEvidence) writeFileSync(evidencePath, priorEvidence, 'utf8');
    else if (existsSync(evidencePath)) unlinkSync(evidencePath);
    if (readFileSync(configPath, 'utf8') !== priorConfig) writeFileSync(configPath, priorConfig, 'utf8');
    throw error;
  }
}

export function materialisePolicyBaseline(projectRoot, resolved, options = {}) {
  if (options.confirmed !== true) throw new Error('Policy baseline materialisation requires explicit confirmation');
  const approvedBy = String(options.approvedBy ?? '').trim();
  if (!approvedBy) throw new Error('Policy baseline materialisation requires a named approver');
  const expectedDigest = String(options.expectedDigest ?? '').trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedDigest)) throw new Error('Policy baseline materialisation requires an exact expected digest');
  if (!resolved || resolved.schema !== 'ewai.resolved-organisation-policy/v1' || resolved.contributions.length === 0 || !resolved.effectiveDigest) {
    throw new Error('Policy baseline materialisation requires at least one resolved policy contribution');
  }
  if (resolved.effectiveDigest !== expectedDigest) {
    throw new Error(`Policy baseline digest drift: expected ${expectedDigest}, resolved ${resolved.effectiveDigest}`);
  }
  const approvedAt = options.now ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(approvedAt))) throw new Error('Policy baseline approval time must be an ISO date-time');
  const { config, paths } = loadProjectConfig(projectRoot);
  const evidence = {
    schema: 'ewai.organisation-policy-baseline/v1',
    effectiveDigest: resolved.effectiveDigest,
    blueprintDigest: resolved.blueprintDigest,
    packs: resolved.packs,
    contributions: resolved.contributions,
    approval: { approvedBy, approvedAt },
    authority: {
      designTimeOnly: true,
      productionEnforcement: false,
      statement: 'EWAI checks the design, not production traffic.',
    },
  };
  config.organisation_policy = {
    status: 'enabled',
    packs: resolved.packs.map(({ id, version, digest: packDigest, sourceClass }) => ({ id, version, digest: packDigest, source_class: sourceClass })),
    blueprint_digest: resolved.blueprintDigest,
    effective_digest: resolved.effectiveDigest,
    approved_by: approvedBy,
    approved_at: approvedAt,
    evidence: ORGANISATION_POLICY_BASELINE_PATH,
  };
  const evidencePath = resolve(paths.projectRoot, ORGANISATION_POLICY_BASELINE_PATH);
  atomicBaselineWrite(
    paths.configPath,
    YAML.stringify(config, { lineWidth: 0 }),
    evidencePath,
    `${JSON.stringify(evidence, null, 2)}\n`,
    options.testHooks,
  );
  return readPolicyBaselineStatus(projectRoot);
}

export function readPolicyBaselineStatus(projectRoot, options = {}) {
  const { config, paths } = loadProjectConfig(projectRoot);
  const selection = config.organisation_policy;
  if (!selection) {
    return baselineStatus(null, 'not-configured', {
      notice: 'No organisation policy baseline has been selected for this project.',
    });
  }
  if (
    selection.status !== 'enabled'
    || selection.evidence !== ORGANISATION_POLICY_BASELINE_PATH
    || !selection.effective_digest
    || !selection.blueprint_digest
    || !Array.isArray(selection.packs)
    || selection.packs.length === 0
  ) {
    return baselineStatus(selection, 'invalid', { notice: 'The configured organisation policy baseline is incomplete.' });
  }
  const evidencePath = resolve(paths.projectRoot, selection.evidence);
  if (!existsSync(evidencePath)) {
    return baselineStatus(selection, 'invalid', { notice: 'The configured organisation policy evidence is missing.' });
  }
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  } catch (error) {
    return baselineStatus(selection, 'invalid', { notice: `The configured organisation policy evidence is invalid: ${error.message}` });
  }
  let evidenceIntegrity = false;
  try {
    if (
      evidence.schema !== 'ewai.organisation-policy-baseline/v1'
      || !Array.isArray(evidence.packs)
      || !Array.isArray(evidence.contributions)
      || evidence.contributions.length === 0
      || evidence.blueprintDigest !== selection.blueprint_digest
      || evidence.effectiveDigest !== selection.effective_digest
      || evidence.approval?.approvedBy !== selection.approved_by
      || evidence.approval?.approvedAt !== selection.approved_at
      || evidence.authority?.designTimeOnly !== true
      || evidence.authority?.productionEnforcement !== false
    ) throw new Error('baseline envelope mismatch');
    const selectedPins = selection.packs.map(({ id, version, digest: packDigest, source_class }) => ({ id, version, digest: packDigest, sourceClass: source_class }));
    if (JSON.stringify(canonical(evidence.packs)) !== JSON.stringify(canonical(selectedPins))) throw new Error('pack pin mismatch');
    for (const contribution of evidence.contributions) {
      if (
        !organisationPackId.safeParse(contribution.packId).success
        || !slug.safeParse(contribution.moduleId).success
        || !slug.safeParse(contribution.contributionId).success
        || typeof contribution.required !== 'boolean'
      ) throw new Error('invalid contribution identity');
      const validated = validateOrganisationPolicy(contribution.policy, {
        publisherId: contribution.packId.split('.')[1],
        contributionId: contribution.contributionId,
      });
      if (validated.digest !== contribution.policyDigest) throw new Error('policy content digest mismatch');
    }
    if (effectivePolicyDigest(evidence.blueprintDigest, evidence.packs, evidence.contributions) !== evidence.effectiveDigest) {
      throw new Error('effective digest mismatch');
    }
    evidenceIntegrity = true;
  } catch {
    evidenceIntegrity = false;
  }
  if (!evidenceIntegrity) {
    return baselineStatus(selection, 'invalid', { notice: 'The configured organisation policy evidence does not match its approved pin.' });
  }
  if (options.resolved && options.resolved.effectiveDigest !== selection.effective_digest) {
    return baselineStatus(selection, 'stale', {
      acceptedDigest: selection.effective_digest,
      currentDigest: options.resolved.effectiveDigest,
      notice: 'Installed policy content has changed since approval. Re-resolve it and obtain a new named approval.',
    });
  }
  return baselineStatus(selection, 'enabled', {
    blocking: false,
    policyCount: evidence.contributions.length,
    ruleCount: evidence.contributions.reduce((count, contribution) => count + contribution.policy.rules.length, 0),
    authority: { designTimeOnly: true, productionEnforcement: false },
  });
}
