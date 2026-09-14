import test from 'node:test';
import {DASHBOARD_VIEWS} from '../src/dashboard-preferences.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createIntent, updateIntentDeliveryState } from '../src/intents.mjs';
import { checkinProject } from '../src/checkin.mjs';
import { initProject } from '../src/project.mjs';
import { ASSURANCE_NOTICE } from '../src/security-validation-config.mjs';
import { ROLLOUT_ADVISORY_NOTICE } from '../src/network-rollout.mjs';
import { preparePersonaTestScenarioBrief, recordPersonaTestScenarios } from '../src/test-scenarios.mjs';
import {
  MEETING_EVIDENCE_DISCLAIMER,
  recordMeetingReview,
  registerMeetingSource,
} from '../src/meeting-evidence.mjs';
import {
  KNOWLEDGE_PROPOSALS_DISCLAIMER,
  prepareKnowledgeProposals,
  recordKnowledgeProposalBundle,
  recordKnowledgeProposalReview,
} from '../src/knowledge-proposals.mjs';
import { dashboardStatus, ensureDashboard, stopDashboard } from '../src/runtime/dashboard.mjs';
import { listRuntimeIntents, readRuntimeIntent } from '../src/runtime/intents.mjs';
import { listKnowledge } from '../src/runtime/knowledge.mjs';
import { refreshRepositoryIndex } from '../src/runtime/repository-index.mjs';
import { registerLifecycleHandler, subscribeLifecycleHandler } from '../src/runtime/lifecycle-hooks.mjs';
import {
  addActivityEvent,
  addArtefact,
  finishActiveSession,
  listActiveSessions,
  listWorkItems,
  readWorkItemView,
  setPhase,
  startActiveSession,
  updateWorkItem
} from '../src/runtime/work.mjs';

function writeRuntimeOrganisationBlueprint(projectRoot) {
  const root = resolve(projectRoot, '.ewai-pipeline/packs/acme-engineering');
  const manifest = {
    schema: 'ewai.pack/v1', id: 'org.acme.engineering', name: 'Acme Engineering',
    description: 'Acme project conventions.', version: '1.0.0', type: 'organisation', requires: [],
    blueprint: {
      publisher: { id: 'acme', name: 'Acme' }, compatibility: { ewai: '0.x' },
      modules: [{
        id: 'foundation', name: 'Foundation', description: 'Required Acme rules.', required: true,
        standards: [{ id: 'delivery', title: 'Delivery standard', source: 'standards/delivery.md' }],
        personas: [{ id: 'delivery-owner', name: 'Acme Delivery Owner', source: 'personas/owner.md' }],
        boilerplates: []
      }]
    }
  };
  mkdirSync(resolve(root, 'standards'), { recursive: true });
  mkdirSync(resolve(root, 'personas'), { recursive: true });
  writeFileSync(resolve(root, 'pack.yaml'), YAML.stringify(manifest, { lineWidth: 0 }));
  writeFileSync(resolve(root, 'standards/delivery.md'), '# Delivery standard\n\nReview every release.\n');
  writeFileSync(resolve(root, 'personas/owner.md'), '---\nname: Acme Delivery Owner\ndescription: Applies Acme delivery context.\ncategory: operations\ntags: [operations, delivery]\n---\n\n# Acme Delivery Owner\n\nUse local context.\n');
}

function guidedIntentPayload() {
  return {
    domain: 'experience', slug: 'browser-intent', title: 'Browser intent', personas: [], relationships: [],
    deliveryShape: { recommendation: 'single', reason: 'One coherent outcome.', suggestedChildren: [], blockingQuestions: [], reviewedDecision: 'keep-as-one' },
    details: {
      problem: 'A participant cannot shape an intent without terminal knowledge.',
      desiredOutcome: 'A participant can shape and approve intent truth in the local browser.',
      users: ['Product Owner'], journeys: ['Open Intent Studio, complete sections, review, and approve.'],
      acceptanceCriteria: ['Canonical Markdown and JSON are written only after named approval.'],
      constraints: ['Keep project authority server-owned.'], evidence: ['Approved product direction.'], openDecisions: [],
    },
  };
}

function seedPhaseStudioDelivery(root) {
  const created = createIntent(root, {
    slug: 'phase-studio-route', domain: 'experience', title: 'Phase Studio route',
    details: {
      problem: 'Owners need one evidence thread.', desiredOutcome: 'Owners can contribute safely.',
      users: ['Business owner', 'Technical owner'], journeys: ['Contribute, hand off and confirm.'],
      acceptanceCriteria: ['Contribution evidence remains separate from delivery authority.'],
      constraints: ['Keep the project and phase server-owned.'], evidence: [], openDecisions: [],
    },
  });
  const deliveryRoot = resolve(root, 'SPECS/6.Build/phase-studio-route');
  mkdirSync(deliveryRoot, { recursive: true });
  writeFileSync(resolve(deliveryRoot, 'delivery-state.json'), `${JSON.stringify({
    schema: 'ewai.delivery-state/v1', contract: 'ewai.delivery-stages/v1', slug: 'phase-studio-route',
    intent: { id: 'experience/phase-studio-route', slug: 'phase-studio-route', title: 'Phase Studio route', status: 'in-progress', path: 'SPECS/2.Purpose/intents/experience/phase-studio-route.md' },
    mode: 'normal', intensity: 'scoped', status: 'in-progress', currentPhase: 'plan',
    startedAt: '2026-08-24T12:00:00.000Z', updatedAt: '2026-08-24T12:00:00.000Z', providers: [],
    phases: [{ id: 'plan', status: 'running', startedAt: '2026-08-24T12:00:00.000Z', completedAt: null, validation: null }],
    adjuncts: [], humanGates: [], approvals: { build: null }, runs: [], blockedReason: '',
  }, null, 2)}\n`);
  updateIntentDeliveryState(root, created.path, {
    status: 'in-progress', deliveryStatus: 'in-progress', currentPhase: 'plan',
    deliveryStatePath: 'SPECS/6.Build/phase-studio-route/delivery-state.json',
  });
  return created;
}

function registerRejectingLifecycleHandler(projectRoot) {
  const folder = resolve(projectRoot, 'organisation-handler');
  const entrypoint = resolve(folder, 'handler');
  const source = `#!/usr/bin/env node
process.stdin.resume();
process.stdin.once('end', () => {
  process.stderr.write('super-secret-raw-handler-output');
  process.stdout.write(JSON.stringify({ schema: 'ewai.lifecycle-hook-ack/v1', status: 'rejected', code: 'policy-review', message: 'Organisation review is required.' }));
});
`;
  mkdirSync(folder, { recursive: true });
  writeFileSync(entrypoint, source);
  chmodSync(entrypoint, 0o755);
  writeFileSync(resolve(folder, 'lifecycle-handler.json'), `${JSON.stringify({
    schema: 'ewai.lifecycle-handler/v1', id: 'org.example.dashboard-review', name: 'Dashboard review handler',
    publisher: { id: 'org.example', name: 'Example Organisation' }, version: '1.0.0',
    compatibility: { protocols: ['1'], eventSchemas: ['1'] }, entrypoint: 'handler',
    digest: `sha256:${createHash('sha256').update(source).digest('hex')}`,
    events: ['ewai.intent.created'], limits: { timeoutMs: 2_000, maxOutputBytes: 4_096 },
  }, null, 2)}\n`);
  registerLifecycleHandler(projectRoot, folder, { confirmed: true });
  return subscribeLifecycleHandler(projectRoot, 'org.example.dashboard-review', ['ewai.intent.created'], { confirmed: true });
}

test('serves a read-only portfolio projection from server-owned loopback context', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-portfolio-dashboard-route-'));
  try {
    initProject(root, { name: 'Portfolio dashboard route' });
    mkdirSync(resolve(root, 'SPECS/1.Scope'), { recursive: true });
    writeFileSync(resolve(root, 'SPECS/1.Scope/portfolio.yaml'), YAML.stringify({
      schema: 'ewai.portfolio/v1', id: 'route-portfolio', name: 'Route portfolio', owner: 'Owner',
      members: [
        { id: 'route', kind: 'portfolio', name: 'Route', owner: 'Owner' },
        { id: 'host', kind: 'project', name: 'Host', owner: 'Owner', parent: 'route', repository: 'application', project_path: '.' },
      ],
      dependencies: [],
    }, { lineWidth: 0 }));
    const started = await ensureDashboard(root);

    const response = await fetch(`${started.url}/api/portfolio?focus=${encodeURIComponent('delivery ownership')}`, {
      headers: { authorization: 'Bearer untrusted-user-state', 'x-project-root': '/tmp/untrusted' },
    });
    assert.equal(response.status, 200);
    const workspace = await response.json();
    assert.equal(workspace.schema, 'ewai.portfolio-workspace/v1');
    assert.equal(JSON.stringify(workspace).includes(root), false);
    assert.equal(JSON.stringify(workspace).includes('/tmp/untrusted'), false);

    const authorityOverride = await fetch(`${started.url}/api/portfolio?root=${encodeURIComponent('/tmp/untrusted')}`);
    assert.equal(authorityOverride.status, 400);
    const invalidFocus = await fetch(`${started.url}/api/portfolio?focus=${'x'.repeat(501)}`);
    assert.equal(invalidFocus.status, 400);
    const mutation = await fetch(`${started.url}/api/portfolio`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url }, body: '{}',
    });
    assert.equal(mutation.status, 404);
  } finally {
    await stopDashboard(root);
    rmSync(root, { recursive: true, force: true });
  }
});

test('serves strict Team Hub connection routes from the configured project context', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-team-hub-dashboard-route-'));
  try {
    initProject(root, { name: 'Team Hub dashboard project' });
    const started = await ensureDashboard(root);
    const initial = await fetch(`${started.url}/api/team-hub`).then((response) => response.json());
    assert.equal(initial.schema, 'ewai.team-hub-workspace/v1');
    assert.equal(initial.mode, 'single');
    assert.equal(JSON.stringify(initial).includes(root), false);

    const wrongOrigin = await fetch(`${started.url}/api/team-hub/connect`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://example.invalid' },
      body: JSON.stringify({ endpoint: 'http://127.0.0.1:49001', projectId: 'dashboard-project', tokenEnv: 'EWAI_TEAM_HUB_DASHBOARD', confirmed: true, disclosureAcknowledged: true }),
    });
    assert.equal(wrongOrigin.status, 403);
    const unknown = await fetch(`${started.url}/api/team-hub/connect`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ endpoint: 'http://127.0.0.1:49001', token: 'secret', confirmed: true, disclosureAcknowledged: true }),
    });
    assert.equal(unknown.status, 400);
    const connected = await fetch(`${started.url}/api/team-hub/connect`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ endpoint: 'http://127.0.0.1:49001', projectId: 'dashboard-project', tokenEnv: 'EWAI_TEAM_HUB_DASHBOARD', confirmed: true, disclosureAcknowledged: true }),
    });
    assert.equal(connected.status, 200);
    const workspace = await connected.json();
    assert.equal(workspace.mode, 'connected');
    assert.equal(JSON.stringify(workspace).includes('secret'), false);
    const disconnected = await fetch(`${started.url}/api/team-hub/disconnect`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url }, body: JSON.stringify({ confirmed: true }),
    });
    assert.equal(disconnected.status, 200);
    assert.equal((await disconnected.json()).mode, 'single');
  } finally {
    await stopDashboard(root);
    rmSync(root, { recursive: true, force: true });
  }
});

