import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Booking, TenantSnapshot } from '../packages/contracts/src/index.js';
import {
  createTestRuntime,
  migrationVersions,
  type TestRuntime,
} from './support/test-runtime.js';

describe('tenant isolation', () => {
  let runtime: TestRuntime;

  beforeEach(async () => {
    runtime = await createTestRuntime();
  });

  afterEach(async () => {
    await runtime.close();
  });

  it('keeps deliberately identical IDs in three different databases', async () => {
    const expectedServices: Readonly<Record<string, string>> = {
      alpha: 'Synthetic imaging review',
      beta: 'Demo mobility assessment',
      gamma: 'Sample screening',
    };

    for (const tenant of runtime.tenants) {
      const response = await request(runtime.app)
        .get('/api/state')
        .set('Host', 'localhost')
        .set('X-Tenant-Slug', tenant.slug)
        .expect(200);
      const state = response.body as TenantSnapshot;
      expect(state.tenant.slug).toBe(tenant.slug);
      expect(state.slots.find(({ id }) => id === 'slot-shared')?.service).toBe(expectedServices[tenant.slug]);
      expect(state.bookings.some(({ id }) => id === 'booking-shared')).toBe(true);
    }
  });

  it('cannot read a booking created in another tenant', async () => {
    const created = await request(runtime.app)
      .post('/api/bookings')
      .set('X-Tenant-Slug', 'alpha')
      .send({ slotId: 'slot-open-1' })
      .expect(201);
    const booking = created.body as Booking;

    await request(runtime.app)
      .get(`/api/bookings/${booking.id}`)
      .set('X-Tenant-Slug', 'beta')
      .expect(404);
    await request(runtime.app)
      .get(`/api/bookings/${booking.id}`)
      .set('X-Tenant-Slug', 'alpha')
      .expect(200);
  });

  it('uses the header as the portable primary route', async () => {
    const response = await request(runtime.app)
      .get('/api/state')
      .set('Host', 'localhost')
      .set('X-Tenant-Slug', 'beta')
      .expect(200);
    expect((response.body as TenantSnapshot).tenant.slug).toBe('beta');
  });

  it('supports a localhost subdomain when the client resolves it', async () => {
    const response = await request(runtime.app)
      .get('/api/state')
      .set('Host', 'gamma.localhost')
      .expect(200);
    expect((response.body as TenantSnapshot).tenant.slug).toBe('gamma');
  });

  it('rejects a conflicting hostname and header', async () => {
    await request(runtime.app)
      .get('/api/state')
      .set('Host', 'beta.localhost')
      .set('X-Tenant-Slug', 'alpha')
      .expect(400, { error: 'Tenant header and hostname disagree.' });
  });

  it('rejects unknown and missing tenant contexts', async () => {
    await request(runtime.app).get('/api/state').set('X-Tenant-Slug', 'unknown').expect(404);
    await request(runtime.app).get('/api/state').set('Host', 'localhost').expect(400);
  });

  it('applies the migration set to every tenant database', async () => {
    for (const tenant of runtime.tenants) {
      const client = await runtime.connections.clientForTenant(tenant);
      expect(await migrationVersions(client)).toEqual(['001_booking_tables']);
    }
  });

  it('allows only one caller to reserve the same slot', async () => {
    const calls = await Promise.all([
      request(runtime.app).post('/api/bookings').set('X-Tenant-Slug', 'gamma').send({ slotId: 'slot-open-1' }),
      request(runtime.app).post('/api/bookings').set('X-Tenant-Slug', 'gamma').send({ slotId: 'slot-open-1' }),
    ]);
    expect(calls.map(({ status }) => status).sort()).toEqual([201, 409]);
  });

  it('cancels within one tenant without changing the others', async () => {
    await request(runtime.app)
      .delete('/api/bookings/booking-shared')
      .set('X-Tenant-Slug', 'alpha')
      .expect(200);

    const alpha = await request(runtime.app).get('/api/state').set('X-Tenant-Slug', 'alpha');
    const beta = await request(runtime.app).get('/api/state').set('X-Tenant-Slug', 'beta');
    expect((alpha.body as TenantSnapshot).bookings).toHaveLength(0);
    expect((beta.body as TenantSnapshot).bookings).toHaveLength(1);
  });
});
