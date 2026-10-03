#!/usr/bin/env node
import { createReadStream, existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { premiumPersonaRoot, configureAndInstallPremiumPersonas } from '../checkin.mjs';
import { attachPersonaToIntent, detachPersonaFromIntent } from '../intents.mjs';
import { createPersona, listPersonas, personalPersonaRoot, projectPersonaRoot } from '../personas.mjs';
import { loadProjectConfig } from '../project.mjs';
import {readDashboardPreferences,saveDashboardPreferences,premiumPersonasActive} from '../dashboard-preferences.mjs';
import { readPortfolioWorkspace } from '../portfolio.mjs';
import { readCompanionGuidance } from '../companion-guidance.mjs';
import {
  ROLLOUT_ADVISORY_NOTICE,
  readRolloutWorkspace,
} from '../network-rollout.mjs';
import { readPersonaTestScenarioWorkspace } from '../test-scenarios.mjs';
import {
  MEETING_EVIDENCE_DISCLAIMER,
  prepareMeetingExtraction,
  promoteMeetingEvidence,
  readMeetingEvidenceWorkspace,
} from '../meeting-evidence.mjs';
import {
  KNOWLEDGE_PROPOSALS_DISCLAIMER,
  materialiseKnowledgeProposals,
  prepareKnowledgeProposals,
  readKnowledgeProposalWorkspace,
  recordKnowledgeProposalBundle,
  recordKnowledgeProposalReview,
  recoverKnowledgeMaterialisation,
} from '../knowledge-proposals.mjs';
import { listRuntimeIntents, readRuntimeIntent, runtimeIntentSummary } from './intents.mjs';
import { initializeRuntime } from './database.mjs';
import { listKnowledge, readKnowledgeDocument } from './knowledge.mjs';
import { palaceTidiness, searchPalace } from './palace.mjs';
import { runtimePaths } from './paths.mjs';
import { dashboardRuntimeVersion } from './version.mjs';
import {
  prepareProjectContext,
  readStoredContextManifest,
  safeContextManifest,
} from './context-assembly.mjs';
import {
  autonomyInterfaceAction,
  safeAutonomyInterfaceError,
  approveBuildFromDashboard,
  controlAfkFromDashboard,
  dashboardAfkRuns,
  enterBuildFromDashboard,
  preflightAfkFromDashboard,
  requestGuidedDashboardWork,
  startAfkFromDashboard,
} from './dashboard-actions.mjs';
import { listDashboardHandoffs, resolveDashboardHandoff } from './dashboard-handoffs.mjs';
import {
  approveGuidedDiscovery,
  guidedDiscoveryOwnerEvidence,
  readGuidedDiscovery,
  saveGuidedDiscoveryDraft
} from './guided-discovery.mjs';
import {
  compareEvidenceDepthWorkspaceRuns,
  prepareEvidenceDepthWorkspace,
  readEvidenceDepthWorkspace,
  recordEvidenceDepthWorkspaceRun,
} from './evidence-depth-workspace.mjs';
import {
  comparePrototypeWorkspaceReviews,
  preparePrototypeCycleWorkspace,
  preparePrototypePlanWorkspace,
  readPrototypeIterationWorkspace,
  recordPrototypeCycleWorkspaceReview,
  recordPrototypePlanWorkspaceReview,
} from './prototype-iterations.mjs';
import {
  approveGuidedIntent,
  discardGuidedIntentDraft,
  readGuidedIntent,
  saveGuidedIntentDraft,
} from './guided-intents.mjs';
import {
  confirmPhaseContribution,
  discardPhaseContributionDraft,
  handoffPhaseContribution,
  readPhaseStudio,
  requestPhaseContributionReview,
  savePhaseContributionDraft,
} from './phase-contributions.mjs';
import {
  confirmImpactAssessment,
  previewImpactAssessment,
  readImpactWorkspace
} from './impact-analysis.mjs';
import {
  POLICY_DESIGN_AUTHORITY_NOTICE,
  confirmPolicyFactsAction,
  evaluatePolicyDesignAction,
  readPolicyWorkspace,
  recordPolicyExceptionAction,
  recordPolicyReviewAction,
} from './policy-workspace.mjs';
import {
  refreshRepositoryIndex,
  repositorySourceMapCoverage,
  repositorySourceMapFiles,
  repositorySourceMapProfiles
} from './repository-index.mjs';
import {
  disableLifecycleSubscription,
  dispatchEligibleLifecycleDeliveries,
  readLifecycleHookWorkspace,
  reconcileCanonicalLifecycleEvents,
  retryLifecycleDelivery,
} from './lifecycle-hooks.mjs';
import { ASSURANCE_NOTICE } from '../security-validation-config.mjs';
import {
  cancelSecurityRun,
  executeSecurityRun,
  importSecurityArtifacts,
  prepareSecurityArtifactImport,
  prepareSecurityRun,
  readSecurityWorkspace,
  recordSecurityDisposition,
  resolveSecurityRevision,
} from './security-validation.mjs';
import {
  applyStarterMaterialisation,
  prepareStarterMaterialisation,
  readStarterMaterialisationWorkspace,
  recoverStarterMaterialisation,
  selectStarterPersonas,
} from './starter-materialisation.mjs';
import {
  addActivityEvent,
  addArtefact,
  finishActiveSession,
  listActiveSessions,
  listActivityEvents,
  listGroups,
  listWorkItems,
  readWorkItemView,
  resolvePrototypeAsset,
  startActiveSession,
  updateWorkItem
} from './work.mjs';
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
  submitErrorReportProvider,
  updateErrorReportSettings,
  updateLocalErrorReport,
} from './error-reporting.mjs';
import {
  connectTeamHub,
  disconnectTeamHub,
  inspectConnectedTeamHubResource,
  installConnectedTeamHubResource,
  listConnectedTeamHubResources,
  listTeamHubResourceReceipts,
  readTeamHubWorkspace,
  syncTeamHub,
} from './team-hub-client.mjs';

const installRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const packageVersion = JSON.parse(readFileSync(resolve(installRoot, 'package.json'), 'utf8')).version;

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

const projectRoot = resolve(option('--project', process.cwd()));
const requestedPort = Number(option('--port', '4787'));
const project = loadProjectConfig(projectRoot);
const paths = runtimePaths(projectRoot);
const startedAt = new Date().toISOString();
initializeRuntime(projectRoot);

let hookTickRunning = false;
async function lifecycleHookTick() {
  if (hookTickRunning) return;
  hookTickRunning = true;
  try {
    reconcileCanonicalLifecycleEvents(projectRoot);
    await dispatchEligibleLifecycleDeliveries(projectRoot, { limit: 10 });
  } catch {
    // Hook delivery is observable through its own ledger and must not stop the dashboard.
  } finally {
    hookTickRunning = false;
  }
}

const lifecycleHookTimer = setInterval(lifecycleHookTick, 1_500);
lifecycleHookTimer.unref();

function json(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(body, null, 2));
}

function rolloutError(response, statusCode, message) {
  return json(response, statusCode, {
    error: message,
    notices: { advisory: ROLLOUT_ADVISORY_NOTICE, security: ASSURANCE_NOTICE },
  });
}

async function readJson(request) {
  const expectedOrigin = `http://${request.headers.host}`;
  if (!request.headers.origin || request.headers.origin !== expectedOrigin) {
    const error = new Error('Mutation requests require the matching dashboard origin');
    error.statusCode = 403;
    throw error;
  }
  if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    const error = new Error('Mutation requests require application/json');
    error.statusCode = 415;
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      const error = new Error('Request body exceeds 1 MB');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body is not valid JSON');
    error.statusCode = 400;
    throw error;
  }
}

function isWithinRoot(root, path) {
  const rel = relative(root, path);
  return rel === '' || (rel && !rel.startsWith('..') && !isAbsolute(rel));
}

