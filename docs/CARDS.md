# Stateful card decks

Draftroll card decks keep deck state in the SDK while using the same normalized external-result and renderer pipeline as dice. Game-specific rules such as poker ranking, blackjack values, trump suits, hand limits, or draw phases remain in the consuming application.

## Imports

Use the dedicated SDK subpaths so headless deck state does not require browser renderer code:

```ts
import { createDeck, DraftrollDeck } from '@draftroll/sdk/deck';
import { createStandardDeck, standardPlayingCards } from '@draftroll/sdk/cards';
```

Use `Draftroll` from the root/browser SDK only when the draw also needs presentation:

```ts
import { Draftroll } from '@draftroll/sdk';
import { createStandardDeck } from '@draftroll/sdk/cards';

const draftroll = await Draftroll.createOverlay({
  overlay: { src: '/overlay.html' },
});
const deck = createStandardDeck();
const draw = deck.draw(3);
await draftroll.display(draw.toDisplayInput()).wait();
```

## Deterministic deck order

`shuffle: false` makes the card-definition order the public draw order. This is useful for tests, scripted encounters, tutorials, and applications that load an already-ordered deck:

```ts
const deck = createDeck(
  'scripted',
  [{ result: 'first' }, { result: 'second' }, { result: 'third' }],
  { shuffle: false },
);

console.log(deck.draw(2).cards.map((card) => card.result));
// ['first', 'second']
```

`remainingCards` uses that same draw order. `return(cards)` puts active cards back on top in caller order. Pass `{ shuffle: true }` when returning cards should randomize the remaining draw pile. `reset({ shuffle: false })` restores the original definition order.

For deterministic shuffles, inject a `random()` source that returns values in `[0, 1)`. Production shuffling uses unbiased WebCrypto sampling.

## State transitions

A physical card copy is always in exactly one deck state:

- draw pile
- active/in play
- discard pile

`draw()` moves cards from the draw pile to active state. `discard()` and `return()` validate every requested active card before mutating state, so invalid multi-card operations fail atomically. `reshuffleDiscard()` returns the discard pile and shuffles only when discarded cards exist. `reset()` restores every original card copy and clears active/discard state.

Internally, pile state stores lightweight face/copy references rather than full cloned card objects. Face definitions and metadata are retained once and cloned only when data crosses a public snapshot or display boundary. This keeps large duplicate-heavy decks bounded by card-reference storage instead of multiplying metadata by every pile transition.

## Copies and resource limits

Use `copies` to represent duplicate physical cards without repeating definitions:

```ts
const deck = createDeck(
  'tokens',
  [
    { result: 'success', value: 1, copies: 6 },
    { result: 'complication', value: -1, copies: 2 },
  ],
  { shuffle: false },
);
```

A deck may expand to at most 100,000 physical card copies. The constructor validates the cumulative copy count before allocating the reference list, preventing accidental or untrusted inputs from requesting pathological deck sizes.

The deck limit is intentionally separate from Draftroll protocol/display limits. A headless deck can be larger than one renderable roll. `Draftroll.display()` remains the authoritative protocol validation boundary and rejects display payloads that exceed runtime limits such as maximum dice, custom faces, or metadata size.

## Snapshot and metadata isolation

Deck definitions, returned card snapshots, and display payloads are detached from authoritative deck state. Metadata must be structured-cloneable.

Mutating a value returned by `deck.definition`, `remainingCards`, `discardedCards`, or `draw().cards` does not change the deck. `draw.toDisplayInput()` is built from the captured internal card references, not from caller-visible snapshots, so later snapshot mutations cannot alter the authoritative card results selected by the draw.

Likewise, each `toDisplayInput()` call returns fresh card metadata and a fresh custom-dice definition. Mutating one display payload does not affect a later conversion.

## Standard French-suited decks

`standardPlayingCards()` returns 52 system-agnostic French-suited definitions. Numeric values intentionally remain `0`; consuming games decide how ranks score.

```ts
const definitions = standardPlayingCards({ jokers: 2 });
const deck = createStandardDeck('table-deck', {
  jokers: 2,
  shuffle: true,
});
```

`jokers` accepts only `0`, `1`, or `2` and is validated at runtime as well as by TypeScript.

## Display conversion

A draw can be converted into exact external results without rerolling or re-evaluating the selected cards:

```ts
const draw = deck.draw(2);
const input = draw.toDisplayInput({
  name: 'Initiative cards',
  themeId: 'dragon',
  metadata: { round: 4 },
});

const response = draftroll.display(input);
await response.wait();
```

The generated display input includes the card face indices, physical copy indices, deck ID, detached custom-dice definition, and exact numeric total. The renderer recognizes the definition as `renderAs: 'card'` and uses the card fallback presentation rather than treating it as a physical polyhedral die.

`toDisplayInput()` constructs an exact display request; `Draftroll.display()` performs the normal protocol runtime validation before normalization and presentation. Keeping validation at that shared boundary avoids a second, drifting copy of protocol limits inside the deck implementation.
