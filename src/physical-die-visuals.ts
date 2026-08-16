import * as THREE from 'three';
import { FallbackVisualInstance as BaseFallbackVisualInstance } from './fallback-visuals-base';
import type { DraftrollFallbackVisual } from '../packages/renderer/src/index';
import type { PolyhedronLabelAnchor, ReadablePolyhedron } from '../packages/renderer/src/polyhedra';
import {
  createDefaultPhysicalDiePresentation,
  createGeneratedPhysicalDieDefinition,
  physicalDieColliderRadius,
  remapPhysicalDiePresentation,
  type PhysicalDieDefinition,
  type PhysicalDiePresentation,
} from './physical-dice';
import { extractPhysicalTransforms } from './physical-roll-planner';
import { getRuntimeThemeMaterial, getRuntimeThemeTexture } from './runtime-themes';

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
const LABEL_ATLAS_COLUMNS = 5;
const LABEL_ATLAS_ROWS = 4;
const LABEL_ATLAS_PADDING = 0.055;
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

/** True when a renderer fallback is really an exact physical numeric die. */
export function usesPhysicalDieModel(spec: DraftrollFallbackVisual): boolean {
  if (spec.kind !== 'spinner') return false;
  const sides = numericPhysicalSides(spec);
  return sides !== null && sides <= MAXIMUM_EXACT_GENERATED_SIDES;
}

function resultOf(spec: DraftrollFallbackVisual, sides: number): number {
  const raw = typeof spec.result === 'number' ? spec.result : Number(spec.numericValue);
  return Number.isFinite(raw) ? THREE.MathUtils.clamp(Math.round(raw), 1, sides) : 1;
}

function faceNormal(shape: ReadablePolyhedron, faceIndex: number): THREE.Vector3 {
  const face = shape.faces[faceIndex];
  const points = face.map((index) => new THREE.Vector3(...shape.vertices[index]));
  const normal = new THREE.Vector3()
    .crossVectors(points[1].clone().sub(points[0]), points[2].clone().sub(points[0]))
    .normalize();
  const center = points
    .reduce((sum, point) => sum.add(point), new THREE.Vector3())
    .multiplyScalar(1 / points.length);
  if (normal.dot(center) < 0) normal.negate();
  return normal;
}

function secondaryAnchor(shape: ReadablePolyhedron, faceIndex: number): PolyhedronLabelAnchor {
  const face = shape.faces[faceIndex];
  const points = face.map((index) => new THREE.Vector3(...shape.vertices[index]));
  const center = points
    .reduce((sum, point) => sum.add(point), new THREE.Vector3())
    .multiplyScalar(1 / points.length);
  const normal = faceNormal(shape, faceIndex);
  let span = 0;
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      span = Math.max(span, points[first].distanceTo(points[second]));
    }
  }
  const reference =
    Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const up = reference.projectOnPlane(normal).normalize();
  return {
    kind: 'face',
    faceIndex,
    position: [center.x, center.y, center.z],
    normal: [normal.x, normal.y, normal.z],
    up: [up.x, up.y, up.z],
    scale: THREE.MathUtils.clamp(span * 0.24, 0.13, 0.3),
  };
}

function anchorQuaternion(anchor: PolyhedronLabelAnchor): THREE.Quaternion {
  const normal = new THREE.Vector3(...anchor.normal).normalize();
  const up = new THREE.Vector3(...anchor.up).projectOnPlane(normal).normalize();
  const right = new THREE.Vector3().crossVectors(up, normal).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(right, up, normal),
  );
}

function atlasCellTexture(atlas: THREE.Texture, value: number): THREE.Texture {
  const clamped = THREE.MathUtils.clamp(Math.round(value), 1, 20);
  const cell = clamped - 1;
  const column = cell % LABEL_ATLAS_COLUMNS;
  const row = Math.floor(cell / LABEL_ATLAS_COLUMNS);
  const padU = LABEL_ATLAS_PADDING / LABEL_ATLAS_COLUMNS;
  const padV = LABEL_ATLAS_PADDING / LABEL_ATLAS_ROWS;
  const u0 = column / LABEL_ATLAS_COLUMNS + padU;
  const u1 = (column + 1) / LABEL_ATLAS_COLUMNS - padU;
  const v0 = 1 - (row + 1) / LABEL_ATLAS_ROWS + padV;
  const v1 = 1 - row / LABEL_ATLAS_ROWS - padV;
  const texture = atlas.clone();
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.offset.set(u0, v0);
  texture.repeat.set(u1 - u0, v1 - v0);
  texture.needsUpdate = true;
  return texture;
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

function targetPosition(
  count: number,
  bounds: PhysicalVisualBounds,
  occupied: readonly THREE.Vector2[],
  random: () => number,
): THREE.Vector2 {
  const rangeX = Math.max(0.2, bounds.x - 1.05);
  const rangeZ = Math.max(0.2, bounds.z - 1.05);
  const separation = count <= 12 ? 1.8 : count <= 20 ? 1.5 : 1.25;
  let best = new THREE.Vector2();
  let bestDistance = -1;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const candidate = new THREE.Vector2((random() * 2 - 1) * rangeX, (random() * 2 - 1) * rangeZ);
    const nearest = occupied.reduce(
      (value, point) => Math.min(value, candidate.distanceTo(point)),
      Number.POSITIVE_INFINITY,
    );
    if (nearest >= separation) return candidate;
    if (nearest > bestDistance) {
      bestDistance = nearest;
      best = candidate;
    }
  }
  return best;
}

