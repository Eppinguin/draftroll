export type PolyhedronVertex = readonly [number, number, number];

export interface ReadablePolyhedron {
  vertices: PolyhedronVertex[];
  faces: number[][];
  requestedFacets: number;
  displayFacets: number;
  exact: boolean;
  family: 'tetrahedron' | 'cube' | 'trapezohedron' | 'prism' | 'drum' | 'representative';
}

export interface ReadablePolyhedronOptions {
  pointedLimit?: number;
  maximumFacets?: number;
}

const TAU = Math.PI * 2;

function finish(requestedFacets: number, vertices: number[][], faces: number[][], family: ReadablePolyhedron['family'], exact = true): ReadablePolyhedron {
  const radius = Math.max(1, ...vertices.map((vertex) => Math.hypot(vertex[0], vertex[1], vertex[2])));
  return {
    requestedFacets,
    displayFacets: faces.length,
    exact: exact && faces.length === requestedFacets,
    family,
    vertices: vertices.map((vertex) => [vertex[0] / radius, vertex[1] / radius, vertex[2] / radius]),
    faces: faces.map((face) => [...face]),
  };
}

function tetrahedron(): ReadablePolyhedron {
  return finish(4, [[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]], [[0,1,2],[0,3,1],[0,2,3],[1,3,2]], 'tetrahedron');
}

function cube(): ReadablePolyhedron {
  const vertices: number[][] = [];
  for (const x of [-1,1]) for (const y of [-1,1]) for (const z of [-1,1]) vertices.push([x,y,z]);
  return finish(6, vertices, [[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]], 'cube');
}

function trapezohedron(facets: number): ReadablePolyhedron {
  const ring = facets / 2;
  const rawHeight = 2 / (1 - Math.cos(Math.PI / ring)) - 1;
  const squash = (1 / rawHeight) * (ring > 6 ? 1.35 : 1);
  const vertices: number[][] = [[0, rawHeight * squash, 0], [0, -rawHeight * squash, 0]];
  for (let index = 0; index < ring; index += 1) {
    const angle = index / ring * TAU;
    vertices.push([Math.cos(angle), squash, Math.sin(angle)]);
  }
  for (let index = 0; index < ring; index += 1) {
    const angle = (index + 0.5) / ring * TAU;
    vertices.push([Math.cos(angle), -squash, Math.sin(angle)]);
  }
  const top = (index: number) => 2 + (index % ring);
  const bottom = (index: number) => 2 + ring + (index % ring);
  const faces: number[][] = [];
  for (let index = 0; index < ring; index += 1) {
    faces.push([0, top(index), bottom(index), top(index + 1)]);
    faces.push([1, bottom(index + 1), top(index + 1), bottom(index)]);
  }
  return finish(facets, vertices, faces, 'trapezohedron');
}

function prism(facets: number, family: 'prism' | 'drum' | 'representative', exact = true): ReadablePolyhedron {
  const ring = Math.max(3, facets - 2);
  const height = family === 'drum' ? 0.7 : 0.9;
  const vertices: number[][] = [];
  for (const y of [height, -height]) {
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
  faces.push(Array.from({ length: ring }, (_, index) => index).reverse());
  faces.push(Array.from({ length: ring }, (_, index) => ring + index));
  return finish(facets, vertices, faces, family, exact);
}

export function createReadablePolyhedron(facets: number, options: ReadablePolyhedronOptions = {}): ReadablePolyhedron {
  if (!Number.isSafeInteger(facets) || facets < 1 || facets > 10_000) throw new Error('Facet count must be an integer from 1 to 10000');
  const pointedLimit = Math.max(6, Math.round(options.pointedLimit ?? 22));
  const maximumFacets = Math.max(6, Math.round(options.maximumFacets ?? 120));
  if (facets === 4) return tetrahedron();
  if (facets === 6) return cube();
  if (facets < 4) return { ...prism(5, 'representative', false), requestedFacets: facets, exact: false };
  if (facets <= pointedLimit && facets % 2 === 0) return trapezohedron(facets);
  if (facets <= maximumFacets) return prism(facets, facets <= pointedLimit ? 'prism' : 'drum');
  const representative = prism(maximumFacets, 'representative', false);
  return { ...representative, requestedFacets: facets, exact: false };
}
