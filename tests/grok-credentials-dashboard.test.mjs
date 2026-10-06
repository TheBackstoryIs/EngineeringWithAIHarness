import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {initProject} from '../src/project.mjs';
import {ensureDashboard,stopDashboard} from '../src/runtime/dashboard.mjs';
import {configureGrokCredentials,grokCredentialStatus} from '../src/grok-credentials.mjs';
import {chromium} from 'playwright';
const key='xai-synthetic-dashboard-not-a-real-key';
async function fixture(t){const root=mkdtempSync(resolve(tmpdir(),'ewai-grok-dashboard-')),home=resolve(root,'home'),project=resolve(root,'project');mkdirSync(home,{mode:0o700});mkdirSync(project);initProject(project,{name:'Grok credentials fixture'});t.after(async()=>{await stopDashboard(project);rmSync(root,{recursive:true,force:true});});const started=await ensureDashboard(project,{home,premiumCheck:Promise.resolve({access:'unavailable',installed:false,verified:false,accessReason:'licence-not-configured'})});return {root,home,project,url:started.url};}
test('credential HTTP surface rejects cross-origin, query, unknown fields and unsafe requests without disclosure',{timeout:60000},async t=>{
 const f=await fixture(t),url=f.url+'/api/coding-providers/grok/credentials';
 const saved=await configureGrokCredentials({confirmed:true,expectedRevision:'missing',apiKey:key},{home:f.home,env:{},fetchImpl:async()=>new Response('{}')});
 const status=await(await fetch(url)).json();assert.equal(status.saved,true);assert.ok(!JSON.stringify(status).includes(key));
 const input={confirmed:true,expectedRevision:saved.revision};
 for(const origin of [undefined,'https://outside.invalid']){const r=await fetch(url+'/remove',{method:'POST',headers:{'content-type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(input)});assert.equal(r.status,403);assert.ok(!(await r.text()).includes(key));}
 const headers={'content-type':'application/json',origin:f.url};
 assert.equal((await fetch(url+'?apiKey='+key)).status,400);
 assert.equal((await fetch(url+'/configure',{method:'POST',headers,body:JSON.stringify({...input,apiKey:key,endpoint:'https://outside.invalid'})})).status,400);
 assert.equal((await fetch(url+'/remove',{method:'GET'})).status,405);
 assert.equal(grokCredentialStatus({home:f.home,env:{}}).saved,true);
 const removed=await fetch(url+'/remove',{method:'POST',headers,body:JSON.stringify(input)});assert.equal(removed.status,200);assert.equal((await removed.json()).saved,false);
});
test('dashboard clears password on failure and cancellation, preserves safe status and browser storage',{timeout:60000},async t=>{
 const f=await fixture(t),browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.route('**/api/coding-providers/grok/credentials/configure',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'The key was not accepted. Check it and try again.',code:'grok-key-rejected'})}));
 await page.goto(f.url);await page.locator('#sidebarOpen').click();await page.locator('#configurationNav:enabled').click();await page.locator('#grokCredentialKey:enabled').fill(key);await page.locator('#grokCredentialSave').click();await page.locator('#grokCredentialNotice').getByText(/not accepted/).waitFor();assert.equal(await page.locator('#grokCredentialKey').inputValue(),'');
 await page.locator('#grokCredentialKey').fill(key);await page.locator('#grokCredentialCancel').click();assert.equal(await page.locator('#grokCredentialKey').inputValue(),'');
 assert.equal(await page.locator('#grokCredentialKey').getAttribute('type'),'password');assert.equal(await page.evaluate(k=>JSON.stringify(localStorage).includes(k)||JSON.stringify(sessionStorage).includes(k),key),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});
