import { readFile, writeFile } from 'node:fs/promises';

function replaceOnce(source, search, replacement, label) {
  const count = source.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return source.replace(search, replacement);
}

function replaceAllExact(source, search, replacement, expected, label) {
  const count = source.split(search).length - 1;
  if (count !== expected) throw new Error(`${label}: expected ${expected} matches, found ${count}`);
  return source.split(search).join(replacement);
}

{
  const path = 'packages/renderer/src/index.ts';
  let source = await readFile(path, 'utf8');
  source = replaceOnce(
    source,
    `  /** Explicit geometry/support definition for a host-supplied physical model. */\n  definition?: PhysicalDieDefinition;`,
    `  /**\n   * Explicit geometry/support definition for a host-supplied physical model.\n   * Host-supplied definitions currently use relabel targeting so authoritative outcomes remain\n   * deterministic without steering the physical trajectory.\n   */\n  definition?: PhysicalDieDefinition;`,
    'physical visual targeting documentation',
  );
  source = replaceOnce(
    source,
    `   * A model overrides generated/canonical geometry for the matching rendered die without changing\n   * the authoritative normalized result.`,
    `   * A model overrides generated/canonical geometry for the matching rendered die without changing\n   * the authoritative normalized result. Host-supplied models currently require relabel targeting;\n   * fixed artwork and custom symmetry targeting need an explicit trajectory/rotation provider first.`,
    'physical model targeting documentation',
  );
  source = replaceOnce(
    source,
    `      const physicalModel = resolvePhysicalModel(options.physicalModels, die);\n      const physicalSlot = physicalModel`,
    `      const physicalModel = resolvePhysicalModel(options.physicalModels, die);\n      if (physicalModel && physicalModel.definition.targeting !== 'relabel') {\n        throw new UnsupportedRollError(\n          \`Physical model \${physicalModel.definition.id} uses \${physicalModel.definition.targeting} targeting; host-supplied physical models currently require relabel targeting to preserve authoritative results\`,\n          result,\n        );\n      }\n      const physicalSlot = physicalModel`,
    'reject unsupported custom targeting',
  );
  source = replaceOnce(
    source,
    `? { contents: physicalModel.presentation.contents.map((content) => ({ ...content })) }`,
    `? { contents: physicalModel.presentation.contents.map((content) => Object.assign({}, content)) }`,
    'presentation copy without map spread',
  );
  await writeFile(path, source);
}

{
  const path = 'src/physical-die-visuals.ts';
  let source = await readFile(path, 'utf8');
  source = replaceOnce(
    source,
    `    if (\n      this.definition.sides !== spec.sides ||\n      this.definition.outcomes.length !== spec.sides\n    ) {\n      throw new Error(\`Physical definition does not match descriptor: \${spec.id}\`);\n    }`,
    `    if (\n      this.definition.sides !== spec.sides ||\n      this.definition.outcomes.length !== spec.sides\n    ) {\n      throw new Error(\`Physical definition does not match descriptor: \${spec.id}\`);\n    }\n    if (spec.definition && this.definition.targeting !== 'relabel') {\n      throw new Error(\n        \`Host-supplied physical die \${spec.id} requires relabel targeting; \${this.definition.targeting} targeting has no custom rotation/search provider\`,\n      );\n    }`,
    'visual custom targeting invariant',
  );
  await writeFile(path, source);
}

