import { createInterface } from 'node:readline/promises';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import YAML from 'yaml';
import { listPacks } from './packs.mjs';
import {
  listOrganisationBlueprints,
  projectOrganisationBlueprint,
  resolveOrganisationBlueprint
} from './organisation-blueprints.mjs';
import { loadProjectConfig } from './project.mjs';
import {
  VALIDATION_CHECKPOINTS,
  VALIDATION_PROVIDERS,
  normaliseValidationConfig,
} from './validation-config.mjs';
import { publishLifecycleEventSafely } from './runtime/lifecycle-hooks.mjs';

const ANSWERS_SCHEMA = 'ewai.discovery-answers/v1';
const TRI_STATE = new Set(['yes', 'no', 'unknown']);
const DATA_CLASSIFICATIONS = new Set(['public', 'internal', 'confidential', 'restricted', 'unknown']);
const AVAILABILITY_LEVELS = new Set(['standard', 'high', 'critical', 'unknown']);
const PROJECT_STAGES = new Set(['new', 'existing', 'modernisation', 'unknown']);
const VALIDATOR_STATES = new Set(['available', 'unavailable']);

const questionnaireSections = [
  {
    id: 'purpose',
    title: 'Purpose',
    description: 'Establish why the project exists and what has become unacceptable.',
    perspectiveSignals: ['purpose', 'problem framing', 'strategy', 'business outcomes', 'evidence', 'decisions'],
    questions: [
      { id: 'project-name', answerPath: 'project.name', label: 'Project name', prompt: 'What should people call this project?', help: 'Use the recognisable working name rather than a system code.', type: 'text', required: true },
      { id: 'project-purpose', answerPath: 'project.purpose', label: 'Purpose', prompt: 'What is this project for?', help: 'Describe the meaningful change the project should create.', type: 'textarea', required: true },
      { id: 'project-problem', answerPath: 'project.problem', label: 'Problem', prompt: 'What problem or unmet need does it address?', help: 'Describe the current reality without jumping to a solution.', type: 'textarea', required: true },
      { id: 'project-why-now', answerPath: 'project.whyNow', label: 'Why now', prompt: 'What changed or became unacceptable?', help: 'Name the pressure, opportunity, or evidence that makes action timely.', type: 'textarea', required: false }
    ]
  },
  {
    id: 'people',
    title: 'People',
    description: 'Name the people affected and the humans accountable for the work.',
    perspectiveSignals: ['end user', 'service design', 'accessibility', 'operations', 'stakeholder'],
    questions: [
      { id: 'primary-users', answerPath: 'project.primaryUsers', label: 'People and their situation', prompt: 'Who are the main people this project must help?', help: 'Add one recognisable role or group per line, including the situation they face.', type: 'list', required: true },
      { id: 'product-owner', answerPath: 'project.ownership.product', label: 'Product owner', prompt: 'Who owns whether the outcomes succeed or fail?', help: 'Use a name or accountable role.', type: 'text', required: false },
      { id: 'delivery-owner', answerPath: 'project.ownership.delivery', label: 'Delivery owner', prompt: 'Who owns delivery and quality?', help: 'Use a name or accountable role.', type: 'text', required: false },
      { id: 'technical-owner', answerPath: 'project.ownership.technical', label: 'Technical owner', prompt: 'Who owns architecture and technical constraints?', help: 'Use a name or accountable role.', type: 'text', required: false }
    ]
  },
  {
    id: 'outcomes',
    title: 'Outcomes',
    description: 'Define observable success, failure, readiness, and completion.',
    perspectiveSignals: ['outcomes', 'product owner', 'measurement', 'quality', 'testing'],
    questions: [
      { id: 'desired-outcomes', answerPath: 'project.desiredOutcomes', label: 'Desired outcomes', prompt: 'What should become meaningfully better?', help: 'Add one observable outcome per line.', type: 'list', required: true },
      { id: 'success-signals', answerPath: 'project.successSignals', label: 'Success signals', prompt: 'What would show the project is working?', help: 'Use evidence someone could observe or measure.', type: 'list', required: false },
      { id: 'failure-signals', answerPath: 'project.failureSignals', label: 'Failure signals', prompt: 'How could this project quietly fail?', help: 'Name early warning signs, not only catastrophic outcomes.', type: 'list', required: false },
      { id: 'definition-ready', answerPath: 'project.definitionOfReady', label: 'Ready for Build', prompt: 'What must be true before implementation begins?', help: 'Include decisions, owners, evidence, or dependencies.', type: 'list', required: false },
      { id: 'definition-done', answerPath: 'project.definitionOfDone', label: 'Definition of Done', prompt: 'What evidence is needed to call this complete?', help: 'Include testing, acceptance, operational, and learning evidence.', type: 'list', required: false }
    ]
  },
  {
    id: 'scope',
    title: 'Scope',
    description: 'Make boundaries, assumptions, risks, and protected areas explicit.',
    perspectiveSignals: ['scope', 'business analyst', 'architecture', 'risk', 'delivery'],
    questions: [
      { id: 'in-scope', answerPath: 'project.inScope', label: 'In scope', prompt: 'What is explicitly part of this project?', help: 'Use one clear boundary or capability per line.', type: 'list', required: false },
      { id: 'capabilities', answerPath: 'project.capabilities', label: 'Expected capabilities', prompt: 'What must the project be able to do?', help: 'Record current beliefs; Discovery can challenge them later.', type: 'list', required: false },
      { id: 'missing-capabilities', answerPath: 'project.missingCapabilities', label: 'Possible gaps', prompt: 'What might disappointed users say it cannot do?', help: 'Capture blind spots or missing capabilities.', type: 'list', required: false },
      { id: 'project-stage', answerPath: 'project.stage', label: 'Project stage', prompt: 'What kind of starting point is this?', help: 'Choose the closest current state.', type: 'select', required: false, options: ['new', 'existing', 'modernisation', 'unknown'] },
      { id: 'product-types', answerPath: 'project.productTypes', label: 'Product types', prompt: 'What kinds of product or service are involved?', help: 'For example: web application, API, CLI, workflow, or policy.', type: 'list', required: false },
      { id: 'non-goals', answerPath: 'project.nonGoals', label: 'Non-goals', prompt: 'What will this project deliberately not do?', help: 'Clear exclusions protect focus and future decisions.', type: 'list', required: false },
      { id: 'dont-touch', answerPath: 'project.dontTouch', label: 'Do not touch', prompt: 'What systems, code, data, or processes must remain untouched?', help: 'Name protected boundaries explicitly.', type: 'list', required: false },
      { id: 'hard-constraints', answerPath: 'project.hardConstraints', label: 'Hard constraints', prompt: 'Which constraints are confirmed facts?', help: 'Include fixed dates, contracts, platforms, or other binding realities.', type: 'list', required: false },
      { id: 'soft-constraints', answerPath: 'project.softConstraints', label: 'Assumptions to test', prompt: 'Which inherited constraints may only be assumptions?', help: 'Record them without promoting them to facts.', type: 'list', required: false },
      { id: 'non-negotiables', answerPath: 'project.nonNegotiables', label: 'Non-negotiables', prompt: 'Which project rules cannot be traded away?', help: 'Use one rule per line.', type: 'list', required: false },
      { id: 'open-questions', answerPath: 'project.openQuestions', label: 'Open questions', prompt: 'What still blocks confident planning?', help: 'Name the question and, where known, who can answer it.', type: 'list', required: false },
      { id: 'risks', answerPath: 'project.risks', label: 'Risks and assumptions', prompt: 'What could invalidate the current direction?', help: 'Include delivery, user, technical, data, or organisational risks.', type: 'list', required: false },
      { id: 'one-sentence', answerPath: 'project.oneSentence', label: 'In one sentence', prompt: 'How would you describe this project honestly in one sentence?', help: 'Use plain language that a new collaborator would recognise.', type: 'text', required: false },
      { id: 'avoid-becoming', answerPath: 'project.avoidBecoming', label: 'Avoid becoming', prompt: 'What is the one thing this project must not become?', help: 'Use this as a guardrail against drift.', type: 'textarea', required: false }
    ]
  },
  {
    id: 'delivery',
    title: 'Delivery',
    description: 'Record technology direction without turning candidates into binding decisions.',
    perspectiveSignals: ['software maintainer', 'architecture', 'delivery', 'operations', 'technology'],
    questions: [
      { id: 'technology-packs', answerPath: 'delivery.technologyPacks', label: 'Technology packs', prompt: 'Which installed EWAI technology packs should guide the project?', help: 'Leave empty when technology remains undecided.', type: 'list', required: false },
      { id: 'custom-technology', answerPath: 'delivery.customTechnology', label: 'Custom technology', prompt: 'Which technologies are not represented by an installed pack?', help: 'Record candidates without implying approval.', type: 'list', required: false },
      { id: 'deployment-target', answerPath: 'delivery.deploymentTarget', label: 'Deployment direction', prompt: 'Where is the project expected to run?', help: 'Use “undecided” when the answer is not yet owned.', type: 'text', required: false },
      { id: 'delivery-constraints', answerPath: 'delivery.constraints', label: 'Delivery constraints', prompt: 'Which technical or delivery constraints shape the work?', help: 'Separate confirmed constraints from preferences.', type: 'list', required: false },
      { id: 'organisation-blueprint', answerPath: 'delivery.organisationBlueprint', label: 'Organisation blueprint', prompt: 'Should this project adopt an installed organisation blueprint?', help: 'Choose one reviewed local blueprint and any optional modules. Nothing is applied until named approval.', type: 'organisation-blueprint', required: false }
    ]
  },
  {
    id: 'assurance',
    title: 'Assurance',
    description: 'Triage data, security, accessibility, resilience, and regulatory concerns.',
    perspectiveSignals: ['security', 'privacy', 'compliance', 'accessibility', 'resilience', 'operations', 'recovery', 'assurance'],
    questions: [
      { id: 'jurisdictions', answerPath: 'assurance.jurisdictions', label: 'Jurisdictions', prompt: 'Where will the organisation, users, infrastructure, or affected data be located?', help: 'Unknown is acceptable; uncertainty should remain visible.', type: 'list', required: false },
      { id: 'regulated-domains', answerPath: 'assurance.regulatedDomains', label: 'Controlled domains', prompt: 'Which regulated or contract-controlled domains may apply?', help: 'Record candidates for qualified review.', type: 'list', required: false },
      { id: 'data-classification', answerPath: 'assurance.dataClassification', label: 'Data classification', prompt: 'What is the highest expected data classification?', help: 'Choose the most cautious currently supported answer.', type: 'select', required: false, options: ['public', 'internal', 'confidential', 'restricted', 'unknown'] },
      ...['personalData', 'sensitiveData', 'authentication', 'multiTenant', 'internetFacing', 'payments', 'aiFeatures', 'accessibility'].map((field) => ({
        id: field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
        answerPath: `assurance.${field}`,
        label: ({ personalData: 'Personal data', sensitiveData: 'Sensitive data', authentication: 'Authentication', multiTenant: 'Multiple organisations', internetFacing: 'Internet-facing', payments: 'Payments', aiFeatures: 'AI features', accessibility: 'Accessibility obligations' })[field],
        prompt: ({ personalData: 'Will it process personal data?', sensitiveData: 'Will it process sensitive or specially protected data?', authentication: 'Will users authenticate?', multiTenant: 'Will it serve more than one customer or organisation?', internetFacing: 'Will any service be exposed to the public internet?', payments: 'Will it accept or process payments?', aiFeatures: 'Will it include AI-assisted or automated behaviour?', accessibility: 'Are accessibility obligations expected?' })[field],
        help: 'Choose unknown when the evidence is not yet available.',
        type: 'select',
        required: false,
        options: ['yes', 'no', 'unknown']
      })),
      { id: 'availability', answerPath: 'assurance.availability', label: 'Availability', prompt: 'How critical is service availability?', help: 'Choose unknown when service expectations are not yet owned.', type: 'select', required: false, options: ['standard', 'high', 'critical', 'unknown'] }
    ]
  },
  {
    id: 'review',
    title: 'Review & approve',
    description: 'Review answers, candidate warnings, destinations, and accountable approval.',
    perspectiveSignals: ['product owner', 'engineering manager', 'security', 'operations', 'quality'],
    questions: []
  }
];

