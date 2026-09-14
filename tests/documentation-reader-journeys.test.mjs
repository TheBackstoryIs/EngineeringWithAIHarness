import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {initProject} from '../src/project.mjs';
import {createIntent} from '../src/intents.mjs';
import {listOrganisationBlueprints, resolveOrganisationBlueprint} from '../src/organisation-blueprints.mjs';
import {chmodSync} from 'node:fs';
import {prepareKnowledgeProposals} from '../src/knowledge-proposals.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));

test('README leads with installing EWAI and launching guided project setup', () => {
  const text = readFileSync(resolve(repo, 'README.md'), 'utf8');
  const start = text.slice(text.indexOf('## Install and start'), text.indexOf('## Start with a conversation'));
  assert.ok(start.length > 0, 'Installation and launch should come before conversational examples');
  const commands = /```bash\n([\s\S]*?)\n```/.exec(start)?.[1];
  assert.equal(commands, 'npm install --global @thebackstoryis/engineering-with-ai\ncd /path/to/your/project\newai');
  assert.match(start, /walks you through initialising (the|your) project/i);
  assert.match(start, /skills automatically/i);
  assert.match(start, /installed and signed in/i);
  assert.match(start, /run `ewai`.+again/i);
});

test('public user guides do not assign host rendering and orchestration duties to the reader', () => {
  const misplaced = [
    /offer Archaeology as an optional investigation\. Ask whether/i,
    /Present the inferred understanding to the owner/i,
    /Show the active ensemble before asking for challenges/i,
    /Display safe active persona metadata while they work/i,
    /Show active personas, their tiers, matched signals, and reasons/i,
    /The UI and CLI must call it/i,
    /The browser must send the revision it last read/i,
    /Avoid meaningless heartbeat events/i,
    /The security disclaimer must always be present/i,
    /EWAI must remain functional with the standard model/i,
    /The host should prepare test expectations/i,
  ];
  function inspect(folder) {
    for (const entry of readdirSync(folder, {withFileTypes: true})) {
      const path = resolve(folder, entry.name);
      if (entry.isDirectory()) inspect(path);
      else if (entry.isFile() && path.endsWith('.md')) {
        const prose = readFileSync(path, 'utf8').replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
        for (const pattern of misplaced) assert.ok(!pattern.test(prose), path + ': misplaced host instruction ' + pattern);
      }
    }
  }
  inspect(resolve(repo, 'Docs'));
});

test('guided workflows explain a conversational route before their command reference', () => {
  for (const path of [
    'Docs/existing-project-onboarding-guide.md',
    'Docs/screen-prototype-creation-guide.md',
    'Docs/persona-guided-prototype-iteration.md',
    'Docs/quality/persona-driven-test-scenarios.md',
    'Docs/meeting-evidence-user-guide.md',
    'Docs/design-systems/design-system-pack-authoring-guide.md',
    'Docs/design-systems/design-system-review-guide.md',
  ]) {
    const text = readFileSync(resolve(repo, path), 'utf8');
    const firstCommand = text.indexOf('```bash');
    const opening = firstCommand < 0 ? text : text.slice(0, firstCommand);
    assert.match(opening, /Ask EWAI|ask EWAI/, path + ': explain what the user can ask first');
    assert.match(opening, /you|your/i, path + ': address the reader');
  }
});

test('prototype selection is not presented as final Manual QA', () => {
  const text = readFileSync(resolve(repo, 'Docs/screen-prototype-creation-guide.md'), 'utf8');
  assert.doesNotMatch(text, /Human selection and Manual QA/);
  assert.match(text, /Final Manual QA.+after Delivery/);
});

test('capability reference startup agrees with initialization-first and conditional menu actions', () => {
  const text = readFileSync(resolve(repo, 'Docs/reference/capabilities-and-project-layout.md'), 'utf8');
  const startup = text.slice(text.indexOf('## The EWAI companion'), text.indexOf('## Technology and stack packs'));
  assert.doesNotMatch(startup, /5\. Offer initialization/);
  assert.match(startup, /\[9\] Configure the dashboard/);
  assert.match(startup, /\[7\] Read about premium personas/);
  assert.match(startup, /\[8\] Set up premium personas/);
  assert.match(startup, /verified installed pack|installed pack is verified/);
});

