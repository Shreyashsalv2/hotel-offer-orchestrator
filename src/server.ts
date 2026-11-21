import { randomUUID } from 'node:crypto';
import { createApp, AppDeps } from './app';
import { config } from './config';
import { logger } from './logger';
import { findHotelsByPrice } from './services/hotelCache';
import { closeRedis, getRedis } from './services/redis';
import { closeTemporalClient, getTemporalClient } from './temporal/client';
import { hotelOffersWorkflow } from './temporal/workflows';
import { SupplierId } from './types';

const HEALTH_TIMEOUT_MS = 2000;

const deps: AppDeps = {
  async runHotelOffersWorkflow(city) {
    const client = await getTemporalClient();
    return client.workflow.execute(hotelOffersWorkflow, {
      taskQueue: config.taskQueue,
      workflowId: `hotels-${city.replace(/\s+/g, '-')}-${randomUUID()}`,
      args: [city],
      workflowExecutionTimeout: '30 seconds',
    });
  },

  findHotelsByPrice: (city, min, max) => findHotelsByPrice(getRedis(), city, min, max),

  async checkSupplier(id: SupplierId) {
    const res = await fetch(`${config.supplierBaseUrl}/${id}/hotels?city=delhi`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  },

  async checkRedis() {
    return (await getRedis().ping()) === 'PONG';
  },

  async checkTemporal() {
    const { connection } = await getTemporalClient();
    await connection.withDeadline(Date.now() + HEALTH_TIMEOUT_MS, () =>
      connection.workflowService.getSystemInfo({}),
    );
    return true;
  },

  /** True when at least one worker is polling the task queue. */
  async checkWorker() {
    const { connection } = await getTemporalClient();
    const res = await connection.withDeadline(Date.now() + HEALTH_TIMEOUT_MS, () =>
      connection.workflowService.describeTaskQueue({
        namespace: config.temporalNamespace,
        taskQueue: { name: config.taskQueue },
        taskQueueType: 1, // TASK_QUEUE_TYPE_WORKFLOW
      }),
    );
    if (!res.pollers?.length) throw new Error('no workers polling the task queue');
    return true;
  },
};

const server = createApp(deps).listen(config.port, () => {
  logger.info({ port: config.port }, 'API listening');
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutting down API');
  server.close(async () => {
    await Promise.allSettled([closeRedis(), closeTemporalClient()]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
