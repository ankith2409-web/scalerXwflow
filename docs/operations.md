# WorkEcho operations

## First administrator

The owner selected leaving administrator setup pending. Open `/staff/review`, choose the administrator email and a new password, and provide the private bootstrap code. The code is kept outside GitHub. It is consumed by the first successful setup. Use the in-app staff access controls to create separate reviewer and health roles; never share the administrator password.

Signed-in staff can change their own password by providing the current one. Other sessions for that account are revoked. This is not a forgotten-password recovery service. A lost administrator password still needs an operator-assisted reset through the protected database, after verifying the account owner; no public bypass or email reset service is installed.

## Worker records and recovery

Workers can permanently delete a single saved job. The server checks ownership, explicit confirmation and the current version, then removes the original source, revisions, linked review decisions and referral records in one transaction. Other jobs are preserved. Do not test this on a real worker's record without that worker's action. A deletion is not an account deletion and does not revoke previously downloaded exports or erase provider backups immediately.

Rotating a worker recovery code invalidates the old code and signs out other cloud sessions. The current session remains active. With the code lost and no active session, there is intentionally no identity-free recovery bypass.

## Database recovery rehearsal

Use Neon's configured recovery window or an independently protected logical backup. Verify the project's actual available retention before relying on it. Recovery procedure:

Checked on 27 November 2026: this project's history retention is 21,600 seconds (six hours). The snapshot inventory and production snapshot schedule were empty. No backup settings, paid plan or snapshot schedule were changed. This short recovery window does not provide an overnight recovery guarantee.

1. Record the production branch ID and the time to recover to. Keep the production DATABASE_URL unchanged.
2. Restore into a separate branch or isolated database, using the provider's supported restore workflow. Never reset production as a test.
3. Run read-only checks for the schema, row counts, foreign-key integrity and RPC definitions. Compare selected records only with authorized staff, keeping their contents out of logs.
4. Run application tests against synthetic data on the isolated branch. Check ownership, record sources, consent, recovery and staff permissions.
5. Review the data difference and migration compatibility before approving a production cutover. Document the outcome and time required.

No backup restoration has been rehearsed yet. The checked-in migrations install RPC definitions; they do not execute worker-record deletion. Apply migrations 003 and 004 to an isolated branch first, verify it, then apply the same definition change to production.

## Wispr connection verification

`node tests/wispr.preflight.mjs` runs the actual public discovery code against Wispr. It verifies the protected-resource metadata and authorization-server metadata, without registering a client, authorizing an account, obtaining tokens or reading meetings. The separate “Wispr public preflight” workflow supports manual runs and runs for changes to this integration. On 27 November 2026, both metadata endpoints returned HTTP 200 and the authorization host was mcp-auth.wisprflow.com. This does not prove authenticated transcript import; complete that test in the app using the intended account.

The MCP client handles JSON and streamed SSE responses, matches the requested RPC id, limits bytes during reading, and stops reading once the response arrives. Synthetic stream tests include multiline frames, split Unicode, missing/error replies and a connection that remains open after the response.

## Release checks

GitHub Actions runs backend tests, PostgreSQL integration, Chromium flows, keyless Docker startup and an HTTPS smoke test of the isolated hosted demo. Demo writes stay outside Neon worker data. The browser checks include connection loss and retry, reduced motion, a cancellable deletion dialog, record removal, staff search and password changes.

Monitor Vercel's existing runtime logs and Neon availability during a pilot. Dedicated alert routing, scheduled restore drills, a full retention policy and large-volume load testing remain to be configured. The owner enabled Gemini extraction/translation in the hosted app and demo on 28 November 2026. Provider-specific worker consent and the shared durable request caps apply to both. The lifetime cap does not reset on redeployment; exceeding any cap returns basic/manual review. Disable processing with WORKECHO_AI_ENABLED=0 and redeploy if needed. Do not raise caps, add paid notification services or change provider-account billing without the owner's decision.

## Device drafts, attachments and demo isolation

Device drafts require separate consent and a passphrase. Only encrypted payloads, random salt/IV and expiry metadata are stored in IndexedDB; the key and passphrase are not persisted. Seven-day expiry is checked on access. Saving a job, discarding a draft or closing a worker clears the device copy. The app shell service worker caches public code only and never intercepts API requests or remote map tiles. It must finish installation before device storage can be enabled. Browser storage may be blocked. Managed Windows test profiles can use an explicit writable WORKECHO_BROWSER_PROFILE_ROOT; the complete workflow then runs without skips. Linux CI uses its normal temporary directory.

Attachment limits are three files per job, 256 KB each, with a 64 MB application storage cap. JPEG/PNG/PDF signatures and metadata are validated. No automatic malware scanning is provided. Downloads require authentication; staff also need current history sharing and per-file sharing. Private locations are removed from staff responses. Cases require follow-up permission; workplace links require matching permission. Corrections mark earlier link/case versions for review. Worker-record deletion cascades to attached files and feature metadata.

With Neon configured, the fictional demo uses encrypted, versioned snapshots in we_sandboxes, keyed by a random HttpOnly token. It does not create real workers/staff or read their histories. Expired snapshots are purged on subsequent demo activity. The server-side encryption key must remain private and stable; rotating it invalidates saved demo sessions. Global sandbox storage is bounded at 64 MB. Cookie-only fallback has much lower capacity.

## Matching and search limits

Staff can search all currently shared histories in pages of 25. Search treats input as a literal substring of the five fields; `%` is not a wildcard. Comparison review remains bounded to the latest 200 shared histories. Matching uses a small curated locality/landmark alias list and explicit conflict guards. The synthetic benchmark is a regression suite, not a measured real-world accuracy claim. Unknown aliases, spelling variants and actual multilingual interviews need a human-labelled evaluation set.
