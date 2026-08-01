import type { DiceDialect } from '../../protocol/src/index';

/**
 * Whether an instrumented operation succeeded or failed.
 *
 * @public
 */
export type DiceProfileStatus = 'success' | 'error';
/**
 * Parser cache outcome recorded by instrumentation.
 *
 * @public
 */
export type DiceParseCacheStatus = 'hit' | 'miss' | 'bypass';
/**
 * Expression or structured evaluator mode.
 *
 * @public
 */
export type DiceEvaluationMode = 'expression' | 'structured';

/**
 * Serializable error details recorded by instrumentation.
 *
 * @public
 */
export interface DiceProfileError {
  name: string;
  message: string;
  code?: string;
}

/**
 * Parser timing, cache, and AST-complexity measurements.
 *
 * @public
 */
export interface DiceParseProfile {
  kind: 'parse';
  status: DiceProfileStatus;
  durationMs: number;
  cache: DiceParseCacheStatus;
  dialect: DiceDialect;
  allowComments: boolean;
  sourceLength: number;
  expressionLength: number;
  astNodes: number;
  maxAstDepth: number;
  diceNodes: number;
  initialDice: number;
  modifiers: number;
  annotations: number;
  error?: DiceProfileError;
}

/**
 * Evaluator timing and generated-work measurements.
 *
 * @public
 */
export interface DiceEvaluationProfile {
  kind: 'evaluate';
  status: DiceProfileStatus;
  durationMs: number;
  mode: DiceEvaluationMode;
  dialect: DiceDialect;
  sourceLength?: number;
  expressionLength?: number;
  initialDice: number;
  generatedDice: number;
  resultDice: number;
  astNodesVisited: number;
  evaluationSteps: number;
  modifiersApplied: number;
  rerolls: number;
  explosions: number;
  error?: DiceProfileError;
}

/**
 * Profiling event emitted by parser or evaluator instrumentation.
 *
 * @public
 */
export type DiceProfile = DiceParseProfile | DiceEvaluationProfile;

/**
 * Optional profiling sink for parser and evaluator work.
 *
 * `now` should return a monotonic millisecond value. Hook failures are isolated
 * so observability cannot change a roll result or parser error.
 *
 * @public
 */
export interface DiceInstrumentation {
  onProfile(profile: DiceProfile): void;
  now?: () => number;
}

/**
 * Per-operation override for the profiling sink.
 *
 * @public
 */
export interface DiceInstrumentationOptions {
  instrumentation?: DiceInstrumentation;
}
