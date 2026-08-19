import type {
  AdvantageMode,
  ComparisonOperator,
  CriticalType,
  CustomDiceDefinition,
  EvaluateRollInput,
  NormalizedDieResult,
  NormalizedRollResult,
  PlannedDie,
  RollAuthority,
  RollOperation,
  RollOperationType,
  RollSelector,
  RollTreeNode,
  StructuredRollOperation,
} from '../../protocol/src/index';
import { DRAFTROLL_RESULT_SCHEMA_VERSION } from '../../protocol/src/version';
import type {
  AstNode,
  BinaryOperator,
  DiceNode,
  ParsedExpression,
  SetOperation,
  SetSelector,
} from './ast';
import { emitProfile, profileDuration, profileError, profileNow } from './instrumentation-internal';
import type { DiceInstrumentationOptions } from './instrumentation';
import { DEFAULT_LIMITS, DiceLimitError, type DiceExecutionLimits } from './limits';
import type { DiceRng } from './rng';

interface EvaluationState {
  generatedDice: number;
  rerolls: number;
  explosions: number;
  operations: number;
  astNodesVisited: number;
  modifiersApplied: number;
  nextDieId: number;
  nextNodeId: number;
  nextSourceRollIndex: number;
  resultOverrides?: Readonly<Record<string, number | string>>;
  instrumented: boolean;
}

interface NodeEvaluation {
  value: number;
  dice: NormalizedDieResult[];
  operations: RollOperation[];
  tree: RollTreeNode;
  selection?: SelectableItem[];
  successCount?: SetSelector;
}

interface SelectableItem {
  tree: RollTreeNode;
  value(): number;
  isKept(): boolean;
  setKept(kept: boolean): void;
  diceIds(): string[];
  die?: NormalizedDieResult;
}

/**
 * A selectable produced by `createDieItem`, which always carries a concrete die and
 * its matching die tree node. Naming the narrower shape lets callers push into
 * `NormalizedDieResult[]` and die-node arrays without asserting.
 */
interface DieSelectableItem extends SelectableItem {
  tree: Extract<RollTreeNode, { kind: 'die' }>;
  die: NormalizedDieResult;
}

interface StructuredOperationState {
  generatedDice: number;
  rerolls: number;
  explosions: number;
  operationSteps: number;
  nextGeneratedId: number;
  rng: DiceRng;
  limits: DiceExecutionLimits;
  resolveCustom: EvaluateOptions['customDice'];
  templatesByRoot: Map<string, PlannedDie>;
  rootByDieId: Map<string, string>;
  rollThemeId?: string;
  instrumented: boolean;
  usedIds: Set<string>;
}

/**
 * Controls one evaluator run, including overrides, provenance, and instrumentation.
 *
 * @public
 */
export interface EvaluateOptions extends DiceInstrumentationOptions {
  authority?: RollAuthority;
  name?: string;
  themeId?: string;
  metadata?: Record<string, unknown>;
  now?: () => Date;
  /** Exact values to reuse for initial dice, keyed by normalized die ID. */
  resultOverrides?: Readonly<Record<string, number | string>>;
  advantage?: AdvantageMode;
  customDice?: (id: string) => CustomDiceDefinition | undefined;
}

/**
 * Evaluates a previously parsed expression into a normalized roll result.
 *
 * @param parsed - Parsed expression produced by {@link parseDiceExpression} or {@link DiceEngine.parse}.
 * @param rng - Random source used for every initial and generated die.
 * @param limits - Bounds for generated dice and evaluator work.
 * @param options - Authority, metadata, result overrides, custom dice, and instrumentation.
 * @returns A detached normalized result containing the full causal die history.
 * @throws {@link DiceLimitError} when evaluation exceeds configured limits.
 *
 * @public
 */
export function evaluateParsedExpression(
  parsed: ParsedExpression,
  rng: DiceRng,
  limits: DiceExecutionLimits = DEFAULT_LIMITS,
  options: EvaluateOptions = {},
): NormalizedRollResult {
  const startedAt = profileNow(options.instrumentation);
  const state: EvaluationState = {
    generatedDice: 0,
    rerolls: 0,
    explosions: 0,
    operations: 0,
    astNodesVisited: 0,
    modifiersApplied: 0,
    nextDieId: 1,
    nextNodeId: 1,
    nextSourceRollIndex: 0,
    resultOverrides: options.resultOverrides,
    instrumented: Boolean(options.instrumentation),
  };
  let initialDice = 0;

  try {
    const advantage = options.advantage ?? 'none';
    const ast = advantage === 'none' ? parsed.ast : structuredClone(parsed.ast);
    if (advantage !== 'none') applyAdvantage(ast, advantage);

    initialDice = countInitialDice(ast);
    if (initialDice > limits.maxInitialDice) {
      throw new DiceLimitError(`Initial dice count exceeds ${limits.maxInitialDice}`);
    }

    const evaluated = evaluateNode(ast, rng, limits, state, options.themeId);
    const modifier = extractSimpleModifier(ast);
    const total = normalizeZero(evaluated.value);
    const result: NormalizedRollResult = {
      schemaVersion: DRAFTROLL_RESULT_SCHEMA_VERSION,
      authority: options.authority ?? 'local',
      name: options.name,
      expression: parsed.expression,
      total,
      integerTotal: Math.trunc(total),
      dice: evaluated.dice,
      operations: evaluated.operations,
      modifier,
      annotation: parsed.annotation,
      comment: parsed.comment,
      critical: detectCritical(evaluated.tree, evaluated.dice, evaluated.operations),
      dialect: parsed.dialect,
      advantage,
      tree: evaluated.tree,
      themeId: options.themeId,
      metadata: options.metadata,
      createdAt: (options.now ?? (() => new Date()))().toISOString(),
    };
    if (options.instrumentation)
      emitProfile(options.instrumentation, {
        kind: 'evaluate',
        status: 'success',
        durationMs: profileDuration(options.instrumentation, startedAt),
        mode: 'expression',
        dialect: parsed.dialect,
        sourceLength: parsed.source.length,
        expressionLength: parsed.expression.length,
        initialDice,
        generatedDice: Math.max(0, state.generatedDice - initialDice),
        resultDice: result.dice.length,
        astNodesVisited: state.astNodesVisited,
        evaluationSteps: state.operations,
        modifiersApplied: state.modifiersApplied,
        rerolls: state.rerolls,
        explosions: state.explosions,
      });
    return result;
  } catch (error) {
    if (options.instrumentation)
      emitProfile(options.instrumentation, {
        kind: 'evaluate',
        status: 'error',
        durationMs: profileDuration(options.instrumentation, startedAt),
        mode: 'expression',
        dialect: parsed.dialect,
        sourceLength: parsed.source.length,
        expressionLength: parsed.expression.length,
        initialDice,
        generatedDice: Math.max(0, state.generatedDice - initialDice),
        resultDice: state.generatedDice,
        astNodesVisited: state.astNodesVisited,
        evaluationSteps: state.operations,
        modifiersApplied: state.modifiersApplied,
        rerolls: state.rerolls,
        explosions: state.explosions,
        error: profileError(error),
      });
    throw error;
  }
}

