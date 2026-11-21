// Runs before any app module is imported, so env.ts sees test values.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DIRECT_URL = process.env.TEST_DATABASE_URL;
process.env.CORS_ORIGINS = 'https://pesapop.bubbleapps.io';
