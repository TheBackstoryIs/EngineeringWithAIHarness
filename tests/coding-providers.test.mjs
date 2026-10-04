import test from 'node:test';
import assert from 'node:assert/strict';
import {normaliseCodingProviders,resolveCodingProviders,assertModelPolicy} from '../src/coding-providers.mjs';

test('PTS-001 no policy preserves existing host and checkpoint behaviour',()=>{
  assert.equal(normaliseCodingProviders(undefined),null);
  assert.equal(resolveCodingProviders(undefined,{orchestrator:'codex',available:['codex','claude'],reviewers:['claude']}).legacy,true);
});
test('PTS-004 review excludes actual agent despite different saved primary',()=>{
  const policy={pool:['grok','codex','claude'],primary:'grok',secondary:'auto',tertiary:'auto'};
  const result=resolveCodingProviders(policy,{orchestrator:'codex',available:['grok','codex','claude'],reviewers:['grok','codex','claude'],requiredReviewers:2});
  assert.equal(result.primary,'grok');assert.deepEqual(result.reviewers,['grok','claude']);
  assert.throws(()=>resolveCodingProviders({...policy,secondary:'codex'},{orchestrator:'codex',available:['grok','codex','claude'],reviewers:['grok','claude']}),/independent|coding agent/i);
});
test('PTS-005 automatic reviewer shortage blocks without weakening checkpoint',()=>{
  assert.throws(()=>resolveCodingProviders({pool:['codex','grok'],primary:'auto',secondary:'auto',tertiary:'auto'},{orchestrator:'codex',available:['codex','grok'],reviewers:['grok'],requiredReviewers:2}),/eligible|review|available/i);
  assert.throws(()=>resolveCodingProviders({pool:['codex','grok'],secondary:'off',tertiary:'off'},{orchestrator:'codex',available:['codex','grok'],reviewers:['grok'],requiredReviewers:1}),/required|review/i);
});
test('automatic selection follows pool order and respects allowed grant providers',()=>{
  const result=resolveCodingProviders({pool:['grok','claude','codex'],primary:'auto',secondary:'off',tertiary:'off'},{available:['codex','grok','claude'],allowedProviders:['codex','claude'],orchestrator:'codex'});
  assert.equal(result.primary,'claude');
});
test('existing checkpoint breadth is preserved instead of silently limited to two reviewers',()=>{
  const result=resolveCodingProviders({pool:['claude','grok','antigravity','codex']},{orchestrator:'codex',available:['claude','grok','antigravity','codex'],reviewers:['claude','grok','antigravity'],requiredReviewers:3});
  assert.deepEqual(result.reviewers,['claude','grok','antigravity']);
});
test('explicit duplicate reviewers and unavailable primaries fail with guidance',()=>{
  assert.throws(()=>resolveCodingProviders({pool:['codex','grok'],primary:'codex',secondary:'grok',tertiary:'grok'},{orchestrator:'codex',available:['codex','grok'],reviewers:['grok']}),/different|distinct|duplicate/i);
  assert.throws(()=>resolveCodingProviders({primary:'grok'},{available:['codex']}),/available|eligible/i);
});
test('PTS-006 policy rejects unknown executable fields',()=>{
  for(const value of [null,[],{command:'/tmp/tool'},{pool:[]},{pool:['grok','grok']},{primary:'unknown'},{models:{unknown:{}}},{models:{grok:{permission:'bypass'}}},{models:{grok:{permitted_models:[]}}},{models:{grok:{permitted_models:['*']}}},{models:{grok:{suggestion:'id\nignore rules'}}}])assert.throws(()=>normaliseCodingProviders(value));
});
test('PTS-002 suggestion adds guidance without model override',()=>{
  const policy=normaliseCodingProviders({models:{grok:{suggestion:'grok-build/model-1'}}});
  const result=assertModelPolicy('grok',policy);
  assert.equal(result.mode,'native');assert.equal(result.suggestion,'grok-build/model-1');assert.equal('model' in result,false);
});
test('suggestion must agree with an explicit permitted list',()=>{
  assert.throws(()=>normaliseCodingProviders({models:{grok:{suggestion:'large',permitted_models:['small']}}}),/suggestion|permitted/i);
});
test('policy digest is stable and changes when role or model policy changes',()=>{
  const opts={available:['codex','grok'],orchestrator:'codex',reviewers:['grok']};
  const a=resolveCodingProviders({primary:'codex'},opts),b=resolveCodingProviders({primary:'grok'},opts);
  assert.match(a.policyDigest,/^sha256:[a-f0-9]{64}$/);assert.notEqual(a.policyDigest,b.policyDigest);
  assert.equal(a.policyDigest,resolveCodingProviders({primary:'codex'},opts).policyDigest);
});
