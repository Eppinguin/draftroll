import {
  createCanonicalPhysicalDieDefinition,
  createGeneratedPhysicalDieDefinition,
  type CanonicalDieKind,
  type PhysicalDieDefinition,
} from './physical-dice';
import {
  extractPhysicalTransforms,
  PHYSICAL_STATE_STRIDE,
  PhysicalRollPlanner,
  type LockedPhysicalMotion,
  type PhysicalRollEntry,
} from './physical-roll-planner';

interface AdditionalPhysicalPlanEntry {
  /** Generated dice can send only sides; custom/theme geometry can send a full definition. */
  sides?: number;
  definition?: PhysicalDieDefinition;
  state: number[];
}

interface SharedPhysicalPlanRequest {
  id: number;
  kinds?: CanonicalDieKind[];
  kind?: CanonicalDieKind;
  count?: number;
  boundsX: number;
  boundsZ: number;
  states: ArrayBuffer;
  lockedCount?: number;
  lockedTrajectory?: ArrayBuffer;
  lockedTrajectoryStep?: number;
  lockedTrajectoryFrameCount?: number;
  additional: AdditionalPhysicalPlanEntry[];
}

interface SharedPhysicalPlanResponse {
  id: number;
  step: number;
  frameCount: number;
  dieCount: number;
  transforms: ArrayBuffer;
  impacts: ArrayBuffer;
  duration: number;
  settleReason: string;
  physicsSteps: number;
  additionalTransforms: ArrayBuffer;
  additionalLandings: ArrayBuffer;
  diagnostics: {
    finalAverageLinear: number;
    finalAverageAngular: number;
    candidateAttempts: number;
    candidateSearchMs: number;
    naturalTrajectory: true;
    naturalMatches: number;
    assistedDice: number[];
    maximumAssistAngle: number;
    finalTargetDots: number[];
    targetSuccess: true;
    lockedKinematicDice: number;
  };
}

const planner = new PhysicalRollPlanner();

function resolveAdditionalDefinition(entry: AdditionalPhysicalPlanEntry): PhysicalDieDefinition {
  if (entry.definition) return entry.definition;
  if (Number.isSafeInteger(entry.sides) && (entry.sides ?? 0) >= 1) {
    return createGeneratedPhysicalDieDefinition(entry.sides!);
  }
  throw new Error('Additional physical die requires sides or a physical definition.');
}

function lockedMotion(
  request: SharedPhysicalPlanRequest,
  lockedCount: number,
): LockedPhysicalMotion | undefined {
  if (!request.lockedTrajectory || lockedCount <= 0) return undefined;
  const step = Number(request.lockedTrajectoryStep);
  const frameCount = Math.max(0, Math.floor(request.lockedTrajectoryFrameCount ?? 0));
  if (!Number.isFinite(step) || step <= 0 || frameCount < 2) return undefined;
  const transforms = new Float32Array(request.lockedTrajectory);
  if (transforms.length !== lockedCount * frameCount * 7) return undefined;
  return { count: lockedCount, step, frameCount, transforms };
}

function simulate(request: SharedPhysicalPlanRequest): SharedPhysicalPlanResponse {
  const kinds =
    request.kinds ??
    Array.from({ length: request.count ?? 0 }, () => request.kind ?? ('d20' as const));
  const standardCount = kinds.length;
  const additionalCount = request.additional.length;
  const stateData = new Float32Array(request.states);
  const entries: PhysicalRollEntry[] = kinds.map((kind, index) => ({
    definition: createCanonicalPhysicalDieDefinition(kind),
    state: stateData.subarray(
      index * PHYSICAL_STATE_STRIDE,
      (index + 1) * PHYSICAL_STATE_STRIDE,
    ),
    captureImpacts: true,
  }));
  request.additional.forEach((entry) => {
    entries.push({
      definition: resolveAdditionalDefinition(entry),
      state: entry.state,
      captureImpacts: false,
    });
  });

  const lockedCount = Math.max(0, Math.min(standardCount, request.lockedCount ?? 0));
  const plan = planner.simulate({
    entries,
    boundsX: request.boundsX,
    boundsZ: request.boundsZ,
    lockedCount,
    lockedMotion: lockedMotion(request, lockedCount),
  });
  const standardTransforms = extractPhysicalTransforms(
    plan.transforms,
    plan.frameCount,
    entries.length,
    0,
    standardCount,
  );
  const additionalTransforms = extractPhysicalTransforms(
    plan.transforms,
    plan.frameCount,
    entries.length,
    standardCount,
    additionalCount,
  );
  const additionalLandings = plan.landings.slice(standardCount);
  return {
    id: request.id,
    step: plan.step,
    frameCount: plan.frameCount,
    dieCount: standardCount,
    transforms: standardTransforms.buffer,
    impacts: plan.impacts.buffer,
    duration: plan.duration,
    settleReason: plan.settleReason,
    physicsSteps: plan.physicsSteps,
    additionalTransforms: additionalTransforms.buffer,
    additionalLandings: additionalLandings.buffer,
    diagnostics: {
      finalAverageLinear: plan.finalAverageLinear,
      finalAverageAngular: plan.finalAverageAngular,
      candidateAttempts: 1,
      candidateSearchMs: plan.planningMs,
      naturalTrajectory: true,
      naturalMatches: standardCount,
      assistedDice: [],
      maximumAssistAngle: 0,
      finalTargetDots: [],
      targetSuccess: true,
      lockedKinematicDice: lockedCount,
    },
  };
}

self.addEventListener('message', (event: MessageEvent<SharedPhysicalPlanRequest>) => {
  const response = simulate(event.data);
  self.postMessage(response, {
    transfer: [
      response.transforms,
      response.impacts,
      response.additionalTransforms,
      response.additionalLandings,
    ],
  });
});
