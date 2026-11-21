import { Router } from 'express';
import { z } from 'zod';
import { AppDeps } from '../app';
import { HttpError } from '../middleware/errorHandler';

const price = z.coerce
  .number({ error: 'must be a number' })
  .nonnegative({ error: 'must be >= 0' })
  .optional();

export const hotelsQuerySchema = z
  .object({
    city: z
      .string({ error: 'city is required' })
      .trim()
      .min(1, { error: 'city is required' })
      .max(50)
      .regex(/^[a-zA-Z][a-zA-Z\s-]*$/, { error: 'city may contain letters, spaces and hyphens only' })
      .transform((c) => c.toLowerCase()),
    minPrice: price,
    maxPrice: price,
  })
  .refine((q) => q.minPrice === undefined || q.maxPrice === undefined || q.minPrice <= q.maxPrice, {
    error: 'minPrice must be less than or equal to maxPrice',
    path: ['minPrice'],
  });

export function hotelsRouter(deps: AppDeps): Router {
  const router = Router();

  // GET /api/hotels?city=delhi[&minPrice=..&maxPrice=..]
  router.get('/hotels', async (req, res) => {
    // Treat empty strings (e.g. "?minPrice=") as "not provided".
    const query = Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== ''));
    const parsed = hotelsQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'Invalid query parameters',
        parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      );
    }
    const { city, minPrice, maxPrice } = parsed.data;

    // Orchestrate supplier calls + dedupe via Temporal (also refreshes Redis).
    const result = await deps.runHotelOffersWorkflow(city);
    if (result.failedSuppliers.length > 0) {
      res.setHeader('X-Failed-Suppliers', result.failedSuppliers.join(', '));
    }

    if (minPrice === undefined && maxPrice === undefined) {
      res.json(result.hotels);
      return;
    }

    // Price filtering is performed inside Redis (ZRANGE ... BYSCORE).
    res.json(await deps.findHotelsByPrice(city, minPrice, maxPrice));
  });

  return router;
}
