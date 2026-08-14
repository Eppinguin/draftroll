import assert from 'node:assert/strict';
import { runTsc } from './lib/load-typescript.mjs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tempRoot = await mkdtemp(join(tmpdir(), 'draftroll-room-password-test-'));
const outDir = join(tempRoot, 'build');
const configPath = join(tempRoot, 'tsconfig.json');
const CORRECT_PASSWORD = 'correct horse battery staple';
const now = new Date().toISOString();
let eventSequence = 0;

function makePolicy(passwordProtected = true) {
  return {
    schemaVersion: 1,
    preset: 'open-table',
    enabled: true,
    access: { passwordProtected },
    authorization: {
      allowParticipantRolls: true,
      allowOwnRollUpdates: true,
      allowOwnRollRerolls: true,
      allowOwnRollReveal: true,
      allowPrivilegedAnyRollUpdates: true,
      allowPrivilegedAnyRollReveal: true,
      allowHiddenRolls: true,
      allowWhispers: true,
    },
    limits: {
      maximumParticipants: 32,
      maximumInboundMessageBytes: 65536,
      maximumExpressionLength: 16384,
      maximumDicePerRoll: 250,
      maximumOperationsPerRoll: 128,
      maximumParticipantMetadataBytes: 8192,
      maximumBufferedEvents: 200,
      maximumRollsRetained: 500,
      maximumRevisionsPerRoll: 50,
    },
    rateLimits: {
      connectionAttemptsPerMinutePerIp: 30,
      passwordAttemptsPerMinutePerIp: 10,
      commandsPerMinutePerSession: 180,
      mutationsPerMinutePerParticipant: 120,
      rollsPerMinutePerRoom: 300,
    },
    lifecycle: {
      staleSessionSeconds: 900,
      roomIdleExpirySeconds: 86400,
      historyRetentionSeconds: 2592000,
      revisionRetentionSeconds: 2592000,
      maintenanceIntervalSeconds: 300,
    },
  };
}

class PasswordWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    super();
    this.url = url;
    this.readyState = PasswordWebSocket.CONNECTING;
    this.sent = [];
    this.policy = makePolicy(true);
    this.policyRevision = 0;
    PasswordWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = PasswordWebSocket.OPEN;
      this.dispatchEvent(new Event('open'));
      this.serverSend({
        type: 'roll_error',
        protocolVersion: 2,
        roomId: this.roomId,
        code: 'room_password_required',
        message: 'This room requires a password',
      });
    });
  }

  get roomId() {
    return new URL(this.url).searchParams.get('roomId');
  }

  participant() {
    const parsed = new URL(this.url);
    return {
      participantId: parsed.searchParams.get('participantId'),
      sessionId: parsed.searchParams.get('sessionId'),
      name: parsed.searchParams.get('name'),
      roles: [],
      permissions: ['roll:create', 'roll:update-own', 'roll:reveal-own'],
      connectedAt: now,
    };
  }

  finishAuthentication() {
    const participant = this.participant();
    this.serverSend({
      type: 'session_ready',
      protocolVersion: 2,
      roomId: this.roomId,
      participant,
      latestEventSequence: eventSequence,
      latestRollSequence: 0,
    });
    this.serverSend({
      type: 'room_state',
      protocolVersion: 2,
      roomId: this.roomId,
      sequence: 0,
      latestRollSequence: 0,
      latestEventSequence: eventSequence,
      eventBufferStartSequence: eventSequence + 1,
      missedEventsTruncated: false,
      policy: this.policy,
      policyRevision: this.policyRevision,
      participants: [participant],
      recentEvents: [],
      recentRolls: [],
    });
  }

  send(raw) {
    this.sent.push(raw);
    const event = JSON.parse(raw);
    if (event.type === 'authenticate_room_password') {
      if (event.password !== CORRECT_PASSWORD) {
        this.serverSend({
          type: 'roll_error',
          protocolVersion: 2,
          roomId: this.roomId,
          code: 'invalid_room_password',
          message: 'The room password is incorrect',
        });
        return;
      }
      this.finishAuthentication();
      return;
    }
    if (event.type === 'clock_sync_ping') {
      this.serverSend({
        ...event,
        type: 'clock_sync_pong',
        protocolVersion: 2,
        roomId: this.roomId,
        serverTimeMs: Date.now(),
      });
      return;
    }
    if (event.type === 'set_room_password') {
      const previousPolicy = structuredClone(this.policy);
      this.policy = {
        ...this.policy,
        access: { passwordProtected: event.password !== null },
      };
      this.policyRevision += 1;
      this.serverSend({
        type: 'room_policy_updated',
        protocolVersion: 2,
        roomId: this.roomId,
        eventSequence: ++eventSequence,
        requestId: event.requestId,
        revision: this.policyRevision,
        actor: {
          participantId: 'gm',
          sessionId: 'gm-session',
          name: 'GM',
          roles: ['gm'],
        },
        policy: this.policy,
        previousPolicy,
      });
    }
  }

  close(code = 1000, reason = '') {
    if (this.readyState === PasswordWebSocket.CLOSED) return;
    this.readyState = PasswordWebSocket.CLOSED;
    const close = new Event('close');
    Object.assign(close, { code, reason });
    this.dispatchEvent(close);
  }

  serverSend(data) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
}

