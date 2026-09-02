import { Component, input } from '@angular/core';

/**
 * The mark: a stack of time bands, one of them taken.
 *
 * The subject of this whole application is machine time — a scanner is a
 * resource that fills up in blocks, and everything in the domain follows from
 * that: sessions, quotas, an exam's duration cutting a slot out of a morning.
 * So the mark is a morning: four bands, and the one that has been booked is
 * solid and full width.
 *
 * Drawn rather than fetched, and the same drawing is the favicon. A mark that
 * only exists as a PNG somebody exported once drifts from the icon in the tab
 * the first time either is touched; this one cannot, because there is one
 * source for both.
 *
 * It has to read at 16 pixels. That is why there are four bands and not
 * twelve, why the corner radius is small, and why the taken band is the widest
 * — at favicon size the eye gets one shape, and that shape should be "a full
 * bar among empty ones".
 */
@Component({
  selector: 'app-logo',
  standalone: true,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 32 32"
      role="img"
      [attr.aria-label]="label()"
      fill="none"
    >
      <rect width="32" height="32" rx="7" [attr.fill]="ground()" />
      <!-- The free bands, held well back. At 30px with the same weight as the
           booked one the whole mark reads as a hamburger menu — three lines
           and a fourth — which is what the first version did. The contrast
           between "taken" and "free" has to carry the shape. -->
      <g [attr.fill]="quiet()" opacity="0.5">
        <rect x="7" y="8" width="11" height="2.5" rx="1.25" />
        <rect x="7" y="20.5" width="8" height="2.5" rx="1.25" />
        <rect x="7" y="25" width="12" height="2.5" rx="1.25" />
      </g>
      <!-- The one that is taken: wider, taller, solid, and off-centre so the
           mark is not symmetrical — symmetry is what made it a menu icon. -->
      <rect x="7" y="13" width="18" height="4.5" rx="2.25" [attr.fill]="mark()" />
    </svg>
  `,
  styles: [':host { display: inline-flex; line-height: 0; }'],
})
export class LogoComponent {
  readonly size = input(28);
  readonly label = input('Booking');

  /** Overridable so the mark can sit on a dark ground without a second file. */
  readonly ground = input('var(--mark-ground)');
  readonly mark = input('var(--mark-ink)');
  readonly quiet = input('var(--mark-quiet)');
}
