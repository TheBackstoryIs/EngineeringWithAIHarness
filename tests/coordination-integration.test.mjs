import test from 'node:test';
import YAML from 'yaml';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {execFileSync} from 'node:child_process';
import {startProjectCheck,projectCheckStatus} from '../src/runtime/project-checks.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync,readFileSync,cpSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {initProject} from '../src/project.mjs';
import {createIntent,updateIntentDeliveryState} from '../src/intents.mjs';
import {beginDelivery,readDeliveryState} from '../src/delivery.mjs';
import {acquireExecutionLease,heartbeatExecutionLease,releaseExecutionLease,listExecutionLeases} from '../src/runtime/execution-leases.mjs';
import {listActiveSessions} from '../src/runtime/work.mjs';
import {listRuntimeIntents} from '../src/runtime/intents.mjs';
import {coordinationCommand} from '../src/coordination/cli.mjs';
import {centralRequest} from '../src/coordination/client.mjs';
import {captureRecord} from '../src/coordination/workspace.mjs';
import {pendingOperations} from '../src/coordination/integration.mjs';
import {startCoordinationService,stopCoordinationService} from '../src/coordination/service.mjs';

test('two independent local projects share native delivery transitions without sharing files',async t=>{
  const temp=mkdtempSync(join(tmpdir(),'ewai-shared-integration-')),a=join(temp,'a'),b=join(temp,'b'),data=join(temp,'service');
  const envName='EWAI_COORDINATION_TEST_'+process.pid;process.env[envName]='b'.repeat(48);const developerEnv=envName+'_DEVELOPER';process.env[developerEnv]='c'.repeat(48);
  const actors=join(temp,'actors.json');writeFileSync(actors,JSON.stringify([{actorId:'owner',role:'owner',projects:['example'],tokenEnv:envName},{actorId:'developer',role:'developer',projects:['example'],tokenEnv:developerEnv}]));
  const server=await startCoordinationService({dataRoot:data,credentialsFile:actors,port:0});
  t.after(async()=>{await stopCoordinationService(data);delete process.env[envName];delete process.env[developerEnv];await new Promise(r=>setTimeout(r,150));rmSync(temp,{recursive:true,force:true});});
  mkdirSync(a);mkdirSync(b);
  initProject(a,{name:'First checkout'});initProject(b,{name:'Second checkout'});
  const intent=createIntent(a,{domain:'product',slug:'shared'});updateIntentDeliveryState(a,intent.path,{status:'ready'});
  cpSync(join(a,'SPECS/2.Purpose/intents/product'),join(b,'SPECS/2.Purpose/intents/product'),{recursive:true});
  const common=['--url',server.url,'--project-id','example','--token-env',envName,'--yes'];
  await coordinationCommand(a,['create-project',...common]);
  await coordinationCommand(a,['connect',...common,'--machine-id','machine-a']);
  await coordinationCommand(a,['seed','shared','--yes']);
  await coordinationCommand(b,['connect',...common.map(item=>item===envName?developerEnv:item),'--machine-id','machine-b']);
  assert.equal(listRuntimeIntents(b)[0].status,'ready');
  const result=beginDelivery(a,'shared',{tool:'codex',existingCode:true});assert.equal(result.state.currentPhase,'intent');
  assert.equal(centralRequest(a,'read-intent',{intentId:'product/shared'}).revision,2);
  assert.equal(readDeliveryState(b,'shared').currentPhase,'intent');
  assert.equal(listActiveSessions(b).length,1);
  const mcp=new Client({name:'shared-coordination-fixture',version:'1'});
  await mcp.connect(new StdioClientTransport({command:process.execPath,args:[resolve('bin/ewai'),'mcp','--project',b],env:{...process.env},stderr:'ignore'}));
  try{
    const status=await mcp.callTool({name:'ewai_coordination_status',arguments:{}});assert.equal(JSON.parse(status.content[0].text).mode,'shared');
    const listed=await mcp.callTool({name:'ewai_list_intents',arguments:{query:'shared'}});assert.equal(JSON.parse(listed.content[0].text).intents[0].deliveryStatus,'in-progress');
  }finally{await mcp.close();}

  assert.equal(pendingOperations(a).length,0);
  const lease=centralRequest(a,'lease-acquire',{operationId:randomUUID(),intentId:'product/shared',kind:'intent',machineId:'machine-a',action:'update-projection',ttlMs:30000});
  assert.throws(()=>beginDelivery(b,'shared',{tool:'codex'}),/lease-conflict/);
  centralRequest(a,'lease-release',{operationId:randomUUID(),lease});
  const before=centralRequest(a,'read-intent',{intentId:'product/shared'});
  const file=join(b,'SPECS/2.Purpose/intents/product/shared.md'),original=readFileSync(file,'utf8');
  writeFileSync(file,original.replace('intent_map: null','intent_map: changed-map'));
  assert.throws(()=>readDeliveryState(b,'shared'),/local-source-diverged/);
  writeFileSync(file,original+'\nNew local requirement.\n');
  assert.throws(()=>readDeliveryState(b,'shared'),/local-source-diverged/);
  assert.equal(centralRequest(a,'read-intent',{intentId:'product/shared'}).revision,before.revision);
  // Catalogue reads never publish the changed document body or erase absent local records.
  assert.equal(listRuntimeIntents(b).length,1);
  assert.notEqual(captureRecord(b,'shared').bodyHash,before.record.bodyHash);
  const published=await coordinationCommand(b,['publish','shared','--expected-revision',String(before.revision)]);
  assert.equal(published.revision,before.revision+1);
  assert.equal(readDeliveryState(b,'shared').currentPhase,'intent');
  assert.throws(()=>readDeliveryState(a,'shared'),/local-source-diverged/);
  await coordinationCommand(b,['disconnect','--yes']);
  assert.throws(()=>beginDelivery(b,'shared'),/shared-project-disconnected/);
});

