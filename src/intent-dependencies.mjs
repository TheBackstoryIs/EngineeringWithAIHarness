import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectPaths } from './paths.mjs';

const enforcementPoints = new Set(['build', 'delivery']);
const requiredStates = new Set(['plan-complete', 'delivered']);

function dependencyRelationships(intent) {
  return (intent.relationships ?? []).filter((relationship) => relationship.type === 'depends-on');
}

function requirement(relationship) {
  return {
    requiredBefore: relationship.required_before ?? 'delivery',
    requiredState: relationship.required_state ?? 'delivered',
  };
}

function targetSatisfies(projectRoot, target, requiredState) {
  if (requiredState === 'delivered') {
    return ['completed', 'delivered'].includes(String(target.deliveryStatus ?? target.status).toLowerCase());
  }
  const path = resolve(projectPaths(projectRoot).buildRoot, target.slug, 'delivery-state.json');
  if (!existsSync(path)) return false;
  try {
    const state = JSON.parse(readFileSync(path, 'utf8'));
    return state.schema === 'ewai.delivery-state/v1'
      && state.slug === target.slug
      && state.phases?.find((phase) => phase.id === 'plan')?.status === 'completed';
  } catch {
    return false;
  }
}

export function validateIntentDependencyGraph(intents) {
  const catalog = new Map(intents.map((intent) => [intent.id, intent]));
  const errors = [];
  const edges = new Map(intents.map((intent) => [intent.id, []]));
  const slugOwners = new Map();
  for (const intent of intents) {
    const owners = slugOwners.get(intent.slug) ?? [];
    owners.push(intent.id);
    slugOwners.set(intent.slug, owners);
  }
  for (const [slug, owners] of slugOwners) {
    if (owners.length < 2) continue;
    for (const owner of owners) {
      errors.push({
        code: 'intent-slug-collision',
        source: owner,
        target: owners.find((candidate) => candidate !== owner),
        message: `Intent slug ${slug} is shared by ${owners.join(', ')} but delivery folders are slug-keyed.`,
      });
    }
  }
  for (const intent of intents) {
    for (const relationship of dependencyRelationships(intent)) {
      const { requiredBefore, requiredState } = requirement(relationship);
      if (!catalog.has(relationship.target)) {
        errors.push({ code: 'intent-dependency-missing', source: intent.id, target: relationship.target, message: `${intent.id} depends on missing intent ${relationship.target}.` });
      } else {
        edges.get(intent.id).push(relationship.target);
        const target = catalog.get(relationship.target);
        if ((slugOwners.get(target.slug) ?? []).length > 1) {
          errors.push({
            code: 'intent-dependency-target-collision',
            source: intent.id,
            target: relationship.target,
            message: `${intent.id} depends on ${relationship.target}, whose slug-keyed delivery namespace collides.`,
          });
        }
      }
      if (!enforcementPoints.has(requiredBefore)) {
        errors.push({ code: 'intent-dependency-enforcement', source: intent.id, target: relationship.target, message: `${intent.id} has unsupported required_before ${requiredBefore}.` });
      }
      if (!requiredStates.has(requiredState)) {
        errors.push({ code: 'intent-dependency-state', source: intent.id, target: relationship.target, message: `${intent.id} has unsupported required_state ${requiredState}.` });
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (id, trail = []) => {
    if (visiting.has(id)) {
      const cycle = [...trail, id];
      errors.push({ code: 'intent-dependency-cycle', source: id, target: id, cycle, message: `Intent dependency cycle detected: ${cycle.join(' -> ')}.` });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const target of edges.get(id) ?? []) visit(target, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of edges.keys()) visit(id);
  return { schema: 'ewai.intent-dependency-audit/v1', status: errors.length ? 'fail' : 'pass', checked: intents.length, errors };
}

export function dependencyRequirementBlockers(projectRoot, intent, catalog, enforcementPoint) {
  const blockers = [];
  for (const relationship of dependencyRelationships(intent)) {
    const target = catalog.get(relationship.target);
    const { requiredBefore, requiredState } = requirement(relationship);
    if (requiredBefore !== enforcementPoint) continue;
    if (!target) {
      blockers.push({ code: 'intent-dependency-missing', message: `Dependency ${relationship.target} does not exist.`, evidence: relationship.target });
    } else if (!targetSatisfies(projectRoot, target, requiredState)) {
      blockers.push({
        code: 'intent-dependency-incomplete',
        message: `Dependency ${relationship.target} must reach ${requiredState} before ${enforcementPoint}.`,
        evidence: relationship.target,
      });
    }
  }
  return blockers;
}
