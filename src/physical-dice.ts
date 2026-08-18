import * as CANNON from 'cannon-es';
import { COLLIDER_DATA } from './collider-data';
import {
  createReadablePolyhedron,
  type PolyhedronLabelAnchor,
  type PolyhedronVertex,
  type ReadablePolyhedron,
} from '../packages/renderer/src/polyhedra';
import {
  assertValidPhysicalDieDefinition,
  clonePhysicalDieDefinition,
  type CustomPhysicalDieDefinitionInput,
  type PhysicalDieDefinition,
  type PhysicalDieFaceContent,
  type PhysicalDieOutcomeSlot,
  type PhysicalDiePresentation,
  type SerializedPhysicalCollider,
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
const COPLANAR_NORMAL_DOT_EPSILON = 1e-6;
const generatedDefinitionCache = new Map<number, PhysicalDieDefinition>();
const canonicalDefinitionCache = new Map<CanonicalDieKind, PhysicalDieDefinition>();

function subtract(a: PolyhedronVertex, b: PolyhedronVertex): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: PolyhedronVertex, b: PolyhedronVertex): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
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

function centroid(vertices: readonly PolyhedronVertex[]): [number, number, number] {
  const center: [number, number, number] = [0, 0, 0];
  for (const vertex of vertices) {
    center[0] += vertex[0] / vertices.length;
    center[1] += vertex[1] / vertices.length;
    center[2] += vertex[2] / vertices.length;
  }
  return center;
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
  const faceCenter: [number, number, number] = [0, 0, 0];
  for (const index of face) {
    faceCenter[0] += vertices[index][0] / face.length;
    faceCenter[1] += vertices[index][1] / face.length;
    faceCenter[2] += vertices[index][2] / face.length;
  }
  if (dot(normal, subtract(faceCenter, centroid(vertices))) < 0) {
    normal = [-normal[0], -normal[1], -normal[2]];
  }
  return normal;
}

function groupCoplanarFaceNormals(
  vertices: readonly PolyhedronVertex[],
  faces: readonly number[][],
): PolyhedronVertex[][] {
  const groups: PolyhedronVertex[][] = [];
  for (const face of faces) {
    const normal = faceNormal(vertices, face);
    const matching = groups.find(
      (group) => dot(group[0], normal) >= 1 - COPLANAR_NORMAL_DOT_EPSILON,
    );
    if (matching) matching.push(normal);
    else groups.push([normal]);
  }
  return groups;
}

