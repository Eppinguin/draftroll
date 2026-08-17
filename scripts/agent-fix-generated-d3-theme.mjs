import { readFile, writeFile } from 'node:fs/promises';

const dicePath = 'src/dice.ts';
let dice = await readFile(dicePath, 'utf8');

const d6Block = `  } else if (kind === 'd6') {
    // The d6 is a rounded box, so the profile drives its corner radius directly.
    const size = radius * 1.72;
    visual = new RoundedBoxGeometry(
      size,
      size,
      size,
      6,
      radius * THREE.MathUtils.clamp(profile.cornerRadius, 0.02, 0.42),
    );
    applyPlanarFaceUvs(visual, radius);`;
const d6Replacement = `  } else if (kind === 'd6') {
    // The d6 is a rounded box, so the profile drives its corner radius directly.
    const size = radius * 1.72;
    visual = createThemedRoundedBoxVisual(theme, size);`;
if (!dice.includes(d6Block)) throw new Error('canonical d6 themed geometry block missing');
dice = dice.replace(d6Block, d6Replacement);

const createThemedMarker = `/**
 * Builds the display mesh for one theme and die, applying that theme's chamfer.`;
if (!dice.includes(createThemedMarker)) throw new Error('createThemedVisual marker missing');
const roundedHelper = `/**
 * Builds a rounded-box render mesh using the same theme geometry semantics as the canonical d6.
 *
 * This is intentionally visual-only. Callers keep their existing collider and outcome topology.
 */
export function createThemedRoundedBoxVisual(theme: ThemeName, size: number): THREE.BufferGeometry {
  const palette = THEMES[theme] ?? THEMES.dragon;
  const profile = palette.geometry;
  const radius = size / 1.72;
  const visual = new RoundedBoxGeometry(
    size,
    size,
    size,
    6,
    radius * THREE.MathUtils.clamp(profile.cornerRadius, 0.02, 0.42),
  );
  applyPlanarFaceUvs(visual, radius);
  return visual;
}

`;
dice = dice.replace(createThemedMarker, roundedHelper + createThemedMarker);

const surfaceEnd = `  surfaceCache.set(theme, surface);
  return surface;
}

const SURFACE_VARIANT_COUNT = 12;`;
if (!dice.includes(surfaceEnd)) throw new Error('theme surface function end missing');
dice = dice.replace(
  surfaceEnd,
  `  surfaceCache.set(theme, surface);
  return surface;
}

/**
 * Returns the cached built-in theme surface maps used by every renderer-owned physical die.
 * Runtime theme textures still take precedence at the caller.
 */
export function getThemeSurfaceTextures(theme: ThemeName): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const normalized = Object.hasOwn(THEMES, theme) ? theme : 'dragon';
  const palette = THEMES[normalized] ?? THEMES.dragon;
  return createSurface(normalized, palette);
}

const SURFACE_VARIANT_COUNT = 12;`,
);
await writeFile(dicePath, dice);

const meshPath = 'src/physical-die-mesh.ts';
let mesh = await readFile(meshPath, 'utf8');

mesh = mesh.replace(
  `import { THEMES, type ThemeGeometryProfile, type ThemeName } from './themes';`,
  `import { THEMES, type ThemeGeometryProfile, type ThemeName } from './themes';
import { createThemedRoundedBoxVisual, getThemeSurfaceTextures } from './dice';`,
);
mesh = mesh.replace(
  `const surfaceTextureCache = new Map<string, { texture: THREE.CanvasTexture; refs: number }>();\n`,
  '',
);

const cssColorStart = mesh.indexOf('function cssColor(value: number): string {');
const shadowStart = mesh.indexOf('function getShadowTexture(): THREE.CanvasTexture {');
if (cssColorStart < 0 || shadowStart < 0 || cssColorStart > shadowStart) {
  throw new Error('cssColor/getShadowTexture markers missing');
}
mesh = mesh.slice(0, cssColorStart) + mesh.slice(shadowStart);

const surfaceStart = mesh.indexOf('function createSurfaceTexture(spec: DraftrollPhysicalVisual): THREE.CanvasTexture {');
const triangulateStart = mesh.indexOf('function triangulateShape(shape: ReadablePolyhedron): THREE.BufferGeometry {');
if (surfaceStart < 0 || triangulateStart < 0 || surfaceStart > triangulateStart) {
  throw new Error('generated surface/triangulate markers missing');
}
mesh = mesh.slice(0, surfaceStart) + mesh.slice(triangulateStart);

