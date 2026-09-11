/**
 * Sessions: an opaque token in a table, not a JWT.
 *
 * A signed token that carries claims cannot be withdrawn before it expires.
 * For a platform where an administrator suspends a centre or removes a
 * member of staff and expects that to take effect now, "now" has to mean now:
 * a row that can be deleted does that, and a self-contained token does not
 * without building the revocation list that the token was supposed to avoid.
 *
 * The cost is a database read per request. It is one indexed lookup against
 * the small shared database that every request already reads for the register,
 * and it buys the ability to answer "log this person out" truthfully.
 */

'use strict';

const crypto = require('node:crypto');

const { sharedPool } = require('../db/pools');

/** How long a session lasts without being used again. */
const HOURS = 12;

/** 32 bytes from the system source, base64url. Not a uuid: uuids are ids. */
function mint() {
  return crypto.randomBytes(32).toString('base64url');
}

async function open(userId) {
  const token = mint();
  await sharedPool().query(
    `INSERT INTO sessions (token, user_id, expires_at)
          VALUES ($1, $2, now() + ($3 || ' hours')::interval)`,
    [token, userId, String(HOURS)]
  );
  return { token, hours: HOURS };
}

/**
 * The account behind a token, or null.
 *
 * The expiry is compared in the database rather than in Node: the row and the
 * clock deciding it are then the same clock, and a server whose time has
 * drifted cannot extend a session past what the database believes.
 */
async function whoIs(token) {
  if (typeof token !== 'string' || token.length < 20) return null;

  const { rows } = await sharedPool().query(
    `SELECT u.id, u.email, u.full_name, u.phone, u.born_on, u.tax_code
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  );

  if (rows.length === 0) return null;
  const found = rows[0];
  return {
    id: found.id,
    email: found.email,
    name: found.full_name,
    // The details somebody gave when they registered, so a page can show them
    // back rather than ask again. A date comes out of the driver as a Date and
    // goes to the browser as the day it is, without a timezone deciding it is
    // the one before.
    phone: found.phone,
    bornOn: found.born_on ? found.born_on.toISOString().slice(0, 10) : null,
    taxCode: found.tax_code,
  };
}

async function close(token) {
  const { rowCount } = await sharedPool().query('DELETE FROM sessions WHERE token = $1', [token]);
  return rowCount > 0;
}

/** Everything expired. Called when a session is opened, not on a timer. */
async function sweep() {
  const { rowCount } = await sharedPool().query('DELETE FROM sessions WHERE expires_at <= now()');
  return rowCount;
}

module.exports = { open, whoIs, close, sweep, HOURS };
