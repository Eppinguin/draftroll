import assert from 'node:assert/strict';
import { runTsc } from './lib/load-typescript.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tempRoot = await mkdtemp(join(tmpdir(), 'draftroll-update-test-'));
const outDir = join(tempRoot, 'build');
const configPath = join(tempRoot, 'tsconfig.json');

try {
  await writeFile(
    configPath,
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
  );

  const compile = runTsc(['-p', configPath], { cwd: projectRoot });
  if (compile.status !== 0) {
    process.stderr.write(compile.stdout);
    process.stderr.write(compile.stderr);
    process.exitCode = compile.status ?? 1;
    throw new Error('TypeScript compilation failed');
  }
  await writeFile(join(outDir, 'package.json'), '{"type":"commonjs"}\n');

  const sdkModule = await import(pathToFileURL(join(outDir, 'sdk/src/index.js')).href);
  const { Draftroll, DiceEngine, SeededRng } = sdkModule;

  class StubRenderer {
    plays = [];
    updates = [];
    async warmup() {}
    async playRoll(result, options) {
      this.plays.push({ result, options });
      return {
        results: result.dice.map((die) => Number(die.result)),
        total: result.total,
        replay: null,
      };
    }
    updateResult(result, options) {
      this.updates.push({ result, options });
    }
  }

  const renderer = new StubRenderer();
  const engine = new DiceEngine({ rng: new SeededRng('sdk-update-test') });
  const draftroll = new Draftroll({ engine, renderer });

  const original = draftroll.roll('2d20kh1+5', { themes: ['dragon', 'frost'] });
  await original.presentation;
  assert.equal(renderer.plays.length, 1);
  assert.equal(draftroll.rollLog.length, 1);
  assert.equal(original.result.revision, 0);

  const corrected = original.update({
    dice: [{ id: 'die_1', result: 20, themeId: 'ember' }],
    annotation: 'Manual correction',
  });
  await corrected.presentation;
  assert.equal(renderer.plays.length, 1, 'log-only update must not replay dice');
  assert.equal(renderer.updates.length, 1, 'log-only update must refresh result UI');
  assert.equal(corrected.result.rollId, original.result.rollId);
  assert.equal(corrected.result.revision, 1);
  assert.equal(corrected.result.dice[0].result, 20);
  assert.equal(corrected.result.dice[0].themeId, 'ember');
  assert.equal(draftroll.rollLog.length, 1, 'revision must replace the existing log entry');
  assert.equal(draftroll.rollLog[0].revision, 1);
  assert.deepEqual(
    draftroll.getRollRevisions(original.result.rollId).map((entry) => entry.revision),
    [0, 1],
  );

  const formulaUpdate = corrected.update(
    { expression: '2d20kh1+7' },
    {
      mode: 'animate',
      animateDice: 'all',
    },
  );
  await formulaUpdate.presentation;
  assert.equal(renderer.plays.length, 2);
  assert.equal(formulaUpdate.result.revision, 2);
  assert.equal(formulaUpdate.result.expression, '2d20kh1+7');
  assert.equal(
    formulaUpdate.result.dice[0].result,
    20,
    'formula-only edit should preserve existing values by default',
  );

  const rerolledFormula = formulaUpdate.update(
    { expression: '3d20kh1+7' },
    {
      mode: 'animate',
      reroll: true,
    },
  );
  await rerolledFormula.presentation;
  assert.equal(renderer.plays.length, 3);
  assert.equal(rerolledFormula.result.dice.length, 3);
  assert.equal(rerolledFormula.result.revision, 3);

  const selectedAnimation = rerolledFormula.update(
    {
      dice: [{ id: 'die_2', result: 1 }],
    },
    {
      mode: 'animate',
      animateDice: 'changed',
    },
  );
  await selectedAnimation.presentation;
  assert.deepEqual(renderer.plays.at(-1).options.dieIds, ['die_2']);

  console.log(
    JSON.stringify(
      {
        ok: true,
        rollId: selectedAnimation.result.rollId,
        revision: selectedAnimation.result.revision,
        total: selectedAnimation.result.total,
        logEntries: draftroll.rollLog.length,
        revisionSnapshots: draftroll.getRollRevisions(selectedAnimation.result.rollId).length,
        physicalPlays: renderer.plays.length,
        logOnlyUpdates: renderer.updates.length,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
