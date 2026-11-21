import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import type { Role, User } from '@prisma/client';
import { env } from '../config/env.js';
import { errors } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
  }
}

/** Verifies the bearer JWT and loads the user, so deleted users lose access immediately. */
export const requireAuth: RequestHandler = asyncHandler(async (req, _res, next) => {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
  if (!match?.[1]) throw errors.unauthorized();
  let sub: unknown;
  try {
    sub = (jwt.verify(match[1], env.JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload).sub;
  } catch {
    throw errors.unauthorized();
  }
  if (typeof sub !== 'string') throw errors.unauthorized();
  const user = await prisma.user.findUnique({ where: { id: sub } });
  if (!user) throw errors.unauthorized();
  req.user = user;
  next();
});

export const requireRole =
  (role: Role): RequestHandler =>
  (req, _res, next) => {
    if (req.user?.role !== role) {
      return next(errors.forbidden(`This action is only available to ${role}s.`));
    }
    next();
  };

/** Use inside handlers that sit behind requireAuth. */
export function currentUser(req: { user?: User }): User {
  if (!req.user) throw errors.unauthorized();
  return req.user;
}
