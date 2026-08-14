export type PolyhedronVertex = readonly [number, number, number];

export interface ReadablePolyhedron {
  vertices: PolyhedronVertex[];
  faces: number[][];
  /** Faces that may carry a logical outcome. Decorative faces are excluded. */
  landingFaces: number[];
  faceKinds?: Array<'landing' | 'cap' | 'rim' | 'decorative'>;
  requestedFacets: number;
  displayFacets: number;
  exact: boolean;
  family:
    | 'd1-cylinder'
    | 'cube'
    | 'tetrahedron'
    | 'triangular-prism'
    | 'bipyramid'
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
  const radius = Math.max(...vertices.map((vertex) => Math.hypot(...vertex)), 1e-6);
  const normalized = vertices.map((vertex) =>
    [vertex[0] / radius, vertex[1] / radius, vertex[2] / radius] as PolyhedronVertex,
  );
  const landingFaces = options.landingFaces ?? faces.map((_face, index) => index);
  return {
    vertices: normalized,
    faces: faces.map((face) => [...face]),
    landingFaces: [...landingFaces],
    faceKinds: options.faceKinds ? [...options.faceKinds] : undefined,
    requestedFacets,
    displayFacets: landingFaces.length,
    // Some exact logical dice deliberately duplicate results across physical
    // landing faces (d1 and d3), so an explicit exact=true overrides the
    // one-result-per-face count heuristic.
    exact: options.exact ?? requestedFacets === landingFaces.length,
    family,
  };
}

function cube(requestedFacets = 6): ReadablePolyhedron {
  const vertices: number[][] = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ];
  const faces = [
    [0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3],
    [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4],
  ];
  return finish(requestedFacets, vertices, faces, 'cube', {
    exact: requestedFacets === 3 ? true : undefined,
    landingFaces: faces.map((_face, index) => index),
    faceKinds: faces.map(() => 'landing'),
  });
}

function tetrahedron(): ReadablePolyhedron {
  return finish(
    4,
    [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]],
    [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]],
    'tetrahedron',
  );
}

/** A thick, deliberately tangible d1 with two equivalent result caps. */
function d1Cylinder(segments = 18): ReadablePolyhedron {
  const vertices: number[][] = [];
  const half = 0.78;
  const radius = 0.58;
  for (const z of [-half, half]) {
    for (let index = 0; index < segments; index += 1) {
      const angle = index / segments * TAU;
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
  return finish(1, vertices, faces, 'd1-cylinder', {
    exact: true,
    landingFaces: [0, 1],
    faceKinds: faces.map((_face, index) => index < 2 ? 'cap' : 'rim'),
  });
}

function triangularPrism(): ReadablePolyhedron {
  const vertices: number[][] = [];
  const half = 0.72;
  for (const z of [-half, half]) {
    for (let index = 0; index < 3; index += 1) {
      const angle = -Math.PI / 2 + index / 3 * TAU;
      vertices.push([Math.cos(angle), Math.sin(angle), z]);
    }
  }
  const faces = [
    [0, 2, 1], [3, 4, 5],
    [0, 1, 4, 3], [1, 2, 5, 4], [2, 0, 3, 5],
  ];
  return finish(5, vertices, faces, 'triangular-prism');
}

/**
 * Robust even-sided die: a regular n-gonal bipyramid gives exactly 2n congruent
 * triangular result faces. It is convex, has stable winding, and remains readable
 * for the side counts where pointed dice still look like physical dice.
 */
function bipyramid(facets: number): ReadablePolyhedron {
  const ring = facets / 2;
  const vertices: number[][] = [[0, 1.08, 0], [0, -1.08, 0]];
  for (let index = 0; index < ring; index += 1) {
    const angle = index / ring * TAU;
    vertices.push([Math.cos(angle), 0, Math.sin(angle)]);
  }
  const ringVertex = (index: number) => 2 + ((index % ring) + ring) % ring;
  const faces: number[][] = [];
  for (let index = 0; index < ring; index += 1) {
    faces.push([0, ringVertex(index + 1), ringVertex(index)]);
    faces.push([1, ringVertex(index), ringVertex(index + 1)]);
  }
  return finish(facets, vertices, faces, 'bipyramid');
}

/** Odd-sided barrel: one clear rectangular result face per outcome, tapered caps decorative. */
function prismBarrel(facets: number): ReadablePolyhedron {
  const half = 0.54;
  const vertices: number[][] = [];
  for (const y of [half, -half]) {
    for (let index = 0; index < facets; index += 1) {
      const angle = index / facets * TAU;
      vertices.push([Math.cos(angle), y, Math.sin(angle)]);
    }
  }
  const top = vertices.push([0, half + 0.48, 0]) - 1;
  const bottom = vertices.push([0, -half - 0.48, 0]) - 1;
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

/** High-count visual drum. Caps are decorative; the vertical facets are outcomes. */
function drum(
  facets: number,
  family: 'drum' | 'representative',
  exact = true,
): ReadablePolyhedron {
  const ring = facets;
  const half = 0.42;
  const vertices: number[][] = [];
  for (const y of [half, -half]) {
    for (let index = 0; index < ring; index += 1) {
      const angle = index / ring * TAU;
      vertices.push([Math.cos(angle), y, Math.sin(angle)]);
    }
  }
  const faces: number[][] = [];
  for (let index = 0; index < ring; index += 1) {
    const next = (index + 1) % ring;
    faces.push([index, next, ring + next, ring + index]);
  }
  faces.push(Array.from({ length: ring }, (_entry, index) => ring - 1 - index));
  faces.push(Array.from({ length: ring }, (_entry, index) => ring + index));
  return finish(facets, vertices, faces, family, {
    exact,
    landingFaces: Array.from({ length: ring }, (_entry, index) => index),
    faceKinds: faces.map((_face, index) => index < ring ? 'landing' : 'cap'),
  });
}

/** Presentation geometry only; authoritative outcomes are always supplied by Draftroll. */
export function createReadablePolyhedron(
  facets: number,
  options: ReadablePolyhedronOptions = {},
): ReadablePolyhedron {
  if (!Number.isSafeInteger(facets) || facets < 1 || facets > 10_000) {
    throw new Error('Facet count must be an integer from 1 to 10000');
  }
  const pointedLimit = Math.max(8, Math.round(options.pointedLimit ?? 30));
  const maximumFacets = Math.max(16, Math.round(options.maximumFacets ?? 72));
  if (facets === 1) return d1Cylinder();
  if (facets === 3) return cube(3);
  if (facets === 4) return tetrahedron();
  if (facets === 5) return triangularPrism();
  if (facets === 6) return cube();
  if (facets <= pointedLimit && facets % 2 === 0) return bipyramid(facets);
  if (facets <= pointedLimit) return prismBarrel(facets);
  if (facets <= maximumFacets) return drum(facets, 'drum');
  const representative = drum(maximumFacets, 'representative', false);
  return { ...representative, requestedFacets: facets, exact: false };
}
