import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, AudioLines, ClipboardCheck, GitCompare, Info, MapPin } from 'lucide-react';
import { keys, type Entry } from './copy';
import { jsonPost, request } from './voice';

type Account = { label: string; fields: Entry; quote: string };
type Candidate = { id: string; left: Account; right: Account; status: string; version: number; reason: string;
  outreach: boolean; eligible: boolean; conflict: boolean; overlap: string; clues: string[]; referral: boolean; rulesVersion: number };
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

export function StaffWorkspace({ referralsPage }: { referralsPage: boolean }) {
  const [active, setActive] = useState<boolean | null>(null);
  const [matches, setMatches] = useState<Candidate[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [filter, setFilter] = useState('all');
  const [selection, setSelection] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const title = referralsPage ? 'Referral follow-up' : 'Workplace review';

  async function load() {
    const [nextMatches, nextReferrals] = await Promise.all([
      request<Candidate[]>('/api/staff/matches'), request<Referral[]>('/api/staff/referrals'),
    ]);
    setMatches(nextMatches);
    setReferrals(nextReferrals);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (failure) {
      const code = (failure as Error).message;
      if (code === '401') setActive(false);
      if (code === '409' || code === '404') await load().catch(() => {});
      setError(code === '409' || code === '404' ? 'This record changed or the action is unavailable. Review the current information and try again.'
        : 'The workspace could not complete this action. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    const { active: signedIn } = await request<{ active: boolean }>('/api/staff/session');
    setActive(signedIn);
    if (signedIn) await load();
  }

  useEffect(() => { void run(refresh); }, []);
  const queue = matches.filter((item) => filter === 'all' || item.status === filter ||
    (filter === 'reviewed' && ['accepted', 'rejected'].includes(item.status)));
  const current = queue.find((item) => item.id === selection) ?? queue[0];
  const referral = referrals.find((item) => item.id === selection) ?? referrals[0];

  const decide = (item: Candidate, status: string, reason: string, operation: string) => run(async () => {
    await request('/api/staff/matches/' + item.id + '/decision', jsonPost({ status, reason, operation, version: item.version }));
    await load();
    setMessage('Review decision saved.');
  });
  const moveReferral = (item: { id: string; version: number }, status: string, reason: string, operation: string, healthApproval = false) => run(async () => {
    await request('/api/staff/referrals/' + item.id + '/transition', jsonPost({ status, reason, operation, healthApproval, version: item.version }));
    await load();
    setMessage('Simulated referral updated.');
  });

  return <div className="site staff-site" lang="en">
    <header className="header"><div className="header-inner staff-head">
      <a href="/" className="wordmark"><AudioLines size={23} aria-hidden="true" />WorkEcho</a>
      <a className="quiet" href="/"><ArrowLeft size={18} aria-hidden="true" />Worker view</a>
    </div></header>
    <div className="staff-shell">
      <aside className="staff-side"><nav aria-label="Staff workspace">
        <a href="/staff/review" aria-current={!referralsPage ? 'page' : undefined}><GitCompare size={19} aria-hidden="true" />Workplace review</a>
        <a href="/staff/referrals" aria-current={referralsPage ? 'page' : undefined}><ClipboardCheck size={19} aria-hidden="true" />Referrals</a>
      </nav>
      {active && <div className="staff-session">
        <button className="quiet" disabled={busy} onClick={() => void run(async () => {
          await request('/api/staff/session', { method: 'DELETE' }); setActive(false); setMatches([]); setReferrals([]);
        })}>Exit staff workspace</button>
        <button className="quiet" disabled={busy} onClick={() => {
          if (!window.confirm('Clear work histories, review decisions and simulated referrals in this demo session?')) return;
          void run(async () => { await request('/api/session', { method: 'DELETE' }); setActive(false); setMatches([]); setReferrals([]); setMessage('Demo reset.'); });
        }}>Reset demo</button>
      </div>}</aside>
      <main className="staff-main">
        <h1>{title}</h1>
        <p className="demo-note"><Info size={18} aria-hidden="true" />Fictional records. All outreach is simulated.</p>
        {error && <p className="notice" role="alert">{error}</p>}
        {message && <p className="status-note" role="status">{message}</p>}
        {active === null && (busy ? <p role="status">Loading workspace…</p> : <button className="quiet" onClick={() => void run(refresh)}>Try again</button>)}
        {active === false && <div className="paper staff-entry"><h2>Open the demo workspace</h2><p>Compare fictional work histories and practice recording referral outcomes.</p>
          <button className="primary" disabled={busy} onClick={() => void run(async () => {
            await request('/api/staff/session', { method: 'POST' }); await refresh();
          })}>Enter as demo staff <ArrowRight size={18} aria-hidden="true" /></button></div>}
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
            </button>) : <p className="muted">No candidates in this view.</p>}
          </section>
          {current && <section className="paper comparison" aria-labelledby="compare-title">
            <div className="panel-heading"><h2 id="compare-title">{current.conflict ? 'Conflicting workplace details' : 'Possible shared workplace'}</h2><span className="tag">{states[current.status]}</span></div>
            <div className="evidence-cards"><AccountCard item={current.left} /><AccountCard item={current.right} /></div>
            <div className="evidence-note"><h3>Evidence</h3><p>{current.clues.join(' · ')}</p>
              {current.conflict && <p className="conflict-text">The confirmed locations differ. Keep these histories separate.</p>}
              <p><strong>Employment overlap</strong> {current.overlap === 'overlap' ? 'Supported by the reported years.' : current.overlap === 'separate' ? 'The reported periods are separate.' : 'Unknown from the reported time details.'}</p>
              {current.reason && <p><strong>Decision reason</strong> {current.reason}</p>}
            </div>
            {!current.referral && <ActionForm key={current.id + ':' + current.version} busy={busy} label="Decision reason"
              actions={Object.entries(reviewActions).filter(([value]) => value !== 'accepted' || current.eligible)}
              onAction={(value, reason, operation) => decide(current, value, reason, operation)} />}
            {current.status === 'accepted' && (current.referral ? <a className="text-link" href="/staff/referrals">Open referrals <ArrowRight size={18} aria-hidden="true" /></a>
              : current.outreach ? <button className="quiet" onClick={() => void moveReferral(current, 'draft', 'Opened a simulated referral for follow-up.', crypto.randomUUID())} disabled={busy}>Create simulated referral</button>
              : <p className="notice">Outreach was declined for this interview.</p>)}
          </section>}
        </div>}
        {active && referralsPage && <div className="staff-grid">
          <section className="paper queue"><h2>Referrals</h2>
            {referrals.length ? referrals.map((item) => <button className="queue-item" type="button" key={item.id} aria-pressed={item.id === referral?.id} onClick={() => setSelection(item.id)}>
              <span>{item.label}</span><span className="tag">{states[item.status]}</span></button>) : <p className="muted">No referrals yet.</p>}
            <a className="text-link" href="/staff/review">Open review queue</a>
          </section>
          {referral && <section className="paper comparison">
            <div className="panel-heading"><h2>{referral.label}</h2><span className="tag">{states[referral.status]}</span></div>
            <p className={referral.outreach ? 'status-note' : 'notice'}>{referral.outreach ? 'Simulated outreach permission recorded.' : 'Outreach unavailable.'}</p>
            <h3>Activity</h3><ol className="referral-timeline">{referral.events.map((event, index) => <li key={index}>
              <strong>{states[event.status]}</strong><small>{event.actor} · <time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time></small><p>{event.reason}</p>
            </li>)}</ol>
            {!!referral.actions.length && <ActionForm key={referral.id + ':' + referral.version} busy={busy} label="Follow-up note"
              actions={referral.actions.map((action) => [action, referralActions[action]])} approval={referral.status === 'draft'}
              onAction={(value, reason, operation, healthApproval) => moveReferral(referral, value, reason, operation, healthApproval)} />}
          </section>}
        </div>}
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
  approval?: boolean; onAction: (status: string, reason: string, operation: string, healthApproval: boolean) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [approved, setApproved] = useState(false);
  const [operation, setOperation] = useState<{ signature: string; id: string } | null>(null);
  return <form className="staff-action" onSubmit={(event) => {
    event.preventDefault();
    const status = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
    if (busy || !status || !reason.trim() || (status === 'approved' && !approved)) return;
    const signature = JSON.stringify([status, reason.trim(), approved]);
    const id = operation?.signature === signature ? operation.id : crypto.randomUUID();
    setOperation({ signature, id });
    void onAction(status, reason.trim(), id, approved);
  }}>
    <label className="field-label" htmlFor="action-reason">{label}</label>
    <textarea id="action-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={280} required />
    {approval && <label className="approval"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />Record simulated health-team approval</label>}
    <div className="action-row">{actions.map(([value, title], index) => <button className={index === 0 ? 'primary' : 'quiet'} type="submit" value={value} key={value}
      disabled={busy || !reason.trim() || (value === 'approved' && !approved)}>{title}</button>)}</div>
  </form>;
}
