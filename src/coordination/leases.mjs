import {existsSync,readFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {projectPaths} from '../paths.mjs';
import {centralRequest,readConnection,isShared} from './client.mjs';
import {atomicPrivate,safeLocalPath} from './config.mjs';
import {fail,digest} from './contract.mjs';
const cachePath=root=>resolve(projectPaths(root).runtimeRoot,'runtime/coordination-task-leases.json');
const cache=root=>{const path=safeLocalPath(root,cachePath(root));return existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{};};
export function claimSharedTask(root,lease){
  const config=readConnection(root),handle=centralRequest(root,'lease-acquire',{operationId:randomUUID(),intentId:lease.workItemId,kind:'task',taskId:lease.taskId,machineId:config.machineId,action:'afk-build',ttlMs:Math.max(1000,new Date(lease.expiresAt).getTime()-Date.now())});
  const leases=cache(root);leases[handle.id]={handle,local:{...lease,id:handle.id,token:handle.token,expiresAt:new Date(handle.expiresAt).toISOString()}};atomicPrivate(root,cachePath(root),leases);return leases[handle.id].local;
}
export function updateSharedTask(root,id,input,release=false){
  const leases=cache(root),entry=leases[id];if(!entry||entry.handle.token!==input.token)fail('lease-stale');
  if(release&&input.outcome==='completed'){
    const current=centralRequest(root,'read-intent',{intentId:entry.handle.intentId});
    if(!entry.completionInput){
      const base=`6.Build/${current.record.slug}/tasks/${entry.handle.taskId}/`;
      const evidence=['report.md','evidence.json'].map(name=>({path:base+name,sha256:digest(readFileSync(safeLocalPath(root,resolve(projectPaths(root).specsRoot,base+name)),'utf8')),sourceFingerprint:current.record.bodyHash,taskId:entry.handle.taskId,kind:'task-completion'}));
      entry.completionInput={operationId:entry.handle.id+':complete',intentId:entry.handle.intentId,expectedRevision:current.revision,lease:entry.handle,evidence};atomicPrivate(root,cachePath(root),leases);
    }
    try{centralRequest(root,'complete-task',entry.completionInput);}catch(error){
      if(error.code!=='revision-conflict')throw error;
      const refreshed=centralRequest(root,'read-intent',{intentId:entry.handle.intentId});
      if(entry.completionInput.evidence.some(e=>e.sourceFingerprint!==refreshed.record.bodyHash))fail('task-source-diverged');
      entry.completionInput={...entry.completionInput,expectedRevision:refreshed.revision};atomicPrivate(root,cachePath(root),leases);
      centralRequest(root,'complete-task',entry.completionInput);
    }
  }
  const result=centralRequest(root,release?'lease-release':'lease-renew',{operationId:randomUUID(),lease:entry.handle,...(release?{}:{ttlMs:input.durationMs??900000})});
  entry.handle=result;entry.local={...entry.local,status:result.status,expiresAt:new Date(result.expiresAt).toISOString(),...(release?{releasedAt:new Date().toISOString(),outcome:input.outcome??'released'}:{heartbeatAt:new Date().toISOString()})};atomicPrivate(root,cachePath(root),leases);return entry.local;
}
export function listSharedTasks(root,options={}){
  const privateLeases=cache(root);
  return centralRequest(root,'list-leases').leases.filter(lease=>lease.kind==='task'&&(!options.activeOnly||lease.status==='active')&&(!options.workItemId||options.workItemId===lease.intentId)).map(handle=>{
    const local=privateLeases[handle.id]?.local;
    const result={...(local??{}),id:handle.id,workItemId:handle.intentId,taskId:handle.taskId,ownerId:local?.ownerId??handle.actorId,tool:local?.tool??'',runId:local?.runId??handle.machineId,status:handle.status,expiresAt:new Date(handle.expiresAt).toISOString(),acquiredAt:local?.acquiredAt??'',heartbeatAt:local?.heartbeatAt??'',releasedAt:local?.releasedAt??null,outcome:handle.outcome||local?.outcome||''};
    if(!options.includeTokens||!local)delete result.token;return result;
  });
}
export function mirrorSharedTasks(root,database){
  if(!isShared(root))return;
  const leases=listSharedTasks(root,{includeTokens:true});
  database.exec('BEGIN IMMEDIATE;');
  try{
    database.prepare("UPDATE execution_leases SET status='superseded' WHERE status='active'").run();
    for(const lease of leases){if(!database.prepare('SELECT id FROM work_items WHERE id=?').get(lease.workItemId))continue;
      database.prepare(`INSERT INTO execution_leases(id,work_item_id,task_id,owner_id,tool,run_id,token,status,acquired_at,heartbeat_at,expires_at,released_at,outcome)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,expires_at=excluded.expires_at,heartbeat_at=excluded.heartbeat_at,released_at=excluded.released_at,outcome=excluded.outcome`).run(lease.id,lease.workItemId,lease.taskId,lease.ownerId,lease.tool,lease.runId,lease.token??'remote-redacted:'+lease.id,lease.status,lease.acquiredAt,lease.heartbeatAt,lease.expiresAt,lease.releasedAt,lease.outcome);
    }
    database.exec('COMMIT;');
  }catch(error){database.exec('ROLLBACK;');throw error;}
}
export function abandonSharedRun(root,runId,input={}){const leases=cache(root),results=[];for(const [id,entry]of Object.entries(leases))if(entry.local.runId===runId&&entry.handle.status==='active')results.push(updateSharedTask(root,id,{token:entry.handle.token,outcome:input.outcome??'abandoned'},true));return results;}
