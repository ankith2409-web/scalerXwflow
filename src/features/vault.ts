import type {DraftData} from '../workspace/types';
export type DraftAttempt={version:number;operation:string;data:DraftData};
export type DeviceSnapshot={workerId:string;intakeId:string;version:number;saved:string;data:DraftData;attempt:DraftAttempt|null};
export type SealedDraft={schema:1;salt:string;iv:string;ciphertext:string;expires:number};
const bytes=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const base64=(value:Uint8Array)=>{let s='';for(const c of value)s+=String.fromCharCode(c);return btoa(s);};
export async function deriveVaultKey(passphrase:string,salt:Uint8Array){
  if(passphrase.length<12||passphrase.length>256)throw new Error('Use a passphrase of 12–256 characters.');
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(passphrase),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:new Uint8Array(salt),iterations:210000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function sealDraft(snapshot:DeviceSnapshot,key:CryptoKey,salt:string,expires=Date.now()+7*86400000):Promise<SealedDraft>{
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('workecho-device-v1:'+expires)},key,new TextEncoder().encode(JSON.stringify(snapshot)));
  return {schema:1,salt,iv:base64(iv),ciphertext:base64(new Uint8Array(cipher)),expires};
}
export async function openDraft(record:SealedDraft,passphrase:string){
  if(record.schema!==1||record.expires<Date.now())throw new Error('Device draft expired.');
  const key=await deriveVaultKey(passphrase,bytes(record.salt));
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(record.iv),additionalData:new TextEncoder().encode('workecho-device-v1:'+record.expires)},key,bytes(record.ciphertext));
  const snapshot=JSON.parse(new TextDecoder().decode(plain)) as DeviceSnapshot;
  if(!snapshot.workerId||!snapshot.intakeId||!snapshot.data?.source||!Number.isInteger(snapshot.version))throw new Error('Invalid device draft.');
  return {key,snapshot};
}
export const newVaultSalt=()=>base64(crypto.getRandomValues(new Uint8Array(16)));
export const keyFromSalt=(passphrase:string,salt:string)=>deriveVaultKey(passphrase,bytes(salt));
function scope(){return new URLSearchParams(location.search).get('demo')==='1'?'demo':'worker';}
async function database(){return new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open('workecho-private-drafts',1);req.onupgradeneeded=()=>req.result.createObjectStore('vault');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function operation<T>(mode:IDBTransactionMode,action:(store:IDBObjectStore)=>IDBRequest<T>){const db=await database();try{return await new Promise<T>((resolve,reject)=>{const tx=db.transaction('vault',mode),req=action(tx.objectStore('vault'));let result:T;req.onsuccess=()=>{result=req.result;};tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
export async function loadVault(){const record=await operation<SealedDraft|undefined>('readonly',store=>store.get(scope()));if(record&&record.expires<Date.now()){await clearVault();return undefined;}return record;}
export const saveVault=(record:SealedDraft)=>operation('readwrite',store=>store.put(record,scope()));
export async function clearVault(){await operation('readwrite',store=>store.delete(scope()));window.dispatchEvent(new Event('workecho-vault-cleared'));}
