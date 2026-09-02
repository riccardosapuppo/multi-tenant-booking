/**
 * The API, and the order things are mounted in.
 *
 * The order is the design. Reading down this file tells you what has been
 * decided by the time a handler runs:
 *
 *   identify        who is asking, if anybody. Never refuses.
 *   /api/auth       signing in. No centre yet — there cannot be one.
 *   /api/platform   about centres. Behind platform_admin, no tenant resolved.
 *   /api/centres/:  within one centre. The tenant resolver runs first, so
 *                   every handler below it has req.tenant and permission
 *                   checks have something to check against.
 *
 * A route that needs a centre and is mounted outside that last group would
 * fail a permission check loudly rather than quietly passing it — access.js
 * refuses to run without a tenant, on purpose.
 */

'use strict';

const express = require('express');

const access = require('./auth/access');
const authRoutes = require('./auth/routes');
const bookingRoutes = require('./booking/routes');
const centreRoutes = require('./centre/routes');
const platformRoutes = require('./platform/routes');
const { resolveTenant } = require('./tenants/resolve');
const { sharedPool, closeAll } = require('./db/pools');

function build() {
  const api = express();

  api.disable('x-powered-by');
  api.use(express.json({ limit: '100kb' }));

  /**
   * The front door, for somebody who typed the API's port into a browser.
   *
   * That is not a mistake worth punishing: the README gives curl examples
   * against this port, and going to look at it is the obvious next thing. It
   * used to answer `{"error":"no such endpoint"}`, which is true, unhelpful,
   * and reads like something is broken.
   *
   * So it says what this is, where the interface is, and one call that works —
   * because the useful thing to know at that moment is that you are one port
   * away from the thing you wanted.
   */
  api.get('/', (req, res) => {
    res.json({
      this_is: 'the booking API',
      the_interface_is_at: `http://localhost:${process.env.WEB_PORT || 4200}`,
      health: '/api/health',
      try: {
        'a centre’s price list': "curl -H 'X-Centre: northgate' <this>/api/centre/exams",
        'the same, by query': '<this>/api/centre/exams?centre=riverside',
        'a suspended centre': "curl -H 'X-Centre: lakeside' <this>/api/centre/exams",
      },
      note: 'Every call below /api/centre needs to know which centre it is for.',
    });
  });

  api.get('/api/health', async (req, res) => {
    try {
      const { rows } = await sharedPool().query('SELECT count(*)::int AS centres FROM centres');
      res.json({ status: 'ok', centres: rows[0].centres });
    } catch (error) {
      res.status(503).json({ status: 'starting', detail: error.message });
    }
  });

  api.use(access.identify());

  api.use('/api/auth', authRoutes);
  api.use('/api/platform', platformRoutes);

  // Everything from here needs to know which centre. The resolver reads the
  // header, the subdomain or the query parameter, and refuses when two of them
  // disagree.
  const withinCentre = express.Router();
  withinCentre.use(resolveTenant());
  withinCentre.use(bookingRoutes);
  withinCentre.use('/desk', centreRoutes);

  api.use('/api/centre', withinCentre);

  // A 404 that says where to look. The path is echoed back because the common
  // reason for landing here is a missing /api prefix or the interface's own
  // port, and seeing what the server actually received settles both.
  api.use((req, res) => {
    res.status(404).json({
      error: 'no such endpoint',
      you_asked_for: `${req.method} ${req.originalUrl}`,
      the_api_starts_at: '/api',
      the_interface_is_at: `http://localhost:${process.env.WEB_PORT || 4200}`,
    });
  });

  // Last, and with four arguments, or Express treats it as a handler. Every
  // unexpected error becomes one line out and one shape in: a stack trace in a
  // response body is a map of the application.
  api.use((error, req, res, next) => {
    console.error('unhandled:', error.message);
    if (res.headersSent) return next(error);
    res.status(500).json({ error: 'something went wrong here' });
  });

  return api;
}

async function start() {
  const port = Number(process.env.PORT || 3000);
  const api = build();

  const server = api.listen(port, () => {
    console.log(`booking api on http://localhost:${port}`);
  });

  const stop = async () => {
    server.close();
    await closeAll();
    process.exit(0);
  };

  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  return server;
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { build, start };
