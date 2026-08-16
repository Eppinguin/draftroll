import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), 'utf8');
}

async function write(path, content) {
  await writeFile(new URL(path, root), content);
}

function countLiteral(text, needle) {
  return text.split(needle).length - 1;
}

function replaceOnce(text, needle, replacement, label = needle.slice(0, 80)) {
  const count = countLiteral(text, needle);
  if (count !== 1) throw new Error(`${label} expected once, found ${count}`);
  return text.replace(needle, replacement);
}

function replaceRegexOnce(text, regex, replacement, label) {
  const matches = [
    ...text.matchAll(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g')),
  ];
  if (matches.length !== 1) throw new Error(`${label} expected once, found ${matches.length}`);
  return text.replace(regex, replacement);
}

let worker = await read('src/roll-worker.ts');
worker = replaceOnce(
  worker,
  `  lockedTrajectoryFrameCount?: number;\n}`,
  `  lockedTrajectoryFrameCount?: number;\n  gravity?: number;\n}`,
  'worker gravity request',
);
worker = replaceOnce(
  worker,
  `    lockedMotion: readLockedMotion(request, lockedCount),\n  });`,
  `    lockedMotion: readLockedMotion(request, lockedCount),\n    gravity: request.gravity,\n  });`,
  'worker forwards gravity',
);
await write('src/roll-worker.ts', worker);

let main = await read('src/main.ts');
main = replaceOnce(
  main,
  `import {\n  markUnobstructedTableDice,\n  minimumRestingAlignment,\n  readRestingAlignment,\n  releaseUnstableRestPose,\n} from './resting-physics';\n`,
  `import { PhysicalRollPlanner, type PhysicalRollPlanResult } from './physical-roll-planner';\n`,
  'replace old resting planner imports',
);
main = replaceOnce(
  main,
  `const PLANNER_STEP = 1 / 120;\nconst PLANNER_RECORD_EVERY = 1;\nconst PLANNER_RECORD_STEP = PLANNER_STEP * PLANNER_RECORD_EVERY;\n`,
  '',
  'remove duplicate planner constants',
);
main = replaceRegexOnce(
  main,
  /function cloneDynamicBody\([\s\S]*?\ninterface WorkerPhysicalPlanEntry \{/,
  `interface WorkerPhysicalPlanEntry {`,
  'remove duplicate synchronous planner',
);
main = replaceRegexOnce(
  main,
  /function enforceBodiesBounds\([\s\S]*?\nfunction attachCollisionAudio\(/,
  `function attachCollisionAudio(`,
  'remove duplicate bounds integrator',
);
main = replaceRegexOnce(
  main,
  /function spawnGenericPhysicalVisuals\([\s\S]*?\n}\n\nfunction spawnFallbackVisuals/,
  `function spawnGenericPhysicalVisuals(specs: readonly DraftrollPhysicalVisual[]): void {\n  clearGenericPhysicalVisuals();\n  if (specs.length === 0) return;\n  genericPhysicalVisuals = specs.map((spec) => {\n    const visual = new PhysicalDieVisualInstance(spec);\n    visual.prepare();\n    scene.add(visual.group);\n    return visual;\n  });\n}\n\nfunction spawnFallbackVisuals`,
  'streamline generic physical spawn',
);
main = main.replaceAll(
  `spawnGenericPhysicalVisuals(currentGenericPhysicalSpecs(), activeSeed);`,
  `spawnGenericPhysicalVisuals(currentGenericPhysicalSpecs());`,
);
main = main.replaceAll(
  `spawnGenericPhysicalVisuals(generic, activeSeed);`,
  `spawnGenericPhysicalVisuals(generic);`,
);
main = replaceRegexOnce(
  main,
  /  const genericByPhysicalIndex = new Map\([\s\S]*?\n  \);/,
  `  const genericById = new Map(genericEntries.map((entry) => [entry.id, entry] as const));\n  if (genericById.size !== genericEntries.length) {\n    throw new Error('Generic physical visual ids must be unique.');\n  }`,
  'id-index generic plan entries',
);
main = replaceOnce(
  main,
  `    const generic = genericByPhysicalIndex.get(physicalIndex);`,
  `    const generic = genericById.get(spec.id);`,
  'generic state lookup by id',
);
main = replaceRegexOnce(
  main,
  /async function buildRollPlan\([\s\S]*?\n}\n\nfunction applyPlanTransform\(/,
  `const mainThreadPhysicalPlanner = new PhysicalRollPlanner();

function activeGenericPlanAssignments() {
  return activeGenericPhysicalIndexes.map((physicalIndex) => {
    const spec = activePhysicalSpecs[physicalIndex];
    if (!spec) throw new Error(\`Generic physical descriptor is missing at \${physicalIndex}.\`);
    return { id: spec.id, physicalIndex };
  });
}

function plannerResultAsRollPlan(
  result: PhysicalRollPlanResult,
  dieCount: number,
  lockedCount: number,
): Omit<RollPlan, 'results'> {
  const impacts: RollImpact[] = [];
  for (let offset = 0; offset + 2 < result.impacts.length; offset += 3) {
    impacts.push({
      time: result.impacts[offset],
      dieIndex: Math.round(result.impacts[offset + 1]),
      strength: result.impacts[offset + 2],
    });
  }
  return {
    step: result.step,
    frameCount: result.frameCount,
    dieCount,
    transforms: result.transforms,
    landings: result.landings,
    impacts,
    duration: result.duration,
    settleReason: result.settleReason,
    physicsSteps: result.physicsSteps,
    diagnostics: {
      planningMs: result.planningMs,
      naturalTrajectory: true,
      naturalMatches: dieCount,
      targetSuccess: true,
      lockedKinematicDice: lockedCount,
    },
  };
}

function completePhysicalPlan(
  basePlan: Omit<RollPlan, 'results'>,
  entries: readonly WorkerPhysicalPlanEntry[],
  preservedPhysicalCount: number,
): RollPlan {
  const completed = applyShapeSymmetryTargets(
    {
      ...basePlan,
      results: [],
      activationDelays: Float32Array.from(entries, (entry) => entry.state[13] ?? 0),
    },
    preservedPhysicalCount,
  );
  commitPhysicalVisualPlan(
    completed.transforms,
    completed.frameCount,
    completed.step,
    completed.dieCount,
    activeGenericPlanAssignments(),
    completed.landings,
    completed.activationDelays,
  );
  return completed;
}

async function buildRollPlan(
  states: LaunchState[],
  preservedPhysicalCount = 0,
  lockedTrajectory?: LockedTableTrajectory,
): Promise<RollPlan> {
  const entries = createWorkerPhysicalEntries(states);
  const lockedCount = lockedTrajectory ? preservedPhysicalCount : 0;
  const worker = getRollWorker();
  if (!worker) {
    const result = mainThreadPhysicalPlanner.simulate({
      entries,
      boundsX: screenBounds.x,
      boundsZ: screenBounds.z,
      lockedCount,
      lockedMotion:
        lockedTrajectory && lockedCount > 0
          ? {
              count: lockedCount,
              step: lockedTrajectory.step,
              frameCount: lockedTrajectory.frameCount,
              transforms: lockedTrajectory.transforms,
            }
          : undefined,
      gravity: PHYSICS_PRESETS[activePhysicsPreset].gravity,
    });
    return completePhysicalPlan(
      plannerResultAsRollPlan(result, entries.length, lockedCount),
      entries,
      preservedPhysicalCount,
    );
  }

  const id = nextPlanId++;
  const lockedTransforms = lockedTrajectory?.transforms.slice();
  const transfer: Transferable[] = [];
  if (lockedTransforms) transfer.push(lockedTransforms.buffer);
  const basePlan = await new Promise<Omit<RollPlan, 'results'>>((resolve, reject) => {
    pendingPlans.set(id, { resolve, reject });
    worker.postMessage(
      {
        id,
        entries,
        boundsX: screenBounds.x,
        boundsZ: screenBounds.z,
        lockedCount,
        lockedTrajectory: lockedTransforms?.buffer,
        lockedTrajectoryStep: lockedTrajectory?.step,
        lockedTrajectoryFrameCount: lockedTrajectory?.frameCount,
        gravity: PHYSICS_PRESETS[activePhysicsPreset].gravity,
      },
      transfer,
    );
  });
  return completePhysicalPlan(basePlan, entries, preservedPhysicalCount);
}\n\nfunction applyPlanTransform(`,
  'replace buildRollPlan',
);
main = replaceRegexOnce(
  main,
  /function applyPlanTransform\([\s\S]*?\n}\n\nfunction physicalWorldPositionAt\(/,
  `function planDisplayScale(plan: RollPlan): { x: number; z: number } {
  return {
    x: plan.sourceBounds
      ? Math.min(1, (screenBounds.x - 0.15) / Math.max(0.01, plan.sourceBounds.x))
      : 1,
    z: plan.sourceBounds
      ? Math.min(1, (screenBounds.z - 0.15) / Math.max(0.01, plan.sourceBounds.z))
      : 1,
  };
}

function applyPlanTransform(
  plan: RollPlan,
  time: number,
  scaleX: number,
  scaleZ: number,
): void {
  const framePosition = THREE.MathUtils.clamp(time / plan.step, 0, plan.frameCount - 1);
  const firstIndex = Math.floor(framePosition);
  const secondIndex = Math.min(firstIndex + 1, plan.frameCount - 1);
  const alpha = framePosition - firstIndex;
  const frameStride = plan.dieCount * 7;
  const firstFrameOffset = firstIndex * frameStride;
  const secondFrameOffset = secondIndex * frameStride;

  dice.forEach((die, canonicalIndex) => {
    const physicalIndex = activeCanonicalPhysicalIndexes[canonicalIndex] ?? canonicalIndex;
    const activationDelay = plan.activationDelays?.[physicalIndex] ?? 0;
    die.group.visible = time + plan.step * 0.5 >= activationDelay;
    const a = firstFrameOffset + physicalIndex * 7;
    const b = secondFrameOffset + physicalIndex * 7;
    die.body.position.set(
      THREE.MathUtils.lerp(plan.transforms[a], plan.transforms[b], alpha) * scaleX,
      THREE.MathUtils.lerp(plan.transforms[a + 1], plan.transforms[b + 1], alpha),
      THREE.MathUtils.lerp(plan.transforms[a + 2], plan.transforms[b + 2], alpha) * scaleZ,
    );
    replayQuaternionA.set(
      plan.transforms[a + 3],
      plan.transforms[a + 4],
      plan.transforms[a + 5],
      plan.transforms[a + 6],
    );
    replayQuaternionB.set(
      plan.transforms[b + 3],
      plan.transforms[b + 4],
      plan.transforms[b + 5],
      plan.transforms[b + 6],
    );
    replayQuaternionA.slerp(replayQuaternionB, alpha);
    die.body.quaternion.set(
      replayQuaternionA.x,
      replayQuaternionA.y,
      replayQuaternionA.z,
      replayQuaternionA.w,
    );
    clampDieToVisibleArea(die);
    die.syncVisual();
  });
}\n\nfunction physicalWorldPositionAt(`,
  'unify plan coordinate transform',
);
main = replaceRegexOnce(
  main,
  /function updatePlanVisuals\(plan: RollPlan, time: number\): void \{[\s\S]*?\n}/,
  `function updatePlanVisuals(plan: RollPlan, time: number): void {
  const scale = planDisplayScale(plan);
  applyPlanTransform(plan, time, scale.x, scale.z);
  genericPhysicalVisuals.forEach((visual) => visual.update(time, scale.x, scale.z));
  const progress = plan.duration > 0 ? time / plan.duration : 1;
  fallbackVisuals.forEach((visual) => visual.update(progress, plan.duration));
}`,
  'shared plan visual playback',
);
main = main.replace(
  `    activeGenericPhysicalIndexes,\n    plan.landings,`,
  `    activeGenericPlanAssignments(),\n    plan.landings,`,
);

if (/buildRollPlanSync|cloneDynamicBody|contactSimilarity|enforceBodiesBounds/.test(main)) {
  throw new Error('duplicate main-thread planner code survived');
}
if (/PLANNER_STEP|PLANNER_RECORD_EVERY|PLANNER_RECORD_STEP/.test(main)) {
  throw new Error('duplicate planner constants survived');
}
if (main.includes('genericByPhysicalIndex')) {
  throw new Error('order-dependent generic physical lookup survived');
}
if (!main.includes('mainThreadPhysicalPlanner.simulate')) {
  throw new Error('main-thread fallback is not using PhysicalRollPlanner');
}
if (!main.includes('gravity: PHYSICS_PRESETS[activePhysicsPreset].gravity')) {
  throw new Error('physics preset gravity is not forwarded');
}
if (!main.includes('visual.update(time, scale.x, scale.z)')) {
  throw new Error('generated visuals are not using shared display scaling');
}
await write('src/main.ts', main);

let natural = await read('scripts/test-natural-target-physics.mjs');
natural = replaceOnce(
  natural,
  `assert.match(main, /plan = applyShapeSymmetryTargets\\(buildRollPlanSync\\(states\\)\\)/);`,
  `assert.match(main, /const mainThreadPhysicalPlanner = new PhysicalRollPlanner/);\nassert.match(main, /mainThreadPhysicalPlanner\\.simulate/);\nassert.doesNotMatch(main, /buildRollPlanSync|cloneDynamicBody|contactSimilarity/);`,
  'natural workerless planner assertion',
);
await write('scripts/test-natural-target-physics.mjs', natural);

let large = await read('scripts/test-large-pool-physics.mjs');
large = replaceOnce(
  large,
  `assert.match(main, /const PLANNER_STEP = 1 \\/ 120/);\nassert.match(main, /const PLANNER_RECORD_EVERY = 1/);`,
  `assert.doesNotMatch(main, /PLANNER_STEP|PLANNER_RECORD_EVERY|PLANNER_RECORD_STEP/);`,
  'large pool duplicate constants',
);
large = replaceOnce(
  large,
  `assert.match(main, /markUnobstructedTableDice/);`,
  `assert.doesNotMatch(main, /markUnobstructedTableDice/);`,
  'large pool main resting ownership',
);
large = replaceOnce(
  large,
  `assert.match(main, /lastUnstableReleaseTimes/);`,
  `assert.doesNotMatch(main, /lastUnstableReleaseTimes/);`,
  'large pool main unstable state ownership',
);
large = replaceOnce(
  large,
  `assert.match(planner, /releaseUnstableRestPose/);`,
  `assert.match(planner, /releaseUnstableRestPose/);\nassert.match(main, /mainThreadPhysicalPlanner\\.simulate/);\nassert.match(planner, /const transformBuffer = new Float32Array\\(MAX_FRAMES \\* frameStride\\)/);\nassert.doesNotMatch(planner, /activeFlags\\.slice/);`,
  'large pool planner allocation assertions',
);
await write('scripts/test-large-pool-physics.mjs', large);

let smoke = await read('scripts/test-visual-fallbacks.mjs');
smoke = replaceOnce(
  smoke,
  `/genericPhysicalVisuals\\.forEach\\(\\(visual\\) => visual\\.update\\(progress, plan\\.duration\\)\\)/,`,
  `/genericPhysicalVisuals\\.forEach\\(\\(visual\\) => visual\\.update\\(time, scale\\.x, scale\\.z\\)\\)/,`,
  'smoke playback assertion',
);
smoke = replaceOnce(
  smoke,
  `assert.match(physicalPlanner, /extractPhysicalTransforms/);`,
  `assert.doesNotMatch(physicalPlanner, /extractPhysicalTransforms/);\nassert.match(physicalPlanner, /const transformBuffer = new Float32Array/);\nassert.doesNotMatch(physicalPlanner, /activeFlags\\.slice/);`,
  'smoke planner buffer assertion',
);
smoke = replaceOnce(
  smoke,
  `assert.match(physicalVisuals, /elapsed \\+ this\\.trajectory\\.step \\* 0\\.5 >= this\\.activationDelay/);`,
  `assert.match(physicalVisuals, /this\\.lastTime \\+ this\\.trajectory\\.step \\* 0\\.5 >= this\\.activationDelay/);\nassert.match(physicalVisuals, /new Map<string, PhysicalDieVisualInstance>/);\nassert.match(physicalVisuals, /physicalIndex: number/);\nassert.doesNotMatch(physicalVisuals, /extractPhysicalTransforms|trajectoryForIndex/);`,
  'smoke direct shared trajectory assertion',
);
await write('scripts/test-visual-fallbacks.mjs', smoke);

console.log('streamlined physical runtime migration applied');
