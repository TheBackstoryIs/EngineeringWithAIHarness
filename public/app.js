const deliveryPhases = [
  ['ideate', 'Ideate'], ['intent', 'Intent'], ['reconcile', 'Reconcile'], ['plan', 'Plan'],
  ['pattern-validation', 'Pattern validation'], ['test-plan', 'Test plan'],
  ['validate-external-plan', 'External plan validation'], ['validate-external-test-plan', 'External test validation'],
  ['build', 'Build'], ['standards-sweep', 'Standards sweep'], ['test-execute', 'Test execution'],
  ['validate-external-code', 'External code validation'], ['delivery', 'Delivery'], ['retro', 'Retrospective']
];

const cycleDefinitions = [
  ['backlog', 'Backlog'], ['think', 'Think'], ['ready', 'Ready'], ['build', 'Build'],
  ['deliver', 'Deliver'], ['learn', 'Learn'], ['done', 'Complete']
];

const securityAssuranceNotice = 'Security validation is evidence, not certification or proof that this system is secure. Tools can miss vulnerabilities and produce false positives. A qualified human must review the scope, findings, limitations and residual risk before release.';
const companionAdvisoryNotice = 'Companion and persona guidance is advisory. It cannot create delivery permission, user evidence, specialist assurance or human acceptance.';
const portfolioAdvisoryNotice = 'Portfolio and persona analysis is advisory. Child project approvals, accepted risk, Manual QA and release decisions remain with named accountable humans.';
const rolloutAdvisoryNotice = 'Rollout and persona analysis is advisory. Organisation Blueprint adoption, evidence adequacy, accepted risk, Manual QA, deployment and release decisions remain with named accountable humans.';
const meetingEvidenceDisclaimer = 'Security validation is evidence, not certification or proof that this system is secure. Tools can miss vulnerabilities and produce false positives. A qualified human must review the scope, findings, limitations and residual risk before release.';
const knowledgeProposalDisclaimer = 'Security validation is evidence, not certification or proof that this system is secure. Tools can miss vulnerabilities and produce false positives. A qualified human must review the scope, findings, limitations and residual risk before release.';

import {createDashboardNavigation} from './dashboard-navigation.js';
import {configureAutonomyDashboard, loadAutonomyState, renderAutonomyIntentDetail} from './autonomy.js';

const state = {
  project: null,
  items: [],
  groups: [],
  sessions: [],
  personas: [],
  personaError: null,
  pendingPersonaLink: null,
  personaQuery: '',
  personaRole: 'reviewer',
  personaDepth: 3,
  knowledge: { tree: [], documents: [], count: 0, matches: [] },
  palaceTidiness: null,
  knowledgeDocument: null,
  knowledgeError: false,
  knowledgeMode: 'knowledge',
  meetingEvidence: null,
  meetingEvidencePreparation: null,
  meetingEvidenceLoading: false,
  meetingEvidenceError: '',
  meetingEvidenceMessage: '',
  knowledgeProposals: null,
  knowledgeProposalPreparation: null,
  knowledgeProposalLoading: false,
  knowledgeProposalError: '',
  knowledgeProposalMessage: '',
  guided: null,
  guidedQuestionIndex: 0,
  guidedLoading: false,
  guidedError: '',
  guidedCompleted: null,
  guidedSaveState: 'Project-local draft',
  evidenceDepthLoading: false,
  evidenceDepthNotice: '',
  evidenceDepthComparison: null,
  guidedIntent: null,
  guidedIntentLoading: false,
  guidedIntentError: '',
  guidedIntentNotice: '',
  guidedIntentCompleted: null,
  phaseStudio: null,
  phaseStudioReference: '',
  phaseStudioTopic: '',
  phaseStudioLoading: false,
  phaseStudioError: '',
  phaseStudioNotice: '',
  prototypeReview: null,
  prototypeReviewStage: 'plan',
  prototypeReviewLoading: false,
  prototypeReviewError: '',
  prototypeReviewNotice: '',
  hooks: null,
  hooksLoading: false,
  hooksError: '',
  hooksNotice: '',
  security: null,
  securityLoading: false,
  securityError: '',
  securityNotice: '',
  errorReports: null,
  errorReportDetail: null,
  errorReportLoading: false,
  errorReportNotice: '',
  selectedErrorReportId: '',
  teamHub: null,
  teamHubLoading: false,
  teamHubError: '',
  teamHubNotice: '',
  teamHubResources: null,
  teamHubResourceInspection: null,
  policy: null,
  policyMode: 'business',
  policyIntent: '',
  policyLoading: false,
  policyError: '',
  policyNotice: '',
  starters: null,
  startersLoading: false,
  startersError: '',
  startersNotice: '',
  companion: null,
  companionLoading: false,
  companionError: '',
  companionSelection: '',
  companionFocus: '',
  portfolio: null,
  portfolioLoading: false,
  portfolioError: '',
  portfolioSelection: '',
  portfolioFocus: '',
  rollout: null,
  rolloutLoading: false,
  rolloutError: '',
  rolloutSelection: '',
  rolloutFocus: '',
  contextManifest: null,
  contextLoading: false,
  contextError: '',
  contextNotice: '',
  hookFilters: { status: '', event: '', handler: '' },
  selectedHookDeliveryId: '',
  query: '',
  group: '',
  sprintOnly: false,
  showDone: false,
  boardMode: 'stages',
  view: 'board',
  selected: null,
  selectedTab: 'overview',
  impactDraft: { summary: '', targets: '' },
  impactAnalysis: null,
  impactError: '',
  impactNotice: '',
  impactLoading: false,
  impactReceipt: null,
  testScenarioFilters: { status: 'all', route: 'all', tier: 'all' },
  pendingAction: null,
  actionNotice: null,
  pollTimer: null
};

const element = (id) => document.getElementById(id);
let kpiHideTimer = null;
let knowledgeSearchTimer = null;
let knowledgeRequestSequence = 0;
const personaMutationQueues = new Map();
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
})[character]);

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers }
  });
  let body;
  try { body = await response.json(); }
  catch {
    const error = new Error('The dashboard returned an unreadable response.');
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(body?.error || `Request failed: ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function valueAtPath(object, path) {
  return path.split('.').reduce((value, key) => value?.[key], object);
}

function setValueAtPath(object, path, value) {
  const keys = path.split('.');
  let target = object;
  for (const key of keys.slice(0, -1)) {
    if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {};
    target = target[key];
  }
  target[keys.at(-1)] = value;
}

function answered(value) {
  if (Array.isArray(value)) return value.some((item) => String(item).trim());
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function parseDate(value) {
  if (!value) return null;
  const normalized = String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timeAgo(value) {
  const date = parseDate(value);
  if (!date) return 'unknown';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

function timeUntil(value) {
  const date = parseDate(value);
  if (!date) return 'at an unknown time';
  const seconds = Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  return hours < 48 ? `in ${hours}h` : `in ${Math.ceil(hours / 24)}d`;
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, (_match, label, href) => {
      const target = href.replaceAll('&amp;', '&');
      if (!/^(?:https?:|mailto:|\/|#)/i.test(target)) return `${label} (${href})`;
      return `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`;
    });
}

function renderMarkdown(markdown) {
  const html = [];
  let paragraph = [];
  let listOpen = false;
  const flush = () => {
    if (paragraph.length) html.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (listOpen) html.push('</ul>');
    listOpen = false;
  };
  for (const line of String(markdown ?? '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').split(/\r?\n/)) {
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (heading) {
      flush(); closeList();
      const level = Math.min(heading[1].length + 1, 4);
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (bullet) {
      flush();
      if (!listOpen) { html.push('<ul>'); listOpen = true; }
      html.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
    } else if (!line.trim()) {
      flush(); closeList();
    } else {
      closeList();
      paragraph.push(line.trim());
    }
  }
  flush(); closeList();
  return html.join('');
}

function matchesQuery(item) {
  const query = state.query.toLowerCase();
  return !query || `${item.id} ${item.title} ${item.domain} ${item.currentPhase} ${item.state}`.toLowerCase().includes(query);
}

function matchesBaseScope(item) {
  return (!state.sprintOnly || item.currentSprint)
    && (state.showDone || item.lane !== 'done')
    && matchesQuery(item);
}

function visibleItems() {
  return state.items.filter((item) => matchesBaseScope(item)
    && (!state.group || item.groups.some((group) => group.slug === state.group)));
}

function needsHuman(session) {
  return Boolean(session.awaitingHuman || session.status === 'awaiting-human');
}

function summaryMetric(label, value, tone = '') {
  return `<div class="summary-metric ${tone}"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function renderSummary() {
  const activeSessions = state.sessions.filter((session) => ['running', 'awaiting-human', 'blocked', 'stale'].includes(session.status));
  const metrics = [
    ['Intents', state.items.length, ''],
    ['Active sprint', state.items.filter((item) => item.currentSprint).length, ''],
    ['In delivery', state.items.filter((item) => item.lane === 'active').length, 'positive'],
    ['Questions', activeSessions.filter(needsHuman).length, 'attention'],
    ['Blocked', state.items.filter((item) => item.lane === 'blocked').length, 'danger'],
    ['Completed', state.items.filter((item) => item.lane === 'done').length, '']
  ];
  element('summary').innerHTML = metrics.map(([label, value, tone]) => summaryMetric(label, value, tone)).join('');
  element('liveCount').textContent = String(activeSessions.length);
}

function showKpis() {
  window.clearTimeout(kpiHideTimer);
  element('summary').hidden = false;
  element('kpiToggle').setAttribute('aria-expanded', 'true');
}

function hideKpis() {
  window.clearTimeout(kpiHideTimer);
  element('summary').hidden = true;
  element('kpiToggle').setAttribute('aria-expanded', 'false');
}

function scheduleKpiHide() {
  window.clearTimeout(kpiHideTimer);
  kpiHideTimer = window.setTimeout(() => {
    if (document.activeElement === element('kpiToggle') || element('summary').matches(':hover')) return;
    hideKpis();
  }, 140);
}

function renderGroups() {
  const matching = state.items.filter(matchesBaseScope);
  const counts = new Map();
  for (const item of matching) for (const group of item.groups) counts.set(group.slug, (counts.get(group.slug) ?? 0) + 1);
  const groups = state.groups.filter((group) => counts.has(group.slug) || group.slug === state.group);
  element('groupList').innerHTML = groups.length ? groups.map((group) => `
    <button type="button" class="group-button ${state.group === group.slug ? 'active' : ''}" data-group="${escapeHtml(group.slug)}">
      <span><i aria-hidden="true"></i>${escapeHtml(group.name)}</span><b>${counts.get(group.slug) ?? 0}</b>
    </button>
  `).join('') : '<p class="rail-empty">No categories match the current filters.</p>';
  element('allGroups').classList.toggle('active', !state.group);
  element('allCount').textContent = String(matching.length);
  element('sprintCount').textContent = String(state.items.filter((item) => item.currentSprint).length);
  element('visibleCount').textContent = String(visibleItems().length);
  element('boardTitle').textContent = state.group
    ? state.groups.find((group) => group.slug === state.group)?.name ?? state.group
    : state.sprintOnly ? 'Active sprint' : 'All intents';
}

function activeAfkRun(view) {
  return (view.afk ?? []).find((run) => !['completed', 'cancelled'].includes(run.status)) ?? null;
}

function afkTaskCounts(run) {
  const tasks = Object.values(run?.tasks ?? {});
  return {
    total: tasks.length,
    completed: tasks.filter((task) => task.status === 'completed').length,
    active: tasks.filter((task) => ['running', 'reviewing', 'integrating'].includes(task.status)).length,
  };
}

function launchModel(view) {
  const execution = view.item.execution;
  const run = activeAfkRun(view);
  if (run) {
    const counts = afkTaskCounts(run);
    const canPause = run.alive !== false && ['starting', 'running'].includes(run.status) && run.desiredState === 'running';
    const canResume = run.alive === false || ['paused', 'blocked', 'failed'].includes(run.status) || run.desiredState === 'paused';
    return {
      tone: run.alive === false || run.status === 'blocked' || run.status === 'failed' ? 'blocked' : 'running',
      eyebrow: 'AFK Build',
      title: run.alive === false ? 'Build process stopped' : run.status === 'blocked' ? 'Build needs attention' : run.status === 'paused' ? 'Build is safely paused' : 'Build is running',
      summary: `${counts.completed} of ${counts.total || execution.tasks.tasks.length} tasks complete${counts.active ? ` · ${counts.active} active now` : ''}.`,
      status: run.status,
      buttons: [
        ...(canPause ? [{ action: 'afk-pause', label: 'Pause safely', kind: 'secondary', runId: run.id }] : []),
        ...(canResume ? [{ action: 'afk-resume', label: 'Resume Build', kind: 'primary', runId: run.id }] : []),
        { action: 'afk-cancel', label: 'Cancel run', kind: 'danger', runId: run.id },
      ],
    };
  }

  if (view.dashboardHandoff) {
    return {
      tone: 'queued', eyebrow: 'EWAI handoff', title: 'Ready in your AI conversation',
      summary: `“${view.item.title}” is queued. Return to EWAI and say “go”; it will claim this intent and continue the verified harness.`,
      status: 'queued',
      buttons: [{ action: 'cancel-handoff', label: 'Remove from queue', kind: 'secondary', handoffId: view.dashboardHandoff.id }],
    };
  }

  const actions = execution?.actions ?? {};
  if (actions.acquireTask?.permitted) {
    return {
      tone: 'ready', eyebrow: 'Build runway', title: 'Approved tasks are ready',
      summary: `${execution.tasks.available.length} task${execution.tasks.available.length === 1 ? '' : 's'} can run now. Start AFK delivery or continue alongside EWAI in conversation.`,
      status: 'build ready',
      buttons: [
        { action: 'afk-start', label: 'Start AFK Build', kind: 'primary' },
        { action: 'guided-continue', label: 'Continue with EWAI', kind: 'secondary' },
      ],
    };
  }
  if (actions.approveBuild?.permitted) {
    return {
      tone: 'approval', eyebrow: 'Human decision', title: 'The plan is ready for Build approval',
      summary: 'Review the accepted plan and test evidence, confirm who is approving it, and define the scope EWAI may build.',
      status: 'approval needed',
      buttons: [
        { action: 'approve-build', label: 'Review and approve Build', kind: 'primary' },
        { action: 'guided-continue', label: 'Discuss with EWAI', kind: 'secondary' },
      ],
    };
  }
  if (actions.enterBuild?.permitted) {
    return {
      tone: 'ready', eyebrow: 'Build runway', title: 'Build is approved',
      summary: 'Enter the guarded Build phase. EWAI will still require a valid task graph and preflight before unattended work can begin.',
      status: 'approved',
      buttons: [
        { action: 'enter-build', label: 'Enter Build', kind: 'primary' },
        { action: 'guided-continue', label: 'Continue with EWAI', kind: 'secondary' },
      ],
    };
  }
  if (actions.beginHarness?.permitted) {
    return {
      tone: 'ready', eyebrow: 'Intent runway', title: 'Start with the full EWAI method',
      summary: 'Carry this intent into your AI conversation. EWAI will confirm its shape and begin the fourteen-stage harness without skipping into code.',
      status: 'ready',
      buttons: [{ action: 'guided-begin', label: 'Work on this intent', kind: 'primary' }],
    };
  }
  if (actions.continueHarness?.permitted) {
    const next = actions.continueHarness.nextPhase || view.item.currentPhase;
    return {
      tone: 'ready', eyebrow: 'Continue delivery', title: `Continue from ${next.replaceAll('-', ' ')}`,
      summary: 'EWAI will reconcile the durable state copies and resume the exact next required phase in conversation.',
      status: next,
      buttons: [{ action: 'guided-continue', label: 'Continue with EWAI', kind: 'primary' }],
    };
  }

  const blockers = Object.values(actions).flatMap((action) => action.blockers ?? []);
  const unique = [...new Map(blockers.map((item) => [item.code, item])).values()];
  return {
    tone: 'blocked', eyebrow: 'Evidence gate', title: 'This intent cannot move yet',
    summary: unique[0]?.message || 'EWAI could not derive a safe next action from the current evidence.',
    status: `${unique.length} blocker${unique.length === 1 ? '' : 's'}`,
    blockers: unique.slice(0, 4), buttons: [],
  };
}

function renderLaunchpad(view) {
  const model = launchModel(view);
  const buttons = model.buttons.map((button) => `
    <button type="button" class="launch-button ${escapeHtml(button.kind)}" data-dashboard-action="${escapeHtml(button.action)}"
      ${button.runId ? `data-run-id="${escapeHtml(button.runId)}"` : ''}${button.handoffId ? `data-handoff-id="${escapeHtml(button.handoffId)}"` : ''}>${escapeHtml(button.label)}</button>
  `).join('');
  return `<section class="intent-launchpad launch-${escapeHtml(model.tone)}">
    <div class="launch-track" aria-hidden="true"><i></i><span></span></div>
    <div class="launch-copy">
      <span class="eyebrow">${escapeHtml(model.eyebrow)}</span>
      <h3>${escapeHtml(model.title)}</h3>
      <p>${escapeHtml(model.summary)}</p>
      ${model.blockers?.length ? `<ul>${model.blockers.map((item) => `<li>${escapeHtml(item.message)}</li>`).join('')}</ul>` : ''}
      ${state.actionNotice?.intentId === view.item.id ? `<div class="launch-notice">${escapeHtml(state.actionNotice.message)}</div>` : ''}
    </div>
    <div class="launch-controls"><b>${escapeHtml(model.status)}</b>${buttons}</div>
  </section>`;
}

function renderPremiumUpgrade() {
  const card = element('premiumCard');
  const premium = state.project?.premium;
  navigation.updatePremium(premium);
  if (!premium?.showUpgrade || !premium.upgradeUrl) {
    card.hidden = true;
    card.removeAttribute('href');
    return;
  }
  card.href = 'https://www.conversationalcoding.dev/personas/';
  card.hidden = false;
}

function renderCard(item) {
  const session = state.sessions.find((candidate) => candidate.workItemId === item.id && candidate.status !== 'completed');
  return `
    <article class="intent-card ${session ? 'has-live-work' : ''}" data-open-item="${escapeHtml(item.id)}">
      <header>
        <span class="priority priority-${escapeHtml(item.priority.toLowerCase())}">${escapeHtml(item.priority)}</span>
        <button type="button" class="sprint-star ${item.currentSprint ? 'selected' : ''}" data-sprint-item="${escapeHtml(item.id)}" aria-label="${item.currentSprint ? 'Remove from' : 'Add to'} active sprint" title="${item.currentSprint ? 'Remove from' : 'Add to'} active sprint">${item.currentSprint ? '★' : '☆'}</button>
      </header>
      <button type="button" class="card-main" data-open-item="${escapeHtml(item.id)}">
        <span class="card-domain">${escapeHtml(item.domain)}</span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.currentPhase || item.state)} · ${escapeHtml(item.lane)}</small>
      </button>
      <progress class="card-progress" max="100" value="${item.completionPercent}" aria-label="${item.completionPercent}% complete"></progress>
      <footer>
        <span>${item.completionPercent}%</span>
        <span>${item.artefacts.length} material${item.artefacts.length === 1 ? '' : 's'}</span>
        ${session ? `<span class="working-now"><i></i>${escapeHtml(session.tool || 'agent')}</span>` : ''}
      </footer>
    </article>`;
}

function stageBucket(item) {
  if (item.lane === 'done' || item.currentPhase === 'done') return 'done';
  if (item.currentPhase === 'backlog') return 'backlog';
  const adjunctBuckets = {
    'ui-design': 'reconcile',
    'fit-check': 'build',
    'manual-qa': 'delivery',
    'shelf-ready': 'validate-external-test-plan',
    'complete-dry-run': 'validate-external-test-plan'
  };
  if (adjunctBuckets[item.currentPhase]) return adjunctBuckets[item.currentPhase];
  return deliveryPhases.some(([key]) => key === item.currentPhase) ? item.currentPhase : 'backlog';
}

function cycleBucket(item) {
  if (item.lane === 'done' || item.currentPhase === 'done') return 'done';
  if (item.currentPhase === 'manual-qa') return 'deliver';
  if (item.currentPhase === 'fit-check') return 'ready';
  if (item.currentPhase === 'ui-design') return 'think';
  if (['shelf-ready', 'complete-dry-run'].includes(item.currentPhase)) return 'ready';
  if (item.lane === 'backlog' && ['ideate', 'intent'].includes(item.currentPhase)) return 'backlog';
  if (item.lane === 'ready') return 'ready';
  const phaseIndex = deliveryPhases.findIndex(([key]) => key === item.currentPhase);
  if (phaseIndex >= 0 && phaseIndex <= 7) return 'think';
  if (phaseIndex >= 8 && phaseIndex <= 11) return 'build';
  if (item.currentPhase === 'delivery') return 'deliver';
  if (item.currentPhase === 'retro') return 'learn';
  return 'backlog';
}

function boardDefinitions() {
  return state.boardMode === 'cycle'
    ? cycleDefinitions
    : [['backlog', 'Backlog'], ...deliveryPhases, ['done', 'Complete']];
}

function renderKanban() {
  const board = element('kanban');
  const horizontalScroll = board.scrollLeft;
  const laneScroll = new Map([...board.querySelectorAll('[data-lane]')].map((lane) => [lane.dataset.lane, lane.querySelector('.lane-cards')?.scrollTop ?? 0]));
  const items = visibleItems();
  const bucket = state.boardMode === 'cycle' ? cycleBucket : stageBucket;
  board.classList.toggle('cycle-board', state.boardMode === 'cycle');
  board.innerHTML = boardDefinitions()
    .filter(([key]) => state.showDone || key !== 'done')
    .map(([key, label]) => {
      const laneItems = items.filter((item) => bucket(item) === key);
      return `
        <section class="kanban-lane lane-${key}" data-lane="${key}">
          <header class="lane-heading"><span><i></i>${label}</span><b>${laneItems.length}</b></header>
          <div class="lane-cards">
            ${laneItems.length ? laneItems.map(renderCard).join('') : '<div class="lane-empty">No matching work</div>'}
          </div>
        </section>`;
    }).join('');
  board.scrollLeft = horizontalScroll;
  for (const lane of board.querySelectorAll('[data-lane]')) {
    const cards = lane.querySelector('.lane-cards');
    if (cards) cards.scrollTop = laneScroll.get(lane.dataset.lane) ?? 0;
  }
}

function renderBoard() {
  renderGroups();
  renderKanban();
}

function eventLabel(value) {
  return String(value || 'progress').split('-').map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`).join(' ');
}

function sessionTone(session) {
  if (needsHuman(session)) return 'question';
  if (session.status === 'blocked') return 'blocked';
  if (session.status === 'stale') return 'stale';
  return session.status === 'completed' ? 'completed' : 'running';
}

function renderLive() {
  const sessions = state.sessions.filter((session) => session.status !== 'completed');
  const metrics = [
    ['Active', sessions.filter((session) => session.status === 'running').length],
    ['Needs you', sessions.filter(needsHuman).length],
    ['Blocked', sessions.filter((session) => session.status === 'blocked').length],
    ['Quiet / stale', sessions.filter((session) => session.status === 'stale').length]
  ];
  element('liveSummary').innerHTML = metrics.map(([label, value]) => summaryMetric(label, value)).join('');
  element('activeSessions').innerHTML = sessions.length ? sessions.map((session) => `
    <button type="button" class="active-card tone-${sessionTone(session)}" data-open-item="${escapeHtml(session.workItemId)}">
      <header><span>${escapeHtml(session.domain)}</span><b>${escapeHtml(session.status)}</b></header>
      <h3>${escapeHtml(session.title)}</h3>
      <div class="active-meta"><span>${escapeHtml(session.tool || 'agent')}</span><span>${escapeHtml(session.phaseKey || 'phase unrecorded')}</span><span>${escapeHtml(timeAgo(session.latestEventAt))}</span></div>
      <p>${escapeHtml(session.latestEventSummary || session.summary || 'No material update recorded yet.')}</p>
      ${session.question ? `<div class="human-question">${escapeHtml(session.question)}</div>` : ''}
      <footer><span>${escapeHtml(eventLabel(session.latestEventType))}</span><span>${session.eventCount} events</span></footer>
    </button>
  `).join('') : `
    <div class="live-empty">
      <strong>No work is broadcasting activity.</strong>
      <p>When an agent starts an EWAI delivery session, its material updates will appear here automatically.</p>
    </div>`;
}

function knowledgeNode(node) {
  if (node.type === 'folder') {
    return `<details class="knowledge-folder" open><summary><span>${escapeHtml(node.name)}</span><b>${node.documentCount}</b></summary><div>${node.children.map(knowledgeNode).join('')}</div></details>`;
  }
  const selected = state.knowledgeDocument?.path === node.path;
  return `<button type="button" class="knowledge-document ${selected ? 'active' : ''}" data-knowledge-path="${escapeHtml(node.path)}"><span>${escapeHtml(node.name)}</span><small>${escapeHtml(node.extension.replace('.', '').toUpperCase())}</small></button>`;
}

function filteredKnowledgeNodes(nodes) {
  const query = state.query.trim().toLowerCase();
  if (!query) return nodes;
  const matchedPaths = new Set((state.knowledge.matches ?? []).map((match) => match.path));
  return nodes.flatMap((node) => {
    if (node.type === 'document') return matchedPaths.has(node.path) ? [node] : [];
    const children = filteredKnowledgeNodes(node.children);
    return children.length ? [{ ...node, children, documentCount: children.reduce((count, child) => count + (child.type === 'document' ? 1 : child.documentCount), 0) }] : [];
  });
}

function renderKnowledgeDocument() {
  const document = state.knowledgeDocument;
  if (!document) {
    element('knowledgeEyebrow').textContent = 'EWAI Mind Palace';
    element('knowledgeTitle').textContent = 'Choose a SPECS document';
    element('knowledgeMeta').textContent = 'Browse the durable project context used by people and AI.';
    element('knowledgeContent').innerHTML = '<div class="knowledge-empty"><strong>Your project Mind Palace.</strong><p>Select a SPECS document to read it here.</p></div>';
    return;
  }
  element('knowledgeEyebrow').textContent = document.path.split('/').slice(0, -1).join(' / ') || 'SPECS';
  element('knowledgeTitle').textContent = document.name;
  element('knowledgeMeta').textContent = `${document.path} · ${Math.max(1, Math.round(document.size / 1024))} KB · updated ${timeAgo(document.updatedAt)}`;
  const markdown = ['.md', '.markdown'].includes(document.extension);
  element('knowledgeContent').innerHTML = markdown
    ? `<article class="markdown-body knowledge-markdown">${renderMarkdown(document.content)}</article>`
    : `<pre class="knowledge-source"><code>${escapeHtml(document.content)}</code></pre>`;
}

function renderKnowledge() {
  if (state.knowledgeError) {
    element('knowledgeCount').textContent = '—';
    element('knowledgeTree').innerHTML = '<p class="rail-empty">Project knowledge is temporarily unavailable.</p>';
    element('knowledgeContent').innerHTML = '<div class="knowledge-empty"><strong>Knowledge browser unavailable.</strong><p>The delivery board remains available while the SPECS tree is checked.</p></div>';
    return;
  }
  const nodes = filteredKnowledgeNodes(state.knowledge.tree);
  element('knowledgeCount').textContent = String(state.knowledge.count);
  element('knowledgeTree').innerHTML = nodes.length ? nodes.map(knowledgeNode).join('') : '<p class="rail-empty">No SPECS documents match this search.</p>';
  const tidiness = state.palaceTidiness;
  const indicator = element('palaceTidiness');
  indicator.classList.toggle('tidy', tidiness?.status === 'tidy');
  indicator.classList.toggle('attention', tidiness?.status === 'housekeeping-recommended');
  indicator.querySelector('span').textContent = !tidiness
    ? 'Tidiness unavailable'
    : tidiness.status === 'tidy'
      ? 'Palace tidy'
      : `${tidiness.findings.length} item${tidiness.findings.length === 1 ? '' : 's'} need housekeeping`;
  renderKnowledgeDocument();
}

function sourceStateLabel(source) {
  if (source.freshness !== 'current') return source.freshness;
  if (source.promotionState === 'promoted') return 'promoted';
  if (source.reviewState === 'reviewed') return 'reviewed';
  return 'awaiting review';
}

function renderMeetingEvidence() {
  const workspace = state.meetingEvidence;
  element('meetingEvidenceNotice').textContent = meetingEvidenceDisclaimer;
  if (state.meetingEvidenceLoading) {
    element('meetingEvidenceSources').innerHTML = '<p class="rail-empty">Loading registered sources…</p>';
    element('meetingEvidenceState').innerHTML = '<div class="meeting-evidence-empty"><strong>Loading safe meeting evidence</strong><p>Raw source material is not sent to this workspace.</p></div>';
    return;
  }
  if (!workspace || state.meetingEvidenceError) {
    element('meetingEvidenceSources').innerHTML = '<p class="rail-empty">Meeting evidence is unavailable.</p>';
    element('meetingEvidenceState').innerHTML = `<div class="meeting-evidence-empty is-error" role="alert"><strong>Meeting evidence could not be loaded.</strong><p>${escapeHtml(state.meetingEvidenceError || 'No successful state is inferred.')}</p></div>`;
    element('meetingEvidenceCandidates').innerHTML = '';
    element('meetingEvidencePersonas').innerHTML = '';
    element('meetingEvidenceActions').innerHTML = '';
    return;
  }
  const selected = workspace.selectedSource;
  element('knowledgeCount').textContent = String(workspace.counts.sources);
  element('meetingEvidenceSources').innerHTML = workspace.sources.length
    ? workspace.sources.map((source) => `<button type="button" class="meeting-source-card ${source.sourceId === workspace.selectedSourceId ? 'active' : ''}" data-meeting-source="${escapeHtml(source.sourceId)}"><span><strong>${escapeHtml(source.label)}</strong><b>${escapeHtml(sourceStateLabel(source))}</b></span><small>${escapeHtml(source.classification)} · cloud ${escapeHtml(source.cloudProcessing)}</small><small>${escapeHtml(source.candidateCount)} candidates · ${escapeHtml(source.reviewedCount)} reviewed · ${escapeHtml(source.promotedCount)} promoted</small><code>${escapeHtml(source.digest.slice(0, 12))}</code></button>`).join('')
    : '<div class="meeting-evidence-empty"><strong>No registered meeting sources.</strong><p>Register a supported local transcript or minutes file through the CLI or an AI host. Raw material remains outside SPECS.</p><code>ewai meeting register FILE --yes</code></div>';
  if (!selected) {
    element('meetingEvidenceTitle').textContent = 'Meeting evidence';
    element('meetingEvidenceMeta').textContent = 'No registered source is available.';
    element('meetingEvidenceActions').innerHTML = '';
    element('meetingEvidenceState').innerHTML = '<div class="meeting-evidence-empty"><strong>Evidence starts with an explicit source registration.</strong><p>This workspace never accepts uploads or displays transcript text.</p></div>';
    element('meetingEvidenceCandidates').innerHTML = '<p class="meeting-evidence-empty">No reviewed candidates.</p>';
    element('meetingEvidenceContext').innerHTML = '<p>No source selected.</p>';
    element('meetingEvidencePersonas').innerHTML = '<p>No active persona ensemble.</p>';
    return;
  }
  element('meetingEvidenceTitle').textContent = selected.label;
  element('meetingEvidenceMeta').textContent = `${selected.reviewState} · ${selected.promotionState} · source ${selected.freshness}`;
  element('meetingEvidenceActions').innerHTML = `${workspace.actions.prepare ? `<button type="button" class="secondary-action" data-meeting-prepare="${escapeHtml(selected.sourceId)}">Prepare extraction</button>` : ''}${workspace.actions.promote ? `<button type="button" class="primary-action" data-meeting-promote="${escapeHtml(selected.sourceId)}">Promote accepted</button>` : ''}`;
  const preparation = state.meetingEvidencePreparation?.source?.sourceId === selected.sourceId ? state.meetingEvidencePreparation : null;
  const message = state.meetingEvidenceMessage ? `<div class="meeting-evidence-message" role="status">${escapeHtml(state.meetingEvidenceMessage)}</div>` : '';
  const stale = selected.freshness !== 'current' || workspace.review?.fresh === false;
  element('meetingEvidenceState').innerHTML = `${message}${stale ? '<div class="meeting-evidence-warning" role="alert"><strong>Source or review has changed.</strong><p>Prepare and promotion are stopped until the source is registered and reviewed again.</p></div>' : ''}${preparation ? `<div class="meeting-evidence-prepared"><strong>Extraction contract ready</strong><p>${escapeHtml(preparation.processing.reason)}</p><code>${escapeHtml(preparation.candidateContract.schema)}</code><span>${escapeHtml(preparation.activePersonas.length)} personas actively engaged</span></div>` : ''}${workspace.review ? `<div class="meeting-evidence-receipt"><span><strong>Reviewed by</strong>${escapeHtml(workspace.review.reviewedBy)}</span><span><strong>Reviewed</strong>${escapeHtml(workspace.review.reviewedAt)}</span><span><strong>Review digest</strong><code>${escapeHtml(workspace.review.digest)}</code></span></div>` : '<div class="meeting-evidence-warning"><strong>Named review pending.</strong><p>Prepare a candidate bundle, then use the CLI or AI-host tool to record every disposition.</p></div>'}${workspace.promotion ? `<div class="meeting-evidence-receipt is-promoted"><span><strong>Promoted by</strong>${escapeHtml(workspace.promotion.approvedBy)}</span><span><strong>Promoted</strong>${escapeHtml(workspace.promotion.approvedAt)}</span><span><strong>Evidence digest</strong><code>${escapeHtml(workspace.promotion.evidenceDigest)}</code></span></div>` : ''}`;
  element('meetingEvidenceCandidates').innerHTML = workspace.candidates.length
    ? workspace.candidates.map((candidate) => `<article class="meeting-candidate" data-decision="${escapeHtml(candidate.disposition.decision)}"><div class="meeting-candidate-anchor"><span>${candidate.lineAnchors.map(({ start, end }) => `L${start}${end === start ? '' : `–${end}`}`).join(', ')}</span><i aria-hidden="true"></i></div><div><header><span>${escapeHtml(candidate.type)}</span><b>${escapeHtml(candidate.disposition.decision)}</b></header><h4>${escapeHtml(candidate.disposition.decision === 'amended' ? candidate.disposition.replacementText : candidate.observedStatement)}</h4><p>${escapeHtml(candidate.interpretation)}</p><small>Confidence: ${escapeHtml(candidate.confidence)}${candidate.disposition.rationale ? ` · ${escapeHtml(candidate.disposition.rationale)}` : ''}</small></div></article>`).join('')
    : '<p class="meeting-evidence-empty">No named review has produced displayable candidates.</p>';
  element('meetingEvidenceContext').innerHTML = `<dl><div><dt>Classification</dt><dd>${escapeHtml(selected.classification)}</dd></div><div><dt>Cloud processing</dt><dd>${escapeHtml(selected.cloudProcessing)}</dd></div><div><dt>Source digest</dt><dd><code>${escapeHtml(selected.digest)}</code></dd></div><div><dt>Lines</dt><dd>${escapeHtml(selected.lineCount)}</dd></div></dl>`;
  element('meetingEvidencePersonas').innerHTML = workspace.activePersonas.length
    ? workspace.activePersonas.map((persona) => `<article class="meeting-persona" data-tier="${escapeHtml(persona.tier)}"><header><strong>${escapeHtml(persona.name)}</strong><span>${escapeHtml(persona.tier)}</span></header><p>${escapeHtml(persona.engagementReason)}</p><small>${escapeHtml((persona.matchedSignals ?? []).join(' · '))}</small></article>`).join('')
    : '<p>No active persona ensemble is available for this source.</p>';
}

async function loadMeetingEvidence(sourceId = '') {
  state.meetingEvidenceLoading = true;
  state.meetingEvidenceError = '';
  renderMeetingEvidence();
  try {
    state.meetingEvidence = await api(`/api/meeting-evidence${sourceId ? `?source=${encodeURIComponent(sourceId)}` : ''}`);
    state.meetingEvidencePreparation = null;
  } catch (error) {
    state.meetingEvidenceError = error.message;
  } finally {
    state.meetingEvidenceLoading = false;
    renderMeetingEvidence();
  }
}

function proposalStateLabel(proposal) {
  if (proposal.disposition?.decision) return proposal.disposition.decision;
  return proposal.state === 'already-current' ? 'current' : proposal.state;
}

function renderKnowledgeProposalReview(workspace) {
  if (!workspace.bundle || workspace.review) return '';
  return `<section class="knowledge-proposal-review-panel">
    <span class="eyebrow">Named human review</span>
    <h3>Dispose of every proposal</h3>
    <p>Review is complete only when every card has a decision. It does not authorise materialisation.</p>
    <label><span>Reviewer name</span><input id="knowledgeProposalReviewer" type="text" autocomplete="name" placeholder="Accountable reviewer"></label>
    <button type="button" class="primary-action" data-knowledge-proposal-review="${escapeHtml(workspace.bundle.bundleId)}">Record complete review</button>
  </section>`;
}

function renderKnowledgeProposals() {
  const workspace = state.knowledgeProposals;
  element('knowledgeProposalNotice').textContent = knowledgeProposalDisclaimer;
  if (state.knowledgeProposalLoading) {
    element('knowledgeProposalSources').innerHTML = '<p class="rail-empty">Loading eligible evidence…</p>';
    element('knowledgeProposalState').innerHTML = '<div class="knowledge-proposal-empty"><strong>Loading the safe proposal workspace</strong><p>Source bodies and private paths are not returned to this view.</p></div>';
    return;
  }
  if (!workspace || state.knowledgeProposalError) {
    element('knowledgeProposalSources').innerHTML = '<p class="rail-empty">Knowledge proposals are unavailable.</p>';
    element('knowledgeProposalState').innerHTML = `<div class="knowledge-proposal-empty is-error" role="alert"><strong>Knowledge proposals could not be loaded.</strong><p>${escapeHtml(state.knowledgeProposalError || 'No successful state is inferred.')}</p></div>`;
    element('knowledgeProposalCards').innerHTML = '';
    element('knowledgeProposalPersonas').innerHTML = '';
    element('knowledgeProposalActions').innerHTML = '';
    return;
  }
  element('knowledgeCount').textContent = String(workspace.sources.length + workspace.bundles.length);
  const sourceCards = workspace.sources.map((source) => `<article class="knowledge-proposal-source-card"><span><strong>${escapeHtml(source.label)}</strong><b>${escapeHtml(source.family)}</b></span><small>${escapeHtml(source.anchorCount)} anchors</small><code>${escapeHtml(source.digest.slice(0, 12))}</code><button type="button" data-knowledge-proposal-prepare="${escapeHtml(source.ref)}">Prepare</button></article>`).join('');
  const bundleCards = workspace.bundles.map((bundle) => `<button type="button" class="knowledge-proposal-bundle-card ${bundle.bundleId === workspace.selectedBundleId ? 'active' : ''}" data-knowledge-proposal-bundle="${escapeHtml(bundle.bundleId)}"><span><strong>${escapeHtml(bundle.sourceRef)}</strong><b>${escapeHtml(bundle.materialisationState)}</b></span><small>${escapeHtml(bundle.proposalCount)} proposals · ${escapeHtml(bundle.reviewState)}</small><code>${escapeHtml(bundle.bundleDigest.slice(0, 12))}</code></button>`).join('');
  element('knowledgeProposalSources').innerHTML = `${sourceCards || '<div class="knowledge-proposal-empty compact"><strong>No eligible evidence.</strong><p>Promote meeting evidence or complete a retrospective first.</p></div>'}${bundleCards ? `<h3>Recorded bundles</h3>${bundleCards}` : ''}`;

  const bundle = workspace.bundle;
  element('knowledgeProposalTitle').textContent = bundle ? bundle.sourceRef : 'Knowledge proposals';
  element('knowledgeProposalMeta').textContent = bundle ? `${bundle.proposals.length} proposals · ${workspace.review ? 'reviewed' : 'review pending'} · ${workspace.materialisation ? 'materialised' : 'not materialised'}` : 'Prepare eligible evidence through an AI host, then record its schema-valid proposal bundle.';
  element('knowledgeProposalActions').innerHTML = `${workspace.permittedActions.materialise ? `<button type="button" class="primary-action" data-knowledge-proposal-materialise="${escapeHtml(workspace.selectedBundleId)}">Materialise reviewed</button>` : ''}${workspace.permittedActions.recover ? `<button type="button" class="secondary-action" data-knowledge-proposal-recover="${escapeHtml(workspace.selectedBundleId)}">Recover interrupted</button>` : ''}`;
  const preparation = state.knowledgeProposalPreparation;
  const message = state.knowledgeProposalMessage ? `<div class="knowledge-proposal-message" role="status">${escapeHtml(state.knowledgeProposalMessage)}</div>` : '';
  const preparationPanel = preparation ? `<div class="knowledge-proposal-prepared"><strong>Host drafting contract ready</strong><p>${escapeHtml(preparation.hostDirection)}</p><code>${escapeHtml(preparation.proposalContract.schema)}</code><span>${escapeHtml(preparation.activePersonas.length)} personas actively engaged</span></div>` : '';
  const reviewReceipt = workspace.review ? `<div class="knowledge-proposal-receipt"><span><strong>Reviewed by</strong>${escapeHtml(workspace.review.reviewedBy)}</span><span><strong>Reviewed</strong>${escapeHtml(workspace.review.reviewedAt)}</span><span><strong>Review digest</strong><code>${escapeHtml(workspace.review.reviewDigest)}</code></span></div>` : '';
  const materialisationReceipt = workspace.materialisation ? `<div class="knowledge-proposal-receipt is-materialised"><span><strong>Approved by</strong>${escapeHtml(workspace.materialisation.approvedBy)}</span><span><strong>Materialised</strong>${escapeHtml(workspace.materialisation.materialisedAt)}</span><span><strong>Outcome</strong>${escapeHtml(workspace.materialisation.counts.added)} added · ${escapeHtml(workspace.materialisation.counts.alreadyCurrent)} current · ${escapeHtml(workspace.materialisation.counts.conflicts)} conflicts</span></div>` : '';
  element('knowledgeProposalState').innerHTML = `${message}${preparationPanel}${bundle ? `${reviewReceipt}${materialisationReceipt}${renderKnowledgeProposalReview(workspace)}` : '<div class="knowledge-proposal-empty"><strong>No proposal bundle selected.</strong><p>Preparation is read-only. An AI host drafts against the private bounded context, and deterministic validation records proposals under evidence only.</p></div>'}`;
  element('knowledgeProposalCards').innerHTML = bundle?.proposals.length
    ? bundle.proposals.map((proposal) => `<article class="knowledge-proposal-card" data-knowledge-proposal-card="${escapeHtml(proposal.id)}" data-state="${escapeHtml(proposal.state)}"><header><span>${escapeHtml(proposal.kind)}</span><b>${escapeHtml(proposalStateLabel(proposal))}</b></header><h4>${escapeHtml(proposal.title)}</h4><code>${escapeHtml(proposal.destination)}</code><p>${escapeHtml(proposal.rationale)}</p><small>Anchors · ${proposal.evidenceAnchors.map(escapeHtml).join(' · ')}</small>${proposal.disposition ? `<div class="knowledge-proposal-disposition"><strong>${escapeHtml(proposal.disposition.decision)}</strong>${proposal.disposition.rationale ? `<p>${escapeHtml(proposal.disposition.rationale)}</p>` : ''}</div>` : `<div class="knowledge-proposal-review-fields"><label><span>Decision</span><select data-knowledge-proposal-decision><option value="">Choose</option><option value="accepted">Accept</option><option value="rejected">Reject</option><option value="deferred">Defer</option><option value="amended">Amend</option></select></label><label><span>Rationale</span><textarea data-knowledge-proposal-rationale rows="2"></textarea></label><label><span>Replacement title (amend only)</span><input data-knowledge-proposal-replacement-title type="text"></label><label><span>Replacement Markdown (amend only)</span><textarea data-knowledge-proposal-replacement-markdown rows="5"></textarea></label></div>`}</article>`).join('')
    : '<p class="knowledge-proposal-empty">No recorded proposals.</p>';
  element('knowledgeProposalContext').innerHTML = bundle ? `<dl><div><dt>Source</dt><dd>${escapeHtml(bundle.sourceRef)}</dd></div><div><dt>Source digest</dt><dd><code>${escapeHtml(bundle.sourceDigest)}</code></dd></div><div><dt>Bundle digest</dt><dd><code>${escapeHtml(bundle.bundleDigest)}</code></dd></div></dl>` : '<p>Select a recorded bundle or prepare an eligible source.</p>';
  const visiblePersonas = bundle ? workspace.activePersonas : preparation?.activePersonas ?? [];
  element('knowledgeProposalPersonas').innerHTML = visiblePersonas.length
    ? visiblePersonas.map((persona) => `<article class="knowledge-proposal-persona" data-tier="${escapeHtml(persona.tier)}"><header><strong>${escapeHtml(persona.name)}</strong><span>${escapeHtml(persona.tier)}</span></header><p>${escapeHtml(persona.engagementReason)}</p><small>${escapeHtml((persona.matchedSignals ?? []).join(' · '))}</small></article>`).join('')
    : '<p>No active persona ensemble is selected.</p>';
}

async function loadKnowledgeProposals(bundleId = '') {
  state.knowledgeProposalLoading = true;
  state.knowledgeProposalError = '';
  renderKnowledgeProposals();
  try {
    state.knowledgeProposals = await api(`/api/knowledge-proposals${bundleId ? `?bundle=${encodeURIComponent(bundleId)}` : ''}`);
  } catch (error) {
    state.knowledgeProposalError = error.message;
  } finally {
    state.knowledgeProposalLoading = false;
    renderKnowledgeProposals();
  }
}

function setKnowledgeMode(mode) {
  state.knowledgeMode = ['meeting-evidence', 'knowledge-proposals'].includes(mode) ? mode : 'knowledge';
  const meeting = state.knowledgeMode === 'meeting-evidence';
  const proposals = state.knowledgeMode === 'knowledge-proposals';
  element('knowledgeWorkspace').hidden = meeting || proposals;
  element('meetingEvidenceWorkspace').hidden = !meeting;
  element('knowledgeProposalWorkspace').hidden = !proposals;
  element('knowledgeTree').hidden = meeting || proposals;
  element('palaceTidiness').hidden = meeting || proposals;
  element('meetingEvidenceSources').hidden = !meeting;
  element('knowledgeProposalSources').hidden = !proposals;
  document.querySelectorAll('[data-knowledge-mode]').forEach((button) => {
    const active = button.dataset.knowledgeMode === state.knowledgeMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  element('search').disabled = meeting || proposals;
  if (meeting && !state.meetingEvidence && !state.meetingEvidenceLoading) loadMeetingEvidence().catch(console.error);
  else if (proposals && !state.knowledgeProposals && !state.knowledgeProposalLoading) loadKnowledgeProposals().catch(console.error);
  else if (!meeting && !proposals) renderKnowledge();
}

async function openKnowledgeDocument(path) {
  state.knowledgeDocument = (await api(`/api/knowledge/document?path=${encodeURIComponent(path)}`)).document;
  renderKnowledge();
  element('knowledgeContent').scrollTop = 0;
}

async function loadKnowledge(query = state.query) {
  const requestSequence = ++knowledgeRequestSequence;
  const suffix = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
  const [knowledgeResult, tidinessResult] = await Promise.allSettled([
    api(`/api/knowledge${suffix}`),
    api('/api/palace/tidiness')
  ]);
  if (requestSequence !== knowledgeRequestSequence) return;
  if (knowledgeResult.status === 'rejected') {
    state.knowledgeError = true;
    renderKnowledge();
    throw knowledgeResult.reason;
  }
  state.knowledge = knowledgeResult.value;
  state.palaceTidiness = tidinessResult.status === 'fulfilled' ? tidinessResult.value : null;
  state.knowledgeError = false;
  if (!state.knowledgeDocument && state.knowledge.documents.length) {
    const preferred = state.knowledge.documents.find((document) => /(?:^|\/)README\.md$/i.test(document.path)) ?? state.knowledge.documents[0];
    state.knowledgeDocument = (await api(`/api/knowledge/document?path=${encodeURIComponent(preferred.path)}`)).document;
  }
  renderKnowledge();
}

function renderOverview(view) {
  const { item, activity } = view;
  const relationships = view.intent?.relationships ?? [];
  const intentMap = view.intent?.intentMap;
  const execution = item.execution;
  const actionLabels = {
    beginHarness: 'Begin the EWAI harness',
    continueHarness: 'Continue the current delivery',
    completeCurrentPhase: 'Complete the current phase',
    approveBuild: 'Approve Build',
    enterBuild: 'Enter Build',
    acquireTask: 'Take an available task',
  };
  const actions = execution ? Object.entries(execution.actions).map(([key, value]) => `
    <article class="execution-action ${value.permitted ? 'is-permitted' : 'is-blocked'}">
      <span>${value.permitted ? 'Available' : 'Blocked'}</span>
      <strong>${escapeHtml(actionLabels[key] || key)}</strong>
      ${value.blockers?.length ? `<p>${value.blockers.map((entry) => escapeHtml(entry.message)).join(' · ')}</p>` : ''}
    </article>`).join('') : '';
  const tasks = execution?.tasks?.tasks ?? [];
  return `
    <div class="overview-grid">
      ${renderLaunchpad(view)}
      <section class="detail-section status-section">
        <div class="section-heading"><div><span class="eyebrow">Delivery state</span><h3>Where this stands</h3></div><strong class="large-progress">${item.completionPercent}%</strong></div>
        <progress class="detail-progress" max="100" value="${item.completionPercent}" aria-label="${item.completionPercent}% complete"></progress>
        <dl class="state-grid">
          <div><dt>Lane</dt><dd>${escapeHtml(item.lane)}</dd></div>
          <div><dt>Phase</dt><dd>${escapeHtml(item.currentPhase)}</dd></div>
          <div><dt>State</dt><dd>${escapeHtml(item.state)}</dd></div>
          <div><dt>Intent state</dt><dd>${escapeHtml(item.intentState)}</dd></div>
          <div><dt>Priority</dt><dd>${escapeHtml(item.priority)}</dd></div>
          <div><dt>Sprint</dt><dd>${item.currentSprint ? 'Active sprint' : 'Backlog'}</dd></div>
        </dl>
      </section>
      <section class="detail-section full-width">
        <div class="section-heading"><div><span class="eyebrow">Evidence-derived options</span><h3>What can happen next</h3></div><b>${execution?.valid ? 'Verified' : 'Blocked'}</b></div>
        <div class="execution-actions">${actions || '<p>No execution contract has been derived.</p>'}</div>
      </section>
      ${tasks.length ? `<section class="detail-section full-width">
        <div class="section-heading"><div><span class="eyebrow">Task graph</span><h3>Delivery tasks and leases</h3></div><b>${execution.tasks.available.length} available</b></div>
        <div class="task-readiness">${tasks.map((task) => `<article><strong>${escapeHtml(task.id)}</strong><span>${escapeHtml(task.status)}</span>${task.waitingFor?.length ? `<small>Waiting for ${escapeHtml(task.waitingFor.join(', '))}</small>` : ''}${task.lease ? `<small>Leased to ${escapeHtml(task.lease.ownerId)} · ${escapeHtml(task.lease.tool || 'agent')}</small>` : ''}</article>`).join('')}</div>
      </section>` : ''}
      <section class="detail-section">
        <div class="section-heading"><div><span class="eyebrow">People</span><h3>Persona ensemble</h3></div><b>${view.intent?.personas?.length ?? 0}</b></div>
        <div class="persona-list">${view.intent?.personas?.length ? view.intent.personas.map((persona) => `<span>${escapeHtml(persona.ref)} <small>${escapeHtml(persona.role)} · depth ${persona.depth}</small></span>`).join('') : '<p>No personas attached yet.</p>'}</div>
      </section>
      <section class="detail-section">
        <div class="section-heading"><div><span class="eyebrow">Planning context</span><h3>Connections</h3></div><b>${relationships.length}</b></div>
        ${intentMap ? `<p class="intent-map-reference">Intent map · <strong>${escapeHtml(intentMap)}</strong></p>` : ''}
        <div class="relationship-list">${relationships.length ? relationships.map((relationship) => `
          <article>
            <span>${escapeHtml(relationship.type)}</span>
            <strong>${escapeHtml(relationship.target)}</strong>
            ${relationship.rationale ? `<p>${escapeHtml(relationship.rationale)}</p>` : ''}
          </article>`).join('') : '<p>No cross-intent relationships recorded.</p>'}</div>
      </section>
      <section class="detail-section full-width">
        <div class="section-heading"><div><span class="eyebrow">Current work</span><h3>${activity.session ? 'Agent activity is registered' : 'No active delivery session'}</h3></div>${activity.session ? `<span class="live-pill"><i></i>${escapeHtml(activity.session.status)}</span>` : ''}</div>
        <p>${escapeHtml(activity.session?.latestEventSummary || activity.session?.summary || 'This intent is not currently broadcasting material progress.')}</p>
      </section>
    </div>`;
}

function personaByRef(ref) {
  return state.personas.find((persona) => persona.id === ref);
}

function personaRoleOptions(selected) {
  return ['primary', 'reviewer', 'advisor', 'validator', 'challenger', 'user'].map((role) => `<option value="${role}" ${selected === role ? 'selected' : ''}>${role}</option>`).join('');
}

function personaDepthOptions(selected) {
  const labels = ['Light touch', 'Supporting', 'Balanced', 'Deep review', 'Lead perspective'];
  return labels.map((label, index) => `<option value="${index + 1}" ${Number(selected) === index + 1 ? 'selected' : ''}>${index + 1} · ${label}</option>`).join('');
}

function personaResults(view) {
  const attached = new Set((view.intent?.personas ?? []).map((persona) => persona.ref));
  const query = state.personaQuery.trim().toLowerCase();
  const matches = state.personas.filter((persona) => !query || JSON.stringify(persona).toLowerCase().includes(query)).slice(0, 40);
  return matches.length ? matches.map((persona) => `
    <article class="persona-option ${attached.has(persona.id) ? 'is-linked' : ''}">
      <div><span>${escapeHtml(persona.tier || 'library')} · ${escapeHtml(persona.category || 'general')}</span><strong>${escapeHtml(persona.name)}</strong><p>${escapeHtml(persona.description || persona.id)}</p></div>
      <button type="button" data-link-persona="${escapeHtml(persona.id)}" ${attached.has(persona.id) ? 'disabled' : ''}>${attached.has(persona.id) ? 'Linked' : 'Add'}</button>
    </article>`).join('') : '<div class="persona-no-results"><strong>No matching persona.</strong><p>Create a project persona below if this perspective is missing from the library.</p></div>';
}

function renderPersonas(view) {
  if (state.personaError) {
    return `<div class="persona-manager"><div class="persona-library-error"><strong>Persona library unavailable.</strong><p>${escapeHtml(state.personaError)}</p><button type="button" data-retry-personas>Retry library</button></div></div>`;
  }
  const attachments = view.intent?.personas ?? [];
  return `<div class="persona-manager">
    ${state.pendingPersonaLink ? `<div class="persona-link-warning"><div><strong>${escapeHtml(state.pendingPersonaLink.name)} was created, but is not linked yet.</strong><p>${escapeHtml(state.pendingPersonaLink.message)}</p></div><button type="button" data-link-persona="${escapeHtml(state.pendingPersonaLink.id)}">Retry link</button></div>` : ''}
    <section class="persona-manager-section">
      <div class="section-heading"><div><span class="eyebrow">Intent ensemble</span><h3>Linked perspectives</h3></div><b>${attachments.length}</b></div>
      <p class="persona-guidance">These personas will frame discovery, design, review, and validation for this intent.</p>
      <div class="attached-personas">${attachments.length ? attachments.map((attachment) => {
        const persona = personaByRef(attachment.ref);
        return `<article class="attached-persona" data-attached-persona="${escapeHtml(attachment.ref)}">
          <div><strong>${escapeHtml(persona?.name || attachment.ref)}</strong><small>${escapeHtml(attachment.ref)}</small></div>
          <label><span>Role</span><select data-persona-role="${escapeHtml(attachment.ref)}">${personaRoleOptions(attachment.role)}</select></label>
          <label><span>Depth</span><select data-persona-depth="${escapeHtml(attachment.ref)}">${personaDepthOptions(attachment.depth)}</select></label>
          <button type="button" class="persona-unlink" data-unlink-persona="${escapeHtml(attachment.ref)}">Unlink</button>
        </article>`;
      }).join('') : '<div class="persona-no-results"><strong>No personas linked yet.</strong><p>Add at least one user or expert perspective before refining this intent.</p></div>'}</div>
    </section>
    <section class="persona-manager-section">
      <div class="section-heading"><div><span class="eyebrow">Persona library</span><h3>Find another perspective</h3></div><b id="personaLibraryCount">${state.personas.length}</b></div>
      ${state.project?.premium?.active===true?'':'<button type="button" class="quiet-button" data-premium-setup>Set up premium personas</button>'}
      <div class="persona-finder">
        <input id="personaSearch" type="search" aria-label="Search personas" value="${escapeHtml(state.personaQuery)}" placeholder="Search roles, capabilities, or concerns…" autocomplete="off">
        <label><span>Role when linked</span><select id="newPersonaRole">${personaRoleOptions(state.personaRole)}</select></label>
        <label><span>Depth</span><select id="newPersonaDepth">${personaDepthOptions(state.personaDepth)}</select></label>
      </div>
      <div id="personaResults" class="persona-options">${personaResults(view)}</div>
    </section>
    <details class="persona-create">
      <summary>Create a project persona</summary>
      <form id="createPersonaForm">
        <label><span>Name</span><input name="name" required placeholder="e.g. Data Protection Officer"></label>
        <label><span>Slug</span><input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="data-protection-officer"></label>
        <label><span>Category</span><input name="category" required value="general"></label>
        <button type="submit">Create and link</button>
      </form>
    </details>
  </div>`;
}

function impactRouteOptions(route) {
  return ['required', 'recommended', 'not-indicated'].map((decision) => `<option value="${decision}" ${route.recommendation === decision ? 'selected' : ''}>${decision === 'not-indicated' ? 'Not indicated' : decision[0].toUpperCase() + decision.slice(1)}</option>`).join('');
}

function testScenarioOption(value, label, selected) {
  return `<option value="${escapeHtml(value)}" ${selected === value ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function testScenarioSourceGroup(kind) {
  if (String(kind).startsWith('intent-')) return 'Intent';
  if (String(kind).startsWith('plan-')) return 'Plan';
  if (kind === 'test-plan') return 'Test plan';
  if (kind === 'project-standard') return 'Standards';
  if (kind === 'impact-assessment') return 'Impact';
  return 'Other';
}

function renderTestScenarios(view) {
  const workspace = view.testScenarios ?? {
    status: 'missing', reason: 'Test-scenario evidence is unavailable.', sources: [], contextualEvidence: [],
    activePersonas: [], scenarios: [], gaps: [], evidenceRoutes: [], availability: {}, guidance: { readOnly: true }
  };
  const filters = state.testScenarioFilters;
  const personasById = new Map((workspace.activePersonas ?? []).map((persona) => [persona.id, persona]));
  const visible = (workspace.scenarios ?? []).filter((scenario) => {
    const personaTiers = scenario.personaContributions.map((contribution) => personasById.get(contribution.personaId)?.tier).filter(Boolean);
    return (filters.status === 'all' || scenario.status === filters.status)
      && (filters.route === 'all' || scenario.evidenceRoute === filters.route)
      && (filters.tier === 'all' || personaTiers.includes(filters.tier));
  });
  const sourceGroups = [...(workspace.sources ?? []), ...(workspace.contextualEvidence ?? [])].reduce((groups, source) => {
    const label = testScenarioSourceGroup(source.kind);
    groups[label] = (groups[label] ?? 0) + 1;
    return groups;
  }, {});
  const statusLabel = { missing: 'Not prepared', recorded: 'Recorded', stale: 'Stale', invalid: 'Invalid' }[workspace.status] ?? workspace.status;
  const stateMessage = workspace.status === 'missing'
    ? `<section class="test-scenario-state is-missing"><strong>No reviewed test-scenario pack yet.</strong><p>${escapeHtml(workspace.reason)}</p><code>${escapeHtml(workspace.nextAction || `ewai test-scenarios prepare ${view.item.slug} --project .`)}</code></section>`
    : workspace.status === 'stale'
      ? `<section class="test-scenario-state is-stale" role="status"><strong>Source evidence changed after review.</strong><p>${escapeHtml(workspace.reason)} The recorded scenarios remain visible for inspection.</p></section>`
      : workspace.status === 'invalid'
        ? `<section class="test-scenario-state is-invalid" role="alert"><strong>The recorded pair cannot be trusted.</strong><p>${escapeHtml(workspace.reason)} Inspect the JSON and Markdown evidence; this view will not infer or repair it.</p></section>`
        : '';
  const premiumAvailable = workspace.availability?.premium?.installed;
  const premiumState = premiumAvailable
    ? `<span class="test-scenario-library is-available">Premium installed · ${escapeHtml(workspace.availability.premium.count)} available</span>`
    : '<span class="test-scenario-library is-unavailable">Premium not installed · continuing with available personas</span>';
  const personaCards = (workspace.activePersonas ?? []).length
    ? workspace.activePersonas.map((persona) => `<article class="test-scenario-persona" data-tier="${escapeHtml(persona.tier)}"><span>${escapeHtml(persona.tier)} persona</span><strong>${escapeHtml(persona.name)}</strong><small>Matched concerns: ${escapeHtml(persona.matchedSignals.join(', ') || 'project context')}</small><p>${escapeHtml(persona.engagementReason)}</p></article>`).join('')
    : '<p class="test-scenario-empty">No active persona ensemble is recorded for this state.</p>';
  const scenarios = visible.length ? visible.map((scenario) => {
    const contributions = scenario.personaContributions.map((contribution) => {
      const persona = personasById.get(contribution.personaId);
      return `<span><b>${escapeHtml(persona?.name ?? contribution.personaId)}</b><small>${escapeHtml(persona?.tier ?? 'unavailable')} · ${escapeHtml(contribution.concern)}</small></span>`;
    }).join('');
    const sources = scenario.sourceRefs.map((reference) => `<code>${escapeHtml(reference)}</code>`).join('');
    const proof = scenario.plannedTest
      ? `<strong>${escapeHtml(scenario.evidenceRoute)}</strong><small>${escapeHtml(scenario.plannedTest.file)} · ${escapeHtml(scenario.plannedTest.name)}</small>`
      : `<strong>${escapeHtml(scenario.evidenceRoute)}</strong><small>Named human evidence required</small>`;
    return `<article class="test-scenario-row" data-status="${escapeHtml(scenario.status)}">
      <header><div><span>${escapeHtml(scenario.id)} · ${escapeHtml(scenario.type)}</span><h4>${escapeHtml(scenario.title)}</h4></div><b>${escapeHtml(scenario.status)}</b></header>
      <div class="test-scenario-join">
        <section><span>Source</span><div>${sources || '<em>Unresolved hypothesis</em>'}</div></section>
        <section><span>Perspective</span><div>${contributions}</div></section>
        <section><span>Proof</span><div>${proof}</div></section>
      </div>
      <p><strong>Observable result:</strong> ${escapeHtml(scenario.expectedResults.join(' · '))}</p>
    </article>`;
  }).join('') : '<p class="test-scenario-empty">No recorded scenarios match the current view-only filters.</p>';
  const gaps = (workspace.gaps ?? []).length
    ? workspace.gaps.map((gap) => `<li><strong>${escapeHtml(gap.id)}</strong><span>${escapeHtml(gap.question)}</span><b>${escapeHtml(gap.status)}</b></li>`).join('')
    : '<li><span>No open gaps are recorded.</span></li>';

  return `<div class="test-scenario-workspace" aria-labelledby="testScenarioTitle">
    <header class="test-scenario-intro"><div><span class="eyebrow">Source → perspective → proof</span><h3 id="testScenarioTitle">Persona-driven test scenarios</h3><p>Evidence is the source. Personas challenge it. People accept it.</p></div><span class="test-scenario-status is-${escapeHtml(workspace.status)}">${escapeHtml(statusLabel)}</span></header>
    ${stateMessage}
    ${workspace.status === 'recorded' || workspace.status === 'stale' ? `<section class="test-scenario-receipt" aria-label="Reviewed evidence receipt"><span><strong>Reviewed by</strong>${escapeHtml(workspace.reviewer)}</span><span><strong>Recorded</strong>${escapeHtml(workspace.reviewedAt)}</span><span><strong>Digest</strong><code>${escapeHtml(workspace.digest)}</code></span></section>` : ''}
    <section class="test-scenario-readiness" aria-labelledby="testScenarioSources"><header><div><span class="eyebrow">Source readiness</span><h4 id="testScenarioSources">Recorded evidence inputs</h4></div>${premiumState}</header><div>${Object.entries(sourceGroups).length ? Object.entries(sourceGroups).map(([label, count]) => `<span><strong>${escapeHtml(count)}</strong>${escapeHtml(label)}</span>`).join('') : '<p>No source ledger is recorded yet.</p>'}</div></section>
    <section class="test-scenario-personas" aria-labelledby="testScenarioPersonas"><header><div><span class="eyebrow">Active now</span><h4 id="testScenarioPersonas">Engaged perspectives</h4></div><b>${escapeHtml(workspace.activePersonas?.length ?? 0)} active</b></header><div>${personaCards}</div></section>
    <section class="test-scenario-loom" aria-labelledby="testScenarioLoom">
      <header><div><span class="eyebrow">Coverage loom</span><h4 id="testScenarioLoom">Reviewed scenarios and proof routes</h4></div><span id="testScenarioVisibleCount" aria-live="polite">${visible.length} of ${workspace.scenarios?.length ?? 0} visible</span></header>
      <div class="test-scenario-filters" aria-label="View-only scenario filters">
        <label><span>Status</span><select data-test-scenario-filter="status">${testScenarioOption('all', 'All statuses', filters.status)}${['accepted', 'blocked', 'superseded', 'hypothesis'].map((value) => testScenarioOption(value, value[0].toUpperCase() + value.slice(1), filters.status)).join('')}</select></label>
        <label><span>Evidence route</span><select data-test-scenario-filter="route">${testScenarioOption('all', 'All routes', filters.route)}${['automated', 'manual-qa', 'specialist-assurance', 'representative-user'].map((value) => testScenarioOption(value, value.replaceAll('-', ' '), filters.route)).join('')}</select></label>
        <label><span>Persona tier</span><select data-test-scenario-filter="tier">${testScenarioOption('all', 'All tiers', filters.tier)}${['project', 'premium', 'personal', 'core'].map((value) => testScenarioOption(value, value[0].toUpperCase() + value.slice(1), filters.tier)).join('')}</select></label>
      </div>
      <div class="test-scenario-rows">${scenarios}</div>
    </section>
    <section class="test-scenario-gaps" aria-labelledby="testScenarioGaps"><header><span class="eyebrow">Gaps and hypotheses</span><h4 id="testScenarioGaps">What still needs a decision</h4></header><ul>${gaps}</ul></section>
    <p class="test-scenario-boundary">Read-only evidence. This workspace cannot prepare, record, approve, sync, test, assure, release, or complete Manual QA. Named people retain every decision and evidence authority.</p>
  </div>`;
}

function renderImpact(view) {
  const workspace = view.impact ?? { index: { status: 'missing', fresh: false, indexed: 0, parsed: 0, failed: 0 }, assessments: [] };
  const index = workspace.index;
  const sourceMap = view.sourceMap ?? { coverage: { outcomes: {}, depths: {}, warnings: [], totalFiles: 0, profileCount: 0 }, profiles: { profiles: [] }, files: { files: [] }, activePersonas: [] };
  const mapCoverage = sourceMap.coverage ?? { outcomes: {}, depths: {}, warnings: [], totalFiles: 0, profileCount: 0 };
  const outcomeLabels = {
    analysed: 'Analysed',
    inventory_only: 'Inventory only',
    skipped_sensitive: 'Sensitive, unopened',
    skipped_oversized: 'Oversized, unopened',
    analysis_failed: 'Analysis failure'
  };
  const attentionFiles = (sourceMap.files?.files ?? []).filter((file) => file.analysisOutcome !== 'analysed').slice(0, 8);
  const sourceMapSection = `<section class="source-map-coverage" aria-labelledby="sourceMapCoverageTitle">
    <header><div><span class="eyebrow">Repository evidence</span><h3 id="sourceMapCoverageTitle">Source Map coverage</h3><p>Every visible file has an explicit analysis depth and outcome. Enhanced Tree-sitter evidence is deep for supported grammars, not complete understanding.</p></div><b>${escapeHtml(mapCoverage.totalFiles ?? 0)} files · ${escapeHtml(mapCoverage.profileCount ?? 0)} profiles</b></header>
    <div class="source-map-outcomes">${Object.entries(outcomeLabels).map(([key, label]) => `<article data-outcome="${escapeHtml(key)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(mapCoverage.outcomes?.[key] ?? 0)}</strong></article>`).join('')}</div>
    <div class="source-map-detail-grid">
      <section><h4>Profile provenance</h4><div class="source-map-profiles">${(sourceMap.profiles?.profiles ?? []).slice(0, 10).map((profile) => `<article><span>${escapeHtml(profile.sourceKind)} · ${escapeHtml(profile.analysisDepth)}</span><strong>${escapeHtml(profile.id)}</strong><small>${escapeHtml(profile.analyser)} · ${escapeHtml(profile.classification)} · ${escapeHtml(profile.matchCount)} matches</small></article>`).join('') || '<p>No completed profile catalogue is available.</p>'}</div></section>
      <section><h4>Evidence needing attention</h4><div class="source-map-files">${attentionFiles.map((file) => `<article><span>${escapeHtml(file.analysisOutcome.replaceAll('_', ' '))}</span><code>${escapeHtml(file.path)}</code><small>${escapeHtml(file.profileId)} · ${escapeHtml(file.analysisDepth)}</small></article>`).join('') || '<p>No bounded exceptions appear in this sample.</p>'}</div></section>
    </div>
    <section class="source-map-personas" aria-labelledby="sourceMapPersonasTitle"><header><div><span class="eyebrow">Active now</span><h4 id="sourceMapPersonasTitle">Engaged for this map</h4></div><b>${escapeHtml(sourceMap.activePersonas?.length ?? 0)} active</b></header><div>${(sourceMap.activePersonas ?? []).map((persona) => `<article data-tier="${escapeHtml(persona.tier)}"><span>${escapeHtml(persona.tier)} · ${escapeHtml(persona.role)} · depth ${escapeHtml(persona.depth)}</span><strong>${escapeHtml(persona.name)}</strong><p>${escapeHtml(persona.engagementReason)}</p></article>`).join('') || '<p>No personas are attached to this intent. Add relevant user and expert perspectives before relying on the map for discovery.</p>'}</div></section>
    <p class="source-map-boundary">Source Map and persona evidence are advisory. Named people remain accountable for interpretation, acceptance, assurance and release.</p>
  </section>`;
  const analysis = state.impactAnalysis;
  const statusCopy = index.fresh
    ? `Run ${escapeHtml(index.runId)} · ${escapeHtml(index.indexed)} indexed · ${escapeHtml(index.parsed)} parsed · ${escapeHtml(index.failed)} failed`
    : `Repository map ${escapeHtml(index.status || 'missing')} · refresh before analysis`;
  const observed = analysis ? `<section class="impact-band impact-observed" aria-labelledby="impactObservedTitle">
    <header><span>Observed</span><div><h3 id="impactObservedTitle">Observed repository evidence</h3><p>Dependency reach from ${analysis.resolvedTargets.length} resolved target${analysis.resolvedTargets.length === 1 ? '' : 's'}. ${analysis.observed.maxDepth} steps maximum.</p></div><b>${analysis.observed.nodes.length} paths</b></header>
    <div class="impact-evidence-grid">
      <ol class="impact-node-list">${analysis.observed.nodes.length ? analysis.observed.nodes.map((node) => `<li><span>${escapeHtml(node.direction.replaceAll('-', ' '))} · distance ${node.distance}</span><code>${escapeHtml(node.path)}</code><small>${escapeHtml(node.relation)}</small></li>`).join('') : '<li><strong>No repository node resolved.</strong></li>'}</ol>
      <aside class="impact-coverage ${analysis.coverage.complete ? 'is-complete' : 'is-partial'}"><strong>${analysis.coverage.complete ? 'Coverage is complete within configured bounds' : 'Coverage is partial'}</strong><p>${escapeHtml(analysis.coverage.warning || 'All supplied targets resolved and the bounded map completed without parser failures.')}</p>${analysis.unresolvedTargets.length ? `<p>Unresolved: <code>${analysis.unresolvedTargets.map(escapeHtml).join(', ')}</code></p>` : ''}${analysis.ambiguousTargets.length ? `<p>Ambiguous: <code>${analysis.ambiguousTargets.map((target) => escapeHtml(target.input)).join(', ')}</code></p>` : ''}</aside>
    </div>
  </section>` : '';
  const inferred = analysis ? `<section class="impact-band impact-inferred" aria-labelledby="impactPersonasTitle">
    <header><span>Inferred</span><div><h3 id="impactPersonasTitle">Active perspectives</h3><p>The ensemble is selected from the proposed change and observed evidence.</p></div><b>${analysis.activePersonas.length} engaged</b></header>
    <div class="impact-persona-grid">${analysis.activePersonas.length ? analysis.activePersonas.map((persona) => `<article class="impact-persona" data-tier="${escapeHtml(persona.tier)}"><span>${escapeHtml(persona.tier)} · ${escapeHtml(persona.matchedSignals.join(', '))}</span><strong>${escapeHtml(persona.name)}</strong><p>${escapeHtml(persona.engagementReason)}</p></article>`).join('') : '<p class="impact-empty-row">No installed persona matched the current signals.</p>'}</div>
    <div class="impact-card-grid">${analysis.impactAreas.length ? analysis.impactAreas.map((area) => `<article class="impact-card"><span>Inferred impact</span><strong>${escapeHtml(area.label)}</strong><p>Signals: ${escapeHtml(area.signals.join(', '))}</p><code>${escapeHtml(area.evidencePaths.join(' · '))}</code></article>`).join('') : '<article class="impact-card"><strong>No consequence inferred</strong><p>The bounded evidence did not match a configured consequence area. Human review remains authoritative.</p></article>'}${analysis.standards.map((standard) => `<article class="impact-card"><span>Applicable standard</span><strong>${escapeHtml(standard.standardId)}</strong><p>${escapeHtml(standard.ruleSummary || 'Associated with the affected repository evidence.')}</p><code>${escapeHtml(standard.sourcePath)}</code></article>`).join('')}</div>
  </section>` : '';
  const decided = analysis ? `<form id="impactConfirmForm" class="impact-band impact-decided" aria-labelledby="impactRoutesTitle">
    <header><span>Decided</span><div><h3 id="impactRoutesTitle">Route the right review</h3><p>Recommendations are evidence-linked. Change them only with a recorded reason.</p></div></header>
    <div class="impact-route-list">${analysis.reviewRoutes.map((route) => `<article class="impact-route"><div><strong>${escapeHtml(route.label)}</strong><p>${escapeHtml(route.reason)}</p><small>${escapeHtml(route.authorityBoundary)}</small></div><label><span>Decision</span><select data-impact-route="${escapeHtml(route.id)}" data-recommendation="${escapeHtml(route.recommendation)}">${impactRouteOptions(route)}</select></label><label><span>Override rationale</span><input data-impact-rationale="${escapeHtml(route.id)}" placeholder="Required only when changing the recommendation"></label></article>`).join('')}</div>
    <div class="impact-confirmation"><label><span>Assessed by</span><input name="assessor" required maxlength="160" autocomplete="name"></label><label class="impact-acknowledge"><input name="acknowledged" type="checkbox" required><span>I reviewed the observed evidence, coverage limits, inferred consequences, and every route.</span></label><button type="submit" class="primary-action">Record assessment</button></div>
    <p class="impact-boundary">Recording this assessment will not approve Build, security, compliance, release, or Manual QA.</p>
  </form>` : '';
  const history = workspace.assessments?.length ? `<section class="impact-history"><div class="section-heading"><div><span class="eyebrow">Recorded evidence</span><h3>Previous assessments</h3></div><b>${workspace.assessments.length}</b></div>${workspace.assessments.map((assessment) => `<article><div><strong>${escapeHtml(assessment.summary)}</strong><span>${escapeHtml(assessment.assessor)} · ${escapeHtml(timeAgo(assessment.assessedAt))}</span></div><code>${escapeHtml(assessment.assessmentId)}</code></article>`).join('')}</section>` : '';
  return `<div class="impact-workspace" aria-labelledby="impactTitle">
    <header class="impact-intro"><div><span class="eyebrow">Proposed change</span><h3 id="impactTitle">Who and what could this affect?</h3><p>Start with concrete repository evidence. The result advises; people decide.</p></div><span>Advisory assessment</span></header>
    <section class="impact-index ${index.fresh ? 'is-fresh' : 'is-stale'}" aria-live="polite"><div><i></i><strong>${index.fresh ? 'Repository map is fresh' : 'Repository map needs attention'}</strong><small>${statusCopy}</small></div><button type="button" data-impact-refresh ${state.impactLoading ? 'disabled' : ''}>Refresh repository map</button></section>
    ${sourceMapSection}
    <form id="impactAnalyseForm" class="impact-inputs">
      <label><span>What are you proposing to change?</span><textarea name="summary" required maxlength="2000" rows="4" placeholder="Describe behaviour and intent, not implementation instructions.">${escapeHtml(state.impactDraft.summary)}</textarea><small>Describe behaviour and intent, not implementation instructions.</small></label>
      <label><span>Files or symbols</span><textarea name="targets" required rows="4" placeholder="One repository-relative path or symbol per line.">${escapeHtml(state.impactDraft.targets)}</textarea><small>One repository-relative path or symbol per line.</small></label>
      <button type="submit" class="primary-action" ${!index.fresh || state.impactLoading ? 'disabled' : ''}>${state.impactLoading ? 'Analysing…' : 'Analyse impact'}</button>
    </form>
    ${state.impactError ? `<div class="impact-message is-error" role="alert"><strong>Impact assessment needs attention</strong><p>${escapeHtml(state.impactError)}</p></div>` : ''}
    ${state.impactNotice ? `<div class="impact-message" role="status"><p>${escapeHtml(state.impactNotice)}</p></div>` : ''}
    ${state.impactReceipt ? `<div class="impact-message is-success" role="status"><strong>Assessment recorded as immutable evidence</strong><p>${escapeHtml(state.impactReceipt.assessmentId)} · delivery approvals were not changed.</p></div>` : ''}
    ${observed}${inferred}${decided}${history}
  </div>`;
}

async function analyseImpact(form) {
  if (!state.selected) return;
  const values = Object.fromEntries(new FormData(form));
  state.impactDraft = { summary: String(values.summary ?? ''), targets: String(values.targets ?? '') };
  state.impactLoading = true;
  state.impactError = '';
  state.impactNotice = '';
  state.impactReceipt = null;
  state.testScenarioFilters = { status: 'all', route: 'all', tier: 'all' };
  state.impactAnalysis = null;
  renderDrawer();
  try {
    state.impactAnalysis = await api(`/api/work-items/${encodeURIComponent(state.selected.item.id)}/impact/preview`, {
      method: 'POST',
      body: JSON.stringify({
        summary: state.impactDraft.summary,
        targets: state.impactDraft.targets.split(/\r?\n/).map((target) => target.trim()).filter(Boolean)
      })
    });
    state.impactNotice = 'Analysis refreshed. Review observed evidence, inferred consequences, active perspectives, and every human route.';
  } catch (error) {
    state.impactError = error.message;
  } finally {
    state.impactLoading = false;
    renderDrawer();
  }
}

async function confirmImpact(form) {
  if (!state.selected || !state.impactAnalysis) return;
  const assessor = form.elements.assessor.value.trim();
  const acknowledged = form.elements.acknowledged.checked;
  const decisions = {};
  const rationales = {};
  form.querySelectorAll('[data-impact-route]').forEach((select) => { decisions[select.dataset.impactRoute] = select.value; });
  form.querySelectorAll('[data-impact-rationale]').forEach((input) => {
    if (input.value.trim()) rationales[input.dataset.impactRationale] = input.value.trim();
  });
  state.impactLoading = true;
  state.impactError = '';
  try {
    const response = await api(`/api/work-items/${encodeURIComponent(state.selected.item.id)}/impact/confirm`, {
      method: 'POST',
      body: JSON.stringify({
        summary: state.impactAnalysis.summary,
        targets: state.impactAnalysis.targets,
        indexRunId: state.impactAnalysis.index.runId,
        decisions,
        rationales,
        assessor,
        acknowledged
      })
    });
    state.impactReceipt = response;
    state.selected = await api(`/api/work-items/${encodeURIComponent(state.selected.item.id)}/viewer`);
    state.impactNotice = 'Assessment recorded. Repository evidence and delivery approvals remain separate.';
  } catch (error) {
    state.impactError = error.message;
  } finally {
    state.impactLoading = false;
    renderDrawer();
  }
}

async function refreshImpact() {
  if (!state.selected) return;
  state.impactLoading = true;
  state.impactError = '';
  state.impactNotice = 'Refreshing the project-local repository map…';
  renderDrawer();
  try {
    const response = await api(`/api/work-items/${encodeURIComponent(state.selected.item.id)}/impact/refresh`, {
      method: 'POST', body: JSON.stringify({ confirmed: true })
    });
    state.selected = response.view;
    state.impactAnalysis = null;
    state.impactReceipt = null;
    state.impactNotice = 'Repository map refreshed. Your proposed-change draft was preserved; analyse it again against the new run.';
  } catch (error) {
    state.impactError = error.message;
    state.impactNotice = '';
  } finally {
    state.impactLoading = false;
    renderDrawer();
  }
}

function updateImpactRationaleRequirement(select) {
  const input = select.closest('.impact-route')?.querySelector('[data-impact-rationale]');
  if (!input) return;
  const changed = select.value !== select.dataset.recommendation;
  input.required = changed;
  input.closest('label').classList.toggle('is-required', changed);
}

function phaseStatus(view, key) {
  const explicit = view.phases.find((phase) => phase.phaseKey === key)?.status;
  if (explicit) return explicit;
  if (view.item.lane === 'done' || view.item.currentPhase === 'done') return 'completed';
  if (view.item.currentPhase === key) return 'active';
  const current = deliveryPhases.findIndex(([phase]) => phase === view.item.currentPhase);
  const position = deliveryPhases.findIndex(([phase]) => phase === key);
  return current > position ? 'completed' : 'pending';
}

function renderProgress(view) {
  return `<div class="phase-list">${deliveryPhases.map(([key, label], index) => {
    const phase = view.phases.find((candidate) => candidate.phaseKey === key);
    const status = phaseStatus(view, key);
    return `<article class="phase-row phase-${escapeHtml(status)}">
      <span class="phase-number">${String(index + 1).padStart(2, '0')}</span>
      <i></i>
      <div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(phase?.notes || status)}</small></div>
      <b>${escapeHtml(status)}</b>
    </article>`;
  }).join('')}</div>`;
}

function renderMaterials(view) {
  const materials = [
    { kind: 'intent', title: 'Intent specification', path: view.intent?.path, status: 'source' },
    ...view.artefacts,
    ...view.phases.filter((phase) => phase.artefactPath).map((phase) => ({ kind: 'phase evidence', title: phase.phaseKey, path: phase.artefactPath, status: phase.status }))
  ].filter((material) => material.path);
  return materials.length ? `<div class="material-list">${materials.map((material) => `
    <article class="material-row"><span>${escapeHtml(material.kind)}</span><div><strong>${escapeHtml(material.title || material.path)}</strong><code>${escapeHtml(material.path)}</code></div><b>${escapeHtml(material.status || 'active')}</b></article>
  `).join('')}</div>` : '<div class="detail-empty"><strong>No linked materials yet.</strong><p>Plans, prototypes, decisions, evidence, and reports registered by the pipeline will appear here.</p></div>';
}

function renderPrototype(view) {
  const prototypes = view.artefacts.filter((artefact) => artefact.kind === 'prototype' && artefact.status === 'active');
  if (!prototypes.length) {
    return '<div class="detail-empty"><strong>No prototype linked yet.</strong><p>The Design phase will place HTML prototypes under this intent’s SPECS/6.Build folder and register the selected version here.</p></div>';
  }
  const selected = prototypes[0];
  const previewUrl = `/prototype/${encodeURIComponent(view.item.id)}/${selected.id}/`;
  return `
    <div class="prototype-view">
      <header>
        <div><span class="eyebrow">Selected prototype</span><h3>${escapeHtml(selected.title || 'HTML prototype')}</h3><code>${escapeHtml(selected.path)}</code></div>
        <a href="${previewUrl}" target="_blank" rel="noreferrer">Open full size</a>
      </header>
      <iframe src="${previewUrl}" title="${escapeHtml(selected.title || view.item.title)} prototype" sandbox="allow-scripts allow-forms"></iframe>
      ${prototypes.length > 1 ? `<div class="prototype-variants"><strong>Other registered variants</strong>${prototypes.slice(1).map((prototype) => `<span>${escapeHtml(prototype.title || prototype.path)}</span>`).join('')}</div>` : ''}
    </div>`;
}

function renderActivity(view) {
  return view.activity.events.length ? `<div class="activity-list">${view.activity.events.map((event) => `
    <article class="activity-row ${event.requiresHuman ? 'needs-human' : ''}">
      <i></i><div><header><strong>${escapeHtml(eventLabel(event.eventType))}</strong><span>${escapeHtml(timeAgo(event.createdAt))}</span></header><p>${escapeHtml(event.summary)}</p>${event.details ? `<pre>${escapeHtml(event.details)}</pre>` : ''}<small>${escapeHtml(event.tool || 'agent')} · ${escapeHtml(event.phaseKey || 'phase unrecorded')}</small></div>
    </article>
  `).join('')}</div>` : '<div class="detail-empty"><strong>No activity recorded.</strong><p>Material agent updates will build a live, reviewable history here.</p></div>';
}

function renderDrawer() {
  if (!state.selected) return;
  const renderers = {
    overview: renderOverview,
    personas: renderPersonas,
    impact: renderImpact,
    'test-scenarios': renderTestScenarios,
    intent: (view) => `<article class="markdown-body">${renderMarkdown(view.intent?.markdown || 'No intent Markdown is linked.')}</article>`,
    prototype: renderPrototype,
    progress: renderProgress,
    materials: renderMaterials,
    activity: renderActivity
  };
  element('drawerTabs').querySelectorAll('[data-tab]').forEach((button) => {
    const active = button.dataset.tab === state.selectedTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.setAttribute('tabindex', active ? '0' : '-1');
  });
  element('drawerContent').innerHTML = renderers[state.selectedTab](state.selected);
  if (state.selectedTab === 'overview') renderAutonomyIntentDetail(state.selected.item);
}

function activateDrawerTab(tab, { focus = false } = {}) {
  if (!tab?.dataset.tab) return;
  state.selectedTab = tab.dataset.tab;
  renderDrawer();
  if (focus) tab.focus();
}

async function openItem(reference) {
  const [viewResult, libraryResult] = await Promise.allSettled([
    api(`/api/work-items/${encodeURIComponent(reference)}/viewer`),
    api('/api/personas')
  ]);
  if (viewResult.status === 'rejected') throw viewResult.reason;
  state.selected = viewResult.value;
  state.impactDraft = { summary: '', targets: '' };
  state.impactAnalysis = null;
  state.impactError = '';
  state.impactNotice = '';
  state.impactReceipt = null;
  state.personas = libraryResult.status === 'fulfilled' ? libraryResult.value.personas : [];
  state.personaError = libraryResult.status === 'rejected' ? libraryResult.reason.message : null;
  element('drawerEyebrow').textContent = `${state.selected.item.domain} / ${state.selected.item.id}`;
  element('drawerTitle').textContent = state.selected.item.title;
  element('drawerMeta').textContent = `${state.selected.item.lane} · ${state.selected.item.currentPhase} · updated ${timeAgo(state.selected.item.updatedAt)}`;
  renderDrawer();
  if (!element('intentDialog').open) element('intentDialog').showModal();
  element('drawerContent').focus({ preventScroll: true });
}

function actionMaterials(view) {
  return [
    ...view.artefacts,
    ...view.phases.filter((phase) => phase.artefactPath).map((phase) => ({ title: phase.phaseKey, path: phase.artefactPath })),
  ].filter((material) => material.path);
}

function actionDefinition(action) {
  const title = state.selected?.item.title ?? 'this intent';
  if (action.kind === 'hook-retry') return {
    eyebrow: 'Lifecycle notification', title: 'Retry this delivery?', confirm: 'Retry notification',
    summary: `Offer the same event and idempotency identity to ${action.handlerName} again.`,
    body: '<div class="action-callout"><strong>The EWAI milestone will not run again.</strong><p>This appends one manual delivery attempt. Handler acknowledgement cannot approve Build, Manual QA, release, or any delivery phase.</p></div>',
  };
  if (action.kind === 'hook-disable') return {
    eyebrow: 'Lifecycle subscription', title: `Disable ${action.handlerName}?`, confirm: 'Disable future delivery',
    summary: 'Stop offering new matching milestones to this project subscription.',
    body: '<div class="action-callout danger"><strong>Historical events and attempts remain.</strong><p>Disabling the subscription does not change canonical SPECS, approvals, delivery state, or any milestone already recorded.</p></div>',
  };
  if (action.kind === 'guided-begin') return {
    eyebrow: 'Guided delivery', title: 'Work on this intent with EWAI', confirm: 'Queue for EWAI',
    summary: `Select “${title}” for your next EWAI conversation.`,
    body: `<div class="action-callout"><strong>No code starts from this click.</strong><p>EWAI will remember the intent. Return to your Claude, Codex, or Antigravity conversation and say “go”; the companion will confirm the context and begin the complete delivery harness.</p></div>`,
  };
  if (action.kind === 'guided-continue') return {
    eyebrow: 'Guided delivery', title: 'Continue with EWAI', confirm: 'Queue and continue',
    summary: `Return to the exact verified phase for “${title}”.`,
    body: `<div class="action-callout"><strong>State will be reconciled before work resumes.</strong><p>The companion will read the intent Markdown, intent JSON, delivery JSON, and SQLite projection. It will not enter Build without durable approval.</p></div>`,
  };
  if (action.kind === 'approve-build') {
    const materials = actionMaterials(state.selected);
    return {
      eyebrow: 'Human gate', title: 'Approve Build', confirm: 'Approve Build',
      summary: 'Confirm that the reviewed plan and test evidence describe what EWAI may implement.',
      body: `<div class="approval-evidence"><strong>${materials.length} linked delivery material${materials.length === 1 ? '' : 's'}</strong>
        <div>${materials.slice(0, 8).map((material) => `<span>${escapeHtml(material.title || material.path)}<small>${escapeHtml(material.path)}</small></span>`).join('') || '<p>No linked materials were projected.</p>'}</div></div>
        <label class="action-field"><span>Approved by</span><input name="approvedBy" required autocomplete="name" placeholder="Your name"></label>
        <label class="action-field"><span>Approved scope</span><textarea name="scope" rows="3" placeholder="What this approval allows EWAI to build">${escapeHtml(title)}</textarea></label>
        <p class="action-warning">Approval is written into the durable Build gate. It does not waive standards, tests, validation, Manual QA, or retrospective learning.</p>`,
    };
  }
  if (action.kind === 'enter-build') return {
    eyebrow: 'Build gate', title: 'Enter Build', confirm: 'Enter Build',
    summary: 'Move the approved delivery into Phase 9 without starting an agent yet.',
    body: `<div class="action-callout"><strong>The fourteen-stage harness remains in control.</strong><p>After this transition, choose a conversational Build or run AFK preflight. No task can execute unless its validated task graph says it is ready.</p></div>`,
  };
  if (action.kind === 'afk-start') return {
    eyebrow: 'Unattended Build', title: 'Prepare AFK Build', confirm: 'Start AFK Build',
    summary: 'Verify providers, repositories, branches and task safety before starting the local conductor.',
    body: renderAfkActionBody(action),
  };
  if (action.kind === 'cancel-handoff') return {
    eyebrow: 'EWAI handoff', title: 'Remove this intent from the queue?', confirm: 'Remove from queue',
    summary: 'This only clears the dashboard selection. It does not alter the intent or delivery state.',
    body: '<div class="action-callout"><strong>The project work remains unchanged.</strong><p>You can select this intent again whenever you are ready.</p></div>',
  };
  const verb = action.kind === 'afk-pause' ? 'Pause' : action.kind === 'afk-resume' ? 'Resume' : 'Cancel';
  return {
    eyebrow: 'AFK Build control', title: `${verb} this Build run?`, confirm: `${verb} Build`,
    summary: action.kind === 'afk-pause'
      ? 'The conductor will finish and integrate the active wave before leasing more work.'
      : action.kind === 'afk-resume'
        ? 'EWAI will revalidate the run and recover stale leases before continuing.'
        : 'Active workers will stop and the preserved run evidence will remain available for diagnosis.',
    body: `<div class="action-callout ${action.kind === 'afk-cancel' ? 'danger' : ''}"><strong>${action.kind === 'afk-cancel' ? 'Integrated work is not reverted.' : 'The conductor remains evidence-led.'}</strong><p>${action.kind === 'afk-cancel' ? 'Cancellation prevents more tasks from starting and abandons active leases safely.' : 'Task and branch state will be checked again before anything moves.'}</p></div>`,
  };
}

function renderAfkActionBody(action) {
  const preflight = action.preflight;
  const failures = preflight?.failures ?? [];
  const repositories = preflight?.topology?.repositories?.filter((repository) => repository.selected) ?? [];
  return `<div class="afk-options">
    <label class="action-field"><span>AI provider</span><select name="provider">
      ${['auto', 'claude', 'codex', 'antigravity'].map((provider) => `<option value="${provider}" ${action.provider === provider ? 'selected' : ''}>${provider === 'auto' ? 'Best available' : provider === 'antigravity' ? 'Antigravity' : provider[0].toUpperCase() + provider.slice(1)}</option>`).join('')}
    </select></label>
    <label class="action-field"><span>Maximum parallel tasks</span><input name="maxParallel" type="number" min="1" max="16" value="${escapeHtml(action.maxParallel)}"></label>
    <label class="action-field"><span>Task timeout</span><div class="field-suffix"><input name="timeoutMinutes" type="number" min="1" max="1440" value="${escapeHtml(action.timeoutMinutes)}"><span>minutes</span></div></label>
  </div>
  <div class="preflight-panel ${preflight?.status === 'ready' ? 'ready' : failures.length ? 'blocked' : ''}">
    ${!preflight ? '<strong>Checking the Build runway…</strong><p>Reviewing task evidence, branches, repositories and installed providers.</p>' : preflight.status === 'ready'
      ? `<strong>Ready for bounded execution</strong><p>${preflight.readyTasks.length} task${preflight.readyTasks.length === 1 ? '' : 's'} ready · ${preflight.providers.join(', ')} · ${repositories.length} repositor${repositories.length === 1 ? 'y' : 'ies'}.</p>`
      : `<strong>AFK cannot start yet</strong><ul>${failures.map((failure) => `<li>${escapeHtml(failure)}</li>`).join('')}</ul>`}
  </div>
  ${repositories.length ? `<div class="repository-runway">${repositories.map((repository) => `<span><strong>${escapeHtml(repository.name)}</strong><small>${escapeHtml(repository.parentBranch || repository.currentBranch || repository.root)}</small></span>`).join('')}</div>` : ''}`;
}

function renderActionDialog() {
  const action = state.pendingAction;
  if (!action) return;
  const definition = actionDefinition(action);
  element('actionEyebrow').textContent = definition.eyebrow;
  element('actionTitle').textContent = definition.title;
  element('actionSummary').textContent = definition.summary;
  element('actionBody').innerHTML = definition.body;
  element('confirmAction').textContent = definition.confirm;
  element('confirmAction').classList.toggle('danger', ['afk-cancel', 'cancel-handoff', 'hook-disable'].includes(action.kind));
  element('confirmAction').disabled = action.kind === 'afk-start' && action.preflight?.status !== 'ready';
  element('actionError').hidden = true;
}

async function refreshAfkPreflight() {
  const action = state.pendingAction;
  if (!action || action.kind !== 'afk-start') return;
  try {
    const query = new URLSearchParams({ provider: action.provider, parallel: String(action.maxParallel) });
    const response = await api(`/api/work-items/${encodeURIComponent(state.selected.item.id)}/afk/preflight?${query}`);
    if (state.pendingAction !== action) return;
    action.preflight = response.preflight;
    renderActionDialog();
  } catch (error) {
    if (state.pendingAction !== action) return;
    action.preflight = { status: 'blocked', failures: [error.message] };
    renderActionDialog();
  }
}

function openDashboardAction(button) {
  const kind = button.dataset.dashboardAction;
  state.pendingAction = {
    kind,
    runId: button.dataset.runId || '',
    handoffId: button.dataset.handoffId || '',
    deliveryId: button.dataset.deliveryId || '',
    subscriptionId: button.dataset.subscriptionId || '',
    handlerName: button.dataset.handlerName || 'this handler',
    provider: 'auto',
    maxParallel: Math.max(1, state.selected?.item.execution?.tasks?.maxParallelTasks ?? 1),
    timeoutMinutes: 45,
    preflight: null,
  };
  renderActionDialog();
  element('actionDialog').showModal();
  if (kind === 'afk-start') refreshAfkPreflight();
}

function closeDashboardAction() {
  state.pendingAction = null;
  element('actionDialog').close();
}

async function submitDashboardAction(form) {
  const action = state.pendingAction;
  if (!action) return;
  if (!action.kind.startsWith('hook-') && !state.selected) return;
  const values = Object.fromEntries(new FormData(form));
  const reference = state.selected ? encodeURIComponent(state.selected.item.id) : '';
  element('confirmAction').disabled = true;
  element('actionError').hidden = true;
  try {
    let response;
    if (action.kind === 'hook-retry') {
      response = await api(`/api/hooks/deliveries/${encodeURIComponent(action.deliveryId)}/retry`, {
        method: 'POST', body: JSON.stringify({ confirmed: true }),
      });
      state.hooksNotice = 'Retry queued against the existing event and idempotency identity.';
    } else if (action.kind === 'hook-disable') {
      response = await api(`/api/hooks/subscriptions/${encodeURIComponent(action.subscriptionId)}/disable`, {
        method: 'POST', body: JSON.stringify({ confirmed: true }),
      });
      state.hooksNotice = 'Future delivery disabled. Historical milestones and attempts remain unchanged.';
    } else if (action.kind === 'guided-begin' || action.kind === 'guided-continue') {
      response = await api(`/api/work-items/${reference}/handoff`, {
        method: 'POST', body: JSON.stringify({ confirmed: true, action: action.kind === 'guided-begin' ? 'begin' : 'continue' }),
      });
      state.actionNotice = { intentId: state.selected.item.id, message: 'Queued for EWAI. Return to your AI conversation and say “go”.' };
    } else if (action.kind === 'approve-build') {
      response = await api(`/api/work-items/${reference}/approve-build`, {
        method: 'POST', body: JSON.stringify({ confirmed: true, approvedBy: values.approvedBy, scope: values.scope }),
      });
      state.actionNotice = { intentId: state.selected.item.id, message: 'Build approval recorded in the durable gate.' };
    } else if (action.kind === 'enter-build') {
      response = await api(`/api/work-items/${reference}/enter-build`, { method: 'POST', body: JSON.stringify({ confirmed: true }) });
      state.actionNotice = { intentId: state.selected.item.id, message: 'The guarded harness has entered Build.' };
    } else if (action.kind === 'afk-start') {
      response = await api(`/api/work-items/${reference}/afk/start`, {
        method: 'POST', body: JSON.stringify({ confirmed: true, provider: action.provider, maxParallel: action.maxParallel, timeoutMinutes: action.timeoutMinutes }),
      });
      state.actionNotice = { intentId: state.selected.item.id, message: 'AFK Build started. Material progress will appear here and in Live work.' };
    } else if (action.kind === 'cancel-handoff') {
      response = await api(`/api/dashboard-handoffs/${encodeURIComponent(action.handoffId)}/cancel`, { method: 'POST', body: JSON.stringify({ confirmed: true }) });
      state.actionNotice = { intentId: state.selected.item.id, message: 'Dashboard handoff removed. Project delivery state was not changed.' };
    } else {
      const control = action.kind.replace('afk-', '');
      response = await api(`/api/afk/runs/${encodeURIComponent(action.runId)}/${control}`, { method: 'POST', body: JSON.stringify({ confirmed: true }) });
      state.actionNotice = {
        intentId: state.selected.item.id,
        message: control === 'pause' ? 'Safe pause requested.' : control === 'resume' ? 'AFK Build resumed.' : 'AFK Build cancelled.',
      };
    }
    closeDashboardAction();
    if (action.kind.startsWith('hook-')) {
      await loadHooks();
      return;
    }
    await refreshRuntime();
    if (response?.view) state.selected = response.view;
    if (state.selected) {
      state.selected = await api(`/api/work-items/${encodeURIComponent(state.selected.item.id)}/viewer`);
      renderDrawer();
    }
  } catch (error) {
    element('actionError').textContent = error.message;
    element('actionError').hidden = false;
    element('confirmAction').disabled = action.kind === 'afk-start' && action.preflight?.status !== 'ready';
  }
}

async function loadPersonaLibrary() {
  try {
    state.personas = (await api('/api/personas')).personas;
    state.personaError = null;
  } catch (error) {
    state.personaError = error.message;
  }
  renderDrawer();
}

async function queuePersonaMutation(personaRef, operation) {
  const previous = personaMutationQueues.get(personaRef) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  personaMutationQueues.set(personaRef, next);
  try {
    return await next;
  } finally {
    if (personaMutationQueues.get(personaRef) === next) personaMutationQueues.delete(personaRef);
  }
}

async function linkPersona(personaRef, role = state.personaRole, depth = state.personaDepth) {
  const intentId = state.selected.item.id;
  return queuePersonaMutation(personaRef, async () => {
    const response = await api(`/api/work-items/${encodeURIComponent(intentId)}/personas`, {
      method: 'POST',
      body: JSON.stringify({ personaRef, role, depth: Number(depth) })
    });
    if (state.selected?.item.id === intentId) {
      state.selected = response.view;
      state.pendingPersonaLink = null;
      renderDrawer();
    }
    return response;
  });
}

async function unlinkPersona(personaRef) {
  const intentId = state.selected.item.id;
  return queuePersonaMutation(personaRef, async () => {
    const response = await api(`/api/work-items/${encodeURIComponent(intentId)}/personas/${encodeURIComponent(personaRef)}`, {
      method: 'DELETE',
      body: JSON.stringify({})
    });
    if (state.selected?.item.id === intentId) {
      state.selected = response.view;
      renderDrawer();
    }
    return response;
  });
}

function guidedSection() {
  if (!state.guided) return null;
  return state.guided.questionnaire.sections.find((section) => section.id === state.guided.draft.currentSection) ?? null;
}

function guidedQuestions() {
  return guidedSection()?.questions ?? [];
}

function allGuidedQuestions() {
  return state.guided?.questionnaire.sections.flatMap((section) => section.questions) ?? [];
}

function guidedAnswerValue(question) {
  return valueAtPath(state.guided?.draft.answers, question.answerPath);
}

function formatGuidedAnswer(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(' · ') || 'Not answered';
  if (value && typeof value === 'object' && value.packId) {
    const pack = state.guided?.organisationBlueprints?.find((candidate) => candidate.id === value.packId);
    const optional = value.enabledModules?.length ? ` · optional: ${value.enabledModules.join(', ')}` : '';
    return `${pack?.name ?? value.packId}${optional}`;
  }
  return answered(value) ? String(value) : 'Not answered';
}

function renderGuidedPersonas() {
  const section = guidedSection();
  const personas = state.guided?.activePersonas ?? [];
  return `<section class="guided-personas" aria-labelledby="activePersonaTitle" aria-live="polite">
    <header>
      <div><span class="eyebrow">Active perspectives</span><h3 id="activePersonaTitle">Engaged for ${escapeHtml(section?.title ?? 'Discovery')}</h3><p>The ensemble changes as Discovery moves to a different concern.</p></div>
      <span class="guided-persona-status"><i aria-hidden="true"></i>${personas.length} active now</span>
    </header>
    <div class="guided-persona-list">
      ${personas.length ? personas.map((persona) => `<article class="guided-persona" data-tier="${escapeHtml(persona.tier)}">
        <div><span class="guided-persona-avatar" aria-hidden="true">${escapeHtml(persona.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase())}</span><p><strong>${escapeHtml(persona.name)}</strong><span>${escapeHtml(persona.tier)}</span></p></div>
        <p>${escapeHtml(persona.engagementReason)}</p>
      </article>`).join('') : '<p class="guided-no-personas">No installed persona positively matches this section yet. Human evidence remains the decision authority.</p>'}
    </div>
  </section>`;
}

function evidenceDepthWorkspace() {
  return state.guided?.evidenceDepth ?? null;
}

function evidenceDepthPersonaCard(persona) {
  return `<article class="evidence-depth-persona" data-tier="${escapeHtml(persona.tier)}"><strong>${escapeHtml(persona.name)}</strong><span>${escapeHtml(persona.tier)}</span><p>${escapeHtml(persona.engagementReason)}</p></article>`;
}

function renderEvidenceDepthPanel() {
  const workspace = evidenceDepthWorkspace();
  if (!workspace) return '';
  const busy = state.evidenceDepthLoading ? 'disabled' : '';
  const recovery = workspace.recovery;
  const sourceStatus = workspace.status === 'source-map-stale' || workspace.status === 'source-map-missing';
  if (!workspace.preparation) {
    return `<details class="evidence-depth-panel" ${workspace.status !== 'not-prepared' ? 'open' : ''}>
      <summary><span><b>Evidence depth</b><small>Seven-dimensional Archaeology and Discovery coverage</small></span><em data-status="${escapeHtml(workspace.status)}">${escapeHtml(workspace.status.replaceAll('-', ' '))}</em></summary>
      <div class="evidence-depth-empty">
        <div><span class="eyebrow">Reproducible investigation</span><h3>${sourceStatus ? 'Refresh repository evidence first' : 'Choose depth from evidence, not ticket count'}</h3><p>${sourceStatus ? 'The stored Source Map no longer matches the current repository. A new depth recommendation would not be reproducible.' : 'EWAI will prepare independent recommendations for architecture, data, security, product, delivery, governance and operations. Nothing is approved by preparing them.'}</p></div>
        ${recovery ? `<code>${escapeHtml(recovery.command)}</code>` : ''}
        ${sourceStatus ? '' : `<button type="button" class="secondary-action" data-evidence-depth-prepare ${busy}>Prepare evidence depth</button>`}
      </div>
      ${state.evidenceDepthNotice ? `<p class="evidence-depth-notice">${escapeHtml(state.evidenceDepthNotice)}</p>` : ''}
    </details>`;
  }
  const dimensions = workspace.preparation.dimensions;
  const gaps = workspace.preparation.gaps;
  const runs = workspace.runs ?? [];
  const comparison = state.evidenceDepthComparison;
  return `<details class="evidence-depth-panel" open>
    <summary><span><b>Evidence depth</b><small>${dimensions.length} dimensions · ${gaps.length} stable gaps · ${runs.length} reviewed runs</small></span><em data-status="${escapeHtml(workspace.status)}">${escapeHtml(workspace.status.replaceAll('-', ' '))}</em></summary>
    <div class="evidence-depth-design-notice"><strong>Default fallback visual system</strong><span>Not organisation-approved. Apply an approved Design System Pack when one is available.</span></div>
    ${state.evidenceDepthNotice ? `<p class="evidence-depth-notice">${escapeHtml(state.evidenceDepthNotice)}</p>` : ''}
    <form id="evidenceDepthReview" class="evidence-depth-review">
      <header><div><span class="eyebrow">Named depth review</span><h3>Review each concern independently</h3></div><label><span>Reviewed by</span><input name="reviewedBy" maxlength="120" autocomplete="name" placeholder="Named accountable owner" required></label></header>
      <div class="evidence-depth-ledger" role="table" aria-label="Evidence depth recommendations">
        <div class="evidence-depth-ledger-head" role="row"><span role="columnheader">Concern</span><span role="columnheader">Coverage</span><span role="columnheader">Recommendation</span><span role="columnheader">Owner selection</span></div>
        ${dimensions.map((dimension) => {
          const engagement = workspace.personasByDimension?.[dimension.id];
          return `<section class="evidence-depth-row" role="row" data-dimension="${escapeHtml(dimension.id)}">
            <div role="cell"><strong>${escapeHtml(dimension.id)}</strong><small>${escapeHtml(dimension.drivers.join(' · '))}</small></div>
            <div role="cell"><b data-coverage="${escapeHtml(dimension.coverage.status)}">${escapeHtml(dimension.coverage.status.replaceAll('-', ' '))}</b><small>${dimension.coverage.supported}/${dimension.coverage.required} supported · ${dimension.coverage.failed} failed</small></div>
            <div role="cell"><span class="evidence-depth-level">${escapeHtml(dimension.recommendedDepth)}</span><small>${dimension.evidenceRefs.length} bounded evidence references</small></div>
            <div role="cell"><label><span class="sr-only">Selected ${escapeHtml(dimension.id)} depth</span><select name="depth:${escapeHtml(dimension.id)}" data-depth-dimension="${escapeHtml(dimension.id)}">${['bounded', 'standard', 'deep'].map((level) => `<option value="${level}" ${level === dimension.recommendedDepth ? 'selected' : ''}>${level}</option>`).join('')}</select></label><label><span class="sr-only">Rationale for ${escapeHtml(dimension.id)} depth</span><input name="rationale:${escapeHtml(dimension.id)}" maxlength="500" placeholder="Rationale if reducing depth"></label></div>
            <div class="evidence-depth-row-personas" role="cell"><span>Active for this concern</span>${(engagement?.activePersonas ?? []).map((persona) => `<b data-tier="${escapeHtml(persona.tier)}">${escapeHtml(persona.name)} · ${escapeHtml(persona.tier)}</b>`).join('') || '<small>No specialist persona matched; the standard model remains available.</small>'}</div>
          </section>`;
        }).join('')}
      </div>
      <section class="evidence-depth-gaps"><header><div><span class="eyebrow">Stable gaps</span><h3>Group after the gaps are known</h3></div><label><span>Grouping strategy</span><input name="groupingStrategy" maxlength="200" value="${escapeHtml(workspace.preparation.proposedGroupingStrategy)}" required></label></header>
        ${gaps.length ? gaps.map((gap) => `<article><div><strong>${escapeHtml(gap.id)}</strong><span>${escapeHtml(gap.dimension)} · ${escapeHtml(gap.condition)}</span><small>${escapeHtml(gap.contradiction)}</small></div><label><span>Group</span><input name="group:${escapeHtml(gap.id)}" maxlength="200" value="${escapeHtml(`${gap.dimension}-evidence`)}" required></label><label><span>Disposition</span><select name="disposition:${escapeHtml(gap.id)}">${['owned', 'shared', 'deferred', 'excluded'].map((value) => `<option value="${value}">${value}</option>`).join('')}</select></label></article>`).join('') : '<p>No open stable gaps were produced by this preparation.</p>'}
      </section>
      <section class="evidence-depth-questions"><span class="eyebrow">Adaptive questions</span><h3>Why EWAI would investigate further</h3>${workspace.questions.map((question) => `<article><div><strong>${escapeHtml(question.dimension)}</strong><p>${escapeHtml(question.prompt)}</p><small>${escapeHtml(question.reasonCode)} · ${escapeHtml(question.resolutionRoute)}</small></div><aside>${question.activePersonas.map(evidenceDepthPersonaCard).join('') || '<p>Standard model baseline</p>'}</aside></article>`).join('') || '<p>No additional owner questions are currently required.</p>'}</section>
      <footer><p>Recording creates immutable evidence only. It does not approve Build, Manual QA, deployment or release.</p><div><button type="button" class="secondary-action" data-evidence-depth-prepare ${busy}>Refresh recommendation</button><button type="submit" class="primary-action" ${busy}>Record named review</button></div></footer>
    </form>
    ${runs.length >= 2 ? `<form id="evidenceDepthCompare" class="evidence-depth-compare"><header><div><span class="eyebrow">Run comparison</span><h3>Explain changed depth before changed output</h3></div><div><label><span>Earlier run</span><select name="leftRunId">${runs.map((run, index) => `<option value="${escapeHtml(run.runId)}" ${index === 1 ? 'selected' : ''}>${escapeHtml(run.runId)} · ${escapeHtml(run.reviewedBy)}</option>`).join('')}</select></label><label><span>Later run</span><select name="rightRunId">${runs.map((run, index) => `<option value="${escapeHtml(run.runId)}" ${index === 0 ? 'selected' : ''}>${escapeHtml(run.runId)} · ${escapeHtml(run.reviewedBy)}</option>`).join('')}</select></label><button type="submit" class="secondary-action" ${busy}>Compare</button></div></header>${comparison ? `<div class="evidence-depth-comparison" data-reproducible="${comparison.reproducible}"><strong>${comparison.reproducible ? 'Reproducible comparison' : 'Unexplained variance remains'}</strong>${comparison.order.map((field) => `<span><b>${escapeHtml(field)}</b>${escapeHtml(comparison.changes[field].status)}</span>`).join('')}</div>` : ''}</form>` : ''}
  </details>`;
}

async function prepareEvidenceDepthFromBrowser() {
  state.evidenceDepthLoading = true;
  state.evidenceDepthNotice = '';
  renderGuided();
  try {
    const section = guidedSection();
    state.guided.evidenceDepth = await api('/api/evidence-depth/prepare', {
      method: 'POST', body: JSON.stringify({ focus: section?.title ?? 'project discovery' }),
    });
    state.evidenceDepthNotice = 'Prepared from the current fresh Source Map. Recommendations remain advisory until named review.';
  } catch (error) { state.evidenceDepthNotice = error.message; }
  finally { state.evidenceDepthLoading = false; renderGuided(); }
}

async function recordEvidenceDepthFromBrowser(form) {
  const workspace = evidenceDepthWorkspace();
  if (!workspace?.preparation) return;
  const values = new FormData(form);
  const input = {
    schema: 'ewai.evidence-depth-review/v1',
    expectedPreparationDigest: workspace.preparation.preparationDigest,
    reviewedBy: String(values.get('reviewedBy') ?? '').trim(),
    dimensions: workspace.preparation.dimensions.map(({ id }) => ({ id, selectedDepth: String(values.get(`depth:${id}`) ?? ''), rationale: String(values.get(`rationale:${id}`) ?? '').trim() })),
    grouping: {
      strategy: String(values.get('groupingStrategy') ?? '').trim(),
      assignments: workspace.preparation.gaps.map(({ id }) => ({ gapId: id, groupId: String(values.get(`group:${id}`) ?? '').trim(), disposition: String(values.get(`disposition:${id}`) ?? '') })),
    },
  };
  state.evidenceDepthLoading = true;
  state.evidenceDepthNotice = '';
  renderGuided();
  try {
    const receipt = await api('/api/evidence-depth/record', { method: 'POST', body: JSON.stringify(input) });
    state.guided.evidenceDepth = await api('/api/evidence-depth');
    state.evidenceDepthNotice = `Reviewed run ${receipt.runId} recorded as immutable evidence.`;
  } catch (error) { state.evidenceDepthNotice = error.message; }
  finally { state.evidenceDepthLoading = false; renderGuided(); }
}

async function compareEvidenceDepthFromBrowser(form) {
  const values = Object.fromEntries(new FormData(form));
  state.evidenceDepthLoading = true;
  state.evidenceDepthNotice = '';
  try {
    state.evidenceDepthComparison = await api('/api/evidence-depth/compare', { method: 'POST', body: JSON.stringify(values) });
  } catch (error) { state.evidenceDepthNotice = error.message; }
  finally { state.evidenceDepthLoading = false; renderGuided(); }
}

function renderGuidedField(question) {
  const value = guidedAnswerValue(question);
  const describedBy = `${question.id}-help`;
  if (question.type === 'organisation-blueprint') {
    const catalogue = state.guided?.organisationBlueprints ?? [];
    const selected = catalogue.find((pack) => pack.id === value?.packId);
    const enabledModules = new Set(value?.enabledModules ?? []);
    const selectedModules = selected?.modules.filter((module) => module.required || enabledModules.has(module.id)) ?? [];
    const localCounts = selectedModules.reduce((counts, module) => ({
      standards: counts.standards + module.counts.standards,
      personas: counts.personas + module.counts.personas,
      boilerplates: counts.boilerplates + module.counts.boilerplates
    }), { standards: 0, personas: 0, boilerplates: 0 });
    const previewSelection = state.guided?.preview?.organisationBlueprint;
    const counts = previewSelection && previewSelection.root.id === selected?.id ? previewSelection.counts : localCounts;
    return `<div class="guided-blueprint-picker">
      <select id="${escapeHtml(question.id)}" data-guided-path="${escapeHtml(question.answerPath)}" data-guided-type="organisation-blueprint" aria-describedby="${describedBy}">
        <option value="">Do not apply an organisation blueprint</option>
        ${catalogue.map((pack) => `<option value="${escapeHtml(pack.id)}" ${selected?.id === pack.id ? 'selected' : ''} ${pack.compatible ? '' : 'disabled'}>${escapeHtml(pack.name)} · ${escapeHtml(pack.publisher.name)}${pack.compatible ? '' : ' · incompatible'}</option>`).join('')}
      </select>
      ${!catalogue.length ? '<div class="guided-blueprint-empty"><strong>No organisation blueprints are installed.</strong><p>Add a reviewed local pack to the bundled, personal, or project pack directory to make it available here.</p></div>' : ''}
      ${catalogue.some((pack) => !pack.compatible) ? `<div class="guided-blueprint-unavailable"><strong>Unavailable with this EWAI version</strong>${catalogue.filter((pack) => !pack.compatible).map((pack) => `<p><code>${escapeHtml(pack.id)}</code> — ${escapeHtml(pack.compatibilityReason)}</p>`).join('')}</div>` : ''}
      ${selected ? `<section class="guided-blueprint-summary">
        <header><div><span class="eyebrow">${escapeHtml(selected.sourceClass)} pack · ${escapeHtml(selected.publisher.name)} · v${escapeHtml(selected.version)}</span><h4>${escapeHtml(selected.name)}</h4><p>${escapeHtml(selected.description)}</p><code>${escapeHtml(selected.id)}</code><code>${escapeHtml(selected.digest)}</code></div><span class="guided-blueprint-compatible ${selected.compatible ? '' : 'unavailable'}">${selected.compatible ? 'Compatible' : 'Unavailable'}</span></header>
        ${selected.compatible ? '' : `<p class="guided-blueprint-incompatible">${escapeHtml(selected.compatibilityReason)} Change the selection before approval.</p>`}
        ${selected.requires.length ? `<p class="guided-blueprint-dependencies"><strong>Required packs:</strong> ${selected.requires.map((id) => `<code>${escapeHtml(id)}</code>`).join(', ')}</p>` : ''}
        <div class="guided-blueprint-modules">
          ${selected.modules.map((module) => `<label class="guided-blueprint-module ${module.required ? 'required' : ''}">
            <input type="checkbox" data-blueprint-module="${escapeHtml(module.id)}" ${module.required || enabledModules.has(module.id) ? 'checked' : ''} ${module.required || !selected.compatible ? 'disabled' : ''}>
            <span><strong>${escapeHtml(module.name)}</strong><small>${module.required ? 'Required' : 'Optional'} · ${module.counts.standards} standards · ${module.counts.personas} personas · ${module.counts.boilerplates} starter receipts</small><p>${escapeHtml(module.description)}</p></span>
          </label>`).join('')}
        </div>
        <div class="guided-blueprint-impact" aria-live="polite">
          <span><strong>${counts.standards}</strong> standards</span><span><strong>${counts.personas}</strong> project personas</span><span><strong>${counts.boilerplates}</strong> starter receipts</span>
        </div>
        <p class="guided-blueprint-boundary">Preview only. Nothing is copied, fetched, executed, or added to the active persona ensemble until named approval.</p>
      </section>` : ''}
    </div>`;
  }
  if (question.type === 'select') {
    return `<select id="${escapeHtml(question.id)}" data-guided-path="${escapeHtml(question.answerPath)}" data-guided-type="select" aria-describedby="${describedBy}">
      <option value="">Choose an answer</option>
      ${(question.options ?? []).map((option) => `<option value="${escapeHtml(option)}" ${value === option ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
    </select>`;
  }
  if (question.type === 'list') {
    return `<textarea id="${escapeHtml(question.id)}" data-guided-path="${escapeHtml(question.answerPath)}" data-guided-type="list" aria-describedby="${describedBy}" rows="7">${escapeHtml(Array.isArray(value) ? value.join('\n') : value ?? '')}</textarea>`;
  }
  if (question.type === 'textarea') {
    return `<textarea id="${escapeHtml(question.id)}" data-guided-path="${escapeHtml(question.answerPath)}" data-guided-type="textarea" aria-describedby="${describedBy}" rows="7">${escapeHtml(value ?? '')}</textarea>`;
  }
  return `<input id="${escapeHtml(question.id)}" data-guided-path="${escapeHtml(question.answerPath)}" data-guided-type="text" aria-describedby="${describedBy}" type="text" value="${escapeHtml(value ?? '')}">`;
}

function renderGuidedBlueprintReview() {
  const selection = state.guided?.preview?.organisationBlueprint;
  if (!selection) return '';
  const references = selection.modules.flatMap((module) => module.boilerplates.map((reference) => ({ ...reference, module })));
  return `<section class="guided-review-section guided-blueprint-review">
    <h4>Organisation blueprint receipt</h4>
    <div><span>Root</span><p><strong>${escapeHtml(selection.root.name)}</strong><br><code>${escapeHtml(selection.root.id)}</code> · v${escapeHtml(selection.root.version)} · ${escapeHtml(selection.root.sourceClass)}<br><code>${escapeHtml(selection.digest)}</code></p></div>
    <div><span>Resolved packs</span><p>${selection.packs.map((pack) => `<strong>${escapeHtml(pack.id)}</strong> v${escapeHtml(pack.version)}<br><code>${escapeHtml(pack.digest)}</code>`).join('<br>')}</p></div>
    <div><span>Applied modules</span><p>${selection.modules.map((module) => `${escapeHtml(module.name)} <small>${module.required ? 'required' : 'optional'} · ${escapeHtml(module.packId)}</small>`).join('<br>')}</p></div>
    <div><span>Consequences</span><p>${selection.counts.standards} standards · ${selection.counts.personas} project personas · ${selection.counts.boilerplates} starter receipts</p></div>
    <div><span>Governed Starter Packs</span><p>${references.length ? references.map((reference) => `<strong>${escapeHtml(reference.name)}</strong> — ${escapeHtml(reference.source)} at ${escapeHtml(reference.version)} · ${escapeHtml(reference.licence)} · ${escapeHtml(reference.compatibility)}`).join('<br>') : 'No starter receipts are included.'}<br><small>Discovery records receipts only and does not fetch, clone, scaffold, execute or deploy them. Later materialisation is a separate guarded workflow with a trusted adapter, immutable preview and named approval.</small></p></div>
  </section>`;
}

function renderGuidedQuestion(section, question) {
  const validationError = state.guided.validation.errors.find((error) => error.path === question.answerPath)
    ?? (question.type === 'organisation-blueprint'
      ? state.guided.validation.errors.find((error) => /organisation blueprint/i.test(error.message))
      : null);
  return `${renderGuidedPersonas()}
    ${renderEvidenceDepthPanel()}
    ${state.guidedError ? `<div class="guided-error" role="alert"><strong>We could not save that change</strong><p>${escapeHtml(state.guidedError)}</p></div>` : ''}
    <article class="guided-question-card">
      <div class="guided-question-number">${question.required ? 'Required question' : 'Discovery question'}</div>
      <h3>${escapeHtml(question.prompt)}</h3>
      <p>${escapeHtml(question.help)}</p>
      <div class="guided-answer-grid">
        <div class="guided-answer-field ${validationError ? 'has-error' : ''}">
          <label for="${escapeHtml(question.id)}">${escapeHtml(question.label)}${question.required ? '<span>Required</span>' : ''}</label>
          ${renderGuidedField(question)}
          <small id="${escapeHtml(question.id)}-help">${question.type === 'list' ? 'Add one answer per line.' : 'Your answer remains editable until final approval.'}</small>
          ${validationError ? `<p class="guided-field-error">${escapeHtml(validationError.message)}</p>` : ''}
        </div>
        <aside class="guided-evidence-margin">
          <h4>Why EWAI asks this</h4>
          <p>${escapeHtml(question.help)}</p>
          <span class="eyebrow">Project record</span>
          <code>${escapeHtml(question.answerPath)}</code>
          <strong>Advisory lenses</strong>
          <p>${escapeHtml(state.guided.guidance.prompts.map((prompt) => prompt.text).join(' '))}</p>
        </aside>
      </div>
    </article>`;
}

function renderGuidedReview() {
  const answers = state.guided.draft.answers;
  const preview = state.guided.preview;
  const answerSections = state.guided.questionnaire.sections.filter((section) => section.questions.length);
  return `${renderGuidedPersonas()}
    ${renderEvidenceDepthPanel()}
    ${state.guidedError ? `<div class="guided-error" role="alert"><strong>Approval has not happened</strong><p>${escapeHtml(state.guidedError)}</p></div>` : ''}
    <article class="guided-review">
      <span class="guided-question-number">Review before approval</span>
      <h3>Check the project story and the records EWAI will create.</h3>
      <p>Persona observations are advisory. Your evidence and the named accountable approval remain authoritative.</p>
      ${answerSections.map((section) => `<section class="guided-review-section">
        <h4>${escapeHtml(section.title)}</h4>
        ${section.questions.map((question) => `<div><span>${escapeHtml(question.label)}</span><p>${escapeHtml(formatGuidedAnswer(valueAtPath(answers, question.answerPath)))}</p></div>`).join('')}
      </section>`).join('')}
      ${renderGuidedBlueprintReview()}
      <section class="guided-review-section guided-destinations">
        <h4>Canonical destinations</h4>
        ${preview ? preview.outputs.map((output) => `<div><code>${escapeHtml(`SPECS/${output.relative}`)}</code><span>${output.exists ? 'Already exists' : 'Will be created'}</span></div>`).join('') : '<p>Complete the required answers to generate the exact destination preview.</p>'}
      </section>
      ${preview?.conflicts.length ? `<div class="guided-error" role="alert"><strong>Existing project discovery is protected</strong><p>${escapeHtml(preview.conflicts.join(', '))}</p></div>` : ''}
      <section class="guided-approval-panel" aria-labelledby="guidedApprovalTitle">
        <span class="eyebrow">Accountable decision</span>
        <h4 id="guidedApprovalTitle">Approve these records as project discovery</h4>
        <p>This action revalidates the current revision on the server. It cannot overwrite existing Discovery outputs.</p>
        <label><span>Approver name</span><input id="guidedApprover" type="text" autocomplete="name" placeholder="Name of accountable approver"></label>
        <label class="guided-confirm"><input id="guidedConfirmed" type="checkbox"><span>I have reviewed the answers, advisory persona lenses, warnings, and exact destinations.</span></label>
        <button type="button" class="primary-action" data-guided-approve disabled>Approve and create project records</button>
      </section>
    </article>`;
}

function updateGuidedApprovalState() {
  const button = document.querySelector('[data-guided-approve]');
  if (!button) return;
  const hasConflicts = Boolean(state.guided?.preview?.conflicts?.length);
  const approvedBy = element('guidedApprover')?.value.trim() ?? '';
  const confirmed = Boolean(element('guidedConfirmed')?.checked);
  button.disabled = state.guidedLoading || !state.guided?.validation.valid || hasConflicts || !approvedBy || !confirmed;
}

function renderGuidedOutline() {
  const answers = state.guided?.draft.answers ?? {};
  const sections = state.guided?.questionnaire.sections.filter((section) => section.questions.length) ?? [];
  element('guidedOutlineContent').innerHTML = `<div class="guided-thesis"><span class="eyebrow">In one sentence</span><blockquote>${escapeHtml(valueAtPath(answers, 'project.oneSentence') || valueAtPath(answers, 'project.purpose') || 'Your project thesis will take shape here.')}</blockquote></div>
    ${sections.map((section) => {
      const completed = section.questions.filter((question) => answered(valueAtPath(answers, question.answerPath))).length;
      return `<section class="guided-outline-section"><header><h3>${escapeHtml(section.title)}</h3><span>${completed}/${section.questions.length}</span></header><p>${escapeHtml(section.questions.filter((question) => answered(valueAtPath(answers, question.answerPath))).slice(0, 2).map((question) => formatGuidedAnswer(valueAtPath(answers, question.answerPath))).join(' · ') || 'Not started')}</p></section>`;
    }).join('')}
    <div class="guided-review-note"><strong>Approval comes last</strong>Review names the approver and shows the exact records before anything becomes canonical.</div>`;
}

function renderGuidedSections() {
  const sections = state.guided.questionnaire.sections;
  const answers = state.guided.draft.answers;
  element('guidedSections').innerHTML = sections.map((section, index) => {
    const completed = section.questions.filter((question) => answered(valueAtPath(answers, question.answerPath))).length;
    const active = section.id === state.guided.draft.currentSection;
    const done = section.questions.length ? completed === section.questions.length : state.guided.validation.valid;
    return `<button type="button" class="guided-section ${active ? 'active' : ''} ${done ? 'done' : ''}" data-guided-section="${escapeHtml(section.id)}" ${active ? 'aria-current="step"' : ''}>
      <b>${done ? '✓' : index + 1}</b><span><strong>${escapeHtml(section.title)}</strong><small>${section.questions.length ? `${completed} of ${section.questions.length} answered` : 'Preview and approve'}</small></span><em>${active ? '›' : ''}</em>
    </button>`;
  }).join('');
}

function renderGuided() {
  const content = element('guidedContent');
  if (state.guidedLoading) {
    content.innerHTML = '<div class="guided-empty"><strong>Preparing Discovery</strong><p>Loading the shared questionnaire and relevant perspectives.</p></div>';
    element('guidedActions').hidden = true;
    return;
  }
  if (state.guidedCompleted) {
    const acceptedBlueprint = state.guidedCompleted.organisationBlueprint;
    content.innerHTML = `<div class="guided-completed"><i aria-hidden="true">✓</i><span class="eyebrow">Project discovery created</span><h3>${escapeHtml(state.guidedCompleted.approval.approvedBy)} approved revision ${state.guidedCompleted.approval.revision}.</h3><p>The reviewed project records${acceptedBlueprint ? `, ${acceptedBlueprint.counts.standards} organisation standards, and ${acceptedBlueprint.counts.personas} project personas` : ''} are now canonical SPECS and available in the Mind Palace.</p>${acceptedBlueprint ? `<div class="guided-accepted-blueprint"><strong>${escapeHtml(acceptedBlueprint.root.name)}</strong><code>${escapeHtml(acceptedBlueprint.digest)}</code><span>Accepted read-only receipt</span></div>` : ''}<button type="button" class="primary-action" data-view="knowledge">Open project knowledge</button></div>`;
    element('guidedActions').hidden = true;
    element('guidedSections').innerHTML = '';
    element('guidedOutlineContent').innerHTML = '';
    element('guidedTitle').textContent = 'Discovery complete';
    element('guidedSubtitle').textContent = 'The approved project records are now available to people and agents.';
    element('guidedStepCount').textContent = '';
    element('guidedProgressBar').value = 100;
    return;
  }
  if (!state.guided) {
    content.innerHTML = `<div class="guided-error" role="alert"><strong>Guided Setup is unavailable</strong><p>${escapeHtml(state.guidedError || 'The local Discovery contract could not be loaded.')}</p><button type="button" class="secondary-action" data-guided-retry>Try again</button></div>`;
    element('guidedActions').hidden = true;
    return;
  }

  const section = guidedSection();
  const questions = guidedQuestions();
  state.guidedQuestionIndex = Math.max(0, Math.min(state.guidedQuestionIndex, Math.max(0, questions.length - 1)));
  const question = questions[state.guidedQuestionIndex];
  const allQuestions = allGuidedQuestions();
  const completed = allQuestions.filter((candidate) => answered(guidedAnswerValue(candidate))).length;
  const globalIndex = question ? allQuestions.findIndex((candidate) => candidate.id === question.id) + 1 : allQuestions.length;
  element('guidedEyebrow').textContent = section.title;
  element('guidedTitle').textContent = section.description;
  element('guidedSubtitle').textContent = 'Answers are saved project-locally and can be edited until named approval.';
  element('guidedStepCount').textContent = question ? `${String(globalIndex).padStart(2, '0')} / ${String(allQuestions.length).padStart(2, '0')}` : 'Review';
  element('guidedProgressBar').value = Math.round((completed / Math.max(1, allQuestions.length)) * 100);
  content.innerHTML = section.id === 'review' ? renderGuidedReview() : renderGuidedQuestion(section, question);
  element('guidedActions').hidden = false;
  element('guidedSaveState').textContent = state.guidedSaveState;
  const back = element('guidedActions').querySelector('[data-guided-back]');
  const next = element('guidedActions').querySelector('[data-guided-next]');
  const firstSection = state.guided.questionnaire.sections[0];
  back.disabled = section.id === firstSection.id && state.guidedQuestionIndex === 0;
  next.hidden = section.id === 'review';
  next.disabled = state.guidedLoading;
  renderGuidedSections();
  renderGuidedOutline();
  updateGuidedApprovalState();
}

async function loadGuidedDiscovery() {
  state.guidedLoading = true;
  state.guidedError = '';
  renderGuided();
  try {
    state.guided = await api('/api/guided-discovery');
    state.guidedQuestionIndex = 0;
    state.guidedSaveState = state.guided.draft.revision ? `Draft revision ${state.guided.draft.revision}` : 'Project-local draft';
  } catch (error) {
    state.guided = null;
    state.guidedError = error.message;
  } finally {
    state.guidedLoading = false;
    renderGuided();
  }
}

async function saveGuidedLocation(sectionId, questionIndex = 0) {
  if (!state.guided || state.guidedLoading) return;
  state.guidedLoading = true;
  state.guidedError = '';
  state.guidedSaveState = 'Saving…';
  renderGuided();
  try {
    state.guided = await api('/api/guided-discovery/draft', {
      method: 'PUT',
      body: JSON.stringify({
        expectedRevision: state.guided.draft.revision,
        currentSection: sectionId,
        answers: state.guided.draft.answers
      })
    });
    state.guidedQuestionIndex = questionIndex;
    state.guidedSaveState = `Draft revision ${state.guided.draft.revision} saved just now`;
  } catch (error) {
    state.guidedError = error.message;
    state.guidedSaveState = error.status === 409 ? 'Newer draft protected' : 'Draft not saved';
  } finally {
    state.guidedLoading = false;
    renderGuided();
  }
}

function adjacentGuidedLocation(direction) {
  const sections = state.guided.questionnaire.sections;
  const sectionIndex = sections.findIndex((section) => section.id === state.guided.draft.currentSection);
  const questions = guidedQuestions();
  const nextQuestion = state.guidedQuestionIndex + direction;
  if (nextQuestion >= 0 && nextQuestion < questions.length) return { sectionId: sections[sectionIndex].id, questionIndex: nextQuestion };
  const nextSection = sections[sectionIndex + direction];
  if (!nextSection) return { sectionId: sections[sectionIndex].id, questionIndex: state.guidedQuestionIndex };
  return { sectionId: nextSection.id, questionIndex: direction > 0 ? 0 : Math.max(0, nextSection.questions.length - 1) };
}

function updateGuidedAnswer(control) {
  if (!state.guided || !control.dataset.guidedPath) return;
  const current = valueAtPath(state.guided.draft.answers, control.dataset.guidedPath);
  const value = control.dataset.guidedType === 'list'
    ? control.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
    : control.dataset.guidedType === 'organisation-blueprint'
      ? (control.value ? { packId: control.value, enabledModules: current?.packId === control.value ? current.enabledModules ?? [] : [] } : null)
      : control.value;
  setValueAtPath(state.guided.draft.answers, control.dataset.guidedPath, value);
  state.guidedSaveState = 'Unsaved changes';
  if (control.dataset.guidedType === 'organisation-blueprint') {
    renderGuided();
    return;
  }
  renderGuidedOutline();
  renderGuidedSections();
  element('guidedSaveState').textContent = state.guidedSaveState;
}

async function approveGuidedFromBrowser() {
  const approvedBy = element('guidedApprover')?.value ?? '';
  const confirmed = Boolean(element('guidedConfirmed')?.checked);
  state.guidedLoading = true;
  state.guidedError = '';
  renderGuided();
  try {
    state.guidedCompleted = await api('/api/guided-discovery/approve', {
      method: 'POST',
      body: JSON.stringify({ expectedRevision: state.guided.draft.revision, approvedBy, confirmed })
    });
    state.guided = null;
    await loadBoard();
  } catch (error) {
    state.guidedError = error.message;
  } finally {
    state.guidedLoading = false;
    renderGuided();
  }
}

function phaseStudioOwnerKey(context) {
  return context === 'shared-review' ? 'sharedReview' : context;
}

function phaseStudioDeliveries() {
  return state.items.filter((item) => item.currentPhase && item.currentPhase !== 'backlog' && item.state !== 'completed');
}

function prototypeReviewDelivery() {
  return phaseStudioDeliveries().find((item) => item.id === state.phaseStudioReference) ?? null;
}

function prototypeReviewOperation() {
  const workspace = state.prototypeReview;
  if (!workspace) return state.prototypeReviewStage === 'plan' ? 'plan-prepare' : 'cycle-prepare';
  if (state.prototypeReviewStage === 'plan') {
    const prepared = workspace.planPreparation;
    const recorded = prepared && workspace.planReviews.some((review) => review.preparationDigest === prepared.preparationDigest);
    return prepared && !recorded ? 'plan-record' : 'plan-prepare';
  }
  const prepared = workspace.cyclePreparations.at(-1);
  const recorded = prepared && workspace.cycleReviews.some((review) => review.preparationDigest === prepared.preparationDigest);
  return prepared && !recorded ? 'cycle-record' : 'cycle-prepare';
}

function prototypeReviewPersonaCard(persona) {
  return `<article class="prototype-review-persona" data-tier="${escapeHtml(persona.tier)}"><header><strong>${escapeHtml(persona.name)}</strong><span>${escapeHtml(persona.tier)}</span></header><p>${escapeHtml(persona.engagementReason)}</p><small>${(persona.matchedSignals ?? []).map(escapeHtml).join(' · ')}</small></article>`;
}

function renderPrototypeReview() {
  const panel = element('prototypeReviewPanel');
  const delivery = prototypeReviewDelivery();
  panel.hidden = !delivery || delivery.currentPhase !== 'ui-design';
  if (panel.hidden) return;
  const workspace = state.prototypeReview;
  const operation = prototypeReviewOperation();
  const planStage = state.prototypeReviewStage === 'plan';
  const preparation = planStage ? workspace?.planPreparation : workspace?.cyclePreparations?.at(-1);
  const review = planStage ? workspace?.currentPlanReview : workspace?.currentCycleReview;
  const engagement = review?.engagement ?? preparation?.engagement;
  element('prototypeReviewStatus').textContent = state.prototypeReviewLoading
    ? 'Loading…'
    : review?.nextAction?.replaceAll('-', ' ') ?? (preparation ? 'Review prepared' : 'Not prepared');
  const notice = element('prototypeReviewNotice');
  notice.hidden = !(state.prototypeReviewError || state.prototypeReviewNotice);
  notice.classList.toggle('error', Boolean(state.prototypeReviewError));
  notice.textContent = state.prototypeReviewError || state.prototypeReviewNotice;
  document.querySelectorAll('[data-prototype-stage]').forEach((button) => {
    const active = button.dataset.prototypeStage === state.prototypeReviewStage;
    button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('active', active);
  });
  const availability = engagement?.availability ?? workspace?.personaAvailability ?? {};
  element('prototypeReviewAvailability').innerHTML = ['standardModel', 'core', 'project', 'personal', 'premium'].map((tier) => {
    const item = availability[tier] ?? { available: tier === 'standardModel', count: 0 };
    const label = tier === 'standardModel' ? 'Standard model' : `${tier} personas`;
    return `<span data-available="${Boolean(item.available)}"><b>${escapeHtml(label)}</b><small>${tier === 'standardModel' ? (item.available ? 'available' : 'unavailable') : `${item.count ?? 0} installed`}</small></span>`;
  }).join('');
  element('prototypeReviewPersonas').innerHTML = engagement?.activePersonas?.length
    ? engagement.activePersonas.map(prototypeReviewPersonaCard).join('')
    : '<div class="prototype-review-empty"><strong>Stage not prepared.</strong><p>The standard model and installed project/core personas remain the complete baseline.</p></div>';
  const assessmentByFinding = new Map((review?.assessments ?? []).map((assessment) => [assessment.findingId, assessment]));
  element('prototypeReviewFindings').innerHTML = review?.findings?.length
    ? review.findings.map((finding) => {
      const assessment = assessmentByFinding.get(finding.id);
      return `<article data-severity="${escapeHtml(finding.severity)}"><header><strong>${escapeHtml(finding.concernCode)}</strong><span>${escapeHtml(finding.severity)}</span></header><p>${escapeHtml(finding.observation)}</p><small>${escapeHtml(finding.personaId)} · ${(finding.evidenceRefs ?? []).map(escapeHtml).join(' · ')}</small><footer><b>${escapeHtml(assessment?.disposition ?? 'unassessed')}</b><span>${escapeHtml(assessment?.rationale ?? 'An explicit assessment is still required.')}</span></footer></article>`;
    }).join('')
    : '<div class="prototype-review-empty"><strong>No recorded findings for this stage.</strong><p>Absence of findings is not Manual QA or release evidence.</p></div>';
  const labels = {
    'plan-prepare': ['Plan preparation JSON', 'Prepare plan review'],
    'plan-record': ['Assessed plan findings JSON', 'Record plan review'],
    'cycle-prepare': ['Rendered-cycle preparation JSON', 'Prepare design review'],
    'cycle-record': ['Assessed design findings JSON', 'Record design review'],
  }[operation];
  element('prototypeReviewPayloadLabel').textContent = labels[0];
  const submit = element('prototypeReviewForm').querySelector('[type="submit"]');
  submit.textContent = labels[1];
  submit.disabled = state.prototypeReviewLoading;
}

async function loadPrototypeReview() {
  const delivery = prototypeReviewDelivery();
  if (!delivery || delivery.currentPhase !== 'ui-design') {
    state.prototypeReview = null;
    renderPrototypeReview();
    return;
  }
  state.prototypeReviewLoading = true;
  state.prototypeReviewError = '';
  renderPrototypeReview();
  try {
    state.prototypeReview = await api(`/api/prototype-reviews/${encodeURIComponent(delivery.slug)}`);
  } catch (error) {
    state.prototypeReview = null;
    state.prototypeReviewError = error.message;
  } finally {
    state.prototypeReviewLoading = false;
    renderPrototypeReview();
  }
}

async function submitPrototypeReview() {
  const delivery = prototypeReviewDelivery();
  if (!delivery) return;
  let payload;
  try { payload = JSON.parse(element('prototypeReviewPayload').value || '{}'); }
  catch { state.prototypeReviewError = 'Prototype review payload must be valid JSON.'; renderPrototypeReview(); return; }
  const operation = prototypeReviewOperation();
  const endpoint = {
    'plan-prepare': 'plan/prepare', 'plan-record': 'plan/record',
    'cycle-prepare': 'cycles/prepare', 'cycle-record': 'cycles/record',
  }[operation];
  state.prototypeReviewLoading = true;
  state.prototypeReviewError = '';
  state.prototypeReviewNotice = '';
  renderPrototypeReview();
  try {
    await api(`/api/prototype-reviews/${encodeURIComponent(delivery.slug)}/${endpoint}`, { method: 'POST', body: JSON.stringify(payload) });
    state.prototypeReviewNotice = `${operation.replaceAll('-', ' ')} completed. Review evidence remains advisory.`;
    element('prototypeReviewPayload').value = '';
    await loadPrototypeReview();
  } catch (error) {
    state.prototypeReviewError = error.message;
  } finally {
    state.prototypeReviewLoading = false;
    renderPrototypeReview();
  }
}

function phaseStudioEntryCard(entry) {
  return `<article class="phase-studio-entry" data-owner-context="${escapeHtml(entry.ownerContext)}">
    <header><span>${escapeHtml(entry.classification)}</span><strong>${escapeHtml(entry.contributedBy)}</strong><small>${escapeHtml(entry.ownerContext)}</small></header>
    <p>${escapeHtml(entry.statement)}</p>
    <footer><b>${escapeHtml(entry.topic)}</b>${entry.source ? `<span>Source: ${escapeHtml(entry.source)}</span>` : '<span>No source reference recorded</span>'}</footer>
  </article>`;
}

function phaseStudioEvidenceReview(workspace) {
  const entries = workspace.draft.entries ?? [];
  const unresolved = (workspace.draft.conflicts ?? []).filter((conflict) => conflict.status !== 'resolved');
  const reviewer = workspace.draft.owners.sharedReview ?? '';
  const group = (context, title) => `<section><header><span class="eyebrow">${escapeHtml(context)}</span><h4>${escapeHtml(title)}</h4></header>${entries.filter((entry) => entry.ownerContext === context).map(phaseStudioEntryCard).join('') || '<p class="phase-studio-muted">No attributed evidence in this context yet.</p>'}</section>`;
  const conflicts = workspace.draft.conflicts ?? [];
  return `<form id="phaseStudioForm" class="phase-studio-form phase-studio-resolution-form">
      <div class="phase-studio-question"><span class="eyebrow">Shared review</span><h3>Preserve both perspectives and name the resolution</h3><p>${escapeHtml(workspace.context.responsibility)}</p></div>
      <div class="phase-studio-form-grid">
        <label><span>Named shared reviewer</span><input id="phaseStudioOwnerName" name="ownerName" maxlength="160" autocomplete="name" value="${escapeHtml(reviewer)}" placeholder="Real participant name" required></label>
        <label><span>Conflict to resolve</span><select id="phaseStudioResolutionConflict"><option value="">Leave disagreement unresolved</option>${unresolved.map((conflict) => `<option value="${escapeHtml(conflict.id)}">${escapeHtml(conflict.summary)}</option>`).join('')}</select></label>
        <label class="wide"><span>Named resolution or shared decision</span><textarea id="phaseStudioStatement" name="statement" rows="4" maxlength="8000" placeholder="Record the agreed resolution, or leave blank to keep the disagreement explicit."></textarea></label>
        <input type="hidden" id="phaseStudioClassification" value="named-decision">
        <input type="hidden" name="topic" value="${escapeHtml(state.phaseStudioTopic || workspace.profile.topics[0]?.id || '')}">
        <label class="wide"><span>Source or provenance</span><input id="phaseStudioSource" name="source" maxlength="1000" placeholder="Shared review, named decision record or other source"></label>
        <label><span>Open questions</span><textarea id="phaseStudioQuestions" rows="3" maxlength="8000" placeholder="One question per line"></textarea></label>
        <label><span>Limitations</span><textarea id="phaseStudioLimitations" rows="3" maxlength="8000" placeholder="One limitation per line"></textarea></label>
      </div>
      <div class="phase-studio-destinations"><strong>Contribution destinations</strong>${workspace.destinations.map((path) => `<code>${escapeHtml(path)}</code>`).join('')}</div>
    </form>
    <div class="phase-studio-review-grid">
      ${group('business', 'Business-facing evidence')}
      ${group('technical', 'Technical evidence')}
    </div>
    <section class="phase-studio-shared-items"><span class="eyebrow">Shared review</span><h4>Decisions, disagreement and deliberately unresolved items</h4>
      ${group('shared-review', 'Shared resolutions')}
      <div class="phase-studio-conflicts">${conflicts.length ? conflicts.map((conflict) => `<article data-status="${escapeHtml(conflict.status)}"><strong>${escapeHtml(conflict.summary)}</strong><p><b>Business:</b> ${escapeHtml(conflict.businessPosition || 'Not recorded')}</p><p><b>Technical:</b> ${escapeHtml(conflict.technicalPosition || 'Not recorded')}</p>${conflict.resolution ? `<p><b>Resolution · ${escapeHtml(conflict.resolution.resolvedBy)}:</b> ${escapeHtml(conflict.resolution.statement)}</p>` : '<small>Deliberately unresolved</small>'}</article>`).join('') : '<p class="phase-studio-muted">No conflicts recorded.</p>'}</div>
    </section>`;
}

function phaseStudioContributionForm(workspace) {
  const topic = workspace.profile.topics.find((candidate) => candidate.id === state.phaseStudioTopic) ?? workspace.profile.topics[0];
  const ownerKey = phaseStudioOwnerKey(workspace.draft.ownerContext);
  const owner = workspace.draft.owners[ownerKey] ?? '';
  return `<form id="phaseStudioForm" class="phase-studio-form">
      <div class="phase-studio-question"><span class="eyebrow">${escapeHtml(workspace.context.title)}</span><h3>${escapeHtml(topic?.question ?? 'Contribute evidence')}</h3><p>${escapeHtml(workspace.context.responsibility)}</p></div>
      <div class="phase-studio-form-grid">
        <label><span>Named owner</span><input id="phaseStudioOwnerName" name="ownerName" maxlength="160" autocomplete="name" value="${escapeHtml(owner)}" placeholder="Real participant name" required></label>
        <label><span>Evidence class</span><select id="phaseStudioClassification" name="classification">${['participant-statement', 'repository-fact', 'imported-source', 'persona-hypothesis', 'named-decision', 'unresolved-question'].map((value) => `<option value="${value}">${value.replaceAll('-', ' ')}</option>`).join('')}</select></label>
        <input type="hidden" name="topic" value="${escapeHtml(topic?.id ?? '')}">
        <label class="wide"><span>Contribution</span><textarea id="phaseStudioStatement" name="statement" rows="6" maxlength="8000" placeholder="Record an observable contribution. Advisory persona output must be labelled as a hypothesis."></textarea></label>
        <label class="wide"><span>Source or provenance</span><input id="phaseStudioSource" name="source" maxlength="1000" placeholder="Repository path, meeting, imported source or named decision"></label>
        <label><span>Open questions</span><textarea id="phaseStudioQuestions" name="questions" rows="4" maxlength="8000" placeholder="One question per line"></textarea></label>
        <label><span>Limitations</span><textarea id="phaseStudioLimitations" name="limitations" rows="4" maxlength="8000" placeholder="One visible limitation per line"></textarea></label>
        ${workspace.draft.ownerContext === 'technical' ? `<label class="wide"><span>Conflict or disagreement</span><input id="phaseStudioConflictSummary" maxlength="8000" placeholder="Describe the unresolved difference"></label><label><span>Business position</span><textarea id="phaseStudioBusinessPosition" rows="3" maxlength="8000"></textarea></label><label><span>Technical position</span><textarea id="phaseStudioTechnicalPosition" rows="3" maxlength="8000"></textarea></label>` : ''}
      </div>
      <section class="phase-studio-guidance"><h4>Questions for this owner context</h4><ul>${workspace.context.questions.map((question) => `<li>${escapeHtml(question)}</li>`).join('')}</ul><small>Available contribution actions: ${workspace.context.actions.map(escapeHtml).join(' · ')}</small></section>
    </form>
    <section class="phase-studio-thread"><header><span class="eyebrow">Shared thread</span><h3>Attributed evidence</h3></header>${workspace.draft.entries.length ? workspace.draft.entries.map(phaseStudioEntryCard).join('') : '<p class="phase-studio-muted">No evidence has been saved yet.</p>'}</section>`;
}

function renderPhaseStudio() {
  const deliveries = phaseStudioDeliveries();
  const selector = element('phaseStudioWorkItem');
  selector.innerHTML = `<option value="">Choose a delivery</option>${deliveries.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === state.phaseStudioReference ? 'selected' : ''}>${escapeHtml(item.title)} · ${escapeHtml(item.currentPhase)}</option>`).join('')}`;
  const workspace = state.phaseStudio;
  renderPrototypeReview();
  element('phaseStudioState').textContent = state.phaseStudioLoading
    ? 'Loading governed phase…'
    : workspace ? `${workspace.phase.id} · revision ${workspace.draft.revision} · ${workspace.draft.digest ? workspace.draft.digest.slice(0, 12) : 'unsaved'}` : 'Choose an active delivery.';
  element('phaseStudioNotice').hidden = !(state.phaseStudioError || state.phaseStudioNotice);
  element('phaseStudioNotice').classList.toggle('error', Boolean(state.phaseStudioError));
  element('phaseStudioNotice').textContent = state.phaseStudioError || state.phaseStudioNotice;
  if (!workspace) {
    element('phaseStudioContent').innerHTML = `<div class="phase-studio-empty"><strong>${state.phaseStudioLoading ? 'Loading contributions' : 'Choose an active delivery'}</strong><p>${escapeHtml(state.phaseStudioError || 'EWAI will check its current state before enabling contributions.')}</p></div>`;
    element('phaseStudioEvidenceSpine').innerHTML = '';
    element('phaseStudioPersonas').innerHTML = '';
    document.querySelectorAll('[data-phase-save], [data-phase-discard], [data-phase-handoff], [data-phase-review], [data-phase-confirm]').forEach((button) => { button.disabled = true; });
    return;
  }
  const profile = workspace.profile;
  element('phaseStudioPhase').textContent = profile?.title ?? `Unsupported · ${workspace.phase.id}`;
  element('phaseStudioProfileSummary').textContent = profile ? `Server-owned profile · ${profile.topics.length} evidence topics` : 'This phase remains with its specialised governed workflow.';
  const owners = workspace.draft.owners;
  element('phaseStudioBusinessOwner').textContent = owners.business || 'Not named';
  element('phaseStudioTechnicalOwner').textContent = owners.technical || 'Not named';
  element('phaseStudioSharedOwner').textContent = owners.sharedReview || 'Not named';
  document.querySelectorAll('[data-phase-context]').forEach((button) => {
    const active = button.dataset.phaseContext === workspace.draft.ownerContext;
    button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('active', active);
    button.disabled = !workspace.capabilities.contribute || state.phaseStudioLoading;
  });
  if (profile) {
    if (!profile.topics.some((topic) => topic.id === state.phaseStudioTopic)) state.phaseStudioTopic = profile.topics[0]?.id ?? '';
    element('phaseStudioEvidenceSpine').innerHTML = profile.topics.map((topic, index) => {
      const count = workspace.draft.entries.filter((entry) => entry.topic === topic.id).length;
      const active = topic.id === state.phaseStudioTopic;
      return `<button type="button" data-phase-topic="${escapeHtml(topic.id)}" ${active ? 'aria-current="step"' : ''}><b>${index + 1}</b><span><strong>${escapeHtml(topic.title)}</strong><small>${count ? `${count} contribution${count === 1 ? '' : 's'}` : 'Evidence needed'}</small></span></button>`;
    }).join('');
  } else element('phaseStudioEvidenceSpine').innerHTML = '';
  element('phaseStudioHandoffHistory').innerHTML = workspace.draft.handoffs.length ? `<span class="eyebrow">Owner history</span><h4>Latest hand-offs</h4>${workspace.draft.handoffs.slice().reverse().map((handoff) => `<article><strong>${escapeHtml(handoff.fromOwner)} → ${escapeHtml(handoff.toOwner)}</strong><span>${escapeHtml(handoff.fromContext)} → ${escapeHtml(handoff.toContext)}</span><small>r${handoff.sourceRevision} · ${escapeHtml(handoff.sourceDigest.slice(0, 10))}</small><p>${escapeHtml(handoff.reason)}</p></article>`).join('')}` : '';
  if (!profile || workspace.status === 'blocked' || workspace.status === 'unsupported') {
    const messages = workspace.blockers.length ? workspace.blockers.map((blocker) => blocker.message) : [`${workspace.phase.id} uses its specialised governed workflow.`];
    element('phaseStudioContent').innerHTML = `<div class="phase-studio-empty"><strong>Contributions are read-only here</strong><p>${messages.map(escapeHtml).join(' ')}</p><small>Use Companion or the delivery workflow for the next action.</small></div>`;
  } else {
    element('phaseStudioContent').innerHTML = workspace.draft.ownerContext === 'shared-review' ? phaseStudioEvidenceReview(workspace) : phaseStudioContributionForm(workspace);
  }
  element('phaseStudioPersonas').innerHTML = workspace.activePersonas.length ? workspace.activePersonas.map((persona) => `<article data-tier="${escapeHtml(persona.tier)}"><header><strong>${escapeHtml(persona.name)}</strong><span>${escapeHtml(persona.tier)}</span></header><p>${escapeHtml(persona.engagementReason)}</p><small>${persona.matchedSignals.map(escapeHtml).join(' · ')}</small></article>`).join('') : '<div class="phase-studio-empty compact"><strong>No installed persona matched.</strong><p>Standard host-model questions and project/core baseline remain complete.</p></div>';
  const premium = workspace.personaAvailability.premium;
  element('phaseStudioPersonaBaseline').innerHTML = `<strong>Standard host-model baseline</strong><p>${escapeHtml(workspace.guidance.advisoryNotice)}</p><small>${escapeHtml(premium.reason)}</small>`;
  const joined = workspace.personaChanges.joined.map(({ name }) => name);
  const left = workspace.personaChanges.left;
  element('phaseStudioPersonaChanges').textContent = [joined.length ? `Joined: ${joined.join(', ')}.` : '', left.length ? `Left: ${left.join(', ')}.` : '', !joined.length && !left.length ? 'The active persona ensemble is unchanged.' : ''].filter(Boolean).join(' ');
  document.querySelector('[data-phase-save]').disabled = !workspace.capabilities.saveDraft || state.phaseStudioLoading;
  document.querySelector('[data-phase-discard]').disabled = !workspace.capabilities.discardDraft || state.phaseStudioLoading;
  document.querySelector('[data-phase-handoff]').disabled = !workspace.capabilities.handoff || state.phaseStudioLoading;
  document.querySelector('[data-phase-review]').disabled = !workspace.capabilities.requestReview || state.phaseStudioLoading;
  document.querySelector('[data-phase-confirm]').disabled = !workspace.capabilities.confirmContribution || state.phaseStudioLoading;
}

async function loadPhaseStudio(reference = state.phaseStudioReference) {
  if (!reference) reference = phaseStudioDeliveries()[0]?.id ?? '';
  state.phaseStudioReference = reference;
  state.phaseStudioLoading = true;
  state.phaseStudioError = '';
  state.phaseStudioNotice = '';
  renderPhaseStudio();
  if (!reference) { state.phaseStudioLoading = false; renderPhaseStudio(); return; }
  try {
    state.phaseStudio = await api(`/api/work-items/${encodeURIComponent(reference)}/phase-studio`);
    state.phaseStudioTopic = state.phaseStudio.profile?.topics[0]?.id ?? '';
  } catch (error) {
    state.phaseStudio = null;
    state.phaseStudioError = error.message;
  } finally {
    state.phaseStudioLoading = false;
    renderPhaseStudio();
    await loadPrototypeReview();
  }
}

function phaseStudioLines(id) {
  return (element(id)?.value ?? '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

async function savePhaseStudioContribution(ownerContext = state.phaseStudio?.draft.ownerContext) {
  const workspace = state.phaseStudio;
  if (!workspace) return;
  const ownerKey = phaseStudioOwnerKey(ownerContext);
  const ownerName = ownerContext === workspace.draft.ownerContext
    ? (element('phaseStudioOwnerName')?.value.trim() || workspace.draft.owners[ownerKey])
    : (workspace.draft.owners[ownerKey] || window.prompt(`Name the real ${workspace.contexts[ownerContext].title.toLowerCase()}:`)?.trim());
  if (!ownerName) { state.phaseStudioError = 'A real named owner is required before changing or saving context.'; renderPhaseStudio(); return; }
  const statement = ownerContext === workspace.draft.ownerContext ? element('phaseStudioStatement')?.value.trim() ?? '' : '';
  const conflictSummary = ownerContext === workspace.draft.ownerContext ? element('phaseStudioConflictSummary')?.value.trim() ?? '' : '';
  const resolutionConflictId = ownerContext === 'shared-review' ? element('phaseStudioResolutionConflict')?.value ?? '' : '';
  const payload = {
    expectedRevision: workspace.draft.revision, ownerContext, ownerName,
    entries: statement ? [{
      topic: document.querySelector('#phaseStudioForm [name="topic"]')?.value ?? state.phaseStudioTopic,
      classification: element('phaseStudioClassification')?.value ?? 'participant-statement', statement,
      source: element('phaseStudioSource')?.value.trim() ?? '',
    }] : [],
    questions: ownerContext === workspace.draft.ownerContext ? phaseStudioLines('phaseStudioQuestions') : [],
    conflicts: conflictSummary ? [{ summary: conflictSummary, businessPosition: element('phaseStudioBusinessPosition')?.value.trim() ?? '', technicalPosition: element('phaseStudioTechnicalPosition')?.value.trim() ?? '' }] : [],
    resolutions: resolutionConflictId && statement ? [{ conflictId: resolutionConflictId, resolution: statement }] : [],
    limitations: ownerContext === workspace.draft.ownerContext ? phaseStudioLines('phaseStudioLimitations') : [],
  };
  state.phaseStudioLoading = true;
  try {
    state.phaseStudio = await api(`/api/work-items/${encodeURIComponent(state.phaseStudioReference)}/phase-studio/draft`, { method: 'POST', body: JSON.stringify(payload) });
    state.phaseStudioNotice = `Draft revision ${state.phaseStudio.draft.revision} saved. The active personas were recomputed for ${state.phaseStudio.context.title}.`;
    state.phaseStudioError = '';
    renderPhaseStudio();
  } catch (error) {
    state.phaseStudioError = error.message;
    element('phaseStudioNotice').hidden = false;
    element('phaseStudioNotice').classList.add('error');
    element('phaseStudioNotice').textContent = error.message;
  } finally {
    state.phaseStudioLoading = false;
    document.querySelectorAll('[data-phase-save], [data-phase-context]').forEach((button) => { button.disabled = false; });
  }
}

async function handoffPhaseStudio() {
  const workspace = state.phaseStudio;
  if (!workspace?.draft.revision) return;
  const suggested = workspace.draft.ownerContext === 'business' ? 'technical' : 'shared-review';
  const destinationContext = window.prompt('Destination context: business, technical or shared-review', suggested)?.trim();
  if (!destinationContext || !workspace.contexts[destinationContext] || destinationContext === workspace.draft.ownerContext) return;
  const toOwner = window.prompt(`Name the incoming ${workspace.contexts[destinationContext].title.toLowerCase()}:`)?.trim();
  const reason = window.prompt('Why is responsibility moving?')?.trim();
  const questions = window.prompt('Questions for the incoming owner, one per line:')?.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) ?? [];
  if (!toOwner || !reason || !questions.length || !window.confirm(`Hand revision ${workspace.draft.revision} (${workspace.draft.digest.slice(0, 12)}) from ${workspace.draft.owners[phaseStudioOwnerKey(workspace.draft.ownerContext)]} (${workspace.draft.ownerContext}) to ${toOwner} (${destinationContext})?\n\nReason: ${reason}\nQuestions: ${questions.join(' · ')}\n\nThe same evidence thread will continue.`)) return;
  try {
    state.phaseStudio = await api(`/api/work-items/${encodeURIComponent(state.phaseStudioReference)}/phase-studio/handoff`, { method: 'POST', body: JSON.stringify({ expectedRevision: workspace.draft.revision, currentDigest: workspace.draft.digest, destinationContext, toOwner, reason, questions }) });
    state.phaseStudioNotice = `Responsibility handed to ${toOwner}. Revision ${state.phaseStudio.draft.revision} continues the same evidence thread.`;
    state.phaseStudioError = '';
  } catch (error) { state.phaseStudioError = error.message; }
  renderPhaseStudio();
}

async function requestPhaseStudioReview() {
  const workspace = state.phaseStudio;
  if (!workspace?.draft.revision) return;
  try {
    const receipt = await api(`/api/work-items/${encodeURIComponent(state.phaseStudioReference)}/phase-studio/review`, { method: 'POST', body: JSON.stringify({ expectedRevision: workspace.draft.revision, currentDigest: workspace.draft.digest }) });
    state.phaseStudioNotice = `Advisory host review queued with authority ${receipt.authority}. It cannot change delivery state or confirm evidence.`;
    state.phaseStudioError = '';
  } catch (error) { state.phaseStudioError = error.message; }
  renderPhaseStudio();
}

async function confirmPhaseStudio() {
  const workspace = state.phaseStudio;
  if (!workspace?.draft.revision) return;
  const confirmedBy = window.prompt('Name the person confirming this exact contribution revision:')?.trim();
  if (!confirmedBy || !window.confirm(`Create immutable contribution evidence for revision ${workspace.draft.revision}? This will not complete ${workspace.phase.id}, approve Build or accept Manual QA.`)) return;
  try {
    const receipt = await api(`/api/work-items/${encodeURIComponent(state.phaseStudioReference)}/phase-studio/confirm`, { method: 'POST', body: JSON.stringify({ expectedRevision: workspace.draft.revision, currentDigest: workspace.draft.digest, confirmed: true, confirmedBy }) });
    state.phaseStudioNotice = `Contribution evidence recorded at ${receipt.created.markdownPath}. Governed delivery authority is unchanged.`;
    await loadPhaseStudio(state.phaseStudioReference);
  } catch (error) { state.phaseStudioError = error.message; renderPhaseStudio(); }
}

async function discardPhaseStudio() {
  const workspace = state.phaseStudio;
  if (!workspace?.draft.revision || !window.confirm('Discard this contribution draft? Saved contributions and delivery evidence won’t be changed.')) return;
  try {
    await api(`/api/work-items/${encodeURIComponent(state.phaseStudioReference)}/phase-studio/draft`, { method: 'DELETE', body: JSON.stringify({ expectedRevision: workspace.draft.revision, confirmed: true }) });
    state.phaseStudio = null;
    state.phaseStudioNotice = 'Runtime draft discarded. Confirmed evidence and delivery state were untouched.';
    await loadPhaseStudio(state.phaseStudioReference);
  } catch (error) { state.phaseStudioError = error.message; renderPhaseStudio(); }
}

function currentIntentSection() {
  return state.guidedIntent?.sections.find((section) => section.id === state.guidedIntent.draft.currentSection) ?? null;
}

function guidedIntentValue(path) {
  return valueAtPath(state.guidedIntent?.draft.intent, path);
}

function formatIntentValue(value) {
  if (Array.isArray(value)) return value.length ? value.map((item) => typeof item === 'object' ? JSON.stringify(item) : item).join(' · ') : 'Not recorded';
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value ?? '').trim() || 'Not recorded';
}

function intentFieldError(path) {
  return state.guidedIntent?.validation.errors.find((error) => error.path === path) ?? null;
}

function renderIntentTextField(path, label, { list = false, help = '' } = {}) {
  const value = guidedIntentValue(path);
  const error = intentFieldError(path);
  const id = `intent-${path.replaceAll('.', '-')}`;
  return `<label class="intent-studio-field ${error ? 'has-error' : ''}" for="${escapeHtml(id)}">
    <span>${escapeHtml(label)}</span>
    <textarea id="${escapeHtml(id)}" data-intent-path="${escapeHtml(path)}" data-intent-type="${list ? 'list' : 'text'}" rows="${list ? 7 : 9}" aria-describedby="${escapeHtml(id)}-help">${escapeHtml(Array.isArray(value) ? value.join('\n') : value ?? '')}</textarea>
    <small id="${escapeHtml(id)}-help">${escapeHtml(help || (list ? 'Add one item per line.' : 'Keep observed evidence and advisory hypotheses distinct.'))}</small>
    ${error ? `<em>${escapeHtml(error.message)}</em>` : ''}
  </label>`;
}

function renderIntentIdentity() {
  const draft = state.guidedIntent.draft;
  const eligible = state.guidedIntent.eligibleIntents;
  return `<div class="intent-studio-mode" role="group" aria-label="Intent authoring mode">
      <button type="button" data-intent-mode="create" class="${draft.mode === 'create' ? 'active' : ''}">Create a new intent</button>
      <button type="button" data-intent-mode="reconcile" class="${draft.mode === 'reconcile' ? 'active' : ''}">Reconcile a draft intent</button>
    </div>
    ${draft.mode === 'reconcile' ? `<section class="intent-studio-reconcile">
      <label for="intentSource"><span>Eligible canonical draft</span><select id="intentSource" data-intent-source><option value="">Choose a draft intent</option>${eligible.map((intent) => `<option value="${escapeHtml(intent.reference)}" ${draft.sourceReference === intent.reference ? 'selected' : ''}>${escapeHtml(intent.title)} · ${escapeHtml(intent.reference)}</option>`).join('')}</select></label>
      <button type="button" class="secondary-action" data-intent-import ${draft.sourceReference ? '' : 'disabled'}>Import current revision</button>
      <p>Only consistent draft/not-started intents are eligible. Identity, relationships and delivery state stay protected.</p>
    </section>` : ''}
    <div class="intent-studio-identity-grid">
      ${[['domain', 'Domain', 'experience'], ['slug', 'Slug', 'supplier-renewal'], ['title', 'Title', 'Supplier renewal visibility']].map(([path, label, placeholder]) => {
        const error = intentFieldError(path);
        const locked = draft.mode === 'reconcile';
        return `<label class="intent-studio-field ${error ? 'has-error' : ''}"><span>${label}</span><input type="text" data-intent-path="${path}" value="${escapeHtml(guidedIntentValue(path) ?? '')}" placeholder="${placeholder}" ${locked && path !== 'title' ? 'readonly' : ''}>${error ? `<em>${escapeHtml(error.message)}</em>` : ''}</label>`;
      }).join('')}
    </div>`;
}

function renderIntentRelationships() {
  const relationships = state.guidedIntent.draft.intent.relationships;
  const value = relationships.map((item) => [item.type, item.target, item.rationale ?? ''].join(' | ')).join('\n');
  return `<label class="intent-studio-field"><span>Intent relationships</span><textarea data-intent-path="relationships" data-intent-type="relationships" rows="9" ${state.guidedIntent.draft.mode === 'reconcile' ? 'readonly' : ''}>${escapeHtml(value)}</textarea><small>One per line: type | domain/slug | rationale. Reconciliation keeps existing relationships read-only.</small></label>
    <p class="intent-studio-types">Supported types: depends-on · enables · complements · conflicts-with · supersedes · relates-to</p>`;
}

function renderIntentDeliveryShape() {
  const shape = state.guidedIntent.draft.intent.deliveryShape ?? {};
  return `<div class="intent-studio-shape-grid">
      <label class="intent-studio-field"><span>Recommendation</span><select data-intent-path="deliveryShape.recommendation"><option value="">Choose</option>${['single', 'split', 'decision-required'].map((value) => `<option value="${value}" ${shape.recommendation === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
      <label class="intent-studio-field"><span>Reviewed decision</span><select data-intent-path="deliveryShape.reviewedDecision"><option value="">Choose</option>${['keep-as-one', 'split', 'refine-split', 'defer'].map((value) => `<option value="${value}" ${shape.reviewedDecision === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
      <label class="intent-studio-field intent-studio-wide"><span>Reason</span><textarea data-intent-path="deliveryShape.reason" rows="6">${escapeHtml(shape.reason ?? '')}</textarea></label>
      <label class="intent-studio-field intent-studio-wide"><span>Blocking questions</span><textarea data-intent-path="deliveryShape.blockingQuestions" data-intent-type="list" rows="5">${escapeHtml((shape.blockingQuestions ?? []).join('\n'))}</textarea><small>Add one unresolved split question per line.</small></label>
    </div>`;
}

function renderIntentReview() {
  const workspace = state.guidedIntent;
  const intent = workspace.draft.intent;
  const details = [
    ['Problem', intent.details.problem], ['Outcome', intent.details.desiredOutcome], ['Users', intent.details.users],
    ['Journeys', intent.details.journeys], ['Acceptance', intent.details.acceptanceCriteria], ['Constraints', intent.details.constraints],
    ['Evidence', intent.details.evidence], ['Open decisions', intent.details.openDecisions],
  ];
  return `<div class="intent-studio-review">
    <section class="intent-studio-review-summary"><span class="eyebrow">Structured intent</span><h3>${escapeHtml(intent.title || 'Untitled intent')}</h3><code>${escapeHtml(intent.domain || 'domain')}/${escapeHtml(intent.slug || 'slug')}</code>${details.map(([label, value]) => `<div><strong>${escapeHtml(label)}</strong><p>${escapeHtml(formatIntentValue(value))}</p></div>`).join('')}</section>
    <section class="intent-studio-review-panel">
      <div class="intent-studio-blockers"><span class="eyebrow">Readiness</span><h3>${workspace.validation.valid ? 'Ready for an accountable decision' : `${workspace.validation.errors.length} blocking item${workspace.validation.errors.length === 1 ? '' : 's'}`}</h3>${workspace.validation.errors.length ? `<ul>${workspace.validation.errors.map((error) => `<li><code>${escapeHtml(error.path)}</code>${escapeHtml(error.message)}</li>`).join('')}</ul>` : '<p>The portable intent contract passes. Review evidence and consequences before approval.</p>'}</div>
      <div class="intent-studio-destinations"><h4>Exact canonical destinations</h4>${workspace.preview.destinations.map((path) => `<code>${escapeHtml(path)}</code>`).join('') || '<p>Complete identity to preview destinations.</p>'}</div>
      ${workspace.draft.mode === 'reconcile' ? `<div class="intent-studio-changes"><h4>Before and after</h4>${workspace.preview.changes.length ? workspace.preview.changes.map((change) => `<article><strong>${escapeHtml(change.section)}</strong><span><small>Before</small>${escapeHtml(formatIntentValue(change.before))}</span><b aria-hidden="true">→</b><span><small>After</small>${escapeHtml(formatIntentValue(change.after))}</span></article>`).join('') : '<p>No proposed changes yet.</p>'}</div>` : ''}
      <div class="intent-studio-approval"><span class="eyebrow">Accountable intent decision</span><h4>Approve this exact draft revision</h4><p>This creates or reconciles intent truth only. It does not approve Build, Manual QA, certification, deployment, or release.</p><label><span>Approver name</span><input id="intentStudioApprover" type="text" autocomplete="name" placeholder="Name of accountable approver"></label><label class="intent-studio-confirm"><input id="intentStudioConfirmed" type="checkbox"><span>I reviewed the participant evidence, advisory persona lenses, blockers, changes, delivery shape, and exact destinations.</span></label><button type="button" class="primary-action" data-intent-approve disabled>Approve intent revision ${workspace.draft.revision}</button></div>
    </section>
  </div>`;
}

function renderIntentSectionContent(section) {
  if (section.id === 'identity') return renderIntentIdentity();
  if (section.id === 'relationships') return renderIntentRelationships();
  if (section.id === 'delivery-shape') return renderIntentDeliveryShape();
  if (section.id === 'review') return renderIntentReview();
  const fields = {
    problem: ['details.problem', 'Problem', false], outcome: ['details.desiredOutcome', 'Desired outcome', false],
    users: ['details.users', 'Users and affected roles', true], journeys: ['details.journeys', 'Journeys', true],
    acceptance: ['details.acceptanceCriteria', 'Acceptance criteria', true], constraints: ['details.constraints', 'Constraints and non-goals', true],
    evidence: ['details.evidence', 'Evidence and named decisions', true], 'open-decisions': ['details.openDecisions', 'Open decisions and evidence gaps', true],
  };
  const [path, label, list] = fields[section.id];
  return renderIntentTextField(path, label, { list, help: section.help });
}

function renderGuidedIntentPersonas() {
  const personas = state.guidedIntent?.activePersonas ?? [];
  element('intentStudioPersonas').innerHTML = personas.length ? personas.map((persona) => `<article data-tier="${escapeHtml(persona.tier)}"><header><strong>${escapeHtml(persona.name)}</strong><span>${escapeHtml(persona.tier)}</span></header><p>${escapeHtml(persona.engagementReason)}</p><small>${persona.matchedSignals.map(escapeHtml).join(' · ')}</small></article>`).join('') : '<div class="intent-studio-empty compact"><strong>No installed persona matched.</strong><p>The standard host-model baseline remains complete.</p></div>';
  const premium = state.guidedIntent?.personaAvailability.premium;
  element('intentStudioBaseline').innerHTML = `<strong>Standard host-model baseline</strong><p>${escapeHtml(state.guidedIntent?.baseline.description ?? '')}</p><small>${escapeHtml(premium?.reason ?? 'Premium availability unknown.')}</small>`;
}

function renderGuidedIntentSections() {
  const workspace = state.guidedIntent;
  const errorPaths = new Set(workspace.validation.errors.map(({ path }) => path));
  element('intentStudioSections').innerHTML = workspace.sections.map((section, index) => {
    const active = section.id === workspace.draft.currentSection;
    const blocked = section.fields.some((field) => [...errorPaths].some((path) => path === field || path.startsWith(`${field}.`)));
    const done = section.id === 'review' ? workspace.validation.valid : !blocked;
    return `<button type="button" data-intent-section="${escapeHtml(section.id)}" class="${active ? 'active' : ''} ${done ? 'done' : ''}" ${active ? 'aria-current="step"' : ''}><b>${done ? '✓' : index + 1}</b><span><strong>${escapeHtml(section.title)}</strong><small>${escapeHtml(section.short)}</small></span></button>`;
  }).join('');
}

function updateIntentApprovalState() {
  const button = document.querySelector('[data-intent-approve]');
  if (!button) return;
  button.disabled = state.guidedIntentLoading || !state.guidedIntent?.validation.valid || !element('intentStudioApprover')?.value.trim() || !element('intentStudioConfirmed')?.checked;
}

function renderGuidedIntent() {
  const content = element('intentStudioContent');
  if (state.guidedIntentLoading && !state.guidedIntent) {
    content.innerHTML = '<div class="intent-studio-empty"><strong>Preparing Intent Studio</strong><p>Loading the portable intent and contextual persona contracts.</p></div>';
    element('intentStudioActions').hidden = true;
    return;
  }
  if (state.guidedIntentCompleted) {
    content.innerHTML = `<div class="intent-studio-completed"><i aria-hidden="true">✓</i><span class="eyebrow">Intent truth recorded</span><h3>${escapeHtml(state.guidedIntentCompleted.approval.approvedBy)} approved revision ${state.guidedIntentCompleted.approval.revision}.</h3><p>The canonical Markdown and JSON agree. Build, Manual QA, certification and release remain separately governed.</p><code>${escapeHtml(state.guidedIntentCompleted.created.markdownPath)}</code><button type="button" class="primary-action" data-view="board">Open the delivery board</button></div>`;
    element('intentStudioActions').hidden = true;
    element('intentStudioSections').innerHTML = '';
    element('intentStudioPersonas').innerHTML = '';
    return;
  }
  if (!state.guidedIntent) {
    content.innerHTML = `<div class="intent-studio-error" role="alert"><strong>Intent Studio is unavailable</strong><p>${escapeHtml(state.guidedIntentError || 'The portable intent contract could not be loaded.')}</p><button type="button" class="secondary-action" data-intent-retry>Try again</button></div>`;
    element('intentStudioActions').hidden = true;
    return;
  }
  const section = currentIntentSection();
  const validSections = state.guidedIntent.sections.filter((candidate) => !candidate.fields.some((field) => state.guidedIntent.validation.errors.some((error) => error.path === field || error.path.startsWith(`${field}.`)))).length;
  element('intentStudioProgress').value = Math.round(validSections / state.guidedIntent.sections.length * 100);
  element('intentStudioEyebrow').textContent = `${section.title} · ${state.guidedIntent.draft.mode}`;
  element('intentStudioTitle').textContent = section.question;
  element('intentStudioSubtitle').textContent = section.help;
  element('intentStudioRevision').textContent = state.guidedIntent.draft.revision ? `Draft revision ${state.guidedIntent.draft.revision}` : 'Project-local draft';
  element('intentStudioNotice').hidden = !(state.guidedIntentError || state.guidedIntentNotice);
  element('intentStudioNotice').classList.toggle('error', Boolean(state.guidedIntentError));
  element('intentStudioNotice').textContent = state.guidedIntentError || state.guidedIntentNotice;
  content.innerHTML = `<article class="intent-studio-card"><div class="intent-studio-question"><span class="eyebrow">${escapeHtml(section.short)}</span><p>${escapeHtml(section.help)}</p></div>${renderIntentSectionContent(section)}</article>`;
  element('intentStudioActions').hidden = false;
  document.querySelector('[data-intent-next]').hidden = section.id === 'review';
  document.querySelector('[data-intent-back]').disabled = section.id === state.guidedIntent.sections[0].id;
  document.querySelector('[data-intent-discard]').disabled = state.guidedIntent.draft.revision === 0;
  renderGuidedIntentSections();
  renderGuidedIntentPersonas();
  updateIntentApprovalState();
}

async function loadGuidedIntent() {
  state.guidedIntentLoading = true;
  state.guidedIntentError = '';
  renderGuidedIntent();
  try { state.guidedIntent = await api('/api/guided-intent'); }
  catch (error) { state.guidedIntent = null; state.guidedIntentError = error.message; }
  finally { state.guidedIntentLoading = false; renderGuidedIntent(); }
}

async function saveGuidedIntentLocation(sectionId, options = {}) {
  if (!state.guidedIntent || state.guidedIntentLoading) return;
  const previousPersonas = new Map((state.guidedIntent.activePersonas ?? []).map((persona) => [persona.id, persona.name]));
  state.guidedIntentLoading = true;
  state.guidedIntentError = '';
  state.guidedIntentNotice = 'Saving the project-local draft…';
  try {
    const body = {
      expectedRevision: state.guidedIntent.draft.revision,
      currentSection: sectionId,
      mode: options.mode ?? state.guidedIntent.draft.mode,
      ...(options.sourceReference ? { sourceReference: options.sourceReference } : state.guidedIntent.draft.sourceReference ? { sourceReference: state.guidedIntent.draft.sourceReference } : {}),
      ...(options.importOnly ? {} : { intent: state.guidedIntent.draft.intent }),
    };
    state.guidedIntent = await api('/api/guided-intent/draft', { method: 'POST', body: JSON.stringify(body) });
    const currentPersonas = new Map((state.guidedIntent.activePersonas ?? []).map((persona) => [persona.id, persona.name]));
    const joined = [...currentPersonas].filter(([id]) => !previousPersonas.has(id)).map(([, name]) => name);
    const left = [...previousPersonas].filter(([id]) => !currentPersonas.has(id)).map(([, name]) => name);
    const changes = [joined.length ? `Joined: ${joined.join(', ')}.` : '', left.length ? `Left: ${left.join(', ')}.` : ''].filter(Boolean).join(' ');
    state.guidedIntentNotice = `Draft revision ${state.guidedIntent.draft.revision} saved. Active personas were reselected for ${currentIntentSection().title}.${changes ? ` ${changes}` : ' The active ensemble is unchanged.'}`;
  } catch (error) {
    state.guidedIntentError = error.message;
    state.guidedIntentNotice = '';
  } finally {
    state.guidedIntentLoading = false;
    renderGuidedIntent();
  }
}

function adjacentIntentSection(direction) {
  const sections = state.guidedIntent.sections;
  const index = sections.findIndex((section) => section.id === state.guidedIntent.draft.currentSection);
  return sections[Math.max(0, Math.min(sections.length - 1, index + direction))].id;
}

function updateGuidedIntentValue(control) {
  if (!state.guidedIntent || !control.dataset.intentPath) return;
  let value = control.value;
  if (control.dataset.intentType === 'list') value = value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  if (control.dataset.intentType === 'relationships') value = value.split(/\r?\n/).map((line) => line.split('|').map((part) => part.trim())).filter((parts) => parts.some(Boolean)).map(([type, target, rationale]) => ({ type, target, ...(rationale ? { rationale } : {}) }));
  if (control.dataset.intentPath.startsWith('deliveryShape.') && !state.guidedIntent.draft.intent.deliveryShape) state.guidedIntent.draft.intent.deliveryShape = { recommendation: '', reason: '', suggestedChildren: [], blockingQuestions: [], reviewedDecision: null };
  setValueAtPath(state.guidedIntent.draft.intent, control.dataset.intentPath, value);
  state.guidedIntentNotice = 'Unsaved changes. Save to refresh validation and engaged personas.';
  element('intentStudioNotice').hidden = false;
  element('intentStudioNotice').textContent = state.guidedIntentNotice;
}

async function discardGuidedIntentFromBrowser() {
  if (!state.guidedIntent?.draft.revision || !window.confirm('Discard only this project-local intent draft? Canonical intents will not be deleted.')) return;
  try {
    await api('/api/guided-intent/draft', { method: 'DELETE', body: JSON.stringify({ expectedRevision: state.guidedIntent.draft.revision, confirmed: true }) });
    state.guidedIntent = null;
    state.guidedIntentNotice = 'Draft discarded. Canonical intent records were untouched.';
    await loadGuidedIntent();
  } catch (error) { state.guidedIntentError = error.message; renderGuidedIntent(); }
}

async function approveGuidedIntentFromBrowser() {
  const approvedBy = element('intentStudioApprover')?.value ?? '';
  const confirmed = Boolean(element('intentStudioConfirmed')?.checked);
  state.guidedIntentLoading = true;
  state.guidedIntentError = '';
  try {
    state.guidedIntentCompleted = await api('/api/guided-intent/approve', { method: 'POST', body: JSON.stringify({ expectedRevision: state.guidedIntent.draft.revision, approvedBy, confirmed }) });
    state.guidedIntent = null;
    await loadBoard();
  } catch (error) { state.guidedIntentError = error.message; }
  finally { state.guidedIntentLoading = false; renderGuidedIntent(); }
}

async function copyGuidedIntentHandoff() {
  const workspace = state.guidedIntent;
  if (!workspace) return;
  const prompt = `Challenge guided intent revision ${workspace.draft.revision} as advisory review only. Do not approve intent, Build, Manual QA or release.\n\nReference: ${workspace.draft.intent.domain}/${workspace.draft.intent.slug}\nMode: ${workspace.draft.mode}\nBlocking items: ${workspace.validation.errors.map((error) => `${error.path}: ${error.message}`).join('; ') || 'none'}\nActive persona lenses: ${workspace.activePersonas.map((persona) => `${persona.name} (${persona.tier}): ${persona.engagementReason}`).join('; ')}\nDestinations: ${workspace.preview.destinations.join(', ')}`;
  try { await navigator.clipboard.writeText(prompt); state.guidedIntentNotice = 'Bounded advisory review hand-off copied. No model was called and no approval changed.'; }
  catch { state.guidedIntentNotice = 'Clipboard access was unavailable. Continue the review in this workspace.'; }
  renderGuidedIntent();
}

const hookRetryStatuses = new Set(['exhausted', 'rejected', 'incompatible']);
const hookAttentionStatuses = new Set(['retrying', 'exhausted', 'rejected', 'incompatible', 'disabled']);

function hookEventLabel(name) {
  return state.hooks?.catalogue.find((event) => event.name === name)?.label ?? name;
}

function hookStatusLabel(status) {
  return ({ succeeded: 'Delivered', exhausted: 'Exhausted', incompatible: 'Incompatible' })[status]
    ?? `${String(status ?? 'unknown')[0]?.toUpperCase() ?? ''}${String(status ?? 'unknown').slice(1)}`;
}

function hookEventFor(delivery) {
  return state.hooks?.events.find((event) => event.id === delivery?.eventId) ?? null;
}

function renderHookHandlers() {
  const handlers = state.hooks?.handlers ?? [];
  const subscriptions = state.hooks?.subscriptions ?? [];
  if (!handlers.length) return `<div class="hooks-empty"><strong>No handlers are installed.</strong><p>Installation is a trusted operator action. Start with <code>ewai hook validate FOLDER</code>, then follow <code>Docs/using-lifecycle-hooks.md</code>.</p></div>`;
  return handlers.map((handler) => {
    const connected = subscriptions.filter((subscription) => subscription.handlerId === handler.id);
    return `<article class="hook-handler-card">
      <header><div><strong>${escapeHtml(handler.name)}</strong><code>${escapeHtml(handler.id)}</code></div><span class="hook-digest">${escapeHtml(handler.digestStatus)}</span></header>
      <p>${escapeHtml(handler.publisher.name)} · v${escapeHtml(handler.version)} · protocol ${escapeHtml(handler.protocolVersion)} · event schema ${escapeHtml(handler.eventSchemaVersion)}</p>
      <code class="hook-digest-value">${escapeHtml(handler.packageDigest)}</code>
      ${connected.length ? connected.map((subscription) => `<div class="hook-subscription ${subscription.enabled ? 'enabled' : 'disabled'}">
        <span><b>${subscription.enabled ? 'Enabled' : 'Disabled'}</b>${subscription.patterns.map((pattern) => `<code>${escapeHtml(pattern)}</code>`).join('')}</span>
        ${subscription.enabled ? `<button type="button" class="secondary-action" data-dashboard-action="hook-disable" data-subscription-id="${escapeHtml(subscription.id)}" data-handler-name="${escapeHtml(handler.name)}">Disable future delivery</button>` : '<small>Historical deliveries remain visible.</small>'}
      </div>`).join('') : '<div class="hook-subscription disabled"><span><b>Not enabled</b><small>Subscribe with the CLI when the project is ready.</small></span></div>'}
    </article>`;
  }).join('');
}

function renderHookDetail(delivery) {
  if (!delivery) return '<div class="hooks-empty"><strong>Select a handoff.</strong><p>Inspect its stable identity, safe context, attempts, and diagnostic without exposing handler output.</p></div>';
  const event = hookEventFor(delivery);
  const attempts = (state.hooks?.attempts ?? []).filter((attempt) => attempt.deliveryId === delivery.id).sort((left, right) => left.ordinal - right.ordinal);
  return `<header><div><span class="eyebrow">Selected delivery</span><h3>${escapeHtml(hookEventLabel(delivery.eventName))}</h3></div><span class="hook-status status-${escapeHtml(delivery.status)}">${escapeHtml(hookStatusLabel(delivery.status))}</span></header>
    <p class="hook-boundary"><strong>The EWAI milestone remains unchanged.</strong> This status describes notification delivery only.</p>
    <dl class="hook-facts">
      <div><dt>Event</dt><dd><code>${escapeHtml(event?.id)}</code><small>${escapeHtml(event?.schema)} · sequence ${escapeHtml(delivery.stream.sequence)}</small></dd></div>
      <div><dt>Handler</dt><dd>${escapeHtml(delivery.handlerName)} <small>v${escapeHtml(delivery.handlerVersion)}</small><code>${escapeHtml(delivery.packageDigest)}</code></dd></div>
      <div><dt>Idempotency</dt><dd><code>${escapeHtml(delivery.idempotencyKey)}</code></dd></div>
      <div><dt>Scope</dt><dd>${Object.entries(event?.scope ?? {}).map(([key, value]) => `<span><b>${escapeHtml(key)}</b> ${escapeHtml(value)}</span>`).join('') || 'Project'}</dd></div>
    </dl>
    ${event?.evidence?.length ? `<section class="hook-context"><h4>Evidence references</h4>${event.evidence.map((reference) => `<code>${escapeHtml(reference)}</code>`).join('')}</section>` : ''}
    <section class="hook-context"><h4>Context carried with this event</h4>${event?.personas?.length ? `<div class="hook-personas">${event.personas.map((persona) => `<article data-tier="${escapeHtml(persona.tier)}"><header><strong>${escapeHtml(persona.name)}</strong><span>${escapeHtml(persona.tier)}</span></header><p>${escapeHtml(persona.reason)}</p></article>`).join('')}</div>` : '<p>No persona ensemble was attached to this milestone.</p>'}</section>
    <section class="hook-attempts"><h4>Attempts</h4>${attempts.length ? attempts.map((attempt) => `<article><span>Attempt ${attempt.ordinal} · ${escapeHtml(attempt.kind)}</span><strong>${escapeHtml(attempt.code || attempt.status)}</strong><p>${escapeHtml(attempt.message)}</p><small>${escapeHtml(timeAgo(attempt.completedAt))} · ${escapeHtml(attempt.durationMs)} ms</small></article>`).join('') : '<p>No invocation has started yet.</p>'}</section>
    ${hookRetryStatuses.has(delivery.status) ? `<button type="button" class="primary-action" data-dashboard-action="hook-retry" data-delivery-id="${escapeHtml(delivery.id)}" data-handler-name="${escapeHtml(delivery.handlerName)}">Retry notification</button>` : ''}`;
}

function renderHooks() {
  const notice = element('hooksNotice');
  notice.hidden = !state.hooksNotice && !state.hooksError;
  notice.classList.toggle('error', Boolean(state.hooksError));
  notice.textContent = state.hooksError || state.hooksNotice;
  if (!state.hooks) {
    element('hooksSummary').innerHTML = state.hooksLoading ? '<span>Loading hook ledger…</span>' : '<span>Status unavailable</span>';
    element('hookHandlers').innerHTML = '<div class="hooks-empty"><strong>Hook status is unavailable.</strong><p>EWAI will not infer successful delivery from missing runtime data.</p></div>';
    element('hookLedger').innerHTML = '';
    element('hookDetail').innerHTML = renderHookDetail(null);
    return;
  }
  const summary = state.hooks.summary;
  const attention = [...hookAttentionStatuses].reduce((total, status) => total + (summary[status] ?? 0), 0);
  if(element('hooksCount'))element('hooksCount').textContent = String(attention);
  element('hooksSummary').innerHTML = `<span><strong>${summary.subscriptions}</strong> connected</span><span><strong>${summary.succeeded}</strong> delivered</span><span class="${attention ? 'attention' : ''}"><strong>${attention}</strong> needs attention</span>`;
  element('hookHandlers').innerHTML = renderHookHandlers();
  element('hookEventFilter').innerHTML = `<option value="">All events</option>${state.hooks.catalogue.map((event) => `<option value="${escapeHtml(event.name)}">${escapeHtml(event.label)}</option>`).join('')}`;
  element('hookHandlerFilter').innerHTML = `<option value="">All handlers</option>${state.hooks.handlers.map((handler) => `<option value="${escapeHtml(handler.id)}">${escapeHtml(handler.name)}</option>`).join('')}`;
  element('hookStatusFilter').value = state.hookFilters.status;
  element('hookEventFilter').value = state.hookFilters.event;
  element('hookHandlerFilter').value = state.hookFilters.handler;
  const deliveries = [...state.hooks.deliveries].sort((left, right) => Number(hookAttentionStatuses.has(right.status)) - Number(hookAttentionStatuses.has(left.status)) || String(right.occurredAt).localeCompare(String(left.occurredAt)));
  if (!deliveries.some((delivery) => delivery.id === state.selectedHookDeliveryId)) state.selectedHookDeliveryId = deliveries[0]?.id ?? '';
  element('hookLedger').innerHTML = deliveries.length ? deliveries.map((delivery) => {
    const event = hookEventFor(delivery);
    return `<button type="button" class="hook-ledger-row ${delivery.id === state.selectedHookDeliveryId ? 'selected' : ''}" data-hook-delivery="${escapeHtml(delivery.id)}">
      <span class="hook-milestone"><small>Milestone</small><strong>${escapeHtml(hookEventLabel(delivery.eventName))}</strong><code>${escapeHtml(delivery.eventName)}</code><em>${escapeHtml(timeAgo(delivery.occurredAt))} · sequence ${escapeHtml(delivery.stream.sequence)}</em></span>
      <b aria-hidden="true">→</b>
      <span class="hook-handler"><small>Handler</small><strong>${escapeHtml(delivery.handlerName)}</strong><code>${escapeHtml(delivery.handlerId)}</code><em>${escapeHtml(event?.scope?.phase || event?.scope?.delivery || event?.scope?.intent || 'project')}</em></span>
      <b aria-hidden="true">→</b>
      <span class="hook-delivery"><small>Delivery</small><strong class="hook-status status-${escapeHtml(delivery.status)}">${escapeHtml(hookStatusLabel(delivery.status))}</strong><em>${delivery.automaticAttemptCount} automatic attempt${delivery.automaticAttemptCount === 1 ? '' : 's'}${delivery.nextAttemptAt ? ` · next ${escapeHtml(timeUntil(delivery.nextAttemptAt))}` : ''}</em><span>${escapeHtml(delivery.lastMessage || 'Awaiting delivery.')}</span></span>
    </button>`;
  }).join('') : '<div class="hooks-empty"><strong>No matching deliveries.</strong><p>Enabled subscriptions will appear here after a matching canonical EWAI milestone.</p></div>';
  element('hookDetail').innerHTML = renderHookDetail(deliveries.find((delivery) => delivery.id === state.selectedHookDeliveryId));
}

async function loadHooks() {
  state.hooksLoading = true;
  state.hooksError = '';
  renderHooks();
  try {
    const query = new URLSearchParams(Object.entries(state.hookFilters).filter(([, value]) => value));
    state.hooks = await api(`/api/hooks${query.size ? `?${query}` : ''}`);
  } catch (error) {
    state.hooks = null;
    state.hooksError = error.message;
  } finally {
    state.hooksLoading = false;
    renderHooks();
  }
}

function policyOutcomeLabel(value) {
  return String(value || 'unassessed').replaceAll('-', ' ');
}

function renderPolicy() {
  const workspace = state.policy;
  const error = element('policyError');
  error.hidden = !state.policyError;
  error.textContent = state.policyError;
  element('policyStatus').textContent = state.policyNotice || (state.policyLoading ? 'Loading current design-gate evidence…' : '');
  element('policyAuthorityNotice').textContent = workspace?.notices?.[0]
    || 'Organisation Policy Design Gates are design-time evidence only. They do not enforce production traffic, execute production code, certify compliance, approve Build or Manual QA, authorise release, or accept residual risk.';
  document.querySelectorAll('[data-policy-mode]').forEach((button) => {
    const active = button.dataset.policyMode === state.policyMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (!workspace) {
    element('policyWorkspace').innerHTML = '<div class="policy-empty"><strong>No policy workspace is selected.</strong><p>Choose an intent to inspect its optional design-time gate. Missing configuration does not create a hidden blocker.</p></div>';
    return;
  }
  if (workspace.intentReference) element('policyIntent').value = workspace.intentReference;
  const view = workspace.views[state.policyMode];
  const rules = workspace.policy?.matchedRules ?? [];
  const controls = view.controls ?? [];
  const facts = workspace.facts?.facts ?? [];
  const canEvaluate = workspace.baseline.enabled && workspace.facts?.factsDigest && workspace.facts?.intent?.revision;
  const pendingReviews = workspace.status === 'review-required'
    ? rules.filter((rule) => rule.outcome === 'review-required')
    : [];
  const businessPanel = `<section class="policy-panel policy-outcome-panel">
      <header><div><span class="eyebrow">Design outcome</span><h3>${escapeHtml(policyOutcomeLabel(view.outcome || workspace.status))}</h3></div><span class="policy-outcome status-${escapeHtml(workspace.status)}">${workspace.blocking ? 'Design action required' : 'No policy blocker'}</span></header>
      <p>${workspace.status === 'not-configured' ? 'Organisation policy gates are optional and have not been configured for this project.' : workspace.blocking ? 'Resolve the listed evidence, controls, review, or exception route before this design can pass its configured gate.' : 'The current design evidence satisfies the configured policy gate. Delivery authority remains separate.'}</p>
      ${view.nextActions?.length ? `<ul>${view.nextActions.map((action) => `<li>${escapeHtml(action)}</li>`).join('')}</ul>` : ''}
    </section>`;
  const technicalPanel = `<section class="policy-panel policy-digests">
      <header><div><span class="eyebrow">Exact evidence binding</span><h3>Current revisions</h3></div></header>
      <dl><div><dt>Policy</dt><dd><code>${escapeHtml(view.policyDigest || 'not configured')}</code></dd></div><div><dt>Facts</dt><dd><code>${escapeHtml(view.factsDigest || 'not recorded')}</code></dd></div><div><dt>Evaluation</dt><dd><code>${escapeHtml(view.evaluationDigest || 'not recorded')}</code></dd></div></dl>
    </section>`;
  const factsPanel = `<section class="policy-panel"><header><div><span class="eyebrow">Named-human evidence</span><h3>Confirmed design facts</h3></div><span>${facts.length}</span></header>${facts.length ? `<div class="policy-facts">${facts.map((fact) => `<article><strong>${escapeHtml(fact.dimension)}</strong><p>${fact.values.map(escapeHtml).join(' · ')}</p><small>${escapeHtml(fact.provenance?.kind || 'unknown source')}${fact.provenance?.persona ? ` · ${escapeHtml(fact.provenance.persona.name || fact.provenance.persona.id)}` : ''}</small></article>`).join('')}</div>` : '<p>No named-human-confirmed policy facts are recorded for this intent.</p>'}${canEvaluate ? '<button type="button" class="primary-action" data-policy-evaluate>Evaluate current design</button>' : ''}</section>`;
  const rulePanel = `<section class="policy-panel"><header><div><span class="eyebrow">Deterministic matching</span><h3>Matched rules and controls</h3></div><span>${rules.length}</span></header>${rules.length ? `<div class="policy-rules">${rules.map((rule) => `<article><header><strong>${escapeHtml(rule.title || rule.qualifiedRuleId)}</strong><span>${escapeHtml(policyOutcomeLabel(rule.outcome))}</span></header><code>${escapeHtml(rule.qualifiedRuleId)}</code>${rule.reviewRole ? `<small>Review role: ${escapeHtml(rule.reviewRole)}</small>` : ''}${rule.controls?.length ? `<ul>${rule.controls.map((control) => `<li>${escapeHtml(control.title || control.description || control.id)}</li>`).join('')}</ul>` : ''}</article>`).join('')}</div>` : '<p>No policy rules currently match this design.</p>'}${controls.length ? `<footer>${controls.length} control${controls.length === 1 ? '' : 's'} trace back to matched rules.</footer>` : ''}</section>`;
  const reviewPanel = pendingReviews.length ? `<section class="policy-panel policy-reviews"><header><div><span class="eyebrow">Accountable decision</span><h3>Required reviews</h3></div><span>${pendingReviews.length}</span></header>${pendingReviews.map((rule) => `<form data-policy-review="${escapeHtml(rule.qualifiedRuleId)}" data-review-role="${escapeHtml(rule.reviewRole)}"><strong>${escapeHtml(rule.title)}</strong><small>${escapeHtml(rule.reviewRole)} · personas advise, a named human decides</small><label><span>Reviewer</span><input name="reviewedBy" required maxlength="160"></label><label><span>Decision</span><select name="decision"><option value="allow">Allow</option><option value="allow-with-controls">Allow with controls</option><option value="deny">Deny</option></select></label><label class="wide"><span>Rationale</span><textarea name="rationale" required maxlength="2000"></textarea></label><label><span>Evidence reference</span><input name="evidence" required maxlength="500" placeholder="SPECS/3.Evidence/…"></label><label><span>Controls, comma separated</span><input name="controls" maxlength="2000"></label><button type="submit" class="primary-action">Record named review</button></form>`).join('')}</section>` : '';
  const personasPanel = `<aside class="policy-panel policy-personas"><header><div><span class="eyebrow">Current lenses</span><h3>Actively engaged personas</h3></div><span>${workspace.activePersonas.length}</span></header><p>These perspectives are advisory and change with the policy stage and facts.</p>${workspace.activePersonas.length ? workspace.activePersonas.map((persona) => `<article data-tier="${escapeHtml(persona.tier)}"><header><strong>${escapeHtml(persona.name)}</strong><span>${escapeHtml(persona.tier)}</span></header><p>${escapeHtml(persona.engagementReason)}</p><small>${(persona.matchedSignals ?? []).map(escapeHtml).join(' · ')}</small></article>`).join('') : '<div class="policy-empty"><strong>Core policy reasoning remains available.</strong><p>Install premium personas or add project personas for deeper specialist challenge.</p></div>'}</aside>`;
  element('policyWorkspace').innerHTML = `<div class="policy-main">${state.policyMode === 'business' ? businessPanel : technicalPanel}${factsPanel}${rulePanel}${reviewPanel}</div>${personasPanel}`;
}

async function loadPolicy() {
  state.policyLoading = true;
  state.policyError = '';
  renderPolicy();
  try {
    const query = new URLSearchParams({ mode: state.policyMode });
    if (state.policyIntent) query.set('intent', state.policyIntent);
    state.policy = await api(`/api/policies?${query}`);
    state.policyIntent = state.policy.intentReference || state.policyIntent;
  } catch (error) {
    state.policy = null;
    state.policyError = error.message;
  } finally {
    state.policyLoading = false;
    renderPolicy();
  }
}

async function evaluatePolicyFromWorkspace() {
  const workspace = state.policy;
  if (!workspace?.facts?.factsDigest || !workspace?.baseline?.effectiveDigest) return;
  state.policyNotice = 'Evaluating the confirmed design facts…';
  renderPolicy();
  try {
    const response = await api('/api/policies/evaluate', {
      method: 'POST',
      body: JSON.stringify({
        intentReference: workspace.intentReference,
        expectedIntentRevision: workspace.facts.intent.revision,
        expectedPolicyDigest: workspace.baseline.effectiveDigest,
        expectedFactsDigest: workspace.facts.factsDigest,
      }),
    });
    state.policy = response.workspace;
    state.policyNotice = 'The exact current design evidence was evaluated and recorded.';
  } catch (error) { state.policyError = error.message; state.policyNotice = ''; }
  renderPolicy();
}

async function submitPolicyReview(form) {
  const data = new FormData(form);
  const controls = String(data.get('controls') || '').split(',').map((value) => value.trim()).filter(Boolean);
  state.policyNotice = 'Recording the named review…';
  state.policyError = '';
  renderPolicy();
  try {
    const response = await api('/api/policies/reviews', {
      method: 'POST',
      body: JSON.stringify({
        intentReference: state.policy.intentReference,
        evaluationDigest: state.policy.policy.evaluationDigest,
        ruleId: form.dataset.policyReview,
        authority: 'human',
        reviewedBy: String(data.get('reviewedBy') || ''),
        reviewerRole: form.dataset.reviewRole,
        decision: String(data.get('decision') || ''),
        rationale: String(data.get('rationale') || ''),
        evidence: [String(data.get('evidence') || '')],
        controls,
      }),
    });
    state.policy = response.workspace;
    state.policyNotice = 'The named review was recorded against the exact evaluation.';
  } catch (error) { state.policyError = error.message; state.policyNotice = ''; }
  renderPolicy();
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function renderSecurity() {
  const workspace = state.security;
  const noticeMatches = workspace?.assurance_notice === securityAssuranceNotice;
  element('securityNotice').textContent = noticeMatches ? workspace.assurance_notice : securityAssuranceNotice;
  element('securityContractError').hidden = noticeMatches && !state.securityError;
  element('securityContractError').textContent = state.securityError
    || (!workspace ? 'The Security workspace is awaiting its server-owned assurance contract.' : 'Security workspace contract error: the mandatory server assurance notice is missing or altered.');
  const liveStatus = state.securityNotice || (state.securityLoading ? 'Loading current security evidence…' : '');
  element('securityStatus').textContent = liveStatus;
  element('securityStatus').hidden = !liveStatus;
  if (!workspace) {
    element('securitySummary').innerHTML = '<span>Status unavailable</span>';
    element('securityProviders').innerHTML = '<div class="security-empty"><strong>Security evidence is unavailable.</strong><p>No successful result is inferred from a missing workspace.</p></div>';
    element('securityPersonas').innerHTML = '';
    element('securityCoverage').innerHTML = '';
    element('securityRuns').innerHTML = '';
    element('securityFindings').innerHTML = '';
    return;
  }
  const readiness = workspace.readiness;
  element('securitySummary').innerHTML = `<span class="security-readiness status-${escapeHtml(readiness.status)}"><strong>${escapeHtml(readiness.status)}</strong><small>${readiness.profiles.filter((profile) => profile.status === 'current').length}/${readiness.profiles.filter((profile) => profile.required).length || 0} required profiles current</small></span>`;
  element('securityProviders').innerHTML = workspace.providers.map((provider) => {
    const profile = workspace.policy.profiles.find((candidate) => candidate.provider === provider.id && candidate.modes.includes('artifact-import'));
    const links = provider.official_sources.map((source) => safeExternalUrl(source)).filter(Boolean);
    return `<article class="security-provider" data-provider-state="${escapeHtml(provider.state)}">
      <header><div><strong>${escapeHtml(provider.name)}</strong><span>${escapeHtml(provider.publisher)}</span></div><b>${escapeHtml(provider.state)}</b></header>
      <p>${escapeHtml(provider.summary)}</p>
      <div class="security-tags">${provider.capabilities.map((capability) => `<span>${escapeHtml(capability)}</span>`).join('')}</div>
      <ul>${provider.cautions.map((caution) => `<li>${escapeHtml(caution)}</li>`).join('')}</ul>
      <footer>${links.map((source, index) => `<a href="${escapeHtml(source)}" target="_blank" rel="noreferrer">${index ? 'Package source' : 'Official source'}</a>`).join('')}
      ${provider.artifact_import_supported && provider.state === 'artefacts-detected' && profile ? `<button type="button" class="primary-action" data-security-import="${escapeHtml(provider.id)}" data-security-profile="${escapeHtml(profile.id)}">Review and import evidence</button>` : ''}</footer>
    </article>`;
  }).join('');
  element('securityPersonas').innerHTML = workspace.active_personas.length
    ? workspace.active_personas.map((persona) => `<article data-tier="${escapeHtml(persona.tier)}"><header><strong>${escapeHtml(persona.name)}</strong><span>${escapeHtml(persona.tier)}</span></header><p>${escapeHtml(persona.engagementReason)}</p><small>${persona.matchedSignals.map(escapeHtml).join(' · ')}</small></article>`).join('')
    : '<div class="security-empty"><strong>No matching persona is active.</strong><p>Core, project, personal and installed premium personas are considered without changing human authority.</p></div>';
  element('securityCoverage').innerHTML = readiness.profiles.length
    ? readiness.profiles.map((profile) => `<article class="security-coverage-row status-${escapeHtml(profile.status)}"><span><strong>${escapeHtml(profile.capability)}</strong><small>${escapeHtml(profile.id)} · ${profile.required ? 'required' : 'optional'} · ${escapeHtml(profile.accountableRole)}</small></span><b>${escapeHtml(profile.status)}</b>${workspace.policy.profiles.find((candidate) => candidate.id === profile.id)?.modes.includes('command') ? `<button type="button" class="secondary-action" data-security-run="${escapeHtml(profile.id)}">Run configured adapter</button>` : ''}</article>`).join('')
    : '<div class="security-empty"><strong>Security validation is not configured.</strong><p>Existing delivery semantics remain unchanged until the project adopts required capability profiles.</p></div>';
  element('securityRuns').innerHTML = workspace.runs.length
    ? workspace.runs.slice(0, 20).map((run) => `<article class="security-run status-${escapeHtml(run.status)}"><div><strong>${escapeHtml(run.profileId)} · ${escapeHtml(run.capability)}</strong><small>${escapeHtml(run.interactionMode)} · ${escapeHtml(run.revision.slice(0, 24))}${run.revision.length > 24 ? '…' : ''}</small></div><span><b>${escapeHtml(run.status)}</b><small>${escapeHtml(run.completedAt || run.startedAt || run.createdAt)}</small></span>${['prepared', 'running'].includes(run.status) ? `<button type="button" class="secondary-action" data-security-cancel="${escapeHtml(run.id)}">Cancel run</button>` : ''}</article>`).join('')
    : '<div class="security-empty"><strong>No security runs are recorded.</strong><p>A prepared handoff is not shown as successful evidence.</p></div>';
  element('securityFindings').innerHTML = workspace.findings.length
    ? workspace.findings.map((finding) => `<article class="security-finding"><header><div><strong>${escapeHtml(finding.id)} · ${escapeHtml(finding.summary)}</strong><span>Scanner: ${escapeHtml(finding.providerSeverity)} · Policy: ${escapeHtml(finding.policyConsequence)}</span></div><b>${escapeHtml(finding.capability)}</b></header><p>${escapeHtml(finding.remediation || 'Human review is required.')}</p><div class="security-evidence">${finding.locations.map((location) => `<code>${escapeHtml(location)}</code>`).join('')}</div><details><summary>Record an accountable decision</summary><form data-security-disposition="${escapeHtml(finding.recordId)}"><label><span>Decision</span><select name="decision" required><option value="remediate">Remediate</option><option value="false-positive">False positive</option><option value="accept-risk">Accept risk</option><option value="escalate">Escalate</option></select></label><label><span>Reviewer</span><input name="reviewer" required maxlength="160"></label><label><span>Reason</span><textarea name="reason" required maxlength="2000"></textarea></label><label><span>Evidence references</span><input name="evidence" placeholder="SPECS/path.md, src/file.mjs:12"></label><label><span>Risk owner, when accepting risk</span><input name="riskOwner"></label><label><span>Expiry, when accepting risk</span><input name="expiresAt" type="datetime-local"></label><label><span>Next role, when escalating</span><input name="nextRole"></label><button type="submit" class="primary-action">Record decision</button></form></details>${finding.dispositions.length ? `<div class="security-decision-history">${finding.dispositions.map((decision) => `<span><strong>${escapeHtml(decision.decision)}</strong> by ${escapeHtml(decision.reviewer)} · ${escapeHtml(decision.createdAt)}</span>`).join('')}</div>` : ''}</article>`).join('')
    : '<div class="security-empty"><strong>No findings are recorded.</strong><p>This means no normalised findings are present. It is not certification that the system is secure.</p></div>';
}

function renderTeamHub() {
  const workspace = state.teamHub;
  const liveStatus = state.teamHubNotice || state.teamHubError || (state.teamHubLoading ? 'Loading Team Hub state…' : '');
  element('teamHubStatus').textContent = liveStatus;
  element('teamHubStatus').hidden = !liveStatus;
  element('teamHubStatus').dataset.state = state.teamHubError ? 'error' : 'notice';
  if (!workspace) {
    element('teamHubMode').textContent = 'State unavailable';
    element('teamHubDisclosure').innerHTML = '<strong>Disclosure unavailable</strong><span>No remote publication is inferred from a failed local read.</span>';
    element('teamHubConnection').innerHTML = '<p>Retry the local dashboard before configuring a connection.</p>';
    element('teamHubConnectForm').hidden = false;
    element('teamHubContractFields').innerHTML = '';
    element('teamHubAuthority').textContent = '';
    return;
  }
  const connected = workspace.mode === 'connected' && workspace.connection;
  element('teamHubMode').textContent = connected ? 'Connected contributor' : 'Single contributor';
  element('teamHubMode').dataset.mode = workspace.mode;
  element('teamHubDisclosure').innerHTML = `<strong>Nothing is sent automatically</strong><span>${escapeHtml(workspace.disclosure.title)} · contract ${escapeHtml(workspace.disclosure.contractDigest)}</span>`;
  element('teamHubConnection').innerHTML = connected
    ? `<dl><div><dt>Endpoint</dt><dd>${escapeHtml(workspace.connection?.endpoint)}</dd></div><div><dt>Project</dt><dd>${escapeHtml(workspace.connection?.projectId)}</dd></div><div><dt>Credential source</dt><dd>${escapeHtml(workspace.connection?.tokenEnv)}</dd></div></dl>`
    : '<p>This project is local-only. Connect only after the hub operator has supplied an HTTPS endpoint and environment-variable name.</p>';
  element('teamHubConnectForm').hidden = Boolean(connected);
  document.querySelector('[data-team-hub-sync]').hidden = !connected;
  document.querySelector('[data-team-hub-disconnect]').hidden = !connected;

  const attempt = workspace.lastAttempt;
  element('teamHubLastAttempt').innerHTML = attempt
    ? `<strong>${escapeHtml(attempt.status)} sync attempt</strong><p>${escapeHtml(attempt.at)} · ${escapeHtml(attempt.snapshotDigest)}</p>${attempt.error ? `<small>${escapeHtml(attempt.error.message)}</small>` : ''}`
    : '<strong>No sync attempt recorded</strong><p>An attempt appears only after an explicit publish action.</p>';
  const receipt = workspace.lastAcceptedReceipt;
  element('teamHubAcceptedReceipt').innerHTML = receipt
    ? `<strong>Snapshot accepted by hub</strong><p>${escapeHtml(receipt.acceptedAt)} · ${escapeHtml(receipt.receiptId)}</p><small>${receipt.replayed ? 'Idempotent replay' : 'New receipt'} · not approval</small>`
    : '<strong>No accepted receipt recorded</strong><p>A receipt proves transport acceptance, not approval or delivery completion.</p>';
  element('teamHubContractFields').innerHTML = `<div><h4>Included</h4><ul>${workspace.disclosure.fields.map((field) => `<li><code>${escapeHtml(field)}</code></li>`).join('')}</ul></div><div><h4>Excluded</h4><ul>${workspace.disclosure.excluded.map((field) => `<li><code>${escapeHtml(field)}</code></li>`).join('')}</ul></div>`;
  element('teamHubAuthority').textContent = workspace.authorityNotice;
  renderTeamHubResources();
}

function renderTeamHubResources() {
  const list = element('teamHubResourceList');
  const detail = element('teamHubResourceDetail');
  if (!list || !detail) return;
  const catalogue = state.teamHubResources;
  list.innerHTML = catalogue?.releases?.length
    ? catalogue.releases.map((release) => `<button type="button" data-team-hub-resource-inspect="${escapeHtml(release.id)}" data-version="${escapeHtml(release.version)}"><span><strong>${escapeHtml(release.name)}</strong><small>${escapeHtml(release.kind.replaceAll('-', ' '))} · v${escapeHtml(release.version)}</small></span><code>${escapeHtml(release.digest)}</code></button>`).join('')
    : `<p>${state.teamHub?.mode === 'connected' ? 'No catalogue loaded. Use Refresh resources.' : 'Connect this project before reading the resource catalogue.'}</p>`;
  const inspection = state.teamHubResourceInspection;
  if (!inspection) {
    detail.innerHTML = '<p>Inspection never installs a resource. Choose a release to review its exact identity and files.</p>';
    return;
  }
  const resource = inspection.resource;
  const releaseChain = (catalogue?.releases ?? []).filter(({ id }) => id === resource.id);
  const packageBytes = inspection.files.reduce((sum, file) => sum + file.size, 0);
  detail.innerHTML = `<header><span class="eyebrow">${escapeHtml(resource.kind)}</span><h4>${escapeHtml(resource.name)}</h4><code>${escapeHtml(resource.id)}@${escapeHtml(resource.version)}</code></header>
    <dl><div><dt>Publisher</dt><dd>${escapeHtml(resource.publisher.name)}</dd></div><div><dt>EWAI</dt><dd>${escapeHtml(resource.compatibility.ewai)}</dd></div><div><dt>Digest</dt><dd>${escapeHtml(inspection.digest)}</dd></div><div><dt>Package bounds</dt><dd>${inspection.files.length} files · ${packageBytes} bytes</dd></div><div><dt>Local state</dt><dd>${inspection.installed ? `v${escapeHtml(inspection.installed.version)} installed` : 'Not installed'}</dd></div></dl>
    <details><summary>Retained versions</summary><ul>${releaseChain.map((release) => `<li><code>v${escapeHtml(release.version)}</code><span>${escapeHtml(release.digest)}</span></li>`).join('')}</ul></details>
    <details><summary>${inspection.files.length} verified package files</summary><ul>${inspection.files.map((file) => `<li><code>${escapeHtml(file.path)}</code><span>${escapeHtml(file.digest)}</span></li>`).join('')}</ul></details>
    <form id="teamHubResourceInstallForm" class="team-hub-resource-install-form"><input type="hidden" name="id" value="${escapeHtml(resource.id)}"><input type="hidden" name="version" value="${escapeHtml(resource.version)}"><input type="hidden" name="expectedDigest" value="${escapeHtml(inspection.digest)}"><label><span>Approver</span><input name="approvedBy" required maxlength="160" placeholder="Named person or accountable role"></label><label class="team-hub-acknowledgement"><input name="confirmed" type="checkbox" required><span>Install this exact digest. I understand this does not select or apply it.</span></label><button type="submit" class="primary-action">Install exact release</button></form>`;
}

async function loadTeamHub() {
  state.teamHubLoading = true;
  state.teamHubError = '';
  renderTeamHub();
  try { state.teamHub = await api('/api/team-hub'); }
  catch (error) { state.teamHub = null; state.teamHubError = error.message; }
  finally { state.teamHubLoading = false; renderTeamHub(); }
}

function renderErrorReports() {
  const workspace = state.errorReports;
  const status = state.errorReportNotice || (state.errorReportLoading ? 'Loading local error reports…' : '');
  element('errorReportStatus').textContent = status;
  element('errorReportStatus').hidden = !status;
  if (!workspace) {
    element('errorReportList').innerHTML = '<div class="error-report-empty"><strong>Error-report state is unavailable.</strong><p>No successful capture or transmission is inferred.</p><button type="button" data-report-problem>Report this problem</button></div>';
    element('errorReportViewer').innerHTML = '<div class="error-report-empty"><strong>Nothing has been sent.</strong><p>Retry the local workspace or create a bounded draft from this problem.</p></div>';
    return;
  }
  element('errorReportAutomaticDrafts').checked = workspace.settings.automaticLocalDrafts;
  element('errorReportFilter').value = state.errorReportFilter || '';
  element('errorReportList').innerHTML = workspace.reports.length
    ? workspace.reports.map((report) => `<button type="button" class="error-report-row ${report.id === state.selectedErrorReportId ? 'active' : ''}" data-error-report-select="${escapeHtml(report.id)}"><span><strong>${escapeHtml(report.description.title)}</strong><small>${escapeHtml(report.diagnostics.capability)} · revision ${escapeHtml(report.revision)}</small></span><b data-state="${escapeHtml(report.status)}">${escapeHtml(report.status)}</b><code>${escapeHtml(report.id)}</code></button>`).join('')
    : '<div class="error-report-empty"><strong>No local reports.</strong><p>Create a report manually or opt into automatic local drafts. Neither action sends anything.</p></div>';

  const detail = state.errorReportDetail;
  const report = detail?.report;
  if (!report) {
    element('errorReportViewer').innerHTML = '<div class="error-report-empty"><strong>Select a report to inspect its custody.</strong><p>Package contents, redactions, attempts and receipts appear here.</p></div>';
    return;
  }
  const finalised = report.status === 'finalised';
  const preparation = state.errorReportEmail?.reportId === report.id ? state.errorReportEmail : null;
  const custody = [
    ['Local draft', report.status === 'draft' ? 'current' : 'complete'],
    ['ZIP finalised', finalised || report.status === 'archived' ? 'complete' : 'pending'],
    ['Email prepared', preparation ? 'complete' : 'pending'],
    ['Provider accepted', detail.receipts?.length ? 'complete' : 'pending'],
  ];
  const providers = workspace.providers ?? [];
  const providerActions = finalised && providers.length
    ? `<label class="error-report-provider-select"><span>Registered provider</span><select id="errorReportProvider">${providers.map((provider) => `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.name)}</option>`).join('')}</select></label><button type="button" class="primary-action" data-error-report-provider="${escapeHtml(report.id)}">Send exact package</button>`
    : finalised ? '<p class="error-report-provider-empty">No provider adapter is registered. The ZIP and email route remain fully usable.</p>' : '';
  const packageMembers = ['manifest.json', 'summary.md', 'diagnostics.json', 'redaction-report.json', ...(report.attachments ?? []).map(({ name }) => `attachments/${name}`)];
  element('errorReportViewer').innerHTML = `
    <header class="error-report-viewer-heading"><div><span class="eyebrow">${escapeHtml(report.diagnostics.errorCode)}</span><h3>${escapeHtml(report.description.title)}</h3><p>${escapeHtml(report.id)} · revision ${escapeHtml(report.revision)}</p></div><b data-state="${escapeHtml(report.status)}">${escapeHtml(report.status)}</b></header>
    <div class="error-report-custody" aria-label="Report custody">${custody.map(([label, value]) => `<span data-state="${value}"><i aria-hidden="true"></i><b>${label}</b></span>`).join('')}</div>
    ${preparation ? `<div class="error-report-email-state" role="status"><strong>Email prepared — not sent</strong><p>${escapeHtml(preparation.message)}</p><code>${escapeHtml(preparation.packageReference)}</code></div>` : ''}
    <div class="error-report-detail-grid">
      <section><span class="eyebrow">Human evidence</span><h4>What happened</h4><dl><div><dt>Expected</dt><dd>${escapeHtml(report.description.expected || 'Not supplied')}</dd></div><div><dt>Actual</dt><dd>${escapeHtml(report.description.actual || 'Not supplied')}</dd></div></dl><ol>${report.description.reproductionSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join('') || '<li>No reproduction steps supplied.</li>'}</ol></section>
      <section><span class="eyebrow">Closed allowlist</span><h4>Package contents</h4><ul class="error-report-members">${packageMembers.map((name) => `<li><code>${escapeHtml(name)}</code></li>`).join('')}</ul>${report.package ? `<dl class="error-report-digests"><div><dt>Archive digest</dt><dd><code>${escapeHtml(report.package.archiveDigest)}</code></dd></div><div><dt>Size</dt><dd>${escapeHtml(report.package.size)} bytes</dd></div></dl>` : '<p>The ZIP is created only when you finalise this draft.</p>'}</section>
      <section><span class="eyebrow">Privacy boundary</span><h4>Redaction summary</h4>${report.redactions.classes.length ? `<ul>${report.redactions.classes.map((name) => `<li><strong>${escapeHtml(name)}</strong><span>${escapeHtml(report.redactions.counts[name])} excluded</span></li>`).join('')}</ul>` : '<p>No excluded values were supplied to this report. Source, SPECS, prompts, environment values, credentials, persona bodies, repository names and raw logs remain outside the default allowlist.</p>'}</section>
      <section><span class="eyebrow">Handoff evidence</span><h4>Attempts and receipts</h4>${detail.attempts?.length ? detail.attempts.map((attempt) => `<article class="error-report-attempt" data-state="${escapeHtml(attempt.status)}"><strong>${escapeHtml(attempt.providerId)}</strong><span>${escapeHtml(attempt.status)}${attempt.reason ? ` · ${escapeHtml(attempt.reason)}` : ''}</span><code>${escapeHtml(attempt.archiveDigest)}</code></article>`).join('') : '<p>No provider attempt has been made.</p>'}${detail.receipts?.length ? detail.receipts.map((receipt) => `<article class="error-report-receipt"><strong>${escapeHtml(receipt.externalReference)}</strong><span>Transport accepted · not issue resolution</span><code>${escapeHtml(receipt.archiveDigest)}</code></article>`).join('') : ''}</section>
    </div>
    <footer class="error-report-actions">
      ${report.status === 'draft' ? `<button type="button" class="primary-action" data-error-report-finalise="${escapeHtml(report.id)}">Finalise deterministic ZIP</button>` : ''}
      ${finalised ? `<button type="button" class="secondary-action" data-error-report-copy-package="${escapeHtml(report.id)}">Copy package location</button><button type="button" class="secondary-action" data-error-report-email="${escapeHtml(report.id)}">Prepare email</button>${providerActions}` : ''}
      ${report.status !== 'archived' ? `<button type="button" class="quiet-button" data-error-report-archive="${escapeHtml(report.id)}">Archive local material</button>` : ''}
      <button type="button" class="danger-action" data-error-report-delete="${escapeHtml(report.id)}">Delete local material</button>
    </footer>`;
}

async function loadErrorReports(status = state.errorReportFilter || '') {
  state.errorReportLoading = true;
  state.errorReportNotice = '';
  renderErrorReports();
  try {
    state.errorReportFilter = status;
    state.errorReports = await api(`/api/error-reports${status ? `?status=${encodeURIComponent(status)}` : ''}`);
    if (!state.errorReports.reports.some(({ id }) => id === state.selectedErrorReportId)) state.selectedErrorReportId = state.errorReports.reports[0]?.id || '';
    state.errorReportDetail = state.selectedErrorReportId ? await api(`/api/error-reports/${encodeURIComponent(state.selectedErrorReportId)}`) : null;
  } catch (error) {
    state.errorReports = null;
    state.errorReportDetail = null;
    state.errorReportNotice = error.message;
  } finally {
    state.errorReportLoading = false;
    renderErrorReports();
  }
}

async function selectErrorReport(reportId) {
  state.selectedErrorReportId = reportId;
  state.errorReportDetail = await api(`/api/error-reports/${encodeURIComponent(reportId)}`);
  renderErrorReports();
}

async function reportProblem() {
  setView('error-reporting');
  element('errorReportCreateForm').hidden = false;
  const form = element('errorReportCreateForm');
  form.elements.capability.value = 'dashboard';
  form.elements.errorCode.value = 'EWAI-DASHBOARD-ERROR';
  form.elements.command.value = 'ewai dashboard';
  form.elements.title.value = 'The local dashboard showed an error';
  form.elements.actual.value = 'A bounded error was shown. Add safe reproduction details before saving.';
  form.elements.title.focus();
}

async function loadSecurity() {
  state.securityLoading = true;
  state.securityError = '';
  state.securityNotice = '';
  renderSecurity();
  try {
    state.security = await api('/api/security-validation');
  } catch (error) {
    state.security = null;
    state.securityError = error.message;
  } finally {
    state.securityLoading = false;
    renderSecurity();
  }
}

function renderContextInspector() {
  const manifest = state.contextManifest;
  const status = element('contextInspectorStatus');
  status.textContent = state.contextError || state.contextNotice || (state.contextLoading ? 'Preparing a body-free context manifest…' : 'Choose a profile and intent to inspect its bounded context.');
  status.classList.toggle('error', Boolean(state.contextError));
  const overflow = manifest?.reason === 'mandatory-overflow';
  element('contextOverflowAlert').hidden = !overflow;
  element('contextOverflowAlert').textContent = overflow
    ? `Mandatory evidence exceeds this budget by ${manifest.budget.overflowTokens} estimated tokens. No model payload or downstream handoff is available. Narrow the focus, increase the budget, or split the operation.`
    : '';
  if (!manifest) {
    element('contextInspectorSummary').innerHTML = '<span>Awaiting manifest</span>';
    element('contextBudgetRunway').innerHTML = '<div class="context-inspector-empty"><strong>No context has been prepared.</strong><p>The inspector never exposes source bodies.</p></div>';
    element('contextEvidenceLedger').innerHTML = '';
    element('contextFidelityRail').innerHTML = '<div class="context-inspector-empty"><strong>Fidelity not measured.</strong><p>No success is inferred from missing evidence.</p></div>';
    element('contextActivePersonas').innerHTML = '<div class="context-inspector-empty"><strong>No personas are engaged yet.</strong><p>The relevant ensemble is selected when context is prepared.</p></div>';
    return;
  }

  const budgetPercent = Math.min(100, Math.round((manifest.budget.usedTokens / Math.max(1, manifest.budget.limitTokens)) * 100));
  element('contextInspectorSummary').innerHTML = `<span class="context-manifest-status status-${escapeHtml(manifest.status)}"><strong>${escapeHtml(manifest.status)}</strong><small>${escapeHtml(manifest.profileLabel)}</small></span><span><strong>${budgetPercent}%</strong><small>budget demand</small></span><span><strong>${Math.round(manifest.fidelity.mandatoryRecall * 100)}%</strong><small>mandatory recall</small></span>`;
  element('contextBudgetRunway').innerHTML = manifest.segments.map((segment, index) => {
    const disposition = segment.disposition;
    return `<article class="context-budget-segment ${escapeHtml(segment.evidenceClass)} ${escapeHtml(disposition)}" aria-current="${index === 0 ? 'true' : 'false'}"><span aria-hidden="true"></span><div><strong>${escapeHtml(segment.label)}</strong><small>${escapeHtml(segment.evidenceClass)} · ${escapeHtml(disposition)} · ${segment.estimatedTokens} estimated tokens</small></div></article>`;
  }).join('');
  element('contextEvidenceLedger').innerHTML = `<header><span>Evidence ledger</span><code>${escapeHtml(manifest.digest)}</code></header>${manifest.segments.map((segment) => `<article><div><strong>${escapeHtml(segment.id)}</strong><small>${escapeHtml(segment.sourcePath)}</small></div><span>${escapeHtml(segment.selectionReason)}</span><code>${escapeHtml(segment.fragmentDigest)}</code></article>`).join('')}<footer><span>Added ${manifest.delta.addedSegments.length}</span><span>Changed ${manifest.delta.changedSegments.length}</span><span>Reused ${manifest.delta.retainedSegments.length}</span><span>Removed ${manifest.delta.removedSegments.length}</span></footer>`;
  element('contextFidelityRail').innerHTML = `<div class="context-fidelity-summary status-${escapeHtml(manifest.fidelity.status)}"><strong>${escapeHtml(manifest.fidelity.status)}</strong><span>${manifest.fidelity.presentCount}/${manifest.fidelity.requiredCount} mandatory markers present</span></div><ul>${manifest.fidelity.checks.map((check) => `<li class="status-${escapeHtml(manifest.fidelity.status)}"><b aria-hidden="true">${manifest.fidelity.status === 'pass' ? '✓' : '!'}</b><span>${escapeHtml(check)}</span></li>`).join('')}</ul><p>Estimated demand uses <code>${escapeHtml(manifest.budget.estimateMethod)}</code>. Provider-reported usage remains separate.</p>`;
  element('contextActivePersonas').innerHTML = manifest.activePersonas.length
    ? manifest.activePersonas.map((persona) => `<article data-tier="${escapeHtml(persona.tier)}"><header><strong>${escapeHtml(persona.name)}</strong><span>${escapeHtml(persona.tier)}</span></header><p>${escapeHtml(persona.engagementReason)}</p><small>${persona.matchedSignals.map(escapeHtml).join(' · ') || 'Relevant project lens'}</small></article>`).join('')
    : '<div class="context-inspector-empty"><strong>No matching persona is active.</strong><p>Core, project, personal and installed premium personas were considered. Human accountability is unchanged.</p></div>';
}

async function prepareContextInspector(form) {
  const values = Object.fromEntries(new FormData(form));
  const input = Object.fromEntries(Object.entries(values).filter(([, value]) => String(value).trim()));
  input.budgetTokens = Number(input.budgetTokens);
  state.contextLoading = true;
  state.contextError = '';
  state.contextNotice = '';
  renderContextInspector();
  try {
    state.contextManifest = await api('/api/context-packs/prepare', {
      method: 'POST', body: JSON.stringify(input),
    });
    state.contextNotice = state.contextManifest.status === 'ready'
      ? `Manifest ${state.contextManifest.digest.slice(0, 12)} prepared. Source bodies remain private to the local runtime.`
      : 'Context is non-ready. Engineering constraints were preserved and no model payload was produced.';
  } catch (error) {
    state.contextManifest = null;
    state.contextError = error.message;
  } finally {
    state.contextLoading = false;
    renderContextInspector();
  }
}

function renderStarters() {
  const workspace = state.starters;
  const liveStatus = state.startersNotice || state.startersError || (state.startersLoading ? 'Loading Governed Starter Pack state…' : '');
  element('starterStatus').textContent = liveStatus;
  element('starterStatus').hidden = !liveStatus;
  element('starterNotice').textContent = workspace?.notice ?? 'Governed Starter Pack materialisation uses trusted local adapter code, adds only missing content, and requires named human approval. Results are evidence, not security, quality, licence or release approval.';
  if (!workspace) {
    element('starterSummary').innerHTML = '<span>Status unavailable</span>';
    element('starterPersonas').innerHTML = '';
    element('starterPrepare').innerHTML = '<div class="starter-empty"><strong>Starter state is unavailable.</strong><p>No successful preparation or application is inferred.</p></div>';
    element('starterAttempts').innerHTML = '';
    return;
  }
  element('starterSummary').innerHTML = `<span><strong>${workspace.receipts.length}</strong> receipts</span><span><strong>${workspace.adapters.length}</strong> adapters</span><span><strong>${workspace.attempts.length}</strong> attempts</span>`;
  element('starterPersonas').innerHTML = workspace.activePersonas.length
    ? workspace.activePersonas.map((persona) => `<article class="starter-persona" data-tier="${escapeHtml(persona.tier)}"><header><strong>${escapeHtml(persona.name)}</strong><span>${escapeHtml(persona.tier)}</span></header><p>${escapeHtml(persona.reason)}</p></article>`).join('')
    : '<div class="starter-empty"><strong>No relevant persona is available.</strong><p>Install or define project personas, or restore the core library. Human approval remains required.</p></div>';
  const canPrepare = workspace.receipts.length && workspace.adapters.length;
  element('starterPrepare').innerHTML = canPrepare ? `<form id="starterPreviewForm" class="starter-form">
    <label><span>Governed Starter Pack</span><select name="receiptId" required>${workspace.receipts.map((receipt) => `<option value="${escapeHtml(receipt.id)}">${escapeHtml(receipt.name)} · ${escapeHtml(receipt.version)}</option>`).join('')}</select></label>
    <label><span>Trusted adapter</span><select name="adapterId" required>${workspace.adapters.map((adapter) => `<option value="${escapeHtml(adapter.id)}">${escapeHtml(adapter.name)} · ${escapeHtml(adapter.version)}</option>`).join('')}</select></label>
    <label class="starter-confirm"><input name="confirmed" type="checkbox" required><span>I understand the adapter runs as trusted local code and the preview does not approve its output.</span></label>
    <button type="submit" class="primary-action">Prepare immutable preview</button>
  </form>` : `<div class="starter-empty"><strong>${workspace.receipts.length ? 'No trusted adapter is registered.' : 'No accepted Governed Starter Pack is available.'}</strong><p>${workspace.receipts.length ? 'Use the CLI to validate and explicitly register an organisation-owned adapter package.' : 'Accept an Organisation Blueprint containing a compatible Starter Pack first.'}</p></div>`;
  element('starterAttempts').innerHTML = workspace.attempts.length ? workspace.attempts.map((attempt) => {
    const counts = attempt.classifications;
    const targets = attempt.targets.map((target) => `<li><strong>${escapeHtml(target.role)}</strong><span>${escapeHtml(target.repository)} · ${escapeHtml(target.path)}</span><small>${target.files} files · ${target.classifications.create} create · ${target.classifications.identical} identical · ${target.classifications.conflict} conflict</small></li>`).join('');
    const approval = attempt.status === 'prepared' && counts.conflict === 0 ? `<form class="starter-apply-form" data-starter-apply="${escapeHtml(attempt.previewId)}"><label><span>Named approver</span><input name="approvedBy" required maxlength="160" autocomplete="name"></label><label class="starter-confirm"><input name="confirmed" type="checkbox" required><span>I reviewed this immutable summary and authorise additive creation.</span></label><button type="submit" class="primary-action">Apply missing content</button></form>` : '';
    const recovery = attempt.status === 'recovery-required' ? `<button type="button" class="secondary-action" data-starter-recover="${escapeHtml(attempt.attemptId)}">Retry safe recovery</button>` : '';
    return `<article class="starter-attempt status-${escapeHtml(attempt.status)}"><header><div><strong>${escapeHtml(attempt.receiptId)}</strong><small>${escapeHtml(attempt.attemptId)}</small></div><b>${escapeHtml(attempt.status)}</b></header><div class="starter-counts"><span><strong>${counts.create}</strong> create</span><span><strong>${counts.identical}</strong> identical</span><span><strong>${counts.conflict}</strong> conflict</span></div><ul>${targets}</ul>${attempt.expiresAt && attempt.status === 'prepared' ? `<p class="starter-expiry">Approval expires ${escapeHtml(timeUntil(attempt.expiresAt))}.</p>` : ''}${attempt.evidence ? `<p class="starter-evidence">Evidence: <code>${escapeHtml(attempt.evidence)}</code></p>` : ''}${approval}${recovery}</article>`;
  }).join('') : '<div class="starter-empty"><strong>No materialisation attempts yet.</strong><p>Prepare a preview to classify destinations without changing a repository.</p></div>';
}

async function loadStarters() {
  state.startersLoading = true;
  state.startersError = '';
  renderStarters();
  try {
    state.starters = await api('/api/starter-materialisation');
  } catch (error) {
    state.starters = null;
    state.startersError = error.message;
  } finally {
    state.startersLoading = false;
    renderStarters();
  }
}

function selectedCompanionRecommendation() {
  const recommendations = state.companion?.recommendations ?? [];
  return recommendations.find((recommendation) => recommendation.id === state.companionSelection)
    ?? state.companion?.spotlight
    ?? recommendations[0]
    ?? null;
}

function companionDecisionCopy(recommendation) {
  if (!recommendation) return '';
  if (recommendation.class === 'human-decision') return '<strong>A person must decide.</strong> Companion guidance cannot grant approval, complete Manual QA or create human acceptance.';
  if (recommendation.class === 'blocked') return '<strong>Recovery is required.</strong> No governed begin or continue hand-off is currently permitted.';
  return '<strong>A guarded hand-off is available.</strong> Current permission is rechecked when the hand-off is submitted.';
}

function renderCompanionContext(recommendation) {
  if (!recommendation) return '<div class="companion-empty"><strong>No project work is ready for Companion review.</strong><p>Capture or initialise an intent to establish a governed delivery context.</p></div>';
  const blockers = recommendation.blockers.length
    ? `<section class="companion-blockers"><h4>Bounded blockers</h4><ul>${recommendation.blockers.map((blocker) => `<li><strong>${escapeHtml(blocker.code)}</strong><span>${escapeHtml(blocker.message)}</span></li>`).join('')}</ul></section>`
    : '';
  const handoff = recommendation.handoff
    ? `<button type="button" class="primary-action companion-handoff" data-companion-handoff="${escapeHtml(recommendation.id)}" data-handoff-kind="${escapeHtml(recommendation.handoff.kind)}">${escapeHtml(recommendation.handoff.label)}</button>`
    : '';
  return `<header><span class="eyebrow">Selected ${escapeHtml(recommendation.class)}</span><h3>${escapeHtml(recommendation.title)}</h3><p>${escapeHtml(recommendation.reason)}</p></header>
    <dl class="companion-facts"><div><dt>Current phase</dt><dd>${escapeHtml(recommendation.phase || 'not started')}</dd></div><div><dt>Progress</dt><dd>${escapeHtml(recommendation.progress)}%</dd></div><div><dt>Permission</dt><dd>${recommendation.handoff ? `${escapeHtml(recommendation.handoff.kind)} hand-off` : 'No direct action'}</dd></div><div><dt>Accountable route</dt><dd>${escapeHtml(recommendation.accountableRoute)}</dd></div></dl>
    <p class="companion-decision ${recommendation.class === 'blocked' ? 'blocked' : ''}">${companionDecisionCopy(recommendation)}</p>
    ${blockers}${handoff}`;
}

function renderCompanion() {
  const workspace = state.companion;
  const noticesMatch = workspace?.notices?.advisory === companionAdvisoryNotice
    && workspace?.notices?.security === securityAssuranceNotice;
  element('companionAdvisoryNotice').textContent = workspace?.notices?.advisory === companionAdvisoryNotice ? workspace.notices.advisory : companionAdvisoryNotice;
  element('companionSecurityNotice').textContent = workspace?.notices?.security === securityAssuranceNotice ? workspace.notices.security : securityAssuranceNotice;
  element('companionContractError').hidden = noticesMatch && !state.companionError;
  element('companionContractError').textContent = state.companionError
    || (!workspace ? 'The Companion is awaiting its server-owned guidance contract.' : 'Companion contract error: a mandatory advisory or security notice is missing or altered.');
  element('companionStatus').hidden = !state.companionLoading;
  element('companionStatus').textContent = state.companionLoading ? 'Re-evaluating governed state and active personas…' : '';

  if (!workspace) {
    element('companionSubtitle').textContent = 'No healthy state is inferred from a failed projection.';
    element('companionHumanCount').textContent = '0';
    element('companionRunway').innerHTML = '<div class="companion-empty"><strong>Companion guidance is unavailable.</strong><p>Refresh after resolving the reported contract error.</p></div>';
    element('companionContext').innerHTML = renderCompanionContext(null);
    element('companionPersonas').innerHTML = '';
    element('companionReviewQuestions').innerHTML = '';
    element('companionBaseline').innerHTML = '';
    return;
  }

  const selected = selectedCompanionRecommendation();
  state.companionSelection = selected?.id ?? '';
  element('companionFocus').value = workspace.focus;
  element('companionSubtitle').textContent = `${workspace.summary.total} recommendation${workspace.summary.total === 1 ? '' : 's'} · ${workspace.focus ? `focused on “${workspace.focus}”` : 'project-wide ranking'}`;
  element('companionHumanCount').textContent = `${workspace.summary.humanDecision} human`;
  element('companionRunway').innerHTML = workspace.recommendations.length
    ? workspace.recommendations.map((recommendation, index) => `<article class="companion-recommendation tone-${escapeHtml(recommendation.class)}">
      <button type="button" data-companion-recommendation="${escapeHtml(recommendation.id)}" ${recommendation.id === selected?.id ? 'aria-current="true"' : ''}>
        <span class="companion-rank">${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(recommendation.title)}</strong><span class="companion-class">${escapeHtml(recommendation.class.replaceAll('-', ' '))}</span><span class="companion-reason">${escapeHtml(recommendation.reason)}</span>
      </button>
      <p class="companion-route"><span>phase · ${escapeHtml(recommendation.phase || 'not started')}</span><span>route · ${escapeHtml(recommendation.accountableRoute)}</span>${recommendation.handoff ? `<span>hand-off · ${escapeHtml(recommendation.handoff.kind)}</span>` : '<span>direct action · none</span>'}</p>
    </article>`).join('')
    : '<div class="companion-empty"><strong>No governed work is available.</strong><p>The Companion does not invent recommendations when the delivery queue is empty.</p></div>';
  element('companionContext').innerHTML = renderCompanionContext(selected);

  element('companionPersonas').innerHTML = workspace.activePersonas.length
    ? workspace.activePersonas.map((persona) => `<article class="companion-persona" data-tier="${escapeHtml(persona.tier)}"><header><strong>${escapeHtml(persona.name)}</strong><span>${escapeHtml(persona.tier)}</span></header><p>${escapeHtml(persona.engagementReason)}</p><small>${persona.matchedSignals.map(escapeHtml).join(' · ')}</small></article>`).join('')
    : '<div class="companion-empty compact"><strong>No specialist persona matched this focus.</strong><p>The standard host-model baseline remains complete.</p></div>';
  element('companionReviewQuestions').innerHTML = workspace.review.questions.map((question) => `<li>${escapeHtml(question)}</li>`).join('');
  const premium = workspace.personaAvailability.premium;
  element('companionBaseline').innerHTML = `<strong>Complete baseline</strong><p>${escapeHtml(workspace.baseline.description)}</p><small>${premium.installed ? `${premium.count} installed premium persona${premium.count === 1 ? '' : 's'} can add relevant specialist depth.` : premium.reason}</small>`;
}

async function loadCompanion(focus = state.companionFocus) {
  state.companionLoading = true;
  state.companionError = '';
  renderCompanion();
  try {
    const effectiveFocus = String(focus ?? '').trim().slice(0, 500);
    state.companionFocus = effectiveFocus;
    const query = effectiveFocus ? `?${new URLSearchParams({ focus: effectiveFocus })}` : '';
    state.companion = await api(`/api/companion${query}`);
    state.companionSelection = state.companion.spotlight?.id ?? '';
  } catch (error) {
    state.companion = null;
    state.companionError = error.message;
  } finally {
    state.companionLoading = false;
    renderCompanion();
  }
}

async function openCompanionHandoff(button) {
  const recommendation = state.companion?.recommendations.find((candidate) => candidate.id === button.dataset.companionHandoff);
  if (!recommendation?.handoff || recommendation.handoff.kind !== button.dataset.handoffKind) return;
  button.disabled = true;
  try {
    state.selected = await api(`/api/work-items/${encodeURIComponent(recommendation.id)}/viewer`);
    openDashboardAction({ dataset: { dashboardAction: recommendation.handoff.kind === 'begin' ? 'guided-begin' : 'guided-continue' } });
  } catch (error) {
    state.companionError = error.message;
    renderCompanion();
  } finally {
    button.disabled = false;
  }
}

function portfolioSelectionFromUrl() {
  try {
    return new URL(window.location.href).searchParams.get('portfolio-context') || '';
  } catch {
    return '';
  }
}

function persistPortfolioSelection(selection) {
  state.portfolioSelection = selection;
  try {
    const url = new URL(window.location.href);
    if (selection) url.searchParams.set('portfolio-context', selection);
    else url.searchParams.delete('portfolio-context');
    window.history.replaceState(null, '', url);
  } catch {
    // Selection remains useful in memory when the host does not expose History.
  }
}

function portfolioAttentionFor(memberId) {
  return (state.portfolio?.attention ?? []).filter((item) => item.member === memberId);
}

function portfolioFocusFor(kind, id) {
  if (kind === 'member') {
    const member = state.portfolio?.members?.find((candidate) => candidate.id === id);
    if (!member) return '';
    const attention = portfolioAttentionFor(id);
    return [member.kind, member.name, member.owner, member.evidence?.status,
      member.evidence?.delivery?.currentPhase, member.evidence?.delivery?.manualQa,
      ...attention.flatMap((item) => [item.code, item.reason])].filter(Boolean).join(' ').slice(0, 500);
  }
  const dependency = state.portfolio?.dependencies?.find((candidate) => candidate.id === id);
  return dependency
    ? ['declared dependency', dependency.from, dependency.to, dependency.rationale, dependency.owner].join(' ').slice(0, 500)
    : '';
}

function selectedPortfolioContext() {
  const workspace = state.portfolio;
  if (!workspace?.members?.length) return null;
  const requested = state.portfolioSelection || portfolioSelectionFromUrl();
  const [kind, id] = requested.split(':', 2);
  if (kind === 'member') {
    const member = workspace.members.find((candidate) => candidate.id === id);
    if (member) return { kind, id, member };
  }
  if (kind === 'dependency') {
    const dependency = workspace.dependencies.find((candidate) => candidate.id === id);
    if (dependency) return { kind, id, dependency };
  }
  const attentionMember = workspace.attention?.[0]?.member;
  const member = workspace.members.find((candidate) => candidate.id === attentionMember)
    ?? workspace.members.find((candidate) => candidate.kind === 'project')
    ?? workspace.members[0];
  return member ? { kind: 'member', id: member.id, member } : null;
}

function renderPortfolioContext(selected) {
  if (!selected) return '<div class="portfolio-empty"><strong>Choose a portfolio context.</strong><p>The selected member or dependency will appear here without changing project state.</p></div>';
  if (selected.kind === 'dependency') {
    const dependency = selected.dependency;
    return `<header><span class="eyebrow">Selected declared dependency</span><h3 id="portfolioContextTitle">${escapeHtml(dependency.from)} → ${escapeHtml(dependency.to)}</h3><p>${escapeHtml(dependency.rationale)}</p></header>
      <dl class="portfolio-facts"><div><dt>Evidence class</dt><dd>${escapeHtml(dependency.evidenceClass)}</dd></div><div><dt>Accountable owner</dt><dd>${escapeHtml(dependency.owner)}</dd></div><div><dt>Direction</dt><dd>From ${escapeHtml(dependency.from)} to ${escapeHtml(dependency.to)}</dd></div></dl>
      <p class="portfolio-route">The named dependency owner decides the next action. This view does not dispatch or approve work.</p>`;
  }
  const member = selected.member;
  const evidence = member.evidence ?? {};
  const attention = portfolioAttentionFor(member.id);
  const delivery = evidence.delivery ?? {};
  return `<header><span class="eyebrow">Selected ${escapeHtml(member.kind)}</span><h3 id="portfolioContextTitle">${escapeHtml(member.name)}</h3><p>${escapeHtml(member.owner)} owns this context.</p></header>
    <dl class="portfolio-facts">
      <div><dt>Evidence state</dt><dd>${escapeHtml(evidence.status || 'unknown')}</dd></div>
      <div><dt>Delivery phase</dt><dd>${escapeHtml(delivery.currentPhase || 'not reported')}</dd></div>
      <div><dt>Manual QA</dt><dd>${escapeHtml(delivery.manualQa || 'not reported')}</dd></div>
      <div><dt>Freshness</dt><dd>${escapeHtml(evidence.freshness?.status || 'not reported')}</dd></div>
    </dl>
    <section class="portfolio-context-attention"><h4>Why this needs attention</h4>${attention.length ? `<ul>${attention.map((item) => `<li><strong>${escapeHtml(item.code)}</strong><span>${escapeHtml(item.reason)}</span><small>${escapeHtml(item.evidenceClass)} · route to ${escapeHtml(item.owner)}</small></li>`).join('')}</ul>` : '<p>No attention item is reported. That is not an approval or assurance decision.</p>'}</section>
    <p class="portfolio-route">Route unresolved decisions to ${escapeHtml(member.owner)} in the child project. Portfolio review cannot change its Build, Manual QA, risk or release state.</p>`;
}

function renderPortfolio() {
  const workspace = state.portfolio;
  const noticesMatch = workspace?.notices?.advisory === portfolioAdvisoryNotice
    && workspace?.notices?.security === securityAssuranceNotice;
  element('portfolioAdvisoryNotice').textContent = workspace?.notices?.advisory === portfolioAdvisoryNotice ? workspace.notices.advisory : portfolioAdvisoryNotice;
  element('portfolioSecurityNotice').textContent = workspace?.notices?.security === securityAssuranceNotice ? workspace.notices.security : securityAssuranceNotice;
  element('portfolioContractError').hidden = noticesMatch && !state.portfolioError;
  element('portfolioContractError').textContent = state.portfolioError
    || (!workspace ? 'The Portfolio workspace is awaiting its server-owned evidence contract.' : 'Portfolio workspace contract error: a mandatory authority or security notice is missing or altered.');
  const liveStatus = state.portfolioLoading ? 'Loading current portfolio evidence…' : '';
  element('portfolioStatus').hidden = !liveStatus;
  element('portfolioStatus').textContent = liveStatus;

  if (!workspace) {
    element('portfolioSummary').innerHTML = '<span>Status unavailable</span>';
    element('portfolioAttentionCount').textContent = '0';
    element('portfolioProgrammeLine').innerHTML = '<div class="portfolio-empty"><strong>Portfolio evidence is unavailable.</strong><p>No healthy state is inferred from a failed projection.</p></div>';
    element('portfolioDependencies').innerHTML = '';
    element('portfolioContext').innerHTML = renderPortfolioContext(null);
    element('portfolioPersonas').innerHTML = '';
    element('portfolioReviewContent').innerHTML = '';
    return;
  }

  const selected = selectedPortfolioContext();
  const selectedKey = selected ? `${selected.kind}:${selected.id}` : '';
  if (selectedKey && state.portfolioSelection !== selectedKey) persistPortfolioSelection(selectedKey);
  element('portfolioSummary').innerHTML = `<span class="portfolio-state status-${escapeHtml(workspace.status)}"><strong>${escapeHtml(workspace.status)}</strong><small>${workspace.members.length} members · ${workspace.dependencies.length} declared dependencies</small></span>`;
  element('portfolioAttentionCount').textContent = String(workspace.attention.length);

  if (workspace.status === 'not-configured') {
    element('portfolioProgrammeLine').innerHTML = `<div class="portfolio-empty"><strong>No portfolio is configured.</strong><p>Create <code>SPECS/1.Scope/portfolio.yaml</code>, then follow ${escapeHtml(workspace.guide)}.</p></div>`;
  } else if (workspace.status === 'invalid') {
    element('portfolioProgrammeLine').innerHTML = `<div class="portfolio-empty portfolio-invalid"><strong>The portfolio manifest is invalid.</strong><ul>${workspace.diagnostics.map((item) => `<li><code>${escapeHtml(item.code)}</code><span>${escapeHtml(item.message)}${item.path ? ` · ${escapeHtml(item.path)}` : ''}</span></li>`).join('')}</ul></div>`;
  } else {
    element('portfolioProgrammeLine').innerHTML = workspace.members.map((member) => {
      const evidence = member.evidence ?? {};
      const delivery = evidence.delivery ?? {};
      const attention = portfolioAttentionFor(member.id);
      const depth = Math.max(0, Math.min(7, Number(member.depth) || 0));
      const key = `member:${member.id}`;
      return `<button type="button" role="treeitem" aria-level="${depth + 1}" ${key === selectedKey ? 'aria-current="true"' : ''} class="portfolio-node status-${escapeHtml(evidence.status || 'unknown')}" style="--portfolio-depth:${depth}" data-portfolio-member="${escapeHtml(member.id)}">
        <span class="portfolio-node-marker" aria-hidden="true"></span>
        <span class="portfolio-node-body"><small>${escapeHtml(member.kind)} · ${escapeHtml(evidence.status || 'unknown')}</small><strong>${escapeHtml(member.name)}</strong><em>Owner: ${escapeHtml(member.owner)}</em>${member.kind === 'project' ? `<span>Phase: ${escapeHtml(delivery.currentPhase || 'not reported')} · Manual QA: ${escapeHtml(delivery.manualQa || 'not reported')}</span>` : ''}</span>
        <b>${attention.length ? `${attention.length} attention` : 'No reported attention'}</b>
      </button>`;
    }).join('');
  }

  const declared = workspace.dependencies.length ? workspace.dependencies.map((dependency) => {
    const key = `dependency:${dependency.id}`;
    return `<button type="button" class="portfolio-dependency declared ${key === selectedKey ? 'selected' : ''}" data-portfolio-dependency="${escapeHtml(dependency.id)}"><span><small>Declared dependency</small><strong>${escapeHtml(dependency.from)} → ${escapeHtml(dependency.to)}</strong></span><em>${escapeHtml(dependency.rationale)}</em><b>Owner: ${escapeHtml(dependency.owner)}</b></button>`;
  }).join('') : '<div class="portfolio-empty compact"><strong>No declared dependencies.</strong><p>Absence is shown as unknown, not as proof that projects are independent.</p></div>';
  const observed = `<article class="portfolio-observed"><small>Observed evidence</small><strong>${escapeHtml(workspace.observedEvidence?.status || 'not available')}</strong><p>${escapeHtml(workspace.observedEvidence?.reason || 'No observed cross-project dependency evidence is available.')}</p></article>`;
  element('portfolioDependencies').innerHTML = `${declared}${observed}`;
  element('portfolioContext').innerHTML = renderPortfolioContext(selected);

  element('portfolioPersonas').innerHTML = workspace.activePersonas.length
    ? workspace.activePersonas.map((persona) => `<article class="portfolio-persona" data-tier="${escapeHtml(persona.tier)}"><header><strong>${escapeHtml(persona.name)}</strong><span>${escapeHtml(persona.tier)}</span></header><p>${escapeHtml(persona.engagementReason)}</p><small>${persona.matchedSignals.map(escapeHtml).join(' · ')}</small></article>`).join('')
    : '<div class="portfolio-empty compact"><strong>No specialist persona matched this snapshot.</strong><p>The Standard LLM baseline and its explicit review questions remain available. Actively engaged personas will appear here when project, core, personal or premium metadata matches this context.</p></div>';
  const premium = workspace.personaAvailability?.premium;
  const premiumState = premium?.installed
    ? `${premium.count} premium persona${premium.count === 1 ? '' : 's'} installed. Relevant specialists can enrich the active ensemble.`
    : 'Premium personas are not installed. The Standard LLM baseline remains available.';
  element('portfolioReviewContent').innerHTML = `<p>Use standard host-model reasoning over this bounded snapshot, supported by installed project and core personas.</p><ul>${workspace.review.questions.map((question) => `<li>${escapeHtml(question)}</li>`).join('')}</ul><div class="portfolio-premium-state"><strong>Optional enrichment</strong><span>${escapeHtml(premiumState)}</span></div><small>Evidence classes: ${workspace.review.evidenceClasses.map(escapeHtml).join(' · ')}</small>`;
}

async function loadPortfolio(focus = state.portfolioFocus) {
  state.portfolioLoading = true;
  state.portfolioError = '';
  renderPortfolio();
  try {
    const effectiveFocus = String(focus || (!state.portfolio ? portfolioSelectionFromUrl() : '')).slice(0, 500);
    state.portfolioFocus = effectiveFocus;
    const query = effectiveFocus ? `?${new URLSearchParams({ focus: effectiveFocus })}` : '';
    state.portfolio = await api(`/api/portfolio${query}`);
  } catch (error) {
    state.portfolio = null;
    state.portfolioError = error.message;
  } finally {
    state.portfolioLoading = false;
    renderPortfolio();
  }
}

function rolloutSelectionFromUrl() {
  try {
    return new URL(window.location.href).searchParams.get('rollout-context') || '';
  } catch {
    return '';
  }
}

function persistRolloutSelection(selection) {
  state.rolloutSelection = selection;
  try {
    const url = new URL(window.location.href);
    if (selection) url.searchParams.set('rollout-context', selection);
    else url.searchParams.delete('rollout-context');
    window.history.replaceState(null, '', url);
  } catch {
    // Selection remains useful in memory when the host does not expose History.
  }
}

function rolloutContexts() {
  const cohorts = state.rollout?.cohorts ?? [];
  return {
    cohorts,
    projects: cohorts.flatMap((cohort) => cohort.projects.map((project) => ({ cohort, project }))),
  };
}

function selectedRolloutContext() {
  const { cohorts, projects } = rolloutContexts();
  if (!cohorts.length) return null;
  const requested = state.rolloutSelection || rolloutSelectionFromUrl();
  const [kind, id] = requested.split(':', 2);
  if (kind === 'cohort') {
    const cohort = cohorts.find((candidate) => candidate.id === id);
    if (cohort) return { kind, id, cohort };
  }
  if (kind === 'baseline') {
    const cohort = cohorts.find((candidate) => candidate.baseline.id === id);
    if (cohort) return { kind, id, cohort, baseline: cohort.baseline };
  }
  if (kind === 'project') {
    const selected = projects.find((candidate) => candidate.project.id === id);
    if (selected) return { kind, id, ...selected };
  }
  const selected = projects.find((candidate) => candidate.project.adoption.state !== 'aligned') ?? projects[0];
  return selected ? { kind: 'project', id: selected.project.id, ...selected } : { kind: 'cohort', id: cohorts[0].id, cohort: cohorts[0] };
}

function blueprintLabel(pin) {
  if (!pin) return 'No project-owned Blueprint pin';
  return `${pin.id} @ ${pin.version}${pin.digest ? ' · digest pinned' : ''}`;
}

function rolloutFocusFor(kind, id) {
  const { cohorts, projects } = rolloutContexts();
  if (kind === 'cohort') {
    const cohort = cohorts.find((candidate) => candidate.id === id);
    return cohort ? ['cohort', cohort.name, cohort.owner, cohort.reviewBy, cohort.baseline.name].join(' ').slice(0, 500) : '';
  }
  if (kind === 'baseline') {
    const cohort = cohorts.find((candidate) => candidate.baseline.id === id);
    return cohort ? ['baseline', cohort.baseline.name, cohort.baseline.owner, blueprintLabel(cohort.baseline.pack)].join(' ').slice(0, 500) : '';
  }
  const selected = projects.find((candidate) => candidate.project.id === id);
  return selected ? ['project', selected.project.name, selected.project.adoption.state, selected.project.owner, selected.project.reviewOwner].join(' ').slice(0, 500) : '';
}

function renderRolloutContext(selected) {
  if (!selected) return '<div class="rollout-empty"><strong>Choose a rollout context.</strong><p>A cohort, baseline or project will appear here without changing project state.</p></div>';
  if (selected.kind === 'cohort') {
    return `<header><span class="eyebrow">Selected cohort</span><h3>${escapeHtml(selected.cohort.name)}</h3><p>${escapeHtml(selected.cohort.owner)} owns cohort coordination.</p></header>
      <dl class="rollout-facts"><div><dt>Review by</dt><dd>${escapeHtml(selected.cohort.reviewBy)}</dd></div><div><dt>Baseline</dt><dd>${escapeHtml(selected.cohort.baseline.name)}</dd></div><div><dt>Projects</dt><dd>${selected.cohort.projects.length}</dd></div><div><dt>Evidence classes</dt><dd>${escapeHtml(selected.cohort.requiredEvidence.join(', '))}</dd></div></dl>
      <p class="rollout-route">The cohort owner coordinates review. Each project owner retains adoption, assurance and release decisions.</p>`;
  }
  if (selected.kind === 'baseline') {
    return `<header><span class="eyebrow">Selected declared baseline</span><h3>${escapeHtml(selected.baseline.name)}</h3><p>${escapeHtml(selected.baseline.owner)} owns this reusable expectation.</p></header>
      <dl class="rollout-facts"><div><dt>Pack</dt><dd>${escapeHtml(selected.baseline.pack.id)}</dd></div><div><dt>Version</dt><dd>${escapeHtml(selected.baseline.pack.version)}</dd></div><div><dt>Digest</dt><dd>${selected.baseline.pack.digest ? 'Pinned' : 'Not required'}</dd></div><div><dt>Evidence class</dt><dd>Declared policy</dd></div></dl>
      <p class="rollout-route">Exact comparison identifies a difference. It does not decide compatibility, suitability or adoption.</p>`;
  }
  const project = selected.project;
  return `<header><span class="eyebrow">Selected project</span><h3>${escapeHtml(project.name)}</h3><p>${escapeHtml(project.owner)} owns project truth.</p></header>
    <dl class="rollout-facts">
      <div><dt>Expected</dt><dd>${escapeHtml(blueprintLabel(project.expectedBlueprint))}</dd></div>
      <div><dt>Observed</dt><dd>${escapeHtml(blueprintLabel(project.observedBlueprint))}</dd></div>
      <div><dt>Adoption state</dt><dd>${escapeHtml(project.adoption.state)}</dd></div>
      <div><dt>Review owner</dt><dd>${escapeHtml(project.reviewOwner)}</dd></div>
    </dl>
    <section class="rollout-evidence-detail"><h4>Required evidence</h4><ul>${project.evidence.map((item) => `<li><strong>${escapeHtml(item.class)}</strong><span>${escapeHtml(item.state)}</span><small>${escapeHtml(item.limitation)}</small></li>`).join('')}</ul></section>
    <p class="rollout-route"><strong>Next accountable route.</strong> ${escapeHtml(project.nextRoute.action)} Owner: ${escapeHtml(project.nextRoute.owner)}${project.nextRoute.topologyOwner ? ` · topology: ${escapeHtml(project.nextRoute.topologyOwner)}` : ''}.</p>`;
}

function renderRollout() {
  const workspace = state.rollout;
  const noticesMatch = workspace?.notices?.advisory === rolloutAdvisoryNotice
    && workspace?.notices?.security === securityAssuranceNotice;
  element('rolloutAdvisoryNotice').textContent = workspace?.notices?.advisory === rolloutAdvisoryNotice ? workspace.notices.advisory : rolloutAdvisoryNotice;
  element('rolloutSecurityNotice').textContent = workspace?.notices?.security === securityAssuranceNotice ? workspace.notices.security : securityAssuranceNotice;
  element('rolloutContractError').hidden = noticesMatch && !state.rolloutError;
  element('rolloutContractError').textContent = state.rolloutError
    || (!workspace ? 'The Rollout workspace is awaiting its server-owned evidence contract.' : 'Rollout workspace contract error: a mandatory authority or security notice is missing or altered.');
  const liveStatus = state.rolloutLoading ? 'Loading current rollout evidence…' : '';
  element('rolloutStatus').hidden = !liveStatus;
  element('rolloutStatus').textContent = liveStatus;

  if (!workspace) {
    element('rolloutSummary').innerHTML = '<span>Status unavailable</span>';
    element('rolloutAttentionCount').textContent = '0';
    element('rolloutLedger').innerHTML = '<div class="rollout-empty"><strong>Rollout evidence is unavailable.</strong><p>No healthy state is inferred from a failed projection.</p></div>';
    element('rolloutContext').innerHTML = renderRolloutContext(null);
    element('rolloutPersonas').innerHTML = '';
    element('rolloutReviewContent').innerHTML = '';
    return;
  }

  const selected = selectedRolloutContext();
  const selectedKey = selected ? `${selected.kind}:${selected.id}` : '';
  if (selectedKey && state.rolloutSelection !== selectedKey) persistRolloutSelection(selectedKey);
  const projects = workspace.cohorts.flatMap((cohort) => cohort.projects);
  const attentionCount = projects.filter((project) => project.adoption.state !== 'aligned' || project.evidence.some((item) => item.state !== 'present')).length;
  element('rolloutSummary').innerHTML = `<span class="rollout-state status-${escapeHtml(workspace.status)}"><strong>${escapeHtml(workspace.status)}</strong><small>${workspace.cohorts.length} cohorts · ${projects.length} projects</small></span>`;
  element('rolloutAttentionCount').textContent = String(attentionCount);

  if (workspace.status === 'not-configured') {
    element('rolloutLedger').innerHTML = `<div class="rollout-empty"><strong>No rollout policy is configured.</strong><p>Create <code>SPECS/1.Scope/rollout.yaml</code>, then follow ${escapeHtml(workspace.guide)}.</p></div>`;
  } else if (workspace.status === 'invalid') {
    element('rolloutLedger').innerHTML = `<div class="rollout-empty rollout-invalid"><strong>The rollout policy is invalid.</strong><ul>${workspace.diagnostics.map((item) => `<li><code>${escapeHtml(item.code)}</code><span>${escapeHtml(item.message)}${item.path ? ` · ${escapeHtml(item.path)}` : ''}</span></li>`).join('')}</ul></div>`;
  } else {
    element('rolloutLedger').innerHTML = workspace.cohorts.map((cohort) => `<article class="rollout-cohort">
      <header><button type="button" class="rollout-cohort-choice" data-rollout-cohort="${escapeHtml(cohort.id)}" ${selectedKey === `cohort:${cohort.id}` ? 'aria-current="true"' : ''}><span class="eyebrow">Cohort</span><strong>${escapeHtml(cohort.name)}</strong><small>Owner · ${escapeHtml(cohort.owner)}</small></button><p>Review by<br><strong>${escapeHtml(cohort.reviewBy)}</strong></p></header>
      <button type="button" class="rollout-baseline ${selectedKey === `baseline:${cohort.baseline.id}` ? 'selected' : ''}" data-rollout-baseline="${escapeHtml(cohort.baseline.id)}"><span>Declared baseline</span><strong>${escapeHtml(blueprintLabel(cohort.baseline.pack))}</strong><small>Owner · ${escapeHtml(cohort.baseline.owner)}</small></button>
      <div class="rollout-projects">${cohort.projects.map((project) => {
        const key = `project:${project.id}`;
        const tone = ['unavailable', 'invalid'].includes(project.adoption.state) ? 'stop' : project.adoption.state === 'aligned' ? 'ready' : 'warn';
        return `<article class="rollout-project tone-${tone}"><button type="button" data-rollout-project="${escapeHtml(project.id)}" ${selectedKey === key ? 'aria-current="true"' : ''}><span><strong>${escapeHtml(project.name)}</strong><small>Observed · ${escapeHtml(blueprintLabel(project.observedBlueprint))}</small><em>Owner · ${escapeHtml(project.owner)} · Review · ${escapeHtml(project.reviewOwner)}</em></span><b>${escapeHtml(project.adoption.state)}</b></button><div class="rollout-evidence">${project.evidence.map((item) => `<span data-state="${escapeHtml(item.state)}">${escapeHtml(item.class)} · ${escapeHtml(item.state)}</span>`).join('')}</div></article>`;
      }).join('')}</div>
    </article>`).join('');
  }

  element('rolloutContext').innerHTML = renderRolloutContext(selected);
  element('rolloutPersonas').innerHTML = workspace.activePersonas.length
    ? workspace.activePersonas.map((persona) => `<article class="rollout-persona" data-tier="${escapeHtml(persona.tier)}"><header><strong>${escapeHtml(persona.name)}</strong><span>${escapeHtml(persona.tier)}</span></header><p>${escapeHtml(persona.engagementReason)}</p><small>Matched · ${persona.matchedSignals.map(escapeHtml).join(' · ') || 'relevant project context'}</small></article>`).join('')
    : '<div class="rollout-empty compact"><strong>No specialist persona matched this context.</strong><p>The Standard LLM baseline and installed project/core method remain available.</p></div>';
  const premium = workspace.personaAvailability?.premium;
  const premiumState = premium?.installed
    ? `${premium.count} premium persona${premium.count === 1 ? '' : 's'} installed. Relevant specialists may enrich the active ensemble.`
    : 'Premium personas are not installed. This does not block the Standard LLM baseline.';
  element('rolloutReviewContent').innerHTML = `<p>Use standard host-model reasoning over this bounded snapshot with installed project and core personas.</p><ul>${workspace.review.questions.map((question) => `<li>${escapeHtml(question)}</li>`).join('')}</ul><div class="rollout-premium-state"><strong>Optional enrichment</strong><span>${escapeHtml(premiumState)}</span></div><small>Evidence classes: ${workspace.review.evidenceClasses.map(escapeHtml).join(' · ')}</small>`;
}

async function loadRollout(focus = state.rolloutFocus, projectId = '') {
  state.rolloutLoading = true;
  state.rolloutError = '';
  renderRollout();
  try {
    const effectiveFocus = String(focus || '').slice(0, 500);
    state.rolloutFocus = effectiveFocus;
    state.rollout = projectId
      ? await api(`/api/rollout/projects/${encodeURIComponent(projectId)}/assurance`)
      : await api(`/api/rollout${effectiveFocus ? `?${new URLSearchParams({ focus: effectiveFocus })}` : ''}`);
  } catch (error) {
    state.rollout = null;
    state.rolloutError = error.message;
  } finally {
    state.rolloutLoading = false;
    renderRollout();
  }
}

async function recoverStarterFromDashboard(button) {
  if (!window.confirm('Retry digest-sensitive recovery? Changed generated files will be preserved for human resolution.')) return;
  button.disabled = true;
  state.startersNotice = 'Running digest-sensitive recovery…';
  renderStarters();
  try {
    const result = await api(`/api/starter-materialisation/attempts/${encodeURIComponent(button.dataset.starterRecover)}/recover`, {
      method: 'POST', body: JSON.stringify({ confirmed: true }),
    });
    state.startersNotice = result.status === 'recovery-required' ? 'Changed generated content was preserved. Human resolution is still required.' : 'Safe recovery completed.';
    await loadStarters();
  } catch (error) {
    state.startersNotice = error.message;
    renderStarters();
  } finally {
    button.disabled = false;
  }
}

async function runSecurityProfile(button) {
  if (!window.confirm(`Run the configured adapter for ${button.dataset.securityRun} against the server-resolved project revision?`)) return;
  button.disabled = true;
  state.securityNotice = 'Running the bounded security adapter…';
  renderSecurity();
  try {
    await api(`/api/security-validation/profiles/${encodeURIComponent(button.dataset.securityRun)}/runs`, {
      method: 'POST', body: JSON.stringify({ confirmed: true, mode: 'command' }),
    });
    await loadSecurity();
    state.securityNotice = 'Security evidence recorded. Human review remains required.';
    renderSecurity();
  } catch (error) {
    state.securityNotice = error.message;
    renderSecurity();
  } finally {
    button.disabled = false;
  }
}

async function importSecurityProvider(button) {
  button.disabled = true;
  state.securityNotice = 'Preparing an allowlisted project-local import…';
  renderSecurity();
  try {
    const prepared = await api(`/api/security-validation/profiles/${encodeURIComponent(button.dataset.securityProfile)}/imports`, {
      method: 'POST', body: JSON.stringify({ providerId: button.dataset.securityImport }),
    });
    if (!window.confirm(`Import the detected ${prepared.provider.name} evidence for ${prepared.profileId}? Provider files will be parsed as untrusted data and never executed.`)) return;
    await api(`/api/security-validation/profiles/${encodeURIComponent(button.dataset.securityProfile)}/imports`, {
      method: 'POST', body: JSON.stringify({ discoveryToken: prepared.token, confirmed: true }),
    });
    await loadSecurity();
    state.securityNotice = 'Provider evidence imported. Human review remains required.';
    renderSecurity();
  } catch (error) {
    state.securityNotice = error.message;
    renderSecurity();
  } finally {
    button.disabled = false;
  }
}

async function cancelSecurityRunFromDashboard(button) {
  if (!window.confirm('Cancel this security run? Existing evidence and attempt history will be retained.')) return;
  button.disabled = true;
  state.securityNotice = 'Cancelling the bounded security run…';
  renderSecurity();
  try {
    await api(`/api/security-validation/runs/${encodeURIComponent(button.dataset.securityCancel)}/cancel`, {
      method: 'POST', body: JSON.stringify({ confirmed: true }),
    });
    await loadSecurity();
    state.securityNotice = 'Cancellation recorded. Cancelled evidence does not satisfy readiness.';
    renderSecurity();
  } catch (error) {
    state.securityNotice = error.message;
    renderSecurity();
  } finally {
    button.disabled = false;
  }
}

async function loadBoard() {
  const [project, work, groups] = await Promise.all([api('/api/project'), api('/api/work-items'), api('/api/groups')]);
  state.project = project;
  state.items = work.items;
  state.groups = groups.groups;
  try {
    state.knowledge = await api('/api/knowledge');
    state.knowledgeError = false;
  } catch {
    state.knowledge = { tree: [], documents: [], count: 0, matches: [] };
    state.knowledgeError = true;
  }
  try {
    state.sessions = (await api('/api/active')).sessions;
    element('runtimeWarning').hidden = true;
  } catch {
    element('runtimeWarning').hidden = false;
    element('runtimeWarning').textContent = ' · live activity unavailable';
  }
  element('projectName').textContent = project.name;
  element('runtimeStatus').textContent = `${work.items.length} intents indexed · project-local runtime`;
  renderSummary();
  renderPremiumUpgrade();
  renderBoard();
  renderLive();
  renderKnowledge();
}

async function refreshRuntime() {
  const [work, groups, active, project] = await Promise.allSettled([api('/api/work-items'), api('/api/groups'), api('/api/active'), api('/api/project'), navigation.refresh()]);
  if(project.status==='fulfilled'){state.project=project.value;renderPremiumUpgrade();}
  if (work.status === 'fulfilled') state.items = work.value.items;
  if (groups.status === 'fulfilled') state.groups = groups.value.groups;
  if (active.status === 'fulfilled') {
    state.sessions = active.value.sessions;
    element('runtimeWarning').hidden = true;
  } else {
    element('runtimeWarning').hidden = false;
    element('runtimeWarning').textContent = ' · live activity unavailable';
  }
  renderSummary(); renderBoard(); renderLive();
  if (state.view === 'hooks' && !state.hooksLoading) await loadHooks();
  if (state.view === 'security' && !state.securityLoading) await loadSecurity();
  if (state.view === 'error-reporting' && !state.errorReportLoading) await loadErrorReports();
  if (state.view === 'team-hub' && !state.teamHubLoading) await loadTeamHub();
  if (state.view === 'policies' && !state.policyLoading) await loadPolicy();
  if (state.view === 'starters' && !state.startersLoading) await loadStarters();
  if (state.view === 'companion' && !state.companionLoading) await loadCompanion();
  if (state.view === 'portfolio' && !state.portfolioLoading) await loadPortfolio();
  if (state.view === 'rollout' && !state.rolloutLoading) await loadRollout();
  if (['configuration', 'companion', 'live'].includes(state.view) || element('intentDialog').open) await loadAutonomyState();
  element('pollStatus').textContent = 'Updated just now · refreshing every 5 seconds';
  if (state.selected && element('intentDialog').open) {
    const previous = state.selected;
    const updated = await api(`/api/work-items/${encodeURIComponent(previous.item.id)}/viewer`);
    state.selected = updated;
    element('drawerMeta').textContent = `${updated.item.lane} · ${updated.item.currentPhase} · updated ${timeAgo(updated.item.updatedAt)}`;
    const prototypeSignature = (view) => JSON.stringify(view.artefacts.filter((artefact) => artefact.kind === 'prototype' && artefact.status === 'active').map((artefact) => [artefact.id, artefact.path, artefact.title, artefact.status]));
    const personaSignature = (view) => JSON.stringify(view.intent?.personas ?? []);
    const preservePrototype = state.selectedTab === 'prototype' && prototypeSignature(previous) === prototypeSignature(updated);
    const preservePersonaEditor = state.selectedTab === 'personas' && personaSignature(previous) === personaSignature(updated);
    if (!preservePrototype && !preservePersonaEditor) renderDrawer();
  }
}

function setView(view) {
  if(!navigation.isEnabled(view)){navigation.explainDisabled(view);view='configuration';}
  navigation.select(view);
  state.view = view;
  element('configurationView').hidden = view !== 'configuration';
  element('boardView').hidden = view !== 'board';
  element('companionView').hidden = view !== 'companion';
  element('liveView').hidden = view !== 'live';
  element('knowledgeView').hidden = view !== 'knowledge';
  element('guidedView').hidden = view !== 'guided';
  element('intentStudioView').hidden = view !== 'intent-studio';
  element('phaseStudioView').hidden = view !== 'phase-studio';
  element('contextInspectorView').hidden = view !== 'context-inspector';
  element('startersView').hidden = view !== 'starters';
  element('portfolioView').hidden = view !== 'portfolio';
  element('rolloutView').hidden = view !== 'rollout';
  element('hooksView').hidden = view !== 'hooks';
  element('policiesView').hidden = view !== 'policies';
  element('securityView').hidden = view !== 'security';
  element('teamHubView').hidden = view !== 'team-hub';
  element('errorReportingView').hidden = view !== 'error-reporting';
  document.querySelectorAll('[data-view]').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (button.closest('.view-switcher')) button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  element('search').disabled = ['configuration', 'live', 'guided', 'intent-studio', 'phase-studio', 'context-inspector', 'starters', 'companion', 'portfolio', 'team-hub', 'rollout', 'hooks', 'policies', 'security', 'error-reporting'].includes(view)
    || (view === 'knowledge' && state.knowledgeMode !== 'knowledge');
  element('search').closest('.global-search').hidden = view === 'companion';
  element('search').placeholder = view === 'knowledge' ? 'Search the Mind Palace…' : 'Search intents, domains, phases…';
  element('searchLabel').textContent = view === 'knowledge'
    ? 'Search the project Mind Palace'
    : 'Search intents, domains, and phases';
  if (view === 'knowledge') {
    setKnowledgeMode(state.knowledgeMode);
    if (state.knowledgeMode === 'knowledge') loadKnowledge().catch(console.error);
  }
  if (view === 'guided' && !state.guided && !state.guidedCompleted) loadGuidedDiscovery().catch(console.error);
  if (view === 'intent-studio' && !state.guidedIntent && !state.guidedIntentCompleted) loadGuidedIntent().catch(console.error);
  if (view === 'phase-studio' && !state.phaseStudio) loadPhaseStudio().catch(console.error);
  if (view === 'context-inspector') renderContextInspector();
  if (view === 'hooks') loadHooks().catch(console.error);
  if (view === 'policies') loadPolicy().catch(console.error);
  if (view === 'security') loadSecurity().catch(console.error);
  if (view === 'team-hub') loadTeamHub().catch(console.error);
  if (view === 'error-reporting') loadErrorReports().catch(console.error);
  if (view === 'starters') loadStarters().catch(console.error);
  if (view === 'companion') loadCompanion().catch(console.error);
  if (view === 'portfolio') loadPortfolio().catch(console.error);
  if (view === 'rollout') loadRollout().catch(console.error);
  if (['configuration', 'companion', 'live'].includes(view)) loadAutonomyState().catch(console.error);
  if (!state.pollTimer) state.pollTimer = window.setInterval(() => refreshRuntime().catch(console.error), 5000);
  refreshRuntime().catch(console.error);
}

document.addEventListener('click', async (event) => {
  if (event.target.closest('[data-team-hub-sync]')) {
    if (!window.confirm('Publish the current bounded project snapshot to the configured Team Hub?')) return;
    state.teamHubNotice = 'Publishing the bounded snapshot…'; state.teamHubError = ''; renderTeamHub();
    try {
      const result = await api('/api/team-hub/sync', { method: 'POST', body: JSON.stringify({ confirmed: true }) });
      state.teamHub = result.workspace;
      state.teamHubNotice = result.attempt.status === 'accepted' ? 'Snapshot accepted. This is transport evidence, not approval.' : 'The hub did not accept this snapshot. Local work remains available.';
    } catch (error) { state.teamHubError = error.message; state.teamHubNotice = ''; }
    renderTeamHub();
    return;
  }
  if (event.target.closest('[data-team-hub-disconnect]')) {
    if (!window.confirm('Disconnect this project from Team Hub? Local delivery and recorded transport evidence remain available.')) return;
    try {
      state.teamHub = await api('/api/team-hub/disconnect', { method: 'POST', body: JSON.stringify({ confirmed: true }) });
      state.teamHubNotice = 'Disconnected. This project is back in single-contributor mode.'; state.teamHubError = '';
    } catch (error) { state.teamHubError = error.message; state.teamHubNotice = ''; }
    renderTeamHub();
    return;
  }
  if (event.target.closest('[data-team-hub-resources-refresh]')) {
    state.teamHubNotice = 'Loading the governed resource catalogue…'; state.teamHubError = ''; renderTeamHub();
    try {
      state.teamHubResources = await api('/api/team-hub/resources');
      state.teamHubResourceInspection = null;
      state.teamHubNotice = `Loaded ${state.teamHubResources.releases.length} immutable release${state.teamHubResources.releases.length === 1 ? '' : 's'}. Nothing was installed.`;
    } catch (error) { state.teamHubError = error.message; state.teamHubNotice = ''; }
    renderTeamHub();
    return;
  }
  const inspectResource = event.target.closest('[data-team-hub-resource-inspect]');
  if (inspectResource) {
    state.teamHubNotice = 'Inspecting exact release metadata…'; state.teamHubError = ''; renderTeamHub();
    try {
      state.teamHubResourceInspection = await api(`/api/team-hub/resources/${encodeURIComponent(inspectResource.dataset.teamHubResourceInspect)}/releases/${encodeURIComponent(inspectResource.dataset.version)}`);
      state.teamHubNotice = 'Release inspected. No installation or project change occurred.';
    } catch (error) { state.teamHubError = error.message; state.teamHubNotice = ''; }
    renderTeamHub();
    return;
  }
  if (event.target.closest('[data-report-problem]')) {
    await reportProblem();
    return;
  }
  if (event.target.closest('[data-error-report-create-toggle]')) {
    element('errorReportCreateForm').hidden = !element('errorReportCreateForm').hidden;
    if (!element('errorReportCreateForm').hidden) element('errorReportCreateForm').elements.title.focus();
    return;
  }
  const errorReportSelection = event.target.closest('[data-error-report-select]');
  if (errorReportSelection) {
    await selectErrorReport(errorReportSelection.dataset.errorReportSelect);
    return;
  }
  const finaliseReport = event.target.closest('[data-error-report-finalise]');
  if (finaliseReport) {
    state.errorReportNotice = 'Creating the deterministic local ZIP…'; renderErrorReports();
    try { await api(`/api/error-reports/${encodeURIComponent(finaliseReport.dataset.errorReportFinalise)}/finalise`, { method: 'POST', body: '{}' }); state.errorReportNotice = 'ZIP finalised locally. Nothing was sent.'; await loadErrorReports(); }
    catch (error) { state.errorReportNotice = error.message; renderErrorReports(); }
    return;
  }
  const copyPackage = event.target.closest('[data-error-report-copy-package]');
  if (copyPackage) {
    const report = state.errorReportDetail?.report;
    const path = `.ewai-pipeline/error-reports/packages/${report.id}/revision-${report.revision}/${report.id}-r${report.revision}.zip`;
    await navigator.clipboard.writeText(path);
    state.errorReportNotice = 'Package location copied. The ZIP remains local.'; renderErrorReports();
    return;
  }
  const emailReport = event.target.closest('[data-error-report-email]');
  if (emailReport) {
    const report = state.errorReportDetail?.report;
    try {
      const preparation = await api(`/api/error-reports/${encodeURIComponent(report.id)}/prepare-email`, { method: 'POST', body: JSON.stringify({ expectedDigest: report.package.archiveDigest, launch: true }) });
      state.errorReportEmail = preparation;
      state.errorReportNotice = preparation.status === 'prepared-not-sent'
        ? 'Email prepared, not sent. Attach the ZIP manually.'
        : 'Email handoff could not be prepared.';
      renderErrorReports();
    } catch (error) { state.errorReportNotice = error.message; renderErrorReports(); }
    return;
  }
  const providerReport = event.target.closest('[data-error-report-provider]');
  if (providerReport) {
    const report = state.errorReportDetail?.report;
    const providerId = element('errorReportProvider')?.value;
    if (!window.confirm(`Send exact package ${report.package.archiveDigest} to ${providerId}?`)) return;
    try {
      const attempt = await api(`/api/error-reports/${encodeURIComponent(report.id)}/provider-attempts`, { method: 'POST', body: JSON.stringify({ providerId, expectedDigest: report.package.archiveDigest, confirmed: true }) });
      state.errorReportNotice = attempt.status === 'accepted' ? 'Provider accepted the exact package. This is transport evidence, not issue resolution.' : `Provider attempt failed: ${attempt.reason}`;
      await loadErrorReports();
    } catch (error) { state.errorReportNotice = error.message; renderErrorReports(); }
    return;
  }
  const archiveReport = event.target.closest('[data-error-report-archive]');
  if (archiveReport) {
    if (!window.confirm('Archive this local report material? External receipts are unaffected.')) return;
    try { await api(`/api/error-reports/${encodeURIComponent(archiveReport.dataset.errorReportArchive)}/archive`, { method: 'POST', body: JSON.stringify({ confirmed: true }) }); await loadErrorReports(); }
    catch (error) { state.errorReportNotice = error.message; renderErrorReports(); }
    return;
  }
  const deleteReport = event.target.closest('[data-error-report-delete]');
  if (deleteReport) {
    if (!window.confirm('Delete this local report and package? Provider receipts remain and external reports cannot be recalled.')) return;
    try { await api(`/api/error-reports/${encodeURIComponent(deleteReport.dataset.errorReportDelete)}`, { method: 'DELETE', body: JSON.stringify({ confirmed: true }) }); state.selectedErrorReportId = ''; await loadErrorReports(); }
    catch (error) { state.errorReportNotice = error.message; renderErrorReports(); }
    return;
  }
  const prototypeStage = event.target.closest('[data-prototype-stage]');
  if (prototypeStage) {
    state.prototypeReviewStage = prototypeStage.dataset.prototypeStage;
    state.prototypeReviewError = '';
    state.prototypeReviewNotice = '';
    renderPrototypeReview();
    return;
  }
  if (event.target.closest('[data-prototype-refresh]')) {
    await loadPrototypeReview();
    return;
  }
  const policyMode = event.target.closest('[data-policy-mode]');
  if (policyMode) {
    state.policyMode = policyMode.dataset.policyMode;
    await loadPolicy();
    return;
  }
  if (event.target.closest('[data-policy-evaluate]')) {
    await evaluatePolicyFromWorkspace();
    return;
  }
  const knowledgeMode = event.target.closest('[data-knowledge-mode]');
  if (knowledgeMode) {
    setKnowledgeMode(knowledgeMode.dataset.knowledgeMode);
    return;
  }
  const meetingSource = event.target.closest('[data-meeting-source]');
  if (meetingSource) {
    state.meetingEvidenceMessage = '';
    await loadMeetingEvidence(meetingSource.dataset.meetingSource);
    return;
  }
  const meetingPrepare = event.target.closest('[data-meeting-prepare]');
  if (meetingPrepare) {
    meetingPrepare.disabled = true;
    state.meetingEvidenceMessage = '';
    try {
      state.meetingEvidencePreparation = await api(`/api/meeting-evidence/${encodeURIComponent(meetingPrepare.dataset.meetingPrepare)}/prepare`, {
        method: 'POST', body: JSON.stringify({})
      });
      state.meetingEvidenceMessage = 'The bounded extraction contract is ready for your AI host. No model call was made by the dashboard.';
    } catch (error) {
      state.meetingEvidenceMessage = error.message;
    } finally {
      meetingPrepare.disabled = false;
      renderMeetingEvidence();
    }
    return;
  }
  const meetingPromote = event.target.closest('[data-meeting-promote]');
  if (meetingPromote) {
    const approvedBy = window.prompt('Name the person approving evidence-only promotion:')?.trim();
    if (!approvedBy || !window.confirm('Promote only the accepted and amended candidates into paired meeting-evidence files?')) return;
    meetingPromote.disabled = true;
    try {
      const promoted = await api(`/api/meeting-evidence/${encodeURIComponent(meetingPromote.dataset.meetingPromote)}/promote`, {
        method: 'POST', body: JSON.stringify({ confirmed: true, approvedBy })
      });
      state.meetingEvidenceMessage = `${promoted.counts.promoted} reviewed candidate${promoted.counts.promoted === 1 ? '' : 's'} promoted as evidence.`;
      await loadMeetingEvidence(meetingPromote.dataset.meetingPromote);
    } catch (error) {
      state.meetingEvidenceMessage = error.message;
      renderMeetingEvidence();
    } finally {
      meetingPromote.disabled = false;
    }
    return;
  }
  const knowledgeProposalPrepare = event.target.closest('[data-knowledge-proposal-prepare]');
  if (knowledgeProposalPrepare) {
    knowledgeProposalPrepare.disabled = true;
    state.knowledgeProposalMessage = '';
    try {
      state.knowledgeProposalPreparation = await api('/api/knowledge-proposals/prepare', {
        method: 'POST',
        body: JSON.stringify({ sourceRef: knowledgeProposalPrepare.dataset.knowledgeProposalPrepare }),
      });
      state.knowledgeProposalMessage = 'The bounded host contract and active persona ensemble are ready. Source content remains outside the browser.';
    } catch (error) {
      state.knowledgeProposalMessage = error.message;
    } finally {
      knowledgeProposalPrepare.disabled = false;
      renderKnowledgeProposals();
    }
    return;
  }
  const knowledgeProposalBundle = event.target.closest('[data-knowledge-proposal-bundle]');
  if (knowledgeProposalBundle) {
    state.knowledgeProposalMessage = '';
    state.knowledgeProposalPreparation = null;
    await loadKnowledgeProposals(knowledgeProposalBundle.dataset.knowledgeProposalBundle);
    return;
  }
  const knowledgeProposalReview = event.target.closest('[data-knowledge-proposal-review]');
  if (knowledgeProposalReview) {
    const reviewedBy = element('knowledgeProposalReviewer')?.value.trim() ?? '';
    const cards = [...document.querySelectorAll('[data-knowledge-proposal-card]')];
    const dispositions = cards.map((card) => ({
      proposalId: card.dataset.knowledgeProposalCard,
      decision: card.querySelector('[data-knowledge-proposal-decision]')?.value ?? '',
      rationale: card.querySelector('[data-knowledge-proposal-rationale]')?.value.trim() ?? '',
      replacementTitle: card.querySelector('[data-knowledge-proposal-replacement-title]')?.value.trim() ?? '',
      replacementMarkdown: card.querySelector('[data-knowledge-proposal-replacement-markdown]')?.value.trim() ?? '',
    }));
    if (!reviewedBy || dispositions.some(({ decision }) => !decision)) {
      state.knowledgeProposalMessage = 'Name the reviewer and choose one disposition for every proposal.';
      const existingMessage = element('knowledgeProposalState').querySelector('.knowledge-proposal-message');
      if (existingMessage) existingMessage.textContent = state.knowledgeProposalMessage;
      else element('knowledgeProposalState').insertAdjacentHTML('afterbegin', `<div class="knowledge-proposal-message" role="status">${escapeHtml(state.knowledgeProposalMessage)}</div>`);
      return;
    }
    knowledgeProposalReview.disabled = true;
    try {
      await api(`/api/knowledge-proposals/${encodeURIComponent(knowledgeProposalReview.dataset.knowledgeProposalReview)}/review`, {
        method: 'POST', body: JSON.stringify({ reviewedBy, dispositions }),
      });
      state.knowledgeProposalMessage = 'Named review recorded. Materialisation remains a separate accountable decision.';
      await loadKnowledgeProposals(knowledgeProposalReview.dataset.knowledgeProposalReview);
    } catch (error) {
      state.knowledgeProposalMessage = error.message;
      renderKnowledgeProposals();
    } finally {
      knowledgeProposalReview.disabled = false;
    }
    return;
  }
  const knowledgeProposalMaterialise = event.target.closest('[data-knowledge-proposal-materialise]');
  if (knowledgeProposalMaterialise) {
    const approvedBy = window.prompt('Name the person separately approving additive knowledge materialisation:')?.trim();
    if (!approvedBy || !window.confirm('Create absent accepted destinations, recognise identical content and preserve every differing file as a conflict?')) return;
    knowledgeProposalMaterialise.disabled = true;
    try {
      const result = await api(`/api/knowledge-proposals/${encodeURIComponent(knowledgeProposalMaterialise.dataset.knowledgeProposalMaterialise)}/materialise`, {
        method: 'POST', body: JSON.stringify({ confirmed: true, approvedBy }),
      });
      state.knowledgeProposalMessage = `${result.counts.added} added · ${result.counts.alreadyCurrent} current · ${result.counts.conflicts} conflicts.`;
      await loadKnowledgeProposals(knowledgeProposalMaterialise.dataset.knowledgeProposalMaterialise);
    } catch (error) {
      state.knowledgeProposalMessage = error.message;
      renderKnowledgeProposals();
    } finally {
      knowledgeProposalMaterialise.disabled = false;
    }
    return;
  }
  const knowledgeProposalRecover = event.target.closest('[data-knowledge-proposal-recover]');
  if (knowledgeProposalRecover) {
    if (!window.confirm('Recover only transaction-owned incomplete writes? Changed or unrelated files will remain untouched.')) return;
    knowledgeProposalRecover.disabled = true;
    try {
      const result = await api(`/api/knowledge-proposals/${encodeURIComponent(knowledgeProposalRecover.dataset.knowledgeProposalRecover)}/recover`, {
        method: 'POST', body: JSON.stringify({ confirmed: true }),
      });
      state.knowledgeProposalMessage = result.status === 'recovered' ? 'Incomplete transaction-owned writes were removed.' : 'The materialisation transaction is already final.';
      await loadKnowledgeProposals(knowledgeProposalRecover.dataset.knowledgeProposalRecover);
    } catch (error) {
      state.knowledgeProposalMessage = error.message;
      renderKnowledgeProposals();
    } finally {
      knowledgeProposalRecover.disabled = false;
    }
    return;
  }
  const companionHandoff = event.target.closest('[data-companion-handoff]');
  if (companionHandoff) {
    await openCompanionHandoff(companionHandoff);
    return;
  }
  const companionRecommendation = event.target.closest('[data-companion-recommendation]');
  if (companionRecommendation) {
    await loadCompanion(companionRecommendation.dataset.companionRecommendation);
    return;
  }
  if (event.target.closest('[data-companion-clear]')) {
    state.companionSelection = '';
    await loadCompanion('');
    return;
  }
  const dashboardAction = event.target.closest('[data-dashboard-action]');
  if (dashboardAction) {
    openDashboardAction(dashboardAction);
    return;
  }
  const hookDelivery = event.target.closest('[data-hook-delivery]');
  if (hookDelivery) {
    state.selectedHookDeliveryId = hookDelivery.dataset.hookDelivery;
    renderHooks();
    return;
  }
  const portfolioMember = event.target.closest('[data-portfolio-member]');
  if (portfolioMember) {
    persistPortfolioSelection(`member:${portfolioMember.dataset.portfolioMember}`);
    await loadPortfolio(portfolioFocusFor('member', portfolioMember.dataset.portfolioMember));
    return;
  }
  const portfolioDependency = event.target.closest('[data-portfolio-dependency]');
  if (portfolioDependency) {
    persistPortfolioSelection(`dependency:${portfolioDependency.dataset.portfolioDependency}`);
    await loadPortfolio(portfolioFocusFor('dependency', portfolioDependency.dataset.portfolioDependency));
    return;
  }
  const rolloutProject = event.target.closest('[data-rollout-project]');
  if (rolloutProject) {
    persistRolloutSelection(`project:${rolloutProject.dataset.rolloutProject}`);
    await loadRollout(rolloutFocusFor('project', rolloutProject.dataset.rolloutProject), rolloutProject.dataset.rolloutProject);
    return;
  }
  const rolloutCohort = event.target.closest('[data-rollout-cohort]');
  if (rolloutCohort) {
    persistRolloutSelection(`cohort:${rolloutCohort.dataset.rolloutCohort}`);
    await loadRollout(rolloutFocusFor('cohort', rolloutCohort.dataset.rolloutCohort));
    return;
  }
  const rolloutBaseline = event.target.closest('[data-rollout-baseline]');
  if (rolloutBaseline) {
    persistRolloutSelection(`baseline:${rolloutBaseline.dataset.rolloutBaseline}`);
    await loadRollout(rolloutFocusFor('baseline', rolloutBaseline.dataset.rolloutBaseline));
    return;
  }
  if (event.target.closest('[data-impact-refresh]')) {
    await refreshImpact();
    return;
  }

  const guidedSectionButton = event.target.closest('[data-guided-section]');
  if (guidedSectionButton) {
    await saveGuidedLocation(guidedSectionButton.dataset.guidedSection, 0);
    return;
  }
  if (event.target.closest('[data-guided-next]')) {
    const target = adjacentGuidedLocation(1);
    await saveGuidedLocation(target.sectionId, target.questionIndex);
    return;
  }
  if (event.target.closest('[data-guided-back]')) {
    const target = adjacentGuidedLocation(-1);
    await saveGuidedLocation(target.sectionId, target.questionIndex);
    return;
  }
  if (event.target.closest('[data-guided-approve]')) {
    await approveGuidedFromBrowser();
    return;
  }
  if (event.target.closest('[data-guided-retry]')) {
    await loadGuidedDiscovery();
    return;
  }
  if (event.target.closest('[data-evidence-depth-prepare]')) {
    await prepareEvidenceDepthFromBrowser();
    return;
  }

  const intentSectionButton = event.target.closest('[data-intent-section]');
  if (intentSectionButton) {
    await saveGuidedIntentLocation(intentSectionButton.dataset.intentSection);
    return;
  }
  const intentModeButton = event.target.closest('[data-intent-mode]');
  if (intentModeButton) {
    if (state.guidedIntent.draft.revision > 0 && intentModeButton.dataset.intentMode !== state.guidedIntent.draft.mode) {
      state.guidedIntentNotice = 'Discard the current saved draft before switching authoring mode.';
    } else {
      state.guidedIntent.draft.mode = intentModeButton.dataset.intentMode;
      state.guidedIntent.draft.sourceReference = null;
    }
    renderGuidedIntent();
    return;
  }
  if (event.target.closest('[data-intent-import]')) {
    const sourceReference = element('intentSource')?.value ?? state.guidedIntent.draft.sourceReference;
    if (sourceReference) await saveGuidedIntentLocation('identity', { mode: 'reconcile', sourceReference, importOnly: true });
    return;
  }
  if (event.target.closest('[data-intent-next]')) {
    await saveGuidedIntentLocation(adjacentIntentSection(1));
    return;
  }
  if (event.target.closest('[data-intent-back]')) {
    await saveGuidedIntentLocation(adjacentIntentSection(-1));
    return;
  }
  if (event.target.closest('[data-intent-discard]')) {
    await discardGuidedIntentFromBrowser();
    return;
  }
  if (event.target.closest('[data-intent-handoff]')) {
    await copyGuidedIntentHandoff();
    return;
  }
  if (event.target.closest('[data-intent-approve]')) {
    await approveGuidedIntentFromBrowser();
    return;
  }
  if (event.target.closest('[data-intent-retry]')) {
    await loadGuidedIntent();
    return;
  }

  const phaseContextButton = event.target.closest('[data-phase-context]');
  if (phaseContextButton) {
    await savePhaseStudioContribution(phaseContextButton.dataset.phaseContext);
    return;
  }
  const phaseTopicButton = event.target.closest('[data-phase-topic]');
  if (phaseTopicButton) {
    state.phaseStudioTopic = phaseTopicButton.dataset.phaseTopic;
    renderPhaseStudio();
    return;
  }
  if (event.target.closest('[data-phase-save]')) {
    await savePhaseStudioContribution();
    return;
  }
  if (event.target.closest('[data-phase-discard]')) {
    await discardPhaseStudio();
    return;
  }
  if (event.target.closest('[data-phase-handoff]')) {
    await handoffPhaseStudio();
    return;
  }
  if (event.target.closest('[data-phase-review]')) {
    await requestPhaseStudioReview();
    return;
  }
  if (event.target.closest('[data-phase-confirm]')) {
    await confirmPhaseStudio();
    return;
  }

  const securityRun = event.target.closest('[data-security-run]');
  if (securityRun) {
    await runSecurityProfile(securityRun);
    return;
  }
  const securityImport = event.target.closest('[data-security-import]');
  if (securityImport) {
    await importSecurityProvider(securityImport);
    return;
  }
  const securityCancel = event.target.closest('[data-security-cancel]');
  if (securityCancel) {
    await cancelSecurityRunFromDashboard(securityCancel);
    return;
  }
  const starterRecovery = event.target.closest('[data-starter-recover]');
  if (starterRecovery) {
    await recoverStarterFromDashboard(starterRecovery);
    return;
  }

  const viewButton = event.target.closest('[data-view]');
  if (viewButton) return setView(viewButton.dataset.view);

  const boardMode = event.target.closest('[data-board-mode]');
  if (boardMode) {
    state.boardMode = boardMode.dataset.boardMode;
    document.querySelectorAll('[data-board-mode]').forEach((button) => button.classList.toggle('active', button === boardMode));
    renderKanban();
    return;
  }

  const groupButton = event.target.closest('[data-group]');
  if (groupButton) {
    state.group = groupButton.dataset.group;
    renderBoard();
    return;
  }

  const sprintButton = event.target.closest('[data-sprint-item]');
  if (sprintButton) {
    event.stopPropagation();
    const item = state.items.find((candidate) => candidate.id === sprintButton.dataset.sprintItem);
    sprintButton.disabled = true;
    try {
      await api(`/api/work-items/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify({ currentSprint: !item.currentSprint }) });
      await loadBoard();
    } finally {
      sprintButton.disabled = false;
    }
    return;
  }

  const itemButton = event.target.closest('[data-open-item]');
  if (itemButton) openItem(itemButton.dataset.openItem).catch(console.error);

  const knowledgeButton = event.target.closest('[data-knowledge-path]');
  if (knowledgeButton) openKnowledgeDocument(knowledgeButton.dataset.knowledgePath).catch(console.error);

  const linkPersonaButton = event.target.closest('[data-link-persona]');
  if (linkPersonaButton) {
    linkPersonaButton.disabled = true;
    linkPersona(linkPersonaButton.dataset.linkPersona).catch((error) => {
      linkPersonaButton.disabled = false;
      linkPersonaButton.textContent = 'Try again';
      console.error(error);
    });
  }

  const unlinkPersonaButton = event.target.closest('[data-unlink-persona]');
  if (unlinkPersonaButton) {
    unlinkPersonaButton.disabled = true;
    unlinkPersona(unlinkPersonaButton.dataset.unlinkPersona).catch((error) => {
      unlinkPersonaButton.disabled = false;
      unlinkPersonaButton.textContent = 'Try again';
      console.error(error);
    });
  }

  if (event.target.closest('[data-retry-personas]')) loadPersonaLibrary().catch(console.error);
});

document.addEventListener('submit', async (event) => {
  // A form control named "id" shadows HTMLFormElement.id in browsers, so use
  // structural matching rather than the named property for this delegated form.
  if (!event.target.matches?.('#teamHubResourceInstallForm')) return;
  event.preventDefault();
  const input = Object.fromEntries(new FormData(event.target).entries());
  if (!event.target.elements.confirmed.checked) return;
  if (!window.confirm(`Install ${input.id}@${input.version} at the displayed digest? This will not select or apply it.`)) return;
  state.teamHubNotice = 'Downloading, verifying and installing the exact release…'; state.teamHubError = ''; renderTeamHub();
  try {
    const result = await api('/api/team-hub/resources/install', { method: 'POST', body: JSON.stringify({ ...input, confirmed: true }) });
    state.teamHub.resources = result.workspace;
    state.teamHubResourceInspection.installed = result.workspace.installed.find((resource) => resource.id === input.id) ?? null;
    state.teamHubNotice = `${result.receipt?.action ?? 'Existing release'} complete. Select or apply the resource separately.`;
  } catch (error) { state.teamHubError = error.message; state.teamHubNotice = ''; }
  renderTeamHub();
});

document.addEventListener('input', (event) => {
  if (event.target.form?.id === 'impactAnalyseForm') {
    state.impactDraft[event.target.name] = event.target.value;
    return;
  }
  if (event.target.id === 'guidedApprover') {
    updateGuidedApprovalState();
    return;
  }
  if (event.target.id === 'intentStudioApprover') {
    updateIntentApprovalState();
    return;
  }
  if (event.target.matches('[data-intent-path]')) {
    updateGuidedIntentValue(event.target);
    return;
  }
  if (event.target.matches('[data-guided-path]')) {
    updateGuidedAnswer(event.target);
    return;
  }
  if (event.target.id !== 'personaSearch') return;
  state.personaQuery = event.target.value;
  element('personaResults').innerHTML = personaResults(state.selected);
});

document.addEventListener('submit', (event) => {
  if (event.target.id === 'prototypeReviewForm') {
    event.preventDefault();
    submitPrototypeReview().catch(console.error);
    return;
  }
  if (event.target.id === 'evidenceDepthReview') {
    event.preventDefault();
    recordEvidenceDepthFromBrowser(event.target).catch(console.error);
    return;
  }
  if (event.target.id === 'evidenceDepthCompare') {
    event.preventDefault();
    compareEvidenceDepthFromBrowser(event.target).catch(console.error);
  }
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'errorReportFilter') {
    loadErrorReports(event.target.value).catch((error) => { state.errorReportNotice = error.message; renderErrorReports(); });
    return;
  }
  if (event.target.id === 'errorReportAutomaticDrafts') {
    const enabled = event.target.checked;
    api('/api/error-reports/settings', { method: 'PATCH', body: JSON.stringify({ automaticLocalDrafts: enabled }) })
      .then(() => { state.errorReportNotice = enabled ? 'Automatic local drafts enabled. No remote handoff is enabled.' : 'Automatic local drafts disabled.'; return loadErrorReports(); })
      .catch((error) => { state.errorReportNotice = error.message; renderErrorReports(); });
    return;
  }
  if (event.target.matches('[data-phase-work-item]')) {
    state.phaseStudio = null;
    state.prototypeReview = null;
    state.prototypeReviewError = '';
    state.prototypeReviewNotice = '';
    state.phaseStudioReference = event.target.value;
    loadPhaseStudio(event.target.value).catch(console.error);
    return;
  }
  if (event.target.id === 'hookStatusFilter' || event.target.id === 'hookEventFilter' || event.target.id === 'hookHandlerFilter') {
    const key = event.target.id === 'hookStatusFilter' ? 'status' : event.target.id === 'hookEventFilter' ? 'event' : 'handler';
    state.hookFilters[key] = event.target.value;
    state.selectedHookDeliveryId = '';
    loadHooks().catch(console.error);
    return;
  }
  if (event.target.matches('[data-test-scenario-filter]')) {
    state.testScenarioFilters[event.target.dataset.testScenarioFilter] = event.target.value;
    renderDrawer();
    return;
  }
  if (event.target.matches('[data-impact-route]')) {
    updateImpactRationaleRequirement(event.target);
    return;
  }
  if (event.target.id === 'guidedConfirmed') {
    updateGuidedApprovalState();
    return;
  }
  if (event.target.id === 'intentStudioConfirmed') {
    updateIntentApprovalState();
    return;
  }
  if (event.target.matches('[data-intent-source]')) {
    state.guidedIntent.draft.sourceReference = event.target.value || null;
    const button = document.querySelector('[data-intent-import]');
    if (button) button.disabled = !event.target.value;
    return;
  }
  if (event.target.matches('[data-intent-path]')) {
    updateGuidedIntentValue(event.target);
    return;
  }
  if (event.target.matches('[data-guided-path]')) {
    updateGuidedAnswer(event.target);
    return;
  }
  if (event.target.matches('[data-blueprint-module]')) {
    const selection = valueAtPath(state.guided?.draft.answers, 'delivery.organisationBlueprint');
    if (!selection?.packId) return;
    const enabled = new Set(selection.enabledModules ?? []);
    if (event.target.checked) enabled.add(event.target.dataset.blueprintModule);
    else enabled.delete(event.target.dataset.blueprintModule);
    selection.enabledModules = [...enabled].sort();
    state.guidedSaveState = 'Unsaved changes';
    renderGuided();
    return;
  }
  if (state.pendingAction?.kind === 'afk-start' && event.target.form?.id === 'actionForm') {
    const values = Object.fromEntries(new FormData(event.target.form));
    state.pendingAction.provider = values.provider || 'auto';
    state.pendingAction.maxParallel = Math.max(1, Number(values.maxParallel || 1));
    state.pendingAction.timeoutMinutes = Math.max(1, Number(values.timeoutMinutes || 45));
    state.pendingAction.preflight = null;
    renderActionDialog();
    refreshAfkPreflight();
    return;
  }
  if (event.target.id === 'newPersonaRole') state.personaRole = event.target.value;
  if (event.target.id === 'newPersonaDepth') state.personaDepth = Number(event.target.value);
  const row = event.target.closest('[data-attached-persona]');
  if (!row || (!event.target.matches('[data-persona-role]') && !event.target.matches('[data-persona-depth]'))) return;
  const ref = row.dataset.attachedPersona;
  const role = row.querySelector('[data-persona-role]').value;
  const depth = Number(row.querySelector('[data-persona-depth]').value);
  const controls = [...row.querySelectorAll('select, button')];
  controls.forEach((control) => { control.disabled = true; });
  linkPersona(ref, role, depth).catch((error) => {
    controls.forEach((control) => { control.disabled = false; });
    console.error(error);
  });
});

document.addEventListener('submit', async (event) => {
  if (event.target.id === 'teamHubConnectForm') {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    const submit = event.target.querySelector('[type="submit"]'); submit.disabled = true;
    try {
      state.teamHub = await api('/api/team-hub/connect', {
        method: 'POST',
        body: JSON.stringify({
          endpoint: values.endpoint,
          ...(values.projectId ? { projectId: values.projectId } : {}),
          tokenEnv: values.tokenEnv,
          confirmed: true,
          disclosureAcknowledged: values.disclosureAcknowledged === 'on',
        }),
      });
      state.teamHubNotice = 'Connected. No snapshot has been published automatically.'; state.teamHubError = '';
    } catch (error) { state.teamHubError = error.message; state.teamHubNotice = ''; }
    finally { submit.disabled = false; renderTeamHub(); }
    return;
  }
  if (event.target.id === 'errorReportCreateForm') {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    values.reproductionSteps = String(values.reproductionSteps || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    const submit = event.target.querySelector('[type="submit"]'); submit.disabled = true;
    try {
      const created = await api('/api/error-reports', { method: 'POST', body: JSON.stringify(values) });
      state.selectedErrorReportId = created.id; state.errorReportNotice = 'Local draft created. Nothing was sent.';
      event.target.reset(); event.target.hidden = true; await loadErrorReports();
    } catch (error) { state.errorReportNotice = error.message; renderErrorReports(); }
    finally { submit.disabled = false; }
    return;
  }
  if (event.target.id === 'policyIntentForm') {
    event.preventDefault();
    state.policyIntent = String(new FormData(event.target).get('intent') || '').trim();
    await loadPolicy();
    return;
  }
  if (event.target.matches('[data-policy-review]')) {
    event.preventDefault();
    await submitPolicyReview(event.target);
    return;
  }
  if (event.target.id === 'contextInspectorForm') {
    event.preventDefault();
    await prepareContextInspector(event.target);
    return;
  }
  if (event.target.id === 'companionFocusForm') {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    state.companionSelection = '';
    await loadCompanion(values.focus);
    return;
  }
  if (event.target.id === 'starterPreviewForm') {
    event.preventDefault();
    const submit = event.target.querySelector('[type="submit"]');
    submit.disabled = true;
    const values = Object.fromEntries(new FormData(event.target));
    state.startersNotice = 'Preparing and independently verifying the adapter output…';
    renderStarters();
    try {
      await api('/api/starter-materialisation/previews', { method: 'POST', body: JSON.stringify({ receiptId: values.receiptId, adapterId: values.adapterId, confirmed: values.confirmed === 'on' }) });
      state.startersNotice = 'Immutable preview prepared. Review the grouped counts before approval.';
      await loadStarters();
    } catch (error) {
      state.startersNotice = error.message;
      renderStarters();
    } finally {
      submit.disabled = false;
    }
    return;
  }
  if (event.target.matches('[data-starter-apply]')) {
    event.preventDefault();
    const submit = event.target.querySelector('[type="submit"]');
    submit.disabled = true;
    const values = Object.fromEntries(new FormData(event.target));
    state.startersNotice = 'Revalidating the preview and applying missing content additively…';
    renderStarters();
    try {
      await api(`/api/starter-materialisation/previews/${encodeURIComponent(event.target.dataset.starterApply)}/apply`, { method: 'POST', body: JSON.stringify({ confirmed: values.confirmed === 'on', approvedBy: values.approvedBy }) });
      state.startersNotice = 'Starter Pack materialised and canonical evidence recorded.';
      await loadStarters();
    } catch (error) {
      state.startersNotice = error.message;
      renderStarters();
    } finally {
      submit.disabled = false;
    }
    return;
  }
  if (event.target.matches('[data-security-disposition]')) {
    event.preventDefault();
    const submit = event.target.querySelector('[type="submit"]');
    submit.disabled = true;
    const values = Object.fromEntries(new FormData(event.target));
    values.evidence = String(values.evidence ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    if (values.expiresAt) values.expiresAt = new Date(values.expiresAt).toISOString();
    try {
      await api(`/api/security-validation/findings/${encodeURIComponent(event.target.dataset.securityDisposition)}/dispositions`, {
        method: 'POST', body: JSON.stringify(values),
      });
      await loadSecurity();
      state.securityNotice = 'Accountable decision recorded. Readiness has been recalculated.';
      renderSecurity();
    } catch (error) {
      state.securityNotice = error.message;
      renderSecurity();
    } finally {
      submit.disabled = false;
    }
    return;
  }
  if (event.target.id === 'impactAnalyseForm') {
    event.preventDefault();
    await analyseImpact(event.target);
    return;
  }
  if (event.target.id === 'impactConfirmForm') {
    event.preventDefault();
    await confirmImpact(event.target);
    return;
  }
  if (event.target.id === 'actionForm') {
    event.preventDefault();
    await submitDashboardAction(event.target);
    return;
  }
  if (event.target.id !== 'createPersonaForm') return;
  event.preventDefault();
  const submit = event.target.querySelector('[type="submit"]');
  submit.disabled = true;
  const values = Object.fromEntries(new FormData(event.target));
  let response;
  try {
    response = await api('/api/personas', { method: 'POST', body: JSON.stringify(values) });
  } catch (error) {
    submit.disabled = false;
    submit.textContent = error.message;
    return;
  }
  state.personas.push(response.persona);
  state.pendingPersonaLink = { id: response.persona.id, name: response.persona.name, message: 'The persona definition is safely stored. Retry the intent attachment.' };
  renderDrawer();
  try {
    await linkPersona(response.persona.id);
  } catch (error) {
    state.pendingPersonaLink.message = error.message;
    renderDrawer();
  }
});

element('search').addEventListener('input', (event) => {
  state.query = event.target.value;
  if (state.view === 'knowledge') {
    window.clearTimeout(knowledgeSearchTimer);
    knowledgeSearchTimer = window.setTimeout(() => loadKnowledge(state.query).catch(console.error), 180);
  } else renderBoard();
});
element('sprintOnly').addEventListener('click', () => {
  state.sprintOnly = !state.sprintOnly;
  element('sprintOnly').classList.toggle('active', state.sprintOnly);
  element('sprintOnly').setAttribute('aria-pressed', String(state.sprintOnly));
  renderBoard();
});
element('showDone').addEventListener('change', (event) => {
  state.showDone = event.target.checked;
  renderBoard();
});
element('refresh').addEventListener('click', () => {
  if (['configuration', 'companion', 'live'].includes(state.view)) loadAutonomyState().catch(console.error);
  if (state.view === 'hooks') loadHooks().catch(console.error);
  else if (state.view === 'policies') loadPolicy().catch(console.error);
  else if (state.view === 'security') loadSecurity().catch(console.error);
  else if (state.view === 'error-reporting') loadErrorReports().catch(console.error);
  else if (state.view === 'team-hub') loadTeamHub().catch(console.error);
  else if (state.view === 'starters') loadStarters().catch(console.error);
  else if (state.view === 'intent-studio') loadGuidedIntent().catch(console.error);
  else if (state.view === 'context-inspector') renderContextInspector();
  else if (state.view === 'companion') loadCompanion().catch(console.error);
  else loadBoard().catch(console.error);
});
element('contextProfile').addEventListener('change', (event) => {
  const budgets = { companion: 2000, intent: 4000, plan: 8000, 'build-task': 12000, 'fresh-context-review': 12000, 'phase-contribution-review': 6000 };
  element('contextBudget').value = String(budgets[event.target.value] ?? 4000);
  const requiresTask = ['build-task', 'fresh-context-review'].includes(event.target.value);
  element('contextTask').required = requiresTask;
  element('contextTask').closest('label').classList.toggle('required', requiresTask);
});
element('kpiToggle').addEventListener('pointerenter', showKpis);
element('kpiToggle').addEventListener('pointerleave', scheduleKpiHide);
element('kpiToggle').addEventListener('focus', showKpis);
element('kpiToggle').addEventListener('blur', scheduleKpiHide);
element('summary').addEventListener('pointerenter', showKpis);
element('summary').addEventListener('pointerleave', scheduleKpiHide);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !element('summary').hidden) hideKpis();
});
element('closeDrawer').addEventListener('click', () => element('intentDialog').close());
element('intentDialog').addEventListener('click', (event) => {
  if (event.target === element('intentDialog')) element('intentDialog').close();
});
element('closeAction').addEventListener('click', closeDashboardAction);
element('cancelAction').addEventListener('click', closeDashboardAction);
element('actionDialog').addEventListener('click', (event) => {
  if (event.target === element('actionDialog')) closeDashboardAction();
});
element('actionDialog').addEventListener('close', () => { state.pendingAction = null; });
element('drawerTabs').addEventListener('click', (event) => {
  const tab = event.target.closest('[data-tab]');
  if (!tab) return;
  activateDrawerTab(tab);
});
element('drawerTabs').addEventListener('keydown', (event) => {
  const tab = event.target.closest('[data-tab]');
  if (!tab) return;
  const tabs = [...element('drawerTabs').querySelectorAll('[data-tab]')];
  const current = tabs.indexOf(tab);
  const destinations = {
    ArrowLeft: (current - 1 + tabs.length) % tabs.length,
    ArrowRight: (current + 1) % tabs.length,
    Home: 0,
    End: tabs.length - 1
  };
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    activateDrawerTab(tab, { focus: true });
    return;
  }
  if (!(event.key in destinations)) return;
  event.preventDefault();
  activateDrawerTab(tabs[destinations[event.key]], { focus: true });
});

function premiumSetupErrorMessage(error) {
  if (error.status === 404) return "This dashboard is out of date and can't set up personas. Restart EWAI, then open the new dashboard link and try again. Your existing personas are unchanged.";
  if (error instanceof TypeError || error.name === 'AbortError' || error.name === 'TimeoutError') return "We couldn't reach the dashboard or confirm setup finished. Restart EWAI, open the new dashboard link and check persona status before trying again. Your own personas are untouched.";
  if (error.status === 403) return 'This request was blocked. Open the dashboard link from your current EWAI session and try again there.';
  const body = error.body;
  if (body?.schema === 'ewai.premium-setup/v1' && body.status === 'failed') {
    const messages = {
      invalid_licence_key: "We couldn't verify that key. Copy it from My Account or your team invitation and try again. Your previous licence and personas are unchanged.",
      invalid_licence: "We couldn't verify that key. Copy it from My Account or your team invitation and try again. Your previous licence and personas are unchanged.",
      installation_limit_reached: 'This licence is already active on three machines. Deactivate a machine in My Account, then try again.',
      subscription_expired: 'Your subscription has expired. Renew in My Account to download the pack or updates.',
      subscription_inactive: 'This subscription is inactive. Check its status in My Account before trying again.'
    };
    if (Object.hasOwn(messages, body.code)) return messages[body.code];
    if (body.stage === 'download') return "Your licence was saved, but the pack wasn't installed. Check your connection and retry. Your existing personas haven't been overwritten.";
    if (body.stage === 'verification') return "The download finished, but we couldn't confirm the pack is ready. Check persona status, then retry before using premium personas.";
    if (body.stage === 'activation') return "We couldn't verify the licence. Check the key in My Account and your connection, then try again. Your previous licence and personas are unchanged.";
  }
  return "We couldn't complete persona setup. Check the key and your connection, then try again when no other setup is running. If it keeps failing, restart EWAI and check persona status.";
}

let premiumSetupBusy = false;
function closePremiumSetup() {
  if (premiumSetupBusy) return;
  element('premiumLicenceKey').value = '';
  element('premiumSetupDialog').close();
}
element('premiumSetup').addEventListener('click', () => {
  if (premiumSetupBusy) return;
  element('premiumLicenceKey').value = '';
  element('premiumLicenceKey').disabled = false;
  element('submitPremiumSetup').disabled = false;
  element('submitPremiumSetup').textContent = 'Verify and install personas';
  element('premiumSetupStatus').textContent = '';
  element('premiumSetupDialog').showModal();
  element('premiumLicenceKey').focus();
});
document.addEventListener('click', event => {
  if (event.target.closest('[data-premium-setup]')) element('premiumSetup').click();
});
element('closePremiumSetup').addEventListener('click', closePremiumSetup);
element('cancelPremiumSetup').addEventListener('click', closePremiumSetup);
element('premiumSetupDialog').addEventListener('cancel', event => { if (premiumSetupBusy) event.preventDefault(); });
element('premiumSetupDialog').addEventListener('close', () => { element('premiumLicenceKey').value = ''; });
element('premiumSetupForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (premiumSetupBusy) return;
  let licenceKey = element('premiumLicenceKey').value.trim();
  element('premiumLicenceKey').value = '';
  if (!licenceKey) return;
  premiumSetupBusy = true;
  element('submitPremiumSetup').disabled = true;
  element('premiumLicenceKey').disabled = true;
  element('premiumSetupStatus').textContent = 'Verifying your licence and installing the pack…';
  try {
    const request = api('/api/personas/premium/setup', { method: 'POST', body: JSON.stringify({ licenceKey, confirmed: true }) });
    licenceKey = undefined;
    const result = await request;
    if (result.status !== 'ready' || result.installed !== true || result.verified !== true) {
      const failure = new Error('Persona setup could not be confirmed');
      failure.body = { schema: 'ewai.premium-setup/v1', status: 'failed', stage: 'verification' };
      throw failure;
    }
    element('premiumSetupStatus').textContent = `Premium personas are ready. Version ${result.version}; ${result.personaCount} personas installed. You can use them in this session.`;
    element('submitPremiumSetup').textContent = 'Installed';
    try {
      const [project, library] = await Promise.all([api('/api/project'), api('/api/personas')]);
      state.project = project;
      state.personas = library.personas;
      state.personaError = null;
      renderPremiumUpgrade();
      await refreshRuntime();
      if (element('personaResults') && state.selected) {
        element('personaResults').innerHTML = personaResults(state.selected);
        element('personaLibraryCount').textContent = String(state.personas.length);
      }
    } catch { element('premiumSetupStatus').textContent += ' Refresh the dashboard to reload the persona catalogue.'; }
  } catch (error) {
    element('premiumSetupStatus').textContent = premiumSetupErrorMessage(error);
    element('submitPremiumSetup').textContent = 'Verify and install personas';
    element('premiumLicenceKey').disabled = false;
    element('submitPremiumSetup').disabled = false;
    element('premiumLicenceKey').focus();
  } finally {
    licenceKey = undefined;
    premiumSetupBusy = false;
    if (element('submitPremiumSetup').textContent === 'Installed') element('premiumLicenceKey').disabled = false;
  }
});

const navigation=createDashboardNavigation({api,onSelect:setView,onManageLicence:()=>element('premiumSetup').click()});
configureAutonomyDashboard({api,getItems:()=>state.items,openIntent:openItem,showView:setView});
Promise.all([navigation.refresh(),loadBoard()]).then(() => {
  loadAutonomyState().catch(console.error);
  if (!state.pollTimer) state.pollTimer = window.setInterval(() => refreshRuntime().catch(console.error), 5000);
}).catch((error) => {
  element('runtimeStatus').textContent = error.message;
  element('kanban').innerHTML = `<div class="fatal-error"><strong>Dashboard unavailable</strong><p>${escapeHtml(error.message)}</p></div>`;
});
