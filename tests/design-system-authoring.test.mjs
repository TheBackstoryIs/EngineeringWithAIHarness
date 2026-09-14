import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { initProject } from '../src/project.mjs';
import {
  installDesignSystemCandidate,
  previewDesignSystemInstallation,
  validateDesignSystemCandidate,
} from '../src/design-system-authoring.mjs';
import { listDesignSystems } from '../src/design-systems.mjs';

function candidate(root, id = 'org.northstar.design-system') {
  const folder = resolve(root, id.replaceAll('.', '-'));
  mkdirSync(resolve(folder, 'principles'), { recursive: true });
  writeFileSync(resolve(folder, 'pack.yaml'), YAML.stringify({
    schema: 'ewai.pack/v1', id, name: 'Northstar Design', description: 'Reviewed candidate.',
    version: '1.0.0', type: 'design-system', requires: [],
    design_system: {
      compatibility: { ewai: '0.x' },
      provenance: { kind: 'owner-declared', summary: 'Owner-declared product principles.' },
      contributions: [{ id: 'principles', kind: 'principles', title: 'Principles', source: 'principles/core.md', applicability: ['ui-design'], required: true }],
    },
  }, { lineWidth: 0 }));
  writeFileSync(resolve(folder, 'principles/core.md'), '# Principles\n\nUse established components.\n');
  return folder;
}

test('validates a candidate through the installed-pack parser without changing it', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-design-candidate-'));
  try {
    const folder = candidate(root);
    const before = `${readFileSync(resolve(folder, 'pack.yaml'))}${readFileSync(resolve(folder, 'principles/core.md'))}`;
    const result = validateDesignSystemCandidate(folder);
    assert.equal(result.schema, 'ewai.design-system-candidate/v1');
    assert.equal(result.id, 'org.northstar.design-system');
    assert.match(result.digest, /^sha256:/);
    assert.equal(result.contributions[0].id, 'principles');
    assert.equal(JSON.stringify(result).includes('Use established components'), false);
    assert.equal(`${readFileSync(resolve(folder, 'pack.yaml'))}${readFileSync(resolve(folder, 'principles/core.md'))}`, before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('previews and installs candidates only to explicit project or personal roots', () => {
  const project = mkdtempSync(resolve(tmpdir(), 'ewai-design-author-project-'));
  const source = mkdtempSync(resolve(tmpdir(), 'ewai-design-author-source-'));
  const home = mkdtempSync(resolve(tmpdir(), 'ewai-design-author-home-'));
  try {
    initProject(project, { name: 'Authoring fixture' });
    const folder = candidate(source);
    const projectPreview = previewDesignSystemInstallation(project, folder, { scope: 'project', home });
    assert.equal(projectPreview.scope, 'project');
    assert.equal(projectPreview.conflict, false);
    assert.equal(projectPreview.destination.startsWith(resolve(project, '.ewai-pipeline/packs')), true);
    const installed = installDesignSystemCandidate(project, folder, {
      scope: 'project', home, expectedDigest: projectPreview.digest, confirmed: true,
    });
    assert.equal(installed.status, 'installed');
    assert.equal(existsSync(resolve(installed.destination, 'pack.yaml')), true);
    assert.equal(listDesignSystems({ projectRoot: project, home }).some(({ id }) => id === projectPreview.id), true);
    assert.throws(() => installDesignSystemCandidate(project, folder, {
      scope: 'project', home, expectedDigest: projectPreview.digest, confirmed: true,
    }), /already installed|already exists/i);

    const personalFolder = candidate(source, 'org.northstar.personal-design');
    const personalPreview = previewDesignSystemInstallation(project, personalFolder, { scope: 'personal', home });
    assert.equal(personalPreview.destination.startsWith(resolve(home, '.ewai/packs')), true);
    installDesignSystemCandidate(project, personalFolder, {
      scope: 'personal', home, expectedDigest: personalPreview.digest, confirmed: true,
    });
    assert.equal(existsSync(personalPreview.destination), true);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(source, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('refuses confirmation absence, digest drift and injected failure without touching source or destination', () => {
  const project = mkdtempSync(resolve(tmpdir(), 'ewai-design-author-safety-'));
  const source = mkdtempSync(resolve(tmpdir(), 'ewai-design-author-input-'));
  const home = mkdtempSync(resolve(tmpdir(), 'ewai-design-author-safe-home-'));
  try {
    initProject(project, { name: 'Authoring safety fixture' });
    const folder = candidate(source);
    const preview = previewDesignSystemInstallation(project, folder, { scope: 'project', home });
    const before = readFileSync(resolve(folder, 'principles/core.md'), 'utf8');
    assert.throws(() => installDesignSystemCandidate(project, folder, {
      scope: 'project', home, expectedDigest: preview.digest,
    }), /confirmation/i);
    writeFileSync(resolve(folder, 'principles/core.md'), `${before}\nChanged after preview.\n`);
    assert.throws(() => installDesignSystemCandidate(project, folder, {
      scope: 'project', home, expectedDigest: preview.digest, confirmed: true,
    }), /digest drift/i);
    assert.equal(existsSync(preview.destination), false);

    const nextPreview = previewDesignSystemInstallation(project, folder, { scope: 'project', home });
    assert.throws(() => installDesignSystemCandidate(project, folder, {
      scope: 'project', home, expectedDigest: nextPreview.digest, confirmed: true,
      beforeCommit: () => { throw new Error('injected interruption'); },
    }), /injected interruption/i);
    assert.equal(existsSync(nextPreview.destination), false);
    assert.equal(readFileSync(resolve(folder, 'principles/core.md'), 'utf8').includes('Changed after preview'), true);
    const parentEntries = readdirSync(resolve(project, '.ewai-pipeline/packs'));
    assert.equal(parentEntries.some((name) => name.includes('.stage-')), false);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(source, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('author skill preserves evidence classes, persona visibility and premium privacy boundaries', () => {
  const skill = readFileSync('skills-src/ewai-design-system-author/SKILL.md', 'utf8');
  for (const phrase of ['owner-declared', 'observed', 'inferred', 'conflict', 'design-system validate', 'design-system install', 'expected-digest', 'project-local', 'personal', 'active persona', 'premium']) {
    assert.match(skill.toLowerCase(), new RegExp(phrase));
  }
  assert.match(skill, /must not.*premium persona bod|never.*premium persona bod/is);
  assert.match(skill, /must not.*select|never.*select/is);
  assert.doesNotMatch(skill, /TODO|Refined/);
});
