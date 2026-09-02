import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { ApiService } from '../shell/api.service';
import { SessionService } from '../shell/session.service';

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
  imports: [FormsModule],
  template: `
    <h1>Sign in</h1>
    <p class="lede">
      One account, every centre. What you may do is decided per centre — which is
      what the four accounts below are for.
    </p>

    <div class="grid-2">
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
      sees: 'The desk at Northgate and Riverside — and nothing at Lakeside',
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
    if (this.session.platformAdmin()) return '/console';
    return this.session.canUseDesk() ? '/desk' : '/book';
  }
}