export function discoveryQuestionnaire() {
  return structuredClone({
    schema: 'ewai.discovery-questionnaire/v1',
    answersSchema: ANSWERS_SCHEMA,
    sections: questionnaireSections,
    inheritedPaths: ['delivery.detectedPacks', 'validation']
  });
}

const outputFiles = [
  '1.Scope/context.md',
  '1.Scope/project-scope.md',
  '2.Purpose/intent-brief.md',
  '2.Purpose/explorations/project-discovery.md',
  '3.Evidence/success-criteria.md',
  '3.Evidence/risk/compliance-applicability.md',
  '4.Constraints/project-constraints.md',
  '5.Strategy/approach.md',
  '5.Strategy/architecture/stack.md',
  '5.Strategy/options/minimum-standards.md'
];

function asString(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function asList(value) {
  if (Array.isArray(value)) return value.map((item) => asString(item)).filter(Boolean);
  const text = asString(value);
  return text ? text.split(',').map((item) => item.trim()).filter(Boolean) : [];
}

function asEnum(value, allowed, fallback) {
  const normalised = asString(value, fallback).toLowerCase();
  if (!allowed.has(normalised)) {
    throw new Error(`Unsupported value "${value}"; expected one of: ${[...allowed].join(', ')}`);
  }
  return normalised;
}

function unique(values) {
  return [...new Set(values)];
}

function fileMetadata(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function safeSpecsDestination(specsRoot, relativeDestination) {
  const destination = resolve(specsRoot, relativeDestination);
  const bounded = relative(specsRoot, destination);
  if (!bounded || bounded.startsWith('..') || isAbsolute(bounded)) {
    throw new Error(`Discovery destination escapes the SPECS root: ${relativeDestination}`);
  }
  let cursor = specsRoot;
  for (const segment of bounded.split(/[\\/]+/)) {
    cursor = resolve(cursor, segment);
    const metadata = fileMetadata(cursor);
    if (metadata?.isSymbolicLink()) {
      throw new Error(`Discovery destination may not traverse a symbolic link: ${relativeDestination}`);
    }
  }
  return destination;
}

function normaliseOrganisationBlueprint(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('delivery.organisationBlueprint must be a blueprint selection');
  }
  const packId = asString(value.packId);
  if (!packId) return null;
  return { packId, enabledModules: unique(asList(value.enabledModules)).sort() };
}

function discoveryValidation(raw, configured) {
  const rawProviders = raw.providers ?? Object.fromEntries(
    VALIDATION_PROVIDERS
      .filter((provider) => raw[provider] !== undefined)
      .map((provider) => [provider, raw[provider]]),
  );
  const rawCheckpoints = raw.checkpoints ?? {};
  const checkpoints = Object.fromEntries(
    Object.keys(VALIDATION_CHECKPOINTS).map((checkpoint) => {
      const value = rawCheckpoints[checkpoint] ?? {};
      return [
        checkpoint,
        {
          ...(configured.external?.checkpoints?.[checkpoint] ?? {}),
          enabled: value.enabled
            ?? configured.external?.checkpoints?.[checkpoint]?.enabled,
          max_cycles: value.max_cycles
            ?? configured.external?.checkpoints?.[checkpoint]?.max_cycles,
          validators: value.validators
            ?? configured.external?.checkpoints?.[checkpoint]?.validators,
          review: {
            ...(configured.external?.checkpoints?.[checkpoint]?.review ?? {}),
            ...(value.review ?? {}),
            ...(value.breadth ? { breadth: value.breadth } : {}),
            ...(value.depth ? { depth: value.depth } : {}),
            ...(value.output ? { output: value.output } : {}),
          },
        },
      ];
    }),
  );

  return normaliseValidationConfig({
    ...configured,
    external: {
      ...(configured.external ?? {}),
      providers: {
        ...(configured.external?.providers ?? {}),
        ...rawProviders,
      },
      checkpoints,
    },
  });
}

function requireAnswer(value, label) {
  if (Array.isArray(value) ? value.length === 0 : !value) {
    throw new Error(`Discovery answer is required: ${label}`);
  }
}

function escapeTable(value) {
  return asString(value, 'Not specified').replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

function bullets(values, empty = 'Not specified') {
  return values.length ? values.map((value) => `- ${value}`).join('\n') : `- ${empty}`;
}

function yes(value) {
  return value === 'yes';
}

function yesOrUnknown(value) {
  return value === 'yes' || value === 'unknown';
}

function walkDirectories(root, maximumDepth = 2, depth = 0) {
  if (!existsSync(root) || depth > maximumDepth) return [];
  const found = [root];
  if (depth === maximumDepth) return found;

  const ignored = new Set(['.git', '.ewai-pipeline', '.agents', '.claude', 'node_modules', 'vendor', 'SPECS']);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || ignored.has(entry.name) || entry.name.startsWith('.')) continue;
    found.push(...walkDirectories(resolve(root, entry.name), maximumDepth, depth + 1));
  }
  return found;
}

function safeDetectionPath(value, { pattern = false } = {}) {
  const candidate = String(value ?? '').trim();
  const segments = candidate.split('/');
  if (!candidate || candidate.length > 240 || candidate.startsWith('/') || candidate.startsWith('!')
    || candidate.includes('\\') || candidate.includes('\0') || segments.includes('..') || /[{}()[\]]/.test(candidate)
    || (!pattern && /[*?]/.test(candidate))) {
    throw new Error(`unsafe pack detection ${pattern ? 'pattern' : 'path'}: ${candidate || '<empty>'}`);
  }
  return candidate;
}

function detectionPatternRegex(value) {
  const pattern = safeDetectionPath(value, { pattern: true });
  let expression = '^';
  for (let index = 0; index < pattern.length;) {
    if (pattern[index] === '*' && pattern[index + 1] === '*') {
      expression += pattern[index + 2] === '/' ? '(?:.*/)?' : '.*';
      index += pattern[index + 2] === '/' ? 3 : 2;
    } else if (pattern[index] === '*') {
      expression += '[^/]*';
      index += 1;
    } else if (pattern[index] === '?') {
      expression += '[^/]';
      index += 1;
    } else {
      expression += pattern[index].replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
      index += 1;
    }
  }
  return new RegExp(`${expression}$`);
}

