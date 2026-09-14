import { ASSURANCE_NOTICE } from './security-validation-config.mjs';
import { listWorkItems } from './runtime/work.mjs';
import { selectContextualPersonas } from './runtime/persona-engagement.mjs';
import { designSystemStatus } from './design-systems.mjs';

const RECOMMENDATION_LIMIT = 8;
const PERSONA_LIMIT = 4;
const FOCUS_LIMIT = 500;
const BLOCKER_LIMIT = 3;
const MESSAGE_LIMIT = 240;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const CONTINUE_ACTIONS = ['continueHarness', 'enterBuild', 'acquireTask', 'completeCurrentPhase'];

export const COMPANION_ADVISORY_NOTICE = 'Companion and persona guidance is advisory. It cannot create delivery permission, user evidence, specialist assurance or human acceptance.';
export const COMPANION_ASSURANCE_NOTICE = ASSURANCE_NOTICE;

function clean(value, limit = MESSAGE_LIMIT) {
  return String(value ?? '').trim().slice(0, limit);
}

function normaliseFocus(value) {
  const focus = String(value ?? '').trim();
  if (focus.length > FOCUS_LIMIT) throw new Error(`Companion focus must be ${FOCUS_LIMIT} characters or fewer.`);
  if (CONTROL_CHARACTERS.test(focus)) throw new Error('Companion focus contains an unsafe control character.');
  return focus;
}

function actionPermitted(item, name) {
  return item?.execution?.actions?.[name]?.permitted === true;
}

function classify(item) {
  if (item?.lane === 'qa' || actionPermitted(item, 'approveBuild')) return 'human-decision';
  if (CONTINUE_ACTIONS.some((name) => actionPermitted(item, name))) return 'continue';
  if (actionPermitted(item, 'beginHarness')) return 'start';
  return 'blocked';
}

function accountableRoute(item, recommendationClass) {
  const searchable = `${item?.title ?? ''} ${item?.currentPhase ?? ''}`.toLowerCase();
  if (item?.lane === 'qa') return 'Named Manual QA reviewer';
  if (actionPermitted(item, 'approveBuild')) return 'Accountable project owner';
  if (searchable.includes('security')) return 'Qualified security reviewer and risk owner';
  if (recommendationClass === 'blocked') return 'Delivery owner for the first blocker';
  return 'Existing governed delivery harness';
}

function recommendationReason(item, recommendationClass) {
  if (item?.lane === 'qa') return 'The governed delivery has reached Manual QA and now needs accountable human judgement.';
  if (actionPermitted(item, 'approveBuild')) return 'The plan is ready for an accountable human to decide whether Build may begin.';
  if (recommendationClass === 'continue') return 'The governed execution actions show that this work can continue through its existing delivery harness.';
  if (recommendationClass === 'start') return 'The governed execution actions show that this work can enter its delivery harness.';
  return 'No governed start or continue action is currently permitted; review the bounded blockers before proceeding.';
}

function boundedBlockers(item) {
  const candidates = [
    ...(Array.isArray(item?.execution?.blockers) ? item.execution.blockers : []),
    ...Object.values(item?.execution?.actions ?? {}).flatMap((action) => Array.isArray(action?.blockers) ? action.blockers : []),
  ];
  const result = [];
  const seen = new Set();
  for (const blocker of candidates) {
    const safe = {
      code: clean(blocker?.code || 'blocked', 80),
      message: clean(blocker?.message || blocker?.reason || 'A governed prerequisite remains incomplete.'),
    };
    const key = `${safe.code}:${safe.message}`;
    if (!safe.message || seen.has(key)) continue;
    seen.add(key);
    result.push(safe);
    if (result.length >= BLOCKER_LIMIT) break;
  }
  return result;
}

