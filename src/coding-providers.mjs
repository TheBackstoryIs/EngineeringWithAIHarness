import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readProjectDocument,editProjectDocument} from './config-document.mjs';

export const CODING_PROVIDERS=Object.freeze(['claude','codex','grok','antigravity']);
export const CODING_PROVIDER_LABELS=Object.freeze({claude:'Claude Code',codex:'Codex',grok:'Grok Build',antigravity:'Antigravity'});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function fail(message,statusCode=400,code){const error=new Error(message);error.statusCode=statusCode;error.codingProviderError=true;if(code)error.code=code;throw error;}
function closed(value,keys,label){if(!object(value)||Object.keys(value).some(k=>!keys.includes(k)))fail(label+' contains unsupported fields.');}
function provider(value){if(!CODING_PROVIDERS.includes(value))fail('Choose Claude Code, Codex, Grok Build or Antigravity.');return value;}
function modelId(value){if(typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,127}$/.test(value))fail('Use an exact, bounded model ID without spaces or wildcards.');return value;}
export function normaliseCodingProviders(value){
  if(value===undefined)return null;
  closed(value,['pool','primary','secondary','tertiary','models'],'Provider policy');
  const pool=value.pool??[...CODING_PROVIDERS];
  if(!Array.isArray(pool)||!pool.length||pool.length>4||new Set(pool).size!==pool.length)fail('Choose a nonempty pool of distinct providers.');pool.forEach(provider);
  const roles={};
  for(const role of ['primary','secondary','tertiary']){
    const choice=value[role]??'existing',allowed=['existing','auto',...CODING_PROVIDERS,...(role==='primary'?[]:['off'])];
    if(!allowed.includes(choice))fail('Choose a supported '+role+' provider.');
    if(CODING_PROVIDERS.includes(choice)&&!pool.includes(choice))fail('Include the selected '+role+' provider in the eligible pool.');roles[role]=choice;
  }
  const raw=value.models??{};closed(raw,CODING_PROVIDERS,'Model policy');const models={};
  for(const p of CODING_PROVIDERS){if(raw[p]===undefined)continue;closed(raw[p],['suggestion','permitted_models'],'Model policy');const m={};
    if(raw[p].suggestion!==undefined)m.suggestion=modelId(raw[p].suggestion);
    if(raw[p].permitted_models!==undefined){const ids=raw[p].permitted_models;if(!Array.isArray(ids)||!ids.length||ids.length>64||new Set(ids).size!==ids.length)fail('Provide a nonempty list of distinct permitted model IDs.');m.permitted_models=ids.map(modelId);}
    if(m.suggestion&&m.permitted_models&&!m.permitted_models.includes(m.suggestion))fail('The suggestion must be in the permitted model list.');
    if(Object.keys(m).length)models[p]=m;
  }
  return {pool:[...pool],...roles,models};
}
export function codingPolicyDigest(value){return 'sha256:'+createHash('sha256').update(JSON.stringify(value===null?null:normaliseCodingProviders(value))).digest('hex');}
export function readCodingPolicy(root){const value=readProjectDocument(root).config.coding_providers;const policy=value===undefined?null:normaliseCodingProviders(value);return {policy,policyDigest:codingPolicyDigest(policy)};}
export function assertCodingPolicyFresh(expected,actual){if(!/^sha256:[a-f0-9]{64}$/.test(String(expected))||expected!==actual)fail('Provider policy changed. Recheck the saved settings and approved scope before continuing.',409);}
export function assertModelPolicy(selected,raw){
  provider(selected);const policy=raw==null?null:normaliseCodingProviders(raw),model=policy?.models[selected];
  if(model?.permitted_models)fail(CODING_PROVIDER_LABELS[selected]+' cannot enforce this permitted-model list through a verified EWAI adapter. Execution stopped. Recommended: clear the restriction to use native model selection, or use an adapter with verified enforcement.',409,'coding-provider-model-restriction-unsupported');
  return {mode:'native',...(model?.suggestion?{suggestion:model.suggestion}: {})};
}
export function modelGuidance(selected,policy){const m=assertModelPolicy(selected,policy);return m.suggestion?'\nAdvisory model suggestion: '+m.suggestion+'. Let the CLI choose the appropriate model.':'';}
export function resolveCodingProviders(raw,options={}){
  const policy=raw===null?null:normaliseCodingProviders(raw),orchestrator=options.orchestrator;
  if(!policy)return {legacy:true,primary:null,reviewers:options.reviewers??[],policyDigest:codingPolicyDigest(null)};
  const available=options.available??[],permitted=options.allowedProviders??CODING_PROVIDERS;
  const eligible=policy.pool.filter(p=>available.includes(p)&&permitted.includes(p));
  const automaticEligible=eligible.filter(p=>{try{assertModelPolicy(p,policy);return true;}catch{return false;}});
  if(policy.primary==='auto'&&!automaticEligible.length&&eligible.length)assertModelPolicy(eligible[0],policy);
  const primary=policy.primary==='existing'?(CODING_PROVIDERS.includes(orchestrator)?orchestrator:null):policy.primary==='auto'?automaticEligible[0]:policy.primary;
  if(policy.primary!=='existing'&&(!primary||!eligible.includes(primary)))fail('No eligible primary provider. Recommended: enable an available provider inside the approved pool.',409);
  const actual=orchestrator??primary;
  const inherited=(options.reviewers??[]).filter(p=>p!==actual);
  const reviewPool=eligible.filter(p=>p!==actual&&(options.reviewers===undefined||inherited.includes(p)));
  const selected=[];
  for(const role of ['secondary','tertiary']){
    const choice=policy[role];if(choice==='off'||choice==='existing')continue;
    if(!CODING_PROVIDERS.includes(actual))fail('Independent review requires the actual coding agent identity. Recommended: begin delivery with a supported orchestrator.',409);
    const candidate=choice==='auto'?reviewPool.find(p=>automaticEligible.includes(p)&&!selected.includes(p)):choice;
    if(choice==='auto'&&!candidate){const unsupported=reviewPool.find(p=>!selected.includes(p));if(unsupported)assertModelPolicy(unsupported,policy);}
    if(candidate===actual)fail('The reviewer must be independent of the actual coding agent. Choose another provider.',409);
    if(selected.includes(candidate))fail('Secondary and tertiary reviewers must use distinct providers. Choose another provider.',409);
    if(!candidate||!reviewPool.includes(candidate))fail('No eligible '+role+' reviewer. Recommended: enable another independent provider in the checkpoint and approved pool.',409);
    selected.push(candidate);
  }
  if(policy.secondary==='existing'||policy.tertiary==='existing')for(const p of reviewPool)if(!selected.includes(p))selected.push(p);
  if(selected.length<Number(options.requiredReviewers??0))fail('Required independent review capacity is unavailable. Keep the required checkpoint and enable enough distinct reviewers.',409);
  if(policy.primary!=='existing')assertModelPolicy(primary,policy);
  for(const p of selected)assertModelPolicy(p,policy);
  return {legacy:false,primary,reviewers:selected,policyDigest:codingPolicyDigest(policy)};
}
export function codingProviderCapabilities(options={}){
  const probe=options.probe??(p=>{const r=spawnSync(p==='antigravity'?'agy':p,['--version'],{stdio:'pipe',encoding:'utf8',timeout:3000,env:options.env??process.env});return {available:!r.error&&r.status===0};});
  return CODING_PROVIDERS.map(p=>{const value=probe(p),available=typeof value==='boolean'?value:value?.available===true;
    return {provider:p,label:CODING_PROVIDER_LABELS[p],available,interactive:available,modelSelection:'native',modelRestrictions:'unsupported',unattended:p==='grok'?'requires-conformance':'existing-adapter',recommendation:available?'Use native model selection. Verify required execution capability before running.':'Install or enable this CLI, then recheck availability.'};});
}
function projection(state,options={}){const policy=state.config.coding_providers===undefined?null:normaliseCodingProviders(state.config.coding_providers),capabilities=codingProviderCapabilities(options);return {schema:'ewai.coding-providers/v1',digest:state.digest,policy,policyDigest:codingPolicyDigest(policy),capabilities,defaults:{modelSelection:'native',providerSelection:'existing',reviews:'existing checkpoint policy'},authority:'settings-only'};}
export function readCodingProviders(root,options={}){return projection(readProjectDocument(root),options);}
export function saveCodingProviders(root,input,options={}){
  closed(input,['confirmed','expectedDigest','policy'],'Provider settings request');if(input.confirmed!==true)fail('Confirm provider setting changes before saving.');if(!Object.hasOwn(input,'policy'))fail('Provide a complete policy, or null to restore existing behaviour.');
  const policy=input.policy===null?null:normaliseCodingProviders(input.policy);
  const state=editProjectDocument(root,input.expectedDigest,document=>{if(policy===null)document.delete('coding_providers');else document.set('coding_providers',policy);});return projection(state,options);
}
