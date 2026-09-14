import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,utimesSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {buildCompanionPrompt,runCompanion} from '../src/companion.mjs';
import * as companion from '../src/companion.mjs';
import {companionOpening} from '../src/companion-opening.mjs';
import {initProject} from '../src/project.mjs';
import {configureProjectMcp} from '../src/runtime/mcp-config.mjs';
import {ensureDashboard,stopDashboard,dashboardStatus} from '../src/runtime/dashboard.mjs';
import {dashboardRuntimeVersion} from '../src/runtime/version.mjs';
import * as cli from '../src/cli.mjs';

function fixture(t){
 const root=mkdtempSync(resolve(tmpdir(),'ewai-onboarding-experience-')),project=resolve(root,'project'),home=resolve(root,'home');
 mkdirSync(project);mkdirSync(home);initProject(project);
 t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,project,home};
}
test('unchanged host configuration is never rewritten, including protected Codex config',t=>{
 const f=fixture(t),paths=[resolve(f.project,'.codex/config.toml'),resolve(f.project,'.mcp.json'),resolve(f.project,'.claude/settings.json'),resolve(f.project,'.agents/mcp_config.json')];
 for(const path of paths)utimesSync(path,100,100);
 chmodSync(paths[0],0o444);
 t.after(()=>{if(existsSync(paths[0]))chmodSync(paths[0],0o600);});
 configureProjectMcp(f.project);
 for(const path of paths)assert.equal(statSync(path).mtimeMs,100000,path);
});
test('host configuration updates preserve unrelated settings',t=>{
 const f=fixture(t),path=resolve(f.project,'.mcp.json');
 const cfg=JSON.parse(readFileSync(path));cfg.mcpServers.other={command:'other'};cfg.custom={enabled:true};
 writeFileSync(path,JSON.stringify(cfg));
 configureProjectMcp(f.project);
 assert.deepEqual(JSON.parse(readFileSync(path)).custom,{enabled:true});
 assert.deepEqual(JSON.parse(readFileSync(path)).mcpServers.other,{command:'other'});
});
test('fresh-folder launch uses a deterministic route before check-in, without source archaeology',()=>{
 const prompt=buildCompanionPrompt({projectRoot:'/tmp/example',initialized:false,existingCodebase:true});
 assert.match(prompt,/INITIALISATION BEFORE CHECK-IN/);
 assert.match(prompt,/one location/);
 assert.match(prompt,/ewai init --project/);
 assert.match(prompt,/Do not inspect the installed EWAI source/);
 assert.match(prompt,/Do not run.*ewai --version/);
 assert.doesNotMatch(prompt,/sole credential-entry exception/);
 assert.match(prompt,/dashboard.*default/i);
 assert.match(prompt,/briefing/);
});
test('every session has bounded presentation but retains the complete menu and governance',()=>{
 const opening=companionOpening({hasWork:true,licenceNotConfigured:true});
 assert.deepEqual(opening.actions.map(a=>a.id),[1,2,3,4,5,6,7,8,9]);
 assert.equal(opening.output?.routineStatusLines,4);
 assert.equal(opening.output?.progressMaxWords,24);
 assert.equal(opening.output?.details,'on-request');
 assert.match(opening.contract.join(' '),/Do not repeat the menu/);
 assert.match(opening.contract.join(' '),/dashboard.*default/i);
 assert.ok(opening.personaSetup.question.split(/\s+/).length<=20);
});
test('actual text formatter is compact while mandatory statuses and warnings remain visible',()=>{
 assert.equal(typeof cli.formatCheckin,'function');
 const result={project:{name:'Example'},premium:{access:'unknown',status:'not-installed',accessReason:'licence-not-configured',installed:false},framework:{status:'current',current:'0.2.5'},runtime:{dashboard:{status:'running',url:'http://127.0.0.1:47719'}},intentState:{status:'consistent'},operationalState:{status:'consistent'},intentDependencies:{status:'pass',errors:[]},validation:{orchestrator:'codex',checkpoints:{},hosts:[],providers:{}},palace:{status:'tidy'}};
 const compact=cli.formatCheckin(result);
 assert.ok(compact.split('\n').length<=4,compact);
 assert.match(compact,/0.2.5/);assert.match(compact,/Core personas/);assert.match(compact,/State consistent/);
 assert.match(compact,/Standards required/);assert.match(compact,/reviewers.*none/i);
 result.intentState={status:'drift-detected',drift:[{}]};
 assert.match(cli.formatCheckin(result),/pause/i);
 result.validation.hosts=[{host:'claude',label:'Claude Code',available:false}];
 result.validation.providers={claude:{state:'available',enabled:true}};
 assert.match(cli.formatCheckin(result),/Claude Code.*unavailable/);
});

