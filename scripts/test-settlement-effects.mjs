import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { loadTypeScript } from './lib/load-typescript.mjs';

const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'draftroll-settlement-effects-'));

try {
  const ts = loadTypeScript();
  const source = await readFile(join(root, 'src/settlement.ts'), 'utf8');
  const transpiled = ts.transpileModule(source, {
    fileName: 'settlement.ts',
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, strict: true },
  });
  assert.equal(transpiled.diagnostics?.length ?? 0, 0, 'settlement helper must transpile without diagnostics');
  const modulePath = join(temp, 'settlement.mjs');
  await writeFile(modulePath, transpiled.outputText);
  const { consumeSettledVisualIndexes, deriveDieSettleTimes } = await import(pathToFileURL(modulePath).href);

  const frameCount = 6;
  const dieCount = 2;
  const transforms = new Float32Array(frameCount * dieCount * 7);
  const writePose = (frame, die, x, angle = 0) => {
    const offset = frame * dieCount * 7 + die * 7;
    transforms[offset] = x;
    transforms[offset + 1] = 0.7;
    transforms[offset + 2] = 0;
    transforms[offset + 3] = 0;
    transforms[offset + 4] = Math.sin(angle / 2);
    transforms[offset + 5] = 0;
    transforms[offset + 6] = Math.cos(angle / 2);
  };

  // Die 0 pauses at its eventual position, moves again, then finally settles.
  [0, 1, 3, 2, 2, 2].forEach((x, frame) => writePose(frame, 0, x));
  // Die 1 reaches the final position earlier but keeps rotating until frame 4.
  [0, 1, 2, 2, 2, 2].forEach((x, frame) => writePose(frame, 1, x, frame < 4 ? 0.3 : 0));
  const times = deriveDieSettleTimes({
    step: 0.1,
    frameCount,
    dieCount,
    transforms,
    activationDelays: Float32Array.from([0, 0.45]),
  });
  assert.ok(Math.abs(times[0] - 0.3) < 1e-6, 'a temporary pause must not trigger before the last movement');
  assert.ok(Math.abs(times[1] - 0.45) < 1e-6, 'settlement cannot predate the die activation delay');

  const consumed = new Set();
  assert.deepEqual(consumeSettledVisualIndexes(['old-a', 'old-b'], times, 0.31, consumed), [0]);
  assert.deepEqual(consumeSettledVisualIndexes(['old-a', 'old-b'], times, 0.5, consumed), [1]);
  assert.deepEqual(consumeSettledVisualIndexes(['old-a', 'old-b'], times, 1, consumed), [], 'settled visuals must never be returned twice');
  assert.deepEqual(
    consumeSettledVisualIndexes(['old-a', 'old-b', 'new-c'], [0, 0, 0.7], 0.8, consumed),
    [2],
    'an additive plan must emit only the newly introduced visual',
  );

  const main = await readFile(join(root, 'src/main.ts'), 'utf8');
  const revealStart = main.indexOf('function revealResults(): void');
  const revealEnd = main.indexOf('\nfunction updateQuantity', revealStart);
  const reveal = main.slice(revealStart, revealEnd);
  assert.ok(revealStart >= 0 && revealEnd > revealStart, 'result reveal implementation is missing');
  assert.ok(!reveal.includes('effects.playOutcome'), 'roll completion must not replay effects for every visible die');
  assert.ok(main.includes('const playedOutcomeEffectIds = new Set<string>()'), 'one-shot visual identity registry is missing');
  assert.ok(main.includes('function playSettledOutcomeEffects(plan: RollPlan, currentTime: number)'), 'per-die settlement effect dispatcher is missing');
  assert.ok(main.includes('playSettledOutcomeEffects(activePlan, planTime)'), 'animation loop does not dispatch effects at die settlement');
  assert.ok(main.includes('consumeSettledVisualIndexes('), 'settled effects are not deduplicated by visual identity');
  assert.ok(main.includes('time: settleTimes[dieIndex] ?? plan.duration'), 'replay effect timelines are not aligned to per-die settlement');

  console.log(JSON.stringify({
    ok: true,
    tested: [
      'temporary-pause rejection',
      'final-position settlement timing',
      'activation-delay floor',
      'one-shot die identity registry',
      'additive-plan old-die deduplication',
      'no roll-completion effect replay',
      'animation-loop settlement dispatch',
      'replay settlement timeline',
    ],
  }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}
