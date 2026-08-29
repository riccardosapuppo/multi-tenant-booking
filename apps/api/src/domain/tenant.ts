import type { TenantSummary } from '../../../../packages/contracts/src/index.js';

export interface TenantRecord extends TenantSummary {
  databaseName: string;
}

export interface TenantCatalog {
  findBySlug(slug: string): Promise<TenantRecord | null>;
  list(): Promise<TenantRecord[]>;
}

const SAFE_SLUG = /^[a-z][a-z0-9-]{0,31}$/;
const SAFE_DATABASE_NAME = /^booking_[a-z][a-z0-9_]{0,31}$/;

export function validateTenantRecord(tenant: TenantRecord): TenantRecord {
  if (!SAFE_SLUG.test(tenant.slug)) {
    throw new Error(`Tenant ${tenant.id} has an invalid slug.`);
  }
  if (!SAFE_DATABASE_NAME.test(tenant.databaseName)) {
    throw new Error(`Tenant ${tenant.id} has an invalid database name.`);
  }
  return tenant;
}
