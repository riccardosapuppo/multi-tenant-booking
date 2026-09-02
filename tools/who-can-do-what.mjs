#!/usr/bin/env node
/**
 * Every account, against every claim the sign-in page makes about it.
 *
 *     npm run check:roles
 *     npm run check:roles -- --show      with a visible browser
 *
 * The sign-in page offers four demo accounts and says in one line what each of
 * them is for. Those lines are the first thing a reader believes and the last
 * thing anybody checks. One of them was false: it said the centre's
 * administrator "may change its price list", and `PATCH /desk/exams/:id`
 * existed, was guarded correctly and was covered by a passing test — with no
 * screen anywhere that called it. The claim was true of the system and false of
 * the interface, which is the only place a reader can act.
 *
 * So this walks each account through what it is promised AND through what it is
 * promised it cannot do, because half of what makes a permission worth showing
 * is the refusal. It also checks that the four look different: signing out and
 * back in as somebody else must visibly change the application, or the
 * demonstration is asserting an isolation it never shows.
 *
 * A guard is not a permission. Every refusal here is checked at the screen
 * because that is what a person meets; the API refuses on its own account and
 * `npm run walkthrough` is where that is proved.
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

/**
 * What the sign-in page says, and what that has to mean on screen.
 *
 * `lands` is where signing in puts them. `nav` is the navigation, exactly —
 * a set and not a subset, so a link that should not be there fails here.
 * `refused` are the addresses they must not reach by typing them.
 */
const ACCOUNTS = [
  {
    what: 'Patient',
    email: 'patient@example.invalid',
    password: 'patient-demo-1234',
    badge: 'Patient',
    lands: '/book',
    nav: ['Book', 'My bookings'],
    refused: [
      ['/desk', 'the desk'],
      ['/prices', 'the price list'],
      ['/console', 'the platform console'],
    ],
  },
  {
    what: 'Staff',
    email: 'staff@example.invalid',
    password: 'staff-demo-1234',
    badge: 'Staff',
    lands: '/desk',
    nav: ['Desk', 'Book for a patient'],
    refused: [
      ['/prices', 'the price list — staff read the desk, they do not set prices'],
      ['/console', 'the platform console'],
    ],
  },
  {
    what: 'Centre administrator',
    email: 'admin@example.invalid',
    password: 'centre-admin-demo-1234',
    badge: 'Centre administrator',
    lands: '/desk',
    nav: ['Desk', 'Price list', 'Book for a patient'],
    refused: [['/console', 'the platform console']],
  },
  {
    what: 'Platform administrator',
    email: 'platform@example.invalid',
    password: 'platform-admin-demo-1234',
    badge: 'Platform administrator',
    lands: '/console',
    nav: ['Centres'],
    refused: [
      ['/desk', 'a diary — the account that creates centres cannot read a booking'],
      ['/bookings', 'anybody’s bookings'],
      ['/book', 'the booking screen: they belong to no centre'],
    ],
  },
];

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

async function signIn(page, account) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', account.email);
  await page.fill('input[type=password]', account.password);
  await page.click('button[type=submit]', { force: true });
  // Waited for, not guessed at: scrypt is deliberately slow and the first
  // sign-in after a cold start takes over a second.
  await page.waitForURL((url) => !url.pathname.includes('sign-in'), { timeout: 20000 });
  await page.waitForTimeout(500);
}

async function signOut(page) {
  await page.getByRole('button', { name: /sign out/i }).click({ force: true });
  await page.waitForURL((url) => url.pathname.includes('sign-in'), { timeout: 10000 });
}

/** The colour of the rule under the header, which is how a role is shown. */
async function roleColour(page) {
  return page.evaluate(() => {
    const header = document.querySelector('.top');
    return header ? getComputedStyle(header).borderBottomColor : null;
  });
}

const browser = await chromium.launch({ channel: 'msedge', headless: !show });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });

const colours = new Map();

try {
  console.log(`Auditing ${BASE}: what each account is told it can do\n`);

  for (const account of ACCOUNTS) {
    console.log(account.what);

    await signIn(page, account);

    // ------------------------------------------------------------ where they land
    expect(
      `lands on ${account.lands}`,
      new URL(page.url()).pathname === account.lands,
      `landed on ${new URL(page.url()).pathname}`
    );

    // ------------------------------------------------------- what they are called
    const badge = (await page.locator('.badge').first().textContent())?.trim();
    expect(`is called “${account.badge}”`, badge === account.badge, `the badge says “${badge}”`);

    // ---------------------------------------------------------- the navigation
    const links = (await page.locator('nav a').allTextContents()).map((text) => text.trim());
    const same =
      links.length === account.nav.length && account.nav.every((label) => links.includes(label));
    expect(
      `is offered exactly: ${account.nav.join(', ')}`,
      same,
      `the navigation reads: ${links.join(', ') || '(nothing)'}`
    );

    // ------------------------------------------------------------- the refusals
    for (const [where, name] of account.refused) {
      await page.goto(`${BASE}${where}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      const landed = new URL(page.url()).pathname;
      expect(
        `cannot reach ${name} by typing ${where}`,
        landed !== where,
        `${where} stayed open`
      );
    }

    colours.set(account.what, await roleColour(page));
    await signOut(page);
    console.log('');
  }

  // ------------------------------------------------- the one power that was a lie
  console.log('The claim that was false: the administrator changes the price list');

  await signIn(page, ACCOUNTS[2]);
  await page.goto(`${BASE}/prices`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const first = page.locator('table.prices tbody tr').first();
  expect('the price list opens with the centre’s exams on it', (await first.count()) > 0);

  const code = await first.locator('[data-price-for]').getAttribute('data-price-for');
  const box = page.locator(`[data-price-for="${code}"]`);
  const before = Number(await box.inputValue());
  const after = Number((before + 3).toFixed(2));

  await box.fill(String(after));
  await page.locator(`[data-save-for="${code}"]`).click({ force: true });
  await page.waitForTimeout(1200);

  // Read back from the server, not from the box that was just typed into: the
  // question is whether the centre's price list changed, not whether an input
  // holds what was put in it.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const saved = Number(await page.locator(`[data-price-for="${code}"]`).inputValue());
  expect(`${code} is now €${after.toFixed(2)} and stayed that way`, saved === after, `it reads €${saved}`);

  // Put it back, so running this twice does not walk the price up the list.
  await page.locator(`[data-price-for="${code}"]`).fill(String(before));
  await page.locator(`[data-save-for="${code}"]`).click({ force: true });
  await page.waitForTimeout(1000);

  await signOut(page);

  // --------------------------------------------- and they have to LOOK different
  console.log('\nAnd they do not look like the same account');

  const seen = [...colours.values()].filter(Boolean);
  expect(
    'each role gives the header its own colour',
    new Set(seen).size === ACCOUNTS.length,
    [...colours.entries()].map(([who, colour]) => `${who}: ${colour}`).join('; ')
  );

  console.log('');
  if (failures > 0) {
    console.log(`${failures} checks failed.`);
    process.exitCode = 1;
  } else {
    console.log('Every account can do what it is told it can, and nothing more.');
  }
} catch (error) {
  console.error(`\nThe audit stopped: ${error.message.split('\n')[0]}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
