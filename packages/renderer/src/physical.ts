import type {
  PolyhedronLabelAnchor,
  PolyhedronVertex,
  ReadablePolyhedron,
} from './polyhedra';

/** Where a physical die's geometry came from. */
export type PhysicalDieGeometrySource = 'canonical' | 'generated' | 'theme';

/**
 * How an authoritative result is made visible without changing a recorded physical trajectory.
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
 * Stable support state on a physical die, independent of what is painted on it.
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
 * Serializable collider used by the browser physics planner.
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
 * Geometry/physics contract shared by canonical, generated, and theme-supplied physical dice.
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
 * Visual content assigned one-to-one to the physical outcome slots.
 *
 * @public
 */
export interface PhysicalDiePresentation {
  contents: PhysicalDieFaceContent[];
}

/**
 * Complete geometry plus presentation description for one physical die.
 *
 * @public
 */
export interface PhysicalDieModel {
  definition: PhysicalDieDefinition;
  presentation: PhysicalDiePresentation;
}

/**
 * Serializable input for a theme or host that supplies its own physical die geometry.
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
