import { Component, ElementRef, effect, input, output, viewChild } from '@angular/core';

/**
 * The question asked before something that cannot be taken back.
 *
 * Three places needed it and none of them had the same thing: the desk and a
 * patient's own list cancelled an appointment on one click, and the console
 * used the browser's own `confirm`, which is a grey box in the corner of the
 * screen with a title nobody chose and two buttons saying OK and Cancel.
 *
 * The buttons here say the verb. On a booking that matters more than usual:
 * "Cancel" on a dialog about cancelling an appointment is a question with the
 * same answer both ways, so it is "Cancel the appointment" against "Keep it".
 * The destructive one is never the one the Enter key lands on.
 *
 * Built on `<dialog>` like the rest: backdrop, Escape, focus trapped inside and
 * given back afterwards, and the page behind it hidden from a screen reader.
 */
@Component({
  selector: 'app-are-you-sure',
  standalone: true,
  template: `
    <dialog #box (close)="dismissed.emit()" (click)="clickedBackdrop($event)">
      <div class="sheet">
        <h2>{{ title() }}</h2>
        <p>{{ detail() }}</p>

        <div class="choice">
          <button type="button" class="keep" (click)="shut()" #first>{{ keepLabel() }}</button>
          <button type="button" class="go" [disabled]="working()" (click)="confirmed.emit()">
            {{ working() ? 'Working…' : confirmLabel() }}
          </button>
        </div>
      </div>
    </dialog>
  `,
  styleUrl: './are-you-sure.component.css',
})
export class AreYouSureComponent {
  readonly open = input(false);
  readonly title = input('Are you sure?');
  readonly detail = input('');
  readonly confirmLabel = input('Yes, do it');
  readonly keepLabel = input('Leave it alone');
  readonly working = input(false);

  readonly confirmed = output<void>();
  readonly dismissed = output<void>();

  private readonly box = viewChild.required<ElementRef<HTMLDialogElement>>('box');
  private readonly first = viewChild<ElementRef<HTMLButtonElement>>('first');

  constructor() {
    effect(() => {
      const dialog = this.box().nativeElement;
      if (this.open() && !dialog.open) {
        dialog.showModal();
        // The harmless button takes the focus, so a held Enter key does not
        // agree to something on the way past.
        this.first()?.nativeElement.focus();
      }
      if (!this.open() && dialog.open) dialog.close();
    });
  }

  shut(): void {
    this.box().nativeElement.close();
  }

  clickedBackdrop(event: MouseEvent): void {
    if (event.target === this.box().nativeElement) this.shut();
  }
}
