import { ErrorRequestHandler, RequestHandler } from 'express';
import { logger } from '../logger';
import { WorkflowFailedError } from '@temporalio/client';
import { ApplicationFailure, TimeoutFailure } from '@temporalio/common';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
};

/** Maps known error types to HTTP responses; everything else is a 500. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let body: { error: string; details?: unknown } = { error: 'Internal server error' };

  if (err instanceof HttpError) {
    status = err.status;
    body = { error: err.message, details: err.details };
  } else if (err instanceof WorkflowFailedError) {
    const cause = err.cause;
    if (cause instanceof ApplicationFailure && cause.type === 'AllSuppliersUnavailable') {
      status = 502;
      body = { error: 'All hotel suppliers are currently unavailable. Please try again later.' };
    } else if (cause instanceof TimeoutFailure) {
      status = 504;
      body = { error: 'Timed out while aggregating hotel offers' };
    } else {
      status = 502;
      body = { error: 'Failed to aggregate hotel offers', details: cause?.message };
    }
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    body = { error: 'Malformed JSON body' };
  } else if (isConnectionError(err)) {
    status = 503;
    body = { error: 'A backing service (Temporal/Redis) is unavailable' };
  }

  const log = req.log ?? logger;
  if (status >= 500) log.error({ err, status }, 'Request failed');
  else log.warn({ status, error: body.error }, 'Request rejected');

  res.status(status).json(body);
};

function isConnectionError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? '');
  return /ECONNREFUSED|UNAVAILABLE|Connection is closed|Failed to connect|ENOTFOUND/i.test(msg);
}
