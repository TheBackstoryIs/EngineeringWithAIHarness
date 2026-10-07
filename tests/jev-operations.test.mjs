import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,rmSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {refreshRepositoryIndex} from '../src/runtime/repository-index.mjs';
import {previewImpactAssessment,confirmImpactAssessment} from '../src/runtime/impact-analysis.mjs';
import { initProject } from '../src/project.mjs';
import { createIntent } from '../src/intents.mjs';
import { prepareContextPack, prepareProjectContext } from '../src/runtime/context-assembly.mjs';
import { saveJevSettings,readJevSettings } from '../src/jev.mjs';
import { decideWithJev,prepareProjectContextWithJev,enrichImpactWithJev,recommendPersonasWithJev,readCompanionWithJev,previewImpactWithJev } from '../src/runtime/jev-operations.mjs';
function fixture(t,mode='shadow'){const container=mkdtempSync(resolve(tmpdir(),'ewai-jev-ops-')),root=resolve(container,'project'),home=resolve(container,'account');mkdirSync(root);mkdirSync(home,{mode:0o700});initProject(root,{name:'Synthetic Jev project'});createIntent(root,{slug:'synthetic',domain:'platform',title:'Synthetic experiment',details:{problem:'Exercise optional decision assistance',outcomes:'Retain mandatory evidence'}});t.after(()=>rmSync(container,{recursive:true,force:true}));const current=readJevSettings(root);saveJevSettings(root,{confirmed:true,expectedRevision:current.revision,policy:{...current.policy,mode,cloudConsent:true,useCases:['context','personas','impact','skill','claim','failure','tests']}});return {root,home,env:{TYPESAFE_API_KEY:'apikey_synthetic-operation-key'}};}
function transport(url,init){const {questions}=JSON.parse(init.body),answers={};for(const [id,q]of Object.entries(questions)){
 if(q.type==='score')answers[id]={type:'score',score:1,legend:{'0':q.criteria[0],'1':q.criteria[1]},probabilities:{'0':0,'1':1},confidence:1};
 else if(q.type==='noul')answers[id]={type:'noul',noul:1};
 else {const ids=Object.keys(q.criteria),choice=ids.find(id=>id==='security'||id==='insufficient')??ids[0];answers[id]={type:'choice',choice,probabilities:Object.fromEntries(ids.map(id=>[id,id===choice?1:0])),confidence:1};}
 }return Promise.resolve(new Response(JSON.stringify({model:'jev-1.13.0',answers,usage:{input_tokens:100,output_tokens:10}})));}
