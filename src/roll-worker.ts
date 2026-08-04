import * as CANNON from 'cannon-es';
import { createDiePhysicsShape, type DieKind } from './physics-shapes';
import {
  minimumRestingAlignment,
  readRestingAlignment,
  releaseUnstableRestPose,
} from './resting-physics';

const FIXED_STEP = 1 / 120;
const RECORD_EVERY = 1;
const RECORD_STEP = FIXED_STEP * RECORD_EVERY;
const MAX_STEPS = 1_080;
const MIN_STEPS = 120;
const STATE_STRIDE = 14;
const BODY_MASS = 1.12;

interface PlanRequest {
  id: number;
  /** Per-die physical kinds. Legacy callers may still provide kind/count. */
  kinds?: DieKind[];
  kind?: DieKind;
  count?: number;
  boundsX: number;
  boundsZ: number;
  states: ArrayBuffer;
  /** Existing visible dice follow their previously verified trajectory. */
  lockedCount?: number;
  lockedTrajectory?: ArrayBuffer;
  lockedTrajectoryStep?: number;
  lockedTrajectoryFrameCount?: number;
}

interface LockedMotion {
  count: number;
  step: number;
  frameCount: number;
  transforms: Float32Array;
}

interface PlannerCache {
  kinds: DieKind[];
  kindsKey: string;
  count: number;
  boundsX: number;
  boundsZ: number;
  world: CANNON.World;
  bodies: CANNON.Body[];
  bodyKeys: Map<number, number>;
}

interface SimulationResult {
  frameCount: number;
  transforms: Float32Array;
  impacts: Float32Array;
  duration: number;
  settleReason: string;
  physicsSteps: number;
  finalAverageLinear: number;
  finalAverageAngular: number;
  contactStableTime: number;
  displacementStableTime: number;
}

const diceMaterial = new CANNON.Material('planner-dice');
const tableMaterial = new CANNON.Material('planner-table');
let cache: PlannerCache | null = null;
let currentStep = 0;
let currentImpacts: number[] = [];
let currentActiveFlags: boolean[] = [];

function configureWorld(world: CANNON.World): void {
  world.allowSleep = true;
  world.broadphase = new CANNON.SAPBroadphase(world);
  const solver = world.solver;
  if (solver instanceof CANNON.GSSolver) {
    solver.iterations = 32;
    solver.tolerance = 0.00025;
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
): CANNON.Body {
  const body = new CANNON.Body({
    mass: 0,
    material: tableMaterial,
    shape: new CANNON.Box(halfExtents),
  });
  body.position.copy(position);
  world.addBody(body);
  return body;
}

function createPlanner(kinds: readonly DieKind[], boundsX: number, boundsZ: number): PlannerCache {
  const count = kinds.length;
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20.5, 0) });
  configureWorld(world);
  const staticBodies: CANNON.Body[] = [];
  const floor = new CANNON.Body({ mass: 0, material: tableMaterial, shape: new CANNON.Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);
  staticBodies.push(floor);

  const wallThickness = 1.1;
  const wallHalfHeight = 5.5;
  const wallCenterY = wallHalfHeight - 0.05;
  staticBodies.push(
    addWall(
      world,
      new CANNON.Vec3(-boundsX - wallThickness, wallCenterY, 0),
      new CANNON.Vec3(wallThickness, wallHalfHeight, boundsZ + 1.6),
    ),
    addWall(
      world,
      new CANNON.Vec3(boundsX + wallThickness, wallCenterY, 0),
      new CANNON.Vec3(wallThickness, wallHalfHeight, boundsZ + 1.6),
    ),
    addWall(
      world,
      new CANNON.Vec3(0, wallCenterY, -boundsZ - wallThickness),
      new CANNON.Vec3(boundsX + 1.6, wallHalfHeight, wallThickness),
    ),
    addWall(
      world,
      new CANNON.Vec3(0, wallCenterY, boundsZ + wallThickness),
      new CANNON.Vec3(boundsX + 1.6, wallHalfHeight, wallThickness),
    ),
  );

  const bodies: CANNON.Body[] = [];
  for (let index = 0; index < count; index += 1) {
    const body = new CANNON.Body({
      mass: BODY_MASS,
      material: diceMaterial,
      shape: createDiePhysicsShape(kinds[index]),
    });
    const crowd = Math.max(0, Math.min(1, (count - 8) / 22));
    body.linearDamping = 0.095 + crowd * 0.025;
    body.angularDamping = 0.085 + crowd * 0.045;
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.09 + crowd * 0.015;
    body.sleepTimeLimit = 0.72;
    body.addEventListener('collide', (event: { contact: CANNON.ContactEquation }) => {
      if (!currentActiveFlags[index]) return;
      const strength = Math.abs(event.contact.getImpactVelocityAlongNormal());
      if (strength <= 0.45) return;
      if (strength > 1.5) currentImpacts.push(currentStep * FIXED_STEP, index, strength);
    });
    world.addBody(body);
    bodies.push(body);
  }

  const bodyKeys = new Map<number, number>();
  bodies.forEach((body, index) => bodyKeys.set(body.id, index));
  staticBodies.forEach((body, index) => bodyKeys.set(body.id, count + index));
  return {
    kinds: kinds.slice(),
    kindsKey: kinds.join(','),
    count,
    boundsX,
    boundsZ,
    world,
    bodies,
    bodyKeys,
  };
}

