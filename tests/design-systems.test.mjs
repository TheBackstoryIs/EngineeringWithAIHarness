import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import { initProject, loadProjectConfig } from '../src/project.mjs';
import {
  DEFAULT_DESIGN_SYSTEM_ID,
  designSystemStatus,
  listDesignSystems,
  projectDesignSystem,
  resolveDesignSystem,
  selectDesignSystem,
} from '../src/design-systems.mjs';

function manifest(id = 'org.northstar.design-system', overrides = {}) {
  return {
    schema: 'ewai.pack/v1',
    id,
    name: `${id} design system`,
    description: 'Reviewed design guidance.',
    version: '1.0.0',
    type: 'design-system',
    requires: [],
    design_system: {
      compatibility: { ewai: '0.x' },
      provenance: { kind: 'owner-declared', summary: 'Approved design-system source.' },
      contributions: [
        {
          id: 'experience-promise',
          kind: 'principles',
          title: 'Experience promise',
          source: 'principles/experience.md',
          applicability: ['ui-design', 'prototype'],
          required: true,
        },
      ],
    },
    ...overrides,
  };
}

function writePack(root, pack = manifest(), files = {}) {
  const directory = resolve(root, pack.id.replaceAll('.', '-'));
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'pack.yaml'), YAML.stringify(pack, { lineWidth: 0 }));
  for (const [relative, content] of Object.entries({
    'principles/experience.md': '# Experience\n\nCalm, connected and accountable.\n',
    ...files,
  })) {
    const path = resolve(directory, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return directory;
}

test('bundles the agreed portable fallback and safely projects it', () => {
  const catalogue = listDesignSystems();
  const fallback = catalogue.find(({ id }) => id === DEFAULT_DESIGN_SYSTEM_ID);
  assert.ok(fallback);
  assert.equal(fallback.sourceClass, 'bundled');
  assert.match(fallback.digest, /^sha256:[a-f0-9]{64}$/);
  const content = fallback.design_system.contributions.map(({ content }) => content).join('\n');
  for (const phrase of ['calm, connected, accountable', 'purpose', 'agency', 'responsibility', 'familiar', 'flexib', 'simplicity', 'craft', 'delight', 'empty', 'error', 'self-critique']) {
    assert.match(content.toLowerCase(), new RegExp(phrase));
  }
  assert.doesNotMatch(content, /Backstory|BSIS-|purple|violet|logo/i);
  const safe = projectDesignSystem(fallback);
  assert.equal(JSON.stringify(safe).includes(fallback.packRoot), false);
  assert.equal(JSON.stringify(safe).includes('calm, connected, accountable'), false);
});

test('resolves dependencies deterministically and requires qualified replacements', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-design-resolve-'));
  try {
    writePack(root, manifest('org.northstar.foundation'));
    writePack(root, manifest('org.northstar.product', {
      requires: ['org.northstar.foundation'],
      design_system: {
        ...manifest().design_system,
        contributions: [{
          ...manifest().design_system.contributions[0],
          title: 'Product promise',
          replaces: ['org.northstar.foundation:experience-promise'],
        }],
      },
    }));
    const catalogue = listDesignSystems({ roots: [{ path: root, sourceClass: 'project' }] });
    const resolved = resolveDesignSystem('org.northstar.product', catalogue);
    assert.deepEqual(resolved.packs.map(({ id }) => id), ['org.northstar.foundation', 'org.northstar.product']);
    assert.deepEqual(resolved.contributions.map(({ qualifiedId }) => qualifiedId), ['org.northstar.product:experience-promise']);
    assert.match(resolved.effectiveDigest, /^sha256:[a-f0-9]{64}$/);

    rmSync(root, { recursive: true, force: true });
    mkdirSync(root);
    writePack(root, manifest('org.northstar.foundation'));
    writePack(root, manifest('org.northstar.product', { requires: ['org.northstar.foundation'] }));
    assert.throws(
      () => resolveDesignSystem('org.northstar.product', listDesignSystems({ roots: [root] })),
      /ambiguous contribution.*experience-promise/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects duplicate packs, missing dependencies, cycles and incompatibility', () => {
  const first = mkdtempSync(resolve(tmpdir(), 'ewai-design-first-'));
  const second = mkdtempSync(resolve(tmpdir(), 'ewai-design-second-'));
  try {
    writePack(first);
    writePack(second);
    assert.throws(() => listDesignSystems({ roots: [first, second] }), /duplicate design-system id/i);

    rmSync(second, { recursive: true, force: true });
    mkdirSync(second);
    writePack(second, manifest('org.northstar.product', { requires: ['org.northstar.missing'] }));
    assert.throws(() => resolveDesignSystem('org.northstar.product', listDesignSystems({ roots: [second] })), /missing dependency/i);

    rmSync(first, { recursive: true, force: true });
    mkdirSync(first);
    writePack(first, manifest('org.northstar.one', { requires: ['org.northstar.two'] }));
    writePack(first, manifest('org.northstar.two', { requires: ['org.northstar.one'] }));
    assert.throws(() => resolveDesignSystem('org.northstar.one', listDesignSystems({ roots: [first] })), /dependency cycle/i);

    rmSync(first, { recursive: true, force: true });
    mkdirSync(first);
    writePack(first, manifest('org.northstar.future', {
      design_system: { ...manifest().design_system, compatibility: { ewai: '1.x' } },
    }));
    const incompatible = listDesignSystems({ roots: [first] });
    assert.equal(projectDesignSystem(incompatible[0]).compatible, false);
    assert.throws(() => resolveDesignSystem('org.northstar.future', incompatible), /incompatible/i);
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
});

test('rejects traversal, symbolic links, remote sources, excessive content and digest drift', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-design-hostile-'));
  const outside = mkdtempSync(resolve(tmpdir(), 'ewai-design-outside-'));
  try {
    const traversing = manifest();
    traversing.design_system.contributions[0].source = '../outside.md';
    writePack(root, traversing);
    assert.throws(() => listDesignSystems({ roots: [root] }), /bounded relative path|escape/i);

    rmSync(root, { recursive: true, force: true });
    mkdirSync(root);
    const remote = manifest();
    remote.design_system.contributions[0].source = 'https://example.invalid/design.md';
    writePack(root, remote);
    assert.throws(() => listDesignSystems({ roots: [root] }), /bounded relative path|remote/i);

    rmSync(root, { recursive: true, force: true });
    mkdirSync(root);
    writeFileSync(resolve(outside, 'experience.md'), '# outside\n');
    const packRoot = writePack(root);
    rmSync(resolve(packRoot, 'principles/experience.md'));
    symlinkSync(resolve(outside, 'experience.md'), resolve(packRoot, 'principles/experience.md'));
    assert.throws(() => listDesignSystems({ roots: [root] }), /symbolic link|escape/i);

    rmSync(root, { recursive: true, force: true });
    mkdirSync(root);
    const directory = writePack(root);
    const options = { roots: [root], limits: { itemBytes: 80, totalBytes: 160 } };
    const before = listDesignSystems(options)[0].digest;
    writeFileSync(resolve(directory, 'principles/experience.md'), '# Changed\n');
    const after = listDesignSystems(options)[0].digest;
    assert.notEqual(after, before);
    writeFileSync(resolve(directory, 'principles/experience.md'), 'x'.repeat(81));
    assert.throws(() => listDesignSystems(options), /size limit/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('shows fallback and atomically records a named digest-safe project selection', () => {
  const project = mkdtempSync(resolve(tmpdir(), 'ewai-design-project-'));
  try {
    initProject(project, { name: 'Design-system project' });
    const packRoot = resolve(project, '.ewai-pipeline/packs');
    writePack(packRoot);
    const fallback = designSystemStatus(project);
    assert.equal(fallback.mode, 'fallback');
    assert.equal(fallback.approved, false);
    assert.equal(fallback.root.id, DEFAULT_DESIGN_SYSTEM_ID);

    const catalogue = listDesignSystems({ projectRoot: project });
    const preview = resolveDesignSystem('org.northstar.design-system', catalogue);
    assert.throws(() => selectDesignSystem(project, preview.root.id, {
      expectedDigest: `sha256:${'0'.repeat(64)}`,
      approvedBy: 'Design Owner',
    }), /digest drift/i);
    assert.equal(loadProjectConfig(project).config.design_system, undefined);

    const selected = selectDesignSystem(project, preview.root.id, {
      expectedDigest: preview.effectiveDigest,
      approvedBy: 'Design Owner',
      now: '2026-08-28T10:00:00.000Z',
    });
    assert.equal(selected.mode, 'selected');
    assert.equal(selected.approved, true);
    assert.equal(selected.approvedBy, 'Design Owner');
    assert.equal(designSystemStatus(project).effectiveDigest, preview.effectiveDigest);
    const config = loadProjectConfig(project).config.design_system;
    assert.equal(config.root.id, preview.root.id);
    assert.equal(config.effective_digest, preview.effectiveDigest);
    assert.equal(config.evidence, 'SPECS/5.Strategy/design-system.md');
    assert.match(readFileSync(resolve(project, config.evidence), 'utf8'), /Design Owner/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('common schemas expose design-system contracts independently of other pack types', () => {
  const packSchema = JSON.parse(readFileSync('config/pack.schema.json', 'utf8'));
  const projectSchema = JSON.parse(readFileSync('config/project.schema.json', 'utf8'));
  assert.equal(packSchema.properties.type.enum.includes('design-system'), true);
  assert.equal(packSchema.properties.design_system.$ref, 'design-system.schema.json');
  assert.equal(projectSchema.properties.design_system.$ref, '#/$defs/designSystemSelection');
});