function evidenceClasses(item, recommendationClass) {
  const values = new Set(['governed-execution-state']);
  if (item?.currentPhase) values.add('phase-progress');
  if (item?.execution?.lifecycle?.status) values.add('delivery-lifecycle');
  if (recommendationClass === 'human-decision') values.add('human-decision-record');
  if (recommendationClass === 'blocked') values.add('bounded-blocker-evidence');
  return [...values];
}

function handoff(item, recommendationClass) {
  if (recommendationClass === 'start' && actionPermitted(item, 'beginHarness')) {
    return { kind: 'begin', label: 'Begin governed delivery' };
  }
  if (recommendationClass === 'continue' && actionPermitted(item, 'continueHarness')) {
    return { kind: 'continue', label: 'Continue governed delivery' };
  }
  return null;
}

function safeRecommendation(item) {
  const recommendationClass = classify(item);
  return {
    id: clean(item?.id || item?.intentId || item?.slug, 180),
    slug: clean(item?.slug, 120),
    domain: clean(item?.domain, 80),
    title: clean(item?.title || item?.slug || 'Untitled work item', 180),
    class: recommendationClass,
    state: clean(item?.state, 80),
    phase: clean(item?.currentPhase || item?.execution?.lifecycle?.currentPhase, 80),
    progress: Number.isFinite(Number(item?.completionPercent)) ? Math.max(0, Math.min(100, Number(item.completionPercent))) : 0,
    reason: recommendationReason(item, recommendationClass),
    accountableRoute: accountableRoute(item, recommendationClass),
    evidenceClasses: evidenceClasses(item, recommendationClass),
    blockers: boundedBlockers(item),
    handoff: handoff(item, recommendationClass),
    priority: Number.isFinite(Number(item?.priority)) ? Number(item.priority) : 999,
  };
}

function focusScore(recommendation, focus) {
  if (!focus) return 0;
  const value = focus.toLowerCase();
  const exact = [recommendation.id, recommendation.slug, recommendation.title].map((candidate) => candidate.toLowerCase());
  if (exact.includes(value)) return 10_000;
  const haystack = `${recommendation.id} ${recommendation.title} ${recommendation.domain} ${recommendation.phase}`.toLowerCase();
  if (haystack.includes(value)) return 5_000;
  const tokens = value.split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
  return tokens.filter((token) => haystack.includes(token)).length * 100;
}

function classScore(value) {
  return { 'human-decision': 400, continue: 300, start: 200, blocked: 100 }[value] ?? 0;
}

function rankedRecommendations(items, focus) {
  return items.map(safeRecommendation)
    .sort((left, right) => (
      focusScore(right, focus) - focusScore(left, focus)
      || classScore(right.class) - classScore(left.class)
      || left.priority - right.priority
      || left.title.localeCompare(right.title)
      || left.id.localeCompare(right.id)
    ))
    .slice(0, RECOMMENDATION_LIMIT)
    .map(({ priority: _priority, ...recommendation }) => recommendation);
}

function personaAvailability(personas) {
  const count = (tier) => personas.filter((persona) => persona?.tier === tier).length;
  const premiumCount = count('premium');
  return {
    project: { installed: count('project') > 0, count: count('project') },
    core: { installed: count('core') > 0, count: count('core') },
    personal: { installed: count('personal') > 0, count: count('personal') },
    premium: {
      installed: premiumCount > 0,
      count: premiumCount,
      reason: premiumCount > 0
        ? 'Installed premium personas are available for optional enrichment.'
        : 'No installed premium personas are available; the standard project and core baseline remains complete.',
    },
  };
}

function personaSignals(spotlight, focus) {
  if (!spotlight) return focus ? [focus] : [];
  return [
    focus,
    spotlight.title,
    spotlight.domain,
    spotlight.class,
    spotlight.phase,
    spotlight.reason,
    spotlight.accountableRoute,
    ...spotlight.evidenceClasses,
    ...spotlight.blockers.flatMap(({ code, message }) => [code, message]),
  ].filter(Boolean);
}

