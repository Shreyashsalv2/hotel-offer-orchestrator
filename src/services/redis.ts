import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../logger';

let client: Redis | undefined;

/** Lazily created shared Redis connection. */
export function getRedis(): Redis {
  if (!client) {
    client = new Redis(config.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });
    client.on('error', (err) => logger.error({ err: err.message }, 'redis connection error'));
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => client?.disconnect());
    client = undefined;
  }
}
