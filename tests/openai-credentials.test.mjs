import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,lstatSync,chmodSync,symlinkSync,rmSync,linkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {openaiCredentialStatus,configureOpenaiCredentials,checkOpenaiConnection,removeOpenaiCredentials,resolveOpenaiApiKey} from '../src/openai-credentials.mjs';

const key=('sk-'+'synthetic-fixture-not-a-real-key');
const other=('sk-'+'other-synthetic-fixture-not-a-real-key');
function fixture(t){const root=mkdtempSync(resolve(tmpdir(),'ewai-openai-credentials-')),home=resolve(root,'home'),projectRoot=resolve(root,'project');mkdirSync(home,{mode:0o700});mkdirSync(projectRoot);t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,home,projectRoot,env:{},fetchImpl:async()=>new Response('{"data":[]}')};}
const configure=(o,apiKey=key)=>configureOpenaiCredentials({confirmed:true,expectedRevision:openaiCredentialStatus(o).revision,apiKey},o);
test('private saved credential supports worker resolution without disclosure or project writes',async t=>{
 const o=fixture(t),before=openaiCredentialStatus(o);assert.equal(before.source,'missing');
 const saved=await configure(o);assert.equal(saved.source,'saved');assert.equal(saved.check.status,'verified');assert.ok(!JSON.stringify(saved).includes(key));
 assert.equal(resolveOpenaiApiKey(o),key);assert.equal(openaiCredentialStatus(o).revision,saved.revision);
 const path=resolve(o.home,'.ewai/credentials/openai.json');assert.equal(lstatSync(path).mode&0o777,0o600);assert.equal(lstatSync(resolve(o.home,'.ewai/credentials')).mode&0o777,0o700);
 assert.equal(readFileSync(path,'utf8').includes(key),true);assert.equal(saved.storage,'owner-only-local-file');
 const removed=removeOpenaiCredentials({confirmed:true,expectedRevision:saved.revision},o);assert.equal(removed.source,'missing');assert.equal(resolveOpenaiApiKey(o),null);
});
test('environment overrides saved key; removal touches only the saved credential',async t=>{
 const o=fixture(t);await configure(o);const withEnv={...o,env:{OPENAI_API_KEY:other}};assert.equal(resolveOpenaiApiKey(withEnv),other);
 const status=openaiCredentialStatus(withEnv);assert.equal(status.source,'environment');assert.equal(status.saved,true);assert.ok(!JSON.stringify(status).includes(other));
 const removed=removeOpenaiCredentials({confirmed:true,expectedRevision:status.revision},withEnv);assert.equal(removed.source,'environment');assert.equal(removed.saved,false);assert.equal(resolveOpenaiApiKey(withEnv),other);
});
test('connection check uses only fixed authenticated metadata endpoint, rejects redirects and suppresses provider diagnostics',async t=>{
 const o=fixture(t),calls=[];const fetchImpl=async(url,init)=>{calls.push({url,init});return new Response(key,{status:401});};
 const failure=await checkOpenaiConnection({...o,env:{OPENAI_API_KEY:key},fetchImpl});assert.equal(failure.code,'openai-key-rejected');assert.ok(!JSON.stringify(failure).includes(key));assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://api.openai.com/v1/models');assert.equal(calls[0].init.method,'GET');assert.equal(calls[0].init.redirect,'manual');assert.equal(calls[0].init.headers.authorization,'Bearer '+key);assert.equal(calls[0].init.body,undefined);
 for(const status of [302,403,429,500]){const result=await checkOpenaiConnection({...o,env:{OPENAI_API_KEY:key},fetchImpl:async()=>new Response(key,{status})});assert.equal(result.status,'failed');assert.ok(!JSON.stringify(result).includes(key));}
 const error=await checkOpenaiConnection({...o,env:{OPENAI_API_KEY:key},fetchImpl:async()=>{throw Error(key);}});assert.equal(error.code,'openai-check-unavailable');assert.ok(!JSON.stringify(error).includes(key));
});
test('timeout bounds a provider that never answers, and status never performs a network request',async t=>{
 const o=fixture(t);assert.equal(openaiCredentialStatus({...o,fetchImpl:()=>{throw Error('must not fetch');}}).configured,false);
 const result=await checkOpenaiConnection({...o,env:{OPENAI_API_KEY:key},timeoutMs:20,fetchImpl:()=>new Promise(()=>{})});assert.equal(result.code,'openai-check-unavailable');
});
test('failed and concurrently stale replacements preserve the predecessor bytes',async t=>{
 const o=fixture(t),first=await configure(o),path=resolve(o.home,'.ewai/credentials/openai.json'),before=readFileSync(path);
 await assert.rejects(()=>configureOpenaiCredentials({confirmed:true,expectedRevision:first.revision,apiKey:other},{...o,fetchImpl:async()=>new Response(key,{status:401})}),e=>e.code==='openai-key-rejected'&&!e.message.includes(key));assert.deepEqual(readFileSync(path),before);
 let release;const blockedFetch=()=>new Promise(r=>{release=()=>r(new Response('{}'));});
 const pending=configureOpenaiCredentials({confirmed:true,expectedRevision:first.revision,apiKey:other},{...o,fetchImpl:blockedFetch});
 await new Promise(r=>setImmediate(r));await configure(o);const latest=readFileSync(path);release();await assert.rejects(pending,e=>e.code==='openai-credential-stale');assert.deepEqual(readFileSync(path),latest);
 assert.throws(()=>removeOpenaiCredentials({confirmed:true,expectedRevision:first.revision},o),e=>e.code==='openai-credential-stale');assert.deepEqual(readFileSync(path),latest);
});
test('unsafe stored paths, shared/insecure files, corrupt JSON and project containment stop safely',async t=>{
 for(const kind of ['symlink','hardlink','permissions','parent','corrupt']){
  const o=fixture(t);await configure(o);const path=resolve(o.home,'.ewai/credentials/openai.json');
  if(kind==='symlink'){rmSync(path);symlinkSync(resolve(o.root,'target'),path);}
  if(kind==='hardlink')linkSync(path,resolve(o.root,'copy'));
  if(kind==='permissions')chmodSync(path,0o644);
  if(kind==='parent')chmodSync(resolve(o.home,'.ewai/credentials'),0o755);
  if(kind==='corrupt')writeFileSync(path,'{"apiKey":"'+key+'",oops');
  assert.throws(()=>openaiCredentialStatus(o),e=>/^openai-credential-/.test(e.code)&&!e.message.includes(key)&&!e.message.includes(o.home));
 }
 const o=fixture(t);await assert.rejects(()=>configureOpenaiCredentials({confirmed:true,expectedRevision:'missing',apiKey:key},{...o,home:o.projectRoot}),e=>e.code==='openai-credential-unsafe-storage');
});
test('closed inputs and explicit confirmation prevent secret/config injection',async t=>{
 const o=fixture(t);for(const input of [{confirmed:false},{endpoint:'https://outside.invalid'},{apiKey:'bad\n'+key},{apiKey:key+' '.repeat(600)}])await assert.rejects(()=>configureOpenaiCredentials({confirmed:true,expectedRevision:'missing',apiKey:key,...input},o));
 assert.equal(openaiCredentialStatus(o).saved,false);assert.throws(()=>removeOpenaiCredentials({confirmed:false,expectedRevision:'missing'},o));
});
test('physical project containment rejects ancestor aliases and symlinked project roots',async t=>{
 const o=fixture(t),account=resolve(o.projectRoot,'account'),alias=resolve(o.root,'alias');mkdirSync(account,{mode:0o700});symlinkSync(o.projectRoot,alias);
 for(const options of [{...o,home:resolve(alias,'account')},{...o,home:account,projectRoot:alias}]){
  await assert.rejects(()=>configureOpenaiCredentials({confirmed:true,expectedRevision:'missing',apiKey:key},options),e=>e.code==='openai-credential-unsafe-storage');
 }
 assert.equal(lstatSync(account).isDirectory(),true);
 assert.throws(()=>lstatSync(resolve(account,'.ewai')),e=>e.code==='ENOENT');
});
test('same-revision edits and file replacements during authentication are preserved',async t=>{
 for(const replace of [false,true]){
  const o=fixture(t),first=await configure(o),path=resolve(o.home,'.ewai/credentials/openai.json');
  let release;const pending=configureOpenaiCredentials({confirmed:true,expectedRevision:first.revision,apiKey:other},{...o,fetchImpl:()=>new Promise(r=>{release=()=>r(new Response('{}'));})});
  const changed=JSON.parse(readFileSync(path,'utf8'));if(!replace)changed.apiKey=('sk-'+'concurrent-synthetic-fixture-key');
  if(replace)rmSync(path);writeFileSync(path,JSON.stringify(changed),{mode:0o600});const latest=readFileSync(path);
  release();await assert.rejects(pending,e=>e.code==='openai-credential-stale');assert.deepEqual(readFileSync(path),latest);
 }
});
test('invalid environment override prevents mutations before authentication',async t=>{
 const o=fixture(t),first=await configure(o),path=resolve(o.home,'.ewai/credentials/openai.json'),before=readFileSync(path);let calls=0;
 const options={...o,env:{OPENAI_API_KEY:'invalid'},fetchImpl:async()=>{calls++;return new Response('{}');}};
 await assert.rejects(()=>configureOpenaiCredentials({confirmed:true,expectedRevision:first.revision,apiKey:other},options),e=>e.code==='openai-credential-invalid');
 assert.deepEqual(readFileSync(path),before);assert.equal(calls,0);
 assert.throws(()=>removeOpenaiCredentials({confirmed:true,expectedRevision:first.revision},options),e=>e.code==='openai-credential-invalid');assert.deepEqual(readFileSync(path),before);
});
test('credential CLI status is safe and rejects key arguments and noninteractive configure',t=>{
 const o=fixture(t),cli=resolve(import.meta.dirname,'../bin/ewai'),env={...process.env,HOME:o.home,OPENAI_API_KEY:key};
 const status=JSON.parse(execFileSync(process.execPath,[cli,'providers','credentials','openai','status','--json'],{env,encoding:'utf8'}));assert.equal(status.source,'environment');assert.ok(!JSON.stringify(status).includes(key));
 for(const suffix of [['configure'],['configure','--api-key',key],['status','--unknown',key]]){const r=spawnSync(process.execPath,[cli,'providers','credentials','openai',...suffix],{env,encoding:'utf8'});assert.notEqual(r.status,0);assert.ok(!(r.stdout+r.stderr).includes(key));}
});

test('valid environment override remains usable with unsafe saved storage without exposing the stored bytes',async t=>{
 const o=fixture(t);await configure(o);const path=resolve(o.home,'.ewai/credentials/openai.json');writeFileSync(path,'{corrupt private data');const options={...o,env:{OPENAI_API_KEY:other}};const status=openaiCredentialStatus(options);assert.equal(status.source,'environment');assert.equal(status.configured,true);assert.equal(status.storageSupported,false);assert.equal(status.storageIssue,'unsafe-saved-storage');assert.equal(resolveOpenaiApiKey(options),other);assert.ok(!JSON.stringify(status).includes(other));
});