/**
 * Evaluates planned dice and structured modifier operations without parsing notation.
 *
 * @param input - Strict structured roll input.
 * @param rng - Random source used for every initial and generated die.
 * @param limits - Bounds for dice generation and modifier work.
 * @param options - Authority, metadata, custom-die lookup, and instrumentation.
 * @returns A detached normalized result containing discarded and generated dice.
 * @throws {@link DiceLimitError} when evaluation exceeds configured limits.
 * @throws `Error` when structured operations or custom dice are invalid.
 *
 * @public
 */
export function evaluateStructuredInput(
  input: EvaluateRollInput,
  rng: DiceRng,
  limits: DiceExecutionLimits = DEFAULT_LIMITS,
  options: EvaluateOptions = {},
): NormalizedRollResult {
  const startedAt = profileNow(options.instrumentation);
  const planned = input.dice ?? [];
  let state: StructuredOperationState | undefined;
  let resultDice = 0;

  try {
    if (input.advantage && input.advantage !== 'none') {
      throw new Error(
        'Structured rolls do not infer an advantage pool; provide two d20 dice with keep-highest/keep-lowest, or use an expression roll',
      );
    }
    if (planned.length > limits.maxInitialDice)
      throw new DiceLimitError(`Initial dice count exceeds ${limits.maxInitialDice}`);

    const inlineCustomDice = new Map<string, CustomDiceDefinition>();
    for (const definition of input.customDice ?? []) {
      if (!definition.id.trim()) throw new Error('Custom dice require a non-empty id');
      if (!definition.faces.length)
        throw new Error(`Custom die '${definition.id}' requires at least one face`);
      if (inlineCustomDice.has(definition.id))
        throw new Error(`Duplicate custom die definition '${definition.id}'`);
      inlineCustomDice.set(definition.id, definition);
    }
    const resolveCustom = (id: string) => inlineCustomDice.get(id) ?? options.customDice?.(id);

    const dice: NormalizedDieResult[] = [];
    const templatesByRoot = new Map<string, PlannedDie>();
    const rootByDieId = new Map<string, string>();
    const initialIds = new Set<string>();
    for (let index = 0; index < planned.length; index += 1) {
      const die = planned[index];
      const id = die.id || `die_${index + 1}`;
      if (initialIds.has(id)) throw new Error(`Duplicate die id '${id}' in structured roll`);
      initialIds.add(id);
      const template = { ...die, id };
      const resolved = resolveStructuredDie(template, rng, resolveCustom);
      const normalized = normalizedStructuredDie(
        template,
        resolved,
        index,
        die.result === undefined ? 'initial' : 'external',
        input.themeId,
      );
      dice.push(normalized);
      templatesByRoot.set(id, template);
      rootByDieId.set(id, id);
    }

    if ((input.operations?.length ?? 0) > limits.maxModifiers) {
      throw new DiceLimitError(`Structured roll exceeds ${limits.maxModifiers} operations`);
    }

    const operations: RollOperation[] = [];
    state = {
      generatedDice: dice.length,
      rerolls: 0,
      explosions: 0,
      operationSteps: 0,
      nextGeneratedId: 1,
      rng,
      limits,
      resolveCustom,
      templatesByRoot,
      rootByDieId,
      rollThemeId: input.themeId,
      instrumented: Boolean(options.instrumentation),
      usedIds: new Set(dice.map((die) => die.id)),
    };
    const operationTotal = applyStructuredOperations(
      dice,
      input.operations ?? [],
      operations,
      state,
    );
    const treeChildren: RollTreeNode[] = dice.map((die, index) => ({
      kind: 'die',
      id: `node_${index + 1}`,
      dieId: die.id,
      sides:
        die.customDiceId ??
        (die.type.toLowerCase() === 'df' ? 'F' : (die.sides ?? parseSides(die.type))),
      generatedBy: die.generatedBy ?? 'initial',
      value: numericDieResult(die),
      kept: die.kept,
      annotations: die.annotations ?? [],
      diceIds: [die.id],
    }));
    const keptValues = dice.filter((die) => die.kept).map(numericDieResult);
    const total = normalizeZero(
      (operationTotal ?? keptValues.reduce((sum, value) => sum + value, 0)) + (input.modifier ?? 0),
    );
    const tree: RollTreeNode = {
      kind: 'set',
      id: 'node_root',
      value: total - (input.modifier ?? 0),
      kept: true,
      annotations: [],
      diceIds: dice.map((die) => die.id),
      children: treeChildren,
    };
    const result: NormalizedRollResult = {
      schemaVersion: DRAFTROLL_RESULT_SCHEMA_VERSION,
      authority: options.authority ?? 'local',
      name: input.name ?? options.name,
      total,
      integerTotal: Math.trunc(total),
      dice,
      operations,
      modifier: input.modifier,
      annotation: null,
      comment: null,
      critical: detectCritical(tree, dice, operations),
      dialect: input.dialect ?? 'd20',
      advantage: input.advantage ?? options.advantage ?? 'none',
      tree,
      themeId: input.themeId,
      metadata: { ...input.metadata, ...options.metadata },
      customDice: input.customDice?.map((definition) => structuredClone(definition)),
      createdAt: (options.now ?? (() => new Date()))().toISOString(),
    };
    resultDice = result.dice.length;
    if (options.instrumentation)
      emitProfile(options.instrumentation, {
        kind: 'evaluate',
        status: 'success',
        durationMs: profileDuration(options.instrumentation, startedAt),
        mode: 'structured',
        dialect: input.dialect ?? 'd20',
        initialDice: planned.length,
        generatedDice: Math.max(0, state.generatedDice - planned.length),
        resultDice,
        astNodesVisited: 0,
        evaluationSteps: state.operationSteps,
        modifiersApplied: operations.length,
        rerolls: state.rerolls,
        explosions: state.explosions,
      });
    return result;
  } catch (error) {
    if (options.instrumentation)
      emitProfile(options.instrumentation, {
        kind: 'evaluate',
        status: 'error',
        durationMs: profileDuration(options.instrumentation, startedAt),
        mode: 'structured',
        dialect: input.dialect ?? 'd20',
        initialDice: planned.length,
        generatedDice: Math.max(0, (state?.generatedDice ?? planned.length) - planned.length),
        resultDice: resultDice || state?.generatedDice || 0,
        astNodesVisited: 0,
        evaluationSteps: state?.operationSteps ?? 0,
        modifiersApplied: state?.operationSteps ?? 0,
        rerolls: state?.rerolls ?? 0,
        explosions: state?.explosions ?? 0,
        error: profileError(error),
      });
    throw error;
  }
}

