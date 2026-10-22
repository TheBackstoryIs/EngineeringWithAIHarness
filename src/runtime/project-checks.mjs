import {spawn} from 'node:child_process';
import {existsSync, readdirSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {withIntentMutation, acquireIntentOwnership, renewIntentOwnership, releaseIntentOwnership, recoverStoppedIntentOwnership, resolveIntentMutationReference} from './intent-ownership.mjs';
import {openRuntimeDatabase} from './database.mjs';
import {loadProjectConfig} from '../project.mjs';
import {heartbeatExecutionLease} from './execution-leases.mjs';
import {hash, requestHash, fail, closed, safePath, readBytes, readJson, atomicRecord, environment, context, phaseContext, phaseFingerprint, repository, protectedFile, snapshot, operationPaths, reserve, release, readAttempt, receipt, readReceipt} from './project-operation-files.mjs';

const TERMINAL = new Set(['completed','failed','cancelled','timed-out','output-limit','recovery-required']);
function alive(pid) { if (!Number.isInteger(pid) || pid<1) return null; try {process.kill(pid,0);return true;}catch(error){return error.code==='ESRCH'?false:null;} }
function groupAlive(pid) { if(!Number.isInteger(pid)||pid<1)return null;try{process.kill(-pid,0);return true;}catch(error){return error.code==='ESRCH'?false:null;} }
const equal = (a,b) => JSON.stringify(a)===JSON.stringify(b);
function safeOutput(bytes) {
  return bytes.toString('utf8').replace(/(?:Bearer\s+|sk-[A-Za-z0-9_-]{8,}|(?:api[_-]?key|password|secret|token)["']?\s*[:=]\s*["']?)[^\s"']+/gi,'[redacted]');
}
function launchState(ctx,paths) { return existsSync(safePath(ctx.root,paths.launch))?readJson(ctx.root,paths.launch):null; }
export async function startProjectCheck(root,input) {
  closed(input,['slug','phase','operationId','check','confirmed','taskId','leaseId','leaseToken']);
  if(input.confirmed!==true)fail('confirmation-required');
  if(typeof input.phase!=='string'||!/^[a-z]+(?:-[a-z]+)*$/.test(input.phase))fail('invalid-input');
  const ctx=context(root),paths=operationPaths(ctx,input.slug,input.operationId),requestDigest=requestHash(input);
  if(existsSync(safePath(ctx.root,paths.attempt))){const a=readAttempt(ctx,paths,input.slug,input.operationId);if(a.requestDigest!==requestDigest)fail('replay-conflict');return {...projectCheckStatus(root,{slug:input.slug,operationId:input.operationId}),replayed:true};}
  const check=ctx.checks[input.check];if(!check)fail('unknown-check');
  if(process.platform==='win32')fail('process-tree-control-unavailable');
  const {assertTaskAuthority}=await import('./project-operations.mjs');
  reserve(ctx,paths,input.slug,input.operationId);
  let child;
  try {
    withIntentMutation(ctx.root,input.slug,{action:'project-check-start',phase:input.phase},()=>{
      const current=phaseContext(ctx,input.slug,input.phase);
      if(!check.phases.includes(current.phase))fail('check-phase-conflict');
      if(current.phase==='build'){
        const task=assertTaskAuthority(ctx,current,{...input,repository:check.repository},{writing:false});
        if(!(task.allowed_commands??[]).includes([check.executable,...check.args].join(' ')))fail('check-outside-task-command-scope');
      }
      const before=snapshot(ctx);
      atomicRecord(ctx.root,paths.attempt,{schema:'ewai.project-operation/v1',kind:'check',dispatchProtocol:'launch-permit-v1',operationId:input.operationId,slug:input.slug,phase:current.phase,check:input.check,requestDigest,configDigest:ctx.configDigest,before,phaseDigest:phaseFingerprint(ctx,current),createdAt:new Date().toISOString()},true);
      if(input.taskId!==undefined)atomicRecord(ctx.root,resolve(paths.runtime,'task-authority.json'),{taskId:input.taskId,leaseId:input.leaseId,leaseToken:input.leaseToken},true);
    });
    child=spawn(process.execPath,[fileURLToPath(new URL('./project-check-worker.mjs',import.meta.url)),ctx.root,input.slug,input.operationId],{detached:true,stdio:'ignore',env:environment()});
    // The launch record precedes returning the run ID; a reconnect never dispatches again.
    if(child.pid)atomicRecord(ctx.root,paths.launch,{pid:child.pid,launchedAt:new Date().toISOString()},true);
    await once(child,'spawn');child.unref();
    return projectCheckStatus(root,{slug:input.slug,operationId:input.operationId});
  } catch(error) {
    if(!child?.pid){if(existsSync(paths.attempt)&&!readReceipt(ctx,paths))receipt(ctx,paths,{...readAttempt(ctx,paths,input.slug,input.operationId),status:'failed',failure:'worker-unavailable',evidencePath:relative(ctx.root,paths.receipt)});release(ctx,paths,input.operationId);}
    else child.unref();
    throw error;
  }
}
export function projectCheckStatus(root,input) {
  closed(input,['slug','operationId']);
  const ctx=context(root,false),paths=operationPaths(ctx,input.slug,input.operationId),attempt=readAttempt(ctx,paths,input.slug,input.operationId);
  if(attempt.kind!=='check')fail('not-a-check');
  const done=readReceipt(ctx,paths);
  if(done&&existsSync(safePath(ctx.root,paths.lock))&&readJson(ctx.root,paths.lock).operationId===input.operationId){
    const stopped=alive(launchState(ctx,paths)?.pid)===false;
    return {operationId:input.operationId,slug:input.slug,phase:attempt.phase,status:stopped?'recovery-required':'running',finishing:true,passed:false,fresh:false};
  }
  if(!done){
    const launch=launchState(ctx,paths),heartbeat=existsSync(safePath(ctx.root,paths.heartbeat))?readJson(ctx.root,paths.heartbeat):null;
    const reservation=!launch&&existsSync(paths.lock)?readJson(ctx.root,paths.lock):null;
    const stopped=launch&&alive(launch.pid)===false||!launch&&attempt.dispatchProtocol==='launch-permit-v1'&&reservation?.operationId===input.operationId&&alive(reservation.pid)===false,expired=Date.now()-Date.parse(heartbeat?.at??attempt.createdAt)>610000;
    return {operationId:input.operationId,slug:input.slug,phase:attempt.phase,status:stopped||expired?'recovery-required':heartbeat?'running':'queued',passed:false,fresh:false};
  }
  let fresh=false,output='';
  if(done.outputSha256){const bytes=readBytes(ctx.root,paths.output,1048576);if(hash(bytes)!==done.outputSha256)fail('check-output-changed');output=bytes.toString('utf8');}
  try {const current=phaseContext(ctx,input.slug,attempt.phase);fresh=ctx.policy.enabled&&ctx.configDigest===attempt.configDigest&&equal(snapshot(ctx),done.after)&&equal(attempt.before,done.after)&&done.afterPhaseDigest===attempt.phaseDigest&&phaseFingerprint(ctx,current)===attempt.phaseDigest;}catch{fresh=false;}
  return {...done,output,fresh,passed:done.status==='completed'&&done.exitCode===0&&fresh};
}
export function cancelProjectCheck(root,input) {
  closed(input,['slug','operationId','confirmed']);if(input.confirmed!==true)fail('confirmation-required');
  const ctx=context(root,false),paths=operationPaths(ctx,input.slug,input.operationId),attempt=readAttempt(ctx,paths,input.slug,input.operationId);
  if(attempt.kind!=='check')fail('not-a-check');
  const done=readReceipt(ctx,paths);if(done)return projectCheckStatus(root,{slug:input.slug,operationId:input.operationId});
  if(!existsSync(safePath(ctx.root,paths.cancel)))atomicRecord(ctx.root,paths.cancel,{operationId:input.operationId},true);
  return {...projectCheckStatus(root,{slug:input.slug,operationId:input.operationId}),cancelRequested:true};
}
export function recoverProjectOperation(root,input) {
  closed(input,['slug','operationId','confirmed']);if(input.confirmed!==true)fail('confirmation-required');
  const ctx=context(root,false),paths=operationPaths(ctx,input.slug,input.operationId);
  if(!existsSync(safePath(ctx.root,paths.attempt))){
    if(!existsSync(safePath(ctx.root,paths.lock)))fail('unknown-operation');
    const lock=readJson(ctx.root,paths.lock);
    if(lock.schema!=='ewai.project-reservation/v1'||lock.slug!==input.slug||lock.operationId!==input.operationId)fail('unknown-operation');
    if(alive(lock.pid)!==false||existsSync(paths.launch)||existsSync(paths.heartbeat))fail('execution-stop-unverified');
    // Publication and dispatch both require the immutable attempt to exist first.
    const reservation={schema:'ewai.project-operation/v1',kind:'reservation',operationId:input.operationId,slug:input.slug,requestDigest:null,createdAt:lock.createdAt};
    atomicRecord(ctx.root,paths.attempt,reservation,true);
    const recovered=receipt(ctx,paths,{...reservation,status:'failed',executionStopped:true,failure:'interrupted-before-dispatch',evidencePath:relative(ctx.root,paths.receipt)});release(ctx,paths,input.operationId);return recovered;
  }
  const attempt=readAttempt(ctx,paths,input.slug,input.operationId),done=readReceipt(ctx,paths);
  if(done){
    if(attempt.kind==='check'&&existsSync(paths.lock)&&readJson(ctx.root,paths.lock).operationId===input.operationId){
      const pid=launchState(ctx,paths)?.pid;
      if(alive(pid)!==false)fail('execution-stop-unverified');
      const heartbeat=existsSync(paths.heartbeat)?readJson(ctx.root,paths.heartbeat):null;
      if(done.executionStopped!==true&&groupAlive(heartbeat?.childPid)!==false)fail('check-process-stop-unverified');
      releaseStoppedOwner(ctx,input.slug,pid);
    }
    release(ctx,paths,input.operationId);return {...done,replayed:true};
  }
  if(attempt.kind==='check'&&attempt.dispatchProtocol==='launch-permit-v1'&&!existsSync(safePath(ctx.root,paths.launch))){
    const lock=readJson(ctx.root,paths.lock),heartbeat=existsSync(paths.heartbeat)?readJson(ctx.root,paths.heartbeat):null;
    if(lock.operationId!==input.operationId||lock.slug!==input.slug||alive(lock.pid)!==false||heartbeat?.childPid)fail('execution-stop-unverified');
    const recovered=receipt(ctx,paths,{...attempt,status:'failed',executionStopped:true,failure:'interrupted-before-dispatch',evidencePath:relative(ctx.root,paths.receipt)});release(ctx,paths,input.operationId);return recovered;
  }
  const pid=attempt.kind==='check'?launchState(ctx,paths)?.pid:attempt.pid;
  if(alive(pid)!==false)fail('execution-stop-unverified');
  if(attempt.kind==='check'){
    const heartbeat=existsSync(safePath(ctx.root,paths.heartbeat))?readJson(ctx.root,paths.heartbeat):null;
    if(groupAlive(heartbeat?.childPid)!==false)fail('check-process-stop-unverified');
  }
  let status='recovery-required';
  if(attempt.kind==='change'){
    const repo=attempt.target.kind==='code'?repository(ctx,attempt.target.repository):ctx.root;
    const target=attempt.target.kind==='code'?protectedFile(ctx,repo,attempt.target.path,true):safePath(ctx.root,resolve(ctx.buildRoot,input.slug,attempt.target.path));
    const observed=existsSync(target)?hash(readBytes(repo,target)):null;
    status=observed===attempt.afterSha256?'completed':observed===attempt.beforeSha256?'failed':'recovery-required';
  }
  const result=receipt(ctx,paths,{...attempt,status,failure:'interrupted-operation-not-rerun',evidencePath:relative(ctx.root,paths.receipt)});
  if(attempt.kind==='check')releaseStoppedOwner(ctx,input.slug,pid);
  release(ctx,paths,input.operationId);return result;
}
function releaseStoppedOwner(ctx,slug,pid){
  const db=openRuntimeDatabase(ctx.root);let owner;
  try{owner=db.prepare('SELECT * FROM intent_ownership WHERE intent_id = ? AND pid = ?').get(resolveIntentMutationReference(ctx.root,slug),pid);}finally{db.close();}
  if(owner)recoverStoppedIntentOwnership(ctx.root,{pid,epoch:owner.epoch,generation:owner.generation,processInstance:owner.process_instance},owner.intent_id);
}
async function groupStopped(pid){
  for(let i=0;i<40;i++){const present=groupAlive(pid);if(present===false)return true;if(present===null)return false;await new Promise(done=>setTimeout(done,25));}
  return false;
}

export function assertProjectChecksFresh(root,slug,phase) {
  if(loadProjectConfig(root).config.remote_operations?.enabled!==true)return [];
  const ctx=context(root);
  const expected=Object.entries(ctx.checks).filter(([,check])=>check.phases.includes(phase)).map(([name])=>name);
  if(!expected.length)return [];
  const directory=safePath(ctx.root,resolve(ctx.buildRoot,slug,'evidence/project-operations'));
  const receipts=existsSync(directory)?readdirSync(directory).filter(name=>/^[a-f0-9-]{36}\.json$/.test(name)):[];
  const accepted=[];
  for(const name of expected){
    let found;
    for(const file of receipts){
      const id=file.slice(0,-5),paths=operationPaths(ctx,slug,id),record=readReceipt(ctx,paths);
      if(record.kind!=='check'||record.phase!==phase||record.check!==name)continue;
      const status=projectCheckStatus(root,{slug,operationId:id});if(status.passed){found=status.evidencePath;break;}
    }
    if(!found)fail('required-project-check-missing-or-stale');accepted.push(found);
  }
  return accepted;
}

function terminate(child,signal) {
  if(!child?.pid)return;
  try {if(process.platform==='win32')child.kill(signal);else process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}
}
export async function executeProjectCheck(root,slug,id) {
  let ctx=context(root,false);const paths=operationPaths(ctx,slug,id),attempt=readAttempt(ctx,paths,slug,id);
  if(readReceipt(ctx,paths))return;
  let owner,child,timer,heartbeat,killTimer,taskAuthority,lastLeaseRenewal=0,status='failed',exitCode=null,signal=null,after=null,afterPhaseDigest=null,failure=null;
  const chunks=[];let total=0;
  const stop=reason=>{if(status==='running'){status=reason;terminate(child,'SIGTERM');killTimer=setTimeout(()=>terminate(child,'SIGKILL'),300);}};
  try {
    if(attempt.kind!=='check'||readReceipt(ctx,paths))fail('invalid-check-attempt');
    // A spawned worker cannot dispatch until its initiating process durably
    // records this exact PID. Missing launch metadata therefore cannot hide
    // execution in the attempt-before-launch recovery window.
    for(let i=0;i<500&&!existsSync(safePath(ctx.root,paths.launch));i++){
      if(readReceipt(ctx,paths))return;
      atomicRecord(ctx.root,paths.heartbeat,{pid:process.pid,childPid:null,stage:'awaiting-launch',at:new Date().toISOString()});
      await new Promise(done=>setTimeout(done,10));
    }
    if(launchState(ctx,paths)?.pid!==process.pid)fail('launch-permit-missing');
    ctx=context(root,false);
    const lock=readJson(ctx.root,paths.lock);if(lock.operationId!==id)fail('project-lock-changed');
    owner=acquireIntentOwnership(ctx.root,slug,{ownerId:'project-check-'+id,durationMs:900000});
    const current=phaseContext(ctx,slug,attempt.phase),check=ctx.checks[attempt.check];
    if(!ctx.policy.enabled||ctx.configDigest!==attempt.configDigest||!check?.phases.includes(current.phase)||!equal(snapshot(ctx),attempt.before))fail('check-input-changed');
    if(current.phase==='build'){
      const authority=readJson(ctx.root,resolve(paths.runtime,'task-authority.json'));
      taskAuthority=authority;
      const {assertTaskAuthority}=await import('./project-operations.mjs');
      const task=assertTaskAuthority(ctx,current,{...authority,slug,repository:check.repository},{writing:false});
      // Checks use the approved task command set as an additional bound.
      const configured=[check.executable,...check.args].join(' ');
      if(!(task.allowed_commands??[]).includes(configured))fail('check-outside-task-command-scope');
    }
    if(existsSync(safePath(ctx.root,paths.cancel))){status='cancelled';return;}
    child=spawn(check.executable,check.args,{cwd:repository(ctx,check.repository),shell:false,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe'],env:environment()});
    status='running';
    const pulse=()=>{
      atomicRecord(ctx.root,paths.heartbeat,{pid:process.pid,childPid:child.pid??null,at:new Date().toISOString()});
      if(existsSync(safePath(ctx.root,paths.cancel)))stop('cancelled');
      if(taskAuthority&&Date.now()-lastLeaseRenewal>1000){heartbeatExecutionLease(ctx.root,taskAuthority.leaseId,{token:taskAuthority.leaseToken,durationMs:check.timeout_ms+60000});lastLeaseRenewal=Date.now();}
    };
    pulse();heartbeat=setInterval(()=>{try{pulse();}catch{stop('failed');}},100);
    timer=setTimeout(()=>stop('timed-out'),check.timeout_ms);
    const capture=data=>{const available=check.max_output_bytes-total;if(available>0){const part=Buffer.from(data).subarray(0,available);chunks.push(part);total+=part.length;}if(data.length>available)stop('output-limit');};
    child.stdout.on('data',capture);child.stderr.on('data',capture);
    await new Promise(resolveDone=>{child.once('error',()=>{failure='check-executable-unavailable';status='failed';resolveDone();});child.once('close',(code,terminated)=>{exitCode=code;signal=terminated;resolveDone();});});
    if(status==='running')status=exitCode===0?'completed':'failed';
    // Also stop descendants that outlived their leader before releasing ownership.
    terminate(child,'SIGKILL');
    after=snapshot(context(root,false));
    afterPhaseDigest=phaseFingerprint(context(root,false),phaseContext(context(root,false),slug,attempt.phase));
    if(status==='completed'&&(!equal(after,attempt.before)||context(root,false).configDigest!==attempt.configDigest||afterPhaseDigest!==attempt.phaseDigest))status='failed';
    renewIntentOwnership(ctx.root,owner,{durationMs:60000});
  } catch(error) {failure=error.code??'check-failed';if(status==='running')stop('failed');}
  finally {
    clearTimeout(timer);clearInterval(heartbeat);clearTimeout(killTimer);
    try{terminate(child,'SIGKILL');}catch{status='recovery-required';failure='termination-unverified';}
    const executionStopped=!child?.pid||await groupStopped(child.pid);
    if(!executionStopped){status='recovery-required';failure='termination-unverified';}
    const output=Buffer.from(safeOutput(Buffer.concat(chunks)));
    const bound=ctx.checks[attempt.check]?.max_output_bytes??1048576,bytes=output.subarray(0,bound);
    try {
      if(!readReceipt(ctx,paths)){
        mkdirSync(dirname(safePath(ctx.root,paths.output)),{recursive:true,mode:0o700});writeFileSync(paths.output,bytes,{flag:'wx',mode:0o600});
        receipt(ctx,paths,{...attempt,status:TERMINAL.has(status)?status:'failed',executionStopped,exitCode,signal,failure,after,afterPhaseDigest,outputSha256:hash(bytes),evidencePath:relative(ctx.root,paths.receipt).replaceAll('\\','/')});
      }
    } finally {
      if(executionStopped){if(owner)try{releaseIntentOwnership(ctx.root,owner);}catch{}release(ctx,paths,id);}
    }
  }
}
