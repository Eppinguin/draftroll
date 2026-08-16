/**
 * Generated readable convex-polyhedron geometry for physical Draftroll dice.
 *
 * @packageDocumentation
 */

/**
 * Immutable local-space XYZ coordinate used by generated physical geometry.
 *
 * @public
 */
export type PolyhedronVertex = readonly [number, number, number];

/**
 * Surface feature used to place a readable outcome label on a generated die.
 *
 * @public
 */
export type PolyhedronLabelKind = 'face' | 'edge' | 'vertex';

/**
 * Local-space placement and orientation for one printed outcome label.
 *
 * @public
 */
export interface PolyhedronLabelAnchor {
  /** Read convention chosen for this outcome. */
  kind: PolyhedronLabelKind;
  /** Physical face that receives this printed label quad. */
  faceIndex: number;
  /** Local-space center of the printed label. */
  position: PolyhedronVertex;
  /** Outward normal of the surface carrying the label. */
  normal: PolyhedronVertex;
  /** In-plane direction that should read as "up" for the glyph. */
  up: PolyhedronVertex;
  /** Suggested square label size in normalized die units. */
  scale: number;
}

/**
 * Maps one logical die outcome to its physical support state and readable labels.
 *
 * @public
 */
export interface PolyhedronOutcome {
  value: number;
  /** Face that is placed against the table for this outcome. */
  supportFace: number;
  /** Direction that points upward when the support face is down. */
  settledUp: PolyhedronVertex;
  labelKind: PolyhedronLabelKind;
  /** One face label, two edge labels, or all incident labels around a tip. */
  labels: PolyhedronLabelAnchor[];
}

/**
 * Serializable generated convex geometry with explicit physical outcome semantics.
 *
 * @public
 */
export interface ReadablePolyhedron {
  vertices: PolyhedronVertex[];
  faces: number[][];
  /** Every physical face that may be used as a support state. */
  landingFaces: number[];
  faceKinds?: Array<'landing' | 'cap' | 'rim' | 'decorative'>;
  /** Logical result-to-support/label mapping generated from the geometry. */
  outcomes: PolyhedronOutcome[];
  requestedFacets: number;
  displayFacets: number;
  exact: boolean;
  family: 'd1-cylinder' | 'd2-coin' | 'd3-cube' | 'generated-dual' | 'representative';
}

/**
 * Bounds the complexity of generated physical die geometry.
 *
 * @public
 */
export interface ReadablePolyhedronOptions {
  /** Maximum exact face count before a lower-detail representative is used. */
  maximumFacets?: number;
}

type MutableVertex = [number, number, number];

interface HullFace {
  vertices: [number, number, number];
  normal: MutableVertex;
  distance: number;
}

interface FaceInfo {
  center: MutableVertex;
  normal: MutableVertex;
  span: number;
}

interface EdgeInfo {
  a: number;
  b: number;
  faces: number[];
}

interface FeatureCandidate {
  kind: PolyhedronLabelKind;
  key: string;
  score: number;
  faceIndex?: number;
  vertexIndex?: number;
  edge?: EdgeInfo;
}

const EPSILON = 1e-9;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const add = (a: PolyhedronVertex, b: PolyhedronVertex): MutableVertex => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
const subtract = (a: PolyhedronVertex, b: PolyhedronVertex): MutableVertex => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
const scale = (value: PolyhedronVertex, amount: number): MutableVertex => [
  value[0] * amount,
  value[1] * amount,
  value[2] * amount,
];
const dot = (a: PolyhedronVertex, b: PolyhedronVertex): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: PolyhedronVertex, b: PolyhedronVertex): MutableVertex => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const magnitude = (value: PolyhedronVertex): number => Math.hypot(value[0], value[1], value[2]);
const normalize = (value: PolyhedronVertex): MutableVertex => {
  const length = magnitude(value);
  return length <= EPSILON ? [0, 0, 0] : [value[0] / length, value[1] / length, value[2] / length];
};
const midpoint = (a: PolyhedronVertex, b: PolyhedronVertex): MutableVertex => scale(add(a, b), 0.5);
const lerp = (a: PolyhedronVertex, b: PolyhedronVertex, amount: number): MutableVertex =>
  add(scale(a, 1 - amount), scale(b, amount));
const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

