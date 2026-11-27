import {RequestError} from './errors.mjs';
const limit=1_000_000;
const invalid=()=>new RequestError(422,'Wispr could not return that meeting. Check your account permissions.');
function checked(value,id){
  if(!value||value.jsonrpc!=='2.0'||value.id!==id||value.error||!Object.hasOwn(value,'result')||value.result?.isError)throw invalid();
  return value.result;
}
// Stop as soon as this RPC's response arrives; an SSE connection may stay open.
export async function readMcpResponse(response,id){
  if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw new RequestError(413,'Choose a shorter transcript.');}
  const reader=response.body?.getReader();if(!reader)throw invalid();
  const decoder=new TextDecoder(),sse=response.headers.get('content-type')?.toLowerCase().includes('text/event-stream');
  let size=0,buffer='',data=[];
  function event(){
    if(!data.length)return null;const payload=data.join('\n');data=[];
    let parsed;try{parsed=JSON.parse(payload);}catch{return null;}
    return parsed?.id===id?{value:checked(parsed,id)}:null;
  }
  function line(value){
    if(!value)return event();
    if(value.startsWith('data:'))data.push(value.slice(5).replace(/^ /,''));
    return null;
  }
  try{
    for(;;){
      const chunk=await reader.read();
      if(!chunk.done){size+=chunk.value.byteLength;if(size>limit)throw new RequestError(413,'Choose a shorter transcript.');buffer+=decoder.decode(chunk.value,{stream:true});}
      else buffer+=decoder.decode();
      if(sse){
        for(;;){
          const delimiter=/\r\n|\r|\n/.exec(buffer);if(!delimiter)break;
          if(!chunk.done&&delimiter[0]==='\r'&&delimiter.index===buffer.length-1)break;
          const value=buffer.slice(0,delimiter.index);buffer=buffer.slice(delimiter.index+delimiter[0].length);
          const result=line(value);if(result)return result.value;
        }
        if(chunk.done){if(buffer){const result=line(buffer);if(result)return result.value;}const result=event();if(result)return result.value;throw invalid();}
      }else if(chunk.done){let value;try{value=JSON.parse(buffer);}catch{throw invalid();}return checked(value,id);}
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
