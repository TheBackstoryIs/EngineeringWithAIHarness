import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { projectPaths } from '../paths.mjs';
import { selectContextualPersonas } from './persona-engagement.mjs';

export const CONTEXT_ESTIMATE_METHOD = 'utf8-bytes-div-3-v1';

const profile = (id, label, signals, defaultBudgetTokens) => Object.freeze({
  id, label, signals: Object.freeze(signals), defaultBudgetTokens,
  minBudgetTokens: 32, maxBudgetTokens: 200_000,
});

export const contextProfiles = Object.freeze({
  companion: profile('companion', 'Companion guidance', ['current work', 'delivery', 'human route', 'recovery'], 2_000),
  intent: profile('intent', 'Intent evidence', ['outcomes', 'acceptance', 'users', 'constraints'], 4_000),
  plan: profile('plan', 'Delivery plan', ['architecture', 'standards', 'repository', 'testing'], 8_000),
  'build-task': profile('build-task', 'Build task', ['build', 'implementation', 'testing'], 12_000),
  'fresh-context-review': profile('fresh-context-review', 'Fresh-context review', ['review', 'security', 'testing', 'standards'], 12_000),
  'phase-contribution-review': profile('phase-contribution-review', 'Phase contribution review', ['evidence', 'review', 'attribution', 'outcomes'], 6_000),
  'design-system-apply': profile('design-system-apply', 'Design-system application', ['design', 'prototype', 'interaction', 'content', 'states', 'accessibility'], 6_000),
});

const evidenceOrder = Object.freeze({ mandatory: 0, relevant: 1, optional: 2 });

