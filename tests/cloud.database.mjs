// Run with PGLITE_ROOT pointing to an installed @electric-sql/pglite (0.3.16).
// Exercises the production SQL and HTTP handler together against PostgreSQL WASM.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createCloudHandler } from '../server/cloud.mjs';
import {featureContract} from './features-contract.mjs';
import {createAIBudget} from '../server/ai-budget.mjs';
const root=process.env.PGLITE_ROOT;
if(!root) throw new Error('Set PGLITE_ROOT to the @electric-sql/pglite installation directory.');
const {PGlite}=await import(pathToFileURL(root+'/dist/index.js').href);
const {pgcrypto}=await import(pathToFileURL(root+'/dist/contrib/pgcrypto.js').href);
const db=new PGlite({extensions:{pgcrypto}});
const hash=s=>createHash('sha256').update(s).digest('hex');
try {
  await db.exec('create schema extensions; create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(await readFile(new URL('../database/workecho.sql',import.meta.url),'utf8'));
  const setup=randomBytes(32).toString('base64url');
  await db.query('insert into public.we_settings values ($1,$2)',['bootstrap_hash',hash(setup)]);
  const handler=createCloudHandler({origin:'https://workecho.test',rpc:async(action,credential='',input={})=>{
    try { return (await db.query('select public.we_api($1,$2,$3::jsonb) as value',[action,credential,JSON.stringify(input)])).rows[0].value; }
    catch(error){const match=/^(\d{3})\|(.+)$/.exec(error.message);if(match){error.status=Number(match[1]);error.message=match[2];}else console.error('SQL action',action,error.message,error.detail??'',error.where??'');throw error;}
  }});
  const client=()=>{ const jar=new Map(); return async(path,method='GET',data)=>{
    const response=await handler(new Request('https://workecho.test'+path,{method,headers:{origin:'https://workecho.test','content-type':'application/json',cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},body:data?JSON.stringify(data):undefined}));
    for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(';');const i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}
    return response.headers.get('content-type')?.includes('application/json')?{status:response.status,data:await response.json()}:{status:response.status,bytes:Buffer.from(await response.arrayBuffer())};
  };};
  const a=client(), b=client(), staff=client(), stranger=client();
  const fields={place:'Jodhpur',task:'Cut stone slabs',period:'Before lockdown, for two monsoons',landmark:'Railway crossing',alias:'Raju shed'};
  async function worker(call,sharing=true){
    const start=await call('/api/intakes','POST',{language:'en',save:true,voice:false,matching:sharing,outreach:sharing});
    assert.equal(start.status,201,JSON.stringify(start));
    const payload={fields,evidence:fields,confirmed:true,operation:randomUUID()};
    const saved=await call('/api/intakes/'+start.data.id+'/confirm','POST',payload);
    assert.equal(saved.status,200,JSON.stringify(saved));
    assert.deepEqual(await call('/api/intakes/'+start.data.id+'/confirm','POST',payload),saved);
    return {...saved.data,code:start.data.code};
  }
  const first=await worker(a), second=await worker(b); await worker(stranger,false);
  for(const [initial,final] of [[true,false],[false,true]]){
    const call=client();
    const start=await call('/api/intakes','POST',{language:'kn',save:true,voice:false,matching:initial,outreach:initial});
    const source={kind:'wispr-dictation',text:Object.values(fields).join('\n'),aiAllowed:true,aiProvider:'gemini'};
    const data={language:'kn',mode:'story',page:'review',step:0,source,fields,evidence:fields,permissions:{matching:final,outreach:false}};
    const payload={version:0,operation:randomUUID(),data};const path='/api/intakes/'+start.data.id+'/draft';
    const draft=await call(path,'POST',payload);assert.equal(draft.status,200,JSON.stringify(draft));assert.equal(draft.data.version,1);
    assert.deepEqual((await call(path,'POST',payload)).data,draft.data);
    assert.equal((await call(path,'POST',{...payload,operation:randomUUID()})).status,409);
    assert.equal((await call('/api/draft')).data.data.language,'kn');
    assert.equal((await call('/api/draft')).data.data.source.aiProvider,'gemini');
    assert.equal((await stranger(path,'DELETE')).status,404);
    const confirmed={fields,evidence:fields,source,permissions:{matching:final,outreach:false},confirmed:true,operation:randomUUID()};
    const saved=await call('/api/intakes/'+start.data.id+'/confirm','POST',confirmed);
    assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.data.permissions.matching,final);assert.equal(saved.data.source.text,source.text);
    assert.equal(saved.data.source.aiProvider,'gemini');
    assert.equal((await call('/api/draft')).data,null);
    assert.equal((await call(path,'POST',{...payload,version:1,operation:randomUUID()})).status,409);
    assert.equal((await call('/api/intakes/'+start.data.id+'/confirm','POST',{...confirmed,permissions:{matching:!final,outreach:false}})).status,409);
    if(final)await call('/api/history/'+saved.data.id+'/sharing','DELETE');
  }
  assert.equal((await a('/api/staff/records')).status,401);
  assert.equal((await b('/api/history/'+first.id,'PATCH',{fields,confirmed:true,operation:randomUUID(),version:1})).status,404);
  const signin=await staff('/api/staff/session','POST',{email:'admin@example.test',password:'a long test password',setupCode:setup});
  assert.equal(signin.status,200,JSON.stringify(signin));
  assert.equal((await staff('/api/staff/accounts','POST',{email:'reviewer@example.test',password:'a reviewer test password',role:'reviewer'})).status,201);
  const reviewer=client();assert.equal((await reviewer('/api/staff/session','POST',{email:'reviewer@example.test',password:'a reviewer test password'})).status,200);
  assert.equal((await reviewer('/api/staff/accounts','POST',{email:'forbidden@example.test',password:'an unwanted account password',role:'admin'})).status,403);
  const shared=await staff('/api/staff/records');assert.equal(shared.status,200,JSON.stringify(shared));assert.equal(shared.data.length,2);
  const candidates=await staff('/api/staff/matches');assert.equal(candidates.status,200,JSON.stringify(candidates));assert.equal(candidates.data.length,1);
  const c=candidates.data[0];
  assert.equal((await staff('/api/staff/matches/'+c.id+'/decision','POST',{status:'accepted',reason:'Details agree.',version:0,operation:randomUUID()})).status,200);
  const target=first.id+':1:direct';
  const move=(status,version,healthApproval=false)=>staff('/api/staff/referrals/'+target+'/transition','POST',{status,version,healthApproval,reason:'Staff logged an action.',operation:randomUUID()});
  assert.equal((await move('draft',1)).status,200);
  assert.equal((await move('approved',1)).status,403);
  assert.equal((await reviewer('/api/staff/referrals/'+target+'/transition','POST',{status:'approved',version:1,healthApproval:true,reason:'Attempt approval as reviewer.',operation:randomUUID()})).status,403);
  assert.equal((await move('approved',1,true)).status,200);
  assert.equal((await move('scheduled',2)).status,409);
  assert.equal((await move('invited',2)).status,200);
  const withdrawal=await a('/api/history/'+first.id+'/sharing','DELETE');assert.equal(withdrawal.status,200,JSON.stringify(withdrawal));
  assert.equal((await staff('/api/staff/records')).data.length,1);
  assert.equal((await staff('/api/staff/referrals')).data[0].status,'cancelled');
  assert.equal((await move('responded',3)).status,404);
  await b('/api/session','DELETE');
  const recovered=client();assert.equal((await recovered('/api/session/restore','POST',{code:second.code})).status,200);
  assert.equal((await recovered('/api/history')).data[0].id,second.id);
  const revision=await recovered('/api/history/'+second.id,'PATCH',{fields:{...fields,task:'Polished stone'},confirmed:true,operation:randomUUID(),version:1});
  assert.equal(revision.status,200,JSON.stringify(revision));
  assert.equal((await recovered('/api/history/'+second.id,'PATCH',{fields,confirmed:true,operation:randomUUID(),version:1})).status,409);
  assert.equal((await staff('/api/staff/matches')).data.length,0);
  await db.exec('set role anon;');
  await assert.rejects(db.query('select * from public.we_histories'));
  await assert.rejects(db.query("select public.we_api('history','','{}')"));
  await db.exec('reset role;');
  await db.exec(await readFile(new URL('../database/migrations/002-workflow-quality.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../database/migrations/003-privacy-and-search.sql',import.meta.url),'utf8'));
  assert.equal((await recovered('/api/history')).data[0].fields.task,'Polished stone');
  const duplicateStaff=client();assert.equal((await duplicateStaff('/api/staff/session','POST',{email:'admin@example.test',password:'a long test password'})).status,200);
  assert.equal((await staff('/api/staff/password','POST',{currentPassword:'wrong',password:'replacement test password'})).status,401);
  assert.equal((await staff('/api/staff/password','POST',{currentPassword:'a long test password',password:'replacement test password'})).status,200);
  assert.equal((await duplicateStaff('/api/staff/session')).data.active,false);
  assert.equal((await reviewer('/api/staff/session')).data.active,true);
  const oldLogin=client();assert.equal((await oldLogin('/api/staff/session','POST',{email:'admin@example.test',password:'a long test password'})).status,401);
  assert.equal((await oldLogin('/api/staff/session','POST',{email:'admin@example.test',password:'replacement test password'})).status,200);
  await db.query(`with jobs as (insert into public.we_intakes(worker_id,language,voice,matching,outreach)
    select (select worker_id from public.we_histories where id=$1),'en',false,false,true from generate_series(1,230) returning id,worker_id)
    insert into public.we_histories(intake_id,worker_id,fields,evidence,matching,outreach,operation,fingerprint)
    select id,worker_id,'{"place":"Archiveplace","task":"Archived unique query","period":null,"landmark":null,"alias":null}'::jsonb,'{}',false,true,gen_random_uuid(),'synthetic-test' from jobs`,[second.id]);
  const search=await staff('/api/staff/search?query=Archived%20unique&page=0');assert.equal(search.status,200,JSON.stringify(search));assert.equal(search.data.total,230);assert.equal(search.data.records.length,25);
  assert.equal((await staff('/api/staff/search?query=Archived%20unique&page=9')).data.records.length,5);
  assert.equal((await staff('/api/staff/search?query=%25&page=0')).data.total,0);
  assert.equal((await stranger('/api/staff/search')).status,401);
  assert.equal((await staff('/api/staff/search?page=-1')).status,400);
  const extra=client(),extraRecord=await worker(extra);
  const extraDevice=client();assert.equal((await extraDevice('/api/session/restore','POST',{code:extraRecord.code})).status,200);
  const replacement=await extra('/api/session/recovery-code','POST');assert.equal(replacement.status,200);
  assert.equal((await extraDevice('/api/history')).status,401);
  assert.equal((await client()('/api/session/restore','POST',{code:extraRecord.code})).status,401);
  assert.equal((await client()('/api/session/restore','POST',{code:replacement.data.code})).status,200);
  const extraTarget=extraRecord.id+':1:direct';
  assert.equal((await staff('/api/staff/referrals/'+extraTarget+'/transition','POST',{status:'draft',version:1,reason:'Fictional deletion test.',operation:randomUUID()})).status,200);
  assert.equal((await staff('/api/staff/search?query=Jodhpur&page=0')).data.records.find(row=>row.id===extraTarget).referral,true);
  assert.equal((await stranger('/api/history/'+extraRecord.id,'DELETE',{confirmed:true,version:1})).status,404);
  assert.equal((await extra('/api/history/'+extraRecord.id,'DELETE',{confirmed:true,version:2})).status,409);
  assert.equal((await extra('/api/history/'+extraRecord.id,'DELETE',{confirmed:true,version:1})).status,200);
  assert.deepEqual((await extra('/api/history')).data,[]);
  for(const table of ['we_sources','we_revisions','we_referrals'])assert.equal((await db.query(`select count(*)::int as n from public.${table} where history_id=$1`,[extraRecord.id])).rows[0].n,0);
  console.log('Maintenance checks passed: >200 record search, pagination, literal search, password changes, session revocation, versioned private deletion and linked-data cleanup.');
  await db.exec(await readFile(new URL('../database/migrations/004-workspace-features.sql',import.meta.url),'utf8'));
  await featureContract({worker:client(),staff,stranger:client()});
  const sandboxHash=hash('isolated synthetic sandbox');
  const sandbox=async(action,payload='',version=0)=>(await db.query('select public.we_sandbox_api($1,$2,$3,$4) as value',[action,sandboxHash,payload,version])).rows[0].value;
  assert.equal(await sandbox('read'),null);assert.equal((await sandbox('write','encrypted synthetic fixture')).version,1);
  assert.equal((await sandbox('read')).payload,'encrypted synthetic fixture');
  await assert.rejects(()=>sandbox('write','conflicting fixture'),/409/);
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>db.query('select public.we_feature_api($1,$2)', ['','{}']),/permission denied/);await assert.rejects(()=>db.query('select * from public.we_feature_items'),/permission denied/);await assert.rejects(()=>db.query('select * from public.we_sandboxes'),/permission denied/);await db.exec('reset role');}
  console.log('PostgreSQL checks passed: separate clients, privacy, bootstrap login, matching, referral approval, withdrawal, recovery, revision conflicts, and denied anonymous database access.');
  const query=(sql,args)=>db.query(sql,args),stamp=Date.now();
  const makeGate=()=>createAIBudget({query,now:()=>stamp});
  const firstGate=makeGate();for(let i=0;i<10;i++)await firstGate({session:'quota-worker',ip:'quota-address'});
  // A new application instance shares the same counters. Existing RPC cleanup must preserve them.
  await db.query('select public.we_api($1,$2,$3)', ['session','','{}']);
  await assert.rejects(makeGate()({session:'quota-worker',ip:'quota-address'}),{status:429});
  const attempts=await Promise.allSettled(Array.from({length:50},(_,i)=>makeGate()({session:'parallel-'+i,ip:'parallel-'+i})));
  assert.ok(attempts.filter(x=>x.status==='fulfilled').length<=39,'Global durable daily quota stays bounded under concurrent callers');
  const counters=(await db.query("select key,uses from public.we_limits where key like 'daily:workecho-ai:%'" )).rows;
  assert.ok(counters.find(x=>x.key==='daily:workecho-ai:project').uses<=50);
  assert.ok(counters.find(x=>x.key==='daily:workecho-ai:total').uses<=200);
  console.log('Durable AI quota passed: shared across instances, preserved by RPC cleanup, session and concurrent global limits, no schema migration.');
} catch(error) { console.error('PostgreSQL verification failed:',error.message,error.detail??'',error.where??'',error.position??'',error.internalQuery??''); if(error.query && error.position)console.error(error.query.slice(Math.max(0,Number(error.position)-120),Number(error.position)+120)); process.exitCode=1; }
finally {await db.close();}