function faceInfo(vertices: readonly PolyhedronVertex[], face: readonly number[]): FaceInfo {
  const points = face.map((index) => vertices[index]);
  let center: MutableVertex = [0, 0, 0];
  for (const point of points) center = add(center, point);
  center = scale(center, 1 / points.length);

  let normal = normalize(cross(subtract(points[1], points[0]), subtract(points[2], points[0])));
  if (dot(normal, center) < 0) normal = scale(normal, -1);

  let span = 0;
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      span = Math.max(span, magnitude(subtract(points[first], points[second])));
    }
  }
  return { center, normal, span };
}

function uniqueEdges(faces: readonly number[][]): EdgeInfo[] {
  const edges = new Map<string, EdgeInfo>();
  faces.forEach((face, faceIndex) => {
    for (let index = 0; index < face.length; index += 1) {
      const a = face[index];
      const b = face[(index + 1) % face.length];
      const low = Math.min(a, b);
      const high = Math.max(a, b);
      const key = `${low}:${high}`;
      const existing = edges.get(key);
      if (existing) existing.faces.push(faceIndex);
      else edges.set(key, { a: low, b: high, faces: [faceIndex] });
    }
  });
  return [...edges.values()];
}

function fibonacciPoints(count: number): MutableVertex[] {
  const points: MutableVertex[] = [];
  for (let index = 0; index < count; index += 1) {
    const y = 1 - (2 * index + 1) / count;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = index * GOLDEN_ANGLE;
    points.push(normalize([Math.cos(angle) * radius, y, Math.sin(angle) * radius]));
  }
  return points;
}

/** Incremental hull specialized for points on a sphere. */
function convexHull(points: readonly PolyhedronVertex[]): HullFace[] {
  const faces: HullFace[] = [];
  const addFace = (a: number, b: number, c: number): void => {
    const normal = cross(subtract(points[b], points[a]), subtract(points[c], points[a]));
    faces.push({ vertices: [a, b, c], normal, distance: dot(normal, points[a]) });
  };

  // A two-sided seed triangle lets the first inserted point inflate a tetrahedron.
  addFace(0, 1, 2);
  addFace(0, 2, 1);

  for (let pointIndex = 3; pointIndex < points.length; pointIndex += 1) {
    const point = points[pointIndex];
    const visible = new Set<number>();
    faces.forEach((face, faceIndex) => {
      if (dot(face.normal, point) - face.distance > 1e-12) visible.add(faceIndex);
    });
    if (visible.size === 0) continue;

    const occurrences = new Map<string, number>();
    for (const faceIndex of visible) {
      const [a, b, c] = faces[faceIndex].vertices;
      for (const [start, end] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const) {
        const key = start < end ? `${start}:${end}` : `${end}:${start}`;
        occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
      }
    }

    const horizon: Array<readonly [number, number]> = [];
    for (const faceIndex of visible) {
      const [a, b, c] = faces[faceIndex].vertices;
      for (const [start, end] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const) {
        const key = start < end ? `${start}:${end}` : `${end}:${start}`;
        if (occurrences.get(key) === 1) horizon.push([start, end]);
      }
    }

    const kept = faces.filter((_face, faceIndex) => !visible.has(faceIndex));
    faces.length = 0;
    faces.push(...kept);
    for (const [start, end] of horizon) addFace(start, end, pointIndex);
  }
  return faces;
}

/**
 * Polar dual of a Fibonacci sphere. N hull vertices become exactly N planar
 * result/support faces on the generated die.
 */
