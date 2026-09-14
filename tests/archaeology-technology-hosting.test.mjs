import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import YAML from 'yaml';
import {
  prepareArchaeologyTechnologyHosting,
  readArchaeologyTechnologyHosting,
  recordArchaeologyTechnologyHosting
} from '../src/archaeology.mjs';
import { initProject } from '../src/project.mjs';
import { ASSURANCE_NOTICE } from '../src/security-validation-config.mjs';

const passes = [
  'purpose-and-actors', 'user-processes', 'domain-and-data', 'architecture-and-integrations',
  'security-and-trust', 'operations-and-assurance', 'code-quality'
];

function writeYaml(path, value) {
  writeFileSync(path, YAML.stringify(value, { lineWidth: 0 }), 'utf8');
}

function setupBundle(root) {
  initProject(root, { name: 'Technology Hosting Project' });
  const bundle = resolve(root, 'SPECS/3.Evidence/archaeology/2026-08-23-baseline');
  mkdirSync(bundle, { recursive: true });
  const inventory = [
    { id: 'ewai.core.archaeologist', name: 'EWAI Archaeologist', tier: 'core', category: 'engineering', description: 'Reconstructs technology and deployment evidence.', tags: ['archaeology', 'technology'], capabilities: ['project-archaeology'] },
    { id: 'ewai.core.specs-knowledge-curator', name: 'SPECS Knowledge Curator', tier: 'core', category: 'information-management', description: 'Routes reviewed project knowledge.', tags: ['knowledge'], capabilities: ['specs-routing'] },
    { id: 'premium.cloud-architect', name: 'Cloud Architect', tier: 'premium', category: 'architecture', description: 'Challenges cloud, infrastructure, platform and region choices.', tags: ['cloud', 'hosting', 'infrastructure'], capabilities: ['architecture'] },
    { id: 'project.service-operator', name: 'Project Service Operator', tier: 'project', category: 'operations', description: 'Challenges environment, deployment, recovery and operating ownership.', tags: ['hosting', 'operations', 'deployment'], capabilities: ['service-operations'] }
  ];
  writeYaml(resolve(bundle, 'persona-routing.yaml'), {
    schema: 'ewai.archaeology-persona-routing/v1', status: 'confirmed',
    library_summary: { total: inventory.length, by_tier: { core: 2, premium: 1, project: 1 } },
    baseline_personas: ['ewai.core.archaeologist', 'ewai.core.specs-knowledge-curator'], inventory,
    reconnaissance: { status: 'complete', summary: 'Repository evidence includes application manifests, cloud descriptors and deployment configuration requiring current-state confirmation.', evidence: ['package.json', 'infra/main.tf'] },
    assessments: passes.map((pass) => ({ pass, status: 'assessed', recommended_personas: pass === 'architecture-and-integrations' ? ['premium.cloud-architect', 'project.service-operator'] : ['ewai.core.archaeologist'], rationale: `Repository evidence makes the ${pass} lens relevant to technology and hosting reconstruction.`, expected_benefit: `The selected perspective improves evidence questions and contradiction detection for ${pass}.`, perspective_gaps: [] })),
    assignments: [
      { persona: 'premium.cloud-architect', pass: 'architecture-and-integrations', role: 'consulted', contribution: 'Challenge provider, platform, region and infrastructure evidence.' },
      { persona: 'project.service-operator', pass: 'operations-and-assurance', role: 'consulted', contribution: 'Challenge environments, deployment paths and operating ownership.' }
    ],
    user_review: { presented_to_user: true, presented_summary: 'Use the cloud architect and project operator for technology and hosting.', status: 'confirmed', selected_personas: ['premium.cloud-architect', 'project.service-operator'], decided_by: 'Project owner', decided_at: '2026-08-23T18:00:00.000Z', notes: '' }
  });
  return bundle;
}

