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

test('meeting evidence skill defines the permission, persona, extraction, review and promotion workflow', () => {
  const skillPath = 'skills-src/ewai-meeting-evidence/SKILL.md';
  const referencePath = 'skills-src/ewai-meeting-evidence/references/candidate-contract.md';
  const metadataPath = 'skills-src/ewai-meeting-evidence/agents/openai.yaml';
  assert.equal(existsSync(resolve(root, skillPath)), true);
  assert.equal(existsSync(resolve(root, referencePath)), true);
  assert.equal(existsSync(resolve(root, metadataPath)), true);

  const skill = read(skillPath);
  const reference = read(referencePath);
  const metadata = YAML.parse(read(metadataPath));
  assert.match(skill, /^---\nname: ewai-meeting-evidence\n/);
  assert.match(skill, /meeting register/);
  assert.match(skill, /meeting prepare/);
  assert.match(skill, /meeting review/);
  assert.match(skill, /meeting promote/);
  assert.match(skill, /cloud processing.+(?:denied|unknown)/is);
  assert.match(skill, /do not (?:open|inspect|read).+source/is);
  assert.match(skill, /standard (?:host )?(?:LLM|model).+complete baseline/is);
  assert.match(skill, /active persona.+name.+tier.+engagement reason/is);
  assert.match(skill, /project.+core.+premium.+personal/is);
  assert.match(skill, /premium.+installed/is);
  assert.doesNotMatch(skill, /persona premium sync|premium persona (?:sync|download|update)/i);
  assert.match(skill, /observedStatement/);
  assert.match(skill, /interpretation/);
  assert.match(skill, /lineAnchors/);
  assert.match(skill, /named review/i);
  assert.match(skill, /evidence-only/i);
  assert.match(skill, /Refined.+out of scope/is);
  assert.equal(skill.includes(disclaimer), true);

  assert.match(reference, /ewai\.meeting-candidate-bundle\/v1/);
  assert.match(reference, /MEC-###/);
  assert.match(reference, /accepted.+rejected.+amended.+deferred/is);
  assert.match(reference, /raw source excerpts.+not allowed/is);
  assert.match(reference, /sourceDigest/);

  assert.equal(metadata.interface.display_name, 'Meeting Evidence');
  assert.match(metadata.interface.default_prompt, /\$ewai-meeting-evidence/);
});

test('meeting evidence guides separate user operation, implementation and human QA authority', () => {
  const user = read('Docs/meeting-evidence-user-guide.md');
  const implementer = read('Docs/meeting-evidence-implementer-guide.md');
  const qa = read('Docs/quality/manual-qa-and-acceptance.md');
  const docsIndex = read('Docs/README.md');
  const guideCatalogue = read('Docs/guide-catalogue.md');
  const cliReference = read('Docs/reference/cli-and-configuration.md');
  const readme = read('README.md');

  for (const guide of [user, implementer]) {
    assert.match(guide, /source.+permission|permission.+source/is);
    assert.match(guide, /raw transcript|raw meeting material/i);
    assert.match(guide, /active persona/i);
    assert.match(guide, /named (?:reviewer|review)/i);
    assert.doesNotMatch(guide, /Refined/);
  }
  assert.match(user, /does not connect.+does not transcribe/is);
  assert.match(user, /Mind Palace.+Meeting evidence/is);
  assert.match(user, /register.+prepare.+review.+promote/is);
  assert.match(implementer, /CLI.+MCP.+HTTP/is);
  assert.match(implementer, /ewai\.meeting-evidence\.promoted/);
  assert.match(implementer, /idempotent|idempotency/i);
  assert.match(implementer, /no.+connector|connectors.+not/is);
  assert.match(qa, /Manual QA/i);
  assert.match(qa, /separate human gate/i);
  assert.match(qa, /green pipeline cannot approve it automatically/i);
  assert.match(docsIndex, /guide-catalogue\.md/);
  assert.match(guideCatalogue, /meeting-evidence-user-guide/);
  assert.match(guideCatalogue, /meeting-evidence-implementer-guide/);
  assert.match(cliReference, /ewai meeting register/);
  assert.match(cliReference, /ewai meeting promote/);
  assert.match(readme, /Meeting evidence/);
});
