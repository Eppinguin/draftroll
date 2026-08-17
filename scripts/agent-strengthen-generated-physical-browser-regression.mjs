import { readFile, writeFile } from 'node:fs/promises';

async function read(path) {
  return readFile(path, 'utf8');
}

async function write(path, source) {
  await writeFile(path, source);
}

function replaceOnce(source, search, replacement, label) {
  const count = source.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return source.replace(search, replacement);
}

function replaceBetween(source, start, end, replacement, label) {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) throw new Error(`${label}: start marker not found`);
  const secondStart = source.indexOf(start, startIndex + start.length);
  if (secondStart >= 0) throw new Error(`${label}: start marker is not unique`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (endIndex < 0) throw new Error(`${label}: end marker not found`);
  return source.slice(0, startIndex) + replacement + source.slice(endIndex);
}

// Generated/custom visuals carry their orientation on the inner visual root. Expose that pose to
// the test-only snapshot so replay equivalence can compare geometry-agnostic world rotations.
{
  const path = 'src/physical-die-visuals.ts';
  let source = await read(path);
  source = replaceOnce(
    source,
    `  getWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {\n    return this.group.getWorldPosition(target);\n  }\n\n  getSettledPosition(target = new THREE.Vector2()): THREE.Vector2 {`,
    `  getWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {\n    return this.group.getWorldPosition(target);\n  }\n\n  getWorldQuaternion(target = new THREE.Quaternion()): THREE.Quaternion {\n    return this.inner.getWorldQuaternion(target);\n  }\n\n  getSettledPosition(target = new THREE.Vector2()): THREE.Vector2 {`,
    'physical visual world quaternion',
  );
  await write(path, source);
}

// Strengthen the browser-only diagnostics without changing the public renderer bridge contract.
{
  const path = 'src/main.ts';
  let source = await read(path);
  source = replaceOnce(
    source,
    `export interface DicePerformanceSnapshot {\n  profile: DicePerformanceProfile;\n  pixelRatio: number;`,
    `export interface DicePerformanceSnapshot {\n  profile: DicePerformanceProfile;\n  physicsPreset: DicePhysicsPreset;\n  pixelRatio: number;`,
    'performance snapshot physics preset',
  );
  source = replaceOnce(
    source,
    `        requestedOutcomeIndex: number;\n        landedOutcomeIndex: number | null;\n        result: number | string;\n        visible: boolean;\n        position: { x: number; y: number; z: number };`,
    `        requestedOutcomeIndex: number;\n        displayedOutcomeIndex: number;\n        landedOutcomeIndex: number | null;\n        result: number | string;\n        visible: boolean;\n        position: { x: number; y: number; z: number };\n        quaternion: { x: number; y: number; z: number; w: number };`,
    'physical snapshot displayed outcome and quaternion type',
  );
  source = replaceOnce(
    source,
    `      const visual = entry?.visual;\n      const definitionTargeting =\n        spec.definition?.targeting ?? (spec.canonicalKind ? 'symmetry' : 'relabel');\n      return {`,
    `      const visual = entry?.visual;\n      const quaternion =\n        entry?.die?.group.getWorldQuaternion(new THREE.Quaternion()) ??\n        visual?.getWorldQuaternion(new THREE.Quaternion()) ??\n        new THREE.Quaternion();\n      const definitionTargeting =\n        spec.definition?.targeting ?? (spec.canonicalKind ? 'symmetry' : 'relabel');\n      return {`,
    'physical snapshot world quaternion',
  );
  source = replaceOnce(
    source,
    `        requestedOutcomeIndex: spec.outcomeIndex,\n        landedOutcomeIndex:\n          visual?.landedOutcomeIndex ?? activePlan?.landings[physicalIndex] ?? null,\n        result: spec.result,\n        visible: entry?.die?.group.visible ?? entry?.visual?.group.visible ?? false,\n        position: { x: position.x, y: position.y, z: position.z },`,
    `        requestedOutcomeIndex: spec.outcomeIndex,\n        displayedOutcomeIndex: visual?.displayedOutcomeIndex ?? spec.outcomeIndex,\n        landedOutcomeIndex:\n          visual?.landedOutcomeIndex ?? activePlan?.landings[physicalIndex] ?? null,\n        result: spec.result,\n        visible: entry?.die?.group.visible ?? entry?.visual?.group.visible ?? false,\n        position: { x: position.x, y: position.y, z: position.z },\n        quaternion: {\n          x: quaternion.x,\n          y: quaternion.y,\n          z: quaternion.z,\n          w: quaternion.w,\n        },`,
    'physical snapshot displayed outcome and quaternion value',
  );
  source = replaceOnce(
    source,
    `  getPerformanceSnapshot: () => ({\n    profile: performanceProfile,\n    pixelRatio: currentPixelRatio,`,
    `  getPerformanceSnapshot: () => ({\n    profile: performanceProfile,\n    physicsPreset: activePhysicsPreset,\n    pixelRatio: currentPixelRatio,`,
    'performance snapshot active physics preset',
  );
  await write(path, source);
}

