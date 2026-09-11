#!/usr/bin/env node
/**
 * Starts the demonstration and opens it, on the page it starts from.
 *
 *     npm start
 *     npm start -- --no-open        leave the browser alone
 *     WEB_PORT=4300 npm start       the ports the compose file already honours
 *
 * `docker compose up --build` was the whole instruction, and the README then
 * asked the reader to open an address by hand. That is one step too many, and
 * it is the step where a first start goes wrong: the compose output does not
 * end, so there is no moment that says "now", and opening too early shows the
 * sign-in page of an API that has not finished creating the register.
 *
 * So this waits for the thing that actually settles last. `/api/health` answers
 * 503 until the shared register exists and the centres are in it, and 200 with
 * their count afterwards; the web container has to be answering as well, since
 * that is where the browser is sent. Both, and only then the browser.
 *
 * And it does not start asking until compose says it has attached. The first
 * version asked straight away, and on a machine where the containers were
 * already up from an earlier run it answered in zero seconds and opened the
 * browser on the instance that `--build` was in the middle of replacing. The
 * ports say "something is answering"; only compose knows whether it is the
 * something this command started.
 *
 * Compose keeps the foreground. Its bytes are passed through untouched - piped
 * rather than inherited only so that one line can be read out of them - and
 * Ctrl+C reaches it, so `npm start` stops the way it always did.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';

const WEB_PORT = process.env.WEB_PORT ?? '4200';
const API_PORT = process.env.API_PORT ?? '3000';
const SITE = `http://localhost:${WEB_PORT}`;
const HEALTH = `http://localhost:${API_PORT}/api/health`;

const open = !process.argv.includes('--no-open');

/**
 * One request, one socket, closed before this returns.
 *
 * `fetch` keeps its connections alive for reuse, and one still open when the
 * process exits aborts inside libuv on Windows instead of returning an exit
 * code. `agent: false` leaves nothing behind to close.
 */
function ask(url) {
  return new Promise((resolve) => {
    const request = http.get(url, { agent: false }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.setTimeout(2000, () => request.destroy());
    request.on('error', () => resolve(undefined));
  });
}

/** Whatever this machine calls "open this address". */
function openInBrowser(url) {
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];

  // Detached and unwatched: the browser outlives this process, and a machine
  // without a browser to open must not take the demonstration down with it.
  //
  // The outcome arrives late, and that is the whole reason this is not a
  // boolean any more. `spawn` does not throw when the command is missing -- it
  // emits `error` on the next turn of the loop -- so the try/catch that used to
  // be here caught nothing and the function returned true whatever happened.
  // The one line it existed to guard, the one that names the address when no
  // browser opened, could never print. On a machine with no browser the reader
  // was told one was opening and then watched nothing happen.
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', (wrong) => {
    console.log(`  No browser opened here (${wrong.code ?? wrong.message}). ${url} is waiting.`);
  });
  child.unref();
}

const compose = spawn('docker', ['compose', 'up', '--build'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
});

/* Compose prints this once, after the containers are up and before their logs
   start. It is the only moment in the whole output that means "from here on,
   what answers is mine". */
let attached = false;
const watch = (chunk) => {
  process.stdout.write(chunk);
  if (!attached && /Attaching to/.test(String(chunk))) attached = true;
};
compose.stdout.on('data', watch);
compose.stderr.on('data', watch);

let over = false;
compose.on('close', (code, signal) => {
  over = true;
  process.exit(code ?? (signal ? 1 : 0));
});

/* The first build pulls images and compiles two containers, so the wait is
   minutes rather than seconds on a cold machine. It ends when the API says the
   register is there, not when a port opens. */
(async () => {
  const started = Date.now();
  const deadline = started + 15 * 60 * 1000;

  while (!over && Date.now() < deadline) {
    if (!attached) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }

    const health = await ask(HEALTH);
    const site = health?.status === 200 ? await ask(`${SITE}/`) : undefined;

    if (site && site.status < 400) {
      let centres = '';
      try {
        centres = ` ${JSON.parse(health.body).centres} centres,`;
      } catch {
        // The count is a courtesy; its absence is not a reason to wait longer.
      }
      const seconds = Math.round((Date.now() - started) / 1000);
      console.log('');
      console.log(`  Ready in ${seconds}s:${centres} the interface is on ${SITE}`);
      console.log(open ? `  Opening it. Ctrl+C stops everything.` : `  Ctrl+C stops everything.`);
      console.log('');
      if (open) openInBrowser(SITE);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  if (!over) {
    console.log('');
    console.log(`  Still not answering on ${HEALTH} after 15 minutes.`);
    console.log('  Compose is left running: its output above says what it is doing.');
    console.log('');
  }
})();
