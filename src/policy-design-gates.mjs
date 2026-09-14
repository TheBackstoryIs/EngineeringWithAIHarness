import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import { atomicJson } from './delivery-documents.mjs';
import { ORGANISATION_POLICY_BASELINE_PATH, readPolicyBaselineStatus } from './organisation-policies.mjs';
import { loadProjectConfig } from './project.mjs';

const dimensions = ['resource', 'operation', 'data_entity', 'data_classification', 'actor', 'environment', 'destination', 'model', 'ai_use', 'retention'];
const outcomes = ['allow', 'deny', 'review-required', 'allow-with-controls', 'unassessed'];
const outcomeRank = new Map(['allow', 'allow-with-controls', 'unassessed', 'review-required', 'deny'].map((outcome, index) => [outcome, index]));
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const intentReference = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const valueId = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
const boundedText = (maximum) => z.string().trim().min(1).max(maximum);
const unique = (values) => new Set(values).size === values.length;
const factValues = z.array(valueId).min(1).max(40).refine(unique, 'must not contain duplicates');
const evidenceReference = z.string().trim().min(1).max(500).refine((value) => (
  !isAbsolute(value) && !value.includes('\0') && !value.split(/[\\/]+/).includes('..')
), 'must be a bounded project evidence reference');

const personaSourceSchema = z.object({
  id: z.string().min(1).max(160),
  name: boundedText(160),
  tier: z.enum(['core', 'personal', 'project', 'premium']),
});

const sourceSchema = z.object({
  kind: z.enum(['observed', 'model-proposal', 'persona-hypothesis']),
  reference: boundedText(500),
  persona: personaSourceSchema.optional(),
}).strict().superRefine((source, context) => {
  if (source.kind === 'persona-hypothesis' && !source.persona) {
    context.addIssue({ code: 'custom', path: ['persona'], message: 'persona hypotheses require safe persona provenance' });
  }
  if (source.kind !== 'persona-hypothesis' && source.persona) {
    context.addIssue({ code: 'custom', path: ['persona'], message: 'persona provenance applies only to persona hypotheses' });
  }
});

const factSchema = z.object({
  id: slug,
  dimension: z.enum(dimensions),
  values: factValues,
  rationale: boundedText(1200),
  source: sourceSchema,
}).strict();

const intentSchema = z.object({
  reference: intentReference,
  revision: z.number().int().positive(),
  digest: digestSchema,
}).strict();

const decisionSchema = z.object({
  factId: slug,
  disposition: z.enum(['confirmed', 'rejected']),
  values: factValues.optional(),
}).strict().superRefine((decision, context) => {
  if (decision.disposition === 'rejected' && decision.values) {
    context.addIssue({ code: 'custom', path: ['values'], message: 'rejected facts may not provide replacement values' });
  }
});

const scopeSchema = z.object(Object.fromEntries(dimensions.map((dimension) => [dimension, factValues.optional()])))
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'exception scope must contain at least one bounded condition');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function sha(value) {
  return `sha256:${createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex')}`;
}

function parseWith(schema, value, label) {
  try {
    return schema.parse(value);
  } catch (error) {
    const details = error.issues?.map((issue) => `${issue.path.join('.') || label} ${issue.message}`).join('; ') ?? error.message;
    throw new Error(`${label} is invalid: ${details}`);
  }
}

function cleanHuman(value, label) {
  const result = String(value ?? '').trim();
  if (!result || result.length > 160 || /[\u0000-\u001f\u007f]/.test(result)) throw new Error(`${label} requires a named ${label.toLowerCase()}`);
  return result;
}

function requireHumanAuthority(input) {
  if (input.authority !== 'human') throw new Error('This decision requires named human authority; a model or persona cannot make it');
}

function referenceParts(reference) {
  const checked = intentReference.parse(reference);
  return checked.split('/');
}

