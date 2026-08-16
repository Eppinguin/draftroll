import { readFile, writeFile } from 'node:fs/promises';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing migration target: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Ambiguous migration target: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

async function patch(path, transform) {
  const source = await readFile(path, 'utf8');
  const updated = transform(source);
  if (updated === source) throw new Error(`Migration made no changes to ${path}`);
  await writeFile(path, updated);
}

await patch('src/main.ts', (input) => {
  let source = input;

  source = replaceOnce(
    source,
    `    activeGenericPhysicalIndexes,\n    completed.landings,\n  );`,
    `    activeGenericPhysicalIndexes,\n    completed.landings,\n    completed.activationDelays,\n  );`,
    'planner commit activation delays',
  );

  source = replaceOnce(
    source,
    `    activeGenericPhysicalIndexes,\n    plan.landings,\n  );`,
    `    activeGenericPhysicalIndexes,\n    plan.landings,\n    plan.activationDelays,\n  );`,
    'replay commit activation delays',
  );

  source = replaceOnce(
    source,
    `function beginPlanPlayback(\n`,
    `function updatePlanVisuals(plan: RollPlan, time: number): void {\n  applyPlanTransform(plan, time);\n  const progress = plan.duration > 0 ? time / plan.duration : 1;\n  genericPhysicalVisuals.forEach((visual) => visual.update(progress, plan.duration));\n  fallbackVisuals.forEach((visual) => visual.update(progress, plan.duration));\n}\n\nfunction beginPlanPlayback(\n`,
    'shared playback updater',
  );

  source = replaceOnce(
    source,
    `  applyPlanTransform(plan, planTime);\n  const fallbackProgress = plan.duration > 0 ? planTime / plan.duration : 1;\n  genericPhysicalVisuals.forEach((visual) => visual.update(fallbackProgress, plan.duration));\n  fallbackVisuals.forEach((visual) => visual.update(fallbackProgress, plan.duration));`,
    `  updatePlanVisuals(plan, planTime);`,
    'initial committed playback frame',
  );

  source = replaceOnce(
    source,
    `    applyPlanTransform(activePlan, planTime);\n    const fallbackProgress = activePlan.duration > 0 ? planTime / activePlan.duration : 1;\n    const fallbackPlanDuration = activePlan.duration;\n    fallbackVisuals.forEach((visual) => visual.update(fallbackProgress, fallbackPlanDuration));`,
    `    updatePlanVisuals(activePlan, planTime);`,
    'animation-loop playback frame',
  );

  source = replaceOnce(
    source,
    `      applyPlanTransform(activePlan, planTime);\n      fallbackVisuals.forEach((visual) => visual.settle());`,
    `      updatePlanVisuals(activePlan, planTime);\n      genericPhysicalVisuals.forEach((visual) => visual.settle());\n      fallbackVisuals.forEach((visual) => visual.settle());`,
    'hidden-document final frame',
  );

  return source;
});

