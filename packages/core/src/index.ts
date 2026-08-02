/**
 * Deterministic dice parsing and evaluation primitives.
 *
 * @remarks
 * Provides the headless dice engine, parser, evaluator, diagnostics, formatting, random sources, and roll-tree utilities.
 *
 * @packageDocumentation
 */

import {
  assertNormalizedRollResult,
  decodeRollInput,
  decodeCustomDiceDefinitions,
  decodeRollUpdateInput,
  unwrapDecode,
} from '../../protocol/src/index';
import type {
  AdvantageMode,
  CustomDiceDefinition,
  DiceDialect,
  DisplayRollInput,
  EvaluateRollInput,
  ExternalDieResult,
  NormalizedDieResult,
  NormalizedRollResult,
  PlannedDie,
  RollAuthority,
  RollDieUpdate,
  RollOperation,
  RollTreeNode,
  RollUpdateInput,
  StructuredRollOperation,
} from '../../protocol/src/index';
import { diceDiagnosticFromError, type DiceDiagnostic } from './diagnostics';
import { formatRollResult, stringifyRoll, type FormatRollOptions, type RollStringifier } from './format';
import { profileParse } from './instrumentation-internal';
import type { DiceInstrumentation } from './instrumentation';
import { evaluateParsedExpression, evaluateStructuredInput, type EvaluateOptions } from './evaluator';
import { DEFAULT_LIMITS, type DiceExecutionLimits } from './limits';
import { DiceSyntaxError, parseDiceExpression, type ParseDiceOptions } from './parser';
import { CryptoRng, type DiceRng } from './rng';

export * from './ast';
export * from './diagnostics';
export * from './evaluator';
export * from './format';
export * from './instrumentation';
export * from './limits';
export * from './parser';
export * from './rng';
export * from './tree';

/**
 * Configures parser defaults, execution limits, random generation, custom dice, and profiling.
 *
 * @public
 */
export interface DiceEngineOptions {
  rng?: DiceRng;
  limits?: Partial<DiceExecutionLimits>;
  now?: () => Date;
  /** Default parser dialect. d20 is exact d20-style comparison semantics. */
  dialect?: DiceDialect;
  /** Allow a free-form trailing comment after the expression by default. */
  allowComments?: boolean;
  /** Number of parsed expressions retained. Comments bypass the cache. Defaults to 256. */
  cacheSize?: number;
  customDice?: CustomDiceDefinition[];
  /** Optional low-overhead parser/evaluator profiling sink. */
  instrumentation?: DiceInstrumentation;
}

/**
 * Configures one expression or structured roll evaluation.
 *
 * @public
 */
export interface RollOptions extends Omit<EvaluateOptions, 'now'>, ParseDiceOptions {
  rng?: DiceRng;
  advantage?: AdvantageMode;
}

/**
 * Configures creation of a new result from an existing roll.
 *
 * @public
 */
export interface RerollOptions extends Omit<RollOptions, 'resultOverrides'> {
  /** Authority assigned to the new roll. Individual SDK rerolls default to local. */
  authority?: RollAuthority;
}

/**
 * Configures an immutable revision of an existing normalized roll.
 *
 * @public
 */
export interface UpdateRollOptions extends Omit<RollOptions, 'resultOverrides'> {
  /**
   * Re-evaluate all dice, selected normalized die IDs, or preserve every existing
   * initial value by default. Explicit result patches always win.
   */
  reroll?: boolean | readonly string[];
  /**
   * Formula edits preserve compatible existing values. Adding formula dice without
   * explicit values is rejected unless this is true or those dice are rerolled.
   */
  allowGenerateMissing?: boolean;
  /** Authority is preserved by default, including server and external authority. */
  authority?: RollAuthority;
}

/**
 * Discriminated validation outcome with source-aware diagnostics on failure.
 *
 * @public
 */
export interface DiceValidationResult {
  valid: boolean;
  parsed?: ReturnType<typeof parseDiceExpression>;
  error?: DiceSyntaxError | Error;
  /** Empty for valid expressions; currently contains the first fail-fast parser diagnostic otherwise. */
  diagnostics: readonly DiceDiagnostic[];
}

/**
 * Reusable parsed expression bound to a dice engine.
 *
 * @public
 */
export interface CompiledDiceExpression {
  readonly source: string;
  readonly parsed: ReturnType<typeof parseDiceExpression>;
  roll(options?: RollOptions): NormalizedRollResult;
}

/**
 * Parses, validates, compiles, evaluates, updates, and rerolls dice expressions.
 *
 * @remarks
 * Engine methods return detached normalized results. Revisions and rerolls do not mutate the
 * supplied result, and registered custom-die definitions are validated before use.
 *
 * @example
 * ```ts
 * import { DiceEngine, SeededRng } from '@draftroll/core';
 *
 * const engine = new DiceEngine({ rng: new SeededRng(42) });
 * const result = engine.roll('2d6ro<3');
 * console.log(result.total);
 * ```
 *
 * @public
 */
