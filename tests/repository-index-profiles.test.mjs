import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { initProject } from '../src/project.mjs';
import { projectPaths } from '../src/paths.mjs';
import {
  resolveSourceMapProfiles,
  selectSourceMapProfile,
  sourceMapProfileDigest,
  validateSourceMapProfile
} from '../src/repository-source-map.mjs';
import {
  refreshRepositoryIndex,
  repositoryIndexFreshness
} from '../src/runtime/repository-index.mjs';
import { openRuntimeDatabase } from '../src/runtime/database.mjs';

function configure(root, update) {
  const path = projectPaths(root).configPath;
  const config = YAML.parse(readFileSync(path, 'utf8'));
  update(config);
  writeFileSync(path, YAML.stringify(config, { lineWidth: 0 }), 'utf8');
  return config;
}

test('validates declarative profiles and rejects executable or escaping extensions', () => {
  const profile = validateSourceMapProfile({
    id: 'api-contracts',
    patterns: ['contracts/**/*.json'],
    analyser: 'structured-keys',
    classification: 'api-contract',
    repositories: ['backend'],
    priority: 100,
    max_bytes: 500_000
  }, { sourceKind: 'project', sourceRef: 'pipeline.yaml' });

  assert.equal(profile.id, 'project:api-contracts');
  assert.deepEqual(profile.repositories, ['backend']);
  assert.equal(profile.sourceKind, 'project');
  assert.throws(
    () => validateSourceMapProfile({
      id: 'escape', patterns: ['../secrets/**'], analyser: 'inventory-only', classification: 'unsafe'
    }),
    /unsafe source map pattern/
  );
  assert.throws(
    () => validateSourceMapProfile({
      id: 'plugin', patterns: ['**/*'], analyser: './plugin.mjs', classification: 'unsafe'
    }),
    /unknown source map analyser/
  );
  assert.throws(
    () => validateSourceMapProfile({
      id: 'command', patterns: ['**/*'], analyser: 'inventory-only', classification: 'unsafe', command: 'scan'
    }),
    /unsupported source map profile field/
  );
});

