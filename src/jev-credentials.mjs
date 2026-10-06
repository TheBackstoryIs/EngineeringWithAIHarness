// TypeSafe uses the same audited private storage safeguards as Grok, with a separate key lifecycle.
import {constants,openSync,closeSync,fstatSync,lstatSync,realpathSync,readFileSync,mkdirSync,writeFileSync,renameSync,unlinkSync,rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,relative,isAbsolute} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';

const messages={
 'jev-credential-invalid':'Provide a valid TypeSafe API key using the private setup form or hidden terminal prompt.',
 'jev-credential-input':'Use the supported credential action and confirm the change.',
 'jev-credential-unsafe-storage':'Private credential storage is unsafe or unavailable. Repair its permissions or use TYPESAFE_API_KEY in the launching environment.',
 'jev-credential-invalid-storage':'The saved credential could not be read safely. Repair the private credential file before continuing.',
 'jev-credential-stale':'The saved credential changed. Refresh its status and try again.',
 'jev-credential-busy':'Another credential change is running. Retry after it finishes.',
 'jev-credential-missing':'No Jev key is configured. Use private credential setup or TYPESAFE_API_KEY in the launching environment.',
 'jev-key-rejected':'The key was not accepted. Check the key and its API permissions, then try again. The previous saved key was retained.',
 'jev-check-rate-limited':'TypeSafe limited the authentication check. Wait before trying again. The previous saved key was retained.',
 'jev-check-unavailable':'The authentication check could not complete. Check your connection and try again. The previous saved key was retained.',
};
function fail(code,statusCode=400){const error=new Error(messages[code]??messages['jev-credential-input']);error.code=code;error.statusCode=statusCode;throw error;}
function key(value){if(typeof value!=='string'||value.length>512||!/^apikey_[A-Za-z0-9_-]{16,508}$/.test(value.trim()))fail('jev-credential-invalid');return value.trim();}
function request(input,fields){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!fields.includes(k))||input.confirmed!==true||typeof input.expectedRevision!=='string'||input.expectedRevision.length>80)fail('jev-credential-input');}
function stat(path){try{return lstatSync(path);}catch(error){if(error.code==='ENOENT')return null;fail('jev-credential-unsafe-storage');}}
function owned(s){return s&&!s.isSymbolicLink()&&(process.getuid===undefined||s.uid===process.getuid());}
function paths(options={},create=false){
 const declaredHome=resolve(options.home??homedir());
 const root=stat(declaredHome);if(!owned(root)||!root.isDirectory()||(root.mode&0o022))fail('jev-credential-unsafe-storage');
 let home,project;try{home=realpathSync(declaredHome);if(options.projectRoot)project=realpathSync(resolve(options.projectRoot));}catch{fail('jev-credential-unsafe-storage');}
 const folder=resolve(home,'.ewai/credentials'),file=resolve(folder,'jev.json');
 if(project){const rel=relative(project,file);if(rel===''||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../')))fail('jev-credential-unsafe-storage');}
 const canonicalRoot=stat(home);if(!owned(canonicalRoot)||canonicalRoot.ino!==root.ino||canonicalRoot.dev!==root.dev)fail('jev-credential-unsafe-storage');
 for(const path of [resolve(home,'.ewai'),folder]){
  let s=stat(path);if(!s&&create){try{mkdirSync(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')fail('jev-credential-unsafe-storage');}s=stat(path);}
  if(s&&(!owned(s)||!s.isDirectory()||(s.mode&(path===folder?0o077:0o022))))fail('jev-credential-unsafe-storage');
 }
 return {folder,file,location:JSON.stringify([home,root.dev,root.ino])};
}
function stored(options={}){
 const {file,location}=paths(options),before=stat(file);if(!before)return {value:null,signature:'missing',location};
 if(process.platform==='win32'||!owned(before)||!before.isFile()||before.nlink!==1||(before.mode&0o077)||before.size>4096)fail('jev-credential-unsafe-storage');
 let fd;try{
  fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);const bytes=readFileSync(fd),after=fstatSync(fd),current=stat(file);
  if(bytes.length>4096||!current||before.ino!==after.ino||before.dev!==after.dev||before.mtimeMs!==after.mtimeMs||after.ino!==current.ino||after.mtimeMs!==current.mtimeMs)fail('jev-credential-unsafe-storage');
  let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{fail('jev-credential-invalid-storage');}
  if(value?.schema!=='ewai.jev-credential/v1'||typeof value.revision!=='string'||!/^[a-f0-9-]{36}$/.test(value.revision)||Object.keys(value).some(k=>!['schema','revision','apiKey'].includes(k)))fail('jev-credential-invalid-storage');
  try{key(value.apiKey);}catch{fail('jev-credential-invalid-storage');}
  return {value,location,signature:JSON.stringify([after.dev,after.ino,after.mtimeMs,after.ctimeMs,createHash('sha256').update(bytes).digest('hex')])};
 }catch(error){if(error.code?.startsWith('jev-'))throw error;fail('jev-credential-unsafe-storage');}finally{if(fd!==undefined)closeSync(fd);}
}
function environment(options){const env=options.env??process.env;return env.TYPESAFE_API_KEY?key(env.TYPESAFE_API_KEY):null;}
export function jevCredentialStatus(options={}){
 const override=environment(options);let value,storageIssue=null;
 try{({value}=stored(options));}catch(error){if(!override)throw error;storageIssue='unsafe-saved-storage';}

 return {schema:'ewai.jev-credential-status/v1',provider:'jev',configured:Boolean(override||value),saved:storageIssue?null:Boolean(value),storageIssue,source:override?'environment':value?'saved':'missing',revision:value?.revision??(storageIssue?'unavailable':'missing'),storage:'owner-only-local-file',encrypted:false,storageSupported:!storageIssue&&process.platform!=='win32',authority:'credentials-only'};
}
export function resolveJevApiKey(options={}){const override=environment(options);return override??stored(options).value?.apiKey??null;}
function predecessor(input,options,expected){const current=stored(options);if((current.value?.revision??'missing')!==input.expectedRevision||(expected&&(current.signature!==expected.signature||current.location!==expected.location)))fail('jev-credential-stale',409);return current;}
function mutation(options,operation){
 if(process.platform==='win32')fail('jev-credential-unsafe-storage');
 const {folder}=paths(options,true),lock=resolve(folder,'.jev.lock');
 try{mkdirSync(lock,{mode:0o700});}catch(error){fail(error.code==='EEXIST'?'jev-credential-busy':'jev-credential-unsafe-storage',409);}
 const identity=lstatSync(lock);
 try{return operation();}finally{const current=stat(lock);if(owned(current)&&current.isDirectory()&&current.ino===identity.ino)rmSync(lock,{recursive:true});}
}
async function authenticate(apiKey,options={}){
 const controller=new AbortController();let timer;
 try{
  const timeout=Math.min(10000,Math.max(10,options.timeoutMs??10000));
  const response=await Promise.race([(options.fetchImpl??fetch)('https://api.typesafe.ai/v1/models',{method:'GET',headers:{authorization:'Bearer '+apiKey},redirect:'manual',signal:controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('deadline'));},timeout);})]);
  // Discard provider bodies, including errors. They are not safe evidence.
  if(response.body)void response.body.cancel().catch(()=>{});
  if(response.status===200)return {status:'verified',code:'jev-authentication-verified',message:'TypeSafe authentication check passed. No output was generated; credit and coding readiness remain unverified.'};
  const code=[401,403].includes(response.status)?'jev-key-rejected':response.status===429?'jev-check-rate-limited':'jev-check-unavailable';return {status:'failed',code,message:messages[code]};
 }catch{return {status:'failed',code:'jev-check-unavailable',message:messages['jev-check-unavailable']};}
 finally{clearTimeout(timer);controller.abort();}
}
export async function checkJevConnection(options={}){
 const apiKey=resolveJevApiKey(options);
 if(!apiKey)return {...jevCredentialStatus(options),status:'failed',code:'jev-credential-missing',message:messages['jev-credential-missing']};
 return {...jevCredentialStatus(options),...await authenticate(apiKey,options)};
}
// Internal cache identity includes physical file identity and exact bytes; it
// is never included in status, diagnostics or model-facing credential tools.
export function jevCredentialIdentity(options={}) {
 const override=environment(options);if(override)return createHash('sha256').update('environment '+override).digest('hex');
 const value=stored(options);return createHash('sha256').update(value.location+' '+value.signature).digest('hex');
}
export async function configureJevCredentials(input,options={}){
 request(input,['confirmed','expectedRevision','apiKey']);const apiKey=key(input.apiKey);environment(options);const previous=predecessor(input,options);
 const check=await authenticate(apiKey,options);if(check.status!=='verified')fail(check.code);
 mutation(options,()=>{
  predecessor(input,options,previous);const {file}=paths(options,true),temporary=file+'.'+randomUUID()+'.tmp';
  try{writeFileSync(temporary,JSON.stringify({schema:'ewai.jev-credential/v1',revision:randomUUID(),apiKey})+'\n',{flag:'wx',mode:0o600});paths(options);predecessor(input,options,previous);renameSync(temporary,file);}
  catch(error){if(error.code?.startsWith('jev-'))throw error;fail('jev-credential-unsafe-storage');}
  finally{if(stat(temporary))unlinkSync(temporary);}
 });
 return {...jevCredentialStatus(options),check,message:'Jev key checked and saved for your account on this computer. No work started.'};
}
export function removeJevCredentials(input,options={}){
 request(input,['confirmed','expectedRevision']);environment(options);const previous=predecessor(input,options);
 mutation(options,()=>{const current=predecessor(input,options,previous);if(current.value)unlinkSync(paths(options).file);});
 const status=jevCredentialStatus(options);return {...status,message:status.source==='environment'?'Saved key removed. TYPESAFE_API_KEY still supplies the active credential.':'Saved Jev key removed. No work started.'};
}
export function safeJevCredentialError(error){const code=Object.hasOwn(messages,error?.code)?error.code:'jev-credential-input';return {error:messages[code],code};}
