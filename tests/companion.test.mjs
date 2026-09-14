import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  buildCompanionPrompt,
  detectHostStatuses,
  formatHostAvailability,
  hostInvocation,
  runCompanion,
  selectAvailableHost
} from '../src/companion.mjs';

test('numbers only available AI hosts and explains unavailable CLIs', () => {
  const statuses = detectHostStatuses({
    probe: (host) => host !== 'codex'
  });
  const view = formatHostAvailability(statuses);

  assert.match(view, /1\. Claude Code/);
  assert.match(view, /2\. Google Antigravity/);
  assert.match(view, /Not available in this terminal/);
  assert.match(view, /• Codex — `codex` command is not available in this terminal/);
  assert.doesNotMatch(view, /\d+\. Codex/);
});

test('builds a first-turn contract that keeps setup inside the AI conversation', () => {
  const prompt = buildCompanionPrompt({
    projectRoot: '/tmp/example',
    initialized: true,
    existingCodebase: true
  });

  assert.match(prompt, /Use \$ewai-pipeline/);
  assert.match(prompt, /EWAI initialized: yes/);
  assert.match(prompt, /Existing codebase detected: yes/);
  assert.match(prompt, /Do not ask the user to copy or run CLI commands/);
  assert.match(prompt, /Never use the host AI generic plan mode/);
  assert.match(prompt, /\[6\] Continue a piece of work/);
  assert.match(prompt, /MANDATORY FIRST-RESPONSE PRESENTATION CONTRACT/);
  assert.match(prompt, /narrative-only opening is invalid/);
  assert.match(prompt, /every numbered action returned in checkin\.companion/);
  assert.match(prompt, /Do not finish the first response until both check-in status and the numbered menu are visible/);
});

test('carries a dashboard-selected intent into the conversational companion', () => {
  const prompt = buildCompanionPrompt({
    projectRoot: '/tmp/example', initialized: true, existingCodebase: true,
    dashboardHandoff: {
      id: '00000000-0000-4000-8000-000000000001',
      action: 'continue', intentId: 'alerts/dispatch-reliability', phase: 'plan',
    },
  });

  assert.match(prompt, /Dashboard handoff: continue alerts\/dispatch-reliability at plan/);
  assert.match(prompt, /Treat “go” as selecting it/);
  assert.match(prompt, /use \$ewai-deliver/);
});

test('routes authority-free contribution review to the phase evidence skill', () => {
  const prompt = buildCompanionPrompt({
    projectRoot: '/tmp/example', initialized: true, existingCodebase: true,
    dashboardHandoff: {
      id: '00000000-0000-4000-8000-000000000002', action: 'review-contribution',
      intentId: 'experience/guided-phase', phase: 'plan', authority: 'none',
    },
  });
  assert.match(prompt, /review-contribution experience\/guided-phase at plan/);
  assert.match(prompt, /authority none/);
  assert.match(prompt, /use \$ewai-phase-evidence/);
  assert.match(prompt, /Do not invoke \$ewai-deliver or mutate delivery state/);
});

