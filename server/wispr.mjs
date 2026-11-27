// A standalone OAuth/PKCE MCP client. Credentials stay in encrypted HttpOnly cookies.
// Only read-only meeting search and transcript retrieval are exposed to the UI.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { RequestError } from './errors.mjs';
const server = 'https://api.wisprflow.ai/connect/mcp';
const random = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('base64url');
function trusted(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/(^|\.)wisprflow\.(ai|com)$/.test(url.hostname) || url.username || url.password) throw new RequestError(503,'Wispr returned an unsupported authorization address.');
  return url.href;
}
function seal(value,key) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('workecho-wispr-v1'));
  const bytes=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64url');
}
function unseal(value,key) {
  try {
    const bytes=Buffer.from(value,'base64url'),cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));
    cipher.setAAD(Buffer.from('workecho-wispr-v1'));cipher.setAuthTag(bytes.subarray(12,28));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8'));
  } catch { return null; }
}
export function createWisprHandler({ secret, origin, fetcher=fetch }={}) {
  const key=/^[\w-]{43}$/.test(secret??'')?Buffer.from(secret,'base64url'):null;
  async function fetchJson(url,init={}) {
    const response=await fetcher(trusted(url),{...init,redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!response.ok) throw new RequestError(response.status===401?401:503,response.status===401?'Reconnect your Wispr Flow account.':'Wispr Flow is unavailable. Your account text is still here.');
    const data=await response.json();return data;
  }
  async function discovery() {
    const metadata=await fetchJson('https://api.wisprflow.ai/.well-known/oauth-protected-resource/connect/mcp');
    const issuer=new URL(trusted(metadata.authorization_servers?.[0]));
    const configuration=await fetchJson(issuer.origin+'/.well-known/oauth-authorization-server'+issuer.pathname.replace(/\/$/,''));
    return {authorization:trusted(configuration.authorization_endpoint),token:trusted(configuration.token_endpoint),registration:trusted(configuration.registration_endpoint)};
  }
  async function mcp(access,name,args) {
    let session;
    async function send(method,params,id=1) {
      const headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:'Bearer '+access,'MCP-Protocol-Version':'2025-06-18'};
      if(session)headers['Mcp-Session-Id']=session;
      const response=await fetcher(server,{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(12000),body:JSON.stringify({jsonrpc:'2.0',...(id===null?{}:{id}),method,params})});
      if(!response.ok)throw new RequestError(response.status===401?401:503,'Wispr could not complete this request. Reconnect or import a text file.');
      session=response.headers.get('mcp-session-id')??session;
      if(id===null||response.status===202)return null;
      const text=await response.text();if(text.length>1000000)throw new RequestError(413,'Choose a shorter transcript.');
      const result=response.headers.get('content-type')?.includes('text/event-stream')
        ? text.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>{try{return JSON.parse(line.slice(5));}catch{return null;}}).find(value=>value?.id===id)
        :JSON.parse(text);
      if(!result||result.error||result.result?.isError)throw new RequestError(422,'Wispr could not return that meeting. Check your account permissions.');
      return result.result;
    }
    const hello=await send('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'WorkEcho',version:'0.2.0'}});
    if(!hello)throw new RequestError(503,'Wispr connection could not initialize.');
    await send('notifications/initialized',{},null);
    return send('tools/call',{name,arguments:args},2);
  }
  return async request=>{
    const url=new URL(request.url),route=url.pathname;
    const headers=new Headers({'Cache-Control':'no-store','Content-Type':'application/json'});
    const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
    const cookies=new Map((request.headers.get('cookie')??'').split(';').map(part=>{const i=part.indexOf('=');return [part.slice(0,i).trim(),part.slice(i+1)];}));
    const set=(name,value,seconds,lax=false)=>headers.append('Set-Cookie',name+'='+value+'; Path=/; Secure; HttpOnly; SameSite='+(lax?'Lax':'Strict')+'; Max-Age='+seconds);
    const auth=key?unseal([0,1,2].map(i=>cookies.get('we_wispr_'+i)??'').join(''),key):null;
    try {
      if(route==='/api/wispr/status')return respond({available:Boolean(key),connected:Boolean(auth?.access&&auth.expires>Date.now())});
      if(!key)throw new RequestError(503,'Wispr account connection is not configured. You can still import transcript text.');
      if(request.method!=='GET'&&request.headers.get('origin')!==origin)throw new RequestError(403,'Open WorkEcho to connect your account.');
      if(route==='/api/wispr/disconnect'&&request.method==='POST'){
        for(let i=0;i<3;i++)set('we_wispr_'+i,'',0);return respond({connected:false});
      }
      if(route==='/api/wispr/connect'&&request.method==='POST'){
        const endpoints=await discovery(),redirect=origin+'/api/wispr/callback';
        const client=await fetchJson(endpoints.registration,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'WorkEcho',redirect_uris:[redirect],grant_types:['authorization_code'],response_types:['code'],token_endpoint_auth_method:'none'})});
        if(typeof client.client_id!=='string')throw new RequestError(503,'Wispr did not register this app.');
        const state=random(),verifier=random();
        const pending=seal({state,verifier,client:client.client_id,token:endpoints.token,expires:Date.now()+600000},key);
        if(pending.length>3500)throw new RequestError(503,'Wispr authorization metadata is too large.');
        set('we_wispr_pending',pending,600,true);
        const target=new URL(endpoints.authorization);
        for(const [k,v]of Object.entries({client_id:client.client_id,response_type:'code',redirect_uri:redirect,state,code_challenge:digest(verifier),code_challenge_method:'S256',resource:server}))target.searchParams.set(k,v);
        return respond({url:target.href});
      }
      if(route==='/api/wispr/callback'&&request.method==='GET'){
        const pending=unseal(cookies.get('we_wispr_pending')??'',key),state=url.searchParams.get('state')??'';
        set('we_wispr_pending','',0,true);
        if(!pending||pending.expires<Date.now()||!/^[\w-]{43}$/.test(state)||state.length!==pending.state.length||!timingSafeEqual(Buffer.from(state),Buffer.from(pending.state)))throw new RequestError(400,'Wispr authorization expired. Reopen WorkEcho and connect again.');
        const code=url.searchParams.get('code');if(!code)throw new RequestError(400,'Wispr authorization was declined.');
        const result=await fetchJson(pending.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,client_id:pending.client,redirect_uri:origin+'/api/wispr/callback',code_verifier:pending.verifier,resource:server})});
        if(typeof result.access_token!=='string')throw new RequestError(503,'Wispr did not return an access token.');
        const lifetime=Math.min(3600,Number(result.expires_in)||3600);
        const value=seal({access:result.access_token,expires:Date.now()+lifetime*1000},key);
        if(value.length>9000)throw new RequestError(503,'Wispr returned credentials larger than this app supports.');
        for(let i=0;i<3;i++)set('we_wispr_'+i,value.slice(i*3000,(i+1)*3000),lifetime);
        headers.set('Content-Type','text/plain; charset=utf-8');
        return new Response('Wispr Flow connected. Close this window and return to your WorkEcho account.',{headers});
      }
      if(!auth?.access||auth.expires<Date.now())throw new RequestError(401,'Connect your Wispr Flow account first.');
      if(request.method!=='POST')throw new RequestError(405,'Use the WorkEcho account import screen.');
      if(Number(request.headers.get('content-length'))>4096)throw new RequestError(413,'Search text is too long.');
      const raw=await request.text();if(raw.length>4096)throw new RequestError(413,'Search text is too long.');
      let data;try{data=JSON.parse(raw);}catch{throw new RequestError(400,'Invalid request.');}
      if(route==='/api/wispr/meetings'){
        if(typeof data.query!=='string'||data.query.length>150)throw new RequestError(400,'Enter a short meeting search.');
        return respond(await mcp(auth.access,'search_meetings',{query:data.query,limit:10}));
      }
      if(route==='/api/wispr/transcript'){
        if(typeof data.meeting_id!=='string'||data.meeting_id.length>200)throw new RequestError(400,'Choose a meeting.');
        return respond(await mcp(auth.access,'get_meeting',{meeting_id:data.meeting_id,view_content:{char_limit:1000},view_transcript:{char_limit:12000}}));
      }
      throw new RequestError(404,'Page not found.');
    }catch(error){return respond({error:error.status?error.message:'Wispr connection could not be completed. Import your transcript as text.'},error.status??503);}
  };
}
