import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { initProject } from '../src/project.mjs';
import { createIntent } from '../src/intents.mjs';
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
