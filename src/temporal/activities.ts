import { ApplicationFailure, Context } from '@temporalio/activity';
import { config } from '../config';
import { saveHotels } from '../services/hotelCache';
import { getRedis } from '../services/redis';
import { BestOffer, SUPPLIER_LABELS, SupplierHotel, SupplierId, TaggedHotel } from '../types';

const isSupplierHotel = (h: unknown): h is SupplierHotel => {
  const o = h as Record<string, unknown>;
  return (
    !!o &&
    typeof o.name === 'string' &&
    typeof o.price === 'number' &&
    Number.isFinite(o.price) &&
    typeof o.commissionPct === 'number'
  );
};

/**
 * Calls one supplier's hotel API for a city.
 * 5xx / network errors are thrown as retryable so Temporal retries them;
 * 4xx and malformed payloads are non-retryable because retrying will not help.
 */
export async function fetchSupplierHotels(supplierId: SupplierId, city: string): Promise<TaggedHotel[]> {
  const { log, info } = Context.current();
  const url = `${config.supplierBaseUrl}/${supplierId}/hotels?city=${encodeURIComponent(city)}`;
  log.info('Calling supplier', { supplierId, city, attempt: info.attempt });

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(config.supplierTimeoutMs) });
  } catch (err) {
    log.warn('Supplier request failed', { supplierId, error: (err as Error).message, attempt: info.attempt });
    throw ApplicationFailure.retryable(`${supplierId} unreachable: ${(err as Error).message}`, 'SupplierUnavailable');
  }

  if (res.status >= 500) {
    log.warn('Supplier returned server error', { supplierId, status: res.status, attempt: info.attempt });
    throw ApplicationFailure.retryable(`${supplierId} responded with ${res.status}`, 'SupplierUnavailable');
  }
  if (!res.ok) {
    throw ApplicationFailure.nonRetryable(`${supplierId} responded with ${res.status}`, 'SupplierBadRequest');
  }

  const body: unknown = await res.json();
  if (!Array.isArray(body) || !body.every(isSupplierHotel)) {
    throw ApplicationFailure.nonRetryable(`${supplierId} returned an invalid payload`, 'SupplierBadPayload');
  }

  log.info('Supplier responded', { supplierId, city, count: body.length });
  return body.map((h) => ({ ...h, supplier: SUPPLIER_LABELS[supplierId] }));
}

/** Persists the deduplicated list in Redis (sorted set scored by price). */
export async function saveHotelsToRedis(city: string, hotels: BestOffer[]): Promise<void> {
  const { log } = Context.current();
  await saveHotels(getRedis(), city, hotels);
  log.info('Saved hotels to Redis', { city, count: hotels.length });
}

export type Activities = {
  fetchSupplierHotels: typeof fetchSupplierHotels;
  saveHotelsToRedis: typeof saveHotelsToRedis;
};
