import {assertOperationalTransition} from './transitions.mjs';
import {mkdirSync,chmodSync,lstatSync,existsSync,openSync,closeSync,writeFileSync,readFileSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {validateTeamHubDataRoot} from '../runtime/team-hub-database.mjs';
import {protocol,fail,id,intentId,revision,ttl,operationId,authorize,owner,fields,text,digest,validateRecord,assertApprovalChange,mutationActions} from './contract.mjs';

const writes=new Set(['create-project','create-intent','seed-intent','lease-acquire','lease-renew','lease-release','commit-intent','register-evidence','complete-task','recover-proposal','abandon-operation','append-event','recover-lease']);
const actions=new Set([...writes,'read-project','read-intent','list-intents','list-leases','operation-status','list-events','export-project','lease-assert']);
const decode=row=>row?{revision:row.revision,record:JSON.parse(row.record_json),updatedAt:row.updated_at}:null;

export function createCoordinationStore(dataRoot,options={}){
  const root=validateTeamHubDataRoot(dataRoot);mkdirSync(root,{recursive:true,mode:0o700});chmodSync(root,0o700);
  const lockPath=resolve(root,'coordination.lock');
  let lock;
  try{lock=openSync(lockPath,'wx',0o600);}catch(error){
    if(error.code!=='EEXIST')throw error;
    if(lstatSync(lockPath).isSymbolicLink())fail('database-lock-unsafe',400);
    let previous;try{previous=JSON.parse(readFileSync(lockPath,'utf8'));}catch{fail('database-lock-recovery-required');}
    try{process.kill(previous.pid,0);fail('database-already-open');}catch(check){if(check.code!=='ESRCH')throw check;}
    unlinkSync(lockPath);lock=openSync(lockPath,'wx',0o600);
  }
  writeFileSync(lock,JSON.stringify({pid:process.pid}));closeSync(lock);
  const path=resolve(root,'coordination.sqlite');if(existsSync(path)&&lstatSync(path).isSymbolicLink())fail('database-path-unsafe',400);
  const db=new DatabaseSync(path);chmodSync(path,0o600);db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(`CREATE TABLE IF NOT EXISTS coordination_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS intents(project_id TEXT NOT NULL,intent_id TEXT NOT NULL,revision INTEGER NOT NULL,record_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(project_id,intent_id),FOREIGN KEY(project_id) REFERENCES projects(id));
    CREATE TABLE IF NOT EXISTS leases(project_id TEXT NOT NULL,resource TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,intent_id TEXT NOT NULL,task_id TEXT,actor_id TEXT NOT NULL,machine_id TEXT NOT NULL,action TEXT NOT NULL,generation INTEGER NOT NULL,epoch TEXT NOT NULL,token_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,status TEXT NOT NULL,PRIMARY KEY(project_id,resource));
    CREATE TABLE IF NOT EXISTS operations(project_id TEXT NOT NULL,actor_id TEXT NOT NULL,operation_id TEXT NOT NULL,input_hash TEXT NOT NULL,result_json TEXT NOT NULL,required_role TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_id,actor_id,operation_id));
    CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL,intent_id TEXT,revision INTEGER,operation_id TEXT NOT NULL,created_at TEXT NOT NULL,details_json TEXT);`);
  db.prepare("INSERT OR IGNORE INTO coordination_meta(key,value) VALUES('identity',?)").run(randomUUID());
  const identity=db.prepare("SELECT value FROM coordination_meta WHERE key='identity'").get().value;
  const epoch=randomUUID(),now=options.now??Date.now;
  db.prepare("UPDATE leases SET status='interrupted' WHERE status='active'").run();
  const read=(project,reference)=>{const result=decode(db.prepare('SELECT * FROM intents WHERE project_id=? AND intent_id=?').get(project,intentId(reference)));if(!result)fail('intent-not-found',404);return result;};
  const readProject=project=>{const result=db.prepare('SELECT * FROM projects WHERE id=?').get(project);if(!result)fail('project-not-found',404);return {id:result.id,name:result.name,identity,epoch,protocol};};
  function assertLease(actor,project,handle,kind=null){
    fields(handle,['id','resource','intentId','taskId','kind','actorId','machineId','action','generation','epoch','token','expiresAt','status']);
    const row=db.prepare('SELECT * FROM leases WHERE project_id=? AND resource=?').get(project,handle.resource);
    if(!row||row.status!=='active'||row.epoch!==epoch||handle.epoch!==epoch||row.id!==handle.id||row.generation!==handle.generation||row.actor_id!==actor.actorId||row.token_hash!==digest(String(handle.token??''))||row.expires_at<=now())fail('lease-stale');
    if(kind&&row.kind!==kind)fail('lease-kind-invalid',400);if(['approve-build','approve-manual-qa','ratify-plan','ratify-evidence'].includes(row.action)&&!['approver','owner'].includes(actor.role))fail('approval-role-required',403);return row;
  }
  function leaseView(row){return {id:row.id,resource:row.resource,intentId:row.intent_id,taskId:row.task_id,kind:row.kind,actorId:row.actor_id,machineId:row.machine_id,action:row.action,generation:row.generation,epoch:row.epoch,expiresAt:row.expires_at,status:row.status};}
  function event(actor,project,action,input,result){db.prepare('INSERT INTO events(project_id,actor_id,action,intent_id,revision,operation_id,created_at,details_json) VALUES(?,?,?,?,?,?,?,?)').run(project,actor.actorId,action,input.intentId??input.record?.id??input.lease?.intentId??null,result.revision??null,input.operationId,new Date(now()).toISOString(),action==='append-event'?JSON.stringify({kind:input.kind,summary:input.summary}):null);}
  function apply(actor,project,action,input){
    if(action==='create-project'){
      fields(input,['operationId','name']);owner(actor);text(input.name,'project-name',200);
      const existing=db.prepare('SELECT name FROM projects WHERE id=?').get(project);if(existing)fail('project-exists');
      db.prepare('INSERT INTO projects VALUES(?,?,?)').run(project,input.name,new Date(now()).toISOString());return readProject(project);
    }
    readProject(project);
    if(action==='read-project'){fields(input,[]);return readProject(project);}
    if(action==='read-intent'){fields(input,['intentId']);return read(project,input.intentId);}
    if(action==='list-intents'){fields(input,[]);return {identity,epoch,intents:db.prepare('SELECT * FROM intents WHERE project_id=? ORDER BY intent_id').all(project).map(decode)};}
    if(action==='create-intent'){
      fields(input,['operationId','record']);const record=validateRecord(input.record);
      if(record.delivery!==null||record.state.status!=='draft'||record.projections.some(p=>p.path.includes('approval')||p.path.includes('/gates/')))fail('new-intent-must-be-draft',400);
      if(db.prepare('SELECT 1 FROM intents WHERE project_id=? AND intent_id=?').get(project,record.id))fail('intent-exists');
      db.prepare('INSERT INTO intents VALUES(?,?,?,?,?)').run(project,record.id,1,JSON.stringify(record),new Date(now()).toISOString());return read(project,record.id);
    }
    if(action==='seed-intent'){
      fields(input,['operationId','record','confirmed']);if(actor.role!=='owner')fail('seed-role-required',403);if(input.confirmed!==true)fail('seed-confirmation-required',400);
      const record=validateRecord(input.record);if(db.prepare('SELECT 1 FROM intents WHERE project_id=? AND intent_id=?').get(project,record.id))fail('intent-exists');
      db.prepare('INSERT INTO intents VALUES(?,?,?,?,?)').run(project,record.id,1,JSON.stringify(record),new Date(now()).toISOString());return read(project,record.id);
    }
    if(action==='lease-acquire'){
      fields(input,['operationId','intentId','kind','taskId','machineId','action','ttlMs']);const current=read(project,input.intentId);
      id(input.machineId,'machine-id');const kind=input.kind??'intent';if(!['intent','task'].includes(kind))fail('lease-kind-invalid',400);
      if(!mutationActions.has(input.action))fail('mutation-action-invalid',400);
      if(['approve-build','approve-manual-qa','ratify-plan','ratify-evidence'].includes(input.action)&&!['approver','owner'].includes(actor.role))fail('approval-role-required',403);
      const taskId=kind==='task'?text(input.taskId,'task-id',100):null;
      if(kind==='task'&&!current.record.taskGraph?.tasks?.some(task=>task.id===taskId))fail('task-unknown',400);
      const resource=kind+':'+current.record.id+(taskId?':'+taskId:'');
      const previous=db.prepare('SELECT * FROM leases WHERE project_id=? AND resource=?').get(project,resource);
      if(previous?.status==='active'&&previous.epoch===epoch&&previous.expires_at>now())fail('lease-conflict');
      if(kind==='task'){
        const active=db.prepare("SELECT * FROM leases WHERE project_id=? AND intent_id=? AND kind='task' AND status='active' AND epoch=? AND expires_at>?").all(project,current.record.id,epoch,now());
        if(active.length>=(current.record.taskGraph.maxParallelTasks??1))fail('task-parallelism-limit');
        const proposed=current.record.taskGraph.tasks.find(task=>task.id===taskId);
        const stem=value=>value.replaceAll('\\','/').replace(/\*.*$/,'').replace(/\/$/,'');
        for(const lease of active){const task=current.record.taskGraph.tasks.find(task=>task.id===lease.task_id);
          if(task?.repo!==proposed.repo)continue;
          if(task.write_set.some(a=>proposed.write_set.some(b=>{a=stem(a);b=stem(b);return !a||!b||a===b||a.startsWith(b+'/')||b.startsWith(a+'/');})))fail('task-write-conflict');
        }
      }
      const token=randomUUID()+randomUUID(),row={id:randomUUID(),resource,intent_id:current.record.id,task_id:taskId,kind,actor_id:actor.actorId,machine_id:input.machineId,action:input.action,generation:(previous?.generation??0)+1,epoch,token_hash:digest(token),expires_at:now()+ttl(input.ttlMs),status:'active'};
      db.prepare(`INSERT INTO leases VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,resource) DO UPDATE SET id=excluded.id,kind=excluded.kind,intent_id=excluded.intent_id,task_id=excluded.task_id,actor_id=excluded.actor_id,machine_id=excluded.machine_id,action=excluded.action,generation=excluded.generation,epoch=excluded.epoch,token_hash=excluded.token_hash,expires_at=excluded.expires_at,status=excluded.status`).run(project,resource,row.id,kind,row.intent_id,taskId,row.actor_id,row.machine_id,row.action,row.generation,epoch,row.token_hash,row.expires_at,row.status);
      return {...leaseView(row),token};
    }
    if(action==='lease-assert'){fields(input,['lease']);return leaseView(assertLease(actor,project,input.lease));}
    if(action==='lease-renew'||action==='lease-release'){
      fields(input,action==='lease-renew'?['operationId','lease','ttlMs']:['operationId','lease']);const row=assertLease(actor,project,input.lease);
      if(action==='lease-release')db.prepare("UPDATE leases SET status='released' WHERE project_id=? AND resource=?").run(project,row.resource);
      else db.prepare('UPDATE leases SET expires_at=? WHERE project_id=? AND resource=?').run(now()+ttl(input.ttlMs),project,row.resource);
      const after=db.prepare('SELECT * FROM leases WHERE project_id=? AND resource=?').get(project,row.resource);return {...leaseView(after),token:input.lease.token};
    }
    if(action==='list-leases'){
      fields(input,['intentId']);if(input.intentId)intentId(input.intentId);
      const rows=db.prepare('SELECT * FROM leases WHERE project_id=? ORDER BY resource').all(project);
      return {leases:rows.filter(row=>!input.intentId||row.intent_id===input.intentId).map(row=>{const completed=row.kind==='task'?read(project,row.intent_id).record.taskResults?.[row.task_id]:null;return {...leaseView(row),outcome:completed?.generation===row.generation?'completed':'',status:row.status==='active'&&(row.expires_at<=now()||row.epoch!==epoch)?'expired':row.status};})};
    }
    if(action==='commit-intent'){
      fields(input,['operationId','intentId','expectedRevision','lease','record']);const current=read(project,input.intentId);
      if(revision(input.expectedRevision)!==current.revision)fail('revision-conflict');
      const lease=assertLease(actor,project,input.lease,'intent');if(lease.intent_id!==input.intentId)fail('lease-intent-conflict',403);
      const record=validateRecord(input.record);if(record.id!==current.record.id)fail('intent-identity-conflict',400);
      if(digest(current.record.taskResults??{})!==digest(record.taskResults??{}))fail('task-result-action-required');
      const activeTasks=db.prepare("SELECT COUNT(*) AS count FROM leases WHERE project_id=? AND intent_id=? AND kind='task' AND status='active' AND epoch=? AND expires_at>?").get(project,record.id,epoch,now()).count;
      if(activeTasks&&(record.bodyHash!==current.record.bodyHash||digest(record.taskGraph)!==digest(current.record.taskGraph)))fail('active-task-source-change');
      if(activeTasks&&current.record.delivery?.phases?.some(p=>p.id==='build'&&p.status==='running')&&record.delivery?.phases?.some(p=>p.id==='build'&&p.status==='completed'))fail('active-task-completion-blocked');
      assertApprovalChange(actor,current.record,record);
      assertOperationalTransition(actor,current.record,record,lease.action);
      if(record.bodyHash!==current.record.bodyHash&&lease.action!=='publish-document')fail('document-publication-required');
      db.prepare('UPDATE intents SET revision=?,record_json=?,updated_at=? WHERE project_id=? AND intent_id=?').run(current.revision+1,JSON.stringify(record),new Date(now()).toISOString(),project,record.id);
      return read(project,record.id);
    }
    if(action==='register-evidence'){
      fields(input,['operationId','intentId','expectedRevision','lease','evidence']);const current=read(project,input.intentId);
      const next={...current.record,evidence:[...current.record.evidence,input.evidence]};return apply(actor,project,'commit-intent',{operationId:input.operationId,intentId:input.intentId,expectedRevision:input.expectedRevision,lease:input.lease,record:next});
    }
    if(action==='abandon-operation'){
      fields(input,['operationId','intentId','expectedRevision','previousLease','confirmed','executionStopped','reason']);owner(actor);
      if(input.confirmed!==true||input.executionStopped!==true)fail('stopped-execution-confirmation-required',400);text(input.reason,'recovery-reason',500);
      const current=read(project,input.intentId);if(current.revision!==revision(input.expectedRevision))fail('revision-conflict');
      const row=db.prepare('SELECT * FROM leases WHERE project_id=? AND resource=?').get(project,input.previousLease?.resource);
      if(!row||row.id!==input.previousLease.id||row.intent_id!==input.intentId||row.token_hash!==digest(String(input.previousLease.token??'')))fail('recovery-capability-invalid',403);
      if(row.status==='active'&&row.epoch===epoch&&row.expires_at>now())fail('lease-conflict');
      db.prepare("UPDATE leases SET status='recovered',generation=generation+1 WHERE project_id=? AND resource=?").run(project,row.resource);
      return {abandoned:true,revision:current.revision,record:current.record,executionStoppedAttestedBy:actor.actorId};
    }
    if(action==='recover-proposal'){
      fields(input,['operationId','originalOperationId','intentId','expectedRevision','previousLease','record','confirmed']);
      if(input.confirmed!==true)fail('recovery-confirmation-required',400);
      operationId(input.originalOperationId);const current=read(project,input.intentId);
      const previous=db.prepare('SELECT * FROM leases WHERE project_id=? AND resource=?').get(project,input.previousLease?.resource);
      if(previous?.kind!=='intent')fail('lease-kind-invalid',400);
      if(!previous||previous.id!==input.previousLease.id||previous.token_hash!==digest(String(input.previousLease.token??''))||previous.intent_id!==input.intentId)fail('recovery-capability-invalid',403);
      if(previous.actor_id!==actor.actorId&&actor.role!=='owner')fail('recovery-actor-conflict',403);
      if(['approve-build','approve-manual-qa','ratify-plan','ratify-evidence'].includes(previous.action)&&!['approver','owner'].includes(actor.role))fail('approval-role-required',403);
      const receipt=db.prepare('SELECT result_json FROM operations WHERE project_id=? AND actor_id=? AND operation_id=?').get(project,previous.actor_id,input.originalOperationId);
      if(receipt)return JSON.parse(receipt.result_json);
      if(current.revision!==revision(input.expectedRevision))fail('revision-conflict');
      if(previous.status==='active'&&previous.epoch===epoch&&previous.expires_at>now())fail('lease-conflict');
      const lease=apply(actor,project,'lease-acquire',{operationId:input.operationId+':lease',intentId:input.intentId,kind:'intent',machineId:input.previousLease.machineId,action:previous.action,ttlMs:30000});
      const result=apply(actor,project,'commit-intent',{operationId:input.operationId,intentId:input.intentId,expectedRevision:input.expectedRevision,lease,record:input.record});
      apply(actor,project,'lease-release',{operationId:input.operationId+':release',lease});return result;
    }
    if(action==='complete-task'){
      fields(input,['operationId','intentId','expectedRevision','lease','evidence']);const current=read(project,input.intentId);
      const lease=assertLease(actor,project,input.lease,'task');if(lease.intent_id!==input.intentId)fail('lease-intent-conflict',403);
      if(revision(input.expectedRevision)!==current.revision)fail('revision-conflict');
      if(!Array.isArray(input.evidence)||!input.evidence.length||input.evidence.some(e=>e.taskId!==lease.task_id||e.sourceFingerprint!==current.record.bodyHash||!e.path.startsWith(`6.Build/${current.record.slug}/tasks/${lease.task_id}/`)))fail('task-evidence-invalid',400);
      if(!input.evidence.some(e=>e.path.endsWith('/report.md'))||!input.evidence.some(e=>e.path.endsWith('/evidence.json')))fail('task-evidence-incomplete',400);
      const result={taskId:lease.task_id,outcome:'completed',actorId:actor.actorId,machineId:lease.machine_id,generation:lease.generation,completedAt:new Date(now()).toISOString(),evidence:input.evidence};
      const record=validateRecord({...current.record,evidence:[...new Map([...current.record.evidence,...input.evidence].map(e=>[e.path,e])).values()],taskResults:{...current.record.taskResults,[lease.task_id]:result}});
      db.prepare('UPDATE intents SET revision=?,record_json=?,updated_at=? WHERE project_id=? AND intent_id=?').run(current.revision+1,JSON.stringify(record),new Date(now()).toISOString(),project,record.id);return read(project,record.id);
    }
    if(action==='append-event'){
      fields(input,['operationId','intentId','kind','summary']);read(project,input.intentId);text(input.kind,'event-kind',60);text(input.summary,'event-summary',500);
      // Summaries are audit annotations, not workflow/approval mutations.
      return {recorded:true,intentId:input.intentId};
    }
    if(action==='recover-lease'){
      fields(input,['operationId','intentId','resource','expectedGeneration','confirmed','reason']);owner(actor);if(input.confirmed!==true)fail('recovery-confirmation-required',400);text(input.reason,'recovery-reason',500);
      const row=db.prepare('SELECT * FROM leases WHERE project_id=? AND resource=?').get(project,input.resource);
      if(!row||row.intent_id!==input.intentId||row.generation!==input.expectedGeneration)fail('lease-stale');
      db.prepare("UPDATE leases SET status='recovered',generation=generation+1 WHERE project_id=? AND resource=?").run(project,row.resource);
      return {recovered:true,executionStopped:false};
    }
    if(action==='operation-status'){
      fields(input,['operationId']);operationId(input.operationId);
      const row=db.prepare('SELECT result_json FROM operations WHERE project_id=? AND actor_id=? AND operation_id=?').get(project,actor.actorId,input.operationId);
      if(!row)fail('operation-not-found',404);return JSON.parse(row.result_json);
    }
    if(action==='list-events'){fields(input,[]);return {events:db.prepare('SELECT sequence,actor_id AS actorId,action,intent_id AS intentId,revision,operation_id AS operationId,created_at AS createdAt,details_json AS details FROM events WHERE project_id=? ORDER BY sequence DESC LIMIT 500').all(project)};}
    if(action==='export-project'){fields(input,[]);return {...readProject(project),intents:apply(actor,project,'list-intents',{}).intents,events:apply(actor,project,'list-events',{}).events};}
    fail('action-invalid',400);
  }
  function execute(actor,project,action,input={}){
    id(project,'project-id');if(!actions.has(action))fail('action-invalid',400);authorize(actor,project,writes.has(action));
    if(!writes.has(action))return apply(actor,project,action,input);
    operationId(input.operationId);const fingerprint=digest({action,input});
    db.exec('BEGIN IMMEDIATE;');
    try{
      const existing=db.prepare('SELECT * FROM operations WHERE project_id=? AND actor_id=? AND operation_id=?').get(project,actor.actorId,input.operationId);
      if(existing){if(existing.required_role==='owner')owner(actor);if(existing.required_role==='approver'&&!['owner','approver'].includes(actor.role))fail('approval-role-required',403);if(existing.input_hash!==fingerprint)fail('operation-id-conflict');const replay=JSON.parse(existing.result_json);db.exec('COMMIT;');return replay;}
      const result=apply(actor,project,action,input);event(actor,project,action,input,result);
      const requiredRole=['create-project','seed-intent','recover-lease','abandon-operation'].includes(action)?'owner':(['approver','owner'].includes(actor.role)?'approver':'developer');
      db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?,?)').run(project,actor.actorId,input.operationId,fingerprint,JSON.stringify(result),requiredRole,new Date(now()).toISOString());
      db.exec('COMMIT;');return result;
    }catch(error){db.exec('ROLLBACK;');throw error;}
  }
  return {identity,epoch,execute,close:()=>{db.close();try{unlinkSync(lockPath);}catch(error){if(error.code!=='ENOENT')throw error;}}};
}
