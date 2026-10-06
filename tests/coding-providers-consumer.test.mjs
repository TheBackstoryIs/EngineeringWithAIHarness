import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,cpSync,rmSync,chmodSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,delimiter} from 'node:path';
import {execFileSync} from 'node:child_process';

test('packed consumer can configure native Grok companion settings without a model override',{timeout:120000},t=>{
  const repository=resolve(import.meta.dirname,'..'),root=realpathSync(mkdtempSync(resolve(tmpdir(),'ewai-providers-consumer-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const consumer=resolve(root,'consumer'),project=resolve(root,'project'),home=resolve(root,'home'),bin=resolve(root,'bin');for(const dir of [consumer,project,home,bin])mkdirSync(dir);
  const cache=resolve(root,'cache'),clean=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^npm_config_/i.test(key))),npmEnv={...clean,npm_config_cache:cache,npm_config_update_notifier:'false'};
  const packed=JSON.parse(execFileSync('npm',['pack','--json','--pack-destination',root],{cwd:repository,env:npmEnv,encoding:'utf8',timeout:60000}))[0];
  const shipped=new Set(packed.files.map(f=>f.path));for(const path of ['src/coding-providers.mjs','src/config-document.mjs','src/runtime/grok-provider.mjs','public/coding-providers.js','Docs/operations/dashboard-configuration.md','Docs/reference/cli-and-configuration.md'])assert.ok(shipped.has(path),path+' is packaged');
  writeFileSync(resolve(consumer,'package.json'),JSON.stringify({private:true,name:'provider-fixture'}));
  cpSync(resolve(repository,'node_modules'),resolve(consumer,'node_modules'),{recursive:true,dereference:true});
  execFileSync('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--no-package-lock','--no-save',resolve(root,packed.filename)],{cwd:consumer,env:npmEnv,encoding:'utf8',timeout:90000});
  const packageRoot=resolve(consumer,'node_modules/@thebackstoryis/engineering-with-ai'),cli=resolve(consumer,'node_modules/.bin/ewai');assert.ok(realpathSync(cli).startsWith(packageRoot));
  const host=resolve(bin,'grok');writeFileSync(host,'#!/usr/bin/env node\nif(process.argv.includes("--version"))console.log("grok fixture");else console.log(JSON.stringify({args:process.argv.slice(2),orchestrator:process.env.EWAI_ORCHESTRATOR}));\n');chmodSync(host,0o700);
  const env={...clean,HOME:home,GROK_HOME:resolve(home,'grok'),EWAI_HOST:'grok',PATH:bin+delimiter+process.env.PATH};
  const run=args=>execFileSync(process.execPath,[cli,...args],{cwd:project,env,encoding:'utf8',timeout:30000});
  const json=args=>JSON.parse(run(args));json(['init','--name','Packaged provider fixture','--grok','--project',project,'--json']);
  assert.deepEqual(json(['validation','list','--project',project,'--json']).providers.grok,{state:'available',enabled:true});
  const defaults=json(['providers','show','--project',project,'--json']);assert.equal(defaults.policy,null);
  const policy=json(['providers','set','--primary','grok','--secondary','existing','--tertiary','existing','--pool','grok,codex','--project',project,'--json']);assert.equal(policy.policy.primary,'grok');assert.deepEqual(policy.policy.models,{});
  const launched=JSON.parse(run([]).trim().split('\n').at(-1));assert.equal(launched.orchestrator,'grok');assert.equal(launched.args.length,1);assert.ok(!launched.args.includes('--model'));
  assert.equal(json(['providers','defaults','--project',project,'--json']).policy,null);
  const docs=readFileSync(resolve(packageRoot,'Docs/reference/cli-and-configuration.md'),'utf8');assert.match(docs,/do not cap tokens or spending/);assert.match(docs,/unverified/);assert.match(docs,/separately checked coding/);
});
