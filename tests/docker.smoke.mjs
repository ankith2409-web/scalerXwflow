import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const origin=process.env.WORKECHO_TEST_ORIGIN || 'http://localhost:3000';
const jar=new Map();
async function call(path,method='GET',data){
  const response=await fetch(origin+path,{method,headers:{origin,'content-type':'application/json',cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},body:data?JSON.stringify(data):undefined});
  for(const item of response.headers.getSetCookie()){const [pair]=item.split(';');const i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}
  const value=await response.json();assert.ok(response.ok,path+': '+JSON.stringify(value));return value;
}
assert.equal((await fetch(origin)).status,200);
assert.equal((await call('/api/session')).analysisAvailable,false);
const intake=await call('/api/intakes','POST',{language:'en',save:true,voice:false,matching:false,outreach:false});
const source={kind:'example',text:'I cut stone slabs at Raju shed near the railway crossing in Jodhpur for two monsoons before lockdown.'};
const proposal=await call('/api/intakes/'+intake.id+'/extract','POST',{transcript:source.text,allowAI:false});
assert.equal(proposal.fields.place,'Jodhpur');
const saved=await call('/api/intakes/'+intake.id+'/confirm','POST',{confirmed:true,operation:randomUUID(),fields:proposal.fields,evidence:proposal.evidence,source,permissions:{matching:false,outreach:false}});
assert.equal((await call('/api/history'))[0].source.text,source.text);
await call('/api/session','DELETE');await call('/api/session/restore','POST',{code:intake.code});
assert.equal((await call('/api/history'))[0].id,saved.id);
console.log('Keyless container passed: main screen, natural-text extraction, confirmation, source storage, session closure and recovery.');
