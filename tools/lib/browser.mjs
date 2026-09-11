/**
 * Which browser these checks drive, and why it is not always the same one.
 *
 * On the machine this was written on the answer is Edge, already installed:
 * the README promises Docker and nothing else, and a check that makes somebody
 * download 300 MB of browser before it will tell them anything is a check they
 * run once. `playwright-core` drives what is already there.
 *
 * In continuous integration there is no Edge and nothing to protect: the
 * runner installs a browser, throws the machine away afterwards, and the
 * bundled Chromium is the one it installs. So the channel is a setting with a
 * sensible default rather than a constant, and CI sets it to empty.
 *
 * Empty and unset are deliberately different. Unset means "the local default";
 * empty means "whatever Playwright brought with it", which is not a channel at
 * all and has to reach `launch` as undefined rather than as ''.
 */
export function channel() {
  const asked = process.env.PLAYWRIGHT_CHANNEL;
  if (asked === undefined) return 'msedge';
  return asked.trim() === '' ? undefined : asked.trim();
}

/** The launch options these checks share. */
export function howToLaunch(extra = {}) {
  const chosen = channel();
  return chosen ? { channel: chosen, ...extra } : { ...extra };
}
