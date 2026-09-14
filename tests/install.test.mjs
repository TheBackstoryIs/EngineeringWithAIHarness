import test from 'node:test';
import {DASHBOARD_VIEWS} from '../src/dashboard-preferences.mjs';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { install } from '../src/install.mjs';

test('packages the optional Team Hub runtime, browser surfaces and operator guide', () => {
  const root = resolve(import.meta.dirname, '..');
  for (const path of [
    'src/team-hub.mjs', 'src/runtime/team-hub-client.mjs', 'src/runtime/team-hub-database.mjs',
    'src/runtime/team-hub-server.mjs', 'src/runtime/team-hub.mjs', 'public/team-hub/index.html',
    'public/team-hub/app.js', 'public/team-hub/styles.css', 'src/team-hub-resources.mjs',
    'Docs/team-hub-guide.md', 'Docs/team-hub-resource-registry-guide.md',
  ]) assert.equal(existsSync(resolve(root, path)), true, path);
  const guide = readFileSync(resolve(root, 'Docs/team-hub-guide.md'), 'utf8');
  assert.match(guide, /single mode/i);
  assert.match(guide, /disclosure/i);
  assert.match(guide, /reverse proxy/i);
  assert.match(guide, /backup/i);
  assert.match(guide, /recovery/i);
  assert.match(guide, /rotate/i);
  assert.match(guide, /disconnect/i);
  assert.match(guide, /cannot approve Build or Manual QA/i);
  assert.match(guide, /immutable registry/i);
  const registryGuide = readFileSync(resolve(root, 'Docs/team-hub-resource-registry-guide.md'), 'utf8');
  assert.match(registryGuide, /exact.+digest/is);
  assert.match(registryGuide, /Neither action selects/i);
});

