import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tempRoot = await mkdtemp(join(tmpdir(), 'draftroll-session-lifecycle-test-'));
const outDir = join(tempRoot, 'build');
const configPath = join(tempRoot, 'tsconfig.json');
const now = new Date().toISOString();
let eventSequence = 0;

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
      const parsed = new URL(url);
      this.serverSend({
        type: 'session_ready',
        protocolVersion: 2,
        roomId: parsed.searchParams.get('roomId'),
        participant: {
          participantId: parsed.searchParams.get('participantId'),
          sessionId: parsed.searchParams.get('sessionId'),
          name: parsed.searchParams.get('name'),
          roles: [],
          permissions: ['roll:create', 'roll:update-own', 'roll:reveal-own'],
          connectedAt: now,
        },
        latestEventSequence: eventSequence,
        latestRollSequence: 0,
      });
    });
  }

  send(value) {
    this.sent.push(value);
    const message = JSON.parse(value);
    const roomId = new URL(this.url).searchParams.get('roomId');
    if (message.type === 'clock_sync_ping') {
      this.serverSend({
        type: 'clock_sync_pong',
        protocolVersion: 2,
        roomId,
        clientTimeMs: message.clientTimeMs,
        serverTimeMs: Date.now(),
        nonce: message.nonce,
      });
      return;
    }
    if (message.type === 'roll_request' || message.type === 'display_roll') {
      const rollId = message.clientRollId ?? `room-roll-${eventSequence + 1}`;
      const result = {
        schemaVersion: 1,
        rollId,
        sequence: eventSequence + 1,
        revision: 0,
        authority: 'server',
        expression: message.input.expression ?? 'external',
        total: 1,
        dice: [{ id: `${rollId}-die`, type: 'd1', sides: 1, result: 1, kept: true, generatedBy: 'initial' }],
        operations: [],
        createdAt: now,
      };
      this.serverSend({
        type: 'roll_start',
        protocolVersion: 2,
        roomId,
        requestId: message.requestId,
        clientRollId: message.clientRollId,
        eventSequence: ++eventSequence,
        rollId,
        sequence: result.sequence,
        actor: {
          participantId: 'tester',
          sessionId: 'tester-session',
          name: 'Tester',
          roles: [],
        },
        visibility: message.visibility ?? { type: 'public' },
        hidden: false,
        result,
        summary: {
          rollId,
          sequence: result.sequence,
          revision: 0,
          actor: {
            participantId: 'tester',
            sessionId: 'tester-session',
            name: 'Tester',
            roles: [],
          },
          createdAt: now,
        },
        animationSeed: `seed-${eventSequence}`,
        serverStartTimeMs: Date.now(),
        animationDurationMs: 100,
      });
    }
  }

  close(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    const event = new Event('close');
    Object.assign(event, { code, reason });
    this.dispatchEvent(event);
  }

  serverSend(value) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }));
  }
}

class TestRenderer {
  constructor(name) {
    this.name = name;
    this.plays = [];
    this.clears = 0;
    this.destroyed = 0;
    this.rerollHandler = null;
  }
  async warmup() {}
  async playRoll(result) {
    this.plays.push(result.rollId);
    return { results: result.dice.map((die) => die.result), total: result.total, replay: null };
  }
  async clear() { this.clears += 1; }
  destroy() { this.destroyed += 1; }
  setRerollHandler(handler) { this.rerollHandler = handler; }
}

