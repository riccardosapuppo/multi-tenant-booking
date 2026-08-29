import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';

import type {
  Booking,
  BookingSlot,
  TenantSnapshot,
  TenantSummary,
} from '../../../../packages/contracts/src/index';
import { BookingApiService } from './booking-api.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  readonly tenants = signal<TenantSummary[]>([]);
  readonly selectedSlug = signal('alpha');
  readonly snapshot = signal<TenantSnapshot | null>(null);
  readonly loading = signal(true);
  readonly workingId = signal<string | null>(null);
  readonly error = signal('');
  readonly notice = signal('');

  constructor(private readonly api: BookingApiService) {}

  async ngOnInit(): Promise<void> {
    try {
      this.tenants.set(await this.api.tenants());
      await this.loadTenant('alpha');
    } catch (error: unknown) {
      this.error.set(this.api.message(error));
      this.loading.set(false);
    }
  }

  async loadTenant(slug: string): Promise<void> {
    this.selectedSlug.set(slug);
    this.loading.set(true);
    this.clearMessages();
    try {
      this.snapshot.set(await this.api.snapshot(slug));
    } catch (error: unknown) {
      this.error.set(this.api.message(error));
    } finally {
      this.loading.set(false);
    }
  }

  async book(slot: BookingSlot): Promise<void> {
    this.workingId.set(slot.id);
    this.clearMessages();
    try {
      await this.api.book(this.selectedSlug(), slot.id);
      this.notice.set(`${slot.service} is now booked in this tenant only.`);
      this.snapshot.set(await this.api.snapshot(this.selectedSlug()));
    } catch (error: unknown) {
      this.error.set(this.api.message(error));
    } finally {
      this.workingId.set(null);
    }
  }

  async cancel(booking: Booking): Promise<void> {
    this.workingId.set(booking.id);
    this.clearMessages();
    try {
      await this.api.cancel(this.selectedSlug(), booking.id);
      this.notice.set('The booking was cancelled and its slot is available again.');
      this.snapshot.set(await this.api.snapshot(this.selectedSlug()));
    } catch (error: unknown) {
      this.error.set(this.api.message(error));
    } finally {
      this.workingId.set(null);
    }
  }

  bookingFor(slot: BookingSlot): Booking | undefined {
    return this.snapshot()?.bookings.find((booking) => booking.slotId === slot.id);
  }

  availableCount(): number {
    return this.snapshot()?.slots.filter((slot) => slot.available).length ?? 0;
  }

  private clearMessages(): void {
    this.error.set('');
    this.notice.set('');
  }
}
