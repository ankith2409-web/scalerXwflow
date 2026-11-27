import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { staffDemo } from './staff-demo.mjs';
import { workspaceAuth } from './workspace-auth.mjs';
import { RequestError } from './errors.mjs';
import { readSource, readPermissions, readDraft, validateEvidence } from './account.mjs';
export { RequestError } from './errors.mjs';

export const SESSION_SECONDS = 30 * 60;
const NOTICE_VERSION = 'demo-v1';
export const fields = ['place', 'task', 'period', 'landmark', 'alias'];
export const isUuid = (id) => typeof id === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id);
export const hash = (s) => createHash('sha256').update(s).digest('hex');

const demoTables = [
  'sessions', 'intakes', 'demo_preferences', 'histories', 'history_revisions', 'voice_usage',
  'demo_staff', 'demo_decisions', 'demo_referrals', 'demo_events',
  'account_sources', 'intake_drafts',
];

export function openStore(filename, demoSnapshot) {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, expires INTEGER NOT NULL, closed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS intakes (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      language TEXT NOT NULL, voice INTEGER NOT NULL, notice TEXT NOT NULL,
      started_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS histories (
      id TEXT PRIMARY KEY, intake_id TEXT UNIQUE NOT NULL REFERENCES intakes(id) ON DELETE CASCADE,
      payload TEXT NOT NULL, fingerprint TEXT NOT NULL, operation TEXT NOT NULL, confirmed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS voice_usage (
      intake_id TEXT NOT NULL REFERENCES intakes(id) ON DELETE CASCADE, requested INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS analysis_usage (session_id TEXT NOT NULL, requested INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS intakes_owner ON intakes(session_id);
    CREATE INDEX IF NOT EXISTS voice_usage_time ON voice_usage(requested);
    CREATE TABLE IF NOT EXISTS demo_preferences (
      intake_id TEXT PRIMARY KEY REFERENCES intakes(id) ON DELETE CASCADE,
      matching INTEGER NOT NULL, outreach INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS history_revisions (
      history_id TEXT NOT NULL REFERENCES histories(id) ON DELETE CASCADE,
      version INTEGER NOT NULL, payload TEXT NOT NULL, operation TEXT NOT NULL,
      evidence TEXT NOT NULL, changed_at TEXT NOT NULL,
      PRIMARY KEY(history_id, version), UNIQUE(history_id, operation)
    );
    CREATE TABLE IF NOT EXISTS account_sources (
      history_id TEXT PRIMARY KEY REFERENCES histories(id) ON DELETE CASCADE, source TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS intake_drafts (
      intake_id TEXT PRIMARY KEY REFERENCES intakes(id) ON DELETE CASCADE, version INTEGER NOT NULL,
      operation TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  const now = () => Math.floor(Date.now() / 1000);
  const timestamp = () => new Date().toISOString();
  const toHistory = (row) => {
    const revision = db.prepare('SELECT * FROM history_revisions WHERE history_id = ? ORDER BY version DESC LIMIT 1').get(row.id);
    const source = db.prepare('SELECT source FROM account_sources WHERE history_id = ?').get(row.id);
    const permissions = db.prepare('SELECT matching, outreach FROM demo_preferences WHERE intake_id = ?').get(row.intake_id);
    return {
      id: row.id, fields: JSON.parse(revision?.payload ?? row.payload), confirmedAt: row.confirmed_at,
      version: revision?.version ?? 1, evidence: JSON.parse(revision?.evidence ?? row.payload),
      source: source ? JSON.parse(source.source) : null,
      sharing: Boolean(permissions?.matching || permissions?.outreach),
      permissions: { matching: Boolean(permissions?.matching), outreach: Boolean(permissions?.outreach) },
    };
  };

  function readEntry(values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new RequestError(400, 'Check the work details.');
    const result = {};
    for (const field of fields) {
      const value = values[field];
      if (value !== null && (typeof value !== 'string' || !value.trim() || value.length > 500)) {
        throw new RequestError(400, 'An answer is blank or too long.');
      }
      result[field] = typeof value === 'string' ? value.trim() : null;
    }
    return result;
  }

  function issueSession(lifetime) {
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    db.prepare('INSERT INTO sessions(id, token_hash, expires) VALUES (?, ?, ?)').run(id, hash(token), now() + lifetime);
    return { token, id };
  }

  const workspace = workspaceAuth(db, { RequestError, hash, issueSession });

  const store = {
    close: () => db.close(),
    draft(session) {
      const row = db.prepare(`SELECT d.* FROM intake_drafts d JOIN intakes i ON i.id = d.intake_id
        WHERE i.session_id = ? AND NOT EXISTS (SELECT 1 FROM histories h WHERE h.intake_id = i.id)
        ORDER BY d.updated_at DESC, d.rowid DESC LIMIT 1`).get(session.id);
      return row ? { id: row.intake_id, version: row.version, data: JSON.parse(row.payload), updatedAt: row.updated_at } : null;
    },
    saveDraft(session, id, input) {
      if (!isUuid(input.operation) || !Number.isSafeInteger(input.version) || input.version < 0) throw new RequestError(400, 'Check the draft version.');
      const data = readDraft(input.data), payload = JSON.stringify(data);
      db.exec('BEGIN IMMEDIATE');
      try {
        this.intake(session, id);
        if (db.prepare('SELECT 1 FROM histories WHERE intake_id = ?').get(id)) throw new RequestError(409, 'This account has already been confirmed.');
        const previous = db.prepare('SELECT * FROM intake_drafts WHERE intake_id = ?').get(id);
        if (previous?.operation === input.operation) {
          if (previous.payload !== payload) throw new RequestError(409, 'This draft action has already been used.');
          db.exec('COMMIT'); return { id, version: previous.version, data, updatedAt: previous.updated_at };
        }
        if ((previous?.version ?? 0) !== input.version) throw new RequestError(409, 'This draft changed in another tab. Reopen the current draft.');
        const updatedAt = timestamp(), version = input.version + 1;
        db.prepare(`INSERT INTO intake_drafts VALUES (?, ?, ?, ?, ?) ON CONFLICT(intake_id)
          DO UPDATE SET version=excluded.version, operation=excluded.operation, payload=excluded.payload, updated_at=excluded.updated_at`)
          .run(id, version, input.operation, payload, updatedAt);
        db.exec('COMMIT'); return { id, version, data, updatedAt };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    discardDraft(session, id) {
      this.intake(session, id); db.prepare('DELETE FROM intake_drafts WHERE intake_id = ?').run(id);
      return { discarded: true };
    },
    reserveAnalysis(session) {
      db.prepare('DELETE FROM analysis_usage WHERE requested < ?').run(now() - 1800);
      if (db.prepare('SELECT count(*) AS n FROM analysis_usage WHERE session_id = ?').get(session.id).n >= 12) {
        throw new RequestError(429, 'Analysis limit reached. Enter the details manually.');
      }
      db.prepare('INSERT INTO analysis_usage VALUES (?, ?)').run(session.id, now());
    },
    getSession(token) {
      if (!/^[A-Za-z\d_-]{43}$/.test(token ?? '')) return null;
      return db.prepare('SELECT id FROM sessions WHERE token_hash = ? AND closed = 0 AND expires > ?')
        .get(hash(token), now()) ?? null;
    },
    createSession() {
      db.prepare(`DELETE FROM sessions WHERE expires <= ?
        AND id NOT IN (SELECT session_id FROM local_profiles) AND id NOT IN (SELECT session_id FROM local_staff)`).run(now());
      return issueSession(SESSION_SECONDS);
    },
    signOut(session) {
      if (workspace.isProfile(session.id)) {
        db.prepare('UPDATE sessions SET closed = 1 WHERE id = ?').run(session.id);
        return;
      }
      db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
    },
    startIntake(session, { language, voice, matching, outreach }) {
      const id = randomUUID();
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO intakes VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, session.id, language, Number(voice), workspace.isProfile(session.id) ? 'local-v1' : NOTICE_VERSION, timestamp());
        db.prepare('INSERT INTO demo_preferences VALUES (?, ?, ?)').run(id, Number(matching === true), Number(outreach === true));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return { id };
    },
    intake(session, id) {
      const intake = db.prepare('SELECT * FROM intakes WHERE id = ? AND session_id = ?')
        .get(id, session.id);
      if (!intake) throw new RequestError(404, 'Interview not found.');
      return intake;
    },
    reserveVoice(session, intake) {
      if (!intake.voice) throw new RequestError(403, 'Voice processing was declined.');
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM voice_usage WHERE requested <= ?').run(now() - SESSION_SECONDS);
        const { count } = db.prepare(`
          SELECT COUNT(*) AS count FROM voice_usage JOIN intakes ON intakes.id = voice_usage.intake_id
          WHERE intakes.session_id = ?
        `).get(session.id);
        if (count >= 20) throw new RequestError(429, 'Voice limit reached. Please type your answer.');
        db.prepare('INSERT INTO voice_usage VALUES (?, ?)').run(intake.id, now());
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    confirm(session, intakeId, body) {
      if (!isUuid(body.operation) || body.confirmed !== true || !body.fields || typeof body.fields !== 'object') {
        throw new RequestError(400, 'Check the entry and confirm before saving.');
      }
      const entry = readEntry(body.fields);
      const evidence = body.evidence === undefined ? entry : readEntry(body.evidence);
      const source = readSource(body.source);
      const permissions = body.permissions === undefined ? null : readPermissions(body.permissions);
      validateEvidence(evidence, source);
      if (!Object.values(entry).some(Boolean)) throw new RequestError(400, 'Include at least one remembered detail.');
      const payload = JSON.stringify(entry);
      const fingerprint = hash(source || permissions ? JSON.stringify({ entry, evidence, source, permissions }) : body.evidence === undefined ? payload : JSON.stringify({ entry, evidence }));
      db.exec('BEGIN IMMEDIATE');
      try {
        this.intake(session, intakeId);
        const previous = db.prepare('SELECT * FROM histories WHERE intake_id = ?').get(intakeId);
        if (previous && (previous.operation !== body.operation || previous.fingerprint !== fingerprint)) {
          throw new RequestError(409, 'This interview has already been saved. Open your history to check it.');
        }
        const row = previous ?? { id: randomUUID(), payload, confirmed_at: timestamp() };
        if (!previous) {
          db.prepare('INSERT INTO histories VALUES (?, ?, ?, ?, ?, ?)')
            .run(row.id, intakeId, payload, fingerprint, body.operation, row.confirmed_at);
          db.prepare('INSERT INTO history_revisions VALUES (?, 1, ?, ?, ?, ?)')
            .run(row.id, payload, body.operation, JSON.stringify(evidence), row.confirmed_at);
          if (permissions) db.prepare('UPDATE demo_preferences SET matching = ?, outreach = ? WHERE intake_id = ?')
            .run(Number(permissions.matching), Number(permissions.outreach), intakeId);
          if (source) db.prepare('INSERT INTO account_sources VALUES (?, ?)').run(row.id, JSON.stringify(source));
          db.prepare('DELETE FROM intake_drafts WHERE intake_id = ?').run(intakeId);
        }
        const result = toHistory({ ...row, intake_id: intakeId });
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    history(session) {
      const rows = db.prepare(`
        SELECT histories.* FROM histories JOIN intakes ON intakes.id = histories.intake_id
        WHERE intakes.session_id = ? ORDER BY histories.confirmed_at DESC, histories.rowid DESC
      `).all(session.id);
      if (!workspace.isProfile(session.id)) return rows.map(toHistory);
      return rows.map((row) => {
        const permissions = db.prepare('SELECT matching, outreach FROM demo_preferences WHERE intake_id = ?').get(row.intake_id);
        return { ...toHistory(row), sharing: Boolean(permissions?.matching || permissions?.outreach) };
      });
    },
    stopSharing(session, historyId) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db.prepare(`SELECT histories.* FROM histories JOIN intakes ON intakes.id = histories.intake_id
          WHERE histories.id = ? AND intakes.session_id = ?`).get(historyId, session.id);
        if (!row) throw new RequestError(404, 'History not found.');
        db.prepare('UPDATE demo_preferences SET matching = 0, outreach = 0 WHERE intake_id = ?').run(row.intake_id);
        demo.invalidate(session, historyId, toHistory(row).version, 'Worker withdrew sharing permission.');
        const staff = workspace.staffScope();
        if (staff) demo.invalidate(staff, historyId, toHistory(row).version, 'Worker withdrew sharing permission.');
        db.exec('COMMIT');
        return { sharing: false };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    deleteHistory(session, historyId, input) {
      if(input.confirmed!==true||!Number.isSafeInteger(input.version)||input.version<1)throw new RequestError(400,'Confirm deletion of the current record.');
      db.exec('BEGIN IMMEDIATE');
      try {
        const row=db.prepare(`SELECT histories.* FROM histories JOIN intakes ON intakes.id=histories.intake_id WHERE histories.id=? AND intakes.session_id=?`).get(historyId,session.id);
        if(!row)throw new RequestError(404,'History not found.');
        if(toHistory(row).version!==input.version)throw new RequestError(409,'This history changed. Review it before deletion.');
        for(const table of ['demo_events','demo_decisions','demo_referrals'])db.prepare(`DELETE FROM ${table} WHERE instr(${table==='demo_events'?'target':'candidate'},?)>0`).run(historyId);
        db.prepare('DELETE FROM histories WHERE id=?').run(historyId);
        db.prepare('DELETE FROM intakes WHERE id=?').run(row.intake_id);
        db.exec('COMMIT');return {deleted:true};
      }catch(error){db.exec('ROLLBACK');throw error;}
    },
    revise(session, historyId, body) {
      if (!isUuid(body.operation) || body.confirmed !== true || !Number.isSafeInteger(body.version)) {
        throw new RequestError(400, 'Confirm the corrected history before saving.');
      }
      const entry = readEntry(body.fields);
      if (!Object.values(entry).some(Boolean)) throw new RequestError(400, 'Include at least one remembered detail.');
      const payload = JSON.stringify(entry);
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db.prepare(`SELECT histories.* FROM histories JOIN intakes ON intakes.id = histories.intake_id
          WHERE histories.id = ? AND intakes.session_id = ?`).get(historyId, session.id);
        if (!row) throw new RequestError(404, 'History not found.');
        const current = toHistory(row);
        const retry = db.prepare('SELECT * FROM history_revisions WHERE history_id = ? AND operation = ?').get(historyId, body.operation);
        if (retry) {
          if (retry.version !== body.version + 1 || retry.payload !== payload) throw new RequestError(409, 'This action has already been used.');
          db.exec('COMMIT');
          return { ...current, version: retry.version, fields: JSON.parse(retry.payload) };
        }
        if (current.version !== body.version) throw new RequestError(409, 'This history has changed. Open it again.');
        db.prepare('INSERT INTO history_revisions VALUES (?, ?, ?, ?, ?, ?)')
          .run(historyId, current.version + 1, payload, body.operation, JSON.stringify(current.evidence), timestamp());
        demo.invalidate(session, historyId, current.version);
        const scope = workspace.staffScope();
        if (scope && workspace.isProfile(session.id)) demo.invalidate(scope, historyId, current.version);
        db.exec('COMMIT');
        return { ...current, fields: entry, version: current.version + 1 };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const demo = staffDemo(db, { toHistory, timestamp, RequestError, hash, isUuid });
  if (demoSnapshot) {
    try {
      db.exec('BEGIN');
      for (const table of demoTables) {
        const columns = Object.keys(demoSnapshot[table]?.[0] ?? {});
        if (columns.length === 0) continue;
        const insert = db.prepare(`INSERT INTO ${table} VALUES (${columns.map(() => '?').join(',')})`);
        for (const row of demoSnapshot[table]) insert.run(...Object.values(row));
      }
      db.exec('COMMIT');
    } catch (error) {
      db.close();
      throw error;
    }
  }
  store.demoSnapshot = () => Object.fromEntries(demoTables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  return { ...store, demo, workspace };
}
