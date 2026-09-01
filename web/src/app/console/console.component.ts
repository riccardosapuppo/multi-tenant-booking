import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ApiService, Centre } from '../shell/api.service';

/**
 * The platform console: the centres themselves.
 *
 * This is the screen the project exists for. Creating a centre here makes a
 * database, runs a schema into it and registers it, while the other centres
 * carry on taking bookings — and the new one answers immediately, with no
 * restart and no configuration file to edit.
 *
 * What is not here matters as much. There is no way from this screen to a
 * patient's booking. Administering the platform is not permission to read
 * every record on it, and the API refuses even if this page were to ask.
 */
@Component({
  selector: 'app-console',
  standalone: true,
  imports: [FormsModule],
  template: `
    <h1>Centres</h1>
    <p class="lede">
      Every centre on the platform. Each has a database of its own — creating one here
      makes it, and it starts answering straight away.
    </p>

    <div class="card" style="margin-bottom: 1.25rem">
      <h2>Add a centre</h2>
      <div class="grid-2">
        <label class="field">
          <span>Slug — lowercase, used in the subdomain and in the database name</span>
          <input [(ngModel)]="slug" name="slug" placeholder="eastgate" />
        </label>
        <label class="field">
          <span>Name</span>
          <input [(ngModel)]="name" name="name" placeholder="Eastgate Imaging" />
        </label>
      </div>

      <button type="button" [disabled]="making()" (click)="create()">
        {{ making() ? 'Creating…' : 'Create' }}
      </button>

      @if (problem()) {
        <p class="note bad" style="margin-top: 0.9rem">{{ problem() }}</p>
      }

      @if (made()) {
        <p class="note" style="margin-top: 0.9rem">
          <strong>{{ made() }}</strong> exists, has a database of its own, and is
          answering — with no restart.
        </p>
      }
    </div>

    @if (loading()) {
      <p class="muted">Reading the register…</p>
    } @else {
      <div class="card">
        <table>
          <thead>
            <tr>
              <th>Centre</th>
              <th>Slug</th>
              <th>People</th>
              <th>Options</th>
              <th>State</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (centre of centres(); track centre.slug) {
              <tr>
                <td><strong>{{ centre.name }}</strong></td>
                <td class="mono">{{ centre.slug }}</td>
                <td class="muted">{{ people(centre) }}</td>
                <td class="muted">{{ options(centre) }}</td>
                <td>
                  @if (centre.active) {
                    <span class="tag ok">taking bookings</span>
                  } @else {
                    <span class="tag warn">suspended</span>
                  }
                </td>
                <td>
                  <div class="row" style="justify-content: flex-end">
                    <button type="button" class="quiet" (click)="toggle(centre)">
                      {{ centre.active ? 'Suspend' : 'Resume' }}
                    </button>
                    <button type="button" class="danger" (click)="remove(centre)">Remove</button>
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class ConsoleComponent {
  private readonly api = inject(ApiService);

  readonly centres = signal<Centre[]>([]);
  readonly loading = signal(true);
  readonly making = signal(false);
  readonly problem = signal<string | null>(null);
  readonly made = signal<string | null>(null);

  slug = '';
  name = '';

  constructor() {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.api.centres().subscribe({
      next: (answer) => {
        this.centres.set(answer.centres);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.problem.set('Could not read the register.');
      },
    });
  }

  create(): void {
    if (!this.slug.trim() || !this.name.trim()) {
      this.problem.set('A centre needs a slug and a name.');
      return;
    }

    this.making.set(true);
    this.problem.set(null);
    this.made.set(null);

    this.api
      .createCentre({ slug: this.slug.trim().toLowerCase(), name: this.name.trim() })
      .subscribe({
        next: (answer) => {
          this.making.set(false);
          this.made.set(answer.centre.slug);
          this.slug = '';
          this.name = '';
          this.load();
        },
        error: (error) => {
          this.making.set(false);
          this.problem.set(
            error.status === 409
              ? 'A centre with that slug already exists.'
              : (error.error?.error ?? 'That centre could not be created.')
          );
        },
      });
  }

  toggle(centre: Centre): void {
    this.api.updateCentre(centre.slug, { active: !centre.active }).subscribe({
      next: () => this.load(),
      error: () => this.problem.set('That could not be changed.'),
    });
  }

  remove(centre: Centre): void {
    // Everything in it goes, and there is nothing behind this. The API asks
    // for the slug again in the body; this asks the person in front of it.
    const sure = confirm(
      `Remove ${centre.name}? Its database and every booking in it are deleted, and this cannot be undone.`
    );
    if (!sure) return;

    this.api.removeCentre(centre.slug).subscribe({
      next: () => this.load(),
      error: () => this.problem.set('That centre could not be removed.'),
    });
  }

  people(centre: Centre): string {
    const counts = centre.people ?? {};
    const parts = Object.entries(counts).map(([role, many]) => `${many} ${role.replace('_', ' ')}`);
    return parts.length ? parts.join(', ') : '—';
  }

  options(centre: Centre): string {
    const entries = Object.entries(centre.options ?? {});
    return entries.length ? entries.map(([key, value]) => `${key}: ${value}`).join(', ') : '—';
  }
}
