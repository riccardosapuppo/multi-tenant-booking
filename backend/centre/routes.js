/**
 * The centre's own desk: the diary, the price list, the settings.
 *
 * Everything here is behind a role *at this centre*. That is the difference
 * between this file and platform/routes.js, and it is worth saying out loud:
 * the same person may be staff at one centre and nothing at all at the next,
 * and these routes are mounted under the tenant resolver so the centre being
 * asked about is the one the permission is checked against.
 */

'use strict';

const express = require('express');

const store = require('../booking/store');
const access = require('../auth/access');
const { tenantPool } = require('../db/pools');

const router = express.Router();

/** The day's list, for the people at the desk. */
router.get('/diary', access.signedIn(), access.atLeast('staff'), async (req, res, next) => {
  const day = req.query.day ? new Date(String(req.query.day)) : new Date();
  if (Number.isNaN(day.getTime())) return res.status(400).json({ error: 'day is not a date' });

  try {
    const bookings = await store.diary(req.tenant, day);
    res.json({
      centre: req.tenant.slug,
      day: day.toISOString().slice(0, 10),
      bookings,
      // Useful at a glance, and cheap: it is the same rows.
      totals: bookings.reduce(
        (counts, booking) => {
          if (booking.status !== 'cancelled') counts[booking.category] += 1;
          return counts;
        },
        { exempt: 0, health_service: 0, private: 0, insured: 0 }
      ),
    });
  } catch (error) {
    next(error);
  }
});

/** Rooms and their sessions, so the desk can see why a morning is closed. */
router.get('/rooms', access.signedIn(), access.atLeast('staff'), async (req, res, next) => {
  try {
    const { rows } = await tenantPool(req.tenant).query(
      `SELECT r.id, r.code, r.name, r.modality, r.active, s.name AS site_name,
              COALESCE(json_agg(json_build_object(
                'id', sc.id, 'weekdays', sc.weekdays, 'opens', sc.opens, 'closes', sc.closes,
                'max_total', sc.max_total, 'max_exempt', sc.max_exempt,
                'max_health_service', sc.max_health_service, 'max_private', sc.max_private
              ) ORDER BY sc.opens) FILTER (WHERE sc.id IS NOT NULL), '[]') AS sessions
         FROM rooms r
         JOIN sites s ON s.id = r.site_id
         LEFT JOIN room_schedules sc ON sc.room_id = r.id AND sc.active
        GROUP BY r.id, s.name
        ORDER BY s.name, r.name`
    );
    res.json({ centre: req.tenant.slug, rooms: rows });
  } catch (error) {
    next(error);
  }
});

/** The price list, including what cannot be booked online. */
router.get('/exams', access.signedIn(), access.atLeast('staff'), async (req, res, next) => {
  try {
    const exams = await store.exams(req.tenant, { bookableOnly: false });
    res.json({ centre: req.tenant.slug, exams });
  } catch (error) {
    next(error);
  }
});

/** Changing one. The centre's own administrator, not the platform's. */
router.patch('/exams/:id', access.signedIn(), access.atLeast('centre_admin'), async (req, res, next) => {
  const { price_cents: price, minutes, bookable, name } = req.body || {};

  try {
    const { rows } = await tenantPool(req.tenant).query(
      `UPDATE exams
          SET name        = COALESCE($2, name),
              price_cents = COALESCE($3, price_cents),
              minutes     = COALESCE($4, minutes),
              bookable    = COALESCE($5, bookable)
        WHERE id = $1
    RETURNING id, code, name, modality, minutes, price_cents, bookable`,
      [
        Number(req.params.id),
        name === undefined ? null : String(name),
        price === undefined ? null : Number(price),
        minutes === undefined ? null : Number(minutes),
        bookable === undefined ? null : Boolean(bookable),
      ]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'no such exam' });
    res.json({ exam: rows[0] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
