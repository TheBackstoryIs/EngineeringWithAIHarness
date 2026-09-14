import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import {premiumPersonasActive} from './dashboard-preferences.mjs';
import { fileURLToPath } from 'node:url';
import {
  loadProjectConfig,
  migrateProjectValidationConfig,
  refreshCheckinInstructions,
  validationStatus,
} from './project.mjs';
import { detectHostStatuses } from './companion.mjs';
import { auditIntentStateCopies } from './intents.mjs';
import { companionOpening } from './companion-opening.mjs';
import { configurePersonaLicence, personaServer } from './persona-website-provider.mjs';
import { readCompanionGuidance } from './companion-guidance.mjs';
import { validateIntentDependencyGraph } from './intent-dependencies.mjs';
import { listPersonas, personalPersonaRoot, projectPersonaRoot } from './personas.mjs';
import { ensureDashboard } from './runtime/dashboard.mjs';
import { listRuntimeIntents } from './runtime/intents.mjs';
import { runtimePaths } from './runtime/paths.mjs';
import { auditOperationalState, listWorkItems } from './runtime/work.mjs';
import { palaceTidiness } from './runtime/palace.mjs';
import { dashboardHandoffStatus } from './runtime/dashboard-handoffs.mjs';
import {
  DEFAULT_PREMIUM_UPGRADE_URL,
  inspectPersonaEntitlement,
  premiumPackReceiptPath,
  premiumPackRoot,
  premiumPersonaRoot,
  readPremiumPackManifest,
  resolvePersonaEntitlement,
  syncPersonaPack,
} from './persona-entitlements.mjs';

export {
  DEFAULT_PREMIUM_UPGRADE_URL,
  premiumPackReceiptPath,
  premiumPackRoot,
  premiumPersonaRoot,
  readPremiumPackManifest,
};

const execFileAsync = promisify(execFile);
const moduleDir = dirname(fileURLToPath(import.meta.url));

