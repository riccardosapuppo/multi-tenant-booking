import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { PendingService } from './pending';
import { SessionService } from './session.service';
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
        @if (canFinish()) {
          <p class="held-note">Nothing is held. It is booked when you confirm it.</p>
          <a class="held-back" routerLink="/book">Back to the appointment</a>
        } @else {
          <!-- Signed in as somebody who cannot book it. Said rather than solved:
               a booking belongs to a centre, and this account has no role at
               one -- whoever runs the platform has none anywhere, which is the
               boundary this whole demonstration is about. -->
          <p class="held-note cannot">
            This account cannot book it. A booking belongs to a centre, and this one has
            no role there.
          </p>
          <a class="held-back" routerLink="/sign-in">Sign in as somebody else</a>
        }
      </div>
    }
  `,
  styleUrl: './held.component.css',
})
export class HeldComponent {
  readonly pending = inject(PendingService);
  private readonly session = inject(SessionService);

  /**
   * Whether whoever is here could finish this booking.
   *
   * A visitor can: the confirmation asks who they are. Somebody signed in can
   * only if they hold a role at the centre the time was picked at, and whoever
   * runs the platform holds one nowhere.
   */
  readonly canFinish = computed(() => {
    const held = this.pending.slot();
    if (!held) return false;
    if (!this.session.signedIn()) return true;
    if (this.session.platformAdmin()) return false;
    return this.session.grants().some((grant) => grant.slug === held.centre);
  });

  // The timestamp is what the engine speaks; a person reading a summary of
  // their own appointment should not be shown it. This said "2026-09-15 at
  // 2026-09-15T07:00:00.000Z", which is the date twice and neither time is the
  // one they picked.
  readonly longDate = longDate;
  readonly clock = clock;
}
