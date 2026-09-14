import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('packages a provider-neutral evidence-separated rollout review skill', () => {
  const skillPath = resolve(import.meta.dirname, '../skills-src/ewai-rollout/SKILL.md');
  const referencePath = resolve(import.meta.dirname, '../skills-src/ewai-rollout/references/rollout-contract.md');

  assert.equal(existsSync(skillPath), true);
  assert.equal(existsSync(referencePath), true);

  const skill = readFileSync(skillPath, 'utf8');
  const reference = readFileSync(referencePath, 'utf8');

  assert.match(skill, /^---\nname: ewai-rollout\ndescription: [^\n]+\n---\n/);
  assert.match(skill, /rollout validate/);
  assert.match(skill, /rollout status/);
  assert.match(skill, /rollout assurance/);
  assert.match(skill, /active persona/i);
  assert.match(skill, /engagement reason/i);
  assert.match(skill, /standard (?:host )?(?:LLM|model)/i);
  assert.match(skill, /premium.+installed/is);
  assert.match(skill, /persona-hypothesis/);
  assert.match(skill, /human-decision/);
  assert.match(skill, /approve Build|Build approval/i);
  assert.match(skill, /certif/i);
  assert.doesNotMatch(skill, /premium persona (?:sync|download)/i);

  assert.match(reference, /ewai\.rollout-workspace\/v1/);
  for (const state of ['aligned', 'review-required', 'not-adopted', 'unavailable', 'stale', 'invalid']) {
    assert.match(reference, new RegExp(`\\b${state}\\b`));
  }
  for (const evidenceClass of ['declared-policy', 'observed-project-evidence', 'automated-check', 'persona-hypothesis', 'human-decision']) {
    assert.match(reference, new RegExp(evidenceClass));
  }
});

test('documents every rollout topology, persona rule, recovery state, and authority boundary', () => {
  const guidePath = resolve(import.meta.dirname, '../Docs/consultancy-network-rollout-control-plane-guide.md');
  assert.equal(existsSync(guidePath), true);
  const guide = readFileSync(guidePath, 'utf8');

  assert.match(guide, /single repository/i);
  assert.match(guide, /monorepo/i);
  assert.match(guide, /folder.+repository subfolders/is);
  assert.match(guide, /several separately configured repositories/i);
  assert.match(guide, /exact Blueprint ID and version/i);
  assert.match(guide, /premium.+already installed/is);
  assert.match(guide, /Isolation and redaction/);
  assert.match(guide, /Recovery/);
  assert.match(guide, /does not approve Build or Manual QA/i);
  assert.match(guide, /Rollout and persona analysis is advisory\./);
  assert.match(guide, /Security validation is evidence, not certification or proof that this system is secure\./);
});
