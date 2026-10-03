import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { initProject } from '../src/project.mjs';
import { createIntent, updateIntentDeliveryState } from '../src/intents.mjs';
import { ensureDashboard, stopDashboard } from '../src/runtime/dashboard.mjs';
import { readAutonomyPolicy } from '../src/autonomy.mjs';

function git(root, ...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
async function browserFixture(t, title = 'Invoice export') {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'ewai-autonomy-dashboard-')));
  initProject(root, { name: 'Autonomy dashboard consumer', specsRoot: 'knowledge' });
  const intent = createIntent(root, { domain: 'product', slug: 'invoice-export', title });
  updateIntentDeliveryState(root, intent.path, { status: 'ready' });
  git(root, 'init', '-b', 'fixture'); git(root, 'config', 'user.name', 'Fixture'); git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'add', '-A'); git(root, 'commit', '-m', 'fixture state');
  let browser;
  t.after(async () => { await browser?.close(); await stopDashboard(root); rmSync(root, { recursive: true, force: true }); });
  const dashboard = await ensureDashboard(root);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(dashboard.url);
  await page.locator('#configurationNav:enabled').waitFor();
  return { root, page, url: dashboard.url };
}

test('revoked authority disables dispatch and shows preserved pending work', { timeout: 90000 }, async t => {
  const { root, page } = await browserFixture(t);
  await page.locator('#configurationNav').click();
  await page.getByRole('heading', { name: 'Delegated delivery' }).waitFor({ timeout: 5000 });
  assert.equal(readAutonomyPolicy(root).mode, 'off');
  await page.getByRole('checkbox', { name: 'Invoice export' }).click();
  await page.getByRole('button', { name: 'Preview selected work' }).click();
  try { await page.waitForFunction(() => !document.getElementById('autonomyReviewButton').disabled, null, { timeout: 6000 }); }
  catch (error) {
    t.diagnostic(JSON.stringify(await page.evaluate(() => ({ status: document.getElementById('autonomyConfigurationStatus').textContent,
      summary: document.getElementById('autonomyProposalSummary').textContent,
      checked: document.querySelector('#autonomyPool [role="checkbox"]')?.getAttribute('aria-checked') }))));
    throw error;
  }
  await page.getByRole('button', { name: 'Review and approve grant' }).click();
  const approval = page.locator('#autonomyApprovalDialog');
  assert.equal(await approval.evaluate(element => element.open), true);
  await approval.getByLabel('Your name').fill('Fixture owner');
  await approval.getByRole('button', { name: 'Approve this scope' }).click();
  await page.getByText('Delegated within your grant', { exact: true }).waitFor();
  assert.equal(readAutonomyPolicy(root).mode, 'delegated');
  await page.reload();
  await page.locator('#configurationNav:enabled').click();
  await page.waitForFunction(() => document.querySelector('#autonomyPool [role="checkbox"]')?.getAttribute('aria-checked') === 'true');
  assert.equal(await page.getByRole('checkbox', { name: 'Invoice export' }).getAttribute('aria-checked'), 'true');
  // Canonical grant evidence is committed before a real dispatch preflight.
  git(root, 'add', '-A'); git(root, 'commit', '-m', 'approved grant evidence');
  await page.locator('#refresh').click();

  await page.locator('[data-view="companion"]').first().click();
  const dispatch = page.getByRole('button', { name: 'Run next action' });
  await dispatch.waitFor();
  assert.equal(await dispatch.isEnabled(), true);

  await page.locator('#configurationNav').click();
  await page.getByRole('button', { name: 'Revoke grant' }).click();
  const revocation = page.locator('#autonomyRevocationDialog');
  assert.equal(await revocation.evaluate(element => element.open), true);
  await revocation.getByLabel('Your name').fill('Fixture owner');
  await revocation.getByRole('button', { name: 'Confirm revocation' }).click();
  await page.locator('#autonomyMode').getByText('Grant revoked', { exact: true }).waitFor();
  assert.equal(readAutonomyPolicy(root).status, 'revoked');

  await page.locator('[data-view="companion"]').first().click();
  await page.locator('#autonomyBlocked').getByText('Invoice export', { exact: true }).waitFor();
  assert.equal(await dispatch.isEnabled(), false);
  assert.equal(await page.getByText('Grant revoked', { exact: true }).count() > 0, true);
});

