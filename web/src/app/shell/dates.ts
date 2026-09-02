/**
 * Dates and times, in one language.
 *
 * `toLocaleDateString([])` follows the browser, which meant an application
 * written in English showing "martedì 1 settembre" to anybody whose machine is
 * set to Italian — visible in the first screenshot of the reworked booking
 * screen, next to a heading that said "Preferred day".
 *
 * One locale, named here, so the interface reads the same for everybody. A
 * product that really is multilingual translates the whole interface and
 * chooses the locale with it; picking up the browser's locale for the dates
 * alone gives you neither.
 *
 * The times deliberately do not carry a zone. They are the centre's local
 * hours — see the note in backend/booking/availability.js — and stamping them
 * with the reader's zone would move a nine o'clock appointment on screen.
 */

const LOCALE = 'en-GB';

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}

export function dayOfWeek(date: string): string {
  return atMidnight(date).toLocaleDateString(LOCALE, { weekday: 'long' });
}

export function dayNumber(date: string): string {
  return String(atMidnight(date).getDate());
}

export function monthOf(date: string): string {
  return atMidnight(date).toLocaleDateString(LOCALE, { month: 'long' });
}

export function yearOf(date: string): string {
  return String(atMidnight(date).getFullYear());
}

export function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function shortWhen(iso: string): string {
  return new Date(iso).toLocaleString(LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * A `YYYY-MM-DD` as a local date.
 *
 * `new Date('2026-09-01')` is midnight UTC, which is the previous day for
 * anybody west of Greenwich — and this string names a day at a clinic, not an
 * instant. The time is appended so it is parsed locally.
 */
function atMidnight(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

/**
 * Today, as `YYYY-MM-DD`, in the zone the person is in.
 *
 * `new Date().toISOString().slice(0, 10)` was here and is the same defect that
 * was fixed in the backend: it converts to UTC first, so anywhere east of it
 * the early hours of the morning report yesterday. The desk opened on the
 * wrong day for anybody looking before 02:00 in summer — a diary that says
 * "nothing booked" when the day is full.
 */
export function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