function evaluateNode(
  node: AstNode,
  rng: DiceRng,
  limits: DiceExecutionLimits,
  state: EvaluationState,
  themeId?: string,
): NodeEvaluation {
  if (state.instrumented) state.astNodesVisited += 1;
  tick(state, limits);
  if (node.type === 'number') {
    const tree: RollTreeNode = {
      kind: 'literal',
      id: nextNodeId(state),
      literal: node.value,
      value: node.value,
      kept: true,
      annotations: [...node.annotations],
      diceIds: [],
    };
    return { value: node.value, dice: [], operations: [], tree, selection: [treeSelectable(tree)] };
  }

  if (node.type === 'unary') {
    const operand = evaluateNode(node.operand, rng, limits, state, themeId);
    const value = node.operator === '-' ? -operand.value : operand.value;
    const tree: RollTreeNode = {
      kind: 'unary',
      id: nextNodeId(state),
      operator: node.operator,
      child: operand.tree,
      value,
      kept: true,
      annotations: [...node.annotations],
      diceIds: [...operand.tree.diceIds],
    };
    return { value, dice: operand.dice, operations: operand.operations, tree };
  }

  if (node.type === 'binary') {
    const left = evaluateNode(node.left, rng, limits, state, themeId);
    const right = evaluateNode(node.right, rng, limits, state, themeId);
    const value = applyArithmetic(node.operator, left.value, right.value);
    const tree: RollTreeNode = {
      kind: 'binary',
      id: nextNodeId(state),
      operator: node.operator,
      left: left.tree,
      right: right.tree,
      value,
      kept: true,
      annotations: [...node.annotations],
      diceIds: [...left.tree.diceIds, ...right.tree.diceIds],
    };
    return {
      value,
      dice: [...left.dice, ...right.dice],
      operations: [...left.operations, ...right.operations],
      tree,
    };
  }

  if (node.type === 'dice') return evaluateDice(node, rng, limits, state, themeId);

  if (node.type === 'set') {
    const children = node.values.map((value) => evaluateNode(value, rng, limits, state, themeId));
    const dice = children.flatMap((child) => child.dice);
    const operations = children.flatMap((child) => child.operations);
    const tree: RollTreeNode = {
      kind: 'set',
      id: nextNodeId(state),
      children: children.map((child) => child.tree),
      value: children.reduce((sum, child) => sum + child.value, 0),
      kept: true,
      annotations: [...node.annotations],
      diceIds: dice.map((die) => die.id),
    };
    const selection = children.map((child) => evaluationSelectable(child));
    const result: NodeEvaluation = { value: tree.value, dice, operations, tree, selection };
    applySetOperations(result, node.modifiers, undefined, rng, state, limits, themeId);
    refreshCollectionValue(result);
    return result;
  }

  const child = evaluateNode(node.value, rng, limits, state, themeId);
  const tree: RollTreeNode = {
    kind: 'parenthetical',
    id: nextNodeId(state),
    child: child.tree,
    value: child.value,
    kept: true,
    annotations: [...node.annotations],
    diceIds: [...child.tree.diceIds],
  };
  const result: NodeEvaluation = {
    value: child.value,
    dice: child.dice,
    operations: child.operations,
    tree,
    selection: child.selection ?? [evaluationSelectable(child)],
  };
  applySetOperations(result, node.modifiers, undefined, rng, state, limits, themeId);
  refreshCollectionValue(result);
  tree.value = result.value;
  return result;
}

