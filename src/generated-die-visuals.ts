import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { FallbackVisualInstance as BaseFallbackVisualInstance } from './fallback-visuals-base';
import type { DraftrollFallbackVisual } from '../packages/renderer/src/index';
import {
  createReadablePolyhedron,
  type PolyhedronLabelAnchor,
  type ReadablePolyhedron,
} from '../packages/renderer/src/polyhedra';

export interface FallbackVisualBounds { x: number; z: number }

interface RecordedTrajectory {
  positions: Float32Array;
  quaternions: Float32Array;
  frameCount: number;
}

const UP = new THREE.Vector3(0, 1, 0);

function sidesOf(spec: DraftrollFallbackVisual): number | null {
  if (Number.isSafeInteger(spec.sides) && (spec.sides ?? 0) >= 1) return spec.sides!;
  const match = /^d(\d+)$/i.exec(spec.type);
  const sides = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(sides) && sides >= 1 ? sides : null;
}

function isGenerated(spec: DraftrollFallbackVisual): boolean {
  return spec.kind === 'spinner' && sidesOf(spec) !== null;
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
  const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3())
    .multiplyScalar(1 / points.length);
  if (normal.dot(center) < 0) normal.negate();
  return normal;
}

function secondaryAnchor(shape: ReadablePolyhedron, faceIndex: number): PolyhedronLabelAnchor {
  const face = shape.faces[faceIndex];
  const points = face.map((index) => new THREE.Vector3(...shape.vertices[index]));
  const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3())
    .multiplyScalar(1 / points.length);
  const normal = faceNormal(shape, faceIndex);
  let span = 0;
  for (let a = 0; a < points.length; a += 1) {
    for (let b = a + 1; b < points.length; b += 1) span = Math.max(span, points[a].distanceTo(points[b]));
  }
  const reference = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const up = reference.projectOnPlane(normal).normalize();
  return {
    kind: 'face', faceIndex,
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
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, normal));
}

function collider(shape: ReadablePolyhedron): CANNON.ConvexPolyhedron {
  const vertices = shape.vertices.map(([x, y, z]) => new CANNON.Vec3(x, y, z));
  const faces = shape.faces.map((source, faceIndex) => {
    const face = [...source];
    const a = new THREE.Vector3(...shape.vertices[face[0]]);
    const b = new THREE.Vector3(...shape.vertices[face[1]]);
    const c = new THREE.Vector3(...shape.vertices[face[2]]);
    const winding = new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).normalize();
    if (winding.dot(faceNormal(shape, faceIndex)) < 0) face.reverse();
    return face;
  });
  return new CANNON.ConvexPolyhedron({ vertices, faces });
}

function supportFaces(shape: ReadablePolyhedron, outcomeIndex: number): number[] {
  if (shape.family === 'd1-cylinder') return [0, 1];
  if (shape.family === 'd3-cube') return [[0, 1], [2, 3], [4, 5]][outcomeIndex] ?? [];
  return [shape.outcomes[outcomeIndex]?.supportFace ?? 0];
}

function landedOutcome(shape: ReadablePolyhedron, quaternion: CANNON.Quaternion): number {
  const rotation = new THREE.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  let best = 0;
  let bestScore = -Infinity;
  shape.outcomes.forEach((_outcome, outcomeIndex) => {
    const score = Math.max(...supportFaces(shape, outcomeIndex).map((faceIndex) =>
      -faceNormal(shape, faceIndex).applyQuaternion(rotation).dot(UP)));
    if (score > bestScore) { bestScore = score; best = outcomeIndex }
  });
  return best;
}