test('the harness keeps its internal SPECS workspace out of source control', () => {
  const ignore = readFileSync(resolve(repo, '.gitignore'), 'utf8');
  assert.match(ignore, /^\/SPECS\/$/m);
  const contributing = readFileSync(resolve(repo, 'Docs/maintainers/contributing.md'), 'utf8');
  assert.match(contributing, /SPECS.+local.+excluded from Git/i);
});
const guide = readFileSync(resolve(repo, 'Docs/knowledge-proposals-user-guide.md'), 'utf8');
function example(name, language = 'json') {
  const marker = `<!-- example: ${name} -->`;
  assert.ok(guide.includes(marker), `Missing complete documented example: ${name}`);
  const remaining = guide.slice(guide.indexOf(marker) + marker.length);
  const fence = new RegExp('```' + language + '\\n([\\s\\S]*?)\\n```').exec(remaining);
  assert.ok(fence, `Missing ${language} fence after ${name}`);
  return fence[1];
}
function run(root, ...args) {
  // No host, check-in, provider or premium operations: only the knowledge CLI
  // against a disposable project and explicitly supplied synthetic evidence.
  return spawnSync(process.execPath, [resolve(repo, 'bin/ewai'), 'knowledge', ...args, '--project', root, '--json'], {
    cwd: root, encoding: 'utf8', timeout: 20_000,
  });
}
function successful(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-reader-docs-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  initProject(root, {name: 'Documentation example'});
  const retros = resolve(root, 'SPECS/3.Evidence/retros');
  mkdirSync(retros, {recursive: true});
  writeFileSync(resolve(retros, 'sprint-24.md'), example('knowledge-retrospective', 'markdown') + '\n');
  const prepared = prepareKnowledgeProposals(root, 'retrospective:sprint-24', {personaCatalogue: []});
  const anchor = prepared.source.anchors[0].id;
  const substitute = text => text.replaceAll('SOURCE_DIGEST_FROM_PREPARE', prepared.source.digest).replaceAll('ANCHOR_ID_FROM_PREPARE', anchor);
  const input = JSON.parse(substitute(example('knowledge-proposal-bundle')));
  writeFileSync(resolve(root, 'proposal-bundle.json'), JSON.stringify(input));
  const recorded = successful(run(root, 'record', prepared.source.ref, '--input', './proposal-bundle.json'));
  return {root, input, prepared, substitute, recorded};
}

for (const decision of ['accepted', 'amended', 'rejected', 'deferred']) {
  test(`documented knowledge ${decision} example runs through real CLI without changing work before approval`, t => {
    const f = fixture(t);
    const review = JSON.parse(f.substitute(example(`knowledge-review-${decision}`)));
    const destination = resolve(f.root, f.input.bundle.proposals[0].destination);
    writeFileSync(resolve(f.root, 'proposal-review.json'), JSON.stringify(review));
    assert.equal(existsSync(destination), false);
    successful(run(f.root, 'review', f.recorded.bundleId, '--input', './proposal-review.json', '--reviewed-by', 'Example reviewer'));
    assert.equal(existsSync(destination), false, 'review alone must not publish a document');
    const shouldExist = ['accepted', 'amended'].includes(decision);
    const publication = run(f.root, 'materialise', f.recorded.bundleId, '--yes', '--approved-by', 'Example owner');
    if (shouldExist) successful(publication);
    else {
      assert.equal(publication.status, 1);
      assert.match(publication.stderr + publication.stdout, /no accepted or amended records/);
    }
    assert.equal(existsSync(destination), shouldExist);
    if (shouldExist) {
      const expected = decision === 'amended' ? review.dispositions[0].replacementMarkdown : f.input.bundle.proposals[0].proposedMarkdown;
      assert.equal(readFileSync(destination, 'utf8').trim(), expected.trim());
      writeFileSync(destination, '# Existing human work\n');
      // Replaying an approved operation must not overwrite later edits.
      successful(run(f.root, 'materialise', f.recorded.bundleId, '--yes', '--approved-by', 'Example owner'));
      assert.equal(readFileSync(destination, 'utf8'), '# Existing human work\n');
    }
  });
}

