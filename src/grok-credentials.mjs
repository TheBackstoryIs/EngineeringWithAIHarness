import {constants,openSync,closeSync,fstatSync,lstatSync,realpathSync,readFileSync,mkdirSync,writeFileSync,renameSync,unlinkSync,rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,relative,isAbsolute} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';

const messages={
 'grok-credential-invalid':'Provide a valid xAI API key using the private setup form or hidden terminal prompt.',
 'grok-credential-input':'Use the supported credential action and confirm the change.',
 'grok-credential-unsafe-storage':'Private credential storage is unsafe or unavailable. Repair its permissions or use XAI_API_KEY in the launching environment.',
 'grok-credential-invalid-storage':'The saved credential could not be read safely. Repair the private credential file before continuing.',
 'grok-credential-stale':'The saved credential changed. Refresh its status and try again.',
 'grok-credential-busy':'Another credential change is running. Retry after it finishes.',
 'grok-credential-missing':'No Grok key is configured. Use private credential setup or XAI_API_KEY in the launching environment.',
 'grok-key-rejected':'The key was not accepted. Check the key and its API permissions, then try again. The previous saved key was retained.',
 'grok-check-rate-limited':'xAI limited the authentication check. Wait before trying again. The previous saved key was retained.',
 'grok-check-unavailable':'The authentication check could not complete. Check your connection and try again. The previous saved key was retained.',
};
function fail(code,statusCode=400){const error=new Error(messages[code]??messages['grok-credential-input']);error.code=code;error.statusCode=statusCode;throw error;}
function key(value){if(typeof value!=='string'||value.length>512||!/^xai-[A-Za-z0-9_-]{16,508}$/.test(value.trim()))fail('grok-credential-invalid');return value.trim();}
function request(input,fields){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!fields.includes(k))||input.confirmed!==true||typeof input.expectedRevision!=='string'||input.expectedRevision.length>80)fail('grok-credential-input');}
function stat(path){try{return lstatSync(path);}catch(error){if(error.code==='ENOENT')return null;fail('grok-credential-unsafe-storage');}}
function owned(s){return s&&!s.isSymbolicLink()&&(process.getuid===undefined||s.uid===process.getuid());}
function paths(options={},create=false){
 const declaredHome=resolve(options.home??homedir());
 const root=stat(declaredHome);if(!owned(root)||!root.isDirectory()||(root.mode&0o022))fail('grok-credential-unsafe-storage');
 let home,project;try{home=realpathSync(declaredHome);if(options.projectRoot)project=realpathSync(resolve(options.projectRoot));}catch{fail('grok-credential-unsafe-storage');}
 const folder=resolve(home,'.ewai/credentials'),file=resolve(folder,'grok.json');
 if(project){const rel=relative(project,file);if(rel===''||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../')))fail('grok-credential-unsafe-storage');}
 const canonicalRoot=stat(home);if(!owned(canonicalRoot)||canonicalRoot.ino!==root.ino||canonicalRoot.dev!==root.dev)fail('grok-credential-unsafe-storage');
 for(const path of [resolve(home,'.ewai'),folder]){
  let s=stat(path);if(!s&&create){try{mkdirSync(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')fail('grok-credential-unsafe-storage');}s=stat(path);}
  if(s&&(!owned(s)||!s.isDirectory()||(s.mode&(path===folder?0o077:0o022))))fail('grok-credential-unsafe-storage');
 }
 return {folder,file,location:JSON.stringify([home,root.dev,root.ino])};
}
function stored(options={}){
 const {file,location}=paths(options),before=stat(file);if(!before)return {value:null,signature:'missing',location};
 if(process.platform==='win32'||!owned(before)||!before.isFile()||before.nlink!==1||(before.mode&0o077)||before.size>4096)fail('grok-credential-unsafe-storage');
 let fd;try{
  fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);const bytes=readFileSync(fd),after=fstatSync(fd),current=stat(file);
  if(bytes.length>4096||!current||before.ino!==after.ino||before.dev!==after.dev||before.mtimeMs!==after.mtimeMs||after.ino!==current.ino||after.mtimeMs!==current.mtimeMs)fail('grok-credential-unsafe-storage');
  let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{fail('grok-credential-invalid-storage');}
  if(value?.schema!=='ewai.grok-credential/v1'||typeof value.revision!=='string'||!/^[a-f0-9-]{36}$/.test(value.revision)||Object.keys(value).some(k=>!['schema','revision','apiKey'].includes(k)))fail('grok-credential-invalid-storage');
  try{key(value.apiKey);}catch{fail('grok-credential-invalid-storage');}
  return {value,location,signature:JSON.stringify([after.dev,after.ino,after.mtimeMs,after.ctimeMs,createHash('sha256').update(bytes).digest('hex')])};
 }catch(error){if(error.code?.startsWith('grok-'))throw error;fail('grok-credential-unsafe-storage');}finally{if(fd!==undefined)closeSync(fd);}
}
function environment(options){const env=options.env??process.env;return env.XAI_API_KEY?key(env.XAI_API_KEY):null;}
export function grokCredentialStatus(options={}){
 const {value}=stored(options),override=environment(options);
 return {schema:'ewai.grok-credential-status/v1',provider:'grok',configured:Boolean(override||value),saved:Boolean(value),source:override?'environment':value?'saved':'missing',revision:value?.revision??'missing',storage:'owner-only-local-file',encrypted:false,storageSupported:process.platform!=='win32',authority:'credentials-only'};
}
export function resolveGrokApiKey(options={}){const override=environment(options);return override??stored(options).value?.apiKey??null;}
function predecessor(input,options,expected){const current=stored(options);if((current.value?.revision??'missing')!==input.expectedRevision||(expected&&(current.signature!==expected.signature||current.location!==expected.location)))fail('grok-credential-stale',409);return current;}
function mutation(options,operation){
 if(process.platform==='win32')fail('grok-credential-unsafe-storage');
 const {folder}=paths(options,true),lock=resolve(folder,'.grok.lock');
 try{mkdirSync(lock,{mode:0o700});}catch(error){fail(error.code==='EEXIST'?'grok-credential-busy':'grok-credential-unsafe-storage',409);}
 const identity=lstatSync(lock);
 try{return operation();}finally{const current=stat(lock);if(owned(current)&&current.isDirectory()&&current.ino===identity.ino)rmSync(lock,{recursive:true});}
}
async function authenticate(apiKey,options={}){
 const controller=new AbortController();let timer;
 try{
  const timeout=Math.min(10000,Math.max(10,options.timeoutMs??10000));
  const response=await Promise.race([(options.fetchImpl??fetch)('https://api.x.ai/v1/models',{method:'GET',headers:{authorization:'Bearer '+apiKey},redirect:'manual',signal:controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('deadline'));},timeout);})]);
  // Discard provider bodies, including errors. They are not safe evidence.
  if(response.body)void response.body.cancel().catch(()=>{});
  if(response.status===200)return {status:'verified',code:'grok-authentication-verified',message:'xAI authentication check passed. No output was generated; credit and coding readiness remain unverified.'};
  const code=[401,403].includes(response.status)?'grok-key-rejected':response.status===429?'grok-check-rate-limited':'grok-check-unavailable';return {status:'failed',code,message:messages[code]};
 }catch{return {status:'failed',code:'grok-check-unavailable',message:messages['grok-check-unavailable']};}
 finally{clearTimeout(timer);controller.abort();}
}
export async function checkGrokConnection(options={}){
 const apiKey=resolveGrokApiKey(options);
 if(!apiKey)return {...grokCredentialStatus(options),status:'failed',code:'grok-credential-missing',message:messages['grok-credential-missing']};
 return {...grokCredentialStatus(options),...await authenticate(apiKey,options)};
}
export async function configureGrokCredentials(input,options={}){
 request(input,['confirmed','expectedRevision','apiKey']);const apiKey=key(input.apiKey);environment(options);const previous=predecessor(input,options);
 const check=await authenticate(apiKey,options);if(check.status!=='verified')fail(check.code);
 mutation(options,()=>{
  predecessor(input,options,previous);const {file}=paths(options,true),temporary=file+'.'+randomUUID()+'.tmp';
  try{writeFileSync(temporary,JSON.stringify({schema:'ewai.grok-credential/v1',revision:randomUUID(),apiKey})+'\n',{flag:'wx',mode:0o600});paths(options);predecessor(input,options,previous);renameSync(temporary,file);}
  catch(error){if(error.code?.startsWith('grok-'))throw error;fail('grok-credential-unsafe-storage');}
  finally{if(stat(temporary))unlinkSync(temporary);}
 });
 return {...grokCredentialStatus(options),check,message:'Grok key checked and saved for your account on this computer. No work started.'};
}
export function removeGrokCredentials(input,options={}){
 request(input,['confirmed','expectedRevision']);environment(options);const previous=predecessor(input,options);
 mutation(options,()=>{const current=predecessor(input,options,previous);if(current.value)unlinkSync(paths(options).file);});
 const status=grokCredentialStatus(options);return {...status,message:status.source==='environment'?'Saved key removed. XAI_API_KEY still supplies the active credential.':'Saved Grok key removed. No work started.'};
}
export function safeGrokCredentialError(error){const code=Object.hasOwn(messages,error?.code)?error.code:'grok-credential-input';return {error:messages[code],code};}
