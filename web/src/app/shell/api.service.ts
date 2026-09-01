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
