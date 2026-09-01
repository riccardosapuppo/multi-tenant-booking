/**
 * The demonstration: three centres, invented, and the accounts to see them by.
 *
 * Run on an empty database by `npm start`. Everything in it is made up, and
 * conspicuously so — the centres are named after nothing that exists, the
 * patients are `Demo Patient`, and the passwords are printed in the README.
 * That is the point: this is a demonstration of a mechanism, and a
 * demonstration carrying data that could be mistaken for real is one nobody
 * should run.
 *
 * The three centres differ on purpose, because three copies of the same centre
 * would prove nothing:
 *
 *   northgate  two sites, both modalities, generous quotas — the easy case.
 *   riverside  one site, one MRI room, tight quotas and a short week. The
 *              centre where a morning is full for exempt patients and open
 *              for private ones, which is the case the availability rules
 *              exist for.
 *   lakeside   suspended. It is in the register and refuses requests, so the
 *              difference between "no such centre" and "not accepting
 *              bookings" can be seen rather than described.
 */

'use strict';

const { sharedPool, tenantPool } = require('../db/pools');
const provision = require('../tenants/provision');
const passwords = require('../auth/passwords');

/**
 * Demonstration passwords, in the source and in the README on purpose.
 *
 * They open nothing: the database they belong to is created empty by
 * `docker compose up` on the machine of whoever is reading, and is thrown away
 * with it. Hiding them behind an environment variable would mean a reader
 * cannot sign in without being told a secret, which is the opposite of what a
 * demonstration is for.
 */
const PASSWORD = {
  patient: 'patient-demo-1234',
  staff: 'staff-demo-1234',
  centreAdmin: 'centre-admin-demo-1234',
  platformAdmin: 'platform-admin-demo-1234',
};

const CENTRES = [
  {
    slug: 'northgate',
    name: 'Northgate Diagnostics',
    options: { onlineCancellation: true, showPrices: true },
    active: true,
  },
  {
    slug: 'riverside',
    name: 'Riverside Imaging',
    // The same code, behaving differently, from the register rather than from
    // an `if` on the centre's identifier in a shared code path.
    options: { onlineCancellation: false, showPrices: false },
    active: true,
  },
  {
    slug: 'lakeside',
    name: 'Lakeside Radiology',
    options: {},
    active: false,
  },
];

const EXAMS = [
  { code: 'MR-KNEE', name: 'MRI knee', modality: 'MR', minutes: 30, price_cents: 18000 },
  { code: 'MR-SPINE', name: 'MRI whole spine', modality: 'MR', minutes: 75, price_cents: 42000 },
  { code: 'CT-ABDO', name: 'CT abdomen', modality: 'CT', minutes: 20, price_cents: 26000 },
  { code: 'XR-CHEST', name: 'X-ray chest', modality: 'XR', minutes: 10, price_cents: 4000 },
  { code: 'XR-KNEE', name: 'X-ray knee', modality: 'XR', minutes: 10, price_cents: 4500 },
  { code: 'US-ABDO', name: 'Ultrasound abdomen', modality: 'US', minutes: 20, price_cents: 9000 },
  {
    code: 'CT-ANGIO',
    name: 'CT angiography',
    modality: 'CT',
    minutes: 25,
    price_cents: 32000,
    bookable: false,
    notes: 'A doctor has to approve the contrast dose first.',
  },
];

async function fillCentre(tenant, shape) {
  const pool = tenantPool(tenant);

  const sites = shape.sites;
  const siteIds = [];
  for (const site of sites) {
    const { rows } = await pool.query(
      'INSERT INTO sites (name, address) VALUES ($1, $2) RETURNING id',
      [site.name, site.address]
    );
    siteIds.push(rows[0].id);
  }

  const examIds = new Map();
  for (const exam of EXAMS) {
    const { rows } = await pool.query(
      `INSERT INTO exams (code, name, modality, minutes, price_cents, bookable, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        exam.code,
        exam.name,
        exam.modality,
        exam.minutes,
        // Each centre prices its own list. Same exam, different money — which
        // is one of the things having a database each is for.
        Math.round(exam.price_cents * (shape.priceFactor || 1)),
        exam.bookable !== false,
        exam.notes || null,
      ]
    );
    examIds.set(exam.code, rows[0].id);
  }

  for (const room of shape.rooms) {
    const { rows } = await pool.query(
      `INSERT INTO rooms (site_id, code, name, modality) VALUES ($1, $2, $3, $4) RETURNING id`,
      [siteIds[room.site], room.code, room.name, room.modality]
    );
    const roomId = rows[0].id;

    for (const exam of EXAMS.filter((e) => e.modality === room.modality)) {
      await pool.query('INSERT INTO room_exams (room_id, exam_id) VALUES ($1, $2)', [
        roomId,
        examIds.get(exam.code),
      ]);
    }

    for (const session of room.sessions) {
      await pool.query(
        `INSERT INTO room_schedules
           (room_id, valid_from, valid_to, weekdays, opens, closes,
            max_total, max_exempt, max_health_service, max_private, max_insured)
         VALUES ($1, CURRENT_DATE - 30, CURRENT_DATE + 365, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          roomId,
          session.weekdays,
          session.opens,
          session.closes,
          session.max_total ?? null,
          session.max_exempt ?? null,
          session.max_health_service ?? null,
          session.max_private ?? null,
          session.max_insured ?? null,
        ]
      );
    }
  }
}

