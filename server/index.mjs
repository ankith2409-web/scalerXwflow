import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isUuid, openStore, RequestError, SESSION_SECONDS } from './store.mjs';
import { captureFormat, transcribe } from './speech.mjs';
import { WORKSPACE_SECONDS } from './workspace-auth.mjs';
import { extractAccount, translateReview } from './intelligence.mjs';
import { interfaceLanguages } from './account.mjs';

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
  const raw = await body(req, 65_536);
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new RequestError(400, 'The request is not valid JSON.');
  }
}

export function createRequestHandler(db, {
  speechKey = process.env.SARVAM_API_KEY?.trim(),
  speech = transcribe, appOrigin = process.env.APP_ORIGIN, secureCookies = process.env.SECURE_COOKIES === '1', workspace = false, aiKey = process.env.WORKECHO_AI_ENABLED === '1' ? process.env.OPENAI_API_KEY ?? '' : '',
} = {}) {
  const cookie = (res, value, maxAge, name = 'we_session') => res.appendHeader('Set-Cookie',
    name + '=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (secureCookies ? '; Secure' : ''));

  return async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'microphone=(self)');
    res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (workspace && !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(req.headers.host ?? '')) {
        throw new RequestError(403, 'Open the local WorkEcho address printed by the server.');
      }
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
        const workerCookie = workspace ? 'we_local_worker' : 'we_session';
        const session = db.getSession(readCookie(workerCookie));

        if (path === '/api/session' && method === 'GET') {
          return send(res, 200, { active: Boolean(session), voiceAvailable: Boolean(speechKey), analysisAvailable: Boolean(aiKey), workspace, demo: !workspace });
        }
        if (workspace && path === '/api/session/restore' && method === 'POST') {
          const { code } = await json(req);
          const value = db.workspace.resume(code);
          if (session && db.getSession(value)?.id !== session.id) db.signOut(session);
          cookie(res, value, WORKSPACE_SECONDS, workerCookie);
          return send(res, 200, { active: true, voiceAvailable: Boolean(speechKey), analysisAvailable: Boolean(aiKey), workspace });
        }
        if (workspace && path === '/api/session/recovery-code' && method === 'POST') {
          if (!session) throw new RequestError(401, 'Open your work history first.');
          return send(res, 200, { code: db.workspace.replaceRecoveryCode(session) });
        }
        if (path === '/api/session' && method === 'DELETE') {
          if (session) db.signOut(session);
          cookie(res, '', 0, workerCookie);
          if (!workspace) cookie(res, '', 0, 'we_staff');
          return send(res, 200, { active: false });
        }
        if (path === '/api/intakes' && method === 'POST') {
          const data = await json(req);
          if (!interfaceLanguages.includes(data.language) || typeof data.voice !== 'boolean' || data.save !== true ||
            ['matching', 'outreach'].some((key) => data[key] !== undefined && typeof data[key] !== 'boolean')) {
            throw new RequestError(400, 'Choose a language and agree to save the work history.');
          }
          const existing = session && (!workspace || db.workspace.isProfile(session.id)) ? session : null;
          const owner = existing ?? (workspace ? db.workspace.newProfile() : db.createSession());
          const intake = db.startIntake(owner, data);
          if (!existing) cookie(res, owner.token, workspace ? WORKSPACE_SECONDS : SESSION_SECONDS, workerCookie);
          return send(res, 201, { ...intake, ...(owner.code ? { code: owner.code } : {}) });
        }
        if (path.startsWith('/api/staff/')) {
          const staffCookie = workspace ? 'we_local_staff' : 'we_staff';
          const credential = readCookie(staffCookie);
          const active = workspace ? db.workspace.signedIn(credential) : db.demo.signedIn(session, credential);
          if (path === '/api/staff/session') {
            if (method === 'GET') return send(res, 200, { active, workspace, setup: workspace && !db.workspace.hasStaff() });
            if (method === 'POST') {
              if (workspace) {
                const { passphrase } = await json(req);
                const next = db.workspace.signIn(passphrase);
                db.workspace.signOut(credential);
                cookie(res, next, WORKSPACE_SECONDS, staffCookie);
                return send(res, 200, { active: true });
              }
              const owner = session ?? db.createSession();
              if (!session) cookie(res, owner.token, SESSION_SECONDS);
              cookie(res, db.demo.signIn(owner), SESSION_SECONDS, 'we_staff');
              return send(res, 200, { active: true });
            }
            if (method === 'DELETE') {
              if (workspace) db.workspace.signOut(credential);
              else if (active) db.demo.signOut(session);
              cookie(res, '', 0, staffCookie);
              return send(res, 200, { active: false });
            }
          }
          if (!active) throw new RequestError(401, 'Sign in to the staff workspace.');
          const scope = workspace ? db.workspace.staffScope() : session;
          if (path === '/api/staff/overview' && method === 'GET') return send(res, 200, { records: workspace ? db.demo.records(scope) : [], matches: db.demo.candidates(scope), referrals: db.demo.referrals(scope), window: null });
          if (workspace && method === 'GET' && path === '/api/staff/records') return send(res, 200, db.demo.records(scope));
          if (method === 'GET' && path === '/api/staff/matches') return send(res, 200, db.demo.candidates(scope));
          if (method === 'GET' && path === '/api/staff/referrals') return send(res, 200, db.demo.referrals(scope));
          const [, area, target, operation] = path.match(/^\/api\/staff\/(matches|referrals)\/([\w:-]+)\/(decision|transition)$/) ?? [];
          if (method === 'POST' && area === 'matches' && operation === 'decision') return send(res, 200, db.demo.decide(scope, target, await json(req)));
          if (method === 'POST' && area === 'referrals' && operation === 'transition') return send(res, 200, db.demo.transition(scope, target, await json(req)));
        }
        if (!session) throw new RequestError(401, 'This session has ended. Start a new work history.');
        if (path === '/api/draft' && method === 'GET') return send(res, 200, db.draft(session));
        const [, draftId] = path.match(/^\/api\/intakes\/([^/]+)\/draft$/) ?? [];
        if (isUuid(draftId)) {
          if (method === 'POST') return send(res, 200, db.saveDraft(session, draftId, await json(req)));
          if (method === 'DELETE') return send(res, 200, db.discardDraft(session, draftId));
        }
        if (path === '/api/history' && method === 'GET') return send(res, 200, db.history(session));
        const [, sharingId] = path.match(/^\/api\/history\/([^/]+)\/sharing$/) ?? [];
        if (method === 'DELETE' && isUuid(sharingId)) return send(res, 200, db.stopSharing(session, sharingId));
        const [, historyId] = path.match(/^\/api\/history\/([^/]+)$/) ?? [];
        if (method === 'PATCH' && isUuid(historyId)) return send(res, 200, db.revise(session, historyId, await json(req)));
        const [, id, action] = path.match(/^\/api\/intakes\/([^/]+)\/(confirm|turns|extract|translate)$/) ?? [];
        if (method === 'POST' && isUuid(id)) {
          if (action === 'extract') {
            db.intake(session, id);
            db.reserveAnalysis(session, id);
            const { transcript, allowAI } = await json(req);
            return send(res, 200, await extractAccount(transcript, { key: allowAI === true ? aiKey : '' }));
          }
          if (action === 'translate') {
            db.intake(session, id); db.reserveAnalysis(session, id);
            const { fields, language, allowAI } = await json(req);
            return send(res, 200, await translateReview(fields, language, { key: allowAI === true ? aiKey : '' }));
          }
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
  };
}

