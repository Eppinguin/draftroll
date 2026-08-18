/**
 * Serializable physical-die contracts shared by renderer integrations.
 *
 * @remarks
 * Separates geometry and support states from face presentation so canonical, generated, and
 * theme-supplied dice can share one physics model while presenting numbers, text, icons, or
 * textures.
 *
 * @packageDocumentation
 */

import type { PolyhedronLabelAnchor, PolyhedronVertex, ReadablePolyhedron } from './polyhedra';

/**
 * Identifies the provider of one physical die's geometry.
 *
 * @public
 */
export type PhysicalDieGeometrySource = 'canonical' | 'generated' | 'theme';

/**
 * Selects how an authoritative result is made visible without changing a recorded trajectory.
 *
 * @public
 */
export type PhysicalDieTargetingMode = 'symmetry' | 'relabel' | 'fixed';

/**
 * Renderer-agnostic content painted into one physical outcome slot.
 *
 * @public
 */
export type PhysicalDieFaceContent =
  | { kind: 'number'; value: number; label?: string }
  | { kind: 'text'; text: string }
  | { kind: 'icon'; icon: string; label?: string }
  | { kind: 'texture'; asset: string; label?: string };

/**
 * Describes one stable support state independently of what is painted on it.
 *
 * @public
 */
export interface PhysicalDieOutcomeSlot {
  index: number;
  /** Default numeric ordinal used by ordinary numbered dice and legacy callers. */
  value: number;
  /** Optional system-agnostic authoritative result associated with this slot. */
  result?: number | string;
  /** Optional numeric contribution when result is symbolic. */
  numericValue?: number;
  /** One or more outward local-space normals that represent this outcome resting on the table. */
  supportNormals: PolyhedronVertex[];
  /** Face/edge/tip anchors used by the presentation layer. */
  labelAnchors: PolyhedronLabelAnchor[];
}

/**
 * Describes a serializable collider used by the browser physics planner.
 *
 * @public
 */
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
 * Defines geometry, support states, and targeting for any physical die.
 *
 * @remarks
 * Presentation content is deliberately separate so numbers, text, icons, or textures can occupy
 * the same outcome slots without changing collision geometry.
 *
 * @public
 */
export interface PhysicalDieDefinition {
  /** Stable geometry identity. Theme/custom callers should include their version in this ID. */
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

/**
 * Assigns visual content one-to-one to a definition's physical outcome slots.
 *
 * @public
 */
export interface PhysicalDiePresentation {
  contents: PhysicalDieFaceContent[];
}

/**
 * Combines one physical definition with its independent face presentation.
 *
 * @public
 */
export interface PhysicalDieModel {
  definition: PhysicalDieDefinition;
  presentation: PhysicalDiePresentation;
}

/**
 * Supplies serializable host or theme geometry for a custom physical die.
 *
 * @remarks
 * Host-supplied geometry currently supports relabel targeting only. Other targeting modes require
 * renderer-owned symmetry rotations or trajectory-search capabilities.
 *
 * @public
 */
export interface CustomPhysicalDieDefinitionInput {
  id: string;
  sides: number;
  targeting?: 'relabel';
  radius: number;
  collisionScale?: number;
  collider: SerializedPhysicalCollider;
  outcomes: Array<{
    result?: number | string;
    numericValue?: number;
    supportNormals: PolyhedronVertex[];
    labelAnchors?: PolyhedronLabelAnchor[];
  }>;
}

const MAXIMUM_CONVEX_VERTICES = 4_096;
const MAXIMUM_CONVEX_FACES = 4_096;
const MAXIMUM_VERTICES_PER_FACE = 256;
const MAXIMUM_SUPPORT_NORMALS_PER_OUTCOME = 64;
const MAXIMUM_LABEL_ANCHORS_PER_OUTCOME = 64;
const MINIMUM_NON_DEGENERATE_AREA_SQUARED = 1e-18;
// Collider assets may originate from Float32 geometry. Use a relative tolerance above the
// ~2.4e-8 coordinate drift present in canonical meshes while still rejecting material concavity.
const CONVEX_GEOMETRY_EPSILON = 5e-8;

function cloneDefinitionVertex(value: PolyhedronVertex): PolyhedronVertex {
  return [value[0], value[1], value[2]];
}

function cloneDefinitionAnchor(anchor: PolyhedronLabelAnchor): PolyhedronLabelAnchor {
  return {
    ...anchor,
    position: cloneDefinitionVertex(anchor.position),
    normal: cloneDefinitionVertex(anchor.normal),
    up: cloneDefinitionVertex(anchor.up),
  };
}

function cloneReadablePolyhedron(shape: ReadablePolyhedron): ReadablePolyhedron {
  return {
    ...shape,
    vertices: shape.vertices.map(cloneDefinitionVertex),
    faces: shape.faces.map((face) => face.slice()),
    landingFaces: shape.landingFaces.slice(),
    faceKinds: shape.faceKinds?.slice(),
    outcomes: shape.outcomes.map((outcome) => ({
      ...outcome,
      settledUp: cloneDefinitionVertex(outcome.settledUp),
      labels: outcome.labels.map(cloneDefinitionAnchor),
    })),
  };
}

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function vectorLengthSquared(value: PolyhedronVertex): number {
  return value[0] * value[0] + value[1] * value[1] + value[2] * value[2];
}

function assertFiniteVector(value: PolyhedronVertex, label: string, allowZero = true): void {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new Error(`${label} must contain three finite coordinates`);
  }
  if (!allowZero && vectorLengthSquared(value) <= MINIMUM_NON_DEGENERATE_AREA_SQUARED) {
    throw new Error(`${label} must not be a zero vector`);
  }
}