test('shadow context retains exact baseline and mandatory fidelity; no source bodies are uploaded',async t=>{
 const f=fixture(t),input={profile:'intent',slug:'synthetic',focus:'Review credential setup',personaCatalogue:[{id:'core.security',name:'Security',tier:'core',description:'Credentials and privacy',tags:['security']}]};prepareProjectContext(f.root,input);const baseline=prepareProjectContext(f.root,input);let calls=0;
 const result=await prepareProjectContextWithJev(f.root,input,{...f,fetchImpl:async(url,init)=>{calls++;assert.ok(!init.body.includes('Retain mandatory evidence'));return transport(url,init);}});
 assert.deepEqual(result,baseline);assert.ok(calls>0);assert.equal(result.fidelity.mandatoryRecall,1);
});
test('active context ranking cannot suppress mandatory segments or turn overflow into ready',async t=>{
 const f=fixture(t,'active'),input={profile:'intent',slug:'synthetic',focus:'Synthetic review',personaCatalogue:[]};const before=prepareProjectContext(f.root,input),after=await prepareProjectContextWithJev(f.root,input,{...f,fetchImpl:transport});
 assert.deepEqual(after.segments.filter(s=>s.evidenceClass==='mandatory').map(s=>s.id),before.segments.filter(s=>s.evidenceClass==='mandatory').map(s=>s.id));assert.equal(after.fidelity.mandatoryRecall,1);
 const overflow=await prepareProjectContextWithJev(f.root,{...input,budgetTokens:1},{...f,fetchImpl:()=>{throw Error('must not call');}});assert.equal(overflow.status,'non-ready');assert.equal(overflow.modelContext,null);
});
test('additive impact enrichment preserves existing required review routes and personas',async t=>{
 const f=fixture(t,'active'),baseline={summary:'Stop customers reading each other records',activePersonas:[{id:'project.owner',tier:'project'}],reviewRoutes:[{id:'maintainer',recommendation:'required'}]};
 const result=await enrichImpactWithJev(f.root,baseline,{...f,fetchImpl:transport});assert.deepEqual(result.reviewRoutes[0],baseline.reviewRoutes[0]);assert.deepEqual(result.activePersonas,baseline.activePersonas);assert.deepEqual(result.reviewRoutes,baseline.reviewRoutes);assert.ok(result.supplementalReviewRoutes.some(r=>r.id==='security-identity'));
});
test('seven explicit rubrics remain advisory, with required tests protected and quotes checked locally',async t=>{
 const f=fixture(t);for(const useCase of ['context','personas','skill','claim','failure','impact','tests']){
  const input={useCase,source:'synthetic',task:'Synthetic decision',candidates:[{id:'one',label:'One optional candidate'}],claim:'Verified',evidence:'Insufficient',diagnostic:{code:'HTTP-401',message:'Request rejected'},summary:'Synthetic impact'};
  const result=await decideWithJev(f.root,input,{...f,fetchImpl:transport});assert.equal(result.authority,'advisory');assert.ok(result.decision);
 }
 const quote=await decideWithJev(f.root,{useCase:'claim',source:'synthetic',claim:'Anything',evidence:'Available text',quote:'Missing quote'},{...f,fetchImpl:()=>{throw Error('must not call');}});assert.equal(quote.reason,'quote-absent');
 const required=await decideWithJev(f.root,{useCase:'tests',source:'synthetic',task:'Rank tests',candidates:[{id:'required',label:'Always run',mandatory:true},{id:'optional',label:'Additional coverage'}]},{...f,fetchImpl:transport});assert.deepEqual(required.requiredIds,['required']);
});