function evaluateDice(
  node: DiceNode,
  rng: DiceRng,
  limits: DiceExecutionLimits,
  state: EvaluationState,
  themeId?: string,
): NodeEvaluation {
  const dice: NormalizedDieResult[] = [];
  const children: Extract<RollTreeNode, { kind: 'die' }>[] = [];
  const selection: SelectableItem[] = [];
  for (let count = 0; count < node.count; count += 1) {
    const item = createDieItem(
      node.sides,
      rng,
      state,
      limits,
      themeId,
      state.nextSourceRollIndex++,
      'initial',
      node.annotations,
    );
    dice.push(item.die);
    children.push(item.tree);
    selection.push(item);
  }

  const tree: RollTreeNode = {
    kind: 'dice',
    id: nextNodeId(state),
    count: node.count,
    sides: node.sides,
    percentile: node.percentile || undefined,
    children,
    value: selection.reduce((sum, item) => sum + item.value(), 0),
    kept: true,
    annotations: [...node.annotations],
    diceIds: dice.map((die) => die.id),
  };
  const result: NodeEvaluation = { value: tree.value, dice, operations: [], tree, selection };
  applySetOperations(result, node.modifiers, node, rng, state, limits, themeId);
  refreshCollectionValue(result);
  tree.value = result.value;
  tree.diceIds = dice.map((die) => die.id);
  return result;
}

function applySetOperations(
  result: NodeEvaluation,
  modifiers: readonly SetOperation[],
  diceNode: DiceNode | undefined,
  rng: DiceRng,
  state: EvaluationState,
  limits: DiceExecutionLimits,
  themeId?: string,
): void {
  const items = result.selection ?? [];
  for (const modifier of modifiers) {
    if (state.instrumented) state.modifiersApplied += 1;
    tick(state, limits);
    if (modifier.type === 'success-count') {
      result.successCount = modifier.selector;
      result.operations.push(operationRecord(modifier, selectItems(items, modifier.selector)));
      continue;
    }

    if (modifier.type === 'keep' || modifier.type === 'drop') {
      const selected = selectItems(items, modifier.selector);
      const selectedSet = new Set(selected);
      for (const item of items.filter((candidate) => candidate.isKept())) {
        item.setKept(modifier.type === 'keep' ? selectedSet.has(item) : !selectedSet.has(item));
      }
      result.operations.push(operationRecord(modifier, selected));
      continue;
    }

    if (!diceNode)
      throw new Error(
        `Operation '${modifier.notation ?? modifier.type}' can only be applied to dice`,
      );

    if (modifier.type === 'minimum' || modifier.type === 'maximum') {
      for (const item of items.filter((candidate) => candidate.isKept() && candidate.die)) {
        const current = item.value();
        const next =
          modifier.type === 'minimum'
            ? Math.max(current, modifier.selector.target)
            : Math.min(current, modifier.selector.target);
        setDieItemValue(item, next);
      }
      result.operations.push(
        operationRecord(
          modifier,
          items.filter((item) => item.isKept()),
        ),
      );
      continue;
    }

    const selected = selectItems(items, modifier.selector).filter((item) => item.die);
    if (modifier.type === 'reroll-add') {
      const original = selected[0];
      if (original) {
        const added = createDieItem(
          diceNode.sides,
          rng,
          state,
          limits,
          themeId,
          original.die?.sourceRollIndex ?? 0,
          'reroll-add',
          diceNode.annotations,
          original.die?.id,
        );
        appendDieItem(result, added);
      }
      result.operations.push(operationRecord(modifier, original ? [original] : []));
      continue;
    }

    if (modifier.type === 'reroll' || modifier.type === 'reroll-once') {
      const affected: SelectableItem[] = [];
      for (const original of selected) {
        let current = original;
        while (true) {
          affected.push(current);
          current.setKept(false);
          state.rerolls += 1;
          if (state.rerolls > limits.maxRerolls)
            throw new DiceLimitError(`Rerolls exceed ${limits.maxRerolls}`);
          const replacement = createDieItem(
            diceNode.sides,
            rng,
            state,
            limits,
            themeId,
            current.die?.sourceRollIndex ?? 0,
            'reroll',
            diceNode.annotations,
            current.die?.id,
          );
          appendDieItem(result, replacement);
          current = replacement;
          if (
            modifier.type === 'reroll-once' ||
            isRankSelector(modifier.selector) ||
            !matchesSelector(current.value(), modifier.selector)
          )
            break;
        }
      }
      result.operations.push(operationRecord(modifier, affected));
      continue;
    }

    if (modifier.type === 'explode') {
      const affected: SelectableItem[] = [];
      const queue = [...selected];
      for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index];
        affected.push(current);
        state.explosions += 1;
        if (state.explosions > limits.maxExplosions)
          throw new DiceLimitError(`Explosions exceed ${limits.maxExplosions}`);
        const exploded = createDieItem(
          diceNode.sides,
          rng,
          state,
          limits,
          themeId,
          current.die?.sourceRollIndex ?? 0,
          'explosion',
          diceNode.annotations,
          current.die?.id,
        );
        appendDieItem(result, exploded);
        if (
          !isRankSelector(modifier.selector) &&
          matchesSelector(exploded.value(), modifier.selector)
        )
          queue.push(exploded);
      }
      result.operations.push(operationRecord(modifier, affected));
    }
  }
}

function appendDieItem(result: NodeEvaluation, item: DieSelectableItem): void {
  result.dice.push(item.die);
  result.selection?.push(item);
  if (result.tree.kind === 'dice') {
    result.tree.children.push(item.tree);
    result.tree.diceIds.push(item.die.id);
  }
}