function ensurePlanner(kinds: readonly DieKind[], boundsX: number, boundsZ: number): PlannerCache {
  const kindsKey = kinds.join(',');
  const valid =
    cache &&
    cache.kindsKey === kindsKey &&
    cache.count === kinds.length &&
    Math.abs(cache.boundsX - boundsX) < 1e-4 &&
    Math.abs(cache.boundsZ - boundsZ) < 1e-4;
  if (valid && cache) return cache;
  const created = createPlanner(kinds, boundsX, boundsZ);
  cache = created;
  return created;
}

function activateBody(body: CANNON.Body, launch: Float32Array, index: number): void {
  const offset = index * 6;
  body.type = CANNON.Body.DYNAMIC;
  body.mass = BODY_MASS;
  body.updateMassProperties();
  body.collisionResponse = true;
  body.velocity.set(launch[offset], launch[offset + 1], launch[offset + 2]);
  body.angularVelocity.set(launch[offset + 3], launch[offset + 4], launch[offset + 5]);
  body.force.setZero();
  body.torque.setZero();
  body.wakeUp();
  body.aabbNeedsUpdate = true;
  currentActiveFlags[index] = true;
}

function parkBody(body: CANNON.Body): void {
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

function configureLockedBody(body: CANNON.Body): void {
  body.type = CANNON.Body.KINEMATIC;
  body.mass = 0;
  body.updateMassProperties();
  body.collisionResponse = true;
  body.force.setZero();
  body.torque.setZero();
  body.wakeUp();
  body.aabbNeedsUpdate = true;
}

function resetPlanner(
  planner: PlannerCache,
  stateData: Float32Array,
  lockedCount = 0,
): { launchVelocities: Float32Array; activationDelays: Float32Array; maximumDelay: number } {
  const count = planner.bodies.length;
  const locked = Math.max(0, Math.min(count, lockedCount));
  const launchVelocities = new Float32Array(count * 6);
  const activationDelays = new Float32Array(count);
  currentActiveFlags = Array.from({ length: count }, () => false);
  let maximumDelay = 0;

  planner.bodies.forEach((body, index) => {
    const offset = index * STATE_STRIDE;
    body.position.set(stateData[offset], stateData[offset + 1], stateData[offset + 2]);
    body.quaternion.set(
      stateData[offset + 3],
      stateData[offset + 4],
      stateData[offset + 5],
      stateData[offset + 6],
    );
    body.previousPosition.copy(body.position);
    body.interpolatedPosition.copy(body.position);
    body.previousQuaternion.copy(body.quaternion);
    body.interpolatedQuaternion.copy(body.quaternion);
    const launchOffset = index * 6;
    launchVelocities[launchOffset] = stateData[offset + 7];
    launchVelocities[launchOffset + 1] = stateData[offset + 8];
    launchVelocities[launchOffset + 2] = stateData[offset + 9];
    launchVelocities[launchOffset + 3] = stateData[offset + 10];
    launchVelocities[launchOffset + 4] = stateData[offset + 11];
    launchVelocities[launchOffset + 5] = stateData[offset + 12];
    activationDelays[index] = Math.max(0, stateData[offset + 13]);

    if (index < locked) {
      configureLockedBody(body);
      currentActiveFlags[index] = true;
      return;
    }

    maximumDelay = Math.max(maximumDelay, activationDelays[index]);
    parkBody(body);
    if (activationDelays[index] <= 0) activateBody(body, launchVelocities, index);
  });

  planner.world.clearForces();
  planner.world.broadphase.dirty = true;
  return { launchVelocities, activationDelays, maximumDelay };
}

function enforceBounds(
  bodies: CANNON.Body[],
  boundsX: number,
  boundsZ: number,
  simulationTime = 0,
  lockedCount = 0,
): void {
  const margin = 0.82;
  const minX = -boundsX + margin;
  const maxX = boundsX - margin;
  const minZ = -boundsZ + margin;
  const maxZ = boundsZ - margin;
  const crowd = Math.max(0, Math.min(1, (bodies.length - 8) / 22));
  const maximumLinearSpeed = 12 - crowd * 2.2;
  const maximumVerticalSpeed = 7.5 - crowd * 1.4;
  const maximumAngularSpeed = 28 - crowd * 4;

  bodies.forEach((body, index) => {
    if (!currentActiveFlags[index] || index < lockedCount) return;
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
      const linearResistance = 0.997 - crowd * 0.0015;
      const angularResistance = 0.993 - crowd * 0.002;
      body.velocity.x *= linearResistance;
      body.velocity.z *= linearResistance;
      body.angularVelocity.scale(angularResistance, body.angularVelocity);
    }

    if (crowd > 0 && simulationTime > 2.15 && body.position.y < 6.4) {
      const speed = body.velocity.length();
      const angularSpeed = body.angularVelocity.length();
      if (speed < 2.0 && angularSpeed < 4.0) {
        const ramp = Math.max(0, Math.min(1, (simulationTime - 2.15) / 1.8)) * crowd;
        body.velocity.scale(1 - 0.024 * ramp, body.velocity);
        body.angularVelocity.scale(1 - 0.036 * ramp, body.angularVelocity);
      }
      if (simulationTime > 4.6 && speed < 0.22 && angularSpeed < 0.46) {
        body.velocity.scale(0.72, body.velocity);
        body.angularVelocity.scale(0.62, body.angularVelocity);
      }
    }

    body.velocity.y = Math.max(
      -maximumVerticalSpeed,
      Math.min(maximumVerticalSpeed, body.velocity.y),
    );
    const linearSpeed = body.velocity.length();
    if (linearSpeed > maximumLinearSpeed)
      body.velocity.scale(maximumLinearSpeed / linearSpeed, body.velocity);
    const angularSpeed = body.angularVelocity.length();
    if (angularSpeed > maximumAngularSpeed)
      body.angularVelocity.scale(maximumAngularSpeed / angularSpeed, body.angularVelocity);
  });
}