function simulate(
  shape: ReadablePolyhedron,
  target: THREE.Vector2,
  index: number,
  random: () => number,
): { trajectory: RecordedTrajectory; landed: number } {
  const dieMaterial = new CANNON.Material('draftroll-generated-die');
  const tableMaterial = new CANNON.Material('draftroll-generated-table');
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20.5, 0) });
  world.allowSleep = true;
  world.broadphase = new CANNON.SAPBroadphase(world);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const solver = world.solver as CANNON.GSSolver;
  solver.iterations = 32;
  solver.tolerance = 0.00025;
  world.addContactMaterial(new CANNON.ContactMaterial(dieMaterial, tableMaterial, {
    friction: 0.28, restitution: 0.24,
    contactEquationStiffness: 2e7, contactEquationRelaxation: 4,
    frictionEquationStiffness: 1.5e7,
  }));
  const floor = new CANNON.Body({ mass: 0, material: tableMaterial, shape: new CANNON.Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);
  const body = new CANNON.Body({ mass: 1.15, material: dieMaterial, shape: collider(shape) });
  body.linearDamping = 0.095;
  body.angularDamping = 0.085;
  body.allowSleep = true;
  body.sleepSpeedLimit = 0.09;
  body.sleepTimeLimit = 0.72;
  const direction = index % 2 === 0 ? -1 : 1;
  const x = direction * (2 + random() * 1.45);
  const z = (random() - 0.5) * 2.2;
  body.position.set(x, 2.8 + random() * 1.4, z);
  body.velocity.set(-x * (1.05 + random() * 0.34), 1.1 + random() * 2, -z * (0.75 + random() * 0.38) + (random() - 0.5));
  body.quaternion.setFromEuler(random() * Math.PI * 2, random() * Math.PI * 2, random() * Math.PI * 2);
  const axis = new CANNON.Vec3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
  if (axis.lengthSquared() < 1e-6) axis.set(1, 0.4, 0.2);
  axis.normalize();
  const spin = 10 + random() * 10;
  body.angularVelocity.set(axis.x * spin, axis.y * spin, axis.z * spin);
  world.addBody(body);

  const positions: number[] = [];
  const quaternions: number[] = [];
  const record = (): void => {
    positions.push(body.position.x, body.position.y, body.position.z);
    quaternions.push(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
  };
  record();
  let stable = 0;
  for (let stepIndex = 0; stepIndex < 840; stepIndex += 1) {
    world.step(1 / 120);
    if (stepIndex % 2 === 1) record();
    if (body.position.y < 1.35 && body.velocity.lengthSquared() < 0.012 && body.angularVelocity.lengthSquared() < 0.0225) stable += 1;
    else stable = 0;
    if (stable >= 52 || body.sleepState === CANNON.Body.SLEEPING) break;
  }
  record();
  const frameCount = positions.length / 3;
  const last = (frameCount - 1) * 3;
  const dx = target.x - positions[last];
  const dz = target.y - positions[last + 2];
  for (let frame = 0; frame < frameCount; frame += 1) {
    positions[frame * 3] += dx;
    positions[frame * 3 + 2] += dz;
  }
  return {
    trajectory: { positions: Float32Array.from(positions), quaternions: Float32Array.from(quaternions), frameCount },
    landed: landedOutcome(shape, body.quaternion),
  };
}

function sample(t: RecordedTrajectory, progress: number, position: THREE.Vector3, quaternion: THREE.Quaternion): void {
  const scaled = THREE.MathUtils.clamp(progress, 0, 1) * Math.max(0, t.frameCount - 1);
  const a = Math.floor(scaled);
  const b = Math.min(t.frameCount - 1, a + 1);
  const blend = scaled - a;
  const pa = a * 3;
  const pb = b * 3;
  position.set(
    THREE.MathUtils.lerp(t.positions[pa], t.positions[pb], blend),
    THREE.MathUtils.lerp(t.positions[pa + 1], t.positions[pb + 1], blend),
    THREE.MathUtils.lerp(t.positions[pa + 2], t.positions[pb + 2], blend),
  );
  const qa = a * 4;
  const qb = b * 4;
  quaternion.set(t.quaternions[qa], t.quaternions[qa + 1], t.quaternions[qa + 2], t.quaternions[qa + 3])
    .slerp(new THREE.Quaternion(t.quaternions[qb], t.quaternions[qb + 1], t.quaternions[qb + 2], t.quaternions[qb + 3]), blend);
}

function targetPosition(count: number, bounds: FallbackVisualBounds, occupied: readonly THREE.Vector2[], random: () => number): THREE.Vector2 {
  const rangeX = Math.max(0.2, bounds.x - 1.05);
  const rangeZ = Math.max(0.2, bounds.z - 1.05);
  const separation = count <= 12 ? 1.8 : count <= 20 ? 1.5 : 1.25;
  let best = new THREE.Vector2();
  let bestDistance = -1;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const candidate = new THREE.Vector2((random() * 2 - 1) * rangeX, (random() * 2 - 1) * rangeZ);
    const nearest = occupied.reduce((value, point) => Math.min(value, candidate.distanceTo(point)), Infinity);
    if (nearest >= separation) return candidate;
    if (nearest > bestDistance) { bestDistance = nearest; best = candidate }
  }
  return best;
}

class NaturalGeneratedDie {
  readonly group: THREE.Group;
  readonly spec: DraftrollFallbackVisual;
  private readonly base: BaseFallbackVisualInstance;
  private readonly shape: ReadablePolyhedron;
  private readonly inner: THREE.Group;
  private readonly labelMaterials: THREE.MeshBasicMaterial[];
  private readonly extraGeometries: THREE.BufferGeometry[] = [];
  private trajectory: RecordedTrajectory | null = null;
  private delay = 0;
  private end = new THREE.Vector2();
  private settled = false;