{
  const path = 'src/main.ts';
  let source = await readFile(path, 'utf8');
  source = replaceOnce(
    source,
    `  const activeTargeting = (Object.entries(targetingCounts) as Array<\n    ['symmetry' | 'relabel' | 'fixed', number]\n  >).filter(([, count]) => count > 0);`,
    `  const activeTargeting = (['symmetry', 'relabel', 'fixed'] as const).filter(\n    (targeting) => targetingCounts[targeting] > 0,\n  );`,
    'targeting diagnostics without unsafe assertion',
  );
  source = replaceOnce(
    source,
    `    targetingMethod: activeTargeting.length === 1 ? activeTargeting[0][0] : 'mixed',`,
    `    targetingMethod: activeTargeting.length === 1 ? activeTargeting[0] : 'mixed',`,
    'targeting strategy scalar',
  );
  source = replaceAllExact(
    source,
    `physicalTable.visualInstances().forEach`,
    `physicalTable.forEachVisual`,
    4,
    'allocation-free visual iteration',
  );
  if (source.includes('physicalTable.visualInstances()')) {
    throw new Error('main.ts still allocates visual instance arrays on the playback path');
  }
  source = replaceOnce(
    source,
    `          visual.definition.outcomes.length !== visual.sides ||\n          visual.canonicalKind !== undefined)) ||`,
    `          visual.definition.outcomes.length !== visual.sides ||\n          visual.definition.targeting !== 'relabel' ||\n          visual.canonicalKind !== undefined)) ||`,
    'direct bridge custom targeting invariant',
  );
  source = replaceOnce(
    source,
    `        physicalIndex: number;\n        implementation: 'canonical' | 'generated' | 'custom';`,
    `        physicalIndex: number;\n        sides: number;\n        implementation: 'canonical' | 'generated' | 'custom';`,
    'snapshot sides type',
  );
  source = replaceOnce(
    source,
    `        id: spec.id,\n        physicalIndex,\n        implementation: spec.definition`,
    `        id: spec.id,\n        physicalIndex,\n        sides: spec.sides,\n        implementation: spec.definition`,
    'snapshot sides value',
  );
  await writeFile(path, source);
}

{
  const path = 'scripts/test-modifier-sequencing.mjs';
  let source = await readFile(path, 'utf8');
  source = replaceOnce(
    source,
    `/dice\\.length === 0 && genericPhysicalVisuals\\.length === 0 && fallbackVisuals\\.length === 0/`,
    `/dice\\.length === 0 && physicalTable\\.visualCount === 0 && fallbackVisuals\\.length === 0/`,
    'table-empty registry regression',
  );
  await writeFile(path, source);
}

{
  const path = 'scripts/test-character-client.mjs';
  let source = await readFile(path, 'utf8');
  source = replaceOnce(
    source,
    `assert.match(worker, /definition:\\s*entry\\.definition/);`,
    `assert.match(worker, /definitionKey:\\s*string/);\nassert.match(worker, /definitions = new Map<string, PhysicalDieDefinition>/);\nassert.match(worker, /definitions\\.get\\(entry\\.definitionKey\\)/);`,
    'worker definition registry regression',
  );
  await writeFile(path, source);
}

{
  const path = 'scripts/test-visual-fallbacks.mjs';
  let source = await readFile(path, 'utf8');
  source = replaceOnce(
    source,
    `/physicalTable\\.visualInstances\\(\\)\\.forEach\\(\\(visual\\) => visual\\.update\\(time, scale\\.x, scale\\.z\\)\\)/,`,
    `/physicalTable\\.forEachVisual\\(\\(visual\\) => visual\\.update\\(time, scale\\.x, scale\\.z\\)\\)/,`,
    'smoke allocation-free visual update',
  );
  source = replaceOnce(
    source,
    `assert.match(physicalTable, /class PhysicalTableRegistry/);`,
    `assert.match(physicalTable, /class PhysicalTableRegistry/);\nassert.match(physicalTable, /forEachVisual/);\nassert.doesNotMatch(engine, /physicalTable\\.visualInstances/);\nassert.match(renderer, /currently require relabel targeting/);\nassert.match(engine, /visual\\.definition\\.targeting !== 'relabel'/);`,
    'smoke final physical invariants',
  );
  await writeFile(path, source);
}

