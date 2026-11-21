import { env } from './config/env.js';
import { createApp } from './app.js';
import { prisma } from './lib/prisma.js';

const server = createApp().listen(env.PORT, () => {
  console.info(`PesaPop API listening on port ${env.PORT} (${env.NODE_ENV}, provider mode ${env.PROVIDER_MODE})`);
});

const shutdown = () => {
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
