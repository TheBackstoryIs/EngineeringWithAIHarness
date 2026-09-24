// Browser projections and controls for the server-owned autonomy contract.
// No project root, provider command or credential is accepted from this module.
const $ = id => document.getElementById(id);
const view = { status: null, preview: null, draftPreview: null, draftIds: new Set(), poolSignature: '',
  draftTouched: false, draftHydrated: false, loading: false, busy: false, dispatching: false,
  resuming: new Set(), error: '', notice: '', requestRevision: 0, control: null, answer: null, runIntentId: '' };
let host = null;

function node(tag, content = '', className = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = String(content ?? '');
  return element;
}
function set(id, content) { $(id).textContent = String(content ?? ''); }
function replace(id, ...children) { $(id).replaceChildren(...children); }
function replacePreservingFocus(id, ...children) {
  const container = $(id), focused = container.contains(document.activeElement) ? document.activeElement.dataset.autonomyFocus : '';
  container.replaceChildren(...children);
  if (!focused) return;
  const replacement = [...container.querySelectorAll('[data-autonomy-focus]')].find(element => element.dataset.autonomyFocus === focused && !element.disabled);
  if (replacement) replacement.focus();
  else (id === 'autonomyLiveRuns' ? $('autonomyLiveTitle') : $('autonomyCompanionStatus')).focus();
}
function staleDecision(code = 'autonomy-preview-stale') { return { status: 409, body: { code } }; }
function itemFor(intentId) { return host.getItems().find(item => item.intentId === intentId); }
function titleFor(intentId) { return itemFor(intentId)?.title || intentId; }
function humanReason(code) {
  return ({ 'grant-revoked': 'Grant revoked', 'outside-approved-pool': 'Outside your exact pool',
    'autonomy-off': 'Autonomy off', 'build-approval-required': 'Build approval needed',
    'prototype-selection-required': 'Prototype selection needed', 'manual-qa-required': 'Manual QA needed',
    'repository-ownership-conflict': 'Repository is in use', 'afk-preflight-required': 'Build preflight needed',
    'action-not-approved': 'Action is outside this grant', 'grant-policy-changed': 'Grant needs a fresh review',
    'grant-expired': 'Grant expired', 'autonomy-provider-unavailable': 'Provider unavailable',
    'autonomy-execution-unknown': 'Execution outcome unknown' })[code] || String(code ?? 'A prerequisite needs review').replaceAll('-', ' ');
}
function safeError(error) {
  const code = error?.body?.code;
  if (code === 'autonomy-preview-stale' || code === 'autonomy-run-stale' || code === 'autonomy-grant-stale'
    || code === 'autonomy-policy-stale') return 'The evidence changed. Refresh and review the current state before trying again.';
  if (code === 'autonomy-repository-dirty') return 'The repository has uncommitted work. Resolve it before dispatch.';
  if (code === 'autonomy-canonical-decision-required') return 'A named human decision is required before this run can continue.';
  return /^autonomy-[a-z0-9-]+$/.test(code ?? '') ? `EWAI stopped at ${humanReason(code)}. Refresh and inspect the recorded prerequisite.`
    : 'Autonomy is unavailable. Refresh the dashboard and inspect the project checks.';
}
const mutation = (action, input) => host.api(`/api/autonomy/${action}`, { method: 'POST', body: JSON.stringify(input) });
function badge() {
  if (!view.status) return 'Autonomy unavailable';
  if (view.status.status === 'revoked') return 'Grant revoked';
  if (view.status.status === 'expired') return 'Grant expired';
  return view.status.mode === 'delegated' ? 'Delegated within your grant' : 'Autonomy off';
}

