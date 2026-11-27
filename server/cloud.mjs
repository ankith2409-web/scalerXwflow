import { createHash, randomBytes } from 'node:crypto';
import { compare, nextStates } from './staff-demo.mjs';
import { extractAccount, translateReview } from './intelligence.mjs';
import { captureFormat, transcribe } from './speech.mjs';
import { RequestError } from './errors.mjs';
import { readSource, readPermissions, readDraft, validateEvidence, interfaceLanguages } from './account.mjs';
import { semanticScores } from './matching.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const uuid = (value) => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const keys = ['place','task','period','landmark','alias'];
const cookieName = { worker: 'we_cloud_worker', staff: 'we_cloud_staff' };
const maxAge = 12 * 60 * 60;
function entry(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new RequestError(400,'Check the work details.');
  return Object.fromEntries(keys.map((key) => {
    const text = value[key];
    if (text !== null && (typeof text !== 'string' || !text.trim() || text.length > 500)) throw new RequestError(400,'An answer is blank or too long.');
    return [key, typeof text === 'string' ? text.trim() : null];
  }));
}
async function readBody(request, limit = 65536) {
  if (Number(request.headers.get('content-length')) > limit) throw new RequestError(413,'The answer is too large.');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new RequestError(413,'The answer is too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
  return bytes;
}
async function json(request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new RequestError(415,'Send JSON.');
  let value;
  try { value = JSON.parse(new TextDecoder().decode(await readBody(request))); }
  catch (error) { if (error.status) throw error; throw new RequestError(400,'Invalid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError(400,'Invalid JSON.');
  return value;
}

export function createCloudHandler({ url, serviceKey, origin, speechKey = '', aiKey = '', fetcher = fetch, rpc: injectedRpc } = {}) {
  const call = injectedRpc ?? (async (action, credential = '', input = {}) => {
    const response = await fetcher(url + '/rest/v1/rpc/we_api', {
      method:'POST', headers:{ apikey:serviceKey, Authorization:'Bearer ' + serviceKey, 'Content-Type':'application/json' },
      body:JSON.stringify({ p_action:action,p_token:credential,p_input:input }), signal:AbortSignal.timeout(12000),
    });
    const data = await response.json();
    if (!response.ok) {
      const match = /^(\d{3})\|(.+)$/.exec(data.message ?? '');
      throw new RequestError(match ? Number(match[1]) : 503, match?.[2] ?? 'The workspace is unavailable. Try again.');
    }
    return data;
  });
  const rpc = async (...args) => {
    const result = await call(...args);
    if (result?._error) throw new RequestError(result._error,result.message);
    return result;
  };
  return async (request) => {
    const headers = new Headers({ 'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff' });
    const setCookie = (kind, value, age=maxAge) => headers.append('Set-Cookie',cookieName[kind] + '=' + value + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + age);
    const respond = (data, status=200) => new Response(JSON.stringify(data),{status,headers});
    try {
      const requestUrl = new URL(request.url);
      const path = requestUrl.pathname.replace(/^(?:\/functions\/v1)?\/workecho(?=\/|$)/, '') || '/';
      const method = request.method;
      if (!['GET','POST','PATCH','DELETE'].includes(method)) throw new RequestError(405,'Operation unavailable.');
      if (!origin || (method !== 'GET' && request.headers.get('origin') !== origin)) throw new RequestError(403,'Open WorkEcho to submit this request.');
      const cookies = new Map((request.headers.get('cookie')??'').split(';').map((item)=> { const i=item.indexOf('='); return [item.slice(0,i).trim(),item.slice(i+1)]; }));
      const worker = cookies.get(cookieName.worker) ?? '';
      const staff = cookies.get(cookieName.staff) ?? '';
      const capabilities = { cloud:true,workspace:true,voiceAvailable:Boolean(speechKey),analysisAvailable:Boolean(aiKey),embeddingsAvailable:Boolean(aiKey) };
      const rateKey = hash(request.headers.get('x-workecho-client') || 'global');
      if (path==='/api/session' && method==='GET') return respond({...await rpc('session',worker),...capabilities});
      if (path==='/api/session' && method==='DELETE') { await rpc('signout',worker); setCookie('worker','',0); return respond({active:false}); }
      if (path==='/api/session/restore' && method==='POST') {
        const {code}=await json(request);
        if (typeof code!=='string' || !/^[\w-]{43}$/.test(code.trim())) throw new RequestError(401,'Check your recovery code.');
        const value=token();
        await rpc('restore','',{recoveryHash:hash(code.trim()),tokenHash:hash(value),rateKey});
        setCookie('worker',value); return respond({active:true,...capabilities});
      }
      if (path==='/api/session/recovery-code' && method==='POST') {
        const code=token(); await rpc('recovery',worker,{recoveryHash:hash(code)}); return respond({code});
      }
      if (path==='/api/intakes' && method==='POST') {
        const data=await json(request);
        if (!interfaceLanguages.includes(data.language) || data.save!==true || typeof data.voice!=='boolean' || ['matching','outreach'].some(k=>data[k]!==undefined && typeof data[k]!=='boolean')) throw new RequestError(400,'Choose a language and allow saving.');
        let credential=worker, code;
        if (!(await rpc('session',worker)).active) {
          credential=token(); code=token();
          await rpc('new_worker','',{tokenHash:hash(credential),recoveryHash:hash(code),rateKey});
          setCookie('worker',credential);
        }
        return respond({...await rpc('intake',credential,{...data,matching:data.matching===true,outreach:data.outreach===true}),...(code?{code}:{})},201);
      }
      if (path==='/api/staff/session') {
        if (method==='GET') return respond({...await rpc('staff_session',staff),...capabilities});
        if (method==='DELETE') { await rpc('signout',staff); setCookie('staff','',0); return respond({active:false}); }
        if (method==='POST') {
          const {email,password,setupCode}=await json(request);
          if (typeof email!=='string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 || typeof password!=='string' || password.length<12 || Buffer.byteLength(password)>72 || (setupCode!==undefined && typeof setupCode!=='string')) throw new RequestError(400,'Enter an email and a password of 12–72 bytes.');
          const value=token();
          await rpc('staff_login','',{email,password,setupCode,tokenHash:hash(value),rateKey:hash(email.trim().toLowerCase())});
          setCookie('staff',value); return respond({active:true});
        }
      }
      if (path.startsWith('/api/staff/')) {
        const staffSession = await rpc('staff_session',staff);
        if (!staffSession.active) throw new RequestError(401,'Sign in to the staff workspace.');
        if (path==='/api/staff/accounts' && method==='POST') {
          const {email,password,role}=await json(request);
          if (typeof email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||typeof password!=='string'||password.length<12||Buffer.byteLength(password)>72||!['admin','reviewer','health'].includes(role)) throw new RequestError(400,'Enter a valid email, role and a password of 12–72 bytes.');
          return respond(await rpc('staff_add',staff,{email,password,role}),201);
        }
        const records = async () => (await rpc('staff_records',staff)).map(item=>({...item,id:item.id+':'+item.version+':direct'}));
        const candidates = async (rows) => {
          const [sources,decisions] = await Promise.all([rows ?? rpc('staff_records',staff),rpc('staff_decisions',staff)]);
          const scores = await semanticScores(sources,{key:aiKey,fetcher});
          const byId=new Map(decisions.map(item=>[item.id,item]));
          return sources.filter(x=>x.matching).flatMap((left,i,all)=>all.slice(i+1).filter(right=>right.worker!==left.worker).flatMap(right=>{
            const match=compare(left,right); if(!match.show) return [];
            const id=left.id+':'+left.version+':'+right.id+':'+right.version;
            const decision=byId.get(id);
            const similarity=scores.get(left.id+':'+right.id);
            return [{id,left,right,...match,...(similarity===undefined?{}:{semanticSimilarity:Math.round(similarity*1000)/1000}),status:decision?.status??'waiting',reason:decision?.reason??'',version:decision?.version??0,rulesVersion:1,referral:false,outreach:left.outreach}];
          })).sort((a,b)=>(b.semanticSimilarity??-1)-(a.semanticSimilarity??-1));
        };
        const referrals = async () => (await rpc('staff_referrals',staff)).map(item=>({...item,actions:item.outreach?(nextStates[item.status]??[]).filter(action=>action!=='approved'||['admin','health'].includes(staffSession.role)):[]}));
        if (path==='/api/staff/overview' && method==='GET') {
          const sources=await rpc('staff_records',staff);
          return respond({records:sources.map(item=>({...item,id:item.id+':'+item.version+':direct'})),matches:await candidates(sources),referrals:await referrals(),window:200});
        }
        if (path==='/api/staff/records' && method==='GET') return respond(await records());
        if (path==='/api/staff/matches' && method==='GET') return respond(await candidates());
        if (path==='/api/staff/referrals' && method==='GET') return respond(await referrals());
        const match = path.match(/^\/api\/staff\/(matches|referrals)\/([\w:-]+)\/(decision|transition)$/);
        if (match && method==='POST') {
          const data=await json(request);
          if (!uuid(data.operation)||!Number.isSafeInteger(data.version)||typeof data.reason!=='string'||!data.reason.trim()||data.reason.length>280||typeof data.status!=='string') throw new RequestError(400,'Enter a short reason and review the current version.');
          if (match[1]==='matches' && match[3]==='decision') {
            if (!['accepted','unresolved','rejected'].includes(data.status)) throw new RequestError(400,'Choose a review decision.');
            const candidate=(await candidates()).find(x=>x.id===match[2]);
            if(!candidate) throw new RequestError(404,'This candidate changed or is unavailable.');
            return respond(await rpc('staff_decide',staff,{...data,target:match[2],left:candidate.left.id,right:candidate.right.id,leftVersion:candidate.left.version,rightVersion:candidate.right.version,eligible:candidate.eligible}));
          }
          if (match[1]==='referrals' && match[3]==='transition') {
            const parts=match[2].split(':');
            if (!uuid(parts[0])||!/^\d+$/.test(parts[1]??'')||parts[2]!=='direct') throw new RequestError(404,'Referral not found.');
            return respond(await rpc('staff_transition',staff,{...data,target:match[2],history:parts[0],historyVersion:Number(parts[1])}));
          }
        }
      }
      if (path==='/api/history' && method==='GET') return respond(await rpc('history',worker));
      if (path==='/api/draft' && method==='GET') return respond(await rpc('draft',worker));
      const draft=path.match(/^\/api\/intakes\/([\w-]+)\/draft$/);
      if (draft && uuid(draft[1])) {
        if (method==='DELETE') return respond(await rpc('draft_discard',worker,{id:draft[1]}));
        if (method==='POST') {
          const data=await json(request);
          if (!uuid(data.operation)||!Number.isSafeInteger(data.version)||data.version<0) throw new RequestError(400,'Check the draft version.');
          return respond(await rpc('draft_save',worker,{id:draft[1],operation:data.operation,version:data.version,data:readDraft(data.data)}));
        }
      }
      const sharing=path.match(/^\/api\/history\/([\w-]+)\/sharing$/);
      if (sharing && uuid(sharing[1]) && method==='DELETE') return respond(await rpc('withdraw',worker,{id:sharing[1]}));
      const history=path.match(/^\/api\/history\/([\w-]+)$/);
      const intake=path.match(/^\/api\/intakes\/([\w-]+)\/(confirm|turns|extract|translate)$/);
      if (history && uuid(history[1]) && method==='PATCH' || intake && uuid(intake[1]) && intake[2]==='confirm' && method==='POST') {
        const data=await json(request); const fields=entry(data.fields);
        if(data.confirmed!==true||!uuid(data.operation)||!Object.values(fields).some(Boolean)||history&&!Number.isSafeInteger(data.version)) throw new RequestError(400,'Review and confirm your history.');
        const source=readSource(data.source),evidence=entry(data.evidence??fields);
        if (!history) validateEvidence(evidence,source);
        return respond(await rpc(history?'revise':'confirm',worker,{...data,id:history?.[1]??intake[1],fields,evidence,
          ...(source?{source}:{}),...(data.permissions===undefined?{}:{permissions:readPermissions(data.permissions)})}));
      }
      if (intake && uuid(intake[1]) && method==='POST') {
        const current=await rpc('intake_get',worker,{id:intake[1]});
        if(intake[2]==='extract') {
          const {transcript,allowAI}=await json(request); await rpc('reserve',worker);
          return respond(await extractAccount(transcript,{key:allowAI===true?aiKey:'',fetcher}));
        }
        if(intake[2]==='translate') {
          const {fields,language,allowAI}=await json(request); await rpc('reserve',worker);
          return respond(await translateReview(fields,language,{key:allowAI===true?aiKey:'',fetcher}));
        }
        if(intake[2]==='turns') {
          if(!current.voice) throw new RequestError(403,'Voice processing was declined.');
          if(!speechKey) throw new RequestError(503,'Recording service unavailable. Use browser dictation or type.');
          const type=request.headers.get('content-type')?.split(';')[0];
          if(!['audio/webm','audio/ogg','audio/mp4'].includes(type)) throw new RequestError(415,'Unsupported recording format.');
          const buffer=Buffer.from(await readBody(request,1000000)); const extension=captureFormat(type,buffer);
          await rpc('reserve',worker);
          return respond({transcript:await transcribe({key:speechKey,buffer,type,extension})});
        }
      }
      throw new RequestError(404,'This page could not be found.');
    } catch(error) {
      return respond({error:error.status?error.message:'The workspace is unavailable. Your unsaved text is still on screen.'},error.status??503);
    }
  };
}
