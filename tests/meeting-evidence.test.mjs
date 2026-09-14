import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { initProject } from '../src/project.mjs';
import {
  prepareMeetingExtraction,
  promoteMeetingEvidence,
  readMeetingEvidenceWorkspace,
  recordMeetingReview,
  registerMeetingSource
} from '../src/meeting-evidence.mjs';

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-meeting-project-'));
  initProject(root, { name: 'Meeting Evidence Test' });
  const inputs = resolve(root, 'meeting-inputs');
  mkdirSync(inputs, { recursive: true });
  const source = resolve(inputs, 'planning-session.vtt');
  writeFileSync(source, 'WEBVTT\n\n00:00.000 --> 00:02.000\nWe agreed to preserve provenance.\n\n00:02.000 --> 00:04.000\nAndre will review the evidence.\n');
  return { root, inputs, source };
}

const personas = [
  {
    id: 'project.product-owner',
    name: 'Product Owner',
    tier: 'project',
    category: 'product',
    description: 'Protects review outcomes and workflow clarity.',
    tags: ['review', 'workflow'],
    capabilities: ['product outcomes']
  },
  {
    id: 'ewai.core.specs-knowledge-curator',
    name: 'Knowledge Curator',
    tier: 'core',
    category: 'information-management',
    description: 'Protects provenance and canonical project evidence.',
    tags: ['provenance', 'evidence'],
    capabilities: ['knowledge curation']
  },
  {
    id: 'premium.privacy-reviewer',
    name: 'Privacy Reviewer',
    tier: 'premium',
    category: 'assurance',
    description: 'Challenges confidential source processing and data handling.',
    tags: ['privacy', 'confidential'],
    capabilities: ['privacy review']
  }
];

function reviewedFixture(options = {}) {
  const item = fixture();
  const registration = registerMeetingSource(item.root, item.source, {
    confirmed: true,
    label: 'Reviewed planning session',
    classification: 'confidential',
    cloudProcessing: 'allowed'
  });
  const sourceId = registration.source.sourceId;
  const bundle = {
    schema: 'ewai.meeting-candidate-bundle/v1',
    sourceId,
    sourceDigest: registration.source.digest,
    candidates: [
      {
        id: 'MEC-001',
        type: 'decision',
        observedStatement: 'The group agreed to preserve provenance.',
        interpretation: 'This is a candidate project decision requiring human review.',
        lineAnchors: [{ start: 4, end: 4 }],
        confidence: 'high'
      },
      {
        id: 'MEC-002',
        type: 'task',
        observedStatement: 'A review action was assigned.',
        interpretation: 'The owner and due date need human confirmation.',
        lineAnchors: [{ start: 7, end: 7 }],
        confidence: 'medium'
      },
      {
        id: 'MEC-003',
        type: 'assumption',
        observedStatement: 'The transcript may imply a release dependency.',
        interpretation: 'The source does not establish that dependency.',
        lineAnchors: [{ start: 3, end: 4 }],
        confidence: 'low'
      }
    ]
  };
  const review = recordMeetingReview(item.root, sourceId, {
    reviewedBy: options.reviewedBy ?? 'Andre Boyle',
    bundle,
    dispositions: [
      { candidateId: 'MEC-001', decision: 'accepted' },
      { candidateId: 'MEC-002', decision: 'amended', replacementText: 'Andre will review the evidence.', rationale: 'Preserve the named owner stated in the source.' },
      { candidateId: 'MEC-003', decision: 'deferred', rationale: 'The transcript does not establish the dependency.' }
    ],
    now: '2026-08-23T11:00:00.000Z'
  });
  return { ...item, registration, sourceId, bundle, review };
}

