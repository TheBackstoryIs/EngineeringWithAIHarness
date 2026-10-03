import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createIntent } from '../src/intents.mjs';
import { beginDelivery } from '../src/delivery.mjs';
import { initProject } from '../src/project.mjs';
import { selectDesignSystem } from '../src/design-systems.mjs';
import {
  applyDesignSystem,
  prepareDesignSystemApplication,
  validateDesignSystemReceipt,
} from '../src/design-system-application.mjs';

const cli = resolve(import.meta.dirname, '../bin/ewai');

const personas = [
  { id: 'core.product-designer', name: 'Product Designer', tier: 'core', category: 'design', description: 'Shapes interface design.', tags: ['design', 'prototype', 'interaction'] },
  { id: 'project.accessibility-owner', name: 'Accessibility Owner', tier: 'project', category: 'accessibility', description: 'Challenges accessible interaction.', tags: ['accessibility', 'interaction', 'states'] },
  { id: 'premium.content-strategist', name: 'Content Strategist', tier: 'premium', category: 'content', description: 'MANAGED PREMIUM BODY', tags: ['content', 'states', 'design'] },
  { id: 'personal.engineer', name: 'Interface Engineer', tier: 'personal', category: 'engineering', description: 'Checks implementation.', tags: ['engineering'] },
];

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-design-application-'));
  initProject(root, { name: 'Design application fixture' });
  createIntent(root, { slug: 'customer-portal', domain: 'experience', title: 'Customer Portal' });
  beginDelivery(root, 'customer-portal', { tool: 'codex', ui: true });
  return root;
}