function walkDetectionFiles(root, maximumDepth = 6, maximumFiles = 10_000) {
  const ignored = new Set(['.git', '.ewai-pipeline', '.agents', '.claude', 'node_modules', 'vendor', 'SPECS']);
  const found = [];
  const visit = (directory, depth) => {
    if (depth > maximumDepth || found.length >= maximumFiles) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= maximumFiles) break;
      if (entry.isSymbolicLink()) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name) && !entry.name.startsWith('.')) visit(path, depth + 1);
      } else if (entry.isFile()) found.push(path);
    }
  };
  visit(root, 0);
  return found;
}

function dependencyNames(directory) {
  const names = new Set();
  const packagePath = resolve(directory, 'package.json');
  const composerPath = resolve(directory, 'composer.json');

  if (existsSync(packagePath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
      for (const group of ['dependencies', 'devDependencies', 'peerDependencies']) {
        for (const name of Object.keys(packageJson[group] ?? {})) names.add(name);
      }
    } catch {
      // A malformed project manifest is reported by project tooling; detection remains best-effort.
    }
  }

  if (existsSync(composerPath)) {
    try {
      const composer = JSON.parse(readFileSync(composerPath, 'utf8'));
      for (const group of ['require', 'require-dev']) {
        for (const name of Object.keys(composer[group] ?? {})) names.add(name);
      }
    } catch {
      // See package.json handling above.
    }
  }

  return names;
}

export function detectTechnologyPacks(projectRoot, packs = listPacks()) {
  const root = resolve(projectRoot);
  const directories = walkDirectories(root);
  const regularFiles = walkDetectionFiles(root);
  const detected = new Set();
  const technologyPacks = packs.filter((pack) => pack.type === 'technology');

  for (const pack of technologyPacks) {
    const requiredFiles = (pack.detection?.files ?? []).map((value) => safeDetectionPath(value));
    const requiredDependencies = pack.detection?.dependencies ?? [];
    const anyFiles = (pack.detection?.any_files ?? []).map((value) => safeDetectionPath(value));
    const anyPatterns = (pack.detection?.any_patterns ?? []).map(detectionPatternRegex);
    const matched = directories.some((directory) => {
      const filesMatch = requiredFiles.length > 0
        && requiredFiles.every((file) => existsSync(resolve(directory, file)));
      const dependencies = dependencyNames(directory);
      const dependenciesMatch = requiredDependencies.length > 0
        && requiredDependencies.every((dependency) => dependencies.has(dependency));
      const anyFileMatches = anyFiles.some((file) => existsSync(resolve(directory, file)));
      const anyPatternMatches = anyPatterns.length > 0 && regularFiles.some((file) => {
        const candidate = relative(directory, file).replaceAll('\\', '/');
        return !candidate.startsWith('../') && anyPatterns.some((pattern) => pattern.test(candidate));
      });
      return filesMatch || dependenciesMatch || anyFileMatches || anyPatternMatches;
    });
    if (matched) detected.add(pack.id);
  }

  for (const pack of packs.filter((candidate) => candidate.type === 'stack')) {
    const requirements = pack.requires ?? [];
    if (requirements.length && requirements.every((id) => detected.has(id))) detected.add(pack.id);
  }

  return [...detected];
}

function resolveSelectedPacks(selected, packs) {
  const byId = new Map(packs.map((pack) => [pack.id, pack]));
  const resolved = [];
  const visit = (id) => {
    const pack = byId.get(id);
    if (!pack) throw new Error(`Unknown technology pack: ${id}`);
    if (!['technology', 'stack'].includes(pack.type)) {
      throw new Error(`Pack ${id} is not a technology or stack pack`);
    }
    for (const requirement of pack.requires ?? []) visit(requirement);
    if (!resolved.includes(id)) resolved.push(id);
  };
  for (const id of selected) visit(id);
  return resolved;
}

export function normaliseDiscoveryAnswers(rawAnswers, projectConfig, detectedPacks = []) {
  const raw = rawAnswers ?? {};
  if (raw.schema && raw.schema !== ANSWERS_SCHEMA) {
    throw new Error(`Unsupported discovery answers schema: ${raw.schema}`);
  }

  const project = raw.project ?? {};
  const delivery = raw.delivery ?? {};
  const assurance = raw.assurance ?? {};
  const validation = raw.validation ?? {};
  const configuredValidation = normaliseValidationConfig(projectConfig.validation);
  const selectedPacks = unique(asList(delivery.technologyPacks ?? delivery.stack));
  const answers = {
    schema: ANSWERS_SCHEMA,
    project: {
      name: asString(project.name, projectConfig.project?.name),
      purpose: asString(project.purpose),
      whyNow: asString(project.whyNow, project.problem),
      problem: asString(project.problem),
      primaryUsers: asList(project.primaryUsers),
      desiredOutcomes: asList(project.desiredOutcomes),
      inScope: asList(project.inScope),
      capabilities: asList(project.capabilities),
      missingCapabilities: asList(project.missingCapabilities),
      stage: asEnum(project.stage, PROJECT_STAGES, 'unknown'),
      productTypes: asList(project.productTypes),
      nonGoals: asList(project.nonGoals),
      dontTouch: asList(project.dontTouch),
      hardConstraints: asList(project.hardConstraints),
      softConstraints: asList(project.softConstraints),
      nonNegotiables: asList(project.nonNegotiables),
      successSignals: asList(project.successSignals).length
        ? asList(project.successSignals)
        : asList(project.desiredOutcomes),
      failureSignals: asList(project.failureSignals),
      definitionOfReady: asList(project.definitionOfReady),
      definitionOfDone: asList(project.definitionOfDone),
      openQuestions: asList(project.openQuestions),
      risks: asList(project.risks),
      oneSentence: asString(project.oneSentence, project.purpose),
      avoidBecoming: asString(project.avoidBecoming),
      ownership: {
        product: asString(project.ownership?.product, 'Unassigned'),
        delivery: asString(project.ownership?.delivery, 'Unassigned'),
        technical: asString(project.ownership?.technical, 'Unassigned')
      }
    },
    delivery: {
      technologyPacks: selectedPacks,
      customTechnology: asList(delivery.customTechnology),
      deploymentTarget: asString(delivery.deploymentTarget, 'undecided'),
      constraints: asList(delivery.constraints),
      organisationBlueprint: normaliseOrganisationBlueprint(delivery.organisationBlueprint),
      detectedPacks: unique(asList(delivery.detectedPacks).length ? asList(delivery.detectedPacks) : detectedPacks)
    },
    assurance: {
      jurisdictions: asList(assurance.jurisdictions),
      regulatedDomains: asList(assurance.regulatedDomains),
      dataClassification: asEnum(assurance.dataClassification, DATA_CLASSIFICATIONS, 'unknown'),
      personalData: asEnum(assurance.personalData, TRI_STATE, 'unknown'),
      sensitiveData: asEnum(assurance.sensitiveData, TRI_STATE, 'unknown'),
      authentication: asEnum(assurance.authentication, TRI_STATE, 'unknown'),
      multiTenant: asEnum(assurance.multiTenant, TRI_STATE, 'unknown'),
      internetFacing: asEnum(assurance.internetFacing, TRI_STATE, 'unknown'),
      payments: asEnum(assurance.payments, TRI_STATE, 'unknown'),
      aiFeatures: asEnum(assurance.aiFeatures, TRI_STATE, 'unknown'),
      accessibility: asEnum(assurance.accessibility, TRI_STATE, 'unknown'),
      availability: asEnum(assurance.availability, AVAILABILITY_LEVELS, 'unknown')
    },
    validation: discoveryValidation(validation, configuredValidation)
  };

  requireAnswer(answers.project.name, 'project.name');
  requireAnswer(answers.project.purpose, 'project.purpose');
  requireAnswer(answers.project.problem, 'project.problem');
  requireAnswer(answers.project.primaryUsers, 'project.primaryUsers');
  requireAnswer(answers.project.desiredOutcomes, 'project.desiredOutcomes');

  return answers;
}

function parseMarkdownDocument(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { metadata: {}, body: content.trim() };
  let metadata = {};
  try {
    metadata = YAML.parse(match[1]) ?? {};
  } catch (error) {
    throw new Error(`Organisation blueprint persona frontmatter is invalid: ${error.message}`);
  }
  return { metadata, body: content.slice(match[0].length).trim() };
}

function organisationPackSlug(pack) {
  return pack.id.split('.').slice(2).join('-');
}

function renderOrganisationStandard(pack, module, standard, approval) {
  const metadata = {
    schema: 'ewai.organisation-standard/v1',
    id: `${pack.id}.${module.id}.${standard.id}`,
    title: standard.title,
    source_pack: pack.id,
    source_version: pack.version,
    source_digest: pack.digest,
    module: module.id,
    approved_by: approval.approvedBy || 'Pending named approval',
    approved_at: approval.approvedAt || 'Pending named approval'
  };
  return `---\n${YAML.stringify(metadata, { lineWidth: 0 }).trim()}\n---\n\n${standard.content.trim()}\n`;
}

