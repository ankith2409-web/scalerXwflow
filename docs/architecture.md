# WorkEcho architecture

WorkEcho is a prototype for worker-confirmed job histories and staff review of shared workplace accounts. This document describes implemented behavior; planned field-interview features are not part of the current release.

## Runtime and storage

| Mode | Interface and server | Persistence | Staff access |
| --- | --- | --- | --- |
| Local Node or Docker | React/TypeScript build served by Node.js | SQLite; Docker uses a named volume | Local staff passphrase setup |
| Hosted app | Vite build and Node.js API on Vercel | Neon PostgreSQL | Individual reviewer, health and administrator accounts |
| Hosted fictional demo | Same interface with explicit `?demo=1` routing | Encrypted, versioned sandbox snapshots in a separate private table; bounded encrypted-cookie fallback without Neon | Simulated staff access |

The fictional fixtures contain 43 synthetic workers across 10 scenarios in Bengaluru, Mysuru, Tumakuru, Jodhpur and Jaipur. They never seed real worker records. Sandbox state uses random HttpOnly browser tokens and a 30-minute expiry.

## Capture, review and confirmation

1. Wispr Flow inserts text into a story or guided-answer field. Typing and clearly labelled fictional examples also work.
2. Saving requires explicit permission. The server stores a scoped draft, with serialized updates, operation IDs and optimistic version checks. An interrupted draft-save response can be retried with the same operation ID.
3. Basic rules propose five fields from labelled input and a limited set of natural phrases. Guided entry permits manual completion. Source excerpts accompany proposals, and uncertain details can remain blank.
4. Confirmation records the original account, reviewed fields, evidence and final comparison/follow-up choices together. Revisions preserve the original source.
5. Staff can access only currently shared histories. Workplace links require comparison permission, and cases/referrals require follow-up permission. Matching proposes candidates; staff record the final decision and reason.

Worker recovery uses a private code and QR return card. Rotating a recovery code invalidates the old credential and other cloud sessions. A confirmed, ownership-checked job deletion removes its active application source, revisions and linked records. Exports already downloaded and provider backups have separate lifecycles.

## Wispr integration

Dictation happens in the installed Wispr Flow client. WorkEcho receives inserted text and provides focus guidance; it cannot start, monitor or certify a Flow recording. There is no replacement recognizer on the capture screen.

The hosted Notetaker import uses OAuth with PKCE and the official Wispr MCP server. OAuth tokens are encrypted in HttpOnly cookies and never exposed to browser JavaScript. The client handles JSON and streamed SSE replies, matches RPC identifiers, bounds response size and preserves provider failures. A transcript is imported only after the user selects a meeting.

Public metadata discovery and provider-double tests have passed. Real-account authorization and authenticated transcript import remain unverified end to end. Account connections are disabled in the fictional demo. See [verification](verification.md) for the distinction between synthetic and provider checks.

## Text models

The Gemini adapter performs structured extraction and separate display translation using gemini-3.5-flash-lite. Model output is validated against exact source excerpts and clear unknown-answer spans are discarded. The original source is preserved, and the worker reviews all five fields.

The worker sees the current extraction mode and chooses provider-specific text-processing consent. When AI is unavailable, declined, over quota or interrupted, basic suggestions/manual review remain available. The Gemini credential is server-side and is never sent to OpenAI or browser JavaScript. Gemini processes text only; speech input stays with Wispr Flow.

Legacy OpenAI extraction/translation and embedding adapters remain available as an alternative configuration. Gemini does not enable OpenAI embedding ranking. [Development evaluation](extraction-evaluation.md) records 25 real Gemini responses on typed fictional inputs.

### Gemini configuration and quotas

Local/Docker startup remains keyless. Hosted activation requires an explicit operator decision, WORKECHO_AI_ENABLED=1, WORKECHO_AI_PROVIDER=gemini, a sensitive server-side GEMINI_API_KEY and GEMINI_MODEL=gemini-3.5-flash-lite. The fictional hosted demo additionally requires WORKECHO_DEMO_AI_ENABLED=1 and Neon. A prepared credential alone does not activate processing.

Before a provider request, one atomic database statement reserves all four allowances in the existing private we_limits table:

| Scope | Maximum |
| --- | ---: |
| Project total across deployments | 200 reservations |
| Project per UTC day | 50 reservations |
| Worker session per UTC day | 10 reservations |
| Client address per fixed 30-minute window | 25 reservations |

The total counter has no automatic reset. Server input is bounded to 12,000 characters and output to 1,800 tokens. Counters contain hashed session/address identifiers and counts, not worker text. Failed reservations/provider requests may consume allowance conservatively. Database errors fail closed before model access. No schema migration is needed. These are application request limits, not a change to the provider account's billing settings.

Hosted availability is controlled by runtime flags and shown in the app. At this release's verification point, hosted AI remained off. [Verification](verification.md) separates the live configuration from isolated provider testing.

## Offline drafts

Device storage requires separate consent and a passphrase. IndexedDB holds AES-GCM ciphertext, random salt/IV and expiry metadata. PBKDF2-SHA256 derives the key with 210,000 iterations; the key and passphrase are not persisted. Device copies expire after seven days and are cleared on access after expiry, confirmation, discard or worker closure. Worker and demo copies use separate storage scopes.

The service worker caches the public application shell. It does not intercept API requests, attachments or remote map tiles. Offline edits can reconnect only under the same worker identity and an acceptable server version. Final confirmation requires a connection; there is no offline-finalization queue.

## Supporting tools and access boundaries

- Remembered-year timelines keep undated periods unknown. Corrections mark older workplace-link and case versions for review.
- Optional maps use explicit coordinates and an on-demand OpenStreetMap embed, with an external Google Maps link. Neither proximity nor a directory review automatically links worker accounts.
- Attachments are limited to three JPEG/PNG/PDF files per job, 256 KB each, with a 64 MB application storage cap. Signatures and metadata are validated. Current job sharing and separate per-file sharing are both required for staff downloads. Image compression and automatic malware scanning are not implemented.
- Staff cases record an active owner, next action, due date and status. Withdrawing follow-up permission removes cases from staff views. Invitations and appointments happen outside WorkEcho and are logged in the app.
- Shared-history search reaches all currently shared records in pages of 25. Candidate review is limited to the latest 200 shared records. Synthetic matching tests are regression checks, not a real-worker accuracy benchmark.

## Code and operations

- [Worker interface](../src/workspace.tsx), [staff interface](../src/staff.tsx) and [feature screens](../src/features)
- [Local server](../server/index.mjs), [cloud request handler](../server/cloud.mjs) and [Vercel API](../api/workecho.js)
- [Schema](../database/workecho.sql) and [migrations](../database/migrations); apply 002, 003 and 004 in order to existing installations, testing an isolated branch first
- [Operations](operations.md) for staff provisioning, password changes, recovery, backup limitations and pilot requirements
- [Verification](verification.md) for tested behavior, open defects and outstanding validation