function renderPool() {
  const items = host.getItems().filter(item => item.intentId).sort((a, b) => a.intentId.localeCompare(b.intentId));
  const signature = JSON.stringify(items.map(item => [item.intentId, item.title]));
  if (signature === view.poolSignature) return;
  view.poolSignature = signature;
  const choices = items.map(item => {
    const choice = node('button', '', 'autonomy-pool-choice');
    choice.type = 'button'; choice.setAttribute('role', 'checkbox'); choice.setAttribute('aria-checked', String(view.draftIds.has(item.intentId)));
    choice.value = item.intentId;
    choice.addEventListener('click', () => {
      const checked = choice.getAttribute('aria-checked') !== 'true';
      choice.setAttribute('aria-checked', String(checked));
      if (checked) view.draftIds.add(item.intentId); else view.draftIds.delete(item.intentId);
      view.draftTouched = true;
      view.draftPreview = null; renderAutonomyConfiguration();
    });
    const mark = node('span', '✓', 'autonomy-pool-mark'); mark.setAttribute('aria-hidden', 'true');
    choice.append(mark, node('span', item.title || item.intentId), node('small', item.intentId));
    return choice;
  });
  replace('autonomyPool', ...(choices.length ? choices : [node('p', 'No project intents are available for an exact pool.')]));
}
function selectedProposal() {
  const intents = [...view.draftIds].sort();
  const actions = [...document.querySelectorAll('[name="autonomyAction"][aria-checked="true"]')].map(input => input.value);
  const provider = $('autonomyProvider').value;
  const hours = Number($('autonomyExpiryHours').value), runtimeMinutes = Number($('autonomyRuntimeMinutes').value);
  const operationSeconds = Number($('autonomyOperationSeconds').value), attempts = Number($('autonomyAttempts').value);
  if (!intents.length || !actions.length || !Number.isSafeInteger(hours) || hours < 1 || hours > 24
    || !Number.isSafeInteger(runtimeMinutes) || runtimeMinutes < 1 || runtimeMinutes > 1440
    || !Number.isSafeInteger(operationSeconds) || operationSeconds < 1 || operationSeconds > 3600
    || operationSeconds > runtimeMinutes * 60 || !Number.isSafeInteger(attempts) || attempts < 1 || attempts > 100) {
    throw new Error('Choose at least one exact intent and action, then enter valid expiry and limits.');
  }
  return { intentIds: intents, actions, providers: [provider], expiresAt: new Date(Date.now() + hours * 3600000).toISOString(),
    limits: { maxConcurrentIntents: 1, maxRuntimeMs: runtimeMinutes * 60000, maxOperationMs: operationSeconds * 1000, maxAttempts: attempts } };
}
function grantSummary(scope) {
  if (!scope) return 'No approved grant. Select an exact pool to preview it.';
  return `Exact pool: ${scope.intentIds.join(', ')}. Actions: ${scope.actions.join(', ')}. Provider: ${scope.providers.join(', ')}. One intent at a time; ${Math.round(scope.limits.maxRuntimeMs / 60000)} minute run, ${Math.round(scope.limits.maxOperationMs / 1000)} second operation, ${scope.limits.maxAttempts} attempts. Expires ${new Date(scope.expiresAt).toLocaleString()}.`;
}
function draftIsApprovable() {
  const preview = view.draftPreview;
  return Boolean(!view.error && preview?.proposal?.intentIds?.length);
}

export function renderAutonomyConfiguration() {
  if (!host) return;
  renderPool();
  set('autonomyMode', badge());
  $('autonomyMode').className = `autonomy-mode ${view.status?.status === 'current' ? 'delegated' : view.status?.status === 'revoked' ? 'revoked' : ''}`;
  $('autonomyReviewButton').disabled = view.busy || !draftIsApprovable();
  $('autonomyRevokeButton').disabled = view.busy || view.status?.status !== 'current';
  $('autonomyPreviewButton').disabled = view.busy;
  set('autonomyConfigurationStatus', view.error || view.notice || (view.loading ? 'Checking current authority and work…'
    : view.status?.status === 'current' ? 'Grant active. Project evidence and all human checkpoints are rechecked before dispatch.'
      : view.status?.status === 'revoked' ? 'Grant revoked. Pending work remains visible and no new action can start.'
        : 'Autonomy is off until you approve a named grant.'));
  const saved = view.status?.grant?.scope ? `Current approved grant: ${grantSummary(view.status.grant.scope)}` : '';
  const summary = view.draftPreview
    ? `${saved ? `${saved} ` : ''}New grant draft preview: ${grantSummary(view.draftPreview.proposal)} Preview only: ${view.draftPreview.executable.length} can progress; ${view.draftPreview.humanDecisions.length} need people; ${view.draftPreview.blocked.length} are blocked.`
    : saved || grantSummary(null);
  set('autonomyProposalSummary', summary);
}

