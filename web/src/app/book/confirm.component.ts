import { Component, ElementRef, effect, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PickedSlot } from '../shell/pending';
import { clock, dayNumber, dayOfWeek, monthOf, yearOf } from '../shell/dates';

/**
 * The step that used to be missing: looking at what you are about to book.
 *
 * Pressing a time booked it. One click, no summary, no way back -- and the
 * name on the booking was a constant in the source, `Demo Patient`, so the
 * screen could not even tell you whose appointment it had just made. For a
 * demonstration of a system that books real people into real machine time,
 * that is the one step you cannot leave out.
 *
 * The layout is an appointment, not a form. The left half is the thing itself
 * -- the day, the hour, the machine and the room it happens in -- because that
 * is what somebody checks before they agree. The right half is who it is for,
 * which is the only part anyone has to fill in, and it changes with who is
 * asking:
 *
 *   - a patient sees their own name and confirms;
 *   - somebody at the desk is booking for another person, so the name is a
 *     field and it is required -- this is where `Demo Patient` came from;
 *   - a visitor with no account sees what an account is for and chooses
 *     between making one and signing in. Their choice is kept while they go.
 *
 * Built on `<dialog>` like the results sheet above it, for the same reasons:
 * the backdrop, Escape, the focus trap and the rest of the page hidden from a
 * screen reader are the parts that get skipped when a div stands in.
 */
@Component({
  selector: 'app-confirm',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './confirm.component.html',
  styleUrl: './confirm.component.css',
})
export class ConfirmComponent {
  readonly slot = input<PickedSlot | null>(null);
  readonly open = input(false);
  /** Empty when nobody is signed in. */
  readonly accountName = input('');
  /** True when the person booking is not the person being booked. */
  readonly onBehalf = input(false);
  readonly working = input(false);
  readonly problem = input<string | null>(null);

  readonly cancelled = output<void>();
  readonly confirmed = output<string>();
  readonly wantsAccount = output<void>();
  readonly wantsSignIn = output<void>();

  private readonly box = viewChild.required<ElementRef<HTMLDialogElement>>('box');

  /** Typed at the desk, when booking for somebody who is not here. */
  readonly forWhom = signal('');

  readonly clock = clock;
  readonly dayOfWeek = dayOfWeek;
  readonly dayNumber = dayNumber;
  readonly monthOf = monthOf;
  readonly yearOf = yearOf;

  constructor() {
    effect(() => {
      const dialog = this.box().nativeElement;
      if (this.open() && !dialog.open) dialog.showModal();
      if (!this.open() && dialog.open) dialog.close();
    });
  }

  shut(): void {
    this.box().nativeElement.close();
  }

  clickedBackdrop(event: MouseEvent): void {
    if (event.target === this.box().nativeElement) this.shut();
  }

  /** Who the appointment is for: the account, unless the desk says otherwise. */
  patient(): string {
    return this.onBehalf() ? this.forWhom().trim() : this.accountName();
  }

  ready(): boolean {
    return this.patient().length > 1 && !this.working();
  }

  go(): void {
    if (this.ready()) this.confirmed.emit(this.patient());
  }

  money(cents: number): string {
    return `€${(cents / 100).toFixed(2)}`;
  }

  category(slot: PickedSlot): string {
    const said = slot.category.replace(/_/g, ' ');
    return said.charAt(0).toUpperCase() + said.slice(1);
  }
}