test('ships a responsive local Team Hub disclosure and receipt workspace', () => {
  const html = readFileSync(resolve(import.meta.dirname, '../public/index.html'), 'utf8');
  const app = readFileSync(resolve(import.meta.dirname, '../public/app.js'), 'utf8');
  const styles = readFileSync(resolve(import.meta.dirname, '../public/styles.css'), 'utf8');
  assert.ok(DASHBOARD_VIEWS.some(view=>view.id==='team-hub'));
  assert.match(html, /id="optionalViewLinks"/);
  assert.match(html, /id="teamHubView"/);
  assert.match(html, /id="teamHubDisclosure"/);
  assert.match(html, /id="teamHubLastAttempt"/);
  assert.match(html, /id="teamHubAcceptedReceipt"/);
  assert.match(html, /id="teamHubResources"/);
  assert.match(html, /id="teamHubResourceDetail"/);
  assert.match(app, /\/api\/team-hub/);
  assert.match(app, /\/api\/team-hub\/resources/);
  assert.match(app, /expectedDigest/);
  assert.match(app, /escapeHtml\(workspace\.connection/);
  assert.match(styles, /\.team-hub-view/);
  assert.match(styles, /\.team-hub-resource/);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*team-hub/);
});

test('ships a keyboard-reachable responsive Companion decision runway', () => {
  const html = readFileSync(resolve(import.meta.dirname, '../public/index.html'), 'utf8');
  const app = readFileSync(resolve(import.meta.dirname, '../public/app.js'), 'utf8');
  const styles = readFileSync(resolve(import.meta.dirname, '../public/styles.css'), 'utf8');

  assert.match(html, /data-view="companion"/);
  assert.match(html, /id="companionView"/);
  assert.match(html, /id="companionFocus"[^>]*maxlength="500"/);
  assert.match(html, /id="companionRunway"/);
  assert.match(html, /id="companionPersonas"/);
  assert.match(html, /id="companionReviewQuestions"/);
  assert.match(html, /id="companionAdvisoryNotice"/);
  assert.match(html, /id="companionSecurityNotice"/);
  assert.match(app, /async function loadCompanion/);
  assert.match(app, /data-companion-recommendation/);
  assert.match(app, /loadCompanion\(companionRecommendation\.dataset\.companionRecommendation/);
  assert.match(app, /data-companion-handoff/);
  assert.match(app, /openDashboardAction/);
  assert.match(app, /activePersonas/);
  assert.doesNotMatch(app, /api\/companion[^'"`]*\/(?:approve|build|release|manual-qa)/);
  assert.match(styles, /\.companion-layout/);
  assert.match(styles, /@media \(max-width: 960px\)[\s\S]*\.companion-layout/);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*\.companion-recommendation/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test('serves meeting evidence from server-owned context with guarded preparation and promotion', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-meeting-dashboard-route-'));
  try {
    initProject(root, { name: 'Meeting dashboard route' });
    const sourcePath = resolve(root, 'meeting.txt');
    writeFileSync(sourcePath, 'Decision: keep review human-owned.\nAction: preserve provenance.\n');
    const registration = registerMeetingSource(root, sourcePath, {
      confirmed: true, label: 'Product review', classification: 'internal', cloudProcessing: 'allowed'
    });
    recordMeetingReview(root, registration.source.sourceId, {
      reviewedBy: 'Product Owner',
      bundle: {
        schema: 'ewai.meeting-candidate-bundle/v1', sourceId: registration.source.sourceId,
        sourceDigest: registration.source.digest,
        candidates: [{
          id: 'MEC-001', type: 'decision', observedStatement: 'Review remains human-owned.',
          interpretation: 'The meeting does not create delivery authority.', lineAnchors: [{ start: 1, end: 1 }], confidence: 'high'
        }]
      },
      dispositions: [{ candidateId: 'MEC-001', decision: 'accepted', rationale: 'Named review complete.' }]
    });
    const started = await ensureDashboard(root);

    const response = await fetch(`${started.url}/api/meeting-evidence?source=${encodeURIComponent(registration.source.sourceId)}`, {
      headers: { authorization: 'Bearer ignored', 'x-project-root': '/tmp/untrusted' }
    });
    assert.equal(response.status, 200);
    const workspace = await response.json();
    assert.equal(workspace.schema, 'ewai.meeting-evidence-workspace/v1');
    assert.equal(workspace.candidates[0].id, 'MEC-001');
    assert.equal(workspace.notices.includes(MEETING_EVIDENCE_DISCLAIMER), true);
    assert.equal(JSON.stringify(workspace).includes(root), false);
    assert.equal(JSON.stringify(workspace).includes('/tmp/untrusted'), false);
    assert.equal(JSON.stringify(workspace).includes(readFileSync(sourcePath, 'utf8')), false);

    const prepared = await fetch(`${started.url}/api/meeting-evidence/${encodeURIComponent(registration.source.sourceId)}/prepare`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url }, body: '{}'
    });
    assert.equal(prepared.status, 200);
    assert.equal((await prepared.json()).processing.permitted, true);

    const denied = await fetch(`${started.url}/api/meeting-evidence/${encodeURIComponent(registration.source.sourceId)}/promote`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ confirmed: false, approvedBy: 'Product Owner' })
    });
    assert.equal(denied.status, 400);
    assert.equal((await denied.json()).assurance_notice, MEETING_EVIDENCE_DISCLAIMER);

    const promoted = await fetch(`${started.url}/api/meeting-evidence/${encodeURIComponent(registration.source.sourceId)}/promote`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ confirmed: true, approvedBy: 'Product Owner' })
    });
    assert.equal(promoted.status, 200);
    assert.equal((await promoted.json()).counts.promoted, 1);

    const rejectedRoot = await fetch(`${started.url}/api/meeting-evidence?projectRoot=${encodeURIComponent('/tmp/untrusted')}`);
    assert.equal(rejectedRoot.status, 400);
  } finally {
    await stopDashboard(root);
    rmSync(root, { recursive: true, force: true });
  }
});

test('ships meeting evidence as a secondary responsive Mind Palace mode without raw transcript preview', () => {
  const html = readFileSync(resolve(import.meta.dirname, '../public/index.html'), 'utf8');
  const app = readFileSync(resolve(import.meta.dirname, '../public/app.js'), 'utf8');
  const styles = readFileSync(resolve(import.meta.dirname, '../public/styles.css'), 'utf8');

  assert.match(html, /data-knowledge-mode="meeting-evidence"/);
  assert.match(html, /id="meetingEvidenceWorkspace"/);
  assert.match(html, /id="meetingEvidenceSources"/);
  assert.match(html, /id="meetingEvidenceCandidates"/);
  assert.match(html, /id="meetingEvidencePersonas"/);
  assert.match(html, /id="meetingEvidenceNotice"/);
  assert.match(app, /async function loadMeetingEvidence/);
  assert.match(app, /MEETING_EVIDENCE_DISCLAIMER|meetingEvidenceDisclaimer/);
  assert.match(app, /data-meeting-prepare/);
  assert.match(app, /data-meeting-promote/);
  assert.doesNotMatch(app, /meeting[^\n]{0,80}(?:raw transcript|source preview)/i);
  assert.match(styles, /\.meeting-evidence-layout/);
  assert.match(styles, /@media \(max-width: 960px\)[\s\S]*\.meeting-evidence-layout/);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*\.meeting-evidence-layout/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test('serves knowledge proposals from server-owned context with guarded review and materialisation', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-knowledge-dashboard-route-'));
  try {
    initProject(root, { name: 'Knowledge proposal dashboard route' });
    mkdirSync(resolve(root, 'SPECS/3.Evidence/retros'), { recursive: true });
    writeFileSync(resolve(root, 'SPECS/3.Evidence/retros/review-learning.md'), '# Retrospective\n\n## What we learned\n\nRetain provenance through promotion.\n');
    const started = await ensureDashboard(root);

    const initial = await fetch(`${started.url}/api/knowledge-proposals`, {
      headers: { authorization: 'Bearer ignored', 'x-project-root': '/tmp/untrusted' },
    });
    assert.equal(initial.status, 200);
    const workspace = await initial.json();
    assert.equal(workspace.schema, 'ewai.knowledge-proposal-workspace/v1');
    assert.equal(workspace.sources[0].ref, 'retrospective:review-learning');
    assert.equal(workspace.notices.includes(KNOWLEDGE_PROPOSALS_DISCLAIMER), true);
    assert.equal(JSON.stringify(workspace).includes('Retain provenance'), false);
    assert.equal(JSON.stringify(workspace).includes(root), false);

    const preparedResponse = await fetch(`${started.url}/api/knowledge-proposals/prepare`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ sourceRef: 'retrospective:review-learning' }),
    });
    assert.equal(preparedResponse.status, 200);
    const prepared = await preparedResponse.json();
    assert.equal('modelContext' in prepared, false);
    assert.equal(prepared.modelContextAvailable, true);
    assert.equal(prepared.activePersonas.length > 0, true);

    const domainPreparation = prepareKnowledgeProposals(root, 'retrospective:review-learning');
    const bundle = {
      schema: 'ewai.knowledge-proposal-bundle/v1',
      sourceRef: domainPreparation.source.ref,
      sourceDigest: domainPreparation.source.digest,
      proposals: [{
        id: 'KNP-001', kind: 'pattern', title: 'Retain promotion provenance',
        destination: 'SPECS/5.Strategy/patterns/retain-promotion-provenance.md',
        evidenceAnchors: [domainPreparation.source.anchors[0].id],
        rationale: 'The retrospective identifies a repeatable evidence practice.',
        uncertainty: 'A named reviewer must confirm applicability.', relationships: [],
        proposedMarkdown: '# Retain promotion provenance\n\nRetain source provenance through promotion.\n\n## Provenance\n\n- Source: `retrospective:review-learning`\n- Anchor: `heading:what-we-learned`\n',
      }],
    };
    const recordedResponse = await fetch(`${started.url}/api/knowledge-proposals/record`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ sourceRef: domainPreparation.source.ref, bundle, activePersonas: domainPreparation.activePersonas }),
    });
    assert.equal(recordedResponse.status, 200);
    const recorded = await recordedResponse.json();

    const reviewedResponse = await fetch(`${started.url}/api/knowledge-proposals/${encodeURIComponent(recorded.bundleId)}/review`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ reviewedBy: 'Product Owner', dispositions: [{ proposalId: 'KNP-001', decision: 'accepted' }] }),
    });
    assert.equal(reviewedResponse.status, 200);
    assert.equal((await reviewedResponse.json()).reviewedBy, 'Product Owner');

    const denied = await fetch(`${started.url}/api/knowledge-proposals/${encodeURIComponent(recorded.bundleId)}/materialise`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ confirmed: false, approvedBy: 'Product Owner' }),
    });
    assert.equal(denied.status, 400);
    assert.equal((await denied.json()).assurance_notice, KNOWLEDGE_PROPOSALS_DISCLAIMER);

    const materialised = await fetch(`${started.url}/api/knowledge-proposals/${encodeURIComponent(recorded.bundleId)}/materialise`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ confirmed: true, approvedBy: 'Product Owner' }),
    });
    assert.equal(materialised.status, 200);
    assert.equal((await materialised.json()).counts.added, 1);
    assert.equal(existsSync(resolve(root, 'SPECS/5.Strategy/patterns/retain-promotion-provenance.md')), true);

    const rejectedRoot = await fetch(`${started.url}/api/knowledge-proposals?projectRoot=${encodeURIComponent('/tmp/untrusted')}`);
    assert.equal(rejectedRoot.status, 400);
  } finally {
    await stopDashboard(root);
    rmSync(root, { recursive: true, force: true });
  }
});

