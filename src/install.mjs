import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const installRoot = resolve(moduleDir, '..');
const skillSourceRoot = resolve(installRoot, 'skills-src');
const claudeAgentSourceRoot = resolve(installRoot, 'agents-src/claude');

function availableSkills() {
  return readdirSync(skillSourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(resolve(skillSourceRoot, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

function availableClaudeAgents() {
  if (!existsSync(claudeAgentSourceRoot)) return [];
  return readdirSync(claudeAgentSourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();
}

function selectedHosts(host, home) {
  if (host !== 'auto') return [host];
  const hosts = [];
  if (existsSync(resolve(home, '.codex'))) hosts.push('codex');
  if (existsSync(resolve(home, '.claude'))) hosts.push('claude');
  if (
    existsSync(resolve(home, '.gemini/antigravity-cli'))
    || existsSync(resolve(home, '.gemini/config'))
  ) hosts.push('antigravity');
  return hosts.length ? hosts : ['codex'];
}

function skillDestinationRoot({ scope, host, home, projectRoot }) {
  if (scope === 'project') {
    if (!projectRoot) throw new Error('Project installation requires projectRoot');
    return host === 'claude'
      ? resolve(projectRoot, '.claude/skills')
      : resolve(projectRoot, '.agents/skills');
  }
  return host === 'claude'
    ? resolve(home, '.claude/skills')
    : host === 'antigravity'
      ? resolve(home, '.gemini/config/skills')
      : resolve(home, '.codex/skills');
}

function installSkill(source, destination, mode, force) {
  if (existsSync(destination) || lstatExists(destination)) {
    if (!force) return { status: 'skipped', destination };
    rmSync(destination, { recursive: true, force: true });
  }

  mkdirSync(dirname(destination), { recursive: true });
  if (mode === 'link') {
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source)) {
      symlinkSync(resolve(source, entry), resolve(destination, entry));
    }
  } else {
    cpSync(source, destination, { recursive: true, force: false, errorOnExist: true });
  }
  return { status: 'installed', destination };
}

function installFile(source, destination, mode, force) {
  if (lstatExists(destination)) {
    if (!force) return { status: 'skipped', destination };
    rmSync(destination, { recursive: true, force: true });
  }

  mkdirSync(dirname(destination), { recursive: true });
  if (mode === 'link') symlinkSync(source, destination);
  else cpSync(source, destination, { force: false, errorOnExist: true });
  return { status: 'installed', destination };
}

function lstatExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

export function install(options = {}) {
  const scope = options.scope ?? 'global';
  const home = resolve(options.home ?? homedir());
  const mode = options.mode ?? 'copy';
  if (!['global', 'project'].includes(scope)) throw new Error(`Unsupported install scope: ${scope}`);
  if (!['copy', 'link'].includes(mode)) throw new Error(`Unsupported install mode: ${mode}`);

  const hosts = selectedHosts(options.host ?? 'auto', home);
  for (const host of hosts) {
    if (!['codex', 'claude', 'antigravity'].includes(host)) throw new Error(`Unsupported agent host: ${host}`);
  }

  const results = [];
  const agentResults = [];
  for (const host of hosts) {
    const destinationRoot = skillDestinationRoot({
      scope,
      host,
      home,
      projectRoot: options.projectRoot ? resolve(options.projectRoot) : ''
    });
    mkdirSync(destinationRoot, { recursive: true });
    for (const skill of availableSkills()) {
      const destination = resolve(destinationRoot, skill);
      results.push({
        host,
        skill,
        ...installSkill(
          resolve(skillSourceRoot, skill),
          destination,
          mode,
          Boolean(options.force)
        )
      });
    }
    if (host === 'claude') {
      const agentRoot = scope === 'project'
        ? resolve(options.projectRoot, '.claude/agents')
        : resolve(home, '.claude/agents');
      for (const agent of availableClaudeAgents()) {
        agentResults.push({
          host,
          agent: agent.slice(0, -3),
          ...installFile(
            resolve(claudeAgentSourceRoot, agent),
            resolve(agentRoot, agent),
            mode,
            Boolean(options.force)
          )
        });
      }
    }
  }

  if (scope === 'global' && options.installBin !== false) {
    const binDir = resolve(options.binDir ?? resolve(home, '.local/bin'));
    const destination = resolve(binDir, basename('ewai'));
    mkdirSync(binDir, { recursive: true });
    if (lstatExists(destination)) {
      if (options.force) rmSync(destination, { force: true });
      else return { scope, mode, hosts, skills: results, agents: agentResults, bin: { status: 'skipped', destination } };
    }
    symlinkSync(resolve(installRoot, 'bin/ewai'), destination);
    return { scope, mode, hosts, skills: results, agents: agentResults, bin: { status: 'installed', destination } };
  }

  return { scope, mode, hosts, skills: results, agents: agentResults };
}