const faceNormalMarker = `function faceNormal(shape: ReadablePolyhedron, faceIndex: number): THREE.Vector3 {`;
if (!mesh.includes(faceNormalMarker)) throw new Error('faceNormal marker missing');
mesh = mesh.replace(
  faceNormalMarker,
  `function readableCubeSize(shape: ReadablePolyhedron): number {
  const xs = shape.vertices.map((vertex) => vertex[0]);
  const ys = shape.vertices.map((vertex) => vertex[1]);
  const zs = shape.vertices.map((vertex) => vertex[2]);
  return Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
    Math.max(...zs) - Math.min(...zs),
  );
}

function scaleLabelAnchor(
  anchor: PolyhedronLabelAnchor,
  profile: ThemeGeometryProfile,
): PolyhedronLabelAnchor {
  return {
    ...anchor,
    scale: anchor.scale * THREE.MathUtils.clamp(profile.faceInset, 0.65, 1.1),
  };
}

${faceNormalMarker}`,
);

const geometryBlock = `  const generatedGeometryProfile =
    !runtimeMesh && !spec.definition && shape ? palette.geometry : null;
  const geometry = runtimeMesh
    ? scaleThemeMesh(runtimeMesh, definition)
    : shape
      ? generatedGeometryProfile
        ? triangulateBeveledShape(shape, generatedGeometryProfile)
        : triangulateShape(shape)
      : colliderGeometry(definition);`;
const geometryReplacement = `  const generatedGeometryProfile =
    !runtimeMesh && !spec.definition && shape ? palette.geometry : null;
  const roundedGeneratedCube = Boolean(
    generatedGeometryProfile && shape?.family === 'd3-cube',
  );
  const geometry = runtimeMesh
    ? scaleThemeMesh(runtimeMesh, definition)
    : shape
      ? roundedGeneratedCube
        ? createThemedRoundedBoxVisual(spec.theme, readableCubeSize(shape))
        : generatedGeometryProfile
          ? triangulateBeveledShape(shape, generatedGeometryProfile)
          : triangulateShape(shape)
      : colliderGeometry(definition);`;
if (!mesh.includes(geometryBlock)) throw new Error('generated geometry block missing');
mesh = mesh.replace(geometryBlock, geometryReplacement);

const surfaceBlock = `  const runtimeSurface =
    getRuntimeThemeTexture(spec.theme, spec.type, 'surface') ??
    getRuntimeThemeTexture(spec.theme, \`d\${definition.sides}\`, 'surface');
  const generatedSurface = runtimeSurface ? null : acquireSurfaceTexture(spec);
  const runtimeNormal =
    getRuntimeThemeTexture(spec.theme, spec.type, 'normal') ??
    getRuntimeThemeTexture(spec.theme, \`d\${definition.sides}\`, 'normal');
  const runtimeRoughness =
    getRuntimeThemeTexture(spec.theme, spec.type, 'roughness') ??
    getRuntimeThemeTexture(spec.theme, \`d\${definition.sides}\`, 'roughness');`;
const surfaceReplacement = `  const runtimeSurface =
    getRuntimeThemeTexture(spec.theme, spec.type, 'surface') ??
    getRuntimeThemeTexture(spec.theme, \`d\${definition.sides}\`, 'surface');
  const sharedThemeSurface = runtimeSurface ? null : getThemeSurfaceTextures(normalizeTheme(spec.theme));
  const runtimeNormal =
    getRuntimeThemeTexture(spec.theme, spec.type, 'normal') ??
    getRuntimeThemeTexture(spec.theme, \`d\${definition.sides}\`, 'normal');
  const runtimeRoughness =
    getRuntimeThemeTexture(spec.theme, spec.type, 'roughness') ??
    getRuntimeThemeTexture(spec.theme, \`d\${definition.sides}\`, 'roughness');`;
if (!mesh.includes(surfaceBlock)) throw new Error('surface selection block missing');
mesh = mesh.replace(surfaceBlock, surfaceReplacement);