function triangleAreaSquared(
  first: PolyhedronVertex,
  second: PolyhedronVertex,
  third: PolyhedronVertex,
): number {
  const abx = second[0] - first[0];
  const aby = second[1] - first[1];
  const abz = second[2] - first[2];
  const acx = third[0] - first[0];
  const acy = third[1] - first[1];
  const acz = third[2] - first[2];
  const x = aby * acz - abz * acy;
  const y = abz * acx - abx * acz;
  const z = abx * acy - aby * acx;
  return x * x + y * y + z * z;
}

function faceHasArea(vertices: readonly PolyhedronVertex[], face: readonly number[]): boolean {
  const first = vertices[face[0]];
  for (let index = 1; index < face.length - 1; index += 1) {
    if (
      triangleAreaSquared(first, vertices[face[index]], vertices[face[index + 1]]) >
      MINIMUM_NON_DEGENERATE_AREA_SQUARED
    ) {
      return true;
    }
  }
  return false;
}

function assertValidIndexedMesh(
  vertices: readonly PolyhedronVertex[],
  faces: readonly number[][],
  label: string,
): void {
  if (vertices.length < 4 || faces.length < 4) {
    throw new Error(`${label} requires at least four vertices and four faces`);
  }
  if (vertices.length > MAXIMUM_CONVEX_VERTICES) {
    throw new Error(`${label} may contain at most ${MAXIMUM_CONVEX_VERTICES} vertices`);
  }
  if (faces.length > MAXIMUM_CONVEX_FACES) {
    throw new Error(`${label} may contain at most ${MAXIMUM_CONVEX_FACES} faces`);
  }

  vertices.forEach((vertex, index) => assertFiniteVector(vertex, `${label} vertex ${index + 1}`));
  faces.forEach((face, faceIndex) => {
    if (!Array.isArray(face) || face.length < 3 || new Set(face).size !== face.length) {
      throw new Error(`${label} face ${faceIndex + 1} must contain at least three unique vertices`);
    }
    if (face.length > MAXIMUM_VERTICES_PER_FACE) {
      throw new Error(
        `${label} face ${faceIndex + 1} may contain at most ${MAXIMUM_VERTICES_PER_FACE} vertices`,
      );
    }
    if (
      face.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= vertices.length)
    ) {
      throw new Error(`${label} face ${faceIndex + 1} contains an invalid vertex index`);
    }
    if (!faceHasArea(vertices, face)) {
      throw new Error(`${label} face ${faceIndex + 1} must have non-zero area`);
    }
  });
}