export class DiceEngine {
  /**
   * Resolved execution limits enforced by this engine.
   */
  readonly limits: DiceExecutionLimits;
  private readonly rng: DiceRng;
  private readonly now: () => Date;
  private readonly dialect: DiceDialect;
  private readonly allowComments: boolean;
  private readonly cacheSize: number;
  private readonly instrumentation?: DiceInstrumentation;
  private readonly parseCache = new Map<string, ReturnType<typeof parseDiceExpression>>();
  private readonly customDice = new Map<string, CustomDiceDefinition>();

  /**
   * Creates a dice engine with immutable defaults and optional custom dice.
   *
   * @param options - Random source, limits, parser defaults, custom dice, and instrumentation.
   * @throws `Error` when an initial custom-die definition is invalid.
   */
  constructor(options: DiceEngineOptions = {}) {
    this.rng = options.rng ?? new CryptoRng();
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.now = options.now ?? (() => new Date());
    this.dialect = options.dialect ?? 'd20';
    this.allowComments = options.allowComments ?? false;
    this.cacheSize = Math.max(0, Math.trunc(options.cacheSize ?? 256));
    this.instrumentation = options.instrumentation;
    for (const definition of options.customDice ?? []) this.registerDie(definition);
  }


  /**
   * Registers or replaces a validated custom-die definition.
   *
   * @param definition - Complete weighted-face definition, copied before storage.
   * @returns This engine for fluent setup.
   * @throws `Error` when the definition is structurally invalid or exceeds safe weight limits.
   */
  registerDie(definition: CustomDiceDefinition): this {
    validateCustomDieDefinition(definition);
    this.customDice.set(definition.id, structuredClone(definition));
    return this;
  }

  /**
   * Removes a custom-die definition by ID.
   */
  unregisterDie(id: string): boolean {
    return this.customDice.delete(id);
  }

  /**
   * Returns a detached copy of a registered custom-die definition.
   */
  getDie(id: string): CustomDiceDefinition | null {
    const definition = this.customDice.get(id);
    return definition ? structuredClone(definition) : null;
  }

  /**
   * Returns detached copies of every registered custom die.
   */
  listDice(): CustomDiceDefinition[] {
    return [...this.customDice.values()].map((definition) => structuredClone(definition));
  }

  /**
   * Parses an expression using this engine’s defaults and bounded cache.
   *
   * @param expression - Dice expression in the selected dialect.
   * @param options - Per-call dialect, trailing-comment, and instrumentation overrides.
   * @returns A detached, source-aware parsed expression.
   * @throws {@link DiceSyntaxError} or {@link DiceLimitError} when parsing fails.
   */
  parse(expression: string, options: ParseDiceOptions = {}) {
    const dialect = options.dialect ?? this.dialect;
    const allowComments = options.allowComments ?? this.allowComments;
    const instrumentation = options.instrumentation ?? this.instrumentation;
    const cacheKey = `${dialect}\u0000${expression}`;
    if (!allowComments && this.cacheSize > 0) {
      const cached = this.parseCache.get(cacheKey);
      if (cached) {
        return profileParse(
          instrumentation,
          { source: expression, dialect, allowComments, cache: 'hit' },
          () => structuredClone(cached),
        );
      }
    }
    const parse = () => parseDiceExpression(expression, this.limits, { dialect, allowComments });
    const parsed = !allowComments && this.cacheSize > 0
      ? profileParse(instrumentation, { source: expression, dialect, allowComments, cache: 'miss' }, parse)
      : parseDiceExpression(expression, this.limits, { dialect, allowComments, instrumentation });
    if (!allowComments && this.cacheSize > 0) {
      this.parseCache.set(cacheKey, structuredClone(parsed));
      if (this.parseCache.size > this.cacheSize) {
        const oldest = this.parseCache.keys().next().value;
        if (oldest !== undefined) this.parseCache.delete(oldest);
      }
    }
    return parsed;
  }

  /**
   * Validates an expression and returns diagnostics instead of throwing.
   *
   * @param expression - Dice expression to inspect.
   * @param options - Per-call parser overrides.
   * @returns A successful parsed expression or a structured failure diagnostic.
   */
  validate(expression: string, options: ParseDiceOptions = {}): DiceValidationResult {
    try {
      return { valid: true, parsed: this.parse(expression, options), diagnostics: [] };
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      return { valid: false, error: normalized, diagnostics: [diceDiagnosticFromError(normalized, expression)] };
    }
  }

  /**
   * Parses an expression once and returns a reusable evaluator.
   */
  compile(expression: string, options: ParseDiceOptions = {}): CompiledDiceExpression {
    const parsed = this.parse(expression, options);
    return {
      source: expression,
      parsed,
      roll: (rollOptions = {}) => evaluateParsedExpression(
        structuredClone(parsed),
        rollOptions.rng ?? this.rng,
        this.limits,
        { ...rollOptions, instrumentation: rollOptions.instrumentation ?? this.instrumentation, now: this.now },
      ),
    };
  }

