import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../server/index.mjs';

async function client(t) {
  const server = createApp({ dbPath: ':memory:', workspace: true, speechKey: '' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const createClient = () => {
    let cookie = '';
    return async (path, method = 'GET', data) => {
      const r = await fetch(origin + path, { method, headers: { origin, cookie, 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
      for (const item of r.headers.getSetCookie()) if (item.startsWith('we_local_worker=')) cookie = item.split(';')[0];
      return { status: r.status, data: await r.json() };
    };
  };
  return { call: createClient(), another: createClient() };
}
const fields = { place: 'Jodhpur', task: 'cut stone slabs', period: 'two monsoons before lockdown', landmark: 'railway crossing', alias: 'Raju shed' };
const source = { kind: 'wispr-dictation', text: 'I cut stone slabs at Raju shed near the railway crossing in Jodhpur for two monsoons before lockdown.' };

test('final sharing choices override intake choices atomically and retain the complete source', async t => {
  const { call } = await client(t);
  for (const [initial, final] of [[true, false], [false, true]]) {
    const started = await call('/api/intakes', 'POST', { language: 'en', save: true, voice: false, matching: initial, outreach: initial });
    const body = { confirmed: true, operation: randomUUID(), fields, evidence: fields, source, permissions: { matching: final, outreach: false } };
    const result = await call('/api/intakes/' + started.data.id + '/confirm', 'POST', body);
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.data.sharing, final); assert.equal(result.data.source.text, source.text);
    const retry = await call('/api/intakes/' + started.data.id + '/confirm', 'POST', body);
    assert.deepEqual(retry, result);
    assert.equal((await call('/api/intakes/' + started.data.id + '/confirm', 'POST', { ...body, permissions: { matching: !final, outreach: false } })).status, 409);
  }
});

test('drafts restore with a session, enforce ownership and reject stale writes', async t => {
  const { call, another } = await client(t);
  const start = await call('/api/intakes', 'POST', { language: 'kn', save: true, voice: false, matching: false, outreach: false });
  assert.equal(start.status, 201);
  const data = { language: 'kn', mode: 'story', page: 'capture', step: 0, source, fields, evidence: fields, permissions: { matching: false, outreach: false } };
  const payload = { version: 0, operation: randomUUID(), data };
  const path = '/api/intakes/' + start.data.id + '/draft';
  const saved = await call(path, 'POST', payload); assert.equal(saved.status, 200, JSON.stringify(saved));
  assert.equal(saved.data.version, 1);
  assert.equal((await call('/api/draft')).data.data.source.text, source.text);
  assert.equal((await another(path, 'POST', payload)).status, 401);
  assert.deepEqual(await call(path, 'POST', payload), saved);
  assert.equal((await call(path, 'POST', { ...payload, operation: randomUUID() })).status, 409);
  await call('/api/session', 'DELETE');
  assert.equal((await call('/api/draft')).status, 401);
  assert.equal((await another('/api/session/restore', 'POST', { code: start.data.code })).status, 200);
  assert.equal((await another('/api/draft')).data.data.source.text, source.text);
});

test('confirmation rejects invented evidence and oversized source while preserving an accepted source through correction',async t=>{
  const {call}=await client(t);
  const start=await call('/api/intakes','POST',{language:'en',save:true,voice:false});
  const path='/api/intakes/'+start.data.id+'/confirm';
  const payload={confirmed:true,operation:randomUUID(),fields,evidence:fields,source,permissions:{matching:false,outreach:false}};
  assert.equal((await call(path,'POST',{...payload,evidence:{...fields,place:'invented place'}})).status,400);
  assert.equal((await call(path,'POST',{...payload,source:{...source,text:'x'.repeat(12001)}})).status,400);
  const saved=await call(path,'POST',payload);assert.equal(saved.status,200);
  const changed=await call('/api/history/'+saved.data.id,'PATCH',{confirmed:true,operation:randomUUID(),version:1,fields:{...fields,task:'Polished stone'}});
  assert.equal(changed.status,200);assert.equal(changed.data.source.text,source.text);
  assert.equal((await call('/api/intakes/'+start.data.id+'/draft','POST',{version:0,operation:randomUUID(),data:{language:'en',mode:'story',page:'review',step:0,source,fields,evidence:fields,permissions:{matching:false,outreach:false}}})).status,409);
});