test('ships knowledge proposals as a secondary responsive Mind Palace mode with visible personas', () => {
  const html = readFileSync(resolve(import.meta.dirname, '../public/index.html'), 'utf8');
  const app = readFileSync(resolve(import.meta.dirname, '../public/app.js'), 'utf8');
  const styles = readFileSync(resolve(import.meta.dirname, '../public/styles.css'), 'utf8');

  assert.match(html, /data-knowledge-mode="knowledge-proposals"/);
  assert.match(html, /id="knowledgeProposalWorkspace"/);
  assert.match(html, /id="knowledgeProposalSources"/);
  assert.match(html, /id="knowledgeProposalCards"/);
  assert.match(html, /id="knowledgeProposalPersonas"/);
  assert.match(html, /id="knowledgeProposalNotice"/);
  assert.match(app, /async function loadKnowledgeProposals/);
  assert.match(app, /data-knowledge-proposal-prepare/);
  assert.match(app, /data-knowledge-proposal-review/);
  assert.match(app, /data-knowledge-proposal-materialise/);
  assert.doesNotMatch(app, /knowledgeProposal[^\n]{0,80}(?:raw transcript|source preview)/i);
  assert.match(styles, /\.knowledge-proposal-layout/);
  assert.match(styles, /@media \(max-width: 960px\)[\s\S]*\.knowledge-proposal-layout/);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*\.knowledge-proposal-card/);
});

test('serves one read-only rollout contract from server-owned loopback context', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-rollout-dashboard-route-'));
  try {
    initProject(root, { name: 'Rollout dashboard route' });
    const configPath = resolve(root, 'SPECS/pipeline.yaml');
    const config = YAML.parse(readFileSync(configPath, 'utf8'));
    config.blueprints = { organisation: {
      root: { id: 'org.example.route', version: '1.0.0', digest: `sha256:${'c'.repeat(64)}` },
      packs: [{ id: 'org.example.route', version: '1.0.0', digest: `sha256:${'c'.repeat(64)}` }],
      selection_digest: `sha256:${'c'.repeat(64)}`, enabled_modules: ['core'], applied_modules: ['core'],
      approved_by: 'Owner', approved_at: '2026-08-20T10:00:00.000Z', evidence: 'SPECS/5.Strategy/organisation-blueprint.md',
    } };
    writeFileSync(configPath, YAML.stringify(config, { lineWidth: 0 }));
    mkdirSync(resolve(root, 'SPECS/1.Scope'), { recursive: true });
    writeFileSync(resolve(root, 'SPECS/1.Scope/portfolio.yaml'), YAML.stringify({
      schema: 'ewai.portfolio/v1', id: 'route-portfolio', name: 'Route portfolio', owner: 'Portfolio Owner',
      members: [
        { id: 'route', kind: 'portfolio', name: 'Route', owner: 'Portfolio Owner' },
        { id: 'host', kind: 'project', name: 'Host', owner: 'Project Owner', parent: 'route', repository: 'application', project_path: '.' },
      ], dependencies: [],
    }, { lineWidth: 0 }));
    writeFileSync(resolve(root, 'SPECS/1.Scope/rollout.yaml'), YAML.stringify({
      schema: 'ewai.rollout/v1', id: 'route-rollout', name: 'Route rollout', owner: 'Practice Owner', stale_after_days: 30,
      baselines: [{ id: 'route', name: 'Route baseline', owner: 'Architecture Owner', pack: { id: 'org.example.route', version: '1.0.0', digest: `sha256:${'c'.repeat(64)}` } }],
      cohorts: [{ id: 'wave', name: 'Wave', baseline: 'route', owner: 'Cohort Owner', review_by: '2026-09-30', required_evidence: ['blueprint'], projects: [{ id: 'host', owner: 'Project Owner' }] }],
    }, { lineWidth: 0 }));
    const started = await ensureDashboard(root);

    const response = await fetch(`${started.url}/api/rollout?focus=${encodeURIComponent('adoption ownership')}`, {
      headers: { authorization: 'Bearer untrusted-state', 'x-project-root': '/tmp/untrusted', 'x-tenant': 'other' },
    });
    assert.equal(response.status, 200);
    const workspace = await response.json();
    assert.equal(workspace.schema, 'ewai.rollout-workspace/v1');
    assert.equal(workspace.notices.advisory, ROLLOUT_ADVISORY_NOTICE);
    assert.equal(workspace.notices.security, ASSURANCE_NOTICE);
    assert.equal(JSON.stringify(workspace).includes(root), false);
    assert.equal(JSON.stringify(workspace).includes('/tmp/untrusted'), false);

    const assurance = await fetch(`${started.url}/api/rollout/projects/host/assurance`).then((item) => item.json());
    assert.equal(assurance.selectedAssurance.project.id, 'host');
    assert.equal(assurance.selectedAssurance.structuralOnly, true);
    assert.equal(assurance.selectedAssurance.adequacyVerdict, null);

    for (const path of [
      `/api/rollout?root=${encodeURIComponent('/tmp/untrusted')}`,
      `/api/rollout?focus=${'x'.repeat(501)}`,
      '/api/rollout/projects/unassigned/assurance',
    ]) {
      const rejected = await fetch(`${started.url}${path}`);
      assert.equal(rejected.status >= 400, true);
      const body = await rejected.json();
      assert.equal(body.notices.advisory, ROLLOUT_ADVISORY_NOTICE);
      assert.equal(body.notices.security, ASSURANCE_NOTICE);
      assert.equal(JSON.stringify(body).includes(root), false);
    }
    const mutation = await fetch(`${started.url}/api/rollout`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url }, body: '{}',
    });
    assert.equal(mutation.status, 404);
  } finally {
    await stopDashboard(root);
    rmSync(root, { recursive: true, force: true });
  }
});

