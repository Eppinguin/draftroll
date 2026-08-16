import { readFile, writeFile } from 'node:fs/promises';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing migration anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Ambiguous migration anchor: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function removeRange(source, start, end, label) {
  const from = source.indexOf(start);
  if (from < 0) throw new Error(`Missing migration start: ${label}`);
  const to = source.indexOf(end, from + start.length);
  if (to < 0) throw new Error(`Missing migration end: ${label}`);
  return source.slice(0, from) + end + source.slice(to + end.length);
}

let visuals = await readFile(new URL('../src/physical-die-visuals.ts', import.meta.url), 'utf8');
visuals = replaceOnce(
  visuals,
  `import {\n  extractPhysicalTransforms,\n  PhysicalRollPlanner,\n  type PhysicalRollEntry,\n} from './physical-roll-planner';`,
  `import { extractPhysicalTransforms } from './physical-roll-planner';`,
  'physical visual planner imports',
);
visuals = removeRange(
  visuals,
  `interface PlannerRequest {`,
  `const MAXIMUM_EXACT_GENERATED_SIDES = 256;`,
  'legacy worker protocol types',
);
visuals = replaceOnce(
  visuals,
  `const activePhysicalDice = new Set<PhysicalDieVisualInstance>();\nconst pendingPhysicalDice = new Set<PhysicalDieVisualInstance>();\nconst bridgePending = new Map<number, BridgePending>();\nconst localPlanner = new PhysicalRollPlanner();`,
  `const activePhysicalDice = new Set<PhysicalDieVisualInstance>();\nconst pendingPhysicalDice = new Set<PhysicalDieVisualInstance>();\nlet plannedPhysicalDice: PhysicalDieVisualInstance[] = [];\nlet lastPhysicalFallbackReplay: PhysicalFallbackReplay | null = null;`,
  'physical visual planner state',
);
visuals = removeRange(
  visuals,
  `function isPlannerRequest(message: unknown): message is PlannerRequest {`,
  `function trajectoryForIndex(`,
  'worker interception helpers',
);
visuals = removeRange(
  visuals,
  `/**\n * Transitional bridge from the legacy canonical-only request shape to the generic physical worker.`,
  `export class PhysicalDieVisualInstance {`,
  'worker prototype bridge',
);
visuals = replaceOnce(
  visuals,
  `  update(progress: number, _duration = 1): void {\n    if (this.settled) return;\n    if (pendingPhysicalDice.size > 0 && bridgePending.size === 0) finalizePhysicalFallbackBatch();\n    if (!this.trajectory) return;`,
  `  update(progress: number, _duration = 1): void {\n    if (this.settled || !this.trajectory) return;`,
  'visual update planning side effect',
);
const oldTail = `/**\n * Fallback-only numeric dice have no canonical planner request to augment. They still use the\n * exact same PhysicalRollPlanner and PhysicalDieDefinition pipeline, starting existing dice from\n * their current pose/momentum and newly configured dice from their launch state.\n */\nexport function finalizePhysicalFallbackBatch(): void {\n  if (pendingPhysicalDice.size === 0 || bridgePending.size > 0) return;\n  const entries = configuredPhysicalDice();\n  if (entries.length === 0) return;\n  const bounds = entries[0].bounds;\n  const planEntries: PhysicalRollEntry[] = entries.map((entry) => ({\n    definition: entry.definition,\n    state: entry.plannerState(),\n  }));\n  const plan = localPlanner.simulate({\n    entries: planEntries,\n    boundsX: bounds.x,\n    boundsZ: bounds.z,\n  });\n  entries.forEach((entry, index) => {\n    entry.commitTrajectory(\n      trajectoryForIndex(plan.transforms, plan.frameCount, plan.step, entries.length, index),\n      plan.landings[index] ?? 0,\n    );\n  });\n}\n\ninstallPhysicalWorkerBridge();`;
const newTail = `export interface PhysicalFallbackPlanEntry {\n  definition: PhysicalDieDefinition;\n  state: number[];\n}\n\n/** Recorded arbitrary-physical-die transforms retained alongside a legacy replay. */\nexport interface PhysicalFallbackReplay {\n  ids: string[];\n  step: number;\n  frameCount: number;\n  transforms: Float32Array;\n  landings: Int32Array;\n}\n\nfunction configuredPhysicalDice(): PhysicalDieVisualInstance[] {\n  return [...activePhysicalDice].filter((entry) => entry.configured);\n}\n\n/** True when at least one arbitrary numeric die is participating in the physical table. */\nexport function hasConfiguredPhysicalFallbackDice(): boolean {\n  return configuredPhysicalDice().length > 0;\n}\n\n/** True when a newly configured arbitrary die still needs a committed physical trajectory. */\nexport function hasPendingPhysicalFallbackDice(): boolean {\n  return pendingPhysicalDice.size > 0;\n}\n\n/**\n * Captures the arbitrary physical entries that main.ts appends to the normal roll-worker request.\n * This is an explicit compatibility boundary; no Worker prototype interception is involved.\n */\nexport function getPhysicalFallbackPlanEntries(): PhysicalFallbackPlanEntry[] {\n  plannedPhysicalDice = configuredPhysicalDice();\n  return plannedPhysicalDice.map((entry) => ({\n    definition: entry.definition,\n    state: entry.plannerState(),\n  }));\n}\n\n/** Commits the additional trajectories returned by the one shared physical roll worker. */\nexport function commitPhysicalFallbackPlan(\n  transforms: Float32Array,\n  frameCount: number,\n  step: number,\n  landings: Int32Array,\n): void {\n  const entries = plannedPhysicalDice.length > 0 ? plannedPhysicalDice : configuredPhysicalDice();\n  plannedPhysicalDice = [];\n  if (entries.length === 0) {\n    lastPhysicalFallbackReplay = null;\n    return;\n  }\n  const expected = frameCount * entries.length * 7;\n  if (frameCount < 1 || transforms.length !== expected || landings.length !== entries.length) {\n    throw new Error('Physical fallback trajectory buffers do not match the planned dice.');\n  }\n  commitAdditionalTrajectories(transforms, frameCount, step, entries, landings);\n  lastPhysicalFallbackReplay = {\n    ids: entries.map((entry) => entry.spec.id),\n    step,\n    frameCount,\n    transforms: transforms.slice(),\n    landings: landings.slice(),\n  };\n}\n\nexport function capturePhysicalFallbackReplay(): PhysicalFallbackReplay | undefined {\n  const replay = lastPhysicalFallbackReplay;\n  return replay\n    ? {\n        ids: replay.ids.slice(),\n        step: replay.step,\n        frameCount: replay.frameCount,\n        transforms: replay.transforms.slice(),\n        landings: replay.landings.slice(),\n      }\n    : undefined;\n}\n\n/** Restores arbitrary physical trajectories without re-running physics during replay. */\nexport function restorePhysicalFallbackReplay(replay: PhysicalFallbackReplay): void {\n  const entries = new Map(configuredPhysicalDice().map((entry) => [entry.spec.id, entry] as const));\n  if (replay.ids.length !== replay.landings.length) {\n    throw new Error('Physical fallback replay landing data is invalid.');\n  }\n  const expected = replay.frameCount * replay.ids.length * 7;\n  if (replay.frameCount < 1 || replay.transforms.length !== expected) {\n    throw new Error('Physical fallback replay transform data is invalid.');\n  }\n  replay.ids.forEach((id, index) => {\n    const entry = entries.get(id);\n    if (!entry) throw new Error(\`Physical fallback replay die is missing: \${id}\`);\n    entry.commitTrajectory(\n      trajectoryForIndex(\n        replay.transforms,\n        replay.frameCount,\n        replay.step,\n        replay.ids.length,\n        index,\n      ),\n      replay.landings[index] ?? 0,\n    );\n  });\n  lastPhysicalFallbackReplay = {\n    ids: replay.ids.slice(),\n    step: replay.step,\n    frameCount: replay.frameCount,\n    transforms: replay.transforms.slice(),\n    landings: replay.landings.slice(),\n  };\n}`;
visuals = replaceOnce(visuals, oldTail, newTail, 'local physical planner tail');
await writeFile(new URL('../src/physical-die-visuals.ts', import.meta.url), visuals);

