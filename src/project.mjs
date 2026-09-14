import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {normaliseDashboardPreferences} from './dashboard-preferences.mjs';
import { projectPaths } from './paths.mjs';
import { premiumPersonaLearningAction } from './companion-opening.mjs';
import { initializeRuntime } from './runtime/database.mjs';
import { configureProjectMcp } from './runtime/mcp-config.mjs';
import {
  VALIDATION_PROVIDERS,
  effectiveValidationConfig,
  normaliseValidationConfig,
  setValidationCheckpoint,
  setValidationProvider,
} from './validation-config.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const installRoot = resolve(moduleDir, '..');
const templateRoot = resolve(installRoot, 'templates/SPECS');
const codeManifestNames = new Set([
  'package.json',
  'composer.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Gemfile',
  'mix.exs'
]);
const codeExtensions = new Set([
  '.c', '.cc', '.cjs', '.cpp', '.cs', '.css', '.cts', '.dart', '.ex', '.exs', '.fs',
  '.fsx', '.go', '.h', '.hpp', '.html', '.java', '.js', '.jsx', '.kt', '.kts', '.lua',
  '.mjs', '.mts', '.php', '.py', '.r', '.rb', '.rs', '.scala', '.sh', '.swift', '.ts',
  '.tsx', '.vue'
]);
const ignoredCodeDirectories = new Set([
  '.git', '.ewai-pipeline', '.idea', '.vscode', 'SPECS', 'build', 'coverage', 'dist',
  'node_modules', 'target', 'vendor'
]);

const requiredDirectories = [
  '1.Scope/domain',
  '1.Scope/personas/core',
  '1.Scope/personas/project',
  '1.Scope/personas/overlays',
  '1.Scope/api',
  '1.Scope/research',
  '1.Scope/handoffs',
  '1.Scope/templates',
  '2.Purpose/intents',
  '2.Purpose/journeys',
  '2.Purpose/explorations',
  '2.Purpose/discussions',
  '2.Purpose/requirements/pending',
  '2.Purpose/requirements/deferred',
  '2.Purpose/requirements/satisfied',
  '3.Evidence/retros',
  '3.Evidence/postmortems',
  '3.Evidence/gates',
  '3.Evidence/iteration-logs',
  '3.Evidence/archaeology',
  '3.Evidence/context-imports',
  '3.Evidence/risk',
  '4.Constraints/compliance',
  '5.Strategy/architecture/schema',
  '5.Strategy/architecture/patterns',
  '5.Strategy/architecture/checklists',
  '5.Strategy/patterns',
  '5.Strategy/decisions',
  '5.Strategy/options',
  '5.Strategy/sops',
  '5.Strategy/runbooks',
  '5.Strategy/capsules',
  '6.Build'
];

const templateFiles = [
  ['pipeline.yaml', 'pipeline.yaml'],
  ['1.Scope/personas/registry.yaml', '1.Scope/personas/registry.yaml'],
  ['5.Strategy/patterns/context-packet.md', '5.Strategy/patterns/context-packet.md'],
  ['6.Build/_tracker-template.md', '6.Build/_tracker-template.md']
];

