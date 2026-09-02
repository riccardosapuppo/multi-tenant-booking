import { Component, input } from '@angular/core';

/**
 * The small line icons, drawn here rather than pulled from a set.
 *
 * Six of them. An icon library is a dependency, a build step and a thousand
 * glyphs to ship five — and the five that matter here are specific to this
 * screen: a site, a list of exams, who is paying, which day, what time of day.
 *
 * They earn their place by making five stacked panels distinguishable at a
 * glance. Every one of them sits beside a written label, so nothing depends on
 * reading them: they are `aria-hidden`, and removing them all would cost speed
 * and no meaning.
 *
 * One weight, one corner treatment, one 24-unit grid. Icons drawn at different
 * weights next to each other are the thing that makes an interface look
 * assembled rather than made.
 */
@Component({
  selector: 'app-icon',
  standalone: true,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      @switch (name()) {
        @case ('site') {
          <path d="M12 21s-6.5-5.6-6.5-10a6.5 6.5 0 1 1 13 0c0 4.4-6.5 10-6.5 10Z" />
          <circle cx="12" cy="11" r="2.4" />
        }
        @case ('exams') {
          <path d="M8 4h8a2 2 0 0 1 2 2v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a2 2 0 0 1 2-2Z" />
          <path d="M9.5 3.2h5v2.2h-5z" />
          <path d="M9 11h6M9 15h4" />
        }
        @case ('paying') {
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M3 10.5h18" />
          <path d="M7 14.5h3" />
        }
        @case ('day') {
          <rect x="3.5" y="5" width="17" height="15" rx="2" />
          <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
          <path d="M8 13.5h2.5M13.5 13.5H16M8 17h2.5" />
        }
        @case ('when') {
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.4V12l3 1.8" />
        }
        @case ('search') {
          <circle cx="10.8" cy="10.8" r="6.3" />
          <path d="m15.4 15.4 4.1 4.1" />
        }
      }
    </svg>
  `,
  styles: [':host { display: inline-flex; line-height: 0; flex: none; }'],
})
export class IconComponent {
  readonly name = input.required<'site' | 'exams' | 'paying' | 'day' | 'when' | 'search'>();
  readonly size = input(18);
}
