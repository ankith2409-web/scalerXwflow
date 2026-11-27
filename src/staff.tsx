import {lazy,Suspense,useEffect, useRef, useState, type MouseEvent } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronRight, CircleAlert, ClipboardCheck, ClipboardList, Files, GitCompare, Info, LogOut, MapPin, RotateCcw, ShieldCheck } from 'lucide-react';
import { keys, type Entry } from './copy';
import { ApiError, jsonPost, request } from './voice';
import { Brand, Dialog, Skeleton, Spinner } from './ui';
const StaffFeatures=lazy(()=>import('./features/StaffFeatures').then(m=>({default:m.StaffFeatures})));
const StaffRecordExtras=lazy(()=>import('./features/StaffFeatures').then(m=>({default:m.StaffRecordExtras})));

type Account = { label: string; fields: Entry; quote: string };
type RecordItem = Account & { id: string; version: number; outreach: boolean; matching: boolean; referral: boolean };
type Candidate = { id: string; left: Account; right: Account; status: string; version: number; reason: string;
  outreach: boolean; eligible: boolean; conflict: boolean; overlap: string; clues: string[]; referral: boolean; rulesVersion: number; semanticSimilarity?: number };
type Referral = { id: string; label: string; status: string; version: number; outreach: boolean; actions: string[];
  events: { status: string; reason: string; actor: string; at: string }[] };
const states: Record<string, string> = { waiting: 'Needs review', unresolved: 'Unresolved', accepted: 'Link accepted',
  rejected: 'Rejected', draft: 'Draft', approved: 'Approved', invited: 'Invited', responded: 'Responded', scheduled: 'Scheduled',
  completed: 'Completed', declined: 'Declined', unreachable: 'Unreachable', postponed: 'Postponed', cancelled: 'Cancelled' };
const fieldLabels = { place: 'Locality', task: 'Work', period: 'Time as remembered', landmark: 'Landmark', alias: 'Name or nickname' };
const reviewActions = { accepted: 'Accept site link', unresolved: 'Leave unresolved', rejected: 'Reject link' };
const referralActions: Record<string, string> = { approved: 'Approve referral', invited: 'Simulate invitation', responded: 'Record response',
  scheduled: 'Record appointment', completed: 'Mark completed', declined: 'Record decline', unreachable: 'Mark unreachable',
  postponed: 'Postpone', cancelled: 'Cancel referral' };

