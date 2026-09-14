import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { initProject } from '../../src/project.mjs';
import { createIntent, updateIntentDeliveryState } from '../../src/intents.mjs';
import {
  beginDelivery,
  completeDeliveryPhase,
  phaseGateTemplate,
  recordPhaseGate,
} from '../../src/delivery.mjs';
import { buildTeamHubEnvelope, validateTeamHubSnapshot } from '../../src/team-hub.mjs';

export function organisationPack(root, version = '1.0.0', content = '# API standard\n', id = 'org.acme.delivery') {
  const folder = resolve(root, `organisation-${version}-${id.replaceAll('.', '-')}`);
  mkdirSync(resolve(folder, 'standards'), { recursive: true });
  writeFileSync(resolve(folder, 'standards/api.md'), content);
  writeFileSync(resolve(folder, 'pack.yaml'), `schema: ewai.pack/v1
id: ${id}
name: Acme delivery
description: Governed delivery defaults
version: ${version}
type: organisation
requires: []
blueprint:
  publisher: { id: acme, name: Acme }
  compatibility: { ewai: 0.x }
  modules:
    - id: delivery
      name: Delivery
      description: Shared delivery standards
      required: true
      standards: [{ id: api, title: API standard, source: standards/api.md }]
      personas: []
      policies: []
      design_systems: []
      starter_packs: []
      boilerplates: []
`);
  return folder;
}

export function teamHubSnapshot(projectId, name, generatedAt, suffix = 'a') {
  return validateTeamHubSnapshot({
    schema: 'ewai.team-hub-snapshot/v1',
    project: { id: projectId, name },
    generatedAt,
    ewaiVersion: '0.2.1',
    revision: { digest: `sha256:${suffix.repeat(64)}` },
    intents: { total: 1, draft: 0, ready: 0, inProgress: 1, completed: 0, blocked: 0 },
    delivery: null,
    resources: [],
    authorityNotice: 'Team Hub is an operational evidence projection. It cannot approve Build or Manual QA, accept risk, certify compliance, deploy or release.',
  });
}

export function teamHubEnvelope(projectId, name, generatedAt, suffix = 'a') {
  return buildTeamHubEnvelope(teamHubSnapshot(projectId, name, generatedAt, suffix));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function createCompletedEvidenceFixture(root, slug = 'cli-evidence') {
  initProject(root, { name: 'Completed evidence CLI fixture' });
  const intent = createIntent(root, { slug, domain: 'quality', title: 'Completed Evidence CLI Fixture' });
  updateIntentDeliveryState(root, intent.path, { status: 'ready' });
  beginDelivery(root, slug, { tool: 'codex', existingCode: false, ui: false, mode: 'normal' });

  const deliveryRoot = resolve(root, `SPECS/6.Build/${slug}`);
  const intentGateRoot = resolve(deliveryRoot, 'gates/intent');
  mkdirSync(intentGateRoot, { recursive: true });
  writeFileSync(resolve(deliveryRoot, 'intent-summary.md'), '# Intent summary\n\nFixture intent.\n');
  writeJson(resolve(intentGateRoot, 'intent-dependency-map.json'), { schema_version: 1, slug, status: 'final', dependencies: [] });
  writeFileSync(resolve(intentGateRoot, 'intent-dependency-map-check.md'), '# Dependency map\n\nPass.\n');
  writeJson(resolve(intentGateRoot, 'intent-dependency-map-check.json'), { status: 'pass' });
  writeJson(resolve(intentGateRoot, 'intent-code-disagreements.json'), { status: 'pass', disagreements: [] });

  const template = phaseGateTemplate(root, slug, 'intent');
  const requiredGates = template.required_gates.map((gate) => {
    const evidencePath = resolve(deliveryRoot, `evidence/intent-${gate.id}.md`);
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `# ${gate.id}\n\nOriginal evidence.\n`);
    return {
      id: gate.id,
      commandOrSkill: `fixture:${gate.id}`,
      outputPath: relative(root, evidencePath).replaceAll('\\', '/'),
      exitStatus: 0,
      status: 'pass',
    };
  });
  recordPhaseGate(root, slug, 'intent', {
    status: 'pass',
    honestyCheck: {
      sourceSectionsEdited: true,
      staleTextRemoved: true,
      noAppendOnlyCorrections: true,
      allCodeClaimsCited: true,
    },
    requiredGates,
  });
  completeDeliveryPhase(root, slug, 'intent', { artefactPath: relative(root, resolve(deliveryRoot, 'intent-summary.md')).replaceAll('\\', '/') });

  const evidencePath = resolve(root, requiredGates[0].outputPath);
  writeFileSync(evidencePath, `${readFileSync(evidencePath, 'utf8')}Corrected operational evidence.\n`);
  return { root, slug, deliveryRoot, evidencePath };
}
