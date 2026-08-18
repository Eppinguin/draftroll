import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTypeScript } from './lib/load-typescript.mjs';

const deckSource = await readFile(new URL('../packages/sdk/src/deck.ts', import.meta.url), 'utf8');
const ts = loadTypeScript();
const tempRoot = await mkdtemp(join(tmpdir(), 'draftroll-deck-atomicity-'));

function failingRandom(successfulSamples = 1) {
  let calls = 0;
  return () => {
    calls += 1;
    if (calls > successfulSamples) throw new Error('synthetic RNG failure');
    return 0;
  };
}

function results(cards) {
  return cards.map((card) => card.result);
}

try {
  const compilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  };
  const compiled = ts.transpileModule(deckSource, {
    compilerOptions,
    fileName: 'deck.ts',
  }).outputText;

  await writeFile(join(tempRoot, 'package.json'), '{"type":"module"}\n');
  await writeFile(
    join(tempRoot, 'protocol.js'),
    'export const DEFAULT_RUNTIME_VALIDATION_LIMITS = { maximumCustomFaces: 1000, maximumDice: 1000 };\n',
  );
  await writeFile(
    join(tempRoot, 'deck.js'),
    compiled.replace(/from ['"]\.\.\/\.\.\/protocol\/src\/index['"];/, "from './protocol.js';"),
  );

  const { DraftrollDeck } = await import(pathToFileURL(join(tempRoot, 'deck.js')).href);
  const definitions = [{ result: 'A' }, { result: 'B' }, { result: 'C' }, { result: 'D' }];

  {
    const deck = new DraftrollDeck('shuffle-atomic', definitions, {
      shuffle: false,
      random: failingRandom(),
    });
    const before = results(deck.remainingCards);
    assert.throws(() => deck.shuffle(), /synthetic RNG failure/);
    assert.deepEqual(
      results(deck.remainingCards),
      before,
      'failed shuffle must preserve draw order',
    );
    assert.equal(deck.active, 0);
    assert.equal(deck.discarded, 0);
  }

  {
    const deck = new DraftrollDeck('return-atomic-rng', definitions, {
      shuffle: false,
      random: failingRandom(),
    });
    const draw = deck.draw(2);
    const beforeRemaining = results(deck.remainingCards);
    assert.throws(() => deck.return(draw.cards, { shuffle: true }), /synthetic RNG failure/);
    assert.deepEqual(
      results(deck.remainingCards),
      beforeRemaining,
      'failed shuffled return must preserve the draw pile',
    );
    assert.equal(deck.active, 2, 'failed shuffled return must keep cards active');
    assert.equal(deck.discarded, 0);
  }

  {
    const deck = new DraftrollDeck('discard-reshuffle-atomic', definitions, {
      shuffle: false,
      random: failingRandom(),
    });
    const draw = deck.draw(2);
    deck.discard(draw.cards);
    const beforeRemaining = results(deck.remainingCards);
    const beforeDiscarded = results(deck.discardedCards);
    assert.throws(() => deck.reshuffleDiscard(), /synthetic RNG failure/);
    assert.deepEqual(
      results(deck.remainingCards),
      beforeRemaining,
      'failed discard reshuffle must preserve the draw pile',
    );
    assert.deepEqual(
      results(deck.discardedCards),
      beforeDiscarded,
      'failed discard reshuffle must preserve the discard pile',
    );
    assert.equal(deck.active, 0);
  }

  {
    const deck = new DraftrollDeck('reset-atomic', definitions, {
      shuffle: false,
      random: failingRandom(),
    });
    const draw = deck.draw(2);
    deck.discard(draw.cards[0]);
    const beforeRemaining = results(deck.remainingCards);
    const beforeDiscarded = results(deck.discardedCards);
    const beforeActive = deck.active;
    assert.throws(() => deck.reset(), /synthetic RNG failure/);
    assert.deepEqual(
      results(deck.remainingCards),
      beforeRemaining,
      'failed reset must preserve the draw pile',
    );
    assert.deepEqual(
      results(deck.discardedCards),
      beforeDiscarded,
      'failed reset must preserve the discard pile',
    );
    assert.equal(deck.active, beforeActive, 'failed reset must preserve active cards');
  }

  console.log(JSON.stringify({ ok: true, transactionalShuffleMutations: true }, null, 2));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
