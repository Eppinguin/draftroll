import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { FallbackVisualInstance as BaseFallbackVisualInstance } from './fallback-visuals-base';
import type { DraftrollFallbackVisual } from '../packages/renderer/src/index';
import {
  createReadablePolyhedron,
  type PolyhedronLabelAnchor,
  type ReadablePolyhedron,
} from '../packages/renderer/src/polyhedra';

export interface FallbackVisualBounds {
  x: number;
  z: number;
}

interface RecordedTrajectory {
  positions: Float32Array;
  quaternions: Float32Array;
  frameCount: number;
}

interface PlannerRequest {
  id: number;
  kinds?: string[];
  count?: number;
  boundsX: number;
  boundsZ: number;
  states: ArrayBuffer;
  lockedCount?: number;
}

interface GeneratedWorkerResponse {
  id: number;
  step: number;
  frameCount: number;
  dieCount: number;
  transforms: ArrayBuffer;
  impacts: ArrayBuffer;
  duration: number;
  settleReason: string;
  physicsSteps: number;
  diagnostics?: unknown;
  generatedTransforms: ArrayBuffer;
  generatedLandings: ArrayBuffer;
}

const UP = new THREE.Vector3(0, 1, 0);
const activeGeneratedDice = new Set<NaturalGeneratedDie>();
const bridgedWorkers = new WeakMap<Worker, Worker>();

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
  const rotation = new THREE.Quaternion(
    quaternion.x,
    quaternion.y,
    quaternion.z,
    quaternion.w,
  );
  let best = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  shape.outcomes.forEach((_outcome, outcomeIndex) => {
    const score = Math.max(
      ...supportFaces(shape, outcomeIndex).map((faceIndex) =>
        -faceNormal(shape, faceIndex).applyQuaternion(rotation).dot(UP)),
    );
    if (score > bestScore) {
      bestScore = score;
      best = outcomeIndex;
    }
  });
  return best;
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
  bounds: FallbackVisualBounds,
  occupied: readonly THREE.Vector2[],
  random: () => number,
): THREE.Vector2 {
  const rangeX = Math.max(0.2, bounds.x - 1.05);
  const rangeZ = Math.max(0.2, bounds.z - 1.05);
  const separation = count <= 12 ? 1.8 : count <= 20 ? 1.5 : 1.25;
  let best = new THREE.Vector2();
  let bestDistance = -1;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const candidate = new THREE.Vector2(
      (random() * 2 - 1) * rangeX,
      (random() * 2 - 1) * rangeZ,
    );
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
  index: number,
  count: number,
  bounds: FallbackVisualBounds,
  target: THREE.Vector2,
  random: () => number,
): number[] {
  const lane = count <= 1 ? 0 : THREE.MathUtils.lerp(-0.9, 0.9, index / Math.max(1, count - 1));
  const startX = THREE.MathUtils.clamp(
    lane * Math.min(2.2, bounds.x * 0.42) + (random() - 0.5) * 0.34,
    -bounds.x + 1.05,
    bounds.x - 1.05,
  );
  const startZ = bounds.z - 1.0 - (index % 3) * 0.12;
  const startY = 2.55 + (index % 4) * 0.18 + random() * 0.55;
  const flightTime = 0.58 + random() * 0.14;
  const velocityX = (target.x - startX) / flightTime + (random() - 0.5) * 0.75;
  const velocityZ = (target.y - startZ) / flightTime + (random() - 0.5) * 0.6;
  const velocityY = 1.65 + random() * 1.35;
  const rotation = new CANNON.Quaternion();
  rotation.setFromEuler(
    random() * Math.PI * 2,
    random() * Math.PI * 2,
    random() * Math.PI * 2,
  );
  const axis = new CANNON.Vec3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
  if (axis.lengthSquared() < 1e-6) axis.set(1, 0.4, 0.2);
  axis.normalize();
  const rollingX = velocityZ / 0.72;
  const rollingZ = -velocityX / 0.72;
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

function addLocalWalls(
  world: CANNON.World,
  material: CANNON.Material,
  bounds: FallbackVisualBounds,
): void {
  const thickness = 1.1;
  const halfHeight = 5.5;
  const centerY = halfHeight - 0.05;
  const wall = (position: CANNON.Vec3, halfExtents: CANNON.Vec3): void => {
    const body = new CANNON.Body({
      mass: 0,
      material,
      shape: new CANNON.Box(halfExtents),
    });
    body.position.copy(position);
    world.addBody(body);
  };
  wall(
    new CANNON.Vec3(-bounds.x - thickness, centerY, 0),
    new CANNON.Vec3(thickness, halfHeight, bounds.z + 1.6),
  );
  wall(
    new CANNON.Vec3(bounds.x + thickness, centerY, 0),
    new CANNON.Vec3(thickness, halfHeight, bounds.z + 1.6),
  );
  wall(
    new CANNON.Vec3(0, centerY, -bounds.z - thickness),
    new CANNON.Vec3(bounds.x + 1.6, halfHeight, thickness),
  );
  wall(
    new CANNON.Vec3(0, centerY, bounds.z + thickness),
    new CANNON.Vec3(bounds.x + 1.6, halfHeight, thickness),
  );
}

function simulateLocalBatch(entries: NaturalGeneratedDie[]): void {
  if (entries.length === 0) return;
  const bounds = entries[0].bounds;
  const dieMaterial = new CANNON.Material('draftroll-generated-batch-dice');
  const tableMaterial = new CANNON.Material('draftroll-generated-batch-table');
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20.5, 0) });
  world.allowSleep = true;
  world.broadphase = new CANNON.SAPBroadphase(world);
  if (world.solver instanceof CANNON.GSSolver) {
    world.solver.iterations = 32;
    world.solver.tolerance = 0.00025;
  }
  world.addContactMaterial(
    new CANNON.ContactMaterial(dieMaterial, tableMaterial, {
      friction: 0.28,
      restitution: 0.24,
      contactEquationStiffness: 2e7,
      contactEquationRelaxation: 4,
      frictionEquationStiffness: 1.5e7,
    }),
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(dieMaterial, dieMaterial, {
      friction: 0.19,
      restitution: 0.14,
      contactEquationStiffness: 4e7,
      contactEquationRelaxation: 3,
      frictionEquationStiffness: 2.2e7,
      frictionEquationRelaxation: 3,
    }),
  );
  const floor = new CANNON.Body({ mass: 0, material: tableMaterial, shape: new CANNON.Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);
  addLocalWalls(world, tableMaterial, bounds);

  const bodies = entries.map((entry) => {
    const state = entry.launchState;
    const body = new CANNON.Body({
      mass: 1.12,
      material: dieMaterial,
      shape: collider(entry.shape),
    });
    body.position.set(state[0], state[1], state[2]);
    body.quaternion.set(state[3], state[4], state[5], state[6]);
    body.linearDamping = 0.095;
    body.angularDamping = 0.085;
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.09;
    body.sleepTimeLimit = 0.72;
    world.addBody(body);
    return body;
  });
  const active = entries.map(() => false);
  const activate = (index: number): void => {
    const body = bodies[index];
    const state = entries[index].launchState;
    body.type = CANNON.Body.DYNAMIC;
    body.mass = 1.12;
    body.updateMassProperties();
    body.collisionResponse = true;
    body.velocity.set(state[7], state[8], state[9]);
    body.angularVelocity.set(state[10], state[11], state[12]);
    body.wakeUp();
    active[index] = true;
  };
  entries.forEach((entry, index) => {
    if (entry.launchState[13] <= 0) activate(index);
    else {
      bodies[index].type = CANNON.Body.KINEMATIC;
      bodies[index].mass = 0;
      bodies[index].updateMassProperties();
      bodies[index].collisionResponse = false;
    }
  });

  const positionFrames = entries.map(() => [] as number[]);
  const quaternionFrames = entries.map(() => [] as number[]);
  const record = (): void => {
    bodies.forEach((body, index) => {
      positionFrames[index].push(body.position.x, body.position.y, body.position.z);
      quaternionFrames[index].push(
        body.quaternion.x,
        body.quaternion.y,
        body.quaternion.z,
        body.quaternion.w,
      );
    });
  };
  record();
  let frameCount = 1;
  let stableTime = 0;
  const maximumDelay = Math.max(...entries.map((entry) => entry.launchState[13]));
  for (let step = 1; step <= 840; step += 1) {
    const time = step / 120;
    entries.forEach((entry, index) => {
      if (!active[index] && time + 1e-6 >= entry.launchState[13]) activate(index);
    });
    world.step(1 / 120);
    record();
    frameCount += 1;
    if (time < maximumDelay + 0.3) continue;
    const settled = bodies.every(
      (body) =>
        body.sleepState === CANNON.Body.SLEEPING ||
        (body.velocity.length() < 0.13 && body.angularVelocity.length() < 0.22),
    );
    stableTime = settled ? stableTime + 1 / 120 : 0;
    if (step >= 120 && stableTime > 0.5) break;
  }

  entries.forEach((entry, index) => {
    entry.commitTrajectory(
      {
        positions: Float32Array.from(positionFrames[index]),
        quaternions: Float32Array.from(quaternionFrames[index]),
        frameCount,
      },
      landedOutcome(entry.shape, bodies[index].quaternion),
    );
  });
}

