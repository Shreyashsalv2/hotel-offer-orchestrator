import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './temporal/activities';
import { config } from './config';
import { logger } from './logger';
import { closeRedis } from './services/redis';

async function connectWithRetry(attempts = 30, delayMs = 2000): Promise<NativeConnection> {
  for (let i = 1; ; i++) {
    try {
      return await NativeConnection.connect({ address: config.temporalAddress });
    } catch (err) {
      if (i >= attempts) throw err;
      logger.warn({ attempt: i, err: (err as Error).message }, 'Temporal not ready, retrying');
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function main(): Promise<void> {
  const connection = await connectWithRetry();
  const worker = await Worker.create({
    connection,
    namespace: config.temporalNamespace,
    taskQueue: config.taskQueue,
    workflowsPath: require.resolve('./temporal/workflows'),
    activities,
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down worker');
    worker.shutdown();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  logger.info({ taskQueue: config.taskQueue, address: config.temporalAddress }, 'Temporal worker started');
  await worker.run();
  await connection.close();
  await closeRedis();
  logger.info('Worker stopped');
}

main().catch((err) => {
  logger.fatal({ err }, 'Worker crashed');
  process.exit(1);
});