await patch('src/physical-die-visuals.ts', (input) => {
  let source = input;

  source = replaceOnce(
    source,
    `  private lastProgress = 0;\n  private presented = false;`,
    `  private lastProgress = 0;\n  private activationDelay = 0;\n  private presented = false;`,
    'activation delay state',
  );

  source = replaceOnce(
    source,
    `    this.launchState = serializeLaunchState(state);\n    this.end.set(state.target[0], state.target[1]);`,
    `    this.launchState = serializeLaunchState(state);\n    this.activationDelay = Math.max(0, state.delay);\n    this.end.set(state.target[0], state.target[1]);`,
    'launch activation delay',
  );

  source = replaceOnce(
    source,
    `  commitTrajectory(trajectory: RecordedTrajectory, landed: number): void {\n    const newlyIntroduced = this.needsPlanning;\n    if (newlyIntroduced) this.applyRequestedResult(landed);\n    this.trajectory = trajectory;`,
    `  commitTrajectory(\n    trajectory: RecordedTrajectory,\n    landed: number,\n    activationDelay = 0,\n  ): void {\n    const newlyIntroduced = this.needsPlanning;\n    if (newlyIntroduced) this.applyRequestedResult(landed);\n    this.trajectory = trajectory;\n    this.activationDelay = Math.max(0, activationDelay);`,
    'trajectory activation delay',
  );

  source = replaceOnce(
    source,
    `    this.lastProgress = 0;\n    this.settled = false;\n    this.presented = false;\n    this.group.visible = false;`,
    `    this.lastProgress = 0;\n    this.activationDelay = 0;\n    this.settled = false;\n    this.presented = false;\n    this.group.visible = false;`,
    'configure activation reset',
  );

  source = replaceOnce(
    source,
    `  update(progress: number, _duration = 1): void {\n    if (this.settled || !this.trajectory) return;\n    const normalized = THREE.MathUtils.clamp(progress, 0, 1);\n    this.lastProgress = normalized;\n    const wasPresented = this.presented;\n    if (normalized > 0) this.presented = true;\n    this.group.visible = this.presented;\n    if (!this.presented) return;\n    sample(this.trajectory, normalized, this.group.position, this.inner.quaternion);\n    const opacity = wasPresented ? 1 : THREE.MathUtils.clamp(normalized * 7, 0, 1);\n    this.mesh.setOpacity(opacity);\n    this.mesh.updateShadow(this.group.position.y, opacity);\n  }`,
    `  update(progress: number, duration = 1): void {\n    if (this.settled || !this.trajectory) return;\n    const normalized = THREE.MathUtils.clamp(progress, 0, 1);\n    this.lastProgress = normalized;\n    const elapsed = normalized * Math.max(0, duration);\n    if (elapsed + this.trajectory.step * 0.5 >= this.activationDelay) this.presented = true;\n    this.group.visible = this.presented;\n    if (!this.presented) {\n      this.mesh.setOpacity(0);\n      this.mesh.updateShadow(this.group.position.y, 0);\n      return;\n    }\n    sample(this.trajectory, normalized, this.group.position, this.inner.quaternion);\n    this.mesh.setOpacity(1);\n    this.mesh.updateShadow(this.group.position.y, 1);\n  }`,
    'physical visual playback update',
  );

  source = replaceOnce(
    source,
    `  physicalIndexes: readonly number[],\n  landings: Int32Array,\n): void {`,
    `  physicalIndexes: readonly number[],\n  landings: Int32Array,\n  activationDelays?: Float32Array,\n): void {`,
    'physical plan commit signature',
  );

  source = replaceOnce(
    source,
    `    transforms.length !== frameCount * physicalCount * 7 ||\n    landings.length !== physicalCount\n  ) {`,
    `    transforms.length !== frameCount * physicalCount * 7 ||\n    landings.length !== physicalCount ||\n    (activationDelays !== undefined && activationDelays.length !== physicalCount)\n  ) {`,
    'physical plan buffer validation',
  );

  source = replaceOnce(
    source,
    `      trajectoryForIndex(transforms, frameCount, step, physicalCount, physicalIndex),\n      landings[physicalIndex] ?? 0,\n    );`,
    `      trajectoryForIndex(transforms, frameCount, step, physicalCount, physicalIndex),\n      landings[physicalIndex] ?? 0,\n      activationDelays?.[physicalIndex] ?? 0,\n    );`,
    'physical plan activation commit',
  );

  return source;
});

await patch('scripts/test-visual-fallbacks.mjs', (input) => {
  let source = input;
  source = replaceOnce(
    source,
    `assert.match(engine, /visual\\.update\\(fallbackProgress, plan\\.duration\\)/);`,
    `assert.match(engine, /function updatePlanVisuals/);\nassert.match(\n  engine,\n  /genericPhysicalVisuals\\.forEach\\(\\(visual\\) => visual\\.update\\(progress, plan\\.duration\\)\\)/,\n);\nassert.match(engine, /updatePlanVisuals\\(activePlan, planTime\\)/);`,
    'shared physical playback smoke assertion',
  );
  source = replaceOnce(
    source,
    `assert.match(physicalVisuals, /commitPhysicalVisualPlan/);`,
    `assert.match(physicalVisuals, /commitPhysicalVisualPlan/);\nassert.match(physicalVisuals, /private activationDelay = 0/);\nassert.match(physicalVisuals, /elapsed \\+ this\\.trajectory\\.step \\* 0\\.5 >= this\\.activationDelay/);`,
    'activation-delay smoke assertions',
  );
  return source;
});

await patch('tests/browser/specs/overlay.spec.ts', (input) => {
  let source = input;
  source = replaceOnce(
    source,
    `  const generatedOnly = await page.evaluate(() => window.__draftrollTest.rollLocal('1d3+1d5'));\n  expect(generatedOnly.dice).toBe(2);\n  expect(Number.isFinite(generatedOnly.total)).toBe(true);\n  await expect(iframe).toHaveCSS('visibility', 'visible');`,
    `  const generatedRoll = page.evaluate(() => window.__draftrollTest.rollLocal('1d3+1d5'));\n  await expect(iframe).toHaveCSS('visibility', 'visible');\n\n  const generatedCanvas = page\n    .frameLocator('iframe[title="Draftroll dice overlay"]')\n    .locator('#scene');\n  await page.waitForTimeout(120);\n  const firstRollingFrame = await generatedCanvas.screenshot();\n  await page.waitForTimeout(180);\n  const secondRollingFrame = await generatedCanvas.screenshot();\n  expect(firstRollingFrame.equals(secondRollingFrame)).toBe(false);\n\n  const generatedOnly = await generatedRoll;\n  expect(generatedOnly.dice).toBe(2);\n  expect(Number.isFinite(generatedOnly.total)).toBe(true);`,
    'generated mid-roll browser assertion',
  );
  return source;
});