function createDieItem(
  sides: number | 'F',
  rng: DiceRng,
  state: EvaluationState,
  limits: DiceExecutionLimits,
  themeId: string | undefined,
  sourceRollIndex: number,
  generatedBy: NonNullable<NormalizedDieResult['generatedBy']>,
  annotations: readonly string[],
  generatedFromDieId?: string,
): DieSelectableItem {
  state.generatedDice += 1;
  if (state.generatedDice > limits.maxGeneratedDice)
    throw new DiceLimitError(`Generated dice exceed ${limits.maxGeneratedDice}`);
  const id = `die_${state.nextDieId++}`;
  const override = generatedBy === 'initial' ? state.resultOverrides?.[id] : undefined;
  const result = override ?? rollValue(sides, rng);
  validateDieValue(result, sides, id);
  const die: NormalizedDieResult = {
    id,
    type: sides === 'F' ? 'dF' : `d${sides}`,
    sides: sides === 'F' ? undefined : sides,
    result,
    kept: true,
    themeId,
    sourceRollIndex,
    generatedBy,
    generatedFromDieId,
    annotations: [...annotations],
  };
  const tree: Extract<RollTreeNode, { kind: 'die' }> = {
    kind: 'die',
    id: nextNodeId(state),
    dieId: id,
    sides,
    generatedBy,
    value: numericResult(result),
    kept: true,
    annotations: [...annotations],
    diceIds: [id],
  };
  return {
    tree,
    die,
    value: () => numericResult(die.result),
    isKept: () => die.kept,
    setKept: (kept) => {
      die.kept = kept;
      tree.kept = kept;
    },
    diceIds: () => [id],
  };
}

function treeSelectable(tree: RollTreeNode): SelectableItem {
  return {
    tree,
    value: () => tree.value,
    isKept: () => tree.kept,
    setKept: (kept) => setTreeKept(tree, kept),
    diceIds: () => tree.diceIds,
  };
}

function evaluationSelectable(evaluation: NodeEvaluation): SelectableItem {
  return {
    tree: evaluation.tree,
    value: () => evaluation.value,
    isKept: () => evaluation.tree.kept,
    setKept: (kept) => {
      setTreeKept(evaluation.tree, kept);
      for (const die of evaluation.dice) die.kept = kept;
    },
    diceIds: () => evaluation.tree.diceIds,
  };
}

function setTreeKept(tree: RollTreeNode, kept: boolean): void {
  tree.kept = kept;
  if (tree.kind === 'dice' || tree.kind === 'set') {
    for (const child of tree.children) setTreeKept(child, kept);
  } else if (tree.kind === 'parenthetical' || tree.kind === 'unary') {
    setTreeKept(tree.child, kept);
  } else if (tree.kind === 'binary') {
    setTreeKept(tree.left, kept);
    setTreeKept(tree.right, kept);
  }
}

function refreshCollectionValue(result: NodeEvaluation): void {
  const active = (result.selection ?? []).filter((item) => item.isKept());
  result.value = result.successCount
    ? selectItems(active, result.successCount).length
    : active.reduce((sum, item) => sum + item.value(), 0);
  result.tree.value = result.value;
}

function selectItems(items: readonly SelectableItem[], selector: SetSelector): SelectableItem[] {
  const active = items.filter((item) => item.isKept());
  if (selector.type === 'highest' || selector.type === 'lowest') {
    const count = Math.max(0, Math.trunc(selector.target));
    const sorted = active.toSorted((left, right) => left.value() - right.value());
    return selector.type === 'highest'
      ? sorted.slice(Math.max(0, sorted.length - count))
      : sorted.slice(0, count);
  }
  return active.filter((item) => matchesSelector(item.value(), selector));
}

function matchesSelector(value: number, selector: SetSelector): boolean {
  switch (selector.type) {
    case 'literal':
      return value === selector.target;
    case 'not-equal':
      return value !== selector.target;
    case 'less':
      return value < selector.target;
    case 'less-equal':
      return value <= selector.target;
    case 'greater':
      return value > selector.target;
    case 'greater-equal':
      return value >= selector.target;
    case 'highest':
    case 'lowest':
      return false;
  }
}

function isRankSelector(selector: SetSelector): boolean {
  return selector.type === 'highest' || selector.type === 'lowest';
}

function operationRecord(modifier: SetOperation, items: readonly SelectableItem[]): RollOperation {
  const type = legacyOperationType(modifier);
  const comparator = selectorComparison(modifier.selector);
  return {
    type,
    count:
      modifier.selector.type === 'highest' || modifier.selector.type === 'lowest'
        ? modifier.selector.target
        : undefined,
    comparator: comparator ?? undefined,
    target: modifier.selector.target,
    selector: { ...modifier.selector },
    notation: modifier.notation,
    appliedTo: items.flatMap((item) =>
      item.diceIds().length > 0 ? item.diceIds() : [item.tree.id],
    ),
  };
}

function legacyOperationType(modifier: SetOperation): RollOperationType {
  if (modifier.type === 'keep' && modifier.selector.type === 'highest') return 'keep-highest';
  if (modifier.type === 'keep' && modifier.selector.type === 'lowest') return 'keep-lowest';
  if (modifier.type === 'drop' && modifier.selector.type === 'highest') return 'drop-highest';
  if (modifier.type === 'drop' && modifier.selector.type === 'lowest') return 'drop-lowest';
  return modifier.type;
}

function selectorComparison(selector: SetSelector): ComparisonOperator | null {
  switch (selector.type) {
    case 'literal':
      return '=';
    case 'not-equal':
      return '!=';
    case 'less':
      return '<';
    case 'less-equal':
      return '<=';
    case 'greater':
      return '>';
    case 'greater-equal':
      return '>=';
    case 'highest':
    case 'lowest':
      return null;
  }
}

function setDieItemValue(item: SelectableItem, value: number): void {
  if (!item.die) return;
  item.die.result = value;
  item.tree.value = value;
}

function applyArithmetic(operator: BinaryOperator, left: number, right: number): number {
  switch (operator) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
      if (right === 0) throw new Error('Division by zero');
      return left / right;
    case '//':
      if (right === 0) throw new Error('Integer division by zero');
      return Math.floor(left / right);
    case '%':
      if (right === 0) throw new Error('Modulo by zero');
      return left - Math.floor(left / right) * right;
    case '=':
    case '==':
      return left === right ? 1 : 0;
    case '!=':
      return left !== right ? 1 : 0;
    case '<':
      return left < right ? 1 : 0;
    case '<=':
      return left <= right ? 1 : 0;
    case '>':
      return left > right ? 1 : 0;
    case '>=':
      return left >= right ? 1 : 0;
  }
}

