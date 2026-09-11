import { Component, ElementRef, computed, effect, inject, input, output, viewChild } from '@angular/core';

import { SearchAnswer, SearchDay } from '../shell/api.service';
import { clock, dayNumber, dayOfWeek, monthOf, yearOf } from '../shell/dates';

/**
 * The times, in a dialog over the form that asked for them.
 *
 * The original put them here and it was right: the search is a question with a
 * long preamble — site, exams, who is paying, which day, what time — and the
 * answer needs the whole screen. Showing it underneath means the answer starts
 * below the fold on a laptop, and every refinement scrolls you away from what
 * you are refining.
 *
 * Built on `<dialog>` rather than a div with a high z-index. The browser then
 * does the parts that are tedious and usually skipped: the backdrop, Escape to
 * close, focus trapped inside while it is open and returned to the button
 * afterwards, and the rest of the page hidden from a screen reader.
 *
 * The signature is in the day card. Each day carries a bar showing how much
 * choice it offers compared with the others on screen — because the useful
 * question when you are looking at eight days is not "is this day free" but
 * "which of these gives me room to change my mind". Machine time is the thing
 * this whole application is about, and this is the one place it is drawn.
 */
@Component({
  selector: 'app-results',
  standalone: true,
  template: `
    <dialog #box (close)="closed.emit()" (click)="clickedBackdrop($event)">
      <div class="sheet">
        <header>
          <div>
            <p class="what">{{ title() }}</p>
            <p class="terms">{{ terms() }}</p>
          </div>
          <button type="button" class="shut" (click)="shut()" aria-label="Close">✕</button>
        </header>

        @if (answer(); as found) {
          @if (!found.ok) {
            <div class="nothing">
              <p class="big">
                @if (found.reason === 'no_room_does_all') {
                  <!-- One exam and several are the same refusal from the engine
                       and two different sentences to a person: "these cannot be
                       done in one visit" is nonsense about a single exam, and
                       it is what this said, because the only case anybody had
                       tried was two. A site with one machine in it made the
                       other case reachable. -->
                  @if (howMany() === 1) {
                    {{ atOneSite() ? 'That site does not do this one.' : 'No room here does this one.' }}
                  } @else {
                    These cannot be done in one visit here.
                  }
                } @else if (found.reason === 'not_bookable_online') {
                  <!-- All of them, not the first one. With two unbookable exams
                       this named one and left the other to be discovered by
                       trying again. -->
                  {{ named(found) }}
                  {{ (found.exams ?? []).length === 1 ? 'is' : 'are' }} not bookable online.
                } @else if (found.reason === 'unknown_exam') {
                  {{ howMany() === 1 ? 'That exam' : 'One of those exams' }} is not on this
                  centre's list.
                } @else {
                  <!-- A reason this screen has not been taught. Saying "not
                       offered at this centre" to anything unrecognised is how a
                       screen confidently describes something that did not
                       happen; the engine's own word is at least true. -->
                  The search was refused: {{ found.reason }}.
                }
              </p>
              <p class="why">
                @if (found.reason === 'no_room_does_all') {
                  @if (howMany() === 1) {
                    {{
                      atOneSite()
                        ? 'The machine for it is in another building of this centre. Choose any site, or pick the one that has it.'
                        : 'No room at this centre has the machine for it.'
                    }}
                  } @else {
                    No single room performs all of them, and one appointment happens in one
                    room. Book them separately, or choose a different site.
                  }
                } @else if (found.reason === 'not_bookable_online') {
                  The list says why, next to each of them. Ring the centre and they will
                  arrange it.
                } @else if (found.reason === 'unknown_exam') {
                  Centres keep their own lists, so an exam chosen at one is not always on
                  the next one's. Choose again from the list.
                } @else {
                  That is not a refusal this screen knows how to explain. The list above is
                  the place to start again.
                }
              </p>
              <button type="button" (click)="shut()">Change the search</button>
            </div>
          } @else if (found.days.length === 0) {
            <div class="nothing">
              <p class="big">Nothing free in the next three weeks.</p>
              <p class="why">
                @if (found.closed.length > 0) {
                  @for (shut of found.closed; track shut.day + shut.opens) {
                    <span class="shutline">
                      {{ shut.day }}, {{ shut.opens }}–{{ shut.closes }}:
                      {{
                        shut.reason === 'category_full'
                          ? 'the quota for this payment category is used up'
                          : 'full'
                      }}
                    </span>
                  }
                  Another payment category, or another day of the week, may be open.
                } @else {
                  Try another day of the week, or widen the time of day.
                }
              </p>
              <button type="button" (click)="shut()">Change the search</button>
            </div>
          } @else {
            <div class="days">
              @for (day of found.days; track day.date) {
                <article class="day" [attr.data-date]="day.date">
                  <div class="when">
                    <p class="dow">{{ dayOfWeek(day.date) }}</p>
                    <p class="num">{{ dayNumber(day.date) }}</p>
                    <p class="mon">{{ monthOf(day.date) }} {{ yearOf(day.date) }}</p>

                    <p class="price">{{ money(day.priceCents) }}</p>

                    <p class="where">{{ day.siteName }}</p>
                    <p class="room">{{ day.modality }} · {{ day.roomName }}</p>

                    <!-- How much choice this day gives, next to the others.
                         Not a percentage of anything real — it is a comparison,
                         and the label says so. -->
                    <p class="room-left">
                      <span class="bar" [style.--fill]="fillOf(day)"></span>
                      <span class="count">{{ day.times.length }} times</span>
                    </p>
                  </div>

                  <div class="times">
                    @for (time of day.times; track time) {
                      <button type="button" (click)="chosen.emit({ day, time })">
                        {{ clock(time) }}
                      </button>
                    }
                  </div>
                </article>
              }
            </div>
          }
        }
      </div>
    </dialog>
  `,
  styleUrl: './results.component.css',
})
export class ResultsComponent {
  readonly answer = input<SearchAnswer | null>(null);
  readonly title = input('');
  readonly terms = input('');
  readonly open = input(false);
  /** How many exams were asked for: one refusal, two sentences. */
  readonly howMany = input(0);
  /** Whether the search was narrowed to one building. */
  readonly atOneSite = input(false);

