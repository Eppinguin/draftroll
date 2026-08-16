from pathlib import Path
import re


def replace_once(path: str, before: str, after: str, label: str) -> None:
    target = Path(path)
    source = target.read_text()
    count = source.count(before)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    target.write_text(source.replace(before, after, 1))


def remove_once(path: str, text: str, label: str) -> None:
    replace_once(path, text, '', label)


def regex_replace_once(path: str, pattern: str, replacement: str, label: str, flags: int = 0) -> None:
    target = Path(path)
    source = target.read_text()
    updated, count = re.subn(pattern, replacement, source, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    target.write_text(updated)


# --- One worker protocol: every physical die is one PhysicalRollEntry. ---
Path('src/roll-worker.ts').write_text(r'''import type { PhysicalDieDefinition } from './physical-dice';
import {
  PhysicalRollPlanner,
  type LockedPhysicalMotion,
  type PhysicalRollEntry,
} from './physical-roll-planner';

interface PlanEntry {
  definition: PhysicalDieDefinition;
  state: number[];
  physics?: PhysicalRollEntry['physics'];
  captureImpacts?: boolean;
}

interface PlanRequest {
  id: number;
  entries: PlanEntry[];
  boundsX: number;
  boundsZ: number;
  lockedCount?: number;
  lockedTrajectory?: ArrayBuffer;
  lockedTrajectoryStep?: number;
  lockedTrajectoryFrameCount?: number;
}

const planner = new PhysicalRollPlanner();

function readLockedMotion(request: PlanRequest, lockedCount: number): LockedPhysicalMotion | undefined {
  if (!request.lockedTrajectory || lockedCount <= 0) return undefined;
  const step = Number(request.lockedTrajectoryStep);
  const frameCount = Math.max(0, Math.floor(request.lockedTrajectoryFrameCount ?? 0));
  if (!Number.isFinite(step) || step <= 0 || frameCount < 2) return undefined;
  const transforms = new Float32Array(request.lockedTrajectory);
  if (transforms.length !== frameCount * lockedCount * 7) return undefined;
  return { count: lockedCount, step, frameCount, transforms };
}

self.addEventListener('message', (event: MessageEvent<PlanRequest>) => {
  const request = event.data;
  const entries: PhysicalRollEntry[] = request.entries.map((entry) => ({
    definition: entry.definition,
    state: entry.state,
    physics: entry.physics,
    captureImpacts: entry.captureImpacts !== false,
  }));
  const lockedCount = Math.max(0, Math.min(entries.length, request.lockedCount ?? 0));
  const result = planner.simulate({
    entries,
    boundsX: request.boundsX,
    boundsZ: request.boundsZ,
    lockedCount,
    lockedMotion: readLockedMotion(request, lockedCount),
  });
  const transforms = result.transforms;
  const impacts = result.impacts;
  const landings = result.landings;
  self.postMessage(
    {
      id: request.id,
      step: result.step,
      frameCount: result.frameCount,
      dieCount: entries.length,
      transforms: transforms.buffer,
      impacts: impacts.buffer,
      landings: landings.buffer,
      duration: result.duration,
      settleReason: result.settleReason,
      physicsSteps: result.physicsSteps,
      diagnostics: {
        planningMs: result.planningMs,
        naturalTrajectory: true,
        naturalMatches: entries.length,
        targetSuccess: true,
        lockedKinematicDice: lockedCount,
      },
    },
    { transfer: [transforms.buffer, impacts.buffer, landings.buffer] },
  );
});
''')

# --- Generic visual implementation consumes slices of the one physical plan. ---
visual_path = Path('src/physical-die-visuals.ts')
visuals = visual_path.read_text()
visuals = visuals.replace(
    "let plannedPhysicalDice: PhysicalDieVisualInstance[] = [];\nlet lastAdditionalPhysicalReplay: AdditionalPhysicalReplay | null = null;\n",
    '',
)
visuals, count = re.subn(
    r"function commitAdditionalTrajectories\([\s\S]*?\n\}\n\nfunction serializeLaunchState",
    'function serializeLaunchState',
    visuals,
    count=1,
)
if count != 1:
    raise SystemExit(f'visual trajectory helper: expected one match, found {count}')
marker = 'export interface AdditionalPhysicalPlanEntry {'
pos = visuals.find(marker)
if pos < 0:
    raise SystemExit('physical visual tail marker missing')
visuals = visuals[:pos] + r'''export interface PhysicalVisualPlanEntry {
  id: string;
  definition: PhysicalDieDefinition;
  state: number[];
}

function configuredPhysicalDice(): PhysicalDieVisualInstance[] {
  return [...activePhysicalDice].filter((entry) => entry.configured);
}

export function getPendingPhysicalLaunchParticipants(): PendingPhysicalLaunchParticipant[] {
  return [...pendingPhysicalDice]
    .filter((entry) => entry.configured)
    .map((entry) => entry.launchParticipant);
}

export function assignPendingPhysicalLaunchStates(
  assignments: readonly PendingPhysicalLaunchAssignment[],
): void {
  const states = new Map(
    assignments.map((assignment) => [assignment.id, assignment.state] as const),
  );
  for (const entry of pendingPhysicalDice) {
    const state = states.get(entry.spec.id);
    if (state) entry.assignLaunchState(state);
  }
}

export function hasConfiguredPhysicalVisuals(): boolean {
  return configuredPhysicalDice().length > 0;
}

export function hasPendingPhysicalVisuals(): boolean {
  return pendingPhysicalDice.size > 0;
}

export function getPhysicalVisualPlanEntries(): PhysicalVisualPlanEntry[] {
  return configuredPhysicalDice().map((entry) => ({
    id: entry.spec.id,
    definition: entry.definition,
    state: entry.plannerState(),
  }));
}

export function commitPhysicalVisualPlan(
  transforms: Float32Array,
  frameCount: number,
  step: number,
  physicalCount: number,
  physicalIndexes: readonly number[],
  landings: Int32Array,
): void {
  const entries = configuredPhysicalDice();
  if (entries.length !== physicalIndexes.length) {
    throw new Error('Physical visual indexes do not match the configured generic dice.');
  }
  if (
    frameCount < 1 ||
    transforms.length !== frameCount * physicalCount * 7 ||
    landings.length !== physicalCount
  ) {
    throw new Error('Physical trajectory buffers do not match the unified plan.');
  }
  entries.forEach((entry, index) => {
    const physicalIndex = physicalIndexes[index];
    if (physicalIndex === undefined || physicalIndex < 0 || physicalIndex >= physicalCount) {
      throw new Error(`Physical visual index is invalid: ${String(physicalIndex)}`);
    }
    entry.commitTrajectory(
      trajectoryForIndex(transforms, frameCount, step, physicalCount, physicalIndex),
      landings[physicalIndex] ?? 0,
    );
  });
}
'''
visual_path.write_text(visuals)

# Planner terminology is now fully generic.
planner_path = Path('src/physical-roll-planner.ts')
planner = planner_path.read_text().replace(
    '/** Standard renderer dice request impact events; additional physical visuals do not. */',
    '/** Whether contacts for this physical entry should emit impact events. */',
)
planner_path.write_text(planner)

# --- Browser engine migration. ---
main_path = Path('src/main.ts')
main = main_path.read_text()
old_import = '''import {
  PhysicalDieVisualInstance,
  assignPendingPhysicalLaunchStates,
  captureAdditionalPhysicalReplay,
  commitAdditionalPhysicalPlan,
  getAdditionalPhysicalPlanEntries,
  getPendingPhysicalLaunchParticipants,
  hasConfiguredAdditionalPhysicalDice,
  hasPendingAdditionalPhysicalDice,
  restoreAdditionalPhysicalReplay,
  type AdditionalPhysicalReplay,
} from './physical-die-visuals';'''
new_import = '''import {
  PhysicalDieVisualInstance,
  assignPendingPhysicalLaunchStates,
  commitPhysicalVisualPlan,
  getPhysicalVisualPlanEntries,
  getPendingPhysicalLaunchParticipants,
  hasConfiguredPhysicalVisuals,
  hasPendingPhysicalVisuals,
} from './physical-die-visuals';
import {
  createCanonicalPhysicalDieDefinition,
  type PhysicalDieDefinition,
} from './physical-dices';'''
if main.count(old_import) != 1:
    raise SystemExit(f'main physical visual import: expected one match, found {main.count(old_import)}')
main = main.replace(old_import, new_import, 1)

main = main.replace('additionalPhysicalVisuals', 'genericPhysicalVisuals')
main = main.replace('activeAdditionalPhysicalIndexes', 'activeGenericPhysicalIndexes')
main = main.replace('currentAdditionalPhysicalSpecs', 'currentGenericPhysicalSpecs')
main = main.replace('spawnAdditionalPhysicalVisuals', 'spawnGenericPhysicalVisuals')
main = main.replace('appendAdditionalPhysicalVisuals', 'appendGenericPhysicalVisuals')
main = main.replace('removeAppendedAdditionalPhysicalVisuals', 'removeAppendedGenericPhysicalVisuals')
main = main.replace('AdditionalLaunchParticipant', 'GenericLaunchParticipant')
main = main.replace('additionalPhysicalIndexes', 'genericPhysicalIndexes')
main = main.replace('additionalPhysical', 'genericPhysical')
main = main.replace('additionalIndexes', 'genericIndexes')
main = main.replace('hasConfiguredAdditionalPhysicalDice', 'hasConfiguredPhysicalVisuals')
main = main.replace('hasPendingAdditionalPhysicalDice', 'hasPendingPhysicalVisuals')
main = main.replace('getAdditionalPhysicalPlanEntries', 'getPhysicalVisualPlanEntries')
main = main.replace('commitAdditionalPhysicalPlan', 'commitPhysicalVisualPlan')

main = main.replace(
    '  /** First die kind for backwards compatibility. */\n  dieKind: DieKind;\n',
    '',
)
main = main.replace(
    '        dieKind: activeKinds[0] ?? selectedKind,\n',
    '',
)

old_snapshot = '''export interface DiceTargetingSnapshot {
  method: 'shape-symmetry';
  planningMs: number;
  retargetedDiceCount: number;
  preservedTrajectoryDiceCount: number;
  naturalMatches: number;
  minimumFinalAlignment: number;
  targetSuccess: boolean;
  naturalTrajectory: boolean;
  /** @deprecated Shape-symmetry targeting uses exactly one physical plan. */
  candidateAttempts: number;
  /** @deprecated Use planningMs. */
  candidateSearchMs: number;
  /** @deprecated No assistance stage is executed. */
  assistedDiceCount: number;
  /** @deprecated No assistance stage is executed. */
  maximumAssistAngleRadians: number;
  /** @deprecated No continuity quaternion blend is applied. */
  continuityBlendedDiceCount: number;
}'''
new_snapshot = '''export interface DiceTargetingSnapshot {
  method: 'shape-symmetry';
  planningMs: number;
  retargetedDiceCount: number;
  preservedTrajectoryDiceCount: number;
  naturalMatches: number;
  minimumFinalAlignment: number;
  targetSuccess: boolean;
  naturalTrajectory: boolean;
}'''
if main.count(old_snapshot) != 1:
    raise SystemExit(f'targeting snapshot: expected one match, found {main.count(old_snapshot)}')
main = main.replace(old_snapshot, new_snapshot, 1)

old_diag = '''interface RollPlanDiagnostics {
  targetingMethod?: 'shape-symmetry';
  candidateAttempts?: number;
  candidateSearchMs?: number;
  naturalTrajectory?: boolean;
  naturalMatches?: number;
  assistedDice?: number[];
  maximumAssistAngle?: number;
  finalTargetDots?: number[];
  targetSuccess?: boolean;
  retargetedDice?: number[];
  continuityBlendedDice?: number[];
  lockedKinematicDice?: number;
}'''
new_diag = '''interface RollPlanDiagnostics {
  targetingMethod?: 'shape-symmetry';
  planningMs?: number;
  naturalTrajectory?: boolean;
  naturalMatches?: number;
  finalTargetDots?: number[];
  targetSuccess?: boolean;
  retargetedDice?: number[];
  lockedKinematicDice?: number;
}'''
if main.count(old_diag) != 1:
    raise SystemExit(f'roll diagnostics: expected one match, found {main.count(old_diag)}')
main = main.replace(old_diag, new_diag, 1)

main = main.replace(
    '  transforms: Float32Array;\n  activationDelays?: Float32Array;',
    '  transforms: Float32Array;\n  landings: Int32Array;\n  activationDelays?: Float32Array;',
    1,
)
main = main.replace(
    '  transforms: Float32Array;\n  activationDelays?: Float32Array;',
    '  transforms: Float32Array;\n  landings: Int32Array;\n  activationDelays?: Float32Array;',
    1,
)
main = main.replace('  genericPhysicalReplay?: AdditionalPhysicalReplay;\n', '')

# Remove stateful browser roll setters from the declared browser API.
for line in [
    '      setResults: (results: number[] | number) => void;\n',
    '      clearResults: () => void;\n',
    '      setDie: (kind: DieKind) => void;\n',
    '      setQuantity: (count: number) => void;\n',
    '      setTheme: (theme: ThemeName) => void;\n',
]:
    main = main.replace(line, '')

# Clone the one replay stream.
main, count = re.subn(
    r"    transforms: replay\.transforms\.slice\(\),\n    activationDelays:[\s\S]*?    genericPhysicalReplay: replay\.genericPhysicalReplay[\s\S]*?      : undefined,\n",
    "    transforms: replay.transforms.slice(),\n    landings: replay.landings.slice(),\n    activationDelays: replay.activationDelays?.slice(),\n    settleTimes: replay.settleTimes?.slice(),\n    impacts: replay.impacts.slice(),\n    fallbacks: replay.fallbacks?.map(cloneFallbackVisual),\n",
    main,
    count=1,
)
if count != 1:
    raise SystemExit(f'clone replay stream: expected one match, found {count}')

# Worker response + generic entry builder. Replace the old split response handler and packed state buffer.
worker_block = r'''interface WorkerPhysicalPlanEntry {
  definition: PhysicalDieDefinition;
  state: number[];
  physics?: {
    mass?: number;
    sizeScale?: number;
    inertiaScale?: number;
    linearDamping?: number;
    angularDamping?: number;
  };
  captureImpacts?: boolean;
}

interface WorkerPlanResponse {
  id: number;
  step: number;
  frameCount: number;
  dieCount: number;
  transforms: ArrayBuffer;
  impacts: ArrayBuffer;
  landings: ArrayBuffer;
  duration: number;
  settleReason: string;
  physicsSteps: number;
  diagnostics?: RollPlanDiagnostics;
}

interface PendingPlan {
  resolve: (plan: Omit<RollPlan, 'results'>) => void;
  reject: (error: Error) => void;
}

let rollWorker: Worker | null = null;
let rollWorkerReleaseTimer: number | null = null;
const pendingPlans = new Map<number, PendingPlan>();
let nextPlanId = 1;

function releaseRollWorker(): void {
  if (pendingPlans.size > 0) return;
  rollWorker?.terminate();
  rollWorker = null;
  if (rollWorkerReleaseTimer !== null) window.clearTimeout(rollWorkerReleaseTimer);
  rollWorkerReleaseTimer = null;
}

function cancelPendingRollPlans(error: Error): void {
  for (const pending of pendingPlans.values()) pending.reject(error);
  pendingPlans.clear();
  releaseRollWorker();
}

function scheduleRollWorkerRelease(): void {
  if (rollWorkerReleaseTimer !== null) window.clearTimeout(rollWorkerReleaseTimer);
  rollWorkerReleaseTimer = window.setTimeout(releaseRollWorker, 45_000);
}

function getRollWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (rollWorker) return rollWorker;
  const worker = new Worker(new URL('./roll-worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event: MessageEvent<WorkerPlanResponse>) => {
    const response = event.data;
    const pending = pendingPlans.get(response.id);
    if (!pending) return;
    pendingPlans.delete(response.id);
    const impactData = new Float32Array(response.impacts);
    const impacts: RollImpact[] = Array.from(
      { length: Math.floor(impactData.length / 3) },
      (_, index) => {
        const offset = index * 3;
        return {
          time: impactData[offset],
          dieIndex: Math.round(impactData[offset + 1]),
          strength: impactData[offset + 2],
        };
      },
    );
    pending.resolve({
      step: response.step,
      frameCount: response.frameCount,
      dieCount: response.dieCount,
      transforms: new Float32Array(response.transforms),
      landings: new Int32Array(response.landings),
      impacts,
      duration: response.duration,
      settleReason: response.settleReason,
      physicsSteps: response.physicsSteps,
      diagnostics: response.diagnostics,
    });
    if (pendingPlans.size === 0) scheduleRollWorkerRelease();
  });
  worker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'Roll worker failed.');
    for (const pending of pendingPlans.values()) pending.reject(error);
    pendingPlans.clear();
    releaseRollWorker();
  });
  rollWorker = worker;
  return worker;
}

function serializePlannerState(state: LaunchState): number[] {
  return [
    state.position.x,
    state.position.y,
    state.position.z,
    state.quaternion.x,
    state.quaternion.y,
    state.quaternion.z,
    state.quaternion.w,
    state.velocity.x,
    state.velocity.y,
    state.velocity.z,
    state.angularVelocity.x,
    state.angularVelocity.y,
    state.angularVelocity.z,
    state.delay,
  ];
}

function genericPlannerPhysics(
  spec: DraftrollPhysicalVisual,
): WorkerPhysicalPlanEntry['physics'] {
  const preset = PHYSICS_PRESETS[activePhysicsPreset];
  const theme =
    getRuntimeThemePhysics(spec.theme, spec.type) ??
    getRuntimeThemePhysics(spec.theme, `d${spec.sides}`) ??
    {};
  const override = spec.physics ?? {};
  const sizeScale = THREE.MathUtils.clamp(
    (override.sizeScale ?? theme.sizeScale ?? 1) * preset.sizeScale,
    0.5,
    2,
  );
  const massScale = THREE.MathUtils.clamp(
    (override.massScale ?? theme.massScale ?? 1) * preset.massScale,
    0.25,
    4,
  );
  const inertiaScale = THREE.MathUtils.clamp(
    (override.inertiaScale ?? theme.inertiaScale ?? 1) * preset.inertiaScale,
    0.25,
    4,
  );
  return {
    mass: (spec.sides === 2 ? 0.42 : 1.12) * massScale,
    sizeScale,
    inertiaScale,
    linearDamping: preset.linearDamping,
    angularDamping: preset.angularDamping,
  };
}

function createWorkerPhysicalEntries(states: readonly LaunchState[]): WorkerPhysicalPlanEntry[] {
  const genericEntries = getPhysicalVisualPlanEntries();
  if (genericEntries.length !== activeGenericPhysicalIndexes.length) {
    throw new Error('Generic physical visuals do not match the active physical descriptors.');
  }
  const genericByPhysicalIndex = new Map(
    activeGenericPhysicalIndexes.map((physicalIndex, index) => [physicalIndex, genericEntries[index]]),
  );
  return activePhysicalSpecs.map((spec, physicalIndex) => {
    const canonicalIndex = activeCanonicalPhysicalIndexes.indexOf(physicalIndex);
    if (canonicalIndex >= 0) {
      const state = states[canonicalIndex];
      const kind = activeKinds[canonicalIndex];
      if (!state || !kind) throw new Error(`Canonical physical state is missing at ${physicalIndex}.`);
      const properties = activePhysics[canonicalIndex] ?? {};
      const preset = PHYSICS_PRESETS[activePhysicsPreset];
      return {
        definition: createCanonicalPhysicalDieDefinition(kind),
        state: serializePlannerState(state),
        physics: {
          mass: baseDieMass(kind) * (properties.massScale ?? 1),
          sizeScale: properties.sizeScale,
          inertiaScale: properties.inertiaScale,
          linearDamping: preset.linearDamping,
          angularDamping: preset.angularDamping,
        },
        captureImpacts: true,
      };
    }
    const generic = genericByPhysicalIndex.get(physicalIndex);
    if (!generic) throw new Error(`Generic physical state is missing at ${physicalIndex}.`);
    return {
      definition: generic.definition,
      state: generic.state.slice(),
      physics: genericPlannerPhysics(spec),
      captureImpacts: true,
    };
  });
}
'''
main, count = re.subn(
    r"interface WorkerPlanResponse \{[\s\S]*?function packLaunchStates\(states: LaunchState\[\]\): Float32Array \{[\s\S]*?\n\}\n\n",
    worker_block + '\n',
    main,
    count=1,
)
if count != 1:
    raise SystemExit(f'main worker protocol block: expected one match, found {count}')

# Canonical symmetry operates on canonical indexes inside the one physical transform stream.
targeting_block = r'''function readLandingValue(
  plan: RollPlan,
  transforms: Float32Array,
  canonicalIndex: number,
): number {
  const physicalIndex = activeCanonicalPhysicalIndexes[canonicalIndex] ?? canonicalIndex;
  const stride = plan.dieCount * 7;
  const offset = (plan.frameCount - 1) * stride + physicalIndex * 7;
  const die = dice[canonicalIndex];
  die.resetNumbering();
  const landingIndex = die.getTopFaceIndex({
    x: transforms[offset + 3],
    y: transforms[offset + 4],
    z: transforms[offset + 5],
    w: transforms[offset + 6],
  });
  return die.getValueForFaceIndex(landingIndex);
}

function applyShapeSymmetryTargets(plan: RollPlan, preservedPhysicalCount = 0): RollPlan {
  const transforms = plan.transforms.slice();
  const landings = plan.landings.slice();
  const frameStride = plan.dieCount * 7;
  const retargetedDice: number[] = [];
  const naturallyMatched = new Set<number>();
  const finalTargetDots: number[] = [];
  const baseQuaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  for (let canonicalIndex = 0; canonicalIndex < dice.length; canonicalIndex += 1) {
    const physicalIndex = activeCanonicalPhysicalIndexes[canonicalIndex] ?? canonicalIndex;
    if (physicalIndex < preservedPhysicalCount) continue;
    const target = activeTargets[canonicalIndex];
    const rawLandingValue = readLandingValue(plan, transforms, canonicalIndex);
    if (target === null || target === undefined || rawLandingValue === target) {
      if (target !== null && target !== undefined) naturallyMatched.add(physicalIndex);
      continue;
    }

    const symmetry = dice[canonicalIndex].getResultSymmetryRotation(target, rawLandingValue);
    retargetedDice.push(physicalIndex);
    for (let frame = 0; frame < plan.frameCount; frame += 1) {
      const offset = frame * frameStride + physicalIndex * 7;
      baseQuaternion
        .set(
          transforms[offset + 3],
          transforms[offset + 4],
          transforms[offset + 5],
          transforms[offset + 6],
        )
        .multiply(symmetry)
        .normalize();
      transforms[offset + 3] = baseQuaternion.x;
      transforms[offset + 4] = baseQuaternion.y;
      transforms[offset + 5] = baseQuaternion.z;
      transforms[offset + 6] = baseQuaternion.w;
    }
  }

  const results = dice.map((_die, canonicalIndex) =>
    readLandingValue(plan, transforms, canonicalIndex),
  );
  const failures: number[] = [];
  for (let canonicalIndex = 0; canonicalIndex < dice.length; canonicalIndex += 1) {
    const physicalIndex = activeCanonicalPhysicalIndexes[canonicalIndex] ?? canonicalIndex;
    landings[physicalIndex] = Math.max(0, (results[canonicalIndex] ?? 1) - 1);
    if (physicalIndex < preservedPhysicalCount) continue;
    const target = activeTargets[canonicalIndex];
    if (target !== null && target !== undefined && results[canonicalIndex] !== target) {
      failures.push(physicalIndex);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Shape-symmetry targeting failed for physical indexes ${failures.join(', ')}.`,
    );
  }

  for (let canonicalIndex = 0; canonicalIndex < dice.length; canonicalIndex += 1) {
    const physicalIndex = activeCanonicalPhysicalIndexes[canonicalIndex] ?? canonicalIndex;
    const target = activeTargets[canonicalIndex];
    if (physicalIndex < preservedPhysicalCount || target === null || target === undefined) {
      finalTargetDots.push(1);
      continue;
    }
    const offset = (plan.frameCount - 1) * frameStride + physicalIndex * 7;
    const finalQuaternion = new THREE.Quaternion(
      transforms[offset + 3],
      transforms[offset + 4],
      transforms[offset + 5],
      transforms[offset + 6],
    );
    finalTargetDots.push(
      dice[canonicalIndex].getTargetNormal(target).applyQuaternion(finalQuaternion).normalize().dot(up),
    );
  }

  const completedPlan: RollPlan = {
    ...plan,
    transforms,
    landings,
    results,
    settleReason:
      retargetedDice.length > 0 ? `${plan.settleReason}+shape-symmetry` : plan.settleReason,
    diagnostics: {
      ...plan.diagnostics,
      targetingMethod: 'shape-symmetry',
      naturalTrajectory: true,
      naturalMatches: naturallyMatched.size,
      finalTargetDots,
      targetSuccess: failures.length === 0,
      retargetedDice,
    },
  };
  completedPlan.settleTimes = deriveDieSettleTimes(completedPlan);
  return completedPlan;
}

async function buildRollPlan(
  states: LaunchState[],
  preservedPhysicalCount = 0,
  lockedTrajectory?: LockedTableTrajectory,
): Promise<RollPlan> {
  const worker = getRollWorker();
  if (!worker) {
    if (preservedPhysicalCount > 0 || hasConfiguredPhysicalVisuals()) {
      throw new Error('Shared physical dice require Web Worker support.');
    }
    return applyShapeSymmetryTargets(buildRollPlanSync(states));
  }
  const entries = createWorkerPhysicalEntries(states);
  const lockedCount = lockedTrajectory ? preservedPhysicalCount : 0;
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
      },
      transfer,
    );
  });
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
    activeGenericPhysicalIndexes,
    completed.landings,
  );
  return completed;
}

'''
main, count = re.subn(
    r"function readLandingValue\([\s\S]*?\n\}\n\nfunction applyPlanTransform",
    targeting_block + 'function applyPlanTransform',
    main,
    count=1,
)
if count != 1:
    raise SystemExit(f'targeting/build block: expected one match, found {count}')

# Standard meshes sample their physical indexes from the unified plan.
apply_plan = r'''function applyPlanTransform(plan: RollPlan, time: number): void {
  const framePosition = THREE.MathUtils.clamp(time / plan.step, 0, plan.frameCount - 1);
  const firstIndex = Math.floor(framePosition);
  const secondIndex = Math.min(firstIndex + 1, plan.frameCount - 1);
  const alpha = framePosition - firstIndex;
  const frameStride = plan.dieCount * 7;
  const firstFrameOffset = firstIndex * frameStride;
  const secondFrameOffset = secondIndex * frameStride;

  const scaleX = plan.sourceBounds
    ? Math.min(1, (screenBounds.x - 0.15) / Math.max(0.01, plan.sourceBounds.x))
    : 1;
  const scaleZ = plan.sourceBounds
    ? Math.min(1, (screenBounds.z - 0.15) / Math.max(0.01, plan.sourceBounds.z))
    : 1;
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
}
'''
main, count = re.subn(
    r"function applyPlanTransform\(plan: RollPlan, time: number\): void \{[\s\S]*?\n\}\n\nfunction playImpacts",
    apply_plan + '\nfunction playImpacts',
    main,
    count=1,
)
if count != 1:
    raise SystemExit(f'apply plan transform: expected one match, found {count}')

# Impacts are keyed by physical index, not canonical array position.
play_impacts = r'''function physicalWorldPositionAt(
  physicalIndex: number,
  target = new THREE.Vector3(),
): THREE.Vector3 | null {
  const canonicalIndex = activeCanonicalPhysicalIndexes.indexOf(physicalIndex);
  if (canonicalIndex >= 0) return dice[canonicalIndex]?.getWorldPosition(target) ?? null;
  const genericIndex = activeGenericPhysicalIndexes.indexOf(physicalIndex);
  return genericPhysicalVisuals[genericIndex]?.getWorldPosition(target) ?? null;
}

function playImpacts(plan: RollPlan, previousTime: number, currentTime: number): void {
  while (nextImpactIndex < plan.impacts.length) {
    const impact = plan.impacts[nextImpactIndex];
    if (impact.time > currentTime) break;
    if (impact.time >= previousTime) {
      const impactTheme = activePhysicalSpecs[impact.dieIndex]?.theme ?? selectedTheme;
      const position = physicalWorldPositionAt(impact.dieIndex);
      audio.playImpact(impact.strength, THEME_MANIFESTS[impactTheme].surfaceAudio, impactTheme);
      if (position && collisionSparkBudget > 0 && impact.strength > 3.4) {
        collisionSparkBudget -= 1;
        effects.impact(position, THEMES[impactTheme].particle, impact.strength);
      }
    }
    nextImpactIndex += 1;
  }
}
'''
main, count = re.subn(
    r"function playImpacts\(plan: RollPlan, previousTime: number, currentTime: number\): void \{[\s\S]*?\n\}\n\nfunction packImpacts",
    play_impacts + '\nfunction packImpacts',
    main,
    count=1,
)
if count != 1:
    raise SystemExit(f'play impacts: expected one match, found {count}')

# Sync planner fallback with the new landings field.
main = main.replace(
    '    transforms,\n    activationDelays: Float32Array.from(states, (state) => state.delay),',
    '    transforms,\n    landings: Int32Array.from(results, (value) => Math.max(0, value - 1)),\n    activationDelays: Float32Array.from(states, (state) => state.delay),',
    1,
)
main = main.replace(
    '    transforms: new Float32Array(0),\n    impacts: [],',
    '    transforms: new Float32Array(0),\n    landings: new Int32Array(0),\n    impacts: [],',
    1,
)

# Replay snapshot has no deprecated diagnostics and stores the unified landing stream.
main = main.replace('        planningMs: diagnostics.candidateSearchMs ?? 0,', '        planningMs: diagnostics.planningMs ?? 0,')
for fragment in [
    '        candidateAttempts: diagnostics.candidateAttempts ?? 0,\n',
    '        candidateSearchMs: diagnostics.candidateSearchMs ?? 0,\n',
    '        assistedDiceCount: diagnostics.assistedDice?.length ?? 0,\n',
    '        maximumAssistAngleRadians: diagnostics.maximumAssistAngle ?? 0,\n',
    '        continuityBlendedDiceCount: diagnostics.continuityBlendedDice?.length ?? 0,\n',
]:
    main = main.replace(fragment, '')
main = main.replace(
    '    transforms: plan.transforms,\n    activationDelays:',
    '    transforms: plan.transforms,\n    landings: plan.landings.slice(),\n    activationDelays:',
    1,
)
main = main.replace('    genericPhysicalReplay: captureAdditionalPhysicalReplay(),\n', '')
main = main.replace(
    '    effectTimeline: createEffectTimeline(plan, activeOutcomes),',
    '    effectTimeline: createEffectTimeline(\n      plan,\n      activePhysicalSpecs.map((_spec, index) => physicalOutcomeAt(index)),\n    ),',
    1,
)

# Replay canonical verification uses canonical -> physical mapping.
replay_numbering = r'''function applyReplayNumbering(plan: RollPlan): void {
  dice.forEach((die) => die.resetNumbering());
  const stride = plan.dieCount * 7;
  const finalOffset = (plan.frameCount - 1) * stride;
  const matches = dice.every((die, canonicalIndex) => {
    const physicalIndex = activeCanonicalPhysicalIndexes[canonicalIndex] ?? canonicalIndex;
    const offset = finalOffset + physicalIndex * 7;
    const landingIndex = die.getTopFaceIndex({
      x: plan.transforms[offset + 3],
      y: plan.transforms[offset + 4],
      z: plan.transforms[offset + 5],
      w: plan.transforms[offset + 6],
    });
    return die.getValueForFaceIndex(landingIndex) === plan.results[canonicalIndex];
  });
  if (!matches) throw new Error('Replay trajectory does not physically match its recorded results.');
}
'''
main, count = re.subn(
    r"function applyReplayNumbering\(plan: RollPlan\): void \{[\s\S]*?\n\}\n\nfunction playRecordedReplay",
    replay_numbering + '\nfunction playRecordedReplay',
    main,
    count=1,
)
if count != 1:
    raise SystemExit(f'replay numbering: expected one match, found {count}')

# Replay validation/restore comes exclusively from replay.transforms + replay.landings.
main = main.replace(
    '  const expectedTransforms = replay.frameCount * canonical.length * 7;',
    '  const expectedTransforms = replay.frameCount * physical.length * 7;',
    1,
)
main = main.replace(
    "  if (replay.transforms.length !== expectedTransforms)\n    return Promise.reject(new Error('Replay transform buffer is invalid'));",
    "  if (replay.transforms.length !== expectedTransforms)\n    return Promise.reject(new Error('Replay transform buffer is invalid'));\n  if (replay.landings.length !== physical.length)\n    return Promise.reject(new Error('Replay landing buffer is invalid'));",
    1,
)
main = main.replace(
    '  if (replay.genericPhysicalReplay)\n    restoreAdditionalPhysicalReplay(replay.genericPhysicalReplay);\n',
    '',
)
main = main.replace('    dieCount: quantity,', '    dieCount: physical.length,', 1)
main = main.replace(
    '    transforms: replay.transforms.slice(),\n    activationDelays:',
    '    transforms: replay.transforms.slice(),\n    landings: replay.landings.slice(),\n    activationDelays:',
    1,
)
main = main.replace(
    '      replay.activationDelays?.length === quantity ? replay.activationDelays.slice() : undefined,',
    '      replay.activationDelays?.length === physical.length\n        ? replay.activationDelays.slice()\n        : undefined,',
    1,
)
main = main.replace(
    '    settleTimes: replay.settleTimes?.length === quantity ? replay.settleTimes.slice() : undefined,',
    '    settleTimes:\n      replay.settleTimes?.length === physical.length ? replay.settleTimes.slice() : undefined,',
    1,
)
main = main.replace(
    '  if (!plan.settleTimes) plan.settleTimes = deriveDieSettleTimes(plan);\n  applyReplayNumbering(plan);',
    '''  if (!plan.settleTimes) plan.settleTimes = deriveDieSettleTimes(plan);
  commitPhysicalVisualPlan(
    plan.transforms,
    plan.frameCount,
    plan.step,
    plan.dieCount,
    activeGenericPhysicalIndexes,
    plan.landings,
  );
  applyReplayNumbering(plan);''',
    1,
)

# Static additive plans retain every physical transform from the current unified plan.
static_plan = r'''function createStaticTablePlan(duration: number): RollPlan {
  const step = FIXED_STEP;
  const frameCount = Math.max(2, Math.ceil(duration / step) + 1);
  const dieCount = activePhysicalSpecs.length;
  const transforms = new Float32Array(frameCount * dieCount * 7);
  const source = activePlan;
  if (dieCount > 0 && (!source || source.dieCount !== dieCount)) {
    throw new Error('Active physical plan does not match the visible table.');
  }
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let physicalIndex = 0; physicalIndex < dieCount; physicalIndex += 1) {
      const sample = samplePlanTransform(source!, Math.min(source!.duration, planTime), physicalIndex);
      const offset = frame * dieCount * 7 + physicalIndex * 7;
      transforms[offset] = sample.position.x;
      transforms[offset + 1] = sample.position.y;
      transforms[offset + 2] = sample.position.z;
      transforms[offset + 3] = sample.quaternion.x;
      transforms[offset + 4] = sample.quaternion.y;
      transforms[offset + 5] = sample.quaternion.z;
      transforms[offset + 6] = sample.quaternion.w;
    }
  }
  const plan: RollPlan = {
    step,
    frameCount,
    dieCount,
    transforms,
    landings: source?.landings.slice() ?? new Int32Array(dieCount),
    activationDelays: new Float32Array(dieCount),
    impacts: [],
    duration,
    results: source?.results.slice() ?? dice.map((die) => die.getTopValue()),
    settleReason: 'additive-static',
    physicsSteps: 0,
  };
  plan.settleTimes = deriveDieSettleTimes(plan);
  return plan;
}
'''
main, count = re.subn(
    r"function createStaticTablePlan\(duration: number\): RollPlan \{[\s\S]*?\n\}\n\ninterface NormalizedPhysicalBridgeRequest",
    static_plan + '\ninterface NormalizedPhysicalBridgeRequest',
    main,
    count=1,
)
if count != 1:
    raise SystemExit(f'static table plan: expected one match, found {count}')

# Sampling canonical bodies reads their physical indexes from the unified plan.
main = main.replace(
    '  return dice.map((_die, index) => {\n    const current = samplePlanTransform(plan, time, index);',
    '''  return dice.map((_die, index) => {
    const physicalIndex = activeCanonicalPhysicalIndexes[index] ?? index;
    const current = samplePlanTransform(plan, time, physicalIndex);''',
    1,
)
main = main.replace(
    '    const next = samplePlanTransform(plan, nextTime, index);',
    '    const next = samplePlanTransform(plan, nextTime, physicalIndex);',
    1,
)
main = main.replace(
    'createLockedTableTrajectory(activePlan, planTime, existingCanonicalCount)',
    'createLockedTableTrajectory(activePlan, planTime, existingPhysicalCount)',
    1,
)
main = main.replace(
    '[...existingStates, ...newStates],\n          existingCanonicalCount,',
    '[...existingStates, ...newStates],\n          existingPhysicalCount,',
    1,
)

# Effect settlement now uses the same settleTimes array for all physical visuals.
effect_block = r'''function markOutcomeEffectsThrough(plan: RollPlan, time: number): void {
  const settleTimes =
    plan.settleTimes?.length === plan.dieCount ? plan.settleTimes : deriveDieSettleTimes(plan);
  plan.settleTimes = settleTimes;
  consumeSettledVisualIndexes(
    Array.from({ length: plan.dieCount }, (_value, index) => physicalVisualId(index)),
    settleTimes,
    time,
    playedOutcomeEffectIds,
  );
  consumeSettledVisualIndexes(
    activeFallbackSpecs.map((_spec, index) => fallbackVisualId(index)),
    fallbackVisuals.map((visual) => visual.getSettleTime(plan.duration)),
    time,
    playedOutcomeEffectIds,
  );
}

function playSettledOutcomeEffects(plan: RollPlan, currentTime: number): void {
  const settleTimes =
    plan.settleTimes?.length === plan.dieCount ? plan.settleTimes : deriveDieSettleTimes(plan);
  plan.settleTimes = settleTimes;
  const physicalIndexes = consumeSettledVisualIndexes(
    Array.from({ length: plan.dieCount }, (_value, index) => physicalVisualId(index)),
    settleTimes,
    currentTime,
    playedOutcomeEffectIds,
  );
  const fallbackIndexes = consumeSettledVisualIndexes(
    activeFallbackSpecs.map((_spec, index) => fallbackVisualId(index)),
    fallbackVisuals.map((visual) => visual.getSettleTime(plan.duration)),
    currentTime,
    playedOutcomeEffectIds,
  );
  if (physicalIndexes.length === 0 && fallbackIndexes.length === 0) return;
  if (document.hidden) return;

  effects.beginBatch();
  try {
    physicalIndexes.forEach((physicalIndex) => {
      const spec = activePhysicalSpecs[physicalIndex];
      const position = physicalWorldPositionAt(physicalIndex);
      if (!spec || !position) return;
      const canonicalIndex = activeCanonicalPhysicalIndexes.indexOf(physicalIndex);
      const outcome = physicalOutcomeAt(physicalIndex);
      const kind =
        canonicalIndex >= 0
          ? (activeKinds[canonicalIndex] ?? selectedKind)
          : spec.canonicalKind && isDieKind(spec.canonicalKind)
            ? spec.canonicalKind
            : 'd6';
      const value =
        canonicalIndex >= 0
          ? (plan.results[canonicalIndex] ?? spec.numericValue ?? 0)
          : (spec.numericValue ?? (typeof spec.result === 'number' ? spec.result : 0));
      effects.playOutcome(spec.theme, outcome, position.setY(0.05), {
        kind,
        value,
        hero: reserveHeroEffect(effectGroupId('physical', physicalIndex), outcome),
      });
    });
    fallbackIndexes.forEach((index) => {
      const spec = activeFallbackSpecs[index];
      const visual = fallbackVisuals[index];
      if (!spec || !visual) return;
      effects.playOutcome(spec.theme, spec.outcome, visual.getWorldPosition().setY(0.05), {
        kind: 'd6',
        value: spec.numericValue ?? 0,
        hero: reserveHeroEffect(effectGroupId('fallback', index), spec.outcome),
      });
    });
  } finally {
    effects.endBatch();
  }
  requestRender();
}
'''
main, count = re.subn(
    r"function markOutcomeEffectsThrough\(plan: RollPlan, time: number\): void \{[\s\S]*?\n\}\n\n/\*\*[\s\S]*?function playSettledOutcomeEffects\(plan: RollPlan, currentTime: number\): void \{[\s\S]*?\n\}\n\nfunction outcomeSummaryForGroups",
    effect_block + '\nfunction outcomeSummaryForGroups',
    main,
    count=1,
)
if count != 1:
    raise SystemExit(f'physical settlement effects: expected one match, found {count}')

# Remaining generated/custom naming is implementation-oriented, not a side-channel concept.
main = main.replace('const additional = split.genericIndexes.map', 'const generic = split.genericIndexes.map')
main = main.replace('spawnGenericPhysicalVisuals(additional, activeSeed);', 'spawnGenericPhysicalVisuals(generic, activeSeed);')
main = main.replace('const additional = getPendingPhysicalLaunchParticipants();', 'const generic = getPendingPhysicalLaunchParticipants();')
main = main.replace('additional.some((entry)', 'generic.some((entry)')
main = main.replace('const groupAdditional = additional.filter', 'const groupGeneric = generic.filter')
main = main.replace('groupCanonical.length + groupAdditional.length', 'groupCanonical.length + groupGeneric.length')
main = main.replace('groupAdditional,', 'groupGeneric,')
main = main.replace('assignedAdditional', 'assignedGeneric')
main = main.replace('groupAdditional.length', 'groupGeneric.length')
main = main.replace('additional.length', 'generic.length')
main = main.replace('const total = canonical.length + additional.length;', 'const total = canonical.length + generic.length;')
main = main.replace('createMixedPhysicalLaunchStates(canonical, additional,', 'createMixedPhysicalLaunchStates(canonical, generic,')
main = main.replace('additional: readonly GenericLaunchParticipant[]', 'generic: readonly GenericLaunchParticipant[]')
main = main.replace('...additional.map((entry)', '...generic.map((entry)')
main = main.replace('additional.map((entry, index)', 'generic.map((entry, index)')

# Capture/reveal generic visuals from the unified plan.
main = main.replace('const additionalPhysicalTotal', 'const genericPhysicalTotal')
main = main.replace('additionalPhysicalTotal', 'genericPhysicalTotal')
main = main.replace(
    '            visualCount: activeOutcomes.length + activeFallbackSpecs.length,',
    '            visualCount: activePhysicalSpecs.length + activeFallbackSpecs.length,',
)
main = main.replace(
    '    physicalDice: dice.length,',
    '    physicalDice: activePhysicalSpecs.length,',
    1,
)
main = main.replace(
    '(dice.length === 0 && fallbackVisuals.length === 0)',
    '(dice.length === 0 && genericPhysicalVisuals.length === 0 && fallbackVisuals.length === 0)',
    1,
)

# Remove browser-global stateful roll setters entirely.
main, count = re.subn(
    r"  setResults: \(results\) => \{[\s\S]*?  setTheme: \(theme\) => selectTheme\(theme\),\n",
    '',
    main,
    count=1,
)
if count != 1:
    raise SystemExit(f'window stateful setters: expected one match, found {count}')

# Ensure the RollReplay interface has landings and no side-channel field after all substitutions.
if 'landings: Int32Array;' not in main:
    raise SystemExit('RollReplay/RollPlan landings were not added')
if 'genericPhysicalReplay' in main or 'AdditionalPhysical' in main or 'additionalPhysical' in main:
    raise SystemExit('legacy additional-physical replay naming remains in main.ts')

main_path.write_text(main)

# --- Renderer bridge is request-oriented only. ---
renderer_path = Path('packages/renderer/src/index.ts')
renderer = renderer_path.read_text()
for line in [
    '  setDie(kind: DraftrollDieKind): void;\n',
    '  setQuantity(count: number): void;\n',
    '  setTheme(theme: string): void;\n',
]:
    if renderer.count(line) != 1:
        raise SystemExit(f'renderer bridge setter {line.strip()}: expected one match, found {renderer.count(line)}')
    renderer = renderer.replace(line, '', 1)
renderer = renderer.replace(
    '''      const rendererTheme = await this.resolveRendererTheme(themeId, signal);
      throwIfAborted(signal, 'Renderer warmup');
      this.bridge.setTheme(rendererTheme);''',
    '''      await this.resolveRendererTheme(themeId, signal);
      throwIfAborted(signal, 'Renderer warmup');''',
    1,
)
renderer_path.write_text(renderer)

# --- Source regression follows the final architecture rather than the removed side channel. ---
smoke_path = Path('scripts/test-visual-fallbacks.mjs')
smoke = smoke_path.read_text()
smoke = smoke.replace(
    "// The established roll worker is the only physical worker protocol for canonical + additional dice.\n",
    "// The roll worker consumes one ordered physical-entry array and returns one transform/landing stream.\n",
)
old_worker_assertions = '''assert.match(rollWorker, /PhysicalRollPlanner/);
assert.match(rollWorker, /AdditionalPhysicalPlanEntry/);
assert.match(rollWorker, /definition\\?: PhysicalDieDefinition/);
assert.match(rollWorker, /createCanonicalPhysicalDieDefinition/);
assert.match(rollWorker, /createGeneratedPhysicalDieDefinition/);
assert.match(rollWorker, /additionalTransforms/);
assert.match(rollWorker, /additionalLandings/);
assert.match(rollWorker, /extractPhysicalTransforms/);
assert.doesNotMatch(rollWorker, /new CANNON\\.World/);'''
new_worker_assertions = '''assert.match(rollWorker, /PhysicalRollPlanner/);
assert.match(rollWorker, /interface PlanEntry/);
assert.match(rollWorker, /definition: PhysicalDieDefinition/);
assert.match(rollWorker, /entries: PlanEntry\\[\\]/);
assert.match(rollWorker, /transforms: transforms\\.buffer/);
assert.match(rollWorker, /landings: landings\\.buffer/);
assert.doesNotMatch(rollWorker, /AdditionalPhysical/);
assert.doesNotMatch(rollWorker, /additionalTransforms|additionalLandings/);
assert.doesNotMatch(rollWorker, /extractPhysicalTransforms/);
assert.doesNotMatch(rollWorker, /new CANNON\\.World/);'''
if smoke.count(old_worker_assertions) != 1:
    raise SystemExit(f'worker smoke assertions: expected one match, found {smoke.count(old_worker_assertions)}')
smoke = smoke.replace(old_worker_assertions, new_worker_assertions, 1)
old_visual_assertions = '''assert.match(physicalVisuals, /getAdditionalPhysicalPlanEntries/);
assert.match(physicalVisuals, /commitAdditionalPhysicalPlan/);
assert.match(physicalVisuals, /captureAdditionalPhysicalReplay/);
assert.match(physicalVisuals, /restoreAdditionalPhysicalReplay/);'''
new_visual_assertions = '''assert.match(physicalVisuals, /getPhysicalVisualPlanEntries/);
assert.match(physicalVisuals, /commitPhysicalVisualPlan/);
assert.doesNotMatch(physicalVisuals, /AdditionalPhysical|additionalPhysical/);'''
if smoke.count(old_visual_assertions) != 1:
    raise SystemExit(f'visual smoke assertions: expected one match, found {smoke.count(old_visual_assertions)}')
smoke = smoke.replace(old_visual_assertions, new_visual_assertions, 1)
old_engine_assertions = '''assert.match(engine, /getAdditionalPhysicalPlanEntries/);
assert.match(engine, /commitAdditionalPhysicalPlan/);
assert.match(engine, /additional,/);
assert.match(engine, /hasPendingAdditionalPhysicalDice/);
assert.match(engine, /additionalPhysicalReplay/);
assert.doesNotMatch(engine, /physicalFallbackReplay/);'''
new_engine_assertions = '''assert.match(engine, /createWorkerPhysicalEntries/);
assert.match(engine, /commitPhysicalVisualPlan/);
assert.match(engine, /landings: plan\\.landings\\.slice\\(\\)/);
assert.match(engine, /activeGenericPhysicalIndexes/);
assert.doesNotMatch(engine, /AdditionalPhysical|additionalPhysical/);
assert.doesNotMatch(engine, /physicalFallbackReplay/);'''
if smoke.count(old_engine_assertions) != 1:
    raise SystemExit(f'engine smoke assertions: expected one match, found {smoke.count(old_engine_assertions)}')
smoke = smoke.replace(old_engine_assertions, new_engine_assertions, 1)
smoke_path.write_text(smoke)

natural_path = Path('scripts/test-natural-target-physics.mjs')
natural = natural_path.read_text()
natural = natural.replace("assert.match(worker, /candidateAttempts: 1/);\n", '')
natural = natural.replace("assert.match(worker, /assistedDice: \\[\\]/);\n", '')
natural = natural.replace(
    "assert.doesNotMatch(worker, /targetNormals/);\n",
    "assert.doesNotMatch(worker, /targetNormals/);\nassert.match(worker, /entries: PlanEntry\\[\\]/);\nassert.match(worker, /landings: landings\\.buffer/);\nassert.doesNotMatch(worker, /AdditionalPhysical|additionalTransforms|additionalLandings/);\n",
    1,
)
natural = natural.replace('existingCount, lockedTrajectory', 'existingPhysicalCount, lockedTrajectory')
natural_path.write_text(natural)

print('Unified physical plan/replay migration applied.')
