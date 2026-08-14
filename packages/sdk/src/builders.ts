import type {
  CustomDiceDefinition,
  CustomDieFace,
  PlannedDie,
  RollSelector,
  StructuredRollOperation,
} from '../../protocol/src/index';

/**
 * Optional fields accepted by standard planned-die builders.
 *
 * @public
 */
export type PlannedDieOptions = Omit<PlannedDie, 'id' | 'type' | 'sides' | 'customDiceId'>;
/**
 * Optional fields accepted by custom planned-die builders.
 *
 * @public
 */
export type CustomPlannedDieOptions = Omit<PlannedDie, 'id' | 'type' | 'customDiceId'>;
/**
 * Optional stable die IDs restricting a structured operation.
 *
 * @public
 */
export type OperationDiceScope = readonly string[] | undefined;

function numericDie(sides: number, id: string, options: PlannedDieOptions = {}): PlannedDie {
  if (!Number.isSafeInteger(sides) || sides < 1)
    throw new Error('Dice sides must be a positive safe integer');
  if (!id) throw new Error('A stable die ID is required');
  return { ...options, id, type: `d${sides}`, sides };
}

/**
 * Typed factories for structured rolls. Stable IDs make rerolls, themes, and revisions predictable.
 *
 * @public
 */
export const dice = Object.freeze({
  d: numericDie,
  d4: (id: string, options?: PlannedDieOptions) => numericDie(4, id, options),
  d6: (id: string, options?: PlannedDieOptions) => numericDie(6, id, options),
  d8: (id: string, options?: PlannedDieOptions) => numericDie(8, id, options),
  d10: (id: string, options?: PlannedDieOptions) => numericDie(10, id, options),
  d12: (id: string, options?: PlannedDieOptions) => numericDie(12, id, options),
  d20: (id: string, options?: PlannedDieOptions) => numericDie(20, id, options),
  d100: (id: string, options?: PlannedDieOptions) => numericDie(100, id, options),
  percentile: (id: string, options: PlannedDieOptions = {}): PlannedDie => ({
    ...options,
    id,
    type: 'd%',
    sides: 100,
  }),
  fate: (id: string, options: PlannedDieOptions = {}): PlannedDie => ({
    ...options,
    id,
    type: 'dF',
  }),
  custom: (definitionId: string, id: string, options: CustomPlannedDieOptions = {}): PlannedDie => {
    if (!definitionId) throw new Error('A custom die definition ID is required');
    if (!id) throw new Error('A stable die ID is required');
    return { ...options, id, type: definitionId, customDiceId: definitionId };
  },
});

/**
 * Selector factories shared by keep/drop, reroll, explode, and success-count operations.
 *
 * @public
 */
export const selectors = Object.freeze({
  equal: (target: number): RollSelector => ({ type: 'literal', target }),
  notEqual: (target: number): RollSelector => ({ type: 'not-equal', target }),
  lessThan: (target: number): RollSelector => ({ type: 'less', target }),
  lessOrEqual: (target: number): RollSelector => ({ type: 'less-equal', target }),
  greaterThan: (target: number): RollSelector => ({ type: 'greater', target }),
  greaterOrEqual: (target: number): RollSelector => ({ type: 'greater-equal', target }),
  highest: (count = 1): RollSelector => ({ type: 'highest', target: count }),
  lowest: (count = 1): RollSelector => ({ type: 'lowest', target: count }),
});

function withScope(
  operation: StructuredRollOperation,
  scope?: OperationDiceScope,
): StructuredRollOperation {
  return scope?.length ? { ...operation, dice: [...scope] } : operation;
}

/**
 * Typed operation factories for notation-free game integrations.
 *
 * @public
 */
