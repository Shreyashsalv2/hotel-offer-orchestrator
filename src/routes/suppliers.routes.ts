import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { logger } from '../logger';
import { SUPPLIER_DATA } from '../mocks/supplierData';
import { SupplierId } from '../types';

/** In-memory up/down switch per supplier, used to simulate outages. */
const supplierDown: Record<SupplierId, boolean> = {
  supplierA: config.supplierADown,
  supplierB: config.supplierBDown,
};

export const isSupplierDown = (id: SupplierId): boolean => supplierDown[id];
export const setSupplierDown = (id: SupplierId, down: boolean): void => {
  supplierDown[id] = down;
};

const toggleBody = z.object({ down: z.boolean() });

function supplierRouter(id: SupplierId): Router {
  const router = Router();

  // GET /supplierX/hotels?city=delhi  (city optional: returns all hotels when omitted)
  router.get('/hotels', (req, res) => {
    if (supplierDown[id]) {
      res.status(503).json({ error: `${id} is temporarily unavailable` });
      return;
    }
    const city = typeof req.query.city === 'string' ? req.query.city.trim().toLowerCase() : '';
    const data = SUPPLIER_DATA[id];
    res.json(city ? (data[city] ?? []) : Object.values(data).flat());
  });

  // GET /supplierX/status
  router.get('/status', (_req, res) => {
    res.json({ supplier: id, down: supplierDown[id] });
  });

  // POST /supplierX/toggle  { "down": true }  -> simulate an outage
  router.post('/toggle', (req, res) => {
    const parsed = toggleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Body must be { "down": boolean }' });
      return;
    }
    supplierDown[id] = parsed.data.down;
    logger.warn({ supplier: id, down: parsed.data.down }, 'Supplier availability changed');
    res.json({ supplier: id, down: supplierDown[id] });
  });

  return router;
}

export const supplierARouter = supplierRouter('supplierA');
export const supplierBRouter = supplierRouter('supplierB');