test('390px keyboard grant review restores focus and treats a stored title as text', { timeout: 90000 }, async t => {
  const hostileTitle = '<img src=x onerror=window.__autonomyXss=true> Invoice export';
  const { page } = await browserFixture(t, hostileTitle);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#sidebarOpen').click();
  await page.locator('#configurationNav').click();
  const choice = page.locator('#autonomyPool [role="checkbox"]').first();
  await choice.focus(); await page.keyboard.press('Space');
  assert.equal(await choice.getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('#autonomyPool img').count(), 0);
  assert.equal(await page.locator('#autonomyPool').getByText(hostileTitle, { exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => window.__autonomyXss), undefined);
  assert.equal(await page.locator('.autonomy-configuration').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
  const preview = page.locator('#autonomyPreviewButton');
  await preview.focus(); await page.keyboard.press('Enter');
  const review = page.locator('#autonomyReviewButton');
  try { await page.waitForFunction(() => !document.getElementById('autonomyReviewButton').disabled, null, { timeout: 6000 }); }
  catch (error) {
    t.diagnostic(JSON.stringify(await page.evaluate(() => ({ status: document.getElementById('autonomyConfigurationStatus').textContent,
      summary: document.getElementById('autonomyProposalSummary').textContent,
      focused: document.activeElement.id,
      checked: document.querySelector('#autonomyPool [role="checkbox"]')?.getAttribute('aria-checked') }))));
    throw error;
  }
  await review.focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#autonomyApprovalDialog').evaluate(element => element.open), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'autonomyApproverName');
  assert.equal(await page.locator('#autonomyApprovalDialog .close-button').evaluate(element => element.getBoundingClientRect().width >= 44), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#autonomyApprovalDialog').evaluate(element => element.open), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'autonomyReviewButton');
  assert.equal(await page.locator('#autonomyReviewButton').evaluate(element => getComputedStyle(element).outlineStyle !== 'none'), true);
  const response = await page.request.get(page.url());
  assert.match(response.headers()['content-security-policy'] || '', /script-src 'self'/);
  assert.equal(await page.locator('[data-view="autonomy"]').count(), 0);
});

test('stale named revocation stays in its dialog with a safe error and refreshed authority', { timeout: 90000 }, async t => {
  const { root, page } = await browserFixture(t);
  await page.locator('#configurationNav').click();
  await page.getByRole('checkbox', { name: 'Invoice export' }).click();
  await page.locator('#autonomyPreviewButton').click();
  await page.waitForFunction(() => !document.getElementById('autonomyReviewButton').disabled);
  await page.locator('#autonomyReviewButton').click();
  await page.locator('#autonomyApproverName').fill('Fixture owner');
  await page.getByRole('button', { name: 'Approve this scope' }).click();
  await page.getByText('Delegated within your grant', { exact: true }).waitFor();
  await page.locator('#autonomyRevokeButton').click();
  await page.locator('#autonomyRevokerName').fill('Fixture owner');
  const serverResult = await page.evaluate(async () => {
    const policy = await (await fetch('/api/autonomy')).json();
    const response = await fetch('/api/autonomy/revoke', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedDigest: policy.grant.digest, revokedBy: 'Concurrent owner', confirmed: true })
    });
    return response.status;
  });
  assert.equal(serverResult, 200);
  await page.locator('#autonomyRevocationDialog button[type="submit"]').click();
  await page.locator('#autonomyRevocationDialog [role="alert"]').getByText(/revoked|changed/i).waitFor();
  assert.equal(await page.locator('#autonomyRevocationDialog').evaluate(element => element.open), true);
  assert.equal(readAutonomyPolicy(root).status, 'revoked');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement.id === 'configurationNav');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'configurationNav');
});

