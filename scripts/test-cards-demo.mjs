import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [cards, deck, demo, html, sdkPackage] = await Promise.all([
  readFile(new URL('../packages/sdk/src/cards.ts', import.meta.url), 'utf8'),
  readFile(new URL('../packages/sdk/src/deck.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/cards-demo.ts', import.meta.url), 'utf8'),
  readFile(new URL('../cards.html', import.meta.url), 'utf8'),
  readFile(new URL('../packages/sdk/package.json', import.meta.url), 'utf8'),
]);

assert.match(cards, /createStandardDeck/);
assert.match(cards, /standardPlayingCards/);
assert.match(cards, /value: 0/);
assert.match(cards, /game-specific interpretation belongs to the consuming application/);
assert.match(deck, /class DraftrollDeck/);
assert.match(deck, /reshuffleDiscard/);
assert.match(deck, /getRandomValues/);
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

console.log(JSON.stringify({ ok: true, standardDeck: true, interactiveDemo: true, systemAgnostic: true }, null, 2));
