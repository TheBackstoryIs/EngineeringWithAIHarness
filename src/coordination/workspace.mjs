import {captureSharedActivity,hydrateSharedActivity} from './activity.mjs';
import {readFileSync,existsSync,readdirSync,mkdirSync,writeFileSync,renameSync,realpathSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import YAML from 'yaml';
import {projectPaths} from '../paths.mjs';
import {digest,fail,validateRecord,projectionPath} from './contract.mjs';
import {safeLocalPath} from './config.mjs';
const readJson=path=>{if(!existsSync(path))return null;try{return JSON.parse(readFileSync(path,'utf8'));}catch{fail('local-state-invalid',400);}};
function document(root,reference){
  const paths=projectPaths(root),base=resolve(paths.specsRoot,'2.Purpose/intents');let matches=[];
  if(reference.includes('/'))matches=[reference];else if(existsSync(base))matches=readdirSync(base,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>entry.name+'/'+reference).filter(id=>existsSync(resolve(base,id+'.md')));
  if(matches.length!==1)fail('local-intent-missing',409);
  const id=matches[0],path=safeLocalPath(root,resolve(base,id+'.md'));
  if(!existsSync(path))fail('local-source-missing');
  const raw=readFileSync(path,'utf8'),match=raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);if(!match)fail('local-source-invalid');
  let metadata;try{metadata=YAML.parse(match[1]);}catch{fail('local-source-invalid',400);}return {paths,id,path,raw,body:raw.slice(match[0].length),metadata};
}
const operationalMetadata=new Set(['status','delivery_status','current_phase','delivery_state_path','updated_at']);
function authoredHash(doc){return digest({metadata:Object.fromEntries(Object.entries(doc.metadata).filter(([key])=>!operationalMetadata.has(key))),body:doc.body});}
export function localIntentId(root,reference){return document(root,reference).id;}
export function sourceHash(root,reference){return authoredHash(document(root,reference));}
export function localIntentIds(root){const base=resolve(projectPaths(root).specsRoot,'2.Purpose/intents');if(!existsSync(base))return [];return readdirSync(base,{withFileTypes:true}).filter(e=>e.isDirectory()).flatMap(e=>readdirSync(resolve(base,e.name)).filter(name=>name.endsWith('.md')).map(name=>e.name+'/'+name.slice(0,-3)));}
function transform(value,from,to){if(typeof value==='string')return value.split(from).join(to);if(Array.isArray(value))return value.map(v=>transform(v,from,to));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,transform(v,from,to)]));return value;}
export function captureRecord(root,reference){
  root=realpathSync(root);
  const doc=document(root,reference),{paths,metadata,id}=doc,slug=id.split('/')[1];
  const portable=value=>transform(transform(value,resolve(root),'$EWAI_PROJECT'),paths.specsRelative+'/','$EWAI_SPECS/');
  const projections=[];const intentJson=resolve(paths.specsRoot,'2.Purpose/intents',id+'.json'),build=resolve(paths.buildRoot,slug);
  const add=path=>{safeLocalPath(root,path);if(!existsSync(path))return;projections.push({path:relative(paths.specsRoot,path).replaceAll('\\','/'),sha256:digest(readFileSync(path,'utf8')),content:portable(readJson(path))});};
  add(intentJson);add(resolve(build,'delivery-state.json'));
  const gates=resolve(build,'gates');safeLocalPath(root,gates);
  if(existsSync(gates))for(const directory of readdirSync(gates,{withFileTypes:true}).filter(e=>e.isDirectory())){
    const folder=safeLocalPath(root,resolve(gates,directory.name));for(const name of readdirSync(folder))if(/^(gate-ledger|build-approval|manual-qa-approval|evidence-amendment|plan-amendment)\.json$/.test(name))add(resolve(folder,name));
  }
  const evidence=[];
  for(const projection of projections)if(projection.path.endsWith('/gate-ledger.json'))for(const item of projection.content.required_gates??[]){
    if(item.status!=='pass')continue;
    const path=safeLocalPath(root,resolve(build,item.output_path??''));
    if(!path.startsWith(build+'/')||!existsSync(path)||digest(readFileSync(path,'utf8'))!==item.evidence_hash)fail('local-gate-evidence-diverged');
    evidence.push({path:relative(paths.specsRoot,path).replaceAll('\\','/'),sha256:item.evidence_hash,sourceFingerprint:authoredHash(doc),kind:'phase-gate'});
  }
  const graph=readJson(safeLocalPath(root,resolve(build,'task-graph.json')));
  return validateRecord({id,slug,domain:id.split('/')[0],title:metadata.title??slug,bodyHash:authoredHash(doc),
    state:{status:metadata.status??'draft',deliveryStatus:metadata.delivery_status??'not-started',currentPhase:metadata.current_phase??'intent'},
    delivery:portable(readJson(resolve(build,'delivery-state.json'))),projections,
    work:captureSharedActivity(root,id),taskGraph:graph?{maxParallelTasks:graph.parallelism?.max_parallel_tasks??1,tasks:graph.tasks.map(task=>({id:task.id,repo:task.repo,branch:task.branch,write_set:task.write_set})),hash:digest(graph)}:null,evidence});
}
function atomicJson(root,path,value){safeLocalPath(root,path);mkdirSync(dirname(path),{recursive:true});const tmp=path+'.coordination.tmp';writeFileSync(tmp,JSON.stringify(value,null,2)+'\n');renameSync(tmp,path);}
export function hydrateRecord(root,record){
  root=realpathSync(root);
  validateRecord(record);const doc=document(root,record.id);if(authoredHash(doc)!==record.bodyHash)fail('local-source-diverged');
  const graphPath=safeLocalPath(root,resolve(doc.paths.buildRoot,record.slug,'task-graph.json'));
  if(record.taskGraph?.hash&&(!existsSync(graphPath)||digest(readJson(graphPath))!==record.taskGraph.hash))fail('local-task-graph-diverged');
  // Rebase operational paths and refresh local JSON byte hashes while leaving authored evidence untouched.
  const local=value=>transform(transform(value,'$EWAI_PROJECT',resolve(root)),'$EWAI_SPECS/',doc.paths.specsRelative+'/');
  const projections=record.projections.map(p=>({path:p.path,sha256:p.sha256,content:local(p.content)}));
  const hashMap=new Map();for(let pass=0;pass<3;pass++)for(const p of projections){
    const previous=JSON.stringify(p.content,null,2)+'\n';
    const replace=value=>{if(typeof value==='string')return hashMap.get(value)??value;if(Array.isArray(value))return value.map(replace);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,replace(v)]));return value;};
    p.content=replace(p.content);const original=record.projections.find(item=>item.path===p.path);if(original.sha256)hashMap.set(original.sha256,digest(JSON.stringify(p.content,null,2)+'\n'));hashMap.set(digest(JSON.stringify(original.content,null,2)+'\n'),digest(JSON.stringify(p.content,null,2)+'\n'));hashMap.set(digest(previous),digest(JSON.stringify(p.content,null,2)+'\n'));
  }
  for(const p of projections){projectionPath(p.path,record);atomicJson(root,resolve(doc.paths.specsRoot,p.path),p.content);}
  if(record.delivery&&!projections.some(p=>p.path.endsWith('/delivery-state.json')))atomicJson(root,resolve(doc.paths.buildRoot,record.slug,'delivery-state.json'),local(record.delivery));
  const metadata={...doc.metadata,status:record.state.status,delivery_status:record.state.deliveryStatus,current_phase:record.state.currentPhase};
  const updated='---\n'+YAML.stringify(metadata)+'---\n'+doc.body;const changed=doc.metadata.status!==record.state.status||doc.metadata.delivery_status!==record.state.deliveryStatus||doc.metadata.current_phase!==record.state.currentPhase;
  if(changed){const temp=doc.path+'.coordination.tmp';safeLocalPath(root,temp);writeFileSync(temp,updated);renameSync(temp,doc.path);}
  hydrateSharedActivity(root,record.id,record.work);
  return record;
}