test('resolves deterministic core pack and project profiles across repository topologies', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-source-map-profiles-'));
  try {
    initProject(root, { name: 'Profile Topology Test' });
    mkdirSync(resolve(root, 'web/pages'), { recursive: true });
    mkdirSync(resolve(root, 'api/contracts'), { recursive: true });
    mkdirSync(resolve(root, 'api/policies'), { recursive: true });
    mkdirSync(resolve(root, '.ewai-pipeline/packs/acme'), { recursive: true });
    writeFileSync(resolve(root, 'web/pages/home.vue'), '<template><Home /></template>\n');
    writeFileSync(resolve(root, 'api/contracts/customer.json'), '{"customer":{"id":"not-stored"}}\n');
    writeFileSync(resolve(root, 'api/policies/access.yaml'), 'access:\n  role: private-value\n');
    writeFileSync(resolve(root, '.ewai-pipeline/packs/acme/pack.yaml'), `
schema: ewai.pack/v1
id: org.acme.engineering
name: Acme engineering
description: Acme project conventions.
version: 1.0.0
type: organisation
requires: []
source_map:
  profiles:
    - id: policy-files
      patterns: [policies/**/*.yaml]
      analyser: structured-keys
      classification: organisation-policy
      priority: 90
`);
    configure(root, (config) => {
      config.packs = ['ewai.core', 'ewai.stack.laravel-nuxt', 'org.acme.engineering'];
      config.repositories = [
        { name: 'web-app', path: 'web', role: 'frontend' },
        { name: 'api-app', path: 'api', role: 'backend' }
      ];
      config.source_map = {
        profiles: [{
          id: 'api-contracts',
          patterns: ['contracts/**/*.json'],
          analyser: 'structured-keys',
          classification: 'api-contract',
          repositories: ['backend'],
          priority: 100,
          max_bytes: 500_000
        }]
      };
    });

    const first = resolveSourceMapProfiles(root);
    const second = resolveSourceMapProfiles(root);
    assert.equal(first.digest, second.digest);
    assert.deepEqual(first.activePacks, [
      'ewai.core',
      'ewai.technology.laravel',
      'ewai.technology.nuxt',
      'ewai.stack.laravel-nuxt',
      'org.acme.engineering'
    ]);
    assert.equal(first.profiles.some((profile) => profile.sourceKind === 'technology'), true);
    assert.equal(first.profiles.some((profile) => profile.sourceKind === 'stack'), true);
    assert.equal(first.profiles.some((profile) => profile.sourceKind === 'organisation'), true);
    assert.equal(first.profiles.some((profile) => profile.sourceKind === 'project'), true);

    const frontend = selectSourceMapProfile('pages/home.vue', {
      profiles: first.profiles,
      repository: { name: 'web-app', role: 'frontend' }
    });
    assert.equal(frontend.id, 'ewai.stack.laravel-nuxt:frontend-pages');
    assert.equal(frontend.sourceKind, 'stack');

    const backend = selectSourceMapProfile('contracts/customer.json', {
      profiles: first.profiles,
      repository: { name: 'api-app', role: 'backend' }
    });
    assert.equal(backend.id, 'project:api-contracts');
    assert.equal(backend.sourceKind, 'project');

    const wrongRepository = selectSourceMapProfile('contracts/customer.json', {
      profiles: first.profiles,
      repository: { name: 'web-app', role: 'frontend' }
    });
    assert.equal(wrongRepository.id, 'core-structured-json');

    const organisation = selectSourceMapProfile('policies/access.yaml', {
      profiles: first.profiles,
      repository: { name: 'api-app', role: 'backend' }
    });
    assert.equal(organisation.id, 'org.acme.engineering:policy-files');
    assert.equal(organisation.sourceKind, 'organisation');

    const singleRepository = selectSourceMapProfile('pages/home.vue', {
      profiles: first.profiles,
      repository: { name: 'application', role: 'application' }
    });
    assert.equal(singleRepository.id, 'ewai.technology.nuxt:nuxt-pages');

    assert.notEqual(
      sourceMapProfileDigest(first.profiles),
      sourceMapProfileDigest([...first.profiles, { ...backend, id: 'project:changed' }])
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('records profile provenance and marks the index stale when effective profiles change', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-source-map-profile-freshness-'));
  try {
    initProject(root, { name: 'Profile Freshness Test' });
    mkdirSync(resolve(root, 'contracts'), { recursive: true });
    writeFileSync(resolve(root, 'contracts/service.json'), '{"service":{"token":"not-stored"}}\n');
    configure(root, (config) => {
      config.source_map = {
        profiles: [{
          id: 'contracts',
          patterns: ['contracts/**/*.json'],
          analyser: 'structured-keys',
          classification: 'api-contract',
          priority: 10
        }]
      };
    });

    const refreshed = refreshRepositoryIndex(root);
    assert.equal(repositoryIndexFreshness(root).status, 'fresh');
    const database = openRuntimeDatabase(root);
    try {
      const row = database.prepare(`
        SELECT profile_id, source_kind, source_ref FROM repo_index_profiles
        WHERE run_id = ? AND profile_id = 'project:contracts'
      `).get(refreshed.runId);
      assert.equal(row.profile_id, 'project:contracts');
      assert.equal(row.source_kind, 'project');
      assert.equal(row.source_ref, 'pipeline.yaml');
      assert.equal(JSON.stringify(row).includes(root), false);
    } finally {
      database.close();
    }

    configure(root, (config) => {
      config.source_map.profiles[0].priority = 11;
    });
    const freshness = repositoryIndexFreshness(root);
    assert.equal(freshness.status, 'stale');
    assert.equal(freshness.reason, 'profile-catalogue-changed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