test('partial service projection preserves run truth without offering dispatch', { timeout: 90000 }, async t => {
  const { page } = await browserFixture(t);
  const run = (id, status, cancellation) => ({ id, revision: 3, status, grantDigest: 'sha256:' + 'a'.repeat(64),
    counters: { providerAttempts: 1, elapsedMs: 1000 }, cancellation,
    lifetime: { ownerProcessAlive: false }, questions: [] });
  const runs = [
    { ...run('44444444-4444-4444-8444-444444444444', 'running', null), lifetime: { ownerProcessAlive: true } },
    run('11111111-1111-4111-8111-111111111111', 'cancel-requested', { status: 'requested' }),
    run('22222222-2222-4222-8222-222222222222', 'cancelled', { status: 'confirmed' }),
    run('33333333-3333-4333-8333-333333333333', 'recovery-required', { status: 'unknown' }),
    { ...run('55555555-5555-4555-8555-555555555555', 'blocked', null), code: 'autonomy-provider-unavailable' }
  ];
  const base = await (await page.request.get(new URL('/api/autonomy', page.url()).toString())).json();
  await page.route('**/api/autonomy', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ ...base, runs }) }));
  await page.route('**/api/autonomy/preview', route => route.fulfill({ status: 503, contentType: 'application/json',
    body: JSON.stringify({ code: 'autonomy-preview-unavailable' }) }));
  await page.locator('[data-view="live"]').first().click();
  await page.locator('#autonomyLiveRuns').getByText(/Cancellation requested\. Process termination is not yet confirmed/).waitFor();
  assert.equal(await page.locator('#autonomyLiveRuns').getByText(/Process stop confirmed/).count(), 1);
  assert.equal(await page.locator('#autonomyLiveRuns').getByText(/Outcome uncertain/).count(), 1);
  assert.equal(await page.locator('#autonomyLiveRuns').getByText(/Eligibility preview unavailable/).count(), 1);
  assert.equal(await page.locator('#autonomyLiveRuns').getByText(/provider unavailable/i).count() > 0, true);
  assert.equal(await page.locator('#autonomyLiveRuns').getByRole('button', { name: 'Request cancellation' }).count(), 1);
  await page.locator('#autonomyLiveRuns').getByRole('button', { name: 'Review recovery' }).click();
  assert.equal(await page.locator('#autonomyControlDialog').evaluate(element => element.open), true);
  await page.locator('#autonomyControlDialog').getByText(/never retries an uncertain operation blindly/).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.dataset.autonomyFocus === 'control:33333333-3333-4333-8333-333333333333:recover');
  await page.waitForTimeout(5200);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.autonomyFocus), 'control:33333333-3333-4333-8333-333333333333:recover');
  await page.locator('[data-view="companion"]').first().click();
  await page.locator('#autonomyCompanionStatus').getByText(/Eligibility preview unavailable/).waitFor();
  assert.equal(await page.locator('#autonomyCanProgress').getByRole('button', { name: 'Run next action' }).isEnabled(), false);
  await page.locator('#configurationNav').click();
  assert.equal(await page.locator('#autonomyMode').textContent(), 'Autonomy off');
});

