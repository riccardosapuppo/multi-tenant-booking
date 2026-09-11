import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ApiService } from '../shell/api.service';
import { SessionService } from '../shell/session.service';

/**
 * The account's own details, and its password.
 *
 * The original had two screens here and they were separate for a reason that
 * survives: changing a telephone number and changing a password fail in
 * different ways and mean different things. One is a correction; the other is
 * usually somebody else knowing it.
 *
 * So two cards, each saving on its own, each saying what happened. A single
 * Save across both would make "your password is wrong" look like a refusal to
 * change a telephone number.
 *
 * The email address is shown and cannot be edited. It is what this account
 * signs in with and it is unique across the platform, so changing it is a
 * different job with a different failure -- somebody else already has it --
 * and hiding that inside this button is how an account becomes unreachable.
 */
@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.css',
})
export class ProfileComponent {
  private readonly api = inject(ApiService);
  readonly session = inject(SessionService);

  readonly name = signal('');
  readonly phone = signal('');
  readonly bornOn = signal('');
  readonly taxCode = signal('');

  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly problem = signal<string | null>(null);

  readonly current = signal('');
  readonly wanted = signal('');
  readonly changing = signal(false);
  readonly changed = signal(false);
  readonly passwordProblem = signal<string | null>(null);

  readonly roles = computed(() => this.session.grants());

  constructor() {
    const held = this.session.account();
    this.name.set(held?.name ?? '');
    this.phone.set(held?.phone ?? '');
    this.bornOn.set(held?.bornOn ?? '');
    this.taxCode.set(held?.taxCode ?? '');
  }

  readonly ready = computed(() => this.name().trim().length > 1 && !this.saving());

  save(): void {
    if (!this.ready()) return;
    this.saving.set(true);
    this.saved.set(false);
    this.problem.set(null);

    this.api
      .updateMe({
        name: this.name().trim(),
        phone: this.phone().trim(),
        bornOn: this.bornOn(),
        taxCode: this.taxCode().trim(),
      })
      .subscribe({
        next: (answer) => {
          this.saving.set(false);
          this.saved.set(true);
          // The header shows this name. Leaving the old one there until a
          // reload would make the save look like it had not happened.
          this.session.account.set(answer.user);
        },
        error: (wrong) => {
          this.saving.set(false);
          this.problem.set(wrong?.error?.error ?? 'The details did not save.');
        },
      });
  }

  readonly canChange = computed(
    () => this.current().length > 0 && this.wanted().length >= 8 && !this.changing()
  );

  changePassword(): void {
    if (!this.canChange()) return;
    this.changing.set(true);
    this.changed.set(false);
    this.passwordProblem.set(null);

    this.api.changePassword(this.current(), this.wanted()).subscribe({
      next: () => {
        this.changing.set(false);
        this.changed.set(true);
        this.current.set('');
        this.wanted.set('');
      },
      error: (wrong) => {
        this.changing.set(false);
        this.passwordProblem.set(
          wrong?.status === 401
            ? 'The current password is not right.'
            : wrong?.error?.error ?? 'The password did not change.'
        );
      },
    });
  }
}
