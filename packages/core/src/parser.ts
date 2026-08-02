import { DraftrollError } from '../../errors/src/index';
import type { ComparisonOperator, DiceDialect } from '../../protocol/src/index';
import type {
  AstNode,
  BinaryOperator,
  ParsedExpression,
  SetOperation,
  SetOperationType,
  SetSelector,
} from './ast';
import {
  DICE_DIAGNOSTIC_CODES,
  createDiceDiagnostic,
  type DiceDiagnostic,
  type DiceDiagnosticCode,
  type DiceDiagnosticSuggestion,
  type DiceDiagnosticSuggestionSpec,
  type DiceSourceRange,
} from './diagnostics';
import { profileParse } from './instrumentation-internal';
import type { DiceInstrumentationOptions } from './instrumentation';
import { DEFAULT_LIMITS, DiceLimitError, type DiceExecutionLimits } from './limits';

/**
 * Source and diagnostic context for a syntax failure.
 *
 * @public
 */
export interface DiceSyntaxErrorOptions {
  code?: DiceDiagnosticCode;
  endOffset?: number;
  source?: string;
  suggestions?: readonly DiceDiagnosticSuggestionSpec[];
}

/**
 * Parser error with source-relative diagnostic metadata.
 *
 * @public
 */
export class DiceSyntaxError extends DraftrollError {
  readonly code: DiceDiagnosticCode;
  readonly endOffset: number;
  readonly range: DiceSourceRange;
  readonly suggestions: readonly DiceDiagnosticSuggestion[];
  readonly diagnostic: DiceDiagnostic;

  /**
   * Creates a DiceSyntaxError instance.
   */
  constructor(
    message: string,
    public readonly offset: number,
    options: DiceSyntaxErrorOptions = {},
  ) {
    super(
      options.code ?? DICE_DIAGNOSTIC_CODES.unexpectedToken,
      `${message} at character ${offset + 1}`,
      {
        package: 'core',
        recoverable: true,
        details: { offset, endOffset: options.endOffset ?? offset },
      },
    );
    this.name = 'DiceSyntaxError';
    this.code = options.code ?? DICE_DIAGNOSTIC_CODES.unexpectedToken;
    this.endOffset = options.endOffset ?? offset;
    this.diagnostic = createDiceDiagnostic(
      options.source ?? '',
      this.code,
      message,
      offset,
      this.endOffset,
      options.suggestions,
    );
    this.range = this.diagnostic.range;
    this.suggestions = this.diagnostic.suggestions;
  }
}

/**
 * Parser dialect, comment, and instrumentation options.
 *
 * @public
 */
export interface ParseDiceOptions extends DiceInstrumentationOptions {
  allowComments?: boolean;
  dialect?: DiceDialect;
}

/**
 * Parses a dice expression into a source-aware abstract syntax tree.
 *
 * @param source - Original expression, including any permitted trailing comment.
 * @param limits - Execution limits applied while tokenizing and constructing the AST.
 * @param options - Dialect, comment, and profiling controls.
 * @returns A parsed expression whose source ranges refer to the original string.
 * @throws {@link DiceSyntaxError} when syntax is invalid.
 * @throws {@link DiceLimitError} when a parser limit is exceeded.
 *
 * @public
 */
export function parseDiceExpression(
  source: string,
  limits: DiceExecutionLimits = DEFAULT_LIMITS,
  options: ParseDiceOptions = {},
): ParsedExpression {
  const dialect = options.dialect ?? 'd20';
  const allowComments = options.allowComments ?? false;
  return profileParse(
    options.instrumentation,
    { source, dialect, allowComments, cache: 'bypass' },
    () => {
      if (source.length > limits.maxExpressionLength) {
        throw new DiceLimitError(`Expression exceeds ${limits.maxExpressionLength} characters`, {
          code: DICE_DIAGNOSTIC_CODES.expressionTooLong,
          startOffset: limits.maxExpressionLength,
          endOffset: source.length,
          source,
          suggestions: [
            {
              message: `Shorten the expression to ${limits.maxExpressionLength} characters or fewer.`,
            },
          ],
        });
      }

      const input = source.trimStart();
      const sourceOffset = source.length - input.length;
      if (!input) {
        throw new DiceSyntaxError('Expression is empty', 0, {
          code: DICE_DIAGNOSTIC_CODES.emptyExpression,
          endOffset: source.length,
          source,
          suggestions: [{ message: 'Enter a dice expression, for example 1d20 + 5.' }],
        });
      }

      const parser = new Parser(source, input, sourceOffset, limits, dialect);
      const { ast, expressionEnd } = parser.parse(allowComments);
      const expression = input.slice(0, expressionEnd).trimEnd();
      const commentText = input.slice(expressionEnd).trim();
      const comment = commentText || null;
      const annotation = ast.annotations.length > 0 ? ast.annotations.join(' ') : null;

      return {
        source,
        expression,
        annotation,
        comment,
        ast,
        dialect,
      };
    },
  );
}

