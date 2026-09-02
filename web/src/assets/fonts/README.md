# The typeface

**Manrope**, variable, 200–800, by Mikhail Sharanda — SIL Open Font License 1.1.
The licence is in `OFL.txt` beside the files, as it must be.

Two files, 34 KB together: `manrope-latin.woff2` and `manrope-latin-ext.woff2`.
The extended one carries the accented characters Latin does not and is only
fetched by browsers that need a glyph from it.

## Why it is in the repository rather than fetched

The first version of this interface used no web font at all, on the grounds
that the application runs in containers with no network and a stylesheet that
quietly fetches a typeface makes that untrue. That reasoning was right and the
conclusion was wrong: the result was Segoe UI, which reads as an interface from
2012, and "it had to be" was not a good enough answer.

A font file in the repository has neither problem. Nothing is fetched at
runtime, the demonstration still works with the network unplugged, and the
interface has a voice. Thirty-four kilobytes is less than one of the
screenshots in `docs/`.

## Why this one

It is drawn a little narrow, which is what lets a table of exam names, times
and prices stay dense without being cramped — the desk screen is a list of
appointments and the point is fitting a day on the screen. Its figures are
strong and even, which matters here more than usual: this interface is mostly
numbers, and one of them is set at 2.6rem on every day card.

And it is not Inter, which is the typeface everything reaches for and which
would have made the whole thing look like every other dashboard.
