import * as CANNON from 'cannon-es';
import {
  createPhysicalDieCollider,
  resolveLandedPhysicalOutcome,
  type PhysicalDieDefinition,
} from './physical-dice';

export const PHYSICAL_PLANNER_STEP = 1 / 120;
export const PHYSICAL_STATE_STRIDE = 14;
const MAX_STEPS = 1_080;
const MIN_STEPS = 120;
const DEFAULT_MASS = 1.12;

export interface PhysicalRollPhysics {
  mass?: number;
  sizeScale?: number;
  inertiaScale?: number;
  linearDamping?: number;
  angularDamping?: number;
}

export interface PhysicalRollEntry {
  definition: PhysicalDieDefinition;
  /** position(3), quaternion(4), velocity(3), angular velocity(3), release delay(1). */
  state: ArrayLike<number>;
  physics?: PhysicalRollPhysics;
  /** Standard renderer dice request impact events; generated visual-only dice do not. */
  captureImpacts?: boolean;
}

export interface LockedPhysicalMotion {
  count: number;
  step: number;
  frameCount: number;
  transforms: Float32Array;
}

export interface PhysicalRollPlanRequest {
  entries: PhysicalRollEntry[];
  boundsX: number;
  boundsZ: number;
  lockedCount?: number;
  lockedMotion?: LockedPhysicalMotion;
  gravity?: number;
}

export interface PhysicalRollPlanResult {
  step: number;
  frameCount: number;
  transforms: Float32Array;
  impacts: Float32Array;
  landings: Int32Array;
  duration: number;
  settleReason: string;
  physicsSteps: number;
  finalAverageLinear: number;
  finalAverageAngular: number;
  planningMs: number;
}

interface PlannerCache {
  key: string;
  boundsX: number;
  boundsZ: number;
  world: CANNON.World;
  bodies: CANNON.Body[];
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function entrySizeScale(entry: PhysicalRollEntry): number {
  return Math.max(0.05, finite(entry.physics?.sizeScale, 1));
}

function cacheKey(entries: readonly PhysicalRollEntry[]): string {
  return entries
    .map((entry) => `${entry.definition.id}@${entrySizeScale(entry).toFixed(5)}`)
    .join('|');
}

/**
 * Shared Cannon planner for canonical, generated, and theme/custom physical dice.
 * A planner instance caches its world/bodies when the physical layout is unchanged.
 */
export class PhysicalRollPlanner {
  private readonly diceMaterial = new CANNON.Material('draftroll-physical-dice');
  private readonly tableMaterial = new CANNON.Material('draftroll-physical-table');
  private cache: PlannerCache | null = null;
  private activeFlags: boolean[] = [];
  private captureImpactFlags: boolean[] = [];
  private impacts: number[] = [];
  private currentStep = 0;

