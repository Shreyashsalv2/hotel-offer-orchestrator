import { ApplicationFailure, log, proxyActivities } from '@temporalio/workflow';
import type { Activities } from './activities';
import { selectBestOffers } from '../services/dedupe';
import { HotelOffersWorkflowResult, SUPPLIER_LABELS, SupplierId, TaggedHotel } from '../types';

const { fetchSupplierHotels } = proxyActivities<Activities>({
  startToCloseTimeout: '5 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '300 milliseconds',
    backoffCoefficient: 2,
    maximumInterval: '2 seconds',
  },
});

const { saveHotelsToRedis } = proxyActivities<Activities>({
  startToCloseTimeout: '5 seconds',
  retry: { maximumAttempts: 5, initialInterval: '200 milliseconds', backoffCoefficient: 2 },
});

const SUPPLIERS: SupplierId[] = ['supplierA', 'supplierB'];

/**
 * 1. Fetch Supplier A and Supplier B in parallel.
 * 2. Continue with whatever succeeded (one supplier down is tolerated).
 * 3. Deduplicate by hotel name, keeping the cheapest offer.
 * 4. Save the result in Redis and return it.
 */
export async function hotelOffersWorkflow(rawCity: string): Promise<HotelOffersWorkflowResult> {
  const city = rawCity.trim().toLowerCase();
  log.info('Hotel offers workflow started', { city });

  const results = await Promise.allSettled(SUPPLIERS.map((s) => fetchSupplierHotels(s, city)));

  const hotels: TaggedHotel[] = [];
  const failedSuppliers: string[] = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      hotels.push(...result.value);
    } else {
      failedSuppliers.push(SUPPLIER_LABELS[SUPPLIERS[i]]);
      log.warn('Supplier failed after retries; continuing without it', {
        supplier: SUPPLIERS[i],
        error: String(result.reason?.cause?.message ?? result.reason?.message ?? result.reason),
      });
    }
  });

  if (failedSuppliers.length === SUPPLIERS.length) {
    log.error('All suppliers failed', { city });
    throw ApplicationFailure.nonRetryable('All suppliers are unavailable', 'AllSuppliersUnavailable');
  }

  const best = selectBestOffers(hotels);
  await saveHotelsToRedis(city, best);

  log.info('Hotel offers workflow completed', {
    city,
    received: hotels.length,
    unique: best.length,
    failedSuppliers,
  });
  return { city, hotels: best, failedSuppliers };
}
