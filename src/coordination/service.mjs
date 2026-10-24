import {spawn} from 'node:child_process';
import {existsSync,readFileSync,mkdirSync,writeFileSync,rmSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateTeamHubDataRoot} from '../runtime/team-hub-database.mjs';
import {createCoordinationServer} from './server.mjs';
import {fail,fields} from './contract.mjs';
const own=fileURLToPath(import.meta.url);
const statePath=data=>resolve(validateTeamHubDataRoot(data),'service.json');
export async function coordinationServiceStatus(dataRoot){
  const path=statePath(dataRoot);if(!existsSync(path))return {running:false};if(lstatSync(path).isSymbolicLink())fail('service-state-unsafe',400);
  const state=JSON.parse(readFileSync(path,'utf8'));
  try{const response=await fetch(state.url+'/health',{signal:AbortSignal.timeout(1500)});const health=await response.json();return {running:health.identity===state.identity,...state};}catch{return {running:false,...state};}
}
export async function startCoordinationService(options){
  const existing=await coordinationServiceStatus(options.dataRoot);if(existing.running)return existing;
  const args=[own,'--run',JSON.stringify(options)];
  return await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,args,{detached:true,stdio:['ignore','pipe','pipe'],env:process.env});let output='';
    const timeout=setTimeout(()=>{child.kill();reject(new Error('coordination-start-timeout'));},10000);
    child.once('error',error=>{clearTimeout(timeout);reject(error);});
    child.once('exit',()=>{clearTimeout(timeout);reject(new Error('coordination-start-failed'));});
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>8192){child.kill();return;}if(output.includes('\n')){clearTimeout(timeout);try{const state=JSON.parse(output.split('\n')[0]);child.stdout.destroy();child.stderr.destroy();child.unref();resolve(state);}catch{reject(new Error('coordination-start-failed'));}}});
    child.stderr.resume();
  });
}
export async function stopCoordinationService(dataRoot){
  const state=await coordinationServiceStatus(dataRoot);if(!state.running)return state;
  process.kill(state.pid,'SIGTERM');return {running:false,stopping:true};
}
if(process.argv[2]==='--run'){
  try{
    const options=JSON.parse(process.argv[3]),root=validateTeamHubDataRoot(options.dataRoot),path=statePath(root);
    mkdirSync(root,{recursive:true,mode:0o700});
    const definitions=JSON.parse(readFileSync(options.credentialsFile,'utf8'));
    const credentials=definitions.map(definition=>{fields(definition,['actorId','role','projects','tokenEnv']);if(!/^[A-Z][A-Z0-9_]{1,99}$/.test(definition.tokenEnv??''))fail('token-env-invalid',400);return {actorId:definition.actorId,role:definition.role,projects:definition.projects,token:process.env[definition.tokenEnv]};});
    const server=await createCoordinationServer({...options,credentials});
    const state={running:true,pid:process.pid,url:server.url,identity:server.identity,epoch:server.epoch};
    writeFileSync(path,JSON.stringify(state)+'\n',{mode:0o600});process.stdout.write(JSON.stringify(state)+'\n');
    for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{await server.close();rmSync(path,{force:true});process.exit(0);});
  }catch{process.stderr.write('Coordination service could not start. Check bind, credential references and private data directory.\n');process.exitCode=1;}
}
