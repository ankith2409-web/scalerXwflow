# WorkEcho verification — 27 November 2026

AI remains disabled at the owner's request. The adapters are implemented and provider-double tests pass; no live model inference or model-quality claim is made.

| Audit issue | Implemented fix | Evidence |
| --- | --- | --- |
| Final consent frozen at intake | Confirm atomically writes the final comparison and outreach choices | SQLite and PostgreSQL forward/reverse consent tests; browser back-edit regression |
| Natural stories yielded empty forms | Bounded natural-text extraction plus a five-question manual route | Natural English example yields five exact excerpts; Hindi/Kannada label tests |
| Wispr onboarding unclear | Setup guide, actual focus action, Notetaker connection states; no substitute microphone | Browser guide/focus check; OAuth PKCE/forgery tests; real provider sign-in not verified |
| Full original story lost | Separate immutable source stored alongside confirmed fields and meeting reference | Source survives reload, correction and export; invented evidence rejected |
| Reload or new-job data loss | Opt-in server drafts, serialized writes, version checks and discard guard | Browser reload, second-tab conflict, reload-current-draft and save-consent withdrawal |
| English-only capture and difficult recovery | English/Hindi/Kannada worker UI, local device readback, downloadable return card and code rotation | Browser language switches and recovery; actual device voices and native-speaker review still needed |
| New job confused with new worker | Separate controls and session closure with code-retention acknowledgement | Browser separate-worker closure and private-code recovery |
| Empty preview and distant mobile action | Removed empty side preview, question route and sticky action | 390px mobile action within viewport, 1440px desktop and overflow checks |
| Weak errors and empty/saved states | Signed-out empty state, retry/conflict actions, preserved text and clear follow-up explanation | Browser signed-out history; API ownership, rate-limit and model-unavailable tests |
| Submission source and staff demo incomplete | Docker setup, default-branch publication, isolated fictional staff demo and CI | Compose config passes locally; remote CI verifies build/start; check run status before claiming Docker success |

## Checks

- `npm test`: 19 tests passed locally, covering workflows, consent, ownership, evidence, stale writes, recovery, referral transitions, embeddings and OAuth.
- `npm run build`: TypeScript and Vite production build passed.
- `npm run test:cloud`: production schema, HTTP handler and additive migration passed together on PGlite PostgreSQL 0.3.16. Includes staff roles, anonymous denial, drafts, final consent, source preservation, correction and referral cancellation.
- `npm run test:browser`: real Chromium checks desktop/mobile flows and reports no uncaught browser exceptions. Requires PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.
- Neon migration is checked first on the isolated workecho-quality-v2 branch before production application.
- `docker compose config --quiet` passes. The local Docker engine is unavailable; full container execution is delegated to the checked-in GitHub Actions workflow, and must be reported using its actual result.

## Practical limits

The app is a working prototype. It does not guarantee every spoken language, perfect extraction, a verified shared workplace, medical diagnosis or automated outreach. Basic parsing is deliberately limited; unknown details require review. Worker UI supports three languages; staff UI uses English. Real Wispr OAuth sign-in, dictation and target-worker usability still need real-account and human testing. AI extraction, translation and embedding ranking are optional, disabled, and never replace confirmation or access controls.

Hosted fictional demo cookies have bounded capacity and expire after 30 minutes. Shared staff review covers the latest 200 records. Optional model ranking considers up to 40 records with both AI and comparison permission. Earlier records can lack the full source because the old app did not store it.
