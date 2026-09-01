import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ApiService, Availability, Exam, Room } from '../shell/api.service';
import { SessionService } from '../shell/session.service';

/**
 * Booking, in the order somebody actually decides things.
 *
 * What, then where, then who is paying, then when. The payment category is
 * asked before the times and not after, because it changes the answer: the
 * same morning is open for a private patient and full for an exempt one, and
 * an interface that offers times first has to take them away again.
 *
 * When a session is closed for the chosen category the API says so, and this
 * says so too. "No times available" sends somebody to the telephone; "the
 * morning is full for exempt patients" tells them to try the afternoon or
 * change the category, which is a question they can answer themselves.
 */
@Component({
  selector: 'app-book',
  standalone: true,
  imports: [FormsModule],
  template: `
    <h1>Book an appointment</h1>
    <p class="lede">
      At <strong>{{ session.centre() }}</strong>. Prices, rooms and opening hours all
      belong to this centre — switch centres in the header and everything below changes.
    </p>

    @if (done()) {
      <div class="card">
        <h2>Booked</h2>
        <p>
          Your reference is <strong class="mono">{{ done()!.reference }}</strong>.
          {{ formatWhen(done()!.starts_at) }}.
        </p>
        <button type="button" (click)="startAgain()">Book something else</button>
      </div>
    } @else {
      <div class="cards">
        <section class="card">
          <h2>1 &nbsp;What do you need?</h2>
          @if (exams().length === 0) {
            <p class="muted">This centre has nothing bookable online yet.</p>
          }
          <div class="grid-2">
            @for (exam of exams(); track exam.id) {
              <label class="row" style="align-items: flex-start; gap: 0.5rem">
                <input
                  type="radio"
                  name="exam"
                  style="width: auto; margin-top: 0.3rem"
                  [checked]="exam.id === chosenExam()?.id"
                  (change)="chooseExam(exam)"
                />
                <span>
                  <strong>{{ exam.name }}</strong><br />
                  <span class="muted">
                    {{ exam.minutes }} minutes · {{ money(exam.price_cents) }}
                  </span>
                </span>
              </label>
            }
          </div>
        </section>

        @if (chosenExam()) {
          <section class="card">
            <h2>2 &nbsp;Where, and who is paying?</h2>
            <div class="grid-2">
              <label class="field">
                <span>Room</span>
                <select [value]="chosenRoom()?.id ?? ''" (change)="chooseRoom($event)">
                  @for (room of rooms(); track room.id) {
                    <option [value]="room.id">{{ room.site_name }} — {{ room.name }}</option>
                  }
                </select>
              </label>

              <label class="field">
                <span>Payment category</span>
                <select [value]="category()" (change)="chooseCategory($event)">
                  <option value="private">Private</option>
                  <option value="health_service">National health service</option>
                  <option value="exempt">Exempt</option>
                  <option value="insured">Insured</option>
                </select>
              </label>

              <label class="field">
                <span>Day</span>
                <input type="date" [value]="day()" (change)="chooseDay($event)" />
              </label>

              <label class="field">
                <span>Patient name</span>
                <input [(ngModel)]="patientName" name="patient" />
              </label>
            </div>
          </section>

          <section class="card">
            <h2>3 &nbsp;When?</h2>

            @if (loadingTimes()) {
              <p class="muted">Looking…</p>
            } @else {
              @if (times().length > 0) {
                <div class="times">
                  @for (time of times(); track time) {
                    <button
                      type="button"
                      [class.picked]="time === chosenTime()"
                      (click)="chooseTime(time)"
                    >
                      {{ clock(time) }}
                    </button>
                  }
                </div>
              } @else {
                <p class="muted">Nothing free on this day.</p>
              }

              @for (shut of closed(); track shut.session) {
                <p class="note warn" style="margin-top: 0.8rem">
                  {{ shut.opens }}–{{ shut.closes }}:
                  {{
                    shut.reason === 'category_full'
                      ? 'the quota for this payment category is used up. Another category, or another day, may be open.'
                      : 'this session is full.'
                  }}
                </p>
              }
            }
          </section>

          @if (chosenTime()) {
            <section class="card spread">
              <div>
                <strong>{{ chosenExam()!.name }}</strong>, {{ formatWhen(chosenTime()!) }}<br />
                <span class="muted">
                  {{ chosenRoom()?.site_name }} · {{ money(chosenExam()!.price_cents) }} ·
                  {{ categoryName() }}
                </span>
              </div>
              <button type="button" [disabled]="booking()" (click)="confirm()">
                {{ booking() ? 'Booking…' : 'Confirm' }}
              </button>
            </section>
          }
        }
      </div>

      @if (problem()) {
        <p class="note bad" style="margin-top: 1rem">{{ problem() }}</p>
      }
    }
  `,
})
export class BookComponent {
  private readonly api = inject(ApiService);
  readonly session = inject(SessionService);