test('choice probabilities order options and validate a supported LLM recommendation',async t=>{
 const f=fixture(t),input={useCase:'skill',source:'synthetic',origin:'llm',recommendedId:'second',task:'Choose reusable model access',candidates:[{id:'first',label:'Relationship'},{id:'second',label:'Duplicate query'}]};
 const result=await decideWithJev(f.root,input,{...f,fetchImpl:transport});assert.equal(result.recommendedId,'first');assert.deepEqual(result.orderedIds,['first','second']);assert.equal(result.validation.status,'disagrees');
 const agrees=await decideWithJev(f.root,{...input,recommendedId:'first'},{...f,fetchImpl:transport});assert.equal(agrees.validation.status,'agrees');assert.equal(agrees.cacheHit,true);
 await assert.rejects(()=>decideWithJev(f.root,{...input,recommendedId:'invented'},{...f,fetchImpl:transport}));
 const fallback=await decideWithJev(f.root,{...input,source:'unknown'},{...f,fetchImpl:()=>{throw Error('no call');}});assert.equal(fallback.validation.status,'inconclusive');assert.deepEqual(fallback.orderedIds,[]);
});
test('persona recommendations include later premium/project tiers with explicit catalogue coverage and cache',async t=>{
 const f=fixture(t),catalogue=Array.from({length:34},(_,i)=>({id:'core.'+i,name:'Core '+i,tier:'core',description:'Synthetic metadata',body:'NEVER UPLOAD BODY'}));catalogue.push({id:'premium.security',name:'Premium security',tier:'premium',description:'Security'}, {id:'project.owner',name:'Project owner',tier:'project',description:'Ownership'});
 let calls=0;const fetchImpl=async(url,init)=>{calls++;assert.ok(!init.body.includes('NEVER UPLOAD BODY'));const body=JSON.parse(init.body),result=await transport(url,init),data=await result.json();for(const [id,a]of Object.entries(data.answers)){const index=Number(id.slice(1)),p=body.state.candidates[index],score=p.id.startsWith('premium.')||p.id.startsWith('project.')?1:0;a.score=score;a.probabilities={'0':1-score,'1':score};}return new Response(JSON.stringify(data));};
 const result=await recommendPersonasWithJev(f.root,{focus:'Security ownership'},catalogue,{...f,fetchImpl});assert.equal(result.complete,true);assert.equal(result.consideredCount,36);assert.deepEqual(result.recommendations.map(p=>p.tier),['premium','project']);assert.equal(calls,3);
 await recommendPersonasWithJev(f.root,{focus:'Security ownership'},catalogue,{...f,fetchImpl});assert.equal(calls,3);
 const current=readJevSettings(f.root);saveJevSettings(f.root,{confirmed:true,expectedRevision:current.revision,policy:{...current.policy,maxCalls:1}});
 const partial=await recommendPersonasWithJev(f.root,{focus:'Security ownership'},catalogue,{...f,fetchImpl});assert.equal(partial.status,'fallback');assert.equal(partial.complete,false);assert.equal(partial.consideredCount,16);assert.equal(partial.reason,'budget-exhausted');
});
test('active optional ranking changes order while retaining mandatory fidelity and local source bodies',async t=>{
 const f=fixture(t,'active'),build=resolve(f.root,'SPECS/6.Build/synthetic');mkdirSync(build,{recursive:true});writeFileSync(resolve(build,'delivery-state.json'),JSON.stringify({slug:'synthetic',currentPhase:'plan'}));writeFileSync(resolve(build,'tracker.md'),'PRIVATE TRACKER BODY');writeFileSync(resolve(build,'context-packet.md'),'PRIVATE CONTEXT BODY');
 const input={profile:'companion',slug:'synthetic',focus:'Synthetic review',personaCatalogue:[]};prepareProjectContext(f.root,input);const before=prepareProjectContext(f.root,input);
 const fetchImpl=async(url,init)=>{assert.ok(!init.body.includes('PRIVATE'));const response=await transport(url,init),data=await response.json(),request=JSON.parse(init.body);for(const [id,a]of Object.entries(data.answers)){const item=request.state.candidates[Number(id.slice(1))],score=item.id==='context-packet'?1:0;a.score=score;a.probabilities={'0':1-score,'1':score};}return new Response(JSON.stringify(data));};
 const after=await prepareProjectContextWithJev(f.root,input,{...f,fetchImpl});assert.equal(after.fidelity.mandatoryRecall,1);assert.notDeepEqual(after.segments.map(s=>s.id),before.segments.map(s=>s.id));assert.ok(after.modelContext.includes('PRIVATE CONTEXT BODY'));
});

test('companion options retain human/blocked slots and governed handoffs while active ranking changes equal-class order',async t=>{
 const f=fixture(t,'active'),items=[{id:'one',slug:'one',title:'Alpha',lane:'ready',execution:{actions:{beginHarness:{permitted:true}}}},{id:'two',slug:'two',title:'Beta',lane:'ready',execution:{actions:{beginHarness:{permitted:true}}}},{id:'human',slug:'human',title:'Approval',lane:'qa'},{id:'human2',slug:'human2',title:'Approval second',lane:'qa'},{id:'blocked',slug:'blocked',title:'Blocked',lane:'blocked'}];
 const options={...f,items,focus:'Improve delivery',personas:[],fetchImpl:async(url,init)=>{const request=JSON.parse(init.body),ids=Object.keys(request.questions.decision.criteria),choice=ids.find(id=>request.questions.decision.criteria[id].includes('Beta'));return new Response(JSON.stringify({model:'jev-1.13.0',answers:{decision:{type:'choice',choice,probabilities:Object.fromEntries(ids.map(id=>[id,id===choice?1:0])),confidence:1}},usage:{input_tokens:100,output_tokens:10}}));}};
 const result=await readCompanionWithJev(f.root,options);assert.equal(result.recommendations[0].id,'human');assert.equal(result.recommendations.at(-1).id,'blocked');assert.equal(result.recommendations[1].id,'human2');assert.equal(result.recommendations[2].id,'two');assert.equal(result.recommendations[2].handoff.kind,'begin');assert.equal(result.spotlight.id,result.recommendations[0].id);assert.equal(result.jevAdvice.recommendedId,'two');assert.equal(result.jevAdvice.authority,'advisory');
});

