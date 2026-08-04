import * as CANNON from 'cannon-es';
import { COLLIDER_DATA } from './collider-data';
import type { DieKind } from './physics-shapes';

type Direction = readonly [number, number, number];

const AXIS_DIRECTIONS: Direction[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function normalize([x, y, z]: Direction): Direction {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function colliderFaceDirections(kind: Exclude<DieKind, 'coin' | 'd4' | 'd6'>): Direction[] {
  const data = COLLIDER_DATA[kind];
  return data.faces.map((face) => {
    const a = data.vertices[face[0]];
    const b = data.vertices[face[1]];
    const c = data.vertices[face[2]];
    const ab: Direction = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac: Direction = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    return normalize([
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ]);
  });
}

const RESULT_DIRECTIONS: Record<DieKind, Direction[]> = {
  coin: [
    [0, 1, 0],
    [0, -1, 0],
  ],
  // A d4 result points through the vertex opposite its supporting face.
  d4: COLLIDER_DATA.d4.vertices.map(normalize),
  d6: AXIS_DIRECTIONS,
  d8: colliderFaceDirections('d8'),
  d10: colliderFaceDirections('d10'),
  d12: colliderFaceDirections('d12'),
  d20: colliderFaceDirections('d20'),
};

const transformedDirection = new CANNON.Vec3();
const bestDirection = new CANNON.Vec3();
const localDirection = new CANNON.Vec3();
const tableUp = new CANNON.Vec3(0, 1, 0);

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

/** Minimum upward alignment that distinguishes a supporting face from an edge balance. */
export function minimumRestingAlignment(kind: DieKind): number {
  // A thin coin makes even a modest tilt obvious. Polyhedra get a little more
  // tolerance for contact-solver variation while still rejecting every true
  // edge/corner bisector (including the shallow d20 edge angle).
  return kind === 'coin' ? 0.995 : 0.99;
}

/**
 * Measures how closely the nearest result face/direction points upward.
 * `correctionAxis` receives the shortest world-space rotation toward that face.
 */
export function readRestingAlignment(
  kind: DieKind,
  quaternion: CANNON.Quaternion,
  correctionAxis: CANNON.Vec3,
): number {
  let bestDot = -Infinity;
  for (const [x, y, z] of RESULT_DIRECTIONS[kind]) {
    localDirection.set(x, y, z);
    quaternion.vmult(localDirection, transformedDirection);
    if (transformedDirection.y <= bestDot) continue;
    bestDot = transformedDirection.y;
    bestDirection.copy(transformedDirection);
  }
  bestDirection.cross(tableUp, correctionAxis);
  return bestDot;
}

/**
 * Releases a nearly motionless edge/corner balance without choosing a result.
 *
 * The closest face is already determined by the natural trajectory. This tiny
 * wake-up models the imperfections that make a real die topple instead of being
 * held forever by an exact numerical equilibrium in the rigid-body solver.
 */
export function releaseUnstableRestPose(body: CANNON.Body, correctionAxis: CANNON.Vec3): boolean {
  if (body.velocity.lengthSquared() >= 0.18 * 0.18) return false;
  if (body.angularVelocity.lengthSquared() >= 0.55 * 0.55) return false;
  const axisLength = correctionAxis.length();
  if (axisLength < 1e-5) return false;
  body.wakeUp();
  // Briefly unload the exact contact equilibrium, then rotate toward the face
  // that was already closest. The cooldown in each planner prevents this
  // physical imperfection from becoming a continuous source of energy.
  body.velocity.y = Math.max(body.velocity.y, 0.06);
  correctionAxis.scale(0.42 / axisLength, correctionAxis);
  body.angularVelocity.vadd(correctionAxis, body.angularVelocity);
  return true;
}