function policyPaths(projectRoot, reference) {
  const { config, paths } = loadProjectConfig(projectRoot);
  const [domain, slugValue] = referenceParts(reference);
  return {
    config,
    paths,
    proposalPath: resolve(paths.runtimeRoot, 'policy/facts', domain, `${slugValue}.draft.json`),
    factsPath: resolve(paths.specsRoot, '3.Evidence/policy/facts', domain, `${slugValue}.json`),
    factsMarkdownPath: resolve(paths.specsRoot, '3.Evidence/policy/facts', domain, `${slugValue}.md`),
    evaluationPath: resolve(paths.specsRoot, '3.Evidence/policy/evaluations', domain, `${slugValue}.json`),
    evaluationMarkdownPath: resolve(paths.specsRoot, '3.Evidence/policy/evaluations', domain, `${slugValue}.md`),
    reviewsRoot: resolve(paths.specsRoot, '3.Evidence/policy/reviews', domain, slugValue),
    exceptionsRoot: resolve(paths.specsRoot, '3.Evidence/policy/exceptions', domain, slugValue),
  };
}

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} does not exist`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
}

function approvedBaseline(projectRoot) {
  const status = readPolicyBaselineStatus(projectRoot);
  if (status.status !== 'enabled') throw new Error(`An approved current organisation policy baseline is required; current status is ${status.status}`);
  const { paths } = loadProjectConfig(projectRoot);
  const baseline = readJson(resolve(paths.projectRoot, ORGANISATION_POLICY_BASELINE_PATH), 'Organisation policy baseline');
  return { status, baseline };
}

function atomicPair(jsonPath, jsonContent, markdownPath, markdownContent) {
  mkdirSync(dirname(jsonPath), { recursive: true });
  mkdirSync(dirname(markdownPath), { recursive: true });
  const suffix = `.ewai-${process.pid}-${randomUUID()}.tmp`;
  const jsonTemp = `${jsonPath}${suffix}`;
  const markdownTemp = `${markdownPath}${suffix}`;
  const priorJson = existsSync(jsonPath) ? readFileSync(jsonPath, 'utf8') : null;
  const priorMarkdown = existsSync(markdownPath) ? readFileSync(markdownPath, 'utf8') : null;
  try {
    writeFileSync(jsonTemp, jsonContent, { encoding: 'utf8', flag: 'wx' });
    writeFileSync(markdownTemp, markdownContent, { encoding: 'utf8', flag: 'wx' });
    renameSync(markdownTemp, markdownPath);
    try {
      renameSync(jsonTemp, jsonPath);
    } catch (error) {
      if (priorMarkdown == null) rmSync(markdownPath, { force: true });
      else writeFileSync(markdownPath, priorMarkdown, 'utf8');
      throw error;
    }
  } catch (error) {
    rmSync(jsonTemp, { force: true });
    rmSync(markdownTemp, { force: true });
    if (priorJson != null && (!existsSync(jsonPath) || readFileSync(jsonPath, 'utf8') !== priorJson)) writeFileSync(jsonPath, priorJson, 'utf8');
    throw error;
  }
}

function factProposalMarkdown(proposal) {
  const rows = proposal.facts.map((fact) => `| \`${fact.id}\` | ${fact.dimension} | ${fact.values.join(', ')} | ${fact.provenance.kind} |`).join('\n');
  return `# Confirmed policy design facts — ${proposal.intent.reference}\n\n` +
    `**Intent revision:** ${proposal.intent.revision}  \n**Policy digest:** \`${proposal.policyDigest}\`  \n` +
    `**Facts digest:** \`${proposal.factsDigest}\`  \n**Confirmed by:** ${proposal.confirmation.confirmedBy}  \n` +
    `**Confirmed at:** ${proposal.confirmation.confirmedAt}\n\n| Fact | Dimension | Values | Original source |\n|---|---|---|---|\n${rows}\n\n` +
    `Only the named confirmation makes these facts authoritative. Model and persona provenance remains advisory evidence.\n`;
}

