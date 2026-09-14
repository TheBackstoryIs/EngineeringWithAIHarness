import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { initProject } from '../src/project.mjs';
import {readDashboardPreferences,saveDashboardPreferences} from '../src/dashboard-preferences.mjs';
import { buildTeamHubResourcePackage } from '../src/team-hub-resources.mjs';
import {
  ingestTeamHubEnvelope,
  openTeamHubDatabase,
  publishTeamHubResource,
} from '../src/runtime/team-hub-database.mjs';
import { createTeamHubHttpServer } from '../src/runtime/team-hub-server.mjs';
import { connectTeamHub } from '../src/runtime/team-hub-client.mjs';
import { ensureDashboard, stopDashboard } from '../src/runtime/dashboard.mjs';
import { organisationPack, teamHubEnvelope } from './helpers/team-hub-operational-fixtures.mjs';

const readerToken = 'browser-reader-token-with-enough-entropy';
const publisherToken = 'browser-publisher-token-with-enough-entropy';

async function browserInstance() {
  return chromium.launch({ headless: true });
}

test('central Team Hub is operable with session-only authentication, keyboard and a narrow viewport', async () => {
  const dataRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-browser-central-'));
  const sourceRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-browser-pack-'));
  const database = openTeamHubDatabase(dataRoot);
  const resourcePackage = buildTeamHubResourcePackage(organisationPack(sourceRoot));
  ingestTeamHubEnvelope(database, teamHubEnvelope('browser-project', 'Browser Project', '2026-08-20T09:00:00.000Z'), {
    receiptId: 'browser-receipt',
    at: '2026-08-20T09:01:00.000Z',
  });
  publishTeamHubResource(database, resourcePackage, { receiptId: 'browser-publication', at: '2026-08-20T09:02:00.000Z' });
  database.close();
  const hub = await createTeamHubHttpServer({ dataRoot, token: readerToken, publisherToken, host: '127.0.0.1', port: 0 });
  const browser = await browserInstance();
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await page.goto(hub.url);
    await assert.doesNotReject(page.getByRole('heading', { name: 'Connected portfolio' }).waitFor());

    await page.getByLabel('Team Hub token').fill('wrong-token-with-enough-length');
    await page.getByRole('button', { name: 'Load portfolio' }).click();
    await assert.doesNotReject(page.getByRole('status').filter({ hasText: /authentication is required/i }).waitFor());
    assert.equal(await page.evaluate(() => sessionStorage.getItem('ewai.team-hub.token')), null);

    await page.getByLabel('Team Hub token').focus();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'hubToken');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Load portfolio');

    await page.getByLabel('Team Hub token').fill(readerToken);
    await page.getByRole('button', { name: 'Load portfolio' }).click();
    await assert.doesNotReject(page.getByRole('heading', { name: 'Browser Project' }).waitFor());
    await assert.doesNotReject(page.getByRole('heading', { name: 'Acme delivery' }).waitFor());
    assert.match(await page.getByRole('button', { name: /Browser Project/ }).innerText(), /stale/i);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('ewai.team-hub.token')), readerToken);
    assert.equal(await page.evaluate(() => localStorage.getItem('ewai.team-hub.token')), null);
    assert.equal(await page.locator('[aria-label="Authority boundary"]').isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

    const emptyPage = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await emptyPage.route('**/api/v1/portfolio', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ schema: 'ewai.team-hub-portfolio/v1', generatedAt: '2026-08-31T09:00:00.000Z', staleAfterHours: 72, projects: [], summary: { total: 0, current: 0, stale: 0, attention: 0 }, authority: { canApprove: false, notice: 'Read only.' } }),
    }));
    await emptyPage.route('**/api/v1/resources', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ schema: 'ewai.team-hub-resource-catalogue/v1', releases: [], authority: 'Discovery only.' }),
    }));
    await emptyPage.goto(hub.url);
    await emptyPage.getByLabel('Team Hub token').fill(readerToken);
    await emptyPage.getByRole('button', { name: 'Load portfolio' }).click();
    await assert.doesNotReject(emptyPage.getByText('No governed releases have been published.').waitFor());
    assert.equal(await emptyPage.locator('#summary').getByText('0', { exact: true }).count() > 0, true);
  } finally {
    await browser.close();
    await hub.close();
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(sourceRoot, { recursive: true, force: true });
  }
});