function premiumSummary() {
  const empty = {
    provider: 'wordpress-edd', access: 'unknown', status: 'not-verified', installed: false,
    verified: false, active: false, compatibility: null, revision: null, showUpgrade: false, upgradeUrl: null,
  };
  if (!existsSync(paths.checkinStatePath)) return empty;
  try {
    const state = JSON.parse(readFileSync(paths.checkinStatePath, 'utf8'));
    const premium = state?.schema === 'ewai.checkin-state/v1' ? state.premium : null;
    let upgradeUrl = null;
    if (premium?.upgradeUrl) {
      const candidate = new URL(premium.upgradeUrl);
      if (candidate.protocol === 'https:') upgradeUrl = candidate.href;
    }
    return {
      provider: 'wordpress-edd',
      access: premium?.access ?? 'unknown',
      status: premium?.status ?? 'not-verified',
      installed: Boolean(premium?.installed),
      verified: Boolean(premium?.verified),
      active: premiumPersonasActive(premium),
      compatibility: ['current', 'compatible-legacy'].includes(premium?.compatibility) ? premium.compatibility : null,
      revision: /^[a-f0-9]{40,64}$/.test(String(premium?.revision ?? '')) ? premium.revision : null,
      version: /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(premium?.version ?? '')) ? premium.version : null,
      latestVersion: /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(premium?.latestVersion ?? '')) ? premium.latestVersion : null,
      planType: ['individual', 'team'].includes(premium?.planType) ? premium.planType : null,
      showUpgrade: (premium?.access === 'unavailable' || premium?.accessReason === 'licence-not-configured') && !premium?.installed && Boolean(upgradeUrl),
      upgradeUrl
    };
  } catch {
    return empty;
  }
}

function guarded(operation) {
  try {
    return operation();
  } catch (error) {
    if (!error.statusCode) error.statusCode = 409;
    throw error;
  }
}

function strictBody(input, allowed, label) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    const error = new Error(`${label} must be a JSON object.`);
    error.statusCode = 400;
    throw error;
  }
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      const error = new Error(`${label} contains unknown field: ${key}`);
      error.statusCode = 400;
      throw error;
    }
  }
  return input;
}

function dashboardWorkItemView(reference) {
  const view = readWorkItemView(projectRoot, reference);
  if (!view) return null;
  const personas = personaLibrary();
  const sourceMapCoverage = repositorySourceMapCoverage(projectRoot);
  const activePersonas = (view.intent?.personas ?? []).map((attachment) => {
    const persona = personas.find((candidate) => candidate.id === attachment.ref);
    return {
      id: attachment.ref,
      name: persona?.name ?? attachment.ref,
      tier: persona?.tier ?? (attachment.ref.includes('.premium.') ? 'premium-unavailable' : 'unavailable'),
      role: attachment.role,
      depth: attachment.depth,
      engagementReason: `Attached to ${view.item.title} for the current Source Map and impact context.`
    };
  });
  return {
    ...view,
    impact: readImpactWorkspace(projectRoot, view.item.slug),
    sourceMap: {
      schema: 'ewai.dashboard-source-map/v1',
      coverage: sourceMapCoverage,
      profiles: repositorySourceMapProfiles(projectRoot, { limit: 40 }),
      files: repositorySourceMapFiles(projectRoot, { attentionOnly: true, limit: 80 }),
      activePersonas,
      guidance: { advisory: true, humanReviewRequired: true, personasAreLenses: true }
    },
    testScenarios: readPersonaTestScenarioWorkspace(projectRoot, view.item.slug, { personas }),
    afk: dashboardAfkRuns(projectRoot, view.item.slug),
    dashboardHandoff: listDashboardHandoffs(projectRoot, { status: 'pending' })
      .find((handoff) => handoff.intentId === view.item.id && ['begin', 'continue'].includes(handoff.action)) ?? null,
  };
}

function personaLibrary(query = '') {
  const ranks = { project: 4, personal: 3, premium: 2, core: 1 };
  const personas = listPersonas([
    resolve(installRoot, 'packs/personas/core/personas'),
    premiumPersonaRoot(),
    personalPersonaRoot(),
    projectPersonaRoot(projectRoot)
  ], query);
  const unique = new Map();
  for (const persona of personas) {
    const current = unique.get(persona.id);
    if (!current || (ranks[persona.tier] ?? 0) > (ranks[current.tier] ?? 0)) unique.set(persona.id, persona);
  }
  return [...unique.values()].map(({ path: _path, parseStatus: _parseStatus, ...persona }) => persona);
}