function candidateCard(candidate, kind, allowRun = false) {
  const card = node('article', '', `autonomy-candidate ${kind}`);
  card.append(node('h5', titleFor(candidate.intentId)), node('small', candidate.intentId));
  const action = candidate.action ? humanReason(candidate.action) : 'No executable action';
  card.append(node('p', `Next: ${action}. Phase: ${candidate.phase || 'unrecorded'}.`));
  if (candidate.reasons?.length) card.append(node('p', candidate.reasons.map(reason => humanReason(reason.code)).join(' · '), 'autonomy-reasons'));
  const buttons = node('div', '', 'autonomy-card-actions');
  if (kind === 'executable') {
    const run = node('button', 'Run next action', 'primary-action'); run.type = 'button';
    run.dataset.autonomyFocus = `dispatch:${candidate.intentId}`;
    run.disabled = !allowRun; run.addEventListener('click', () => openDispatch(candidate.intentId, run)); buttons.append(run);
    if (!allowRun && view.status?.status === 'current' && !view.busy && !view.dispatching) card.append(node('p', 'Ordered after an earlier eligible action.', 'autonomy-reasons'));
  }
  const inspect = node('button', 'Inspect intent', 'secondary-action'); inspect.type = 'button';
  inspect.dataset.autonomyFocus = `inspect:${candidate.intentId}`;
  inspect.addEventListener('click', () => { const item = itemFor(candidate.intentId); if (item) host.openIntent(item.id); });
  buttons.append(inspect); card.append(buttons); return card;
}
function emptyCard(message, withDisabledRun = false) {
  const card = node('div', '', 'autonomy-empty'); card.append(node('p', message));
  if (withDisabledRun) { const button = node('button', 'Run next action', 'primary-action'); button.type = 'button'; button.disabled = true; card.append(button); }
  return card;
}
export function renderAutonomyDecisions() {
  if (!host) return;
  const preview = view.draftPreview || view.preview;
  if (!preview || view.error) {
    set('autonomyCompanionStatus', view.error || 'Checking governed work…');
    replacePreservingFocus('autonomyCanProgress', emptyCard('No trusted eligibility projection is available.', true));
    replacePreservingFocus('autonomyNeedsHuman', emptyCard('Human checkpoints will appear here.'));
    replacePreservingFocus('autonomyBlocked', emptyCard('Refresh to inspect exclusions.'));
    return;
  }
  const granted = view.status?.status === 'current' && !view.draftPreview;
  set('autonomyCompanionStatus', granted ? 'Bounded by the current named grant. Each action is rechecked before dispatch.'
    : view.status?.status === 'revoked' ? 'Grant revoked. Pending work is retained below; dispatch is disabled.'
      : 'Preview only. No provider or project action starts from this list.');
  replacePreservingFocus('autonomyCanProgress', ...(preview.executable.length
    ? preview.executable.map((candidate, index) => candidateCard(candidate, 'executable', granted && !view.busy && !view.dispatching && index === 0))
    : [emptyCard('No work can progress under the current authority.', true)]));
  replacePreservingFocus('autonomyNeedsHuman', ...(preview.humanDecisions.length
    ? preview.humanDecisions.map(candidate => candidateCard(candidate, 'human'))
    : [emptyCard('No human checkpoint is waiting in this pool.')]));
  replacePreservingFocus('autonomyBlocked', ...(preview.blocked.length
    ? preview.blocked.map(candidate => candidateCard(candidate, 'blocked'))
    : [emptyCard('No additional exclusions in this projection.')]));
}

