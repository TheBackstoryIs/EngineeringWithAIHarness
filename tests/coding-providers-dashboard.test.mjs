import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import YAML from 'yaml';
import {initProject} from '../src/project.mjs';
import {readCodingProviders,saveCodingProviders} from '../src/coding-providers.mjs';
import {ensureDashboard,stopDashboard} from '../src/runtime/dashboard.mjs';
import {chromium} from 'playwright';
import {createIntent,updateIntentDeliveryState} from '../src/intents.mjs';
const fixture=(t,cleanup=true)=>{const root=realpathSync(mkdtempSync(resolve(tmpdir(),'ewai-provider-settings-')));if(cleanup)t.after(()=>rmSync(root,{recursive:true,force:true}));initProject(root,{name:'Provider fixture'});return root;};
test('a newly saved automatic pool is shown exactly in the autonomy approval preview',{timeout:60000},async t=>{
  const root=fixture(t,false),intent=createIntent(root,{domain:'product',slug:'provider-task',title:'Provider task'});
  updateIntentDeliveryState(root,intent.path,{status:'ready'});
  let browser;t.after(async()=>{await browser?.close();await stopDashboard(root);rmSync(root,{recursive:true,force:true});});
  const started=await ensureDashboard(root,{home:resolve(root,'isolated-home'),premiumCheck:Promise.resolve({access:'unavailable',installed:false,verified:false,accessReason:'licence-not-configured'})});
  browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.goto(started.url);
  await page.locator('#configurationNav:enabled').click();await page.waitForFunction(()=>document.querySelector('#codingProvidersForm select[name=primary]').disabled===false);
  await page.locator('#codingProvidersForm [name=primary]').selectOption('auto');
  for(const role of ['secondary','tertiary'])await page.locator('#codingProvidersForm [name='+role+']').selectOption('off');
  for(const provider of ['claude','antigravity'])await page.locator('#codingProviderPool [value='+provider+']').click();
  await page.locator('#codingProviderSave').click();await page.getByText('Provider settings saved. No delivery started.',{exact:true}).waitFor();
  await page.locator('#autonomyProvider').selectOption('auto');await page.locator('#autonomyPool').getByRole('checkbox',{name:'Provider task'}).click();
  const response=page.waitForResponse(r=>r.url().endsWith('/api/autonomy/preview')&&r.request().method()==='POST'&&Boolean(r.request().postDataJSON()?.proposal));
  await page.locator('#autonomyPreviewButton').click();const preview=await(await response).json();assert.ok(preview.proposal,JSON.stringify(preview));assert.deepEqual(preview.proposal.providers,['codex','grok']);
  await page.locator('#autonomyReviewButton').click();await page.locator('#autonomyApprovalSummary').getByText(/Provider: codex, grok/).waitFor();
  assert.equal((await(await fetch(started.url+'/api/autonomy')).json()).mode,'off');
});
test('PTS-008 defaults remove only additive provider policy',t=>{
  const root=fixture(t),file=resolve(root,'SPECS/pipeline.yaml');writeFileSync(file,readFileSync(file,'utf8')+'\n# Keep this comment\n');
  const old=YAML.parse(readFileSync(file,'utf8')),first=readCodingProviders(root,{probe:()=>false});
  const changed=saveCodingProviders(root,{confirmed:true,expectedDigest:first.digest,policy:{primary:'grok',pool:['grok','codex']}});
  const cleared=saveCodingProviders(root,{confirmed:true,expectedDigest:changed.digest,policy:null});
  assert.equal(cleared.policy,null);const content=readFileSync(file,'utf8'),result=YAML.parse(content);
  assert.match(content,/# Keep this comment/);assert.deepEqual(result.validation,old.validation);assert.deepEqual(result.approvals,old.approvals);assert.equal('coding_providers' in result,false);
});
test('PTS-007 stale save preserves draft and unrelated configuration',t=>{
  const root=fixture(t),file=resolve(root,'SPECS/pipeline.yaml'),before=readCodingProviders(root,{probe:()=>false});writeFileSync(file,readFileSync(file,'utf8')+'# newer settings\n');
  const original=readFileSync(file,'utf8');assert.throws(()=>saveCodingProviders(root,{confirmed:true,expectedDigest:before.digest,policy:{primary:'grok'}}),e=>e.statusCode===409);assert.equal(readFileSync(file,'utf8'),original);
});
test('closed mutation input and invalid models cannot overwrite settings',t=>{
  const root=fixture(t),before=readCodingProviders(root,{probe:()=>false});
  for(const change of [{confirmed:false},{executable:'injected'},{policy:{models:{grok:{permitted_models:['*']}}}}])assert.throws(()=>saveCodingProviders(root,{confirmed:true,expectedDigest:before.digest,policy:{primary:'grok'},...change}));
  assert.equal(readCodingProviders(root,{probe:()=>false}).digest,before.digest);
});
test('PTS-012 CLI and service policy validation agree',t=>{
  const root=fixture(t),cli=resolve(import.meta.dirname,'../bin/ewai');
  const initial=JSON.parse(execFileSync(process.execPath,[cli,'providers','show','--project',root,'--json'],{encoding:'utf8'}));
  const changed=JSON.parse(execFileSync(process.execPath,[cli,'providers','set','--primary','grok','--secondary','codex','--tertiary','off','--pool','grok,codex','--expected-digest',initial.digest,'--project',root,'--json'],{encoding:'utf8'}));
  assert.deepEqual(changed.policy,readCodingProviders(root,{probe:()=>false}).policy);assert.equal(changed.policy.primary,'grok');
  assert.throws(()=>execFileSync(process.execPath,[cli,'providers','set','--command','anything','--project',root,'--json'],{stdio:'pipe'}));
});
test('PTS-013 provider settings reject cross-origin mutation and preserve configuration',{timeout:30000},async t=>{
  const root=fixture(t,false);t.after(async()=>{await stopDashboard(root);rmSync(root,{recursive:true,force:true});});
  const started=await ensureDashboard(root,{home:resolve(root,'isolated-home'),premiumCheck:Promise.resolve({access:'unavailable',installed:false,verified:false,accessReason:'licence-not-configured'})});
  const url=started.url+'/api/coding-providers',before=await(await fetch(url)).json(),body=JSON.stringify({confirmed:true,expectedDigest:before.digest,policy:{primary:'grok'}});
  for(const origin of [undefined,'https://outside.example']){const headers={'content-type':'application/json',...(origin?{origin}:{})};assert.equal((await fetch(url,{method:'POST',headers,body})).status,403);}
  const unknown=await fetch(url,{method:'POST',headers:{'content-type':'application/json',origin:started.url},body:JSON.stringify({confirmed:true,expectedDigest:before.digest,policy:{command:'injected'}})});assert.equal(unknown.status,400);
  assert.equal((await fetch(url+'?command=injected')).status,400);assert.equal(readCodingProviders(root,{probe:()=>false}).digest,before.digest);
  const saved=await fetch(url,{method:'POST',headers:{'content-type':'application/json',origin:started.url},body});assert.equal(saved.status,200);assert.equal((await saved.json()).policy.primary,'grok');
});
test('live provider panel saves native settings and keeps a stale draft',{timeout:60000},async t=>{
  const root=fixture(t,false);let browser;t.after(async()=>{await browser?.close();await stopDashboard(root);rmSync(root,{recursive:true,force:true});});
  const started=await ensureDashboard(root,{home:resolve(root,'isolated-home'),premiumCheck:Promise.resolve({access:'unavailable',installed:false,verified:false,accessReason:'licence-not-configured'})});
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1360,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(started.url);await page.waitForFunction(()=>document.getElementById('configurationNav').disabled===false);await page.locator('#configurationNav').click();
  await page.waitForFunction(()=>document.querySelector('#codingProvidersForm select[name=primary]').disabled===false);
  await page.locator('#codingProvidersForm [name=primary]').selectOption('grok');
  assert.equal(await page.locator('#codingProviderSave').isDisabled(),false,JSON.stringify({errors,status:await page.locator('#codingProviderStatus').textContent(),preview:await page.locator('#codingProviderPreview').textContent()}));
  await page.locator('#codingProviderSave').click();await page.getByText('Provider settings saved. No delivery started.',{exact:true}).waitFor();
  assert.equal(readCodingProviders(root,{probe:()=>false}).policy.primary,'grok');
  await page.locator('#codingProvidersForm summary').click();await page.locator('#codingModelProvider').selectOption('grok');assert.equal(await page.locator('#codingProviderSave').isDisabled(),true,'Changing the model editor does not create a policy change');
  await page.locator('#codingModelSuggestion').fill('fixture-model');await page.locator('#codingProviderSave').click();await page.getByText('Provider settings saved. No delivery started.',{exact:true}).waitFor();
  assert.equal(readCodingProviders(root,{probe:()=>false}).policy.models.grok.suggestion,'fixture-model');
  const current=readCodingProviders(root,{probe:()=>false});saveCodingProviders(root,{confirmed:true,expectedDigest:current.digest,policy:{...current.policy,models:{grok:{suggestion:'newer-model'}}}},{probe:()=>false});
  await page.locator('#codingProvidersForm [name=primary]').selectOption('auto');await page.locator('#codingProviderSave').click();await page.waitForFunction(()=>document.getElementById('codingProviderConflict').hidden===false);
  assert.equal(await page.locator('#codingProvidersForm [name=primary]').inputValue(),'auto');assert.equal(await page.locator('#codingModelSuggestion').inputValue(),'fixture-model');
  await page.locator('#codingProviderCompare').click();await page.getByText(/Latest saved settings:.*newer-model/).waitFor();await page.locator('#codingProviderRebase').click();
  await page.locator('#codingProviderSave').click();await page.getByText('Provider settings saved. No delivery started.',{exact:true}).waitFor();assert.equal(readCodingProviders(root,{probe:()=>false}).policy.primary,'auto');
  await page.locator('#codingProviderDefaults').click();await page.locator('#codingProviderSave').click();await page.getByText('Provider settings saved. No delivery started.',{exact:true}).waitFor();assert.equal(readCodingProviders(root,{probe:()=>false}).policy,null);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
});