function subtractVertex(first: PolyhedronVertex, second: PolyhedronVertex): PolyhedronVertex {
  return [first[0] - second[0], first[1] - second[1], first[2] - second[2]];
}

function crossVertex(first: PolyhedronVertex, second: PolyhedronVertex): PolyhedronVertex {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function dotVertex(first: PolyhedronVertex, second: PolyhedronVertex): number {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function averageVertices(vertices: readonly PolyhedronVertex[]): PolyhedronVertex {
  const sum: [number, number, number] = [0, 0, 0];
  for (const vertex of vertices) {
    sum[0] += vertex[0];
    sum[1] += vertex[1];
    sum[2] += vertex[2];
  }
  return [sum[0] / vertices.length, sum[1] / vertices.length, sum[2] / vertices.length];
}

function meshCoordinateScale(vertices: readonly PolyhedronVertex[]): number {
  let scale = 1;
  for (const vertex of vertices) {
    scale = Math.max(scale, Math.abs(vertex[0]), Math.abs(vertex[1]), Math.abs(vertex[2]));
  }
  return scale;
}

function meshFaceNormal(
  vertices: readonly PolyhedronVertex[],
  face: readonly number[],
): PolyhedronVertex {
  const origin = vertices[face[0]];
  for (let index = 1; index < face.length - 1; index += 1) {
    const normal = crossVertex(
      subtractVertex(vertices[face[index]], origin),
      subtractVertex(vertices[face[index + 1]], origin),
    );
    if (vectorLengthSquared(normal) > MINIMUM_NON_DEGENERATE_AREA_SQUARED) return normal;
  }
  throw new Error('Convex physical die collider face must have non-zero area');
}

function assertClosedConvexMesh(
  vertices: readonly PolyhedronVertex[],
  faces: readonly number[][],
  label: string,
): void {
  const centroid = averageVertices(vertices);
  const coordinateTolerance = CONVEX_GEOMETRY_EPSILON * meshCoordinateScale(vertices);
  const edgeUse = new Map<string, number>();
  const referencedVertices = new Set<number>();

  faces.forEach((face, faceIndex) => {
    const origin = vertices[face[0]];
    const normal = meshFaceNormal(vertices, face);
    const normalLength = Math.sqrt(vectorLengthSquared(normal));
    const planeTolerance = coordinateTolerance * normalLength;
    const faceVertices = face.map((vertexIndex) => vertices[vertexIndex]);
    const faceCentroid = averageVertices(faceVertices);

    for (const vertexIndex of face) {
      const distance = Math.abs(dotVertex(normal, subtractVertex(vertices[vertexIndex], origin)));
      if (distance > planeTolerance) {
        throw new Error(`${label} face ${faceIndex + 1} must be planar`);
      }
      referencedVertices.add(vertexIndex);
    }

    const centroidDirection = dotVertex(normal, subtractVertex(faceCentroid, centroid));
    if (Math.abs(centroidDirection) <= planeTolerance) {
      throw new Error(`${label} face ${faceIndex + 1} does not bound a three-dimensional volume`);
    }
    const outwardNormal: PolyhedronVertex =
      centroidDirection > 0 ? normal : [-normal[0], -normal[1], -normal[2]];

    vertices.forEach((vertex, vertexIndex) => {
      const signedDistance = dotVertex(outwardNormal, subtractVertex(vertex, origin));
      if (signedDistance > planeTolerance) {
        throw new Error(
          `${label} is not convex: vertex ${vertexIndex + 1} lies outside face ${faceIndex + 1}`,
        );
      }
    });

    for (let index = 0; index < face.length; index += 1) {
      const first = face[index];
      const second = face[(index + 1) % face.length];
      const key = first < second ? `${first}:${second}` : `${second}:${first}`;
      edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
    }
  });

  if (referencedVertices.size !== vertices.length) {
    throw new Error(`${label} contains vertices that are not referenced by any face`);
  }
  for (const [edge, count] of edgeUse) {
    if (count !== 2) {
      throw new Error(`${label} must be a closed manifold; edge ${edge} belongs to ${count} faces`);
    }
  }
}

function colliderFaceCount(collider: SerializedPhysicalCollider): number {
  if (collider.kind === 'box') return 6;
  if (collider.kind === 'cylinder') return collider.segments + 2;
  return collider.faces.length;
}

function assertValidCollider(collider: SerializedPhysicalCollider): void {
  if (collider.kind === 'box') {
    assertFiniteVector(collider.halfExtents, 'Physical die box halfExtents');
    if (collider.halfExtents.some((value) => value <= 0)) {
      throw new Error('Physical die box halfExtents must be positive');
    }
    return;
  }

  if (collider.kind === 'cylinder') {
    assertFiniteNumber(collider.radiusTop, 'Physical die cylinder radiusTop');
    assertFiniteNumber(collider.radiusBottom, 'Physical die cylinder radiusBottom');
    assertFiniteNumber(collider.height, 'Physical die cylinder height');
    if (collider.radiusTop <= 0 || collider.radiusBottom <= 0 || collider.height <= 0) {
      throw new Error('Physical die cylinder dimensions must be positive');
    }
    if (
      !Number.isSafeInteger(collider.segments) ||
      collider.segments < 3 ||
      collider.segments > 1_024
    ) {
      throw new Error('Physical die cylinder segments must be an integer from 3 to 1024');
    }
    return;
  }

  const label = 'Convex physical die collider';
  assertValidIndexedMesh(collider.vertices, collider.faces, label);
  assertClosedConvexMesh(collider.vertices, collider.faces, label);
}

function assertValidAnchor(anchor: PolyhedronLabelAnchor, label: string, faceCount: number): void {
  if (
    !Number.isSafeInteger(anchor.faceIndex) ||
    anchor.faceIndex < 0 ||
    anchor.faceIndex >= faceCount
  ) {
    throw new Error(`${label} has an invalid face index`);
  }
  assertFiniteVector(anchor.position, `${label} position`);
  assertFiniteVector(anchor.normal, `${label} normal`, false);
  assertFiniteVector(anchor.up, `${label} up`, false);
  assertFiniteNumber(anchor.scale, `${label} scale`);
  if (anchor.scale <= 0) throw new Error(`${label} scale must be positive`);
}

function assertValidReadablePolyhedron(shape: ReadablePolyhedron, expectedSides: number): void {
  assertValidIndexedMesh(shape.vertices, shape.faces, 'Readable physical die geometry');

  if (
    !Number.isSafeInteger(shape.requestedFacets) ||
    shape.requestedFacets < 1 ||
    shape.requestedFacets > 10_000
  ) {
    throw new Error('Readable physical die requestedFacets must be an integer from 1 to 10000');
  }
  if (shape.requestedFacets !== expectedSides) {
    throw new Error('Readable physical die requestedFacets must match the logical side count');
  }
  if (
    !Number.isSafeInteger(shape.displayFacets) ||
    shape.displayFacets < 1 ||
    shape.displayFacets > shape.faces.length
  ) {
    throw new Error('Readable physical die displayFacets must be a positive bounded face count');
  }
  if (typeof shape.exact !== 'boolean') {
    throw new Error('Readable physical die exact must be a boolean');
  }
  if (
    !['d1-cylinder', 'd2-coin', 'd3-cube', 'generated-dual', 'representative'].includes(
      shape.family,
    )
  ) {
    throw new Error('Readable physical die has an invalid geometry family');
  }
  if (!shape.exact || shape.family === 'representative') {
    throw new Error('Physical die definitions require exact readable geometry');
  }
  if (!Array.isArray(shape.landingFaces) || shape.landingFaces.length === 0) {
    throw new Error('Readable physical die requires at least one landing face');
  }
  if (new Set(shape.landingFaces).size !== shape.landingFaces.length) {
    throw new Error('Readable physical die landing faces must be unique');
  }
  if (
    shape.landingFaces.some(
      (faceIndex) =>
        !Number.isSafeInteger(faceIndex) || faceIndex < 0 || faceIndex >= shape.faces.length,
    )
  ) {
    throw new Error('Readable physical die contains an invalid landing face index');
  }
  if (shape.faceKinds) {
    if (shape.faceKinds.length !== shape.faces.length) {
      throw new Error('Readable physical die faceKinds must match its face count');
    }
    if (shape.faceKinds.some((kind) => !['landing', 'cap', 'rim', 'decorative'].includes(kind))) {
      throw new Error('Readable physical die contains an invalid face kind');
    }
  }
  if (!Array.isArray(shape.outcomes) || shape.outcomes.length !== expectedSides) {
    throw new Error('Readable physical die outcomes must match its logical side count');
  }

  shape.outcomes.forEach((outcome, outcomeIndex) => {
    assertFiniteNumber(outcome.value, `Readable physical die outcome ${outcomeIndex + 1} value`);
    if (
      !Number.isSafeInteger(outcome.supportFace) ||
      outcome.supportFace < 0 ||
      outcome.supportFace >= shape.faces.length
    ) {
      throw new Error(
        `Readable physical die outcome ${outcomeIndex + 1} has an invalid support face`,
      );
    }
    assertFiniteVector(
      outcome.settledUp,
      `Readable physical die outcome ${outcomeIndex + 1} settledUp`,
      false,
    );
    if (!['face', 'edge', 'vertex'].includes(outcome.labelKind)) {
      throw new Error(
        `Readable physical die outcome ${outcomeIndex + 1} has an invalid label kind`,
      );
    }
    if (!Array.isArray(outcome.labels) || outcome.labels.length === 0) {
      throw new Error(`Readable physical die outcome ${outcomeIndex + 1} requires a label anchor`);
    }
    if (outcome.labels.length > MAXIMUM_LABEL_ANCHORS_PER_OUTCOME) {
      throw new Error(
        `Readable physical die outcome ${outcomeIndex + 1} may contain at most ${MAXIMUM_LABEL_ANCHORS_PER_OUTCOME} label anchors`,
      );
    }
    outcome.labels.forEach((anchor, anchorIndex) =>
      assertValidAnchor(
        anchor,
        `Readable physical die outcome ${outcomeIndex + 1} label anchor ${anchorIndex + 1}`,
        shape.faces.length,
      ),
    );
  });
}

/**
 * Validates the complete serializable physical-die contract before it crosses a renderer/worker
 * ownership boundary.
 *
 * @public
 */
export function assertValidPhysicalDieDefinition(definition: PhysicalDieDefinition): void {
  if (!definition || typeof definition !== 'object') {
    throw new Error('Physical die definition must be an object');
  }
  if (typeof definition.id !== 'string' || !definition.id.trim()) {
    throw new Error('Physical die definition requires an id');
  }
  if (
    !Number.isSafeInteger(definition.sides) ||
    definition.sides < 1 ||
    definition.sides > 10_000
  ) {
    throw new Error('Physical die side count must be an integer from 1 to 10000');
  }
  if (!['canonical', 'generated', 'theme'].includes(definition.geometrySource)) {
    throw new Error(`Physical die '${definition.id}' has an invalid geometry source`);
  }
  if (!['symmetry', 'relabel', 'fixed'].includes(definition.targeting)) {
    throw new Error(`Physical die '${definition.id}' has an invalid targeting mode`);
  }
  assertFiniteNumber(definition.radius, 'Physical die radius');
  if (definition.radius <= 0) throw new Error('Physical die radius must be positive');
  assertFiniteNumber(definition.collisionScale, 'Physical die collision scale');
  if (definition.collisionScale <= 0.9 || definition.collisionScale > 1.2) {
    throw new Error('Physical die collision scale must be greater than 0.9 and at most 1.2');
  }
  if (!definition.collider || typeof definition.collider !== 'object') {
    throw new Error('Physical die definition requires a collider');
  }
  assertValidCollider(definition.collider);

  if (!Array.isArray(definition.outcomes) || definition.outcomes.length !== definition.sides) {
    throw new Error('Physical die outcomes must match its logical side count');
  }
  const faceCount = colliderFaceCount(definition.collider);
  definition.outcomes.forEach((outcome, outcomeIndex) => {
    if (outcome.index !== outcomeIndex) {
      throw new Error(`Physical die outcome ${outcomeIndex + 1} must use index ${outcomeIndex}`);
    }
    assertFiniteNumber(outcome.value, `Physical die outcome ${outcomeIndex + 1} value`);
    if (typeof outcome.result === 'number') {
      assertFiniteNumber(outcome.result, `Physical die outcome ${outcomeIndex + 1} result`);
    } else if (outcome.result !== undefined && typeof outcome.result !== 'string') {
      throw new Error(`Physical die outcome ${outcomeIndex + 1} result must be a number or string`);
    }
    if (outcome.numericValue !== undefined) {
      assertFiniteNumber(
        outcome.numericValue,
        `Physical die outcome ${outcomeIndex + 1} numericValue`,
      );
    }
    if (!Array.isArray(outcome.supportNormals) || outcome.supportNormals.length === 0) {
      throw new Error(`Physical die outcome ${outcomeIndex + 1} requires a support normal`);
    }
    if (outcome.supportNormals.length > MAXIMUM_SUPPORT_NORMALS_PER_OUTCOME) {
      throw new Error(
        `Physical die outcome ${outcomeIndex + 1} may contain at most ${MAXIMUM_SUPPORT_NORMALS_PER_OUTCOME} support normals`,
      );
    }
    outcome.supportNormals.forEach((normal, normalIndex) =>
      assertFiniteVector(
        normal,
        `Physical die outcome ${outcomeIndex + 1} support normal ${normalIndex + 1}`,
        false,
      ),
    );
    if (!Array.isArray(outcome.labelAnchors)) {
      throw new Error(`Physical die outcome ${outcomeIndex + 1} label anchors must be an array`);
    }
    if (outcome.labelAnchors.length > MAXIMUM_LABEL_ANCHORS_PER_OUTCOME) {
      throw new Error(
        `Physical die outcome ${outcomeIndex + 1} may contain at most ${MAXIMUM_LABEL_ANCHORS_PER_OUTCOME} label anchors`,
      );
    }
    outcome.labelAnchors.forEach((anchor, anchorIndex) =>
      assertValidAnchor(
        anchor,
        `Physical die outcome ${outcomeIndex + 1} label anchor ${anchorIndex + 1}`,
        faceCount,
      ),
    );
  });

  if (definition.readableShape) {
    assertValidReadablePolyhedron(definition.readableShape, definition.sides);
  }
}

/**
 * Deep-clones a serializable physical die definition for replay and bridge ownership boundaries.
 * Validation is intentionally performed here so every renderer handoff enforces the same contract.
 *
 * @public
 */
export function clonePhysicalDieDefinition(
  definition: PhysicalDieDefinition,
): PhysicalDieDefinition {
  assertValidPhysicalDieDefinition(definition);
  const collider: SerializedPhysicalCollider =
    definition.collider.kind === 'box'
      ? { kind: 'box', halfExtents: cloneDefinitionVertex(definition.collider.halfExtents) }
      : definition.collider.kind === 'cylinder'
        ? { ...definition.collider }
        : {
            kind: 'convex',
            vertices: definition.collider.vertices.map(cloneDefinitionVertex),
            faces: definition.collider.faces.map((face) => face.slice()),
          };
  return {
    ...definition,
    collider,
    outcomes: definition.outcomes.map((outcome) => ({
      ...outcome,
      supportNormals: outcome.supportNormals.map(cloneDefinitionVertex),
      labelAnchors: outcome.labelAnchors.map(cloneDefinitionAnchor),
    })),
    readableShape: definition.readableShape
      ? cloneReadablePolyhedron(definition.readableShape)
      : undefined,
  };
}
