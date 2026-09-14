import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  PLATFORM_METADATA_LIMITS,
  createPlatformFactCollector,
  normalisePlatformPathIdentifier,
  parseSafePlatformXml,
  parseSafePlatformYaml
} from '../src/platform-metadata-analysis.mjs';
import { detectTechnologyPacks } from '../src/discovery.mjs';
import {
  REGISTERED_SOURCE_MAP_ANALYSERS,
  validateSourceMapProfile
} from '../src/repository-source-map.mjs';

test('registers provider-owned metadata analysers as deep declarative evidence', () => {
  for (const analyser of ['power-platform-metadata', 'salesforce-metadata']) {
    assert.equal(REGISTERED_SOURCE_MAP_ANALYSERS.includes(analyser), true);
    const profile = validateSourceMapProfile({
      id: `${analyser}-fixture`,
      patterns: ['exports/**/*'],
      analyser,
      classification: 'platform-metadata'
    });
    assert.equal(profile.analysisDepth, 'deep');
  }
});

test('rejects unsafe XML declarations and YAML aliases without retaining source values', () => {
  assert.throws(
    () => parseSafePlatformXml('<!DOCTYPE x [<!ENTITY leak SYSTEM "file:///private">]><x>&leak;</x>'),
    (error) => error.code === 'unsafe-xml-declaration'
  );
  assert.throws(
    () => parseSafePlatformYaml('secret: &private do-not-store\ncopy: *private\n'),
    (error) => error.code === 'invalid-platform-document'
  );
});

test('bounds identifiers, symbols and relationships with explicit partial evidence', () => {
  const collector = createPlatformFactCollector({
    platform: 'power-platform',
    layout: 'test-layout',
    limits: { ...PLATFORM_METADATA_LIMITS, symbols: 2, relationships: 1 }
  });
  collector.addSymbol('power_component', 'First');
  collector.addSymbol('power_component', 'Second');
  collector.addSymbol('power_component', 'Third');
  collector.addRelationship('power_solution', 'Example', 'contains', 'power_component', 'First');
  collector.addRelationship('power_solution', 'Example', 'contains', 'power_component', 'Second');
  collector.addSymbol('power_component', 'x'.repeat(241));

  const facts = collector.finish();
  assert.equal(facts.symbols.length, 2);
  assert.equal(facts.relationships.length, 1);
  assert.equal(facts.metadata.partial, true);
  assert.equal(facts.metadata.truncated, true);
  assert.equal(facts.metadata.unknown_component_count > 0, true);
  assert.equal(JSON.stringify(facts).includes('x'.repeat(241)), false);
  assert.equal(normalisePlatformPathIdentifier('entities/account'), 'entities/account');
  assert.equal(normalisePlatformPathIdentifier('../private'), '');
  assert.equal(normalisePlatformPathIdentifier('/absolute/private'), '');
  assert.equal(normalisePlatformPathIdentifier('entities\\account'), '');
});

test('detects any-file and bounded pattern markers without selecting packs', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-platform-pack-detect-'));
  try {
    mkdirSync(resolve(root, 'products/power/solutions/Contoso'), { recursive: true });
    mkdirSync(resolve(root, 'products/salesforce'), { recursive: true });
    writeFileSync(resolve(root, 'products/power/solutions/Contoso/solution.yml'), 'Solution: Contoso\n');
    writeFileSync(resolve(root, 'products/salesforce/sfdx-project.json'), '{"packageDirectories":[]}\n');

    const detected = detectTechnologyPacks(root, [
      {
        id: 'ewai.technology.power-platform',
        type: 'technology',
        detection: { any_patterns: ['solutions/*/solution.yml'] }
      },
      {
        id: 'ewai.technology.salesforce',
        type: 'technology',
        detection: { any_files: ['sfdx-project.json'] }
      }
    ]);

    assert.deepEqual(detected, [
      'ewai.technology.power-platform',
      'ewai.technology.salesforce'
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does not treat archives, unsafe patterns or symlink targets as detection evidence', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-platform-pack-negative-'));
  const external = mkdtempSync(resolve(tmpdir(), 'ewai-platform-pack-external-'));
  try {
    writeFileSync(resolve(root, 'solution.zip'), 'not opened');
    writeFileSync(resolve(root, 'application.msapp'), 'not opened');
    writeFileSync(resolve(external, 'sfdx-project.json'), '{"packageDirectories":[]}');
    symlinkSync(external, resolve(root, 'external-project'));
    assert.deepEqual(detectTechnologyPacks(root, [{
      id: 'ewai.technology.power-platform',
      type: 'technology',
      detection: { any_patterns: ['solutions/*/solution.yml'] }
    }]), []);
    assert.throws(
      () => detectTechnologyPacks(root, [{
        id: 'ewai.technology.unsafe',
        type: 'technology',
        detection: { any_patterns: ['../solution.yml'] }
      }]),
      /unsafe pack detection pattern/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});
