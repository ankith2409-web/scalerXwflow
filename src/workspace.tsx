import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioLines, Plus, Folder, Users, Globe2, RotateCcw, Check, Lock, Info, Volume2, Download, ArrowRight, ArrowLeft, Mic } from 'lucide-react';
import { request, jsonPost, usePlayback } from './voice';
import { Dialog, Skeleton, Spinner } from './ui';
import { fieldKeys, type Fields, type History, type Locale } from './workspace/types';
import { useWorkspace } from './workspace/useWorkspace';
import { privacyCopy } from './workspace/privacy-copy';
import {designCopy} from './workspace/design-copy';
import {aiCopy} from './workspace/ai-copy';
import {PrintHost,showPrint} from './features/print';
import {featureCopy} from './features/copy';
import {DeviceDraft} from './features/DeviceDraft';
import './style.css';
import './features/features.css';
import './rebuilt.css';
const RecordExtras=lazy(()=>import('./features/WorkerExtras').then(m=>({default:m.RecordExtras})));
const HistoryExtras=lazy(()=>import('./features/WorkerExtras').then(m=>({default:m.HistoryExtras})));
const WisprImport = lazy(() => import('./wispr-import').then(module => ({ default: module.WisprImport })));
const StaffWorkspace = lazy(() => import('./staff').then(module => ({ default: module.StaffWorkspace })));

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Workspace() {
  const w = useWorkspace(), { data: d, t } = w,c=designCopy(d.language);
  const a=aiCopy(d.language),provider=w.session?.aiProvider==='gemini'?'Google Gemini':w.session?.aiProvider==='openai'?'OpenAI':'AI';
  const [dialog, setDialog] = useState<'flow' | 'discard' | 'switch' | null>(null), [kept, setKept] = useState(false);
  const [notetaker, setNotetaker] = useState(false), [recovery, setRecovery] = useState('');
  const [translation, setTranslation] = useState<Fields | null>(null);
  const [deleting,setDeleting]=useState<History|null>(null),p=privacyCopy[d.language];
  const editor = useRef<HTMLTextAreaElement>(null), heading = useRef<HTMLHeadingElement>(null), previousPage = useRef(w.page);
  const voice = usePlayback(d.language);
  const demo = new URLSearchParams(location.search).get('demo') === '1', suffix = demo ? '?demo=1' : '';
  useEffect(() => {
    if (previousPage.current !== w.page) heading.current?.focus({ preventScroll: true });
    previousPage.current = w.page;
    window.scrollTo(0, 0); setTranslation(null); voice.stop();
  }, [w.page]);
  useEffect(() => { setTranslation(null); }, [d.fields, d.language]);
  const headings = { capture: t.title, review: t.review, saved: t.saved, history: t.historyTitle, restore: t.restore };
  const stage = w.page === 'capture' ? 0 : w.page === 'review' ? 1 : 2;
  const valueCount = Object.values(d.fields).filter(Boolean).length;
  const canConfirm = w.online && valueCount > 0 && w.draftState !== 'conflict' && (w.consent || !!w.revision);
  const canPrepare = w.consent && w.hasContent && !!w.session && w.draftState !== 'conflict';
  useEffect(()=>{const match=/^#recovery=([\w-]{43})$/.exec(location.hash);if(match){history.replaceState({},'',location.pathname+location.search);setRecovery(match[1]);w.go('restore',true);}},[]);
  function newJob() { if (w.unfinished) setDialog('discard'); else void w.newJob(); }
  async function switchMode(mode: 'story' | 'guided') {
    if (mode !== d.mode && w.unfinished) { if (!window.confirm(t.discardTitle + ' ' + t.discardHelp)) return; await w.newJob(); }
    w.update({ mode }); setNotetaker(false);
  }
  function guidedValue(key: typeof fieldKeys[number], value: string) {
    const fields = { ...d.fields, [key]: value || null };
    const text = fieldKeys.flatMap((key, index) => fields[key] ? [t.fields[index] + ': ' + fields[key]] : []).join('\n');
    w.update({ fields, evidence: { ...fields }, source: { ...d.source, text, analysis: 'manual' } });
  }
  function sharing() { return <fieldset className="v2-consents" disabled={w.busy}>
    <legend>{t.finalChoices}</legend><p className="v2-muted">{t.finalHelp}</p>
    <label><input id="allow-matching" type="checkbox" checked={d.permissions.matching} onChange={e => w.update({ permissions: { ...d.permissions, matching: e.target.checked } })}/>{t.consentMatch}</label>
    <label><input id="allow-outreach" type="checkbox" checked={d.permissions.outreach} onChange={e => w.update({ permissions: { ...d.permissions, outreach: e.target.checked } })}/>{t.consentOutreach}</label>
  </fieldset>; }
  function returnCard() {
    download('workecho-return-card.txt', 'WorkEcho\n' + t.recovery + '\n\n' + location.origin + '/history\n\n' + w.code + '\n\n' + t.recoveryHelp + '\n' + t.codeInput + '\n'); setKept(true);
  }
  function recordText(rows: History[]) { return rows.map(row => [t.correction, new Date(row.confirmedAt).toLocaleString(), ...fieldKeys.map((key, i) => t.fields[i] + ': ' + (row.fields[key] ?? t.missing)), '\n' + t.source + ':\n' + (row.source?.text ?? t.noSource), '\n' + t.finalChoices + '\nMatching: ' + row.permissions.matching + '\nFollow-up: ' + row.permissions.outreach].join('\n')).join('\n\n————\n\n'); }
  function recoveryPanel() { return w.session?.workspace && w.session.active && <section className="v2-recovery">
    <h2>{t.recovery}</h2><p>{t.recoveryHelp}</p>
    {w.code && <><code data-testid="recovery-code">{w.code}</code><div className="v2-actions">
      <button className="v2-text" onClick={() => void navigator.clipboard.writeText(w.code).then(() => { w.setNotice(t.copied); setKept(true); }).catch(() => w.setNotice(t.recoveryHelp))}>{t.copy}</button>
      <button className="v2-outline" onClick={returnCard}><Download size={17}/>{t.downloadCard}</button>
      <button className="v2-outline" onClick={()=>{showPrint({type:'card',code:w.code,language:d.language});setKept(true);}}>{featureCopy(d.language).returnCard} · QR</button>
    </div></>}
    <button className="v2-text" disabled={w.busy} onClick={() => { if (window.confirm(t.rotateWarning+' '+p.rotate)) { setKept(false); void w.rotate(); } }}>{t.rotateCode}</button>
  </section>; }
  function draftStatus() { return <span className={'v2-draft-status ' + w.draftState} role="status">{w.draftState === 'saving' ? t.autosaving : w.draftState === 'saved' ? t.draftSaved : w.draftState === 'error' ? <>{t.draftNotSaved}<button className="v2-text" onClick={() => void w.run(() => w.flush())}>{t.retry}</button></> : w.draftState === 'conflict' ? <>{t.conflict}<button className="v2-text" onClick={() => void w.run(w.reloadDraft)}>{t.reloadDraft}</button></> : t.draftConsent}</span>; }
  return <div className="v2">
    <a className="skip-link" href="#worker-main">{c.skip}</a>
    <aside className="v2-sidebar"><a className="v2-brand" href={'/' + suffix} onClick={e => { e.preventDefault(); newJob(); }}><AudioLines size={28}/>WorkEcho</a>
      <nav aria-label={t.session}>
        <button className={w.page === 'capture' ? 'selected' : ''} disabled={w.busy} onClick={newJob}><Plus size={19}/>{t.newJob}</button>
        <button className={w.page === 'history' ? 'selected' : ''} disabled={w.busy} onClick={() => void w.openHistory()}><Folder size={19}/>{t.histories}</button>
        <a href={'/staff/review' + suffix}><Users size={19}/>{t.staff}</a>
      </nav>
      <div className="v2-sidebar-bottom">{w.session?.active && <button className="v2-text" onClick={() => { setKept(false); setDialog('switch'); }}>{t.anotherWorker}</button>}<div className="v2-powered"><AudioLines size={20}/><span>Wispr Flow × Scaler</span></div></div>
    </aside>
    <main className="v2-main" id="worker-main" tabIndex={-1}><header className="v2-top"><span className="v2-breadcrumb">WorkEcho / {w.page === 'capture' ? t.capture : headings[w.page]}</span>
      <div className="v2-tools"><label><Globe2 size={18}/><select aria-label="Interface language" value={d.language} disabled={w.busy} onChange={e => w.update({ language: e.target.value as Locale })}><option value="en">English</option><option value="hi">हिन्दी</option><option value="kn">ಕನ್ನಡ</option></select></label>
        {w.session?.workspace && <button className="v2-outline" disabled={w.busy} onClick={() => w.go('restore')}><RotateCcw size={16}/>{t.restore}</button>}
        {!demo && <a className="v2-demo-link" href="/?demo=1">{t.demo}</a>}
        {w.session?.active && <button className="v2-text v2-mobile-session" onClick={() => { setKept(false); setDialog('switch'); }}>{t.anotherWorker}</button>}
      </div></header>
      <div className="v2-content">
        {demo && <p className="v2-demo-banner" role="status"><Info size={18}/>{a.demo}</p>}
        <h1 ref={heading} tabIndex={-1}>{headings[w.page]}</h1>
        <p className="v2-intro">{w.page === 'capture' ? t.intro : w.page === 'review' ? t.uncertain : w.page === 'saved' ? t.savedHelp : w.page === 'restore' ? t.recoveryHelp : t.finalHelp}</p>
        {['capture', 'review', 'saved'].includes(w.page) && <ol className="v2-steps" aria-label={t.review}>{[t.stepCapture, t.stepReview, t.stepSave].map((label, i) => <li key={label} className={i <= stage ? 'active' : ''} aria-current={i === stage ? 'step' : undefined}><span>{i < stage ? <Check size={15}/> : i + 1}</span>{label}</li>)}</ol>}
        {w.notice && <p className="v2-message" role="status"><Info size={18}/>{w.notice}{!w.session && <button className="v2-text" onClick={() => location.reload()}>{t.retry}</button>}</p>}
        {!w.ready ? <Skeleton label={t.loading} kind="form"/> : <>
        {w.page === 'capture' && <>
          <div className="v2-capture-layout">
          <section className="v2-capture-panel" aria-busy={w.busy}>
            <div className="v2-section-title"><h2>{t.capture}</h2><button className="v2-outline" onClick={() => setDialog('flow')}><Mic size={17}/>{t.flow}</button></div>
            <p className="v2-ai-status" data-testid="ai-status">{w.session?.analysisAvailable?<><span className="v2-status-dot"/>{a.available} · {provider}</>:a.basic}</p>
            <div className="v2-tabs" role="group" aria-label={t.capture}>
              <button disabled={w.busy} aria-pressed={d.mode === 'story' && !notetaker} onClick={() => void switchMode('story')}>{t.story}</button>
              <button disabled={w.busy} aria-pressed={d.mode === 'guided' && !notetaker} onClick={() => void switchMode('guided')}>{t.guided}</button>
              <button disabled={w.busy || demo} aria-pressed={notetaker} onClick={() => { setNotetaker(true); w.update({ mode: 'story' }); }}>{t.notetaker}</button>
            </div>
            <fieldset disabled={w.busy} className="v2-input-area">
            {notetaker && <Suspense fallback={<Skeleton label={t.loading} kind="form"/>}><WisprImport language={d.language} onImport={(text, meetingId) => { w.update({ source: { ...d.source, text, kind: 'wispr-notetaker', meetingId } }); setNotetaker(false); }}/></Suspense>}
            {d.mode === 'guided' ? <>
              <p className="v2-eyebrow">{d.step + 1} / 5 · {t.fields[d.step]}</p>
              <label className="v2-question" htmlFor="work-account">{t.questions[d.step]}</label><p className="v2-muted">{t.hints[d.step]}</p>
              <textarea ref={editor} id="work-account" rows={3} maxLength={500} value={d.fields[fieldKeys[d.step]] ?? ''} onChange={e => guidedValue(fieldKeys[d.step], e.target.value)}/>
              <div className="v2-actions v2-guided-controls"><button className="v2-text" disabled={!d.step} onClick={() => w.update({ step: Math.max(0, d.step - 1) })}><ArrowLeft size={16}/>{t.previous}</button>
                {d.step < 4 && <button className="v2-outline" onClick={() => { w.update({ step: d.step + 1 }); editor.current?.focus(); }}>{d.fields[fieldKeys[d.step]] ? t.next : t.skip}<ArrowRight size={16}/></button>}
              </div>
            </> : <><label htmlFor="work-account" className="v2-field-label">{t.account}</label><textarea ref={editor} id="work-account" rows={5} maxLength={12000} value={d.source.text} placeholder={t.placeholder} onChange={e => w.update({ source: { ...d.source, text: e.target.value, analysis: 'manual' } })}/><span className="v2-char-count">{d.source.text.length.toLocaleString()} / 12,000</span></>}
            </fieldset>
            <p className="v2-flow-hint"><AudioLines size={18}/>{t.flowShort}</p>
            <details className="v2-help"><summary>{t.flow}</summary><p>{t.flowHelp}</p><p>{t.languageNote}</p></details>
            {d.source.kind === 'example' && <p className="v2-example-mark">{t.exampleMark}</p>}
            {!w.hasContent && <button className="v2-text" disabled={w.busy} onClick={() => w.update({ mode: 'story', source: { ...d.source, text: t.exampleText, kind: 'example' } })}>{t.example}</button>}
          </section>
          <aside className="v2-choice-panel" aria-label={c.choices}><h2>{c.choices}</h2><fieldset className="v2-consents" disabled={w.busy}>
            <label><input id="consent-save" type="checkbox" checked={w.consent} onChange={e => void w.savePermission(e.target.checked)}/>{t.consentSave}</label><p className="v2-muted">{t.consentSaveHelp}</p>
          </fieldset>
          {sharing()}
          <details className="v2-ai-choice" open={Boolean(w.session?.analysisAvailable)}><summary>{c.optional}</summary><fieldset className="v2-consents" disabled={w.busy}><label><input id="consent-ai" type="checkbox" checked={d.source.aiAllowed} disabled={!w.session?.analysisAvailable} onChange={e => w.update({ source: { ...d.source, aiAllowed: e.target.checked } })}/>{a.consent.replace('{provider}',provider)}</label><p className="v2-muted">{w.session?.analysisAvailable ? t.consentAIHelp : t.aiUnavailable}</p></fieldset></details>
          </aside></div>
          <div className="v2-bottom-action"><button className="v2-primary" disabled={w.busy || !canPrepare} onClick={() => void w.prepare()}>{w.busy ? <Spinner/> : <ArrowRight size={18}/>}{d.mode === 'guided' ? t.manualReview : t.prepare}</button>{draftStatus()}</div>
        </>}
        {w.page === 'review' && <>
          <div className="v2-review">
            <section><h2>{t.source}</h2><blockquote>{d.source.text || t.noSource}</blockquote><p className="v2-muted">{t.originalLanguage}: {d.source.language ?? '—'}</p><span className="v2-method">{d.source.analysis === 'model' ? t.ai : t.basic}</span></section>
            <section><h2>{t.correction}</h2><p className="v2-muted">{valueCount}/5 {t.fieldsCount}. {t.uncertain}</p><fieldset disabled={w.busy} className="v2-fields">{fieldKeys.map((key, i) => <label key={key} htmlFor={'field-' + key}>{t.fields[i]}<input id={'field-' + key} maxLength={500} value={d.fields[key] ?? ''} placeholder={t.missing} onChange={e => w.update({ fields: { ...d.fields, [key]: e.target.value || null } })}/>{!d.fields[key] && <small>{t.questions[i]} {t.hints[i]}</small>}{d.evidence[key] && <small>{t.sourceQuote}: “{d.evidence[key]}”</small>}</label>)}</fieldset>
              <div className="v2-actions"><button className="v2-text" onClick={() => { if (voice.playing) voice.stop(); else voice.speak(fieldKeys.map((key, i) => t.fields[i] + ': ' + (d.fields[key] ?? t.missing)).join('. '), () => w.setNotice(t.noVoice)); }}><Volume2 size={17}/>{voice.playing ? t.stopRead : t.read}</button>
              {d.source.aiAllowed && w.session?.analysisAvailable && !w.revision && <button className="v2-text" disabled={w.busy} onClick={() => void w.run(async () => { await w.flush(); const draft = await request<{ id: string }>('/api/draft'); const result = await request<{ available: boolean; fields: Fields }>('/api/intakes/' + draft.id + '/translate', jsonPost({ fields: d.fields, language: d.language, allowAI: true })); if (result.available) setTranslation(result.fields); else w.setNotice(t.translationFailed); })}>{t.translate}</button>}</div>
              {translation && <aside className="v2-translation"><h3>{t.translation}</h3><dl>{fieldKeys.map((key, i) => <div key={key}><dt>{t.fields[i]}</dt><dd>{translation[key] ?? t.missing}</dd></div>)}</dl></aside>}
            </section>
          </div>
          {!w.revision && sharing()}
          <div className="v2-bottom-action"><button className="v2-primary" disabled={w.busy || !canConfirm} onClick={() => void w.confirm()}>{w.busy ? <Spinner/> : <Check size={18}/>}{t.confirm}</button><button className="v2-text" disabled={w.busy} onClick={() => w.revision ? void w.openHistory() : w.move('capture')}>{t.back}</button>{draftStatus()}</div>
        </>}
        {w.page === 'restore' && <form className="v2-restore" onSubmit={e => { e.preventDefault(); void w.restore(recovery); }}><label htmlFor="restore-code">{t.codeInput}</label><input id="restore-code" type="password" value={recovery} onChange={e => setRecovery(e.target.value)} autoComplete="off" spellCheck={false} required/><button className="v2-primary" disabled={w.busy || recovery.trim().length !== 43}>{w.busy && <Spinner/>}{t.reopen}</button></form>}
        {(w.page === 'saved' || w.page === 'history') && <>
          <div className="v2-records">{w.records.length ? w.records.map(row => <article key={row.id}><div className="v2-record-title"><h2>{row.fields.place ?? row.fields.task ?? t.correction}</h2><span>{new Date(row.confirmedAt).toLocaleDateString(d.language === 'en' ? 'en-IN' : d.language + '-IN')}</span></div>
            <dl>{fieldKeys.map((key, i) => <div key={key}><dt>{t.fields[i]}</dt><dd>{row.fields[key] ?? t.missing}</dd></div>)}</dl>
            <details><summary>{t.source}</summary><blockquote>{row.source?.text ?? t.noSource}</blockquote></details>
            <Suspense fallback={<p>{featureCopy(d.language).pending}</p>}><RecordExtras row={row} language={d.language}/></Suspense>
            <div className="v2-permission-summary"><span>{t.consentMatch}: {row.permissions.matching ? '✓' : '—'}</span><span>{t.consentOutreach}: {row.permissions.outreach ? '✓' : '—'}</span></div>
            <div className="v2-actions"><button className="v2-text" disabled={w.busy} onClick={() => w.correct(row)}>{t.correct}</button>{row.sharing && <button className="v2-text" disabled={w.busy} onClick={() => { if (window.confirm(t.withdrawConfirm)) void w.withdraw(row); }}>{t.withdraw}</button>}<button className="v2-text v2-danger" disabled={w.busy} onClick={()=>setDeleting(row)}>{p.remove}</button></div>
          </article>) : <div className="v2-empty"><Folder size={30}/><h2>{t.empty}</h2><p>{t.emptySignedOut}</p><div className="v2-actions"><button className="v2-primary" onClick={newJob}>{t.newJob}</button>{w.session?.workspace && <button className="v2-outline" onClick={() => w.go('restore')}>{t.restore}</button>}</div></div>}</div>
          {recoveryPanel()}
          {!!w.records.length&&<Suspense fallback={<p>{featureCopy(d.language).pending}</p>}><HistoryExtras rows={w.records} language={d.language}/></Suspense>}
          {!!w.records.length && <div className="v2-actions"><button className="v2-primary" onClick={newJob}><Plus size={18}/>{t.newJob}</button><button className="v2-text" onClick={() => download('workecho-history.txt', recordText(w.records))}><Download size={17}/>{t.export}</button>{demo && <a href="/staff/review?demo=1">{t.demoStaff}</a>}</div>}
        </>}
        </>}
        {(w.page === 'capture' || w.page === 'review') && w.code && recoveryPanel()}
        <DeviceDraft snapshot={w.deviceSnapshot} language={d.language} online={w.online} onRestore={w.restoreDevice} onSync={w.syncDevice} synced={w.deviceSynced}/>
        <footer className="v2-footer"><Lock size={17}/><p>{t.purpose}</p></footer>
      </div>
    </main>
    {dialog === 'flow' && <Dialog title={t.flowTitle} closeLabel={t.close} onClose={() => setDialog(null)}><p>{t.flowHelp}</p><ol className="v2-flow-steps">{t.flowSteps.map(step => <li key={step}>{step}</li>)}</ol><div className="v2-actions"><button className="v2-primary" onClick={() => { w.update({ source: { ...d.source, kind: 'wispr-dictation' } }); setDialog(null); setTimeout(() => editor.current?.focus(), 0); }}>{t.focus}</button><a href="https://wisprflow.ai/download" target="_blank" rel="noreferrer">{t.getFlow}</a></div></Dialog>}
    {deleting&&<Dialog title={p.title} closeLabel={t.close} onClose={()=>{if(!w.busy)setDeleting(null);}}><p>{p.help}</p><div className="v2-actions"><button className="v2-primary v2-delete" disabled={w.busy} onClick={()=>void w.removeRecord(deleting).then(()=>setDeleting(null))}>{w.busy&&<Spinner/>}{p.confirm}</button><button className="v2-text" disabled={w.busy} onClick={()=>setDeleting(null)}>{t.cancel}</button></div></Dialog>}
    {dialog === 'discard' && <Dialog title={t.discardTitle} closeLabel={t.close} onClose={() => setDialog(null)}><p>{t.discardHelp}</p><div className="v2-actions"><button className="v2-primary" disabled={w.busy} onClick={() => { setDialog(null); void w.newJob(); }}>{t.discard}</button><button className="v2-text" onClick={() => setDialog(null)}>{t.cancel}</button></div></Dialog>}
    {dialog === 'switch' && <Dialog title={t.switchTitle} closeLabel={t.close} onClose={() => setDialog(null)}><p>{t.switchHelp}</p>{recoveryPanel()}<label className="v2-check"><input type="checkbox" checked={kept} onChange={e => setKept(e.target.checked)}/>{t.codeKept}</label><div className="v2-actions"><button className="v2-primary" disabled={w.busy || (w.session?.workspace && !kept)} onClick={() => { void w.closeWorker().then(() => setDialog(null)); }}>{t.finishWorker}</button><button className="v2-text" onClick={() => setDialog(null)}>{t.cancel}</button></div></Dialog>}
  </div>;
}
if('serviceWorker' in navigator)void navigator.serviceWorker.register('/sw.js').catch(error=>console.warn('Offline shell unavailable:',error.message));
createRoot(document.getElementById('root')!).render(<>{location.pathname.startsWith('/staff/') ? <Suspense fallback={<Skeleton label="Opening staff workspace" kind="workspace"/>}><StaffWorkspace referralsPage={location.pathname === '/staff/referrals'}/></Suspense> : <Workspace/>}<PrintHost/></>);
