import { randomUUID } from 'node:crypto';

import type {
  Booking,
  BookingSlot,
  TenantSnapshot,
} from '../../../../packages/contracts/src/index.js';
import type { TenantRecord } from './tenant.js';

export class SlotUnavailableError extends Error {}
export class BookingNotFoundError extends Error {}

export interface BookingStore {
  listSlots(): Promise<BookingSlot[]>;
  listBookings(): Promise<Booking[]>;
  findBooking(id: string): Promise<Booking | null>;
  createBooking(id: string, slotId: string, createdAt: string): Promise<Booking>;
  cancelBooking(id: string): Promise<Booking>;
}

export interface TenantStoreProvider {
  forTenant(tenant: TenantRecord): Promise<BookingStore>;
}

export class BookingService {
  constructor(
    private readonly stores: TenantStoreProvider,
    private readonly createId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async snapshot(tenant: TenantRecord): Promise<TenantSnapshot> {
    const store = await this.stores.forTenant(tenant);
    const [slots, bookings] = await Promise.all([store.listSlots(), store.listBookings()]);
    return {
      tenant: { id: tenant.id, slug: tenant.slug, displayName: tenant.displayName },
      slots,
      bookings,
    };
  }

  async findBooking(tenant: TenantRecord, id: string): Promise<Booking> {
    const booking = await (await this.stores.forTenant(tenant)).findBooking(id);
    if (!booking) throw new BookingNotFoundError('Booking not found in this tenant.');
    return booking;
  }

  async createBooking(tenant: TenantRecord, slotId: string): Promise<Booking> {
    if (!slotId.trim()) throw new SlotUnavailableError('A slot is required.');
    return (await this.stores.forTenant(tenant)).createBooking(
      this.createId(),
      slotId,
      this.now().toISOString(),
    );
  }

  async cancelBooking(tenant: TenantRecord, id: string): Promise<Booking> {
    return (await this.stores.forTenant(tenant)).cancelBooking(id);
  }
}
