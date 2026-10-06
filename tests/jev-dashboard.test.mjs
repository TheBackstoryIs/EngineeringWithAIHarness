import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {initProject} from '../src/project.mjs';
import {ensureDashboard,stopDashboard} from '../src/runtime/dashboard.mjs';
import {createIntent,updateIntentDeliveryState} from '../src/intents.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {readJevSettings} from '../src/jev.mjs';
import {chromium} from 'playwright';
async function fixture(t){const root=mkdtempSync(resolve(tmpdir(),'ewai-jev-ui-')),home=resolve(root,'home'),project=resolve(root,'project');mkdirSync(home,{mode:0o700});mkdirSync(project);initProject(project,{name:'Synthetic Jev UI'});t.after(async()=>{await stopDashboard(project);rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});});const started=await ensureDashboard(project,{home,premiumCheck:Promise.resolve({access:'unavailable',installed:false,verified:false,accessReason:'licence-not-configured'})});return{root,home,project,url:started.url};}
test('CLI and dashboard use the same revisioned policy and guard origin/method/media type/closed input',{timeout:60000},async t=>{
 const f=await fixture(t),endpoint=f.url+'/api/jev/settings';const original=await(await fetch(endpoint)).json();assert.equal(original.policy.mode,'off');
 const input={confirmed:true,expectedRevision:original.revision,policy:{...original.policy,mode:'shadow',cloudConsent:true}};
 for(const origin of [undefined,'https://outside.invalid'])assert.equal((await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(input)})).status,403);
 assert.equal((await fetch(endpoint+'?apiKey=never-accepted')).status,400);assert.equal((await fetch(endpoint,{method:'PUT'})).status,405);
 assert.equal((await fetch(endpoint,{method:'POST',headers:{origin:f.url,'content-type':'text/plain'},body:JSON.stringify(input)})).status,415);
 const headers={origin:f.url,'content-type':'application/json'};assert.equal((await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({...input,endpoint:'https://outside.invalid'})})).status,400);
 for(const body of ['\"invalid\"','true','1','[]','null']){assert.equal((await fetch(endpoint,{method:'POST',headers,body})).status,400);assert.equal((await fetch(f.url+'/api/health')).status,200);}
 const saved=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(input)});assert.equal(saved.status,200);assert.equal(readJevSettings(f.project).policy.mode,'shadow');
 const cli=resolve(import.meta.dirname,'../bin/ewai'),status=JSON.parse(execFileSync(process.execPath,[cli,'jev','status','--project',f.project,'--json'],{encoding:'utf8',env:{...process.env,HOME:f.home,TYPESAFE_API_KEY:''}}));assert.equal(status.settings.policy.mode,'shadow');
 const off=spawnSync(process.execPath,[cli,'jev','configure','--mode','off','--yes','--project',f.project,'--json'],{encoding:'utf8',env:{...process.env,HOME:f.home,TYPESAFE_API_KEY:''}});assert.equal(off.status,0,off.stderr);assert.equal((await(await fetch(endpoint)).json()).policy.mode,'off');
 assert.equal((await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(input)})).status,409);
});
test('real dashboard saves shadow/off, rejects consent omission, clears passwords and remains usable at mobile size',{timeout:60000},async t=>{
 const f=await fixture(t),browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:390,height:844}});const key='apikey_synthetic-dashboard-key';
 await page.route('**/api/jev/credentials/configure',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'The key was not accepted.',code:'jev-key-rejected'})}));
 await page.goto(f.url);await page.locator('#sidebarOpen').click();await page.locator('#configurationNav:enabled').click();await page.locator('#jevCredentialKey:enabled').fill(key);await page.locator('#jevCredentialSave').click();await page.locator('#jevCredentialNotice').getByText(/not accepted/).waitFor();assert.equal(await page.locator('#jevCredentialKey').inputValue(),'');
 await page.locator('input[name=jevMode][value=shadow]').check();await page.locator('#jevSettingsSave').click();await page.locator('#jevNotice').getByText(/consent|disclosure/i).waitFor();assert.equal(readJevSettings(f.project).policy.mode,'off');
 await page.locator('#jevCloudConsent').check();await page.locator('#jevSettingsSave').click();await page.locator('#jevNotice').getByText('Jev settings saved. Mode: shadow.',{exact:true}).waitFor();assert.equal(readJevSettings(f.project).policy.mode,'shadow');
 await page.locator('input[name=jevMode][value=off]').check();await page.locator('#jevSettingsSave').click();await page.locator('#jevNotice').getByText('Jev settings saved. Mode: off.',{exact:true}).waitFor();assert.equal(readJevSettings(f.project).policy.mode,'off');
 assert.ok((await page.locator('#jevMeasurements').textContent()).includes('Unknown'));assert.equal(await page.evaluate(k=>JSON.stringify(localStorage).includes(k)||JSON.stringify(sessionStorage).includes(k),key),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});