function generatedSupportFaces(shape: ReadablePolyhedron, outcomeIndex: number): number[] {
  if (shape.family === 'd1-cylinder') return [0, 1];
  if (shape.family === 'd3-cube')
    return (
      [
        [0, 1],
        [2, 3],
        [4, 5],
      ][outcomeIndex] ?? []
    );
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

function cachedDefinition<K>(
  cache: Map<K, PhysicalDieDefinition>,
  key: K,
  create: () => PhysicalDieDefinition,
): PhysicalDieDefinition {
  const cached = cache.get(key);
  if (cached) return clonePhysicalDieDefinition(cached);

  // Keep the authoritative cached object private. Public callers always receive a detached clone,
  // so mutating a returned definition cannot poison later renderer/physics requests.
  const validated = clonePhysicalDieDefinition(create());
  cache.set(key, validated);
  return clonePhysicalDieDefinition(validated);
}

function canonicalConvexDefinition(
  kind: Exclude<CanonicalDieKind, 'coin' | 'd6'>,
): PhysicalDieDefinition {
  const data = COLLIDER_DATA[kind];
  const sides = Number(kind.slice(1));
  const supportNormalGroups = groupCoplanarFaceNormals(data.vertices, data.faces);
  if (supportNormalGroups.length !== sides) {
    throw new Error(
      `Canonical ${kind} collider exposes ${supportNormalGroups.length} support planes; expected ${sides}`,
    );
  }
  return {
    id: kind,
    sides,
    geometrySource: 'canonical',
    targeting: 'symmetry',
    radius: CANONICAL_DIE_RADIUS[kind],
    collisionScale: CANONICAL_COLLISION_SCALE[kind],
    collider: convexCollider(data.vertices, data.faces),
    outcomes: supportNormalGroups.map((supportNormals, index) => ({
      index,
      value: index + 1,
      result: index + 1,
      numericValue: index + 1,
      supportNormals,
      labelAnchors: [],
    })),
  };
}

/** Returns the canonical definition used by the established standard dice. */
export function createCanonicalPhysicalDieDefinition(
  kind: CanonicalDieKind,
): PhysicalDieDefinition {
  return cachedDefinition(canonicalDefinitionCache, kind, () => {
    if (kind === 'coin') {
      return {
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
    }

    if (kind === 'd6') {
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
      return {
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
    }

    return canonicalConvexDefinition(kind);
  });
}

/**
 * Creates a first-class physical die definition for numeric side counts supported by the exact
 * generated-geometry budget.
 */
export function createGeneratedPhysicalDieDefinition(sides: number): PhysicalDieDefinition {
  return cachedDefinition(generatedDefinitionCache, sides, () => {
    const shape = createReadablePolyhedron(sides);
    if (!shape.exact) {
      throw new Error(`d${sides} exceeds the exact generated physical-die budget`);
    }
    const radius = Math.max(0.01, ...shape.vertices.map(magnitude));
    return {
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
  });
}

/**
 * Validates and clones host/theme supplied physical geometry into the same definition contract.
 * Custom definitions use relabel targeting so authoritative outcomes can be assigned after a
 * natural landing. Symmetry/fixed modes require renderer-owned rotation/search capabilities and
 * are intentionally not part of the host input contract yet.
 */
export function createCustomPhysicalDieDefinition(
  input: CustomPhysicalDieDefinitionInput,
): PhysicalDieDefinition {
  const definition: PhysicalDieDefinition = {
    id: input.id,
    sides: input.sides,
    geometrySource: 'theme',
    targeting: 'relabel',
    radius: input.radius,
    collisionScale: input.collisionScale ?? GENERATED_COLLISION_SCALE,
    collider: cloneCollider(input.collider),
    outcomes: input.outcomes.map(
      (outcome, index): PhysicalDieOutcomeSlot => ({
        index,
        value: index + 1,
        result: outcome.result ?? index + 1,
        numericValue: outcome.numericValue,
        supportNormals: outcome.supportNormals.map(cloneVertex),
        labelAnchors: (outcome.labelAnchors ?? []).map(cloneAnchor),
      }),
    ),
  };

  // Validate the caller's geometry before normalization so invalid zero/non-finite vectors cannot
  // be silently converted into plausible-looking renderer data.
  assertValidPhysicalDieDefinition(definition);
  for (const outcome of definition.outcomes) {
    outcome.supportNormals = outcome.supportNormals.map((normal) => normalize(normal));
  }

  // The shared validator/cloner is the single contract boundary for all physical definitions.
  return clonePhysicalDieDefinition(definition);
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
  const meshCenter = centroid(collider.vertices);
  const faces = collider.faces.map((source) => {
    const face = source.slice();
    const a = collider.vertices[face[0]];
    const b = collider.vertices[face[1]];
    const c = collider.vertices[face[2]];
    const winding = cross(subtract(b, a), subtract(c, a));
    const faceCenter: [number, number, number] = [0, 0, 0];
    for (const index of face) {
      faceCenter[0] += collider.vertices[index][0] / face.length;
      faceCenter[1] += collider.vertices[index][1] / face.length;
      faceCenter[2] += collider.vertices[index][2] / face.length;
    }
    if (dot(winding, subtract(faceCenter, meshCenter)) < 0) face.reverse();
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
    const numeric = definition.outcomes.findIndex(
      (outcome) => outcome.numericValue === numericValue,
    );
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