test('supported registration preserves source provenance without raw-content disclosure', () => {
  const { root, source } = fixture();
  try {
    const result = registerMeetingSource(root, source, {
      confirmed: true,
      label: 'Planning session',
      classification: 'confidential',
      cloudProcessing: 'allowed',
      now: '2026-08-23T10:00:00.000Z'
    });

    assert.equal(result.schema, 'ewai.meeting-source-registration/v1');
    assert.equal(result.source.label, 'Planning session');
    assert.equal(result.source.extension, '.vtt');
    assert.equal(result.source.lineCount, 7);
    assert.equal(result.source.cloudProcessing, 'allowed');
    assert.equal(result.source.freshness, 'current');
    assert.doesNotMatch(JSON.stringify(result), /planning-session\.vtt|We agreed|meeting-inputs/);

    const privateRecordPath = resolve(root, '.ewai-pipeline/meeting-evidence/sources', result.source.sourceId + '.json');
    const privateRecord = JSON.parse(readFileSync(privateRecordPath, 'utf8'));
    assert.equal(privateRecord.sourcePath, realpathSync(source));
    assert.equal(privateRecord.digest, result.source.digest);
    assert.doesNotMatch(readFileSync(resolve(root, 'SPECS/pipeline.yaml'), 'utf8'), /We agreed/);

    const workspace = readMeetingEvidenceWorkspace(root, { personaCatalogue: personas });
    assert.equal(workspace.sources.length, 1);
    assert.doesNotMatch(JSON.stringify(workspace), /planning-session\.vtt|We agreed|meeting-inputs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('registration rejects traversal symlinks directories unsafe types limits and conflicts', () => {
  const { root, inputs, source } = fixture();
  try {
    assert.throws(() => registerMeetingSource(root, source), /explicit user confirmation/);
    assert.throws(() => registerMeetingSource(root, '../outside.txt', { confirmed: true }), /traversal/);
    assert.throws(() => registerMeetingSource(root, inputs, { confirmed: true }), /regular file/);

    const unsafe = resolve(inputs, 'meeting.exe');
    writeFileSync(unsafe, 'not supported');
    assert.throws(() => registerMeetingSource(root, unsafe, { confirmed: true }), /Unsupported meeting source type/);

    const link = resolve(inputs, 'linked.txt');
    symlinkSync(source, link);
    assert.equal(lstatSync(link).isSymbolicLink(), true);
    assert.throws(() => registerMeetingSource(root, link, { confirmed: true }), /symbolic link/);

    const oversized = resolve(inputs, 'oversized.txt');
    writeFileSync(oversized, 'x'.repeat(2 * 1024 * 1024 + 1));
    assert.throws(() => registerMeetingSource(root, oversized, { confirmed: true }), /2 MiB/);

    const tooManyLines = resolve(inputs, 'too-many-lines.txt');
    writeFileSync(tooManyLines, 'line\n'.repeat(20_001));
    assert.throws(() => registerMeetingSource(root, tooManyLines, { confirmed: true }), /20,000 lines/);

    const first = registerMeetingSource(root, source, { confirmed: true, label: 'First' });
    assert.throws(
      () => registerMeetingSource(root, source, { confirmed: true, label: 'Conflicting label' }),
      new RegExp('already registered: ' + first.source.sourceId)
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('preparation denies model inspection unless processing is explicitly allowed', () => {
  const { root, source } = fixture();
  try {
    const denied = registerMeetingSource(root, source, {
      confirmed: true,
      classification: 'restricted',
      cloudProcessing: 'denied'
    });
    const contract = prepareMeetingExtraction(root, denied.source.sourceId, { personaCatalogue: personas });

    assert.equal(contract.processing.permitted, false);
    assert.equal(contract.processing.route, 'manual-local-handoff');
    assert.match(contract.processing.reason, /denied/);
    assert.equal(contract.activePersonas.length > 0, true);
    assert.doesNotMatch(JSON.stringify(contract), /planning-session\.vtt|We agreed|meeting-inputs/);

    const unknownSource = resolve(root, 'meeting-inputs/unknown.txt');
    writeFileSync(unknownSource, 'A bounded meeting note.');
    const unknown = registerMeetingSource(root, unknownSource, { confirmed: true });
    assert.equal(prepareMeetingExtraction(root, unknown.source.sourceId, { personaCatalogue: personas }).processing.permitted, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('contextual persona selection is visible replaceable and premium-independent', () => {
  const { root, source } = fixture();
  try {
    const registration = registerMeetingSource(root, source, {
      confirmed: true,
      classification: 'confidential',
      cloudProcessing: 'allowed'
    });

    const baseline = prepareMeetingExtraction(root, registration.source.sourceId, {
      focus: ['provenance', 'review'],
      personaCatalogue: personas.filter((persona) => persona.tier !== 'premium')
    });
    assert.equal(baseline.processing.permitted, true);
    assert.equal(baseline.activePersonas.some((persona) => persona.tier === 'project'), true);
    assert.equal(baseline.activePersonas.some((persona) => persona.tier === 'core'), true);
    assert.equal(baseline.activePersonas.some((persona) => persona.tier === 'premium'), false);

    const enriched = prepareMeetingExtraction(root, registration.source.sourceId, {
      focus: ['privacy', 'confidential'],
      personaCatalogue: personas
    });
    const premium = enriched.activePersonas.find((persona) => persona.tier === 'premium');
    assert.equal(premium.id, 'premium.privacy-reviewer');
    assert.deepEqual(premium.matchedSignals, ['privacy', 'confidential']);
    assert.match(premium.engagementReason, /privacy and confidential/);

    const changed = prepareMeetingExtraction(root, registration.source.sourceId, {
      focus: ['provenance'],
      personaCatalogue: personas
    });
    assert.equal(changed.activePersonas.some((persona) => persona.id === 'ewai.core.specs-knowledge-curator'), true);
    assert.equal(new Set(changed.activePersonas.map((persona) => persona.id)).size, changed.activePersonas.length);
    assert.deepEqual(changed.candidateContract.allowedTypes, [
      'task', 'decision', 'process', 'risk', 'system', 'policy', 'requirement', 'assumption', 'open-question'
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('candidate validation enforces types anchors interpretation boundaries and no raw model output', () => {
  const { root, source, sourceId, bundle } = reviewedFixture();
  try {
    const invalidCases = [
      { ...bundle, candidates: [{ ...bundle.candidates[0], type: 'meeting-truth' }] },
      { ...bundle, candidates: [{ ...bundle.candidates[0], lineAnchors: [{ start: 0, end: 1 }] }] },
      { ...bundle, candidates: [{ ...bundle.candidates[0], lineAnchors: [{ start: 4, end: 20 }] }] },
      { ...bundle, candidates: [{ ...bundle.candidates[0], interpretation: '' }] },
      { ...bundle, candidates: [{ ...bundle.candidates[0], excerpt: 'raw source text' }] },
      { ...bundle, candidates: [bundle.candidates[0], bundle.candidates[0]] }
    ];
    for (const invalid of invalidCases) {
      assert.throws(() => recordMeetingReview(root, sourceId, {
        reviewedBy: 'Reviewer',
        bundle: invalid,
        dispositions: [{ candidateId: 'MEC-001', decision: 'accepted' }]
      }), /candidate|anchor|interpretation|field|duplicate/i);
    }
    assert.doesNotMatch(readFileSync(resolve(root, '.ewai-pipeline/meeting-evidence/reviews', sourceId + '.json'), 'utf8'), /WEBVTT|raw source text/);
    assert.equal(readFileSync(source, 'utf8').includes('preserve provenance'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('review requires named complete dispositions and preserves amendment rationale', () => {
  const { root, source, registration, sourceId, bundle } = reviewedFixture();
  try {
    const other = resolve(root, 'meeting-inputs/review-validation.txt');
    writeFileSync(other, 'One decision.\nOne action.\n');
    const otherRegistration = registerMeetingSource(root, other, { confirmed: true, cloudProcessing: 'allowed' });
    const otherBundle = {
      ...bundle,
      sourceId: otherRegistration.source.sourceId,
      sourceDigest: otherRegistration.source.digest,
      candidates: [
        { ...bundle.candidates[0], lineAnchors: [{ start: 1, end: 1 }] },
        { ...bundle.candidates[1], lineAnchors: [{ start: 2, end: 2 }] }
      ]
    };
    assert.throws(() => recordMeetingReview(root, otherRegistration.source.sourceId, {
      bundle: otherBundle,
      dispositions: otherBundle.candidates.map(({ id }) => ({ candidateId: id, decision: 'accepted' }))
    }), /named reviewer/);
    assert.throws(() => recordMeetingReview(root, otherRegistration.source.sourceId, {
      reviewedBy: 'Reviewer', bundle: otherBundle,
      dispositions: [{ candidateId: 'MEC-001', decision: 'accepted' }]
    }), /every candidate/);
    assert.throws(() => recordMeetingReview(root, otherRegistration.source.sourceId, {
      reviewedBy: 'Reviewer', bundle: otherBundle,
      dispositions: [
        { candidateId: 'MEC-001', decision: 'accepted' },
        { candidateId: 'MEC-002', decision: 'amended' }
      ]
    }), /replacement text and rationale/);

    const stored = JSON.parse(readFileSync(resolve(root, '.ewai-pipeline/meeting-evidence/reviews', sourceId + '.json'), 'utf8'));
    assert.equal(stored.reviewedBy, 'Andre Boyle');
    assert.equal(stored.dispositions.length, 3);
    assert.equal(stored.dispositions.find(({ candidateId }) => candidateId === 'MEC-002').replacementText, 'Andre will review the evidence.');
    assert.equal(stored.dispositions.find(({ candidateId }) => candidateId === 'MEC-003').decision, 'deferred');
    assert.equal(registration.source.digest, stored.sourceDigest);
    assert.equal(readFileSync(source, 'utf8').includes('Andre will review'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('promotion is confirmed named digest-bound evidence-only and idempotent', () => {
  const { root, source, sourceId, review } = reviewedFixture();
  try {
    assert.throws(() => promoteMeetingEvidence(root, sourceId, { approvedBy: 'Andre Boyle' }), /exact confirmation/);
    assert.throws(() => promoteMeetingEvidence(root, sourceId, { confirmed: true }), /named approver/);

    const original = readFileSync(source, 'utf8');
    writeFileSync(source, original + 'Changed after review.\n');
    assert.throws(() => promoteMeetingEvidence(root, sourceId, { confirmed: true, approvedBy: 'Andre Boyle' }), /source is stale/);
    writeFileSync(source, original);

    const reviewPath = resolve(root, '.ewai-pipeline/meeting-evidence/reviews', sourceId + '.json');
    const storedReview = JSON.parse(readFileSync(reviewPath, 'utf8'));
    writeFileSync(reviewPath, JSON.stringify({ ...storedReview, reviewedBy: 'Changed reviewer' }, null, 2) + '\n');
    assert.throws(() => promoteMeetingEvidence(root, sourceId, { confirmed: true, approvedBy: 'Andre Boyle' }), /review digest/);
    writeFileSync(reviewPath, JSON.stringify(storedReview, null, 2) + '\n');

    const result = promoteMeetingEvidence(root, sourceId, {
      confirmed: true,
      approvedBy: 'Andre Boyle',
      now: '2026-08-23T12:00:00.000Z'
    });
    assert.equal(result.idempotent, false);
    assert.equal(result.counts.promoted, 2);
    assert.equal(result.counts.deferred, 1);
    assert.match(result.jsonPath, /^SPECS\/3\.Evidence\/meeting-evidence\//);
    const record = JSON.parse(readFileSync(resolve(root, result.jsonPath), 'utf8'));
    assert.equal(record.review.digest, review.reviewDigest);
    assert.deepEqual(record.evidence.map(({ statement }) => statement), [
      'The group agreed to preserve provenance.',
      'Andre will review the evidence.'
    ]);
    assert.equal(record.promotion.approvedBy, 'Andre Boyle');

    const repeated = promoteMeetingEvidence(root, sourceId, {
      confirmed: true,
      approvedBy: 'Andre Boyle'
    });
    assert.equal(repeated.idempotent, true);
    assert.equal(existsSync(resolve(root, 'SPECS/2.Purpose/intents/meeting-evidence.md')), false);
    assert.equal(existsSync(resolve(root, 'SPECS/6.Build/meeting-evidence')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('promotion transaction recovers without exposing mixed evidence', () => {
  const { root, sourceId } = reviewedFixture();
  try {
    assert.throws(() => promoteMeetingEvidence(root, sourceId, {
      confirmed: true,
      approvedBy: 'Andre Boyle',
      testHooks: { failAfterStage: 'json-committed' }
    }), /interrupted after JSON commit/);
    const evidenceRoot = resolve(root, 'SPECS/3.Evidence/meeting-evidence', sourceId);
    assert.equal(existsSync(resolve(evidenceRoot, 'evidence.json')), false);
    assert.equal(existsSync(resolve(evidenceRoot, 'evidence.md')), false);

    const recovered = promoteMeetingEvidence(root, sourceId, { confirmed: true, approvedBy: 'Andre Boyle' });
    assert.equal(existsSync(resolve(root, recovered.jsonPath)), true);
    assert.equal(existsSync(resolve(root, recovered.markdownPath)), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
