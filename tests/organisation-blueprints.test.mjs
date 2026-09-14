import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import {
  listOrganisationBlueprints,
  organisationDesignSystemRecommendations,
  projectOrganisationBlueprint,
  resolveOrganisationBlueprint
} from '../src/organisation-blueprints.mjs';
import { listPacks } from '../src/packs.mjs';
import { resolveSourceMapProfiles } from '../src/repository-source-map.mjs';

function manifest(overrides = {}) {
  return {
    schema: 'ewai.pack/v1',
    id: 'org.northstar.engineering',
    name: 'Northstar Engineering Baseline',
    description: 'Reviewed engineering conventions.',
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
          description: 'Authentication, endpoint and error rules.',
          required: true,
          standards: [{ id: 'api-contract', title: 'API contract', source: 'standards/api.md' }],
          personas: [{ id: 'api-governance-lead', name: 'API Governance Lead', source: 'personas/api.md' }],
          design_systems: ['org.northstar.design-system'],
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
          standards: [{ id: 'release', title: 'Release readiness', source: 'standards/release.md' }],
          personas: [],
          boilerplates: []
        }
      ]
    },
    ...overrides
  };
}

function writePack(root, pack = manifest(), files = {}) {
  const directory = resolve(root, pack.id.replaceAll('.', '-'));
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'pack.yaml'), YAML.stringify(pack, { lineWidth: 0 }));
  const defaults = {
    'standards/api.md': '# API contract\n\nUse explicit compatibility rules.\n',
    'standards/release.md': '# Release readiness\n\nKeep review evidence.\n',
    'personas/api.md': '---\nname: API Governance Lead\ndescription: Applies project API conventions.\ncategory: architecture\ntags: [api, governance]\ncapabilities: [api-review]\n---\n\n# API Governance Lead\n'
  };
  for (const [relative, content] of Object.entries({ ...defaults, ...files })) {
    const path = resolve(directory, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return directory;
}

const sourceMapProfile = {
  id: 'team-metadata', patterns: ['**/*.team.json'], analyser: 'structured-keys',
  classification: 'structured-data', priority: 20, repositories: ['application'], max_bytes: 32000
};

test('Blueprint Source Map profiles survive strict parsing and enter effective profile resolution', t => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-org-source-map-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writePack(root, manifest({ source_map: { profiles: [sourceMapProfile] } }));
  const [pack] = listOrganisationBlueprints({ roots: [root] });
  assert.deepEqual(pack.source_map.profiles, [sourceMapProfile]);
  const effective = resolveSourceMapProfiles(root, { config: { packs: [pack.id] }, packs: [{ id: 'ewai.core', type: 'core' }, pack] });
  const profile = effective.profiles.find(item => item.localId === sourceMapProfile.id);
  assert.equal(profile.sourceKind, 'organisation');
  assert.equal(profile.sourceRef, pack.id);
  assert.equal(profile.maxBytes, 32000);
  writePack(root, manifest({ source_map: { profiles: [{ ...sourceMapProfile, max_bytes: 16000 }] } }));
  const [changed] = listOrganisationBlueprints({ roots: [root] });
  assert.notEqual(changed.digest, pack.digest);
  assert.notEqual(resolveSourceMapProfiles(root, { config: { packs: [pack.id] }, packs: [{ id: 'ewai.core', type: 'core' }, changed] }).digest, effective.digest);
});

test('Blueprint Source Map validation rejects unsafe fields, types and unsupported analysers', t => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-org-invalid-source-map-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const override of [
    { command: 'do-not-execute' }, { analyser: 'custom-script' }, { patterns: ['../outside'] },
    { patterns: ['/outside'] }, { patterns: [] }, { patterns: ['**/*.json', '**/*.json'] },
    { max_bytes: 900001 }, { max_bytes: '32000' }, { priority: '20' },
    { repositories: [5] }, { repositories: ['application', 'application'] }, { id: 'INVALID' }
  ]) {
    writePack(root, manifest({ source_map: { profiles: [{ ...sourceMapProfile, ...override }] } }));
    assert.throws(() => listOrganisationBlueprints({ roots: [root] }), /manifest is invalid/);
  }
  for (const source_map of [{ profiles: [] }, { profiles: [sourceMapProfile], command: 'do-not-execute' }, { profiles: [sourceMapProfile, sourceMapProfile] }]) {
    writePack(root, manifest({ source_map }));
    assert.throws(() => listOrganisationBlueprints({ roots: [root] }), /manifest is invalid/);
  }
});

