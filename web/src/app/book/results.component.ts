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
                  These cannot be done in one visit here.
                } @else if (found.reason === 'not_bookable_online') {
                  {{ (found.exams ?? [])[0]?.name }} is not bookable online.
                } @else {
                  That is not offered at this centre.
                }
              </p>
              <p class="why">
                @if (found.reason === 'no_room_does_all') {
                  No single room performs all of them, and one appointment happens in one
                  room. Book them separately, or choose a different site.
                } @else if (found.reason === 'not_bookable_online') {
                  It needs a doctor to approve it first. Ring the centre and they will
                  arrange it.
                } @else {
                  Choose another exam from the list.
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

  money(cents: number): string {
    return `€${(cents / 100).toFixed(2)}`;
  }
}
