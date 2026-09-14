import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { install } from '../src/install.mjs';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('ships a host skill and guide for persona-guided plan and rendered-design iteration', () => {
  const skill = read('skills-src/ewai-prototype-iteration/SKILL.md');
  const contract = read('skills-src/ewai-prototype-iteration/references/review-contract.md');
  const agent = read('skills-src/ewai-prototype-iteration/agents/openai.yaml');
  const guide = read('Docs/persona-guided-prototype-iteration.md');
  const creationGuide = read('Docs/screen-prototype-creation-guide.md');
  const designReview = read('skills-src/ewai-design-system-review/SKILL.md');
  const docs = read('Docs/README.md');
  const catalogue = read('Docs/guide-catalogue.md');

  assert.match(skill, /^---\nname: ewai-prototype-iteration\n/);
  assert.match(skill, /recompute|select.+again/is);
  assert.match(skill, /core.+project.+personal.+premium/is);
  assert.doesNotMatch(skill, /persona premium sync|premium persona (?:sync|download)/i);
  assert.match(skill, /one (?:explicit )?disposition|exactly one/i);
  assert.match(skill, /Manual QA.+separate/is);
  assert.match(contract, /incorporate-with-modification/);
  assert.match(contract, /rendered-viewport/);
  assert.match(agent, /\$ewai-prototype-iteration/);
  assert.match(guide, /prototype-review plan-prepare/);
  assert.match(guide, /ewai_prototype_cycle_prepare/);
  assert.match(guide, /ewai\.prototype-manifest\/v3/);
  assert.match(guide, /Actively engaged personas/);
  assert.match(creationGuide, /no deterministic `ewai prototype generate` command/i);
  assert.match(creationGuide, /Repository Source Map and Archaeology evidence/);
  assert.match(creationGuide, /new persona ensemble|independent stages/i);
  assert.match(creationGuide, /seven evidence channels/i);
  assert.match(creationGuide, /selected entry point must be a real `\.html` or `\.htm` file/i);
  assert.match(designReview, /ewai\.prototype-manifest\/v3/);
  assert.match(docs, /guide-catalogue\.md/);
  assert.match(catalogue, /persona-guided-prototype-iteration\.md/);
  assert.match(catalogue, /screen-prototype-creation-guide\.md/);
  assert.doesNotMatch(`${skill}\n${contract}\n${guide}\n${creationGuide}`, /Refined/);
});

test('installs the prototype iteration skill with host-facing metadata and contract', () => {
  const project = mkdtempSync(resolve(tmpdir(), 'ewai-prototype-skill-install-'));
  try {
    install({ scope: 'project', projectRoot: project, host: 'codex', mode: 'copy' });
    const installed = resolve(project, '.agents/skills/ewai-prototype-iteration');
    assert.equal(existsSync(resolve(installed, 'SKILL.md')), true);
    assert.equal(existsSync(resolve(installed, 'agents/openai.yaml')), true);
    assert.equal(existsSync(resolve(installed, 'references/review-contract.md')), true);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('npm dry-run contains the complete persona-guided prototype iteration capability', () => {
  const cache = mkdtempSync(resolve(tmpdir(), 'ewai-prototype-npm-cache-'));
  try {
    const result = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, npm_config_cache: cache },
    }));
    const files = new Set(result[0].files.map(({ path }) => path));
    for (const path of [
      'config/prototype-iteration.schema.json',
      'src/prototype-iterations.mjs',
      'src/runtime/prototype-iterations.mjs',
      'skills-src/ewai-prototype-iteration/SKILL.md',
      'skills-src/ewai-prototype-iteration/agents/openai.yaml',
      'skills-src/ewai-prototype-iteration/references/review-contract.md',
      'Docs/persona-guided-prototype-iteration.md',
      'Docs/screen-prototype-creation-guide.md',
    ]) assert.equal(files.has(path), true, `missing package path: ${path}`);
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});