function renderOrganisationPersona(pack, item, approval) {
  const { metadata: source, body } = parseMarkdownDocument(item.content);
  const identity = `project.${pack.blueprint.publisher.id}.${item.id}`;
  const metadata = {
    schema: 'ewai.persona/v1',
    id: identity,
    name: item.name ?? source.name ?? item.id,
    version: source.version ?? pack.version,
    description: source.description ?? `Applies ${pack.name} organisation context to this project.`,
    category: source.category ?? 'organisation',
    pack: pack.id,
    tier: 'project',
    tags: Array.isArray(source.tags) ? source.tags : [],
    capabilities: Array.isArray(source.capabilities) ? source.capabilities : [],
    provenance: {
      source_pack: pack.id,
      source_version: pack.version,
      source_digest: pack.digest,
      approved_by: approval.approvedBy || 'Pending named approval',
      approved_at: approval.approvedAt || 'Pending named approval'
    }
  };
  const title = `# ${metadata.name}`;
  const renderedBody = body || `${title}\n\nApply the reviewed ${pack.name} perspective to project decisions.`;
  return `---\n${YAML.stringify(metadata, { lineWidth: 0 }).trim()}\n---\n\n${renderedBody}\n`;
}

function renderOrganisationBlueprintReceipt(resolved, approval) {
  const lines = [
    '# Organisation blueprint receipt',
    '',
    `- **Root blueprint:** ${resolved.root.name} (\`${resolved.root.id}\` ${resolved.root.version})`,
    `- **Selection digest:** \`${resolved.digest}\``,
    `- **Approved by:** ${approval.approvedBy || 'Pending named approval'}`,
    `- **Approved at:** ${approval.approvedAt || 'Pending named approval'}`,
    '',
    '## Resolved packs',
    '',
    '| Pack | Version | Content digest |',
    '| --- | --- | --- |',
    ...resolved.packs.map((pack) => `| \`${pack.id}\` | ${pack.version} | \`${pack.digest}\` |`),
    '',
    '## Applied modules',
    '',
    ...resolved.modules.map(({ packId, module }) => `- \`${packId}:${module.id}\` — ${module.name}${module.required ? ' (required)' : ' (optional)'}`),
    '',
    '## Accepted Governed Starter Packs',
    ''
  ];
  const starterPacks = resolved.modules.flatMap(({ packId, module }) => module.starterPacks.map((item) => ({ packId, moduleId: module.id, ...item })));
  if (!starterPacks.length) lines.push('- None.');
  else for (const item of starterPacks) {
    const targets = item.targets.map((target) => `${target.role} from ${target.sourcePath}`).join(', ');
    lines.push(`- **${item.name}** (\`${item.packId}:${item.moduleId}:${item.id}\`) — ${item.source} at ${item.version}; ${item.digest}; ${item.licence}; ${item.compatibility}; targets: ${targets}.${item.legacy ? ' Legacy boilerplate declaration normalised as a Governed Starter Pack.' : ''}`);
  }
  lines.push(
    '',
    '> Governed Starter Packs are accepted inert receipts only. Discovery did not fetch, clone, scaffold, execute, materialise, install, or deploy them.',
    ''
  );
  return lines.join('\n');
}

function organisationBlueprintOutputs(resolved, approval = {}) {
  if (!resolved) return [];
  const outputs = [];
  for (const { packId, module } of resolved.modules) {
    const pack = resolved.packs.find((candidate) => candidate.id === packId);
    const publisher = pack.blueprint.publisher.id;
    const packSlug = organisationPackSlug(pack);
    for (const standard of module.standards) {
      outputs.push({
        kind: 'organisation-standard',
        relative: `4.Constraints/standards/organisation/${publisher}/${packSlug}/${module.id}/${standard.id}.md`,
        content: renderOrganisationStandard(pack, module, standard, approval)
      });
    }
    for (const persona of module.personas) {
      outputs.push({
        kind: 'project-persona',
        relative: `1.Scope/personas/project/${publisher}-${persona.id}.md`,
        content: renderOrganisationPersona(pack, persona, approval)
      });
    }
  }
  outputs.push({
    kind: 'organisation-blueprint-receipt',
    relative: '5.Strategy/organisation-blueprint.md',
    content: renderOrganisationBlueprintReceipt(resolved, approval)
  });
  const duplicate = outputs.find((output, index) => outputs.findIndex((candidate) => candidate.relative === output.relative) !== index);
  if (duplicate) throw new Error(`Organisation blueprint output collision: ${duplicate.relative}`);
  return outputs;
}

function resolveSelectedOrganisationBlueprint(projectRoot, selection, options = {}) {
  if (!selection) return null;
  const catalogue = options.organisationBlueprints ?? listOrganisationBlueprints({
    projectRoot,
    roots: options.organisationBlueprintRoots,
    home: options.home
  });
  return resolveOrganisationBlueprint(selection.packId, catalogue, { enabledModules: selection.enabledModules });
}

function minimumStandards(answers) {
  const standards = [
    {
      id: 'intent-and-acceptance',
      title: 'Intent and acceptance evidence',
      reason: 'Every change needs a reviewable purpose, affected users, constraints, and testable acceptance criteria.',
      minimum: 'Create an EWAI intent before implementation and preserve decisions and evidence in SPECS.'
    },
    {
      id: 'version-control-review',
      title: 'Version control and independent review',
      reason: 'Changes need traceability and a second set of eyes proportionate to risk.',
      minimum: 'Use protected version control, focused commits, peer review, and explicit approval for destructive operations.'
    },
    {
      id: 'automated-quality-gates',
      title: 'Automated quality gates',
      reason: 'The selected stack must have repeatable evidence that changes compile, conform, and behave as intended.',
      minimum: 'Define install, lint, type or static analysis, test, and build commands; run them in continuous integration.'
    },
    {
      id: 'dependency-and-secrets',
      title: 'Dependency and secret hygiene',
      reason: 'Deployable systems inherit supply-chain risk and must not commit credentials.',
      minimum: 'Commit lock files, scan dependencies, keep secrets outside source control, and document supported runtime versions.'
    },
    {
      id: 'security-by-default',
      title: 'Security by default',
      reason: 'Security controls are cheaper and more reliable when designed with the system rather than added at delivery.',
      minimum: 'Apply least privilege, validate untrusted input, protect sensitive output, log security-relevant events, and threat-model material boundaries.'
    },
    {
      id: 'operations-and-recovery',
      title: 'Operations and recovery',
      reason: 'A deployable service needs observable behaviour and a tested route back from failure.',
      minimum: 'Define health signals, structured logs, backup and restore expectations, incident ownership, and rollback procedures.'
    }
  ];

  if (yesOrUnknown(answers.assurance.authentication)) {
    standards.push({
      id: 'identity-and-authorization',
      title: 'Identity and authorization',
      reason: `Authentication was answered ${answers.assurance.authentication}.`,
      minimum: 'Specify identity source, session or token lifecycle, authorization boundaries, privileged actions, and access-control tests.'
    });
  }
  if (yes(answers.assurance.multiTenant)) {
    standards.push({
      id: 'tenant-isolation',
      title: 'Tenant isolation',
      reason: 'The system will hold data or operations for more than one customer or organisation.',
      minimum: 'Carry tenant context through every data path and test both permitted same-tenant access and blocked cross-tenant access.'
    });
  }
  if (yesOrUnknown(answers.assurance.accessibility)) {
    standards.push({
      id: 'accessibility',
      title: 'Accessibility',
      reason: `Accessibility obligations were answered ${answers.assurance.accessibility}.`,
      minimum: 'Set an accessibility target, use semantic interfaces, support keyboard operation, and include automated and human accessibility checks.'
    });
  }
  if (['high', 'critical'].includes(answers.assurance.availability)) {
    standards.push({
      id: 'service-resilience',
      title: 'Service resilience',
      reason: `Availability was classified as ${answers.assurance.availability}.`,
      minimum: 'Define service objectives, failure modes, redundancy, recovery time and recovery point objectives, capacity tests, and an exercised incident plan.'
    });
  }
  if (yes(answers.assurance.aiFeatures)) {
    standards.push({
      id: 'responsible-ai-engineering',
      title: 'Responsible AI engineering',
      reason: 'The project includes AI-assisted or automated decisions or content.',
      minimum: 'Document model and data provenance, evaluation criteria, failure handling, human oversight, monitoring, and user transparency.'
    });
  }

  return standards;
}

