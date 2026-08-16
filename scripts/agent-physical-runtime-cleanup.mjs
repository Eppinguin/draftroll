import { readFile, writeFile } from 'node:fs/promises';

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return source.replace(before, after);
}

function removeRange(source, start, end, label) {
  const from = source.indexOf(start);
  if (from < 0) throw new Error(`Missing migration start: ${label}`);
  const to = source.indexOf(end, from + start.length);
  if (to < 0) throw new Error(`Missing migration end: ${label}`);
  return source.slice(0, from) + end + source.slice(to + end.length);
}

const physicalVisuals = `import * as THREE from 'three';
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
  const match = /^d(\\d+)$/i.exec(spec.type);
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
    THREE.MathUtils.lerp(trajectory.positions[firstPosition], trajectory.positions[secondPosition], blend),
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
    if (sides === null) throw new Error(\`Physical numeric die requires sides: \${spec.type}\`);
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
        throw new Error(\`Physical die \${this.spec.id} has not been assigned a launch state.\`);
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
  const states = new Map(assignments.map((assignment) => [assignment.id, assignment.state] as const));
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
    if (!entry) throw new Error(\`Physical fallback replay die is missing: \${id}\`);
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
`;
await writeFile(new URL('../src/physical-die-visuals.ts', import.meta.url), physicalVisuals);

let fallback = await readFile(new URL('../src/fallback-visuals-base.ts', import.meta.url), 'utf8');
fallback = replaceOnce(
  fallback,
  `import {\n  createReadablePolyhedron,\n  type PolyhedronLabelAnchor,\n  type PolyhedronOutcome,\n  type ReadablePolyhedron,\n} from '../packages/renderer/src/polyhedra';\n`,
  ``,
  'remove physical polyhedron imports from fallback renderer',
);
fallback = replaceOnce(
  fallback,
  `type VisualMode = 'sprite' | 'coin' | 'die' | 'card';`,
  `type VisualMode = 'sprite' | 'coin' | 'card';`,
  'fallback visual modes',
);
fallback = removeRange(
  fallback,
  `function createDieSurfaceTexture(spec: DraftrollFallbackVisual): THREE.CanvasTexture {`,
  `function metadataString(spec: DraftrollFallbackVisual, key: string): string | undefined {`,
  'generated surface texture',
);
fallback = removeRange(
  fallback,
  `function triangulateTexturedShape(shape: ReadablePolyhedron): THREE.BufferGeometry {`,
  `function cropCoinTexture(texture: THREE.CanvasTexture): void {`,
  'generated physical mesh builder',
);
fallback = replaceOnce(
  fallback,
  `      spec.kind === 'coin'\n        ? createCoinVisual(this.texture, spec)\n        : spec.kind === 'card'\n          ? createCardVisual(spec)\n          : createGeneratedDieVisual(spec);`,
  `      spec.kind === 'coin'\n        ? createCoinVisual(this.texture, spec)\n        : spec.kind === 'card'\n          ? createCardVisual(spec)\n          : null;`,
  'fallback three dimensional selection',
);
fallback = replaceOnce(
  fallback,
  `        let settledRotation = new THREE.Quaternion().setFromEuler(\n          new THREE.Euler(0.12, trajectory.finalYaw, -0.06),\n        );\n        if (mode === 'die') {\n          const generatedRotation = this.threeDimensional.group.userData.settledRotation;\n          if (generatedRotation instanceof THREE.Quaternion) {\n            settledRotation = new THREE.Quaternion()\n              .setFromAxisAngle(UP, trajectory.finalYaw)\n              .multiply(generatedRotation);\n          }\n        }\n        this.threeDimensional.group.quaternion\n          .copy(moving)\n          .slerp(settledRotation, THREE.MathUtils.smoothstep(normalized, 0.76, 1));`,
  `        const settledRotation = new THREE.Quaternion().setFromEuler(\n          new THREE.Euler(0.12, trajectory.finalYaw, -0.06),\n        );\n        this.threeDimensional.group.quaternion\n          .copy(moving)\n          .slerp(settledRotation, THREE.MathUtils.smoothstep(normalized, 0.76, 1));`,
  'remove generated fallback settle branch',
);
await writeFile(new URL('../src/fallback-visuals-base.ts', import.meta.url), fallback);

