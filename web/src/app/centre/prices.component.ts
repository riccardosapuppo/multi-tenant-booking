import { Component, computed, effect, inject, signal } from '@angular/core';

import { ApiService, Exam } from '../shell/api.service';
import { SessionService } from '../shell/session.service';

/**
 * The price list, and the one screen only a centre's administrator has.
 *
 * This existed as an endpoint before it existed as a screen, which meant the
 * sign-in page told people the administrator "may change its price list" and
 * there was nowhere to do it. A capability that is claimed and not reachable
 * is a lie on the screen, and it is exactly the kind that a test never catches
 * — `PATCH /desk/exams/:id` was covered and passing the whole time.
 *
 * What makes it worth a screen rather than a form is that none of these three
 * fields is only a number:
 *
 *   - **Minutes** is how long a slot is. It does not filter anything, it cuts
 *     the day differently: 20 minutes into a three-hour session is nine
 *     appointments, 30 is six. Change it and every day on the booking screen
 *     is re-cut.
 *   - **Bookable** is whether patients are offered it at all. Switched off,
 *     the exam stays on this list and disappears from theirs — which is why
 *     this screen reads the centre's own list and not the public one.
 *   - **Price** is what a patient is quoted before choosing a time, so it is
 *     part of the answer and not of the receipt.
 *
 * Prices are held in cents everywhere and shown in whole currency here.
 * Somebody typing 74.50 means 7450 and never 74.5, which is the sort of thing
 * that is obvious until a rounding leaves a centre charging fifty cents.
 */
@Component({
  selector: 'app-prices',
  standalone: true,
  template: `
    <h1>Price list</h1>
    <p class="lede">
      <strong>{{ session.centre() }}</strong>’s own list. You are the
      <span class="tag ok">centre administrator</span> here, which is what this
      screen needs — staff at the same centre can read the desk and cannot open it.
    </p>

    @if (problem(); as message) {
      <div class="card problem"><p>{{ message }}</p></div>
    }

    @if (loading()) {
      <p class="muted">Reading the list…</p>
    } @else {
      <div class="card">
        <table class="prices">
          <thead>
            <tr>
              <th>Exam</th>
              <th class="num">Minutes</th>
              <th class="num">Price</th>
              <th>Offered online</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.id) {
              <tr [class.changed]="dirty(row)" [class.off]="!row.bookable">
                <td>
                  <span class="name">{{ row.name }}</span>
                  <small>{{ row.modality }} · {{ row.code }}</small>
                </td>

                <td class="num">
                  <input
                    type="number"
                    min="5"
                    max="180"
                    step="5"
                    [value]="row.minutes"
                    (input)="edit(row, 'minutes', $event)"
                    [attr.data-minutes-for]="row.code"
                  />
                </td>

                <td class="num">
                  <span class="currency">€</span>
                  <input
                    type="number"
                    min="0"
                    step="0.50"
                    [value]="(row.price_cents / 100).toFixed(2)"
                    (input)="edit(row, 'price', $event)"
                    [attr.data-price-for]="row.code"
                  />
                </td>

                <td>
                  <label class="switch">
                    <input
                      type="checkbox"
                      [checked]="row.bookable"
                      (change)="edit(row, 'bookable', $event)"
                    />
                    <span>{{ row.bookable ? 'Yes' : 'No — desk only' }}</span>
                  </label>
                </td>

                <td class="num">
                  <button
                    type="button"
                    class="save"
                    [disabled]="!dirty(row) || saving() === row.id"
                    (click)="save(row)"
                    [attr.data-save-for]="row.code"
                  >
                    {{ saving() === row.id ? 'Saving…' : 'Save' }}
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <p class="muted after">
        {{ offered() }} of {{ rows().length }} offered online. Changing the minutes
        re-cuts every day on the booking screen; switching one off removes it from
        what patients are offered and leaves it here.
      </p>
    }
  `,
  styleUrl: './prices.component.css',
})
export class PricesComponent {
  private readonly api = inject(ApiService);
  readonly session = inject(SessionService);

  readonly rows = signal<Exam[]>([]);
  readonly loading = signal(true);
  readonly saving = signal<number | null>(null);
  readonly problem = signal<string | null>(null);

  /** What each row looked like when it arrived, so "changed" is a fact. */
  private readonly asRead = new Map<number, string>();

  readonly offered = computed(() => this.rows().filter((exam) => exam.bookable).length);

  constructor() {
    // The list belongs to the centre. Same reason as the desk and the booking
    // screen: loading once at construction leaves one centre's prices on
    // screen under another centre's name.
    effect(() => {
      this.session.centre();
      this.load();
    });
  }

  private load(): void {
    this.loading.set(true);
    this.problem.set(null);

    this.api.priceList().subscribe({
      next: (answer) => {
        this.asRead.clear();
        for (const exam of answer.exams) this.asRead.set(exam.id, fingerprint(exam));
        this.rows.set(answer.exams);
        this.loading.set(false);
      },
      error: (error) => {
        this.loading.set(false);
        this.rows.set([]);
        this.problem.set(
          error.status === 403
            ? 'You are not this centre’s administrator. Staff can read the desk; only the administrator changes the list.'
            : 'The price list could not be read.'
        );
      },
    });
  }

  dirty(row: Exam): boolean {
    return this.asRead.get(row.id) !== fingerprint(row);
  }

  edit(row: Exam, field: 'minutes' | 'price' | 'bookable', event: Event): void {
    const input = event.target as HTMLInputElement;

    const changed = { ...row };
    if (field === 'minutes') changed.minutes = Number(input.value);
    // Currency in, cents out, rounded once and here. Doing it at save time
    // instead means the arithmetic happens on a string that has been through
    // an input box twice.
    if (field === 'price') changed.price_cents = Math.round(Number(input.value) * 100);
    if (field === 'bookable') changed.bookable = input.checked;

    this.rows.update((all) => all.map((exam) => (exam.id === row.id ? changed : exam)));
  }

  save(row: Exam): void {
    this.saving.set(row.id);
    this.problem.set(null);

    this.api
      .reprice(row.id, {
        minutes: row.minutes,
        price_cents: row.price_cents,
        bookable: row.bookable,
      })
      .subscribe({
        next: (answer) => {
          this.saving.set(null);
          // The server's version, not the one that was typed. It is the one
          // patients will be quoted, and if it came back different from what
          // was sent this is where that becomes visible.
          this.asRead.set(answer.exam.id, fingerprint(answer.exam));
          this.rows.update((all) =>
            all.map((exam) => (exam.id === answer.exam.id ? answer.exam : exam))
          );
        },
        error: (error) => {
          this.saving.set(null);
          this.problem.set(
            error.status === 403
              ? 'Only this centre’s administrator may change the list.'
              : 'That change was not saved.'
          );
        },
      });
  }
}

function fingerprint(exam: Exam): string {
  return `${exam.minutes}|${exam.price_cents}|${exam.bookable}`;
}
