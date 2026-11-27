import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../server/index.mjs';

async function fixture(t, options = {}) {
  const server = createApp({ dbPath: ':memory:', ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let closing;
  const close = () => closing ??= new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  t.after(close);
  const origin = 'http://127.0.0.1:' + server.address().port;
  const send = (path, { method = 'GET', cookie, data, raw, type, source = origin } = {}) => {
    const headers = { Origin: source };
    if (cookie) headers.Cookie = cookie;
    if (data !== undefined || type) headers['Content-Type'] = type ?? 'application/json';
    return fetch(origin + path, { method, headers, body: data === undefined ? raw : JSON.stringify(data) });
  };
  send.close = close;
  return send;
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

test('restores local histories across restart and follows real shared records through a staff workflow', async (t) => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'workecho-test-')), 'workspace.sqlite');
  let send = await fixture(t, { dbPath, workspace: true });
  const authCookie = (response) => response.headers.getSetCookie()[0]?.split(';')[0];
  const post = (path, data, cookie) => send(path, { method: 'POST', data, cookie });
  const signin = (passphrase) => post('/api/staff/session', { passphrase });
  const fields = { place: 'Bengaluru', task: 'Cut slabs', period: '2018–2020', landmark: 'Gate 4', alias: 'Lakefront Yard' };
  async function worker(matching, outreach) {
    const created = await post('/api/intakes', { language: 'en', save: true, voice: false, matching, outreach });
    assert.equal(created.status, 201);
    const cookie = authCookie(created);
    const { code, id } = await created.json();
    assert.match(code, /^[\w-]{43}$/);
    const saved = await post('/api/intakes/' + id + '/confirm', { fields, confirmed: true, operation: randomUUID() }, cookie);
    assert.equal(saved.status, 200);
    return { cookie, code, saved: await saved.json() };
  }
  const a = await worker(true, true);
  const b = await worker(true, false);
  const privateRecord = await worker(false, false);
  const get = (path, cookie) => send(path, { cookie });
  assert.equal((await get('/api/staff/records', a.cookie)).status, 401);
  const passphrase = 'test local staff passphrase';
  const staff = authCookie(await signin(passphrase));
  assert.equal((await signin('incorrect passphrase')).status, 401);
  const shared = async (credential = staff) => (await get('/api/staff/records', credential)).json();
  const referrals = async (credential = staff) => (await get('/api/staff/referrals', credential)).json();
  assert.equal((await shared()).length, 2);
  assert.ok((await shared()).some((item) => item.id === a.saved.id + ':1:direct'));
  assert.ok(!(await shared()).some((item) => item.id.startsWith(privateRecord.saved.id)));
  const candidates = await (await get('/api/staff/matches', staff)).json();
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].overlap, 'overlap');
  assert.equal((await post('/api/staff/matches/' + candidates[0].id + '/decision', {
    status: 'accepted', version: 0, reason: 'The locations and names agree.', operation: randomUUID(),
  }, staff)).status, 200);
  const move = (record, status, version, approval = false, credential = staff) => post(
    '/api/staff/referrals/' + record + ':1:direct/transition', {
      status, version, reason: 'Recorded outside the app.', operation: randomUUID(), healthApproval: approval,
    }, credential);
  assert.equal((await move(b.saved.id, 'draft', 1)).status, 404);
  assert.equal((await move(a.saved.id, 'draft', 1)).status, 200);
  assert.equal((await move(a.saved.id, 'approved', 1)).status, 409);
  assert.equal((await move(a.saved.id, 'approved', 1, true)).status, 200);
  assert.equal((await send('/api/session', { method: 'DELETE', cookie: a.cookie })).status, 200);
  assert.equal((await get('/api/history', a.cookie)).status, 401);
  await send.close();
  send = await fixture(t, { dbPath, workspace: true });
  t.after(async () => { await send.close(); rmSync(dbPath, { force: true }); });
  const recovered = await post('/api/session/restore', { code: a.code });
  assert.equal(recovered.status, 200);
  const workerCookie = authCookie(recovered);
  const histories = await (await get('/api/history', workerCookie)).json();
  assert.deepEqual(histories.map(({ id }) => id), [a.saved.id]);
  assert.equal(histories[0].sharing, true);
  const staffAfterRestart = authCookie(await signin(passphrase));
  assert.equal((await referrals(staffAfterRestart))[0].status, 'approved');
  assert.equal((await move(a.saved.id, 'invited', 2, false, staffAfterRestart)).status, 200);
  assert.equal((await send('/api/history/' + a.saved.id + '/sharing', { method: 'DELETE', cookie: b.cookie })).status, 404);
  assert.equal((await send('/api/history/' + a.saved.id + '/sharing', { method: 'DELETE', cookie: workerCookie })).status, 200);
  assert.equal((await shared(staffAfterRestart)).length, 1);
  assert.equal((await referrals(staffAfterRestart))[0].status, 'cancelled');
  assert.equal((await get('/api/history', workerCookie)).status, 200);
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
  assert.equal((await candidates()).filter(item=>item.id.startsWith('sample:')).length, 2);
  assert.equal((await candidates()).some(item=>item.id.startsWith(id+':')),false);

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
