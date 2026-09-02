import { Injectable, computed, signal } from '@angular/core';

/**
 * Who is signed in, and which centre they are looking at.
 *
 * These are two separate things and the whole interface depends on not
 * confusing them. One account can be a patient at one centre and staff at
 * another, so "what may I do" has no answer until you also say "here". Every
 * screen asks this service both questions, and the answer to the second one is
 * a choice the person makes and can change without signing in again.
 *
 * The centre is kept in localStorage so a refresh does not throw somebody back
 * to the beginning; the token is kept there too. That is a demonstration's
 * trade-off and it is written down rather than glossed: a token in
 * localStorage is readable by any script that gets onto the page, and the
 * production answer is a httpOnly cookie with a CSRF token. Here the whole
 * platform is a container on the reader's own machine.
 */

export type Role = 'patient' | 'staff' | 'centre_admin';

export interface CentreGrant {
  slug: string;
  role: Role;
}

export interface Account {
  id: number;
  email: string;
  name: string;
}

const TOKEN_KEY = 'booking.token';
const CENTRE_KEY = 'booking.centre';

@Injectable({ providedIn: 'root' })
export class SessionService {
  readonly token = signal<string | null>(read(TOKEN_KEY));
  readonly account = signal<Account | null>(null);
  readonly grants = signal<CentreGrant[]>([]);
  readonly platformAdmin = signal(false);
  readonly centre = signal<string | null>(read(CENTRE_KEY));

  readonly signedIn = computed(() => this.token() !== null && this.account() !== null);

  /**
   * True until a token found in storage has been checked with the server.
   *
   * Without this the application logs you out every time you refresh the page.
   * The token survives in localStorage and the account does not, so `signedIn`
   * is false for the moment it takes to ask who the token belongs to — and the
   * route guard, which runs immediately, sends you to the sign-in page with a
   * perfectly good session in your pocket. Found by taking a screenshot of the
   * booking page and getting a picture of the sign-in form.
   */
  readonly restoring = signal(read(TOKEN_KEY) !== null);

  /**
   * Settled once the stored token has been checked, one way or the other.
   *
   * The guards await this instead of reading `restoring` and guessing. Fixing
   * only `signedIn` was not enough and the failure moved one level along: the
   * role guards were still evaluated while the account was being fetched, so
   * opening /console directly with a perfectly good platform-admin session
   * bounced to /book — visible in a screenshot as an administrator looking at
   * a booking page with an error on it.
   */
  private settle: (() => void) | null = null;

  readonly ready: Promise<void> = this.restoring()
    ? new Promise<void>((resolve) => {
        this.settle = resolve;
      })
    : Promise.resolve();

  /** What this person may do at the centre they are currently looking at. */
  readonly roleHere = computed<Role | null>(() => {
    const slug = this.centre();
    if (!slug) return null;
    return this.grants().find((grant) => grant.slug === slug)?.role ?? null;
  });

  readonly canUseDesk = computed(() => {
    const role = this.roleHere();
    return role === 'staff' || role === 'centre_admin';
  });

  readonly canEditCentre = computed(() => this.roleHere() === 'centre_admin');

  begin(token: string, account: Account, grants: CentreGrant[], platformAdmin: boolean): void {
    this.token.set(token);
    this.account.set(account);
    this.grants.set(grants);
    this.platformAdmin.set(platformAdmin);
    this.done();
    write(TOKEN_KEY, token);

    // Somewhere sensible to land: where they already were if they still have a
    // role there, otherwise the first centre they belong to.
    const current = this.centre();
    const stillValid = current && grants.some((grant) => grant.slug === current);
    if (!stillValid) this.lookAt(grants[0]?.slug ?? null);
  }

  end(): void {
    this.token.set(null);
    this.account.set(null);
    this.grants.set([]);
    this.platformAdmin.set(false);
    this.done();
    write(TOKEN_KEY, null);

    // The centre goes too. It is a choice the person made, not a setting of
    // the browser, and leaving it behind means the next person to sign in on
    // this machine lands in whichever centre the last one was looking at —
    // which for somebody who works at two of them is a genuinely confusing
    // start, and for a demonstration looks like the isolation is broken.
    this.lookAt(null);
  }

  /**
   * A token that turned out to be no good.
   *
   * Expired, or belonging to a session an administrator ended — which the
   * server can do, because sessions are rows. Dropped quietly: the person did
   * not ask to be signed out and does not need an error about it, they just
   * need the sign-in page.
   */
  stale(): void {
    this.end();
  }

  /** Ends the waiting, once, whichever way the check went. */
  private done(): void {
    this.restoring.set(false);
    if (this.settle) {
      this.settle();
      this.settle = null;
    }
  }

  lookAt(slug: string | null): void {
    this.centre.set(slug);
    write(CENTRE_KEY, slug);
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Private windows and blocked site data throw on access rather than
    // returning null. Signing in still works; it just will not be remembered.
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* as above */
  }
}
