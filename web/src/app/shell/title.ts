import { effect, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

import { SessionService } from './session.service';

/**
 * The tab title, which was "Booking" on every page including the root.
 *
 * A tab reading "Booking" tells somebody with six tabs open nothing at all,
 * and on this application it leaves out the one thing that is always relevant:
 * which centre they are looking at. The same screen at two centres is two
 * different screens.
 *
 * So the title carries three things, narrowest first, because a tab is
 * truncated from the right:
 *
 *     Desk · northgate · Multi-Tenant Booking
 *
 * The page, then the centre, then the product. At 12 characters of tab width
 * that leaves "Desk · nor…", which is still the two facts that matter.
 */
const PRODUCT = 'Multi-Tenant Booking';

const PAGES: Record<string, string> = {
  '/book': 'Book an appointment',
  '/bookings': 'My bookings',
  '/desk': 'The desk',
  '/console': 'Centres',
  '/sign-in': 'Sign in',
};

export function keepTitle(): void {
  const router = inject(Router);
  const title = inject(Title);
  const session = inject(SessionService);

  const set = (url: string) => {
    const path = url.split('?')[0] ?? '';
    const page = PAGES[path];
    const centre = session.centre();

    // The centre is left out where it means nothing: on the sign-in page
    // nobody has one yet, and the platform console is about centres rather
    // than within one.
    const parts = [page, path === '/console' || path === '/sign-in' ? null : centre, PRODUCT];

    title.setTitle(parts.filter(Boolean).join(' · '));
  };

  router.events
    .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
    .subscribe((event) => set(event.urlAfterRedirects));

  // And on the centre, not only on navigation. Switching centre in the header
  // is not a navigation, so the tab kept the previous centre's name — which is
  // exactly the situation the centre is in the title for.
  effect(() => {
    session.centre();
    set(router.url);
  });

  set(router.url);
}
