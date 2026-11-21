import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { staffDemo } from './staff-demo.mjs';

export const SESSION_SECONDS = 30 * 60;
const NOTICE_VERSION = 'demo-v1';
export const fields = ['place', 'task', 'period', 'landmark', 'alias'];
export const isUuid = (id) => typeof id === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id);
export const hash = (s) => createHash('sha256').update(s).digest('hex');

export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function openStore(filename) {
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
  `);
  const now = () => Math.floor(Date.now() / 1000);
  const timestamp = () => new Date().toISOString();
  const toHistory = (row) => {
    const revision = db.prepare('SELECT * FROM history_revisions WHERE history_id = ? ORDER BY version DESC LIMIT 1').get(row.id);
    return {
      id: row.id, fields: JSON.parse(revision?.payload ?? row.payload), confirmedAt: row.confirmed_at,
      version: revision?.version ?? 1, evidence: JSON.parse(revision?.evidence ?? row.payload),
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

  const store = {
    close: () => db.close(),
    getSession(token) {
      if (!/^[A-Za-z\d_-]{43}$/.test(token ?? '')) return null;
      return db.prepare('SELECT id FROM sessions WHERE token_hash = ? AND closed = 0 AND expires > ?')
        .get(hash(token), now()) ?? null;
    },
    createSession() {
      db.prepare('DELETE FROM sessions WHERE expires <= ?').run(now());
      const token = randomBytes(32).toString('base64url');
      const id = randomUUID();
      db.prepare('INSERT INTO sessions(id, token_hash, expires) VALUES (?, ?, ?)')
        .run(id, hash(token), now() + SESSION_SECONDS);
      return { token, id };
    },
    signOut(session) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
    },
    startIntake(session, { language, voice, matching, outreach }) {
      const id = randomUUID();
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO intakes VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, session.id, language, Number(voice), NOTICE_VERSION, timestamp());
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
      if (!Object.values(entry).some(Boolean)) throw new RequestError(400, 'Include at least one remembered detail.');
      const payload = JSON.stringify(entry);
      const fingerprint = hash(body.evidence === undefined ? payload : JSON.stringify({ entry, evidence }));
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
        }
        const result = previous ? { id: row.id, fields: entry, evidence, confirmedAt: row.confirmed_at, version: 1 } : toHistory(row);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    history(session) {
      return db.prepare(`
        SELECT histories.* FROM histories JOIN intakes ON intakes.id = histories.intake_id
        WHERE intakes.session_id = ? ORDER BY histories.confirmed_at DESC, histories.rowid DESC
      `).all(session.id).map(toHistory);
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
        db.exec('COMMIT');
        return { ...current, fields: entry, version: current.version + 1 };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const demo = staffDemo(db, { toHistory, timestamp, RequestError, hash, isUuid });
  return { ...store, demo };
}
