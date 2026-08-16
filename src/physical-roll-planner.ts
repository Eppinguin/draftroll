import * as CANNON from 'cannon-es';
import {
  createPhysicalDieCollider,
  resolveLandedPhysicalOutcome,
  type PhysicalDieDefinition,
} from './physical-dice';
import {
  markUnobstructedTableDice,
  minimumPhysicalRestingAlignment,
  readPhysicalRestingAlignment,
  releaseUnstableRestPose,
} from './resting-physics';

export const PHYSICAL_PLANNER_STEP = 1 / 120;
export const PHYSICAL_STATE_STRIDE = 14;
const MAX_STEPS = 1_080;
const MIN_STEPS = 120;
const MAX_FRAMES = MAX_STEPS + 1;
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
  /** Whether contacts for this physical entry should emit impact events. */
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
  floorBodyId: number;
  bodyIndexes: Map<number, number>;
  restingAxes: CANNON.Vec3[];
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
  private readonly lockedFromPosition = new CANNON.Vec3();
  private readonly lockedToPosition = new CANNON.Vec3();
  private readonly lockedFromQuaternion = new CANNON.Quaternion();
  private readonly lockedToQuaternion = new CANNON.Quaternion();
  private readonly lockedSampleQuaternion = new CANNON.Quaternion();
  private readonly lockedInverseQuaternion = new CANNON.Quaternion();
  private readonly lockedDeltaQuaternion = new CANNON.Quaternion();
  private cache: PlannerCache | null = null;
  private activeFlags = new Uint8Array(0);
  private captureImpactFlags = new Uint8Array(0);
  private delays = new Float32Array(0);
  private unobstructedTableDice = new Uint8Array(0);
  private lastUnstableReleaseTimes = new Float32Array(0);
  private impacts: number[] = [];
  private currentStep = 0;

  simulate(request: PhysicalRollPlanRequest): PhysicalRollPlanResult {
    const startedAt = performance.now();
    const entries = request.entries;
    if (entries.length === 0) return this.emptyResult(startedAt);

    const planner = this.ensurePlanner(entries, request.boundsX, request.boundsZ);
    planner.world.gravity.set(0, -Math.abs(finite(request.gravity, 20.5)), 0);
    const lockedCount = Math.max(0, Math.min(entries.length, request.lockedCount ?? 0));
    const lockedMotion = this.validLockedMotion(request.lockedMotion, lockedCount);
    const maximumDelay = this.resetBodies(planner, entries, lockedCount, lockedMotion);
    const lockedDuration = lockedMotion ? (lockedMotion.frameCount - 1) * lockedMotion.step : 0;

    const frameStride = entries.length * 7;
    const transformBuffer = new Float32Array(MAX_FRAMES * frameStride);
    let transformOffset = 0;
    this.lastUnstableReleaseTimes.fill(Number.NEGATIVE_INFINITY);
    this.unobstructedTableDice.fill(0);

    this.updateLockedBodies(planner, lockedMotion, 0, PHYSICAL_PLANNER_STEP, false);
    transformOffset = this.appendTransforms(transformBuffer, transformOffset, planner.bodies);

    let stableTime = 0;
    let frameCount = 1;
    let settleReason = 'timeout';
    let finalAverageLinear = 0;
    let finalAverageAngular = 0;
    let physicsSteps = 0;

    for (this.currentStep = 1; this.currentStep <= MAX_STEPS; this.currentStep += 1) {
      physicsSteps = this.currentStep;
      const time = this.currentStep * PHYSICAL_PLANNER_STEP;
      let activatedThisStep = false;
      for (let index = lockedCount; index < entries.length; index += 1) {
        if (this.activeFlags[index] === 0 && time + 1e-6 >= this.delays[index]) {
          this.activateBody(planner.bodies[index], entries[index]);
          this.activeFlags[index] = 1;
          activatedThisStep = true;
        }
      }
      if (activatedThisStep) stableTime = 0;

      this.updateLockedBodies(
        planner,
        lockedMotion,
        time - PHYSICAL_PLANNER_STEP,
        PHYSICAL_PLANNER_STEP,
        false,
      );
      planner.world.step(PHYSICAL_PLANNER_STEP);
      this.updateLockedBodies(
        planner,
        lockedMotion,
        time - PHYSICAL_PLANNER_STEP,
        PHYSICAL_PLANNER_STEP,
        true,
      );
      this.enforceBounds(planner.bodies, lockedCount, request.boundsX, request.boundsZ, time);
      markUnobstructedTableDice(
        planner.world.contacts,
        planner.bodyIndexes,
        entries.length,
        planner.floorBodyId,
        this.unobstructedTableDice,
      );
      transformOffset = this.appendTransforms(transformBuffer, transformOffset, planner.bodies);
      frameCount += 1;

      const afterLastActivation = time >= Math.max(maximumDelay + 0.3, lockedDuration + 0.15);
      let allActive = true;
      for (let index = lockedCount; index < entries.length; index += 1) {
        if (this.activeFlags[index] === 0) {
          allActive = false;
          break;
        }
      }
      let allSlow = allActive;
      let allWellSeated = allActive;
      let linear = 0;
      let angular = 0;
      let dynamicCount = 0;

      for (let index = lockedCount; index < planner.bodies.length; index += 1) {
        if (this.activeFlags[index] === 0) continue;
        const body = planner.bodies[index];
        const speed = body.velocity.length();
        const spin = body.angularVelocity.length();
        linear += speed;
        angular += spin;
        dynamicCount += 1;
        if (!(body.sleepState === CANNON.Body.SLEEPING || (speed < 0.2 && spin < 0.28))) {
          allSlow = false;
        }

        if (this.unobstructedTableDice[index] === 0) continue;
        const alignment = readPhysicalRestingAlignment(
          entries[index].definition,
          body.quaternion,
          planner.restingAxes[index],
        );
        const minimum = minimumPhysicalRestingAlignment(entries[index].definition);
        if (alignment >= minimum) continue;
        allWellSeated = false;
        if (
          afterLastActivation &&
          time - this.lastUnstableReleaseTimes[index] >= 0.45 &&
          releaseUnstableRestPose(body, planner.restingAxes[index])
        ) {
          this.lastUnstableReleaseTimes[index] = time;
          stableTime = 0;
        }
      }

      finalAverageLinear = linear / Math.max(1, dynamicCount);
      finalAverageAngular = angular / Math.max(1, dynamicCount);
      stableTime =
        afterLastActivation && allSlow && allWellSeated ? stableTime + PHYSICAL_PLANNER_STEP : 0;
      if (this.currentStep >= MIN_STEPS && stableTime > 0.5) {
        settleReason = 'shared-rest-stable';
        break;
      }
    }

    const landings = new Int32Array(entries.length);
    for (let index = 0; index < planner.bodies.length; index += 1) {
      landings[index] = resolveLandedPhysicalOutcome(
        entries[index].definition,
        planner.bodies[index].quaternion,
      );
    }
    const usedTransformLength = frameCount * frameStride;
    return {
      step: PHYSICAL_PLANNER_STEP,
      frameCount,
      transforms: transformBuffer.slice(0, usedTransformLength),
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

  private emptyResult(startedAt: number): PhysicalRollPlanResult {
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

  private ensureScratchSize(size: number): void {
    if (this.activeFlags.length === size) {
      this.activeFlags.fill(0);
      this.captureImpactFlags.fill(0);
      this.delays.fill(0);
      return;
    }
    this.activeFlags = new Uint8Array(size);
    this.captureImpactFlags = new Uint8Array(size);
    this.delays = new Float32Array(size);
    this.unobstructedTableDice = new Uint8Array(size);
    this.lastUnstableReleaseTimes = new Float32Array(size);
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
    const floor = this.addTable(world, boundsX, boundsZ);
    const bodies = entries.map((entry, index) => {
      const body = new CANNON.Body({
        mass: finite(entry.physics?.mass, DEFAULT_MASS),
        material: this.diceMaterial,
        shape: createPhysicalDieCollider(entry.definition, entrySizeScale(entry)),
      });
      body.addEventListener('collide', (event: { contact: CANNON.ContactEquation }) => {
        if (this.activeFlags[index] === 0 || this.captureImpactFlags[index] === 0) return;
        const strength = Math.abs(event.contact.getImpactVelocityAlongNormal());
        if (strength > 1.5) {
          this.impacts.push(this.currentStep * PHYSICAL_PLANNER_STEP, index, strength);
        }
      });
      world.addBody(body);
      return body;
    });
    const bodyIndexes = new Map<number, number>();
    bodies.forEach((body, index) => bodyIndexes.set(body.id, index));
    bodyIndexes.set(floor.id, entries.length);
    this.cache = {
      key,
      boundsX,
      boundsZ,
      world,
      bodies,
      floorBodyId: floor.id,
      bodyIndexes,
      restingAxes: entries.map(() => new CANNON.Vec3()),
    };
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

  private addTable(world: CANNON.World, boundsX: number, boundsZ: number): CANNON.Body {
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
    return floor;
  }

  private resetBodies(
    planner: PlannerCache,
    entries: readonly PhysicalRollEntry[],
    lockedCount: number,
    lockedMotion: LockedPhysicalMotion | undefined,
  ): number {
    this.ensureScratchSize(entries.length);
    this.impacts.length = 0;
    this.currentStep = 0;
    let maximumDelay = 0;
    const crowd = Math.max(0, Math.min(1, (entries.length - 8) / 22));

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
      body.linearDamping = finite(entry.physics?.linearDamping, 0.095 + crowd * 0.025);
      body.angularDamping = finite(entry.physics?.angularDamping, 0.085 + crowd * 0.045);
      body.allowSleep = true;
      body.sleepSpeedLimit = 0.09 + crowd * 0.015;
      body.sleepTimeLimit = 0.72;
      this.delays[index] = Math.max(0, state[13] ?? 0);
      this.captureImpactFlags[index] = entry.captureImpacts === true ? 1 : 0;

      if (index < lockedCount && lockedMotion) {
        this.configureLockedBody(body);
        this.activeFlags[index] = 1;
        return;
      }

      maximumDelay = Math.max(maximumDelay, this.delays[index]);
      this.parkBody(body);
      if (this.delays[index] <= 0) {
        this.activateBody(body, entry);
        this.activeFlags[index] = 1;
      }
    });

    planner.world.clearForces();
    planner.world.broadphase.dirty = true;
    return maximumDelay;
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
    quaternion.set(
      motion.transforms[a + 3],
      motion.transforms[a + 4],
      motion.transforms[a + 5],
      motion.transforms[a + 6],
    );
    this.lockedSampleQuaternion.set(
      motion.transforms[b + 3],
      motion.transforms[b + 4],
      motion.transforms[b + 5],
      motion.transforms[b + 6],
    );
    quaternion.slerp(this.lockedSampleQuaternion, alpha, quaternion);
    quaternion.normalize();
  }

  private updateLockedBodies(
    planner: PlannerCache,
    motion: LockedPhysicalMotion | undefined,
    fromTime: number,
    step: number,
    snapToEnd: boolean,
  ): void {
    if (!motion) return;
    const toTime = fromTime + step;
    for (let index = 0; index < motion.count; index += 1) {
      const body = planner.bodies[index];
      if (!body) continue;
      this.sampleLocked(
        motion,
        index,
        fromTime,
        this.lockedFromPosition,
        this.lockedFromQuaternion,
      );
      this.sampleLocked(motion, index, toTime, this.lockedToPosition, this.lockedToQuaternion);
      body.position.copy(snapToEnd ? this.lockedToPosition : this.lockedFromPosition);
      body.quaternion.copy(snapToEnd ? this.lockedToQuaternion : this.lockedFromQuaternion);
      body.velocity.set(
        (this.lockedToPosition.x - this.lockedFromPosition.x) / step,
        (this.lockedToPosition.y - this.lockedFromPosition.y) / step,
        (this.lockedToPosition.z - this.lockedFromPosition.z) / step,
      );
      this.lockedFromQuaternion.inverse(this.lockedInverseQuaternion);
      this.lockedToQuaternion.mult(this.lockedInverseQuaternion, this.lockedDeltaQuaternion);
      if (this.lockedDeltaQuaternion.w < 0) {
        this.lockedDeltaQuaternion.x *= -1;
        this.lockedDeltaQuaternion.y *= -1;
        this.lockedDeltaQuaternion.z *= -1;
        this.lockedDeltaQuaternion.w *= -1;
      }
      const angle = 2 * Math.acos(Math.max(-1, Math.min(1, this.lockedDeltaQuaternion.w)));
      const denominator = Math.sqrt(
        Math.max(1e-10, 1 - this.lockedDeltaQuaternion.w * this.lockedDeltaQuaternion.w),
      );
      if (denominator > 1e-5 && angle > 1e-6) {
        body.angularVelocity.set(
          ((this.lockedDeltaQuaternion.x / denominator) * angle) / step,
          ((this.lockedDeltaQuaternion.y / denominator) * angle) / step,
          ((this.lockedDeltaQuaternion.z / denominator) * angle) / step,
        );
      } else body.angularVelocity.setZero();
      body.aabbNeedsUpdate = true;
      body.wakeUp();
    }
    planner.world.broadphase.dirty = true;
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
      if (index < lockedCount || this.activeFlags[index] === 0) return;
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
        if (simulationTime > 4.6 && speed < 0.22 && spin < 0.46) {
          body.velocity.scale(0.72, body.velocity);
          body.angularVelocity.scale(0.62, body.angularVelocity);
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

  private appendTransforms(
    target: Float32Array,
    offset: number,
    bodies: readonly CANNON.Body[],
  ): number {
    let cursor = offset;
    for (const body of bodies) {
      target[cursor] = body.position.x;
      target[cursor + 1] = body.position.y;
      target[cursor + 2] = body.position.z;
      target[cursor + 3] = body.quaternion.x;
      target[cursor + 4] = body.quaternion.y;
      target[cursor + 5] = body.quaternion.z;
      target[cursor + 6] = body.quaternion.w;
      cursor += 7;
    }
    return cursor;
  }
}
