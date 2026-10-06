const element=id=>document.getElementById(id),form=element('grokCredentialForm'),field=element('grokCredentialKey');
let saved=null,busy=false;
function controls(){
 field.disabled=busy||!saved||!saved.storageSupported;
 element('grokCredentialSave').disabled=field.disabled;
 element('grokCredentialCancel').disabled=busy;
 element('grokCredentialCheck').disabled=busy||!saved?.configured;
 element('grokCredentialRemove').disabled=busy||!saved?.saved;
 element('grokCredentialRefresh').disabled=busy;
}
function adopt(data){
 saved=data;
 element('grokCredentialStatus').textContent=data.source==='environment'?'Using XAI_API_KEY from the launching environment. '+(data.saved?'A saved key is also available.':'No saved key.'):
  data.source==='saved'?'Saved Grok key available for this account.':'No Grok key configured. Recommended: check and save a key below.';
 if(data.storageSupported===false)element('grokCredentialStatus').textContent+=' Local key storage is unavailable on this platform; use the launching environment.';
 controls();
}
async function request(action='',body){
 const response=await fetch('/api/coding-providers/grok/credentials'+(action?'/'+action:''),{method:action?'POST':'GET',headers:action?{'content-type':'application/json'}:undefined,body:action?JSON.stringify(body):undefined});
 let data;try{data=await response.json();}catch{throw Error('Credential setup could not be reached. Recheck the local dashboard connection.');}
 if(!response.ok)throw Error(data.error??'Credential setup failed. Refresh status and try again.');return data;
}
async function load(){
 busy=true;controls();
 try{adopt(await request());}catch{saved=null;element('grokCredentialNotice').textContent='Credential status could not be read safely. Repair private storage or use XAI_API_KEY in the launching environment, then refresh.';}
 finally{busy=false;controls();}
}
async function action(name){
 if(busy||!saved)return;
 const body={confirmed:true,...(name==='check'?{}:{expectedRevision:saved.revision}),...(name==='configure'?{apiKey:field.value}:{})};
 field.value='';busy=true;controls();element('grokCredentialNotice').textContent=name==='remove'?'Removing saved key…':'Checking xAI authentication without generated output…';
 try{const result=await request(name,body);adopt(result);element('grokCredentialNotice').textContent=result.message;}
 catch(error){element('grokCredentialNotice').textContent=error.message+' Refresh status before trying again.';}
 finally{body.apiKey=undefined;field.value='';busy=false;controls();}
}
form.addEventListener('submit',event=>{event.preventDefault();void action('configure');});
element('grokCredentialCancel').addEventListener('click',()=>{field.value='';element('grokCredentialNotice').textContent='Cancelled. Saved key retained.';});
element('grokCredentialCheck').addEventListener('click',()=>void action('check'));
element('grokCredentialRemove').addEventListener('click',()=>void action('remove'));
element('grokCredentialRefresh').addEventListener('click',()=>{field.value='';element('grokCredentialNotice').textContent='';void load();});
window.addEventListener('pagehide',()=>{field.value='';});
controls();void load();
