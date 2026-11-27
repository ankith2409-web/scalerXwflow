import { useEffect, useRef, useState } from 'react';
import { ApiError, jsonPost, request } from '../voice';
import { blankDraft, type Draft, type DraftData, type History, type Locale, type Page, type Session } from './types';
import { messages } from './i18n';
import {clearVault,type DeviceSnapshot,type DraftAttempt} from '../features/vault';
import {featureCopy} from '../features/copy';

export function useWorkspace() {
  const initialLanguage = (): Locale => { try { const v = localStorage.getItem('workecho-language'); return v === 'hi' || v === 'kn' ? v : 'en'; } catch { return 'en'; } };
  const [data, setData] = useState<DraftData>(() => blankDraft(initialLanguage()));
  const recoveryRequested=useRef(/^#recovery=[\w-]{43}$/.test(location.hash));
  const [page, setPage] = useState<Page>(recoveryRequested.current?'restore':location.pathname === '/history' ? 'history' : 'capture');
  const [session, setSession] = useState<Session | null>(null), [ready, setReady] = useState(false);
  const [consent, setConsent] = useState(false), [code, setCode] = useState('');
  const [records, setRecords] = useState<History[]>([]), [revision, setRevision] = useState<History | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [draftState, setDraftState] = useState<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle');
  const [online,setOnline]=useState(navigator.onLine);
  const attempt=useRef<DraftAttempt|null>(null);
  const intake = useRef(''), version = useRef(0), saved = useRef(''), generation = useRef(0);
  const pending = useRef<Promise<void>>(Promise.resolve()), creating = useRef<Promise<string> | null>(null);
  const operation = useRef<string | null>(null), latest = useRef(data), permitted = useRef(consent), finalized = useRef(false);
  const halted = useRef(false), mounted = useRef(true);
  const paused = useRef(false), latestRevision = useRef(revision);
  const identity=useRef(session);identity.current=session;
  latest.current = data; permitted.current = consent;
  latestRevision.current = revision;
  const t = messages[data.language];
  const hasContent = Boolean(data.source.text.trim() || Object.values(data.fields).some(Boolean));
  function errorMessage(error: unknown) {
    const c = messages[latest.current.language];
    return error instanceof ApiError ? error.status === 409 ? c.conflict : error.status === 401 ? c.unauthorized : error.status === 429 ? c.rateLimit : c.unavailable : c.unavailable;
  }
  function go(next: Page, replace = false) {
    setPage(next);
    const path = (next === 'history' ? '/history' : '/') + location.search;
    if (location.pathname + location.search !== path) history[replace ? 'replaceState' : 'pushState']({}, '', path);
  }
  function applyDraft(draft: Draft) {
    intake.current = draft.id; version.current = draft.version; saved.current = JSON.stringify(draft.data);
    finalized.current = false; halted.current = false; setRevision(null); setData(draft.data); setConsent(true); setDraftState('saved');
    go(draft.data.page, true); setNotice(messages[draft.data.language].draftRestored);
  }
  async function reloadDraft() { const draft = await request<Draft | null>('/api/draft'); if (draft) applyDraft(draft); else reset(); }
  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const state = await request<Session>('/api/session'); if (!mounted.current) return; setSession(state);
        if (state.active) {
          const [draft, rows] = await Promise.all([request<Draft | null>('/api/draft'), location.pathname === '/history' ? request<History[]>('/api/history') : Promise.resolve([])]);
          if (!mounted.current) return;
          if (draft && location.pathname !== '/history'&&!recoveryRequested.current) applyDraft(draft);
          setRecords(rows);
        }
      } catch (error) { if (mounted.current) setNotice(errorMessage(error)); }
      finally { if (mounted.current) setReady(true); }
    })();
    const pop = () => setPage(location.pathname === '/history' ? 'history' : latest.current.page);
    window.addEventListener('popstate', pop);
    return () => { mounted.current = false; window.removeEventListener('popstate', pop); };
  }, []);
  useEffect(() => { document.documentElement.lang = data.language; try { localStorage.setItem('workecho-language', data.language); } catch { /* Language preference is optional. */ } }, [data.language]);
  async function ensureIntake() {
    if (intake.current) return intake.current;
    if (!permitted.current) throw new Error('Save permission required');
    if (!creating.current) creating.current = (async () => {
      const d = latest.current;
      const value = await request<{ id: string; code?: string;workerId:string }>('/api/intakes', jsonPost({ language: d.language, save: true, voice: false, ...d.permissions }));
      intake.current = value.id; if (value.code) setCode(value.code);
      setSession(s => s && ({ ...s, active: true,workerId:value.workerId })); return value.id;
    })().finally(() => { creating.current = null; });
    return creating.current;
  }
  function flush(snapshot = latest.current): Promise<void> {
    const stamp = generation.current;
    const job = async () => {
      if (stamp !== generation.current || finalized.current || halted.current || paused.current || !permitted.current) return;
      if (!snapshot.source.text.trim() && !Object.values(snapshot.fields).some(Boolean)) return;
      const serialized = JSON.stringify(snapshot); if (serialized === saved.current&&!attempt.current) return;
      if(!navigator.onLine){setDraftState('error');throw new Error('offline');}
      setDraftState('saving');
      try {
        const id = await ensureIntake();
        do {
          attempt.current??={version:version.current,operation:crypto.randomUUID(),data:snapshot};
          const result=await request<Draft>('/api/intakes/'+id+'/draft',jsonPost(attempt.current));
          if(stamp!==generation.current)return;
          version.current=result.version;saved.current=JSON.stringify(attempt.current.data);attempt.current=null;
        }while(saved.current!==serialized);
        setDraftState('saved');
      } catch (error) {
        const conflict = error instanceof ApiError && error.status === 409;
        halted.current = conflict; setDraftState(conflict ? 'conflict' : 'error'); throw error;
      }
    };
    const next = pending.current.catch(() => {}).then(job); pending.current = next; return next;
  }
  useEffect(() => {
    if (!ready || !consent || revision || finalized.current || !hasContent || halted.current) return;
    const timer = setTimeout(() => { void flush(data).catch(() => {}); }, 650);
    return () => clearTimeout(timer);
  }, [data, consent, ready, revision, hasContent]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      const editing = latestRevision.current && JSON.stringify(latest.current.fields) !== JSON.stringify(latestRevision.current.fields);
      if (editing || (!finalized.current && (latest.current.source.text.trim() || Object.values(latest.current.fields).some(Boolean)) && JSON.stringify(latest.current) !== saved.current)) { e.preventDefault(); }
    };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, []);
  async function run(task: () => Promise<void>) { setBusy(true); setNotice(''); try { await task(); } catch (error) { setNotice(errorMessage(error)); } finally { setBusy(false); } }
  function update(patch: Partial<DraftData>) { setData(d => ({ ...d, ...patch })); }
  function move(next: 'capture' | 'review') { setData(d => ({ ...d, page: next })); go(next); }
  async function prepare() { await run(async () => {
    if(!navigator.onLine){const next={...latest.current,page:'review' as const};latest.current=next;setData(next);go('review');setNotice(featureCopy(next.language).offlineReady);return;}
    const id = await ensureIntake(); let next = { ...latest.current, page: 'review' as const };
    if (next.mode === 'story') {
      const result = await request<{ fields: DraftData['fields']; evidence: DraftData['evidence']; method: 'model' | 'rules'; reason: string | null; language: string | null }>('/api/intakes/' + id + '/extract', jsonPost({ transcript: next.source.text, allowAI: next.source.aiAllowed }));
      next = { ...next, fields: result.fields, evidence: result.evidence, source: { ...next.source, analysis: result.method, language: result.language } };
      if (result.reason === 'model-unavailable') setNotice(t.aiFallback);
    }
    latest.current = next; setData(next); await flush(next); go('review');
  }); }
  async function confirm() { await run(async () => {
    if(!navigator.onLine)throw new Error('offline');
    if (halted.current) throw new ApiError(409, 'Draft changed');
    await flush(); await pending.current; operation.current ??= crypto.randomUUID();
    const d = latest.current;
    const path = revision ? '/api/history/' + revision.id : '/api/intakes/' + await ensureIntake() + '/confirm';
    const result = await request<History>(path, { ...jsonPost({ confirmed: true, fields: d.fields, evidence: d.evidence, source: d.source, permissions: d.permissions, operation: operation.current, ...(revision ? { version: revision.version } : {}) }), method: revision ? 'PATCH' : 'POST' });
    finalized.current = true; saved.current = JSON.stringify(d); setDraftState('idle'); setRevision(null); setRecords([result]);go('saved');await clearVault().catch(()=>{});
  }); }
  function reset() { generation.current++;attempt.current=null; intake.current = ''; version.current = 0; saved.current = ''; operation.current = null; finalized.current = false; halted.current = false; setData(blankDraft(latest.current.language)); setRevision(null); setDraftState('idle'); setNotice(''); go('capture'); }
  async function newJob() { await run(async () => { await pending.current.catch(() => {}); if (intake.current && !finalized.current) await request('/api/intakes/' + intake.current + '/draft', { method: 'DELETE' });await clearVault().catch(()=>{}); reset(); }); }
  async function openHistory() { await run(async () => { if (consent && !finalized.current && !revision) await flush(); setRecords(session?.active ? await request<History[]>('/api/history') : []); go('history'); }); }
  async function restore(value: string) { await run(async () => {
    const result = await request<Session>('/api/session/restore', jsonPost({ code: value.trim() }));recoveryRequested.current=false; setSession(result); setCode('');
    const draft = await request<Draft | null>('/api/draft'); if (draft) applyDraft(draft); else { reset(); setRecords(await request<History[]>('/api/history')); go('history'); }
  }); }
  async function closeWorker() { await run(async () => { if (!revision && !finalized.current) await flush(); await request('/api/session', { method: 'DELETE' });await clearVault().catch(()=>{}); reset(); setCode(''); setConsent(false); setRecords([]); setSession(s => s && ({ ...s, active: false,workerId:null })); }); }
  function correct(row: History) { operation.current = null; finalized.current = true; setRevision(row); setData({ ...blankDraft(data.language), page: 'review', source: row.source ?? blankDraft(data.language).source, fields: row.fields, evidence: row.evidence, permissions: row.permissions }); go('review'); }
  async function withdraw(row: History) { await run(async () => { await request('/api/history/' + row.id + '/sharing', { method: 'DELETE' }); setRecords(rows => rows.map(item => item.id === row.id ? { ...item, sharing: false, permissions: { matching: false, outreach: false } } : item)); setNotice(t.withdrawn); }); }
  async function rotate() { await run(async () => { const value = await request<{ code: string }>('/api/session/recovery-code', { method: 'POST' }); setCode(value.code); }); }
  async function removeRecord(row:History){await run(async()=>{
    await request('/api/history/'+row.id,{...jsonPost({confirmed:true,version:row.version}),method:'DELETE'});
    setRecords(rows=>rows.filter(item=>item.id!==row.id));
    if(finalized.current){setData(blankDraft(latest.current.language));setRevision(null);intake.current='';saved.current='';}
  });}
  async function savePermission(allowed: boolean) {
    if (allowed) { setConsent(true); return; }
    await run(async () => {
      paused.current = true;
      try {
        await pending.current.catch(() => {});
        if (intake.current && !finalized.current) await request('/api/intakes/' + intake.current + '/draft', { method: 'DELETE' });
        setConsent(false); version.current = 0; saved.current = ''; setDraftState('idle');
        attempt.current=null;await clearVault().catch(()=>{});
      } finally { paused.current = false; }
    });
  }
  async function restoreDevice(snapshot:DeviceSnapshot){
    if(navigator.onLine){
      const current=await request<Session>('/api/session');
      if(!current.active||current.workerId!==snapshot.workerId)throw new Error('identity');
      const server=await request<Draft|null>('/api/draft');
      if(!server||server.id!==snapshot.intakeId||(server.version!==snapshot.version&&(!snapshot.attempt||server.version!==snapshot.attempt.version+1)))throw new Error('conflict');
      setSession(current);
    }else if(session?.active&&session.workerId!==snapshot.workerId)throw new Error('identity');
    else setSession(s=>s??{active:false,workerId:snapshot.workerId,workspace:new URLSearchParams(location.search).get('demo')!=='1'});
    generation.current++;intake.current=snapshot.intakeId;version.current=snapshot.version;saved.current=snapshot.saved;attempt.current=snapshot.attempt;
    finalized.current=false;halted.current=false;setRevision(null);setConsent(true);latest.current=snapshot.data;setData(snapshot.data);setDraftState('error');go(snapshot.data.page,true);
  }
  useEffect(()=>{const off=()=>setOnline(false);const on=()=>{setOnline(true);if(permitted.current&&!finalized.current&&!halted.current&&!latestRevision.current)void(async()=>{const state=await request<Session>('/api/session');if(!state.active||state.workerId!==identity.current?.workerId){setNotice(featureCopy(latest.current.language).deviceIdentity);return;}setSession(state);await flush();})().catch(()=>{});};window.addEventListener('online',on);window.addEventListener('offline',off);return()=>{window.removeEventListener('online',on);window.removeEventListener('offline',off);};},[]);
  async function syncDevice(){if(halted.current||finalized.current||!permitted.current)throw new Error('Draft is not ready to sync');await flush();if(saved.current!==JSON.stringify(latest.current)||attempt.current)throw new Error('Draft has not been accepted');}
  const deviceSynced=JSON.stringify(data)===saved.current&&!attempt.current;
  const deviceSnapshot:DeviceSnapshot|null=consent&&!revision&&!finalized.current&&session?.workerId&&intake.current?{workerId:session.workerId,intakeId:intake.current,version:version.current,saved:saved.current,data,attempt:attempt.current}:null;
  return { data, update, page, go, move, session, ready, consent, savePermission, code, records, revision, busy, notice, setNotice, t, draftState, hasContent, run, flush, prepare, confirm, newJob, openHistory, reloadDraft, restore, closeWorker, correct, withdraw, rotate, removeRecord,online,deviceSnapshot,restoreDevice,deviceSynced,syncDevice, unfinished: Boolean((hasContent && !finalized.current) || (revision && JSON.stringify(data.fields) !== JSON.stringify(revision.fields))) };
}
