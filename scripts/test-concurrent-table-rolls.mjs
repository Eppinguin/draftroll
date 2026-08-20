import assert from 'node:assert/strict';
import { runTsc } from './lib/load-typescript.mjs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tempRoot = await mkdtemp(join(tmpdir(), 'draftroll-concurrent-table-'));
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

  const { DraftrollRenderer } = await import(
    pathToFileURL(join(outDir, 'renderer/src/index.js')).href
  );
  const calls = [];
  const bridge = {
    async roll(request) {
      calls.push(request);
      return {
        results: (request.physical ?? []).map((visual) => visual.result),
        total: 999,
        replay: { batch: calls.length },
      };
    },
    getThemes() {
      return [{ id: 'dragon', name: 'Wyrmfire' }];
    },
  };
  const renderer = new DraftrollRenderer({ bridge });
  const startTime = Date.now() + 220;
  const alice = {
    authority: 'server',
    rollId: 'roll-alice',
    sequence: 1,
    revision: 0,
    expression: '1d20+4',
    name: 'Sword attack',
    total: 19,
    dice: [{ id: 'alice-d20', type: 'd20', sides: 20, result: 15, kept: true }],
    operations: [],
    createdAt: new Date(0).toISOString(),
  };
  const bob = {
    authority: 'server',
    rollId: 'roll-bob',
    sequence: 2,
    revision: 0,
    expression: '2d6',
    name: 'Damage',
    total: 9,
    dice: [
      { id: 'bob-d6-a', type: 'd6', sides: 6, result: 4, kept: true },
      { id: 'bob-d6-b', type: 'd6', sides: 6, result: 5, kept: true },
    ],
    operations: [],
    createdAt: new Date(1).toISOString(),
  };

  const [aliceCompletion, bobCompletion] = await Promise.all([
    renderer.playRoll(alice, {
      startTime,
      table: {
        mode: 'concurrent',
        groupId: alice.rollId,
        actorLabel: 'Alice',
        rollLabel: alice.name,
        batchWindowMs: 180,
      },
    }),
    renderer.playRoll(bob, {
      startTime: startTime + 20,
      table: {
        mode: 'concurrent',
        groupId: bob.rollId,
        actorLabel: 'Bob',
        rollLabel: bob.name,
        batchWindowMs: 180,
      },
    }),
  ]);

  assert.equal(calls.length, 1, 'simultaneous room rolls should share one bridge throw');
  assert.equal(
    calls[0].tableMode,
    'add',
    'concurrent room rolls should target the persistent table path',
  );
  assert.deepEqual(
    calls[0].physical.map((visual) => visual.result),
    [15, 4, 5],
  );
  assert.deepEqual(
    calls[0].physical.map((visual) => visual.canonicalKind),
    ['d20', 'd6', 'd6'],
  );
  assert.equal(calls[0].results, undefined);
  assert.equal(calls[0].kinds, undefined);
  assert.equal(calls[0].context.tableRolls.length, 2);
  assert.deepEqual(
    calls[0].context.tableRolls.map((entry) => ({
      groupId: entry.groupId,
      actorLabel: entry.actorLabel,
      physicalStart: entry.physicalStart,
      physicalCount: entry.physicalCount,
      total: entry.total,
    })),
    [
      { groupId: 'roll-alice', actorLabel: 'Alice', physicalStart: 0, physicalCount: 1, total: 19 },
      { groupId: 'roll-bob', actorLabel: 'Bob', physicalStart: 1, physicalCount: 2, total: 9 },
    ],
  );
  assert.deepEqual(aliceCompletion.results, [15]);
  assert.equal(aliceCompletion.total, 19);
  assert.deepEqual(bobCompletion.results, [4, 5]);
  assert.equal(bobCompletion.total, 9);
  assert.deepEqual(aliceCompletion.replay, bobCompletion.replay);

  await Promise.all([
    renderer.playRoll(alice, {
      startTime: Date.now() + 220,
      table: { mode: 'concurrent', groupId: 'separate-a', batchWindowMs: 50 },
    }),
    renderer.playRoll(bob, {
      startTime: Date.now() + 420,
      table: { mode: 'concurrent', groupId: 'separate-b', batchWindowMs: 50 },
    }),
  ]);
  assert.equal(calls.length, 3, 'rolls outside the table window should remain separate throws');

  const rendererSource = await readFile(
    join(projectRoot, 'packages/renderer/src/index.ts'),
    'utf8',
  );
  const sdkSource = await readFile(join(projectRoot, 'packages/sdk/src/index.ts'), 'utf8');
  const mainSource = await readFile(join(projectRoot, 'src/main.ts'), 'utf8');
  const overlaySource = await readFile(join(projectRoot, 'packages/overlay/src/index.ts'), 'utf8');
  const workerSource = await readFile(join(projectRoot, 'src/roll-worker.ts'), 'utf8');
  assert.match(rendererSource, /pendingTablePresentations/);
  assert.match(rendererSource, /tableRolls/);
  assert.match(sdkSource, /concurrentTableRolls\?: boolean/);
  assert.match(sdkSource, /actorLabel: event\.actor\.name/);
  assert.match(mainSource, /createMixedPhysicalLaunchStates/);
  // The in-motion panel names each roller (Alice  •  Bob) instead of a generic count, so it
  // keeps the same shape as the settled panel. See the browser spec "near-simultaneous room
  // rolls share one visible table throw with both roller labels".
  assert.match(mainSource, /Name the rollers while the throw is still in motion/);
  assert.match(mainSource, /appendTableRoll/);
  assert.match(
    mainSource,
    /\(isRolling \|\| hasCast\)/,
    'settled dice should accept later additive rolls',
  );
  assert.match(mainSource, /sampleActiveLaunchStates/);
  assert.match(mainSource, /lockedCount/);
  assert.match(overlaySource, /table: options\.table \? \{ \.\.\.options\.table \} : undefined/);
  assert.doesNotMatch(workerSource, /searchCandidate/);
  assert.doesNotMatch(workerSource, /applyTargetAssistance/);
  assert.doesNotMatch(workerSource, /applyMicroOrientationCorrection/);
  assert.match(mainSource, /applyShapeSymmetryTargets/);
  assert.match(mainSource, /createLockedTableTrajectory/);
  assert.match(mainSource, /const lockedTrajectory = isRolling/);
  assert.match(mainSource, /Keep the completed plan while the table remains visible/);
  assert.match(
    workerSource,
    /const lockedMotion = readLockedMotion\(request, requestedLockedCount\)/,
  );
  assert.match(workerSource, /const lockedCount = lockedMotion\?\.count \?\? 0/);
  const plannerSource = await readFile(join(projectRoot, 'src/physical-roll-planner.ts'), 'utf8');
  assert.match(plannerSource, /updateLockedBodies/);
  assert.doesNotMatch(mainSource, /mapLandingFaceToValue/);

  const rootPackage = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
  assert.equal(rootPackage.version, '0.1.0');

  console.log(
    JSON.stringify(
      {
        ok: true,
        tested: [
          'near-simultaneous room roll batching',
          'one shared physical bridge throw',
          'per-roll actor labels and physical ranges',
          'independent completion handles',
          'separate throws outside the concurrency window',
          'multi-hand launch lanes',
          'persistent in-flight additions with continuity preservation',
          'dynamic additions to previously settled dice',
          'overlay table-option forwarding',
          'shape-symmetry exact-result targeting',
          'no runtime face-label remapping',
          'no package version bump',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