function countInitialDice(node: AstNode): number {
  switch (node.type) {
    case 'number':
      return 0;
    case 'dice':
      return node.count;
    case 'unary':
      return countInitialDice(node.operand);
    case 'binary':
      return countInitialDice(node.left) + countInitialDice(node.right);
    case 'parenthetical':
      return countInitialDice(node.value);
    case 'set':
      return node.values.reduce((sum, value) => sum + countInitialDice(value), 0);
  }
}

function extractSimpleModifier(node: AstNode): number | undefined {
  if (node.type !== 'binary' || (node.operator !== '+' && node.operator !== '-')) return undefined;
  if (node.right.type !== 'number') return undefined;
  return node.operator === '+' ? node.right.value : -node.right.value;
}

function applyAdvantage(node: AstNode, advantage: AdvantageMode): boolean {
  if (advantage === 'none') return false;
  switch (node.type) {
    case 'dice':
      if (node.count === 1 && node.sides === 20) {
        node.count = 2;
        node.modifiers.unshift({
          type: 'keep',
          selector: { type: advantage === 'advantage' ? 'highest' : 'lowest', target: 1 },
          notation: advantage === 'advantage' ? 'kh1' : 'kl1',
        });
        return true;
      }
      return false;
    case 'unary':
      return applyAdvantage(node.operand, advantage);
    case 'binary':
      return applyAdvantage(node.left, advantage) || applyAdvantage(node.right, advantage);
    case 'parenthetical':
      return applyAdvantage(node.value, advantage);
    case 'set':
      for (const value of node.values) if (applyAdvantage(value, advantage)) return true;
      return false;
    case 'number':
      return false;
  }
}

function detectCritical(
  tree: RollTreeNode,
  dice: readonly NormalizedDieResult[],
  operations: readonly RollOperation[],
): CriticalType {
  const firstD20 = findLeftmostD20(tree);
  if (!firstD20 || firstD20.kind !== 'dice') return 'none';
  const qualifyingPool =
    firstD20.count === 1 ||
    operations.some(
      (operation) =>
        (operation.type === 'keep-highest' || operation.type === 'keep-lowest') &&
        operation.count === 1 &&
        firstD20.diceIds.some((id) => operation.appliedTo.includes(id)),
    );
  if (!qualifyingPool) return 'none';
  const byId = new Map(dice.map((die) => [die.id, die]));
  const kept = firstD20.diceIds.map((id) => byId.get(id)).filter((die) => die?.kept);
  if (kept.some((die) => numericResult(die?.result ?? 0) === 20)) return 'critical-success';
  if (kept.some((die) => numericResult(die?.result ?? 0) === 1)) return 'critical-failure';
  return 'none';
}

function findLeftmostD20(tree: RollTreeNode): RollTreeNode | null {
  if (tree.kind === 'dice' && tree.sides === 20) return tree;
  if (tree.kind === 'set' || tree.kind === 'dice') {
    for (const child of tree.children) {
      const found = findLeftmostD20(child);
      if (found) return found;
    }
  } else if (tree.kind === 'parenthetical' || tree.kind === 'unary') {
    return findLeftmostD20(tree.child);
  } else if (tree.kind === 'binary') {
    return findLeftmostD20(tree.left) ?? findLeftmostD20(tree.right);
  }
  return null;
}

function nextNodeId(state: EvaluationState): string {
  return `node_${state.nextNodeId++}`;
}

function tick(state: EvaluationState, limits: DiceExecutionLimits): void {
  state.operations += 1;
  if (state.operations > limits.maxOperations)
    throw new DiceLimitError(`Evaluation operations exceed ${limits.maxOperations}`);
}

function rollValue(sides: number | 'F', rng: DiceRng): number {
  return sides === 'F' ? rng.integer(-1, 1) : rng.integer(1, sides);
}

function validateDieValue(value: number | string, sides: number | 'F', id: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`Die '${id}' requires a numeric result`);
  if (sides === 'F') {
    if (![-1, 0, 1].includes(value)) throw new Error(`Fate die '${id}' must be -1, 0, or 1`);
    return;
  }
  if (!Number.isInteger(value) || value < 1 || value > sides)
    throw new Error(`Die '${id}' result must be between 1 and ${sides}`);
}

function numericResult(result: number | string): number {
  if (typeof result === 'number') return result;
  const numeric = Number(result);
  if (!Number.isFinite(numeric))
    throw new Error(`Non-numeric die result '${result}' cannot be evaluated`);
  return numeric;
}

interface ResolvedStructuredDie {
  result: number | string;
  numericValue: number;
  sides: number | 'F' | (string & {});
  customDiceId?: string;
  faceIndex?: number;
  faceLabel?: string;
  faceMetadata?: Record<string, unknown>;
}