function reviewQuestions(spotlight, focus) {
  if (!spotlight) {
    return focus
      ? [`What project evidence would establish whether “${clean(focus, 120)}” belongs in the governed delivery queue?`]
      : ['What outcome should be brought into the governed delivery queue next?'];
  }
  const questions = [];
  const securityContext = `${spotlight.title} ${spotlight.phase} ${focus}`.toLowerCase().includes('security');
  if (securityContext) {
    questions.push('Who is the qualified human responsible for reviewing the security scope, findings, limitations and residual risk?');
  }
  if (spotlight.class === 'human-decision') {
    questions.push(`Who holds the decision for ${spotlight.title}, and what evidence and limitations must they consider?`);
    questions.push('What would make the accountable reviewer withhold approval or acceptance?');
  } else if (spotlight.class === 'blocked') {
    questions.push(`What evidence would allow the delivery owner to resolve the first blocker for ${spotlight.title}?`);
    questions.push('Does recovery require a human decision, an external dependency, or a correction to the governed state?');
  } else {
    questions.push(`Does continuing ${spotlight.title} still serve the intended user outcome and current constraints?`);
    questions.push('What evidence should be preserved at the next governed checkpoint?');
  }
  return [...new Set(questions)].slice(0, 3);
}

export function readCompanionGuidance(projectRoot, options = {}) {
  const focus = normaliseFocus(options.focus);
  const items = Array.isArray(options.items) ? options.items : listWorkItems(projectRoot);
  const personas = Array.isArray(options.personas) ? options.personas : [];
  const recommendations = rankedRecommendations(items, focus);
  const spotlight = recommendations[0] ?? null;
  const activePersonas = selectContextualPersonas({
    personaCatalogue: personas,
    signals: personaSignals(spotlight, focus),
    context: { focus, spotlight },
    contextLabel: spotlight?.title || focus || 'project delivery',
    limit: PERSONA_LIMIT,
  });
  const summary = { total: recommendations.length, humanDecision: 0, continue: 0, start: 0, blocked: 0 };
  for (const recommendation of recommendations) {
    if (recommendation.class === 'human-decision') summary.humanDecision += 1;
    else summary[recommendation.class] += 1;
  }
  let designSystem;
  try {
    const status = designSystemStatus(projectRoot, options.designSystems ?? {});
    designSystem = {
      schema: status.schema,
      status: status.status,
      mode: status.mode,
      approved: status.approved,
      root: { id: status.root.id, name: status.root.name, version: status.root.version, sourceClass: status.root.sourceClass, digest: status.root.digest },
      effectiveDigest: status.effectiveDigest,
      approvedBy: status.approvedBy,
      approvedAt: status.approvedAt,
      evidence: status.evidence,
      organisationRecommendations: status.organisationRecommendations,
      organisationRecommendationStatus: status.organisationRecommendationStatus,
      notice: status.notice,
    };
  } catch {
    designSystem = { schema: 'ewai.design-system-status/v1', status: 'unavailable', mode: 'unknown', approved: false, notice: 'Project design-system status is unavailable.' };
  }
  return {
    schema: 'ewai.companion-guidance/v1',
    status: recommendations.length ? 'ready' : 'empty',
    focus,
    summary,
    recommendations,
    spotlight,
    activePersonas,
    personaAvailability: personaAvailability(personas),
    designSystem,
    baseline: {
      standardModel: true,
      complete: true,
      description: 'The host model with installed project and core personas provides the complete baseline. Installed premium and personal personas can add optional specialist perspectives.',
    },
    review: { advisory: true, questions: reviewQuestions(spotlight, focus) },
    notices: { advisory: COMPANION_ADVISORY_NOTICE, security: COMPANION_ASSURANCE_NOTICE },
    limits: { recommendations: RECOMMENDATION_LIMIT, personas: PERSONA_LIMIT, focusCharacters: FOCUS_LIMIT },
  };
}
