import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { initProject } from '../src/project.mjs';
import { createIntent, updateIntentDeliveryState } from '../src/intents.mjs';
import {
  preparePersonaTestScenarioBrief,
  readPersonaTestScenarioWorkspace,
  recordPersonaTestScenarios
} from '../src/test-scenarios.mjs';

const bin = resolve(import.meta.dirname, '../bin/ewai');

function personas() {
  return [
    { id: 'project.product-owner', name: 'Product Owner', tier: 'project', category: 'product', description: 'Protects user journeys, outcomes, and acceptance evidence.', tags: ['journey', 'acceptance', 'outcome'], capabilities: ['product review'], path: '/private/project.md', body: 'hidden' },
    { id: 'premium.identity-reviewer', name: 'Identity Reviewer', tier: 'premium', category: 'security', description: 'Challenges permissions, privacy, and identity boundaries.', tags: ['permission', 'privacy', 'identity'], capabilities: ['security review'], path: '/private/premium.md', body: 'hidden' },
    { id: 'personal.accessibility-reviewer', name: 'Accessibility Reviewer', tier: 'personal', category: 'accessibility', description: 'Challenges keyboard and assistive technology barriers.', tags: ['accessibility', 'keyboard'], capabilities: ['accessibility review'] },
    { id: 'ewai.core.operator', name: 'Service Operator', tier: 'core', category: 'operations', description: 'Challenges failure, recovery, and observability.', tags: ['recovery', 'operations'], capabilities: ['operational review'] },
    { id: 'ewai.core.maintainer', name: 'Software Maintainer', tier: 'core', category: 'engineering', description: 'Challenges maintainability and regression coverage.', tags: ['testing', 'regression'], capabilities: ['test review'] }
  ];
}

function createProject() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-test-scenarios-'));
  initProject(root, { name: 'Persona Test Scenarios' });
  createIntent(root, {
    slug: 'customer-access',
    domain: 'quality',
    title: 'Customer access',
    personas: ['project.product-owner:decision-maker:5'],
    details: {
      problem: 'Delegates cannot reliably request access.',
      desiredOutcome: 'Delegates can request access safely and recover from errors.',
      journeys: '1. [J-001] A delegate submits an access request and receives a clear outcome.\n2. [J-002] A delegate recovers after an expired session.',
      acceptanceCriteria: '1. [AC-001] Only an authorised delegate can submit the request.\n2. [AC-002] The request result is announced without exposing private data.',
      constraints: 'Authentication and accessibility standards remain mandatory.'
    }
  });
  const build = resolve(root, 'SPECS/6.Build/customer-access');
  mkdirSync(resolve(build, 'gates/plan'), { recursive: true });
  writeFileSync(resolve(build, 'gates/plan/plan-contract.json'), `${JSON.stringify({
    schema_version: 1,
    slug: 'customer-access',
    test_obligations: [
      { id: 'ACCESS-TEST001', slice: 'ACCESS-S001', type: 'node-test', file: 'tests/access.test.mjs', obligation: 'Prove authorised access and rejected unauthorised access.' }
    ]
  }, null, 2)}\n`);
  writeFileSync(resolve(build, 'gates/plan/claim-ledger.json'), `${JSON.stringify({
    schema_version: 1,
    slug: 'customer-access',
    implementation_claims: [
      { id: 'ACCESS-CL001', statement: 'Enforce the delegate permission boundary.', tests_required: ['permission denial', 'accepted delegate'] }
    ]
  }, null, 2)}\n`);
  writeFileSync(resolve(build, 'test-plan.md'), '# Test Plan\n\nUse observable outcomes and preserve the permission boundary.\n');
  return root;
}

function acceptedCandidate(brief) {
  const product = brief.activePersonas.find((persona) => persona.id === 'project.product-owner') ?? brief.activePersonas[0];
  return {
    schema: 'ewai.persona-test-scenarios/v1',
    slug: 'customer-access',
    focus: brief.focus,
    preparedSourceDigest: brief.sourceDigest,
    scenarios: [{
      id: 'PTS-001',
      title: 'Authorised delegate completes the request',
      type: 'happy-path',
      sourceRefs: ['intent:journey:J-001', 'intent:acceptance:AC-001'],
      personaContributions: [{ personaId: product.id, concern: 'Prove the intended user outcome and permission boundary.' }],
      preconditions: ['An authenticated delegate has permission to request access.'],
      actions: ['Submit a valid access request.'],
      expectedResults: ['The request is accepted and a clear success outcome is displayed.'],
      evidenceRoute: 'automated',
      automation: 'automated',
      plannedTest: { file: 'tests/access.test.mjs', name: 'authorised delegate completes access request' },
      owner: 'Delivery team',
      status: 'accepted'
    }],
    gaps: []
  };
}

