/**
 * Where else this account has appointments.
 *
 * Every other list in this application is inside one centre, which is the
 * point: a booking made at one is not in another's database. The cost of that
 * showed up the first time somebody booked at Riverside, signed out -- which
 * gives up the chosen centre on purpose, so the next person at the same machine
 * does not land in somebody else's -- and signed back in at Northgate, where
 * their appointment was not. Nothing was lost. Nothing said where it was
 * either, and an empty list is indistinguishable from a lost booking.
 *
 * So this asks each centre the account belongs to, one small query each. It is
 * not the platform console reading across tenants: it is a person's own
 * appointments, at the centres they themselves are registered with, and the
 * loop is over their grants rather than over the platform.
 */

'use strict';

const { tenantPool } = require('../db/pools');
const registry = require('../tenants/registry');

async function bookingCounts(grants, userId) {
  const found = [];

  for (const [slug] of grants.byCentre) {
    let centre;
    try {
      centre = await registry.bySlug(slug);
    } catch {
      // A centre that has gone since the grant was written. Not this route's
      // problem to report, and not a reason to fail the others.
      continue;
    }
    if (!centre.active) continue;
    found.push(centre);
  }

  const counts = [];
  for (const centre of found) {
    try {
      const { rows } = await tenantPool(centre).query(
        `SELECT count(*)::int AS upcoming
           FROM bookings
          WHERE user_id = $1 AND status <> 'cancelled' AND starts_at >= now()`,
        [userId]
      );
      counts.push({ slug: centre.slug, name: centre.name, upcoming: rows[0].upcoming });
    } catch {
      // One centre being unreachable should not hide the others.
      counts.push({ slug: centre.slug, name: centre.name, upcoming: null });
    }
  }

  return counts;
}

module.exports = { bookingCounts };
