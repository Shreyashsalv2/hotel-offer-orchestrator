const bool = (v: string | undefined): boolean => v === 'true' || v === '1';
const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  port: num(process.env.PORT, 3000),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
  temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
  taskQueue: process.env.TASK_QUEUE ?? 'hotel-offers',
  supplierBaseUrl: process.env.SUPPLIER_BASE_URL ?? 'http://localhost:3000',
  supplierTimeoutMs: num(process.env.SUPPLIER_TIMEOUT_MS, 3000),
  cacheTtlSeconds: num(process.env.CACHE_TTL_SECONDS, 600),
  supplierADown: bool(process.env.SUPPLIER_A_DOWN),
  supplierBDown: bool(process.env.SUPPLIER_B_DOWN),
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
