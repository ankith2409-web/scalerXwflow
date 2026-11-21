import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isUuid, openStore, RequestError, SESSION_SECONDS } from './store.mjs';
import { captureFormat, transcribe } from './speech.mjs';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const audioTypes = new Set(['audio/webm', 'audio/ogg', 'audio/mp4']);
const pagePaths = new Set(['/', '/intake', '/intake/review', '/history', '/staff/review', '/staff/referrals']);

function send(res, code, value) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

async function body(req, limit) {
  const length = Number(req.headers['content-length']);
  if (length > limit) {
    req.resume();
    throw new RequestError(413, 'The answer is too large.');
  }
  const chunks = [];
  let size = 0;
  // Preserve the connection long enough to return a readable error to the browser.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      throw new RequestError(413, 'The answer is too large.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function json(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new RequestError(415, 'Send JSON for this request.');
  }
  const raw = await body(req, 24_576);
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new RequestError(400, 'The request is not valid JSON.');
  }
}

export function createApp({
  dbPath = resolve('.data/workecho.sqlite'), speechKey = process.env.SARVAM_API_KEY?.trim(),
  speech = transcribe, appOrigin = process.env.APP_ORIGIN, secureCookies = process.env.SECURE_COOKIES === '1',
} = {}) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = openStore(dbPath);
  const cookie = (res, value, maxAge, name = 'we_session') => res.appendHeader('Set-Cookie',
    name + '=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (secureCookies ? '; Secure' : ''));

  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'microphone=(self)');
    res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Cache-Control', 'no-store');
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (path.startsWith('/api/')) {
        const method = req.method;
        if (method !== 'GET') {
          const allowedOrigin = appOrigin ?? ('http://' + req.headers.host);
          if (req.headers.origin !== allowedOrigin) throw new RequestError(403, 'Open WorkEcho to submit this request.');
        }
        const readCookie = (name) => req.headers.cookie?.split(';').map((item) => item.trim())
          .find((item) => item.startsWith(name + '='))?.slice(name.length + 1);
        const session = db.getSession(readCookie('we_session'));

        if (path === '/api/session' && method === 'GET') {
          return send(res, 200, { active: Boolean(session), voiceAvailable: Boolean(speechKey) });
        }
        if (path === '/api/session' && method === 'DELETE') {
          if (session) db.signOut(session);
          cookie(res, '', 0);
          cookie(res, '', 0, 'we_staff');
          return send(res, 200, { active: false });
        }
        if (path === '/api/intakes' && method === 'POST') {
          const data = await json(req);
          if (!['en', 'hi'].includes(data.language) || typeof data.voice !== 'boolean' || data.save !== true ||
            ['matching', 'outreach'].some((key) => data[key] !== undefined && typeof data[key] !== 'boolean')) {
            throw new RequestError(400, 'Choose a language and agree to save a fictional history.');
          }
          const owner = session ?? db.createSession();
          if (!session) cookie(res, owner.token, SESSION_SECONDS);
          return send(res, 201, db.startIntake(owner, data));
        }
        if (path.startsWith('/api/staff/')) {
          const active = db.demo.signedIn(session, readCookie('we_staff'));
          if (path === '/api/staff/session') {
            if (method === 'GET') return send(res, 200, { active });
            if (method === 'POST') {
              const owner = session ?? db.createSession();
              if (!session) cookie(res, owner.token, SESSION_SECONDS);
              cookie(res, db.demo.signIn(owner), SESSION_SECONDS, 'we_staff');
              return send(res, 200, { active: true });
            }
            if (method === 'DELETE') {
              if (active) db.demo.signOut(session);
              cookie(res, '', 0, 'we_staff');
              return send(res, 200, { active: false });
            }
          }
          if (!active) throw new RequestError(401, 'Open the demo staff workspace.');
          if (method === 'GET' && path === '/api/staff/matches') return send(res, 200, db.demo.candidates(session));
          if (method === 'GET' && path === '/api/staff/referrals') return send(res, 200, db.demo.referrals(session));
          const [, area, target, operation] = path.match(/^\/api\/staff\/(matches|referrals)\/([\w:-]+)\/(decision|transition)$/) ?? [];
          if (method === 'POST' && area === 'matches' && operation === 'decision') return send(res, 200, db.demo.decide(session, target, await json(req)));
          if (method === 'POST' && area === 'referrals' && operation === 'transition') return send(res, 200, db.demo.transition(session, target, await json(req)));
        }
        if (!session) throw new RequestError(401, 'This session has ended. Start a new work history.');
        if (path === '/api/history' && method === 'GET') return send(res, 200, db.history(session));
        const [, historyId] = path.match(/^\/api\/history\/([^/]+)$/) ?? [];
        if (method === 'PATCH' && isUuid(historyId)) return send(res, 200, db.revise(session, historyId, await json(req)));
        const [, id, action] = path.match(/^\/api\/intakes\/([^/]+)\/(confirm|turns)$/) ?? [];
        if (method === 'POST' && isUuid(id)) {
          if (action === 'confirm') return send(res, 200, db.confirm(session, id, await json(req)));
          if (action === 'turns') {
            const interview = db.intake(session, id);
            if (!interview.voice) throw new RequestError(403, 'Voice processing was declined.');
            if (!speechKey) throw new RequestError(503, 'Voice input is unavailable. Type your answer.');
            const type = req.headers['content-type']?.split(';')[0];
            if (!audioTypes.has(type)) throw new RequestError(415, 'Unsupported recording format.');
            const buffer = await body(req, 1_000_000);
            const extension = captureFormat(type, buffer);
            db.reserveVoice(session, interview);
            const transcript = await speech({ key: speechKey, buffer, type, extension });
            return send(res, 200, { transcript });
          }
        }
        throw new RequestError(404, 'This page could not be found.');
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new RequestError(405, 'This operation is unavailable.');
      const file = pagePaths.has(path) ? 'index.html' : /^\/assets\/[\w.-]+\.(js|css)$/.test(path) ? path.slice(1) : null;
      if (!file) throw new RequestError(404, 'This page could not be found.');
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
      let bytes;
      try {
        bytes = await readFile(resolve(dist, file));
      } catch (error) {
        if (error.code === 'ENOENT') throw new RequestError(404, 'Build the website with npm run build.');
        throw error;
      }
      res.writeHead(200, { 'Content-Type': mime[extname(file)] + '; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (!(error instanceof RequestError)) console.error('Unexpected request failure:', error.code ?? error.name);
      send(res, error.status ?? 500, { error: error.status ? error.message : 'Something went wrong. Try again.' });
    }
  });
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  createApp().listen(port, host, () => console.log('WorkEcho is running at http://' + host + ':' + port));
}
