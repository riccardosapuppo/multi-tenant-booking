/**
 * The one thing about centres that is nobody's secret: which ones exist.
 *
 * A patient who has not signed in still has to say which centre they are
 * booking at, and until this route there was no way for them to find out. The
 * full list lives behind `platform_admin` and should stay there -- it carries
 * how many people work at each, and what each one is configured to do -- so
 * this is a second, smaller list: the name on the door and the slug that
 * addresses it, for the centres that are open.
 *
 * Deliberately outside the tenant middleware. Asking somebody to name a centre
 * before they may see the list of centres is the shape of question that has no
 * answer.
 */

'use strict';

const express = require('express');

const registry = require('./registry');

const router = express.Router();

router.get('/centres', async (req, res, next) => {
  try {
    const open = (await registry.all()).filter((centre) => centre.active);
    res.json({ centres: open.map((centre) => ({ slug: centre.slug, name: centre.name })) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