function buildLaunchState(
  definition: PhysicalDieDefinition,
  index: number,
  count: number,
  bounds: PhysicalVisualBounds,
  target: THREE.Vector2,
  random: () => number,
): number[] {
  const radius = Math.max(0.25, physicalDieColliderRadius(definition));
  const lane = count <= 1 ? 0 : THREE.MathUtils.lerp(-0.9, 0.9, index / Math.max(1, count - 1));
  const startX = THREE.MathUtils.clamp(
    lane * Math.min(2.2, bounds.x * 0.42) + (random() - 0.5) * 0.34,
    -bounds.x + radius + 0.32,
    bounds.x - radius - 0.32,
  );
  const startZ = bounds.z - radius - 0.35 - (index % 3) * 0.12;
  const startY = radius * 1.5 + 1.35 + (index % 4) * 0.18 + random() * 0.55;
  const flightTime = 0.58 + random() * 0.14;
  const velocityX = (target.x - startX) / flightTime + (random() - 0.5) * 0.75;
  const velocityZ = (target.y - startZ) / flightTime + (random() - 0.5) * 0.6;
  const velocityY = 1.65 + random() * 1.35;
  const rotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(random() * Math.PI * 2, random() * Math.PI * 2, random() * Math.PI * 2),
  );
  const axis = new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
  if (axis.lengthSq() < 1e-6) axis.set(1, 0.4, 0.2);
  axis.normalize();
  const rollingX = velocityZ / radius;
  const rollingZ = -velocityX / radius;
  const spin = 4.5 + random() * 5.5;
  const angularX = rollingX * 0.72 + axis.x * spin;
  const angularY = axis.y * spin + (random() - 0.5) * 2.5;
  const angularZ = rollingZ * 0.72 + axis.z * spin;
  const delay = Math.min(0.13, index * 0.018 + random() * 0.018);
  return [
    startX,
    startY,
    startZ,
    rotation.x,
    rotation.y,
    rotation.z,
    rotation.w,
    velocityX,
    velocityY,
    velocityZ,
    angularX,
    angularY,
    angularZ,
    delay,
  ];
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

export class PhysicalDieVisualInstance {
  readonly group: THREE.Group;
  readonly spec: DraftrollFallbackVisual;
  readonly definition: PhysicalDieDefinition;
  readonly sides: number;
  bounds: PhysicalVisualBounds = { x: 5, z: 5 };
  launchState: number[] = [];
  configured = false;

  private readonly base: BaseFallbackVisualInstance;
  private readonly inner: THREE.Group;
  private readonly labelMaterials: THREE.MeshBasicMaterial[];
  private readonly originalLabelMaps: Array<THREE.Texture | null>;
  private readonly ownedLabelTextures: THREE.Texture[] = [];
  private readonly extraGeometries: THREE.BufferGeometry[] = [];
  private readonly defaultPresentation: PhysicalDiePresentation;
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
    this.defaultPresentation = createDefaultPhysicalDiePresentation(this.definition);
    this.base = new BaseFallbackVisualInstance(spec);
    this.group = this.base.group;
    const inner = this.group.children[0];
    if (!(inner instanceof THREE.Group)) throw new Error('Physical die visual group is missing.');
    this.inner = inner;

    const body = inner.children[0];
    if (body instanceof THREE.Mesh && body.material instanceof THREE.MeshPhysicalMaterial) {
      const runtimeMaterial = getRuntimeThemeMaterial(spec.theme, spec.type);
      const surface = getRuntimeThemeTexture(spec.theme, spec.type, 'surface');
      const normal = getRuntimeThemeTexture(spec.theme, spec.type, 'normal');
      const roughness = getRuntimeThemeTexture(spec.theme, spec.type, 'roughness');
      if (surface) body.material.map = surface;
      if (normal) body.material.normalMap = normal;
      if (roughness) body.material.roughnessMap = roughness;
      if (runtimeMaterial?.color !== undefined) body.material.color.set(runtimeMaterial.color);
      if (runtimeMaterial?.emissive !== undefined)
        body.material.emissive.set(runtimeMaterial.emissive);
      if (runtimeMaterial?.emissiveIntensity !== undefined) {
        body.material.emissiveIntensity = runtimeMaterial.emissiveIntensity;
      }
      if (runtimeMaterial?.roughness !== undefined)
        body.material.roughness = runtimeMaterial.roughness;
      if (runtimeMaterial?.metalness !== undefined)
        body.material.metalness = runtimeMaterial.metalness;
      if (runtimeMaterial?.clearcoat !== undefined)
        body.material.clearcoat = runtimeMaterial.clearcoat;
      if (runtimeMaterial?.clearcoatRoughness !== undefined) {
        body.material.clearcoatRoughness = runtimeMaterial.clearcoatRoughness;
      }
      body.material.needsUpdate = true;
    }

