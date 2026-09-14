import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, realpathSync } from 'node:fs';
import YAML from 'yaml';
import {DASHBOARD_VIEWS,readDashboardPreferences,saveDashboardPreferences} from './dashboard-preferences.mjs';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { configureAndInstallPremiumPersonas } from './checkin.mjs';
import {
  configureValidationCheckpoint,
  configureExternalValidation,
  doctorProject,
  externalValidationStatus,
  initProject,
  loadProjectConfig,
  validationStatus,
} from './project.mjs';
import { install } from './install.mjs';
import { auditIntentStateCopies, createIntent } from './intents.mjs';
import { createIntentMap, loadIntentMapRequest } from './intent-maps.mjs';
import { discoverProject, loadDiscoveryAnswers, runDiscoveryInterview } from './discovery.mjs';
import { listPacks } from './packs.mjs';
import {
  designSystemStatus,
  listDesignSystems,
  projectDesignSystem,
  projectResolvedDesignSystem,
  resolveDesignSystem,
  selectDesignSystem,
} from './design-systems.mjs';
import { installDesignSystemCandidate, validateDesignSystemCandidate } from './design-system-authoring.mjs';
import { applyDesignSystem } from './design-system-application.mjs';
import {
  createPersona,
  indexPersonas,
  listPersonas,
  personaLibraryRoot,
  personalPersonaRoot,
  projectPersonaRoot
} from './personas.mjs';
import { resolveProjectRoot } from './paths.mjs';
import {
  checkinProject,
  premiumPersonaEntitlementStatus,
  premiumPersonaRoot,
  syncPremiumPersonas,
} from './checkin.mjs';
import {
  preparePersonaTestScenarioBrief,
  readPersonaTestScenarioWorkspace,
  recordPersonaTestScenarios
} from './test-scenarios.mjs';
import { dashboardStatus, ensureDashboard, stopDashboard } from './runtime/dashboard.mjs';
import { ASSURANCE_NOTICE } from './security-validation-config.mjs';
import { registerContextSource } from './context.mjs';
import { prepareProjectContext } from './runtime/context-assembly.mjs';
import { runContextBenchmark } from './runtime/context-benchmarks.mjs';
import {
  MEETING_EVIDENCE_DISCLAIMER,
  prepareMeetingExtraction,
  promoteMeetingEvidence,
  readMeetingEvidenceWorkspace,
  recordMeetingReview,
  registerMeetingSource,
} from './meeting-evidence.mjs';
import {
  KNOWLEDGE_PROPOSALS_DISCLAIMER,
  listKnowledgeSources,
  materialiseKnowledgeProposals,
  prepareKnowledgeProposals,
  readKnowledgeProposalWorkspace,
  recordKnowledgeProposalBundle,
  recordKnowledgeProposalReview,
  recoverKnowledgeMaterialisation,
} from './knowledge-proposals.mjs';
import {
  curateArchaeologyBundle,
  prepareArchaeologyPersonaGate,
  prepareArchaeologyReview,
  prepareArchaeologyTechnologyHosting,
  readArchaeologyTechnologyHosting,
  recordArchaeologyTechnologyHosting,
  validateArchaeologyBundle,
  validateArchaeologyCompletion,
  validateArchaeologyPersonaGate
} from './archaeology.mjs';
import {
  compareEvidenceDepthWorkspaceRuns,
  prepareEvidenceDepthWorkspace,
  readEvidenceDepthWorkspace,
  recordEvidenceDepthWorkspaceRun,
} from './runtime/evidence-depth-workspace.mjs';
import {
  comparePrototypeWorkspaceReviews,
  preparePrototypeCycleWorkspace,
  preparePrototypePlanWorkspace,
  readPrototypeIterationWorkspace,
  recordPrototypeCycleWorkspaceReview,
  recordPrototypePlanWorkspaceReview,
} from './runtime/prototype-iterations.mjs';
import {
  beginDelivery,
  completeDeliveryPhase,
  continueDelivery,
  phaseGateTemplate,
  previewCompletedEvidenceAmendment,
  ratifyDeliveryAmendments,
  ratifyCompletedEvidenceAmendment,
  readDeliveryState,
  recordBuildApproval,
  recordExternalValidationCycle,
  recordManualQaApproval,
  recordPhaseGate,
  resumeShelvedDelivery,
  startDeliveryPhase
} from './delivery.mjs';
import {
  refreshRepositoryIndex,
  repositoryGraph,
  repositoryIndexFreshness,
  repositoryIndexStatus,
  repositorySourceMapCoverage,
  repositorySourceMapFiles,
  repositorySourceMapProfiles,
  repositoryStandards,
  repositoryStandardsCoverage,
  repositoryTruth,
  searchRepositoryIndex,
  similarRepositoryCapabilities
} from './runtime/repository-index.mjs';
import { listCommandRuns, markStaleCommandRuns } from './runtime/runs.mjs';
import {
  palaceHousekeeping,
  palaceIndexStatus,
  palaceTidiness,
  refreshPalaceIndex,
  searchPalace
} from './runtime/palace.mjs';
import {
  afkRunStatus,
  cancelAfkRun,
  pauseAfkRun,
  preflightAfkRun,
  resumeAfkRun,
  startAfkRun,
} from './runtime/afk-conductor.mjs';
import {
  LIFECYCLE_EVENT_CATALOGUE,
  disableLifecycleSubscription,
  readLifecycleHookWorkspace,
  reconcileCanonicalLifecycleEvents,
  registerLifecycleHandler,
  retryLifecycleDelivery,
  subscribeLifecycleHandler,
  validateLifecycleHandlerPackage,
} from './runtime/lifecycle-hooks.mjs';
import {
  cancelSecurityRun,
  discoverSecurityProviders,
  executeSecurityRun,
  importSecurityArtifacts,
  listSecurityAdapters,
  listSecurityDispositions,
  listSecurityFindings,
  listSecurityRuns,
  prepareSecurityArtifactImport,
  prepareSecurityRun,
  readSecurityWorkspace,
  recordSecurityDisposition,
  registerSecurityAdapter,
  resolveSecurityRevision,
  validateSecurityAdapter,
} from './runtime/security-validation.mjs';
import {
  canonicalStarterTree,
  starterPackDigest,
  starterTreeDigest,
  validateStarterAdapterPackage,
} from './starter-materialisation-contract.mjs';
import {
  applyStarterMaterialisation,
  listStarterAdapters,
  prepareStarterMaterialisation,
  readStarterMaterialisationWorkspace,
  recoverStarterMaterialisation,
  registerStarterAdapter,
  selectStarterPersonas,
} from './runtime/starter-materialisation.mjs';
import { readPortfolioWorkspace } from './portfolio.mjs';
import {
  ROLLOUT_ADVISORY_NOTICE,
  ROLLOUT_ASSURANCE_NOTICE,
  readRolloutWorkspace,
} from './network-rollout.mjs';
import { readCompanionGuidance } from './companion-guidance.mjs';
import {
  READINESS_AUTHORITY_NOTICE,
  listSolutionReadinessProfiles,
  prepareSolutionReadinessReview,
  readSolutionReadinessStatus,
  recordSolutionReadinessReview,
} from './solution-readiness.mjs';
import {
  POLICY_DESIGN_AUTHORITY_NOTICE,
  confirmPolicyFactsAction,
  evaluatePolicyDesignAction,
  readPolicyWorkspace,
  recordPolicyExceptionAction,
  recordPolicyReviewAction,
} from './runtime/policy-workspace.mjs';
import {
  archiveErrorReport,
  captureErrorReportFailure,
  createLocalErrorReport,
  deleteErrorReport,
  finaliseLocalErrorReport,
  listErrorReportProviders,
  listErrorReportReceipts,
  listLocalErrorReports,
  prepareErrorReportEmail,
  readLocalErrorReport,
  registerErrorReportProvider,
  submitErrorReportProvider,
  updateErrorReportSettings,
  updateLocalErrorReport,
  validateErrorReportProvider,
} from './runtime/error-reporting.mjs';
import { inspectTeamHubDisclosure } from './team-hub.mjs';
import {
  connectTeamHub,
  disconnectTeamHub,
  inspectConnectedTeamHubResource,
  installConnectedTeamHubResource,
  listConnectedTeamHubResources,
  listTeamHubResourceReceipts,
  readTeamHubWorkspace,
  syncTeamHub,
} from './runtime/team-hub-client.mjs';
import { ensureTeamHub, stopTeamHub, teamHubStatus } from './runtime/team-hub.mjs';
import { buildTeamHubResourcePackage } from './team-hub-resources.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const installRoot = resolve(moduleDir, '..');

function option(args, name, fallback = '') {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] ?? fallback;
}

function has(args, name) {
  return args.includes(name);
}

function options(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1] !== undefined) values.push(args[index + 1]);
  }
  return values;
}

function automaticErrorCommand(args) {
  const safe = ['ewai'];
  for (const value of args.slice(0, 2)) {
    if (String(value).startsWith('--') || !/^[a-z0-9][a-z0-9:-]*$/.test(String(value))) break;
    safe.push(String(value));
  }
  return safe.join(' ');
}

function print(value, json = false) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) console.log(typeof item === 'string' ? item : JSON.stringify(item));
    return;
  }
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

function printSecurity(value, json = false) {
  if (json) return print(value, true);
  const safe = value && typeof value === 'object' ? { ...value } : { result: value };
  delete safe.assurance_notice;
  print(`${ASSURANCE_NOTICE}\n\n${JSON.stringify(safe, null, 2)}`);
}

function printReadiness(value, json = false) {
  if (json) return print(value, true);
  const safe = value && typeof value === 'object' ? { ...value } : { result: value };
  delete safe.notices;
  print(`${ASSURANCE_NOTICE}\n${READINESS_AUTHORITY_NOTICE}\n\n${JSON.stringify(safe, null, 2)}`);
}

function printPolicy(value, json = false) {
  if (json) return print(value, true);
  print(`${POLICY_DESIGN_AUTHORITY_NOTICE}\n\n${JSON.stringify(value, null, 2)}`);
}

function readProjectJsonInput(projectRoot, inputPath, label) {
  if (!inputPath) throw new Error(`${label} requires --input FILE`);
  const candidate = resolve(projectRoot, inputPath);
  let safePath;
  try { safePath = realpathSync(candidate); }
  catch { throw new Error(`Cannot read ${label} input file`); }
  const projectRelative = relative(projectRoot, safePath);
  if (!projectRelative || projectRelative.startsWith('..') || isAbsolute(projectRelative)) {
    throw new Error(`${label} --input must be a project-relative file`);
  }
  try { return JSON.parse(readFileSync(safePath, 'utf8')); }
  catch { throw new Error(`Cannot parse ${label} input JSON`); }
}

function formatInitResult(result) {
  const lines = [
    `EWAI initialized for ${result.projectRoot}`,
    `SPECS: ${result.specsRelative}${result.specsRelative === 'SPECS' ? ' (project-local)' : ' (dedicated location)'}`,
    `Created ${result.created.length} file(s); preserved ${result.skipped.length} existing file(s).`
  ];

  if (result.specsRepositoryInitialized) {
    lines.push(`Knowledge repository initialized: ${result.specsRepositoryInitialized}`);
  }

  if (result.onboarding.existingCodebase) {
    lines.push('', 'Existing codebase detected:');
    for (const path of result.onboarding.evidence.slice(0, 8)) lines.push(`  • ${path}`);
    if (result.onboarding.evidence.length > 8) {
      lines.push(`  • …and ${result.onboarding.evidence.length - 8} more signal(s)`);
    }
    lines.push(
      '',
      'Recommended next step: establish the human project briefing before Archaeology.',
      'Ask your agent:',
      `  ${result.onboarding.prompt}`,
      '',
      'After the briefing is confirmed:',
      `  ${result.onboarding.afterBrief}`
    );
  } else {
    lines.push('', 'No existing codebase was detected.', `Next: ${result.onboarding.command}`);
  }

  return lines.join('\n');
}

export function formatCheckin(result, options = {}) {
  if (options.verbose) return formatCheckinDetails(result);
  const { premium, framework } = result;
  const dashboard = result.runtime?.dashboard;
  const selected = [...new Set(Object.values(result.validation?.checkpoints ?? {})
    .flatMap(checkpoint => checkpoint.validators ?? []))];
  const consistent = result.intentState?.status === 'consistent'
    && result.operationalState?.status === 'consistent';
  const version = framework.current ? ` ${framework.current}` : '';
  const frameworkText = framework.status === 'current' ? 'up to date'
    : framework.status === 'update-available' ? `update ${framework.latest} available`
      : framework.status === 'not-checked' ? 'update check not run'
        : `update check unavailable${framework.reason ? `: ${framework.reason}` : ''}`;
  const personaText = premium.accessReason === 'licence-not-configured' ? 'Core personas available · Premium licence not configured'
    : premium.installed && premium.verified ? `Premium personas installed${premium.version ? ` · ${premium.version}` : ''}${premium.message ? ` · ${premium.message}` : ''}`
      : premium.access === 'available' ? 'Core personas available · Premium access verified; pack not ready'
        : `Core personas available · Premium access ${premium.access === 'unavailable' ? 'unavailable' : 'unverified'}${premium.message ? `: ${premium.message}` : ''}`;
  const personaActions = {
    'offer-update': `Persona update ${premium.latestVersion ?? 'release'} available; ask before downloading`,
    'blocked-local-changes': 'Local changes in the managed pack; resolve them before replacement',
    'offer-replace': 'Pack belongs to another licence or provider; explicit replacement consent required',
    'offer-repair': 'Pack needs repair; explicit download consent required',
    'offer-install': 'Installation available; explicit download consent required'
  };
  const personaAction = Object.hasOwn(personaActions, premium.action?.kind) ? personaActions[premium.action.kind] : null;
  const lines = [
    `EWAI · ${result.project.name}${dashboard?.status === 'running' ? ` · Dashboard: ${dashboard.url}` : ' · Dashboard not started'}`,
    `EWAI${version} · ${frameworkText}`,
    `${personaText}${personaAction ? ` · ${personaAction}` : ''}`,
    `${consistent ? 'State consistent' : 'State needs reconciliation; pause delivery'} · Standards required · Independent reviewers: ${selected.join(', ') || 'none configured'}`
  ];
  if (result.intentDependencies?.errors?.length) lines.push('Dependency blockers found; resolve them before delivery.');
  for (const host of result.validation?.hosts ?? []) {
    const configured = result.validation.providers?.[host.host];
    if (configured?.state === 'available' && configured.enabled && !host.available)
      lines.push(`Validation warning: ${host.label} is enabled but unavailable in this terminal.`);
  }
  if (result.palace?.status !== 'tidy' && result.palace?.findings?.length)
    lines.push(`Mind Palace: ${result.palace.findings.length} item(s) could use housekeeping.`);
  if (result.dashboardHandoffError) lines.push('Dashboard handoff could not be read; check its status before continuing.');
  return lines.join('\n');
}

