import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { errors } from '../lib/errors.js';

function firstIssue(issues: { path: PropertyKey[]; message: string; code: string; keys?: string[] }[]): string {
  const issue = issues[0];
  if (!issue) return 'Invalid request.';
  if (issue.code === 'unrecognized_keys' && issue.keys?.length) return `Unknown field: ${issue.keys[0]}`;
  const field = issue.path.map(String).join('.');
  return field ? `${field} ${issue.message}` : issue.message;
}

/** Validates and replaces req.body with the parsed value. */
export const validateBody =
  (schema: ZodType): RequestHandler =>
  (req, _res, next) => {
    if (req.body === undefined || req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return next(errors.validation('Request body must be a JSON object.'));
    }
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(errors.validation(firstIssue(parsed.error.issues as never)));
    req.body = parsed.data;
    next();
  };

/** Validates the query string; the parsed value is stored on res.locals.query. */
export const validateQuery =
  (schema: ZodType): RequestHandler =>
  (req, res, next) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) return next(errors.validation(firstIssue(parsed.error.issues as never)));
    res.locals.query = parsed.data;
    next();
  };
