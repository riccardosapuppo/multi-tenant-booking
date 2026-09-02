import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { LogoComponent } from './shell/logo.component';
import { keepTitle } from './shell/title';

import { ApiService } from './shell/api.service';
import { SessionService } from './shell/session.service';

/**
 * One application, three jobs.
 *
 * The original had two of these: a portal for patients and the desk, and a
 * separate console for whoever ran the platform. Separating them was right —
 * they are different jobs done by different people — but as two deployments it
 * hid the thing worth showing, which is that the boundary between them is a
 * permission and not a URL.
 *
 * So: one application, and the navigation below is built from what the signed-
 * in account may actually do. A patient sees two links. Somebody who is staff
 * at one centre and nothing at another sees the desk appear and disappear as
 * they switch centres, which is the clearest way to say what "a role is always
 * at a centre" means.
 *
 * The centre selector is in the header rather than on a settings page for the
 * same reason: which centre you are looking at is not a preference, it is half
 * of every question the interface asks.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LogoComponent],
  template: `
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
          <!-- Only for somebody who belongs to a centre. The platform
               administrator belongs to none, and offering them a booking page
               that can only say "no centre given" is an interface promising
               something it knows it cannot do. -->
          @if (centres().length > 0) {
            <a routerLink="/book" routerLinkActive="here">Book</a>
            <a routerLink="/bookings" routerLinkActive="here">My bookings</a>
          }
          @if (session.canUseDesk()) {
            <a routerLink="/desk" routerLinkActive="here">Desk</a>
          }
          @if (session.platformAdmin()) {
            <a routerLink="/console" routerLinkActive="here">Centres</a>
          }
        </nav>

        <div class="who">
          @if (centres().length > 0) {
            <label class="centre">
              <span class="label">Centre</span>
              <select [value]="session.centre() ?? ''" (change)="switch($event)">
                @for (grant of centres(); track grant.slug) {
                  <option [value]="grant.slug">{{ grant.slug }} — {{ grant.role }}</option>
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
  `,
  styleUrl: './app.component.css',
})
export class AppComponent {
  readonly session = inject(SessionService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  readonly centres = computed(() => this.session.grants());

  constructor() {
    // The tab says which page and which centre, not just the product name.
    keepTitle();
  }

  switch(event: Event): void {
    const slug = (event.target as HTMLSelectElement).value;
    this.session.lookAt(slug || null);

    // Back to somewhere that certainly exists for the new centre. Staying on
    // the desk after switching to a centre where this person is a patient
    // would show an empty page and a 403 in the console.
    if (!this.session.canUseDesk() && this.router.url.startsWith('/desk')) {
      this.router.navigate(['/book']);
    }
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
