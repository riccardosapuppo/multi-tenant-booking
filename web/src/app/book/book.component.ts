import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ApiService, Exam, SearchAnswer, SearchDay, Site } from '../shell/api.service';
import { SessionService } from '../shell/session.service';
import { clock, dayNumber, dayOfWeek, longDate, monthOf, yearOf } from '../shell/dates';

/**
 * Booking, in the shape the original asked the question.
 *
 * This is a deliberate reconstruction rather than a redesign, and the first
 * attempt at it was neither: three numbered cards with radio buttons and
 * dropdowns. Same data, different product — and the person whose system this
 * is recognises it from the screen, not from the schema.
 *
 * So the skeleton is the original's, and each part of it is there for a reason
 * that survives translation:
 *
 *   - **Panels that open one at a time, each with a tick once answered.** The
 *     questions are not equally interesting: which site and which day are
 *     usually "any", and burying them behind a closed panel with the answer on
 *     the header is what keeps the screen down to one decision at a time.
 *   - **"Add another exam".** People book a knee and a shoulder in one visit.
 *     Making that an explicit button, rather than a multi-select, is what tells
 *     somebody it is allowed — and the appointment that comes back is one
 *     appointment, not two.
 *   - **Preferences, not filters.** "Any day", "as soon as possible". They
 *     narrow what is offered and never mean "show nothing".
 *   - **Results as days.** A card per day with the date large and the price on
 *     it, and the times beside it. Nobody books a room; they book a morning.
 */
type Panel = 'site' | 'exams' | 'category' | 'day' | 'part' | null;

const WEEKDAYS = [
  { value: null as number | null, label: 'Any day' },
  { value: 0, label: 'Monday' },
  { value: 1, label: 'Tuesday' },
  { value: 2, label: 'Wednesday' },
  { value: 3, label: 'Thursday' },
  { value: 4, label: 'Friday' },
  { value: 5, label: 'Saturday' },
  { value: 6, label: 'Sunday' },
];

const PARTS = [
  { value: 'any', label: 'As soon as possible' },
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
];

const CATEGORIES = [
  { value: 'private', label: 'Private' },
  { value: 'health_service', label: 'National health service' },
  { value: 'exempt', label: 'Exempt' },
  { value: 'insured', label: 'Insured' },
];