test('a changed mandatory source during inference returns current overflow instead of stale ready context',async t=>{
 const f=fixture(t,'active'),input={profile:'intent',slug:'synthetic',focus:'Review security',personaCatalogue:[{id:'core.security',name:'Security',tier:'core',description:'Security'}]};const intent=resolve(f.root,'SPECS/2.Purpose/intents/platform/synthetic.md');
 const result=await prepareProjectContextWithJev(f.root,input,{...f,fetchImpl:async(url,init)=>{writeFileSync(intent,'Synthetic mandatory source changed '+ 'Very long mandatory evidence. '.repeat(20000));return transport(url,init);}});assert.equal(result.status,'non-ready');assert.equal(result.modelContext,null);assert.equal(result.reason,'mandatory-overflow');
});
test('long option distinctions are rejected rather than silently truncated',async t=>{
 const f=fixture(t);await assert.rejects(()=>decideWithJev(f.root,{useCase:'skill',source:'synthetic',origin:'llm',recommendedId:'one',task:'Select option',candidates:[{id:'one',label:'x'.repeat(250),description:'essential distinction'}]},{...f,fetchImpl:()=>{throw Error('must not call');}}));
});
test('real impact advice is visible in inferred cards and leaves canonical preview-to-confirmation routes exact',async t=>{
 const f=fixture(t,'active');mkdirSync(resolve(f.root,'src'));writeFileSync(resolve(f.root,'src/helper.mjs'),'export const helper=1;');refreshRepositoryIndex(f.root);
 const input={summary:'Refactor the internal helper implementation without changing behaviour or public interfaces.',targets:['src/helper.mjs']},options={...f,personas:[],fetchImpl:transport};const baseline=previewImpactAssessment(f.root,'synthetic',input,options),result=await previewImpactWithJev(f.root,'synthetic',input,options);
 assert.deepEqual(result.reviewRoutes,baseline.reviewRoutes);assert.ok(result.impactAreas.some(area=>area.label.includes('Jev suggests')));
 const receipt=confirmImpactAssessment(f.root,'synthetic',{...input,indexRunId:result.index.runId,acknowledged:true,assessor:'Synthetic reviewer',decisions:Object.fromEntries(result.reviewRoutes.map(r=>[r.id,r.recommendation]))},options);assert.ok(receipt.assessmentId);
});

test('active optional ordering retains every baseline reviewer when a competing segment replaces its signal',async t=>{
 const f=fixture(t,'active'),build=resolve(f.root,'SPECS/6.Build/synthetic');mkdirSync(build,{recursive:true});writeFileSync(resolve(build,'delivery-state.json'),JSON.stringify({slug:'synthetic',currentPhase:'plan'}));writeFileSync(resolve(build,'tracker.md'),'Tracker '+'ordinary evidence '.repeat(150));writeFileSync(resolve(build,'context-packet.md'),'Packet '+'ordinary evidence '.repeat(150));
 const input={profile:'companion',slug:'synthetic',focus:'Review current work',personaCatalogue:[{id:'core.tracker',name:'Tracker specialist',tier:'core',tags:['delivery-tracker'],description:'Tracker'}]};let baseline=prepareProjectContext(f.root,input);input.budgetTokens=baseline.budget.mandatoryTokens+baseline.segments.find(s=>s.id==='delivery-tracker').estimatedTokens+30;baseline=prepareProjectContext(f.root,input);assert.ok(baseline.activePersonas.some(p=>p.id==='core.tracker'));
 const after=await prepareProjectContextWithJev(f.root,input,{...f,fetchImpl:async(url,init)=>{const response=await transport(url,init),data=await response.json(),request=JSON.parse(init.body);for(const [id,a]of Object.entries(data.answers)){const score=request.state.candidates[Number(id.slice(1))].id==='context-packet'?1:0;a.score=score;a.probabilities={'0':1-score,'1':score};}return new Response(JSON.stringify(data));}});assert.ok(after.activePersonas.some(p=>p.id==='core.tracker'));assert.equal(after.fidelity.mandatoryRecall,1);
});
test('companion keeps the original focus in refreshed persona and review guidance',async t=>{
 const f=fixture(t,'active'),items=[{id:'human',slug:'human',title:'Generic approval',lane:'qa'},{id:'work',slug:'work',title:'Generic work',execution:{actions:{beginHarness:{permitted:true}}}}],personas=[{id:'core.security',name:'Security reviewer',tier:'core',tags:['security'],description:'Security'}];const result=await readCompanionWithJev(f.root,{...f,items,personas,focus:'security',fetchImpl:transport});assert.equal(result.focus,'security');assert.ok(result.activePersonas.some(p=>p.id==='core.security'));assert.ok(result.review.questions.some(q=>/security/i.test(q)));assert.equal(result.spotlight.id,'human');
});

