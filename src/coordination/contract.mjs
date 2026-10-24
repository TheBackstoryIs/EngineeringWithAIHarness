import {createHash} from 'node:crypto';

export const protocol='ewai.coordination/v1';
export const maximumBodyBytes=4*1024*1024;
export const identifier=/^[a-z0-9][a-z0-9._-]{0,79}$/;
export const intentIdentifier=/^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const roles=Object.freeze(['reader','developer','approver','owner']);
export const mutationActions=new Set(['begin-harness','start-phase','complete-phase','record-gate','record-validation',
  'approve-build','approve-manual-qa','ratify-plan','ratify-evidence','update-projection','update-phase-projection',
  'start-session','update-session','finish-session','publish-document','create-intent','attach-persona','detach-persona',
  'apply-evidence','afk-build','prepare-phase','record-evidence','update-intent','resume-shelf','project-change','project-check-start','project-check-execute']);

export function fail(code,status=409){const error=new Error(code);error.code=code;error.statusCode=status;throw error;}
export function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
export const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(canonical(value))).digest('hex');
export function object(value){if(!value||typeof value!=='object'||Array.isArray(value))fail('object-required',400);return value;}
export function fields(value,allowed){object(value);if(Object.keys(value).some(key=>!allowed.includes(key)))fail('unknown-field',400);return value;}
export function text(value,label,maximum=160){if(typeof value!=='string'||!value.trim()||value.length>maximum)fail(label+'-invalid',400);return value;}
export function id(value,label='identifier'){if(!identifier.test(String(value??'')))fail(label+'-invalid',400);return value;}
export function intentId(value){if(typeof value!=='string'||value.length>160||!intentIdentifier.test(value))fail('intent-id-invalid',400);return value;}
export function revision(value){if(!Number.isSafeInteger(value)||value<0)fail('revision-invalid',400);return value;}
export function ttl(value=600000){if(!Number.isSafeInteger(value)||value<1000||value>86400000)fail('lease-duration-invalid',400);return value;}
export function operationId(value){if(!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{7,119}$/.test(String(value??'')))fail('operation-id-invalid',400);return value;}
export function authorize(actor,project,write=false){
  if(!roles.includes(actor?.role)||!Array.isArray(actor?.projects)||!actor.projects.includes(project))fail('project-forbidden',403);
  if(write&&actor.role==='reader')fail('write-role-required',403);
}
export function owner(actor){if(actor.role!=='owner')fail('owner-role-required',403);}
export function projectionPath(path,record){
  if(typeof path!=='string'||path.includes('\\')||path.split('/').some(part=>!part||part==='.'||part==='..'))fail('projection-path-invalid',400);
  if(path===`2.Purpose/intents/${record.id}.json`)return path;
  const prefix=`6.Build/${record.slug}/`;
  if(!path.startsWith(prefix))fail('projection-path-invalid',400);
  if(path===prefix+'delivery-state.json')return path;
  if(/^gates\/[a-z0-9-]+\/(?:gate-ledger|build-approval|manual-qa-approval|evidence-amendment|plan-amendment)\.json$/.test(path.slice(prefix.length)))return path;
  fail('projection-path-invalid',400);
}
function privateValues(value,key=''){
  if(typeof value==='string'&&key.endsWith('_json')){let parsed;try{parsed=JSON.parse(value);}catch{fail('embedded-json-invalid',400);}privateValues(parsed);}
  if(/^(?:token|password|secret|apiKey|credentials|leaseToken)$/i.test(key))fail('credential-field-forbidden',400);
  if(typeof value==='string'&&(/(?:\/Users\/|\/home\/|[a-z]:[\\/])/i.test(value)||value.includes('file://')))fail('private-path-forbidden',400);
  if(Array.isArray(value))for(const item of value)privateValues(item);
  else if(value&&typeof value==='object')for(const [name,item]of Object.entries(value))privateValues(item,name);
}
export function validateRecord(value){
  fields(value,['id','slug','domain','title','bodyHash','state','delivery','projections','taskGraph','evidence','source','work','taskResults']);
  intentId(value.id);id(value.slug,'slug');id(value.domain,'domain');
  if(value.id!==value.domain+'/'+value.slug)fail('intent-identity-conflict',400);
  text(value.title,'title',300);if(!/^[a-f0-9]{64}$/.test(value.bodyHash))fail('body-hash-invalid',400);
  fields(value.state,['status','deliveryStatus','currentPhase']);for(const [key,item]of Object.entries(value.state))text(item,key,80);
  if(value.delivery!==null){object(value.delivery);if(value.delivery.schema!=='ewai.delivery-state/v1'||value.delivery.slug!==value.slug)fail('delivery-identity-conflict',400);}
  if(!Array.isArray(value.projections)||value.projections.length>128)fail('projections-invalid',400);
  const paths=new Set();for(const projection of value.projections){fields(projection,['path','content','sha256']);projectionPath(projection.path,value);object(projection.content);if(paths.has(projection.path))fail('projection-duplicate',400);paths.add(projection.path);}
  if(value.taskGraph!==null&&value.taskGraph!==undefined){
    fields(value.taskGraph,['tasks','hash','maxParallelTasks']);if(!Array.isArray(value.taskGraph.tasks)||value.taskGraph.tasks.length>500)fail('task-graph-invalid',400);
    const ids=new Set();for(const task of value.taskGraph.tasks){fields(task,['id','repo','branch','write_set']);text(task.id,'task-id',100);if(ids.has(task.id))fail('task-duplicate',400);ids.add(task.id);text(task.repo,'task-repo');if(task.branch!==undefined)text(task.branch,'task-branch',200);if(!Array.isArray(task.write_set)||task.write_set.some(path=>typeof path!=='string'||path.startsWith('/')||path.split('/').includes('..')))fail('task-write-set-invalid',400);}
  }
  if(value.work){fields(value.work,['session','events','actorId']);object(value.work.session);if(!Array.isArray(value.work.events)||value.work.events.length>100)fail('work-events-invalid',400);}
  if(!Array.isArray(value.evidence)||value.evidence.length>500)fail('evidence-invalid',400);
  for(const evidence of value.evidence){fields(evidence,['path','sha256','sourceFingerprint','taskId','kind']);if(typeof evidence.path!=='string'||evidence.path.startsWith('/')||evidence.path.includes('\\')||evidence.path.split('/').includes('..')||!/^[a-f0-9]{64}$/.test(evidence.sha256))fail('evidence-reference-invalid',400);}
  const deliveryProjection=value.projections.find(p=>p.path===`6.Build/${value.slug}/delivery-state.json`);
  if(deliveryProjection&&digest(deliveryProjection.content)!==digest(value.delivery))fail('delivery-projection-conflict',400);
  if(value.delivery?.currentPhase&&value.delivery.currentPhase!==value.state.currentPhase)fail('delivery-state-conflict',400);
  if(value.delivery?.status&&value.delivery.status!==value.state.deliveryStatus)fail('delivery-state-conflict',400);
  if(value.delivery?.intent?.status&&value.delivery.intent.status!==value.state.status)fail('delivery-state-conflict',400);
  const intentProjection=value.projections.find(p=>p.path===`2.Purpose/intents/${value.id}.json`);
  if(intentProjection&&['status','deliveryStatus','currentPhase'].some(key=>intentProjection.content[key]!==value.state[key]))fail('intent-projection-conflict',400);
  privateValues(value);if(Buffer.byteLength(JSON.stringify(value))>maximumBodyBytes/2)fail('record-too-large',413);
  return value;
}
const representationHashes=new Set(['stateSha256','gateSha256','previousGateSha256','ratifiedGateSha256','deliveryStateSha256Before','deliveryStateSha256After']);
function approvalSemantic(value){
  if(Array.isArray(value))return value.map(approvalSemantic);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!representationHashes.has(key)).map(([key,item])=>[key,approvalSemantic(item)]));
  return value;
}
export function protectedApprovalView(record){
  return {approvals:approvalSemantic(Object.fromEntries(Object.entries(record.delivery?.approvals??{}).filter(([,value])=>value!==null))),humanGates:(record.delivery?.humanGates??[]).filter(gate=>gate.status==='approved'),
    files:record.projections.filter(p=>p.path.includes('approval')||p.path.includes('amendment')).map(p=>({path:p.path,content:approvalSemantic(p.content)}))};
}
export function assertApprovalChange(actor,before,after){
  if(digest(protectedApprovalView(before))!==digest(protectedApprovalView(after))&&!['approver','owner'].includes(actor.role))fail('approval-role-required',403);
}
