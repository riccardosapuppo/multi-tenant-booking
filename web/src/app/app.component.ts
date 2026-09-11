import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { LogoComponent } from './shell/logo.component';
import { keepTitle } from './shell/title';

import { ApiService } from './shell/api.service';
import { SessionService } from './shell/session.service';

/**
 * One application, four jobs, and they have to LOOK like four jobs.
 *
 * The original had two deployments: a portal for patients and the desk, and a
 * separate console for whoever ran the platform. Separating them was right —
 * different jobs done by different people — but as two deployments it hid the
 * thing worth showing, which is that the boundary between them is a permission
 * and not a URL.
 *
 * Putting them in one application only makes that visible if signing in as
 * somebody else visibly changes the application. The first version of this
 * header did not: everyone got the same two links plus perhaps a third, the
 * role was a word inside the centre selector, and somebody signing out and
 * back in as an administrator could not tell from the screen that anything had
 * happened. That is the demonstration failing at the one thing it is for.
 *
 * So three things change with the role, all of them at once:
 *
 *   1. **The colour.** `data-role` on the shell swaps a small set of custom
 *      properties, and the header's rule, the active link and the badge follow
 *      it. Colour is the fastest signal there is and it costs no space.
 *   2. **The navigation.** Not the same links with some hidden: a patient has
 *      *My bookings*, staff have *the desk* and book on somebody's behalf, an
 *      administrator has the price list, and whoever runs the platform has
 *      centres and nothing else. Different sets, different labels for the same
 *      screen where the job is different.
 *   3. **Where you land.** Signing in puts a patient on the booking screen and
 *      staff on today's diary, because that is what each of them opened the
 *      application to do.
 *
 * The badge says the role at THIS centre, which is the only place a role
 * exists. Switch centre in the header and it changes — the same account is
 * staff at one and nothing at another.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LogoComponent],
  template: `
    <div class="shell" [attr.data-role]="role()">
      <header class="top">
        <div class="bar">
          <div class="brand">
            <app-logo [size]="32" />

            <!-- The centre is the headline and the product is the subscript,
                 which is the inversion this whole platform argues for: the
                 thing you are looking at is a place, and the software is what
                 it has in common with three others. Switching is the name
                 itself -- a real <select> laid over it, so it keeps the
                 keyboard and the screen reader that a menu of divs loses. -->
            @if (switchable().length > 1) {
              <label class="wordmark switchable">
                <strong>{{ session.centreName() ?? 'Choose a centre' }}<span class="chev" aria-hidden="true">⌄</span></strong>
                <span class="what">Booking platform</span>
                <select
                  [value]="session.centre() ?? ''"
                  (change)="switch($event)"
                  aria-label="Centre"
                >
                  @for (grant of switchable(); track grant.slug) {
                    <option [value]="grant.slug">{{ grant.name ?? grant.slug }}</option>
                  }
                </select>
              </label>
            } @else {
              <span class="wordmark">
                <!-- Whoever runs the platform belongs to no centre, so there is
                     no name to put on the large line and the product's own goes
                     there instead -- once. It used to read "Booking" above
                     "Booking platform", which is a word repeated because a
                     fallback was written without looking at what it sat above. -->
                <strong>{{ session.centreName() ?? 'Booking platform' }}</strong>
                @if (session.centreName()) {
                  <span class="what">Booking platform</span>
                }
              </span>
            }
          </div>

          @if (session.signedIn()) {
            <nav>
              @switch (role()) {
                @case ('patient') {
                  <a routerLink="/book" routerLinkActive="here">Book</a>
                  <a routerLink="/bookings" routerLinkActive="here">My bookings</a>
                }
                @case ('staff') {
                  <a routerLink="/desk" routerLinkActive="here">Desk</a>
                  <a routerLink="/book" routerLinkActive="here">Book for a patient</a>
                }
                @case ('centre_admin') {
                  <a routerLink="/desk" routerLinkActive="here">Desk</a>
                  <a routerLink="/prices" routerLinkActive="here">Price list</a>
                  <a routerLink="/book" routerLinkActive="here">Book for a patient</a>
                }
                @case ('platform_admin') {
                  <!-- Centres, and nothing else. Whoever runs the platform has
                       no centre, so every other screen here would open on the
                       word "none" — and the point of this account is that it
                       cannot read a booking. -->
                  <a routerLink="/console" routerLinkActive="here">Centres</a>
                }
              }
            </nav>

            <div class="who">
              <span class="badge" [attr.data-badge-role]="role()">{{ roleName() }}</span>
              <span class="name">{{ session.account()?.name }}</span>
              <button type="button" class="quiet" (click)="signOut()">Sign out</button>
            </div>
          } @else {
            <!-- A visitor may search without an account, so the header says so
                 rather than presenting a wall. Both ways in, and the one that
                 costs nothing first. -->
            <div class="who">
              <a class="guest" routerLink="/sign-in">Sign in</a>
              <a class="joinup" routerLink="/register">Create account</a>
            </div>
          }
        </div>
      </header>

      <main>
        <router-outlet />
      </main>

      <footer>
        <span>
          A demonstration. It reconstructs a production system I designed and
          developed; the original cannot be published, so this one was written
          from scratch. Every centre, patient and price in it is invented.
        </span>
        <span>
          Developed by
          <a
            href="https://github.com/riccardosapuppo"
            target="_blank"
            rel="noopener noreferrer"
            >Riccardo Sapuppo</a
          >
        </span>
      </footer>
    </div>
  `,
  styleUrl: './app.component.css',
})
export class AppComponent {
  readonly session = inject(SessionService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  readonly centres = computed(() => this.session.grants());

  /**
   * The centres the name in the header can be switched between.
   *
   * For somebody signed in these are their own: switching is moving between
   * places they belong to. A visitor belongs nowhere and was therefore given no
   * way back at all -- they chose a centre once, from a list they could not
   * return to, and the only way out was to clear the browser's storage. So for
   * them it is the public list, which is the same list they chose from.
   */
  readonly openCentres = signal<{ slug: string; name: string }[]>([]);

  readonly switchable = computed<{ slug: string; name?: string }[]>(() =>
    this.session.signedIn() ? this.session.grants() : this.openCentres()
  );

  constructor() {
    // The tab says which page and which centre, not just the product name.
    keepTitle();

    // Only for a visitor, and only once. Somebody signed in already has their
    // centres and asking the platform for the public list as well would be a
    // request whose answer is on screen.
    effect(() => {
      if (this.session.signedIn() || this.openCentres().length > 0) return;
      this.api.openCentres().subscribe({
        next: (answer) => this.openCentres.set(answer.centres),
        // A header that cannot offer the list is a header without a switcher,
        // which is where this started. Nothing to report to anybody.
        error: () => {},
      });
    });
  }

  /**
   * What this account is, right here.
   *
   * The platform administrator is deliberately not a fifth value of the same
   * thing: they hold no role at any centre, so `roleHere()` is null for them
   * and always would be. It is folded in here only because the header needs
   * one word for "who am I" — the permission checks never do this.
   */
  readonly role = computed<string | null>(() => {
    if (this.session.platformAdmin()) return 'platform_admin';
    return this.session.roleHere();
  });

  readonly roleName = computed(() => {
    switch (this.role()) {
      case 'patient':
        return 'Patient';
      case 'staff':
        return 'Staff';
      case 'centre_admin':
        return 'Centre administrator';
      case 'platform_admin':
        return 'Platform administrator';
      default:
        return 'No role here';
    }
  });

  switch(event: Event): void {
    const slug = (event.target as HTMLSelectElement).value;
    // The name the header shows comes from grants when there are any and from
    // the public list otherwise, so a visitor switching centre has to carry the
    // new name across or the header falls back to the slug.
    const said = this.openCentres().find((one) => one.slug === slug)?.name;
    if (said) this.session.visitingName.set(said);
    this.session.lookAt(slug || null);

    // Back to somewhere that certainly exists for the new centre. Staying on a
    // screen this person does not have here shows an empty page and a 403 in
    // the console — and the price list is the sharper case, because somebody
    // who administers one centre is often only staff at the next.
    const url = this.router.url;
    if (!this.session.canUseDesk() && url.startsWith('/desk')) this.router.navigate(['/book']);
    if (!this.session.canEditCentre() && url.startsWith('/prices')) this.router.navigate(['/desk']);
  }

  signOut(): void {
    this.api.signOut().subscribe({
      next: () => this.done(),
      // The token is dropped locally either way: a network error must not
      // leave somebody looking signed in when they have asked not to be.
      error: () => this.done(),
    });
  }

  private done(): void {
    this.session.end();
    this.router.navigate(['/sign-in']);
  }
}
