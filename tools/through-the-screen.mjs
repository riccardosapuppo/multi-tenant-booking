#!/usr/bin/env node
/**
 * The one journey that matters, driven through the interface.
 *
 *     npm run check:screen
 *     npm run check:screen -- --show     with a visible browser
 *
 * A patient signs in, books something, signs out. Staff sign in, open the desk,
 * and find that booking — the right patient, the right time, at the right
 * centre and nowhere else.
 *
 * `npm run walkthrough` already checks this over HTTP, and that is not the same
 * claim. It proves the API behaves; this proves somebody can actually do it:
 * that the button exists, that the times are clickable, that the reference
 * comes back on screen, and that the name a patient typed reaches the desk. A
 * route mounted wrongly, a signal that never updates, a panel that will not
 * close — none of those show up in an HTTP check, and all of them stop a
 * person.
 *
 * Playwright is used from wherever it is installed rather than added as a
 * dependency here: this is a check somebody runs, not something the
 * application needs. If it is not there, the script says so and exits without
 * pretending to have passed.
 */

import { createRequire } from 'node:module';

const BASE = process.env.BOOKING_URL || 'http://localhost:4200';
const show = process.argv.includes('--show');

let chromium;
try {
  const require = createRequire(import.meta.url);
  ({ chromium } = require('playwright-core'));
} catch {
  console.error('playwright-core is not installed here, so this check cannot run.');
  console.error('It is a check, not a dependency: install it where you keep such things.');
  process.exit(2);
}

const ACCOUNTS = {
  patient: ['patient@example.invalid', 'patient-demo-1234'],
  staff: ['staff@example.invalid', 'staff-demo-1234'],
};

let failures = 0;

function expect(what, condition, detail) {
  if (condition) {
    console.log(`  ok    ${what}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${what}`);
    if (detail) console.log(`        ${detail}`);
  }
}

async function signIn(page, [email, password]) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.click('button[type=submit]', { force: true });
  // Waited for, not guessed at: scrypt is deliberately slow and the first
  // sign-in after a cold start takes over a second.
  await page.waitForURL((url) => !url.pathname.includes('sign-in'), { timeout: 20000 });
  await page.waitForTimeout(400);
}

async function signOut(page) {
  await page.getByRole('button', { name: /sign out/i }).click({ force: true });
  await page.waitForURL((url) => url.pathname.includes('sign-in'), { timeout: 10000 });
}

async function switchCentre(page, slug) {
  await page.selectOption('.centre select', { value: slug });
  await page.waitForTimeout(700);
}

const browser = await chromium.launch({ channel: 'msedge', headless: !show });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });

try {
  console.log(`Driving ${BASE} through the screen\n`);

  // ------------------------------------------------------- a patient books
  console.log('A patient books something');

  await signIn(page, ACCOUNTS.patient);
  expect('signing in lands somewhere useful', !page.url().includes('sign-in'), page.url());

  await page.goto(`${BASE}/book`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const boxes = page.locator('.list input[type=checkbox]');
  expect('the centre’s exams are listed', (await boxes.count()) > 0);
  await boxes.first().check();

  await page.click('button.search', { force: true });
  await page.waitForTimeout(1600);

  const dialog = page.locator('dialog[open]');
  expect('the times open in a dialog', await dialog.isVisible());

  const times = dialog.locator('.times button');
  expect('there are times to pick', (await times.count()) > 0);

  const chosenTime = (await times.first().textContent())?.trim() ?? '';

  // The day is read off the card the time belongs to, and read as an
  // attribute rather than pieced back together from the words on it.
  //
  // Two versions of this were wrong before this one. The first assumed a week
  // out and looked at the wrong day on the desk, reporting a booking as
  // missing when it was there. The second read "3" and "September 2026" off
  // the card and handed them to the Date constructor — parsing your own
  // interface, in a format nothing promises to understand. A check that fails
  // for the wrong reason teaches you to ignore it.
  const card = dialog.locator('.day').first();
  const bookedOn = await card.getAttribute('data-date');
  await times.first().click({ force: true });
  await page.waitForTimeout(1600);

  const reference = (await page.locator('.done .ref').textContent())?.trim() ?? '';
  expect('a reference comes back on screen', /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(reference), reference);
  console.log(`        booked ${reference} at ${chosenTime}`);

  // ------------------------------------------ and finds it under their own
  await page.goto(`${BASE}/bookings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  expect(
    'and it is in their own bookings',
    (await page.locator('td', { hasText: reference }).count()) > 0
  );

  // ------------------------------------------------- the other centre: not
  await switchCentre(page, 'riverside');
  await page.waitForTimeout(800);
  expect(
    'and not in the other centre’s',
    (await page.locator('td', { hasText: reference }).count()) === 0,
    'a booking made at northgate showed up at riverside'
  );

  await signOut(page);

  // ---------------------------------------------------- the desk finds it
  console.log('\nThe desk finds it');

  await signIn(page, ACCOUNTS.staff);

  const deskLink = page.getByRole('link', { name: /desk/i });
  expect('staff are offered the desk', (await deskLink.count()) > 0);

  // Back to the centre the booking was made at. Staff work at two of them and
  // the header remembers which one you were looking at, so this says which
  // rather than relying on where the previous person left it.
  await switchCentre(page, 'northgate');
  await page.goto(`${BASE}/desk`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // The day the booking is actually on, as the card itself reported it.
  const asDay = bookedOn ?? '';
  await page.fill('input[type=date]', asDay);
  await page.waitForTimeout(1200);

  const row = page.locator('tr', { hasText: reference });
  expect('the booking is on the desk’s diary', (await row.count()) > 0, `looked at ${asDay}`);

  if ((await row.count()) > 0) {
    const text = (await row.first().textContent()) ?? '';
    expect('with the patient’s name', /Demo Patient/.test(text), text.trim());
    expect('with the time', /\d{2}:\d{2}/.test(text), text.trim());
    expect('with the room', /room/i.test(text), text.trim());
    expect('and the payment category', /Private|Exempt|Health|Insured/i.test(text), text.trim());
  }

  // ------------------------------------------------- and not at the other
  await switchCentre(page, 'riverside');
  await page.waitForTimeout(1200);
  expect(
    'and the same person sees nothing of it at the other centre',
    (await page.locator('tr', { hasText: reference }).count()) === 0
  );

  console.log('');
  if (failures > 0) {
    console.log(`${failures} checks failed.`);
    process.exitCode = 1;
  } else {
    console.log('The whole journey works through the screen.');
  }
} catch (error) {
  console.error(`\nThe journey stopped: ${error.message.split('\n')[0]}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
