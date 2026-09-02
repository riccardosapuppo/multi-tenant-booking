/**
 * When can this be booked?
 *
 * Pure functions over plain data: sessions in, bookings in, free times out.
 * Nothing here opens a connection or reads a clock, which is what lets the
 * awkward cases be tested in three lines instead of being reasoned about —
 * the last slot of a session, the category that has run out, the exam that is
 * longer than the window it would have to fit in.
 *
 * The rules come from the original and they are not a simplification of a
 * booking grid. Two of them decide everything:
 *
 *   1. **A slot is cut, not chosen.** The room is occupied for as long as the
 *      exam takes, so the same morning is two MRI appointments or nine chest
 *      x-rays. Laying out fixed slots and hoping the exam fits is how a
 *      scanner ends up with a fifteen-minute hole nobody can book.
 *
 *   2. **A session has quotas per payment category.** A morning is not "twelve
 *      appointments": it is at most four exempt, at most six on the national
 *      health service, and no more than ten in all. Run the exempt quota out
 *      and the morning is full for an exempt patient and open for a private
 *      one. This is the part most demonstrations drop, and it is the part the
 *      people at the desk spend their day on.
 */

'use strict';

/**
 * Time zones, and the limit this accepts.
 *
 * Opening hours are local hours: a centre that opens at nine opens at nine
 * where it is, and `09:00` in `room_schedules` means that and not an instant.
 * The functions below build times in the *process's* zone, which is correct
 * for as long as every centre is in one zone — so the register carries a
 * timezone per centre, and the container is given it (see docker-compose.yml).
 *
 * A platform whose centres are genuinely in different zones has to do this
 * properly: build each instant in the centre's own zone, which in Node means
 * Intl or a library, and store the zone with the schedule rather than with the
 * centre. That is not done here, and this paragraph is where it says so rather
 * than a reader finding out from a booking an hour out.
 *
 * The symptom, when it was wrong: the container ran in UTC, a session stored
 * as 09:00 went out as 09:00Z, and a browser in Rome offered the first
 * appointment of the day at 11:00.
 */

/** Monday is 0, to match the seven-character weekday pattern in the schema. */
function weekdayIndex(date) {
  return (date.getDay() + 6) % 7;
}

/**
 * A day as `YYYY-MM-DD`, in the zone the clinic is in.
 *
 * `toISOString().slice(0, 10)` was used for this and was wrong everywhere it
 * appeared. It converts to UTC first, so midnight local in a container running
 * at +2 becomes 22:00 the previous day — and the answer came back labelled
 * with a date one behind the times inside it. The interface showed "Sunday 6"
 * above a list of Monday's appointments, which is somebody arriving on the
 * wrong day.
 *
 * The date components are read in local time, which is what a clinic's day is.
 */
function asDay(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function atTime(date, time) {
  const [hours, minutes] = String(time).split(':').map(Number);
  const made = new Date(date);
  made.setHours(hours, minutes || 0, 0, 0);
  return made;
}

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/** The sessions of one room that are open on one day. */
function sessionsOn(schedules, day) {
  const index = weekdayIndex(day);

  return schedules.filter((schedule) => {
    if (schedule.active === false) return false;
    if (schedule.weekdays[index] !== 'Y') return false;

    const from = new Date(schedule.valid_from);
    const to = new Date(schedule.valid_to);
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);

    return day >= from && day <= to;
  });
}

/**
 * How many of a session's places are already taken, in total and by category.
 *
 * Cancelled bookings do not count. They are kept in the table because a
 * cancellation is a thing that happened and somebody will ask about it, and
 * counting them against the quota would leave a morning that reports itself
 * full and has nobody in it.
 */
function usage(bookings, session, day) {
  const opens = atTime(day, session.opens);
  const closes = atTime(day, session.closes);

  const within = bookings.filter((booking) => {
    if (booking.status === 'cancelled') return false;
    const starts = new Date(booking.starts_at);
    return starts >= opens && starts < closes;
  });

  const byCategory = { exempt: 0, health_service: 0, private: 0, insured: 0 };
  for (const booking of within) {
    if (byCategory[booking.category] !== undefined) byCategory[booking.category] += 1;
  }

  return { total: within.length, byCategory, bookings: within };
}