export function StaffWorkspace({ referralsPage: initialReferralsPage }: { referralsPage: boolean }) {
  const [referralsPage, setReferralsPage] = useState(initialReferralsPage);
  const [active, setActive] = useState<boolean | null>(null);
  const [workspace, setWorkspace] = useState(false);
  const [setup, setSetup] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [cloud, setCloud] = useState(false);
  const [email, setEmail] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [role, setRole] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('reviewer');
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [matches, setMatches] = useState<Candidate[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [filter, setFilter] = useState('all');
  const [selection, setSelection] = useState('');
  const [busy, setBusy] = useState(true);
  const [resetOpen, setResetOpen] = useState(false);
  const [recordId, selectRecord] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(0),[total,setTotal]=useState(0);
  const [oldPassword,setOldPassword]=useState(''),[newStaffPassword,setNewStaffPassword]=useState('');
  const title = referralsPage ? 'Referral follow-up' : 'Workplace review';
  const heading = useRef<HTMLHeadingElement>(null);
  const demoSuffix = new URLSearchParams(location.search).get('demo') === '1' ? '?demo=1' : '';

  async function load(local = workspace,nextPage=page,nextSearch=search) {
    const [overview,result] = await Promise.all([request<{ matches: Candidate[]; referrals: Referral[]; records: RecordItem[] }>('/api/staff/overview'),request<{records:RecordItem[];total:number}>('/api/staff/search?query='+encodeURIComponent(nextSearch)+'&page='+nextPage)]);
    setMatches(overview.matches);
    setReferrals(overview.referrals);
    setRecords(result?.records??[]);setTotal(result?.total??0);setPage(nextPage);setSearch(nextSearch);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (failure) {
      const code = (failure as Error).message;
      const currentPasswordError=failure instanceof ApiError&&failure.detail.includes('current pass');
      if (code === '401'&&!currentPasswordError) setActive(false);
      if (code === '409' || code === '404') await load().catch(() => {});
      setError(code === '409' || code === '404' ? 'This record changed or the action is unavailable. Review the current information and try again.'
        : currentPasswordError ? 'Check your current password.' : code === '400'&&failure instanceof ApiError?failure.detail : code === '401' ? 'Check your passphrase or sign in again.' : code === '429' ? 'Too many attempts. Wait five minutes and try again.'
          : 'The workspace could not complete this action. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    const { active: signedIn, workspace: local, setup: needsSetup, cloud: hosted, role: staffRole } = await request<{ active: boolean; workspace: boolean; setup: boolean; cloud?: boolean; role?: string }>('/api/staff/session');
    setCloud(Boolean(hosted));
    setRole(staffRole ?? '');
    setWorkspace(local);
    setSetup(needsSetup);
    if (signedIn) await load(local);
    setActive(signedIn);
  }

  useEffect(() => {
    void run(refresh);
    const syncRoute = () => {
      setReferralsPage(location.pathname === '/staff/referrals');
      setSelection('');
    };
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [referralsPage]);

  function navigate(event: MouseEvent<HTMLAnchorElement>, next: boolean) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (next === referralsPage) return;
    history.pushState(null, '', (next ? '/staff/referrals' : '/staff/review') + demoSuffix);
    setSelection('');
    setError('');
    setMessage('');
    setReferralsPage(next);
  }
  const queue = matches.filter((item) => filter === 'all' || item.status === filter ||
    (filter === 'reviewed' && ['accepted', 'rejected'].includes(item.status)));
  const current = queue.find((item) => item.id === selection) ?? queue[0];
  const referral = referrals.find((item) => item.id === selection) ?? referrals[0];
  const record = records.find((item) => item.id === recordId) ?? records[0];

  const decide = (item: Candidate, status: string, reason: string, operation: string) => run(async () => {
    await request('/api/staff/matches/' + item.id + '/decision', jsonPost({ status, reason, operation, version: item.version }));
    await load();
    setMessage('Review decision saved.');
  });
  const moveReferral = (item: { id: string; version: number }, status: string, reason: string, operation: string, healthApproval = false) => run(async () => {
    await request('/api/staff/referrals/' + item.id + '/transition', jsonPost({ status, reason, operation, healthApproval, version: item.version }));
    await load();
    setMessage(workspace ? 'Referral updated.' : 'Simulated referral updated.');
  });

  return <div className="site staff-site" lang="en">
    <header className="header"><div className="header-inner staff-head">
      <Brand onHome={demoSuffix ? () => location.assign('/' + demoSuffix) : undefined}/>
      <a className="quiet" href={'/' + demoSuffix}><ArrowLeft size={18} aria-hidden="true" />Worker view</a>
    </div></header>
    <div className="staff-shell">
      <aside className="staff-side"><nav aria-label="Staff workspace">
        <a href={'/staff/review' + demoSuffix} aria-current={!referralsPage ? 'page' : undefined} onClick={(event) => navigate(event, false)}><GitCompare size={19} aria-hidden="true" />Workplace review</a>
        <a href={'/staff/referrals' + demoSuffix} aria-current={referralsPage ? 'page' : undefined} onClick={(event) => navigate(event, true)}><ClipboardCheck size={19} aria-hidden="true" />Referrals</a>
      </nav>
      {active && <div className="staff-session">
        <button className="quiet" disabled={busy} onClick={() => void run(async () => {
          await request('/api/staff/session', { method: 'DELETE' }); setActive(false); setMatches([]); setReferrals([]); setRecords([]);
        })}><LogOut size={16} aria-hidden="true" />Exit staff workspace</button>
        {!workspace && <button className="quiet" disabled={busy} onClick={() => setResetOpen(true)}><RotateCcw size={16} aria-hidden="true" />Reset demo</button>}
      </div>}</aside>
      <main className="staff-main" aria-busy={busy}>
        <div key={title} className="motion-page">
        <div className="staff-title"><h1 ref={heading} tabIndex={-1}>{title}</h1>
          {active !== null && <p className="demo-note"><Info size={17} aria-hidden="true" />{cloud ? 'Shared workspace. Log outreach performed outside WorkEcho.' : workspace ? 'Local workspace. Log outreach performed outside WorkEcho.' : 'Fictional records. All outreach is simulated.'}</p>}
          {active && <button className="quiet" disabled={busy} onClick={() => void run(async () => { await load(); setMessage('Workspace refreshed.'); })}>Refresh records</button>}
          {active && cloud && <p className="muted">Signed in as {email || role}. Only workers’ shared histories appear here.</p>}
        </div>
        {error && <p className="notice" role="alert"><CircleAlert size={18} aria-hidden="true" />{error}</p>}
        {message && <p className="status-note" role="status"><CheckCircle2 size={18} aria-hidden="true" />{message}</p>}
        {active&&workspace&&<details className="paper staff-entry"><summary>Change my password</summary><form onSubmit={event=>{event.preventDefault();void run(async()=>{await request('/api/staff/password',jsonPost({currentPassword:oldPassword,password:newStaffPassword}));setOldPassword('');setNewStaffPassword('');setMessage('Password changed. Other staff sessions for this account have been signed out.');});}}>
          <label className="field-label" htmlFor="current-password">Current password</label><input id="current-password" type="password" className="line-input" value={oldPassword} onChange={e=>setOldPassword(e.target.value)} required autoComplete="current-password"/>
          <label className="field-label" htmlFor="replacement-password">New password (at least 12 characters)</label><input id="replacement-password" type="password" className="line-input" value={newStaffPassword} onChange={e=>setNewStaffPassword(e.target.value)} required minLength={12} maxLength={cloud?72:128} autoComplete="new-password"/>
          <button className="primary" disabled={busy}>Change password</button></form></details>}
        {active && cloud && role === 'admin' && <details className="paper staff-entry"><summary>Manage staff access</summary>
          <form onSubmit={(event) => { event.preventDefault(); void run(async () => {
            await request('/api/staff/accounts',jsonPost({email:newEmail,password:newPassword,role:newRole}));setNewEmail('');setNewPassword('');setMessage('Staff account created. Share its credentials privately.');
          }); }}>
            <label className="field-label" htmlFor="new-staff-email">Staff email</label><input id="new-staff-email" type="email" className="line-input" required value={newEmail} onChange={e=>setNewEmail(e.target.value)} />
            <label className="field-label" htmlFor="new-staff-password">Initial password</label><input id="new-staff-password" type="password" className="line-input" autoComplete="new-password" required minLength={12} maxLength={72} value={newPassword} onChange={e=>setNewPassword(e.target.value)} />
            <label className="field-label" htmlFor="new-staff-role">Role</label><select id="new-staff-role" className="line-input" value={newRole} onChange={e=>setNewRole(e.target.value)}><option value="reviewer">Reviewer</option><option value="health">Health team</option><option value="admin">Administrator</option></select>
            <button className="primary" disabled={busy}>Create staff account</button>
          </form>
        </details>}
        {active === null && (busy ? <Skeleton label="Loading workspace" kind="workspace" /> : <button className="quiet" onClick={() => void run(refresh)}>Try again</button>)}
        {active === false && workspace && <form className="paper staff-entry" onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await request('/api/staff/session', jsonPost(cloud ? { email, password: passphrase, ...(setup ? { setupCode } : {}) } : { passphrase })); setPassphrase(''); setSetupCode(''); await refresh();
          });
        }}><span className="surface-icon"><ShieldCheck size={23} aria-hidden="true" /></span><h2>{setup ? 'Set up staff access' : 'Staff sign-in'}</h2>
          <p>{cloud ? (setup ? 'Use your one-time setup code to create the first administrator account.' : 'Sign in with your individual staff account.') : setup ? 'Create a staff passphrase of at least 12 characters. Keep it somewhere safe.' : 'Enter the passphrase for this computer’s staff workspace.'}</p>
          {cloud && <><label className="field-label" htmlFor="staff-email">Email</label><input id="staff-email" className="line-input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></>}
          {cloud && setup && <><label className="field-label" htmlFor="staff-setup">One-time setup code</label><input id="staff-setup" className="line-input" type="password" autoComplete="off" required value={setupCode} onChange={(e) => setSetupCode(e.target.value)} /></>}
          <label className="field-label" htmlFor="passphrase">{cloud ? 'Password' : 'Staff passphrase'}</label>
          <input className="line-input" id="passphrase" type="password" autoComplete={setup ? 'new-password' : 'current-password'}
            value={passphrase} onChange={(event) => setPassphrase(event.target.value)} minLength={12} maxLength={cloud ? 72 : 128} required />
          <button className="primary" disabled={busy || passphrase.trim().length < 12}>{busy && <Spinner />}{setup ? 'Create workspace' : 'Sign in'}</button>
        </form>}
        {active === false && !workspace && <div className="paper staff-entry"><h2>Open the demo workspace</h2><p>Compare fictional work histories and practice recording referral outcomes.</p>
          <button className="primary" disabled={busy} onClick={() => void run(async () => {
            await request('/api/staff/session', { method: 'POST' }); await refresh();
          })}>Enter as demo staff {busy ? <Spinner /> : <ArrowRight size={18} aria-hidden="true" />}</button></div>}
        {active&&!referralsPage&&<Suspense fallback={<Skeleton label="Loading workplace and case tools" kind="form"/>}><StaffFeatures/></Suspense>}
        {active && !referralsPage && <div className="staff-summary" aria-label="Workspace totals">
          <div><span className="surface-icon"><Files size={19} aria-hidden="true" /></span><span>Shared histories</span><strong>{records.length}</strong></div>
          <div><span className="surface-icon"><GitCompare size={19} aria-hidden="true" /></span><span>Awaiting review</span><strong>{matches.filter(({ status }) => status === 'waiting').length}</strong></div>
          <div><span className="surface-icon"><ClipboardCheck size={19} aria-hidden="true" /></span><span>Referrals</span><strong>{referrals.length}</strong></div>
        </div>}
        {active && !referralsPage && <div className="staff-grid">
          <section className="paper queue"><h2>Review queue</h2>
            <label htmlFor="review-filter" className="field-label">Show candidates</label>
            <select id="review-filter" value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">All candidates</option><option value="waiting">Needs review</option><option value="unresolved">Unresolved</option><option value="reviewed">Reviewed</option>
            </select>
            {queue.length ? queue.map((item) => <button className="queue-item" type="button" key={item.id} aria-pressed={item.id === current?.id} onClick={() => setSelection(item.id)}>
              <span>{item.left.label} / {item.right.label}</span>
              <small><MapPin size={13} aria-hidden="true" />{item.right.fields.place}</small>
              <span className={item.conflict ? 'tag conflict' : 'tag'}>{item.conflict ? 'Conflicting locations' : states[item.status]}</span>
              {item.conflict && item.status !== 'waiting' && <small>{states[item.status]}</small>}
              <ChevronRight className="queue-chevron" size={17} aria-hidden="true" />
            </button>) : <div className="queue-empty"><GitCompare size={22} aria-hidden="true" /><p>No candidates in this view.</p></div>}
          </section>
          {current && <section className="paper comparison" aria-labelledby="compare-title">
            <div className="panel-heading"><h2 id="compare-title">{current.conflict ? 'Conflicting workplace details' : 'Possible shared workplace'}</h2><span className="tag">{states[current.status]}</span></div>
            <div className="evidence-cards motion-detail" key={current.id}><AccountCard item={current.left} /><AccountCard item={current.right} /></div>
            <div className="evidence-note"><h3>Evidence</h3><p>{current.clues.join(' · ')}</p>
              {current.semanticSimilarity !== undefined && <p>Model ranking score: {current.semanticSimilarity.toFixed(3)}. This is text similarity, not a probability of a shared workplace.</p>}
              {cloud && <p className="muted">Review covers the 200 most recent shared records. Optional AI ranking uses up to 40 consenting records; staff verify every link.</p>}
              {current.conflict && <p className="conflict-text">The confirmed locations differ. Keep these histories separate.</p>}
              <p><strong>Employment overlap</strong> {current.overlap === 'overlap' ? 'Supported by the reported years.' : current.overlap === 'separate' ? 'The reported periods are separate.' : 'Unknown from the reported time details.'}</p>
              {current.reason && <p><strong>Decision reason</strong> {current.reason}</p>}
            </div>
            {!current.referral && <ActionForm key={current.id + ':' + current.version} busy={busy} label="Decision reason"
              actions={Object.entries(reviewActions).filter(([value]) => value !== 'accepted' || current.eligible)}
              onAction={(value, reason, operation) => decide(current, value, reason, operation)} />}
            {!workspace && current.status === 'accepted' && (current.referral ? <a className="text-link" href="/staff/referrals" onClick={(event) => navigate(event, true)}>Open referrals <ArrowRight size={18} aria-hidden="true" /></a>
              : current.outreach ? <button className="quiet" onClick={() => void moveReferral(current, 'draft', 'Opened a simulated referral for follow-up.', crypto.randomUUID())} disabled={busy}>Create simulated referral</button>
              : <p className="notice">Outreach was declined for this interview.</p>)}
          </section>}
        </div>}
        {active && !referralsPage && <section className="paper shared-records">
          <h2>Shared work histories</h2>
          <form className="staff-search" onSubmit={event=>{event.preventDefault();void run(()=>load(true,0,query));}}><label className="field-label" htmlFor="staff-search">Search all shared histories by place, task, time, landmark or name</label><div className="action-row"><input id="staff-search" className="line-input" maxLength={100} value={query} onChange={e=>setQuery(e.target.value)} placeholder="For example: Jodhpur"/><button className="quiet" disabled={busy}>Search</button></div></form>
          <div className="action-row"><span className="muted">{total?`${page*25+1}–${Math.min((page+1)*25,total)} of ${total}`:'No results'}</span><button className="quiet" disabled={busy||page===0} onClick={()=>void run(()=>load(true,page-1))}>Previous page</button><button className="quiet" disabled={busy||(page+1)*25>=total} onClick={()=>void run(()=>load(true,page+1))}>Next page</button></div>
          {record ? <>
            <label className="field-label" htmlFor="shared-record">Select a history</label>
            <select className="line-input" id="shared-record" value={record.id} onChange={(event) => selectRecord(event.target.value)}>
              {records.map((item) => <option value={item.id} key={item.id}>{item.label} · {item.fields.place ?? item.fields.task ?? 'Work history'}</option>)}
            </select>
            <AccountCard item={record} />
            <Suspense fallback={<p>Loading record tools…</p>}><StaffRecordExtras key={record.id} historyId={record.id}/></Suspense>
            <div className="action-row"><span className="tag">{record.outreach ? 'Follow-up permitted' : 'Follow-up not permitted'}</span>
              {workspace&&record.outreach && (record.referral ? <a href="/staff/referrals" className="text-link" onClick={(event) => navigate(event, true)}>Open referrals</a>
                : <button className="primary" disabled={busy} onClick={() => void moveReferral(record, 'draft', 'Opened for staff follow-up.', crypto.randomUUID())}>{busy && <Spinner />}Create referral</button>)}</div>
          </> : <div className="queue-empty"><Files size={22} aria-hidden="true" /><p>Confirmed histories appear here when workers allow comparison or follow-up.</p></div>}
        </section>}
        {active && referralsPage && <div className="staff-grid">
          <section className="paper queue"><h2>Referrals</h2>
            {referrals.length ? referrals.map((item) => <button className="queue-item" type="button" key={item.id} aria-pressed={item.id === referral?.id} onClick={() => setSelection(item.id)}>
              <span>{item.label}</span><span className="tag">{states[item.status]}</span><ChevronRight className="queue-chevron" size={17} aria-hidden="true" /></button>) : <div className="queue-empty"><ClipboardList size={22} aria-hidden="true" /><p>No referrals yet.</p></div>}
            <a className="text-link" href="/staff/review" onClick={(event) => navigate(event, false)}>Open review queue</a>
          </section>
          {referral && <section className="paper comparison">
            <div className="panel-heading"><h2>{referral.label}</h2><span className="tag">{states[referral.status]}</span></div>
            <p className={referral.outreach ? 'status-note' : 'notice'}>{referral.outreach ? (workspace ? 'Outreach permission recorded.' : 'Simulated outreach permission recorded.') : 'Outreach unavailable.'}</p>
            <h3>Activity</h3><ol className="referral-timeline motion-detail" key={referral.id}>{referral.events.map((event, index) => <li key={index}>
              <strong>{states[event.status]}</strong><small>{event.actor} · <time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time></small><p>{event.reason}</p>
            </li>)}</ol>
            {!!referral.actions.length && <ActionForm key={referral.id + ':' + referral.version} busy={busy} label="Follow-up note"
              actions={referral.actions.map((action) => [action, workspace && action === 'invited' ? 'Record invitation' : referralActions[action]])}
              approval={referral.status === 'draft' ? (workspace ? 'Record health-team approval' : 'Record simulated health-team approval') : undefined}
              onAction={(value, reason, operation, healthApproval) => moveReferral(referral, value, reason, operation, healthApproval)} />}
          </section>}
        </div>}
        </div>
        {resetOpen && <Dialog title="Reset demo" closeLabel="Close" onClose={() => setResetOpen(false)}>
          <p>Clear work histories, review decisions and simulated referrals in this demo session?</p>
          <div className="action-row"><button className="quiet" onClick={() => setResetOpen(false)}>Cancel</button>
            <button className="danger" onClick={() => {
              setResetOpen(false);
              void run(async () => { await request('/api/session', { method: 'DELETE' }); setActive(false); setMatches([]); setReferrals([]); setMessage('Demo reset.'); });
            }}>Reset demo</button></div>
        </Dialog>}
      </main>
    </div>
  </div>;
}