function clean(value) {
  return String(value ?? '').trim();
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function unique(values) {
  return [...new Set((values ?? []).map(clean).filter(Boolean))];
}

function safeRelativePath(value) {
  const path = clean(value).replaceAll('\\', '/');
  if (!path || isAbsolute(path) || path.startsWith('/') || path.split('/').includes('..')) {
    throw new Error(`Context sourcePath must be project-relative: ${value}`);
  }
  return path.replace(/^\.\//, '');
}

export function estimateContextTokens(value) {
  const bytes = Buffer.byteLength(String(value ?? ''), 'utf8');
  return { bytes, estimatedTokens: Math.ceil(bytes / 3), method: CONTEXT_ESTIMATE_METHOD };
}

function normaliseCandidate(candidate, policyDigest) {
  const id = clean(candidate?.id);
  const label = clean(candidate?.label);
  const evidenceClass = clean(candidate?.evidenceClass).toLowerCase();
  const content = String(candidate?.content ?? '');
  if (!id || !/^[a-z0-9]+(?:[a-z0-9._-]*[a-z0-9])?$/i.test(id)) throw new Error(`Invalid context segment id: ${id || '<empty>'}`);
  if (!label) throw new Error(`Context segment ${id} requires a label.`);
  if (!(evidenceClass in evidenceOrder)) throw new Error(`Context segment ${id} has unsupported evidence class: ${evidenceClass}`);
  if (!content) throw new Error(`Context segment ${id} has no content.`);
  const sourcePath = safeRelativePath(candidate.sourcePath);
  const sourceDigest = clean(candidate.sourceDigest) || digest(content);
  const requiredMarkers = unique(candidate.requiredMarkers);
  const fragmentDigest = digest(canonical({ sourceDigest, policyDigest, content }));
  const normalised = {
    id,
    label,
    evidenceClass,
    priority: Number.isFinite(Number(candidate.priority)) ? Number(candidate.priority) : 0,
    sourcePath,
    sourceDigest,
    policyDigest,
    fragmentDigest,
    freshness: clean(candidate.freshness) || 'current',
    selectionReason: clean(candidate.selectionReason) || `${label} is ${evidenceClass} for this profile.`,
    minimumRepresentation: clean(candidate.minimumRepresentation) || (requiredMarkers.length ? `required-marker-count:${requiredMarkers.length}` : 'complete-segment'),
    requiredMarkers,
    content,
  };
  return { ...normalised, ...estimateContextTokens(renderedSegment(normalised)) };
}

function compareSegments(left, right) {
  return evidenceOrder[left.evidenceClass] - evidenceOrder[right.evidenceClass]
    || right.priority - left.priority
    || left.id.localeCompare(right.id);
}

function cacheFragment(cacheRoot, segment) {
  if (!cacheRoot) return { status: 'disabled' };
  const root = resolve(cacheRoot);
  const path = resolve(root, 'fragments', `${segment.fragmentDigest}.txt`);
  mkdirSync(resolve(root, 'fragments'), { recursive: true });
  if (existsSync(path) && readFileSync(path, 'utf8') === segment.content) return { status: 'reused' };
  writeFileSync(path, segment.content, { encoding: 'utf8', mode: 0o600 });
  return { status: 'written' };
}

function previousManifest(options) {
  if (!options.previousPack && !options.previousDigest) return null;
  if (!options.previousPack || clean(options.previousPack.digest) !== clean(options.previousDigest)) {
    throw new Error('The exact predecessor digest does not match the supplied previous pack.');
  }
  return options.previousPack;
}

function segmentDelta(current, previous) {
  if (!previous) return { predecessorDigest: null, addedSegments: current.map(({ id }) => id), changedSegments: [], retainedSegments: [], removedSegments: [] };
  const before = new Map((previous.segments ?? []).map((segment) => [segment.id, segment]));
  const after = new Map(current.map((segment) => [segment.id, segment]));
  return {
    predecessorDigest: previous.digest,
    addedSegments: current.filter(({ id }) => !before.has(id)).map(({ id }) => id),
    changedSegments: current.filter(({ id, fragmentDigest }) => before.has(id) && before.get(id).fragmentDigest !== fragmentDigest).map(({ id }) => id),
    retainedSegments: current.filter(({ id, fragmentDigest }) => before.get(id)?.fragmentDigest === fragmentDigest).map(({ id }) => id),
    removedSegments: [...before.keys()].filter((id) => !after.has(id)),
  };
}

function personaDelta(current, previous) {
  const before = new Set((previous?.activePersonas ?? []).map(({ id }) => id));
  const after = new Set(current.map(({ id }) => id));
  return {
    addedPersonas: [...after].filter((id) => !before.has(id)),
    retainedPersonas: [...after].filter((id) => before.has(id)),
    removedPersonas: [...before].filter((id) => !after.has(id)),
  };
}

export function compareContextPacks(currentPack, predecessorPack = null, predecessorDigest = '') {
  const previous = previousManifest({ previousPack: predecessorPack, previousDigest: predecessorDigest });
  const currentSegments = (currentPack?.segments ?? []).filter(({ disposition }) => ['selected', 'reused'].includes(disposition));
  return {
    ...segmentDelta(currentSegments, previous),
    ...personaDelta(currentPack?.activePersonas ?? [], previous),
  };
}

function renderedSegment(segment) {
  return `## ${segment.label} [${segment.id}]\nSource: ${segment.sourcePath}\nEvidence: ${segment.evidenceClass}\n\n${segment.content}`;
}

function safeSegment(segment) {
  const { content: _content, requiredMarkers: _requiredMarkers, ...safe } = segment;
  return safe;
}

function contextPackDigest(pack) {
  const safe = structuredClone(pack);
  delete safe.digest;
  delete safe.modelContext;
  delete safe.deltaContext;
  safe.segments = (safe.segments ?? []).map((segment) => {
    const { cache: _cache, ...stable } = segment;
    return stable;
  });
  return digest(canonical(safe));
}

export function prepareContextPack(options = {}) {
  const selectedProfile = contextProfiles[clean(options.profile)];
  if (!selectedProfile) throw new Error(`Unsupported context profile: ${clean(options.profile) || '<empty>'}`);
  const predecessor = previousManifest(options);
  const budgetTokens = Number(options.budgetTokens ?? selectedProfile.defaultBudgetTokens);
  if (!Number.isInteger(budgetTokens) || budgetTokens < 1 || budgetTokens > selectedProfile.maxBudgetTokens) {
    throw new Error(`Context budget must be an integer from 1 to ${selectedProfile.maxBudgetTokens}.`);
  }
  const policyDigest = digest(canonical({
    profile: selectedProfile,
    policyVersion: 1,
    mandatory: (options.candidates ?? []).filter((candidate) => candidate.evidenceClass === 'mandatory')
      .map(({ id, requiredMarkers, minimumRepresentation }) => ({ id, requiredMarkers: unique(requiredMarkers), minimumRepresentation: clean(minimumRepresentation) }))
      .sort((left, right) => clean(left.id).localeCompare(clean(right.id))),
  }));
  const seen = new Set();
  const candidates = (options.candidates ?? []).map((candidate) => normaliseCandidate(candidate, policyDigest)).sort(compareSegments);
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) throw new Error(`Duplicate context segment id: ${candidate.id}`);
    seen.add(candidate.id);
  }
  if (!candidates.some(({ evidenceClass }) => evidenceClass === 'mandatory')) {
    throw new Error(`Context profile ${selectedProfile.id} has no mandatory evidence candidates.`);
  }

  const mandatoryCandidates = candidates.filter(({ evidenceClass }) => evidenceClass === 'mandatory');
  const mandatoryDemand = estimateContextTokens(mandatoryCandidates.map(renderedSegment).join('\n\n')).estimatedTokens;
  const overflow = mandatoryDemand > budgetTokens;
  let usedTokens = overflow ? mandatoryDemand : 0;
  const selectedIds = new Set();
  const selectedRendered = [];
  if (!overflow) {
    for (const candidate of mandatoryCandidates) {
      selectedIds.add(candidate.id);
      selectedRendered.push(renderedSegment(candidate));
    }
    usedTokens = estimateContextTokens(selectedRendered.join('\n\n')).estimatedTokens;
    for (const candidate of candidates.filter(({ evidenceClass }) => evidenceClass !== 'mandatory')) {
      const candidateRendered = renderedSegment(candidate);
      const nextTokens = estimateContextTokens([...selectedRendered, candidateRendered].join('\n\n')).estimatedTokens;
      if (nextTokens > budgetTokens) continue;
      selectedIds.add(candidate.id);
      selectedRendered.push(candidateRendered);
      usedTokens = nextTokens;
    }
  }
  const priorSegments = new Map((predecessor?.segments ?? []).map((segment) => [segment.id, segment]));
  const segments = candidates.map((candidate) => {
    let disposition = 'deferred';
    if (overflow) disposition = candidate.evidenceClass === 'mandatory' ? 'overflow' : 'deferred';
    else if (selectedIds.has(candidate.id)) {
      disposition = priorSegments.get(candidate.id)?.fragmentDigest === candidate.fragmentDigest ? 'reused' : 'selected';
    }
    const cache = ['selected', 'reused'].includes(disposition) ? cacheFragment(options.cacheRoot, candidate) : { status: 'not-selected' };
    return { ...candidate, disposition, cache };
  });
  const included = segments.filter(({ disposition }) => ['selected', 'reused'].includes(disposition));
  const activePersonas = selectContextualPersonas({
    personaCatalogue: options.personaCatalogue,
    signals: unique([...selectedProfile.signals, ...clean(options.focus).split(/[^a-z0-9]+/i)]),
    context: { profile: selectedProfile.id, focus: clean(options.focus), selected: included.map(({ id }) => id) },
    contextLabel: selectedProfile.label,
    limit: options.personaLimit ?? 4,
  });
  const required = segments.filter(({ evidenceClass }) => evidenceClass === 'mandatory')
    .flatMap((segment) => segment.requiredMarkers.map((marker) => ({ segmentId: segment.id, marker, present: included.some(({ id, content }) => id === segment.id && content.includes(marker)) })));
  const presentCount = required.filter(({ present }) => present).length;
  const mandatoryRecall = required.length ? presentCount / required.length : 1;
  const fidelity = {
    status: !overflow && mandatoryRecall === 1 ? 'pass' : 'fail',
    mandatoryRecall,
    requiredCount: required.length,
    presentCount,
    missing: required.filter(({ present }) => !present).map(({ segmentId, marker }) => `${segmentId}:${marker}`),
    checks: ['mandatory-evidence', 'standards', 'task-boundaries', 'tests', 'security-privacy', 'contradictions', 'human-authority'],
  };
  const modelContext = overflow ? null : included.map(renderedSegment).join('\n\n');
  const delta = compareContextPacks({ segments: included, activePersonas }, predecessor, predecessor?.digest);
  const deltaIds = new Set([...delta.addedSegments, ...delta.changedSegments]);
  const deltaContext = overflow || !predecessor ? modelContext : included.filter(({ id }) => deltaIds.has(id)).map(renderedSegment).join('\n\n');
  const core = {
    schema: 'ewai.context-pack/v1',
    status: overflow ? 'non-ready' : 'ready',
    reason: overflow ? 'mandatory-overflow' : 'within-budget',
    profile: selectedProfile.id,
    profileLabel: selectedProfile.label,
    focus: clean(options.focus),
    revisions: { repository: clean(options.repositoryRevision) || 'workspace', delivery: clean(options.deliveryRevision) || 'unversioned' },
    policyDigest,
    budget: {
      limitTokens: budgetTokens,
      usedTokens,
      mandatoryTokens: mandatoryDemand,
      overflowTokens: Math.max(0, mandatoryDemand - budgetTokens),
      estimateMethod: CONTEXT_ESTIMATE_METHOD,
    },
    segments: segments.map(safeSegment),
    activePersonas,
    delta,
    fidelity,
    usage: {
      estimatedInputBytes: modelContext === null ? 0 : Buffer.byteLength(modelContext, 'utf8'),
      estimatedInputTokens: modelContext === null ? 0 : estimateContextTokens(modelContext).estimatedTokens,
      estimateMethod: CONTEXT_ESTIMATE_METHOD,
      providerReported: null,
    },
    authority: {
      level: 'none',
      notices: ['Context preparation cannot approve Build or Manual QA.', 'Engineering fidelity evidence is not certification or release authority.'],
    },
    recovery: overflow ? ['narrow-focus', 'increase-budget', 'split-operation'] : [],
  };
  const packDigest = contextPackDigest(core);
  return { ...core, digest: packDigest, modelContext, deltaContext };
}

