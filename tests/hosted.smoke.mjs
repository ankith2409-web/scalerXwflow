import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
// All writes stay in isolated, encrypted, short-lived demo snapshots. Never writes real worker records.
const origin='https://workecho-psi.vercel.app', jar=new Map();
async function call(path,method='GET',data,expected=200,source=origin){
  const response=await fetch(origin+path,{method,headers:{origin:source,'content-type':'application/json',cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(30000)});
  for(const value of response.headers.getSetCookie()){const [pair]=value.split(';');const i=pair.indexOf('=');if(pair.slice(i+1))jar.set(pair.slice(0,i),pair.slice(i+1));else jar.delete(pair.slice(0,i));}
  const result=await response.json();assert.equal(response.status,expected,path+': '+JSON.stringify(result));return result;
}
assert.equal((await fetch(origin)).status,200);
const session=await call('/api/session');assert.equal(session.cloud,true);assert.equal(typeof session.analysisAvailable,'boolean');assert.equal(session.embeddingsAvailable,false);
if(session.analysisAvailable)assert.equal(session.aiProvider,'gemini');
assert.match((await call('/api/history','GET',undefined,401)).error,/Open your work history/);
assert.match((await call('/api/staff/search?query=Jodhpur&page=1','GET',undefined,401)).error,/Sign in/);
await call('/api/staff/matches','GET',undefined,401);
await call('/api/features/workplaces','GET',undefined,401);await call('/api/features/timeline','GET',undefined,401);
await call('/api/session','DELETE',undefined,403,'https://untrusted.example');
assert.equal((await call('/api/demo/wispr/status')).available,false);
const job=await call('/api/demo/intakes','POST',{language:'kn',save:true,voice:false,matching:false,outreach:false},201);
const source={kind:'example',text:'I cut stone slabs at Raju shed near the railway crossing in Jodhpur for two monsoons before lockdown.'};
const result=await call('/api/demo/intakes/'+job.id+'/extract','POST',{transcript:source.text,allowAI:false});assert.equal(result.fields.place,'Jodhpur');
const payload={confirmed:true,operation:randomUUID(),fields:result.fields,evidence:result.evidence,source,permissions:{matching:true,outreach:true}};
const saved=await call('/api/demo/intakes/'+job.id+'/confirm','POST',payload);assert.equal(saved.permissions.matching,true);assert.equal(saved.source.text,source.text);
await call('/api/demo/staff/session','POST');const overview=await call('/api/demo/staff/overview');assert.ok(overview.matches.length>0);
assert.equal(overview.fictional.workers,43);assert.ok(overview.matches.length>=100);
const featurePath='/api/demo/features/history/'+saved.id;
const directory=await call('/api/demo/features/workplaces','POST',{id:randomUUID(),version:0,data:{name:'Fictional smoke-test workplace',aliases:['Synthetic yard'],locality:'Fictional test area',status:'reviewed',reason:'Fictional hosted smoke-test review.',location:null}});
await call(featurePath+'/details','PATCH',{version:0,historyVersion:1,data:{startYear:2015,endYear:2017,certainty:'approximate',ongoing:false,location:null}});
await call(featurePath+'/link','PATCH',{version:0,historyVersion:1,data:{workplaceId:directory.id,reason:'Fictional hosted smoke-test link.'}});
const pack=await call(featurePath+'?view=staff');
await call(featurePath+'/case','PATCH',{version:0,historyVersion:1,data:{assigneeId:pack.members[0].id,nextAction:'Synthetic test only; no outreach.',dueDate:'2026-11-27',status:'open'}});
assert.equal((await call('/api/demo/features/cases')).total,1);
const file=await call(featurePath+'/attachments','POST',{operation:randomUUID(),historyVersion:1,filename:'synthetic-test.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4\nSynthetic file only\n%%EOF').toString('base64'),caption:'Fictional test',shared:false});
assert.equal((await call(featurePath)).attachments.length,1);assert.equal((await call(featurePath+'?view=staff')).attachments.length,0);
assert.equal((await call('/api/demo/features/timeline')).some(x=>x.kind==='details'),true);
await call('/api/demo/history/'+saved.id+'/sharing','DELETE');assert.equal((await call('/api/demo/history'))[0].sharing,false);
assert.equal((await call('/api/demo/features/cases')).total,0);
await call('/api/demo/history/'+saved.id,'DELETE',{confirmed:true,version:saved.version});assert.deepEqual(await call('/api/demo/history'),[]);
await call('/api/demo/session','DELETE');await call('/api/demo/history','GET',undefined,401);
assert.equal(jar.has('we_cloud_worker'),false);
console.log('Hosted smoke passed: public UI, private-route denial, advertised AI mode with opt-out, isolated capture, directory/link, dates, private attachment, assigned case, withdrawal and deletion.');
