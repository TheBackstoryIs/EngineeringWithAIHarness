import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const skillPath = resolve(root, 'skills-src/ewai-portfolio/SKILL.md');
const agentPath = resolve(root, 'skills-src/ewai-portfolio/agents/openai.yaml');
const referencePath = resolve(root, 'skills-src/ewai-portfolio/references/portfolio-contract.md');
const guidePath = resolve(root, 'Docs/project-portfolio-orchestration-guide.md');

test('packages a provider-neutral evidence-separated portfolio review skill', () => {
  assert.equal(existsSync(skillPath), true);
  assert.equal(existsSync(agentPath), true);
  assert.equal(existsSync(referencePath), true);

  const skill = readFileSync(skillPath, 'utf8');
  const agent = readFileSync(agentPath, 'utf8');
  const reference = readFileSync(referencePath, 'utf8');

  assert.match(skill, /^---\nname: ewai-portfolio\n/);
  assert.match(skill, /ewai portfolio status/);
  assert.match(skill, /ewai_portfolio_status/);
  assert.match(skill, /standard (?:host )?(?:LLM|model)/i);
  assert.match(skill, /project.+core personas/is);
  assert.match(skill, /active persona.+name.+tier.+matched.+engagement reason/is);
  assert.match(skill, /declared.+observed.+inferred.+persona-hypothesis.+human-decision/is);
  assert.match(skill, /premium.+installed.+relevant/is);
  assert.match(skill, /named accountable human/i);
  assert.match(skill, /advisory/i);
  assert.doesNotMatch(skill, /premium persona (?:sync|download)/i);
  assert.doesNotMatch(skill, /imitat(?:e|ing).+premium/i);

  assert.match(agent, /EWAI Portfolio/);
  assert.match(agent, /\$ewai-portfolio/);
  assert.match(reference, /ewai\.portfolio-workspace\/v1/);
  assert.match(reference, /declared/);
  assert.match(reference, /persona-hypothesis/);
  assert.match(reference, /human-decision/);
  assert.match(reference, /Security validation is evidence, not certification/);
});

test('documents every supported topology, workflow and recovery boundary', () => {
  assert.equal(existsSync(guidePath), true);
  const guide = readFileSync(guidePath, 'utf8');
  const docsIndex = readFileSync(resolve(root, 'Docs/README.md'), 'utf8');
  const guideCatalogue = readFileSync(resolve(root, 'Docs/guide-catalogue.md'), 'utf8');
  const cliReference = readFileSync(resolve(root, 'Docs/reference/cli-and-configuration.md'), 'utf8');
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');

  assert.match(guide, /single repository/i);
  assert.match(guide, /monorepo/i);
  assert.match(guide, /folder containing multiple Git repositories/i);
  assert.match(guide, /separate configured repositories/i);
  assert.match(guide, /schema:\s+ewai\.portfolio\/v1/);
  assert.match(guide, /ewai portfolio validate/);
  assert.match(guide, /ewai portfolio status/);
  assert.match(guide, /Portfolio workspace/i);
  assert.match(guide, /standard (?:host )?(?:LLM|model)/i);
  assert.match(guide, /premium.+installed.+relevant/is);
  assert.match(guide, /missing.+stale.+disagreement.+unavailable/is);
  assert.match(guide, /duplicate-root|symbolic-path|unsafe-path/);
  assert.match(guide, /Portfolio findings aren't a security assessment/);
  assert.match(guide, /security-validation-guide\.md/);
  assert.doesNotMatch(guide, /Refined/);
  assert.match(guide, /does not include portfolio editing.+cross-project writes/is);
  assert.match(guide, /Enable \*\*Portfolio\*\* in \*\*Configuration\*\*/);

  assert.match(docsIndex, /guide-catalogue\.md/);
  assert.match(guideCatalogue, /project-portfolio-orchestration-guide\.md/);
  assert.match(cliReference, /ewai portfolio validate/);
  assert.match(cliReference, /project-portfolio-orchestration-guide\.md/);
  assert.ok(readme.includes('Docs/guide-catalogue.md'));
  assert.ok(guideCatalogue.includes('project-portfolio-orchestration-guide.md'));
});
