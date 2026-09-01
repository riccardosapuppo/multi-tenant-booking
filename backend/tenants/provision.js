/**
 * Bringing a new centre into existence.
 *
 * This is the operation that makes "multi-tenant" mean something. Routing
 * three centres that already exist is a middleware; *creating* the fourth,
 * from a console, while the other three keep taking bookings, is the thing
 * that has to be got right — and it is the one that cannot be undone by
 * editing a config file afterwards.
 *
 * The original did exactly this: a console page that took a name and a slug,
 * created a database for the centre, and ran a schema template into it. That
 * shape is kept. What is different is that the failures are handled rather
 * than assumed away, because provisioning is where a multi-tenant system is
 * most likely to leave something half-made:
 *
 *   - `CREATE DATABASE` cannot run inside a transaction, so the register row
 *     and the database cannot be created atomically. The order is chosen so
 *     that the survivable failure is the one that happens: the database is
 *     made first, and only a centre that has one is written to the register.
 *     A database with no register row is invisible and harmless; a register
 *     row with no database is a centre that 500s at every request.
 *   - the schema is applied inside a transaction of its own, so a template
 *     that fails halfway leaves an empty database rather than half a schema.
 *   - if anything fails after the database exists, it is dropped again. A
 *     failed attempt must not leave a name that cannot be reused, because the
 *     first thing anybody does after an error is try the same name again.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { sharedPool, maintenancePool, tenantPool, databaseFor, forget } = require('../db/pools');
const registry = require('./registry');

const TEMPLATE = path.join(__dirname, '..', 'sql', 'tenant-template.sql');

class AlreadyExists extends Error {
  constructor(slug) {
    super(`a centre called "${slug}" already exists`);
    this.name = 'AlreadyExists';
    this.slug = slug;
  }
}

function template() {
  return fs.readFileSync(TEMPLATE, 'utf8');
}

/**
 * Creates the centre, its database and its schema.
 *
 * Returns the tenant as the register now describes it, so the caller can use
 * it immediately without reading it back.
 */
async function create({ slug, name, timezone = 'Europe/Rome', options = {} }) {
  if (typeof slug !== 'string' || !registry.SLUG.test(slug)) {
    throw new Error(`"${slug}" is not usable as a centre slug`);
  }
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('a centre needs a name');
  }

  const shared = sharedPool();

  // Asked before doing anything, so the ordinary mistake — creating a centre
  // that is already there — gets a clear answer rather than a database error
  // from three steps later.
  const seen = await shared.query('SELECT 1 FROM centres WHERE slug = $1', [slug]);
  if (seen.rowCount > 0) throw new AlreadyExists(slug);

  const database = databaseFor(slug);
  const admin = maintenancePool();
  let created = false;

  try {
    // Not a bound parameter: an identifier cannot be one. It is quoted, and
    // the slug it is built from has been checked against an anchored pattern
    // twice — here through databaseFor, and in the register's own constraint.
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;

    await applySchema({ slug });

    const { rows } = await shared.query(
      `INSERT INTO centres (slug, display_name, timezone, options)
            VALUES ($1, $2, $3, $4::jsonb)
         RETURNING id, slug, display_name, timezone, active, options`,
      [slug, name.trim(), timezone, JSON.stringify(options)]
    );

    return {
      id: rows[0].id,
      slug: rows[0].slug,
      name: rows[0].display_name,
      timezone: rows[0].timezone,
      active: rows[0].active,
      options: rows[0].options,
    };
  } catch (error) {
    // Put back what was made. A half-created centre whose name cannot be
    // reused is the worst outcome here: the operator retries with the same
    // name, gets "already exists", and now has to be told about a database
    // they never saw.
    if (created) {
      forget(slug);
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).catch(() => {});
    }
    throw error;
  } finally {
    await admin.end().catch(() => {});
  }
}

/**
 * Runs the schema template into a centre's database.
 *
 * Separate from create() because it is also how an existing centre is brought
 * up to date: the template is written with IF NOT EXISTS throughout, so
 * applying it twice is not an error. That is what makes "one database per
 * centre" survivable — a schema change has to reach every centre, and the way
 * it does is by running this for each of them.
 */
async function applySchema({ slug }) {
  const pool = tenantPool({ slug });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(template());
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Removes a centre and everything in it.
 *
 * Here because a demonstration that can create a centre and not remove one
 * fills up with half-tried names, and because the order matters in the
 * opposite direction: the register row goes first, so that a failure to drop
 * the database leaves an unreachable database rather than a centre that is
 * advertised and broken.
 */
async function remove({ slug }) {
  const shared = sharedPool();
  await shared.query('DELETE FROM centres WHERE slug = $1', [slug]);

  forget(slug);

  const admin = maintenancePool();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseFor(slug)}" WITH (FORCE)`);
  } finally {
    await admin.end().catch(() => {});
  }
}

module.exports = { create, remove, applySchema, AlreadyExists, TEMPLATE };
