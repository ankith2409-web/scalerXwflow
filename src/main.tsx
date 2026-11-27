import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowRight, AudioLines, Check, ChevronDown, CircleAlert, ClipboardList, Download, GitCompare, Globe2, KeyRound, MapPin, Mic, ShieldCheck, Square, Volume2 } from 'lucide-react';
import { blank, copy, keys, type Entry, type Field, type Labels, type Language, type SavedEntry } from './copy';
import { browserVoiceAvailable, jsonPost, request, usePlayback, useRecorder } from './voice';
import { StaffWorkspace } from './staff';
import { Brand, Dialog, FieldLines, Skeleton, Spinner } from './ui';
import './style.css';
import { AccountImport } from './account-import';
import { cloudLabels } from './cloud-labels';

type Screen = 'home' | 'intake' | 'import' | 'review' | 'history' | 'saved';
type Session = { active: boolean; voiceAvailable: boolean; workspace: boolean; cloud?: boolean };
type VoiceProvider = 'sarvam' | 'browser';

const historyPath = '/history';
const launchScreen = () => location.pathname === historyPath ? 'history' : 'home';

function App() {
  const [language, setLanguage] = useState<Language>(() => sessionStorage.getItem('workecho-language') === 'hi' ? 'hi' : 'en');
  const [screen, setScreen] = useState<Screen>(launchScreen);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionFailed, setSessionFailed] = useState(false);
  const [historyLoad, setHistoryLoad] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [historyRetry, setHistoryRetry] = useState(0);
  const [saveConsent, setSaveConsent] = useState(false);
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [matching, setMatching] = useState(false);
  const [outreach, setOutreach] = useState(false);
  const [intake, setIntake] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [entry, setEntry] = useState<Entry>(blank);
  const [evidence, setEvidence] = useState<Entry>(blank);
  const [saved, setSaved] = useState<SavedEntry[]>([]);
  const [revision, setRevision] = useState<SavedEntry | null>(null);
  const [dialog, setDialog] = useState<'export' | 'recovery' | SavedEntry | null>(null);
  const [editing, setEditing] = useState<Field | null>(null);
  const [change, setChange] = useState('');
  const [changed, setChanged] = useState<Field | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState('');
  const [issuedCode, setIssuedCode] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const operation = useRef<string | null>(null);
  const t = session?.cloud ? { ...copy[language], ...cloudLabels[language] } : copy[language];
  const [inputMode, setInputMode] = useState<'guided' | 'story'>('guided');
  const playback = usePlayback(language);
  const heading = useRef<HTMLHeadingElement>(null);
  const [repairVoice, setRepairVoice] = useState(false);
  const [repairBusy, setRepairBusy] = useState(false);
  const workspace = Boolean(session?.workspace);
  const hasBrowserVoice = browserVoiceAvailable();
  const provider: VoiceProvider = session?.voiceAvailable ? 'sarvam' : 'browser';

  async function refreshSession() {
    setSessionFailed(false);
    try {
      setSession(await request<Session>('/api/session'));
    } catch {
      setSessionFailed(true);
    }
  }

  useEffect(() => {
    if (location.pathname.startsWith('/intake')) history.replaceState(null, '', '/');
    void refreshSession();
  }, []);
  useEffect(() => {
    const pop = () => {
      const path = location.pathname;
      setError('');
      setDialog(null);
      if (path === historyPath) {
        setHistoryLoad('loading');
        setScreen('history');
        setHistoryRetry((value) => value + 1);
      } else if (path === '/intake/review' && (intake || revision)) setScreen('review');
      else if (path === '/intake' && intake) setScreen('intake');
      else setScreen('home');
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [intake, revision]);
  useEffect(() => {
    document.documentElement.lang = language;
    sessionStorage.setItem('workecho-language', language);
  }, [language]);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    window.speechSynthesis?.cancel();
  }, [screen, step]);
  useEffect(() => {
    if (screen !== 'history') return;
    const controller = new AbortController();
    request<SavedEntry[]>('/api/history', { signal: controller.signal }).then((items) => {
      if (controller.signal.aborted) return;
      setSaved(items);
      setHistoryLoad('ready');
    }).catch((failure: Error) => {
      if (controller.signal.aborted) return;
      setSaved([]);
      setHistoryLoad(failure.message === '401' ? 'ready' : 'failed');
      if (failure.message === '401') setSession((s) => s && { ...s, active: false });
    });
    return () => controller.abort();
  }, [screen, historyRetry]);

  function go(next: Screen) {
    playback.stop();
    const path = next === 'home' ? '/' : next === 'history' || next === 'saved' ? historyPath : next === 'review' ? '/intake/review' : '/intake';
    if (location.pathname !== path) history.pushState(null, '', path);
    setError('');
    setDialog(null);
    if (next === 'history') {
      setHistoryLoad('loading');
      setHistoryRetry((value) => value + 1);
    }
    setScreen(next);
  }

  async function start() {
    setBusy(true);
    setError('');
    try {
      const { id, code } = await request<{ id: string; code?: string }>('/api/intakes', jsonPost({
        language, save: saveConsent, voice: voiceConsent, matching, outreach,
      }));
      setSession((s) => s && { ...s, active: true });
      if (code) { setIssuedCode(code); setCodeCopied(false); }
      setIntake(id);
      setEntry(blank);
      setEvidence(blank);
      setRevision(null);
      setChanged(null);
      setStep(0);
      operation.current = null;
      go(inputMode === 'story' ? 'import' : 'intake');
    } catch {
      setError('unavailable');
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    setError('');
    try {
      const next = await request<Session>('/api/session/restore', jsonPost({ code: recovery.trim() }));
      setSession(next);
      setRecovery('');
      setShowRecovery(false);
      go('history');
    } catch (failure) {
      setError(failure instanceof Error && failure.message === '401' ? 'invalidCode' : 'unavailable');
    } finally {
      setBusy(false);
    }
  }

  async function replaceCode() {
    setDialog(null);
    setBusy(true);
    setError('');
    try {
      const { code } = await request<{ code: string }>('/api/session/recovery-code', { method: 'POST' });
      setIssuedCode(code);
      setCodeCopied(false);
    } catch {
      setError('unavailable');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!intake && !revision) return;
    setBusy(true);
    setError('');
    operation.current ??= crypto.randomUUID();
    try {
      const path = revision ? '/api/history/' + revision.id : '/api/intakes/' + intake + '/confirm';
      const payload = { operation: operation.current, confirmed: true, fields: entry,
        ...(revision ? { version: revision.version } : { evidence }) };
      const item = await request<SavedEntry>(path, { ...jsonPost(payload), method: revision ? 'PATCH' : 'POST' });
      setSaved((previous) => [item, ...previous.filter(({ id }) => id !== item.id)]);
      setRevision(null);
      go('saved');
    } catch (failure) {
      if (failure instanceof Error && revision && ['409', '404'].includes(failure.message)) {
        setRevision(null);
        go('history');
        setError('stale');
        return;
      }
      if (failure instanceof Error && ['401', '404'].includes(failure.message)) {
        setSession((s) => s && { ...s, active: false });
        go('home');
      }
      setError('unavailable');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError('');
    try {
      await request('/api/session', { method: 'DELETE' });
      setSession((s) => s && { ...s, active: false });
      setSaved([]);
      setIntake(null);
      setEntry(blank);
      setEvidence(blank);
      setSaveConsent(false);
      setVoiceConsent(false);
      setMatching(false);
      setOutreach(false);
      setRevision(null);
      setDialog(null);
      setEditing(null);
      setChange('');
      setIssuedCode('');
      setRecovery('');
      operation.current = null;
      go('home');
    } catch {
      setError('unavailable');
    } finally {
      setBusy(false);
    }
  }

  function answer(value: string | null, source = value) {
    playback.stop();
    setEntry((previous) => ({ ...previous, [keys[step]]: value }));
    setEvidence((previous) => ({ ...previous, [keys[step]]: source }));
    if (step + 1 === keys.length) go('review');
    else setStep((previous) => previous + 1);
  }

  function reopen(item: SavedEntry) {
    setRevision(item);
    setEntry(item.fields);
    setEvidence(item.evidence);
    setEditing(null);
    setChanged(null);
    operation.current = null;
    go('review');
  }

  async function stopSharing(item: SavedEntry) {
    setDialog(null);
    setBusy(true);
    setError('');
    try {
      await request('/api/history/' + item.id + '/sharing', { method: 'DELETE' });
      setSaved((records) => records.map((record) => record.id === item.id ? { ...record, sharing: false } : record));
    } catch {
      setError('unavailable');
    } finally {
      setBusy(false);
    }
  }

  function downloadHistory() {
    const report = saved.map((item) => summary(item.fields)).join('\n\n');
    const url = URL.createObjectURL(new Blob([(workspace ? 'WorkEcho' : t.fictional) + '\n\n' + report], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'workecho-history.txt';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDialog(null);
  }

  const summary = (item: Entry) => keys.map((key) => t.field[key][0] + '. ' + (item[key] ?? t.missing)).join('. ');
  const play = (value: string) => playback.playing ? playback.stop() : playback.speak(value, () => setError('speechError'));
  const voiceEnabled = Boolean(session?.voiceAvailable || hasBrowserVoice);
  const voiceAllowed = Boolean(!revision && intake && voiceConsent && voiceEnabled);
  const mainTitle = screen === 'home' ? t.home : screen === 'review' ? t.check
    : screen === 'saved' ? t.saved : t.history;

  return (
    <div className="site worker-site">
      <header className="header">
        <div className="header-inner">
          <Brand onHome={() => { if (!busy) go('home'); }} />
          <div className="header-tools">
            {screen === 'home' && <a className="quiet staff-link" href="/staff/review"><GitCompare size={17} aria-hidden="true" />{t.staff}</a>}
            <div className="language-picker">
              <Globe2 size={16} aria-hidden="true" />
              <label className="sr-only" htmlFor="language">{t.language}</label>
              <select id="language" value={language} onChange={(event) => { playback.stop(); setLanguage(event.target.value as Language); }}>
                <option value="en">English</option>
                <option value="hi" lang="hi">हिन्दी</option>
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </div>
            {session?.active && screen !== 'home' && (
              <button type="button" className="quiet" onClick={() => go('home')} disabled={busy}>{t.leave}</button>
            )}
          </div>
        </div>
      </header>
      <main className={'main ' + (screen === 'home' ? 'home-main' : 'main-' + screen)}>
        <div key={screen} className="motion-page">
        {screen !== 'intake' && screen !== 'import' && screen !== 'home' && <div className="page-heading">
          {screen === 'saved' && <div className="success-mark"><Check size={25} aria-hidden="true" /></div>}
          <h1 ref={heading} tabIndex={-1}>{mainTitle}</h1>
        </div>}
        {screen === 'home' && (
          <div className="home-grid">
            <section className="home-content">
            <h1 ref={heading} tabIndex={-1}>{mainTitle}</h1>
            <p className="lede">{t.intro}</p>
            {sessionFailed ? <div className="paper empty-state" role="alert">
              <CircleAlert size={24} aria-hidden="true" /><p>{t.unavailable}</p>
              <button className="quiet" onClick={() => void refreshSession()}>{t.retry}</button>
            </div> : !session ? <Skeleton kind="form" label={t.loading} /> : <div className="paper consent" aria-busy={busy}>
              <h2>{t.permissions}</h2>
              <fieldset className="intake-choice"><legend>{language === 'hi' ? 'कैसे शुरू करना चाहेंगे?' : 'How would you like to begin?'}</legend>
                <label><input type="radio" name="intake-mode" value="guided" checked={inputMode === 'guided'} onChange={() => setInputMode('guided')} />{language === 'hi' ? 'एक-एक सवाल' : 'One question at a time'}</label>
                <label><input type="radio" name="intake-mode" value="story" checked={inputMode === 'story'} onChange={() => setInputMode('story')} />{language === 'hi' ? 'अपना अनुभव बताएं या पाठ लाएं' : 'Tell my story or import a transcript'}</label>
              </fieldset>
              <label><input type="checkbox" checked={saveConsent} onChange={(e) => setSaveConsent(e.target.checked)} />{workspace ? t.saveLocal : t.savingConsent}</label>
              {voiceEnabled ? (
                <label><input type="checkbox" checked={voiceConsent} onChange={(e) => setVoiceConsent(e.target.checked)} />{provider === 'sarvam' ? t.voiceConsent : t.browserConsent}</label>
              ) : null}
              <label><input type="checkbox" checked={matching} onChange={(e) => setMatching(e.target.checked)} />{workspace ? t.matchLocal : t.matchConsent}</label>
              <label><input type="checkbox" checked={outreach} onChange={(e) => setOutreach(e.target.checked)} />{workspace ? t.outreachLocal : t.outreachConsent}</label>
              {!voiceEnabled && <p className="muted consent-note"><Mic size={16} aria-hidden="true" />{workspace ? t.localNoMic : t.noVoice}</p>}
              <button className="primary consent-submit" disabled={busy || !saveConsent} onClick={start}>{busy ? t.loading : t.start}{busy ? <Spinner /> : <ArrowRight size={19} aria-hidden="true" />}</button>
            </div>}
            <div className="action-row home-actions">
              <a href={historyPath} className="quiet" onClick={(event) => { event.preventDefault(); go('history'); }}><ClipboardList size={17} aria-hidden="true" />{t.history}</a>
              {workspace && !session?.active && <button className="quiet" aria-expanded={showRecovery} onClick={() => setShowRecovery(!showRecovery)}><KeyRound size={17} aria-hidden="true" />{t.reopenHistory}</button>}
              {session?.active && <button className="quiet" type="button" disabled={busy} onClick={signOut}>{t.signOut}</button>}
            </div>
            {workspace && showRecovery && <form className="paper recovery-form" onSubmit={(event) => { event.preventDefault(); void restore(); }}>
              <label className="field-label" htmlFor="recovery">{t.recoveryCode}</label>
              <input id="recovery" className="line-input" type="password" autoComplete="off" required value={recovery} onChange={(event) => setRecovery(event.target.value)} />
              <button className="primary" disabled={busy || recovery.trim().length !== 43}>{busy && <Spinner />}{t.reopenHistory}</button>
            </form>}
            {session?.active && <p className="muted">{workspace ? t.signOutLocal : t.signOutDetail}</p>}
            </section>
            <aside className="privacy-card">
              <div className="field-art" aria-hidden="true"><FieldLines /><div className="field-frame" />
                <div className="field-emblem"><AudioLines size={29} strokeWidth={1.45} /></div>
              </div>
              <div className="privacy-body"><span className="surface-icon"><ShieldCheck size={22} aria-hidden="true" /></span>
                <div><h2>{t.privacyTitle}</h2><p>{workspace ? t.privacyLocal : session ? t.privacy : t.privacyNeutral}</p></div>
                <button className="text-link listen" onClick={() => play(t.intro + ' ' + (workspace ? t.privacyLocal : session ? t.privacy : t.privacyNeutral))}>
                  <Volume2 size={18} aria-hidden="true" />{playback.playing ? t.stopPlayback : t.how}</button>
              </div>
            </aside>
            {session && <p className="context mode-caption"><span />{workspace ? t.local : t.fictional}</p>}
          </div>
        )}
        {screen === 'intake' && intake && (
          <Question key={keys[step]} titleRef={heading} field={keys[step]} labels={t} intake={intake} voiceAllowed={voiceAllowed}
            workspace={workspace} language={language} provider={provider}
            current={entry[keys[step]]} playing={playback.playing} play={play} saveAnswer={answer}
            progress={step + 1} back={() => { playback.stop(); step ? setStep(step - 1) : go('home'); }} />
        )}
        {screen === 'import' && intake && <AccountImport intake={intake} language={language} voiceAllowed={voiceAllowed} provider={provider}
          onBack={() => go('intake')} onUse={(fields, quotes) => { setEntry(fields); setEvidence(quotes); setStep(4); go('review'); }} />}
        {screen === 'review' && (
          <>
            <p className="lede">{t.checkHelp}</p>
            <button className="text-link listen" disabled={repairBusy} onClick={() => play(summary(entry))}><Volume2 size={19} aria-hidden="true" />{playback.playing ? t.stopPlayback : t.readBack}</button>
            <div className="paper review-paper">
              <div className="review-labels" aria-hidden="true"><strong>{t.said}</strong><strong>{t.proposed}</strong></div>
              {keys.map((field) => (
                <div className="detail" key={field}>
                  <div className="review-source"><div className="field-label">{t.said} · {t.field[field][0]}</div><div>{evidence[field] ?? t.missing}</div></div>
                  <div className="review-value"><div className="field-label">{t.proposed} · {t.field[field][0]}</div><div>{entry[field] ?? t.missing}</div>
                    {changed === field && <div className="field-label" role="status">{t.changed}</div>}</div>
                  {editing !== field && <button className="quiet" disabled={busy || Boolean(editing) || Boolean(operation.current)} aria-label={t.change + ' ' + t.field[field][0]}
                    onClick={() => { playback.stop(); setEditing(field); setChange(entry[field] ?? ''); setRepairVoice(false); }}>{t.change}</button>}
                  {editing === field && (
                    <form className="correction" onSubmit={(event) => {
                      event.preventDefault();
                      if (repairBusy) return;
                      const corrected = change.trim() || null;
                      setEntry((previous) => ({ ...previous, [field]: corrected }));
                      setEditing(null);
                      setChanged(field);
                      playback.speak(t.field[field][0] + '. ' + (corrected ?? t.missing), () => setError('speechError'));
                    }}>
                      <label className="sr-only" htmlFor={'change-' + field}>{t.field[field][0]}</label>
                      <textarea id={'change-' + field} autoFocus maxLength={500} value={change} onChange={(e) => setChange(e.target.value)} />
                      {voiceAllowed && intake && <CorrectionMic key={field} intake={intake} labels={t} language={language} provider={provider} onAnswer={(value) => { setChange(value); setRepairVoice(false); }}
                        onError={() => setRepairVoice(true)} onStart={playback.stop} onBusy={setRepairBusy} />}
                      {repairVoice && <p role="status" className="muted">{t.voiceError}</p>}
                      <button className="quiet" type="submit" disabled={repairBusy}>{t.done}</button>
                    </form>
                  )}
                </div>
              ))}
            </div>
            <div className="action-row action-bar">
              <button className="primary" disabled={busy || Boolean(editing) || !Object.values(entry).some(Boolean)} onClick={confirm}>
                {busy ? <Spinner /> : <Check size={19} aria-hidden="true" />}{busy ? t.savePending : operation.current ? t.retrySave : t.save}
              </button>
              <button className="quiet" disabled={busy || Boolean(operation.current)} onClick={() => { setEditing(null); go(revision ? 'history' : 'intake'); }}><ArrowLeft size={18} aria-hidden="true" />{t.back}</button>
            </div>
          </>
        )}
        {screen === 'saved' && (
          <>
            <p className="lede">{workspace ? t.savedLocal : t.savedHelp}</p>
            {saved[0] && <HistoryCard item={saved[0]} t={t} play={play} playing={playback.playing} />}
            <div className="action-row"><button className="primary" onClick={() => go('history')}>{t.history}<ArrowRight size={19} aria-hidden="true" /></button>
              <button className="quiet" onClick={saveConsent ? start : () => go('home')} disabled={busy}>{t.add}</button></div>
          </>
        )}
        {screen === 'history' && (
          <>
            <div className="action-row history-toolbar">
              <button className="primary" onClick={() => go('home')}>{t.new}<ArrowRight size={19} aria-hidden="true" /></button>
              {historyLoad === 'ready' && !!saved.length && <button className="quiet" onClick={() => setDialog('export')}><Download size={18} aria-hidden="true" />{t.export}</button>}
              {workspace && session?.active && !issuedCode && <button className="quiet" onClick={() => setDialog('recovery')} disabled={busy}>{t.replaceCode}</button>}
              {session?.active && <button className="quiet" onClick={signOut} disabled={busy}>{t.signOut}</button>}
            </div>
            <div className="history-list" aria-busy={historyLoad === 'loading'}>
              {historyLoad === 'loading' ? <Skeleton label={t.loading} /> : historyLoad === 'failed' ? <div className="paper empty-state" role="alert">
                <CircleAlert size={25} aria-hidden="true" /><p>{t.unavailable}</p>
                <button className="quiet" onClick={() => { setHistoryLoad('loading'); setHistoryRetry((value) => value + 1); }}>{t.retry}</button>
              </div> : saved.length ? saved.map((item) => <HistoryCard key={item.id} item={item} t={t} play={play} playing={playback.playing} correct={() => reopen(item)}
                stopSharing={item.sharing ? () => setDialog(item) : undefined} busy={busy} />)
                : <div className="paper empty-state"><ClipboardList size={27} aria-hidden="true" /><p>{t.empty}</p></div>}
            </div>
            {session?.active && <p className="muted">{workspace ? t.signOutLocal : t.signOutDetail}</p>}
          </>
        )}
        {!!issuedCode && (screen === 'saved' || screen === 'history') && <section className="paper recovery-form">
          <h2><KeyRound size={19} aria-hidden="true" />{t.recoveryCode}</h2><p>{t.keepCode}</p><code>{issuedCode}</code>
          <button className="quiet" onClick={async () => {
            try { await navigator.clipboard.writeText(issuedCode); setCodeCopied(true); } catch { setCodeCopied(false); }
          }}>{codeCopied ? t.copied : t.copyCode}</button>
        </section>}
        {error && <p className="notice" role="alert"><CircleAlert size={18} aria-hidden="true" />{error === 'speechError' ? t.speechError : error === 'stale' ? t.stale : error === 'invalidCode' ? t.invalidCode : t.unavailable}</p>}
        </div>
        {dialog && <Dialog title={dialog === 'export' ? t.export : dialog === 'recovery' ? t.replaceCode : t.stopSharing}
          closeLabel={t.cancel} onClose={() => setDialog(null)}>
          <p>{dialog === 'export' ? t.exportWarning : dialog === 'recovery' ? t.replaceCodeConfirm : t.stopSharingConfirm}</p>
          <div className="action-row"><button className="quiet" onClick={() => setDialog(null)}>{t.cancel}</button>
            <button className={typeof dialog === 'object' ? 'danger' : 'primary'} disabled={busy}
              onClick={() => { if (dialog === 'export') downloadHistory(); else if (dialog === 'recovery') void replaceCode(); else void stopSharing(dialog); }}>
              {dialog === 'export' ? t.download : dialog === 'recovery' ? t.replaceCode : t.stopSharing}</button>
          </div>
        </Dialog>}
      </main>
    </div>
  );
}

function CorrectionMic({ intake, labels, language, provider, onAnswer, onError, onStart, onBusy }: {
  intake: string; labels: Labels; language: Language; provider: VoiceProvider; onAnswer: (value: string) => void;
  onError: () => void; onStart: () => void; onBusy: (value: boolean) => void;
}) {
  const recorder = useRecorder(language, provider);
  const recording = recorder.state === 'recording';
  useEffect(() => {
    onBusy(recorder.state !== 'idle');
    return () => onBusy(false);
  }, [recorder.state, onBusy]);
  return <button className="quiet" type="button" disabled={['opening', 'processing'].includes(recorder.state)}
    onClick={() => {
      if (recording) recorder.stop();
      else { onStart(); void recorder.start(intake, { answer: onAnswer, micError: onError, voiceError: onError }); }
    }}>
    {recording ? <Square size={18} aria-hidden="true" /> : recorder.state === 'idle' ? <Mic size={18} aria-hidden="true" /> : <Spinner />}
    {recording ? labels.stop : recorder.state === 'processing' ? labels.processing : recorder.state === 'opening' ? labels.loading : labels.record}
  </button>;
}

function Question({ field, labels: t, current, intake, voiceAllowed, workspace, language, provider, progress, titleRef, playing, play, saveAnswer, back }: {
  field: Field; labels: Labels; current: string | null; intake: string; voiceAllowed: boolean; progress: number;
  workspace: boolean; language: Language; provider: VoiceProvider;
  titleRef: React.RefObject<HTMLHeadingElement | null>; playing: boolean; play: (value: string) => void;
  saveAnswer: (value: string | null, source?: string | null) => void; back: () => void;
}) {
  const [value, setValue] = useState(current ?? '');
  const [type, setType] = useState(!voiceAllowed || Boolean(current));
  const [origin, setOrigin] = useState<'mic' | 'sample' | null>(null);
  const [heard, setHeard] = useState('');
  const [error, setError] = useState('');
  const [failures, setFailures] = useState(0);
  const recorder = useRecorder(language, provider);
  const answerBox = useRef<HTMLTextAreaElement>(null);
  const [wispr, setWispr] = useState(false);
  useEffect(() => { if (wispr) answerBox.current?.focus(); }, [wispr]);
  const active = recorder.state !== 'idle';
  const [, question, hint, sample] = t.field[field];
  return (
    <div className="question-layout">
      <aside className="question-rail" aria-labelledby="intake-progress-title">
        <h2 id="intake-progress-title">{t.job}</h2>
        <ol>{keys.map((key, index) => <li className={key === field ? 'current' : index + 1 < progress ? 'complete' : ''}
          key={key} aria-current={key === field ? 'step' : undefined}><span>{index + 1 < progress ? <Check size={13} aria-hidden="true" /> : index + 1}</span>{t.field[key][0]}</li>)}</ol>
      </aside>
      <section className="paper question">
      <div className="step"><button className="quiet" onClick={back} disabled={active}><ArrowLeft size={18} aria-hidden="true" />{t.back}</button>
        <span>{t.question} {progress}/{keys.length}</span></div>
      <progress className="progress" aria-label={t.job} max={keys.length} value={progress} />
      <h1 ref={titleRef} tabIndex={-1}>{question}</h1>
      <button className="text-link listen" onClick={() => play(question)} disabled={active}><Volume2 size={19} aria-hidden="true" />{playing ? t.stopPlayback : t.replay}</button>
      <form aria-busy={recorder.state === 'processing'} onSubmit={(event) => { event.preventDefault(); if (!active && value.trim()) saveAnswer(value.trim(), heard || value.trim()); }}>
        {origin && <div className="paper heard" role="status"><div className="field-label">{origin === 'mic' ? t.transcript : t.sample}</div><div>{heard}</div></div>}
        {type && <div className="answer">
          <label htmlFor="answer">{t.answer}</label>
          <textarea id="answer" ref={answerBox} placeholder={hint} maxLength={500} value={value} disabled={active} onChange={(event) => setValue(event.target.value)} />
          <p className="muted">{wispr ? t.wisprHint : t.assist}</p>
        </div>}
        {error && <p role="alert" className="notice"><CircleAlert size={17} aria-hidden="true" />{error === 'mic' ? t.micError : t.voiceError}</p>}
        <div className="interview-actions">
          {voiceAllowed && <p className="muted" role="status">{recorder.state === 'recording' ? (language === 'hi' ? 'रिकॉर्ड हो रहा है' : 'Recording') + ' · ' + recorder.elapsed + ' / 25 s' : language === 'hi' ? 'एक उत्तर के लिए अधिकतम 25 सेकंड। रुकने के बाद आप पाठ सुधार सकते हैं।' : 'Up to 25 seconds per answer. You can edit the transcript after recording.'}</p>}
          {voiceAllowed && <button type="button" className={recorder.state === 'recording' ? 'primary recording' : value ? 'quiet' : 'primary'}
            disabled={playing || ['opening', 'processing'].includes(recorder.state)}
            onClick={() => {
              if (recorder.state === 'recording') return recorder.stop();
              setError('');
              void recorder.start(intake, {
                answer: (text) => { setValue(text); setHeard(text); setOrigin('mic'); setType(true); },
                micError: () => { setError('mic'); setType(true); },
                voiceError: () => { setError('voice'); setFailures(failures + 1); if (failures + 1 >= 2) setType(true); },
              });
            }}>
            {recorder.state === 'recording' ? <Square size={19} aria-hidden="true" /> : active ? <Spinner /> : <Mic size={19} aria-hidden="true" />}
            {recorder.state === 'recording' ? t.stop : recorder.state === 'processing' ? t.processing : recorder.state === 'opening' ? t.loading : t.record}
          </button>}
          {(type || value) && <button type="submit" className="primary" disabled={active || !value.trim()}>{t.next}<ArrowRight size={19} aria-hidden="true" /></button>}
          <div className="action-row minor">
            {!type && <button type="button" className="quiet" disabled={active} onClick={() => setType(true)}>{t.typeInstead}</button>}
            <button type="button" className="quiet" disabled={active} onClick={() => saveAnswer(null)}>{t.skip}</button>
            {workspace ? <button type="button" className="quiet" disabled={active} onClick={() => {
              setType(true); setWispr(true); answerBox.current?.focus();
            }}>{t.wispr}</button> : <button type="button" className="quiet" disabled={active} onClick={() => { setValue(sample); setHeard(sample); setOrigin('sample'); setType(true); }}>{t.demo}</button>}
          </div>
        </div>
      </form>
      </section>
    </div>
  );
}

function HistoryCard({ item, t, play, playing, correct, stopSharing, busy }: {
  item: SavedEntry; t: Labels; play: (value: string) => void; playing: boolean; correct?: () => void; stopSharing?: () => void; busy?: boolean;
}) {
  return <article className="paper history-card">
    <div className="history-title"><span className="surface-icon"><MapPin size={20} aria-hidden="true" /></span>
      <div><h2>{item.fields.place ?? item.fields.task ?? t.job}</h2>
        <p className="field-label">{t.confirmed} · <time dateTime={item.confirmedAt}>{new Date(item.confirmedAt).toLocaleDateString(document.documentElement.lang)}</time></p></div></div>
    <dl>{keys.map((field) => <div key={field}><dt>{t.field[field][0]}</dt><dd>{item.fields[field] ?? t.missing}</dd></div>)}</dl>
    <details><summary>{t.said}</summary><dl>{keys.map((field) => <div key={field}><dt>{t.field[field][0]}</dt><dd>{item.evidence[field] ?? t.missing}</dd></div>)}</dl></details>
    <div className="action-row record-actions"><button className="text-link listen" onClick={() => play(keys.map((field) => t.field[field][0] + '. ' + (item.fields[field] ?? t.missing)).join('. '))}>
      <Volume2 size={19} aria-hidden="true" />{playing ? t.stopPlayback : t.readBack}
    </button>
    {correct && <button className="quiet" onClick={correct} disabled={busy}>{t.correct}</button>}
    {stopSharing && <button className="quiet" onClick={stopSharing} disabled={busy}>{t.stopSharing}</button>}</div>
  </article>;
}

createRoot(document.getElementById('root')!).render(location.pathname.startsWith('/staff/')
  ? <StaffWorkspace referralsPage={location.pathname === '/staff/referrals'} /> : <App />);
