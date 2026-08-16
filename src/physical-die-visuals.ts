import * as THREE from 'three';
import type { DraftrollPhysicalVisual } from '../packages/renderer/src/index';
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

const activePhysicalDice = new Map<string, PhysicalDieVisualInstance>();
const pendingPhysicalDice = new Set<string>();

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
  private readonly labelMaterials: THREE.MeshBasicMaterial[];
  private readonly originalLabelMaps: Array<THREE.Texture | null>;
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

  constructor(spec: DraftrollPhysicalVisual) {
    this.spec = spec;
    if (!Number.isSafeInteger(spec.sides) || spec.sides < 1 || spec.sides > 256) {
      throw new Error(`Physical die requires 1 to 256 exact outcome slots: ${spec.type}`);
    }
    if (activePhysicalDice.has(spec.id)) {
      throw new Error(`Physical die id is already active: ${spec.id}`);
    }
    this.sides = spec.sides;
    this.definition = createGeneratedPhysicalDieDefinition(spec.sides);
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
    this.labelMaterials = this.mesh.labelMaterials;
    this.originalLabelMaps = this.mesh.labelMaps.slice();
    activePhysicalDice.set(spec.id, this);
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

  get launchParticipant(): PendingPhysicalLaunchParticipant {
    return {
      id: this.spec.id,
      radius: physicalDieColliderRadius(this.definition),
      coinLike: this.sides === 2,
    };
  }

  prepare(): void {
    this.launchState = [];
    this.prepared = true;
    this.trajectory = null;
    this.needsPlanning = true;
    pendingPhysicalDice.add(this.spec.id);
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
    const requestedMap = this.originalLabelMaps[requested] ?? null;
    const landingMap = this.originalLabelMaps[landing] ?? null;
    const requestedMaterial = this.labelMaterials[requested];
    const landingMaterial = this.labelMaterials[landing];
    if (requestedMaterial) {
      requestedMaterial.map = landingMap;
      requestedMaterial.needsUpdate = true;
    }
    if (landingMaterial) {
      landingMaterial.map = requestedMap;
      landingMaterial.needsUpdate = true;
    }
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
    if (newlyIntroduced) this.applyRequestedResult(landed);
    this.trajectory = { transforms, frameCount, step, physicalCount, physicalIndex };
    this.activationDelay = Math.max(0, activationDelay);
    this.needsPlanning = false;
    pendingPhysicalDice.delete(this.spec.id);
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

  getWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.group.getWorldPosition(target);
  }

  getSettledPosition(target = new THREE.Vector2()): THREE.Vector2 {
    return target.set(this.group.position.x, this.group.position.z);
  }

  getSettleTime(duration: number): number {
    return duration;
  }

  dispose(): void {
    if (activePhysicalDice.get(this.spec.id) === this) {
      activePhysicalDice.delete(this.spec.id);
    }
    pendingPhysicalDice.delete(this.spec.id);
    this.mesh.dispose();
  }
}

export interface PendingPhysicalLaunchParticipant {
  id: string;
  radius: number;
  coinLike: boolean;
}

export interface PendingPhysicalLaunchAssignment {
  id: string;
  state: PhysicalLaunchState;
}

export interface PhysicalVisualPlanEntry {
  id: string;
  definition: PhysicalDieDefinition;
  state: number[];
}

export interface PhysicalVisualPlanAssignment {
  id: string;
  physicalIndex: number;
}

function configuredPhysicalDice(): PhysicalDieVisualInstance[] {
  return [...activePhysicalDice.values()].filter((entry) => entry.isPrepared);
}

export function getPendingPhysicalLaunchParticipants(): PendingPhysicalLaunchParticipant[] {
  const participants: PendingPhysicalLaunchParticipant[] = [];
  for (const id of pendingPhysicalDice) {
    const entry = activePhysicalDice.get(id);
    if (entry?.isPrepared) participants.push(entry.launchParticipant);
  }
  return participants;
}

export function assignPendingPhysicalLaunchStates(
  assignments: readonly PendingPhysicalLaunchAssignment[],
): void {
  for (const assignment of assignments) {
    const entry = activePhysicalDice.get(assignment.id);
    if (entry && pendingPhysicalDice.has(assignment.id)) {
      entry.assignLaunchState(assignment.state);
    }
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
  const configuredIds = new Set(configuredPhysicalDice().map((entry) => entry.spec.id));
  const assignedIds = new Set(assignments.map((assignment) => assignment.id));
  if (
    configuredIds.size !== assignments.length ||
    assignedIds.size !== assignments.length ||
    [...configuredIds].some((id) => !assignedIds.has(id))
  ) {
    throw new Error('Physical visual assignments do not match the configured generic dice.');
  }

  for (const assignment of assignments) {
    const entry = activePhysicalDice.get(assignment.id);
    if (!entry?.isPrepared) {
      throw new Error(`Physical visual is not configured: ${assignment.id}`);
    }
    const physicalIndex = assignment.physicalIndex;
    if (physicalIndex < 0 || physicalIndex >= physicalCount) {
      throw new Error(`Physical visual index is invalid: ${String(physicalIndex)}`);
    }
    entry.commitTrajectory(
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