test('compact check-in preserves updates, local-change blockers and explicit replacement consent',()=>{
 const result={project:{name:'Example'},premium:{access:'available',status:'update-available',installed:true,verified:true,version:'1.0.0',latestVersion:'2.0.0',action:{kind:'offer-update'}},framework:{status:'current',current:'0.2.5'},runtime:{dashboard:{status:'running',url:'http://127.0.0.1:47719'}},intentState:{status:'consistent'},operationalState:{status:'consistent'},validation:{checkpoints:{},hosts:[],providers:{}},palace:{status:'tidy'}};
 assert.match(cli.formatCheckin(result),/update 2.0.0 available/i);
 result.premium={access:'available',status:'installed-unverified',installed:true,verified:false,dirty:true,action:{kind:'blocked-local-changes'}};
 assert.match(cli.formatCheckin(result),/local changes.*resolve/i);
 result.premium={access:'available',status:'update-available',installed:true,verified:true,action:{kind:'offer-replace'}};
 assert.match(cli.formatCheckin(result),/another licence.*explicit/i);
});

test('fresh-folder startup plan retains the complete existing/new code path and flexibility',()=>{
 assert.equal(typeof companion.companionStartupPlan,'function');
 const existing=companion.companionStartupPlan({initialized:false,existingCodebase:true});
 assert.deepEqual(existing.steps,['location-agreement','initialise','check-in','premium-personas','human-briefing','context-import','offer-archaeology','discovery','doctor','opening']);
 assert.equal(existing.archaeology.optional,true);
 assert.deepEqual(existing.archaeology.onAccept,['archaeology','review-and-curate']);
 assert.equal(existing.archaeology.onDecline,'discovery');
 assert.ok(existing.flexibility.includes('human-owned deferral'));
 const fresh=companion.companionStartupPlan({initialized:false,existingCodebase:false});
 assert.ok(!fresh.steps.includes('archaeology'));assert.ok(fresh.steps.includes('discovery'));
 assert.deepEqual(companion.companionStartupPlan({initialized:true,existingCodebase:true}).steps,['check-in','opening','selected-action']);
 const prompt=buildCompanionPrompt({projectRoot:'/tmp/example',initialized:false,existingCodebase:true});
 assert.match(prompt,/KNOWN STARTUP PATH/);assert.match(prompt,/review-and-curate/);
 assert.match(prompt,/early dashboard link/);
});

