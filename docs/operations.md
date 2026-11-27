# WorkEcho operations

## First administrator

The owner selected leaving administrator setup pending. Open `/staff/review`, choose the administrator email and a new password, and provide the private bootstrap code. The code is kept outside GitHub. It is consumed by the first successful setup. Use the in-app staff access controls to create separate reviewer and health roles; never share the administrator password.

Signed-in staff can change their own password by providing the current one. Other sessions for that account are revoked. This is not a forgotten-password recovery service. A lost administrator password still needs an operator-assisted reset through the protected database, after verifying the account owner; no public bypass or email reset service is installed.

## Worker records and recovery

Workers can permanently delete a single saved job. The server checks ownership, explicit confirmation and the current version, then removes the original source, revisions, linked review decisions and referral records in one transaction. Other jobs are preserved. Do not test this on a real worker's record without that worker's action. A deletion is not an account deletion and does not revoke previously downloaded exports or erase provider backups immediately.

Rotating a worker recovery code invalidates the old code and signs out other cloud sessions. The current session remains active. With the code lost and no active session, there is intentionally no identity-free recovery bypass.

## Database recovery rehearsal

Use Neon's configured recovery window or an independently protected logical backup. Verify the project's actual available retention before relying on it. Recovery procedure:

1. Record the production branch ID and the time to recover to. Keep the production DATABASE_URL unchanged.
2. Restore into a separate branch or isolated database, using the provider's supported restore workflow. Never reset production as a test.
3. Run read-only checks for the schema, row counts, foreign-key integrity and RPC definitions. Compare selected records only with authorized staff, keeping their contents out of logs.
4. Run application tests against synthetic data on the isolated branch. Check ownership, record sources, consent, recovery and staff permissions.
5. Review the data difference and migration compatibility before approving a production cutover. Document the outcome and time required.

No backup restoration has been rehearsed yet. The checked-in migrations install RPC definitions; they do not execute worker-record deletion. Apply migration 003 to an isolated branch first, verify it, then apply the same definition change to production.

## Release checks

GitHub Actions runs backend tests, PostgreSQL integration, Chromium flows, keyless Docker startup and an HTTPS smoke test of the isolated hosted demo. Demo writes stay outside Neon worker data. The browser checks include connection loss and retry, reduced motion, a cancellable deletion dialog, record removal, staff search and password changes.

Monitor Vercel's existing runtime logs and Neon availability during a pilot. Dedicated alert routing, scheduled restore drills, a full retention policy and large-volume load testing remain to be configured. AI remains disabled; do not enable it or add paid notification services without the owner's decision.

## Matching and search limits

Staff can search all currently shared histories in pages of 25. Search treats input as a literal substring of the five fields; `%` is not a wildcard. Comparison review remains bounded to the latest 200 shared histories. Matching uses a small curated locality/landmark alias list and explicit conflict guards. The synthetic benchmark is a regression suite, not a measured real-world accuracy claim. Unknown aliases, spelling variants and actual multilingual interviews need a human-labelled evaluation set.
