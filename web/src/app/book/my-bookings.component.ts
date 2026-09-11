import { Component, computed, effect, inject, signal } from '@angular/core';

import { ApiService, Booking } from '../shell/api.service';
import { SessionService } from '../shell/session.service';
import { shortWhen } from '../shell/dates';
import { AreYouSureComponent } from '../shell/are-you-sure.component';

/**
 * What this person has booked, at the centre they are looking at.
 *
 * "At the centre they are looking at" is the whole demonstration on one page:
 * the same account, the same token, a different centre in the header, and the
 * list is empty. Nothing was filtered out — the other centre's bookings are in
 * another database and were never fetched.
 */
@Component({
  selector: 'app-my-bookings',
  standalone: true,
  imports: [AreYouSureComponent],
  template: `
    <h1>My bookings</h1>
    <p class="lede">
      At <strong>{{ session.centreName() }}</strong>. A booking made at one centre is not
      in another's database, so this list is this centre's.
    </p>

    <!-- And where the others are.
         Signing out gives up the chosen centre on purpose, so the next person
         at the same machine does not land in somebody else's; signing back in
         lands on the first centre the account belongs to. Somebody who booked
         at the other one then met an empty list, which is indistinguishable
         from a lost booking until something says otherwise. -->
    @for (other of elsewhere(); track other.slug) {
      <p class="note">
        {{ other.upcoming }}
        {{ other.upcoming === 1 ? 'appointment' : 'appointments' }} at
        <strong>{{ other.name }}</strong>.
        <button type="button" class="quiet" (click)="goTo(other.slug, other.name)">
          Look there
        </button>
      </p>
    }

    @if (loading()) {
      <p class="muted">Reading…</p>
    } @else if (bookings().length === 0) {
      <div class="card">
        <p class="muted" style="margin: 0">Nothing booked here.</p>
      </div>
    } @else {
      <div class="card">
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>When</th>
              <th>What</th>
              <th>Category</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (booking of bookings(); track booking.reference) {
              <tr>
                <td class="mono">{{ booking.reference }}</td>
                <td>{{ when(booking.starts_at) }}</td>
                <td>
                  {{ names(booking) }}
                  <div class="muted">{{ booking.site_name }} · {{ booking.room_name }}</div>
                </td>
                <td><span class="tag">{{ label(booking.category) }}</span></td>
                <td style="text-align: right">
                  @if (booking.status === 'cancelled') {
                    <span class="tag bad">cancelled</span>
                  } @else {
                    <button type="button" class="danger" (click)="ask(booking)">Cancel</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    @if (problem()) {
      <p class="note bad" style="margin-top: 1rem">{{ problem() }}</p>
    }
    <app-are-you-sure
      [open]="cancelling() !== null"
      [working]="working()"
      title="Cancel this appointment?"
      [detail]="askingAbout()"
      confirmLabel="Cancel the appointment"
      keepLabel="Keep it"
      (confirmed)="cancel()"
      (dismissed)="cancelling.set(null)"
    />
  `,
})
export class MyBookingsComponent {
  private readonly api = inject(ApiService);
  readonly session = inject(SessionService);

  readonly bookings = signal<Booking[]>([]);
  readonly counts = signal<{ slug: string; name: string; upcoming: number | null }[]>([]);
  readonly loading = signal(true);
  readonly problem = signal<string | null>(null);

  constructor() {
    // Reloaded whenever the centre in the header changes, not once at
    // construction. Without this the list stays as it was: switch centres
    // and you are looking at the previous one’s bookings under the new
    // one’s name — which reads as the isolation being broken when it is
    // the screen that has not caught up.
    effect(() => {
      this.session.centre();
      this.load();
    });
  }

  private load(): void {
    // Asked alongside the list rather than only when it is empty: knowing there
    // are two waiting at the other centre is useful whether or not there are
    // any here.
    this.api.myBookingCounts().subscribe({
      next: (answer) => this.counts.set(answer.centres),
      error: () => this.counts.set([]),
    });

    this.loading.set(true);
    this.api.myBookings().subscribe({
      next: (answer) => {
        this.bookings.set(answer.bookings);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.problem.set('Could not read your bookings here.');
      },
    });
  }

  /** Asked first. A cancelled appointment is a time given back to somebody
   *  else, and there is no button that returns it. */
  readonly cancelling = signal<Booking | null>(null);
  readonly working = signal(false);

  ask(booking: Booking): void {
    this.cancelling.set(booking);
  }

  /**
   * What the question is about, named.
   *
   * "Are you sure?" on its own asks somebody to remember which row they
   * pressed, and the row is behind a backdrop by then.
   */
  readonly askingAbout = computed(() => {
    const held = this.cancelling();
    if (!held) return '';
    return (
      `${held.patient_name}, ${held.reference}. ` +
      'The time goes back to whoever asks for it next, and there is no button that returns it.'
    );
  });

  /** The account's other centres that have something waiting. */
  readonly elsewhere = computed(() =>
    this.counts().filter((one) => one.slug !== this.session.centre() && (one.upcoming ?? 0) > 0)
  );

  goTo(slug: string, name: string): void {
    this.session.visitingName.set(name);
    this.session.lookAt(slug);
  }

  cancel(): void {
    const booking = this.cancelling();
    if (!booking) return;

    this.working.set(true);
    this.api.cancel(booking.reference).subscribe({
      next: () => {
        this.working.set(false);
        this.cancelling.set(null);
        this.load();
      },
      error: () => {
        this.working.set(false);
        this.cancelling.set(null);
        this.problem.set('That could not be cancelled.');
      },
    });
  }

  /** The same words the rest of the interface uses. The column was showing
   * the database value, so a patient read "health_service" under a heading
   * that said Category. */
  label(key: string): string {
    return ({ exempt: 'Exempt', health_service: 'Health service', private: 'Private', insured: 'Insured' })[key] ?? key;
  }

  names(booking: Booking): string {
    return (booking.exams ?? []).map((exam) => exam.name).join(', ') || '—';
  }

  readonly when = shortWhen;
}