  /**
   * Evaluates an expression and returns a new normalized roll.
   *
   * @param expression - Dice expression to parse and evaluate.
   * @param options - Random source, dialect, metadata, overrides, and instrumentation.
   * @returns A detached authoritative normalized result.
   * @throws {@link DiceSyntaxError}, {@link DiceLimitError}, or `Error` for invalid evaluation input.
   */
  roll(expression: string, options: RollOptions = {}): NormalizedRollResult {
    const parsed = this.parse(expression, options);
    return evaluateParsedExpression(parsed, options.rng ?? this.rng, this.limits, {
      ...options,
      instrumentation: options.instrumentation ?? this.instrumentation,
      now: this.now,
    });
  }

  /** Exact d20-dialect evaluation, regardless of the engine default dialect. */
  rollD20(expression: string, options: Omit<RollOptions, 'dialect'> = {}): NormalizedRollResult {
    return this.roll(expression, { ...options, dialect: 'd20' });
  }


  /**
   * Formats a normalized result for human-readable output.
   */
  format(result: NormalizedRollResult, options: FormatRollOptions = {}): string {
    return formatRollResult(result, options);
  }

  /**
   * Formats a result through a custom roll stringifier.
   */
  stringify(result: NormalizedRollResult, stringifier?: RollStringifier | ((result: NormalizedRollResult) => string)): string {
    return stringifier ? stringifyRoll(result, stringifier) : formatRollResult(result);
  }

  /**
   * Evaluates structured dice or normalizes an external roll.
   */
  evaluate(input: EvaluateRollInput, options: RollOptions = {}): NormalizedRollResult {
    const decoded = unwrapDecode(decodeRollInput(input));
    if (decoded.mode !== 'evaluate') throw new Error('DiceEngine.evaluate requires evaluate mode');
    input = decoded;
    if (input.expression) return this.roll(input.expression, {
      ...options,
      themeId: input.themeId,
      name: input.name,
      metadata: input.metadata,
      dialect: input.dialect ?? options.dialect,
      advantage: input.advantage ?? options.advantage,
      allowComments: input.allowComments ?? options.allowComments,
    });
    return evaluateStructuredInput(input, options.rng ?? this.rng, this.limits, {
      ...options,
      instrumentation: options.instrumentation ?? this.instrumentation,
      advantage: input.advantage ?? options.advantage,
      customDice: (id) => this.customDice.get(id),
      now: this.now,
    });
  }

  /**
   * Revise an existing roll while keeping its rollId, sequence, and createdAt.
   * The returned result increments revision and records updatedAt.
   */
  update(result: NormalizedRollResult, update: RollUpdateInput, options: UpdateRollOptions = {}): NormalizedRollResult {
    result = assertNormalizedRollResult(result);
    update = unwrapDecode(decodeRollUpdateInput(update));
    const patches = validateUpdatePatches(update.dice ?? []);
    const removed = new Set(update.removeDice ?? []);
    const expression = update.expression === null ? undefined : update.expression ?? result.expression;
    const rerollAll = options.reroll === true;
    const rerollIds = new Set(Array.isArray(options.reroll) ? options.reroll : []);

    if (expression && removed.size > 0) {
      throw new Error('removeDice cannot be used while an expression is active; change the expression instead');
    }

    const next = expression
      ? this.updateExpressionResult(result, expression, patches, update, options, rerollAll, rerollIds)
      : this.updateStructuredResult(result, patches, removed, update, options, rerollAll, rerollIds);

    const finalized = finalizeRevision(result, next, update, options.authority ?? result.authority, this.now);
    if (rerollAll || rerollIds.size > 0) {
      const rerolledDice = rerollAll
        ? result.dice.filter(isRootDie).map((die) => die.id)
        : [...rerollIds];
      finalized.metadata = {
        ...finalized.metadata,
        rerollOf: result.rollId ?? result.createdAt,
        rerolledDice,
        rerollRevision: finalized.revision ?? 0,
      };
    }
    return finalized;
  }

