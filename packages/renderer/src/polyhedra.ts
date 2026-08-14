export type PolyhedronVertex = readonly [number, number, number];

export interface ReadablePolyhedron {
  vertices: PolyhedronVertex[];
  faces: number[][];
  /** Faces that are meaningful resting/result surfaces. Decorative faces may be omitted. */
  landingFaces: number[];
  /** Optional semantic classification for renderers that style result and decorative faces differently. */
  faceKinds?: Array<'landing' | 'cap' | 'rim' | 'decorative'>;
  requestedFacets: number;
  displayFacets: number;
  exact: boolean;
  family:
    | 'd1-cylinder'
    | 'cube'
    | 'tetrahedron'
    | 'triangular-prism'
    | 'trapezohedron'
    | 'prism-barrel'
    | 'drum'
    | 'representative';
}

export interface ReadablePolyhedronOptions {
  pointedLimit?: number;
  maximumFacets?: number;
}

const TAU = Math.PI * 2;

function finish(
  requestedFacets: number,
  vertices: number[][],
  faces: number[][],
  family: ReadablePolyhedron['family'],
  options: {
    exact?: boolean;
    landingFaces?: number[];
    faceKinds?: ReadablePolyhedron['faceKinds'];
  } = {},
): ReadablePolyhedron {
  const radius = Math.max(1, ...vertices.map((vertex) => Math.hypot(vertex[0], vertex[1], vertex[2])));
  const landingFaces = options.landingFaces ?? faces.map((_face, index) => index);
  return {
    requestedFacets,
    displayFacets: landingFaces.length,
    exact: (options.exact ?? true) && landingFaces.length === requestedFacets,
    family,
    vertices: vertices.map((vertex) => [vertex[0] / radius, vertex[1] / radius, vertex[2] / radius]),
    faces: faces.map((face) => [...face]),
    landingFaces: [...landingFaces],
    faceKinds: options.faceKinds ? [...options.faceKinds] : undefined,
  };
}

function tetrahedron(): ReadablePolyhedron {
  return finish(
    4,
    [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]],
    [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]],
    'tetrahedron',
  );
}

/** d3 uses a cube with opposite faces sharing the same logical result. */
function d3Cube(): ReadablePolyhedron {
  const vertices: number[][] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) vertices.push([x, y, z]);
  const faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  return finish(3, vertices, faces, 'cube', {
    exact: true,
    landingFaces: faces.map((_face, index) => index),
    faceKinds: faces.map(() => 'landing'),
  });
}

function cube(): ReadablePolyhedron {
  const vertices: number[][] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) vertices.push([x, y, z]);
  return finish(6, vertices, [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]], 'cube');
}

/**
 * A deliberately over-defined d1 body: two large caps are the only legal result surfaces,
 * while the rim exists only to make a tangible object that can visibly tumble.
 */
function d1Cylinder(segments = 16): ReadablePolyhedron {
  const vertices: number[][] = [];
  const half = 0.52;
  const skew = 0.32;
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * TAU;
    vertices.push([Math.cos(angle), half + Math.cos(angle) * skew, Math.sin(angle)]);
  }
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * TAU;
    vertices.push([Math.cos(angle), -half + Math.cos(angle) * skew, Math.sin(angle)]);
  }
  const faces: number[][] = [
    Array.from({ length: segments }, (_entry, index) => index),
    Array.from({ length: segments }, (_entry, index) => segments * 2 - 1 - index),
  ];
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    faces.push([index, next, segments + next, segments + index]);
  }
  return finish(1, vertices, faces, 'd1-cylinder', {
    exact: true,
    landingFaces: [0, 1],
    faceKinds: faces.map((_face, index) => index < 2 ? 'cap' : 'rim'),
  });
}

function triangularPrism(): ReadablePolyhedron {
  const half = 0.76;
  const vertices: number[][] = [];
  for (const z of [half, -half]) {
    for (let index = 0; index < 3; index += 1) {
      const angle = -Math.PI / 2 + (index / 3) * TAU;
      vertices.push([Math.cos(angle), Math.sin(angle), z]);
    }
  }
  const faces = [
    [2, 1, 0],
    [3, 4, 5],
    [0, 1, 4, 3],
    [1, 2, 5, 4],
    [2, 0, 3, 5],
  ];
  return finish(5, vertices, faces, 'triangular-prism');
}

