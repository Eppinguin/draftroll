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
assert.match(cardsSource, /value: 0/);
assert.match(cardsSource, /game-specific interpretation .*consuming application/);
assert.match(deckSource, /class DraftrollDeck/);
assert.match(deckSource, /reshuffleDiscard/);
assert.match(deckSource, /getRandomValues/);
assert.match(sdkPackage, /"\.\/cards"/);

assert.match(html, /id="card-deck"/);
assert.match(html, /id="card-remaining"/);
assert.match(html, /id="card-discarded"/);
assert.match(html, /id="card-shuffle"/);
assert.match(html, /id="card-draw-count"/);
assert.match(demo, /createStandardDeck/);
assert.match(demo, /deck\.draw\(count\)/);
assert.match(demo, /deck\.discard\(currentHand\)/);
assert.match(demo, /deck\.reshuffleDiscard\(\)/);
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
  await writeFile(join(tempRoot, 'cards.js'), transpile(cardsSource, 'cards.ts'));

  const deckModule = await import(pathToFileURL(join(tempRoot, 'deck.js')).href);
  const cardsModule = await import(pathToFileURL(join(tempRoot, 'cards.js')).href);
  const { DraftrollDeck } = deckModule;
  const { createStandardDeck } = cardsModule;

  const discardDeck = createStandardDeck('discard-atomic', { shuffle: false });
  const discardDraw = discardDeck.draw(2);
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
  const firstDisplay = isolatedDraw.toDisplayInput();
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