function facetedSphere(facets: number): { vertices: MutableVertex[]; faces: number[][] } {
  const points = fibonacciPoints(facets);
  const hull = convexHull(points);
  const vertices: MutableVertex[] = [];
  const vertexByPlane = new Map<string, number>();
  const dualForHull: number[] = [];

  for (const face of hull) {
    const normal = normalize(face.normal);
    const distance = dot(normal, points[face.vertices[0]]);
    const vertex = scale(normal, 1 / Math.max(EPSILON, distance));
    const key = vertex.map((component) => Math.round(component * 1e7)).join(':');
    let vertexIndex = vertexByPlane.get(key);
    if (vertexIndex === undefined) {
      vertexIndex = vertices.length;
      vertices.push(vertex);
      vertexByPlane.set(key, vertexIndex);
    }
    dualForHull.push(vertexIndex);
  }

  const touching = points.map(() => [] as number[]);
  hull.forEach((face, faceIndex) => {
    for (const pointIndex of face.vertices) touching[pointIndex].push(dualForHull[faceIndex]);
  });

  const faces: number[][] = [];
  points.forEach((point, pointIndex) => {
    const ring = [...new Set(touching[pointIndex])];
    if (ring.length < 3) {
      throw new Error(`Could not construct generated d${facets} face ${pointIndex + 1}`);
    }
    const axis = normalize(point);
    const first = vertices[ring[0]];
    const projected = subtract(first, scale(axis, dot(axis, first)));
    const reference = normalize(projected);
    const side = cross(axis, reference);
    ring.sort((left, right) => {
      const leftOffset = subtract(vertices[left], point);
      const rightOffset = subtract(vertices[right], point);
      return (
        Math.atan2(dot(leftOffset, side), dot(leftOffset, reference)) -
        Math.atan2(dot(rightOffset, side), dot(rightOffset, reference))
      );
    });
    faces.push(ring);
  });

  const radius = Math.max(...vertices.map((vertex) => magnitude(vertex)), EPSILON);
  return {
    vertices: vertices.map((vertex) => scale(vertex, 1 / radius)),
    faces,
  };
}

function labelUpDirection(
  face: FaceInfo,
  position: PolyhedronVertex,
  target: PolyhedronVertex,
): MutableVertex {
  const toward = subtract(target, position);
  const projected = subtract(toward, scale(face.normal, dot(toward, face.normal)));
  if (magnitude(projected) > 1e-5) return normalize(projected);

  const reference = Math.abs(face.normal[1]) < 0.9 ? ([0, 1, 0] as const) : ([1, 0, 0] as const);
  return normalize(cross(face.normal, reference));
}

function faceAnchor(info: readonly FaceInfo[], faceIndex: number): PolyhedronLabelAnchor {
  const face = info[faceIndex];
  const reference = Math.abs(face.normal[1]) < 0.9 ? ([0, 1, 0] as const) : ([1, 0, 0] as const);
  return {
    kind: 'face',
    faceIndex,
    position: face.center,
    normal: face.normal,
    up: normalize(cross(face.normal, reference)),
    scale: clamp(face.span * 0.34, 0.18, 0.56),
  };
}

function vertexAnchors(
  vertices: readonly PolyhedronVertex[],
  faces: readonly number[][],
  info: readonly FaceInfo[],
  vertexIndex: number,
): PolyhedronLabelAnchor[] {
  const target = vertices[vertexIndex];
  return faces
    .map((face, faceIndex) => ({ face, faceIndex }))
    .filter(({ face }) => face.includes(vertexIndex))
    .map(({ faceIndex }) => {
      const face = info[faceIndex];
      const position = lerp(face.center, target, 0.5);
      return {
        kind: 'vertex' as const,
        faceIndex,
        position,
        normal: face.normal,
        up: labelUpDirection(face, position, target),
        scale: clamp(face.span * 0.22, 0.14, 0.38),
      };
    });
}

function edgeAnchors(
  vertices: readonly PolyhedronVertex[],
  info: readonly FaceInfo[],
  edge: EdgeInfo,
): PolyhedronLabelAnchor[] {
  const target = midpoint(vertices[edge.a], vertices[edge.b]);
  return edge.faces.map((faceIndex) => {
    const face = info[faceIndex];
    const position = lerp(face.center, target, 0.54);
    return {
      kind: 'edge' as const,
      faceIndex,
      position,
      normal: face.normal,
      up: labelUpDirection(face, position, target),
      scale: clamp(face.span * 0.23, 0.14, 0.4),
    };
  });
}

