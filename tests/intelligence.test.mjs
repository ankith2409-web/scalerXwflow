import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractAccount } from '../server/intelligence.mjs';
import { createCloudHandler } from '../server/cloud.mjs';

test('labelled import preserves uncertain dates and never guesses missing fields',async()=>{
  const result=await extractAccount('Place: Jodhpur\nWork: Cut stone\nTime: Before lockdown, for two monsoons',{key:''});
  assert.equal(result.fields.period,'Before lockdown, for two monsoons');
  assert.equal(result.fields.alias,null); assert.equal(result.needsReview,true);
  assert.deepEqual(result.evidence,result.fields);
  const plain=await extractAccount('I worked somewhere before lockdown.',{key:''});
  assert.ok(Object.values(plain.fields).every(value=>value===null));
});
test('AI proposals discard hallucinations and quote only source evidence',async()=>{
  const result=await extractAccount('I cut stone near Jodhpur before lockdown.',{key:'test',fetcher:async()=>Response.json({choices:[{message:{content:JSON.stringify({place:'Jodhpur',task:'cut stone',period:'2018–2020',landmark:'railway crossing',alias:null})}}]})});
  assert.equal(result.fields.place,'Jodhpur'); assert.equal(result.fields.period,null); assert.equal(result.fields.landmark,null);
  await assert.rejects(extractAccount('account',{key:'test',fetcher:async()=>new Response('',{status:429})}),{status:503});
  await assert.rejects(extractAccount('x'.repeat(12001),{key:''}),{status:400});
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
