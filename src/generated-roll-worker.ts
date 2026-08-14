import * as CANNON from 'cannon-es';
import { createDiePhysicsShape, type DieKind } from './physics-shapes';
import {
  createReadablePolyhedron,
  type PolyhedronVertex,
  type ReadablePolyhedron,
} from '../packages/renderer/src/polyhedra';

const FIXED_STEP = 1 / 120;
const MAX_STEPS = 1_080;
const MIN_STEPS = 120;
const STATE_STRIDE = 14;
const BODY_MASS = 1.12;

interface GeneratedPlanEntry {
  sides: number;
  state: number[];
}

interface SharedPlanRequest {
  id: number;
  kinds?: DieKind[];
  kind?: DieKind;
  count?: number;
  boundsX: number;
  boundsZ: number;
  states: ArrayBuffer;
  lockedCount?: number;
  lockedTrajectory?: ArrayBuffer;
  lockedTrajectoryStep?: number;
  lockedTrajectoryFrameCount?: number;
  generated: GeneratedPlanEntry[];
}

interface LockedMotion {
  count: number;
  step: number;
  frameCount: number;
  transforms: Float32Array;
}

interface SharedPlanResponse {
  id: number;
  step: number;
  frameCount: number;
  dieCount: number;
  transforms: ArrayBuffer;
  impacts: ArrayBuffer;
  duration: number;
  settleReason: string;
  physicsSteps: number;
  generatedTransforms: ArrayBuffer;
  generatedLandings: ArrayBuffer;
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

const diceMaterial = new CANNON.Material('planner-dice');
const tableMaterial = new CANNON.Material('planner-table');
const generatedShapeCache = new Map<number, ReadablePolyhedron>();

function shapeForSides(sides: number): ReadablePolyhedron {
  let shape = generatedShapeCache.get(sides);
  if (!shape) {
    shape = createReadablePolyhedron(sides);
    generatedShapeCache.set(sides, shape);
  }
  return shape;
}

function configureWorld(world: CANNON.World): void {
  world.allowSleep = true;
  world.broadphase = new CANNON.SAPBroadphase(world);
  if (world.solver instanceof CANNON.GSSolver) {
    world.solver.iterations = 32;
    world.solver.tolerance = 0.00025;
  }
  world.addContactMaterial(
    new CANNON.ContactMaterial(diceMaterial, tableMaterial, {
      friction: 0.28,
      restitution: 0.24,
      contactEquationStiffness: 2e7,
      contactEquationRelaxation: 4,
      frictionEquationStiffness: 1.5e7,
    }),
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(diceMaterial, diceMaterial, {
      friction: 0.19,
      restitution: 0.14,
      contactEquationStiffness: 4e7,
      contactEquationRelaxation: 3,
      frictionEquationStiffness: 2.2e7,
      frictionEquationRelaxation: 3,
    }),
  );
}

function addWall(
  world: CANNON.World,
  position: CANNON.Vec3,
  halfExtents: CANNON.Vec3,
): void {
  const body = new CANNON.Body({
    mass: 0,
    material: tableMaterial,
    shape: new CANNON.Box(halfExtents),
  });
  body.position.copy(position);
  world.addBody(body);
}

function addTable(world: CANNON.World, boundsX: number, boundsZ: number): void {
  const floor = new CANNON.Body({ mass: 0, material: tableMaterial, shape: new CANNON.Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);
  const thickness = 1.1;
  const halfHeight = 5.5;
  const centerY = halfHeight - 0.05;
  addWall(
    world,
    new CANNON.Vec3(-boundsX - thickness, centerY, 0),
    new CANNON.Vec3(thickness, halfHeight, boundsZ + 1.6),
  );
  addWall(
    world,
    new CANNON.Vec3(boundsX + thickness, centerY, 0),
    new CANNON.Vec3(thickness, halfHeight, boundsZ + 1.6),
  );
  addWall(
    world,
    new CANNON.Vec3(0, centerY, -boundsZ - thickness),
    new CANNON.Vec3(boundsX + 1.6, halfHeight, thickness),
  );
  addWall(
    world,
    new CANNON.Vec3(0, centerY, boundsZ + thickness),
    new CANNON.Vec3(boundsX + 1.6, halfHeight, thickness),
  );
}

function subtract(a: PolyhedronVertex, b: PolyhedronVertex): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: PolyhedronVertex, b: PolyhedronVertex): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: PolyhedronVertex, b: PolyhedronVertex): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function faceNormal(shape: ReadablePolyhedron, faceIndex: number): CANNON.Vec3 {
  const face = shape.faces[faceIndex];
  const a = shape.vertices[face[0]];
  const b = shape.vertices[face[1]];
  const c = shape.vertices[face[2]];
  const raw = cross(subtract(b, a), subtract(c, a));
  const normal = new CANNON.Vec3(raw[0], raw[1], raw[2]);
  normal.normalize();
  const center: [number, number, number] = [0, 0, 0];
  for (const vertexIndex of face) {
    const vertex = shape.vertices[vertexIndex];
    center[0] += vertex[0] / face.length;
    center[1] += vertex[1] / face.length;
    center[2] += vertex[2] / face.length;
  }
  if (dot([normal.x, normal.y, normal.z], center) < 0) normal.scale(-1, normal);
  return normal;
}

