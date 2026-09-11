import { Component, computed, effect, inject, signal } from '@angular/core';

import { ApiService, Booking } from '../shell/api.service';
import { SessionService } from '../shell/session.service';
import { clock, longDate, today } from '../shell/dates';
import { AreYouSureComponent } from '../shell/are-you-sure.component';

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
  imports: [AreYouSureComponent],
  template: `
    <h1>The desk</h1>
    <p class="lede">
      Every appointment at <strong>{{ session.centreName() }}</strong> on one day, whoever
      booked it — online, or here at the desk. This centre and no other: you are
      <span class="tag ok">{{ session.roleHere() }}</span> here.
    </p>

    <!-- The other question a desk is asked all day.
         The diary answers "who is coming this morning". It cannot answer
         "somebody is on the telephone saying WCY-HXX", and until this box the
         only way was to guess dates -- which is how a booking made for next
         Thursday looks like a booking that was never made. -->
    <div class="card" style="margin-bottom: 1rem">
      <!-- The DOM submit event, not ngSubmit: that one needs FormsModule, and
           without it Angular binds a custom event of that name which nothing
           ever fires. The button worked, silently, on nothing. -->
      <form class="spread" (submit)="find($event)">
        <label class="row" style="flex: 1; min-width: 0">
          <span class="muted">Find</span>
          <input
            style="flex: 1; min-width: 0"
            placeholder="A reference, or a patient's name — any day"
            [value]="wanted()"
            (input)="typed($event)"
          />
        </label>
        <button type="submit" class="quiet" [disabled]="wanted().trim().length < 2">Find</button>
      </form>

      @if (found() !== null) {
        @if (found()!.length === 0) {
          <p class="muted" style="margin: 0.7rem 0 0">
            Nothing here matches “{{ searched() }}”. A reference is matched whole; a name
            can be a fragment.
          </p>
        } @else {
          <table style="margin-top: 0.7rem">
            <thead>
              <tr>
                <th>Day</th>
                <th>Time</th>
                <th>Patient</th>
                <th>Reference</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (hit of found(); track hit.reference) {
                <tr>
                  <td>{{ longDate(hit.starts_at) }}</td>
                  <td class="mono">{{ clock(hit.starts_at) }}</td>
                  <td>
                    {{ hit.patient_name }}
                    <!-- The diary shows who is coming; this shows what happened.
                         A search that hid cancelled ones could not answer the
                         question a desk actually asks about a reference. -->
                    @if (hit.status === 'cancelled') {
                      <span class="tag warn">Cancelled</span>
                    }
                  </td>
                  <td class="mono">{{ hit.reference }}</td>
                  <td>
                    <button type="button" class="quiet" (click)="goTo(hit.starts_at)">
                      Open that day
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      }
    </div>

    <div class="card" style="margin-bottom: 1rem">
      <div class="spread">
        <label class="row">
          <span class="muted">Day</span>
          <input type="date" style="width: auto" [value]="day()" (change)="pick($event)" />
        </label>

        @if (day()) {
          <button type="button" class="quiet" (click)="showEveryDay()">All days</button>
        }

        <label class="row">
          <input type="checkbox" [checked]="withPast()" (change)="togglePast($event)" />
          <span class="muted">Include past</span>
        </label>

        <!-- A morning with a gap in it and no reason for the gap is its own
             small mystery, and the desk is where somebody has to answer it. -->
        <label class="row">
          <input
            type="checkbox"
            [checked]="withCancelled()"
            (change)="toggleCancelled($event)"
          />
          <span class="muted">Show cancelled</span>
        </label>

        <div class="row">
          <span class="muted">Booked this day, by who pays:</span>
          @for (entry of counted(); track entry[0]) {
            <span class="tag" [class.ok]="entry[1] > 0">{{ label(entry[0]) }}: {{ entry[1] }}</span>
          }
        </div>
      </div>

      <!-- Where the appointments actually are.
           The diary shows one day, and somebody who does not know which day is
           reduced to guessing at a date picker: a booking made for next
           Thursday looks like a booking that was never made. Find answers that
           when you have a name or a reference; this answers it when you have
           neither. -->
      @if (busy().length > 0) {
        <div class="row" style="margin-top: 0.8rem; flex-wrap: wrap; gap: 0.35rem">
          <span class="muted">Days with appointments:</span>
          @for (entry of busy(); track entry.day) {
            <button
              type="button"
              class="tag"
              [class.ok]="entry.day === day()"
              style="cursor: pointer; border: 1px solid var(--line)"
              (click)="openDay(entry.day)"
            >
              {{ shortDay(entry.day) }} · {{ entry.booked }}
            </button>
          }
        </div>
      }
    </div>

    @if (total() > 0) {
      <p class="muted" style="margin: 0 0 0.6rem">
        <!-- "on this day, from today" is two answers to one question: a day
             that has been chosen is not also a range starting now. -->
        {{ total() }}
        {{ total() === 1 ? 'appointment' : 'appointments' }}{{ said() }}.
      </p>
    }

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
                <td>
                  {{ booking.patient_name }}
                  @if (booking.status === 'cancelled') {
                    <span class="tag warn">Cancelled</span>
                  }
                </td>
                <td><span class="tag">{{ label(booking.category) }}</span></td>
                <td class="mono">{{ booking.reference }}</td>
                <td style="text-align: right">
                  @if (booking.status === 'cancelled') {
                    <span class="tag bad">cancelled</span>
                  } @else {
                    @if (booking.status !== 'cancelled') {
                      <button type="button" class="danger" (click)="ask(booking)">Cancel</button>
                    }
                  }
                </td>
              </tr>
            }
          </tbody>
      </table>

        <!-- A page at a time, and the numbers say which page of how many. Next
             and Previous alone leave somebody walking a list whose length they
             cannot see. -->
        @if (pages() > 1) {
          <div class="spread" style="margin-top: 0.9rem">
            <button type="button" class="quiet" [disabled]="page() <= 1" (click)="goToPage(page() - 1)">
              Previous
            </button>
            <span class="muted">Page {{ page() }} of {{ pages() }}</span>
            <button type="button" class="quiet" [disabled]="page() >= pages()" (click)="goToPage(page() + 1)">
              Next
            </button>
          </div>
        }
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
export class DeskComponent {
  private readonly api = inject(ApiService);
  readonly session = inject(SessionService);

  /**
   * The day, and it is empty on purpose.
   *
   * The desk opened on today and showed nothing else, so every appointment that
   * was not today was invisible and the only way to disagree was to guess at a
   * date picker. It opens on everything from today forward now, and the day is
   * a filter somebody chooses rather than a question they have to answer first.
   */
  readonly day = signal('');
  readonly page = signal(1);
  readonly pages = signal(1);
  readonly total = signal(0);
  readonly withPast = signal(false);
  readonly bookings = signal<Booking[]>([]);
  readonly counted = signal<Array<[string, number]>>([]);
  readonly loading = signal(true);
  readonly problem = signal<string | null>(null);

  constructor() {
    // The diary follows the centre in the header. See the note in
    // my-bookings.component.ts: loading once at construction leaves one
    // centre’s appointments on screen under another centre’s name.
    effect(() => {
      this.session.centre();
      this.load();
    });
  }

  private load(): void {
    this.loading.set(true);
    this.problem.set(null);

    this.api.busyDays().subscribe({ next: (answer) => this.busy.set(answer.days), error: () => {} });

    this.api
      .deskBookings({
        day: this.day(),
        past: this.withPast(),
        cancelled: this.withCancelled(),
        page: this.page(),
      })
      .subscribe({
      next: (answer) => {
        this.bookings.set(answer.bookings);
        this.counted.set(Object.entries(answer.totals));
        this.total.set(answer.total);
        this.pages.set(answer.pages);
        this.page.set(answer.page);
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

  /** What the count is counting, in the words that fit the filter chosen. */
  readonly said = computed(() => {
    if (this.day()) return ' on this day';
    return this.withPast() ? '' : ', from today';
  });

  /** Every control that changes what is being asked for starts at page one. */
  private fromTheTop(): void {
    this.page.set(1);
    this.load();
  }

  goToPage(at: number): void {
    this.page.set(Math.min(Math.max(at, 1), this.pages()));
    this.load();
  }

  showEveryDay(): void {
    this.day.set('');
    this.fromTheTop();
  }

  togglePast(event: Event): void {
    this.withPast.set((event.target as HTMLInputElement).checked);
    this.fromTheTop();
  }

  pick(event: Event): void {
    this.day.set((event.target as HTMLInputElement).value);
    this.fromTheTop();
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

  label(key: string): string {
    return { exempt: 'Exempt', health_service: 'Health service', private: 'Private', insured: 'Insured' }[key] ?? key;
  }

  readonly clock = clock;
  readonly longDate = longDate;

  /** What is being looked for, what was looked for, and what came back. */
  /** The days that have anybody on them, so the diary is not a guessing game. */
  readonly busy = signal<{ day: string; booked: number }[]>([]);

  openDay(day: string): void {
    this.day.set(day);
    this.found.set(null);
    this.fromTheTop();
  }

  /** "Thu 17" — enough to recognise, short enough to sit in a row of them. */
  shortDay(day: string): string {
    return new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
    });
  }

  /** Whether the day is showing what was cancelled as well as who is coming. */
  readonly withCancelled = signal(false);

  toggleCancelled(event: Event): void {
    this.withCancelled.set((event.target as HTMLInputElement).checked);
    this.fromTheTop();
  }

  readonly wanted = signal('');
  readonly searched = signal('');
  readonly found = signal<any[] | null>(null);

  typed(event: Event): void {
    this.wanted.set((event.target as HTMLInputElement).value);
    // A box that still shows last search's answers while somebody types the
    // next question is a box that answers the wrong one.
    if (this.found() !== null) this.found.set(null);
  }

  find(event?: Event): void {
    event?.preventDefault();
    const asking = this.wanted().trim();
    if (asking.length < 2) return;

    this.searched.set(asking);
    this.api.findBooking(asking).subscribe({
      next: (answer) => this.found.set(answer.bookings),
      error: () => this.found.set([]),
    });
  }

  /** From a result to the day it is on, which is the diary this screen shows. */
  goTo(startsAt: string): void {
    this.day.set(new Date(startsAt).toISOString().slice(0, 10));
    this.found.set(null);
    this.wanted.set('');
    this.load();
  }
}
