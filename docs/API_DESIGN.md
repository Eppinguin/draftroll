# Developer-friendly API design

Draftroll exposes four layers so integrations can choose the smallest useful surface.

## 1. Expression rolls

Use this when a game already represents rolls as notation.

```ts
const roll = draftroll.roll('2d20kh1 + 7 [Attack]');
await roll.wait();
```

For user-entered text, use `validate()` or `tryRoll()` instead of exception-driven UI code. Validation returns stable diagnostic codes, original-source ranges, and repair suggestions. Use `compile()` for formulas executed repeatedly in a hot path.

```ts
const validation = draftroll.validate('2d20kh');
if (!validation.valid) {
  const issue = validation.diagnostics[0];
  showFormulaError(issue.code, issue.range, issue.suggestions);
}
```

See [Expression validation diagnostics](VALIDATION_DIAGNOSTICS.md).

For expensive or user-generated formulas, attach optional instrumentation to collect parser-cache, AST-complexity, evaluator-work, generated-die, reroll, explosion, and timing profiles without changing roll behavior.

```ts
const draftroll = new Draftroll({
  instrumentation: {
    onProfile(profile) {
      console.debug(profile.kind, profile.durationMs, profile.status);
    },
  },
});
```

See [Parser and evaluator profiling](PROFILING.md).

## 2. Structured rolls

Use this when the game owns its rules model and should not construct notation strings.

```ts
import { dice, op, select } from '@draftroll/sdk';

const roll = draftroll.rollDice({
  dice: [
    dice.d10('skill_1'),
    dice.d10('skill_2'),
    dice.d10('skill_3'),
  ],
  operations: [
    op.rerollOnce(select.equal(1)),
    op.countSuccesses(select.greaterOrEqual(7)),
  ],
  metadata: { system: 'example-pool' },
});
```

Every die has a stable ID. IDs are used for per-die themes, scoped operations, individual rerolls, corrections, and audit history.

## 3. Exact external results

Use `display()` when another rules engine is authoritative. Draftroll will not replace the supplied values.

```ts
const roll = draftroll.display({
  dice: [{ id: 'attack', type: 'd20', result: 17 }],
  total: 17,
});
```

## 4. Revisions and roll handles

Every SDK call returns a stable roll handle instead of only a number.

```ts
roll.total;
roll.dice;
roll.rerollDie('attack');
roll.updateLog({ annotation: 'GM correction' });
roll.animateUpdate({ dice: [{ id: 'attack', result: 20 }] });
```

The handle retains a logical roll ID. Updates replace the current log entry and append an immutable revision snapshot.

## Custom game dice

Register weighted, symbolic, or table-driven dice once, then use them like numeric dice in structured pools.

```ts
draftroll.registerDie({
  id: 'narrative',
  faces: [
    { result: 'success', value: 1, weight: 2 },
    { result: 'complication', value: -1, weight: 1 },
    { result: 'blank', value: 0, weight: 3 },
  ],
});
```

Custom dice support repeated faces by `faceIndex`, keep/drop, all reroll forms, explosions, min/max, success counting, per-die themes, individual rerolls, and revisions. For server-authoritative or portable requests, pass definitions in `customDice` on the structured input; the normalized result retains them for future rerolls and revisions. The optional `commonDice` factories create portable coin, Fate, atomic percentile-pair, symbol-pool, and weighted card/table definitions. The renderer automatically uses a synchronized coin, percentile, Fate, spinner, token, or card fallback when no matching rigid-body mesh exists. Applications do not need to detect or split unsupported dice themselves. See [Common nonstandard dice helpers](COMMON_DICE.md).

## Design rules

- Rules, rendering, networking, themes, and persistence remain separate.
- Normalized results are JSON-serializable and are the boundary between layers.
- Local and headless use does not require the DOM, a backend, an account, or an API key.
- Convenience factories are optional; plain protocol objects remain supported.
- Host applications own system-specific concepts such as character stats, damage types, permissions, and critical rules beyond the generic d20 classification.
