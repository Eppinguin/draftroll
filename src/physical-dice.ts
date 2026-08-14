import * as CANNON from 'cannon-es';
import { COLLIDER_DATA } from './collider-data';
import {
  createReadablePolyhedron,
  type PolyhedronLabelAnchor,
  type PolyhedronVertex,
  type ReadablePolyhedron,
} from '../packages/renderer/src/polyhedra';

/** Canonical physical dice with hand-authored, highly symmetric geometry. */
export type CanonicalDieKind = 'coin' | 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20';

/** Where a physical die's geometry came from. */
export type PhysicalDieGeometrySource = 'canonical' | 'generated' | 'theme';

/**
 * How an authoritative result is made visible without changing the recorded physical trajectory.
 *
 * - symmetry: rotate/reindex using an exact symmetry of the solid.
 * - relabel: keep the body trajectory and move logical face content between equivalent outcome slots.
 * - fixed: artwork is permanently attached to the mesh and must be targeted before simulation.
 */
export type PhysicalDieTargetingMode = 'symmetry' | 'relabel' | 'fixed';

/** Renderer-agnostic content that can be painted into an outcome slot. */
export type PhysicalDieFaceContent =
  | { kind: 'number'; value: number }
  | { kind: 'text'; text: string }
  | { kind: 'icon'; icon: string; label?: string }
  | { kind: 'texture'; asset: string; label?: string };

export interface PhysicalDieOutcomeSlot {
  /** Stable logical slot index, independent of what is painted on it. */
  index: number;
  /** Default numeric value for ordinary numbered dice. */
  value: number;
  /** One or more outward local-space normals that represent this outcome resting on the table. */
  supportNormals: PolyhedronVertex[];
  /** Face/edge/tip anchors used by the presentation layer. */
  labelAnchors: PolyhedronLabelAnchor[];
}

export type SerializedPhysicalCollider =
  | {
      kind: 'box';
      halfExtents: PolyhedronVertex;
    }
  | {
      kind: 'cylinder';
      radiusTop: number;
      radiusBottom: number;
      height: number;
      segments: number;
    }
  | {
      kind: 'convex';
      vertices: PolyhedronVertex[];
      faces: number[][];
    };

/**
 * Geometry/physics contract shared by canonical, generated, and theme-supplied physical dice.
 * Presentation content is deliberately separate so numbers, text, icons, or textures can occupy
 * the same outcome slots without changing collision geometry.
 */
export interface PhysicalDieDefinition {
  id: string;
  sides: number;
  geometrySource: PhysicalDieGeometrySource;
  targeting: PhysicalDieTargetingMode;
  radius: number;
  collisionScale: number;
  collider: SerializedPhysicalCollider;
  outcomes: PhysicalDieOutcomeSlot[];
  /** Readable generated geometry when this definition owns arbitrary face/edge/tip anchors. */
  readableShape?: ReadablePolyhedron;
}

export interface PhysicalDiePresentation {
  contents: PhysicalDieFaceContent[];
}

export interface PhysicalDieModel {
  definition: PhysicalDieDefinition;
  presentation: PhysicalDiePresentation;
}

export interface PhysicalDiePhysicsOptions {
  sizeScale?: number;
  mass?: number;
  inertiaScale?: number;
}

export const CANONICAL_DIE_RADIUS: Record<CanonicalDieKind, number> = {
  coin: 0.72,
  d4: 0.78,
  d6: 0.63,
  d8: 0.74,
  d10: 0.72,
  d12: 0.78,
  d20: 0.78,
};

export const CANONICAL_COLLISION_SCALE: Record<CanonicalDieKind, number> = {
  coin: 1.012,
  d4: 1.022,
  d6: 1.016,
  d8: 1.022,
  d10: 1.024,
  d12: 1.024,
  d20: 1.026,
};

const GENERATED_COLLISION_SCALE = 1.024;
const generatedDefinitionCache = new Map<number, PhysicalDieDefinition>();
const canonicalDefinitionCache = new Map<CanonicalDieKind, PhysicalDieDefinition>();

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

function normalize(value: PolyhedronVertex): [number, number, number] {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length < 1e-9) return [0, 1, 0];
  return [value[0] / length, value[1] / length, value[2] / length];
}

function faceNormal(
  vertices: readonly PolyhedronVertex[],
  face: readonly number[],
): [number, number, number] {
  const a = vertices[face[0]];
  const b = vertices[face[1]];
  const c = vertices[face[2]];
  let normal = normalize(cross(subtract(b, a), subtract(c, a)));
  const center: [number, number, number] = [0, 0, 0];
  for (const index of face) {
    center[0] += vertices[index][0] / face.length;
    center[1] += vertices[index][1] / face.length;
    center[2] += vertices[index][2] / face.length;
  }
  if (dot(normal, center) < 0) normal = [-normal[0], -normal[1], -normal[2]];
  return normal;
}

