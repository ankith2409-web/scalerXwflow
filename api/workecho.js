import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { createRequestHandler } from '../server/index.mjs';
import { openStore, SESSION_SECONDS } from '../server/store.mjs';

const prefix = '__Host-workecho-demo-';
const chunkSize = 3400;
const chunkCount = 2;
const context = Buffer.from('workecho-demo-v1');

function decode(cookies, secret) {
  const chunks = Array.from({ length: chunkCount }, (_, index) => cookies.get(prefix + index) ?? '');
  if (!chunks[0] || chunks.some((value) => !/^[\w-]{0,3400}$/.test(value))) return null;
  try {
    const sealed = Buffer.from(chunks.join(''), 'base64url');
    const cipher = createDecipheriv('aes-256-gcm', secret, sealed.subarray(0, 12));
    cipher.setAAD(context);
    cipher.setAuthTag(sealed.subarray(12, 28));
    const data = Buffer.concat([cipher.update(sealed.subarray(28)), cipher.final()]);
    return JSON.parse(inflateRawSync(data, { maxOutputLength: 128_000 }).toString('utf8'));
  } catch {
    return null;
  }
}

function encode(snapshot, secret) {
  const data = Buffer.from(JSON.stringify(snapshot));
  if (data.length > 128_000) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secret, iv);
  cipher.setAAD(context);
  const ciphertext = Buffer.concat([cipher.update(deflateRawSync(data)), cipher.final()]);
  const sealed = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
  return sealed.length <= chunkSize * chunkCount ? sealed : null;
}

function error(status, message) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const incomingRoute = incoming.pathname === '/api/workecho' ? incoming.searchParams.get('route') : null;
    const incomingPath = incomingRoute ? '/api/' + incomingRoute.replace(/^\/+/, '') : incoming.pathname;
    if (incomingPath.startsWith('/api/wispr/')) {
      const { createWisprHandler } = await import('../server/wispr.mjs');
      return createWisprHandler({secret:process.env.WORKECHO_DEMO_KEY,origin:process.env.APP_ORIGIN??'https://workecho-psi.vercel.app'})
        (new Request(new URL(incomingPath + incoming.search, incoming.origin),request));
    }
    if (process.env.DATABASE_URL) {
      const { createNeonHandler } = await import('../server/neon.mjs');
      const source = new URL(request.url);
      const route = source.pathname === '/api/workecho' ? source.searchParams.get('route') : null;
      const path = route ? '/api/' + route.replace(/^\/+/, '') : source.pathname;
      if (!/^\/api\/[\w:/-]+$/.test(path)) return error(404, 'This page could not be found.');
      if (!process.env.APP_ORIGIN) return error(503,'The workspace origin is not configured.');
      try {
        const handler = await createNeonHandler();
        return await handler(new Request(new URL(path,source.origin), request));
      } catch { return error(503,'The workspace is temporarily unavailable. Your unsaved text is still on screen.'); }
    }
    // A configured backend owns durable records. Cookie snapshots are only the isolated rehearsal mode.
    if (process.env.WORKECHO_BACKEND_URL) {
      const backend = process.env.WORKECHO_BACKEND_URL.replace(/\/$/, '');
      if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/workecho$/.test(backend)) return error(503, 'The workspace backend is not configured correctly.');
      const source = new URL(request.url);
      const route = source.pathname === '/api/workecho' ? source.searchParams.get('route') : null;
      const path = route ? '/api/' + route.replace(/^\/+/, '') : source.pathname;
      if (!/^\/api\/[\w:/-]+$/.test(path)) return error(404, 'This page could not be found.');
      const headers = new Headers();
      for (const name of ['cookie','origin','content-type','content-length']) {
        const value = request.headers.get(name); if (value) headers.set(name,value);
      }
      headers.set('x-workecho-client', request.headers.get('x-vercel-forwarded-for') ?? 'global');
      try {
        const upstream = await fetch(backend + path, { method: request.method, headers,
          body: request.body, ...(request.body ? { duplex: 'half' } : {}), redirect: 'error', signal: AbortSignal.timeout(27000) });
        const output = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        for (const value of upstream.headers.getSetCookie()) output.append('Set-Cookie',value);
        return new Response(upstream.body,{status:upstream.status,headers:output});
      } catch { return error(503,'The workspace is temporarily unavailable. Your unsaved text is still on screen.'); }
    }
    const key = process.env.WORKECHO_DEMO_KEY;
    if (!key || !/^[\w-]{43}$/.test(key)) return error(503, 'WorkEcho is unavailable. Try again later.');
    const secret = Buffer.from(key, 'base64url');
    const url = new URL(request.url);
    const route = url.pathname === '/api/workecho' ? url.searchParams.get('route') : null;
    const path = route ? '/api/' + route.replace(/^\/+/, '') : url.pathname;
    if (!/^\/api\/[\w:/-]+$/.test(path) || path === '/api/workecho') return error(404, 'This page could not be found.');
    const cookies = new Map((request.headers.get('cookie') ?? '').split(';').map((entry) => {
      const separator = entry.indexOf('=');
      return [entry.slice(0, separator).trim(), entry.slice(separator + 1)];
    }));
    const db = openStore(':memory:', cookies.has('we_session') ? decode(cookies, secret) : null);
    try {
      const input = request.body ? Readable.fromWeb(request.body) : Readable.from([]);
      input.method = request.method;
      input.url = path;
      input.headers = Object.fromEntries(request.headers);
      const headers = new Headers();
      let status = 500;
      let body;
      await createRequestHandler(db, { appOrigin: url.origin, secureCookies: true, speechKey: '', workspace: false })(input, {
        appendHeader: (name, value) => headers.append(name, value),
        setHeader: (name, value) => headers.set(name, value),
        writeHead(code, options) {
          status = code;
          for (const [name, value] of Object.entries(options)) headers.set(name, value);
        },
        end: (value) => { body = value; },
      });

      if (request.method !== 'GET' && status < 400) {
        const snapshot = db.demoSnapshot();
        const sealed = snapshot.sessions.length ? encode(snapshot, secret) : '';
        if (sealed === null) return error(413, 'This demo session is full. Export your history, then reset the demo.');
        for (let index = 0; index < chunkCount; index++) {
          const name = prefix + index;
          const chunk = sealed.slice(index * chunkSize, (index + 1) * chunkSize);
          if (!chunk && !cookies.has(name)) continue;
          headers.append('Set-Cookie', name + '=' + chunk + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + (chunk ? SESSION_SECONDS : 0));
        }
      }
      return new Response(body, { status, headers });
    } finally {
      db.close();
    }
  },
};
