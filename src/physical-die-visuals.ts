import * as THREE from 'three';
import type { DraftrollPhysicalVisual } from '../packages/renderer/src/index';
import { clonePhysicalDieDefinition } from '../packages/renderer/src/physical';
import {
  createDefaultPhysicalDiePresentation,
  createGeneratedPhysicalDieDefinition,
  createPhysicalDiePresentation,
  physicalDieColliderRadius,
  type PhysicalDieDefinition,
  type PhysicalDiePresentation,
} from './physical-dice';
import { createPhysicalDieMesh, type PhysicalDieMesh } from './physical-die-mesh';
import type { PhysicalLaunchState } from './physical-launch';
import { getRuntimeThemePresentation } from './runtime-themes';

interface SharedTrajectoryView {
  transforms: Float32Array;
  frameCount: number;
  step: number;
  physicalCount: number;
  physicalIndex: number;
}

function readPhysicalPresentation(
  spec: DraftrollPhysicalVisual,
  definition: PhysicalDieDefinition,
): { presentation: PhysicalDiePresentation; explicit: boolean } {
  if (spec.presentation) {
    return {
      presentation: createPhysicalDiePresentation(definition, spec.presentation.contents),
      explicit: true,
    };
  }
  const themed = getRuntimeThemePresentation(spec.theme, spec.type, `d${definition.sides}`);
  if (themed && themed.contents.length === definition.outcomes.length) {
    return {
      presentation: createPhysicalDiePresentation(definition, themed.contents),
      explicit: true,
    };
  }
  return { presentation: createDefaultPhysicalDiePresentation(definition), explicit: false };
}

function trajectoryDuration(trajectory: SharedTrajectoryView): number {
  return Math.max(0, trajectory.frameCount - 1) * trajectory.step;
}

function trajectoryOffset(trajectory: SharedTrajectoryView, frameIndex: number): number {
  return frameIndex * trajectory.physicalCount * 7 + trajectory.physicalIndex * 7;
}

function sampleTrajectory(
  trajectory: SharedTrajectoryView,
  time: number,
  scaleX: number,
  scaleZ: number,
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  quaternionScratch: THREE.Quaternion,
): void {
  const framePosition = THREE.MathUtils.clamp(time / trajectory.step, 0, trajectory.frameCount - 1);
  const first = Math.floor(framePosition);
  const second = Math.min(trajectory.frameCount - 1, first + 1);
  const blend = framePosition - first;
  const a = trajectoryOffset(trajectory, first);
  const b = trajectoryOffset(trajectory, second);
  position.set(
    THREE.MathUtils.lerp(trajectory.transforms[a], trajectory.transforms[b], blend) * scaleX,
    THREE.MathUtils.lerp(trajectory.transforms[a + 1], trajectory.transforms[b + 1], blend),
    THREE.MathUtils.lerp(trajectory.transforms[a + 2], trajectory.transforms[b + 2], blend) *
      scaleZ,
  );
  quaternion.set(
    trajectory.transforms[a + 3],
    trajectory.transforms[a + 4],
    trajectory.transforms[a + 5],
    trajectory.transforms[a + 6],
  );
  quaternionScratch.set(
    trajectory.transforms[b + 3],
    trajectory.transforms[b + 4],
    trajectory.transforms[b + 5],
    trajectory.transforms[b + 6],
  );
  quaternion.slerp(quaternionScratch, blend);
}

function serializeLaunchState(state: PhysicalLaunchState): number[] {
  return [
    ...state.position,
    ...state.quaternion,
    ...state.velocity,
    ...state.angularVelocity,
    state.delay,
  ];
}

export class PhysicalDieVisualInstance {
  readonly group: THREE.Group;
  readonly spec: DraftrollPhysicalVisual;
  readonly definition: PhysicalDieDefinition;
  readonly sides: number;
  launchState: number[] = [];

  private readonly mesh: PhysicalDieMesh;
  private readonly inner: THREE.Group;
  private readonly requestedOutcome: number;
  private readonly sampleQuaternion = new THREE.Quaternion();
  private readonly plannerQuaternionA = new THREE.Quaternion();
  private readonly plannerQuaternionB = new THREE.Quaternion();
  private readonly plannerQuaternionDelta = new THREE.Quaternion();
  private trajectory: SharedTrajectoryView | null = null;
  private prepared = false;
  private settled = false;
  private needsPlanning = false;
  private lastTime = 0;
  private lastScaleX = 1;
  private lastScaleZ = 1;
  private activationDelay = 0;
  private landedOutcome: number | null = null;

