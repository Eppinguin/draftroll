import { createCanonicalPhysicalDieDefinition } from './physical-dice';
import {
  PHYSICAL_STATE_STRIDE,
  PhysicalRollPlanner,
  type LockedPhysicalMotion,
  type PhysicalRollEntry,
} from './physical-roll-planner';
import type { DieKind } from './physics-shapes';

interface PlanRequest {
  id: number;
  /** Per-die physical kinds. Legacy callers may still provide kind/count. */
  kinds?: DieKind[];
  kind?: DieKind;
  count?: number;
  boundsX: number;
  boundsZ: number;
  states: ArrayBuffer;
  /** Existing visible dice follow their previously verified trajectory. */
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
  const lockedCount = Math.max(0, Math.min(count, request.lockedCount ?? 0));
  const result = planner.simulate({
    entries,
    boundsX: request.boundsX,
    boundsZ: request.boundsZ,
    lockedCount,
    lockedMotion: readLockedMotion(request, lockedCount),
  });
  const transforms = result.transforms;
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
    { transfer: [transforms.buffer, impacts.buffer] },
  );
});