test('documented proposal rejects stale evidence and a review without an actual decision', t => {
  const f = fixture(t);
  const stale = structuredClone(f.input);
  stale.bundle.sourceDigest = '0'.repeat(64);
  writeFileSync(resolve(f.root, 'stale.json'), JSON.stringify(stale));
  const staleResult = run(f.root, 'record', f.prepared.source.ref, '--input', './stale.json');
  assert.equal(staleResult.status, 1);
  assert.match(staleResult.stderr + staleResult.stdout, /digest is stale/);
  writeFileSync(resolve(f.root, 'empty-review.json'), JSON.stringify({dispositions: []}));
  const empty = run(f.root, 'review', f.recorded.bundleId, '--input', './empty-review.json', '--reviewed-by', 'Example reviewer');
  assert.equal(empty.status, 1);
  assert.match(empty.stderr + empty.stdout, /every proposal exactly once/);
});

test('changing only a reviewed proposal cannot replace its bundle or decision', t => {
  const f = fixture(t);
  const review = JSON.parse(f.substitute(example('knowledge-review-accepted')));
  writeFileSync(resolve(f.root, 'proposal-review.json'), JSON.stringify(review));
  successful(run(f.root, 'review', f.recorded.bundleId, '--input', './proposal-review.json', '--reviewed-by', 'Example reviewer'));

  const revised = structuredClone(f.input);
  revised.bundle.proposals[0].title = 'Revised proposal against unchanged evidence';
  writeFileSync(resolve(f.root, 'revised-bundle.json'), JSON.stringify(revised));
  const result = run(f.root, 'record', f.prepared.source.ref, '--input', './revised-bundle.json');
  assert.equal(result.status, 1);
  assert.match(result.stderr + result.stdout, /Conflicting knowledge proposal bundle already exists/);

  const replacementReview = JSON.parse(f.substitute(example('knowledge-review-rejected')));
  writeFileSync(resolve(f.root, 'replacement-review.json'), JSON.stringify(replacementReview));
  const replacement = run(f.root, 'review', f.recorded.bundleId, '--input', './replacement-review.json', '--reviewed-by', 'Example reviewer');
  assert.equal(replacement.status, 1);
  assert.match(replacement.stderr + replacement.stdout, /review already exists/);
});

test('every documentation page is reachable from the reader index through valid local links', () => {
  const docsRoot = resolve(repo, 'Docs');
  const all = [];
  function collect(folder) {
    for (const entry of readdirSync(folder, {withFileTypes: true})) {
      const file = resolve(folder, entry.name);
      if (entry.isDirectory()) collect(file);
      else if (entry.isFile() && file.endsWith('.md')) all.push(file);
    }
  }
  collect(docsRoot);
  const visited = new Set(), queue = [resolve(docsRoot, 'README.md')];
  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const match of text.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^(?:[a-z]+:|\/)/i.test(target)) continue;
      const linked = resolve(dirname(file), decodeURIComponent(target));
      assert.ok(existsSync(linked), `${file}: missing ${target}`);
      if (linked.startsWith(docsRoot + '/') && linked.endsWith('.md')) queue.push(linked);
    }
  }
  assert.deepEqual(all.filter(file => !visited.has(file)), [], 'An existing guide must not disappear from the navigation');
});

test('new engineers have a tutorial route and an explanation of all fourteen stages', () => {
  const index = readFileSync(resolve(repo, 'Docs/README.md'), 'utf8');
  for (const path of ['tutorials/first-session.md', 'tutorials/first-delivery.md', 'explanation/delivery-workflow.md']) {
    assert.ok(index.includes(path), `Starting guide must expose ${path}`);
    assert.ok(existsSync(resolve(repo, 'Docs', path)));
  }
  const workflow = readFileSync(resolve(repo, 'Docs/explanation/delivery-workflow.md'), 'utf8');
  for (let stage = 1; stage <= 14; stage++) assert.match(workflow, new RegExp('\\| ' + stage + '\\. '));
  assert.match(workflow, /ewai-deliver/);
  assert.match(workflow, /not-supported/);
  assert.match(workflow, /Manual QA/);
  assert.match(workflow, /Fit Check/);
});

