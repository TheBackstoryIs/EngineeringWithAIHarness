import {z} from 'zod';
import {projectCapabilities,projectPreflight,readProjectFile,applyProjectChange,startProjectCheck,projectCheckStatus,cancelProjectCheck,recoverProjectOperation} from './project-operations.mjs';

const tools={
  capabilities:{fields:[],read:true,run:projectCapabilities,description:'Discover opt-in project file and named-check capabilities. Reads configuration without granting delivery or publication authority.'},
  preflight:{fields:['slug','phase','requireCodeWrites'],read:true,run:projectPreflight,description:'Before remote delivery, check the current phase against configured file access and named local checks. Missing access is an explicit blocker. For implementation, set requireCodeWrites:true; checks-only readiness remains separate from edit permission.'},
  read_file:{fields:['repository','path'],read:true,run:readProjectFile,description:'Read a bounded UTF-8 file from a configured repository. Returns sha256 for conflict-checked edits. Paths are repository-relative; credentials and control configuration are excluded.'},
  apply_change:{fields:['slug','phase','operationId','confirmed','kind','repository','path','expectedSha256','content','patch','delete','taskId','leaseId','leaseToken'],run:applyProjectChange,description:'Author current-phase evidence or edit approved task code. Supply a stable UUID operationId, confirmed:true and expectedSha256 (null only for creation). Choose content, exact-once patch {oldText,newText}, or delete:true. kind:evidence uses delivery-relative paths; kind:code also requires repository, taskId and the current leaseId/leaseToken. Never writes trackers, approval records or gate results. Retry identical input with the same operationId after a disconnect.'},
  check_start:{fields:['slug','phase','operationId','check','confirmed','taskId','leaseId','leaseToken'],run:startProjectCheck,description:'Run a project-configured named check locally. Supply confirmed:true, current phase, check name and a stable UUID operationId. No executable, arguments, environment or working directory can be supplied remotely. Build checks additionally require current task lease fields. Poll check_status; retry identical input with the same ID to avoid duplicate execution.'},
  check_status:{fields:['slug','operationId'],read:true,run:projectCheckStatus,description:'Read queued/running/terminal status, bounded redacted output, captured revision and evidence path. passed is true only for successful, intact and current results. This does not advance a phase.'},
  check_cancel:{fields:['slug','operationId','confirmed'],run:cancelProjectCheck,description:'With confirmed:true, request cancellation of one local check. Poll until termination is recorded; a cancellation request is not proof the process stopped.'},
  recover:{fields:['slug','operationId','confirmed'],run:recoverProjectOperation,description:'With confirmed:true, reconcile an interrupted operation only after its recorded process is proven stopped. Never reruns a check or grants approval. Uncertain execution stays recovery-required.'},
};
export function registerProjectOperationTools(server,root,result) {
  for(const [name,tool] of Object.entries(tools))server.registerTool('ewai_project_'+name,{
    title:'Project '+name.replaceAll('_',' '),description:tool.description,
    inputSchema:z.object(Object.fromEntries(tool.fields.map(field=>[field,z.unknown().optional()]))).passthrough(),
    annotations:{readOnlyHint:tool.read===true,destructiveHint:name==='apply_change',openWorldHint:false},
  },async input=>{try{return result(await tool.run(root,input));}catch(error){const known={ENOENT:'file-not-found',EACCES:'access-denied',EPERM:'access-denied',EEXIST:'file-conflict'};return {...result({error:known[error.code]??(/^[a-z][a-z0-9-]{0,100}$/.test(error.code??'')?error.code:'project-operation-blocked'),recovery:'Refresh capability, phase and operation status; preserve the existing operation ID when retrying.'}),isError:true};}});
}
