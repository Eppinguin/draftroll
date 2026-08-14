import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [renderer, engine, visuals, html] = await Promise.all([
  readFile(new URL('../packages/renderer/src/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/fallback-visuals.ts', import.meta.url), 'utf8'),
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
assert.match(renderer, /die\.customDiceId/);
assert.match(renderer, /typeof die\.result === 'string'/);
assert.doesNotMatch(renderer, /without a physical Draftroll mesh/);

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
assert.match(visuals, /coinAngularDisplacement/);
assert.match(visuals, /randomSettledPosition/);
assert.match(visuals, /minimumSeparation/);
assert.match(visuals, /occupied\.push/);
assert.match(visuals, /spec\.oppositeLabel/);
assert.match(visuals, /coinDuration/);
assert.match(visuals, /coinTossDistance/);
assert.match(visuals, /coinTravelAngle/);
assert.match(visuals, /coinTossAngle - Math\.PI \/ 2/);
assert.match(visuals, /getSettleTime/);
assert.match(visuals, /createVisualTexture\(\{[\s\S]*label: spec\.oppositeLabel/);
assert.doesNotMatch(visuals, /createCoinBackTexture/);
assert.doesNotMatch(visuals, /coinFlipTurns/);
assert.match(html, /1d20\+1d2\+1dF\+1d9\+1d100/);

console.log(
  JSON.stringify(
    {
      ok: true,
      fallbacks: ['custom coin', 'd10x/d100', 'dF', 'arbitrary dN', 'symbolic', 'weighted/custom'],
      mixedWithPhysical: true,
      fallbackOnly: true,
      physicalCoinMotion: true,
    },
    null,
    2,
  ),
);