test('projects SPECS intents into the project-local SQLite index', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-runtime-index-'));
  try {
    initProject(root, { name: 'Runtime Index Test' });
    const created = createIntent(root, {
      slug: 'clear-checkout',
      domain: 'commerce',
      title: 'Clear Checkout',
      personas: ['ewai.grumpy-business-user:reviewer:4']
    });

    const first = listRuntimeIntents(root);
    assert.equal(first.length, 1);
    assert.equal(first[0].id, 'commerce/clear-checkout');
    assert.equal(first[0].personas[0].ref, 'ewai.grumpy-business-user');
    assert.equal(existsSync(resolve(root, '.ewai-pipeline/data/pipeline.sqlite')), true);

    writeFileSync(created.path, readFileSync(created.path, 'utf8').replace('## Problem', '## Problem\n\nMake checkout calmly obvious.'));
    assert.match(readRuntimeIntent(root, 'clear-checkout').excerpt, /calmly obvious/);

    rmSync(created.path);
    assert.deepEqual(listRuntimeIntents(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('projects intents and knowledge from a separately located SPECS repository', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-runtime-dedicated-specs-'));
  try {
    initProject(root, { name: 'Dedicated Knowledge Test', specsRoot: 'knowledge/SPECS' });
    createIntent(root, { slug: 'portable-knowledge', domain: 'platform', title: 'Portable Knowledge' });
    writeFileSync(resolve(root, 'knowledge/SPECS/1.Scope/project-note.md'), '# Project Note\n\nShared context.\n');

    assert.equal(listRuntimeIntents(root)[0].slug, 'portable-knowledge');
    assert.equal(listKnowledge(root).documents.some((document) => document.path === '1.Scope/project-note.md'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('publishes the complete responsive Intent Studio browser contract', () => {
  const page = readFileSync(resolve(import.meta.dirname, '../public/index.html'), 'utf8');
  const app = readFileSync(resolve(import.meta.dirname, '../public/app.js'), 'utf8');
  const styles = readFileSync(resolve(import.meta.dirname, '../public/styles.css'), 'utf8');

  assert.match(page, /data-view="intent-studio"/);
  assert.match(page, /id="intentStudioView"/);
  assert.match(page, /id="intentStudioSections"/);
  assert.match(page, /id="intentStudioPersonas"/);
  assert.match(page, /id="intentStudioBaseline"/);
  assert.match(page, /Persona and model perspectives are advisory hypotheses/);
  assert.match(app, /\/api\/guided-intent/);
  assert.match(app, /data-intent-approve/);
  assert.match(app, /persona\.matchedSignals/);
  assert.match(app, /persona\.engagementReason/);
  assert.match(app, /Standard host-model baseline/);
  assert.match(app, /Joined: \$\{joined\.join/);
  assert.match(app, /Left: \$\{left\.join/);
  assert.match(app, /does not approve Build, Manual QA, certification, deployment, or release/);
  assert.match(app, /navigator\.clipboard\.writeText/);
  assert.doesNotMatch(app, /\/api\/guided-intent\/(?:build|deploy|release|certify)/);
  assert.match(styles, /\.intent-studio-view/);
  assert.match(styles, /\.intent-studio-persona-rail #intentStudioPersonas article\[data-tier="premium"\]/);
  assert.match(styles, /@media \(max-width: 1040px\)[\s\S]{0,800}\.intent-studio-persona-rail \{ display: block/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]{0,1200}\.intent-studio-spine nav \{ display: flex/);
  assert.match(styles, /\.intent-studio-persona-rail \{ display: block; grid-column: 1 \/ -1/);
  assert.doesNotMatch(styles, /\.intent-studio-persona-rail \{ display: none/);
  assert.match(styles, /\.intent-studio-spine nav \{ display: flex;[^}]*overflow-x: auto/);
  assert.match(styles, /@media \(max-width: 390px\) \{[\s\S]{0,1400}\.intent-studio-view/);
});

test('publishes the complete Phase Studio context bridge contract', () => {
  const page = readFileSync(resolve(process.cwd(), 'public/index.html'), 'utf8');
  const script = readFileSync(resolve(process.cwd(), 'public/app.js'), 'utf8');
  const styles = readFileSync(resolve(process.cwd(), 'public/styles.css'), 'utf8');
  assert.ok(DASHBOARD_VIEWS.some(view=>view.id==='phase-studio'&&view.title==='Contributions'));
  assert.match(page, /id="phaseStudioTitle">Contributions/);
  assert.match(page, /id="phaseStudioView"/);
  assert.match(page, /id="phaseStudioContextBridge"/);
  assert.match(page, /data-phase-context="business"/);
  assert.match(page, /data-phase-context="technical"/);
  assert.match(page, /data-phase-context="shared-review"/);
  assert.match(page, /id="phaseStudioEvidenceSpine"/);
  assert.match(page, /id="phaseStudioPersonas"/);
  assert.match(page, /id="phaseStudioPersonaChanges"[^>]*aria-live="polite"/);
  assert.match(page, /Contribution only[^<]*cannot complete a phase, approve Build or accept Manual QA/i);
  assert.match(script, /function renderPhaseStudio\(/);
  assert.match(script, /async function loadPhaseStudio\(/);
  assert.match(script, /data-phase-save/);
  assert.match(script, /data-phase-handoff/);
  assert.match(script, /data-phase-review/);
  assert.match(script, /data-phase-confirm/);
  assert.match(script, /personaChanges\.joined/);
  assert.match(script, /ownerContext/);
  assert.match(styles, /\.phase-studio-view/);
  assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*\.phase-studio-layout/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.phase-studio-spine/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*\.phase-studio-review-grid/);
  assert.match(styles, /@media \(max-width: 390px\)[\s\S]*\.phase-studio-view/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test('starts, reuses, serves and stops the project intent dashboard', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-dashboard-'));
  try {
    initProject(root, { name: 'Dashboard Test' });
    await checkinProject(root, { home: resolve(root, 'home'), checkFramework: false, startRuntime: false });
    createIntent(root, { slug: 'useful-dashboard', domain: 'experience', title: 'Useful Dashboard' });
    const prototypeRoot = resolve(root, 'SPECS/6.Build/useful-dashboard/prototypes/selected');
    mkdirSync(prototypeRoot, { recursive: true });
    writeFileSync(resolve(prototypeRoot, 'index.html'), '<!doctype html><title>Prototype preview</title><h1>Useful prototype</h1>');
    const projected = listWorkItems(root)[0];
    const prototype = addArtefact(root, projected.id, {
      kind: 'prototype',
      path: 'SPECS/6.Build/useful-dashboard/prototypes/selected/index.html',
      title: 'Selected prototype'
    });

    const started = await ensureDashboard(root, { home: resolve(root, 'home') });
    assert.equal(started.status, 'running');
    assert.equal(started.started, true);

    const health = await fetch(`${started.url}/api/health`).then((response) => response.json());
    const library = await fetch(`${started.url}/api/intents`).then((response) => response.json());
    const page = await fetch(started.url).then((response) => response.text());
    const browserController = await fetch(`${started.url}/app.js`).then((response) => response.text());
    const styles = await fetch(`${started.url}/styles.css`).then((response) => response.text());
    assert.equal(health.projectName, 'Dashboard Test');
    const projectStatus = await fetch(`${started.url}/api/project`).then((response) => response.json());
    assert.equal(projectStatus.premium.showUpgrade, true);
    assert.equal(projectStatus.premium.upgradeUrl, 'https://www.conversationalcoding.dev/personas/');
    assert.equal(projectStatus.premium.provider, 'wordpress-edd');
    assert.equal(projectStatus.premium.verified, false);
    assert.equal(JSON.stringify(projectStatus.premium).includes(resolve(root, 'home')), false);
    assert.equal(library.intents[0].title, 'Useful Dashboard');
    assert.match(page, /Live work/);
    assert.match(page, /Categories/);
    assert.match(page, /Mind Palace/);
    assert.match(page, /assets\/backstory-icon\.png/);
    assert.match(page, /id="kpiToggle"/);
    assert.match(page, /id="summary"[^>]*hidden/);
    assert.match(page, /id="premiumCard"/);
    assert.match(page, /data-tab="personas"/);
    assert.match(page, /data-tab="impact"/);
    assert.match(page, /data-tab="test-scenarios"/);
    assert.match(page, /id="actionDialog"/);
    assert.match(page, /data-view="guided"/);
    for(const id of ['hooks','security','starters','portfolio','rollout'])assert.ok(DASHBOARD_VIEWS.some(view=>view.id===id));
    assert.match(page, /id="optionalViewLinks"/);
    assert.match(page, /id="hooksView"/);
    assert.match(page, /id="securityView"/);
    assert.match(page, /id="startersView"/);
    assert.match(page, /id="portfolioView"/);
    assert.match(page, /id="portfolioProgrammeLine"[^>]*role="tree"/);
    assert.match(page, /id="portfolioContext"/);
    assert.match(page, /id="portfolioPersonas"/);
    assert.match(page, /id="portfolioDependencies"/);
    assert.match(page, /id="rolloutView"/);
    assert.match(page, /id="rolloutLedger"/);
    assert.match(page, /id="rolloutContext"/);
    assert.match(page, /id="rolloutPersonas"/);
    assert.match(page, /id="rolloutAdvisoryNotice"/);
    assert.match(page, /id="rolloutSecurityNotice"/);
    assert.match(page, /id="starterPersonas"/);
    assert.match(page, /id="starterAttempts"/);
    assert.match(page, /Personas advise; the named approver decides/);
    assert.match(page, /id="securityNotice"/);
    assert.match(page, /id="securityRuns"/);
    assert.match(page, /Milestone → Handler → Delivery/);
    assert.match(page, /id="guidedView"/);
    assert.match(page, /id="guidedContent"/);
    assert.match(browserController, /\/api\/guided-discovery/);
    assert.match(browserController, /data-guided-approve/);
    assert.match(browserController, /activateDrawerTab/);
    assert.match(browserController, /ArrowRight/);
    assert.match(browserController, /button\.setAttribute\('tabindex', active \? '0' : '-1'\)/);
    assert.match(browserController, /expectedRevision/);
    assert.match(browserController, /updateGuidedApprovalState/);
    assert.match(browserController, /!approvedBy \|\| !confirmed/);
    assert.match(browserController, /data-blueprint-module/);
    assert.match(browserController, /organisationBlueprints/);
    assert.match(browserController, /Nothing is copied, fetched, executed/);
    assert.match(browserController, /Discovery records receipts only/);
    assert.match(browserController, /Later materialisation is a separate guarded workflow/);
    assert.match(browserController, /selected\.compatibilityReason/);
    assert.match(browserController, /previewSelection && previewSelection\.root\.id/);
    assert.match(browserController, /renderImpact/);
    assert.match(browserController, /impact\/preview/);
    assert.match(browserController, /impact\/confirm/);
    assert.match(browserController, /impact\/refresh/);
    assert.match(browserController, /Active perspectives/);
    assert.match(browserController, /Observed repository evidence/);
    assert.match(browserController, /Source Map coverage/);
    assert.match(browserController, /Engaged for this map/);
    assert.match(browserController, /matchCount/);
    assert.match(browserController, /renderTestScenarios/);
    assert.match(browserController, /Evidence is the source\. Personas challenge it\. People accept it\./);
    assert.match(browserController, /data-test-scenario-filter/);
    assert.match(browserController, /aria-live="polite"/);
    assert.match(browserController, /\/api\/hooks/);
    assert.match(browserController, /\/api\/security-validation/);
    assert.match(browserController, /securityAssuranceNotice/);
    assert.match(browserController, /renderSecurity/);
    assert.match(browserController, /renderStarters/);
    assert.match(browserController, /renderPortfolio/);
    assert.match(browserController, /\/api\/portfolio/);
    assert.match(browserController, /\/api\/rollout/);
    assert.match(browserController, /function rolloutFocusFor/);
    assert.match(browserController, /loadRollout\(rolloutFocusFor/);
    assert.match(browserController, /Actively engaged personas/);
    assert.match(browserController, /Standard LLM baseline/);
    assert.match(browserController, /Standard LLM baseline/);
    assert.match(browserController, /Actively engaged personas/);
    assert.match(browserController, /matchedSignals/);
    assert.match(browserController, /engagementReason/);
    assert.match(browserController, /function portfolioFocusFor/);
    assert.match(browserController, /loadPortfolio\(portfolioFocusFor/);
    assert.match(browserController, /Declared dependency/);
    assert.match(browserController, /Observed evidence/);
    assert.match(browserController, /premium personas are not installed/i);
    assert.doesNotMatch(browserController, /\/api\/portfolio\/(?:approve|mutate|dispatch|deploy|release)/);
    assert.doesNotMatch(browserController, /\/api\/rollout\/(?:edit|adopt|approve|sync|certify|risk|build|deploy|release)/);
    assert.match(browserController, /\/api\/starter-materialisation/);
    assert.match(browserController, /data-starter-apply/);
    assert.match(browserController, /data-starter-recover/);
    assert.match(browserController, /data-security-cancel/);
    assert.match(browserController, /Retry queued against the existing event/);
    assert.match(browserController, /Context carried with this event/);
    assert.doesNotMatch(browserController, /force:\s*true/);
    assert.match(styles, /\.guided-personas/);
    assert.match(styles, /\.guided-persona\[data-tier="premium"\]/);
    assert.match(styles, /\.guided-blueprint-summary/);
    assert.match(styles, /\.impact-workspace/);
    assert.match(styles, /\.impact-persona\[data-tier="premium"\]/);
    assert.match(styles, /\.source-map-coverage/);
    assert.match(styles, /\.source-map-personas/);
    assert.match(styles, /\.test-scenario-workspace/);
    assert.match(styles, /\.test-scenario-persona\[data-tier="premium"\]/);
    assert.match(styles, /\.test-scenario-loom/);
    assert.match(styles, /\.hooks-view/);
    assert.match(styles, /\.hook-personas article\[data-tier="premium"\]/);
    assert.match(styles, /\.security-view/);
    assert.match(styles, /\.security-assurance-notice/);
    assert.match(styles, /\.security-personas article\[data-tier="premium"\]/);
    assert.match(styles, /\.security-run/);
    assert.match(styles, /\.starters-view/);
    assert.match(styles, /\.starter-persona\[data-tier="premium"\]/);
    assert.match(styles, /\.portfolio-view/);
    assert.match(styles, /\.portfolio-node:focus-visible/);
    assert.match(styles, /\.portfolio-persona\[data-tier="premium"\]/);
    assert.match(styles, /\.rollout-view/);
    assert.match(styles, /\.rollout-project:focus-visible/);
    assert.match(styles, /\.rollout-layout \{ display: grid/);
    assert.match(styles, /@media \(max-width: 390px\)[\s\S]*\.rollout-view/);
    assert.match(styles, /@media \(max-width: 390px\)/);

    const starterWorkspace = await fetch(`${started.url}/api/starter-materialisation`).then((response) => response.json());
    assert.equal(starterWorkspace.schema, 'ewai.starter-materialisation-workspace/v1');
    assert.equal(starterWorkspace.activePersonas.some(({ id }) => id === 'ewai.core.operator'), true);
    assert.equal(JSON.stringify(starterWorkspace).includes(root), false);
    assert.equal(JSON.stringify(starterWorkspace).includes('entrypoint'), false);

    const untrustedStarterMutation = await fetch(`${started.url}/api/starter-materialisation/previews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ receiptId: 'missing', adapterId: 'missing', confirmed: true }),
    });
    assert.equal(untrustedStarterMutation.status, 403);

    const unsafeStarterPreview = await fetch(`${started.url}/api/starter-materialisation/previews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ receiptId: 'missing', adapterId: 'missing', confirmed: true, source: 'https://unsafe.invalid' }),
    });
    assert.equal(unsafeStarterPreview.status, 400);

    const unsafeStarterApply = await fetch(`${started.url}/api/starter-materialisation/previews/missing/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ confirmed: true, approvedBy: 'Owner', files: ['unsafe.txt'] }),
    });
    assert.equal(unsafeStarterApply.status, 400);

    const unsafeStarterRecovery = await fetch(`${started.url}/api/starter-materialisation/attempts/missing/recover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ confirmed: true, path: '/tmp/unsafe' }),
    });
    assert.equal(unsafeStarterRecovery.status, 400);

    const securityWorkspace = await fetch(`${started.url}/api/security-validation`).then((response) => response.json());
    assert.equal(securityWorkspace.schema, 'ewai.security-workspace/v1');
    assert.equal(securityWorkspace.assurance_notice, ASSURANCE_NOTICE);
    assert.equal(securityWorkspace.policy.status, 'not-configured');
    assert.equal(securityWorkspace.readiness.status, 'not-configured');
    assert.equal(Array.isArray(securityWorkspace.active_personas), true);
    assert.equal(securityWorkspace.providers.every((provider) => !('path' in provider) && !('entrypoint' in provider)), true);
    assert.equal(securityWorkspace.providers.find((provider) => provider.id === 'visa-vvah').artifact_import_supported, false);

    const untrustedSecurityMutation = await fetch(`${started.url}/api/security-validation/profiles/source/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true }),
    });
    assert.equal(untrustedSecurityMutation.status, 403);
    assert.equal((await untrustedSecurityMutation.json()).assurance_notice, ASSURANCE_NOTICE);

    const unknownSecurityField = await fetch(`${started.url}/api/security-validation/profiles/source/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ confirmed: true, untrustedPath: '/tmp/result.json' }),
    });
    assert.equal(unknownSecurityField.status, 400);
    assert.equal((await unknownSecurityField.json()).assurance_notice, ASSURANCE_NOTICE);

    const knowledgePath = resolve(root, 'SPECS/1.Scope/project-context.md');
    writeFileSync(knowledgePath, '# Project context\n\nKnowledge stays close to the project.\n');
    writeFileSync(resolve(root, 'private.txt'), 'not SPECS knowledge');
    symlinkSync(resolve(root, 'private.txt'), resolve(root, 'SPECS/1.Scope/private-link.txt'));
    const knowledge = await fetch(`${started.url}/api/knowledge`).then((response) => response.json());
    assert.equal(knowledge.documents.some((document) => document.path === '1.Scope/project-context.md'), true);
    assert.equal(knowledge.documents.some((document) => document.path.endsWith('private-link.txt')), false);
    const knowledgeDocument = await fetch(`${started.url}/api/knowledge/document?path=${encodeURIComponent('1.Scope/project-context.md')}`).then((response) => response.json());
    assert.match(knowledgeDocument.document.content, /Knowledge stays close/);
    const searchedKnowledge = await fetch(`${started.url}/api/knowledge?q=project-context`).then((response) => response.json());
    assert.equal(searchedKnowledge.count, 1);
    assert.equal(searchedKnowledge.documents[0].path, '1.Scope/project-context.md');
    assert.equal(searchedKnowledge.matches[0].heading, 'Project context');
    const palaceTidiness = await fetch(`${started.url}/api/palace/tidiness`).then((response) => response.json());
    assert.equal(palaceTidiness.schema, 'ewai.palace-tidiness/v1');
    const escapedKnowledge = await fetch(`${started.url}/api/knowledge/document?path=${encodeURIComponent('../private.txt')}`);
    assert.equal(escapedKnowledge.status, 404);

    const work = await fetch(`${started.url}/api/work-items`).then((response) => response.json());
    const groups = await fetch(`${started.url}/api/groups`).then((response) => response.json());
    assert.equal(work.items[0].title, 'Useful Dashboard');
    assert.equal(work.items[0].execution.valid, true);
    assert.equal(work.items[0].execution.actions.beginHarness.permitted, true);
    assert.equal(groups.groups[0].slug, 'experience');

    const queuedHandoff = await fetch(`${started.url}/api/work-items/${encodeURIComponent(work.items[0].id)}/handoff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ action: 'begin', confirmed: true })
    }).then((response) => response.json());
    assert.equal(queuedHandoff.handoff.status, 'pending');
    assert.equal(queuedHandoff.view.dashboardHandoff.id, queuedHandoff.handoff.id);
    assert.equal(existsSync(resolve(root, 'SPECS/6.Build/useful-dashboard/delivery-state.json')), false);
    const handoffs = await fetch(`${started.url}/api/dashboard-handoffs`).then((response) => response.json());
    assert.equal(handoffs.handoffs[0].intentId, work.items[0].id);

    const personaLibrary = await fetch(`${started.url}/api/personas`).then((response) => response.json());
    assert.equal(personaLibrary.personas.some((persona) => persona.id === 'ewai.core.maintainer'), true);
    assert.match(personaLibrary.personas.find((persona) => persona.id === 'ewai.core.maintainer').description, /future engineers/);

    const unknownPersona = await fetch(`${started.url}/api/work-items/${encodeURIComponent(work.items[0].id)}/personas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ personaRef: 'missing.persona', role: 'reviewer', depth: 3 })
    });
    assert.equal(unknownPersona.status, 400);

    const attachedPersona = await fetch(`${started.url}/api/work-items/${encodeURIComponent(work.items[0].id)}/personas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ personaRef: 'ewai.core.maintainer', role: 'reviewer', depth: 4 })
    }).then((response) => response.json());
    assert.deepEqual(attachedPersona.view.intent.personas, [{ ref: 'ewai.core.maintainer', role: 'reviewer', depth: 4 }]);

    const revisedPersona = await fetch(`${started.url}/api/work-items/${encodeURIComponent(work.items[0].id)}/personas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ personaRef: 'ewai.core.maintainer', role: 'primary', depth: 5 })
    }).then((response) => response.json());
    assert.deepEqual(revisedPersona.view.intent.personas, [{ ref: 'ewai.core.maintainer', role: 'primary', depth: 5 }]);

    const createdPersona = await fetch(`${started.url}/api/personas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ slug: 'plain-language-reviewer', name: 'Plain Language Reviewer', category: 'content' })
    }).then((response) => response.json());
    assert.equal(createdPersona.persona.id, 'project.plain-language-reviewer');
    assert.equal(existsSync(resolve(root, 'SPECS/1.Scope/personas/project/plain-language-reviewer.md')), true);

    const detachedPersona = await fetch(`${started.url}/api/work-items/${encodeURIComponent(work.items[0].id)}/personas/${encodeURIComponent('ewai.core.maintainer')}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({})
    }).then((response) => response.json());
    assert.deepEqual(detachedPersona.view.intent.personas, []);

    const prototypeResponse = await fetch(`${started.url}/prototype/${encodeURIComponent(work.items[0].id)}/${prototype.id}/`);
    assert.equal(prototypeResponse.status, 200);
    assert.match(prototypeResponse.headers.get('content-security-policy'), /sandbox/);
    assert.match(await prototypeResponse.text(), /Useful prototype/);

    const rejected = await fetch(`${started.url}/api/work-items/${encodeURIComponent(work.items[0].id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentSprint: true })
    });
    assert.equal(rejected.status, 403);

    const patched = await fetch(`${started.url}/api/work-items/${encodeURIComponent(work.items[0].id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ currentSprint: true })
    }).then((response) => response.json());
    assert.equal(patched.item.currentSprint, true);

    const phaseBypass = await fetch(`${started.url}/api/work-items/${encodeURIComponent(work.items[0].id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ currentPhase: 'build', completionPercent: 90 })
    });
    assert.equal(phaseBypass.status, 409);

    await fetch(`${started.url}/api/active/${encodeURIComponent(work.items[0].id)}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ tool: 'codex', phaseKey: 'build', summary: 'Started dashboard work.' })
    });
    const active = await fetch(`${started.url}/api/active?completed=0`).then((response) => response.json());
    assert.equal(active.sessions[0].latestEventSummary, 'Started dashboard work.');

    writeFileSync(resolve(root, '.ewai-pipeline/runtime/checkin.json'), JSON.stringify({
      schema: 'ewai.checkin-state/v1',
      checkedAt: new Date().toISOString(),
      premium: { provider: 'wordpress-edd', access: 'available', status: 'current', installed: true, verified: true, compatibility: 'current', revision: 'a'.repeat(64), upgradeUrl: null }
    }));
    const entitledProject = await fetch(`${started.url}/api/project`).then((response) => response.json());
    assert.equal(entitledProject.premium.showUpgrade, false);
    assert.equal(entitledProject.premium.upgradeUrl, null);
    assert.equal(entitledProject.premium.provider, 'wordpress-edd');
    assert.equal(entitledProject.premium.verified, true);
    assert.equal(entitledProject.premium.revision, 'a'.repeat(64));

    const reused = await ensureDashboard(root);
    assert.equal(reused.started, false);
    assert.equal(reused.pid, started.pid);
  } finally {
    await stopDashboard(root);
    assert.notEqual((await dashboardStatus(root)).status, 'running');
    rmSync(root, { recursive: true, force: true });
  }
});

test('serves the safe Hooks ledger and guards retry and disable mutations', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-hooks-dashboard-'));
  try {
    initProject(root, { name: 'Hooks Dashboard Test' });
    const subscription = registerRejectingLifecycleHandler(root);
    createIntent(root, {
      slug: 'visible-handoff', domain: 'platform', title: 'Visible Handoff',
      personas: ['ewai.core.end-user:primary:3', 'ewai.premium.product-owner:consulted:4'],
    });
    const started = await ensureDashboard(root);
    let workspace;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      workspace = await fetch(`${started.url}/api/hooks`).then((response) => response.json());
      if (workspace.deliveries[0]?.status === 'rejected') break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    assert.equal(workspace.schema, 'ewai.lifecycle-hook-workspace/v1');
    assert.equal(workspace.deliveries[0].status, 'rejected');
    assert.equal(workspace.events[0].personas.some((persona) => persona.tier === 'premium'), true);
    assert.equal(JSON.stringify(workspace).includes(root), false);
    assert.equal(JSON.stringify(workspace).includes('super-secret-raw-handler-output'), false);
    assert.equal('trustedRoot' in workspace.handlers[0], false);

    const wrongOrigin = await fetch(`${started.url}/api/hooks/deliveries/${workspace.deliveries[0].id}/retry`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:9999' }, body: JSON.stringify({ confirmed: true }),
    });
    assert.equal(wrongOrigin.status, 403);
    const retried = await fetch(`${started.url}/api/hooks/deliveries/${workspace.deliveries[0].id}/retry`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url }, body: JSON.stringify({ confirmed: true }),
    }).then((response) => response.json());
    assert.equal(retried.status, 'queued');
    assert.equal(retried.idempotencyKey, workspace.deliveries[0].idempotencyKey);

    const disabled = await fetch(`${started.url}/api/hooks/subscriptions/${subscription.id}/disable`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url }, body: JSON.stringify({ confirmed: true }),
    }).then((response) => response.json());
    assert.equal(disabled.enabled, false);
    workspace = await fetch(`${started.url}/api/hooks`).then((response) => response.json());
    assert.equal(workspace.subscriptions[0].enabled, false);
    assert.equal(workspace.events[0].name, 'ewai.intent.created');
  } finally {
    await stopDashboard(root);
    rmSync(root, { recursive: true, force: true });
  }
});

