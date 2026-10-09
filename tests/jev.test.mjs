import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync,writeFileSync } from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { readJevSettings, saveJevSettings, evaluateJev, readJevMeasurements } from '../src/jev.mjs';
const key='apikey_synthetic-fixture-not-a-real-key';
function fixture(t){const container=mkdtempSync(resolve(tmpdir(),'ewai-jev-')),root=resolve(container,'project'),home=resolve(container,'home');mkdirSync(root);mkdirSync(home,{mode:0o700});t.after(()=>rmSync(container,{recursive:true,force:true}));return {root,home,env:{TYPESAFE_API_KEY:key}};}
function enable(f,patch={}){const current=readJevSettings(f.root);return saveJevSettings(f.root,{confirmed:true,expectedRevision:current.revision,policy:{...current.policy,mode:'shadow',cloudConsent:true,useCases:['claim'],...patch}});}
const input={useCase:'claim',source:'synthetic',state:{claim:'A',evidence:'B'},questions:{decision:{type:'choice',instructions:'Relationship?',criteria:{supports:'Supports',insufficient:'Not established'}}}};
const body=()=>({model:'jev-1.13.0',answers:{decision:{type:'choice',choice:'insufficient',probabilities:{supports:0.01,insufficient:0.99},confidence:0.99}},usage:{input_tokens:100,output_tokens:10}});
test('absent/off/no-consent/disabled use case/missing key perform zero inference calls',async t=>{
 const f=fixture(t);let calls=0;const fetchImpl=async()=>{calls++;return new Response(JSON.stringify(body()));};
 assert.equal((await evaluateJev(f.root,input,{...f,fetchImpl})).status,'disabled');assert.equal(calls,0);
 assert.throws(()=>enable(f,{cloudConsent:false}));enable(f,{useCases:['personas']});assert.equal((await evaluateJev(f.root,input,{...f,fetchImpl})).status,'disabled');
 enable(f);assert.equal((await evaluateJev(f.root,input,{...f,env:{},fetchImpl})).reason,'missing-key');assert.equal(calls,0);
});
test('closed confirmed policy rejects stale/unsafe writes and keeps predecessor',t=>{
 const f=fixture(t),saved=enable(f);assert.throws(()=>saveJevSettings(f.root,{confirmed:true,expectedRevision:'missing',policy:saved.policy}),/changed/);
 for(const patch of [{endpoint:'https://outside.invalid'},{mode:'magic'},{useCases:['required-test-skip']},{maxCalls:0},{maxInputTokens:1},{timeoutMs:0},{minConfidence:2}])assert.throws(()=>enable(f,patch));
 assert.throws(()=>saveJevSettings(f.root,{confirmed:false,expectedRevision:saved.revision,policy:saved.policy}));assert.equal(readJevSettings(f.root).revision,saved.revision);
 const elsewhere=resolve(f.root,'elsewhere');mkdirSync(elsewhere);const loc=resolve(f.root,'.ewai-pipeline/jev.json');rmSync(loc);symlinkSync(resolve(elsewhere,'target'),loc);assert.throws(()=>readJevSettings(f.root));
});
test('fixed typed call returns advisory answers, safe usage and exact cache without repeated cost',async t=>{
 const f=fixture(t);enable(f);let calls=0;const fetchImpl=async(url,init)=>{calls++;assert.equal(url,'https://api.typesafe.ai/v1/systemone');assert.equal(init.redirect,'manual');assert.equal(init.headers.authorization,'Bearer '+key);assert.equal(JSON.parse(init.body).model,'jev-1.13.0');return new Response(JSON.stringify(body()));};
 const first=await evaluateJev(f.root,input,{...f,fetchImpl});assert.equal(first.status,'suggested');assert.equal(first.mode,'shadow');assert.equal(first.answers.decision.choice,'insufficient');assert.equal(first.measurement.inputTokens,100);
 const second=await evaluateJev(f.root,input,{...f,fetchImpl});assert.equal(second.cacheHit,true);assert.equal(calls,1);assert.equal(second.measurement.estimatedUSD,0);
 const measurements=readJevMeasurements(f.root);assert.equal(measurements.summary.providerCalls,1);assert.equal(measurements.summary.inputTokens,100);assert.equal(measurements.summary.downstreamSavings,null);
 const contents=readdirSync(resolve(f.root,'.ewai-pipeline/runtime/jev')).filter(n=>n.endsWith('.json')).map(n=>readFileSync(resolve(f.root,'.ewai-pipeline/runtime/jev',n),'utf8')).join('');assert.ok(!contents.includes(key));assert.ok(!contents.includes('Relationship?'));assert.ok(!contents.includes('"evidence":"B"'));
});
test('unknown/denied material and secret patterns never leave the process',async t=>{
 const f=fixture(t);enable(f);let calls=0;const fetchImpl=async()=>{calls++;return new Response(JSON.stringify(body()));};
 for(const source of ['unknown','cloud-denied','imported'])assert.equal((await evaluateJev(f.root,{...input,source},{...f,fetchImpl})).reason,'source-ineligible');
 for(const state of [key,'Authorization: Bearer secret-value','-----BEGIN '+'PRIVATE KEY-----'])assert.equal((await evaluateJev(f.root,{...input,state},{...f,fetchImpl})).reason,'sensitive-input');assert.equal(calls,0);
});
test('provider failures, redirects and raw diagnostics produce bounded safe fallback',async t=>{
 for(const httpStatus of [302,401,403,422,429,529]){
  const f=fixture(t);enable(f);
  const result=await evaluateJev(f.root,{...input,state:{nonce:httpStatus}},{...f,fetchImpl:async()=>new Response(key,{status:httpStatus})});assert.equal(result.reason,'http-'+httpStatus);assert.ok(!JSON.stringify(result).includes(key));
 }
 const f=fixture(t);enable(f);const result=await evaluateJev(f.root,{...input,state:'different'},{...f,fetchImpl:async()=>{throw Error(key);}});assert.equal(result.status,'fallback');assert.ok(!JSON.stringify(result).includes(key));
});
test('hung fetch and hung body are both covered by the operation deadline',async t=>{
 for(const fetchImpl of [()=>new Promise(()=>{}),async()=>new Response(new ReadableStream({start(){}}))]){
  const f=fixture(t);enable(f,{timeoutMs:100});
  const start=Date.now(),result=await evaluateJev(f.root,input,{...f,fetchImpl});assert.equal(result.reason,'timeout');assert.ok(Date.now()-start<2000);
 }
});
test('answer/model/distribution/usage validation fails closed and missing cost stays unknown',async t=>{
 for(const mutate of [v=>v.model='unrequested',v=>v.answers.decision.choice='invented',v=>v.answers.decision.probabilities.insufficient=0.2,v=>delete v.answers.decision.probabilities.supports,v=>v.answers.decision.confidence=2,v=>delete v.usage,v=>v.usage.input_tokens=-1,v=>v.answers.extra=v.answers.decision]){
  const f=fixture(t);enable(f);const v=body();mutate(v);const result=await evaluateJev(f.root,input,{...f,fetchImpl:async()=>new Response(JSON.stringify(v))});assert.equal(result.status,'fallback');assert.equal(result.answers,undefined);if(!v.usage||v.usage.input_tokens<0)assert.equal(readJevMeasurements(f.root).summary.estimatedUSD,null);
 }
 const f=fixture(t);enable(f);const v=body();v.answers.decision.confidence=0.1;assert.equal((await evaluateJev(f.root,input,{...f,fetchImpl:async()=>new Response(JSON.stringify(v))})).reason,'low-confidence');
});
test('atomic call reservation prevents concurrent budget overrun and changed policy rejects in-flight advice',async t=>{
 const f=fixture(t);enable(f,{maxCalls:1});let release,calls=0;const fetchImpl=()=>{calls++;return new Promise(r=>{release=()=>r(new Response(JSON.stringify(body())));});};
 const pending=evaluateJev(f.root,input,{...f,fetchImpl});await new Promise(r=>setImmediate(r));assert.equal((await evaluateJev(f.root,{...input,state:'second'},{...f,fetchImpl})).reason,'budget-exhausted');assert.equal(calls,1);
 enable(f,{mode:'off'});release();const result=await pending;assert.equal(result.reason,'policy-changed');assert.equal(result.answers,undefined);
});
test('strict score and noul shapes can evaluate typed questions without generating text',async t=>{
 const f=fixture(t);enable(f);const request={...input,questions:{score:{type:'score',instructions:'Relevance',criteria:['unrelated','relevant']},flag:{type:'noul',instructions:'Relevant?'}}};
 const value={model:'jev-1.13.0',answers:{score:{type:'score',score:0.99,legend:{'0':'unrelated','1':'relevant'},probabilities:{'0':0.01,'1':0.99},confidence:0.9},flag:{type:'noul',noul:0.99}},usage:{input_tokens:100,output_tokens:10}};
 assert.equal((await evaluateJev(f.root,request,{...f,fetchImpl:async()=>new Response(JSON.stringify(value))})).status,'suggested');
});
test('structured, nested and encoded JSON credentials are refused before network',async t=>{
 const f=fixture(t);enable(f);let calls=0;const fetchImpl=()=>{calls++;throw Error('must not call');};
 for(const state of [{password:'hunter2'},{nested:{api_key:'private-value'}},JSON.stringify({password:'hunter2'}),JSON.stringify(JSON.stringify({password:'hunter2'})),'diagnostic '+JSON.stringify({access_token:'private-value'}),'"pa\\u0073sword":"hunter2"']){
  const result=await evaluateJev(f.root,{...input,state},{...f,fetchImpl});assert.equal(result.reason,'sensitive-input',JSON.stringify(state));
 }assert.equal(calls,0);
});
test('a killed worker leaves unresolved usage unknown and prevents additional paid requests', {timeout:10000},async t=>{
 const f=fixture(t);enable(f);const script=resolve(f.root,'worker.mjs');
 writeFileSync(script,`import {evaluateJev} from ${JSON.stringify(new URL('../src/jev.mjs',import.meta.url).href)}; await evaluateJev(process.env.JEV_TEST_PROJECT,${JSON.stringify(input)},{home:process.env.JEV_TEST_HOME,env:{TYPESAFE_API_KEY:'apikey_synthetic-crash-fixture-key'},fetchImpl:async()=>{process.send('dispatched');return new Promise(()=>{});}});`);
 const child=spawn(process.execPath,[script],{env:{...process.env,JEV_TEST_PROJECT:f.root,JEV_TEST_HOME:f.home},stdio:['ignore','ignore','ignore','ipc']});t.after(()=>child.kill('SIGKILL'));await once(child,'message');const exit=once(child,'exit');child.kill('SIGKILL');await exit;
 const measurements=readJevMeasurements(f.root);assert.equal(measurements.summary.unresolvedCalls,1);assert.equal(measurements.summary.estimatedUSD,null);
 const result=await evaluateJev(f.root,input,{...f,fetchImpl:()=>{throw Error('must not call');}});assert.equal(result.reason,'budget-exhausted');
 enable(f);assert.equal(readJevMeasurements(f.root).summary.estimatedUSD,null);
});

test('the same environment credential reuses an exact cached request across consumer processes',async t=>{
 const f=fixture(t);enable(f);await evaluateJev(f.root,input,{...f,fetchImpl:async()=>new Response(JSON.stringify(body()))});
 const script=resolve(f.root,'cached.mjs');writeFileSync(script,`import {evaluateJev} from ${JSON.stringify(new URL('../src/jev.mjs',import.meta.url).href)};const result=await evaluateJev(process.env.JEV_TEST_PROJECT,${JSON.stringify(input)},{home:process.env.JEV_TEST_HOME,env:{TYPESAFE_API_KEY:'apikey_synthetic-fixture-not-a-real-key'},fetchImpl:()=>{throw Error('must not call');}});console.log(JSON.stringify({status:result.status,cacheHit:result.cacheHit}));`);
 const result=JSON.parse(execFileSync(process.execPath,[script],{encoding:'utf8',env:{...process.env,JEV_TEST_PROJECT:f.root,JEV_TEST_HOME:f.home}}));assert.equal(result.status,'suggested');assert.equal(result.cacheHit,true);assert.equal(readJevMeasurements(f.root).summary.providerCalls,1);
});
