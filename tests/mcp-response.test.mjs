import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readMcpResponse} from '../server/mcp-response.mjs';
test('MCP JSON replies must match the request and preserve provider errors as failures',async()=>{
  assert.deepEqual(await readMcpResponse(Response.json({jsonrpc:'2.0',id:2,result:{content:[]}}),2),{content:[]});
  for(const body of [{jsonrpc:'2.0',id:1,result:{}},{jsonrpc:'2.0',id:2,error:{message:'private provider detail'}},{jsonrpc:'2.0',id:2,result:{isError:true}},{}])await assert.rejects(readMcpResponse(Response.json(body),2),{status:422});
});
test('MCP handles multiline chunked SSE without waiting for connection closure',{timeout:1000},async()=>{
  let cancelled=false;
  const bytes=new TextEncoder().encode(': keepalive\r\nevent: message\r\ndata: {"jsonrpc":"2.0",\r\ndata: "id":2,"result":{"text":"ಬೆಂಗಳೂರು"}}\r\n\r\n');
  const stream=new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.slice(i,i+3));},cancel(){cancelled=true;}});
  assert.deepEqual(await readMcpResponse(new Response(stream,{headers:{'content-type':'text/event-stream'}}),2),{text:'ಬೆಂಗಳೂರು'});assert.equal(cancelled,true);
});
test('MCP ignores other RPC ids and accepts a final SSE event without a trailing blank line',async()=>{
  const text='data: {"jsonrpc":"2.0","method":"notifications/message","params":{}}\n\ndata: {"jsonrpc":"2.0","id":99,"result":{}}\n\ndata: {"jsonrpc":"2.0","id":2,"result":{"content":[]}}';
  assert.deepEqual(await readMcpResponse(new Response(text,{headers:{'content-type':'text/event-stream'}}),2),{content:[]});
  await assert.rejects(readMcpResponse(new Response(': heartbeat\n\n',{headers:{'content-type':'text/event-stream'}}),2),{status:422});
});
test('MCP limits response size while reading and cancels oversized streams',async()=>{
  let cancelled=false;
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(1_000_001));},cancel(){cancelled=true;}});
  await assert.rejects(readMcpResponse(new Response(stream),2),{status:413});assert.equal(cancelled,true);
});
