import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { companionOpening } from '../src/companion-opening.mjs';
import { buildCompanionPrompt } from '../src/companion.mjs';
import { initProject } from '../src/project.mjs';

const url = 'https://www.conversationalcoding.dev/personas/';
const question = "Do you have a premium persona licence, or shall we use the core personas?";
const source = path => readFileSync(resolve(path), 'utf8');

test('PTS-001 conditional premium actions keep continuation and configuration identifiers stable', () => {
  for (const access of ['unknown', 'available', 'expired', 'invalid', 'unavailable']) {
    for (const hasWork of [false, true]) {
      for (const installed of [false, true]) {
        const opening = companionOpening({ hasWork, premiumActive:false, upgradeUrl: 'https://untrusted.example/' });
        assert.deepEqual(opening.actions.map(action => action.id), hasWork ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [1, 2, 3, 4, 5, 7, 8, 9]);
        assert.equal(new Set(opening.actions.map(action => action.id)).size, opening.actions.length);
        const learning = opening.actions.find(action => action.id === 7);
        assert.equal(learning.label, 'Read about premium personas');
        assert.equal(learning.url, url);
        assert.equal(learning.key, 'premium-personas');
        assert.equal(learning.authority, 'none');
        assert.equal(opening.actions.find(action => action.id === 6)?.key, hasWork ? 'continue' : undefined);
        assert.equal(opening.closingPrompt, "What's on your mind?");
      }
    }
  }
  for(const hasWork of [false,true]){
    const opening=companionOpening({hasWork,premiumActive:true,licenceNotConfigured:true});
    assert.deepEqual(opening.actions.map(action=>action.id),hasWork?[1,2,3,4,5,6,9]:[1,2,3,4,5,9]);
    assert.equal(opening.personaSetup,null);
    assert.equal(opening.actions.at(-1).skill,'ewai-dashboard-configuration');
  }
});

test('PTS-002 setup is private and only offered for absent credentials', () => {
  const opening = companionOpening({ licenceNotConfigured: true, premium: { licenceKey: 'do-not-echo', action: { prompt: 'paste your key here', command: 'unsafe command' } } });
  assert.equal(opening.personaSetup.question, question);
  assert.deepEqual(opening.personaSetup.choices.map(choice => choice.key), ['configure', 'read', 'core']);
  assert.equal(opening.personaSetup.choices[0].command, 'ewai persona premium configure --project .');
  assert.equal(opening.personaSetup.choices[1].url, url);
  assert.equal(/do-not-echo|unsafe command|paste your key here/.test(JSON.stringify(opening)), false);
  assert.match(opening.contract.join(' '), /personaSetup/);
  for (const reason of ['expired', 'invalid', 'service-unavailable', 'licence-not-configured']) {
    assert.equal(companionOpening({ accessReason: reason }).personaSetup, null, 'Only the trusted explicit absence flag offers setup');
  }
  assert.equal(companionOpening({ licenceNotConfigured: 'true' }).personaSetup, null);
});

test('PTS-003 launch and generated onboarding agree for new and existing code', () => {
  for (const existingCodebase of [false, true]) {
    const root = mkdtempSync(resolve(tmpdir(), 'ewai-premium-discovery-'));
    try {
      if (existingCodebase) writeFileSync(resolve(root, 'package.json'), '{"name":"existing-project"}');
      const result = initProject(root, { name: 'Persona Discovery Test' });
      assert.equal(result.onboarding.existingCodebase, existingCodebase);
      assert.equal(result.onboarding.personaLearning.question, 'Would you like to see how specialist personas could help us analyse this project?');
      assert.equal(result.onboarding.personaLearning.action.url, url);
      assert.equal(initProject(root).onboarding.personaLearning, null, 'Repeated init does not repeat first-run learning');
      for (const path of ['AGENTS.md', 'CLAUDE.md']) {
        const instructions = readFileSync(resolve(root, path), 'utf8');
        assert.match(instructions, /\[7\] Read about premium personas/);
        assert.match(instructions, /companion\.personaSetup/);
        assert.match(instructions, /before deeper analysis or Archaeology/);
        assert.match(instructions, /never ask for a key in chat/);
      }
      const prompt = buildCompanionPrompt({ projectRoot: root, initialized: false, existingCodebase });
      assert.match(prompt, /\[7\] Read about premium personas/);
      assert.match(prompt, /companion\.personaSetup/);
      assert.match(prompt, /private terminal prompt/);
      assert.match(prompt, /before deeper analysis or Archaeology/);
      assert.match(prompt, /Do not ask the user to copy or run CLI commands\./);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  const skill = source('skills-src/ewai-pipeline/SKILL.md');
  assert.match(skill, /\[7\] Read about premium personas/);
  assert.match(skill, /companion\.personaSetup/);
  assert.match(skill, /before deeper analysis or Archaeology/);
  assert.match(skill, /Do you have a premium persona licence/);
  assert.match(source('skills-src/ewai-persona-entitlement/SKILL.md'), /Do you have a premium persona licence/);
  assert.doesNotMatch(source('skills-src/ewai-pipeline/references/cli.md'), /clones or safely fast-forwards/);
  assert.match(source('skills-src/ewai-pipeline/references/cli.md'), /website.*ZIP/i);
});

test('PTS-004 dashboard learning uses a safe external link, hidden until its access state is known', () => {
  const html = source('public/index.html');
  assert.match(html, /<form id="premiumSetupForm" class="action-sheet premium-setup-form">/);
  const learning = html.match(/<a\b[^>]*id="premiumLearn"[^>]*>[\s\S]*?<\/a>/)?.[0];
  assert.ok(learning);
  assert.ok(learning.includes(`href="${url}"`));
  assert.match(learning, /target="_blank"/);
  assert.match(learning, /rel="noopener noreferrer"/);
  assert.match(learning, /Premium personas/);
  assert.match(learning.split('>')[0], /\shidden(?:\s|=|$)/);
  assert.doesNotMatch(learning.split('>')[0], /data-view=/);
  assert.match(source('public/dashboard-navigation.js'), /premium\?\.active===true/);
  const card = html.match(/<a\b[^>]*id="premiumCard"[^>]*>[\s\S]*?<\/a>/)?.[0];
  assert.match(card, /Get Premium Personas/);
  assert.match(card, /rel="noopener noreferrer"/);
  const app = source('public/app.js');
  assert.doesNotMatch(app, /card\.href = premium\.upgradeUrl/);
  assert.match(app, /card\.href = 'https:\/\/www\.conversationalcoding\.dev\/personas\/'/);
  const css = source('public/styles.css');
  assert.match(css, /\.view-switcher a:focus-visible/);
  assert.match(css, /\.view-switcher[^}]*min-width: 0[^}]*overflow-x: auto/);
});