  /**
   * Reroll one or more dice while preserving every other initial die value.
   * Expression rolls are fully re-evaluated, so arithmetic, keep/drop, success
   * counting, rerolls, and explosions are applied again to the new value.
   */
  reroll(result: NormalizedRollResult, dieIds: string | readonly string[], options: RerollOptions = {}): NormalizedRollResult {
    result = assertNormalizedRollResult(result);
    const requested = new Set(typeof dieIds === 'string' ? [dieIds] : dieIds);
    if (requested.size === 0) throw new Error('At least one die ID is required for a reroll');

    const previousById = new Map(result.dice.map((die) => [die.id, die]));
    for (const dieId of requested) {
      const die = previousById.get(dieId);
      if (!die) throw new Error(`Cannot reroll unknown die '${dieId}'`);
      if (!isRootDie(die)) {
        throw new Error(`Die '${dieId}' was generated by ${die.generatedBy ?? 'a modifier'}; reroll its initial source die instead`);
      }
    }

    const metadata = {
      ...result.metadata,
      ...options.metadata,
      rerollOf: result.rollId ?? result.createdAt,
      rerolledDice: [...requested],
    };

    if (result.expression && result.authority !== 'external') {
      const resultOverrides: Record<string, number | string> = {};
      for (const die of result.dice) {
        if (die.generatedBy === 'initial' && !requested.has(die.id)) resultOverrides[die.id] = die.result;
      }
      const next = this.roll(result.expression, {
        ...options,
        authority: options.authority ?? 'local',
        themeId: result.themeId,
        name: result.name,
        metadata,
        resultOverrides,
        dialect: result.dialect,
        advantage: result.advantage,
        allowComments: false,
      });
      next.comment = result.comment;
      return inheritPresentation(result, next, requested);
    }

    const operations: StructuredRollOperation[] = result.operations.map(toStructuredOperation);
    const input: EvaluateRollInput = {
      mode: 'evaluate',
      name: result.name,
      dice: result.dice.filter(isRootDie).map((die) => ({
        id: die.id,
        type: die.type,
        sides: die.sides,
        result: requested.has(die.id) ? undefined : die.result,
        numericValue: requested.has(die.id) ? undefined : die.numericValue,
        themeId: die.themeId,
        customDiceId: die.customDiceId,
        appearance: die.appearance,
        physics: die.physics,
        metadata: die.metadata,
      })),
      operations,
      modifier: result.modifier,
      themeId: result.themeId,
      customDice: result.customDice,
      metadata,
    };
    const next = this.evaluate(input, {
      ...options,
      authority: options.authority ?? 'local',
      metadata,
    });
    next.expression = result.expression;
    next.name = result.name;
    next.annotation = result.annotation;
    next.comment = result.comment;
    return inheritPresentation(result, next, requested);
  }

  private updateExpressionResult(
    previous: NormalizedRollResult,
    expression: string,
    patches: ReadonlyMap<string, RollDieUpdate>,
    update: RollUpdateInput,
    options: UpdateRollOptions,
    rerollAll: boolean,
    rerollIds: ReadonlySet<string>,
  ): NormalizedRollResult {
    const overrides: Record<string, number | string> = {};
    for (const die of previous.dice) {
      if (die.generatedBy !== 'initial' && die.generatedBy !== undefined) continue;
      const patch = patches.get(die.id);
      if (patch?.result !== undefined) overrides[die.id] = patch.result;
      else if (!rerollAll && !rerollIds.has(die.id)) overrides[die.id] = die.result;
    }
    for (const patch of patches.values()) {
      if (patch.result !== undefined) overrides[patch.id] = patch.result;
    }

    if (update.modifier !== undefined) {
      throw new Error('Change the expression to revise a formula modifier');
    }

    const themeId = nullableValue(update.themeId, previous.themeId);
    const next = this.roll(expression, {
      ...options,
      authority: options.authority ?? previous.authority,
      name: update.name === null ? undefined : update.name ?? previous.name,
      themeId,
      metadata: { ...previous.metadata, ...update.metadata, ...options.metadata },
      resultOverrides: overrides,
      dialect: previous.dialect,
      advantage: previous.advantage,
      allowComments: false,
    });
    next.comment = previous.comment;

    const nextById = new Map(next.dice.map((die) => [die.id, die]));
    const nextInitialIds = new Set(next.dice
      .filter((die) => die.generatedBy === 'initial' || die.generatedBy === undefined)
      .map((die) => die.id));
    for (const patch of patches.values()) {
      if (patch.type !== undefined || patch.sides !== undefined || patch.kept !== undefined) {
        throw new Error(`Formula die '${patch.id}' cannot override type, sides, or kept state; change the expression instead`);
      }
      if (patch.result !== undefined) {
        const target = nextById.get(patch.id);
        if (!target) throw new Error(`Formula update does not contain die '${patch.id}'`);
        if (target.generatedBy !== 'initial' && target.generatedBy !== undefined) {
          throw new Error(`Die '${patch.id}' was generated by ${target.generatedBy}; revise its initial source die or the formula instead`);
        }
      }
    }
    for (const dieId of rerollIds) {
      if (!nextInitialIds.has(dieId)) throw new Error(`Cannot reroll unknown formula die '${dieId}'`);
    }

    if (!rerollAll && !options.allowGenerateMissing) {
      const generatedWithoutPermission = next.dice.filter((die) => (
        (die.generatedBy === 'initial' || die.generatedBy === undefined)
        && overrides[die.id] === undefined
        && !rerollIds.has(die.id)
      ));
      if (generatedWithoutPermission.length > 0) {
        throw new Error(
          `Formula update requires values for new dice: ${generatedWithoutPermission.map((die) => die.id).join(', ')}. `
          + 'Provide explicit die results, include those IDs in reroll, set reroll: true, or set allowGenerateMissing: true.',
        );
      }
    }

    next.dice = applyPresentationAndPatches(previous, next.dice, patches, false);
    if (update.total !== undefined) { next.total = update.total; next.integerTotal = Math.trunc(update.total); }
    if (update.annotation !== undefined) next.annotation = update.annotation;
    if (update.comment !== undefined) next.comment = update.comment;
    return next;
  }

