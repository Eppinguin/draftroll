/**
 * Public evaluator facade that preserves parsed-expression immutability.
 */

export { evaluateStructuredInput } from './evaluator-internal';
export type { EvaluateOptions } from './evaluator-internal';

import type { NormalizedRollResult } from '../../protocol/src/index';
import type { ParsedExpression } from './ast';
import {
  evaluateParsedExpression as evaluateParsedExpressionInternal,
  type EvaluateOptions,
} from './evaluator-internal';
import { DEFAULT_LIMITS, type DiceExecutionLimits } from './limits';
import type { DiceRng } from './rng';

/**
 * Evaluates a previously parsed expression without mutating the caller-owned AST.
 *
 * @remarks
 * Advantage and disadvantage are implemented internally as an AST transformation. The facade
 * clones only for those modes so ordinary evaluation remains allocation-light while reusable
 * parsed expressions stay immutable.
 *
 * @public
 */
export function evaluateParsedExpression(
  parsed: ParsedExpression,
  rng: DiceRng,
  limits: DiceExecutionLimits = DEFAULT_LIMITS,
  options: EvaluateOptions = {},
): NormalizedRollResult {
  const evaluationInput =
    options.advantage && options.advantage !== 'none' ? structuredClone(parsed) : parsed;
  return evaluateParsedExpressionInternal(evaluationInput, rng, limits, options);
}