test('prepares bounded transient design context and visible body-free persona evidence', () => {
  const root = fixture();
  try {
    const prepared = prepareDesignSystemApplication(root, 'customer-portal', {
      focus: 'prototype interaction content states accessibility', personaCatalogue: personas, now: '2026-08-28T12:00:00.000Z',
    });
    assert.equal(prepared.status, 'ready');
    assert.equal(prepared.designSystem.mode, 'fallback');
    assert.equal(prepared.designSystem.approved, false);
    assert.match(prepared.modelContext, /Experience promise/);
    assert.equal(prepared.receipt.schema, 'ewai.design-system-receipt/v1');
    assert.equal(prepared.receipt.context.selectedContributions.length, 5);
    assert.deepEqual(prepared.receipt.activePersonas.map(({ tier }) => tier).slice(0, 2), ['project', 'premium']);
    assert.equal(JSON.stringify(prepared.receipt).includes('MANAGED PREMIUM BODY'), false);
    assert.equal(JSON.stringify(prepared.receipt).includes(root), false);
    assert.equal('modelContext' in prepared.receipt, false);
    assert.match(prepared.receipt.authority.notices.join(' '), /cannot approve.*Manual QA/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mandatory design context overflow is non-ready and writes no receipt', () => {
  const root = fixture();
  try {
    const prepared = prepareDesignSystemApplication(root, 'customer-portal', { budgetTokens: 4, personaCatalogue: personas });
    assert.equal(prepared.status, 'non-ready');
    assert.equal(prepared.reason, 'mandatory-overflow');
    assert.equal(prepared.modelContext, null);
    assert.equal(prepared.receipt, null);
    assert.deepEqual(prepared.recovery, ['narrow-focus', 'increase-budget', 'split-operation']);
    assert.equal(existsSync(resolve(root, 'SPECS/6.Build/customer-portal/ui-design-assets/design-system')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('applies once as an immutable digest-addressed receipt and validates its linkage fields', () => {
  const root = fixture();
  try {
    const applied = applyDesignSystem(root, 'customer-portal', {
      focus: 'prototype interaction', personaCatalogue: personas, now: '2026-08-28T12:00:00.000Z',
    });
    assert.equal(applied.status, 'applied');
    assert.match(applied.receiptPath, /^ui-design-assets\/design-system\/receipt-[a-f0-9]{64}\.json$/);
    assert.equal(existsSync(resolve(root, 'SPECS/6.Build/customer-portal', applied.receiptPath)), true);
    assert.equal(existsSync(resolve(root, 'SPECS/6.Build/customer-portal', applied.summaryPath)), true);
    const validated = validateDesignSystemReceipt(resolve(root, 'SPECS/6.Build/customer-portal'), applied.receiptPath);
    assert.equal(validated.digest, applied.receiptDigest);
    const before = readFileSync(resolve(root, 'SPECS/6.Build/customer-portal', applied.receiptPath), 'utf8');
    const repeated = applyDesignSystem(root, 'customer-portal', {
      focus: 'prototype interaction', personaCatalogue: personas, now: '2026-08-28T12:00:00.000Z',
    });
    assert.equal(repeated.receiptPath, applied.receiptPath);
    assert.equal(readFileSync(resolve(root, 'SPECS/6.Build/customer-portal', applied.receiptPath), 'utf8'), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('applies the active design system through the documented CLI without exposing model context', () => {
  const root = fixture();
  try {
    const result = JSON.parse(execFileSync(process.execPath, [
      cli, 'design-system', 'apply', 'customer-portal', '--focus', 'prototype interaction', '--project', root, '--json',
    ], { encoding: 'utf8' }));
    assert.equal(result.status, 'applied');
    assert.match(result.receiptPath, /receipt-[a-f0-9]{64}\.json$/);
    assert.equal(JSON.stringify(result).includes('modelContext'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('local preparation stays within the engineering performance budget', t => {
  const root = fixture();
  try {
    const beforeRss = process.memoryUsage().rss;
    let peakRss = beforeRss;
    const timings = [];
    for (let index = 0; index < 15; index += 1) {
      const start = process.hrtime.bigint();
      prepareDesignSystemApplication(root, 'customer-portal', { focus: 'prototype', personaCatalogue: personas });
      timings.push(Number(process.hrtime.bigint() - start) / 1_000_000);
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }
    timings.sort((left, right) => left - right);
    const medianMs = timings[Math.floor(timings.length / 2)];
    const rssGrowth = Math.max(0, peakRss - beforeRss);
    t.diagnostic(JSON.stringify({ samples: 15, medianMs, peakRssGrowthBytes: rssGrowth, maximumMedianMs: 75, maximumRssGrowthBytes: 32 * 1024 * 1024 }));
    assert.ok(medianMs <= 75, `median ${medianMs} ms`);
    assert.ok(rssGrowth <= 32 * 1024 * 1024, `RSS growth ${rssGrowth} bytes`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unchanged preparation validates the catalogue once without reparsing resolved content', t => {
  const root = fixture(), manifest = resolve(import.meta.dirname, '../packs/design-systems/default/pack.yaml');
  try {
    const options = { focus: 'prototype', personaCatalogue: personas, now: '2026-08-28T12:00:00.000Z' };
    const first = prepareDesignSystemApplication(root, 'customer-portal', options);
    const originalRead = fs.readFileSync;
    let reads = 0;
    const mock = t.mock.method(fs, 'readFileSync', function(path, ...args) {
      if (String(path) === manifest) reads += 1;
      return originalRead.call(this, path, ...args);
    });
    syncBuiltinESMExports();
    try {
      const next = prepareDesignSystemApplication(root, 'customer-portal', options);
      assert.equal(next.modelContext, first.modelContext);
      assert.deepEqual(next.receipt, first.receipt);
      assert.deepEqual(next.context.fidelity, first.context.fidelity);
      assert.equal(reads, 1, 'fresh validation must read once; duplicate resolution must not parse again');
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('resolved-content reuse cannot hide source changes, selection drift or symbolic content', () => {
  const root = fixture();
  try {
    const pack = resolve(root, 'test-pack');
    cpSync(resolve(import.meta.dirname, '../packs/design-systems/default'), pack, { recursive: true });
    const options = { roots: [{ path: pack, sourceClass: 'project' }], focus: 'prototype', personaCatalogue: personas };
    const first = prepareDesignSystemApplication(root, 'customer-portal', options);
    const target = resolve(pack, 'experience-promise.md');
    const original = readFileSync(target, 'utf8');
    writeFileSync(target, original + '\nFresh design source canary.\n');
    const changed = prepareDesignSystemApplication(root, 'customer-portal', options);
    assert.notEqual(changed.designSystem.effectiveDigest, first.designSystem.effectiveDigest);
    assert.match(changed.modelContext, /Fresh design source canary/);
    selectDesignSystem(root, 'ewai.design-system.default', { ...options, approvedBy: 'Fixture owner', expectedDigest: changed.designSystem.effectiveDigest });
    const selected = prepareDesignSystemApplication(root, 'customer-portal', options);
    assert.equal(selected.designSystem.approved, true);
    writeFileSync(target, original + '\nChanged after selection.\n');
    assert.throws(() => prepareDesignSystemApplication(root, 'customer-portal', options), /stale/);
    writeFileSync(target, original + '\nFresh design source canary.\n');
    assert.equal(prepareDesignSystemApplication(root, 'customer-portal', options).status, 'ready');
    const outside = resolve(root, 'symlink-source.md');
    writeFileSync(outside, readFileSync(target));
    fs.unlinkSync(target); symlinkSync(outside, target);
    assert.throws(() => prepareDesignSystemApplication(root, 'customer-portal', options), /symbolic link/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('resolved-content reuse keeps one project entry and rejects cold source races', t => {
  const root = fixture(), other = fixture();
  const manifest = resolve(import.meta.dirname, '../packs/design-systems/default/pack.yaml');
  try {
    const options = { focus: 'prototype', personaCatalogue: personas };
    prepareDesignSystemApplication(root, 'customer-portal', options);
    prepareDesignSystemApplication(other, 'customer-portal', options);
    const originalRead = fs.readFileSync;
    let reads = 0;
    const mock = t.mock.method(fs, 'readFileSync', function(path, ...args) {
      if (String(path) === manifest) reads += 1;
      return originalRead.call(this, path, ...args);
    });
    syncBuiltinESMExports();
    try {
      prepareDesignSystemApplication(root, 'customer-portal', options);
      assert.equal(reads, 2, 'returning to an evicted project requires a fresh resolution');
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }

    const pack = resolve(root, 'race-pack');
    cpSync(resolve(import.meta.dirname, '../packs/design-systems/default'), pack, { recursive: true });
    let packReads = 0;
    const race = t.mock.method(fs, 'readFileSync', function(path, ...args) {
      if (String(path) === resolve(pack, 'pack.yaml') && ++packReads === 2) {
        const source = resolve(pack, 'experience-promise.md');
        writeFileSync(source, originalRead(source, 'utf8') + '\nChanged between validation and resolution.\n');
      }
      return originalRead.call(this, path, ...args);
    });
    syncBuiltinESMExports();
    try {
      assert.throws(() => prepareDesignSystemApplication(root, 'customer-portal', { ...options,
        roots: [{ path: pack, sourceClass: 'project' }] }), /changed during preparation/);
      assert.equal(packReads, 2, 'the fixture must inject the actual cold-resolution race');
    } finally { race.mock.restore(); syncBuiltinESMExports(); }
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); }
});

test('oversized resolved content is never retained and provenance changes invalidate reuse', t => {
  const root = fixture();
  try {
    const pack = resolve(root, 'large-pack');
    cpSync(resolve(import.meta.dirname, '../packs/design-systems/default'), pack, { recursive: true });
    const options = { focus: 'prototype', personaCatalogue: personas, roots: [{ path: pack, sourceClass: 'project' }] };
    const first = prepareDesignSystemApplication(root, 'customer-portal', options);
    first.receipt.designSystem.packs[0].sourceClass = 'forged';
    assert.equal(prepareDesignSystemApplication(root, 'customer-portal', options).receipt.designSystem.packs[0].sourceClass, 'project');
    const personal = prepareDesignSystemApplication(root, 'customer-portal', { ...options, roots: [{ path: pack, sourceClass: 'personal' }] });
    assert.equal(personal.receipt.designSystem.packs[0].sourceClass, 'personal');
    assert.equal(prepareDesignSystemApplication(root, 'customer-portal', options).receipt.designSystem.packs[0].sourceClass, 'project');
    writeFileSync(resolve(pack, 'experience-promise.md'), '# Experience promise\n' + 'Large design source. '.repeat(15000));
    assert.equal(prepareDesignSystemApplication(root, 'customer-portal', options).status, 'non-ready');
    const originalRead = fs.readFileSync;
    let reads = 0;
    const mock = t.mock.method(fs, 'readFileSync', function(path, ...args) {
      if (String(path) === resolve(pack, 'pack.yaml')) reads += 1;
      return originalRead.call(this, path, ...args);
    });
    syncBuiltinESMExports();
    try {
      assert.equal(prepareDesignSystemApplication(root, 'customer-portal', options).status, 'non-ready');
      assert.equal(reads, 2, 'oversized content must not occupy the bounded reuse entry');
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('refuses a symbolic receipt directory without writing outside the delivery', () => {
  const root = fixture();
  const outside = mkdtempSync(resolve(tmpdir(), 'ewai-design-receipt-outside-'));
  try {
    const assets = resolve(root, 'SPECS/6.Build/customer-portal/ui-design-assets');
    mkdirSync(assets, { recursive: true });
    symlinkSync(outside, resolve(assets, 'design-system'));
    assert.throws(() => applyDesignSystem(root, 'customer-portal', { focus: 'prototype' }), /symbolic link/i);
    assert.deepEqual(readdirSync(outside), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
