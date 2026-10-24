import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync,rmSync,readdirSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {projectPaths} from '../paths.mjs';
import {centralRequest,isShared,readConnection} from './client.mjs';
import {captureRecord,hydrateRecord,localIntentId} from './workspace.mjs';
import {atomicPrivate,safeLocalPath} from './config.mjs';
import {fail,digest} from './contract.mjs';
const context=new AsyncLocalStorage();
const journalRoot=root=>resolve(projectPaths(root).runtimeRoot,'runtime/coordination');
export function deferCoordinationEvent(root,descriptor,callback){const scope=context.getStore();if(scope?.root===realpathSync(root)){scope.events.push({descriptor,callback});return true;}return false;}
export function sharedMutationActive(root){return context.getStore()?.root===realpathSync(root);}
export function pendingOperations(root){const folder=journalRoot(root);safeLocalPath(root,folder);if(!existsSync(folder))return [];return readdirSync(folder).filter(name=>name.endsWith('.json')).map(name=>{try{return JSON.parse(readFileSync(safeLocalPath(root,resolve(folder,name)),'utf8'));}catch{fail('coordination-journal-invalid',400);}});}
export function refreshSharedIntent(root,reference){
  if(!isShared(root)||sharedMutationActive(root))return null;
  if(pendingOperations(root).length)fail('coordination-recovery-required');
  const id=reference.includes('/')?reference:localIntentId(root,reference);
  const current=centralRequest(root,'read-intent',{intentId:id});hydrateRecord(root,current.record);return current;
}
export function refreshSharedCatalog(root){
  if(!isShared(root)||sharedMutationActive(root))return null;
  if(pendingOperations(root).length)fail('coordination-recovery-required');
  const result=centralRequest(root,'list-intents');
  for(const current of result.intents){const known=readConnection(root).revisions?.[current.record.id]??0;if(current.revision<known)fail('coordination-revision-rollback');
    try{hydrateRecord(root,current.record);}catch(error){if(!['local-source-missing','local-task-graph-diverged','local-source-diverged'].includes(error.code))throw error;}
  }
  return result;
}
export function withSharedMutation(root,reference,operation,callback){
  root=realpathSync(root);if(!isShared(root)||sharedMutationActive(root))return callback();
  if(pendingOperations(root).length)fail('coordination-recovery-required');
  const local={id:localIntentId(root,reference)},current=centralRequest(root,'read-intent',{intentId:local.id});
  hydrateRecord(root,current.record);
  const config=readConnection(root),borrowed=operation.ownership?.coordination,lease=borrowed??centralRequest(root,'lease-acquire',{operationId:randomUUID(),intentId:local.id,kind:'intent',machineId:config.machineId,action:operation.action,ttlMs:600000});
  if(borrowed)centralRequest(root,'lease-assert',{lease:borrowed});
  const operationId=randomUUID(),path=resolve(journalRoot(root),operationId+'.json');
  const journal={schema:'ewai.coordination-operation/v1',operationId,intentId:local.id,expectedRevision:current.revision,status:'prepared',lease,nativeOperationId:operation.id??operation.mutationId};
  atomicPrivate(root,path,journal);let committed=false;
  const scope={root,events:[]};
  try{
    const result=context.run(scope,callback);if(result?.then)fail('intent-mutation-must-be-synchronous',400);
    const captured=captureRecord(root,local.id),next={...current.record,...captured,evidence:[...new Map([...current.record.evidence,...captured.evidence].map(e=>[e.path,e])).values()],work:captured.work?{...captured.work,...(current.record.work?.actorId?{actorId:current.record.work.actorId}:{})}:null};
    // Omit absent optional fields rather than serialising undefined through the helper bridge.
    if(next.work===undefined)delete next.work;
    const input={operationId,intentId:local.id,expectedRevision:current.revision,lease,record:next};
    atomicPrivate(root,path,{...journal,status:'proposed',input,events:scope.events.map(event=>event.descriptor)});
    const receipt=centralRequest(root,'commit-intent',input);committed=true;
    atomicPrivate(root,path,{...journal,status:'committed',revision:receipt.revision,events:scope.events.map(event=>event.descriptor)});
    for(const event of scope.events)event.callback();
    rmSync(path);return result;
  }catch(error){
    // Unknown outcomes remain durable and block further writes. Never repeat a native callback.
    if(!committed&&error.code!=='coordination-unavailable'){
      try{const authoritative=centralRequest(root,'read-intent',{intentId:local.id});hydrateRecord(root,authoritative.record);rmSync(path);}catch{}
    }
    throw error;
  }finally{if(!borrowed&&!existsSync(path))try{centralRequest(root,'lease-release',{operationId:randomUUID(),lease});}catch{}}
}
export async function reconcileOperation(root,operationId,options={}){
  const pending=pendingOperations(root).find(item=>item.operationId===operationId);if(!pending)fail('pending-operation-not-found',404);
  centralRequest(root,'read-intent',{intentId:pending.intentId});
  let receipt;try{receipt=centralRequest(root,'operation-status',{operationId});}catch(error){if(error.code!=='operation-not-found')throw error;}
  if(!receipt&&pending.status==='proposed'){
    // Retrying the recorded CAS payload is safe; the local operation is never re-executed.
    try{receipt=centralRequest(root,'commit-intent',pending.input);}catch(error){
      if(error.code!=='lease-stale')throw error;
      if(options.confirmed!==true)fail('recovery-confirmation-required',400);
      receipt=centralRequest(root,'recover-proposal',{operationId:operationId+':recover',originalOperationId:operationId,intentId:pending.intentId,expectedRevision:pending.expectedRevision,previousLease:pending.lease,record:pending.input.record,confirmed:true});
    }
  }
  if(!receipt&&pending.status!=='prepared'&&pending.status!=='committed')fail('coordination-recovery-required');
  if(!receipt&&pending.status==='prepared'){
    if(!options.confirmed||!options.executionStopped)fail('local-operation-review-required');
    const current=centralRequest(root,'read-intent',{intentId:pending.intentId});
    receipt=centralRequest(root,'abandon-operation',{operationId:operationId+':abandon',intentId:pending.intentId,expectedRevision:current.revision,previousLease:pending.lease,confirmed:true,executionStopped:true,reason:options.reason??'Owner reviewed and stopped the interrupted local operation; restore its authoritative operational projection.'});
  }
  const current=centralRequest(root,'read-intent',{intentId:pending.intentId});
  hydrateRecord(root,current.record);
  if(receipt?.abandoned&&pending.nativeOperationId){
    const {recordSharedOperationResolution}=await import('../runtime/autonomy-operations.mjs');
    recordSharedOperationResolution(root,pending.nativeOperationId,{intentId:pending.intentId,identity:readConnection(root).identity,revision:receipt.revision,decision:'abandoned',attestedBy:receipt.executionStoppedAttestedBy,centralOperationId:operationId+':abandon'});
  }
  if(pending.events?.length){const {publishLifecycleEvent}=await import('../runtime/lifecycle-hooks.mjs');for(const event of pending.events)publishLifecycleEvent(root,event.eventName,event.input);}
  rmSync(resolve(journalRoot(root),operationId+'.json'));
  try{centralRequest(root,'lease-release',{operationId:randomUUID(),lease:pending.lease});}catch{}
  return {reconciled:true,intentId:pending.intentId,revision:receipt?.revision??current.revision,lifecycleReconciliationRequired:false};
}