function formatCheckinDetails(result) {
  const premium = result.premium;
  const lines = [`EWAI check-in · ${result.project.name}`];
  if (premium.access === 'available') {
    lines.push(`Premium personas: access available · ${premium.status}`);
    if (premium.action) lines.push(premium.action.prompt);
  } else if (premium.access === 'unavailable') {
    lines.push('Premium personas: access not available', `Get premium access: ${premium.upgradeUrl}`);
  } else {
    lines.push('Premium personas: access could not be verified', premium.message || 'Check your connection and try again.');
  }
  const version = result.framework.current ? ` ${result.framework.current}` : '';
  const latest = result.framework.latest ? ` ${result.framework.latest}` : '';
  const frameworkSource = result.framework.source ? ` via ${result.framework.source}` : '';
  if (result.framework.status === 'update-available') {
    lines.push(`EWAI Pipeline:${version} · update${latest} available${frameworkSource}`);
    if (result.framework.action?.prompt) lines.push(result.framework.action.prompt);
  } else if (result.framework.status === 'current') lines.push(`EWAI Pipeline:${version} · current${frameworkSource}`);
  else if (result.framework.status !== 'not-checked') lines.push(`EWAI Pipeline:${version} · update status unknown${result.framework.reason ? ` · ${result.framework.reason}` : ''}`);
  if (result.runtime?.dashboard?.status === 'running') {
    const action = result.runtime.dashboard.started ? 'started' : 'ready';
    lines.push(`Pipeline dashboard: ${action} · ${result.runtime.dashboard.url}`);
  }
  if (result.intentState?.status === 'drift-detected') {
    lines.push(`Intent state: drift detected in ${result.intentState.drift.length} intent(s); delivery must pause for reconciliation.`);
  } else if (result.intentState && result.operationalState?.status === 'consistent') {
    lines.push(`Intent state: ${result.intentState.checked} checked · Markdown, intent JSON, delivery JSON, and SQLite consistent`);
  } else if (result.operationalState) {
    lines.push(`Intent state: SQLite projection ${result.operationalState.status}`);
  }
  if (result.validation) {
    const selected = [...new Set(
      Object.values(result.validation.checkpoints ?? {})
        .flatMap((checkpoint) => checkpoint.validators ?? []),
    )];
    lines.push(
      `Validation: standards mandatory · orchestrator ${result.validation.orchestrator} · independent reviewers ${
        selected.join(', ') || 'none configured'
      }`,
    );
    const mismatches = (result.validation.hosts ?? []).filter((host) => {
      const configured = result.validation.providers?.[host.host];
      return configured?.state === 'available' && configured.enabled && !host.available;
    });
    for (const mismatch of mismatches) {
      lines.push(`Validation warning: ${mismatch.label} is enabled in project config but unavailable in this terminal.`);
    }
  }
  if (result.palace?.status === 'tidy') {
    lines.push(`Mind Palace: tidy · ${result.palace.documents} artefacts indexed`);
  } else if (result.palace) {
    lines.push(`Mind Palace: ${result.palace.findings.length} item(s) could use housekeeping`);
  }
  return lines.join('\n');
}

function formatPalaceSearch(result) {
  if (!result.results.length) return `EWAI Mind Palace · no results for “${result.query}”`;
  return [
    `EWAI Mind Palace · ${result.results.length} result${result.results.length === 1 ? '' : 's'} for “${result.query}”`,
    '',
    ...result.results.flatMap((item) => [
      `${item.path}:${item.line} · ${item.headingPath || item.heading}`,
      `  ${String(item.snippet).replaceAll('⟦', '').replaceAll('⟧', '')}`
    ])
  ].join('\n');
}

function formatPalaceTidiness(result) {
  const lines = [
    'EWAI Mind Palace · Tidiness',
    '',
    `${result.documents} artefact${result.documents === 1 ? '' : 's'} · ${result.sections} sections · ${result.links} links`
  ];
  if (result.status === 'tidy') {
    lines.push('✓ Everything is in good order. No housekeeping is needed.');
    return lines.join('\n');
  }
  const grouped = new Map();
  for (const item of result.findings) grouped.set(item.code, (grouped.get(item.code) ?? 0) + 1);
  lines.push('');
  for (const [code, count] of grouped) lines.push(`⚠ ${count} ${code.replaceAll('-', ' ')}`);
  lines.push('', 'A little housekeeping is recommended.', 'Next: ask your agent to use $ewai-palace-housekeeping.');
  return lines.join('\n');
}

function formatPalaceHousekeeping(result) {
  if (result.status === 'tidy') return `EWAI Mind Palace · Housekeeping\n\n${result.guidance}`;
  return [
    'EWAI Mind Palace · Housekeeping',
    '',
    ...result.groups.map((group) => `• ${group.count} ${group.code.replaceAll('-', ' ')}`),
    '',
    'No SPECS files were changed.',
    result.guidance
  ].join('\n');
}

function usage() {
  return `EWAI Pipeline

Commands:
  ewai install [--project PATH] [--host auto|codex|claude|antigravity] [--mode copy|link]
  ewai init [--project PATH] [--name NAME] [--specs PATH] [--init-specs-repo] [--claude] [--codex] [--antigravity] [--force]
  ewai checkin [--project PATH]
  ewai dashboard [--project PATH]
  ewai dashboard preferences [--project PATH] [--json]
  ewai dashboard configure --enable VIEW | --disable VIEW [--collapse | --expand] --expected-digest DIGEST --yes [--project PATH] [--json]
  ewai server start|status|stop [--project PATH]
  ewai mcp [--project PATH]
  ewai companion status [--focus TEXT] [--project PATH]
  ewai portfolio validate [--project PATH]
  ewai portfolio status [--focus TEXT] [--project PATH]
  ewai team status|disclosure|connect|sync|disconnect|resources [ENDPOINT] [--project PATH]
  ewai team resource inspect ID VERSION [--project PATH]
  ewai team resource install ID VERSION --expected-digest DIGEST --approved-by NAME --yes [--project PATH]
  ewai team resource receipts [--project PATH]
  ewai team-hub start|status|stop --data PATH [--token-env NAME] [--publisher-token-env NAME] [--host HOST] [--port N] [--allow-network]
  ewai team-hub resource publish FOLDER --data PATH --publisher-token-env NAME [--publisher-name NAME] --yes
  ewai rollout validate [--project PATH]
  ewai rollout status [--focus TEXT] [--project PATH]
  ewai rollout assurance PROJECT_ID [--project PATH]
  ewai discover [--project PATH] [--answers FILE] [--stack PACK] [--force]
  ewai context register FOLDER [--project PATH] --yes [--label NAME] [--classification public|internal|confidential|restricted] [--cloud-processing allowed|denied|unknown]
  ewai context prepare PROFILE --slug SLUG [--task TASK] [--phase PHASE] [--focus TEXT] [--budget TOKENS] [--previous DIGEST] [--project PATH]
  ewai context benchmark [--samples COUNT]
  ewai design-system status|list|inspect|resolve|select [ID] [--project PATH]
  ewai design-system select ID --expected-digest DIGEST --approved-by NAME --yes [--project PATH]
  ewai design-system validate FOLDER [--project PATH]
  ewai design-system install FOLDER --scope project|personal --expected-digest DIGEST --yes [--project PATH]
  ewai design-system apply DELIVERY_SLUG [--focus TEXT] [--budget TOKENS] [--project PATH]
  ewai meeting register FILE [--project PATH] --yes [--label NAME] [--classification public|internal|confidential|restricted] [--cloud-processing allowed|denied|unknown]
  ewai meeting prepare SOURCE_ID [--focus TEXT] [--project PATH]
  ewai meeting review SOURCE_ID --input FILE --reviewed-by NAME [--project PATH]
  ewai meeting promote SOURCE_ID --yes --approved-by NAME [--project PATH]
  ewai meeting status [SOURCE_ID] [--focus TEXT] [--project PATH]
  ewai knowledge sources [--project PATH]
  ewai knowledge prepare SOURCE_REF [--focus TEXT] [--project PATH]
  ewai knowledge record SOURCE_REF --input FILE [--project PATH]
  ewai knowledge review BUNDLE_ID --input FILE --reviewed-by NAME [--project PATH]
  ewai knowledge materialise BUNDLE_ID --yes --approved-by NAME [--project PATH]
  ewai knowledge recover BUNDLE_ID --yes [--project PATH]
  ewai knowledge status [BUNDLE_ID] [--project PATH]
  ewai hook catalogue [--project PATH]
  ewai hook validate FOLDER [--project PATH]
  ewai hook register FOLDER --yes [--project PATH]
  ewai hook subscribe HANDLER_ID --events EVENT[,EVENT] --yes [--project PATH]
  ewai hook list [--project PATH]
  ewai hook deliveries [--status STATUS] [--event EVENT] [--handler HANDLER_ID] [--project PATH]
  ewai hook retry DELIVERY_ID --yes [--project PATH]
  ewai hook disable SUBSCRIPTION_ID --yes [--project PATH]
  ewai archaeology prepare-personas BUNDLE [--project PATH] [--force]
  ewai archaeology validate-personas BUNDLE [--project PATH]
  ewai archaeology prepare-technology-hosting BUNDLE [--project PATH] [--force]
  ewai archaeology record-technology-hosting BUNDLE --input FILE --reviewed-by NAME [--project PATH]
  ewai archaeology technology-hosting-status BUNDLE [--project PATH]
  ewai archaeology depth-status [--project PATH]
  ewai archaeology depth-prepare [--focus TEXT] [--input FILE] [--project PATH]
  ewai archaeology depth-record --input FILE [--project PATH]
  ewai archaeology depth-compare LEFT_RUN_ID RIGHT_RUN_ID [--project PATH]
  ewai prototype-review status DELIVERY_SLUG [--project PATH]
  ewai prototype-review plan-prepare DELIVERY_SLUG --input FILE [--project PATH]
  ewai prototype-review plan-record DELIVERY_SLUG --input FILE [--project PATH]
  ewai prototype-review cycle-prepare DELIVERY_SLUG --input FILE [--project PATH]
  ewai prototype-review cycle-record DELIVERY_SLUG --input FILE [--project PATH]
  ewai prototype-review compare DELIVERY_SLUG LEFT_DIGEST RIGHT_DIGEST [--project PATH]
  ewai archaeology validate BUNDLE [--project PATH]
  ewai archaeology prepare-review BUNDLE [--project PATH] [--force]
  ewai archaeology curate BUNDLE [--project PATH] --yes [--approved-by NAME]
  ewai archaeology validate-completion BUNDLE [--project PATH]
  ewai validation list [--project PATH] [--orchestrator manual|claude|codex|antigravity]
  ewai validation set claude|codex|antigravity available|unavailable [--enabled|--disabled] [--project PATH]
  ewai validation checkpoint implementation-plan|test-plan|code [--cycles N] [--validators auto|PROVIDER,...] [--breadth targeted|change-set|capability|system] [--depth issues-only|issues-and-fixes|analysis-and-recommendations] [--output small|medium|large] [--enabled|--disabled] [--project PATH]
  ewai security status|providers|adapters|runs|findings|dispositions [--project PATH]
  ewai security adapter-validate FOLDER [--project PATH]
  ewai security adapter-register FOLDER --yes [--project PATH]
  ewai security run PROFILE --yes [--mode command|skill] [--confirm-runtime-target] [--project PATH]
  ewai security import-prepare PROFILE --provider PROVIDER [--project PATH]
  ewai security import TOKEN --yes [--project PATH]
  ewai security cancel RUN --yes [--project PATH]
  ewai security disposition FINDING --yes --decision DECISION --reviewer NAME --reason TEXT [--evidence PATH] [--risk-owner NAME] [--expires-at ISO] [--next-role ROLE] [--project PATH]
  ewai error-report status|create|show|update|finalise|prepare-email|providers|receipts|send|archive|delete [REPORT] [--project PATH]
  ewai error-report prepare-email REPORT --expected-digest DIGEST [--recipient ADDRESS] [--launch] [--project PATH]
  ewai error-report settings [--automatic-local-drafts true|false] [--support-email ADDRESS] [--project PATH]
  ewai error-report adapter-validate FOLDER [--project PATH]
  ewai error-report adapter-register FOLDER --yes [--project PATH]
  ewai policy status [INTENT] [--mode business|technical] [--project PATH]
  ewai policy confirm-facts|evaluate|review|exception --input FILE [--project PATH]
  ewai readiness profiles [--project PATH]
  ewai readiness prepare SLUG --profile internal-only|internal-sensitive|client-facing|public-service|critical-regulated [--project PATH]
  ewai readiness review ASSESSMENT --input FILE --reviewed-by NAME [--project PATH]
  ewai readiness status ASSESSMENT [--project PATH]
  ewai starter status [--project PATH]
  ewai starter adapters [--project PATH]
  ewai starter digest ROLE=FOLDER [ROLE=FOLDER...] [--project PATH]
  ewai starter adapter-validate FOLDER [--project PATH]
  ewai starter adapter-register FOLDER --yes [--project PATH]
  ewai starter preview RECEIPT --adapter ADAPTER --yes [--timeout-ms N] [--project PATH]
  ewai starter apply PREVIEW --yes --approved-by NAME [--project PATH]
  ewai starter recover ATTEMPT --yes [--project PATH]
  ewai doctor [--project PATH]
  ewai intent create SLUG [--domain DOMAIN] [--title TITLE] [--persona REF:ROLE:DEPTH] [--delivery-shape FILE]
  ewai intent map-create FILE --yes [--approved-by NAME] [--project PATH]
  ewai intent audit-state [--project PATH]
  ewai delivery begin SLUG [--project PATH] [--tool HOST] [--ideate] [--existing-code] [--ui] [--mode normal|shelf|resume]
  ewai delivery status SLUG [--project PATH]
  ewai delivery continue SLUG [--project PATH]
  ewai delivery resume SLUG [--project PATH] [--tool HOST]
  ewai delivery gate SLUG PHASE --input FILE [--project PATH]
  ewai delivery gate-template SLUG PHASE [--project PATH]
  ewai delivery phase-start SLUG PHASE [--project PATH]
  ewai delivery phase-complete SLUG PHASE [--artefact PATH] [--project PATH]
  ewai delivery ratify-amendments SLUG --yes --approved-by NAME --scope TEXT [--project PATH]
  ewai delivery evidence-amendment SLUG [--yes --approved-by NAME --reason TEXT --expected-state-digest DIGEST] [--project PATH]
  ewai delivery validation-cycle SLUG PHASE --provider claude|codex|antigravity --outcome pass|issues [--response PATH] [--fix PATH] [--notes TEXT] [--project PATH]
  ewai delivery approve-build SLUG --yes --approved-by NAME [--scope TEXT] [--project PATH]
  ewai delivery approve-manual-qa SLUG --yes --approved-by NAME --evidence PATH [--notes TEXT] [--project PATH]
  ewai delivery runs [SLUG] [--project PATH]
  ewai delivery runs --mark-stale [--hours N] [--project PATH]
  ewai afk preflight SLUG [--provider auto|claude|codex|antigravity] [--parallel N] [--project PATH]
  ewai afk start SLUG [--provider auto|claude|codex|antigravity] [--parallel N] [--timeout-minutes N] [--project PATH]
  ewai afk status [RUN_ID] [--project PATH]
  ewai afk pause RUN_ID [--project PATH]
  ewai afk resume RUN_ID [--project PATH]
  ewai afk cancel RUN_ID [--project PATH]
  ewai palace refresh [--project PATH]
  ewai palace status [--project PATH]
  ewai palace search QUERY [--limit N] [--project PATH]
  ewai palace tidiness [--project PATH]
  ewai palace housekeeping [--project PATH]
  ewai index refresh [--project PATH]
  ewai index status [--project PATH]
  ewai index freshness [--project PATH]
  ewai index coverage [--project PATH]
  ewai index profiles [--source core|technology|stack|organisation|project] [--analyser NAME] [--limit N] [--project PATH]
  ewai index files [--outcome OUTCOME] [--classification CLASS] [--profile ID] [--repository NAME] [--query TEXT] [--limit N] [--project PATH]
  ewai index search QUERY [--limit N] [--project PATH]
  ewai index graph TARGET [--limit N] [--project PATH]
  ewai index truth SLUG [--limit N] [--project PATH]
  ewai index similar SLUG [--limit N] [--project PATH]
  ewai index standards TARGET [--project PATH]
  ewai index standards-coverage SLUG [--project PATH]
  ewai pack list
  ewai persona index [--project PATH] [--query TEXT]
  ewai persona list [--project PATH] [--query TEXT]
  ewai persona create SLUG [--scope personal|project] [--project PATH] [--name NAME] [--category CATEGORY] [--force]
  ewai persona path [--scope personal|project] [--project PATH]
  ewai persona premium status [--project PATH]
  ewai persona premium configure [--project PATH] [--machine-name NAME]
  ewai persona premium sync [--project PATH] --yes
  ewai test-scenarios prepare SLUG [--focus TEXT] [--project PATH]
  ewai test-scenarios record SLUG --input FILE --reviewed-by NAME [--project PATH]
  ewai test-scenarios status SLUG [--project PATH]

Use --json for machine-readable output.`;
}

