import * as CANNON from 'cannon-es';
import {
  createCanonicalPhysicalDieDefinition,
  type PhysicalDieDefinition,
} from './physical-dice';
import type { DieKind } from './physics-shapes';

const transformedDirection = new CANNON.Vec3();
const bestDirection = new CANNON.Vec3();
const localDirection = new CANNON.Vec3();
const tableDown = new CANNON.Vec3(0, -1, 0);

/**
 * Marks dice that touch only the table in the current physics step.
 *
 * A die resting on another die can be stably tilted. Treating that natural pile
 * as an edge-balanced die repeatedly wakes the whole pool and can extend a throw
 * to the planner timeout. A table die braced by another die or a wall can also
 * be naturally tilted, so only unobstructed table contacts are candidates for
 * the tiny numerical-rest correction below.
 */
export function markUnobstructedTableDice(
  contacts: readonly CANNON.ContactEquation[],
  bodyIndexes: ReadonlyMap<number, number>,
  dieCount: number,
  tableBodyId: number,
  target: Uint8Array,
): void {
  if (target.length !== dieCount) {
    throw new Error('Table-support buffer does not match the physical dice count.');
  }
  target.fill(0);
  for (const contact of contacts) {
    const left = bodyIndexes.get(contact.bi.id);
    const right = bodyIndexes.get(contact.bj.id);
    const leftIsDie = left !== undefined && left >= 0 && left < dieCount;
    const rightIsDie = right !== undefined && right >= 0 && right < dieCount;
    const isTableContact = contact.bi.id === tableBodyId || contact.bj.id === tableBodyId;
    if (contact.bi.id === tableBodyId && rightIsDie) target[right] |= 1;
    else if (contact.bj.id === tableBodyId && leftIsDie) target[left] |= 1;
    if (!isTableContact) {
      if (leftIsDie) target[left] |= 2;
      if (rightIsDie) target[right] |= 2;
    }
  }
  for (let index = 0; index < target.length; index += 1) {
    target[index] = target[index] === 1 ? 1 : 0;
  }
}

/** Minimum alignment that distinguishes a supporting face from an edge balance. */
export function minimumPhysicalRestingAlignment(definition: PhysicalDieDefinition): number {
  // Thin two-sided solids make even a modest tilt obvious. Other convex dice get a little more
  // tolerance for contact-solver variation while still rejecting a true edge/corner bisector.
  return definition.sides === 2 ? 0.995 : 0.99;
}

/**
 * Measures how closely any valid support normal points toward the table.
 * `correctionAxis` receives the shortest world-space rotation toward that support state.
 */
export function readPhysicalRestingAlignment(
  definition: PhysicalDieDefinition,
  quaternion: CANNON.Quaternion,
  correctionAxis: CANNON.Vec3,
): number {
  let bestDot = -Infinity;
  for (const outcome of definition.outcomes) {
    for (const [x, y, z] of outcome.supportNormals) {
      localDirection.set(x, y, z);
      quaternion.vmult(localDirection, transformedDirection);
      const alignment = -transformedDirection.y;
      if (alignment <= bestDot) continue;
      bestDot = alignment;
      bestDirection.copy(transformedDirection);
    }
  }
  // Rotate the best outward support normal toward table-down. This chooses only the nearest
  // already-natural support state; it never chooses the authoritative result.
  bestDirection.cross(tableDown, correctionAxis);
  return bestDot;
}

/** Compatibility wrapper for existing canonical callers. */
export function minimumRestingAlignment(kind: DieKind): number {
  return minimumPhysicalRestingAlignment(createCanonicalPhysicalDieDefinition(kind));
}

/** Compatibility wrapper for existing canonical callers. */
export function readRestingAlignment(
  kind: DieKind,
  quaternion: CANNON.Quaternion,
  correctionAxis: CANNON.Vec3,
): number {
  return readPhysicalRestingAlignment(
    createCanonicalPhysicalDieDefinition(kind),
    quaternion,
    correctionAxis,
  );
}

/**
 * Releases a nearly motionless edge/corner balance without choosing a result.
 *
 * The closest support state is already determined by the natural trajectory. This tiny wake-up
 * models the imperfections that make a real die topple instead of being held forever by an exact
 * numerical equilibrium in the rigid-body solver.
 */
export function releaseUnstableRestPose(body: CANNON.Body, correctionAxis: CANNON.Vec3): boolean {
  if (body.velocity.lengthSquared() >= 0.18 * 0.18) return false;
  if (body.angularVelocity.lengthSquared() >= 0.55 * 0.55) return false;
  const axisLength = correctionAxis.length();
  if (axisLength < 1e-5) return false;
  body.wakeUp();
  body.velocity.y = Math.max(body.velocity.y, 0.06);
  correctionAxis.scale(0.42 / axisLength, correctionAxis);
  body.angularVelocity.vadd(correctionAxis, body.angularVelocity);
  return true;
}
