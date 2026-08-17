import { readFile, writeFile } from 'node:fs/promises';

const meshPath = 'src/physical-die-mesh.ts';
let mesh = await readFile(meshPath, 'utf8');

mesh = mesh.replace(
  "import { THEMES, type ThemeName } from './themes';",
  "import { THEMES, type ThemeGeometryProfile, type ThemeName } from './themes';",
);

const faceNormalMarker = '\nfunction faceNormal(shape: ReadablePolyhedron, faceIndex: number): THREE.Vector3 {';
if (!mesh.includes(faceNormalMarker)) throw new Error('physical mesh faceNormal marker missing');
if (!mesh.includes('function triangulateBeveledShape(')) {
  mesh = mesh.replace(
    faceNormalMarker,
    `
interface BeveledEdgeSide {
  a: THREE.Vector3;
  b: THREE.Vector3;
}

function generatedEdgeKey(first: number, second: number): string {
  return first < second ? \`${'${first}:${second}'}\` : \`${'${second}:${first}'}\`;
}

/**
 * Applies a theme bevel to generated render geometry only.
 *
 * The readable polyhedron remains the authoritative collider/support topology. This visual copy
 * may change silhouette and edge highlights without changing physics, landing resolution, or
 * deterministic outcome mapping.
 */
function triangulateBeveledShape(
  shape: ReadablePolyhedron,
  profile: ThemeGeometryProfile,
): THREE.BufferGeometry {
  const bevel = THREE.MathUtils.clamp(profile.bevel, 0, 0.3);
  if (bevel <= 0.001) return triangulateShape(shape);

  const positions: number[] = [];
  const uvs: number[] = [];
  const edges = new Map<string, BeveledEdgeSide[]>();
  const normal = new THREE.Vector3();
  const basisU = new THREE.Vector3();
  const basisV = new THREE.Vector3();
  const point = new THREE.Vector3();

  shape.faces.forEach((face, faceIndex) => {
    if (face.length < 3) return;
    const vertices = face.map((vertexIndex) => new THREE.Vector3(...shape.vertices[vertexIndex]));
    const center = vertices
      .reduce((sum, vertex) => sum.add(vertex), new THREE.Vector3())
      .multiplyScalar(1 / vertices.length);
    normal.copy(faceNormal(shape, faceIndex));
    const inset = vertices.map((vertex) =>
      vertex
        .clone()
        .lerp(center, bevel)
        .addScaledVector(normal, -bevel * profile.bevelDepth * center.length()),
    );

    basisU.copy(vertices[1]).sub(vertices[0]).normalize();
    basisV.crossVectors(normal, basisU).normalize();
    const projected = vertices.map((vertex) => ({
      u: vertex.dot(basisU),
      v: vertex.dot(basisV),
    }));
    const minU = Math.min(...projected.map((value) => value.u));
    const maxU = Math.max(...projected.map((value) => value.u));
    const minV = Math.min(...projected.map((value) => value.v));
    const maxV = Math.max(...projected.map((value) => value.v));
    const spanU = Math.max(1e-5, maxU - minU);
    const spanV = Math.max(1e-5, maxV - minV);
    const faceUvs = projected.map(
      (value) =>
        [
          0.06 + (0.88 * (value.u - minU)) / spanU,
          0.06 + (0.88 * (value.v - minV)) / spanV,
        ] as const,
    );

    for (let index = 1; index + 1 < face.length; index += 1) {
      for (const localIndex of [0, index, index + 1]) {
        const vertex = inset[localIndex];
        positions.push(vertex.x, vertex.y, vertex.z);
        uvs.push(faceUvs[localIndex][0], faceUvs[localIndex][1]);
      }
    }

    for (let index = 0; index < face.length; index += 1) {
      const next = (index + 1) % face.length;
      const key = generatedEdgeKey(face[index], face[next]);
      const side = { a: inset[index], b: inset[next] };
      const existing = edges.get(key);
      if (existing) existing.push(side);
      else edges.set(key, [side]);
    }
  });

  const chamferUvs = [
    0.46, 0.46, 0.54, 0.46, 0.46, 0.54,
    0.46, 0.54, 0.54, 0.46, 0.54, 0.54,
  ];
  for (const sides of edges.values()) {
    if (sides.length !== 2) continue;
    const [first, second] = sides;
    const reverse = second.b.distanceToSquared(first.a) < second.a.distanceToSquared(first.a);
    const otherA = reverse ? second.b : second.a;
    const otherB = reverse ? second.a : second.b;
    for (const vertex of [first.a, otherA, first.b, first.b, otherA, otherB]) {
      positions.push(vertex.x, vertex.y, vertex.z);
    }
    uvs.push(...chamferUvs);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function insetLabelAnchor(
  anchor: PolyhedronLabelAnchor,
  shape: ReadablePolyhedron,
  profile: ThemeGeometryProfile,
): PolyhedronLabelAnchor {
  const face = shape.faces[anchor.faceIndex];
  if (!face || face.length < 3) return anchor;
  const bevel = THREE.MathUtils.clamp(profile.bevel, 0, 0.3);
  const center = face
    .map((vertexIndex) => new THREE.Vector3(...shape.vertices[vertexIndex]))
    .reduce((sum, vertex) => sum.add(vertex), new THREE.Vector3())
    .multiplyScalar(1 / face.length);
  const normal = new THREE.Vector3(...anchor.normal).normalize();
  const position = new THREE.Vector3(...anchor.position)
    .lerp(center, bevel)
    .addScaledVector(normal, -bevel * profile.bevelDepth * center.length());
  return {
    ...anchor,
    position: [position.x, position.y, position.z],
    scale: anchor.scale * THREE.MathUtils.clamp(profile.faceInset, 0.65, 1.1),
  };
}

function faceNormal(shape: ReadablePolyhedron, faceIndex: number): THREE.Vector3 {`,
  );
}

