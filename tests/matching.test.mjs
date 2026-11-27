import assert from 'node:assert/strict';
import {test} from 'node:test';
import {semanticScores,cosine} from '../server/matching.mjs';
import {compare} from '../server/staff-demo.mjs';
test('embeddings require both permissions, batch eligible text and reuse bounded cache',async()=>{
  const item=(id,aiAllowed=true)=>({id,worker:id,matching:true,source:{aiAllowed},fields:{place:'Jodhpur',task:'cut stone',period:null,landmark:'rail crossing',alias:'Raju shed'}});
  const records=[item('a'),item('b'),item('private',false),{...item('unshared'),matching:false}];let calls=0;
  const fetcher=async(url,init)=>{calls++;assert.equal(url,'https://api.openai.com/v1/embeddings');const input=JSON.parse(init.body).input;assert.equal(input.length,1);return Response.json({data:input.map((_,index)=>({index,embedding:Array(256).fill(0).map((_,i)=>i===0?1:0)}))});};
  assert.equal((await semanticScores(records,{key:'' ,fetcher})).size,0);assert.equal(calls,0);
  const scores=await semanticScores(records,{key:'test-batch',fetcher});assert.equal(scores.get('a:b'),1);assert.equal(scores.size,1);
  await semanticScores(records,{key:'test-batch',fetcher});assert.equal(calls,1);
  assert.equal(cosine([1,0],[0,1]),0);assert.equal(cosine([0],[0]),null);assert.equal(cosine([NaN],[1]),null);
  assert.equal(compare(records[0],{fields:{...records[1].fields,place:'Jaipur'}}).eligible,false);
});
test('model rate limits leave deterministic review available',async()=>{
  const fields={place:'Jodhpur',task:null,period:null,landmark:'crossing',alias:null};
  const rows=['a','b'].map(id=>({id,worker:id,matching:true,fields,source:{aiAllowed:true}}));
  assert.equal((await semanticScores(rows,{key:'rate-limit-test',fetcher:async()=>new Response('',{status:429})})).size,0);
  assert.equal(compare(rows[0],rows[1]).eligible,true);
});
