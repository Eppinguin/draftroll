import assert from 'node:assert/strict';
import { runTsc } from './lib/load-typescript.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(new URL('..', import.meta.url).pathname);
const temp = await mkdtemp(join(tmpdir(), 'draftroll-realtime-resilience-'));
const out = join(temp, 'build');
const config = join(temp, 'tsconfig.json');
let policy;
let sequence = 1;
const now = new Date(0).toISOString();

class MockWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    super();
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.sent = [];
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.dispatchEvent(new Event('open'));
      const parsed = new URL(this.url);
      this.serverSend({
        type: 'session_ready', protocolVersion: 2, roomId: 'resilience',
        participant: {
          participantId: parsed.searchParams.get('participantId'),
          sessionId: parsed.searchParams.get('sessionId'),
          name: parsed.searchParams.get('name'),
          roles: [], permissions: ['roll:create', 'roll:update-own', 'roll:reveal-own'], connectedAt: now,
        },
        latestEventSequence: sequence,
        latestRollSequence: 1,
      });
    });
  }

  send(raw) {
    this.sent.push(raw);
    const message = JSON.parse(raw);
    if (message.type === 'clock_sync_ping') {
      this.serverSend({
        type: 'clock_sync_pong', protocolVersion: 2, roomId: 'resilience',
        clientTimeMs: message.clientTimeMs, serverTimeMs: Date.now(), nonce: message.nonce,
      });
      return;
    }
    if (message.type === 'roll_request') {
      if (message.input?.metadata?.test === 'pending-abort') return;
      this.serverSend(makeRollStart({ requestId: message.requestId, rollId: message.clientRollId ?? 'successful-roll', eventSequence: ++sequence }));
      return;
    }
    if (message.type === 'update_roll') {
      this.serverSend({
        type: 'roll_error', protocolVersion: 2, roomId: 'resilience', requestId: message.requestId,
        rollId: message.rollId, code: 'revision_conflict', message: 'Expected revision 0 but current revision is 1', currentRevision: 1,
      });
    }
  }

  close(code = 1000, reason = '') { this.serverClose(code, reason); }

  serverClose(code = 1006, reason = 'network fault') {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    const event = new Event('close');
    Object.assign(event, { code, reason });
    this.dispatchEvent(event);
  }

  serverSend(value) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }));
  }
}

