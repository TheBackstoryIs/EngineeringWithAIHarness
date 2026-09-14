import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createIntent } from '../src/intents.mjs';
import { beginDelivery } from '../src/delivery.mjs';
import { initProject } from '../src/project.mjs';
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

test('local preparation stays within the engineering performance budget', () => {
  const root = fixture();
  try {
    const beforeRss = process.memoryUsage().rss;
    const timings = [];
    for (let index = 0; index < 15; index += 1) {
      const start = process.hrtime.bigint();
      prepareDesignSystemApplication(root, 'customer-portal', { focus: 'prototype', personaCatalogue: personas });
      timings.push(Number(process.hrtime.bigint() - start) / 1_000_000);
    }
    timings.sort((left, right) => left - right);
    assert.ok(timings[Math.floor(timings.length / 2)] <= 75, `median ${timings[Math.floor(timings.length / 2)]} ms`);
    assert.ok(Math.max(0, process.memoryUsage().rss - beforeRss) <= 32 * 1024 * 1024);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
