import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,realpathSync,linkSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import YAML from 'yaml';
import {DASHBOARD_VIEWS,readDashboardPreferences,saveDashboardPreferences,premiumPersonasActive} from '../src/dashboard-preferences.mjs';

function fixture(t){
  const root=realpathSync(mkdtempSync(resolve(tmpdir(),'ewai-dashboard-preferences-')));
  mkdirSync(resolve(root,'SPECS'));mkdirSync(resolve(root,'.ewai-pipeline'));
  writeFileSync(resolve(root,'.ewai-pipeline/project.json'),JSON.stringify({specsRoot:resolve(root,'SPECS')}));
  writeFileSync(resolve(root,'SPECS/pipeline.yaml'),'# Keep our project notes\nschema: ewai.project/v1\nproject:\n  name: Preference fixture\nspecs:\n  root: SPECS\nrepositories: []\napprovals:\n  build: required # Keep approval\nvalidation:\n  standards:\n    required: true\n    allow_waiver: false\n');
  t.after(()=>rmSync(root,{recursive:true,force:true}));return root;
}
test('new and existing projects have nine disabled optional views and an expanded sidebar',t=>{
  const root=fixture(t),state=readDashboardPreferences(root);
  assert.equal(DASHBOARD_VIEWS.length,9);assert.equal(state.preferences.sidebar_collapsed,false);
  assert.deepEqual(Object.keys(state.preferences.optional_views),DASHBOARD_VIEWS.map(v=>v.id));
  assert.ok(Object.values(state.preferences.optional_views).every(v=>v===false));
  assert.match(state.digest,/^sha256:[a-f0-9]{64}$/);
});
test('confirmed save persists every view and preserves YAML comments and assurance configuration',t=>{
  const root=fixture(t),before=readDashboardPreferences(root),file=resolve(root,'SPECS/pipeline.yaml');
  const saved=saveDashboardPreferences(root,{confirmed:true,expectedDigest:before.digest,preferences:{sidebar_collapsed:true,optional_views:Object.fromEntries(DASHBOARD_VIEWS.map(v=>[v.id,true]))}});
  assert.ok(Object.values(saved.preferences.optional_views).every(Boolean));assert.equal(readDashboardPreferences(root).preferences.sidebar_collapsed,true);
  const text=readFileSync(file,'utf8'),config=YAML.parse(text);
  assert.match(text,/# Keep our project notes/);assert.match(text,/# Keep approval/);
  assert.deepEqual(config.validation,{standards:{required:true,allow_waiver:false}});assert.equal(config.approvals.build,'required');
  assert.notEqual(saved.digest,before.digest);
});
test('stale configuration, omitted confirmation, invalid types and unrecognised fields cannot overwrite a project',t=>{
  const root=fixture(t),state=readDashboardPreferences(root),file=resolve(root,'SPECS/pipeline.yaml');
  const original=readFileSync(file,'utf8');
  for(const changes of [{confirmed:false},{preferences:undefined},{preferences:{optional_views:null}},{preferences:{optional_views:{portfolio:'true'}}},{preferences:{optional_views:{injected:true}}},{preferences:{sidebar_collapsed:1}},{executable:'anything'}]){
    assert.throws(()=>saveDashboardPreferences(root,{confirmed:true,expectedDigest:state.digest,preferences:state.preferences,...changes}));assert.equal(readFileSync(file,'utf8'),original);
  }
  writeFileSync(file,original+'# Someone else changed this\n');
  assert.throws(()=>saveDashboardPreferences(root,{confirmed:true,expectedDigest:state.digest,preferences:state.preferences}),/changed|reload/i);
  assert.match(readFileSync(file,'utf8'),/Someone else/);
});
test('invalid stored preferences and unsafe symlink targets fail without rewriting data',t=>{
  const root=fixture(t),file=resolve(root,'SPECS/pipeline.yaml');
  writeFileSync(file,readFileSync(file,'utf8')+'dashboard:\n  optional_views:\n    portfolio: yes\n');
  assert.throws(()=>readDashboardPreferences(root),/preferences|true or false/i);
  const destination=resolve(root,'outside.yaml');writeFileSync(destination,'do not overwrite');rmSync(file);symlinkSync(destination,file);
  assert.throws(()=>readDashboardPreferences(root),/regular|safe|symbolic/i);assert.equal(readFileSync(destination,'utf8'),'do not overwrite');
});
test('only available, installed and verified premium access suppresses setup',()=>{
  assert.equal(premiumPersonasActive({access:'available',installed:true,verified:true}),true);
  for(const state of [{},{access:'unknown',installed:true,verified:true},{access:'unavailable',installed:true,verified:true},{access:'available',installed:false,verified:true},{access:'available',installed:true,verified:false}])assert.equal(premiumPersonasActive(state),false);
});
test('existing locks, hard links, symbolic parents and malformed YAML are rejected without exposing source content',t=>{
  const root=fixture(t),file=resolve(root,'SPECS/pipeline.yaml'),before=readDashboardPreferences(root),original=readFileSync(file,'utf8');
  const lock=file+'.dashboard-preferences.lock';writeFileSync(lock,'existing editor');
  assert.throws(()=>saveDashboardPreferences(root,{confirmed:true,expectedDigest:before.digest,preferences:before.preferences}),/being edited/i);
  assert.equal(readFileSync(lock,'utf8'),'existing editor');assert.equal(readFileSync(file,'utf8'),original);rmSync(lock);
  const hardLink=resolve(root,'hard-link.yaml');linkSync(file,hardLink);
  assert.throws(()=>readDashboardPreferences(root),/regular|symbolic/i);rmSync(hardLink);
  writeFileSync(file,original+'privateExample: [do-not-echo-this\n');
  assert.throws(()=>readDashboardPreferences(root),error=>error.statusCode===422&&!error.message.includes('do-not-echo-this'));
  writeFileSync(file,original);renameSync(resolve(root,'SPECS'),resolve(root,'real-specs'));symlinkSync(resolve(root,'real-specs'),resolve(root,'SPECS'));
  assert.throws(()=>readDashboardPreferences(root),/symbolic|safe/i);
});
test('CLI uses the same project preferences contract and requires deliberate save consent',t=>{
  const root=fixture(t),cli=resolve(import.meta.dirname,'../bin/ewai');
  const read=JSON.parse(execFileSync(process.execPath,[cli,'dashboard','preferences','--project',root,'--json'],{encoding:'utf8'}));
  assert.equal(read.preferences.optional_views.portfolio,false);
  assert.throws(()=>execFileSync(process.execPath,[cli,'dashboard','configure','--enable','portfolio','--expected-digest',read.digest,'--project',root,'--json'],{stdio:'pipe'}));
  const saved=JSON.parse(execFileSync(process.execPath,[cli,'dashboard','configure','--enable','portfolio','--expected-digest',read.digest,'--yes','--project',root,'--json'],{encoding:'utf8'}));
  assert.equal(saved.preferences.optional_views.portfolio,true);assert.equal(readDashboardPreferences(root).preferences.optional_views.portfolio,true);
});
