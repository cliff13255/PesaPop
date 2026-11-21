import { readdirSync, readFileSync } from 'node:fs';
import postgres from 'postgres';

/** Recreates the schema in a THROWAWAY database from supabase/migrations. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Point it at a throwaway Postgres database (tests wipe it), e.g.\n' +
        '  docker run -d --name pesapop-db -e POSTGRES_PASSWORD=postgres -p 54329:5432 postgres:17\n' +
        '  docker exec pesapop-db createdb -U postgres pesapop_test\n' +
        '  TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/pesapop_test npm test',
    );
  }
  const sql = postgres(url, { onnotice: () => {} });
  await sql.unsafe('drop schema if exists public cascade; create schema public;');
  for (const f of readdirSync('supabase/migrations').filter((x) => x.endsWith('.sql')).sort()) {
    await sql.unsafe(readFileSync(`supabase/migrations/${f}`, 'utf8'));
  }
  await sql.end();
}
