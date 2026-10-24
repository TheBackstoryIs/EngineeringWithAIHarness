import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {assertOperationalTransition} from '../src/coordination/transitions.mjs';
import {canonicalDeliveryPhaseIds} from '../src/delivery.mjs';
import {createCoordinationStore} from '../src/coordination/store.mjs';
import {createCoordinationServer} from '../src/coordination/server.mjs';

const owner={actorId:'owner',role:'owner',projects:['example']};
const developer={actorId:'developer',role:'developer',projects:['example']};
const other={actorId:'other',role:'developer',projects:['example']};
const approver={actorId:'reviewer',role:'approver',projects:['example']};
const hash=value=>createHash('sha256').update(value).digest('hex');
const source=hash('Owner-authored requirements');
function record(){return {id:'platform/example',slug:'example',domain:'platform',title:'Example',bodyHash:source,
  state:{status:'ready',deliveryStatus:'in-progress',currentPhase:'intent'},delivery:null,projections:[],
  taskGraph:{tasks:[{id:'T-001',repo:'application',branch:'feature/example',write_set:['src/**']}]},evidence:[]};}
function fixture(t){const root=mkdtempSync(join(tmpdir(),'ewai-coordination-store-'));let now=Date.now();
  const store=createCoordinationStore(root,{now:()=>now});t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
  const execute=(actor,action,input={})=>store.execute(actor,'example',action,input);
  execute(owner,'create-project',{operationId:randomUUID(),name:'Example'});
  execute(owner,'seed-intent',{operationId:randomUUID(),record:record(),confirmed:true});
  return {root,store,execute,advance:ms=>{now+=ms;}};
}
const claim=(f,actor=developer,extra={})=>f.execute(actor,'lease-acquire',{operationId:randomUUID(),intentId:'platform/example',kind:'intent',machineId:'machine-a',action:'update-projection',ttlMs:30000,...extra});
const commit=(f,lease,patch={},actor=developer,operationId=randomUUID())=>{
  const current=f.execute(actor,'read-intent',{intentId:'platform/example'});
  return f.execute(actor,'commit-intent',{operationId,intentId:'platform/example',expectedRevision:current.revision,lease,record:{...current.record,...patch}});
};

test('central records use CAS revisions and stable, payload-bound operation receipts',t=>{
  const f=fixture(t),lease=claim(f),operationId=randomUUID();
  const input={operationId,intentId:'platform/example',expectedRevision:1,lease,record:{...record(),title:'Updated'}};
  const first=f.execute(developer,'commit-intent',input);assert.equal(first.revision,2);
  assert.deepEqual(f.execute(developer,'commit-intent',input),first);
  assert.throws(()=>f.execute(developer,'commit-intent',{...input,record:record()}),/operation-id-conflict/);
  assert.throws(()=>f.execute(other,'operation-status',{operationId}),/operation-not-found/);
  assert.throws(()=>f.execute(developer,'commit-intent',{...input,operationId:randomUUID()}),/revision-conflict/);
});

test('a second machine cannot steal intent ownership; expiry fences the old handle',t=>{
  const f=fixture(t),first=claim(f);
  assert.throws(()=>claim(f,other,{machineId:'machine-b'}),/lease-conflict/);
  f.advance(30001);const second=claim(f,other,{machineId:'machine-b'});
  assert.ok(second.generation>first.generation);
  assert.throws(()=>commit(f,first),/lease-stale/);
  assert.throws(()=>f.execute(developer,'lease-release',{operationId:randomUUID(),lease:second}),/lease-stale/);
  assert.equal(commit(f,second,{title:'Other machine'},other).revision,2);
});

test('task leases are shared and intent/task ownership is not confused',t=>{
  const f=fixture(t),task=claim(f,developer,{kind:'task',taskId:'T-001'});
  assert.throws(()=>claim(f,other,{kind:'task',taskId:'T-001',machineId:'machine-b'}),/lease-conflict/);
  assert.throws(()=>claim(f,developer,{kind:'task',taskId:'unknown'}),/task-unknown/);
  assert.throws(()=>commit(f,task),/lease-kind-invalid/);
  const intent=claim(f);assert.equal(commit(f,intent,{title:'Still coordinated'}).revision,2);
});

test('approval fields cannot be forged through commit or seed by a developer',t=>{
  const f=fixture(t),lease=claim(f);
  const delivery={schema:'ewai.delivery-state/v1',slug:'example',approvals:{build:{approvedBy:'Forged'}},humanGates:[]};
  assert.throws(()=>commit(f,lease,{delivery}),/approval-role-required/);
  const projection={path:'6.Build/example/gates/build/build-approval.json',content:{decision:'approved'}};
  assert.throws(()=>commit(f,lease,{projections:[projection]}),/approval-role-required/);
  assert.throws(()=>f.execute(developer,'seed-intent',{operationId:randomUUID(),confirmed:true,record:{...record(),id:'platform/another',slug:'another',delivery}}),/seed-role-required/);
  f.execute(developer,'lease-release',{operationId:randomUUID(),lease});
  const review=claim(f,approver,{action:'approve-build'});
  assert.throws(()=>commit(f,review,{delivery},approver),/delivery-initial-state-invalid/);
});