// Explicit imported legacy Build fixture; this does not assert historical planning or acceptance.
function seedTaskGraph(root, slug) {
  const deliveryRoot = resolve(root, `SPECS/6.Build/${slug}`);
  mkdirSync(deliveryRoot, { recursive: true });
  writeFileSync(resolve(deliveryRoot, 'task-graph.json'), `${JSON.stringify({
    schema_version: 1,
    slug,
    status: 'final',
    parent_branch: `feature/${slug}`,
    source: { claim_ledger: 'gates/plan/claim-ledger.json', plan_contract: 'gates/plan/plan-contract.json', destination: 'destination.md' },
    parallelism: { allowed: false, rationale: 'One safe test task.', max_parallel_tasks: 1 },
    afk_waves: [{ wave: 1, ready_tasks: ['T-001'], parallel_tasks: [], merge_order: ['T-001'], rationale: 'One task.' }],
    tasks: [{
      id: 'T-001', slice: 'SLICE-001', name: 'Leased task', issue_kind: 'tracer-bullet', priority: 10,
      parallel_wave: 1, classification: 'AFK', repo: 'Test', branch: `feature/${slug}/T-001-leased`,
      depends_on: [], claims: ['CL-001'], user_visible_outcome: 'Lease is visible.',
      read_set: ['src/input.mjs'], write_set: ['src/output.mjs'], central_writes_allowed: false,
      module_interface_contract: { module: 'lease', interface: ['run'], behaviour_owned: ['ownership'], caller_contract: ['token'], test_boundary: 'unit' },
      first_failing_test: 'node --test', no_first_test_rationale: '',
      red_green_refactor: { red_command: 'node --test', expected_red_failure: 'no lease', green_command: 'node --test', refactor_boundary: 'lease' },
      allowed_commands: ['node --test'], stop_conditions: ['pattern conflict discovered'], completion_evidence: ['tests pass'],
      ralph_loop: { allowed: false, max_iterations: 0, completion_promise: '<promise>T-001 COMPLETE</promise>' },
      review: { fresh_context_required: true, review_tests_first: true, standards_pushed: ['SPECS/pipeline.yaml'] },
      merge: { orchestrator_owned: true, post_merge_checks: ['node --test'] }, report_path: 'tasks/T-001/report.md',
      evidence_path: 'tasks/T-001/evidence.json',
    }],
  }, null, 2)}\n`);
  mkdirSync(resolve(deliveryRoot, 'gates/plan'), { recursive: true });
  writeFileSync(resolve(deliveryRoot, 'gates/plan/claim-ledger.json'), '{"implementation_claims":[{"id":"CL-001","type":"implementation"}],"slices":[{"id":"SLICE-001"}]}\n');
  writeFileSync(resolve(deliveryRoot, 'gates/plan/plan-contract.json'), '{"vertical_slices":[{"id":"SLICE-001"}]}\n');
  writeFileSync(resolve(deliveryRoot, 'destination.md'), '# Destination\n');
}

