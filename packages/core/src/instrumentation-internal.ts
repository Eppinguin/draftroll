import type { AstNode, ParsedExpression } from './ast';
import type {
  DiceInstrumentation,
  DiceParseCacheStatus,
  DiceParseProfile,
  DiceProfile,
  DiceProfileError,
} from './instrumentation';
import type { DiceDialect } from '../../protocol/src/index';

export interface ParseProfileContext {
  source: string;
  dialect: DiceDialect;
  allowComments: boolean;
  cache: DiceParseCacheStatus;
}

export interface AstProfileMetrics {
  astNodes: number;
  maxAstDepth: number;
  diceNodes: number;
  initialDice: number;
  modifiers: number;
  annotations: number;
}

export function profileParse<T extends ParsedExpression>(
  instrumentation: DiceInstrumentation | undefined,
  context: ParseProfileContext,
  work: () => T,
): T {
  if (!instrumentation) return work();
  const startedAt = profileNow(instrumentation);
  let parsed: T;
  try {
    parsed = work();
  } catch (error) {
    emitProfile(instrumentation, {
      kind: 'parse',
      status: 'error',
      durationMs: profileDuration(instrumentation, startedAt),
      cache: context.cache,
      dialect: context.dialect,
      allowComments: context.allowComments,
      sourceLength: context.source.length,
      expressionLength: context.source.trimStart().length,
      astNodes: 0,
      maxAstDepth: 0,
      diceNodes: 0,
      initialDice: 0,
      modifiers: 0,
      annotations: 0,
      error: profileError(error),
    } satisfies DiceParseProfile);
    throw error;
  }

  try {
    const metrics = collectAstProfileMetrics(parsed.ast);
    emitProfile(instrumentation, {
      kind: 'parse',
      status: 'success',
      durationMs: profileDuration(instrumentation, startedAt),
      cache: context.cache,
      dialect: parsed.dialect,
      allowComments: context.allowComments,
      sourceLength: context.source.length,
      expressionLength: parsed.expression.length,
      ...metrics,
    });
  } catch {
    // Profiling computation is isolated from successful parsing.
  }
  return parsed;
}

export function emitProfile(
  instrumentation: DiceInstrumentation | undefined,
  profile: DiceProfile,
): void {
  if (!instrumentation) return;
  try {
    instrumentation.onProfile(Object.freeze(profile));
  } catch {
    // Profiling must never alter parser/evaluator behavior.
  }
}

export function profileNow(instrumentation: DiceInstrumentation | undefined): number {
  if (!instrumentation) return 0;
  try {
    const custom = instrumentation.now?.();
    if (custom !== undefined && Number.isFinite(custom)) return custom;
  } catch {
    // Fall through to the platform clock; profiling cannot affect evaluation.
  }
  const fallback =
    typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();
  return Number.isFinite(fallback) ? fallback : 0;
}

export function profileDuration(
  instrumentation: DiceInstrumentation | undefined,
  startedAt: number,
): number {
  return Math.max(0, profileNow(instrumentation) - startedAt);
}

export function profileError(error: unknown): DiceProfileError {
  try {
    const normalized = error instanceof Error ? error : new Error(String(error));
    const codeValue = (normalized as Error & { code?: unknown }).code;
    return {
      name: normalized.name,
      message: normalized.message,
      ...(typeof codeValue === 'string' ? { code: codeValue } : {}),
    };
  } catch {
    return { name: 'Error', message: 'Unknown instrumentation error' };
  }
}

export function collectAstProfileMetrics(ast: AstNode): AstProfileMetrics {
  const metrics: AstProfileMetrics = {
    astNodes: 0,
    maxAstDepth: 0,
    diceNodes: 0,
    initialDice: 0,
    modifiers: 0,
    annotations: 0,
  };

  const visit = (node: AstNode, depth: number): void => {
    metrics.astNodes += 1;
    metrics.maxAstDepth = Math.max(metrics.maxAstDepth, depth);
    metrics.annotations += node.annotations.length;

    if (node.type === 'dice') {
      metrics.diceNodes += 1;
      metrics.initialDice += node.count;
      metrics.modifiers += node.modifiers.length;
      return;
    }
    if (node.type === 'number') return;
    if (node.type === 'unary') {
      visit(node.operand, depth + 1);
      return;
    }
    if (node.type === 'binary') {
      visit(node.left, depth + 1);
      visit(node.right, depth + 1);
      return;
    }
    if (node.type === 'set') {
      metrics.modifiers += node.modifiers.length;
      for (const child of node.values) visit(child, depth + 1);
      return;
    }
    metrics.modifiers += node.modifiers.length;
    visit(node.value, depth + 1);
  };

  visit(ast, 1);
  return metrics;
}