function selectedProject(args, allowUninitialised = false) {
  const explicit = option(args, '--project');
  if (explicit) return allowUninitialised ? resolve(explicit) : resolveProjectRoot(explicit);
  if (allowUninitialised) return process.cwd();
  return resolveProjectRoot(process.cwd());
}

function availablePersonaRoots(project = '') {
  const roots = [
    resolve(installRoot, 'packs/personas/core/personas'),
    personalPersonaRoot(),
    premiumPersonaRoot()
  ];
  if (project) {
    const { paths } = loadProjectConfig(resolve(project));
    roots.push(projectPersonaRoot(paths.projectRoot));
  }
  return roots;
}

function assertCompanionArguments(args) {
  const valued = new Set(['--project', '--focus']);
  const switches = new Set(['--json']);
  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index];
    if (switches.has(argument)) continue;
    if (valued.has(argument)) {
      if (args[index + 1] === undefined || String(args[index + 1]).startsWith('--')) throw new Error(`${argument} requires a value`);
      index += 1;
      continue;
    }
    throw new Error(`Unsupported companion argument: ${argument}`);
  }
}

function assertDesignSystemArguments(args, subcommand) {
  const valued = new Set(['--project']);
  if (subcommand === 'select') {
    valued.add('--expected-digest');
    valued.add('--approved-by');
  }
  if (subcommand === 'install') {
    valued.add('--scope');
    valued.add('--expected-digest');
  }
  if (subcommand === 'apply') {
    valued.add('--focus');
    valued.add('--budget');
  }
  const switches = new Set(['--json', ...(['select', 'install'].includes(subcommand) ? ['--yes'] : [])]);
  const positional = ['inspect', 'resolve', 'select', 'validate', 'install', 'apply'].includes(subcommand) ? 3 : 2;
  for (let index = positional; index < args.length; index += 1) {
    const argument = args[index];
    if (switches.has(argument)) continue;
    if (valued.has(argument)) {
      if (args[index + 1] === undefined || String(args[index + 1]).startsWith('--')) throw new Error(`${argument} requires a value`);
      index += 1;
      continue;
    }
    throw new Error(`Unsupported design-system argument: ${argument}`);
  }
}

function assertPortfolioArguments(args, subcommand) {
  const valued = new Set(['--project', ...(subcommand === 'status' ? ['--focus'] : [])]);
  const switches = new Set(['--json']);
  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index];
    if (switches.has(argument)) continue;
    if (valued.has(argument)) {
      if (args[index + 1] === undefined || String(args[index + 1]).startsWith('--')) {
        throw new Error(`${argument} requires a value`);
      }
      index += 1;
      continue;
    }
    throw new Error(`Unsupported portfolio argument: ${argument}`);
  }
}

function assertRolloutArguments(args, subcommand) {
  const valued = new Set(['--project', ...(subcommand === 'status' ? ['--focus'] : [])]);
  const switches = new Set(['--json']);
  const start = subcommand === 'assurance' ? 3 : 2;
  for (let index = start; index < args.length; index += 1) {
    const argument = args[index];
    if (switches.has(argument)) continue;
    if (valued.has(argument)) {
      if (args[index + 1] === undefined || String(args[index + 1]).startsWith('--')) throw new Error(`${argument} requires a value`);
      index += 1;
      continue;
    }
    throw new Error(`Unsupported rollout argument: ${argument}`);
  }
}

function assertTeamArguments(args, subcommand) {
  const valued = new Set(['--project']);
  const switches = new Set(['--json']);
  let start = 2;
  if (subcommand === 'connect') {
    start = 3;
    valued.add('--project-id');
    valued.add('--token-env');
    switches.add('--acknowledge-disclosure');
    switches.add('--yes');
  }
  if (subcommand === 'sync') {
    valued.add('--timeout-ms');
    switches.add('--yes');
  }
  if (subcommand === 'disconnect') switches.add('--yes');
  if (subcommand === 'resource') {
    const action = args[2];
    start = action === 'receipts' ? 3 : action === 'inspect' ? 5 : 5;
    if (action === 'install') {
      valued.add('--expected-digest');
      valued.add('--approved-by');
      switches.add('--yes');
    }
    if (!['inspect', 'install', 'receipts'].includes(action)) throw new Error(`Unknown team resource command: ${action ?? ''}`);
  }
  for (let index = start; index < args.length; index += 1) {
    const argument = args[index];
    if (switches.has(argument)) continue;
    if (valued.has(argument)) {
      if (args[index + 1] === undefined || String(args[index + 1]).startsWith('--')) throw new Error(`${argument} requires a value`);
      index += 1;
      continue;
    }
    throw new Error(`Unsupported team argument: ${argument}`);
  }
}

function assertTeamHubArguments(args, subcommand) {
  const valued = new Set(['--data', '--project']);
  const switches = new Set(['--json']);
  if (subcommand === 'start') {
    valued.add('--token-env');
    valued.add('--publisher-token-env');
    valued.add('--host');
    valued.add('--port');
    switches.add('--allow-network');
  }
  let start = 2;
  if (subcommand === 'resource') {
    if (args[2] !== 'publish') throw new Error(`Unknown team-hub resource command: ${args[2] ?? ''}`);
    start = 4;
    valued.add('--publisher-token-env');
    valued.add('--publisher-name');
    switches.add('--yes');
  }
  for (let index = start; index < args.length; index += 1) {
    const argument = args[index];
    if (switches.has(argument)) continue;
    if (valued.has(argument)) {
      if (args[index + 1] === undefined || String(args[index + 1]).startsWith('--')) throw new Error(`${argument} requires a value`);
      index += 1;
      continue;
    }
    throw new Error(`Unsupported team-hub argument: ${argument}`);
  }
}