function complianceRecommendations(answers) {
  const recommendations = [];
  const add = (id, title, trigger, review) => recommendations.push({ id, title, trigger, review });

  if (answers.assurance.jurisdictions.length === 0) {
    add(
      'jurisdiction-discovery',
      'Jurisdiction and market assessment',
      'No operating or user jurisdictions were confirmed.',
      'Identify where the organisation, users, infrastructure, and affected data are located before selecting binding requirements.'
    );
  }
  if (yesOrUnknown(answers.assurance.personalData)) {
    add(
      'data-protection',
      'Privacy and data-protection assessment',
      `Personal-data processing was answered ${answers.assurance.personalData}.`,
      'Confirm applicability with a qualified owner; document data categories, purposes, lawful grounds, minimisation, retention, rights handling, processors, transfers, and breach response.'
    );
  }
  if (yes(answers.assurance.sensitiveData)) {
    add(
      'high-risk-data',
      'High-risk data and impact assessment',
      'Sensitive or specially protected information will be processed.',
      'Determine whether a formal privacy, security, equality, or sector impact assessment is required before approving the design.'
    );
  }
  if (yes(answers.assurance.payments)) {
    add(
      'payment-scope',
      'Payment and card-data scope review',
      'The project will accept or process payments.',
      'Keep payment data out of the application where practical and have a qualified owner determine the applicable payment-security scope and evidence.'
    );
  }
  if (yes(answers.assurance.aiFeatures)) {
    add(
      'ai-governance',
      'AI governance and regulatory assessment',
      'The project includes AI-assisted or automated behaviour.',
      'Classify the AI use, affected people, decision impact, providers, training and input data, human oversight, transparency, evaluation, and applicable jurisdictional obligations.'
    );
  }
  if (yesOrUnknown(answers.assurance.accessibility)) {
    add(
      'accessibility-obligations',
      'Accessibility obligations review',
      `Accessibility obligations were answered ${answers.assurance.accessibility}.`,
      'Identify the applicable accessibility standard, contractual target, user needs, testing method, and evidence owner.'
    );
  }
  if (['confidential', 'restricted'].includes(answers.assurance.dataClassification)) {
    add(
      'information-security',
      'Information-security control assessment',
      `The highest expected data classification is ${answers.assurance.dataClassification}.`,
      'Select a proportionate security control baseline and define encryption, access review, audit, retention, incident, supplier, and recovery evidence.'
    );
  }
  for (const domain of answers.assurance.regulatedDomains) {
    add(
      `sector-${domain.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`,
      `${domain} obligations review`,
      `${domain} was identified as a regulated or contractually controlled domain.`,
      'Assign a qualified owner to identify binding laws, regulator guidance, contracts, records, controls, testing, and approval evidence before Build.'
    );
  }
  if (yes(answers.assurance.internetFacing)) {
    add(
      'internet-service-security',
      'Internet-facing service security review',
      'The project will expose a service to the public internet.',
      'Define attack-surface ownership, secure configuration, vulnerability management, abuse controls, penetration-test expectations, monitoring, and incident response.'
    );
  }

  return recommendations;
}

function renderFrontmatter(schema, completedAt) {
  return `---\nschema: ${schema}\nstatus: draft-for-review\ndiscovered_at: ${completedAt}\n---`;
}

function renderContext(answers, completedAt) {
  return `${renderFrontmatter('ewai.project-context/v1', completedAt)}\n\n# Project Context: ${answers.project.name}\n\nThis is the strategic entry point for agents and collaborators. Read the linked SPECS before planning or implementation.\n\n## Project in one sentence\n\n${answers.project.oneSentence}\n\n## Primary users\n\n${bullets(answers.project.primaryUsers)}\n\n## North Star\n\n${bullets(answers.project.desiredOutcomes)}\n\n## Non-negotiables\n\n${bullets(answers.project.nonNegotiables, 'None confirmed; review project constraints before Build')}\n\n## Technology direction\n\n- **Selected packs:** ${answers.delivery.technologyPacks.join(', ') || 'None selected'}\n- **Custom technology:** ${answers.delivery.customTechnology.join(', ') || 'None'}\n- **Deployment:** ${answers.delivery.deploymentTarget}\n\n## Canonical references\n\n- Scope: SPECS/1.Scope/project-scope.md\n- Intent: SPECS/2.Purpose/intent-brief.md\n- Success: SPECS/3.Evidence/success-criteria.md\n- Constraints: SPECS/4.Constraints/project-constraints.md\n- Approach: SPECS/5.Strategy/approach.md\n- Stack: SPECS/5.Strategy/architecture/stack.md\n`;
}

function renderProjectScope(answers, completedAt) {
  const included = unique([...answers.project.inScope, ...answers.project.productTypes.map((type) => `${type} product surface`)]);
  return `${renderFrontmatter('ewai.project-scope/v1', completedAt)}\n\n# Project Scope: ${answers.project.name}\n\n## What this project includes\n\n${bullets(included, 'Scope requires confirmation')}\n\n## Primary users and affected people\n\n${bullets(answers.project.primaryUsers)}\n\n## What this project excludes (non-goals)\n\n${bullets(answers.project.nonGoals, 'No explicit non-goals were confirmed')}\n\n## Do not touch\n\n${bullets(answers.project.dontTouch, 'No protected systems, code, or processes were confirmed')}\n\n## Project shape\n\n| Attribute | Discovery answer |\n|---|---|\n| Stage | ${escapeTable(answers.project.stage)} |\n| Product types | ${escapeTable(answers.project.productTypes.join(', '))} |\n| Deployment target | ${escapeTable(answers.delivery.deploymentTarget)} |\n| Availability | ${escapeTable(answers.assurance.availability)} |\n`;
}

function renderIntentBrief(answers, completedAt) {
  return `${renderFrontmatter('ewai.project-intent/v1', completedAt)}\n\n# Project Intent: ${answers.project.name}\n\n## The problem\n\n${answers.project.problem}\n\n## The people experiencing it\n\n${bullets(answers.project.primaryUsers)}\n\n## The North Star\n\n${answers.project.purpose}\n\n${bullets(answers.project.desiredOutcomes)}\n\n## Why now\n\n${answers.project.whyNow}\n\n## Assumed capabilities\n\n${bullets(answers.project.capabilities, 'No capabilities were confirmed during initial discovery')}\n\n## Capabilities surfaced through challenge\n\n${bullets(answers.project.missingCapabilities, 'No additional capabilities were surfaced')}\n\n## Ownership\n\n| Role | Owner | Accountability |\n|---|---|---|\n| Product | ${escapeTable(answers.project.ownership.product)} | Success or failure of outcomes |\n| Delivery | ${escapeTable(answers.project.ownership.delivery)} | Execution and quality |\n| Technical | ${escapeTable(answers.project.ownership.technical)} | Architecture and constraints |\n`;
}

function renderDiscoveryEvidence(answers, detected, standards, compliance, completedAt) {
  const rows = [
    ['Project stage', answers.project.stage],
    ['Product types', answers.project.productTypes.join(', ')],
    ['Detected technology packs', detected.join(', ') || 'None'],
    ['Selected technology packs', answers.delivery.technologyPacks.join(', ') || 'None'],
    ['Custom technology', answers.delivery.customTechnology.join(', ') || 'None'],
    ['Deployment target', answers.delivery.deploymentTarget],
    ['Jurisdictions', answers.assurance.jurisdictions.join(', ') || 'Unknown'],
    ['Regulated domains', answers.assurance.regulatedDomains.join(', ') || 'None confirmed'],
    ['Data classification', answers.assurance.dataClassification],
    ['Personal data', answers.assurance.personalData],
    ['Sensitive data', answers.assurance.sensitiveData],
    ['Authentication', answers.assurance.authentication],
    ['Multi-tenant', answers.assurance.multiTenant],
    ['Internet-facing', answers.assurance.internetFacing],
    ['Payments', answers.assurance.payments],
    ['AI features', answers.assurance.aiFeatures],
    ['Accessibility obligations', answers.assurance.accessibility],
    ['Availability', answers.assurance.availability],
    ...VALIDATION_PROVIDERS.map((provider) => [
      `${provider[0].toUpperCase()}${provider.slice(1)} external validation`,
      `${answers.validation.external.providers[provider].state}; ${
        answers.validation.external.providers[provider].enabled ? 'enabled' : 'disabled'
      }`,
    ]),
    ...Object.keys(VALIDATION_CHECKPOINTS).map((checkpoint) => {
      const setting = answers.validation.external.checkpoints[checkpoint];
      return [
        `${checkpoint} validation policy`,
        `${setting.max_cycles} cycle(s); ${setting.review.breadth}; ${setting.review.depth}; ${setting.review.output} output`,
      ];
    }),
  ];
  return `${renderFrontmatter('ewai.project-discovery/v1', completedAt)}\n\n# Project Discovery Exploration\n\nThis file records the answers used to derive the initial project SPECS. Recommendations are planning evidence, not proof of legal or regulatory compliance.\n\n## Interview record\n\n| Question area | Answer |\n|---|---|\n${rows.map(([label, value]) => `| ${label} | ${escapeTable(value)} |`).join('\n')}\n\n## Derived output\n\n- ${standards.length} minimum engineering standards recommended.\n- ${compliance.length} candidate compliance or assurance reviews identified.\n- ${answers.delivery.technologyPacks.length || answers.delivery.customTechnology.length ? 'A technology direction was selected.' : 'Technology selection remains open.'}\n\n## Review status\n\n- [ ] Product owner confirms purpose, users, outcomes, and non-goals.\n- [ ] Technical owner confirms stack and deployment direction.\n- [ ] Security or compliance owner confirms which candidate reviews are applicable.\n`;
}

