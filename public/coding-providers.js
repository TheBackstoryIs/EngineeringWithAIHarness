const names={claude:'Claude Code',codex:'Codex',grok:'Grok Build',antigravity:'Antigravity'};
const providers=Object.keys(names),roles=['primary','secondary','tertiary'];
const element=id=>document.getElementById(id),form=element('codingProvidersForm');
let saved=null,draft=null,digest=null,ready=false,busy=false,conflict=false,saveError=false,latest=null,modelProvider='claude';
const defaults=()=>({pool:[...providers],primary:'existing',secondary:'existing',tertiary:'existing',models:{}});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),copy=value=>structuredClone(value);
function option(value,label){const node=document.createElement('option');node.value=value;node.textContent=label;return node;}
for(const role of roles){
  const label=document.createElement('label');label.textContent=role==='primary'?'Primary coding provider':role==='secondary'?'Secondary reviewer':'Tertiary reviewer';
  const select=document.createElement('select');select.name=role;
  select.append(option('existing',role==='primary'?'Existing behaviour (default)':'Existing checkpoint policy'),option('auto',role==='primary'?'Automatic — eligible provider':'Automatic — independent provider'));
  if(role!=='primary')select.append(option('off','Off — if checkpoint allows'));
  for(const p of providers)select.append(option(p,names[p]));
  label.append(select);const hint=document.createElement('small');hint.textContent=role==='primary'?'Automatic follows the eligible pool order.':'Must differ from the actual coding agent and the other reviewer.';label.append(hint);element('codingProviderRoles').append(label);
}
for(const p of providers){const box=document.createElement('button');box.type='button';box.name='pool';box.value=p;box.setAttribute('role','checkbox');box.setAttribute('aria-checked','false');box.textContent=names[p];element('codingProviderPool').append(box);element('codingModelProvider').append(option(p,names[p]));}
function readModel(){
  if(!draft)return;const suggestion=element('codingModelSuggestion').value.trim(),permitted=element('codingModelPermitted').value.split('\n').map(x=>x.trim()).filter(Boolean),model={};
  if(suggestion)model.suggestion=suggestion;if(permitted.length)model.permitted_models=permitted;
  if(Object.keys(model).length)draft.models[modelProvider]=model;else delete draft.models[modelProvider];
}
function displayModel(){const model=(draft??defaults()).models[modelProvider]??{};element('codingModelSuggestion').value=model.suggestion??'';element('codingModelPermitted').value=(model.permitted_models??[]).join('\n');}
function collect(){if(!draft)draft=defaults();for(const role of roles)draft[role]=form.elements.namedItem(role).value;draft.pool=[...form.querySelectorAll('[name=pool][aria-checked=true]')].map(x=>x.value);readModel();}
function describe(policy){if(!policy)return 'Existing host selection and checkpoint review policy; native CLI model choice.';const models=Object.entries(policy.models).map(([p,m])=>names[p]+': '+[m.suggestion?'suggestion '+m.suggestion:'',m.permitted_models?'permitted '+m.permitted_models.join(', '):''].filter(Boolean).join('; '));return roles.map(r=>r+': '+(names[policy[r]]??policy[r])).join(' · ')+'. Pool: '+policy.pool.map(p=>names[p]).join(', ')+'. '+(models.length?'Model policies: '+models.join(' · '):'Native CLI models.');}
function errors(){
  if(!draft)return [];const issues=[];if(!draft.pool.length)issues.push('Choose at least one eligible provider.');
  // The saved primary is a preference. Only dispatch knows the actual agent.
  if(providers.includes(draft.secondary)&&draft.secondary===draft.tertiary)issues.push('Use distinct secondary and tertiary reviewers.');
  for(const r of roles)if(providers.includes(draft[r])&&!draft.pool.includes(draft[r]))issues.push('Include the selected '+r+' provider in the pool.');
  for(const model of Object.values(draft.models)){
    const ids=[...(model.permitted_models??[]),...(model.suggestion?[model.suggestion]:[])];if(ids.some(id=>!/^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,127}$/.test(id)))issues.push('Use exact model IDs without spaces or wildcards.');
    if(model.permitted_models&&(new Set(model.permitted_models).size!==model.permitted_models.length||model.permitted_models.length>64))issues.push('Use at most 64 distinct permitted model IDs.');
    if(model.suggestion&&model.permitted_models&&!model.permitted_models.includes(model.suggestion))issues.push('Include the suggested model in the permitted list.');
  }return issues;
}
function refresh(){
  const issues=errors(),dirty=!same(draft,saved);
  element('codingProviderPreview').textContent='Selection preview: '+describe(draft)+' '+(issues.length?issues.join(' '):'Actual choices resolve at dispatch against availability, required reviews and approved scope.');
  const model=draft?.models[modelProvider];element('codingModelStatus').textContent=model?.permitted_models?'Enforcement unsupported: execution will stop for this provider. Recommended: clear the list for native selection, or use a verified restriction adapter.':model?.suggestion?'Advisory suggestion only. The CLI chooses the model.':'Native CLI model selection; no EWAI override.';
  for(const control of form.querySelectorAll('input,select,textarea'))control.disabled=!ready||busy;
  for(const control of form.querySelectorAll('[name=pool]'))control.disabled=!ready||busy;
  element('codingProviderSave').disabled=!ready||busy||!dirty||issues.length>0||conflict;
  for(const id of ['codingProviderCancel','codingProviderDefaults','codingProviderAuto'])element(id).disabled=!ready||busy;
  if(ready&&dirty&&!busy&&!conflict&&!saveError)element('codingProviderStatus').textContent='Unsaved changes. Saving settings will not start work.';
}
function display(){const policy=draft??defaults();for(const r of roles)form.elements.namedItem(r).value=policy[r];for(const box of form.querySelectorAll('[name=pool]'))box.setAttribute('aria-checked',String(policy.pool.includes(box.value)));displayModel();refresh();}
async function request(method='GET',body){
  const response=await fetch('/api/coding-providers',{method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});let data;
  try{data=await response.json();}catch{throw new Error('Provider settings could not be read. Recheck the local dashboard connection.');}
  if(!response.ok){const error=new Error(data.error??'Provider settings could not be saved.');error.status=response.status;throw error;}return data;
}
function adopt(data){
  saved=copy(data.policy);draft=copy(saved);digest=data.digest;ready=true;conflict=false;saveError=false;latest=null;element('codingProviderConflict').hidden=true;element('codingProviderRebase').hidden=true;
  element('codingProviderAvailability').textContent=data.capabilities.map(c=>c.label+': '+(c.available?'installed':'unavailable')).join(' · ')+'. Installation does not prove authentication or unattended capability.';display();
}
async function load(){try{adopt(await request());element('codingProviderStatus').textContent='Saved settings: '+describe(saved);}catch(error){element('codingProviderStatus').textContent=error.message;refresh();}}
form.addEventListener('input',event=>{if(ready&&!busy&&event.target!==element('codingModelProvider')){saveError=false;collect();refresh();}});
element('codingProviderPool').addEventListener('click',event=>{const box=event.target.closest('[name=pool]');if(!box||!ready||busy)return;box.setAttribute('aria-checked',String(box.getAttribute('aria-checked')!=='true'));collect();refresh();});
form.addEventListener('change',event=>{if(!ready||busy)return;if(event.target===element('codingModelProvider')){readModel();modelProvider=event.target.value;displayModel();}else collect();refresh();});
form.addEventListener('submit',async event=>{
  event.preventDefault();if(element('codingProviderSave').disabled)return;busy=true;refresh();
  try{adopt(await request('POST',{confirmed:true,expectedDigest:digest,policy:draft}));element('codingProviderStatus').textContent='Provider settings saved. No delivery started.';}
  catch(error){saveError=true;if(error.status===409){conflict=true;element('codingProviderConflict').hidden=false;}element('codingProviderStatus').textContent=error.message+(conflict?' Your draft is retained. Recommended: compare the latest settings before saving again.':' Your draft is retained.');}
  finally{busy=false;refresh();}
});
element('codingProviderCancel').addEventListener('click',()=>{draft=copy(saved);display();element('codingProviderStatus').textContent='Draft cancelled. Saved settings retained.';});
element('codingProviderDefaults').addEventListener('click',()=>{draft=null;display();element('codingProviderStatus').textContent='Existing behaviour restored in the draft. Save to apply.';});
element('codingProviderAuto').addEventListener('click',()=>{collect();for(const r of roles)draft[r]='auto';display();});
element('codingProviderCompare').addEventListener('click',async()=>{try{latest=await request();element('codingProviderLatest').textContent='Latest saved settings: '+describe(latest.policy);element('codingProviderRebase').hidden=false;}catch(error){element('codingProviderStatus').textContent=error.message;}});
element('codingProviderRebase').addEventListener('click',()=>{if(!latest)return;digest=latest.digest;saved=copy(latest.policy);conflict=false;element('codingProviderConflict').hidden=true;refresh();element('codingProviderStatus').textContent='Latest settings reviewed. Your draft is retained; save to replace the provider policy.';});
refresh();
load();