export async function run(args) {
  const json = has(args, '--json');
  const command = args[0];
  const subcommand = args[1];

  try {
    if (!command || command === 'help' || has(args, '--help')) {
      print(usage());
      return;
    }

    if (command === 'init') {
      const result = initProject(selectedProject(args, true), {
        name: option(args, '--name'),
        specsRoot: option(args, '--specs') || undefined,
        initSpecsRepository: has(args, '--init-specs-repo'),
        validators: ['claude', 'codex', 'antigravity'].filter((validator) => has(args, `--${validator}`)),
        force: has(args, '--force')
      });
      print(json ? result : formatInitResult(result), json);
      return;
    }

    if (command === 'checkin') {
      const result = await checkinProject(selectedProject(args), { installRoot });
      print(json ? result : formatCheckin(result, { verbose: has(args, '--verbose') }), json);
      return;
    }

    if (command === 'dashboard' && ['preferences','configure'].includes(subcommand)) {
      const valueFlags=['--project','--enable','--disable','--expected-digest'];
      const booleanFlags=['--json','--yes','--collapse','--expand'];
      for(let index=2;index<args.length;index+=1){
        if(valueFlags.includes(args[index])){if(!args[index+1]||args[index+1].startsWith('--'))throw new Error('A dashboard preference option is missing its value.');index+=1;}
        else if(!booleanFlags.includes(args[index]))throw new Error('Unsupported dashboard preference option.');
      }
      const projectRoot=selectedProject(args),current=readDashboardPreferences(projectRoot);
      if(subcommand==='preferences'){
        print(json?current:current.views.map(v=>`${current.preferences.optional_views[v.id]?'On':'Off'} · ${v.title}: ${v.description}`).concat(`Sidebar: ${current.preferences.sidebar_collapsed?'collapsed':'expanded'}`).join('\n'),json);return;
      }
      const enable=options(args,'--enable'),disable=options(args,'--disable');
      if(enable.some(id=>disable.includes(id))||has(args,'--collapse')&&has(args,'--expand'))throw new Error('Choose one setting for each dashboard option.');
      if(!enable.length&&!disable.length&&!has(args,'--collapse')&&!has(args,'--expand'))throw new Error('Choose which dashboard preferences to change.');
      if([...enable,...disable].some(id=>!DASHBOARD_VIEWS.some(v=>v.id===id)))throw new Error('Unsupported dashboard view. Read dashboard preferences for the available options.');
      const preferences=current.preferences;
      for(const id of enable)preferences.optional_views[id]=true;
      for(const id of disable)preferences.optional_views[id]=false;
      if(has(args,'--collapse'))preferences.sidebar_collapsed=true;
      if(has(args,'--expand'))preferences.sidebar_collapsed=false;
      const saved=saveDashboardPreferences(projectRoot,{confirmed:has(args,'--yes'),expectedDigest:option(args,'--expected-digest'),preferences});
      print(json?saved:'Dashboard preferences saved. Required checks and approvals are unchanged.',json);return;
    }

    if (command === 'dashboard' || (command === 'server' && subcommand === 'start')) {
      const result = await ensureDashboard(selectedProject(args));
      print(json ? result : `EWAI pipeline dashboard: ${result.url}`, json);
      return;
    }

    if (command === 'server' && subcommand === 'status') {
      print(await dashboardStatus(selectedProject(args)), json);
      return;
    }

    if (command === 'server' && subcommand === 'stop') {
      print(await stopDashboard(selectedProject(args)), json);
      return;
    }

    if (command === 'mcp') {
      await import('./runtime/mcp-server.mjs');
      return;
    }

    if (command === 'team') {
      assertTeamArguments(args, subcommand);
      const projectRoot = selectedProject(args);
      if (subcommand === 'status') {
        print(readTeamHubWorkspace(projectRoot), json);
        return;
      }
      if (subcommand === 'disclosure') {
        print(inspectTeamHubDisclosure(), json);
        return;
      }
      if (subcommand === 'connect') {
        if (!has(args, '--yes')) throw new Error('Team Hub connection requires explicit --yes confirmation.');
        if (!has(args, '--acknowledge-disclosure')) throw new Error('Team Hub connection requires --acknowledge-disclosure.');
        const endpoint = args[2] ?? '';
        if (!endpoint || endpoint.startsWith('--')) throw new Error('Team Hub connection requires ENDPOINT.');
        print(connectTeamHub(projectRoot, {
          endpoint,
          projectId: option(args, '--project-id') || undefined,
          tokenEnv: option(args, '--token-env'),
          confirmed: true,
          disclosureAcknowledged: true,
        }), json);
        return;
      }
      if (subcommand === 'sync') {
        if (!has(args, '--yes')) throw new Error('Team Hub sync requires explicit --yes confirmation.');
        const timeout = option(args, '--timeout-ms');
        const result = await syncTeamHub(projectRoot, {
          confirmed: true,
          ...(timeout ? { timeoutMs: Number(timeout) } : {}),
        });
        print(result, json);
        if (result.attempt.status !== 'accepted') process.exitCode = 1;
        return;
      }
      if (subcommand === 'disconnect') {
        if (!has(args, '--yes')) throw new Error('Team Hub disconnect requires explicit --yes confirmation.');
        print(disconnectTeamHub(projectRoot, { confirmed: true }), json);
        return;
      }
      if (subcommand === 'resources') {
        print(await listConnectedTeamHubResources(projectRoot), json);
        return;
      }
      if (subcommand === 'resource') {
        const action = args[2];
        if (action === 'receipts') {
          print({ schema: 'ewai.team-hub-resource-receipts/v1', receipts: listTeamHubResourceReceipts(projectRoot) }, json);
          return;
        }
        const id = args[3] ?? '';
        const version = args[4] ?? '';
        if (!id || !version) throw new Error(`team resource ${action} requires ID and VERSION.`);
        if (action === 'inspect') {
          print(await inspectConnectedTeamHubResource(projectRoot, id, version), json);
          return;
        }
        if (action === 'install') {
          if (!has(args, '--yes')) throw new Error('Team Hub resource installation requires --yes confirmation.');
          print(await installConnectedTeamHubResource(projectRoot, {
            id, version, expectedDigest: option(args, '--expected-digest'), approvedBy: option(args, '--approved-by'), confirmed: true,
          }), json);
          return;
        }
      }
      throw new Error(`Unknown team command: ${subcommand ?? ''}`);
    }

    if (command === 'team-hub') {
      assertTeamHubArguments(args, subcommand);
      const dataRoot = option(args, '--data');
      if (!dataRoot) throw new Error('Team Hub service commands require --data PATH.');
      if (subcommand === 'start') {
        const port = option(args, '--port');
        print(await ensureTeamHub({
          dataRoot,
          tokenEnv: option(args, '--token-env'),
          publisherTokenEnv: option(args, '--publisher-token-env') || undefined,
          host: option(args, '--host', '127.0.0.1'),
          ...(port ? { port: Number(port) } : {}),
          allowNetwork: has(args, '--allow-network'),
        }), json);
        return;
      }
      if (subcommand === 'resource') {
        if (!has(args, '--yes')) throw new Error('Team Hub resource publication requires --yes confirmation.');
        const folder = args[3] ?? '';
        if (!folder || folder.startsWith('--')) throw new Error('Team Hub resource publication requires FOLDER.');
        const publisherTokenEnv = option(args, '--publisher-token-env');
        const publisherToken = String(process.env[publisherTokenEnv] ?? '');
        if (!publisherTokenEnv || !publisherToken) throw new Error(`Team Hub publisher token environment variable is unavailable: ${publisherTokenEnv || '<missing>'}`);
        const status = await teamHubStatus({ dataRoot });
        if (status.status !== 'running') throw new Error('Team Hub must be running before publishing a resource.');
        const resourcePackage = buildTeamHubResourcePackage(folder, { publisherName: option(args, '--publisher-name') });
        const response = await fetch(`${status.state.url}/api/v1/resources`, {
          method: 'POST',
          headers: { authorization: `Bearer ${publisherToken}`, 'content-type': 'application/json', 'idempotency-key': `${resourcePackage.resource.id}@${resourcePackage.resource.version}:${resourcePackage.digest}` },
          body: JSON.stringify(resourcePackage),
          signal: AbortSignal.timeout(8_000),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error?.message ?? `Team Hub rejected resource publication with HTTP ${response.status}.`);
        print(body, json);
        return;
      }
      if (subcommand === 'status') {
        print(await teamHubStatus({ dataRoot }), json);
        return;
      }
      if (subcommand === 'stop') {
        print(await stopTeamHub({ dataRoot }), json);
        return;
      }
      throw new Error(`Unknown team-hub command: ${subcommand ?? ''}`);
    }

    if (command === 'companion' && subcommand === 'status') {
      assertCompanionArguments(args);
      const project = selectedProject(args);
      print(readCompanionGuidance(project, {
        focus: option(args, '--focus'),
        personas: listPersonas(availablePersonaRoots(project)),
      }), json);
      return;
    }

    if (command === 'design-system' && ['status', 'list', 'inspect', 'resolve', 'select', 'validate', 'install', 'apply'].includes(subcommand)) {
      assertDesignSystemArguments(args, subcommand);
      const project = selectedProject(args);
      if (subcommand === 'status') {
        print(designSystemStatus(project), json);
        return;
      }
      const catalogue = listDesignSystems({ projectRoot: project });
      if (subcommand === 'list') {
        print({ schema: 'ewai.design-system-list/v1', systems: catalogue.map(projectDesignSystem) }, json);
        return;
      }
      const id = args[2] ?? '';
      if (!id || id.startsWith('--')) throw new Error(`design-system ${subcommand} requires ${['validate', 'install'].includes(subcommand) ? 'FOLDER' : subcommand === 'apply' ? 'DELIVERY_SLUG' : 'ID'}`);
      if (subcommand === 'validate') {
        print(validateDesignSystemCandidate(id), json);
        return;
      }
      if (subcommand === 'install') {
        if (!has(args, '--yes')) throw new Error('Design-system installation requires --yes confirmation');
        print(installDesignSystemCandidate(project, id, {
          scope: option(args, '--scope'), expectedDigest: option(args, '--expected-digest'), confirmed: true,
        }), json);
        return;
      }
      if (subcommand === 'apply') {
        const budget = option(args, '--budget');
        const result = applyDesignSystem(project, id, {
          focus: option(args, '--focus'),
          ...(budget ? { budgetTokens: Number(budget) } : {}),
          personaCatalogue: listPersonas(availablePersonaRoots(project)),
        });
        print(result, json);
        if (result.status !== 'applied') process.exitCode = 1;
        return;
      }
      if (subcommand === 'inspect') {
        const pack = catalogue.find((candidate) => candidate.id === id);
        if (!pack) throw new Error(`Unknown design system: ${id}`);
        print(projectDesignSystem(pack), json);
        return;
      }
      if (subcommand === 'resolve') {
        print(projectResolvedDesignSystem(resolveDesignSystem(id, catalogue)), json);
        return;
      }
      if (!has(args, '--yes')) throw new Error('Design-system selection requires --yes confirmation');
      print(selectDesignSystem(project, id, {
        expectedDigest: option(args, '--expected-digest'),
        approvedBy: option(args, '--approved-by'),
      }), json);
      return;
    }

    if (command === 'design-system') throw new Error(`Unknown design-system command: ${subcommand ?? ''}`);

    if (command === 'portfolio' && ['validate', 'status'].includes(subcommand)) {
      assertPortfolioArguments(args, subcommand);
      const project = selectedProject(args);
      const focus = option(args, '--focus');
      if (focus.length > 500) throw new Error('Portfolio focus exceeds 500 characters');
      const workspace = readPortfolioWorkspace(project, {
        focus,
        personas: listPersonas(availablePersonaRoots(project)),
      });
      if (subcommand === 'validate') {
        const valid = ['ready', 'attention'].includes(workspace.status);
        print({
          schema: 'ewai.portfolio-validation/v1',
          status: workspace.status,
          valid,
          diagnostics: workspace.diagnostics,
          memberCount: workspace.members.length,
          dependencyCount: workspace.dependencies.length,
          guide: workspace.guide,
        }, json);
        if (!valid) process.exitCode = 1;
        return;
      }
      print(workspace, json);
      if (workspace.status === 'invalid') process.exitCode = 1;
      return;
    }

    if (command === 'rollout' && ['validate', 'status', 'assurance'].includes(subcommand)) {
      assertRolloutArguments(args, subcommand);
      const project = selectedProject(args);
      const focus = option(args, '--focus');
      if (focus.length > 500 || focus.includes('\0')) throw new Error('Rollout focus exceeds 500 characters or contains unsafe text');
      if (subcommand === 'assurance' && !args[2]) throw new Error('rollout assurance requires PROJECT_ID');
      const workspace = readRolloutWorkspace(project, {
        focus,
        ...(subcommand === 'assurance' ? { projectId: args[2] } : {}),
        personas: listPersonas(availablePersonaRoots(project)),
      });
      if (subcommand === 'validate') {
        const valid = ['ready', 'attention'].includes(workspace.status);
        print({
          schema: 'ewai.rollout-validation/v1',
          status: workspace.status,
          valid,
          diagnostics: workspace.diagnostics,
          cohortCount: workspace.cohorts.length,
          projectCount: workspace.cohorts.reduce((count, cohort) => count + cohort.projects.length, 0),
          notices: workspace.notices,
          guide: workspace.guide,
        }, json);
        if (!valid) process.exitCode = 1;
        return;
      }
      print(workspace, json);
      if (workspace.status === 'invalid') process.exitCode = 1;
      return;
    }

    if (command === 'install') {
      const project = option(args, '--project');
      const result = install({
        scope: project ? 'project' : 'global',
        projectRoot: project ? resolve(project) : '',
        host: option(args, '--host', 'auto'),
        mode: option(args, '--mode', 'copy'),
        installBin: false,
        force: has(args, '--force')
      });
      print(result, json);
      return;
    }

    if (command === 'discover') {
      const projectRoot = selectedProject(args);
      const answersPath = option(args, '--answers');
      if (!answersPath && json) {
        throw new Error('Interactive discovery cannot use --json; provide --answers FILE');
      }
      if (answersPath) {
        const answers = loadDiscoveryAnswers(resolve(answersPath));
        const selectedStacks = options(args, '--stack');
        if (selectedStacks.length) {
          answers.delivery = { ...(answers.delivery ?? {}), technologyPacks: selectedStacks };
        }
        print(discoverProject(projectRoot, answers, { force: has(args, '--force') }), json);
      } else {
        print(await runDiscoveryInterview(projectRoot, { force: has(args, '--force') }), false);
      }
      return;
    }

    if (command === 'doctor') {
      const checks = doctorProject(selectedProject(args));
      print(checks, json);
      if (checks.some((check) => check.status === 'fail')) process.exitCode = 1;
      return;
    }

    if (command === 'context' && subcommand === 'register') {
      const sourcePath = args[2] ?? '';
      if (!sourcePath) throw new Error('Context registration requires a source folder');
      const result = registerContextSource(selectedProject(args), sourcePath, {
        confirmed: has(args, '--yes'),
        label: option(args, '--label'),
        classification: option(args, '--classification', 'confidential'),
        cloudProcessing: option(args, '--cloud-processing', 'unknown'),
        exclusions: options(args, '--exclude'),
        force: has(args, '--force')
      });
      print(result, json);
      return;
    }

    if (command === 'context' && subcommand === 'prepare') {
      const allowedValues = new Set(['--project', '--slug', '--task', '--phase', '--focus', '--budget', '--previous']);
      const allowedSwitches = new Set(['--json']);
      for (let index = 3; index < args.length; index += 1) {
        const argument = args[index];
        if (!argument.startsWith('--')) continue;
        if (!allowedValues.has(argument) && !allowedSwitches.has(argument)) throw new Error(`Unsupported context preparation option: ${argument}`);
        if (allowedValues.has(argument)) index += 1;
      }
      const profile = args[2] ?? '';
      const budgetValue = option(args, '--budget');
      const projectRoot = selectedProject(args);
      print(prepareProjectContext(projectRoot, {
        profile,
        slug: option(args, '--slug'),
        taskId: option(args, '--task'),
        phase: option(args, '--phase'),
        focus: option(args, '--focus'),
        budgetTokens: budgetValue ? Number(budgetValue) : undefined,
        previousDigest: option(args, '--previous'),
        personaCatalogue: listPersonas(availablePersonaRoots(projectRoot)),
      }), json);
      return;
    }

    if (command === 'context' && subcommand === 'benchmark') {
      const allowedValues = new Set(['--samples']);
      const allowedSwitches = new Set(['--json']);
      for (let index = 2; index < args.length; index += 1) {
        const argument = args[index];
        if (!argument.startsWith('--')) continue;
        if (!allowedValues.has(argument) && !allowedSwitches.has(argument)) throw new Error(`Unsupported context benchmark option: ${argument}`);
        if (allowedValues.has(argument)) index += 1;
      }
      const sampleValue = option(args, '--samples');
      const samples = sampleValue ? Number(sampleValue) : undefined;
      if (sampleValue && (!Number.isInteger(samples) || samples < 1 || samples > 100)) {
        throw new Error('Context benchmark samples must be an integer from 1 to 100');
      }
      const fixtures = JSON.parse(readFileSync(new URL('../tests/fixtures/context-benchmarks.json', import.meta.url), 'utf8'));
      const report = runContextBenchmark(fixtures, { samples });
      print(report, json);
      if (report.status !== 'pass') process.exitCode = 1;
      return;
    }

    if (command === 'context') throw new Error(`Unknown context command: ${subcommand ?? ''}`);

    if (command === 'meeting' && subcommand === 'register') {
      if (!has(args, '--yes')) throw new Error('Meeting source registration requires --yes confirmation');
      const file = args[2] ?? '';
      if (!file) throw new Error('Meeting source registration requires FILE');
      print(registerMeetingSource(selectedProject(args), file, {
        confirmed: true,
        label: option(args, '--label'),
        classification: option(args, '--classification', 'confidential'),
        cloudProcessing: option(args, '--cloud-processing', 'unknown'),
      }), json);
      return;
    }

    if (command === 'meeting' && subcommand === 'prepare') {
      const sourceId = args[2] ?? '';
      if (!sourceId) throw new Error('Meeting extraction preparation requires SOURCE_ID');
      print(prepareMeetingExtraction(selectedProject(args), sourceId, {
        focus: option(args, '--focus'),
      }), json);
      return;
    }

    if (command === 'meeting' && subcommand === 'review') {
      const project = selectedProject(args);
      const sourceId = args[2] ?? '';
      if (!sourceId) throw new Error('Meeting review requires SOURCE_ID');
      const inputPath = option(args, '--input');
      if (!inputPath) throw new Error('Meeting review requires --input FILE');
      const reviewedBy = option(args, '--reviewed-by');
      if (!reviewedBy) throw new Error('Meeting review requires --reviewed-by NAME');
      const safeInputPath = realpathSync(resolve(inputPath));
      const inputRelative = relative(project, safeInputPath);
      if (!inputRelative || inputRelative.startsWith('..') || isAbsolute(inputRelative)) {
        throw new Error('Meeting review --input must be a project-relative file');
      }
      let input;
      try {
        input = JSON.parse(readFileSync(safeInputPath, 'utf8'));
      } catch (error) {
        throw new Error(`Cannot read meeting review input: ${error.message}`);
      }
      print(recordMeetingReview(project, sourceId, {
        bundle: input.bundle,
        dispositions: input.dispositions,
        reviewedBy,
      }), json);
      return;
    }

    if (command === 'meeting' && subcommand === 'promote') {
      if (!has(args, '--yes')) throw new Error('Meeting evidence promotion requires --yes confirmation');
      const sourceId = args[2] ?? '';
      if (!sourceId) throw new Error('Meeting evidence promotion requires SOURCE_ID');
      const approvedBy = option(args, '--approved-by');
      if (!approvedBy) throw new Error('Meeting evidence promotion requires --approved-by NAME');
      print(promoteMeetingEvidence(selectedProject(args), sourceId, {
        confirmed: true,
        approvedBy,
      }), json);
      return;
    }

    if (command === 'meeting' && subcommand === 'status') {
      const sourceId = args[2]?.startsWith('--') ? '' : args[2] ?? '';
      print(readMeetingEvidenceWorkspace(selectedProject(args), {
        ...(sourceId ? { sourceId } : {}),
        focus: option(args, '--focus'),
      }), json);
      return;
    }

    if (command === 'meeting') throw new Error(`Unknown meeting command: ${subcommand ?? ''}`);

    if (command === 'knowledge' && subcommand === 'sources') {
      print({
        schema: 'ewai.knowledge-source-list/v1',
        sources: listKnowledgeSources(selectedProject(args)),
        notices: [KNOWLEDGE_PROPOSALS_DISCLAIMER],
      }, json);
      return;
    }

    if (command === 'knowledge' && subcommand === 'prepare') {
      const sourceRef = args[2] ?? '';
      if (!sourceRef || sourceRef.startsWith('--')) throw new Error('Knowledge proposal preparation requires SOURCE_REF');
      print(prepareKnowledgeProposals(selectedProject(args), sourceRef, { focus: option(args, '--focus') }), json);
      return;
    }

    if (command === 'knowledge' && ['record', 'review'].includes(subcommand)) {
      const project = selectedProject(args);
      const reference = args[2] ?? '';
      if (!reference || reference.startsWith('--')) throw new Error(`Knowledge proposal ${subcommand} requires ${subcommand === 'record' ? 'SOURCE_REF' : 'BUNDLE_ID'}`);
      const inputPath = option(args, '--input');
      if (!inputPath) throw new Error(`Knowledge proposal ${subcommand} requires --input FILE`);
      let safeInputPath;
      try {
        safeInputPath = realpathSync(resolve(inputPath));
      } catch {
        throw new Error(`Knowledge proposal ${subcommand} --input must be a readable project-relative file`);
      }
      const inputRelative = relative(project, safeInputPath);
      if (!inputRelative || inputRelative.startsWith('..') || isAbsolute(inputRelative)) {
        throw new Error(`Knowledge proposal ${subcommand} --input must be a project-relative file`);
      }
      let input;
      try {
        input = JSON.parse(readFileSync(safeInputPath, 'utf8'));
      } catch {
        throw new Error(`Cannot read knowledge proposal ${subcommand} input as JSON`);
      }
      if (subcommand === 'record') {
        print({
          ...recordKnowledgeProposalBundle(project, reference, { bundle: input.bundle, activePersonas: input.activePersonas }),
          notices: [KNOWLEDGE_PROPOSALS_DISCLAIMER],
        }, json);
        return;
      }
      const reviewedBy = option(args, '--reviewed-by');
      if (!reviewedBy) throw new Error('Knowledge proposal review requires --reviewed-by NAME');
      print({
        ...recordKnowledgeProposalReview(project, reference, { reviewedBy, dispositions: input.dispositions }),
        notices: [KNOWLEDGE_PROPOSALS_DISCLAIMER],
      }, json);
      return;
    }

    if (command === 'knowledge' && subcommand === 'materialise') {
      if (!has(args, '--yes')) throw new Error('Knowledge proposal materialisation requires --yes confirmation');
      const bundleId = args[2] ?? '';
      if (!bundleId || bundleId.startsWith('--')) throw new Error('Knowledge proposal materialisation requires BUNDLE_ID');
      const approvedBy = option(args, '--approved-by');
      if (!approvedBy) throw new Error('Knowledge proposal materialisation requires --approved-by NAME');
      print({
        ...materialiseKnowledgeProposals(selectedProject(args), bundleId, { confirmed: true, approvedBy }),
        notices: [KNOWLEDGE_PROPOSALS_DISCLAIMER],
      }, json);
      return;
    }

    if (command === 'knowledge' && subcommand === 'recover') {
      if (!has(args, '--yes')) throw new Error('Knowledge proposal recovery requires --yes confirmation');
      const bundleId = args[2] ?? '';
      if (!bundleId || bundleId.startsWith('--')) throw new Error('Knowledge proposal recovery requires BUNDLE_ID');
      print({
        ...recoverKnowledgeMaterialisation(selectedProject(args), bundleId, { confirmed: true }),
        notices: [KNOWLEDGE_PROPOSALS_DISCLAIMER],
      }, json);
      return;
    }

    if (command === 'knowledge' && subcommand === 'status') {
      const bundleId = args[2]?.startsWith('--') ? '' : args[2] ?? '';
      print(readKnowledgeProposalWorkspace(selectedProject(args), { ...(bundleId ? { bundleId } : {}) }), json);
      return;
    }

    if (command === 'knowledge') throw new Error(`Unknown knowledge command: ${subcommand ?? ''}`);

    if (command === 'hook' && subcommand === 'catalogue') {
      print({ schema: 'ewai.lifecycle-event-catalogue/v1', events: LIFECYCLE_EVENT_CATALOGUE }, json);
      return;
    }

    if (command === 'hook' && subcommand === 'validate') {
      const folder = args[2] ?? '';
      if (!folder) throw new Error('Lifecycle hook validation requires a handler folder');
      print(validateLifecycleHandlerPackage(selectedProject(args), resolve(folder)), json);
      return;
    }

    if (command === 'hook' && subcommand === 'register') {
      const folder = args[2] ?? '';
      if (!folder) throw new Error('Lifecycle hook registration requires a handler folder');
      print(registerLifecycleHandler(selectedProject(args), resolve(folder), { confirmed: has(args, '--yes') }), json);
      return;
    }

    if (command === 'hook' && subcommand === 'subscribe') {
      const handlerId = args[2] ?? '';
      const patterns = option(args, '--events').split(',').map((value) => value.trim()).filter(Boolean);
      if (!handlerId) throw new Error('Lifecycle hook subscription requires a handler ID');
      if (!patterns.length) throw new Error('Lifecycle hook subscription requires --events EVENT[,EVENT]');
      print(subscribeLifecycleHandler(selectedProject(args), handlerId, patterns, { confirmed: has(args, '--yes') }), json);
      return;
    }

    if (command === 'hook' && ['list', 'deliveries'].includes(subcommand)) {
      const projectRoot = selectedProject(args);
      reconcileCanonicalLifecycleEvents(projectRoot);
      const workspace = readLifecycleHookWorkspace(projectRoot, {
        status: option(args, '--status'),
        event: option(args, '--event'),
        handler: option(args, '--handler'),
      });
      print(subcommand === 'deliveries'
        ? { schema: workspace.schema, summary: workspace.summary, deliveries: workspace.deliveries, attempts: workspace.attempts }
        : workspace, json);
      return;
    }

    if (command === 'hook' && subcommand === 'retry') {
      const deliveryId = args[2] ?? '';
      if (!deliveryId) throw new Error('Lifecycle hook retry requires a delivery ID');
      print(retryLifecycleDelivery(selectedProject(args), deliveryId, { confirmed: has(args, '--yes') }), json);
      return;
    }

    if (command === 'hook' && subcommand === 'disable') {
      const subscriptionId = args[2] ?? '';
      if (!subscriptionId) throw new Error('Lifecycle hook disable requires a subscription ID');
      print(disableLifecycleSubscription(selectedProject(args), subscriptionId, { confirmed: has(args, '--yes') }), json);
      return;
    }

    if (command === 'archaeology' && subcommand === 'validate') {
      const bundlePath = args[2] ?? '';
      if (!bundlePath) throw new Error('Archaeology validation requires a bundle path');
      const result = validateArchaeologyBundle(selectedProject(args), bundlePath);
      print(result, json);
      if (!result.valid) process.exitCode = 1;
      return;
    }

    if (command === 'archaeology' && subcommand === 'prepare-personas') {
      const bundlePath = args[2] ?? '';
      if (!bundlePath) throw new Error('Archaeology persona preparation requires a bundle path');
      const projectRoot = selectedProject(args);
      const personas = indexPersonas(availablePersonaRoots(projectRoot));
      print(prepareArchaeologyPersonaGate(projectRoot, bundlePath, personas, { force: has(args, '--force') }), json);
      return;
    }

    if (command === 'archaeology' && subcommand === 'validate-personas') {
      const bundlePath = args[2] ?? '';
      if (!bundlePath) throw new Error('Archaeology persona validation requires a bundle path');
      const result = validateArchaeologyPersonaGate(selectedProject(args), bundlePath);
      print(result, json);
      if (!result.valid) process.exitCode = 1;
      return;
    }

    if (command === 'archaeology' && subcommand === 'prepare-technology-hosting') {
      const bundlePath = args[2] ?? '';
      if (!bundlePath) throw new Error('Archaeology technology and hosting preparation requires a bundle path');
      print(prepareArchaeologyTechnologyHosting(selectedProject(args), bundlePath, { force: has(args, '--force') }), json);
      return;
    }

    if (command === 'archaeology' && subcommand === 'record-technology-hosting') {
      const project = selectedProject(args);
      const bundlePath = args[2] ?? '';
      if (!bundlePath) throw new Error('Archaeology technology and hosting recording requires a bundle path');
      const inputPath = option(args, '--input');
      if (!inputPath) throw new Error('Archaeology technology and hosting recording requires --input FILE');
      const reviewedBy = option(args, '--reviewed-by');
      if (!reviewedBy) throw new Error('Archaeology technology and hosting recording requires --reviewed-by NAME');
      const safeInputPath = realpathSync(resolve(inputPath));
      const inputRelative = relative(project, safeInputPath);
      if (!inputRelative || inputRelative.startsWith('..') || isAbsolute(inputRelative)) {
        throw new Error('Archaeology technology and hosting --input must be a project-relative file');
      }
      let input;
      try {
        input = JSON.parse(readFileSync(safeInputPath, 'utf8'));
      } catch (error) {
        throw new Error(`Cannot read technology and hosting input: ${error.message}`);
      }
      print(recordArchaeologyTechnologyHosting(project, bundlePath, input, { reviewedBy }), json);
      return;
    }

    if (command === 'archaeology' && subcommand === 'technology-hosting-status') {
      const bundlePath = args[2] ?? '';
      if (!bundlePath) throw new Error('Archaeology technology and hosting status requires a bundle path');
      print(readArchaeologyTechnologyHosting(selectedProject(args), bundlePath), json);
      return;
    }

    if (command === 'archaeology' && subcommand === 'depth-status') {
      const project = selectedProject(args);
      const personas = indexPersonas(availablePersonaRoots(project));
      print(readEvidenceDepthWorkspace(project, { personas }), json);
      return;
    }

    if (command === 'archaeology' && subcommand === 'depth-prepare') {
      const project = selectedProject(args);
      const personas = indexPersonas(availablePersonaRoots(project));
      const inputPath = option(args, '--input');
      const supplied = inputPath ? readProjectJsonInput(project, inputPath, 'Archaeology evidence-depth preparation') : {};
      if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) throw new Error('Archaeology evidence-depth preparation input must be an object');
      const unknown = Object.keys(supplied).filter((key) => !['focus', 'ownerEvidence'].includes(key));
      if (unknown.length) throw new Error(`Archaeology evidence-depth preparation input has unknown field ${unknown[0]}`);
      print(prepareEvidenceDepthWorkspace(
        project,
        { focus: option(args, '--focus', supplied.focus ?? '') },
        { personas, ownerEvidence: supplied.ownerEvidence ?? [] },
      ), json);
      return;
    }

    if (command === 'archaeology' && subcommand === 'depth-record') {
      const project = selectedProject(args);
      const input = readProjectJsonInput(project, option(args, '--input'), 'Archaeology evidence-depth recording');
      print(recordEvidenceDepthWorkspaceRun(project, input), json);
      return;
    }

    if (command === 'archaeology' && subcommand === 'depth-compare') {
      const leftRunId = args[2] ?? '';
      const rightRunId = args[3] ?? '';
      if (!leftRunId || !rightRunId) throw new Error('Archaeology evidence-depth comparison requires two run IDs');
      print(compareEvidenceDepthWorkspaceRuns(selectedProject(args), { leftRunId, rightRunId }), json);
      return;
    }

    if (command === 'archaeology' && subcommand === 'prepare-review') {
      const bundlePath = args[2] ?? '';
      if (!bundlePath) throw new Error('Archaeology review preparation requires a bundle path');
      print(prepareArchaeologyReview(selectedProject(args), bundlePath, { force: has(args, '--force') }), json);
      return;
    }

    if (command === 'prototype-review') {
      const project = selectedProject(args);
      const slug = args[2] ?? '';
      if (!slug) throw new Error(`Prototype review ${subcommand || 'command'} requires a delivery slug`);
      const personas = indexPersonas(availablePersonaRoots(project));
      if (subcommand === 'status') {
        print(readPrototypeIterationWorkspace(project, slug, { personas }), json);
        return;
      }
      if (['plan-prepare', 'plan-record', 'cycle-prepare', 'cycle-record'].includes(subcommand)) {
        const input = readProjectJsonInput(project, option(args, '--input'), `Prototype review ${subcommand}`);
        const operation = {
          'plan-prepare': () => preparePrototypePlanWorkspace(project, slug, input, { personas }),
          'plan-record': () => recordPrototypePlanWorkspaceReview(project, slug, input),
          'cycle-prepare': () => preparePrototypeCycleWorkspace(project, slug, input, { personas }),
          'cycle-record': () => recordPrototypeCycleWorkspaceReview(project, slug, input),
        }[subcommand];
        print(operation(), json);
        return;
      }
      if (subcommand === 'compare') {
        const leftDigest = args[3] ?? '';
        const rightDigest = args[4] ?? '';
        if (!leftDigest || !rightDigest) throw new Error('Prototype review comparison requires left and right digests');
        print(comparePrototypeWorkspaceReviews(project, slug, { leftDigest, rightDigest }), json);
        return;
      }
      throw new Error(`Unsupported prototype-review command: ${subcommand || '(missing)'}`);
    }

    if (command === 'archaeology' && subcommand === 'curate') {
      const bundlePath = args[2] ?? '';
      if (!bundlePath) throw new Error('Archaeology curation requires a bundle path');
      print(curateArchaeologyBundle(selectedProject(args), bundlePath, {
        confirmed: has(args, '--yes'),
        approvedBy: option(args, '--approved-by')
      }), json);
      return;
    }

    if (command === 'archaeology' && subcommand === 'validate-completion') {
      const bundlePath = args[2] ?? '';
      if (!bundlePath) throw new Error('Archaeology completion validation requires a bundle path');
      const result = validateArchaeologyCompletion(selectedProject(args), bundlePath);
      print(result, json);
      if (!result.valid) process.exitCode = 1;
      return;
    }

    if (command === 'validation' && subcommand === 'list') {
      const { config } = loadProjectConfig(selectedProject(args));
      const orchestrator = option(args, '--orchestrator', 'manual');
      const status = validationStatus(config, orchestrator);
      if (json) {
        print(status, true);
        return;
      }
      const providers = externalValidationStatus(config, orchestrator);
      const lines = [
        'Standards compliance\trequired; no waiver',
        ...providers.map((provider) => (
          `${provider.validator}\t${provider.state}\t${provider.enabled ? 'enabled' : 'disabled'}${
            provider.excluded_as_orchestrator ? '\texcluded (orchestrator)' : ''
          }`
        )),
        ...Object.entries(status.checkpoints).map(([checkpoint, setting]) => (
          `${checkpoint}\t${setting.max_cycles} cycle(s)\t${
            setting.validators.join(',') || 'no independent validator'
          }\t${setting.review.breadth}/${setting.review.depth}/${setting.review.output}`
        )),
      ];
      print(lines);
      return;
    }

    if (command === 'validation' && subcommand === 'set') {
      const validator = args[2] ?? '';
      const state = args[3] ?? '';
      const enabled = has(args, '--enabled') ? true : has(args, '--disabled') ? false : undefined;
      print(configureExternalValidation(selectedProject(args), validator, state, enabled), json);
      return;
    }

    if (command === 'validation' && subcommand === 'checkpoint') {
      const checkpoint = args[2] ?? '';
      const update = {};
      const cycles = option(args, '--cycles');
      if (cycles) update.max_cycles = Number.parseInt(cycles, 10);
      const validators = option(args, '--validators');
      if (validators) {
        update.validators = validators === 'auto'
          ? 'auto'
          : validators.split(',').map((value) => value.trim()).filter(Boolean);
      }
      if (has(args, '--enabled')) update.enabled = true;
      if (has(args, '--disabled')) update.enabled = false;
      const review = {};
      for (const field of ['breadth', 'depth', 'output']) {
        const value = option(args, `--${field}`);
        if (value) review[field] = value;
      }
      if (Object.keys(review).length) update.review = review;
      print(configureValidationCheckpoint(selectedProject(args), checkpoint, update), json);
      return;
    }

    if (command === 'security') {
      const projectRoot = selectedProject(args);
      const personas = listPersonas(availablePersonaRoots(projectRoot));
      if (subcommand === 'status') return printSecurity(readSecurityWorkspace(projectRoot, { personas }), json);
      if (subcommand === 'providers') return printSecurity(discoverSecurityProviders(projectRoot), json);
      if (subcommand === 'adapters') return printSecurity(listSecurityAdapters(projectRoot), json);
      if (subcommand === 'runs') return printSecurity(listSecurityRuns(projectRoot), json);
      if (subcommand === 'findings') return printSecurity(listSecurityFindings(projectRoot), json);
      if (subcommand === 'dispositions') return printSecurity(listSecurityDispositions(projectRoot), json);
      if (subcommand === 'adapter-validate') {
        const folder = args[2] ?? '';
        if (!folder) throw new Error('Security adapter validation requires a folder.');
        return printSecurity(validateSecurityAdapter(projectRoot, resolve(folder)), json);
      }
      if (subcommand === 'adapter-register') {
        const folder = args[2] ?? '';
        if (!folder) throw new Error('Security adapter registration requires a folder.');
        if (!has(args, '--yes')) throw new Error('Security adapter registration requires explicit --yes confirmation.');
        return printSecurity(registerSecurityAdapter(projectRoot, resolve(folder), { confirmed: true }), json);
      }
      if (subcommand === 'run') {
        if (!has(args, '--yes')) throw new Error('Security run requires explicit --yes confirmation.');
        const profileId = args[2] ?? '';
        if (!profileId) throw new Error('Security run requires a profile ID.');
        const prepared = prepareSecurityRun(projectRoot, profileId, {
          confirmed: true,
          mode: option(args, '--mode') || undefined,
          confirmedRuntimeTarget: has(args, '--confirm-runtime-target'),
          trustedRevision: resolveSecurityRevision(projectRoot),
        });
        return printSecurity(prepared.run ? await executeSecurityRun(projectRoot, prepared.run.id) : prepared, json);
      }
      if (subcommand === 'import-prepare') {
        const profileId = args[2] ?? '';
        const providerId = option(args, '--provider');
        if (!profileId || !providerId) throw new Error('Security import preparation requires PROFILE and --provider PROVIDER.');
        return printSecurity(prepareSecurityArtifactImport(projectRoot, profileId, providerId, {
          trustedRevision: resolveSecurityRevision(projectRoot),
        }), json);
      }
      if (subcommand === 'import') {
        if (!has(args, '--yes')) throw new Error('Security artefact import requires explicit --yes confirmation.');
        return printSecurity(importSecurityArtifacts(projectRoot, args[2] ?? '', { confirmed: true }), json);
      }
      if (subcommand === 'cancel') {
        if (!has(args, '--yes')) throw new Error('Security run cancellation requires explicit --yes confirmation.');
        return printSecurity(cancelSecurityRun(projectRoot, args[2] ?? '', { confirmed: true }), json);
      }
      if (subcommand === 'disposition') {
        if (!has(args, '--yes')) throw new Error('Security disposition requires explicit --yes confirmation.');
        return printSecurity(recordSecurityDisposition(projectRoot, args[2] ?? '', {
          decision: option(args, '--decision'),
          reviewer: option(args, '--reviewer'),
          reason: option(args, '--reason'),
          evidence: options(args, '--evidence'),
          riskOwner: option(args, '--risk-owner'),
          expiresAt: option(args, '--expires-at'),
          nextRole: option(args, '--next-role'),
        }), json);
      }
      throw new Error(`Unknown security command: ${args.slice(1).join(' ')}`);
    }

    if (command === 'error-report') {
      const projectRoot = selectedProject(args);
      const reportId = args[2] ?? '';
      if (subcommand === 'status') return print(listLocalErrorReports(projectRoot, { status: option(args, '--status') }), json);
      if (subcommand === 'show') {
        if (!reportId) throw new Error('error-report show requires REPORT.');
        const report = readLocalErrorReport(projectRoot, reportId);
        if (!report) throw new Error('Error report not found.');
        return print({ report, ...listErrorReportReceipts(projectRoot, reportId) }, json);
      }
      if (subcommand === 'create') {
        const packageVersion = JSON.parse(readFileSync(resolve(installRoot, 'package.json'), 'utf8')).version;
        return print(createLocalErrorReport(projectRoot, {
          capability: option(args, '--capability'),
          errorCode: option(args, '--error-code'),
          command: option(args, '--command'),
          ewaiVersion: packageVersion,
          nodeVersion: process.versions.node,
          osClass: ['darwin', 'linux', 'win32'].includes(process.platform) ? process.platform : 'other',
          installationSource: option(args, '--installation-source', 'npm'),
          title: option(args, '--title'),
          expected: option(args, '--expected'),
          actual: option(args, '--actual'),
          reproductionSteps: options(args, '--step'),
        }), json);
      }
      if (subcommand === 'update') {
        if (!reportId) throw new Error('error-report update requires REPORT.');
        const changes = {};
        for (const [flag, field] of [['--title', 'title'], ['--expected', 'expected'], ['--actual', 'actual']]) {
          if (has(args, flag)) changes[field] = option(args, flag);
        }
        if (has(args, '--step')) changes.reproductionSteps = options(args, '--step');
        return print(updateLocalErrorReport(projectRoot, reportId, changes), json);
      }
      if (subcommand === 'finalise') {
        if (!reportId) throw new Error('error-report finalise requires REPORT.');
        return print(finaliseLocalErrorReport(projectRoot, reportId), json);
      }
      if (subcommand === 'prepare-email') {
        if (!reportId) throw new Error('error-report prepare-email requires REPORT.');
        return print(prepareErrorReportEmail(projectRoot, reportId, {
          expectedDigest: option(args, '--expected-digest'), recipient: option(args, '--recipient') || undefined,
          launch: has(args, '--launch'),
        }), json);
      }
      if (subcommand === 'providers') return print(listErrorReportProviders(projectRoot), json);
      if (subcommand === 'receipts') {
        if (!reportId) throw new Error('error-report receipts requires REPORT.');
        return print(listErrorReportReceipts(projectRoot, reportId), json);
      }
      if (subcommand === 'send') {
        if (!has(args, '--yes')) throw new Error('error-report send requires explicit --yes confirmation.');
        if (!reportId || !option(args, '--provider') || !option(args, '--expected-digest')) throw new Error('error-report send requires REPORT, --provider and --expected-digest.');
        return print(await submitErrorReportProvider(projectRoot, reportId, option(args, '--provider'), {
          confirmed: true, expectedDigest: option(args, '--expected-digest'),
          ...(option(args, '--timeout-ms') ? { timeoutMs: Number(option(args, '--timeout-ms')) } : {}),
        }), json);
      }
      if (subcommand === 'archive') {
        if (!has(args, '--yes')) throw new Error('error-report archive requires explicit --yes confirmation.');
        return print(archiveErrorReport(projectRoot, reportId, { confirmed: true }), json);
      }
      if (subcommand === 'delete') {
        if (!has(args, '--yes')) throw new Error('error-report delete requires explicit --yes confirmation.');
        return print(deleteErrorReport(projectRoot, reportId, { confirmed: true }), json);
      }
      if (subcommand === 'settings') {
        const update = {};
        if (has(args, '--automatic-local-drafts')) {
          const value = option(args, '--automatic-local-drafts');
          if (!['true', 'false'].includes(value)) throw new Error('--automatic-local-drafts must be true or false.');
          update.automaticLocalDrafts = value === 'true';
        }
        if (has(args, '--support-email')) update.supportEmail = option(args, '--support-email');
        return print(updateErrorReportSettings(projectRoot, update), json);
      }
      if (subcommand === 'adapter-validate') {
        if (!reportId) throw new Error('error-report adapter-validate requires FOLDER.');
        return print(validateErrorReportProvider(resolve(reportId)), json);
      }
      if (subcommand === 'adapter-register') {
        if (!has(args, '--yes')) throw new Error('error-report adapter-register requires explicit --yes confirmation.');
        if (!reportId) throw new Error('error-report adapter-register requires FOLDER.');
        return print(registerErrorReportProvider(projectRoot, resolve(reportId), { confirmed: true }), json);
      }
      throw new Error(`Unknown error-report command: ${args.slice(1).join(' ')}`);
    }

    if (command === 'policy') {
      const projectRoot = selectedProject(args);
      const personas = listPersonas(availablePersonaRoots(projectRoot));
      if (subcommand === 'status') {
        return printPolicy(readPolicyWorkspace(projectRoot, {
          intentReference: args[2] ?? option(args, '--intent'),
          mode: option(args, '--mode', 'business'),
          personas,
        }), json);
      }
      if (!['confirm-facts', 'evaluate', 'review', 'exception'].includes(subcommand)) {
        throw new Error(`Unknown policy command: ${subcommand ?? ''}`);
      }
      const input = readProjectJsonInput(projectRoot, option(args, '--input'), `policy ${subcommand ?? 'action'}`);
      if (subcommand === 'confirm-facts') return printPolicy(confirmPolicyFactsAction(projectRoot, input, { personas }), json);
      if (subcommand === 'evaluate') return printPolicy(evaluatePolicyDesignAction(projectRoot, input, { personas }), json);
      if (subcommand === 'review') return printPolicy(recordPolicyReviewAction(projectRoot, input, { personas }), json);
      if (subcommand === 'exception') return printPolicy(recordPolicyExceptionAction(projectRoot, input, { personas }), json);
    }

    if (command === 'readiness') {
      if (subcommand === 'profiles') {
        return printReadiness({
          schema: 'ewai.solution-readiness-profiles/v1',
          profiles: listSolutionReadinessProfiles(),
          notices: [ASSURANCE_NOTICE, READINESS_AUTHORITY_NOTICE],
        }, json);
      }
      const projectRoot = selectedProject(args);
      if (subcommand === 'prepare') {
        const slug = args[2];
        const profile = option(args, '--profile');
        if (!slug) throw new Error('readiness prepare requires SLUG');
        if (!profile) throw new Error('readiness prepare requires --profile PROFILE');
        return printReadiness(prepareSolutionReadinessReview(projectRoot, slug, profile, {
          personaCatalogue: listPersonas(availablePersonaRoots(projectRoot)),
        }), json);
      }
      if (subcommand === 'review') {
        const assessmentId = args[2];
        const inputPath = option(args, '--input');
        const reviewedBy = option(args, '--reviewed-by');
        if (!assessmentId) throw new Error('readiness review requires ASSESSMENT');
        if (!inputPath) throw new Error('readiness review requires --input FILE');
        if (!reviewedBy) throw new Error('readiness review requires --reviewed-by NAME');
        const candidateInputPath = resolve(inputPath);
        let safeInputPath;
        try { safeInputPath = realpathSync(candidateInputPath); }
        catch { throw new Error('Cannot read readiness review input file'); }
        const inputRelative = relative(projectRoot, safeInputPath);
        if (!inputRelative || inputRelative.startsWith('..') || isAbsolute(inputRelative)) throw new Error('readiness --input must resolve to a project-relative file');
        let input;
        try { input = JSON.parse(readFileSync(safeInputPath, 'utf8')); }
        catch { throw new Error('Cannot parse readiness review input JSON'); }
        return printReadiness(recordSolutionReadinessReview(projectRoot, assessmentId, input, { reviewedBy }), json);
      }
      if (subcommand === 'status') {
        const assessmentId = args[2];
        if (!assessmentId) throw new Error('readiness status requires ASSESSMENT');
        return printReadiness(readSolutionReadinessStatus(projectRoot, assessmentId), json);
      }
      throw new Error(`Unknown readiness command: ${subcommand ?? ''}`);
    }

    if (command === 'starter') {
      const projectRoot = selectedProject(args);
      const personas = listPersonas(availablePersonaRoots(projectRoot));
      if (subcommand === 'status') {
        return print(readStarterMaterialisationWorkspace(projectRoot, {
          personas: selectStarterPersonas(personas, 'review'),
        }), json);
      }
      if (subcommand === 'adapters') return print(listStarterAdapters(projectRoot), json);
      if (subcommand === 'digest') {
        const assignments = [];
        for (const value of args.slice(2)) {
          if (value.startsWith('--')) break;
          assignments.push(value);
        }
        if (!assignments.length) throw new Error('starter digest requires one or more ROLE=FOLDER targets');
        const roles = new Set();
        const targets = assignments.map((assignment) => {
          const separator = assignment.indexOf('=');
          const role = separator > 0 ? assignment.slice(0, separator) : '';
          const folder = separator > 0 ? assignment.slice(separator + 1) : '';
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(role) || roles.has(role) || !folder) {
            throw new Error(`starter digest target must be a unique ROLE=FOLDER value: ${assignment}`);
          }
          roles.add(role);
          const tree = canonicalStarterTree(realpathSync(resolve(folder)));
          return {
            role,
            digest: starterTreeDigest(tree),
            files: tree.length,
            bytes: tree.reduce((total, file) => total + file.bytes, 0),
          };
        });
        return print({
          schema: 'ewai.governed-starter-pack-digest/v1',
          targets,
          digest: starterPackDigest(targets),
        }, json);
      }
      if (subcommand === 'adapter-validate') {
        const folder = args[2];
        if (!folder) throw new Error('starter adapter-validate requires FOLDER');
        return print(validateStarterAdapterPackage(folder), json);
      }
      if (subcommand === 'adapter-register') {
        if (!has(args, '--yes')) throw new Error('starter adapter-register requires --yes because the package is trusted local code');
        const folder = args[2];
        if (!folder) throw new Error('starter adapter-register requires FOLDER');
        return print(registerStarterAdapter(projectRoot, folder, { confirmed: true }), json);
      }
      if (subcommand === 'preview') {
        if (!has(args, '--yes')) throw new Error('starter preview requires --yes');
        const receiptId = args[2];
        const adapterId = option(args, '--adapter');
        if (!receiptId || !adapterId) throw new Error('starter preview requires RECEIPT and --adapter ADAPTER');
        const timeout = option(args, '--timeout-ms');
        return print(await prepareStarterMaterialisation(projectRoot, receiptId, adapterId, {
          confirmed: true,
          ...(timeout ? { timeoutMs: Number(timeout) } : {}),
        }), json);
      }
      if (subcommand === 'apply') {
        if (!has(args, '--yes')) throw new Error('starter apply requires --yes');
        const approvedBy = option(args, '--approved-by');
        if (!approvedBy) throw new Error('starter apply requires --approved-by NAME');
        const previewId = args[2];
        if (!previewId) throw new Error('starter apply requires PREVIEW');
        return print(applyStarterMaterialisation(projectRoot, previewId, {
          confirmed: true,
          approvedBy,
          personas: selectStarterPersonas(personas, 'apply'),
        }), json);
      }
      if (subcommand === 'recover') {
        if (!has(args, '--yes')) throw new Error('starter recover requires --yes');
        const attemptId = args[2];
        if (!attemptId) throw new Error('starter recover requires ATTEMPT');
        return print(recoverStarterMaterialisation(projectRoot, attemptId, { confirmed: true }), json);
      }
      throw new Error(`Unknown starter command: ${subcommand ?? ''}`);
    }

    if (command === 'intent' && subcommand === 'create') {
      const slug = args[2] ?? '';
      const deliveryShapePath = option(args, '--delivery-shape');
      const result = createIntent(selectedProject(args), {
        slug,
        domain: option(args, '--domain', 'general'),
        title: option(args, '--title'),
        personas: options(args, '--persona'),
        deliveryShape: deliveryShapePath
          ? YAML.parse(readFileSync(resolve(deliveryShapePath), 'utf8'))
          : null,
        force: has(args, '--force')
      });
      print(result, json);
      return;
    }

    if (command === 'intent' && subcommand === 'map-create') {
      const requestPath = args[2] ?? '';
      if (!requestPath) throw new Error('Intent map creation requires a JSON or YAML request file');
      const request = loadIntentMapRequest(resolve(requestPath));
      print(createIntentMap(selectedProject(args), request, {
        confirmed: has(args, '--yes'),
        approvedBy: option(args, '--approved-by'),
      }), json);
      return;
    }

    if (command === 'intent' && subcommand === 'audit-state') {
      print(auditIntentStateCopies(selectedProject(args), { repairMissing: true }), json);
      return;
    }

    if (command === 'delivery' && subcommand === 'begin') {
      const slug = args[2] ?? '';
      print(beginDelivery(selectedProject(args), slug, {
        tool: option(args, '--tool', 'manual'),
        ideate: has(args, '--ideate'),
        existingCode: has(args, '--existing-code'),
        ui: has(args, '--ui'),
        mode: option(args, '--mode', 'normal'),
        intensity: option(args, '--intensity') || undefined
      }), json);
      return;
    }

    if (command === 'delivery' && subcommand === 'status') {
      print(readDeliveryState(selectedProject(args), args[2] ?? ''), json);
      return;
    }

    if (command === 'delivery' && subcommand === 'validation-cycle') {
      const slug = args[2] ?? '';
      const phaseId = args[3] ?? '';
      print(recordExternalValidationCycle(selectedProject(args), slug, phaseId, {
        provider: option(args, '--provider'),
        outcome: option(args, '--outcome'),
        responsePath: option(args, '--response') || undefined,
        fixPath: option(args, '--fix') || undefined,
        notes: option(args, '--notes'),
      }), json);
      return;
    }

    if (command === 'delivery' && subcommand === 'continue') {
      print(continueDelivery(selectedProject(args), args[2] ?? ''), json);
      return;
    }

    if (command === 'delivery' && subcommand === 'resume') {
      print(resumeShelvedDelivery(selectedProject(args), args[2] ?? '', {
        tool: option(args, '--tool', 'manual')
      }), json);
      return;
    }

    if (command === 'delivery' && subcommand === 'gate') {
      const inputPath = option(args, '--input');
      if (!inputPath) throw new Error('A phase gate requires --input FILE');
      const input = JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
      print(recordPhaseGate(selectedProject(args), args[2] ?? '', args[3] ?? '', input), json);
      return;
    }

    if (command === 'delivery' && subcommand === 'gate-template') {
      print(phaseGateTemplate(selectedProject(args), args[2] ?? '', args[3] ?? ''), true);
      return;
    }

    if (command === 'delivery' && subcommand === 'phase-start') {
      print(startDeliveryPhase(selectedProject(args), args[2] ?? '', args[3] ?? ''), json);
      return;
    }

    if (command === 'delivery' && subcommand === 'phase-complete') {
      print(completeDeliveryPhase(selectedProject(args), args[2] ?? '', args[3] ?? '', {
        artefactPath: option(args, '--artefact') || undefined
      }), json);
      return;
    }

    if (command === 'delivery' && subcommand === 'ratify-amendments') {
      if (!has(args, '--yes')) throw new Error('Amendment ratification requires explicit --yes confirmation');
      print(ratifyDeliveryAmendments(selectedProject(args), args[2] ?? '', {
        decision: 'approved',
        approvedBy: option(args, '--approved-by'),
        scope: option(args, '--scope'),
      }), json);
      return;
    }

    if (command === 'delivery' && subcommand === 'evidence-amendment') {
      const projectRoot = selectedProject(args);
      const slug = args[2] ?? '';
      if (!has(args, '--yes')) {
        print(previewCompletedEvidenceAmendment(projectRoot, slug), json);
        return;
      }
      print(ratifyCompletedEvidenceAmendment(projectRoot, slug, {
        confirmed: true,
        approvedBy: option(args, '--approved-by'),
        reason: option(args, '--reason'),
        expectedStateDigest: option(args, '--expected-state-digest'),
      }), json);
      return;
    }

    if (command === 'delivery' && subcommand === 'approve-build') {
      if (!has(args, '--yes')) throw new Error('Build approval requires explicit --yes confirmation');
      print(recordBuildApproval(selectedProject(args), args[2] ?? '', {
        decision: 'approved',
        approvedBy: option(args, '--approved-by'),
        scope: option(args, '--scope')
      }), json);
      return;
    }

    if (command === 'delivery' && subcommand === 'approve-manual-qa') {
      if (!has(args, '--yes')) throw new Error('Manual QA approval requires explicit --yes confirmation');
      print(recordManualQaApproval(selectedProject(args), args[2] ?? '', {
        decision: 'approved',
        approvedBy: option(args, '--approved-by'),
        evidencePath: option(args, '--evidence'),
        notes: option(args, '--notes')
      }), json);
      return;
    }

    if (command === 'delivery' && subcommand === 'runs') {
      print(has(args, '--mark-stale')
        ? markStaleCommandRuns(selectedProject(args), {
            hours: Number(option(args, '--hours', '6')),
            summary: option(args, '--summary')
          })
        : listCommandRuns(selectedProject(args), args[2]?.startsWith('--') ? '' : args[2] ?? ''), json);
      return;
    }

    if (command === 'afk' && subcommand === 'preflight') {
      print(preflightAfkRun(selectedProject(args), args[2] ?? '', {
        provider: option(args, '--provider', 'auto'),
        maxParallel: Number(option(args, '--parallel', '1')),
      }), json);
      return;
    }

    if (command === 'afk' && subcommand === 'start') {
      const timeoutMinutes = Number(option(args, '--timeout-minutes', '45'));
      if (!Number.isFinite(timeoutMinutes) || timeoutMinutes < 1) throw new Error('--timeout-minutes must be at least 1');
      print(startAfkRun(selectedProject(args), args[2] ?? '', {
        provider: option(args, '--provider', 'auto'),
        maxParallel: Number(option(args, '--parallel', '1')),
        timeoutMs: timeoutMinutes * 60 * 1000,
      }), json);
      return;
    }

    if (command === 'afk' && subcommand === 'status') {
      print(afkRunStatus(selectedProject(args), args[2]?.startsWith('--') ? '' : args[2] ?? ''), json);
      return;
    }

    if (command === 'afk' && subcommand === 'pause') {
      print(pauseAfkRun(selectedProject(args), args[2] ?? ''), json);
      return;
    }

    if (command === 'afk' && subcommand === 'resume') {
      print(resumeAfkRun(selectedProject(args), args[2] ?? ''), json);
      return;
    }

    if (command === 'afk' && subcommand === 'cancel') {
      print(cancelAfkRun(selectedProject(args), args[2] ?? ''), json);
      return;
    }

    if (command === 'palace' && subcommand === 'refresh') {
      const result = refreshPalaceIndex(selectedProject(args), { force: true });
      print(json ? result : `EWAI Mind Palace indexed · ${result.documents} artefacts · ${result.sections} sections · ${result.links} links`, json);
      return;
    }

    if (command === 'palace' && subcommand === 'status') {
      print(palaceIndexStatus(selectedProject(args)), json);
      return;
    }

    if (command === 'palace' && subcommand === 'search') {
      const result = searchPalace(selectedProject(args), args[2] ?? '', {
        limit: Number(option(args, '--limit', '50'))
      });
      print(json ? result : formatPalaceSearch(result), json);
      return;
    }

    if (command === 'palace' && (subcommand === 'tidiness' || subcommand === 'tidyness')) {
      const result = palaceTidiness(selectedProject(args));
      print(json ? result : formatPalaceTidiness(result), json);
      return;
    }

    if (command === 'palace' && subcommand === 'housekeeping') {
      const result = palaceHousekeeping(selectedProject(args));
      print(json ? result : formatPalaceHousekeeping(result), json);
      return;
    }

    if (command === 'index' && subcommand === 'refresh') {
      print(refreshRepositoryIndex(selectedProject(args)), json);
      return;
    }

    if (command === 'index' && subcommand === 'status') {
      print(repositoryIndexStatus(selectedProject(args)), json);
      return;
    }

    if (command === 'index' && subcommand === 'freshness') {
      print(repositoryIndexFreshness(selectedProject(args)), json);
      return;
    }

    if (command === 'index' && subcommand === 'coverage') {
      print(repositorySourceMapCoverage(selectedProject(args)), json);
      return;
    }

    if (command === 'index' && subcommand === 'profiles') {
      print(repositorySourceMapProfiles(selectedProject(args), {
        sourceKind: option(args, '--source'),
        analyser: option(args, '--analyser'),
        limit: Number(option(args, '--limit', '100'))
      }), json);
      return;
    }

    if (command === 'index' && subcommand === 'files') {
      print(repositorySourceMapFiles(selectedProject(args), {
        outcome: option(args, '--outcome'),
        classification: option(args, '--classification'),
        profileId: option(args, '--profile'),
        repository: option(args, '--repository'),
        query: option(args, '--query'),
        limit: Number(option(args, '--limit', '50'))
      }), json);
      return;
    }

    if (command === 'index' && subcommand === 'search') {
      print(searchRepositoryIndex(selectedProject(args), args[2] ?? '', {
        limit: Number(option(args, '--limit', '50'))
      }), json);
      return;
    }

    if (command === 'index' && subcommand === 'graph') {
      print(repositoryGraph(selectedProject(args), args[2] ?? '', {
        limit: Number(option(args, '--limit', '80'))
      }), json);
      return;
    }

    if (command === 'index' && subcommand === 'truth') {
      print(repositoryTruth(selectedProject(args), args[2] ?? '', {
        limit: Number(option(args, '--limit', '80'))
      }), json);
      return;
    }

    if (command === 'index' && subcommand === 'similar') {
      print(similarRepositoryCapabilities(selectedProject(args), args[2] ?? '', {
        limit: Number(option(args, '--limit', '12'))
      }), json);
      return;
    }

    if (command === 'index' && subcommand === 'standards') {
      print(repositoryStandards(selectedProject(args), args[2] ?? ''), json);
      return;
    }

    if (command === 'index' && subcommand === 'standards-coverage') {
      print(repositoryStandardsCoverage(selectedProject(args), args[2] ?? ''), json);
      return;
    }

    if (command === 'pack' && subcommand === 'list') {
      print(listPacks().map(({ path, ...pack }) => json ? { ...pack, path } : `${pack.id} ${pack.version} [${pack.type}]`), json);
      return;
    }

    if (command === 'persona' && subcommand === 'list') {
      const project = option(args, '--project');
      const personas = listPersonas(availablePersonaRoots(project), option(args, '--query'));
      print(personas.map((persona) => json ? persona : `${persona.id}\t${persona.name}`), json);
      return;
    }

    if (command === 'persona' && subcommand === 'index') {
      const project = option(args, '--project');
      const index = indexPersonas(availablePersonaRoots(project), option(args, '--query'));
      print(index.map((persona) => json ? persona : `${persona.id}\t${persona.name}\t${persona.description}`), json);
      return;
    }

    if (command === 'persona' && subcommand === 'create') {
      const explicitProject = option(args, '--project');
      const scope = option(args, '--scope', explicitProject ? 'project' : 'personal');
      let projectRoot = '';
      if (scope === 'project') {
        const loaded = loadProjectConfig(selectedProject(args));
        projectRoot = loaded.paths.projectRoot;
      }
      const result = createPersona({
        scope,
        slug: args[2] ?? '',
        name: option(args, '--name'),
        category: option(args, '--category'),
        projectRoot,
        force: has(args, '--force')
      });
      print(result, json);
      return;
    }

    if (command === 'persona' && subcommand === 'path') {
      const explicitProject = option(args, '--project');
      const scope = option(args, '--scope', explicitProject ? 'project' : 'personal');
      let projectRoot = '';
      if (scope === 'project') {
        const loaded = loadProjectConfig(selectedProject(args));
        projectRoot = loaded.paths.projectRoot;
      }
      print(personaLibraryRoot(scope, { projectRoot }), json);
      return;
    }

    if (command === 'persona' && subcommand === 'premium' && args[2] === 'status') {
      print(await premiumPersonaEntitlementStatus(selectedProject(args)), json);
      return;
    }

    if (command === 'persona' && subcommand === 'premium' && args[2] === 'configure') {
      if (has(args, '--licence-key') || has(args, '--license-key')) throw new Error('Do not put licence keys in command arguments. Use the private terminal prompt.');
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Licence setup requires an interactive terminal so the key is not echoed or captured in command history.');
      loadProjectConfig(selectedProject(args));
      const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
      muted.isTTY = true; muted.columns = process.stdout.columns;
      const prompt = createInterface({ input: process.stdin, output: muted, terminal: true, historySize: 0 });
      let licenceKey;
      let result;
      try {
        process.stdout.write('Submitting your key verifies the licence and downloads premium personas now. Core personas remain available if you cancel.\n');
        process.stdout.write('Persona licence key (hidden): ');
        licenceKey = await prompt.question('');
        process.stdout.write('\n');
        result = await configureAndInstallPremiumPersonas(selectedProject(args), { licenceKey, server: option(args, '--server') || undefined, machineName: option(args, '--machine-name') || undefined, confirmed: true });
      } finally { licenceKey = undefined; prompt.close(); }
      print(result, json);
      if (result.status !== 'ready') process.exitCode = 1;
      return;
    }

    if (command === 'persona' && subcommand === 'premium' && args[2] === 'sync') {
      const result = await syncPremiumPersonas(selectedProject(args), {
        confirmed: has(args, '--yes'), replaceConfirmed: has(args, '--replace')
      });
      print(result, json);
      return;
    }

    if (command === 'test-scenarios' && subcommand === 'prepare') {
      const project = selectedProject(args);
      const result = preparePersonaTestScenarioBrief(project, args[2] ?? '', {
        focus: option(args, '--focus'),
        personas: listPersonas(availablePersonaRoots(project))
      });
      print(result, json);
      return;
    }

    if (command === 'test-scenarios' && subcommand === 'record') {
      const project = selectedProject(args);
      const inputPath = option(args, '--input');
      if (!inputPath) throw new Error('test-scenarios record requires --input FILE');
      const reviewedBy = option(args, '--reviewed-by');
      if (!reviewedBy) throw new Error('test-scenarios record requires --reviewed-by NAME');
      const safeInputPath = realpathSync(resolve(inputPath));
      const inputRelative = relative(project, safeInputPath);
      if (!inputRelative || inputRelative.startsWith('..') || isAbsolute(inputRelative)) {
        throw new Error('test-scenarios --input must be a project-relative file');
      }
      let input;
      try {
        input = JSON.parse(readFileSync(safeInputPath, 'utf8'));
      } catch (error) {
        throw new Error(`Cannot read test-scenario input: ${error.message}`);
      }
      const result = recordPersonaTestScenarios(project, args[2] ?? '', input, {
        reviewedBy,
        personas: listPersonas(availablePersonaRoots(project))
      });
      print(result, json);
      return;
    }

    if (command === 'test-scenarios' && subcommand === 'status') {
      const project = selectedProject(args);
      const result = readPersonaTestScenarioWorkspace(project, args[2] ?? '', {
        personas: listPersonas(availablePersonaRoots(project))
      });
      print(result, json);
      return;
    }

    throw new Error(`Unknown command: ${args.join(' ')}`);
  } catch (error) {
    if (command !== 'error-report') {
      try {
        const projectRoot = selectedProject(args);
        const commandIdentity = automaticErrorCommand(args);
        captureErrorReportFailure(projectRoot, {
          capability: 'cli',
          errorCode: 'EWAI-CLI-FAILED',
          command: commandIdentity,
          ewaiVersion: JSON.parse(readFileSync(resolve(installRoot, 'package.json'), 'utf8')).version,
          nodeVersion: process.versions.node,
          osClass: ['darwin', 'linux', 'win32'].includes(process.platform) ? process.platform : 'other',
          installationSource: 'npm',
          title: 'An EWAI command did not complete',
          expected: 'The requested EWAI command completes.',
          actual: 'The command returned an error. The original error was shown separately and is not copied into this report.',
          reproductionSteps: [`Run ${commandIdentity}`],
        });
      } catch {
        // Reporting must never replace or mask the original command failure.
      }
    }
    const suppliedRolloutProject = option(args, '--project');
    const rolloutError = command === 'rollout'
      ? { error: suppliedRolloutProject ? String(error.message).replaceAll(suppliedRolloutProject, '<project>') : String(error.message), notices: { advisory: ROLLOUT_ADVISORY_NOTICE, security: ROLLOUT_ASSURANCE_NOTICE } }
      : null;
    if (json) console.error(JSON.stringify(command === 'security' ? { error: error.message, assurance_notice: ASSURANCE_NOTICE } : command === 'readiness' ? { error: error.message, notices: { security: ASSURANCE_NOTICE, authority: READINESS_AUTHORITY_NOTICE } } : command === 'policy' ? { error: error.message, authority_notice: POLICY_DESIGN_AUTHORITY_NOTICE } : command === 'meeting' ? { error: error.message, assurance_notice: MEETING_EVIDENCE_DISCLAIMER } : command === 'knowledge' ? { error: error.message, assurance_notice: KNOWLEDGE_PROPOSALS_DISCLAIMER } : rolloutError ?? { error: error.message }));
    else console.error(command === 'security' ? `${ASSURANCE_NOTICE}\n\nError: ${error.message}` : command === 'readiness' ? `${ASSURANCE_NOTICE}\n${READINESS_AUTHORITY_NOTICE}\n\nError: ${error.message}` : command === 'policy' ? `${POLICY_DESIGN_AUTHORITY_NOTICE}\n\nError: ${error.message}` : command === 'meeting' ? `${MEETING_EVIDENCE_DISCLAIMER}\n\nError: ${error.message}` : command === 'knowledge' ? `${KNOWLEDGE_PROPOSALS_DISCLAIMER}\n\nError: ${error.message}` : command === 'rollout' ? `${ROLLOUT_ADVISORY_NOTICE}\n${ROLLOUT_ASSURANCE_NOTICE}\n\nError: ${rolloutError.error}` : `Error: ${error.message}`);
    process.exitCode = 1;
  }
}
