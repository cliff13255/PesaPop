import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Forward rejected promises to Express's error handler (Express 4 does not). */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
