import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTypeScript } from './lib/load-typescript.mjs';

const [cardsSource, deckSource, demo, html, sdkPackage] = await Promise.all([
  readFile(new URL('../packages/sdk/src/cards.ts', import.meta.url), 'utf8'),
  readFile(new URL('../packages/sdk/src/deck.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/cards-demo.ts', import.meta.url), 'utf8'),
  readFile(new URL('../cards.html', import.meta.url), 'utf8'),
  readFile(new URL('../packages/sdk/package.json', import.meta.url), 'utf8'),
]);

assert.match(cardsSource, /createStandardDeck/);
assert.match(cardsSource, /standardPlayingCards/);
assert.match(cardsSource, /game-specific interpretation .*consuming application/);
assert.match(deckSource, /class DraftrollDeck/);
assert.match(deckSource, /reshuffleDiscard/);
assert.match(deckSource, /getRandomValues/);
assert.match(sdkPackage, /"\.\/cards"/);
assert.match(sdkPackage, /"\.\/deck"/);

assert.match(html, /id="card-deck"/);
assert.match(html, /id="card-remaining"/);
assert.match(html, /id="card-discarded"/);
assert.match(html, /id="card-shuffle"/);
assert.match(html, /id="card-draw-count"/);
assert.match(demo, /createStandardDeck/);
assert.match(demo, /draw\.toDisplayInput/);
assert.match(demo, /draftroll\.display/);

