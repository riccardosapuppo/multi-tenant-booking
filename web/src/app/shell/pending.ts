import { Injectable, signal } from '@angular/core';

/**
 * The appointment somebody picked before they had an account.
 *
 * A visitor may search and choose a time without signing in -- that is the
 * point, because a booking screen that demands an account before it will show
 * you a single free slot is a screen most people close. What they cannot do is
 * hold it: a booking has to belong to somebody, so the last step sends them to
 * register, and this is what survives that journey.
 *
 * In `sessionStorage` rather than a signal alone. The journey is a route change
 * today, but it is one refresh away from being a lost choice, and somebody who
 * has just typed six fields into a registration form and lost their 9:20 will
 * not go back and pick another one.
 *
 * It is a choice, not a reservation. Nothing is held at the centre while this
 * sits here, and the time can be taken by somebody else in the meantime -- the
 * booking call answers 409 and the screen says so. Pretending otherwise would
 * mean a hold with an expiry, which is a real feature and not a demonstration
 * of one.
 */
export interface PickedSlot {
  centre: string;
  roomId: number;
  startsAt: string;
  examIds: number[];
  examNames: string[];
  category: string;
  date: string;
  siteName: string;
  roomName: string;
  modality: string;
  priceCents: number;
}

const KEY = 'picked-slot';

function read(): PickedSlot | null {
  try {
    const held = sessionStorage.getItem(KEY);
    return held ? (JSON.parse(held) as PickedSlot) : null;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class PendingService {
  readonly slot = signal<PickedSlot | null>(read());

  hold(slot: PickedSlot): void {
    this.slot.set(slot);
    try {
      sessionStorage.setItem(KEY, JSON.stringify(slot));
    } catch {
      // A browser refusing storage is not a reason to refuse the booking: the
      // signal still has it, and only a refresh loses it.
    }
  }

  drop(): void {
    this.slot.set(null);
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* nothing to undo */
    }
  }
}
