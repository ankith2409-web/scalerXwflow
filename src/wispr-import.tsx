import { useEffect, useState } from 'react';
import { jsonPost, request } from './voice';
import { Spinner } from './ui';
import { wisprCopy } from './workspace/wispr-copy';
import type { Locale } from './workspace/types';
type Meeting = {id:string;title:string};
function unpack(value: unknown): Record<string,unknown> {
  if(!value||typeof value!=='object')return {};
  const item=value as Record<string,unknown>;
  if(item.structuredContent)return unpack(item.structuredContent);
  if(Array.isArray(item.content))for(const block of item.content){
    if(block?.type==='text')try{return unpack(JSON.parse(block.text));}catch{/* Plain text is not a structured meeting list. */}
  }
  return item;
}
function meetings(value:unknown):Meeting[]{
  const root=unpack(value);
  const candidates=root.meetings??root.results??root.items??(root.data as Record<string,unknown>)?.meetings;
  if(!Array.isArray(candidates))return [];
  return candidates.flatMap(item=>{
    const id=item.meeting_id??item.id;
    return typeof id==='string'?[{id,title:String(item.title??item.name??'Recorded meeting')}]:[];
  });
}
function transcript(value:unknown):string{
  const root=unpack(value);
  const item=root.transcript??root.transcript_text??(root.meeting as Record<string,unknown>)?.transcript;
  if(typeof item==='string')return item;
  if(item&&typeof item==='object'){
    const data=item as Record<string,unknown>;
    if(typeof data.text==='string')return data.text;
    if(typeof data.content==='string')return data.content;
  }
  return '';
}
export function WisprImport({onImport,language='en'}:{onImport:(value:string,meetingId:string)=>void;language?:Locale}){
  const c=wisprCopy[language];
  const [connected,setConnected]=useState(false),[available,setAvailable]=useState(false),[busy,setBusy]=useState(false);
  const [query,setQuery]=useState(''),[items,setItems]=useState<Meeting[]>([]),[error,setError]=useState(''),[searched,setSearched]=useState(false);
  const [meetingId,setMeetingId]=useState('');
  const refresh=()=>request<{connected:boolean;available:boolean}>('/api/wispr/status').then(value=>{setConnected(value.connected);setAvailable(value.available);}).catch(()=>setAvailable(false));
  useEffect(()=>{void refresh();window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh);},[]);
  async function run(task:()=>Promise<void>){setBusy(true);setError('');try{await task();}catch(error){setError((error as Error).message==='Transcript too long'?c.long:c.error);}finally{setBusy(false);}}
  async function load(id:string){await run(async()=>{
    const result=await request<unknown>('/api/wispr/transcript',jsonPost({meeting_id:id}));
    const text=transcript(result);if(!text)throw new Error('No transcript');if(text.length>12000||/\[.*(?:truncated|continuation|start_char).*\]/i.test(text))throw new Error('Transcript too long');onImport(text,id);
  });}
  if(!available)return <p className="muted">{c.unavailable}</p>;
  return <section className="wispr-connect" aria-label="Wispr Flow account" aria-busy={busy}>
    <h2>{c.title}</h2>
    <p className="muted">{c.help}</p>
    {!connected?<button className="quiet" type="button" disabled={busy} onClick={()=>{
      const popup=window.open('about:blank','workecho-wispr','width=600,height=720');
      void run(async()=>{try{const {url}=await request<{url:string}>('/api/wispr/connect',{method:'POST'});if(popup)popup.location.href=url;else window.location.assign(url);}catch(error){popup?.close();throw error;}});
    }}>{busy?<Spinner/>:null}{c.connect}</button>:<>
      <label className="field-label" htmlFor="wispr-query">{c.find}</label>
      <input id="wispr-query" className="line-input" value={query} maxLength={150} onChange={e=>setQuery(e.target.value)} />
      <button className="quiet" type="button" disabled={busy} onClick={()=>void run(async()=>{
        const value=await request<unknown>('/api/wispr/meetings',jsonPost({query}));setItems(meetings(value));setSearched(true);
      })}>{busy?<Spinner/>:null}{c.search}</button>
      {items.map(item=><button className="queue-item" key={item.id} type="button" disabled={busy} onClick={()=>void load(item.id)}>{item.title}</button>)}
      {searched&&!items.length&&<p className="muted">{c.empty}</p>}
      <details><summary>{c.useId}</summary><label className="field-label" htmlFor="wispr-id">{c.id}</label>
        <input id="wispr-id" className="line-input" value={meetingId} maxLength={200} onChange={e=>setMeetingId(e.target.value)} />
        <button className="quiet" type="button" disabled={busy||!meetingId.trim()} onClick={()=>void load(meetingId.trim())}>{c.load}</button>
      </details>
      <button className="quiet" type="button" disabled={busy} onClick={()=>void run(async()=>{await request('/api/wispr/disconnect',{method:'POST'});setConnected(false);setItems([]);})}>{c.disconnect}</button>
    </>}
    {error&&<p className="notice" role="alert">{error}</p>}
  </section>;
}