function evaluationMarkdown(evaluation) {
  const rows = evaluation.matchedRules.map((rule) => `| \`${rule.qualifiedRuleId}\` | ${rule.title} | ${rule.outcome} |`).join('\n') || '| — | No rule matched | — |';
  return `# Policy design evaluation — ${evaluation.intent.reference}\n\n` +
    `**Outcome:** ${evaluation.governingOutcome}  \n**Evaluation digest:** \`${evaluation.evaluationDigest}\`  \n` +
    `**Policy digest:** \`${evaluation.policyDigest}\`  \n**Facts digest:** \`${evaluation.factsDigest}\`\n\n` +
    `| Rule | Title | Outcome |\n|---|---|---|\n${rows}\n\n` +
    `EWAI checks the design, not production traffic. This result is not production enforcement, certification, residual-risk acceptance or release authority.\n`;
}

export function preparePolicyFacts(projectRoot, input = {}, options = {}) {
  const { status } = approvedBaseline(projectRoot);
  const intent = parseWith(intentSchema, input.intent, 'Policy fact intent');
  if (!Array.isArray(input.facts) || input.facts.length === 0 || input.facts.length > 200) throw new Error('Policy fact proposal requires between 1 and 200 facts');
  const facts = input.facts.map((fact) => parseWith(factSchema, fact, 'Policy fact'));
  if (!unique(facts.map(({ id }) => id))) throw new Error('Policy fact proposal contains a duplicate fact id');
  const paths = policyPaths(projectRoot, intent.reference);
  const existing = existsSync(paths.proposalPath) ? readJson(paths.proposalPath, 'Policy fact proposal') : null;
  const revision = Number(existing?.revision ?? 0) + 1;
  const proposalDigest = sha({ intent, policyDigest: status.effectiveDigest, facts });
  const proposal = {
    schema: 'ewai.policy-fact-proposal/v1',
    revision,
    preparedAt: options.now ?? new Date().toISOString(),
    intent,
    policyDigest: status.effectiveDigest,
    proposalDigest,
    facts,
    authority: { authoritative: false, requiresNamedHumanConfirmation: true },
  };
  atomicJson(paths.proposalPath, proposal);
  return proposal;
}

function factsDigest(record) {
  return sha({
    intent: record.intent,
    policyDigest: record.policyDigest,
    facts: record.facts,
  });
}

function validateConfirmedFacts(record) {
  if (record?.schema !== 'ewai.confirmed-policy-facts/v1' || record.authority?.authoritative !== true) throw new Error('Confirmed policy facts are invalid or non-authoritative');
  parseWith(intentSchema, record.intent, 'Confirmed fact intent');
  digestSchema.parse(record.policyDigest);
  digestSchema.parse(record.proposalDigest);
  const facts = record.facts.map((fact) => parseWith(factSchema, {
    id: fact.id,
    dimension: fact.dimension,
    values: fact.values,
    rationale: fact.rationale,
    source: fact.provenance,
  }, 'Confirmed fact'));
  const computed = factsDigest({ intent: record.intent, policyDigest: record.policyDigest, facts: record.facts });
  if (computed !== record.factsDigest) throw new Error('Confirmed policy facts do not match their accepted digest');
  return record;
}

