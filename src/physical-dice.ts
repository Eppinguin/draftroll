import * as CANNON from 'cannon-es';
import { COLLIDER_DATA } from './collider-data';
import {
  createReadablePolyhedron,
  type PolyhedronLabelAnchor,
  type PolyhedronVertex,
  type ReadablePolyhedron,
} from '../packages/renderer/src/polyhedra';
import type {
  CustomPhysicalDieDefinitionInput,
  PhysicalDieDefinition,
  PhysicalDieFaceContent,
  PhysicalDieOutcomeSlot,
  PhysicalDiePresentation,
  SerializedPhysicalCollider,
} from '../packages/renderer/src/physical';
export type {
  CustomPhysicalDieDefinitionInput,
  PhysicalDieDefinition,
  PhysicalDieFaceContent,
  PhysicalDieGeometrySource,
  PhysicalDieModel,
  PhysicalDieOutcomeSlot,
  PhysicalDiePresentation,
  PhysicalDieTargetingMode,
  SerializedPhysicalCollider,
} from '../packages/renderer/src/physical';

/** Canonical physical dice with hand-authored, highly symmetric geometry. */
export type CanonicalDieKind = 'coin' | 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20';

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

function magnitude(value: PolyhedronVertex): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function normalize(value: PolyhedronVertex): [number, number, number] {
  const length = magnitude(value);
  if (length < 1e-9) return [0, 1, 0];
  return [value[0] / length, value[1] / length, value[2] / length];
}

function cloneVertex(value: PolyhedronVertex): PolyhedronVertex {
  return [value[0], value[1], value[2]];
}

function cloneAnchor(anchor: PolyhedronLabelAnchor): PolyhedronLabelAnchor {
  return {
    ...anchor,
    position: cloneVertex(anchor.position),
    normal: cloneVertex(anchor.normal),
    up: cloneVertex(anchor.up),
  };
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
    result: outcome.value,
    numericValue: outcome.value,
    supportNormals: generatedSupportFaces(shape, index).map((faceIndex) => normals[faceIndex]),
    labelAnchors: outcome.labels.map(cloneAnchor),
  }));
}

function cloneCollider(collider: SerializedPhysicalCollider): SerializedPhysicalCollider {
  if (collider.kind === 'box') {
    return { kind: 'box', halfExtents: cloneVertex(collider.halfExtents) };
  }
  if (collider.kind === 'cylinder') return { ...collider };
  return {
    kind: 'convex',
    vertices: collider.vertices.map(cloneVertex),
    faces: collider.faces.map((face) => [...face]),
  };
}

function convexCollider(
  vertices: readonly PolyhedronVertex[],
  faces: readonly number[][],
): SerializedPhysicalCollider {
  return {
    kind: 'convex',
    vertices: vertices.map(cloneVertex),
    faces: faces.map((face) => [...face]),
  };
}

function canonicalConvexDefinition(
  kind: Exclude<CanonicalDieKind, 'coin' | 'd6'>,
): PhysicalDieDefinition {
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
      result: index + 1,
      numericValue: index + 1,
      supportNormals: [normal],
      labelAnchors: [],
    })),
  };
}