let main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
main = replaceOnce(
  main,
  `import { FallbackVisualInstance } from './fallback-visuals';`,
  `import { FallbackVisualInstance } from './fallback-visuals';\nimport {\n  capturePhysicalFallbackReplay,\n  commitPhysicalFallbackPlan,\n  getPhysicalFallbackPlanEntries,\n  hasConfiguredPhysicalFallbackDice,\n  hasPendingPhysicalFallbackDice,\n  restorePhysicalFallbackReplay,\n  type PhysicalFallbackReplay,\n} from './physical-die-visuals';`,
  'main physical fallback imports',
);
main = replaceOnce(
  main,
  `  fallbacks?: DraftrollFallbackVisual[];\n  visualOrder?: DraftrollVisualOrderEntry[];`,
  `  fallbacks?: DraftrollFallbackVisual[];\n  /** Recorded arbitrary physical-die trajectories owned by the shared planner. */\n  physicalFallbackReplay?: PhysicalFallbackReplay;\n  visualOrder?: DraftrollVisualOrderEntry[];`,
  'replay physical fallback field',
);
main = replaceOnce(
  main,
  `    fallbacks: replay.fallbacks?.map((fallback) => ({\n      ...fallback,\n      metadata: fallback.metadata ? { ...fallback.metadata } : undefined,\n    })),\n    visualOrder: replay.visualOrder?.map((entry) => ({ ...entry })),`,
  `    fallbacks: replay.fallbacks?.map((fallback) => ({\n      ...fallback,\n      metadata: fallback.metadata ? { ...fallback.metadata } : undefined,\n    })),\n    physicalFallbackReplay: replay.physicalFallbackReplay\n      ? {\n          ids: replay.physicalFallbackReplay.ids.slice(),\n          step: replay.physicalFallbackReplay.step,\n          frameCount: replay.physicalFallbackReplay.frameCount,\n          transforms: replay.physicalFallbackReplay.transforms.slice(),\n          landings: replay.physicalFallbackReplay.landings.slice(),\n        }\n      : undefined,\n    visualOrder: replay.visualOrder?.map((entry) => ({ ...entry })),`,
  'clone physical fallback replay',
);
main = replaceOnce(
  main,
  `  diagnostics?: RollPlanDiagnostics;\n}`,
  `  diagnostics?: RollPlanDiagnostics;\n}`,
  'roll plan stable anchor',
);
main = replaceOnce(
  main,
  `  diagnostics?: RollPlanDiagnostics;\n}\n\ninterface PendingPlan`,
  `  diagnostics?: RollPlanDiagnostics;\n  additionalTransforms?: ArrayBuffer;\n  additionalLandings?: ArrayBuffer;\n}\n\ninterface PendingPlan`,
  'worker response additional buffers',
);
main = replaceOnce(
  main,
  `    pendingPlans.delete(response.id);\n    const impactData = new Float32Array(response.impacts);`,
  `    pendingPlans.delete(response.id);\n    if (response.additionalTransforms && response.additionalLandings) {\n      commitPhysicalFallbackPlan(\n        new Float32Array(response.additionalTransforms),\n        response.frameCount,\n        response.step,\n        new Int32Array(response.additionalLandings),\n      );\n    }\n    const impactData = new Float32Array(response.impacts);`,
  'commit worker additional trajectories',
);
main = replaceOnce(
  main,
  `): Promise<RollPlan> {\n  const worker = getRollWorker();\n  if (!worker) {\n    if (preservedCount > 0) throw new Error('Additive table physics requires Web Worker support.');\n    return applyShapeSymmetryTargets(buildRollPlanSync(states));\n  }`,
  `): Promise<RollPlan> {\n  const additional = getPhysicalFallbackPlanEntries();\n  const worker = getRollWorker();\n  if (!worker) {\n    if (preservedCount > 0 || additional.length > 0) {\n      throw new Error('Shared physical dice require Web Worker support.');\n    }\n    return applyShapeSymmetryTargets(buildRollPlanSync(states));\n  }`,
  'explicit physical entries in buildRollPlan',
);
main = replaceOnce(
  main,
  `        lockedTrajectoryStep: lockedTrajectory?.step,\n        lockedTrajectoryFrameCount: lockedTrajectory?.frameCount,\n      },`,
  `        lockedTrajectoryStep: lockedTrajectory?.step,\n        lockedTrajectoryFrameCount: lockedTrajectory?.frameCount,\n        additional,\n      },`,
  'worker request additional physical entries',
);
main = replaceOnce(
  main,
  `    fallbacks: activeFallbackSpecs.map((fallback) => ({\n      ...fallback,\n      metadata: fallback.metadata ? { ...fallback.metadata } : undefined,\n    })),\n    visualOrder: activeVisualOrder.map((entry) => ({ ...entry })),`,
  `    fallbacks: activeFallbackSpecs.map((fallback) => ({\n      ...fallback,\n      metadata: fallback.metadata ? { ...fallback.metadata } : undefined,\n    })),\n    physicalFallbackReplay: capturePhysicalFallbackReplay(),\n    visualOrder: activeVisualOrder.map((entry) => ({ ...entry })),`,
  'capture arbitrary physical replay',
);
main = replaceOnce(
  main,
  `  spawnFallbackVisuals(activeFallbackSpecs, activeSeed);\n  dice.forEach((die, index) => {`,
  `  spawnFallbackVisuals(activeFallbackSpecs, activeSeed);\n  if (replay.physicalFallbackReplay) {\n    restorePhysicalFallbackReplay(replay.physicalFallbackReplay);\n  }\n  dice.forEach((die, index) => {`,
  'restore arbitrary physical replay',
);
main = replaceOnce(
  main,
  `    const plan =\n      newStates.length > 0\n        ? await buildRollPlan([...existingStates, ...newStates], existingCount, lockedTrajectory)\n        : createStaticTablePlan(createFallbackOnlyPlan(normalized.fallbacks).duration);`,
  `    const needsSharedPhysicalPlan = newStates.length > 0 || hasPendingPhysicalFallbackDice();\n    const plan = needsSharedPhysicalPlan\n      ? await buildRollPlan([...existingStates, ...newStates], existingCount, lockedTrajectory)\n      : createStaticTablePlan(createFallbackOnlyPlan(normalized.fallbacks).duration);`,
  'additive physical-only planning',
);
main = replaceOnce(
  main,
  `  applyRuntimeQuality(totalVisuals);\n  let plan: RollPlan;\n  if (quantity === 0) {\n    activeOutcomes = [];\n    plan = createFallbackOnlyPlan(activeFallbackSpecs);\n  } else {\n    const states = createLaunchStates(swipe, activeSeed);`,
  `  applyRuntimeQuality(totalVisuals);\n  let plan: RollPlan;\n  const hasArbitraryPhysicalDice = hasConfiguredPhysicalFallbackDice();\n  if (quantity === 0 && !hasArbitraryPhysicalDice) {\n    activeOutcomes = [];\n    plan = createFallbackOnlyPlan(activeFallbackSpecs);\n  } else {\n    const states = quantity > 0 ? createLaunchStates(swipe, activeSeed) : [];`,
  'initial physical-only worker plan',
);
main = replaceOnce(
  main,
  `    } catch (error) {\n      assertPresentationGeneration(generation);\n      console.error('Roll planner failed; using local fallback.', error);\n      try {\n        plan = applyShapeSymmetryTargets(buildRollPlanSync(states));\n      } catch (fallbackError) {\n        // Planning is intentionally invisible. Restore the current meshes if\n        // neither planner can produce a committed trajectory so a failed roll\n        // cannot leave the overlay in a permanently hidden state.\n        setPhysicalDiceVisible(true);\n        throw fallbackError;\n      }`,
  `    } catch (error) {\n      assertPresentationGeneration(generation);\n      if (hasArbitraryPhysicalDice) {\n        setPhysicalDiceVisible(true);\n        throw error;\n      }\n      console.error('Roll planner failed; using local canonical fallback.', error);\n      try {\n        plan = applyShapeSymmetryTargets(buildRollPlanSync(states));\n      } catch (fallbackError) {\n        // Planning is intentionally invisible. Restore the current meshes if\n        // neither planner can produce a committed trajectory so a failed roll\n        // cannot leave the overlay in a permanently hidden state.\n        setPhysicalDiceVisible(true);\n        throw fallbackError;\n      }`,
  'avoid partial local physics fallback',
);
await writeFile(new URL('../src/main.ts', import.meta.url), main);

