import { Component, computed, inject } from '@angular/core';
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
            <app-logo [size]="30" />
            <span class="wordmark">
              <strong>Booking</strong>
              <!-- The centre, in the identity. On a platform where the same code
                   serves several of them, which one you are in is not a setting
                   tucked away in a menu. -->
              <span>{{ session.centre() ?? 'no centre' }}</span>
            </span>
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

              @if (centres().length > 0) {
                <label class="centre">
                  <span class="label">Centre</span>
                  <select [value]="session.centre() ?? ''" (change)="switch($event)">
                    @for (grant of centres(); track grant.slug) {
                      <option [value]="grant.slug">{{ grant.slug }}</option>
                    }
                  </select>
                </label>
              }
              <span class="name">{{ session.account()?.name }}</span>
              <button type="button" class="quiet" (click)="signOut()">Sign out</button>
            </div>
          }
        </div>
      </header>

      <main>
        <router-outlet />
      </main>

      <footer>
        <span>A demonstration. Every centre, patient and price in it is invented.</span>
        <span>Developed by Riccardo Sapuppo</span>
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

  constructor() {
    // The tab says which page and which centre, not just the product name.
    keepTitle();
  }

  switch(event: Event): void {
    const slug = (event.target as HTMLSelectElement).value;
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