function resolveStructuredDie(
  die: EvaluateRollInput['dice'] extends Array<infer T> | undefined ? T : never,
  rng: DiceRng,
  resolveCustom: EvaluateOptions['customDice'],
): ResolvedStructuredDie {
  const customId = die.customDiceId ?? (resolveCustom?.(die.type) ? die.type : undefined);
  const definition = customId ? resolveCustom?.(customId) : undefined;
  if (definition) {
    if (!definition.faces.length) throw new Error(`Custom die '${definition.id}' has no faces`);
    let faceIndex: number;
    if (die.faceIndex !== undefined) {
      faceIndex = die.faceIndex;
      if (
        !Number.isSafeInteger(faceIndex) ||
        faceIndex < 0 ||
        faceIndex >= definition.faces.length
      ) {
        throw new Error(`Face index ${faceIndex} is invalid for custom die '${definition.id}'`);
      }
      if (die.result !== undefined && definition.faces[faceIndex].result !== die.result) {
        throw new Error(
          `Face index ${faceIndex} does not match result '${String(die.result)}' for custom die '${definition.id}'`,
        );
      }
    } else if (die.result !== undefined) {
      faceIndex = definition.faces.findIndex((face) => face.result === die.result);
      if (faceIndex < 0)
        throw new Error(
          `Result '${String(die.result)}' is not a face of custom die '${definition.id}'`,
        );
    } else {
      const weights = definition.faces.map((face) => face.weight ?? 1);
      for (const weight of weights) {
        if (!Number.isSafeInteger(weight) || weight < 1)
          throw new Error(`Custom die '${definition.id}' weights must be positive integers`);
      }
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      const ticket = rng.integer(1, totalWeight);
      let cursor = 0;
      faceIndex = weights.findIndex((weight) => (cursor += weight) >= ticket);
    }
    const face = definition.faces[faceIndex];
    const result = die.result ?? face.result;
    const numericValue =
      die.numericValue ?? face.value ?? (typeof result === 'number' ? result : 0);
    if (!Number.isFinite(numericValue))
      throw new Error(`Custom die '${definition.id}' face requires a finite numeric value`);
    return {
      result,
      numericValue,
      sides: definition.id,
      customDiceId: definition.id,
      faceIndex,
      faceLabel: face.label,
      faceMetadata: face.metadata,
    };
  }

  const sides = die.sides ?? parseSides(die.type);
  const result = die.result ?? rollValue(sides, rng);
  const numericValue = die.numericValue ?? numericResult(result);
  return { result, numericValue, sides, customDiceId: die.customDiceId };
}

function normalizedStructuredDie(
  template: PlannedDie,
  resolved: ResolvedStructuredDie,
  sourceRollIndex: number,
  generatedBy: NonNullable<NormalizedDieResult['generatedBy']>,
  rollThemeId?: string,
): NormalizedDieResult {
  return {
    id: template.id,
    type: template.type,
    sides: typeof resolved.sides === 'number' ? resolved.sides : undefined,
    result: resolved.result,
    numericValue: resolved.numericValue,
    faceIndex: resolved.faceIndex,
    faceLabel: resolved.faceLabel,
    faceMetadata: resolved.faceMetadata,
    kept: true,
    themeId: template.themeId ?? rollThemeId,
    customDiceId: resolved.customDiceId,
    appearance: template.appearance,
    physics: template.physics,
    sourceRollIndex,
    generatedBy,
    annotations: template.annotations,
    metadata: template.metadata,
  };
}

function numericDieResult(die: NormalizedDieResult): number {
  return die.numericValue ?? numericResult(die.result);
}

function parseSides(type: string): number | 'F' {
  if (type.toLowerCase() === 'df') return 'F';
  if (type.toLowerCase() === 'd%') return 100;
  const match = /^d(\d+)$/i.exec(type);
  if (!match) throw new Error(`Cannot infer sides from die type '${type}'`);
  return Number(match[1]);
}

function applyStructuredOperations(
  dice: NormalizedDieResult[],
  configured: readonly StructuredRollOperation[],
  operations: RollOperation[],
  state: StructuredOperationState,
): number | undefined {
  let successOperation: StructuredRollOperation | undefined;
  for (const operation of configured) {
    if (state.instrumented) state.operationSteps += 1;
    const scoped = structuredScope(dice, operation, state);
    const selector = structuredSelector(operation);
    let affected: NormalizedDieResult[] = [];

    if (
      operation.type === 'keep-highest' ||
      operation.type === 'keep-lowest' ||
      operation.type === 'drop-highest' ||
      operation.type === 'drop-lowest'
    ) {
      const genericType = operation.type.startsWith('keep') ? 'keep' : 'drop';
      const rank = operation.type.endsWith('highest') ? 'highest' : 'lowest';
      affected = selectStructuredDice(scoped, { type: rank, target: operation.count ?? 1 });
      applyStructuredKeepDrop(scoped, genericType, { type: rank, target: operation.count ?? 1 });
    } else if (operation.type === 'keep' || operation.type === 'drop') {
      affected = selectStructuredDice(scoped, selector);
      applyStructuredKeepDrop(scoped, operation.type, selector);
    } else if (operation.type === 'minimum' || operation.type === 'maximum') {
      affected = scoped.filter((candidate) => candidate.kept);
      const target = selector.target;
      for (const die of affected) {
        const value = numericDieResult(die);
        const next =
          operation.type === 'minimum' ? Math.max(value, target) : Math.min(value, target);
        die.numericValue = next;
        if (typeof die.result === 'number') die.result = next;
      }
    } else if (operation.type === 'success-count') {
      affected = selectStructuredDice(scoped, selector);
      successOperation = operation;
    } else if (operation.type === 'reroll-add') {
      const original = selectStructuredDice(scoped, selector)[0];
      if (original) {
        affected = [original];
        dice.push(createStructuredGeneratedDie(original, 'reroll-add', state));
      }
    } else if (operation.type === 'reroll' || operation.type === 'reroll-once') {
      const selected = selectStructuredDice(scoped, selector);
      for (const original of selected) {
        let current = original;
        while (true) {
          affected.push(current);
          current.kept = false;
          state.rerolls += 1;
          if (state.rerolls > state.limits.maxRerolls) {
            throw new DiceLimitError(`Rerolls exceed ${state.limits.maxRerolls}`);
          }
          const replacement = createStructuredGeneratedDie(current, 'reroll', state);
          dice.push(replacement);
          current = replacement;
          if (
            operation.type === 'reroll-once' ||
            isRankSelector(selector) ||
            !matchesSelector(numericDieResult(current), selector)
          )
            break;
        }
      }
    } else if (operation.type === 'explode') {
      const queue = [...selectStructuredDice(scoped, selector)];
      for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index];
        affected.push(current);
        state.explosions += 1;
        if (state.explosions > state.limits.maxExplosions) {
          throw new DiceLimitError(`Explosions exceed ${state.limits.maxExplosions}`);
        }
        const exploded = createStructuredGeneratedDie(current, 'explosion', state);
        dice.push(exploded);
        if (!isRankSelector(selector) && matchesSelector(numericDieResult(exploded), selector))
          queue.push(exploded);
      }
    }

    operations.push({
      type: operation.type,
      count: operation.count,
      comparator: operation.comparator,
      target: operation.target ?? selector.target,
      selector,
      notation: operation.notation,
      appliedTo: affected.map((die) => die.id),
      metadata: operation.dice?.length ? { configuredDice: [...operation.dice] } : undefined,
    });
  }
  if (!successOperation) return undefined;
  const finalScope = structuredScope(dice, successOperation, state);
  return selectStructuredDice(finalScope, structuredSelector(successOperation)).length;
}

