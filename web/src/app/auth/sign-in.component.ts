import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { ApiService } from '../shell/api.service';
import { SessionService } from '../shell/session.service';
import { PendingService } from '../shell/pending';
import { HeldComponent } from '../shell/held.component';

/**
 * Signing in, with the demonstration accounts on the page.
 *
 * Putting them here is the point rather than a shortcut. This project is about
 * a permission boundary, and a boundary you cannot stand on both sides of is a
 * claim. Four accounts, one click each: the difference between them is the
 * whole demonstration, and asking a reader to type four passwords from a
 * README is asking them to see one.
 *
 * They open a database that is created empty on the reader's own machine and
 * thrown away with the container.
 */
@Component({
  selector: 'app-sign-in',
  standalone: true,
  imports: [FormsModule, HeldComponent],
  template: `
    <h1>Sign in</h1>
    <p class="lede">
      One account, every centre. What you may do is decided per centre, and the
      four accounts below show it.
    </p>

    <div class="grid-2">
      <app-held />

      <form class="card" (ngSubmit)="submit()">
        <div class="field">
          <label>
            <span>Email</span>
            <input name="email" type="email" [(ngModel)]="email" autocomplete="username" required />
          </label>
        </div>

        <div class="field">
          <label>
            <span>Password</span>
            <input
              name="password"
              type="password"
              [(ngModel)]="password"
              autocomplete="current-password"
              required
            />
          </label>
        </div>

        @if (problem()) {
          <p class="note bad">{{ problem() }}</p>
        }

        <button type="submit" [disabled]="working()">
          {{ working() ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>

      <div class="card">
        <h2>Demonstration accounts</h2>
        <p class="muted">
          Pick one to fill the form. Each sees a different application, from the same
          code and the same login.
        </p>

        @for (account of accounts; track account.email) {
          <div class="spread" style="padding: 0.55rem 0; border-bottom: 1px solid var(--line)">
            <div>
              <div><strong>{{ account.what }}</strong></div>
              <div class="muted">{{ account.sees }}</div>
            </div>
            <button type="button" class="quiet" (click)="use(account)">Use</button>
          </div>
        }
      </div>
    </div>
  `,
})
export class SignInComponent {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly pending = inject(PendingService);

  email = '';
  password = '';

  readonly working = signal(false);
  readonly problem = signal<string | null>(null);

  readonly accounts = [
    {
      what: 'Patient',
      email: 'patient@example.invalid',
      password: 'patient-demo-1234',
      sees: 'Books at either centre, sees only their own bookings',
    },
    {
      what: 'Staff',
      email: 'staff@example.invalid',
      password: 'staff-demo-1234',
      sees: 'The desk at Northgate and Riverside, nothing at Lakeside',
    },
    {
      what: 'Centre administrator',
      email: 'admin@example.invalid',
      password: 'centre-admin-demo-1234',
      sees: 'Northgate’s desk, and may change its price list',
    },
    {
      what: 'Platform administrator',
      email: 'platform@example.invalid',
      password: 'platform-admin-demo-1234',
      sees: 'Creates centres — and cannot read a single patient booking',
    },
  ];

  use(account: { email: string; password: string }): void {
    this.email = account.email;
    this.password = account.password;
    this.problem.set(null);
  }

  submit(): void {
    if (!this.email || !this.password) return;

    this.working.set(true);
    this.problem.set(null);

    this.api.signIn(this.email, this.password).subscribe({
      next: (answer) => {
        this.working.set(false);
        this.session.begin(answer.token, answer.user, answer.centres, answer.platformAdmin);
        this.router.navigate([this.landing()]);
      },
      error: (error) => {
        this.working.set(false);
        this.problem.set(
          error.status === 401 ? 'Those details are not right.' : 'The service is not answering.'
        );
      },
    });
  }

  /**
   * The first screen, chosen by what this person came here to do.
   *
   * Everybody used to land on the booking screen, which made signing in as
   * four different accounts look like signing in as one. Staff do not open
   * this to book themselves an appointment: they open it because somebody is
   * standing at the desk. Sending each role to its own work is the plainest
   * way the difference between them shows.
   */
  private landing(): string {
    // Unless they were in the middle of booking.
    //
    // Somebody who picked a time as a visitor and pressed "I already have one"
    // came here to finish that, not to be shown the work their role usually
    // does. Signing in as staff sent them to the desk with the appointment
    // abandoned behind them, and the desk case is the one worth keeping: staff
    // booking for the person in front of them is exactly what the confirmation
    // asks for, and it asks for the name because of it.
    //
    // Two accounts cannot finish it and are sent to their own work with the
    // choice dropped rather than left to surface later: whoever runs the
    // platform, who belongs to no centre, and anybody with no role at the
    // centre the time was picked at -- their booking would be refused by the
    // API, which is a worse way to find out.
    const held = this.pending.slot();

    if (held && !this.session.platformAdmin()) {
      const may = this.session.grants().some((grant) => grant.slug === held.centre);
      if (may) return '/book';
    }

    if (held) this.pending.drop();

    if (this.session.platformAdmin()) return '/console';
    return this.session.canUseDesk() ? '/desk' : '/book';
  }
}
