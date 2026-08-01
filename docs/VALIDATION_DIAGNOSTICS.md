# Expression validation diagnostics

`DiceEngine.validate()` and `Draftroll.validate()` return editor-friendly diagnostics without requiring exception-based control flow.

```ts
const validation = draftroll.validate('2d20kh');

if (!validation.valid) {
  const diagnostic = validation.diagnostics[0];
  console.log(diagnostic.code);               // expected_modifier_count
  console.log(diagnostic.range.start.offset); // 7
  console.log(diagnostic.suggestions[0]);
}
```

The existing `valid`, `parsed`, and `error` fields remain available. `diagnostics` is always present: it is empty for a valid expression and currently contains the first fail-fast parser error for an invalid expression.

## Diagnostic shape

```ts
interface DiceDiagnostic {
  code: DiceDiagnosticCode;
  severity: 'error';
  message: string;
  range: DiceSourceRange;
  suggestions: readonly DiceDiagnosticSuggestion[];
}
```

Source offsets are zero-based UTF-16 offsets. Lines and columns are one-based. Ranges are half-open: `start` is inclusive and `end` is exclusive. Positions refer to the original source string, including leading whitespace and line breaks.

A suggestion can be advisory or editor-applicable:

```ts
interface DiceDiagnosticSuggestion {
  message: string;
  replacement?: string;
  range?: DiceSourceRange;
}
```

When both `replacement` and `range` are present, an editor can apply the suggestion with:

```ts
const fixed = source.slice(0, suggestion.range.start.offset)
  + suggestion.replacement
  + source.slice(suggestion.range.end.offset);
```

Suggestions are intended as safe local repairs, not as a guarantee that every resulting expression matches the user's game rule intent.

## Stable codes

Import `DICE_DIAGNOSTIC_CODES` instead of comparing undocumented parser messages.

| Code | Meaning |
|---|---|
| `empty_expression` | No expression was supplied. |
| `unexpected_token` | Valid parsing stopped before an unsupported token. |
| `expected_primary` | A number, die, set, or parenthesized expression was required. |
| `expected_closing_parenthesis` | A parenthesized expression needs `)` or can become a set with `,`. |
| `expected_set_delimiter` | A set needs `,` between values or `)` at the end. |
| `expected_dice_sides` | `d` was not followed by a positive integer, `%`, or `F`. |
| `invalid_dice_count` | A dice count was not a non-negative whole number. |
| `invalid_dice_sides` | Numeric dice had fewer than one side. |
| `expected_modifier_count` | A keep/drop highest/lowest modifier needs a count. |
| `expected_selector_value` | A selector modifier needs a literal or comparison value. |
| `expected_comparison_value` | A comparison operator needs a numeric target. |
| `expected_modifier_value` | A minimum or maximum modifier needs a numeric value. |
| `unterminated_annotation` | `[` was not closed with `]`. |
| `number_too_large` | A numeric literal is not finite. |
| `integer_too_large` | An integer exceeds JavaScript safe-integer precision. |
| `expression_too_long` | The configured expression-length limit was exceeded. |
| `ast_depth_exceeded` | The configured parser nesting-depth limit was exceeded. |
| `too_many_modifiers` | The configured modifier-count limit was exceeded. |
| `limit_exceeded` | A non-parser evaluation or structured-roll limit was exceeded. |
| `unknown_error` | A non-parser error was normalized into the validation result. |

The string values are the compatibility surface. New codes may be added; existing meanings should not be repurposed.

## Thrown syntax errors

`parse()`, `compile()`, and `roll()` still throw `DiceSyntaxError` for malformed expressions. Configured expression, AST-depth, and modifier limits continue to throw `DiceLimitError`. The error exposes the same data for applications that prefer exceptions:

```ts
try {
  engine.parse('2d6kh');
} catch (error) {
  if (error instanceof DiceSyntaxError) {
    console.log(error.code);
    console.log(error.range);
    console.log(error.suggestions);
    console.log(error.diagnostic);
  }
}
```

The legacy `offset` field and human-readable error message remain available.

## Regression test

```bash
pnpm test:diagnostics
```

The test verifies stable codes, leading-whitespace and multiline positions, half-open ranges, applicable repair suggestions, parser limits, thrown-error parity, and the high-level SDK passthrough.
