import type { Booking, BookingSlot } from '../../../../packages/contracts/src/index.js';
import {
  BookingNotFoundError,
  SlotUnavailableError,
  type BookingStore,
} from '../domain/booking-service.js';
import type { SqlClient } from './sql-client.js';

interface SlotRow {
  id: string;
  service: string;
  start_at: string;
  duration_minutes: number;
  available: boolean | number;
}

interface BookingRow {
  id: string;
  slot_id: string;
  status: 'confirmed' | 'cancelled';
  created_at: string;
}

function mapSlot(row: SlotRow): BookingSlot {
  return {
    id: row.id,
    service: row.service,
    startAt: row.start_at,
    durationMinutes: Number(row.duration_minutes),
    available: Boolean(row.available),
  };
}

function mapBooking(row: BookingRow): Booking {
  return { id: row.id, slotId: row.slot_id, status: row.status, createdAt: row.created_at };
}

export class SqlBookingStore implements BookingStore {
  constructor(private readonly client: SqlClient) {}

  async listSlots(): Promise<BookingSlot[]> {
    const result = await this.client.query<SlotRow>(
      'SELECT id, service, start_at, duration_minutes, available FROM slots ORDER BY start_at',
    );
    return result.rows.map(mapSlot);
  }

  async listBookings(): Promise<Booking[]> {
    const result = await this.client.query<BookingRow>(
      "SELECT id, slot_id, status, created_at FROM bookings WHERE status = 'confirmed' ORDER BY created_at",
    );
    return result.rows.map(mapBooking);
  }

  async findBooking(id: string): Promise<Booking | null> {
    const result = await this.client.query<BookingRow>(
      'SELECT id, slot_id, status, created_at FROM bookings WHERE id = ?',
      [id],
    );
    return result.rows[0] ? mapBooking(result.rows[0]) : null;
  }

  async createBooking(id: string, slotId: string, createdAt: string): Promise<Booking> {
    return this.client.transaction(async (transaction) => {
      const reservation = await transaction.query(
        'UPDATE slots SET available = FALSE WHERE id = ? AND available = TRUE',
        [slotId],
      );
      if (reservation.rowCount !== 1) throw new SlotUnavailableError('The slot is no longer available.');
      await transaction.query(
        "INSERT INTO bookings (id, slot_id, status, created_at) VALUES (?, ?, 'confirmed', ?)",
        [id, slotId, createdAt],
      );
      return { id, slotId, status: 'confirmed', createdAt };
    });
  }

  async cancelBooking(id: string): Promise<Booking> {
    return this.client.transaction(async (transaction) => {
      const found = await transaction.query<BookingRow>(
        'SELECT id, slot_id, status, created_at FROM bookings WHERE id = ?',
        [id],
      );
      const row = found.rows[0];
      if (!row) throw new BookingNotFoundError('Booking not found in this tenant.');
      if (row.status === 'cancelled') return mapBooking(row);
      await transaction.query("UPDATE bookings SET status = 'cancelled' WHERE id = ?", [id]);
      await transaction.query('UPDATE slots SET available = TRUE WHERE id = ?', [row.slot_id]);
      return { ...mapBooking(row), status: 'cancelled' };
    });
  }
}
