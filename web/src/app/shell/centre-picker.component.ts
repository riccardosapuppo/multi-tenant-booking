import { Component, inject, input, signal } from '@angular/core';

import { ApiService } from './api.service';
import { SessionService } from './session.service';

/**
 * Which centre, asked of somebody who has no account yet.
 *
 * The same question in two places, so it is one component. The booking screen
 * asks it because prices and opening hours are each centre's own; the
 * registration page asks it because an account starts as a patient somewhere,
 * and a role without a centre is not a role. Written twice, the two would have
 * drifted -- and one of them did not exist at all until somebody pressed
 * "Create account" in the header before choosing anything and was told
 * "no centre given" by the API, which is the truth and is not an answer.
 *
 * Deliberately not a dropdown. On a platform whose whole subject is that these
 * are separate places with separate price lists, picking one is a decision, and
 * a decision gets buttons.
 */
@Component({
  selector: 'app-centre-picker',
  standalone: true,
  template: `
    <section class="pick-centre">
      <h2>{{ heading() }}</h2>
      <p>{{ blurb() }}</p>

      @if (problem()) {
        <p class="problem">{{ problem() }}</p>
      }

      <div class="choices">
        @for (centre of centres(); track centre.slug) {
          <button type="button" (click)="enter(centre)">{{ centre.name }}</button>
        }
      </div>
    </section>
  `,
  styleUrl: './centre-picker.component.css',
})
export class CentrePickerComponent {
  readonly heading = input('Which centre?');
  readonly blurb = input('Prices, opening hours and what can be booked online are each centre\'s own.');

  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);

  readonly centres = signal<{ slug: string; name: string }[]>([]);
  readonly problem = signal<string | null>(null);

  constructor() {
    this.api.openCentres().subscribe({
      next: (answer) => this.centres.set(answer.centres),
      error: () => this.problem.set('The list of centres did not load. Is the API running?'),
    });
  }

  enter(centre: { slug: string; name: string }): void {
    this.session.visitingName.set(centre.name);
    this.session.lookAt(centre.slug);
  }
}