test('the Source Map guide supplies a complete valid Organisation Blueprint example', t => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-org-documented-source-map-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const guide = readFileSync(new URL('../Docs/repository-source-map-guide.md', import.meta.url), 'utf8');
  const example = [...guide.matchAll(/```yaml\n([\s\S]*?)```/g)].map(match => YAML.parse(match[1])).find(value => value.type === 'organisation' && value.source_map);
  assert.ok(example, 'guide includes the organisation profile example');
  writePack(root, example);
  const [pack] = listOrganisationBlueprints({ roots: [root] });
  assert.deepEqual(pack.source_map, example.source_map);
});

test('validates and safely projects an installed organisation blueprint', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-org-blueprint-'));
  try {
    writePack(root);
    const catalogue = listOrganisationBlueprints({ roots: [{ path: root, sourceClass: 'project' }] });
    assert.equal(catalogue.length, 1);
    assert.equal(catalogue[0].id, 'org.northstar.engineering');
    assert.equal(catalogue[0].sourceClass, 'project');
    assert.match(catalogue[0].digest, /^sha256:[a-f0-9]{64}$/);
    assert.match(catalogue[0].blueprint.modules[0].standards[0].content, /explicit compatibility/);

    const safe = projectOrganisationBlueprint(catalogue[0]);
    assert.equal(safe.publisher.name, 'Northstar Digital');
    assert.equal(safe.compatible, true);
    assert.equal(safe.modules[0].counts.standards, 1);
    assert.deepEqual(safe.modules[0].designSystems, ['org.northstar.design-system']);
    assert.equal(JSON.stringify(safe).includes(root), false);
    assert.equal(JSON.stringify(safe).includes('Applies project API conventions'), false);
    assert.equal('manifestPath' in safe, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('projects design-system recommendations without selecting or copying them', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-org-design-recommendation-'));
  try {
    writePack(root);
    const resolved = resolveOrganisationBlueprint('org.northstar.engineering', listOrganisationBlueprints({ roots: [root] }));
    assert.deepEqual(organisationDesignSystemRecommendations(resolved), [{
      packId: 'org.northstar.engineering', moduleId: 'api-conventions', id: 'org.northstar.design-system',
    }]);
    assert.equal(JSON.stringify(projectOrganisationBlueprint(resolved)).includes('Approved design-system source'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolves required dependencies and only declared optional root modules', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-org-resolve-'));
  try {
    const foundation = manifest({
      id: 'org.northstar.foundation',
      name: 'Foundation',
      version: '1.0.0',
      blueprint: {
        ...manifest().blueprint,
        modules: [manifest().blueprint.modules[0]]
      }
    });
    writePack(root, foundation);
    writePack(root, manifest({ requires: ['org.northstar.foundation'] }));
    const catalogue = listOrganisationBlueprints({ roots: [{ path: root, sourceClass: 'personal' }] });
    const resolved = resolveOrganisationBlueprint('org.northstar.engineering', catalogue, {
      enabledModules: ['delivery-assurance']
    });
    assert.deepEqual(resolved.packs.map((pack) => pack.id), [
      'org.northstar.foundation', 'org.northstar.engineering'
    ]);
    assert.deepEqual(resolved.rootModules.map((module) => module.id), [
      'api-conventions', 'delivery-assurance'
    ]);
    assert.throws(
      () => resolveOrganisationBlueprint('org.northstar.engineering', catalogue, { enabledModules: ['not-declared'] }),
      /optional module.*not-declared/i
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects duplicate identities, missing dependencies, and dependency cycles', () => {
  const first = mkdtempSync(resolve(tmpdir(), 'ewai-org-first-'));
  const second = mkdtempSync(resolve(tmpdir(), 'ewai-org-second-'));
  try {
    writePack(first);
    writePack(second);
    assert.throws(
      () => listOrganisationBlueprints({ roots: [{ path: first }, { path: second }] }),
      /duplicate organisation blueprint id/i
    );

    rmSync(second, { recursive: true, force: true });
    mkdirSync(second);
    writePack(second, manifest({ requires: ['org.northstar.missing'] }));
    let catalogue = listOrganisationBlueprints({ roots: [{ path: second }] });
    assert.throws(() => resolveOrganisationBlueprint('org.northstar.engineering', catalogue), /missing dependency/i);

    rmSync(first, { recursive: true, force: true });
    mkdirSync(first);
    writePack(first, manifest({ id: 'org.northstar.one', requires: ['org.northstar.two'] }));
    writePack(first, manifest({ id: 'org.northstar.two', requires: ['org.northstar.one'] }));
    catalogue = listOrganisationBlueprints({ roots: [{ path: first }] });
    assert.throws(() => resolveOrganisationBlueprint('org.northstar.one', catalogue), /dependency cycle/i);
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
});

test('rejects publisher mismatch, incompatible runtime, traversal, and symbolic-link escape', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-org-hostile-'));
  const outside = mkdtempSync(resolve(tmpdir(), 'ewai-org-outside-'));
  try {
    writePack(root, manifest({
      blueprint: { ...manifest().blueprint, publisher: { id: 'someone-else', name: 'Someone Else' } }
    }));
    assert.throws(() => listOrganisationBlueprints({ roots: [{ path: root }] }), /publisher.*match/i);

    rmSync(root, { recursive: true, force: true });
    mkdirSync(root);
    writePack(root, manifest({
      blueprint: { ...manifest().blueprint, compatibility: { ewai: '1.x' } }
    }));
    const incompatible = listOrganisationBlueprints({ roots: [{ path: root }] });
    assert.equal(projectOrganisationBlueprint(incompatible[0]).compatible, false);
    assert.throws(() => resolveOrganisationBlueprint('org.northstar.engineering', incompatible), /incompatible/i);

    rmSync(root, { recursive: true, force: true });
    mkdirSync(root);
    const traversing = manifest();
    traversing.blueprint.modules[0].standards[0].source = '../outside.md';
    writePack(root, traversing);
    assert.throws(() => listOrganisationBlueprints({ roots: [{ path: root }] }), /escape.*pack root|bounded relative path/i);

    rmSync(root, { recursive: true, force: true });
    mkdirSync(root);
    writeFileSync(resolve(outside, 'persona.md'), '# outside\n');
    const packDirectory = writePack(root);
    rmSync(resolve(packDirectory, 'personas/api.md'));
    symlinkSync(resolve(outside, 'persona.md'), resolve(packDirectory, 'personas/api.md'));
    assert.throws(() => listOrganisationBlueprints({ roots: [{ path: root }] }), /symbolic link|escape.*pack root/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('bounds content and changes computed digest when referenced bytes change', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-org-digest-'));
  try {
    const directory = writePack(root);
    const options = { roots: [{ path: root }], limits: { manifestBytes: 64_000, itemBytes: 1_000, totalBytes: 4_000 } };
    const first = listOrganisationBlueprints(options)[0].digest;
    writeFileSync(resolve(directory, 'standards/api.md'), '# API contract\n\nChanged.\n');
    const second = listOrganisationBlueprints(options)[0].digest;
    assert.notEqual(second, first);
    writeFileSync(resolve(directory, 'standards/api.md'), 'x'.repeat(1_001));
    assert.throws(() => listOrganisationBlueprints(options), /size limit/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('preserves the existing permissive pack catalogue contract', () => {
  const packs = listPacks();
  assert.equal(packs.some((pack) => pack.id === 'ewai.core'), true);
  assert.equal(packs.every((pack) => typeof pack.path === 'string'), true);
  assert.equal(JSON.parse(readFileSync('config/pack.schema.json', 'utf8')).properties.type.enum.includes('organisation'), true);
});
