import {nextRequiredPhase,canonicalDeliveryPhaseIds,mandatoryDeliveryPhaseIds,phaseSequence} from '../delivery.mjs';
import {phaseGateIds} from '../delivery-gates.mjs';
import {digest,fail} from './contract.mjs';
const successful=new Set(['completed','skipped','not-supported']);
const human=new Set(['approve-build','approve-manual-qa','ratify-plan','ratify-evidence']);
const phaseActions=new Set(['begin-harness','start-phase','complete-phase','prepare-phase','afk-build','resume-shelf',...human]);
const sequence=state=>phaseSequence({...state,phases:state?.phases??[],adjuncts:state?.adjuncts??[],humanGates:state?.humanGates??[]});
const tracks=state=>sequence(state).filter(phase=>phase.id!=='manual-qa');
export function assertOperationalTransition(actor,before,after,action){
  const old=before.delivery,next=after.delivery;
  if(digest(old)!==digest(next)){
    if(!phaseActions.has(action)&&action!=='record-validation')fail('delivery-action-conflict');
    if(!old){
      if(action!=='begin-harness'||!next||next.status!=='in-progress'||!['intent','ideate'].includes(next.currentPhase))fail('delivery-initial-state-invalid');
      if(mandatoryDeliveryPhaseIds().some(id=>!['pending',id==='intent'?'running':'pending'].includes(next.phases?.find(phase=>phase.id===id)?.status)))fail('delivery-required-phase-skipped');
      if(nextRequiredPhase(next)!==next.currentPhase)fail('delivery-phase-order-conflict');
      if(!Array.isArray(next.phases)||digest(next.phases.map(phase=>phase.id))!==digest(canonicalDeliveryPhaseIds())||next.phases.some(phase=>phase.status==='completed'))fail('delivery-initial-state-invalid');
    }else{
      if(!next||next.intent?.id!==old.intent?.id)fail('delivery-identity-conflict');
      if(digest((old.phases??[]).map(p=>p.id))!==digest((next.phases??[]).map(p=>p.id))||digest((old.adjuncts??[]).map(p=>p.id))!==digest((next.adjuncts??[]).map(p=>p.id)))fail('delivery-phase-order-conflict');
      if(action==='record-validation'&&(old.currentPhase!==next.currentPhase||old.status!==next.status))fail('validation-state-conflict');
      if(digest(old.approvals?.build??null)!==digest(next.approvals?.build??null)&&next.approvals?.build&&(action!=='approve-build'||nextRequiredPhase(old)!=='build'))fail('build-approval-predecessor-incomplete');
      const oldManual=old.humanGates?.find(gate=>gate.id==='manual-qa'),newManual=next.humanGates?.find(gate=>gate.id==='manual-qa');
      if(newManual?.status==='approved'&&oldManual?.status!=='approved'&&(action!=='approve-manual-qa'||old.currentPhase!=='manual-qa'))fail('manual-qa-predecessor-incomplete');
      const expected=nextRequiredPhase(next);
      const shelf=expected==='build'&&next.mode==='shelf'&&next.status==='shelf-ready'&&next.currentPhase==='shelf-ready';
      const dry=expected==='build'&&next.mode==='dry-run'&&next.status==='validated-not-for-build'&&next.currentPhase==='complete-dry-run';
      if(next.currentPhase!==expected&&!shelf&&!dry)fail('delivery-phase-order-conflict');
      if(next.status==='completed'&&(expected!=='complete'||!next.humanGates?.some(gate=>gate.id==='manual-qa'&&gate.status==='approved')))fail('delivery-completion-not-approved',403);
      const previous=new Map(tracks(old).map(phase=>[phase.id,phase])),updated=tracks(next);
      if(previous.size!==updated.length||updated.some(phase=>!previous.has(phase.id)))fail('delivery-phase-set-conflict');
      for(const phase of updated){
        const prior=previous.get(phase.id);
        if(prior.status===phase.status)continue;
        if(action==='record-validation')fail('validation-phase-status-conflict');
        if(successful.has(prior.status)&&!human.has(action))fail('completed-phase-immutable');
        if(phase.status==='running'){
          if(!['start-phase','prepare-phase','afk-build','resume-shelf'].includes(action))fail('phase-start-action-required');
          const ordered=sequence(next),index=ordered.findIndex(item=>item.id===phase.id);
          if(ordered.slice(0,index).some(item=>!successful.has(item.status)&&item.status!=='approved'))fail('phase-predecessor-incomplete');
          if(phase.id==='build'&&!old.approvals?.build)fail('build-approval-required',403);
          if(phase.id==='retro'&&!old.humanGates?.some(item=>item.id==='manual-qa'&&item.status==='approved'))fail('manual-qa-approval-required',403);
        }else if(phase.status==='completed'){
          if(!['complete-phase','prepare-phase','afk-build'].includes(action)||prior.status!=='running')fail('phase-completion-action-required');
          const gate=after.projections.find(p=>p.path===`6.Build/${after.slug}/gates/${phase.id}/gate-ledger.json`)?.content;
          if(!gate||gate.status!=='pass'||gate.slug!==after.slug||gate.phase!==phase.id||!Array.isArray(gate.required_gates)||!gate.required_gates.length)fail('phase-gate-evidence-required');
          if((phaseGateIds[phase.id]??[]).some(id=>!gate.required_gates.some(item=>item.id===id)))fail('phase-gate-evidence-required');
          if(['source_sections_edited','stale_text_removed','no_append_only_corrections','all_code_claims_cited'].some(key=>gate.honesty_check?.[key]!==true))fail('phase-honesty-required');
          for(const item of gate.required_gates){
            if(item.status!=='pass'||item.exit_status!==0||!item.evidence_hash||!after.evidence.some(e=>e.sha256===item.evidence_hash&&e.path===`6.Build/${after.slug}/${item.output_path}`))fail('phase-evidence-registration-required');
          }
        }else if(!(action==='resume-shelf'&&phase.id==='fit-check'&&phase.status==='pending'))fail('phase-transition-invalid');
      }
    }
  }
  const previousWork=before.work,nextWork=after.work;
  if(digest(previousWork??null)!==digest(nextWork??null)&&previousWork?.session&&!previousWork.session.ended_at&&previousWork.actorId!==actor.actorId&&actor.role!=='owner')fail('session-owner-conflict',403);
  if(nextWork&&digest(previousWork??null)!==digest(nextWork))nextWork.actorId=actor.actorId;
}