  private updateStructuredResult(
    previous: NormalizedRollResult,
    patches: ReadonlyMap<string, RollDieUpdate>,
    removed: ReadonlySet<string>,
    update: RollUpdateInput,
    options: UpdateRollOptions,
    rerollAll: boolean,
    rerollIds: ReadonlySet<string>,
  ): NormalizedRollResult {
    const previousById = new Map(previous.dice.map((die) => [die.id, die]));
    const rootDice = previous.dice.filter(isRootDie);
    const rootIds = new Set(rootDice.map((die) => die.id));

    for (const dieId of removed) {
      const die = previousById.get(dieId);
      if (!die) throw new Error(`Cannot remove unknown die '${dieId}'`);
      if (!isRootDie(die)) throw new Error(`Cannot remove generated die '${dieId}'; remove its source die or revise the operations instead`);
    }
    for (const patch of patches.values()) {
      const die = previousById.get(patch.id);
      if (die && !isRootDie(die)) {
        throw new Error(`Cannot patch generated die '${patch.id}'; patch its source die or revise the operations instead`);
      }
    }

    const planned = rootDice
      .filter((die) => !removed.has(die.id))
      .map((die) => plannedDieFromUpdate(die, patches.get(die.id), rerollAll || rerollIds.has(die.id)));

    for (const patch of patches.values()) {
      if (rootIds.has(patch.id) || removed.has(patch.id)) continue;
      if (!patch.type) throw new Error(`New die '${patch.id}' requires type`);
      if (patch.result === undefined && !rerollAll && !rerollIds.has(patch.id) && !options.allowGenerateMissing) {
        throw new Error(`New die '${patch.id}' requires result, reroll permission, or allowGenerateMissing: true`);
      }
      planned.push({
        id: patch.id,
        type: patch.type,
        sides: patch.sides,
        result: patch.result,
        numericValue: patch.numericValue,
        faceIndex: patch.faceIndex,
        themeId: patch.themeId ?? nullableValue(update.themeId, previous.themeId),
        customDiceId: patch.customDiceId ?? undefined,
        appearance: patch.appearance ?? undefined,
        physics: patch.physics ?? undefined,
        annotations: patch.annotations ?? undefined,
        metadata: patch.metadata ?? undefined,
      });
    }

    const plannedIds = new Set(planned.map((die) => die.id));
    for (const dieId of rerollIds) {
      if (!plannedIds.has(dieId)) throw new Error(`Cannot reroll unknown die '${dieId}'`);
    }

    // `toStructuredOperation` already returns a fresh object, so it is safe to
    // assign the filtered dice in place rather than allocating a second copy.
    const operations = previous.operations.map(toStructuredOperation).map((operation) =>
      Object.assign(operation, { dice: operation.dice?.filter((dieId) => !removed.has(dieId)) }));
    const modifier = update.modifier === undefined ? previous.modifier : update.modifier ?? undefined;
    const themeId = nullableValue(update.themeId, previous.themeId);
    const metadata = { ...previous.metadata, ...update.metadata, ...options.metadata };
    const portableCustomDice = previous.customDice;

    let next: NormalizedRollResult;
    if (operations.length === 0) {
      const exactDice = planned.map((die) => {
        const resolved = this.resolvePlannedDie(die, options.rng ?? this.rng, portableCustomDice);
        return {
          ...die,
          result: resolved.result,
          numericValue: resolved.numericValue,
          kept: patches.get(die.id)?.kept ?? previousById.get(die.id)?.kept ?? true,
        };
      });
      const calculatedTotal = exactDice
        .filter((die) => die.kept)
        .reduce((sum, die) => sum + (die.numericValue ?? (typeof die.result === 'number' ? die.result : Number(die.result) || 0)), 0)
        + (modifier ?? 0);
      next = normalizeExternalRoll({
        dice: exactDice,
        name: update.name === null ? undefined : update.name ?? previous.name,
        total: update.total ?? calculatedTotal,
        expression: undefined,
        themeId,
        annotation: update.annotation === undefined ? previous.annotation : update.annotation,
        comment: update.comment === undefined ? previous.comment : update.comment,
        customDice: portableCustomDice,
        metadata,
      }, { authority: options.authority ?? previous.authority, now: this.now });
      next.modifier = modifier;
      next.dice = applyPresentationAndPatches(previous, next.dice, patches, true);
    } else {
      next = this.evaluate({
        mode: 'evaluate',
        name: update.name === null ? undefined : update.name ?? previous.name,
        dice: planned,
        operations,
        modifier,
        themeId,
        customDice: portableCustomDice,
        metadata,
      }, {
        ...options,
        authority: options.authority ?? previous.authority,
      });
      next.annotation = update.annotation === undefined ? previous.annotation : update.annotation;
      next.comment = update.comment === undefined ? previous.comment : update.comment;
      if (update.total !== undefined) {
        next.total = update.total;
        next.integerTotal = Math.trunc(update.total);
      }
      next.dice = applyPresentationAndPatches(previous, next.dice, patches, false);
    }
    return next;
  }

