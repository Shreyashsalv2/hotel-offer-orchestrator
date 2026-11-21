import { BestOffer, TaggedHotel } from '../types';

/** Normalises a hotel name so "Holtin", " holtin " and "HOLTIN" match. */
export const normaliseName = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Deduplicates hotels by name and keeps the cheapest offer for each.
 * Ties on price are broken by the higher commission.
 *
 * Pure and deterministic, so it is safe to call from Temporal workflow code.
 */
export function selectBestOffers(hotels: TaggedHotel[]): BestOffer[] {
  const best = new Map<string, TaggedHotel>();

  for (const hotel of hotels) {
    const key = normaliseName(hotel.name);
    const current = best.get(key);
    if (
      !current ||
      hotel.price < current.price ||
      (hotel.price === current.price && hotel.commissionPct > current.commissionPct)
    ) {
      best.set(key, hotel);
    }
  }

  return [...best.values()]
    .map(({ name, price, supplier, commissionPct }) => ({ name, price, supplier, commissionPct }))
    .sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
}
