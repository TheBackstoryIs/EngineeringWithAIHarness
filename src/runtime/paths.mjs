import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectPaths } from '../paths.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));

export function runtimePaths(projectRoot) {
  const project = projectPaths(projectRoot);
  const root = project.projectRoot;
  const runtimeRoot = project.runtimeRoot;
  return {
    projectRoot: root,
    runtimeRoot,
    dataRoot: resolve(runtimeRoot, 'data'),
    databasePath: resolve(runtimeRoot, 'data/pipeline.sqlite'),
    runtimeStateRoot: resolve(runtimeRoot, 'runtime'),
    dashboardStatePath: resolve(runtimeRoot, 'runtime/dashboard.json'),
    checkinStatePath: resolve(runtimeRoot, 'runtime/checkin.json'),
    guidedDiscoveryDraftPath: resolve(runtimeRoot, 'runtime/guided-discovery.json'),
    guidedIntentDraftPath: resolve(runtimeRoot, 'runtime/guided-intent.json'),
    evidenceDepthRoot: resolve(runtimeRoot, 'runtime/evidence-depth'),
    evidenceDepthPreparationPath: resolve(runtimeRoot, 'runtime/evidence-depth/preparation.json'),
    prototypeIterationsRoot: resolve(runtimeRoot, 'runtime/prototype-iterations'),
    prototypeIterationRoot: (slug) => resolve(runtimeRoot, 'runtime/prototype-iterations', slug),
    prototypePlanPreparationPath: (slug) => resolve(runtimeRoot, 'runtime/prototype-iterations', slug, 'plan-preparation.json'),
    prototypeCyclePreparationPath: (slug, cycle) => resolve(runtimeRoot, 'runtime/prototype-iterations', slug, `cycle-${cycle}-preparation.json`),
    phaseContributionsRoot: resolve(runtimeRoot, 'runtime/phase-contributions'),
    phaseContributionDraftPath: (slug, phase) => resolve(runtimeRoot, 'runtime/phase-contributions', slug, `${phase}.json`),
    contextPacksRoot: resolve(runtimeRoot, 'runtime/context-packs'),
    contextPackManifestRoot: resolve(runtimeRoot, 'runtime/context-packs/manifests'),
    contextPackCacheRoot: resolve(runtimeRoot, 'runtime/context-packs/cache'),
    starterMaterialisationRoot: resolve(runtimeRoot, 'starter-materialisation'),
    starterStagingRoot: resolve(runtimeRoot, 'starter-materialisation/staging'),
    errorReportsRoot: resolve(runtimeRoot, 'error-reports'),
    errorReportDraftsRoot: resolve(runtimeRoot, 'error-reports/drafts'),
    errorReportPackagesRoot: resolve(runtimeRoot, 'error-reports/packages'),
    errorReportReceiptsRoot: resolve(runtimeRoot, 'error-reports/receipts'),
    errorReportArchiveRoot: resolve(runtimeRoot, 'error-reports/archive'),
    errorReportAdaptersRoot: resolve(runtimeRoot, 'error-reports/adapters'),
    errorReportSettingsPath: resolve(runtimeRoot, 'error-reports/settings.json'),
    teamHubRoot: resolve(runtimeRoot, 'team-hub'),
    teamHubConnectionPath: resolve(runtimeRoot, 'team-hub/connection.json'),
    teamHubAttemptsRoot: resolve(runtimeRoot, 'team-hub/attempts'),
    teamHubAcceptedReceiptPath: resolve(runtimeRoot, 'team-hub/accepted-receipt.json'),
    teamHubResourcesRoot: resolve(runtimeRoot, 'team-hub/resources'),
    teamHubResourceCacheRoot: resolve(runtimeRoot, 'team-hub/resources/cache'),
    teamHubResourceStagingRoot: resolve(runtimeRoot, 'team-hub/resources/staging'),
    teamHubResourceReceiptsRoot: resolve(runtimeRoot, 'team-hub/resources/receipts'),
    teamHubResourceInstalledPath: resolve(runtimeRoot, 'team-hub/resources/installed.json'),
    teamHubManagedPackRoot: resolve(runtimeRoot, 'packs/team-hub'),
    logRoot: resolve(runtimeRoot, 'logs'),
    dashboardLogPath: resolve(runtimeRoot, 'logs/dashboard.log'),
    specsRoot: project.specsRoot,
    specsRelative: project.specsRelative,
    intentsRoot: resolve(project.specsRoot, '2.Purpose/intents'),
    publicRoot: resolve(moduleDir, '../../public')
  };
}