function isPlannerRequest(message: unknown): message is PlannerRequest {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as Partial<PlannerRequest>;
  return (
    Number.isInteger(candidate.id) &&
    typeof candidate.boundsX === 'number' &&
    typeof candidate.boundsZ === 'number' &&
    candidate.states instanceof ArrayBuffer
  );
}

function configuredGeneratedDice(): NaturalGeneratedDie[] {
  return [...activeGeneratedDice].filter((entry) => entry.configured);
}

function splitGeneratedTrajectories(
  transforms: Float32Array,
  frameCount: number,
  entries: readonly NaturalGeneratedDie[],
  landings: Int32Array,
): void {
  const generatedCount = entries.length;
  entries.forEach((entry, generatedIndex) => {
    const positions = new Float32Array(frameCount * 3);
    const quaternions = new Float32Array(frameCount * 4);
    for (let frame = 0; frame < frameCount; frame += 1) {
      const source = frame * generatedCount * 7 + generatedIndex * 7;
      const position = frame * 3;
      const quaternion = frame * 4;
      positions[position] = transforms[source];
      positions[position + 1] = transforms[source + 1];
      positions[position + 2] = transforms[source + 2];
      quaternions[quaternion] = transforms[source + 3];
      quaternions[quaternion + 1] = transforms[source + 4];
      quaternions[quaternion + 2] = transforms[source + 5];
      quaternions[quaternion + 3] = transforms[source + 6];
    }
    entry.commitTrajectory(
      { positions, quaternions, frameCount },
      landings[generatedIndex] ?? 0,
    );
  });
}

