'use strict';

const express = require('express');

const { sharedPool } = require('../db/pools');
const passwords = require('./passwords');
const sessions = require('./sessions');
const access = require('./access');
const { resolveTenant } = require('../tenants/resolve');

const router = express.Router();

/**
 * Signing in.
 *
 * Deliberately not per centre. One account, and what it may do at each centre
 * comes back with it — which is the whole reason the register is shared. The
 * alternative, a login per centre, means registering again at every centre a
 * person visits, and it is a worse product before it is a worse design.
 */
router.post('/session', async (req, res, next) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are needed' });
  }

  try {
    const { rows } = await sharedPool().query(
      'SELECT id, email, password_hash, full_name FROM users WHERE lower(email) = $1',
      [email]
    );

    // The password is verified even when the account does not exist, against a
    // hash that cannot match. Skipping it returns "no such account" faster
    // than "wrong password", and the difference is measurable from outside.
    const account = rows[0] || null;
    const stored = account ? account.password_hash : NO_SUCH_ACCOUNT;
    const correct = await passwords.verify(password, stored);

    if (!account || !correct) {
      return res.status(401).json({ error: 'those details are not right' });
    }

    await sessions.sweep().catch(() => {});
    const opened = await sessions.open(account.id);
    const grants = await access.grantsOf(account.id);

    return res.status(201).json({
      token: opened.token,
      hours: opened.hours,
      user: { id: account.id, email: account.email, name: account.full_name },
      platformAdmin: grants.platformAdmin,
      centres: [...grants.byCentre].map(([slug, role]) => ({
        slug,
        role,
        name: grants.names.get(slug) || slug,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

/** A hash of the right shape that no password produces. */
const NO_SUCH_ACCOUNT =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

/**
 * Registering, which happens AT a centre.
 *
 * The account is shared across the platform — one address, one password,
 * everywhere — but the role is not, and a role has to have a centre. So
 * registering hands out `patient` at the centre this request arrived through,
 * and the same person registering at a second centre is not a second account:
 * it is refused here and they sign in instead, because an address that already
 * has an account is either theirs or somebody else's, and neither case is
 * served by making another one.
 *
 * It returns exactly what signing in returns. A caller that has just created
 * an account is signed in, and the client should not have to know which of the
 * two things happened to know what to do next.
 */
router.post('/users', resolveTenant(), async (req, res, next) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const name = String(req.body?.name || '').trim();

  const phone = String(req.body?.phone || '').trim() || null;
  const taxCode = String(req.body?.taxCode || '').trim().toUpperCase() || null;
  const bornOn = String(req.body?.bornOn || '').trim() || null;

  // Said one at a time, because a form that reports "invalid details" makes
  // somebody guess which of six fields it means.
  if (!name) return res.status(400).json({ error: 'a name is needed' });
  if (!email.includes('@')) return res.status(400).json({ error: 'that is not an email address' });
  if (password.length < 8) {
    return res.status(400).json({ error: 'the password needs at least 8 characters' });
  }
  if (bornOn && !/^\d{4}-\d{2}-\d{2}$/.test(bornOn)) {
    return res.status(400).json({ error: 'the date of birth is not a date' });
  }

  try {
    const pool = sharedPool();

    const taken = await pool.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
    if (taken.rowCount > 0) {
      return res.status(409).json({ error: 'there is already an account with that address' });
    }

    const hash = await passwords.hash(password);
    const made = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, phone, born_on, tax_code)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, full_name`,
      [email, hash, name, phone, bornOn, taxCode]
    );
    const account = made.rows[0];

    await pool.query(
      `INSERT INTO grants (user_id, role, centre_id) VALUES ($1, 'patient', $2)
       ON CONFLICT DO NOTHING`,
      [account.id, req.tenant.id]
    );

    const opened = await sessions.open(account.id);
    const grants = await access.grantsOf(account.id);

    return res.status(201).json({
      token: opened.token,
      hours: opened.hours,
      user: { id: account.id, email: account.email, name: account.full_name },
      platformAdmin: grants.platformAdmin,
      centres: [...grants.byCentre].map(([slug, role]) => ({
        slug,
        role,
        name: grants.names.get(slug) || slug,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/session', async (req, res, next) => {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return res.status(204).end();

  try {
    await sessions.close(token);
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

/** Who am I, and where. What the interface reads to decide what to show. */
router.get('/me', access.signedIn(), (req, res) => {
  res.json({
    user: req.user,
    platformAdmin: req.grants.platformAdmin,
    centres: [...req.grants.byCentre].map(([slug, role]) => ({
      slug,
      role,
      name: req.grants.names.get(slug) || slug,
    })),
  });
});

module.exports = router;