test('documented meeting input can be reviewed and promoted with the real CLI', t => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-meeting-docs-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  initProject(root, {name: 'Meeting tutorial'});
  const text = readFileSync(resolve(repo, 'Docs/examples/meeting-review.md'), 'utf8');
  const block = (id, language) => {
    const start = text.indexOf(`<!-- example: ${id} -->`);
    assert.ok(start >= 0, `Missing example ${id}`);
    const match = new RegExp('```' + language + '\\n([\\s\\S]*?)\\n```').exec(text.slice(start));
    assert.ok(match, `Missing ${language} example ${id}`);
    return match[1];
  };
  writeFileSync(resolve(root, 'meeting.md'), block('meeting-source', 'markdown') + '\n');
  const invoke = (...args) => spawnSync(process.execPath, [resolve(repo, 'bin/ewai'), 'meeting', ...args, '--project', root, '--json'], {cwd: root, encoding: 'utf8', timeout: 20_000});
  const registration = successful(invoke('register', './meeting.md', '--yes', '--classification', 'internal', '--cloud-processing', 'allowed'));
  const source = registration.source;
  successful(invoke('prepare', source.sourceId));
  const input = block('meeting-review', 'json').replaceAll('SOURCE_ID_FROM_REGISTER', source.sourceId).replaceAll('SOURCE_DIGEST_FROM_REGISTER', source.digest);
  writeFileSync(resolve(root, 'meeting-review.json'), input);
  const evidence = resolve(root, 'SPECS/3.Evidence/meeting-evidence', source.sourceId, 'evidence.json');
  successful(invoke('review', source.sourceId, '--input', './meeting-review.json', '--reviewed-by', 'Example reviewer'));
  assert.equal(existsSync(evidence), false);
  successful(invoke('promote', source.sourceId, '--yes', '--approved-by', 'Example owner'));
  assert.ok(existsSync(evidence));
  assert.match(readFileSync(evidence, 'utf8'), /MEC-001/);
});

function documentedBlock(path, id, language = 'json') {
  const content = readFileSync(resolve(repo, path), 'utf8');
  const marker = '<!-- example: ' + id + ' -->';
  assert.ok(content.includes(marker), 'Missing example ' + id);
  const match = new RegExp('```' + language + '\\n([\\s\\S]*?)\\n```').exec(content.slice(content.indexOf(marker)));
  assert.ok(match, 'Missing example fence ' + id);
  return match[1];
}
function publicFixture(t, name) {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-editorial-' + name + '-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  initProject(root, {name: 'Editorial ' + name});
  const cli = (...args) => spawnSync(process.execPath, [resolve(repo, 'bin/ewai'), ...args, '--project', root, '--json'], {
    cwd: root, encoding: 'utf8', timeout: 20_000, env: {...process.env, EWAI_TEST_HOME: resolve(root, '.test-home')},
  });
  return {root, cli};
}

test('documented design pack validates, installs and selects using distinct returned digests', t => {
  const {root, cli} = publicFixture(t, 'design');
  const folder = resolve(root, 'example-design');
  mkdirSync(folder);
  writeFileSync(resolve(folder, 'pack.yaml'), documentedBlock('Docs/examples/minimal-design-system.md', 'design-manifest', 'yaml'));
  writeFileSync(resolve(folder, 'recovery.md'), documentedBlock('Docs/examples/minimal-design-system.md', 'design-content', 'markdown'));
  const validation = successful(cli('design-system', 'validate', './example-design'));
  assert.equal(successful(cli('design-system', 'install', './example-design', '--scope', 'project', '--expected-digest', validation.digest, '--yes')).status, 'installed');
  const resolved = successful(cli('design-system', 'resolve', 'org.example.product-design'));
  successful(cli('design-system', 'select', 'org.example.product-design', '--expected-digest', resolved.effectiveDigest, '--approved-by', 'Example owner', '--yes'));
  assert.ok(existsSync(resolve(root, 'SPECS/5.Strategy/design-system.md')));
  assert.equal(successful(cli('design-system', 'status')).effectiveDigest, resolved.effectiveDigest);
});

