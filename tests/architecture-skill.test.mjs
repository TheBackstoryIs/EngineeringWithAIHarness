import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const skillRoot = resolve('skills-src/ewai-architecture');

test('defines a proposal-first conversational enterprise architecture process', () => {
  const skillPath = resolve(skillRoot, 'SKILL.md');
  const contractPath = resolve(skillRoot, 'references/architecture-contract.md');
  assert.equal(existsSync(skillPath), true);
  assert.equal(existsSync(contractPath), true);

  const skill = readFileSync(skillPath, 'utf8');
  const contract = readFileSync(contractPath, 'utf8');
  assert.match(skill, /whole (?:enterprise|solution)|whole solution/i);
  assert.match(skill, /bounded (?:aspect|capability|domain)/i);
  assert.match(skill, /ask one question at a time/i);
  assert.match(skill, /observed.*proposed.*accepted/is);
  assert.match(skill, /premium `enterprise-architect` persona/i);
  assert.match(skill, /proposals\/SPECS\//);
  assert.match(skill, /explicit approval/i);
  assert.match(skill, /never begin Build/i);
  assert.match(skill, /standards.*patterns.*ADR/is);

  for (const viewpoint of [
    'business and capability', 'domain and information', 'application and service',
    'integration', 'technology and deployment', 'security and trust',
    'operations and resilience', 'governance and evolution',
  ]) {
    assert.match(contract, new RegExp(viewpoint, 'i'));
  }
  assert.match(contract, /current state.*target state/is);
  assert.match(contract, /evidence ledger/i);
  assert.match(contract, /review ledger/i);
  assert.match(contract, /one individual record/i);
  assert.match(contract, /diagram.*text.*source/is);
  assert.match(contract, /SPECS\/4\.Constraints/);
  assert.match(contract, /SPECS\/5\.Strategy\/architecture/);
});

test('provides agent metadata for architecture walkthroughs', () => {
  const metadata = readFileSync(resolve(skillRoot, 'agents/openai.yaml'), 'utf8');
  assert.match(metadata, /display_name: "EWAI Architecture"/);
  assert.match(metadata, /\$ewai-architecture/);
});
