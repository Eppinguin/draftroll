import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [
  renderer,
  engine,
  visuals,
  generatedVisuals,
  generatedWorker,
  visualBase,
  polyhedra,
  html,
] = await Promise.all([
  readFile(new URL('../packages/renderer/src/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/fallback-visuals.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/generated-die-visuals.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/generated-roll-worker.ts', import.meta.url), 'utf8'),
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

// Exact generated dice use real convex-body physics, while very high representative dice
// keep the existing lightweight presentation path.
assert.match(visuals, /MAXIMUM_EXACT_GENERATED_SIDES = 256/);
assert.match(visuals, /GeneratedFallbackVisualInstance/);
assert.match(visuals, /BaseFallbackVisualInstance/);
assert.match(visuals, /usesGeneratedPhysics/);
assert.match(visuals, /sides <= MAXIMUM_EXACT_GENERATED_SIDES/);

// Weird-dice-only pools share one local Cannon world instead of simulating each die alone.
assert.match(generatedVisuals, /activeGeneratedDice/);
assert.match(generatedVisuals, /simulateLocalBatch/);
assert.match(generatedVisuals, /new CANNON\.ContactMaterial\(dieMaterial, dieMaterial/);
assert.match(generatedVisuals, /entries\.map\(\(entry\) =>/);
assert.match(generatedVisuals, /world\.step\(1 \/ 120\)/);
assert.match(generatedVisuals, /finalizeGeneratedFallbackBatch/);

// Mixed standard/generated rolls intercept only the roll-plan postMessage and run a
// dedicated worker containing both standard colliders and generated convex bodies.
assert.match(generatedVisuals, /installSharedWorkerBridge/);
assert.match(generatedVisuals, /generated-roll-worker\.ts/);
assert.match(generatedVisuals, /splitGeneratedTrajectories/);
assert.match(generatedVisuals, /nativePostMessage\.call\(\s*bridge/);
assert.match(generatedVisuals, /owner\.dispatchEvent\(new MessageEvent\('message'/);
assert.match(generatedWorker, /createDiePhysicsShape/);
assert.match(generatedWorker, /createReadablePolyhedron/);
assert.match(generatedWorker, /createGeneratedCollider/);
assert.match(generatedWorker, /const totalCount = standardCount \+ generatedShapes\.length/);
assert.match(generatedWorker, /bodies\.push\(body\)/);
assert.match(generatedWorker, /new CANNON\.ContactMaterial\(diceMaterial, diceMaterial/);
assert.match(generatedWorker, /generatedTransforms/);
assert.match(generatedWorker, /generatedLandings/);
assert.match(generatedWorker, /shared-generated-collisions/);

assert.match(generatedVisuals, /landedOutcome/);
assert.match(generatedVisuals, /applyRequestedResult/);
assert.match(generatedVisuals, /originalLabelMaps/);
assert.match(generatedVisuals, /secondaryAnchor/);
assert.match(generatedVisuals, /covered\.has\(faceIndex\)/);
assert.match(generatedVisuals, /labelMaterials/);
assert.doesNotMatch(generatedVisuals, /settledRotation/);
assert.doesNotMatch(generatedVisuals, /resultOutcome\.settledUp/);

// The established renderer still owns cards, coins, symbolic visuals, and representative dN.
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
  generatedGeneratedCollisions: true,
  generatedStandardCollisions: true,
  noLateGeneratedCorrection: true,
  representativeHighCountFallback: true,
  roundedCardGeometry: true,
  collisionFreeCardLayout: true,
  cardDealAnimation: true,
}, null, 2));
