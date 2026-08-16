import type { PhysicalDieDefinition } from './physical-dice';
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

function readLockedMotion(
  request: PlanRequest,
  lockedCount: number,
): LockedPhysicalMotion | undefined {
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