test('serves safe read-only persona test-scenario workspace states through the existing viewer', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-test-scenario-dashboard-'));
  const personas = [
    { id: 'project.product-owner', name: 'Product Owner', tier: 'project', category: 'product', description: 'Protects journeys and acceptance outcomes.', tags: ['journey', 'acceptance', 'permission'], capabilities: ['product review'], path: '/private/project.md', body: 'hidden project body' },
    { id: 'premium.identity-reviewer', name: 'Identity Reviewer', tier: 'premium', category: 'security', description: 'Challenges permissions and privacy.', tags: ['permission', 'privacy'], capabilities: ['security review'], path: '/private/premium.md', body: 'hidden premium body' }
  ];
  try {
    initProject(root, { name: 'Test Scenario Dashboard' });
    createIntent(root, {
      slug: 'customer-access', domain: 'experience', title: 'Customer access',
      details: {
        problem: 'Delegates cannot reliably request access.',
        desiredOutcome: 'Delegates complete the request safely.',
        journeys: '1. [J-001] A delegate submits an access request.',
        acceptanceCriteria: '1. [AC-001] Only an authorised delegate can submit the request.',
        constraints: 'Privacy and accessibility remain mandatory.'
      }
    });
    const build = resolve(root, 'SPECS/6.Build/customer-access');
    mkdirSync(resolve(build, 'gates/plan'), { recursive: true });
    writeFileSync(resolve(build, 'gates/plan/plan-contract.json'), `${JSON.stringify({ schema_version: 1, slug: 'customer-access', test_obligations: [] }, null, 2)}\n`);
    writeFileSync(resolve(build, 'gates/plan/claim-ledger.json'), `${JSON.stringify({ schema_version: 1, slug: 'customer-access', implementation_claims: [] }, null, 2)}\n`);

    const started = await ensureDashboard(root);
    const work = await fetch(`${started.url}/api/work-items`).then((response) => response.json());
    const reference = encodeURIComponent(work.items[0].id);
    const missing = await fetch(`${started.url}/api/work-items/${reference}/viewer`).then((response) => response.json());
    assert.equal(missing.testScenarios.status, 'missing');
    assert.match(missing.testScenarios.nextAction, /test-scenarios prepare/);

    const brief = preparePersonaTestScenarioBrief(root, 'customer-access', { focus: 'permission privacy journey', personas });
    const selected = brief.activePersonas[0];
    recordPersonaTestScenarios(root, 'customer-access', {
      schema: 'ewai.persona-test-scenarios/v1', slug: 'customer-access', focus: brief.focus, preparedSourceDigest: brief.sourceDigest,
      scenarios: [{
        id: 'PTS-001', title: 'Authorised delegate submits access request', type: 'permissions',
        sourceRefs: ['intent:journey:J-001', 'intent:acceptance:AC-001'],
        personaContributions: [{ personaId: selected.id, concern: '<script>Prove the permission boundary.</script>' }],
        preconditions: ['An authenticated delegate has request permission.'],
        actions: ['Submit a valid access request.'],
        expectedResults: ['The request is accepted and a clear success outcome is displayed.'],
        evidenceRoute: 'automated', automation: 'automated',
        plannedTest: { file: 'tests/access.test.mjs', name: 'authorised delegate submits access request' },
        owner: 'Delivery team', status: 'accepted'
      }],
      gaps: [{ id: 'GAP-001', question: 'Representative-user wording validation remains open.', status: 'open' }]
    }, { personas, reviewedBy: 'Product Owner', now: '2026-08-18T12:00:00.000Z' });

    const recorded = await fetch(`${started.url}/api/work-items/${reference}/viewer`).then((response) => response.json());
    assert.equal(recorded.testScenarios.status, 'recorded');
    assert.equal(recorded.testScenarios.reviewer, 'Product Owner');
    assert.equal(recorded.testScenarios.scenarios[0].id, 'PTS-001');
    assert.equal(recorded.testScenarios.activePersonas.length > 0, true);
    assert.equal(JSON.stringify(recorded.testScenarios).includes(root), false);
    assert.equal(JSON.stringify(recorded.testScenarios).includes('hidden premium body'), false);
    assert.equal(recorded.testScenarios.guidance.readOnly, true);

    const mutation = await fetch(`${started.url}/api/work-items/${reference}/test-scenarios`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url }, body: '{}'
    });
    assert.equal(mutation.status, 404);

    const intentPath = resolve(root, 'SPECS/2.Purpose/intents/experience/customer-access.md');
    writeFileSync(intentPath, `${readFileSync(intentPath, 'utf8')}\nChanged source truth.\n`);
    const stale = await fetch(`${started.url}/api/work-items/${reference}/viewer`).then((response) => response.json());
    assert.equal(stale.testScenarios.status, 'stale');
    assert.equal(stale.testScenarios.scenarios[0].id, 'PTS-001');

    writeFileSync(resolve(build, 'test-scenarios.md'), '# Tampered readable copy\n');
    const invalid = await fetch(`${started.url}/api/work-items/${reference}/viewer`).then((response) => response.json());
    assert.equal(invalid.testScenarios.status, 'invalid');
    assert.deepEqual(invalid.testScenarios.scenarios, []);
  } finally {
    await stopDashboard(root);
    rmSync(root, { recursive: true, force: true });
  }
});

