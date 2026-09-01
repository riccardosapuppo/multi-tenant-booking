import { Component, inject, signal } from '@angular/core';

import { ApiService, Booking } from '../shell/api.service';
import { SessionService } from '../shell/session.service';

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
  template: `
    <h1>My bookings</h1>
    <p class="lede">
      At <strong>{{ session.centre() }}</strong>. Switch centres in the header and this
      list changes with it — a booking made at one centre is not in the other's database.
    </p>

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
                <td><span class="tag">{{ booking.category }}</span></td>
                <td style="text-align: right">
                  @if (booking.status === 'cancelled') {
                    <span class="tag bad">cancelled</span>
                  } @else {
                    <button type="button" class="danger" (click)="cancel(booking)">Cancel</button>
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
  `,
})
export class MyBookingsComponent {
  private readonly api = inject(ApiService);
  readonly session = inject(SessionService);

  readonly bookings = signal<Booking[]>([]);
  readonly loading = signal(true);
  readonly problem = signal<string | null>(null);

  constructor() {
    this.load();
  }

  private load(): void {
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

  cancel(booking: Booking): void {
    this.api.cancel(booking.reference).subscribe({
      next: () => this.load(),
      error: () => this.problem.set('That could not be cancelled.'),
    });
  }

  names(booking: Booking): string {
    return (booking.exams ?? []).map((exam) => exam.name).join(', ') || '—';
  }

  when(iso: string): string {
    return new Date(iso).toLocaleString([], {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
