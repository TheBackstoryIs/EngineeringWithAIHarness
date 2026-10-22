import {existsSync, mkdirSync, openSync, closeSync, writeFileSync, fsyncSync, renameSync, unlinkSync, lstatSync, constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {dirname, relative, resolve} from 'node:path';
import {withIntentMutation} from './intent-ownership.mjs';
import {listExecutionLeases} from './execution-leases.mjs';
import {assertCompletedEvidenceFresh} from '../delivery-gates.mjs';
import {deliveryPaths} from '../delivery-documents.mjs';
import {requiredPhaseArtefacts} from '../delivery-artifacts.mjs';
import {MAX_FILE_BYTES, hash, requestHash, fail, closed, localPath, safePath, readBytes, readJson, atomicRecord, writable, context, phaseContext, repository, protectedFile, git, operationPaths, reserve, release, readAttempt, receipt, readReceipt} from './project-operation-files.mjs';
export {startProjectCheck, projectCheckStatus, cancelProjectCheck, recoverProjectOperation} from './project-checks.mjs';

export function projectCapabilities(root, input = {}) {
  closed(input, []);
  const ctx = context(root, false);
  return {schema:'ewai.project-capabilities/v1',enabled:ctx.policy.enabled,transport:'existing-mcp',readFiles:ctx.policy.enabled,
    writeEvidence:ctx.policy.enabled && writable(ctx.root,ctx.buildRoot),codeWritesConfigured:ctx.policy.enabled && ctx.policy.allow_code_writes === true,
    localExecutionSupported:process.platform!=='win32',repositories:[...ctx.repositories.keys()],checks:Object.entries(ctx.checks).map(([name,check])=>({name,repository:check.repository,phases:check.phases})),
    authority:'Existing delivery gates and human approvals remain required; no Git publication authority.'};
}
export function projectPreflight(root, input) {
  closed(input, ['slug','phase','requireCodeWrites']);
  if(input.requireCodeWrites!==undefined&&typeof input.requireCodeWrites!=='boolean')fail('invalid-input');
  const ctx = context(root,false), current = phaseContext(ctx,input.slug,input.phase);
  const missing = [];
  if (!ctx.policy.enabled) missing.push('remote-operations-disabled');
  if (!writable(ctx.root,current.deliveryRoot)) missing.push('evidence-not-writable');
  for (const repo of ctx.repositories.values()) {
    try { git(repo,['rev-parse','--git-dir']); } catch { missing.push('repository-unavailable'); }
  }
  const checks = Object.entries(ctx.checks).filter(([,check])=>check.phases.includes(current.phase));
  if (!checks.length) missing.push('no-named-check-for-phase');
  if(process.platform==='win32')missing.push('process-tree-control-unavailable');
  for (const [,check] of checks) {
    try { const stat=lstatSync(check.executable); if (!stat.isFile() && !stat.isSymbolicLink()) fail('check-executable-unavailable'); } catch { missing.push('check-executable-unavailable'); }
  }
  if (current.phase === 'build' && !current.state.approvals.build) missing.push('build-approval-required');
  const editCode=ctx.policy.enabled&&current.phase==='build'&&Boolean(current.state.approvals.build)&&ctx.policy.allow_code_writes===true;
  if(input.requireCodeWrites===true&&!editCode)missing.push('code-writing-unavailable');
  return {schema:'ewai.project-preflight/v1',slug:input.slug,phase:current.phase,ready:missing.length===0,capabilities:{readFiles:ctx.policy.enabled,writeEvidence:ctx.policy.enabled&&writable(ctx.root,current.deliveryRoot),runChecks:ctx.policy.enabled&&checks.length>0,editCode},missing:[...new Set(missing)],checks:checks.map(([name])=>name),configDigest:ctx.configDigest};
}
export function readProjectFile(root,input) {
  closed(input,['repository','path']);
  const ctx=context(root),repo=repository(ctx,input.repository),path=protectedFile(ctx,repo,input.path),bytes=readBytes(repo,path);
  let content; try { content=new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { fail('non-text-file'); }
  if (content.includes('\0')) fail('non-text-file');
  return {repository:input.repository,path:input.path,content,sha256:hash(bytes),bytes:bytes.length};
}
export function assertTaskAuthority(ctx,current,input,{writing=true}={}) {
  if (current.phase !== 'build' || writing && ctx.policy.allow_code_writes !== true || !current.state.approvals.build) fail('build-approval-required');
  const approval=readJson(ctx.root,resolve(current.deliveryRoot,'gates/build/build-approval.json'));
  if (approval.schema !== 'ewai.build-approval/v1' || approval.slug !== input.slug || approval.decision !== 'approved'
    || approval.approvedBy !== current.state.approvals.build.approvedBy || approval.approvedAt !== current.state.approvals.build.approvedAt) fail('build-approval-required');
  assertCompletedEvidenceFresh(deliveryPaths(ctx.root,input.slug),current.state);
  const graph=readJson(ctx.root,resolve(current.deliveryRoot,'task-graph.json')),task=graph.tasks?.find(item=>item.id===input.taskId);
  if (!task || task.repo !== input.repository) fail('task-scope-conflict');
  const leases=listExecutionLeases(ctx.root,{activeOnly:true,includeTokens:true,workItemId:current.state.intent.id});
  const lease=leases.find(item=>item.id===input.leaseId && item.token===input.leaseToken && item.taskId===input.taskId);
  if (!lease) fail('task-lease-required');
  if (git(repository(ctx,input.repository),['branch','--show-current']).trim() !== task.branch) fail('task-branch-conflict');
  return task;
}
function changeTarget(ctx,current,input) {
  const path=localPath(input.path);
  if (input.kind==='code') {
    const task=assertTaskAuthority(ctx,current,input),repo=repository(ctx,input.repository);
    if (!(task.write_set??[]).some(boundary=>{const stem=boundary.replace(/\/\*\*$/,'').replace(/\/$/,'');return !stem.includes('*') && (path===stem || path.startsWith(stem+'/'));})) fail('task-scope-conflict');
    return {root:repo,path:protectedFile(ctx,repo,path,true)};
  }
  if (input.kind!=='evidence' || input.repository !== undefined || input.taskId !== undefined || input.leaseId !== undefined || input.leaseToken !== undefined) fail('invalid-input');
  // Generated checks, task contracts and control records have dedicated guarded writers.
  if (/^(?:delivery-state\.json|tracker\.md|context-packet\.md|task-graph\.json|plan-fingerprint\.json|runs\/|evidence\/project-operations\/)/.test(path)
    || /(?:^|\/)(?:gate-ledger|phase-gate-check|build-approval|manual-qa-approval|validation-cycles)\.(?:json|md)$/.test(path)
    || /-check\.(?:json|md)$/.test(path)) fail('protected-evidence-path');
  const required=requiredPhaseArtefacts(current.deliveryRoot,current.phase);
  const attachment=path.startsWith(`evidence/authored/${current.phase}/`) && /\.(?:md|json|txt)$/.test(path);
  if (!required.includes(path) && !attachment) fail('evidence-scope-conflict');
  return {root:ctx.root,path:safePath(ctx.root,resolve(current.deliveryRoot,path))};
}
function fingerprint(target) { return existsSync(safePath(target.root,target.path)) ? hash(readBytes(target.root,target.path)) : null; }
function bodyFor(input,before) {
  if (input.delete===true) { if (input.content!==undefined || input.patch!==undefined || before===null) fail('invalid-input'); return null; }
  if ((input.content===undefined)===(input.patch===undefined)) fail('invalid-input');
  let content=input.content;
  if (input.patch!==undefined) {
    closed(input.patch,['oldText','newText']);
    const {oldText,newText}=input.patch;
    if (before===null || typeof oldText!=='string' || !oldText || typeof newText!=='string' || before.split(oldText).length!==2) fail('patch-conflict');
    content=before.replace(oldText,()=>newText);
  }
  if (typeof content!=='string' || content.includes('\0') || Buffer.byteLength(content)>MAX_FILE_BYTES) fail('invalid-content');
  return content;
}
export function applyProjectChange(root,input) {
  closed(input,['slug','phase','operationId','confirmed','kind','repository','path','expectedSha256','content','patch','delete','taskId','leaseId','leaseToken']);
  if (input.confirmed!==true || typeof input.phase!=='string' || !/^[a-z]+(?:-[a-z]+)*$/.test(input.phase)
    || input.delete!==undefined&&typeof input.delete!=='boolean'
    || input.expectedSha256!==null && !/^[a-f0-9]{64}$/.test(input.expectedSha256??'')) fail('invalid-input');
  const ctx=context(root),paths=operationPaths(ctx,input.slug,input.operationId);
  const {leaseToken,...safeInput}=input,requestDigest=requestHash({...safeInput,leaseTokenHash:leaseToken?hash(leaseToken):null});
  if (existsSync(safePath(ctx.root,paths.attempt))) {
    const attempt=readAttempt(ctx,paths,input.slug,input.operationId);if(attempt.requestDigest!==requestDigest)fail('replay-conflict');
    const done=readReceipt(ctx,paths);if(done)return {...done,replayed:true};fail('operation-recovery-required');
  }
  reserve(ctx,paths,input.slug,input.operationId);
  try {
    return withIntentMutation(ctx.root,input.slug,{action:'project-change',phase:input.phase},()=>{
      const current=phaseContext(ctx,input.slug,input.phase),target=changeTarget(ctx,current,input);
      const before=fingerprint(target);if(before!==input.expectedSha256)fail('file-conflict');
      const original=before===null?null:readBytes(target.root,target.path).toString('utf8'),content=bodyFor(input,original),after=content===null?null:hash(content);
      const attempt={schema:'ewai.project-operation/v1',operationId:input.operationId,slug:input.slug,phase:current.phase,kind:'change',requestDigest,configDigest:ctx.configDigest,createdAt:new Date().toISOString(),pid:process.pid,target:{kind:input.kind,repository:input.repository??null,path:input.path},beforeSha256:before,afterSha256:after};
      atomicRecord(ctx.root,paths.attempt,attempt,true);
      if(content===null){if(fingerprint(target)!==before)fail('file-conflict');unlinkSync(safePath(target.root,target.path));}
      else {
        mkdirSync(dirname(safePath(target.root,target.path)),{recursive:true});
        const temporary=safePath(target.root,`${target.path}.${randomUUID()}.tmp`),mode=before===null?0o644:lstatSync(target.path).mode&0o777;
        const fd=openSync(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,mode);
        try {writeFileSync(fd,content);fsyncSync(fd);}finally{closeSync(fd);}
        try {if(fingerprint(target)!==before)fail('file-conflict');safePath(target.root,target.path);renameSync(temporary,target.path);}finally{if(existsSync(temporary))unlinkSync(temporary);}
      }
      return receipt(ctx,paths,{...attempt,status:'completed',evidencePath:relative(ctx.root,paths.receipt).replaceAll('\\','/'),afterSha256:after});
    });
  } finally {release(ctx,paths,input.operationId);}
}
