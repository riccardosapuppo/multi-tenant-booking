import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';

import { AUTHOR, VERSION } from '../../../../packages/contracts/src/index.js';
import type { CreateBookingRequest } from '../../../../packages/contracts/src/index.js';
import {
  BookingNotFoundError,
  BookingService,
  SlotUnavailableError,
} from '../domain/booking-service.js';
import type { TenantCatalog } from '../domain/tenant.js';
import {
  TenantResolutionError,
  tenantMiddleware,
  type TenantLocals,
} from './tenant-resolver.js';

function asyncHandler(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (request, response, next) => void handler(request, response, next).catch(next);
}

function tenantFrom(response: Response) {
  return (response.locals as TenantLocals).tenant;
}

function routeParameter(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export function createApp(catalog: TenantCatalog, bookings: BookingService) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/health', (_request, response) =>
    response.json({ status: 'ok', version: VERSION, author: AUTHOR })
  );
  app.get('/api/tenants', asyncHandler(async (_request, response) => {
    const tenants = await catalog.list();
    response.json(tenants.map(({ id, slug, displayName }) => ({ id, slug, displayName })));
  }));

  app.use('/api', tenantMiddleware(catalog));

  app.get('/api/state', asyncHandler(async (_request, response) => {
    response.json(await bookings.snapshot(tenantFrom(response)));
  }));

  app.get('/api/bookings/:id', asyncHandler(async (request, response) => {
    response.json(await bookings.findBooking(tenantFrom(response), routeParameter(request.params['id'])));
  }));

  app.post('/api/bookings', asyncHandler(async (request, response) => {
    const body = request.body as Partial<CreateBookingRequest> | null;
    if (!body || typeof body.slotId !== 'string' || body.slotId.length > 100) {
      response.status(400).json({ error: 'slotId is required.' });
      return;
    }
    response.status(201).json(await bookings.createBooking(tenantFrom(response), body.slotId));
  }));

  app.delete('/api/bookings/:id', asyncHandler(async (request, response) => {
    response.json(await bookings.cancelBooking(tenantFrom(response), routeParameter(request.params['id'])));
  }));

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof TenantResolutionError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof SlotUnavailableError) {
      response.status(409).json({ error: error.message });
      return;
    }
    if (error instanceof BookingNotFoundError) {
      response.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof SyntaxError) {
      response.status(400).json({ error: 'Request JSON is invalid.' });
      return;
    }
    console.error(error);
    response.status(500).json({ error: 'The request could not be completed.' });
  });

  return app;
}
