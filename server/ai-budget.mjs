import {createHash} from 'node:crypto';
import {RequestError} from './errors.mjs';
const hash=value=>createHash('sha256').update(String(value||'unknown')).digest('hex');
export const AI_LIMITS=Object.freeze({total:200,day:50,session:10,ip:25});
const buckets=({session,ip},now)=>[
  // Existing RPC cleanup preserves daily-prefixed rows. The total bucket never expires.
  ['daily:workecho-ai:total',2147483647,AI_LIMITS.total],
  ['daily:workecho-ai:project',Math.floor(now/86400000),AI_LIMITS.day],
  ['daily:workecho-ai:session:'+hash(session),Math.floor(now/86400000),AI_LIMITS.session],
  ['provider:workecho-ai:ip:'+hash(ip),Math.floor(now/1800000),AI_LIMITS.ip],
].sort((a,b)=>a[0].localeCompare(b[0]));

// One atomic statement, using the existing private quota table. No migration is required.
export const AI_BUDGET_SQL=`with requested as (
 select * from jsonb_to_recordset($1::jsonb) as x(key text,bucket bigint,cap integer)
), claimed as (
 insert into public.we_limits as limits(key,bucket,uses)
 select key,bucket,1 from requested order by key,bucket
 on conflict(key,bucket) do update set uses=limits.uses+1
 where limits.uses < (select r.cap from requested r where r.key=excluded.key and r.bucket=excluded.bucket)
 returning key
) select (count(*)=4) as allowed from claimed`;

export function createAIBudget({query,now=Date.now}={}){
  const memory=new Map();
  return async identity=>{
    const rows=buckets(identity,now());let allowed;
    if(query){
      // Failure is closed: never fall back to a fresh in-memory allowance in a hosted runtime.
      const result=await query(AI_BUDGET_SQL,[JSON.stringify(rows.map(([key,bucket,cap])=>({key,bucket,cap})))]);
      allowed=(result.rows??result)[0]?.allowed===true;
    }else{
      for(const [key,entry]of memory)if(entry.expires<now())memory.delete(key);
      allowed=rows.every(([key,bucket,cap])=>(memory.get(key+':'+bucket)?.uses??0)<cap);
      if(allowed)for(const [key,bucket]of rows){const id=key+':'+bucket;memory.set(id,{uses:(memory.get(id)?.uses??0)+1,expires:bucket===2147483647?Infinity:now()+86400000});}
    }
    if(!allowed)throw new RequestError(429,'AI usage limit reached. Basic suggestions and manual review remain available.');
  };
}

export async function createNeonAIBudget(connectionString=process.env.DATABASE_URL){
  if(!connectionString)throw new Error('A durable AI budget requires the database.');
  const {neon}=await import('@neondatabase/serverless');const sql=neon(connectionString);
  return createAIBudget({query:(statement,args)=>sql.query(statement,args,{fetchOptions:{signal:AbortSignal.timeout(12000)}})});
}
