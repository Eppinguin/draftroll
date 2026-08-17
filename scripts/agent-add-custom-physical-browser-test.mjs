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

{
  const path = 'tests/browser/fixtures/host.ts';
  let source = await read(path);
  source = replaceOnce(
    source,
    `  type DraftrollRoomSession,\n  type RollVisibility,`,
    `  type DraftrollRoomSession,\n  type PhysicalDieModel,\n  type RollVisibility,`,
    'fixture physical model import',
  );
  source = replaceOnce(
    source,
    `  rollLocal(expression?: string): Promise<{ total: number; dice: number }>;\n  connectRoom(options?: {`,
    `  rollLocal(expression?: string): Promise<{ total: number; dice: number }>;\n  rollLocalWithPhysicalModel(expression?: string): Promise<{ total: number; dice: number }>;\n  connectRoom(options?: {`,
    'fixture api physical model method',
  );
  source = replaceOnce(
    source,
    `  rollLocal,\n  connectRoom,`,
    `  rollLocal,\n  rollLocalWithPhysicalModel,\n  connectRoom,`,
    'fixture api physical model binding',
  );
  source = replaceOnce(
    source,
    `const ready = initialize();`,
    `const browserCustomD6Model: PhysicalDieModel = {\n  definition: {\n    id: 'browser-custom-symbol-d6-v1',\n    sides: 6,\n    geometrySource: 'theme',\n    targeting: 'relabel',\n    radius: 0.96,\n    collisionScale: 1.02,\n    collider: { kind: 'box', halfExtents: [0.55, 0.55, 0.55] },\n    outcomes: [\n      {\n        index: 0,\n        value: 1,\n        result: 1,\n        numericValue: 1,\n        supportNormals: [[-1, 0, 0]],\n        labelAnchors: [\n          {\n            kind: 'face',\n            faceIndex: 0,\n            position: [0.561, 0, 0],\n            normal: [1, 0, 0],\n            up: [0, 1, 0],\n            scale: 0.34,\n          },\n        ],\n      },\n      {\n        index: 1,\n        value: 2,\n        result: 2,\n        numericValue: 2,\n        supportNormals: [[1, 0, 0]],\n        labelAnchors: [\n          {\n            kind: 'face',\n            faceIndex: 1,\n            position: [-0.561, 0, 0],\n            normal: [-1, 0, 0],\n            up: [0, 1, 0],\n            scale: 0.34,\n          },\n        ],\n      },\n      {\n        index: 2,\n        value: 3,\n        result: 3,\n        numericValue: 3,\n        supportNormals: [[0, -1, 0]],\n        labelAnchors: [\n          {\n            kind: 'face',\n            faceIndex: 2,\n            position: [0, 0.561, 0],\n            normal: [0, 1, 0],\n            up: [0, 0, -1],\n            scale: 0.34,\n          },\n        ],\n      },\n      {\n        index: 3,\n        value: 4,\n        result: 4,\n        numericValue: 4,\n        supportNormals: [[0, 1, 0]],\n        labelAnchors: [\n          {\n            kind: 'face',\n            faceIndex: 3,\n            position: [0, -0.561, 0],\n            normal: [0, -1, 0],\n            up: [0, 0, 1],\n            scale: 0.34,\n          },\n        ],\n      },\n      {\n        index: 4,\n        value: 5,\n        result: 5,\n        numericValue: 5,\n        supportNormals: [[0, 0, -1]],\n        labelAnchors: [\n          {\n            kind: 'face',\n            faceIndex: 4,\n            position: [0, 0, 0.561],\n            normal: [0, 0, 1],\n            up: [0, 1, 0],\n            scale: 0.34,\n          },\n        ],\n      },\n      {\n        index: 5,\n        value: 6,\n        result: 6,\n        numericValue: 6,\n        supportNormals: [[0, 0, 1]],\n        labelAnchors: [\n          {\n            kind: 'face',\n            faceIndex: 5,\n            position: [0, 0, -0.561],\n            normal: [0, 0, -1],\n            up: [0, 1, 0],\n            scale: 0.34,\n          },\n        ],\n      },\n    ],\n  },\n  presentation: {\n    contents: [\n      { kind: 'icon', icon: '◆', label: 'one' },\n      { kind: 'icon', icon: '●', label: 'two' },\n      { kind: 'icon', icon: '▲', label: 'three' },\n      { kind: 'icon', icon: '■', label: 'four' },\n      { kind: 'icon', icon: '★', label: 'five' },\n      { kind: 'icon', icon: '✦', label: 'six' },\n    ],\n  },\n};\n\nconst ready = initialize();`,
    'fixture custom physical model',
  );
  source = replaceOnce(
    source,
    `  return { total: roll.total, dice: roll.dice.length };\n}\n\nasync function connectRoom(`,
    `  return { total: roll.total, dice: roll.dice.length };\n}\n\nasync function rollLocalWithPhysicalModel(\n  expression = '1d6',\n): Promise<{ total: number; dice: number }> {\n  await ready;\n  const roll = draftroll.roll(expression, {\n    render: rendererEnabled,\n    renderer: {\n      animationDurationMs: 720,\n      physicalModels: { d6: browserCustomD6Model },\n    },\n  });\n  await roll.wait();\n  state.localPresentationCount += 1;\n  state.lastTotal = roll.total;\n  setStatus('Custom physical roll complete');\n  renderState();\n  return { total: roll.total, dice: roll.dice.length };\n}\n\nasync function connectRoom(`,
    'fixture custom physical roll function',
  );
  await write(path, source);
}