  readonly exams = signal<Exam[]>([]);
  readonly rooms = signal<Room[]>([]);
  readonly chosenExam = signal<Exam | null>(null);
  readonly chosenRoom = signal<Room | null>(null);
  readonly category = signal('private');
  readonly day = signal(inAWeek());
  readonly times = signal<string[]>([]);
  readonly closed = signal<Availability['closed']>([]);
  readonly loadingTimes = signal(false);
  readonly chosenTime = signal<string | null>(null);
  readonly booking = signal(false);
  readonly problem = signal<string | null>(null);
  readonly done = signal<{ reference: string; starts_at: string } | null>(null);

  patientName = '';

  readonly categoryName = computed(
    () =>
      ({
        private: 'Private',
        health_service: 'National health service',
        exempt: 'Exempt',
        insured: 'Insured',
      })[this.category()] ?? this.category()
  );

  constructor() {
    this.patientName = this.session.account()?.name ?? '';
    this.load();
  }

  private load(): void {
    this.api.exams().subscribe({
      next: (answer) => this.exams.set(answer.exams),
      error: () => this.problem.set('Could not read this centre’s price list.'),
    });
  }

  chooseExam(exam: Exam): void {
    this.chosenExam.set(exam);
    this.chosenTime.set(null);
    this.api.rooms(exam.id).subscribe({
      next: (answer) => {
        this.rooms.set(answer.rooms);
        this.chosenRoom.set(answer.rooms[0] ?? null);
        this.lookForTimes();
      },
    });
  }

  chooseRoom(event: Event): void {
    const id = Number((event.target as HTMLSelectElement).value);
    this.chosenRoom.set(this.rooms().find((room) => room.id === id) ?? null);
    this.lookForTimes();
  }

  chooseCategory(event: Event): void {
    this.category.set((event.target as HTMLSelectElement).value);
    this.lookForTimes();
  }

  chooseDay(event: Event): void {
    this.day.set((event.target as HTMLInputElement).value);
    this.lookForTimes();
  }

  chooseTime(time: string): void {
    this.chosenTime.set(time);
  }

  private lookForTimes(): void {
    const exam = this.chosenExam();
    const room = this.chosenRoom();
    if (!exam || !room) return;

    this.loadingTimes.set(true);
    this.chosenTime.set(null);

    this.api.availability(room.id, exam.id, this.category(), this.day()).subscribe({
      next: (answer) => {
        this.loadingTimes.set(false);
        this.times.set(answer.times);
        this.closed.set(answer.closed);
      },
      error: () => {
        this.loadingTimes.set(false);
        this.times.set([]);
        this.problem.set('Could not read the diary.');
      },
    });
  }

  confirm(): void {
    const exam = this.chosenExam();
    const room = this.chosenRoom();
    const time = this.chosenTime();
    if (!exam || !room || !time) return;

    this.booking.set(true);
    this.problem.set(null);

    this.api
      .book({
        roomId: room.id,
        startsAt: time,
        examIds: [exam.id],
        patientName: this.patientName.trim() || (this.session.account()?.name ?? 'Demo Patient'),
        category: this.category(),
      })
      .subscribe({
        next: (answer) => {
          this.booking.set(false);
          this.done.set(answer.booking);
        },
        error: (error) => {
          this.booking.set(false);
          // 409 is somebody else taking it between the offer and the answer.
          // It is nobody's fault and the times are refreshed rather than the
          // caller being left looking at one that has gone.
          this.problem.set(
            error.status === 409
              ? 'That time has just been taken. These are the times still free.'
              : 'The booking did not go through.'
          );
          if (error.status === 409) this.lookForTimes();
        },
      });
  }

  startAgain(): void {
    this.done.set(null);
    this.chosenTime.set(null);
    this.lookForTimes();
  }

  money(cents: number): string {
    return `€${(cents / 100).toFixed(2)}`;
  }

  clock(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  formatWhen(iso: string): string {
    return new Date(iso).toLocaleString([], {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}

function inAWeek(): string {
  const day = new Date();
  day.setDate(day.getDate() + 7);
  return day.toISOString().slice(0, 10);
}
