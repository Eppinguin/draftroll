import assert from 'node:assert/strict';
import { runTsc } from './lib/load-typescript.mjs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tempRoot = await mkdtemp(join(tmpdir(), 'draftroll-late-events-'));
const outDir = join(tempRoot, 'build');
const configPath = join(tempRoot, 'tsconfig.json');

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

  const rendererModule = await import(pathToFileURL(join(outDir, 'renderer/src/index.js')).href);
  const clientModule = await import(pathToFileURL(join(outDir, 'client/src/index.js')).href);
  const protocolModule = await import(pathToFileURL(join(outDir, 'protocol/src/index.js')).href);
  const { resolveLateEventPresentation, DraftrollRenderer } = rendererModule;
  const { synchronizeRoomEvent } = clientModule;
  const { decodeClientToServerEvent, decodeServerToClientEvent } = protocolModule;

  assert.deepEqual(resolveLateEventPresentation({ elapsedMs: 0, animationDurationMs: 2800 }), {
    seekToMs: 0,
    settleImmediately: false,
    mode: 'auto',
  });
  assert.deepEqual(resolveLateEventPresentation({ elapsedMs: 700, animationDurationMs: 2800 }), {
    seekToMs: 700,
    settleImmediately: false,
    mode: 'seek',
  });
  assert.deepEqual(resolveLateEventPresentation({ elapsedMs: 2300, animationDurationMs: 2800 }), {
    seekToMs: 2800,
    settleImmediately: true,
    mode: 'settled',
  });
  assert.deepEqual(
    resolveLateEventPresentation({
      elapsedMs: 2600,
      animationDurationMs: 2800,
      lateEvent: { mode: 'seek' },
    }),
    {
      seekToMs: 2600,
      settleImmediately: false,
      mode: 'seek',
    },
  );
  assert.deepEqual(
    resolveLateEventPresentation({
      elapsedMs: 2600,
      animationDurationMs: 2800,
      lateEvent: { mode: 'replay' },
    }),
    {
      seekToMs: 0,
      settleImmediately: false,
      mode: 'replay',
    },
  );

  const calls = [];
  const bridge = {
    async roll(request) {
      calls.push(request);
      return { results: request.results ?? [], total: 17, replay: null };
    },
    setDie() {},
    setQuantity() {},
    setTheme() {},
    getThemes() {
      return [{ id: 'dragon', name: 'Wyrmfire' }];
    },
  };
  const renderer = new DraftrollRenderer({ bridge });
  const result = {
    authority: 'server',
    rollId: 'roll-late',
    sequence: 1,
    revision: 0,
    expression: '1d20',
    total: 17,
    dice: [{ id: 'die-1', type: 'd20', sides: 20, result: 17, kept: true }],
    operations: [],
    createdAt: new Date(0).toISOString(),
  };
  await renderer.playRoll(result, { elapsedMs: 900, animationDurationMs: 2800 });
  assert.equal(calls[0].seekToMs, 900);
  assert.equal(calls[0].settleImmediately, false);
  assert.equal(calls[0].lateMode, 'seek');
  await renderer.playRoll(result, { elapsedMs: 2500, animationDurationMs: 2800 });
  assert.equal(calls[1].seekToMs, 2800);
  assert.equal(calls[1].settleImmediately, true);
  assert.equal(calls[1].lateMode, 'settled');

  const now = 10_000;
  const synchronized = synchronizeRoomEvent(
    {
      type: 'roll_start',
      protocolVersion: 2,
      roomId: 'table',
      eventSequence: 1,
      rollId: 'roll-late',
      sequence: 1,
      actor: { participantId: 'p', sessionId: 's', name: 'Player', roles: [] },
      visibility: { type: 'public' },
      hidden: false,
      summary: {
        rollId: 'roll-late',
        sequence: 1,
        revision: 0,
        actor: { participantId: 'p', sessionId: 's', name: 'Player', roles: [] },
        createdAt: new Date(0).toISOString(),
      },
      result,
      serverStartTimeMs: 8_700,
      animationDurationMs: 2_800,
      startBufferMs: 475,
    },
    200,
    now,
  );
  assert.equal(synchronized.localStartTimeMs, 8_500);
  assert.equal(synchronized.elapsedMs, 1_500);
  assert.equal(synchronized.animationProgress, 1_500 / 2_800);

  assert.equal(
    decodeClientToServerEvent({
      type: 'client_ready',
      rendererReady: true,
      themesReady: true,
      roundTripMs: 120,
      clockUncertaintyMs: 18,
    }).success,
    true,
  );
  const {
    localStartTimeMs: _localStartTimeMs,
    elapsedMs: _elapsedMs,
    animationProgress: _animationProgress,
    ...wireEvent
  } = synchronized;
  const decodedWire = decodeServerToClientEvent(
    {
      ...wireEvent,
      replayed: false,
    },
    { allowLegacyResults: true },
  );
  assert.equal(decodedWire.success, true);

  const rendererSource = await readFile(join(projectRoot, 'src/main.ts'), 'utf8');
  assert.match(rendererSource, /applyPlanTransform\(plan, planTime\)/);
  assert.match(rendererSource, /impact\.time > planTime/);
  assert.match(rendererSource, /startLatenessMs/);
  assert.match(rendererSource, /Presenting settled result/);

  const workerSource = await readFile(join(projectRoot, 'apps/worker/src/index.ts'), 'utf8');
  assert.match(workerSource, /calculateAnimationStartBufferMs/);
  assert.match(workerSource, /roundTripMs \/ 2 \+ uncertaintyMs/);
  assert.match(workerSource, /MAX_ANIMATION_START_BUFFER_MS/);
  assert.doesNotMatch(workerSource, /serverStartTimeMs: Date\.now\(\) \+ 225/);

  const rootPackage = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
  assert.equal(rootPackage.version, '0.1.0');
  assert.equal(protocolModule.DRAFTROLL_PROTOCOL_VERSION, 2);

  console.log(
    JSON.stringify(
      {
        ok: true,
        tested: [
          'clock-offset elapsed calculation',
          'moderately late replay seeking',
          'adaptive settled presentation',
          'forced full replay and forced seek modes',
          'bridge seek propagation',
          'client timing diagnostics',
          'adaptive Durable Object start buffers',
          'no package or protocol version bump',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
