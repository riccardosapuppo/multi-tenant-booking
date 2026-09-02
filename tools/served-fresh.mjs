#!/usr/bin/env node
/**
 * What the web server hands a browser, and whether it can go stale.
 *
 *     npm run check:serving
 *     npm run check:serving -- http://localhost:4200
 *
 * This exists because of a fault that wasted more time than any bug in the
 * application: opening the site returned a build from weeks ago — an old page,
 * calling an API that had moved on, showing "no such endpoint" — and only
 * Ctrl+F5 got past it. Twice it was diagnosed as a caching header and twice
 * that was wrong.
 *
 * It was two faults, and neither was in any code the application runs:
 *
 *   1. An earlier version of this project installed an Angular service worker.
 *      A service worker outlives the build that registered it. It stays
 *      attached to the ORIGIN, is reached BEFORE the network, and serves its
 *      own precached copy of the site — so no `Cache-Control` the server sends
 *      can dislodge it. `localhost:4200` is the address every project uses in
 *      turn, which makes this everybody's problem and not this project's.
 *
 *   2. The way a browser gives up on a dead worker is by re-fetching its files
 *      and finding them gone. `try_files $uri $uri/ /index.html` answered
 *      `/ngsw.json` with `200` and a page of HTML. The worker asked whether it
 *      was out of date, was handed a document instead of an answer, could not
 *      read it, and carried on serving the old site indefinitely.
 *
 * So the rule this checks is one line: **a request that names a file and does
 * not find one is a 404, never the application.** It is worth keeping for its
 * own sake — a missing script delivered as HTML fails much later, somewhere
 * else, as a syntax error on line 1 that says nothing about a missing file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || process.env.BOOKING_WEB || 'http://localhost:4200';

let failures = 0;

function expect(what, condition, detail) {
  if (condition) {
    console.log(`  ok    ${what}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${what}`);
    if (detail) console.log(`        ${detail}`);
  }
}

async function head(where) {
  const response = await fetch(`${BASE}${where}`, { redirect: 'manual' });
  const body = await response.text();
  return {
    status: response.status,
    type: response.headers.get('content-type') ?? '',
    cache: response.headers.get('cache-control') ?? '',
    etag: response.headers.get('etag'),
    modified: response.headers.get('last-modified'),
    body,
  };
}

console.log(`Checking what ${BASE} serves\n`);

try {
  // -------------------------------------------------------------- the page
  console.log('The page itself');

  const page = await head('/');
  expect('the application answers', page.status === 200, `got ${page.status}`);
  expect(
    'and is never stored',
    /no-store/.test(page.cache),
    `Cache-Control: ${page.cache || '(none)'}`
  );
  expect(
    'with nothing to revalidate an old copy against',
    !page.etag && !page.modified,
    `ETag: ${page.etag}, Last-Modified: ${page.modified}`
  );

  // ------------------------------------------------------- files that are gone
  console.log('\nA file that is not there');

  for (const missing of [
    ['/ngsw.json', 'the old service worker’s manifest'],
    ['/ngsw-worker.js', 'the old service worker itself'],
    ['/chunk-THIS-WAS-NEVER-BUILT.js', 'a script from a build that no longer exists'],
    ['/assets/nothing-here.woff2', 'a font that was renamed'],
  ]) {
    const [where, what] = missing;
    const answer = await head(where);
    expect(
      `${what} is a 404, not a page`,
      answer.status === 404 && !/^\s*<!doctype html/i.test(answer.body),
      `${where} answered ${answer.status} ${answer.type}`
    );
  }

  // ------------------------------------------------------------- real routes
  console.log('\nA route, which is not a file');

  for (const route of ['/sign-in', '/book', '/desk', '/prices', '/console']) {
    const answer = await head(route);
    expect(
      `${route} is the application`,
      answer.status === 200 && /<app-root>/.test(answer.body),
      `got ${answer.status} ${answer.type}`
    );
  }

  // ----------------------------------------------- and the worker is evicted
  console.log('\nAnd anything left over is cleared out');

  expect(
    'the page unregisters any service worker on this origin',
    /serviceWorker/.test(page.body) && /unregister/.test(page.body),
    'the page as served carries no eviction script — a worker from another ' +
      'project on this port would keep serving its own site'
  );

  // The built page and the source have to agree, or this passes against a
  // container that was never rebuilt from the file that was edited.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.join(here, '..', 'web', 'src', 'index.html'), 'utf8');
  expect(
    'and what is served was built from the index.html in this tree',
    /unregister/.test(source) === /unregister/.test(page.body),
    'the container is serving an older index.html than the one in the repository'
  );

  console.log('');
  if (failures > 0) {
    console.log(`${failures} checks failed.`);
    process.exitCode = 1;
  } else {
    console.log('Nothing here can hand somebody yesterday’s application.');
  }
} catch (error) {
  console.error(`\nThe check could not run: ${error.message.split('\n')[0]}`);
  console.error(`Is the stack up? ${BASE} did not answer.`);
  process.exitCode = 1;
}