  private resolvePlannedDie(
    die: PlannedDie,
    rng: DiceRng,
    inlineDefinitions?: readonly CustomDiceDefinition[],
  ): { result: number | string; numericValue: number } {
    const inlineDice = customDiceMap(inlineDefinitions);
    const customId = die.customDiceId ?? (inlineDice.has(die.type) || this.customDice.has(die.type) ? die.type : undefined);
    if (customId) {
      const definition = inlineDice.get(customId) ?? this.customDice.get(customId);
      if (!definition) throw new Error(`Unknown custom die '${customId}'`);
      const weights = definition.faces.map((face) => face.weight ?? 1);
      for (const weight of weights) {
        if (!Number.isSafeInteger(weight) || weight < 1) throw new Error(`Custom die '${customId}' weights must be positive integers`);
      }
      let index: number;
      if (die.faceIndex !== undefined) {
        index = die.faceIndex;
        if (!Number.isSafeInteger(index) || index < 0 || index >= definition.faces.length) {
          throw new Error(`Face index ${index} is invalid for custom die '${customId}'`);
        }
        if (die.result !== undefined && definition.faces[index].result !== die.result) {
          throw new Error(`Face index ${index} does not match result '${String(die.result)}' for custom die '${customId}'`);
        }
      } else if (die.result !== undefined) {
        index = definition.faces.findIndex((face) => face.result === die.result);
        if (index < 0) throw new Error(`Result '${String(die.result)}' is not a face of custom die '${customId}'`);
      } else {
        const ticket = rng.integer(1, weights.reduce((sum, weight) => sum + weight, 0));
        let cursor = 0;
        index = weights.findIndex((weight) => (cursor += weight) >= ticket);
      }
      const face = definition.faces[index];
      const result = die.result ?? face.result;
      return {
        result,
        numericValue: die.numericValue ?? face.value ?? (typeof result === 'number' ? result : 0),
      };
    }
    if (die.type.toLowerCase() === 'df') {
      const result = die.result ?? rng.integer(-1, 1);
      return { result, numericValue: die.numericValue ?? Number(result) };
    }
    const maximum = die.sides ?? numericSides(die.type);
    if (!maximum) throw new Error(`Cannot generate a value for unsupported die type '${die.type}'`);
    const result = die.result ?? rng.integer(1, maximum);
    return { result, numericValue: die.numericValue ?? Number(result) };
  }
}

/**
 * Normalizes trusted external die results into the canonical roll schema.
 *
 * @public
 */