@Component({
  selector: 'app-book',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="notice">
      Online booking at <strong>{{ session.centre() }}</strong> is for the exams listed
      below. Everything here — the centre, the prices, the people — is invented for the
      demonstration.
    </div>

    @if (booked()) {
      <section class="card done">
        <h2>Booked</h2>
        <p>
          <strong class="mono ref">{{ booked()!.reference }}</strong>
        </p>
        <p>{{ longDate(booked()!.starts_at) }} at {{ clock(booked()!.starts_at) }}</p>
        <button type="button" (click)="startAgain()">Book something else</button>
      </section>
    } @else {
      <!-- The panels. Closed shows the answer; open shows the question. -->
      <div class="panels">
        <section class="panel" [class.open]="panel() === 'site'">
          <button type="button" class="head" (click)="toggle('site')">
            <span class="tick" [class.set]="true">✓</span>
            <span class="label">Site: <strong>{{ siteName() }}</strong></span>
            <span class="chev">⌄</span>
          </button>
          @if (panel() === 'site') {
            <div class="body">
              <label class="choice">
                <input type="radio" name="site" [checked]="siteId() === null" (change)="pickSite(null)" />
                <span>Any site</span>
              </label>
              @for (site of sites(); track site.id) {
                <label class="choice">
                  <input type="radio" name="site" [checked]="siteId() === site.id" (change)="pickSite(site.id)" />
                  <span>{{ site.name }}<small>{{ site.address }}</small></span>
                </label>
              }
            </div>
          }
        </section>

        <section class="panel" [class.open]="panel() === 'exams'">
          <button type="button" class="head" (click)="toggle('exams')">
            <span class="tick" [class.set]="chosen().length > 0">{{ chosen().length > 0 ? '✓' : '·' }}</span>
            <span class="label">
              @if (chosen().length === 0) {
                Choose an exam or a visit from the list
              } @else {
                <strong>{{ chosen()[0]!.name }}</strong>
                @if (chosen().length > 1) {
                  <small>and {{ chosen().length - 1 }} more</small>
                }
              }
            </span>
            <span class="chev">⌄</span>
          </button>

          @if (chosen().length > 0 && panel() !== 'exams') {
            <div class="picked">
              @for (exam of chosen(); track exam.id) {
                <div class="one">
                  <span>{{ exam.name }}<small>{{ exam.minutes }} min · {{ money(exam.price_cents) }}</small></span>
                  <button type="button" class="link" (click)="remove(exam)">Remove</button>
                </div>
              }
              <button type="button" class="add" (click)="toggle('exams')">Add another exam ＋</button>
            </div>
          }

          @if (panel() === 'exams') {
            <div class="body">
              <input
                class="filter"
                placeholder="Type to narrow the list…"
                [value]="filter()"
                (input)="setFilter($event)"
              />
              <div class="list">
                @for (exam of visible(); track exam.id) {
                  <label class="choice">
                    <input type="checkbox" [checked]="isChosen(exam)" (change)="flip(exam)" />
                    <span>
                      {{ exam.name }}
                      <small>{{ exam.modality }} · {{ exam.minutes }} min · {{ money(exam.price_cents) }}</small>
                    </span>
                  </label>
                }
                @if (visible().length === 0) {
                  <p class="muted">Nothing here matches that.</p>
                }
              </div>
            </div>
          }
        </section>

        <section class="panel" [class.open]="panel() === 'category'">
          <button type="button" class="head" (click)="toggle('category')">
            <span class="tick set">✓</span>
            <span class="label">Paying as: <strong>{{ categoryLabel() }}</strong></span>
            <span class="chev">⌄</span>
          </button>
          @if (panel() === 'category') {
            <div class="body">
              @for (option of categories; track option.value) {
                <label class="choice">
                  <input
                    type="radio"
                    name="category"
                    [checked]="category() === option.value"
                    (change)="pickCategory(option.value)"
                  />
                  <span>{{ option.label }}</span>
                </label>
              }
              <p class="muted small">
                This changes the answer, not just the price: a session can be full for one
                category and open for another.
              </p>
            </div>
          }
        </section>

        <section class="panel" [class.open]="panel() === 'day'">
          <button type="button" class="head" (click)="toggle('day')">
            <span class="tick set">✓</span>
            <span class="label">Preferred day: <strong>{{ weekdayLabel() }}</strong></span>
            <span class="chev">⌄</span>
          </button>
          @if (panel() === 'day') {
            <div class="body">
              @for (option of weekdays; track option.label) {
                <label class="choice">
                  <input
                    type="radio"
                    name="weekday"
                    [checked]="weekday() === option.value"
                    (change)="pickWeekday(option.value)"
                  />
                  <span>{{ option.label }}</span>
                </label>
              }
            </div>
          }
        </section>

        <section class="panel" [class.open]="panel() === 'part'">
          <button type="button" class="head" (click)="toggle('part')">
            <span class="tick set">✓</span>
            <span class="label">When: <strong>{{ partLabel() }}</strong></span>
            <span class="chev">⌄</span>
          </button>
          @if (panel() === 'part') {
            <div class="body">
              @for (option of parts; track option.value) {
                <label class="choice">
                  <input
                    type="radio"
                    name="part"
                    [checked]="part() === option.value"
                    (change)="pickPart(option.value)"
                  />
                  <span>{{ option.label }}</span>
                </label>
              }
            </div>
          }
        </section>
      </div>

      <button class="search" type="button" [disabled]="chosen().length === 0 || searching()" (click)="find()">
        {{ searching() ? 'Searching…' : 'Search' }}
      </button>

      @if (answer(); as found) {
        @if (!found.ok) {
          <p class="note bad">
            @if (found.reason === 'no_room_does_all') {
              These exams cannot be done in one visit at this centre — no room performs all
              of them. Book them separately, or choose a different site.
            } @else if (found.reason === 'not_bookable_online') {
              {{ (found.exams ?? [])[0]?.name }} cannot be booked online. Please ring the
              centre.
            } @else {
              That exam is not offered here.
            }
          </p>
        } @else {
          <div class="results">
            <div class="regime">{{ categoryLabel() }} · {{ found.minutes }} minutes · {{ money(found.priceCents) }}</div>

            @for (day of found.days; track day.date) {
              <article class="day">
                <div class="when">
                  <p class="dow">{{ dayOfWeek(day.date) }}</p>
                  <p class="num">{{ dayNumber(day.date) }}</p>
                  <p class="mon">{{ monthOf(day.date) }}</p>
                  <p class="yr">{{ yearOf(day.date) }}</p>
                  <p class="price">{{ money(day.priceCents) }}</p>
                  <p class="with">WITH</p>
                  <p class="chip">{{ day.modality }}</p>
                  <p class="with">SITE</p>
                  <p class="site">{{ day.siteName }}</p>
                </div>
                <div class="times">
                  @for (time of day.times; track time) {
                    <button type="button" (click)="choose(day, time)" [disabled]="booking()">
                      {{ clock(time) }}
                    </button>
                  }
                </div>
              </article>
            }

            @if (found.days.length === 0) {
              <p class="note warn">
                Nothing free in the next three weeks with those preferences.
                @for (shut of found.closed; track shut.day) {
                  <br />{{ shut.day }}, {{ shut.opens }}–{{ shut.closes }}:
                  {{ shut.reason === 'category_full' ? 'the quota for this payment category is used up' : 'full' }}.
                }
              </p>
            }
          </div>
        }
      }

      @if (problem()) {
        <p class="note bad">{{ problem() }}</p>
      }
    }
  `,
  styleUrl: './book.component.css',
})
export class BookComponent {
  private readonly api = inject(ApiService);
  readonly session = inject(SessionService);

  readonly weekdays = WEEKDAYS;
  readonly parts = PARTS;
  readonly categories = CATEGORIES;

  readonly exams = signal<Exam[]>([]);
  readonly sites = signal<Site[]>([]);
  readonly chosen = signal<Exam[]>([]);
  readonly siteId = signal<number | null>(null);
  readonly category = signal('private');
  readonly weekday = signal<number | null>(null);
  readonly part = signal('any');
  readonly filter = signal('');

  readonly panel = signal<Panel>('exams');
  readonly searching = signal(false);
  readonly booking = signal(false);
  readonly answer = signal<SearchAnswer | null>(null);
  readonly problem = signal<string | null>(null);
  readonly booked = signal<{ reference: string; starts_at: string } | null>(null);

  readonly siteName = computed(() => {
    const id = this.siteId();
    if (id === null) return 'Any';
    return this.sites().find((site) => site.id === id)?.name ?? 'Any';
  });

  readonly categoryLabel = computed(
    () => CATEGORIES.find((one) => one.value === this.category())?.label ?? this.category()
  );
  readonly weekdayLabel = computed(
    () => WEEKDAYS.find((one) => one.value === this.weekday())?.label ?? 'Any day'
  );
  readonly partLabel = computed(
    () => PARTS.find((one) => one.value === this.part())?.label ?? 'As soon as possible'
  );

  readonly visible = computed(() => {
    const needle = this.filter().trim().toLowerCase();
    const all = this.exams();
    if (!needle) return all;
    return all.filter(
      (exam) =>
        exam.name.toLowerCase().includes(needle) || exam.modality.toLowerCase().includes(needle)
    );
  });

  constructor() {
    this.api.exams().subscribe({
      next: (answer) => this.exams.set(answer.exams),
      error: () => this.problem.set('Could not read this centre’s list of exams.'),
    });
    this.api.sites().subscribe({ next: (answer) => this.sites.set(answer.sites) });
  }

  toggle(which: Exclude<Panel, null>): void {
    this.panel.set(this.panel() === which ? null : which);
  }

  setFilter(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
  }

  isChosen(exam: Exam): boolean {
    return this.chosen().some((one) => one.id === exam.id);
  }

  flip(exam: Exam): void {
    this.answer.set(null);
    this.chosen.set(
      this.isChosen(exam)
        ? this.chosen().filter((one) => one.id !== exam.id)
        : [...this.chosen(), exam]
    );
  }

  remove(exam: Exam): void {
    this.answer.set(null);
    this.chosen.set(this.chosen().filter((one) => one.id !== exam.id));
  }

  pickSite(id: number | null): void {
    this.siteId.set(id);
    this.answer.set(null);
    this.panel.set(null);
  }

  pickCategory(value: string): void {
    this.category.set(value);
    this.answer.set(null);
    this.panel.set(null);
  }

  pickWeekday(value: number | null): void {
    this.weekday.set(value);
    this.answer.set(null);
    this.panel.set(null);
  }

  pickPart(value: string): void {
    this.part.set(value);
    this.answer.set(null);
    this.panel.set(null);
  }

  find(): void {
    if (this.chosen().length === 0) return;

    this.searching.set(true);
    this.problem.set(null);
    this.panel.set(null);

    this.api
      .search({
        examIds: this.chosen().map((exam) => exam.id),
        category: this.category(),
        siteId: this.siteId(),
        weekday: this.weekday(),
        part: this.part(),
      })
      .subscribe({
        next: (found) => {
          this.searching.set(false);
          this.answer.set(found);
        },
        error: () => {
          this.searching.set(false);
          this.problem.set('The search did not go through.');
        },
      });
  }

  choose(day: SearchDay, time: string): void {
    this.booking.set(true);
    this.problem.set(null);

    this.api
      .book({
        roomId: day.roomId,
        startsAt: time,
        examIds: this.chosen().map((exam) => exam.id),
        patientName: this.session.account()?.name ?? 'Demo Patient',
        category: this.category(),
      })
      .subscribe({
        next: (made) => {
          this.booking.set(false);
          this.booked.set(made.booking);
        },
        error: (error) => {
          this.booking.set(false);
          if (error.status === 409) {
            this.problem.set('That time has just been taken. These are the times still free.');
            this.find();
          } else {
            this.problem.set('The booking did not go through.');
          }
        },
      });
  }

  startAgain(): void {
    this.booked.set(null);
    this.answer.set(null);
    this.chosen.set([]);
    this.panel.set('exams');
  }

  money(cents: number): string {
    return `€${(cents / 100).toFixed(2)}`;
  }

  // One locale for the whole interface: see shell/dates.ts.
  readonly clock = clock;
  readonly dayOfWeek = dayOfWeek;
  readonly dayNumber = dayNumber;
  readonly monthOf = monthOf;
  readonly yearOf = yearOf;
  readonly longDate = longDate;
}
