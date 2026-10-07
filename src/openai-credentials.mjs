// OpenAI uses the same audited private storage safeguards as Grok, with a separate key lifecycle.
import {constants,openSync,closeSync,fstatSync,lstatSync,realpathSync,readFileSync,mkdirSync,writeFileSync,renameSync,unlinkSync,rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,relative,isAbsolute} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';

const messages={
 'openai-credential-invalid':'Provide a valid OpenAI API key using the private setup form or hidden terminal prompt.',
 'openai-credential-input':'Use the supported credential action and confirm the change.',
 'openai-credential-unsafe-storage':'Private credential storage is unsafe or unavailable. Repair its permissions or use OPENAI_API_KEY in the launching environment.',
 'openai-credential-invalid-storage':'The saved credential could not be read safely. Repair the private credential file before continuing.',
 'openai-credential-stale':'The saved credential changed. Refresh its status and try again.',
 'openai-credential-busy':'Another credential change is running. Retry after it finishes.',
 'openai-credential-missing':'No OpenAI key is configured. Use private credential setup or OPENAI_API_KEY in the launching environment.',
 'openai-key-rejected':'The metadata authentication check was not accepted. Check the key and its models-read permission, then try again. This does not determine Decisions endpoint access. The previous saved key was retained.',
 'openai-check-rate-limited':'OpenAI limited the authentication check. Wait before trying again. The previous saved key was retained.',
 'openai-check-unavailable':'The authentication check could not complete. Check your connection and try again. The previous saved key was retained.',
};
function fail(code,statusCode=400){const error=new Error(messages[code]??messages['openai-credential-input']);error.code=code;error.statusCode=statusCode;throw error;}
function key(value){if(typeof value!=='string'||value.length>512||!/^sk-[A-Za-z0-9_-]{16,508}$/.test(value.trim()))fail('openai-credential-invalid');return value.trim();}
function request(input,fields){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!fields.includes(k))||input.confirmed!==true||typeof input.expectedRevision!=='string'||input.expectedRevision.length>80)fail('openai-credential-input');}
function stat(path){try{return lstatSync(path);}catch(error){if(error.code==='ENOENT')return null;fail('openai-credential-unsafe-storage');}}
function owned(s){return s&&!s.isSymbolicLink()&&(process.getuid===undefined||s.uid===process.getuid());}
function paths(options={},create=false){
 const declaredHome=resolve(options.home??homedir());
 const root=stat(declaredHome);if(!owned(root)||!root.isDirectory()||(root.mode&0o022))fail('openai-credential-unsafe-storage');
 let home,project;try{home=realpathSync(declaredHome);if(options.projectRoot)project=realpathSync(resolve(options.projectRoot));}catch{fail('openai-credential-unsafe-storage');}
 const folder=resolve(home,'.ewai/credentials'),file=resolve(folder,'openai.json');
 if(project){const rel=relative(project,file);if(rel===''||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../')))fail('openai-credential-unsafe-storage');}
 const canonicalRoot=stat(home);if(!owned(canonicalRoot)||canonicalRoot.ino!==root.ino||canonicalRoot.dev!==root.dev)fail('openai-credential-unsafe-storage');
 for(const path of [resolve(home,'.ewai'),folder]){
  let s=stat(path);if(!s&&create){try{mkdirSync(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')fail('openai-credential-unsafe-storage');}s=stat(path);}
  if(s&&(!owned(s)||!s.isDirectory()||(s.mode&(path===folder?0o077:0o022))))fail('openai-credential-unsafe-storage');
 }
 return {folder,file,location:JSON.stringify([home,root.dev,root.ino])};
}
function stored(options={}){
 const {file,location}=paths(options),before=stat(file);if(!before)return {value:null,signature:'missing',location};
 if(process.platform==='win32'||!owned(before)||!before.isFile()||before.nlink!==1||(before.mode&0o077)||before.size>4096)fail('openai-credential-unsafe-storage');
 let fd;try{
  fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);const bytes=readFileSync(fd),after=fstatSync(fd),current=stat(file);
  if(bytes.length>4096||!current||before.ino!==after.ino||before.dev!==after.dev||before.mtimeMs!==after.mtimeMs||after.ino!==current.ino||after.mtimeMs!==current.mtimeMs)fail('openai-credential-unsafe-storage');
  let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{fail('openai-credential-invalid-storage');}
  if(value?.schema!=='ewai.openai-credential/v1'||typeof value.revision!=='string'||!/^[a-f0-9-]{36}$/.test(value.revision)||Object.keys(value).some(k=>!['schema','revision','apiKey'].includes(k)))fail('openai-credential-invalid-storage');
  try{key(value.apiKey);}catch{fail('openai-credential-invalid-storage');}
  return {value,location,signature:JSON.stringify([after.dev,after.ino,after.mtimeMs,after.ctimeMs,createHash('sha256').update(bytes).digest('hex')])};
 }catch(error){if(error.code?.startsWith('openai-'))throw error;fail('openai-credential-unsafe-storage');}finally{if(fd!==undefined)closeSync(fd);}
}
function environment(options){const env=options.env??process.env;return env.OPENAI_API_KEY?key(env.OPENAI_API_KEY):null;}
export function openaiCredentialStatus(options={}){
 const override=environment(options);let value,storageIssue=null;
 try{({value}=stored(options));}catch(error){if(!override)throw error;storageIssue='unsafe-saved-storage';}

 return {schema:'ewai.openai-credential-status/v1',provider:'openai',configured:Boolean(override||value),saved:storageIssue?null:Boolean(value),storageIssue,source:override?'environment':value?'saved':'missing',revision:value?.revision??(storageIssue?'unavailable':'missing'),storage:'owner-only-local-file',encrypted:false,storageSupported:!storageIssue&&process.platform!=='win32',authority:'credentials-only'};
}
export function resolveOpenaiApiKey(options={}){const override=environment(options);return override??stored(options).value?.apiKey??null;}
function predecessor(input,options,expected){const current=stored(options);if((current.value?.revision??'missing')!==input.expectedRevision||(expected&&(current.signature!==expected.signature||current.location!==expected.location)))fail('openai-credential-stale',409);return current;}
function mutation(options,operation){
 if(process.platform==='win32')fail('openai-credential-unsafe-storage');
 const {folder}=paths(options,true),lock=resolve(folder,'.openai.lock');
 try{mkdirSync(lock,{mode:0o700});}catch(error){fail(error.code==='EEXIST'?'openai-credential-busy':'openai-credential-unsafe-storage',409);}
 const identity=lstatSync(lock);
 try{return operation();}finally{const current=stat(lock);if(owned(current)&&current.isDirectory()&&current.ino===identity.ino)rmSync(lock,{recursive:true});}
}
async function authenticate(apiKey,options={}){
 const controller=new AbortController();let timer;
 try{
  const timeout=Math.min(10000,Math.max(10,options.timeoutMs??10000));
  const response=await Promise.race([(options.fetchImpl??fetch)('https://api.openai.com/v1/models',{method:'GET',headers:{authorization:'Bearer '+apiKey},redirect:'manual',signal:controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('deadline'));},timeout);})]);
  // Discard provider bodies, including errors. They are not safe evidence.
  if(response.body)void response.body.cancel().catch(()=>{});
  if(response.status===200)return {status:'verified',code:'openai-authentication-verified',message:'OpenAI authentication check passed. No output was generated; Decisions endpoint access, credit and decision quality remain unverified.'};
  const code=[401,403].includes(response.status)?'openai-key-rejected':response.status===429?'openai-check-rate-limited':'openai-check-unavailable';return {status:'failed',code,message:messages[code]};
 }catch{return {status:'failed',code:'openai-check-unavailable',message:messages['openai-check-unavailable']};}
 finally{clearTimeout(timer);controller.abort();}
}
export async function checkOpenaiConnection(options={}){
 const apiKey=resolveOpenaiApiKey(options);
 if(!apiKey)return {...openaiCredentialStatus(options),status:'failed',code:'openai-credential-missing',message:messages['openai-credential-missing']};
 return {...openaiCredentialStatus(options),...await authenticate(apiKey,options)};
}
// Internal cache identity includes physical file identity and exact bytes; it
// is never included in status, diagnostics or model-facing credential tools.
export function openaiCredentialIdentity(options={}) {
 const override=environment(options);if(override)return createHash('sha256').update('environment '+override).digest('hex');
 const value=stored(options);return createHash('sha256').update(value.location+' '+value.signature).digest('hex');
}
export async function configureOpenaiCredentials(input,options={}){
 request(input,['confirmed','expectedRevision','apiKey']);const apiKey=key(input.apiKey);environment(options);const previous=predecessor(input,options);
 const check=await authenticate(apiKey,options);if(check.status!=='verified')fail(check.code);
 mutation(options,()=>{
  predecessor(input,options,previous);const {file}=paths(options,true),temporary=file+'.'+randomUUID()+'.tmp';
  try{writeFileSync(temporary,JSON.stringify({schema:'ewai.openai-credential/v1',revision:randomUUID(),apiKey})+'\n',{flag:'wx',mode:0o600});paths(options);predecessor(input,options,previous);renameSync(temporary,file);}
  catch(error){if(error.code?.startsWith('openai-'))throw error;fail('openai-credential-unsafe-storage');}
  finally{if(stat(temporary))unlinkSync(temporary);}
 });
 return {...openaiCredentialStatus(options),check,message:'OpenAI key checked and saved for your account on this computer. No work started.'};
}
export function removeOpenaiCredentials(input,options={}){
 request(input,['confirmed','expectedRevision']);environment(options);const previous=predecessor(input,options);
 mutation(options,()=>{const current=predecessor(input,options,previous);if(current.value)unlinkSync(paths(options).file);});
 const status=openaiCredentialStatus(options);return {...status,message:status.source==='environment'?'Saved key removed. OPENAI_API_KEY still supplies the active credential.':'Saved OpenAI key removed. No work started.'};
}
export function safeOpenaiCredentialError(error){const code=Object.hasOwn(messages,error?.code)?error.code:'openai-credential-input';return {error:messages[code],code};}
