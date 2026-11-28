import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { createRequestHandler } from '../server/index.mjs';
import { openStore, SESSION_SECONDS } from '../server/store.mjs';
import {aiConfig} from '../server/ai-config.mjs';
import {createNeonAIBudget} from '../server/ai-budget.mjs';

const prefix = '__Host-workecho-demo-';
const chunkSize = 3400;
const chunkCount = 2;
const context = Buffer.from('workecho-demo-v1');
const sandboxCookie='__Host-workecho-sandbox';

function decode(cookies, secret) {
  const chunks = Array.from({ length: chunkCount }, (_, index) => cookies.get(prefix + index) ?? '');
  if (!chunks[0] || chunks.some((value) => !/^[\w-]{0,3400}$/.test(value))) return null;
  return decodeSealed(chunks.join(''),secret,128_000);
}
function decodeSealed(value,secret,maxOutputLength=2_400_000){
  try {
    const sealed = Buffer.from(value, 'base64url');
    const cipher = createDecipheriv('aes-256-gcm', secret, sealed.subarray(0, 12));
    cipher.setAAD(context);
    cipher.setAuthTag(sealed.subarray(12, 28));
    const data = Buffer.concat([cipher.update(sealed.subarray(28)), cipher.final()]);
    return JSON.parse(inflateRawSync(data, { maxOutputLength }).toString('utf8'));
  } catch {
    return null;
  }
}

function encode(snapshot, secret, limit=chunkSize*chunkCount) {
  const data = Buffer.from(JSON.stringify(snapshot));
  if (data.length > (limit>chunkSize*chunkCount?2_400_000:128_000)) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secret, iv);
  cipher.setAAD(context);
  const ciphertext = Buffer.concat([cipher.update(deflateRawSync(data)), cipher.final()]);
  const sealed = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
  return sealed.length <= limit ? sealed : null;
}

function error(status, message) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}
function forwardedUrl(source,path){
  const result=new URL(path,source.origin);result.search=source.search;result.searchParams.delete('route');return result;
}

export function createVercelHandler({sandboxRpc:injectedSandboxRpc}={}){return {
  async fetch(request) {
    const incoming = new URL(request.url);
    const incomingRoute = incoming.pathname === '/api/workecho' ? incoming.searchParams.get('route') : null;
    let incomingPath = incomingRoute ? '/api/' + incomingRoute.replace(/^\/+/, '') : incoming.pathname;
    const demo = incomingPath.startsWith('/api/demo/');
    if (demo) {
      incomingPath = '/api/' + incomingPath.slice('/api/demo/'.length);
      request = new Request(forwardedUrl(incoming,incomingPath), request);
      if (incomingPath === '/api/wispr/status') return Response.json({ available: false, connected: false });
      if (incomingPath.startsWith('/api/wispr/')) return error(403, 'Account connections are disabled in the fictional demo.');
    }
    if (incomingPath.startsWith('/api/wispr/')) {
      const { createWisprHandler } = await import('../server/wispr.mjs');
      return createWisprHandler({secret:process.env.WORKECHO_DEMO_KEY,origin:process.env.APP_ORIGIN??'https://workecho-psi.vercel.app'})
        (new Request(new URL(incomingPath + incoming.search, incoming.origin),request));
    }
    if (!demo && process.env.DATABASE_URL) {
      const { createNeonHandler } = await import('../server/neon.mjs');
      const source = new URL(request.url);
      const route = source.pathname === '/api/workecho' ? source.searchParams.get('route') : null;
      const path = route ? '/api/' + route.replace(/^\/+/, '') : source.pathname;
      if (!/^\/api\/[\w:/-]+$/.test(path)) return error(404, 'This page could not be found.');
      if (!process.env.APP_ORIGIN) return error(503,'The workspace origin is not configured.');
      try {
        const handler = await createNeonHandler();
        const headers = new Headers(request.headers);
        headers.set('x-workecho-client', request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || 'global');
        return await handler(new Request(forwardedUrl(source,path), new Request(request, { headers })));
      } catch { return error(503,'The workspace is temporarily unavailable. Your unsaved text is still on screen.'); }
    }
    // A configured backend owns durable records. Cookie snapshots are only the isolated rehearsal mode.
    if (!demo && process.env.WORKECHO_BACKEND_URL) {
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
        const upstream = await fetch(backend + path + forwardedUrl(source,path).search, { method: request.method, headers,
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
    let sandboxRpc,sandboxVersion=0,sandboxToken=cookies.get(sandboxCookie),snapshot;
    try {
      if(process.env.DATABASE_URL){
        if(injectedSandboxRpc)sandboxRpc=injectedSandboxRpc;
        else{const {createNeonRpc}=await import('../server/neon.mjs');sandboxRpc=await createNeonRpc();}
        if(sandboxToken&&/^[\w-]{43}$/.test(sandboxToken)){
          const result=await sandboxRpc('sandbox','',{action:'read',hash:createHash('sha256').update(sandboxToken).digest('hex')});
          if(result){sandboxVersion=result.version;snapshot=decodeSealed(result.payload,secret);}
        }else sandboxToken=randomBytes(32).toString('base64url');
      }
    }catch{return error(503,'The fictional demo is temporarily unavailable. Try again.');}
    const db = openStore(':memory:', cookies.has('we_session') ? snapshot??decode(cookies, secret) : null);
    try {
      const input = request.body ? Readable.fromWeb(request.body) : Readable.from([]);
      input.method = request.method;
      input.url = path + url.search;
      input.headers = Object.fromEntries(request.headers);
      const headers = new Headers();
      let status = 500;
      let body;
      const configured=aiConfig(process.env,{demo:true});
      const demoAI=Boolean(process.env.DATABASE_URL&&configured.key);
      await createRequestHandler(db, { appOrigin: url.origin, secureCookies: true, speechKey: '', aiKey: demoAI?configured.key:'',aiProvider:configured.provider,aiModel:configured.model,
        ...(demoAI?{aiGate:await createNeonAIBudget(),aiIp:request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()||'global'}:{}),workspace: false })(input, {
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
        if(sandboxRpc){
          const sealed=snapshot.sessions.length?encode(snapshot,secret,3_200_000):'';
          if(sealed===null)return error(413,'This demo session is full. Download your history, then reset the demo.');
          try{await sandboxRpc('sandbox','',{action:'write',hash:createHash('sha256').update(sandboxToken).digest('hex'),version:sandboxVersion,payload:sealed});}
          catch(failure){return error(failure.status??503,failure.status===409?'The demo changed in another tab. Retry the action.':'The fictional demo could not save this action. Try again.');}
          headers.append('Set-Cookie',sandboxCookie+'='+sandboxToken+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+SESSION_SECONDS);
          for(let index=0;index<chunkCount;index++)if(cookies.has(prefix+index))headers.append('Set-Cookie',prefix+index+'=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
          return new Response(body,{status,headers});
        }
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
};}
export default createVercelHandler();