export function safeContextManifest(pack) {
  const { modelContext: _modelContext, deltaContext: _deltaContext, ...safe } = structuredClone(pack);
  safe.segments = (safe.segments ?? []).map(safeSegment);
  return safe;
}

function contextRuntimeRoot(projectRoot) {
  return resolve(projectPaths(projectRoot).runtimeRoot, 'runtime/context-packs');
}

function findIntentPath(root, slug) {
  if (!existsSync(root)) return '';
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      const found = findIntentPath(path, slug);
      if (found) return found;
    } else if (entry.isFile() && entry.name === `${slug}.md`) return path;
  }
  return '';
}

function sourceCandidate(projectRoot, absolutePath, options = {}) {
  if (!existsSync(absolutePath)) {
    if (options.required) throw new Error(`Required context source is missing: ${options.label}.`);
    return null;
  }
  const content = readFileSync(absolutePath, 'utf8');
  return {
    id: options.id,
    label: options.label,
    evidenceClass: options.evidenceClass ?? 'relevant',
    priority: options.priority ?? 50,
    sourcePath: relative(resolve(projectRoot), absolutePath).replaceAll('\\', '/'),
    content,
    requiredMarkers: options.requiredMarkers ?? [],
    selectionReason: options.selectionReason,
  };
}

function contextAuthorityCandidate() {
  return {
    id: 'authority-boundary',
    label: 'Human authority boundary',
    evidenceClass: 'mandatory',
    priority: 1_000,
    sourcePath: 'Docs/human-approval-and-assurance-guide.md',
    content: 'AUTHORITY_NONE Context preparation cannot approve Build or Manual QA, accept security risk, certify quality, deploy or release.',
    requiredMarkers: ['AUTHORITY_NONE', 'cannot approve Build or Manual QA', 'deploy or release'],
    selectionReason: 'Every profile retains explicit human approval and release boundaries.',
  };
}

