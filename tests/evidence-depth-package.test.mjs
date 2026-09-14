import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { install } from '../src/install.mjs';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('ships the reproducible evidence-depth skill and user guide', () => {
  const skill = read('skills-src/ewai-evidence-depth/SKILL.md');
  const contract = read('skills-src/ewai-evidence-depth/references/evidence-depth-contract.md');
  const agent = read('skills-src/ewai-evidence-depth/agents/openai.yaml');
  const guide = read('Docs/reproducible-archaeology-and-discovery-depth.md');
  const example = read('Docs/examples/reproducible-archaeology-depth-example.md');
  const checklist = read('Docs/quality/reproducible-archaeology-depth-review-checklist.md');
  const docs = read('Docs/README.md');
  const catalogue = read('Docs/guide-catalogue.md');
  const readme = read('README.md');
  assert.match(skill, /^---\nname: ewai-evidence-depth\n/);
  assert.match(skill, /architecture, data, security, product, delivery, governance, and operations/);
  assert.match(skill, /fresh (?:EWAI )?Source Map/i);
  assert.match(skill, /active ensemble/i);
  assert.match(skill, /premium.+installed/is);
  assert.doesNotMatch(skill, /persona premium sync|premium persona (?:sync|download)/i);
  assert.match(skill, /does not approve Build|cannot create.+Build/is);
  assert.match(contract, /Stable identity/);
  assert.match(contract, /unexplained variance/i);
  assert.match(agent, /\$ewai-evidence-depth/);
  assert.match(guide, /Guided Setup/);
  assert.match(guide, /depth-prepare/);
  assert.match(guide, /ewai_evidence_depth_prepare/);
  assert.match(guide, /does not rescan|without rescanning/i);
  assert.match(guide, /does not send feedback/i);
  assert.match(guide, /How consistency is achieved/);
  assert.match(example, /different explanatory wording/);
  assert.match(example, /GAP-<dimension>-<digest>/);
  assert.ok(checklist.includes('../maintainers/evidence-depth-acceptance.md'));
  const acceptance = read('Docs/maintainers/evidence-depth-acceptance.md');
  assert.match(acceptance, /at least three clean sessions/);
  assert.match(acceptance, /unexplained comparison variance/);
  assert.match(docs, /guide-catalogue\.md/);
  assert.match(catalogue, /reproducible-archaeology-and-discovery-depth\.md/);
  assert.match(catalogue, /quality\/reproducible-archaeology-depth-review-checklist\.md/);
  assert.ok(readme.includes('Docs/guide-catalogue.md'));
  assert.match(catalogue, /reproducible-archaeology-and-discovery-depth\.md/);
});

test('installs the evidence-depth skill with all host-facing metadata', () => {
  const project = mkdtempSync(resolve(tmpdir(), 'ewai-evidence-depth-install-'));
  try {
    install({ scope: 'project', projectRoot: project, host: 'codex', mode: 'copy' });
    const installed = resolve(project, '.agents/skills/ewai-evidence-depth');
    assert.equal(existsSync(resolve(installed, 'SKILL.md')), true);
    assert.equal(existsSync(resolve(installed, 'agents/openai.yaml')), true);
    assert.equal(existsSync(resolve(installed, 'references/evidence-depth-contract.md')), true);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('npm dry-run contains the complete evidence-depth capability without publishing', () => {
  const cache = mkdtempSync(resolve(tmpdir(), 'ewai-evidence-depth-npm-cache-'));
  try {
    const result = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, npm_config_cache: cache },
    }));
    const files = new Set(result[0].files.map(({ path }) => path));
    for (const path of [
      'config/evidence-depth.schema.json',
      'src/evidence-depth.mjs',
      'src/runtime/evidence-depth-workspace.mjs',
      'skills-src/ewai-evidence-depth/SKILL.md',
      'skills-src/ewai-evidence-depth/agents/openai.yaml',
      'skills-src/ewai-evidence-depth/references/evidence-depth-contract.md',
      'Docs/reproducible-archaeology-and-discovery-depth.md',
      'Docs/examples/reproducible-archaeology-depth-example.md',
      'Docs/quality/reproducible-archaeology-depth-review-checklist.md',
    ]) assert.equal(files.has(path), true, `missing package path: ${path}`);
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});
