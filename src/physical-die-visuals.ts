import * as THREE from 'three';
import type { DraftrollFallbackVisual } from '../packages/renderer/src/index';
import {
  createDefaultPhysicalDiePresentation,
  createGeneratedPhysicalDieDefinition,
  createPhysicalDiePresentation,
  physicalDieColliderRadius,
  type PhysicalDieDefinition,
  type PhysicalDieFaceContent,
  type PhysicalDiePresentation,
} from './physical-dice';
import { createPhysicalDieMesh, type PhysicalDieMesh } from './physical-die-mesh';
import type { PhysicalLaunchState } from './physical-launch';
import { extractPhysicalTransforms } from './physical-roll-planner';

export interface PhysicalVisualBounds {
  x: number;
  z: number;
}

interface RecordedTrajectory {
  positions: Float32Array;
  quaternions: Float32Array;
  frameCount: number;
  step: number;
}

const MAXIMUM_EXACT_GENERATED_SIDES = 256;
const activePhysicalDice = new Set<PhysicalDieVisualInstance>();
const pendingPhysicalDice = new Set<PhysicalDieVisualInstance>();
let plannedPhysicalDice: PhysicalDieVisualInstance[] = [];
let lastPhysicalFallbackReplay: PhysicalFallbackReplay | null = null;

export function numericPhysicalSides(spec: DraftrollFallbackVisual): number | null {
  if (Number.isSafeInteger(spec.sides) && (spec.sides ?? 0) >= 1) return spec.sides!;
  const match = /^d(\d+)$/i.exec(spec.type);
  const sides = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(sides) && sides >= 1 ? sides : null;
}

/** Transitional browser-storage check for an exact arbitrary physical die. */
export function usesPhysicalDieModel(spec: DraftrollFallbackVisual): boolean {
  if (spec.kind !== 'spinner') return false;
  const sides = numericPhysicalSides(spec);
  return sides !== null && sides <= MAXIMUM_EXACT_GENERATED_SIDES;
}

function requestedOutcomeIndex(spec: DraftrollFallbackVisual, sides: number): number {
  const explicit = spec.metadata?.draftrollPhysicalOutcomeIndex;
  if (Number.isSafeInteger(explicit) && Number(explicit) >= 0 && Number(explicit) < sides) {
    return Number(explicit);
  }
  const raw = typeof spec.result === 'number' ? spec.result : Number(spec.numericValue);
  const value = Number.isFinite(raw) ? THREE.MathUtils.clamp(Math.round(raw), 1, sides) : 1;
  return value - 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parsePhysicalFaceContent(value: unknown): PhysicalDieFaceContent | null {
  if (!isRecord(value)) return null;
  const label = typeof value.label === 'string' ? value.label : undefined;
  if (value.kind === 'number' && typeof value.value === 'number' && Number.isFinite(value.value)) {
    return { kind: 'number', value: value.value, label };
  }
  if (value.kind === 'text' && typeof value.text === 'string') {
    return { kind: 'text', text: value.text };
  }
  if (value.kind === 'icon' && typeof value.icon === 'string') {
    return { kind: 'icon', icon: value.icon, label };
  }
  if (value.kind === 'texture' && typeof value.asset === 'string') {
    return { kind: 'texture', asset: value.asset, label };
  }
  return null;
}

function readPhysicalPresentation(
  spec: DraftrollFallbackVisual,
  definition: PhysicalDieDefinition,
): { presentation: PhysicalDiePresentation; explicit: boolean } {
  const raw = spec.metadata?.draftrollPhysicalPresentation;
  if (isRecord(raw) && Array.isArray(raw.contents)) {
    const contents = raw.contents.map(parsePhysicalFaceContent);
    if (contents.length === definition.outcomes.length && contents.every(Boolean)) {
      return {
        presentation: createPhysicalDiePresentation(
          definition,
          contents.filter((content): content is PhysicalDieFaceContent => content !== null),
        ),
        explicit: true,
      };
    }
  }
  return { presentation: createDefaultPhysicalDiePresentation(definition), explicit: false };
}

function sample(
  trajectory: RecordedTrajectory,
  progress: number,
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
): void {
  const scaled = THREE.MathUtils.clamp(progress, 0, 1) * Math.max(0, trajectory.frameCount - 1);
  const first = Math.floor(scaled);
  const second = Math.min(trajectory.frameCount - 1, first + 1);
  const blend = scaled - first;
  const firstPosition = first * 3;
  const secondPosition = second * 3;
  position.set(
    THREE.MathUtils.lerp(
      trajectory.positions[firstPosition],
      trajectory.positions[secondPosition],
      blend,
    ),
    THREE.MathUtils.lerp(
      trajectory.positions[firstPosition + 1],
      trajectory.positions[secondPosition + 1],
      blend,
    ),
    THREE.MathUtils.lerp(
      trajectory.positions[firstPosition + 2],
      trajectory.positions[secondPosition + 2],
      blend,
    ),
  );
  const firstQuaternion = first * 4;
  const secondQuaternion = second * 4;
  quaternion
    .set(
      trajectory.quaternions[firstQuaternion],
      trajectory.quaternions[firstQuaternion + 1],
      trajectory.quaternions[firstQuaternion + 2],
      trajectory.quaternions[firstQuaternion + 3],
    )
    .slerp(
      new THREE.Quaternion(
        trajectory.quaternions[secondQuaternion],
        trajectory.quaternions[secondQuaternion + 1],
        trajectory.quaternions[secondQuaternion + 2],
        trajectory.quaternions[secondQuaternion + 3],
      ),
      blend,
    );
}

function trajectoryForIndex(
  transforms: Float32Array,
  frameCount: number,
  step: number,
  count: number,
  index: number,
): RecordedTrajectory {
  const single = extractPhysicalTransforms(transforms, frameCount, count, index, 1);
  const positions = new Float32Array(frameCount * 3);
  const quaternions = new Float32Array(frameCount * 4);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const source = frame * 7;
    positions.set(single.subarray(source, source + 3), frame * 3);
    quaternions.set(single.subarray(source + 3, source + 7), frame * 4);
  }
  return { positions, quaternions, frameCount, step };
}

