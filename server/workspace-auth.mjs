import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const WORKSPACE_SECONDS = 12 * 60 * 60;
const token = () => randomBytes(32).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);

export function workspaceAuth(db, { RequestError, hash, issueSession }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_profiles (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE, recovery_hash TEXT UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_staff (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      session_id TEXT NOT NULL REFERENCES sessions(id), salt TEXT NOT NULL, passphrase_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_staff_sessions (
      token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL
    );
  `);
  const setup = () => db.prepare('SELECT * FROM local_staff WHERE id = 1').get();
  const derive = (passphrase, salt) => scryptSync(passphrase, salt, 64);
  let attempts = [];

  return {
    hasStaff: () => Boolean(setup()),
    changePassword(currentPassword,password,credential) {
      const current=setup(),time=now();attempts=attempts.filter(value=>value>time-300);
      if(attempts.length>=10)throw new RequestError(429,'Wait five minutes before trying again.');
      if(typeof currentPassword!=='string'||typeof password!=='string'||password.trim().length<12||password.length>128||password===currentPassword)throw new RequestError(400,'Use a different passphrase of 12–128 characters.');
      if(!current||!timingSafeEqual(derive(currentPassword,current.salt),Buffer.from(current.passphrase_hash,'hex'))){attempts.push(time);throw new RequestError(401,'Check your current passphrase.');}
      const salt=randomBytes(32).toString('hex');
      db.prepare('UPDATE local_staff SET salt=?,passphrase_hash=? WHERE id=1').run(salt,derive(password,salt).toString('hex'));
      db.prepare('DELETE FROM local_staff_sessions WHERE token_hash<>?').run(hash(credential));attempts=[];return {changed:true};
    },
    staffScope: () => {
      const owner = setup();
      return owner ? { id: owner.session_id, workspace: true } : null;
    },
    isProfile: (id) => Boolean(db.prepare('SELECT 1 FROM local_profiles WHERE session_id = ?').get(id)),
    newProfile() {
      const account = issueSession(WORKSPACE_SECONDS);
      const code = token();
      db.prepare('INSERT INTO local_profiles VALUES (?, ?)').run(account.id, hash(code));
      return { ...account, code };
    },
    replaceRecoveryCode(account) {
      const code = token();
      const result = db.prepare('UPDATE local_profiles SET recovery_hash = ? WHERE session_id = ?').run(hash(code), account.id);
      if (!result.changes) throw new RequestError(401, 'Open your work history first.');
      return code;
    },
    resume(code) {
      const profile = typeof code === 'string' && /^[A-Za-z\d_-]{43}$/.test(code.trim())
        ? db.prepare('SELECT session_id FROM local_profiles WHERE recovery_hash = ?').get(hash(code.trim())) : null;
      if (!profile) throw new RequestError(401, 'The recovery code could not be found.');
      const value = token();
      db.prepare('UPDATE sessions SET token_hash = ?, expires = ?, closed = 0 WHERE id = ?')
        .run(hash(value), now() + WORKSPACE_SECONDS, profile.session_id);
      return value;
    },
    signIn(passphrase) {
      if (typeof passphrase !== 'string' || passphrase.trim().length < 12 || passphrase.length > 128) {
        throw new RequestError(400, 'Enter a passphrase between 12 and 128 characters.');
      }
      const time = now();
      attempts = attempts.filter((value) => value > time - 300);
      if (attempts.length >= 10) throw new RequestError(429, 'Too many attempts. Wait five minutes and try again.');
      const current = setup();
      if (current) {
        if (!timingSafeEqual(derive(passphrase, current.salt), Buffer.from(current.passphrase_hash, 'hex'))) {
          attempts.push(time);
          throw new RequestError(401, 'The staff passphrase is incorrect.');
        }
      } else {
        const salt = randomBytes(32).toString('hex');
        const anchor = issueSession(0);
        db.prepare('INSERT INTO local_staff VALUES (1, ?, ?, ?)').run(anchor.id, salt, derive(passphrase, salt).toString('hex'));
      }
      attempts = [];
      db.prepare('DELETE FROM local_staff_sessions WHERE expires <= ?').run(time);
      const value = token();
      db.prepare('INSERT INTO local_staff_sessions VALUES (?, ?)').run(hash(value), time + WORKSPACE_SECONDS);
      return value;
    },
    signedIn(value) {
      return typeof value === 'string' && /^[A-Za-z\d_-]{43}$/.test(value) && Boolean(
        db.prepare('SELECT 1 FROM local_staff_sessions WHERE token_hash = ? AND expires > ?').get(hash(value), now()));
    },
    signOut(value) {
      if (typeof value === 'string') db.prepare('DELETE FROM local_staff_sessions WHERE token_hash = ?').run(hash(value));
    },
  };
}
