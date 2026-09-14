import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { listPacks } from '../src/packs.mjs';
import {
  createPersona,
  indexPersonas,
  listPersonas,
  personalPersonaRoot,
  projectPersonaRoot
} from '../src/personas.mjs';

test('discovers core and technology packs', () => {
  assert.equal(JSON.parse(readFileSync(resolve('config/pack.schema.json'), 'utf8')).$defs.sourceMapProfile.type, 'object');
  assert.equal(JSON.parse(readFileSync(resolve('config/project.schema.json'), 'utf8')).$defs.sourceMapProfile.type, 'object');
  const packs = listPacks();
  assert.equal(packs.some((pack) => pack.id === 'ewai.core'), true);
  assert.equal(packs.some((pack) => pack.id === 'ewai.technology.laravel'), true);
  assert.equal(packs.some((pack) => pack.id === 'ewai.technology.nuxt'), true);
  assert.equal(packs.some((pack) => pack.id === 'ewai.technology.power-platform'), true);
  assert.equal(packs.some((pack) => pack.id === 'ewai.technology.salesforce'), true);
  assert.equal(packs.some((pack) => pack.id === 'ewai.stack.laravel-nuxt'), true);
  for (const id of [
    'ewai.technology.laravel',
    'ewai.technology.nuxt',
    'ewai.technology.power-platform',
    'ewai.technology.salesforce',
    'ewai.stack.laravel-nuxt'
  ]) {
    const profiles = packs.find((pack) => pack.id === id)?.source_map?.profiles ?? [];
    assert.equal(profiles.length > 0, true);
    assert.equal(profiles.every((profile) => !('command' in profile) && !('module' in profile)), true);
  }
});

test('discovers and searches starter personas', () => {
  const root = resolve('packs/personas/core/personas');
  const personas = listPersonas([root], 'maintainability');
  assert.equal(personas.length, 1);
  assert.equal(personas[0].id, 'ewai.core.maintainer');
});

test('builds a compact persona capability index for contextual routing', () => {
  const root = resolve('packs/personas/core/personas');
  const index = indexPersonas([root], 'archaeology');

  assert.equal(index.some((persona) => persona.id === 'ewai.core.archaeologist'), true);
  assert.equal(index[0].capabilities.includes('project-archaeology'), true);
  assert.equal(typeof index[0].description, 'string');
  assert.equal('parseStatus' in index[0], false);
});

test('includes archaeology and SPECS curation in the free persona pack', () => {
  const root = resolve('packs/personas/core/personas');
  const personas = listPersonas([root]);
  const archaeologist = personas.find((persona) => persona.id === 'ewai.core.archaeologist');
  const curator = personas.find((persona) => persona.id === 'ewai.core.specs-knowledge-curator');

  assert.equal(archaeologist?.pack, 'ewai.personas.core');
  assert.equal(archaeologist?.capabilities.includes('project-archaeology'), true);
  assert.equal(archaeologist?.capabilities.includes('technology-discovery'), true);
  assert.equal(curator?.pack, 'ewai.personas.core');
  assert.equal(curator?.capabilities.includes('specs-routing'), true);
});

test('can search separately distributed personas with legacy metadata', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-legacy-persona-'));
  try {
    writeFileSync(resolve(root, 'dpo.md'), '---\nname: dpo\ndescription: Use: privacy review\n---\n\n# DPO\n');
    const personas = listPersonas([root], 'dpo');
    assert.equal(personas.some((persona) => persona.name === 'dpo'), true);
    assert.equal(personas[0].parseStatus, 'legacy-fallback');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('creates and discovers a reusable personal persona', () => {
  const home = mkdtempSync(resolve(tmpdir(), 'ewai-personal-home-'));
  try {
    const result = createPersona({
      scope: 'personal',
      slug: 'security-reviewer',
      name: 'Security Reviewer',
      category: 'engineering',
      home
    });

    assert.equal(result.id, 'personal.security-reviewer');
    assert.equal(result.path, resolve(home, '.ewai/personas/security-reviewer.md'));
    assert.equal(existsSync(result.path), true);
    assert.match(readFileSync(result.path, 'utf8'), /tier: personal/);
    assert.equal(listPersonas([personalPersonaRoot(home)])[0].id, 'personal.security-reviewer');
    assert.throws(
      () => createPersona({ scope: 'personal', slug: 'security-reviewer', home }),
      /already exists/
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('creates project-owned personas in the SPECS persona library', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-project-persona-'));
  try {
    const result = createPersona({
      scope: 'project',
      slug: 'finance-controller',
      projectRoot: root
    });

    assert.equal(result.id, 'project.finance-controller');
    assert.equal(result.path, resolve(root, 'SPECS/1.Scope/personas/project/finance-controller.md'));
    assert.equal(listPersonas([projectPersonaRoot(root)])[0].id, 'project.finance-controller');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
