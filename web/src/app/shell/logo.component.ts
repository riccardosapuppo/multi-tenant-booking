import { Component, input } from '@angular/core';

/**
 * The mark: a day as a ring, with the part that has been booked taken out of it.
 *
 * The subject of this whole application is machine time — a scanner is a
 * resource that fills up in blocks, and everything in the domain follows from
 * that: sessions, quotas, an exam's duration cutting a slot out of a morning.
 * So the mark is one dial and one appointment on it.
 *
 * The version before this drew the same idea as four horizontal bands with one
 * of them solid, and at 16 pixels it did not read as time at all. Four short
 * lines of different lengths inside a rounded green square is what a screenshot
 * of a screen looks like, or a paragraph of placeholder text: it was a picture
 * of an interface rather than a mark. A ring has one silhouette and keeps it at
 * every size.
 *
 * Two strokes on the same circle, deliberately unequal: the thin one is the day
 * and is held back, the thick one is the appointment. Equal weights would make
 * it the progress spinner every application already has. The thick stroke
 * starts at twelve o'clock — `rotate(-90)`, because SVG angles begin at three —
 * so the mark is asymmetrical and cannot be taken for a plain circle when it is
 * small.
 *
 * Drawn rather than fetched, and the same drawing is the favicon, so the two
 * cannot drift. `npm run check:mark` compares the geometry of both files.
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
      <!-- The day: the whole ring, and it has to be plainly THERE. At 45% it
           was not, and the mark stopped being a dial with a slot on it and
           became a white comma on a green square. -->
      <circle
        cx="16"
        cy="16"
        r="9.5"
        [attr.stroke]="quiet()"
        stroke-width="2.5"
        opacity="0.6"
      />
      <!-- The appointment: one block sitting on the ring. Square-cut rather
           than round, because round caps taper it into a tail and the shape
           reads as a swoosh; cut straight, the two edges are radial and it
           reads as a piece taken out of the day. A sixth of the ring, which is
           about what one appointment is against a morning. -->
      <circle
        cx="16"
        cy="16"
        r="9.5"
        [attr.stroke]="mark()"
        stroke-width="6"
        stroke-linecap="butt"
        stroke-dasharray="10 50"
        transform="rotate(-90 16 16)"
      />
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
