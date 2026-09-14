import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { atomicJson } from '../delivery-documents.mjs';
import {
  commitProjectDiscovery,
  discoveryQuestionnaire,
  prepareProjectDiscovery
} from '../discovery.mjs';
import {
  listOrganisationBlueprints,
  projectOrganisationBlueprint,
  resolveOrganisationBlueprint,
} from '../organisation-blueprints.mjs';
import {
  ORGANISATION_POLICY_BASELINE_PATH,
  materialisePolicyBaseline,
  previewPolicyBaseline,
  readPolicyBaselineStatus,
  resolveOrganisationPolicy,
} from '../organisation-policies.mjs';
import { loadProjectConfig } from '../project.mjs';
import { selectContextualPersonas } from './persona-engagement.mjs';
import { readEvidenceDepthWorkspace } from './evidence-depth-workspace.mjs';
import { runtimePaths } from './paths.mjs';

const DRAFT_SCHEMA = 'ewai.guided-discovery-draft/v1';
const RESPONSE_SCHEMA = 'ewai.guided-discovery/v1';

function failure(message, statusCode = 409) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function sectionContract(sectionId) {
  const questionnaire = discoveryQuestionnaire();
  const section = questionnaire.sections.find((candidate) => candidate.id === sectionId);
  if (!section) throw failure(`Unknown discovery section: ${sectionId}`, 400);
  return { questionnaire, section };
}

export function selectDiscoveryPersonas(sectionId, personaCatalogue = [], answers = {}) {
  const { section } = sectionContract(sectionId);
  return selectContextualPersonas({
    contextLabel: section.title,
    signals: section.perspectiveSignals,
    context: answers,
    personaCatalogue,
    limit: 4
  });
}

function initialAnswers(projectRoot) {
  const { config } = loadProjectConfig(projectRoot);
  return {
    schema: 'ewai.discovery-answers/v1',
    project: { name: config.project?.name ?? '' },
    delivery: {},
    assurance: {}
  };
}

function initialDraft(projectRoot) {
  return {
    schema: DRAFT_SCHEMA,
    revision: 0,
    currentSection: 'purpose',
    answers: initialAnswers(projectRoot),
    preparedAt: null,
    createdAt: null,
    updatedAt: null
  };
}

function readDraft(projectRoot) {
  const { guidedDiscoveryDraftPath } = runtimePaths(projectRoot);
  if (!existsSync(guidedDiscoveryDraftPath)) return initialDraft(projectRoot);
  let draft;
  try {
    draft = JSON.parse(readFileSync(guidedDiscoveryDraftPath, 'utf8'));
  } catch (error) {
    throw failure(`Guided discovery draft is not valid JSON: ${error.message}`);
  }
  if (draft.schema !== DRAFT_SCHEMA || !Number.isInteger(draft.revision) || draft.revision < 1) {
    throw failure('Guided discovery draft has an unsupported schema or revision');
  }
  sectionContract(draft.currentSection);
  return draft;
}

function discoveryEvidenceDimension(question) {
  const path = question.answerPath;
  if (path === 'assurance.dataClassification' || /personalData|sensitiveData|jurisdictions/.test(path)) return 'data';
  if (/authentication|multiTenant|internetFacing|payments/.test(path)) return 'security';
  if (/availability/.test(path)) return 'operations';
  if (path.startsWith('assurance.')) return 'governance';
  if (/technology|deploymentTarget/.test(path)) return 'architecture';
  if (path.startsWith('delivery.') || /definitionOfReady|definitionOfDone|ownership\.delivery/.test(path)) return 'delivery';
  if (/hardConstraints|nonNegotiables|dontTouch|risks/.test(path)) return 'governance';
  if (/ownership\.technical|inScope|capabilities|productTypes/.test(path)) return 'architecture';
  return 'product';
}

function hasDiscoveryEvidence(value) {
  if (Array.isArray(value)) return value.some((item) => cleanText(item));
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return cleanText(value).length > 0;
}

function discoveryEvidenceDigest(value) {
  const canonical = Array.isArray(value)
    ? value.map((item) => cleanText(item)).filter(Boolean).sort()
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]))
      : cleanText(value);
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;
}