{
  const path = 'scripts/test-mixed-renderer.mjs';
  let source = await readFile(path, 'utf8');
  source = replaceOnce(
    source,
    `  const browserHost = await readFile(join(projectRoot, 'src/main.ts'), 'utf8');`,
    `  const customModelResult = {\n    authority: 'local',\n    name: 'Custom physical model',\n    expression: '1d3',\n    total: 2,\n    dice: [{ id: 'custom-d3', type: 'd3', sides: 3, result: 2, kept: true, themeId: 'dragon' }],\n    operations: [],\n    createdAt: new Date(0).toISOString(),\n  };\n  const customModel = {\n    definition: {\n      id: 'host:triad:v1',\n      sides: 3,\n      geometrySource: 'theme',\n      targeting: 'relabel',\n      radius: 0.72,\n      collisionScale: 1.02,\n      collider: { kind: 'box', halfExtents: [0.55, 0.55, 0.55] },\n      outcomes: [\n        { index: 0, value: 1, result: 1, numericValue: 1, supportNormals: [[0, 1, 0]], labelAnchors: [] },\n        { index: 1, value: 2, result: 2, numericValue: 2, supportNormals: [[1, 0, 0]], labelAnchors: [] },\n        { index: 2, value: 3, result: 3, numericValue: 3, supportNormals: [[0, 0, 1]], labelAnchors: [] },\n      ],\n    },\n    presentation: {\n      contents: [\n        { kind: 'text', text: 'ONE' },\n        { kind: 'icon', icon: '◆' },\n        { kind: 'text', text: 'THREE' },\n      ],\n    },\n  };\n  const customCompletion = await renderer.playRoll(customModelResult, {\n    animationSeed: 'custom-model',\n    physicalModels: { d3: customModel },\n  });\n  assert.equal(customCompletion.total, 2);\n  assert.equal(calls.length, 3);\n  assert.equal(calls[2].physical.length, 1);\n  assert.equal(calls[2].physical[0].canonicalKind, undefined);\n  assert.equal(calls[2].physical[0].definition.id, 'host:triad:v1');\n  assert.equal(calls[2].physical[0].definition.targeting, 'relabel');\n  assert.equal(calls[2].physical[0].presentation.contents[1].icon, '◆');\n  await assert.rejects(\n    renderer.playRoll(customModelResult, {\n      physicalModels: {\n        d3: {\n          ...customModel,\n          definition: { ...customModel.definition, targeting: 'fixed' },\n        },\n      },\n    }),\n    /currently require relabel targeting/,\n  );\n  assert.equal(calls.length, 3);\n\n  const browserHost = await readFile(join(projectRoot, 'src/main.ts'), 'utf8');`,
    'custom physical model runtime regression',
  );
  source = replaceOnce(source, `assert.deepEqual(calls[2].physical, []);`, `assert.deepEqual(calls[3].physical, []);`, 'total-only physical call index');
  source = replaceOnce(source, `assert.equal(calls[2].fallbacks[0].kind, 'token');`, `assert.equal(calls[3].fallbacks[0].kind, 'token');`, 'total-only fallback call index');
  source = replaceOnce(source, `assert.equal(calls[2].fallbacks[0].label, '5');`, `assert.equal(calls[3].fallbacks[0].label, '5');`, 'total-only label call index');
  source = replaceOnce(source, `assert.equal(calls[2].fallbacks[0].metadata.synthetic, true);`, `assert.equal(calls[3].fallbacks[0].metadata.synthetic, true);`, 'total-only metadata call index');
  await writeFile(path, source);
}

{
  const path = 'tests/browser/specs/overlay.spec.ts';
  let source = await readFile(path, 'utf8');
  source = replaceOnce(
    source,
    `      entry.requestedOutcomeIndex >= 0 &&\n      entry.requestedOutcomeIndex < (entry.id.includes('d3') ? 3 : 5),`,
    `      entry.requestedOutcomeIndex >= 0 &&\n      entry.requestedOutcomeIndex < entry.sides,`,
    'snapshot side-bound assertion',
  );
  await writeFile(path, source);
}

console.log('final physical runtime migration cleanup applied');