export function confirmPolicyFacts(projectRoot, input = {}, options = {}) {
  if (input.confirmed !== true) throw new Error('Policy fact confirmation requires explicit confirmation');
  requireHumanAuthority(input);
  const confirmedBy = cleanHuman(input.confirmedBy, 'Named confirmer');
  const reference = intentReference.parse(input.intentReference);
  const paths = policyPaths(projectRoot, reference);
  const proposal = readJson(paths.proposalPath, 'Policy fact proposal');
  if (Number(input.expectedRevision) !== proposal.revision) throw new Error(`A newer revision of this policy fact proposal exists (current revision ${proposal.revision})`);
  if (input.expectedProposalDigest !== proposal.proposalDigest) throw new Error('Policy fact proposal digest drift; review the current proposal before confirmation');
  if (!Array.isArray(input.decisions)) throw new Error('Policy fact confirmation requires a decision for every proposed fact');
  const decisions = input.decisions.map((decision) => parseWith(decisionSchema, decision, 'Policy fact decision'));
  if (!unique(decisions.map(({ factId }) => factId)) || decisions.length !== proposal.facts.length) throw new Error('Policy fact confirmation requires exactly one decision for every proposed fact');
  const byId = new Map(decisions.map((decision) => [decision.factId, decision]));
  if (proposal.facts.some(({ id }) => !byId.has(id)) || decisions.some(({ factId }) => !proposal.facts.some(({ id }) => id === factId))) {
    throw new Error('Policy fact confirmation requires exactly one decision for every proposed fact');
  }
  const facts = proposal.facts.flatMap((fact) => {
    const decision = byId.get(fact.id);
    if (decision.disposition === 'rejected') return [];
    return [{
      id: fact.id,
      dimension: fact.dimension,
      values: decision.values ?? fact.values,
      rationale: fact.rationale,
      provenance: fact.source,
    }];
  });
  if (facts.length === 0) throw new Error('At least one policy design fact must be confirmed');
  const existing = existsSync(paths.factsPath) ? readJson(paths.factsPath, 'Confirmed policy facts') : null;
  const record = {
    schema: 'ewai.confirmed-policy-facts/v1',
    revision: Number(existing?.revision ?? 0) + 1,
    intent: proposal.intent,
    policyDigest: proposal.policyDigest,
    proposalDigest: proposal.proposalDigest,
    facts,
    confirmation: { confirmedBy, confirmedAt: options.now ?? new Date().toISOString(), decisions },
    authority: { authoritative: true, source: 'named-human-confirmation', modelAuthority: false, personaAuthority: false },
  };
  record.factsDigest = factsDigest(record);
  atomicPair(paths.factsPath, `${JSON.stringify(record, null, 2)}\n`, paths.factsMarkdownPath, factProposalMarkdown(record));
  return record;
}

function conditionMatches(when, factsByDimension) {
  const matched = [];
  for (const [dimension, expected] of Object.entries(when)) {
    const facts = factsByDimension.get(dimension) ?? [];
    const relevant = facts.filter((fact) => fact.values.some((value) => expected.includes(value)));
    if (relevant.length === 0) return null;
    matched.push(...relevant.map((fact) => ({ id: fact.id, dimension: fact.dimension, values: fact.values.filter((value) => expected.includes(value)) })));
  }
  return matched.sort((left, right) => left.dimension.localeCompare(right.dimension) || left.id.localeCompare(right.id));
}

function governingOutcome(values) {
  return [...values].sort((left, right) => (outcomeRank.get(right) ?? -1) - (outcomeRank.get(left) ?? -1))[0] ?? 'unassessed';
}

function currentFacts(projectRoot, reference) {
  const paths = policyPaths(projectRoot, reference);
  return validateConfirmedFacts(readJson(paths.factsPath, 'Confirmed policy facts'));
}

function evaluationCore(baseline, facts) {
  const factsByDimension = new Map(dimensions.map((dimension) => [dimension, facts.facts.filter((fact) => fact.dimension === dimension)]));
  const matchedRules = [];
  const unmatchedPolicies = [];
  for (const contribution of baseline.contributions) {
    let policyMatches = 0;
    for (const rule of contribution.policy.rules) {
      const matchedFacts = conditionMatches(rule.when, factsByDimension);
      if (!matchedFacts) continue;
      policyMatches += 1;
      matchedRules.push({
        policyId: contribution.policy.id,
        ruleId: rule.id,
        qualifiedRuleId: `${contribution.policy.id}:${rule.id}`,
        title: rule.title,
        outcome: rule.outcome,
        matchedFacts,
        reviewRole: rule.review_role ?? null,
        controls: rule.controls,
        exceptions: rule.exceptions,
        conditions: rule.when,
      });
    }
    if (policyMatches === 0) unmatchedPolicies.push({
      policyId: contribution.policy.id,
      outcome: contribution.policy.unmatched_outcome,
    });
  }
  matchedRules.sort((left, right) => left.qualifiedRuleId.localeCompare(right.qualifiedRuleId));
  unmatchedPolicies.sort((left, right) => left.policyId.localeCompare(right.policyId));
  const consideredOutcomes = [...matchedRules.map(({ outcome }) => outcome), ...unmatchedPolicies.map(({ outcome }) => outcome)];
  return {
    governingOutcome: governingOutcome(consideredOutcomes),
    consideredOutcomes: [...new Set(consideredOutcomes)].sort((left, right) => (outcomeRank.get(right) ?? -1) - (outcomeRank.get(left) ?? -1)),
    matchedRules,
    unmatchedPolicies,
    controls: matchedRules.flatMap((rule) => rule.controls.map((control) => ({ ...control, ruleId: rule.qualifiedRuleId }))),
    requiredReviews: matchedRules.filter(({ outcome }) => outcome === 'review-required').map((rule) => ({ ruleId: rule.qualifiedRuleId, reviewRole: rule.reviewRole })),
  };
}