function trapezohedron(facets: number): ReadablePolyhedron {
  const ring = facets / 2;
  const rawHeight = 2 / (1 - Math.cos(Math.PI / ring)) - 1;
  const squash = (1 / rawHeight) * (ring > 6 ? 1.35 : 1);
  const vertices: number[][] = [[0, rawHeight * squash, 0], [0, -rawHeight * squash, 0]];
  for (let index = 0; index < ring; index += 1) {
    const angle = (index / ring) * TAU;
    vertices.push([Math.cos(angle), squash, Math.sin(angle)]);
  }
  for (let index = 0; index < ring; index += 1) {
    const angle = ((index + 0.5) / ring) * TAU;
    vertices.push([Math.cos(angle), -squash, Math.sin(angle)]);
  }
  const top = (index: number) => 2 + ((index % ring) + ring) % ring;
  const bottom = (index: number) => 2 + ring + (((index % ring) + ring) % ring);
  const faces: number[][] = [];
  for (let index = 0; index < ring; index += 1) {
    faces.push([0, top(index), bottom(index), top(index + 1)]);
    faces.push([1, bottom(index - 1), top(index), bottom(index)]);
  }
  return finish(facets, vertices, faces, 'trapezohedron');
}

/** One rectangular result face per side, with pointed decorative caps. */
function prismBarrel(facets: number): ReadablePolyhedron {
  const half = 0.58;
  const vertices: number[][] = [];
  for (let index = 0; index < facets; index += 1) {
    const angle = (index / facets) * TAU;
    vertices.push([Math.cos(angle), half, Math.sin(angle)]);
  }
  for (let index = 0; index < facets; index += 1) {
    const angle = (index / facets) * TAU;
    vertices.push([Math.cos(angle), -half, Math.sin(angle)]);
  }
  const top = vertices.push([0, half + 0.52, 0]) - 1;
  const bottom = vertices.push([0, -half - 0.52, 0]) - 1;
  const faces: number[][] = [];
  for (let index = 0; index < facets; index += 1) {
    const next = (index + 1) % facets;
    faces.push([index, next, facets + next, facets + index]);
  }
  for (let index = 0; index < facets; index += 1) {
    const next = (index + 1) % facets;
    faces.push([top, next, index]);
    faces.push([bottom, facets + index, facets + next]);
  }
  return finish(facets, vertices, faces, 'prism-barrel', {
    landingFaces: Array.from({ length: facets }, (_entry, index) => index),
    faceKinds: faces.map((_face, index) => index < facets ? 'landing' : 'decorative'),
  });
}

function drum(facets: number, family: 'drum' | 'representative', exact = true): ReadablePolyhedron {
  const ring = Math.max(6, facets);
  const height = 0.64;
  const vertices: number[][] = [];
  for (const y of [height, -height]) {
    for (let index = 0; index < ring; index += 1) {
      const angle = (index / ring) * TAU;
      vertices.push([Math.cos(angle), y, Math.sin(angle)]);
    }
  }
  const faces: number[][] = [];
  for (let index = 0; index < ring; index += 1) {
    const next = (index + 1) % ring;
    faces.push([index, next, ring + next, ring + index]);
  }
  faces.push(Array.from({ length: ring }, (_entry, index) => index).reverse());
  faces.push(Array.from({ length: ring }, (_entry, index) => ring + index));
  return finish(facets, vertices, faces, family, {
    exact,
    landingFaces: Array.from({ length: ring }, (_entry, index) => index),
    faceKinds: faces.map((_face, index) => index < ring ? 'landing' : 'cap'),
  });
}

/**
 * Builds a readable, convex presentation solid for a numeric randomizer.
 *
 * @remarks
 * This is intentionally presentation geometry. It never chooses the authoritative result.
 * Small and recognizable counts use dedicated solids; odd counts use a barrel so they have one
 * clear landing surface per logical value; large counts cap visual complexity while retaining the
 * requested side count in `requestedFacets`.
 */
export function createReadablePolyhedron(
  facets: number,
  options: ReadablePolyhedronOptions = {},
): ReadablePolyhedron {
  if (!Number.isSafeInteger(facets) || facets < 1 || facets > 10_000) {
    throw new Error('Facet count must be an integer from 1 to 10000');
  }
  const pointedLimit = Math.max(8, Math.round(options.pointedLimit ?? 30));
  const maximumFacets = Math.max(12, Math.round(options.maximumFacets ?? 96));
  if (facets === 1) return d1Cylinder();
  if (facets === 3) return d3Cube();
  if (facets === 4) return tetrahedron();
  if (facets === 5) return triangularPrism();
  if (facets === 6) return cube();
  if (facets <= pointedLimit && facets % 2 === 0) return trapezohedron(facets);
  if (facets <= pointedLimit) return prismBarrel(facets);
  if (facets <= maximumFacets) return drum(facets, 'drum');
  const representative = drum(maximumFacets, 'representative', false);
  return { ...representative, requestedFacets: facets, exact: false };
}
