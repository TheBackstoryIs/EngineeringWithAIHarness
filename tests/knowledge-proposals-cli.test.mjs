import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { initProject } from '../src/project.mjs';

const cli = resolve(import.meta.dirname, '../bin/ewai');
const disclaimer = 'Security validation is evidence, not certification or proof that this system is secure. Tools can miss vulnerabilities and produce false positives. A qualified human must review the scope, findings, limitations and residual risk before release.';

function runCli(root, args) {
  return spawnSync(process.execPath, [cli, ...args, '--project', root], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function projectFixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-knowledge-cli-'));
  initProject(root, { name: 'Knowledge Proposal CLI Test' });
  mkdirSync(resolve(root, 'SPECS/3.Evidence/retros'), { recursive: true });
  writeFileSync(resolve(root, 'SPECS/3.Evidence/retros/sprint-24.md'), '# Retrospective\n\n## What we learned\n\nRevalidate evidence before materialisation.\n');
  return root;
}

test('knowledge command family documents the evidence-to-knowledge workflow', () => {
  const root = projectFixture();
  try {
    const result = runCli(root, ['help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /knowledge sources/);
    assert.match(result.stdout, /knowledge prepare SOURCE_REF/);
    assert.match(result.stdout, /knowledge record SOURCE_REF --input FILE/);
    assert.match(result.stdout, /knowledge review BUNDLE_ID --input FILE --reviewed-by NAME/);
    assert.match(result.stdout, /knowledge materialise BUNDLE_ID --yes --approved-by NAME/);
    assert.match(result.stdout, /knowledge recover BUNDLE_ID --yes/);
    assert.match(result.stdout, /knowledge status \[BUNDLE_ID\]/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('knowledge CLI prepares, records, reviews and additively materialises a proposal bundle', () => {
  const root = projectFixture();
  try {
    const sources = runCli(root, ['knowledge', 'sources', '--json']);
    assert.equal(sources.status, 0, sources.stderr);
    const sourceList = JSON.parse(sources.stdout);
    assert.deepEqual(sourceList.sources.map(({ ref }) => ref), ['retrospective:sprint-24']);
    assert.equal(sourceList.notices.includes(disclaimer), true);

    const prepared = runCli(root, ['knowledge', 'prepare', 'retrospective:sprint-24', '--json']);
    assert.equal(prepared.status, 0, prepared.stderr);
    const preparation = JSON.parse(prepared.stdout);
    assert.match(preparation.modelContext, /Revalidate evidence/);
    assert.equal(preparation.activePersonas.length > 0, true);
    assert.equal(preparation.notices.includes(disclaimer), true);

    const proposalInput = resolve(root, 'proposal-bundle.json');
    writeFileSync(proposalInput, `${JSON.stringify({
      activePersonas: preparation.activePersonas,
      bundle: {
        schema: 'ewai.knowledge-proposal-bundle/v1',
        sourceRef: preparation.source.ref,
        sourceDigest: preparation.source.digest,
        proposals: [{
          id: 'KNP-001', kind: 'pattern', title: 'Revalidate evidence',
          destination: 'SPECS/5.Strategy/patterns/revalidate-evidence.md',
          evidenceAnchors: [preparation.source.anchors[0].id],
          rationale: 'The retrospective identifies a repeatable safe delivery practice.',
          uncertainty: 'A named reviewer must confirm the wider applicability.',
          relationships: [],
          proposedMarkdown: '# Revalidate evidence\n\nRevalidate current evidence before materialisation.\n\n## Provenance\n\n- Source: `retrospective:sprint-24`\n- Anchor: `heading:what-we-learned`\n',
        }],
      },
    }, null, 2)}\n`);
    const recorded = runCli(root, ['knowledge', 'record', preparation.source.ref, '--input', proposalInput, '--json']);
    assert.equal(recorded.status, 0, recorded.stderr);
    const recording = JSON.parse(recorded.stdout);
    assert.equal(recording.counts.additive, 1);
    assert.equal(existsSync(resolve(root, 'SPECS/5.Strategy/patterns/revalidate-evidence.md')), false);

    const reviewInput = resolve(root, 'proposal-review.json');
    writeFileSync(reviewInput, `${JSON.stringify({ dispositions: [{ proposalId: 'KNP-001', decision: 'accepted' }] }, null, 2)}\n`);
    const reviewed = runCli(root, ['knowledge', 'review', recording.bundleId, '--input', reviewInput, '--reviewed-by', 'Product Owner', '--json']);
    assert.equal(reviewed.status, 0, reviewed.stderr);
    assert.equal(JSON.parse(reviewed.stdout).reviewedBy, 'Product Owner');

    const denied = runCli(root, ['knowledge', 'materialise', recording.bundleId, '--approved-by', 'Product Owner', '--json']);
    assert.equal(denied.status, 1);
    assert.match(JSON.parse(denied.stderr).error, /requires --yes/);
    assert.equal(JSON.parse(denied.stderr).assurance_notice, disclaimer);

    const materialised = runCli(root, ['knowledge', 'materialise', recording.bundleId, '--yes', '--approved-by', 'Product Owner', '--json']);
    assert.equal(materialised.status, 0, materialised.stderr);
    assert.equal(JSON.parse(materialised.stdout).counts.added, 1);
    assert.match(readFileSync(resolve(root, 'SPECS/5.Strategy/patterns/revalidate-evidence.md'), 'utf8'), /Provenance/);

    const status = runCli(root, ['knowledge', 'status', recording.bundleId, '--json']);
    assert.equal(status.status, 0, status.stderr);
    const workspace = JSON.parse(status.stdout);
    assert.equal(workspace.selectedBundleId, recording.bundleId);
    assert.equal(workspace.materialisation.idempotent, false);
    assert.equal(workspace.notices.includes(disclaimer), true);
    assert.equal('modelContext' in workspace, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('knowledge CLI guards project-local inputs and unknown operations', () => {
  const root = projectFixture();
  try {
    const outside = resolve(tmpdir(), `ewai-outside-${process.pid}.json`);
    writeFileSync(outside, '{}\n');
    const unsafe = runCli(root, ['knowledge', 'record', 'retrospective:sprint-24', '--input', outside, '--json']);
    assert.equal(unsafe.status, 1);
    assert.match(JSON.parse(unsafe.stderr).error, /project-relative/);
    rmSync(outside, { force: true });
    const unknown = runCli(root, ['knowledge', 'connect', '--json']);
    assert.equal(unknown.status, 1);
    assert.match(JSON.parse(unknown.stderr).error, /Unknown knowledge command/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