export function guidedDiscoveryOwnerEvidence(projectRoot) {
  const draft = readDraft(projectRoot);
  const entries = discoveryQuestionnaire().sections.flatMap((section) => section.questions)
    .filter((question) => hasDiscoveryEvidence(question.answerPath.split('.').reduce((value, key) => value?.[key], draft.answers)))
    .map((question) => {
      const value = question.answerPath.split('.').reduce((current, key) => current?.[key], draft.answers);
      return {
        id: `discovery:${question.id}`,
        dimension: discoveryEvidenceDimension(question),
        authority: 'declared',
        evidenceDigest: discoveryEvidenceDigest(value),
        answerCode: `${question.id}-answer-recorded`,
        reasonCode: `guided-discovery-r${draft.revision}`,
        contradiction: 'none',
      };
    });
  return entries.slice(0, 50);
}

function validationPath(error) {
  const required = error.message.match(/^Discovery answer is required: (.+)$/);
  return required?.[1] ?? '';
}

function organisationBlueprintCatalogue(projectRoot, options) {
  return options.organisationBlueprints ?? listOrganisationBlueprints({
    projectRoot,
    roots: options.organisationBlueprintRoots,
    home: options.home
  });
}

function prepareDraft(projectRoot, draft, options = {}, catalogue = organisationBlueprintCatalogue(projectRoot, options)) {
  try {
    const prepared = prepareProjectDiscovery(projectRoot, draft.answers, {
      now: draft.preparedAt ?? undefined,
      organisationBlueprints: catalogue
    });
    return {
      validation: { valid: true, errors: [] },
      preview: {
        schema: prepared.schema,
        preparedAt: prepared.preparedAt,
        outputs: prepared.outputs.map(({ kind, relative, exists }) => ({ kind, relative, exists })),
        conflicts: prepared.conflicts,
        selectedPacks: prepared.selectedPacks,
        detectedPacks: prepared.detectedPacks,
        organisationBlueprint: prepared.organisationBlueprint,
        minimumStandards: prepared.minimumStandards,
        complianceReviews: prepared.complianceReviews
      },
      prepared
    };
  } catch (error) {
    return {
      validation: { valid: false, errors: [{ path: validationPath(error), message: error.message }] },
      preview: null,
      prepared: null
    };
  }
}

function draftPolicyBaseline(draft, catalogue) {
  const selection = draft.answers?.delivery?.organisationBlueprint;
  if (!selection?.packId) return { resolved: null, preview: previewPolicyBaseline(null) };
  try {
    const blueprint = resolveOrganisationBlueprint(selection.packId, catalogue, {
      enabledModules: selection.enabledModules ?? [],
    });
    const resolved = resolveOrganisationPolicy(blueprint);
    return { resolved, preview: previewPolicyBaseline(resolved) };
  } catch (error) {
    return {
      resolved: null,
      preview: {
        schema: 'ewai.policy-baseline-preview/v1',
        status: 'invalid',
        enabled: false,
        blocking: false,
        notice: error.message,
        counts: { policies: 0, rules: 0 },
        policies: [],
      },
    };
  }
}

function guidedResponse(projectRoot, draft, options = {}) {
  const { questionnaire, section } = sectionContract(draft.currentSection);
  const catalogue = organisationBlueprintCatalogue(projectRoot, options);
  const { validation, preview } = prepareDraft(projectRoot, draft, options, catalogue);
  const policyBaseline = draftPolicyBaseline(draft, catalogue).preview;
  const activePersonas = selectDiscoveryPersonas(section.id, options.personas ?? [], draft.answers);
  const evidenceDepth = (() => {
    try {
      return readEvidenceDepthWorkspace(projectRoot, {
        sourceMap: options.sourceMap,
        personas: options.personas ?? [],
      });
    } catch (error) {
      return {
        schema: 'ewai.evidence-depth-workspace/v1',
        status: 'unavailable',
        preparation: null,
        questions: [],
        activePersonas: [],
        runs: [],
        recovery: {
          command: 'node bin/ewai archaeology depth-status --project .',
          label: 'Inspect evidence depth',
        },
        reason: error.message,
      };
    }
  })();
  return {
    schema: RESPONSE_SCHEMA,
    questionnaire,
    draft,
    validation,
    preview,
    organisationBlueprints: catalogue.map(projectOrganisationBlueprint),
    policyBaseline,
    activePersonas,
    evidenceDepth,
    guidance: {
      advisory: true,
      humanEvidenceTakesPriority: true,
      section: section.id,
      prompts: activePersonas.map((persona) => ({ personaId: persona.id, text: persona.engagementReason }))
    }
  };
}

