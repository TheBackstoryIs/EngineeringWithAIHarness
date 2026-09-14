import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { install } from './install.mjs';
import { detectExistingCodebase } from './project.mjs';
import { projectPaths, resolveProjectRoot } from './paths.mjs';
import { dashboardHandoffStatus } from './runtime/dashboard-handoffs.mjs';

const HOSTS = ['claude', 'codex', 'antigravity'];
const HOST_LABELS = {
  claude: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Google Antigravity'
};
const HOST_COMMANDS = {
  claude: 'claude',
  codex: 'codex',
  antigravity: 'agy',
};

function projectState(start) {
  let projectRoot;
  try {
    projectRoot = resolveProjectRoot(start);
  } catch {
    projectRoot = resolve(start);
  }

  const initialized = existsSync(projectPaths(projectRoot).configPath);
  const existingCodebase = detectExistingCodebase(projectRoot).detected;
  const handoffState = initialized
    ? dashboardHandoffStatus(projectRoot)
    : { status: 'not-initialized', handoffs: [], error: null };
  return {
    projectRoot,
    initialized,
    existingCodebase,
    dashboardHandoff: handoffState.handoffs[0] ?? null,
    dashboardHandoffError: handoffState.error,
  };
}

export function companionStartupPlan(state) {
  return { schema: 'ewai.companion-startup/v1', mode: state.initialized ? 'session' : 'onboarding',
    steps: state.initialized ? ['check-in', 'opening', 'selected-action'] : [
      'location-agreement', 'initialise', 'check-in', 'premium-personas', 'human-briefing', 'context-import',
      ...(state.existingCodebase ? ['offer-archaeology'] : []),
      'discovery', 'doctor', 'opening'
    ],
    archaeology: !state.initialized && state.existingCodebase ? { optional: true,
      question: 'Would you like us to analyse the existing code and reconstruct its missing project documentation?',
      onAccept: ['archaeology', 'review-and-curate'], onDecline: 'discovery' } : null,
    flexibility: ['agreed knowledge location', 'optional context import', 'optional premium access', 'optional archaeology', 'human-owned deferral'],
    safeguards: ['briefing before deep analysis', 'explicit download consent', 'review before promotion', 'complete delivery gates'] };
}

