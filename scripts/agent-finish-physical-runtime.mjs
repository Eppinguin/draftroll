import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/main.ts', import.meta.url);
let main = await readFile(path, 'utf8');

const recoveryNeedle = `      if (hasArbitraryPhysicalDice) {
        setPhysicalDiceVisible(true);
        throw error;
      }
      console.error('Roll planner failed; using local canonical fallback.', error);
      try {
        plan = applyShapeSymmetryTargets(buildRollPlanSync(states));`;
const recoveryReplacement = `      console.error('Roll worker failed; using shared main-thread planner.', error);
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

const recoveryCount = main.split(recoveryNeedle).length - 1;
if (recoveryCount !== 1) {
  throw new Error(`shared planner recovery expected once, found ${recoveryCount}`);
}
main = main.replace(recoveryNeedle, recoveryReplacement);

const appendNeedle = `function appendGenericPhysicalVisuals(
  specs: readonly DraftrollPhysicalVisual[],
  seed: string,
): PhysicalDieVisualInstance[] {
  if (specs.length === 0) return [];
  const start = genericPhysicalVisuals.length;
  const total = start + specs.length;
  const random = createSeededRandom(\`${'${seed}'}:additive-physical\`);
  const occupied = genericPhysicalVisuals.map((visual) => visual.getSettledPosition());
  const appended = specs.map((spec, offset) => {
    const visual = new PhysicalDieVisualInstance(spec);
    visual.configureTrajectory(start + offset, total, screenBounds, random, occupied);
    scene.add(visual.group);
    genericPhysicalVisuals.push(visual);
    return visual;
  });
  return appended;
}`;
const appendReplacement = `function appendGenericPhysicalVisuals(
  specs: readonly DraftrollPhysicalVisual[],
): PhysicalDieVisualInstance[] {
  if (specs.length === 0) return [];
  const appended = specs.map((spec) => {
    const visual = new PhysicalDieVisualInstance(spec);
    visual.prepare();
    scene.add(visual.group);
    genericPhysicalVisuals.push(visual);
    return visual;
  });
  return appended;
}`;
const appendCount = main.split(appendNeedle).length - 1;
if (appendCount !== 1) {
  throw new Error(`additive generic setup expected once, found ${appendCount}`);
}
main = main.replace(appendNeedle, appendReplacement);

const appendCallNeedle = `  const appendedAdditional = appendGenericPhysicalVisuals(
    normalized.genericPhysical,
    String(normalized.seed ?? \`table-add:${'${Date.now()}'}\`),
  );`;
const appendCallReplacement = `  const appendedAdditional = appendGenericPhysicalVisuals(normalized.genericPhysical);`;
const appendCallCount = main.split(appendCallNeedle).length - 1;
if (appendCallCount !== 1) {
  throw new Error(`additive generic call expected once, found ${appendCallCount}`);
}
main = main.replace(appendCallNeedle, appendCallReplacement);

for (const legacy of ['buildRollPlanSync', 'cloneDynamicBody', 'contactSimilarity']) {
  if (main.includes(legacy)) throw new Error(`legacy planner symbol survived: ${legacy}`);
}
if (main.includes('visual.configureTrajectory') && main.includes('PhysicalDieVisualInstance')) {
  const physicalConfigure = /new PhysicalDieVisualInstance\([\s\S]{0,240}?configureTrajectory/.test(main);
  if (physicalConfigure) throw new Error('fallback-shaped physical configureTrajectory call survived');
}
if (!main.includes('function enforceBodiesBounds(')) {
  throw new Error('live-world bounds guard was removed with the planner');
}
if (!main.includes("Roll worker failed; using shared main-thread planner.")) {
  throw new Error('shared planner recovery path was not installed');
}

await writeFile(path, main);
console.log('shared main-thread recovery and additive physical setup installed');
