import test from 'node:test';
import assert from 'node:assert/strict';
import {assertModelPolicy,resolveCodingProviders,assertCodingPolicyFresh} from '../src/coding-providers.mjs';
import {buildProviderInvocation} from '../src/runtime/provider-adapters.mjs';
import {effectiveValidationConfig} from '../src/validation-config.mjs';
test('automatic roles skip unsupported model restrictions without weakening explicit boundaries',()=>{
  const policy={pool:['codex','claude','grok'],primary:'auto',secondary:'auto',tertiary:'off',models:{codex:{permitted_models:['fixture']}}};
  const selected=resolveCodingProviders(policy,{available:['codex','claude','grok']});
  assert.equal(selected.primary,'claude');assert.deepEqual(selected.reviewers,['grok']);
  assert.throws(()=>resolveCodingProviders({...policy,primary:'codex',secondary:'off'},{available:['codex','claude','grok']}),/cannot enforce/);
  assert.throws(()=>resolveCodingProviders({...policy,pool:['codex'],secondary:'off'},{available:['codex']}),/cannot enforce/);
  const review=resolveCodingProviders({...policy,primary:'grok'},{available:['codex','claude','grok']});assert.deepEqual(review.reviewers,['claude']);
});
test('external review preparation rejects unsupported model boundaries before handing off requests',()=>{
  const config={coding_providers:{pool:['codex','grok'],primary:'codex',secondary:'grok',tertiary:'off',models:{grok:{permitted_models:['fixture']}}},
    validation:{external:{providers:{codex:{state:'available',enabled:true},grok:{state:'available',enabled:true}}}}};
  assert.throws(()=>effectiveValidationConfig(config,'codex'),/cannot enforce/);
});
test('PTS-003 unsupported restriction stops before process launch',()=>{
  const policy={models:{grok:{permitted_models:['fixture-model']}}};
  assert.throws(()=>assertModelPolicy('grok',policy),/cannot enforce|unsupported|enforcement/i);
  assert.throws(()=>buildProviderInvocation('codex',{cwd:'.',prompt:'test',codingPolicy:{models:{codex:{permitted_models:['fixture-model']}}}}),/cannot enforce|unsupported|enforcement/i);
});
test('PTS-014 automatic provider choice cannot expand approved grant',()=>{
  assert.throws(()=>resolveCodingProviders({pool:['grok'],primary:'auto',secondary:'off',tertiary:'off'},{available:['grok'],allowedProviders:['codex'],orchestrator:'codex'}),/eligible|approved|available/i);
});
test('PTS-015 policy or identity drift prevents stale execution result',()=>{
  const opts={available:['codex','grok'],orchestrator:'codex',reviewers:['grok']};const a=resolveCodingProviders({primary:'codex'},opts),b=resolveCodingProviders({primary:'grok'},opts);
  assert.doesNotThrow(()=>assertCodingPolicyFresh(a.policyDigest,a.policyDigest));assert.throws(()=>assertCodingPolicyFresh(a.policyDigest,b.policyDigest),/changed|stale|policy/i);
});
test('native AFK models remain unchanged and suggestions are advisory',()=>{
  const invocation=buildProviderInvocation('codex',{cwd:'.',prompt:'test',codingPolicy:{models:{codex:{suggestion:'fixture-model'}}}});
  assert.equal(invocation.args.includes('--model'),false);assert.match(invocation.prompt,/advisory.*fixture-model|fixture-model.*advisory/i);
});