test('serves guarded guided discovery draft, persona, preview, and approval routes', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-guided-dashboard-'));
  try {
    initProject(root, { name: 'Guided Dashboard Test' });
    writeRuntimeOrganisationBlueprint(root);
    const started = await ensureDashboard(root);
    const initial = await fetch(`${started.url}/api/guided-discovery`).then((response) => response.json());
    assert.equal(initial.schema, 'ewai.guided-discovery/v1');
    assert.equal(initial.draft.revision, 0);
    assert.equal(initial.activePersonas.length >= 2, true);
    assert.equal(initial.activePersonas.some((persona) => 'path' in persona), false);
    assert.equal(initial.organisationBlueprints.length, 1);
    assert.equal(initial.organisationBlueprints[0].id, 'org.acme.engineering');
    assert.equal(JSON.stringify(initial.organisationBlueprints).includes(root), false);
    assert.equal(JSON.stringify(initial.organisationBlueprints).includes('Use local context'), false);

    const answers = {
      schema: 'ewai.discovery-answers/v1',
      project: {
        name: 'Guided Dashboard Test',
        purpose: 'Let participants complete project discovery in the browser.',
        problem: 'Non-technical participants cannot operate the terminal interview.',
        primaryUsers: ['Product participant'],
        desiredOutcomes: ['A reviewed discovery can be approved without terminal use']
      },
      delivery: {
        technologyPacks: [],
        deploymentTarget: 'Local dashboard',
        organisationBlueprint: { packId: 'org.acme.engineering', enabledModules: [] }
      },
      assurance: {
        dataClassification: 'internal', personalData: 'no', sensitiveData: 'no',
        authentication: 'no', multiTenant: 'no', internetFacing: 'no', payments: 'no',
        aiFeatures: 'yes', accessibility: 'yes', availability: 'standard'
      }
    };
    const wrongOrigin = await fetch(`${started.url}/api/guided-discovery/draft`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:9999' },
      body: JSON.stringify({ expectedRevision: 0, currentSection: 'people', answers })
    });
    assert.equal(wrongOrigin.status, 403);

    const saved = await fetch(`${started.url}/api/guided-discovery/draft`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ expectedRevision: 0, currentSection: 'people', answers })
    }).then((response) => response.json());
    assert.equal(saved.draft.revision, 1);
    assert.equal(saved.validation.valid, true);
    assert.equal(saved.preview.outputs.length, 13);
    assert.equal(saved.preview.outputs.some((output) => 'content' in output || 'path' in output), false);
    assert.equal(saved.preview.organisationBlueprint.root.id, 'org.acme.engineering');
    assert.equal(saved.guidance.prompts.every((prompt) => saved.activePersonas.some((persona) => persona.id === prompt.personaId)), true);

    const unnamedApproval = await fetch(`${started.url}/api/guided-discovery/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ expectedRevision: 1, confirmed: true, approvedBy: '' })
    });
    assert.equal(unnamedApproval.status, 409);

    const approved = await fetch(`${started.url}/api/guided-discovery/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ expectedRevision: 1, confirmed: true, approvedBy: 'Product Owner' })
    }).then((response) => response.json());
    assert.equal(approved.status, 'completed');
    assert.equal(approved.approval.approvedBy, 'Product Owner');
    assert.equal(existsSync(resolve(root, 'SPECS/1.Scope/context.md')), true);
    assert.equal(existsSync(resolve(root, 'SPECS/1.Scope/personas/project/acme-delivery-owner.md')), true);
  } finally {
    await stopDashboard(root);
    rmSync(root, { recursive: true, force: true });
  }
});

