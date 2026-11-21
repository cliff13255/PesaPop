// Applies supabase/migrations/*.sql to DATABASE_URL (local Postgres). Safe to re-run.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import postgres from 'postgres';

if (existsSync('.env')) process.loadEnvFile('.env');
const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54329/pesapop';
const sql = postgres(url, { onnotice: () => {} });
await sql`create table if not exists public._local_migrations (name text primary key, applied_at timestamptz default now())`;
for (const file of readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()) {
  const [done] = await sql`select 1 from public._local_migrations where name = ${file}`;
  if (done) continue;
  await sql.begin(async (tx) => {
    await tx.unsafe(readFileSync(`supabase/migrations/${file}`, 'utf8'));
    await tx`insert into public._local_migrations (name) values (${file})`;
  });
  console.info(`applied ${file}`);
}
await sql.end();
