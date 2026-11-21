import { rateLimit } from 'express-rate-limit';

const limiter = (windowMs: number, limit: number, message: string) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'rate_limited', message } });
    },
  });

export const authLimiter = limiter(15 * 60_000, 20, 'Too many attempts. Try again in a few minutes.');
export const assistantLimiter = limiter(60_000, 20, 'Too many messages. Try again in a minute.');
export const generalLimiter = limiter(60_000, 120, 'Too many requests. Try again in a minute.');
