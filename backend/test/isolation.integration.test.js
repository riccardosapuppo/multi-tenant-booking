/**
 * The claim this project makes, checked against a real PostgreSQL.
 *
 * The unit tests cover the rules. These cover the thing the rules are for:
 * that one centre cannot reach another's data, that a centre can be created
 * while the others are running, and that a failed creation leaves nothing
 * behind.
 *
 * They need a database. Given one, they create two centres of their own, use
 * them, and drop them again — so they can run against the same PostgreSQL the
 * demonstration uses without touching the demonstration's data.
 *
 * With no database they are skipped rather than failed. A red suite that means
 * "you did not start Docker" trains people to ignore red suites; CI provides
 * one, so there it is never skipped.
 */

'use strict';

const { strict: assert } = require('node:assert');
const { describe, it, before, after } = require('node:test');

const { sharedPool, tenantPool, maintenancePool, closeAll } = require('../db/pools');
const provision = require('../tenants/provision');
const registry = require('../tenants/registry');
const store = require('../booking/store');

const ALPHA = 'test-alpha-iso';
const BETA = 'test-beta-iso';

let available = false;

async function reachable() {
  const admin = maintenancePool();
  try {
    await admin.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await admin.end().catch(() => {});
  }
}

/** The register, in whichever database the environment points at. */
async function ensureRegistry() {
  const fs = require('node:fs');
  const path = require('node:path');
  await sharedPool().query(
    fs.readFileSync(path.join(__dirname, '..', 'sql', 'registry.sql'), 'utf8')
  );
}

async function fill(tenant, { examName, roomCode }) {
  const pool = tenantPool(tenant);
  const site = await pool.query(
    "INSERT INTO sites (name, address) VALUES ($1, '1 Nowhere') RETURNING id",
    [`${tenant.slug} site`]
  );
  const room = await pool.query(
    'INSERT INTO rooms (site_id, code, name, modality) VALUES ($1, $2, $3, $4) RETURNING id',
    [site.rows[0].id, roomCode, `${tenant.slug} room`, 'MR']
  );
  const exam = await pool.query(
    `INSERT INTO exams (code, name, modality, minutes, price_cents)
          VALUES ('MR-KNEE', $1, 'MR', 30, 10000) RETURNING id`,
    [examName]
  );
  await pool.query('INSERT INTO room_exams (room_id, exam_id) VALUES ($1, $2)', [
    room.rows[0].id,
    exam.rows[0].id,
  ]);

  return { roomId: room.rows[0].id, examId: exam.rows[0].id };
}

