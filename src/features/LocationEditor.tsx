import {useId,useState} from 'react';
import type {Locale} from '../workspace/types';
import type {MapLocation} from './types';
import {featureCopy} from './copy';
export function LocationEditor({value,onChange,language='en',sharing=true}:{value:MapLocation|null;onChange:(v:MapLocation|null)=>void;language?:Locale;sharing?:boolean}) {
  const c=featureCopy(language),id=useId(),[loaded,setLoaded]=useState(false);
  if(!value)return <button type="button" className="v2-outline" onClick={()=>onChange({lat:NaN,lon:NaN,radiusMeters:1000,label:'',shared:false})}>{c.addLocation}</button>;
  const valid=Number.isFinite(value.lat)&&Math.abs(value.lat)<=90&&Number.isFinite(value.lon)&&Math.abs(value.lon)<=180;
  const bounds=valid?[Math.max(-180,value.lon-.04),Math.max(-90,value.lat-.03),Math.min(180,value.lon+.04),Math.min(90,value.lat+.03)].join(','):'';
  return <fieldset className="feature-location"><legend>{c.location}</legend><p className="v2-muted">{c.mapHelp}</p>
    <div className="feature-two"><label htmlFor={id+'-lat'}>{c.lat}<input id={id+'-lat'} type="number" step="0.00001" min={-90} max={90} required value={Number.isFinite(value.lat)?value.lat:''} onChange={e=>{setLoaded(false);onChange({...value,lat:e.target.value===''?NaN:Number(e.target.value)});}}/></label><label htmlFor={id+'-lon'}>{c.lon}<input id={id+'-lon'} type="number" step="0.00001" min={-180} max={180} required value={Number.isFinite(value.lon)?value.lon:''} onChange={e=>{setLoaded(false);onChange({...value,lon:e.target.value===''?NaN:Number(e.target.value)});}}/></label></div>
    <label htmlFor={id+'-area'}>{c.area}<select id={id+'-area'} value={value.radiusMeters} onChange={e=>onChange({...value,radiusMeters:Number(e.target.value)})}>{[100,500,1000,5000,10000].map(n=><option key={n} value={n}>{n>=1000?n/1000+' km':n+' m'}</option>)}</select></label>
    <label htmlFor={id+'-label'}>{c.label}<input id={id+'-label'} maxLength={200} value={value.label} onChange={e=>onChange({...value,label:e.target.value})}/></label>
    {sharing&&<label className="feature-check"><input type="checkbox" checked={value.shared} onChange={e=>onChange({...value,shared:e.target.checked})}/>{c.shareLocation}</label>}
    <p className="v2-muted">{c.mapPrivacy}</p><div className="v2-actions"><button type="button" className="v2-outline" disabled={!valid} onClick={()=>setLoaded(true)}>{c.showMap}</button><button type="button" className="v2-text" onClick={()=>{setLoaded(false);onChange(null);}}>{c.clearLocation}</button></div>
    {loaded&&valid&&<div className="feature-map"><iframe title={c.location} src={'https://www.openstreetmap.org/export/embed.html?bbox='+encodeURIComponent(bounds)+'&layer=mapnik&marker='+value.lat+','+value.lon} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-popups"/><p><a href={'https://www.openstreetmap.org/?mlat='+value.lat+'&mlon='+value.lon+'#map=14/'+value.lat+'/'+value.lon} target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> · {value.radiusMeters>=1000?value.radiusMeters/1000+' km':value.radiusMeters+' m'} approximate radius</p><a href={'https://www.google.com/maps/search/?api=1&query='+value.lat+','+value.lon} target="_blank" rel="noreferrer">Open these coordinates in Google Maps</a></div>}
  </fieldset>;
}
