import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import api from '../api/workecho.js';

test('hosted worker and staff state survives separate function requests and clears on sign-out', async () => {
  const origin = 'https://workecho.example';
  const cookies = new Map();
  process.env.WORKECHO_DEMO_KEY = randomBytes(32).toString('base64url');
  const call = async (path, method = 'GET', data, jar = cookies, source = origin) => {
    const headers = { origin: source, cookie: [...jar].map(([k, v]) => k + '=' + v).join('; ') };
    if (data) headers['content-type'] = 'application/json';
    const url = new URL('/api/workecho', origin);
    url.searchParams.set('route', path.slice('/api/'.length));
    const result = await api.fetch(new Request(url, { method, headers, body: data ? JSON.stringify(data) : undefined }));
    for (const cookie of result.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const [name, value] = pair.split('=');
      assert.match(cookie, /HttpOnly; (?:Secure; SameSite=Strict|SameSite=Strict; Max-Age=\d+; Secure)/);
      if (value) jar.set(name, value);
      else jar.delete(name);
    }
    return [result.status, await result.json()];
  };
  const answers = { place: 'Fictional yard', task: 'Loading', period: null, landmark: null, alias: null };
  const [started, intake] = await call('/api/intakes', 'POST', { language: 'en', save: true, voice: false, matching: false, outreach: false });
  assert.equal(started, 201);
  assert.equal(cookies.has('__Host-workecho-demo-0'), true);
  const [saved] = await call('/api/intakes/' + intake.id + '/confirm', 'POST', { confirmed: true, fields: answers, operation: randomUUID() });
  assert.equal(saved, 200);
  const [historyStatus, history] = await call('/api/history');
  assert.equal(historyStatus, 200);
  assert.equal(history[0].fields.place, answers.place);
  assert.equal((await call('/api/history', 'GET', undefined, new Map()))[0], 401);
  assert.equal((await call('/api/staff/session', 'POST', undefined, cookies, 'https://other.example'))[0], 403);
  assert.equal((await call('/api/staff/session', 'POST'))[0], 200);
  const [matchesStatus, matches] = await call('/api/staff/matches');
  assert.equal(matchesStatus, 200);
  const candidate = matches.find((match) => match.eligible);
  const [reviewed] = await call('/api/staff/matches/' + candidate.id + '/decision', 'POST',
    { status: 'accepted', version: candidate.version, reason: 'Fictional evidence reviewed.', operation: randomUUID() });
  assert.equal(reviewed, 200);
  const [, reviewedMatches] = await call('/api/staff/matches');
  assert.equal(reviewedMatches.find((match) => match.id === candidate.id).status, 'accepted');

  const changedCookies = new Map(cookies);
  const name = '__Host-workecho-demo-0';
  const value = cookies.get(name);
  changedCookies.set(name, (value[0] === 'a' ? 'b' : 'a') + value.slice(1));
  assert.equal((await call('/api/history', 'GET', undefined, changedCookies))[0], 401);
  assert.equal((await call('/api/session', 'DELETE'))[0], 200);
  assert.equal(cookies.size, 0);
});

test('explicit judge demo bypasses the production database and keeps its source private',async()=>{
  process.env.DATABASE_URL='postgres://unused-invalid-test-connection';
  process.env.WORKECHO_DEMO_KEY=randomBytes(32).toString('base64url');
  const cookies=new Map(),origin='https://workecho.example';
  const call=async(path,method='GET',data)=>{
    const response=await api.fetch(new Request(origin+'/api/demo/'+path,{method,headers:{origin,'content-type':'application/json',cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')},body:data?JSON.stringify(data):undefined}));
    for(const value of response.headers.getSetCookie()){const [pair]=value.split(';');const i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}
    return {status:response.status,data:await response.json()};
  };
  try{
    assert.equal((await call('session')).data.demo,true);
    assert.equal((await call('wispr/status')).data.available,false);
    const start=await call('intakes','POST',{language:'en',voice:false,save:true,matching:true,outreach:true});assert.equal(start.status,201);
    const fields={place:'Fictional yard',task:null,period:null,landmark:null,alias:null};
    const source={kind:'example',text:'Fictional yard'};
    const saved=await call('intakes/'+start.data.id+'/confirm','POST',{confirmed:true,operation:randomUUID(),fields,evidence:fields,source,permissions:{matching:true,outreach:true}});
    assert.equal(saved.status,200,JSON.stringify(saved));
    assert.equal((await call('history')).data[0].source.text,'Fictional yard');
    assert.equal((await call('staff/session','POST')).status,200);
    assert.ok((await call('staff/overview')).data.matches.length>0);
    assert.equal((await call('history/'+saved.data.id+'/sharing','DELETE')).status,200);
    assert.equal((await call('history')).data[0].sharing,false);
    assert.equal(cookies.has('we_cloud_worker'),false);
  }finally{delete process.env.DATABASE_URL;}
});

test('hosted routing forwards search and page parameters while removing its internal route parameter',async()=>{
  const originalFetch=globalThis.fetch,oldDb=process.env.DATABASE_URL,oldBackend=process.env.WORKECHO_BACKEND_URL;
  delete process.env.DATABASE_URL;process.env.WORKECHO_BACKEND_URL='https://workechotest.supabase.co/functions/v1/workecho';
  globalThis.fetch=async(url)=>{
    const target=new URL(url);assert.equal(target.pathname,'/functions/v1/workecho/api/staff/search');
    assert.equal(target.searchParams.get('query'),'Jodhpur & quarry');assert.equal(target.searchParams.get('page'),'2');assert.equal(target.searchParams.has('route'),false);
    return Response.json({records:[],page:2,total:51});
  };
  try{
    const response=await api.fetch(new Request('https://workecho.example/api/workecho?route=staff/search&query=Jodhpur%20%26%20quarry&page=2'));
    assert.equal(response.status,200);assert.equal((await response.json()).page,2);
  }finally{
    globalThis.fetch=originalFetch;if(oldDb===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldDb;
    if(oldBackend===undefined)delete process.env.WORKECHO_BACKEND_URL;else process.env.WORKECHO_BACKEND_URL=oldBackend;
  }
});