function writeFrame(target: Float32Array, frameIndex: number, bodies: CANNON.Body[]): void {
  let offset = frameIndex * bodies.length * 7;
  for (const body of bodies) {
    target[offset++] = body.position.x;
    target[offset++] = body.position.y;
    target[offset++] = body.position.z;
    target[offset++] = body.quaternion.x;
    target[offset++] = body.quaternion.y;
    target[offset++] = body.quaternion.z;
    target[offset++] = body.quaternion.w;
  }
}

function contactSignature(world: CANNON.World, bodyKeys: Map<number, number>): number[] {
  const keys: number[] = [];
  for (const contact of world.contacts) {
    const a = bodyKeys.get(contact.bi.id);
    const b = bodyKeys.get(contact.bj.id);
    if (a === undefined || b === undefined) continue;
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    keys.push(min * 128 + max);
  }
  keys.sort((a, b) => a - b);
  let write = 0;
  for (let read = 0; read < keys.length; read += 1) {
    if (read === 0 || keys[read] !== keys[read - 1]) keys[write++] = keys[read];
  }
  keys.length = write;
  return keys;
}

function contactSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  let left = 0;
  let right = 0;
  let intersection = 0;
  while (left < a.length && right < b.length) {
    if (a[left] === b[right]) {
      intersection += 1;
      left += 1;
      right += 1;
    } else if (a[left] < b[right]) left += 1;
    else right += 1;
  }
  return intersection / Math.max(1, Math.max(a.length, b.length));
}

