import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {createWisprHandler,discoverWispr} from '../server/wispr.mjs';

test('Wispr uses PKCE, rejects callback forgery and hides tokens from the browser',async()=>{
  const origin='https://workecho.test',secret=randomBytes(32).toString('base64url'),requests=[];
  let streamed=false;
  const handler=createWisprHandler({secret,origin,fetcher:async(url,init={})=>{
    requests.push({url,init});
    if(url.includes('oauth-protected-resource'))return Response.json({authorization_servers:['https://mcp-auth.wisprflow.com']});
    if(url.includes('oauth-authorization-server'))return Response.json({authorization_endpoint:'https://mcp-auth.wisprflow.com/authorize',token_endpoint:'https://mcp-auth.wisprflow.com/token',registration_endpoint:'https://mcp-auth.wisprflow.com/register'});
    if(url.endsWith('/register'))return Response.json({client_id:'test-client'});
    if(url.endsWith('/token')){assert.ok(init.body.get('code_verifier'));return Response.json({access_token:'private-test-access-token',expires_in:3600});}
    if(url.endsWith('/connect/mcp')){
      const call=JSON.parse(init.body);assert.equal(init.headers.Authorization,'Bearer private-test-access-token');
      if(call.method==='notifications/initialized')return new Response(null,{status:202});
      const value={jsonrpc:'2.0',id:call.id,result:call.method==='initialize'?{protocolVersion:'2025-06-18'}:{content:[{type:'text',text:JSON.stringify({meetings:[{id:'test-meeting',title:'Worker interview'}]})}]}};
      if(streamed)return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify(value)+'\n\n'));}}),{headers:{'content-type':'text/event-stream'}});
      return Response.json(value);
    }
    throw new Error('Unexpected endpoint');
  }});
  const jar=new Map();
  const call=async(path,method='GET',data,source=origin)=>{
    const response=await handler(new Request(origin+path,{method,headers:{origin:source,'content-type':'application/json',cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},body:data?JSON.stringify(data):undefined}));
    for(const value of response.headers.getSetCookie()){assert.match(value,/Secure; HttpOnly/);const [pair]=value.split(';');const i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}
    return response;
  };
  assert.equal((await call('/api/wispr/connect','POST',null,'https://evil.test')).status,403);
  const start=await call('/api/wispr/connect','POST');assert.equal(start.status,200);
  const auth=new URL((await start.json()).url);
  assert.equal(auth.searchParams.get('code_challenge_method'),'S256');assert.equal(auth.searchParams.get('resource'),'https://api.wisprflow.ai/connect/mcp');
  const pending=jar.get('we_wispr_pending');assert.ok(!pending.includes('test-client'));
  assert.equal((await call('/api/wispr/callback?code=fake&state='+'x'.repeat(43))).status,400);
  jar.set('we_wispr_pending',pending);
  const complete=await call('/api/wispr/callback?code=authorized&state='+auth.searchParams.get('state'));
  assert.equal(complete.status,200);assert.ok(!(await complete.text()).includes('private-test-access-token'));
  assert.equal((await(await call('/api/wispr/status')).json()).connected,true);
  const search=await call('/api/wispr/meetings','POST',{query:'worker'});assert.equal(search.status,200);
  assert.ok(!(await search.text()).includes('private-test-access-token'));
  streamed=true;const streamedSearch=await call('/api/wispr/meetings','POST',{query:'worker'});assert.equal(streamedSearch.status,200);assert.ok((await streamedSearch.json()).content.length);
  await call('/api/wispr/disconnect','POST');assert.equal((await(await call('/api/wispr/status')).json()).connected,false);
});

test('Wispr discovery rejects an unexpected resource or untrusted issuer before sending further requests',async()=>{
  for(const metadata of [{resource:'https://untrusted.example',authorization_servers:['https://mcp-auth.wisprflow.com']},{authorization_servers:['http://127.0.0.1']},{authorization_servers:['https://wisprflow.ai.untrusted.example']}]){
    let calls=0;await assert.rejects(discoverWispr(async()=>{calls++;return Response.json(metadata);}),{status:503});assert.equal(calls,1);
  }
});
