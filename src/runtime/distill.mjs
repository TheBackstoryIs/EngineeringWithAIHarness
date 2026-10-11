import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectPaths } from '../paths.mjs';
import { recordAdoption } from './repository-context.mjs';

const recognised = /(?:^|[^\w])(?:git\s+(?:diff|log)|pest|phpunit|artisan\s+test|vitest|playwright|jest|pytest|go\s+test|cargo\s+test|rspec|dotnet\s+test)(?:\s|$)/i;

export function commandFamily(commandArgs) {
  const command = commandArgs.join(' ');
  if (/\bgit\s+diff\b/i.test(command)) return 'git-diff';
  if (/\bgit\s+log\b/i.test(command)) return 'git-log';
  if (/(pest|phpunit|artisan\s+test|vitest|playwright|jest|pytest|go\s+test|cargo\s+test|rspec|dotnet\s+test)/i.test(command)) return 'tests';
  return 'unknown';
}

export function isDistillable(command) {
  return recognised.test(String(command ?? ''));
}

function keepTestLine(line) {
  return /fail|error|expected|assert|not ok|✕|⨯|×|warning|tests:|failures|there (?:was|were)/i.test(line);
}

export function shortenCommandOutput(commandArgs, stdout, stderr, exitCode) {
  const family = commandFamily(commandArgs);
  const combined = `${stdout ?? ''}${stderr ? `${stdout ? '\n' : ''}${stderr}` : ''}`;
  const lines = combined.split(/\r?\n/);
  if (family === 'git-diff') {
    return lines.filter((line) => !line.startsWith(' ') || line.startsWith('---') || line.startsWith('+++')).slice(0, 220).join('\n');
  }
  if (family === 'git-log') {
    const kept = [];
    let subjectTaken = false;
    for (const line of lines) {
      if (/^commit |^Author:|^Date:/.test(line)) {
        kept.push(line);
        subjectTaken = false;
        continue;
      }
      if (!subjectTaken && line.startsWith('    ') && line.trim()) {
        kept.push(line);
        subjectTaken = true;
      }
    }
    return kept.slice(0, 160).join('\n');
  }
  if (family === 'tests') {
    const pass = (line) => /\bPASS\b|\bpass\b/.test(line) && !keepTestLine(line);
    const failures = lines.filter((line) => keepTestLine(line) && !pass(line));
    const summary = lines.slice(-12).filter((line) => line.trim() && !pass(line));
    const body = exitCode === 0 ? summary : [...failures, ...summary.filter((line) => !failures.includes(line))];
    return [...new Set(body)].slice(0, 180).join('\n');
  }
  if (combined.length <= 12000) return combined;
  return `${combined.slice(0, 6000)}\n…\n${combined.slice(-3000)}`;
}

export function runDistill(projectRoot, commandArgs) {
  if (!commandArgs.length) {
    const error = new Error('distill requires a command after --');
    error.statusCode = 400;
    throw error;
  }
  return new Promise((resolvePromise) => {
    const child = spawn(commandArgs[0], commandArgs.slice(1), {
      cwd: projectRoot,
      env: process.env,
      shell: false
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      resolvePromise(finish(projectRoot, commandArgs, '', error.message, 127));
    });
    child.on('close', (code) => {
      resolvePromise(finish(projectRoot, commandArgs, stdout, stderr, code ?? 1));
    });
  });
}

function finish(projectRoot, commandArgs, stdout, stderr, exitCode) {
  const paths = projectPaths(projectRoot);
  const directory = resolve(paths.runtimeRoot, 'runtime/command-logs');
  mkdirSync(directory, { recursive: true });
  const id = randomUUID();
  const logPath = resolve(directory, `${id}.log`);
  writeFileSync(logPath, `command: ${commandArgs.join(' ')}\nexit: ${exitCode}\n\n${stdout}${stderr ? `\n${stderr}` : ''}`);
  const fullLog = relative(projectRoot, logPath);
  try { recordAdoption(projectRoot, 'distillRuns'); } catch { /* adoption is observational */ }
  const reading = shortenCommandOutput(commandArgs, stdout, stderr, exitCode);
  const transcript = [
    'EWAI command reading',
    `exit: ${exitCode}`,
    `full_log: ${fullLog}`,
    'Hash the full log when this command is gate evidence. This reading is shorter.',
    '---',
    reading
  ].join('\n');
  return { exitCode, fullLog, transcript };
}