test('serves safe server-owned guided intent routes on loopback', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-guided-intent-dashboard-'));
  try {
    initProject(root, { name: 'Guided intent dashboard' });
    const started = await ensureDashboard(root);
    const initial = await fetch(`${started.url}/api/guided-intent`).then((response) => response.json());
    assert.equal(initial.schema, 'ewai.guided-intent/v1');
    assert.equal(initial.draft.revision, 0);
    assert.equal(initial.baseline.completeWithoutPremium, true);
    assert.equal(initial.activePersonas.every((persona) => !('path' in persona) && !('rawDefinition' in persona)), true);
    assert.equal(JSON.stringify(initial).includes(root), false);

    const requestRoot = await fetch(`${started.url}/api/guided-intent/draft`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ expectedRevision: 0, currentSection: 'problem', mode: 'create', intent: guidedIntentPayload(), projectRoot: '/tmp/untrusted' }),
    });
    assert.equal(requestRoot.status, 400);
    assert.match((await requestRoot.json()).error, /unknown field: projectRoot/);

    const wrongOrigin = await fetch(`${started.url}/api/guided-intent/draft`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:9999' },
      body: JSON.stringify({ expectedRevision: 0, currentSection: 'problem', mode: 'create', intent: guidedIntentPayload() }),
    });
    assert.equal(wrongOrigin.status, 403);

    const saved = await fetch(`${started.url}/api/guided-intent/draft`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ expectedRevision: 0, currentSection: 'review', mode: 'create', intent: guidedIntentPayload() }),
    }).then((response) => response.json());
    assert.equal(saved.draft.revision, 1);
    assert.equal(saved.validation.valid, true);
    assert.deepEqual(saved.preview.destinations, [
      'SPECS/2.Purpose/intents/experience/browser-intent.md',
      'SPECS/2.Purpose/intents/experience/browser-intent.json',
    ]);

    const unnamed = await fetch(`${started.url}/api/guided-intent/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ expectedRevision: 1, confirmed: true, approvedBy: '' }),
    });
    assert.equal(unnamed.status, 409);

    const approved = await fetch(`${started.url}/api/guided-intent/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ expectedRevision: 1, confirmed: true, approvedBy: 'Product Owner' }),
    }).then((response) => response.json());
    assert.equal(approved.status, 'completed');
    assert.equal(approved.authority.buildApproved, false);
    assert.equal(existsSync(resolve(root, approved.created.markdownPath)), true);

    const restarted = await fetch(`${started.url}/api/guided-intent`).then((response) => response.json());
    assert.equal(restarted.draft.revision, 0);
  } finally {
    await stopDashboard(root);
    rmSync(root, { recursive: true, force: true });
  }
});

test('serves strict server-owned Phase Studio routes on loopback', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-phase-studio-dashboard-'));
  try {
    initProject(root, { name: 'Phase Studio dashboard' });
    seedPhaseStudioDelivery(root);
    const started = await ensureDashboard(root);
    const reference = encodeURIComponent('experience/phase-studio-route');
    const initial = await fetch(`${started.url}/api/work-items/${reference}/phase-studio`).then((response) => response.json());
    assert.equal(initial.schema, 'ewai.phase-studio/v1');
    assert.equal(initial.status, 'empty');
    assert.equal(initial.profile.id, 'plan');
    assert.equal(initial.capabilities.contribute, true);
    assert.equal(initial.authority.delivery, 'none');
    assert.equal(JSON.stringify(initial).includes(root), false);

    const suppliedAuthority = await fetch(`${started.url}/api/work-items/${reference}/phase-studio/draft`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ expectedRevision: 0, ownerContext: 'business', ownerName: 'Casey Morgan', entries: [], projectRoot: '/tmp/untrusted', phase: 'delivery' }),
    });
    assert.equal(suppliedAuthority.status, 400);
    assert.match((await suppliedAuthority.json()).error, /unknown field: projectRoot|unknown field: phase/);

    const wrongOrigin = await fetch(`${started.url}/api/work-items/${reference}/phase-studio/draft`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:9999' },
      body: JSON.stringify({ expectedRevision: 0, ownerContext: 'business', ownerName: 'Casey Morgan', entries: [] }),
    });
    assert.equal(wrongOrigin.status, 403);

    const saved = await fetch(`${started.url}/api/work-items/${reference}/phase-studio/draft`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({
        expectedRevision: 0, ownerContext: 'business', ownerName: 'Casey Morgan',
        entries: [{ topic: 'outcomes', classification: 'participant-statement', statement: 'Owners need one shared evidence thread.', source: 'Owner workshop' }],
        questions: ['Which operations group accepts the change?'], conflicts: [], limitations: ['Representative review remains pending.'],
      }),
    }).then((response) => response.json());
    assert.equal(saved.draft.revision, 1);
    assert.equal(saved.activePersonas.every((persona) => !('path' in persona) && !('rawDefinition' in persona)), true);

    const handed = await fetch(`${started.url}/api/work-items/${reference}/phase-studio/handoff`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({
        expectedRevision: 1, currentDigest: saved.draft.digest, destinationContext: 'technical', toOwner: 'Ravi Shah',
        reason: 'Validate dependencies and recovery.', questions: ['Which tests demonstrate recovery?'],
      }),
    }).then((response) => response.json());
    assert.equal(handed.draft.revision, 2);
    assert.equal(handed.draft.ownerContext, 'technical');

    const reviewResponse = await fetch(`${started.url}/api/work-items/${reference}/phase-studio/review`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ expectedRevision: 2, currentDigest: handed.draft.digest }),
    });
    assert.equal(reviewResponse.status, 202);
    const review = await reviewResponse.json();
    assert.equal(review.authority, 'none');
    assert.equal(review.handoff.action, 'review-contribution');
    assert.equal(JSON.stringify(review).includes('Owners need one shared evidence thread.'), false);

    const confirmedResponse = await fetch(`${started.url}/api/work-items/${reference}/phase-studio/confirm`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ expectedRevision: 2, currentDigest: handed.draft.digest, confirmed: true, confirmedBy: 'Morgan Lee' }),
    });
    assert.equal(confirmedResponse.status, 201);
    const confirmed = await confirmedResponse.json();
    assert.equal(confirmed.authority.phaseCompleted, false);
    assert.equal(existsSync(resolve(root, confirmed.created.jsonPath)), true);

    const discarded = await fetch(`${started.url}/api/work-items/${reference}/phase-studio/draft`, {
      method: 'DELETE', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ expectedRevision: confirmed.draftRevision, confirmed: true }),
    }).then((response) => response.json());
    assert.equal(discarded.status, 'discarded');
    assert.equal(discarded.authority.evidenceDeleted, false);
    assert.equal(existsSync(resolve(root, confirmed.created.jsonPath)), true);
  } finally {
    await stopDashboard(root);
    rmSync(root, { recursive: true, force: true });
  }
});

