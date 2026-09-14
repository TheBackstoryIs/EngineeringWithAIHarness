import test from 'node:test';
import assert from 'node:assert/strict';
import { analysePowerPlatformMetadata } from '../src/power-platform-source-map.mjs';
import { analyseRepositoryFile, validateSourceMapProfile } from '../src/repository-source-map.mjs';

function names(facts) {
  return facts.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`);
}

test('extracts allowlisted legacy solution identity and component containment', () => {
  const content = `<?xml version="1.0"?>
<ImportExportXml>
  <SolutionManifest>
    <UniqueName>ContosoCore</UniqueName>
    <LocalizedNames><LocalizedName description="Private friendly label" /></LocalizedNames>
    <RootComponents>
      <RootComponent type="1" schemaName="account" />
      <RootComponent type="29" schemaName="Contoso_Process" />
    </RootComponents>
  </SolutionManifest>
</ImportExportXml>`;
  const facts = analysePowerPlatformMetadata('Other/Solution.xml', content);

  assert.deepEqual(names(facts), [
    'power_solution:ContosoCore',
    'power_component:account',
    'power_component:Contoso_Process'
  ]);
  assert.equal(facts.relationships.filter((item) => item.relationship_kind === 'contains').length, 2);
  assert.equal(facts.file.metadata.layout, 'legacy-solution-xml');
  assert.equal(facts.file.metadata.partial, false);
  assert.equal(JSON.stringify(facts).includes('Private friendly label'), false);
});

test('extracts new solution manifests and canvas containment without Power Fx or property values', () => {
  const manifest = analysePowerPlatformMetadata(
    'solutions/ContosoCore/solutioncomponents.yml',
    '- Path: entities/account\n- Path: workflows/Contoso_Process\n- Path: canvasapps/private_app_guid\n- Path: ../../outside\n'
  );
  assert.equal(names(manifest).includes('power_solution:ContosoCore'), true);
  assert.equal(names(manifest).includes('power_component:entities/account'), true);
  assert.equal(manifest.relationships.some((item) => item.target_name === 'workflows/Contoso_Process'), true);
  assert.equal(manifest.file.metadata.partial, true);
  assert.equal(JSON.stringify(manifest).includes('../../outside'), false);

  const canvas = analysePowerPlatformMetadata('Src/Home.pa.yaml', `
Screens:
  Home:
    Properties:
      OnVisible: =Set(PrivateToken, "never-store-this")
    Children:
      - SubmitButton:
          Control: Button@0.0.44
          Properties:
            Text: ="Sensitive client label"
`);
  assert.equal(names(canvas).includes('power_screen:Home'), true);
  assert.equal(names(canvas).includes('power_control:SubmitButton'), true);
  assert.equal(canvas.relationships.some((item) => item.source_name === 'Home' && item.target_name === 'SubmitButton'), true);
  const projection = JSON.stringify(canvas);
  assert.equal(projection.includes('never-store-this'), false);
  assert.equal(projection.includes('Sensitive client label'), false);
  assert.equal(projection.includes('OnVisible'), false);
});

test('dispatches the Power analyser and records bounded hostile-document failure', () => {
  const profile = validateSourceMapProfile({
    id: 'power',
    patterns: ['Other/*.xml'],
    analyser: 'power-platform-metadata',
    classification: 'power-platform-metadata'
  });
  const facts = analyseRepositoryFile('Other/Solution.xml', {
    buffer: Buffer.from('<!DOCTYPE x [<!ENTITY leak SYSTEM "file:///private">]><x>&leak;</x>'),
    profile
  });
  assert.equal(facts.file.analysisOutcome, 'analysis_failed');
  assert.equal(facts.file.analysisDepth, 'deep');
  assert.deepEqual(facts.file.metadata, {
    platform: 'power-platform',
    layout: 'legacy-solution-xml',
    partial: true,
    truncated: false,
    unknown_component_count: 0,
    failure_code: 'unsafe-xml-declaration'
  });
  assert.equal(JSON.stringify(facts).includes('file:///private'), false);
});

test('leaves .msapp and zip archives as inventory evidence', () => {
  for (const path of ['canvas/Example.msapp', 'exports/Solution.zip']) {
    const facts = analyseRepositoryFile(path, { buffer: Buffer.from('PK archive bytes') });
    assert.equal(facts.file.analyser, 'inventory-only');
    assert.equal(facts.file.analysisOutcome, 'inventory_only');
  }
});