test('prepares bounded authoritative sources and a safe tier-aware active ensemble without writing', () => {
  const root = createProject();
  try {
    const output = resolve(root, 'SPECS/6.Build/customer-access/test-scenarios.json');
    const brief = preparePersonaTestScenarioBrief(root, 'customer-access', {
      focus: 'permission privacy journey recovery accessibility',
      personas: personas()
    });

    assert.equal(brief.schema, 'ewai.persona-test-brief/v1');
    assert.equal(brief.authoritativeSources.some((source) => source.id === 'intent:journey:J-001'), true);
    assert.equal(brief.authoritativeSources.some((source) => source.id === 'intent:acceptance:AC-001'), true);
    assert.equal(brief.authoritativeSources.some((source) => source.id === 'plan:test:ACCESS-TEST001'), true);
    assert.equal(brief.activePersonas.length <= 4, true);
    assert.equal(brief.activePersonas.some((persona) => persona.tier === 'project'), true);
    assert.equal(brief.activePersonas.some((persona) => persona.tier === 'premium'), true);
    assert.equal(JSON.stringify(brief).includes('/private/'), false);
    assert.equal(JSON.stringify(brief).includes('hidden'), false);
    assert.equal(brief.availability.premium.installed, true);
    assert.equal(brief.guidance.personaOutputIsAuthority, false);
    assert.equal(existsSync(output), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('swaps active personas when the focus changes instead of accumulating stale participants', () => {
  const root = createProject();
  try {
    const security = preparePersonaTestScenarioBrief(root, 'customer-access', { focus: 'permission privacy identity', personas: personas() });
    const operations = preparePersonaTestScenarioBrief(root, 'customer-access', { focus: 'operations recovery observability', personas: personas() });
    assert.equal(security.activePersonas.some((persona) => persona.id === 'premium.identity-reviewer'), true);
    assert.equal(operations.activePersonas.some((persona) => persona.id === 'ewai.core.operator'), true);
    assert.notDeepEqual(operations.activePersonas.map(({ id }) => id), security.activePersonas.map(({ id }) => id));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validates and records paired authoritative evidence idempotently without changing delivery state', () => {
  const root = createProject();
  try {
    const statePath = resolve(root, 'SPECS/6.Build/customer-access/delivery-state.json');
    writeFileSync(statePath, '{"approval":"unchanged"}\n');
    const before = readFileSync(statePath, 'utf8');
    const brief = preparePersonaTestScenarioBrief(root, 'customer-access', { focus: 'permission journey', personas: personas() });
    const candidate = acceptedCandidate(brief);
    const first = recordPersonaTestScenarios(root, 'customer-access', candidate, { personas: personas(), reviewedBy: 'A. Reviewer', now: '2026-08-18T12:00:00.000Z' });
    const repeated = recordPersonaTestScenarios(root, 'customer-access', candidate, { personas: personas(), reviewedBy: 'A. Reviewer', now: '2026-08-18T12:00:00.000Z' });

    assert.equal(first.status, 'recorded');
    assert.equal(repeated.digest, first.digest);
    assert.equal(existsSync(resolve(root, first.jsonPath)), true);
    assert.equal(existsSync(resolve(root, first.markdownPath)), true);
    assert.match(readFileSync(resolve(root, first.markdownPath), 'utf8'), /persona perspectives are advisory/i);
    assert.equal(readFileSync(statePath, 'utf8'), before);

    const workspace = readPersonaTestScenarioWorkspace(root, 'customer-access', { personas: personas() });
    assert.equal(workspace.status, 'recorded');
    assert.equal(workspace.scenarios[0].id, 'PTS-001');
    assert.equal(workspace.reviewer, 'A. Reviewer');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects unsupported authority, unknown personas, unsafe paths, vague oracles, and conflicting evidence', () => {
  const root = createProject();
  try {
    const brief = preparePersonaTestScenarioBrief(root, 'customer-access', { focus: 'permission journey', personas: personas() });
    const base = acceptedCandidate(brief);
    const attempt = (mutate) => {
      const candidate = structuredClone(base);
      mutate(candidate.scenarios[0], candidate);
      return () => recordPersonaTestScenarios(root, 'customer-access', candidate, { personas: personas(), reviewedBy: 'A. Reviewer' });
    };
    assert.throws(attempt((scenario) => { scenario.sourceRefs = ['intent:acceptance:UNKNOWN']; }), /unknown source/i);
    assert.throws(attempt((scenario) => { scenario.personaContributions[0].personaId = 'premium.not-installed'; }), /unknown persona/i);
    assert.throws(attempt((scenario) => { scenario.plannedTest.file = '../outside.test.mjs'; }), /repository-relative/i);
    assert.throws(attempt((scenario) => { scenario.expectedResults = ['works correctly']; }), /observable/i);
    assert.throws(attempt((scenario) => { scenario.sourceRefs = []; scenario.status = 'accepted'; }), /source reference/i);

    recordPersonaTestScenarios(root, 'customer-access', base, { personas: personas(), reviewedBy: 'A. Reviewer', now: '2026-08-18T12:00:00.000Z' });
    assert.throws(attempt((scenario) => { scenario.title = 'Different accepted truth'; }), /conflicting/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports stale and invalid evidence without trusting Markdown', () => {
  const root = createProject();
  try {
    const brief = preparePersonaTestScenarioBrief(root, 'customer-access', { focus: 'permission journey', personas: personas() });
    const receipt = recordPersonaTestScenarios(root, 'customer-access', acceptedCandidate(brief), { personas: personas(), reviewedBy: 'A. Reviewer' });
    const intentPath = resolve(root, 'SPECS/2.Purpose/intents/quality/customer-access.md');
    writeFileSync(intentPath, `${readFileSync(intentPath, 'utf8')}\nA changed authoritative statement.\n`);
    assert.equal(readPersonaTestScenarioWorkspace(root, 'customer-access', { personas: personas() }).status, 'stale');

    writeFileSync(resolve(root, receipt.markdownPath), '# Tampered readable copy\n');
    assert.equal(readPersonaTestScenarioWorkspace(root, 'customer-access', { personas: personas() }).status, 'invalid');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const digestFixture = (value) => createHash('sha256').update(value).digest('hex');
const canonicalFixture = (value) => Array.isArray(value) ? value.map(canonicalFixture)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalFixture(value[key])])) : value;
const digestObjectFixture = (value) => digestFixture(JSON.stringify(canonicalFixture(value)));
const scenarioRoot = (root) => resolve(root, 'SPECS/6.Build/customer-access');
const intentFile = (root) => resolve(root, 'SPECS/2.Purpose/intents/quality/customer-access.md');
const scenarioOptions = () => ({ focus: 'permission journey', personas: personas(), reviewedBy: 'A. Reviewer' });

function legacyScenarioFixture(root, preparedBrief = null) {
  // Frozen v1 record construction, independent of the runtime's new digest policy.
  const brief = preparedBrief ?? preparePersonaTestScenarioBrief(root, 'customer-access', scenarioOptions());
  const source = ({ id, kind, label, path, authority }) => ({
    id, kind, label, path, authority, digest: digestFixture(readFileSync(resolve(root, path)))
  });
  const sources = brief.authoritativeSources.map(source);
  const contextualEvidence = brief.contextualEvidence.map(source);
  const project = ({ id, path, digest, authority }) => ({ id, path, digest, authority });
  const preparedSourceDigest = digestObjectFixture({ sources: sources.map(project), contextualEvidence: contextualEvidence.map(project) });
  const candidate = { ...acceptedCandidate(brief), preparedSourceDigest };
  const payload = {
    schema: candidate.schema, slug: candidate.slug, preparedSourceDigest,
    reviewer: 'A. Reviewer', focus: brief.focus, sources, contextualEvidence,
    activePersonas: brief.activePersonas, availability: brief.availability,
    scenarios: candidate.scenarios, gaps: [],
    authority: { personaPerspectivesAreAdvisory: true, humanEvidenceTakesPriority: true, approvalsChanged: false, premiumSyncAttempted: false }
  };
  const record = { ...payload, reviewedAt: '2026-08-18T12:00:00.000Z', contentDigest: digestObjectFixture(payload) };
  const markdown = '# Frozen legacy fixture\n\nAccepted scenario evidence.\n';
  record.markdownDigest = digestFixture(markdown);
  writeFileSync(resolve(scenarioRoot(root), 'test-scenarios.json'), JSON.stringify(record, null, 2) + '\n');
  writeFileSync(resolve(scenarioRoot(root), 'test-scenarios.md'), markdown);
  return { candidate, record };
}

test('FRESH-R01 rejects typed or cyclic metadata before accepting a lossy fingerprint', () => {
  const root = createProject();
  try {
    const options = scenarioOptions();
    const original = readFileSync(intentFile(root), 'utf8');
    const brief = preparePersonaTestScenarioBrief(root, 'customer-access', options);
    const candidate = acceptedCandidate(brief);
    const values = [
      '!!timestamp 2026-09-01', '!!timestamp 2027-09-01',
      '!!set {deny: null}', '!!set {permit: null}',
      '[{deadline: !!timestamp 2026-09-01}]',
      '!!omap [{first: deny}, {second: permit}]',
      '!!binary SGVsbG8=', '.inf', '&cycle {again: *cycle}'
    ];
    for (const value of values) {
      writeFileSync(intentFile(root), original.replace('\n---\n', `\ncustom_requirement: ${value}\n---\n`));
      assert.throws(() => preparePersonaTestScenarioBrief(root, 'customer-access', options), /metadata.*(?:unsupported|finite|cyclic)/i, value);
      assert.throws(() => recordPersonaTestScenarios(root, 'customer-access', candidate, options), /metadata.*(?:unsupported|finite|cyclic)/i, value);
      assert.equal(existsSync(resolve(scenarioRoot(root), 'test-scenarios.json')), false);
      assert.equal(existsSync(resolve(scenarioRoot(root), 'test-scenarios.source-baseline.json')), false);
    }
    writeFileSync(intentFile(root), original);
    recordPersonaTestScenarios(root, 'customer-access', candidate, options);
    const paths = ['test-scenarios.json', 'test-scenarios.md'].map(name => resolve(scenarioRoot(root), name));
    const pair = paths.map(path => readFileSync(path, 'utf8'));
    for (const value of values) {
      writeFileSync(intentFile(root), original.replace('\n---\n', `\ncustom_requirement: ${value}\n---\n`));
      const state = readPersonaTestScenarioWorkspace(root, 'customer-access', options);
      assert.equal(state.status, 'invalid', value);
      assert.match(state.reason, /metadata.*(?:unsupported|finite|cyclic)/i);
      assert.deepEqual(paths.map(path => readFileSync(path, 'utf8')), pair);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('FRESH-R01 preserves ordinary metadata fingerprints and permits non-cyclic aliases', () => {
  const root = createProject();
  try {
    const original = readFileSync(intentFile(root), 'utf8');
    const fields = 'custom_requirement: {first: [null, true, 1.5, "2026-09-01"], second: {result: deny}}';
    writeFileSync(intentFile(root), original.replace('\n---\n', `\n${fields}\n---\n`));
    const before = preparePersonaTestScenarioBrief(root, 'customer-access', scenarioOptions());
    const reordered = 'custom_requirement: {second: {result: deny}, first: [null, true, 1.5, "2026-09-01"]}';
    writeFileSync(intentFile(root), original.replace('\n---\n', `\n${reordered}\n---\n`));
    assert.equal(preparePersonaTestScenarioBrief(root, 'customer-access', scenarioOptions()).sourceDigest, before.sourceDigest);
    const aliases = 'custom_requirement: {first: &same {result: deny}, second: *same}';
    writeFileSync(intentFile(root), original.replace('\n---\n', `\n${aliases}\n---\n`));
    const aliased = preparePersonaTestScenarioBrief(root, 'customer-access', scenarioOptions());
    writeFileSync(intentFile(root), original.replace('\n---\n', '\ncustom_requirement: {first: {result: deny}, second: {result: deny}}\n---\n'));
    assert.equal(preparePersonaTestScenarioBrief(root, 'customer-access', scenarioOptions()).sourceDigest, aliased.sourceDigest);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('FRESH-R02 rejects a sparse intent even when planning sources could authorise recording', () => {
  const root = createProject();
  try {
    const options = scenarioOptions();
    const normal = preparePersonaTestScenarioBrief(root, 'customer-access', options);
    const candidate = acceptedCandidate(normal);
    candidate.scenarios[0].sourceRefs = ['test-plan:document'];
    const frontmatter = readFileSync(intentFile(root), 'utf8').match(/^---\n[\s\S]*?\n---\n/)[0];
    const bodies = ['# Access\n\n## Domain requirement\n\nRequests must be denied.\n', '# Access\n\n## Domain requirement\n\nRequests must be permitted.\n'];
    for (const body of bodies) {
      writeFileSync(intentFile(root), frontmatter + body);
      assert.throws(() => preparePersonaTestScenarioBrief(root, 'customer-access', options), /recognised intent source/i);
      assert.throws(() => recordPersonaTestScenarios(root, 'customer-access', candidate, options), /recognised intent source/i);
      assert.equal(existsSync(resolve(scenarioRoot(root), 'test-scenarios.json')), false);
    }
    // Model an accepted sparse v1 pack produced by the previous implementation.
    const sparse = { ...normal, authoritativeSources: normal.authoritativeSources.filter(source => !source.kind.startsWith('intent-')) };
    const legacy = legacyScenarioFixture(root, sparse);
    legacy.record.scenarios[0].sourceRefs = ['test-plan:document'];
    const { reviewedAt, markdownDigest, contentDigest, ...payload } = legacy.record;
    legacy.record.contentDigest = digestObjectFixture(payload);
    writeFileSync(resolve(scenarioRoot(root), 'test-scenarios.json'), JSON.stringify(legacy.record, null, 2) + '\n');
    legacy.candidate.scenarios[0].sourceRefs = ['test-plan:document'];
    const paths = ['test-scenarios.json', 'test-scenarios.md'].map(name => resolve(scenarioRoot(root), name));
    const pair = paths.map(path => readFileSync(path, 'utf8'));
    for (const content of [frontmatter + bodies[0], frontmatter.replace('\n---\n', '\ncustom_requirement: permit\n---\n') + bodies[1]]) {
      writeFileSync(intentFile(root), content);
      assert.equal(readPersonaTestScenarioWorkspace(root, 'customer-access', options).status, 'invalid');
      assert.throws(() => recordPersonaTestScenarios(root, 'customer-access', legacy.candidate, options), /recognised intent source/i);
      assert.deepEqual(paths.map(path => readFileSync(path, 'utf8')), pair);
      assert.equal(existsSync(resolve(scenarioRoot(root), 'test-scenarios.source-baseline.json')), false);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('lifecycle-only progress keeps accepted scenarios current without changing the evidence pair', () => {
  const root = createProject();
  try {
    const options = scenarioOptions();
    const brief = preparePersonaTestScenarioBrief(root, 'customer-access', options);
    const candidate = acceptedCandidate(brief);
    recordPersonaTestScenarios(root, 'customer-access', candidate, options);
    const jsonPath = resolve(scenarioRoot(root), 'test-scenarios.json');
    const markdownPath = resolve(scenarioRoot(root), 'test-scenarios.md');
    const original = [readFileSync(jsonPath, 'utf8'), readFileSync(markdownPath, 'utf8')];
    for (const phase of ['test-plan', 'build', 'standards-sweep', 'manual-qa']) {
      updateIntentDeliveryState(root, intentFile(root), {
        status: 'in-progress', deliveryStatus: 'in-progress', currentPhase: phase,
        deliveryStatePath: 'SPECS/6.Build/customer-access/delivery-state.json'
      });
      const next = preparePersonaTestScenarioBrief(root, 'customer-access', options);
      assert.equal(next.sourceDigest, brief.sourceDigest);
      assert.equal(readPersonaTestScenarioWorkspace(root, 'customer-access', options).status, 'recorded');
      assert.equal(recordPersonaTestScenarios(root, 'customer-access', candidate, options).idempotent, true);
    }
    assert.deepEqual([readFileSync(jsonPath, 'utf8'), readFileSync(markdownPath, 'utf8')], original);
    assert.equal(existsSync(resolve(scenarioRoot(root), 'test-scenarios.source-baseline.json')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('complete content, non-workflow metadata and other source changes remain stale', () => {
  const root = createProject();
  try {
    const options = scenarioOptions();
    const intentPath = intentFile(root);
    writeFileSync(intentPath, readFileSync(intentPath, 'utf8') + '\n' + 'Detailed requirement. '.repeat(100) + '\nFinal condition: deny.\n');
    const originals = new Map([
      intentPath,
      resolve(scenarioRoot(root), 'gates/plan/plan-contract.json'),
      resolve(scenarioRoot(root), 'gates/plan/claim-ledger.json'),
      resolve(scenarioRoot(root), 'test-plan.md')
    ].map((path) => [path, readFileSync(path, 'utf8')]));
    const brief = preparePersonaTestScenarioBrief(root, 'customer-access', options);
    recordPersonaTestScenarios(root, 'customer-access', acceptedCandidate(brief), options);
    const metadata = (key, value) => {
      const original = originals.get(intentPath);
      const match = original.match(/^---\n([\s\S]*?)\n---/);
      const fields = YAML.parse(match[1]);
      fields[key] = value;
      return `---\n${YAML.stringify(fields).trimEnd()}\n---${original.slice(match[0].length)}`;
    };
    const changes = [
      [intentPath, originals.get(intentPath).replace('Final condition: deny.', 'Final condition: permit.')],
      [intentPath, metadata('personas', [])],
      [intentPath, metadata('relationships', [{ type: 'relates-to', target: 'quality/other' }])],
      [intentPath, metadata('custom_policy', 'require-extra-review')],
      ...[...originals].filter(([path]) => path !== intentPath).map(([path, text]) => [path, text + '\n'])
    ];
    for (const [path, changed] of changes) {
      writeFileSync(path, changed);
      assert.equal(readPersonaTestScenarioWorkspace(root, 'customer-access', options).status, 'stale', path);
      writeFileSync(path, originals.get(path));
      assert.equal(readPersonaTestScenarioWorkspace(root, 'customer-access', options).status, 'recorded');
    }
    const standard = resolve(root, 'SPECS/4.Guidelines/new-standard.md');
    mkdirSync(resolve(standard, '..'), { recursive: true });
    writeFileSync(standard, '# Mandatory new condition\n');
    assert.equal(readPersonaTestScenarioWorkspace(root, 'customer-access', options).status, 'stale');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('exact current legacy replay adds a bound baseline and preserves the original accepted pair', () => {
  const root = createProject();
  try {
    const { candidate } = legacyScenarioFixture(root);
    const paths = ['test-scenarios.json', 'test-scenarios.md'].map((name) => resolve(scenarioRoot(root), name));
    const before = paths.map((path) => readFileSync(path, 'utf8'));
    const baselinePath = resolve(scenarioRoot(root), 'test-scenarios.source-baseline.json');
    const inventory = readdirSync(scenarioRoot(root)).sort();
    assert.equal(readPersonaTestScenarioWorkspace(root, 'customer-access', scenarioOptions()).status, 'recorded');
    preparePersonaTestScenarioBrief(root, 'customer-access', scenarioOptions());
    assert.deepEqual(readdirSync(scenarioRoot(root)).sort(), inventory, 'read-only calls must not upgrade legacy evidence');
    const replay = recordPersonaTestScenarios(root, 'customer-access', candidate, scenarioOptions());
    assert.equal(replay.idempotent, true);
    assert.equal(existsSync(baselinePath), true);
    const baselineBefore = readFileSync(baselinePath, 'utf8');
    assert.equal(replay.sourceBaselinePath, 'SPECS/6.Build/customer-access/test-scenarios.source-baseline.json');
    assert.equal(baselineBefore.includes('Only an authorised delegate'), false, 'no source body in baseline');
    updateIntentDeliveryState(root, intentFile(root), { currentPhase: 'build', status: 'in-progress' });
    assert.equal(readPersonaTestScenarioWorkspace(root, 'customer-access', scenarioOptions()).status, 'recorded');
    assert.equal(recordPersonaTestScenarios(root, 'customer-access', candidate, scenarioOptions()).idempotent, true);
    assert.deepEqual(paths.map((path) => readFileSync(path, 'utf8')), before);
    assert.equal(readFileSync(baselinePath, 'utf8'), baselineBefore);
    assert.throws(() => recordPersonaTestScenarios(root, 'customer-access', candidate, { ...scenarioOptions(), reviewedBy: 'Someone else' }), /conflicting/i);
    const changed = structuredClone(candidate);
    changed.scenarios[0].expectedResults = ['Unauthorised users are accepted without any permission check.'];
    assert.throws(() => recordPersonaTestScenarios(root, 'customer-access', changed, scenarioOptions()), /conflicting/i);
    writeFileSync(intentFile(root), readFileSync(intentFile(root), 'utf8') + '\nNew requirement.\n');
    assert.equal(readPersonaTestScenarioWorkspace(root, 'customer-access', scenarioOptions()).status, 'stale');
    assert.throws(() => recordPersonaTestScenarios(root, 'customer-access', candidate, scenarioOptions()), /stale/i);
    assert.equal(readFileSync(baselinePath, 'utf8'), baselineBefore);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('already-stale legacy evidence is not silently rebound', () => {
  const root = createProject();
  try {
    const { candidate } = legacyScenarioFixture(root);
    updateIntentDeliveryState(root, intentFile(root), { currentPhase: 'build' });
    assert.equal(readPersonaTestScenarioWorkspace(root, 'customer-access', scenarioOptions()).status, 'stale');
    assert.throws(() => recordPersonaTestScenarios(root, 'customer-access', candidate, scenarioOptions()), /stale/i);
    assert.equal(existsSync(resolve(scenarioRoot(root), 'test-scenarios.source-baseline.json')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('legacy fingerprint verification cannot bind content from a different source read', (t) => {
  const root = createProject();
  const realRead = readFileSync;
  let intercept;
  try {
    const { candidate } = legacyScenarioFixture(root);
    const original = realRead(intentFile(root), 'utf8');
    const changed = original + '\nA different requirement outside the displayed excerpt.\n';
    let reads = 0;
    intercept = t.mock.method(fs, 'readFileSync', (path, ...args) => {
      if (String(path) === intentFile(root) && ++reads === 2) {
        return args[0] === 'utf8' ? changed : Buffer.from(changed);
      }
      return realRead(path, ...args);
    });
    syncBuiltinESMExports();
    assert.throws(() => recordPersonaTestScenarios(root, 'customer-access', candidate, scenarioOptions()), /stale/i);
    assert.equal(existsSync(resolve(scenarioRoot(root), 'test-scenarios.source-baseline.json')), false);
  } finally {
    intercept?.mock.restore();
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

test('unknown fingerprint policies, tampered and symlinked baselines fail closed', () => {
  const root = createProject();
  try {
    const { candidate, record } = legacyScenarioFixture(root);
    recordPersonaTestScenarios(root, 'customer-access', candidate, scenarioOptions());
    const baselinePath = resolve(scenarioRoot(root), 'test-scenarios.source-baseline.json');
    const raw = readFileSync(baselinePath, 'utf8');
    const baseline = JSON.parse(raw);
    writeFileSync(baselinePath, JSON.stringify({ ...baseline, sourceDigest: '0'.repeat(64) }));
    assert.equal(readPersonaTestScenarioWorkspace(root, 'customer-access', scenarioOptions()).status, 'invalid');
    assert.throws(() => recordPersonaTestScenarios(root, 'customer-access', candidate, scenarioOptions()), /baseline|invalid/i);
    const { digest: ignoredDigest, ...wrongBinding } = { ...baseline, recordDigest: '1'.repeat(64) };
    writeFileSync(baselinePath, JSON.stringify({ ...wrongBinding, digest: digestObjectFixture(wrongBinding) }));
    assert.equal(readPersonaTestScenarioWorkspace(root, 'customer-access', scenarioOptions()).status, 'invalid');
    writeFileSync(baselinePath, raw);
    const wrongVersion = { ...record, sourceDigestVersion: 'future-unknown' };
    const { reviewedAt, markdownDigest, contentDigest, ...payload } = wrongVersion;
    wrongVersion.contentDigest = digestObjectFixture(payload);
    writeFileSync(resolve(scenarioRoot(root), 'test-scenarios.json'), JSON.stringify(wrongVersion));
    assert.equal(readPersonaTestScenarioWorkspace(root, 'customer-access', scenarioOptions()).status, 'invalid');
    writeFileSync(resolve(scenarioRoot(root), 'test-scenarios.json'), JSON.stringify(record));
    rmSync(baselinePath);
    const sentinel = resolve(root, 'baseline-sentinel.json');
    writeFileSync(sentinel, raw);
    symlinkSync(sentinel, baselinePath);
    assert.equal(readPersonaTestScenarioWorkspace(root, 'customer-access', scenarioOptions()).status, 'invalid');
    assert.throws(() => recordPersonaTestScenarios(root, 'customer-access', candidate, scenarioOptions()), /baseline|symbolic|regular|invalid/i);
    assert.equal(readFileSync(sentinel, 'utf8'), raw);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('missing legacy baselines stay conservative and orphan receipts cannot authorise a new pair', () => {
  const root = createProject();
  try {
    const { candidate } = legacyScenarioFixture(root);
    recordPersonaTestScenarios(root, 'customer-access', candidate, scenarioOptions());
    const baselinePath = resolve(scenarioRoot(root), 'test-scenarios.source-baseline.json');
    const baseline = readFileSync(baselinePath, 'utf8');
    rmSync(baselinePath);
    updateIntentDeliveryState(root, intentFile(root), { currentPhase: 'build' });
    assert.equal(readPersonaTestScenarioWorkspace(root, 'customer-access', scenarioOptions()).status, 'stale');
    for (const name of ['test-scenarios.json', 'test-scenarios.md']) rmSync(resolve(scenarioRoot(root), name));
    writeFileSync(baselinePath, baseline);
    const fresh = preparePersonaTestScenarioBrief(root, 'customer-access', scenarioOptions());
    assert.throws(() => recordPersonaTestScenarios(root, 'customer-access', acceptedCandidate(fresh), scenarioOptions()), /baseline.*pair/i);
    assert.equal(existsSync(resolve(scenarioRoot(root), 'test-scenarios.json')), false);
    assert.equal(readFileSync(baselinePath, 'utf8'), baseline);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('fails closed when a paired write is interrupted', () => {
  const root = createProject();
  try {
    const brief = preparePersonaTestScenarioBrief(root, 'customer-access', { focus: 'permission journey', personas: personas() });
    assert.throws(() => recordPersonaTestScenarios(root, 'customer-access', acceptedCandidate(brief), {
      personas: personas(), reviewedBy: 'A. Reviewer', failAfterStage: 'json-committed'
    }), /interrupted/i);
    assert.equal(readPersonaTestScenarioWorkspace(root, 'customer-access', { personas: personas() }).status, 'missing');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a tampered recovery journal without deleting files outside the transaction boundary', () => {
  const root = createProject();
  try {
    const brief = preparePersonaTestScenarioBrief(root, 'customer-access', { focus: 'permission journey', personas: personas() });
    recordPersonaTestScenarios(root, 'customer-access', acceptedCandidate(brief), { personas: personas(), reviewedBy: 'A. Reviewer' });
    const jsonPath = resolve(root, 'SPECS/6.Build/customer-access/test-scenarios.json');
    const markdownPath = resolve(root, 'SPECS/6.Build/customer-access/test-scenarios.md');
    const sentinel = resolve(root, 'must-not-delete.txt');
    const transactionRoot = resolve(root, '.ewai-pipeline/runtime/test-scenario-transactions');
    mkdirSync(transactionRoot, { recursive: true });
    writeFileSync(sentinel, 'preserve me\n');
    writeFileSync(resolve(transactionRoot, 'customer-access.json'), `${JSON.stringify({
      schema: 'ewai.test-scenario-transaction/v1',
      slug: 'customer-access',
      phase: 'staged',
      jsonStage: sentinel,
      markdownStage: `${markdownPath}.attacker.tmp`
    }, null, 2)}\n`);

    const workspace = readPersonaTestScenarioWorkspace(root, 'customer-access', { personas: personas() });
    assert.equal(workspace.status, 'invalid');
    assert.match(workspace.reason, /unsafe test-scenario transaction/i);
    assert.equal(readFileSync(sentinel, 'utf8'), 'preserve me\n');
    assert.equal(existsSync(jsonPath), true);
    assert.equal(existsSync(markdownPath), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI prepare, record, status, and help expose the same safe contract', () => {
  const root = createProject();
  try {
    const projectPersona = resolve(root, 'SPECS/2.Purpose/personas/project/product-owner.md');
    mkdirSync(resolve(projectPersona, '..'), { recursive: true });
    writeFileSync(projectPersona, `---\nschema: ewai.persona/v1\nid: project.product-owner\nname: Product Owner\ntier: project\ncategory: product\ndescription: Protects journeys and acceptance outcomes.\ntags: [journey, acceptance, permission]\ncapabilities: [product review]\n---\n\nProject persona.\n`);
    const prepared = spawnSync(process.execPath, [bin, 'test-scenarios', 'prepare', 'customer-access', '--focus', 'permission journey', '--project', root, '--json'], { encoding: 'utf8' });
    assert.equal(prepared.status, 0, prepared.stderr);
    const brief = JSON.parse(prepared.stdout);
    assert.equal(brief.schema, 'ewai.persona-test-brief/v1');

    const input = resolve(root, 'candidate.json');
    writeFileSync(input, `${JSON.stringify(acceptedCandidate(brief), null, 2)}\n`);
    const recorded = spawnSync(process.execPath, [bin, 'test-scenarios', 'record', 'customer-access', '--input', input, '--reviewed-by', 'CLI Reviewer', '--project', root, '--json'], { encoding: 'utf8' });
    assert.equal(recorded.status, 0, recorded.stderr);
    assert.equal(JSON.parse(recorded.stdout).status, 'recorded');

    updateIntentDeliveryState(root, intentFile(root), { currentPhase: 'build', status: 'in-progress' });
    const status = spawnSync(process.execPath, [bin, 'test-scenarios', 'status', 'customer-access', '--project', root, '--json'], { encoding: 'utf8' });
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).status, 'recorded');

    const help = spawnSync(process.execPath, [bin, 'help'], { encoding: 'utf8' });
    assert.match(help.stdout, /test-scenarios prepare/);
    assert.match(help.stdout, /test-scenarios record/);
    assert.match(help.stdout, /test-scenarios status/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
