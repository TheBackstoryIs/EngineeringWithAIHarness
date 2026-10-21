import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import YAML from 'yaml';
import {execFileSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {initProject} from '../src/project.mjs';
import {createIntent,updateIntentDeliveryState} from '../src/intents.mjs';
import {beginDelivery} from '../src/delivery.mjs';

test('remote MCP client authors evidence and runs a local check across reconnects',async t=>{
 const root=mkdtempSync(resolve(tmpdir(),'ewai-project-mcp-'));t.after(()=>rmSync(root,{recursive:true,force:true}));initProject(root,{name:'Remote MCP fixture'});writeFileSync(resolve(root,'.gitignore'),'.ewai-pipeline/\nSPECS/\n');execFileSync('git',['init','-q'],{cwd:root});execFileSync('git',['add','.'],{cwd:root});execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','fixture'],{cwd:root});
 const p=resolve(root,'SPECS/pipeline.yaml'),config=YAML.parse(readFileSync(p,'utf8'));config.remote_operations={enabled:true,checks:{verify:{repository:'application',executable:process.execPath,args:['-e','setTimeout(()=>console.log("MCP checked"),400)'],phases:['fit-check'],timeout_ms:3000,max_output_bytes:1024}}};writeFileSync(p,YAML.stringify(config));createIntent(root,{slug:'remote-work',domain:'platform',title:'Remote work'});beginDelivery(root,'remote-work',{tool:'codex'});
 // A focused resumed-FitCheck fixture; this does not claim historical planning assurance.
 const statePath=resolve(root,'SPECS/6.Build/remote-work/delivery-state.json'),state=JSON.parse(readFileSync(statePath));state.currentPhase='fit-check';for(const phase of state.phases)if(phase.number<9)phase.status='skipped';state.adjuncts.find(p=>p.id==='fit-check').status='running';writeFileSync(statePath,JSON.stringify(state));updateIntentDeliveryState(root,resolve(root,'SPECS/2.Purpose/intents/platform/remote-work.md'),{currentPhase:'fit-check'});
 const connect=async()=>{const c=new Client({name:'remote-fixture',version:'1'});await c.connect(new StdioClientTransport({command:process.execPath,args:[resolve('bin/ewai'),'mcp','--project',root],stderr:'ignore'}));return c;};let client=await connect();t.after(()=>client.close());const call=async(name,args={})=>{const r=await client.callTool({name:'ewai_project_'+name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);};
 const names=(await client.listTools()).tools.map(t=>t.name);for(const suffix of ['capabilities','preflight','read_file','apply_change','check_start','check_status','check_cancel','recover'])assert.ok(names.includes('ewai_project_'+suffix));assert.equal((await call('preflight',{slug:'remote-work'})).ready,true);
 assert.equal((await client.callTool({name:'ewai_project_read_file',arguments:{repository:'application',path:'.env'}})).isError,true);
 const change={slug:'remote-work',phase:'fit-check',operationId:randomUUID(),confirmed:true,kind:'evidence',path:'fit-check-report.md',expectedSha256:null,content:'# Remote evidence\n'};await call('apply_change',change);assert.equal((await call('apply_change',change)).replayed,true);
 const gate={slug:'remote-work',phase:'fit-check',status:'pass',honestyCheck:{sourceSectionsEdited:true,staleTextRemoved:true,noAppendOnlyCorrections:true,allCodeClaimsCited:true},requiredGates:[{id:'phase-artifact-written',status:'pass',commandOrSkill:'Fixture authored report',outputPath:'SPECS/6.Build/remote-work/fit-check-report.md',exitStatus:0}]};await client.callTool({name:'ewai_delivery_record_gate',arguments:gate});
 assert.equal((await client.callTool({name:'ewai_delivery_complete_phase',arguments:{slug:'remote-work',phase:'fit-check'}})).isError,true);
 const operationId=randomUUID(),start={slug:'remote-work',phase:'fit-check',operationId,check:'verify',confirmed:true};await call('check_start',start);await client.close();client=await connect();let result;for(let i=0;i<60;i++){result=await call('check_status',{slug:'remote-work',operationId});if(!['queued','running'].includes(result.status))break;await new Promise(r=>setTimeout(r,100));}assert.equal(result.passed,true);assert.match(result.output,/MCP checked/);assert.equal((await call('check_start',start)).replayed,true);
 const completed=await client.callTool({name:'ewai_delivery_complete_phase',arguments:{slug:'remote-work',phase:'fit-check',artefactPath:'fit-check-report.md'}});assert.ok(!completed.isError,JSON.stringify(completed));assert.equal(JSON.parse(completed.content[0].text).currentPhase,'build');
 const continued=await client.callTool({name:'ewai_delivery_continue',arguments:{slug:'remote-work'}});assert.ok(JSON.parse(continued.content[0].text).projectAccess);
});