    const labelMeshes = inner.children
      .slice(2)
      .filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    let cursor = 0;
    this.labelMaterials = this.definition.outcomes.map((outcome) => {
      const mesh = labelMeshes[cursor];
      cursor += outcome.labelAnchors.length;
      if (!(mesh?.material instanceof THREE.MeshBasicMaterial)) {
        throw new Error('Physical die label material is missing.');
      }
      return mesh.material;
    });

    const runtimeAtlas =
      getRuntimeThemeTexture(spec.theme, spec.type, 'label') ??
      getRuntimeThemeTexture(spec.theme, `d${sides}`, 'label');
    if (runtimeAtlas && sides <= 20) {
      this.originalLabelMaps = this.definition.outcomes.map((outcome) => {
        const texture = atlasCellTexture(runtimeAtlas, outcome.value);
        this.ownedLabelTextures.push(texture);
        return texture;
      });
      this.labelMaterials.forEach((material, index) => {
        material.map = this.originalLabelMaps[index] ?? null;
        material.needsUpdate = true;
      });
    } else {
      this.originalLabelMaps = this.labelMaterials.map((material) => material.map);
    }

    const shape = this.definition.readableShape;
    if (!shape) throw new Error('Generated physical die is missing readable geometry.');
    const covered = new Set(
      this.definition.outcomes.flatMap((outcome) =>
        outcome.labelAnchors.map((anchor) => anchor.faceIndex),
      ),
    );
    for (let faceIndex = 0; faceIndex < shape.faces.length; faceIndex += 1) {
      if (covered.has(faceIndex)) continue;
      const normal = faceNormal(shape, faceIndex);
      const outcomeIndex = shape.outcomes
        .map((outcome, index) => ({
          index,
          score: normal.dot(new THREE.Vector3(...outcome.settledUp)),
        }))
        .toSorted((left, right) => right.score - left.score)[0]?.index;
      if (outcomeIndex === undefined) continue;
      const anchor = secondaryAnchor(shape, faceIndex);
      const geometry = new THREE.PlaneGeometry(anchor.scale, anchor.scale);
      const mesh = new THREE.Mesh(geometry, this.labelMaterials[outcomeIndex]);
      mesh.position
        .fromArray(anchor.position)
        .addScaledVector(new THREE.Vector3(...anchor.normal), 0.014);
      mesh.quaternion.copy(anchorQuaternion(anchor));
      mesh.renderOrder = 7;
      inner.add(mesh);
      this.extraGeometries.push(geometry);
    }
    activePhysicalDice.add(this);
  }

  get hasTrajectory(): boolean {
    return this.trajectory !== null;
  }

  get requiresPlanning(): boolean {
    return this.needsPlanning;
  }

  private applyRequestedResult(landed: number): void {
    const requested = resultOf(this.spec, this.sides);
    const remapped = remapPhysicalDiePresentation(
      this.definition,
      this.defaultPresentation,
      requested,
      landed,
    );
    remapped.contents.forEach((content, targetIndex) => {
      const sourceIndex =
        content.kind === 'number'
          ? this.definition.outcomes.findIndex((outcome) => outcome.value === content.value)
          : targetIndex;
      const material = this.labelMaterials[targetIndex];
      if (!material) return;
      material.map = this.originalLabelMaps[sourceIndex >= 0 ? sourceIndex : targetIndex] ?? null;
      material.needsUpdate = true;
    });
  }

  plannerState(): number[] {
    if (this.needsPlanning || !this.trajectory) return [...this.launchState];
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
  }

  configureTrajectory(
    index: number,
    count: number,
    bounds: PhysicalVisualBounds,
    random: () => number,
    occupied: THREE.Vector2[] = [],
  ): void {
    this.bounds = { ...bounds };
    this.end = targetPosition(count, bounds, occupied, random);
    occupied.push(this.end.clone());
    this.launchState = buildLaunchState(this.definition, index, count, bounds, this.end, random);
    this.configured = true;
    this.trajectory = null;
    this.needsPlanning = true;
    pendingPhysicalDice.add(this);
    this.lastProgress = 0;
    this.settled = false;
    this.presented = false;
    this.group.position.set(this.launchState[0], this.launchState[1], this.launchState[2]);
    this.inner.quaternion.set(
      this.launchState[3],
      this.launchState[4],
      this.launchState[5],
      this.launchState[6],
    );
    this.group.visible = false;
    this.inner.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) if ('opacity' in material) material.opacity = 0;
      }
    });
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
    this.inner.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) if ('opacity' in material) material.opacity = opacity;
      }
    });
  }

  settle(): void {
    if (!this.settled) {
      this.update(1, 1);
      this.lastProgress = 1;
      this.presented = true;
      this.group.visible = true;
      this.settled = true;
    }
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
    for (const texture of this.ownedLabelTextures) texture.dispose();
    for (const geometry of this.extraGeometries) geometry.dispose();
    this.base.dispose();
  }
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
