# d20 compatibility

Draftroll implements the documented expression language and developer-facing behavior of the Python `d20` dice engine in TypeScript. The core package has no Python, DOM, renderer, network, or backend dependency.

## Supported syntax

| Area                         | Syntax                                | Examples                            |
| ---------------------------- | ------------------------------------- | ----------------------------------- |
| Integer and decimal literals | `INT`, `DECIMAL`                      | `1`, `0.5`, `3.14`                  |
| Numeric dice                 | `INT?dINT`                            | `d20`, `3d6`, `d1`, `0d6`, `2d1000` |
| Percentile dice              | `d%`                                  | `2d%`                               |
| Fate/Fudge extension         | `dF`                                  | `4dF`                               |
| Sets                         | `(value, ...)`                        | `()`, `(2,)`, `(1, 3+3, 1d20)`      |
| Keep                         | `k selector`                          | `4d6kh3`, `4d6k3`, `(1,2,3)kh1`     |
| Drop                         | `p selector`                          | `4d6pl1`, `4d6p<3`                  |
| Drop aliases                 | `dh`, `dl`                            | `4d6dl1`                            |
| Reroll until clear           | `rr selector`                         | `2d6rr<3`                           |
| Reroll once                  | `ro selector`                         | `2d6ro<3`                           |
| Reroll and add               | `ra selector`                         | `2d6ra1`                            |
| Explode                      | `e` or `e selector`                   | `2d4e`, `2d6e6`, `4d6e>=5`          |
| Minimum / maximum            | `mi`, `ma`                            | `8d6mi2`, `2d20ma10`                |
| Selectors                    | literal, highest, lowest, comparisons | `3`, `h2`, `l1`, `>4`, `<3`         |
| Unary operations             | `+`, `-`                              | `-1d8`, `+(2d6)`                    |
| Arithmetic                   | `+ - * / // %`                        | `(1d20+5)*2`, `7//2`                |
| Comparisons                  | `== = != < <= > >=`                   | `1d20+5 >= 15`                      |
| Inline annotations           | `[text]`                              | `3d6 [fire] + 1d4 [piercing]`       |
| Trailing comments            | free-form with `allowComments`        | `1d20 attack check`                 |
| Advantage / disadvantage     | roll option                           | `{ advantage: "advantage" }`        |

Draftroll also supports comparison selectors with `<=`, `>=`, and `!=`, arbitrary numeric dice, Fate dice, and explicit success counting.

Bare `e` explodes on the die's maximum face. For example, `2d4e` first rolls two d4s and adds one follow-up d4 for each landed 4. Explosions recurse one landed wave at a time. An explicit selector such as `e3` or `e>=5` overrides the maximum-face default.

Rerolls retain the discarded result in the normalized dice list with `kept: false`, then add a replacement die with `generatedBy: "reroll"`. The replacement is not sampled from a restricted range: `2d6ro<3` can visibly land on 1 or 2 first, then rolls exactly one replacement for each matching die.

During staged presentation, every earlier physical or fallback result remains on the table. Formula rerolls and explosions append one causal wave after the previous wave settles, and individual SDK rerolls append a uniquely identified replacement while retaining prior reroll history. The complete total is revealed only after the final required wave.

## d20 and Draftroll dialects

The default dialect is `d20`. In this dialect, a comparison is a binary comparison of the complete left and right values:

```ts
engine.roll('8d6 >= 5'); // total is 0 or 1
```

Success counting is explicit and therefore unambiguous:

```ts
engine.roll('8d6cs>=5');
engine.roll('8d6count>=5');
```

The original Draftroll task used a postfix comparison as success-count shorthand. That behavior remains available:

```ts
engine.roll('8d6>=5', { dialect: 'draftroll' });
```

## Compatibility boundary

Draftroll targets the documented d20 expression language and the developer capabilities that matter to a TypeScript SDK: parsing, evaluation, execution limits, advantage/disadvantage, critical classification, comments, AST/result trees, traversal, caching, reusable compiled expressions, and custom stringification. It does not attempt to reproduce Python class identity or mutable Python object behavior. Draftroll returns JSON-serializable normalized results instead.

## Basic API

```ts
import { DiceEngine } from '@draftroll/core';

const engine = new DiceEngine();
const result = engine.roll('4d6kh3 + 2');

console.log(result.total); // exact number
console.log(result.integerTotal); // truncated-toward-zero d20-compatible total
console.log(result.dice);
console.log(result.operations);
console.log(result.tree);
```

## Advantage, disadvantage, and critical results

```ts
const result = engine.roll('1d20 + 7', {
  advantage: 'advantage',
});

console.log(result.critical);
// "none" | "critical-success" | "critical-failure"
```

Advantage and disadvantage rewrite the leftmost `1d20` to a two-die keep-highest or keep-lowest roll, matching d20 behavior.

