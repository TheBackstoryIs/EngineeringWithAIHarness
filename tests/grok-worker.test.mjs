import test from 'node:test';
import assert from 'node:assert/strict';
import {grokWorkerArgs,grokWorkerEnvironment,parseGrokWorkerResult} from '../src/runtime/grok-provider.mjs';
import {preparePhaseProvider,verifyPhaseProviderConformance,invokeRestrictedPhaseProvider,buildProviderInvocation} from '../src/runtime/provider-adapters.mjs';
import {initProject} from '../src/project.mjs';
import {prepareAfkContext} from '../src/runtime/afk-conductor.mjs';

test('isolated Grok receives immutable source standards, exact diff and actual check outputs',async t=>{
 const fs=await import('node:fs'),path=await import('node:path'),os=await import('node:os'),cp=await import('node:child_process');
 const {prepareGrokTaskEvidence,assertGrokTaskEvidenceFresh}=await import('../src/runtime/grok-provider.mjs');
 const root=fs.realpathSync(fs.mkdtempSync(path.resolve(os.tmpdir(),'ewai-grok-evidence-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 initProject(root,{specsRoot:'knowledge'});
 const standard=path.resolve(root,'knowledge/4.Constraints/fixture.md');fs.writeFileSync(standard,'SOURCE_STD_FIXTURE: preserve native models.');
 const git=(...args)=>cp.execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();
 git('init','-b','fixture');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.resolve(root,'code.mjs'),'export const value = 1;\n');git('add','-A');git('commit','-m','fixture baseline');
 fs.writeFileSync(path.resolve(root,'code.mjs'),'export const value = 2;\n');git('add','code.mjs');git('commit','-m','fixture implementation');
 const commit=git('rev-parse','HEAD'),command='node --test fixture.mjs',logs=path.resolve(root,'.ewai-pipeline/afk/fixture');fs.mkdirSync(logs,{recursive:true});
 const commands=['red','green','refactor'].map(stage=>{const outputPath=path.resolve(logs,stage+'.txt');fs.writeFileSync(outputPath,stage.toUpperCase()+'_FIXTURE');return {stage,command,exitCode:stage==='red'?1:0,outputPath};});
 const task={id:'T-001',name:'Fixture',slice:'S-001',read_set:['code.mjs'],write_set:['code.mjs'],claims:[],allowed_commands:[command],stop_conditions:[],first_failing_test:command,red_green_refactor:{red_command:command,green_command:command},review:{standards_pushed:['SPECS/4.Constraints/fixture.md']}};
 const evidence=prepareGrokTaskEvidence(root,root,task,{mode:'review',implementationCommit:commit,commands});
 assert.ok(Object.isFrozen(evidence.candidates));assert.ok(Object.isFrozen(evidence.candidates[0]));assert.doesNotThrow(()=>assertGrokTaskEvidenceFresh(evidence,'review'));
 const pack=prepareAfkContext(root,task,{name:'fixture',role:'application'},{mode:'review',implementationCommit:commit,evidenceCandidates:evidence.candidates});
 assert.equal(pack.status,'ready');for(const marker of ['SOURCE_STD_FIXTURE','-export const value = 1;','+export const value = 2;','RED_FIXTURE','GREEN_FIXTURE','REFACTOR_FIXTURE'])assert.ok(pack.modelContext.includes(marker),marker);
 assert.ok(pack.modelContext.includes('Do not execute commands: the conductor runs approved checks'));
 assert.throws(()=>assertGrokTaskEvidenceFresh({},'review'),/untrusted/);
 assert.throws(()=>buildProviderInvocation('grok',{cwd:root,task,mode:'review',prompt:'No captured evidence',grokEvidence:evidence}),/prompt-incomplete/);
 assert.throws(()=>assertGrokTaskEvidenceFresh(evidence,'review',{task:{...task,write_set:['other.mjs']}}),/contract-changed/);
 const overflow=prepareAfkContext(root,task,{name:'fixture',role:'application'},{mode:'review',implementationCommit:commit,evidenceCandidates:evidence.candidates,budgetTokens:1});assert.notEqual(overflow.status,'ready');
 assert.throws(()=>prepareGrokTaskEvidence(root,root,task,{mode:'review',implementationCommit:commit,commands:commands.slice(0,1)}),/verification/);
 fs.writeFileSync(commands[1].outputPath,'changed output');assert.throws(()=>assertGrokTaskEvidenceFresh(evidence,'review'),/changed/);fs.writeFileSync(commands[1].outputPath,'GREEN_FIXTURE');
 fs.writeFileSync(standard,'changed standard');assert.throws(()=>assertGrokTaskEvidenceFresh(evidence,'review'),/changed/);
 const implementation=prepareGrokTaskEvidence(root,root,task,{mode:'implementation',commands:[commands[0]]});assert.ok(implementation.candidates.some(c=>c.content.includes('changed standard')));
 git('commit','--allow-empty','-m','fixture revision drift');assert.throws(()=>assertGrokTaskEvidenceFresh(implementation,'implementation'),/changed/);
 fs.unlinkSync(standard);assert.throws(()=>prepareGrokTaskEvidence(root,root,task,{mode:'implementation'}));
});

test('isolated Grok launch retains native models and excludes inherited environments',()=>{
 const args=grokWorkerArgs('/tmp/private-prompt.txt','/tmp/private-cwd');
 assert.ok(args.includes('--prompt-file'));assert.ok(args.includes('--disallowed-tools'));
 assert.ok(!args.includes('--model'));assert.ok(!args.includes('--always-approve'));
 const env=grokWorkerEnvironment('/tmp/private-home','/tmp/private-runtime',{PATH:'/usr/bin',XAI_API_KEY:'synthetic-only',GROK_DEFAULT_MODEL:'unapproved-model',GROK_CONFIG:'unapproved-overlay',GROK_HOME:'/real/home'});
 assert.equal(env.XAI_API_KEY,'synthetic-only');assert.equal(env.GROK_DEFAULT_MODEL,undefined);assert.equal(env.GROK_CONFIG,undefined);assert.equal(env.GROK_HOME,'/tmp/private-home/.grok');
 assert.equal(env.GROK_CLAUDE_MCPS_ENABLED,'0');assert.equal(env.GROK_CURSOR_HOOKS_ENABLED,'0');
});

test('saved-key resolution enters only the disposable worker environment and never offline fixture configuration',async t=>{
 const fs=await import('node:fs'),path=await import('node:path'),os=await import('node:os');
 const {configureGrokCredentials,resolveGrokApiKey}=await import('../src/grok-credentials.mjs');
 const {prepareGrokRuntime}=await import('../src/runtime/grok-provider.mjs');
 const root=fs.mkdtempSync(path.resolve(os.tmpdir(),'ewai-grok-key-worker-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const accountHome=path.resolve(root,'account');fs.mkdirSync(accountHome,{mode:0o700});
 const apiKey='xai-synthetic-worker-not-a-real-key';await configureGrokCredentials({confirmed:true,expectedRevision:'missing',apiKey},{home:accountHome,env:{},fetchImpl:async()=>new Response('{}')});
 const source={PATH:process.env.PATH,XAI_API_KEY:resolveGrokApiKey({home:accountHome,env:{}})};
 for(const fixture of [null,{url:'http://127.0.0.1:1'}]){
  const runtime=path.resolve(root,fixture?'fixture':'worker');fs.mkdirSync(runtime);
  const prepared=prepareGrokRuntime(root,runtime,'Synthetic bounded prompt',fixture,'implementation',source);
  assert.notEqual(prepared.home,accountHome);assert.equal(prepared.env.XAI_API_KEY,fixture?undefined:apiKey);
  assert.ok(!fs.readFileSync(path.resolve(prepared.home,'.grok/config.toml'),'utf8').includes(apiKey));
  assert.ok(!fs.readFileSync(path.resolve(runtime,'prompt.txt'),'utf8').includes(apiKey));
  assert.ok(!prepared.args.includes('--model'));
 }
});

test('Grok envelopes reject missing, truncated or tool-ended results rather than accept arbitrary stdout',()=>{
 const raw=JSON.stringify({text:'{"proposal":"fixture"}',stopReason:'end_turn',num_turns:1,usage:{input_tokens:2,output_tokens:3}});
 assert.deepEqual(parseGrokWorkerResult(raw),{status:'complete',output:'{"proposal":"fixture"}',providerUsage:{schema:'ewai.provider-usage/v1',provider:'grok',inputTokens:2,cachedInputTokens:0,outputTokens:3,source:'provider-reported'}});
 for(const raw of ['plain text','{}',JSON.stringify({text:'forged',stopReason:'tool_use'}),JSON.stringify({text:'incomplete',stopReason:'max_turns'})])assert.notEqual(parseGrokWorkerResult(raw).status,'complete');
});

test('native Grok restricted phase conformance uses only synthetic local responses and trusted hostile fixtures', {skip:process.platform!=='darwin',timeout:90000},async t=>{
 const handle=preparePhaseProvider('grok');
 if(handle.status==='unavailable'){t.skip(handle.code);return;}
 assert.equal(handle.status,'requires-conformance',JSON.stringify(handle));
 const result=await verifyPhaseProviderConformance(handle,{timeoutMs:60000});
 assert.equal(result.status,'verified',JSON.stringify(result));
 for(const key of ['canonicalWritePrevented','outputBoundEnforced','timeoutEnforced','networkIsolated','childProcessPrevented','inheritedCapabilitiesBlocked','forgedToolRefused'])assert.equal(result[key],true,key);
 assert.equal(result.toolsExposed,0);assert.equal(result.fixtureServiceOnly,true);assert.equal(result.authority,'none');
 const controller=new AbortController();controller.abort();
 const cancelled=await invokeRestrictedPhaseProvider(handle,{prompt:'No request authorised.',timeoutMs:1000,signal:controller.signal});
 assert.equal(cancelled.executionStopped,true);assert.equal(cancelled.spawned,false);
});

test('coding snapshots accept only declared changes with matching predecessors and never inherit CLI configuration',async t=>{
 const fs=await import('node:fs'),path=await import('node:path'),os=await import('node:os');
 const {prepareGrokTaskSnapshot,acceptGrokTaskSnapshot}=await import('../src/runtime/grok-provider.mjs');
 const root=fs.mkdtempSync(path.resolve(os.tmpdir(),'ewai-grok-snapshot-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const project=path.resolve(root,'project'),copy=path.resolve(root,'copy');fs.mkdirSync(project);fs.mkdirSync(copy);fs.mkdirSync(path.resolve(project,'src'));
 fs.writeFileSync(path.resolve(project,'src/code.txt'),'before');fs.writeFileSync(path.resolve(project,'AGENTS.md'),'forged instructions');fs.mkdirSync(path.resolve(project,'.grok'));fs.writeFileSync(path.resolve(project,'.grok/config.toml'),'forged config');
 const task={read_set:['src','AGENTS.md','.grok'],write_set:['src/code.txt','src/new.txt']};
 const snapshot=prepareGrokTaskSnapshot(project,copy,task);
 assert.equal(fs.existsSync(path.resolve(copy,'AGENTS.md')),false);assert.equal(fs.existsSync(path.resolve(copy,'.grok')),false);
 fs.writeFileSync(path.resolve(copy,'src/code.txt'),'after');fs.writeFileSync(path.resolve(copy,'src/new.txt'),'new');
 assert.deepEqual(acceptGrokTaskSnapshot(snapshot).sort(),['src/code.txt','src/new.txt']);assert.equal(fs.readFileSync(path.resolve(project,'src/code.txt'),'utf8'),'after');
});

test('coding snapshot drift, out-of-scope edits and links block all original writes',async t=>{
 const fs=await import('node:fs'),path=await import('node:path'),os=await import('node:os');
 const {prepareGrokTaskSnapshot,acceptGrokTaskSnapshot}=await import('../src/runtime/grok-provider.mjs');
 for(const failure of ['drift','scope','link']){
  const root=fs.mkdtempSync(path.resolve(os.tmpdir(),'ewai-grok-snapshot-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const project=path.resolve(root,'project'),copy=path.resolve(root,'copy');fs.mkdirSync(project);fs.mkdirSync(copy);fs.writeFileSync(path.resolve(project,'code.txt'),'before');fs.writeFileSync(path.resolve(project,'read.txt'),'read');
  const snapshot=prepareGrokTaskSnapshot(project,copy,{read_set:['read.txt'],write_set:['code.txt','new.txt']});fs.writeFileSync(path.resolve(copy,'code.txt'),'after');
  if(failure==='drift')fs.writeFileSync(path.resolve(project,'code.txt'),'concurrent');
  if(failure==='scope')fs.writeFileSync(path.resolve(copy,'read.txt'),'forged');
  if(failure==='link')fs.symlinkSync(path.resolve(project,'read.txt'),path.resolve(copy,'new.txt'));
  assert.throws(()=>acceptGrokTaskSnapshot(snapshot));assert.equal(fs.readFileSync(path.resolve(project,'code.txt'),'utf8'),failure==='drift'?'concurrent':'before');
 }
});

for(const mode of ['implementation','review'])test('native Grok '+mode+' conformance proves its own disposable task boundary',{skip:process.platform!=='darwin',timeout:90000},async t=>{
 const {prepareGrokBuildProvider,verifyGrokBuildProviderConformance}=await import('../src/runtime/provider-adapters.mjs');
 const handle=prepareGrokBuildProvider(mode);if(handle.status==='unavailable'){t.skip(handle.code);return;}assert.equal(handle.status,'requires-conformance',JSON.stringify(handle));
 const proof=await verifyGrokBuildProviderConformance(handle,{timeoutMs:60000});assert.equal(proof.status,'verified',JSON.stringify(proof));
 assert.equal(proof.mode,mode);assert.equal(proof.fixtureServiceOnly,true);assert.equal(proof.authority,'none');
 assert.ok(Object.values(proof.checks).every(value=>value===true));
});