const ts = loadTypeScript();
const tempRoot = await mkdtemp(join(tmpdir(), 'draftroll-card-behavior-'));
try {
  const compilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  };
  const transpile = (source, fileName) =>
    ts.transpileModule(source, { compilerOptions, fileName }).outputText;
  await writeFile(join(tempRoot, 'package.json'), '{"type":"module"}\n');
  await writeFile(join(tempRoot, 'deck.js'), transpile(deckSource, 'deck.ts'));
  await writeFile(
    join(tempRoot, 'cards.js'),
    transpile(cardsSource, 'cards.ts').replace(/from ['"]\.\/deck['"];/, "from './deck.js';"),
  );

  const deckModule = await import(pathToFileURL(join(tempRoot, 'deck.js')).href);
  const cardsModule = await import(pathToFileURL(join(tempRoot, 'cards.js')).href);
  const { DraftrollDeck } = deckModule;
  const { createStandardDeck, standardPlayingCards } = cardsModule;

  const orderedDeck = new DraftrollDeck(
    'ordered',
    [{ result: 'A' }, { result: 'B' }, { result: 'C' }],
    { shuffle: false },
  );
  assert.deepEqual(
    orderedDeck.remainingCards.map((card) => card.result),
    ['A', 'B', 'C'],
    'remainingCards follows public draw order',
  );
  const orderedDraw = orderedDeck.draw(2);
  assert.deepEqual(
    orderedDraw.cards.map((card) => card.result),
    ['A', 'B'],
    'shuffle:false draws definitions from first to last',
  );
  orderedDeck.return(orderedDraw.cards, { shuffle: false });
  assert.deepEqual(
    orderedDeck.draw(2).cards.map((card) => card.result),
    ['A', 'B'],
    'return(..., { shuffle:false }) preserves caller order at the top of the deck',
  );
  orderedDeck.reset({ shuffle: false });
  assert.deepEqual(
    orderedDeck.draw(3).cards.map((card) => card.result),
    ['A', 'B', 'C'],
    'reset restores deterministic source order',
  );

  const copiedDeck = new DraftrollDeck(
    'copies',
    [{ result: 'A', copies: 2 }, { result: 'B' }],
    { shuffle: false },
  );
  assert.equal(copiedDeck.size, 3);
  assert.deepEqual(
    copiedDeck.draw(3).cards.map((card) => [card.result, card.copyIndex]),
    [
      ['A', 0],
      ['A', 1],
      ['B', 0],
    ],
  );

  assert.throws(
    () =>
      new DraftrollDeck('oversized', [{ result: 'x', copies: 100_001 }], { shuffle: false }),
    /at most 100000 card copies/,
  );
  assert.throws(
    () =>
      new DraftrollDeck(
        'uncloneable',
        [{ result: 'x', metadata: { callback() {} } }],
        { shuffle: false },
      ),
    /structured-cloneable/,
  );
  assert.throws(() => standardPlayingCards({ jokers: 3 }), /jokers must be 0, 1, or 2/);
  assert.throws(() => createStandardDeck('invalid-jokers', { jokers: -1 }), /jokers must be 0, 1, or 2/);

  const deterministicDefinitions = [{ result: 'A' }, { result: 'B' }, { result: 'C' }];
  const deterministicA = new DraftrollDeck('deterministic-a', deterministicDefinitions, {
    random: () => 0,
  });
  const deterministicB = new DraftrollDeck('deterministic-b', deterministicDefinitions, {
    random: () => 0,
  });
  assert.deepEqual(
    deterministicA.draw(3).cards.map((card) => card.result),
    deterministicB.draw(3).cards.map((card) => card.result),
    'the same injected random stream produces the same public draw order',
  );
  assert.throws(
    () =>
      new DraftrollDeck('invalid-rng', [{ result: 'A' }, { result: 'B' }], {
        random: () => 1,
      }),
    /random\(\) must return a value in \[0, 1\)/,
  );

  const discardDeck = createStandardDeck('discard-atomic', { shuffle: false });
  const discardDraw = discardDeck.draw(2);
  assert.equal(discardDraw.cards[0].result, 'A♠');
  assert.equal(discardDraw.cards[1].result, '2♠');
  assert.equal(discardDeck.active, 2);
  assert.equal(discardDeck.discarded, 0);
  assert.throws(
    () => discardDeck.discard([discardDraw.cards[0], 'missing-card']),
    /is not active/,
  );
  assert.equal(discardDeck.active, 2, 'failed discard leaves every active card untouched');
  assert.equal(discardDeck.discarded, 0, 'failed discard does not partially commit');
  assert.throws(
    () => discardDeck.discard([discardDraw.cards[0], discardDraw.cards[0]]),
    /duplicate card IDs/,
  );
  assert.equal(discardDeck.active, 2, 'duplicate discard is rejected before mutation');

  const returnDeck = createStandardDeck('return-atomic', { shuffle: false });
  const returnDraw = returnDeck.draw(2);
  const remainingBeforeReturn = returnDeck.remaining;
  assert.throws(
    () => returnDeck.return([returnDraw.cards[0], 'missing-card'], { shuffle: false }),
    /is not active/,
  );
  assert.equal(returnDeck.active, 2, 'failed return leaves every active card untouched');
  assert.equal(returnDeck.remaining, remainingBeforeReturn, 'failed return does not partially commit');

  const isolatedDeck = new DraftrollDeck(
    'snapshot-isolation',
    [
      {
        result: 'alpha',
        label: 'Alpha',
        metadata: { nested: { marker: 'original' } },
      },
    ],
    { shuffle: false, metadata: { nested: { owner: 'deck' } } },
  );
  const firstDefinition = isolatedDeck.definition;
  firstDefinition.faces[0].label = 'Mutated';
  firstDefinition.faces[0].metadata.nested.marker = 'mutated';
  firstDefinition.metadata.nested.owner = 'mutated';
  const secondDefinition = isolatedDeck.definition;
  assert.equal(secondDefinition.faces[0].label, 'Alpha');
  assert.equal(secondDefinition.faces[0].metadata.nested.marker, 'original');
  assert.equal(secondDefinition.metadata.nested.owner, 'deck');

  const isolatedDraw = isolatedDeck.draw();
  assert.ok(Object.isFrozen(isolatedDraw.cards));
  assert.ok(Object.isFrozen(isolatedDraw.cards[0]));
  isolatedDraw.cards[0].metadata.nested.marker = 'snapshot mutation';
  const firstDisplay = isolatedDraw.toDisplayInput();
  assert.equal(firstDisplay.dice[0].metadata.nested.marker, 'snapshot mutation');
  firstDisplay.customDice[0].faces[0].label = 'Display mutation';
  firstDisplay.customDice[0].faces[0].metadata.nested.marker = 'display mutation';
  const secondDisplay = isolatedDraw.toDisplayInput();
  assert.equal(secondDisplay.customDice[0].faces[0].label, 'Alpha');
  assert.equal(secondDisplay.customDice[0].faces[0].metadata.nested.marker, 'original');

  console.log(
    JSON.stringify(
      {
        ok: true,
        standardDeck: true,
        deterministicOrder: true,
        boundedExpansion: true,
        strictMetadataIsolation: true,
        runtimeValidation: true,
        interactiveDemo: true,
        systemAgnostic: true,
        atomicMutations: true,
        isolatedSnapshots: true,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
