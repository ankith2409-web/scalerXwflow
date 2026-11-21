import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowRight, AudioLines, Check, Download, GitCompare, Mic, ShieldCheck, Square, Volume2 } from 'lucide-react';
import { blank, copy, keys, type Entry, type Field, type Labels, type Language, type SavedEntry } from './copy';
import { jsonPost, request, usePlayback, useRecorder } from './voice';
import { StaffWorkspace } from './staff';
import './style.css';

type Screen = 'home' | 'intake' | 'review' | 'history' | 'saved';
type Session = { active: boolean; voiceAvailable: boolean };

const historyPath = '/history';
const launchScreen = () => location.pathname === historyPath ? 'history' : 'home';

function App() {
  const [language, setLanguage] = useState<Language>(() => sessionStorage.getItem('workecho-language') === 'hi' ? 'hi' : 'en');
  const [screen, setScreen] = useState<Screen>(launchScreen);
  const [session, setSession] = useState<Session | null>(null);
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
  const [exportOpen, setExportOpen] = useState(false);
  const [editing, setEditing] = useState<Field | null>(null);
  const [change, setChange] = useState('');
  const [changed, setChanged] = useState<Field | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const operation = useRef<string | null>(null);
  const t = copy[language];
  const playback = usePlayback(language);
  const heading = useRef<HTMLHeadingElement>(null);
  const [repairVoice, setRepairVoice] = useState(false);
  const [repairBusy, setRepairBusy] = useState(false);

  async function refreshSession() {
    const next = await request<Session>('/api/session');
    setSession(next);
    return next;
  }

  useEffect(() => {
    const pop = () => {
      if (location.pathname === historyPath) setScreen('history');
      else setScreen('home');
    };
    window.addEventListener('popstate', pop);
    if (location.pathname.startsWith('/intake')) history.replaceState(null, '', '/');
    refreshSession().catch(() => setError('unavailable'));
    return () => window.removeEventListener('popstate', pop);
  }, []);
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
    let current = true;
    setBusy(true);
    request<SavedEntry[]>('/api/history').then((items) => {
      if (current) setSaved(items);
    }).catch((failure: Error) => {
      if (!current) return;
      setSaved([]);
      if (failure.message === '401') setSession((s) => s && { ...s, active: false });
      else setError('unavailable');
    }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [screen]);

  function go(next: Screen) {
    playback.stop();
    const path = next === 'home' ? '/' : next === 'history' || next === 'saved' ? historyPath : next === 'review' ? '/intake/review' : '/intake';
    if (location.pathname !== path) history.pushState(null, '', path);
    setError('');
    setScreen(next);
  }

  async function start() {
    setBusy(true);
    setError('');
    try {
      const { id } = await request<{ id: string }>('/api/intakes', jsonPost({
        language, save: saveConsent, voice: Boolean(session?.voiceAvailable && voiceConsent), matching, outreach,
      }));
      setSession((s) => ({ active: true, voiceAvailable: s?.voiceAvailable ?? false }));
      setIntake(id);
      setEntry(blank);
      setEvidence(blank);
      setRevision(null);
      setChanged(null);
      setStep(0);
      operation.current = null;
      go('intake');
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
      setExportOpen(false);
      setEditing(null);
      setChange('');
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

  function downloadHistory() {
    const report = saved.map((item) => summary(item.fields)).join('\n\n');
    const url = URL.createObjectURL(new Blob([t.fictional + '\n\n' + report], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'workecho-demo-history.txt';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportOpen(false);
  }

  const summary = (item: Entry) => keys.map((key) => t.field[key][0] + '. ' + (item[key] ?? t.missing)).join('. ');
  const play = (value: string) => playback.playing ? playback.stop() : playback.speak(value, () => setError('speechError'));
  const voiceAllowed = Boolean(!revision && intake && voiceConsent && session?.voiceAvailable);
  const mainTitle = screen === 'home' ? t.home : screen === 'review' ? t.check
    : screen === 'saved' ? t.saved : t.history;

  return (
    <div className="site">
      <header className="header">
        <div className="header-inner">
          <a href="/" className="wordmark" onClick={(event) => { event.preventDefault(); if (!busy) go('home'); }}><AudioLines size={23} aria-hidden="true" />WorkEcho</a>
          <div className="header-tools">
            <label className="sr-only" htmlFor="language">{t.language}</label>
            <select id="language" value={language} onChange={(event) => { playback.stop(); setLanguage(event.target.value as Language); }}>
              <option value="en">English</option>
              <option value="hi" lang="hi">हिन्दी</option>
            </select>
            {session?.active && screen !== 'home' && (
              <button type="button" className="quiet" onClick={() => go('home')} disabled={busy}>{t.leave}</button>
            )}
          </div>
        </div>
      </header>
      <main className={screen === 'home' ? 'main home-main' : 'main'}>
        {screen !== 'intake' && (
          <>
            <p className="context">{t.fictional}</p>
            <h1 ref={heading} tabIndex={-1}>{mainTitle}</h1>
          </>
        )}
        {screen === 'home' && (
          <>
            <p className="lede">{t.intro}</p>
            <div className="home-grid"><div className="paper consent">
              <h2>{t.permissions}</h2>
              <label><input type="checkbox" checked={saveConsent} onChange={(e) => setSaveConsent(e.target.checked)} />{t.savingConsent}</label>
              {session?.voiceAvailable ? (
                <label><input type="checkbox" checked={voiceConsent} onChange={(e) => setVoiceConsent(e.target.checked)} />{t.voiceConsent}</label>
              ) : <p className="muted">{t.noVoice}</p>}
              <label><input type="checkbox" checked={matching} onChange={(e) => setMatching(e.target.checked)} />{t.matchConsent}</label>
              <label><input type="checkbox" checked={outreach} onChange={(e) => setOutreach(e.target.checked)} />{t.outreachConsent}</label>
              <button className="primary" disabled={busy || !saveConsent || !session} onClick={start}>{busy ? t.loading : t.start}<ArrowRight size={19} aria-hidden="true" /></button>
            </div><aside className="paper privacy-card"><ShieldCheck size={26} aria-hidden="true" /><h2>{t.privacyTitle}</h2><p>{t.privacy}</p>
              <button className="text-link listen" onClick={() => play(t.intro + ' ' + t.privacy)}><Volume2 size={19} aria-hidden="true" />{playback.playing ? t.stopPlayback : t.how}</button>
            </aside></div>
            <div className="action-row">
              <a href={historyPath} className="text-link" onClick={(event) => { event.preventDefault(); go('history'); }}>{t.history}</a>
              <a href="/staff/review" className="text-link"><GitCompare size={18} aria-hidden="true" />{t.staff}</a>
              {session?.active && <button className="quiet" type="button" disabled={busy} onClick={signOut}>{t.signOut}</button>}
            </div>
            {session?.active && <p className="muted">{t.signOutDetail}</p>}
          </>
        )}
        {screen === 'intake' && intake && (
          <Question key={keys[step]} titleRef={heading} field={keys[step]} labels={t} intake={intake} voiceAllowed={voiceAllowed}
            current={entry[keys[step]]} playing={playback.playing} play={play} saveAnswer={answer}
            progress={step + 1} back={() => { playback.stop(); step ? setStep(step - 1) : go('home'); }} />
        )}
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
                      {voiceAllowed && intake && <CorrectionMic key={field} intake={intake} labels={t} onAnswer={(value) => { setChange(value); setRepairVoice(false); }}
                        onError={() => setRepairVoice(true)} onStart={playback.stop} onBusy={setRepairBusy} />}
                      {repairVoice && <p role="status" className="muted">{t.voiceError}</p>}
                      <button className="quiet" type="submit" disabled={repairBusy}>{t.done}</button>
                    </form>
                  )}
                </div>
              ))}
            </div>
            <div className="action-row">
              <button className="primary" disabled={busy || Boolean(editing) || !Object.values(entry).some(Boolean)} onClick={confirm}>
                <Check size={19} aria-hidden="true" />{busy ? t.savePending : operation.current ? t.retrySave : t.save}
              </button>
              <button className="quiet" disabled={busy || Boolean(operation.current)} onClick={() => { setEditing(null); go(revision ? 'history' : 'intake'); }}><ArrowLeft size={18} aria-hidden="true" />{t.back}</button>
            </div>
          </>
        )}
        {screen === 'saved' && (
          <>
            <p className="lede">{t.savedHelp}</p>
            {saved[0] && <HistoryCard item={saved[0]} t={t} play={play} playing={playback.playing} />}
            <div className="action-row"><button className="primary" onClick={() => go('history')}>{t.history}<ArrowRight size={19} aria-hidden="true" /></button>
              <button className="quiet" onClick={saveConsent ? start : () => go('home')} disabled={busy}>{t.add}</button></div>
          </>
        )}
        {screen === 'history' && (
          <>
            {busy ? <p role="status">{t.loading}</p> : saved.length ? saved.map((item) => <HistoryCard key={item.id} item={item} t={t} play={play} playing={playback.playing} correct={() => reopen(item)} />)
              : <p>{t.empty}</p>}
            <div className="action-row">
              <button className="primary" onClick={() => go('home')}>{t.new}<ArrowRight size={19} aria-hidden="true" /></button>
              {!!saved.length && <button className="quiet" onClick={() => setExportOpen(true)}><Download size={18} aria-hidden="true" />{t.export}</button>}
              {session?.active && <button className="quiet" onClick={signOut} disabled={busy}>{t.signOut}</button>}
            </div>
            {session?.active && <p className="muted">{t.signOutDetail}</p>}
            {exportOpen && !!saved.length && <div className="notice"><p>{t.exportWarning}</p><div className="action-row">
              <button className="primary" onClick={downloadHistory}>{t.download}</button><button className="quiet" onClick={() => setExportOpen(false)}>{t.cancel}</button>
            </div></div>}
          </>
        )}
        {error && <p className="notice" role="alert">{error === 'speechError' ? t.speechError : error === 'stale' ? t.stale : t.unavailable}</p>}
      </main>
    </div>
  );
}

