#!/usr/bin/env node
/**
 * Drives the running platform through the whole story, over HTTP, and says
 * what happened.
 *
 *     npm run walkthrough
 *     npm run walkthrough -- http://localhost:3000
 *
 * This is not the test suite. The suite calls the code directly and was
 * written alongside it, which makes it good at saying the code still does what
 * it did and blind to everything that only shows up through the front door:
 * a route mounted in the wrong place, a permission check on a router that
 * never runs, a status code that is right in a unit test and wrong in Express.
 * That mistake — checking only through the same door the code was written
 * behind — has been made repeatedly on this portfolio, and this is the answer
 * to it here.
 *
 * Every step states what should happen before it tries, so a failure reads as
 * a sentence rather than as a diff. Nothing is written anywhere but the
 * demonstration's own database, and the centre it creates it also removes.
 */

const BASE = process.argv[2] || process.env.BOOKING_URL || 'http://localhost:3000';

const PASSWORD = {
  patient: 'patient-demo-1234',
  staff: 'staff-demo-1234',
  platform: 'platform-admin-demo-1234',
};

let failures = 0;
let checks = 0;

function ok(what) {
  checks += 1;
  console.log(`  ok    ${what}`);
}

function bad(what, detail) {
  checks += 1;
  failures += 1;
  console.log(`  FAIL  ${what}`);
  if (detail) console.log(`        ${detail}`);
}

function expect(what, condition, detail) {
  if (condition) ok(what);
  else bad(what, detail);
}

async function call(path, { method = 'GET', token, centre, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (centre) headers['x-centre'] = centre;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  return { status: response.status, body: payload, centre: response.headers.get('x-centre') };
}

async function signIn(email, password) {
  const answer = await call('/api/auth/session', {
    method: 'POST',
    body: { email, password },
  });
  if (answer.status !== 201) throw new Error(`could not sign in as ${email}: ${answer.status}`);
  return answer.body;
}

async function waitForApi() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const answer = await call('/api/health');
      if (answer.status === 200) return answer.body;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`nothing answering at ${BASE}. Is it running?`);
}

