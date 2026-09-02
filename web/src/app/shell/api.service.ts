import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Account, CentreGrant } from './session.service';

export interface Exam {
  id: number;
  code: string;
  name: string;
  modality: string;
  minutes: number;
  price_cents: number;
  bookable: boolean;
  notes: string | null;
}

export interface Room {
  id: number;
  code: string;
  name: string;
  modality: string;
  site_name: string;
}

export interface Availability {
  day: string;
  minutes: number;
  times: string[];
  closed: Array<{ session: number; opens: string; closes: string; reason: string }>;
}

export interface Site {
  id: number;
  name: string;
  address: string;
}

export interface SearchDay {
  date: string;
  priceCents: number;
  minutes: number;
  siteName: string;
  roomId: number;
  roomName: string;
  modality: string;
  times: string[];
}

export interface SearchAnswer {
  ok: boolean;
  reason?: string;
  minutes: number;
  priceCents: number;
  exams?: Array<{ id: number; code: string; name: string }>;
  days: SearchDay[];
  closed: Array<{ day: string; opens: string; closes: string; reason: string }>;
}

export interface Booking {
  id: number;
  reference: string;
  patient_name: string;
  category: string;
  status: string;
  starts_at: string;
  ends_at: string;
  total_cents: number;
  room_name?: string;
  site_name?: string;
  exams?: Array<{ name: string; code: string }>;
}

export interface Centre {
  id: number;
  slug: string;
  name: string;
  timezone: string;
  active: boolean;
  options: Record<string, unknown>;
  people?: Record<string, number>;
}

/** Every call the interface makes, in one place, with the shapes written down. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  signIn(email: string, password: string): Observable<any> {
    return this.http.post('/api/auth/session', { email, password });
  }

  /** Who this token belongs to, and what it may do. Read on every start. */
  me(): Observable<{ user: Account; centres: CentreGrant[]; platformAdmin: boolean }> {
    return this.http.get<{ user: Account; centres: CentreGrant[]; platformAdmin: boolean }>(
      '/api/auth/me'
    );
  }

  signOut(): Observable<void> {
    return this.http.delete<void>('/api/auth/session');
  }

  exams(): Observable<{ exams: Exam[] }> {
    return this.http.get<{ exams: Exam[] }>('/api/centre/exams');
  }

  rooms(examId: number): Observable<{ rooms: Room[] }> {
    return this.http.get<{ rooms: Room[] }>(`/api/centre/exams/${examId}/rooms`);
  }

  availability(roomId: number, examId: number, category: string, day: string): Observable<Availability> {
    return this.http.get<Availability>(
      `/api/centre/availability?room=${roomId}&exam=${examId}&category=${category}&day=${day}`
    );
  }

  sites(): Observable<{ sites: Site[] }> {
    return this.http.get<{ sites: Site[] }>('/api/centre/sites');
  }

  /** Days with times on them, for several exams and a set of preferences. */
  search(body: {
    examIds: number[];
    category: string;
    siteId: number | null;
    weekday: number | null;
    part: string;
  }): Observable<SearchAnswer> {
    return this.http.post<SearchAnswer>('/api/centre/search', body);
  }

  book(body: {
    roomId: number;
    startsAt: string;
    examIds: number[];
    patientName: string;
    category: string;
  }): Observable<{ booking: Booking }> {
    return this.http.post<{ booking: Booking }>('/api/centre/bookings', body);
  }

  myBookings(): Observable<{ bookings: Booking[] }> {
    return this.http.get<{ bookings: Booking[] }>('/api/centre/bookings/mine');
  }

  cancel(reference: string): Observable<void> {
    return this.http.delete<void>(`/api/centre/bookings/${reference}`);
  }

  diary(day: string): Observable<{ day: string; bookings: Booking[]; totals: Record<string, number> }> {
    return this.http.get<{ day: string; bookings: Booking[]; totals: Record<string, number> }>(
      `/api/centre/desk/diary?day=${day}`
    );
  }

  deskRooms(): Observable<{ rooms: any[] }> {
    return this.http.get<{ rooms: any[] }>('/api/centre/desk/rooms');
  }

  /**
   * The whole price list, including what cannot be booked online.
   *
   * Not the same call as `exams()`, which patients make: that one returns only
   * what is bookable, because offering somebody an exam they cannot book is a
   * dead end. This is the centre's own list, and it has to include the exams
   * that are switched off — otherwise the screen for switching them back on
   * cannot show them.
   */
  priceList(): Observable<{ exams: Exam[] }> {
    return this.http.get<{ exams: Exam[] }>('/api/centre/desk/exams');
  }

  reprice(
    id: number,
    change: { price_cents?: number; minutes?: number; bookable?: boolean }
  ): Observable<{ exam: Exam }> {
    return this.http.patch<{ exam: Exam }>(`/api/centre/desk/exams/${id}`, change);
  }

  centres(): Observable<{ centres: Centre[] }> {
    return this.http.get<{ centres: Centre[] }>('/api/platform/centres');
  }

  createCentre(body: { slug: string; name: string; options?: Record<string, unknown> }): Observable<{ centre: Centre }> {
    return this.http.post<{ centre: Centre }>('/api/platform/centres', body);
  }

  updateCentre(slug: string, body: Record<string, unknown>): Observable<{ centre: Centre }> {
    return this.http.patch<{ centre: Centre }>(`/api/platform/centres/${slug}`, body);
  }

  removeCentre(slug: string): Observable<void> {
    return this.http.request<void>('delete', `/api/platform/centres/${slug}`, {
      body: { confirm: slug },
    });
  }
}
