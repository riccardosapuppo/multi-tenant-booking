import { BookingService } from './domain/booking-service.js';
import { createApp } from './http/app.js';
import { seedAllTenants } from './persistence/demo-seed.js';
import { migrateAllTenants } from './persistence/migrations.js';
import { PostgresSqlClient } from './persistence/postgres-client.js';
import { PostgresTenantCatalog } from './persistence/postgres-tenant-catalog.js';
import { TenantConnectionRegistry } from './persistence/tenant-connection-registry.js';

function environment(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function start(): Promise<void> {
  const host = environment('POSTGRES_HOST', 'localhost');
  const port = Number(environment('POSTGRES_PORT', '5432'));
  const user = environment('POSTGRES_USER');
  const password = environment('POSTGRES_PASSWORD');
  const registryDatabase = environment('REGISTRY_DATABASE', 'tenant_registry');
  const httpPort = Number(environment('PORT', '3000'));

  const registryClient = PostgresSqlClient.connect({ host, port, user, password, database: registryDatabase });
  const catalog = new PostgresTenantCatalog(registryClient);
  const connections = new TenantConnectionRegistry(async (database) =>
    PostgresSqlClient.connect({ host, port, user, password, database }),
  );

  const migrationResults = await migrateAllTenants(catalog, connections);
  const tenants = migrationResults.map(({ tenant }) => tenant);
  await seedAllTenants(tenants, connections);

  const app = createApp(catalog, new BookingService(connections));
  const server = app.listen(httpPort, () => {
    const migrated = migrationResults.map(({ tenant }) => tenant.slug).join(', ');
    console.log(`Booking API listening on port ${httpPort}; tenants ready: ${migrated}.`);
  });

  const shutdown = () => {
    server.close(() => {
      void Promise.all([registryClient.close(), connections.close()]).then(() => process.exit(0));
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

start().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