const geometryBefore = `  const geometry = runtimeMesh
    ? scaleThemeMesh(runtimeMesh, definition)
    : shape
      ? triangulateShape(shape)
      : colliderGeometry(definition);`;
const geometryAfter = `  const generatedGeometryProfile =
    !runtimeMesh && !spec.definition && shape ? palette.geometry : null;
  const geometry = runtimeMesh
    ? scaleThemeMesh(runtimeMesh, definition)
    : shape
      ? generatedGeometryProfile
        ? triangulateBeveledShape(shape, generatedGeometryProfile)
        : triangulateShape(shape)
      : colliderGeometry(definition);`;
if (!mesh.includes(geometryBefore)) throw new Error('generated geometry selection block missing');
mesh = mesh.replace(geometryBefore, geometryAfter);

mesh = mesh.replace(
  `    emissive: runtimeMaterial?.emissive ?? 0x000000,
    emissiveIntensity: runtimeMaterial?.emissiveIntensity ?? 0,
    roughness: runtimeMaterial?.roughness ?? 0.39,
    metalness: runtimeMaterial?.metalness ?? 0.22,
    clearcoat: runtimeMaterial?.clearcoat ?? 0.35,
    clearcoatRoughness: runtimeMaterial?.clearcoatRoughness ?? 0.28,`,
  `    emissive: runtimeMaterial?.emissive ?? palette.emissive,
    emissiveIntensity: runtimeMaterial?.emissiveIntensity ?? palette.emissiveIntensity,
    roughness: runtimeMaterial?.roughness ?? palette.roughness,
    metalness: runtimeMaterial?.metalness ?? palette.metalness,
    clearcoat: runtimeMaterial?.clearcoat ?? palette.clearcoat,
    clearcoatRoughness: runtimeMaterial?.clearcoatRoughness ?? palette.clearcoatRoughness,`,
);

mesh = mesh.replace(
  `  const edgeMaterial = new THREE.LineBasicMaterial({
    color: palette.edge,
    transparent: true,
    opacity: 0,
  });`,
  `  const edgeMaterial = new THREE.LineBasicMaterial({
    color: palette.edge,
    transparent: true,
    opacity: 0,
    toneMapped: false,
  });`,
);

const anchorMarker = `  const totalLabelAnchors = anchorsByOutcome.reduce((sum, anchors) => sum + anchors.length, 0);`;
if (!mesh.includes(anchorMarker)) throw new Error('label anchor total marker missing');
mesh = mesh.replace(
  anchorMarker,
  `  if (shape && generatedGeometryProfile) {
    for (let index = 0; index < anchorsByOutcome.length; index += 1) {
      anchorsByOutcome[index] = anchorsByOutcome[index].map((anchor) =>
        insetLabelAnchor(anchor, shape, generatedGeometryProfile),
      );
    }
  }
  const totalLabelAnchors = anchorsByOutcome.reduce((sum, anchors) => sum + anchors.length, 0);`,
);

if (!mesh.includes('    edgeMaterial.opacity = value * 0.92;')) {
  throw new Error('generated edge opacity assignment missing');
}
mesh = mesh.replace(
  '    edgeMaterial.opacity = value * 0.92;',
  '    edgeMaterial.opacity = value * palette.edgeOpacity * 0.72;',
);

await writeFile(meshPath, mesh);

const testPath = 'scripts/test-visual-fallbacks.mjs';
let tests = await readFile(testPath, 'utf8');
const testMarker = `assert.match(physicalMesh, /createPhysicalDieMesh/);`;
if (!tests.includes(testMarker)) throw new Error('physical mesh test marker missing');
tests = tests.replace(
  testMarker,
  `${testMarker}
assert.match(physicalMesh, /ThemeGeometryProfile/);
assert.match(physicalMesh, /triangulateBeveledShape/);
assert.match(physicalMesh, /!runtimeMesh && !spec\\.definition && shape \\? palette\\.geometry : null/);
assert.match(physicalMesh, /insetLabelAnchor/);
assert.match(physicalMesh, /palette\\.edgeOpacity \\* 0\\.72/);
assert.match(physicalMesh, /runtimeMaterial\\?\\.roughness \\?\\? palette\\.roughness/);`,
);
await writeFile(testPath, tests);

const docsPath = 'docs/ARCHITECTURE.md';
let docs = await readFile(docsPath, 'utf8');
const docsMarker = '- one physical-table registry as the sole owner of live canonical/generated/custom runtime bindings\n';
if (!docs.includes(docsMarker)) throw new Error('architecture renderer bullet missing');
docs = docs.replace(
  docsMarker,
  `${docsMarker}- theme geometry profiles change render silhouettes/labels only; physical definitions, colliders, support topology, and authoritative outcomes remain unchanged\n`,
);
await writeFile(docsPath, docs);