## Parse, validate, and compile

```ts
const validation = engine.validate('2d20kh1+5');
if (!validation.valid) {
  console.error(validation.diagnostics[0].code, validation.diagnostics[0].range);
}

const parsed = engine.parse('2d20kh1+5');
console.log(parsed.ast);

const attack = engine.compile('2d20kh1+5');
const first = attack.roll();
const second = attack.roll();
```

The engine caches up to 256 parsed expressions by default. Expressions with free-form comments bypass the cache. The cache size is configurable.

Optional instrumentation reports parser cache hits/misses/bypasses, AST size/depth, initial dice and modifiers, evaluator work, generated dice, rerolls, explosions, duration, and failures. It is available on the engine, individual calls, and compiled-roll evaluations. See [Parser and evaluator profiling](PROFILING.md).

## SDK facade equivalents

The same common operations are available without reaching through to `draftroll.engine`:

```ts
const parsed = draftroll.compile('2d20kh1+5');
const validation = draftroll.validate('2d20kh1+5'); // includes stable diagnostics on failure
const roll = draftroll.roll({ expression: '2d20kh1+5', render: false });
const text = draftroll.format(roll);
```

Custom dice can be registered directly with `draftroll.registerDie(definition)` and then used by `rollDice()`.

## Result tree traversal

```ts
import { filterRollNodes, walkRollTree } from '@draftroll/core';

walkRollTree(result.tree!, (node, parent) => {
  console.log(node.kind, node.value, parent?.kind);
});

const diceNodes = filterRollNodes(result.tree!, (node) => node.kind === 'dice');
```

The normalized dice array remains the renderer boundary. The evaluated tree is available to rules engines, formatters, audit tools, and game-specific UI.

## Formatting and custom stringifiers

```ts
import { formatRollResult } from '@draftroll/core';

formatRollResult(result, { style: 'plain' });
formatRollResult(result, { style: 'markdown' });

engine.stringify(result, (current) => {
  return `${current.expression}: ${current.total}`;
});
```

## Registered custom dice

Structured rolls can use weighted or symbolic faces while still participating in totals, keep/drop, reroll-until-clear, reroll-once, reroll-and-add, recursive explosions, minimum/maximum, success counting, revision history, and individual rerolls. The SDK also exports `commonDice` factories for coins, six-face Fate dice, atomic percentile-pair results, symbol pools, and weighted card/table draws. See [Common nonstandard dice helpers](COMMON_DICE.md).

```ts
const engine = new DiceEngine({
  customDice: [
    {
      id: 'weather',
      faces: [
        { result: 'sun', value: 2, weight: 1, label: 'Clear' },
        { result: 'rain', value: 0, weight: 2, label: 'Rain' },
      ],
    },
  ],
});

const result = engine.evaluate({
  mode: 'evaluate',
  dice: [
    { id: 'weather_1', type: 'weather', customDiceId: 'weather' },
    { id: 'weather_2', type: 'weather', customDiceId: 'weather' },
  ],
});
```

A symbolic face uses `value` for arithmetic and selectors. If omitted, numeric results contribute their numeric result and symbolic results contribute `0`. Repeated faces are supported: use `faceIndex` when an exact input or correction must distinguish two faces with the same `result`. Normalized dice expose `faceIndex`, `faceLabel`, and separate `faceMetadata`.

## Structured operation parity

The notation-free evaluator supports the same operation families as the expression evaluator. Operations may target the whole pool or stable source-die IDs. Generated rerolls and explosions remain attached to their source die, so later operations, revisions, and individual rerolls can rebuild the pool correctly.

```ts
import { dice, operations as op, selectors as select } from '@draftroll/sdk';

const result = draftroll.rollDice({
  dice: [
    dice.custom('action', 'action_1', { themeId: 'ember' }),
    dice.custom('action', 'action_2', { themeId: 'frost' }),
  ],
  operations: [
    op.rerollOnce(select.equal(0)),
    op.explode(select.greaterOrEqual(2)),
    op.countSuccesses(select.greaterOrEqual(1)),
  ],
  render: false,
});
```

The exported `dice`, `selectors`/`select`, and `operations`/`op` factories are optional. Plain protocol objects remain supported for adapters that already have their own schema. Custom definitions may be registered on a local engine or included inline in a structured input. Inline definitions are copied into the normalized result so an anonymous room server can reroll or revise the result later without an account-scoped registry.

## Intentional extensions and differences

- `result.total` preserves decimals. `result.integerTotal` provides the d20-style integer total.
- Fate/Fudge dice are supported as an extension.
- Selector forms `<=`, `>=`, and `!=` are supported as extensions.
- Success counting uses explicit `cs`/`count` syntax in the exact d20 dialect.
- Normalized results are JSON-serializable and renderer-oriented rather than Python object graphs.