test('generated credential instructions consistently default to the dashboard, not terminal-only entry',t=>{
 const f=fixture(t);
 for(const path of ['AGENTS.md','CLAUDE.md']){
  const text=readFileSync(resolve(f.project,path),'utf8');
  assert.match(text,/guarded dashboard password form by default/);
  assert.doesNotMatch(text,/Website-purchased keys use the hidden terminal prompt/);
  assert.doesNotMatch(text,/Offer private terminal setup/);
  assert.match(text,/For returning sessions, or after onboarding is complete or explicitly deferred by the owner/);
  assert.match(text,/During first-run onboarding, continue the known startup path/);
  assert.match(text,/Archaeology is optional: always offer it for existing code/);
 }
});
test('selected host launches without redundant availability diagnostics',async t=>{
 const root=mkdtempSync(resolve(tmpdir(),'ewai-quiet-host-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 let output='';
 const code=await runCompanion({cwd:root,preferredHost:'codex',probeHost:()=>true,prepareHost:()=>{},spawnHost:()=>0,input:{isTTY:false},output:{isTTY:false,write:s=>{output+=s;}},errorOutput:{write:()=>{}}});
 assert.equal(code,0);assert.doesNotMatch(output,/AI hosts available|Not available in this terminal/);
 assert.equal(output.trim().split('\n').length,1);
});
function setupFailure(error){
 const source=readFileSync(resolve(import.meta.dirname,'../public/app.js'),'utf8');
 const start=source.indexOf('function premiumSetupErrorMessage('),end=source.indexOf('let premiumSetupBusy',start);
 assert.ok(start>=0&&end>start,'A fixed safe setup failure projection is required');
 return runInNewContext(source.slice(start,end)+'\npremiumSetupErrorMessage(input)',{input:error,TypeError,Error});
}
test('404 and connection errors explain recovery; arbitrary server errors are never echoed',()=>{
 const stale=setupFailure({status:404,message:'Not found'});
 assert.match(stale,/out of date/i);assert.match(stale,/Restart EWAI/);assert.match(stale,/dashboard link/i);
 const connection=setupFailure(new TypeError('UNSAFE-SERVER-DETAIL'));
 assert.match(connection,/reach the dashboard/i);assert.match(connection,/Restart EWAI/);
 assert.doesNotMatch(connection,/UNSAFE/);
 const invalid=setupFailure({status:400,body:{schema:'ewai.premium-setup/v1',status:'failed',stage:'activation',code:'invalid_licence_key'},message:'PRIVATE-KEY'});
 assert.match(invalid,/My Account/);assert.doesNotMatch(invalid,/PRIVATE/);
 const unknown=setupFailure({status:400,body:{error:'PRIVATE-KEY'},message:'PRIVATE-KEY'});
 assert.doesNotMatch(unknown,/PRIVATE/);assert.match(unknown,/try again/i);
 const download=setupFailure({status:400,body:{schema:'ewai.premium-setup/v1',status:'failed',stage:'download'},message:'PRIVATE-KEY'});
 assert.match(download,/saved/);assert.match(download,/wasn't installed/i);
});
test('stale dashboard without a state file is not reused or killed',async t=>{
 const f=fixture(t),digest=createHash('sha256').update(resolve(f.project)).digest(),port=47000+digest.readUInt16BE(0)%1000,url='http://127.0.0.1:'+port;
 const old=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({schema:'ewai.dashboard-health/v1',projectRoot:f.project,pid:process.pid,runtimeVersion:dashboardRuntimeVersion-1,url,port,startedAt:new Date().toISOString()}));});
 await new Promise((done,fail)=>{old.once('error',fail);old.listen(port,'127.0.0.1',done);});
 t.after(()=>new Promise(done=>old.close(done)));
 const statePath=resolve(f.project,'.ewai-pipeline/runtime/dashboard.json');
 assert.equal(existsSync(statePath),false);
 const current=await ensureDashboard(f.project,{home:f.home,premiumCheck:Promise.resolve({access:'unknown',installed:false})});
 t.after(()=>stopDashboard(f.project));
 assert.notEqual(current.url,url,'Rediscovery must reject older runtime');
 assert.equal((await fetch(current.url+'/api/health').then(r=>r.json())).runtimeVersion,dashboardRuntimeVersion);
 const route=await fetch(current.url+'/api/personas/premium/setup',{method:'POST',headers:{'content-type':'application/json',origin:current.url},body:JSON.stringify({confirmed:false})});
 assert.equal(route.status,400,'Current endpoint exists; a missing key is not a 404');
 assert.equal((await fetch(url+'/api/health')).ok,true,'Unowned discovered process remains untouched');
});
test('malformed health cannot be reported running or crash status validation',async t=>{
 const f=fixture(t),server=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({schema:'ewai.dashboard-health/v1',pid:0,runtimeVersion:dashboardRuntimeVersion}));});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));
 const path=resolve(f.project,'.ewai-pipeline/runtime/dashboard.json');mkdirSync(resolve(path,'..'),{recursive:true});writeFileSync(path,JSON.stringify({url:'http://127.0.0.1:'+server.address().port,pid:0}));
 assert.equal((await dashboardStatus(f.project)).status,'stale');
});

test('recorded old dashboard is replaced and only the verified owned process is stopped',async t=>{
 const f=fixture(t);
 const source="const http=require('node:http');const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({schema:'ewai.dashboard-health/v1',projectRoot:process.argv[1],pid:process.pid,runtimeVersion:Number(process.argv[2]),startedAt:new Date().toISOString()}));});server.listen(0,'127.0.0.1',()=>console.log(server.address().port));";
 const old=spawn(process.execPath,['-e',source,f.project,String(dashboardRuntimeVersion-1)],{stdio:['ignore','pipe','ignore']});
 t.after(()=>old.kill('SIGTERM'));
 const port=await new Promise((done,fail)=>{old.once('error',fail);old.stdout.once('data',data=>done(Number(String(data).trim())));old.once('exit',code=>fail(Error('Old fixture exited: '+code)));});
 const oldUrl='http://127.0.0.1:'+port,path=resolve(f.project,'.ewai-pipeline/runtime/dashboard.json');
 mkdirSync(resolve(path,'..'),{recursive:true});writeFileSync(path,JSON.stringify({schema:'ewai.dashboard-state/v1',projectRoot:f.project,pid:old.pid,url:oldUrl,port,owned:true}));
 assert.equal((await dashboardStatus(f.project)).reason,'runtime-version');
 const current=await ensureDashboard(f.project,{home:f.home,premiumCheck:Promise.resolve({access:'unknown',installed:false})});
 t.after(()=>stopDashboard(f.project));
 assert.equal(current.started,true);assert.notEqual(current.pid,old.pid);assert.equal(current.owned,true);
 const currentHealth=await fetch(current.url+'/api/health').then(r=>r.json());
 assert.equal(currentHealth.pid,current.pid);assert.equal(currentHealth.runtimeVersion,dashboardRuntimeVersion);
 await new Promise(done=>old.exitCode!==null||old.signalCode!==null?done():old.once('exit',done));
 await assert.rejects(fetch(oldUrl+'/api/health'));
});