export async function frameworkStatus(installRoot, options = {}) {
  if (!installRoot || !existsSync(resolve(installRoot, 'package.json'))) {
    return { status: 'unknown', reason: 'The EWAI package metadata is unavailable.' };
  }
  const metadata = JSON.parse(readFileSync(resolve(installRoot, 'package.json'), 'utf8'));
  const currentVersion = metadata.version ?? null;
  if (!metadata.name) {
    return { status: 'unknown', source: 'npm', current: currentVersion, reason: 'The npm registry cannot be checked from this runtime.' };
  }
  let latest = null;
  try {
    if (options.fetchImpl) {
      const response = await options.fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(metadata.name)}/latest`);
      if (!response.ok) {
        return { status: 'unknown', source: 'npm', current: currentVersion, reason: `The npm registry returned HTTP ${response.status}.` };
      }
      latest = (await response.json()).version ?? null;
    } else {
      const npm = await execFileAsync('npm', ['view', `${metadata.name}@latest`, 'version', '--json'], {
        timeout: 8000,
        maxBuffer: 1024 * 1024,
        env: process.env
      });
      const parsed = JSON.parse(npm.stdout);
      latest = Array.isArray(parsed) ? parsed.at(-1) : parsed;
    }
    if (!latest) return { status: 'unknown', source: 'npm', current: currentVersion, reason: 'The npm registry did not return a latest version.' };
    return {
      status: currentVersion === latest ? 'current' : 'update-available',
      source: 'npm',
      current: currentVersion,
      latest,
      action: currentVersion === latest ? null : {
        kind: 'offer-npm-update',
        prompt: `EWAI ${latest} is available from npm. Would you like me to update the global package?`,
        command: `npm install --global ${metadata.name}@latest`
      }
    };
  } catch {
    return { status: 'unknown', source: 'npm', current: currentVersion, reason: 'The npm update check did not finish. Check your connection and try again.' };
  }
}

export async function checkinProject(projectRoot, options = {}) {
  const instructions = refreshCheckinInstructions(projectRoot);
  const validationMigration = migrateProjectValidationConfig(projectRoot);
  const { config, paths } = loadProjectConfig(projectRoot);
  const intentState = auditIntentStateCopies(paths.projectRoot, { repairMissing: true });
  const operationalState = intentState.status === 'consistent'
    ? auditOperationalState(paths.projectRoot)
    : { schema: 'ewai.operational-state-audit/v1', status: 'blocked-by-durable-drift', checked: 0, drift: [] };
  const palace = palaceTidiness(paths.projectRoot);
  const premiumCheck = inspectPersonaEntitlement(config, { home: options.home, fetchImpl: options.premiumFetchImpl });
  const [premium, framework, dashboard] = await Promise.all([
    premiumCheck,
    options.checkFramework === false
      ? Promise.resolve({ status: 'not-checked' })
      : frameworkStatus(options.installRoot, {
          fetchImpl: options.fetchImpl
        }),
    options.startRuntime === false
      ? Promise.resolve({ status: 'not-checked', started: false })
      : ensureDashboard(paths.projectRoot, { ...options.dashboard, home: options.home, premiumCheck })
  ]);

  const hasWork = intentState.checked > 0 || operationalState.checked > 0;
  const workItems = intentState.status === 'consistent' ? listWorkItems(paths.projectRoot) : [];
  const intentDependencies = intentState.status === 'consistent'
    ? validateIntentDependencyGraph(listRuntimeIntents(paths.projectRoot))
    : { schema: 'ewai.intent-dependency-audit/v1', status: 'blocked-by-durable-drift', checked: 0, errors: [] };
  const orchestrator = options.orchestrator ?? process.env.EWAI_ORCHESTRATOR ?? 'manual';
  const validation = validationStatus(config, orchestrator);
  const hostStatuses = options.hostStatuses ?? detectHostStatuses({
    env: options.env,
    probe: options.probeHost,
  });
  const handoffState = dashboardHandoffStatus(paths.projectRoot);
  const dashboardHandoffs = handoffState.handoffs;
  const companionGuidance = readCompanionGuidance(paths.projectRoot, {
    items: workItems,
    personas: listPersonas([
      resolve(moduleDir, '../packs/personas/core/personas'),
      premiumPersonaRoot(options.home),
      personalPersonaRoot(options.home),
      projectPersonaRoot(paths.projectRoot),
    ]),
  });

  const result = {
    schema: 'ewai.checkin/v1',
    project: { name: config.project.name, root: paths.projectRoot },
    premium,
    framework,
    validation: {
      ...validation,
      hosts: hostStatuses,
      migrated: validationMigration.changed,
    },
    companion: companionOpening({
      hasWork,
      licenceNotConfigured: premium.accessReason === 'licence-not-configured',
      premiumActive: premiumPersonasActive(premium),
      spotlight: companionGuidance.spotlight,
      activePersonas: companionGuidance.activePersonas,
      notices: companionGuidance.notices,
    }),
    instructions,
    intentState,
    operationalState,
    intentDependencies,
    execution: {
      schema: 'ewai.checkin-execution/v1',
      items: workItems.map((item) => ({
        id: item.id,
        title: item.title,
        lane: item.lane,
        currentPhase: item.currentPhase,
        valid: item.execution.valid,
        permittedActions: Object.entries(item.execution.actions)
          .filter(([, action]) => action.permitted)
          .map(([name]) => name),
        blockers: item.execution.blockers,
        availableTasks: item.execution.tasks.available,
      })),
    },
    dashboardHandoff: dashboardHandoffs[0] ?? null,
    dashboardHandoffs,
    dashboardHandoffStatus: handoffState.status,
    dashboardHandoffError: handoffState.error,
    palace,
    runtime: {
      database: resolve(paths.runtimeRoot, 'data/pipeline.sqlite'),
      dashboard
    }
  };
  const statePath = runtimePaths(paths.projectRoot).checkinStatePath;
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify({
    schema: 'ewai.checkin-state/v1',
    checkedAt: new Date().toISOString(),
    premium: {
      provider: result.premium.provider,
      accessReason: result.premium.accessReason ?? null,
      access: result.premium.access,
      status: result.premium.status,
      installed: result.premium.installed,
      verified: result.premium.verified,
      dirty: result.premium.dirty,
      compatibility: result.premium.compatibility,
      manifestVersion: result.premium.manifestVersion,
      revision: result.premium.revision,
      latestRevision: result.premium.latestRevision,
      contentDigest: result.premium.contentDigest,
      upgradeUrl: result.premium.upgradeUrl,
      version: result.premium.version ?? null,
      latestVersion: result.premium.latestVersion ?? null,
      message: result.premium.message ?? null,
      planType: result.premium.planType ?? null,
      subscriptionStatus: result.premium.subscriptionStatus ?? null,
    }
  }, null, 2)}\n`, 'utf8');
  return result;
}

