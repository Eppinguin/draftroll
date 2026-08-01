import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tempRoot = await mkdtemp(join(tmpdir(), 'draftroll-review-fixes-'));
const outDir = join(tempRoot, 'build');
const configPath = join(tempRoot, 'tsconfig.json');

class SequenceRng {
  constructor(values) { this.values = [...values]; }
  integer(min, max) {
    const value = this.values.shift();
    if (value === undefined) throw new Error(`Sequence RNG exhausted for ${min}..${max}`);
    assert.ok(value >= min && value <= max, `${value} outside ${min}..${max}`);
    return value;
  }
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

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

  const core = await import(pathToFileURL(join(outDir, 'core/src/index.js')).href);
  const protocol = await import(pathToFileURL(join(outDir, 'protocol/src/index.js')).href);
  const client = await import(pathToFileURL(join(outDir, 'client/src/index.js')).href);
  const sdk = await import(pathToFileURL(join(outDir, 'sdk/src/index.js')).href);
  const { DiceEngine } = core;
  const { decodeRollInput, decodeCustomDiceDefinitions, createRoomPolicy } = protocol;
  const { DiceRoom } = client;
  const { Draftroll, DraftrollSession, DraftrollRoomSession } = sdk;

  // Strict, unambiguous structured input validation.
  assert.equal(decodeRollInput({ mode: 'evaluate', expression: '1d6', dice: [] }).success, false);
  assert.equal(decodeRollInput({ mode: 'evaluate', dice: [{ id: 'a', type: 'd6' }], operations: [{ type: 'banana', target: 3 }] }).success, false);
  assert.equal(decodeRollInput({ mode: 'evaluate', dice: [{ id: 'a', type: 'd6' }], operations: [{ type: 'keep', selector: { type: 'banana', target: 1 } }] }).success, false);
  assert.equal(decodeRollInput({ mode: 'evaluate', dice: [{ id: 'a', type: 'd6' }, { id: 'a', type: 'd6' }] }).success, false);
  assert.equal(decodeRollInput({ mode: 'display', dice: [{ id: 'a', type: 'd6', result: 1 }, { id: 'a', type: 'd6', result: 2 }] }).success, false);
  assert.equal(decodeRollInput({ mode: 'evaluate', dice: [{ id: 'a', type: 'd6' }], operations: [{ type: 'keep', selector: { type: 'highest' } }] }).success, false);
  assert.equal(decodeRollInput({ mode: 'evaluate', dice: [{ id: 'a', type: 'd20' }], advantage: 'advantage' }).success, false);

  // Generated IDs skip user-provided IDs rather than colliding.
  const collisionEngine = new DiceEngine({ rng: new SequenceRng([2]) });
  const collision = collisionEngine.evaluate({
    mode: 'evaluate',
    dice: [
      { id: 'a', type: 'd6', result: 1 },
      { id: 'a__reroll_1', type: 'd6', result: 6 },
    ],
    operations: [{ type: 'reroll-once', selector: { type: 'literal', target: 1 }, dice: ['a'] }],
  });
  assert.equal(new Set(collision.dice.map((die) => die.id)).size, collision.dice.length);
  assert.ok(collision.dice.some((die) => die.id === 'a__reroll_2'));

  // Advantage searches the complete expression tree, not just the left branch.
  const advantage = new DiceEngine({ rng: new SequenceRng([8, 19]) }).roll('5 + 1d20', { advantage: 'advantage' });
  assert.equal(advantage.total, 24);
  assert.equal(advantage.dice.filter((die) => die.kept).length, 1);

  // Comments survive rerolls and expression updates.
  const commentEngine = new DiceEngine({ rng: new SequenceRng([2, 5]) });
  const commented = commentEngine.roll('1d6 attack roll', { allowComments: true });
  const rerolled = commentEngine.reroll(commented, commented.dice[0].id);
  assert.equal(rerolled.comment, 'attack roll');
  const revised = commentEngine.update(commented, { dice: [{ id: commented.dice[0].id, result: 4 }] });
  assert.equal(revised.comment, 'attack roll');

  // Floor modulo matches the documented d20/Python behavior.
  assert.equal(new DiceEngine().roll('-5 % 2').total, 1);

