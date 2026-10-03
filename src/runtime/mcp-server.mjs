#!/usr/bin/env node
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v4';
import { AUTONOMY_INTERFACE_FIELDS, autonomyInterfaceAction, safeAutonomyInterfaceError } from './dashboard-actions.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { premiumPersonaRoot } from '../checkin.mjs';
import { auditIntentStateCopies, createIntent } from '../intents.mjs';
import { createIntentMap } from '../intent-maps.mjs';
import {
  beginDelivery,
  completeDeliveryPhase,
  continueDelivery,
  phaseGateTemplate,
  readDeliveryState,
  recordBuildApproval,
  recordExternalValidationCycle,
  recordManualQaApproval,
  recordPhaseGate,
  resumeShelvedDelivery,
  startDeliveryPhase
} from '../delivery.mjs';
import {
  configureExternalValidation,
  configureValidationCheckpoint,
  loadProjectConfig,
  validationStatus,
} from '../project.mjs';
import { listPersonas, personalPersonaRoot, projectPersonaRoot } from '../personas.mjs';
import { readPortfolioWorkspace } from '../portfolio.mjs';
import { readRolloutWorkspace } from '../network-rollout.mjs';
import { readCompanionGuidance } from '../companion-guidance.mjs';
import {
  prepareMeetingExtraction,
  promoteMeetingEvidence,
  readMeetingEvidenceWorkspace,
  recordMeetingReview,
  registerMeetingSource,
} from '../meeting-evidence.mjs';
import {
  KNOWLEDGE_PROPOSALS_DISCLAIMER,
  listKnowledgeSources,
  materialiseKnowledgeProposals,
  prepareKnowledgeProposals,
  readKnowledgeProposalWorkspace,
  recordKnowledgeProposalBundle,
  recordKnowledgeProposalReview,
  recoverKnowledgeMaterialisation,
} from '../knowledge-proposals.mjs';
import { requiredPhaseArtefacts } from '../delivery-artifacts.mjs';
import { deliveryPaths } from '../delivery-documents.mjs';
import { dashboardStatus } from './dashboard.mjs';
import { prepareProjectContext } from './context-assembly.mjs';
import {
  confirmPolicyFactsAction,
  evaluatePolicyDesignAction,
  readPolicyWorkspace,
  recordPolicyExceptionAction,
  recordPolicyReviewAction,
} from './policy-workspace.mjs';
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
import { initializeRuntime } from './database.mjs';
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
} from './repository-index.mjs';
import { listRuntimeIntents, readRuntimeIntent, syncIntentIndex } from './intents.mjs';
import { listCommandRuns, markStaleCommandRuns } from './runs.mjs';
import {
  acquireExecutionLease,
  heartbeatExecutionLease,
  listExecutionLeases,
  releaseExecutionLease,
} from './execution-leases.mjs';
import { palaceTidiness, searchPalace } from './palace.mjs';
import {
  afkRunStatus,
  cancelAfkRun,
  pauseAfkRun,
  preflightAfkRun,
  resumeAfkRun,
  startAfkRun,
} from './afk-conductor.mjs';
import { listDashboardHandoffs, resolveDashboardHandoff } from './dashboard-handoffs.mjs';
import {
  addActivityEvent,
  addArtefact,
  finishActiveSession,
  listActiveSessions,
  listWorkItems,
  readWorkItemView,
  startActiveSession,
  updateWorkItem
} from './work.mjs';
import {
  archiveErrorReport,
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

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

const projectRoot = option('--project', process.cwd());
const packageVersion = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
).version;
const { config, paths } = loadProjectConfig(projectRoot);
initializeRuntime(paths.projectRoot);
syncIntentIndex(paths.projectRoot);

const server = new McpServer(
  { name: 'ewai-pipeline', version: packageVersion },
  {
    instructions: 'Treat SPECS Markdown as project truth. Use EWAI intent resources and read tools before proposing changes. Creation tools write project-owned SPECS artefacts; do not invoke them without the user asking for a new intent.'
  }
);

function result(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value ?? null, null, 2) }],
    structuredContent: value ?? null
  };
}

const autonomyFieldGuidance = Object.freeze({
  runId: 'UUID of an existing supervisor run. Status accepts this alone to read one run.',
  proposal: 'Closed object: intentIds (nonempty DOMAIN/SLUG string array), actions (nonempty array of begin-harness, prepare-phase, afk-build), providers (nonempty array of codex, claude, antigravity), expiresAt (future ISO UTC timestamp with milliseconds), limits (object with maxConcurrentIntents: 1, maxRuntimeMs: positive integer up to 86400000, maxOperationMs: positive integer no greater than maxRuntimeMs, maxAttempts: integer from 1 to 100). No extra keys.',
  record: 'Boolean. true persists the preview as evidence; this never approves the proposal.',
  confirmed: 'Boolean. true explicitly confirms a mutation, including a recorded preview.',
  expectedDigest: 'Current sha256: followed by 64 lowercase hexadecimal characters, obtained from the preview or grant.',
  approvedBy: 'Nonempty human name, trimmed, at most 120 characters, without control characters.',
  revokedBy: 'Nonempty human name, trimmed, at most 120 characters, without control characters.',
  provider: 'One of codex, claude, antigravity; must be within the current grant.',
  action: 'One of pause, resume, cancel, revoke, recover; subject to the current run state.',
  expectedRevision: 'Current positive safe integer revision of the run, read from status.',
  questionId: '64 lowercase hexadecimal characters identifying an open human question.',
  answeredBy: 'Nonempty human name, trimmed, at most 120 characters, without control characters.',
  answer: 'Nonempty private answer string, at most 16384 UTF-8 bytes. Never place it in a shell argument.',
});
const autonomyRequiredGuidance = Object.freeze({
  status: 'none; runId is optional', preview: 'none; proposal is needed for a new grant and record: true needs confirmed: true',
  approve: 'expectedDigest, approvedBy, confirmed', revoke: 'expectedDigest, revokedBy, confirmed',
  run: 'expectedDigest, provider, confirmed', service: 'expectedDigest, provider, confirmed',
  control: 'runId, action, expectedRevision, confirmed',
  answer: 'runId, questionId, expectedRevision, answeredBy, answer, confirmed',
});

for (const [action, fields] of Object.entries(AUTONOMY_INTERFACE_FIELDS)) {
  server.registerTool(`ewai_autonomy_${action}`, {
    title: `EWAI autonomy ${action}`,
    description: `Use the configured project only. Required fields: ${autonomyRequiredGuidance[action]}. ${action === 'status' || action === 'preview' ? 'Reading or previewing cannot launch a provider or approve work.' : 'Mutations require confirmed: true; they never grant Build, Manual QA or release approval.'} Unknown fields are rejected by the shared engine; refresh status or preview before acting on a current digest or revision.`,
    // Preserve the complete input for the shared closed validator, including
    // unknown fields. SDK stripping would hide attempted root overrides.
    inputSchema: z.object(Object.fromEntries(fields.map(key => [key, z.unknown().optional().describe(autonomyFieldGuidance[key])]))).passthrough(),
    annotations: { readOnlyHint: action === 'status', destructiveHint: false, openWorldHint: false },
  }, async input => {
    try { return result(await autonomyInterfaceAction(paths.projectRoot, action, input)); }
    catch (error) { return { ...result(safeAutonomyInterfaceError(error)), isError: true }; }
  });
}

function portfolioPersonas() {
  return listPersonas([
    resolve(import.meta.dirname, '../../packs/personas/core/personas'),
    premiumPersonaRoot(),
    personalPersonaRoot(),
    projectPersonaRoot(paths.projectRoot),
  ]);
}

const personaAttachmentSchema = z.object({
  ref: z.string().min(1),
  role: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  depth: z.number().int().min(1).max(5).optional(),
});

const intentRelationshipSchema = z.object({
  type: z.enum([
    'depends-on',
    'enables',
    'complements',
    'conflicts-with',
    'supersedes',
    'relates-to',
  ]),
  target: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/),
  rationale: z.string().optional(),
});

const deliveryShapeSchema = z.object({
  recommendation: z.enum(['single', 'split', 'decision-required']),
  reason: z.string().min(1),
  suggested_children: z.array(z.object({
    domain: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
    title: z.string().optional(),
    outcome: z.string(),
    depends_on: z.array(z.string()).optional(),
  })).optional(),
  blocking_questions: z.array(z.string()).optional(),
  reviewed_decision: z.enum(['keep-as-one', 'split', 'refine-split', 'defer']).nullable().optional(),
});

const mappedIntentSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  domain: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  title: z.string().min(1),
  problem: z.string().min(1),
  desiredOutcome: z.string().min(1),
  users: z.array(z.string()).optional(),
  journeys: z.array(z.string()).optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
  evidence: z.array(z.string()).optional(),
  openDecisions: z.array(z.string()).optional(),
  personas: z.array(personaAttachmentSchema).optional(),
  relationships: z.array(intentRelationshipSchema).optional(),
  deliveryShape: deliveryShapeSchema.optional(),
  delivery_shape: deliveryShapeSchema.optional(),
});

server.registerResource(
  'ewai-intent-library',
  'ewai://intents',
  {
    title: `${config.project.name} intent library`,
    description: 'Project intents indexed from SPECS/2.Purpose/intents.',
    mimeType: 'application/json'
  },
  (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'application/json',
      text: JSON.stringify({ intents: listRuntimeIntents(paths.projectRoot) }, null, 2)
    }]
  })
);

server.registerResource(
  'ewai-intent',
  new ResourceTemplate('ewai://intents/{reference}', {
    list: () => ({
      resources: listRuntimeIntents(paths.projectRoot).map((intent) => ({
        uri: `ewai://intents/${encodeURIComponent(intent.id)}`,
        name: intent.id,
        title: intent.title,
        description: intent.excerpt,
        mimeType: 'text/markdown'
      }))
    }),
    complete: { reference: () => listRuntimeIntents(paths.projectRoot).map((intent) => intent.id) }
  }),
  {
    title: 'EWAI project intent',
    description: 'Authoritative intent Markdown from the project SPECS.',
    mimeType: 'text/markdown'
  },
  (uri, { reference }) => {
    const intent = readRuntimeIntent(paths.projectRoot, decodeURIComponent(String(reference)));
    return {
      contents: [{
        uri: uri.href,
        mimeType: 'text/markdown',
        text: intent?.markdown ?? 'Intent not found.'
      }]
    };
  }
);