const checkinInstructionFiles = ['AGENTS.md', 'CLAUDE.md'];
const checkinInstruction = `<!-- EWAI-CHECKIN:START -->
## EWAI conversation check-in

Keep the complete workflow, but present it cleanly: four routine status lines plus the returned menu at a decision point. Preserve warnings, blockers and unknown checks with short reasons; detailed diagnostics are on request. Progress is one sentence of at most 24 words per meaningful checkpoint. Do not narrate commands, file reads, JSON parsing or internal reasoning, and do not repeat the menu during a selected action. Never shorten briefing, purpose alignment, consent, standards or approval gates to meet an output limit. Use the guarded dashboard password form by default for licence setup; a private terminal prompt is an alternative only when a genuine interactive terminal is available. Never emulate hidden terminal entry through chat.

When \`.ewai-pipeline/project.json\` exists, perform one EWAI check-in at the start of each new agent conversation before substantive project work. That locator identifies the configured SPECS root; do not assume it is \`./SPECS\`. Claude may receive its check-in JSON from the managed SessionStart hook; interpret that result instead of running it twice. Otherwise run \`ewai checkin --project . --json\`. This starts or reuses the project-local pipeline dashboard and refreshes its SQLite projection. Always interpret and report the EWAI version/update status, premium entitlement and installed-library status, dashboard URL, state-integrity result, mandatory standards status, configured external validators, and any configured-versus-installed CLI mismatch. Show unknown checks with their reason rather than omitting them.

The harness is installed and updated only through npm. Offer only its returned npm update action; never inspect, fetch, or pull a source repository to update EWAI.

For returning sessions, or after onboarding is complete or explicitly deferred by the owner, read recent work and render the structured \`companion\` opening returned by EWAI. **This response format is mandatory at that decision point.** A narrative-only session opening is invalid. Report the check-in status first, then render the returned heading and every returned action in order as \`[id] label\`. Do not replace the numbered menu with prose, recommendations, or a generic question. End with the exact returned closing prompt: **What's on your mind?** Do not finish that session opening until both the status and menu are visible. During first-run onboarding, continue the known startup path instead: settle chosen persona setup, human briefing and optional context import, then offer Archaeology for existing code, followed by Discovery and Doctor. Archaeology is optional: always offer it for existing code, explain that it can reconstruct missing documentation, and wait for acceptance before running it. Review and curate its findings only if accepted; if declined, continue to Discovery without reconstruction and leave Archaeology available later. Show the dashboard link early, but do not interrupt onboarding with the session menu or call the project ready before the chosen steps finish. Only the owner can defer onboarding.

When intent or delivery work exists, the menu must include **[6] Continue a piece of work**. If the user chooses it, use \`$ewai-deliver\` and the guarded EWAI continue/resume operations. Do not use the host AI's generic plan mode as a substitute for EWAI Plan.

Include **[7] Read about premium personas** and **[8] Set up premium personas** only when returned by check-in. Both are absent when premium access is available and the installed pack is verified. Learning opens https://www.conversationalcoding.dev/personas/ without purchasing, activating or downloading content. When \`companion.personaSetup\` is present, ask its exact optional question after the menu and before the closing prompt. Offer dashboard setup, reading first, or continuing with core personas; respect a decline. Use \`$ewai-persona-entitlement\` only when setup is chosen, and never ask for a key in chat. Do not substitute this setup question for an expired, invalid or unavailable configured licence.

For chosen premium setup, use the guarded dashboard setup form by default, or a hidden private terminal only when a genuine interactive terminal is available. Explain that key submission verifies and immediately installs the pack; no second sync confirmation is needed for that submitted action. Confirm the installed version, refresh the persona index and resolve chosen setup before Archaeology. On failure offer retry or explicit core-only continuation; preserve briefing and purpose alignment. Normal check-in and learning never download. Licence management remains reachable in dashboard Configuration even when promotional actions are hidden.

Always render the returned **[9] Configure the dashboard** action. Use \`$ewai-dashboard-configuration\` to explain and save explicit project-local view choices. Optional views are off by default. Hiding a view never disables required checks, hooks, policies, standards or approvals.

Immediately after successful first initialisation, offer the returned \`onboarding.personaLearning\` question before deeper analysis or Archaeology, for both new and existing code. Respect a decline and preserve the human briefing and purpose-alignment checkpoints. Do not repeat first-run onboarding in subsequent sessions; follow the returned action list.

Any request to plan, build, implement, deliver, resume, or move an intent forward must use \`$ewai-deliver\`. Before substantive repository claims, check the EWAI Tree-sitter index and refresh it when missing or stale. Never mutate a raw phase/status: phase progress must go through the canonical gate ledger, deterministic checker, and guarded start/complete operations. Build requires the explicit durable human approval gate.

External validation must follow the resolved checkpoint policy captured under the configured SPECS root at \`6.Build/<slug>/delivery-state.json\`: never use the orchestrator as its own independent reviewer, never exceed the configured cycle limit, and preserve each review and fix cycle as recorded evidence. The standards sweep remains mandatory even when no independent external CLI is configured.

When delivering an intent, use the EWAI MCP active-work tools to register the start, material progress events, human questions, blockers, handoffs, decisions, and finish. Do not emit heartbeat events with no material change.

Never download or update premium personas during the check-in. If the result offers an install or update, ask the user first. Only after an explicit yes, run \`ewai persona premium sync --project . --yes\`. Every session must check persona entitlement/version, even when the dashboard is reused. Website-purchased keys use the guarded dashboard password form by default; \`ewai persona premium configure --project .\` is an alternative only when a genuine private interactive terminal is available; never ask for a key in chat or write it into project YAML/SPECS. A confirmed matching team expiry removes only its managed premium cache; individual expiry keeps installed personas and stops updates. Unknown/invalid responses never delete content.
<!-- EWAI-CHECKIN:END -->`;

