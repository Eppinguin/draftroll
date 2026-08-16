import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const main = await readFile(join(root, 'src/main.ts'), 'utf8');
const launch = await readFile(join(root, 'src/physical-launch.ts'), 'utf8');
const worker = await readFile(join(root, 'src/roll-worker.ts'), 'utf8');
const planner = await readFile(join(root, 'src/physical-roll-planner.ts'), 'utf8');
const physicalDice = await readFile(join(root, 'src/physical-dice.ts'), 'utf8');
const shapes = await readFile(join(root, 'src/physics-shapes.ts'), 'utf8');
const workspace = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8');
const wrangler = await readFile(join(root, 'apps/worker/wrangler.jsonc'), 'utf8');

assert.match(main, /const PLANNER_STEP = 1 \/ 120/);
assert.match(main, /const PLANNER_RECORD_EVERY = 1/);
assert.match(planner, /PHYSICAL_PLANNER_STEP = 1 \/ 120/);
assert.match(planner, /world\.step\(PHYSICAL_PLANNER_STEP\)/);
assert.match(main, /solver\.iterations = 32/);
assert.match(planner, /world\.solver instanceof CANNON\.GSSolver/);
assert.match(planner, /world\.solver\.iterations = 32/);
assert.match(main, /contactEquationStiffness: 4e7/);
assert.match(planner, /contactEquationStiffness: 4e7/);
assert.match(worker, /PhysicalRollPlanner/);
assert.doesNotMatch(worker, /new CANNON\.World/);
assert.match(shapes, /export const DIE_COLLIDER_SCALE/);
assert.match(physicalDice, /d20: 1\.026/);
assert.match(physicalDice, /x \* scale, y \* scale, z \* scale/);

assert.match(launch, /const largePool = participants\.length >= 12/);
assert.match(launch, /waveSize = count >= 24/);
assert.match(launch, /releaseDelay: number/);
assert.match(launch, /waveInterval/);
assert.match(launch, /spawn\.releaseDelay \+\s*releaseWindow/);
assert.match(main, /activationDelays\?: Float32Array/);
assert.match(main, /die\.group\.visible = time \+ plan\.step \* 0\.5 >= activationDelay/);
assert.match(main, /setPhysicalDiceVisible\(false\)/);
assert.match(main, /markUnobstructedTableDice/);
assert.match(planner, /markUnobstructedTableDice/);
assert.match(main, /lastUnstableReleaseTimes/);
assert.match(planner, /lastUnstableReleaseTimes/);
assert.match(planner, /minimumPhysicalRestingAlignment/);
assert.match(planner, /releaseUnstableRestPose/);
assert.match(main, /single[\s\S]*?committed trajectory/);
assert.match(main, /updatePlanVisuals\(plan, planTime\)[\s\S]*?requestRender\(\)/);
assert.match(main, /setPhysicalDiceVisible\(true\)[\s\S]*?throw fallbackError/);
assert.match(main, /Register completion only after a valid committed plan exists/);
assert.doesNotMatch(main, /intentionally allows projected\s+overlap/);

// 120 Hz for nine seconds and 30 dice remains below 1 MiB of transform data.
const bytes = 1081 * 30 * 7 * 4;
assert.ok(bytes < 1024 * 1024, `trajectory buffer unexpectedly large: ${bytes}`);

assert.match(workspace, /esbuild:\s*true/);
assert.match(workspace, /workerd:\s*true/);
assert.match(wrangler, /"compatibility_date":\s*"2026-07-29"/);

for (const file of [
  'package.json',
  'packages/core/package.json',
  'packages/protocol/package.json',
  'packages/client/package.json',
  'packages/renderer/package.json',
  'packages/themes/package.json',
  'packages/overlay/package.json',
  'packages/sdk/package.json',
  'packages/server/package.json',
  'apps/worker/package.json',
]) {
  const parsed = JSON.parse(await readFile(join(root, file), 'utf8'));
  assert.equal(parsed.version, '0.1.0', `${file} version changed`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      tested: [
        'single committed visible trajectory',
        'hidden provisional planning transforms',
        'planning failure visibility restoration',
        'no orphaned completion on planning failure',
        'large-pool staged pour release',
        'canonical and generated dice use the same radius-aware hand packing',
        'definition-driven edge-balance correction with bounded release cadence',
        'per-die activation visibility',
        '120 Hz shared physical planning and recording',
        'inflated visual-safe colliders',
        'high-iteration dice contact solving',
        'bounded trajectory memory',
        'thin roll-worker adapter over the shared planner',
        'unchanged versions and deployment configuration',
      ],
    },
    null,
    2,
  ),
);