function runExplanation(run) {
  if (run.status === 'cancel-requested' || run.cancellation?.status === 'requested') return 'Cancellation requested. Process termination is not yet confirmed; do not retry the action.';
  if (run.status === 'cancelled' && run.cancellation?.status === 'confirmed') return 'Process stop confirmed. Captured work remains available for review.';
  if (run.status === 'recovery-required' || run.cancellation?.status === 'unknown') return 'Outcome uncertain. Reconcile the run and canonical evidence before any retry.';
  if (run.status === 'awaiting-human') return 'Stopped at a human checkpoint. A recorded answer does not approve the gate.';
  if (run.status === 'paused') return 'Paused before another dispatch. Resume rechecks authority, evidence and limits.';
  if (run.status === 'completed') return 'Bounded action completed. Human approvals remain separate.';
  return 'The current action is bounded by the approved grant and recorded limits.';
}
function questionContext(question) {
  return `${titleFor(question.intentId)} · ${question.phase} · owner ${question.owner} · ${question.codes.map(humanReason).join(' · ') || 'Named human decision'}`;
}
function renderAutonomyLive() {
  if (!host) return;
  set('autonomyLiveStatus', view.error || view.notice);
  if (!view.status) return replacePreservingFocus('autonomyLiveRuns', emptyCard(view.error || 'Run status is unavailable.'));
  const runs = view.status.runs || [];
  if (!runs.length) return replacePreservingFocus('autonomyLiveRuns', emptyCard(view.error || (view.dispatching
    ? 'Dispatch request pending. Run controls appear when the server records a run.' : 'No delegated run has started in this project.')));
  const grantUsage = new Map();
  for (const run of runs) {
    const used = grantUsage.get(run.grantDigest) || { attempts: 0, elapsedMs: 0 };
    used.attempts += run.counters.providerAttempts;
    used.elapsedMs += run.counters.elapsedMs;
    grantUsage.set(run.grantDigest, used);
  }
  const cards = runs.slice().reverse().map(run => {
    const card = node('article', '', 'autonomy-run');
    card.append(node('h4', `Run ${run.id.slice(0, 8)} · ${run.status}`), node('p', runExplanation(run)));
    if (run.code) card.append(node('p', humanReason(run.code), 'autonomy-reasons'));
    const limits = run.grantDigest === view.status.grant?.digest ? view.status.grant.scope.limits : null;
    const used = grantUsage.get(run.grantDigest);
    if (limits) card.append(node('small', `Attempts ${used.attempts}/${limits.maxAttempts}; runtime ${Math.max(0, Math.ceil((limits.maxRuntimeMs - used.elapsedMs) / 60000))} minutes remaining. Recorded grant-wide usage may be incomplete.`));
    else card.append(node('small', 'Historical grant. Current limits do not describe this run.'));
    card.append(node('small', ` Owner process ${run.lifetime?.ownerProcessAlive ? 'reported alive' : 'not alive or unconfirmed'}.`));
    const actions = node('div', '', 'autonomy-card-actions');
    for (const action of ['pause', 'resume', 'cancel', 'recover']) {
      const available = action === 'pause' ? ['starting', 'running', 'awaiting-human'].includes(run.status)
        : action === 'resume' ? run.status === 'paused' : action === 'cancel' ? !['completed', 'cancelled', 'cancel-requested', 'recovery-required', 'revoked', 'expired', 'blocked'].includes(run.status)
          : run.status === 'recovery-required';
      if (!available) continue;
      const label = action === 'cancel' ? 'Request cancellation' : action === 'recover' ? 'Review recovery' : `${action[0].toUpperCase()}${action.slice(1)} run`;
      const button = node('button', label, action === 'cancel' ? 'secondary-action danger' : 'secondary-action'); button.type = 'button';
      button.disabled = action === 'resume' && view.resuming.has(run.id);
      button.dataset.autonomyFocus = `control:${run.id}:${action}`;
      button.addEventListener('click', () => openControl(run, action, button)); actions.append(button);
    }
    for (const question of run.questions || []) {
      card.append(node('p', questionContext(question), 'autonomy-question-context'));
      const button = node('button', `Record human answer for ${titleFor(question.intentId)}`, 'secondary-action'); button.type = 'button';
      button.dataset.autonomyFocus = `answer:${run.id}:${question.id}`;
      button.addEventListener('click', () => openAnswer(run, question, button)); actions.append(button);
    }
    card.append(actions); return card;
  });
  replacePreservingFocus('autonomyLiveRuns', ...(view.error ? [node('p', view.error, 'autonomy-reasons')] : []), ...cards);
}

export function renderAutonomyIntentDetail(item) {
  if (!host || !item?.intentId) return;
  const panel = node('section', '', 'autonomy-intent-detail');
  panel.append(node('h3', 'Delegated delivery'));
  const candidate = ['executable', 'humanDecisions', 'blocked'].flatMap(key => view.preview?.[key] || []).find(value => value.intentId === item.intentId);
  const inPool = view.status?.grant?.scope?.intentIds.includes(item.intentId);
  panel.append(node('p', view.error || (!view.status ? 'Authority status is unavailable.' : inPool ? 'This intent is in the exact recorded grant.' : 'This intent is outside the recorded grant.')));
  if (candidate) panel.append(node('p', candidate.reasons?.length ? candidate.reasons.map(reason => humanReason(reason.code)).join(' · ') : `Next permitted action: ${humanReason(candidate.action)}.`));
  $('drawerContent').append(panel);
}