test('project scoping, reader permissions and authored source revisions are enforced',t=>{
  const f=fixture(t);
  assert.throws(()=>f.execute({...developer,projects:['elsewhere']},'list-intents'),/project-forbidden/);
  assert.throws(()=>claim(f,{...developer,role:'reader'}),/write-role-required/);
  const lease=claim(f);
  assert.throws(()=>commit(f,lease,{bodyHash:hash('changed')}),/document-publication-required/);
  assert.throws(()=>commit(f,lease,{projections:[{path:'../../secret',content:{}}]}),/projection-path-invalid/);
  assert.throws(()=>commit(f,lease,{title:['','home','example'].join('/')}),/private-path/);
});

test('source publication is explicit and cannot silently replace a newer central revision',t=>{
  const f=fixture(t),lease=claim(f,developer,{action:'publish-document'});
  const result=commit(f,lease,{bodyHash:hash('updated requirements')});
  assert.equal(result.revision,2);assert.equal(result.record.bodyHash,hash('updated requirements'));
  const events=f.execute(owner,'list-events');assert.ok(events.events.some(e=>e.action==='commit-intent'&&e.actorId==='developer'));
  const exported=f.execute(owner,'export-project');assert.equal(exported.intents.length,1);assert.ok(!JSON.stringify(exported).includes(lease.token));
});

test('restart preserves records/receipts but invalidates previously active lease epochs',t=>{
  const root=mkdtempSync(join(tmpdir(),'ewai-coordination-restart-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  let store=createCoordinationStore(root);
  store.execute(owner,'example','create-project',{operationId:randomUUID(),name:'Example'});
  const seed={operationId:randomUUID(),record:record(),confirmed:true};store.execute(owner,'example','seed-intent',seed);
  const lease=store.execute(developer,'example','lease-acquire',{operationId:randomUUID(),intentId:'platform/example',kind:'intent',machineId:'machine-a',ttlMs:30000,action:'update-projection'});
  const identity=store.identity;store.close();store=createCoordinationStore(root);t.after(()=>store.close());
  assert.equal(store.identity,identity);assert.equal(store.execute(owner,'example','seed-intent',seed).revision,1);
  assert.throws(()=>store.execute(developer,'example','lease-renew',{operationId:randomUUID(),lease,ttlMs:30000}),/lease-stale/);
});

test('HTTP service authenticates project requests and never accepts arbitrary SQL or commands',async t=>{
  const root=mkdtempSync(join(tmpdir(),'ewai-coordination-http-'));const token='a'.repeat(48);
  const app=await createCoordinationServer({dataRoot:root,host:'127.0.0.1',port:0,credentials:[{...owner,token}]});
  t.after(async()=>{await app.close();rmSync(root,{recursive:true,force:true});});
  assert.equal((await fetch(app.url+'/health')).status,200);
  assert.equal((await fetch(app.url+'/api/v1/projects/example/intents')).status,401);
  const response=await fetch(app.url+'/api/v1/projects/example/actions',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({action:'create-project',input:{operationId:randomUUID(),name:'Example'}})});
  assert.equal(response.status,200);
  const denied=await fetch(app.url+'/api/v1/projects/example/actions',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({action:'sql',input:{sql:'DROP TABLE intents'}})});
  assert.equal(denied.status,400);
  assert.ok(!JSON.stringify(await denied.json()).includes(token));
});

test('a projection cannot conceal approval differences from the canonical delivery object',t=>{
 const f=fixture(t),lease=claim(f);
 const forged={schema:'ewai.delivery-state/v1',slug:'example',approvals:{build:{approvedBy:'Forged'}}};
 assert.throws(()=>commit(f,lease,{projections:[{path:'6.Build/example/delivery-state.json',content:forged}]}),/delivery-projection-conflict/);
});
test('a generic projection lease cannot advance workflow phases',t=>{
 const f=fixture(t),lease=claim(f);
 const delivery={schema:'ewai.delivery-state/v1',slug:'example',currentPhase:'build',phases:[{id:'build',status:'completed'}]};
 assert.throws(()=>commit(f,lease,{delivery}),/delivery-action-conflict|delivery-state-conflict/);
});
test('receipts are denied after an actor loses its current approval role',t=>{
 const f=fixture(t),operationId=randomUUID();
 const input={operationId,intentId:'platform/example',kind:'intent',machineId:'review-machine',action:'approve-build',ttlMs:30000};
 f.execute(approver,'lease-acquire',input);
 assert.throws(()=>f.execute({...approver,role:'developer'},'lease-acquire',input),/approval-role-required/);
});

