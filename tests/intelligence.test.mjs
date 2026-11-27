import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractAccount, translateReview } from '../server/intelligence.mjs';
import { createCloudHandler } from '../server/cloud.mjs';

test('labelled import preserves uncertain dates and never guesses missing fields',async()=>{
  const result=await extractAccount('Place: Jodhpur\nWork: Cut stone\nTime: Before lockdown, for two monsoons',{key:''});
  assert.equal(result.fields.period,'Before lockdown, for two monsoons');
  assert.equal(result.fields.alias,null); assert.equal(result.needsReview,true);
  assert.deepEqual(result.evidence,result.fields);
  const plain=await extractAccount('I worked somewhere before lockdown.',{key:''});
  assert.equal(plain.fields.place,null); assert.equal(plain.fields.period,'before lockdown');
});
test('AI proposals discard hallucinations and quote only source evidence',async()=>{
  const result=await extractAccount('I cut stone near Jodhpur before lockdown.',{key:'test',fetcher:async()=>Response.json({choices:[{message:{content:JSON.stringify({place:'Jodhpur',task:'cut stone',period:'2018–2020',landmark:'railway crossing',alias:null})}}]})});
  assert.equal(result.fields.place,'Jodhpur'); assert.equal(result.fields.period,null); assert.equal(result.fields.landmark,null);
  const unavailable=await extractAccount('account',{key:'test',fetcher:async()=>new Response('',{status:429})});
  assert.equal(unavailable.reason,'model-unavailable'); assert.equal(unavailable.method,'rules');
  await assert.rejects(extractAccount('x'.repeat(12001),{key:''}),{status:400});
});

test('natural story yields exact source excerpts without a model key',async()=>{
  const text='I cut stone slabs at Raju shed near the railway crossing in Jodhpur for two monsoons before lockdown.';
  const result=await extractAccount(text,{key:''});
  assert.deepEqual(result.fields,{place:'Jodhpur',task:'cut stone slabs',period:'two monsoons before lockdown',landmark:'railway crossing',alias:'Raju shed'});
  assert.deepEqual(result.missing,[]);assert.equal(result.method,'rules');
  for(const value of Object.values(result.fields))assert.ok(text.includes(value));
});

test('Hindi and Kannada labels preserve source script and unknown details',async()=>{
  for(const [text,place,language] of [['स्थान: जोधपुर\nकाम: पत्थर काटना','जोधपुर','hi'],['ಸ್ಥಳ: ಜೋಧಪುರ\nಕೆಲಸ: ಕಲ್ಲು ಕತ್ತರಿಸುವುದು','ಜೋಧಪುರ','kn']]){
    const result=await extractAccount(text,{key:''});assert.equal(result.fields.place,place);assert.equal(result.language,language);assert.equal(result.fields.alias,null);
  }
});

test('translations are separate, preserve nulls and fall back on refusal or malformed replies',async()=>{
  const fields={place:'Jodhpur',task:'cut stone',period:'two monsoons',landmark:null,alias:null};
  let called=0;
  const fetcher=async()=>{called++;return Response.json({choices:[{message:{content:JSON.stringify({...fields,task:'पत्थर काटना',landmark:'invented'})}}]});};
  const none=await translateReview(fields,'hi',{key:'',fetcher});assert.equal(none.available,false);assert.equal(called,0);
  const translated=await translateReview(fields,'hi',{key:'test',fetcher});assert.equal(translated.fields.landmark,null);assert.equal(fields.task,'cut stone');assert.equal(translated.fields.task,'पत्थर काटना');
  for(const message of [{refusal:'Unavailable'},{content:'invalid JSON'}]){
    const result=await translateReview(fields,'kn',{key:'test',fetcher:async()=>Response.json({choices:[{message}]})});assert.equal(result.available,false);assert.deepEqual(result.fields,fields);
  }
});
test('cloud requests enforce origin, ownership, confirmation and server-side staff authorization',async()=>{
  const calls=[];
  const handler=createCloudHandler({origin:'https://workecho.test',rpc:async(action,credential,input)=>{
    calls.push({action,credential,input});
    if(action==='staff_session')return {active:false};
    if(action==='session')return {active:credential==='worker'};
    if(action==='history'&&credential!=='worker'){const error=new Error('Sign in');error.status=401;throw error;}
    if(action==='history')return [{id:'owned'}];
    throw new Error('Unexpected RPC action '+action);
  }});
  const req=(path,method='GET',data,cookie='')=>handler(new Request('https://workecho.test'+path,{method,headers:{origin:'https://workecho.test',cookie,'content-type':'application/json'},body:data?JSON.stringify(data):undefined}));
  assert.equal((await req('/api/staff/records')).status,401);
  assert.equal((await req('/api/history')).status,401);
  assert.deepEqual(await (await req('/api/history','GET',null,'we_cloud_worker=worker')).json(),[{id:'owned'}]);
  assert.equal((await handler(new Request('https://workecho.test/api/intakes',{method:'POST',headers:{origin:'https://evil.test'}}))).status,403);
  assert.equal((await req('/api/intakes/00000000-0000-0000-0000-000000000001/confirm','POST',{confirmed:false,fields:{place:'Jodhpur',task:null,period:null,landmark:null,alias:null}})).status,400);
  assert.equal(calls.some(x=>x.action==='confirm'),false);
});

test('keyless suggestions do not consume the paid provider budget',async()=>{
  const id='00000000-0000-0000-0000-000000000001';
  for(const [aiKey,allowAI,expected] of [['',false,0],['',true,0],['test',false,0],['test',true,1]]){
    let reserved=0,providerCalls=0;
    const handler=createCloudHandler({origin:'https://workecho.test',aiKey,rpc:async(action,credential)=>{
      assert.equal(credential,'worker');if(action==='intake_get')return {id};if(action==='reserve'){reserved++;return {}; }throw Error('Unexpected RPC '+action);
    },fetcher:async()=>{providerCalls++;return Response.json({choices:[{message:{content:JSON.stringify({fields:{place:'Jodhpur',task:null,period:null,landmark:null,alias:null},language:'en'})}}]});}});
    const response=await handler(new Request('https://workecho.test/api/intakes/'+id+'/extract',{method:'POST',headers:{origin:'https://workecho.test',cookie:'we_cloud_worker=worker','content-type':'application/json'},body:JSON.stringify({transcript:'Place: Jodhpur',allowAI})}));
    assert.equal(response.status,200);assert.equal(reserved,expected);assert.equal(providerCalls,expected);
  }
});
