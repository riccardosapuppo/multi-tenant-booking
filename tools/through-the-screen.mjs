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
import { howToLaunch } from './lib/browser.mjs';

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
  // The centre is chosen from the name in the header rather than from a
  // separate control in the corner: on a platform serving several of them, the
  // one you are in is the identity. It is still a real <select>, laid over the
  // name, which is why this still works by value.
  await page.selectOption('.switchable select', { value: slug });
  await page.waitForTimeout(700);
}

const browser = await chromium.launch(howToLaunch({ headless: !show }));
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
  await page.waitForTimeout(900);

  // Picking a time no longer books it, and this is where that is proved.
  // Both halves matter: that the confirmation appears, and that nothing has
  // been booked while it is on screen. Checking only the first would pass just
  // as well on a version that books and then shows a receipt.
  const confirming = page.locator('app-confirm dialog[open]');
  expect('picking a time asks before it books', (await confirming.count()) === 1);
  expect('and nothing is booked while it asks', (await page.locator('.done .ref').count()) === 0);

  // Out of the confirmation without booking, and back to what it came from.
  // It used to close and stop there, leaving somebody looking at the form they
  // filled in a minute earlier while the times they were choosing between sat
  // loaded and off screen.
  await confirming.getByRole('button', { name: 'Pick another time' }).click({ force: true });
  await page.waitForTimeout(900);
  expect(
    'pick another time goes back to the times',
    (await page.locator('app-results dialog[open] .times button').count()) > 0 &&
      (await page.locator('app-confirm dialog[open]').count()) === 0
  );

  await page.locator('.times button').first().click({ force: true });
  await page.waitForTimeout(800);

  await confirming.getByRole('button', { name: 'Confirm booking' }).click({ force: true });
  await page.waitForTimeout(1800);

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
    expect('with the patient’s name', /Sam Okonjo/.test(text), text.trim());
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

  // ----------------------------------------------------------------------
  // Asked before something that cannot be taken back.
  //
  // Cancelling was one click. A cancelled appointment is a time handed back to
  // whoever asks next, and there is no button that returns it -- so it is the
  // kind of thing to be asked about, and the question names what it is about
  // rather than saying "are you sure" over a row that is now behind a backdrop.
  console.log('\nBefore something that cannot be undone');

  // Back to the centre the booking is at: the section above left the desk
  // looking at the other one, on purpose.
  await switchCentre(page, 'northgate');
  await page.waitForTimeout(1200);

  const before = await page.locator('tbody tr').count();
  await page.locator('tr', { hasText: reference }).getByRole('button', { name: 'Cancel' }).click({ force: true });
  await page.waitForTimeout(700);

  const asking = page.locator('app-are-you-sure dialog[open]');
  expect('cancelling asks first', (await asking.count()) === 1);
  expect(
    'and the question names the appointment it is about',
    ((await asking.textContent()) ?? '').includes(reference)
  );
  expect(
    'and the safe answer is not the one that does it',
    (await asking.getByRole('button', { name: 'Keep it' }).count()) === 1
  );

  await asking.getByRole('button', { name: 'Keep it' }).click({ force: true });
  await page.waitForTimeout(700);
  expect('keeping it keeps it', (await page.locator('tbody tr').count()) === before);

  await page.locator('tr', { hasText: reference }).getByRole('button', { name: 'Cancel' }).click({ force: true });
  await page.waitForTimeout(700);
  await asking.getByRole('button', { name: 'Cancel the appointment' }).click({ force: true });
  await page.waitForTimeout(1600);
  expect(
    'and agreeing to it does it',
    (await page.locator('tr', { hasText: reference }).count()) === 0
  );

  // ----------------------------------------------------------------------
  // Finding a booking without knowing which day it is on.
  //
  // The desk shows one day, and said nothing about being one day, so a booking
  // made for next Thursday looked like a booking that was never made. That is
  // the other question a desk is asked all day: somebody rings and says a
  // reference, or a surname.
  console.log('\nFinding a booking from the desk');

  await page.goto(`${BASE}/desk`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  expect(
    'the desk says what it is showing',
    ((await page.locator('.lede').textContent()) ?? '').includes('on one day')
  );

  await page.locator('input[placeholder*="reference"]').fill('Egerton');
  await page.getByRole('button', { name: 'Find', exact: true }).click({ force: true });
  await page.waitForTimeout(1600);

  const hits = await page.getByRole('button', { name: 'Open that day' }).count();
  expect('a patient name finds their appointments on any day', hits > 0, String(hits));

  await page.getByRole('button', { name: 'Open that day' }).first().click({ force: true });
  await page.waitForTimeout(1600);
  expect(
    'and opening it shows that day in the diary',
    ((await page.locator('tbody').first().textContent()) ?? '').includes('Egerton')
  );

  // A reference is matched whole; a fragment of one belongs to nobody.
  await page.locator('input[placeholder*="reference"]').fill('zzzz');
  await page.getByRole('button', { name: 'Find', exact: true }).click({ force: true });
  await page.waitForTimeout(1400);
  expect(
    'and nothing matching says so rather than showing the day underneath',
    ((await page.locator('.card').first().textContent()) ?? '').includes('Nothing here matches')
  );


  // ----------------------------------------------------------------------
  // A visitor with no account, which is the journey most people actually make.
  //
  // Worth driving end to end rather than asserting in pieces: every step of it
  // is a place the choice can be dropped, and one of them did drop it -- the
  // dialog fires `close` however it closes, so leaving to register threw away
  // the slot that leaving to register exists to carry. The registration page
  // showed no appointment and nothing else complained.
  console.log('\nSomebody with no account books');

  await signOut(page);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(`${BASE}/book`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  expect('a visitor is asked which centre, not for a password', (await page.locator('.choices button').count()) > 0);
  // By name, not by position. `.first()` was whichever centre sorted first,
  // which changed the moment a third one was in the list -- and the one it
  // landed on has nothing bookable online, so the next step failed for a
  // reason that had nothing to do with what it was checking.
  await page.locator('.choices button', { hasText: 'Northgate' }).click();
  await page.waitForTimeout(1400);

  expect('and then sees the exams without signing in', (await page.locator('label', { hasText: 'MRI knee' }).count()) > 0);
  await page.locator('label', { hasText: 'MRI knee' }).first().click();
  await page.locator('button.search').click({ force: true });
  await page.waitForTimeout(3000);
  await page.locator('.times button').first().click({ force: true });
  await page.waitForTimeout(900);

  const asked = page.locator('app-confirm dialog[open]');
  expect('picking a time asks who they are', (await asked.count()) === 1);
  expect(
    'and says so in those words',
    ((await asked.locator('.who h2').textContent()) ?? '').includes('needs a name')
  );
  // Said before the click, not after it. Somebody trying this has no account
  // and no reason to invent one; without the line the two buttons are a wall.
  expect(
    'and says the accounts are furnished, before asking them to choose',
    ((await asked.textContent()) ?? '').includes('ready-made')
  );

  await asked.getByRole('button', { name: 'Create an account' }).click({ force: true });
  await page.waitForTimeout(1300);

  expect('the registration page keeps the appointment', (await page.locator('.held').count()) === 1);
  await page.getByRole('button', { name: 'Fill in invented details' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Create account/ }).click({ force: true });
  await page.waitForTimeout(3500);

  const back = page.locator('app-confirm dialog[open]');
  expect('and afterwards the same appointment is waiting', (await back.count()) === 1);
  await back.getByRole('button', { name: 'Confirm booking' }).click({ force: true });
  await page.waitForTimeout(2000);

  const theirs = (await page.locator('.done .ref').textContent())?.trim() ?? '';
  expect('booked, in the name they registered with', /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(theirs), theirs);

  // ----------------------------------------------------------------------
  // Registering without having chosen a centre first.
  //
  // The header offers "Create account" to anybody, including somebody who has
  // just arrived and picked nothing. An account starts as a patient somewhere,
  // so the form had nowhere to put them: it posted, the API answered
  // "no centre given", and that landed in the page as the error -- true, and
  // not an answer. Found by using it, which is the only way this one could
  // have been found.
  console.log('\nRegistering before choosing anything');

  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  expect('the form asks which centre before it asks anything else', (await page.locator('.pick-centre').count()) === 1);
  expect('and shows no form until it knows', (await page.locator('.form').count()) === 0);

  await page.locator('.choices button', { hasText: 'Northgate' }).click();
  await page.waitForTimeout(700);
  expect('then the form', (await page.locator('.form').count()) === 1);

  await page.getByRole('button', { name: 'Fill in invented details' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Create account/ }).click({ force: true });
  await page.waitForTimeout(3000);

  expect('and the account is made, not refused', (await page.locator('.problem').count()) === 0);

  // ----------------------------------------------------------------------
  // Signing in from the middle of a booking, as somebody who is not a patient.
  //
  // Signing in sends each role to its own work, which is most of what makes
  // four accounts look like four applications. It is the wrong rule exactly
  // once: somebody who picked a time as a visitor and pressed "I already have
  // one" came to finish that. Staff were sent to the desk with the appointment
  // abandoned behind them -- and the desk case is the good one, because staff
  // booking for the person in front of them is what the confirmation asks for.
  console.log('\nSigning in halfway through a booking');

  async function pickATimeAsAVisitor() {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto(`${BASE}/book`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.locator('.choices button', { hasText: 'Northgate' }).click();
    await page.waitForTimeout(1400);
    await page.locator('label', { hasText: 'MRI knee' }).first().click();
    await page.locator('button.search').click({ force: true });
    await page.waitForTimeout(3000);
    await page.locator('.times button').first().click({ force: true });
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'I already have one' }).click({ force: true });
    await page.waitForTimeout(1100);
  }

  async function signInAs(what) {
    await page.locator('.spread', { hasText: what }).first().getByRole('button', { name: 'Use' }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /^Sign in$/ }).click({ force: true });
    await page.waitForTimeout(2800);
  }

  // Empty first: the component renders nothing without a held time, and an
  // empty component is still a grid item unless it is told otherwise. The
  // sign-in page kept a column for it, and everything else shuffled sideways
  // into what was left.
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  expect('with nothing held there is nothing to show', (await page.locator('.held').count()) === 0);

  // And with nothing held there is still a way back. Signing in and registering
  // were rooms with one door: the way back only appeared when an appointment
  // was waiting, so somebody who pressed Sign in from the header had the
  // browser's back button and nothing else.
  expect('a visitor can reach the booking screen from the header', (await page.getByRole('link', { name: 'Book', exact: true }).count()) === 1);
  await page.getByRole('link', { name: 'Book', exact: true }).click();
  await page.waitForTimeout(1200);
  expect('and it goes there', new URL(page.url()).pathname === '/book');

  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.locator('a.mark').click();
  await page.waitForTimeout(1200);
  expect('and so does the mark, which is where a mark goes', new URL(page.url()).pathname === '/book');

  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  expect(
    'and the empty component takes no room in the layout',
    (await page.locator('app-held').evaluate((el) => getComputedStyle(el).display)) === 'contents'
  );

  await pickATimeAsAVisitor();
  // And when there is nothing interrupted, it takes no room.
  //
  // The component renders nothing without a held time, but an empty component
  // is still a grid item: the sign-in page kept a column for it and everything
  // else shuffled sideways into what was left. Counting the cards is how that
  // is visible to a check at all.
  //
  // The interruption shows what it interrupted, and offers the way back.
  // From the sign-in page the only ways out were to finish signing in or to
  // leave: the held time was invisible and there was nothing to press.
  expect('the sign-in page shows the appointment it interrupted', (await page.locator('.held').count()) === 1);
  expect(
    'and says when, in words rather than a timestamp',
    !/\d{4}-\d{2}-\d{2}T/.test((await page.locator('.held-when').textContent()) ?? ''),
    (await page.locator('.held-when').textContent()) ?? ''
  );

  await page.getByRole('link', { name: 'Back to the appointment' }).click();
  await page.waitForTimeout(1600);
  expect(
    'and going back reopens it, without an account',
    new URL(page.url()).pathname === '/book' &&
      (await page.locator('app-confirm dialog[open]').count()) === 1
  );

  await page.getByRole('button', { name: 'I already have one' }).click({ force: true });
  await page.waitForTimeout(1100);
  await signInAs('Staff');
  expect(
    'staff come back to the appointment rather than to the desk',
    new URL(page.url()).pathname === '/book' &&
      (await page.locator('app-confirm dialog[open]').count()) === 1
  );
  expect(
    'and are asked whose appointment it is',
    ((await page.locator('app-confirm dialog[open] .who h2').textContent()) ?? '').includes(
      'Who is this for'
    )
  );

  // Escape first: a <dialog> opened with showModal() makes the rest of the page
  // inert, so the sign-out button in the header never receives the click --
  // `force: true` dispatches it and the browser is right to ignore it.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await signOut(page);

  await pickATimeAsAVisitor();
  // Warned on the row, before the account is chosen rather than after.
  expect(
    'the sign-in page marks the account that cannot finish it',
    (await page.locator('.cannot-finish').count()) === 1
  );
  await signInAs('Platform administrator');
  // The one account that cannot finish a booking, and what it is told.
  //
  // It used to be told nothing: the appointment was dropped and the console
  // opened, so signing in with the wrong account cost somebody their 11:00 on
  // Tuesday and never mentioned it. The appointment is kept now -- signing out
  // gives it back -- and both ends of the journey say why this one cannot
  // finish it, which is the permission boundary this project is about.
  expect(
    'whoever runs the platform goes to the console, not to a booking they cannot make',
    new URL(page.url()).pathname === '/console' &&
      (await page.locator('app-confirm dialog[open]').count()) === 0
  );
  expect('and the appointment is kept, not thrown away', (await page.locator('.held').count()) === 1);
  expect(
    'and the console says why this account cannot finish it',
    ((await page.locator('.held-note.cannot').textContent()) ?? '').includes('no role there')
  );
  await signOut(page);

  // ----------------------------------------------------------------------
  // One exam and several are the same refusal and two different sentences.
  //
  // The engine answers `no_room_does_all` whether you asked for one thing or
  // three, and the screen said "these cannot be done in one visit here" to
  // both -- which about a single exam is nonsense. Nobody had seen it because
  // every site in the demonstration used to have more than one machine in it.
  console.log('\nAsking for something a building cannot do');

  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('booking.centre', 'northgate');
  });
  await page.goto(`${BASE}/book`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);

  await page.locator('.panel .head').first().click();
  await page.waitForTimeout(400);
  await page.locator('label', { hasText: 'Northgate Point' }).click();
  await page.waitForTimeout(500);
  await page.getByText('Choose an exam').click();
  await page.waitForTimeout(400);

  // While the list is open, and only while it is open: the exam this centre
  // does and will not book online. It is in the list rather than filtered out
  // of it -- hiding it told somebody looking for a CT with contrast that the
  // centre does not do it, which is the wrong thing to be wrong about.
  const phoneOnly = page.locator('.choice.by-phone').first();
  expect('an exam that is not bookable online is still in the list', (await phoneOnly.count()) === 1);
  expect('and cannot be chosen', await phoneOnly.locator('input[type=checkbox]').isDisabled());
  expect(
    'and says what to do instead',
    ((await phoneOnly.textContent()) ?? '').includes('Ring the centre')
  );

  await page.locator('label', { hasText: 'MRI knee' }).first().click();
  await page.waitForTimeout(300);
  await page.locator('button.search').click({ force: true });
  await page.waitForTimeout(2500);

  const refused = (await page.locator('dialog[open] .big').textContent()) ?? '';
  expect('one exam is refused in the singular', !/these|all of them/i.test(refused), refused.trim());
  expect(
    'and says where the machine is',
    ((await page.locator('dialog[open] .why').textContent()) ?? '').includes('another building')
  );

  // ----------------------------------------------------------------------
  // The centre you were looking at yesterday, which is not there today.
  //
  // Which centre you are in is remembered in the browser, and a centre is a
  // row: the console can suspend it or delete it while somebody has it open.
  // Coming back to one of those left the screen saying it could not read the
  // list of exams -- true, unhelpful, and no way out unless you already knew
  // the name in the header is a switcher.
  console.log('\nComing back to a centre that has gone');

  for (const [slug, what] of [
    ['lakeside', 'suspended'],
    ['no-such-centre-here', 'deleted'],
  ]) {
    await page.evaluate((held) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('booking.centre', held);
    }, slug);
    await page.goto(`${BASE}/book`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    expect(
      `a ${what} centre asks the question again instead of failing`,
      (await page.locator('.pick-centre').count()) === 1
    );
    expect(
      `and says why it is asking (${what})`,
      ((await page.locator('.pick-centre p').first().textContent()) ?? '').includes(
        'centre you were looking at'
      )
    );
  }

  // ----------------------------------------------------------------------
  // The account's own details.
  //
  // A booking system where the name on your appointments cannot be corrected
  // is a booking system with a spelling mistake in it forever.
  console.log('\nChanging your own details');

  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await signInAs('Patient');

  await page.locator('a.name').click();
  await page.waitForTimeout(1200);
  expect('the name in the header leads to your details', new URL(page.url()).pathname === '/profile');
  expect(
    'the email is shown and is not a field',
    (await page.locator('.fixed output').count()) === 1 &&
      (await page.locator('input[name=email]').count()) === 0
  );

  const wasCalled = await page.locator('input[name=name]').inputValue();
  await page.locator('input[name=name]').fill(`${wasCalled} (edited)`);
  await page.getByRole('button', { name: /Save details/ }).click({ force: true });
  await page.waitForTimeout(1800);
  expect(
    'saving says so and the header follows at once',
    (await page.locator('.done').count()) === 1 &&
      (await page.locator('a.name').textContent())?.includes('(edited)')
  );

  // Put it back, so the rest of the demonstration is the demonstration.
  await page.locator('input[name=name]').fill(wasCalled);
  await page.getByRole('button', { name: /Save details/ }).click({ force: true });
  await page.waitForTimeout(1500);

  await page.locator('input[name=current]').fill('not-the-password');
  await page.locator('input[name=wanted]').fill('long-enough-1234');
  await page.getByRole('button', { name: /Change password/ }).click({ force: true });
  await page.waitForTimeout(1800);
  expect(
    'the wrong current password is refused, and says which one was wrong',
    ((await page.locator('.problem').textContent()) ?? '').includes('current password')
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