function renderTemplate(source, variables) {
  return Object.entries(variables).reduce(
    (content, [name, value]) => content.replaceAll(`{{${name}}}`, value),
    source
  );
}

function writeIfMissing(path, content, force, result) {
  if (existsSync(path) && !force) {
    result.skipped.push(path);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  result.created.push(path);
}

function ensureCheckinInstructions(projectRoot, result) {
  for (const name of checkinInstructionFiles) {
    const path = resolve(projectRoot, name);
    if (!existsSync(path)) {
      writeFileSync(path, `${checkinInstruction}\n`, 'utf8');
      result.created.push(path);
      continue;
    }
    const content = readFileSync(path, 'utf8');
    if (content.includes('<!-- EWAI-CHECKIN:START -->')) {
      const start = content.indexOf('<!-- EWAI-CHECKIN:START -->');
      const endMarker = '<!-- EWAI-CHECKIN:END -->';
      const end = content.indexOf(endMarker, start);
      if (end === -1) throw new Error(`Incomplete EWAI check-in instruction block: ${path}`);
      const updated = `${content.slice(0, start)}${checkinInstruction}${content.slice(end + endMarker.length)}`;
      if (updated === content) result.skipped.push(path);
      else {
        writeFileSync(path, updated, 'utf8');
        result.created.push(path);
      }
      continue;
    }
    writeFileSync(path, `${content.trimEnd()}\n\n${checkinInstruction}\n`, 'utf8');
    result.created.push(path);
  }
  removeLegacyGeminiCheckin(projectRoot, result);
}

function removeLegacyGeminiCheckin(projectRoot, result) {
  const path = resolve(projectRoot, 'GEMINI.md');
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf8');
  const startMarker = '<!-- EWAI-CHECKIN:START -->';
  const endMarker = '<!-- EWAI-CHECKIN:END -->';
  const start = content.indexOf(startMarker);
  if (start === -1) return;
  const end = content.indexOf(endMarker, start);
  if (end === -1) throw new Error(`Incomplete EWAI check-in instruction block: ${path}`);
  const updated = `${content.slice(0, start)}${content.slice(end + endMarker.length)}`.trim();
  writeFileSync(path, updated ? `${updated}\n` : '', 'utf8');
  result.created.push(path);
}

export function refreshCheckinInstructions(projectRoot) {
  const result = { created: [], skipped: [] };
  const root = resolve(projectRoot);
  const paths = projectPaths(root);
  ensureCheckinInstructions(root, result);
  writeIfMissing(
    resolve(paths.specsRoot, '5.Strategy/patterns/context-packet.md'),
    readFileSync(resolve(templateRoot, '5.Strategy/patterns/context-packet.md'), 'utf8'),
    false,
    result
  );
  result.mcp = configureProjectMcp(root);
  return result;
}

export function detectExistingCodebase(projectRoot) {
  const root = resolve(projectRoot);
  const evidence = [];
  const queue = [{ path: root, depth: 0 }];

  while (queue.length && evidence.length < 20) {
    const current = queue.shift();
    for (const entry of readdirSync(current.path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) {
        if (current.depth < 3 && !ignoredCodeDirectories.has(entry.name) && !entry.name.startsWith('.')) {
          queue.push({ path: resolve(current.path, entry.name), depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;

      const path = resolve(current.path, entry.name);
      const projectRelative = relative(root, path);
      if (
        codeManifestNames.has(entry.name)
        || entry.name.endsWith('.sln')
        || entry.name.endsWith('.csproj')
        || codeExtensions.has(extname(entry.name).toLowerCase())
      ) {
        evidence.push(projectRelative);
      }
    }
  }

  return { detected: evidence.length > 0, evidence };
}

export function initProject(projectRoot, options = {}) {
  const root = resolve(projectRoot);
  if (!existsSync(root)) throw new Error(`Project directory does not exist: ${root}`);

  const existingPaths = projectPaths(root);
  const requestedPaths = projectPaths(root, { specsRoot: options.specsRoot });
  if (options.specsRoot && existsSync(existingPaths.runtimeProjectPath) && existingPaths.specsRoot !== requestedPaths.specsRoot) {
    throw new Error(`EWAI is already bound to ${existingPaths.specsRelative}. Relocating an existing SPECS contract requires an explicit migration, not init --specs.`);
  }

  const existingCodebase = detectExistingCodebase(root);
  const paths = requestedPaths;
  const discoveryCommand = `ewai discover --project ${JSON.stringify(root)}`;
  const briefingPrompt = `Use $ewai-project-discovery to capture and confirm why ${JSON.stringify(root)} exists, who it serves, and what outcomes matter before Archaeology begins.`;
  const archaeologyPrompt = `Offer optional Archaeology to reconstruct missing project documentation from the existing code. Ask whether the user wants it; only if the user accepts, use $ewai-archaeology to compare the confirmed project briefing with repository evidence at ${JSON.stringify(root)}, resolve material discrepancies, and reconstruct deeper project knowledge. If declined, continue to Discovery without reconstruction; Archaeology remains available later.`;
  const result = {
    projectRoot: root,
    specsRoot: paths.specsRoot,
    specsRelative: paths.specsRelative,
    created: [],
    skipped: [],
    nextCommand: existingCodebase.detected ? null : discoveryCommand,
    onboarding: existingCodebase.detected
      ? {
          existingCodebase: true,
          evidence: existingCodebase.evidence,
          recommendedNextStep: 'project-briefing',
          skill: 'ewai-project-discovery',
          prompt: briefingPrompt,
          afterBrief: archaeologyPrompt,
          archaeology: { optional: true, question: 'Would you like us to analyse the existing code and reconstruct its missing project documentation?', declineCommand: discoveryCommand },
          afterReview: discoveryCommand
        }
      : {
          existingCodebase: false,
          evidence: [],
          recommendedNextStep: 'discovery',
          command: discoveryCommand
        }
  };
  result.onboarding.personaLearning = existsSync(existingPaths.runtimeProjectPath) ? null : {
    question: 'Would you like to see how specialist personas could help us analyse this project?',
    action: premiumPersonaLearningAction(),
    optional: true,
    before: 'deeper-analysis',
    decline: 'Continue normal onboarding with installed core, personal and project personas.'
  };
  const variables = {
    PROJECT_NAME: JSON.stringify(options.name || basename(root)),
    SPECS_ROOT: JSON.stringify(paths.specsRelative),
    PRIMARY_REPOSITORY_NAME: paths.specsRelative === 'SPECS' ? 'application' : 'knowledge',
    PRIMARY_REPOSITORY_PATH: JSON.stringify(paths.specsRelative === 'SPECS' ? '.' : dirname(paths.specsRelative)),
    PRIMARY_REPOSITORY_ROLE: paths.specsRelative === 'SPECS' ? 'application' : 'knowledge-and-delivery',
  };

  for (const directory of requiredDirectories) {
    mkdirSync(resolve(paths.specsRoot, directory), { recursive: true });
  }

  for (const [sourceRelative, destinationRelative] of templateFiles) {
    const source = readFileSync(resolve(templateRoot, sourceRelative), 'utf8');
    writeIfMissing(
      resolve(paths.specsRoot, destinationRelative),
      renderTemplate(source, variables),
      Boolean(options.force),
      result
    );
  }

  if (options.initSpecsRepository) {
    const repositoryRoot = resolve(root, dirname(paths.specsRelative));
    if (paths.specsRelative === 'SPECS' || repositoryRoot === root) {
      throw new Error('--init-specs-repo requires a dedicated path such as project-knowledge/SPECS');
    }
    if (!existsSync(resolve(repositoryRoot, '.git'))) {
      execFileSync('git', ['init', '-b', 'main'], { cwd: repositoryRoot, stdio: 'ignore' });
      result.specsRepositoryInitialized = repositoryRoot;
    } else {
      result.specsRepositoryInitialized = null;
    }
  }

  ensureCheckinInstructions(root, result);

  if (options.validators?.length) {
    const config = YAML.parse(readFileSync(paths.configPath, 'utf8'));
    for (const validator of options.validators) {
      setValidationProvider(config, validator, 'available', true);
    }
    writeFileSync(paths.configPath, YAML.stringify(config, { lineWidth: 0 }), 'utf8');
  }

  mkdirSync(paths.runtimeRoot, { recursive: true });
  writeIfMissing(resolve(paths.runtimeRoot, '.gitignore'), '*\n!.gitignore\n', false, result);
  writeIfMissing(
    paths.runtimeProjectPath,
    `${JSON.stringify({ schema: 'ewai.runtime-project/v1', projectRoot: root, specsRoot: paths.specsRelative }, null, 2)}\n`,
    Boolean(options.force),
    result
  );

  result.runtime = initializeRuntime(root);
  result.mcp = configureProjectMcp(root);

  return result;
}

export function configureExternalValidation(projectRoot, validator, state, enabled = undefined) {
  const { config, paths } = loadProjectConfig(projectRoot);
  setValidationProvider(config, validator, state, enabled);
  writeFileSync(paths.configPath, YAML.stringify(config, { lineWidth: 0 }), 'utf8');
  return externalValidationStatus(config);
}

export function configureValidationCheckpoint(projectRoot, checkpoint, update) {
  const { config, paths } = loadProjectConfig(projectRoot);
  setValidationCheckpoint(config, checkpoint, update);
  writeFileSync(paths.configPath, YAML.stringify(config, { lineWidth: 0 }), 'utf8');
  return validationStatus(config);
}

export function externalValidationStatus(config, orchestrator = 'manual') {
  const effective = effectiveValidationConfig(config, orchestrator);
  const selected = new Set(
    Object.values(effective.checkpoints).flatMap((checkpoint) => checkpoint.validators),
  );
  return VALIDATION_PROVIDERS.map((validator) => ({
    validator,
    state: effective.providers[validator].state,
    enabled: effective.providers[validator].enabled,
    selected: selected.has(validator),
    excluded_as_orchestrator: validator === effective.orchestrator,
  }));
}

export function validationStatus(config, orchestrator = 'manual') {
  return effectiveValidationConfig(config, orchestrator);
}

export function migrateProjectValidationConfig(projectRoot) {
  const paths = projectPaths(projectRoot);
  if (!existsSync(paths.configPath)) {
    throw new Error(`Missing EWAI project configuration: ${paths.configPath}`);
  }
  const config = YAML.parse(readFileSync(paths.configPath, 'utf8'));
  const validation = normaliseValidationConfig(config.validation);
  const changed = JSON.stringify(config.validation ?? null) !== JSON.stringify(validation);
  if (changed) {
    config.validation = validation;
    writeFileSync(paths.configPath, YAML.stringify(config, { lineWidth: 0 }), 'utf8');
  }
  return { changed, path: paths.configPath, validation };
}

export function loadProjectConfig(projectRoot) {
  const paths = projectPaths(projectRoot);
  if (!existsSync(paths.configPath)) {
    throw new Error(`Missing EWAI project configuration: ${paths.configPath}`);
  }
  const config = YAML.parse(readFileSync(paths.configPath, 'utf8'));
  if (config?.schema !== 'ewai.project/v1') {
    throw new Error(`Unsupported EWAI project schema in ${paths.configPath}`);
  }
  if (String(config?.specs?.root ?? '') !== paths.specsRelative) {
    throw new Error(`SPECS locator mismatch: runtime points to ${paths.specsRelative}, but pipeline.yaml declares ${config?.specs?.root ?? '<missing>'}`);
  }
  config.validation = normaliseValidationConfig(config.validation);
  config.dashboard = normaliseDashboardPreferences(config.dashboard);
  return { config, paths };
}

export function doctorProject(projectRoot) {
  const checks = [];
  let loaded;

  try {
    loaded = loadProjectConfig(projectRoot);
    checks.push({ name: 'project-config', status: 'pass', path: loaded.paths.configPath });
  } catch (error) {
    checks.push({ name: 'project-config', status: 'fail', message: error.message });
    return checks;
  }

  const required = [
    loaded.paths.personaRoot,
    loaded.paths.buildRoot,
    resolve(loaded.paths.specsRoot, '5.Strategy/architecture/patterns'),
    resolve(loaded.paths.personaRoot, 'registry.yaml'),
    resolve(loaded.paths.runtimeRoot, 'data/pipeline.sqlite'),
    resolve(loaded.paths.projectRoot, '.mcp.json'),
    resolve(loaded.paths.projectRoot, '.claude/settings.json'),
    resolve(loaded.paths.projectRoot, '.codex/config.toml'),
    resolve(loaded.paths.projectRoot, '.agents/mcp_config.json')
  ];

  for (const path of required) {
    checks.push({
      name: `path:${path.slice(loaded.paths.projectRoot.length + 1)}`,
      status: existsSync(path) ? 'pass' : 'fail',
      path
    });
  }

  const repositories = loaded.config.repositories ?? [];
  for (const repository of repositories) {
    const path = resolve(loaded.paths.projectRoot, repository.path);
    checks.push({
      name: `repository:${repository.name}`,
      status: existsSync(path) ? 'pass' : 'fail',
      path
    });
  }

  for (const provider of externalValidationStatus(loaded.config)) {
    checks.push({
      name: `external-validation:${provider.validator}`,
      status: 'pass',
      availability: provider.state
    });
  }

  return checks;
}
