import * as CANNON from 'cannon-es';
import {
  CANONICAL_COLLISION_SCALE,
  CANONICAL_DIE_RADIUS,
  createCanonicalPhysicalDieDefinition,
  createPhysicalDieCollider,
  isCanonicalDieKind,
  type CanonicalDieKind,
} from './physical-dice';

export type DieKind = CanonicalDieKind;

export const DIE_RADIUS: Record<DieKind, number> = CANONICAL_DIE_RADIUS;

/**
 * Narrows an untrusted string to a supported canonical die kind.
 *
 * @remarks
 * Arbitrary numeric dice are physical too, but they are represented by a
 * {@link PhysicalDieDefinition} rather than being added to this legacy canonical-kind union.
 */
export function isDieKind(value: unknown): value is DieKind {
  return isCanonicalDieKind(value);
}

/** Small collision skin around the visible solid. */
export const DIE_COLLIDER_SCALE: Record<DieKind, number> = CANONICAL_COLLISION_SCALE;

export const DIE_COLLIDER_RADIUS: Record<DieKind, number> = {
  coin: DIE_RADIUS.coin * DIE_COLLIDER_SCALE.coin,
  d4: DIE_RADIUS.d4 * DIE_COLLIDER_SCALE.d4,
  d6: DIE_RADIUS.d6 * DIE_COLLIDER_SCALE.d6,
  d8: DIE_RADIUS.d8 * DIE_COLLIDER_SCALE.d8,
  d10: DIE_RADIUS.d10 * DIE_COLLIDER_SCALE.d10,
  d12: DIE_RADIUS.d12 * DIE_COLLIDER_SCALE.d12,
  d20: DIE_RADIUS.d20 * DIE_COLLIDER_SCALE.d20,
};

/**
 * Compatibility helper for the established canonical renderer.
 * All collider construction now goes through the same physical-die definition contract used by
 * arbitrary generated dice.
 */
export function createDiePhysicsShape(kind: DieKind, sizeScale = 1): CANNON.Shape {
  return createPhysicalDieCollider(createCanonicalPhysicalDieDefinition(kind), sizeScale);
}
