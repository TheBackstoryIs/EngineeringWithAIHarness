import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { initProject } from '../src/project.mjs';
import { projectPaths } from '../src/paths.mjs';
import {
  listKnowledgeSources,
  materialiseKnowledgeProposals,
  prepareKnowledgeProposals,
  readKnowledgeProposalWorkspace,
  recordKnowledgeProposalBundle,
  recordKnowledgeProposalReview,
  recoverKnowledgeMaterialisation
} from '../src/knowledge-proposals.mjs';

const personas = [
  { id: 'project.product-owner', name: 'Product Owner', tier: 'project', category: 'product', description: 'Protects review outcomes and useful project change.', tags: ['review', 'outcome'], capabilities: ['product outcomes'] },
  { id: 'ewai.core.specs-knowledge-curator', name: 'Knowledge Curator', tier: 'core', category: 'information-management', description: 'Protects provenance and canonical SPECS destinations.', tags: ['provenance', 'knowledge'], capabilities: ['knowledge curation'] },
  { id: 'premium.delivery-historian', name: 'Delivery Historian', tier: 'premium', category: 'delivery', description: 'Challenges retrospective learning and repeated delivery patterns.', tags: ['retrospective', 'pattern'], capabilities: ['delivery history'] },
  { id: 'personal.security-reviewer', name: 'Security Reviewer', tier: 'personal', category: 'assurance', description: 'Challenges risks and unsafe content.', tags: ['security', 'risk'], capabilities: ['security review'] }
];

