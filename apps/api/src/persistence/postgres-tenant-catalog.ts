import type { TenantCatalog, TenantRecord } from '../domain/tenant.js';
import { validateTenantRecord } from '../domain/tenant.js';
import type { SqlClient } from './sql-client.js';

interface TenantRow {
  id: string;
  slug: string;
  display_name: string;
  database_name: string;
}

function mapTenant(row: TenantRow): TenantRecord {
  return validateTenantRecord({
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    databaseName: row.database_name,
  });
}

export class PostgresTenantCatalog implements TenantCatalog {
  constructor(private readonly registry: SqlClient) {}

  async findBySlug(slug: string): Promise<TenantRecord | null> {
    const result = await this.registry.query<TenantRow>(
      'SELECT id, slug, display_name, database_name FROM tenants WHERE slug = ?',
      [slug],
    );
    return result.rows[0] ? mapTenant(result.rows[0]) : null;
  }

  async list(): Promise<TenantRecord[]> {
    const result = await this.registry.query<TenantRow>(
      'SELECT id, slug, display_name, database_name FROM tenants ORDER BY slug',
    );
    return result.rows.map(mapTenant);
  }
}
