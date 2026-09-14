import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { doctorProject, initProject, loadProjectConfig } from '../src/project.mjs';
import { createIntent } from '../src/intents.mjs';
import { resolveProjectRoot } from '../src/paths.mjs';

test('initialises a project-local SPECS contract and runtime boundary', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai project with spaces-'));
  try {
    initProject(root, { name: 'Example Product' });
    const { config, paths } = loadProjectConfig(root);

    assert.equal(config.project.name, 'Example Product');
    assert.equal(config.specs.root, 'SPECS');
    assert.equal(existsSync(paths.personaRoot), true);
    assert.equal(existsSync(resolve(paths.specsRoot, '3.Evidence/archaeology')), true);
    assert.equal(existsSync(resolve(paths.specsRoot, '3.Evidence/context-imports')), true);
    assert.equal(existsSync(resolve(paths.buildRoot, '_tracker-template.md')), true);
    assert.match(readFileSync(resolve(root, 'AGENTS.md'), 'utf8'), /ewai checkin/);
    assert.match(readFileSync(resolve(root, 'CLAUDE.md'), 'utf8'), /explicit yes/);
    assert.match(readFileSync(resolve(root, 'CLAUDE.md'), 'utf8'), /generic plan mode as a substitute/);
    assert.match(readFileSync(resolve(root, 'AGENTS.md'), 'utf8'), /\[6\] Continue a piece of work/);
    assert.match(readFileSync(resolve(root, 'CLAUDE.md'), 'utf8'), /response format is mandatory/i);
    assert.match(readFileSync(resolve(root, 'CLAUDE.md'), 'utf8'), /narrative-only (?:session )?opening is invalid/i);
    assert.match(readFileSync(resolve(root, 'CLAUDE.md'), 'utf8'), /every returned action in order as/);
    assert.equal(existsSync(resolve(root, 'GEMINI.md')), false);
    assert.equal(existsSync(resolve(root, '.ewai-pipeline/data/pipeline.sqlite')), true);
    assert.match(readFileSync(resolve(root, '.mcp.json'), 'utf8'), /"ewai"/);
    assert.match(readFileSync(resolve(root, '.claude/settings.json'), 'utf8'), /ewai checkin --project \. --json/);
    assert.match(readFileSync(resolve(root, '.agents/mcp_config.json'), 'utf8'), /"ewai"/);
    assert.match(readFileSync(resolve(root, '.codex/config.toml'), 'utf8'), /\[mcp_servers\.ewai\]/);
    assert.equal(doctorProject(root).every((check) => check.status === 'pass'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('supports a dedicated SPECS repository inside a multi-repository workspace', () => {
  const workspace = mkdtempSync(resolve(tmpdir(), 'ewai-multi-workspace-'));
  try {
    const api = resolve(workspace, 'services/api');
    mkdirSync(resolve(api, '.git'), { recursive: true });
    const result = initProject(workspace, {
      name: 'Multi Repository Product',
      specsRoot: 'project-knowledge/SPECS',
      initSpecsRepository: true,
    });
    const { config, paths } = loadProjectConfig(workspace);
    const intent = createIntent(workspace, { slug: 'shared-truth', domain: 'platform', title: 'Shared Truth' });
    const locator = JSON.parse(readFileSync(resolve(workspace, '.ewai-pipeline/project.json'), 'utf8'));

    assert.equal(result.specsRelative, 'project-knowledge/SPECS');
    assert.equal(result.specsRepositoryInitialized, resolve(workspace, 'project-knowledge'));
    assert.equal(existsSync(resolve(workspace, 'project-knowledge/.git')), true);
    assert.equal(config.specs.root, 'project-knowledge/SPECS');
    assert.deepEqual(config.repositories[0], {
      name: 'knowledge', path: 'project-knowledge', role: 'knowledge-and-delivery',
    });
    assert.equal(locator.specsRoot, 'project-knowledge/SPECS');
    assert.equal(paths.specsRoot, resolve(workspace, 'project-knowledge/SPECS'));
    assert.equal(existsSync(resolve(workspace, 'SPECS')), false);
    assert.equal(intent.path.startsWith(resolve(workspace, 'project-knowledge/SPECS/2.Purpose/intents')), true);
    assert.equal(resolveProjectRoot(api), realpathSync(workspace));
    assert.equal(doctorProject(workspace).every((check) => check.status === 'pass'), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('merges MCP host configuration without discarding project settings', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-mcp-config-'));
  try {
    mkdirSync(resolve(root, '.agents'), { recursive: true });
    mkdirSync(resolve(root, '.codex'), { recursive: true });
    writeFileSync(resolve(root, '.mcp.json'), '{"mcpServers":{"existing":{"command":"existing"}},"custom":true}\n');
    mkdirSync(resolve(root, '.claude'), { recursive: true });
    writeFileSync(resolve(root, '.claude/settings.json'), JSON.stringify({
      theme: 'dark',
      hooks: {
        SessionStart: [{
          matcher: 'startup',
          hooks: [
            { type: 'command', command: 'existing-session-hook' },
            { type: 'command', command: 'ewai checkin --project . --json' }
          ]
        }]
      }
    }));
    writeFileSync(resolve(root, '.agents/mcp_config.json'), '{"mcpServers":{"existing":{"command":"existing"}},"custom":true}\n');
    writeFileSync(resolve(root, '.codex/config.toml'), 'model = "project-model"\n');

    initProject(root, { name: 'MCP Merge Test' });

    const claude = JSON.parse(readFileSync(resolve(root, '.mcp.json'), 'utf8'));
    const claudeSettings = JSON.parse(readFileSync(resolve(root, '.claude/settings.json'), 'utf8'));
    const antigravity = JSON.parse(readFileSync(resolve(root, '.agents/mcp_config.json'), 'utf8'));
    const codex = readFileSync(resolve(root, '.codex/config.toml'), 'utf8');
    assert.equal(claude.custom, true);
    assert.equal(claude.mcpServers.existing.command, 'existing');
    assert.equal(claude.mcpServers.ewai.command, 'ewai');
    assert.equal(claudeSettings.theme, 'dark');
    assert.equal(claudeSettings.hooks.SessionStart[0].hooks[0].command, 'existing-session-hook');
    assert.equal(claudeSettings.hooks.SessionStart[1].hooks[0].command, 'ewai checkin --project . --json');
    assert.equal(antigravity.custom, true);
    assert.equal(antigravity.mcpServers.existing.command, 'existing');
    assert.equal(antigravity.mcpServers.ewai.command, 'ewai');
    assert.match(codex, /model = "project-model"/);
    assert.equal((codex.match(/# EWAI-MCP:START/g) ?? []).length, 1);

    initProject(root, { name: 'MCP Merge Test' });
    assert.equal((readFileSync(resolve(root, '.codex/config.toml'), 'utf8').match(/# EWAI-MCP:START/g) ?? []).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does not overwrite an existing project contract without force', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-preserve-'));
  try {
    initProject(root, { name: 'Original' });
    const configPath = resolve(root, 'SPECS/pipeline.yaml');
    writeFileSync(configPath, `${readFileSync(configPath, 'utf8')}\ncustom: true\n`);
    initProject(root, { name: 'Replacement' });
    assert.match(readFileSync(configPath, 'utf8'), /custom: true/);
    assert.match(readFileSync(configPath, 'utf8'), /Original/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refreshes managed check-in instructions without replacing project-authored guidance', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-checkin-instructions-'));
  try {
    initProject(root, { name: 'Instruction Test' });
    const path = resolve(root, 'AGENTS.md');
    const original = readFileSync(path, 'utf8');
    writeFileSync(path, `# Project guidance\n\nKeep this.\n\n${original.replace('pipeline dashboard', 'old dashboard')}\n`);

    initProject(root, { name: 'Instruction Test' });

    const refreshed = readFileSync(path, 'utf8');
    assert.match(refreshed, /Keep this\./);
    assert.match(refreshed, /project-local pipeline dashboard/);
    assert.doesNotMatch(refreshed, /old dashboard/);
    assert.equal((refreshed.match(/EWAI-CHECKIN:START/g) ?? []).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('removes only the legacy EWAI block from an existing GEMINI.md', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-gemini-retirement-'));
  try {
    initProject(root, { name: 'Legacy Gemini Project' });
    const agentsBlock = readFileSync(resolve(root, 'AGENTS.md'), 'utf8');
    writeFileSync(
      resolve(root, 'GEMINI.md'),
      `# Project-specific Gemini notes\n\nKeep this guidance.\n\n${agentsBlock}\n\nKeep this trailing guidance.\n`,
    );

    initProject(root, { name: 'Legacy Gemini Project' });

    const legacy = readFileSync(resolve(root, 'GEMINI.md'), 'utf8');
    assert.match(legacy, /Keep this guidance/);
    assert.match(legacy, /Keep this trailing guidance/);
    assert.doesNotMatch(legacy, /EWAI-CHECKIN/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('requires a human project briefing before archaeology for an existing codebase', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-existing-code-'));
  try {
    mkdirSync(resolve(root, 'src'));
    writeFileSync(resolve(root, 'package.json'), '{"name":"existing-product"}\n');
    writeFileSync(resolve(root, 'src/index.ts'), 'export const existing = true;\n');

    const result = initProject(root, { name: 'Existing Product' });

    assert.equal(result.onboarding.existingCodebase, true);
    assert.equal(result.onboarding.recommendedNextStep, 'project-briefing');
    assert.equal(result.onboarding.skill, 'ewai-project-discovery');
    assert.match(result.onboarding.prompt, /\$ewai-project-discovery/);
    assert.match(result.onboarding.afterBrief, /\$ewai-archaeology/);
    assert.match(result.onboarding.afterBrief, /confirmed project briefing/);
    assert.equal(result.onboarding.archaeology.optional, true);
    assert.equal(result.onboarding.archaeology.declineCommand, result.onboarding.afterReview);
    assert.match(result.onboarding.afterBrief, /only if the user accepts/);
    assert.equal(result.onboarding.evidence.includes('package.json'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('recommends discovery when initialising a fresh project', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-fresh-project-'));
  try {
    const result = initProject(root, { name: 'Fresh Product' });
    assert.equal(result.onboarding.existingCodebase, false);
    assert.equal(result.onboarding.recommendedNextStep, 'discovery');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
