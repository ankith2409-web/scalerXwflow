import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../server/index.mjs';
import {featureContract} from './features-contract.mjs';
test('local feature permissions and full workflow',async t=>{
  const server=createApp({dbPath:':memory:',workspace:true,speechKey:''});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin='http://127.0.0.1:'+server.address().port;
  const client=()=>{const jar=new Map();return async(path,method='GET',data)=>{const response=await fetch(origin+path,{method,headers:{origin,'content-type':'application/json',cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},body:data?JSON.stringify(data):undefined});for(const c of response.headers.getSetCookie()){const pair=c.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}return response.headers.get('content-type')?.includes('application/json')?{status:response.status,data:await response.json()}:{status:response.status,bytes:Buffer.from(await response.arrayBuffer())};};};
  const worker=client(),staff=client(),stranger=client();assert.equal((await staff('/api/staff/session','POST',{passphrase:'synthetic staff passphrase'})).status,200);
  await featureContract({worker,staff,stranger});
});
