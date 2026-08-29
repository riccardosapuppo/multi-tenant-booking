import type { TenantRecord } from '../domain/tenant.js';
import type { SqlClient } from './sql-client.js';

const SERVICES: Readonly<Record<string, readonly string[]>> = {
  alpha: ['Synthetic imaging review', 'Demo ultrasound session', 'Sample consultation'],
  beta: ['Demo mobility assessment', 'Synthetic X-ray review', 'Sample follow-up'],
  gamma: ['Sample screening', 'Demo diagnostic review', 'Synthetic consultation'],
};

function nextDemoMorning(now: Date): Date {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCHours(9, 0, 0, 0);
  return date;
}

export async function seedTenant(
  client: SqlClient,
  tenant: TenantRecord,
  now = new Date(),
): Promise<void> {
  const services = SERVICES[tenant.slug];
  if (!services) throw new Error(`No synthetic seed is defined for tenant ${tenant.slug}.`);
  const start = nextDemoMorning(now);
  const slots = services.map((service, index) => ({
    id: index === 0 ? 'slot-shared' : `slot-open-${index}`,
    service,
    startAt: new Date(start.getTime() + index * 75 * 60_000).toISOString(),
    durationMinutes: 45 + index * 15,
    available: index !== 0,
  }));

  await client.transaction(async (transaction) => {
    for (const slot of slots) {
      await transaction.query(
        `INSERT INTO slots (id, service, start_at, duration_minutes, available)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
        [slot.id, slot.service, slot.startAt, slot.durationMinutes, slot.available],
      );
    }
    await transaction.query(
      `INSERT INTO bookings (id, slot_id, status, created_at)
       VALUES (?, ?, 'confirmed', ?) ON CONFLICT (id) DO NOTHING`,
      ['booking-shared', 'slot-shared', new Date(start.getTime() - 3_600_000).toISOString()],
    );
  });
}

export async function seedAllTenants(
  tenants: readonly TenantRecord[],
  connections: { clientForTenant(tenant: TenantRecord): Promise<SqlClient> },
): Promise<void> {
  for (const tenant of tenants) await seedTenant(await connections.clientForTenant(tenant), tenant);
}