function createGeneratedCollider(shape: ReadablePolyhedron): CANNON.ConvexPolyhedron {
  const vertices = shape.vertices.map(([x, y, z]) => new CANNON.Vec3(x, y, z));
  const faces = shape.faces.map((source, faceIndex) => {
    const face = [...source];
    const a = shape.vertices[face[0]];
    const b = shape.vertices[face[1]];
    const c = shape.vertices[face[2]];
    const winding = cross(subtract(b, a), subtract(c, a));
    const normal = faceNormal(shape, faceIndex);
    if (dot(winding, [normal.x, normal.y, normal.z]) < 0) face.reverse();
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
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  shape.outcomes.forEach((_outcome, outcomeIndex) => {
    const score = Math.max(
      ...supportFaces(shape, outcomeIndex).map((faceIndex) => {
        const worldNormal = quaternion.vmult(faceNormal(shape, faceIndex));
        return -worldNormal.y;
      }),
    );
    if (score > bestScore) {
      bestScore = score;
      bestIndex = outcomeIndex;
    }
  });
  return bestIndex;
}

function applyState(body: CANNON.Body, state: ArrayLike<number>): number {
  body.position.set(state[0], state[1], state[2]);
  body.quaternion.set(state[3], state[4], state[5], state[6]);
  body.velocity.set(state[7], state[8], state[9]);
  body.angularVelocity.set(state[10], state[11], state[12]);
  body.previousPosition.copy(body.position);
  body.interpolatedPosition.copy(body.position);
  body.previousQuaternion.copy(body.quaternion);
  body.interpolatedQuaternion.copy(body.quaternion);
  return Math.max(0, state[13] ?? 0);
}

function park(body: CANNON.Body): void {
  body.type = CANNON.Body.KINEMATIC;
  body.mass = 0;
  body.updateMassProperties();
  body.collisionResponse = false;
  body.velocity.setZero();
  body.angularVelocity.setZero();
  body.force.setZero();
  body.torque.setZero();
  body.wakeUp();
  body.aabbNeedsUpdate = true;
}

function activate(body: CANNON.Body, velocity: Float32Array, offset: number): void {
  body.type = CANNON.Body.DYNAMIC;
  body.mass = BODY_MASS;
  body.updateMassProperties();
  body.collisionResponse = true;
  body.velocity.set(velocity[offset], velocity[offset + 1], velocity[offset + 2]);
  body.angularVelocity.set(velocity[offset + 3], velocity[offset + 4], velocity[offset + 5]);
  body.force.setZero();
  body.torque.setZero();
  body.wakeUp();
  body.aabbNeedsUpdate = true;
}

function configureLocked(body: CANNON.Body): void {
  body.type = CANNON.Body.KINEMATIC;
  body.mass = 0;
  body.updateMassProperties();
  body.collisionResponse = true;
  body.force.setZero();
  body.torque.setZero();
  body.wakeUp();
  body.aabbNeedsUpdate = true;
}

function sampleLocked(
  motion: LockedMotion,
  dieIndex: number,
  time: number,
  position: CANNON.Vec3,
  quaternion: CANNON.Quaternion,
): void {
  const frame = Math.max(0, Math.min(motion.frameCount - 1, time / motion.step));
  const first = Math.floor(frame);
  const second = Math.min(motion.frameCount - 1, first + 1);
  const alpha = frame - first;
  const stride = motion.count * 7;
  const a = first * stride + dieIndex * 7;
  const b = second * stride + dieIndex * 7;
  position.set(
    motion.transforms[a] + (motion.transforms[b] - motion.transforms[a]) * alpha,
    motion.transforms[a + 1] + (motion.transforms[b + 1] - motion.transforms[a + 1]) * alpha,
    motion.transforms[a + 2] + (motion.transforms[b + 2] - motion.transforms[a + 2]) * alpha,
  );
  const qa = new CANNON.Quaternion(
    motion.transforms[a + 3],
    motion.transforms[a + 4],
    motion.transforms[a + 5],
    motion.transforms[a + 6],
  );
  const qb = new CANNON.Quaternion(
    motion.transforms[b + 3],
    motion.transforms[b + 4],
    motion.transforms[b + 5],
    motion.transforms[b + 6],
  );
  qa.slerp(qb, alpha, quaternion);
  quaternion.normalize();
}

function updateLockedBodies(
  standardBodies: readonly CANNON.Body[],
  motion: LockedMotion | undefined,
  previousTime: number,
  nextTime: number,
): void {
  if (!motion) return;
  const previousPosition = new CANNON.Vec3();
  const nextPosition = new CANNON.Vec3();
  const previousQuaternion = new CANNON.Quaternion();
  const nextQuaternion = new CANNON.Quaternion();
  const dt = Math.max(1e-6, nextTime - previousTime);
  for (let index = 0; index < motion.count; index += 1) {
    const body = standardBodies[index];
    if (!body) continue;
    sampleLocked(motion, index, previousTime, previousPosition, previousQuaternion);
    sampleLocked(motion, index, nextTime, nextPosition, nextQuaternion);
    body.position.copy(nextPosition);
    body.quaternion.copy(nextQuaternion);
    body.velocity.set(
      (nextPosition.x - previousPosition.x) / dt,
      (nextPosition.y - previousPosition.y) / dt,
      (nextPosition.z - previousPosition.z) / dt,
    );
    body.angularVelocity.setZero();
    body.previousPosition.copy(previousPosition);
    body.previousQuaternion.copy(previousQuaternion);
    body.aabbNeedsUpdate = true;
  }
}

function enforceBounds(
  bodies: readonly CANNON.Body[],
  lockedStandardCount: number,
  boundsX: number,
  boundsZ: number,
  simulationTime: number,
): void {
  const margin = 0.82;
  const crowd = Math.max(0, Math.min(1, (bodies.length - 8) / 22));
  const maxLinear = 12 - crowd * 2.2;
  const maxVertical = 7.5 - crowd * 1.4;
  const maxAngular = 28 - crowd * 4;
  bodies.forEach((body, index) => {
    if (index < lockedStandardCount) return;
    const minX = -boundsX + margin;
    const maxX = boundsX - margin;
    const minZ = -boundsZ + margin;
    const maxZ = boundsZ - margin;
    if (body.position.x < minX) {
      body.position.x = minX + 0.002;
      if (body.velocity.x < 0) body.velocity.x = Math.min(0.35, -body.velocity.x * 0.08);
    } else if (body.position.x > maxX) {
      body.position.x = maxX - 0.002;
      if (body.velocity.x > 0) body.velocity.x = Math.max(-0.35, -body.velocity.x * 0.08);
    }
    if (body.position.z < minZ) {
      body.position.z = minZ + 0.002;
      if (body.velocity.z < 0) body.velocity.z = Math.min(0.35, -body.velocity.z * 0.08);
    } else if (body.position.z > maxZ) {
      body.position.z = maxZ - 0.002;
      if (body.velocity.z > 0) body.velocity.z = Math.max(-0.35, -body.velocity.z * 0.08);
    }
    if (body.position.y > 9.2) {
      body.position.y = 9.2;
      if (body.velocity.y > 0) body.velocity.y = -Math.min(1.2, body.velocity.y * 0.12);
    }
    if (body.position.y < -0.7) {
      body.position.y = 1.05;
      body.velocity.setZero();
      body.angularVelocity.scale(0.25, body.angularVelocity);
      body.wakeUp();
    }
    if (body.position.y < 1.35 && Math.abs(body.velocity.y) < 0.65) {
      body.velocity.x *= 0.997 - crowd * 0.0015;
      body.velocity.z *= 0.997 - crowd * 0.0015;
      body.angularVelocity.scale(0.993 - crowd * 0.002, body.angularVelocity);
    }
    if (crowd > 0 && simulationTime > 2.15 && body.position.y < 6.4) {
      const speed = body.velocity.length();
      const angular = body.angularVelocity.length();
      if (speed < 2 && angular < 4) {
        const ramp = Math.max(0, Math.min(1, (simulationTime - 2.15) / 1.8)) * crowd;
        body.velocity.scale(1 - 0.024 * ramp, body.velocity);
        body.angularVelocity.scale(1 - 0.036 * ramp, body.angularVelocity);
      }
    }
    body.velocity.y = Math.max(-maxVertical, Math.min(maxVertical, body.velocity.y));
    const linearSpeed = body.velocity.length();
    if (linearSpeed > maxLinear) body.velocity.scale(maxLinear / linearSpeed, body.velocity);
    const angularSpeed = body.angularVelocity.length();
    if (angularSpeed > maxAngular) body.angularVelocity.scale(maxAngular / angularSpeed, body.angularVelocity);
  });
}

function appendTransforms(target: number[], bodies: readonly CANNON.Body[]): void {
  for (const body of bodies) {
    target.push(
      body.position.x,
      body.position.y,
      body.position.z,
      body.quaternion.x,
      body.quaternion.y,
      body.quaternion.z,
      body.quaternion.w,
    );
  }
}

function simulate(request: SharedPlanRequest): SharedPlanResponse {
  const startedAt = performance.now();
  const kinds =
    request.kinds ?? Array.from({ length: request.count ?? 0 }, () => request.kind ?? 'd20');
  const standardCount = kinds.length;
  const lockedCount = Math.max(0, Math.min(standardCount, request.lockedCount ?? 0));
  const lockedFrameCount = Math.max(0, Math.floor(request.lockedTrajectoryFrameCount ?? 0));
  const lockedStep = Number(request.lockedTrajectoryStep);
  const lockedTransforms = request.lockedTrajectory
    ? new Float32Array(request.lockedTrajectory)
    : null;
  const lockedMotion =
    lockedCount > 0 &&
    lockedTransforms &&
    lockedFrameCount >= 2 &&
    Number.isFinite(lockedStep) &&
    lockedStep > 0 &&
    lockedTransforms.length === lockedFrameCount * lockedCount * 7
      ? {
          count: lockedCount,
          step: lockedStep,
          frameCount: lockedFrameCount,
          transforms: lockedTransforms,
        }
      : undefined;

  const generatedShapes = request.generated.map((entry) => shapeForSides(entry.sides));
  const totalCount = standardCount + generatedShapes.length;
  const crowd = Math.max(0, Math.min(1, (totalCount - 8) / 22));
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20.5, 0) });
  configureWorld(world);
  addTable(world, request.boundsX, request.boundsZ);

  const standardBodies: CANNON.Body[] = [];
  const generatedBodies: CANNON.Body[] = [];
  const bodies: CANNON.Body[] = [];
  const delays = new Float32Array(totalCount);
  const launch = new Float32Array(totalCount * 6);
  const active = Array.from({ length: totalCount }, () => false);
  const stateData = new Float32Array(request.states);

  for (let index = 0; index < standardCount; index += 1) {
    const body = new CANNON.Body({
      mass: BODY_MASS,
      material: diceMaterial,
      shape: createDiePhysicsShape(kinds[index]),
    });
    const offset = index * STATE_STRIDE;
    const state = stateData.subarray(offset, offset + STATE_STRIDE);
    delays[index] = applyState(body, state);
    launch.set(state.subarray(7, 13), index * 6);
    body.linearDamping = 0.095 + crowd * 0.025;
    body.angularDamping = 0.085 + crowd * 0.045;
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.09 + crowd * 0.015;
    body.sleepTimeLimit = 0.72;
    if (index < lockedCount && lockedMotion) {
      configureLocked(body);
      active[index] = true;
    } else if (delays[index] <= 0) activate(body, launch, index * 6);
    else park(body);
    world.addBody(body);
    standardBodies.push(body);
    bodies.push(body);
  }

  request.generated.forEach((entry, generatedIndex) => {
    const bodyIndex = standardCount + generatedIndex;
    const body = new CANNON.Body({
      mass: BODY_MASS,
      material: diceMaterial,
      shape: createGeneratedCollider(generatedShapes[generatedIndex]),
    });
    delays[bodyIndex] = applyState(body, entry.state);
    for (let component = 0; component < 6; component += 1) {
      launch[bodyIndex * 6 + component] = entry.state[7 + component] ?? 0;
    }
    body.linearDamping = 0.095 + crowd * 0.025;
    body.angularDamping = 0.085 + crowd * 0.045;
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.09 + crowd * 0.015;
    body.sleepTimeLimit = 0.72;
    if (delays[bodyIndex] <= 0) activate(body, launch, bodyIndex * 6);
    else park(body);
    world.addBody(body);
    generatedBodies.push(body);
    bodies.push(body);
  });

  let currentStep = 0;
  const impacts: number[] = [];
  standardBodies.forEach((body, index) => {
    body.addEventListener('collide', (event: { contact: CANNON.ContactEquation }) => {
      if (!active[index]) return;
      const strength = Math.abs(event.contact.getImpactVelocityAlongNormal());
      if (strength > 1.5) impacts.push(currentStep * FIXED_STEP, index, strength);
    });
  });

  const standardTransforms: number[] = [];
  const generatedTransforms: number[] = [];
  updateLockedBodies(standardBodies, lockedMotion, 0, 0);
  appendTransforms(standardTransforms, standardBodies);
  appendTransforms(generatedTransforms, generatedBodies);

  const maximumDelay = Math.max(0, ...delays);
  const lockedDuration = lockedMotion
    ? (lockedMotion.frameCount - 1) * lockedMotion.step
    : 0;
  let stableTime = 0;
  let frameCount = 1;
  let settleReason = 'timeout';
  let finalAverageLinear = 0;
  let finalAverageAngular = 0;

  for (currentStep = 1; currentStep <= MAX_STEPS; currentStep += 1) {
    const time = currentStep * FIXED_STEP;
    for (let index = lockedCount; index < totalCount; index += 1) {
      if (!active[index] && time + 1e-6 >= delays[index]) {
        activate(bodies[index], launch, index * 6);
        active[index] = true;
      }
    }
    updateLockedBodies(standardBodies, lockedMotion, time - FIXED_STEP, time);
    world.step(FIXED_STEP);
    updateLockedBodies(standardBodies, lockedMotion, time - FIXED_STEP, time);
    enforceBounds(bodies, lockedCount, request.boundsX, request.boundsZ, time);
    appendTransforms(standardTransforms, standardBodies);
    appendTransforms(generatedTransforms, generatedBodies);
    frameCount += 1;

    if (time < Math.max(maximumDelay + 0.3, lockedDuration + 0.15)) continue;
    let linear = 0;
    let angular = 0;
    let dynamicCount = 0;
    let allSlow = true;
    for (let index = lockedCount; index < bodies.length; index += 1) {
      if (!active[index]) {
        allSlow = false;
        continue;
      }
      const body = bodies[index];
      const speed = body.velocity.length();
      const spin = body.angularVelocity.length();
      linear += speed;
      angular += spin;
      dynamicCount += 1;
      if (!(body.sleepState === CANNON.Body.SLEEPING || (speed < 0.14 && spin < 0.23))) {
        allSlow = false;
      }
    }
    finalAverageLinear = linear / Math.max(1, dynamicCount);
    finalAverageAngular = angular / Math.max(1, dynamicCount);
    stableTime = allSlow ? stableTime + FIXED_STEP : 0;
    if (currentStep >= MIN_STEPS && stableTime > 0.5) {
      settleReason = 'shared-contact-stable';
      break;
    }
  }

  const generatedLandings = Int32Array.from(
    generatedBodies.map((body, index) => landedOutcome(generatedShapes[index], body.quaternion)),
  );
  const standardBuffer = Float32Array.from(standardTransforms);
  const generatedBuffer = Float32Array.from(generatedTransforms);
  const impactBuffer = Float32Array.from(impacts);
  return {
    id: request.id,
    step: FIXED_STEP,
    frameCount,
    dieCount: standardCount,
    transforms: standardBuffer.buffer,
    impacts: impactBuffer.buffer,
    duration: (frameCount - 1) * FIXED_STEP,
    settleReason,
    physicsSteps: currentStep,
    generatedTransforms: generatedBuffer.buffer,
    generatedLandings: generatedLandings.buffer,
    diagnostics: {
      finalAverageLinear,
      finalAverageAngular,
      candidateAttempts: 1,
      candidateSearchMs: performance.now() - startedAt,
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

self.addEventListener('message', (event: MessageEvent<SharedPlanRequest>) => {
  const response = simulate(event.data);
  self.postMessage(response, {
    transfer: [
      response.transforms,
      response.impacts,
      response.generatedTransforms,
      response.generatedLandings,
    ],
  });
});
