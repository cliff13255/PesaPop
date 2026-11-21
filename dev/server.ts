// Runs the same handler as the Edge Function on Node, for local development.
//   cp .env.example .env && npm run db:local && npm run dev:api
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import postgres from 'postgres';
import { createHandler } from '../supabase/functions/_shared/app.ts';
import { createAssistantModel } from '../supabase/functions/_shared/assistant.ts';
import { loadConfig } from '../supabase/functions/_shared/config.ts';
import { createProvider } from '../supabase/functions/_shared/providers.ts';

if (existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig((k) => process.env[k]);
const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54329/pesapop', { prepare: false });
const handler = createHandler({ sql, config, provider: createProvider(config), assistant: createAssistantModel(config) });
const port = Number(process.env.PORT ?? 8787);

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  headers.set('x-forwarded-for', req.socket.remoteAddress ?? 'unknown');
  const body = chunks.length && req.method !== 'GET' && req.method !== 'HEAD' ? Buffer.concat(chunks) : undefined;
  const response = await handler(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers, body }));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => {
  console.info(`PesaPop API (local) on http://localhost:${port}/api  provider=${config.providerMode} assistant=${config.anthropicApiKey ? 'claude' : 'rules'}`);
});
