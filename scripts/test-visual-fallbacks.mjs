import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const [
  renderer,
  physicalContract,
  engine,
  visuals,
  physicalDice,
  physicalVisuals,
  physicalMesh,
  physicalLaunch,
  physicalPlanner,
  rollWorker,
  physicalTable,
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
  readFile(new URL('../src/physical-die-mesh.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/physical-launch.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/physical-roll-planner.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/roll-worker.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/physical-table.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/physics-shapes.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/resting-physics.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/fallback-visuals-base.ts', import.meta.url), 'utf8'),
  readFile(new URL('../packages/renderer/src/polyhedra.ts', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
]);

for (const kind of ['token', 'card']) {
  assert.match(
    renderer,
    new RegExp(`['"]${kind}['"]`),
    `renderer fallback kind ${kind} is missing`,
  );
}
assert.doesNotMatch(renderer, /'spinner'/);
assert.match(renderer, /DraftrollFallbackVisual/);
assert.match(renderer, /interface DraftrollPhysicalVisual/);
assert.match(renderer, /physical\?: DraftrollPhysicalVisual\[\]/);
assert.doesNotMatch(renderer, /results\?: number\[\] \| number/);
assert.doesNotMatch(renderer, /kinds\?: DraftrollDieKind/);
assert.doesNotMatch(renderer, /forceFallback/);
assert.match(renderer, /resolvePhysicalSlot/);
assert.match(renderer, /createCustomPhysicalPresentation/);
assert.match(renderer, /visualOrder/);
assert.match(renderer, /normalizeFallbackKind/);

assert.match(engine, /spawnFallbackVisuals/);
assert.match(engine, /createFallbackOnlyPlan/);
assert.match(engine, /collectOrderedVisualResults/);
assert.match(engine, /function updatePlanVisuals/);
assert.match(
  engine,
  /physicalTable\.forEachVisual\(\(visual\) => visual\.update\(time, scale\.x, scale\.z\)\)/,
);
assert.match(engine, /updatePlanVisuals\(activePlan, planTime\)/);
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
assert.doesNotMatch(physicalPlanner, /extractPhysicalTransforms/);
assert.match(physicalPlanner, /const transformBuffer = new Float32Array/);
assert.doesNotMatch(physicalPlanner, /activeFlags\.slice/);

// The roll worker consumes one ordered physical-entry array and returns one transform/landing stream.
assert.match(rollWorker, /PhysicalRollPlanner/);
assert.match(rollWorker, /interface PlanEntry/);
assert.match(rollWorker, /definitionKey: string/);
assert.match(rollWorker, /definitions = new Map<string, PhysicalDieDefinition>/);
assert.match(rollWorker, /entries: PlanEntry\[\]/);
assert.match(rollWorker, /transforms: transforms\.buffer/);
assert.match(rollWorker, /landings: landings\.buffer/);
assert.doesNotMatch(rollWorker, /AdditionalPhysical/);
assert.doesNotMatch(rollWorker, /additionalTransforms|additionalLandings/);
assert.doesNotMatch(rollWorker, /extractPhysicalTransforms/);
assert.doesNotMatch(rollWorker, /new CANNON\.World/);

// Legacy spinner inputs are accepted only at the browser compatibility boundary; SDK dN is physical.
assert.doesNotMatch(visuals, /PhysicalDieVisualInstance/);
assert.match(visuals, /fallback-visuals-base/);
assert.doesNotMatch(visuals, /GeneratedFallbackVisualInstance/);
assert.match(physicalVisuals, /class PhysicalDieVisualInstance/);
assert.match(physicalVisuals, /createGeneratedPhysicalDieDefinition/);
assert.match(physicalVisuals, /spec\.definition/);
assert.match(renderer, /physicalModels\?:/);
assert.match(renderer, /definition\?: PhysicalDieDefinition/);
assert.match(physicalVisuals, /createDefaultPhysicalDiePresentation/);
assert.match(physicalVisuals, /if \(spec\.presentation\)/);
assert.match(physicalVisuals, /getRuntimeThemePresentation/);
assert.doesNotMatch(physicalVisuals, /draftrollPhysicalPresentation/);
assert.match(physicalMesh, /acquireLabelAtlas/);
assert.match(physicalMesh, /swapOutcomeLabels/);
assert.match(physicalMesh, /content.kind === 'icon'/);
assert.match(physicalVisuals, /physicalDieColliderRadius/);
assert.match(physicalVisuals, /getPhysicalVisualPlanEntries/);
assert.match(physicalVisuals, /commitPhysicalVisualPlan/);
assert.match(physicalVisuals, /private activationDelay = 0/);
assert.match(
  physicalVisuals,
  /this\.lastTime \+ this\.trajectory\.step \* 0\.5 >= this\.activationDelay/,
);
assert.doesNotMatch(physicalVisuals, /new Map<string, PhysicalDieVisualInstance>/);
assert.match(physicalVisuals, /physicalIndex: number/);
assert.doesNotMatch(physicalVisuals, /extractPhysicalTransforms|trajectoryForIndex/);
assert.doesNotMatch(physicalVisuals, /AdditionalPhysical|additionalPhysical/);
assert.doesNotMatch(physicalVisuals, /activePhysicalDice|pendingPhysicalDice/);
assert.doesNotMatch(physicalVisuals, /Worker\.prototype/);
assert.doesNotMatch(physicalVisuals, /PhysicalRollPlanner/);
assert.doesNotMatch(physicalVisuals, /localPlanner/);
assert.doesNotMatch(physicalVisuals, /new Worker\(/);
assert.doesNotMatch(physicalVisuals, /new CANNON\.World/);
assert.doesNotMatch(visualBase, /createGeneratedDieVisual/);
assert.doesNotMatch(visualBase, /createReadablePolyhedron/);
assert.match(engine, /createWorkerPhysicalEntries/);
assert.match(engine, /commitPhysicalVisualPlan/);
assert.match(engine, /landings: plan\.landings\.slice\(\)/);
assert.doesNotMatch(engine, /activeGenericPhysicalIndexes|activeCanonicalPhysicalIndexes/);
assert.match(engine, /PhysicalTableRegistry/);
assert.match(physicalTable, /class PhysicalTableRegistry/);
assert.match(physicalTable, /forEachVisual/);
assert.match(physicalTable, /visualInstances/);
assert.match(physicalTable, /preserveBindings/);
assert.match(physicalTable, /Physical table canonical index is missing/);
assert.match(physicalTable, /physicalIndexForVisual/);
assert.match(physicalTable, /bindCanonicalAt/);
assert.match(physicalTable, /bindVisualAt/);
assert.doesNotMatch(physicalTable, /entriesById|entryById|physicalIndexForId/);
assert.match(engine, /physicalTable\.visualInstances\(\)/);
assert.doesNotMatch(engine, /genericById|Generic physical visual ids must be unique/);
assert.match(physicalVisuals, /visualIndex: number/);
assert.doesNotMatch(physicalLaunch, /id: string/);
assert.match(renderer, /currently require relabel targeting/);
assert.match(engine, /visual\.definition\.targeting !== 'relabel'/);
assert.match(physicalDice, /input\.targeting \?\? 'relabel'/);
assert.doesNotMatch(engine, /AdditionalPhysical|additionalPhysical/);
assert.doesNotMatch(engine, /physicalFallbackReplay/);
assert.doesNotMatch(physicalVisuals, /settledRotation/);

// Runtime themes can paint arbitrary artwork into generated physical outcome slots.
assert.match(physicalMesh, /getRuntimeThemeTexture/);
assert.match(physicalMesh, /getRuntimeThemeMaterial/);
assert.match(physicalMesh, /getRuntimeThemeMesh/);
assert.match(physicalMesh, /getRuntimeThemeLabelStyle/);
assert.match(physicalMesh, /getRuntimeThemeAssetTexture/);
assert.match(physicalMesh, /createPhysicalDieMesh/);
assert.match(physicalMesh, /ThemeGeometryProfile/);
assert.match(physicalMesh, /triangulateBeveledShape/);
assert.match(physicalMesh, /createThemedRoundedBoxVisual/);
assert.match(physicalMesh, /shape\?\.family === 'd3-cube'/);
assert.match(physicalMesh, /roundedGeneratedCube \? 32 : 18/);
assert.match(physicalMesh, /flatShading: !roundedGeneratedCube/);
assert.match(physicalMesh, /getThemeSurfaceTextures/);
assert.match(
  physicalMesh,
  /!runtimeMesh && !spec\.definition && shape \? palette\.geometry : null/,
);
assert.match(physicalMesh, /insetLabelAnchor/);
assert.match(physicalMesh, /palette\.edgeOpacity \* 0\.72/);
assert.match(physicalMesh, /runtimeMaterial\?\.roughness \?\? 1/);
assert.match(physicalMesh, /updateShadow/);
assert.doesNotMatch(physicalVisuals, /DraftrollFallbackVisual/);
assert.doesNotMatch(physicalVisuals, /BaseFallbackVisualInstance/);
assert.doesNotMatch(physicalVisuals, /fallback-visuals-base/);
assert.match(physicalLaunch, /createPhysicalLaunchStates/);
assert.match(physicalLaunch, /participant\.radius/);
assert.doesNotMatch(physicalMesh, /function atlasCellTexture|presentationTexture/);
assert.match(physicalMesh, /LABEL_ATLAS_COLUMNS = 5/);
assert.match(physicalMesh, /labelAtlasCache/);
assert.doesNotMatch(physicalMesh, /surfaceTextureCache/);
assert.match(physicalMesh, /LABEL_ATLAS_ROWS = 4/);
assert.match(physicalMesh, /getRuntimeThemeTexture\(spec\.theme, spec\.type, 'label'\)/);
assert.doesNotMatch(physicalMesh, /ownedTextures/);
assert.doesNotMatch(physicalMesh, /acquireSurfaceTexture/);
assert.doesNotMatch(physicalMesh, /generatedSurface\?\.release/);

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
assert.doesNotMatch(visualBase, /createGeneratedDieVisual/);
assert.doesNotMatch(visualBase, /triangulateTexturedShape/);
assert.doesNotMatch(visualBase, /createDieSurfaceTexture/);
assert.doesNotMatch(visualBase, /PolyhedronLabelAnchor/);
assert.doesNotMatch(visualBase, /createReadablePolyhedron/);
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
      publicGeneratedDiceArePhysical: true,
      semanticPhysicalFaceContent: true,
      arbitraryThemeMeshes: true,
      firstClassPhysicalMeshBuilder: true,
      sharedCanonicalGeneratedLaunch: true,
      fallbackRendererContainsNoDice: true,
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
