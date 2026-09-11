import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { ApiService } from '../shell/api.service';
import { SessionService } from '../shell/session.service';
import { PendingService } from '../shell/pending';
import { CentrePickerComponent } from '../shell/centre-picker.component';
import { HeldComponent } from '../shell/held.component';

/**
 * Making an account, which on this platform happens AT a centre.
 *
 * The original asked for eleven fields, and it had to: an Italian health
 * service will not take a booking without a tax code, and it identifies a
 * person by that plus a birth date rather than by an email address. Six
 * survive here. The ones that went were the ones a form asks for in order to
 * compute the tax code -- place of birth, province, sex -- and the demonstration
 * lets you type the code instead, which is what somebody with a health card in
 * their hand does anyway.
 *
 * Two things this page owes the person arriving at it:
 *
 *   1. **It says why each field is here.** A booking form asking for a tax code
 *      with no explanation reads as a form collecting what it can.
 *   2. **It does not lose the appointment.** Most people land here from a time
 *      they have already chosen. The chosen time is on the page, and the button
 *      says what happens next rather than "Submit".
 *
 * The invented details are one button. A reader trying the demonstration has no
 * reason to have an Italian tax code, and asking them to make one up is asking
 * them to stop.
 */
@Component({
  selector: 'app-register',
  standalone: true,
  imports: [FormsModule, RouterLink, CentrePickerComponent, HeldComponent],
  templateUrl: './register.component.html',
  styleUrl: './register.component.css',
})
export class RegisterComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly session = inject(SessionService);
  readonly pending = inject(PendingService);

  readonly given = signal('');
  readonly family = signal('');
  readonly bornOn = signal('');
  readonly taxCode = signal('');
  readonly phone = signal('');
  readonly email = signal('');
  readonly password = signal('');

  readonly working = signal(false);
  readonly problem = signal<string | null>(null);

  readonly fullName = computed(() => `${this.given().trim()} ${this.family().trim()}`.trim());

  readonly ready = computed(
    () =>
      this.fullName().length > 2 &&
      this.email().includes('@') &&
      this.password().length >= 8 &&
      !this.working()
  );

  /**
   * Invented details, so that trying this does not require inventing them.
   *
   * The address carries a timestamp because the register refuses a second
   * account on the same address, and a reader who presses this twice has done
   * nothing wrong.
   */
  fillIn(): void {
    const stamp = Date.now().toString().slice(-6);
    this.given.set('Alex');
    this.family.set('Marino');
    this.bornOn.set('1987-04-12');
    this.taxCode.set('MRNLXA87D12H501Z');
    this.phone.set('+39 333 000 0000');
    this.email.set(`alex.marino.${stamp}@example.org`);
    this.password.set('demo-password');
    this.problem.set(null);
  }

  submit(): void {
    if (!this.ready()) return;

    this.working.set(true);
    this.problem.set(null);

    this.api
      .register({
        name: this.fullName(),
        email: this.email().trim(),
        password: this.password(),
        phone: this.phone().trim() || undefined,
        bornOn: this.bornOn() || undefined,
        taxCode: this.taxCode().trim() || undefined,
      })
      .subscribe({
        next: (answer: any) => {
          this.working.set(false);
          this.session.begin(answer.token, answer.user, answer.centres, answer.platformAdmin);
          // Back to the booking screen: either to the time being held, which
          // the screen reopens by itself, or to a search that now has a name
          // to book under.
          this.router.navigate(['/book']);
        },
        error: (error) => {
          this.working.set(false);
          this.problem.set(
            error?.error?.error ?? 'The account could not be created. Try again in a moment.'
          );
        },
      });
  }
}