function starterPersonas(moment) {
  return selectStarterPersonas(personaLibrary(), moment);
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function serveStatic(response, pathname) {
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const path = resolve(paths.publicRoot, relativePath);
  if (!isWithinRoot(paths.publicRoot, path) || !existsSync(path)) return false;
  response.writeHead(200, {
    'content-type': mime[extname(path)] || 'application/octet-stream',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'"
  });
  createReadStream(path).pipe(response);
  return true;
}

function servePrototype(response, reference, artefactId, assetPath) {
  const resolved = resolvePrototypeAsset(projectRoot, reference, artefactId, assetPath);
  if (!resolved) return false;
  response.writeHead(200, {
    'content-type': mime[extname(resolved.path).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "sandbox allow-scripts allow-forms; default-src 'self' data: blob:; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'"
  });
  createReadStream(resolved.path).pipe(response);
  return true;
}

const server = createServer(async (request, response) => {
  const host = request.headers.host ?? '';
  if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host)) {
    const securityRequest = String(request.url ?? '').startsWith('/api/security-validation');
    return json(response, 403, securityRequest
      ? { error: 'Loopback host required', assurance_notice: ASSURANCE_NOTICE }
      : { error: 'Loopback host required' });
  }

  const url = new URL(request.url ?? '/', `http://${host}`);
  try {
    if (url.pathname === '/api/autonomy' || url.pathname.startsWith('/api/autonomy/')) {
      if (![ `127.0.0.1:${requestedPort}`, `localhost:${requestedPort}` ].includes(host)) {
        return json(response, 403, safeAutonomyInterfaceError({ code: 'autonomy-host-invalid', statusCode: 403 }));
      }
      const action = url.pathname === '/api/autonomy' ? 'status' : url.pathname.slice('/api/autonomy/'.length);
      if (!['status', 'preview', 'approve', 'revoke', 'run', 'service', 'control', 'answer'].includes(action)) {
        return json(response, 404, safeAutonomyInterfaceError({ code: 'autonomy-route-not-found', statusCode: 404 }));
      }
      if (request.method !== (action === 'status' ? 'GET' : 'POST')) {
        return json(response, 405, safeAutonomyInterfaceError({ code: 'autonomy-method-not-allowed', statusCode: 405 }));
      }
      if ([...url.searchParams.keys()].some(key => action !== 'status' || key !== 'runId') || url.searchParams.getAll('runId').length > 1) {
        return json(response, 400, safeAutonomyInterfaceError({ code: 'autonomy-invalid-input', statusCode: 400 }));
      }
      if (action !== 'status' && String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') {
        return json(response, 415, safeAutonomyInterfaceError({ code: 'autonomy-json-required', statusCode: 415 }));
      }
      const input = action === 'status' ? (url.searchParams.has('runId') ? { runId: url.searchParams.get('runId') } : {}) : await readJson(request);
      return json(response, 200, await autonomyInterfaceAction(projectRoot, action, input));
    }
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json(response, 200, {
        ok: true,
        schema: 'ewai.dashboard-health/v1',
        runtimeVersion: dashboardRuntimeVersion,
        projectRoot,
        projectName: project.config.project.name,
        pid: process.pid,
        port: requestedPort,
        url: `http://127.0.0.1:${requestedPort}`,
        startedAt,
        intents: runtimeIntentSummary(projectRoot)
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/dashboard/preferences') {
      return json(response,200,guarded(()=>readDashboardPreferences(projectRoot)));
    }
    if (request.method === 'POST' && url.pathname === '/api/dashboard/preferences') {
      const input=strictBody(await readJson(request),['confirmed','expectedDigest','preferences'],'Dashboard preferences');
      return json(response,200,guarded(()=>saveDashboardPreferences(projectRoot,input)));
    }
    if (request.method === 'GET' && url.pathname === '/api/project') {
      const workItems = listWorkItems(projectRoot);
      return json(response, 200, {
        name: project.config.project.name,
        root: projectRoot,
        premium: premiumSummary(),
        intents: runtimeIntentSummary(projectRoot),
        work: {
          count: workItems.length,
          sprint: workItems.filter((item) => item.currentSprint).length,
          active: workItems.filter((item) => item.lane === 'active').length,
          blocked: workItems.filter((item) => item.lane === 'blocked').length
        }
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/intents') {
      return json(response, 200, {
        intents: listRuntimeIntents(projectRoot, {
          query: url.searchParams.get('q') ?? '',
          status: url.searchParams.get('status') ?? ''
        })
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/intent') {
      const intent = readRuntimeIntent(projectRoot, url.searchParams.get('id') ?? '');
      return intent ? json(response, 200, { intent }) : json(response, 404, { error: 'Intent not found' });
    }
    if (request.method === 'GET' && url.pathname === '/api/work-items') {
      return json(response, 200, {
        items: listWorkItems(projectRoot, {
          query: url.searchParams.get('q') ?? '',
          group: url.searchParams.get('group') ?? '',
          lane: url.searchParams.get('lane') ?? '',
          sprint: url.searchParams.get('sprint') ?? ''
        })
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/groups') {
      return json(response, 200, { groups: listGroups(projectRoot) });
    }
    if (request.method === 'GET' && url.pathname === '/api/personas') {
      return json(response, 200, { personas: personaLibrary(url.searchParams.get('q') ?? '') });
    }
    if (request.method === 'POST' && url.pathname === '/api/personas/premium/setup') {
      let input;
      try {
        input = strictBody(await readJson(request), ['licenceKey', 'machineName', 'confirmed'], 'Premium persona setup');
        if (input.confirmed !== true || typeof input.licenceKey !== 'string' || !input.licenceKey.trim()
          || input.licenceKey.length > 512 || /[\x00-\x1f\x7f]/.test(input.licenceKey)
          || (input.machineName !== undefined && (typeof input.machineName !== 'string' || input.machineName.length > 120))) {
          return json(response, 400, { error: 'Provide a valid key and confirm verify-and-install.' });
        }
        const result = await configureAndInstallPremiumPersonas(projectRoot, { licenceKey: input.licenceKey, machineName: input.machineName, confirmed: true });
        return json(response, result.status === 'ready' ? 200 : 400, result.status === 'ready' ? result : { ...result, error: result.message });
      } catch (error) {
        return json(response, [403, 415, 413].includes(error.statusCode) ? error.statusCode : 400,
          { error: error.statusCode === 403 ? 'Use the matching dashboard origin.' : error.statusCode === 415 ? 'Use application/json.' : error.statusCode === 413 ? 'Setup request is too large.' : 'Setup could not be completed. Check the key and retry when no other setup is running.' });
      } finally { if (input) input.licenceKey = undefined; }
    }
    if (request.method === 'GET' && url.pathname === '/api/policies') {
      const unknown = [...url.searchParams.keys()].filter((key) => !['intent', 'mode'].includes(key));
      if (unknown.length) return json(response, 400, {
        error: `Unsupported policy query: ${unknown[0]}`,
        authority_notice: POLICY_DESIGN_AUTHORITY_NOTICE,
      });
      if (!['business', 'technical'].includes(url.searchParams.get('mode') ?? 'business')) return json(response, 400, {
        error: 'Policy workspace mode must be business or technical',
        authority_notice: POLICY_DESIGN_AUTHORITY_NOTICE,
      });
      return json(response, 200, readPolicyWorkspace(projectRoot, {
        intentReference: url.searchParams.get('intent') ?? '',
        mode: url.searchParams.get('mode') ?? 'business',
        personas: personaLibrary(),
      }));
    }
    if (request.method === 'POST' && url.pathname === '/api/policies/facts/confirm') {
      const input = strictBody(await readJson(request), ['intentReference', 'expectedRevision', 'expectedProposalDigest', 'confirmed', 'authority', 'confirmedBy', 'decisions'], 'Policy fact confirmation request');
      return json(response, 200, guarded(() => confirmPolicyFactsAction(projectRoot, input, { personas: personaLibrary() })));
    }
    if (request.method === 'POST' && url.pathname === '/api/policies/evaluate') {
      const input = strictBody(await readJson(request), ['intentReference', 'expectedIntentRevision', 'expectedPolicyDigest', 'expectedFactsDigest'], 'Policy evaluation request');
      return json(response, 200, guarded(() => evaluatePolicyDesignAction(projectRoot, input, { personas: personaLibrary() })));
    }
    if (request.method === 'POST' && url.pathname === '/api/policies/reviews') {
      const input = strictBody(await readJson(request), ['intentReference', 'evaluationDigest', 'ruleId', 'authority', 'reviewedBy', 'reviewerRole', 'decision', 'rationale', 'evidence', 'controls'], 'Policy review request');
      return json(response, 200, guarded(() => recordPolicyReviewAction(projectRoot, input, { personas: personaLibrary() })));
    }
    if (request.method === 'POST' && url.pathname === '/api/policies/exceptions') {
      const input = strictBody(await readJson(request), ['intentReference', 'evaluationDigest', 'ruleId', 'authority', 'approvedBy', 'owner', 'reviewerRole', 'scope', 'rationale', 'compensatingControls', 'evidence', 'expiresAt'], 'Policy exception request');
      return json(response, 200, guarded(() => recordPolicyExceptionAction(projectRoot, input, { personas: personaLibrary() })));
    }
    if (request.method === 'POST' && url.pathname === '/api/context-packs/prepare') {
      const input = strictBody(
        await readJson(request),
        ['profile', 'slug', 'taskId', 'phase', 'focus', 'budgetTokens', 'previousDigest'],
        'Context preparation request',
      );
      const pack = guarded(() => prepareProjectContext(projectRoot, {
        ...input,
        personaCatalogue: personaLibrary(),
      }));
      return json(response, 200, safeContextManifest(pack));
    }
    const contextPack = url.pathname.match(/^\/api\/context-packs\/([^/]+)$/);
    if (request.method === 'GET' && contextPack) {
      try {
        return json(response, 200, readStoredContextManifest(projectRoot, decodeURIComponent(contextPack[1])));
      } catch (error) {
        error.statusCode = /not found/i.test(error.message) ? 404 : 400;
        throw error;
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/companion') {
      const unknown = [...new Set(url.searchParams.keys())].filter((key) => key !== 'focus');
      if (unknown.length) return json(response, 400, { error: `Unsupported companion query: ${unknown[0]}` });
      const focus = url.searchParams.get('focus') ?? '';
      if (focus.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(focus)) {
        return json(response, 400, { error: 'Companion focus exceeds 500 characters or contains unsafe text' });
      }
      return json(response, 200, readCompanionGuidance(projectRoot, { focus, personas: personaLibrary() }));
    }
    if (request.method === 'GET' && url.pathname === '/api/portfolio') {
      const unknown = [...new Set(url.searchParams.keys())].filter((key) => key !== 'focus');
      if (unknown.length) return json(response, 400, { error: `Unsupported portfolio query: ${unknown[0]}` });
      const focus = url.searchParams.get('focus') ?? '';
      if (focus.length > 500) return json(response, 400, { error: 'Portfolio focus exceeds 500 characters' });
      return json(response, 200, readPortfolioWorkspace(projectRoot, { focus, personas: personaLibrary() }));
    }
    if (request.method === 'GET' && url.pathname === '/api/team-hub') {
      const unknown = [...new Set(url.searchParams.keys())];
      if (unknown.length) return json(response, 400, { error: `Unsupported Team Hub query: ${unknown[0]}` });
      return json(response, 200, readTeamHubWorkspace(projectRoot));
    }
    if (request.method === 'POST' && url.pathname === '/api/team-hub/connect') {
      const input = strictBody(
        await readJson(request),
        ['endpoint', 'projectId', 'tokenEnv', 'confirmed', 'disclosureAcknowledged'],
        'Team Hub connection request',
      );
      guarded(() => connectTeamHub(projectRoot, input));
      return json(response, 200, readTeamHubWorkspace(projectRoot));
    }
    if (request.method === 'POST' && url.pathname === '/api/team-hub/sync') {
      const input = strictBody(await readJson(request), ['confirmed'], 'Team Hub sync request');
      return json(response, 200, await syncTeamHub(projectRoot, input));
    }
    if (request.method === 'POST' && url.pathname === '/api/team-hub/disconnect') {
      const input = strictBody(await readJson(request), ['confirmed'], 'Team Hub disconnect request');
      return json(response, 200, guarded(() => disconnectTeamHub(projectRoot, input)));
    }
    if (request.method === 'GET' && url.pathname === '/api/team-hub/resources') {
      if ([...url.searchParams.keys()].length) return json(response, 400, { error: 'Team Hub resources do not accept query parameters' });
      return json(response, 200, await listConnectedTeamHubResources(projectRoot));
    }
    const teamHubResource = url.pathname.match(/^\/api\/team-hub\/resources\/([^/]+)\/releases\/([^/]+)$/);
    if (request.method === 'GET' && teamHubResource) {
      if ([...url.searchParams.keys()].length) return json(response, 400, { error: 'Team Hub resource inspection does not accept query parameters' });
      let id;
      let version;
      try { id = decodeURIComponent(teamHubResource[1]); version = decodeURIComponent(teamHubResource[2]); }
      catch { return json(response, 400, { error: 'Team Hub resource identity is invalid' }); }
      return json(response, 200, await inspectConnectedTeamHubResource(projectRoot, id, version));
    }
    if (request.method === 'POST' && url.pathname === '/api/team-hub/resources/install') {
      const input = strictBody(await readJson(request), ['id', 'version', 'expectedDigest', 'approvedBy', 'confirmed'], 'Team Hub resource installation request');
      return json(response, 200, await installConnectedTeamHubResource(projectRoot, input));
    }
    if (request.method === 'GET' && url.pathname === '/api/team-hub/resource-receipts') {
      if ([...url.searchParams.keys()].length) return json(response, 400, { error: 'Team Hub resource receipts do not accept query parameters' });
      return json(response, 200, { schema: 'ewai.team-hub-resource-receipts/v1', receipts: listTeamHubResourceReceipts(projectRoot) });
    }
    if (request.method === 'GET' && url.pathname === '/api/rollout') {
      const unknown = [...new Set(url.searchParams.keys())].filter((key) => key !== 'focus');
      if (unknown.length) return rolloutError(response, 400, `Unsupported rollout query: ${unknown[0]}`);
      const focus = url.searchParams.get('focus') ?? '';
      if (focus.length > 500 || focus.includes('\0')) return rolloutError(response, 400, 'Rollout focus exceeds 500 characters or contains unsafe text');
      return json(response, 200, readRolloutWorkspace(projectRoot, { focus, personas: personaLibrary() }));
    }
    const rolloutAssurance = url.pathname.match(/^\/api\/rollout\/projects\/([^/]+)\/assurance$/);
    if (request.method === 'GET' && rolloutAssurance) {
      if ([...url.searchParams.keys()].length) return rolloutError(response, 400, 'Focused rollout assurance accepts no query parameters');
      const projectId = decodeURIComponent(rolloutAssurance[1]);
      return json(response, 200, readRolloutWorkspace(projectRoot, { projectId, personas: personaLibrary() }));
    }
    if (request.method === 'GET' && url.pathname === '/api/hooks') {
      guarded(() => reconcileCanonicalLifecycleEvents(projectRoot));
      return json(response, 200, readLifecycleHookWorkspace(projectRoot, {
        status: url.searchParams.get('status') ?? '',
        event: url.searchParams.get('event') ?? '',
        handler: url.searchParams.get('handler') ?? '',
      }));
    }
    if (request.method === 'GET' && url.pathname === '/api/security-validation') {
      return json(response, 200, readSecurityWorkspace(projectRoot, { personas: personaLibrary() }));
    }
    if (request.method === 'GET' && url.pathname === '/api/error-reports') {
      const unknown = [...url.searchParams.keys()].filter((key) => key !== 'status');
      if (unknown.length) return json(response, 400, { error: `Unsupported error-report query: ${unknown[0]}` });
      const status = url.searchParams.get('status') ?? '';
      if (status && !['draft', 'finalised', 'archived'].includes(status)) return json(response, 400, { error: 'Error-report status filter is invalid.' });
      return json(response, 200, {
        ...listLocalErrorReports(projectRoot, { status }),
        providers: listErrorReportProviders(projectRoot).providers,
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/error-reports') {
      const input = strictBody(await readJson(request), ['capability', 'errorCode', 'command', 'title', 'expected', 'actual', 'reproductionSteps'], 'Error report creation request');
      return json(response, 201, createLocalErrorReport(projectRoot, {
        ...input,
        ewaiVersion: packageVersion,
        nodeVersion: process.versions.node,
        osClass: ['darwin', 'linux', 'win32'].includes(process.platform) ? process.platform : 'other',
        installationSource: 'npm',
      }));
    }
    if (request.method === 'PATCH' && url.pathname === '/api/error-reports/settings') {
      const input = strictBody(await readJson(request), ['automaticLocalDrafts', 'supportEmail'], 'Error report settings request');
      return json(response, 200, updateErrorReportSettings(projectRoot, input));
    }
    const errorReport = url.pathname.match(/^\/api\/error-reports\/(report_[a-z0-9_]{3,80})$/);
    if (request.method === 'GET' && errorReport) {
      if ([...url.searchParams.keys()].length) return json(response, 400, { error: 'Focused error reports accept no query parameters.' });
      const reportId = decodeURIComponent(errorReport[1]);
      const report = readLocalErrorReport(projectRoot, reportId);
      return report
        ? json(response, 200, { report, ...listErrorReportReceipts(projectRoot, reportId) })
        : json(response, 404, { error: 'Error report not found.' });
    }
    if (request.method === 'PATCH' && errorReport) {
      const input = strictBody(await readJson(request), ['title', 'expected', 'actual', 'reproductionSteps'], 'Error report update request');
      return json(response, 200, updateLocalErrorReport(projectRoot, decodeURIComponent(errorReport[1]), input));
    }
    if (request.method === 'DELETE' && errorReport) {
      const input = strictBody(await readJson(request), ['confirmed'], 'Error report deletion request');
      return json(response, 200, deleteErrorReport(projectRoot, decodeURIComponent(errorReport[1]), { confirmed: input.confirmed === true }));
    }
    const errorReportAction = url.pathname.match(/^\/api\/error-reports\/(report_[a-z0-9_]{3,80})\/(finalise|prepare-email|provider-attempts|archive)$/);
    if (request.method === 'POST' && errorReportAction) {
      const reportId = decodeURIComponent(errorReportAction[1]);
      const action = errorReportAction[2];
      if (action === 'finalise') {
        strictBody(await readJson(request), [], 'Error report finalisation request');
        return json(response, 200, finaliseLocalErrorReport(projectRoot, reportId));
      }
      if (action === 'prepare-email') {
        const input = strictBody(await readJson(request), ['expectedDigest', 'recipient', 'launch'], 'Error report email preparation request');
        return json(response, 200, prepareErrorReportEmail(projectRoot, reportId, input));
      }
      if (action === 'provider-attempts') {
        const input = strictBody(await readJson(request), ['providerId', 'expectedDigest', 'confirmed'], 'Error report provider submission request');
        return json(response, 200, await submitErrorReportProvider(projectRoot, reportId, input.providerId, {
          confirmed: input.confirmed === true,
          expectedDigest: input.expectedDigest,
        }));
      }
      const input = strictBody(await readJson(request), ['confirmed'], 'Error report archive request');
      return json(response, 200, archiveErrorReport(projectRoot, reportId, { confirmed: input.confirmed === true }));
    }
    if (request.method === 'GET' && url.pathname === '/api/starter-materialisation') {
      return json(response, 200, readStarterMaterialisationWorkspace(projectRoot, {
        personas: starterPersonas('review'),
      }));
    }
    if (request.method === 'POST' && url.pathname === '/api/starter-materialisation/previews') {
      const input = strictBody(
        await readJson(request),
        ['receiptId', 'adapterId', 'confirmed', 'timeoutMs'],
        'Starter preview request',
      );
      const preview = await prepareStarterMaterialisation(projectRoot, input.receiptId, input.adapterId, {
        confirmed: input.confirmed === true,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      });
      return json(response, 200, preview);
    }
    const starterApply = url.pathname.match(/^\/api\/starter-materialisation\/previews\/([^/]+)\/apply$/);
    if (request.method === 'POST' && starterApply) {
      const input = strictBody(await readJson(request), ['confirmed', 'approvedBy'], 'Starter application request');
      return json(response, 200, guarded(() => applyStarterMaterialisation(
        projectRoot,
        decodeURIComponent(starterApply[1]),
        { confirmed: input.confirmed === true, approvedBy: input.approvedBy, personas: starterPersonas('apply') },
      )));
    }
    const starterRecovery = url.pathname.match(/^\/api\/starter-materialisation\/attempts\/([^/]+)\/recover$/);
    if (request.method === 'POST' && starterRecovery) {
      const input = strictBody(await readJson(request), ['confirmed'], 'Starter recovery request');
      return json(response, 200, guarded(() => recoverStarterMaterialisation(
        projectRoot,
        decodeURIComponent(starterRecovery[1]),
        { confirmed: input.confirmed === true },
      )));
    }
    const securityRun = url.pathname.match(/^\/api\/security-validation\/profiles\/([^/]+)\/runs$/);
    if (request.method === 'POST' && securityRun) {
      const input = strictBody(await readJson(request), ['confirmed', 'mode', 'confirmedRuntimeTarget'], 'Security run request');
      const prepared = guarded(() => prepareSecurityRun(projectRoot, decodeURIComponent(securityRun[1]), {
        confirmed: input.confirmed === true,
        mode: input.mode,
        confirmedRuntimeTarget: input.confirmedRuntimeTarget === true,
        trustedRevision: resolveSecurityRevision(projectRoot),
      }));
      const result = prepared.run ? await executeSecurityRun(projectRoot, prepared.run.id) : prepared;
      return json(response, 200, result);
    }
    const securityImport = url.pathname.match(/^\/api\/security-validation\/profiles\/([^/]+)\/imports$/);
    if (request.method === 'POST' && securityImport) {
      const input = strictBody(await readJson(request), ['confirmed', 'providerId', 'discoveryToken'], 'Security import request');
      if (input.discoveryToken) {
        return json(response, 200, guarded(() => importSecurityArtifacts(projectRoot, input.discoveryToken, { confirmed: input.confirmed === true })));
      }
      const prepared = guarded(() => prepareSecurityArtifactImport(
        projectRoot,
        decodeURIComponent(securityImport[1]),
        input.providerId,
        { trustedRevision: resolveSecurityRevision(projectRoot) },
      ));
      return json(response, 202, prepared);
    }
    const securityCancel = url.pathname.match(/^\/api\/security-validation\/runs\/([^/]+)\/cancel$/);
    if (request.method === 'POST' && securityCancel) {
      const input = strictBody(await readJson(request), ['confirmed'], 'Security cancellation request');
      return json(response, 200, guarded(() => cancelSecurityRun(projectRoot, decodeURIComponent(securityCancel[1]), { confirmed: input.confirmed === true })));
    }
    const securityDisposition = url.pathname.match(/^\/api\/security-validation\/findings\/([^/]+)\/dispositions$/);
    if (request.method === 'POST' && securityDisposition) {
      const input = strictBody(
        await readJson(request),
        ['decision', 'reviewer', 'reason', 'evidence', 'riskOwner', 'expiresAt', 'nextRole'],
        'Security disposition request',
      );
      return json(response, 200, guarded(() => recordSecurityDisposition(projectRoot, decodeURIComponent(securityDisposition[1]), input)));
    }
    const hookRetry = url.pathname.match(/^\/api\/hooks\/deliveries\/([^/]+)\/retry$/);
    if (request.method === 'POST' && hookRetry) {
      const input = await readJson(request);
      const result = guarded(() => retryLifecycleDelivery(projectRoot, decodeURIComponent(hookRetry[1]), input));
      void lifecycleHookTick();
      return json(response, 200, result);
    }
    const hookDisable = url.pathname.match(/^\/api\/hooks\/subscriptions\/([^/]+)\/disable$/);
    if (request.method === 'POST' && hookDisable) {
      const input = await readJson(request);
      return json(response, 200, guarded(() => disableLifecycleSubscription(projectRoot, decodeURIComponent(hookDisable[1]), input)));
    }
    if (request.method === 'GET' && url.pathname === '/api/guided-discovery') {
      return json(response, 200, readGuidedDiscovery(projectRoot, { personas: personaLibrary() }));
    }
    if (request.method === 'GET' && url.pathname === '/api/evidence-depth') {
      const unknown = [...new Set(url.searchParams.keys())];
      if (unknown.length) return json(response, 400, { error: `Unsupported evidence depth query: ${unknown[0]}` });
      return json(response, 200, guarded(() => readEvidenceDepthWorkspace(projectRoot, { personas: personaLibrary() })));
    }
    if (request.method === 'POST' && url.pathname === '/api/evidence-depth/prepare') {
      const input = strictBody(await readJson(request), ['focus', 'ownerEvidence'], 'Evidence depth preparation request');
      return json(response, 200, guarded(() => prepareEvidenceDepthWorkspace(
        projectRoot,
        { focus: input.focus ?? '' },
        { personas: personaLibrary(), ownerEvidence: input.ownerEvidence ?? guidedDiscoveryOwnerEvidence(projectRoot) },
      )));
    }
    if (request.method === 'POST' && url.pathname === '/api/evidence-depth/record') {
      const input = strictBody(await readJson(request), ['schema', 'expectedPreparationDigest', 'reviewedBy', 'dimensions', 'grouping'], 'Evidence depth review request');
      return json(response, 200, guarded(() => recordEvidenceDepthWorkspaceRun(projectRoot, input)));
    }
    if (request.method === 'POST' && url.pathname === '/api/evidence-depth/compare') {
      const input = strictBody(await readJson(request), ['leftRunId', 'rightRunId'], 'Evidence depth comparison request');
      return json(response, 200, guarded(() => compareEvidenceDepthWorkspaceRuns(projectRoot, input)));
    }
    const prototypeReview = url.pathname.match(/^\/api\/prototype-reviews\/([^/]+)$/);
    if (request.method === 'GET' && prototypeReview) {
      const unknown = [...new Set(url.searchParams.keys())];
      if (unknown.length) return json(response, 400, { error: `Unsupported prototype review query: ${unknown[0]}` });
      return json(response, 200, guarded(() => readPrototypeIterationWorkspace(
        projectRoot,
        decodeURIComponent(prototypeReview[1]),
        { personas: personaLibrary() },
      )));
    }
    const prototypePlanPrepare = url.pathname.match(/^\/api\/prototype-reviews\/([^/]+)\/plan\/prepare$/);
    if (request.method === 'POST' && prototypePlanPrepare) {
      const input = strictBody(await readJson(request), ['intentDigest', 'designSystem', 'plan', 'signals', 'predecessorDigest'], 'Prototype plan preparation request');
      return json(response, 200, guarded(() => preparePrototypePlanWorkspace(
        projectRoot,
        decodeURIComponent(prototypePlanPrepare[1]),
        input,
        { personas: personaLibrary() },
      )));
    }
    const prototypePlanRecord = url.pathname.match(/^\/api\/prototype-reviews\/([^/]+)\/plan\/record$/);
    if (request.method === 'POST' && prototypePlanRecord) {
      const input = strictBody(await readJson(request), ['schema', 'expectedPreparationDigest', 'reviewedBy', 'findings', 'assessments'], 'Prototype plan review request');
      return json(response, 201, guarded(() => recordPrototypePlanWorkspaceReview(projectRoot, decodeURIComponent(prototypePlanRecord[1]), input)));
    }
    const prototypeCyclePrepare = url.pathname.match(/^\/api\/prototype-reviews\/([^/]+)\/cycles\/prepare$/);
    if (request.method === 'POST' && prototypeCyclePrepare) {
      const input = strictBody(await readJson(request), ['planReviewDigest', 'cycleNumber', 'maxCycles', 'predecessorDigest', 'prototype', 'evidenceChannels', 'signals'], 'Prototype cycle preparation request');
      return json(response, 200, guarded(() => preparePrototypeCycleWorkspace(
        projectRoot,
        decodeURIComponent(prototypeCyclePrepare[1]),
        input,
        { personas: personaLibrary() },
      )));
    }
    const prototypeCycleRecord = url.pathname.match(/^\/api\/prototype-reviews\/([^/]+)\/cycles\/record$/);
    if (request.method === 'POST' && prototypeCycleRecord) {
      const input = strictBody(await readJson(request), ['schema', 'expectedPreparationDigest', 'reviewedBy', 'findings', 'assessments'], 'Prototype cycle review request');
      return json(response, 201, guarded(() => recordPrototypeCycleWorkspaceReview(projectRoot, decodeURIComponent(prototypeCycleRecord[1]), input)));
    }
    const prototypeCompare = url.pathname.match(/^\/api\/prototype-reviews\/([^/]+)\/compare$/);
    if (request.method === 'POST' && prototypeCompare) {
      const input = strictBody(await readJson(request), ['leftDigest', 'rightDigest'], 'Prototype review comparison request');
      return json(response, 200, guarded(() => comparePrototypeWorkspaceReviews(projectRoot, decodeURIComponent(prototypeCompare[1]), input)));
    }
    if (request.method === 'PUT' && url.pathname === '/api/guided-discovery/draft') {
      const input = await readJson(request);
      return json(response, 200, saveGuidedDiscoveryDraft(projectRoot, input, { personas: personaLibrary() }));
    }
    if (request.method === 'POST' && url.pathname === '/api/guided-discovery/approve') {
      const input = await readJson(request);
      return json(response, 200, approveGuidedDiscovery(projectRoot, input, { personas: personaLibrary() }));
    }
    if (request.method === 'GET' && url.pathname === '/api/guided-intent') {
      const unknown = [...new Set(url.searchParams.keys())];
      if (unknown.length) return json(response, 400, { error: `Unsupported guided intent query: ${unknown[0]}` });
      return json(response, 200, readGuidedIntent(projectRoot, { personas: personaLibrary() }));
    }
    if (request.method === 'POST' && url.pathname === '/api/guided-intent/draft') {
      const input = strictBody(await readJson(request), ['expectedRevision', 'currentSection', 'mode', 'sourceReference', 'intent'], 'Guided intent draft request');
      return json(response, 200, guarded(() => saveGuidedIntentDraft(projectRoot, input, { personas: personaLibrary() })));
    }
    if (request.method === 'DELETE' && url.pathname === '/api/guided-intent/draft') {
      const input = strictBody(await readJson(request), ['expectedRevision', 'confirmed'], 'Guided intent discard request');
      return json(response, 200, guarded(() => discardGuidedIntentDraft(projectRoot, input)));
    }
    if (request.method === 'POST' && url.pathname === '/api/guided-intent/approve') {
      const input = strictBody(await readJson(request), ['expectedRevision', 'confirmed', 'approvedBy'], 'Guided intent approval request');
      return json(response, 200, guarded(() => approveGuidedIntent(projectRoot, input, { personas: personaLibrary() })));
    }
    if (request.method === 'POST' && url.pathname === '/api/personas') {
      const input = await readJson(request);
      const created = createPersona({
        scope: 'project',
        projectRoot,
        slug: input.slug,
        name: input.name,
        category: input.category,
        force: false
      });
      const persona = personaLibrary().find((candidate) => candidate.id === created.id);
      return json(response, 201, { persona });
    }
    if (request.method === 'GET' && url.pathname === '/api/knowledge') {
      const query = url.searchParams.get('q') ?? '';
      const knowledge = listKnowledge(projectRoot);
      if (!query.trim()) return json(response, 200, { ...knowledge, matches: [] });
      const search = searchPalace(projectRoot, query, { limit: 100 });
      const paths = new Set(search.results.map((result) => result.path));
      return json(response, 200, {
        ...knowledge,
        documents: knowledge.documents.filter((document) => paths.has(document.path)),
        count: paths.size,
        matches: search.results
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/meeting-evidence') {
      const unknown = [...new Set(url.searchParams.keys())].filter((key) => key !== 'source');
      if (unknown.length) return json(response, 400, { error: `Unsupported meeting evidence query: ${unknown[0]}`, assurance_notice: MEETING_EVIDENCE_DISCLAIMER });
      return json(response, 200, readMeetingEvidenceWorkspace(projectRoot, {
        sourceId: url.searchParams.get('source') || undefined,
        personaCatalogue: personaLibrary(),
      }));
    }
    if (request.method === 'GET' && url.pathname === '/api/knowledge-proposals') {
      const unknown = [...new Set(url.searchParams.keys())].filter((key) => key !== 'bundle');
      if (unknown.length) return json(response, 400, { error: `Unsupported knowledge proposal query: ${unknown[0]}`, assurance_notice: KNOWLEDGE_PROPOSALS_DISCLAIMER });
      return json(response, 200, readKnowledgeProposalWorkspace(projectRoot, {
        bundleId: url.searchParams.get('bundle') || undefined,
        personaCatalogue: personaLibrary(),
      }));
    }
    if (request.method === 'POST' && url.pathname === '/api/knowledge-proposals/prepare') {
      const input = strictBody(await readJson(request), ['sourceRef', 'focus'], 'Knowledge proposal preparation request');
      const prepared = prepareKnowledgeProposals(projectRoot, input.sourceRef, {
        focus: input.focus,
        personaCatalogue: personaLibrary(),
      });
      const { modelContext, ...safePreparation } = prepared;
      return json(response, 200, {
        ...safePreparation,
        modelContextAvailable: Boolean(modelContext),
        hostDirection: 'Use the CLI, MCP tool or ewai-knowledge-proposals skill to draft against the private bounded model context.',
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/knowledge-proposals/record') {
      const input = strictBody(await readJson(request), ['sourceRef', 'bundle', 'activePersonas'], 'Knowledge proposal recording request');
      return json(response, 200, {
        ...recordKnowledgeProposalBundle(projectRoot, input.sourceRef, { bundle: input.bundle, activePersonas: input.activePersonas }),
        notices: [KNOWLEDGE_PROPOSALS_DISCLAIMER],
      });
    }
    const knowledgeReview = url.pathname.match(/^\/api\/knowledge-proposals\/([^/]+)\/review$/);
    if (request.method === 'POST' && knowledgeReview) {
      const input = strictBody(await readJson(request), ['reviewedBy', 'dispositions'], 'Knowledge proposal review request');
      return json(response, 200, {
        ...recordKnowledgeProposalReview(projectRoot, decodeURIComponent(knowledgeReview[1]), input),
        notices: [KNOWLEDGE_PROPOSALS_DISCLAIMER],
      });
    }
    const knowledgeMaterialise = url.pathname.match(/^\/api\/knowledge-proposals\/([^/]+)\/materialise$/);
    if (request.method === 'POST' && knowledgeMaterialise) {
      const input = strictBody(await readJson(request), ['confirmed', 'approvedBy'], 'Knowledge proposal materialisation request');
      return json(response, 200, {
        ...materialiseKnowledgeProposals(projectRoot, decodeURIComponent(knowledgeMaterialise[1]), { confirmed: input.confirmed === true, approvedBy: input.approvedBy }),
        notices: [KNOWLEDGE_PROPOSALS_DISCLAIMER],
      });
    }
    const knowledgeRecovery = url.pathname.match(/^\/api\/knowledge-proposals\/([^/]+)\/recover$/);
    if (request.method === 'POST' && knowledgeRecovery) {
      const input = strictBody(await readJson(request), ['confirmed'], 'Knowledge proposal recovery request');
      return json(response, 200, {
        ...recoverKnowledgeMaterialisation(projectRoot, decodeURIComponent(knowledgeRecovery[1]), { confirmed: input.confirmed === true }),
        notices: [KNOWLEDGE_PROPOSALS_DISCLAIMER],
      });
    }
    const meetingPrepare = url.pathname.match(/^\/api\/meeting-evidence\/([^/]+)\/prepare$/);
    if (request.method === 'POST' && meetingPrepare) {
      const input = strictBody(await readJson(request), ['focus'], 'Meeting extraction request');
      return json(response, 200, prepareMeetingExtraction(projectRoot, decodeURIComponent(meetingPrepare[1]), {
        focus: input.focus,
        personaCatalogue: personaLibrary(),
      }));
    }
    const meetingPromote = url.pathname.match(/^\/api\/meeting-evidence\/([^/]+)\/promote$/);
    if (request.method === 'POST' && meetingPromote) {
      const input = strictBody(await readJson(request), ['confirmed', 'approvedBy'], 'Meeting promotion request');
      return json(response, 200, promoteMeetingEvidence(projectRoot, decodeURIComponent(meetingPromote[1]), {
        confirmed: input.confirmed === true,
        approvedBy: input.approvedBy,
      }));
    }
    if (request.method === 'GET' && url.pathname === '/api/palace/tidiness') {
      return json(response, 200, palaceTidiness(projectRoot));
    }
    if (request.method === 'GET' && url.pathname === '/api/knowledge/document') {
      const document = readKnowledgeDocument(projectRoot, url.searchParams.get('path') ?? '');
      return document ? json(response, 200, { document }) : json(response, 404, { error: 'SPECS document not found' });
    }
    if (request.method === 'GET' && url.pathname === '/api/active') {
      return json(response, 200, {
        sessions: listActiveSessions(projectRoot, {
          includeCompleted: url.searchParams.get('completed') === '1'
        })
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/dashboard-handoffs') {
      return json(response, 200, { handoffs: listDashboardHandoffs(projectRoot, { status: 'pending' }) });
    }
    if (request.method === 'GET' && url.pathname === '/api/afk/runs') {
      return json(response, 200, { runs: dashboardAfkRuns(projectRoot, url.searchParams.get('slug') ?? '') });
    }
    const workItemViewer = url.pathname.match(/^\/api\/work-items\/([^/]+)\/viewer$/);
    if (request.method === 'GET' && workItemViewer) {
      const view = dashboardWorkItemView(decodeURIComponent(workItemViewer[1]));
      return view ? json(response, 200, view) : json(response, 404, { error: 'Work item not found' });
    }
    const phaseStudio = url.pathname.match(/^\/api\/work-items\/([^/]+)\/phase-studio$/);
    if (request.method === 'GET' && phaseStudio) {
      const unknown = [...new Set(url.searchParams.keys())];
      if (unknown.length) return json(response, 400, { error: `Unsupported Phase Studio query: ${unknown[0]}` });
      const intent = readRuntimeIntent(projectRoot, decodeURIComponent(phaseStudio[1]));
      if (!intent) return json(response, 404, { error: 'Work item not found' });
      return json(response, 200, guarded(() => readPhaseStudio(projectRoot, intent.slug, { intent, personas: personaLibrary() })));
    }
    const phaseStudioDraft = url.pathname.match(/^\/api\/work-items\/([^/]+)\/phase-studio\/draft$/);
    if (request.method === 'POST' && phaseStudioDraft) {
      const intent = readRuntimeIntent(projectRoot, decodeURIComponent(phaseStudioDraft[1]));
      if (!intent) return json(response, 404, { error: 'Work item not found' });
      const input = strictBody(
        await readJson(request),
        ['expectedRevision', 'ownerContext', 'ownerName', 'entries', 'questions', 'conflicts', 'resolutions', 'limitations'],
        'Phase Studio draft request',
      );
      return json(response, 200, guarded(() => savePhaseContributionDraft(projectRoot, intent.slug, input, { intent, personas: personaLibrary() })));
    }
    if (request.method === 'DELETE' && phaseStudioDraft) {
      const intent = readRuntimeIntent(projectRoot, decodeURIComponent(phaseStudioDraft[1]));
      if (!intent) return json(response, 404, { error: 'Work item not found' });
      const input = strictBody(await readJson(request), ['expectedRevision', 'confirmed'], 'Phase Studio discard request');
      return json(response, 200, guarded(() => discardPhaseContributionDraft(projectRoot, intent.slug, input, { intent, personas: personaLibrary() })));
    }
    const phaseStudioHandoff = url.pathname.match(/^\/api\/work-items\/([^/]+)\/phase-studio\/handoff$/);
    if (request.method === 'POST' && phaseStudioHandoff) {
      const intent = readRuntimeIntent(projectRoot, decodeURIComponent(phaseStudioHandoff[1]));
      if (!intent) return json(response, 404, { error: 'Work item not found' });
      const input = strictBody(
        await readJson(request), ['expectedRevision', 'currentDigest', 'destinationContext', 'toOwner', 'reason', 'questions'], 'Phase Studio hand-off request',
      );
      return json(response, 200, guarded(() => handoffPhaseContribution(projectRoot, intent.slug, input, { intent, personas: personaLibrary() })));
    }
    const phaseStudioReview = url.pathname.match(/^\/api\/work-items\/([^/]+)\/phase-studio\/review$/);
    if (request.method === 'POST' && phaseStudioReview) {
      const intent = readRuntimeIntent(projectRoot, decodeURIComponent(phaseStudioReview[1]));
      if (!intent) return json(response, 404, { error: 'Work item not found' });
      const input = strictBody(await readJson(request), ['expectedRevision', 'currentDigest'], 'Phase Studio review request');
      return json(response, 202, guarded(() => requestPhaseContributionReview(projectRoot, intent.slug, input, { intent, personas: personaLibrary() })));
    }
    const phaseStudioConfirm = url.pathname.match(/^\/api\/work-items\/([^/]+)\/phase-studio\/confirm$/);
    if (request.method === 'POST' && phaseStudioConfirm) {
      const intent = readRuntimeIntent(projectRoot, decodeURIComponent(phaseStudioConfirm[1]));
      if (!intent) return json(response, 404, { error: 'Work item not found' });
      const input = strictBody(await readJson(request), ['expectedRevision', 'currentDigest', 'confirmed', 'confirmedBy'], 'Phase Studio confirmation request');
      return json(response, 201, guarded(() => confirmPhaseContribution(projectRoot, intent.slug, input, { intent, personas: personaLibrary() })));
    }
    const impactPreview = url.pathname.match(/^\/api\/work-items\/([^/]+)\/impact\/preview$/);
    if (request.method === 'POST' && impactPreview) {
      const reference = decodeURIComponent(impactPreview[1]);
      const view = dashboardWorkItemView(reference);
      if (!view) return json(response, 404, { error: 'Work item not found' });
      const input = await readJson(request);
      return json(response, 200, guarded(() => previewImpactAssessment(projectRoot, view.item.slug, input, { personas: personaLibrary() })));
    }
    const impactConfirm = url.pathname.match(/^\/api\/work-items\/([^/]+)\/impact\/confirm$/);
    if (request.method === 'POST' && impactConfirm) {
      const reference = decodeURIComponent(impactConfirm[1]);
      const view = dashboardWorkItemView(reference);
      if (!view) return json(response, 404, { error: 'Work item not found' });
      const input = await readJson(request);
      return json(response, 200, guarded(() => confirmImpactAssessment(projectRoot, view.item.slug, input, { personas: personaLibrary() })));
    }
    const impactRefresh = url.pathname.match(/^\/api\/work-items\/([^/]+)\/impact\/refresh$/);
    if (request.method === 'POST' && impactRefresh) {
      const reference = decodeURIComponent(impactRefresh[1]);
      const view = dashboardWorkItemView(reference);
      if (!view) return json(response, 404, { error: 'Work item not found' });
      const input = await readJson(request);
      if (input.confirmed !== true) return json(response, 409, { error: 'Refreshing the repository map requires explicit confirmation.' });
      const index = guarded(() => refreshRepositoryIndex(projectRoot));
      return json(response, 200, { index, view: dashboardWorkItemView(reference) });
    }
    const guidedHandoff = url.pathname.match(/^\/api\/work-items\/([^/]+)\/handoff$/);
    if (request.method === 'POST' && guidedHandoff) {
      const reference = decodeURIComponent(guidedHandoff[1]);
      const input = await readJson(request);
      const handoff = guarded(() => requestGuidedDashboardWork(projectRoot, reference, input));
      return json(response, 201, { handoff, view: dashboardWorkItemView(reference) });
    }
    const buildApproval = url.pathname.match(/^\/api\/work-items\/([^/]+)\/approve-build$/);
    if (request.method === 'POST' && buildApproval) {
      const reference = decodeURIComponent(buildApproval[1]);
      const input = await readJson(request);
      const result = guarded(() => approveBuildFromDashboard(projectRoot, reference, input));
      return json(response, 200, { ...result, view: dashboardWorkItemView(reference) });
    }
    const enterBuild = url.pathname.match(/^\/api\/work-items\/([^/]+)\/enter-build$/);
    if (request.method === 'POST' && enterBuild) {
      const reference = decodeURIComponent(enterBuild[1]);
      const input = await readJson(request);
      const result = guarded(() => enterBuildFromDashboard(projectRoot, reference, input));
      return json(response, 200, { ...result, view: dashboardWorkItemView(reference) });
    }
    const afkPreflight = url.pathname.match(/^\/api\/work-items\/([^/]+)\/afk\/preflight$/);
    if (request.method === 'GET' && afkPreflight) {
      const reference = decodeURIComponent(afkPreflight[1]);
      const preflight = guarded(() => preflightAfkFromDashboard(projectRoot, reference, {
        provider: url.searchParams.get('provider') ?? 'auto',
        maxParallel: Number(url.searchParams.get('parallel') ?? '1'),
      }));
      return json(response, 200, { preflight });
    }
    const afkStart = url.pathname.match(/^\/api\/work-items\/([^/]+)\/afk\/start$/);
    if (request.method === 'POST' && afkStart) {
      const reference = decodeURIComponent(afkStart[1]);
      const input = await readJson(request);
      const run = guarded(() => startAfkFromDashboard(projectRoot, reference, input));
      return json(response, 201, { run, view: dashboardWorkItemView(reference) });
    }
    const afkControl = url.pathname.match(/^\/api\/afk\/runs\/([^/]+)\/(pause|resume|cancel)$/);
    if (request.method === 'POST' && afkControl) {
      const input = await readJson(request);
      const run = guarded(() => controlAfkFromDashboard(projectRoot, decodeURIComponent(afkControl[1]), {
        ...input,
        action: afkControl[2],
      }));
      return json(response, 200, { run });
    }
    const handoffControl = url.pathname.match(/^\/api\/dashboard-handoffs\/([^/]+)\/(cancel)$/);
    if (request.method === 'POST' && handoffControl) {
      const input = await readJson(request);
      if (input.confirmed !== true) return json(response, 409, { error: 'Cancelling a dashboard handoff requires confirmation.' });
      const handoff = guarded(() => resolveDashboardHandoff(projectRoot, decodeURIComponent(handoffControl[1]), {
        status: 'cancelled',
        resolvedBy: 'dashboard',
      }));
      return json(response, 200, { handoff });
    }
    const workItemPersonas = url.pathname.match(/^\/api\/work-items\/([^/]+)\/personas$/);
    if (request.method === 'POST' && workItemPersonas) {
      const reference = decodeURIComponent(workItemPersonas[1]);
      const input = await readJson(request);
      const persona = personaLibrary().find((candidate) => candidate.id === input.personaRef);
      if (!persona) return json(response, 400, { error: `Unknown persona: ${input.personaRef ?? ''}` });
      const attachment = await attachPersonaToIntent(projectRoot, reference, input);
      return json(response, 200, { attachment, view: dashboardWorkItemView(reference) });
    }
    const workItemPersona = url.pathname.match(/^\/api\/work-items\/([^/]+)\/personas\/([^/]+)$/);
    if (request.method === 'DELETE' && workItemPersona) {
      const reference = decodeURIComponent(workItemPersona[1]);
      await readJson(request);
      const attachment = await detachPersonaFromIntent(projectRoot, reference, decodeURIComponent(workItemPersona[2]));
      return json(response, 200, { attachment, view: dashboardWorkItemView(reference) });
    }
    const workItem = url.pathname.match(/^\/api\/work-items\/([^/]+)$/);
    if (request.method === 'PATCH' && workItem) {
      const requested = await readJson(request);
      const allowed = Object.fromEntries(Object.entries(requested).filter(([key]) => (
        ['priority', 'currentSprint', 'blockedBy', 'notes'].includes(key)
      )));
      if (Object.keys(allowed).length !== Object.keys(requested).length) {
        return json(response, 409, {
          error: 'Delivery phase, status, and completion are controlled by the guarded EWAI delivery harness.'
        });
      }
      return json(response, 200, {
        item: updateWorkItem(projectRoot, decodeURIComponent(workItem[1]), allowed)
      });
    }
    const workItemPhase = url.pathname.match(/^\/api\/work-items\/([^/]+)\/phases\/([^/]+)$/);
    if (request.method === 'POST' && workItemPhase) {
      await readJson(request);
      return json(response, 409, {
        error: 'Raw phase changes are disabled. Use the guarded EWAI delivery harness and its deterministic gate evidence.'
      });
    }
    const workItemArtefacts = url.pathname.match(/^\/api\/work-items\/([^/]+)\/artefacts$/);
    if (request.method === 'POST' && workItemArtefacts) {
      return json(response, 201, {
        artefact: addArtefact(projectRoot, decodeURIComponent(workItemArtefacts[1]), await readJson(request))
      });
    }
    const activeEvents = url.pathname.match(/^\/api\/active\/([^/]+)\/events$/);
    if (request.method === 'GET' && activeEvents) {
      return json(response, 200, {
        events: listActivityEvents(projectRoot, decodeURIComponent(activeEvents[1]))
      });
    }
    const activeAction = url.pathname.match(/^\/api\/active\/([^/]+)\/(start|event|finish)$/);
    if (request.method === 'POST' && activeAction) {
      const reference = decodeURIComponent(activeAction[1]);
      const input = await readJson(request);
      const handler = activeAction[2] === 'start'
        ? startActiveSession
        : activeAction[2] === 'finish' ? finishActiveSession : addActivityEvent;
      return json(response, 200, handler(projectRoot, reference, input));
    }
    const prototype = url.pathname.match(/^\/prototype\/([^/]+)\/(\d+)\/(.*)$/);
    if (request.method === 'GET' && prototype) {
      const assetPath = decodeURIComponent(prototype[3] || '');
      if (servePrototype(response, decodeURIComponent(prototype[1]), Number(prototype[2]), assetPath)) return;
      return json(response, 404, { error: 'Prototype asset not found' });
    }
    if (request.method === 'GET' && serveStatic(response, url.pathname)) return;
    return json(response, 404, { error: 'Not found' });
  } catch (error) {
    if (url.pathname === '/api/autonomy' || url.pathname.startsWith('/api/autonomy/')) {
      const safe = safeAutonomyInterfaceError(error); return json(response, safe.statusCode, safe);
    }
    if (!url.pathname.startsWith('/api/error-reports')) {
      try {
        captureErrorReportFailure(projectRoot, {
          capability: 'dashboard',
          errorCode: 'EWAI-DASHBOARD-REQUEST-FAILED',
          command: 'ewai dashboard',
          ewaiVersion: packageVersion,
          nodeVersion: process.versions.node,
          osClass: ['darwin', 'linux', 'win32'].includes(process.platform) ? process.platform : 'other',
          installationSource: 'npm',
          title: 'An EWAI dashboard request did not complete',
          expected: 'The requested dashboard action completes.',
          actual: 'The action returned an error. The original error was shown separately and is not copied into this report.',
          reproductionSteps: ['Repeat the dashboard action'],
        });
      } catch {
        // Reporting must never replace or mask the original dashboard failure.
      }
    }
    if (url.pathname.startsWith('/api/rollout')) return rolloutError(response, error.statusCode ?? 400, error.message);
    return json(response, error.statusCode ?? (url.pathname.startsWith('/api/context-packs') || url.pathname.startsWith('/api/meeting-evidence') || url.pathname.startsWith('/api/knowledge-proposals') || url.pathname.startsWith('/api/error-reports') || url.pathname.startsWith('/api/team-hub') ? 400 : 500), url.pathname.startsWith('/api/security-validation')
      ? { error: error.message, assurance_notice: ASSURANCE_NOTICE }
      : url.pathname.startsWith('/api/meeting-evidence')
        ? { error: error.message, assurance_notice: MEETING_EVIDENCE_DISCLAIMER }
        : url.pathname.startsWith('/api/knowledge-proposals')
          ? { error: error.message, assurance_notice: KNOWLEDGE_PROPOSALS_DISCLAIMER }
          : url.pathname.startsWith('/api/policies')
            ? { error: error.message, authority_notice: POLICY_DESIGN_AUTHORITY_NOTICE }
            : { error: error.message });
  }
});

function dashboardState(port) {
  return {
    schema: 'ewai.dashboard-state/v1',
    runtimeVersion: dashboardRuntimeVersion,
    projectRoot,
    pid: process.pid,
    port,
    url: `http://127.0.0.1:${port}`,
    startedAt
  };
}

server.listen(requestedPort, '127.0.0.1', () => {
  mkdirSync(paths.runtimeStateRoot, { recursive: true });
  writeFileSync(paths.dashboardStatePath, `${JSON.stringify(dashboardState(requestedPort), null, 2)}\n`, 'utf8');
});

function shutdown() {
  clearInterval(lifecycleHookTimer);
  server.close(() => {
    try {
      const state = JSON.parse(readFileSync(paths.dashboardStatePath, 'utf8'));
      if (state.pid === process.pid) rmSync(paths.dashboardStatePath, { force: true });
    } catch {
      // A replacement process may already own the state file.
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 2000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