export function evaluatePolicyDesign(projectRoot, input = {}, options = {}) {
  const reference = intentReference.parse(input.intentReference);
  const { status, baseline } = approvedBaseline(projectRoot);
  const facts = currentFacts(projectRoot, reference);
  if (input.expectedPolicyDigest !== status.effectiveDigest || facts.policyDigest !== status.effectiveDigest) throw new Error('Policy evaluation requires the current approved policy digest');
  if (input.expectedFactsDigest !== facts.factsDigest) throw new Error('Policy evaluation facts are stale; review the current confirmed facts');
  if (Number(input.expectedIntentRevision) !== facts.intent.revision) throw new Error('Policy evaluation intent revision is stale');
  const core = evaluationCore(baseline, facts);
  const paths = policyPaths(projectRoot, reference);
  const existing = existsSync(paths.evaluationPath) ? currentEvaluation(projectRoot, reference) : null;
  const record = {
    schema: 'ewai.policy-design-evaluation/v1',
    revision: Number(existing?.revision ?? 0) + 1,
    intent: facts.intent,
    policyDigest: status.effectiveDigest,
    factsDigest: facts.factsDigest,
    ...core,
    limitations: [
      'Design-time evidence only; production enforcement remains outside EWAI.',
      'Policy correctness, compliance certification and residual-risk acceptance require accountable human assurance.',
    ],
    authority: { designTimeOnly: true, productionEnforcement: false, buildApproved: false, releaseApproved: false },
  };
  const comparable = { ...record };
  delete comparable.revision;
  record.evaluationDigest = sha(comparable);
  if (existing?.evaluationDigest === record.evaluationDigest) return existing;
  if (options.persist !== false) {
    atomicPair(paths.evaluationPath, `${JSON.stringify(record, null, 2)}\n`, paths.evaluationMarkdownPath, evaluationMarkdown(record));
  }
  return record;
}

function currentEvaluation(projectRoot, reference) {
  const record = readJson(policyPaths(projectRoot, reference).evaluationPath, 'Policy design evaluation');
  if (record.schema !== 'ewai.policy-design-evaluation/v1') throw new Error('Policy design evaluation has an unsupported schema');
  const comparable = { ...record };
  delete comparable.revision;
  delete comparable.evaluationDigest;
  if (sha(comparable) !== record.evaluationDigest) throw new Error('Policy design evaluation does not match its accepted digest');
  return record;
}

function assertEvaluationCurrent(projectRoot, evaluation) {
  const baseline = readPolicyBaselineStatus(projectRoot);
  if (baseline.status !== 'enabled' || baseline.effectiveDigest !== evaluation.policyDigest) {
    throw new Error('Policy decision references a stale evaluation because the approved policy baseline changed');
  }
  let facts;
  try {
    facts = currentFacts(projectRoot, evaluation.intent.reference);
  } catch (error) {
    throw new Error(`Policy decision references a stale evaluation because confirmed facts are invalid: ${error.message}`);
  }
  if (
    facts.factsDigest !== evaluation.factsDigest
    || facts.intent.revision !== evaluation.intent.revision
    || facts.intent.digest !== evaluation.intent.digest
  ) {
    throw new Error('Policy decision references a stale evaluation because confirmed facts or intent revision changed');
  }
  return true;
}