mesh = mesh.replace(
  `    map: runtimeSurface ?? generatedSurface?.texture ?? null,
    normalMap: runtimeNormal,
    roughnessMap: runtimeRoughness,`,
  `    map: runtimeSurface ?? sharedThemeSurface?.map ?? null,
    normalMap: runtimeNormal ?? sharedThemeSurface?.normalMap,
    normalScale: new THREE.Vector2(0.82, 0.82),
    roughnessMap: runtimeRoughness ?? sharedThemeSurface?.roughnessMap,`,
);
mesh = mesh.replace(
  `    roughness: runtimeMaterial?.roughness ?? palette.roughness,`,
  `    roughness: runtimeMaterial?.roughness ?? 1,`,
);
mesh = mesh.replace(
  `    clearcoatRoughness: runtimeMaterial?.clearcoatRoughness ?? palette.clearcoatRoughness,
    flatShading: true,`,
  `    clearcoatRoughness: runtimeMaterial?.clearcoatRoughness ?? palette.clearcoatRoughness,
    clearcoatNormalMap: runtimeNormal ?? sharedThemeSurface?.normalMap,
    clearcoatNormalScale: new THREE.Vector2(0.28, 0.28),
    flatShading: !roundedGeneratedCube,`,
);
mesh = mesh.replace(
  `  const edgeGeometry = new THREE.EdgesGeometry(geometry, 18);`,
  `  const edgeGeometry = new THREE.EdgesGeometry(geometry, roundedGeneratedCube ? 32 : 18);`,
);

const anchorInsetBlock = `  if (shape && generatedGeometryProfile) {
    for (let index = 0; index < anchorsByOutcome.length; index += 1) {
      anchorsByOutcome[index] = anchorsByOutcome[index].map((anchor) =>
        insetLabelAnchor(anchor, shape, generatedGeometryProfile),
      );
    }
  }`;
const anchorInsetReplacement = `  if (shape && generatedGeometryProfile) {
    for (let index = 0; index < anchorsByOutcome.length; index += 1) {
      anchorsByOutcome[index] = anchorsByOutcome[index].map((anchor) =>
        roundedGeneratedCube
          ? scaleLabelAnchor(anchor, generatedGeometryProfile)
          : insetLabelAnchor(anchor, shape, generatedGeometryProfile),
      );
    }
  }`;
if (!mesh.includes(anchorInsetBlock)) throw new Error('generated label inset block missing');
mesh = mesh.replace(anchorInsetBlock, anchorInsetReplacement);

mesh = mesh.replace(`      generatedSurface?.release();\n`, '');
await writeFile(meshPath, mesh);

const testsPath = 'scripts/test-visual-fallbacks.mjs';
let tests = await readFile(testsPath, 'utf8');
tests = tests.replace(
  `assert.match(physicalMesh, /triangulateBeveledShape/);`,
  `assert.match(physicalMesh, /triangulateBeveledShape/);
assert.match(physicalMesh, /createThemedRoundedBoxVisual/);
assert.match(physicalMesh, /shape\\?\\.family === 'd3-cube'/);
assert.match(physicalMesh, /roundedGeneratedCube \\? 32 : 18/);
assert.match(physicalMesh, /flatShading: !roundedGeneratedCube/);
assert.match(physicalMesh, /getThemeSurfaceTextures/);`,
);
tests = tests.replace(`assert.match(physicalMesh, /surfaceTextureCache/);\n`, `assert.doesNotMatch(physicalMesh, /surfaceTextureCache/);\n`);
tests = tests.replace(`assert.match(physicalMesh, /runtimeSurface \\? null : acquireSurfaceTexture/);\n`, `assert.match(physicalMesh, /runtimeSurface \\? null : getThemeSurfaceTextures/);\n`);
tests = tests.replace(`assert.match(physicalMesh, /generatedSurface\\?\\.release/);\n`, `assert.doesNotMatch(physicalMesh, /generatedSurface\\?\\.release/);\n`);
const surfaceTestMarker = `assert.match(physicalMesh, /runtimeMaterial\\?\\.roughness \\?\\? palette\\.roughness/);`;
if (tests.includes(surfaceTestMarker)) {
  tests = tests.replace(surfaceTestMarker, `assert.match(physicalMesh, /runtimeMaterial\\?\\.roughness \\?\\? 1/);`);
}
await writeFile(testsPath, tests);

const docsPath = 'docs/ARCHITECTURE.md';
let docs = await readFile(docsPath, 'utf8');
const docsLine = `- theme geometry profiles change render silhouettes/labels only; physical definitions, colliders, support topology, and authoritative outcomes remain unchanged\n`;
if (!docs.includes(docsLine)) throw new Error('theme architecture line missing');
docs = docs.replace(
  docsLine,
  `${docsLine}- renderer-owned generated dice share built-in theme surface maps and rounded-box semantics where their support geometry is cube-based (d3), while retaining independent physical outcome mappings\n`,
);
await writeFile(docsPath, docs);
