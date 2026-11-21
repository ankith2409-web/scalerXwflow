import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../server/index.mjs';

async function fixture(t, options = {}) {
  const server = createApp({ dbPath: ':memory:', ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const origin = 'http://127.0.0.1:' + server.address().port;
  return (path, { method = 'GET', cookie, data, raw, type, source = origin } = {}) => {
    const headers = { Origin: source };
    if (cookie) headers.Cookie = cookie;
    if (data !== undefined || type) headers['Content-Type'] = type ?? 'application/json';
    return fetch(origin + path, { method, headers, body: data === undefined ? raw : JSON.stringify(data) });
  };
}

async function start(send, voice = false) {
  const response = await send('/api/intakes', { method: 'POST', data: { language: 'hi', save: true, voice } });
  assert.equal(response.status, 201);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  return { cookie: cookie.split(';')[0], ...await response.json() };
}

test('confirms a corrected history, keeps uncertainty, and scopes retrieval to its session', async (t) => {
  const send = await fixture(t);
  const { id, cookie } = await start(send);
  const second = await start(send);
  const path = '/api/intakes/' + id + '/confirm';
  const data = { operation: randomUUID(), confirmed: true, fields: {
    place: 'Jodhpur', task: 'पत्थर काटना', period: 'दो बरसात', landmark: null, alias: null,
  } };
  const confirm = (payload = data, owner = cookie) => send(path, { method: 'POST', cookie: owner, data: payload });
  assert.equal((await confirm({ ...data, confirmed: false })).status, 400);
  assert.equal((await confirm(data, second.cookie)).status, 404);
  const result = await confirm();
  assert.equal(result.status, 200);
  const first = await result.json();
  assert.deepEqual(await (await confirm()).json(), first);
  assert.equal((await confirm({ ...data, fields: { ...data.fields, place: 'Jaipur' } })).status, 409);
  assert.deepEqual(await (await send('/api/history', { cookie })).json(), [first]);
  assert.equal(first.fields.place, 'Jodhpur');
  assert.equal(first.fields.period, 'दो बरसात');
  assert.deepEqual(await (await send('/api/history', { cookie: second.cookie })).json(), []);
  assert.equal((await send('/api/session', { method: 'DELETE', cookie })).status, 200);
  assert.equal((await send('/api/history', { cookie })).status, 401);
});

test('requires deliberate consent and an allowed request origin', async (t) => {
  const send = await fixture(t);
  for (const [source, save, code] of [['https://other.example', true, 403], [undefined, false, 400]]) {
    assert.equal((await send('/api/intakes', { method: 'POST', source, data: { language: 'en', save, voice: false } })).status, code);
  }
});

test('audio reaches a configured adapter only after voice consent and format checks', async (t) => {
  let uploads = 0;
  const send = await fixture(t, { speechKey: 'test', speech: async ({ extension }) => {
    uploads++;
    assert.equal(extension, 'webm');
    return 'Jodhpur के पास';
  } });
  const audio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
  const turn = ({ id, cookie }, raw = audio) => send('/api/intakes/' + id + '/turns', {
    method: 'POST', cookie, raw, type: 'audio/webm',
  });
  assert.equal((await turn(await start(send))).status, 403);
  const allowed = await start(send, true);
  assert.equal((await turn(allowed, Buffer.from('wrong'))).status, 415);
  assert.deepEqual(await (await turn(allowed)).json(), { transcript: 'Jodhpur के पास' });
  assert.equal(uploads, 1);
});

test('scopes staff sessions and enforces matching consent, conflicts and referral transitions', async (t) => {
  const send = await fixture(t);
  const { id, cookie } = await start(send);
  const other = await start(send);
  const post = (path, data, owner = cookie) => send(path, { method: 'POST', cookie: owner, data });
  const fields = { place: 'Jodhpur', task: 'Cut slabs', period: 'Two monsoons', landmark: 'Railway crossing', alias: 'Raju’s stone shed' };
  const confirm = (intakeId, values = fields) => post('/api/intakes/' + intakeId + '/confirm', {
    operation: randomUUID(), confirmed: true, fields: values, evidence: { ...values, place: 'Jaipur was initially heard' },
  });
  assert.equal((await confirm(id)).status, 200);
  assert.equal((await send('/api/staff/matches', { cookie })).status, 401);
  const login = await post('/api/staff/session', {});
  const staffCookie = login.headers.get('set-cookie').split(';')[0];
  const staff = cookie + '; ' + staffCookie;
  const candidates = async () => (await send('/api/staff/matches', { cookie: staff })).json();
  const referrals = async () => (await send('/api/staff/referrals', { cookie: staff })).json();
  assert.equal((await send('/api/staff/matches', { cookie: other.cookie + '; ' + staffCookie })).status, 401);
  assert.equal((await candidates()).length, 2);

  async function addJob(outreach) {
    const { id: intakeId } = await (await post('/api/intakes', { language: 'hi', save: true, voice: false, matching: true, outreach })).json();
    return (await confirm(intakeId, fields)).json();
  }
  const personal = await addJob(false);
  const approved = await addJob(true);
  const all = await candidates();
  const good = all.find((item) => item.id === approved.id + ':1:b');
  const denied = all.find((item) => item.id === personal.id + ':1:b');
  const misleading = all.find((item) => item.id === approved.id + ':1:c');
  assert.equal(good.overlap, 'unknown');
  assert.match(good.left.quote, /Jaipur was initially heard/);
  assert.equal(good.left.fields.place, 'Jodhpur');
  assert.equal(misleading.conflict, true);

  const action = (target, operation, status, version, extra = {}) => post('/api/staff/' + target + '/' + operation,
    { status, version, reason: 'Fictional evidence reviewed.', operation: randomUUID(), ...extra }, staff);
  const decide = (candidate, status, version = 0) => action('matches/' + candidate, 'decision', status, version);
  const move = (candidate, status, version, extra) => action('referrals/' + candidate, 'transition', status, version, extra);
  assert.equal((await decide(misleading.id, 'accepted')).status, 409);
  assert.equal((await decide(misleading.id, 'rejected')).status, 200);
  assert.equal((await decide(misleading.id, 'unresolved')).status, 409);
  assert.equal((await decide(denied.id, 'accepted')).status, 200);
  assert.equal((await move(denied.id, 'draft', 1)).status, 409);
  assert.equal((await decide(good.id, 'accepted')).status, 200);
  assert.equal((await move(good.id, 'draft', 1)).status, 200);
  assert.equal((await move(good.id, 'approved', 1)).status, 409);
  assert.equal((await move(good.id, 'invited', 1)).status, 409);
  const approval = { healthApproval: true, operation: randomUUID() };
  assert.equal((await move(good.id, 'approved', 1, approval)).status, 200);
  assert.equal((await move(good.id, 'approved', 1, approval)).status, 200);
  assert.equal((await move(good.id, 'approved', 1, { ...approval, healthApproval: false })).status, 409);
  assert.equal((await move(good.id, 'invited', 2)).status, 200);
  assert.equal((await referrals())[0].events.length, 3);

  const revision = { confirmed: true, version: 1, operation: randomUUID(), fields: { ...fields, period: '2018–2019' } };
  const revise = (owner, data = revision) => send('/api/history/' + approved.id, { method: 'PATCH', cookie: owner, data });
  assert.equal((await revise(other.cookie)).status, 404);
  const corrected = await (await revise(cookie)).json();
  assert.equal(corrected.version, 2);
  assert.equal(corrected.evidence.period, 'Two monsoons');
  assert.deepEqual(await (await revise(cookie)).json(), corrected);
  assert.equal((await revise(cookie, { ...revision, operation: randomUUID() })).status, 409);
  assert.equal((await candidates()).find((item) => item.id === approved.id + ':2:b').overlap, 'overlap');
  assert.equal((await candidates()).some((item) => item.id === good.id), false);
  assert.equal((await referrals())[0].status, 'cancelled');
  assert.equal((await send('/api/session', { method: 'DELETE', cookie: staff })).status, 200);
  assert.equal((await send('/api/staff/referrals', { cookie: staff })).status, 401);
});