function renderSuccessCriteria(answers, completedAt) {
  return `${renderFrontmatter('ewai.success-criteria/v1', completedAt)}\n\n# Project Success Criteria\n\n## Success signals\n\n${bullets(answers.project.successSignals, 'Success signals require confirmation')}\n\n## Failure signals\n\n${bullets(answers.project.failureSignals, 'Failure signals require confirmation')}\n\n## Definition of Ready\n\n${bullets(answers.project.definitionOfReady, 'Purpose, scope, constraints, ownership, and acceptance evidence are confirmed')}\n\n## Definition of Done\n\n${bullets(answers.project.definitionOfDone, 'Accepted outcomes are evidenced, delivery gates pass, manual QA is approved, and Retro is complete')}\n`;
}

function renderProjectConstraints(answers, completedAt) {
  const hard = unique([...answers.project.hardConstraints, ...answers.delivery.constraints]);
  return `${renderFrontmatter('ewai.project-constraints/v1', completedAt)}\n\n# Project Constraints\n\nThese constraints were stated during discovery. They require owner review before their status becomes binding for inherited feature SPECS.\n\n## Hard constraints (facts)\n\n${bullets(hard, 'No hard constraints were confirmed')}\n\n## Soft constraints (assumptions to test)\n\n${bullets(answers.project.softConstraints, 'No soft constraints were recorded')}\n\n## Non-negotiables\n\n${bullets(answers.project.nonNegotiables, 'No project-specific non-negotiables were confirmed')}\n\n## Compliance constraints\n\nCandidate obligations remain in SPECS/3.Evidence/risk/compliance-applicability.md until a qualified owner confirms and promotes them into SPECS/4.Constraints/compliance/.\n`;
}

function renderApproach(answers, completedAt) {
  const providerLines = VALIDATION_PROVIDERS.map((provider) => {
    const setting = answers.validation.external.providers[provider];
    return `- **${provider[0].toUpperCase()}${provider.slice(1)}:** ${setting.state}; ${setting.enabled ? 'enabled' : 'disabled'}`;
  }).join('\n');
  const checkpointLines = Object.keys(VALIDATION_CHECKPOINTS).map((checkpoint) => {
    const setting = answers.validation.external.checkpoints[checkpoint];
    const validators = setting.validators === 'auto' ? 'automatic' : setting.validators.join(', ') || 'none';
    return `- **${checkpoint}:** up to ${setting.max_cycles} cycle(s); validators ${validators}; ${setting.review.breadth} breadth; ${setting.review.depth}; ${setting.review.output} output`;
  }).join('\n');
  return `${renderFrontmatter('ewai.project-approach/v1', completedAt)}\n\n# Project Approach\n\n## Core capabilities required\n\n${bullets(unique([...answers.project.capabilities, ...answers.project.missingCapabilities]), 'Capabilities require feature discovery')}\n\n## Technology approach\n\n- **Packs:** ${answers.delivery.technologyPacks.join(', ') || 'Undecided'}\n- **Custom technology:** ${answers.delivery.customTechnology.join(', ') || 'None'}\n- **Deployment:** ${answers.delivery.deploymentTarget}\n\n## Validation approach\n\n### Available external systems\n\n${providerLines}\n\n### Verification and fix cycles\n\n${checkpointLines}\n\n- The active orchestrator is excluded from independent external validation.\n- Unsupported external stages remain visible and are marked not-supported; they are never recorded as passed.\n- Standards compliance is mandatory at every delivery, even when no external validator is available.\n\n## Open questions\n\n${bullets(answers.project.openQuestions, 'No open questions were recorded')}\n\n## Assumptions and risks\n\n${bullets(answers.project.risks, 'Risks require further discovery')}\n\n## Recommended next step\n\nReview these Project SPECS, resolve blocking questions, then use feature discovery to create the first intent and Feature SPECS. Do not begin Build from this project-level document alone.\n\n## Guardrail\n\nThe project must not become: ${answers.project.avoidBecoming || 'an implementation detached from the confirmed problem and outcomes'}.\n`;
}

function renderMinimumStandards(standards, completedAt) {
  return `${renderFrontmatter('ewai.minimum-standards-options/v1', completedAt)}\n\n# Minimum Engineering Standards: Recommendation\n\nThese are proposed minimums derived from project discovery. They remain strategy options until a technical owner accepts them into SPECS/4.Constraints/standards.md.\n\n${standards.map((standard, index) => `## ${index + 1}. ${standard.title}\n\n**Why selected:** ${standard.reason}\n\n**Minimum:** ${standard.minimum}\n`).join('\n')}\n## Approval\n\n- [ ] Technical owner has accepted, replaced, or rejected each recommendation.\n- [ ] Accepted standards have been promoted into SPECS/4.Constraints/standards.md.\n- [ ] Exceptions have a reason, owner, compensating control, and review date.\n`;
}

function renderComplianceProfile(recommendations, answers, completedAt) {
  const content = recommendations.length
    ? recommendations.map((item, index) => `## ${index + 1}. ${item.title}\n\n- **Status:** Review required\n- **Trigger:** ${item.trigger}\n- **Recommended review:** ${item.review}\n- **Owner:** Unassigned\n- **Decision:** Open\n`).join('\n')
    : 'No specific compliance review was triggered by the confirmed answers. This is not evidence that no obligations apply; reassess when jurisdictions, users, data, suppliers, or functionality change.\n';

  return `${renderFrontmatter('ewai.compliance-applicability/v1', completedAt)}\n\n# Compliance Applicability and Assurance Risk\n\n> This is an early triage record, not legal advice, certification, or a declaration of compliance. A qualified owner must determine which requirements apply.\n\n## Context\n\n- **Jurisdictions supplied:** ${answers.assurance.jurisdictions.join(', ') || 'None'}\n- **Regulated domains supplied:** ${answers.assurance.regulatedDomains.join(', ') || 'None'}\n- **Highest data classification:** ${answers.assurance.dataClassification}\n\n${content}\n## Promotion rule\n\nConfirmed obligations must be promoted into individual entries under SPECS/4.Constraints/compliance/ with an authoritative source, owner, scope, enforcement mechanism, and review date.\n\n## Change triggers\n\nRepeat discovery when the project enters a new market, adds a new category of user or data, changes deployment location, introduces AI or payments, or materially changes suppliers or decision impact.\n`;
}

function renderTechnologyStrategy(answers, selectedPacks, completedAt) {
  const packSections = selectedPacks.length
    ? selectedPacks.map((pack) => {
      const commands = Object.entries(pack.commands ?? {});
      return `### ${pack.name} (${pack.id})\n\n${pack.description}\n\n${commands.length ? `Recommended pack commands:\n\n${commands.map(([name, command]) => `- **${name}:** \`${command}\``).join('\n')}` : 'This pack composes or supplements its required technology packs.'}\n`;
    }).join('\n')
    : 'No EWAI technology pack has been selected. Record the decision criteria and evaluate a small proof before Build.\n';

  return `${renderFrontmatter('ewai.technology-stack/v1', completedAt)}\n\n# Technology Stack Reference\n\n## Selection\n\n${packSections}\n${answers.delivery.customTechnology.length ? `## Custom technology\n\n${bullets(answers.delivery.customTechnology)}\n` : ''}\n## Deployment direction\n\n${answers.delivery.deploymentTarget}\n\n## Detection evidence\n\n${bullets(answers.delivery.detectedPacks, 'No installed technology pack was detected in the current repository')}\n\n## Decision checks\n\n- [ ] The stack supports the required product shape and deployment target.\n- [ ] Runtime and framework versions will be pinned.\n- [ ] Install, lint, analysis, test, build, migration, and deployment commands are defined.\n- [ ] Security support windows and dependency ownership are understood.\n- [ ] The team can operate and recover the selected stack.\n- [ ] Any recommended boilerplate has reviewed provenance, licence, version, and compatibility.\n`;
}

function buildOutputs(answers, selectedPacks, completedAt) {
  const standards = minimumStandards(answers);
  const compliance = complianceRecommendations(answers);
  const outputs = {
    '1.Scope/context.md': renderContext(answers, completedAt),
    '1.Scope/project-scope.md': renderProjectScope(answers, completedAt),
    '2.Purpose/intent-brief.md': renderIntentBrief(answers, completedAt),
    '2.Purpose/explorations/project-discovery.md': renderDiscoveryEvidence(
      answers,
      answers.delivery.detectedPacks,
      standards,
      compliance,
      completedAt
    ),
    '3.Evidence/success-criteria.md': renderSuccessCriteria(answers, completedAt),
    '3.Evidence/risk/compliance-applicability.md': renderComplianceProfile(compliance, answers, completedAt),
    '4.Constraints/project-constraints.md': renderProjectConstraints(answers, completedAt),
    '5.Strategy/approach.md': renderApproach(answers, completedAt),
    '5.Strategy/architecture/stack.md': renderTechnologyStrategy(answers, selectedPacks, completedAt),
    '5.Strategy/options/minimum-standards.md': renderMinimumStandards(standards, completedAt)
  };
  return { outputs, standards, compliance };
}

export function loadDiscoveryAnswers(path) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) throw new Error(`Discovery answers file does not exist: ${absolute}`);
  const content = readFileSync(absolute, 'utf8');
  if (!['.json', '.yaml', '.yml'].includes(extname(absolute).toLowerCase())) {
    throw new Error('Discovery answers must be JSON or YAML');
  }
  return YAML.parse(content);
}