test('serves project intent tools over the configured MCP stdio boundary', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-mcp-runtime-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(import.meta.dirname, '../bin/ewai'), 'mcp', '--project', root],
    cwd: root,
    stderr: 'pipe'
  });
  const client = new Client({ name: 'ewai-runtime-test', version: '1.0.0' });
  try {
    initProject(root, { name: 'MCP Runtime Test' });
    createIntent(root, { slug: 'mcp-visible', domain: 'integration', title: 'MCP Visible' });
    await client.connect(transport);

    const tools = await client.listTools();
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_list_intents'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_search_palace'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_palace_tidiness'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_create_intent'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_create_intent_map'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_list_work_items'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_active_event'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_delivery_begin'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_list_dashboard_handoffs'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_resolve_dashboard_handoff'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_delivery_continue'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_delivery_start_phase'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_delivery_complete_phase'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_delivery_approve_build'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_list_execution_leases'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_acquire_execution_lease'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_heartbeat_execution_lease'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_release_execution_lease'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_source_map_coverage'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_source_map_profiles'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_source_map_files'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_rollout_status'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_meeting_status'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_meeting_register'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_meeting_prepare'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_meeting_review'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_meeting_promote'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_knowledge_proposal_sources'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_knowledge_proposal_status'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_knowledge_proposal_prepare'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_knowledge_proposal_record'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_knowledge_proposal_review'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_knowledge_proposal_materialise'), true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_knowledge_proposal_recover'), true);
    assert.equal(tools.tools.find((tool) => tool.name === 'ewai_meeting_status').annotations.readOnlyHint, true);
    assert.equal(tools.tools.find((tool) => tool.name === 'ewai_meeting_promote').annotations.destructiveHint, false);
    assert.equal(tools.tools.find((tool) => tool.name === 'ewai_knowledge_proposal_status').annotations.readOnlyHint, true);
    assert.equal(tools.tools.find((tool) => tool.name === 'ewai_knowledge_proposal_recover').annotations.destructiveHint, true);
    assert.equal(tools.tools.some((tool) => tool.name === 'ewai_set_phase'), false);

    const result = await client.callTool({ name: 'ewai_list_intents', arguments: {} });
    assert.equal(result.structuredContent.intents[0].title, 'MCP Visible');
    const leases = await client.callTool({ name: 'ewai_list_execution_leases', arguments: {} });
    assert.deepEqual(leases.structuredContent.leases, []);
    await client.callTool({ name: 'ewai_index_refresh', arguments: {} });
    const sourceMapCoverage = await client.callTool({ name: 'ewai_source_map_coverage', arguments: {} });
    assert.equal(sourceMapCoverage.structuredContent.schema, 'ewai.repository-source-map-coverage/v1');
    const sourceMapProfiles = await client.callTool({ name: 'ewai_source_map_profiles', arguments: { sourceKind: 'core', limit: 3 } });
    assert.equal(sourceMapProfiles.structuredContent.profiles.length, 3);
    const sourceMapFiles = await client.callTool({ name: 'ewai_source_map_files', arguments: { limit: 5 } });
    assert.equal(sourceMapFiles.structuredContent.files.length > 0, true);
    assert.equal(JSON.stringify(sourceMapFiles.structuredContent).includes(root), false);
    const rollout = await client.callTool({ name: 'ewai_rollout_status', arguments: {} });
    assert.equal(rollout.structuredContent.schema, 'ewai.rollout-workspace/v1');
    assert.equal(rollout.structuredContent.status, 'not-configured');
    assert.equal(rollout.structuredContent.notices.advisory, ROLLOUT_ADVISORY_NOTICE);
    assert.equal(rollout.structuredContent.notices.security, ASSURANCE_NOTICE);
    const meeting = await client.callTool({ name: 'ewai_meeting_status', arguments: {} });
    assert.equal(meeting.structuredContent.schema, 'ewai.meeting-evidence-workspace/v1');
    assert.equal(meeting.structuredContent.notices.includes(MEETING_EVIDENCE_DISCLAIMER), true);
    const knowledgeProposals = await client.callTool({ name: 'ewai_knowledge_proposal_status', arguments: {} });
    assert.equal(knowledgeProposals.structuredContent.schema, 'ewai.knowledge-proposal-workspace/v1');
    assert.equal(knowledgeProposals.structuredContent.notices.includes(KNOWLEDGE_PROPOSALS_DISCLAIMER), true);

    const rejectedMapArguments = {
      confirmed: false,
      approvedBy: 'Runtime test',
      map: {
        slug: 'rejected-mcp-work',
        title: 'Rejected MCP work',
        idea: 'This map has not been approved.',
        desiredOutcome: 'No durable files are created.',
        intents: [{
          domain: 'integration',
          slug: 'rejected-capability',
          title: 'Rejected capability',
          problem: 'The map lacks approval.',
          desiredOutcome: 'Creation is refused.',
        }],
      },
    };
    const rejectedMap = await client.callTool({
      name: 'ewai_create_intent_map',
      arguments: rejectedMapArguments,
    });
    assert.equal(rejectedMap.isError, true);
    assert.equal(existsSync(resolve(
      root,
      'SPECS/2.Purpose/explorations/intent-maps/rejected-mcp-work.md',
    )), false);
    assert.equal(existsSync(resolve(
      root,
      'SPECS/2.Purpose/intents/integration/rejected-capability.md',
    )), false);

    const mapped = await client.callTool({
      name: 'ewai_create_intent_map',
      arguments: {
        confirmed: true,
        approvedBy: 'Runtime test',
        map: {
          slug: 'mcp-shaped-work',
          title: 'MCP shaped work',
          idea: 'Shape a connected capability through MCP.',
          desiredOutcome: 'The approved product structure is durable.',
          intents: [{
            domain: 'integration',
            slug: 'mapped-capability',
            title: 'Mapped capability',
            problem: 'The capability needs durable product context.',
            desiredOutcome: 'Its origin and relationship remain visible.',
            relationships: [{
              type: 'relates-to',
              target: 'integration/mcp-visible',
              rationale: 'Both capabilities share the same integration boundary.',
            }],
          }],
        },
      },
    });
    assert.equal(mapped.structuredContent.intents[0].reference, 'integration/mapped-capability');
    const mappedIntent = readRuntimeIntent(root, 'integration/mapped-capability');
    assert.equal(mappedIntent.intentMap, 'mcp-shaped-work');
    assert.deepEqual(mappedIntent.relationships, [{
      type: 'relates-to',
      target: 'integration/mcp-visible',
      rationale: 'Both capabilities share the same integration boundary.',
    }]);

    await client.callTool({
      name: 'ewai_active_start',
      arguments: { reference: 'integration/mcp-visible', tool: 'codex', phaseKey: 'plan', summary: 'Planning started.' }
    });
    const active = await client.callTool({ name: 'ewai_list_active_work', arguments: {} });
    assert.equal(active.structuredContent.sessions[0].latestEventSummary, 'Planning started.');
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('supports hundreds of grouped work items without accepting scalar phase overrides', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-runtime-scale-'));
  try {
    initProject(root, { name: 'Scale Test' });
    const intentsRoot = resolve(root, 'SPECS/2.Purpose/intents');
    for (let index = 0; index < 240; index += 1) {
      const domain = `domain-${index % 12}`;
      const directory = resolve(intentsRoot, domain);
      mkdirSync(directory, { recursive: true });
      writeFileSync(resolve(directory, `intent-${String(index).padStart(3, '0')}.md`), `---\nschema: ewai.intent/v1\nslug: intent-${String(index).padStart(3, '0')}\ntitle: Intent ${index}\nstatus: draft\npersonas: []\n---\n\n# Intent ${index}\n\n## Problem\n\nProblem ${index}.\n`);
    }

    const items = listWorkItems(root);
    assert.equal(items.length, 240);
    assert.equal(new Set(items.flatMap((item) => item.groups.map((group) => group.slug))).size, 12);

    updateWorkItem(root, items[0].id, {
      lane: 'active',
      state: 'in-progress',
      currentSprint: true,
      completionPercent: 42,
      currentPhase: 'build',
      priority: 'P1'
    });
    const updated = listWorkItems(root, { sprint: 'current' });
    assert.equal(updated.length, 1);
    assert.equal(updated[0].lane, 'backlog');
    assert.equal(updated[0].state, 'not-started');
    assert.equal(updated[0].completionPercent, 0);
    assert.equal(updated[0].currentPhase, 'backlog');
    assert.equal(updated[0].priority, 'P1');
    assert.equal(updated[0].execution.actions.beginHarness.permitted, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('preserves phases, linked materials, and live delivery activity for an intent', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-runtime-activity-'));
  try {
    initProject(root, { name: 'Activity Test' });
    createIntent(root, { slug: 'observable-delivery', domain: 'delivery', title: 'Observable Delivery' });
    const item = listWorkItems(root)[0];

    setPhase(root, item.id, 'plan', { status: 'completed', notes: 'Plan approved.' });
    setPhase(root, item.id, 'plan', { notes: 'Plan evidence retained.' });
    setPhase(root, item.id, 'build', { status: 'running', notes: 'Implementation underway.' });
    addArtefact(root, item.id, { kind: 'plan', path: 'SPECS/6.Build/observable-delivery/build-plan.md', title: 'Build plan' });
    startActiveSession(root, item.id, { tool: 'codex', phaseKey: 'build', summary: 'Started implementation.' });
    addActivityEvent(root, item.id, { eventType: 'progress', tool: 'codex', phaseKey: 'build', summary: 'API complete.' });

    const view = readWorkItemView(root, item.id);
    assert.equal(view.phases.length, 2);
    assert.equal(view.phases.find((phase) => phase.phaseKey === 'plan').status, 'completed');
    assert.equal(view.artefacts[0].title, 'Build plan');
    assert.equal(view.activity.events.length, 2);
    assert.equal(listActiveSessions(root)[0].latestEventSummary, 'API complete.');

    finishActiveSession(root, item.id, { status: 'completed', summary: 'Implementation complete.' });
    assert.equal(listActiveSessions(root)[0].status, 'completed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps domain grouping current when intent metadata changes', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-runtime-identity-'));
  try {
    initProject(root, { name: 'Identity Test' });
    const first = createIntent(root, { slug: 'shared-capability', domain: 'operations', title: 'Operations Capability' });

    listWorkItems(root);
    writeFileSync(first.path, readFileSync(first.path, 'utf8').replace('domain: operations', 'domain: governance'));
    const updated = listWorkItems(root).find((item) => item.id === 'operations/shared-capability');
    assert.deepEqual(updated.groups.map((group) => group.slug), ['governance']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses ambiguous intent slug lookup in legacy project content', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-runtime-ambiguous-intent-'));
  try {
    initProject(root, { name: 'Ambiguous Intent Test' });
    const intentsRoot = resolve(root, 'SPECS/2.Purpose/intents');
    for (const domain of ['alerts', 'billing']) {
      const directory = resolve(intentsRoot, domain);
      mkdirSync(directory, { recursive: true });
      writeFileSync(resolve(directory, 'shared-name.md'), `---\nschema: ewai.intent/v1\nslug: shared-name\ndomain: ${domain}\ntitle: Shared name\nstatus: draft\npersonas: []\nrelationships: []\n---\n\n# Shared name\n`);
    }
    assert.throws(() => readRuntimeIntent(root, 'shared-name'), /ambiguous intent slug/i);
    assert.equal(readRuntimeIntent(root, 'alerts/shared-name').domain, 'alerts');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('serves guarded impact preview, confirmation, refresh, and safe viewer state', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-impact-dashboard-'));
  try {
    initProject(root, { name: 'Impact Dashboard Test' });
    createIntent(root, {
      slug: 'customer-access',
      domain: 'experience',
      title: 'Customer access',
      personas: ['ewai.core.maintainer:consulted:4']
    });
    mkdirSync(resolve(root, 'src'), { recursive: true });
    writeFileSync(resolve(root, 'src/access-form.mjs'), `
      import { canRequest } from './permission.mjs';
      export function submitAccess(user) { return canRequest(user); }
    `);
    writeFileSync(resolve(root, 'src/permission.mjs'), `
      export function canRequest(user) { return user.role === 'delegate'; }
    `);
    refreshRepositoryIndex(root);
    const started = await ensureDashboard(root);
    const work = await fetch(`${started.url}/api/work-items`).then((response) => response.json());
    const reference = encodeURIComponent(work.items[0].id);
    const viewer = await fetch(`${started.url}/api/work-items/${reference}/viewer`).then((response) => response.json());
    assert.equal(viewer.impact.index.fresh, true);
    assert.equal(viewer.impact.assessments.length, 0);
    assert.equal(viewer.sourceMap.coverage.schema, 'ewai.repository-source-map-coverage/v1');
    assert.equal(viewer.sourceMap.profiles.profiles.length > 0, true);
    assert.equal(viewer.sourceMap.activePersonas.some((persona) => persona.id === 'ewai.core.maintainer'), true);
    assert.equal(viewer.sourceMap.files.files.every((file) => file.analysisOutcome !== 'analysed'), true);
    assert.equal(JSON.stringify(viewer.sourceMap).includes(root), false);

    const wrongOrigin = await fetch(`${started.url}/api/work-items/${reference}/impact/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:9999' },
      body: JSON.stringify({ summary: 'Change access workflow.', targets: ['src/access-form.mjs'] })
    });
    assert.equal(wrongOrigin.status, 403);

    const preview = await fetch(`${started.url}/api/work-items/${reference}/impact/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({ summary: 'Change the delegated customer access workflow and permission check.', targets: ['src/access-form.mjs'] })
    }).then((response) => response.json());
    assert.equal(preview.schema, 'ewai.impact-preview/v1');
    assert.equal(preview.reviewRoutes.find((route) => route.id === 'product-owner').recommendation, 'required');
    assert.equal(JSON.stringify(preview).includes(root), false);

    const decisions = Object.fromEntries(preview.reviewRoutes.map((route) => [route.id, route.recommendation]));
    const confirmed = await fetch(`${started.url}/api/work-items/${reference}/impact/confirm`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url },
      body: JSON.stringify({
        summary: preview.summary,
        targets: preview.targets,
        indexRunId: preview.index.runId,
        decisions,
        rationales: {},
        assessor: 'Product Owner',
        acknowledged: true
      })
    }).then((response) => response.json());
    assert.equal(confirmed.status, 'recorded');
    assert.equal(existsSync(resolve(root, confirmed.evidence.jsonPath)), true);

    const refreshRejected = await fetch(`${started.url}/api/work-items/${reference}/impact/refresh`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url }, body: JSON.stringify({ confirmed: false })
    });
    assert.equal(refreshRejected.status, 409);
    const refreshed = await fetch(`${started.url}/api/work-items/${reference}/impact/refresh`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: started.url }, body: JSON.stringify({ confirmed: true })
    }).then((response) => response.json());
    assert.equal(refreshed.index.status, 'completed');
    assert.equal(refreshed.view.impact.assessments.length, 1);
  } finally {
    await stopDashboard(root);
    rmSync(root, { recursive: true, force: true });
  }
});