  constructor(spec: DraftrollPhysicalVisual) {
    this.spec = spec;
    const maximumSides = spec.definition ? 10_000 : 256;
    if (!Number.isSafeInteger(spec.sides) || spec.sides < 1 || spec.sides > maximumSides) {
      throw new Error(`Physical die requires 1 to ${maximumSides} outcome slots: ${spec.type}`);
    }
    this.sides = spec.sides;
    this.definition = spec.definition
      ? clonePhysicalDieDefinition(spec.definition)
      : createGeneratedPhysicalDieDefinition(spec.sides);
    if (this.definition.sides !== spec.sides || this.definition.outcomes.length !== spec.sides) {
      throw new Error(`Physical definition does not match descriptor: ${spec.id}`);
    }
    if (spec.definition && this.definition.targeting !== 'relabel') {
      throw new Error(
        `Host-supplied physical die ${spec.id} requires relabel targeting; ${this.definition.targeting} targeting has no custom rotation/search provider`,
      );
    }
    const resolvedPresentation = readPhysicalPresentation(spec, this.definition);
    this.requestedOutcome = spec.outcomeIndex;
    this.mesh = createPhysicalDieMesh({
      spec,
      definition: this.definition,
      presentation: resolvedPresentation.presentation,
      explicitPresentation: resolvedPresentation.explicit,
    });
    this.group = this.mesh.group;
    this.inner = this.mesh.visualRoot;
  }

  get hasTrajectory(): boolean {
    return this.trajectory !== null;
  }

  get isPrepared(): boolean {
    return this.prepared;
  }

  get requiresPlanning(): boolean {
    return this.needsPlanning;
  }

  prepare(): void {
    this.launchState = [];
    this.prepared = true;
    this.trajectory = null;
    this.needsPlanning = true;
    this.lastTime = 0;
    this.lastScaleX = 1;
    this.lastScaleZ = 1;
    this.activationDelay = 0;
    this.settled = false;
    this.group.visible = false;
    this.mesh.setOpacity(0);
    this.mesh.updateShadow(this.group.position.y, 0);
  }

  assignLaunchState(state: PhysicalLaunchState): void {
    if (!this.needsPlanning) return;
    this.launchState = serializeLaunchState(state);
    this.activationDelay = Math.max(0, state.delay);
    this.group.position.set(...state.position);
    this.inner.quaternion.set(...state.quaternion);
    this.mesh.setOpacity(0);
    this.mesh.updateShadow(this.group.position.y, 0);
  }

  private applyRequestedResult(landed: number): void {
    if (this.definition.targeting !== 'relabel') return;
    const requested = THREE.MathUtils.clamp(
      Math.round(this.requestedOutcome),
      0,
      this.definition.outcomes.length - 1,
    );
    const landing = THREE.MathUtils.clamp(
      Math.round(landed),
      0,
      this.definition.outcomes.length - 1,
    );
    if (requested === landing) return;
    this.mesh.swapOutcomeLabels(requested, landing);
  }

  plannerState(): number[] {
    if (this.needsPlanning || !this.trajectory) {
      if (this.launchState.length !== 14) {
        throw new Error(`Physical die ${this.spec.id} has not been assigned a launch state.`);
      }
      return this.launchState.slice();
    }
    const position = this.group.position;
    const quaternion = this.inner.quaternion;
    let velocityX = 0;
    let velocityY = 0;
    let velocityZ = 0;
    let angularX = 0;
    let angularY = 0;
    let angularZ = 0;

    if (!this.settled && this.lastTime < trajectoryDuration(this.trajectory) - 1e-6) {
      const framePosition = THREE.MathUtils.clamp(
        this.lastTime / this.trajectory.step,
        0,
        this.trajectory.frameCount - 1,
      );
      let first = Math.floor(framePosition);
      let second = Math.min(this.trajectory.frameCount - 1, first + 1);
      if (first === second && first > 0) {
        first -= 1;
        second = first + 1;
      }
      const dt = Math.max(1e-6, (second - first) * this.trajectory.step);
      const a = trajectoryOffset(this.trajectory, first);
      const b = trajectoryOffset(this.trajectory, second);
      velocityX =
        ((this.trajectory.transforms[b] - this.trajectory.transforms[a]) / dt) * this.lastScaleX;
      velocityY = (this.trajectory.transforms[b + 1] - this.trajectory.transforms[a + 1]) / dt;
      velocityZ =
        ((this.trajectory.transforms[b + 2] - this.trajectory.transforms[a + 2]) / dt) *
        this.lastScaleZ;

      this.plannerQuaternionA.set(
        this.trajectory.transforms[a + 3],
        this.trajectory.transforms[a + 4],
        this.trajectory.transforms[a + 5],
        this.trajectory.transforms[a + 6],
      );
      this.plannerQuaternionB.set(
        this.trajectory.transforms[b + 3],
        this.trajectory.transforms[b + 4],
        this.trajectory.transforms[b + 5],
        this.trajectory.transforms[b + 6],
      );
      this.plannerQuaternionA.invert();
      this.plannerQuaternionDelta
        .copy(this.plannerQuaternionB)
        .multiply(this.plannerQuaternionA)
        .normalize();
      if (this.plannerQuaternionDelta.w < 0) {
        this.plannerQuaternionDelta.set(
          -this.plannerQuaternionDelta.x,
          -this.plannerQuaternionDelta.y,
          -this.plannerQuaternionDelta.z,
          -this.plannerQuaternionDelta.w,
        );
      }
      const halfSin = Math.hypot(
        this.plannerQuaternionDelta.x,
        this.plannerQuaternionDelta.y,
        this.plannerQuaternionDelta.z,
      );
      if (halfSin > 1e-6) {
        const angle =
          2 * Math.atan2(halfSin, THREE.MathUtils.clamp(this.plannerQuaternionDelta.w, -1, 1));
        const speed = Math.min(28, angle / dt);
        angularX = (this.plannerQuaternionDelta.x / halfSin) * speed;
        angularY = (this.plannerQuaternionDelta.y / halfSin) * speed;
        angularZ = (this.plannerQuaternionDelta.z / halfSin) * speed;
      }
    }

    return [
      position.x,
      position.y,
      position.z,
      quaternion.x,
      quaternion.y,
      quaternion.z,
      quaternion.w,
      velocityX,
      velocityY,
      velocityZ,
      angularX,
      angularY,
      angularZ,
      0,
    ];
  }

