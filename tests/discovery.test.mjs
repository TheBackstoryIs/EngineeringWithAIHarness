import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import {
  commitProjectDiscovery,
  detectTechnologyPacks,
  discoverProject,
  discoveryQuestionnaire,
  prepareProjectDiscovery
} from '../src/discovery.mjs';
import {
  configureExternalValidation,
  externalValidationStatus,
  initProject,
  loadProjectConfig
} from '../src/project.mjs';
import { listPersonas, projectPersonaRoot } from '../src/personas.mjs';
import { readLifecycleHookWorkspace } from '../src/runtime/lifecycle-hooks.mjs';

function writeOrganisationBlueprint(root) {
  const directory = resolve(root, 'northstar-engineering');
  const manifest = {
    schema: 'ewai.pack/v1',
    id: 'org.northstar.engineering',
    name: 'Northstar Engineering Baseline',
    description: 'Reviewed organisation conventions.',
    version: '1.2.0',
    type: 'organisation',
    requires: [],
    blueprint: {
      publisher: { id: 'northstar', name: 'Northstar Digital' },
      compatibility: { ewai: '0.x' },
      modules: [
        {
          id: 'api-conventions',
          name: 'API conventions',
          description: 'Authentication and endpoint rules.',
          required: true,
          standards: [{ id: 'api-contract', title: 'API contract', source: 'standards/api.md' }],
          personas: [{ id: 'api-governance-lead', name: 'API Governance Lead', source: 'personas/api.md' }],
          boilerplates: [{
            id: 'api-service',
            name: 'Reviewed API service',
            source: 'https://example.invalid/api-service',
            version: '3.1.0',
            digest: `sha256:${'a'.repeat(64)}`,
            licence: 'MIT',
            compatibility: 'Node 22'
          }]
        },
        {
          id: 'delivery-assurance',
          name: 'Delivery assurance',
          description: 'Release and handover evidence.',
          required: false,
          standards: [{ id: 'release-readiness', title: 'Release readiness', source: 'standards/release.md' }],
          personas: [],
          boilerplates: []
        }
      ]
    }
  };
  const files = {
    'pack.yaml': YAML.stringify(manifest, { lineWidth: 0 }),
    'standards/api.md': '# API contract\n\nUse explicit compatibility rules.\n',
    'standards/release.md': '# Release readiness\n\nKeep review evidence.\n',
    'personas/api.md': '---\nname: API Governance Lead\ndescription: Applies project API conventions.\ncategory: architecture\ntags: [api, governance]\ncapabilities: [api-review]\n---\n\n# API Governance Lead\n\nChallenge API decisions against the organisation baseline.\n'
  };
  for (const [relative, content] of Object.entries(files)) {
    const path = resolve(directory, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return { directory, roots: [{ path: root, sourceClass: 'project' }] };
}

function answers(overrides = {}) {
  return {
    schema: 'ewai.discovery-answers/v1',
    project: {
      name: 'Discovery Test',
      whyNow: 'Manual delivery became unreliable.',
      purpose: 'Give operators a reliable delivery workflow.',
      problem: 'Operators cannot see or reproduce delivery state.',
      primaryUsers: ['Service operator'],
      desiredOutcomes: ['A repeatable delivery completes with reviewable evidence'],
      inScope: ['Project-local delivery workflow'],
      capabilities: ['Intent capture', 'Task tracking'],
      nonGoals: ['Hosting customer applications'],
      dontTouch: ['Customer production credentials'],
      hardConstraints: ['Project truth remains reviewable in Git'],
      successSignals: ['A new operator can complete a delivery'],
      failureSignals: ['Delivery state depends on chat history'],
      definitionOfDone: ['Manual QA passes', 'Retro is complete'],
      oneSentence: 'A portable evidence-led delivery workflow.',
      ownership: {
        product: 'Product owner',
        delivery: 'Delivery lead',
        technical: 'Technical lead'
      },
      ...overrides.project
    },
    delivery: {
      technologyPacks: ['ewai.stack.laravel-nuxt'],
      deploymentTarget: 'Managed cloud platform',
      constraints: [],
      ...overrides.delivery
    },
    assurance: {
      jurisdictions: ['United Kingdom'],
      dataClassification: 'confidential',
      personalData: 'yes',
      sensitiveData: 'unknown',
      authentication: 'yes',
      multiTenant: 'yes',
      internetFacing: 'yes',
      payments: 'no',
      aiFeatures: 'no',
      accessibility: 'yes',
      availability: 'standard',
      ...overrides.assurance
    },
    validation: {
      codex: 'available',
      antigravity: 'unavailable',
      ...overrides.validation
    }
  };
}

test('writes project discovery into the canonical SPECS artefacts', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-discovery-'));
  try {
    initProject(root, { name: 'Discovery Test' });
    const result = discoverProject(root, answers(), {
      now: '2026-07-15T12:00:00.000Z',
      personas: [
        { ref: 'ewai.core.end-user', engagementReason: 'Represents the operator completing Discovery.' },
        { ref: 'ewai.premium.product-owner', tier: 'premium', engagementReason: 'Challenges the outcome and scope.' },
      ],
    });
    const expected = [
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
    assert.equal(result.created.length, expected.length);
    for (const relative of expected) assert.equal(existsSync(resolve(root, 'SPECS', relative)), true);

    const constraints = readFileSync(resolve(root, 'SPECS/4.Constraints/project-constraints.md'), 'utf8');
    const compliance = readFileSync(resolve(root, 'SPECS/3.Evidence/risk/compliance-applicability.md'), 'utf8');
    assert.match(constraints, /Project truth remains reviewable in Git/);
    assert.match(constraints, /Candidate obligations remain/);
    assert.match(compliance, /not legal advice, certification, or a declaration of compliance/);

    const { config } = loadProjectConfig(root);
    assert.deepEqual(config.packs, [
      'ewai.core',
      'ewai.technology.laravel',
      'ewai.technology.nuxt',
      'ewai.stack.laravel-nuxt'
    ]);
    assert.deepEqual(config.validation.external.providers.codex, {
      state: 'available',
      enabled: true
    });
    assert.deepEqual(config.validation.external.providers.antigravity, {
      state: 'unavailable',
      enabled: false
    });
    assert.equal(config.validation.standards.required, true);
    assert.equal(config.validation.standards.allow_waiver, false);
    const lifecycle = readLifecycleHookWorkspace(root);
    assert.deepEqual(lifecycle.events.map((event) => event.name), ['ewai.project.discovery.completed']);
    assert.deepEqual(lifecycle.events[0].personas.map(({ id, tier }) => ({ id, tier })), [
      { id: 'ewai.core.end-user', tier: 'core' },
      { id: 'ewai.premium.product-owner', tier: 'premium' },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('publishes one versioned discovery questionnaire for CLI and browser adapters', () => {
  const questionnaire = discoveryQuestionnaire();
  assert.equal(questionnaire.schema, 'ewai.discovery-questionnaire/v1');
  assert.deepEqual(questionnaire.sections.map((section) => section.id), [
    'purpose', 'people', 'outcomes', 'scope', 'delivery', 'assurance', 'review'
  ]);
  const questions = questionnaire.sections.flatMap((section) => section.questions);
  const requiredPaths = [
    'project.name', 'project.purpose', 'project.problem',
    'project.primaryUsers', 'project.desiredOutcomes'
  ];
  for (const path of requiredPaths) {
    assert.equal(questions.some((question) => question.answerPath === path && question.required), true);
  }
  for (const section of questionnaire.sections) {
    assert.equal(section.perspectiveSignals.length > 0, true);
  }
  const firstQuestion = questionnaire.sections[0].questions[0];
  firstQuestion.label = 'Changed outside the contract';
  assert.notEqual(discoveryQuestionnaire().sections[0].questions[0].label, firstQuestion.label);
});

test('prepares an exact discovery preview without writing canonical files', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-discovery-prepare-'));
  try {
    initProject(root, { name: 'Discovery Test' });
    const prepared = prepareProjectDiscovery(root, answers(), { now: '2026-07-15T12:00:00.000Z' });
    assert.equal(prepared.schema, 'ewai.prepared-project-discovery/v1');
    assert.equal(prepared.outputs.length, 10);
    assert.match(prepared.outputs.find((output) => output.relative === '1.Scope/context.md').content, /A portable evidence-led delivery workflow/);
    assert.equal(prepared.outputs.every((output) => output.exists === false), true);
    assert.equal(existsSync(resolve(root, 'SPECS/1.Scope/context.md')), false);

    const committed = commitProjectDiscovery(root, prepared, {
      approvedBy: 'Test Owner',
      approvedAt: '2026-07-15T12:05:00.000Z'
    });
    assert.equal(committed.created.length, 10);
    assert.equal(committed.approval.approvedBy, 'Test Owner');
    assert.equal(readFileSync(resolve(root, 'SPECS/1.Scope/context.md'), 'utf8'), prepared.outputs.find((output) => output.relative === '1.Scope/context.md').content);
    const { config } = loadProjectConfig(root);
    assert.equal(config.project.discovery.approved_by, 'Test Owner');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('previews and atomically applies a selected organisation blueprint', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-discovery-blueprint-'));
  const packsRoot = mkdtempSync(resolve(tmpdir(), 'ewai-discovery-blueprint-packs-'));
  try {
    initProject(root, { name: 'Discovery Test' });
    const { roots } = writeOrganisationBlueprint(packsRoot);
    const prepared = prepareProjectDiscovery(root, answers({
      delivery: {
        organisationBlueprint: {
          packId: 'org.northstar.engineering',
          enabledModules: ['delivery-assurance']
        }
      }
    }), {
      now: '2026-08-16T10:00:00.000Z',
      organisationBlueprintRoots: roots
    });

    assert.equal(prepared.outputs.length, 14);
    assert.equal(prepared.organisationBlueprint.root.id, 'org.northstar.engineering');
    assert.deepEqual(prepared.organisationBlueprint.enabledModules, ['delivery-assurance']);
    assert.equal(JSON.stringify(prepared.organisationBlueprint).includes(packsRoot), false);
    assert.equal(JSON.stringify(prepared.organisationBlueprint).includes('Challenge API decisions'), false);
    assert.equal(prepared.outputs.every((output) => !existsSync(output.path)), true);

    const result = commitProjectDiscovery(root, prepared, {
      approvedBy: 'Platform Owner',
      approvedAt: '2026-08-16T10:05:00.000Z',
      organisationBlueprintRoots: roots
    });
    assert.equal(result.created.length, 14);
    assert.equal(result.organisationBlueprint.root.id, 'org.northstar.engineering');
    const standardPath = resolve(root, 'SPECS/4.Constraints/standards/organisation/northstar/engineering/api-conventions/api-contract.md');
    const optionalStandardPath = resolve(root, 'SPECS/4.Constraints/standards/organisation/northstar/engineering/delivery-assurance/release-readiness.md');
    const personaPath = resolve(root, 'SPECS/1.Scope/personas/project/northstar-api-governance-lead.md');
    const receiptPath = resolve(root, 'SPECS/5.Strategy/organisation-blueprint.md');
    assert.match(readFileSync(standardPath, 'utf8'), /Use explicit compatibility rules/);
    assert.match(readFileSync(standardPath, 'utf8'), /approved_by: Platform Owner/);
    assert.match(readFileSync(optionalStandardPath, 'utf8'), /Keep review evidence/);
    assert.match(readFileSync(personaPath, 'utf8'), /id: project\.northstar\.api-governance-lead/);
    assert.match(readFileSync(personaPath, 'utf8'), /approved_at: 2026-08-16T10:05:00.000Z/);
    assert.match(readFileSync(receiptPath, 'utf8'), /Platform Owner/);
    assert.match(readFileSync(receiptPath, 'utf8'), /Reviewed API service/);
    const projectPersonas = listPersonas([projectPersonaRoot(root)]);
    assert.equal(projectPersonas.some((persona) => persona.id === 'project.northstar.api-governance-lead' && persona.tier === 'project'), true);

    const { config } = loadProjectConfig(root);
    assert.equal(config.blueprints.organisation.root.id, 'org.northstar.engineering');
    assert.equal(config.blueprints.organisation.approved_by, 'Platform Owner');
    assert.deepEqual(config.blueprints.organisation.enabled_modules, ['delivery-assurance']);
    assert.equal(config.packs.includes('org.northstar.engineering'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(packsRoot, { recursive: true, force: true });
  }
});

test('blocks organisation blueprint drift before writing any discovery output', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-discovery-blueprint-drift-'));
  const packsRoot = mkdtempSync(resolve(tmpdir(), 'ewai-discovery-blueprint-drift-packs-'));
  try {
    initProject(root, { name: 'Discovery Test' });
    const { directory, roots } = writeOrganisationBlueprint(packsRoot);
    const prepared = prepareProjectDiscovery(root, answers({
      delivery: { organisationBlueprint: { packId: 'org.northstar.engineering', enabledModules: [] } }
    }), { organisationBlueprintRoots: roots });
    writeFileSync(resolve(directory, 'standards/api.md'), '# API contract\n\nChanged after review.\n');

    assert.throws(() => commitProjectDiscovery(root, prepared, {
      approvedBy: 'Platform Owner',
      organisationBlueprintRoots: roots
    }), /changed since preview|digest/i);
    assert.equal(prepared.outputs.some((output) => existsSync(output.path)), false);
    assert.equal(loadProjectConfig(root).config.project.discovery, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(packsRoot, { recursive: true, force: true });
  }
});

test('requires a named owner and surfaces blueprint destination conflicts before commit', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-discovery-blueprint-conflict-'));
  const packsRoot = mkdtempSync(resolve(tmpdir(), 'ewai-discovery-blueprint-conflict-packs-'));
  try {
    initProject(root, { name: 'Discovery Test' });
    const { roots } = writeOrganisationBlueprint(packsRoot);
    const personaPath = resolve(root, 'SPECS/1.Scope/personas/project/northstar-api-governance-lead.md');
    mkdirSync(dirname(personaPath), { recursive: true });
    writeFileSync(personaPath, '# Existing project persona\n');
    const prepared = prepareProjectDiscovery(root, answers({
      delivery: { organisationBlueprint: { packId: 'org.northstar.engineering', enabledModules: [] } }
    }), { organisationBlueprintRoots: roots });
    assert.equal(prepared.conflicts.includes('1.Scope/personas/project/northstar-api-governance-lead.md'), true);
    assert.throws(
      () => commitProjectDiscovery(root, prepared, { organisationBlueprintRoots: roots }),
      /approver name/i
    );
    assert.throws(
      () => commitProjectDiscovery(root, prepared, { approvedBy: 'Platform Owner', organisationBlueprintRoots: roots }),
      /already exist/i
    );
    assert.equal(readFileSync(personaPath, 'utf8'), '# Existing project persona\n');
    assert.equal(existsSync(resolve(root, 'SPECS/1.Scope/context.md')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(packsRoot, { recursive: true, force: true });
  }
});

test('rolls back blueprint outputs when a late materialisation write fails', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-discovery-blueprint-rollback-'));
  const packsRoot = mkdtempSync(resolve(tmpdir(), 'ewai-discovery-blueprint-rollback-packs-'));
  try {
    initProject(root, { name: 'Discovery Test' });
    const { roots } = writeOrganisationBlueprint(packsRoot);
    const prepared = prepareProjectDiscovery(root, answers({
      delivery: { organisationBlueprint: { packId: 'org.northstar.engineering', enabledModules: ['delivery-assurance'] } }
    }), { organisationBlueprintRoots: roots });
    let writes = 0;
    assert.throws(() => commitProjectDiscovery(root, prepared, {
      approvedBy: 'Platform Owner',
      organisationBlueprintRoots: roots,
      writeFile(path, content, encoding) {
        writes += 1;
        writeFileSync(path, content, encoding);
        if (writes === 14) throw new Error('Injected blueprint receipt failure');
      }
    }), /Injected blueprint receipt failure/);
    assert.equal(prepared.outputs.some((output) => existsSync(output.path)), false);
    assert.equal(loadProjectConfig(root).config.blueprints, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(packsRoot, { recursive: true, force: true });
  }
});

test('rejects symbolic-link indirection at a canonical blueprint destination', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-discovery-blueprint-symlink-'));
  const packsRoot = mkdtempSync(resolve(tmpdir(), 'ewai-discovery-blueprint-symlink-packs-'));
  try {
    initProject(root, { name: 'Discovery Test' });
    const { roots } = writeOrganisationBlueprint(packsRoot);
    const outside = resolve(root, 'outside-persona.md');
    const personaPath = resolve(root, 'SPECS/1.Scope/personas/project/northstar-api-governance-lead.md');
    writeFileSync(outside, '# Outside\n');
    symlinkSync(outside, personaPath);
    assert.throws(() => prepareProjectDiscovery(root, answers({
      delivery: { organisationBlueprint: { packId: 'org.northstar.engineering', enabledModules: [] } }
    }), { organisationBlueprintRoots: roots }), /destination.*symbolic link/i);
    assert.equal(readFileSync(outside, 'utf8'), '# Outside\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(packsRoot, { recursive: true, force: true });
  }
});

test('rolls back request-time discovery outputs when commit fails', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-discovery-rollback-'));
  try {
    initProject(root, { name: 'Discovery Test' });
    const prepared = prepareProjectDiscovery(root, answers(), { now: '2026-07-15T12:00:00.000Z' });
    let writes = 0;
    assert.throws(() => commitProjectDiscovery(root, prepared, {
      approvedBy: 'Test Owner',
      approvedAt: '2026-07-15T12:05:00.000Z',
      writeFile(path, content, encoding) {
        writes += 1;
        if (writes === 4) throw new Error('Injected write failure');
        writeFileSync(path, content, encoding);
      }
    }), /Injected write failure/);
    assert.equal(prepared.outputs.some((output) => existsSync(output.path)), false);
    const { config } = loadProjectConfig(root);
    assert.equal(config.project.discovery, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('restores overwritten discovery outputs when a forced commit fails', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-discovery-force-rollback-'));
  try {
    initProject(root, { name: 'Discovery Test' });
    discoverProject(root, answers(), { now: '2026-07-15T11:00:00.000Z' });
    const contextPath = resolve(root, 'SPECS/1.Scope/context.md');
    const originalContext = readFileSync(contextPath, 'utf8');
    const prepared = prepareProjectDiscovery(root, answers({
      project: { oneSentence: 'A changed discovery that must be rolled back.' }
    }), { now: '2026-07-15T12:00:00.000Z' });
    let writes = 0;

    assert.throws(() => commitProjectDiscovery(root, prepared, {
      force: true,
      approvedBy: 'Test Owner',
      writeFile(path, content, encoding) {
        writes += 1;
        if (writes === 4) throw new Error('Injected forced write failure');
        writeFileSync(path, content, encoding);
      }
    }), /Injected forced write failure/);

    assert.equal(readFileSync(contextPath, 'utf8'), originalContext);
    const { config } = loadProjectConfig(root);
    assert.equal(config.project.discovery.completed_at, '2026-07-15T11:00:00.000Z');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a prepared discovery with duplicate output destinations', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-discovery-contract-'));
  try {
    initProject(root, { name: 'Discovery Test' });
    const prepared = prepareProjectDiscovery(root, answers());
    prepared.outputs[prepared.outputs.length - 1] = { ...prepared.outputs[0] };
    assert.throws(
      () => commitProjectDiscovery(root, prepared),
      /Prepared discovery output contract is incomplete or invalid/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses to overwrite discovery SPECS without force', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-discovery-preserve-'));
  try {
    initProject(root, { name: 'Discovery Test' });
    discoverProject(root, answers());
    assert.throws(() => discoverProject(root, answers()), /Discovery outputs already exist/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('detects technology packs without selecting them automatically', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-discovery-detect-'));
  try {
    writeFileSync(resolve(root, 'nuxt.config.ts'), 'export default defineNuxtConfig({})\n');
    writeFileSync(resolve(root, 'package.json'), '{"dependencies":{"nuxt":"^4.0.0"}}\n');
    assert.deepEqual(detectTechnologyPacks(root), ['ewai.technology.nuxt']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('captures validator availability at init and allows later project-local updates', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-validation-'));
  try {
    initProject(root, { name: 'Validation Test', validators: ['codex'] });
    let { config } = loadProjectConfig(root);
    assert.deepEqual(externalValidationStatus(config), [
      {
        validator: 'claude',
        state: 'unavailable',
        enabled: false,
        selected: false,
        excluded_as_orchestrator: false
      },
      {
        validator: 'codex',
        state: 'available',
        enabled: true,
        selected: true,
        excluded_as_orchestrator: false
      },
      {
        validator: 'antigravity',
        state: 'unavailable',
        enabled: false,
        selected: false,
        excluded_as_orchestrator: false
      }
    ]);

    configureExternalValidation(root, 'antigravity', 'available');
    ({ config } = loadProjectConfig(root));
    assert.deepEqual(config.validation.external.providers.antigravity, {
      state: 'available',
      enabled: true
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
