import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import YAML from 'yaml';
import {
  curateArchaeologyBundle,
  prepareArchaeologyPersonaGate,
  prepareArchaeologyReview,
  validateArchaeologyBundle,
  validateArchaeologyCompletion,
  validateArchaeologyPersonaGate
} from '../src/archaeology.mjs';
import { initProject } from '../src/project.mjs';

function writeYaml(path, value) {
  writeFileSync(path, YAML.stringify(value, { lineWidth: 0 }), 'utf8');
}

const personaPasses = [
  'purpose-and-actors',
  'user-processes',
  'domain-and-data',
  'architecture-and-integrations',
  'security-and-trust',
  'operations-and-assurance',
  'code-quality'
];

function writeValidPersonaRouting(bundle) {
  const inventory = [
    {
      id: 'ewai.core.archaeologist',
      name: 'EWAI Archaeologist',
      description: 'Reconstructs project knowledge from evidence.',
      tier: 'core',
      tags: ['archaeology'],
      capabilities: ['project-archaeology']
    },
    {
      id: 'ewai.core.specs-knowledge-curator',
      name: 'SPECS Knowledge Curator',
      description: 'Routes reviewed project knowledge into SPECS.',
      tier: 'core',
      tags: ['knowledge'],
      capabilities: ['specs-routing']
    },
    {
      id: 'project.alert-operator',
      name: 'Alert Operator',
      description: 'Represents the operational perspective for urgent alert delivery.',
      tier: 'project',
      tags: ['operations'],
      capabilities: ['alert-operations']
    }
  ];
  writeYaml(resolve(bundle, 'persona-routing.yaml'), {
    schema: 'ewai.archaeology-persona-routing/v1',
    status: 'confirmed',
    library_summary: { total: 3, by_tier: { core: 2, project: 1 } },
    baseline_personas: ['ewai.core.archaeologist', 'ewai.core.specs-knowledge-curator'],
    inventory,
    reconnaissance: {
      status: 'complete',
      summary: 'Initial reconnaissance found an alert-delivery capability requiring evidence reconstruction and knowledge curation.',
      evidence: ['COV-001']
    },
    assessments: personaPasses.map((pass) => ({
      pass,
      status: 'assessed',
      recommended_personas: ['ewai.core.archaeologist'],
      rationale: `The Archaeologist provides relevant evidence analysis for the ${pass} pass.`,
      expected_benefit: `Improves traceability and interpretation during the ${pass} investigation.`,
      perspective_gaps: []
    })),
    assignments: [{
      persona: 'project.alert-operator',
      pass: 'purpose-and-actors',
      role: 'consulted',
      contribution: 'Challenge inferred operational intent against the needs of people dispatching urgent alerts.'
    }],
    user_review: {
      presented_to_user: true,
      presented_summary: 'Use the EWAI Archaeologist to lead evidence reconstruction while the curator handles accepted knowledge.',
      status: 'confirmed',
      selected_personas: ['project.alert-operator'],
      decided_by: 'Project owner',
      decided_at: '2026-07-16T10:00:00.000Z',
      notes: ''
    }
  });
}

function createReviewableBundle(root) {
  const familiesPath = resolve(root, 'families.yaml');
  const bundle = resolve(root, 'SPECS/3.Evidence/archaeology/2026-07-16-baseline');
  const proposal = resolve(bundle, 'proposals/SPECS/2.Purpose/intents/alert-delivery.md');
  mkdirSync(resolve(bundle, 'proposals/SPECS/2.Purpose/intents'), { recursive: true });
  writeYaml(familiesPath, {
    depth: 'maximum-discoverable-detail',
    capability_families: ['purpose.intent'],
    project_families: ['evidence.risk-register']
  });
  writeYaml(resolve(bundle, 'capability-catalog.yaml'), {
    schema: 'ewai.archaeology-capability-catalog/v1',
    capabilities: [{ id: 'alert-delivery', description: 'Dispatches urgent alerts to selected recipients across configured delivery channels.', evidence: ['ARC-001'] }]
  });
  writeYaml(resolve(bundle, 'coverage-ledger.yaml'), {
    schema: 'ewai.archaeology-coverage-ledger/v1',
    surfaces: [{ id: 'COV-001', surface: 'Alert delivery', status: 'mapped' }]
  });
  writeYaml(resolve(bundle, 'specs-reconstruction-ledger.yaml'), {
    schema: 'ewai.specs-reconstruction-ledger/v1',
    records: [{ id: 'REC-001' }]
  });
  writeFileSync(
    proposal,
    '# Alert delivery\n\nThis reconstructed intent contains sufficiently detailed evidence, behavior, outcomes, constraints, acceptance criteria, dependencies, and unresolved questions for accountable review.\n\nEvidence: ARC-001\n',
    'utf8'
  );
  writeYaml(resolve(bundle, 'archaeology-artifact-manifest.yaml'), {
    schema: 'ewai.archaeology-artifact-manifest/v1',
    depth: 'maximum-discoverable-detail',
    records: [
      {
        id: 'ART-001',
        subject: 'alert-delivery',
        family: 'purpose.intent',
        record_type: 'intent',
        title: 'Alert delivery intent',
        status: 'created',
        proposed_path: 'proposals/SPECS/2.Purpose/intents/alert-delivery.md',
        evidence: ['ARC-001'],
        review_owner: 'Product owner'
      },
      {
        id: 'ART-002',
        subject: 'project',
        family: 'evidence.risk-register',
        status: 'not-applicable',
        rationale: 'The bounded test fixture contains no risk-bearing behavior beyond its single illustrative intent.',
        investigation_refs: ['COV-001']
      }
    ]
  });
  writeValidPersonaRouting(bundle);
  return { bundle, familiesPath, proposal };
}