function copyPositions(target: Float32Array, bodies: CANNON.Body[], lockedCount = 0): void {
  bodies.forEach((body, index) => {
    if (index < lockedCount) return;
    const offset = index * 3;
    target[offset] = body.position.x;
    target[offset + 1] = body.position.y;
    target[offset + 2] = body.position.z;
  });
}

function maxDisplacementSquared(
  reference: Float32Array,
  bodies: CANNON.Body[],
  lockedCount = 0,
): number {
  let maximum = 0;
  bodies.forEach((body, index) => {
    if (!currentActiveFlags[index] || index < lockedCount) return;
    const offset = index * 3;
    const dx = body.position.x - reference[offset];
    const dy = body.position.y - reference[offset + 1];
    const dz = body.position.z - reference[offset + 2];
    maximum = Math.max(maximum, dx * dx + dy * dy + dz * dz);
  });
  return maximum;
}

const lockedPositionA = new CANNON.Vec3();
const lockedPositionB = new CANNON.Vec3();
const lockedQuaternionA = new CANNON.Quaternion();
const lockedQuaternionB = new CANNON.Quaternion();
const sampleQuaternionA = new CANNON.Quaternion();
const sampleQuaternionB = new CANNON.Quaternion();
const lockedInverseQuaternion = new CANNON.Quaternion();
const lockedDeltaQuaternion = new CANNON.Quaternion();

function sampleLockedMotion(
  motion: LockedMotion,
  time: number,
  dieIndex: number,
  position: CANNON.Vec3,
  quaternion: CANNON.Quaternion,
): void {
  const framePosition = Math.max(0, Math.min(motion.frameCount - 1, time / motion.step));
  const first = Math.floor(framePosition);
  const second = Math.min(first + 1, motion.frameCount - 1);
  const alpha = framePosition - first;
  const stride = motion.count * 7;
  const a = first * stride + dieIndex * 7;
  const b = second * stride + dieIndex * 7;
  position.set(
    motion.transforms[a] + (motion.transforms[b] - motion.transforms[a]) * alpha,
    motion.transforms[a + 1] + (motion.transforms[b + 1] - motion.transforms[a + 1]) * alpha,
    motion.transforms[a + 2] + (motion.transforms[b + 2] - motion.transforms[a + 2]) * alpha,
  );
  sampleQuaternionA.set(
    motion.transforms[a + 3],
    motion.transforms[a + 4],
    motion.transforms[a + 5],
    motion.transforms[a + 6],
  );
  sampleQuaternionB.set(
    motion.transforms[b + 3],
    motion.transforms[b + 4],
    motion.transforms[b + 5],
    motion.transforms[b + 6],
  );
  sampleQuaternionA.slerp(sampleQuaternionB, alpha, quaternion);
  quaternion.normalize();
}

