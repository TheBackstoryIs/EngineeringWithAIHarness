import {z} from 'zod/v4';
import {coordinationCommand} from './cli.mjs';
import {readConnection,centralRequest} from './client.mjs';
export function registerCoordinationTools(server,root,result){
  server.registerTool('ewai_coordination_status',{
    title:'Shared project coordination status',description:'Inspect the machine-local shared connection, server identity and pending operations. Token values are never returned.',
    inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:true}
  },async()=>{try{return result(readConnection(root)?await coordinationCommand(root,['status']):{mode:'standalone'});}catch(error){return {...result({error:error.code??'coordination-unavailable'}),isError:true};}});
  server.registerTool('ewai_coordination_publish',{
    title:'Publish an authored intent revision',description:'Register the local Git-synchronised source fingerprint against an exact central revision. Does not execute or upload code.',
    inputSchema:{intent:z.string().min(1),expectedRevision:z.number().int().positive()},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}
  },async({intent,expectedRevision})=>{try{return result(await coordinationCommand(root,['publish',intent,'--expected-revision',String(expectedRevision)]));}catch(error){return {...result({error:error.code??'coordination-publish-failed'}),isError:true};}});
  server.registerTool('ewai_coordination_recover',{
    title:'Recover an interrupted shared operation',description:'Resolve the recorded central request without repeating a local workflow action; recover deferred lifecycle events.',
    inputSchema:{operationId:z.string().uuid(),confirmed:z.boolean().optional(),executionStopped:z.boolean().optional()},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}
  },async({operationId,confirmed=false,executionStopped=false})=>{try{return result(await coordinationCommand(root,['recover',operationId,...(confirmed?['--yes']:[]),...(executionStopped?['--execution-stopped']:[])]));}catch(error){return {...result({error:error.code??'coordination-recovery-required'}),isError:true};}});
}