function generatedSupportFaces(shape: ReadablePolyhedron, outcomeIndex: number): number[] {
  if (shape.family === 'd1-cylinder') return [0, 1];
  if (shape.family === 'd3-cube') return [[0, 1], [2, 3], [4, 5]][outcomeIndex] ?? [];
  return [shape.outcomes[outcomeIndex]?.supportFace ?? 0];
}

function outcomesFromReadableShape(shape: ReadablePolyhedron): PhysicalDieOutcomeSlot[] {
  const normals = shape.faces.map((face) => faceNormal(shape.vertices, face));
  return shape.outcomes.map((outcome, index) => ({
    index,
    value: outcome.value,
    supportNormals: generatedSupportFaces(shape, index).map((faceIndex) => normals[faceIndex]),
    labelAnchors: outcome.labels.map((anchor) => ({
      ...anchor,
      position: [...anchor.position] as PolyhedronVertex,
      normal: [...anchor.normal] as PolyhedronVertex,
      up: [...anchor.up] as PolyhedronVertex,
    })),
  }));
}

function convexCollider(
  vertices: readonly PolyhedronVertex[],
  faces: readonly number[][],
): SerializedPhysicalCollider {
  return {
    kind: 'convex',
    vertices: vertices.map((vertex) => [...vertex] as PolyhedronVertex),
    faces: faces.map((face) => [...face]),
  };
}

function canonicalConvexDefinition(kind: Exclude<CanonicalDieKind, 'coin' | 'd6'>): PhysicalDieDefinition {
  const data = COLLIDER_DATA[kind];
  const normals = data.faces.map((face) => faceNormal(data.vertices, face));
  return {
    id: kind,
    sides: Number(kind.slice(1)),
    geometrySource: 'canonical',
    targeting: 'symmetry',
    radius: CANONICAL_DIE_RADIUS[kind],
    collisionScale: CANONICAL_COLLISION_SCALE[kind],
    collider: convexCollider(data.vertices, data.faces),
    outcomes: normals.map((normal, index) => ({
      index,
      value: index + 1,
      supportNormals: [normal],
      labelAnchors: [],
    })),
  };
}

/** Returns the canonical definition used by the existing standard dice. */
export function createCanonicalPhysicalDieDefinition(kind: CanonicalDieKind): PhysicalDieDefinition {
  const cached = canonicalDefinitionCache.get(kind);
  if (cached) return cached;

  let definition: PhysicalDieDefinition;
  if (kind === 'coin') {
    definition = {
      id: kind,
      sides: 2,
      geometrySource: 'canonical',
      targeting: 'symmetry',
      radius: CANONICAL_DIE_RADIUS.coin,
      collisionScale: CANONICAL_COLLISION_SCALE.coin,
      collider: {
        kind: 'cylinder',
        radiusTop: CANONICAL_DIE_RADIUS.coin,
        radiusBottom: CANONICAL_DIE_RADIUS.coin,
        height: 0.16,
        segments: 32,
      },
      outcomes: [
        { index: 0, value: 1, supportNormals: [[0, 1, 0]], labelAnchors: [] },
        { index: 1, value: 2, supportNormals: [[0, -1, 0]], labelAnchors: [] },
      ],
    };
  } else if (kind === 'd6') {
    const radius = CANONICAL_DIE_RADIUS.d6;
    const half = radius * 0.86;
    const normals: PolyhedronVertex[] = [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ];
    definition = {
      id: kind,
      sides: 6,
      geometrySource: 'canonical',
      targeting: 'symmetry',
      radius,
      collisionScale: CANONICAL_COLLISION_SCALE.d6,
      collider: { kind: 'box', halfExtents: [half, half, half] },
      outcomes: normals.map((normal, index) => ({
        index,
        value: index + 1,
        supportNormals: [normal],
        labelAnchors: [],
      })),
    };
  } else {
    definition = canonicalConvexDefinition(kind);
  }

  canonicalDefinitionCache.set(kind, definition);
  return definition;
}

/**
 * Creates a first-class physical die definition for any numeric side count.
 * The generated polar-dual geometry supplies collision faces and readable face/edge/tip anchors.
 */
