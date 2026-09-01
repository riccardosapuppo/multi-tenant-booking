/**
 * Password hashing, with what the platform already has.
 *
 * scrypt from node:crypto, not bcrypt or argon2 from npm. Both of those are
 * better studied, and both are native modules that have to compile: on a
 * demonstration meant to start with one command on Windows, macOS and Linux,
 * a build toolchain requirement is the difference between running it and
 * giving up. scrypt is in the standard library, is memory-hard, and is the
 * right answer when the alternative is a dependency nobody can install.
 *
 * The parameters are the Node defaults except for the cost, which is raised.
 * They are written down here rather than left implicit, because a hash that
 * cannot say what made it is a hash nobody can migrate.
 */

'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

const COST = 2 ** 15;
const BLOCK = 8;
const PARALLEL = 1;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

/** `scrypt$N$r$p$salt$hash`, so a future change can tell what it is reading. */
async function hash(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('a password must be at least 8 characters');
  }

  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, KEY_BYTES, {
    N: COST,
    r: BLOCK,
    p: PARALLEL,
    // Node refuses scrypt above a default memory ceiling that N = 2^15 exceeds.
    maxmem: 128 * COST * BLOCK * 2,
  });

  return ['scrypt', COST, BLOCK, PARALLEL, salt.toString('base64'), derived.toString('base64')].join('$');
}

/**
 * Whether this password produced this hash.
 *
 * Never throws on a malformed stored value: a row that cannot be parsed is a
 * failed check, not a crash. An exception here would be an error page that
 * tells an attacker which accounts have odd hashes.
 */
async function verify(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, cost, block, parallel, salt, expected] = parts;
  const N = Number(cost);
  const r = Number(block);
  const p = Number(parallel);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let derived;
  try {
    derived = await scrypt(password, Buffer.from(salt, 'base64'), KEY_BYTES, {
      N,
      r,
      p,
      maxmem: 128 * N * r * 2,
    });
  } catch {
    return false;
  }

  const known = Buffer.from(expected, 'base64');
  // Compared in constant time, and length-checked first because
  // timingSafeEqual throws on a length mismatch — which would itself be a
  // signal, and a crash.
  if (known.length !== derived.length) return false;
  return crypto.timingSafeEqual(known, derived);
}

module.exports = { hash, verify };