const SHAPES = {
  northgate: {
    priceFactor: 1,
    sites: [
      { name: 'Northgate Main', address: '1 Example Way, Anytown' },
      { name: 'Northgate Annexe', address: '9 Sample Road, Anytown' },
    ],
    rooms: [
      {
        site: 0,
        code: 'MR1',
        name: 'MRI room 1',
        modality: 'MR',
        sessions: [{ weekdays: 'YYYYYNN', opens: '09:00', closes: '13:00' }],
      },
      {
        site: 0,
        code: 'XR1',
        name: 'X-ray room 1',
        modality: 'XR',
        sessions: [{ weekdays: 'YYYYYNN', opens: '08:00', closes: '18:00' }],
      },
      {
        site: 1,
        code: 'US1',
        name: 'Ultrasound room',
        modality: 'US',
        sessions: [{ weekdays: 'YNYNYNN', opens: '09:00', closes: '13:00' }],
      },
      {
        site: 1,
        code: 'CT1',
        name: 'CT room',
        modality: 'CT',
        sessions: [{ weekdays: 'NYNYNNN', opens: '09:00', closes: '13:00' }],
      },
    ],
  },
  riverside: {
    // Dearer, tighter, and open less. The centre where the quotas bite.
    priceFactor: 1.15,
    sites: [{ name: 'Riverside Clinic', address: '4 Demo Street, Othertown' }],
    rooms: [
      {
        site: 0,
        code: 'MR1',
        name: 'MRI room',
        modality: 'MR',
        sessions: [
          {
            weekdays: 'YNYNYNN',
            opens: '09:00',
            closes: '12:00',
            max_total: 5,
            max_exempt: 1,
            max_health_service: 2,
          },
        ],
      },
      {
        site: 0,
        code: 'XR1',
        name: 'X-ray room',
        modality: 'XR',
        sessions: [{ weekdays: 'YYYYYNN', opens: '09:00', closes: '12:00', max_total: 12 }],
      },
    ],
  },
};

/** True when the register has nothing in it, so `npm start` is idempotent. */
async function alreadyDone() {
  const { rows } = await sharedPool().query('SELECT count(*)::int AS n FROM centres');
  return rows[0].n > 0;
}

async function person(email, name, password) {
  const { rows } = await sharedPool().query(
    `INSERT INTO users (email, password_hash, full_name)
          VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`,
    [email, await passwords.hash(password), name]
  );
  return rows[0].id;
}

async function grant(userId, role, centreSlug = null) {
  await sharedPool().query(
    `INSERT INTO grants (user_id, role, centre_id)
          VALUES ($1, $2, (SELECT id FROM centres WHERE slug = $3))
     ON CONFLICT DO NOTHING`,
    [userId, role, centreSlug]
  );
}

async function run() {
  if (await alreadyDone()) {
    console.log('the register already has centres in it: leaving the data alone');
    return { seeded: false };
  }

  for (const centre of CENTRES) {
    const tenant = await provision.create({
      slug: centre.slug,
      name: centre.name,
      options: centre.options,
    });
    console.log(`  centre: ${tenant.slug}`);

    if (SHAPES[centre.slug]) await fillCentre(tenant, SHAPES[centre.slug]);

    if (!centre.active) {
      await sharedPool().query('UPDATE centres SET active = FALSE WHERE slug = $1', [centre.slug]);
    }
  }

  const platform = await person('platform@example.invalid', 'Demo Platform Admin', PASSWORD.platformAdmin);
  await grant(platform, 'platform_admin');

  const admin = await person('admin@example.invalid', 'Demo Centre Admin', PASSWORD.centreAdmin);
  await grant(admin, 'centre_admin', 'northgate');

  const staff = await person('staff@example.invalid', 'Demo Staff', PASSWORD.staff);
  await grant(staff, 'staff', 'northgate');
  // Staff at one centre and nothing at the other, which is the account that
  // makes the permission boundary visible instead of described.
  await grant(staff, 'staff', 'riverside');

  const patient = await person('patient@example.invalid', 'Demo Patient', PASSWORD.patient);
  await grant(patient, 'patient', 'northgate');
  await grant(patient, 'patient', 'riverside');

  console.log('  accounts: platform, admin, staff, patient — passwords are in the README');
  return { seeded: true, centres: CENTRES.length };
}

module.exports = { run, PASSWORD, CENTRES, EXAMS, SHAPES };

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
