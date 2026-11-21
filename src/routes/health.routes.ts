import { Router } from 'express';
import { AppDeps } from '../app';
import { SupplierId } from '../types';

export type ComponentStatus = { status: 'up' | 'down'; latencyMs?: number; error?: string };

/** Times a check and converts thrown errors / false results into a "down" status. */
export async function timed(check: () => Promise<unknown>): Promise<ComponentStatus> {
  const start = Date.now();
  try {
    const ok = await check();
    if (ok === false) return { status: 'down', latencyMs: Date.now() - start };
    return { status: 'up', latencyMs: Date.now() - start };
  } catch (err) {
    return { status: 'down', latencyMs: Date.now() - start, error: (err as Error).message };
  }
}

export function healthRouter(deps: AppDeps): Router {
  const router = Router();

  router.get('/health', async (_req, res) => {
    const suppliers: SupplierId[] = ['supplierA', 'supplierB'];
    const [supplierA, supplierB, redis, temporal, worker] = await Promise.all([
      ...suppliers.map((s) => timed(() => deps.checkSupplier(s))),
      timed(deps.checkRedis),
      timed(deps.checkTemporal),
      timed(deps.checkWorker),
    ]);

    const suppliersUp = [supplierA, supplierB].filter((s) => s.status === 'up').length;
    const infraUp = [redis, temporal, worker].every((c) => c.status === 'up');

    // ok: everything up | degraded: still able to serve (>=1 supplier) | down: cannot serve
    const status = infraUp && suppliersUp === 2 ? 'ok' : infraUp && suppliersUp === 1 ? 'degraded' : 'down';

    res.status(status === 'ok' ? 200 : 503).json({
      status,
      timestamp: new Date().toISOString(),
      suppliers: { supplierA, supplierB },
      dependencies: { redis, temporal, temporalWorker: worker },
    });
  });

  return router;
}
