'use strict';

const express = require('express');

const store = require('./store');
const { search } = require('./search');
const availability = require('./availability');
const access = require('../auth/access');

const router = express.Router();

const CATEGORIES = new Set(['exempt', 'health_service', 'private', 'insured']);

/** What this centre offers. Open without signing in: it is a price list. */
router.get('/exams', async (req, res, next) => {
  try {
    res.json({ centre: req.tenant.slug, exams: await store.exams(req.tenant) });
  } catch (error) {
    next(error);
  }
});

router.get('/sites', async (req, res, next) => {
  try {
    res.json({ centre: req.tenant.slug, sites: await store.sites(req.tenant) });
  } catch (error) {
    next(error);
  }
});

router.get('/exams/:id/rooms', async (req, res, next) => {
  try {
    const rooms = await store.roomsFor(req.tenant, Number(req.params.id));
    res.json({ centre: req.tenant.slug, rooms });
  } catch (error) {
    next(error);
  }
});

/**
 * When could this be done?
 *
 * The category is part of the question and not a detail of the answer: the
 * same morning is open for a private patient and full for an exempt one, so
 * asking "what is free" without saying who is asking has no answer.
 */
router.get('/availability', async (req, res, next) => {
  const roomId = Number(req.query.room);
  const examId = Number(req.query.exam);
  const category = String(req.query.category || 'private');
  const day = req.query.day ? new Date(String(req.query.day)) : new Date();

  if (!Number.isInteger(roomId) || !Number.isInteger(examId)) {
    return res.status(400).json({ error: 'room and exam are needed' });
  }
  if (!CATEGORIES.has(category)) {
    return res.status(400).json({ error: 'unknown payment category', category });
  }
  if (Number.isNaN(day.getTime())) {
    return res.status(400).json({ error: 'day is not a date' });
  }

  try {
    const exams = await store.exams(req.tenant);
    const exam = exams.find((row) => row.id === examId);
    if (!exam) return res.status(404).json({ error: 'no such exam here' });

    const { times, closed } = await store.freeTimes(req.tenant, {
      roomId,
      examMinutes: exam.minutes,
      category,
      day,
    });

    res.json({
      centre: req.tenant.slug,
      day: availability.asDay(day),
      minutes: exam.minutes,
      times: times.map((slot) => slot.starts.toISOString()),
      // Sent even when empty. An afternoon that is closed for this category is
      // a different thing from an afternoon with nothing left, and the
      // interface can say which.
      closed,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * The search the interface actually makes.
 *
 * Several exams, a payment category, and preferences rather than filters —
 * any day or a particular weekday, any time or mornings — and the answer comes
 * back as days with times on them. This is the shape of the question a person
 * asks, and it is the shape the original answered in.
 */
router.post('/search', async (req, res, next) => {
  const body = req.body || {};
  const examIds = Array.isArray(body.examIds) ? body.examIds.map(Number) : [];
  const category = String(body.category || 'private');

  if (examIds.length === 0 || examIds.some((id) => !Number.isInteger(id))) {
    return res.status(400).json({ error: 'choose at least one exam' });
  }
  if (examIds.length > 6) {
    // A visit is a visit. Twenty exams in one appointment is a data entry
    // mistake, and the room would be booked for most of a day.
    return res.status(400).json({ error: 'that is too many exams for one visit' });
  }
  if (!CATEGORIES.has(category)) {
    return res.status(400).json({ error: 'unknown payment category', category });
  }

  const part = ['any', 'morning', 'afternoon'].includes(String(body.part)) ? String(body.part) : 'any';
  const weekday =
    body.weekday === null || body.weekday === undefined || body.weekday === ''
      ? null
      : Number(body.weekday);

  if (weekday !== null && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)) {
    return res.status(400).json({ error: 'weekday is Monday 0 to Sunday 6' });
  }

  try {
    const found = await search(req.tenant, {
      examIds,
      category,
      siteId: body.siteId ? Number(body.siteId) : null,
      weekday,
      part,
    });

    if (!found.ok) {
      // 200 with a reason, not a 4xx: the request was fine and the answer is
      // "not like that". A client that has to read status codes to tell a
      // mistake from an empty diary gets it wrong.
      return res.json({ centre: req.tenant.slug, ...found });
    }

    res.json({ centre: req.tenant.slug, ...found });
  } catch (error) {
    next(error);
  }
});

/** Making one. */
router.post('/bookings', access.signedIn(), async (req, res, next) => {
  const { roomId, startsAt, examIds, patientName, category = 'private' } = req.body || {};

  if (!Number.isInteger(roomId) || !startsAt || !Array.isArray(examIds) || examIds.length === 0) {
    return res.status(400).json({ error: 'roomId, startsAt and examIds are needed' });
  }
  if (!CATEGORIES.has(category)) {
    return res.status(400).json({ error: 'unknown payment category', category });
  }

  try {
    const available = await store.exams(req.tenant);
    const chosen = examIds.map((id) => available.find((exam) => exam.id === Number(id)));

    if (chosen.some((exam) => !exam)) {
      // Not "one of these is not bookable": the list came from this centre, so
      // an id that is not in it is either another centre's or made up, and
      // saying which would answer a question worth not answering.
      return res.status(400).json({ error: 'those exams are not all available here' });
    }

    const result = await store.book(req.tenant, {
      userId: req.user.id,
      patientName: String(patientName || req.user.name).trim(),
      category,
      roomId,
      startsAt,
      items: chosen.map((exam) => ({
        exam_id: exam.id,
        price_cents: exam.price_cents,
        minutes: exam.minutes,
      })),
    });

    if (!result.ok) {
      return res.status(409).json({ error: 'that time has just gone', reason: result.reason });
    }

    res.status(201).json({ centre: req.tenant.slug, booking: result.booking });
  } catch (error) {
    next(error);
  }
});

router.get('/bookings/mine', access.signedIn(), async (req, res, next) => {
  try {
    res.json({ centre: req.tenant.slug, bookings: await store.mine(req.tenant, req.user.id) });
  } catch (error) {
    next(error);
  }
});

router.delete('/bookings/:reference', access.signedIn(), async (req, res, next) => {
  try {
    // The user id goes into the WHERE, so a patient can only cancel their own.
    // Staff may cancel any booking at their own centre — and only there,
    // because the tenant this route is mounted under decides which diary is
    // being touched.
    const isStaff = ['staff', 'centre_admin'].includes(req.grants.byCentre.get(req.tenant.slug));
    const done = await store.cancel(req.tenant, {
      reference: req.params.reference,
      userId: isStaff ? null : req.user.id,
    });

    if (!done) return res.status(404).json({ error: 'no such booking' });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
