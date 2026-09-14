import { createHash } from 'node:crypto';

const tierRanks = { project: 4, premium: 3, personal: 2, core: 1 };

function cleanText(value) {
  return String(value ?? '').trim();
}

function words(value) {
  return cleanText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4);
}

function personaHaystack(persona) {
  return [persona.id, persona.name, persona.category, persona.description, ...(persona.tags ?? []), ...(persona.capabilities ?? [])]
    .map((value) => cleanText(value).toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function engagementReason(persona, contextLabel, matches) {
  const concerns = matches.slice(0, 2).join(' and ');
  return `${persona.name} is engaged to examine ${cleanText(contextLabel).toLowerCase()} through ${concerns || 'its relevant project lens'}.`;
}

export function selectContextualPersonas(options = {}) {
  const signals = [...new Set((options.signals ?? []).map(cleanText).filter(Boolean))];
  const contextText = JSON.stringify(options.context ?? {}).toLowerCase();
  const catalogue = Array.isArray(options.personaCatalogue) ? options.personaCatalogue : [];
  const limit = Math.max(1, Math.min(8, Number(options.limit ?? 4)));
  const ranked = catalogue.map((persona) => {
    const haystack = personaHaystack(persona);
    const matchedSignals = [];
    let score = 0;
    for (const signal of signals) {
      const normalised = signal.toLowerCase();
      const tokenMatches = words(normalised).filter((word) => haystack.includes(word));
      if (haystack.includes(normalised) || tokenMatches.length) {
        matchedSignals.push(signal);
        score += haystack.includes(normalised) ? 6 : tokenMatches.length * 2;
      }
    }
    for (const tag of [...(persona.tags ?? []), ...(persona.capabilities ?? [])]) {
      if (cleanText(tag).length >= 4 && contextText.includes(cleanText(tag).toLowerCase())) score += 1;
    }
    return { persona, score, matchedSignals };
  }).filter((candidate) => candidate.score > 0)
    .sort((left, right) => (
      right.score - left.score
      || (tierRanks[right.persona.tier] ?? 0) - (tierRanks[left.persona.tier] ?? 0)
      || cleanText(left.persona.name).localeCompare(cleanText(right.persona.name))
      || cleanText(left.persona.id).localeCompare(cleanText(right.persona.id))
    ));

  const selected = [];
  for (const tier of ['project', 'premium']) {
    const candidate = ranked.find((item) => item.persona.tier === tier);
    if (candidate && !selected.includes(candidate)) selected.push(candidate);
  }
  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    if (!selected.includes(candidate)) selected.push(candidate);
  }

  return selected.slice(0, limit).map(({ persona, matchedSignals }) => ({
    id: cleanText(persona.id),
    name: cleanText(persona.name),
    tier: cleanText(persona.tier) || 'core',
    category: cleanText(persona.category),
    description: cleanText(persona.description).slice(0, 240),
    matchedSignals,
    engagementReason: engagementReason(persona, options.contextLabel || 'this context', matchedSignals)
  }));
}

const policyStageSignals = Object.freeze({
  facts: ['policy', 'evidence', 'data', 'privacy', 'security', 'design facts'],
  evaluation: ['policy', 'evidence', 'security', 'destination', 'environment', 'controls'],
  review: ['policy review', 'decision', 'evidence', 'security', 'risk'],
  exception: ['exception', 'scope', 'expiry', 'ownership', 'compensating controls', 'risk'],
});

export function selectPolicyPersonas(context = {}, personaCatalogue = []) {
  const stage = cleanText(context.stage || 'facts').toLowerCase();
  const dimensions = (context.dimensions ?? []).map((dimension) => cleanText(dimension).replaceAll('_', '-')).filter(Boolean);
  const signals = [...new Set([...(policyStageSignals[stage] ?? policyStageSignals.facts), ...dimensions])];
  const activePersonas = selectContextualPersonas({
    contextLabel: `${stage} policy design work`,
    signals,
    context: context.context ?? {},
    personaCatalogue,
    limit: 4,
  });
  const premiumInstalled = personaCatalogue.some((persona) => cleanText(persona.tier) === 'premium');
  return {
    schema: 'ewai.policy-persona-engagement/v1',
    stage,
    activePersonas,
    baseline: {
      standardModelAvailable: true,
      completeWithoutPremium: true,
    },
    premium: {
      installed: premiumInstalled,
      reason: premiumInstalled
        ? 'Installed premium personas may add relevant challenge depth.'
        : 'The premium persona library is not installed; core policy behaviour remains available.',
    },
    authority: {
      advisory: true,
      mayConfirmFacts: false,
      mayApproveReviews: false,
      mayApproveExceptions: false,
    },
  };
}

const evidenceDepthSignals = Object.freeze({
  architecture: ['architecture', 'dependency', 'integration', 'evidence', 'archaeology'],
  data: ['data', 'privacy', 'retention', 'classification', 'evidence'],
  security: ['security', 'trust boundary', 'identity', 'privacy', 'evidence'],
  product: ['product', 'user journey', 'outcomes', 'acceptance', 'evidence'],
  delivery: ['delivery', 'testing', 'release', 'quality', 'evidence'],
  governance: ['governance', 'policy', 'compliance', 'decision', 'evidence'],
  operations: ['operations', 'hosting', 'recovery', 'observability', 'evidence'],
});

export function selectEvidenceDepthPersonas(context = {}, personaCatalogue = []) {
  const dimension = cleanText(context.dimension || 'architecture').toLowerCase();
  const gapConditions = (context.gapConditions ?? []).map(cleanText).filter(Boolean);
  const signals = [...new Set([...(evidenceDepthSignals[dimension] ?? evidenceDepthSignals.architecture), ...gapConditions])];
  const activePersonas = selectContextualPersonas({
    contextLabel: `${dimension} evidence-depth investigation`,
    signals,
    context: context.context ?? {},
    personaCatalogue,
    limit: 4,
  });
  const premiumInstalled = personaCatalogue.some((persona) => cleanText(persona.tier) === 'premium');
  return {
    schema: 'ewai.evidence-depth-persona-engagement/v1',
    dimension,
    activePersonas,
    baseline: {
      standardModelAvailable: true,
      completeWithoutPremium: true,
    },
    premium: {
      installed: premiumInstalled,
      reason: premiumInstalled
        ? 'Installed premium personas may add relevant specialist challenge depth.'
        : 'The premium persona library is not installed; core and project persona capability remains complete.',
    },
    authority: {
      advisory: true,
      mayDeclareOwnerEvidence: false,
      maySelectDepth: false,
      mayApproveGrouping: false,
    },
  };
}

const prototypeStageSignals = Object.freeze({
  plan: [
    'product outcomes', 'user journey', 'acceptance', 'information architecture',
    'decision ownership', 'accessibility', 'prototype plan',
  ],
  design: [
    'rendered viewport', 'visual hierarchy', 'interaction', 'responsive',
    'accessibility', 'usability', 'prototype critique',
  ],
});

function personaAvailability(personaCatalogue) {
  const counts = Object.fromEntries(['core', 'project', 'personal', 'premium'].map((tier) => [
    tier,
    personaCatalogue.filter((persona) => cleanText(persona.tier || 'core') === tier).length,
  ]));
  return {
    standardModel: { available: true },
    core: { available: counts.core > 0, count: counts.core },
    project: { available: counts.project > 0, count: counts.project },
    personal: { available: counts.personal > 0, count: counts.personal },
    premium: { available: counts.premium > 0, count: counts.premium },
  };
}

function prototypeFallback(personaCatalogue, stage, limit) {
  const preferredIds = stage === 'plan'
    ? ['project.product-owner', 'ewai.core.end-user']
    : ['ewai.core.end-user', 'project.product-owner'];
  const ranked = [...personaCatalogue].sort((left, right) => {
    const leftPreferred = preferredIds.indexOf(cleanText(left.id));
    const rightPreferred = preferredIds.indexOf(cleanText(right.id));
    const leftRank = leftPreferred === -1 ? 100 : leftPreferred;
    const rightRank = rightPreferred === -1 ? 100 : rightPreferred;
    return leftRank - rightRank
      || (tierRanks[right.tier] ?? 0) - (tierRanks[left.tier] ?? 0)
      || cleanText(left.name).localeCompare(cleanText(right.name));
  });
  const baseline = ranked.filter((persona) => ['project', 'core'].includes(cleanText(persona.tier || 'core'))).slice(0, limit);
  return baseline.map((persona) => ({
    id: cleanText(persona.id),
    name: cleanText(persona.name),
    tier: cleanText(persona.tier) || 'core',
    category: cleanText(persona.category),
    description: cleanText(persona.description).slice(0, 240),
    matchedSignals: ['baseline prototype review'],
    engagementReason: `${cleanText(persona.name)} is engaged as a baseline ${stage} review perspective because no stronger catalogue match was found.`,
  }));
}

export function selectPrototypeReviewPersonas(context = {}, personaCatalogue = []) {
  const stage = cleanText(context.stage || 'plan').toLowerCase();
  if (!['plan', 'design'].includes(stage)) throw new Error('Prototype persona engagement stage must be plan or design');
  const catalogue = Array.isArray(personaCatalogue)
    ? personaCatalogue.map((persona) => ({ ...persona, tier: cleanText(persona.tier) || 'core' }))
    : [];
  const suppliedSignals = (context.signals ?? []).map(cleanText).filter(Boolean);
  const signals = [...new Set(suppliedSignals.length ? suppliedSignals : (prototypeStageSignals[stage] ?? []))];
  const limit = Math.max(1, Math.min(8, Number(context.limit ?? 6)));
  let activePersonas = selectContextualPersonas({
    contextLabel: stage === 'plan' ? 'prototype plan review' : 'rendered prototype review',
    signals,
    context: context.context ?? {},
    personaCatalogue: catalogue,
    limit,
  });
  if (!activePersonas.length) activePersonas = prototypeFallback(catalogue, stage, limit);
  const availability = personaAvailability(catalogue);
  const fingerprintInput = {
    stage,
    signals: [...signals].sort(),
    activePersonas: activePersonas.map(({ id, tier, matchedSignals }) => ({ id, tier, matchedSignals: [...matchedSignals].sort() })).sort((left, right) => left.id.localeCompare(right.id)),
    availability,
  };
  const premiumNotice = availability.premium.available
    ? 'Installed premium personas are eligible when their specialism matches this stage.'
    : 'Premium personas are not installed; standard model, core, and project persona review remains complete.';
  const personalNotice = availability.personal.available
    ? 'Installed personal personas are eligible when their local perspective matches this stage.'
    : 'Personal personas are not installed and are optional enrichment.';
  return {
    schema: 'ewai.prototype-persona-engagement/v1',
    stage,
    selectionFingerprint: `sha256:${createHash('sha256').update(JSON.stringify(fingerprintInput)).digest('hex')}`,
    activePersonas,
    availability,
    baseline: { completeWithoutOptionalPersonas: true },
    notices: [premiumNotice, personalNotice],
    authority: { advisory: true, maySelectPrototype: false, mayApproveManualQa: false },
  };
}