server.registerTool(
  'ewai_list_intents',
  {
    title: 'List project intents',
    description: 'List and search project intents indexed from SPECS.',
    inputSchema: {
      query: z.string().optional(),
      status: z.string().optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async ({ query = '', status = '' }) => result({
    intents: listRuntimeIntents(paths.projectRoot, { query, status })
  })
);

server.registerTool(
  'ewai_read_intent',
  {
    title: 'Read a project intent',
    description: 'Read one intent by its domain/slug identifier or slug.',
    inputSchema: { reference: z.string().min(1) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async ({ reference }) => result({ intent: readRuntimeIntent(paths.projectRoot, reference) })
);

server.registerTool(
  'ewai_context_prepare',
  {
    title: 'Prepare governed model context',
    description: 'Prepare a bounded revision-bound context pack for a supported EWAI profile. The trusted MCP host receives transient model context plus a body-free safe manifest. This cannot approve or execute delivery work.',
    inputSchema: {
      profile: z.enum(['companion', 'intent', 'plan', 'build-task', 'fresh-context-review', 'phase-contribution-review']),
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      taskId: z.string().regex(/^T-\d{3,}$/).optional(),
      phase: z.string().max(80).optional(),
      focus: z.string().max(2000).optional(),
      budgetTokens: z.number().int().min(1).max(200000).optional(),
      previousDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (input) => result(prepareProjectContext(paths.projectRoot, {
    ...input,
    personaCatalogue: portfolioPersonas(),
  })),
);

server.registerTool(
  'ewai_policy_status',
  {
    title: 'Read organisation policy design-gate status',
    description: 'Read one safe business or technical projection of the optional design-time policy workspace, including the active advisory personas. This is not production enforcement or release authority.',
    inputSchema: {
      intentReference: z.string().max(240).optional(),
      mode: z.enum(['business', 'technical']).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ intentReference = '', mode = 'business' }) => result(readPolicyWorkspace(paths.projectRoot, {
    intentReference,
    mode,
    personas: portfolioPersonas(),
  })),
);

server.registerTool(
  'ewai_policy_confirm_facts',
  {
    title: 'Confirm policy design facts',
    description: 'Persist a complete named-human confirmation of the digest-bound proposed design facts. Personas remain advisory.',
    inputSchema: {
      intentReference: z.string().min(1).max(240),
      expectedRevision: z.number().int().positive(),
      expectedProposalDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      confirmed: z.literal(true),
      authority: z.literal('human'),
      confirmedBy: z.string().min(1).max(160),
      decisions: z.array(z.object({
        factId: z.string().min(1).max(160),
        disposition: z.enum(['confirmed', 'rejected']),
        values: z.array(z.string().min(1).max(120)).min(1).max(40).optional(),
      }).strict()).min(1).max(100),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (input) => result(confirmPolicyFactsAction(paths.projectRoot, input, { personas: portfolioPersonas() })),
);

server.registerTool(
  'ewai_policy_evaluate',
  {
    title: 'Evaluate a policy design',
    description: 'Run the deterministic organisation-policy design evaluation against current confirmed facts and an exact baseline digest.',
    inputSchema: {
      intentReference: z.string().min(1).max(240),
      expectedIntentRevision: z.number().int().positive(),
      expectedPolicyDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      expectedFactsDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (input) => result(evaluatePolicyDesignAction(paths.projectRoot, input, { personas: portfolioPersonas() })),
);

server.registerTool(
  'ewai_policy_record_review',
  {
    title: 'Record a named policy review',
    description: 'Record a named-human decision for one review-required rule on the current exact evaluation.',
    inputSchema: {
      intentReference: z.string().min(1).max(240),
      evaluationDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      ruleId: z.string().min(1).max(240),
      authority: z.literal('human'),
      reviewedBy: z.string().min(1).max(160),
      reviewerRole: z.string().min(1).max(160),
      decision: z.enum(['allow', 'deny', 'allow-with-controls']),
      rationale: z.string().min(1).max(2000),
      evidence: z.array(z.string().min(1).max(500)).min(1).max(40),
      controls: z.array(z.string().min(1).max(500)).max(40).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (input) => result(recordPolicyReviewAction(paths.projectRoot, input, { personas: portfolioPersonas() })),
);

server.registerTool(
  'ewai_policy_record_exception',
  {
    title: 'Record a bounded policy exception',
    description: 'Record an owned, time-limited, named-human exception only where the matched rule permits it.',
    inputSchema: {
      intentReference: z.string().min(1).max(240),
      evaluationDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      ruleId: z.string().min(1).max(240),
      authority: z.literal('human'),
      approvedBy: z.string().min(1).max(160),
      owner: z.string().min(1).max(160),
      reviewerRole: z.string().min(1).max(160),
      scope: z.record(z.string(), z.array(z.string().min(1).max(240)).min(1)).refine((value) => Object.keys(value).length > 0),
      rationale: z.string().min(1).max(2000),
      compensatingControls: z.array(z.string().min(1).max(500)).min(1).max(40),
      evidence: z.array(z.string().min(1).max(500)).min(1).max(40),
      expiresAt: z.string().datetime(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (input) => result(recordPolicyExceptionAction(paths.projectRoot, input, { personas: portfolioPersonas() })),
);

server.registerTool(
  'ewai_search_palace',
  {
    title: 'Search the project Mind Palace',
    description: 'Search the full content of project SPECS and return the best matching document sections.',
    inputSchema: {
      query: z.string().min(1),
      limit: z.number().int().min(1).max(100).optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async ({ query, limit = 25 }) => result(searchPalace(paths.projectRoot, query, { limit }))
);

const evidenceDepthOwnerEvidenceSchema = z.object({
  id: z.string().min(1).max(200),
  dimension: z.enum(['architecture', 'data', 'security', 'product', 'delivery', 'governance', 'operations']),
  authority: z.enum(['declared', 'confirmed']),
  evidenceDigest: z.string().regex(/^sha256:[a-z0-9._-]{3,200}$/i),
  answerCode: z.string().min(1).max(200),
  reasonCode: z.string().min(1).max(200),
  contradiction: z.enum(['none', 'declared-versus-observed', 'observed-versus-observed', 'declared-versus-declared', 'unresolved']).optional(),
});

server.registerTool(
  'ewai_evidence_depth_status',
  {
    title: 'Read reproducible archaeology and discovery depth',
    description: 'Read the seven-dimensional evidence ledger, stable gaps, active personas and named stored runs without returning source, answer or managed persona bodies.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async () => result(readEvidenceDepthWorkspace(paths.projectRoot, { personas: portfolioPersonas() })),
);

server.registerTool(
  'ewai_evidence_depth_prepare',
  {
    title: 'Prepare a reproducible evidence-depth review',
    description: 'Prepare deterministic recommendations and questions from the fresh Source Map, separate named owner evidence and relevant installed personas. This does not approve depth or grouping.',
    inputSchema: {
      focus: z.string().max(200).optional(),
      ownerEvidence: z.array(evidenceDepthOwnerEvidenceSchema).max(50).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ focus = '', ownerEvidence = [] }) => result(prepareEvidenceDepthWorkspace(
    paths.projectRoot,
    { focus },
    { personas: portfolioPersonas(), ownerEvidence },
  )),
);

const evidenceDepthDimensionReviewSchema = z.object({
  id: z.enum(['architecture', 'data', 'security', 'product', 'delivery', 'governance', 'operations']),
  selectedDepth: z.enum(['bounded', 'standard', 'deep']),
  rationale: z.string().max(500).optional(),
});

const evidenceDepthGroupingAssignmentSchema = z.object({
  gapId: z.string().min(1).max(200),
  groupId: z.string().min(1).max(200),
  disposition: z.enum(['owned', 'shared', 'deferred', 'excluded']),
});

server.registerTool(
  'ewai_evidence_depth_record',
  {
    title: 'Record a named evidence-depth review',
    description: 'Record the exact named-human selection for all seven dimensions and every stable gap. This is evidence, not delivery or release approval.',
    inputSchema: {
      schema: z.literal('ewai.evidence-depth-review/v1'),
      expectedPreparationDigest: z.string().regex(/^sha256:[a-z0-9._-]{3,200}$/i),
      reviewedBy: z.string().min(1).max(120),
      dimensions: z.array(evidenceDepthDimensionReviewSchema).length(7),
      grouping: z.object({
        strategy: z.string().min(1).max(200),
        assignments: z.array(evidenceDepthGroupingAssignmentSchema).max(200),
      }),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (input) => result(recordEvidenceDepthWorkspaceRun(paths.projectRoot, input)),
);

server.registerTool(
  'ewai_evidence_depth_compare',
  {
    title: 'Compare two reviewed evidence-depth runs',
    description: 'Compare exact stored run identities in causal order without rescanning the repository or treating comparison as approval.',
    inputSchema: { leftRunId: z.string().min(1).max(200), rightRunId: z.string().min(1).max(200) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async (input) => result(compareEvidenceDepthWorkspaceRuns(paths.projectRoot, input)),
);

const prototypeDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const prototypeSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/);
const prototypeFindingReferenceSchema = z.object({
  personaId: z.string().min(1).max(200),
  concernCode: z.string().min(1).max(200),
  evidenceRefs: z.array(z.string().min(1).max(200)).min(1).max(50),
});
const prototypeFindingSchema = prototypeFindingReferenceSchema.extend({
  severity: z.enum(['advisory', 'material', 'critical']),
  observation: z.string().min(1).max(2000),
  recommendation: z.string().min(1).max(2000),
});
const prototypeAssessmentSchema = z.object({
  findingId: z.string().min(1).max(200).optional(),
  findingRef: prototypeFindingReferenceSchema.optional(),
  disposition: z.enum(['incorporate', 'incorporate-with-modification', 'defer', 'reject', 'escalate']),
  rationale: z.string().min(1).max(2000),
  modification: z.string().max(2000).optional(),
  owner: z.string().max(160).optional(),
}).refine((value) => Boolean(value.findingId) !== Boolean(value.findingRef), 'Supply exactly one of findingId or findingRef');
const prototypeReviewSubmissionSchema = {
  deliverySlug: prototypeSlugSchema,
  schema: z.enum(['ewai.prototype-plan-review-submission/v1', 'ewai.prototype-cycle-review-submission/v1']),
  expectedPreparationDigest: prototypeDigestSchema,
  reviewedBy: z.string().min(1).max(160),
  findings: z.array(prototypeFindingSchema).max(200),
  assessments: z.array(prototypeAssessmentSchema).max(200),
};

server.registerTool(
  'ewai_prototype_review_status',
  {
    title: 'Read persona-guided prototype review status',
    description: 'Read reviewed plan and rendered-design cycles, stage-specific active personas, tier availability, findings, dispositions and the derived next action. Personas advise; people select and approve.',
    inputSchema: { deliverySlug: prototypeSlugSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ deliverySlug }) => result(readPrototypeIterationWorkspace(paths.projectRoot, deliverySlug, { personas: portfolioPersonas() })),
);

server.registerTool(
  'ewai_prototype_plan_prepare',
  {
    title: 'Prepare persona review of a prototype plan',
    description: 'Identify relevant installed personas for the proposed screens and journeys, then create a deterministic review preparation. This does not record model findings or select a prototype.',
    inputSchema: {
      deliverySlug: prototypeSlugSchema,
      intentDigest: prototypeDigestSchema,
      designSystem: z.object({ id: z.string().min(1).max(200), effectiveDigest: prototypeDigestSchema }),
      plan: z.object({
        summary: z.string().min(1).max(2000),
        screens: z.array(z.object({ id: z.string(), title: z.string(), purpose: z.string(), userOutcomes: z.array(z.string()), evidenceRefs: z.array(z.string()) })).min(1).max(100),
        journeys: z.array(z.object({ id: z.string(), actor: z.string(), outcome: z.string(), screenRefs: z.array(z.string()) })).min(1).max(100),
      }),
      signals: z.array(z.string().min(1).max(120)).max(50).optional(),
      predecessorDigest: prototypeDigestSchema.optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ deliverySlug, ...input }) => result(preparePrototypePlanWorkspace(paths.projectRoot, deliverySlug, input, { personas: portfolioPersonas() })),
);

server.registerTool(
  'ewai_prototype_plan_record',
  {
    title: 'Record assessed persona findings for a prototype plan',
    description: 'Record immutable persona findings and exactly one explicit disposition per finding. Recording is advisory evidence and is not prototype selection or Manual QA.',
    inputSchema: prototypeReviewSubmissionSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ deliverySlug, ...input }) => result(recordPrototypePlanWorkspaceReview(paths.projectRoot, deliverySlug, input)),
);

server.registerTool(
  'ewai_prototype_cycle_prepare',
  {
    title: 'Prepare persona review of a rendered prototype cycle',
    description: 'Recompute relevant personas against the actual rendered design and seven separate evidence channels. Review is bounded to one to three configured cycles.',
    inputSchema: {
      deliverySlug: prototypeSlugSchema,
      planReviewDigest: prototypeDigestSchema,
      cycleNumber: z.number().int().min(1).max(3),
      maxCycles: z.number().int().min(1).max(3).optional(),
      predecessorDigest: prototypeDigestSchema.optional(),
      prototype: z.object({ manifestDigest: prototypeDigestSchema, entryPath: z.string().min(1).max(240) }),
      evidenceChannels: z.array(z.object({
        channel: z.enum(['source', 'rendered-viewport', 'interaction', 'assistive-technology', 'user-research', 'manual-qa', 'release']),
        status: z.enum(['available', 'not-collected', 'not-applicable', 'pending-human']),
        evidenceRefs: z.array(z.string().min(1).max(200)).max(100),
        note: z.string().min(1).max(1000),
      })).length(7),
      signals: z.array(z.string().min(1).max(120)).max(50).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ deliverySlug, ...input }) => result(preparePrototypeCycleWorkspace(paths.projectRoot, deliverySlug, input, { personas: portfolioPersonas() })),
);

server.registerTool(
  'ewai_prototype_cycle_record',
  {
    title: 'Record assessed persona findings for a rendered prototype',
    description: 'Record an immutable design-review cycle and derive iterate, ready-for-human-selection or human-decision-required. This cannot approve Manual QA or release.',
    inputSchema: prototypeReviewSubmissionSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ deliverySlug, ...input }) => result(recordPrototypeCycleWorkspaceReview(paths.projectRoot, deliverySlug, input)),
);

server.registerTool(
  'ewai_prototype_review_compare',
  {
    title: 'Compare two prototype reviews',
    description: 'Explain review variance in causal order: inputs, personas, findings, assessments and output.',
    inputSchema: { deliverySlug: prototypeSlugSchema, leftDigest: prototypeDigestSchema, rightDigest: prototypeDigestSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ deliverySlug, ...input }) => result(comparePrototypeWorkspaceReviews(paths.projectRoot, deliverySlug, input)),
);

server.registerTool(
  'ewai_palace_tidiness',
  {
    title: 'Inspect Mind Palace tidiness',
    description: 'Run deterministic, read-only checks for broken links, duplicate content, orphaned documents, empty documents, and missing titles in SPECS.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async () => result(palaceTidiness(paths.projectRoot))
);

server.registerTool(
  'ewai_meeting_status',
  {
    title: 'Read meeting evidence status',
    description: 'Read safe registered-source metadata, named review dispositions, evidence receipts and the currently engaged persona ensemble. Raw transcript text and absolute paths are never returned.',
    inputSchema: {
      sourceId: z.string().optional(),
      focus: z.string().max(500).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ sourceId, focus }) => result(readMeetingEvidenceWorkspace(paths.projectRoot, { sourceId, focus })),
);

server.registerTool(
  'ewai_meeting_register',
  {
    title: 'Register a local meeting source',
    description: 'Register a supported local transcript or minutes file after explicit confirmation. The file is not copied into SPECS or the runtime database.',
    inputSchema: {
      file: z.string().min(1),
      confirmed: z.boolean(),
      label: z.string().max(160).optional(),
      classification: z.enum(['public', 'internal', 'confidential', 'restricted']).optional(),
      cloudProcessing: z.enum(['allowed', 'denied', 'unknown']).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ file, ...input }) => result(registerMeetingSource(paths.projectRoot, file, input)),
);

server.registerTool(
  'ewai_meeting_prepare',
  {
    title: 'Prepare meeting evidence extraction',
    description: 'Return the safe source facts, processing route, strict candidate contract and contextual active personas for host-model extraction.',
    inputSchema: { sourceId: z.string().min(1), focus: z.string().max(500).optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ sourceId, focus }) => result(prepareMeetingExtraction(paths.projectRoot, sourceId, { focus })),
);

const meetingCandidateSchema = z.object({
  id: z.string(),
  type: z.string(),
  observedStatement: z.string(),
  interpretation: z.string(),
  lineAnchors: z.array(z.object({ start: z.number().int(), end: z.number().int() })),
  confidence: z.enum(['low', 'medium', 'high']),
});

server.registerTool(
  'ewai_meeting_review',
  {
    title: 'Record a named meeting evidence review',
    description: 'Validate a complete candidate bundle and record one named disposition for every candidate. This does not promote evidence.',
    inputSchema: {
      sourceId: z.string().min(1),
      reviewedBy: z.string().min(1).max(160),
      bundle: z.object({
        schema: z.literal('ewai.meeting-candidate-bundle/v1'),
        sourceId: z.string(),
        sourceDigest: z.string(),
        candidates: z.array(meetingCandidateSchema),
      }),
      dispositions: z.array(z.object({
        candidateId: z.string(),
        decision: z.enum(['accepted', 'rejected', 'amended', 'deferred']),
        replacementText: z.string().optional(),
        rationale: z.string().optional(),
      })),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ sourceId, ...input }) => result(recordMeetingReview(paths.projectRoot, sourceId, input)),
);

server.registerTool(
  'ewai_meeting_promote',
  {
    title: 'Promote reviewed meeting evidence',
    description: 'After exact confirmation and named approval, persist accepted and amended candidates as paired evidence files only.',
    inputSchema: {
      sourceId: z.string().min(1),
      confirmed: z.boolean(),
      approvedBy: z.string().min(1).max(160),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ sourceId, ...input }) => result(promoteMeetingEvidence(paths.projectRoot, sourceId, input)),
);

const knowledgePersonaSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(160),
  tier: z.enum(['core', 'premium', 'personal', 'project']),
  category: z.string().max(100).optional(),
  description: z.string().max(240).optional(),
  matchedSignals: z.array(z.string().max(100)).optional(),
  engagementReason: z.string().min(1).max(400),
});

const knowledgeProposalSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  destination: z.string(),
  evidenceAnchors: z.array(z.string()),
  rationale: z.string(),
  uncertainty: z.string().optional(),
  relationships: z.array(z.string()).optional(),
  proposedMarkdown: z.string(),
});

const knowledgeBundleSchema = z.object({
  schema: z.literal('ewai.knowledge-proposal-bundle/v1'),
  sourceRef: z.string(),
  sourceDigest: z.string(),
  proposals: z.array(knowledgeProposalSchema),
});

const knowledgeDispositionSchema = z.object({
  proposalId: z.string(),
  decision: z.enum(['accepted', 'rejected', 'amended', 'deferred']),
  rationale: z.string().optional(),
  replacementTitle: z.string().optional(),
  replacementMarkdown: z.string().optional(),
});

server.registerTool(
  'ewai_knowledge_proposal_sources',
  {
    title: 'List eligible knowledge proposal sources',
    description: 'List allowlisted promoted meeting evidence and canonical retrospectives without returning their body or private path.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async () => result({ schema: 'ewai.knowledge-source-list/v1', sources: listKnowledgeSources(paths.projectRoot), notices: [KNOWLEDGE_PROPOSALS_DISCLAIMER] }),
);

server.registerTool(
  'ewai_knowledge_proposal_status',
  {
    title: 'Read knowledge proposal status',
    description: 'Read the safe proposal, review, materialisation, conflict and active-persona workspace without source bodies or private paths.',
    inputSchema: { bundleId: z.string().optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ bundleId }) => result(readKnowledgeProposalWorkspace(paths.projectRoot, { bundleId })),
);

server.registerTool(
  'ewai_knowledge_proposal_prepare',
  {
    title: 'Prepare persona-led knowledge proposals',
    description: 'Return bounded evidence context, the strict proposal contract and actively engaged project, core and optional installed personas for host-model drafting. This writes no project knowledge.',
    inputSchema: { sourceRef: z.string().min(1), focus: z.string().max(500).optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ sourceRef, focus }) => result(prepareKnowledgeProposals(paths.projectRoot, sourceRef, { focus })),
);

server.registerTool(
  'ewai_knowledge_proposal_record',
  {
    title: 'Record a validated knowledge proposal bundle',
    description: 'Validate and record evidence-grounded proposals under the proposal evidence area only. This does not write canonical destination knowledge.',
    inputSchema: { sourceRef: z.string().min(1), bundle: knowledgeBundleSchema, activePersonas: z.array(knowledgePersonaSchema).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ sourceRef, bundle, activePersonas }) => result({
    ...recordKnowledgeProposalBundle(paths.projectRoot, sourceRef, { bundle, activePersonas }),
    notices: [KNOWLEDGE_PROPOSALS_DISCLAIMER],
  }),
);

server.registerTool(
  'ewai_knowledge_proposal_review',
  {
    title: 'Record a complete named knowledge proposal review',
    description: 'Record one named disposition for every proposal. Review does not grant materialisation authority.',
    inputSchema: { bundleId: z.string().min(1), reviewedBy: z.string().min(1).max(160), dispositions: z.array(knowledgeDispositionSchema) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ bundleId, ...input }) => result({
    ...recordKnowledgeProposalReview(paths.projectRoot, bundleId, input),
    notices: [KNOWLEDGE_PROPOSALS_DISCLAIMER],
  }),
);

server.registerTool(
  'ewai_knowledge_proposal_materialise',
  {
    title: 'Additively materialise reviewed knowledge proposals',
    description: 'After separate exact confirmation and named approval, create absent accepted destinations, recognise identical content and preserve differing files as conflicts.',
    inputSchema: { bundleId: z.string().min(1), confirmed: z.boolean(), approvedBy: z.string().min(1).max(160) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ bundleId, ...input }) => result({
    ...materialiseKnowledgeProposals(paths.projectRoot, bundleId, input),
    notices: [KNOWLEDGE_PROPOSALS_DISCLAIMER],
  }),
);

server.registerTool(
  'ewai_knowledge_proposal_recover',
  {
    title: 'Recover an interrupted knowledge materialisation',
    description: 'After exact confirmation, remove only transaction-owned incomplete writes or clean a stale journal after an immutable ledger exists.',
    inputSchema: { bundleId: z.string().min(1), confirmed: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  async ({ bundleId, confirmed }) => result({
    ...recoverKnowledgeMaterialisation(paths.projectRoot, bundleId, { confirmed }),
    notices: [KNOWLEDGE_PROPOSALS_DISCLAIMER],
  }),
);

server.registerTool(
  'ewai_create_intent',
  {
    title: 'Create a project intent',
    description: 'Create a new project-owned intent in SPECS after the user asks to capture a feature or idea.',
    inputSchema: {
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      domain: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
      title: z.string().min(1).optional(),
      deliveryShape: deliveryShapeSchema.optional(),
      delivery_shape: deliveryShapeSchema.optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  async ({ slug, domain = 'general', title = '', deliveryShape = null, delivery_shape = null }) => {
    const intent = createIntent(paths.projectRoot, {
      slug,
      domain,
      title,
      personas: [],
      deliveryShape: deliveryShape ?? delivery_shape,
    });
    syncIntentIndex(paths.projectRoot);
    return result({ intent });
  }
);

server.registerTool(
  'ewai_create_intent_map',
  {
    title: 'Create a reviewed map of connected intents',
    description: 'Atomically create an approved product-level intent map and its linked draft intents after a conversational shaping review.',
    inputSchema: {
      confirmed: z.literal(true),
      approvedBy: z.string().min(1).optional(),
      map: z.object({
        schema: z.literal('ewai.intent-map-request/v1').optional(),
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        title: z.string().min(1),
        idea: z.string().min(1),
        desiredOutcome: z.string().min(1),
        users: z.array(z.string()).optional(),
        evidence: z.array(z.string()).optional(),
        boundaries: z.array(z.string()).optional(),
        nonGoals: z.array(z.string()).optional(),
        assumptions: z.array(z.string()).optional(),
        openQuestions: z.array(z.string()).optional(),
        shapingPersonas: z.array(personaAttachmentSchema).optional(),
        intents: z.array(mappedIntentSchema).min(1),
      }),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ confirmed, approvedBy = 'Project owner', map }) => result(
    createIntentMap(paths.projectRoot, map, { confirmed, approvedBy }),
  ),
);

server.registerTool(
  'ewai_audit_intent_state',
  {
    title: 'Audit durable intent state',
    description: 'Verify agreement among intent Markdown, adjacent intent JSON, delivery-state JSON, and the rebuildable SQLite projection.',
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  async () => result(auditIntentStateCopies(paths.projectRoot, { repairMissing: true }))
);

server.registerTool(
  'ewai_runtime_status',
  {
    title: 'Show EWAI runtime status',
    description: 'Show the project runtime, dashboard, database, and MCP project binding.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async () => result({
    project: { name: config.project.name, root: paths.projectRoot },
    database: paths.runtimeRoot ? `${paths.runtimeRoot}/data/pipeline.sqlite` : '',
    dashboard: await dashboardStatus(paths.projectRoot),
    mcp: { transport: 'stdio', pid: process.pid }
  })
);

server.registerTool(
  'ewai_list_dashboard_handoffs',
  {
    title: 'List intent work selected in the dashboard',
    description: 'List pending dashboard selections that should be continued conversationally through the guarded EWAI delivery skill.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async () => result({ handoffs: listDashboardHandoffs(paths.projectRoot, { status: 'pending' }) }),
);

server.registerTool(
  'ewai_resolve_dashboard_handoff',
  {
    title: 'Resolve an intent dashboard handoff',
    description: 'Mark a dashboard-selected intent as claimed, completed, or cancelled after the conversational companion has acted on it.',
    inputSchema: {
      id: z.string().uuid(),
      status: z.enum(['claimed', 'completed', 'cancelled']),
      resolvedBy: z.string().optional(),
      notes: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ id, ...input }) => result({ handoff: resolveDashboardHandoff(paths.projectRoot, id, input) }),
);

server.registerTool(
  'ewai_index_status',
  {
    title: 'Show EWAI repository index status',
    description: 'Show the latest project-local Tree-sitter repository index run and coverage counts.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async () => result(repositoryIndexStatus(paths.projectRoot))
);

server.registerTool(
  'ewai_index_refresh',
  {
    title: 'Refresh EWAI repository index',
    description: 'Rebuild the project-local Tree-sitter repository graph from repositories configured in SPECS/pipeline.yaml.',
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  async () => result(refreshRepositoryIndex(paths.projectRoot))
);

server.registerTool(
  'ewai_index_freshness',
  {
    title: 'Check EWAI repository index freshness',
    description: 'Compare the latest indexed hashes with the current configured repositories.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async () => result(repositoryIndexFreshness(paths.projectRoot))
);

server.registerTool(
  'ewai_index_search',
  {
    title: 'Search EWAI repository index',
    description: 'Search indexed project files and symbols before making repository-truth claims.',
    inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(200).optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async ({ query, limit }) => result(searchRepositoryIndex(paths.projectRoot, query, { limit }))
);

server.registerTool(
  'ewai_source_map_coverage',
  {
    title: 'Read EWAI Repository Source Map coverage',
    description: 'Read bounded file-outcome, analysis-depth, classification and analyser coverage for the latest Source Map run.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async () => result(repositorySourceMapCoverage(paths.projectRoot))
);

server.registerTool(
  'ewai_companion_status',
  {
    title: 'Read context-aware EWAI delivery guidance',
    description: 'Read bounded, ranked delivery guidance, active persona provenance and accountable human routes. This tool is advisory and read-only.',
    inputSchema: { focus: z.string().max(500).optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ focus = '' }) => result(readCompanionGuidance(paths.projectRoot, {
    focus,
    personas: portfolioPersonas(),
  })),
);

server.registerTool(
  'ewai_portfolio_status',
  {
    title: 'Read EWAI project and portfolio status',
    description: 'Read the bounded portfolio hierarchy, declared dependencies, child evidence, attention routes and active persona provenance. This tool is advisory and read-only.',
    inputSchema: { focus: z.string().max(500).optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ focus = '' }) => result(readPortfolioWorkspace(paths.projectRoot, {
    focus,
    personas: portfolioPersonas(),
  })),
);

server.registerTool(
  'ewai_rollout_status',
  {
    title: 'Read EWAI consultancy and network rollout status',
    description: 'Read the bounded rollout cohorts, exact Blueprint comparison, structural assurance state, accountable routes and active persona provenance. This tool is advisory and read-only.',
    inputSchema: {
      focus: z.string().max(500).optional(),
      projectId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ focus = '', projectId }) => result(readRolloutWorkspace(paths.projectRoot, {
    focus,
    ...(projectId ? { projectId } : {}),
    personas: portfolioPersonas(),
  })),
);

server.registerTool(
  'ewai_source_map_profiles',
  {
    title: 'List EWAI Repository Source Map profiles',
    description: 'List safe profile provenance and activation metadata without installed-pack paths or executable details.',
    inputSchema: {
      sourceKind: z.enum(['core', 'technology', 'stack', 'organisation', 'project']).optional(),
      analyser: z.enum(['inventory-only', 'text-summary', 'structured-keys', 'tree-sitter',
        'power-platform-metadata', 'salesforce-metadata']).optional(),
      limit: z.number().int().min(1).max(200).optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async (input) => result(repositorySourceMapProfiles(paths.projectRoot, input))
);

server.registerTool(
  'ewai_source_map_files',
  {
    title: 'List EWAI Repository Source Map files',
    description: 'List bounded repository-relative file outcomes without content, values, fingerprints or absolute roots.',
    inputSchema: {
      outcome: z.enum(['analysed', 'inventory_only', 'skipped_sensitive', 'skipped_oversized', 'analysis_failed']).optional(),
      classification: z.string().min(1).max(100).optional(),
      profileId: z.string().min(1).max(240).optional(),
      repository: z.string().min(1).max(160).optional(),
      query: z.string().max(240).optional(),
      limit: z.number().int().min(1).max(200).optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async (input) => result(repositorySourceMapFiles(paths.projectRoot, input))
);

server.registerTool(
  'ewai_index_graph',
  {
    title: 'Read EWAI repository graph',
    description: 'Read indexed imports and relationships for a concrete repo:path or symbol target.',
    inputSchema: { target: z.string().min(1), limit: z.number().int().min(1).max(200).optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async ({ target, limit }) => result(repositoryGraph(paths.projectRoot, target, { limit }))
);

server.registerTool(
  'ewai_index_truth',
  {
    title: 'Assemble repository truth for an intent',
    description: 'Combine indexed files, symbols, similar capabilities, and applicable standards for one intent slug.',
    inputSchema: { slug: z.string().min(1), limit: z.number().int().min(1).max(200).optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async ({ slug, limit }) => result(repositoryTruth(paths.projectRoot, slug, { limit }))
);

server.registerTool(
  'ewai_index_similar',
  {
    title: 'Find similar project capabilities',
    description: 'Compare durable plan fingerprints to find proven neighbouring capabilities.',
    inputSchema: { slug: z.string().min(1), limit: z.number().int().min(1).max(100).optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async ({ slug, limit }) => result(similarRepositoryCapabilities(paths.projectRoot, slug, { limit }))
);

server.registerTool(
  'ewai_index_standards',
  {
    title: 'Find standards for a repository target',
    description: 'Read standards-applicability evidence for a file, symbol, capability, or target.',
    inputSchema: { target: z.string().min(1) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async ({ target }) => result(repositoryStandards(paths.projectRoot, target))
);

server.registerTool(
  'ewai_standards_coverage',
  {
    title: 'Check delivery standards coverage',
    description: 'Check plan standards evidence, claim-ledger presence, and repository-index freshness for an intent.',
    inputSchema: { slug: z.string().min(1) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async ({ slug }) => result(repositoryStandardsCoverage(paths.projectRoot, slug))
);

server.registerTool(
  'ewai_list_work_items',
  {
    title: 'List EWAI work items',
    description: 'List the scalable delivery-board projection with groups, sprint state, phases, progress, and linked artefacts.',
    inputSchema: {
      query: z.string().optional(),
      group: z.string().optional(),
      lane: z.enum(['backlog', 'ready', 'active', 'qa', 'blocked', 'done']).optional(),
      sprint: z.enum(['current', 'backlog']).optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async (input) => result({ items: listWorkItems(paths.projectRoot, input) })
);

server.registerTool(
  'ewai_read_work_item',
  {
    title: 'Read an EWAI work item',
    description: 'Read one intent together with progress, phases, linked materials, and live activity.',
    inputSchema: { reference: z.string().min(1) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async ({ reference }) => result({ view: readWorkItemView(paths.projectRoot, reference) })
);

server.registerTool(
  'ewai_validation_status',
  {
    title: 'Read EWAI validation policy',
    description: 'Resolve mandatory standards and per-checkpoint external-validation policy for a specified orchestrator.',
    inputSchema: {
      orchestrator: z.enum(['manual', 'claude', 'codex', 'antigravity']).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ orchestrator = 'manual' }) => result(
    validationStatus(loadProjectConfig(paths.projectRoot).config, orchestrator),
  )
);

server.registerTool(
  'ewai_validation_configure_provider',
  {
    title: 'Configure an external validation provider',
    description: 'Record whether a supported CLI is available and enabled for independent project validation.',
    inputSchema: {
      provider: z.enum(['claude', 'codex', 'antigravity']),
      state: z.enum(['available', 'unavailable']),
      enabled: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ provider, state, enabled }) => result(
    configureExternalValidation(paths.projectRoot, provider, state, enabled),
  )
);

server.registerTool(
  'ewai_validation_configure_checkpoint',
  {
    title: 'Configure an external validation checkpoint',
    description: 'Set bounded review/fix cycles, selected validators, breadth, depth, and output size for plan, test-plan, or code validation.',
    inputSchema: {
      checkpoint: z.enum(['implementation-plan', 'test-plan', 'code']),
      enabled: z.boolean().optional(),
      maxCycles: z.number().int().min(1).max(3).optional(),
      validators: z.union([
        z.literal('auto'),
        z.array(z.enum(['claude', 'codex', 'antigravity'])),
      ]).optional(),
      breadth: z.enum(['targeted', 'change-set', 'capability', 'system']).optional(),
      depth: z.enum(['issues-only', 'issues-and-fixes', 'analysis-and-recommendations']).optional(),
      output: z.enum(['small', 'medium', 'large']).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ checkpoint, enabled, maxCycles, validators, breadth, depth, output }) => {
    const update = {
      ...(enabled === undefined ? {} : { enabled }),
      ...(maxCycles === undefined ? {} : { max_cycles: maxCycles }),
      ...(validators === undefined ? {} : { validators }),
      review: Object.fromEntries(
        Object.entries({ breadth, depth, output }).filter(([, value]) => value !== undefined),
      ),
    };
    if (!Object.keys(update.review).length) delete update.review;
    return result(configureValidationCheckpoint(paths.projectRoot, checkpoint, update));
  }
);

server.registerTool(
  'ewai_update_work_item',
  {
    title: 'Update EWAI work state',
    description: 'Update non-phase operational metadata. Delivery phase, status, and completion are controlled only by the guarded EWAI delivery tools.',
    inputSchema: {
      reference: z.string().min(1),
      priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
      currentSprint: z.boolean().optional(),
      blockedBy: z.string().optional(),
      notes: z.string().optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  },
  async ({ reference, ...input }) => result({ item: updateWorkItem(paths.projectRoot, reference, input) })
);

server.registerTool(
  'ewai_delivery_begin',
  {
    title: 'Begin canonical EWAI delivery',
    description: 'Create the durable fourteen-stage delivery contract, JSON state, tracker, context packet, SQLite projection, and active run for an existing intent.',
    inputSchema: {
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      tool: z.string().optional(),
      ideate: z.boolean().optional(),
      existingCode: z.boolean().optional(),
      ui: z.boolean().optional(),
      mode: z.enum(['normal', 'shelf', 'resume', 'dry-run']).optional(),
      intensity: z.enum(['full', 'scoped', 'targeted']).optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  async ({ slug, ...input }) => result(beginDelivery(paths.projectRoot, slug, input))
);

server.registerTool(
  'ewai_delivery_continue',
  {
    title: 'Continue canonical EWAI delivery',
    description: 'Validate all durable copies and completed evidence, then identify the exact next required phase. Never guesses or skips.',
    inputSchema: { slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async ({ slug }) => result(continueDelivery(paths.projectRoot, slug))
);

server.registerTool(
  'ewai_delivery_status',
  {
    title: 'Read canonical EWAI delivery state',
    description: 'Read the project-owned durable JSON delivery state for an intent.',
    inputSchema: { slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async ({ slug }) => result(readDeliveryState(paths.projectRoot, slug))
);

server.registerTool(
  'ewai_delivery_resume',
  {
    title: 'Resume shelf-ready EWAI delivery',
    description: 'Resume a deliberately shelved delivery by activating mandatory FitCheck before Build.',
    inputSchema: {
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      tool: z.string().optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  async ({ slug, tool }) => result(resumeShelvedDelivery(paths.projectRoot, slug, { tool }))
);

server.registerTool(
  'ewai_delivery_record_gate',
  {
    title: 'Record deterministic phase gate evidence',
    description: 'Write the structured gate ledger used to prove that a phase may complete.',
    inputSchema: {
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      phase: z.string().min(1),
      status: z.enum(['pass', 'fail', 'blocked', 'escalated']),
      honestyCheck: z.object({
        sourceSectionsEdited: z.boolean(),
        staleTextRemoved: z.boolean(),
        noAppendOnlyCorrections: z.boolean(),
        allCodeClaimsCited: z.boolean(),
        notes: z.string().optional()
      }),
      requiredGates: z.array(z.object({
        id: z.string().min(1),
        required: z.boolean().optional(),
        commandOrSkill: z.string().min(1),
        outputPath: z.string().optional(),
        exitStatus: z.union([z.number().int(), z.string()]).optional(),
        status: z.enum(['pass', 'fail', 'blocked', 'not_applicable']),
        rationale: z.string().optional()
      })).min(1),
      deterministicGateFailures: z.array(z.record(z.string(), z.unknown())).optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  async ({ slug, phase, ...input }) => result(recordPhaseGate(paths.projectRoot, slug, phase, input))
);

server.registerTool(
  'ewai_delivery_record_validation_cycle',
  {
    title: 'Record an external review and fix cycle',
    description: 'Hash and record one configured external-validation cycle. Issue outcomes require fix evidence; phase completion requires every selected provider to finish on pass.',
    inputSchema: {
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      phase: z.enum([
        'validate-external-plan',
        'validate-external-test-plan',
        'validate-external-code',
      ]),
      provider: z.enum(['claude', 'codex', 'antigravity']),
      outcome: z.enum(['pass', 'issues']),
      responsePath: z.string().optional(),
      fixPath: z.string().optional(),
      notes: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ slug, phase, ...input }) => result(
    recordExternalValidationCycle(paths.projectRoot, slug, phase, input),
  )
);

server.registerTool(
  'ewai_delivery_gate_template',
  {
    title: 'Read the canonical phase gate template',
    description: 'Return the exact required gate IDs and schema for one EWAI delivery phase.',
    inputSchema: { slug: z.string().min(1), phase: z.string().min(1) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async ({ slug, phase }) => result(phaseGateTemplate(paths.projectRoot, slug, phase))
);

server.registerTool(
  'ewai_delivery_required_artefacts',
  {
    title: 'List canonical phase artefacts',
    description: 'List the fixed project-owned files that must exist before one phase may complete.',
    inputSchema: { slug: z.string().min(1), phase: z.string().min(1) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async ({ slug, phase }) => {
    const state = readDeliveryState(paths.projectRoot, slug);
    const delivery = deliveryPaths(paths.projectRoot, slug);
    const tracked = [...state.phases, ...state.adjuncts, ...state.humanGates]
      .find((candidate) => candidate.id === phase);
    return result({
      slug,
      phase,
      required: requiredPhaseArtefacts(
        delivery.deliveryRoot,
        phase,
        tracked?.validation?.providers ?? state.providers,
        tracked?.validation?.cycles ?? [],
      )
    });
  }
);

server.registerTool(
  'ewai_delivery_runs',
  {
    title: 'List durable EWAI delivery runs',
    description: 'List command-run records projected from project-owned run JSON files.',
    inputSchema: { slug: z.string().optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async ({ slug = '' }) => result({ runs: listCommandRuns(paths.projectRoot, slug) })
);

server.registerTool(
  'ewai_delivery_mark_stale_runs',
  {
    title: 'Mark abandoned delivery runs stale',
    description: 'Mark running records older than a threshold stale in both durable run JSON and SQLite.',
    inputSchema: { hours: z.number().int().min(1).max(720).optional(), summary: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  async ({ hours, summary }) => result(markStaleCommandRuns(paths.projectRoot, { hours, summary }))
);

server.registerTool(
  'ewai_delivery_start_phase',
  {
    title: 'Start the next required EWAI phase',
    description: 'Start only the exact next phase after validating state copies and all completed gate evidence. Build additionally requires human approval.',
    inputSchema: { slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), phase: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  },
  async ({ slug, phase }) => result(startDeliveryPhase(paths.projectRoot, slug, phase))
);

server.registerTool(
  'ewai_delivery_complete_phase',
  {
    title: 'Complete a gated EWAI phase',
    description: 'Complete the running phase only when its deterministic gate ledger and evidence pass freshness checks.',
    inputSchema: {
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      phase: z.string().min(1),
      artefactPath: z.string().optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  },
  async ({ slug, phase, artefactPath }) => result(completeDeliveryPhase(paths.projectRoot, slug, phase, { artefactPath }))
);

const errorReportDescriptionSchema = {
  capability: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  errorCode: z.string().regex(/^[A-Z][A-Z0-9-]{2,79}$/),
  command: z.string().regex(/^ewai(?: [a-z0-9][a-z0-9:-]*){0,4}$/),
  title: z.string().min(1).max(500),
  expected: z.string().max(4000).optional().default(''),
  actual: z.string().max(4000).optional().default(''),
  reproductionSteps: z.array(z.string().min(1).max(1000)).max(50).optional().default([]),
};

server.registerTool(
  'ewai_error_report_status',
  {
    title: 'Read local EWAI error reports',
    description: 'Read safe project-local draft, package and receipt state. This never transmits a report.',
    inputSchema: { status: z.enum(['draft', 'finalised', 'archived']).optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ status }) => result(listLocalErrorReports(paths.projectRoot, { status })),
);

server.registerTool(
  'ewai_error_report_create',
  {
    title: 'Create a local EWAI error-report draft',
    description: 'Create a privacy-bounded draft under the project-local operational folder. This never sends or uploads anything.',
    inputSchema: errorReportDescriptionSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (input) => result(createLocalErrorReport(paths.projectRoot, {
    ...input,
    ewaiVersion: packageVersion,
    nodeVersion: process.versions.node,
    osClass: ['darwin', 'linux', 'win32'].includes(process.platform) ? process.platform : 'other',
    installationSource: 'npm',
  })),
);

server.registerTool(
  'ewai_error_report_show',
  {
    title: 'Inspect one local EWAI error report',
    description: 'Read the safe report projection and its local provider attempt/receipt ledger.',
    inputSchema: { reportId: z.string().regex(/^report_[a-z0-9_]{3,80}$/) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ reportId }) => result({ report: readLocalErrorReport(paths.projectRoot, reportId), ...listErrorReportReceipts(paths.projectRoot, reportId) }),
);

server.registerTool(
  'ewai_error_report_update',
  {
    title: 'Update a local EWAI error-report draft',
    description: 'Update human-authored fields. Updating finalised evidence creates a new local draft revision.',
    inputSchema: {
      reportId: z.string().regex(/^report_[a-z0-9_]{3,80}$/),
      title: z.string().min(1).max(500).optional(), expected: z.string().max(4000).optional(),
      actual: z.string().max(4000).optional(), reproductionSteps: z.array(z.string().min(1).max(1000)).max(50).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ reportId, ...changes }) => result(updateLocalErrorReport(paths.projectRoot, reportId, changes)),
);

server.registerTool(
  'ewai_error_report_finalise',
  {
    title: 'Finalise a local EWAI error-report package',
    description: 'Create an immutable deterministic ZIP and digest locally. Finalisation is not transmission.',
    inputSchema: { reportId: z.string().regex(/^report_[a-z0-9_]{3,80}$/) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ reportId }) => result(finaliseLocalErrorReport(paths.projectRoot, reportId)),
);

server.registerTool(
  'ewai_error_report_prepare_email',
  {
    title: 'Prepare a manual email handoff',
    description: 'Prepare a mailto link and reveal reference for the exact ZIP. EWAI cannot attach or send the message.',
    inputSchema: {
      reportId: z.string().regex(/^report_[a-z0-9_]{3,80}$/),
      expectedDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), recipient: z.string().email().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ reportId, ...input }) => result(prepareErrorReportEmail(paths.projectRoot, reportId, input)),
);

server.registerTool(
  'ewai_error_report_providers',
  {
    title: 'List registered error-report providers',
    description: 'List safe metadata for explicitly registered provider adapters. EWAI ships no commercial connector.',
    inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async () => result(listErrorReportProviders(paths.projectRoot)),
);

server.registerTool(
  'ewai_error_report_receipts',
  {
    title: 'Read error-report handoff receipts',
    description: 'Read digest-bound local attempts and accepted transport receipts without provider credentials.',
    inputSchema: { reportId: z.string().regex(/^report_[a-z0-9_]{3,80}$/) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ reportId }) => result(listErrorReportReceipts(paths.projectRoot, reportId)),
);

server.registerTool(
  'ewai_error_report_send_provider',
  {
    title: 'Submit one finalised error report to a registered provider',
    description: 'Deliberately send the exact confirmed ZIP digest through trusted registered local adapter code. Provider acceptance is transport evidence, not issue resolution.',
    inputSchema: {
      reportId: z.string().regex(/^report_[a-z0-9_]{3,80}$/), providerId: z.string().regex(/^[a-z][a-z0-9.-]{1,79}$/),
      expectedDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), confirmed: z.literal(true),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  async ({ reportId, providerId, expectedDigest }) => result(await submitErrorReportProvider(paths.projectRoot, reportId, providerId, { confirmed: true, expectedDigest })),
);

server.registerTool(
  'ewai_error_report_archive',
  {
    title: 'Archive local error-report material',
    description: 'Move local report material into the project-local archive. This does not recall external submissions.',
    inputSchema: { reportId: z.string().regex(/^report_[a-z0-9_]{3,80}$/), confirmed: z.literal(true) },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  async ({ reportId }) => result(archiveErrorReport(paths.projectRoot, reportId, { confirmed: true })),
);

server.registerTool(
  'ewai_error_report_delete',
  {
    title: 'Delete local error-report material',
    description: 'Delete only local report/package material after explicit confirmation. Provider receipts remain and no external report is recalled.',
    inputSchema: { reportId: z.string().regex(/^report_[a-z0-9_]{3,80}$/), confirmed: z.literal(true) },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  async ({ reportId }) => result(deleteErrorReport(paths.projectRoot, reportId, { confirmed: true })),
);

server.registerTool(
  'ewai_error_report_settings',
  {
    title: 'Update local error-report preferences',
    description: 'Opt into automatic local draft capture or set a support address. This preference can never transmit a report.',
    inputSchema: { automaticLocalDrafts: z.boolean().optional(), supportEmail: z.string().email().or(z.literal('')).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (input) => result(updateErrorReportSettings(paths.projectRoot, input)),
);

server.registerTool(
  'ewai_delivery_approve_build',
  {
    title: 'Record human Build approval',
    description: 'Record the explicit human decision required before EWAI may enter Build. Never call without the user approving Build in this conversation.',
    inputSchema: {
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      confirmed: z.literal(true),
      approvedBy: z.string().min(1),
      scope: z.string().optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  },
  async ({ slug, approvedBy, scope }) => result(recordBuildApproval(paths.projectRoot, slug, {
    decision: 'approved', approvedBy, scope
  }))
);

server.registerTool(
  'ewai_delivery_approve_manual_qa',
  {
    title: 'Record human Manual QA approval',
    description: 'Record the explicit human Manual QA decision and evidence required before Retro.',
    inputSchema: {
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      confirmed: z.literal(true),
      approvedBy: z.string().min(1),
      evidencePath: z.string().min(1),
      notes: z.string().optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  },
  async ({ slug, approvedBy, evidencePath, notes }) => result(recordManualQaApproval(paths.projectRoot, slug, {
    decision: 'approved', approvedBy, evidencePath, notes
  }))
);

server.registerTool(
  'ewai_add_artefact',
  {
    title: 'Link EWAI delivery material',
    description: 'Register a plan, prototype, test report, decision, or other material against an intent.',
    inputSchema: {
      reference: z.string().min(1),
      kind: z.string().min(1),
      path: z.string().min(1),
      title: z.string().optional(),
      status: z.string().optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  async ({ reference, ...input }) => result({ artefact: addArtefact(paths.projectRoot, reference, input) })
);

server.registerTool(
  'ewai_list_active_work',
  {
    title: 'List live EWAI work',
    description: 'List active agent delivery sessions and their latest material events.',
    inputSchema: { includeCompleted: z.boolean().optional().default(false) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  async ({ includeCompleted }) => result({ sessions: listActiveSessions(paths.projectRoot, { includeCompleted }) })
);

const activityInput = {
  reference: z.string().min(1),
  ownerId: z.string().optional(),
  tool: z.string().optional(),
  phaseKey: z.string().optional(),
  summary: z.string().min(1),
  details: z.string().optional()
};

server.registerTool(
  'ewai_active_start',
  {
    title: 'Start live EWAI work',
    description: 'Mark material delivery work as active so it appears in the live dashboard.',
    inputSchema: activityInput,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  async ({ reference, ...input }) => result(startActiveSession(paths.projectRoot, reference, input))
);

server.registerTool(
  'ewai_active_event',
  {
    title: 'Record live EWAI progress',
    description: 'Record a material progress, handoff, decision, review, blocker, or human-question event.',
    inputSchema: {
      ...activityInput,
      eventType: z.enum(['progress', 'handoff', 'external-review', 'decision', 'response', 'blocked', 'question', 'question-resolved', 'stale']).optional(),
      requiresHuman: z.boolean().optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  async ({ reference, ...input }) => result(addActivityEvent(paths.projectRoot, reference, input))
);

server.registerTool(
  'ewai_active_finish',
  {
    title: 'Finish live EWAI work',
    description: 'Close an active delivery session with a material outcome summary.',
    inputSchema: {
      ...activityInput,
      status: z.enum(['completed', 'blocked', 'failed', 'stale']).optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  async ({ reference, ...input }) => result(finishActiveSession(paths.projectRoot, reference, input))
);

server.registerTool(
  'ewai_list_execution_leases',
  {
    title: 'List EWAI execution leases',
    description: 'List active or historical task ownership leases without exposing lease tokens.',
    inputSchema: {
      activeOnly: z.boolean().optional().default(true),
      workItemId: z.string().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async (input) => result({ leases: listExecutionLeases(paths.projectRoot, input) }),
);

server.registerTool(
  'ewai_acquire_execution_lease',
  {
    title: 'Acquire an EWAI task execution lease',
    description: 'Atomically reserve one task for an identified agent run. Refuses conflicting active ownership.',
    inputSchema: {
      reference: z.string().min(1),
      taskId: z.string().regex(/^T-\d{3,}$/),
      ownerId: z.string().min(1),
      tool: z.string().optional(),
      runId: z.string().min(1),
      durationMs: z.number().int().min(1_000).max(86_400_000).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ reference, ...input }) => result({ lease: acquireExecutionLease(paths.projectRoot, reference, input) }),
);

server.registerTool(
  'ewai_heartbeat_execution_lease',
  {
    title: 'Renew an EWAI task execution lease',
    description: 'Extend a task lease using its private capability token.',
    inputSchema: {
      leaseId: z.string().uuid(),
      token: z.string().uuid(),
      durationMs: z.number().int().min(1_000).max(86_400_000).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ leaseId, ...input }) => result({ lease: heartbeatExecutionLease(paths.projectRoot, leaseId, input) }),
);

server.registerTool(
  'ewai_release_execution_lease',
  {
    title: 'Release an EWAI task execution lease',
    description: 'Release or hand off a task lease using its private capability token.',
    inputSchema: {
      leaseId: z.string().uuid(),
      token: z.string().uuid(),
      outcome: z.enum(['completed', 'handoff', 'blocked', 'failed', 'released']).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ leaseId, ...input }) => result({ lease: releaseExecutionLease(paths.projectRoot, leaseId, input) }),
);

server.registerTool(
  'ewai_afk_preflight',
  {
    title: 'Check unattended Build readiness',
    description: 'Deterministically verify the Build gate, task graph, simple or multi-repository topology, branch preparation, provider availability, and safe parallelism before AFK execution.',
    inputSchema: {
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      provider: z.enum(['auto', 'claude', 'codex', 'antigravity']).optional().default('auto'),
      maxParallel: z.number().int().min(1).optional().default(1),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ slug, ...input }) => result(preflightAfkRun(paths.projectRoot, slug, input)),
);

server.registerTool(
  'ewai_afk_start',
  {
    title: 'Start unattended EWAI Build execution',
    description: 'Start the bounded local conductor for an already approved Build task graph. Creates required integration/task branches in each configured repository, then uses isolated worktrees, execution leases, fresh-context review, orchestrator-owned merges, and post-merge checks.',
    inputSchema: {
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      provider: z.enum(['auto', 'claude', 'codex', 'antigravity']).optional().default('auto'),
      maxParallel: z.number().int().min(1).optional().default(1),
      timeoutMinutes: z.number().int().min(1).max(1440).optional().default(45),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ slug, timeoutMinutes, ...input }) => result(startAfkRun(paths.projectRoot, slug, {
    ...input,
    timeoutMs: timeoutMinutes * 60 * 1000,
  })),
);

server.registerTool(
  'ewai_afk_status',
  {
    title: 'Read unattended Build status',
    description: 'Read one durable AFK run or list all runs without exposing private lease tokens.',
    inputSchema: { runId: z.string().uuid().optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ runId }) => result(afkRunStatus(paths.projectRoot, runId)),
);

server.registerTool(
  'ewai_afk_pause',
  {
    title: 'Safely pause unattended Build',
    description: 'Request a safe pause after the currently active task wave finishes and before another task is leased.',
    inputSchema: { runId: z.string().uuid() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ runId }) => result(pauseAfkRun(paths.projectRoot, runId)),
);

server.registerTool(
  'ewai_afk_resume',
  {
    title: 'Resume or recover unattended Build',
    description: 'Resume a paused or blocked local conductor, safely abandoning stale leases from the previous process before revalidation.',
    inputSchema: { runId: z.string().uuid() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ runId }) => result(resumeAfkRun(paths.projectRoot, runId)),
);

server.registerTool(
  'ewai_afk_cancel',
  {
    title: 'Cancel unattended Build',
    description: 'Stop active workers, abandon this run’s leases, and preserve its logs and durable state for diagnosis.',
    inputSchema: { runId: z.string().uuid() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  async ({ runId }) => result(cancelAfkRun(paths.projectRoot, runId)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
