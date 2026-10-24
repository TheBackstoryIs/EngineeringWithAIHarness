import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {requestSync,centralRequest,readConnection} from './client.mjs';
import {saveConnection,validateConnection} from './config.mjs';
import {captureRecord,localIntentIds,hydrateRecord} from './workspace.mjs';
import {pendingOperations,reconcileOperation} from './integration.mjs';
import {startCoordinationService,stopCoordinationService,coordinationServiceStatus} from './service.mjs';
import {fail} from './contract.mjs';
const option=(args,name,fallback)=>{const index=args.indexOf(name);return index<0?fallback:args[index+1];};
export async function coordinationCommand(root,args){
  const command=args[0];
  if(command==='serve'||command==='start')return startCoordinationService({dataRoot:option(args,'--data'),credentialsFile:resolve(option(args,'--credentials-file','coordination-actors.json')),host:option(args,'--host','127.0.0.1'),port:Number(option(args,'--port',47747)),allowNetwork:args.includes('--allow-network')});
  if(command==='stop')return stopCoordinationService(option(args,'--data'));
  if(command==='server-status')return coordinationServiceStatus(option(args,'--data'));
  if(command==='connect'){
    if(!args.includes('--yes'))fail('connection-confirmation-required',400);
    const existing=readConnection(root);if(existing?.mode==='shared')fail('shared-connection-exists');
    const draft={schema:'ewai.coordination-connection/v1',endpoint:option(args,'--url'),projectId:option(args,'--project-id'),machineId:option(args,'--machine-id'),tokenEnv:option(args,'--token-env'),mode:'shared',revisions:{}};
    validateConnection({...draft,identity:'unverified'});
    const response=requestSync(draft,'read-project');
    if(existing&&(existing.identity!==response.identity||existing.projectId!==draft.projectId))fail('connection-reconciliation-required');
    return saveConnection(root,{...draft,identity:response.identity,revisions:existing?.revisions??{}});
  }
  if(command==='create-project'){
    if(!args.includes('--yes'))fail('project-confirmation-required',400);
    const connection={endpoint:option(args,'--url'),projectId:option(args,'--project-id'),tokenEnv:option(args,'--token-env')};
    return requestSync(connection,'create-project',{operationId:randomUUID(),name:option(args,'--name',connection.projectId)}).result;
  }
  const connection=readConnection(root);if(!connection)fail('shared-connection-required',400);
  if(command==='status')return {...connection,pending:pendingOperations(root).map(({operationId,intentId,status})=>({operationId,intentId,status})),server:centralRequest(root,'read-project')};
  if(command==='seed'){
    if(!args.includes('--yes'))fail('seed-confirmation-required',400);
    const ids=args[1]&&!args[1].startsWith('--')?[captureRecord(root,args[1]).id]:localIntentIds(root),results=[];
    for(const id of ids)results.push(centralRequest(root,'seed-intent',{operationId:randomUUID(),confirmed:true,record:captureRecord(root,id)}));return {seeded:results.map(item=>({id:item.record.id,revision:item.revision}))};
  }
  if(command==='publish'){
    const record=captureRecord(root,args[1]),current=centralRequest(root,'read-intent',{intentId:record.id});
    const expectedRevision=Number(option(args,'--expected-revision'));
    if(expectedRevision!==current.revision)fail('revision-conflict');
    const lease=centralRequest(root,'lease-acquire',{operationId:randomUUID(),intentId:record.id,kind:'intent',machineId:connection.machineId,action:'publish-document',ttlMs:30000});
    try{return centralRequest(root,'commit-intent',{operationId:randomUUID(),intentId:record.id,expectedRevision,lease,record:{...current.record,bodyHash:record.bodyHash,title:record.title,taskGraph:record.taskGraph}});}finally{centralRequest(root,'lease-release',{operationId:randomUUID(),lease});}
  }
  if(command==='read')return centralRequest(root,'read-intent',{intentId:captureRecord(root,args[1]).id});
  if(command==='export'){
    const exported=centralRequest(root,'export-project');const output=option(args,'--output');if(output)writeFileSync(resolve(output),JSON.stringify(exported,null,2)+'\n',{mode:0o600});return output?{exported:true}:exported;
  }
  if(command==='recover')return reconcileOperation(root,args[1],{confirmed:args.includes('--yes'),executionStopped:args.includes('--execution-stopped'),reason:option(args,'--reason')});
  if(command==='disconnect'){
    if(pendingOperations(root).length)fail('coordination-recovery-required');
    if(!args.includes('--yes'))fail('disconnect-confirmation-required',400);
    saveConnection(root,{...connection,mode:'disconnected'});return {disconnected:true,standaloneWritesEnabled:false};
  }
  fail('coordination-command-invalid',400);
}