function AccountCard({ item }: { item: Account }) {
  return <article className="evidence-card"><h3>{item.label}</h3><p className="field-label">Confirmed account</p>
    <blockquote>“<bdi>{item.quote}</bdi>”</blockquote>
    <dl>{keys.map((key) => <div key={key}><dt>{fieldLabels[key]}</dt><dd><bdi>{item.fields[key] ?? 'Unknown'}</bdi></dd></div>)}</dl>
  </article>;
}

function ActionForm({ label, actions, busy, approval, onAction }: { label: string; actions: [string, string][]; busy: boolean;
  approval?: string; onAction: (status: string, reason: string, operation: string, healthApproval: boolean) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [approved, setApproved] = useState(false);
  const [operation, setOperation] = useState<{ signature: string; id: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  return <form className="staff-action" onSubmit={(event) => {
    event.preventDefault();
    const status = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
    if (busy || !status || !reason.trim() || (status === 'approved' && !approved)) return;
    const signature = JSON.stringify([status, reason.trim(), approved]);
    const id = operation?.signature === signature ? operation.id : crypto.randomUUID();
    setOperation({ signature, id });
    setPending(status);
    void onAction(status, reason.trim(), id, approved).finally(() => setPending(null));
  }}>
    <label className="field-label" htmlFor="action-reason">{label}</label>
    <textarea id="action-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={280} required />
    {approval && <label className="approval"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />{approval}</label>}
    <div className="action-row">{actions.map(([value, title], index) => <button className={index === 0 ? 'primary' : 'quiet'} type="submit" value={value} key={value}
      disabled={busy || !reason.trim() || (value === 'approved' && !approved)}>{pending === value && <Spinner />}{title}</button>)}</div>
  </form>;
}
