# WorkEcho — Scaler × Wispr Flow

A working prototype for worker-confirmed work histories, shared workplace comparisons and referral follow-up.

## One-command startup

Run `docker compose up --build`, then open http://localhost:3000. Docker Desktop must run Linux containers. No environment file, API key or cloud account is required for the main screen, manual details, confirmation, saved history, recovery or local staff access. A Docker volume preserves records. Stop with `docker compose down`; adding `-v` deletes that volume.

## Genuine Wispr Flow

Install Wispr Flow, use the in-app setup guide, focus an answer and use your configured Flow shortcut, keyboard or bubble. WorkEcho receives the text Flow inserts; it cannot start or monitor Flow's microphone. Worker prompts, controls and Notetaker import screens have English, Hindi and Kannada translations. Staff screens use English. Spoken language support depends on Wispr and the device. The capture screen uses no replacement recognizer.

From Notetaker on the hosted app connects your account through OAuth with PKCE and reads selected meeting transcripts through the official Wispr MCP server. MCP cannot start recordings. Notetaker access and real-account authorization are required. Missing connection credentials show a setup state without blocking startup.

## Workflow

1. Dictate one job's story or follow five questions, using Flow in each answer field.
2. Choose saving, comparison sharing and follow-up independently.
3. Review place, work, approximate time, landmark and name. Unknown details stay blank.
4. Confirm the final sharing choices and save the job with its complete original account. Download a private return card with the recovery code.
5. Reopen, correct, export, withdraw sharing or permanently delete a job. Corrections preserve the source; deletion removes its source and related review/follow-up records after confirmation. Rotating a recovery code also signs out other devices. Use “Start a different worker” to separate sessions.

Drafts are saved only after explicit saving permission. Reload restores the private draft; stale writes from a second tab show a conflict and stop saving. Worker text is not kept in localStorage. The final confirmation atomically stores the latest sharing choices, fields and source, including retry checks.

Without AI, bounded rules extract labelled text and some natural English/Hindi/Kannada phrases. This is limited parsing, not multilingual model inference; the five-question route always permits manual review. Unknown fields remain blank. The app never automatically confirms an account or infers a medical diagnosis.

## Optional text models (currently disabled)

`WORKECHO_AI_ENABLED=0` is the default and the deployed setting. No model credits are spent. The server includes optional `gpt-4.1-mini` structured extraction and separate display translation, plus `text-embedding-3-small` ranking of already eligible workplace candidates. Enable only with `WORKECHO_AI_ENABLED=1` and a server-side `OPENAI_API_KEY` after choosing a usage budget. Model IDs can be changed with OPENAI_MODEL and OPENAI_EMBEDDING_MODEL. No training is required.

Model extraction accepts only exact source excerpts, preserves uncertainty and requires worker review. Missing details produce targeted questions via the guided screen. Model outages fall back to basic suggestions. Translation never overwrites the original record. Device readback uses an available local voice; it can report that a language has no local voice.

Embeddings require both comparison sharing and AI permission on each record. Only the five confirmed fields are sent, in batches of up to 40 records, with a bounded 10-minute hash/vector cache. A similarity score only ranks deterministic candidates; it never overrides a locality conflict, accepts a link or creates a referral.

## Staff and backend

Local Docker mode stores SQLite records on a volume and lets the first staff user create a passphrase. The hosted backend uses Neon PostgreSQL with individual accounts, expiring sessions, reviewer/health/admin roles, audit events, atomic writes and version checks. Only worker-shared histories are visible to staff. Referrals require outreach permission and an approval step. Invitations and appointments are performed outside WorkEcho and logged here.

The first cloud administrator needs a one-time setup code kept outside this repository. The owner has chosen to leave this setup pending. Signed-in staff can change their password using the current password, revoking other sessions. Database credentials and OAuth access tokens never appear in browser code. Fresh schema: database/workecho.sql. Existing installations: apply database/migrations/002-workflow-quality.sql, then database/migrations/003-privacy-and-search.sql once in order. The migrations install schema and function definitions; they do not execute record deletion. Test migrations on an isolated Neon branch first.

Staff use an overview request for comparison/referral data and a paginated search request for shared histories. Literal search reaches all shared records in pages of 25; comparison review remains bounded to the 200 most recent shared records. Approval, deletion ownership and outreach permissions are checked server-side. Operations and recovery guidance: docs/operations.md.

## Judge demo

Open `/?demo=1` (or `/staff/review?demo=1`) for an isolated fictional worker/staff workflow. It never uses the Neon records, never sends outreach and disables account connections and model calls. Hosted demo state uses encrypted, HttpOnly cookies with a 30-minute lifetime and bounded capacity. Use short fictional accounts. Real worker and staff cookies stay separate. The main screen and local Docker workflow load without secrets.

## Development

Use Node.js 24.12 or newer. Run `npm ci`, `npm run build`, then `npm start`. Local Node startup prints http://127.0.0.1:3002 or the next available port.

`npm test` checks ownership, consent, conflicts, idempotency, referrals, evidence and OAuth using a provider double. `node tests/chromium.browser.mjs` checks the rebuilt interface when PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH points to Chromium. `npm run test:cloud` checks production SQL with PGlite when PGLITE_ROOT points to @electric-sql/pglite 0.3.16.

Verification details and the ten-issue fix matrix are in docs/verification.md. Automated checks cover backend workflows, provider failures, consent, ownership and OAuth; PostgreSQL checks run the production SQL and HTTP handler together. Chromium checks use a real headless browser. A fresh Docker image built and passed keyless startup, confirmation, source persistence and recovery in GitHub Actions. Live model inference remains disabled by owner choice. Real Wispr account authorization, multilingual dictation quality and target-worker usability require real-account/device testing.

## Submission

Keep this repository public. The default branch must contain Dockerfile and docker-compose.yml so judges can start it directly. The supplied requirements screenshot shows only the code section; check the remaining two submission items before the single final submission. It specifies 30 November, 11:59 pm without showing a timezone. Do not claim code was written during the event without your own dated evidence.
