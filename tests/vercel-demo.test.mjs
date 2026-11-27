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
