// `npm run dev`: starts the local API and the web app together. Ctrl+C stops both.
import { spawn } from 'node:child_process';

const procs = [
  ['api', 'npm', ['run', 'dev:api']],
  ['web', 'npm', ['--prefix', 'web', 'run', 'dev']],
].map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const prefix = (chunk) => chunk.toString().split('\n').filter(Boolean).map((l) => `[${name}] ${l}`).join('\n') + '\n';
  p.stdout.on('data', (c) => process.stdout.write(prefix(c)));
  p.stderr.on('data', (c) => process.stderr.write(prefix(c)));
  p.on('exit', (code) => {
    console.log(`[${name}] exited with code ${code}; stopping everything.`);
    for (const other of procs) other.kill();
    process.exit(code ?? 0);
  });
  return p;
});
process.on('SIGINT', () => procs.forEach((p) => p.kill()));
