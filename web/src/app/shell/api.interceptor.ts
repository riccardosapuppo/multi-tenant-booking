import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { SessionService } from './session.service';

/**
 * Puts the token and the centre on every request that needs them.
 *
 * In one place rather than at each call. A screen that builds its own headers
 * is a screen that will one day be pointed at the centre somebody was looking
 * at five minutes ago — and the request would succeed, which is worse than
 * failing.
 *
 * The platform console is the exception and gets no centre header: it is about
 * centres rather than within one, and sending a centre with those calls would
 * be meaningless at best.
 */
export const centreAndToken: HttpInterceptorFn = (request, next) => {
  const session = inject(SessionService);

  const headers: Record<string, string> = {};

  const token = session.token();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const centre = session.centre();
  if (centre && request.url.startsWith('/api/centre')) headers['X-Centre'] = centre;

  return next(Object.keys(headers).length ? request.clone({ setHeaders: headers }) : request);
};
