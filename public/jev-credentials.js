const element=id=>document.getElementById(id),form=element('jevCredentialForm'),field=element('jevCredentialKey');
let saved=null,busy=false;
function controls(){
 field.disabled=busy||!saved||!saved.storageSupported;
 element('jevCredentialSave').disabled=field.disabled;
 element('jevCredentialCancel').disabled=busy;
 element('jevCredentialCheck').disabled=busy||!saved?.configured;
 element('jevCredentialRemove').disabled=busy||!saved?.saved;
 element('jevCredentialRefresh').disabled=busy;
}
function adopt(data){
 saved=data;
 element('jevCredentialStatus').textContent=data.source==='environment'?'Using TYPESAFE_API_KEY from the launching environment. '+(data.saved?'A saved key is also available.':'No saved key.'):
  data.source==='saved'?'Saved Jev key available for this account.':'No Jev key configured. Recommended: check and save a key below.';
 if(data.storageIssue)element('jevCredentialStatus').textContent='Using TYPESAFE_API_KEY from the launching environment. Saved storage needs repair; saved key availability is unknown.';
 if(data.storageSupported===false)element('jevCredentialStatus').textContent+=' Local key storage is unavailable on this platform; use the launching environment.';
 controls();
}
async function request(action='',body){
 const response=await fetch('/api/jev/credentials'+(action?'/'+action:''),{method:action?'POST':'GET',headers:action?{'content-type':'application/json'}:undefined,body:action?JSON.stringify(body):undefined});
 let data;try{data=await response.json();}catch{throw Error('Credential setup could not be reached. Recheck the local dashboard connection.');}
 if(!response.ok)throw Error(data.error??'Credential setup failed. Refresh status and try again.');return data;
}
async function load(){
 busy=true;controls();
 try{adopt(await request());}catch{saved=null;element('jevCredentialNotice').textContent='Credential status could not be read safely. Repair private storage or use TYPESAFE_API_KEY in the launching environment, then refresh.';}
 finally{busy=false;controls();}
}
async function action(name){
 if(busy||!saved)return;
 const body={confirmed:true,...(name==='check'?{}:{expectedRevision:saved.revision}),...(name==='configure'?{apiKey:field.value}:{})};
 field.value='';busy=true;controls();element('jevCredentialNotice').textContent=name==='remove'?'Removing saved key…':'Checking TypeSafe authentication without generated output…';
 try{const result=await request(name,body);adopt(result);element('jevCredentialNotice').textContent=result.message;}
 catch(error){element('jevCredentialNotice').textContent=error.message+' Refresh status before trying again.';}
 finally{body.apiKey=undefined;field.value='';busy=false;controls();}
}
form.addEventListener('submit',event=>{event.preventDefault();void action('configure');});
element('jevCredentialCancel').addEventListener('click',()=>{field.value='';element('jevCredentialNotice').textContent='Cancelled. Saved key retained.';});
element('jevCredentialCheck').addEventListener('click',()=>void action('check'));
element('jevCredentialRemove').addEventListener('click',()=>void action('remove'));
element('jevCredentialRefresh').addEventListener('click',()=>{field.value='';element('jevCredentialNotice').textContent='';void load();});
window.addEventListener('pagehide',()=>{field.value='';});
controls();void load();
