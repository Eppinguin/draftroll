import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/main.ts', import.meta.url);
let main = await readFile(path, 'utf8');

const needle = `      if (hasArbitraryPhysicalDice) {
        setPhysicalDiceVisible(true);
        throw error;
      }
      console.error('Roll planner failed; using local canonical fallback.', error);
      try {
        plan = applyShapeSymmetryTargets(buildRollPlanSync(states));`;
const replacement = `      console.error('Roll worker failed; using shared main-thread planner.', error);
      try {
        const fallbackEntries = createWorkerPhysicalEntries(states);
        const fallbackResult = mainThreadPhysicalPlanner.simulate({
          entries: fallbackEntries,
          boundsX: screenBounds.x,
          boundsZ: screenBounds.z,
          gravity: PHYSICS_PRESETS[activePhysicsPreset].gravity,
        });
        plan = completePhysicalPlan(
          plannerResultAsRollPlan(fallbackResult, fallbackEntries.length, 0),
          fallbackEntries,
          0,
        );`;

const count = main.split(needle).length - 1;
if (count !== 1) throw new Error(`shared planner recovery expected once, found ${count}`);
main = main.replace(needle, replacement);

for (const legacy of ['buildRollPlanSync', 'cloneDynamicBody', 'contactSimilarity']) {
  if (main.includes(legacy)) throw new Error(`legacy planner symbol survived: ${legacy}`);
}
if (!main.includes('function enforceBodiesBounds(')) {
  throw new Error('live-world bounds guard was removed with the planner');
}
if (!main.includes("Roll worker failed; using shared main-thread planner.")) {
  throw new Error('shared planner recovery path was not installed');
}

await writeFile(path, main);
console.log('shared main-thread recovery path installed');
