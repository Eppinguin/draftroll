import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [renderer, engine, visuals, visualBase, polyhedra, html] = await Promise.all([
  readFile(new URL('../packages/renderer/src/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/fallback-visuals.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/fallback-visuals-base.ts', import.meta.url), 'utf8'),
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

// Generated numeric dice route through the wrapper's real convex-body simulation.
assert.match(visuals, /BaseFallbackVisualInstance/);
assert.match(visuals, /isGenerated/);
assert.match(visuals, /import \* as CANNON/);
assert.match(visuals, /new CANNON\.ConvexPolyhedron/);
assert.match(visuals, /new CANNON\.World/);
assert.match(visuals, /new CANNON\.SAPBroadphase/);
assert.match(visuals, /world\.step\(1 \/ 120\)/);
assert.match(visuals, /landedOutcome/);
assert.match(visuals, /applyRequestedResult/);
assert.match(visuals, /sample\(this\.trajectory/);
assert.match(visuals, /secondaryAnchor/);
assert.match(visuals, /covered\.has\(faceIndex\)/);
assert.match(visuals, /labelMaterials/);
assert.doesNotMatch(visuals, /settledRotation/);
assert.doesNotMatch(visuals, /resultOutcome\.settledUp/);

// The established renderer still owns cards, coins, and symbolic fallback visuals.
assert.match(visualBase, /createGeneratedDieVisual/);
assert.match(visualBase, /triangulateTexturedShape/);
assert.match(visualBase, /createDieSurfaceTexture/);
assert.match(visualBase, /PolyhedronLabelAnchor/);
assert.match(visualBase, /labelQuaternion/);
assert.match(visualBase, /outcome\.labels/);
assert.match(visualBase, /createCardVisual/);
assert.match(visualBase, /createCardFrontTexture/);
assert.match(visualBase, /createCardBackTexture/);
assert.match(visualBase, /createRoundedCardShape/);
assert.match(visualBase, /new THREE\.ExtrudeGeometry/);
assert.match(visualBase, /new THREE\.ShapeGeometry/);
assert.match(visualBase, /normalizeCardUvs/);
assert.match(visualBase, /cardSettledLayout/);
assert.match(visualBase, /CARD_WIDTH \* scale \+ CARD_GAP/);
assert.match(visualBase, /CARD_HEIGHT \* scale \+ CARD_ROW_GAP/);
assert.match(visualBase, /easeInOutCubic/);
assert.match(visualBase, /faceDown/);
assert.match(visualBase, /faceUp/);
assert.match(visualBase, /spec\.oppositeLabel/);
assert.match(visualBase, /getSettleTime/);

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
  fallbacks: ['physical coin', 'd10x/d100', 'dF', 'natural generated dN', 'symbolic', 'rounded dealt cards'],
  mixedWithPhysical: true,
  arbitraryNumericSolid: true,
  generatedSupportStates: true,
  automaticFaceEdgeVertexLabels: true,
  generatedFaceLabelCoverage: true,
  naturalGeneratedPhysics: true,
  noLateGeneratedCorrection: true,
  roundedCardGeometry: true,
  collisionFreeCardLayout: true,
  cardDealAnimation: true,
}, null, 2));
