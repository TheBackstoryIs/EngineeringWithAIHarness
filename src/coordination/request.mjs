import {readFileSync} from 'node:fs';
import {protocol,fail,maximumBodyBytes} from './contract.mjs';
export async function request(connection,action,input={}){
  const token=process.env[connection.tokenEnv];if(!token)fail('coordination-token-unavailable',401);
  let response;try{response=await fetch(connection.endpoint.replace(/\/$/,'')+'/api/v1/projects/'+connection.projectId+'/actions',{
    method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({action,input}),signal:AbortSignal.timeout(10000),redirect:'error'});}catch{fail('coordination-unavailable',503);}
  const reader=response.body.getReader();let size=0;const chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maximumBodyBytes){await reader.cancel();fail('response-too-large',502);}chunks.push(Buffer.from(value));}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{fail('coordination-response-invalid',502);}
  if(!response.ok)fail(/^[a-z0-9-]+$/.test(body.error??'')?body.error:'coordination-request-failed',response.status);
  if(body.protocol!==protocol||connection.identity&&body.identity!==connection.identity)fail('coordination-identity-conflict',409);
  return {result:body.result,identity:body.identity,epoch:body.epoch};
}
if(process.argv[2]==='--bridge'){
  try{const {connection,action,input}=JSON.parse(readFileSync(0,'utf8'));process.stdout.write(JSON.stringify({ok:true,...await request(connection,action,input)}));}
  catch(error){process.stdout.write(JSON.stringify({ok:false,error:error.code??'coordination-request-failed',status:error.statusCode??503}));process.exitCode=1;}
}
