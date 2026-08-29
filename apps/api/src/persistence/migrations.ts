import type { TenantCatalog, TenantRecord } from '../domain/tenant.js';
import type { SqlClient } from './sql-client.js';
import type { TenantConnectionRegistry } from './tenant-connection-registry.js';

interface Migration {
  version: string;
  statements: readonly string[];
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: '001_booking_tables',
    statements: [
      `CREATE TABLE IF NOT EXISTS slots (
        id TEXT PRIMARY KEY,
        service TEXT NOT NULL,
        start_at TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        available BOOLEAN NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY,
        slot_id TEXT NOT NULL REFERENCES slots(id),
        status TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled')),
        created_at TEXT NOT NULL
      )`,
    ],
  },
];

export interface TenantMigrationResult {
  tenant: TenantRecord;
  applied: string[];
}

export async function migrateTenant(client: SqlClient): Promise<string[]> {
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  const applied: string[] = [];
  for (const migration of MIGRATIONS) {
    const found = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations WHERE version = ?',
      [migration.version],
    );
    if (found.rows.length > 0) continue;
    await client.transaction(async (transaction) => {
      for (const statement of migration.statements) await transaction.query(statement);
      await transaction.query(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
        [migration.version, new Date().toISOString()],
      );
    });
    applied.push(migration.version);
  }
  return applied;
}

export async function migrateAllTenants(
  catalog: TenantCatalog,
  connections: TenantConnectionRegistry,
): Promise<TenantMigrationResult[]> {
  const results: TenantMigrationResult[] = [];
  for (const tenant of await catalog.list()) {
    results.push({ tenant, applied: await migrateTenant(await connections.clientForTenant(tenant)) });
  }
  return results;
}
