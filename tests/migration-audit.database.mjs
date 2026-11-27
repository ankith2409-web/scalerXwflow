// Confirms that installing migration 004 leaves every existing application row unchanged.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=process.env.PGLITE_ROOT;if(!root)throw new Error('Set PGLITE_ROOT.');
const {PGlite}=await import(pathToFileURL(root+'/dist/index.js').href);
const {pgcrypto}=await import(pathToFileURL(root+'/dist/contrib/pgcrypto.js').href);
const db=new PGlite({extensions:{pgcrypto}});
try{
  await db.exec('create schema extensions; create role anon; create role authenticated; create role service_role bypassrls;');
  const schema=(await readFile(new URL('../database/workecho.sql',import.meta.url),'utf8')).split('-- BEGIN FEATURE EXTENSION')[0]
    .replace(/^  if p_action='features'.*\r?\n/m,'').replace(/^  if p_action='sandbox'.*\r?\n/m,'');
  await db.exec(schema);
  await db.exec(`insert into public.we_workers(id,recovery_hash) values('00000000-0000-4000-8000-000000000001','synthetic-migration-fixture');
    insert into public.we_intakes(id,worker_id,language,voice,matching,outreach) values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','kn',false,true,false);
    insert into public.we_histories(id,intake_id,worker_id,fields,evidence,matching,outreach,operation,fingerprint) values(
      '00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',
      '{"place":"Fictional migration yard","period":"ಅಂದಾಜು ವರ್ಷಗಳು"}','{}',true,false,'00000000-0000-4000-8000-000000000004','synthetic');
    insert into public.we_sources values('00000000-0000-4000-8000-000000000003','{"kind":"example","text":"Synthetic private source हिन्दी ಕನ್ನಡ"}');
    insert into public.we_revisions(history_id,version,fields,evidence,operation) values('00000000-0000-4000-8000-000000000003',1,'{"place":"Fictional migration yard"}','{}','00000000-0000-4000-8000-000000000005');
    insert into public.we_staff(id,email,password_hash,role) values('00000000-0000-4000-8000-000000000006','migration@example.test','not-an-actual-password','reviewer');
    insert into public.we_sessions(token_hash,worker_id) values('synthetic-session','00000000-0000-4000-8000-000000000001');
    insert into public.we_settings values('synthetic-setting','preserve');
    insert into public.we_limits values('synthetic-limit',1,2);
    insert into public.we_events(target,kind,status,reason,actor) values('synthetic','audit','fixture','Synthetic migration audit only','test');`);
  const tables=(await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(row=>row.tablename);
  async function snapshot(){const result={};for(const table of tables){assert.match(table,/^we_[a-z_]+$/);const rows=(await db.query(`select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') as rows from public.${table} x`)).rows[0].rows;result[table]={count:rows.length,hash:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}return result;}
  const before=await snapshot();await db.exec(await readFile(new URL('../database/migrations/004-workspace-features.sql',import.meta.url),'utf8'));assert.deepEqual(await snapshot(),before);
  for(const table of ['we_feature_items','we_sandboxes'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) as allowed',['public','public.'+table,'SELECT'])).rows[0].allowed,false);
  for(const signature of ['we_api(text,text,jsonb)','we_feature_api(text,jsonb)','we_sandbox_api(text,text,text,integer)'])assert.equal((await db.query('select has_function_privilege($1,$2,$3) as allowed',['public','public.'+signature,'EXECUTE'])).rows[0].allowed,false);
  console.log(JSON.stringify({audit:'Migration 004 installs definitions only; existing rows unchanged',existingTables:tables.length,seededRows:Object.values(before).reduce((sum,row)=>sum+row.count,0),existingRowHashesUnchanged:true,anonymousAccess:false}));
}finally{await db.close();}