test('documented non-sending adapter validates and rejects transport without claiming a receipt', t => {
  const {root, cli} = publicFixture(t, 'adapter');
  const folder = resolve(root, 'example-adapter');
  mkdirSync(resolve(folder, 'bin'), {recursive: true});
  writeFileSync(resolve(folder, 'error-report-provider.json'), documentedBlock('Docs/examples/error-report-adapter.md', 'error-adapter-manifest'));
  const entry = resolve(folder, 'bin/send-report');
  writeFileSync(entry, documentedBlock('Docs/examples/error-report-adapter.md', 'error-adapter-script', 'javascript'));
  chmodSync(entry, 0o755);
  successful(cli('error-report', 'adapter-validate', './example-adapter'));
  const request = {schema: 'ewai.error-report-submission/v1', attemptId: 'example-attempt', archiveDigest: 'sha256:' + 'a'.repeat(64)};
  const result = spawnSync(process.execPath, [entry], {encoding: 'utf8', input: JSON.stringify(request)});
  const ack = successful(result);
  assert.equal(ack.status, 'rejected');
  assert.equal(ack.attemptId, request.attemptId);
  assert.equal(ack.archiveDigest, request.archiveDigest);
});

test('documented test scenario records against actual prepared intent references', t => {
  const {root, cli} = publicFixture(t, 'scenario');
  createIntent(root, {slug: 'customer-access', domain: 'quality', title: 'Customer access', details: {
    problem: 'Delegates need to request access.',
    desiredOutcome: 'An authorised delegate can request access.',
    journeys: '1. [J-001] Submit an access request.',
    acceptanceCriteria: '1. [AC-001] An authorised request is accepted and receives a clear success outcome.',
  }});
  const brief = successful(cli('test-scenarios', 'prepare', 'customer-access', '--focus', 'permission and recovery'));
  assert.ok(brief.activePersonas.length);
  const input = documentedBlock('Docs/examples/test-scenario-input.md', 'test-scenario')
    .replaceAll('SOURCE_DIGEST', brief.sourceDigest)
    .replaceAll('JOURNEY_SOURCE_ID', 'intent:journey:J-001')
    .replaceAll('ACCEPTANCE_SOURCE_ID', 'intent:acceptance:AC-001')
    .replaceAll('ACTIVE_PERSONA_ID', brief.activePersonas[0].id);
  writeFileSync(resolve(root, 'scenario-input.json'), input);
  successful(cli('test-scenarios', 'record', 'customer-access', '--input', 'scenario-input.json', '--reviewed-by', 'Example reviewer'));
  assert.equal(successful(cli('test-scenarios', 'status', 'customer-access')).status, 'recorded');
  assert.equal(existsSync(resolve(root, 'tests/access.test.mjs')), false, 'recording must not create or execute the planned test');
});

