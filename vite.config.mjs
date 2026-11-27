import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {createHash} from 'node:crypto';

export default defineConfig({ plugins: [react(),{
  name:'workecho-offline-shell',
  generateBundle(_options,bundle){
    const assets=Object.keys(bundle).filter(name=>/\.(js|css)$/.test(name)).map(name=>'/'+name);
    const version=createHash('sha256').update(assets.join('|')).digest('hex').slice(0,16);
    this.emitFile({type:'asset',fileName:'sw.js',source:`const CACHE='workecho-shell-${version}',ASSETS=${JSON.stringify(['/',...assets])};
self.addEventListener('install',e=>e.waitUntil((async()=>{const cache=await caches.open(CACHE);await Promise.all(ASSETS.map(async path=>{const response=await fetch(path,{credentials:'omit',cache:'reload'});if(!response.ok)throw new Error('Shell asset unavailable: '+path+' ('+response.status+')');await cache.put(path,response);}));await self.skipWaiting();})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('workecho-shell-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',e=>{const url=new URL(e.request.url);if(e.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(async()=>{const response=await caches.match('/');return response||Response.error();}));return;}if(ASSETS.includes(url.pathname))e.respondWith(caches.match(url.pathname).then(cached=>cached||fetch(e.request)));});`});
  },
}] });