function installSharedWorkerBridge(): void {
  if (typeof Worker === 'undefined') return;
  const prototype = Worker.prototype as Worker['prototype'] & {
    __draftrollGeneratedDiceBridge?: boolean;
  };
  if (prototype.__draftrollGeneratedDiceBridge) return;
  prototype.__draftrollGeneratedDiceBridge = true;

  const nativePostMessage = Worker.prototype.postMessage;
  const nativeTerminate = Worker.prototype.terminate;

  Worker.prototype.postMessage = function postMessage(
    message: unknown,
    transferOrOptions?: Transferable[] | StructuredSerializeOptions,
  ): void {
    const entries = configuredGeneratedDice();
    if (
      entries.length === 0 ||
      !isPlannerRequest(message) ||
      (message.lockedCount ?? 0) > 0
    ) {
      if (transferOrOptions === undefined) nativePostMessage.call(this, message);
      else nativePostMessage.call(this, message, transferOrOptions);
      return;
    }

    const owner = this;
    const bridge = new Worker(new URL('./generated-roll-worker.ts', import.meta.url), {
      type: 'module',
    });
    bridgedWorkers.set(owner, bridge);
    const generated = entries.map((entry) => ({
      sides: entry.sides,
      state: [...entry.launchState],
    }));

    bridge.addEventListener(
      'message',
      (event: MessageEvent<GeneratedWorkerResponse>) => {
        const response = event.data;
        splitGeneratedTrajectories(
          new Float32Array(response.generatedTransforms),
          response.frameCount,
          entries,
          new Int32Array(response.generatedLandings),
        );
        const standardResponse = {
          id: response.id,
          step: response.step,
          frameCount: response.frameCount,
          dieCount: response.dieCount,
          transforms: response.transforms,
          impacts: response.impacts,
          duration: response.duration,
          settleReason: response.settleReason,
          physicsSteps: response.physicsSteps,
          diagnostics: response.diagnostics,
        };
        bridgedWorkers.delete(owner);
        bridge.terminate();
        owner.dispatchEvent(new MessageEvent('message', { data: standardResponse }));
      },
      { once: true },
    );
    bridge.addEventListener(
      'error',
      (event) => {
        bridgedWorkers.delete(owner);
        bridge.terminate();
        owner.dispatchEvent(
          new ErrorEvent('error', {
            message: event.message || 'Generated dice collision planner failed.',
          }),
        );
      },
      { once: true },
    );
    nativePostMessage.call(
      bridge,
      {
        ...message,
        generated,
      },
      [message.states],
    );
  } as Worker['postMessage'];

  Worker.prototype.terminate = function terminate(): void {
    bridgedWorkers.get(this)?.terminate();
    bridgedWorkers.delete(this);
    nativeTerminate.call(this);
  };
}