function featureCandidates(
  vertices: readonly PolyhedronVertex[],
  info: readonly FaceInfo[],
  edges: readonly EdgeInfo[],
  supportFace: number,
): FeatureCandidate[] {
  const settledUp = scale(info[supportFace].normal, -1);
  const heights = vertices.map((vertex) => dot(vertex, settledUp));
  const minimum = Math.min(...heights);
  const maximum = Math.max(...heights);
  const range = Math.max(EPSILON, maximum - minimum);
  const topTolerance = Math.max(0.008, range * 0.035);
  const topVertices = heights
    .map((height, vertexIndex) => ({ height, vertexIndex }))
    .filter(({ height }) => maximum - height <= topTolerance)
    .map(({ vertexIndex }) => vertexIndex);

  const faceScores = info.map((face, faceIndex) => ({
    faceIndex,
    alignment: dot(face.normal, settledUp),
    height: (dot(face.center, settledUp) - minimum) / range,
  }));
  const bestFace = faceScores
    .filter(({ faceIndex }) => faceIndex !== supportFace)
    .toSorted((left, right) => right.alignment - left.alignment)[0];

  let preferred: PolyhedronLabelKind;
  if (bestFace && bestFace.alignment >= 0.76) preferred = 'face';
  else if (topVertices.length === 1) preferred = 'vertex';
  else if (
    topVertices.length === 2 &&
    edges.some(
      (edge) =>
        (edge.a === topVertices[0] && edge.b === topVertices[1]) ||
        (edge.a === topVertices[1] && edge.b === topVertices[0]),
    )
  )
    preferred = 'edge';
  else if (bestFace && bestFace.alignment >= 0.52) preferred = 'face';
  else preferred = 'vertex';

  const candidates: FeatureCandidate[] = [];
  faceScores
    .filter(({ faceIndex, alignment }) => faceIndex !== supportFace && alignment > 0.18)
    .forEach(({ faceIndex, alignment, height }) => {
      candidates.push({
        kind: 'face',
        key: `f:${faceIndex}`,
        faceIndex,
        score: alignment * 0.72 + height * 0.28 + (preferred === 'face' ? 0.45 : 0),
      });
    });

  heights.forEach((height, vertexIndex) => {
    candidates.push({
      kind: 'vertex',
      key: `v:${vertexIndex}`,
      vertexIndex,
      score: (height - minimum) / range + (preferred === 'vertex' ? 0.45 : 0),
    });
  });

  edges.forEach((edge) => {
    const first = (heights[edge.a] - minimum) / range;
    const second = (heights[edge.b] - minimum) / range;
    candidates.push({
      kind: 'edge',
      key: `e:${edge.a}:${edge.b}`,
      edge,
      score:
        Math.min(first, second) * 0.65 +
        (first + second) * 0.175 +
        (preferred === 'edge' ? 0.45 : 0),
    });
  });

  return candidates.toSorted((left, right) => right.score - left.score);
}

function generatedOutcomes(
  vertices: readonly PolyhedronVertex[],
  faces: readonly number[][],
): PolyhedronOutcome[] {
  const info = faces.map((face) => faceInfo(vertices, face));
  const edges = uniqueEdges(faces);
  const usedFeatures = new Set<string>();

  return faces.map((_face, supportFace) => {
    const candidates = featureCandidates(vertices, info, edges, supportFace);
    const candidate = candidates.find((entry) => !usedFeatures.has(entry.key)) ?? candidates[0];
    if (!candidate) {
      throw new Error(`Could not determine label feature for support face ${supportFace}`);
    }
    usedFeatures.add(candidate.key);

    let labels: PolyhedronLabelAnchor[];
    if (candidate.kind === 'face' && candidate.faceIndex !== undefined) {
      labels = [faceAnchor(info, candidate.faceIndex)];
    } else if (candidate.kind === 'edge' && candidate.edge) {
      labels = edgeAnchors(vertices, info, candidate.edge);
    } else if (candidate.vertexIndex !== undefined) {
      labels = vertexAnchors(vertices, faces, info, candidate.vertexIndex);
    } else {
      labels = [faceAnchor(info, supportFace)];
    }

    return {
      value: supportFace + 1,
      supportFace,
      settledUp: scale(info[supportFace].normal, -1),
      labelKind: candidate.kind,
      labels,
    };
  });
}

function finishGenerated(
  requestedFacets: number,
  vertices: MutableVertex[],
  faces: number[][],
  family: ReadablePolyhedron['family'],
  exact = true,
): ReadablePolyhedron {
  return {
    vertices,
    faces: faces.map((face) => [...face]),
    landingFaces: faces.map((_face, index) => index),
    faceKinds: faces.map(() => 'landing'),
    outcomes: generatedOutcomes(vertices, faces),
    requestedFacets,
    displayFacets: faces.length,
    exact,
    family,
  };
}

