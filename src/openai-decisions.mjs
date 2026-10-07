// Typed transport conversion only. Privacy, consent, budgets and cancellation
// belong to the shared decision engine; no credential or network access here.
export const OPENAI_DECISIONS_MODEL='gpt-6-luna';
const plain=v=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const own=(v,keys)=>plain(v)&&Object.keys(v).every(k=>keys.includes(k));
const probability=v=>Number.isFinite(v)&&v>=0&&v<=1;
const integer=v=>Number.isSafeInteger(v)&&v>=0;
function invalid(){throw Error('invalid-response');}
export function buildOpenaiDecisionPayload(state,questions){
 const input=typeof state==='string'?state:JSON.stringify(state);
 return {model:OPENAI_DECISIONS_MODEL,input,questions:Object.entries(questions).map(([name,q])=>{
  if(q.type==='choice')return {type:'choice',name,instructions:q.instructions,choices:Object.entries(q.criteria).map(([value,description])=>({value,description}))};
  if(q.type==='score'){
   if(new Set(q.criteria).size!==q.criteria.length)invalid();
   return {type:'score',name,instructions:q.instructions,levels:q.criteria.map(label=>({label}))};
  }
  if(q.type==='noul')return {type:'predicate',name,instructions:q.instructions+(q.criteria?'\nTrue means: '+q.criteria.true+'\nFalse means: '+q.criteria.false:'')};
  invalid();
 })};
}
export function openaiDecisionUsage(body){
 const u=body?.usage;
 if(!own(u,['input_tokens','output_tokens','total_tokens','input_tokens_details','output_tokens_details'])||!integer(u.input_tokens)||!integer(u.output_tokens)||!integer(u.total_tokens)||u.total_tokens!==u.input_tokens+u.output_tokens)return null;
 const i=u.input_tokens_details,o=u.output_tokens_details;
 if(!own(i,['cached_tokens','cache_write_tokens'])||!integer(i.cached_tokens)||!integer(i.cache_write_tokens)||i.cached_tokens+i.cache_write_tokens>u.input_tokens||!own(o,['reasoning_tokens'])||!integer(o.reasoning_tokens)||o.reasoning_tokens>u.output_tokens)return null;
 return {inputTokens:u.input_tokens,outputTokens:u.output_tokens,cachedTokens:i.cached_tokens,cacheWriteTokens:i.cache_write_tokens,reasoningTokens:o.reasoning_tokens};
}
export function normaliseOpenaiDecisionResponse(body,questions){
 if(body?.model!==OPENAI_DECISIONS_MODEL||!Array.isArray(body.answers)||body.answers.length!==Object.keys(questions).length)invalid();
 const seen=new Set(),answers={};
 for(const a of body.answers){
  if(!plain(a)||typeof a.name!=='string'||!Object.hasOwn(questions,a.name)||seen.has(a.name))invalid();seen.add(a.name);
  if(a.type==='refusal'){if(!own(a,['name','type']))invalid();throw Error('refusal');}
  const q=questions[a.name];
  if(q.type==='noul'){
   if(!own(a,['type','name','probability'])||a.type!=='predicate'||!probability(a.probability))invalid();
   answers[a.name]={type:'noul',noul:a.probability};continue;
  }
  const keys=q.type==='choice'?Object.keys(q.criteria):q.criteria.map((_,i)=>String(i));
  if(a.type!==q.type||!own(a,['type','name','probabilities','confidence',q.type==='choice'?'choice':'score'])||!probability(a.confidence)||!Array.isArray(a.probabilities)||a.probabilities.length!==keys.length)invalid();
  const probabilities={},legend={};
  for(const p of a.probabilities){
   if(!own(p,q.type==='choice'?['value','probability']:['value','label','probability'])||!probability(p.probability))invalid();
   if(q.type==='choice'?typeof p.value!=='string':!integer(p.value))invalid();
   const k=String(p.value);if(!keys.includes(k)||Object.hasOwn(probabilities,k))invalid();
   if(q.type==='score'&&p.label!==q.criteria[p.value])invalid();
   probabilities[k]=p.probability;if(q.type==='score')legend[k]=p.label;
  }
  if(Math.abs(Object.values(probabilities).reduce((sum,p)=>sum+p,0)-1)>0.001)invalid();
  if(q.type==='choice'){
   if(typeof a.choice!=='string'||!keys.includes(a.choice)||probabilities[a.choice]+1e-9<Math.max(...Object.values(probabilities)))invalid();
   answers[a.name]={type:'choice',choice:a.choice,probabilities,confidence:a.confidence};
  }else{
   const expected=keys.reduce((sum,k)=>sum+Number(k)*probabilities[k],0);
   if(!Number.isFinite(a.score)||a.score<0||a.score>q.criteria.length-1||Math.abs(a.score-expected)>0.01)invalid();
   answers[a.name]={type:'score',score:a.score,probabilities,confidence:a.confidence,legend};
  }
 }
 // Preserve the established operation-facing envelope; the measurement keeps
 // the actual provider/model. This object is never sent back to either vendor.
 return {model:'jev-1.13.0',answers};
}