export function normalizeExternalRoll(
  input: DisplayRollInput | { dice: ExternalDieResult[]; name?: string; total?: number; expression?: string; themeId?: string; annotation?: string | null; comment?: string | null; customDice?: CustomDiceDefinition[]; metadata?: Record<string, unknown> },
  options: { authority?: RollAuthority; now?: () => Date } = {},
): NormalizedRollResult {
  const decoded = unwrapDecode(decodeRollInput({ ...input, mode: 'display' }));
  if (decoded.mode !== 'display') throw new Error('normalizeExternalRoll requires display mode');
  input = decoded;
  const inlineCustomDice = customDiceMap(input.customDice);
  const dice: NormalizedDieResult[] = input.dice.map((die, index) => {
    const customId = die.customDiceId ?? (inlineCustomDice.has(die.type) ? die.type : undefined);
    const definition = customId ? inlineCustomDice.get(customId) : undefined;
    let faceIndex = die.faceIndex;
    let faceLabel: string | undefined;
    let faceMetadata: Record<string, unknown> | undefined;
    let numericValue = die.numericValue;

    if (definition) {
      if (faceIndex !== undefined) {
        if (!Number.isSafeInteger(faceIndex) || faceIndex < 0 || faceIndex >= definition.faces.length) {
          throw new Error(`Face index ${faceIndex} is invalid for custom die '${definition.id}'`);
        }
        if (definition.faces[faceIndex].result !== die.result) {
          throw new Error(`Face index ${faceIndex} does not match result '${String(die.result)}' for custom die '${definition.id}'`);
        }
      } else {
        faceIndex = definition.faces.findIndex((face) => face.result === die.result);
        if (faceIndex < 0) throw new Error(`Result '${String(die.result)}' is not a face of custom die '${definition.id}'`);
      }
      const face = definition.faces[faceIndex];
      faceLabel = face.label;
      faceMetadata = face.metadata;
      numericValue ??= face.value ?? (typeof die.result === 'number' ? die.result : 0);
    }

    return {
      id: die.id || `die_${index + 1}`,
      type: die.type,
      sides: definition ? undefined : die.sides ?? numericSides(die.type),
      result: die.result,
      numericValue,
      faceIndex,
      faceLabel,
      faceMetadata,
      kept: die.kept ?? true,
      themeId: die.themeId ?? input.themeId,
      customDiceId: customId,
      appearance: die.appearance,
      physics: die.physics,
      sourceRollIndex: die.sourceRollIndex ?? index,
      generatedBy: die.generatedBy ?? 'external',
      generatedFromDieId: die.generatedFromDieId,
      annotations: die.annotations,
      metadata: die.metadata,
    };
  });
  const calculated = dice
    .filter((die) => die.kept)
    .reduce((sum, die) => sum + (die.numericValue ?? (typeof die.result === 'number' ? die.result : Number(die.result) || 0)), 0);
  const total = input.total ?? calculated;
  const tree: RollTreeNode = {
    kind: 'set',
    id: 'node_root',
    value: total,
    kept: true,
    annotations: [],
    diceIds: dice.map((die) => die.id),
    children: dice.map((die, index) => ({
      kind: 'die',
      id: `node_${index + 1}`,
      dieId: die.id,
      sides: die.customDiceId ?? (die.type.toLowerCase() === 'df' ? 'F' : die.sides ?? numericSides(die.type) ?? 0),
      generatedBy: die.generatedBy ?? 'external',
      value: die.numericValue ?? (typeof die.result === 'number' ? die.result : Number(die.result) || 0),
      kept: die.kept,
      annotations: die.annotations ?? [],
      diceIds: [die.id],
    })),
  };
  return {
    schemaVersion: 1,
    authority: options.authority ?? 'external',
    name: input.name,
    expression: input.expression,
    total,
    integerTotal: Math.trunc(total),
    dice,
    operations: [],
    annotation: input.annotation ?? null,
    comment: input.comment ?? null,
    critical: 'none',
    dialect: 'd20',
    advantage: 'none',
    tree,
    themeId: input.themeId,
    metadata: input.metadata,
    customDice: input.customDice?.map((definition) => structuredClone(definition)),
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
  };
}

function validateUpdatePatches(patches: readonly RollDieUpdate[]): Map<string, RollDieUpdate> {
  const map = new Map<string, RollDieUpdate>();
  for (const patch of patches) {
    if (!patch.id) throw new Error('Every die update requires an id');
    if (map.has(patch.id)) throw new Error(`Duplicate die update for '${patch.id}'`);
    map.set(patch.id, patch);
  }
  return map;
}

function plannedDieFromUpdate(
  previous: NormalizedDieResult,
  patch: RollDieUpdate | undefined,
  reroll: boolean,
): PlannedDie {
  return {
    id: previous.id,
    type: patch?.type ?? previous.type,
    sides: patch?.sides ?? previous.sides,
    result: patch?.result !== undefined ? patch.result : reroll ? undefined : previous.result,
    numericValue: patch?.numericValue !== undefined
      ? patch.numericValue
      : reroll || patch?.result !== undefined || patch?.faceIndex !== undefined
        ? undefined
        : previous.numericValue,
    faceIndex: patch?.faceIndex !== undefined
      ? patch.faceIndex
      : reroll || patch?.result !== undefined
        ? undefined
        : previous.faceIndex,
    themeId: patch?.themeId === null ? undefined : patch?.themeId ?? previous.themeId,
    customDiceId: patch?.customDiceId === null ? undefined : patch?.customDiceId ?? previous.customDiceId,
    appearance: patch?.appearance === null ? undefined : patch?.appearance ?? previous.appearance,
    physics: patch?.physics === null ? undefined : patch?.physics ?? previous.physics,
    annotations: patch?.annotations === null ? undefined : patch?.annotations ?? previous.annotations,
    metadata: patch?.metadata === null ? undefined : patch?.metadata ?? previous.metadata,
  };
}

function applyPresentationAndPatches(
  previous: NormalizedRollResult,
  dice: NormalizedDieResult[],
  patches: ReadonlyMap<string, RollDieUpdate>,
  allowKeptPatch: boolean,
): NormalizedDieResult[] {
  const previousById = new Map(previous.dice.map((die) => [die.id, die]));
  const initialBySource = previous.dice.filter((die) => die.generatedBy === 'initial' || die.generatedBy === 'external' || die.generatedBy === undefined);
  return dice.map((die) => {
    const source = previousById.get(die.id) ?? initialBySource.find((candidate) => (
      candidate.sourceRollIndex === die.sourceRollIndex && candidate.type === die.type
    ));
    const patch = patches.get(die.id);
    return {
      ...die,
      themeId: patch?.themeId === null ? undefined : patch?.themeId ?? source?.themeId ?? die.themeId,
      customDiceId: patch?.customDiceId === null ? undefined : patch?.customDiceId ?? source?.customDiceId ?? die.customDiceId,
      appearance: patch?.appearance === null ? undefined : patch?.appearance ?? source?.appearance ?? die.appearance,
      physics: patch?.physics === null ? undefined : patch?.physics ?? source?.physics ?? die.physics,
      annotations: patch?.annotations === null ? undefined : patch?.annotations ?? source?.annotations ?? die.annotations,
      metadata: patch?.metadata === null
        ? undefined
        : patch?.metadata
          ?? (isRootDie(die) && source?.result === die.result && source?.faceIndex === die.faceIndex ? source?.metadata : die.metadata),
      kept: allowKeptPatch ? patch?.kept ?? die.kept : die.kept,
    };
  });
}

