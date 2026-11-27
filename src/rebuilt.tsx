import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioLines, Plus, Folder, Users, Globe2, RotateCcw, Mic, FileText, Info, Lock, Check, MapPin, Briefcase, Calendar, Flag, User, LogOut } from 'lucide-react';
import { keys, blank, type Entry, type SavedEntry } from './copy';
import { request, jsonPost } from './voice';
import { WisprImport } from './wispr-import';
import { StaffWorkspace } from './staff';
import { Spinner } from './ui';
import './style.css';
import './rebuilt.css';
const labels = ['Place', 'Work', 'Time', 'Landmark', 'Name or nickname'];
const icons = [MapPin, Briefcase, Calendar, Flag, User];
const hints = ['Village, town or district', 'The work you remember doing', 'A year, season or event is fine', 'A road, crossing or building', 'Any name you remember'];
type Session = {
    active: boolean;
    workspace: boolean;
    cloud?: boolean;
};
function Workspace() {
    const [page, setPage] = useState<'capture' | 'review' | 'saved' | 'history' | 'restore'>('capture');
    const [session, setSession] = useState<Session | null>(null), [status, setStatus] = useState('');
    const [source, setSource] = useState('flow'), [account, setAccount] = useState(''), [fields, setFields] = useState<Entry>({ ...blank }), [evidence, setEvidence] = useState<Entry>({ ...blank });
    const [consent, setConsent] = useState(false), [sharing, setSharing] = useState(false), [outreach, setOutreach] = useState(false);
    const [intake, setIntake] = useState(''), [code, setCode] = useState(''), [recovery, setRecovery] = useState('');
    const [busy, setBusy] = useState(false), [records, setRecords] = useState<SavedEntry[]>([]), [revision, setRevision] = useState<SavedEntry | null>(null);
    const [language, setLanguage] = useState('en'), [manual, setManual] = useState(false);
    const operation = useRef<string | null>(null), editor = useRef<HTMLTextAreaElement>(null), title = useRef<HTMLHeadingElement>(null);
    const durable = Boolean(session?.workspace);
    useEffect(() => { void request<Session>('/api/session').then(setSession).catch(() => setStatus('The workspace could not load. Reload this page to retry.')); }, []);
    useEffect(() => { title.current?.focus(); window.scrollTo(0, 0); }, [page]);
    async function run(task: () => Promise<void>) { setBusy(true); setStatus(''); try {
        await task();
    }
    catch (error) {
        setStatus((error as Error).message === '401' ? 'Your session ended. Reopen your history with its recovery code.' : 'This action could not finish. Your text is still here. Try again.');
    }
    finally {
        setBusy(false);
    } }
    async function openHistory() { await run(async () => { setRecords(await request<SavedEntry[]>('/api/history')); setPage('history'); }); }
    function newAccount() { setAccount(''); setFields({ ...blank }); setEvidence({ ...blank }); setIntake(''); setRevision(null); operation.current = null; setManual(false); setPage('capture'); setStatus(''); }
    async function ensureIntake() { if (intake)
        return intake; const value = await request<{
        id: string;
        code?: string;
    }>('/api/intakes', jsonPost({ language, voice: false, save: consent, matching: sharing, outreach })); setIntake(value.id); if (value.code)
        setCode(value.code); setSession(s => s && ({ ...s, active: true })); return value.id; }
    async function prepare() {
        await run(async () => {
            const id = await ensureIntake();
            if (manual) {
                setEvidence({ ...fields });
                setPage('review');
                return;
            }
            try {
                const proposal = await request<{
                    fields: Entry;
                    evidence: Entry;
                    method: string;
                }>('/api/intakes/' + id + '/extract', jsonPost({ transcript: account }));
                setFields(proposal.fields);
                setEvidence(proposal.evidence);
                if (proposal.method === 'labelled-text')
                    setStatus('Check the five details below. Unlabelled details need your confirmation.');
            }
            catch {
                setFields({ ...blank });
                setEvidence({ ...blank });
                setStatus('Automatic extraction is unavailable. Complete the five details below using your account.');
            }
            setPage('review');
        });
    }
    async function save() {
        await run(async () => {
            operation.current ??= crypto.randomUUID();
            const path = revision ? '/api/history/' + revision.id : '/api/intakes/' + intake + '/confirm';
            const saved = await request<SavedEntry>(path, { ...jsonPost({ fields, evidence, confirmed: true, operation: operation.current, ...(revision ? { version: revision.version } : {}) }), method: revision ? 'PATCH' : 'POST' });
            setRecords([saved]);
            setPage('saved');
        });
    }
    async function signout() { await run(async () => { await request('/api/session', { method: 'DELETE' }); setSession(s => s && ({ ...s, active: false })); setRecords([]); setCode(''); setConsent(false); setSharing(false); setOutreach(false); newAccount(); }); }
    const headings = { capture: 'Every job has a story.', review: 'Let’s get the details right.', saved: 'Your account is saved.', history: 'Your work, in your words.', restore: 'Pick up where you left off.' };
    return <div className="v2">
    <aside className="v2-sidebar"><a className="v2-brand" href="/"><AudioLines size={29}/>WorkEcho</a><nav aria-label="Main navigation">
      <button className={page === 'capture' ? 'selected' : ''} onClick={newAccount}><Plus size={20}/>New account</button>
      <button className={page === 'history' ? 'selected' : ''} onClick={() => void openHistory()}><Folder size={20}/>Saved histories</button>
      <a href="/staff/review"><Users size={20}/>Staff workspace</a>
    </nav><div className="v2-powered"><AudioLines size={22}/><span>Built with Wispr Flow</span></div></aside>
    <main className="v2-main"><header className="v2-top"><div>Work histories <span>/</span> <strong>{page === 'capture' ? 'New account' : page === 'review' ? 'Review' : page === 'restore' ? 'Reopen history' : 'Saved histories'}</strong></div>
      <div className="v2-tools"><label><Globe2 size={18}/><span className="sr-only">Interface language</span><select aria-label="Interface language" value={language} onChange={e => setLanguage(e.target.value)}><option value="en">English</option></select></label>
      {durable && <button className="v2-outline" onClick={() => setPage('restore')}><RotateCcw size={18}/>Reopen history</button>}</div></header>
      <div className="v2-content motion-page" key={page}><h1 ref={title} tabIndex={-1}>{headings[page]}</h1>
      <p className="v2-intro">{page === 'capture' ? 'Capture a work account with Wispr Flow. Review every detail before it becomes a record.' : page === 'review' ? 'Keep what you remember. Correct anything that is missing or wrong. Approximate dates are fine.' : page === 'history' ? 'Only you can reopen your private account. Staff see the histories you choose to share.' : page === 'restore' ? 'Enter your private recovery code to reopen your records.' : 'Your confirmed history is ready. Keep your recovery code somewhere private.'}</p>
      {['capture', 'review', 'saved'].includes(page) && <ol className="v2-steps">{['Capture', 'Review', 'Save'].map((label, i) => <li className={i <= (page === 'capture' ? 0 : page === 'review' ? 1 : 2) ? 'active' : ''} key={label}><span>{i < (page === 'capture' ? 0 : page === 'review' ? 1 : 2) ? <Check size={16}/> : i + 1}</span>{label}</li>)}</ol>}
      {status && <p className="v2-message" role="status"><Info size={18}/>{status}</p>}
      {page === 'capture' && <><div className="v2-capture"><section><h2>Your work account</h2><div className="v2-tabs" role="group" aria-label="Capture method"><button aria-pressed={source === 'flow'} onClick={() => setSource('flow')}><Mic size={18}/>Dictate with Flow</button><button aria-pressed={source === 'notetaker'} onClick={() => setSource('notetaker')}><FileText size={18}/>From Notetaker</button></div>
        {source === 'notetaker' && <WisprImport onImport={value => { setAccount(value); setManual(false); }}/>}
        <label className="sr-only" htmlFor="work-account">Your work account</label><textarea ref={editor} id="work-account" maxLength={12000} value={account} onChange={e => setAccount(e.target.value)} placeholder="Where did you work? What did you do? When was it?"/>
        <div className="v2-flow-note"><Info size={19}/><p>Click in the field, then use your Wispr Flow shortcut or mobile Flow keyboard. Flow handles the spoken language.</p><a href="https://wisprflow.ai/download" target="_blank" rel="noreferrer">Get Wispr Flow</a></div>
        <button className="v2-text" onClick={() => { editor.current?.focus(); }}>Focus for dictation</button>
        <details onToggle={e => setManual(e.currentTarget.open)}><summary>Add the five details directly</summary><p className="v2-muted">You can dictate into each field with Wispr Flow. No analysis key is needed.</p><div className="v2-fields">{keys.map((key, i) => <label key={key}>{labels[i]}<input maxLength={500} value={fields[key] ?? ''} placeholder={hints[i]} onChange={e => setFields({ ...fields, [key]: e.target.value || null })}/></label>)}</div></details>
      </section><aside className="v2-preview"><h2>What we’ll capture</h2>{keys.map((key, i) => { const Icon = icons[i]; return <div key={key}><Icon size={20}/><strong>{labels[i]}</strong><span>{fields[key] ?? 'Not added'}</span></div>; })}</aside></div>
      <div className="v2-consents"><label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>Save my work history <span>(required)</span></label><label><input type="checkbox" checked={sharing} onChange={e => setSharing(e.target.checked)}/>Share with staff for comparison <span>(optional)</span></label><label><input type="checkbox" checked={outreach} onChange={e => setOutreach(e.target.checked)}/>Allow follow-up <span>(optional)</span></label></div>
      <button className="v2-primary" disabled={busy || !session || !consent || (!account.trim() && !Object.values(fields).some(Boolean))} onClick={() => void prepare()}>{busy ? <Spinner /> : null}Review account</button></>}
      {page === 'review' && <div className="v2-review"><section><h2>Your original account</h2><blockquote>{account || Object.values(evidence).filter(Boolean).join(' · ') || 'Original details are shown beside your saved record.'}</blockquote><p className="v2-muted">Review the worker’s own words. Do not combine details from other speakers.</p></section><section><h2>Confirmed details</h2><div className="v2-fields">{keys.map((key, i) => <label key={key}>{labels[i]}<input maxLength={500} value={fields[key] ?? ''} placeholder="Not remembered" onChange={e => setFields({ ...fields, [key]: e.target.value || null })}/>{evidence[key] && <small>Source: {evidence[key]}</small>}</label>)}</div><div className="v2-actions"><button className="v2-primary" disabled={busy || !Object.values(fields).some(Boolean)} onClick={() => void save()}>{busy ? <Spinner /> : <Check size={18}/>}Confirm and save</button><button className="v2-text" disabled={busy || Boolean(operation.current)} onClick={() => setPage('capture')}>Back to account</button></div></section></div>}
      {page === 'restore' && <form className="v2-restore" onSubmit={e => { e.preventDefault(); void run(async () => { setSession(await request<Session>('/api/session/restore', jsonPost({ code: recovery }))); setRecovery(''); setRecords(await request<SavedEntry[]>('/api/history')); setPage('history'); }); }}><label htmlFor="restore-code">Recovery code</label><input id="restore-code" type="password" value={recovery} onChange={e => setRecovery(e.target.value)} autoComplete="off" required/><button className="v2-primary" disabled={busy || recovery.trim().length !== 43}>Reopen my history</button></form>}
      {(page === 'history' || page === 'saved') && <><div className="v2-records">{records.length ? records.map(record => <article key={record.id}><div className="v2-record-title"><h2>{record.fields.place ?? record.fields.task ?? 'Work account'}</h2><span>Confirmed {new Date(record.confirmedAt).toLocaleDateString()}</span></div><dl>{keys.map((key, i) => <div key={key}><dt>{labels[i]}</dt><dd>{record.fields[key] ?? 'Not remembered'}</dd></div>)}</dl><div className="v2-actions"><button className="v2-text" onClick={() => { setRevision(record); setFields({ ...record.fields }); setEvidence(record.evidence); setAccount(''); operation.current = null; setPage('review'); }}>Correct details</button>{record.sharing && <button className="v2-text" onClick={() => { if (window.confirm('Withdraw sharing and cancel pending follow-up?'))
            void run(async () => { await request('/api/history/' + record.id + '/sharing', { method: 'DELETE' }); setRecords(records.map(x => x.id === record.id ? { ...x, sharing: false } : x)); }); }}>Withdraw sharing</button>}</div></article>) : <p>No accounts saved yet. Start with one job you remember.</p>}</div>
      {code && <section className="v2-recovery"><h2>Your recovery code</h2><p>Keep this private. It opens your saved work histories.</p><code>{code}</code><button className="v2-text" onClick={() => void navigator.clipboard.writeText(code).then(() => setStatus('Recovery code copied.')).catch(() => setStatus('Select the code and copy it manually.'))}>Copy code</button></section>}
      <div className="v2-actions"><button className="v2-primary" onClick={newAccount}>Add another account</button><button className="v2-text" onClick={() => { const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'workecho-history.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Export history</button><button className="v2-text" onClick={() => void signout()}><LogOut size={16}/>Sign out</button></div></>}
      <footer className="v2-footer"><Lock size={17}/><p>Your words stay yours. Nothing is shared without your permission.{session && !durable ? ' This is an isolated rehearsal session. Use fictional details.' : ''}</p></footer>
      </div></main></div>;
}
createRoot(document.getElementById('root')!).render(location.pathname.startsWith('/staff/') ? <StaffWorkspace referralsPage={location.pathname === '/staff/referrals'}/> : <Workspace />);
