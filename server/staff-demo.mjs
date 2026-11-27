import { randomBytes } from 'node:crypto';
import { compare } from './workplace-rules.mjs';
export { compare } from './workplace-rules.mjs';

const account = (label, place, task, period, landmark, alias, quote) => ({
  label, fields: { place, task, period, landmark, alias }, quote, version: 1,
});

const workerA = account('Worker A', 'Jodhpur, Rajasthan', 'Cut stone slabs', 'Two monsoons before lockdown',
  'Behind the railway crossing', 'Raju’s stone shed', 'Lockdown se pehle, Jodhpur mein railway crossing ke pichhe slabs kaat-ta tha.');
const comparisons = {
  b: account('Worker B', 'Jodhpur, Rajasthan', 'Polished stone slabs', '2019', 'Beside the railway crossing',
    'Raju’s stone shed', 'In 2019 I polished slabs in Raju’s shed beside the railway crossing in Jodhpur.'),
  c: account('Worker C', 'Jaipur, Rajasthan', 'Cut stone slabs', null, 'Near the bus stand',
    'Raju’s stone shed', 'Raju’s shed was by the Jaipur bus stand. I don’t remember the year.'),
};

export const nextStates = {
  draft: ['approved', 'cancelled'], approved: ['invited', 'cancelled'],
  invited: ['responded', 'declined', 'unreachable', 'cancelled'],
  responded: ['scheduled', 'declined', 'postponed', 'cancelled'],
  scheduled: ['completed', 'postponed', 'cancelled'], postponed: ['scheduled', 'cancelled'],
  unreachable: ['invited', 'cancelled'],
};

