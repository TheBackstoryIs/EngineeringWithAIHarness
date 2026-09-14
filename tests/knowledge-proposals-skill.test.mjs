import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';

const root = resolve(import.meta.dirname, '..');
const disclaimer = 'Security validation is evidence, not certification or proof that this system is secure. Tools can miss vulnerabilities and produce false positives. A qualified human must review the scope, findings, limitations and residual risk before release.';

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

test('knowledge proposals skill defines the source, persona, proposal, review and materialisation workflow', () => {
  const skillPath = 'skills-src/ewai-knowledge-proposals/SKILL.md';
  const referencePath = 'skills-src/ewai-knowledge-proposals/references/proposal-contract.md';
  const metadataPath = 'skills-src/ewai-knowledge-proposals/agents/openai.yaml';
  assert.equal(existsSync(resolve(root, skillPath)), true);
  assert.equal(existsSync(resolve(root, referencePath)), true);
  assert.equal(existsSync(resolve(root, metadataPath)), true);

  const skill = read(skillPath);
  const reference = read(referencePath);
  const metadata = YAML.parse(read(metadataPath));
  assert.match(skill, /^---\nname: ewai-knowledge-proposals\n/);
  assert.match(skill, /knowledge sources/);
  assert.match(skill, /knowledge prepare/);
  assert.match(skill, /knowledge record/);
  assert.match(skill, /knowledge review/);
  assert.match(skill, /knowledge materialise/);
  assert.match(skill, /knowledge recover/);
  assert.match(skill, /promoted meeting evidence.+retrospective/is);
  assert.match(skill, /standard (?:host )?(?:LLM|model).+complete baseline/is);
  assert.match(skill, /project.+core.+premium.+personal/is);
  assert.match(skill, /active persona.+name.+tier.+engagement reason/is);
  assert.doesNotMatch(skill, /persona premium sync|premium persona (?:sync|download|update)/i);
  assert.match(skill, /observation.+interpretation/is);
  assert.match(skill, /named review.+separate.+named.+materialisation/is);
  assert.match(skill, /additive.+identical.+conflict/is);
  assert.match(skill, /raw model output.+never.+stor/is);
  assert.match(skill, /Refined.+out of scope/is);
  assert.equal(skill.includes(disclaimer), true);

  assert.match(reference, /ewai\.knowledge-proposal-bundle\/v1/);
  assert.match(reference, /KNP-###/);
  assert.match(reference, /project-persona.+system.+process.+data-concept/is);
  assert.match(reference, /accepted.+rejected.+amended.+deferred/is);
  assert.match(reference, /SPECS\/3\.Evidence\/knowledge-proposals/);
  assert.match(reference, /sourceDigest/);

  assert.equal(metadata.interface.display_name, 'Knowledge Proposals');
  assert.match(metadata.interface.default_prompt, /\$ewai-knowledge-proposals/);
});

test('knowledge proposal guides separate operation, implementation and Manual QA authority', () => {
  const user = read('Docs/knowledge-proposals-user-guide.md');
  const implementer = read('Docs/knowledge-proposals-implementer-guide.md');
  const qa = read('Docs/quality/manual-qa-and-acceptance.md');
  const docsIndex = read('Docs/README.md');
  const guideCatalogue = read('Docs/guide-catalogue.md');
  const cliReference = read('Docs/reference/cli-and-configuration.md');
  const readme = read('README.md');

  for (const guide of [user, implementer]) {
    assert.match(guide, /review.+source|source.+review/is);
    assert.match(guide, /retrospective/i);
    assert.match(guide, /active persona/i);
    assert.match(guide, /named review/i);
    assert.match(guide, /separate.+materialisation/is);
    assert.doesNotMatch(guide, /Refined/);
    assert.match(guide, /recover.+digest/is);
  }
  assert.match(user, /raw transcript.+(?:isn't|is not) an eligible source/is);
  assert.match(user, /doesn't fetch material from an external connector/i);
  assert.match(user, /edited files.+untouched/is);
  assert.match(implementer, /KNOWLEDGE_RECOVERY_REQUIRES_REVIEW/);
  assert.match(user, /Mind Palace.+Knowledge proposals/is);
  assert.match(user, /prepare.+record.+review.+materialise/is);
  assert.match(implementer, /CLI.+MCP.+HTTP/is);
  assert.match(implementer, /ewai\.knowledge-proposals\.materialised/);
  assert.match(implementer, /idempotent|idempotency/i);
  assert.match(implementer, /no.+connector|connectors.+not/is);
  assert.match(qa, /Manual QA/i);
  assert.match(qa, /separate human gate/i);
  assert.match(qa, /green pipeline cannot approve it automatically/i);
  assert.match(docsIndex, /guide-catalogue\.md/);
  assert.match(guideCatalogue, /knowledge-proposals-user-guide/);
  assert.match(guideCatalogue, /knowledge-proposals-implementer-guide/);
  assert.match(cliReference, /ewai knowledge sources/);
  assert.match(cliReference, /ewai knowledge materialise/);
  assert.ok(readme.includes('Docs/guide-catalogue.md'));
  assert.ok(guideCatalogue.includes('knowledge-proposals-user-guide.md'));
});
