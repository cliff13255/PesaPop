import { execSync } from 'node:child_process';

export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Point it at a THROWAWAY Postgres database (tests wipe it), e.g.\n' +
        '  docker run -d --name pesapop-test-db -e POSTGRES_PASSWORD=postgres -p 54329:5432 postgres:17\n' +
        '  TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres npm test',
    );
  }
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
}