test('expired proposals recover against their unchanged predecessor with explicit confirmation',t=>{
 const f=fixture(t),lease=claim(f),originalOperationId=randomUUID();f.advance(30001);
 const input={operationId:randomUUID(),originalOperationId,intentId:'platform/example',expectedRevision:1,previousLease:lease,record:{...record(),title:'Recovered candidate'},confirmed:true};
 assert.throws(()=>f.execute(developer,'recover-proposal',{...input,confirmed:false}),/recovery-confirmation-required/);
 assert.equal(f.execute(developer,'recover-proposal',input).revision,2);
 assert.equal(f.execute(developer,'read-intent',{intentId:'platform/example'}).record.title,'Recovered candidate');
 assert.deepEqual(f.execute(developer,'recover-proposal',input),f.execute(developer,'read-intent',{intentId:'platform/example'}));
});
test('portable policy digests and serialised metadata remain protected',t=>{
 const f=fixture(t),lease=claim(f);
 assert.throws(()=>commit(f,lease,{work:{session:{},events:[{metadata_json:JSON.stringify({token:'fixture-sensitive-value'})}]}}),/credential-field-forbidden/);
});
test('task parallelism is checked atomically across different task resources',t=>{
 const f=fixture(t),lease=claim(f,owner,{action:'publish-document'});
 const graph={tasks:[...record().taskGraph.tasks,{id:'T-002',repo:'application',branch:'feature/second',write_set:['other/**']}],maxParallelTasks:1};
 commit(f,lease,{taskGraph:graph},owner);f.execute(owner,'lease-release',{operationId:randomUUID(),lease});
 claim(f,developer,{kind:'task',taskId:'T-001'});
 assert.throws(()=>claim(f,other,{kind:'task',taskId:'T-002',machineId:'machine-b'}),/task-parallelism-limit/);
});

test('a task capability cannot be recovered into intent ownership',t=>{
 const f=fixture(t),lease=claim(f,developer,{kind:'task',taskId:'T-001',action:'afk-build'});f.advance(30001);
 assert.throws(()=>f.execute(developer,'recover-proposal',{operationId:randomUUID(),originalOperationId:randomUUID(),intentId:'platform/example',expectedRevision:1,previousLease:lease,record:{...record(),title:'Escalated'},confirmed:true}),/lease-kind-invalid/);
});

test('required phase order and pending planning stages cannot be bypassed by validation records',()=>{
 const phases=canonicalDeliveryPhaseIds().map(id=>({id,status:id==='intent'?'running':id==='ideate'?'skipped':'pending'}));
 const delivery={schema:'ewai.delivery-state/v1',slug:'example',intent:{id:'platform/example'},status:'in-progress',currentPhase:'intent',phases,adjuncts:[{id:'ui-design',status:'skipped'},{id:'fit-check',status:'skipped'}],humanGates:[{id:'manual-qa',status:'pending'}],approvals:{build:null}};
 const before={...record(),delivery},after=structuredClone(before);
 after.delivery.phases=[phases[0],phases[1],phases.find(p=>p.id==='build'),...phases.slice(2).filter(p=>p.id!=='build')];
 assert.throws(()=>assertOperationalTransition(developer,before,after,'record-validation'),/delivery-phase-order-conflict/);
 const skipped=structuredClone(before);for(const phase of skipped.delivery.phases)if(phase.id!=='intent')phase.status='skipped';
 assert.throws(()=>assertOperationalTransition(developer,{...record(),delivery:null},skipped,'begin-harness'),/delivery-required-phase-skipped/);
});

test('task completion binds reports to the current source and fences late reports',t=>{
 const f=fixture(t),lease=claim(f,developer,{kind:'task',taskId:'T-001',action:'afk-build'});
 const evidence=['report.md','evidence.json'].map(name=>({path:'6.Build/example/tasks/T-001/'+name,sha256:hash(name),sourceFingerprint:source,taskId:'T-001',kind:'task-completion'}));
 const input={operationId:randomUUID(),intentId:'platform/example',expectedRevision:1,lease,evidence};
 assert.throws(()=>f.execute(developer,'complete-task',{...input,evidence:evidence.map(e=>({...e,sourceFingerprint:hash('different')}))}),/task-evidence-invalid/);
 const completed=f.execute(developer,'complete-task',input);assert.equal(completed.revision,2);assert.equal(completed.record.taskResults['T-001'].actorId,'developer');
 assert.equal(f.execute(other,'list-leases').leases[0].outcome,'completed');
 f.advance(30001);assert.throws(()=>f.execute(developer,'complete-task',{...input,operationId:randomUUID(),expectedRevision:2}),/lease-stale/);
});
