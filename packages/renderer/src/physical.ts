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
 * @public
 */
export interface CustomPhysicalDieDefinitionInput {
  id: string;
  sides: number;
  targeting?: PhysicalDieTargetingMode;
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
  if (value.length !== 3 || !value.every(Number.isFinite)) {
    throw new Error(`${label} must contain three finite coordinates`);
  }
  if (!allowZero && vectorLengthSquared(value) <= 1e-18) {
    throw new Error(`${label} must not be a zero vector`);
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
    if (!Number.isSafeInteger(collider.segments) || collider.segments < 3 || collider.segments > 1_024) {
      throw new Error('Physical die cylinder segments must be an integer from 3 to 1024');
    }
    return;
  }

  if (collider.vertices.length < 4 || collider.faces.length < 4) {
    throw new Error('Convex physical dice require at least four vertices and four faces');
  }
  collider.vertices.forEach((vertex, index) =>
    assertFiniteVector(vertex, `Physical die collider vertex ${index + 1}`),
  );
  collider.faces.forEach((face, faceIndex) => {
    if (face.length < 3 || new Set(face).size !== face.length) {
      throw new Error(`Physical die collider face ${faceIndex + 1} must contain three unique vertices`);
    }
    if (
      face.some(
        (index) => !Number.isSafeInteger(index) || index < 0 || index >= collider.vertices.length,
      )
    ) {
      throw new Error(`Physical die collider face ${faceIndex + 1} contains an invalid vertex index`);
    }
  });
}

/**
 * Validates the complete serializable physical-die contract before it crosses a renderer/worker
 * ownership boundary.
 *
 * @public
 */
export function assertValidPhysicalDieDefinition(definition: PhysicalDieDefinition): void {
  if (!definition.id.trim()) throw new Error('Physical die definition requires an id');
  if (!Number.isSafeInteger(definition.sides) || definition.sides < 1 || definition.sides > 10_000) {
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
  assertValidCollider(definition.collider);

  if (definition.outcomes.length !== definition.sides) {
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
      assertFiniteNumber(outcome.numericValue, `Physical die outcome ${outcomeIndex + 1} numericValue`);
    }
    if (outcome.supportNormals.length === 0) {
      throw new Error(`Physical die outcome ${outcomeIndex + 1} requires a support normal`);
    }
    outcome.supportNormals.forEach((normal, normalIndex) =>
      assertFiniteVector(
        normal,
        `Physical die outcome ${outcomeIndex + 1} support normal ${normalIndex + 1}`,
        false,
      ),
    );
    outcome.labelAnchors.forEach((anchor, anchorIndex) => {
      if (!Number.isSafeInteger(anchor.faceIndex) || anchor.faceIndex < 0 || anchor.faceIndex >= faceCount) {
        throw new Error(
          `Physical die outcome ${outcomeIndex + 1} label anchor ${anchorIndex + 1} has an invalid face index`,
        );
      }
      assertFiniteVector(
        anchor.position,
        `Physical die outcome ${outcomeIndex + 1} label anchor ${anchorIndex + 1} position`,
      );
      assertFiniteVector(
        anchor.normal,
        `Physical die outcome ${outcomeIndex + 1} label anchor ${anchorIndex + 1} normal`,
        false,
      );
      assertFiniteVector(
        anchor.up,
        `Physical die outcome ${outcomeIndex + 1} label anchor ${anchorIndex + 1} up`,
        false,
      );
      assertFiniteNumber(
        anchor.scale,
        `Physical die outcome ${outcomeIndex + 1} label anchor ${anchorIndex + 1} scale`,
      );
      if (anchor.scale <= 0) {
        throw new Error(
          `Physical die outcome ${outcomeIndex + 1} label anchor ${anchorIndex + 1} scale must be positive`,
        );
      }
    });
  });
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