export function prepareProjectDiscovery(projectRoot, rawAnswers, options = {}) {
  const { config, paths } = loadProjectConfig(projectRoot);
  const packs = options.packs ?? listPacks();
  const detected = detectTechnologyPacks(paths.projectRoot, packs);
  const answers = normaliseDiscoveryAnswers(rawAnswers, config, detected);
  answers.delivery.technologyPacks = resolveSelectedPacks(answers.delivery.technologyPacks, packs);

  const selectedById = new Map(packs.map((pack) => [pack.id, pack]));
  const selectedPacks = answers.delivery.technologyPacks.map((id) => selectedById.get(id));
  const completedAt = options.now ?? new Date().toISOString();
  const { outputs, standards, compliance } = buildOutputs(answers, selectedPacks, completedAt);
  const resolvedBlueprint = resolveSelectedOrganisationBlueprint(paths.projectRoot, answers.delivery.organisationBlueprint, options);
  const blueprintOutputs = organisationBlueprintOutputs(resolvedBlueprint);
  const preparedOutputs = [...Object.entries(outputs).map(([relative, content]) => ({ relative, content })), ...blueprintOutputs].map(({ relative, content, kind = 'discovery' }) => {
    const path = safeSpecsDestination(paths.specsRoot, relative);
    return { kind, relative, path, content: `${content.trimEnd()}\n`, exists: existsSync(path) };
  });
  const organisationBlueprint = resolvedBlueprint
    ? { ...projectOrganisationBlueprint(resolvedBlueprint), destinations: blueprintOutputs.map((output) => output.relative) }
    : null;

  return {
    schema: 'ewai.prepared-project-discovery/v1',
    projectRoot: paths.projectRoot,
    specsRoot: paths.specsRoot,
    preparedAt: completedAt,
    answers,
    outputs: preparedOutputs,
    conflicts: preparedOutputs.filter((output) => output.exists).map((output) => output.relative),
    selectedPacks: answers.delivery.technologyPacks,
    detectedPacks: answers.delivery.detectedPacks,
    organisationBlueprint,
    minimumStandards: standards.length,
    complianceReviews: compliance.length
  };
}

export function commitProjectDiscovery(projectRoot, prepared, options = {}) {
  if (prepared?.schema !== 'ewai.prepared-project-discovery/v1') {
    throw new Error('A prepared project discovery is required before commit');
  }
  const { config, paths } = loadProjectConfig(projectRoot);
  if (resolve(prepared.projectRoot) !== paths.projectRoot) {
    throw new Error('Prepared discovery belongs to a different project');
  }
  const expectedDiscovery = new Set(outputFiles);
  const preparedRelatives = prepared.outputs.map((output) => output.relative);
  const preparedDiscoveryRelatives = prepared.outputs.filter((output) => expectedDiscovery.has(output.relative)).map((output) => output.relative);
  if (
    preparedDiscoveryRelatives.length !== expectedDiscovery.size
    || new Set(preparedDiscoveryRelatives).size !== expectedDiscovery.size
    || preparedDiscoveryRelatives.some((relative) => !expectedDiscovery.has(relative))
  ) {
    throw new Error('Prepared discovery output contract is incomplete or invalid');
  }
  const answers = prepared.answers;
  const approvedAt = options.approvedAt ?? prepared.preparedAt ?? new Date().toISOString();
  const approvedBy = asString(options.approvedBy);
  const resolvedBlueprint = resolveSelectedOrganisationBlueprint(paths.projectRoot, answers.delivery.organisationBlueprint, options);
  if (resolvedBlueprint && !approvedBy) {
    throw new Error('Organisation blueprint approval requires an accountable approver name');
  }
  if (Boolean(resolvedBlueprint) !== Boolean(prepared.organisationBlueprint)) {
    throw new Error('Prepared discovery organisation blueprint contract is incomplete or invalid');
  }
  if (resolvedBlueprint && resolvedBlueprint.digest !== prepared.organisationBlueprint.digest) {
    throw new Error('Organisation blueprint changed since preview; review the new digest before approval');
  }
  const currentBlueprintOutputs = organisationBlueprintOutputs(resolvedBlueprint, { approvedBy, approvedAt });
  const expected = new Set([...outputFiles, ...currentBlueprintOutputs.map((output) => output.relative)]);
  if (
    preparedRelatives.length !== expected.size
    || new Set(preparedRelatives).size !== expected.size
    || preparedRelatives.some((relative) => !expected.has(relative))
  ) {
    throw new Error('Prepared discovery output contract is incomplete or invalid');
  }
  const currentBlueprintByRelative = new Map(currentBlueprintOutputs.map((output) => [output.relative, output]));
  const destinations = prepared.outputs.map((output) => ({
    ...output,
    ...(currentBlueprintByRelative.get(output.relative) ?? {}),
    path: safeSpecsDestination(paths.specsRoot, output.relative)
  }));
  const existing = destinations.filter((output) => existsSync(output.path));
  if (existing.length && !options.force) {
    throw new Error(`Discovery outputs already exist; review them or use --force:\n${existing.map((output) => output.path).join('\n')}`);
  }
  const technologyIds = new Set(
    (options.packs ?? listPacks()).filter((pack) => ['technology', 'stack'].includes(pack.type)).map((pack) => pack.id)
  );
  const preservedPacks = (config.packs ?? []).filter((id) => !technologyIds.has(id));
  config.project = {
    ...(config.project ?? {}),
    name: answers.project.name,
    discovery: {
      status: 'complete',
      completed_at: approvedAt,
      ...(approvedBy ? { approved_by: approvedBy, approved_at: approvedAt } : {}),
      evidence: 'SPECS/2.Purpose/explorations/project-discovery.md'
    }
  };
  config.packs = unique([
    ...preservedPacks,
    ...answers.delivery.technologyPacks,
    ...(resolvedBlueprint?.packs.map((pack) => pack.id) ?? [])
  ]);
  config.discovery = {
    answers_schema: ANSWERS_SCHEMA,
    project_scope: 'SPECS/1.Scope/project-scope.md',
    project_intent: 'SPECS/2.Purpose/intent-brief.md',
    success_criteria: 'SPECS/3.Evidence/success-criteria.md',
    technology_strategy: 'SPECS/5.Strategy/architecture/stack.md',
    minimum_standards_options: 'SPECS/5.Strategy/options/minimum-standards.md',
    compliance_risk: 'SPECS/3.Evidence/risk/compliance-applicability.md'
  };
  config.validation = answers.validation;
  if (resolvedBlueprint) {
    config.blueprints = {
      ...(config.blueprints ?? {}),
      organisation: {
        root: {
          id: resolvedBlueprint.root.id,
          version: resolvedBlueprint.root.version,
          digest: resolvedBlueprint.root.digest
        },
        packs: resolvedBlueprint.packs.map((pack) => ({ id: pack.id, version: pack.version, digest: pack.digest })),
        selection_digest: resolvedBlueprint.digest,
        enabled_modules: [...resolvedBlueprint.enabledModules],
        applied_modules: resolvedBlueprint.modules.map(({ packId, module }) => `${packId}:${module.id}`),
        approved_by: approvedBy,
        approved_at: approvedAt,
        evidence: 'SPECS/5.Strategy/organisation-blueprint.md'
      }
    };
  }
  const originalConfig = readFileSync(paths.configPath, 'utf8');
  const writer = options.writeFile ?? writeFileSync;
  const written = [];
  const previousOutputs = new Map(
    existing.map((output) => [output.path, readFileSync(output.path, 'utf8')])
  );
  let configAttempted = false;
  try {
    for (const output of destinations) {
      mkdirSync(dirname(output.path), { recursive: true });
      written.push(output.path);
      writer(output.path, output.content, 'utf8');
    }
    configAttempted = true;
    writer(paths.configPath, YAML.stringify(config, { lineWidth: 0 }), 'utf8');
  } catch (error) {
    for (const path of written) {
      if (previousOutputs.has(path)) {
        writeFileSync(path, previousOutputs.get(path), 'utf8');
      } else {
        rmSync(path, { force: true });
      }
    }
    if (configAttempted) writeFileSync(paths.configPath, originalConfig, 'utf8');
    throw error;
  }

  publishLifecycleEventSafely(paths.projectRoot, 'ewai.project.discovery.completed', {
    sourceKey: `project.discovery.completed:${approvedAt}`,
    occurredAt: approvedAt,
    sourceRevision: approvedAt,
    facts: {
      status: 'complete',
      selectedPacks: prepared.selectedPacks,
      minimumStandards: prepared.minimumStandards,
      complianceReviews: prepared.complianceReviews,
      ...(resolvedBlueprint ? { organisationBlueprintId: resolvedBlueprint.root.id } : {}),
    },
    evidence: ['SPECS/2.Purpose/explorations/project-discovery.md'],
    personas: options.personas ?? [],
    streamId: 'project',
    now: approvedAt,
  });

  return {
    projectRoot: paths.projectRoot,
    created: destinations.map((output) => output.path),
    selectedPacks: prepared.selectedPacks,
    detectedPacks: prepared.detectedPacks,
    minimumStandards: prepared.minimumStandards,
    complianceReviews: prepared.complianceReviews,
    approval: { approvedBy, approvedAt },
    organisationBlueprint: resolvedBlueprint ? projectOrganisationBlueprint(resolvedBlueprint) : null,
    nextCommand: 'ewai intent create <slug> --domain <domain> --title <title>'
  };
}

