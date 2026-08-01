import { spawn } from 'node:child_process';
import { runSmoke } from './smoke-worker.mjs';

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const baseUrl = process.env.DRAFTROLL_BASE_URL ?? 'http://127.0.0.1:8787';

await runCommand(['worker:setup']);

const server = spawn(pnpmCommand, ['worker:dev'], {
  cwd: process.cwd(),
  detached: process.platform !== 'win32',
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

server.stdout.on('data', (chunk) => process.stdout.write(`[wrangler] ${chunk}`));
server.stderr.on('data', (chunk) => process.stderr.write(`[wrangler] ${chunk}`));

let stopping = false;
const stopServer = async () => {
  if (stopping || server.exitCode !== null) return;
  stopping = true;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.on('exit', resolve);
      killer.on('error', resolve);
    });
  } else {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
  }
};

process.on('SIGINT', () => void stopServer().finally(() => process.exit(130)));
process.on('SIGTERM', () => void stopServer().finally(() => process.exit(143)));

try {
  await waitForHealth(`${baseUrl.replace(/\/$/, '')}/health`, 30_000);
  await runSmoke(baseUrl);
} finally {
  await stopServer();
}

async function runCommand(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(pnpmCommand, args, { cwd: process.cwd(), env: process.env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`pnpm ${args.join(' ')} exited with code ${code}`)));
  });
}

async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Wrangler exited before becoming ready (code ${server.exitCode})`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Wrangler did not become healthy within ${timeoutMs}ms`);
}