  readonly closed = output<void>();
  readonly chosen = output<{ day: SearchDay; time: string }>();

  private readonly box = viewChild.required<ElementRef<HTMLDialogElement>>('box');

  readonly clock = clock;
  readonly dayOfWeek = dayOfWeek;
  readonly dayNumber = dayNumber;
  readonly monthOf = monthOf;
  readonly yearOf = yearOf;

  /** The busiest day on screen, so the bars compare against something real. */
  private readonly most = computed(() => {
    const days = this.answer()?.days ?? [];
    return days.reduce((top, day) => Math.max(top, day.times.length), 1);
  });

  constructor() {
    effect(() => {
      const dialog = this.box().nativeElement;
      // showModal() rather than open=true: only the modal form gets the
      // backdrop, the focus trap and Escape.
      if (this.open() && !dialog.open) dialog.showModal();
      if (!this.open() && dialog.open) dialog.close();
    });
  }

  shut(): void {
    this.box().nativeElement.close();
  }

  /**
   * A click on the backdrop closes it.
   *
   * The backdrop is the dialog element itself, so the test is whether the
   * click landed outside the sheet — comparing against `event.target` alone
   * would also close when somebody clicks a gap inside it.
   */
  clickedBackdrop(event: MouseEvent): void {
    if (event.target === this.box().nativeElement) this.shut();
  }

  fillOf(day: SearchDay): string {
    return `${Math.round((day.times.length / this.most()) * 100)}%`;
  }

  /** Every exam the engine refused, in a sentence rather than the first one. */
  named(found: SearchAnswer): string {
    const names = (found.exams ?? []).map((exam) => exam.name);
    if (names.length === 0) return 'That exam';
    if (names.length === 1) return names[0]!;
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }

  money(cents: number): string {
    return `€${(cents / 100).toFixed(2)}`;
  }
}
