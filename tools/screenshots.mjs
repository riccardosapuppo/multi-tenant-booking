#!/usr/bin/env node
/**
 * The pictures in the README, taken from the running application.
 *
 *     npm run screenshots
 *
 * They are in the repository as a script rather than as six files somebody
 * cropped by hand, for the same reason the favicon is drawn and not exported:
 * a picture made once drifts from the thing it is a picture of, and a README
 * showing a screen that no longer exists is worse than a README with no
 * pictures. Re-run this after changing anything anybody can see.
 *
 * Playwright is used from wherever it is installed rather than added as a
 * dependency: this is a tool for whoever maintains the repository, not
 * something the application needs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BOOKING_URL || 'http://localhost:4200';
const here = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(here, '..', 'docs');

let chromium;
try {
  const require = createRequire(import.meta.url);
  ({ chromium } = require('playwright-core'));
} catch {
  console.error('playwright-core is not installed here, so the pictures cannot be retaken.');
  process.exit(2);
}

const WHO = {
  patient: ['patient@example.invalid', 'patient-demo-1234'],
  staff: ['staff@example.invalid', 'staff-demo-1234'],
  admin: ['admin@example.invalid', 'centre-admin-demo-1234'],
  platform: ['platform@example.invalid', 'platform-admin-demo-1234'],
};

fs.mkdirSync(DOCS, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });

/** Motion off and a retina scale: these are read at twice their size on GitHub. */
async function open(width, height) {
  return browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
}

async function enter(page, [email, password]) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.click('button[type=submit]', { force: true });
  await page.waitForURL((url) => !url.pathname.includes('sign-in'), { timeout: 20000 });
  await page.waitForTimeout(900);
}

async function leave(page) {
  await page.getByRole('button', { name: /sign out/i }).click({ force: true });
  await page.waitForURL((url) => url.pathname.includes('sign-in'), { timeout: 10000 });
}

function say(name) {
  console.log(`  docs/${name}`);
}

try {
  const page = await open(1280, 940);

  // ------------------------------------------------ the four headers, cropped
  //
  // One image each, of the bar alone. Side by side in the README they are the
  // shortest way to say what this project is about: the same application,
  // signed into by four people, is four different applications.
  for (const [name, who] of Object.entries(WHO)) {
    await enter(page, who);
    await page.locator('header.top').screenshot({ path: path.join(DOCS, `role-${name}.png`) });
    say(`role-${name}.png`);
    await leave(page);
  }

  // ------------------------------------------------------- the booking panels
  await enter(page, WHO.patient);
  await page.goto(`${BASE}/book`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  const boxes = page.locator('.list input[type=checkbox]');
  await boxes.nth(0).check();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(DOCS, 'booking-panels.png') });
  say('booking-panels.png');

  // ------------------------------------------------------- and the answer
  await page.click('button.search', { force: true });
  await page.waitForSelector('dialog[open]', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(DOCS, 'booking.png') });
  say('booking.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await leave(page);

  // ------------------------------------------------------------------ the desk
  await enter(page, WHO.staff);
  await page.goto(`${BASE}/desk`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(DOCS, 'desk.png') });
  say('desk.png');
  await leave(page);

  // ----------------------------------------------------------- the price list
  await enter(page, WHO.admin);
  await page.goto(`${BASE}/prices`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(DOCS, 'prices.png') });
  say('prices.png');
  await leave(page);

  // --------------------------------------------------------------- the console
  await enter(page, WHO.platform);
  await page.goto(`${BASE}/console`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(DOCS, 'centres.png') });
  say('centres.png');
  await leave(page);
  await page.close();

  // ------------------------------------------------------------------- a phone
  const phone = await open(390, 844);
  await enter(phone, WHO.patient);
  await phone.goto(`${BASE}/book`, { waitUntil: 'networkidle' });
  await phone.waitForTimeout(900);
  await phone.locator('.list input[type=checkbox]').first().check();
  await phone.waitForTimeout(400);
  await phone.screenshot({ path: path.join(DOCS, 'phone-book.png') });
  say('phone-book.png');

  await phone.click('button.search', { force: true });
  await phone.waitForSelector('dialog[open]', { timeout: 15000 });
  await phone.waitForTimeout(1200);
  await phone.screenshot({ path: path.join(DOCS, 'phone-results.png') });
  say('phone-results.png');
  await phone.close();

  console.log('\nThe pictures in the README are of the application as it is now.');
} catch (error) {
  console.error(`\nThe pictures could not be retaken: ${error.message.split('\n')[0]}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
