export { VERSION, AUTHOR } from './version.js';
export interface TenantSummary {
  id: string;
  slug: string;
  displayName: string;
}

export interface BookingSlot {
  id: string;
  service: string;
  startAt: string;
  durationMinutes: number;
  available: boolean;
}

export interface Booking {
  id: string;
  slotId: string;
  status: 'confirmed' | 'cancelled';
  createdAt: string;
}

export interface TenantSnapshot {
  tenant: TenantSummary;
  slots: BookingSlot[];
  bookings: Booking[];
}

export interface CreateBookingRequest {
  slotId: string;
}

export interface ApiFailure {
  error: string;
}