test('rejects a lightweight archaeology bundle that substitutes summaries for detailed SPECS', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-archaeology-project-'));
  try {
    initProject(root, { name: 'Archaeology Project' });
    const bundle = resolve(root, 'SPECS/3.Evidence/archaeology/2026-07-16-baseline');
    mkdirSync(bundle, { recursive: true });
    writeYaml(resolve(bundle, 'capability-catalog.yaml'), {
      schema: 'ewai.archaeology-capability-catalog/v1',
      capabilities: [{ id: 'alert-delivery', description: 'Dispatches urgent alerts to selected recipients across configured delivery channels.', evidence: ['ARC-001'] }]
    });
    writeYaml(resolve(bundle, 'coverage-ledger.yaml'), { schema: 'ewai.archaeology-coverage-ledger/v1', surfaces: [] });
    writeYaml(resolve(bundle, 'specs-reconstruction-ledger.yaml'), { schema: 'ewai.specs-reconstruction-ledger/v1', records: [] });
    writeYaml(resolve(bundle, 'archaeology-artifact-manifest.yaml'), {
      schema: 'ewai.archaeology-artifact-manifest/v1',
      depth: 'maximum-discoverable-detail',
      records: []
    });
    writeValidPersonaRouting(bundle);

    const result = validateArchaeologyBundle(root, bundle);
    assert.equal(result.valid, false);
    assert.equal(result.errors.some((error) => /detailed record entries/.test(error)), true);
    assert.equal(result.errors.some((error) => /purpose\.intent/.test(error)), true);
    assert.equal(result.errors.some((error) => /risk-register/.test(error)), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('requires a user-reviewed persona-value assessment before deep archaeology', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-archaeology-personas-'));
  try {
    initProject(root, { name: 'Archaeology Persona Project' });
    const bundle = resolve(root, 'SPECS/3.Evidence/archaeology/2026-07-16-baseline');
    const personas = [
      {
        id: 'ewai.core.archaeologist',
        name: 'EWAI Archaeologist',
        description: 'Reconstructs project knowledge from evidence.',
        category: 'knowledge',
        tier: 'core',
        tags: ['archaeology'],
        capabilities: ['project-archaeology'],
        path: '/private/core/archaeologist.md'
      },
      {
        id: 'ewai.core.specs-knowledge-curator',
        name: 'SPECS Knowledge Curator',
        description: 'Routes accepted knowledge into SPECS.',
        category: 'knowledge',
        tier: 'core',
        tags: ['curation'],
        capabilities: ['specs-routing'],
        path: '/private/core/curator.md'
      },
      {
        id: 'premium.security-lead',
        name: 'Security Lead',
        description: 'Challenges authentication, authorization, trust boundaries, and assurance gaps.',
        category: 'security',
        tier: 'premium',
        tags: ['security'],
        capabilities: ['security-review'],
        path: '/private/premium/security-lead.md'
      }
    ];
    const prepared = prepareArchaeologyPersonaGate(root, bundle, personas);
    assert.equal(prepared.personaCount, 3);
    const initial = YAML.parse(readFileSync(prepared.routingPath, 'utf8'));
    assert.equal('path' in initial.inventory[0], false);
    assert.equal(validateArchaeologyPersonaGate(root, bundle).valid, false);

    initial.reconnaissance = {
      status: 'complete',
      summary: 'Initial reconnaissance identified security-sensitive alert delivery and administration workflows.',
      evidence: ['routes/web.php', 'app/Services/AlertDispatchService.php']
    };
    initial.assessments = personaPasses.map((pass) => ({
      pass,
      status: 'assessed',
      recommended_personas: pass === 'security-and-trust' ? ['premium.security-lead'] : ['ewai.core.archaeologist'],
      rationale: `Repository evidence shows that a specialist perspective would improve the ${pass} pass.`,
      expected_benefit: `The selected lens should identify deeper questions and improve evidence interpretation for ${pass}.`,
      perspective_gaps: []
    }));
    initial.assignments = [{
      persona: 'premium.security-lead',
      pass: 'security-and-trust',
      role: 'lead',
      contribution: 'Challenge the observed controls, assurance evidence, trust boundaries, and security risks.'
    }];
    initial.user_review = {
      presented_to_user: true,
      presented_summary: 'Use the premium Security Lead for the security pass; retain the core Archaeologist elsewhere.',
      status: 'confirmed',
      selected_personas: ['premium.security-lead'],
      decided_by: 'Project owner',
      decided_at: '2026-07-16T11:00:00.000Z',
      notes: ''
    };
    writeYaml(prepared.routingPath, initial);
    assert.equal(validateArchaeologyPersonaGate(root, bundle).valid, true);

    initial.assessments[0].recommended_personas = { invalid: true };
    writeYaml(prepared.routingPath, initial);
    const malformed = validateArchaeologyPersonaGate(root, bundle);
    assert.equal(malformed.valid, false);
    assert.equal(malformed.errors.some((error) => /requires a recommended-personas list/.test(error)), true);

    initial.assessments[0].recommended_personas = ['ewai.core.archaeologist'];
    initial.user_review.decided_at = 'abcdefghij';
    writeYaml(prepared.routingPath, initial);
    const badTimestamp = validateArchaeologyPersonaGate(root, bundle);
    assert.equal(badTimestamp.valid, false);
    assert.equal(badTimestamp.errors.some((error) => /must be ISO-8601/.test(error)), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('accepts only fully accounted maximum-detail reconstruction manifests', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-archaeology-project-'));
  try {
    initProject(root, { name: 'Archaeology Project' });
    const { bundle, familiesPath } = createReviewableBundle(root);

    const result = validateArchaeologyBundle(root, bundle, { familiesPath, minimumArtefactBytes: 100 });
    assert.equal(result.valid, true, result.errors.join('\n'));
    assert.deepEqual(result.counts, { capabilities: 1, records: 2, created: 1, notApplicable: 1, blocked: 0 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects unjustified incomplete coverage and symlinked proposal artefacts', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-archaeology-safety-'));
  try {
    initProject(root, { name: 'Archaeology Safety Project' });
    const { bundle, familiesPath, proposal } = createReviewableBundle(root);
    writeYaml(resolve(bundle, 'coverage-ledger.yaml'), {
      schema: 'ewai.archaeology-coverage-ledger/v1',
      surfaces: [{ id: 'COV-001', surface: 'Alert delivery', status: 'partial' }]
    });
    let result = validateArchaeologyBundle(root, bundle, { familiesPath, minimumArtefactBytes: 100 });
    assert.equal(result.valid, false);
    assert.equal(result.errors.some((error) => /requires an accepted limitation/.test(error)), true);

    writeYaml(resolve(bundle, 'coverage-ledger.yaml'), {
      schema: 'ewai.archaeology-coverage-ledger/v1',
      surfaces: [{ id: 'COV-001', surface: 'Alert delivery', status: 'mapped' }]
    });
    const external = resolve(root, 'external-proposal.md');
    writeFileSync(external, readFileSync(proposal, 'utf8'), 'utf8');
    rmSync(proposal);
    symlinkSync(external, proposal);
    result = validateArchaeologyBundle(root, bundle, { familiesPath, minimumArtefactBytes: 100 });
    assert.equal(result.valid, false);
    assert.equal(result.errors.some((error) => /missing proposed artefact/.test(error)), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepares a choice-based review and files only explicitly accepted records', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-archaeology-review-'));
  try {
    initProject(root, { name: 'Archaeology Review Project' });
    const { bundle, familiesPath, proposal } = createReviewableBundle(root);
    const prepared = prepareArchaeologyReview(root, bundle, { familiesPath, minimumArtefactBytes: 100 });
    assert.equal(existsSync(prepared.guidePath), true);
    assert.match(readFileSync(prepared.guidePath, 'utf8'), /self-review or an AI-guided walkthrough/);
    assert.match(readFileSync(prepared.guidePath, 'utf8'), /smallest useful set of cross-record questions/);
    assert.equal(existsSync(prepared.questionPlanPath), true);
    assert.match(readFileSync(prepared.questionPlanPath, 'utf8'), /ewai\.archaeology-review-question-plan\/v1/);

    const decisions = YAML.parse(readFileSync(prepared.decisionsPath, 'utf8'));
    decisions.mode = 'guided-walkthrough';
    decisions.records[0].decision = 'accepted';
    decisions.records[0].reviewed_by = 'Andre Boyle';
    decisions.records[0].reviewed_at = '2026-07-16T12:00:00.000Z';
    decisions.records[1].decision = 'deferred';
    decisions.records[1].notes = 'The project owner wants a specialist to confirm whether this exception is appropriate.';
    decisions.records[1].reviewed_by = 'Andre Boyle';
    decisions.records[1].reviewed_at = '2026-07-16T12:00:00.000Z';
    writeYaml(prepared.decisionsPath, decisions);

    const incomplete = validateArchaeologyCompletion(root, bundle, { familiesPath, minimumArtefactBytes: 100 });
    assert.equal(incomplete.valid, false);
    assert.equal(incomplete.errors.some((error) => /curation ledger/i.test(error)), true);

    assert.throws(
      () => curateArchaeologyBundle(root, bundle, { familiesPath, minimumArtefactBytes: 100 }),
      /explicit user confirmation/
    );
    const result = curateArchaeologyBundle(root, bundle, {
      confirmed: true,
      approvedBy: 'Andre Boyle',
      familiesPath,
      minimumArtefactBytes: 100,
      now: '2026-07-16T12:30:00.000Z'
    });
    const canonical = resolve(root, 'SPECS/2.Purpose/intents/alert-delivery.md');
    assert.equal(result.filed, 1);
    assert.equal(readFileSync(canonical, 'utf8'), readFileSync(proposal, 'utf8'));
    assert.equal(existsSync(result.ledgerPath), true);
    assert.match(readFileSync(result.ledgerPath, 'utf8'), /approved_by: Andre Boyle/);

    let completion = validateArchaeologyCompletion(root, bundle, { familiesPath, minimumArtefactBytes: 100 });
    assert.equal(completion.valid, false);
    assert.equal(completion.errors.some((error) => /future-work transition/i.test(error)), true);
    writeYaml(resolve(bundle, 'future-work-transition.yaml'), {
      schema: 'ewai.archaeology-future-work-transition/v1',
      offered_to_user: true,
      offer_summary: 'Choose an interview about future work, import a roadmap or discovery folder, or ask EWAI for evidence-based recommendations.',
      routes_offered: ['interview', 'import', 'recommendations'],
      offered_at: '2026-07-16T12:35:00.000Z',
      decision: 'recommendations',
      decided_by: 'Andre Boyle',
      decided_at: '2026-07-16T12:36:00.000Z',
      source_references: [],
      recommendation_sets: [],
      accepted_candidate_ids: [],
      approved_intent_ids: []
    });
    completion = validateArchaeologyCompletion(root, bundle, { familiesPath, minimumArtefactBytes: 100 });
    assert.equal(completion.valid, true, completion.errors.join('\n'));
    assert.equal(completion.counts.canonicalRecords, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses automatic filing when review accountability or canonical reconciliation is missing', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-archaeology-review-'));
  try {
    initProject(root, { name: 'Archaeology Review Project' });
    const { bundle, familiesPath } = createReviewableBundle(root);
    const prepared = prepareArchaeologyReview(root, bundle, { familiesPath, minimumArtefactBytes: 100 });
    const decisions = YAML.parse(readFileSync(prepared.decisionsPath, 'utf8'));
    decisions.records[0].decision = 'accepted-with-corrections';
    decisions.records[0].reviewed_by = 'Andre Boyle';
    decisions.records[0].notes = 'Clarify the acceptance evidence before this proposal can become canonical.';
    decisions.records[1].decision = 'rejected';
    decisions.records[1].reviewed_by = 'Andre Boyle';
    writeYaml(prepared.decisionsPath, decisions);
    assert.throws(
      () => curateArchaeologyBundle(root, bundle, { confirmed: true, familiesPath, minimumArtefactBytes: 100 }),
      /require explanatory notes/
    );

    decisions.records[1].decision = 'deferred';
    decisions.records[1].notes = 'This project-wide exception needs review by the accountable operational owner.';
    writeYaml(prepared.decisionsPath, decisions);
    assert.throws(
      () => curateArchaeologyBundle(root, bundle, { confirmed: true, familiesPath, minimumArtefactBytes: 100 }),
      /corrections must be applied/
    );

    decisions.records[0].decision = 'accepted';
    writeYaml(prepared.decisionsPath, decisions);
    const canonical = resolve(root, 'SPECS/2.Purpose/intents/alert-delivery.md');
    mkdirSync(resolve(root, 'SPECS/2.Purpose/intents'), { recursive: true });
    writeFileSync(canonical, '# Existing canonical knowledge\n', 'utf8');
    assert.throws(
      () => curateArchaeologyBundle(root, bundle, { confirmed: true, familiesPath, minimumArtefactBytes: 100 }),
      /conflicts require reconciliation/
    );
    assert.equal(readFileSync(canonical, 'utf8'), '# Existing canonical knowledge\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
