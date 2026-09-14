import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { initProject } from '../src/project.mjs';
import { createIntent } from '../src/intents.mjs';
import {
  POLICY_DESIGN_AUTHORITY_NOTICE,
  confirmPolicyFactsAction,
  policyLifecycleEvent,
  readPolicyWorkspace,
} from '../src/runtime/policy-workspace.mjs';

test('projects one safe optional workspace with business technical persona and authority views', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-policy-workspace-'));
  try {
    initProject(root, { name: 'Policy workspace' });
    createIntent(root, { slug: 'safe-design', domain: 'platform', title: 'Safe design' });
    const personas = [
      { id: 'project.product-owner', name: 'Product Owner', tier: 'project', category: 'product', description: 'Owns intended outcomes.', tags: ['policy', 'evidence'], capabilities: ['review'], path: '/private/persona.md', rawDefinition: 'hidden' },
      { id: 'premium.privacy', name: 'Privacy Specialist', tier: 'premium', category: 'privacy', description: 'Challenges privacy assumptions.', tags: ['privacy', 'data'], capabilities: ['challenge'] },
    ];
    const workspace = readPolicyWorkspace(root, { intentReference: 'platform/safe-design', personas });
    assert.equal(workspace.status, 'not-configured');
    assert.equal(workspace.blocking, false);
    assert.equal(workspace.views.business.intentReference, workspace.views.technical.intentReference);
    assert.equal(workspace.activePersonas.some(({ tier }) => tier === 'project'), true);
    assert.equal(workspace.activePersonas.some(({ tier }) => tier === 'premium'), true);
    assert.equal(JSON.stringify(workspace).includes('/private/'), false);
    assert.equal(JSON.stringify(workspace).includes('rawDefinition'), false);
    assert.equal(workspace.notices.includes(POLICY_DESIGN_AUTHORITY_NOTICE), true);
    assert.equal(workspace.authority.productionEnforcement, false);
    assert.throws(() => readPolicyWorkspace(root, { mode: 'production' }), /business or technical/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('strict actions cannot supply roots or authority and lifecycle events require persisted records', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-policy-actions-'));
  try {
    initProject(root, { name: 'Policy actions' });
    createIntent(root, { slug: 'safe-design', domain: 'platform', title: 'Safe design' });
    assert.throws(() => confirmPolicyFactsAction(root, {
      intentReference: 'platform/safe-design', projectRoot: '/private/other', authority: 'human',
    }), /unsupported.*projectRoot|unsupported field/i);
    assert.throws(() => policyLifecycleEvent(root, 'evaluation', null), /persisted/i);
    assert.throws(() => policyLifecycleEvent(root, 'evaluation', {
      intentReference: 'platform/safe-design',
      evaluationDigest: `sha256:${'a'.repeat(64)}`,
      governingOutcome: 'allow',
    }), /exact persisted/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('publishes a bounded policy lifecycle event once for the exact persisted record', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-policy-lifecycle-'));
  try {
    initProject(root, { name: 'Policy lifecycle' });
    const path = resolve(root, 'SPECS/3.Evidence/policy/facts/platform');
    const record = {
      schema: 'ewai.confirmed-policy-facts/v1',
      revision: 1,
      intent: { reference: 'platform/safe-design', revision: 1, digest: `sha256:${'b'.repeat(64)}` },
      policyDigest: `sha256:${'c'.repeat(64)}`,
      proposalDigest: `sha256:${'d'.repeat(64)}`,
      factsDigest: `sha256:${'e'.repeat(64)}`,
      facts: [], confirmation: { confirmedBy: 'Product Owner' }, authority: { authoritative: true },
    };
    mkdirSync(path, { recursive: true });
    writeFileSync(resolve(path, 'safe-design.json'), `${JSON.stringify(record, null, 2)}\n`);
    const first = policyLifecycleEvent(root, 'facts', record);
    const second = policyLifecycleEvent(root, 'facts', record);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.deepEqual(first.event.facts, {
      status: 'confirmed', intentReference: 'platform/safe-design', evidenceDigest: record.factsDigest,
    });
    assert.doesNotMatch(JSON.stringify(first.event), /raw|body|credential|absolute.?path/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