try {
  await writeFile(config, JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'CommonJS', moduleResolution: 'Node', rootDir: join(root, 'packages'), outDir: out,
      strict: true, skipLibCheck: true, esModuleInterop: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'],
    },
    include: [join(root, 'packages/**/*.ts')],
  }, null, 2));
  const compile = runTsc(['-p', config], { cwd: root });
  if (compile.status !== 0) throw new Error(`${compile.stdout}\n${compile.stderr}`);
  await writeFile(join(out, 'package.json'), '{"type":"commonjs"}\n');

  const protocol = await import(pathToFileURL(join(out, 'protocol/src/index.js')).href);
  const client = await import(pathToFileURL(join(out, 'client/src/index.js')).href);
  policy = protocol.createRoomPolicy('open-table');

  const durableEvents = [
    makeRollStart({ rollId: 'recovered-2', eventSequence: 2, replayed: true }),
    makeRollStart({ rollId: 'recovered-3', eventSequence: 3, replayed: true }),
  ];
  const fetchCalls = [];
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url: String(url), headers: init?.headers });
    return new Response(JSON.stringify({ roomId: 'resilience', afterEventSequence: 1, events: durableEvents }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };

  const room = await client.DiceRoom.connect({
    url: 'ws://draftroll.test/rooms/resilience/connect', roomId: 'resilience',
    participant: { participantId: 'player-a', sessionId: 'session-a', name: 'Player A' },
    token: 'test-token', reconnect: true, reconnectDelayMs: 5, reconnectMaximumDelayMs: 10,
    reconnectBackoffFactor: 1, clockSyncSamples: 1, requestTimeoutMs: 1000,
    longRangeRecovery: true, fetchImpl, WebSocketImpl: MockWebSocket,
  });

  const states = [];
  const observed = [];
  room.on('connectionState', (state) => states.push(state));
  room.on('rollStart', (event) => observed.push(event.rollId));
  room.on('rollStart', () => { throw new Error('observer failure'); });

  const first = MockWebSocket.instances[0];
  first.serverSend(makeRoomState({ latestEventSequence: 1, recentEvents: [] }));
  await waitFor(() => room.connectionDiagnostics.state === 'open');
  const successful = await room.roll({ mode: 'evaluate', expression: '1d1' }, { clientRollId: 'successful-roll' });
  assert.equal(successful.rollId, 'successful-roll');

  first.serverClose(1006, 'simulated disconnect');
  await waitFor(() => MockWebSocket.instances.length === 2);
  const second = MockWebSocket.instances[1];
  await waitFor(() => second.readyState === MockWebSocket.OPEN);
  const reconnectUrl = new URL(second.url);
  assert.equal(reconnectUrl.searchParams.get('lastEventSequence'), String(sequence));

  const recoveryStartedAt = performance.now();
  const recoveryHeapBefore = process.memoryUsage().heapUsed;
  second.serverSend(makeRoomState({
    latestEventSequence: 4,
    eventBufferStartSequence: 4,
    missedEventsTruncated: true,
    recentEvents: [makeRollStart({ rollId: 'recent-4', eventSequence: 4, replayed: true })],
  }));
  await waitFor(() => observed.includes('recent-4'));
  assert.deepEqual(observed.filter((id) => id.startsWith('recovered-')), ['recovered-3'], 'already applied durable events must be de-duplicated');
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].url, /afterEventSequence=2|afterEventSequence=1/);
  const recoveryDurationMs = performance.now() - recoveryStartedAt;
  const recoveryHeapDeltaBytes = process.memoryUsage().heapUsed - recoveryHeapBefore;

  sequence = 5;
  const hiddenProjection = makeRollStart({ rollId: 'hidden-5', eventSequence: sequence });
  second.serverSend({
    ...hiddenProjection,
    hidden: true,
    result: null,
    visibility: { type: 'hidden' },
    animationSeed: undefined,
    serverStartTimeMs: undefined,
    animationDurationMs: undefined,
  });
  await waitFor(() => room.getRequestMetrics().hiddenProjections === 1);
  assert.equal(fetchCalls[0].headers.Authorization, 'Bearer test-token');

  const abortController = new AbortController();
  const pending = room.roll({ mode: 'evaluate', expression: '1d1', metadata: { test: 'pending-abort' } }, { signal: abortController.signal });
  abortController.abort('test');
  await assert.rejects(pending, (error) => error.code === 'operation_aborted');

  await assert.rejects(
    room.updateRoll('successful-roll', { annotation: 'stale' }, { expectedRevision: 0 }),
    (error) => error.code === 'revision_conflict' && error.currentRevision === 1,
  );

  const metrics = room.getRequestMetrics();
  assert.ok(metrics.requestsStarted >= 3);
  assert.ok(metrics.requestsCompleted >= 1);
  assert.equal(metrics.requestsAborted, 1);
  assert.equal(metrics.revisionConflicts, 1);
  assert.equal(metrics.reconnectAttempts, 1);
  assert.equal(metrics.replayTruncations, 1);
  assert.equal(metrics.longRangeRecoveries, 1);
  assert.ok(metrics.replayedEvents >= 2);
  assert.equal(metrics.hiddenProjections, 1);
  assert.ok(recoveryDurationMs >= 0);
  assert.ok(states.some((state) => state.state === 'reconnecting'));
  assert.equal(room.connectionDiagnostics.state, 'open');
  if (room.connectionDiagnostics.roundTripMs !== undefined) assert.ok(room.connectionDiagnostics.roundTripMs >= 0);
  room.close();

  console.log(JSON.stringify({
    ok: true,
    metrics,
    recovery: { durationMs: recoveryDurationMs, heapDeltaBytes: recoveryHeapDeltaBytes },
    checks: [
      'abnormal disconnect and capped reconnect',
      'resume cursor propagation',
      'truncated replay durable recovery',
      'event ordering and duplicate suppression',
      'request cancellation and revision-conflict metrics',
      'connection diagnostics, hidden-projection metrics, and observer isolation',
      'reconnect replay duration and heap sampling',
    ],
  }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}

function makeRollStart({ requestId, rollId, eventSequence, replayed = false }) {
  const result = {
    schemaVersion: 1, rollId, sequence: eventSequence, revision: 0, authority: 'server', expression: '1d1', total: 1,
    dice: [{ id: `${rollId}-die`, type: 'd1', sides: 1, result: 1, kept: true, generatedBy: 'initial' }],
    operations: [], createdAt: now,
  };
  return {
    type: 'roll_start', protocolVersion: 2, roomId: 'resilience', requestId,
    eventSequence, rollId, sequence: eventSequence,
    actor: { participantId: 'player-a', sessionId: 'session-a', name: 'Player A', roles: [] },
    visibility: { type: 'public' }, hidden: false, result,
    summary: { rollId, sequence: eventSequence, revision: 0, actor: { participantId: 'player-a', sessionId: 'session-a', name: 'Player A', roles: [] }, createdAt: now },
    animationSeed: `seed-${eventSequence}`, serverStartTimeMs: Date.now(), animationDurationMs: 100,
    ...(replayed ? { replayed: true } : {}),
  };
}

function makeRoomState({ latestEventSequence, eventBufferStartSequence = 1, missedEventsTruncated = false, recentEvents }) {
  return {
    type: 'room_state', protocolVersion: 2, roomId: 'resilience', sequence: 1, latestRollSequence: 1,
    latestEventSequence, eventBufferStartSequence, missedEventsTruncated,
    policy, policyRevision: 0,
    participants: [{
      participantId: 'player-a', sessionId: 'session-a', name: 'Player A', roles: [],
      permissions: ['roll:create', 'roll:update-own', 'roll:reveal-own'], connectedAt: now,
    }],
    recentEvents, recentRolls: [],
  };
}

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for test condition');
    await new Promise((settle) => setTimeout(settle, 2));
  }
}
