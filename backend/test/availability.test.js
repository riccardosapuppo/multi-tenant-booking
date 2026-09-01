'use strict';

const { strict: assert } = require('node:assert');
const { describe, it } = require('node:test');

const {
  sessionsOn,
  usage,
  roomLeft,
  freeIn,
  freeOnDay,
  weekdayIndex,
} = require('../booking/availability');

// A Monday.
const MONDAY = new Date(2026, 8, 7);
const TUESDAY = new Date(2026, 8, 8);
const SUNDAY = new Date(2026, 8, 13);

function session(over = {}) {
  return {
    id: 1,
    room_id: 1,
    valid_from: '2026-01-01',
    valid_to: '2026-12-31',
    weekdays: 'YYYYYNN',
    opens: '09:00',
    closes: '13:00',
    max_total: null,
    max_exempt: null,
    max_health_service: null,
    max_private: null,
    max_insured: null,
    active: true,
    ...over,
  };
}

function booking(hour, minutes = 30, over = {}) {
  const starts = new Date(MONDAY);
  starts.setHours(hour, 0, 0, 0);
  const ends = new Date(starts.getTime() + minutes * 60000);
  return {
    id: 1,
    starts_at: starts.toISOString(),
    ends_at: ends.toISOString(),
    category: 'private',
    status: 'confirmed',
    ...over,
  };
}

describe('the day of the week', () => {
  it('counts Monday as zero, to match the schedule pattern', () => {
    // Getting this wrong opens a room on the wrong day for the life of the
    // clinic, and it is the kind of wrong that looks right in July.
    assert.equal(weekdayIndex(MONDAY), 0);
    assert.equal(weekdayIndex(TUESDAY), 1);
    assert.equal(weekdayIndex(SUNDAY), 6);
  });
});

describe('which sessions are open on a day', () => {
  it('takes the ones whose pattern includes that weekday', () => {
    assert.equal(sessionsOn([session()], MONDAY).length, 1);
    assert.equal(sessionsOn([session()], SUNDAY).length, 0);
  });

  it('leaves out the ones outside their validity', () => {
    const expired = session({ valid_from: '2026-01-01', valid_to: '2026-06-30' });
    assert.equal(sessionsOn([expired], MONDAY).length, 0);
  });

  it('includes a session that ends on the day itself', () => {
    // An off-by-one here closes a room a day early, every time a schedule is
    // replaced. The end date is inclusive.
    const ends = session({ valid_to: '2026-09-07' });
    assert.equal(sessionsOn([ends], MONDAY).length, 1);
  });

  it('leaves out the ones switched off', () => {
    assert.equal(sessionsOn([session({ active: false })], MONDAY).length, 0);
  });
});

describe('how full a session is', () => {
  it('counts only bookings inside its window', () => {
    const inside = booking(10);
    const after = booking(14);
    const used = usage([inside, after], session(), MONDAY);

    assert.equal(used.total, 1);
  });

  it('does not count cancelled ones', () => {
    // They stay in the table because a cancellation is a thing that happened.
    // Counting them would leave a morning that reports itself full with
    // nobody in it.
    const used = usage([booking(10, 30, { status: 'cancelled' })], session(), MONDAY);

    assert.equal(used.total, 0);
  });

  it('counts them by payment category', () => {
    const used = usage(
      [booking(9, 30, { category: 'exempt' }), booking(10, 30, { category: 'private' })],
      session(),
      MONDAY
    );

    assert.equal(used.byCategory.exempt, 1);
    assert.equal(used.byCategory.private, 1);
    assert.equal(used.byCategory.insured, 0);
  });
});

