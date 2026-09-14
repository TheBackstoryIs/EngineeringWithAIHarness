import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { initProject } from '../src/project.mjs';
import { refreshRepositoryIndex } from '../src/runtime/repository-index.mjs';
import { ASSURANCE_NOTICE } from '../src/security-validation-config.mjs';

const cli = resolve(import.meta.dirname, '../bin/ewai');
const passes = [
  'purpose-and-actors', 'user-processes', 'domain-and-data', 'architecture-and-integrations',
  'security-and-trust', 'operations-and-assurance', 'code-quality'
];

function runCli(root, args) {
  return spawnSync(process.execPath, [cli, ...args, '--project', root], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  });
}

function setup(root) {
  initProject(root, { name: 'Technology Hosting CLI Test' });
  writeFileSync(resolve(root, 'package.json'), '{"name":"technology-hosting-cli-test"}\n', 'utf8');
  writeFileSync(resolve(root, 'azure.yaml'), 'name: technology-hosting-cli-test\n', 'utf8');
  mkdirSync(resolve(root, '.github/workflows'), { recursive: true });
  writeFileSync(resolve(root, '.github/workflows/release.yml'), 'name: release\n', 'utf8');
  const bundle = resolve(root, 'SPECS/3.Evidence/archaeology/cli-baseline');
  mkdirSync(bundle, { recursive: true });
  const inventory = [
    { id: 'ewai.core.archaeologist', name: 'EWAI Archaeologist', tier: 'core', category: 'engineering', description: 'Reconstructs project evidence.', tags: ['archaeology'], capabilities: ['project-archaeology'] },
    { id: 'ewai.core.specs-knowledge-curator', name: 'SPECS Knowledge Curator', tier: 'core', category: 'information-management', description: 'Routes reviewed knowledge.', tags: ['knowledge'], capabilities: ['specs-routing'] },
    { id: 'project.platform-owner', name: 'Platform Owner', tier: 'project', category: 'operations', description: 'Confirms hosting and deployment operation.', tags: ['hosting', 'deployment'], capabilities: ['service-operations'] }
  ];
  writeFileSync(resolve(bundle, 'persona-routing.yaml'), YAML.stringify({
    schema: 'ewai.archaeology-persona-routing/v1', status: 'confirmed',
    library_summary: { total: inventory.length, by_tier: { core: 2, project: 1 } },
    baseline_personas: ['ewai.core.archaeologist', 'ewai.core.specs-knowledge-curator'], inventory,
    reconnaissance: { status: 'complete', summary: 'The repository contains application and deployment descriptors requiring accountable confirmation.', evidence: ['package.json', 'azure.yaml'] },
    assessments: passes.map((pass) => ({ pass, status: 'assessed', recommended_personas: pass === 'operations-and-assurance' ? ['project.platform-owner'] : ['ewai.core.archaeologist'], rationale: `Repository evidence requires the ${pass} perspective during current-state reconstruction.`, expected_benefit: `The ${pass} perspective improves evidence quality and identifies unresolved assumptions.`, perspective_gaps: [] })),
    assignments: [{ persona: 'project.platform-owner', pass: 'operations-and-assurance', role: 'consulted', contribution: 'Confirm provider, environments, release route and operating ownership.' }],
    user_review: { presented_to_user: true, presented_summary: 'Use the project platform owner to confirm hosting evidence.', status: 'confirmed', selected_personas: ['project.platform-owner'], decided_by: 'Project owner', decided_at: '2026-08-23T18:00:00.000Z', notes: '' }
  }, { lineWidth: 0 }), 'utf8');
  refreshRepositoryIndex(root);
  return bundle;
}

