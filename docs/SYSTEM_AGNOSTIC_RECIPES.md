# System-agnostic integration recipes

Draftroll does not encode game systems. The SDK exposes generic dice, custom faces, exact results, cards/decks, themes, semantic visual outcomes, and realtime primitives. A game integration composes those primitives in its own application layer.

## Duality-style dice

A game that rolls two differently interpreted d12s should keep that interpretation outside Draftroll:

```ts
const roll = draftroll.rollDice({
  dice: [
    dice.d12('duality-a', { metadata: { role: 'a' } }),
    dice.d12('duality-b', { metadata: { role: 'b' } }),
  ],
  render: false,
});

const [a, b] = roll.dice;
const gameOutcome =
  a.result === b.result
    ? { kind: 'critical', total: Number(a.result) + Number(b.result) }
    : Number(a.result) > Number(b.result)
      ? { kind: 'a', total: Number(a.result) + Number(b.result) }
      : { kind: 'b', total: Number(a.result) + Number(b.result) };
```

The application can then pass generic `positive`, `neutral`, or `negative` visual outcomes when presenting the result. Those meanings belong to the game integration; themes only decide how the generic outcome looks.

## Symbol dice

Use portable custom dice for symbols, repeated faces, or weighted outcomes. Keep symbol cancellation and game-specific reducers in application code.

```ts
const action = commonDice.symbolPool('action-die', [
  { result: 'success', value: 0, label: 'Success' },
  { result: 'advantage', value: 0, label: 'Advantage' },
  { result: 'blank', value: 0, label: 'Blank' },
]);
```

The SDK records exact face identity and metadata. The host decides what combinations mean.

## Stateful cards

`DraftrollDeck` owns generic shuffle, depletion, active-card, discard, return, and reset state. A draw converts to the normal exact-result boundary, so the renderer does not determine the card.

```ts
import { DraftrollDeck } from '@draftroll/sdk/deck';

const deck = new DraftrollDeck('conditions', [
  { result: 'clear', label: 'Clear' },
  { result: 'storm', label: 'Storm' },
  { result: 'omen', label: 'Omen', copies: 2 },
]);

const draw = deck.draw(1);
const presented = draftroll.display(draw.toDisplayInput({ name: 'Condition' }));
await presented.wait();
deck.discard(draw.cards);
```

Deck rules such as hand limits, reshuffle timing, trump suits, tarot reversals, or game-specific card effects remain outside the SDK.

## Design boundary

Generic mechanisms belong in Draftroll when they are reusable across unrelated systems. Named game rules, system-specific notation, reducers, success bands, character rules, and branded dice semantics belong in demos, adapters, or consuming applications.
