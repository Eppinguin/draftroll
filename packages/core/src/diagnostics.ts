/**
 * Stable diagnostic codes emitted by expression validation.
 *
 * @public
 */
export const DICE_DIAGNOSTIC_CODES = {
  emptyExpression: 'empty_expression',
  unexpectedToken: 'unexpected_token',
  expectedPrimary: 'expected_primary',
  expectedClosingParenthesis: 'expected_closing_parenthesis',
  expectedSetDelimiter: 'expected_set_delimiter',
  expectedDiceSides: 'expected_dice_sides',
  invalidDiceCount: 'invalid_dice_count',
  invalidDiceSides: 'invalid_dice_sides',
  expectedModifierCount: 'expected_modifier_count',
  expectedSelectorValue: 'expected_selector_value',
  expectedComparisonValue: 'expected_comparison_value',
  expectedModifierValue: 'expected_modifier_value',
  unterminatedAnnotation: 'unterminated_annotation',
  numberTooLarge: 'number_too_large',
  integerTooLarge: 'integer_too_large',
  expressionTooLong: 'expression_too_long',
  astDepthExceeded: 'ast_depth_exceeded',
  tooManyModifiers: 'too_many_modifiers',
  limitExceeded: 'limit_exceeded',
  unknownError: 'unknown_error',
} as const;

/**
 * Diagnostic codes emitted by expression validation.
 *
 * @public
 */
export type DiceDiagnosticCode = typeof DICE_DIAGNOSTIC_CODES[keyof typeof DICE_DIAGNOSTIC_CODES];

/**
 * One-based line and column plus zero-based source offset.
 *
 * @public
 */
export interface DiceSourcePosition {
  /** Zero-based UTF-16 source offset. */
  offset: number;
  /** One-based line number. */
  line: number;
  /** One-based column number. */
  column: number;
}

/**
 * Half-open source range associated with a diagnostic.
 *
 * @public
 */
export interface DiceSourceRange {
  /** Inclusive start position. */
  start: DiceSourcePosition;
  /** Exclusive end position. */
  end: DiceSourcePosition;
}

/**
 * Human-readable repair suggestion with an optional source edit.
 *
 * @public
 */
export interface DiceDiagnosticSuggestion {
  message: string;
  /** Replacement text for editors that support automated fixes. */
  replacement?: string;
  /** Source range to replace. Omitted for advisory suggestions. */
  range?: DiceSourceRange;
}

/**
 * Actionable parser or evaluator diagnostic with a source range.
 *
 * @public
 */
export interface DiceDiagnostic {
  code: DiceDiagnosticCode;
  severity: 'error';
  message: string;
  range: DiceSourceRange;
  suggestions: readonly DiceDiagnosticSuggestion[];
}

/**
 * Internal construction shape for a diagnostic suggestion.
 *
 * @public
 */
export interface DiceDiagnosticSuggestionSpec {
  message: string;
  replacement?: string;
  startOffset?: number;
  endOffset?: number;
}

/**
 * Creates a bounded source range with offsets and line-column positions.
 *
 * @public
 */
export function createDiceSourceRange(source: string, startOffset: number, endOffset = startOffset): DiceSourceRange {
  const start = Math.max(0, Math.trunc(startOffset));
  const end = Math.max(start, Math.trunc(endOffset));
  return {
    start: sourcePositionAt(source, start),
    end: sourcePositionAt(source, end),
  };
}

/**
 * Creates a structured dice diagnostic.
 *
 * @public
 */
export function createDiceDiagnostic(
  source: string,
  code: DiceDiagnosticCode,
  message: string,
  startOffset: number,
  endOffset = startOffset,
  suggestions: readonly DiceDiagnosticSuggestionSpec[] = [],
): DiceDiagnostic {
  return {
    code,
    severity: 'error',
    message,
    range: createDiceSourceRange(source, startOffset, endOffset),
    suggestions: suggestions.map((suggestion) => ({
      message: suggestion.message,
      ...(suggestion.replacement === undefined ? {} : { replacement: suggestion.replacement }),
      ...(suggestion.startOffset === undefined
        ? {}
        : { range: createDiceSourceRange(source, suggestion.startOffset, suggestion.endOffset ?? suggestion.startOffset) }),
    })),
  };
}

/**
 * Converts a parser or evaluator failure into a structured diagnostic.
 *
 * @public
 */
export function diceDiagnosticFromError(error: unknown, source = ''): DiceDiagnostic {
  if (hasDiceDiagnostic(error)) return error.diagnostic;
  const message = error instanceof Error ? error.message : String(error);
  return createDiceDiagnostic(source, DICE_DIAGNOSTIC_CODES.unknownError, message, 0, source.length);
}

function hasDiceDiagnostic(value: unknown): value is { diagnostic: DiceDiagnostic } {
  if (!value || typeof value !== 'object') return false;
  const diagnostic = (value as { diagnostic?: unknown }).diagnostic;
  if (!diagnostic || typeof diagnostic !== 'object') return false;
  const candidate = diagnostic as Partial<DiceDiagnostic>;
  return typeof candidate.code === 'string'
    && candidate.severity === 'error'
    && typeof candidate.message === 'string'
    && Boolean(candidate.range);
}

function sourcePositionAt(source: string, offset: number): DiceSourcePosition {
  const prefix = source.slice(0, offset);
  const lines = prefix.split(/\r\n|\r|\n/);
  return {
    offset,
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}