let main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
main = replaceOnce(
  main,
  `  capturePhysicalFallbackReplay,\n  commitPhysicalFallbackPlan,\n  getPhysicalFallbackPlanEntries,`,
  `  assignPendingPhysicalLaunchStates,\n  capturePhysicalFallbackReplay,\n  commitPhysicalFallbackPlan,\n  getPendingPhysicalLaunchParticipants,\n  getPhysicalFallbackPlanEntries,`,
  'main physical launch coordinator imports',
);
main = replaceOnce(
  main,
  `} from './physical-die-visuals';\nimport { consumeSettledVisualIndexes, deriveDieSettleTimes } from './settlement';`,
  `} from './physical-die-visuals';\nimport {\n  createPhysicalLaunchStates,\n  type PhysicalLaunchParticipant,\n  type PhysicalLaunchState,\n} from './physical-launch';\nimport { consumeSettledVisualIndexes, deriveDieSettleTimes } from './settlement';`,
  'shared launch import',
);
main = removeRange(main, `interface LaunchSpawn {`, `interface ActiveTableRollGroup {`, 'legacy canonical launch helpers');
main = replaceOnce(
  main,
  `        groupId: typeof entry.groupId === 'string' ? entry.groupId : \`table-roll-\${physicalStart}\`,\n        actorLabel:`,
  `        groupId: typeof entry.groupId === 'string' ? entry.groupId : \`table-roll-\${physicalStart}\`,\n        dieIds: Array.isArray(entry.dieIds)\n          ? entry.dieIds.filter((id): id is string => typeof id === 'string')\n          : undefined,\n        actorLabel:`,
  'read table group ids',
);
const oldLaunchFunctionsStart = `function createLaunchStatesForGroup(`;
const oldLaunchFunctionsEnd = `function cloneDynamicBody(source: CANNON.Body, state: LaunchState): CANNON.Body {`;
const from = main.indexOf(oldLaunchFunctionsStart);
const to = main.indexOf(oldLaunchFunctionsEnd, from);
if (from < 0 || to < 0) throw new Error('Could not locate canonical launch functions');
const newLaunchFunctions = `interface CanonicalLaunchParticipant {\n  die: DieInstance;\n  index: number;\n  id: string;\n}\n\ntype AdditionalLaunchParticipant = ReturnType<typeof getPendingPhysicalLaunchParticipants>[number];\n\nfunction toLaunchState(state: PhysicalLaunchState): LaunchState {\n  return {\n    position: new CANNON.Vec3(...state.position),\n    quaternion: new CANNON.Quaternion(...state.quaternion),\n    velocity: new CANNON.Vec3(...state.velocity),\n    angularVelocity: new CANNON.Vec3(...state.angularVelocity),\n    delay: state.delay,\n  };\n}\n\nfunction createMixedPhysicalLaunchStates(\n  canonical: readonly CanonicalLaunchParticipant[],\n  additional: readonly AdditionalLaunchParticipant[],\n  random: () => number,\n  throwDirection: THREE.Vector2,\n  handBias: number,\n  delayOffset = 0,\n): LaunchState[] {\n  const participants: PhysicalLaunchParticipant[] = [\n    ...canonical.map(({ die, id }) => ({\n      id,\n      radius: DIE_COLLIDER_RADIUS[die.kind],\n      coinLike: die.kind === 'coin',\n    })),\n    ...additional.map((entry) => ({ ...entry })),\n  ];\n  const generated = createPhysicalLaunchStates(participants, {\n    bounds: screenBounds,\n    random,\n    throwDirection,\n    handBias,\n    gravity: PHYSICS_PRESETS[activePhysicsPreset].gravity,\n    delayOffset,\n  });\n  const canonicalStates = generated.slice(0, canonical.length).map(toLaunchState);\n  assignPendingPhysicalLaunchStates(\n    additional.map((entry, index) => ({\n      id: entry.id,\n      state: generated[canonical.length + index],\n    })),\n  );\n  return canonicalStates;\n}\n\nfunction allCanonicalLaunchParticipants(): CanonicalLaunchParticipant[] {\n  return dice.map((die, index) => ({ die, index, id: physicalVisualId(index) }));\n}\n\nfunction createLaunchStates(swipe: THREE.Vector2 | undefined, seed: string): LaunchState[] {\n  const canonical = allCanonicalLaunchParticipants();\n  const additional = getPendingPhysicalLaunchParticipants();\n  const tableRolls = readActiveTableRolls().filter((group) =>\n    group.dieIds?.some((id) =>\n      canonical.some((entry) => entry.id === id) || additional.some((entry) => entry.id === id),\n    ),\n  );\n  if (tableRolls.length > 1 && tableRolls.every((group) => (group.dieIds?.length ?? 0) > 0)) {\n    const states: Array<LaunchState | undefined> = Array.from({ length: canonical.length });\n    let assignedAdditional = 0;\n    for (let groupIndex = 0; groupIndex < tableRolls.length; groupIndex += 1) {\n      const group = tableRolls[groupIndex];\n      const ids = new Set(group.dieIds ?? []);\n      const groupCanonical = canonical.filter((entry) => ids.has(entry.id));\n      const groupAdditional = additional.filter((entry) => ids.has(entry.id));\n      if (groupCanonical.length + groupAdditional.length === 0) continue;\n      const lane = THREE.MathUtils.lerp(-0.82, 0.82, groupIndex / (tableRolls.length - 1));\n      const random = createSeededRandom(\`${seed}:\${group.groupId}\`);\n      const throwDirection = new THREE.Vector2(-lane * 0.28, -1)\n        .normalize()\n        .rotateAround(new THREE.Vector2(), (random() - 0.5) * 0.12);\n      const groupStates = createMixedPhysicalLaunchStates(\n        groupCanonical,\n        groupAdditional,\n        random,\n        throwDirection,\n        lane,\n      );\n      groupCanonical.forEach((entry, index) => {\n        states[entry.index] = groupStates[index];\n      });\n      assignedAdditional += groupAdditional.length;\n    }\n    if (states.every(Boolean) && assignedAdditional === additional.length) {\n      return states.filter((state): state is LaunchState => state !== undefined);\n    }\n  }\n\n  const random = createSeededRandom(seed);\n  const swipeLateral = swipe ? THREE.MathUtils.clamp(swipe.x / 190, -0.78, 0.78) : 0;\n  const swipeForward = swipe ? THREE.MathUtils.clamp(-swipe.y / 260, -0.3, 0.72) : 0;\n  const total = canonical.length + additional.length;\n  const naturalYaw = (random() - 0.5) * (total > 12 ? 0.15 : 0.22);\n  const throwDirection = new THREE.Vector2(swipeLateral * 0.62, -1 + swipeForward * 0.13)\n    .normalize()\n    .rotateAround(new THREE.Vector2(), naturalYaw);\n  const handBias = swipeLateral * 0.48 + (random() - 0.5) * 0.12;\n  return createMixedPhysicalLaunchStates(canonical, additional, random, throwDirection, handBias);\n}\n\n`;
main = main.slice(0, from) + newLaunchFunctions + main.slice(to);
main = replaceOnce(
  main,
  `    const newStates = createLaunchStatesForGroup(appended, random, direction, lane);\n    const scheduledDelay =\n      normalized.startAtMs === null ? 0 : Math.max(0, (normalized.startAtMs - Date.now()) / 1_000);\n    newStates.forEach((state) => {\n      state.delay += scheduledDelay;\n    });`,
  `    const scheduledDelay =\n      normalized.startAtMs === null ? 0 : Math.max(0, (normalized.startAtMs - Date.now()) / 1_000);\n    const appendedCanonical = appended.map((die, index) => ({\n      die,\n      index: existingCount + index,\n      id: physicalVisualId(existingCount + index),\n    }));\n    const newStates = createMixedPhysicalLaunchStates(\n      appendedCanonical,\n      getPendingPhysicalLaunchParticipants(),\n      random,\n      direction,\n      lane,\n      scheduledDelay,\n    );`,
  'additive mixed launch generation',
);
main = replaceOnce(
  main,
  `    const states = quantity > 0 ? createLaunchStates(swipe, activeSeed) : [];`,
  `    const states = createLaunchStates(swipe, activeSeed);`,
  'generated-only shared launch generation',
);
await writeFile(new URL('../src/main.ts', import.meta.url), main);

