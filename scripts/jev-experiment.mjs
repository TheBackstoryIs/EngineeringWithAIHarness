import {readFileSync} from 'node:fs';
import {decideWithJev} from '../src/runtime/jev-operations.mjs';
import {readJevMeasurements} from '../src/jev.mjs';

// Import-safe runner: the CLI owns policy and key capture. This never enables
// Jev, widens budgets, captures credentials or uploads project evidence.
export async function runJevExperiment(root,options={}){
 const limit=options.limit??6;
 if(!Number.isInteger(limit)||limit<1||limit>6){const e=Error('Choose an experiment limit from 1 to 6.');e.code='jev-input';throw e;}
 const fixtures=JSON.parse(readFileSync(new URL('../tests/fixtures/jev-synthetic.json',import.meta.url),'utf8')).slice(0,limit),results=[];
 const before=readJevMeasurements(root);
 for(const fixture of fixtures){const result=await decideWithJev(root,fixture.input,options);results.push({id:fixture.id,expected:fixture.expected,actual:result.decision,status:result.status,reason:result.reason,correct:result.status==='suggested'?result.decision===fixture.expected:null,validation:result.validation,measurement:result.measurement??null});}
 const after=readJevMeasurements(root);
 return {schema:'ewai.jev-experiment/v1',dataset:'six synthetic challenge cases; not representative coding evaluation',results,summary:{evaluated:results.filter(r=>r.correct!==null).length,correct:results.filter(r=>r.correct===true).length,providerCalls:results.filter(r=>r.measurement?.providerCall).length,inputTokens:results.every(r=>r.measurement?.inputTokens!==null)?results.reduce((sum,r)=>sum+(r.measurement?.inputTokens??0),0):null,downstreamSavings:null},before:before.summary,after:after.summary};
}
