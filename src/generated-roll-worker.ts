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
  generated: GeneratedPlanEntry[];
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
}

const diceMaterial = new CANNON.Material('planner-dice');
const tableMaterial = new CANNON.Material('planner-table');

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

function cross(
  a: PolyhedronVertex,
  b: PolyhedronVertex,
): [number, number, number] {
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
  if (dot([normal.x, normal.y, normal.z], center) < 0) normal.negate(normal);
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

function enforceBounds(
  bodies: readonly CANNON.Body[],
  boundsX: number,
  boundsZ: number,
  simulationTime: number,
): void {
  const margin = 0.82;
  const crowd = Math.max(0, Math.min(1, (bodies.length - 8) / 22));
  const maxLinear = 12 - crowd * 2.2;
  const maxVertical = 7.5 - crowd * 1.4;
  const maxAngular = 28 - crowd * 4;

  for (const body of bodies) {
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
  }
}

function simulate(request: SharedPlanRequest): SharedPlanResponse {
  const kinds = request.kinds ?? Array.from({ length: request.count ?? 0 }, () => request.kind ?? 'd20');
  const standardCount = kinds.length;
  const generatedShapes = request.generated.map((entry) => createReadablePolyhedron(entry.sides));
  const totalCount = standardCount + generatedShapes.length;
  const crowd = Math.max(0, Math.min(1, (totalCount - 8) / 22));
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20.5, 0) });
  configureWorld(world);
  addTable(world, request.boundsX, request.boundsZ);

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
    bodies.push(body);
  });

  const impacts: number[] = [];
  let currentStep = 0;
  bodies.forEach((body, bodyIndex) => {
    if (bodyIndex < standardCount) {
      body.addEventListener('collide', (event: { contact: CANNON.ContactEquation }) => {
        if (!active[bodyIndex]) return;
        const strength = Math.abs(event.contact.getImpactVelocityAlongNormal());
        if (strength > 1.5) impacts.push(currentStep * FIXED_STEP, bodyIndex, strength);
      });
    }
    world.addBody(body);
    park(body);
    if (delays[bodyIndex] <= 0) {
      activate(body, launch, bodyIndex * 6);
      active[bodyIndex] = true;
    }
  });

  const standardFrames: number[] = [];
  const generatedFrames: number[] = [];
  const record = (): void => {
    for (let index = 0; index < standardCount; index += 1) {
      const body = bodies[index];
      standardFrames.push(
        body.position.x,
        body.position.y,
        body.position.z,
        body.quaternion.x,
        body.quaternion.y,
        body.quaternion.z,
        body.quaternion.w,
      );
    }
    for (let index = standardCount; index < bodies.length; index += 1) {
      const body = bodies[index];
      generatedFrames.push(
        body.position.x,
        body.position.y,
        body.position.z,
        body.quaternion.x,
        body.quaternion.y,
        body.quaternion.z,
        body.quaternion.w,
      );
    }
  };

  record();
  let frameCount = 1;
  let stableTime = 0;
  const maximumDelay = Math.max(0, ...delays);
  let settleReason = 'timeout';

  for (currentStep = 1; currentStep <= MAX_STEPS; currentStep += 1) {
    const simulationTime = currentStep * FIXED_STEP;
    bodies.forEach((body, bodyIndex) => {
      if (!active[bodyIndex] && simulationTime + 1e-6 >= delays[bodyIndex]) {
        activate(body, launch, bodyIndex * 6);
        active[bodyIndex] = true;
      }
    });
    world.step(FIXED_STEP);
    enforceBounds(bodies, request.boundsX, request.boundsZ, simulationTime);
    record();
    frameCount += 1;

    if (simulationTime < maximumDelay + 0.3 || !active.every(Boolean)) {
      stableTime = 0;
      continue;
    }
    const settled = bodies.every((body) => {
      if (body.sleepState === CANNON.Body.SLEEPING) return true;
      return body.velocity.length() < 0.13 && body.angularVelocity.length() < 0.22;
    });
    stableTime = settled ? stableTime + FIXED_STEP : 0;
    if (currentStep >= MIN_STEPS && stableTime > 0.5) {
      settleReason = 'shared-generated-collisions';
      break;
    }
  }

  const generatedLandings = new Int32Array(generatedShapes.length);
  generatedShapes.forEach((shape, generatedIndex) => {
    generatedLandings[generatedIndex] = landedOutcome(shape, bodies[standardCount + generatedIndex].quaternion);
  });
  const transforms = Float32Array.from(standardFrames);
  const generatedTransforms = Float32Array.from(generatedFrames);
  const impactBuffer = Float32Array.from(impacts);
  return {
    id: request.id,
    step: FIXED_STEP,
    frameCount,
    dieCount: standardCount,
    transforms: transforms.buffer,
    impacts: impactBuffer.buffer,
    duration: (frameCount - 1) * FIXED_STEP,
    settleReason,
    physicsSteps: currentStep,
    generatedTransforms: generatedTransforms.buffer,
    generatedLandings: generatedLandings.buffer,
  };
}

self.addEventListener('message', (event: MessageEvent<SharedPlanRequest>) => {
  try {
    const response = simulate(event.data);
    self.postMessage(response, {
      transfer: [
        response.transforms,
        response.impacts,
        response.generatedTransforms,
        response.generatedLandings,
      ],
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
});
