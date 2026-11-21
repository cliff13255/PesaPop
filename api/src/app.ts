import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { router } from './routes/index.js';
import { errorHandler, notFound } from './middleware/error.js';
import { generalLimiter } from './middleware/rateLimit.js';
import { stubProviders } from './services/providers/stub.js';
import type { Providers } from './services/providers/types.js';

export interface AppOptions {
  providers?: Providers;
}

export function createApp({ providers = stubProviders }: AppOptions = {}) {
  const app = express();
  app.locals.providers = providers;

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render/Railway sit behind one proxy; needed for per-IP rate limits.
  app.use(helmet());
  app.use(
    cors({
      // Bubble calls the API from its servers (no Origin header); browsers are limited to CORS_ORIGINS.
      origin: (origin, cb) => cb(null, !origin || env.CORS_ORIGINS.includes(origin)),
      allowedHeaders: ['Authorization', 'Content-Type'],
      methods: ['GET', 'POST', 'OPTIONS'],
    }),
  );
  app.use(express.json({ limit: '50kb' }));
  app.use(generalLimiter);

  app.use(router);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