  // One custom-die validator is used by protocol and direct registration.
  const invalidCustom = [{ id: 'weighted', faces: [{ result: 1, weight: 1.5 }] }];
  assert.equal(decodeCustomDiceDefinitions(invalidCustom).success, false);
  assert.throws(() => new DiceEngine().registerDie(invalidCustom[0]));
  assert.equal(decodeCustomDiceDefinitions([{ id: 'overflow', faces: [{ result: 1, weight: Number.MAX_SAFE_INTEGER }, { result: 2, weight: 1 }] }]).success, false);

  // Failed sends clean pending request state and do not schedule a later rejection.
  const disconnected = new DiceRoom({
    url: 'ws://example.test/rooms/test',
    roomId: 'test',
    reconnect: false,
    requestTimeoutMs: 5,
  });
  let unhandled = 0;
  const onUnhandled = () => { unhandled += 1; };
  process.on('unhandledRejection', onUnhandled);
  await assert.rejects(disconnected.roll('1d6'), /not connected/i);
  assert.equal(disconnected.pendingRequests.size, 0);
  await new Promise((resolve) => setTimeout(resolve, 15));
  process.off('unhandledRejection', onUnhandled);
  assert.equal(unhandled, 0);

  // Long-range recovery paginates until the advertised sequence is traversed.
  const recoveryCursors = [];
  const recoveryRoom = new DiceRoom({
    url: 'ws://example.test/rooms/recovery',
    roomId: 'recovery',
    reconnect: false,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      const cursor = Number(url.searchParams.get('afterEventSequence'));
      recoveryCursors.push(cursor);
      const next = Math.min(2500, cursor + 1000);
      return new Response(JSON.stringify({
        events: [],
        nextAfterEventSequence: next,
        latestEventSequence: 2500,
        hasMore: next < 2500,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  await recoveryRoom.recoverLongRangeEvents(0);
  assert.deepEqual(recoveryCursors, [0, 1000, 2000]);
  assert.equal(recoveryRoom.getRequestMetrics().longRangeRecoveries, 1);

  // Recovery also paginates against compatible endpoints without new cursor metadata.
  const legacyRecoveryCursors = [];
  const legacyRecoveryRoom = new DiceRoom({
    url: 'ws://example.test/rooms/legacy-recovery',
    roomId: 'legacy-recovery',
    reconnect: false,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      const cursor = Number(url.searchParams.get('afterEventSequence'));
      legacyRecoveryCursors.push(cursor);
      const count = cursor < 2000 ? 1000 : 0;
      const policy = createRoomPolicy('open-table');
      return new Response(JSON.stringify({
        events: Array.from({ length: count }, (_, index) => ({
          type: 'room_policy_updated',
          protocolVersion: 2,
          roomId: 'legacy-recovery',
          eventSequence: cursor + index + 1,
          revision: cursor + index + 1,
          actor: { participantId: 'gm', sessionId: 'gm-session', name: 'GM', roles: ['gm'] },
          policy,
          previousPolicy: policy,
          replayed: true,
        })),
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  await legacyRecoveryRoom.recoverLongRangeEvents(0);
  assert.deepEqual(legacyRecoveryCursors, [0, 1000, 2000]);

  // Renderer failures are observable and also remain awaitable by the caller.
  const rendererFailure = new Error('renderer exploded');
  const errors = [];
  const failingDraftroll = new Draftroll({ renderer: { playRoll: () => { throw rendererFailure; } } });
  failingDraftroll.on('error', ({ error }) => errors.push(error));
  const failedPresentation = failingDraftroll.roll('1d1');
  await assert.rejects(failedPresentation.wait(), /renderer exploded|Renderer operation/);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'renderer_operation_failed');

  // Renderer replacement commits the new renderer even when old cleanup fails.
  const oldRenderer = {
    playRoll: async (result) => ({ results: result.dice.map((die) => die.result), total: result.total, replay: null }),
    clear: async () => { throw new Error('clear failed'); },
  };
  const newRenderer = {
    playRoll: async (result) => ({ results: result.dice.map((die) => die.result), total: result.total, replay: null }),
  };
  const lifecycle = new DraftrollSession({ renderer: oldRenderer });
  const lifecycleErrors = [];
  lifecycle.on('error', ({ error }) => lifecycleErrors.push(error));
  await lifecycle.setRenderer(newRenderer);
  assert.equal(lifecycle.renderer, newRenderer);
  assert.equal(lifecycleErrors.length, 1);

  // Local display propagates the session AbortSignal to presentation.
  let displaySignal;
  const signalRenderer = {
    playRoll: async (result, options) => {
      displaySignal = options?.signal;
      return { results: result.dice.map((die) => die.result), total: result.total, replay: null };
    },
  };
  const signalSession = new DraftrollSession({ renderer: signalRenderer });
  const controller = new AbortController();
  const displayed = await signalSession.display({ dice: [{ id: 'd', type: 'd6', result: 4 }] }, { signal: controller.signal });
  await displayed.wait();
  assert.equal(displaySignal, controller.signal);

  // Room listeners receive the current presentation promise before the roll event.
  const presentationGate = deferred();
  let socketInstance;
  class MockWebSocket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(url) {
      super();
      this.url = url;
      this.readyState = MockWebSocket.CONNECTING;
      socketInstance = this;
      queueMicrotask(() => {
        this.readyState = MockWebSocket.OPEN;
        this.dispatchEvent(new Event('open'));
        const parsed = new URL(url);
        this.serverSend({
          type: 'session_ready', protocolVersion: 2, roomId: 'room', latestEventSequence: 0, latestRollSequence: 0,
          participant: {
            participantId: parsed.searchParams.get('participantId'), sessionId: parsed.searchParams.get('sessionId'),
            name: parsed.searchParams.get('name'), roles: [], permissions: ['roll:create'], connectedAt: new Date(0).toISOString(),
          },
        });
      });
    }
    send(raw) {
      const message = JSON.parse(raw);
      if (message.type === 'clock_sync_ping') {
        this.serverSend({ type: 'clock_sync_pong', protocolVersion: 2, roomId: 'room', clientTimeMs: message.clientTimeMs, serverTimeMs: Date.now(), nonce: message.nonce });
      } else if (message.type === 'roll_request') {
        const result = {
          schemaVersion: 1, rollId: 'room-roll', sequence: 1, revision: 0, authority: 'server', expression: '1d1', total: 1,
          dice: [{ id: 'die', type: 'd1', sides: 1, result: 1, kept: true, generatedBy: 'initial' }], operations: [], createdAt: new Date(0).toISOString(),
        };
        this.serverSend({
          type: 'roll_start', protocolVersion: 2, roomId: 'room', requestId: message.requestId, eventSequence: 1,
          rollId: 'room-roll', sequence: 1,
          actor: { participantId: 'p', sessionId: 's', name: 'Player', roles: [] }, visibility: { type: 'public' }, hidden: false,
          result, summary: { rollId: 'room-roll', sequence: 1, revision: 0, actor: { participantId: 'p', sessionId: 's', name: 'Player', roles: [] }, createdAt: new Date(0).toISOString() },
          animationSeed: 'seed', serverStartTimeMs: Date.now(), animationDurationMs: 100,
        });
      }
    }
    close() { this.readyState = MockWebSocket.CLOSED; }
    serverSend(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
  }
  const roomDraftroll = new Draftroll({
    renderer: {
      playRoll: async (result) => {
        await presentationGate.promise;
        return { results: result.dice.map((die) => die.result), total: result.total, replay: null };
      },
    },
  });
  const roomSession = await DraftrollRoomSession.connect(roomDraftroll, {
    url: 'ws://example.test/rooms/room', roomId: 'room', WebSocketImpl: MockWebSocket, reconnect: false, clockSyncSamples: 1,
  });
  let listenerWait;
  roomSession.on('roll', (roll) => { listenerWait = roll.wait(); });
  const roomRollPromise = roomSession.roll('1d1');
  while (!listenerWait) await new Promise((resolve) => setTimeout(resolve, 0));
  let settled = false;
  listenerWait.then(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(settled, false);
  presentationGate.resolve();
  await listenerWait;
  await roomRollPromise;
  roomSession.close();
  assert.ok(socketInstance);

  console.log('SDK review regression fixes passed.');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
