# WorkEcho — Scaler × Wispr Flow

**Turn a worker’s spoken job history into a record they can check, keep and choose to share.**

WorkEcho is a working prototype for NGO field teams interviewing stone workers. It preserves the worker’s original words, organizes five remembered details and helps staff review possible shared workplaces for consented follow-up.

[![Verify WorkEcho](https://github.com/ankith2409-web/scalerXwflow/actions/workflows/verify.yml/badge.svg?branch=main)](https://github.com/ankith2409-web/scalerXwflow/actions/workflows/verify.yml)

## Open the app

| Link | Purpose |
| --- | --- |
| **[Live app on Vercel](https://workecho-psi.vercel.app/)** | Hosted worker workspace and Wispr account connection |
| **[Worker demo](https://workecho-psi.vercel.app/?demo=1)** | Try capture, review and saving with fictional information |
| **[Staff demo](https://workecho-psi.vercel.app/staff/review?demo=1)** | Explore fictional comparisons and simulated referrals without a staff account |

Use the demo links for evaluation. Their sandbox is separate from real worker records and expires after 30 minutes. Account connections, paid AI and actual outreach are disabled in the sandbox.

## Why WorkEcho exists

A worker may remember a contractor’s nickname, a railway crossing or a season rather than a formal employer name and exact dates. Field teams need to preserve that account and compare it with others without turning uncertain memories into facts.

For example, a **fictional** interview might say:

> I cut stone slabs at Raju shed near the railway crossing in Jodhpur for two monsoons before lockdown.

WorkEcho helps the worker review **place, work, approximate time, landmark and workplace or contractor name**. With permission, staff can investigate shared workplace clues and coordinate occupational-health follow-up. A suggested link is a lead for human review, not proof of employment or a medical diagnosis.

## Try the core flow

1. Open the **[worker demo](https://workecho-psi.vercel.app/?demo=1)**. Select **Try a fictional example** for sample text, or dictate fictional information using your installed Wispr Flow app. **One question at a time** offers guided entry.
2. Select **Save my draft and work history**. Choose comparison sharing and follow-up separately. Select **Prepare my review**, check the fields against **Original words**, then **Confirm and save this job**. Unknown details can stay blank. Inspect the private return card and recovery options.
3. Open the **[staff demo](https://workecho-psi.vercel.app/staff/review?demo=1)** and select **Enter as demo staff**. Inspect a seeded **Worker A / Worker B** comparison, record a decision reason and explore a simulated referral. The fixtures contain **43 fictional workers across 10 workplace scenarios** in five Indian cities.

## How it uses Wispr Flow

- **Flow-dictated input:** focus an answer and use the configured Wispr Flow shortcut or device keyboard. Flow inserts the text; WorkEcho handles review, consent and saving. The website does not operate Flow’s microphone or use a replacement recognizer.
- **Wispr Notetaker import:** select **From Wispr Notetaker** in the **[live app](https://workecho-psi.vercel.app/)**. OAuth with PKCE and the official Wispr MCP server retrieve a selected meeting transcript. A real account with Notetaker access is required. MCP imports transcripts; it does not start recordings.

The worker interface supports **English, Hindi and Kannada**; staff screens use English. Dictation language and device support depend on Wispr Flow. Real-device dictation and authenticated Notetaker import still need end-to-end verification.

## What works today

| Capability | Behavior |
| --- | --- |
| Worker review | Original text beside editable fields and source excerpts |
| Consent and ownership | Separate save, comparison and follow-up choices; recovery, correction, export, withdrawal and per-job deletion |
| Staff review | Shared-account comparisons, decision reasons and permission-gated referrals |
| Offline editing | Optional encrypted device drafts and reconnect checks; final confirmation requires a connection |

Supporting tools include remembered-year timelines, printable reports, private attachments, optional maps, a workplace directory and case management. Technical details and boundaries are in [architecture](docs/architecture.md).

**AI is disabled in the deployed app and demo.** Basic rules and guided manual entry remain available. Optional model adapters exist, but no live inference or multilingual accuracy result is claimed.

This is a prototype: production staff provisioning and target-user usability testing remain outstanding. Two open QA defects affect interrupted-upload retries and unsaved date edits. See [verification and known issues](docs/verification.md#known-issues) before using it beyond a demonstration.

## Run from source

The Vercel links above are the public preview. For local evaluation, install Docker with Linux containers running:

```sh
git clone https://github.com/ankith2409-web/scalerXwflow.git
cd scalerXwflow
docker compose up --build
```

Open the local address printed by the container. No API keys, environment file or cloud account are required for manual capture, confirmation, recovery or local staff access. Docker exposes port 3000 and preserves SQLite records in a named volume. Stop with `docker compose down`; adding `-v` deletes that volume.

For Node.js development, use **24.12 or newer**:

```sh
npm ci
npm run build
npm start
```

Use the address printed by the server; it selects an available development port. Optional configuration is documented in [.env.example](.env.example).

## Engineering and verification

React and TypeScript power the interface. The Node.js backend uses SQLite locally and Neon PostgreSQL on Vercel, with scoped worker sessions, staff roles, version checks and audit events.

The latest QA run passed **48 automated tests**, the production build, PostgreSQL checks, Chromium workflows and keyless Docker startup. Browser checks cover consent, recovery, encrypted offline reload, private files, source-preserving corrections and staff tools. These results do not establish real-world matching accuracy or production readiness.

```sh
npm test
npm run build
npm run test:browser
npm run test:cloud
```

Browser tests require `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; PostgreSQL tests require `PGLITE_ROOT`. Setup and coverage are documented below.

- [Architecture, data flow and optional integrations](docs/architecture.md)
- [Verification, test setup and known issues](docs/verification.md)
- [Operations, staff provisioning and recovery](docs/operations.md)
- [Database schema](database/workecho.sql) and [ordered migrations](database/migrations)
