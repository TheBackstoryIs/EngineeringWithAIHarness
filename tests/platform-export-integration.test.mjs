import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import { initProject } from '../src/project.mjs';
import { projectPaths } from '../src/paths.mjs';
import {
  refreshRepositoryIndex,
  repositoryGraph,
  repositorySourceMapCoverage,
  repositorySourceMapProfiles,
  searchRepositoryIndex
} from '../src/runtime/repository-index.mjs';

function write(root, path, content) {
  const destination = resolve(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

function configure(root, repositories) {
  const path = projectPaths(root).configPath;
  const config = YAML.parse(readFileSync(path, 'utf8'));
  config.packs = ['ewai.core', 'ewai.technology.power-platform', 'ewai.technology.salesforce'];
  config.repositories = repositories;
  writeFileSync(path, YAML.stringify(config, { lineWidth: 0 }));
}

test('maps Power Platform and Salesforce exports across repository-subfolder topology', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-platform-integration-'));
  try {
    initProject(root, { name: 'Platform Export Integration' });
    configure(root, [
      { name: 'power-apps', role: 'low-code', path: 'products/power' },
      { name: 'salesforce-crm', role: 'crm', path: 'products/salesforce' }
    ]);
    write(root, 'products/power/solutions/Contoso/solutioncomponents.yml', '- Path: entities/account\n');
    write(root, 'products/salesforce/manifest/package.xml', '<Package><types><members>Invoice__c</members><name>CustomObject</name></types><version>66.0</version></Package>');
    write(root, 'products/salesforce/force-app/main/default/objects/Invoice__c/fields/Amount__c.field-meta.xml', '<CustomField><fullName>Amount__c</fullName></CustomField>');

    const refreshed = refreshRepositoryIndex(root);
    assert.equal(refreshed.status, 'completed');
    const coverage = repositorySourceMapCoverage(root);
    assert.equal(coverage.analysers['power-platform-metadata'] > 0, true);
    assert.equal(coverage.analysers['salesforce-metadata'] > 0, true);
    assert.equal(coverage.depths.deep >= 3, true);

    const profiles = repositorySourceMapProfiles(root);
    assert.equal(profiles.profiles.some((profile) => profile.sourceRef === 'ewai.technology.power-platform'), true);
    assert.equal(profiles.profiles.some((profile) => profile.sourceRef === 'ewai.technology.salesforce'), true);
    assert.equal(searchRepositoryIndex(root, 'Invoice__c').symbols.length > 0, true);
    assert.equal(repositoryGraph(root, 'Invoice__c').relationships.length > 0, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('surfaces partial platform files in Source Map coverage without exposing source text', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-platform-partial-'));
  try {
    initProject(root, { name: 'Platform Partial Coverage' });
    configure(root, [{ name: 'application', role: 'application', path: '.' }]);
    write(root, 'Other/Solution.xml', '<!DOCTYPE x [<!ENTITY leak SYSTEM "file:///private">]><x>&leak;</x>');

    refreshRepositoryIndex(root);
    const coverage = repositorySourceMapCoverage(root);
    assert.equal(coverage.partial, 1);
    assert.equal(coverage.warnings.some((warning) => warning.includes('partial platform evidence')), true);
    assert.equal(JSON.stringify(coverage).includes('file:///private'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('selects platform packs for exports nested under a monorepo root', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-platform-monorepo-'));
  try {
    initProject(root, { name: 'Platform Export Monorepo' });
    configure(root, [{ name: 'product', role: 'workspace', path: '.' }]);
    write(root, 'apps/power/solutions/Contoso/solutioncomponents.yml', '- Path: entities/account\n');
    write(root, 'apps/crm/sfdx-project.json', '{"packageDirectories":[{"path":"force-app"}]}\n');

    refreshRepositoryIndex(root);
    const profiles = repositorySourceMapProfiles(root);
    const coverage = repositorySourceMapCoverage(root);
    assert.equal(coverage.analysers['power-platform-metadata'] > 0, true);
    assert.equal(coverage.analysers['salesforce-metadata'] > 0, true);
    assert.equal(profiles.profiles.find((profile) => profile.id.endsWith(':solution-yaml')).matchCount, 1);
    assert.equal(profiles.profiles.find((profile) => profile.id.endsWith(':project-and-package')).matchCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
