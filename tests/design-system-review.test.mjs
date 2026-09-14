import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const skillPath = 'skills-src/ewai-design-system-review/SKILL.md';
const referencePath = 'skills-src/ewai-design-system-review/references/review-contract.md';

test('review skill classifies receipt-based findings without claiming acceptance', () => {
  const skill = readFileSync(skillPath, 'utf8');
  const reference = readFileSync(referencePath, 'utf8');
  for (const phrase of ['immutable receipt', 'aligned', 'approved-deviation', 'unresolved', 'active persona', 'premium', 'project-local', 'personal']) {
    assert.match(`${skill}\n${reference}`.toLowerCase(), new RegExp(phrase));
  }
  for (const evidence of ['source inspection', 'rendered viewport', 'interaction', 'assistive-technology', 'user research', 'Manual QA', 'release']) {
    assert.match(`${skill}\n${reference}`, new RegExp(evidence, 'i'));
  }
  assert.match(skill, /missing evidence.+remain missing|mark.+absent/is);
  assert.match(skill, /must not.*premium persona bod|never.*premium persona bod/is);
  assert.match(skill, /must not.*(?:edit|change).*(?:installed|upstream).*pack|never.*(?:edit|change).*(?:installed|upstream).*pack/is);
  assert.match(skill, /does not approve|cannot approve/i);
  assert.doesNotMatch(skill, /TODO|Refined/);
});

test('review contract requires cited owner evidence for an approved deviation and routes reusable learning upstream as a proposal', () => {
  const reference = readFileSync(referencePath, 'utf8');
  assert.match(reference, /approved-deviation.+named accountable owner.+evidence/is);
  assert.match(reference, /reviewer cannot create|review cannot create/i);
  assert.match(reference, /proposal.+authoring cycle/is);
  assert.match(reference, /persona.+advisory/i);
});