export const operations = Object.freeze({
  keep: (selector: RollSelector, scope?: OperationDiceScope) =>
    withScope({ type: 'keep', selector }, scope),
  drop: (selector: RollSelector, scope?: OperationDiceScope) =>
    withScope({ type: 'drop', selector }, scope),
  keepHighest: (count = 1, scope?: OperationDiceScope) =>
    withScope({ type: 'keep-highest', count }, scope),
  keepLowest: (count = 1, scope?: OperationDiceScope) =>
    withScope({ type: 'keep-lowest', count }, scope),
  dropHighest: (count = 1, scope?: OperationDiceScope) =>
    withScope({ type: 'drop-highest', count }, scope),
  dropLowest: (count = 1, scope?: OperationDiceScope) =>
    withScope({ type: 'drop-lowest', count }, scope),
  reroll: (selector: RollSelector, scope?: OperationDiceScope) =>
    withScope({ type: 'reroll', selector }, scope),
  rerollOnce: (selector: RollSelector, scope?: OperationDiceScope) =>
    withScope({ type: 'reroll-once', selector }, scope),
  rerollAdd: (selector: RollSelector, scope?: OperationDiceScope) =>
    withScope({ type: 'reroll-add', selector }, scope),
  explode: (selector: RollSelector, scope?: OperationDiceScope) =>
    withScope({ type: 'explode', selector }, scope),
  minimum: (target: number, scope?: OperationDiceScope) =>
    withScope({ type: 'minimum', target }, scope),
  maximum: (target: number, scope?: OperationDiceScope) =>
    withScope({ type: 'maximum', target }, scope),
  countSuccesses: (selector: RollSelector, scope?: OperationDiceScope) =>
    withScope({ type: 'success-count', selector }, scope),
});

/**
 * Short aliases for call sites that prefer `op` and `select`.
 *
 * @public
 */
export const op = operations;
/**
 * Short alias for {@link selectors}.
 *
 * @public
 */
export const select = selectors;

/**
 * Identity helper that gives custom-die definitions inference at the call site.
 *
 * @public
 */
export function defineDie<const T extends CustomDiceDefinition>(definition: T): T {
  return definition;
}

/**
 * Numeric, symbolic, or fully configured custom-die face input.
 *
 * @public
 */
export type CommonDiceFaceInput = number | string | Readonly<CustomDieFace>;

/**
 * Shared identifier and metadata options for common-dice factories.
 *
 * @public
 */
export interface CommonDiceFactoryOptions {
  /** Override the renderer fallback selected by the helper. */
  renderAs?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Coin-specific labels, values, and weighting options.
 *
 * @public
 */
export interface CoinDiceFactoryOptions extends CommonDiceFactoryOptions {
  headsResult?: number | string;
  tailsResult?: number | string;
  headsValue?: number;
  tailsValue?: number;
  headsLabel?: string;
  tailsLabel?: string;
  headsWeight?: number;
  tailsWeight?: number;
}

function requireDefinitionId(id: string): string {
  const normalized = id.trim();
  if (!normalized) throw new Error('A custom die definition ID is required');
  return normalized;
}

function normalizeCommonFace(input: CommonDiceFaceInput): CustomDieFace {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('Custom die numeric faces must be finite');
    return { result: input, value: input, label: String(input) };
  }
  if (typeof input === 'string') return { result: input, value: 0, label: input };
  if (!input || typeof input !== 'object')
    throw new Error('Custom die faces must be numbers, strings, or face objects');
  if (typeof input.result !== 'number' && typeof input.result !== 'string') {
    throw new Error('Custom die face results must be numbers or strings');
  }

  if (typeof input.result === 'number' && !Number.isFinite(input.result)) {
    throw new Error('Custom die numeric faces must be finite');
  }
  if (input.value !== undefined && !Number.isFinite(input.value)) {
    throw new Error('Custom die face values must be finite');
  }
  if (input.weight !== undefined && (!Number.isSafeInteger(input.weight) || input.weight < 1)) {
    throw new Error('Custom die face weights must be positive safe integers');
  }
  return {
    ...input,
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };
}

