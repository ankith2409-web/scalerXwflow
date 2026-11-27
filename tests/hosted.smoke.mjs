import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
// All writes stay in isolated, short-lived demo cookies. Never writes Neon worker records.
const origin='https://workecho-psi.vercel.app', jar=new Map();
async function call(path,method='GET',data,expected=200){
  const response=await fetch(origin+path,{method,headers:{origin,'content-type':'application/json',cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(30000)});
  for(const value of response.headers.getSetCookie()){const [pair]=value.split(';');const i=pair.indexOf('=');if(pair.slice(i+1))jar.set(pair.slice(0,i),pair.slice(i+1));else jar.delete(pair.slice(0,i));}
  const result=await response.json();assert.equal(response.status,expected,path+': '+JSON.stringify(result));return result;
}
assert.equal((await fetch(origin)).status,200);
const session=await call('/api/session');assert.equal(session.cloud,true);assert.equal(session.analysisAvailable,false);assert.equal(session.embeddingsAvailable,false);
await call('/api/history','GET',undefined,401);
assert.equal((await call('/api/demo/wispr/status')).available,false);
const job=await call('/api/demo/intakes','POST',{language:'kn',save:true,voice:false,matching:false,outreach:false},201);
const source={kind:'example',text:'I cut stone slabs at Raju shed near the railway crossing in Jodhpur for two monsoons before lockdown.'};
const result=await call('/api/demo/intakes/'+job.id+'/extract','POST',{transcript:source.text,allowAI:false});assert.equal(result.fields.place,'Jodhpur');
const payload={confirmed:true,operation:randomUUID(),fields:result.fields,evidence:result.evidence,source,permissions:{matching:true,outreach:true}};
const saved=await call('/api/demo/intakes/'+job.id+'/confirm','POST',payload);assert.equal(saved.permissions.matching,true);assert.equal(saved.source.text,source.text);
await call('/api/demo/staff/session','POST');const overview=await call('/api/demo/staff/overview');assert.ok(overview.matches.length>0);
await call('/api/demo/history/'+saved.id+'/sharing','DELETE');assert.equal((await call('/api/demo/history'))[0].sharing,false);
await call('/api/demo/history/'+saved.id,'DELETE',{confirmed:true,version:saved.version});assert.deepEqual(await call('/api/demo/history'),[]);
await call('/api/demo/session','DELETE');await call('/api/demo/history','GET',undefined,401);
assert.equal(jar.has('we_cloud_worker'),false);
console.log('Hosted smoke passed: public UI, private-route denial, AI disabled, isolated natural-story capture, final sharing, source preservation, staff demo and withdrawal.');
