import type { Express } from 'express';

import { BookingService } from '../../apps/api/src/domain/booking-service.js';
import type { TenantCatalog, TenantRecord } from '../../apps/api/src/domain/tenant.js';
import { validateTenantRecord } from '../../apps/api/src/domain/tenant.js';
import { createApp } from '../../apps/api/src/http/app.js';
import { seedTenant } from '../../apps/api/src/persistence/demo-seed.js';
import { migrateAllTenants } from '../../apps/api/src/persistence/migrations.js';
import type { SqlClient } from '../../apps/api/src/persistence/sql-client.js';
import { TenantConnectionRegistry } from '../../apps/api/src/persistence/tenant-connection-registry.js';
import { loadSqlJs, SqlJsClient } from './sqljs-client.js';

const TENANTS: readonly TenantRecord[] = [
  validateTenantRecord({ id: 'tenant-alpha', slug: 'alpha', displayName: 'Demo Center Alpha', databaseName: 'booking_alpha' }),
  validateTenantRecord({ id: 'tenant-beta', slug: 'beta', displayName: 'Demo Center Beta', databaseName: 'booking_beta' }),
  validateTenantRecord({ id: 'tenant-gamma', slug: 'gamma', displayName: 'Demo Center Gamma', databaseName: 'booking_gamma' }),
];

class StaticTenantCatalog implements TenantCatalog {
  async findBySlug(slug: string): Promise<TenantRecord | null> {
    return TENANTS.find((tenant) => tenant.slug === slug) ?? null;
  }

  async list(): Promise<TenantRecord[]> {
    return [...TENANTS];
  }
}

export interface TestRuntime {
  app: Express;
  tenants: readonly TenantRecord[];
  connections: TenantConnectionRegistry;
  close(): Promise<void>;
}

export async function createTestRuntime(): Promise<TestRuntime> {
  const SQL = await loadSqlJs();
  const catalog = new StaticTenantCatalog();
  const connections = new TenantConnectionRegistry(async () => new SqlJsClient(new SQL.Database()));
  await migrateAllTenants(catalog, connections);
  const fixedNow = new Date('2030-01-14T08:00:00.000Z');
  for (const tenant of TENANTS) {
    await seedTenant(await connections.clientForTenant(tenant), tenant, fixedNow);
  }
  let nextBooking = 0;
  const bookings = new BookingService(
    connections,
    () => `booking-created-${++nextBooking}`,
    () => new Date('2030-01-14T08:30:00.000Z'),
  );
  return {
    app: createApp(catalog, bookings),
    tenants: TENANTS,
    connections,
    close: () => connections.close(),
  };
}

export async function migrationVersions(client: SqlClient): Promise<string[]> {
  const result = await client.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version',
  );
  return result.rows.map(({ version }) => version);
}
