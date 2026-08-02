import assert from 'node:assert/strict';
import { runTsc } from './lib/load-typescript.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tempRoot = await mkdtemp(join(tmpdir(), 'draftroll-mixed-renderer-'));
const outDir = join(tempRoot, 'build');
const configPath = join(tempRoot, 'tsconfig.json');

try {
  await writeFile(configPath, JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'CommonJS',
      moduleResolution: 'Node',
      rootDir: join(projectRoot, 'packages'),
      outDir,
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      lib: ['ES2023', 'DOM', 'DOM.Iterable'],
    },
    include: [join(projectRoot, 'packages/**/*.ts')],
  }, null, 2));

  const compile = runTsc(['-p', configPath], { cwd: projectRoot });
  if (compile.status !== 0) {
    process.stderr.write(compile.stdout);
    process.stderr.write(compile.stderr);
    throw new Error('TypeScript compilation failed');
  }
  await writeFile(join(outDir, 'package.json'), '{"type":"commonjs"}\n');

  const { DraftrollRenderer } = await import(pathToFileURL(join(outDir, 'renderer/src/index.js')).href);
  const calls = [];
  const bridge = {
    async roll(request) {
      calls.push(request);
      const physicalResults = Array.isArray(request.results) ? request.results : request.results === undefined ? [] : [request.results];
      const fallbackResults = (request.fallbacks ?? []).map((fallback) => fallback.result);
      return { results: [...physicalResults, ...fallbackResults], total: physicalResults.reduce((sum, value) => sum + value, 0), replay: null };
    },
    setDie() {},
    setQuantity() {},
    setTheme() {},
    getThemes() {
      return [
        { id: 'dragon', name: 'Wyrmfire' },
        { id: 'frost', name: 'Glacier Heart' },
        { id: 'ember', name: 'Phoenix Forge' },
      ];
    },
  };

  const renderer = new DraftrollRenderer({ bridge });
  const result = {
    authority: 'server',
    name: 'Mara Voss',
    expression: '1d20+1d8+2d6',
    total: 31,
    dice: [
      { id: 'die_1', type: 'd20', sides: 20, result: 17, kept: true, themeId: 'dragon' },
      { id: 'die_2', type: 'd8', sides: 8, result: 6, kept: true, themeId: 'frost' },
      { id: 'die_3', type: 'd6', sides: 6, result: 4, kept: true, themeId: 'ember' },
      { id: 'die_4', type: 'd6', sides: 6, result: 4, kept: true, themeId: 'dragon' },
    ],
    operations: [],
    createdAt: new Date(0).toISOString(),
  };

  const completion = await renderer.playRoll(result, { animationSeed: 'mixed-test' });
  assert.equal(completion.total, 31);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].kinds, ['d20', 'd8', 'd6', 'd6']);
  assert.deepEqual(calls[0].results, [17, 6, 4, 4]);
  assert.deepEqual(calls[0].themes, ['dragon', 'frost', 'ember', 'dragon']);
  assert.equal(calls[0].context.name, 'Mara Voss');


  const universalResult = {
    authority: 'server',
    name: 'Universal pool',
    expression: '1d20 + 1d2 + 1dF + 1d9 + 1d100',
    total: 108,
    dice: [
      { id: 'standard', type: 'd20', sides: 20, result: 17, kept: true, themeId: 'dragon' },
      { id: 'coin', type: 'd2', sides: 2, result: 2, kept: true, themeId: 'frost' },
      { id: 'fate', type: 'dF', result: -1, numericValue: -1, kept: true, themeId: 'ember' },
      { id: 'odd', type: 'd9', sides: 9, result: 7, kept: true, themeId: 'dragon' },
      { id: 'percentile', type: 'd100', sides: 100, result: 82, kept: true, themeId: 'frost' },
      { id: 'symbol', type: 'narrative', result: 'success', numericValue: 1, faceLabel: 'Success', kept: true, customDiceId: 'narrative', themeId: 'ember' },
      { id: 'weighted', type: 'weather', result: 'storm', numericValue: 2, faceLabel: 'Storm', kept: true, customDiceId: 'weather', themeId: 'dragon' },
    ],
    customDice: [
      { id: 'narrative', faces: [{ result: 'success', value: 1, label: 'Success' }], renderAs: 'card' },
      { id: 'weather', faces: [{ result: 'storm', value: 2, weight: 3, label: 'Storm' }], renderAs: 'token' },
    ],
    operations: [],
    createdAt: new Date(0).toISOString(),
  };

  const universalCompletion = await renderer.playRoll(universalResult, { animationSeed: 'fallback-test' });
  assert.equal(universalCompletion.total, 108);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].kinds, ['d20']);
  assert.deepEqual(calls[1].results, [17]);
  assert.deepEqual(
    calls[1].fallbacks.map((fallback) => fallback.kind),
    ['coin', 'fate', 'spinner', 'percentile', 'card', 'token'],
  );
  assert.deepEqual(
    calls[1].visualOrder.map((entry) => entry.kind),
    ['physical', 'fallback', 'fallback', 'fallback', 'fallback', 'fallback', 'fallback'],
  );
  assert.equal(calls[1].fallbacks[1].label, '−');
  assert.equal(calls[1].fallbacks[4].label, 'Success');
  assert.equal(calls[1].fallbacks[5].label, 'Storm');


  const totalOnly = {
    authority: 'local',
    name: 'Flat modifier',
    expression: '+5',
    total: 5,
    dice: [],
    operations: [],
    createdAt: new Date(0).toISOString(),
  };
  const totalOnlyCompletion = await renderer.playRoll(totalOnly, { animationSeed: 'total-only' });
  assert.equal(totalOnlyCompletion.total, 5);
  assert.deepEqual(calls[2].results, []);
  assert.equal(calls[2].fallbacks[0].kind, 'token');
  assert.equal(calls[2].fallbacks[0].label, '5');
  assert.equal(calls[2].fallbacks[0].metadata.synthetic, true);

  console.log(JSON.stringify({
    ok: true,
    physicalKinds: calls[0].kinds,
    fallbackKinds: calls[1].fallbacks.map((fallback) => fallback.kind),
    total: universalCompletion.total,
  }, null, 2));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