function fixture(specs = 'SPECS') {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-knowledge-proposals-'));
  initProject(root, { name: 'Knowledge Proposals Test', specsRoot: specs });
  const retroRoot = resolve(root, specs, '3.Evidence/retros');
  mkdirSync(retroRoot, { recursive: true });
  writeFileSync(resolve(retroRoot, 'sprint-24.md'), '# Retrospective: Sprint 24\n\n## What we learned\n\nReconfirm digests before consequential writes.\n\n## Owned actions\n\nDocument recovery before release.\n');
  const meetingRoot = resolve(root, specs, '3.Evidence/meeting-evidence/meeting.product-sync.abc123def456');
  mkdirSync(meetingRoot, { recursive: true });
  const evidence = {
    schema: 'ewai.meeting-evidence/v1',
    source: { sourceId: 'meeting.product-sync.abc123def456', label: 'Product sync', classification: 'internal', digest: 'a'.repeat(64), lineCount: 20 },
    review: { digest: 'b'.repeat(64), reviewedBy: 'Andre Boyle', reviewedAt: '2026-08-23T10:00:00.000Z' },
    promotion: { approvedBy: 'Andre Boyle', approvedAt: '2026-08-23T10:10:00.000Z' },
    evidence: [{ id: 'MEC-001', type: 'decision', statement: 'Use additive-only writes.', interpretation: 'A project decision may be warranted.', lineAnchors: [{ start: 4, end: 4 }], confidence: 'high', reviewDecision: 'accepted' }],
    evidenceDigest: 'c'.repeat(64),
    markdownDigest: 'd'.repeat(64)
  };
  writeFileSync(resolve(meetingRoot, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  writeFileSync(resolve(meetingRoot, 'evidence.md'), '# Meeting Evidence — Product sync\n');
  return { root, retroRoot, meetingRoot };
}

function proposalBundle(preparation, overrides = {}) {
  const sourceRef = preparation.source.ref;
  return {
    schema: 'ewai.knowledge-proposal-bundle/v1',
    sourceRef,
    sourceDigest: preparation.source.digest,
    proposals: [
      {
        id: 'KNP-001',
        kind: 'pattern',
        title: 'Reconfirm source digests',
        destination: 'SPECS/5.Strategy/patterns/reconfirm-source-digests.md',
        evidenceAnchors: [preparation.source.anchors[0].id],
        rationale: 'The reviewed source identifies a repeatable safe-delivery practice.',
        uncertainty: 'Confirm it applies beyond this delivery before broader adoption.',
        relationships: [],
        proposedMarkdown: `# Reconfirm source digests\n\nRevalidate current evidence before consequential writes.\n\n## Provenance\n\n- Source: \`${sourceRef}\`\n- Anchor: \`${preparation.source.anchors[0].id}\`\n`
      }
    ],
    ...overrides
  };
}

function recordedFixture() {
  const item = fixture();
  const preparation = prepareKnowledgeProposals(item.root, 'retrospective:sprint-24', { personaCatalogue: personas, focus: ['retrospective', 'pattern', 'review'] });
  const recording = recordKnowledgeProposalBundle(item.root, 'retrospective:sprint-24', { bundle: proposalBundle(preparation), activePersonas: preparation.activePersonas, now: '2026-08-23T11:00:00.000Z' });
  return { ...item, preparation, recording };
}

function interruptedFixture(t, specs = 'SPECS') {
  const { root } = fixture(specs);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const preparation = prepareKnowledgeProposals(root, 'retrospective:sprint-24', { personaCatalogue: personas });
  const bundle = proposalBundle(preparation);
  bundle.proposals.push({ ...bundle.proposals[0], id: 'KNP-002', destination: 'SPECS/5.Strategy/patterns/second-pattern.md' });
  for (const proposal of bundle.proposals) proposal.destination = proposal.destination.replace(/^SPECS\//, `${specs}/`);
  const recording = recordKnowledgeProposalBundle(root, preparation.source.ref, { bundle, activePersonas: preparation.activePersonas });
  recordKnowledgeProposalReview(root, recording.bundleId, { reviewedBy: 'Test reviewer', dispositions: bundle.proposals.map(({ id }) => ({ proposalId: id, decision: 'accepted' })) });
  assert.throws(() => materialiseKnowledgeProposals(root, recording.bundleId, { confirmed: true, approvedBy: 'Test owner', testHooks: { failAfterWrites: 2 } }), /interrupted/);
  const journalPath = resolve(projectPaths(root).runtimeRoot, 'knowledge-proposals/transactions', `${recording.bundleId}.json`);
  return { root, bundleId: recording.bundleId, journalPath, destinations: bundle.proposals.map(({ destination }) => resolve(root, destination)) };
}

test('recovery preserves edited writes and retains the journal until human recovery', t => {
  const f = interruptedFixture(t);
  writeFileSync(f.destinations[0], '# Human changes that must survive\n');
  assert.throws(() => recoverKnowledgeMaterialisation(f.root, f.bundleId, { confirmed: true }), /Recovery paused.*preserved/i);
  assert.equal(readFileSync(f.destinations[0], 'utf8'), '# Human changes that must survive\n');
  assert.equal(existsSync(f.destinations[1]), false, 'unchanged generated write is removed');
  assert.equal(existsSync(f.journalPath), true);
  assert.throws(() => recoverKnowledgeMaterialisation(f.root, f.bundleId, { confirmed: true }), /Recovery paused/);
  assert.throws(() => materialiseKnowledgeProposals(f.root, f.bundleId, { confirmed: true, approvedBy: 'Test owner' }), /interrupted transaction/);
  renameSync(f.destinations[0], resolve(f.root, 'preserved-human-changes.md'));
  assert.equal(recoverKnowledgeMaterialisation(f.root, f.bundleId, { confirmed: true }).status, 'recovered');
  assert.equal(recoverKnowledgeMaterialisation(f.root, f.bundleId, { confirmed: true }).status, 'not-required');
  assert.equal(readFileSync(resolve(f.root, 'preserved-human-changes.md'), 'utf8'), '# Human changes that must survive\n');
});

test('recovery never guesses original content for an older journal without digests', t => {
  const f = interruptedFixture(t);
  const before = f.destinations.map(path => readFileSync(path, 'utf8'));
  const journal = JSON.parse(readFileSync(f.journalPath, 'utf8'));
  delete journal.createdDigests;
  writeFileSync(f.journalPath, JSON.stringify(journal));
  assert.throws(() => recoverKnowledgeMaterialisation(f.root, f.bundleId, { confirmed: true }), /Recovery paused.*preserved/i);
  assert.deepEqual(f.destinations.map(path => readFileSync(path, 'utf8')), before);
  assert.equal(existsSync(f.journalPath), true);
});

for (const replacement of ['symlink', 'dangling-symlink', 'hardlink', 'directory', 'ancestor-symlink']) {
  test(`recovery preserves unsafe ${replacement} replacements`, t => {
    const f = interruptedFixture(t);
    const bytes = readFileSync(f.destinations[0]);
    const outside = resolve(f.root, 'unrelated.md');
    writeFileSync(outside, bytes);
    if (replacement === 'ancestor-symlink') {
      const parent = resolve(f.destinations[0], '..');
      renameSync(parent, resolve(f.root, 'retained-patterns'));
      symlinkSync(resolve(f.root, 'retained-patterns'), parent);
    } else {
      rmSync(f.destinations[0]);
      if (replacement === 'directory') mkdirSync(f.destinations[0]);
      else if (replacement === 'hardlink') linkSync(outside, f.destinations[0]);
      else symlinkSync(replacement === 'dangling-symlink' ? `${outside}.missing` : outside, f.destinations[0]);
    }
    assert.throws(() => recoverKnowledgeMaterialisation(f.root, f.bundleId, { confirmed: true }), /Recovery paused.*preserved/i);
    assert.ok(lstatSync(f.destinations[0]));
    assert.deepEqual(readFileSync(outside), bytes);
    assert.equal(existsSync(f.journalPath), true);
    if (replacement === 'ancestor-symlink') assert.deepEqual(readFileSync(f.destinations[1]), bytes);
  });
}

test('recovery validates the whole journal before deleting any file', t => {
  const f = interruptedFixture(t);
  const journal = JSON.parse(readFileSync(f.journalPath, 'utf8'));
  journal.created.push('../not-owned.md');
  journal.destinations.push('../not-owned.md');
  writeFileSync(f.journalPath, JSON.stringify(journal));
  assert.throws(() => recoverKnowledgeMaterialisation(f.root, f.bundleId, { confirmed: true }), /unsafe destination/);
  assert.equal(f.destinations.every(path => existsSync(path)), true);
  assert.equal(existsSync(f.journalPath), true);
});

test('recovery checks symlink ancestors above a nested SPECS root', t => {
  const f = interruptedFixture(t, 'governance/SPECS');
  const bytes = f.destinations.map(path => readFileSync(path));
  const originalParent = resolve(f.root, 'governance');
  const unrelatedParent = resolve(f.root, 'unrelated-governance');
  const unrelatedFiles = f.destinations.map(path => path.replace(originalParent, unrelatedParent));
  for (const [index, path] of unrelatedFiles.entries()) {
    mkdirSync(resolve(path, '..'), { recursive: true });
    writeFileSync(path, bytes[index]);
  }
  writeFileSync(resolve(unrelatedParent, 'SPECS/pipeline.yaml'), readFileSync(projectPaths(f.root).configPath));
  renameSync(originalParent, resolve(f.root, 'retained-governance'));
  symlinkSync(unrelatedParent, originalParent);
  assert.throws(() => recoverKnowledgeMaterialisation(f.root, f.bundleId, { confirmed: true }), /Recovery paused.*preserved/i);
  assert.deepEqual(unrelatedFiles.map(path => readFileSync(path)), bytes);
  assert.equal(existsSync(f.journalPath), true);
});

test('source adapters allowlist canonical evidence and reject hostile references', () => {
  const { root, retroRoot } = fixture();
  try {
    const sources = listKnowledgeSources(root);
    assert.deepEqual(sources.map(({ ref }) => ref), ['meeting-evidence:meeting.product-sync.abc123def456', 'retrospective:sprint-24']);
    assert.doesNotMatch(JSON.stringify(sources), /Reconfirm digests before|Use additive-only writes|\/private\//);

    const outside = resolve(root, 'outside.md');
    writeFileSync(outside, '# Outside');
    symlinkSync(outside, resolve(retroRoot, 'linked.md'));
    assert.equal(listKnowledgeSources(root).some(({ ref }) => ref === 'retrospective:linked'), false);
    assert.throws(() => prepareKnowledgeProposals(root, '../outside.md'), /source reference/);
    assert.throws(() => prepareKnowledgeProposals(root, 'retrospective:../outside'), /source reference/);
    assert.throws(() => prepareKnowledgeProposals(root, 'meeting-evidence:missing'), /Unknown knowledge source/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('preparation preserves meeting and retrospective provenance with visible contextual personas', () => {
  const { root } = fixture();
  try {
    const retro = prepareKnowledgeProposals(root, 'retrospective:sprint-24', { personaCatalogue: personas, focus: ['retrospective', 'pattern', 'review'] });
    assert.equal(retro.schema, 'ewai.knowledge-proposal-preparation/v1');
    assert.equal(retro.source.family, 'retrospective');
    assert.match(retro.source.digest, /^[a-f0-9]{64}$/);
    assert.equal(retro.source.anchors.some(({ id }) => id === 'heading:what-we-learned'), true);
    assert.match(retro.modelContext, /Reconfirm digests/);
    assert.equal(retro.activePersonas.some(({ tier }) => tier === 'project'), true);
    assert.equal(retro.activePersonas.some(({ tier }) => tier === 'premium'), true);
    assert.equal(retro.activePersonas.every(({ name, tier, matchedSignals, engagementReason }) => name && tier && Array.isArray(matchedSignals) && engagementReason), true);
    assert.equal(retro.authority.personasAreAdvisory, true);
    assert.equal(retro.authority.namedReviewRequired, true);

    const meeting = prepareKnowledgeProposals(root, 'meeting-evidence:meeting.product-sync.abc123def456', { personaCatalogue: personas, focus: ['decision', 'provenance'] });
    assert.equal(meeting.source.family, 'meeting-evidence');
    assert.deepEqual(meeting.source.anchors.map(({ id }) => id), ['candidate:MEC-001']);
    assert.match(meeting.modelContext, /Use additive-only writes/);
    assert.doesNotMatch(JSON.stringify({ ...meeting, modelContext: undefined }), /meetingRoot|evidence\.json/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('proposal validation enforces taxonomy destinations and provenance then records evidence only', () => {
  const { root } = fixture();
  try {
    const preparation = prepareKnowledgeProposals(root, 'retrospective:sprint-24', { personaCatalogue: personas });
    const bundle = proposalBundle(preparation);
    const result = recordKnowledgeProposalBundle(root, preparation.source.ref, { bundle, activePersonas: preparation.activePersonas, now: '2026-08-23T11:00:00.000Z' });
    assert.equal(result.schema, 'ewai.knowledge-proposal-recording/v1');
    assert.equal(result.counts.additive, 1);
    assert.equal(existsSync(resolve(root, result.bundlePath)), true);
    assert.equal(existsSync(resolve(root, 'SPECS/5.Strategy/patterns/reconfirm-source-digests.md')), false);
    const workspace = readKnowledgeProposalWorkspace(root, { bundleId: result.bundleId, personaCatalogue: personas });
    assert.equal(workspace.bundle.proposals[0].state, 'additive');
    assert.equal(workspace.activePersonas.length > 0, true);
    assert.equal('modelContext' in workspace, false);

    assert.throws(() => recordKnowledgeProposalBundle(root, preparation.source.ref, { bundle: proposalBundle(preparation, { proposals: [{ ...bundle.proposals[0], destination: 'SPECS/6.Build/escape.md' }] }) }), /destination/);
    assert.throws(() => recordKnowledgeProposalBundle(root, preparation.source.ref, { bundle: proposalBundle(preparation, { proposals: [{ ...bundle.proposals[0], kind: 'decision' }] }) }), /destination/);
    assert.throws(() => recordKnowledgeProposalBundle(root, preparation.source.ref, { bundle: proposalBundle(preparation, { proposals: [{ ...bundle.proposals[0], proposedMarkdown: '# Missing provenance' }] }) }), /provenance/);
    assert.throws(() => recordKnowledgeProposalBundle(root, preparation.source.ref, { bundle: proposalBundle(preparation, { proposals: [bundle.proposals[0], { ...bundle.proposals[0] }] }) }), /duplicate proposal ID/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('review and materialisation are named complete additive-only and recoverable', () => {
  const { root, recording } = recordedFixture();
  try {
    assert.throws(() => recordKnowledgeProposalReview(root, recording.bundleId, { reviewedBy: '', dispositions: [] }), /named reviewer/);
    assert.throws(() => recordKnowledgeProposalReview(root, recording.bundleId, { reviewedBy: 'Andre Boyle', dispositions: [] }), /every proposal/);
    const review = recordKnowledgeProposalReview(root, recording.bundleId, { reviewedBy: 'Andre Boyle', dispositions: [{ proposalId: 'KNP-001', decision: 'accepted' }], now: '2026-08-23T11:10:00.000Z' });
    assert.equal(review.counts.accepted, 1);
    assert.throws(() => materialiseKnowledgeProposals(root, recording.bundleId, { approvedBy: 'Andre Boyle' }), /exact confirmation/);
    const result = materialiseKnowledgeProposals(root, recording.bundleId, { confirmed: true, approvedBy: 'Andre Boyle', now: '2026-08-23T11:20:00.000Z' });
    assert.equal(result.counts.added, 1);
    assert.equal(readFileSync(resolve(root, 'SPECS/5.Strategy/patterns/reconfirm-source-digests.md'), 'utf8').includes('## Provenance'), true);
    const again = materialiseKnowledgeProposals(root, recording.bundleId, { confirmed: true, approvedBy: 'Andre Boyle', now: '2026-08-23T11:20:00.000Z' });
    assert.equal(again.idempotent, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('amendments require rationale and materialisation revalidates source and review digests', () => {
  const amended = recordedFixture();
  try {
    assert.throws(() => recordKnowledgeProposalReview(amended.root, amended.recording.bundleId, {
      reviewedBy: 'Andre Boyle',
      dispositions: [{ proposalId: 'KNP-001', decision: 'amended', replacementTitle: 'Safer title', replacementMarkdown: '# Safer title' }],
    }), /requires replacement title, Markdown and rationale/);
    recordKnowledgeProposalReview(amended.root, amended.recording.bundleId, {
      reviewedBy: 'Andre Boyle',
      dispositions: [{
        proposalId: 'KNP-001',
        decision: 'amended',
        rationale: 'Clarify the local review obligation.',
        replacementTitle: 'Reconfirm source evidence',
        replacementMarkdown: '# Reconfirm source evidence\n\nRevalidate the current source evidence before a consequential write.\n\n## Provenance\n\n- Source: `retrospective:sprint-24`\n- Anchor: `heading:what-we-learned`\n',
      }],
    });
    const result = materialiseKnowledgeProposals(amended.root, amended.recording.bundleId, { confirmed: true, approvedBy: 'Andre Boyle' });
    assert.match(readFileSync(resolve(amended.root, result.outcomes[0].destination), 'utf8'), /Reconfirm source evidence/);
  } finally { rmSync(amended.root, { recursive: true, force: true }); }

  const stale = recordedFixture();
  try {
    recordKnowledgeProposalReview(stale.root, stale.recording.bundleId, { reviewedBy: 'Andre Boyle', dispositions: [{ proposalId: 'KNP-001', decision: 'accepted' }] });
    writeFileSync(resolve(stale.retroRoot, 'sprint-24.md'), '# Retrospective changed after review\n');
    assert.throws(() => materialiseKnowledgeProposals(stale.root, stale.recording.bundleId, { confirmed: true, approvedBy: 'Andre Boyle' }), /source is stale/);
  } finally { rmSync(stale.root, { recursive: true, force: true }); }
});

test('materialisation leaves differing destinations as conflicts and survives interruption recovery', () => {
  const first = recordedFixture();
  try {
    recordKnowledgeProposalReview(first.root, first.recording.bundleId, { reviewedBy: 'Andre Boyle', dispositions: [{ proposalId: 'KNP-001', decision: 'accepted' }] });
    const destination = resolve(first.root, 'SPECS/5.Strategy/patterns/reconfirm-source-digests.md');
    mkdirSync(resolve(destination, '..'), { recursive: true });
    writeFileSync(destination, '# Existing different truth\n');
    const conflict = materialiseKnowledgeProposals(first.root, first.recording.bundleId, { confirmed: true, approvedBy: 'Andre Boyle' });
    assert.equal(conflict.counts.conflicts, 1);
    assert.equal(readFileSync(destination, 'utf8'), '# Existing different truth\n');
  } finally { rmSync(first.root, { recursive: true, force: true }); }

  const second = recordedFixture();
  try {
    recordKnowledgeProposalReview(second.root, second.recording.bundleId, { reviewedBy: 'Andre Boyle', dispositions: [{ proposalId: 'KNP-001', decision: 'accepted' }] });
    assert.throws(() => materialiseKnowledgeProposals(second.root, second.recording.bundleId, { confirmed: true, approvedBy: 'Andre Boyle', testHooks: { failAfterWrites: 1 } }), /interrupted/);
    const recovery = recoverKnowledgeMaterialisation(second.root, second.recording.bundleId, { confirmed: true });
    assert.equal(recovery.status, 'recovered');
    assert.equal(existsSync(resolve(second.root, 'SPECS/5.Strategy/patterns/reconfirm-source-digests.md')), false);
  } finally { rmSync(second.root, { recursive: true, force: true }); }

  const third = recordedFixture();
  try {
    recordKnowledgeProposalReview(third.root, third.recording.bundleId, { reviewedBy: 'Andre Boyle', dispositions: [{ proposalId: 'KNP-001', decision: 'accepted' }] });
    assert.throws(() => materialiseKnowledgeProposals(third.root, third.recording.bundleId, {
      confirmed: true,
      approvedBy: 'Andre Boyle',
      testHooks: { failAfterLedger: true },
    }), /interrupted after the immutable ledger/);
    const retry = materialiseKnowledgeProposals(third.root, third.recording.bundleId, { confirmed: true, approvedBy: 'Andre Boyle' });
    assert.equal(retry.idempotent, true);
    assert.equal(existsSync(resolve(third.root, retry.outcomes[0].destination)), true);
    assert.equal(readKnowledgeProposalWorkspace(third.root, { bundleId: third.recording.bundleId }).permittedActions.recover, false);
  } finally { rmSync(third.root, { recursive: true, force: true }); }
});
