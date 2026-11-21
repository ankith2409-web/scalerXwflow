# WorkEcho

WorkEcho is a voice-first work history demo for stone cutters and polishers. Workers can answer in Hindi or English, correct a read-back, and open or export a confirmed record. Demo staff can compare fictional workplace accounts, record link decisions, and simulate a referral through an appointment. Use fictional information throughout the demo.

## Run locally

Install Node.js 24.12 or newer, then run:

```sh
npm install
npm run build
npm start
```

Open http://127.0.0.1:3000. SQLite is stored under `.data/`. Saved records, review decisions, and referral outcomes persist across refreshes within the same 30-minute demo session.

## Run the demo

1. Choose Hindi or English and allow saving. Enable comparison and simulated follow-up if you want your fictional entry to appear in the staff workflow.
2. Complete the five prompts with the fictional answers. Change the sample location from Jaipur to Jodhpur on the review screen, then confirm. Open the saved history to see the original wording, correct an entry, or download a text summary after confirming the download warning.
3. Open the **Staff workspace** and select **Enter as demo staff**. The seeded Worker A and C pair has a conflicting locality. Reject the link with a reason. For Worker A and B, check the shared locality and landmark, then accept the site link. Their employment overlap remains unknown.
4. Create a simulated referral. On **Referrals**, record simulated health-team approval before approving. Record the invitation, response, appointment and completion. The activity list shows what happened and when.
5. Select **Reset demo** in the staff workspace or **Finish and sign out** in the worker view to clear the current session. A new session starts with fresh fictional examples.

## Optional microphone input

Copy `.env.example` to `.env` and set `SARVAM_API_KEY` on the server. Restart the app to enable the recording consent option. If selected, clips of up to 25 seconds are sent to Sarvam for transcription. WorkEcho does not persist the audio. Hindi and English read-back use browser speech synthesis and depend on installed on-device voices. Typed answers and fictional examples work without a credential.

On another device, browser microphone access needs HTTPS. If running behind an HTTPS reverse proxy in a controlled demo environment, set `HOST`, `APP_ORIGIN` to the exact HTTPS origin and `SECURE_COOKIES=1`. This SQLite demo needs a single Node server with a writable, persistent disk.

## Tests and scope

`npm test` checks consent, idempotency, corrections, cross-session isolation, staff decisions, and referral transitions. After building, install Chromium with `npx playwright install chromium` and run `npm run test:browser` for the worker and staff walkthrough. The microphone test uses a stub transcription provider.

This build uses React/Vite and Node's built-in SQLite. The demo staff role is intentionally open inside its own fictional session. A live pilot requires partner-managed accounts, organisation-scoped storage, reviewed vendor agreements, screening capacity and a supervised contact process.
