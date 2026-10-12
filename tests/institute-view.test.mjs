import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { initProject } from '../src/project.mjs';
import { createIntent, attachPersonaToIntent } from '../src/intents.mjs';
import { beginDelivery } from '../src/delivery.mjs';
import { startActiveSession, addActivityEvent } from '../src/runtime/work.mjs';
import { ensureDashboard, stopDashboard } from '../src/runtime/dashboard.mjs';

const details = { problem: 'Problem.', desiredOutcome: 'Outcome.', users: ['End user'], journeys: ['Use it.'], acceptanceCriteria: ['It works.'], constraints: ['None.'], evidence: [], openDecisions: [] };

test('the Institute opens from the sidebar, reads live records, and returns to the dashboard', { timeout: 90000 }, async (t) => {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'ewai-institute-view-')));
  let browser;
  t.after(async () => {
    await browser?.close();
    await stopDashboard(root);
    rmSync(root, { recursive: true, force: true });
  });
  initProject(root, { name: 'Institute fixture' });
  for (const slug of ['alpha', 'beta', 'gamma', 'delta']) createIntent(root, { slug, domain: 'platform', title: slug, details });
  beginDelivery(root, 'alpha', { tool: 'codex' });
  startActiveSession(root, 'beta', { ownerId: 'claude-session', tool: 'claude', phaseKey: 'build', summary: 'Building beta' });
  startActiveSession(root, 'gamma', { ownerId: 'claude-two', tool: 'claude', phaseKey: 'plan', summary: 'Planning gamma' });
  for (const ref of ['ewai.core.maintainer', 'ewai.core.operator', 'ewai.core.end-user']) await attachPersonaToIntent(root, 'platform/gamma', { ref, role: 'reviewer', depth: 3 });
  addActivityEvent(root, 'gamma', { eventType: 'progress', summary: 'The operator raised a recovery question', personas: ['ewai.core.operator'] });
  startActiveSession(root, 'delta', { ownerId: 'codex-session', tool: 'codex', phaseKey: 'plan', summary: 'Planning delta' });
  addActivityEvent(root, 'delta', { eventType: 'question', summary: 'Needs a decision', question: 'Which option?', requiresHuman: true });

  const started = await ensureDashboard(root, { home: resolve(root, 'isolated-home'), premiumCheck: Promise.resolve({ access: 'unavailable', installed: false, verified: false, accessReason: 'licence-not-configured' }) });
  assert.equal(started.status, 'running');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const problems = [], requests = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) problems.push(message.text()); });
  const unrelated = new Set(['/api/jev/credentials', '/api/openai/credentials', '/api/coding-providers/grok/credentials']);
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (response.status() >= 400 && !unrelated.has(path)) problems.push(`${response.status()} ${path}`);
  });
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));

  await page.goto(started.url);
  await page.locator('#dashboardSidebar').waitFor();
  assert.equal(await page.locator('#instituteView').isHidden(), true, 'the dashboard is shown first');
  assert.ok(!requests.includes('/api/institute-scene'), 'nothing is fetched until the Institute is opened');

  await page.locator('#instituteOpen').click();
  await page.waitForFunction(() => document.querySelectorAll('#instIntents .row').length === 4);
  assert.equal(await page.locator('#instituteView').isVisible(), true);

  assert.equal(await page.locator('#instIntents .row').count(), 4);
  assert.equal(await page.locator('#instKFlight').textContent(), '4');
  assert.equal(await page.locator('#instKWaiting').textContent(), '1');
  assert.equal(await page.locator('#instOverlay .plaque').count(), 9);
  assert.match(await page.locator('#instStatus').textContent(), /^Live/);
  const painted = await page.locator('#instCanvas').evaluate((canvas) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4000) if (data[i] || data[i + 1] || data[i + 2]) lit++;
    return lit;
  });
  assert.ok(painted > 100, 'the scene is drawn');
  assert.match(await page.locator('#instAgents').textContent(), /Codex/);
  assert.match(await page.locator('#instAgents').textContent(), /Claude/);

  const scene = await page.evaluate(() => fetch('/api/institute-scene').then((r) => r.json()));
  const gamma = scene.intents.find((i) => i.slug === 'gamma');
  assert.equal(gamma.personas.length, 3, 'every attached persona is in the scene');
  assert.deepEqual(gamma.speaking.map((p) => p.ref), ['ewai.core.operator']);
  const delta = scene.intents.find((i) => i.slug === 'delta');
  assert.equal(delta.roomId, 'gate');
  assert.ok(Date.parse(delta.waitingSince) <= Date.now(), 'waiting time is recorded from the question');
  assert.match(await page.locator('#instIntents .row', { hasText: 'delta' }).textContent(), /Waiting/);

  await page.locator('#instStrip [data-room="build"]').click();
  await page.locator('#instRoomPanel.on').waitFor();
  assert.match(await page.locator('#instRoomPanel').textContent(), /beta/);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('instRoomPanel').classList.contains('on'));

  await page.locator('#instIntents .row', { hasText: 'beta' }).click();
  assert.match(await page.locator('#instInspector').textContent(), /beta/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#instituteView').isVisible(), true, 'Esc first clears the selection');
  await page.keyboard.press('Escape');
  await page.locator('#instituteView').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#boardView').isVisible(), true, 'Esc at the top level returns to the dashboard');

  await page.locator('#instituteOpen').click();
  await page.waitForFunction(() => document.querySelectorAll('#instIntents .row').length === 4);
  await page.locator('#instBack').click();
  await page.locator('#instituteView').waitFor({ state: 'hidden' });

  await page.locator('#instituteOpen').click();
  await page.locator('#instIntents .row', { hasText: 'beta' }).click();
  await page.locator('#instInspector [data-act="open"]').click();
  await page.locator('#instituteView').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#boardView').isVisible(), true);

  assert.match(await page.locator('#boardView .working-now.waiting').first().textContent(), /codex · waiting/);
  await page.locator('[data-view="live"]').click();
  assert.match(await page.locator('#liveView .human-question').first().textContent(), /Waiting for you for/);

  assert.deepEqual(problems, []);
});