test('Live work reports grant-wide budget and names the exact human question', { timeout: 90000 }, async t => {
  const { page } = await browserFixture(t);
  const original = await (await page.request.get(new URL('/api/autonomy', page.url()).toString())).json();
  const grantDigest = 'sha256:' + 'b'.repeat(64);
  const scope = { intentIds: ['product/invoice-export'], actions: ['begin-harness'], providers: ['codex'],
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    limits: { maxConcurrentIntents: 1, maxRuntimeMs: 1800000, maxOperationMs: 900000, maxAttempts: 3 } };
  const question = { id: 'c'.repeat(64), intentId: 'product/invoice-export', phase: 'plan', owner: 'Fixture owner',
    sourceRevision: 'sha256:' + 'd'.repeat(64), codes: ['build-approval-required'], authority: 'none' };
  let runs = [
    { id: '66666666-6666-4666-8666-666666666666', revision: 2, status: 'cancelled', grantDigest,
      counters: { providerAttempts: 1, elapsedMs: 600000 }, cancellation: { status: 'confirmed' }, lifetime: { ownerProcessAlive: false }, questions: [] },
    { id: '77777777-7777-4777-8777-777777777777', revision: 3, status: 'awaiting-human', grantDigest,
      counters: { providerAttempts: 1, elapsedMs: 600000 }, cancellation: null, lifetime: { ownerProcessAlive: true }, questions: [question] }
  ];
  await page.route('**/api/autonomy', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ ...original, mode: 'delegated', status: 'current', grant: { digest: grantDigest, scope }, runs }) }));
  await page.locator('[data-view="live"]').first().click();
  await page.locator('#autonomyLiveRuns').getByText(/Attempts 2\/3; runtime 10 minutes remaining/).first().waitFor();
  await page.locator('#autonomyLiveRuns').getByText(/Invoice export.*plan.*Fixture owner.*Build approval needed/i).waitFor();
  await page.locator('#autonomyLiveRuns').getByRole('button', { name: /Record human answer.*Invoice export/ }).click();
  await page.locator('#autonomyAnswerDialog').getByText(/Invoice export.*plan.*Fixture owner.*Build approval needed/i).waitFor();
  let recordedAnswer;
  await page.route('**/api/autonomy/answer', route => {
    recordedAnswer = JSON.parse(route.request().postData());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'recorded', approvalRecorded: false }) });
  });
  await page.locator('#autonomyAnswerName').fill('Fixture owner');
  await page.locator('#autonomyAnswerText').fill('Please review this separately.');
  await page.locator('#autonomyAnswerDialog button[type="submit"]').click();
  await page.waitForFunction(() => !document.getElementById('autonomyAnswerDialog').open);
  assert.deepEqual(recordedAnswer, { runId: runs[1].id, questionId: question.id, expectedRevision: 3,
    answeredBy: 'Fixture owner', answer: 'Please review this separately.', confirmed: true });
  assert.equal(JSON.stringify(await (await page.request.get(new URL('/api/autonomy', page.url()).toString())).json()).includes('Please review this separately.'), false);
  let recordedControl;
  await page.route('**/api/autonomy/control', route => {
    recordedControl = JSON.parse(route.request().postData());
    runs = runs.map(run => run.id === recordedControl.runId ? { ...run, status: 'cancel-requested', cancellation: { status: 'requested' } } : run);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'cancel-requested', cancellation: { status: 'requested' } }) });
  });
  await page.locator('#autonomyLiveRuns').getByRole('button', { name: 'Request cancellation' }).click();
  await page.locator('#autonomyControlDialog button[type="submit"]').click();
  await page.locator('#autonomyLiveRuns').getByText(/Cancellation requested\. Process termination is not yet confirmed/).waitFor();
  assert.deepEqual(recordedControl, { runId: runs[1].id, action: 'cancel', expectedRevision: 3, confirmed: true });
});

test('named approval rejects project evidence changed after the displayed preview', { timeout: 90000 }, async t => {
  const { root, page } = await browserFixture(t);
  await page.locator('#configurationNav').click();
  await page.getByRole('checkbox', { name: 'Invoice export' }).click();
  await page.locator('#autonomyPreviewButton').click();
  await page.waitForFunction(() => !document.getElementById('autonomyReviewButton').disabled);
  await page.locator('#autonomyReviewButton').click();
  appendFileSync(resolve(root, 'knowledge/pipeline.yaml'), '\n# Evidence changed after review\n');
  await page.locator('#autonomyApproverName').fill('Fixture owner');
  await page.locator('#autonomyApprovalDialog button[type="submit"]').click();
  await page.locator('#autonomyApprovalDialog [role="alert"]').getByText(/changed|fresh review/i).waitFor();
  assert.equal(await page.locator('#autonomyApprovalDialog').evaluate(element => element.open), true);
  assert.equal(readAutonomyPolicy(root).mode, 'off');
});

