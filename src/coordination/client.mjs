import {observeRevisions} from './revisions.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readConnection,requireShared,saveConnection} from './config.mjs';
import {fail,maximumBodyBytes} from './contract.mjs';
const helper=fileURLToPath(new URL('./request.mjs',import.meta.url));
export function requestSync(connection,action,input={}){
  const child=spawnSync(process.execPath,[helper,'--bridge'],{input:JSON.stringify({connection,action,input}),encoding:'utf8',timeout:15000,maxBuffer:maximumBodyBytes+1024,windowsHide:true});
  let response;try{response=JSON.parse(child.stdout);}catch{fail('coordination-unavailable',503);}
  if(!response.ok)fail(response.error,response.status);return response;
}
export function centralRequest(root,action,input={}){
  const connection=requireShared(root);if(!connection)fail('shared-connection-required',400);
  const response=requestSync(connection,action,input);
  const entries=response.result?.intents??(response.result?.revision&&response.result.record?[response.result]:[]);
  const complete=['list-intents','export-project'].includes(action);
  if((entries.length||complete)&&action!=='operation-status'){
    const revisions=observeRevisions(root,connection,entries,{strict:['read-intent','list-intents','export-project'].includes(action),complete});
    const current=readConnection(root);if(current.identity!==connection.identity||current.projectId!==connection.projectId)fail('coordination-identity-conflict');
    saveConnection(root,{...current,revisions});
  }
  return response.result;
}
export function isShared(root){return Boolean(requireShared(root));}
export {readConnection};