export function buildCompanionPrompt(state) {
  const contributionReview = state.dashboardHandoff?.action === 'review-contribution';
  const startup = companionStartupPlan(state);
  return [
    'Use $ewai-pipeline to open the EWAI companion for this project.',
    'Follow its companion opening contract completely and keep setup inside this AI conversation.',
    `Project root: ${state.projectRoot}`,
    `EWAI initialized: ${state.initialized ? 'yes' : 'no'}`,
    `Existing codebase detected: ${state.existingCodebase ? 'yes' : 'no'}`,
    `EWAI orchestrator: ${state.orchestrator ?? 'manual'}`,
    state.dashboardHandoff
      ? `Dashboard handoff: ${state.dashboardHandoff.action} ${state.dashboardHandoff.intentId} at ${state.dashboardHandoff.phase || 'the next verified phase'} (handoff ${state.dashboardHandoff.id}; authority ${state.dashboardHandoff.authority ?? (contributionReview ? 'none' : 'guarded')})`
      : state.dashboardHandoffError ? `Dashboard handoff: unavailable (${state.dashboardHandoffError})` : 'Dashboard handoff: none',
    'Do not ask the user to copy or run CLI commands.',
    `KNOWN STARTUP PATH: ${startup.steps.join(' -> ')}. Follow it without dumping the checklist to the user. Preserve agreed knowledge location, optional persona access/context import and human-owned deferral; do not silently skip a checkpoint.`,
    '- Premium personas: inspect access and the installed index, load available installed lenses, and settle chosen private setup or explicitly approved installation before deeper analysis. A session check never downloads implicitly. For existing code, always offer optional Archaeology after human briefing and optional context import; explain its value and wait for acceptance. Only if accepted, run Archaeology and review-and-curate its proposals before confirmed Discovery and Doctor. If declined, continue to Discovery and Doctor without reconstruction; Archaeology remains available later. New code follows briefing/context then Discovery. Show the early dashboard link while onboarding continues; folder readiness is not completed analysis.',
    state.initialized
      ? 'STARTUP ROUTE: run one check-in for the resolved project, or reuse this launch’s managed hook result. Do not reinitialise or repeat first-run onboarding.'
      : 'INITIALISATION BEFORE CHECK-IN: ask one location question recommending SPECS in this folder for a single repository/monorepo; for independent repositories recommend a dedicated knowledge repository. After agreement run ewai init --project <resolved-root> --json with the agreed --specs path, and --init-specs-repo only when approved. Do not investigate EWAI before running init. Do not show invented check-in status or a session menu before initialisation.',
    'Do not inspect the installed EWAI source during routine startup. Do not run ewai --version: version/update status comes from check-in. Use the CLI and returned contracts; investigate implementation only when a specific unresolved failure needs diagnosis.',
    'Use $ewai-persona-entitlement only when setup is chosen. The guarded dashboard password form is the default; a private terminal prompt is an alternative only when a genuine interactive terminal is available. Never ask for the licence key in chat or arguments. Submission verifies and installs immediately; confirm the installed version and refresh the persona index before using the pack.',
    '- After successful first initialisation, offer the returned onboarding.personaLearning question before deeper analysis or Archaeology, for both new and existing code. Respect a decline, retain the human briefing and purpose alignment, and do not repeat first-run onboarding in an already initialised session.',
    'Never use the host AI generic plan mode for intent delivery; use $ewai-deliver and its guarded resume state.',
    'MANDATORY FIRST-RESPONSE PRESENTATION CONTRACT:',
    '- For a fresh folder, the first response is the single location question, not the session menu. After agreement initialise promptly, show compact check-in readiness, then follow the known onboarding path one decision at a time. Keep the human project briefing and purpose alignment; do not replace them with inferred code behaviour. The normal session menu follows onboarding or an explicit human-owned deferral.',
    '- Keep the session status to four routine lines, followed by the returned menu and one question. Preserve warnings, blockers, unknown checks and mandatory standards; expand technical details only on request. Routine progress is one sentence of at most 24 words per meaningful checkpoint. Do not narrate commands, file reads, JSON parsing, internal policies or reasoning. Do not repeat the menu during a selected action.',
    '- A narrative-only opening is invalid.',
    '- After check-in status, render the heading and every numbered action returned in checkin.companion, in order.',
    '- Render each action exactly as `[id] label`; do not replace the menu with prose or recommendations.',
    '- When any intent or delivery state exists, the returned menu includes `[6] Continue a piece of work`; never omit it.',
    '- Include `[7] Read about premium personas` and `[8] Set up premium personas` only when returned by check-in. Both are absent when premium access is available and the installed pack is verified. Learning opens https://www.conversationalcoding.dev/personas/ without purchasing, activating or downloading content.',
    '- Chosen premium setup verifies and installs on explicit private key submission. Resolve it and refresh installed persona routing before Archaeology; after failure offer retry or explicit core-only continuation, preserving briefing and purpose alignment. Licence management remains available in dashboard Configuration.',
    '- Always render the returned `[9] Configure the dashboard` action. Use $ewai-dashboard-configuration for explicit project-local view choices; hiding views never disables required checks or approvals.',
    '- When checkin.companion.personaSetup is present, ask its exact optional setup question after the menu and before the closing prompt. Offer private setup, reading first, or core use; do not invent this question for expired, invalid or unavailable configured licences.',
    contributionReview
      ? '- A contribution-review handoff is pending. Identify it immediately after the numbered menu. Treat “go” as confirmation to claim it, use $ewai-phase-evidence, preserve authority none, and mark it completed only after advisory feedback is returned. Do not invoke $ewai-deliver or mutate delivery state for this review.'
      : '- If a delivery dashboard handoff is pending, identify that intent immediately after the numbered menu. Treat “go” as selecting it and confirmation to claim it, then use $ewai-deliver; never substitute the host generic plan mode.',
    '- End the opening with the exact line `What\'s on your mind?`.',
    state.initialized
      ? '- Do not finish the first response until both check-in status and the numbered menu are visible.'
      : '- After initialisation show concise readiness and continue onboarding. The numbered session-opening contract applies once onboarding is complete or explicitly deferred by the owner. Offer setup/learning without duplicating an already answered question.'
  ].join('\n');
}

export function hostInvocation(host, prompt) {
  if (host === 'claude') return { command: 'claude', args: [prompt] };
  if (host === 'codex') return { command: 'codex', args: [prompt] };
  if (host === 'antigravity') return { command: 'agy', args: ['--prompt-interactive', prompt] };
  throw new Error(`Unsupported EWAI agent host: ${host}`);
}

function probeHost(host, env) {
  const command = HOST_COMMANDS[host];
  const result = spawnSync(command, ['--version'], { env, stdio: 'ignore', timeout: 3000 });
  if (!result.error && result.status === 0) return { available: true, reason: '' };
  if (result.error?.code === 'ENOENT') {
    return { available: false, reason: `\`${command}\` command not found on this terminal PATH` };
  }
  if (result.error?.code === 'ETIMEDOUT') {
    return { available: false, reason: `\`${command} --version\` timed out` };
  }
  return { available: false, reason: `\`${command} --version\` did not complete successfully` };
}

