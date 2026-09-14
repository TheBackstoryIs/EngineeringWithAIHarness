import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

test('packages the governed persona entitlement skill and provider guide', () => {
  const requiredPaths = [
    'src/persona-entitlements.mjs',
    'config/persona-pack.schema.json',
    'skills-src/ewai-persona-entitlement/SKILL.md',
    'skills-src/ewai-persona-entitlement/agents/openai.yaml',
    'Docs/persona-entitlement-provider-guide.md',
  ];

  for (const path of requiredPaths) {
    assert.equal(existsSync(resolve(root, path)), true, `${path} must be packaged`);
  }

  const skill = read('skills-src/ewai-persona-entitlement/SKILL.md');
  assert.match(skill, /^---\nname: ewai-persona-entitlement\n/);
  assert.match(skill, /persona premium status/);
  assert.match(skill, /persona premium sync.+--yes/s);
  assert.match(skill, /explicit.+consent|explicit.+approval/is);
  assert.match(skill, /never.+(?:automatically|implicitly|during check-in).+(?:download|sync)|never.+(?:download|sync).+(?:automatically|implicitly|during check-in)/is);
  assert.match(skill, /human.+(?:approval|authority)/is);
  assert.match(skill, /premium.+optional/is);
});

test('documents website-only persona distribution and its trust boundary', () => {
  const guide = read('Docs/persona-entitlement-provider-guide.md');
  const installGuide = read('Docs/operations/installation-updating-and-entitlements.md');
  const setupGuide = read('Docs/operations/premium-personas-setup.md');
  const personaGuide = read('Docs/working-with-personas.md');
  const docsIndex = read('Docs/README.md');
  const catalogue = read('Docs/guide-catalogue.md');
  const rootReadme = read('README.md');

  assert.match(guide, /website-only/i);
  assert.doesNotMatch(guide, /git-private|EWAI-Personas-Pro/);
  assert.match(guide, /Easy Digital Downloads|EDD/i);
  assert.match(guide, /WordPress/i);
  assert.match(guide, /wordpress-edd/);
  assert.match(guide, /hidden prompt/i);
  assert.match(guide, /expired individual/i);
  assert.match(guide, /Confirmed team expiry/i);
  assert.match(guide, /staging/i);
  assert.match(guide, /validat/i);
  assert.match(guide, /receipt/i);
  assert.match(guide, /not DRM|does not provide DRM/i);
  assert.match(guide, /safe status|safe output|redact/i);
  assert.match(guide, /does not approve Build|cannot approve Build/i);

  assert.match(installGuide, /premium-personas-setup\.md/);
  assert.match(setupGuide, /Configuration.+Manage licence/is);
  assert.match(setupGuide, /persona premium configure/);
  assert.match(setupGuide, /Premium personas are ready/);
  assert.match(setupGuide, /saved key and the installed pack are separate/);
  assert.match(setupGuide, /persona premium sync.+--yes/s);
  assert.match(personaGuide, /persona premium status/);
  assert.match(personaGuide, /entitlement.+installed.+verified|installed.+verified.+entitlement/is);
  assert.match(personaGuide, /persona premium sync.+--yes/s);

  assert.match(docsIndex, /guide-catalogue\.md/);
  assert.match(catalogue, /persona-entitlement-provider-guide\.md/);
  assert.ok(rootReadme.includes('Docs/operations/premium-personas-setup.md'));
  assert.match(guide, /persona premium status/);
});

test('declares entitlement syntax and package assets in the npm contract', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.match(packageJson.scripts.check, /src\/persona-entitlements\.mjs/);
  assert.equal(packageJson.files.includes('config/'), true);
  assert.equal(packageJson.files.includes('Docs/'), true);
  assert.equal(packageJson.files.includes('skills-src/'), true);
  assert.equal(packageJson.files.includes('src/*.mjs'), true);
});
