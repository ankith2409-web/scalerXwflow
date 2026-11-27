import {createPortal} from 'react-dom';
import {useEffect,useState} from 'react';
import {qrcodegen} from '../vendor/qrcodegen';
import {Dialog} from '../ui';
import {fieldKeys,type History,type Locale} from '../workspace/types';
import {messages} from '../workspace/i18n';
import {featureCopy} from './copy';
import type {Feature,PeriodDetails} from './types';
type Report={type:'history';rows:History[];metadata:Feature<PeriodDetails>[];language:Locale}|{type:'card';code:string;language:Locale};
export function showPrint(report:Report){window.dispatchEvent(new CustomEvent('workecho-print',{detail:report}));}
export function QrCode({text}:{text:string}){
  const qr=qrcodegen.QrCode.encodeText(text,qrcodegen.QrCode.Ecc.MEDIUM),parts:string[]=[];
  for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.getModule(x,y))parts.push(`M${x+4},${y+4}h1v1h-1z`);
  return <svg className="feature-qr" viewBox={`0 0 ${qr.size+8} ${qr.size+8}`} role="img" aria-label="Private recovery QR code"><rect width="100%" height="100%" fill="white"/><path d={parts.join('')} fill="black"/></svg>;
}
function PrintContent({report}:{report:Report}){
  const c=featureCopy(report.language),t=messages[report.language];
  if(report.type==='card')return <article className="feature-return-card" lang={report.language}><p>WORKECHO · WISPR FLOW × SCALER</p><h1>{c.returnCard}</h1><QrCode text={location.origin+'/#recovery='+report.code}/><code>{report.code}</code><p>{location.origin}/history</p><p>{c.cardHelp}</p></article>;
  const dates=new Map(report.metadata.filter(x=>x.kind==='details').map(x=>[x.historyId,x.data]));
  return <article className="feature-report" lang={report.language}><p>WORKECHO · WISPR FLOW × SCALER</p><h1>{c.report}</h1><p>{new Date().toLocaleDateString(report.language==='en'?'en-IN':report.language+'-IN')} · {report.rows.length} {t.histories}</p><p>{c.timelineHelp}</p>{report.rows.map(row=><section key={row.id}><h2>{row.fields.place??row.fields.task??t.correction}</h2><dl>{fieldKeys.map((key,i)=><div key={key}><dt>{t.fields[i]}</dt><dd>{row.fields[key]??t.missing}</dd></div>)}</dl>{dates.get(row.id)?.historyVersion!==undefined&&dates.get(row.id)!.historyVersion!==row.version&&<p>{c.stale}</p>}{dates.get(row.id)&&<p>{c.dates}: {periodLabel(dates.get(row.id)!,report.language)}</p>}{dates.get(row.id)?.location&&<p>{c.location}: {dates.get(row.id)!.location!.label} ({dates.get(row.id)!.location!.lat}, {dates.get(row.id)!.location!.lon}), ±{dates.get(row.id)!.location!.radiusMeters} m</p>}<h3>{c.source}</h3><blockquote>{row.source?.text??t.noSource}</blockquote><p>{c.matching}: {row.permissions.matching?c.yes:c.no} · {c.outreach}: {row.permissions.outreach?c.yes:c.no}</p><small>Record {row.id} · Version {row.version} · {new Date(row.confirmedAt).toLocaleDateString()}</small></section>)}</article>;
}
export function periodLabel(data:PeriodDetails,language:Locale){const c=featureCopy(language);return data.certainty==='unknown'?c.undated:(data.certainty==='approximate'?'≈ ':'')+(data.startYear??'?')+' – '+(data.ongoing?c.ongoing:data.endYear??'?');}
export function PrintHost(){
  const [report,setReport]=useState<Report|null>(null);
  useEffect(()=>{const handler=(event:Event)=>setReport((event as CustomEvent<Report>).detail);window.addEventListener('workecho-print',handler);return()=>window.removeEventListener('workecho-print',handler);},[]);
  if(!report)return null;const c=featureCopy(report.language);
  return <><Dialog title={report.type==='card'?c.returnCard:c.report} closeLabel={c.close} onClose={()=>setReport(null)}><p>{report.type==='card'?c.cardHelp:c.pdfHelp}</p><div className="feature-print-preview"><PrintContent report={report}/></div><button className="v2-primary" onClick={()=>window.print()}>{c.print}</button></Dialog>{createPortal(<div id="workecho-print"><PrintContent report={report}/></div>,document.body)}</>;
}
