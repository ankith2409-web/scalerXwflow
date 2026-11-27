# WorkEcho — Scaler × Wispr Flow

A working prototype for worker-confirmed work histories, shared workplace comparisons and referral follow-up.

## One-command startup

Run `docker compose up --build`, then open http://localhost:3000. Docker Desktop must run Linux containers. No environment file, API key or cloud account is required for the main screen, manual details, confirmation, saved history, recovery or local staff access. A Docker volume preserves records. Stop with `docker compose down`; adding `-v` deletes that volume.

## Genuine Wispr Flow

Install Wispr Flow, focus an account field and use the configured Flow shortcut or mobile keyboard. WorkEcho receives text inserted by Wispr. Its focus button does not start a microphone recording. Spoken languages depend on Wispr; the interface currently uses English. The rebuilt capture screen does not substitute browser speech recognition or Sarvam.

From Notetaker on the hosted app connects your account through OAuth with PKCE and reads selected meeting transcripts through the official Wispr MCP server. MCP cannot start recordings. Notetaker access and real-account authorization are required. Missing connection credentials show a setup state without blocking startup.

## Workflow

1. Dictate an account or add the five details directly with Flow.
2. Choose saving, comparison sharing and follow-up independently.
3. Review place, work, approximate time, landmark and name. Unknown details stay blank.
4. Confirm and save. Keep the private recovery code.
5. Reopen, correct, export or withdraw sharing. Withdrawal cancels pending referrals.

Without an optional analysis key, labelled text is extracted and the other fields are completed manually. Direct entry into the five fields needs no analysis key. The app never silently confirms an account or infers a medical diagnosis.

## Staff and backend

Local Docker mode stores SQLite records on a volume and lets the first staff user create a passphrase. The hosted backend uses Neon PostgreSQL with individual accounts, expiring sessions, reviewer/health/admin roles, audit events, atomic writes and version checks. Only worker-shared histories are visible to staff. Referrals require outreach permission and an approval step. Invitations and appointments are performed outside WorkEcho and logged here.

The first cloud administrator needs a one-time setup code kept outside this repository. Database credentials and OAuth access tokens never appear in browser code. Schema: database/workecho.sql.

## Development

Use Node.js 24.12 or newer. Run `npm ci`, `npm run build`, then `npm start`. Local Node startup prints http://127.0.0.1:3002 or the next available port.

`npm test` checks ownership, consent, conflicts, idempotency, referrals, evidence and OAuth using a provider double. `node tests/chromium.browser.mjs` checks the rebuilt interface when PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH points to Chromium. `npm run test:cloud` checks production SQL with PGlite when PGLITE_ROOT points to @electric-sql/pglite 0.3.16.

Verified: frontend build, 10 automated tests, PostgreSQL installation, and Chromium mobile/desktop capture, review, save, recovery and staff sign-in. Compose configuration validates. A full Docker image build requires a working engine and registry access. Real Wispr sign-in, multilingual dictation quality and target-worker usability need separate testing.

## Submission

Keep this repository public and share the branch containing docker-compose.yml. The supplied requirements screenshot shows only the code section; check the remaining two submission items before the single final submission. It specifies 30 November, 11:59 pm without showing a timezone.
