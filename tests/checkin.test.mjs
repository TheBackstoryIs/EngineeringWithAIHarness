import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  checkinProject,
  frameworkStatus,
  premiumPackReceiptPath,
  premiumPersonaRoot,
  syncPremiumPersonas
} from '../src/checkin.mjs';
import { initProject } from '../src/project.mjs';
import { createIntent } from '../src/intents.mjs';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('startup without a key offers private website setup and preserves core use', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-checkin-'));
  try {
    const project = resolve(root, 'project'), home = resolve(root, 'home');
    mkdirSync(project, { recursive: true }); initProject(project, { name: 'Check-in Test' });
    let calls = 0;
    const first = await checkinProject(project, { home, checkFramework: false, startRuntime: false, premiumFetchImpl: async () => { calls++; throw Error('Unexpected persona request'); } });
    assert.equal(first.premium.provider, 'wordpress-edd');
    assert.equal(first.premium.accessReason, 'licence-not-configured');
    assert.equal(first.premium.action.kind, 'offer-configure'); assert.equal(calls, 0);
    assert.match(first.companion.personaSetup.question, /Do you have a premium persona licence/);
    assert.equal(first.companion.personaSetup.choices[0].command, 'ewai persona premium configure --project .');
    assert.equal(first.companion.actions.find(action => action.id === 7).url, 'https://www.conversationalcoding.dev/personas/');
    assert.equal(existsSync(premiumPackReceiptPath(home)), false);
    assert.equal(first.companion.closingPrompt, "What's on your mind?");
    await assert.rejects(syncPremiumPersonas(project, { home, confirmed: false }), /explicit confirmation/);
    const cli = JSON.parse(execFileSync(process.execPath, [resolve('bin/ewai'), 'persona', 'premium', 'status', '--project', project, '--json'], {
      cwd: resolve('.'), encoding: 'utf8', env: { ...process.env, HOME: home }
    }));
    assert.equal(cli.provider, 'wordpress-edd'); assert.equal(cli.action.kind, 'offer-configure');
    assert.equal(JSON.stringify(cli).includes(home), false);
    const state = JSON.parse(readFileSync(resolve(project, '.ewai-pipeline/runtime/checkin.json'), 'utf8'));
    assert.equal(state.premium.provider, 'wordpress-edd'); assert.equal(state.premium.verified, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('harness updates use npm even inside its own source checkout', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-npm-only-'));
  try {
    mkdirSync(resolve(root, '.git'));
    writeFileSync(resolve(root, 'package.json'), JSON.stringify({ name: '@thebackstoryis/engineering-with-ai', version: '0.1.0' }));
    let calls = 0;
    const status = await frameworkStatus(root, { fetchImpl: async url => {
      calls++; assert.match(url, /^https:\/\/registry\.npmjs\.org\//);
      return { ok: true, json: async () => ({ version: '0.2.0' }) };
    } });
    assert.equal(status.source, 'npm'); assert.equal(status.action.kind, 'offer-npm-update'); assert.equal(calls, 1);
    assert.equal('currentRevision' in status, false); assert.equal('latestRevision' in status, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('returns a mandatory companion menu and includes Continue when project work exists', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-companion-opening-'));
  try {
    const project = resolve(root, 'project');
    mkdirSync(project, { recursive: true });
    initProject(project, { name: 'Companion Opening Test' });

    const empty = await checkinProject(project, {
      home: resolve(root, 'home'),
      checkFramework: false,
      startRuntime: false
    });
    assert.equal(empty.companion.presentation, 'mandatory-numbered-menu');
    assert.equal(empty.companion.actions[3].label, 'Explore the Mind Palace, risks, or standards');
    assert.equal(empty.palace.schema, 'ewai.palace-tidiness/v1');
    assert.deepEqual(empty.companion.actions.map((action) => action.id), [1, 2, 3, 4, 5, 7, 8, 9]);
    assert.equal(empty.companion.closingPrompt, "What's on your mind?");
    assert.match(empty.companion.contract.join(' '), /Do not replace the menu with narrative/);

    createIntent(project, { slug: 'existing-work', domain: 'platform', title: 'Existing Work' });
    const withWork = await checkinProject(project, {
      home: resolve(root, 'home'),
      checkFramework: false,
      startRuntime: false
    });
    assert.deepEqual(withWork.companion.actions.map((action) => action.id), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(withWork.companion.actions.find(action => action.id === 6), {
      id: 6,
      key: 'continue',
      label: 'Continue a piece of work'
    });
    assert.equal(withWork.companion.spotlight.id, 'platform/existing-work');
    assert.equal(withWork.companion.spotlight.title, 'Existing Work');
    assert.equal(JSON.stringify(withWork.companion).includes(project), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('checks the npm registry version for a packaged installation', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-framework-version-'));
  try {
    writeFileSync(resolve(root, 'package.json'), JSON.stringify({
      name: '@thebackstoryis/engineering-with-ai',
      version: '0.1.0'
    }));

    const result = await frameworkStatus(root, {
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return { version: '0.2.0' };
        }
      })
    });

    assert.deepEqual(result, {
      status: 'update-available',
      source: 'npm',
      current: '0.1.0',
      latest: '0.2.0',
      action: {
        kind: 'offer-npm-update',
        prompt: 'EWAI 0.2.0 is available from npm. Would you like me to update the global package?',
        command: 'npm install --global @thebackstoryis/engineering-with-ai@latest'
      }
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does not mistake an npm package nested below an unrelated Git checkout for a Git installation', async () => {
  const ancestor = mkdtempSync(resolve(tmpdir(), 'ewai-framework-ancestor-'));
  try {
    git(ancestor, 'init');
    const packageRoot = resolve(ancestor, 'runtime/node/lib/node_modules/@thebackstoryis/engineering-with-ai');
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(resolve(packageRoot, 'package.json'), JSON.stringify({
      name: '@thebackstoryis/engineering-with-ai',
      version: '0.1.1'
    }));

    const result = await frameworkStatus(packageRoot, {
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return { version: '0.1.1' };
        }
      })
    });

    assert.deepEqual(result, {
      status: 'current',
      source: 'npm',
      current: '0.1.1',
      latest: '0.1.1',
      action: null
    });
  } finally {
    rmSync(ancestor, { recursive: true, force: true });
  }
});

test('treats a node_modules package as npm-managed even when stale Git metadata is present', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-framework-node-modules-'));
  try {
    const packageRoot = resolve(root, 'lib/node_modules/@thebackstoryis/engineering-with-ai');
    mkdirSync(resolve(packageRoot, '.git'), { recursive: true });
    writeFileSync(resolve(packageRoot, 'package.json'), JSON.stringify({
      name: '@thebackstoryis/engineering-with-ai',
      version: '0.1.2'
    }));

    const result = await frameworkStatus(packageRoot, {
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return { version: '0.1.3' };
        }
      })
    });

    assert.deepEqual(result, {
      status: 'update-available',
      source: 'npm',
      current: '0.1.2',
      latest: '0.1.3',
      action: {
        kind: 'offer-npm-update',
        prompt: 'EWAI 0.1.3 is available from npm. Would you like me to update the global package?',
        command: 'npm install --global @thebackstoryis/engineering-with-ai@latest'
      }
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