/** Returns the canonical definition used by the established standard dice. */
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
        {
          index: 0,
          value: 1,
          result: 1,
          numericValue: 1,
          supportNormals: [[0, 1, 0]],
          labelAnchors: [],
        },
        {
          index: 1,
          value: 2,
          result: 2,
          numericValue: 2,
          supportNormals: [[0, -1, 0]],
          labelAnchors: [],
        },
      ],
    };
  } else if (kind === 'd6') {
    const radius = CANONICAL_DIE_RADIUS.d6;
    const half = radius * 0.86;
    const normals: PolyhedronVertex[] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
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
        result: index + 1,
        numericValue: index + 1,
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
  const radius = Math.max(0.01, ...shape.vertices.map(magnitude));
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

/**
 * Validates and clones host/theme supplied physical geometry into the same definition contract.
 * A custom mesh may use relabel targeting for dynamic content, symmetry when exact rotations are
 * known by the presentation layer, or fixed when artwork is baked permanently into the mesh.
 */
export function createCustomPhysicalDieDefinition(
  input: CustomPhysicalDieDefinitionInput,
): PhysicalDieDefinition {
  if (!input.id.trim()) throw new Error('Physical die definition requires an id');
  if (!Number.isSafeInteger(input.sides) || input.sides < 1 || input.sides > 10_000) {
    throw new Error('Physical die side count must be an integer from 1 to 10000');
  }
  if (!Number.isFinite(input.radius) || input.radius <= 0) {
    throw new Error('Physical die radius must be positive');
  }
  if (input.outcomes.length !== input.sides) {
    throw new Error('Physical die outcomes must match its logical side count');
  }
  const collisionScale = input.collisionScale ?? GENERATED_COLLISION_SCALE;
  if (!Number.isFinite(collisionScale) || collisionScale <= 0.9 || collisionScale > 1.2) {
    throw new Error('Physical die collision scale must be greater than 0.9 and at most 1.2');
  }
  if (input.collider.kind === 'convex') {
    if (input.collider.vertices.length < 4 || input.collider.faces.length < 4) {
      throw new Error('Convex physical dice require at least four vertices and four faces');
    }
    for (const face of input.collider.faces) {
      if (
        face.length < 3 ||
        face.some(
          (index) =>
            !Number.isSafeInteger(index) || index < 0 || index >= input.collider.vertices.length,
        )
      ) {
        throw new Error('Physical die collider contains an invalid face');
      }
    }
  }
  const outcomes = input.outcomes.map((outcome, index): PhysicalDieOutcomeSlot => {
    if (outcome.supportNormals.length === 0) {
      throw new Error(`Physical die outcome ${index + 1} requires a support normal`);
    }
    return {
      index,
      value: index + 1,
      result: outcome.result ?? index + 1,
      numericValue: outcome.numericValue,
      supportNormals: outcome.supportNormals.map((normal) => normalize(normal)),
      labelAnchors: (outcome.labelAnchors ?? []).map(cloneAnchor),
    };
  });
  return {
    id: input.id,
    sides: input.sides,
    geometrySource: 'theme',
    targeting: input.targeting ?? 'fixed',
    radius: input.radius,
    collisionScale,
    collider: cloneCollider(input.collider),
    outcomes,
  };
}

export function createDefaultPhysicalDiePresentation(
  definition: PhysicalDieDefinition,
): PhysicalDiePresentation {
  return {
    contents: definition.outcomes.map((outcome) => ({
      kind: 'number',
      value: outcome.value,
      ...(outcome.result !== outcome.value ? { label: String(outcome.result) } : {}),
    })),
  };
}

/** Validates presentation content independently from geometry and physics. */
export function createPhysicalDiePresentation(
  definition: PhysicalDieDefinition,
  contents: readonly PhysicalDieFaceContent[],
): PhysicalDiePresentation {
  if (contents.length !== definition.outcomes.length) {
    throw new Error('Physical die presentation must provide one content entry per outcome slot');
  }
  return { contents: contents.map((content) => ({ ...content })) };
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
 * Reorders presentation content by physical outcome slot. This is the primitive relabel operation
 * used by numeric, symbolic, icon, and texture dice alike.
 */
export function remapPhysicalDiePresentationToOutcome(
  definition: PhysicalDieDefinition,
  presentation: PhysicalDiePresentation,
  requestedOutcomeIndex: number,
  landedOutcomeIndex: number,
): PhysicalDiePresentation {
  if (definition.targeting !== 'relabel') return { contents: [...presentation.contents] };
  if (
    requestedOutcomeIndex < 0 ||
    requestedOutcomeIndex >= presentation.contents.length ||
    landedOutcomeIndex < 0 ||
    landedOutcomeIndex >= presentation.contents.length ||
    requestedOutcomeIndex === landedOutcomeIndex
  ) {
    return { contents: [...presentation.contents] };
  }
  const contents = [...presentation.contents];
  [contents[requestedOutcomeIndex], contents[landedOutcomeIndex]] = [
    contents[landedOutcomeIndex],
    contents[requestedOutcomeIndex],
  ];
  return { contents };
}

/** Numeric convenience wrapper for ordinary dN presentation. */
export function remapPhysicalDiePresentation(
  definition: PhysicalDieDefinition,
  presentation: PhysicalDiePresentation,
  requestedValue: number,
  landedOutcomeIndex: number,
): PhysicalDiePresentation {
  const sourceIndex = definition.outcomes.findIndex(
    (outcome) => outcome.value === requestedValue || outcome.result === requestedValue,
  );
  return remapPhysicalDiePresentationToOutcome(
    definition,
    presentation,
    sourceIndex,
    landedOutcomeIndex,
  );
}

/** Resolves an arbitrary authoritative result to a physical outcome slot. */
export function findPhysicalOutcomeIndex(
  definition: PhysicalDieDefinition,
  result: number | string,
  numericValue?: number,
): number {
  const exact = definition.outcomes.findIndex((outcome) => outcome.result === result);
  if (exact >= 0) return exact;
  if (numericValue !== undefined) {
    const numeric = definition.outcomes.findIndex((outcome) => outcome.numericValue === numericValue);
    if (numeric >= 0) return numeric;
  }
  if (typeof result === 'number') {
    return definition.outcomes.findIndex((outcome) => outcome.value === result);
  }
  return -1;
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
