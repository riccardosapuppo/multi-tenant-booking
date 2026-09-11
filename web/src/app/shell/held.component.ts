import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { PendingService } from './pending';
import { clock, longDate } from './dates';

/**
 * The appointment somebody is in the middle of, shown on the pages that
 * interrupt them.
 *
 * Registering and signing in are both interruptions: a visitor picked a time
 * and was sent here to put a name on it. The registration page said so; the
 * sign-in page did not, so from there the only ways out were to finish signing
 * in or to leave -- the held time was invisible and there was no way back to
 * it. Somebody who arrived by accident, or who wanted to change their mind
 * about the time rather than about the account, had nothing to press.
 *
 * So both show it, and both offer the way back. It is one component because it
 * is one thing said twice, and the last time this project had the same thing
 * written in two places one of the two did not exist.
 */
@Component({
  selector: 'app-held',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (pending.slot(); as held) {
      <div class="held">
        <p class="held-lead">Waiting for a name</p>
        <p class="held-what">{{ held.examNames.join(', ') }}</p>
        <p class="held-when">{{ longDate(held.startsAt) }} at {{ clock(held.startsAt) }} · {{ held.siteName }}</p>
        <p class="held-note">Nothing is held. It is booked when you confirm it.</p>
        <a class="held-back" routerLink="/book">Back to the appointment</a>
      </div>
    }
  `,
  styleUrl: './held.component.css',
})
export class HeldComponent {
  readonly pending = inject(PendingService);

  // The timestamp is what the engine speaks; a person reading a summary of
  // their own appointment should not be shown it. This said "2026-09-15 at
  // 2026-09-15T07:00:00.000Z", which is the date twice and neither time is the
  // one they picked.
  readonly longDate = longDate;
  readonly clock = clock;
}