function repositoryEvidence(stale = false) {
  return {
    runId: 91,
    freshness: { status: stale ? 'stale' : 'fresh', stale, runId: 91, summary: { tracked: 8, current: 8, changed: stale ? 1 : 0, missing: 0, deleted: 0 } },
    coverage: { warnings: ['One binary file is inventory-only.'], outcomes: { analysed: 7, inventory_only: 1 } },
    files: [
      { repository: 'api', path: 'package.json', language: 'JSON', classification: 'structured-data', profileId: 'core-structured-json', analyser: 'structured-keys', analysisOutcome: 'analysed' },
      { repository: 'api', path: 'Dockerfile', language: 'Dockerfile', classification: 'source-code', profileId: 'core-shallow-source', analyser: 'text-summary', analysisOutcome: 'analysed' },
      { repository: 'api', path: '.github/workflows/release.yml', language: 'YAML', classification: 'structured-data', profileId: 'core-structured-yaml', analyser: 'structured-keys', analysisOutcome: 'analysed' },
      { repository: 'infrastructure', path: 'infra/main.tf', language: 'Terraform', classification: 'source-code', profileId: 'technology-terraform', analyser: 'text-summary', analysisOutcome: 'analysed' },
      { repository: 'infrastructure', path: 'azure.yaml', language: 'YAML', classification: 'structured-data', profileId: 'technology-azure', analyser: 'structured-keys', analysisOutcome: 'analysed' },
      { repository: 'crm', path: 'sfdx-project.json', language: 'JSON', classification: 'structured-data', profileId: 'salesforce-project', analyser: 'salesforce-metadata', analysisOutcome: 'analysed' },
      { repository: 'apps', path: 'PowerApps/Sales.msapp', language: '', classification: 'binary', profileId: 'power-platform-app', analyser: 'power-platform-metadata', analysisOutcome: 'inventory_only' },
      { repository: 'specialist', path: 'platform/service.custom', language: '', classification: 'configuration', profileId: 'project-specialist-platform', analyser: 'text-summary', analysisOutcome: 'analysed' }
    ]
  };
}

