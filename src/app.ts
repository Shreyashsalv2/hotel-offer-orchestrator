import express from 'express';
import path from 'node:path';
import pinoHttp from 'pino-http';
import { logger } from './logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { healthRouter } from './routes/health.routes';
import { hotelsRouter } from './routes/hotels.routes';
import { supplierARouter, supplierBRouter } from './routes/suppliers.routes';
import { BestOffer, HotelOffersWorkflowResult, SupplierId } from './types';

/** External collaborators, injected so the HTTP layer can be tested in isolation. */
export interface AppDeps {
  runHotelOffersWorkflow(city: string): Promise<HotelOffersWorkflowResult>;
  findHotelsByPrice(city: string, minPrice?: number, maxPrice?: number): Promise<BestOffer[]>;
  checkSupplier(id: SupplierId): Promise<boolean>;
  checkRedis(): Promise<boolean>;
  checkTemporal(): Promise<boolean>;
  checkWorker(): Promise<boolean>;
}

export function createApp(deps: AppDeps, opts: { httpLogging?: boolean } = {}): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  if (opts.httpLogging !== false) {
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));
  }

  // Optional demo UI
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use('/supplierA', supplierARouter);
  app.use('/supplierB', supplierBRouter);
  app.use('/api', hotelsRouter(deps));
  app.use(healthRouter(deps));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