class NaturalGeneratedDie {
  readonly group: THREE.Group;
  readonly spec: DraftrollFallbackVisual;
  readonly shape: ReadablePolyhedron;
  readonly sides: number;
  bounds: FallbackVisualBounds = { x: 5, z: 5 };
  launchState: number[] = [];
  configured = false;

  private readonly base: BaseFallbackVisualInstance;
  private readonly inner: THREE.Group;
  private readonly labelMaterials: THREE.MeshBasicMaterial[];
  private readonly originalLabelMaps: Array<THREE.Texture | null>;
  private readonly extraGeometries: THREE.BufferGeometry[] = [];
  private trajectory: RecordedTrajectory | null = null;
  private end = new THREE.Vector2();
  private settled = false;

  constructor(spec: DraftrollFallbackVisual) {
    this.spec = spec;
    this.base = new BaseFallbackVisualInstance(spec);
    this.group = this.base.group;
    const sides = sidesOf(spec);
    if (sides === null) throw new Error(`Generated die requires numeric sides: ${spec.type}`);
    this.sides = sides;
    this.shape = createReadablePolyhedron(sides);
    const inner = this.group.children[0];
    if (!(inner instanceof THREE.Group)) throw new Error('Generated die visual group is missing.');
    this.inner = inner;

    const labelMeshes = inner.children
      .slice(2)
      .filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    let cursor = 0;
    this.labelMaterials = this.shape.outcomes.map((outcome) => {
      const mesh = labelMeshes[cursor];
      cursor += outcome.labels.length;
      if (!(mesh?.material instanceof THREE.MeshBasicMaterial)) {
        throw new Error('Generated die label material is missing.');
      }
      return mesh.material;
    });
    this.originalLabelMaps = this.labelMaterials.map((material) => material.map);

    const covered = new Set(
      this.shape.outcomes.flatMap((outcome) => outcome.labels.map((anchor) => anchor.faceIndex)),
    );
    for (let faceIndex = 0; faceIndex < this.shape.faces.length; faceIndex += 1) {
      if (covered.has(faceIndex)) continue;
      const normal = faceNormal(this.shape, faceIndex);
      const outcomeIndex = this.shape.outcomes
        .map((outcome, index) => ({
          index,
          score: normal.dot(new THREE.Vector3(...outcome.settledUp)),
        }))
        .toSorted((left, right) => right.score - left.score)[0]?.index;
      if (outcomeIndex === undefined) continue;
      const anchor = secondaryAnchor(this.shape, faceIndex);
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
    activeGeneratedDice.add(this);
  }

  private applyRequestedResult(landed: number): void {
    this.labelMaterials.forEach((material, index) => {
      material.map = this.originalLabelMaps[index] ?? null;
      material.needsUpdate = true;
    });
    const result = resultOf(this.spec, this.sides);
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

  commitTrajectory(trajectory: RecordedTrajectory, landed: number): void {
    this.applyRequestedResult(landed);
    this.trajectory = trajectory;
    const last = Math.max(0, trajectory.frameCount - 1) * 3;
    this.end.set(trajectory.positions[last] ?? 0, trajectory.positions[last + 2] ?? 0);
    this.settled = false;
    sample(trajectory, 0, this.group.position, this.inner.quaternion);
  }

  configureTrajectory(
    index: number,
    count: number,
    bounds: FallbackVisualBounds,
    random: () => number,
    occupied: THREE.Vector2[] = [],
  ): void {
    this.bounds = { ...bounds };
    this.end = targetPosition(count, bounds, occupied, random);
    occupied.push(this.end.clone());
    this.launchState = buildLaunchState(index, count, bounds, this.end, random);
    this.configured = true;
    this.trajectory = null;
    this.settled = false;
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
    if (this.settled) return;
    if (!this.trajectory) finalizeGeneratedFallbackBatch();
    if (!this.trajectory) return;
    const normalized = THREE.MathUtils.clamp(progress, 0, 1);
    this.group.visible = normalized > 0;
    if (normalized <= 0) return;
    sample(this.trajectory, normalized, this.group.position, this.inner.quaternion);
    const opacity = THREE.MathUtils.clamp(normalized * 7, 0, 1);
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
    activeGeneratedDice.delete(this);
    for (const geometry of this.extraGeometries) geometry.dispose();
    this.base.dispose();
  }
}

/**
 * Plans all currently configured generated fallback dice in one local Cannon world.
 *
 * Mixed physical/generated rolls are re-planned by the shared worker bridge before
 * playback, adding standard dice to the same collision world. This local pass is
 * what gives fallback-only pools such as 6d5 true generated-to-generated collisions.
 */
export function finalizeGeneratedFallbackBatch(): void {
  const entries = configuredGeneratedDice();
  if (entries.length === 0 || entries.every((entry) => entry['trajectory'] !== null)) return;
  simulateLocalBatch(entries);
}

installSharedWorkerBridge();

type Implementation = BaseFallbackVisualInstance | NaturalGeneratedDie;

/** Routes arbitrary numeric dice through recorded convex-body physics; other visuals retain the established renderer. */
export class FallbackVisualInstance {
  readonly group: THREE.Group;
  readonly spec: DraftrollFallbackVisual;
  private readonly implementation: Implementation;

  constructor(spec: DraftrollFallbackVisual) {
    this.spec = spec;
    this.implementation = isGenerated(spec)
      ? new NaturalGeneratedDie(spec)
      : new BaseFallbackVisualInstance(spec);
    this.group = this.implementation.group;
  }

  configureTrajectory(
    index: number,
    count: number,
    bounds: FallbackVisualBounds,
    random: () => number,
    occupied: THREE.Vector2[] = [],
  ): void {
    this.implementation.configureTrajectory(index, count, bounds, random, occupied);
  }

  update(progress: number, duration = 1): void {
    this.implementation.update(progress, duration);
  }

  settle(): void {
    this.implementation.settle();
  }

  getWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.implementation.getWorldPosition(target);
  }

  getSettledPosition(target = new THREE.Vector2()): THREE.Vector2 {
    return this.implementation.getSettledPosition(target);
  }

  getSettleTime(duration: number): number {
    return this.implementation.getSettleTime(duration);
  }

  dispose(): void {
    this.implementation.dispose();
  }
}
