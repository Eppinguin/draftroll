import assert from 'node:assert/strict';
import { runTsc } from './lib/load-typescript.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tempRoot = await mkdtemp(join(tmpdir(), 'draftroll-d20-test-'));
const outDir = join(tempRoot, 'build');
const configPath = join(tempRoot, 'tsconfig.json');

class SequenceRng {
  constructor(values) { this.values = [...values]; }
  integer(min, max) {
    const value = this.values.shift();
    if (value === undefined) throw new Error(`Sequence RNG exhausted for ${min}..${max}`);
    if (value < min || value > max) throw new Error(`Sequence value ${value} outside ${min}..${max}`);
    return value;
  }
}

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

  const core = await import(pathToFileURL(join(outDir, 'core/src/index.js')).href);
  const sdkModule = await import(pathToFileURL(join(outDir, 'sdk/src/index.js')).href);
  const { DiceEngine, normalizeExternalRoll, formatRollResult, filterRollNodes } = core;
  const { Draftroll, dice, operations, selectors, defineDie } = sdkModule;

  const rollWith = (expression, values, options = {}) => new DiceEngine({ rng: new SequenceRng(values) }).roll(expression, options);

  assert.equal(new DiceEngine().roll('1.5 + 2.25').total, 3.75);
  assert.equal(rollWith('d%', [73]).dice[0].type, 'd100');
  assert.equal(rollWith('d1', [1]).total, 1);
  assert.equal(new DiceEngine().roll('0d6').total, 0);
  assert.equal(new DiceEngine().roll('()').total, 0);
  assert.equal(new DiceEngine().roll('(2,)').total, 2);
  assert.equal(rollWith('(1d4 + 1, 3, 2d6kl1)kh1', [2, 2, 5]).total, 3);
  assert.equal(rollWith('4d6p<3', [1, 2, 5, 6]).total, 11);
  assert.equal(rollWith('4d6k3', [3, 2, 3, 6]).total, 6);

  const reroll = rollWith('2d6rr<3', [1, 2, 4, 5]);
  assert.equal(reroll.total, 9);
  assert.equal(reroll.dice.length, 4);
  assert.equal(reroll.dice.filter((die) => die.kept).length, 2);

  const rerollOnce = rollWith('2d6ro<3', [1, 2, 3, 4]);
  assert.equal(rerollOnce.total, 7);

  const rerollAdd = rollWith('2d6ra<3', [1, 5, 4]);
  assert.equal(rerollAdd.total, 10);
  assert.equal(rerollAdd.dice.filter((die) => die.generatedBy === 'reroll-add').length, 1);

  const explode = rollWith('2d6e6', [6, 2, 6, 3]);
  assert.equal(explode.total, 17);
  assert.equal(explode.dice.length, 4);

  assert.equal(rollWith('4d6mi2', [1, 2, 3, 6]).total, 13);
  assert.equal(rollWith('2d20ma10', [20, 4]).total, 14);
  assert.equal(new DiceEngine().roll('7 // 2').total, 3);
  assert.equal(new DiceEngine().roll('2.5 * 4 == 10').total, 1);
  assert.equal(new DiceEngine().roll('10 != 10').total, 0);

  const healing = rollWith('-(1d8 + 3) [healing]', [7]);
  assert.equal(healing.total, -10);
  assert.ok(healing.tree && filterRollNodes(healing.tree, (node) => node.annotations.includes('healing')).length === 1);

  const annotated = rollWith('3d6 [fire] + 1d4 [piercing] attack damage', [3, 2, 2, 4], { allowComments: true });
  assert.equal(annotated.comment, 'attack damage');
  assert.deepEqual(annotated.dice.slice(0, 3).map((die) => die.annotations), [['fire'], ['fire'], ['fire']]);
  assert.deepEqual(annotated.dice[3].annotations, ['piercing']);

  const advantage = rollWith('1d20 + 5', [8, 20], { advantage: 'advantage' });
  assert.equal(advantage.total, 25);
  assert.equal(advantage.critical, 'critical-success');
  assert.equal(advantage.dice.filter((die) => die.kept).length, 1);

  const disadvantage = rollWith('1d20 + 2', [1, 17], { advantage: 'disadvantage' });
  assert.equal(disadvantage.total, 3);
  assert.equal(disadvantage.critical, 'critical-failure');

  const fate = rollWith('4dF', [-1, 0, 1, 1]);
  assert.equal(fate.total, 1);


  const customEngine = new DiceEngine({
    rng: new SequenceRng([1, 3, 2]),
    customDice: [{
      id: 'weather',
      faces: [
        { result: 'sun', value: 2, weight: 1, label: 'Clear' },
        { result: 'rain', value: 0, weight: 2, label: 'Rain' },
      ],
    }],
  });
  const custom = customEngine.evaluate({
    mode: 'evaluate',
    dice: [
      { id: 'weather_1', type: 'weather', customDiceId: 'weather' },
      { id: 'weather_2', type: 'weather', customDiceId: 'weather' },
    ],
  });
  assert.deepEqual(custom.dice.map((die) => die.result), ['sun', 'rain']);
  assert.equal(custom.total, 2);
  const customRerolled = customEngine.reroll(custom, 'weather_2');
  assert.equal(customRerolled.dice.find((die) => die.id === 'weather_2').result, 'rain');
  assert.equal(customEngine.listDice().length, 1);

  const sparkDefinition = {
    id: 'spark',
    faces: [
      { result: 'blank', value: 0 },
      { result: 'spark', value: 1 },
    ],
  };
  const structuredOnceEngine = new DiceEngine({ rng: new SequenceRng([1, 2, 1, 2]), customDice: [sparkDefinition] });
  const structuredOnce = structuredOnceEngine.evaluate({
    mode: 'evaluate',
    dice: [{ id: 'spark_1', type: 'spark', customDiceId: 'spark', themeId: 'ember' }],
    operations: [{ type: 'reroll-once', selector: { type: 'literal', target: 0 } }],
  });
  assert.equal(structuredOnce.total, 1);
  assert.equal(structuredOnce.dice.length, 2);
  assert.equal(structuredOnce.dice[0].kept, false);
  assert.equal(structuredOnce.dice[1].generatedBy, 'reroll');
  assert.equal(structuredOnce.dice[1].themeId, 'ember');
  const structuredOnceRerolled = structuredOnceEngine.reroll(structuredOnce, 'spark_1');
  assert.equal(structuredOnceRerolled.total, 1);
  assert.equal(structuredOnceRerolled.dice[0].generatedBy, 'initial');
  assert.equal(structuredOnceRerolled.operations[0].type, 'reroll-once');
  const structuredCorrected = structuredOnceEngine.update(structuredOnce, {
    dice: [{ id: 'spark_1', result: 'spark' }],
  });
  assert.equal(structuredCorrected.total, 1);
  assert.equal(structuredCorrected.dice.length, 1);
  assert.equal(structuredCorrected.dice[0].numericValue, 1);

  const structuredAddEngine = new DiceEngine({ rng: new SequenceRng([1, 2]), customDice: [sparkDefinition] });
  const structuredAdd = structuredAddEngine.evaluate({
    mode: 'evaluate',
    dice: [{ id: 'spark_1', type: 'spark', customDiceId: 'spark' }],
    operations: [{ type: 'reroll-add', selector: { type: 'literal', target: 0 } }],
  });
  assert.equal(structuredAdd.total, 1);
  assert.equal(structuredAdd.dice.length, 2);
  assert.ok(structuredAdd.dice.every((die) => die.kept));

  const structuredExplodeEngine = new DiceEngine({ rng: new SequenceRng([2, 2, 1]), customDice: [sparkDefinition] });
  const structuredExplode = structuredExplodeEngine.evaluate({
    mode: 'evaluate',
    dice: [{ id: 'spark_1', type: 'spark', customDiceId: 'spark' }],
    operations: [{ type: 'explode', selector: { type: 'literal', target: 1 } }],
  });
  assert.equal(structuredExplode.total, 2);
  assert.equal(structuredExplode.dice.length, 3);
  assert.equal(structuredExplode.dice.filter((die) => die.generatedBy === 'explosion').length, 2);

  const structuredRecursive = new DiceEngine({ rng: new SequenceRng([1, 2, 4]) }).evaluate({
    mode: 'evaluate',
    dice: [{ id: 'check', type: 'd6' }],
    operations: [{ type: 'reroll', selector: { type: 'less', target: 3 }, dice: ['check'] }],
  });
  assert.equal(structuredRecursive.total, 4);
  assert.equal(structuredRecursive.dice.length, 3);
  assert.deepEqual(structuredRecursive.operations[0].metadata?.configuredDice, ['check']);

  const structuredSelectors = new DiceEngine({ rng: new SequenceRng([1, 6, 3]) }).evaluate({
    mode: 'evaluate',
    dice: [
      { id: 'pool_1', type: 'd6' },
      { id: 'pool_2', type: 'd6' },
      { id: 'pool_3', type: 'd6' },
    ],
    operations: [
      { type: 'minimum', target: 2 },
      { type: 'maximum', target: 5 },
      { type: 'success-count', selector: { type: 'greater-equal', target: 4 } },
    ],
  });
  assert.deepEqual(structuredSelectors.dice.map((die) => die.numericValue), [2, 5, 3]);
  assert.equal(structuredSelectors.total, 1);

  const portableEngine = new DiceEngine({ rng: new SequenceRng([1, 2, 1, 2]) });
  const portableCustom = portableEngine.evaluate({
    mode: 'evaluate',
    customDice: [sparkDefinition],
    dice: [{ id: 'portable', type: 'spark', customDiceId: 'spark' }],
    operations: [{ type: 'reroll-once', selector: { type: 'literal', target: 0 } }],
  });
  assert.equal(portableCustom.total, 1);
  assert.equal(portableCustom.customDice?.[0].id, 'spark');
  const portableRerolled = portableEngine.reroll(portableCustom, 'portable');
  assert.equal(portableRerolled.total, 1);
  assert.equal(portableRerolled.customDice?.[0].id, 'spark');

  const repeatedDefinition = {
    id: 'repeat-face',
    faces: [
      { result: 'blank', value: 0, label: 'Empty', metadata: { slot: 0 } },
      { result: 'blank', value: 1, label: 'Marked', metadata: { slot: 1 } },
    ],
  };
  const repeatedEngine = new DiceEngine();
  const repeated = repeatedEngine.evaluate({
    mode: 'evaluate',
    customDice: [repeatedDefinition],
    dice: [{ id: 'repeat_1', type: 'repeat-face', customDiceId: 'repeat-face', result: 'blank', faceIndex: 1 }],
  });
  assert.equal(repeated.total, 1);
  assert.equal(repeated.dice[0].faceLabel, 'Marked');
  assert.equal(repeated.dice[0].faceMetadata.slot, 1);
  const repeatedCorrected = repeatedEngine.update(repeated, {
    dice: [{ id: 'repeat_1', result: 'blank', faceIndex: 0 }],
  });
  assert.equal(repeatedCorrected.total, 0);
  assert.equal(repeatedCorrected.dice[0].faceLabel, 'Empty');
  assert.equal(repeatedCorrected.dice[0].faceMetadata.slot, 0);
  const repeatedExternal = normalizeExternalRoll({
    mode: 'display',
    customDice: [repeatedDefinition],
    dice: [{ id: 'external_repeat', type: 'repeat-face', customDiceId: 'repeat-face', result: 'blank', faceIndex: 1 }],
  });
  assert.equal(repeatedExternal.total, 1);
  assert.equal(repeatedExternal.dice[0].faceLabel, 'Marked');

  const d20Comparison = rollWith('2d6>=5', [1, 1]);
  assert.equal(d20Comparison.total, 0, 'd20 dialect compares the dice total');
  const successes = rollWith('4d6cs>=5', [2, 5, 6, 1]);
  assert.equal(successes.total, 2);
  const legacySuccesses = rollWith('4d6>=5', [2, 5, 6, 1], { dialect: 'draftroll' });
  assert.equal(legacySuccesses.total, 2);

  const engine = new DiceEngine({ rng: new SequenceRng([4, 5, 2, 6]) });
  const compiled = engine.compile('2d6kh1');
  assert.equal(compiled.roll().total, 5);
  assert.equal(compiled.roll().total, 6, 'compiled expressions must be reusable without accumulating advantage/operations');

  assert.equal(new DiceEngine().validate('2d6kh1').valid, true);
  assert.equal(new DiceEngine().validate('2d6wat').valid, false);

  assert.ok(advantage.tree);
  assert.ok(filterRollNodes(advantage.tree, (node) => node.kind === 'die').length >= 2);
  assert.match(formatRollResult(reroll, { style: 'plain' }), /= 9$/);

  const sdkEngine = new DiceEngine({ rng: new SequenceRng([4, 6, 2, 5]) });
  const draftroll = new Draftroll({ engine: sdkEngine });
  let rollEvents = 0;
  const stopListening = draftroll.on('roll', () => { rollEvents += 1; });
  const sdkRoll = draftroll.roll({ expression: '2d6kh1', render: false, themes: ['iron', 'glass'] });
  assert.equal(sdkRoll.total, 6);
  assert.equal(sdkRoll.dice[0].themeId, 'iron');
  assert.equal(sdkRoll.dice[1].themeId, 'glass');
  assert.equal(rollEvents, 1);
  assert.equal((await sdkRoll.wait()), undefined);
  assert.equal(draftroll.getRoll(sdkRoll.id)?.total, 6);
  const corrected = sdkRoll.setDieResult(sdkRoll.dice[1].id, 3);
  assert.equal(corrected.total, 4);
  assert.equal(corrected.result.revision, 1);
  const formula = corrected.setFormula('1d6 + 5');
  assert.equal(formula.total, 9);
  assert.equal(draftroll.getRollRevisions(sdkRoll.id).length, 3);
  assert.match(draftroll.format(formula), /= 9$/);
  assert.equal(draftroll.validate('2d6kh1').valid, true);
  assert.equal(draftroll.tryRoll('2d6wat', { render: false }).ok, false);
  const compiledSdk = draftroll.compile('2d6kh1');
  assert.equal(compiledSdk.roll().total, 5);
  stopListening();

  const customSdk = new Draftroll({ engine: new DiceEngine({ rng: new SequenceRng([1, 2]) }) });
  customSdk.registerDie({
    id: 'coin',
    faces: [
      { result: 'heads', value: 1 },
      { result: 'tails', value: 0 },
    ],
  });
  const coinFlip = customSdk.rollDice({
    dice: [
      { id: 'coin_1', type: 'coin', customDiceId: 'coin' },
      { id: 'coin_2', type: 'coin', customDiceId: 'coin' },
    ],
    render: false,
  });
  assert.deepEqual(coinFlip.dice.map((die) => die.result), ['heads', 'tails']);
  assert.equal(coinFlip.total, 1);
  assert.equal(customSdk.listDice().length, 1);

  const builderSdk = new Draftroll({ engine: new DiceEngine({ rng: new SequenceRng([1, 6, 2]) }) });
  const builderPool = builderSdk.rollDice({
    dice: [
      dice.d6('first', { themeId: 'iron' }),
      dice.d6('second', { themeId: 'glass' }),
    ],
    operations: [
      operations.rerollOnce(selectors.equal(1), ['first']),
      operations.keepHighest(1),
    ],
    render: false,
  });
  assert.equal(builderPool.total, 6);
  assert.equal(builderPool.dice.find((die) => die.id === 'first')?.kept, false);
  assert.equal(builderPool.dice.filter((die) => die.kept).length, 1);
  assert.equal(defineDie({ id: 'marker', faces: [{ result: 'yes', value: 1 }] }).id, 'marker');

  console.log(JSON.stringify({
    ok: true,
    tested: [
      'decimals', 'd%', 'd1/zero-dice pools', 'sets', 'keep/drop selectors', 'rr', 'ro', 'ra', 'explode',
      'minimum/maximum', 'integer division', 'comparisons', 'annotations/comments',
      'advantage/disadvantage', 'critical classification', 'Fate dice',
      'success-count extension', 'custom weighted/symbol dice', 'structured custom reroll/explode operations', 'portable inline custom definitions', 'repeated custom faces by index', 'compiled expressions', 'validation', 'tree traversal', 'formatting',
      'developer-friendly SDK facade', 'typed dice/selector/operation builders', 'stable roll handles', 'events', 'formula/result correction helpers',
    ],
  }, null, 2));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
