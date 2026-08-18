import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runTsc } from './lib/load-typescript.mjs';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tempRoot = await mkdtemp(join(projectRoot, 'node_modules/.generated-polyhedra-'));
const outDir = join(tempRoot, 'build');

function definitionFromReadableShape(shape, id) {
  return {
    id,
    sides: shape.requestedFacets,
    geometrySource: 'generated',
    targeting: 'relabel',
    radius: 1,
    collisionScale: 1.02,
    collider: {
      kind: 'convex',
      vertices: shape.vertices,
      faces: shape.faces,
    },
    outcomes: shape.outcomes.map((outcome, index) => ({
      index,
      value: outcome.value,
      result: outcome.value,
      numericValue: outcome.value,
      supportNormals: [outcome.settledUp],
      labelAnchors: outcome.labels,
    })),
    readableShape: shape,
  };
}

try {
  await mkdir(outDir, { recursive: true });
  const polyhedraSource = join(projectRoot, 'packages/renderer/src/polyhedra.ts');
  const physicalSource = join(projectRoot, 'packages/renderer/src/physical.ts');
  const compile = runTsc(
    [
      '--strict',
      '--target',
      'ES2022',
      '--lib',
      'ES2023,DOM',
      '--module',
      'ESNext',
      '--moduleResolution',
      'Bundler',
      '--outDir',
      outDir,
      polyhedraSource,
      physicalSource,
    ],
    { cwd: projectRoot },
  );
  if (compile.status !== 0) {
    process.stderr.write(compile.stdout);
    process.stderr.write(compile.stderr);
    throw new Error('Generated polyhedra compilation failed');
  }
  await writeFile(join(outDir, 'package.json'), '{"type":"module"}\n');
  const physicalOutput = join(outDir, 'physical.js');
  await writeFile(
    physicalOutput,
    (await readFile(physicalOutput, 'utf8')).replace(
      "from './polyhedra';",
      "from './polyhedra.js';",
    ),
  );
  const polyhedraModule = await import(pathToFileURL(join(outDir, 'polyhedra.js')).href);
  const physicalModule = await import(pathToFileURL(physicalOutput).href);
  const { createReadablePolyhedron } = polyhedraModule;
  const { assertValidPhysicalDieDefinition, clonePhysicalDieDefinition } = physicalModule;

  for (const sides of [4, 5, 7, 9, 12, 20, 100, 256]) {
    const shape = createReadablePolyhedron(sides);
    assert.equal(shape.faces.length, sides, `d${sides} has exactly ${sides} planar faces`);
    assert.equal(shape.outcomes.length, sides, `d${sides} has one support state per result`);
    assert.equal(shape.exact, true, `d${sides} remains exact`);
    for (const outcome of shape.outcomes) {
      assert.ok(
        outcome.labels.length >= 1,
        `d${sides} outcome ${outcome.value} has a readable label anchor`,
      );
      assert.ok(['face', 'edge', 'vertex'].includes(outcome.labelKind));
      for (const anchor of outcome.labels) {
        assert.ok(anchor.faceIndex >= 0 && anchor.faceIndex < shape.faces.length);
        assert.ok(anchor.scale > 0);
        assert.ok(anchor.position.every(Number.isFinite));
        assert.ok(anchor.normal.every(Number.isFinite));
        assert.ok(anchor.up.every(Number.isFinite));
        const orthogonal = Math.abs(
          anchor.normal[0] * anchor.up[0] +
            anchor.normal[1] * anchor.up[1] +
            anchor.normal[2] * anchor.up[2],
        );
        assert.ok(orthogonal < 1e-5, `d${sides} label up direction stays in its printed face`);
      }
    }
  }

  const d4 = createReadablePolyhedron(4);
  assert.ok(d4.outcomes.every((outcome) => outcome.labelKind === 'vertex'));
  assert.ok(d4.outcomes.every((outcome) => outcome.labels.length === 3));

  const d5 = createReadablePolyhedron(5);
  assert.ok(
    d5.outcomes.some((outcome) => outcome.labelKind === 'edge'),
    'd5 automatically uses edge labels where an edge is the clearest opposite feature',
  );

  const d3 = createReadablePolyhedron(3);
  assert.deepEqual(
    d3.outcomes.map((outcome) => outcome.labels.length),
    [2, 2, 2],
  );

  const huge = createReadablePolyhedron(300);
  assert.equal(huge.exact, false);
  assert.equal(huge.faces.length, 256);
  assert.equal(huge.requestedFacets, 300);

  const validDefinition = {
    id: 'test:d2',
    sides: 2,
    geometrySource: 'theme',
    targeting: 'relabel',
    radius: 0.7,
    collisionScale: 1.02,
    collider: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] },
    outcomes: [
      {
        index: 0,
        value: 1,
        result: 'one',
        numericValue: 1,
        supportNormals: [[0, 1, 0]],
        labelAnchors: [],
      },
      {
        index: 1,
        value: 2,
        result: 'two',
        numericValue: 2,
        supportNormals: [[0, -1, 0]],
        labelAnchors: [],
      },
    ],
  };
  assert.doesNotThrow(() => assertValidPhysicalDieDefinition(validDefinition));
  const clonedDefinition = clonePhysicalDieDefinition(validDefinition);
  clonedDefinition.collider.halfExtents[0] = 0.25;
  clonedDefinition.outcomes[0].supportNormals[0][1] = 0.5;
  assert.equal(validDefinition.collider.halfExtents[0], 0.5, 'collider clone is detached');
  assert.equal(validDefinition.outcomes[0].supportNormals[0][1], 1, 'outcome clone is detached');

  const cubeVertices = [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ];
  const cubeFaces = [
    [0, 1, 2, 3],
    [4, 7, 6, 5],
    [0, 4, 5, 1],
    [3, 2, 6, 7],
    [0, 3, 7, 4],
    [1, 5, 6, 2],
  ];
  const validConvexDefinition = {
    ...validDefinition,
    id: 'test:convex-cube',
    collider: { kind: 'convex', vertices: cubeVertices, faces: cubeFaces },
  };
  assert.doesNotThrow(
    () => assertValidPhysicalDieDefinition(validConvexDefinition),
    'closed planar convex colliders satisfy the shared contract',
  );

  for (const sides of [1, 2, 3, 4]) {
    assert.doesNotThrow(
      () =>
        assertValidPhysicalDieDefinition(
          definitionFromReadableShape(createReadablePolyhedron(sides), `readable:d${sides}`),
        ),
      `d${sides} readable geometry satisfies the strict physical contract`,
    );
  }

  const invalidReadableDefinition = definitionFromReadableShape(
    createReadablePolyhedron(4),
    'readable:invalid',
  );
  invalidReadableDefinition.readableShape.landingFaces = [999];
  assert.throws(
    () => assertValidPhysicalDieDefinition(invalidReadableDefinition),
    /invalid landing face index/,
  );

  assert.throws(
    () =>
      assertValidPhysicalDieDefinition({
        ...validDefinition,
        outcomes: validDefinition.outcomes.map((outcome, index) => ({
          ...outcome,
          index: index === 1 ? 0 : outcome.index,
        })),
      }),
    /must use index 1/,
  );
  assert.throws(
    () =>
      assertValidPhysicalDieDefinition({
        ...validDefinition,
        collider: { kind: 'box', halfExtents: [Number.NaN, 0.5, 0.5] },
      }),
    /finite coordinates/,
  );
  assert.throws(
    () =>
      assertValidPhysicalDieDefinition({
        ...validDefinition,
        outcomes: [
          { ...validDefinition.outcomes[0], supportNormals: [[0, 0, 0]] },
          validDefinition.outcomes[1],
        ],
      }),
    /must not be a zero vector/,
  );
  assert.throws(
    () =>
      assertValidPhysicalDieDefinition({
        ...validDefinition,
        collider: { kind: 'cylinder', radiusTop: 0.5, radiusBottom: 0.5, height: 0.2, segments: 2 },
      }),
    /segments must be an integer from 3 to 1024/,
  );
  assert.throws(
    () =>
      assertValidPhysicalDieDefinition({
        ...validDefinition,
        collider: {
          kind: 'convex',
          vertices: [
            [0, 0, 0],
            [1, 0, 0],
            [2, 0, 0],
            [0, 1, 0],
          ],
          faces: [
            [0, 1, 2],
            [0, 3, 1],
            [1, 3, 2],
            [0, 2, 3],
          ],
        },
      }),
    /must have non-zero area/,
  );
  assert.throws(
    () =>
      assertValidPhysicalDieDefinition({
        ...validConvexDefinition,
        id: 'test:open-collider',
        collider: { kind: 'convex', vertices: cubeVertices, faces: cubeFaces.slice(0, 5) },
      }),
    /must be a closed manifold/,
  );
  const nonPlanarVertices = structuredClone(cubeVertices);
  nonPlanarVertices[6][2] = 0.5;
  assert.throws(
    () =>
      assertValidPhysicalDieDefinition({
        ...validConvexDefinition,
        id: 'test:non-planar-collider',
        collider: { kind: 'convex', vertices: nonPlanarVertices, faces: cubeFaces },
      }),
    /must be planar/,
  );
  const concaveVertices = [...structuredClone(cubeVertices), [0, 0.2, 0]];
  const concaveFaces = [
    [0, 1, 2, 3],
    [4, 7, 6, 5],
    [0, 4, 5, 1],
    [0, 3, 7, 4],
    [1, 5, 6, 2],
    [3, 2, 8],
    [2, 6, 8],
    [6, 7, 8],
    [7, 3, 8],
  ];
  assert.throws(
    () =>
      assertValidPhysicalDieDefinition({
        ...validConvexDefinition,
        id: 'test:concave-collider',
        collider: { kind: 'convex', vertices: concaveVertices, faces: concaveFaces },
      }),
    /is not convex/,
  );
  assert.throws(
    () =>
      assertValidPhysicalDieDefinition({
        ...validDefinition,
        collider: {
          kind: 'convex',
          vertices: Array.from({ length: 4_097 }, (_entry, index) => [index, 0, 0]),
          faces: [
            [0, 1, 2],
            [0, 3, 1],
            [1, 3, 2],
            [0, 2, 3],
          ],
        },
      }),
    /at most 4096 vertices/,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        tested: [
          'd1-d3 duplicate supports',
          'd4 tip labels',
          'd5 edge labels',
          'arbitrary exact dN',
          'high-count representative',
          'physical definition validation',
          'physical definition clone isolation',
          'readable geometry validation',
          'bounded convex geometry',
          'closed convex manifold validation',
          'non-planar face rejection',
          'concave collider rejection',
          'degenerate face rejection',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
