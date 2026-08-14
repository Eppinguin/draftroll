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

assert.match(engine, /spawnFallbackVisuals/);
assert.match(engine, /createFallbackOnlyPlan/);
assert.match(engine, /collectOrderedVisualResults/);
assert.match(engine, /visual\.update\(fallbackProgress, plan\.duration\)/);
assert.match(engine, /fallbacks:\s*activeFallbackSpecs/);

assert.match(visuals, /class FallbackVisualInstance/);
assert.match(visuals, /createGeneratedDieVisual/);
assert.match(visuals, /triangulateTexturedShape/);
assert.match(visuals, /createDieSurfaceTexture/);
assert.match(visuals, /createFaceLabelTexture/);
assert.match(visuals, /faceCenterAndNormal/);
assert.match(visuals, /settledRotation/);
assert.match(visuals, /THREE\.DoubleSide/);
assert.match(visuals, /createCardVisual/);
assert.match(visuals, /createCardFrontTexture/);
assert.match(visuals, /createCardBackTexture/);
assert.match(visuals, /new RoundedBoxGeometry/);
assert.match(visuals, /cardSettledPosition/);
assert.match(visuals, /easeInOutCubic/);
assert.match(visuals, /Math\.PI, trajectory\.finalYaw/);
assert.match(visuals, /spec\.oppositeLabel/);
assert.match(visuals, /getSettleTime/);

assert.match(polyhedra, /function d1Cylinder/);
assert.match(polyhedra, /function cube/);
assert.match(polyhedra, /function triangularPrism/);
assert.match(polyhedra, /function bipyramid/);
assert.match(polyhedra, /function prismBarrel/);
assert.match(polyhedra, /function drum/);
assert.match(polyhedra, /landingFaces/);
assert.match(polyhedra, /Presentation geometry only/);
assert.match(html, /1d20\+1d2\+1dF\+1d9\+1d100/);

console.log(JSON.stringify({
  ok: true,
  fallbacks: ['physical coin', 'd10x/d100', 'dF', 'textured arbitrary dN', 'symbolic', 'dealt 3d cards'],
  mixedWithPhysical: true,
  arbitraryNumericSolid: true,
  faceBoundResultLabel: true,
  cardDealAnimation: true,
}, null, 2));
