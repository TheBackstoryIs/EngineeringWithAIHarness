import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { install } from '../src/install.mjs';

test('installs the complete public delivery skill without private project tooling', () => {
  const home = mkdtempSync(resolve(tmpdir(), 'ewai-public-delivery-'));
  try {
    install({ scope: 'global', host: 'codex', mode: 'copy', home, installBin: false });
    const skill = resolve(home, '.codex/skills/ewai-deliver');
    assert.equal(existsSync(resolve(skill, 'references/phase-routing.md')), true);
    assert.equal(existsSync(resolve(skill, 'references/canonical-commands')), false);
    assert.equal(existsSync(resolve(skill, 'references/support-tools')), false);
    assert.equal(existsSync(resolve(skill, 'scripts/canonical-checkers')), false);
    assert.doesNotMatch(readFileSync(resolve(skill, 'SKILL.md'), 'utf8'), /Backstory/i);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('packages only public source while retaining the analyser and canonical gate protections', () => {
  const cache = mkdtempSync(resolve(tmpdir(), 'ewai-public-pack-'));
  try {
    const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      encoding: 'utf8', env: { ...process.env, npm_config_cache: cache },
    }))[0];
    const paths = new Set(packed.files.map(file => file.path));
    assert.equal(paths.has('src/runtime/tree-sitter-index.mjs'), true);
    assert.equal(paths.has('scripts/publication-check.mjs'), true);
    for (const path of paths) assert.doesNotMatch(path, /^(?:src\/migration\/|SPECS\/|packs\/personas\/premium\/)|source-manifest\.json$|workflow-migration-map\.json$/);
    const delivery = `${readFileSync(resolve('src/delivery.mjs'), 'utf8')}\n${readFileSync(resolve('src/delivery-gates.mjs'), 'utf8')}`;
    const index = readFileSync(resolve('src/runtime/repository-index.mjs'), 'utf8');
    const mcp = readFileSync(resolve('src/runtime/mcp-server.mjs'), 'utf8');
    assert.match(delivery, /EWAI deterministic gate check/);
    assert.match(index, /extractTreeSitterFacts/);
    assert.doesNotMatch(mcp, /['"]ewai_set_phase['"]/);
    assert.equal(existsSync(resolve('src/migration')), false);
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});

test('portable analyser retains supported grammars and safe parser failures', async () => {
  const { extractTreeSitterFacts, parseStoredJson } = await import('../src/runtime/tree-sitter-index.mjs');
  const fixtures = [
    ['example.php', '<?php class Demo { public function run() { return true; } }'],
    ['example.mjs', 'export function Demo() { return true; }'],
    ['example.ts', 'export function Demo(): boolean { return true; }'],
    ['example.tsx', 'export function Demo() { return <section>Demo</section>; }'],
    ['example.vue', '<script setup lang="ts">function submit() { return true; }</script><template><button @click="submit">Submit</button></template>'],
  ];
  for (const [path, content] of fixtures) {
    const result = extractTreeSitterFacts(path, content, { repo: 'application', repoRelative: value => value });
    assert.equal(result.file.parserStatus, 'parsed', path);
    assert.equal(result.file.parseErrorCount, 0, path);
    assert.ok(result.symbols.length + result.relationships.length + result.spans.length > 0, path);
  }
  assert.deepEqual(parseStoredJson('invalid', []), []);
});

test('publication lifecycle preserves machine-readable npm pack output', () => {
  const cache = mkdtempSync(resolve(tmpdir(), 'ewai-public-pack-json-'));
  try {
    const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], {
      encoding: 'utf8', env: { ...process.env, npm_config_cache: cache, npm_config_update_notifier: 'false' },
    }));
    assert.equal(packed.length, 1);
    assert.ok(packed[0].files.some(file => file.path === 'src/runtime/tree-sitter-index.mjs'));
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});

test('installs and advertises governed autonomy without replacing delivery or human approval', () => {
  const home = mkdtempSync(resolve(tmpdir(), 'ewai-autonomy-skill-'));
  try {
    install({ scope: 'global', host: 'codex', mode: 'copy', home, installBin: false });
    const skill = resolve(home, '.codex/skills/ewai-autonomy');
    assert.equal(existsSync(resolve(skill, 'SKILL.md')), true);
    assert.equal(existsSync(resolve(skill, 'agents/openai.yaml')), true);
    const body = readFileSync(resolve(skill, 'SKILL.md'), 'utf8');
    assert.match(body, /^---\nname: ewai-autonomy\n/);
    assert.match(body, /exact intent.+pool|exact pool/is);
    assert.match(body, /off by default/i);
    assert.match(body, /preview.+not.+permission/is);
    assert.match(body, /Build approval/i);
    assert.match(body, /Manual QA/i);
    assert.match(body, /cancel.+not.+confirm.+terminat/is);
    assert.match(body, /\$ewai-deliver/);
    assert.doesNotMatch(body, /\]\((?:\.\.?\/)+/, 'a copied skill cannot link outside its installed subtree');
    assert.match(body, /instructions above remain usable when only the skill subtree is installed/i);
    assert.doesNotMatch(body, /(?:skip|waive).+(?:gate|standard|review)/i);
    const delivery = readFileSync(resolve('skills-src/ewai-deliver/SKILL.md'), 'utf8');
    assert.match(delivery, /\$ewai-autonomy/);
    assert.match(delivery, /existing.*human.*approval|human.*approval.*separate/is);
    const guide = readFileSync(resolve('Docs/autonomous-intent-delivery.md'), 'utf8');
    assert.match(guide, /npm consumer|consumer project/i);
    assert.match(guide, /preview.+not.+permission/is);
    assert.match(guide, /cancel.+not.+confirm.+terminat/is);
    assert.match(guide, /Manual QA/i);
    assert.match(guide, /provider-reported.+not.+hard money cap/is);
    assert.match(guide, /--expires-at \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/);
    assert.match(guide, /macOS.+2\.1\.257.+conformance/is);
    assert.match(readFileSync(resolve('Docs/guide-catalogue.md'), 'utf8'), /autonomous-intent-delivery\.md/);
    assert.match(readFileSync(resolve('Docs/README.md'), 'utf8'), /autonomous-intent-delivery\.md/);
    const check = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).scripts.check;
    for (const path of ['src/autonomy.mjs', 'src/autonomy-phase-contracts.mjs', 'src/autonomy-worker.mjs',
      'src/runtime/autonomy-supervisor.mjs', 'src/runtime/autonomy-operations.mjs',
      'src/runtime/autonomy-workers.mjs', 'src/runtime/autonomy-workspace.mjs', 'public/autonomy.js']) {
      assert.ok(check.includes(`node --check ${path}`), path);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});
