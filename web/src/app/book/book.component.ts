import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { ApiService, Exam, SearchAnswer, SearchDay, Site } from '../shell/api.service';
import { SessionService } from '../shell/session.service';
import { PendingService, PickedSlot } from '../shell/pending';
import { clock, longDate } from '../shell/dates';
import { ResultsComponent } from './results.component';
import { ConfirmComponent } from './confirm.component';
import { CentrePickerComponent } from '../shell/centre-picker.component';
import { IconComponent } from '../shell/icon.component';

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
  imports: [FormsModule, ResultsComponent, ConfirmComponent, CentrePickerComponent, IconComponent],
  template: `
    @if (!session.centre()) {
      <!-- The first question on a platform serving several centres, and until
           now nobody without an account was allowed to be asked it. -->
<app-centre-picker [heading]="askHeading()" [blurb]="askWhy()" />
    } @else {
    <div class="notice">
      Online booking at <strong>{{ session.centreName() }}</strong> is for the exams listed
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
            <app-icon name="site" class="badge" />
            <span class="tick" [class.set]="true">✓</span>
            <span class="said">Site: <strong>{{ siteSaid() }}</strong></span>
            <span class="chev">⌄</span>
          </button>
          @if (panel() === 'site') {
            <div class="body">
              <!-- What is in each building, next to its name. A list of
                   addresses cannot answer "which one should I go to"; these are
                   separate buildings with different machines, and the scanner
                   is in one of them. -->
              <label class="choice">
                <input type="radio" name="site" [checked]="siteId() === null" (change)="pickSite(null)" />
                <span>
                  Any of them
                  <small>Whichever can do it soonest. This is usually what you want.</small>
                </span>
              </label>
              @for (site of sites(); track site.id) {
                <label class="choice">
                  <input type="radio" name="site" [checked]="siteId() === site.id" (change)="pickSite(site.id)" />
                  <span>
                    {{ site.name }}
                    <small>{{ machinesAt(site) }} · {{ site.address }}</small>
                  </span>
                </label>
              }
            </div>
          }
        </section>

        <section class="panel" [class.open]="panel() === 'exams'">
          <button type="button" class="head" (click)="toggle('exams')">
            <app-icon name="exams" class="badge" />
            <span class="tick" [class.set]="chosen().length > 0">{{ chosen().length > 0 ? '✓' : '·' }}</span>
            <span class="said">
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
                  <!-- The ones that cannot be booked online are here, and are
                       not selectable. Leaving them out of the list made it a
                       lie in the direction that wastes an afternoon: somebody
                       looking for a CT with contrast concluded this centre does
                       not do it, when what is true is that a doctor has to
                       approve the dose and it is booked by telephone. -->
                  <label class="choice" [class.by-phone]="!exam.bookable">
                    <input
                      type="checkbox"
                      [checked]="isChosen(exam)"
                      [disabled]="!exam.bookable"
                      (change)="flip(exam)"
                    />
                    <span>
                      {{ exam.name }}
                      <small>{{ exam.modality }} · {{ exam.minutes }} min · {{ money(exam.price_cents) }}</small>
                      @if (!exam.bookable) {
                        <small class="ring">
                          Not bookable online. {{ exam.notes }} Ring the centre and they will
                          arrange it.
                        </small>
                      }
                    </span>
                  </label>
                }
                @if (visible().length === 0) {
                  <!-- Two different emptinesses. "Nothing matches that" is about
                       what was typed; a centre with nothing bookable online is
                       about the centre, and saying the first when it is the
                       second sends somebody back to a filter they never used. -->
                  @if (exams().length === 0) {
                    <p class="muted">
                      This centre has nothing bookable online yet. Its desk takes bookings
                      by telephone.
                    </p>
                  } @else {
                    <p class="muted">Nothing here matches that.</p>
                  }
                }
              </div>
            </div>
          }
        </section>

        <section class="panel" [class.open]="panel() === 'category'">
          <button type="button" class="head" (click)="toggle('category')">
            <app-icon name="paying" class="badge" />
            <span class="tick set">✓</span>
            <span class="said">Paying as: <strong>{{ categoryLabel() }}</strong></span>
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
            <app-icon name="day" class="badge" />
            <span class="tick set">✓</span>
            <span class="said">Preferred day: <strong>{{ weekdayLabel() }}</strong></span>
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
            <app-icon name="when" class="badge" />
            <span class="tick set">✓</span>
            <span class="said">When: <strong>{{ partLabel() }}</strong></span>
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
        <app-icon name="search" [size]="19" />
        {{ searching() ? 'Searching…' : 'Search' }}
      </button>

      @if (problem()) {
        <p class="note bad">{{ problem() }}</p>
      }
    }

    <!-- The answer, over the question that asked for it. The search has a long
         preamble, and showing the times underneath starts them below the fold
         on a laptop — so every refinement scrolls you away from the thing you
         are refining. -->
    <app-results
      [open]="showing()"
      [answer]="answer()"
      [title]="chosenNames()"
      [howMany]="chosen().length"
      [atOneSite]="siteId() !== null"
      [terms]="terms()"
      (closed)="showing.set(false)"
      (chosen)="choose($event.day, $event.time)"
    />

    <!-- Nothing is booked until this is agreed to. -->
    <app-confirm
      [open]="confirming()"
      [slot]="pending.slot()"
      [accountName]="session.account()?.name ?? ''"
      [onBehalf]="session.canUseDesk()"
      [working]="booking()"
      [problem]="problem()"
      (cancelled)="stopConfirming()"
      (confirmed)="confirm($event)"
      (wantsAccount)="leaveFor('/register')"
      (wantsSignIn)="leaveFor('/sign-in')"
    />
    }
  `,
  styleUrl: './book.component.css',
})
export class BookComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly session = inject(SessionService);
  readonly pending = inject(PendingService);

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

  /** Whether the answer is on screen. Separate from having an answer: the
   * dialog can be closed and reopened without searching again. */
  readonly showing = signal(false);

  /** Whether the confirmation is on screen. */
  readonly confirming = signal(false);

  /** Why the centre question is being asked a second time, if it is. */
  readonly forgotten = signal<string | null>(null);

  // Composed here rather than in the template. An apostrophe inside a template
  // expression inside an attribute is three levels of quoting and the compiler
  // is right to refuse it; a sentence is not a thing to assemble in markup.
  readonly askHeading = computed(() =>
    this.forgotten() ? 'Choose another centre' : 'Which centre?'
  );

  readonly askWhy = computed(
    () =>
      this.forgotten() ??
      "Prices, opening hours and what can be booked online are each centre's own."
  );

  readonly siteName = computed(() => {
    const id = this.siteId();
    if (id === null) return 'Any';
    return this.sites().find((site) => site.id === id)?.name ?? 'Any';
  });

  /**
   * What the closed panel says.
   *
   * "Site: Any" told somebody who had just chosen a centre nothing at all --
   * not what a site is, not that this centre has more than one, not why they
   * might care. Counting them says all three in four words.
   */
  readonly siteSaid = computed(() => {
    const id = this.siteId();
    if (id !== null) return this.siteName();
    const many = this.sites().length;
    return many > 1 ? `Any of its ${many} sites` : 'Any';
  });

  /** The machines in a building, spelled out rather than abbreviated. */
  machinesAt(site: Site): string {
    const said: Record<string, string> = {
      MR: 'MRI',
      CT: 'CT',
      US: 'Ultrasound',
      XR: 'X-ray',
    };
    const has = site.modalities ?? [];
    if (has.length === 0) return 'No machines listed';
    return has.map((one) => said[one] ?? one).join(', ');
  }

  readonly categoryLabel = computed(
    () => CATEGORIES.find((one) => one.value === this.category())?.label ?? this.category()
  );
  readonly weekdayLabel = computed(
    () => WEEKDAYS.find((one) => one.value === this.weekday())?.label ?? 'Any day'
  );
  readonly partLabel = computed(
    () => PARTS.find((one) => one.value === this.part())?.label ?? 'As soon as possible'
  );

  /** What the dialog is answering about, for its header. */
  readonly chosenNames = computed(() => {
    const names = this.chosen().map((exam) => exam.name);
    if (names.length === 0) return 'Available times';
    if (names.length === 1) return names[0]!;
    return `${names[0]} + ${names.length - 1} more`;
  });

  /** The terms it was asked under, said the way the original said them. */
  readonly terms = computed(() => {
    const bits = [this.categoryLabel(), this.siteName() === 'Any' ? 'any site' : this.siteName()];
    if (this.weekday() !== null) bits.push(this.weekdayLabel());
    if (this.part() !== 'any') bits.push(this.partLabel());
    return bits.join(' · ');
  });

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
    /**
     * Back from registering, with the choice still in hand.
     *
     * Somebody who picked 9:20 as a visitor, made an account and returned
     * should find 9:20 in front of them and one button to press. Landing on an
     * empty search form instead is the journey asking them to do it twice, and
     * the second time they know how long it takes.
     *
     * Guarded on `restoring`: a token being checked on start means signedIn()
     * is briefly false while it is, and reopening on the answer to a question
     * nobody has finished asking would drop the slot a moment later.
     */
    effect(() => {
      if (this.session.restoring()) return;
      const held = this.pending.slot();
      if (!held || this.booked()) return;

      // Signed in or not. It used to want an account, which meant a visitor who
      // pressed "Back to the appointment" from the sign-in page landed on an
      // empty search with their choice still held and nowhere on screen. The
      // confirmation already has a half for somebody with no account: it asks
      // who they are.
      //
      // Only if the choice belongs to the centre being looked at. Switching
      // centre and finding a time from the old one waiting is a booking made
      // somewhere nobody chose.
      if (held.centre === this.session.centre()) this.confirming.set(true);
    });

    // The price list belongs to the centre, so it is re-read when the centre
    // changes — and everything chosen against the old one is cleared, because
    // an exam id from another centre is either a different exam or nothing.
    effect(() => {
      const centre = this.session.centre();
      this.chosen.set([]);
      this.answer.set(null);
      this.showing.set(false);
      // Nothing to ask for until there is a centre to ask. A visitor arrives
      // without one, and these calls went out anyway and came back 400 --
      // twice, in the console, before the screen had shown them anything.
      if (centre) this.load();
    });
  }

  /**
   * The centre's exams and sites, and what to do when the centre is gone.
   *
   * Which centre you are looking at is remembered in the browser, and a centre
   * is a row: it can be suspended, and on this demonstration it can be deleted
   * from the console while you are looking at it. Coming back the next day to a
   * centre that no longer takes bookings left the screen saying it could not
   * read the list of exams -- true, unhelpful, and with no way out except
   * knowing that the name in the header is a switcher.
   *
   * 403 and 404 are that case and nothing else: the centre is suspended, or it
   * is not there. So the remembered centre is forgotten and the screen asks the
   * question it asks anybody who has not chosen one, with a line saying why it
   * is asking again. Any other failure is the API being down, which is not
   * solved by choosing a different centre.
   */
  private load(): void {
    this.api.exams().subscribe({
      next: (answer) => this.exams.set(answer.exams),
      error: (wrong) => {
        if (wrong.status === 403 || wrong.status === 404) {
          this.forgotten.set(
            wrong.status === 403
              ? 'The centre you were looking at is not taking bookings at the moment.'
              : 'The centre you were looking at is no longer on the platform.'
          );
          this.session.lookAt(null);
          return;
        }
        this.problem.set('Could not read this centre’s list of exams.');
      },
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
    // A disabled checkbox cannot be clicked, and a keyboard, a script or a
    // browser extension can still get here. The list is not the rule.
    if (!exam.bookable) return;
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
          this.showing.set(true);
        },
        error: () => {
          this.searching.set(false);
          this.problem.set('The search did not go through.');
        },
      });
  }

  /**
   * Picking a time no longer books it. It opens the confirmation.
   *
   * What is kept is everything the confirmation has to show and the booking
   * call will need -- names included, because the visitor may be about to
   * leave this screen to make an account, and coming back to a room id is
   * coming back to nothing anyone can check.
   */
  choose(day: SearchDay, time: string): void {
    // Closed the moment a time is picked. Leaving it up behind the
    // confirmation invites a second choice over the top of the first.
    this.showing.set(false);
    this.problem.set(null);

    const slot: PickedSlot = {
      centre: this.session.centre() ?? '',
      roomId: day.roomId,
      startsAt: time,
      examIds: this.chosen().map((exam) => exam.id),
      examNames: this.chosen().map((exam) => exam.name),
      category: this.category(),
      date: day.date,
      siteName: day.siteName,
      roomName: day.roomName,
      modality: day.modality,
      priceCents: day.priceCents,
    };

    this.pending.hold(slot);
    this.confirming.set(true);
  }

  /**
   * Closing the confirmation throws the choice away -- unless the reason it
   * closed is that we are sending somebody off to get an account.
   *
   * `<dialog>` fires `close` however it closes, which is the right design and
   * was a trap here: `leaveFor` set `confirming` to false, the effect called
   * `close()`, and the handler dropped the very slot the journey exists to
   * carry. The registration page then showed no appointment, which is the one
   * thing it was supposed to show.
   */
  private leaving = false;

  stopConfirming(): void {
    this.confirming.set(false);
    if (this.leaving) {
      this.leaving = false;
      return;
    }
    this.pending.drop();

    // Back to where the confirmation came from.
    //
    // "Pick another time" closed the confirmation and stopped there, which left
    // somebody looking at the form they filled in twenty seconds earlier --
    // with the times they were choosing between still loaded, still correct and
    // no longer on screen. The same is true of the ✕ and of Escape: all three
    // mean "not this one", and none of them means "start again".
    //
    // Not after a booking, where the dialog is closed by having succeeded and
    // the card behind it is the reference.
    if (!this.booked() && this.answer()?.ok) this.showing.set(true);
  }

  /** Off to register or sign in, with the choice kept. */
  leaveFor(where: string): void {
    this.leaving = true;
    this.confirming.set(false);
    this.router.navigate([where]);
  }

  /**
   * Agreed to, and only now booked.
   *
   * The name comes from the confirmation rather than from the account: at the
   * desk the appointment belongs to whoever is standing there. It used to be
   * the string `Demo Patient` for everybody.
   */
  confirm(patientName: string): void {
    const slot = this.pending.slot();
    if (!slot) return;

    this.booking.set(true);
    this.problem.set(null);
    const began = Date.now();

    this.api
      .book({
        roomId: slot.roomId,
        startsAt: slot.startsAt,
        examIds: slot.examIds,
        patientName,
        category: slot.category,
      })
      .subscribe({
        next: (made) => {
          // Held for a moment before the screen changes.
          //
          // Not to pretend the work took longer: the work is a row in a diary
          // and on a machine next to you it takes tens of milliseconds. It is
          // that a state which appears and vanishes inside one frame is a
          // flicker rather than a state, and somebody who pressed a button
          // deserves to see that the button took it. Half a second is the
          // shortest thing the eye reads as having happened.
          const rest = Math.max(0, 550 - (Date.now() - began));
          setTimeout(() => {
            this.booking.set(false);
            this.confirming.set(false);
            this.pending.drop();
            this.booked.set(made.booking);
          }, rest);
        },
        error: (error) => {
          this.booking.set(false);
          if (error.status === 409) {
            // Taken while this was on screen, which is exactly what a choice
            // that holds nothing risks. Say so, and show what is left.
            this.confirming.set(false);
            this.pending.drop();
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
  readonly longDate = longDate;
}