// Give Playwright narrow fixture helpers for additive table presentation and planner presets.
{
  const path = 'tests/browser/fixtures/host.ts';
  let source = await read(path);
  source = replaceOnce(
    source,
    `interface BrowserFixtureApi {`,
    `type BrowserPhysicsPreset = 'standard' | 'compact' | 'heavy' | 'low-gravity';\n\ninterface BrowserFixtureApi {`,
    'fixture physics preset type',
  );
  source = replaceOnce(
    source,
    `  rollLocal(expression?: string): Promise<{ total: number; dice: number }>;\n  rollLocalWithPhysicalModel(expression?: string): Promise<{ total: number; dice: number }>;`,
    `  rollLocal(expression?: string): Promise<{ total: number; dice: number }>;\n  rollLocalAdditive(expression?: string): Promise<{ total: number; dice: number }>;\n  rollLocalWithPhysicsPreset(\n    expression?: string,\n    physicsPreset?: BrowserPhysicsPreset,\n  ): Promise<{ total: number; dice: number }>;\n  rollLocalWithPhysicalModel(expression?: string): Promise<{ total: number; dice: number }>;`,
    'fixture api generated physical helpers',
  );
  source = replaceOnce(
    source,
    `  rollLocal,\n  rollLocalWithPhysicalModel,\n  connectRoom,`,
    `  rollLocal,\n  rollLocalAdditive,\n  rollLocalWithPhysicsPreset,\n  rollLocalWithPhysicalModel,\n  connectRoom,`,
    'fixture generated physical helper bindings',
  );
  source = replaceOnce(
    source,
    `async function rollLocalWithPhysicalModel(\n  expression = '1d6',\n): Promise<{ total: number; dice: number }> {`,
    `async function rollLocalAdditive(\n  expression = '1d9',\n): Promise<{ total: number; dice: number }> {\n  await ready;\n  const roll = draftroll.roll(expression, {\n    render: rendererEnabled,\n    renderer: { animationDurationMs: 720, preservePreviousDice: true },\n  });\n  await roll.wait();\n  state.localPresentationCount += 1;\n  state.lastTotal = roll.total;\n  setStatus('Additive local roll complete');\n  renderState();\n  return { total: roll.total, dice: roll.dice.length };\n}\n\nasync function rollLocalWithPhysicsPreset(\n  expression = '1d9',\n  physicsPreset: BrowserPhysicsPreset = 'heavy',\n): Promise<{ total: number; dice: number }> {\n  await ready;\n  const roll = draftroll.roll(expression, {\n    render: rendererEnabled,\n    renderer: { animationDurationMs: 720, physicsPreset },\n  });\n  await roll.wait();\n  state.localPresentationCount += 1;\n  state.lastTotal = roll.total;\n  setStatus(\`Local \${physicsPreset} roll complete\`);\n  renderState();\n  return { total: roll.total, dice: roll.dice.length };\n}\n\nasync function rollLocalWithPhysicalModel(\n  expression = '1d6',\n): Promise<{ total: number; dice: number }> {`,
    'fixture generated physical helper implementations',
  );
  await write(path, source);
}