function CorrectionMic({ intake, labels, onAnswer, onError, onStart, onBusy }: {
  intake: string; labels: Labels; onAnswer: (value: string) => void; onError: () => void; onStart: () => void; onBusy: (value: boolean) => void;
}) {
  const recorder = useRecorder();
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
    {recording ? <Square size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
    {recording ? labels.stop : recorder.state === 'processing' ? labels.processing : recorder.state === 'opening' ? labels.loading : labels.record}
  </button>;
}

function Question({ field, labels: t, current, intake, voiceAllowed, progress, titleRef, playing, play, saveAnswer, back }: {
  field: Field; labels: Labels; current: string | null; intake: string; voiceAllowed: boolean; progress: number;
  titleRef: React.RefObject<HTMLHeadingElement | null>; playing: boolean; play: (value: string) => void;
  saveAnswer: (value: string | null, source?: string | null) => void; back: () => void;
}) {
  const [value, setValue] = useState(current ?? '');
  const [type, setType] = useState(!voiceAllowed || Boolean(current));
  const [origin, setOrigin] = useState<'mic' | 'sample' | null>(null);
  const [heard, setHeard] = useState('');
  const [error, setError] = useState('');
  const [failures, setFailures] = useState(0);
  const recorder = useRecorder();
  const active = recorder.state !== 'idle';
  const [, question, hint, sample] = t.field[field];
  return (
    <section className="question">
      <div className="step"><button className="quiet" onClick={back} disabled={active}><ArrowLeft size={18} aria-hidden="true" />{t.back}</button>
        <span>{t.job} · {progress}/{keys.length}</span></div>
      <progress className="progress" aria-label={t.job} max={keys.length} value={progress} />
      <h1 ref={titleRef} tabIndex={-1}>{question}</h1>
      <button className="text-link listen" onClick={() => play(question)} disabled={active}><Volume2 size={19} aria-hidden="true" />{playing ? t.stopPlayback : t.replay}</button>
      <form onSubmit={(event) => { event.preventDefault(); if (!active && value.trim()) saveAnswer(value.trim(), heard || value.trim()); }}>
        {origin && <div className="paper heard" role="status"><div className="field-label">{origin === 'mic' ? t.transcript : t.sample}</div><div>{heard}</div></div>}
        {type && <div className="answer">
          <label htmlFor="answer">{t.answer}</label>
          <textarea id="answer" placeholder={hint} maxLength={500} value={value} disabled={active} onChange={(event) => setValue(event.target.value)} />
          <p className="muted">{t.assist}</p>
        </div>}
        {error && <p role="alert" className="notice">{error === 'mic' ? t.micError : t.voiceError}</p>}
        <div className="interview-actions">
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
            {recorder.state === 'recording' ? <Square size={19} aria-hidden="true" /> : <Mic size={19} aria-hidden="true" />}
            {recorder.state === 'recording' ? t.stop : recorder.state === 'processing' ? t.processing : recorder.state === 'opening' ? t.loading : t.record}
          </button>}
          {(type || value) && <button type="submit" className="primary" disabled={active || !value.trim()}>{t.next}<ArrowRight size={19} aria-hidden="true" /></button>}
          <div className="action-row minor">
            {!type && <button type="button" className="quiet" disabled={active} onClick={() => setType(true)}>{t.typeInstead}</button>}
            <button type="button" className="quiet" disabled={active} onClick={() => saveAnswer(null)}>{t.skip}</button>
            <button type="button" className="quiet" disabled={active} onClick={() => { setValue(sample); setHeard(sample); setOrigin('sample'); setType(true); }}>{t.demo}</button>
          </div>
        </div>
      </form>
    </section>
  );
}

