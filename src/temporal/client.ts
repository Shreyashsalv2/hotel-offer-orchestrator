import { Client, Connection } from '@temporalio/client';
import { config } from '../config';

let clientPromise: Promise<Client> | undefined;

/** Lazily connects to Temporal; a failed attempt is retried on the next call. */
export function getTemporalClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = Connection.connect({ address: config.temporalAddress })
      .then((connection) => new Client({ connection, namespace: config.temporalNamespace }))
      .catch((err) => {
        clientPromise = undefined;
        throw err;
      });
  }
  return clientPromise;
}

export async function closeTemporalClient(): Promise<void> {
  if (clientPromise) {
    const client = await clientPromise.catch(() => undefined);
    await client?.connection.close();
    clientPromise = undefined;
  }
}
