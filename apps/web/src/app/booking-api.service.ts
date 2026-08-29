import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type {
  Booking,
  TenantSnapshot,
  TenantSummary,
} from '../../../../packages/contracts/src/index';

@Injectable({ providedIn: 'root' })
export class BookingApiService {
  constructor(private readonly http: HttpClient) {}

  tenants(): Promise<TenantSummary[]> {
    return firstValueFrom(this.http.get<TenantSummary[]>('/api/tenants'));
  }

  snapshot(slug: string): Promise<TenantSnapshot> {
    return firstValueFrom(this.http.get<TenantSnapshot>('/api/state', { headers: this.headers(slug) }));
  }

  book(slug: string, slotId: string): Promise<Booking> {
    return firstValueFrom(
      this.http.post<Booking>('/api/bookings', { slotId }, { headers: this.headers(slug) }),
    );
  }

  cancel(slug: string, bookingId: string): Promise<Booking> {
    return firstValueFrom(
      this.http.delete<Booking>(`/api/bookings/${encodeURIComponent(bookingId)}`, {
        headers: this.headers(slug),
      }),
    );
  }

  message(error: unknown): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.error === 'string') {
      return error.error.error;
    }
    return 'The demo API could not be reached.';
  }

  private headers(slug: string): HttpHeaders {
    return new HttpHeaders({ 'X-Tenant-Slug': slug });
  }
}