function finalizeRevision(
  previous: NormalizedRollResult,
  next: NormalizedRollResult,
  update: RollUpdateInput,
  authority: RollAuthority,
  now: () => Date,
): NormalizedRollResult {
  const updatedAt = now().toISOString();
  return {
    ...next,
    rollId: previous.rollId,
    sequence: previous.sequence,
    revision: (previous.revision ?? 0) + 1,
    updatedAt,
    authority,
    name: update.name === null ? undefined : update.name ?? next.name ?? previous.name,
    createdAt: previous.createdAt,
    expression: update.expression === null ? undefined : next.expression,
    themeId: nullableValue(update.themeId, next.themeId),
    annotation: update.annotation === undefined ? next.annotation : update.annotation,
    comment: update.comment === undefined ? next.comment : update.comment,
    integerTotal: Math.trunc(next.total),
    modifier: update.modifier === undefined ? next.modifier : update.modifier ?? undefined,
    metadata: {
      ...previous.metadata,
      ...next.metadata,
      ...update.metadata,
      draftrollRevision: (previous.revision ?? 0) + 1,
      revisedAt: updatedAt,
    },
  };
}

function inheritPresentation(
  previous: NormalizedRollResult,
  next: NormalizedRollResult,
  rerolledIds: ReadonlySet<string>,
): NormalizedRollResult {
  const previousById = new Map(previous.dice.map((die) => [die.id, die]));
  const initialBySource = previous.dice.filter((die) => die.generatedBy === 'initial' || die.generatedBy === 'external');

  next.dice = next.dice.map((die) => {
    const exact = previousById.get(die.id);
    const source = exact ?? initialBySource.find((candidate) => (
      candidate.sourceRollIndex === die.sourceRollIndex && candidate.type === die.type
    ));
    const preserveMetadata = isRootDie(die) && !rerolledIds.has(die.id)
      && source?.result === die.result && source?.faceIndex === die.faceIndex;
    return {
      ...die,
      themeId: source?.themeId ?? die.themeId,
      customDiceId: source?.customDiceId ?? die.customDiceId,
      appearance: source?.appearance ?? die.appearance,
      physics: source?.physics ?? die.physics,
      annotations: source?.annotations ?? die.annotations,
      metadata: preserveMetadata ? source?.metadata ?? die.metadata : die.metadata,
      generatedBy: die.generatedBy,
    };
  });
  return next;
}

function toStructuredOperation(operation: RollOperation): StructuredRollOperation {
  const configured = operation.metadata?.configuredDice;
  const dice = Array.isArray(configured)
    ? configured.filter((value): value is string => typeof value === 'string')
    : undefined;
  if (operation.type === 'keep-highest' || operation.type === 'keep-lowest' || operation.type === 'drop-highest' || operation.type === 'drop-lowest') {
    return { type: operation.type, count: operation.count ?? operation.selector?.target ?? 1, notation: operation.notation, dice };
  }
  return { type: operation.type, selector: operation.selector, notation: operation.notation, dice };
}

function isRootDie(die: NormalizedDieResult): boolean {
  return die.generatedBy === undefined || die.generatedBy === 'initial' || die.generatedBy === 'external';
}

function validateCustomDieDefinition(definition: CustomDiceDefinition): void {
  const decoded = decodeCustomDiceDefinitions([definition], { rejectUnknownFields: true });
  if (!decoded.success) throw decoded.error;
}

function customDiceMap(definitions?: readonly CustomDiceDefinition[]): Map<string, CustomDiceDefinition> {
  const map = new Map<string, CustomDiceDefinition>();
  for (const definition of definitions ?? []) {
    validateCustomDieDefinition(definition);
    if (map.has(definition.id)) throw new Error(`Duplicate custom die definition '${definition.id}'`);
    map.set(definition.id, definition);
  }
  return map;
}

function nullableValue<T>(value: T | null | undefined, fallback: T | undefined): T | undefined {
  return value === null ? undefined : value ?? fallback;
}

function numericSides(type: string): number | undefined {
  if (type.toLowerCase() === 'd%') return 100;
  const match = /^d(\d+)$/i.exec(type);
  return match ? Number(match[1]) : undefined;
}
