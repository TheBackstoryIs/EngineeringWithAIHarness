import { existsSync, readFileSync, rmSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import YAML from 'yaml';
import { atomicJson, atomicText, now } from './delivery-documents.mjs';
import { createIntent, intentRelationshipTypes } from './intents.mjs';
import { loadProjectConfig } from './project.mjs';
import { validatePersonaRef } from './personas.mjs';
import { syncIntentIndex } from './runtime/intents.mjs';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const intentReferencePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const deliveryShapeRecommendations = ['single', 'split', 'decision-required'];

function text(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function list(value) {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  const scalar = text(value);
  return scalar ? [scalar] : [];
}

function requireText(value, label) {
  const normalized = text(value);
  if (!normalized) throw new Error(`Intent map requires ${label}`);
  return normalized;
}

function requireSlug(value, label) {
  const normalized = text(value);
  if (!slugPattern.test(normalized)) throw new Error(`${label} must be lower kebab-case: ${normalized}`);
  return normalized;
}

function normalizePersona(persona) {
  if (typeof persona === 'string') {
    return { ref: validatePersonaRef(persona), role: 'advisor', depth: 3 };
  }
  const ref = validatePersonaRef(persona?.ref);
  const role = requireSlug(persona?.role ?? 'advisor', 'Persona role');
  const depth = Number(persona?.depth ?? 3);
  if (!Number.isInteger(depth) || depth < 1 || depth > 5) {
    throw new Error('Persona depth must be an integer from 1 to 5');
  }
  return { ref, role, depth };
}

function normalizeRelationship(relationship) {
  const type = text(relationship?.type);
  const target = text(relationship?.target);
  if (!intentRelationshipTypes.includes(type)) {
    throw new Error(`Intent relationship type must be one of: ${intentRelationshipTypes.join(', ')}`);
  }
  if (!intentReferencePattern.test(target)) {
    throw new Error(`Intent relationship target must be an exact domain/slug reference: ${target}`);
  }
  const rationale = text(relationship?.rationale);
  const requiredBefore = text(relationship?.required_before);
  const requiredState = text(relationship?.required_state);
  if ((requiredBefore || requiredState) && type !== 'depends-on') {
    throw new Error('required_before and required_state apply only to depends-on relationships');
  }
  if (requiredBefore && !['build', 'delivery'].includes(requiredBefore)) {
    throw new Error('depends-on required_before must be build or delivery');
  }
  if (requiredState && !['plan-complete', 'delivered'].includes(requiredState)) {
    throw new Error('depends-on required_state must be plan-complete or delivered');
  }
  return {
    type,
    target,
    ...(rationale ? { rationale } : {}),
    ...(requiredBefore ? { required_before: requiredBefore } : {}),
    ...(requiredState ? { required_state: requiredState } : {}),
  };
}

function normalizeDeliveryShape(value) {
  if (value == null) return null;
  const recommendation = text(value.recommendation);
  if (!deliveryShapeRecommendations.includes(recommendation)) {
    throw new Error(`Delivery-shape recommendation must be one of: ${deliveryShapeRecommendations.join(', ')}`);
  }
  const reason = text(value.reason);
  if (!reason) throw new Error('Delivery-shape preview requires a reason');
  const suggestedChildren = (value.suggested_children ?? value.suggestedChildren ?? []).map((child) => {
    const slug = text(child?.slug);
    if (slug && !slugPattern.test(slug)) throw new Error(`Suggested child slug must be lower kebab-case: ${slug}`);
    const domain = text(child?.domain);
    if (domain && !slugPattern.test(domain)) throw new Error(`Suggested child domain must be lower kebab-case: ${domain}`);
    const title = text(child?.title);
    const outcome = text(child?.outcome);
    const dependsOn = list(child?.depends_on ?? child?.dependsOn);
    return {
      ...(domain ? { domain } : {}),
      ...(slug ? { slug } : {}),
      ...(title ? { title } : {}),
      outcome,
      ...(dependsOn.length ? { depends_on: dependsOn } : {}),
    };
  });
  const reviewedDecision = text(value.reviewed_decision ?? value.reviewedDecision);
  if (reviewedDecision && !['keep-as-one', 'split', 'refine-split', 'defer'].includes(reviewedDecision)) {
    throw new Error('Delivery-shape reviewed_decision must be keep-as-one, split, refine-split, or defer');
  }
  return {
    recommendation,
    reason,
    suggested_children: suggestedChildren,
    blocking_questions: list(value.blocking_questions ?? value.blockingQuestions),
    reviewed_decision: reviewedDecision || null,
  };
}

function normalizeIntent(input) {
  const slug = requireSlug(input?.slug, 'Intent slug');
  const domain = requireSlug(input?.domain ?? 'general', 'Intent domain');
  const reference = `${domain}/${slug}`;
  const relationships = (input?.relationships ?? []).map(normalizeRelationship);
  if (relationships.some((relationship) => relationship.target === reference)) {
    throw new Error(`Intent cannot relate to itself: ${reference}`);
  }
  return {
    reference,
    slug,
    domain,
    title: requireText(input?.title, `title for ${reference}`),
    problem: requireText(input?.problem, `problem for ${reference}`),
    desiredOutcome: requireText(input?.desiredOutcome, `desired outcome for ${reference}`),
    users: list(input?.users),
    journeys: list(input?.journeys),
    acceptanceCriteria: list(input?.acceptanceCriteria),
    constraints: list(input?.constraints),
    evidence: list(input?.evidence),
    openDecisions: list(input?.openDecisions),
    personas: (input?.personas ?? []).map(normalizePersona),
    relationships,
    deliveryShape: normalizeDeliveryShape(input?.deliveryShape ?? input?.delivery_shape ?? null),
  };
}

export function normalizeIntentMapRequest(raw = {}) {
  if (raw.schema && raw.schema !== 'ewai.intent-map-request/v1') {
    throw new Error(`Unsupported intent map request schema: ${raw.schema}`);
  }
  const intents = (raw.intents ?? []).map(normalizeIntent);
  if (!intents.length) throw new Error('Intent map requires at least one proposed intent');
  const references = intents.map((intent) => intent.reference);
  if (new Set(references).size !== references.length) {
    throw new Error('Intent map contains duplicate domain/slug references');
  }
  return {
    schema: 'ewai.intent-map-request/v1',
    slug: requireSlug(raw.slug, 'Intent map slug'),
    title: requireText(raw.title, 'an intent map title'),
    idea: requireText(raw.idea, 'the originating idea'),
    desiredOutcome: requireText(raw.desiredOutcome, 'the overall desired outcome'),
    users: list(raw.users),
    evidence: list(raw.evidence),
    boundaries: list(raw.boundaries),
    nonGoals: list(raw.nonGoals),
    assumptions: list(raw.assumptions),
    openQuestions: list(raw.openQuestions),
    shapingPersonas: (raw.shapingPersonas ?? []).map(normalizePersona),
    intents,
  };
}

function assertAcyclicDependencies(intents) {
  const local = new Set(intents.map((intent) => intent.reference));
  const edges = new Map(intents.map((intent) => [
    intent.reference,
    intent.relationships
      .filter((relationship) => relationship.type === 'depends-on' && local.has(relationship.target))
      .map((relationship) => relationship.target),
  ]));
  const visiting = new Set();
  const visited = new Set();

  const visit = (reference, trail = []) => {
    if (visiting.has(reference)) {
      throw new Error(`Intent dependency cycle detected: ${[...trail, reference].join(' -> ')}`);
    }
    if (visited.has(reference)) return;
    visiting.add(reference);
    for (const target of edges.get(reference) ?? []) visit(target, [...trail, reference]);
    visiting.delete(reference);
    visited.add(reference);
  };
  for (const reference of edges.keys()) visit(reference);
}

function intentExists(paths, reference) {
  const [domain, slug] = reference.split('/');
  const base = resolve(paths.specsRoot, '2.Purpose/intents', domain, slug);
  return existsSync(`${base}.md`) || existsSync(`${base}.json`);
}

function preflight(paths, request) {
  const mapRoot = resolve(paths.specsRoot, '2.Purpose/explorations/intent-maps');
  const markdownPath = resolve(mapRoot, `${request.slug}.md`);
  const jsonPath = resolve(mapRoot, `${request.slug}.json`);
  if (existsSync(markdownPath) || existsSync(jsonPath)) {
    throw new Error(`Intent map already exists: ${relative(paths.projectRoot, markdownPath)}`);
  }

  const local = new Set(request.intents.map((intent) => intent.reference));
  for (const intent of request.intents) {
    if (intentExists(paths, intent.reference)) {
      throw new Error(`Intent already exists: ${intent.reference}`);
    }
    for (const relationship of intent.relationships) {
      if (!local.has(relationship.target) && !intentExists(paths, relationship.target)) {
        throw new Error(
          `Intent ${intent.reference} relates to missing intent ${relationship.target}`,
        );
      }
    }
  }
  assertAcyclicDependencies(request.intents);
  return { mapRoot, markdownPath, jsonPath };
}

function bullets(values, empty = 'None recorded') {
  return values.length ? values.map((value) => `- ${value}`).join('\n') : `- ${empty}`;
}

function renderIntentMap(record) {
  const intentRows = record.intents.map((intent, index) => (
    `| ${index + 1} | \`${intent.reference}\` | ${intent.title.replaceAll('|', '\\|')} | ${intent.desiredOutcome.replaceAll('|', '\\|')} |`
  )).join('\n');
  const relationshipRows = record.intents.flatMap((intent) => (
    intent.relationships.map((relationship) => (
      `| \`${intent.reference}\` | ${relationship.type} | \`${relationship.target}\` | ${
        (relationship.rationale || '').replaceAll('|', '\\|')
      } |`
    ))
  ));
  const shapingPersonas = record.shapingPersonas.map((persona) => (
    `${persona.ref} (${persona.role}, depth ${persona.depth})`
  ));
  const deliveryRows = record.intents.map((intent) => (
    `| \`${intent.reference}\` | ${intent.deliveryShape?.recommendation ?? 'single'} | ${
      (intent.deliveryShape?.reason ?? 'No split concern recorded.').replaceAll('|', '\\|')
    } |`
  )).join('\n');

  return `---
schema: ewai.intent-map/v1
slug: ${record.slug}
title: ${JSON.stringify(record.title)}
status: confirmed
created_at: ${record.createdAt}
approved_by: ${JSON.stringify(record.approvedBy)}
---

# Intent Map: ${record.title}

## Originating idea

${record.idea}

## Desired outcome

${record.desiredOutcome}

## Users and affected people

${bullets(record.users)}

## Evidence

${bullets(record.evidence)}

## Boundaries

${bullets(record.boundaries)}

## Non-goals

${bullets(record.nonGoals)}

## Assumptions

${bullets(record.assumptions)}

## Open questions

${bullets(record.openQuestions)}

## Shaping personas

${bullets(shapingPersonas, 'No library persona was used')}

## Proposed intents

| Sequence | Intent | Title | Outcome |
|---:|---|---|---|
${intentRows}

## Relationships

| Source | Relationship | Target | Rationale |
|---|---|---|---|
${relationshipRows.length ? relationshipRows.join('\n') : '| — | — | — | No cross-intent relationship was required. |'}

## Delivery shape preview

| Intent | Recommendation | Reason |
|---|---|---|
${deliveryRows}

## Review decision

The user reviewed and approved this intent map before EWAI created the linked draft intents. Each intent remains draft until it is individually refined through \`$ewai-intent\`.
`;
}

export function loadIntentMapRequest(path) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) throw new Error(`Intent map request does not exist: ${absolute}`);
  if (!['.json', '.yaml', '.yml'].includes(extname(absolute).toLowerCase())) {
    throw new Error('Intent map request must be JSON or YAML');
  }
  return YAML.parse(readFileSync(absolute, 'utf8'));
}

