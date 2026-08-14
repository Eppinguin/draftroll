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

import type {
  PolyhedronLabelAnchor,
  PolyhedronVertex,
  ReadablePolyhedron,
} from './polyhedra';

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
