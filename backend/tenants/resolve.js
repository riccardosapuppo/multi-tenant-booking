/**
 * Which centre is this request for?
 *
 * One middleware, at the front, and after it every handler can read
 * `req.tenant` and nothing else has to think about it. Handlers that do their
 * own resolving are how two code paths end up disagreeing about who is asking.
 *
 * Three ways in, in this order:
 *
 *   1. `X-Centre` header — explicit, works from curl and from a test, and does
 *      not need DNS or a hosts file. The one the README uses.
 *   2. subdomain — `alpha.booking.example` is the centre `alpha`. What a real
 *      deployment uses, and why the demonstration keeps it.
 *   3. `?centre=` query parameter — for links somebody pastes into a chat.
 *
 * **If two of them are given and disagree, the request is refused.** Picking
 * one and carrying on is the failure worth designing against here: a header
 * saying one centre and a hostname saying another is either a
 * misconfiguration or an attempt, and a system that resolves the ambiguity
 * silently will one day write one centre's booking into another's database.
 *
 * The original passed the centre as an opaque identifier in a query parameter
 * with an abbreviated name, translated through a lookup. That is not what made
 * it safe — the identifier travelled in the URL, in logs and in browser
 * history like any other. Isolation comes from the register and the per-centre
 * database, so here the slug is plain and readable.
 */

'use strict';

const registry = require('./registry');

const HEADER = 'x-centre';
const PARAM = 'centre';

/** Hostnames that are the platform itself rather than a centre. */
const NOT_A_CENTRE = new Set(['www', 'api', 'admin', 'localhost', 'app']);

function fromHeader(req) {
  const value = req.get(HEADER);
  return value ? value.trim().toLowerCase() : null;
}

function fromQuery(req) {
  const value = req.query && req.query[PARAM];
  return typeof value === 'string' && value ? value.trim().toLowerCase() : null;
}

/**
 * The centre named by the hostname, if the hostname names one.
 *
 * Only when there is something in front of the registrable domain: on
 * `localhost` and on a bare domain there is no subdomain, and reading the
 * first label anyway turns `booking.example` into a centre called "booking".
 */
function fromHost(req) {
  const host = (req.hostname || '').toLowerCase();
  if (!host || host === 'localhost') return null;

  const labels = host.split('.');
  if (labels.length < 3) return null;

  const first = labels[0];
  return NOT_A_CENTRE.has(first) ? null : first;
}

class AmbiguousTenant extends Error {
  constructor(given) {
    super(`the request names more than one centre: ${given.join(', ')}`);
    this.name = 'AmbiguousTenant';
    this.given = given;
  }
}

/** What the request says, without deciding whether it is true. */
function askedFor(req) {
  const given = [fromHeader(req), fromHost(req), fromQuery(req)].filter(Boolean);
  if (given.length === 0) return null;

  const distinct = [...new Set(given)];
  if (distinct.length > 1) throw new AmbiguousTenant(distinct);
  return distinct[0];
}

/**
 * The middleware.
 *
 * `{ required: false }` for routes that exist before a centre is known — the
 * login page, the platform console, the health check.
 */
function resolveTenant({ required = true } = {}) {
  return async function resolve(req, res, next) {
    let slug;
    try {
      slug = askedFor(req);
    } catch (error) {
      if (error instanceof AmbiguousTenant) {
        return res.status(400).json({ error: 'ambiguous centre', given: error.given });
      }
      return next(error);
    }

    if (!slug) {
      if (!required) return next();
      return res.status(400).json({
        error: 'no centre given',
        hint: `send an X-Centre header, use a subdomain, or add ?${PARAM}=`,
      });
    }

    try {
      req.tenant = await registry.bySlug(slug);
      // Echoed back so a client can see which centre answered. Reading a reply
      // and guessing is how the wrong tab gets trusted.
      res.set('X-Centre', req.tenant.slug);
      return next();
    } catch (error) {
      if (error instanceof registry.UnknownTenant) {
        return res.status(404).json({ error: 'no such centre', centre: slug });
      }
      if (error instanceof registry.TenantSuspended) {
        return res.status(403).json({ error: 'centre suspended', centre: slug });
      }
      return next(error);
    }
  };
}

module.exports = { resolveTenant, askedFor, AmbiguousTenant, HEADER, PARAM };