function updateLockedBodies(
  planner: PlannerCache,
  motion: LockedMotion | undefined,
  fromTime: number,
  step: number,
  snapToEnd: boolean,
): void {
  if (!motion || motion.count <= 0) return;
  const toTime = fromTime + step;
  for (let index = 0; index < motion.count; index += 1) {
    const body = planner.bodies[index];
    sampleLockedMotion(motion, fromTime, index, lockedPositionA, lockedQuaternionA);
    sampleLockedMotion(motion, toTime, index, lockedPositionB, lockedQuaternionB);
    body.position.copy(snapToEnd ? lockedPositionB : lockedPositionA);
    body.quaternion.copy(snapToEnd ? lockedQuaternionB : lockedQuaternionA);
    body.velocity.set(
      (lockedPositionB.x - lockedPositionA.x) / step,
      (lockedPositionB.y - lockedPositionA.y) / step,
      (lockedPositionB.z - lockedPositionA.z) / step,
    );
    lockedQuaternionA.inverse(lockedInverseQuaternion);
    lockedQuaternionB.mult(lockedInverseQuaternion, lockedDeltaQuaternion);
    if (lockedDeltaQuaternion.w < 0) {
      lockedDeltaQuaternion.x *= -1;
      lockedDeltaQuaternion.y *= -1;
      lockedDeltaQuaternion.z *= -1;
      lockedDeltaQuaternion.w *= -1;
    }
    const angle = 2 * Math.acos(Math.max(-1, Math.min(1, lockedDeltaQuaternion.w)));
    const denominator = Math.sqrt(
      Math.max(1e-10, 1 - lockedDeltaQuaternion.w * lockedDeltaQuaternion.w),
    );
    if (denominator > 1e-5 && angle > 1e-6) {
      body.angularVelocity.set(
        ((lockedDeltaQuaternion.x / denominator) * angle) / step,
        ((lockedDeltaQuaternion.y / denominator) * angle) / step,
        ((lockedDeltaQuaternion.z / denominator) * angle) / step,
      );
    } else {
      body.angularVelocity.setZero();
    }
    body.aabbNeedsUpdate = true;
    body.wakeUp();
  }
  planner.world.broadphase.dirty = true;
}