test('prepares fresh multi-repository signals, hosting questions and visible assigned personas', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-tech-hosting-'));
  try {
    const bundle = setupBundle(root);
    const result = prepareArchaeologyTechnologyHosting(root, bundle, { repositoryEvidence: repositoryEvidence(), now: '2026-08-23T19:00:00.000Z' });
    assert.equal(result.schema, 'ewai.archaeology-technology-hosting-preparation/v1');
    assert.equal(result.status, 'awaiting-owner-answers');
    assert.equal(result.brief.sourceMap.runId, 91);
    assert.equal(result.brief.observations.some((item) => item.repository === 'infrastructure' && item.candidate === 'Microsoft Azure'), true);
    assert.equal(result.brief.observations.some((item) => item.repository === 'crm' && item.candidate === 'Salesforce'), true);
    assert.equal(result.brief.observations.some((item) => item.repository === 'apps' && item.candidate === 'Microsoft Power Platform'), true);
    assert.equal(result.brief.observations.some((item) => item.repository === 'specialist' && item.candidate === 'project-specialist-platform'), true);
    assert.equal(result.brief.observations.every((item) => item.provenance === 'repository-observed'), true);
    assert.equal(result.brief.observations.every((item) => /does not prove current runtime/i.test(item.limitation)), true);
    assert.deepEqual(new Set(result.brief.activePersonas.map((item) => item.tier)), new Set(['core', 'premium', 'project']));
    assert.equal(result.brief.activePersonas.every((item) => item.engagementReason), true);
    for (const question of ['actual-technology', 'provider', 'platform-service', 'locations', 'environments', 'deployment-model', 'operating-model', 'data-residency', 'release-route', 'inactive-signals', 'contradictions', 'unresolved']) {
      assert.equal(result.brief.questions.some((item) => item.id === question), true, question);
    }
    assert.equal(result.brief.notices.includes(ASSURANCE_NOTICE), true);
    assert.equal(existsSync(resolve(bundle, 'technology-hosting-brief.json')), true);
    assert.equal(existsSync(resolve(bundle, 'technology-hosting-answers.template.json')), true);
    assert.equal(existsSync(resolve(bundle, 'technology-hosting-brief.md')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses stale repository evidence without writing a partial briefing', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-tech-hosting-stale-'));
  try {
    const bundle = setupBundle(root);
    assert.throws(() => prepareArchaeologyTechnologyHosting(root, bundle, { repositoryEvidence: repositoryEvidence(true) }), /refresh.*Source Map/i);
    assert.equal(existsSync(resolve(bundle, 'technology-hosting-brief.json')), false);
    assert.equal(existsSync(resolve(bundle, 'technology-hosting-answers.template.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('records declarations and confirmations separately while preserving contradictions and questions', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-tech-hosting-profile-'));
  try {
    const bundle = setupBundle(root);
    const preparation = prepareArchaeologyTechnologyHosting(root, bundle, { repositoryEvidence: repositoryEvidence(), now: '2026-08-23T19:00:00.000Z' });
    const azureObservation = preparation.brief.observations.find((item) => item.candidate === 'Microsoft Azure');
    const input = {
      schema: 'ewai.archaeology-technology-hosting-answers/v1',
      preparedDigest: preparation.brief.digest,
      technology: [
        { category: 'runtime', name: 'Node.js', version: '22', confirmed: true, observationRefs: preparation.brief.observations.filter((item) => item.candidate === 'Node.js').map((item) => item.id), evidence: ['Project owner interview'], notes: 'Current application runtime.' },
        { category: 'data-store', name: 'PostgreSQL', version: '16', confirmed: false, observationRefs: [], evidence: ['Architecture discussion'], notes: 'Owner declaration awaiting platform confirmation.' }
      ],
      hosting: {
        provider: { value: 'Amazon Web Services', confirmed: true, observationRefs: [azureObservation.id], evidence: ['Platform owner confirmation'], notes: 'Azure descriptor is retained from a retired deployment experiment.' },
        platformService: { value: 'ECS Fargate', confirmed: true, observationRefs: [], evidence: ['Platform owner confirmation'], notes: '' },
        locations: [{ value: 'eu-west-2', confirmed: true, observationRefs: [], evidence: ['Platform owner confirmation'], notes: 'Primary region.' }],
        environments: [{ name: 'production', provider: 'Amazon Web Services', platformService: 'ECS Fargate', location: 'eu-west-2', deploymentModel: 'cloud', operatingModel: 'self-managed', confirmed: true, observationRefs: [], evidence: ['Platform owner confirmation'], notes: '' }],
        deploymentModel: { value: 'cloud', confirmed: true, observationRefs: [], evidence: ['Platform owner confirmation'], notes: '' },
        operatingModel: { value: 'self-managed', confirmed: true, observationRefs: [], evidence: ['Platform owner confirmation'], notes: '' },
        dataResidency: { value: 'United Kingdom', confirmed: false, observationRefs: [], evidence: ['Policy draft'], notes: 'Requires privacy-owner confirmation.' },
        releaseRoute: { value: 'GitHub Actions to ECS', confirmed: true, observationRefs: [], evidence: ['Platform owner confirmation'], notes: '' },
        operatingOwner: { value: 'Platform team', confirmed: true, observationRefs: [], evidence: ['Platform owner confirmation'], notes: '' }
      },
      observationReviews: [{ observationId: azureObservation.id, status: 'inactive', notes: 'Retired experiment retained for history.' }],
      contradictions: [{ summary: 'Repository includes Azure configuration while production is confirmed on AWS.', observationRefs: [azureObservation.id], notes: 'Resolve the lifecycle and removal decision separately.' }],
      unresolvedQuestions: ['Who approves the final data-residency statement?']
    };
    const result = recordArchaeologyTechnologyHosting(root, bundle, input, { reviewedBy: 'Andre Boyle', now: '2026-08-23T20:00:00.000Z' });
    assert.equal(result.status, 'recorded');
    assert.equal(result.profile.technology.find((item) => item.name === 'Node.js').provenance, 'human-confirmed');
    assert.equal(result.profile.technology.find((item) => item.name === 'PostgreSQL').provenance, 'owner-declared');
    assert.equal(result.profile.hosting.dataResidency.provenance, 'owner-declared');
    assert.equal(result.profile.hosting.provider.provenance, 'human-confirmed');
    assert.equal(result.profile.contradictions.length >= 1, true);
    assert.deepEqual(result.profile.unresolvedQuestions, ['Who approves the final data-residency statement?']);
    assert.equal(result.profile.review.reviewedBy, 'Andre Boyle');
    assert.equal(result.profile.notices.includes(ASSURANCE_NOTICE), true);
    assert.equal(existsSync(resolve(bundle, 'technology-hosting-profile.json')), true);
    assert.equal(existsSync(resolve(bundle, 'technology-hosting-profile.md')), true);
    assert.equal(existsSync(resolve(root, 'SPECS/5.Strategy/architecture/stack.md')), false);
    const workspace = readArchaeologyTechnologyHosting(root, bundle, { repositoryEvidence: repositoryEvidence() });
    assert.equal(workspace.status, 'recorded');
    assert.equal(workspace.profile.digest, result.profile.digest);
    assert.match(readFileSync(resolve(bundle, 'technology-hosting-profile.md'), 'utf8'), /repository-observed.*owner-declared.*human-confirmed/is);
    assert.match(readFileSync(resolve(bundle, 'technology-hosting-profile.md'), 'utf8'), /Security validation is evidence/);
    assert.throws(() => recordArchaeologyTechnologyHosting(root, bundle, input, { reviewedBy: 'Another reviewer' }), /already exists/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects invalid observation references and unsupported deployment vocabularies', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-tech-hosting-invalid-'));
  try {
    const bundle = setupBundle(root);
    const preparation = prepareArchaeologyTechnologyHosting(root, bundle, { repositoryEvidence: repositoryEvidence() });
    const knownObservation = preparation.brief.observations.find((item) => item.candidate === 'Node.js');
    const unsupportedConfirmation = {
      schema: 'ewai.archaeology-technology-hosting-answers/v1', preparedDigest: preparation.brief.digest,
      technology: [{ category: 'runtime', name: 'Node.js', version: '22', confirmed: true, observationRefs: [knownObservation.id], evidence: [], notes: '' }],
      hosting: { provider: { value: 'unknown', confirmed: false }, platformService: { value: 'unknown', confirmed: false }, locations: [], environments: [], deploymentModel: { value: 'unknown', confirmed: false }, operatingModel: { value: 'unknown', confirmed: false }, dataResidency: { value: 'unknown', confirmed: false }, releaseRoute: { value: 'unknown', confirmed: false }, operatingOwner: { value: 'unknown', confirmed: false } },
      observationReviews: [], contradictions: [], unresolvedQuestions: []
    };
    assert.throws(() => recordArchaeologyTechnologyHosting(root, bundle, unsupportedConfirmation, { reviewedBy: 'Owner' }), /requires evidence.*human-confirmed/i);
    const input = {
      schema: 'ewai.archaeology-technology-hosting-answers/v1', preparedDigest: preparation.brief.digest,
      technology: [{ category: 'runtime', name: 'Node.js', version: '22', confirmed: true, observationRefs: ['ATH-OBS-999'], evidence: [], notes: '' }],
      hosting: { provider: { value: 'unknown', confirmed: false }, platformService: { value: 'unknown', confirmed: false }, locations: [], environments: [], deploymentModel: { value: 'telepathy', confirmed: false }, operatingModel: { value: 'unknown', confirmed: false }, dataResidency: { value: 'unknown', confirmed: false }, releaseRoute: { value: 'unknown', confirmed: false }, operatingOwner: { value: 'unknown', confirmed: false } },
      observationReviews: [], contradictions: [], unresolvedQuestions: []
    };
    assert.throws(() => recordArchaeologyTechnologyHosting(root, bundle, input, { reviewedBy: 'Owner' }), /observation reference|deployment model/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