test('installs skills and CLI into an isolated global Codex home', () => {
  const home = mkdtempSync(resolve(tmpdir(), 'ewai-install-home-'));
  try {
    const result = install({
      scope: 'global',
      host: 'codex',
      mode: 'copy',
      home,
      binDir: resolve(home, 'bin')
    });
    assert.equal(result.skills.every((item) => item.status === 'installed'), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-pipeline/SKILL.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-dashboard-configuration/SKILL.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-archaeology/SKILL.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-architecture/SKILL.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-standards-check/SKILL.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-shape-intents/SKILL.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-palace-housekeeping/SKILL.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-deliver/SKILL.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-deliver/references/phase-routing.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-test-scenarios/SKILL.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-test-scenarios/references/scenario-contract.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-meeting-evidence/SKILL.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-meeting-evidence/references/candidate-contract.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-meeting-evidence/agents/openai.yaml')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-knowledge-proposals/SKILL.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-knowledge-proposals/references/proposal-contract.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-knowledge-proposals/agents/openai.yaml')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-portfolio/SKILL.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-portfolio/references/portfolio-contract.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-rollout/SKILL.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-rollout/references/rollout-contract.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-phase-evidence/SKILL.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-phase-evidence/agents/openai.yaml')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-organisation-policy/SKILL.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-organisation-policy/references/policy-contract.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-organisation-policy/agents/openai.yaml')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-error-reporting/SKILL.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-error-reporting/references/provider-contract.md')), true);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-error-reporting/agents/openai.yaml')), true);
    for (const skill of ['ewai-design-system-author', 'ewai-design-system-apply', 'ewai-design-system-review']) {
      assert.equal(existsSync(resolve(home, '.codex/skills', skill, 'SKILL.md')), true);
      assert.equal(existsSync(resolve(home, '.codex/skills', skill, 'agents/openai.yaml')), true);
    }
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-deliver/references/canonical-commands')), false);
    assert.equal(existsSync(resolve(home, '.codex/skills/ewai-deliver/scripts/canonical-checkers')), false);
    assert.equal(existsSync(resolve(home, 'bin/ewai')), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('installs project-local skills without creating a global CLI', () => {
  const projectRoot = mkdtempSync(resolve(tmpdir(), 'ewai-install-project-'));
  try {
    const result = install({
      scope: 'project',
      projectRoot,
      host: 'codex',
      mode: 'copy'
    });
    assert.equal(result.skills.every((item) => item.status === 'installed'), true);
    assert.equal(existsSync(resolve(projectRoot, '.agents/skills/ewai-pipeline/SKILL.md')), true);
    assert.equal(existsSync(resolve(projectRoot, '.agents/skills/ewai-archaeology/SKILL.md')), true);
    assert.equal(existsSync(resolve(projectRoot, '.agents/skills/ewai-architecture/SKILL.md')), true);
    assert.equal(existsSync(resolve(projectRoot, '.agents/skills/ewai-standards-check/SKILL.md')), true);
    assert.equal(existsSync(resolve(projectRoot, '.agents/skills/ewai-shape-intents/SKILL.md')), true);
    assert.equal(existsSync(resolve(projectRoot, '.agents/skills/ewai-palace-housekeeping/SKILL.md')), true);
    assert.equal(existsSync(resolve(projectRoot, '.agents/skills/ewai-test-scenarios/SKILL.md')), true);
    assert.equal(existsSync(resolve(projectRoot, '.agents/skills/ewai-test-scenarios/references/scenario-contract.md')), true);
    assert.equal(existsSync(resolve(projectRoot, '.agents/skills/ewai-meeting-evidence/SKILL.md')), true);
    assert.equal(existsSync(resolve(projectRoot, '.agents/skills/ewai-meeting-evidence/references/candidate-contract.md')), true);
    assert.equal(existsSync(resolve(projectRoot, '.agents/skills/ewai-knowledge-proposals/SKILL.md')), true);
    assert.equal(existsSync(resolve(projectRoot, '.agents/skills/ewai-knowledge-proposals/references/proposal-contract.md')), true);
    assert.equal(existsSync(resolve(projectRoot, '.agents/skills/ewai-portfolio/SKILL.md')), true);
    assert.equal(existsSync(resolve(projectRoot, '.agents/skills/ewai-portfolio/references/portfolio-contract.md')), true);
    assert.equal(existsSync(resolve(projectRoot, '.agents/skills/ewai-rollout/SKILL.md')), true);
    assert.equal(existsSync(resolve(projectRoot, '.agents/skills/ewai-rollout/references/rollout-contract.md')), true);
    assert.equal(existsSync(resolve(projectRoot, '.agents/skills/ewai-phase-evidence/SKILL.md')), true);
    assert.equal(existsSync(resolve(projectRoot, '.agents/skills/ewai-organisation-policy/SKILL.md')), true);
    assert.equal(existsSync(resolve(projectRoot, '.agents/skills/ewai-error-reporting/SKILL.md')), true);
    assert.equal(existsSync(resolve(projectRoot, '.agents/skills/ewai-error-reporting/references/provider-contract.md')), true);
    for (const skill of ['ewai-design-system-author', 'ewai-design-system-apply', 'ewai-design-system-review']) {
      assert.equal(existsSync(resolve(projectRoot, '.agents/skills', skill, 'SKILL.md')), true);
    }
    assert.equal('bin' in result, false);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('ships the read-only responsive rollout dashboard contract', () => {
  const page = readFileSync(resolve(import.meta.dirname, '../public/index.html'), 'utf8');
  const app = readFileSync(resolve(import.meta.dirname, '../public/app.js'), 'utf8');
  const styles = readFileSync(resolve(import.meta.dirname, '../public/styles.css'), 'utf8');

  assert.ok(DASHBOARD_VIEWS.some(view=>view.id==='rollout'));
  assert.match(page, /id="optionalViewLinks"/);
  assert.match(page, /id="rolloutLedger"/);
  assert.match(page, /id="rolloutContext"/);
  assert.match(page, /id="rolloutPersonas"/);
  assert.match(app, /rollout\.activePersonas|workspace\.activePersonas/);
  assert.match(app, /persona\.matchedSignals/);
  assert.match(app, /persona\.engagementReason/);
  assert.match(app, /personaAvailability\?\.premium/);
  assert.match(app, /loadRollout\(rolloutFocusFor/);
  assert.doesNotMatch(app, /data-rollout-(?:edit|adopt|approve|sync|certify|risk|build|deploy|release)/);
  assert.match(styles, /\.rollout-project:focus-visible/);
  assert.match(styles, /@media \(max-width: 390px\)[\s\S]*\.rollout-layout/);
  assert.match(styles, /prefers-reduced-motion/);
});

test('installs the persona-led scenario design and test-building contract without making it a historical phase requirement', () => {
  const skillPath = resolve(import.meta.dirname, '../skills-src/ewai-test-scenarios/SKILL.md');
  const referencePath = resolve(import.meta.dirname, '../skills-src/ewai-test-scenarios/references/scenario-contract.md');
  const deliverySkillPath = resolve(import.meta.dirname, '../skills-src/ewai-deliver/SKILL.md');
  const artefactsPath = resolve(import.meta.dirname, '../config/delivery-artifacts.yaml');

  assert.equal(existsSync(skillPath), true);
  assert.equal(existsSync(referencePath), true);
  const skill = readFileSync(skillPath, 'utf8');
  const reference = readFileSync(referencePath, 'utf8');
  const delivery = readFileSync(deliverySkillPath, 'utf8');
  const artefacts = readFileSync(artefactsPath, 'utf8');

  assert.match(skill, /^---\nname: ewai-test-scenarios\n/);
  assert.match(skill, /test-scenarios prepare/);
  assert.match(skill, /test-scenarios record/);
  assert.match(skill, /active persona/i);
  assert.match(skill, /engagement reason/i);
  assert.match(skill, /authoritative source/i);
  assert.match(skill, /unresolved hypothesis/i);
  assert.match(skill, /failing test first/i);
  assert.match(skill, /preserve the accepted oracle/i);
  assert.match(skill, /Manual QA.+human evidence/is);
  assert.match(skill, /premium.+installed/is);
  assert.doesNotMatch(skill, /premium persona (?:sync|download)/i);

  assert.match(reference, /ewai\.persona-test-scenarios\/v1/);
  assert.match(reference, /PTS-###/);
  assert.match(reference, /representative-user/);
  assert.match(reference, /specialist-assurance/);

  assert.match(delivery, /\$ewai-test-scenarios/);
  assert.match(delivery, /Test Plan.+personas can materially/is);
  assert.match(delivery, /Build.+accepted automated.+scenario/is);
  assert.match(delivery, /conditional|when/i);
  assert.doesNotMatch(artefacts, /test-scenarios\.(?:json|md)/);
});

test('preserves local additions to an installed skill unless force is explicit', () => {
  const home = mkdtempSync(resolve(tmpdir(), 'ewai-install-preserve-'));
  try {
    install({ scope: 'global', host: 'codex', mode: 'copy', home, installBin: false });
    const local = resolve(home, '.codex/skills/ewai-deliver/references/local-note.md');
    writeFileSync(local, '# Local note\n');
    install({ scope: 'global', host: 'codex', mode: 'copy', home, installBin: false });
    assert.equal(readFileSync(local, 'utf8'), '# Local note\n');
    install({ scope: 'global', host: 'codex', mode: 'copy', home, installBin: false, force: true });
    assert.equal(existsSync(local), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('installs skills for Antigravity using its shared configuration directory', () => {
  const home = mkdtempSync(resolve(tmpdir(), 'ewai-install-antigravity-'));
  try {
    const result = install({
      scope: 'global',
      host: 'antigravity',
      mode: 'copy',
      home,
      installBin: false
    });
    assert.equal(result.skills.every((item) => item.status === 'installed'), true);
    assert.equal(existsSync(resolve(home, '.gemini/config/skills/ewai-pipeline/SKILL.md')), true);
    assert.equal(existsSync(resolve(home, '.gemini/config/skills/ewai-architecture/SKILL.md')), true);
    assert.equal(existsSync(resolve(home, '.gemini/config/skills/ewai-standards-check/SKILL.md')), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('installs the model-routed defensive security reviewer for Claude Code', () => {
  const home = mkdtempSync(resolve(tmpdir(), 'ewai-install-claude-'));
  try {
    const result = install({
      scope: 'global',
      host: 'claude',
      mode: 'copy',
      home,
      installBin: false
    });
    const agentPath = resolve(home, '.claude/agents/ewai-security-reviewer.md');
    assert.equal(result.agents.length, 1);
    assert.equal(result.agents[0].status, 'installed');
    assert.equal(existsSync(agentPath), true);
    assert.match(readFileSync(agentPath, 'utf8'), /model: opus/);
    assert.match(readFileSync(agentPath, 'utf8'), /permissionMode: plan/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('packages Context-Aware Delivery Companion operating guidance', () => {
  const root = resolve(import.meta.dirname, '..');
  const skill = readFileSync(resolve(root, 'skills-src/ewai-pipeline/SKILL.md'), 'utf8');
  const docsIndex = readFileSync(resolve(root, 'Docs/README.md'), 'utf8');
  const reference = readFileSync(resolve(root, 'Docs/reference/cli-and-configuration.md'), 'utf8');
  const guide = readFileSync(resolve(root, 'Docs/context-aware-delivery-companion-guide.md'), 'utf8');
  const userGuide = readFileSync(resolve(root, 'Docs/context-aware-delivery-companion-user-guide.md'), 'utf8');
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');

  assert.match(skill, /companion\.spotlight/);
  assert.match(skill, /activePersonas/);
  assert.match(skill, /What's on your mind\?/);
  assert.match(skill, /advisory/i);
  assert.match(skill, /never.*premium.*(?:sync|download)/i);
  assert.match(docsIndex, /guide-catalogue\.md/);
  assert.match(readFileSync(resolve(root, 'Docs/guide-catalogue.md'), 'utf8'), /context-aware-delivery-companion-guide\.md/);
  assert.match(reference, /ewai companion status/);
  assert.match(reference, /ewai_companion_status/);
  assert.match(guide, /ewai\.companion-guidance\/v1/);
  assert.match(guide, /human-decision/);
  assert.match(guide, /Standard host-model baseline/i);
  assert.match(guide, /premium/i);
  assert.match(guide, /Security validation is evidence, not certification/);
  assert.match(userGuide, /You do not need to use the command line/);
  assert.match(userGuide, /Human decision/);
  assert.match(userGuide, /Continue/);
  assert.match(userGuide, /Start/);
  assert.match(userGuide, /Blocked/);
  assert.match(userGuide, /actively engaged personas/i);
  assert.match(userGuide, /does not approve/i);
  assert.match(userGuide, /Security validation is evidence, not certification/);
  assert.match(docsIndex, /context-aware-delivery-companion-user-guide\.md/);
  assert.match(guide, /Companion user guide/);
  assert.ok(readme.includes('Docs/context-aware-delivery-companion-user-guide.md'));
  assert.match(guide, /Context-Aware Delivery Companion/);
});

test('packages the Guided Intent Workspace method and user guide', () => {
  const root = resolve(import.meta.dirname, '..');
  const intentSkill = readFileSync(resolve(root, 'skills-src/ewai-intent/SKILL.md'), 'utf8');
  const docsIndex = readFileSync(resolve(root, 'Docs/README.md'), 'utf8');
  const guide = readFileSync(resolve(root, 'Docs/guided-intent-workspace-guide.md'), 'utf8');
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');

  assert.match(intentSkill, /Intent Studio/);
  assert.match(intentSkill, /project-local draft/i);
  assert.match(intentSkill, /current revision/i);
  assert.match(intentSkill, /standard host-model baseline/i);
  assert.match(intentSkill, /actively engaged personas/i);
  assert.match(intentSkill, /premium.+installed/is);
  assert.doesNotMatch(intentSkill, /premium persona (?:sync|download)/i);
  assert.match(guide, /Create a new intent/);
  assert.match(guide, /Reconcile an eligible draft intent/);
  assert.match(guide, /revision conflict/i);
  assert.match(guide, /participant evidence/i);
  assert.match(guide, /Standard host-model baseline/i);
  assert.match(guide, /Manual QA/i);
  assert.match(guide, /does not approve Build/i);
  assert.match(docsIndex, /guided-intent-workspace-guide\.md/);
  assert.ok(readme.includes('Docs/guided-intent-workspace-guide.md'));
});

test('packages the Guided Phase Evidence skill and operating guide', () => {
  const root = resolve(import.meta.dirname, '..');
  const skill = readFileSync(resolve(root, 'skills-src/ewai-phase-evidence/SKILL.md'), 'utf8');
  const guide = readFileSync(resolve(root, 'Docs/guided-phase-evidence-drafting-guide.md'), 'utf8');
  const docsIndex = readFileSync(resolve(root, 'Docs/README.md'), 'utf8');
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
  assert.match(skill, /^---\nname: ewai-phase-evidence\n/);
  assert.match(skill, /business-facing.+technical.+shared-review/is);
  assert.match(skill, /real named owner/i);
  assert.match(skill, /active persona ensemble/i);
  assert.match(skill, /premium.+already installed/is);
  assert.doesNotMatch(skill, /premium persona (?:sync|download)/i);
  assert.match(skill, /authority: none/);
  assert.match(skill, /Do not use this skill to complete a phase/i);
  assert.match(guide, /repository-fact/);
  assert.match(guide, /participant-statement/);
  assert.match(guide, /persona-hypothesis/);
  assert.match(guide, /revision and digest/i);
  assert.ok(guide.includes('reference/contributions-api.md'));
  const api = readFileSync(resolve(root, 'Docs/reference/contributions-api.md'), 'utf8');
  assert.match(api, /GET\s+\/api\/work-items\/:slug\/phase-studio/);
  assert.match(guide, /A named human must review attribution, sources, limitations/);
  assert.ok(guide.includes('security-validation-guide.md'));
  assert.match(docsIndex, /guide-catalogue\.md/);
  assert.match(readFileSync(resolve(root, 'Docs/guide-catalogue.md'), 'utf8'), /guided-phase-evidence-drafting-guide\.md/);
  assert.ok(readme.includes('Docs/reference/capabilities-and-project-layout.md'));
  const capabilities = readFileSync(resolve(root, 'Docs/reference/capabilities-and-project-layout.md'), 'utf8');
  assert.match(capabilities, /Contributions/);
});