class Parser {
  private offset = 0;
  private depth = 0;
  private modifierCount = 0;

  constructor(
    private readonly source: string,
    private readonly input: string,
    private readonly sourceOffset: number,
    private readonly limits: DiceExecutionLimits,
    private readonly dialect: DiceDialect,
  ) {}

  parse(allowComments: boolean): { ast: AstNode; expressionEnd: number } {
    const ast = this.parseComparison();
    this.skipWhitespace();
    const expressionEnd = this.offset;
    if (!this.isEnd() && !allowComments) {
      throw this.error(
        `Unexpected token '${this.peek()}'`,
        DICE_DIAGNOSTIC_CODES.unexpectedToken,
        this.offset,
        this.offset + 1,
        [
          {
            message:
              'Remove the unexpected token, or enable trailing comments when the remaining text is a comment.',
          },
        ],
      );
    }
    return { ast, expressionEnd };
  }

  private parseComparison(): AstNode {
    return this.withDepth(() => {
      let node = this.parseAdditive();
      while (true) {
        this.skipWhitespace();
        const operator = this.tryReadBinaryComparison();
        if (!operator) break;
        node = {
          type: 'binary',
          operator,
          left: node,
          right: this.parseAdditive(),
          annotations: [],
        };
      }
      return node;
    });
  }

  private parseAdditive(): AstNode {
    return this.withDepth(() => {
      let node = this.parseMultiplicative();
      while (true) {
        this.skipWhitespace();
        const operator = this.peek();
        if (operator !== '+' && operator !== '-') break;
        this.offset += 1;
        node = {
          type: 'binary',
          operator,
          left: node,
          right: this.parseMultiplicative(),
          annotations: [],
        };
      }
      return node;
    });
  }

  private parseMultiplicative(): AstNode {
    return this.withDepth(() => {
      let node = this.parseUnary();
      while (true) {
        this.skipWhitespace();
        let operator: BinaryOperator | null = null;
        if (this.input.startsWith('//', this.offset)) {
          operator = '//';
          this.offset += 2;
        } else {
          const candidate = this.peek();
          if (candidate === '*' || candidate === '/' || candidate === '%') {
            operator = candidate;
            this.offset += 1;
          }
        }
        if (!operator) break;
        node = {
          type: 'binary',
          operator,
          left: node,
          right: this.parseUnary(),
          annotations: [],
        };
      }
      return node;
    });
  }

