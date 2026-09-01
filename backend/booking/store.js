/**
 * Reading and writing one centre's diary.
 *
 * Every function here takes a tenant and gets its connection from the pool
 * registry. None of them takes a database name, a connection string or a slug
 * from a request: the only way to reach a centre's data is with a tenant that
 * came out of the register, which is what makes "can this request see this
 * centre" a question answered in one place instead of at every query.
 */

'use strict';

const crypto = require('node:crypto');

const { tenantPool } = require('../db/pools');
const availability = require('./availability');

/** A reference somebody can read back over the telephone. */
const ALPHABET = 'CDFHJKLMNPRTVWXY234679';

function reference() {
  const pick = () => ALPHABET[crypto.randomInt(ALPHABET.length)];
  const letters = Array.from({ length: 6 }, pick).join('');
  return `${letters.slice(0, 3)}-${letters.slice(3)}`;
}

async function sites(tenant) {
  const { rows } = await tenantPool(tenant).query(
    'SELECT id, name, address FROM sites WHERE active ORDER BY name'
  );
  return rows;
}

async function exams(tenant, { bookableOnly = true } = {}) {
  const { rows } = await tenantPool(tenant).query(
    `SELECT e.id, e.code, e.name, e.modality, e.minutes, e.price_cents, e.bookable, e.notes
       FROM exams e
      ${bookableOnly ? 'WHERE e.bookable' : ''}
      ORDER BY e.name`
  );
  return rows;
}

/** The rooms that can perform an exam, with the site they are in. */
async function roomsFor(tenant, examId) {
  const { rows } = await tenantPool(tenant).query(
    `SELECT r.id, r.code, r.name, r.modality, s.name AS site_name
       FROM rooms r
       JOIN room_exams re ON re.room_id = r.id
       JOIN sites s ON s.id = r.site_id
      WHERE re.exam_id = $1 AND r.active AND s.active
      ORDER BY s.name, r.name`,
    [examId]
  );
  return rows;
}

async function schedulesOf(tenant, roomId) {
  const { rows } = await tenantPool(tenant).query(
    `SELECT id, room_id, valid_from, valid_to, weekdays, opens, closes,
            max_total, max_exempt, max_health_service, max_private, max_insured, active
       FROM room_schedules
      WHERE room_id = $1 AND active`,
    [roomId]
  );
  return rows;
}

async function bookingsOn(tenant, roomId, day) {
  const from = new Date(day);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);

  const { rows } = await tenantPool(tenant).query(
    `SELECT id, starts_at, ends_at, category, status
       FROM bookings
      WHERE room_id = $1 AND starts_at >= $2 AND starts_at < $3`,
    [roomId, from.toISOString(), to.toISOString()]
  );
  return rows;
}

/** What is free in one room on one day, for one exam and one category. */
async function freeTimes(tenant, { roomId, examMinutes, category, day, now = new Date() }) {
  const [schedules, booked] = await Promise.all([
    schedulesOf(tenant, roomId),
    bookingsOn(tenant, roomId, day),
  ]);

  return availability.freeOnDay({
    day,
    minutes: examMinutes,
    category,
    schedules,
    bookings: booked,
    now,
  });
}

/**
 * Makes a booking, or refuses.
 *
 * In one transaction, and the overlap is checked again inside it. The check
 * that produced the offered time happened seconds ago in another request, and
 * between the two somebody else may have taken it — this is the only check
 * that counts, because it is the one holding the row lock.
 */
async function book(tenant, { userId, patientName, category, roomId, startsAt, items }) {
  const pool = tenantPool(tenant);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const minutes = items.reduce((total, item) => total + item.minutes, 0);
    const starts = new Date(startsAt);
    const ends = new Date(starts.getTime() + minutes * 60000);

    // FOR UPDATE on the room's bookings in the window: two requests for the
    // same time queue rather than both succeed.
    const { rows: clashing } = await client.query(
      `SELECT id FROM bookings
        WHERE room_id = $1
          AND status <> 'cancelled'
          AND starts_at < $3 AND ends_at > $2
        FOR UPDATE`,
      [roomId, starts.toISOString(), ends.toISOString()]
    );

    if (clashing.length > 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'taken' };
    }

    const total = items.reduce((sum, item) => sum + item.price_cents, 0);
    const { rows } = await client.query(
      `INSERT INTO bookings (reference, user_id, patient_name, category, starts_at, ends_at, room_id, total_cents)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, reference, starts_at, ends_at, total_cents`,
      [reference(), userId, patientName, category, starts.toISOString(), ends.toISOString(), roomId, total]
    );

    const booking = rows[0];

    for (const item of items) {
      await client.query(
        `INSERT INTO booking_items (booking_id, exam_id, price_cents, minutes)
              VALUES ($1, $2, $3, $4)`,
        [booking.id, item.exam_id, item.price_cents, item.minutes]
      );
    }

    await client.query('COMMIT');
    return { ok: true, booking };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** One person's bookings at this centre. */
async function mine(tenant, userId) {
  const { rows } = await tenantPool(tenant).query(
    `SELECT b.id, b.reference, b.patient_name, b.category, b.status,
            b.starts_at, b.ends_at, b.total_cents,
            r.name AS room_name, s.name AS site_name,
            COALESCE(json_agg(json_build_object('name', e.name, 'code', e.code))
                     FILTER (WHERE e.id IS NOT NULL), '[]') AS exams
       FROM bookings b
       JOIN rooms r ON r.id = b.room_id
       JOIN sites s ON s.id = r.site_id
       LEFT JOIN booking_items bi ON bi.booking_id = b.id
       LEFT JOIN exams e ON e.id = bi.exam_id
      WHERE b.user_id = $1
      GROUP BY b.id, r.name, s.name
      ORDER BY b.starts_at DESC`,
    [userId]
  );
  return rows;
}

/** The whole diary for a day, for the people at the desk. */
async function diary(tenant, day) {
  const from = new Date(day);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);

  const { rows } = await tenantPool(tenant).query(
    `SELECT b.id, b.reference, b.patient_name, b.category, b.status,
            b.starts_at, b.ends_at, b.total_cents, r.name AS room_name
       FROM bookings b
       JOIN rooms r ON r.id = b.room_id
      WHERE b.starts_at >= $1 AND b.starts_at < $2
      ORDER BY b.starts_at, r.name`,
    [from.toISOString(), to.toISOString()]
  );
  return rows;
}

/**
 * Cancels a booking.
 *
 * The user id is part of the WHERE rather than checked after reading: a
 * cancel that reads first and compares afterwards is one refactor away from
 * cancelling somebody else's appointment.
 */
async function cancel(tenant, { reference: ref, userId = null }) {
  const conditions = ['reference = $1', "status = 'confirmed'"];
  const values = [ref];

  if (userId !== null) {
    values.push(userId);
    conditions.push(`user_id = $${values.length}`);
  }

  const { rowCount } = await tenantPool(tenant).query(
    `UPDATE bookings SET status = 'cancelled', cancelled_at = now()
      WHERE ${conditions.join(' AND ')}`,
    values
  );

  return rowCount > 0;
}

module.exports = {
  sites,
  exams,
  roomsFor,
  schedulesOf,
  bookingsOn,
  freeTimes,
  book,
  mine,
  diary,
  cancel,
  reference,
};
