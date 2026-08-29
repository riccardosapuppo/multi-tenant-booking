import type { BookingStore, TenantStoreProvider } from '../domain/booking-service.js';
import type { TenantRecord } from '../domain/tenant.js';
import { SqlBookingStore } from './sql-booking-store.js';
import type { SqlClient, SqlClientFactory } from './sql-client.js';

interface RegisteredConnection {
  databaseName: string;
  client: Promise<SqlClient>;
}

export class TenantConnectionRegistry implements TenantStoreProvider {
  private readonly connections = new Map<string, RegisteredConnection>();

  constructor(private readonly createClient: SqlClientFactory) {}

  async clientForTenant(tenant: TenantRecord): Promise<SqlClient> {
    const existing = this.connections.get(tenant.id);
    if (existing) {
      if (existing.databaseName !== tenant.databaseName) {
        throw new Error(`Tenant ${tenant.id} changed its database mapping at runtime.`);
      }
      return existing.client;
    }

    const client = this.createClient(tenant.databaseName);
    this.connections.set(tenant.id, { databaseName: tenant.databaseName, client });
    return client;
  }

  async forTenant(tenant: TenantRecord): Promise<BookingStore> {
    return new SqlBookingStore(await this.clientForTenant(tenant));
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.connections.values()].map(async ({ client }) => (await client).close?.()),
    );
    this.connections.clear();
  }
}