test('foreign-origin companion GET cannot disclose titles or spend a call while matching-origin ranking remains available',{timeout:60000},async t=>{
 const root=mkdtempSync(resolve(tmpdir(),'ewai-jev-origin-')),home=resolve(root,'home'),project=resolve(root,'project'),calls=resolve(root,'calls.txt'),preload=resolve(root,'preload.mjs');mkdirSync(home,{mode:0o700});mkdirSync(project);initProject(project,{name:'Synthetic origin guard'});createIntent(project,{slug:'synthetic',domain:'platform',title:'Synthetic eligible work'});updateIntentDeliveryState(project,resolve(project,'SPECS/2.Purpose/intents/platform/synthetic.md'),{status:'ready'});
 t.after(async()=>{await stopDashboard(project);rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});});
 writeFileSync(preload,`import {appendFileSync} from 'node:fs';const original=globalThis.fetch;globalThis.fetch=async(url,init)=>{if(String(url)==='https://api.typesafe.ai/v1/systemone'){appendFileSync(${JSON.stringify(calls)},'call\\n');const {questions}=JSON.parse(init.body),answers={};for(const [id,q]of Object.entries(questions)){const ids=Object.keys(q.criteria),choice=ids[0];answers[id]={type:'choice',choice,probabilities:Object.fromEntries(ids.map(id=>[id,id===choice?1:0])),confidence:1};}return new Response(JSON.stringify({model:'jev-1.13.0',answers,usage:{input_tokens:100,output_tokens:10}}));}return original(url,init);};`);
 const oldOptions=process.env.NODE_OPTIONS,oldKey=process.env.TYPESAFE_API_KEY;let url;
 try{process.env.NODE_OPTIONS=(oldOptions??'')+' --import='+preload;process.env.TYPESAFE_API_KEY='apikey_synthetic-origin-fixture-key';url=(await ensureDashboard(project,{home,premiumCheck:Promise.resolve({access:'unavailable',installed:false,verified:false,accessReason:'licence-not-configured'})})).url;}
 finally{if(oldOptions===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=oldOptions;if(oldKey===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=oldKey;}
 const original=await(await fetch(url+'/api/jev/settings')).json();await fetch(url+'/api/jev/settings',{method:'POST',headers:{origin:url,'content-type':'application/json'},body:JSON.stringify({confirmed:true,expectedRevision:original.revision,policy:{...original.policy,mode:'shadow',cloudConsent:true,useCases:['skill']}})});
 for(const headers of [{origin:'https://outside.invalid'},{'sec-fetch-site':'cross-site'},{}]){const result=await(await fetch(url+'/api/companion?focus=synthetic',{headers})).json();assert.equal(result.recommendations.length,1);assert.equal(result.jevAdvice,undefined);}
 assert.equal((await(await fetch(url+'/api/jev/measurements')).json()).budget.callsUsed,0);
 const trusted=await(await fetch(url+'/api/companion?focus=synthetic',{headers:{origin:url}})).json();assert.ok(trusted.jevAdvice);assert.equal((await(await fetch(url+'/api/jev/measurements')).json()).budget.callsUsed,1);assert.equal(readFileSync(calls,'utf8').trim(),'call');
});
test('MCP exposes bounded options and persona recommendations with closed input and safe off behaviour',{timeout:60000},async t=>{
 const f=await fixture(t),client=new Client({name:'jev-fixture',version:'1'}),transport=new StdioClientTransport({command:process.execPath,args:[resolve(import.meta.dirname,'../bin/ewai'),'mcp','--project',f.project],env:{...process.env,HOME:f.home,TYPESAFE_API_KEY:''},stderr:'ignore'});t.after(()=>client.close());await client.connect(transport);
 const tools=(await client.listTools()).tools;assert.ok(tools.some(t=>t.name==='ewai_jev_personas'));assert.equal(tools.find(t=>t.name==='ewai_companion_status').annotations.readOnlyHint,false);assert.equal(tools.find(t=>t.title==='Prepare governed model context').annotations.openWorldHint,true);
 const input={useCase:'skill',source:'synthetic',origin:'llm',recommendedId:'one',task:'Synthetic bounded recommendation',candidates:[{id:'one',label:'First option'}]};
 const response=await client.callTool({name:'ewai_jev_decide',arguments:input});const result=JSON.parse(response.content[0].text);assert.equal(result.status,'disabled');assert.equal(result.validation.status,'inconclusive');
 const rejected=await client.callTool({name:'ewai_jev_decide',arguments:{...input,projectRoot:'/outside'}});assert.equal(rejected.isError,true);
 const personas=JSON.parse((await client.callTool({name:'ewai_jev_personas',arguments:{focus:'Synthetic security review'}})).content[0].text);assert.ok(personas.availableCount>0);assert.equal(personas.consideredCount,0);assert.equal(personas.complete,false);
});
