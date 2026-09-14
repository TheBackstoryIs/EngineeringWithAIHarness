import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const disclaimer = 'Organisation Policy Design Gates are design-time evidence only. They do not enforce production traffic, execute production code, certify compliance, approve Build or Manual QA, authorise release, or accept residual risk.';

function text(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

test('ships a concise organisation-policy skill and canonical contract reference', () => {
  const skillPath = 'skills-src/ewai-organisation-policy/SKILL.md';
  const referencePath = 'skills-src/ewai-organisation-policy/references/policy-contract.md';
  const agentPath = 'skills-src/ewai-organisation-policy/agents/openai.yaml';
  for (const path of [skillPath, referencePath, agentPath]) assert.equal(existsSync(resolve(root, path)), true, path);
  const skill = text(skillPath);
  const reference = text(referencePath);
  assert.match(skill, /^---\nname: ewai-organisation-policy\n/);
  assert.match(skill, /author.*adopt.*confirm.*evaluate.*review.*exception/is);
  assert.match(skill, /standard model.*complete baseline/is);
  assert.match(skill, /premium.*optional.*installed/is);
  assert.match(skill, /active persona.*tier.*engagement reason/is);
  assert.match(skill, /named human.*confirm/is);
  assert.match(skill, /never.*(?:sync|download).*premium/is);
  assert.match(skill, new RegExp(disclaimer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(reference, /ewai policy status/);
  assert.match(reference, /ewai_policy_status/);
  assert.match(reference, /ewai\.organisation-policy\/v1/);
  assert.match(reference, /allow-with-controls/);
  assert.match(reference, /not-configured.*non-blocking/is);
  assert.doesNotMatch(`${skill}\n${reference}`, /production (?:proxy|gateway|interceptor|execution engine)/i);
});

test('integrates optional policy work into discovery intent delivery testing and readiness', () => {
  const expectations = [
    ['skills-src/ewai-project-discovery/SKILL.md', /organisation policy.*optional.*baseline/is],
    ['skills-src/ewai-intent/SKILL.md', /\$ewai-organisation-policy.*design facts/is],
    ['skills-src/ewai-deliver/SKILL.md', /policy baseline.*enabled.*\$ewai-organisation-policy/is],
    ['skills-src/ewai-test-scenarios/SKILL.md', /policy.*rule.*control.*authoritative source/is],
    ['skills-src/ewai-solution-readiness/SKILL.md', /policy design gate.*evidence dimension/is],
  ];
  for (const [path, pattern] of expectations) assert.match(text(path), pattern, path);
});

test('ships role-specific policy guides with the permanent authority boundary', () => {
  const guides = [
    'Docs/policies/organisation-policy-design-gates.md',
    'Docs/policies/policy-pack-authoring-guide.md',
    'Docs/policies/product-owner-guide.md',
    'Docs/policies/technical-owner-guide.md',
    'Docs/policies/governance-owner-guide.md',
    'Docs/policies/implementation-guide.md',
  ];
  for (const path of guides) {
    assert.equal(existsSync(resolve(root, path)), true, path);
    assert.match(text(path), new RegExp(disclaimer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), path);
  }
  assert.match(text('Docs/policies/product-owner-guide.md'), /business.*view.*active personas/is);
  assert.match(text('Docs/policies/technical-owner-guide.md'), /technical.*view.*digest.*control trace/is);
  assert.match(text('Docs/policies/governance-owner-guide.md'), /review.*exception.*expiry/is);
  assert.match(text('Docs/policies/implementation-guide.md'), /CLI.*MCP.*HTTP.*UI/is);
  assert.match(text('Docs/policies/policy-pack-authoring-guide.md'), /closed vocabulary.*data-only/is);
  assert.match(text('Docs/README.md'), /guide-catalogue\.md/);
  for (const path of guides) assert.ok(text('Docs/guide-catalogue.md').includes(path.replace('Docs/', '')));
  assert.ok(text('README.md').includes('Docs/guide-catalogue.md'));
  assert.ok(text('Docs/guide-catalogue.md').includes('policies/organisation-policy-design-gates.md'));
});

test('explains policy contributions throughout the organisation Blueprint lifecycle', () => {
  const guides = [
    'Docs/designing-organisation-blueprint-packs.md',
    'Docs/blueprints/maintaining-organisation-blueprints.md',
    'Docs/blueprints/internal-blueprint-catalogue.md',
  ];
  for (const path of guides) {
    const guide = text(path);
    assert.match(guide, /Organisation Policy Design Gates/, path);
    assert.match(guide, /not-configured/, path);
    assert.match(guide, new RegExp(disclaimer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), path);
  }
  assert.match(text(guides[0]), /policies\/policy-pack-authoring-guide\.md/);
  assert.match(text(guides[1]), /policies\/governance-owner-guide\.md/);
  assert.match(text(guides[2]), /policies\/organisation-policy-design-gates\.md/);
});

test('package syntax and file contracts include every policy capability module', () => {
  const pkg = JSON.parse(text('package.json'));
  assert.equal(pkg.files.includes('skills-src/'), true);
  assert.equal(pkg.files.includes('Docs/'), true);
  for (const path of [
    'src/organisation-policies.mjs',
    'src/policy-design-gates.mjs',
    'src/policy-gate-integration.mjs',
    'src/runtime/policy-workspace.mjs',
  ]) assert.match(pkg.scripts.check, new RegExp(path.replaceAll('.', '\\.')));
});