function d1Cylinder(segments = 18): ReadablePolyhedron {
  const vertices: MutableVertex[] = [];
  const half = 0.78;
  const radius = 0.58;
  for (const z of [-half, half]) {
    for (let index = 0; index < segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      vertices.push([Math.cos(angle) * radius, Math.sin(angle) * radius, z]);
    }
  }
  const faces: number[][] = [
    Array.from({ length: segments }, (_entry, index) => segments - 1 - index),
    Array.from({ length: segments }, (_entry, index) => segments + index),
  ];
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    faces.push([index, next, segments + next, segments + index]);
  }

  const info = faces.map((face) => faceInfo(vertices, face));
  return {
    vertices,
    faces,
    landingFaces: [0, 1],
    faceKinds: faces.map((_face, index) => (index < 2 ? 'cap' : 'rim')),
    outcomes: [
      {
        value: 1,
        supportFace: 0,
        settledUp: scale(info[0].normal, -1),
        labelKind: 'face',
        labels: [faceAnchor(info, 0), faceAnchor(info, 1)],
      },
    ],
    requestedFacets: 1,
    displayFacets: 2,
    exact: true,
    family: 'd1-cylinder',
  };
}

function d2Coin(segments = 24): ReadablePolyhedron {
  const shape = d1Cylinder(segments);
  const info = shape.faces.map((face) => faceInfo(shape.vertices, face));
  return {
    ...shape,
    outcomes: [
      {
        value: 1,
        supportFace: 1,
        settledUp: scale(info[1].normal, -1),
        labelKind: 'face',
        labels: [faceAnchor(info, 0)],
      },
      {
        value: 2,
        supportFace: 0,
        settledUp: scale(info[0].normal, -1),
        labelKind: 'face',
        labels: [faceAnchor(info, 1)],
      },
    ],
    requestedFacets: 2,
    displayFacets: 2,
    family: 'd2-coin',
  };
}

function d3Cube(): ReadablePolyhedron {
  const rawVertices: MutableVertex[] = [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ];
  const vertices = rawVertices.map((vertex) => scale(vertex, 1 / Math.sqrt(3)));
  const faces = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 4, 7, 3],
    [1, 2, 6, 5],
    [3, 7, 6, 2],
    [0, 1, 5, 4],
  ];
  const info = faces.map((face) => faceInfo(vertices, face));
  const pairs: Array<readonly [number, number]> = [
    [0, 1],
    [2, 3],
    [4, 5],
  ];
  const outcomes = pairs.map(
    ([first, second], index): PolyhedronOutcome => ({
      value: index + 1,
      supportFace: second,
      settledUp: scale(info[second].normal, -1),
      labelKind: 'face',
      labels: [faceAnchor(info, first), faceAnchor(info, second)],
    }),
  );
  return {
    vertices,
    faces,
    landingFaces: faces.map((_face, index) => index),
    faceKinds: faces.map(() => 'landing'),
    outcomes,
    requestedFacets: 3,
    displayFacets: 6,
    exact: true,
    family: 'd3-cube',
  };
}

/**
 * Generates physical presentation geometry for any numeric die.
 *
 * d1-d3 duplicate physical support surfaces because a closed convex solid cannot
 * have fewer than four faces. d4 and above use a Fibonacci-sphere polar dual
 * with exactly N planar faces. Labels are attached independently to the clearest
 * opposite feature: face center, both faces beside a high edge, or all incident
 * faces around a high vertex (the generalized d4 convention).
 *
 * Geometry never determines randomness; Draftroll supplies the authoritative
 * logical result and the renderer uses its outcome only for presentation.
 *
 * @public
 */
export function createReadablePolyhedron(
  facets: number,
  options: ReadablePolyhedronOptions = {},
): ReadablePolyhedron {
  if (!Number.isSafeInteger(facets) || facets < 1 || facets > 10_000) {
    throw new Error('Facet count must be an integer from 1 to 10000');
  }
  if (facets === 1) return d1Cylinder();
  if (facets === 2) return d2Coin();
  if (facets === 3) return d3Cube();

  const maximumFacets = Math.max(16, Math.round(options.maximumFacets ?? 256));
  const generatedFacets = Math.min(facets, maximumFacets);
  const generated = facetedSphere(generatedFacets);
  const shape = finishGenerated(
    generatedFacets,
    generated.vertices,
    generated.faces,
    facets === generatedFacets ? 'generated-dual' : 'representative',
    facets === generatedFacets,
  );
  if (facets === generatedFacets) return shape;
  return { ...shape, requestedFacets: facets, exact: false };
}
