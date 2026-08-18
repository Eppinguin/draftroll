import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runTsc } from './lib/load-typescript.mjs';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tempRoot = await mkdtemp(join(projectRoot, 'node_modules/.generated-polyhedra-'));
const outDir = join(tempRoot, 'build');

try {
  await mkdir(outDir, { recursive: true });
  const polyhedraSource = join(projectRoot, 'packages/renderer/src/polyhedra.ts');
  const physicalSource = join(projectRoot, 'packages/renderer/src/physical.ts');
  const compile = runTsc([
    '--strict',
    '--target', 'ES2022',
    '--lib', 'ES2023,DOM',
    '--module', 'ESNext',
    '--moduleResolution', 'Bundler',
    '--outDir', outDir,
    polyhedraSource,
    physicalSource,
  ], { cwd: projectRoot });
  if (compile.status !== 0) {
    process.stderr.write(compile.stdout);
    process.stderr.write(compile.stderr);
    throw new Error('Generated polyhedra compilation failed');
  }
  await writeFile(join(outDir, 'package.json'), '{"type":"module"}\n');
  const polyhedraModule = await import(pathToFileURL(join(outDir, 'polyhedra.js')).href);
  const physicalModule = await import(pathToFileURL(join(outDir, 'physical.js')).href);
  const { createReadablePolyhedron } = polyhedraModule;
  const { assertValidPhysicalDieDefinition, clonePhysicalDieDefinition } = physicalModule;

  for (const sides of [4, 5, 7, 9, 12, 20, 100, 256]) {
    const shape = createReadablePolyhedron(sides);
    assert.equal(shape.faces.length, sides, `d${sides} has exactly ${sides} planar faces`);
    assert.equal(shape.outcomes.length, sides, `d${sides} has one support state per result`);
    assert.equal(shape.exact, true, `d${sides} remains exact`);
    for (const outcome of shape.outcomes) {
      assert.ok(outcome.labels.length >= 1, `d${sides} outcome ${outcome.value} has a readable label anchor`);
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
  assert.deepEqual(d3.outcomes.map((outcome) => outcome.labels.length), [2, 2, 2]);

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

  console.log(JSON.stringify({
    ok: true,
    tested: [
      'd1-d3 duplicate supports',
      'd4 tip labels',
      'd5 edge labels',
      'arbitrary exact dN',
      'high-count representative',
      'physical definition validation',
      'physical definition clone isolation',
    ],
  }, null, 2));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
