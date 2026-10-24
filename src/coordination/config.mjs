import {existsSync,readFileSync,mkdirSync,writeFileSync,renameSync,lstatSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {projectPaths} from '../paths.mjs';
import {fields,id,fail} from './contract.mjs';
export const connectionPath=root=>resolve(projectPaths(root).runtimeRoot,'coordination.json');
export function safeLocalPath(root,path){
  let current=resolve(root);const target=resolve(path);if(target!==current&&!target.startsWith(current+'/'))fail('local-path-unsafe',400);
  for(const part of target.slice(current.length).split('/').filter(Boolean)){current=resolve(current,part);if(existsSync(current)){const stat=lstatSync(current);if(stat.isSymbolicLink()||stat.isFile()&&stat.nlink!==1)fail('local-path-unsafe',400);}}
  return target;
}
export function atomicPrivate(root,path,value){safeLocalPath(root,path);mkdirSync(dirname(path),{recursive:true,mode:0o700});const temporary=path+'.'+process.pid+'.tmp';writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});renameSync(temporary,path);}
export function validateConnection(value){
  fields(value,['schema','endpoint','projectId','machineId','tokenEnv','identity','mode','revisions']);
  if(value.schema!=='ewai.coordination-connection/v1'||!['shared','disconnected'].includes(value.mode))fail('connection-invalid',400);
  id(value.projectId,'project-id');id(value.machineId,'machine-id');
  if(!/^[A-Z][A-Z0-9_]{1,99}$/.test(value.tokenEnv??''))fail('token-env-invalid',400);
  let url;try{url=new URL(value.endpoint);}catch{fail('endpoint-invalid',400);}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')fail('endpoint-invalid',400);
  if(typeof value.identity!=='string'||!value.identity)fail('server-identity-required',400);
  return value;
}
export function readConnection(root){const path=connectionPath(root);safeLocalPath(root,path);if(!existsSync(path))return null;let value;try{value=JSON.parse(readFileSync(path,'utf8'));}catch{fail('connection-invalid',400);}return validateConnection(value);}
export function requireShared(root){const config=readConnection(root);if(config?.mode==='disconnected')fail('shared-project-disconnected');return config;}
export function saveConnection(root,value){validateConnection(value);atomicPrivate(root,connectionPath(root),value);return value;}

// Only the trusted EWAI worker receives the coordination credential. Named
// project checks retain their existing minimal, secret-free environment.
export function coordinationWorkerEnvironment(root,base){
  const connection=requireShared(root);if(!connection)return base;
  const token=process.env[connection.tokenEnv];if(!token)fail('coordination-token-unavailable',401);
  return {...base,[connection.tokenEnv]:token};
}