test('CLI prepares, records and reports a governed technology and hosting profile', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-tech-hosting-cli-'));
  try {
    const bundle = setup(root);
    const bundleArgument = relative(root, bundle);
    const preparedResult = runCli(root, ['archaeology', 'prepare-technology-hosting', bundleArgument, '--json']);
    assert.equal(preparedResult.status, 0, preparedResult.stderr);
    const prepared = JSON.parse(preparedResult.stdout);
    assert.equal(prepared.status, 'awaiting-owner-answers');
    assert.equal(prepared.brief.observations.some((item) => item.candidate === 'Node.js'), true);
    assert.equal(prepared.brief.observations.some((item) => item.candidate === 'Microsoft Azure'), true);
    assert.equal(prepared.brief.activePersonas.some((item) => item.id === 'project.platform-owner'), true);

    const inputPath = resolve(bundle, 'technology-hosting-answers.template.json');
    const input = JSON.parse(readFileSync(inputPath, 'utf8'));
    const nodeObservation = prepared.brief.observations.find((item) => item.candidate === 'Node.js');
    input.technology = [{ category: 'runtime', name: 'Node.js', version: '22', confirmed: true, observationRefs: [nodeObservation.id], evidence: ['Project owner confirmation'], notes: '' }];
    input.hosting.provider = { value: 'Microsoft Azure', confirmed: false, observationRefs: prepared.brief.observations.filter((item) => item.candidate === 'Microsoft Azure').map((item) => item.id), evidence: ['Repository descriptor'], notes: 'Platform owner confirmation remains outstanding.' };
    input.unresolvedQuestions = ['Which Azure region holds production data?'];
    writeFileSync(inputPath, `${JSON.stringify(input, null, 2)}\n`, 'utf8');

    const recordedResult = runCli(root, ['archaeology', 'record-technology-hosting', bundleArgument, '--input', inputPath, '--reviewed-by', 'Project owner', '--json']);
    assert.equal(recordedResult.status, 0, recordedResult.stderr);
    const recorded = JSON.parse(recordedResult.stdout);
    assert.equal(recorded.profile.technology[0].provenance, 'human-confirmed');
    assert.equal(recorded.profile.hosting.provider.provenance, 'owner-declared');
    assert.equal(recorded.profile.notices.includes(ASSURANCE_NOTICE), true);

    const statusResult = runCli(root, ['archaeology', 'technology-hosting-status', bundleArgument, '--json']);
    assert.equal(statusResult.status, 0, statusResult.stderr);
    const status = JSON.parse(statusResult.stdout);
    assert.equal(status.status, 'recorded');
    assert.equal(status.profile.digest, recorded.profile.digest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI help documents the technology and hosting archaeology workflow', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-tech-hosting-cli-help-'));
  try {
    initProject(root, { name: 'Technology Hosting CLI Help Test' });
    const result = runCli(root, ['help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /archaeology prepare-technology-hosting/);
    assert.match(result.stdout, /archaeology record-technology-hosting/);
    assert.match(result.stdout, /archaeology technology-hosting-status/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('documents topology, persona, platform-export and assurance boundaries', () => {
  const guide = readFileSync(resolve(import.meta.dirname, '../Docs/archaeology-technology-and-hosting-discovery.md'), 'utf8');
  const skill = readFileSync(resolve(import.meta.dirname, '../skills-src/ewai-archaeology/SKILL.md'), 'utf8');
  for (const expected of [
    '### Single repository',
    '### Monorepo',
    '### Folder containing repository subfolders',
    'repository-observed',
    'owner-declared',
    'human-confirmed',
    'installed technology, stack, Organisation Blueprint and project Source Map profiles',
    'Premium personas improve the lenses',
    'project-local personas',
    'Power Platform and Salesforce exports',
    'does not extract ZIP or `.msapp` archives',
    ASSURANCE_NOTICE
  ]) assert.match(guide, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  assert.match(skill, /prepare-technology-hosting/);
  assert.match(skill, /actual provider, platform or service/);
  assert.match(skill, /core Archaeologist and SPECS Knowledge Curator remain active; swap in the confirmed premium, personal, and project personas/i);
  assert.match(skill, new RegExp(ASSURANCE_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
