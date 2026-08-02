# Revising completed rolls

Draftroll treats a completed roll as a revisionable log entry. A revision keeps the same `rollId`, `sequence`, and original `createdAt`, increments `revision`, and records `updatedAt`.

This supports corrections and game-state changes without forcing every update to replay the 3D dice.

## Two presentation modes

- `mode: "log-only"` updates the SDK log and built-in result panel without replaying the physical dice. This is the default for `update()` and `updateRoll()`.
- `mode: "animate"` physically rolls the revised result and lands on its new authoritative values.

The calculation and presentation choices are separate. An exact manual correction can still be animated, while a formula recalculation can be written to the log without animation.

## Correct a die without animation

```ts
const original = draftroll.roll('2d20kh1+5');
await original.presentation;

const corrected = original.update({
  dice: [{ id: 'die_1', result: 20, themeId: 'ember' }],
  annotation: 'Corrected by the GM',
});

await corrected.presentation;
```

The result panel changes immediately. No 3D replay occurs.

## Correct a die and animate the revised roll

```ts
const corrected = original.update(
  {
    dice: [{ id: 'die_1', result: 20 }],
  },
  {
    mode: 'animate',
    animateDice: 'changed',
  },
);

await corrected.presentation;
```

`animateDice` accepts:

- `"all"`: replay the whole revised roll; this is the animate-mode default.
- `"changed"`: throw dice whose value, type, or theme changed.
- An array of normalized die IDs.

## Change only the formula and preserve values

```ts
const revised = original.update({
  expression: '2d20kh1+7 [Revised attack bonus]',
});
```

Compatible initial values are preserved by normalized die ID and the expression is evaluated again. Keep/drop state, success counting, arithmetic, minimum/maximum, rerolls, and explosions are recalculated.

Changing a formula modifier should be done by changing the expression. `modifier` patches are for structured rolls without an active expression.

## Replace the formula and reroll everything

```ts
const revised = original.update(
  {
    expression: '3d20kh1+7 [Revised attack]',
  },
  {
    mode: 'animate',
    reroll: true,
    themes: ['dragon', 'frost', 'ember'],
  },
);
```

When a formula adds dice, Draftroll does not silently invent values during a preserve-only correction. Supply explicit results, list the new IDs in `reroll`, set `reroll: true`, or opt into `allowGenerateMissing: true`.

## Reroll selected values while changing the formula

```ts
const revised = original.update(
  {
    expression: '3d20kh1+5',
  },
  {
    reroll: ['die_2', 'die_3'],
    mode: 'animate',
    animateDice: ['die_2', 'die_3'],
  },
);
```

Unlisted compatible dice retain their previous values.

## Add or remove dice in a structured or external roll

```ts
const revised = external.update({
  removeDice: ['damage_old'],
  dice: [
    { id: 'attack', result: 18 },
    { id: 'damage_new', type: 'd8', result: 7, themeId: 'steel' },
  ],
});
```

For expression rolls, change the expression instead of using `removeDice` or overriding die type, sides, or kept state.

## Explicit total overrides

```ts
const revised = original.update({
  dice: [{ id: 'die_1', result: 17 }],
  total: 25,
  metadata: { reason: 'table rule adjustment' },
});
```

An explicit total is accepted even when it differs from the formula-derived total. This is intentional for host-owned rules, manual adjudication, and imported results. The authority field is preserved unless the caller explicitly changes it through the lower-level engine options.

## SDK log and revision history

```ts
const rollId = revised.result.rollId!;

const current = draftroll.getRoll(rollId);
const currentLog = draftroll.rollLog;
const auditTrail = draftroll.getRollRevisions(rollId);
```

`rollLog` contains one current entry per roll. `getRollRevisions()` contains immutable snapshots from revision `0` through the latest known revision.

## Realtime room updates

```ts
await room.updateRoll(
  rollId,
  {
    dice: [{ id: 'die_1', result: 20 }],
    annotation: 'Server-validated correction',
  },
  {
    animate: false,
  },
);
```

Set `animate: true` for a synchronized room replay. The Durable Object validates and recalculates the revision, broadcasts `roll_updated`, replaces the current D1 history row, and appends an audit snapshot to `roll_revisions`.

Connected updates preserve the roll sequence number. They do not create a second roll entry.

## Error behavior

Draftroll rejects ambiguous or inconsistent updates, including:

- formula-added dice without explicit values or reroll permission
- direct value changes to modifier-generated reroll/explosion dice
- type, side, or kept-state overrides while an expression is active
- removing dice while an expression is active
- unknown die IDs
- structured reroll/explosion operations without an evaluable expression unless an explicit total is supplied