export function createGeneratedPhysicalDieDefinition(sides: number): PhysicalDieDefinition {
  const cached = generatedDefinitionCache.get(sides);
  if (cached) return cached;
  const shape = createReadablePolyhedron(sides);
  if (!shape.exact) {
    throw new Error(`d${sides} exceeds the exact generated physical-die budget`);
  }
  const radius = Math.max(
    0.01,
    ...shape.vertices.map(([x, y, z]) => Math.hypot(x, y, z)),
  );
  const definition: PhysicalDieDefinition = {
    id: `generated:d${sides}`,
    sides,
    geometrySource: 'generated',
    targeting: 'relabel',
    radius,
    collisionScale: GENERATED_COLLISION_SCALE,
    collider: convexCollider(shape.vertices, shape.faces),
    outcomes: outcomesFromReadableShape(shape),
    readableShape: shape,
  };
  generatedDefinitionCache.set(sides, definition);
  return definition;
}

export function createDefaultPhysicalDiePresentation(
  definition: PhysicalDieDefinition,
): PhysicalDiePresentation {
  return {
    contents: definition.outcomes.map((outcome) => ({ kind: 'number', value: outcome.value })),
  };
}

/** Builds the Cannon shape for any physical die definition. */
export function createPhysicalDieCollider(
  definition: PhysicalDieDefinition,
  sizeScale = 1,
): CANNON.Shape {
  const scale = definition.collisionScale * sizeScale;
  const collider = definition.collider;
  if (collider.kind === 'box') {
    return new CANNON.Box(
      new CANNON.Vec3(
        collider.halfExtents[0] * scale,
        collider.halfExtents[1] * scale,
        collider.halfExtents[2] * scale,
      ),
    );
  }
  if (collider.kind === 'cylinder') {
    return new CANNON.Cylinder(
      collider.radiusTop * scale,
      collider.radiusBottom * scale,
      collider.height * scale,
      collider.segments,
    );
  }
  const vertices = collider.vertices.map(
    ([x, y, z]) => new CANNON.Vec3(x * scale, y * scale, z * scale),
  );
  const faces = collider.faces.map((source) => {
    const face = [...source];
    const a = collider.vertices[face[0]];
    const b = collider.vertices[face[1]];
    const c = collider.vertices[face[2]];
    const winding = cross(subtract(b, a), subtract(c, a));
    const center: [number, number, number] = [0, 0, 0];
    for (const index of face) {
      center[0] += collider.vertices[index][0] / face.length;
      center[1] += collider.vertices[index][1] / face.length;
      center[2] += collider.vertices[index][2] / face.length;
    }
    if (dot(winding, center) < 0) face.reverse();
    return face;
  });
  return new CANNON.ConvexPolyhedron({ vertices, faces });
}

export function physicalDieColliderRadius(
  definition: PhysicalDieDefinition,
  sizeScale = 1,
): number {
  return definition.radius * definition.collisionScale * sizeScale;
}

/** Finds the naturally resting logical slot without caring what content is painted there. */
export function resolveLandedPhysicalOutcome(
  definition: PhysicalDieDefinition,
  quaternion: { x: number; y: number; z: number; w: number },
): number {
  if (definition.outcomes.length === 0) return 0;
  const rotation = new CANNON.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  definition.outcomes.forEach((outcome, index) => {
    const score = Math.max(
      ...outcome.supportNormals.map(([x, y, z]) => {
        const world = rotation.vmult(new CANNON.Vec3(x, y, z));
        return -world.y;
      }),
    );
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

/**
 * Reorders presentation content so a relabel-targeted die shows the requested logical result on
 * the support state selected by natural physics. The geometry and recorded transform never change.
 */
export function remapPhysicalDiePresentation(
  definition: PhysicalDieDefinition,
  presentation: PhysicalDiePresentation,
  requestedValue: number,
  landedOutcomeIndex: number,
): PhysicalDiePresentation {
  if (definition.targeting !== 'relabel') return { contents: [...presentation.contents] };
  const sourceIndex = definition.outcomes.findIndex((outcome) => outcome.value === requestedValue);
  if (
    sourceIndex < 0 ||
    landedOutcomeIndex < 0 ||
    landedOutcomeIndex >= presentation.contents.length ||
    sourceIndex === landedOutcomeIndex
  ) {
    return { contents: [...presentation.contents] };
  }
  const contents = [...presentation.contents];
  [contents[sourceIndex], contents[landedOutcomeIndex]] = [
    contents[landedOutcomeIndex],
    contents[sourceIndex],
  ];
  return { contents };
}

export function isCanonicalDieKind(value: unknown): value is CanonicalDieKind {
  return (
    value === 'coin' ||
    value === 'd4' ||
    value === 'd6' ||
    value === 'd8' ||
    value === 'd10' ||
    value === 'd12' ||
    value === 'd20'
  );
}
