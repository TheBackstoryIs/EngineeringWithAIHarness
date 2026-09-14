import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { scanPublicationFiles, publicationIssues, checkPublication } from '../scripts/publication-check.mjs';

const keyCanary = ['sk', 'live', 'publicationcanary00000000'].join('_');
const originDateCanary = '2030-01-28';

test('rejects private roots, development endpoints and internal provenance without quoting their values', () => {
  const values = [
    ['', 'Users', 'private-operator', 'Development', 'app'].join('/'),
    ['', 'home', 'private-operator', 'workspace'].join('/'),
    ['https://api', 'dev', 'backstory', 'is'].join('.'),
    ['BusinessOps', 'private-project', 'plan.md'].join('/'),
    ['Originally generated via investigation', originDateCanary].join(' '),
    keyCanary,
    ['https://operator', 'private-password@example.invalid'].join(':'),
    '-----BEGIN ' + 'PRIVATE KEY-----',
  ];
  for (const value of values) {
    const issues = publicationIssues('src/example.mjs', `safe first line\n${value}\n`);
    assert.ok(issues.length, 'The canary must be rejected');
    assert.equal(issues[0].line, 2);
    assert.equal(issues[0].file, 'src/example.mjs');
    assert.deepEqual(Object.keys(issues[0]).sort(), ['category', 'file', 'line']);
    assert.equal(JSON.stringify(issues).includes(value), false, 'Diagnostics must not repeat sensitive content');
  }
});

test('retains deterministic example dates, portable paths and public product attribution', () => {
  const example = 'Backstory\nconst createdAt = "2026-01-28T12:00:00Z";\n~/.codex/skills\nhttps://www.conversationalcoding.dev/personas/';
  assert.deepEqual(publicationIssues('Docs/example.md', example), []);
});

test('rejects private state, internal source, credential files and unsafe paths', () => {
  for (const path of ['SPECS/private.md', '.ewai-pipeline/project.json', 'src/migration/internal.md', '.env', '.npmrc', 'config/key.pem', '../outside.txt', '/absolute.txt']) {
    assert.ok(publicationIssues(path, '').length, 'Private or unsafe paths must be rejected');
  }
  assert.deepEqual(publicationIssues('.ewai-pipeline/.gitignore', '*\n!.gitignore'), []);
  assert.deepEqual(publicationIssues('.env.example', 'API_KEY=your-key'), []);
});

test('fails closed on missing candidates and never follows symlinks', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-publication-canary-'));
  try {
    mkdirSync(resolve(root, 'src'));
    writeFileSync(resolve(root, 'src/private.txt'), keyCanary);
    symlinkSync(resolve(root, 'src/private.txt'), resolve(root, 'src/link.txt'));
    const issues = scanPublicationFiles(root, ['src/link.txt', 'src/missing.txt']);
    assert.deepEqual(issues.map(i => i.category).sort(), ['missing-file', 'symlink']);
    assert.equal(JSON.stringify(issues).includes(keyCanary), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('repository enumeration includes untracked public files but excludes ignored private state', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-publication-tree-'));
  try {
    execFileSync('git', ['init', '--quiet', root]);
    writeFileSync(resolve(root, '.gitignore'), 'SPECS/\n');
    mkdirSync(resolve(root, 'SPECS'));
    writeFileSync(resolve(root, 'SPECS/private.md'), keyCanary);
    writeFileSync(resolve(root, 'safe.md'), '# Public documentation');
    const script = resolve('scripts/publication-check.mjs');
    const passed = JSON.parse(execFileSync(process.execPath, [script, '--project', root, '--source-only'], { encoding: 'utf8' }));
    assert.equal(passed.status, 'pass');
    writeFileSync(resolve(root, 'unsafe.md'), keyCanary);
    assert.throws(() => execFileSync(process.execPath, [script, '--project', root, '--source-only'], { encoding: 'utf8', stdio: 'pipe' }), error => {
      assert.equal(error.status, 1);
      const result = JSON.parse(error.stdout);
      assert.equal(result.status, 'fail');
      assert.equal(result.findings[0].file, 'unsafe.md');
      assert.equal(error.stdout.includes(keyCanary), false);
      assert.equal(error.stderr.includes(keyCanary), false);
      return true;
    });
    assert.throws(() => execFileSync(process.execPath, [script, '--project', root, '--source-only', '--quiet'], { encoding: 'utf8', stdio: 'pipe' }), error => {
      assert.equal(error.status, 1);
      assert.equal(error.stdout, '');
      assert.equal(JSON.parse(error.stderr).status, 'fail');
      assert.equal(error.stderr.includes(keyCanary), false);
      return true;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('also scans package-only files even when git ignores them', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-publication-pack-only-'));
  try {
    execFileSync('git', ['init', '--quiet', root]);
    writeFileSync(resolve(root, '.gitignore'), 'config/private/\n');
    mkdirSync(resolve(root, 'config/private'), { recursive: true });
    writeFileSync(resolve(root, 'config/private/unsafe.txt'), keyCanary);
    writeFileSync(resolve(root, 'package.json'), JSON.stringify({ name: 'publication-test-fixture', version: '1.0.0', files: ['config/private/unsafe.txt'] }));
    assert.equal(checkPublication(root, { sourceOnly: true }).status, 'pass');
    const result = checkPublication(root);
    assert.equal(result.status, 'fail');
    assert.ok(result.findings.some(f => f.file === 'config/private/unsafe.txt' && f.category === 'stripe-secret'));
    assert.equal(JSON.stringify(result).includes(keyCanary), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
