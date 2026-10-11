import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDistillable } from './distill.mjs';
import {
  claimCard,
  fileContext,
  formatFileCard,
  formatSessionCard,
  recordAdoption,
  sessionContext
} from './repository-context.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const ewaiBin = resolve(moduleDir, '../../bin/ewai');
const checkinCommand = 'ewai checkin --project . --json';
export const sessionCommand = 'ewai context session --project .';
const toolCommand = 'ewai context tool --project .';
const distillCommand = 'ewai context distill --project .';
const startMarker = '# EWAI-INDEX:START';
const endMarker = '# EWAI-INDEX:END';

function commandHook(command) {
  return { type: 'command', command, timeout: 15 };
}

function entryHas(entry, command) {
  return Array.isArray(entry?.hooks) && entry.hooks.some((hook) => hook?.command === command);
}

function withoutCommand(list, command) {
  return (Array.isArray(list) ? list : []).filter((entry) => !entryHas(entry, command));
}

export function installEditorHooks(projectRoot) {
  const settingsPath = resolve(projectRoot, '.claude/settings.json');
  const existingText = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : null;
  let config = {};
  if (existingText !== null) config = JSON.parse(existingText);
  config.hooks ??= {};
  const session = withoutCommand(config.hooks.SessionStart, sessionCommand);
  const checkin = session.filter((entry) => entryHas(entry, checkinCommand));
  const other = session.filter((entry) => !entryHas(entry, checkinCommand));
  config.hooks.SessionStart = [
    ...other,
    ...checkin,
    {
      matcher: 'startup|resume|clear|compact',
      hooks: [commandHook(sessionCommand)]
    }
  ];
  config.hooks.PostToolUse = [
    ...withoutCommand(config.hooks.PostToolUse, toolCommand),
    { matcher: 'Read|Edit|Write|Grep', hooks: [commandHook(toolCommand)] }
  ];
  config.hooks.PreToolUse = [
    ...withoutCommand(config.hooks.PreToolUse, distillCommand),
    { matcher: 'Bash', hooks: [commandHook(distillCommand)] }
  ];
  const next = `${JSON.stringify(config, null, 2)}\n`;
  if (next !== existingText) {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, next);
  }
  return {
    schema: 'ewai.editor-hooks/v1',
    claude: settingsPath,
    git: installGitIndexHook(projectRoot)
  };
}

function hookBlock(projectRoot) {
  const node = process.execPath.replaceAll('"', '');
  const bin = ewaiBin.replaceAll('"', '');
  const root = projectRoot.replaceAll('"', '');
  return [
    startMarker,
    '# Refresh the repository index after this commit. A failure does not undo the commit.',
    `( "${node}" "${bin}" index update --project "${root}" >/dev/null 2>&1 & )`,
    endMarker
  ].join('\n');
}

export function installGitIndexHook(projectRoot) {
  const gitDir = resolve(projectRoot, '.git');
  if (!existsSync(gitDir) || !lstatSync(gitDir).isDirectory()) return '';
  const path = resolve(gitDir, 'hooks/post-commit');
  mkdirSync(dirname(path), { recursive: true });
  const block = hookBlock(projectRoot);
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '#!/bin/sh\n';
  let next = existing;
  if (existing.includes(startMarker) && existing.includes(endMarker)) {
    next = `${existing.slice(0, existing.indexOf(startMarker))}${block}${existing.slice(existing.indexOf(endMarker) + endMarker.length)}`;
  } else {
    next = `${existing.endsWith('\n') || !existing ? existing : `${existing}\n`}${block}\n`;
  }
  if (!next.startsWith('#!')) next = `#!/bin/sh\n${next}`;
  writeFileSync(path, next.endsWith('\n') ? next : `${next}\n`);
  chmodSync(path, 0o755);
  return path;
}

export function sessionHook(projectRoot) {
  try {
    const card = formatSessionCard(sessionContext(projectRoot));
    recordAdoption(projectRoot, 'sessionCards');
    return card;
  } catch {
    return '';
  }
}

export function toolHook(projectRoot, input = {}) {
  try {
    const tool = input.tool_name || input.toolName || '';
    if (!['Read', 'Edit', 'Write', 'Grep'].includes(tool)) return '';
    const file = input.tool_input?.file_path || input.tool_input?.path || '';
    if (!file) return '';
    const key = `file:${file}`;
    if (!claimCard(projectRoot, key)) {
      recordAdoption(projectRoot, 'suppressedRepeats');
      return '';
    }
    recordAdoption(projectRoot, 'fileCards');
    return formatFileCard(fileContext(projectRoot, file));
  } catch {
    return '';
  }
}

export function distillHook(input = {}) {
  try {
    if (process.env.EWAI_DISTILL === '0') return '';
    const command = String(input.tool_input?.command ?? '');
    if (!command || !isDistillable(command)) return '';
    if (/ewai\s+distill|\bindex\s+update\b|\bindex\s+context\b|\bcontext\s+(?:distill|file|session|tool)\b/.test(command)) return '';
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: { command: `ewai distill --project . -- ${command}` }
      }
    });
  } catch {
    return '';
  }
}