/** The quota column for a category, or null when the session does not cap it. */
function quotaFor(session, category) {
  const columns = {
    exempt: 'max_exempt',
    health_service: 'max_health_service',
    private: 'max_private',
    insured: 'max_insured',
  };
  const value = session[columns[category]];
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Whether one more booking of this category fits in this session.
 *
 * Returns a reason rather than a boolean, because "the morning is full" and
 * "the morning is full for exempt patients" are different sentences to say to
 * somebody, and the second one is followed by a useful question.
 */
function roomLeft(session, used, category) {
  const total = session.max_total === null || session.max_total === undefined ? null : Number(session.max_total);

  if (total !== null && used.total >= total) {
    return { ok: false, reason: 'session_full' };
  }

  const quota = quotaFor(session, category);
  if (quota !== null && used.byCategory[category] >= quota) {
    return { ok: false, reason: 'category_full', category };
  }

  return { ok: true };
}

/**
 * The free start times in one session, for an appointment of `minutes`.
 *
 * Times are offered on a fixed step rather than packed end to end. Packing
 * gets more appointments into a morning and gives out times like 09:37, which
 * a receptionist reading them down a telephone will not use. The step is the
 * granularity the diary is actually kept in.
 */
function freeIn({ session, day, minutes, bookings, step = 15, now = null }) {
  const opens = atTime(day, session.opens);
  const closes = atTime(day, session.closes);
  const taken = usage(bookings, session, day).bookings;

  const found = [];
  const stepMs = step * 60 * 1000;
  const lengthMs = minutes * 60 * 1000;

  for (let start = opens.getTime(); start + lengthMs <= closes.getTime(); start += stepMs) {
    const from = new Date(start);
    const to = new Date(start + lengthMs);

    // Not in the past. A diary that offers this morning to somebody ringing
    // this afternoon is a diary nobody trusts twice.
    if (now && from <= now) continue;

    const clashes = taken.some((booking) => {
      const bookedFrom = new Date(booking.starts_at);
      const bookedTo = new Date(booking.ends_at);
      return from < bookedTo && bookedFrom < to;
    });

    if (!clashes) found.push(from);
  }

  return found;
}

/**
 * Everything free on one day, for one room, for an appointment of `minutes`
 * in one payment category.
 *
 * When a session is full for the category, its times are left out and the
 * reason is reported alongside — so the interface can say why an afternoon
 * that looks empty is not being offered, instead of showing nothing.
 */
function freeOnDay({ day, minutes, category, schedules, bookings, step = 15, now = null }) {
  const times = [];
  const closed = [];

  for (const session of sessionsOn(schedules, day)) {
    const used = usage(bookings, session, day);
    const left = roomLeft(session, used, category);

    if (!left.ok) {
      closed.push({ session: session.id, opens: session.opens, closes: session.closes, reason: left.reason });
      continue;
    }

    for (const start of freeIn({ session, day, minutes, bookings, step, now })) {
      times.push({ starts: start, session: session.id });
    }
  }

  times.sort((a, b) => a.starts - b.starts);
  return { times, closed };
}

/**
 * The same question, against the database.
 *
 * The pure functions above are the rules; this is the one place that fetches
 * what they need. It lives here rather than in the store so that everything
 * about availability is in one file — a caller only has to know one name.
 */
async function freeOnDayFor(tenant, { roomId, minutes, category, day, now }) {
  // Required lazily: this file is otherwise free of the database, and the
  // tests above load it without one.
  const store = require('./store');
  return store.freeTimes(tenant, { roomId, examMinutes: minutes, category, day, now });
}

module.exports = {
  sessionsOn,
  usage,
  quotaFor,
  roomLeft,
  freeIn,
  freeOnDay,
  freeOnDayFor,
  weekdayIndex,
  asDay,
  atTime,
  sameDay,
};
