import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

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
  `);
  const now = () => Math.floor(Date.now() / 1000);
  const timestamp = () => new Date().toISOString();
  const toHistory = (row) => ({ id: row.id, fields: JSON.parse(row.payload), confirmedAt: row.confirmed_at });

  return {
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
    startIntake(session, { language, voice }) {
      const id = randomUUID();
      db.prepare('INSERT INTO intakes VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, session.id, language, Number(voice), NOTICE_VERSION, timestamp());
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
      const entry = {};
      for (const field of fields) {
        const value = body.fields[field];
        if (value !== null && (typeof value !== 'string' || !value.trim() || value.length > 500)) {
          throw new RequestError(400, 'An answer is blank or too long.');
        }
        entry[field] = typeof value === 'string' ? value.trim() : null;
      }
      if (!Object.values(entry).some(Boolean)) throw new RequestError(400, 'Include at least one remembered detail.');
      const payload = JSON.stringify(entry);
      const fingerprint = hash(payload);
      db.exec('BEGIN IMMEDIATE');
      try {
        this.intake(session, intakeId);
        const previous = db.prepare('SELECT * FROM histories WHERE intake_id = ?').get(intakeId);
        if (previous && (previous.operation !== body.operation || previous.fingerprint !== fingerprint)) {
          throw new RequestError(409, 'This interview has already been saved. Open your history to check it.');
        }
        const row = previous ?? { id: randomUUID(), payload, confirmed_at: timestamp() };
        if (!previous) db.prepare('INSERT INTO histories VALUES (?, ?, ?, ?, ?, ?)')
          .run(row.id, intakeId, payload, fingerprint, body.operation, row.confirmed_at);
        db.exec('COMMIT');
        return toHistory(row);
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
  };
}