function profileCandidates(projectRoot, input) {
  const project = projectPaths(projectRoot);
  const slug = clean(input.slug);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Context preparation requires a lower kebab-case --slug.');
  const buildRoot = resolve(project.buildRoot, slug);
  const authority = contextAuthorityCandidate();
  if (input.profile === 'intent') {
    const intentPath = findIntentPath(resolve(project.specsRoot, '2.Purpose/intents'), slug);
    if (!intentPath) throw new Error(`Intent not found for context preparation: ${slug}.`);
    const content = readFileSync(intentPath, 'utf8');
    const title = content.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? slug;
    return [authority, sourceCandidate(projectRoot, intentPath, {
      id: 'intent-source', label: 'Canonical intent', evidenceClass: 'mandatory', priority: 900,
      required: true, requiredMarkers: [slug, title], selectionReason: 'Intent purpose, outcomes and acceptance are mandatory.',
    })];
  }
  if (input.profile === 'companion') {
    return [authority,
      sourceCandidate(projectRoot, resolve(buildRoot, 'delivery-state.json'), {
        id: 'delivery-state', label: 'Current delivery state', evidenceClass: 'mandatory', priority: 900,
        required: true, requiredMarkers: [slug, 'currentPhase'], selectionReason: 'Companion guidance requires current governed state.',
      }),
      sourceCandidate(projectRoot, resolve(buildRoot, 'tracker.md'), {
        id: 'delivery-tracker', label: 'Delivery tracker', evidenceClass: 'relevant', priority: 70,
        selectionReason: 'The tracker explains recent phase progress.',
      }),
      sourceCandidate(projectRoot, resolve(buildRoot, 'context-packet.md'), {
        id: 'context-packet', label: 'Delivery context packet', evidenceClass: 'optional', priority: 20,
        selectionReason: 'The complete packet is included only when the profile budget permits.',
      })].filter(Boolean);
  }
  if (input.profile === 'plan') {
    return [authority,
      sourceCandidate(projectRoot, resolve(buildRoot, 'build-plan.md'), {
        id: 'build-plan', label: 'Governed Build Plan', evidenceClass: 'mandatory', priority: 900,
        required: true, requiredMarkers: [slug, 'Security', 'Tests'], selectionReason: 'Plan slices, interfaces and safety decisions are mandatory.',
      }),
      sourceCandidate(projectRoot, resolve(buildRoot, 'gates/plan/claim-ledger.json'), {
        id: 'claim-ledger', label: 'Claim Ledger', evidenceClass: 'mandatory', priority: 850,
        required: true, requiredMarkers: ['implementation_claims', 'tests_required'], selectionReason: 'Implementation claims and test obligations are mandatory.',
      }),
      sourceCandidate(projectRoot, resolve(buildRoot, 'task-graph.json'), {
        id: 'task-graph', label: 'Task graph', evidenceClass: 'relevant', priority: 70,
        selectionReason: 'Task topology is relevant when implementation decomposition is in focus.',
      })].filter(Boolean);
  }
  if (['build-task', 'fresh-context-review'].includes(input.profile)) {
    const graphPath = resolve(buildRoot, 'task-graph.json');
    if (!existsSync(graphPath)) throw new Error(`Task graph not found for context preparation: ${slug}.`);
    const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
    const taskId = clean(input.taskId);
    const task = (graph.tasks ?? []).find(({ id }) => id === taskId);
    if (!task) throw new Error(`Context preparation requires a valid --task for ${input.profile}.`);
    const taskContent = JSON.stringify(task);
    const markers = [task.id, task.slice, ...(task.claims ?? []), ...(task.write_set ?? []), ...(task.allowed_commands ?? []), ...(task.stop_conditions ?? []), task.first_failing_test].filter(Boolean);
    const reviewRules = input.profile === 'fresh-context-review'
      ? 'TESTS_FIRST Review the diff, standards, tests, write_set, stop conditions and security. End with VERDICT: PASS or VERDICT: FAIL.'
      : 'AUTHORITY_NONE Work only inside write_set, run allowed_commands and stop on every stop_condition.';
    return [authority,
      {
        id: 'task-contract', label: 'Exact task contract', evidenceClass: 'mandatory', priority: 950,
        sourcePath: relative(resolve(projectRoot), graphPath).replaceAll('\\', '/'), content: taskContent,
        requiredMarkers: markers, selectionReason: 'The exact task boundary is mandatory.',
      },
      {
        id: 'host-rules', label: input.profile === 'fresh-context-review' ? 'Fresh review rules' : 'Build worker rules',
        evidenceClass: 'mandatory', priority: 900, sourcePath: 'SPECS/4.Constraints/standards/lifecycle-hook-safety.md',
        content: reviewRules,
        requiredMarkers: input.profile === 'fresh-context-review' ? ['TESTS_FIRST', 'VERDICT: PASS or VERDICT: FAIL'] : ['AUTHORITY_NONE', 'write_set', 'allowed_commands', 'stop_condition'],
        selectionReason: 'Host behaviour and authority are mandatory.',
      }];
  }
  if (input.profile === 'phase-contribution-review') {
    return [authority,
      sourceCandidate(projectRoot, resolve(buildRoot, 'delivery-state.json'), {
        id: 'delivery-state', label: 'Current delivery state', evidenceClass: 'mandatory', priority: 900,
        required: true, requiredMarkers: [slug, 'currentPhase'], selectionReason: 'Contribution review requires the current phase and integrity state.',
      }),
      sourceCandidate(projectRoot, resolve(buildRoot, 'test-plan.md'), {
        id: 'test-plan', label: 'Current Test Plan', evidenceClass: 'relevant', priority: 70,
        selectionReason: 'Accepted test challenges are relevant to evidence review.',
      })].filter(Boolean);
  }
  throw new Error(`Unsupported context profile: ${input.profile}.`);
}