  commitTrajectory(
    transforms: Float32Array,
    frameCount: number,
    step: number,
    physicalCount: number,
    physicalIndex: number,
    landed: number,
    activationDelay = 0,
  ): void {
    const newlyIntroduced = this.needsPlanning;
    this.landedOutcome = landed;
    if (newlyIntroduced) this.applyRequestedResult(landed);
    this.trajectory = { transforms, frameCount, step, physicalCount, physicalIndex };
    this.activationDelay = Math.max(0, activationDelay);
    this.needsPlanning = false;
    this.lastTime = 0;
    this.lastScaleX = 1;
    this.lastScaleZ = 1;
    this.settled = false;
    sampleTrajectory(
      this.trajectory,
      0,
      1,
      1,
      this.group.position,
      this.inner.quaternion,
      this.sampleQuaternion,
    );
    this.mesh.updateShadow(this.group.position.y, 0);
  }

  update(time: number, scaleX = 1, scaleZ = 1): void {
    if (this.settled || !this.trajectory) return;
    this.lastTime = THREE.MathUtils.clamp(time, 0, trajectoryDuration(this.trajectory));
    this.lastScaleX = scaleX;
    this.lastScaleZ = scaleZ;
    const visible = this.lastTime + this.trajectory.step * 0.5 >= this.activationDelay;
    this.group.visible = visible;
    if (!visible) {
      this.mesh.setOpacity(0);
      this.mesh.updateShadow(this.group.position.y, 0);
      return;
    }
    sampleTrajectory(
      this.trajectory,
      this.lastTime,
      scaleX,
      scaleZ,
      this.group.position,
      this.inner.quaternion,
      this.sampleQuaternion,
    );
    this.mesh.setOpacity(1);
    this.mesh.updateShadow(this.group.position.y, 1);
  }

  settle(): void {
    if (this.settled) return;
    if (this.trajectory) {
      this.lastTime = trajectoryDuration(this.trajectory);
      sampleTrajectory(
        this.trajectory,
        this.lastTime,
        this.lastScaleX,
        this.lastScaleZ,
        this.group.position,
        this.inner.quaternion,
        this.sampleQuaternion,
      );
    }
    this.group.visible = true;
    this.mesh.setOpacity(1);
    this.mesh.updateShadow(this.group.position.y, 1);
    this.settled = true;
  }

  get targetingMode(): PhysicalDieDefinition['targeting'] {
    return this.definition.targeting;
  }

  get landedOutcomeIndex(): number | null {
    return this.landedOutcome;
  }

  get displayedOutcomeIndex(): number {
    return this.requestedOutcome;
  }

  getVisualRadius(): number {
    return this.definition.radius;
  }

  moveTo(position: THREE.Vector3): void {
    this.group.position.copy(position);
    this.mesh.updateShadow(this.group.position.y, 1);
  }

  getWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.group.getWorldPosition(target);
  }

  getWorldQuaternion(target = new THREE.Quaternion()): THREE.Quaternion {
    return this.inner.getWorldQuaternion(target);
  }

  getSettledPosition(target = new THREE.Vector2()): THREE.Vector2 {
    return target.set(this.group.position.x, this.group.position.z);
  }

  getSettleTime(duration: number): number {
    return duration;
  }

  dispose(): void {
    this.mesh.dispose();
  }
}