  simulate(request: PhysicalRollPlanRequest): PhysicalRollPlanResult {
    const startedAt = performance.now();
    const entries = request.entries;
    if (entries.length === 0) {
      return {
        step: PHYSICAL_PLANNER_STEP,
        frameCount: 1,
        transforms: new Float32Array(),
        impacts: new Float32Array(),
        landings: new Int32Array(),
        duration: 0,
        settleReason: 'empty',
        physicsSteps: 0,
        finalAverageLinear: 0,
        finalAverageAngular: 0,
        planningMs: performance.now() - startedAt,
      };
    }

    const planner = this.ensurePlanner(entries, request.boundsX, request.boundsZ);
    planner.world.gravity.set(0, -Math.abs(finite(request.gravity, 20.5)), 0);
    const lockedCount = Math.max(0, Math.min(entries.length, request.lockedCount ?? 0));
    const lockedMotion = this.validLockedMotion(request.lockedMotion, lockedCount);
    const { delays, maximumDelay } = this.resetBodies(planner, entries, lockedCount, lockedMotion);
    const transforms: number[] = [];
    this.updateLockedBodies(planner.bodies, lockedMotion, 0, 0);
    this.appendTransforms(transforms, planner.bodies);

    const lockedDuration = lockedMotion
      ? (lockedMotion.frameCount - 1) * lockedMotion.step
      : 0;
    let stableTime = 0;
    let frameCount = 1;
    let settleReason = 'timeout';
    let finalAverageLinear = 0;
    let finalAverageAngular = 0;
    let physicsSteps = 0;

    for (this.currentStep = 1; this.currentStep <= MAX_STEPS; this.currentStep += 1) {
      physicsSteps = this.currentStep;
      const time = this.currentStep * PHYSICAL_PLANNER_STEP;
      for (let index = lockedCount; index < entries.length; index += 1) {
        if (!this.activeFlags[index] && time + 1e-6 >= delays[index]) {
          this.activateBody(planner.bodies[index], entries[index]);
          this.activeFlags[index] = true;
        }
      }

      this.updateLockedBodies(
        planner.bodies,
        lockedMotion,
        time - PHYSICAL_PLANNER_STEP,
        time,
      );
      planner.world.step(PHYSICAL_PLANNER_STEP);
      this.updateLockedBodies(
        planner.bodies,
        lockedMotion,
        time - PHYSICAL_PLANNER_STEP,
        time,
      );
      this.enforceBounds(
        planner.bodies,
        lockedCount,
        request.boundsX,
        request.boundsZ,
        time,
      );
      this.appendTransforms(transforms, planner.bodies);
      frameCount += 1;

      if (time < Math.max(maximumDelay + 0.3, lockedDuration + 0.15)) continue;
      let linear = 0;
      let angular = 0;
      let dynamicCount = 0;
      let allSlow = true;
      for (let index = lockedCount; index < planner.bodies.length; index += 1) {
        if (!this.activeFlags[index]) {
          allSlow = false;
          continue;
        }
        const body = planner.bodies[index];
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
      stableTime = allSlow ? stableTime + PHYSICAL_PLANNER_STEP : 0;
      if (this.currentStep >= MIN_STEPS && stableTime > 0.5) {
        settleReason = 'shared-contact-stable';
        break;
      }
    }

    const landings = Int32Array.from(
      planner.bodies.map((body, index) =>
        resolveLandedPhysicalOutcome(entries[index].definition, body.quaternion),
      ),
    );
    return {
      step: PHYSICAL_PLANNER_STEP,
      frameCount,
      transforms: Float32Array.from(transforms),
      impacts: Float32Array.from(this.impacts),
      landings,
      duration: (frameCount - 1) * PHYSICAL_PLANNER_STEP,
      settleReason,
      physicsSteps,
      finalAverageLinear,
      finalAverageAngular,
      planningMs: performance.now() - startedAt,
    };
  }

  private ensurePlanner(
    entries: readonly PhysicalRollEntry[],
    boundsX: number,
    boundsZ: number,
  ): PlannerCache {
    const key = cacheKey(entries);
    if (
      this.cache &&
      this.cache.key === key &&
      Math.abs(this.cache.boundsX - boundsX) < 1e-4 &&
      Math.abs(this.cache.boundsZ - boundsZ) < 1e-4
    ) {
      return this.cache;
    }

    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20.5, 0) });
    this.configureWorld(world);
    this.addTable(world, boundsX, boundsZ);
    const bodies = entries.map((entry, index) => {
      const body = new CANNON.Body({
        mass: finite(entry.physics?.mass, DEFAULT_MASS),
        material: this.diceMaterial,
        shape: createPhysicalDieCollider(entry.definition, entrySizeScale(entry)),
      });
      body.addEventListener('collide', (event: { contact: CANNON.ContactEquation }) => {
        if (!this.activeFlags[index] || !this.captureImpactFlags[index]) return;
        const strength = Math.abs(event.contact.getImpactVelocityAlongNormal());
        if (strength > 1.5) {
          this.impacts.push(this.currentStep * PHYSICAL_PLANNER_STEP, index, strength);
        }
      });
      world.addBody(body);
      return body;
    });
    this.cache = { key, boundsX, boundsZ, world, bodies };
    return this.cache;
  }

  private configureWorld(world: CANNON.World): void {
    world.allowSleep = true;
    world.broadphase = new CANNON.SAPBroadphase(world);
    if (world.solver instanceof CANNON.GSSolver) {
      world.solver.iterations = 32;
      world.solver.tolerance = 0.00025;
    }
    world.addContactMaterial(
      new CANNON.ContactMaterial(this.diceMaterial, this.tableMaterial, {
        friction: 0.28,
        restitution: 0.24,
        contactEquationStiffness: 2e7,
        contactEquationRelaxation: 4,
        frictionEquationStiffness: 1.5e7,
      }),
    );
    world.addContactMaterial(
      new CANNON.ContactMaterial(this.diceMaterial, this.diceMaterial, {
        friction: 0.19,
        restitution: 0.14,
        contactEquationStiffness: 4e7,
        contactEquationRelaxation: 3,
        frictionEquationStiffness: 2.2e7,
        frictionEquationRelaxation: 3,
      }),
    );
  }

  private addTable(world: CANNON.World, boundsX: number, boundsZ: number): void {
    const floor = new CANNON.Body({
      mass: 0,
      material: this.tableMaterial,
      shape: new CANNON.Plane(),
    });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(floor);

    const thickness = 1.1;
    const halfHeight = 5.5;
    const centerY = halfHeight - 0.05;
    const wall = (position: CANNON.Vec3, halfExtents: CANNON.Vec3): void => {
      const body = new CANNON.Body({
        mass: 0,
        material: this.tableMaterial,
        shape: new CANNON.Box(halfExtents),
      });
      body.position.copy(position);
      world.addBody(body);
    };
    wall(
      new CANNON.Vec3(-boundsX - thickness, centerY, 0),
      new CANNON.Vec3(thickness, halfHeight, boundsZ + 1.6),
    );
    wall(
      new CANNON.Vec3(boundsX + thickness, centerY, 0),
      new CANNON.Vec3(thickness, halfHeight, boundsZ + 1.6),
    );
    wall(
      new CANNON.Vec3(0, centerY, -boundsZ - thickness),
      new CANNON.Vec3(boundsX + 1.6, halfHeight, thickness),
    );
    wall(
      new CANNON.Vec3(0, centerY, boundsZ + thickness),
      new CANNON.Vec3(boundsX + 1.6, halfHeight, thickness),
    );
  }

  private resetBodies(
    planner: PlannerCache,
    entries: readonly PhysicalRollEntry[],
    lockedCount: number,
    lockedMotion: LockedPhysicalMotion | undefined,
  ): { delays: Float32Array; maximumDelay: number } {
    this.activeFlags = Array.from({ length: entries.length }, () => false);
    this.captureImpactFlags = entries.map((entry) => entry.captureImpacts === true);
    this.impacts = [];
    this.currentStep = 0;
    const delays = new Float32Array(entries.length);
    let maximumDelay = 0;

    entries.forEach((entry, index) => {
      const body = planner.bodies[index];
      const state = entry.state;
      body.position.set(state[0] ?? 0, state[1] ?? 0, state[2] ?? 0);
      body.quaternion.set(state[3] ?? 0, state[4] ?? 0, state[5] ?? 0, state[6] ?? 1);
      body.velocity.set(state[7] ?? 0, state[8] ?? 0, state[9] ?? 0);
      body.angularVelocity.set(state[10] ?? 0, state[11] ?? 0, state[12] ?? 0);
      body.previousPosition.copy(body.position);
      body.interpolatedPosition.copy(body.position);
      body.previousQuaternion.copy(body.quaternion);
      body.interpolatedQuaternion.copy(body.quaternion);
      const crowd = Math.max(0, Math.min(1, (entries.length - 8) / 22));
      body.linearDamping = finite(entry.physics?.linearDamping, 0.095 + crowd * 0.025);
      body.angularDamping = finite(entry.physics?.angularDamping, 0.085 + crowd * 0.045);
      body.allowSleep = true;
      body.sleepSpeedLimit = 0.09 + crowd * 0.015;
      body.sleepTimeLimit = 0.72;
      delays[index] = Math.max(0, state[13] ?? 0);

      if (index < lockedCount && lockedMotion) {
        this.configureLockedBody(body);
        this.activeFlags[index] = true;
        return;
      }

      maximumDelay = Math.max(maximumDelay, delays[index]);
      this.parkBody(body);
      if (delays[index] <= 0) {
        this.activateBody(body, entry);
        this.activeFlags[index] = true;
      }
    });

    planner.world.clearForces();
    planner.world.broadphase.dirty = true;
    return { delays, maximumDelay };
  }

  private activateBody(body: CANNON.Body, entry: PhysicalRollEntry): void {
    const state = entry.state;
    body.type = CANNON.Body.DYNAMIC;
    body.mass = Math.max(0.01, finite(entry.physics?.mass, DEFAULT_MASS));
    body.updateMassProperties();
    const inertiaScale = Math.max(0.1, finite(entry.physics?.inertiaScale, 1));
    if (Math.abs(inertiaScale - 1) > 1e-6) {
      body.inertia.scale(inertiaScale, body.inertia);
      body.invInertia.set(
        body.inertia.x > 0 ? 1 / body.inertia.x : 0,
        body.inertia.y > 0 ? 1 / body.inertia.y : 0,
        body.inertia.z > 0 ? 1 / body.inertia.z : 0,
      );
    }
    body.collisionResponse = true;
    body.velocity.set(state[7] ?? 0, state[8] ?? 0, state[9] ?? 0);
    body.angularVelocity.set(state[10] ?? 0, state[11] ?? 0, state[12] ?? 0);
    body.force.setZero();
    body.torque.setZero();
    body.wakeUp();
    body.aabbNeedsUpdate = true;
  }

  private parkBody(body: CANNON.Body): void {
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

  private configureLockedBody(body: CANNON.Body): void {
    body.type = CANNON.Body.KINEMATIC;
    body.mass = 0;
    body.updateMassProperties();
    body.collisionResponse = true;
    body.force.setZero();
    body.torque.setZero();
    body.wakeUp();
    body.aabbNeedsUpdate = true;
  }

  private validLockedMotion(
    motion: LockedPhysicalMotion | undefined,
    lockedCount: number,
  ): LockedPhysicalMotion | undefined {
    if (!motion || lockedCount <= 0) return undefined;
    if (
      motion.count !== lockedCount ||
      motion.frameCount < 2 ||
      !Number.isFinite(motion.step) ||
      motion.step <= 0 ||
      motion.transforms.length !== motion.frameCount * motion.count * 7
    ) {
      return undefined;
    }
    return motion;
  }

  private sampleLocked(
    motion: LockedPhysicalMotion,
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

  private updateLockedBodies(
    bodies: readonly CANNON.Body[],
    motion: LockedPhysicalMotion | undefined,
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
      const body = bodies[index];
      if (!body) continue;
      this.sampleLocked(motion, index, previousTime, previousPosition, previousQuaternion);
      this.sampleLocked(motion, index, nextTime, nextPosition, nextQuaternion);
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

  private enforceBounds(
    bodies: readonly CANNON.Body[],
    lockedCount: number,
    boundsX: number,
    boundsZ: number,
    simulationTime: number,
  ): void {
    const margin = 0.82;
    const crowd = Math.max(0, Math.min(1, (bodies.length - 8) / 22));
    const maximumLinear = 12 - crowd * 2.2;
    const maximumVertical = 7.5 - crowd * 1.4;
    const maximumAngular = 28 - crowd * 4;
    bodies.forEach((body, index) => {
      if (index < lockedCount || !this.activeFlags[index]) return;
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
        const spin = body.angularVelocity.length();
        if (speed < 2 && spin < 4) {
          const ramp = Math.max(0, Math.min(1, (simulationTime - 2.15) / 1.8)) * crowd;
          body.velocity.scale(1 - 0.024 * ramp, body.velocity);
          body.angularVelocity.scale(1 - 0.036 * ramp, body.angularVelocity);
        }
      }
      body.velocity.y = Math.max(-maximumVertical, Math.min(maximumVertical, body.velocity.y));
      const linearSpeed = body.velocity.length();
      if (linearSpeed > maximumLinear) {
        body.velocity.scale(maximumLinear / linearSpeed, body.velocity);
      }
      const angularSpeed = body.angularVelocity.length();
      if (angularSpeed > maximumAngular) {
        body.angularVelocity.scale(maximumAngular / angularSpeed, body.angularVelocity);
      }
    });
  }

  private appendTransforms(target: number[], bodies: readonly CANNON.Body[]): void {
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
}

/** Extracts a subset of interleaved physical transforms without changing their trajectory. */
export function extractPhysicalTransforms(
  transforms: Float32Array,
  frameCount: number,
  totalCount: number,
  start: number,
  count: number,
): Float32Array {
  if (count <= 0) return new Float32Array();
  const output = new Float32Array(frameCount * count * 7);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const sourceFrame = frame * totalCount * 7;
    const targetFrame = frame * count * 7;
    for (let index = 0; index < count; index += 1) {
      const source = sourceFrame + (start + index) * 7;
      const target = targetFrame + index * 7;
      output.set(transforms.subarray(source, source + 7), target);
    }
  }
  return output;
}