export function staffDemo(db, { toHistory, timestamp, RequestError, hash, isUuid }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS demo_staff (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS demo_decisions (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, candidate TEXT NOT NULL,
      status TEXT NOT NULL, reason TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY (session_id, candidate)
    );
    CREATE TABLE IF NOT EXISTS demo_referrals (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, candidate TEXT NOT NULL,
      status TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY (session_id, candidate)
    );
    CREATE TABLE IF NOT EXISTS demo_events (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, target TEXT NOT NULL,
      kind TEXT NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL,
      at TEXT NOT NULL, operation TEXT NOT NULL, fingerprint TEXT NOT NULL,
      PRIMARY KEY (session_id, operation)
    );
  `);

  function transaction(write) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = write();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function candidates(session) {
    const decisions = new Map(db.prepare('SELECT * FROM demo_decisions WHERE session_id = ?').all(session.id).map((row) => [row.candidate, row]));
    const referrals = new Set(db.prepare('SELECT candidate FROM demo_referrals WHERE session_id = ?').all(session.id).map((row) => row.candidate));
    const jobs = session.workspace ? workspaceSources().filter((item) => item.matching) : db.prepare(`SELECT histories.*, demo_preferences.outreach FROM histories
      JOIN intakes ON intakes.id = histories.intake_id JOIN demo_preferences ON demo_preferences.intake_id = intakes.id
      WHERE intakes.session_id = ? AND demo_preferences.matching = 1 ORDER BY histories.rowid DESC`).all(session.id)
      .map((row) => fromRow(row, 'Demo interview'));
    const sources = session.workspace ? jobs : [{ id: 'sample', person: workerA, outreach: true }, ...jobs];
    return sources.flatMap(({ id, person, outreach, owner }, index) => {
      const peers = session.workspace ? sources.slice(index + 1).filter((peer) => peer.owner !== owner)
        .map((peer) => [peer.id + ':' + peer.person.version, peer.person]) : Object.entries(comparisons);
      return peers.flatMap(([key, peer]) => {
      const result = compare(person, peer);
      if (!result.show) return [];
      const candidate = id + ':' + person.version + ':' + key;
      const decision = decisions.get(candidate);
      return [{ id: candidate, left: person, right: peer, ...result, outreach, rulesVersion: 1,
        status: decision?.status ?? 'waiting', reason: decision?.reason ?? '', version: decision?.version ?? 0,
        referral: referrals.has(candidate) }];
      });
    });
  }

  function fromRow(row, label) {
    const history = toHistory(row);
    return { id: history.id, person: { label, ...history, quote: history.source?.text || Object.values(history.evidence).filter(Boolean).join(' · ') },
      outreach: Boolean(row.outreach), matching: Boolean(row.matching), owner: row.owner };
  }

  function workspaceSources() {
    return db.prepare(`SELECT histories.*, intakes.session_id AS owner, prefs.matching, prefs.outreach FROM histories
      JOIN intakes ON intakes.id = histories.intake_id JOIN local_profiles ON local_profiles.session_id = intakes.session_id
      JOIN demo_preferences AS prefs ON prefs.intake_id = intakes.id
      WHERE prefs.matching = 1 OR prefs.outreach = 1 ORDER BY histories.id`).all().map((row) =>
      fromRow(row, 'Worker ' + row.owner.slice(0, 8).toUpperCase()));
  }

  const referralKey = ({ id, person }) => id + ':' + person.version + ':direct';
  function workspaceRecord(session, id) {
    const record = workspaceSources().find((item) => referralKey(item) === id);
    if (!record || !record.outreach) throw new RequestError(404, 'This record is unavailable for follow-up.');
    return record;
  }

  function getCandidate(session, id) {
    const candidate = candidates(session).find((item) => item.id === id);
    if (!candidate) throw new RequestError(404, 'Candidate not found or superseded.');
    return candidate;
  }

  function action(session, id, kind, data, write) {
    const reason = typeof data.reason === 'string' ? data.reason.trim() : '';
    if (!isUuid(data.operation) || !Number.isSafeInteger(data.version) || typeof data.status !== 'string' || !reason || reason.length > 280) {
      throw new RequestError(400, 'Enter a short reason and try again.');
    }
    const fingerprint = hash(JSON.stringify([id, kind, data.status, data.version, reason, data.healthApproval === true]));
    return transaction(() => {
      const previous = db.prepare('SELECT fingerprint FROM demo_events WHERE session_id = ? AND operation = ?').get(session.id, data.operation);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new RequestError(409, 'This action has already been used.');
        return { status: data.status };
      }
      write(reason);
      db.prepare('INSERT INTO demo_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(session.id, id, kind, data.status, reason, session.workspace ? 'Local staff' : 'Demo staff', timestamp(), data.operation, fingerprint);
      return { status: data.status };
    });
  }

  return {
    signIn(session) {
      const token = randomBytes(32).toString('base64url');
      db.prepare(`INSERT INTO demo_staff VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET token_hash = excluded.token_hash`)
        .run(session.id, hash(token));
      return token;
    },
    signedIn(session, token) {
      return Boolean(session && /^[A-Za-z\d_-]{43}$/.test(token ?? '') &&
        db.prepare('SELECT 1 FROM demo_staff WHERE session_id = ? AND token_hash = ?').get(session.id, hash(token)));
    },
    signOut(session) {
      db.prepare('DELETE FROM demo_staff WHERE session_id = ?').run(session.id);
    },
    candidates,
    records(session) {
      const referrals = new Set(db.prepare('SELECT candidate FROM demo_referrals WHERE session_id = ?').all(session.id).map((row) => row.candidate));
      const sources=session.workspace?workspaceSources():db.prepare(`SELECT h.*,i.session_id AS owner,p.matching,p.outreach FROM histories h JOIN intakes i ON i.id=h.intake_id JOIN demo_preferences p ON p.intake_id=i.id WHERE i.session_id=? AND (p.matching=1 OR p.outreach=1) ORDER BY h.id`).all(session.id).map(row=>fromRow(row,'Fictional worker'));
      return sources.map((item) => ({ ...item.person, id: referralKey(item), outreach: item.outreach, matching: item.matching,
        referral: referrals.has(referralKey(item)) }));
    },
    decide(session, id, data) {
      return action(session, id, 'review', data, (reason) => {
        const candidate = getCandidate(session, id);
        if (!['accepted', 'unresolved', 'rejected'].includes(data.status)) throw new RequestError(400, 'Choose a review decision.');
        if (candidate.version !== data.version || candidate.referral) throw new RequestError(409, 'Refresh this candidate before making another decision.');
        if (data.status === 'accepted' && !candidate.eligible) throw new RequestError(409, 'The confirmed locations conflict.');
        db.prepare(`INSERT INTO demo_decisions VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_id, candidate)
          DO UPDATE SET status = excluded.status, reason = excluded.reason, version = excluded.version`)
          .run(session.id, id, data.status, reason, candidate.version + 1);
      });
    },
    referrals(session) {
      const current = new Map(session.workspace ? workspaceSources().map((item) => [referralKey(item), { left: item.person, outreach: item.outreach }])
        : candidates(session).map((item) => [item.id, item]));
      return db.prepare('SELECT * FROM demo_referrals WHERE session_id = ? ORDER BY rowid DESC').all(session.id).map((row) => {
        const item = current.get(row.candidate);
        return { id: row.candidate, label: item?.left.label ?? 'Superseded interview', status: row.status, version: row.version,
          outreach: item?.outreach ?? false, actions: nextStates[row.status] ?? [],
          events: db.prepare(`SELECT status, reason, actor, at FROM demo_events
            WHERE session_id = ? AND target = ? AND kind = 'referral' ORDER BY rowid`).all(session.id, row.candidate) };
      });
    },
    transition(session, id, data) {
      return action(session, id, 'referral', data, () => {
        const existing = db.prepare('SELECT * FROM demo_referrals WHERE session_id = ? AND candidate = ?').get(session.id, id);
        if (!existing) {
          const candidate = session.workspace ? workspaceRecord(session, id) : getCandidate(session, id);
          const valid = session.workspace ? candidate.person.version === data.version
            : candidate.status === 'accepted' && candidate.version === data.version && candidate.outreach;
          if (data.status !== 'draft' || !valid) {
            throw new RequestError(409, 'An accepted link and outreach permission are required.');
          }
          db.prepare('INSERT INTO demo_referrals VALUES (?, ?, ?, 1)').run(session.id, id, 'draft');
          return;
        }
        if (existing.version !== data.version || !nextStates[existing.status]?.includes(data.status)) {
          throw new RequestError(409, 'Refresh this referral before taking the next step.');
        }
        if (data.status !== 'cancelled') {
          const candidate = session.workspace ? workspaceRecord(session, id) : getCandidate(session, id);
          if (!candidate.outreach || (!session.workspace && candidate.status !== 'accepted') || (data.status === 'approved' && data.healthApproval !== true)) {
            throw new RequestError(409, 'Check outreach permission and health-team approval.');
          }
        }
        db.prepare('UPDATE demo_referrals SET status = ?, version = version + 1 WHERE session_id = ? AND candidate = ?')
          .run(data.status, session.id, id);
      });
    },
    invalidate(session, historyId, version, reason = 'Worker updated the work history.') {
      const prefix = historyId + ':' + version + ':';
      const results = db.prepare(`UPDATE demo_referrals SET status = 'cancelled', version = version + 1
        WHERE session_id = ? AND candidate LIKE ? AND status NOT IN ('cancelled', 'completed', 'declined') RETURNING candidate`)
        .all(session.id, prefix + '%');
      for (const { candidate } of results) db.prepare('INSERT INTO demo_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(session.id, candidate, 'referral', 'cancelled', reason, 'WorkEcho', timestamp(), 'revise:' + candidate, '');
    },
  };
}
