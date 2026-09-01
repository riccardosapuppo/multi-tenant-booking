/**
 * Connections: one pool for the shared database, one per centre.
 *
 * The only file that knows how a centre's database is reached. Everything else
 * holds a tenant — a slug, a name, some options — and asks here for a client.
 * Keeping that in one place is what makes the isolation checkable: there is a
 * single function that turns "which centre" into "which database", and a test
 * can point at it.
 *
 * Pools are made once per centre and kept. Building one per request works and
 * is the kind of thing that looks fine until the afternoon a hundred people
 * book at once and PostgreSQL starts refusing connections.
 */

'use strict';

const { Pool } = require('pg');

/** Where the register and the users live. One of it, always. */
let shared = null;

/** One per centre, made on first use. Keyed by slug. */
const perTenant = new Map();

function settings() {
  return {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER || 'booking',
    password: process.env.POSTGRES_PASSWORD || 'booking',
  };
}

/**
 * The name of a centre's database.
 *
 * Derived from the slug rather than stored, so the two cannot disagree — a
 * register row saying one thing and a database called another is a fault that
 * shows up as a centre whose bookings have vanished.
 *
 * The slug is validated where it enters the system (tenants/registry.js), and
 * validated again here. A database name cannot be a bound parameter: it is
 * interpolated into DDL during provisioning, so it is checked at both ends
 * rather than once and trusted.
 */
function databaseFor(slug) {
  if (!/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) {
    throw new Error(`refusing to build a database name from "${slug}"`);
  }
  return `centre_${slug.replace(/-/g, '_')}`;
}

function sharedPool() {
  if (!shared) {
    shared = new Pool({
      ...settings(),
      database: process.env.POSTGRES_REGISTRY || 'booking_registry',
      max: 10,
    });
  }
  return shared;
}

/** The pool for one centre. Takes a tenant, never a raw string from a request. */
function tenantPool(tenant) {
  if (!tenant || typeof tenant.slug !== 'string') {
    // A caller that reaches here with a request parameter instead of a tenant
    // has skipped the register, which is where "may this centre be used at
    // all" is decided.
    throw new TypeError('tenantPool needs a tenant from the register');
  }

  const existing = perTenant.get(tenant.slug);
  if (existing) return existing;

  const pool = new Pool({
    ...settings(),
    database: databaseFor(tenant.slug),
    max: 5,
  });
  perTenant.set(tenant.slug, pool);
  return pool;
}

/** A maintenance connection, for creating and dropping centre databases. */
function maintenancePool() {
  return new Pool({ ...settings(), database: 'postgres', max: 2 });
}

/** Lets a newly provisioned centre be reached without a restart. */
function forget(slug) {
  const pool = perTenant.get(slug);
  if (!pool) return false;
  perTenant.delete(slug);
  pool.end().catch(() => {});
  return true;
}

async function closeAll() {
  const closing = [...perTenant.values()].map((pool) => pool.end().catch(() => {}));
  perTenant.clear();
  if (shared) {
    closing.push(shared.end().catch(() => {}));
    shared = null;
  }
  await Promise.all(closing);
}

module.exports = {
  sharedPool,
  tenantPool,
  maintenancePool,
  databaseFor,
  forget,
  closeAll,
  settings,
};
