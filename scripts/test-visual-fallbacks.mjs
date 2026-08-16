import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const [
  renderer,
  physicalContract,
  engine,
  visuals,
  physicalDice,
  physicalVisuals,
  physicalPlanner,
  rollWorker,
  physicsShapes,
  restingPhysics,
  visualBase,
  polyhedra,
  html,
] = await Promise.all([
  readFile(new URL('../packages/renderer/src/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../packages/renderer/src/physical.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/fallback-visuals.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/physical-dice.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/physical-die-visuals.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/physical-roll-planner.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/roll-worker.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/physics-shapes.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/resting-physics.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/fallback-visuals-base.ts', import.meta.url), 'utf8'),
  readFile(new URL('../packages/renderer/src/polyhedra.ts', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
]);

for (const kind of ['coin', 'percentile', 'fate', 'spinner', 'token', 'card']) {
  assert.match(
    renderer,
    new RegExp(`['"]${kind}['"]`),
    `renderer fallback kind ${kind} is missing`,
  );
}
assert.match(renderer, /DraftrollFallbackVisual/);
assert.match(renderer, /visualOrder/);
assert.match(renderer, /normalizeFallbackKind/);

assert.match(engine, /spawnFallbackVisuals/);
assert.match(engine, /createFallbackOnlyPlan/);
assert.match(engine, /collectOrderedVisualResults/);
assert.match(engine, /visual\.update\(fallbackProgress, plan\.duration\)/);
assert.match(engine, /fallbacks:\s*activeFallbackSpecs/);

// The serializable contract is public; runtime conversion/factories live in the browser engine.
assert.match(physicalContract, /interface PhysicalDieDefinition/);
assert.match(physicalContract, /PhysicalDieGeometrySource = 'canonical' \| 'generated' \| 'theme'/);
assert.match(physicalContract, /PhysicalDieTargetingMode = 'symmetry' \| 'relabel' \| 'fixed'/);
for (const content of ['number', 'text', 'icon', 'texture']) {
  assert.match(
    physicalContract,
    new RegExp(`kind: '${content}'`),
    `physical face content ${content} missing`,
  );
}
assert.match(physicalContract, /interface PhysicalDieOutcomeSlot/);
assert.match(physicalContract, /result\?: number \| string/);
assert.match(physicalContract, /supportNormals/);
assert.match(physicalContract, /labelAnchors/);
assert.match(physicalContract, /interface CustomPhysicalDieDefinitionInput/);

assert.match(physicalDice, /from '\.\.\/packages\/renderer\/src\/physical'/);
assert.match(physicalDice, /createCanonicalPhysicalDieDefinition/);
assert.match(physicalDice, /createGeneratedPhysicalDieDefinition/);
assert.match(physicalDice, /createCustomPhysicalDieDefinition/);
assert.match(physicalDice, /createPhysicalDiePresentation/);
assert.match(physicalDice, /createPhysicalDieCollider/);
assert.match(physicalDice, /physicalDieColliderRadius/);
assert.match(physicalDice, /resolveLandedPhysicalOutcome/);
assert.match(physicalDice, /remapPhysicalDiePresentationToOutcome/);
assert.match(physicalDice, /findPhysicalOutcomeIndex/);
assert.match(physicalDice, /targeting: 'symmetry'/);
assert.match(physicalDice, /targeting: 'relabel'/);

// The old canonical physics helper is now only a compatibility facade over PhysicalDieDefinition.
assert.match(physicsShapes, /createCanonicalPhysicalDieDefinition/);
assert.match(physicsShapes, /createPhysicalDieCollider/);
assert.match(physicsShapes, /CANONICAL_COLLISION_SCALE/);
assert.doesNotMatch(physicsShapes, /COLLIDER_DATA/);

// Resting-state correction is definition-driven rather than hard-coded by DieKind.
assert.match(restingPhysics, /minimumPhysicalRestingAlignment/);
assert.match(restingPhysics, /readPhysicalRestingAlignment/);
assert.match(restingPhysics, /definition\.outcomes/);
assert.match(restingPhysics, /createCanonicalPhysicalDieDefinition/);
assert.doesNotMatch(restingPhysics, /RESULT_DIRECTIONS/);

// One shared planner owns Cannon setup, contacts, locked motion, caching and trajectory recording.
assert.match(physicalPlanner, /class PhysicalRollPlanner/);
assert.match(physicalPlanner, /private cache: PlannerCache \| null/);
assert.match(physicalPlanner, /cacheKey/);
assert.match(physicalPlanner, /createPhysicalDieCollider/);
assert.match(
  physicalPlanner,
  /new CANNON\.ContactMaterial\(this\.diceMaterial, this\.diceMaterial/,
);
assert.match(physicalPlanner, /lockedMotion/);
assert.match(physicalPlanner, /updateLockedBodies/);
assert.match(physicalPlanner, /world\.step\(PHYSICAL_PLANNER_STEP\)/);
assert.match(physicalPlanner, /readPhysicalRestingAlignment/);
assert.match(physicalPlanner, /releaseUnstableRestPose/);
assert.match(physicalPlanner, /resolveLandedPhysicalOutcome/);
assert.match(physicalPlanner, /extractPhysicalTransforms/);

// The established roll worker is the only physical worker protocol for canonical + additional dice.
assert.match(rollWorker, /PhysicalRollPlanner/);
assert.match(rollWorker, /AdditionalPhysicalPlanEntry/);
assert.match(rollWorker, /definition\?: PhysicalDieDefinition/);
assert.match(rollWorker, /createCanonicalPhysicalDieDefinition/);
assert.match(rollWorker, /createGeneratedPhysicalDieDefinition/);
assert.match(rollWorker, /additionalTransforms/);
assert.match(rollWorker, /additionalLandings/);
assert.match(rollWorker, /extractPhysicalTransforms/);
assert.doesNotMatch(rollWorker, /new CANNON\.World/);

// Numeric spinner inputs are promoted immediately into the physical model.
assert.match(visuals, /PhysicalDieVisualInstance/);
assert.match(visuals, /usesPhysicalDieModel/);
assert.doesNotMatch(visuals, /GeneratedFallbackVisualInstance/);
assert.match(physicalVisuals, /class PhysicalDieVisualInstance/);
assert.match(physicalVisuals, /createGeneratedPhysicalDieDefinition/);
assert.match(physicalVisuals, /createDefaultPhysicalDiePresentation/);
assert.match(physicalVisuals, /remapPhysicalDiePresentation/);
assert.match(physicalVisuals, /physicalDieColliderRadius/);
assert.match(physicalVisuals, /getPhysicalFallbackPlanEntries/);
assert.match(physicalVisuals, /commitPhysicalFallbackPlan/);
assert.match(physicalVisuals, /capturePhysicalFallbackReplay/);
assert.match(physicalVisuals, /restorePhysicalFallbackReplay/);
assert.match(physicalVisuals, /activePhysicalDice/);
assert.match(physicalVisuals, /pendingPhysicalDice/);
assert.doesNotMatch(physicalVisuals, /Worker\.prototype/);
assert.doesNotMatch(physicalVisuals, /PhysicalRollPlanner/);
assert.doesNotMatch(physicalVisuals, /localPlanner/);
assert.doesNotMatch(physicalVisuals, /new Worker\(/);
assert.doesNotMatch(physicalVisuals, /new CANNON\.World/);
assert.match(engine, /getPhysicalFallbackPlanEntries/);
assert.match(engine, /commitPhysicalFallbackPlan/);
assert.match(engine, /additional,/);
assert.match(engine, /hasPendingPhysicalFallbackDice/);
assert.match(engine, /physicalFallbackReplay/);
assert.doesNotMatch(physicalVisuals, /settledRotation/);

// Runtime themes can paint arbitrary artwork into generated physical outcome slots.
assert.match(physicalVisuals, /getRuntimeThemeTexture/);
assert.match(physicalVisuals, /getRuntimeThemeMaterial/);
assert.match(physicalVisuals, /function atlasCellTexture/);
assert.match(physicalVisuals, /LABEL_ATLAS_COLUMNS = 5/);
assert.match(physicalVisuals, /LABEL_ATLAS_ROWS = 4/);
assert.match(physicalVisuals, /getRuntimeThemeTexture\(spec\.theme, spec\.type, 'label'\)/);
assert.match(physicalVisuals, /ownedLabelTextures/);

// Generated geometry remains the arbitrary-shape provider, not a separate die architecture.
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

// Cards/coins/symbolic visuals still belong to the non-die presentation layer.
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

assert.match(html, /1d20\+1d2\+1dF\+1d9\+1d100/);

// These modules were the old parallel generated/physical worker architecture and must stay deleted.
for (const legacy of [
  '../src/generated-die-visuals.ts',
  '../src/generated-roll-worker.ts',
  '../src/physical-roll-worker.ts',
]) {
  await assert.rejects(access(new URL(legacy, import.meta.url)));
}

console.log(
  JSON.stringify(
    {
      ok: true,
      publicPhysicalDieContract: true,
      physicalDieArchitecture: true,
      canonicalGeneratedAndCustomDefinitions: true,
      systemAgnosticOutcomes: true,
      extensibleFaceContent: ['number', 'text', 'icon', 'texture'],
      targetingModes: ['symmetry', 'relabel', 'fixed'],
      sharedPhysicalPlanner: true,
      unifiedRollWorkerProtocol: true,
      explicitPhysicalWorkerIntegration: true,
      deterministicArbitraryPhysicalReplay: true,
      onePhysicalWorker: true,
      cachedPlannerWorlds: true,
      additiveLockedMotion: true,
      genericRestingPhysics: true,
      generatedGeneratedCollisions: true,
      generatedStandardCollisions: true,
      runtimeThemeArtwork: true,
      noParallelGeneratedPhysicsEngine: true,
      automaticFaceEdgeVertexLabels: true,
      generatedFaceLabelCoverage: true,
      naturalGeneratedPhysics: true,
      roundedCardGeometry: true,
      collisionFreeCardLayout: true,
      cardDealAnimation: true,
    },
    null,
    2,
  ),
);
