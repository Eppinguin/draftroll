import assert from 'node:assert/strict';
import { runTsc } from './lib/load-typescript.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tempRoot = await mkdtemp(join(tmpdir(), 'draftroll-common-dice-test-'));
const outDir = join(tempRoot, 'build');
const configPath = join(tempRoot, 'tsconfig.json');

class SequenceRng {
  constructor(values) {
    this.values = [...values];
  }
  integer(min, max) {
    const value = this.values.shift();
    if (value === undefined) throw new Error(`Sequence RNG exhausted for ${min}..${max}`);
    if (value < min || value > max)
      throw new Error(`Sequence value ${value} outside ${min}..${max}`);
    return value;
  }
}

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
    throw new Error('TypeScript compilation failed');
  }
  await writeFile(join(outDir, 'package.json'), '{"type":"commonjs"}\n');

  const core = await import(pathToFileURL(join(outDir, 'core/src/index.js')).href);
  const sdk = await import(pathToFileURL(join(outDir, 'sdk/src/index.js')).href);
  const { DiceEngine } = core;
  const { Draftroll, commonDice, dice } = sdk;

  const coin = commonDice.coin();
  assert.equal(coin.id, 'coin');
  assert.equal(coin.renderAs, 'coin');
  assert.deepEqual(
    coin.faces.map((face) => [face.result, face.value, face.label]),
    [
      ['heads', 1, 'Heads'],
      ['tails', 0, 'Tails'],
    ],
  );

  const weightedCoin = commonDice.coin('weighted-coin', {
    headsResult: 'H',
    tailsResult: 'T',
    headsWeight: 3,
    tailsWeight: 1,
    metadata: { name: 'Loaded coin' },
  });
  assert.deepEqual(
    weightedCoin.faces.map((face) => face.weight),
    [3, 1],
  );
  assert.equal(weightedCoin.metadata?.name, 'Loaded coin');

  const coinEngine = new DiceEngine({ rng: new SequenceRng([1, 2]), customDice: [coin] });
  const coinRoll = coinEngine.evaluate({
    mode: 'evaluate',
    dice: [dice.custom(coin.id, 'flip_1'), dice.custom(coin.id, 'flip_2')],
  });
  assert.deepEqual(
    coinRoll.dice.map((die) => die.result),
    ['heads', 'tails'],
  );
  assert.equal(coinRoll.total, 1);

  const fate = commonDice.fate();
  assert.equal(fate.renderAs, 'fate');
  assert.equal(fate.faces.length, 6);
  assert.deepEqual(
    fate.faces.map((face) => face.result),
    [-1, -1, 0, 0, 1, 1],
  );
  const fateRoll = new DiceEngine({ rng: new SequenceRng([1, 6]), customDice: [fate] }).evaluate({
    mode: 'evaluate',
    dice: [dice.custom(fate.id, 'fate_1'), dice.custom(fate.id, 'fate_2')],
  });
  assert.equal(fateRoll.total, 0);
  assert.deepEqual(
    fateRoll.dice.map((die) => die.faceLabel),
    ['−', '+'],
  );

  const percentile = commonDice.percentilePair();
  assert.equal(percentile.renderAs, 'percentile');
  assert.equal(percentile.faces.length, 100);
  assert.equal(percentile.faces[0].result, 1);
  assert.equal(percentile.faces[0].label, '00 / 1');
  assert.equal(percentile.faces[99].result, 100);
  assert.equal(percentile.faces[99].label, '00 / 0');
  assert.deepEqual(percentile.faces[99].metadata, {
    percentile: 100,
    tens: 0,
    ones: 0,
    tensLabel: '00',
    onesLabel: '0',
  });
  const percentileRoll = new DiceEngine({
    rng: new SequenceRng([100]),
    customDice: [percentile],
  }).evaluate({
    mode: 'evaluate',
    dice: [dice.custom(percentile.id, 'percentile_1')],
  });
  assert.equal(percentileRoll.total, 100, '00/0 must normalize to 100 rather than 0');
  assert.equal(percentileRoll.dice[0].faceMetadata?.tensLabel, '00');
  assert.equal(percentileRoll.dice[0].faceMetadata?.onesLabel, '0');

  assert.equal(commonDice.symbols, commonDice.symbolPool);
  assert.equal(commonDice.table, commonDice.tableDraw);
  assert.equal(commonDice.cards, commonDice.cardDraw);

  const symbols = commonDice.symbolPool('narrative', [
    'blank',
    { result: 'success', value: 1, weight: 2, label: 'Success', metadata: { icon: 'star' } },
  ]);
  assert.equal(symbols.renderAs, 'token');
  const symbolRoll = new DiceEngine({ rng: new SequenceRng([2]), customDice: [symbols] }).evaluate({
    mode: 'evaluate',
    dice: [dice.custom(symbols.id, 'symbol_1')],
  });
  assert.equal(symbolRoll.total, 1);
  assert.equal(symbolRoll.dice[0].result, 'success');
  assert.equal(symbolRoll.dice[0].faceMetadata?.icon, 'star');

  const encounterTable = commonDice.tableDraw('encounter', [
    { result: 'quiet', value: 0, weight: 3 },
    { result: 'ambush', value: -1, weight: 1 },
  ]);
  assert.equal(encounterTable.renderAs, 'spinner');
  const tableRoll = new DiceEngine({
    rng: new SequenceRng([4]),
    customDice: [encounterTable],
  }).evaluate({
    mode: 'evaluate',
    dice: [dice.custom(encounterTable.id, 'encounter_1')],
  });
  assert.equal(tableRoll.dice[0].result, 'ambush');
  assert.equal(tableRoll.total, -1);

  const cards = commonDice.cardDraw('minor-deck', [
    { result: 'sun', value: 1, label: 'The Sun', metadata: { suit: 'major' } },
    { result: 'moon', value: 0, label: 'The Moon', metadata: { suit: 'major' } },
  ]);
  assert.equal(cards.renderAs, 'card');
  const cardSdk = new Draftroll({ engine: new DiceEngine({ rng: new SequenceRng([1, 1]) }) });
  const cardRoll = cardSdk.rollDice({
    customDice: [cards],
    dice: [dice.custom(cards.id, 'card_1'), dice.custom(cards.id, 'card_2')],
    render: false,
  });
  assert.deepEqual(
    cardRoll.dice.map((die) => die.result),
    ['sun', 'sun'],
    'card helpers draw with replacement',
  );
  assert.equal(cardRoll.dice[0].faceLabel, 'The Sun');
  assert.equal(cardRoll.dice[0].faceMetadata?.suit, 'major');

  assert.throws(() => commonDice.symbolPool(' ', ['x']), /definition ID/);
  assert.throws(() => commonDice.symbolPool('empty', []), /at least one face/);
  assert.throws(
    () => commonDice.symbolPool('bad-weight', [{ result: 'x', weight: 0 }]),
    /positive safe integers/,
  );
  assert.throws(
    () => commonDice.symbolPool('bad-value', [{ result: 'x', value: Number.NaN }]),
    /finite/,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        tested: [
          'coin definition and weighted coin options',
          'six-face Fate definition with repeated faces',
          'atomic percentile-pair results including 00/0 = 100',
          'symbol pools with weighted and metadata-bearing faces',
          'weighted table draws',
          'card draws with replacement',
          'portable use through dice.custom and inline customDice',
          'factory input validation',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
