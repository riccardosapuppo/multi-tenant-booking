/**
 * The platform console: the centres themselves.
 *
 * The original kept this in a separate area called the super-dashboard, and
 * the separation was right — creating a centre and taking a booking are
 * different jobs done by different people. What is different here is that it
 * is the same application and the same login, with the routes behind
 * `platform_admin` instead of behind a second deployment. A reader gets to see
 * the whole thing in one place, and the permission boundary is visible in the
 * code rather than implied by two repositories.
 *
 * These routes deliberately do not resolve a tenant. They are *about* centres
 * rather than *within* one, and a console that had to name a centre before it
 * could list them would be a console that cannot create the first.
 */

'use strict';

const express = require('express');

const registry = require('../tenants/registry');
const provision = require('../tenants/provision');
const access = require('../auth/access');
const { sharedPool } = require('../db/pools');

const router = express.Router();

router.use(access.signedIn(), access.platformAdmin());

router.get('/centres', async (req, res, next) => {
  try {
    const centres = await registry.all();

    // How many people work at each, from the register — not by visiting every
    // centre's database. A count per centre that opens a connection per centre
    // is the sort of thing that is instant with three of them and a minute
    // with three hundred.
    const { rows } = await sharedPool().query(
      `SELECT c.slug, g.role, count(*)::int AS people
         FROM grants g JOIN centres c ON c.id = g.centre_id
        GROUP BY c.slug, g.role`
    );

    const people = new Map();
    for (const row of rows) {
      const at = people.get(row.slug) || {};
      at[row.role] = row.people;
      people.set(row.slug, at);
    }

    res.json({ centres: centres.map((centre) => ({ ...centre, people: people.get(centre.slug) || {} })) });
  } catch (error) {
    next(error);
  }
});

/**
 * Creating one.
 *
 * This is the operation the whole project exists to show. It makes a database,
 * runs the schema template into it and registers the centre — while the other
 * centres carry on taking bookings, and without a restart.
 */
router.post('/centres', async (req, res, next) => {
  const { slug, name, timezone, options } = req.body || {};

  try {
    const centre = await provision.create({
      slug: String(slug || '').trim().toLowerCase(),
      name: String(name || '').trim(),
      timezone: timezone ? String(timezone) : undefined,
      options: options && typeof options === 'object' ? options : {},
    });

    res.status(201).json({ centre });
  } catch (error) {
    if (error instanceof provision.AlreadyExists) {
      return res.status(409).json({ error: 'that centre already exists', slug: error.slug });
    }
    if (/not usable as a centre slug|needs a name/.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

/**
 * Changing what makes a centre different.
 *
 * The options are merged rather than replaced: a console that sends the whole
 * object back has to have read it first, and two administrators saving
 * different settings a minute apart would otherwise have the second undo the
 * first.
 */
router.patch('/centres/:slug', async (req, res, next) => {
  const { name, active, options } = req.body || {};

  try {
    const centre = await registry.bySlug(req.params.slug).catch((error) => {
      if (error instanceof registry.TenantSuspended) return null; // editable even so
      throw error;
    });

    const { rows } = await sharedPool().query(
      `UPDATE centres
          SET display_name = COALESCE($2, display_name),
              active       = COALESCE($3, active),
              options      = options || COALESCE($4::jsonb, '{}'::jsonb)
        WHERE slug = $1
      RETURNING slug, display_name, timezone, active, options`,
      [
        req.params.slug,
        name === undefined ? null : String(name),
        active === undefined ? null : Boolean(active),
        options === undefined ? null : JSON.stringify(options),
      ]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'no such centre' });
    res.json({ centre: rows[0], wasActive: centre ? centre.active : false });
  } catch (error) {
    if (error instanceof registry.UnknownTenant) {
      return res.status(404).json({ error: 'no such centre' });
    }
    next(error);
  }
});

/**
 * Removing one, and everything in it.
 *
 * Guarded by having to name the centre again in the body. A console with a
 * delete button next to a list is one misclick from removing a centre's entire
 * diary, and there is no undo behind this.
 */
router.delete('/centres/:slug', async (req, res, next) => {
  if (req.body?.confirm !== req.params.slug) {
    return res.status(400).json({
      error: 'to remove a centre, repeat its slug in the body as "confirm"',
    });
  }

  try {
    await provision.remove({ slug: req.params.slug });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