function commitAdditionalTrajectories(
  transforms: Float32Array,
  frameCount: number,
  step: number,
  entries: readonly PhysicalDieVisualInstance[],
  landings: Int32Array,
): void {
  entries.forEach((entry, index) => {
    entry.commitTrajectory(
      trajectoryForIndex(transforms, frameCount, step, entries.length, index),
      landings[index] ?? 0,
    );
  });
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
  readonly spec: DraftrollFallbackVisual;
  readonly definition: PhysicalDieDefinition;
  readonly sides: number;
  bounds: PhysicalVisualBounds = { x: 5, z: 5 };
  launchState: number[] = [];
  configured = false;

  private readonly mesh: PhysicalDieMesh;
  private readonly inner: THREE.Group;
  private readonly labelMaterials: THREE.MeshBasicMaterial[];
  private readonly originalLabelMaps: Array<THREE.Texture | null>;
  private readonly requestedOutcome: number;
  private trajectory: RecordedTrajectory | null = null;
  private end = new THREE.Vector2();
  private settled = false;
  private needsPlanning = false;
  private lastProgress = 0;
  private presented = false;

  constructor(spec: DraftrollFallbackVisual) {
    this.spec = spec;
    const sides = numericPhysicalSides(spec);
    if (sides === null) throw new Error(`Physical numeric die requires sides: ${spec.type}`);
    this.sides = sides;
    this.definition = createGeneratedPhysicalDieDefinition(sides);
    const resolvedPresentation = readPhysicalPresentation(spec, this.definition);
    this.requestedOutcome = requestedOutcomeIndex(spec, sides);
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
    activePhysicalDice.add(this);
  }

  get hasTrajectory(): boolean {
    return this.trajectory !== null;
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

  assignLaunchState(state: PhysicalLaunchState): void {
    if (!this.needsPlanning) return;
    this.launchState = serializeLaunchState(state);
    this.end.set(state.target[0], state.target[1]);
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

    if (!this.settled && this.lastProgress < 0.995 && this.trajectory.frameCount > 1) {
      const scaled = this.lastProgress * (this.trajectory.frameCount - 1);
      let first = Math.floor(scaled);
      let second = Math.min(this.trajectory.frameCount - 1, first + 1);
      if (first === second && first > 0) {
        first -= 1;
        second = first + 1;
      }
      const dt = Math.max(1e-6, (second - first) * this.trajectory.step);
      const a = first * 3;
      const b = second * 3;
      velocityX = (this.trajectory.positions[b] - this.trajectory.positions[a]) / dt;
      velocityY = (this.trajectory.positions[b + 1] - this.trajectory.positions[a + 1]) / dt;
      velocityZ = (this.trajectory.positions[b + 2] - this.trajectory.positions[a + 2]) / dt;
      const qa = first * 4;
      const qb = second * 4;
      const before = new THREE.Quaternion(
        this.trajectory.quaternions[qa],
        this.trajectory.quaternions[qa + 1],
        this.trajectory.quaternions[qa + 2],
        this.trajectory.quaternions[qa + 3],
      );
      const after = new THREE.Quaternion(
        this.trajectory.quaternions[qb],
        this.trajectory.quaternions[qb + 1],
        this.trajectory.quaternions[qb + 2],
        this.trajectory.quaternions[qb + 3],
      );
      const delta = after.multiply(before.invert()).normalize();
      if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
      const halfSin = Math.hypot(delta.x, delta.y, delta.z);
      if (halfSin > 1e-6) {
        const angle = 2 * Math.atan2(halfSin, THREE.MathUtils.clamp(delta.w, -1, 1));
        const speed = Math.min(28, angle / dt);
        angularX = (delta.x / halfSin) * speed;
        angularY = (delta.y / halfSin) * speed;
        angularZ = (delta.z / halfSin) * speed;
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

  commitTrajectory(trajectory: RecordedTrajectory, landed: number): void {
    const newlyIntroduced = this.needsPlanning;
    if (newlyIntroduced) this.applyRequestedResult(landed);
    this.trajectory = trajectory;
    this.needsPlanning = false;
    pendingPhysicalDice.delete(this);
    this.lastProgress = 0;
    const last = Math.max(0, trajectory.frameCount - 1) * 3;
    this.end.set(trajectory.positions[last] ?? 0, trajectory.positions[last + 2] ?? 0);
    this.settled = false;
    sample(trajectory, 0, this.group.position, this.inner.quaternion);
    this.mesh.updateShadow(this.group.position.y, 0);
  }

  configureTrajectory(
    _index: number,
    _count: number,
    bounds: PhysicalVisualBounds,
    _random: () => number,
    _occupied: THREE.Vector2[] = [],
  ): void {
    this.bounds = { ...bounds };
    this.launchState = [];
    this.configured = true;
    this.trajectory = null;
    this.needsPlanning = true;
    pendingPhysicalDice.add(this);
    this.lastProgress = 0;
    this.settled = false;
    this.presented = false;
    this.group.visible = false;
    this.mesh.setOpacity(0);
    this.mesh.updateShadow(this.group.position.y, 0);
  }

  update(progress: number, _duration = 1): void {
    if (this.settled || !this.trajectory) return;
    const normalized = THREE.MathUtils.clamp(progress, 0, 1);
    this.lastProgress = normalized;
    const wasPresented = this.presented;
    if (normalized > 0) this.presented = true;
    this.group.visible = this.presented;
    if (!this.presented) return;
    sample(this.trajectory, normalized, this.group.position, this.inner.quaternion);
    const opacity = wasPresented ? 1 : THREE.MathUtils.clamp(normalized * 7, 0, 1);
    this.mesh.setOpacity(opacity);
    this.mesh.updateShadow(this.group.position.y, opacity);
  }

  settle(): void {
    if (this.settled) return;
    this.update(1, 1);
    this.lastProgress = 1;
    this.presented = true;
    this.group.visible = true;
    this.mesh.setOpacity(1);
    this.mesh.updateShadow(this.group.position.y, 1);
    this.settled = true;
  }

  getWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.group.getWorldPosition(target);
  }

  getSettledPosition(target = new THREE.Vector2()): THREE.Vector2 {
    return target.copy(this.end);
  }

  getSettleTime(duration: number): number {
    return duration;
  }

  dispose(): void {
    activePhysicalDice.delete(this);
    pendingPhysicalDice.delete(this);
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

export interface PhysicalFallbackPlanEntry {
  definition: PhysicalDieDefinition;
  state: number[];
}

/** Recorded arbitrary-physical-die transforms retained alongside a legacy replay. */
export interface PhysicalFallbackReplay {
  ids: string[];
  step: number;
  frameCount: number;
  transforms: Float32Array;
  landings: Int32Array;
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

/** True when at least one arbitrary numeric die is participating in the physical table. */
export function hasConfiguredPhysicalFallbackDice(): boolean {
  return configuredPhysicalDice().length > 0;
}

/** True when a newly configured arbitrary die still needs a committed physical trajectory. */
export function hasPendingPhysicalFallbackDice(): boolean {
  return pendingPhysicalDice.size > 0;
}

/**
 * Captures the arbitrary physical entries that main.ts appends to the normal roll-worker request.
 * This is an explicit compatibility boundary; no Worker prototype interception is involved.
 */
export function getPhysicalFallbackPlanEntries(): PhysicalFallbackPlanEntry[] {
  plannedPhysicalDice = configuredPhysicalDice();
  return plannedPhysicalDice.map((entry) => ({
    definition: entry.definition,
    state: entry.plannerState(),
  }));
}

/** Commits the additional trajectories returned by the one shared physical roll worker. */
export function commitPhysicalFallbackPlan(
  transforms: Float32Array,
  frameCount: number,
  step: number,
  landings: Int32Array,
): void {
  const entries = plannedPhysicalDice.length > 0 ? plannedPhysicalDice : configuredPhysicalDice();
  plannedPhysicalDice = [];
  if (entries.length === 0) {
    lastPhysicalFallbackReplay = null;
    return;
  }
  const expected = frameCount * entries.length * 7;
  if (frameCount < 1 || transforms.length !== expected || landings.length !== entries.length) {
    throw new Error('Physical fallback trajectory buffers do not match the planned dice.');
  }
  commitAdditionalTrajectories(transforms, frameCount, step, entries, landings);
  lastPhysicalFallbackReplay = {
    ids: entries.map((entry) => entry.spec.id),
    step,
    frameCount,
    transforms: transforms.slice(),
    landings: landings.slice(),
  };
}

export function capturePhysicalFallbackReplay(): PhysicalFallbackReplay | undefined {
  const replay = lastPhysicalFallbackReplay;
  return replay
    ? {
        ids: replay.ids.slice(),
        step: replay.step,
        frameCount: replay.frameCount,
        transforms: replay.transforms.slice(),
        landings: replay.landings.slice(),
      }
    : undefined;
}

/** Restores arbitrary physical trajectories without re-running physics during replay. */
export function restorePhysicalFallbackReplay(replay: PhysicalFallbackReplay): void {
  const entries = new Map(configuredPhysicalDice().map((entry) => [entry.spec.id, entry] as const));
  if (replay.ids.length !== replay.landings.length) {
    throw new Error('Physical fallback replay landing data is invalid.');
  }
  const expected = replay.frameCount * replay.ids.length * 7;
  if (replay.frameCount < 1 || replay.transforms.length !== expected) {
    throw new Error('Physical fallback replay transform data is invalid.');
  }
  replay.ids.forEach((id, index) => {
    const entry = entries.get(id);
    if (!entry) throw new Error(`Physical fallback replay die is missing: ${id}`);
    entry.commitTrajectory(
      trajectoryForIndex(
        replay.transforms,
        replay.frameCount,
        replay.step,
        replay.ids.length,
        index,
      ),
      replay.landings[index] ?? 0,
    );
  });
  lastPhysicalFallbackReplay = {
    ids: replay.ids.slice(),
    step: replay.step,
    frameCount: replay.frameCount,
    transforms: replay.transforms.slice(),
    landings: replay.landings.slice(),
  };
}