describe('one centre cannot see another', { skip: false }, () => {
  let alpha;
  let beta;
  let inAlpha;
  let inBeta;

  before(async () => {
    available = await reachable();
    if (!available) return;

    await ensureRegistry();

    // Left over from an interrupted run.
    for (const slug of [ALPHA, BETA]) {
      await provision.remove({ slug }).catch(() => {});
    }

    alpha = await provision.create({ slug: ALPHA, name: 'Alpha', options: { showPrices: true } });
    beta = await provision.create({ slug: BETA, name: 'Beta', options: { showPrices: false } });

    inAlpha = await fill(alpha, { examName: 'Alpha knee MRI', roomCode: 'A-MR1' });
    inBeta = await fill(beta, { examName: 'Beta knee MRI', roomCode: 'B-MR1' });
  });

  after(async () => {
    if (!available) return;
    for (const slug of [ALPHA, BETA]) {
      await provision.remove({ slug }).catch(() => {});
    }
    await closeAll();
  });

  it('has a database of its own for each', async (t) => {
    if (!available) return t.skip('no PostgreSQL');

    const { rows } = await maintenancePool().query(
      "SELECT datname FROM pg_database WHERE datname LIKE 'centre_test_%_iso'"
    );
    assert.equal(rows.length, 2);
  });

  it('keeps each centre’s exams to itself', async (t) => {
    if (!available) return t.skip('no PostgreSQL');

    const alphaExams = await store.exams(alpha);
    const betaExams = await store.exams(beta);

    assert.deepEqual(alphaExams.map((e) => e.name), ['Alpha knee MRI']);
    assert.deepEqual(betaExams.map((e) => e.name), ['Beta knee MRI']);
  });

  it('keeps bookings apart even when the ids are the same', async (t) => {
    if (!available) return t.skip('no PostgreSQL');

    // Both centres number their rooms and exams from 1. If isolation were a
    // WHERE clause somebody could forget, this is where it would show.
    const when = new Date();
    when.setDate(when.getDate() + 1);
    when.setHours(10, 0, 0, 0);

    const made = await store.book(alpha, {
      userId: 1,
      patientName: 'Demo Patient',
      category: 'private',
      roomId: inAlpha.roomId,
      startsAt: when.toISOString(),
      items: [{ exam_id: inAlpha.examId, price_cents: 10000, minutes: 30 }],
    });
    assert.equal(made.ok, true);

    assert.equal((await store.diary(alpha, when)).length, 1);
    assert.equal((await store.diary(beta, when)).length, 0);
  });

  it('refuses the same room and time twice', async (t) => {
    if (!available) return t.skip('no PostgreSQL');

    const when = new Date();
    when.setDate(when.getDate() + 2);
    when.setHours(9, 0, 0, 0);

    const item = { exam_id: inBeta.examId, price_cents: 10000, minutes: 30 };
    const first = await store.book(beta, {
      userId: 1, patientName: 'Demo Patient', category: 'private',
      roomId: inBeta.roomId, startsAt: when.toISOString(), items: [item],
    });
    const second = await store.book(beta, {
      userId: 2, patientName: 'Another Demo Patient', category: 'private',
      roomId: inBeta.roomId, startsAt: when.toISOString(), items: [item],
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'taken');
  });

  it('carries its own options in the register', async (t) => {
    if (!available) return t.skip('no PostgreSQL');

    const a = await registry.bySlug(ALPHA);
    const b = await registry.bySlug(BETA);

    assert.equal(registry.option(a, 'showPrices'), true);
    assert.equal(registry.option(b, 'showPrices'), false);
    assert.equal(registry.option(b, 'notSetAnywhere', 'fallback'), 'fallback');
  });
});

/**
 * Its own centre, made and removed here.
 *
 * The first version of this block reused the centre from the one above and
 * failed: the suites are independent, the first one's `after` had already
 * removed it, and "refuses a name that is already taken" was creating the
 * name it expected to be taken. A test that depends on what another test left
 * behind passes in the order it was written and nowhere else.
 */
describe('creating a centre', () => {
  const TAKEN = 'test-taken-iso';

  before(async () => {
    available = await reachable();
    if (!available) return;
    await ensureRegistry();
    await provision.remove({ slug: TAKEN }).catch(() => {});
    await provision.create({ slug: TAKEN, name: 'Taken' });
  });

  after(async () => {
    if (!available) return;
    await provision.remove({ slug: TAKEN }).catch(() => {});
    await closeAll();
  });

  it('refuses a name that is already taken', async (t) => {
    if (!available) return t.skip('no PostgreSQL');

    await assert.rejects(
      () => provision.create({ slug: TAKEN, name: 'Taken again' }),
      (error) => error instanceof provision.AlreadyExists
    );
  });

  it('leaves nothing behind when it fails', async (t) => {
    if (!available) return t.skip('no PostgreSQL');

    // A slug that passes validation but whose register insert will fail,
    // because the name is empty — checked before anything is created, so
    // nothing should exist afterwards and the name must stay usable.
    await assert.rejects(() => provision.create({ slug: 'test-doomed-iso', name: '   ' }));

    const { rows } = await maintenancePool().query(
      "SELECT 1 FROM pg_database WHERE datname = 'centre_test_doomed_iso'"
    );
    assert.equal(rows.length, 0);
  });

  it('refuses a slug that is not a slug', async (t) => {
    if (!available) return t.skip('no PostgreSQL');

    for (const bad of ['Has Capitals', 'has_underscores', 'a', '-leading', 'trailing-', 'x"; DROP']) {
      await assert.rejects(() => provision.create({ slug: bad, name: 'No' }), `accepted "${bad}"`);
    }
  });
});