function HistoryCard({ item, t, play, playing, correct }: { item: SavedEntry; t: Labels; play: (value: string) => void; playing: boolean; correct?: () => void }) {
  return <article className="paper history-card">
    <h2>{item.fields.place ?? item.fields.task ?? t.job}</h2>
    <p className="field-label">{t.confirmed} · <time dateTime={item.confirmedAt}>{new Date(item.confirmedAt).toLocaleDateString(document.documentElement.lang)}</time></p>
    <dl>{keys.map((field) => <div key={field}><dt>{t.field[field][0]}</dt><dd>{item.fields[field] ?? t.missing}</dd></div>)}</dl>
    <details><summary>{t.said}</summary><dl>{keys.map((field) => <div key={field}><dt>{t.field[field][0]}</dt><dd>{item.evidence[field] ?? t.missing}</dd></div>)}</dl></details>
    <button className="text-link listen" onClick={() => play(keys.map((field) => t.field[field][0] + '. ' + (item.fields[field] ?? t.missing)).join('. '))}>
      <Volume2 size={19} aria-hidden="true" />{playing ? t.stopPlayback : t.readBack}
    </button>
    {correct && <button className="quiet" onClick={correct}>{t.correct}</button>}
  </article>;
}

createRoot(document.getElementById('root')!).render(location.pathname.startsWith('/staff/')
  ? <StaffWorkspace referralsPage={location.pathname === '/staff/referrals'} /> : <App />);