export function detectHostStatuses(options = {}) {
  const env = options.env ?? process.env;
  const probe = options.probe ?? ((host) => probeHost(host, env));
  return (options.hosts ?? HOSTS).map((host) => {
    const result = probe(host);
    const normalized = typeof result === 'boolean'
      ? { available: result, reason: result ? '' : `\`${host}\` command is not available in this terminal` }
      : result;
    return {
      host,
      label: HOST_LABELS[host],
      available: normalized.available === true,
      reason: normalized.reason ?? ''
    };
  });
}

export function detectAvailableHosts(options = {}) {
  return detectHostStatuses(options).filter((item) => item.available).map((item) => item.host);
}

export function formatHostAvailability(statuses) {
  const available = statuses.filter((item) => item.available);
  const unavailable = statuses.filter((item) => !item.available);
  const lines = ['AI hosts available to EWAI:'];
  if (available.length) {
    available.forEach((item, index) => lines.push(`  ${index + 1}. ${item.label}`));
  } else {
    lines.push('  None');
  }
  if (unavailable.length) {
    lines.push('', 'Not available in this terminal:');
    unavailable.forEach((item) => lines.push(`  • ${item.label} — ${item.reason}`));
  }
  return lines.join('\n');
}

export function selectAvailableHost(available, preferred) {
  if (preferred && available.includes(preferred)) return preferred;
  return available.length === 1 ? available[0] : null;
}

export function refreshHostSkills(host, options = {}) {
  return install({
    scope: 'global',
    host,
    home: options.home,
    mode: 'copy',
    force: true,
    installBin: false
  });
}

async function askForHost(available, io) {
  if (!io.input.isTTY || !io.output.isTTY) return null;
  const prompt = createInterface({ input: io.input, output: io.output });
  try {
    io.output.write('\nChoose the AI you want EWAI to open.\n');
    while (true) {
      const answer = (await prompt.question('Host: ')).trim();
      const index = Number.parseInt(answer, 10) - 1;
      if (available[index]) return available[index];
      io.output.write(`Choose 1-${available.length}.\n`);
    }
  } finally {
    prompt.close();
  }
}

function spawnInteractive(invocation, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: 'inherit'
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${invocation.command} exited after signal ${signal}`));
      else resolvePromise(code ?? 1);
    });
  });
}

export async function runCompanion(options = {}) {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const errorOutput = options.errorOutput ?? process.stderr;
  const env = options.env ?? process.env;
  const state = projectState(options.cwd ?? process.cwd());
  const preferredValue = String(options.preferredHost ?? env.EWAI_HOST ?? '').toLowerCase();
  const preferred = preferredValue === 'agy' ? 'antigravity' : preferredValue;
  const preferredStatuses = HOSTS.includes(preferred)
    ? detectHostStatuses({ env, probe: options.probeHost, hosts: [preferred] }) : [];
  const statuses = preferredStatuses[0]?.available ? preferredStatuses
    : detectHostStatuses({ env, probe: options.probeHost });
  const available = statuses.filter((item) => item.available).map((item) => item.host);
  if (options.verbose || !available.length) output.write(`${formatHostAvailability(statuses)}\n`);

  if (!available.length) {
    errorOutput.write([
      'EWAI cannot open an AI conversation because no supported CLI is available.',
      'Install or activate one supported AI CLI, then run `ewai` again.',
      'Use `ewai --help` only for automation and diagnostic commands.',
      ''
    ].join('\n'));
    return 1;
  }

  let host = selectAvailableHost(available, preferred);
  if (!host && available.length > 1) {
    if (!options.verbose) output.write(`${formatHostAvailability(statuses)}\n`);
    host = await askForHost(available, { input, output });
  }
  if (!host) {
    errorOutput.write(`EWAI found ${available.map((item) => HOST_LABELS[item]).join(', ')}, but cannot choose interactively in this session. Set EWAI_HOST to claude, codex, or antigravity.\n`);
    return 1;
  }

  const prepareHost = options.prepareHost ?? ((selectedHost) => refreshHostSkills(selectedHost));
  try {
    await prepareHost(host);
  } catch (error) {
    errorOutput.write(`EWAI could not prepare its companion skills for ${HOST_LABELS[host]}: ${error.message}\n`);
    errorOutput.write('Check that your user account can write to the AI host skill directory, then run `ewai` again.\n');
    return 1;
  }

  output.write(`EWAI · ${basename(state.projectRoot)} → ${HOST_LABELS[host]}\n`);
  const orchestratedState = { ...state, orchestrator: host, startup: companionStartupPlan(state) };
  const invocation = hostInvocation(host, buildCompanionPrompt(orchestratedState));
  const hostEnv = { ...env, EWAI_ORCHESTRATOR: host };
  const launch = options.spawnHost ?? ((value) => spawnInteractive(value, { cwd: state.projectRoot, env: hostEnv }));
  return launch(invocation, orchestratedState);
}