let natural = await readFile(new URL('./test-natural-target-physics.mjs', import.meta.url), 'utf8');
natural = replaceOnce(
  natural,
  `const main = await readFile(join(root, 'src/main.ts'), 'utf8');`,
  `const main = await readFile(join(root, 'src/main.ts'), 'utf8');\nconst launch = await readFile(join(root, 'src/physical-launch.ts'), 'utf8');`,
  'natural physics reads shared launch module',
);
natural = replaceOnce(
  natural,
  `assert.match(main, /die\\.kind === 'coin'[\\s\\S]*?rollingX \\* 1\\.22/);`,
  `assert.match(launch, /participant\\.coinLike[\\s\\S]*?rollingX \\* 1\\.22/);`,
  'coin launch assertion',
);
natural = replaceOnce(
  natural,
  `/newStates\\.length > 0[\\s\\S]*?buildRollPlan\\(\\[\\.\\.\\.existingStates, \\.\\.\\.newStates\\], existingCount, lockedTrajectory\\)[\\s\\S]*?createStaticTablePlan/`,
  `/needsSharedPhysicalPlan[\\s\\S]*?buildRollPlan\\(\\[\\.\\.\\.existingStates, \\.\\.\\.newStates\\], existingCount, lockedTrajectory\\)[\\s\\S]*?createStaticTablePlan/`,
  'additive shared planner assertion',
);
natural = replaceOnce(
  natural,
  `        'physical d2 cylinder with coin-specific exact-result symmetry and launch flip',`,
  `        'physical d2 cylinder with coin-specific exact-result symmetry and launch flip',\n        'canonical and generated dice share one hand-launch generator',`,
  'natural output shared launch',
);
await writeFile(new URL('./test-natural-target-physics.mjs', import.meta.url), natural);