export function readGuidedDiscovery(projectRoot, options = {}) {
  return guidedResponse(projectRoot, readDraft(projectRoot), options);
}

export function saveGuidedDiscoveryDraft(projectRoot, input = {}, options = {}) {
  const current = readDraft(projectRoot);
  const expectedRevision = Number(input.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision) {
    throw failure(`A newer revision of this guided discovery draft exists (current revision ${current.revision})`);
  }
  const { section } = sectionContract(cleanText(input.currentSection) || current.currentSection);
  if (!input.answers || typeof input.answers !== 'object' || Array.isArray(input.answers)) {
    throw failure('Guided discovery answers must be an object', 400);
  }
  const timestamp = options.now ?? new Date().toISOString();
  const draft = {
    schema: DRAFT_SCHEMA,
    revision: current.revision + 1,
    currentSection: section.id,
    answers: structuredClone(input.answers),
    preparedAt: timestamp,
    createdAt: current.createdAt ?? timestamp,
    updatedAt: timestamp
  };
  atomicJson(runtimePaths(projectRoot).guidedDiscoveryDraftPath, draft);
  return guidedResponse(projectRoot, draft, options);
}

export function approveGuidedDiscovery(projectRoot, input = {}, options = {}) {
  if (input.confirmed !== true) throw failure('Canonical discovery requires explicit confirmation');
  const approvedBy = cleanText(input.approvedBy);
  if (!approvedBy) throw failure('Canonical discovery requires an accountable approver name');
  const draft = readDraft(projectRoot);
  const expectedRevision = Number(input.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision !== draft.revision) {
    throw failure(`A newer revision of this guided discovery draft exists (current revision ${draft.revision})`);
  }
  const { validation, prepared } = prepareDraft(projectRoot, draft, options);
  if (!validation.valid || !prepared) throw failure('The current guided discovery draft is incomplete or invalid');
  if (prepared.conflicts.length) {
    throw failure(`Discovery outputs already exist and cannot be overwritten: ${prepared.conflicts.join(', ')}`);
  }
  const approvedAt = options.now ?? new Date().toISOString();
  const catalogue = organisationBlueprintCatalogue(projectRoot, options);
  const policy = draftPolicyBaseline(draft, catalogue);
  if (policy.preview.status === 'invalid') throw failure(`The selected organisation policy is invalid: ${policy.preview.notice}`);
  const commit = options.commit ?? commitProjectDiscovery;
  const { paths } = loadProjectConfig(projectRoot);
  const originalConfig = readFileSync(paths.configPath, 'utf8');
  const baselinePath = resolve(paths.projectRoot, ORGANISATION_POLICY_BASELINE_PATH);
  const hadBaseline = existsSync(baselinePath);
  const originalBaseline = hadBaseline ? readFileSync(baselinePath, 'utf8') : null;
  const materialise = options.materialisePolicy ?? materialisePolicyBaseline;
  let policyBaseline;
  let policyApplied = false;
  let result;
  try {
    policyBaseline = policy.resolved?.contributions.length
      ? materialise(projectRoot, policy.resolved, {
        confirmed: true,
        approvedBy,
        expectedDigest: policy.resolved.effectiveDigest,
        now: approvedAt,
      })
      : readPolicyBaselineStatus(projectRoot);
    policyApplied = Boolean(policy.resolved?.contributions.length);
    result = commit(projectRoot, prepared, {
      approvedBy,
      approvedAt,
      organisationBlueprints: options.organisationBlueprints,
      organisationBlueprintRoots: options.organisationBlueprintRoots,
      home: options.home,
      personas: selectDiscoveryPersonas('review', options.personas ?? [], draft.answers),
    });
  } catch (error) {
    if (policyApplied) {
      writeFileSync(paths.configPath, originalConfig, 'utf8');
      if (hadBaseline) writeFileSync(baselinePath, originalBaseline, 'utf8');
      else rmSync(baselinePath, { force: true });
    }
    throw error;
  }
  rmSync(runtimePaths(projectRoot).guidedDiscoveryDraftPath, { force: true });
  return {
    schema: 'ewai.guided-discovery-approval/v1',
    status: 'completed',
    approval: { approvedBy, approvedAt, revision: draft.revision },
    created: result.created,
    organisationBlueprint: result.organisationBlueprint,
    policyBaseline,
    nextCommand: result.nextCommand
  };
}