export function readStoredContextManifest(projectRoot, digestValue) {
  const value = clean(digestValue);
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Context pack digest must be a 64-character lowercase SHA-256 value.');
  const path = resolve(contextRuntimeRoot(projectRoot), 'manifests', `${value}.json`);
  if (!existsSync(path)) throw new Error(`Context pack manifest not found: ${value}.`);
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (manifest.schema !== 'ewai.context-pack/v1' || manifest.digest !== value || contextPackDigest(manifest) !== value) {
    throw new Error(`Stored context pack manifest is invalid: ${value}.`);
  }
  return manifest;
}

export function prepareProjectContext(projectRoot, input = {}) {
  const root = resolve(projectRoot);
  const focus = clean(input.focus);
  if (focus.length > 2_000) throw new Error('Context focus must be 2,000 characters or fewer.');
  const previousPack = input.previousDigest ? readStoredContextManifest(root, input.previousDigest) : null;
  const candidates = profileCandidates(root, input);
  const sourceRevision = digest(canonical(candidates.map(({ id, content }) => ({ id, content }))));
  const pack = prepareContextPack({
    profile: input.profile,
    focus,
    budgetTokens: input.budgetTokens,
    repositoryRevision: input.repositoryRevision ?? sourceRevision,
    deliveryRevision: input.deliveryRevision ?? sourceRevision,
    candidates,
    personaCatalogue: input.personaCatalogue,
    previousPack,
    previousDigest: input.previousDigest,
    cacheRoot: resolve(contextRuntimeRoot(root), 'cache'),
  });
  const manifestRoot = resolve(contextRuntimeRoot(root), 'manifests');
  mkdirSync(manifestRoot, { recursive: true });
  writeFileSync(resolve(manifestRoot, `${pack.digest}.json`), `${JSON.stringify(safeContextManifest(pack), null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return pack;
}