export async function syncPremiumPersonas(projectRoot, options = {}) {
  const { config } = loadProjectConfig(projectRoot);
  return syncPersonaPack(config, options);
}

const premiumSetups = new Set();
const setupErrors = {
  invalid_licence_key: 'This licence key could not be verified. Check the key in My Account and try again.',
  invalid_licence: 'This licence key could not be verified. Check the key in My Account and try again.',
  subscription_expired: 'This subscription has expired. Renew in My Account to download updates.',
  subscription_inactive: 'This subscription is not currently available. Check My Account.',
  installation_limit_reached: 'This licence is active on three machines. Deactivate a machine in My Account, then try again.'
};

export async function configureAndInstallPremiumPersonas(projectRoot, options = {}) {
  if (options.confirmed !== true) throw new Error('Premium persona setup requires explicit verify-and-install confirmation.');
  const { config } = loadProjectConfig(projectRoot);
  const home = resolve(options.home ?? homedir());
  if (premiumSetups.has(home)) throw new Error('Another premium persona setup is running. Wait for it to finish.');
  premiumSetups.add(home);
  let stage = 'activation';
  try {
    const configured = resolvePersonaEntitlement(config, { home });
    const server = options.server === undefined ? configured.server : personaServer(options.server);
    if (config.personas?.premium?.server && server !== configured.server) throw new Error('The explicit server differs from the project persona server.');
    const setupConfig = { ...config, personas: { ...config.personas, premium: { ...config.personas?.premium, server } } };
    await configurePersonaLicence({ home, server, licenceKey: options.licenceKey, machineName: options.machineName, fetchImpl: options.fetchImpl });
    stage = 'download';
    const sync = await syncPersonaPack(setupConfig, { home, fetchImpl: options.fetchImpl, confirmed: true });
    const fresh = await checkinProject(projectRoot, { home, premiumFetchImpl: options.fetchImpl, checkFramework: false, startRuntime: false });
    if (!fresh.premium.installed || !fresh.premium.verified || fresh.premium.access !== 'available') {
      return { schema: 'ewai.premium-setup/v1', status: 'failed', stage: 'verification', installed: Boolean(fresh.premium.installed), verified: false,
        message: 'The pack could not be confirmed ready. Check access and retry before using premium personas.' };
    }
    return { schema: 'ewai.premium-setup/v1', status: 'ready', installed: true, verified: true, version: sync.version,
      personaCount: listPersonas([premiumPersonaRoot(home)]).length,
      message: 'Premium personas are installed and ready to use in this session.' };
  } catch (error) {
    return { schema: 'ewai.premium-setup/v1', status: 'failed', stage, installed: false, verified: false,
      code: Object.hasOwn(setupErrors, error.code) ? error.code : `setup_${stage}_failed`,
      message: stage === 'activation' ? setupErrors[error.code] ?? 'The licence could not be verified. Check the key in My Account and your connection, then try again. Existing personas are unchanged.'
        : 'The licence was saved, but the pack could not be installed. Existing personas have not been overwritten. Check the connection and premium cache status, then retry.' };
  } finally { premiumSetups.delete(home); }
}

export async function premiumPersonaEntitlementStatus(projectRoot, options = {}) {
  const { config } = loadProjectConfig(projectRoot);
  return inspectPersonaEntitlement(config, options);
}
