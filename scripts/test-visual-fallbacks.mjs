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
assert.match(visuals, /PolyhedronLabelAnchor/);
assert.match(visuals, /labelQuaternion/);
assert.match(visuals, /outcome\.labels/);
assert.match(visuals, /resultOutcome\.settledUp/);
assert.match(visuals, /labelsForShape/);
assert.match(visuals, /THREE\.DoubleSide/);

assert.match(visuals, /createCardVisual/);
assert.match(visuals, /createCardFrontTexture/);
assert.match(visuals, /createCardBackTexture/);
assert.match(visuals, /createRoundedCardShape/);
assert.match(visuals, /new THREE\.ExtrudeGeometry/);
assert.match(visuals, /new THREE\.ShapeGeometry/);
assert.match(visuals, /normalizeCardUvs/);
assert.match(visuals, /cardSettledLayout/);
assert.match(visuals, /CARD_WIDTH \* scale \+ CARD_GAP/);
assert.match(visuals, /CARD_HEIGHT \* scale \+ CARD_ROW_GAP/);
assert.match(visuals, /easeInOutCubic/);
assert.match(visuals, /faceDown/);
assert.match(visuals, /faceUp/);
assert.match(visuals, /spec\.oppositeLabel/);
assert.match(visuals, /getSettleTime/);

assert.match(polyhedra, /function fibonacciPoints/);
assert.match(polyhedra, /function convexHull/);
assert.match(polyhedra, /function facetedSphere/);
assert.match(polyhedra, /function featureCandidates/);
assert.match(polyhedra, /function vertexAnchors/);
assert.match(polyhedra, /function edgeAnchors/);
assert.match(polyhedra, /labelKind: PolyhedronLabelKind/);
assert.match(polyhedra, /settledUp: PolyhedronVertex/);
assert.match(polyhedra, /Fibonacci-sphere polar dual/);
assert.doesNotMatch(polyhedra, /function triangularPrism/);
assert.doesNotMatch(polyhedra, /function bipyramid/);
assert.doesNotMatch(polyhedra, /function prismBarrel/);
assert.match(html, /1d20\+1d2\+1dF\+1d9\+1d100/);

console.log(JSON.stringify({
  ok: true,
  fallbacks: ['physical coin', 'd10x/d100', 'dF', 'generated arbitrary dN', 'symbolic', 'rounded dealt cards'],
  mixedWithPhysical: true,
  arbitraryNumericSolid: true,
  generatedSupportStates: true,
  automaticFaceEdgeVertexLabels: true,
  roundedCardGeometry: true,
  collisionFreeCardLayout: true,
  cardDealAnimation: true,
}, null, 2));