test('dispatch rejects a grant replacement after its dialog was reviewed', { timeout: 90000 }, async t => {
  const { root, page } = await browserFixture(t);
  await page.locator('#configurationNav').click();
  await page.getByRole('checkbox', { name: 'Invoice export' }).click();
  await page.locator('#autonomyPreviewButton').click();
  await page.waitForFunction(() => !document.getElementById('autonomyReviewButton').disabled);
  await page.locator('#autonomyReviewButton').click();
  await page.locator('#autonomyApproverName').fill('Fixture owner');
  await page.locator('#autonomyApprovalDialog button[type="submit"]').click();
  await page.getByText('Delegated within your grant', { exact: true }).waitFor();
  git(root, 'add', '-A'); git(root, 'commit', '-m', 'initial grant');
  await page.locator('[data-view="companion"]').first().click();
  await page.locator('#autonomyCanProgress').getByRole('button', { name: 'Run next action' }).click();
  const shown = await page.locator('#autonomyDispatchSummary').textContent();
  assert.match(shown, /codex/i);
  const replaced = await page.evaluate(async () => {
    const policy = await (await fetch('/api/autonomy')).json();
    const proposal = { ...policy.grant.scope, providers: ['claude'] };
    const preview = await (await fetch('/api/autonomy/preview', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proposal, record: true, confirmed: true }) })).json();
    const response = await fetch('/api/autonomy/approve', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedDigest: preview.digest, approvedBy: 'Concurrent owner', confirmed: true }) });
    return response.status;
  });
  assert.equal(replaced, 200);
  await page.waitForFunction(() => document.getElementById('autonomyProposalSummary').textContent.includes('claude'));
  let dispatched = 0;
  await page.route('**/api/autonomy/run', route => { dispatched++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'starting' }) }); });
  await page.locator('#autonomyDispatchDialog button[type="submit"]').click();
  await page.locator('#autonomyDispatchDialog [role="alert"]').getByText(/changed|fresh review/i).waitFor();
  assert.equal(dispatched, 0);
  assert.equal(await page.locator('#autonomyDispatchDialog').evaluate(element => element.open), true);
});

test('real dashboard starts exactly one bounded harness action without a provider attempt', { timeout: 90000 }, async t => {
  const { root, page } = await browserFixture(t);
  await page.locator('#configurationNav').click();
  await page.getByRole('checkbox', { name: 'Invoice export' }).click();
  await page.locator('#autonomyPreviewButton').click();
  await page.waitForFunction(() => !document.getElementById('autonomyReviewButton').disabled);
  await page.locator('#autonomyReviewButton').click();
  await page.locator('#autonomyApproverName').fill('Fixture owner');
  await page.locator('#autonomyApprovalDialog button[type="submit"]').click();
  await page.getByText('Delegated within your grant', { exact: true }).waitFor();
  git(root, 'add', '-A'); git(root, 'commit', '-m', 'approved grant');
  await page.locator('[data-view="companion"]').first().click();
  await page.locator('#autonomyCanProgress').getByRole('button', { name: 'Run next action' }).click();
  await page.locator('#autonomyDispatchDialog button[type="submit"]').click();
  await page.locator('#autonomyLiveRuns .autonomy-run').first().waitFor();
  const statusUrl = new URL('/api/autonomy', page.url()).toString();
  const before = await (await page.request.get(statusUrl)).json();
  assert.equal(before.runs.length, 1);
  assert.equal(before.runs[0].counters.actions, 1);
  assert.equal(before.runs[0].counters.providerAttempts, 0);
  assert.equal(before.runs[0].status, 'completed');
  await page.locator('#autonomyLiveRuns').getByText(/Bounded action completed/).waitFor();
  assert.equal(await page.locator('#autonomyLiveRuns').getByRole('button', { name: 'Request cancellation' }).count(), 0);
});

test('a fresh load distinguishes the saved non-default grant from its editable draft', { timeout: 90000 }, async t => {
  const { page } = await browserFixture(t);
  await page.locator('#configurationNav').click();
  await page.getByRole('checkbox', { name: 'Invoice export' }).click();
  await page.locator('[name="autonomyAction"][value="begin-harness"]').click();
  await page.locator('[name="autonomyAction"][value="prepare-phase"]').click();
  await page.locator('#autonomyProvider').selectOption('claude');
  await page.locator('#autonomyRuntimeMinutes').fill('45');
  await page.locator('#autonomyOperationSeconds').fill('600');
  await page.locator('#autonomyAttempts').fill('4');
  await page.locator('#autonomyPreviewButton').click();
  await page.waitForFunction(() => !document.getElementById('autonomyReviewButton').disabled);
  await page.locator('#autonomyReviewButton').click();
  await page.locator('#autonomyApproverName').fill('Fixture owner');
  await page.locator('#autonomyApprovalDialog button[type="submit"]').click();
  await page.getByText('Delegated within your grant', { exact: true }).waitFor();
  await page.reload();
  await page.locator('#configurationNav:enabled').click();
  await page.waitForFunction(() => document.querySelector('#autonomyPool [role="checkbox"]')?.getAttribute('aria-checked') === 'true');
  assert.equal(await page.locator('#autonomyProvider').inputValue(), 'claude');
  assert.equal(await page.locator('#autonomyRuntimeMinutes').inputValue(), '45');
  assert.equal(await page.locator('#autonomyOperationSeconds').inputValue(), '600');
  assert.equal(await page.locator('#autonomyAttempts').inputValue(), '4');
  assert.equal(await page.locator('[name="autonomyAction"][value="begin-harness"]').getAttribute('aria-checked'), 'false');
  assert.equal(await page.locator('[name="autonomyAction"][value="prepare-phase"]').getAttribute('aria-checked'), 'true');
  assert.match(await page.locator('#autonomyProposalSummary').textContent(), /Current approved grant.*claude.*45 minute run/i);
});

