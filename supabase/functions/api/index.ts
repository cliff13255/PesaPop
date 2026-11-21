// Supabase Edge Function entry point: deploy with `supabase functions deploy api --no-verify-jwt`.
import postgres from 'postgres';
import { createHandler } from '../_shared/app.ts';
import { createAssistantModel } from '../_shared/assistant.ts';
import { loadConfig } from '../_shared/config.ts';
import { createProvider } from '../_shared/providers.ts';

const config = loadConfig((key) => Deno.env.get(key));
// SUPABASE_DB_URL is provided to every Edge Function automatically.
const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 3 });

Deno.serve(createHandler({ sql, config, provider: createProvider(config), assistant: createAssistantModel(config) }));
