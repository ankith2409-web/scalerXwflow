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

Drafts are saved only after explicit saving permission. Reload restores the private draft; stale writes from a second tab show a conflict and stop saving. Worker text is not kept in localStorage. Optional device drafts use a separate consent, IndexedDB, AES-GCM encryption and a device passphrase (PBKDF2-SHA256, 210,000 iterations). They expire after seven days and are removed on next access, confirmation, discard or worker closure. Only the public app shell is cached; API responses, files and map tiles are never cached by the service worker. Offline edits require the same worker and current server version before sync. Confirmation requires a connection. Lost-response retries reuse the original draft operation.

Without AI, bounded rules extract labelled text and some natural English/Hindi/Kannada phrases. This is limited parsing, not multilingual model inference; the five-question route always permits manual review. Unknown fields remain blank. The app never automatically confirms an account or infers a medical diagnosis.

## Optional text models (currently disabled)

Additional working features include optional remembered-year timelines; printable work-history reports (Save as PDF in the browser); private QR return cards; optional coordinate/area confirmation using on-demand OpenStreetMap or Google Maps links; a staff workplace directory with aliases and documented reviews; private supporting files with explicit sharing and staff review; and cases with active staff owners, next actions, due dates and open/paused/closed states. Directory reviews do not prove employment, proximity never links records automatically, and undated periods are never converted into invented dates.

Files are limited to three JPEG, PNG or PDF attachments per job, 256 KB each, with a 64 MB application storage cap. They start private. Both per-file sharing and current job-sharing permission are required for staff downloads. File signatures are checked; automatic malware scanning is unavailable. Use fictional files in demonstrations and avoid identity/medical documents. Corrections flag older workplace links and cases for review; withdrawn follow-up permission removes cases from staff views. Maps load only after an explicit request and require no API key. Device drafts are for editing captured text; Wispr's offline availability depends on the provider and device.

`WORKECHO_AI_ENABLED=0` is the default and the deployed setting. No model credits are spent. The server includes optional `gpt-4.1-mini` structured extraction and separate display translation, plus `text-embedding-3-small` ranking of already eligible workplace candidates. Enable only with `WORKECHO_AI_ENABLED=1` and a server-side `OPENAI_API_KEY` after choosing a usage budget. Model IDs can be changed with OPENAI_MODEL and OPENAI_EMBEDDING_MODEL. No training is required.

Model extraction accepts only exact source excerpts, preserves uncertainty and requires worker review. Missing details produce targeted questions via the guided screen. Model outages fall back to basic suggestions. Translation never overwrites the original record. Device readback uses an available local voice; it can report that a language has no local voice.

Embeddings require both comparison sharing and AI permission on each record. Only the five confirmed fields are sent, in batches of up to 40 records, with a bounded 10-minute hash/vector cache. A similarity score only ranks deterministic candidates; it never overrides a locality conflict, accepts a link or creates a referral.

## Staff and backend

Local Docker mode stores SQLite records on a volume and lets the first staff user create a passphrase. The hosted backend uses Neon PostgreSQL with individual accounts, expiring sessions, reviewer/health/admin roles, audit events, atomic writes and version checks. Only worker-shared histories are visible to staff. Referrals require outreach permission and an approval step. Invitations and appointments are performed outside WorkEcho and logged here.

The first cloud administrator needs a one-time setup code kept outside this repository. The owner has chosen to leave setup pending. Signed-in staff can change their password using the current password, revoking other sessions. Credentials and OAuth tokens stay server-side. Fresh schema: database/workecho.sql. Existing installations: apply migrations 002, 003 and 004 in order from database/migrations. Migration 004 adds feature metadata and encrypted fictional-demo storage without changing existing worker records. Test migrations on an isolated Neon branch first.

Staff use an overview request for comparison/referral data and a paginated search request for shared histories. Literal search reaches all shared records in pages of 25; comparison review remains bounded to the 200 most recent shared records. Approval, deletion ownership and outreach permissions are checked server-side. Operations and recovery guidance: docs/operations.md.

## Judge demo

Open `/?demo=1` (and `/staff/review?demo=1`) for an isolated fictional worker/staff workflow. It never uses real worker records, sends outreach or enables account connections/models. On Neon, encrypted sandbox snapshots live in a separate private table with random HttpOnly browser tokens, optimistic versions and a 30-minute expiry. Small keyless hosted demos can fall back to bounded encrypted cookies. Use fictional data. The main screen and Docker workflow load without secrets.

## Development

Use Node.js 24.12 or newer. Run `npm ci`, `npm run build`, then `npm start`. Local Node startup prints http://127.0.0.1:3002 or the next available port.

`npm test` checks ownership, consent, conflicts, idempotency, referrals, evidence and OAuth using a provider double. `node tests/chromium.browser.mjs` checks the rebuilt interface when PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH points to Chromium. `npm run test:cloud` checks production SQL with PGlite when PGLITE_ROOT points to @electric-sql/pglite 0.3.16.

Verification details and the ten-issue fix matrix are in docs/verification.md. Automated checks cover backend workflows, provider failures, consent, ownership and OAuth; PostgreSQL checks run the production SQL and HTTP handler together. Chromium checks use a real headless browser. A fresh Docker image built and passed keyless startup, confirmation, source persistence and recovery in GitHub Actions. Live model inference remains disabled by owner choice. Real Wispr account authorization, multilingual dictation quality and target-worker usability require real-account/device testing.

## Submission

Keep this repository public. The default branch must contain Dockerfile and docker-compose.yml so judges can start it directly. The supplied requirements screenshot shows only the code section; check the remaining two submission items before the single final submission. It specifies 30 November, 11:59 pm without showing a timezone. Do not claim code was written during the event without your own dated evidence.
