/**
 * Who somebody is, and what they may do here.
 *
 * The rule this file exists to enforce is one sentence: **a role is never
 * enough on its own — it always comes with a centre.** "Staff" means nothing
 * until you say staff *where*, and the moment a permission check forgets the
 * second half, a receptionist at one centre can read another's diary.
 *
 * That is why `grants` in the register carries a centre, and why every check
 * below takes the tenant from the request rather than from the token. A token
 * says who you are; the URL says which centre you are asking about; the grant
 * table says whether those two go together. Reading the centre out of the
 * token instead would mean one session could only ever serve one centre, and
 * would quietly make the check pass for whichever centre the token was minted
 * against — not the one being asked for.
 *
 * There are four roles and they are ordered only within a centre:
 *
 *   patient        books for themselves, sees their own bookings
 *   staff          sees and manages that centre's diary
 *   centre_admin   the above, plus that centre's exams, rooms and settings
 *   platform_admin creates and configures centres; has no centre of its own
 *
 * platform_admin is not "centre_admin but more". It is a different job: it can
 * bring a centre into existence and cannot see a patient's booking inside one.
 * Making it a superset would mean the person who administers the platform can
 * read every patient record on it, which is not a permission anybody asked for
 * and not one worth having.
 */

'use strict';

const { sharedPool } = require('../db/pools');
const sessions = require('./sessions');

const RANK = { patient: 1, staff: 2, centre_admin: 3 };

/** Everything this account may do, as `{ platformAdmin, byCentre }`. */
async function grantsOf(userId) {
  const { rows } = await sharedPool().query(
    `SELECT g.role, c.slug
       FROM grants g
       LEFT JOIN centres c ON c.id = g.centre_id
      WHERE g.user_id = $1`,
    [userId]
  );

  const byCentre = new Map();
  let platformAdmin = false;

  for (const row of rows) {
    if (row.role === 'platform_admin') {
      platformAdmin = true;
      continue;
    }
    const held = byCentre.get(row.slug);
    if (!held || RANK[row.role] > RANK[held]) byCentre.set(row.slug, row.role);
  }

  return { platformAdmin, byCentre };
}

/**
 * Reads the token and puts the account on the request. Does not refuse.
 *
 * Separate from requiring a role so that a page can behave differently for a
 * signed-in visitor without every route having to be behind a wall.
 */
function identify() {
  return async function identifyUser(req, res, next) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) return next();

    try {
      const account = await sessions.whoIs(token);
      if (account) {
        req.user = account;
        req.grants = await grantsOf(account.id);
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

/** Requires an account, of any kind. */
function signedIn() {
  return function requireSignedIn(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'sign in first' });
    return next();
  };
}

/**
 * Requires a role at the centre this request is for.
 *
 * `req.tenant` has to be there: this is checked rather than assumed, because
 * a route mounted without the tenant middleware would otherwise pass every
 * permission check in the file — silently, and only for the routes somebody
 * forgot.
 */
function atLeast(role) {
  if (!RANK[role]) throw new Error(`unknown role: ${role}`);

  return function requireRole(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'sign in first' });
    if (!req.tenant) {
      return next(new Error('atLeast() used on a route with no tenant resolved'));
    }

    const held = req.grants.byCentre.get(req.tenant.slug);
    if (!held || RANK[held] < RANK[role]) {
      // The same answer whether they have no role here or the wrong one, and
      // whether or not the centre exists: a 403 that distinguishes those is a
      // way to enumerate a platform's centres and its staff.
      return res.status(403).json({ error: 'not permitted at this centre' });
    }

    req.role = held;
    return next();
  };
}

/** Requires the platform role. Never satisfied by a role at a centre. */
function platformAdmin() {
  return function requirePlatformAdmin(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'sign in first' });
    if (!req.grants.platformAdmin) {
      return res.status(403).json({ error: 'not permitted' });
    }
    return next();
  };
}

module.exports = { identify, signedIn, atLeast, platformAdmin, grantsOf, RANK };
