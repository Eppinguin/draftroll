# Python d20 compatibility version matrix

Draftroll's exact compatibility baseline is Python `d20` 1.1.2. The frozen compatibility corpus is executed by `scripts/test-d20-compat.mjs`; repository changes must update both this matrix and that corpus.

| Upstream version | Draftroll status | Notes |
| --- | --- | --- |
| 1.1.2 | Supported syntax/API behavior | Arithmetic, sets, selectors, keep/drop, reroll families, explode, min/max, comparison, comments, annotations, advantage/disadvantage, critical classification, execution limits, AST/result traversal, and stringification are covered. |
| 1.0.x | Covered by the 1.1.2 language baseline | No separate Draftroll dialect is required for the syntax represented in the corpus. |
| 0.x | Not a supported compatibility target | Historical behavior is not frozen; use the documented Draftroll/d20 dialect instead. |

## Intentional differences

- Draftroll returns immutable, JSON-serializable normalized results rather than mutable Python object graphs.
- `total` preserves decimal values; `integerTotal` exposes truncation-toward-zero compatibility.
- Exact d20 dialect comparisons evaluate the complete left expression and return `0` or `1`.
- Success counting is explicit with `cs` or `count`.
- The optional `draftroll` dialect retains the earlier postfix success-count shorthand.
- Fate dice, `<=`/`>=`/`!=` selectors, structured dice, weighted/symbolic dice, external exact results, revisions, and renderer metadata are Draftroll extensions.
- Python exception/class identity and mutable Python internals are intentionally outside the compatibility boundary.

## Upstream review process

For a new upstream release:

1. Record the version and release date in this matrix.
2. Diff the upstream grammar, lexer, evaluator, limits, and stringifier behavior.
3. Add representative fixtures for every changed syntax or semantic rule.
4. Mark the row supported only after deterministic tests pass.
5. Document intentional deviations rather than silently accepting changed behavior.