function openDialog(id, opener, focusId) {
  const dialog = $(id); dialog._autonomyOpener = opener;
  dialog._autonomyOpenerId = opener?.id || '';
  dialog._autonomyOpenerKey = opener?.dataset.autonomyFocus || '';
  dialog.querySelector('[data-autonomy-error]').textContent = '';
  dialog.showModal(); (focusId ? $(focusId) : dialog.querySelector('button[type="submit"]'))?.focus();
}
function openDispatch(intentId, opener) {
  if (view.status?.status !== 'current' || view.preview?.executable[0]?.intentId !== intentId) return;
  view.runIntentId = intentId;
  view.dispatch = { intentId, grantDigest: view.status.grant.digest, provider: view.status.grant.scope.providers[0] };
  set('autonomyDispatchSummary', `${titleFor(intentId)} is next by recorded priority. ${grantSummary(view.status.grant.scope)}`);
  openDialog('autonomyDispatchDialog', opener, 'autonomyDispatchMode');
}
function openControl(run, action, opener) {
  if (action === 'resume' && view.resuming.has(run.id)) return;
  view.control = { runId: run.id, revision: run.revision, action };
  set('autonomyControlTitle', `${action[0].toUpperCase()}${action.slice(1)} delegated run`);
  set('autonomyControlSummary', `Run ${run.id.slice(0, 8)} at revision ${run.revision}.`);
  set('autonomyControlBoundary', action === 'cancel' ? 'This requests a stop. The process may still be alive until termination is confirmed.'
    : action === 'recover' ? 'Recovery checks what actually happened; it never retries an uncertain operation blindly.'
      : 'EWAI checks current authority, ownership, evidence and limits before changing this run.');
  set('autonomyControlConfirm', action === 'cancel' ? 'Request cancellation' : `Confirm ${action}`);
  openDialog('autonomyControlDialog', opener);
}
function openAnswer(run, question, opener) {
  view.answer = { runId: run.id, questionId: question.id, revision: run.revision };
  set('autonomyAnswerSummary', questionContext(question));
  openDialog('autonomyAnswerDialog', opener, 'autonomyAnswerName');
}
function busy(value) {
  view.busy = value;
  document.querySelectorAll('.autonomy-dialog button[type="submit"]').forEach(button => { button.disabled = value; });
  renderAutonomyConfiguration();
  if (!document.querySelector('.autonomy-dialog[open]')) renderAutonomyDecisions();
}
async function perform(operation) {
  if (view.busy) return;
  view.error = '';
  busy(true);
  try { await operation(); }
  catch (error) {
    view.notice = error?.message === 'Choose at least one exact intent and action, then enter valid expiry and limits.' ? error.message : safeError(error);
    const dialog = document.querySelector('.autonomy-dialog[open]');
    if (dialog) dialog.querySelector('[data-autonomy-error]').textContent = view.notice;
    if (error?.status === 409) await loadAutonomyState();
  }
  finally { busy(false); renderAutonomyConfiguration(); renderAutonomyDecisions(); renderAutonomyLive(); }
}