function simulate(
  planner: PlannerCache,
  states: Float32Array,
  options: { record: boolean; step: number; maximumSteps: number; lockedMotion?: LockedMotion },
): SimulationResult {
  const lockedCount = options.lockedMotion?.count ?? 0;
  const { launchVelocities, activationDelays, maximumDelay } = resetPlanner(
    planner,
    states,
    lockedCount,
  );
  currentImpacts = [];
  currentStep = 0;
  const recordEvery = options.record ? RECORD_EVERY : Number.POSITIVE_INFINITY;
  const maxFrames = options.record ? Math.floor(options.maximumSteps / RECORD_EVERY) + 1 : 1;
  const frameStride = planner.bodies.length * 7;
  const transforms = new Float32Array(maxFrames * frameStride);
  let frameCount = 1;
  let slowTime = 0;
  let contactStableTime = 0;
  let displacementStableTime = 0;
  let wellSeatedTime = 0;
  let previousContacts: number[] = [];
  const stablePositions = new Float32Array(planner.bodies.length * 3);
  const restingAxes = planner.bodies.map(() => new CANNON.Vec3());
  const restingAlignments = new Float32Array(planner.bodies.length);
  copyPositions(stablePositions, planner.bodies, lockedCount);
  let settleReason = 'timeout';
  let finalAverageLinear = 0;
  let finalAverageAngular = 0;
  updateLockedBodies(planner, options.lockedMotion, 0, options.step, false);
  if (options.record) writeFrame(transforms, 0, planner.bodies);

  for (currentStep = 1; currentStep <= options.maximumSteps; currentStep += 1) {
    const simulationTime = currentStep * options.step;
    let activatedThisStep = false;
    planner.bodies.forEach((body, index) => {
      if (
        index >= lockedCount &&
        !currentActiveFlags[index] &&
        simulationTime + 1e-6 >= activationDelays[index]
      ) {
        activateBody(body, launchVelocities, index);
        activatedThisStep = true;
      }
    });
    if (activatedThisStep) {
      contactStableTime = 0;
      displacementStableTime = 0;
      wellSeatedTime = 0;
      previousContacts = [];
      copyPositions(stablePositions, planner.bodies, lockedCount);
    }

    updateLockedBodies(
      planner,
      options.lockedMotion,
      simulationTime - options.step,
      options.step,
      false,
    );
    planner.world.step(options.step);
    updateLockedBodies(
      planner,
      options.lockedMotion,
      simulationTime - options.step,
      options.step,
      true,
    );
    enforceBounds(planner.bodies, planner.boundsX, planner.boundsZ, simulationTime, lockedCount);
    const allActive = currentActiveFlags.slice(lockedCount).every(Boolean);
    let linearSum = 0;
    let angularSum = 0;
    let activeCount = 0;
    let allSlow = allActive;
    let allWellSeated = allActive;
    planner.bodies.forEach((body, index) => {
      if (!currentActiveFlags[index] || index < lockedCount) return;
      activeCount += 1;
      const speed = body.velocity.length();
      const angularSpeed = body.angularVelocity.length();
      linearSum += speed;
      angularSum += angularSpeed;
      if (!(body.sleepState === CANNON.Body.SLEEPING || (speed < 0.2 && angularSpeed < 0.28)))
        allSlow = false;
      const alignment = readRestingAlignment(
        planner.kinds[index],
        body.quaternion,
        restingAxes[index],
      );
      restingAlignments[index] = alignment;
      if (alignment < minimumRestingAlignment(planner.kinds[index])) allWellSeated = false;
    });
    activeCount = Math.max(1, activeCount);
    const averageLinear = linearSum / activeCount;
    const averageAngular = angularSum / activeCount;
    finalAverageLinear = averageLinear;
    finalAverageAngular = averageAngular;
    slowTime = allSlow ? slowTime + options.step : 0;
    wellSeatedTime = allWellSeated ? wellSeatedTime + options.step : 0;

    const contacts = contactSignature(planner.world, planner.bodyKeys);
    if (contactSimilarity(contacts, previousContacts) >= 0.82) contactStableTime += options.step;
    else {
      previousContacts = contacts;
      contactStableTime = 0;
    }

    const displacementSquared = maxDisplacementSquared(
      stablePositions,
      planner.bodies,
      lockedCount,
    );
    if (displacementSquared <= 0.009 * 0.009) displacementStableTime += options.step;
    else {
      copyPositions(stablePositions, planner.bodies, lockedCount);
      displacementStableTime = 0;
    }

    if (options.record && currentStep % recordEvery === 0) {
      writeFrame(transforms, frameCount, planner.bodies);
      frameCount += 1;
    }

    const lockedDuration = options.lockedMotion
      ? (options.lockedMotion.frameCount - 1) * options.lockedMotion.step
      : 0;
    const afterLastActivation =
      simulationTime >= Math.max(maximumDelay + 0.3, lockedDuration + 0.15);
    if (afterLastActivation && !allWellSeated) {
      planner.bodies.forEach((body, index) => {
        if (!currentActiveFlags[index] || index < lockedCount) return;
        if (restingAlignments[index] >= minimumRestingAlignment(planner.kinds[index])) return;
        releaseUnstableRestPose(body, restingAxes[index]);
      });
    }
    const sleepSettled = afterLastActivation && slowTime > 0.5;
    const contactSettled =
      afterLastActivation &&
      averageLinear < 0.11 &&
      averageAngular < 0.18 &&
      contactStableTime > 0.24 &&
      displacementStableTime > 0.22;
    const microMotionSettled =
      afterLastActivation &&
      averageLinear < 0.035 &&
      averageAngular < 0.065 &&
      displacementStableTime > 0.2;
    const mayStop =
      currentStep >= MIN_STEPS &&
      allWellSeated &&
      wellSeatedTime > 0.18 &&
      (sleepSettled || contactSettled || microMotionSettled);
    if (mayStop) {
      settleReason = contactSettled
        ? 'stable-contact-graph'
        : microMotionSettled
          ? 'micro-motion-stable'
          : 'sleep-threshold';
      break;
    }
  }

  const usedTransforms = options.record
    ? transforms.slice(0, frameCount * frameStride)
    : new Float32Array(0);
  return {
    frameCount: options.record ? frameCount : 0,
    transforms: usedTransforms,
    impacts: options.record ? new Float32Array(currentImpacts) : new Float32Array(0),
    duration: options.record ? (frameCount - 1) * RECORD_STEP : currentStep * options.step,
    settleReason,
    physicsSteps: currentStep,
    finalAverageLinear,
    finalAverageAngular,
    contactStableTime,
    displacementStableTime,
  };
}

