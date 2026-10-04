import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {hostInvocation,detectHostStatuses} from '../src/companion.mjs';
import {install} from '../src/install.mjs';
import {configureProjectMcp} from '../src/runtime/mcp-config.mjs';
import {execFileSync} from 'node:child_process';
import {loadProjectConfig} from '../src/project.mjs';
const fixture=t=>{const root=mkdtempSync(resolve(tmpdir(),'ewai-grok-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;};
test('CLI init explicitly opts into Grok without changing other native defaults',t=>{
 const root=fixture(t);execFileSync(process.execPath,[resolve(import.meta.dirname,'../bin/ewai'),'init','--project',root,'--grok','--json'],{stdio:'pipe'});
 const {config}=loadProjectConfig(root);assert.deepEqual(config.validation.external.providers.grok,{state:'available',enabled:true});assert.equal(config.coding_providers,undefined);
});
test('Grok interactive launch preserves native models and is detected',()=>{
  assert.deepEqual(hostInvocation('grok','hello'),{command:'grok',args:['hello']});
  assert.ok(detectHostStatuses({probe:h=>h==='grok'}).find(h=>h.host==='grok')?.available);
});
test('PTS-009 grok installs native project and isolated global skills',t=>{
  const root=fixture(t),home=resolve(root,'home'),project=resolve(root,'project');mkdirSync(home);mkdirSync(project);
  const local=install({scope:'project',host:'grok',projectRoot:project,home,installBin:false});
  assert.ok(local.skills.some(s=>s.destination.startsWith(resolve(project,'.grok/skills'))));
  const global=install({scope:'global',host:'grok',home,installBin:false});
  assert.ok(global.skills.some(s=>s.destination.startsWith(resolve(home,'.grok/skills'))));
});
test('PTS-010 grok MCP preserves TOML and is idempotent',t=>{
  const root=fixture(t),file=resolve(root,'.grok/config.toml');mkdirSync(resolve(root,'.grok'));
  const original='# user configuration\n[permission]\nallow = ["read_file"]\n\n[mcp_servers.other]\ncommand = "fixture-other"\n';writeFileSync(file,original);
  const result=configureProjectMcp(root);assert.equal(result.hosts.grok,file);
  const after=readFileSync(file,'utf8');assert.ok(after.startsWith(original));assert.match(after,/\[mcp_servers\.ewai\]/);assert.match(after,/command = "ewai"/);
  configureProjectMcp(root);assert.equal(readFileSync(file,'utf8'),after);
});
test('PTS-011 grok MCP refuses malformed conflicting or unsafe config',t=>{
  const root=fixture(t),folder=resolve(root,'.grok'),file=resolve(folder,'config.toml');mkdirSync(folder);
  for(const content of ['[private\nsecret = "fixture-private"','[mcp_servers.ewai]\ncommand = "user-owned"\n','# EWAI-MCP:START\n']){writeFileSync(file,content);assert.throws(()=>configureProjectMcp(root),e=>!e.message.includes('fixture-private'));assert.equal(readFileSync(file,'utf8'),content);}
  rmSync(file);const outside=resolve(root,'outside.toml');writeFileSync(outside,'# unchanged');symlinkSync(outside,file);assert.throws(()=>configureProjectMcp(root),/safe|symbolic|regular/i);assert.equal(readFileSync(outside,'utf8'),'# unchanged');
});
