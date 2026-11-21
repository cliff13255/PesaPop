import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ApiError } from '../lib/errors.js';

export const notFound: RequestHandler = (_req, _res, next) => next(new ApiError(404, 'not_found', 'Route not found.'));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'validation_error', message: 'Request body is not valid JSON.' } });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(400).json({ error: { code: 'validation_error', message: 'Request body is too large.' } });
    return;
  }
  // Log the error class and stack only; never request bodies, headers or env values.
  console.error(`[error] ${req.method} ${req.path}:`, err instanceof Error ? err.stack : String(err));
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } });
};