self.addEventListener('message', (event: MessageEvent<PlanRequest>) => {
  const request = event.data;
  const count = request.kinds?.length ?? request.count ?? 0;
  const fallbackKind = request.kind ?? 'd20';
  const kinds =
    request.kinds?.length === count
      ? request.kinds
      : Array.from({ length: count }, () => fallbackKind);
  const planner = ensurePlanner(kinds, request.boundsX, request.boundsZ);
  const baseStates = new Float32Array(request.states);
  const lockedCount = Math.max(0, Math.min(count, request.lockedCount ?? 0));
  const lockedFrameCount = Math.max(0, Math.floor(request.lockedTrajectoryFrameCount ?? 0));
  const lockedStep = Number(request.lockedTrajectoryStep);
  const lockedTransforms = request.lockedTrajectory
    ? new Float32Array(request.lockedTrajectory)
    : null;
  const lockedMotion =
    lockedCount > 0 &&
    lockedFrameCount >= 2 &&
    Number.isFinite(lockedStep) &&
    lockedStep > 0 &&
    lockedTransforms &&
    lockedTransforms.length === lockedFrameCount * lockedCount * 7
      ? {
          count: lockedCount,
          step: lockedStep,
          frameCount: lockedFrameCount,
          transforms: lockedTransforms,
        }
      : undefined;
  const startedAt = performance.now();
  const result = simulate(planner, baseStates, {
    record: true,
    step: FIXED_STEP,
    maximumSteps: MAX_STEPS,
    lockedMotion,
  });
  const planningMs = performance.now() - startedAt;
  const transforms = result.transforms;
  const impacts = result.impacts;
  self.postMessage(
    {
      id: request.id,
      step: RECORD_STEP,
      frameCount: result.frameCount,
      dieCount: count,
      transforms: transforms.buffer,
      impacts: impacts.buffer,
      duration: result.duration,
      settleReason: result.settleReason,
      physicsSteps: result.physicsSteps,
      diagnostics: {
        finalAverageLinear: result.finalAverageLinear,
        finalAverageAngular: result.finalAverageAngular,
        contactStableTime: result.contactStableTime,
        displacementStableTime: result.displacementStableTime,
        candidateAttempts: 1,
        candidateSearchMs: planningMs,
        naturalTrajectory: true,
        naturalMatches: count,
        assistedDice: [],
        maximumAssistAngle: 0,
        finalTargetDots: [],
        targetSuccess: true,
        lockedKinematicDice: lockedMotion?.count ?? 0,
      },
    },
    { transfer: [transforms.buffer, impacts.buffer] },
  );
});