async function main() {
  console.log(`Walking through ${BASE}\n`);

  const health = await waitForApi();
  console.log(`The platform has ${health.centres} centres.\n`);

  // ------------------------------------------------------------- the front door
  console.log('Somebody typed the API port into a browser');

  // Two right answers here, depending on which door this is pointed at. On the
  // API's own port the root is JSON that says where the interface is; through
  // the web container it is the interface itself, because nginx serves the
  // application for everything that is not /api. Checking only for the first
  // fails against the address the README tells people to open.
  const servedByWeb = (answer) =>
    typeof answer.body === 'string' && answer.body.toLowerCase().includes('<!doctype html');

  const front = await call('/');
  expect(
    'the root is either the interface or a JSON note saying where it is',
    front.status === 200 &&
      (servedByWeb(front) || typeof front.body?.the_interface_is_at === 'string'),
    `got ${front.status} — the API root used to be a bare "no such endpoint", which reads like a fault`
  );

  const missing = await call('/nothing-here');
  expect(
    'and a path that is neither says where the API starts',
    servedByWeb(missing) || (missing.status === 404 && missing.body?.the_api_starts_at === '/api'),
    `got ${missing.status}`
  );

  // ---------------------------------------------------------------- resolving
  console.log('\nWhich centre is this request for');

  const unknown = await call('/api/centre/exams', { centre: 'nowhere-at-all' });
  expect('an unknown centre is 404', unknown.status === 404, `got ${unknown.status}`);

  const suspended = await call('/api/centre/exams', { centre: 'lakeside' });
  expect(
    'a suspended centre is 403, not 404',
    suspended.status === 403,
    `got ${suspended.status} — a platform that answers the same for both lets you enumerate its centres`
  );

  const nameless = await call('/api/centre/exams');
  expect('no centre at all is 400', nameless.status === 400, `got ${nameless.status}`);

  const conflicting = await call('/api/centre/exams?centre=riverside', { centre: 'northgate' });
  expect(
    'two centres at once is refused rather than resolved',
    conflicting.status === 400,
    `got ${conflicting.status} — picking one silently is how a booking lands in the wrong diary`
  );

  // ------------------------------------------------------------------ centres
  console.log('\nEach centre answers for itself');

  const north = await call('/api/centre/exams', { centre: 'northgate' });
  const river = await call('/api/centre/exams', { centre: 'riverside' });

  expect('northgate has a price list', north.status === 200 && north.body.exams.length > 0);
  expect('riverside has one too', river.status === 200 && river.body.exams.length > 0);
  expect('the reply says which centre answered', north.centre === 'northgate');

  const northKnee = north.body.exams.find((exam) => exam.code === 'MR-KNEE');
  const riverKnee = river.body.exams.find((exam) => exam.code === 'MR-KNEE');
  expect(
    'the same exam is priced differently at each',
    northKnee && riverKnee && northKnee.price_cents !== riverKnee.price_cents,
    `${northKnee?.price_cents} against ${riverKnee?.price_cents}`
  );

  // ------------------------------------------------------------------ searching
  console.log('\nThe search a person actually makes');

  const twoMri = north.body.exams.filter((exam) => exam.modality === 'MR').slice(0, 2);
  const together = await call('/api/centre/search', {
    method: 'POST',
    centre: 'northgate',
    body: { examIds: twoMri.map((exam) => exam.id), category: 'private', part: 'any' },
  });

  expect(
    'two exams in one visit come back as one appointment',
    together.status === 200 && together.body.ok && together.body.days.length > 0,
    JSON.stringify(together.body).slice(0, 200)
  );
  expect(
    'and the duration and price are the sum of both',
    together.body.minutes === twoMri[0].minutes + twoMri[1].minutes &&
      together.body.priceCents === twoMri[0].price_cents + twoMri[1].price_cents,
    `${together.body.minutes} minutes, ${together.body.priceCents} cents`
  );
  expect(
    'the answer is days, each with its own times',
    together.body.days.every((day) => day.date && Array.isArray(day.times) && day.times.length > 0)
  );

  // The label and the contents have to be the same day. They were not: the
  // date was formatted with toISOString on a local midnight, so in a container
  // at +2 every day came back labelled with the one before — "Sunday 6" above
  // a list of Monday's appointments, which is somebody arriving on the wrong
  // day. Checked here because it is invisible in any test that does not
  // compare the two.
  const mislabelled = together.body.days.filter((day) => {
    const label = new Date(`${day.date}T00:00:00`).getDay();
    return day.times.some((time) => new Date(time).getDay() !== label);
  });

  expect(
    'and each day is labelled with the day its times are on',
    mislabelled.length === 0,
    mislabelled.map((day) => `${day.date} holds ${new Date(day.times[0]).toDateString()}`).join('; ')
  );

  const mri = north.body.exams.find((exam) => exam.modality === 'MR');
  const xray = north.body.exams.find((exam) => exam.modality === 'XR');
  const impossible = await call('/api/centre/search', {
    method: 'POST',
    centre: 'northgate',
    body: { examIds: [mri.id, xray.id], category: 'private' },
  });

  expect(
    'exams no single room can do are refused with a reason, not an empty list',
    impossible.status === 200 && impossible.body.ok === false && impossible.body.reason === 'no_room_does_all',
    JSON.stringify(impossible.body).slice(0, 160)
  );

  const mornings = await call('/api/centre/search', {
    method: 'POST',
    centre: 'northgate',
    body: { examIds: [xray.id], category: 'private', part: 'morning' },
  });

  expect(
    'asking for mornings gives mornings',
    mornings.body.ok &&
      mornings.body.days.every((day) => day.times.every((time) => new Date(time).getHours() < 13)),
    'an afternoon slipped into a morning search'
  );

  // ------------------------------------------------------------------ booking
  console.log('\nA patient books');

  const patient = await signIn('patient@example.invalid', PASSWORD.patient);
  expect('the patient signs in once, for every centre', patient.centres.length >= 2);

  const rooms = await call(`/api/centre/exams/${northKnee.id}/rooms`, { centre: 'northgate' });
  expect('the exam has a room', rooms.status === 200 && rooms.body.rooms.length > 0);
  const room = rooms.body.rooms[0];

  const day = new Date();
  day.setDate(day.getDate() + 7);
  const when = day.toISOString().slice(0, 10);

  const free = await call(
    `/api/centre/availability?room=${room.id}&exam=${northKnee.id}&category=private&day=${when}`,
    { centre: 'northgate' }
  );
  expect('there are times free', free.status === 200 && free.body.times.length > 0, `got ${free.status}`);

  const booked = await call('/api/centre/bookings', {
    method: 'POST',
    centre: 'northgate',
    token: patient.token,
    body: {
      roomId: room.id,
      startsAt: free.body.times[0],
      examIds: [northKnee.id],
      patientName: 'Demo Patient',
      category: 'private',
    },
  });
  expect('the booking is made', booked.status === 201, JSON.stringify(booked.body));

  const twice = await call('/api/centre/bookings', {
    method: 'POST',
    centre: 'northgate',
    token: patient.token,
    body: {
      roomId: room.id,
      startsAt: free.body.times[0],
      examIds: [northKnee.id],
      category: 'private',
    },
  });
  expect('the same time cannot be taken twice', twice.status === 409, `got ${twice.status}`);

  const again = await call(
    `/api/centre/availability?room=${room.id}&exam=${northKnee.id}&category=private&day=${when}`,
    { centre: 'northgate' }
  );
  expect(
    'and it is no longer offered',
    !again.body.times.includes(free.body.times[0]),
    'the diary still offers a time that has been taken'
  );

  // ---------------------------------------------------------------- isolation
  console.log('\nOne centre cannot see another');

  const mineNorth = await call('/api/centre/bookings/mine', {
    centre: 'northgate',
    token: patient.token,
  });
  const mineRiver = await call('/api/centre/bookings/mine', {
    centre: 'riverside',
    token: patient.token,
  });

  const reference = booked.body.booking.reference;
  const atNorth = mineNorth.body.bookings.some((one) => one.reference === reference);
  const atRiver = mineRiver.body.bookings.some((one) => one.reference === reference);

  expect('the booking is at northgate', atNorth);
  expect(
    'and the same person sees nothing of it at riverside',
    mineRiver.status === 200 && !atRiver,
    // Checked by reference rather than by riverside being empty. It was the
    // second of those at first, and it broke the moment the demonstration
    // seeded riverside with a diary of its own — a check that passes because
    // of what happens to be in the database is a check about the database.
    `riverside returned the booking ${reference}, which was made at northgate`
  );

  // ------------------------------------------------------- and it is put back
  //
  // The patient cancels what they just booked. That is a real capability and
  // worth checking on its own, and it is also the only reason this file can be
  // run twice.
  //
  // It could not be, before. Every run booked a slot seven days out and left it
  // there, and after eight runs the morning was full and this said "there are
  // times free — FAIL". Nothing was broken except the check's own residue, and
  // a check that ends up accusing the application of its leftovers is one you
  // learn to ignore. The centre this file creates was being torn down all
  // along; the appointment it made was not.
  const dropped = await call(`/api/centre/bookings/${reference}`, {
    method: 'DELETE',
    centre: 'northgate',
    token: patient.token,
  });
  expect('a patient can cancel their own booking', dropped.status === 204, `got ${dropped.status}`);

  const afterwards = await call('/api/centre/bookings/mine', {
    centre: 'northgate',
    token: patient.token,
  });
  // Still on their list, and marked. This asked for the opposite at first —
  // that the booking disappear — and the application was right and the check
  // was wrong: cancelling sets a status and keeps the row, so somebody who
  // cancels can still see that they did. An appointment that vanishes from
  // your own list is indistinguishable from one that was never made.
  const after = afterwards.body.bookings.find((one) => one.reference === reference);
  expect('and it stays on their list, marked cancelled', after?.status === 'cancelled', `it reads ${after?.status ?? 'gone from the list'}`);

  const freed = await call(
    `/api/centre/availability?room=${room.id}&exam=${northKnee.id}&category=private&day=${when}`,
    { centre: 'northgate' }
  );
  expect(
    'and the time goes back on offer',
    freed.body.times.includes(free.body.times[0]),
    'a cancelled appointment did not give its slot back'
  );

  // -------------------------------------------------------------- permissions
  console.log('\nA role is never enough on its own');

  const desk = await call('/api/centre/desk/diary', { centre: 'northgate', token: patient.token });
  expect('a patient cannot read the diary', desk.status === 403, `got ${desk.status}`);

  const staff = await signIn('staff@example.invalid', PASSWORD.staff);
  const staffAtNorth = await call('/api/centre/desk/diary', {
    centre: 'northgate',
    token: staff.token,
  });
  expect('staff can read the diary where they work', staffAtNorth.status === 200);

  const staffElsewhere = await call('/api/centre/desk/exams', {
    centre: 'lakeside',
    token: staff.token,
  });
  expect(
    'and not at a centre they do not work at',
    staffElsewhere.status === 403,
    `got ${staffElsewhere.status}`
  );

  const platform = await signIn('platform@example.invalid', PASSWORD.platform);
  const platformAtDesk = await call('/api/centre/desk/diary', {
    centre: 'northgate',
    token: platform.token,
  });
  expect(
    'the platform administrator cannot read a patient diary',
    platformAtDesk.status === 403,
    `got ${platformAtDesk.status} — administering the platform is not permission to read every record on it`
  );

  const staffAtConsole = await call('/api/platform/centres', { token: staff.token });
  expect('and staff cannot reach the console', staffAtConsole.status === 403);

  // ------------------------------------------------------------- provisioning
  console.log('\nA centre is created while the others keep working');

  const slug = `walkthrough-${Date.now().toString(36)}`;
  const made = await call('/api/platform/centres', {
    method: 'POST',
    token: platform.token,
    body: { slug, name: 'Walkthrough Centre', options: { showPrices: true } },
  });
  expect('the console creates it', made.status === 201, JSON.stringify(made.body));

  const fresh = await call('/api/centre/exams', { centre: slug });
  expect(
    'it answers immediately, with no restart',
    fresh.status === 200 && fresh.body.exams.length === 0,
    `got ${fresh.status} — a new centre should be reachable and empty`
  );

  const stillThere = await call('/api/centre/exams', { centre: 'northgate' });
  expect('and northgate was untouched', stillThere.status === 200 && stillThere.body.exams.length > 0);

  const sameAgain = await call('/api/platform/centres', {
    method: 'POST',
    token: platform.token,
    body: { slug, name: 'Again' },
  });
  expect('the same name twice is refused', sameAgain.status === 409, `got ${sameAgain.status}`);

  const unconfirmed = await call(`/api/platform/centres/${slug}`, {
    method: 'DELETE',
    token: platform.token,
    body: {},
  });
  expect('removing one needs its name repeated', unconfirmed.status === 400);

  const removed = await call(`/api/platform/centres/${slug}`, {
    method: 'DELETE',
    token: platform.token,
    body: { confirm: slug },
  });
  expect('and then it goes', removed.status === 204, `got ${removed.status}`);

  const gone = await call('/api/centre/exams', { centre: slug });
  expect('and stops answering', gone.status === 404, `got ${gone.status}`);

  // ----------------------------------------------------------------- the end
  console.log('');
  if (failures > 0) {
    console.log(`${failures} of ${checks} checks failed.`);
    process.exit(1);
  }
  console.log(`All ${checks} checks passed.`);
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
