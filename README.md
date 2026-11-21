# WorkEcho

WorkEcho is a voice-first work history web application for stone cutters and polishers. This first milestone implements the worker's intake and confirmation workflow using fictional data. It includes Hindi and English prompts, editable recordings or typed answers, a spoken read-back where the browser has a suitable voice, and saved histories scoped to a short session.

## Run locally

Install Node.js 24.12 or newer, then run:

```sh
npm install
npm run build
npm start
```

Open http://127.0.0.1:3000. Choose a language, agree to save a demo history, and start. Use the fictional answer option or type a response. After the five questions, change the location on the review screen, confirm, and reopen the history. A refresh preserves saved entries while the session is active. Sign out clears the session and its entries. SQLite is stored under `.data/`.

## Optional microphone input

Copy `.env.example` to `.env` and set `SARVAM_API_KEY` on the server. Restart the app. The recording consent option then becomes available. If selected, Clips of up to 25 seconds are sent to Sarvam for transcription. WorkEcho does not persist the audio. Hindi and English read-back use browser speech synthesis and depend on installed on-device voices. The fictional example is clearly labelled and works without a credential.

Use fictional information while testing this milestone. On another device, browser microphone access needs HTTPS. If running behind an HTTPS reverse proxy in a controlled demo environment, set `HOST`, `APP_ORIGIN` to the exact HTTPS origin and `SECURE_COOKIES=1`. This SQLite build is intended for a single Node server and a writable disk.

## Tests and scope

`npm test` checks consent, duplicate saves, corrections, cross-session isolation, sign-out, request origin checks, and the voice adapter path with a stub provider. The planned Supabase migration, staff review, workplace matching and simulated referrals are later milestones. This build uses React/Vite and Node's built-in SQLite to run without cloud credentials.