function safeDecisionFile(root, ruleId, decisionDigest) {
  const name = `${ruleId.replace(/[^a-z0-9.-]+/gi, '-')}-${decisionDigest.slice(7, 23)}.json`;
  const path = resolve(root, name);
  const rel = relative(root, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Unsafe policy decision destination');
  return path;
}

function persistImmutableDecision(root, ruleId, decisionDigest, record) {
  mkdirSync(root, { recursive: true });
  const existing = decisionRecords(root, record.schema).filter((candidate) => (
    candidate.evaluationDigest === record.evaluationDigest && candidate.ruleId === record.ruleId
  ));
  const identical = existing.find((candidate) => candidate.decisionDigest === decisionDigest);
  if (identical) return identical;
  if (existing.length > 0) {
    throw new Error(`Policy rule ${record.ruleId} already has a current decision; create a new evaluation before replacing it`);
  }
  const path = safeDecisionFile(root, ruleId, decisionDigest);
  if (existsSync(path)) return readJson(path, 'Policy decision');
  atomicJson(path, record);
  return record;
}

function matchedRule(evaluation, qualifiedRuleId) {
  const rule = evaluation.matchedRules.find((candidate) => candidate.qualifiedRuleId === qualifiedRuleId);
  if (!rule) throw new Error(`Policy rule is not matched by this evaluation: ${qualifiedRuleId}`);
  return rule;
}

export function recordPolicyReview(projectRoot, input = {}, options = {}) {
  requireHumanAuthority(input);
  const reviewedBy = cleanHuman(input.reviewedBy, 'Named reviewer');
  const reviewerRole = slug.parse(input.reviewerRole);
  const reference = intentReference.parse(input.intentReference);
  const evaluation = currentEvaluation(projectRoot, reference);
  assertEvaluationCurrent(projectRoot, evaluation);
  if (input.evaluationDigest !== evaluation.evaluationDigest) throw new Error('Policy review references a stale evaluation');
  const rule = matchedRule(evaluation, input.ruleId);
  if (rule.outcome !== 'review-required') throw new Error('Policy review applies only to a review-required rule');
  if (reviewerRole !== rule.reviewRole) throw new Error(`Policy review requires the required review role: ${rule.reviewRole}`);
  const decision = z.enum(['allow', 'deny', 'allow-with-controls']).parse(input.decision);
  const rationale = boundedText(2000).parse(input.rationale);
  const evidence = z.array(evidenceReference).min(1).max(40).parse(input.evidence);
  const controls = z.array(boundedText(500)).max(40).default([]).parse(input.controls ?? []);
  if (decision === 'allow-with-controls' && controls.length === 0) throw new Error('An allow-with-controls review requires explicit controls');
  const decisionDigest = sha({ evaluationDigest: evaluation.evaluationDigest, ruleId: rule.qualifiedRuleId, reviewerRole, reviewedBy, decision, rationale, evidence, controls });
  const record = {
    schema: 'ewai.policy-review/v1', decisionDigest,
    evaluationDigest: evaluation.evaluationDigest, intentReference: reference,
    ruleId: rule.qualifiedRuleId, reviewerRole, reviewedBy, decision, rationale, evidence, controls,
    reviewedAt: options.now ?? new Date().toISOString(),
    authority: { namedHumanDecision: true, buildApproved: false, releaseApproved: false },
  };
  const paths = policyPaths(projectRoot, reference);
  if (decisionRecords(paths.exceptionsRoot, 'ewai.policy-exception/v1').some((candidate) => (
    candidate.evaluationDigest === evaluation.evaluationDigest && candidate.ruleId === rule.qualifiedRuleId
  ))) throw new Error(`Policy rule ${rule.qualifiedRuleId} already has a current decision; create a new evaluation before replacing it`);
  return persistImmutableDecision(paths.reviewsRoot, rule.qualifiedRuleId, decisionDigest, record);
}

function scopeBoundedByRule(scope, rule, facts) {
  const factsByDimension = new Map(dimensions.map((dimension) => [dimension, new Set(facts.facts.filter((fact) => fact.dimension === dimension).flatMap(({ values }) => values))]));
  for (const [dimension, values] of Object.entries(scope)) {
    if (!rule.conditions[dimension]) return false;
    if (values.some((value) => !rule.conditions[dimension].includes(value) || !factsByDimension.get(dimension).has(value))) return false;
  }
  return Object.keys(rule.conditions).every((dimension) => scope[dimension]?.length > 0);
}

export function recordPolicyException(projectRoot, input = {}, options = {}) {
  requireHumanAuthority(input);
  const approvedBy = cleanHuman(input.approvedBy, 'Named exception approver');
  const owner = cleanHuman(input.owner, 'Exception owner');
  const reviewerRole = slug.parse(input.reviewerRole);
  const reference = intentReference.parse(input.intentReference);
  const evaluation = currentEvaluation(projectRoot, reference);
  assertEvaluationCurrent(projectRoot, evaluation);
  if (input.evaluationDigest !== evaluation.evaluationDigest) throw new Error('Policy exception references a stale evaluation');
  const rule = matchedRule(evaluation, input.ruleId);
  if (!rule.exceptions.permitted) throw new Error(`Policy rule ${rule.qualifiedRuleId} does not permit exceptions`);
  if (reviewerRole !== rule.exceptions.review_role) throw new Error(`Policy exception requires review role ${rule.exceptions.review_role}`);
  const scope = parseWith(scopeSchema, input.scope, 'Policy exception scope');
  const facts = currentFacts(projectRoot, reference);
  if (!scopeBoundedByRule(scope, rule, facts)) throw new Error('Policy exception scope must be bounded by the matched rule and confirmed facts');
  const rationale = boundedText(2000).parse(input.rationale);
  const compensatingControls = parseWith(z.array(boundedText(500)).min(1).max(40), input.compensatingControls, 'Compensating controls');
  const evidence = parseWith(z.array(evidenceReference).min(1).max(40), input.evidence, 'Policy exception evidence');
  const expiresAt = String(input.expiresAt ?? '');
  const now = options.now ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(expiresAt)) || new Date(expiresAt) <= new Date(now)) throw new Error('Policy exception requires a future expiry');
  const decisionDigest = sha({ evaluationDigest: evaluation.evaluationDigest, ruleId: rule.qualifiedRuleId, reviewerRole, approvedBy, owner, scope, rationale, compensatingControls, evidence, expiresAt });
  const record = {
    schema: 'ewai.policy-exception/v1', decisionDigest,
    evaluationDigest: evaluation.evaluationDigest, intentReference: reference,
    ruleId: rule.qualifiedRuleId, reviewerRole, approvedBy, owner, scope, rationale,
    compensatingControls, evidence, expiresAt, approvedAt: now,
    authority: { namedHumanDecision: true, boundedException: true, buildApproved: false, releaseApproved: false },
  };
  const paths = policyPaths(projectRoot, reference);
  if (decisionRecords(paths.reviewsRoot, 'ewai.policy-review/v1').some((candidate) => (
    candidate.evaluationDigest === evaluation.evaluationDigest && candidate.ruleId === rule.qualifiedRuleId
  ))) throw new Error(`Policy rule ${rule.qualifiedRuleId} already has a current decision; create a new evaluation before replacing it`);
  return persistImmutableDecision(paths.exceptionsRoot, rule.qualifiedRuleId, decisionDigest, record);
}