function seedRunningBuild(root, created, slug) {
  const deliveryRoot = resolve(root, `SPECS/6.Build/${slug}`);
  const statePath = resolve(deliveryRoot, 'delivery-state.json');
  mkdirSync(resolve(deliveryRoot, 'gates/build'), { recursive: true });
  writeFileSync(resolve(deliveryRoot, 'gates/build/build-approval.json'), '{"schema":"ewai.build-approval/v1","decision":"approved"}\n');
  writeFileSync(statePath, `${JSON.stringify({
    schema: 'ewai.delivery-state/v1',
    slug,
    intent: { id: 'delivery/leased-work', slug, status: 'in-progress' },
    status: 'in-progress',
    currentPhase: 'build',
    phases: [{ id: 'build', status: 'running' }],
    adjuncts: [],
    humanGates: [],
    approvals: { build: true },
  }, null, 2)}\n`);
  updateIntentDeliveryState(root, created.path, {
    status: 'in-progress',
    deliveryStatus: 'in-progress',
    currentPhase: 'build',
    deliveryStatePath: `SPECS/6.Build/${slug}/delivery-state.json`,
  });
}


test('native task leases coordinate independent machines and retain local report validation',async t=>{
 const temp=mkdtempSync(join(tmpdir(),'ewai-shared-task-')),a=join(temp,'a'),b=join(temp,'b'),data=join(temp,'service');mkdirSync(a);mkdirSync(b);
 const envName='EWAI_COORDINATION_TASK_'+process.pid;process.env[envName]='d'.repeat(48);
 const actors=join(temp,'actors.json');writeFileSync(actors,JSON.stringify([{actorId:'owner',role:'owner',projects:['example'],tokenEnv:envName}]));
 const server=await startCoordinationService({dataRoot:data,credentialsFile:actors,port:0});
 t.after(async()=>{await stopCoordinationService(data);delete process.env[envName];await new Promise(r=>setTimeout(r,150));rmSync(temp,{recursive:true,force:true});});
 initProject(a,{name:'Test'});initProject(b,{name:'Test'});
 const created=createIntent(a,{domain:'delivery',slug:'leased-work'});seedTaskGraph(a,'leased-work');seedRunningBuild(a,created,'leased-work');
 const script='setTimeout(()=>console.log("SHARED_CHECK",Object.keys(process.env).some(k=>k.startsWith("EWAI_COORDINATION_TASK_"))),250)';
 const cfgPath=join(a,'SPECS/pipeline.yaml'),cfg=YAML.parse(readFileSync(cfgPath,'utf8'));
 cfg.repositories=[{name:'application',path:'.'}];cfg.remote_operations={enabled:true,checks:{verify:{repository:'application',executable:process.execPath,args:['-e',script],phases:['build'],timeout_ms:5000,max_output_bytes:4096}}};writeFileSync(cfgPath,YAML.stringify(cfg));
 const graphPath=join(a,'SPECS/6.Build/leased-work/task-graph.json'),graph=JSON.parse(readFileSync(graphPath));graph.tasks[0].repo='application';graph.tasks[0].allowed_commands.push([process.execPath,'-e',script].join(' '));writeFileSync(graphPath,JSON.stringify(graph,null,2)+'\n');
 const statePath=join(a,'SPECS/6.Build/leased-work/delivery-state.json'),state=JSON.parse(readFileSync(statePath));state.intent.path='SPECS/2.Purpose/intents/delivery/leased-work.md';state.approvals.build={approvedBy:'Fixture owner',approvedAt:'2026-01-01T00:00:00.000Z'};writeFileSync(statePath,JSON.stringify(state,null,2)+'\n');writeFileSync(join(a,'SPECS/6.Build/leased-work/gates/build/build-approval.json'),JSON.stringify({schema:'ewai.build-approval/v1',slug:'leased-work',decision:'approved',...state.approvals.build})+'\n');
 writeFileSync(join(a,'.gitignore'),'.ewai-pipeline/\nSPECS/\n');execFileSync('git',['init','-q'],{cwd:a});execFileSync('git',['add','.gitignore'],{cwd:a});execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','fixture'],{cwd:a});execFileSync('git',['checkout','-qb',graph.tasks[0].branch],{cwd:a});

 cpSync(join(a,'SPECS/2.Purpose/intents/delivery'),join(b,'SPECS/2.Purpose/intents/delivery'),{recursive:true});
 cpSync(join(a,'SPECS/6.Build/leased-work'),join(b,'SPECS/6.Build/leased-work'),{recursive:true});
 const common=['--url',server.url,'--project-id','example','--token-env',envName,'--yes'];
 await coordinationCommand(a,['create-project',...common]);await coordinationCommand(a,['connect',...common,'--machine-id','machine-a']);await coordinationCommand(a,['seed','--yes']);await coordinationCommand(b,['connect',...common,'--machine-id','machine-b']);
 const first=acquireExecutionLease(a,'leased-work',{taskId:'T-001',ownerId:'agent-a',tool:'codex',runId:'run-a',durationMs:60000});
 assert.equal(listExecutionLeases(b,{activeOnly:true}).length,1);assert.ok(!listExecutionLeases(b,{includeTokens:true})[0].token);
 assert.throws(()=>acquireExecutionLease(b,'leased-work',{taskId:'T-001',ownerId:'agent-b',tool:'codex',runId:'run-b'}),/already leased|lease-conflict/);
 assert.equal(heartbeatExecutionLease(a,first.id,{token:first.token,durationMs:60000}).status,'active');
 const checkId=randomUUID();await startProjectCheck(a,{slug:'leased-work',phase:'build',operationId:checkId,check:'verify',confirmed:true,taskId:'T-001',leaseId:first.id,leaseToken:first.token});
 let checked;for(let attempt=0;attempt<70;attempt++){checked=projectCheckStatus(a,{slug:'leased-work',operationId:checkId});if(!['queued','running'].includes(checked.status))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(checked.passed,true,JSON.stringify(checked));assert.match(checked.output,/SHARED_CHECK false/);

 assert.throws(()=>releaseExecutionLease(a,first.id,{token:first.token,outcome:'completed'}),/report is incomplete/);
 assert.equal(releaseExecutionLease(a,first.id,{token:first.token,outcome:'handoff'}).status,'released');
 const second=acquireExecutionLease(b,'leased-work',{taskId:'T-001',ownerId:'agent-b',tool:'codex',runId:'run-b'});assert.notEqual(second.token,first.token);
 assert.throws(()=>heartbeatExecutionLease(a,first.id,{token:first.token}),/lease-stale/);
 releaseExecutionLease(b,second.id,{token:second.token,outcome:'handoff'});
});

test('an uncommitted durable proposal recovers after a real service restart without repeating local work',async t=>{
 const temp=mkdtempSync(join(tmpdir(),'ewai-shared-recovery-')),root=join(temp,'project'),data=join(temp,'service');mkdirSync(root);
 const envName='EWAI_COORDINATION_RECOVERY_'+process.pid;process.env[envName]='e'.repeat(48);
 const actors=join(temp,'actors.json');writeFileSync(actors,JSON.stringify([{actorId:'owner',role:'owner',projects:['example'],tokenEnv:envName}]));
 let server=await startCoordinationService({dataRoot:data,credentialsFile:actors,port:0});
 t.after(async()=>{await stopCoordinationService(data);delete process.env[envName];await new Promise(r=>setTimeout(r,150));rmSync(temp,{recursive:true,force:true});});
 initProject(root,{name:'Recovery fixture'});const created=createIntent(root,{domain:'product',slug:'recover'});updateIntentDeliveryState(root,created.path,{status:'ready'});
 const common=['--url',server.url,'--project-id','example','--token-env',envName,'--yes'];
 await coordinationCommand(root,['create-project',...common]);await coordinationCommand(root,['connect',...common,'--machine-id','machine-a']);await coordinationCommand(root,['seed','--yes']);
 const current=centralRequest(root,'read-intent',{intentId:'product/recover'}),lease=centralRequest(root,'lease-acquire',{operationId:randomUUID(),intentId:'product/recover',kind:'intent',machineId:'machine-a',action:'update-projection',ttlMs:30000});
 const candidate=structuredClone(current.record);candidate.state.status='blocked';candidate.projections.find(p=>p.path.endsWith('/recover.json')).content.status='blocked';
 const operationId=randomUUID(),input={operationId,intentId:'product/recover',expectedRevision:1,lease,record:candidate};
 const {atomicPrivate}=await import('../src/coordination/config.mjs');
 atomicPrivate(root,join(root,'.ewai-pipeline/runtime/coordination',operationId+'.json'),{schema:'ewai.coordination-operation/v1',operationId,intentId:'product/recover',expectedRevision:1,status:'proposed',lease,input,events:[]});
 const port=Number(new URL(server.url).port),identity=server.identity,epoch=server.epoch;
 await stopCoordinationService(data);await new Promise(r=>setTimeout(r,150));server=await startCoordinationService({dataRoot:data,credentialsFile:actors,port});
 assert.equal(server.identity,identity);assert.notEqual(server.epoch,epoch);
 await assert.rejects(coordinationCommand(root,['recover',operationId]),/recovery-confirmation-required/);
 const recovered=await coordinationCommand(root,['recover',operationId,'--yes']);
 assert.equal(recovered.revision,2);assert.equal(pendingOperations(root).length,0);
 assert.equal(listRuntimeIntents(root)[0].status,'blocked');
 assert.equal(centralRequest(root,'read-intent',{intentId:'product/recover'}).revision,2);
 // Crash after a real local write, before the durable central candidate exists.
 const mutationModule=new URL('../src/runtime/intent-ownership.mjs',import.meta.url).href,intentModule=new URL('../src/intents.mjs',import.meta.url).href;
 const crash=`import {withIntentMutation} from ${JSON.stringify(mutationModule)};import {updateIntentDeliveryState} from ${JSON.stringify(intentModule)};withIntentMutation(${JSON.stringify(root)},'recover',{action:'update-projection'},()=>{updateIntentDeliveryState(${JSON.stringify(root)},${JSON.stringify(created.path)},{status:'ready'});process.exit(77);});`;
 assert.throws(()=>execFileSync(process.execPath,['--input-type=module','-e',crash],{stdio:'pipe'}),error=>error.status===77);
 const interrupted=pendingOperations(root)[0];assert.equal(interrupted.status,'prepared');assert.ok(interrupted.nativeOperationId);
 await stopCoordinationService(data);await new Promise(r=>setTimeout(r,150));server=await startCoordinationService({dataRoot:data,credentialsFile:actors,port});
 await assert.rejects(coordinationCommand(root,['recover',interrupted.operationId,'--yes']),/local-operation-review-required/);
 const abandoned=await coordinationCommand(root,['recover',interrupted.operationId,'--yes','--execution-stopped']);assert.equal(abandoned.reconciled,true);
 assert.equal(listRuntimeIntents(root)[0].status,'blocked');
 const {withIntentMutation}=await import('../src/runtime/intent-ownership.mjs');
 withIntentMutation(root,'recover',{action:'update-projection'},()=>updateIntentDeliveryState(root,created.path,{status:'ready'}));
 assert.equal(centralRequest(root,'read-intent',{intentId:'product/recover'}).record.state.status,'ready');

});