export interface PendingPhysicalLaunchParticipant {
  visualIndex: number;
  radius: number;
  coinLike: boolean;
}

export interface PendingPhysicalLaunchAssignment {
  visualIndex: number;
  state: PhysicalLaunchState;
}

export interface PhysicalVisualPlanEntry {
  visualIndex: number;
  definition: PhysicalDieDefinition;
  state: number[];
}

export interface PhysicalVisualPlanAssignment {
  visualIndex: number;
  physicalIndex: number;
}

interface ConfiguredPhysicalVisual {
  visualIndex: number;
  visual: PhysicalDieVisualInstance;
}

function configuredPhysicalDice(
  entries: readonly PhysicalDieVisualInstance[],
): ConfiguredPhysicalVisual[] {
  return entries.flatMap((visual, visualIndex) =>
    visual.isPrepared ? [{ visualIndex, visual }] : [],
  );
}

export function getPendingPhysicalLaunchParticipants(
  entries: readonly PhysicalDieVisualInstance[],
): PendingPhysicalLaunchParticipant[] {
  return configuredPhysicalDice(entries).flatMap(({ visualIndex, visual }) =>
    visual.requiresPlanning
      ? [
          {
            visualIndex,
            radius: physicalDieColliderRadius(visual.definition),
            coinLike: visual.sides === 2,
          },
        ]
      : [],
  );
}

export function assignPendingPhysicalLaunchStates(
  entries: readonly PhysicalDieVisualInstance[],
  assignments: readonly PendingPhysicalLaunchAssignment[],
): void {
  const assigned = new Set<number>();
  for (const assignment of assignments) {
    if (assigned.has(assignment.visualIndex)) {
      throw new Error(`Physical visual launch assignment is duplicated: ${assignment.visualIndex}`);
    }
    assigned.add(assignment.visualIndex);
    const visual = entries[assignment.visualIndex];
    if (!visual?.isPrepared || !visual.requiresPlanning) {
      throw new Error(`Physical visual is not pending at visual index ${assignment.visualIndex}`);
    }
    visual.assignLaunchState(assignment.state);
  }
}

export function hasConfiguredPhysicalVisuals(
  entries: readonly PhysicalDieVisualInstance[],
): boolean {
  return entries.some((entry) => entry.isPrepared);
}

export function hasPendingPhysicalVisuals(entries: readonly PhysicalDieVisualInstance[]): boolean {
  return entries.some((entry) => entry.isPrepared && entry.requiresPlanning);
}

export function getPhysicalVisualPlanEntries(
  entries: readonly PhysicalDieVisualInstance[],
): PhysicalVisualPlanEntry[] {
  return configuredPhysicalDice(entries).map(({ visualIndex, visual }) => ({
    visualIndex,
    definition: visual.definition,
    state: visual.plannerState(),
  }));
}

export function commitPhysicalVisualPlan(
  entries: readonly PhysicalDieVisualInstance[],
  transforms: Float32Array,
  frameCount: number,
  step: number,
  physicalCount: number,
  assignments: readonly PhysicalVisualPlanAssignment[],
  landings: Int32Array,
  activationDelays?: Float32Array,
): void {
  if (
    frameCount < 1 ||
    transforms.length !== frameCount * physicalCount * 7 ||
    landings.length !== physicalCount ||
    (activationDelays !== undefined && activationDelays.length !== physicalCount)
  ) {
    throw new Error('Physical trajectory buffers do not match the unified plan.');
  }
  const configuredIndexes = new Set(
    configuredPhysicalDice(entries).map(({ visualIndex }) => visualIndex),
  );
  const assignedIndexes = new Set(assignments.map((assignment) => assignment.visualIndex));
  if (
    configuredIndexes.size !== assignments.length ||
    assignedIndexes.size !== assignments.length ||
    [...configuredIndexes].some((visualIndex) => !assignedIndexes.has(visualIndex))
  ) {
    throw new Error('Physical visual assignments do not match the configured generic dice.');
  }

  for (const assignment of assignments) {
    const visual = entries[assignment.visualIndex];
    if (!visual?.isPrepared) {
      throw new Error(
        `Physical visual is not configured at visual index ${assignment.visualIndex}`,
      );
    }
    const physicalIndex = assignment.physicalIndex;
    if (physicalIndex < 0 || physicalIndex >= physicalCount) {
      throw new Error(`Physical visual index is invalid: ${String(physicalIndex)}`);
    }
    visual.commitTrajectory(
      transforms,
      frameCount,
      step,
      physicalCount,
      physicalIndex,
      landings[physicalIndex] ?? 0,
      activationDelays?.[physicalIndex] ?? 0,
    );
  }
}
