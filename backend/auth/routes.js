'use strict';

const express = require('express');

const { sharedPool } = require('../db/pools');
const passwords = require('./passwords');
const sessions = require('./sessions');
const access = require('./access');

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
      centres: [...grants.byCentre].map(([slug, role]) => ({ slug, role })),
    });
  } catch (error) {
    return next(error);
  }
});

/** A hash of the right shape that no password produces. */
const NO_SUCH_ACCOUNT =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

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
    centres: [...req.grants.byCentre].map(([slug, role]) => ({ slug, role })),
  });
});

module.exports = router;
