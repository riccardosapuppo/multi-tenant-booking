/**
 * The register of centres, and the one place that turns a request into a tenant.
 *
 * A booking platform of this shape serves many diagnostic centres from one
 * deployment. Each centre has its own patients, its own rooms, its own price
 * list and its own opening hours, and none of them may ever see another's.
 *
 * The arrangement here is the one the original used, and it is a deliberate
 * hybrid rather than a compromise:
 *
 *   - **one shared database** holds identity and the register: who may log in,
 *     which centres exist, and how each one is configured. It is small, it is
 *     read on every request, and there is exactly one of it.
 *   - **one database per centre** holds everything clinical: rooms, exams,
 *     schedules, bookings. Separate databases rather than a shared table with
 *     a `centre_id` column, because the strongest isolation is the one you
 *     cannot forget to write: a query that omits its filter returns nothing
 *     belonging to somebody else, because there is nothing else in there.
 *
 * The cost of that choice is real and is not hidden: a schema change has to be
 * applied to every centre, and a report across centres has to visit each one.
 * `provision.js` and `migrate.js` exist because of the first; the platform
 * console pays the second, and pays it deliberately.
 */

'use strict';

const { sharedPool } = require('../db/pools');

/** A slug is the whole of what a caller may say about which centre it wants. */
const SLUG = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

class UnknownTenant extends Error {
  constructor(slug) {
    super(`no centre answers to "${slug}"`);
    this.name = 'UnknownTenant';
    this.slug = slug;
  }
}

class TenantSuspended extends Error {
  constructor(slug) {
    super(`the centre "${slug}" is not accepting bookings`);
    this.name = 'TenantSuspended';
    this.slug = slug;
  }
}

/**
 * Everything the rest of the application may know about a centre.
 *
 * Note what is *not* here: no connection string, no password, no database
 * name. Code that holds a tenant cannot build its own connection out of it —
 * it has to ask the pool registry, which is the only thing that knows how a
 * centre's database is reached. That is what keeps "which centre" and "which
 * database" from drifting apart.
 */
function describe(row) {
  return Object.freeze({
    id: row.id,
    slug: row.slug,
    name: row.display_name,
    timezone: row.timezone,
    active: row.active,
    options: Object.freeze({ ...(row.options || {}) }),
  });
}

/** Every centre, for the platform console and for the demonstration seed. */
async function all() {
  const { rows } = await sharedPool().query(
    `SELECT id, slug, display_name, timezone, active, options
       FROM centres
      ORDER BY display_name`
  );
  return rows.map(describe);
}

/**
 * The centre a request is for.
 *
 * Throws rather than returning null. A caller that forgets to check a null
 * carries on with `undefined` where the tenant should be, and the query it
 * then builds is the one nobody wants to debug at three in the morning.
 */
async function bySlug(slug) {
  if (typeof slug !== 'string' || !SLUG.test(slug)) {
    // Checked before it reaches the database, and checked as a whole string.
    // The slug becomes part of a database name during provisioning, and a
    // pattern anchored at both ends is what keeps that from being interesting.
    throw new UnknownTenant(String(slug));
  }

  const { rows } = await sharedPool().query(
    `SELECT id, slug, display_name, timezone, active, options
       FROM centres
      WHERE slug = $1`,
    [slug]
  );

  if (rows.length === 0) throw new UnknownTenant(slug);

  const centre = describe(rows[0]);
  if (!centre.active) throw new TenantSuspended(slug);
  return centre;
}

/**
 * One option for one centre.
 *
 * This function is the whole reason the register carries an `options` object,
 * and it replaces something specific: the original decided one centre's
 * behaviour with a line that read, in effect,
 *
 *     const table = (centreId === 'a-particular-centre') ? 'SitesEdited' : 'Sites'
 *
 * — a customisation for one client, written into a shared code path, keyed on
 * that client's identifier. It works, it is invisible from the outside, and it
 * is how a multi-tenant application quietly becomes several applications
 * wearing one name: every such line has to be found and understood before any
 * change to that path is safe, and nothing lists them.
 *
 * So: differences between centres live in the register, where they can be
 * listed, changed by an administrator, and seen by whoever reads the code.
 */
function option(tenant, key, fallback = null) {
  return Object.prototype.hasOwnProperty.call(tenant.options, key)
    ? tenant.options[key]
    : fallback;
}

module.exports = { all, bySlug, option, UnknownTenant, TenantSuspended, SLUG };
