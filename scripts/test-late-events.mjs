import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(import.meta.dirname, '..');
const outputDirectory = await mkdtemp(join(tmpdir(), 'draftroll-late-events-'));
const tsconfigPath = join(outputDirectory, 'tsconfig.json');
const sourcePath = join(projectRoot, 'packages/client/src/index.ts');
const protocolPath = join(projectRoot, 'packages/protocol/src/index.ts');
const corePath = join(projectRoot, 'packages/core/src/index.ts');

await Bun.write(
  tsconfigPath,
  JSON.stringify({
    compilerOptions: {
      target: 'ES2023',
      module: 'ES2022',
      moduleResolution: 'Bundler',
      outDir: outputDirectory,
      rootDir: projectRoot,
      skipLibCheck: true,
      strict: true,
      noEmitOnError: true,
      types: ['node'],
    },
    include: [sourcePath, protocolPath, corePath],
  }),
);

execFileSync('pnpm', ['exec', 'tsc', '-p', tsconfigPath], {
  cwd: projectRoot,
  stdio: 'inherit',
});

const protocolModule = await import(
  `${pathToFileURL(join(outputDirectory, 'packages/protocol/src/index.js')).href}?${Date.now()}`
);
const clientModule = await import(
  `${pathToFileURL(join(outputDirectory, 'packages/client/src/index.js')).href}?${Date.now()}`
);

const { decodeServerToClientEvent } = protocolModule;
const {
  calculateAnimationStartBufferMs,
  calculateClockSynchronisation,
  calculateLateEventPresentation,
  createSynchronizedEvent,
  DEFAULT_LATE_EVENT_POLICY,
} = clientModule;

assert.equal(typeof calculateAnimationStartBufferMs, 'function');
assert.equal(typeof calculateClockSynchronisation, 'function');
assert.equal(typeof calculateLateEventPresentation, 'function');
assert.equal(typeof createSynchronizedEvent, 'function');

assert.equal(calculateAnimationStartBufferMs({ roundTripMs: 0, uncertaintyMs: 0 }), 80);
assert.equal(calculateAnimationStartBufferMs({ roundTripMs: 300, uncertaintyMs: 20 }), 250);
assert.equal(calculateAnimationStartBufferMs({ roundTripMs: 2_000, uncertaintyMs: 500 }), 500);

const clock = calculateClockSynchronisation({
  sentAtMs: 1_000,
  receivedAtMs: 1_100,
  serverTimeMs: 1_075,
});
assert.equal(clock.roundTripMs, 100);
assert.equal(clock.offsetMs, 25);
assert.equal(clock.uncertaintyMs, 50);

const active = calculateLateEventPresentation({
  nowMs: 2_000,
  eventServerTimeMs: 1_750,
  clockOffsetMs: 0,
  animationStartBufferMs: 100,
  animationDurationMs: 1_000,
  policy: DEFAULT_LATE_EVENT_POLICY,
});
assert.equal(active.settleImmediately, false);
assert.equal(active.seekToMs, 150);
assert.equal(active.animationProgress, 0.15);

const settled = calculateLateEventPresentation({
  nowMs: 4_000,
  eventServerTimeMs: 1_000,
  clockOffsetMs: 0,
  animationStartBufferMs: 100,
  animationDurationMs: 1_000,
  policy: DEFAULT_LATE_EVENT_POLICY,
});
assert.equal(settled.settleImmediately, true);
assert.equal(settled.seekToMs, 1_000);
assert.equal(settled.animationProgress, 1);

const forcedAnimation = calculateLateEventPresentation({
  nowMs: 4_000,
  eventServerTimeMs: 1_000,
  clockOffsetMs: 0,
  animationStartBufferMs: 100,
  animationDurationMs: 1_000,
  policy: {
    ...DEFAULT_LATE_EVENT_POLICY,
    mode: 'animate',
  },
});
assert.equal(forcedAnimation.settleImmediately, false);
assert.ok(forcedAnimation.seekToMs < 1_000);

const forcedSettle = calculateLateEventPresentation({
  nowMs: 1_050,
  eventServerTimeMs: 1_000,
  clockOffsetMs: 0,
  animationStartBufferMs: 100,
  animationDurationMs: 1_000,
  policy: {
    ...DEFAULT_LATE_EVENT_POLICY,
    mode: 'settle',
  },
});
assert.equal(forcedSettle.settleImmediately, true);

const synchronized = createSynchronizedEvent(
  {
    type: 'roll_result',
    sequence: 7,
    serverTimeMs: 10_000,
    roomId: 'room',
    result: {
      id: 'roll',
      formula: '1d20',
      total: 11,
      results: [11],
      createdAt: '2026-01-01T00:00:00.000Z',
      visibility: 'public',
      metadata: {},
    },
  },
  {
    nowMs: 10_400,
    clockOffsetMs: 0,
    animationStartBufferMs: 100,
    animationDurationMs: 1_000,
    policy: DEFAULT_LATE_EVENT_POLICY,
  },
);
assert.equal(synchronized.settleImmediately, false);
assert.equal(synchronized.seekToMs, 300);
assert.equal(synchronized.animationProgress, 0.3);

const {
  startLatenessMs: _startLatenessMs,
  seekToMs: _seekToMs,
  settleImmediately: _settleImmediately,
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
assert.match(rendererSource, /function updatePlanVisuals/);
assert.match(rendererSource, /const scale = planDisplayScale\(plan\)/);
assert.match(rendererSource, /applyPlanTransform\(plan, time, scale\.x, scale\.z\)/);
assert.match(
  rendererSource,
  /genericPhysicalVisuals\.forEach\(\(visual\) => visual\.update\(time, scale\.x, scale\.z\)\)/,
);
assert.match(rendererSource, /updatePlanVisuals\(plan, planTime\)/);
assert.match(rendererSource, /impact\.time > planTime/);
assert.match(rendererSource, /startLatenessMs/);
assert.match(rendererSource, /Presenting settled result/);

const workerSource = await readFile(join(projectRoot, 'apps/worker/src/index.ts'), 'utf8');
assert.match(workerSource, /calculateAnimationStartBufferMs/);
assert.match(workerSource, /roundTripMs \/ 2 \+ uncertaintyMs/);
assert.match(workerSource, /MAX_ANIMATION_START_BUFFER_MS/);
assert.doesNotMatch(workerSource, /serverStartTimeMs: Date\.now\(\) \+ 225/);

console.log(
  JSON.stringify(
    {
      ok: true,
      tested: [
        'clock synchronization offset and uncertainty',
        'RTT-aware animation start buffer',
        'late-event catch-up seeking',
        'very-late settled presentation',
        'explicit animate/settle policies',
        'synchronized event wrapper',
        'shared canonical/generated replay scaling',
        'worker start-time policy',
      ],
    },
    null,
    2,
  ),
);
