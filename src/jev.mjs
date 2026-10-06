import { constants,openSync,closeSync,readFileSync,writeFileSync,lstatSync,fstatSync,realpathSync,mkdirSync,renameSync,unlinkSync,rmSync } from 'node:fs';
import { resolve,dirname,relative } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { resolveJevApiKey,jevCredentialIdentity } from './jev-credentials.mjs';

export const JEV_MODEL='jev-1.13.0';
export const JEV_USE_CASES=Object.freeze(['context','personas','skill','claim','failure','impact','tests']);
const defaultPolicy=Object.freeze({mode:'off',useCases:['context','personas'],cloudConsent:false,maxCalls:100,maxInputTokens:100000,timeoutMs:3000,minConfidence:0.65});
const sources=new Set(['public','synthetic','cloud-approved','metadata-only']);
const validId=value=>/^[-a-zA-Z0-9_.]{1,80}$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
const sensitive=/(?:apikey_[A-Za-z0-9_-]{16,}|xai-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|-----BEGIN[^\n]*PRIVATE KEY-----|authorization\s*[:=]|(?:password|api[_-]?key|access[_-]?token)["']?\s*[:=]\s*["']?\S{4,})/i;
function sensitiveInput(value,depth=0){
 if(depth>12)return true;
 if(typeof value==='string'){
  if(sensitive.test(value)||sensitive.test(value.replace(/\\u([a-f0-9]{4})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16))).replace(/\\["\\]/g,'')))return true;
  try{const decoded=JSON.parse(value);if(typeof decoded!=='number'&&typeof decoded!=='boolean'&&decoded!==null&&decoded!==value)return sensitiveInput(decoded,depth+1);}catch{/* Ordinary text is checked above. */}
  return false;
 }
 if(value&&typeof value==='object')return Object.entries(value).some(([key,item])=>/^(?:password|api[_-]?key|access[_-]?token|authorization)$/i.test(key)||sensitiveInput(item,depth+1));
 return false;
}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const own=(value,fields)=>plain(value)&&Object.keys(value).every(k=>fields.includes(k));
function fail(code,message){const error=new Error(message);error.code=code;error.statusCode=code==='jev-settings-stale'||code==='jev-storage-busy'?409:400;throw error;}
function invalid(){fail('jev-input','Use a supported, bounded Jev request.');}
function stat(path){try{return lstatSync(path);}catch(e){if(e.code==='ENOENT')return null;fail('jev-storage','Jev local state could not be read safely.');}}
function owned(s){return s&&!s.isSymbolicLink()&&(!process.getuid||s.uid===process.getuid());}

// No source or prompt is stored here. Every file and ancestor is checked before
// no-follow reads/atomic writes; unsafe operational state prevents paid calls.
function pathFor(root,name,create=false){
 const base=realpathSync(resolve(root));
 const folders=name==='settings'?[resolve(base,'.ewai-pipeline')]:[resolve(base,'.ewai-pipeline'),resolve(base,'.ewai-pipeline/runtime'),resolve(base,'.ewai-pipeline/runtime/jev')];
 for(const path of folders){let s=stat(path);if(!s&&create){mkdirSync(path,{mode:0o700});s=stat(path);}if(s&&(!owned(s)||!s.isDirectory()||(s.mode&0o022)))fail('jev-storage','Jev local state could not be read safely.');}
 return resolve(folders.at(-1),name==='settings'?'jev.json':name+'.json');
}
function read(root,name,fallback){
 const path=pathFor(root,name),s=stat(path);if(!s)return structuredClone(fallback);
 if(!owned(s)||!s.isFile()||s.nlink!==1||(s.mode&0o077)||s.size>1048576)fail('jev-storage','Jev local state could not be read safely.');
 let fd;try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const bytes=readFileSync(fd),opened=fstatSync(fd),current=stat(path);if(!current||opened.ino!==s.ino||opened.dev!==s.dev||opened.nlink!==1||current.ino!==s.ino||current.mtimeMs!==s.mtimeMs||opened.mtimeMs!==s.mtimeMs||bytes.length>1048576)fail('jev-storage','Jev local state changed while reading.');return JSON.parse(bytes);}catch(e){if(e.code?.startsWith('jev-'))throw e;fail('jev-storage','Jev local state could not be read safely.');}finally{if(fd!==undefined)closeSync(fd);}
}
function write(root,name,value){
 const path=pathFor(root,name,true),before=stat(path);if(before&&(!owned(before)||!before.isFile()||before.nlink!==1||(before.mode&0o077)))fail('jev-storage','Jev local state could not be written safely.');
 const temporary=path+'.'+randomUUID()+'.tmp';
 try{writeFileSync(temporary,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});pathFor(root,name,true);renameSync(temporary,path);}finally{if(stat(temporary))unlinkSync(temporary);}
}
function locked(root,fn){
 const path=pathFor(root,'state',true),lock=resolve(dirname(path),'.mutation-lock');
 try{mkdirSync(lock,{mode:0o700});}catch(e){fail(e.code==='EEXIST'?'jev-storage-busy':'jev-storage','Another Jev state change is running or local state is unavailable.');}
 const identity=lstatSync(lock);
 try{return fn();}finally{const current=stat(lock);if(owned(current)&&current.ino===identity.ino&&current.dev===identity.dev)rmSync(lock,{recursive:true});}
}
function policy(value){
 if(!own(value,Object.keys(defaultPolicy))||Object.keys(value).length!==Object.keys(defaultPolicy).length||!['off','shadow','active'].includes(value.mode)||typeof value.cloudConsent!=='boolean'||!Array.isArray(value.useCases)||value.useCases.length>7||new Set(value.useCases).size!==value.useCases.length||value.useCases.some(v=>!JEV_USE_CASES.includes(v)))invalid();
 for(const [key,min,max]of [['maxCalls',1,1000],['maxInputTokens',2000,1000000],['timeoutMs',100,10000]])if(!Number.isSafeInteger(value[key])||value[key]<min||value[key]>max)invalid();
 if(!Number.isFinite(value.minConfidence)||value.minConfidence<0.5||value.minConfidence>1)invalid();
 if(value.mode!=='off'&&!value.cloudConsent)fail('jev-consent','Confirm the text disclosure consent before enabling Jev.');
 return structuredClone(value);
}
export function readJevSettings(root){
 const value=read(root,'settings',{schema:'ewai.jev-settings/v1',revision:'missing',policy:structuredClone(defaultPolicy)});
 if(!own(value,['schema','revision','policy'])||value.schema!=='ewai.jev-settings/v1'||typeof value.revision!=='string'||!(/^[a-f0-9-]{36}$/.test(value.revision)||value.revision==='missing'))invalid();
 return {...value,policy:policy(value.policy)};
}
export function saveJevSettings(root,input){
 if(!own(input,['confirmed','expectedRevision','policy'])||input.confirmed!==true||typeof input.expectedRevision!=='string')invalid();
 const next=policy(input.policy);
 return locked(root,()=>{const current=readJevSettings(root);if(current.revision!==input.expectedRevision)fail('jev-settings-stale','Jev settings changed. Refresh before saving again.');const value={schema:'ewai.jev-settings/v1',revision:randomUUID(),policy:next};write(root,'settings',value);return value;});
}
function emptyState(revision){return{schema:'ewai.jev-runtime/v1',revision,calls:0,reservedTokens:0,inputTokens:0,unknownUsage:false,budgetBlocked:false,observations:[],cache:{},pending:{}};}
function state(root,revision){const value=read(root,'state',emptyState(revision));value.pending??={};if(!plain(value.pending)||Object.keys(value.pending).length>1000||Object.entries(value.pending).some(([id,p])=>!validId(id)||!own(p,['settingsRevision'])||typeof p.settingsRevision!=='string'))fail('jev-storage','Jev pending usage could not be read safely.');if(value.schema!=='ewai.jev-runtime/v1'||!Number.isSafeInteger(value.calls)||value.calls<0||!Number.isSafeInteger(value.reservedTokens)||value.reservedTokens<0||!Number.isSafeInteger(value.inputTokens)||value.inputTokens<0||typeof value.unknownUsage!=='boolean'||typeof value.budgetBlocked!=='boolean'||!Array.isArray(value.observations)||value.observations.length>500||!plain(value.cache))fail('jev-storage','Jev measurements could not be read safely.');return value.revision===revision?value:{...value,revision,calls:0,reservedTokens:0,budgetBlocked:false,cache:{},pending:{},unknownUsage:value.unknownUsage||Object.keys(value.pending).length>0};}
function observe(root,revision,observation,cacheEntry){
 locked(root,()=>{const current=readJevSettings(root),value=state(root,current.revision);delete value.pending[observation.id];value.observations.push({...observation,id:observation.id??randomUUID(),settingsRevision:revision});value.observations=value.observations.slice(-500);if(observation.providerCall){if(observation.inputTokens===null){value.unknownUsage=true;if(current.revision===revision)value.budgetBlocked=true;}else value.inputTokens+=observation.inputTokens;}if(observation.reason==='token-reservation-exceeded'&&current.revision===revision)value.budgetBlocked=true;if(cacheEntry&&current.revision===revision){value.cache[cacheEntry.key]=cacheEntry.value;while(Buffer.byteLength(JSON.stringify(value.cache))>131072)delete value.cache[Object.keys(value.cache)[0]];}write(root,'state',value);});
}
export function readJevMeasurements(root){
 const settings=readJevSettings(root),value=state(root,settings.revision),latencies=value.observations.filter(o=>o.providerCall).map(o=>o.elapsedMs).sort((a,b)=>a-b);
 return {schema:'ewai.jev-measurements/v1',revision:settings.revision,budget:{callsUsed:value.calls,maxCalls:settings.policy.maxCalls,reservedTokens:value.reservedTokens,maxInputTokens:settings.policy.maxInputTokens},summary:{unresolvedCalls:Object.keys(value.pending).length,historyLimit:500,historyScope:'latest 500 observation events; input/cost totals cover all recorded provider calls',providerCalls:value.observations.filter(o=>o.providerCall).length,cacheHits:value.observations.filter(o=>o.cacheHit).length,fallbacks:value.observations.filter(o=>o.status==='fallback').length,inputTokens:value.unknownUsage||Object.keys(value.pending).length?null:value.inputTokens,estimatedUSD:value.unknownUsage||Object.keys(value.pending).length?null:value.inputTokens*0.042/1000000,medianMs:latencies.length?latencies[Math.floor(latencies.length/2)]:null,p95Ms:latencies.length?latencies[Math.min(latencies.length-1,Math.ceil(latencies.length*0.95)-1)]:null,downstreamSavings:null,priceSource:'https://docs.typesafe.ai/models',priceUSDPerMillionInputTokens:0.042},observations:value.observations};
}
export function recordJevEffect(root,decision,details){
 if(!decision?.measurement?.id)return;
 if(!own(details,['effect','baselineIds','suggestedIds','actualIds'])||!['unchanged','context-ordering','persona-additions','review-addition'].includes(details.effect))invalid();
 for(const ids of [details.baselineIds,details.suggestedIds,details.actualIds])if(!Array.isArray(ids)||ids.length>64||ids.some(id=>!validId(id)))invalid();
 const revision=readJevSettings(root).revision;
 observe(root,revision,{id:randomUUID(),decisionId:decision.measurement.id,useCase:decision.measurement.useCase,model:JEV_MODEL,mode:decision.mode,status:'effect-recorded',providerCall:false,cacheHit:false,elapsedMs:0,inputTokens:0,outputTokens:0,estimatedUSD:0,downstreamSavings:null,...details});
}
function question(q){
 if(!own(q,['type','instructions','criteria'])||!['choice','score','noul'].includes(q.type)||typeof q.instructions!=='string'||!q.instructions.trim()||q.instructions.length>2000)invalid();
 if(q.type==='choice'){if(!plain(q.criteria)||Object.keys(q.criteria).length<2||Object.keys(q.criteria).length>64||Object.entries(q.criteria).some(([k,v])=>!validId(k)||typeof v!=='string'||v.length>1000))invalid();}
 if(q.type==='score'&&(!Array.isArray(q.criteria)||q.criteria.length<2||q.criteria.length>10||q.criteria.some(v=>typeof v!=='string'||!v.trim()||v.length>1000)))invalid();
 if(q.type==='noul'&&q.criteria!==undefined&&(!own(q.criteria,['true','false'])||Object.values(q.criteria).some(v=>typeof v!=='string'||v.length>1000)))invalid();
 return q;
}
function usage(body){const u=body?.usage;return own(u,['input_tokens','output_tokens'])&&Number.isSafeInteger(u.input_tokens)&&u.input_tokens>=0&&Number.isSafeInteger(u.output_tokens)&&u.output_tokens>=0?{inputTokens:u.input_tokens,outputTokens:u.output_tokens}:null;}
function validatedAnswers(body,questions){
 if(body?.model!==JEV_MODEL||!plain(body.answers)||Object.keys(body.answers).length!==Object.keys(questions).length)throw Error('invalid-response');
 const output={};
 for(const [id,q]of Object.entries(questions)){
  const a=body.answers[id];if(!plain(a)||a.type!==q.type)throw Error('invalid-response');
  if(q.type==='noul'){if(!own(a,['type','noul'])||!Number.isFinite(a.noul)||a.noul<0||a.noul>1)throw Error('invalid-response');output[id]={type:'noul',noul:a.noul};continue;}
  const keys=q.type==='choice'?Object.keys(q.criteria):q.criteria.map((_,i)=>String(i));
  if(!own(a,q.type==='choice'?['type','choice','probabilities','confidence']:['type','score','legend','probabilities','confidence'])||!plain(a.probabilities)||Object.keys(a.probabilities).length!==keys.length||!keys.every(k=>Object.hasOwn(a.probabilities,k))||!Object.values(a.probabilities).every(p=>Number.isFinite(p)&&p>=0&&p<=1)||Math.abs(Object.values(a.probabilities).reduce((s,p)=>s+p,0)-1)>0.001||!Number.isFinite(a.confidence)||a.confidence<0||a.confidence>1)throw Error('invalid-response');
  if(q.type==='choice'){
   if(!keys.includes(a.choice)||a.probabilities[a.choice]+1e-9<Math.max(...Object.values(a.probabilities)))throw Error('invalid-response');output[id]={type:'choice',choice:a.choice,probabilities:a.probabilities,confidence:a.confidence};
  }else{
   const expected=keys.reduce((s,k)=>s+Number(k)*a.probabilities[k],0);
   if(!Number.isFinite(a.score)||Math.abs(a.score-expected)>0.01||!plain(a.legend)||Object.keys(a.legend).length!==keys.length||!keys.every(k=>a.legend[k]===q.criteria[Number(k)]))throw Error('invalid-response');output[id]={type:'score',score:a.score,confidence:a.confidence,probabilities:a.probabilities,legend:a.legend};
  }
 }
 return output;
}
async function boundedResponse(response){
 const chunks=[];let size=0;
 if(!response.body)throw Error('invalid-response');
 for await(const chunk of response.body){size+=chunk.length;if(size>65536)throw Error('response-too-large');chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('invalid-response');}
}
export async function evaluateJev(root,input,options={}){
 const started=performance.now();let settings,apiKey,reservation,controller,timer,watcher,providerUsage=null,dispatched=false;
 const fallback=(reason,status='fallback',extra={})=>({schema:'ewai.jev-decision/v1',status,reason,mode:settings?.policy.mode??'off',authority:'advisory',...extra});
 try{
  settings=readJevSettings(root);
  if(settings.policy.mode==='off')return fallback('off','disabled');
  if(!own(input,['useCase','source','state','questions'])||!JEV_USE_CASES.includes(input.useCase))invalid();
  if(!settings.policy.useCases.includes(input.useCase))return fallback('use-case-disabled','disabled');
  if(!sources.has(input.source))return fallback('source-ineligible');
  if(!settings.policy.cloudConsent)return fallback('consent-required');
  if(!plain(input.questions)||Object.keys(input.questions).length<1||Object.keys(input.questions).length>32||Object.keys(input.questions).some(id=>!validId(id)))invalid();
  Object.values(input.questions).forEach(question);
  const payload={model:JEV_MODEL,state:input.state,questions:input.questions},serialised=JSON.stringify(payload);
  if(!['string','object'].includes(typeof input.state)||input.state===null||Buffer.byteLength(serialised)>16000)invalid();
  if(sensitiveInput(payload))return fallback('sensitive-input');
  apiKey=resolveJevApiKey({...options,projectRoot:root});if(!apiKey)return fallback('missing-key');
  if(serialised.includes(apiKey))return fallback('sensitive-input');
  // UTF-8 bytes plus headroom is a conservative local reservation, not a
  // claimed token count. Unknown/over-reservation usage exhausts the budget.
  const namespace=jevCredentialIdentity({...options,projectRoot:root});
  const reserve=Buffer.byteLength(serialised)+1024,cacheKey=digest({revision:settings.revision,credential:namespace,source:input.source,useCase:input.useCase,payload});
  reservation=locked(root,()=>{
   if(digest(readJevSettings(root))!==digest(settings))return {reason:'policy-changed'};
   const value=state(root,settings.revision),cached=value.cache[cacheKey];
   if(cached){try{const answers=Object.fromEntries(Object.entries(cached.answers).map(([id,a])=>[id,a.type==='score'?{...a,legend:Object.fromEntries(input.questions[id].criteria.map((label,index)=>[String(index),label]))}:a]));validatedAnswers({model:JEV_MODEL,answers},input.questions);return {cached:{answers}};}catch{return {reason:'invalid-cache'};}}
   if(value.budgetBlocked||Object.keys(value.pending).length||value.calls>=settings.policy.maxCalls||value.reservedTokens+reserve>settings.policy.maxInputTokens)return {reason:'budget-exhausted'};
   const id=randomUUID();value.calls++;value.reservedTokens+=reserve;value.pending[id]={settingsRevision:settings.revision};write(root,'state',value);return {id,reserve,cacheKey};
  });
  if(reservation.reason)return fallback(reservation.reason);
  const stillCurrent=()=>digest(readJevSettings(root))===digest(settings)&&resolveJevApiKey({...options,projectRoot:root})===apiKey&&jevCredentialIdentity({...options,projectRoot:root})===namespace;
  if(reservation.cached){
   if(!stillCurrent())return fallback('policy-changed');
   const measurement={id:randomUUID(),useCase:input.useCase,model:JEV_MODEL,mode:settings.policy.mode,status:'suggested',providerCall:false,cacheHit:true,elapsedMs:Math.round(performance.now()-started),inputTokens:0,outputTokens:0,estimatedUSD:0,effect:settings.policy.mode==='shadow'?'shadow':'advisory',downstreamSavings:null};
   observe(root,settings.revision,measurement);return {...fallback('cached','suggested'),answers:reservation.cached.answers,cacheHit:true,measurement};
  }
  if(!stillCurrent())throw Error('policy-changed');
  controller=new AbortController();let rejectDeadline;
  const deadline=new Promise((_,reject)=>{rejectDeadline=reject;timer=setTimeout(()=>{controller.abort();reject(Error('timeout'));},settings.policy.timeoutMs);});
  watcher=setInterval(()=>{try{if(!stillCurrent()){controller.abort();rejectDeadline(Error('policy-changed'));}}catch{controller.abort();rejectDeadline(Error('policy-changed'));}},100);
  const operation=(async()=>{
   dispatched=true;const response=await(options.fetchImpl??fetch)('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{authorization:'Bearer '+apiKey,'content-type':'application/json'},body:serialised,redirect:'manual',signal:controller.signal});
   if(!response.ok){if(response.body)void response.body.cancel().catch(()=>{});throw Error('http-'+response.status);}
   return boundedResponse(response);
  })();
  const body=await Promise.race([operation,deadline]);providerUsage=usage(body);
  if(!providerUsage)throw Error('missing-usage');
  if(providerUsage.inputTokens>reserve)throw Error('token-reservation-exceeded');
  const answers=validatedAnswers(body,input.questions);
  if(!stillCurrent())throw Error('policy-changed');
  if(Object.values(answers).some(a=>a.type!=='noul'&&a.confidence<settings.policy.minConfidence))throw Error('low-confidence');
  const measurement={id:reservation.id,useCase:input.useCase,model:JEV_MODEL,mode:settings.policy.mode,status:'suggested',providerCall:true,cacheHit:false,elapsedMs:Math.round(performance.now()-started),...providerUsage,estimatedUSD:providerUsage.inputTokens*0.042/1000000,effect:settings.policy.mode==='shadow'?'shadow':'advisory',downstreamSavings:null};
  // Choice cache carries bounded IDs and numeric probabilities/confidence,
  // never rubrics, instructions or source bodies.
  const cachedAnswers=Object.fromEntries(Object.entries(answers).map(([id,a])=>[id,a.type==='choice'?{...a}:a.type==='noul'?{...a}:{...a,legend:{}}]));
  // Score legends are reconstructed from the caller's matching hashed rubric.
  // Persist only numeric results and bounded IDs, never catalogue descriptions.
  const cacheEntry={key:cacheKey,value:{answers:cachedAnswers}};
  observe(root,settings.revision,measurement,cacheEntry);
  return {...fallback('evaluated','suggested'),answers,cacheHit:false,measurement};
 }catch(error){
  const allowed=/^(?:timeout|policy-changed|invalid-response|response-too-large|missing-usage|token-reservation-exceeded|low-confidence|http-\d{3})$/;
  const reason=allowed.test(error?.message??'')?error.message:error.code?.startsWith('jev-')?'local-state-or-input-unavailable':'provider-unavailable';
  const result=fallback(reason);
  if(reservation?.reserve){
   const measurement={id:reservation.id,useCase:input.useCase,model:JEV_MODEL,mode:settings.policy.mode,status:'fallback',reason,providerCall:dispatched,cacheHit:false,elapsedMs:Math.round(performance.now()-started),inputTokens:providerUsage?.inputTokens??(dispatched?null:0),outputTokens:providerUsage?.outputTokens??(dispatched?null:0),estimatedUSD:providerUsage?providerUsage.inputTokens*0.042/1000000:dispatched?null:0,effect:'none',downstreamSavings:null};
   try{observe(root,settings.revision,measurement);}catch{/* No unsafe diagnostic or source is emitted. */}result.measurement=measurement;
  }
  return result;
 }finally{clearTimeout(timer);clearInterval(watcher);controller?.abort();apiKey=undefined;}
}
export function safeJevError(error){return {code:error?.code?.startsWith('jev-')?error.code:'jev-input',error:error?.code?.startsWith('jev-')?error.message:'Jev could not complete this request. Refresh status and try again.'};}