test('documented prototype plan and cycle input handoffs work through the CLI', t => {
  const {root, cli} = publicFixture(t, 'prototype');
  const path = 'Docs/examples/prototype-review-inputs.md';
  const digest = char => 'sha256:' + char.repeat(64);
  function input(file, id, substitutions = {}) {
    let content = documentedBlock(path, id);
    for (const [key, value] of Object.entries(substitutions)) content = content.replaceAll(key, value);
    writeFileSync(resolve(root, file), content);
  }
  // Synthetic digests and capture references exercise format and handoffs only.
  // This test is not rendered-design evidence or human prototype acceptance.
  input('plan-prepare.json', 'prototype-plan', {INTENT_DIGEST: digest('a'), DESIGN_SYSTEM_DIGEST: digest('b')});
  const plan = successful(cli('prototype-review', 'plan-prepare', 'customer-portal', '--input', 'plan-prepare.json'));
  input('plan-review.json', 'prototype-plan-review', {
    PLAN_PREPARATION_DIGEST: plan.preparation.preparationDigest, ACTIVE_PERSONA_ID: plan.activePersonas[0].id,
  });
  const reviewed = successful(cli('prototype-review', 'plan-record', 'customer-portal', '--input', 'plan-review.json'));
  const folder = resolve(root, 'SPECS/6.Build/customer-portal/ui-design-assets/prototypes');
  mkdirSync(folder, {recursive: true});
  writeFileSync(resolve(folder, 'selected.html'), '<!doctype html><title>Synthetic example</title>');
  input('cycle-prepare.json', 'prototype-cycle', {PLAN_REVIEW_DIGEST: reviewed.review.contentDigest, PROTOTYPE_MANIFEST_DIGEST: digest('c')});
  const cycle = successful(cli('prototype-review', 'cycle-prepare', 'customer-portal', '--input', 'cycle-prepare.json'));
  input('cycle-review.json', 'prototype-cycle-review', {
    CYCLE_PREPARATION_DIGEST: cycle.preparation.preparationDigest, ACTIVE_PERSONA_ID: cycle.activePersonas[0].id,
  });
  const final = successful(cli('prototype-review', 'cycle-record', 'customer-portal', '--input', 'cycle-review.json'));
  assert.equal(final.review.nextAction, 'iterate');
  assert.equal(final.review.assessment.complete, true);
});


test('documented policy and Blueprint form a resolvable policy contribution', t => {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-policy-docs-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const pack = resolve(root, 'example-blueprint');
  mkdirSync(resolve(pack, 'policies'), {recursive: true});
  const path = 'Docs/policies/policy-pack-authoring-guide.md';
  const guide = readFileSync(resolve(repo, path), 'utf8');
  const policy = /```yaml\n([\s\S]*?)\n```/.exec(guide);
  assert.ok(policy);
  writeFileSync(resolve(pack, 'policies/design-assurance.yaml'), policy[1]);
  writeFileSync(resolve(pack, 'pack.yaml'), documentedBlock(path, 'policy-blueprint', 'yaml'));
  const catalogue = listOrganisationBlueprints({roots: [{path: root, sourceClass: 'project'}]});
  const result = resolveOrganisationBlueprint('org.example.engineering', catalogue);
  assert.equal(result.counts.policies, 1);
  assert.equal(result.modules[0].module.policies[0].id, 'design-assurance');
  assert.equal(result.modules[0].module.policies[0].source, 'policies/design-assurance.yaml');
});

test('reader links point to existing Markdown headings, including README navigation', () => {
  const files = [resolve(repo, 'README.md')];
  function collect(folder) {
    for (const entry of readdirSync(folder, {withFileTypes: true})) {
      const file = resolve(folder, entry.name);
      if (entry.isDirectory()) collect(file);
      else if (entry.isFile() && file.endsWith('.md')) files.push(file);
    }
  }
  collect(resolve(repo, 'Docs'));
  const withoutFences = text => text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  const slugs = file => {
    const text = withoutFences(readFileSync(file, 'utf8'));
    const counts = new Map(), result = new Set();
    for (const match of text.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
      const base = match[1].toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
      const count = counts.get(base) ?? 0;
      result.add(base + (count ? '-' + count : ''));
      counts.set(base, count + 1);
    }
    for (const match of text.matchAll(/\bid=["']([^"']+)["']/g)) result.add(match[1]);
    return result;
  };
  for (const file of files) {
    const text = withoutFences(readFileSync(file, 'utf8'));
    for (const match of text.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
      const target = match[1];
      if (/^(?:[a-z]+:|\/)/i.test(target) || !target.includes('#')) continue;
      const [path, fragment] = target.split('#');
      if (!fragment) continue;
      const linked = path ? resolve(dirname(file), decodeURIComponent(path)) : file;
      if (!linked.endsWith('.md')) continue;
      assert.ok(existsSync(linked), file + ': missing ' + path);
      assert.ok(slugs(linked).has(decodeURIComponent(fragment)), file + ': missing heading ' + target);
    }
  }
});