export function createApp({ dbPath = resolve('.data/workecho.sqlite'), ...options } = {}) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = openStore(dbPath);
  const handler = createRequestHandler(db, options), demoDb = openStore(':memory:');
  const demoHandler = createRequestHandler(demoDb, { ...options, workspace: false, speechKey: '', aiKey: '' });
  const server = createServer((req, res) => {
    if (req.url.startsWith('/api/demo/')) {
      req.url = '/api/' + req.url.slice('/api/demo/'.length);
      if (req.url === '/api/wispr/status') return send(res, 200, { available: false, connected: false });
      return demoHandler(req, res);
    }
    return handler(req, res);
  });
  server.on('close', () => { db.close(); demoDb.close(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let port = Number(process.env.PORT ?? 3002);
  const host = process.env.HOST ?? '127.0.0.1';
  const workspace = !process.argv.includes('--demo');
  if (workspace && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
    console.error('The local workspace requires a loopback address.');
    process.exit(1);
  }
  const server = createApp({ workspace });
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && !process.env.PORT && port < 3012) {
      server.listen(++port, host);
      return;
    }
    console.error('WorkEcho could not listen on port ' + port + ' (' + (error.code ?? error.name) + ').');
    process.exitCode = 1;
  });
  server.once('listening', () => {
    const address = server.address();
    const url = 'http://' + (host === '::1' ? '[::1]' : host) + ':' + address.port + '/';
    console.log('WorkEcho is running at ' + url);
    if (process.argv.includes('--open') && process.platform === 'win32') {
      const browser = spawn('explorer.exe', [url], { stdio: 'ignore', windowsHide: true, detached: true });
      browser.on('error', () => console.log('Open the URL above in your browser.'));
      browser.unref();
    }
  });
  server.listen(port, host);
}
