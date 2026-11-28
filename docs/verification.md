# WorkEcho verification — 28 November 2026

Hosted AI is controlled by the runtime feature flags documented in architecture. The Gemini adapter has been checked with 25 real provider responses on typed fictional fixtures; see [the evaluation](extraction-evaluation.md). Flow dictation was confirmed working by the project owner on 28 November 2026. Authenticated Notetaker import is a separate, still-pending real-account check.

## Hosted Gemini activation - 28 November 2026

The owner explicitly enabled Gemini in the live app and fictional demo. Both runtime endpoints advertise Gemini extraction; OpenAI embeddings remain disabled. On deployment `dpl_CAz5TP216Dwvp4U54D6au8VhEe2a`, four fresh fictional samples returned actual Gemini responses: Hindi, Kannada, an English correction and an account containing negation plus another person's experience. The negation sample left all five fields blank; the correction retained the final Jodhpur answer rather than the retracted Jaipur answer. One Hindi display translation succeeded and preserved null fields. AI opt-out and a mismatched OpenAI consent receipt both returned rules. The isolated demo session was cleared; real worker records were not used.

These are hosted smoke checks, not a new accuracy benchmark, recorded Wispr test or user study. Exact source excerpts do not establish correct speaker attribution or negation in every account. Request caps remain 200 total, 50 per UTC day, 10 per worker session/day and 25 per client address per fixed 30-minute window. [CI run 46137584791](https://github.com/ankith2409-web/scalerXwflow/actions/runs/46137584791) passed application, Docker and hosted workflows for the released implementation.

A fifth, mixed Hindi/English fictional account was extracted by the hosted model and confirmed with its source and provider permission. Staff overview then included that exact new history in a Demo interview comparison with the original quote intact. The fictional record/session were deleted afterwards. This verifies the application data handoff; a real Flow recording of the journey is still needed.

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
| Submission source and staff demo incomplete | Docker setup, default-branch publication, isolated fictional staff demo and CI | Compose config passes; remote Docker build, keyless startup and workflow smoke test passed |

## Checks

- `npm test`: 58 tests passed locally, covering workflows, provider-specific consent, ownership, evidence, stale writes, recovery, referral transitions, embeddings, OAuth, private record deletion, password changes, hosted query routing, streamed MCP responses, keyless quota isolation, broader fictional fixtures and 17 synthetic matching checks.
- `npm run build`: TypeScript and Vite production build passed.
- `npm run test:cloud`: production schema, HTTP handler and additive migration passed together on PGlite PostgreSQL 0.3.16. Includes staff roles, anonymous denial, drafts, final consent, source preservation, correction and referral cancellation.
- `npm run test:browser`: real Chromium checks desktop/mobile flows and reports no uncaught browser exceptions. Requires PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.
- Maintenance checks exercise search across 230 synthetic archived records, page boundaries, literal search, password and recovery session revocation, and deletion with linked-data cleanup. Browser checks include an interrupted draft save and retry, reduced motion, Escape cancellation before deletion, confirmed deletion, staff search and password changes. Browser plugin not available; these checks use the Chromium/CDP fallback.
- Neon migration is checked first on the isolated workecho-quality-v2 branch before production application.
- Public Wispr discovery passed against the real provider on 27 November 2026: protected-resource and authorization-server metadata both returned HTTP 200. No accounts were authorized or meetings read. The provider check is separate from the synthetic OAuth/MCP tests.
- `docker compose config --quiet` passes. [GitHub Actions run 45965963180](https://github.com/ankith2409-web/scalerXwflow/actions/runs/45965963180) built the image, started the container and passed the keyless workflow smoke test. Local Docker Desktop remains unavailable. CI uses Ubuntu 24.04 because the pinned Playwright 1.56.1 does not support the Ubuntu 26.04 image now used by ubuntu-latest.

## QA review — 28 November 2026

The backend tests, TypeScript/Vite build, PostgreSQL workflow and migration-preservation checks passed again on this date. The full Chromium workflow passed without offline skips. The deployed worker app, worker demo and staff demo returned HTTP 200. [GitHub Actions run 46105265995](https://github.com/ankith2409-web/scalerXwflow/actions/runs/46105265995) passed application, Docker and isolated hosted-demo checks, including a fresh hosted rerun.

Additional exploratory checks exercised guided capture with Kannada text and escaped markup, interrupted attachment uploads, unsaved metadata edits, mobile staff comparison focus and the referral approval/invitation/response flow. Capture, saved history and staff review were checked at 320, 360, 390, 768, 1024 and 1440 pixels without horizontal overflow. The committed browser suite also checks English/Hindi/Kannada layouts across five widths.

Axe-core 4.14.0 reported zero automatic WCAG-tagged violations across five sampled states: capture, review, saved history, staff comparisons and referrals. One staff ARIA item required manual review. This is a sampled automated result, not a WCAG conformance certification. No uncaught application exceptions occurred in the exploratory browser run; network failures during fault injection were intentional.

These checks used Windows Chromium and isolated synthetic data. Real production worker records were not modified. Safari, Firefox, physical phones, screen readers, sustained load, backup restoration, real-account Wispr import and target-worker usability remain unverified.

## Known issues

| ID | Status | Fix and regression evidence |
| --- | --- | --- |
| QA-01: interrupted upload retry creates duplicates | Fixed | The browser retains the operation ID for the same file content, caption, sharing choice and history version until success. Chromium drops a committed upload response, retries, and verifies the attachment count stays unchanged. |
| QA-02: collapsing details loses unsaved years | Fixed | Record reloads preserve a dirty form; a successful explicit details save refreshes its baseline. Chromium enters 2005, closes/reopens details and uploads a file, then verifies the unsaved year survives both reloads. |

These regressions are now in the committed browser suite. Gemini tests also verify provider key separation, consent default-off, schema/excerpt validation, unknown spans, malformed replies, quota fallback and bounded usage. PostgreSQL checks reserve quotas through multiple handler instances/concurrent callers and verify that ordinary RPC cleanup preserves the counters. No production schema changes were made.

### Remaining validation and operational work

- Flow dictation works according to the project owner's device report. The automated checks prove field focus/readiness; they do not independently measure that recording.
- Authenticated Notetaker import, a real-device demonstration video and a three-person usability test still need the intended account and human participants.
- The Gemini credential is sensitive server configuration. Hosted extraction and translation are enabled with per-worker opt-in and durable caps; the evaluation and activation smoke checks used fictional input separately from production worker data.
- Cross-browser/physical-device, screen-reader, sustained-load and backup-restoration validation remains outstanding.

## Practical limits

The feature contract checks SQLite and PostgreSQL for directory aliases, versioned workplace links/cases, private locations/files, staff reviews, authenticated downloads, correction conflicts, withdrawal and cascading deletion. Browser checks also decode the rendered QR with an independent decoder, verify fragment-based private recovery, upload a fictional PDF, print a report without the private code, assign a case owner and test responsive layouts. The device draft check includes encrypted storage, offline reload/unlock and same-worker reconnect. A deliberately dropped response verifies that retrying an already accepted draft save does not duplicate it.

The migration audit installs 004 against a pre-feature schema seeded with fictional records. Counts and complete row hashes remain identical across all 14 existing tables; anonymous table access and RPC execution remain denied. This proves record preservation in that test. The owner approved migration 004, and it has been installed on the quality and production Neon branches. Anonymous access remains denied. Production activation uses the existing Vercel project.

Managed Windows browser profiles may need an explicit writable profile root: set WORKECHO_BROWSER_PROFILE_ROOT to a local temporary directory. The complete workflow passed locally with this setting and no offline skips. Linux CI uses its normal temporary directory and runs the same complete workflow.

The app is a working prototype. It does not guarantee every spoken language, perfect extraction, a verified shared workplace, medical diagnosis or automated outreach. Basic parsing is deliberately limited; unknown details require review. Worker UI supports three languages; staff UI uses English. Authenticated Wispr Notetaker import and target-worker usability still need real-account/human testing; Flow dictation is separately confirmed by the owner. Gemini extraction and translation require separate opt-in and never replace confirmation or access controls. OpenAI embedding ranking remains disabled.

Hosted fictional demo snapshots are encrypted and stored in a private sandbox table, separate from real worker records, with a 30-minute expiry and bounded capacity. Small keyless hosted demos can use encrypted cookies. Staff search covers all shared histories with pagination; comparison review covers the latest 200 records. Optional model ranking considers up to 40 records with both AI and comparison permission. Earlier records can lack the full source because the old app did not store it. The matching suite uses curated synthetic cases, not a real-worker accuracy benchmark. Forgotten staff-password recovery, whole-account deletion, offline confirmation/outreach, backup-restore rehearsal and alert routing remain outstanding; see docs/operations.md.