try {
  await writeFile(
    configPath,
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'CommonJS',
          moduleResolution: 'Node',
          rootDir: join(projectRoot, 'packages'),
          outDir,
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,
          lib: ['ES2023', 'DOM', 'DOM.Iterable'],
        },
        include: [join(projectRoot, 'packages/**/*.ts')],
      },
      null,
      2,
    ),
  );

  const compile = runTsc(['-p', configPath], { cwd: projectRoot });
  if (compile.status !== 0) {
    process.stderr.write(compile.stdout);
    process.stderr.write(compile.stderr);
    throw new Error('TypeScript compilation failed');
  }
  await writeFile(join(outDir, 'package.json'), '{"type":"commonjs"}\n');

  const client = await import(pathToFileURL(join(outDir, 'client/src/index.js')).href);
  const protocol = await import(pathToFileURL(join(outDir, 'protocol/src/index.js')).href);
  const { DiceRoom, DiceRoomPasswordError, DiceRoomPasswordRequiredError } = client;
  const { decodeClientToServerEvent } = protocol;

  await assert.rejects(
    DiceRoom.connect({
      url: 'ws://draftroll.test/rooms/protected/connect',
      roomId: 'protected',
      participant: { participantId: 'guest', sessionId: 'guest-1', name: 'Guest' },
      reconnect: false,
      clockSyncSamples: 1,
      requestTimeoutMs: 1000,
      WebSocketImpl: PasswordWebSocket,
    }),
    (error) => error instanceof DiceRoomPasswordRequiredError,
  );

  await assert.rejects(
    DiceRoom.connect({
      url: 'ws://draftroll.test/rooms/protected/connect',
      roomId: 'protected',
      participant: { participantId: 'guest', sessionId: 'guest-2', name: 'Guest' },
      roomPassword: 'wrong password',
      reconnect: false,
      clockSyncSamples: 1,
      requestTimeoutMs: 1000,
      WebSocketImpl: PasswordWebSocket,
    }),
    (error) => error instanceof DiceRoomPasswordError,
  );

  const room = await DiceRoom.connect({
    url: 'ws://draftroll.test/rooms/protected/connect',
    roomId: 'protected',
    participant: { participantId: 'guest', sessionId: 'guest-3', name: 'Guest' },
    roomPassword: CORRECT_PASSWORD,
    reconnect: false,
    clockSyncSamples: 1,
    requestTimeoutMs: 1000,
    WebSocketImpl: PasswordWebSocket,
  });

  const socket = PasswordWebSocket.instances.at(-1);
  assert.equal(
    new URL(socket.url).searchParams.has('roomPassword'),
    false,
    'password must never be placed in the WebSocket URL',
  );
  const authentication = socket.sent
    .map(JSON.parse)
    .find((event) => event.type === 'authenticate_room_password');
  assert.equal(authentication.password, CORRECT_PASSWORD);
  assert.equal(room.policy.access.passwordProtected, true);

  const request = room.authorizeHttpRequest('https://draftroll.test/rooms/protected/history');
  assert.equal(request.headers.get('X-Draftroll-Room-Password'), CORRECT_PASSWORD);
  assert.equal(new URL(request.url).searchParams.has('roomPassword'), false);

  const updated = await room.setPassword(null);
  assert.equal(updated.policy.access.passwordProtected, false);
  assert.equal(updated.previousPolicy.access.passwordProtected, true);

  assert.equal(
    decodeClientToServerEvent({ type: 'authenticate_room_password', password: CORRECT_PASSWORD })
      .success,
    true,
  );
  assert.equal(
    decodeClientToServerEvent({ type: 'authenticate_room_password', password: 'short' }).success,
    false,
  );
  assert.equal(
    decodeClientToServerEvent({ type: 'set_room_password', requestId: 'request-1', password: null })
      .success,
    true,
  );

  const workerSource = await readFile(join(projectRoot, 'apps/worker/src/index.ts'), 'utf8');
  assert.match(workerSource, /PBKDF2-SHA-256/);
  assert.match(workerSource, /ROOM_PASSWORD_PBKDF2_ITERATIONS\s*=\s*210_000/);
  assert.match(workerSource, /constantTimeEqual/);
  assert.match(workerSource, /X-Draftroll-Room-Password/);
  assert.doesNotMatch(workerSource, /state\.storage\.put\([^\n]*event\.password/);

  const packageFiles = [
    'package.json',
    'packages/client/package.json',
    'packages/core/package.json',
    'packages/overlay/package.json',
    'packages/protocol/package.json',
    'packages/renderer/package.json',
    'packages/sdk/package.json',
    'packages/server/package.json',
    'packages/themes/package.json',
    'apps/worker/package.json',
  ];
  for (const file of packageFiles) {
    const pkg = JSON.parse(await readFile(join(projectRoot, file), 'utf8'));
    assert.equal(pkg.version, '0.1.0', `${file} version must remain unchanged`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        tested: [
          'password-required handshake without room-state leakage',
          'typed missing and invalid password errors',
          'password sent after WebSocket open and never in URL',
          'HTTP password header helper',
          'password set/remove policy revisions',
          'runtime password validation',
          'PBKDF2 salted verifier and constant-time comparison implementation',
          'no package version bumps',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
