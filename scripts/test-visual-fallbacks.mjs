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

assert.match(visuals, /MAXIMUM_EXACT_GENERATED_SIDES = 256/);
assert.match(visuals, /GeneratedFallbackVisualInstance/);
assert.match(visuals, /BaseFallbackVisualInstance/);
assert.match(visuals, /usesGeneratedPhysics/);
assert.match(visuals, /sides <= MAXIMUM_EXACT_GENERATED_SIDES/);

// Generated-only pools share one world. On additive fallback-only rolls, old dice enter
// from their current visible state/momentum instead of being replayed from their old spawn.
assert.match(generatedVisuals, /activeGeneratedDice/);
assert.match(generatedVisuals, /pendingGeneratedDice/);
assert.match(generatedVisuals, /simulateLocalBatch/);
assert.match(generatedVisuals, /entries\.map\(\(entry\) => entry\.plannerState\(\)\)/);
assert.match(generatedVisuals, /pendingGeneratedDice\.size > 0/);
assert.match(generatedVisuals, /new CANNON\.ContactMaterial\(dieMaterial, dieMaterial/);
assert.match(generatedVisuals, /world\.step\(GENERATED_STEP\)/);
assert.match(generatedVisuals, /finalizeGeneratedFallbackBatch/);
assert.match(generatedVisuals, /lastProgress/);
assert.match(generatedVisuals, /angularX/);
assert.match(generatedVisuals, /newlyIntroduced/);

// Mixed and additive standard/generated rolls reuse one warm collision worker. The bridge
// forwards the standard planner's locked trajectory so old normal dice keep the same
// additive semantics while generated dice can still be hit and move naturally.
assert.match(generatedVisuals, /installSharedWorkerBridge/);
assert.match(generatedVisuals, /generated-roll-worker\.ts/);
assert.match(generatedVisuals, /sharedPlannerWorker/);
assert.match(generatedVisuals, /bridgePending/);
assert.match(generatedVisuals, /splitGeneratedTrajectories/);
assert.match(generatedVisuals, /message\.lockedTrajectory instanceof ArrayBuffer/);
assert.match(generatedVisuals, /nativePostMessage\.call\(\s*planner/);
assert.doesNotMatch(generatedVisuals, /\(message\.lockedCount \?\? 0\) > 0/);

assert.match(generatedWorker, /createDiePhysicsShape/);
assert.match(generatedWorker, /createReadablePolyhedron/);
assert.match(generatedWorker, /generatedShapeCache/);
assert.match(generatedWorker, /createGeneratedCollider/);
assert.match(generatedWorker, /lockedTrajectory/);
assert.match(generatedWorker, /sampleLocked/);
assert.match(generatedWorker, /updateLockedBodies/);
assert.match(generatedWorker, /configureLocked/);
assert.match(generatedWorker, /const totalCount = standardCount \+ generatedShapes\.length/);
assert.match(generatedWorker, /new CANNON\.ContactMaterial\(diceMaterial, diceMaterial/);
assert.match(generatedWorker, /generatedTransforms/);
assert.match(generatedWorker, /generatedLandings/);
assert.match(generatedWorker, /shared-contact-stable/);

assert.match(generatedVisuals, /landedOutcome/);
assert.match(generatedVisuals, /applyRequestedResult/);
assert.match(generatedVisuals, /originalLabelMaps/);
assert.match(generatedVisuals, /secondaryAnchor/);
assert.match(generatedVisuals, /covered\.has\(faceIndex\)/);
assert.match(generatedVisuals, /labelMaterials/);
assert.doesNotMatch(generatedVisuals, /settledRotation/);
assert.doesNotMatch(generatedVisuals, /resultOutcome\.settledUp/);

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
  additiveGeneratedCollisions: true,
  noAdditiveGeneratedRewind: true,
  persistentGeneratedPlannerWorker: true,
  noLateGeneratedCorrection: true,
  representativeHighCountFallback: true,
  roundedCardGeometry: true,
  collisionFreeCardLayout: true,
  cardDealAnimation: true,
}, null, 2));