describe('whether one more fits', () => {
  it('says yes when nothing is capped', () => {
    const used = usage([], session(), MONDAY);
    assert.equal(roomLeft(session(), used, 'private').ok, true);
  });

  it('says the session is full when the total is reached', () => {
    const capped = session({ max_total: 2 });
    const used = usage([booking(9), booking(10)], capped, MONDAY);

    assert.deepEqual(roomLeft(capped, used, 'private'), { ok: false, reason: 'session_full' });
  });

  it('says which category is full, not just that it is full', () => {
    // "The morning is full" and "the morning is full for exempt patients" are
    // different sentences, and only the second one leads anywhere useful.
    const capped = session({ max_exempt: 1 });
    const used = usage([booking(9, 30, { category: 'exempt' })], capped, MONDAY);

    assert.deepEqual(roomLeft(capped, used, 'exempt'), {
      ok: false,
      reason: 'category_full',
      category: 'exempt',
    });
  });

  it('and leaves the morning open for a different category', () => {
    const capped = session({ max_exempt: 1 });
    const used = usage([booking(9, 30, { category: 'exempt' })], capped, MONDAY);

    assert.equal(roomLeft(capped, used, 'private').ok, true);
  });

  it('stops at the total even when a category still has room', () => {
    const capped = session({ max_total: 1, max_private: 5 });
    const used = usage([booking(9, 30, { category: 'exempt' })], capped, MONDAY);

    assert.equal(roomLeft(capped, used, 'private').reason, 'session_full');
  });
});

describe('the free times in a session', () => {
  it('are cut to the length of the exam, and offered on the diary step', () => {
    // Two numbers, not one, and this test had them wrong at first: the length
    // of the appointment and the step it may start on are independent. A
    // 30-minute exam in a four-hour session is not "eight appointments" — it
    // is every quarter past, half past and quarter to from 09:00 to 12:30,
    // because a booked room removes the starts that would run into it rather
    // than the whole half hour.
    //
    // 09:00 to 12:30 inclusive, every 15 minutes: 15 starts.
    assert.equal(freeIn({ session: session(), day: MONDAY, minutes: 30, bookings: [] }).length, 15);
    // 09:00 to 12:45 inclusive: 16.
    assert.equal(freeIn({ session: session(), day: MONDAY, minutes: 15, bookings: [] }).length, 16);
  });

  it('never start something that would run past closing', () => {
    const times = freeIn({ session: session(), day: MONDAY, minutes: 45, bookings: [] });
    const last = times[times.length - 1];

    assert.equal(last.getHours(), 12);
    assert.equal(last.getMinutes(), 15); // 12:15 + 45 = 13:00 exactly
  });

  it('leave out what overlaps a booking', () => {
    const times = freeIn({ session: session(), day: MONDAY, minutes: 30, bookings: [booking(10, 30)] });
    const hours = times.map((t) => `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`);

    assert.ok(!hours.includes('10:00'));
    assert.ok(!hours.includes('9:45')); // would run into it
    assert.ok(hours.includes('10:30'));
  });

  it('leave out what has already happened', () => {
    const noon = new Date(MONDAY);
    noon.setHours(12, 0, 0, 0);

    const times = freeIn({ session: session(), day: MONDAY, minutes: 30, bookings: [], now: noon });

    assert.ok(times.every((t) => t > noon));
  });

  it('offer nothing when the exam is longer than the session', () => {
    const short = session({ opens: '09:00', closes: '10:00' });
    assert.deepEqual(freeIn({ session: short, day: MONDAY, minutes: 75, bookings: [] }), []);
  });
});

describe('a whole day', () => {
  it('puts the sessions together in order', () => {
    const morning = session({ id: 1, opens: '09:00', closes: '11:00' });
    const afternoon = session({ id: 2, opens: '14:00', closes: '16:00' });

    const { times } = freeOnDay({
      day: MONDAY,
      minutes: 60,
      category: 'private',
      schedules: [afternoon, morning],
      bookings: [],
    });

    // Five starts in each two-hour session for a one-hour exam: 09:00, 09:15,
    // 09:30, 09:45, 10:00 — and the same again in the afternoon.
    assert.equal(times.length, 10);
    assert.ok(times[0].starts < times[times.length - 1].starts);
    assert.equal(times[0].starts.getHours(), 9);
    assert.equal(times[times.length - 1].starts.getHours(), 15);
  });

  it('says why a session is not being offered instead of hiding it', () => {
    const morning = session({ id: 1, max_exempt: 0 });

    const { times, closed } = freeOnDay({
      day: MONDAY,
      minutes: 30,
      category: 'exempt',
      schedules: [morning],
      bookings: [],
    });

    assert.equal(times.length, 0);
    assert.equal(closed.length, 1);
    assert.equal(closed[0].reason, 'category_full');
  });
});
