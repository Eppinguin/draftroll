import {
  createCanonicalPhysicalDieDefinition,
  createGeneratedPhysicalDieDefinition,
  type PhysicalDieDefinition,
} from './physical-dice';
import {
  extractPhysicalTransforms,
  PHYSICAL_STATE_STRIDE,
  PhysicalRollPlanner,
  type LockedPhysicalMotion,
  type PhysicalRollEntry,
} from './physical-roll-planner';
import type { DieKind } from './physics-shapes';

interface AdditionalPhysicalPlanEntry {
  /** Generated dice can send only sides; custom/theme geometry can send a full definition. */
  sides?: number;
  definition?: PhysicalDieDefinition;
  state: number[];
}

interface PlanRequest {
  id: number;
  /** Per-die canonical kinds. Legacy callers may still provide kind/count. */
  kinds?: DieKind[];
  kind?: DieKind;
  count?: number;
  boundsX: number;
  boundsZ: number;
  states: ArrayBuffer;
  /** Existing visible canonical dice follow their previously verified trajectory. */
  lockedCount?: number;
  lockedTrajectory?: ArrayBuffer;
  lockedTrajectoryStep?: number;
  lockedTrajectoryFrameCount?: number;
  /** First-class physical dice outside the legacy canonical-kind union. */
  additional?: AdditionalPhysicalPlanEntry[];
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

function resolveAdditionalDefinition(entry: AdditionalPhysicalPlanEntry): PhysicalDieDefinition {
  if (entry.definition) return entry.definition;
  if (Number.isSafeInteger(entry.sides) && (entry.sides ?? 0) >= 1) {
    return createGeneratedPhysicalDieDefinition(entry.sides!);
  }
  throw new Error('Additional physical die requires sides or a physical definition.');
}

self.addEventListener('message', (event: MessageEvent<PlanRequest>) => {
  const request = event.data;
  const count = request.kinds?.length ?? request.count ?? 0;
  const fallbackKind = request.kind ?? 'd20';
  const kinds =
    request.kinds?.length === count
      ? request.kinds
      : Array.from({ length: count }, () => fallbackKind);
  const states = new Float32Array(request.states);
  const entries: PhysicalRollEntry[] = kinds.map((kind, index) => ({
    definition: createCanonicalPhysicalDieDefinition(kind),
    state: states.subarray(
      index * PHYSICAL_STATE_STRIDE,
      (index + 1) * PHYSICAL_STATE_STRIDE,
    ),
    captureImpacts: true,
  }));
  const additional = request.additional ?? [];
  additional.forEach((entry) => {
    entries.push({
      definition: resolveAdditionalDefinition(entry),
      state: entry.state,
      captureImpacts: false,
    });
  });

  const lockedCount = Math.max(0, Math.min(count, request.lockedCount ?? 0));
  const result = planner.simulate({
    entries,
    boundsX: request.boundsX,
    boundsZ: request.boundsZ,
    lockedCount,
    lockedMotion: readLockedMotion(request, lockedCount),
  });
  const transforms = extractPhysicalTransforms(
    result.transforms,
    result.frameCount,
    entries.length,
    0,
    count,
  );
  const additionalTransforms = extractPhysicalTransforms(
    result.transforms,
    result.frameCount,
    entries.length,
    count,
    additional.length,
  );
  const additionalLandings = result.landings.slice(count);
  const impacts = result.impacts;
  self.postMessage(
    {
      id: request.id,
      step: result.step,
      frameCount: result.frameCount,
      dieCount: count,
      transforms: transforms.buffer,
      impacts: impacts.buffer,
      duration: result.duration,
      settleReason: result.settleReason,
      physicsSteps: result.physicsSteps,
      additionalTransforms: additionalTransforms.buffer,
      additionalLandings: additionalLandings.buffer,
      diagnostics: {
        finalAverageLinear: result.finalAverageLinear,
        finalAverageAngular: result.finalAverageAngular,
        candidateAttempts: 1,
        candidateSearchMs: result.planningMs,
        naturalTrajectory: true,
        naturalMatches: count,
        assistedDice: [],
        maximumAssistAngle: 0,
        finalTargetDots: [],
        targetSuccess: true,
        lockedKinematicDice: lockedCount,
      },
    },
    {
      transfer: [
        transforms.buffer,
        impacts.buffer,
        additionalTransforms.buffer,
        additionalLandings.buffer,
      ],
    },
  );
});