try {
  await writeFile(configPath, JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'CommonJS',
      moduleResolution: 'Node',
      rootDir: join(projectRoot, 'packages'),
      outDir,
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    },
    include: [join(projectRoot, 'packages/**/*.ts')],
  }, null, 2));

  const compile = spawnSync('tsc', ['-p', configPath], { cwd: projectRoot, encoding: 'utf8' });
  if (compile.status !== 0) {
    process.stderr.write(compile.stdout);
    process.stderr.write(compile.stderr);
    throw new Error('TypeScript compilation failed');
  }
  await writeFile(join(outDir, 'package.json'), '{"type":"commonjs"}\n');

  const sdk = await import(pathToFileURL(join(outDir, 'sdk/src/index.js')).href);
  const { DraftrollSession } = sdk;
  const session = new DraftrollSession();
  const stableSdk = session.draftroll;
  const states = [];
  const observedRolls = [];
  session.on('state', (state) => states.push({ ...state }));
  session.on('roll', (roll) => observedRolls.push(roll.id));

  const local = await session.roll('1d1');
  assert.equal(local.total, 1);
  assert.equal(session.mode, 'local');
  assert.equal(session.draftroll, stableSdk);
  assert.equal(session.rollLog.length, 1);

  const ownedRenderer = new TestRenderer('owned');
  await session.setRenderer(ownedRenderer, { owned: true });
  assert.equal(session.snapshot.rendererEnabled, true);
  assert.equal(typeof ownedRenderer.rerollHandler, 'function');
  const renderedLocal = await session.roll('1d1');
  await renderedLocal.wait();
  assert.equal(ownedRenderer.plays.length, 1);

  const room = await session.connectRoom({
    url: 'ws://draftroll.test/rooms/lifecycle/connect',
    roomId: 'lifecycle',
    participant: { participantId: 'tester', sessionId: 'tester-session', name: 'Tester' },
    reconnect: false,
    clockSyncSamples: 1,
    autoPresent: true,
    WebSocketImpl: MockWebSocket,
  });
  assert.equal(session.mode, 'realtime');
  assert.equal(session.status, 'realtime');
  assert.equal(session.snapshot.roomId, 'lifecycle');
  assert.equal(session.draftroll, stableSdk);
  assert.equal(room.roomId, 'lifecycle');
  const readyAfterConnect = MockWebSocket.instances.at(-1).sent.map(JSON.parse).filter((event) => event.type === 'client_ready');
  assert.equal(readyAfterConnect.at(-1).rendererReady, true);

  const remote = await session.roll('1d1', { clientRollId: 'remote-stable-id' });
  await remote.wait();
  assert.equal(remote.id, 'remote-stable-id');
  assert.equal(ownedRenderer.plays.at(-1), 'remote-stable-id');
  assert.equal(session.getRoll('remote-stable-id'), remote);

  await session.disableRenderer();
  assert.equal(session.renderer, undefined);
  assert.equal(ownedRenderer.clears, 1);
  assert.equal(ownedRenderer.destroyed, 1, 'owned renderer is destroyed on detach');
  assert.equal(ownedRenderer.rerollHandler, null);
  const readyAfterDisable = MockWebSocket.instances.at(-1).sent.map(JSON.parse).filter((event) => event.type === 'client_ready');
  assert.equal(readyAfterDisable.at(-1).rendererReady, false);

  const unrenderedRemote = await session.roll('1d1', { clientRollId: 'remote-headless' });
  await unrenderedRemote.wait();
  assert.equal(ownedRenderer.plays.includes('remote-headless'), false);

  session.useLocal();
  assert.equal(session.mode, 'local');
  assert.equal(session.status, 'local');
  const localAgain = await session.roll('1d1');
  assert.equal(localAgain.total, 1);
  assert.equal(session.draftroll, stableSdk);
  assert.ok(session.draftroll.rollLog.length >= 3, 'local/server history remains on the stable Draftroll instance');

  const externalRenderer = new TestRenderer('external');
  await session.setRenderer(externalRenderer);
  await session.dispose();
  assert.equal(session.status, 'disposed');
  assert.equal(externalRenderer.clears, 1);
  assert.equal(externalRenderer.destroyed, 0, 'externally owned renderer is not destroyed');
  assert.equal(states.at(-1).status, 'disposed');
  assert.ok(states.some((state) => state.status === 'connecting'));
  assert.ok(states.some((state) => state.status === 'realtime'));
  assert.ok(observedRolls.includes(local.id));
  assert.ok(observedRolls.includes('remote-stable-id'));
  await assert.rejects(session.roll('1d1'), /disposed/);

  console.log(JSON.stringify({
    passed: true,
    checks: [
      'stable local SDK identity and subscriptions',
      'local to realtime to local routing',
      'renderer attach/detach readiness',
      'owned versus external renderer cleanup',
      'room and local history continuity',
      'disposed lifecycle guard',
    ],
  }, null, 2));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
