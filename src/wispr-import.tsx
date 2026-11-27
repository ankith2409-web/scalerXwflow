import { useEffect, useState } from 'react';
import { jsonPost, request } from './voice';
import { Spinner } from './ui';
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
export function WisprImport({onImport}:{onImport:(value:string)=>void}){
  const [connected,setConnected]=useState(false),[available,setAvailable]=useState(false),[busy,setBusy]=useState(false);
  const [query,setQuery]=useState(''),[items,setItems]=useState<Meeting[]>([]),[error,setError]=useState(''),[searched,setSearched]=useState(false);
  const [meetingId,setMeetingId]=useState('');
  const refresh=()=>request<{connected:boolean;available:boolean}>('/api/wispr/status').then(value=>{setConnected(value.connected);setAvailable(value.available);}).catch(()=>setAvailable(false));
  useEffect(()=>{void refresh();window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh);},[]);
  async function run(task:()=>Promise<void>){setBusy(true);setError('');try{await task();}catch{setError('Wispr could not complete this request. Reconnect, check transcript permissions, or upload a text file.');}finally{setBusy(false);}}
  async function load(id:string){await run(async()=>{
    const result=await request<unknown>('/api/wispr/transcript',jsonPost({meeting_id:id}));
    const text=transcript(result);if(!text)throw new Error('No transcript');onImport(text.slice(0,12000));
  });}
  if(!available)return <p className="muted">Wispr account connection is available on the hosted app. You can paste or upload an exported transcript here.</p>;
  return <section className="wispr-connect" aria-label="Wispr Flow account" aria-busy={busy}>
    <h2>Import from Wispr Flow</h2>
    <p className="muted">Connect your account to search meeting titles and choose a transcript. Include only the relevant worker’s words before preparing details.</p>
    {!connected?<button className="quiet" type="button" disabled={busy} onClick={()=>{
      const popup=window.open('about:blank','workecho-wispr','width=600,height=720');
      void run(async()=>{try{const {url}=await request<{url:string}>('/api/wispr/connect',{method:'POST'});if(popup)popup.location.href=url;else window.location.assign(url);}catch(error){popup?.close();throw error;}});
    }}>{busy?<Spinner/>:null}Connect Wispr Flow</button>:<>
      <label className="field-label" htmlFor="wispr-query">Find a recorded interview</label>
      <input id="wispr-query" className="line-input" value={query} maxLength={150} onChange={e=>setQuery(e.target.value)} />
      <button className="quiet" type="button" disabled={busy} onClick={()=>void run(async()=>{
        const value=await request<unknown>('/api/wispr/meetings',jsonPost({query}));setItems(meetings(value));setSearched(true);
      })}>{busy?<Spinner/>:null}Search meetings</button>
      {items.map(item=><button className="queue-item" key={item.id} type="button" disabled={busy} onClick={()=>void load(item.id)}>{item.title}</button>)}
      {searched&&!items.length&&<p className="muted">No selectable meetings returned. Search another title or enter the meeting ID from Wispr Flow.</p>}
      <details><summary>Use a meeting ID</summary><label className="field-label" htmlFor="wispr-id">Meeting ID</label>
        <input id="wispr-id" className="line-input" value={meetingId} maxLength={200} onChange={e=>setMeetingId(e.target.value)} />
        <button className="quiet" type="button" disabled={busy||!meetingId.trim()} onClick={()=>void load(meetingId.trim())}>Import selected transcript</button>
      </details>
      <button className="quiet" type="button" disabled={busy} onClick={()=>void run(async()=>{await request('/api/wispr/disconnect',{method:'POST'});setConnected(false);setItems([]);})}>Disconnect Wispr Flow</button>
    </>}
    {error&&<p className="notice" role="alert">{error}</p>}
  </section>;
}
