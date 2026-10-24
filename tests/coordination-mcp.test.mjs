import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {initProject} from '../src/project.mjs';

test('native MCP exposes shared coordination without changing standalone authority',async t=>{
 const root=mkdtempSync(resolve(tmpdir(),'ewai-coordination-mcp-'));initProject(root,{name:'Coordination MCP fixture'});
 const client=new Client({name:'coordination-fixture',version:'1'});
 t.after(async()=>{await client.close();rmSync(root,{recursive:true,force:true});});
 await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('bin/ewai'),'mcp','--project',root],stderr:'ignore'}));
 const names=(await client.listTools()).tools.map(tool=>tool.name);
 for(const name of ['ewai_coordination_status','ewai_coordination_publish','ewai_coordination_recover','ewai_list_intents','ewai_delivery_begin'])assert.ok(names.includes(name),name);
 const status=await client.callTool({name:'ewai_coordination_status',arguments:{}});assert.deepEqual(JSON.parse(status.content[0].text),{mode:'standalone'});
 const publish=await client.callTool({name:'ewai_coordination_publish',arguments:{intent:'missing',expectedRevision:1}});assert.equal(publish.isError,true);
});
