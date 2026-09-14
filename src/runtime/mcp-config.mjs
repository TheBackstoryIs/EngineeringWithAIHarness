import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const codexStart = '# EWAI-MCP:START';
const codexEnd = '# EWAI-MCP:END';

function writeJsonConfig(path, apply) {
  let config = {};
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (existsSync(path)) {
    try {
      config = JSON.parse(existing);
    } catch (error) {
      throw new Error(`Cannot safely update invalid JSON configuration ${path}: ${error.message}`);
    }
  }
  const before = JSON.stringify(config);
  apply(config);
  if (existing !== null && JSON.stringify(config) === before) return path;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return path;
}

function stdioDefinition(includeType = false) {
  return {
    ...(includeType ? { type: 'stdio' } : {}),
    command: 'ewai',
    args: ['mcp', '--project', '.']
  };
}

function configureClaude(projectRoot) {
  return writeJsonConfig(resolve(projectRoot, '.mcp.json'), (config) => {
    config.mcpServers ??= {};
    config.mcpServers.ewai = stdioDefinition(true);
  });
}

function configureClaudeSessionStart(projectRoot) {
  return writeJsonConfig(resolve(projectRoot, '.claude/settings.json'), (config) => {
    config.hooks ??= {};
    const managed = {
      matcher: 'startup|resume|clear|compact',
      hooks: [{
        type: 'command',
        command: 'ewai checkin --project . --json',
        timeout: 30,
        statusMessage: 'Opening the EWAI project companion…'
      }]
    };
    const existing = Array.isArray(config.hooks.SessionStart) ? config.hooks.SessionStart : [];
    const command = managed.hooks[0].command;
    const retained = existing
      .map((entry) => {
        if (!Array.isArray(entry?.hooks)) return entry;
        const hooks = entry.hooks.filter((hook) => hook?.command !== command);
        if (hooks.length === entry.hooks.length) return entry;
        return hooks.length ? { ...entry, hooks } : null;
      })
      .filter(Boolean);
    config.hooks.SessionStart = [
      ...retained,
      managed
    ];
  });
}

function configureAntigravity(projectRoot) {
  return writeJsonConfig(resolve(projectRoot, '.agents/mcp_config.json'), (config) => {
    config.mcpServers ??= {};
    config.mcpServers.ewai = stdioDefinition();
  });
}

function configureCodex(projectRoot) {
  const path = resolve(projectRoot, '.codex/config.toml');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const withoutManaged = existing.includes(codexStart) && existing.includes(codexEnd)
    ? `${existing.slice(0, existing.indexOf(codexStart))}${existing.slice(existing.indexOf(codexEnd) + codexEnd.length)}`.trim()
    : existing.trim();
  const managed = `${codexStart}
[mcp_servers.ewai]
command = "ewai"
args = ["mcp", "--project", "."]
cwd = "."
startup_timeout_sec = 20
default_tools_approval_mode = "writes"
${codexEnd}`;
  const updated = `${withoutManaged ? `${withoutManaged}\n\n` : ''}${managed}\n`;
  if (updated === existing) return path;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, updated, 'utf8');
  return path;
}

export function configureProjectMcp(projectRoot) {
  const root = resolve(projectRoot);
  return {
    schema: 'ewai.mcp-configuration/v1',
    transport: 'stdio',
    command: 'ewai mcp --project .',
    hosts: {
      codex: configureCodex(root),
      claude: configureClaude(root),
      antigravity: configureAntigravity(root)
    },
    hooks: { claude: configureClaudeSessionStart(root) }
  };
}