test('a successful control retains a failed eligibility refresh warning', { timeout: 90000 }, async t => {
  const { page } = await browserFixture(t);
  const original = await (await page.request.get(new URL('/api/autonomy', page.url()).toString())).json();
  const run = { id: '88888888-8888-4888-8888-888888888888', revision: 2, status: 'running',
    grantDigest: 'sha256:' + 'f'.repeat(64), counters: { providerAttempts: 0, elapsedMs: 0 },
    cancellation: null, lifetime: { ownerProcessAlive: true }, questions: [] };
  await page.route('**/api/autonomy', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ ...original, runs: [run] }) }));
  let failPreview = false;
  await page.route('**/api/autonomy/preview', route => failPreview
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'autonomy-preview-unavailable' }) })
    : route.continue());
  await page.route('**/api/autonomy/control', route => {
    failPreview = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'paused' }) });
  });
  await page.locator('[data-view="live"]').first().click();
  await page.locator('#autonomyLiveRuns').getByRole('button', { name: 'Pause run' }).click();
  await page.locator('#autonomyControlDialog button[type="submit"]').click();
  await page.waitForFunction(() => !document.getElementById('autonomyControlDialog').open);
  await page.waitForTimeout(250);
  assert.match(await page.locator('#autonomyLiveRuns').textContent(), /Eligibility preview unavailable/);
  assert.match(await page.locator('#autonomyConfigurationStatus').textContent(), /Eligibility preview unavailable/);
});

test('cancellation stays available while a dispatch response is pending', { timeout: 90000 }, async t => {
  const { root, page } = await browserFixture(t);
  await page.locator('#configurationNav').click();
  await page.getByRole('checkbox', { name: 'Invoice export' }).click();
  await page.locator('#autonomyPreviewButton').click();
  await page.waitForFunction(() => !document.getElementById('autonomyReviewButton').disabled);
  await page.locator('#autonomyReviewButton').click();
  await page.locator('#autonomyApproverName').fill('Fixture owner');
  await page.locator('#autonomyApprovalDialog button[type="submit"]').click();
  await page.getByText('Delegated within your grant', { exact: true }).waitFor();
  git(root, 'add', '-A'); git(root, 'commit', '-m', 'approved grant');
  const original = await (await page.request.get(new URL('/api/autonomy', page.url()).toString())).json();
  const run = { id: '99999999-9999-4999-8999-999999999999', revision: 1, status: 'running',
    grantDigest: original.grant.digest, counters: { providerAttempts: 0, elapsedMs: 0 },
    cancellation: null, lifetime: { ownerProcessAlive: true }, questions: [] };
  let releaseRun;
  const held = new Promise(resolve => { releaseRun = resolve; });
  t.after(() => releaseRun());
  let receivedRun;
  const runReceived = new Promise(resolve => { receivedRun = resolve; });
  let pending = false, controlBody;
  await page.route('**/api/autonomy/run', async route => {
    pending = true; receivedRun(); await held;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'cancel-requested' }) });
  });
  await page.route('**/api/autonomy', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ ...original, runs: pending ? [run] : [] }) }));
  await page.route('**/api/autonomy/control', route => {
    controlBody = JSON.parse(route.request().postData());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'cancel-requested', cancellation: { status: 'requested' } }) });
  });
  await page.locator('[data-view="companion"]').first().click();
  await page.locator('#autonomyCanProgress').getByRole('button', { name: 'Run next action' }).click();
  await page.locator('#autonomyDispatchDialog button[type="submit"]').click();
  await runReceived;
  if (await page.locator('#autonomyDispatchDialog').evaluate(element => element.open)) await page.keyboard.press('Escape');
  await page.locator('[data-view="live"]').first().click();
  await page.locator('#autonomyLiveRuns').getByRole('button', { name: 'Request cancellation' }).click();
  assert.equal(await page.locator('#autonomyControlDialog button[type="submit"]').isEnabled(), true);
  await page.locator('#autonomyControlDialog button[type="submit"]').click();
  await page.waitForFunction(() => document.getElementById('autonomyControlDialog').open === false);
  assert.deepEqual(controlBody, { runId: run.id, action: 'cancel', expectedRevision: 1, confirmed: true });
  releaseRun();
});

