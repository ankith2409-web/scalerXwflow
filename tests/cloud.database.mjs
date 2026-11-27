// Run with PGLITE_ROOT pointing to an installed @electric-sql/pglite (0.3.16).
// Exercises the production SQL and HTTP handler together against PostgreSQL WASM.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createCloudHandler } from '../server/cloud.mjs';
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
    return {status:response.status,data:await response.json()};
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
  console.log('PostgreSQL checks passed: separate clients, privacy, bootstrap login, matching, referral approval, withdrawal, recovery, revision conflicts, and denied anonymous database access.');
} catch(error) { console.error('PostgreSQL verification failed:',error.message,error.detail??'',error.where??'',error.position??'',error.internalQuery??''); if(error.query && error.position)console.error(error.query.slice(Math.max(0,Number(error.position)-120),Number(error.position)+120)); process.exitCode=1; }
finally {await db.close();}