export function createIntentMap(projectRoot, rawRequest, options = {}) {
  if (!options.confirmed) {
    throw new Error('Creating an intent map requires explicit user approval');
  }
  const { paths } = loadProjectConfig(projectRoot);
  const request = normalizeIntentMapRequest(rawRequest);
  const destinations = preflight(paths, request);
  const createdAt = options.now ?? now();
  const approvedBy = text(options.approvedBy, 'Project owner');
  const record = {
    ...request,
    schema: 'ewai.intent-map/v1',
    status: 'confirmed',
    createdAt,
    approvedBy,
  };
  const created = [];
  const allowedRelationshipTargets = request.intents.map((intent) => intent.reference);

  try {
    atomicText(destinations.markdownPath, renderIntentMap(record));
    created.push(destinations.markdownPath);
    atomicJson(destinations.jsonPath, record);
    created.push(destinations.jsonPath);

    for (const intent of request.intents) {
      const result = createIntent(paths.projectRoot, {
        slug: intent.slug,
        domain: intent.domain,
        title: intent.title,
        intentMap: request.slug,
        personas: intent.personas,
        relationships: intent.relationships,
        allowedRelationshipTargets,
        deliveryShape: intent.deliveryShape,
        details: {
          problem: intent.problem,
          desiredOutcome: intent.desiredOutcome,
          users: intent.users,
          journeys: intent.journeys,
          acceptanceCriteria: intent.acceptanceCriteria,
          constraints: intent.constraints,
          evidence: intent.evidence,
          openDecisions: intent.openDecisions,
        },
      });
      created.push(result.path, result.path.replace(/\.md$/, '.json'));
    }
    syncIntentIndex(paths.projectRoot);
  } catch (error) {
    for (const path of created.reverse()) rmSync(path, { force: true });
    try {
      syncIntentIndex(paths.projectRoot);
    } catch {
      // Preserve the original failure; the SQLite projection remains rebuildable.
    }
    throw error;
  }

  return {
    schema: 'ewai.intent-map-result/v1',
    slug: request.slug,
    title: request.title,
    mapPath: relative(paths.projectRoot, destinations.markdownPath).replaceAll('\\', '/'),
    jsonPath: relative(paths.projectRoot, destinations.jsonPath).replaceAll('\\', '/'),
    intents: request.intents.map((intent) => ({
      reference: intent.reference,
      title: intent.title,
      status: 'draft',
    })),
    next: 'Refine one draft intent through $ewai-intent before starting delivery.',
  };
}
