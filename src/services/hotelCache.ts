import type Redis from 'ioredis';
import { config } from '../config';
import { BestOffer } from '../types';

/**
 * Hotels are stored in a Redis sorted set per city:
 *   key    = hotels:<city>
 *   score  = price
 *   member = JSON payload of the offer
 * so price-range filtering is done by Redis itself with ZRANGE ... BYSCORE.
 */
export const cityKey = (city: string): string => `hotels:${city.trim().toLowerCase()}`;

export async function saveHotels(redis: Redis, city: string, hotels: BestOffer[]): Promise<void> {
  const key = cityKey(city);
  const tx = redis.multi().del(key);
  if (hotels.length > 0) {
    const args = hotels.flatMap((h) => [h.price, JSON.stringify(h)]);
    tx.zadd(key, ...args).expire(key, config.cacheTtlSeconds);
  }
  const results = await tx.exec();
  const failed = results?.find(([err]) => err);
  if (failed) throw failed[0];
}

export async function findHotelsByPrice(
  redis: Redis,
  city: string,
  minPrice?: number,
  maxPrice?: number,
): Promise<BestOffer[]> {
  const min = minPrice === undefined ? '-inf' : String(minPrice);
  const max = maxPrice === undefined ? '+inf' : String(maxPrice);
  const members = await redis.zrange(cityKey(city), min, max, 'BYSCORE');
  return members.map((m) => JSON.parse(m) as BestOffer);
}