test('local Team Hub browser inspects and confirms an exact install, then reports service outage safely', async () => {
  const dataRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-browser-local-data-'));
  const sourceRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-browser-local-pack-'));
  const projectRoot = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-browser-local-project-'));
  const tokenEnv = 'EWAI_TEAM_HUB_BROWSER_LOCAL';
  const resourcePackage = buildTeamHubResourcePackage(organisationPack(sourceRoot));
  const database = openTeamHubDatabase(dataRoot);
  publishTeamHubResource(database, resourcePackage, { receiptId: 'local-browser-publication' });
  database.close();
  initProject(projectRoot, { name: 'Local Browser Project' });
  const hub = await createTeamHubHttpServer({ dataRoot, token: readerToken, publisherToken, host: '127.0.0.1', port: 0 });
  process.env[tokenEnv] = readerToken;
  connectTeamHub(projectRoot, {
    endpoint: hub.url,
    projectId: 'local-browser-project',
    tokenEnv,
    confirmed: true,
    disclosureAcknowledged: true,
  });
  const preferences=readDashboardPreferences(projectRoot);
  saveDashboardPreferences(projectRoot,{confirmed:true,expectedDigest:preferences.digest,preferences:{...preferences.preferences,optional_views:{...preferences.preferences.optional_views,'team-hub':true}}});
  const dashboard = await ensureDashboard(projectRoot);
  const browser = await browserInstance();
  let hubClosed = false;
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(dashboard.url);
    await page.waitForFunction(()=>document.querySelector('#configurationNav')?.disabled===false);
    await page.locator('#sidebarOpen').click();
    await page.locator('button[data-view="team-hub"]').click();
    await assert.doesNotReject(page.getByRole('heading', { name: 'Team Hub', exact: true }).waitFor());
    await assert.doesNotReject(page.getByText('Connected contributor').waitFor());

    await page.locator('[data-team-hub-resources-refresh]').click();
    await page.locator('[data-team-hub-resource-inspect="org.acme.delivery"]').click();
    await assert.doesNotReject(page.locator('#teamHubResourceInstallForm').waitFor());
    await page.locator('#teamHubResourceInstallForm input[name="approvedBy"]').fill('Browser QA Owner');
    await page.locator('#teamHubResourceInstallForm input[name="confirmed"]').check();
    assert.deepEqual(pageErrors, []);
    assert.equal(await page.locator('#teamHubResourceInstallForm').evaluate((form) => form.checkValidity()), true);
    await page.evaluate(() => { window.confirm = () => true; });
    const submitted = await page.locator('#teamHubResourceInstallForm').evaluate((form) => form.dispatchEvent(new SubmitEvent('submit', {
      bubbles: true,
      cancelable: true,
      submitter: form.querySelector('button[type="submit"]'),
    })));
    assert.equal(submitted, false, 'the document submit handler must cancel native form navigation');
    await page.waitForFunction(() => /installed complete|resource-install|error|failed/i.test(document.querySelector('#teamHubStatus')?.textContent ?? ''));
    await assert.doesNotReject(page.locator('#teamHubStatus').filter({ hasText: /installed complete/i }).waitFor());
    await assert.doesNotReject(page.locator('#teamHubResourceDetail').filter({ hasText: /v1\.0\.0 installed/i }).waitFor());
    assert.equal(await page.locator('#teamHubAuthority').getByText(/cannot approve Build or Manual QA/i).count() > 0, true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

    await hub.close();
    hubClosed = true;
    await page.locator('[data-team-hub-resources-refresh]').click();
    await assert.doesNotReject(page.locator('#teamHubStatus').filter({ hasText: /fetch|connect|failed/i }).waitFor());
    assert.equal(await page.getByText('Connected contributor').isVisible(), true);
  } finally {
    await browser.close();
    await stopDashboard(projectRoot);
    if (!hubClosed) await hub.close();
    delete process.env[tokenEnv];
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(sourceRoot, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
