import type { NextFunction, Request, Response } from 'express';

import type { TenantCatalog, TenantRecord } from '../domain/tenant.js';

const SAFE_SLUG = /^[a-z][a-z0-9-]{0,31}$/;

export class TenantResolutionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404,
  ) {
    super(message);
  }
}

export function tenantSlugFromHostname(hostname: string): string | null {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  if (!normalized.endsWith('.localhost')) return null;
  const prefix = normalized.slice(0, -'.localhost'.length);
  return SAFE_SLUG.test(prefix) ? prefix : null;
}

export function resolveTenantSlug(headerValue: string | undefined, hostname: string): string {
  const headerSlug = headerValue?.trim().toLowerCase() || null;
  if (headerSlug && !SAFE_SLUG.test(headerSlug)) {
    throw new TenantResolutionError('X-Tenant-Slug has an invalid format.', 400);
  }
  const hostSlug = tenantSlugFromHostname(hostname);
  if (headerSlug && hostSlug && headerSlug !== hostSlug) {
    throw new TenantResolutionError('Tenant header and hostname disagree.', 400);
  }
  const slug = headerSlug ?? hostSlug;
  if (!slug) {
    throw new TenantResolutionError('Send X-Tenant-Slug to select a demo center.', 400);
  }
  return slug;
}

export interface TenantLocals {
  tenant: TenantRecord;
}

export function tenantMiddleware(catalog: TenantCatalog) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const slug = resolveTenantSlug(request.get('X-Tenant-Slug'), request.hostname);
      const tenant = await catalog.findBySlug(slug);
      if (!tenant) throw new TenantResolutionError('Unknown tenant.', 404);
      (response.locals as TenantLocals).tenant = tenant;
      next();
    } catch (error: unknown) {
      next(error);
    }
  };
}