function makeCommonDefinition(
  id: string,
  faces: readonly CommonDiceFaceInput[],
  defaultRenderAs: string,
  options: CommonDiceFactoryOptions = {},
): CustomDiceDefinition {
  const definitionId = requireDefinitionId(id);
  if (!faces.length) throw new Error(`Custom die '${definitionId}' requires at least one face`);
  return {
    id: definitionId,
    faces: faces.map(normalizeCommonFace),
    renderAs: options.renderAs ?? defaultRenderAs,
    metadata: options.metadata ? { ...options.metadata } : undefined,
  };
}

function coinDefinition(id = 'coin', options: CoinDiceFactoryOptions = {}): CustomDiceDefinition {
  return makeCommonDefinition(
    id,
    [
      {
        result: options.headsResult ?? 'heads',
        value: options.headsValue ?? 1,
        label: options.headsLabel ?? 'Heads',
        weight: options.headsWeight,
      },
      {
        result: options.tailsResult ?? 'tails',
        value: options.tailsValue ?? 0,
        label: options.tailsLabel ?? 'Tails',
        weight: options.tailsWeight,
      },
    ],
    'coin',
    options,
  );
}

function fateDefinition(id = 'fate', options: CommonDiceFactoryOptions = {}): CustomDiceDefinition {
  return makeCommonDefinition(
    id,
    [
      { result: -1, value: -1, label: '−' },
      { result: -1, value: -1, label: '−' },
      { result: 0, value: 0, label: '0' },
      { result: 0, value: 0, label: '0' },
      { result: 1, value: 1, label: '+' },
      { result: 1, value: 1, label: '+' },
    ],
    'fate',
    options,
  );
}

function percentilePairDefinition(
  id = 'percentile-pair',
  options: CommonDiceFactoryOptions = {},
): CustomDiceDefinition {
  const faces: CustomDieFace[] = Array.from({ length: 100 }, (_, index) => {
    const percentile = index + 1;
    const tens = percentile === 100 ? 0 : Math.floor(percentile / 10) * 10;
    const ones = percentile % 10;
    const tensLabel = String(tens).padStart(2, '0');
    const onesLabel = String(ones);
    return {
      result: percentile,
      value: percentile,
      label: `${tensLabel} / ${onesLabel}`,
      metadata: {
        percentile,
        tens,
        ones,
        tensLabel,
        onesLabel,
      },
    };
  });
  return makeCommonDefinition(id, faces, 'percentile', options);
}

function symbolPoolDefinition(
  id: string,
  faces: readonly CommonDiceFaceInput[],
  options: CommonDiceFactoryOptions = {},
): CustomDiceDefinition {
  return makeCommonDefinition(id, faces, 'token', options);
}

function tableDefinition(
  id: string,
  entries: readonly CommonDiceFaceInput[],
  options: CommonDiceFactoryOptions = {},
): CustomDiceDefinition {
  return makeCommonDefinition(id, entries, 'spinner', options);
}

function cardDefinition(
  id: string,
  cards: readonly CommonDiceFaceInput[],
  options: CommonDiceFactoryOptions = {},
): CustomDiceDefinition {
  return makeCommonDefinition(id, cards, 'card', options);
}

/**
 * Portable custom-die definition factories for common nonstandard randomizers.
 *
 * @remarks
 * Card and table helpers perform independent weighted draws with replacement. Deck depletion,
 * shuffling, and without-replacement state remain host-owned.
 *
 * @example
 * ```ts
 * import { commonDice } from '@draftroll/sdk';
 *
 * const fate = commonDice.fate('fate');
 * const loot = commonDice.tableDraw('loot', ['coins', 'potion', 'map']);
 * ```
 *
 * @public
 */
export const commonDice = Object.freeze({
  coin: coinDefinition,
  fate: fateDefinition,
  percentilePair: percentilePairDefinition,
  symbolPool: symbolPoolDefinition,
  tableDraw: tableDefinition,
  cardDraw: cardDefinition,
  /** Terse aliases for common builder call sites. */
  symbols: symbolPoolDefinition,
  table: tableDefinition,
  cards: cardDefinition,
});
