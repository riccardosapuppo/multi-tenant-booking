/**
 * From an empty PostgreSQL to a running platform, in one command.
 *
 * Waits for the database, creates the register, seeds the demonstration if the
 * register is empty, then starts the API. All of it is safe to run twice: the
 * register schema is IF NOT EXISTS throughout and the seed steps aside when it
 * finds centres already there.
 *
 * The waiting is here rather than left to a container healthcheck because the
 * healthcheck answers a different question. PostgreSQL accepts TCP connections
 * a moment before it accepts queries, and a service that starts on the first
 * open socket fails its first query and stays failed — which is a real bug
 * this demonstration had, and the reason the wait is for a query and not for
 * a port.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { sharedPool, maintenancePool, settings } = require('./db/pools');
const seed = require('./seed/demo');
const { start } = require('./index');

const REGISTRY_SQL = path.join(__dirname, 'sql', 'registry.sql');

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits until a query succeeds, not until the port opens. */
async function waitForPostgres({ attempts = 60, every = 1000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const admin = maintenancePool();
    try {
      await admin.query('SELECT 1');
      await admin.end().catch(() => {});
      return true;
    } catch (error) {
      await admin.end().catch(() => {});
      if (attempt === attempts) {
        throw new Error(
          `PostgreSQL at ${settings().host}:${settings().port} never answered: ${error.message}`
        );
      }
      if (attempt === 1 || attempt % 5 === 0) {
        console.log(`  waiting for PostgreSQL (${attempt}/${attempts})`);
      }
      await pause(every);
    }
  }
  return false;
}

/** The shared database, made if it is not there. */
async function ensureRegistryDatabase() {
  const name = process.env.POSTGRES_REGISTRY || 'booking_registry';
  const admin = maintenancePool();

  try {
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE "${name}"`);
      console.log(`  created the register database: ${name}`);
    }
  } finally {
    await admin.end().catch(() => {});
  }
}

async function main() {
  console.log('starting the booking platform');

  await waitForPostgres();
  await ensureRegistryDatabase();

  await sharedPool().query(fs.readFileSync(REGISTRY_SQL, 'utf8'));
  console.log('  register ready');

  await seed.run();

  await start();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
