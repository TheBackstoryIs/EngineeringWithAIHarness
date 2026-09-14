import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { atomicJson } from '../delivery-documents.mjs';
import { projectPaths } from '../paths.mjs';
import {
  comparePrototypeReviews,
  preparePrototypeCycleReview,
  preparePrototypePlanReview,
  prototypeFindingId,
  readPrototypeReviewStatus,
  recordPrototypeCycleReview,
  recordPrototypePlanReview,
} from '../prototype-iterations.mjs';
import { runtimePaths } from './paths.mjs';
import { selectPrototypeReviewPersonas } from './persona-engagement.mjs';

const WORKSPACE_SCHEMA = 'ewai.prototype-iteration-workspace/v1';
const slugPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/;

function fail(message, statusCode = 409) {
  const error = new Error(`Prototype iteration workspace: ${message}`);
  error.statusCode = statusCode;
  throw error;
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`, 400);
  return value;
}

function knownFields(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label} has unknown field ${key}`, 400);
}

function safeSlug(value) {
  const slug = String(value ?? '').trim();
  if (!slugPattern.test(slug)) fail('delivery slug must be a bounded lowercase identifier', 400);
  return slug;
}

function readJson(path, label) {
  if (!existsSync(path)) fail(`${label} has not been prepared`);
  if (lstatSync(path).isSymbolicLink()) fail(`${label} may not be a symbolic link`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function resolveAssessmentReferences(submission) {
  const request = structuredClone(object(submission, 'review submission'));
  if (!Array.isArray(request.assessments)) return request;
  request.assessments = request.assessments.map((assessment, index) => {
    const item = object(assessment, `assessment ${index + 1}`);
    const allowed = ['findingId', 'findingRef', 'disposition', 'rationale', 'modification', 'owner'];
    knownFields(item, allowed, `assessment ${index + 1}`);
    const findingId = item.findingId || (item.findingRef ? prototypeFindingId(item.findingRef) : '');
    if (!findingId) fail(`assessment ${index + 1} requires findingId or findingRef`, 400);
    const { findingRef: _findingRef, ...rest } = item;
    return { ...rest, findingId };
  });
  return request;
}

function preparationFiles(projectRoot, slug) {
  const folder = runtimePaths(projectRoot).prototypeIterationRoot(slug);
  if (!existsSync(folder)) return [];
  if (lstatSync(folder).isSymbolicLink()) fail('prototype preparation folder may not be a symbolic link');
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^cycle-[1-3]-preparation\.json$/.test(entry.name))
    .map((entry) => readJson(resolve(folder, entry.name), entry.name));
}

function validatePrototypeEntry(projectRoot, slug, entryPath) {
  const project = projectPaths(projectRoot);
  const deliveryRoot = resolve(project.buildRoot, slug);
  const prototypeRoot = resolve(deliveryRoot, 'ui-design-assets/prototypes');
  const candidate = resolve(deliveryRoot, String(entryPath ?? ''));
  const rel = relative(prototypeRoot, candidate);
  if (!entryPath || isAbsolute(String(entryPath)) || !rel || rel.startsWith('..') || isAbsolute(rel)) {
    fail('prototype entry path must identify a file inside ui-design-assets/prototypes', 400);
  }
  if (!existsSync(candidate) || !lstatSync(candidate).isFile()) fail(`prototype entry path does not exist: ${entryPath}`, 400);
  if (lstatSync(candidate).isSymbolicLink()) fail('prototype entry path may not be a symbolic link', 400);
}

function catalogue(options) {
  return Array.isArray(options.personas) ? options.personas : Array.isArray(options.personaCatalogue) ? options.personaCatalogue : [];
}

export function preparePrototypePlanWorkspace(projectRoot, deliverySlug, input = {}, options = {}) {
  const slug = safeSlug(deliverySlug);
  const request = object(input, 'plan prepare request');
  knownFields(request, ['intentDigest', 'designSystem', 'plan', 'signals', 'predecessorDigest'], 'plan prepare request');
  const engagement = selectPrototypeReviewPersonas({
    stage: 'plan',
    signals: request.signals ?? [],
    context: { deliverySlug: slug, plan: request.plan },
  }, catalogue(options));
  const preparation = preparePrototypePlanReview({
    schema: 'ewai.prototype-plan-input/v1',
    deliverySlug: slug,
    intentDigest: request.intentDigest,
    designSystem: request.designSystem,
    plan: request.plan,
    engagement,
    predecessorDigest: request.predecessorDigest ?? '',
  }, { now: options.now });
  atomicJson(runtimePaths(projectRoot).prototypePlanPreparationPath(slug), preparation);
  return {
    schema: WORKSPACE_SCHEMA,
    status: 'plan-review-prepared',
    deliverySlug: slug,
    preparation,
    activePersonas: preparation.engagement.activePersonas,
    personaAvailability: preparation.engagement.availability,
    nextAction: 'record-plan-review',
    authority: preparation.authority,
  };
}

export function recordPrototypePlanWorkspaceReview(projectRoot, deliverySlug, input, options = {}) {
  const slug = safeSlug(deliverySlug);
  const preparation = readJson(runtimePaths(projectRoot).prototypePlanPreparationPath(slug), 'prototype plan review');
  if (preparation.deliverySlug !== slug) fail('prepared plan belongs to a different delivery');
  return recordPrototypePlanReview(projectRoot, preparation, resolveAssessmentReferences(input), options);
}

export function preparePrototypeCycleWorkspace(projectRoot, deliverySlug, input = {}, options = {}) {
  const slug = safeSlug(deliverySlug);
  const request = object(input, 'cycle prepare request');
  knownFields(request, [
    'planReviewDigest', 'cycleNumber', 'maxCycles', 'predecessorDigest', 'prototype',
    'evidenceChannels', 'signals',
  ], 'cycle prepare request');
  const status = readPrototypeReviewStatus(projectRoot, slug);
  const plan = status.planReviews.find(({ contentDigest }) => contentDigest === request.planReviewDigest);
  if (!plan) fail('cycle preparation requires a recorded plan review digest');
  const cycleNumber = Number(request.cycleNumber);
  const predecessorDigest = String(request.predecessorDigest ?? '');
  if (cycleNumber > 1) {
    const predecessor = status.cycleReviews.find(({ contentDigest }) => contentDigest === predecessorDigest);
    if (!predecessor) fail('cycle predecessor digest must identify a recorded earlier cycle');
    if (predecessor.cycleNumber !== cycleNumber - 1) fail('cycle predecessor must be the immediately previous cycle');
    if (status.currentCycleReview?.contentDigest !== predecessorDigest) fail('cycle predecessor must be the current cycle review');
  } else if (status.cycleReviews.length) {
    fail('cycle one cannot be prepared after recorded design cycles already exist');
  }
  validatePrototypeEntry(projectRoot, slug, request.prototype?.entryPath);
  const engagement = selectPrototypeReviewPersonas({
    stage: 'design',
    signals: request.signals ?? [],
    context: {
      deliverySlug: slug,
      prototype: request.prototype,
      evidenceChannels: request.evidenceChannels,
      planReviewDigest: request.planReviewDigest,
    },
  }, catalogue(options));
  const preparation = preparePrototypeCycleReview({
    schema: 'ewai.prototype-cycle-input/v1',
    deliverySlug: slug,
    planReviewDigest: request.planReviewDigest,
    cycleNumber,
    maxCycles: request.maxCycles ?? 2,
    predecessorDigest,
    prototype: request.prototype,
    evidenceChannels: request.evidenceChannels,
    engagement,
  }, { now: options.now });
  atomicJson(runtimePaths(projectRoot).prototypeCyclePreparationPath(slug, preparation.cycleNumber), preparation);
  return {
    schema: WORKSPACE_SCHEMA,
    status: 'design-review-prepared',
    deliverySlug: slug,
    preparation,
    activePersonas: preparation.engagement.activePersonas,
    personaAvailability: preparation.engagement.availability,
    nextAction: 'record-design-review',
    authority: preparation.authority,
  };
}

export function recordPrototypeCycleWorkspaceReview(projectRoot, deliverySlug, input, options = {}) {
  const slug = safeSlug(deliverySlug);
  const expected = String(input?.expectedPreparationDigest ?? '');
  const preparation = preparationFiles(projectRoot, slug).find(({ preparationDigest }) => preparationDigest === expected);
  if (!preparation) fail('no prepared design cycle matches the expected preparation digest');
  if (preparation.deliverySlug !== slug) fail('prepared design cycle belongs to a different delivery');
  return recordPrototypeCycleReview(projectRoot, preparation, resolveAssessmentReferences(input), options);
}

export function readPrototypeIterationWorkspace(projectRoot, deliverySlug, options = {}) {
  const slug = safeSlug(deliverySlug);
  const status = readPrototypeReviewStatus(projectRoot, slug);
  const planPath = runtimePaths(projectRoot).prototypePlanPreparationPath(slug);
  const planPreparation = existsSync(planPath) ? readJson(planPath, 'prototype plan review') : null;
  const cyclePreparations = preparationFiles(projectRoot, slug).sort((left, right) => left.cycleNumber - right.cycleNumber);
  const currentEngagement = status.currentCycleReview?.engagement
    ?? cyclePreparations.at(-1)?.engagement
    ?? status.currentPlanReview?.engagement
    ?? planPreparation?.engagement
    ?? null;
  const availability = currentEngagement?.availability
    ?? selectPrototypeReviewPersonas({ stage: 'plan' }, catalogue(options)).availability;
  return {
    schema: WORKSPACE_SCHEMA,
    status: status.currentCycleReview?.nextAction
      ?? status.currentPlanReview?.nextAction
      ?? (planPreparation ? 'plan-review-prepared' : 'not-prepared'),
    deliverySlug: slug,
    planPreparation,
    cyclePreparations,
    planReviews: status.planReviews,
    cycleReviews: status.cycleReviews,
    currentPlanReview: status.currentPlanReview,
    currentCycleReview: status.currentCycleReview,
    activePersonas: currentEngagement?.activePersonas ?? [],
    personaAvailability: availability,
    authority: status.authority,
  };
}

export function comparePrototypeWorkspaceReviews(projectRoot, deliverySlug, input = {}) {
  const slug = safeSlug(deliverySlug);
  const request = object(input, 'comparison request');
  knownFields(request, ['leftDigest', 'rightDigest'], 'comparison request');
  const status = readPrototypeReviewStatus(projectRoot, slug);
  const reviews = [...status.planReviews, ...status.cycleReviews];
  const left = reviews.find(({ contentDigest }) => contentDigest === request.leftDigest);
  const right = reviews.find(({ contentDigest }) => contentDigest === request.rightDigest);
  if (!left || !right) fail('comparison digests must identify recorded prototype reviews', 404);
  return comparePrototypeReviews(left, right);
}