export async function submitAutonomyControl(action, revision, runId) {
  const result = await mutation('control', { action, runId, expectedRevision: revision, confirmed: true });
  view.notice = result.cancellation?.status === 'unknown' || result.cancellation?.status === 'requested'
    ? 'Cancellation requested; process termination is not yet confirmed.'
    : result.cancellation?.status === 'confirmed' ? 'Process stop confirmed. Captured work is preserved.'
      : `Run ${result.status}. Current evidence has been refreshed.`;
  await loadAutonomyState();
  return result;
}
export async function loadAutonomyState() {
  if (!host) return;
  const revision = ++view.requestRevision;
  view.loading = true; renderAutonomyConfiguration();
  try {
    const status = await host.api('/api/autonomy');
    if (revision !== view.requestRevision) return;
    view.status = status;
    if (!view.draftHydrated && !view.draftTouched && status.grant?.scope?.intentIds) {
      const scope = status.grant.scope;
      view.draftIds = new Set(scope.intentIds);
      view.poolSignature = '';
      for (const button of document.querySelectorAll('[name="autonomyAction"]')) {
        button.setAttribute('aria-checked', String(scope.actions.includes(button.value)));
      }
      if ([...$('autonomyProvider').options].some(option => option.value === scope.providers[0])) {
        $('autonomyProvider').value = scope.providers[0];
      }
      $('autonomyRuntimeMinutes').value = String(Math.round(scope.limits.maxRuntimeMs / 60000));
      $('autonomyOperationSeconds').value = String(Math.round(scope.limits.maxOperationMs / 1000));
      $('autonomyAttempts').value = String(scope.limits.maxAttempts);
      const hours = Math.ceil((Date.parse(scope.expiresAt) - Date.now()) / 3600000);
      $('autonomyExpiryHours').value = String(Math.max(1, Math.min(24, hours)));
    }
    view.draftHydrated = true;
    try {
      const preview = await mutation('preview', {});
      if (revision !== view.requestRevision) return;
      view.preview = preview; view.error = '';
    } catch (error) {
      if (revision !== view.requestRevision) return;
      view.preview = null; view.error = `Eligibility preview unavailable. ${safeError(error)}`;
    }
  } catch (error) {
    if (revision !== view.requestRevision) return;
    view.status = null; view.preview = null; view.error = safeError(error);
  } finally {
    if (revision === view.requestRevision) {
      view.loading = false; renderAutonomyConfiguration();
      if (!document.querySelector('.autonomy-dialog[open]')) { renderAutonomyDecisions(); renderAutonomyLive(); }
    }
  }
}

