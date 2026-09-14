import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { install } from '../src/install.mjs';

const root = resolve(import.meta.dirname, '..');

test('documents authoring, selection, Blueprint recommendation, application, migration, review and human acceptance', () => {
  const index = readFileSync(resolve(root, 'Docs/README.md'), 'utf8');
  const catalogue = readFileSync(resolve(root, 'Docs/guide-catalogue.md'), 'utf8');
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
  const guides = [
    'design-system-user-guide.md', 'design-system-pack-authoring-guide.md',
    'design-system-implementation-guide.md', 'design-system-review-guide.md', 'product-owner-guide.md',
  ].map((file) => readFileSync(resolve(root, 'Docs/design-systems', file), 'utf8')).join('\n');
  for (const phrase of ['bundled fallback', 'Organisation Blueprint', 'project-local', 'personal', 'expected-digest', 'active personas', 'mandatory-overflow', 'ewai.prototype-manifest/v3', 'historical v1', 'Manual QA']) {
    assert.match(guides, new RegExp(phrase, 'i'));
  }
  assert.match(index, /guide-catalogue\.md/);
  for (const guide of ['design-system-user-guide', 'design-system-pack-authoring-guide', 'design-system-implementation-guide', 'design-system-review-guide', 'product-owner-guide']) {
    assert.ok(catalogue.includes(`design-systems/${guide}.md`));
  }
  assert.ok(readme.includes('Docs/reference/capabilities-and-project-layout.md'));
  const capabilities = readFileSync(resolve(root, 'Docs/reference/capabilities-and-project-layout.md'), 'utf8');
  assert.match(capabilities, /Design-system capabilities/);
  assert.match(capabilities, /ui-design-assets\/prototypes\/manifest\.json/);
  assert.match(capabilities, /ui-design-assets\/design-system\/receipt-/);
  assert.doesNotMatch(`${index}\n${guides}\n${readme}`, /Refined/);
});

test('installs all design-system and prototype-review skills into an isolated project', () => {
  const project = mkdtempSync(resolve(tmpdir(), 'ewai-design-skills-install-'));
  try {
    install({ scope: 'project', projectRoot: project, host: 'codex', mode: 'copy' });
    for (const skill of ['ewai-design-system-author', 'ewai-design-system-apply', 'ewai-design-system-review', 'ewai-prototype-iteration']) {
      assert.equal(existsSync(resolve(project, '.agents/skills', skill, 'SKILL.md')), true);
      assert.equal(existsSync(resolve(project, '.agents/skills', skill, 'agents/openai.yaml')), true);
    }
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('npm dry-run contains the complete portable design-system capability without publishing', () => {
  const cache = mkdtempSync(resolve(tmpdir(), 'ewai-design-npm-cache-'));
  try {
    const result = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, npm_config_cache: cache },
    }));
    const files = new Set(result[0].files.map(({ path }) => path));
    for (const path of [
      'config/design-system.schema.json',
      'packs/design-systems/default/pack.yaml',
      'packs/design-systems/default/experience-promise.md',
      'src/design-systems.mjs',
      'src/design-system-authoring.mjs',
      'src/design-system-application.mjs',
      'skills-src/ewai-design-system-author/SKILL.md',
      'skills-src/ewai-design-system-apply/references/application-contract.md',
      'skills-src/ewai-design-system-review/references/review-contract.md',
      'Docs/design-systems/design-system-user-guide.md',
    ]) assert.equal(files.has(path), true, `missing package path: ${path}`);
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});
