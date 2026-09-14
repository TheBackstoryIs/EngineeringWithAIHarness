import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createIntent } from '../src/intents.mjs';
import { beginDelivery } from '../src/delivery.mjs';
import { validatePhaseArtefacts, validatePrototypeManifest } from '../src/delivery-artifacts.mjs';
import { applyDesignSystem } from '../src/design-system-application.mjs';
import { initProject } from '../src/project.mjs';

function write(root, path, content) {
  const absolute = resolve(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function manifestV1(path = 'ui-design-assets/prototypes/selected.html') {
  return { schema: 'ewai.prototype-manifest/v1', status: 'selected', selected: { title: 'Selected', path, decision: 'Selected for review.' }, registration: { kind: 'prototype', status: 'active', path } };
}

function manifestV2(applied, overrides = {}) {
  const path = 'ui-design-assets/prototypes/selected.html';
  return {
    ...manifestV1(path), schema: 'ewai.prototype-manifest/v2',
    designSystem: { receiptPath: applied.receiptPath, receiptDigest: applied.receiptDigest, effectiveDigest: applied.effectiveDigest, ...overrides },
  };
}

function reviewedEvidence(delivery, applied) {
  const plan = {
    schema: 'ewai.prototype-plan-review/v1', contentDigest: `sha256:${'1'.repeat(64)}`,
    deliverySlug: 'new-ui', personaFingerprint: `sha256:${'2'.repeat(64)}`,
  };
  const cycle = {
    schema: 'ewai.prototype-cycle-review/v1', contentDigest: `sha256:${'3'.repeat(64)}`,
    deliverySlug: 'new-ui', cycleNumber: 1, planReviewDigest: plan.contentDigest,
    prototype: { entryPath: 'ui-design-assets/prototypes/selected.html', manifestDigest: `sha256:${'4'.repeat(64)}` },
    personaFingerprint: `sha256:${'5'.repeat(64)}`,
  };
  write(delivery, 'ui-design-assets/prototype-iterations/plans/plan.json', JSON.stringify(plan));
  write(delivery, 'ui-design-assets/prototype-iterations/cycles/cycle.json', JSON.stringify(cycle));
  return {
    ...manifestV2(applied),
    schema: 'ewai.prototype-manifest/v3',
    reviews: {
      plan: { path: 'ui-design-assets/prototype-iterations/plans/plan.json', digest: plan.contentDigest },
      finalCycle: { path: 'ui-design-assets/prototype-iterations/cycles/cycle.json', digest: cycle.contentDigest, cycleNumber: 1 },
    },
  };
}

test('keeps historical v1 readable but requires v2 for newly stamped UI deliveries', () => {
  const historical = mkdtempSync(resolve(tmpdir(), 'ewai-design-historical-'));
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-design-stamped-'));
  try {
    write(historical, 'ui-design-assets/prototypes/selected.html', '<!doctype html><title>Historical</title>');
    write(historical, 'ui-design-assets/prototypes/manifest.json', JSON.stringify(manifestV1()));
    assert.equal(validatePrototypeManifest(historical).schema, 'ewai.prototype-manifest/v1');

    initProject(root, { name: 'Stamped UI fixture' });
    createIntent(root, { slug: 'new-ui', domain: 'experience', title: 'New UI' });
    const begun = beginDelivery(root, 'new-ui', { tool: 'codex', ui: true });
    assert.equal(begun.state.artefactContracts.prototype, 'ewai.prototype-manifest/v3');
    const delivery = resolve(root, 'SPECS/6.Build/new-ui');
    write(delivery, 'ui-design.md', '# UI Design\n');
    write(delivery, 'ui-design-assets/prototypes/selected.html', '<!doctype html><title>Selected</title>');
    write(delivery, 'ui-design-assets/prototypes/manifest.json', JSON.stringify(manifestV1()));
    assert.throws(() => validatePrototypeManifest(delivery), /requires.*v3|migrat/i);

    const applied = applyDesignSystem(root, 'new-ui', { focus: 'prototype' });
    write(delivery, 'ui-design-assets/prototypes/manifest.json', JSON.stringify(reviewedEvidence(delivery, applied)));
    assert.equal(validatePhaseArtefacts(delivery, 'ui-design').includes('ui-design-assets/prototypes/manifest.json'), true);
  } finally {
    rmSync(historical, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps historical v2 readable while v3 links the selected prototype to immutable reviewed evidence', () => {
  const historical = mkdtempSync(resolve(tmpdir(), 'ewai-design-v2-readable-'));
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-design-v3-reviewed-'));
  try {
    initProject(historical, { name: 'Historical v2 fixture' });
    createIntent(historical, { slug: 'historical-ui', domain: 'experience', title: 'Historical UI' });
    beginDelivery(historical, 'historical-ui', { tool: 'codex', ui: true });
    const historicalDelivery = resolve(historical, 'SPECS/6.Build/historical-ui');
    write(historicalDelivery, 'ui-design-assets/prototypes/selected.html', '<!doctype html><title>Historical v2</title>');
    const historicalApplied = applyDesignSystem(historical, 'historical-ui', { focus: 'prototype' });
    rmSync(resolve(historicalDelivery, 'delivery-state.json'));
    write(historicalDelivery, 'ui-design-assets/prototypes/manifest.json', JSON.stringify(manifestV2(historicalApplied)));
    assert.equal(validatePrototypeManifest(historicalDelivery).schema, 'ewai.prototype-manifest/v2');

    initProject(root, { name: 'Reviewed prototype fixture' });
    createIntent(root, { slug: 'new-ui', domain: 'experience', title: 'New UI' });
    beginDelivery(root, 'new-ui', { tool: 'codex', ui: true });
    const delivery = resolve(root, 'SPECS/6.Build/new-ui');
    write(delivery, 'ui-design-assets/prototypes/selected.html', '<!doctype html><title>Reviewed</title>');
    const applied = applyDesignSystem(root, 'new-ui', { focus: 'prototype' });
    write(delivery, 'ui-design-assets/prototypes/manifest.json', JSON.stringify(reviewedEvidence(delivery, applied)));
    const manifest = validatePrototypeManifest(delivery);
    assert.equal(manifest.schema, 'ewai.prototype-manifest/v3');

    const stale = structuredClone(manifest);
    stale.reviews.finalCycle.digest = `sha256:${'9'.repeat(64)}`;
    write(delivery, 'ui-design-assets/prototypes/manifest.json', JSON.stringify(stale));
    assert.throws(() => validatePrototypeManifest(delivery), /review|digest/i);
  } finally {
    rmSync(historical, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('v2 refuses missing, unsafe, symlinked, stale or mismatched receipts', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-design-v2-safety-'));
  try {
    initProject(root, { name: 'Receipt validation fixture' });
    createIntent(root, { slug: 'safe-ui', domain: 'experience', title: 'Safe UI' });
    beginDelivery(root, 'safe-ui', { tool: 'codex', ui: true });
    const delivery = resolve(root, 'SPECS/6.Build/safe-ui');
    write(delivery, 'ui-design-assets/prototypes/selected.html', '<!doctype html><title>Selected</title>');
    const applied = applyDesignSystem(root, 'safe-ui', { focus: 'prototype' });
    for (const designSystem of [
      { receiptPath: 'ui-design-assets/design-system/missing.json', receiptDigest: applied.receiptDigest, effectiveDigest: applied.effectiveDigest },
      { receiptPath: '../../outside.json', receiptDigest: applied.receiptDigest, effectiveDigest: applied.effectiveDigest },
      { receiptPath: applied.receiptPath, receiptDigest: `sha256:${'0'.repeat(64)}`, effectiveDigest: applied.effectiveDigest },
      { receiptPath: applied.receiptPath, receiptDigest: applied.receiptDigest, effectiveDigest: `sha256:${'0'.repeat(64)}` },
    ]) {
      write(delivery, 'ui-design-assets/prototypes/manifest.json', JSON.stringify({ ...manifestV1(), schema: 'ewai.prototype-manifest/v2', designSystem }));
      assert.throws(() => validatePrototypeManifest(delivery), /receipt|digest|inside/i);
    }
    const linkedReceipt = 'ui-design-assets/design-system/linked-receipt.json';
    symlinkSync(resolve(delivery, applied.receiptPath), resolve(delivery, linkedReceipt));
    write(delivery, 'ui-design-assets/prototypes/manifest.json', JSON.stringify(manifestV2(applied, { receiptPath: linkedReceipt })));
    assert.throws(() => validatePrototypeManifest(delivery), /symbolic link/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses a selected prototype represented by a symbolic link even when its target stays in the prototype folder', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-design-prototype-link-'));
  try {
    write(root, 'ui-design-assets/prototypes/target.html', '<!doctype html><title>Target</title>');
    symlinkSync(resolve(root, 'ui-design-assets/prototypes/target.html'), resolve(root, 'ui-design-assets/prototypes/selected.html'));
    write(root, 'ui-design-assets/prototypes/manifest.json', JSON.stringify(manifestV1()));
    assert.throws(() => validatePrototypeManifest(root), /symbolic link/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