export function configureAutonomyDashboard(options) {
  host = options;
  $('autonomyPreviewButton').addEventListener('click', () => perform(async () => {
    const proposal = selectedProposal();
    view.draftPreview = await mutation('preview', { proposal, record: false, confirmed: false });
    view.notice = 'Preview only. No grant or provider has started.';
    renderAutonomyConfiguration(); renderAutonomyDecisions();
  }));
  for (const input of document.querySelectorAll('.autonomy-configuration input, .autonomy-configuration select')) {
    input.addEventListener('change', () => { view.draftTouched = true; view.draftPreview = null; renderAutonomyConfiguration(); renderAutonomyDecisions(); });
  }
  for (const button of document.querySelectorAll('[name="autonomyAction"]')) button.addEventListener('click', () => {
    button.setAttribute('aria-checked', String(button.getAttribute('aria-checked') !== 'true'));
    view.draftTouched = true; view.draftPreview = null; renderAutonomyConfiguration(); renderAutonomyDecisions();
  });
  $('autonomyReviewButton').addEventListener('click', event => {
    if (!draftIsApprovable()) return;
    set('autonomyApprovalSummary', grantSummary(view.draftPreview.proposal));
    $('autonomyApprovalDialog')._reviewedPreview = view.draftPreview;
    openDialog('autonomyApprovalDialog', event.currentTarget, 'autonomyApproverName');
  });
  $('autonomyApprovalForm').addEventListener('submit', event => {
    event.preventDefault(); const name = $('autonomyApproverName').value.trim();
    if (!name || !draftIsApprovable()) return;
    perform(async () => {
      const reviewed = $('autonomyApprovalDialog')._reviewedPreview;
      const recorded = await mutation('preview', { proposal: reviewed.proposal, record: true, confirmed: true });
      if (recorded.digest !== reviewed.digest) { view.draftPreview = null; throw staleDecision(); }
      await mutation('approve', { expectedDigest: recorded.digest, approvedBy: name, confirmed: true });
      $('autonomyApprovalDialog').close(); view.draftPreview = null;
      view.notice = 'Grant approved. Current project evidence and gates are checked before work starts.';
      await loadAutonomyState();
    });
  });
  $('autonomyRevokeButton').addEventListener('click', event => {
    $('autonomyRevocationDialog')._expectedDigest = view.status?.grant?.digest;
    openDialog('autonomyRevocationDialog', event.currentTarget, 'autonomyRevokerName');
  });
  $('autonomyRevocationForm').addEventListener('submit', event => {
    event.preventDefault(); const name = $('autonomyRevokerName').value.trim();
    if (!name) return;
    perform(async () => {
      await mutation('revoke', { expectedDigest: $('autonomyRevocationDialog')._expectedDigest, revokedBy: name, confirmed: true });
      $('autonomyRevocationDialog').close(); view.draftPreview = null;
      view.notice = 'Grant revoked. Pending work is preserved; no further dispatch under this grant.';
      await loadAutonomyState();
    });
  });
  $('autonomyDispatchForm').addEventListener('submit', event => {
    event.preventDefault();
    if (view.dispatching || view.busy) return;
    const reviewed = view.dispatch;
    if (!reviewed || view.status?.status !== 'current' || view.status.grant?.digest !== reviewed.grantDigest
      || view.preview?.executable[0]?.intentId !== reviewed.intentId) {
      const message = safeError(staleDecision('autonomy-grant-stale'));
      $('autonomyDispatchDialog').querySelector('[data-autonomy-error]').textContent = message;
      view.notice = message;
      return;
    }
    const mode = $('autonomyDispatchMode').value;
    view.dispatching = true;
    view.notice = 'Dispatch request pending. Live work shows the recorded run as soon as it is available.';
    $('autonomyDispatchDialog').close();
    host.showView('live');
    renderAutonomyDecisions(); renderAutonomyLive();
    (async () => {
      try {
        const result = await mutation(mode, { expectedDigest: reviewed.grantDigest,
          provider: reviewed.provider, confirmed: true });
        view.notice = `Run ${result.status}. Inspect Live work for the actual outcome.`;
        await loadAutonomyState();
      } catch (error) {
        view.notice = safeError(error);
        if (error?.status === 409) await loadAutonomyState();
      } finally {
        view.dispatching = false;
        renderAutonomyConfiguration(); renderAutonomyDecisions(); renderAutonomyLive();
      }
    })();
  });
  $('autonomyControlForm').addEventListener('submit', event => {
    event.preventDefault(); if (!view.control) return;
    if (view.control.action === 'resume') {
      const control = view.control;
      if (view.resuming.has(control.runId) || view.busy) return;
      view.resuming.add(control.runId);
      $('autonomyControlDialog').close();
      view.notice = 'Resume request pending. Live work shows the recorded outcome; cancellation remains available.';
      renderAutonomyLive();
      (async () => {
        try { await submitAutonomyControl(control.action, control.revision, control.runId); }
        catch (error) {
          view.notice = safeError(error);
          if (error?.status === 409) await loadAutonomyState();
        } finally {
          view.resuming.delete(control.runId);
          renderAutonomyConfiguration(); renderAutonomyDecisions(); renderAutonomyLive();
        }
      })();
      return;
    }
    perform(async () => { const control = view.control; await submitAutonomyControl(control.action, control.revision, control.runId); $('autonomyControlDialog').close(); });
  });
  $('autonomyAnswerForm').addEventListener('submit', event => {
    event.preventDefault(); if (!view.answer) return;
    const answeredBy = $('autonomyAnswerName').value.trim(), answer = $('autonomyAnswerText').value;
    if (!answeredBy || !answer.trim()) return;
    perform(async () => {
      await mutation('answer', { runId: view.answer.runId, questionId: view.answer.questionId,
        expectedRevision: view.answer.revision, answeredBy, answer, confirmed: true });
      $('autonomyAnswerText').value = ''; $('autonomyAnswerDialog').close();
      view.notice = 'Answer recorded privately. Human approval remains separate.';
      await loadAutonomyState();
    });
  });
  document.querySelectorAll('[data-autonomy-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  document.querySelectorAll('.autonomy-dialog').forEach(dialog => {
    const error = node('p', '', 'autonomy-dialog-error'); error.dataset.autonomyError = '';
    error.setAttribute('role', 'alert'); dialog.querySelector('.action-body').append(error);
    dialog.addEventListener('close', () => {
      renderAutonomyDecisions(); renderAutonomyLive();
      const opener = dialog._autonomyOpener;
      const replacement = dialog._autonomyOpenerId ? $(dialog._autonomyOpenerId)
        : [...document.querySelectorAll('[data-autonomy-focus]')]
          .find(button => button.dataset.autonomyFocus === dialog._autonomyOpenerKey);
      if (opener?.isConnected && opener.getClientRects().length && !opener.disabled) opener.focus();
      else if (replacement?.getClientRects().length && !replacement.disabled) replacement.focus();
      else ($('liveView').hidden ? $('configurationNav') : $('autonomyLiveTitle')).focus();
    });
  });
  renderAutonomyConfiguration(); renderAutonomyDecisions(); renderAutonomyLive();
}
