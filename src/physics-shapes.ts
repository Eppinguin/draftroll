import * as CANNON from 'cannon-es';
import { COLLIDER_DATA } from './collider-data';

export type DieKind = 'coin' | 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20';

export const DIE_RADIUS: Record<DieKind, number> = {
  coin: 0.72,
  d4: 0.78,
  d6: 0.63,
  d8: 0.74,
  d10: 0.72,
  d12: 0.78,
  d20: 0.78,
};

/**
 * Narrows an untrusted string to a supported die kind.
 *
 * @remarks
 * Values arriving from `dataset` attributes or SDK callers are only correct by convention with
 * the markup or the caller. This checks them against the die table so a typo surfaces as a
 * rejected value rather than a die that silently renders with the wrong geometry.
 */
export function isDieKind(value: unknown): value is DieKind {
  return typeof value === 'string' && Object.hasOwn(DIE_RADIUS, value);
}

/**
 * Small collision skin around the visible solid.
 *
 * Cannon permits a little penetration while its iterative solver resolves a
 * contact. A collider that is exactly coplanar with the rendered mesh can
 * therefore make two dice appear to overlap for a frame. The skin remains
 * below the visual bevel/edge width, so it prevents visible intersections
 * without producing an observable floating gap.
 */
export const DIE_COLLIDER_SCALE: Record<DieKind, number> = {
  coin: 1.012,
  d4: 1.022,
  d6: 1.016,
  d8: 1.022,
  d10: 1.024,
  d12: 1.024,
  d20: 1.026,
};

export const DIE_COLLIDER_RADIUS: Record<DieKind, number> = {
  coin: DIE_RADIUS.coin * DIE_COLLIDER_SCALE.coin,
  d4: DIE_RADIUS.d4 * DIE_COLLIDER_SCALE.d4,
  d6: DIE_RADIUS.d6 * DIE_COLLIDER_SCALE.d6,
  d8: DIE_RADIUS.d8 * DIE_COLLIDER_SCALE.d8,
  d10: DIE_RADIUS.d10 * DIE_COLLIDER_SCALE.d10,
  d12: DIE_RADIUS.d12 * DIE_COLLIDER_SCALE.d12,
  d20: DIE_RADIUS.d20 * DIE_COLLIDER_SCALE.d20,
};

export function createDiePhysicsShape(kind: DieKind, sizeScale = 1): CANNON.Shape {
  const scale = DIE_COLLIDER_SCALE[kind] * sizeScale;
  if (kind === 'coin') {
    const radius = DIE_RADIUS.coin * scale;
    return new CANNON.Cylinder(radius, radius, 0.16 * scale, 32);
  }
  if (kind === 'd6') {
    const radius = DIE_RADIUS.d6 * scale;
    return new CANNON.Box(new CANNON.Vec3(radius * 0.86, radius * 0.86, radius * 0.86));
  }
  const data = COLLIDER_DATA[kind];
  return new CANNON.ConvexPolyhedron({
    vertices: data.vertices.map(([x, y, z]) => new CANNON.Vec3(x * scale, y * scale, z * scale)),
    faces: data.faces.map((face) => face.slice()),
  });
}