function decisionRecordDigest(record) {
  if (record.schema === 'ewai.policy-review/v1') {
    return sha({
      evaluationDigest: record.evaluationDigest,
      ruleId: record.ruleId,
      reviewerRole: record.reviewerRole,
      reviewedBy: record.reviewedBy,
      decision: record.decision,
      rationale: record.rationale,
      evidence: record.evidence,
      controls: record.controls,
    });
  }
  if (record.schema === 'ewai.policy-exception/v1') {
    return sha({
      evaluationDigest: record.evaluationDigest,
      ruleId: record.ruleId,
      reviewerRole: record.reviewerRole,
      approvedBy: record.approvedBy,
      owner: record.owner,
      scope: record.scope,
      rationale: record.rationale,
      compensatingControls: record.compensatingControls,
      evidence: record.evidence,
      expiresAt: record.expiresAt,
    });
  }
  return null;
}

function decisionRecords(root, schema) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => {
      try {
        return readJson(resolve(root, entry.name), 'Policy decision');
      } catch {
        return null;
      }
    })
    .filter((record) => (
      record?.schema === schema
      && record.authority?.namedHumanDecision === true
      && decisionRecordDigest(record) === record.decisionDigest
    ));
}

export function readPolicyEvaluationStatus(projectRoot, reference, options = {}) {
  const checked = intentReference.parse(reference);
  const baseline = readPolicyBaselineStatus(projectRoot);
  if (baseline.status !== 'enabled') return { schema: 'ewai.policy-evaluation-status/v1', status: baseline.status, blocking: true, baseline };
  const paths = policyPaths(projectRoot, checked);
  if (!existsSync(paths.evaluationPath)) return { schema: 'ewai.policy-evaluation-status/v1', status: 'not-evaluated', blocking: true };
  let evaluation;
  try {
    evaluation = currentEvaluation(projectRoot, checked);
  } catch (error) {
    return { schema: 'ewai.policy-evaluation-status/v1', status: 'invalid', blocking: true, notice: error.message };
  }
  try {
    assertEvaluationCurrent(projectRoot, evaluation);
  } catch (error) {
    return { schema: 'ewai.policy-evaluation-status/v1', status: 'stale', blocking: true, notice: error.message, evaluationDigest: evaluation.evaluationDigest };
  }
  const reviews = decisionRecords(paths.reviewsRoot, 'ewai.policy-review/v1').filter((record) => record.evaluationDigest === evaluation.evaluationDigest);
  const at = new Date(options.now ?? new Date().toISOString());
  const exceptions = decisionRecords(paths.exceptionsRoot, 'ewai.policy-exception/v1').filter((record) => (
    record.evaluationDigest === evaluation.evaluationDigest && new Date(record.expiresAt) > at
  ));
  const duplicateDecision = [...reviews, ...exceptions].find((record, index, records) => (
    records.findIndex((candidate) => candidate.ruleId === record.ruleId) !== index
  ));
  if (duplicateDecision) {
    return {
      schema: 'ewai.policy-evaluation-status/v1',
      status: 'invalid',
      blocking: true,
      notice: `Multiple current decisions exist for ${duplicateDecision.ruleId}; create a new evaluation and reconcile the evidence.`,
      evaluationDigest: evaluation.evaluationDigest,
    };
  }
  const effective = [];
  const decisionControls = [];
  for (const rule of evaluation.matchedRules) {
    const exception = exceptions.find((record) => record.ruleId === rule.qualifiedRuleId);
    if (exception) {
      effective.push('allow-with-controls');
      decisionControls.push(...exception.compensatingControls.map((description) => ({ ruleId: rule.qualifiedRuleId, description, source: 'exception' })));
      continue;
    }
    if (rule.outcome === 'review-required') {
      const review = reviews.find((record) => record.ruleId === rule.qualifiedRuleId);
      if (review) {
        effective.push(review.decision);
        decisionControls.push(...review.controls.map((description) => ({ ruleId: rule.qualifiedRuleId, description, source: 'review' })));
      } else effective.push('review-required');
      continue;
    }
    effective.push(rule.outcome);
  }
  effective.push(...evaluation.unmatchedPolicies.map(({ outcome }) => outcome));
  const status = governingOutcome(effective);
  return {
    schema: 'ewai.policy-evaluation-status/v1',
    status,
    blocking: ['deny', 'review-required', 'unassessed'].includes(status),
    evaluationDigest: evaluation.evaluationDigest,
    policyDigest: evaluation.policyDigest,
    factsDigest: evaluation.factsDigest,
    reviews,
    exceptions,
    controls: [...evaluation.controls, ...decisionControls],
    authority: { designTimeOnly: true, productionEnforcement: false, releaseApproved: false },
  };
}
