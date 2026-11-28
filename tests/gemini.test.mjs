import assert from 'node:assert/strict';
import test from 'node:test';
import {extractAccount,translateReview} from '../server/intelligence.mjs';
import {createCloudHandler} from '../server/cloud.mjs';
import {createAIBudget,AI_LIMITS} from '../server/ai-budget.mjs';
import {aiConfig} from '../server/ai-config.mjs';
const reply=value=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]});
test('Gemini uses its own header and schema, validates excerpts, and never receives audio',async()=>{
  const input='I cut stone in Jodhpur before lockdown.';let called=0;
  const r=await extractAccount(input,{key:'gemini-test-only',provider:'gemini',beforeInference:async()=>{called++;},fetcher:async(url,init)=>{
    assert.match(url,/^https:\/\/generativelanguage\.googleapis\.com\//);assert.equal(init.headers['x-goog-api-key'],'gemini-test-only');assert.equal(init.headers.Authorization,undefined);
    const body=JSON.parse(init.body);assert.equal(body.contents[0].parts[0].text,input);assert.equal(body.generationConfig.maxOutputTokens,1800);assert.equal(body.generationConfig.responseJsonSchema.additionalProperties,false);
    return reply({fields:{place:'Jodhpur',task:'cut stone',period:'2017',landmark:null,alias:'Invented'},language:'en'});
  }});
  assert.equal(called,1);assert.equal(r.method,'model');assert.equal(r.fields.period,null);assert.equal(r.fields.alias,null);assert.equal(r.fields.place,'Jodhpur');assert.deepEqual(r.fields,r.evidence);
});
test('Gemini limits and database failures fall back without calling the model',async()=>{
  for(const status of [429,503]){let calls=0;const r=await extractAccount('Place: Jodhpur',{key:'test',provider:'gemini',beforeInference:async()=>{throw Object.assign(new Error('Blocked'),{status});},fetcher:async()=>{calls++;return reply({});}});
    assert.equal(calls,0);assert.equal(r.method,'rules');assert.equal(r.fields.place,'Jodhpur');assert.equal(r.reason,status===429?'limit-reached':'model-unavailable');}
  let calls=0;await assert.rejects(extractAccount('x'.repeat(12001),{key:'test',provider:'gemini',beforeInference:async()=>{calls++;}}),{status:400});assert.equal(calls,0);
});
test('Gemini rejects blocked, truncated and malformed replies',async()=>{
  for(const value of [{candidates:[]},{candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{}'}]}}]},{candidates:[{finishReason:'STOP',content:{parts:[{text:'bad json'}]}}]}]){
    const r=await extractAccount('Place: Jodhpur',{key:'test',provider:'gemini',fetcher:async()=>Response.json(value)});assert.equal(r.method,'rules');assert.equal(r.fields.place,'Jodhpur');}
});
test('Gemini translation preserves unknown fields and never mutates the original',async()=>{
  const original={place:'Jodhpur',task:'cut stone',period:null,landmark:null,alias:null};
  const r=await translateReview(original,'hi',{key:'test',provider:'gemini',fetcher:async()=>reply({...original,task:'पत्थर काटना',period:'invented'})});assert.equal(r.available,true);assert.equal(r.fields.period,null);assert.equal(original.task,'cut stone');
});
test('Quoted unknown answers stay blank in English, Hindi and Kannada',async()=>{
  for(const phrase of ['I cannot remember the year','साल याद नहीं','साल पता नहीं','ಯಾವ ವರ್ಷ ಮತ್ತು ಕಂಪನಿಯ ಹೆಸರು ನೆನಪಿಲ್ಲ']){
    const r=await extractAccount(phrase,{key:'test',provider:'gemini',fetcher:async()=>reply({fields:{place:null,task:null,period:phrase,landmark:null,alias:null},language:'kn'})});
    assert.equal(r.method,'model');assert.equal(r.fields.period,null);assert.equal(r.evidence.period,null);
  }
});
test('AI configuration needs explicit demo permission and keeps provider keys separate',()=>{
  const env={WORKECHO_AI_ENABLED:'1',WORKECHO_AI_PROVIDER:'gemini',GEMINI_API_KEY:'google-only',OPENAI_API_KEY:'openai-only'};
  assert.equal(aiConfig(env).key,'google-only');assert.equal(aiConfig(env,{demo:true}).key,'');assert.equal(aiConfig({...env,WORKECHO_DEMO_AI_ENABLED:'1'},{demo:true}).key,'google-only');assert.equal(aiConfig({...env,WORKECHO_AI_ENABLED:'0'}).key,'');
});
test('Gemini capability cannot enable OpenAI embeddings; declined AI consumes no quota',async()=>{
  let providerCalls=0,quota=0;const id='00000000-0000-0000-0000-000000000001';
  const handler=createCloudHandler({origin:'https://test.example',aiKey:'google-test',aiProvider:'gemini',aiGate:async()=>{quota++;},rpc:async action=>action==='session'?{active:true}:action==='intake_get'?{id}:Promise.reject(new Error('Unexpected RPC '+action)),fetcher:async()=>{providerCalls++;return reply({fields:{place:'Jodhpur',task:null,period:null,landmark:null,alias:null},language:'en'});}});
  const state=await(await handler(new Request('https://test.example/api/session'))).json();assert.equal(state.aiProvider,'gemini');assert.equal(state.analysisAvailable,true);assert.equal(state.embeddingsAvailable,false);
  for(const allowAI of [false,true]){const r=await handler(new Request('https://test.example/api/intakes/'+id+'/extract',{method:'POST',headers:{origin:'https://test.example',cookie:'we_cloud_worker=worker','content-type':'application/json'},body:JSON.stringify({transcript:'Place: Jodhpur',allowAI})}));assert.equal(r.status,200);}
  assert.equal(providerCalls,1);assert.equal(quota,1);
});
test('AI session, address, daily and lifetime caps remain bounded',async()=>{
  let now=1700000000000;const gate=createAIBudget({now:()=>now});
  for(let i=0;i<AI_LIMITS.session;i++)await gate({session:'one',ip:'one'});
  await assert.rejects(gate({session:'one',ip:'one'}),{status:429});
  const byIP=createAIBudget({now:()=>now});for(let i=0;i<AI_LIMITS.ip;i++)await byIP({session:String(i),ip:'one'});await assert.rejects(byIP({session:'new',ip:'one'}),{status:429});
  const global=createAIBudget({now:()=>now});for(let day=0;day<4;day++){for(let i=0;i<AI_LIMITS.day;i++)await global({session:day+':'+i,ip:day+':'+i});await assert.rejects(global({session:'next',ip:'next'}),{status:429});now+=86400000;}
  await assert.rejects(global({session:'after-total',ip:'after-total'}),{status:429});
});
