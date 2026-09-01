import { inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApiService } from './api.service';
import { SessionService } from './session.service';

/**
 * Checks a token found in storage, before the first route is decided.
 *
 * This runs as an application initialiser rather than in a component, and the
 * order is the whole point: the router's guards ask what this account may do,
 * and they must not be asked before the answer exists. Doing it in the root
 * component instead leaves the guards waiting on a request that the component
 * has not made yet, which is a deadlock rather than a bounce — worse than the
 * bug it was meant to fix.
 *
 * A token that turns out to be no good is dropped quietly. It has expired, or
 * an administrator has ended the session — sessions here are rows, so that is
 * a thing that can happen — and neither is something the person needs an error
 * about. They need the sign-in page, and the guards send them there.
 */
export function restoreSession(): Promise<void> {
  const session = inject(SessionService);
  const api = inject(ApiService);

  const token = session.token();
  if (!token) return Promise.resolve();

  return firstValueFrom(api.me())
    .then((answer) => {
      session.begin(token, answer.user, answer.centres, answer.platformAdmin);
    })
    .catch(() => {
      session.stale();
    });
}