export function discoverProject(projectRoot, rawAnswers, options = {}) {
  const prepared = prepareProjectDiscovery(projectRoot, rawAnswers, options);
  return commitProjectDiscovery(projectRoot, prepared, {
    force: options.force,
    packs: options.packs,
    organisationBlueprints: options.organisationBlueprints,
    organisationBlueprintRoots: options.organisationBlueprintRoots,
    home: options.home,
    approvedBy: options.approvedBy,
    approvedAt: options.now,
    personas: options.personas,
  });
}

async function askRequired(rl, question, fallback = '') {
  while (true) {
    const suffix = fallback ? ` [${fallback}]` : '';
    const answer = asString(await rl.question(`${question}${suffix}: `), fallback);
    if (answer) return answer;
    rl.write('Please provide an answer.\n');
  }
}

async function askList(rl, question, fallback = []) {
  const defaultText = fallback.join(', ');
  const answer = asString(await rl.question(`${question}${defaultText ? ` [${defaultText}]` : ''}: `), defaultText);
  return asList(answer);
}

async function askEnum(rl, question, allowed, fallback) {
  while (true) {
    const answer = asString(await rl.question(`${question} (${allowed.join('/')}) [${fallback}]: `), fallback).toLowerCase();
    if (allowed.includes(answer)) return answer;
    rl.write(`Choose one of: ${allowed.join(', ')}.\n`);
  }
}

export async function runDiscoveryInterview(projectRoot, io = {}) {
  const { config, paths } = loadProjectConfig(projectRoot);
  const packs = listPacks();
  const detected = detectTechnologyPacks(paths.projectRoot, packs);
  const selectable = packs.filter((pack) => ['technology', 'stack'].includes(pack.type));
  const defaultStack = detected.find((id) => selectable.find((pack) => pack.id === id)?.type === 'stack')
    ?? detected[0]
    ?? 'undecided';
  const rl = createInterface({
    input: io.input ?? process.stdin,
    output: io.output ?? process.stdout,
    terminal: io.terminal ?? Boolean((io.output ?? process.stdout).isTTY)
  });

  try {
    rl.write('\nEWAI project discovery\n');
    rl.write('Answers become draft SPECS for review; compliance results are triage recommendations only.\n\n');
    if (detected.length) rl.write(`Detected technology packs: ${detected.join(', ')}\n`);

    const name = await askRequired(rl, 'Project name', config.project?.name ?? basename(paths.projectRoot));
    const whyNow = await askRequired(rl, 'Why does this project exist now? What changed or became unacceptable?');
    const purpose = await askRequired(rl, 'What is the project for?');
    const problem = await askRequired(rl, 'What problem or unmet need does it address?');
    const primaryUsers = await askList(rl, 'Who are its primary users? (comma-separated)');
    if (!primaryUsers.length) throw new Error('At least one primary user is required');
    const desiredOutcomes = await askList(rl, 'What outcomes should it create? (comma-separated)');
    if (!desiredOutcomes.length) throw new Error('At least one desired outcome is required');
    const capabilities = await askList(rl, 'Capabilities you already believe are required (comma-separated)');
    const missingCapabilities = await askList(rl, 'What would disappointed users say it cannot do? (comma-separated, optional)');
    const stage = await askEnum(rl, 'Project stage', [...PROJECT_STAGES], 'new');
    const productTypes = await askList(rl, 'Product types (for example web application, API, CLI)');
    const inScope = await askList(rl, 'What is explicitly in scope? (comma-separated)');
    const nonGoals = await askList(rl, 'Known non-goals (comma-separated, optional)');
    const dontTouch = await askList(rl, 'Systems, code, or processes this must not touch (comma-separated, optional)');
    const hardConstraints = await askList(rl, 'Hard constraints that are facts (comma-separated, optional)');
    const softConstraints = await askList(rl, 'Soft constraints or inherited assumptions (comma-separated, optional)');
    const nonNegotiables = await askList(rl, 'Non-negotiable project rules (comma-separated, optional)');
    const successSignals = await askList(rl, 'Observable success signals (comma-separated)', desiredOutcomes);
    const failureSignals = await askList(rl, 'Observable signs the project is quietly failing (comma-separated, optional)');
    const definitionOfReady = await askList(rl, 'What must be true before Build can start? (comma-separated, optional)');
    const definitionOfDone = await askList(rl, 'What evidence is required to call the project done? (comma-separated, optional)');
    const productOwner = await askRequired(rl, 'Who owns product success or failure?', 'Unassigned');
    const deliveryOwner = await askRequired(rl, 'Who owns delivery and quality?', 'Unassigned');
    const technicalOwner = await askRequired(rl, 'Who owns architecture and technical constraints?', 'Unassigned');
    const openQuestions = await askList(rl, 'Open questions that block confident planning (comma-separated, optional)');
    const risks = await askList(rl, 'Important assumptions or failure risks (comma-separated, optional)');
    const oneSentence = await askRequired(rl, 'Describe this project honestly in one sentence', purpose);
    const avoidBecoming = await askRequired(rl, 'What is the one thing you do not want this project to become?', nonGoals[0] ?? 'A solution detached from the real problem');

    rl.write('\nAvailable technology packs:\n');
    for (const pack of selectable) rl.write(`- ${pack.id}: ${pack.name}\n`);
    const stack = await askRequired(rl, 'Select a technology pack ID, custom, or undecided', defaultStack);
    const technologyPacks = ['custom', 'undecided'].includes(stack) ? [] : [stack];
    const customTechnology = stack === 'custom'
      ? await askList(rl, 'Custom technologies (comma-separated)')
      : [];
    const deploymentTarget = await askRequired(rl, 'Expected deployment target', 'undecided');
    const constraints = await askList(rl, 'Technical or delivery constraints (comma-separated, optional)');

    const jurisdictions = await askList(rl, 'Operating and user jurisdictions (comma-separated, unknown is acceptable)');
    const regulatedDomains = await askList(rl, 'Regulated or contract-controlled domains (comma-separated, optional)');
    const dataClassification = await askEnum(rl, 'Highest expected data classification', [...DATA_CLASSIFICATIONS], 'unknown');
    const personalData = await askEnum(rl, 'Will it process personal data?', [...TRI_STATE], 'unknown');
    const sensitiveData = await askEnum(rl, 'Will it process sensitive or specially protected data?', [...TRI_STATE], 'unknown');
    const authentication = await askEnum(rl, 'Will users authenticate?', [...TRI_STATE], 'unknown');
    const multiTenant = await askEnum(rl, 'Will it serve multiple customers or organisations?', [...TRI_STATE], 'unknown');
    const internetFacing = await askEnum(rl, 'Will any service be internet-facing?', [...TRI_STATE], 'unknown');
    const payments = await askEnum(rl, 'Will it accept or process payments?', [...TRI_STATE], 'unknown');
    const aiFeatures = await askEnum(rl, 'Will it use AI-assisted or automated behaviour?', [...TRI_STATE], 'unknown');
    const accessibility = await askEnum(rl, 'Are accessibility obligations expected?', [...TRI_STATE], 'unknown');
    const availability = await askEnum(rl, 'Availability expectation', [...AVAILABILITY_LEVELS], 'standard');
    const configuredProviders = config.validation?.external?.providers ?? {};
    const validationProviders = {};
    for (const provider of VALIDATION_PROVIDERS) {
      const label = `${provider[0].toUpperCase()}${provider.slice(1)}`;
      validationProviders[provider] = await askEnum(
        rl,
        `Is ${label} CLI available for external validation in this project?`,
        [...VALIDATOR_STATES],
        configuredProviders[provider]?.state ?? 'unavailable',
      );
    }

    return discoverProject(paths.projectRoot, {
      schema: ANSWERS_SCHEMA,
      project: {
        name,
        purpose,
        whyNow,
        problem,
        primaryUsers,
        desiredOutcomes,
        capabilities,
        missingCapabilities,
        stage,
        productTypes,
        inScope,
        nonGoals,
        dontTouch,
        hardConstraints,
        softConstraints,
        nonNegotiables,
        successSignals,
        failureSignals,
        definitionOfReady,
        definitionOfDone,
        openQuestions,
        risks,
        oneSentence,
        avoidBecoming,
        ownership: { product: productOwner, delivery: deliveryOwner, technical: technicalOwner }
      },
      delivery: { technologyPacks, customTechnology, deploymentTarget, constraints, detectedPacks: detected },
      assurance: {
        jurisdictions,
        regulatedDomains,
        dataClassification,
        personalData,
        sensitiveData,
        authentication,
        multiTenant,
        internetFacing,
        payments,
        aiFeatures,
        accessibility,
        availability
      },
      validation: {
        providers: validationProviders,
      }
    }, io);
  } finally {
    rl.close();
  }
}