  private parseUnary(): AstNode {
    this.skipWhitespace();
    const operator = this.peek();
    if (operator === '+' || operator === '-') {
      this.offset += 1;
      return {
        type: 'unary',
        operator,
        operand: this.parseUnary(),
        annotations: [],
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): AstNode {
    return this.withDepth(() => {
      this.skipWhitespace();
      let node: AstNode;

      if (this.consume('(')) {
        node = this.parseParentheticalOrSet();
      } else {
        const start = this.offset;
        const leading = this.readNumberOptional();
        this.skipWhitespace();
        if (this.peek().toLowerCase() === 'd') {
          const diceMarker = this.offset;
          this.offset += 1;
          this.skipWhitespace();
          let sides: number | 'F';
          let percentile = false;
          const sidesStart = this.offset;
          if (this.peek() === '%') {
            this.offset += 1;
            sides = 100;
            percentile = true;
          } else if (this.peek().toLowerCase() === 'f') {
            this.offset += 1;
            sides = 'F';
          } else {
            sides = this.readRequiredInteger(
              'Expected dice sides',
              DICE_DIAGNOSTIC_CODES.expectedDiceSides,
              [{ message: 'Add a positive integer, %, or F after d.' }],
            );
          }
          const count = leading ?? 1;
          if (!Number.isSafeInteger(count) || count < 0) {
            throw this.error(
              'Dice count must be a non-negative integer',
              DICE_DIAGNOSTIC_CODES.invalidDiceCount,
              start,
              diceMarker,
              [{ message: 'Use a whole-number dice count, for example 2d6.' }],
            );
          }
          if (sides !== 'F' && sides < 1) {
            throw this.error(
              'Dice sides must be at least 1',
              DICE_DIAGNOSTIC_CODES.invalidDiceSides,
              sidesStart,
              this.offset,
              [{ message: 'Use at least one side, for example d6.' }],
            );
          }
          node = {
            type: 'dice',
            count,
            sides,
            percentile,
            modifiers: [],
            annotations: [],
          };
        } else if (leading !== null) {
          node = { type: 'number', value: leading, annotations: [] };
        } else {
          throw this.error(
            'Expected a number, die, set, or parenthesized expression',
            DICE_DIAGNOSTIC_CODES.expectedPrimary,
            this.offset,
            this.isEnd() ? this.offset : this.offset + 1,
            [{ message: 'Add a number, die, set, or parenthesized expression.' }],
          );
        }
      }

      if (node.type === 'dice' || node.type === 'set' || node.type === 'parenthetical') {
        const defaultExplosionTarget =
          node.type === 'dice' ? (node.sides === 'F' ? 1 : node.sides) : undefined;
        node.modifiers.push(...this.parseModifiers(defaultExplosionTarget));
      }
      node.annotations.push(...this.parseAnnotations());
      return node;
    });
  }

  private parseParentheticalOrSet(): AstNode {
    this.skipWhitespace();
    if (this.consume(')')) {
      return { type: 'set', values: [], modifiers: [], annotations: [] };
    }

    const first = this.parseComparison();
    this.skipWhitespace();
    if (!this.consume(',')) {
      if (!this.consume(')')) {
        throw this.error(
          "Expected ')' or ','",
          DICE_DIAGNOSTIC_CODES.expectedClosingParenthesis,
          this.offset,
          this.isEnd() ? this.offset : this.offset + 1,
          [
            {
              message: "Insert ')' to close the parenthesized expression.",
              replacement: ')',
              startOffset: this.offset,
              endOffset: this.offset,
            },
            {
              message: "Insert ',' to make this a set.",
              replacement: ',',
              startOffset: this.offset,
              endOffset: this.offset,
            },
          ],
        );
      }
      return { type: 'parenthetical', value: first, modifiers: [], annotations: [] };
    }

    const values: AstNode[] = [first];
    while (true) {
      this.skipWhitespace();
      if (this.consume(')')) break;
      values.push(this.parseComparison());
      this.skipWhitespace();
      if (this.consume(')')) break;
      if (!this.consume(',')) {
        throw this.error(
          "Expected ',' or ')' in set",
          DICE_DIAGNOSTIC_CODES.expectedSetDelimiter,
          this.offset,
          this.isEnd() ? this.offset : this.offset + 1,
          [
            {
              message: "Insert ',' before the next set value.",
              replacement: ',',
              startOffset: this.offset,
              endOffset: this.offset,
            },
            {
              message: "Insert ')' to close the set.",
              replacement: ')',
              startOffset: this.offset,
              endOffset: this.offset,
            },
          ],
        );
      }
    }
    return { type: 'set', values, modifiers: [], annotations: [] };
  }

  private parseModifiers(defaultExplosionTarget?: number): SetOperation[] {
    const modifiers: SetOperation[] = [];
    while (true) {
      this.skipWhitespace();
      const modifierStart = this.offset;
      const remaining = this.input.slice(this.offset).toLowerCase();
      let modifier: SetOperation | null = null;

      if (remaining.startsWith('kh'))
        modifier = this.readAliasOperation('keep', 'highest', 2, 'kh');
      else if (remaining.startsWith('kl'))
        modifier = this.readAliasOperation('keep', 'lowest', 2, 'kl');
      else if (remaining.startsWith('ph'))
        modifier = this.readAliasOperation('drop', 'highest', 2, 'ph');
      else if (remaining.startsWith('pl'))
        modifier = this.readAliasOperation('drop', 'lowest', 2, 'pl');
      else if (remaining.startsWith('dh'))
        modifier = this.readAliasOperation('drop', 'highest', 2, 'dh');
      else if (remaining.startsWith('dl'))
        modifier = this.readAliasOperation('drop', 'lowest', 2, 'dl');
      else if (remaining.startsWith('rr')) modifier = this.readSelectorOperation('reroll', 2, 'rr');
      else if (remaining.startsWith('ro'))
        modifier = this.readSelectorOperation('reroll-once', 2, 'ro');
      else if (remaining.startsWith('ra'))
        modifier = this.readSelectorOperation('reroll-add', 2, 'ra');
      else if (remaining.startsWith('mi')) modifier = this.readLiteralOperation('minimum', 2, 'mi');
      else if (remaining.startsWith('ma')) modifier = this.readLiteralOperation('maximum', 2, 'ma');
      else if (remaining.startsWith('cs'))
        modifier = this.readSelectorOperation('success-count', 2, 'cs');
      else if (remaining.startsWith('count'))
        modifier = this.readSelectorOperation('success-count', 5, 'count');
      else if (remaining.startsWith('r')) modifier = this.readSelectorOperation('reroll', 1, 'r');
      else if (remaining.startsWith('e'))
        modifier = this.readExplosionOperation(1, 'e', defaultExplosionTarget);
      else if (remaining.startsWith('k')) modifier = this.readSelectorOperation('keep', 1, 'k');
      else if (remaining.startsWith('p')) modifier = this.readSelectorOperation('drop', 1, 'p');
      else if (this.dialect === 'draftroll') {
        const selector = this.tryReadComparisonSelector();
        if (selector)
          modifier = { type: 'success-count', selector, notation: selectorNotation(selector) };
      }

      if (!modifier) break;
      modifiers.push(modifier);
      this.modifierCount += 1;
      if (this.modifierCount > this.limits.maxModifiers) {
        throw this.limitError(
          `Expression exceeds ${this.limits.maxModifiers} set operations`,
          DICE_DIAGNOSTIC_CODES.tooManyModifiers,
          modifierStart,
          this.offset,
          [{ message: `Reduce the expression to ${this.limits.maxModifiers} modifiers or fewer.` }],
        );
      }
    }
    return modifiers;
  }

  private readAliasOperation(
    type: 'keep' | 'drop',
    selectorType: 'highest' | 'lowest',
    prefixLength: number,
    notation: string,
  ): SetOperation {
    this.offset += prefixLength;
    this.skipWhitespace();
    return {
      type,
      selector: {
        type: selectorType,
        target: this.readRequiredInteger(
          `Expected count after ${notation}`,
          DICE_DIAGNOSTIC_CODES.expectedModifierCount,
          [
            {
              message: `Add a count after ${notation}, for example ${notation}1.`,
              replacement: '1',
              startOffset: this.offset,
              endOffset: this.offset,
            },
          ],
        ),
      },
      notation,
    };
  }

  private readSelectorOperation(
    type: SetOperationType,
    prefixLength: number,
    notation: string,
  ): SetOperation {
    this.offset += prefixLength;
    this.skipWhitespace();
    return { type, selector: this.readSelector(), notation };
  }

  private readExplosionOperation(
    prefixLength: number,
    notation: string,
    defaultTarget?: number,
  ): SetOperation {
    this.offset += prefixLength;
    this.skipWhitespace();
    if (defaultTarget !== undefined && !this.canStartSelector()) {
      return {
        type: 'explode',
        selector: { type: 'literal', target: defaultTarget },
        notation,
      };
    }
    return { type: 'explode', selector: this.readSelector(), notation };
  }

  private canStartSelector(): boolean {
    const marker = this.peek().toLowerCase();
    return (
      marker === 'h' ||
      marker === 'l' ||
      marker === '.' ||
      /\d/.test(marker) ||
      this.input.startsWith('!=', this.offset) ||
      this.input.startsWith('<=', this.offset) ||
      this.input.startsWith('>=', this.offset) ||
      this.input.startsWith('==', this.offset) ||
      marker === '=' ||
      marker === '<' ||
      marker === '>'
    );
  }

  private readLiteralOperation(
    type: 'minimum' | 'maximum',
    prefixLength: number,
    notation: string,
  ): SetOperation {
    this.offset += prefixLength;
    this.skipWhitespace();
    return {
      type,
      selector: {
        type: 'literal',
        target: this.readSignedNumber(
          `Expected value after ${notation}`,
          DICE_DIAGNOSTIC_CODES.expectedModifierValue,
          [{ message: `Add a numeric value after ${notation}.` }],
        ),
      },
      notation,
    };
  }

  private readSelector(): SetSelector {
    this.skipWhitespace();
    const marker = this.peek().toLowerCase();
    if (marker === 'h' || marker === 'l') {
      this.offset += 1;
      return {
        type: marker === 'h' ? 'highest' : 'lowest',
        target: this.readRequiredInteger(
          `Expected count after ${marker}`,
          DICE_DIAGNOSTIC_CODES.expectedModifierCount,
          [
            {
              message: `Add a count after ${marker}, for example ${marker}1.`,
              replacement: '1',
              startOffset: this.offset,
              endOffset: this.offset,
            },
          ],
        ),
      };
    }
    const comparison = this.tryReadComparisonSelector();
    if (comparison) return comparison;
    return {
      type: 'literal',
      target: this.readSignedNumber(
        'Expected selector value',
        DICE_DIAGNOSTIC_CODES.expectedSelectorValue,
        [{ message: 'Add a selector value such as 1 or >=5.' }],
      ),
    };
  }

  private tryReadComparisonSelector(): SetSelector | null {
    this.skipWhitespace();
    const operators = ['!=', '<=', '>=', '==', '=', '<', '>'] as const;
    const operator = operators.find((candidate) => this.input.startsWith(candidate, this.offset));
    if (!operator) return null;
    this.offset += operator.length;
    this.skipWhitespace();
    const target = this.readSignedNumber(
      'Expected comparison value',
      DICE_DIAGNOSTIC_CODES.expectedComparisonValue,
      [{ message: `Add a numeric value after ${operator}.` }],
    );
    return { type: selectorTypeForComparison(operator), target };
  }

  private tryReadBinaryComparison(): BinaryOperator | null {
    const operators: BinaryOperator[] = ['!=', '<=', '>=', '==', '=', '<', '>'];
    const operator = operators.find((candidate) => this.input.startsWith(candidate, this.offset));
    if (!operator) return null;
    this.offset += operator.length;
    return operator;
  }

  private parseAnnotations(): string[] {
    const annotations: string[] = [];
    while (true) {
      this.skipWhitespace();
      if (!this.consume('[')) break;
      const start = this.offset;
      while (!this.isEnd() && this.peek() !== ']') this.offset += 1;
      if (this.isEnd()) {
        throw this.error(
          "Expected ']'",
          DICE_DIAGNOSTIC_CODES.unterminatedAnnotation,
          start - 1,
          this.offset,
          [
            {
              message: "Insert ']' to close the annotation.",
              replacement: ']',
              startOffset: this.offset,
              endOffset: this.offset,
            },
          ],
        );
      }
      const text = this.input.slice(start, this.offset).trim();
      this.offset += 1;
      if (text) annotations.push(text);
    }
    return annotations;
  }

  private readNumberOptional(): number | null {
    this.skipWhitespace();
    const start = this.offset;
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(this.input.slice(this.offset));
    if (!match) return null;
    this.offset += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) {
      throw this.error(
        'Number is too large',
        DICE_DIAGNOSTIC_CODES.numberTooLarge,
        start,
        this.offset,
        [{ message: 'Use a smaller finite number.' }],
      );
    }
    return value;
  }

  private readSignedNumber(
    message: string,
    code: DiceDiagnosticCode,
    suggestions: readonly DiceDiagnosticSuggestionSpec[] = [],
  ): number {
    this.skipWhitespace();
    const start = this.offset;
    let sign = 1;
    if (this.peek() === '+' || this.peek() === '-') {
      if (this.peek() === '-') sign = -1;
      this.offset += 1;
    }
    const value = this.readNumberOptional();
    if (value === null) throw this.error(message, code, start, this.offset, suggestions);
    return sign * value;
  }

  private readRequiredInteger(
    message: string,
    code: DiceDiagnosticCode,
    suggestions: readonly DiceDiagnosticSuggestionSpec[] = [],
  ): number {
    this.skipWhitespace();
    const start = this.offset;
    const match = /^\d+/.exec(this.input.slice(this.offset));
    if (!match) throw this.error(message, code, start, this.offset, suggestions);
    this.offset += match[0].length;
    const value = Number(match[0]);
    if (!Number.isSafeInteger(value)) {
      throw this.error(
        'Integer is too large',
        DICE_DIAGNOSTIC_CODES.integerTooLarge,
        start,
        this.offset,
        [{ message: 'Use a smaller whole number.' }],
      );
    }
    return value;
  }

  private withDepth<T>(callback: () => T): T {
    this.depth += 1;
    if (this.depth > this.limits.maxAstDepth) {
      throw this.limitError(
        `AST depth exceeds ${this.limits.maxAstDepth}`,
        DICE_DIAGNOSTIC_CODES.astDepthExceeded,
        this.offset,
        this.offset,
        [{ message: 'Simplify nested parentheses or chained operations.' }],
      );
    }
    try {
      return callback();
    } finally {
      this.depth -= 1;
    }
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.peek())) this.offset += 1;
  }

  private consume(value: string): boolean {
    if (!this.input.startsWith(value, this.offset)) return false;
    this.offset += value.length;
    return true;
  }

  private peek(): string {
    return this.input[this.offset] ?? '';
  }

  private isEnd(): boolean {
    return this.offset >= this.input.length;
  }

  private limitError(
    message: string,
    code: DiceDiagnosticCode,
    startOffset = this.offset,
    endOffset = startOffset,
    suggestions: readonly DiceDiagnosticSuggestionSpec[] = [],
  ): DiceLimitError {
    return new DiceLimitError(message, {
      code,
      startOffset: this.sourceOffset + startOffset,
      endOffset: this.sourceOffset + endOffset,
      source: this.source,
      suggestions: suggestions.map((suggestion) => ({
        ...suggestion,
        ...(suggestion.startOffset === undefined
          ? {}
          : { startOffset: this.sourceOffset + suggestion.startOffset }),
        ...(suggestion.endOffset === undefined
          ? {}
          : { endOffset: this.sourceOffset + suggestion.endOffset }),
      })),
    });
  }

  private error(
    message: string,
    code: DiceDiagnosticCode = DICE_DIAGNOSTIC_CODES.unexpectedToken,
    startOffset = this.offset,
    endOffset = startOffset,
    suggestions: readonly DiceDiagnosticSuggestionSpec[] = [],
  ): DiceSyntaxError {
    const absoluteStart = this.sourceOffset + startOffset;
    const absoluteEnd = this.sourceOffset + endOffset;
    return new DiceSyntaxError(message, absoluteStart, {
      code,
      endOffset: absoluteEnd,
      source: this.source,
      suggestions: suggestions.map((suggestion) => ({
        ...suggestion,
        ...(suggestion.startOffset === undefined
          ? {}
          : { startOffset: this.sourceOffset + suggestion.startOffset }),
        ...(suggestion.endOffset === undefined
          ? {}
          : { endOffset: this.sourceOffset + suggestion.endOffset }),
      })),
    });
  }
}

function selectorTypeForComparison(operator: ComparisonOperator | '=='): SetSelector['type'] {
  switch (operator) {
    case '=':
    case '==':
      return 'literal';
    case '!=':
      return 'not-equal';
    case '<':
      return 'less';
    case '<=':
      return 'less-equal';
    case '>':
      return 'greater';
    case '>=':
      return 'greater-equal';
  }
}

function selectorNotation(selector: SetSelector): string {
  const prefix =
    selector.type === 'literal'
      ? '='
      : selector.type === 'not-equal'
        ? '!='
        : selector.type === 'less'
          ? '<'
          : selector.type === 'less-equal'
            ? '<='
            : selector.type === 'greater'
              ? '>'
              : selector.type === 'greater-equal'
                ? '>='
                : selector.type === 'highest'
                  ? 'h'
                  : 'l';
  return `${prefix}${selector.target}`;
}
