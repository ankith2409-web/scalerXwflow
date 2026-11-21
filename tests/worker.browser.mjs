import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { createApp } from '../server/index.mjs';
let audioPosted = false;
const server = createApp({ dbPath: ':memory:', speechKey: 'test-provider', speech: async ({ buffer }) => {
  assert.ok(buffer.length > 4);
  audioPosted = true;
  return 'Jaipur के पास';
} });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
let browser;
try {
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const mobile = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
  await mobile.grantPermissions(['microphone'], { origin });
  const page = await mobile.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByLabel('I agree to save').check();
  await page.getByLabel('Send my recorded').check();
  await page.getByRole('button', { name: 'Start a work history' }).click();
  await page.getByRole('button', { name: 'Record answer', exact: true }).click();
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor();
  // Give Chromium’s synthetic recording enough time to produce WebM frames.
  await page.waitForTimeout(450);
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await page.getByRole('status').getByText('Jaipur के पास', { exact: true }).waitFor();
  assert.ok(audioPosted);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 360);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Try a fictional answer' }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'I don’t remember' }).click();
  await page.getByRole('button', { name: 'Change Place' }).click();
  await page.getByLabel('Place', { exact: true }).fill('Near Jodhpur, Rajasthan');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Confirm and save' }).click();
  await page.getByRole('heading', { name: 'Your work history is saved' }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Saved histories' }).waitFor();
  await page.getByText('Before lockdown, for two monsoons', { exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Near Jodhpur, Rajasthan' }).waitFor();
  const cookies = await mobile.cookies();
  assert.equal(cookies.find(({ name }) => name === 'we_session')?.httpOnly, true);
  await page.getByRole('button', { name: 'Finish and sign out' }).click();
  await page.getByRole('heading', { name: 'Your work history' }).waitFor();
  await page.getByRole('link', { name: 'Saved histories' }).click();
  await page.getByText('No work histories saved yet.').waitFor();
  assert.deepEqual(errors, []);
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.goto(origin);
  await desktop.getByLabel('Language').selectOption('hi');
  await desktop.getByRole('heading', { name: 'आपके काम का रिकॉर्ड' }).waitFor();
  await desktop.reload();
  await desktop.getByRole('heading', { name: 'आपके काम का रिकॉर्ड' }).waitFor();
  console.log('Browser checks passed: mobile mic + stub transcript, correction, approximate dates, reload, sign-out, and Hindi desktop.');
} finally {
  await browser?.close();
  server.close();
}

