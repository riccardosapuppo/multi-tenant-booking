import { inject } from '@angular/core';
import { Router, Routes, UrlTree } from '@angular/router';

import { SessionService } from './shell/session.service';

/**
 * The routes, and three guards.
 *
 * The guards are courtesy, not security. They keep somebody from landing on a
 * page that would only refuse them; every screen behind them is useless
 * without the API, and the API checks for itself. A guard that was the only
 * check would be a permission system a reader can edit in their browser.
 *
 * All three await `session.ready` first. Without it they run while a token
 * found in storage is still being checked, decide on an account that has not
 * arrived yet, and bounce somebody out of a session they have. That happened
 * twice here in two different shapes — signed out by refreshing the page, and
 * then a platform administrator sent from /console to the booking screen —
 * and both were found by taking a screenshot rather than by a test.
 */
async function decide(
  check: (session: SessionService) => boolean,
  otherwise: string
): Promise<true | UrlTree> {
  const session = inject(SessionService);
  const router = inject(Router);

  await session.ready;

  return check(session) ? true : router.createUrlTree([otherwise]);
}

const signedIn = () => decide((session) => session.signedIn(), '/sign-in');

/** Belongs to at least one centre. The platform administrator does not. */
const atACentre = () =>
  decide((session) => session.grants().length > 0, '/console');

const atTheDesk = () => decide((session) => session.canUseDesk(), '/book');
const runsThePlatform = () => decide((session) => session.platformAdmin(), '/book');

/**
 * Runs THIS centre. Sends staff to the desk rather than to the booking screen:
 * being refused a page is less confusing when you land on the one you do have.
 */
const runsTheCentre = () => decide((session) => session.canEditCentre(), '/desk');

export const ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'book' },
  {
    path: 'sign-in',
    loadComponent: () => import('./auth/sign-in.component').then((m) => m.SignInComponent),
  },
  {
    path: 'book',
    canActivate: [signedIn, atACentre],
    loadComponent: () => import('./book/book.component').then((m) => m.BookComponent),
  },
  {
    path: 'bookings',
    canActivate: [signedIn, atACentre],
    loadComponent: () => import('./book/my-bookings.component').then((m) => m.MyBookingsComponent),
  },
  {
    path: 'desk',
    canActivate: [signedIn, atTheDesk],
    loadComponent: () => import('./desk/desk.component').then((m) => m.DeskComponent),
  },
  {
    path: 'prices',
    canActivate: [signedIn, runsTheCentre],
    loadComponent: () => import('./centre/prices.component').then((m) => m.PricesComponent),
  },
  {
    path: 'console',
    canActivate: [signedIn, runsThePlatform],
    loadComponent: () => import('./console/console.component').then((m) => m.ConsoleComponent),
  },
  { path: '**', redirectTo: 'book' },
];
