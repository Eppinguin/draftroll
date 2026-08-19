import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSmoke } from './smoke-worker.mjs';

const baseUrl = process.env.DRAFTROLL_BASE_URL ?? 'http://127.0.0.1:8787';
const workerRoot = join(process.cwd(), 'apps', 'worker');
const wranglerCommand = join(
  workerRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
);
const localPersistence = await mkdtemp(join(tmpdir(), 'draftroll-worker-state-'));

await runWrangler([
  'd1',
  'migrations',
  'apply',
  'DB',
  '--local',
  '--persist-to',
  localPersistence,
  '--config',
  'wrangler.jsonc',
]);

const server = spawn(
  wranglerCommand,
  [
    'dev',
    '--config',
    'wrangler.jsonc',
    '--local',
    '--persist-to',
    localPersistence,
    '--ip',
    '127.0.0.1',
    '--port',
    '8787',
    '--var',
    'DRAFTROLL_ENV:local',
    '--var',
    'ALLOWED_ORIGINS:http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:4173',
    '--var',
    'ALLOW_ANONYMOUS:true',
    '--var',
    'EVENT_BUFFER_LIMIT:10',
    '--var',
    'ROOM_POLICY_PRESET:open-table',
  ],
  {
    cwd: workerRoot,
    detached: process.platform !== 'win32',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

server.stdout.on('data', (chunk) => process.stdout.write(`[wrangler] ${chunk}`));
server.stderr.on('data', (chunk) => process.stderr.write(`[wrangler] ${chunk}`));

let stopping = false;
const stopServer = async () => {
  if (stopping || server.exitCode !== null) return;
  stopping = true;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
      killer.on('exit', resolve);
      killer.on('error', resolve);
    });
  } else {
    try {
      if (server.pid === undefined) throw new Error('Worker process has no pid');
      // Negative pid signals the whole process group spawned with `detached`.
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
  }

  await new Promise((resolve) => {
    if (server.exitCode !== null) {
      resolve();
      return;
    }
    server.once('close', resolve);
  });
};

const cleanup = async () => {
  await stopServer();
  await rm(localPersistence, { recursive: true, force: true });
};

process.on('SIGINT', () => void cleanup().finally(() => process.exit(130)));
process.on('SIGTERM', () => void cleanup().finally(() => process.exit(143)));

try {
  await waitForHealth(`${baseUrl.replace(/\/$/, '')}/health`, 30_000);
  await runSmoke(baseUrl, { prepareIdempotencyBoundary });
} finally {
  await cleanup();
}

