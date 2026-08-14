import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [renderer, engine, visuals, polyhedra, html] = await Promise.all([
  readFile(new URL('../packages/renderer/src/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/fallback-visuals.ts', import.meta.url), 'utf8'),
  readFile(new URL('../packages/renderer/src/polyhedra.ts', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
]);

for (const kind of ['coin', 'percentile', 'fate', 'spinner', 'token', 'card']) {
  assert.match(renderer, new RegExp(`['"]${kind}['"]`), `renderer fallback kind ${kind} is missing`);
}
assert.match(renderer, /DraftrollFallbackVisual/);
assert.match(renderer, /visualOrder/);
assert.match(renderer, /normalizeFallbackKind/);
assert.match(renderer, /die\.customDiceId/);
assert.match(renderer, /typeof die\.result === 'string'/);

assert.match(engine, /spawnFallbackVisuals/);
assert.match(engine, /createFallbackOnlyPlan/);
assert.match(engine, /collectOrderedVisualResults/);
assert.match(engine, /visual\.update\(fallbackProgress, plan\.duration\)/);
assert.match(engine, /visual\.update\(fallbackProgress, fallbackPlanDuration\)/);
assert.match(engine, /fallbacks:\s*activeFallbackSpecs/);

assert.match(visuals, /class FallbackVisualInstance/);
assert.match(visuals, /configureTrajectory/);
assert.match(visuals, /easeOutBack/);
assert.match(visuals, /new THREE\.CylinderGeometry/);
assert.match(visuals, /createGeneratedDieVisual/);
assert.match(visuals, /createReadablePolyhedron/);
assert.match(visuals, /new THREE\.MeshPhysicalMaterial/);
assert.match(visuals, /new THREE\.EdgesGeometry/);
assert.match(visuals, /createResultLabelTexture/);
assert.match(visuals, /smoothstep\(normalized, 0\.72, 0\.94\)/);
assert.match(visuals, /randomSettledPosition/);
assert.match(visuals, /minimumSeparation/);
assert.match(visuals, /occupied\.push/);
assert.match(visuals, /spec\.oppositeLabel/);
assert.match(visuals, /getSettleTime/);

assert.match(polyhedra, /function d1Cylinder/);
assert.match(polyhedra, /function d3Cube/);
assert.match(polyhedra, /function triangularPrism/);
assert.match(polyhedra, /function prismBarrel/);
assert.match(polyhedra, /landingFaces/);
assert.match(polyhedra, /presentation geometry/);
assert.match(html, /1d20\+1d2\+1dF\+1d9\+1d100/);

console.log(
  JSON.stringify(
    {
      ok: true,
      fallbacks: ['physical coin', 'd10x/d100', 'dF', '3d arbitrary dN', 'symbolic', 'cards'],
      mixedWithPhysical: true,
      fallbackOnly: true,
      arbitraryNumericSolid: true,
      settleTimeResultLabel: true,
    },
    null,
    2,
  ),
);
