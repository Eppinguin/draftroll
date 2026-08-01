# Common nonstandard dice helpers

`@draftroll/sdk` exports `commonDice`, a set of optional factories that create ordinary portable `CustomDiceDefinition` objects. The factories do not introduce a separate execution path: definitions can be registered on a `Draftroll` or `DiceEngine` instance, or included inline in a structured/realtime request.

```ts
import { Draftroll, commonDice, dice } from '@draftroll/sdk/headless';

const coin = commonDice.coin();
const draftroll = new Draftroll();
draftroll.registerDie(coin);

const flip = draftroll.rollDice({
  dice: [dice.custom(coin.id, 'initiative-flip')],
  render: false,
});
```

Stable definition IDs and planned-die IDs retain the normal reroll, revision, theme, metadata, and realtime behavior.

## Coin

`commonDice.coin(id?, options?)` creates a two-face definition rendered as a coin. By default, heads contributes `1` and tails contributes `0`.

```ts
const loadedCoin = commonDice.coin('loaded-coin', {
  headsResult: 'H',
  tailsResult: 'T',
  headsWeight: 3,
  tailsWeight: 1,
  metadata: { name: 'Loaded coin' },
});
```

Result, numeric contribution, label, and integer weight can be customized independently for each side.

## Fate/Fudge die

`commonDice.fate(id?)` creates a six-face custom definition with two `-1`, two `0`, and two `+1` faces. Repeated face indexes are retained in normalized results.

For normal notation-free numeric Fate rolls, `dice.fate(id)` remains the smaller standard builder. The custom factory is useful when a portable definition, repeated physical face identity, or custom definition metadata is required.

## Percentile pair

`commonDice.percentilePair(id?)` creates one atomic 100-face custom definition. Each face contributes the correct value from `1` through `100` and includes the two displayed percentile digits in `faceMetadata`:

```ts
const percentile = commonDice.percentilePair();
const roll = draftroll.rollDice({
  customDice: [percentile],
  dice: [dice.custom(percentile.id, 'percentile-check')],
  render: false,
});

const { tensLabel, onesLabel } = roll.dice[0].faceMetadata ?? {};
```

The atomic representation avoids the ambiguous additive `00 + 0 = 0` case: the `00 / 0` face has result and numeric value `100`. Metadata also includes numeric `tens`, `ones`, and `percentile` fields. Rendering uses the percentile fallback.

Use `dice.percentile(id)` when the two digit identities are not needed.

## Symbol pools

`commonDice.symbolPool(id, faces, options?)` creates a token-rendered symbolic definition. Faces may be primitive numbers/strings or full face objects.

```ts
const narrative = commonDice.symbolPool('narrative', [
  'blank',
  { result: 'success', value: 1, weight: 2, label: 'Success' },
  { result: 'complication', value: -1, label: 'Complication' },
]);
```

Primitive numeric faces contribute their number. Primitive string faces contribute `0`. Full objects can define `value`, `weight`, `label`, and face metadata. `commonDice.symbols` is a terse alias.

## Table and card draws

`commonDice.tableDraw()` and `commonDice.cardDraw()` create weighted definitions rendered as a spinner or card respectively.

```ts
const encounter = commonDice.tableDraw('encounter', [
  { result: 'quiet', weight: 3 },
  { result: 'ambush', value: -1, weight: 1 },
]);

const deck = commonDice.cardDraw('minor-deck', [
  { result: 'sun', label: 'The Sun', metadata: { suit: 'major' } },
  { result: 'moon', label: 'The Moon', metadata: { suit: 'major' } },
]);
```

These helpers perform independent weighted draws **with replacement**, matching the custom-die evaluator. Stateful deck behavior—shuffle order, depletion, discard piles, and draws without replacement—belongs to the host application. The host can submit the chosen card as an exact structured or external result while retaining the same definition for labels and rendering.

`commonDice.table` and `commonDice.cards` are terse aliases.

## Portable realtime requests

Definitions can be sent inline so the room server and later revisions do not depend on process-local registration:

```ts
const symbols = commonDice.symbolPool('action', [
  { result: 'success', value: 1, weight: 2 },
  { result: 'blank', value: 0, weight: 3 },
]);

await room.roll({
  mode: 'evaluate',
  customDice: [symbols],
  dice: [
    dice.custom(symbols.id, 'action-1'),
    dice.custom(symbols.id, 'action-2'),
  ],
});
```

Factory outputs are plain JSON-serializable protocol definitions. The helpers validate non-empty IDs, non-empty face sets, finite numeric values/results, and positive safe-integer weights before the request is evaluated.