test('active persona additions use the evaluated tier definition and retain baseline engagement records exactly',async t=>{
 const f=fixture(t,'active'),catalogue=[{id:'same',name:'Core version',tier:'core',tags:[],category:''},{id:'same',name:'Project override',tier:'project',tags:['unmatched-specialism'],category:'Specialist'}];
 const input={profile:'intent',slug:'synthetic',focus:'security',personaCatalogue:catalogue},baseline=prepareProjectContext(f.root,input);
 const result=await prepareProjectContextWithJev(f.root,input,{...f,fetchImpl:transport});
 for(const original of baseline.activePersonas)assert.deepEqual(result.activePersonas.find(p=>p.id===original.id),original);
 const selected=result.activePersonas.find(p=>p.id==='same');assert.ok(selected);assert.equal(selected.name,'Project override');assert.equal(selected.tier,'project');
});

test('new deterministic persona matches cannot bypass evaluated tier resolution; disabled persona inference retains baseline provenance',async t=>{
 const f=fixture(t,'active'),build=resolve(f.root,'SPECS/6.Build/synthetic');mkdirSync(build,{recursive:true});writeFileSync(resolve(build,'delivery-state.json'),JSON.stringify({slug:'synthetic',currentPhase:'plan'}));writeFileSync(resolve(build,'tracker.md'),'Tracker '+'ordinary evidence '.repeat(150));writeFileSync(resolve(build,'context-packet.md'),'Packet '+'ordinary evidence '.repeat(150));
 const input={profile:'companion',slug:'synthetic',focus:'Review current work',personaCatalogue:[{id:'same',name:'Core packet match',tier:'core',tags:['context-packet']},{id:'same',name:'Project evaluated definition',tier:'project',tags:['unmatched-specialism']},{id:'tracker',name:'Original tracker reviewer',tier:'core',tags:['delivery-tracker']}]};let baseline=prepareProjectContext(f.root,input);input.budgetTokens=baseline.budget.mandatoryTokens+baseline.segments.find(s=>s.id==='delivery-tracker').estimatedTokens+30;baseline=prepareProjectContext(f.root,input);assert.ok(baseline.activePersonas.length>0);assert.ok(!baseline.activePersonas.some(p=>p.id==='same'));
 const fetchImpl=async(url,init)=>{const request=JSON.parse(init.body),response=await transport(url,init),data=await response.json();if(request.state.candidates.some(c=>c.id==='context-packet'))for(const[id,a]of Object.entries(data.answers)){const score=request.state.candidates[Number(id.slice(1))].id==='context-packet'?1:0;a.score=score;a.probabilities={'0':1-score,'1':score};}return new Response(JSON.stringify(data));};
 const active=await prepareProjectContextWithJev(f.root,input,{...f,fetchImpl});const selected=active.activePersonas.find(p=>p.id==='same');assert.equal(selected.name,'Project evaluated definition');assert.equal(selected.tier,'project');for(const original of baseline.activePersonas)assert.deepEqual(active.activePersonas.find(p=>p.id===original.id),original);
 const policy=readJevSettings(f.root);saveJevSettings(f.root,{confirmed:true,expectedRevision:policy.revision,policy:{...policy.policy,useCases:['context']}});const contextOnly=await prepareProjectContextWithJev(f.root,input,{...f,fetchImpl});for(const original of baseline.activePersonas)assert.deepEqual(contextOnly.activePersonas.find(p=>p.id===original.id),original);
});
