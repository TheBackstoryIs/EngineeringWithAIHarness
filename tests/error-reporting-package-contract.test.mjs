import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('packages a local-first error-reporting skill with explicit custody boundaries', () => {
  const skillPath = 'skills-src/ewai-error-reporting/SKILL.md';
  const providerContractPath = 'skills-src/ewai-error-reporting/references/provider-contract.md';
  const metadataPath = 'skills-src/ewai-error-reporting/agents/openai.yaml';
  assert.equal(existsSync(resolve(root, skillPath)), true);
  assert.equal(existsSync(resolve(root, providerContractPath)), true);
  assert.equal(existsSync(resolve(root, metadataPath)), true);

  const skill = read(skillPath);
  const provider = read(providerContractPath);
  assert.match(skill, /^---\nname: ewai-error-reporting\n/);
  assert.match(skill, /\.ewai-pipeline\/error-reports/);
  assert.match(skill, /automatic local draft/i);
  assert.match(skill, /inspect.+before.+finalis/is);
  assert.match(skill, /prepared-not-sent/);
  assert.match(skill, /attach.+ZIP manually/is);
  assert.match(skill, /exact.+digest/is);
  assert.match(skill, /never.+claim.+sent/is);
  assert.match(skill, /provider.+trusted local code/is);
  assert.match(skill, /no hosted service/i);

  assert.match(provider, /ewai\.error-report-provider\/v1/);
  assert.match(provider, /ewai\.error-report-submission\/v1/);
  assert.match(provider, /ewai\.error-report-provider-ack\/v1/);
  assert.match(provider, /stdin/i);
  assert.match(provider, /stdout/i);
  assert.match(provider, /archiveDigest/);
  assert.match(provider, /same-version.+digest drift/is);
  assert.match(provider, /trusted local code/i);
});

test('ships user, provider and CLI guidance without requiring a reporting service', () => {
  const userGuide = read('Docs/error-reporting-guide.md');
  const providerGuide = read('Docs/error-reporting-provider-guide.md');
  const cliReference = read('Docs/cli-reference.md');
  const docsIndex = read('Docs/README.md');
  const readme = read('README.md');

  for (const content of [userGuide, providerGuide, cliReference]) {
    assert.match(content, /local/i);
    assert.match(content, /no (?:paid|hosted|reporting) service/i);
  }
  assert.match(userGuide, /Error Reporting.+dashboard/is);
  assert.match(userGuide, /Report this problem/i);
  assert.match(userGuide, /prepared-not-sent/);
  assert.match(userGuide, /attach.+manually/is);
  assert.match(userGuide, /automatic local drafts.+opt-in/is);
  assert.match(userGuide, /not.+production monitoring/is);
  assert.match(providerGuide, /generic provider adapter/i);
  assert.match(providerGuide, /registration.+does not execute/is);
  assert.match(providerGuide, /receipt.+transport.+not.+resolution/is);
  assert.match(cliReference, /error-report create/);
  assert.match(cliReference, /error-report prepare-email/);
  assert.match(cliReference, /error-report send/);
  assert.match(docsIndex, /error-reporting-guide\.md/);
  assert.ok(readme.includes('Docs/README.md'));
  assert.match(docsIndex, /error-reporting-guide\.md/);
});
