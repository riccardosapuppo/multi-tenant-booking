/**
 * Looking for appointments the way somebody actually looks for one.
 *
 * The shape of this comes from the original, and it is not the same question
 * as "what is free in room 7 on Tuesday". A person books by saying what they
 * need and roughly when, and expects back **days**: a list of dates, each with
 * a price and the times available on it. Which room it happens in is the
 * clinic's problem, not theirs.
 *
 * So the answer is grouped by day, each day carries the total price for
 * everything asked for, and the room is chosen here rather than by the caller.
 *
 * Two rules from the original, kept:
 *
 *   - **several exams in one visit.** People book a knee and a shoulder
 *     together and expect one appointment, not two. The exams run back to back
 *     in a room that can perform all of them, and the duration is their sum.
 *   - **preferences, not filters.** "Any day", "mornings", "the first
 *     available" are how the request is phrased. They narrow what is offered;
 *     they never mean "show nothing".
 */

'use strict';

const { tenantPool } = require('../db/pools');
const availability = require('./availability');

/** How far ahead to look before giving up. */
const DAYS = 21;

/** How many days to return. More than a screenful is noise. */
const MOST = 8;

const MORNING_ENDS = 13;

/**
 * A room that can perform every exam asked for.
 *
 * All of them in one room, because the appointment is one visit. A centre
 * whose exams are split across rooms that cannot be combined will return
 * nothing here, and that is the honest answer: the alternative is offering a
 * time that turns into two appointments at the desk.
 */
async function roomsForAll(tenant, examIds) {
  const { rows } = await tenantPool(tenant).query(
    `SELECT r.id, r.code, r.name, r.modality, s.id AS site_id, s.name AS site_name
       FROM rooms r
       JOIN sites s ON s.id = r.site_id
      WHERE r.active AND s.active
        AND NOT EXISTS (
          SELECT 1 FROM unnest($1::int[]) AS wanted(exam_id)
           WHERE NOT EXISTS (
             SELECT 1 FROM room_exams re
              WHERE re.room_id = r.id AND re.exam_id = wanted.exam_id
           )
        )
      ORDER BY s.name, r.name`,
    [examIds]
  );
  return rows;
}

async function examsByIds(tenant, examIds) {
  const { rows } = await tenantPool(tenant).query(
    `SELECT id, code, name, modality, minutes, price_cents, bookable
       FROM exams WHERE id = ANY($1::int[])`,
    [examIds]
  );
  return rows;
}

function wanted(day, preferences) {
  if (preferences.weekday !== null && preferences.weekday !== undefined) {
    if (availability.weekdayIndex(day) !== preferences.weekday) return false;
  }
  return true;
}

function inPreferredPart(when, part) {
  if (part === 'morning') return when.getHours() < MORNING_ENDS;
  if (part === 'afternoon') return when.getHours() >= MORNING_ENDS;
  return true;
}

/**
 * Days with times on them.
 *
 * `from` and `now` are arguments rather than read from the clock, so a test
 * can ask for a week in the past and get a straight answer.
 */
async function search(
  tenant,
  { examIds, category = 'private', siteId = null, weekday = null, part = 'any', from = new Date(), now = new Date() }
) {
  const exams = await examsByIds(tenant, examIds);

  if (exams.length !== examIds.length) {
    return { ok: false, reason: 'unknown_exam' };
  }

  const unbookable = exams.filter((exam) => !exam.bookable);
  if (unbookable.length > 0) {
    // Named rather than hidden. An exam the clinic performs but will not book
    // online is a thing to explain, and the interface says who to ring.
    return { ok: false, reason: 'not_bookable_online', exams: unbookable };
  }

  const minutes = exams.reduce((total, exam) => total + exam.minutes, 0);
  const priceCents = exams.reduce((total, exam) => total + exam.price_cents, 0);

  let rooms = await roomsForAll(tenant, examIds);
  if (siteId !== null) rooms = rooms.filter((room) => room.site_id === Number(siteId));

  if (rooms.length === 0) {
    return { ok: false, reason: 'no_room_does_all', minutes, priceCents };
  }

  const days = [];
  const closed = [];

  for (let ahead = 0; ahead < DAYS && days.length < MOST; ahead += 1) {
    const day = new Date(from);
    day.setDate(day.getDate() + ahead);
    day.setHours(0, 0, 0, 0);

    if (!wanted(day, { weekday })) continue;

    const times = [];
    let room = null;

    for (const candidate of rooms) {
      const found = await availability.freeOnDayFor(tenant, {
        roomId: candidate.id,
        minutes,
        category,
        day,
        now,
      });

      const usable = found.times.filter((slot) => inPreferredPart(slot.starts, part));

      if (usable.length > 0) {
        room = candidate;
        times.push(...usable.map((slot) => slot.starts));
        // The first room that can do it. Spreading one day's offer across
        // rooms would mean the times on screen belong to different places,
        // and the person picking one has no way to tell.
        break;
      }

      for (const shut of found.closed) closed.push({ day: day.toISOString().slice(0, 10), ...shut });
    }

    if (times.length === 0 || !room) continue;

    days.push({
      date: day.toISOString().slice(0, 10),
      priceCents,
      minutes,
      siteName: room.site_name,
      roomId: room.id,
      roomName: room.name,
      modality: room.modality,
      times: times.map((when) => when.toISOString()),
    });
  }

  return {
    ok: true,
    minutes,
    priceCents,
    exams: exams.map((exam) => ({ id: exam.id, code: exam.code, name: exam.name })),
    days,
    // Why a day that looks open is not being offered. Sent even when empty:
    // "the quota for your category is used up" is an answer, "no results" is
    // not.
    closed: closed.slice(0, 6),
  };
}

module.exports = { search, roomsForAll, DAYS, MOST };