  constructor(spec: DraftrollFallbackVisual) {
    this.spec = spec;
    this.base = new BaseFallbackVisualInstance(spec);
    this.group = this.base.group;
    const sides = sidesOf(spec);
    if (sides === null) throw new Error(`Generated die requires numeric sides: ${spec.type}`);
    this.shape = createReadablePolyhedron(sides);
    const inner = this.group.children[0];
    if (!(inner instanceof THREE.Group)) throw new Error('Generated die visual group is missing.');
    this.inner = inner;

    // The base visual appends label meshes outcome-by-outcome after body + edges.
    const labelMeshes = inner.children.slice(2).filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    let cursor = 0;
    this.labelMaterials = this.shape.outcomes.map((outcome) => {
      const mesh = labelMeshes[cursor];
      cursor += outcome.labels.length;
      if (!(mesh?.material instanceof THREE.MeshBasicMaterial)) throw new Error('Generated die label material is missing.');
      return mesh.material;
    });

    const covered = new Set(this.shape.outcomes.flatMap((outcome) => outcome.labels.map((anchor) => anchor.faceIndex)));
    for (let faceIndex = 0; faceIndex < this.shape.faces.length; faceIndex += 1) {
      if (covered.has(faceIndex)) continue;
      const normal = faceNormal(this.shape, faceIndex);
      const outcomeIndex = this.shape.outcomes.map((outcome, index) => ({ index, score: normal.dot(new THREE.Vector3(...outcome.settledUp)) }))
        .toSorted((a, b) => b.score - a.score)[0]?.index;
      if (outcomeIndex === undefined) continue;
      const anchor = secondaryAnchor(this.shape, faceIndex);
      const geometry = new THREE.PlaneGeometry(anchor.scale, anchor.scale);
      const mesh = new THREE.Mesh(geometry, this.labelMaterials[outcomeIndex]);
      mesh.position.fromArray(anchor.position).addScaledVector(new THREE.Vector3(...anchor.normal), 0.014);
      mesh.quaternion.copy(anchorQuaternion(anchor));
      mesh.renderOrder = 7;
      inner.add(mesh);
      this.extraGeometries.push(geometry);
    }
  }

  private applyRequestedResult(landed: number): void {
    const sides = sidesOf(this.spec) ?? this.shape.outcomes.length;
    const result = resultOf(this.spec, sides);
    const values = this.shape.outcomes.map((outcome) => outcome.value);
    const source = values.indexOf(result);
    if (source < 0 || source === landed) return;
    const sourceMap = this.labelMaterials[source]?.map;
    const landedMap = this.labelMaterials[landed]?.map;
    if (!sourceMap || !landedMap) return;
    this.labelMaterials[source].map = landedMap;
    this.labelMaterials[landed].map = sourceMap;
    this.labelMaterials[source].needsUpdate = true;
    this.labelMaterials[landed].needsUpdate = true;
  }

  configureTrajectory(index: number, count: number, bounds: FallbackVisualBounds, random: () => number, occupied: THREE.Vector2[] = []): void {
    this.end = targetPosition(count, bounds, occupied, random);
    occupied.push(this.end.clone());
    const planned = simulate(this.shape, this.end, index, random);
    this.applyRequestedResult(planned.landed);
    this.trajectory = planned.trajectory;
    this.delay = Math.min(0.16, index * 0.025 + random() * 0.025);
    this.settled = false;
    sample(this.trajectory, 0, this.group.position, this.inner.quaternion);
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
    const p = THREE.MathUtils.clamp((progress - this.delay) / Math.max(0.001, 1 - this.delay), 0, 1);
    this.group.visible = p > 0;
    if (p <= 0) return;
    sample(this.trajectory, p, this.group.position, this.inner.quaternion);
    const opacity = THREE.MathUtils.clamp(p * 7, 0, 1);
    this.inner.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) if ('opacity' in material) material.opacity = opacity;
      }
    });
  }

  settle(): void { if (!this.settled) { this.update(1, 1); this.settled = true } }
  getWorldPosition(target = new THREE.Vector3()): THREE.Vector3 { return this.group.getWorldPosition(target) }
  getSettledPosition(target = new THREE.Vector2()): THREE.Vector2 { return target.copy(this.end) }
  getSettleTime(duration: number): number { return duration }
  dispose(): void { for (const geometry of this.extraGeometries) geometry.dispose(); this.base.dispose() }
}

type Implementation = BaseFallbackVisualInstance | NaturalGeneratedDie;

/** Routes arbitrary numeric dice through recorded convex-body physics; other visuals retain the established renderer. */
export class FallbackVisualInstance {
  readonly group: THREE.Group;
  readonly spec: DraftrollFallbackVisual;
  private readonly implementation: Implementation;

  constructor(spec: DraftrollFallbackVisual) {
    this.spec = spec;
    this.implementation = isGenerated(spec) ? new NaturalGeneratedDie(spec) : new BaseFallbackVisualInstance(spec);
    this.group = this.implementation.group;
  }
  configureTrajectory(index: number, count: number, bounds: FallbackVisualBounds, random: () => number, occupied: THREE.Vector2[] = []): void {
    this.implementation.configureTrajectory(index, count, bounds, random, occupied);
  }
  update(progress: number, duration = 1): void { this.implementation.update(progress, duration) }
  settle(): void { this.implementation.settle() }
  getWorldPosition(target = new THREE.Vector3()): THREE.Vector3 { return this.implementation.getWorldPosition(target) }
  getSettledPosition(target = new THREE.Vector2()): THREE.Vector2 { return this.implementation.getSettledPosition(target) }
  getSettleTime(duration: number): number { return this.implementation.getSettleTime(duration) }
  dispose(): void { this.implementation.dispose() }
}
