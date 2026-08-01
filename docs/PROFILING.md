# Parser and evaluator profiling

Draftroll exposes optional instrumentation for diagnosing expensive formulas without changing normalized results or parser behavior. No profile clock or callback is used when instrumentation is absent.

## Enable profiling

Configure a default sink on `DiceEngine` or on a high-level `Draftroll` instance:

```ts
import { DiceEngine, type DiceProfile } from '@draftroll/core';

const profiles: DiceProfile[] = [];
const engine = new DiceEngine({
  instrumentation: {
    onProfile(profile) {
      profiles.push(profile);
    },
  },
});

engine.roll('20d20kh10 + 8d6e6');
```

The high-level SDK accepts the same option when it constructs its own engine:

```ts
const draftroll = new Draftroll({
  instrumentation: {
    onProfile(profile) {
      reportDiceProfile(profile);
    },
  },
});
```

`parse()`, `validate()`, `compile()`, `roll()`, and `evaluate()` also accept a per-call `instrumentation` option. A compiled expression retains the engine-level sink by default; a sink supplied to `compiled.roll()` takes precedence for that evaluation.

## Parse profiles

A `kind: "parse"` profile reports:

- `cache`: `hit`, `miss`, or `bypass`
- parser dialect and comment mode
- source and parsed-expression lengths
- AST node count and maximum depth
- dice-node count and initial-die count
- modifier and annotation counts
- duration and success/error status

Direct `parseDiceExpression()` calls report `cache: "bypass"`. Comment-enabled parsing and engines with a disabled cache also use `bypass`.

## Evaluation profiles

A `kind: "evaluate"` profile reports:

- `mode`: `expression` or `structured`
- initial, generated, and final result-die counts
- visited AST nodes for expression evaluation
- bounded evaluation work steps
- applied modifiers/structured operations
- reroll and explosion counts
- duration and success/error status

`generatedDice` excludes the initial pool. `evaluationSteps` is an internal work counter intended for relative profiling and limit diagnosis; it is not a stable substitute for AST or result semantics.

## Failed work

Parser and evaluator failures emit one final profile before the original error is returned or thrown. The profile includes the error name, message, and a stable code when the error exposes one.

```ts
const profiles: DiceProfile[] = [];
const engine = new DiceEngine({
  limits: { maxOperations: 20 },
  instrumentation: { onProfile: profile => profiles.push(profile) },
});

try {
  engine.roll(complexFormula);
} catch (error) {
  const failedEvaluation = profiles.find(
    profile => profile.kind === 'evaluate' && profile.status === 'error',
  );
  console.log(failedEvaluation?.evaluationSteps);
}
```

## Timing and observer isolation

`durationMs` uses `performance.now()` where available and otherwise uses `Date.now()`. Tests and specialized hosts can supply a monotonic `now()` function on the instrumentation object.

Exceptions thrown by `onProfile()` or the custom clock are isolated and cannot change parsing, evaluation, or the error originally produced by Draftroll.

Profiles omit the complete expression, normalized result, roll metadata, and die values. Error messages can still include an offending token, so applications should apply their normal telemetry redaction policy before forwarding profiles to a remote service.