async function prepareIdempotencyBoundary({
  roomId,
  sessionId,
  publicEvent,
  secretEvent,
  correlationEvent,
}) {
  const publicRow = await waitForPersistedRequest(
    roomId,
    sessionId,
    publicEvent.requestId,
    publicEvent.eventSequence,
  );
  const secretRow = await waitForPersistedRequest(
    roomId,
    sessionId,
    secretEvent.requestId,
    secretEvent.eventSequence,
  );
  const correlationRow = await waitForPersistedRequest(
    roomId,
    sessionId,
    correlationEvent.requestId,
    correlationEvent.eventSequence,
  );

  assert.equal(Number(publicRow.request_sequence), publicEvent.eventSequence);
  assert.equal(Number(secretRow.request_sequence), secretEvent.eventSequence);
  assert.equal(Number(correlationRow.request_sequence), correlationEvent.eventSequence);

  // The Durable Object request cache still proves the public request ran. Removing only the D1
  // request index reproduces a persistence split without removing its retained response event.
  await executeD1(`
    DELETE FROM room_requests
    WHERE room_id = ${sqlString(roomId)}
      AND session_id = ${sqlString(sessionId)}
      AND request_id = ${sqlString(publicEvent.requestId)}
  `);
  const publicRequestRows = await queryD1(`
    SELECT event_sequence
    FROM room_requests
    WHERE room_id = ${sqlString(roomId)}
      AND session_id = ${sqlString(sessionId)}
      AND request_id = ${sqlString(publicEvent.requestId)}
  `);
  assert.equal(publicRequestRows.length, 0, 'public D1 request index was not removed');

  // Keep the retained event structurally valid but change the correlation key. A request-cache
  // mapping must never be sufficient to replay a different retained response.
  const mismatchedCorrelation = JSON.parse(correlationRow.event_json);
  mismatchedCorrelation.requestId = `${correlationEvent.requestId}-mismatch`;
  await executeD1(`
    UPDATE room_events
    SET event_json = ${sqlString(JSON.stringify(mismatchedCorrelation))}
    WHERE room_id = ${sqlString(roomId)}
      AND event_sequence = ${Number(correlationEvent.eventSequence)}
  `);
  const [storedCorrelation] = await queryD1(`
    SELECT event_json
    FROM room_events
    WHERE room_id = ${sqlString(roomId)}
      AND event_sequence = ${Number(correlationEvent.eventSequence)}
    LIMIT 1
  `);
  assert.ok(storedCorrelation, 'correlation retained response disappeared while preparing the test');
  assert.equal(
    JSON.parse(storedCorrelation.event_json).requestId,
    `${correlationEvent.requestId}-mismatch`,
  );

  // Keep a structurally valid JSON row and normalized result, but corrupt an internal field that
  // projection dereferences. Strict persisted-event decoding must reject this before projection.
  const corruptSecret = JSON.parse(secretRow.event_json);
  corruptSecret.actor = null;
  await executeD1(`
    UPDATE room_events
    SET event_json = ${sqlString(JSON.stringify(corruptSecret))}
    WHERE room_id = ${sqlString(roomId)}
      AND event_sequence = ${Number(secretEvent.eventSequence)}
  `);
  const [storedSecret] = await queryD1(`
    SELECT event_json
    FROM room_events
    WHERE room_id = ${sqlString(roomId)}
      AND event_sequence = ${Number(secretEvent.eventSequence)}
    LIMIT 1
  `);
  assert.ok(storedSecret, 'secret retained response disappeared while preparing the test');
  assert.equal(JSON.parse(storedSecret.event_json).actor, null);
}

async function waitForPersistedRequest(
  roomId,
  sessionId,
  requestId,
  expectedEventSequence,
  timeoutMs = 10_000,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const rows = await queryD1(`
        SELECT
          r.event_sequence AS request_sequence,
          e.event_json AS event_json
        FROM room_requests AS r
        JOIN room_events AS e
          ON e.room_id = r.room_id
         AND e.event_sequence = r.event_sequence
        WHERE r.room_id = ${sqlString(roomId)}
          AND r.session_id = ${sqlString(sessionId)}
          AND r.request_id = ${sqlString(requestId)}
        LIMIT 1
      `);
      const row = rows[0];
      if (row && Number(row.request_sequence) === expectedEventSequence) return row;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (lastError !== undefined) {
    throw lastError instanceof Error
      ? lastError
      : new Error('Last persisted-request query failed', { cause: lastError });
  }
  throw new Error(
    `Timed out waiting for persisted request '${requestId}' at event ${expectedEventSequence}`,
  );
}

async function queryD1(statement) {
  const stdout = await runWrangler([
    'd1',
    'execute',
    'DB',
    '--local',
    '--persist-to',
    localPersistence,
    '--config',
    'wrangler.jsonc',
    '--command',
    statement,
    '--json',
  ]);
  const parsed = parseWranglerJson(stdout);
  const result = Array.isArray(parsed) ? parsed[0] : parsed;
  return result?.results ?? [];
}

async function executeD1(statement) {
  await queryD1(statement);
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function parseWranglerJson(stdout) {
  const firstArray = stdout.indexOf('[');
  const firstObject = stdout.indexOf('{');
  const candidates = [firstArray, firstObject].filter((index) => index >= 0);
  if (candidates.length === 0) throw new Error(`Wrangler returned no JSON: ${stdout}`);
  return JSON.parse(stdout.slice(Math.min(...candidates)));
}

async function runWrangler(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(wranglerCommand, args, {
      cwd: workerRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`wrangler ${args.join(' ')} exited with code ${code}: ${stderr}`));
    });
  });
}

async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error(`Wrangler exited before becoming ready (code ${server.exitCode})`);
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