test('the orchestration skill requires interpreted check-in and human archaeology progress', () => {
  const pipeline = readFileSync(resolve('skills-src/ewai-pipeline/SKILL.md'), 'utf8');
  const archaeology = readFileSync(resolve('skills-src/ewai-archaeology/SKILL.md'), 'utf8');
  const architecture = readFileSync(resolve('skills-src/ewai-architecture/SKILL.md'), 'utf8');
  const contextImport = readFileSync(resolve('skills-src/ewai-context-import/SKILL.md'), 'utf8');
  const standardsCheck = readFileSync(resolve('skills-src/ewai-standards-check/SKILL.md'), 'utf8');
  const deliver = readFileSync(resolve('skills-src/ewai-deliver/SKILL.md'), 'utf8');
  const shapeIntents = readFileSync(resolve('skills-src/ewai-shape-intents/SKILL.md'), 'utf8');
  const palaceHousekeeping = readFileSync(resolve('skills-src/ewai-palace-housekeeping/SKILL.md'), 'utf8');
  const solutionReadiness = readFileSync(resolve('skills-src/ewai-solution-readiness/SKILL.md'), 'utf8');
  const organisationPolicy = readFileSync(resolve('skills-src/ewai-organisation-policy/SKILL.md'), 'utf8');

  assert.match(pipeline, /EWAI version and update status/);
  assert.match(pipeline, /premium entitlement and installed-library status/);
  assert.match(pipeline, /dashboard URL/);
  assert.match(pipeline, /Only then ask.*What's on your mind/s);
  assert.match(pipeline, /\[6\] Continue a piece of work/);
  assert.match(pipeline, /opening format is mandatory/i);
  assert.match(pipeline, /narrative-only opening is invalid/i);
  assert.doesNotMatch(pipeline, /Suggested companion menu shape/);
  assert.match(pipeline, /Never inspect, fetch, or pull the EWAI Git repository/);
  assert.match(deliver, /only supported route/i);
  assert.match(deliver, /generic planning mode is not an EWAI Plan/i);
  assert.match(deliver, /complete fourteen-stage Engineering With AI harness/);
  assert.doesNotMatch(deliver, /Backstory/i);
  assert.match(deliver, /Markdown.*structured intent JSON.*SQLite/is);
  assert.match(pipeline, /\$ewai-standards-check/);
  assert.match(pipeline, /\$ewai-architecture/);
  assert.match(pipeline, /\$ewai-shape-intents/);
  assert.match(pipeline, /\$ewai-palace-housekeeping/);
  assert.match(palaceHousekeeping, /ewai palace tidiness/);
  assert.match(palaceHousekeeping, /Never delete, merge, archive, refile, supersede, or rewrite canonical SPECS without explicit approval/);
  assert.match(palaceHousekeeping, /no-op/i);
  assert.match(shapeIntents, /premium `product-owner` persona/);
  assert.match(shapeIntents, /ask one question at a time/i);
  assert.match(shapeIntents, /explicitly approve the map/i);
  assert.match(shapeIntents, /Never begin the fourteen-stage delivery cycle/i);
  assert.match(solutionReadiness, /readiness prepare/);
  assert.match(solutionReadiness, /active personas/i);
  assert.match(solutionReadiness, /premium personas are optional/i);
  assert.match(solutionReadiness, /does not approve Manual QA or release/i);
  assert.match(organisationPolicy, /design-time evidence only/i);
  assert.match(organisationPolicy, /named human/i);
  assert.match(deliver, /policy baseline.*enabled.*\$ewai-organisation-policy/is);
  assert.match(architecture, /observed.*proposed.*accepted/is);
  assert.match(architecture, /ask one question at a time/i);
  assert.match(architecture, /proposals\/SPECS\//);
  assert.match(archaeology, /human project briefing/i);
  assert.match(archaeology, /before launching any deep analysis agents/i);
  assert.match(archaeology, /installed core, premium, personal, and project persona/i);
  assert.match(archaeology, /Present the user with a concise persona analysis/i);
  assert.match(archaeology, /ewai archaeology validate-personas/);
  assert.match(archaeology, /Do not launch deep analysis agents unless this validation passes/i);
  assert.match(archaeology, /rerun every pass whose interpretation could materially change/i);
  const personaValidationIndex = archaeology.indexOf('ewai archaeology validate-personas');
  const deepLaunchPermissionIndex = archaeology.search(/Do not launch deep analysis agents unless this validation passes/i);
  assert.equal(personaValidationIndex >= 0 && personaValidationIndex < deepLaunchPermissionIndex, true);
  assert.match(archaeology, /Looking for user processes/);
  assert.match(archaeology, /Found .*candidate/);
  assert.match(archaeology, /whole-project.*deep baseline/is);
  assert.match(archaeology, /survey.*never describe it as completed Archaeology/is);
  assert.match(archaeology, /live code.*primary evidence/is);
  assert.match(archaeology, /coverage-ledger\.yaml/);
  assert.match(archaeology, /specs-reconstruction-ledger\.yaml/);
  assert.match(archaeology, /all six SPECS areas.*fourteen delivery stages/is);
  assert.match(archaeology, /proposals\/SPECS\//);
  assert.match(archaeology, /alternative.*actually considered/is);
  assert.match(archaeology, /full-coverage, maximum-discoverable-detail/i);
  assert.match(archaeology, /not a lightweight interpretive pass/i);
  assert.match(archaeology, /capability-catalog\.yaml/);
  assert.match(archaeology, /archaeology-artifact-manifest\.yaml/);
  assert.match(archaeology, /ewai archaeology validate/);
  assert.match(archaeology, /individual detailed records/i);
  assert.match(archaeology, /risk register/i);
  assert.match(archaeology, /integration contracts/i);
  assert.match(archaeology, /security and trust review/i);
  assert.match(archaeology, /model-routing rules/i);
  const modelRouting = readFileSync(resolve('skills-src/ewai-archaeology/references/model-routing.md'), 'utf8');
  assert.match(modelRouting, /per-invocation model set to `opus`/i);
  assert.match(modelRouting, /retry.*once.*`sonnet`/is);
  assert.match(modelRouting, /do not weaken safety wording/i);
  assert.match(modelRouting, /mark the security-review.*`blocked`/is);
  assert.match(archaeology, /code-quality review/i);
  assert.match(archaeology, /self-review and manual filing/i);
  assert.match(archaeology, /AI-guided walkthrough/i);
  assert.match(archaeology, /smallest useful set of cross-record review questions/i);
  assert.match(archaeology, /clarifies content or also asks for approval/i);
  assert.match(archaeology, /Automatic curation.*refuse to overwrite/is);
  assert.match(archaeology, /future features.*security improvements/is);
  assert.match(archaeology, /feature-candidates/);
  assert.match(archaeology, /AI recommendations are proposals/i);
  assert.match(archaeology, /prospective-work transition gate/i);
  assert.match(archaeology, /remediation.*intents.*not.*satisfying this gate/is);
  assert.match(archaeology, /interview you about what it should do next/i);
  assert.match(archaeology, /Do not replace this offer with.*What would you like to tackle next/is);
  assert.match(archaeology, /future-work-transition\.yaml/);
  assert.match(archaeology, /Never create recommendation-derived or remediation intents in parallel/is);
  assert.match(archaeology, /What should this system do next/);
  assert.match(archaeology, /Archaeology complete.*canonical SPECS/is);
  assert.match(pipeline, /folder of emails, meeting transcripts/);
  assert.match(contextImport, /ewai persona index/);
  assert.match(contextImport, /which available personas would materially improve/);
  assert.match(contextImport, /persona-routing\.yaml/);
  assert.match(contextImport, /proposals\/SPECS\/1\.Scope\/personas\/project/);
  assert.match(contextImport, /advisory persona.*not evidence/is);
  assert.match(standardsCheck, /supplied code snippet, one file, several files/i);
  assert.match(standardsCheck, /SPECS\/5\.Strategy\/standards-index\.md/);
  assert.match(standardsCheck, /SPECS\/4\.Constraints/);
  assert.match(standardsCheck, /applicability matrix/i);
  assert.match(standardsCheck, /Do not silently choose between conflicting accepted records/i);
  assert.match(standardsCheck, /SPECS\/3\.Evidence\/reviews\/standards/);
  assert.match(standardsCheck, /do not describe a sampled or partially inspected repository as compliant/i);
  const reportContract = readFileSync(resolve('skills-src/ewai-standards-check/references/report-contract.md'), 'utf8');
  assert.match(reportContract, /Outcome summary/);
  assert.match(reportContract, /Confirmed conformance/);
  assert.match(reportContract, /Unverified items and standards conflicts/);
});

test('uses each supported host interactive initial-prompt interface', () => {
  assert.deepEqual(hostInvocation('claude', 'hello'), { command: 'claude', args: ['hello'] });
  assert.deepEqual(hostInvocation('codex', 'hello'), { command: 'codex', args: ['hello'] });
  assert.deepEqual(hostInvocation('antigravity', 'hello'), {
    command: 'agy',
    args: ['--prompt-interactive', 'hello']
  });
});

test('respects an available preferred host and otherwise selects a sole host', () => {
  assert.equal(selectAvailableHost(['claude', 'codex'], 'codex'), 'codex');
  assert.equal(selectAvailableHost(['claude'], ''), 'claude');
  assert.equal(selectAvailableHost(['claude'], 'antigravity'), 'claude');
  assert.equal(selectAvailableHost([], 'claude'), null);
});

test('launches a sole available host with project-aware onboarding', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-companion-'));
  mkdirSync(resolve(root, '.git'));
  writeFileSync(resolve(root, 'package.json'), '{"name":"existing-project"}\n');
  let launched = null;
  let output = '';
  const events = [];

  try {
    const exitCode = await runCompanion({
      cwd: root,
      input: { isTTY: false },
      output: { isTTY: false, write: (value) => { output += value; } },
      errorOutput: { write() {} },
      probeHost: (host) => host === 'claude',
      prepareHost: async (host) => { events.push(`prepared:${host}`); },
      spawnHost: async (invocation, state) => {
        events.push(`launched:${invocation.command}`);
        launched = { invocation, state };
        return 0;
      }
    });

    assert.equal(exitCode, 0);
    assert.equal(launched.invocation.command, 'claude');
    assert.equal(launched.state.initialized, false);
    assert.equal(launched.state.existingCodebase, true);
    assert.match(launched.invocation.args[0], /EWAI initialized: no/);
    assert.match(output, /EWAI .* Claude Code/);
    assert.equal(output.trim().split('\n').length, 1);
    assert.doesNotMatch(output, /AI hosts available|Not available in this terminal/);
    assert.deepEqual(events, ['prepared:claude', 'launched:claude']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does not launch the AI host when its managed skills cannot be prepared', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-companion-'));
  mkdirSync(resolve(root, '.git'));
  let error = '';
  let launched = false;

  try {
    const exitCode = await runCompanion({
      cwd: root,
      input: { isTTY: false },
      output: { isTTY: false, write() {} },
      errorOutput: { write: (value) => { error += value; } },
      probeHost: (host) => host === 'claude',
      prepareHost: async () => { throw new Error('permission denied'); },
      spawnHost: async () => { launched = true; return 0; }
    });

    assert.equal(exitCode, 1);
    assert.equal(launched, false);
    assert.match(error, /could not prepare its companion skills for Claude Code/);
    assert.match(error, /permission denied/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
