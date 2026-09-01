import { Component, inject, signal } from '@angular/core';

import { ApiService, Booking } from '../shell/api.service';
import { SessionService } from '../shell/session.service';

/**
 * The desk: one day, one centre, everything in it.
 *
 * Behind a role at this centre, which is why the link to it appears and
 * disappears as the centre in the header changes. The same person is staff at
 * Northgate and Riverside and nothing at Lakeside, and that is visible rather
 * than described.
 *
 * The totals by payment category are here because they are the number the
 * desk is actually watching: quotas are per category, so "eleven booked" is
 * less use than "four exempt, six on the health service, one private".
 */
@Component({
  selector: 'app-desk',
  standalone: true,
  template: `
    <h1>The desk</h1>
    <p class="lede">
      <strong>{{ session.centre() }}</strong>, and only this centre. You are
      <span class="tag ok">{{ session.roleHere() }}</span> here.
    </p>

    <div class="card" style="margin-bottom: 1rem">
      <div class="spread">
        <label class="row">
          <span class="muted">Day</span>
          <input type="date" style="width: auto" [value]="day()" (change)="pick($event)" />
        </label>

        <div class="row">
          @for (entry of counted(); track entry[0]) {
            <span class="tag" [class.ok]="entry[1] > 0">{{ label(entry[0]) }}: {{ entry[1] }}</span>
          }
        </div>
      </div>
    </div>

    @if (loading()) {
      <p class="muted">Reading the diary…</p>
    } @else if (bookings().length === 0) {
      <div class="card"><p class="muted" style="margin: 0">Nothing booked on this day.</p></div>
    } @else {
      <div class="card">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Room</th>
              <th>Patient</th>
              <th>Category</th>
              <th>Reference</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (booking of bookings(); track booking.reference) {
              <tr>
                <td class="mono">{{ clock(booking.starts_at) }}–{{ clock(booking.ends_at) }}</td>
                <td>{{ booking.room_name }}</td>
                <td>{{ booking.patient_name }}</td>
                <td><span class="tag">{{ booking.category }}</span></td>
                <td class="mono">{{ booking.reference }}</td>
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
export class DeskComponent {
  private readonly api = inject(ApiService);
  readonly session = inject(SessionService);

  readonly day = signal(new Date().toISOString().slice(0, 10));
  readonly bookings = signal<Booking[]>([]);
  readonly counted = signal<Array<[string, number]>>([]);
  readonly loading = signal(true);
  readonly problem = signal<string | null>(null);

  constructor() {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.problem.set(null);

    this.api.diary(this.day()).subscribe({
      next: (answer) => {
        this.bookings.set(answer.bookings);
        this.counted.set(Object.entries(answer.totals));
        this.loading.set(false);
      },
      error: (error) => {
        this.loading.set(false);
        this.problem.set(
          error.status === 403
            ? 'You do not work at this centre.'
            : 'The diary could not be read.'
        );
      },
    });
  }

  pick(event: Event): void {
    this.day.set((event.target as HTMLInputElement).value);
    this.load();
  }

  cancel(booking: Booking): void {
    this.api.cancel(booking.reference).subscribe({
      next: () => this.load(),
      error: () => this.problem.set('That could not be cancelled.'),
    });
  }

  label(key: string): string {
    return { exempt: 'Exempt', health_service: 'Health service', private: 'Private', insured: 'Insured' }[key] ?? key;
  }

  clock(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}