// Replace the basic generated-die smoke test with behavioral coverage for authoritative labels,
// replay/resize, additive preservation, planner presets, and settled dragging.
{
  const path = 'tests/browser/specs/overlay.spec.ts';
  let source = await read(path);
  const start = `test('overlay accepts generated non-standard physical dice', async ({ page }) => {`;
  const end = `test('overlay renders a host-supplied custom physical model through the shared planner', async ({`;
  const replacement = `test('overlay exposes authoritative outcomes for generated non-standard physical dice', async ({\n  page,\n}) => {\n  await page.goto('/host.html');\n  await waitForFixture(page);\n  const iframe = page.locator('iframe[title="Draftroll dice overlay"]');\n  const frame = page.frameLocator('iframe[title="Draftroll dice overlay"]');\n\n  const generatedRoll = page.evaluate(() => window.__draftrollTest.rollLocal('1d3+1d5+1d9'));\n  await expect(iframe).toHaveCSS('visibility', 'visible');\n\n  const generatedCanvas = frame.locator('#scene');\n  await page.waitForTimeout(120);\n  const firstRollingFrame = await generatedCanvas.screenshot();\n  await page.waitForTimeout(180);\n  const secondRollingFrame = await generatedCanvas.screenshot();\n  expect(firstRollingFrame.equals(secondRollingFrame)).toBe(false);\n\n  const generatedOnly = await generatedRoll;\n  expect(generatedOnly.dice).toBe(3);\n  expect(Number.isFinite(generatedOnly.total)).toBe(true);\n  const generatedSnapshot = await frame\n    .locator('body')\n    .evaluate(() => window.draftrollDice.getPhysicalSnapshot());\n  expect(generatedSnapshot).toHaveLength(3);\n  expect(generatedSnapshot.every((entry) => entry.implementation === 'generated')).toBe(true);\n  expect(generatedSnapshot.every((entry) => entry.targeting === 'relabel')).toBe(true);\n  expect(generatedSnapshot.every((entry) => entry.visible)).toBe(true);\n  expect(\n    generatedSnapshot.every(\n      (entry) =>\n        Number.isInteger(entry.landedOutcomeIndex) &&\n        entry.requestedOutcomeIndex >= 0 &&\n        entry.requestedOutcomeIndex < entry.sides,\n    ),\n  ).toBe(true);\n  expect(\n    generatedSnapshot.every(\n      (entry) =>\n        entry.displayedOutcomeIndex === entry.requestedOutcomeIndex &&\n        entry.result === entry.displayedOutcomeIndex + 1,\n    ),\n  ).toBe(true);\n\n  await page.getByTestId('underlay-action').click();\n  await expect(iframe).toHaveCSS('visibility', 'hidden');\n\n  const mixed = await page.evaluate(() => window.__draftrollTest.rollLocal('1d6+1d9+1d11'));\n  expect(mixed.dice).toBe(3);\n  expect(Number.isFinite(mixed.total)).toBe(true);\n  await expect(iframe).toHaveCSS('visibility', 'visible');\n  const mixedSnapshot = await frame\n    .locator('body')\n    .evaluate(() => window.draftrollDice.getPhysicalSnapshot());\n  expect(mixedSnapshot.map((entry) => entry.implementation)).toEqual([\n    'canonical',\n    'generated',\n    'generated',\n  ]);\n  expect(mixedSnapshot.map((entry) => entry.targeting)).toEqual(['symmetry', 'relabel', 'relabel']);\n  expect(\n    mixedSnapshot.every((entry) => entry.displayedOutcomeIndex === entry.requestedOutcomeIndex),\n  ).toBe(true);\n\n  await page.setViewportSize({ width: 980, height: 700 });\n  await frame.locator('body').evaluate(async () => {\n    const replay = window.draftrollDice.getLastReplay();\n    if (!replay) throw new Error('Missing generated physical replay');\n    await window.draftrollDice.playReplay(replay, { settleImmediately: true });\n  });\n  const replayedSnapshot = await frame\n    .locator('body')\n    .evaluate(() => window.draftrollDice.getPhysicalSnapshot());\n  expect(\n    replayedSnapshot.map((entry) => ({\n      implementation: entry.implementation,\n      targeting: entry.targeting,\n      requestedOutcomeIndex: entry.requestedOutcomeIndex,\n      displayedOutcomeIndex: entry.displayedOutcomeIndex,\n      landedOutcomeIndex: entry.landedOutcomeIndex,\n      result: entry.result,\n    })),\n  ).toEqual(\n    mixedSnapshot.map((entry) => ({\n      implementation: entry.implementation,\n      targeting: entry.targeting,\n      requestedOutcomeIndex: entry.requestedOutcomeIndex,\n      displayedOutcomeIndex: entry.displayedOutcomeIndex,\n      landedOutcomeIndex: entry.landedOutcomeIndex,\n      result: entry.result,\n    })),\n  );\n  for (let index = 0; index < mixedSnapshot.length; index += 1) {\n    const before = mixedSnapshot[index];\n    const after = replayedSnapshot[index];\n    const quaternionDot =\n      before.quaternion.x * after.quaternion.x +\n      before.quaternion.y * after.quaternion.y +\n      before.quaternion.z * after.quaternion.z +\n      before.quaternion.w * after.quaternion.w;\n    expect(Math.abs(quaternionDot)).toBeGreaterThan(0.999);\n    expect(after.position.y).toBeCloseTo(before.position.y, 3);\n  }\n});\n\ntest('additive generated physical roll preserves settled canonical dice', async ({ page }) => {\n  await page.goto('/host.html');\n  await waitForFixture(page);\n  const frame = page.frameLocator('iframe[title="Draftroll dice overlay"]');\n\n  await page.evaluate(() => window.__draftrollTest.rollLocal('1d6'));\n  const before = await frame\n    .locator('body')\n    .evaluate(() => window.draftrollDice.getPhysicalSnapshot());\n  expect(before).toHaveLength(1);\n  expect(before[0].implementation).toBe('canonical');\n\n  await page.evaluate(() => window.__draftrollTest.rollLocalAdditive('1d9'));\n  const after = await frame\n    .locator('body')\n    .evaluate(() => window.draftrollDice.getPhysicalSnapshot());\n  expect(after).toHaveLength(2);\n  const preserved = after.find((entry) => entry.id === before[0].id);\n  expect(preserved).toMatchObject({\n    implementation: 'canonical',\n    requestedOutcomeIndex: before[0].requestedOutcomeIndex,\n    displayedOutcomeIndex: before[0].displayedOutcomeIndex,\n    result: before[0].result,\n    visible: true,\n  });\n  const generated = after.find((entry) => entry.id !== before[0].id);\n  expect(generated).toMatchObject({ implementation: 'generated', targeting: 'relabel', visible: true });\n  expect(generated?.displayedOutcomeIndex).toBe(generated?.requestedOutcomeIndex);\n});\n\ntest('generated physical dice receive heavy and low-gravity planner presets', async ({ page }) => {\n  await page.goto('/host.html');\n  await waitForFixture(page);\n  const frame = page.frameLocator('iframe[title="Draftroll dice overlay"]');\n\n  await page.evaluate(() => window.__draftrollTest.rollLocalWithPhysicsPreset('1d9', 'heavy'));\n  let snapshot = await frame.locator('body').evaluate(() => ({\n    performance: window.draftrollDice.getPerformanceSnapshot(),\n    replayPreset: window.draftrollDice.getLastReplay()?.physicsPreset ?? null,\n    physical: window.draftrollDice.getPhysicalSnapshot(),\n  }));\n  expect(snapshot.performance.physicsPreset).toBe('heavy');\n  expect(snapshot.replayPreset).toBe('heavy');\n  expect(snapshot.physical).toHaveLength(1);\n  expect(snapshot.physical[0].implementation).toBe('generated');\n\n  await page.evaluate(() =>\n    window.__draftrollTest.rollLocalWithPhysicsPreset('1d11', 'low-gravity'),\n  );\n  snapshot = await frame.locator('body').evaluate(() => ({\n    performance: window.draftrollDice.getPerformanceSnapshot(),\n    replayPreset: window.draftrollDice.getLastReplay()?.physicsPreset ?? null,\n    physical: window.draftrollDice.getPhysicalSnapshot(),\n  }));\n  expect(snapshot.performance.physicsPreset).toBe('low-gravity');\n  expect(snapshot.replayPreset).toBe('low-gravity');\n  expect(snapshot.physical).toHaveLength(1);\n  expect(snapshot.physical[0].implementation).toBe('generated');\n});\n\ntest('generated physical dice remain draggable after settlement', async ({ page }) => {\n  await page.goto('/host.html');\n  await waitForFixture(page);\n  const iframe = page.locator('iframe[title="Draftroll dice overlay"]');\n  const frame = page.frameLocator('iframe[title="Draftroll dice overlay"]');\n\n  await page.evaluate(() => window.__draftrollTest.rollLocal('1d9'));\n  await frame\n    .locator('body')\n    .evaluate(() => window.draftrollDice.configureInteractions({ draggable: true }));\n  await iframe.evaluate((element) => {\n    (element as HTMLElement).style.pointerEvents = 'auto';\n  });\n\n  const before = (\n    await frame.locator('body').evaluate(() => window.draftrollDice.getPhysicalSnapshot())\n  )[0];\n  const canvas = frame.locator('#scene');\n  const box = await canvas.boundingBox();\n  expect(box).not.toBeNull();\n  const viewportScale = box!.height / 10;\n  const startX = box!.x + box!.width / 2 + before.position.x * viewportScale;\n  const startY = box!.y + box!.height / 2 + before.position.z * viewportScale;\n  const targetX = startX + (before.position.x >= 0 ? -80 : 80);\n  const targetY = startY + (before.position.z >= 0 ? -50 : 50);\n\n  await page.mouse.move(startX, startY);\n  await page.mouse.down();\n  await page.mouse.move(targetX, targetY, { steps: 6 });\n  await page.mouse.up();\n\n  const after = (\n    await frame.locator('body').evaluate(() => window.draftrollDice.getPhysicalSnapshot())\n  )[0];\n  expect(Math.hypot(after.position.x - before.position.x, after.position.z - before.position.z)).toBeGreaterThan(\n    0.25,\n  );\n});\n\n`;
  source = replaceBetween(source, start, end, replacement, 'generated physical browser coverage');
  await write(path, source);
}

// Make the fast static guard require the behavioral generated-physical coverage as well.
{
  const path = 'scripts/test-browser-automation.mjs';
  let source = await read(path);
  source = replaceOnce(
    source,
    `  'host-supplied custom physical model through the shared planner',\n]) {`,
    `  'host-supplied custom physical model through the shared planner',\n  'authoritative outcomes for generated non-standard physical dice',\n  'additive generated physical roll preserves settled canonical dice',\n  'generated physical dice receive heavy and low-gravity planner presets',\n  'generated physical dice remain draggable after settlement',\n]) {`,
    'browser automation generated physical markers',
  );
  source = replaceOnce(
    source,
    `        'host-supplied custom physical model',\n      ],`,
    `        'host-supplied custom physical model',\n        'generated authoritative physical outcomes',\n        'generated physical replay after resize',\n        'generated additive table preservation',\n        'generated physical planner presets',\n        'generated settled dragging',\n      ],`,
    'browser automation generated physical coverage output',
  );
  await write(path, source);
}