let large = await readFile(new URL('./test-large-pool-physics.mjs', import.meta.url), 'utf8');
large = replaceOnce(
  large,
  `const main = await readFile(join(root, 'src/main.ts'), 'utf8');`,
  `const main = await readFile(join(root, 'src/main.ts'), 'utf8');\nconst launch = await readFile(join(root, 'src/physical-launch.ts'), 'utf8');`,
  'large pool reads launch module',
);
large = replaceOnce(large, `assert.match(main, /const largePool = count >= 12/);`, `assert.match(launch, /const largePool = participants\\.length >= 12/);`, 'large pool threshold');
large = replaceOnce(large, `assert.match(main, /two-handed pour/);`, `assert.match(launch, /waveSize = count >= 24/);`, 'large pool shared pour');
large = replaceOnce(large, `assert.match(main, /releaseDelay: number/);`, `assert.match(launch, /releaseDelay: number/);`, 'release delay module');
large = replaceOnce(large, `assert.match(main, /waveInterval/);`, `assert.match(launch, /waveInterval/);`, 'wave interval module');
large = replaceOnce(large, `assert.match(main, /spawn\\.releaseDelay \\+\\s*releaseWindow/);`, `assert.match(launch, /spawn\\.releaseDelay \\+\\s*releaseWindow/);`, 'release window module');
large = replaceOnce(
  large,
  `        'large-pool staged pour release',`,
  `        'large-pool staged pour release',\n        'canonical and generated dice use the same radius-aware hand packing',`,
  'large pool output shared launch',
);
await writeFile(new URL('./test-large-pool-physics.mjs', import.meta.url), large);

let smoke = await readFile(new URL('./test-visual-fallbacks.mjs', import.meta.url), 'utf8');
smoke = replaceOnce(
  smoke,
  `const physicalVisuals = await readFile(join(root, 'src/physical-die-visuals.ts'), 'utf8');`,
  `const physicalVisuals = await readFile(join(root, 'src/physical-die-visuals.ts'), 'utf8');\nconst physicalMesh = await readFile(join(root, 'src/physical-die-mesh.ts'), 'utf8');\nconst physicalLaunch = await readFile(join(root, 'src/physical-launch.ts'), 'utf8');`,
  'smoke reads physical mesh and launch',
);
smoke = replaceOnce(
  smoke,
  `assert.match(physicalVisuals, /getRuntimeThemeMaterial/);\nassert.match(physicalVisuals, /getRuntimeThemeMesh/);`,
  `assert.match(physicalMesh, /getRuntimeThemeMaterial/);\nassert.match(physicalMesh, /getRuntimeThemeMesh/);\nassert.match(physicalMesh, /createPhysicalDieMesh/);\nassert.match(physicalMesh, /updateShadow/);\nassert.doesNotMatch(physicalVisuals, /BaseFallbackVisualInstance/);\nassert.doesNotMatch(physicalVisuals, /fallback-visuals-base/);\nassert.match(physicalLaunch, /createPhysicalLaunchStates/);\nassert.match(physicalLaunch, /participant\\.radius/);`,
  'smoke first-class physical rendering',
);
smoke = replaceOnce(
  smoke,
  `assert.doesNotMatch(physicalVisuals, /new CANNON\\.World/);`,
  `assert.doesNotMatch(physicalVisuals, /new CANNON\\.World/);\nassert.doesNotMatch(fallbackVisuals, /createGeneratedDieVisual/);\nassert.doesNotMatch(fallbackVisuals, /createReadablePolyhedron/);`,
  'fallback renderer contains no physical mesh code',
);
smoke = replaceOnce(
  smoke,
  `      arbitraryThemeMeshes: true,`,
  `      arbitraryThemeMeshes: true,\n      firstClassPhysicalMeshBuilder: true,\n      sharedCanonicalGeneratedLaunch: true,\n      fallbackRendererContainsNoDice: true,`,
  'smoke output runtime cleanup',
);
await writeFile(new URL('./test-visual-fallbacks.mjs', import.meta.url), smoke);

console.log('First-class physical runtime cleanup applied.');