{
  const path = 'tests/browser/support/fixture.ts';
  let source = await read(path);
  source = replaceOnce(
    source,
    `      rollLocal(expression?: string): Promise<{ total: number; dice: number }>;\n      connectRoom(options?: {`,
    `      rollLocal(expression?: string): Promise<{ total: number; dice: number }>;\n      rollLocalWithPhysicalModel(expression?: string): Promise<{ total: number; dice: number }>;\n      connectRoom(options?: {`,
    'support fixture custom physical method',
  );
  await write(path, source);
}

{
  const path = 'tests/browser/specs/overlay.spec.ts';
  let source = await read(path);
  const testBlock = `test('overlay renders a host-supplied custom physical model through the shared planner', async ({\n  page,\n}) => {\n  await page.goto('/host.html');\n  await waitForFixture(page);\n  const iframe = page.locator('iframe[title="Draftroll dice overlay"]');\n\n  const firstRoll = page.evaluate(() => window.__draftrollTest.rollLocalWithPhysicalModel('1d6'));\n  await expect(iframe).toHaveCSS('visibility', 'visible');\n  const first = await firstRoll;\n  expect(first.dice).toBe(1);\n  expect(Number.isInteger(first.total)).toBe(true);\n  expect(first.total).toBeGreaterThanOrEqual(1);\n  expect(first.total).toBeLessThanOrEqual(6);\n\n  const frame = page.frameLocator('iframe[title="Draftroll dice overlay"]');\n  const firstSnapshot = await frame\n    .locator('body')\n    .evaluate(() => window.draftrollDice.getPhysicalSnapshot());\n  expect(firstSnapshot).toHaveLength(1);\n  expect(firstSnapshot[0]).toMatchObject({\n    implementation: 'custom',\n    targeting: 'relabel',\n    sides: 6,\n    result: first.total,\n    requestedOutcomeIndex: first.total - 1,\n    visible: true,\n  });\n  expect(Number.isInteger(firstSnapshot[0].landedOutcomeIndex)).toBe(true);\n  expect(firstSnapshot[0].landedOutcomeIndex).toBeGreaterThanOrEqual(0);\n  expect(firstSnapshot[0].landedOutcomeIndex).toBeLessThan(6);\n\n  // A second roll reuses the same persistent worker and definition key. If the main thread or\n  // worker registry loses the custom definition between plans, this call fails before playback.\n  const second = await page.evaluate(() =>\n    window.__draftrollTest.rollLocalWithPhysicalModel('1d6'),\n  );\n  expect(second.dice).toBe(1);\n  const secondSnapshot = await frame\n    .locator('body')\n    .evaluate(() => window.draftrollDice.getPhysicalSnapshot());\n  expect(secondSnapshot).toHaveLength(1);\n  expect(secondSnapshot[0]).toMatchObject({\n    implementation: 'custom',\n    targeting: 'relabel',\n    sides: 6,\n    result: second.total,\n    requestedOutcomeIndex: second.total - 1,\n    visible: true,\n  });\n  expect(Number.isInteger(secondSnapshot[0].landedOutcomeIndex)).toBe(true);\n});\n\n`;
  source = replaceOnce(
    source,
    `test('overlay lifecycle survives repeated rolls and explicit host interaction on a responsive viewport', async ({`,
    `${testBlock}test('overlay lifecycle survives repeated rolls and explicit host interaction on a responsive viewport', async ({`,
    'custom physical browser test',
  );
  await write(path, source);
}

console.log('custom physical browser regression applied');