let smoke = await readFile(new URL('./test-visual-fallbacks.mjs', import.meta.url), 'utf8');
smoke = replaceOnce(
  smoke,
  `assert.match(physicalVisuals, /localPlanner\\.simulate/);\nassert.match(physicalVisuals, /installPhysicalWorkerBridge/);\nassert.match(physicalVisuals, /additional:\\s*entries\\.map/);\nassert.match(physicalVisuals, /owner\\.addEventListener\\('message'/);\nassert.match(physicalVisuals, /nativePostMessage\\.call\\(\\s*owner/);\nassert.match(physicalVisuals, /activePhysicalDice/);\nassert.match(physicalVisuals, /pendingPhysicalDice/);\nassert.doesNotMatch(physicalVisuals, /new Worker\\(/);\nassert.doesNotMatch(physicalVisuals, /new CANNON\\.World/);`,
  `assert.match(physicalVisuals, /getPhysicalFallbackPlanEntries/);\nassert.match(physicalVisuals, /commitPhysicalFallbackPlan/);\nassert.match(physicalVisuals, /capturePhysicalFallbackReplay/);\nassert.match(physicalVisuals, /restorePhysicalFallbackReplay/);\nassert.match(physicalVisuals, /activePhysicalDice/);\nassert.match(physicalVisuals, /pendingPhysicalDice/);\nassert.doesNotMatch(physicalVisuals, /Worker\\.prototype/);\nassert.doesNotMatch(physicalVisuals, /PhysicalRollPlanner/);\nassert.doesNotMatch(physicalVisuals, /localPlanner/);\nassert.doesNotMatch(physicalVisuals, /new Worker\\(/);\nassert.doesNotMatch(physicalVisuals, /new CANNON\\.World/);\nassert.match(engine, /getPhysicalFallbackPlanEntries/);\nassert.match(engine, /commitPhysicalFallbackPlan/);\nassert.match(engine, /additional,/);\nassert.match(engine, /hasPendingPhysicalFallbackDice/);\nassert.match(engine, /physicalFallbackReplay/);`,
  'smoke architecture assertions',
);
smoke = replaceOnce(
  smoke,
  `  unifiedRollWorkerProtocol: true,\n  onePhysicalWorker: true,`,
  `  unifiedRollWorkerProtocol: true,\n  explicitPhysicalWorkerIntegration: true,\n  deterministicArbitraryPhysicalReplay: true,\n  onePhysicalWorker: true,`,
  'smoke output flags',
);
await writeFile(new URL('./test-visual-fallbacks.mjs', import.meta.url), smoke);

console.log('Physical main migration applied.');