test('a paused once-mode resume can be cancelled before its response returns', { timeout: 90000 }, async t => {
  const { page } = await browserFixture(t);
  const original = await (await page.request.get(new URL('/api/autonomy', page.url()).toString())).json();
  const run = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 4, mode: 'once', status: 'paused',
    grantDigest: 'sha256:' + 'a'.repeat(64), counters: { providerAttempts: 0, elapsedMs: 0 },
    cancellation: null, lifetime: { ownerProcessAlive: false }, questions: [] };
  let releaseResume;
  const held = new Promise(resolve => { releaseResume = resolve; });
  t.after(() => releaseResume());
  let receivedResume;
  const resumeReceived = new Promise(resolve => { receivedResume = resolve; });
  let resumed = false, cancelBody;
  await page.route('**/api/autonomy', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ ...original, runs: [{ ...run, status: resumed ? 'running' : 'paused' }] }) }));
  await page.route('**/api/autonomy/control', async route => {
    const body = JSON.parse(route.request().postData());
    if (body.action === 'resume') {
      resumed = true; receivedResume(); await held;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'cancel-requested' }) });
    }
    cancelBody = body;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'cancel-requested', cancellation: { status: 'requested' } }) });
  });
  await page.locator('[data-view="live"]').first().click();
  await page.locator('#autonomyLiveRuns').getByRole('button', { name: 'Resume run' }).click();
  await page.locator('#autonomyControlDialog button[type="submit"]').click();
  await resumeReceived;
  if (await page.locator('#autonomyControlDialog').evaluate(element => element.open)) await page.keyboard.press('Escape');
  await page.locator('#refresh').click();
  await page.locator('#autonomyLiveRuns').getByRole('button', { name: 'Request cancellation' }).click();
  assert.equal(await page.locator('#autonomyControlDialog button[type="submit"]').isEnabled(), true);
  await page.locator('#autonomyControlDialog button[type="submit"]').click();
  await page.waitForFunction(() => !document.getElementById('autonomyControlDialog').open);
  assert.deepEqual(cancelBody, { runId: run.id, action: 'cancel', expectedRevision: 4, confirmed: true });
  releaseResume();
});

test('a rejected dispatch is announced in Live work without inventing a run', { timeout: 90000 }, async t => {
  const { root, page } = await browserFixture(t);
  await page.locator('#configurationNav').click();
  await page.getByRole('checkbox', { name: 'Invoice export' }).click();
  await page.locator('#autonomyPreviewButton').click();
  await page.waitForFunction(() => !document.getElementById('autonomyReviewButton').disabled);
  await page.locator('#autonomyReviewButton').click();
  await page.locator('#autonomyApproverName').fill('Fixture owner');
  await page.locator('#autonomyApprovalDialog button[type="submit"]').click();
  await page.getByText('Delegated within your grant', { exact: true }).waitFor();
  git(root, 'add', '-A'); git(root, 'commit', '-m', 'approved grant');
  await page.route('**/api/autonomy/run', route => route.fulfill({ status: 409, contentType: 'application/json',
    body: JSON.stringify({ code: 'autonomy-repository-dirty' }) }));
  await page.locator('[data-view="companion"]').first().click();
  await page.locator('#autonomyCanProgress').getByRole('button', { name: 'Run next action' }).click();
  await page.locator('#autonomyDispatchDialog button[type="submit"]').click();
  await page.locator('#autonomyLiveStatus').getByText(/repository has uncommitted work/i).waitFor();
  assert.equal(await page.locator('#liveView').evaluate(element => element.hidden), false);
  assert.equal(await page.locator('#autonomyLiveRuns .autonomy-run').count(), 0);
  assert.equal(await page.locator('#autonomyLiveRuns').getByText(/Process stop confirmed/).count(), 0);
});
