import { DraftrollError } from '../../errors/src/index';
import {
  DICE_DIAGNOSTIC_CODES,
  createDiceDiagnostic,
  type DiceDiagnostic,
  type DiceDiagnosticCode,
  type DiceDiagnosticSuggestion,
  type DiceDiagnosticSuggestionSpec,
  type DiceSourceRange,
} from './diagnostics';

/**
 * Hard limits that bound parser and evaluator work.
 *
 * @public
 */
export interface DiceExecutionLimits {
  maxExpressionLength: number;
  maxAstDepth: number;
  maxInitialDice: number;
  maxGeneratedDice: number;
  maxRerolls: number;
  maxExplosions: number;
  maxModifiers: number;
  maxOperations: number;
}

/**
 * Conservative default parser and evaluator limits.
 *
 * @public
 */
export const DEFAULT_LIMITS: DiceExecutionLimits = {
  maxExpressionLength: 1_000,
  maxAstDepth: 64,
  maxInitialDice: 1_000,
  maxGeneratedDice: 10_000,
  maxRerolls: 10_000,
  maxExplosions: 10_000,
  maxModifiers: 128,
  maxOperations: 100_000,
};

/**
 * Diagnostic context for an execution-limit failure.
 *
 * @public
 */
export interface DiceLimitErrorOptions {
  code?: DiceDiagnosticCode;
  startOffset?: number;
  endOffset?: number;
  source?: string;
  suggestions?: readonly DiceDiagnosticSuggestionSpec[];
}

/**
 * Error thrown when configured execution limits would be exceeded.
 *
 * @public
 */
export class DiceLimitError extends DraftrollError {
  readonly code: DiceDiagnosticCode;
  readonly range: DiceSourceRange;
  readonly suggestions: readonly DiceDiagnosticSuggestion[];
  readonly diagnostic: DiceDiagnostic;

  /**
   * Creates a DiceLimitError instance.
   */
  constructor(message: string, options: DiceLimitErrorOptions = {}) {
    super(options.code ?? DICE_DIAGNOSTIC_CODES.limitExceeded, message, {
      package: 'core',
      recoverable: true,
      details: {
        startOffset: options.startOffset ?? 0,
        endOffset: options.endOffset ?? options.startOffset ?? 0,
      },
    });
    this.name = 'DiceLimitError';
    this.code = options.code ?? DICE_DIAGNOSTIC_CODES.limitExceeded;
    this.diagnostic = createDiceDiagnostic(
      options.source ?? '',
      this.code,
      message,
      options.startOffset ?? 0,
      options.endOffset ?? options.startOffset ?? 0,
      options.suggestions,
    );
    this.range = this.diagnostic.range;
    this.suggestions = this.diagnostic.suggestions;
  }
}