function structuredScope(
  dice: readonly NormalizedDieResult[],
  operation: StructuredRollOperation,
  state: StructuredOperationState,
): NormalizedDieResult[] {
  if (!operation.dice?.length) return [...dice];
  const configured = new Set(operation.dice);
  return dice.filter(
    (die) => configured.has(die.id) || configured.has(state.rootByDieId.get(die.id) ?? die.id),
  );
}

function selectStructuredDice(
  dice: readonly NormalizedDieResult[],
  selector: RollSelector,
): NormalizedDieResult[] {
  const active = dice.filter((die) => die.kept);
  if (selector.type === 'highest' || selector.type === 'lowest') {
    const count = Math.max(0, Math.trunc(selector.target));
    const sorted = active.toSorted(
      (left, right) => numericDieResult(left) - numericDieResult(right),
    );
    return selector.type === 'highest'
      ? sorted.slice(Math.max(0, sorted.length - count))
      : sorted.slice(0, count);
  }
  return active.filter((die) => matchesSelector(numericDieResult(die), selector));
}

function createStructuredGeneratedDie(
  source: NormalizedDieResult,
  generatedBy: 'reroll' | 'reroll-add' | 'explosion',
  state: StructuredOperationState,
): NormalizedDieResult {
  state.generatedDice += 1;
  if (state.generatedDice > state.limits.maxGeneratedDice) {
    throw new DiceLimitError(`Generated dice exceed ${state.limits.maxGeneratedDice}`);
  }
  const rootId = state.rootByDieId.get(source.id) ?? source.id;
  const rootTemplate = state.templatesByRoot.get(rootId);
  if (!rootTemplate) throw new Error(`Cannot resolve source die '${rootId}' for ${generatedBy}`);
  const prefix = `${rootId}__${generatedBy.replace('-', '_')}_`;
  let id: string;
  do {
    id = `${prefix}${state.nextGeneratedId++}`;
  } while (state.usedIds.has(id));
  state.usedIds.add(id);
  const template: PlannedDie = {
    ...rootTemplate,
    id,
    result: undefined,
    numericValue: undefined,
    faceIndex: undefined,
    themeId: source.themeId ?? rootTemplate.themeId,
    customDiceId: source.customDiceId ?? rootTemplate.customDiceId,
    appearance: source.appearance ?? rootTemplate.appearance,
    physics: source.physics ?? rootTemplate.physics,
    annotations: source.annotations ?? rootTemplate.annotations,
    metadata: rootTemplate.metadata,
  };
  const resolved = resolveStructuredDie(template, state.rng, state.resolveCustom);
  const generated = normalizedStructuredDie(
    template,
    resolved,
    source.sourceRollIndex ?? 0,
    generatedBy,
    state.rollThemeId,
  );
  generated.generatedFromDieId = source.id;
  state.rootByDieId.set(id, rootId);
  return generated;
}

function structuredSelector(operation: StructuredRollOperation): RollSelector {
  if (operation.selector) return operation.selector;
  if (operation.type === 'keep-highest') return { type: 'highest', target: operation.count ?? 1 };
  if (operation.type === 'keep-lowest') return { type: 'lowest', target: operation.count ?? 1 };
  if (operation.type === 'drop-highest') return { type: 'highest', target: operation.count ?? 1 };
  if (operation.type === 'drop-lowest') return { type: 'lowest', target: operation.count ?? 1 };
  return comparisonToSelector(operation.comparator ?? '=', operation.target ?? 0);
}

function applyStructuredKeepDrop(
  dice: NormalizedDieResult[],
  type: 'keep' | 'drop',
  selector: RollSelector,
): void {
  const items = dice
    .map((die) => ({
      die,
      value: numericDieResult(die),
    }))
    .filter(({ die }) => die.kept);
  let selected: typeof items;
  if (selector.type === 'highest' || selector.type === 'lowest') {
    const sorted = items.toSorted((a, b) => a.value - b.value);
    selected =
      selector.type === 'highest'
        ? sorted.slice(Math.max(0, sorted.length - Math.trunc(selector.target)))
        : sorted.slice(0, Math.trunc(selector.target));
  } else {
    selected = items.filter((item) => matchesSelector(item.value, selector));
  }
  const selectedIds = new Set(selected.map((item) => item.die.id));
  for (const { die } of items)
    die.kept = type === 'keep' ? selectedIds.has(die.id) : !selectedIds.has(die.id);
}

function comparisonToSelector(comparator: ComparisonOperator, target: number): RollSelector {
  switch (comparator) {
    case '=':
    case '==':
      return { type: 'literal', target };
    case '!=':
      return { type: 'not-equal', target };
    case '<':
      return { type: 'less', target };
    case '<=':
      return { type: 'less-equal', target };
    case '>':
      return { type: 'greater', target };
    case '>=':
      return { type: 'greater-equal', target };
  }
}

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}
