/**
 * Headless Draftroll SDK and lifecycle-managed realtime sessions.
 *
 * @remarks
 * This entry point intentionally avoids a static browser renderer dependency. Use `@draftroll/sdk/browser` for overlay and renderer exports.
 *
 * @packageDocumentation
 */

import {
  DiceEngine,
  normalizeExternalRoll,
  type CompiledDiceExpression,
  type DiceInstrumentation,
  type FormatRollOptions,
  type RerollOptions,
  type RollOptions,
  type RollStringifier,
  type UpdateRollOptions,
} from '../../core/src/index';
import {
  DiceRoom,
  type DiceRoomOptions,
  type SynchronizedRollStart,
  type SynchronizedRollUpdate,
  type SynchronizedVisibilityUpdate,
  type SynchronizedRoomPolicyUpdate,
  type SynchronizedRoomTokenRevocation,
} from '../../client/src/index';
import { assertNormalizedRollResult } from '../../protocol/src/index';
import type {
  CustomDiceDefinition,
  DisplayRollInput,
  EvaluateRollInput,
  NormalizedDieResult,
  NormalizedRollResult,
  ProjectedRollVisibility,
  PlannedDie,
  StructuredRollOperation,
  RollUpdateAnimationMode,
  RollUpdateInput,
  RollInput,
  RollAuditDetails,
  RollVisibility,
  RoomActor,
  RoomPolicy,
  RoomPolicyPatch,
  RoomTokenRevocationTarget,
  BulkRollUpdateItem,
  BulkRollUpdatedEvent,
} from '../../protocol/src/index';
import type {
  DiceRenderer,
  RendererCompletion,
  RendererDismissOptions,
  RendererPlayOptions,
  RendererCameraOptions,
  RendererInteractionOptions,
  RendererParticipantFilter,
  RendererPreviewOptions,
  RendererPerformanceOptions,
} from '../../renderer/src/index';
import type {
  DraftrollOverlayOptions,
  RerollDieRequest,
} from '../../overlay/src/index';
import {
  DRAFTROLL_ERROR_CODES,
  DraftrollError,
  DraftrollStateError,
  throwIfAborted,
} from '../../errors/src/index';

/**
 * Configures a high-level Draftroll SDK instance.
 *
 * @public
 */
export interface DraftrollOptions {
  engine?: DiceEngine;
  renderer?: DiceRenderer;
  /** Used when Draftroll constructs its own DiceEngine. */
  instrumentation?: DiceInstrumentation;
}

/**
 * Per-roll theme selection by default, index, die ID, or callback.
 *
 * @public
 */
export type DiceThemeSelection =
  | string
  | readonly (string | undefined)[]
  | Readonly<Record<string, string>>
  | ((die: NormalizedDieResult, index: number) => string | undefined);

/**
 * Configures one SDK roll and its optional presentation.
 *
 * @public
 */
export interface SdkRollOptions extends Omit<RollOptions, 'customDice'> {
  render?: boolean;
  renderer?: RendererPlayOptions;
  /** Per-die theme assignment. Arrays follow normalized dice order; objects use die IDs. */
  themes?: DiceThemeSelection;
}


/**
 * Expression-based request accepted by the SDK.
 *
 * @public
 */
export interface DraftrollRollRequest extends SdkRollOptions {
  expression: string;
}

/**
 * Structured-dice request accepted by the SDK.
 *
 * @public
 */
export interface DraftrollStructuredRequest extends Omit<EvaluateRollInput, 'mode' | 'expression' | 'dice' | 'operations'>, SdkRollOptions {
  dice: PlannedDie[];
  operations?: StructuredRollOperation[];
}

/**
 * Payload map for local SDK events.
 *
 * @public
 */
export type DraftrollEventMap = {
  roll: SdkRollResponse;
  display: SdkRollResponse;
  update: SdkRollResponse;
  reroll: SdkRollResponse;
  error: { error: Error; expression?: string };
};

/**
 * Event names emitted by a local Draftroll SDK.
 *
 * @public
 */
export type DraftrollEventName = keyof DraftrollEventMap;

/**
 * Controls an SDK reroll and its optional presentation.
 *
 * @public
 */
export interface SdkRerollOptions extends Omit<RerollOptions, 'customDice'> {
  render?: boolean;
  renderer?: RendererPlayOptions;
  themes?: DiceThemeSelection;
}

/**
 * Controls an SDK revision, animation mode, and presentation.
 *
 * @public
 */
export interface SdkUpdateOptions extends UpdateRollOptions {
  /** Animate the revised result or update result/history state only. Defaults to log-only. */
  mode?: RollUpdateAnimationMode;
  renderer?: RendererPlayOptions;
  themes?: DiceThemeSelection;
  /** Which dice to animate when mode is animate. Defaults to all. */
  animateDice?: 'all' | 'changed' | readonly string[];
}

/**
 * Stable handle returned for a locally evaluated roll.
 *
 * @public
 */
export interface SdkRollResponse {
  /** Stable logical roll ID. */
  id: string;
  result: NormalizedRollResult;
  total: number;
  dice: readonly NormalizedDieResult[];
  /** Present only when a physical animation was requested. */
  rendering?: Promise<RendererCompletion>;
  /** Resolves after either physical rendering or a log-only result-panel update. */
  presentation?: Promise<RendererCompletion | void>;
  /** Always resolves, including when rendering is disabled. */
  wait: () => Promise<RendererCompletion | void>;
  reroll: (options?: SdkRerollOptions) => SdkRollResponse;
  rerollDie: (dieId: string, options?: SdkRerollOptions) => SdkRollResponse;
  rerollDice: (dieIds: readonly string[], options?: SdkRerollOptions) => SdkRollResponse;
  update: (update: RollUpdateInput, options?: SdkUpdateOptions) => SdkRollResponse;
  updateLog: (update: RollUpdateInput, options?: Omit<SdkUpdateOptions, 'mode'>) => SdkRollResponse;
  animateUpdate: (update: RollUpdateInput, options?: Omit<SdkUpdateOptions, 'mode'>) => SdkRollResponse;
  setDieResult: (dieId: string, result: number | string, options?: SdkUpdateOptions) => SdkRollResponse;
  setFormula: (expression: string, options?: SdkUpdateOptions) => SdkRollResponse;
}

/**
 * Configures creation of an iframe overlay renderer.
 *
 * @public
 */
export interface DraftrollEmbeddedOptions {
  engine?: DiceEngine;
  instrumentation?: DiceInstrumentation;
  overlay?: DraftrollOverlayOptions;
  warmupThemes?: string[];
  signal?: AbortSignal;
}

type PresentationMode = RollUpdateAnimationMode | 'none';

/**
 * High-level headless SDK for rolling, revising, formatting, and optionally presenting dice.
 *
 * @remarks
 * Evaluation is synchronous. When a renderer is attached, each roll handle also exposes a
 * `presentation` promise that resolves after every reroll or explosion stage has settled.
 *
 * @example
 * ```ts
 * import { Draftroll } from '@draftroll/sdk';
 *
 * const draftroll = new Draftroll();
 * const roll = draftroll.roll('2d4e');
 * await roll.presentation;
 * console.log(roll.total);
 * ```
 *
 * @public
 */
export class Draftroll {
  /**
   * Headless dice engine used by this SDK.
   */
  readonly engine: DiceEngine;
  private currentRenderer?: DiceRenderer;
  private currentResult: NormalizedRollResult | null = null;
  private readonly logById = new Map<string, NormalizedRollResult>();
  private readonly revisionsById = new Map<string, NormalizedRollResult[]>();
  private readonly presentationDiceById = new Map<string, NormalizedDieResult[]>();
  private readonly logOrder: string[] = [];
  private localRollCounter = 0;
  private readonly handlers = new Map<DraftrollEventName, Set<(event: never) => void>>();
  private readonly rendererStateUnsubscribers: Array<() => void> = [];

  /**
   * Creates a high-level SDK around a dice engine and optional renderer.
   */
  constructor(options: DraftrollOptions = {}) {
    this.engine = options.engine ?? new DiceEngine({ instrumentation: options.instrumentation });
    this.setRenderer(options.renderer);
  }

  /**
   * Currently attached renderer, if any.
   */
  get renderer(): DiceRenderer | undefined {
    return this.currentRenderer;
  }

  /** Attach or detach presentation without replacing the engine, log, or SDK subscriptions. */
  setRenderer(renderer?: DiceRenderer): DiceRenderer | undefined {
    const previous = this.currentRenderer;
    if (previous === renderer) return previous;
    this.rendererStateUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    this.presentationDiceById.clear();
    this.bindInteractiveRenderer(previous, null);
    this.currentRenderer = renderer;
    this.bindInteractiveRenderer(renderer, async ({ result, dieId }) => {
      const response = this.rerollDie(result, dieId);
      await response.presentation;
    });
    if (renderer?.on) {
      this.rendererStateUnsubscribers.push(
        renderer.on('cleared', () => this.presentationDiceById.clear()),
        renderer.on('dissolveFinished', () => this.presentationDiceById.clear()),
      );
    }
    return previous;
  }

  private bindInteractiveRenderer(
    renderer: DiceRenderer | undefined,
    handler: ((request: RerollDieRequest) => Promise<void>) | null,
  ): void {
    const interactive = renderer as DiceRenderer & {
      setRerollHandler?: (handler: ((request: RerollDieRequest) => Promise<void>) | null) => void;
    };
    interactive?.setRerollHandler?.(handler);
  }

  /** Mount a transparent renderer over the current website and return a ready SDK. */
  static async createOverlay(options: DraftrollEmbeddedOptions = {}): Promise<Draftroll> {
    const { DraftrollOverlayRenderer } = await import('../../overlay/src/index');
    throwIfAborted(options.signal, 'Draftroll overlay creation');
    const renderer = new DraftrollOverlayRenderer(options.overlay);
    await renderer.mount(options.signal);
    if (options.warmupThemes?.length) await renderer.warmup(options.warmupThemes, options.signal);
    return new Draftroll({ engine: options.engine, instrumentation: options.instrumentation, renderer });
  }


  /**
   * Subscribes to an SDK event and returns an unsubscribe function.
   */
  on<K extends DraftrollEventName>(event: K, handler: (payload: DraftrollEventMap[K]) => void): () => void {
    const set = this.handlers.get(event) ?? new Set<(event: never) => void>();
    set.add(handler);
    this.handlers.set(event, set);
    return () => set.delete(handler);
  }

  /**
   * Validates a dice expression without throwing.
   */
  validate(expression: string, options: Pick<SdkRollOptions, 'dialect' | 'allowComments' | 'instrumentation'> = {}) {
    return this.engine.validate(expression, options);
  }

  /** Parse once and reuse the expression in hot game loops. */
  compile(expression: string, options: Pick<SdkRollOptions, 'dialect' | 'allowComments' | 'instrumentation'> = {}): CompiledDiceExpression {
    return this.engine.compile(expression, options);
  }

  /** Register a weighted, symbolic, or otherwise game-specific die. */
  registerDie(definition: CustomDiceDefinition): this {
    this.engine.registerDie(definition);
    return this;
  }

  /**
   * Removes a custom die from the underlying engine.
   */
  unregisterDie(id: string): boolean {
    return this.engine.unregisterDie(id);
  }

  /**
   * Returns a registered custom-die definition.
   */
  getDie(id: string): CustomDiceDefinition | null {
    return this.engine.getDie(id);
  }

  /**
   * Lists registered custom-die definitions.
   */
  listDice(): CustomDiceDefinition[] {
    return this.engine.listDice();
  }

  /** Format a normalized result or SDK roll handle for logs and game UI. */
  format(result: NormalizedRollResult | SdkRollResponse, options: FormatRollOptions = {}): string {
    return this.engine.format('result' in result ? result.result : result, options);
  }

  /**
   * Formats a normalized result through a custom stringifier.
   */
  stringify(
    result: NormalizedRollResult | SdkRollResponse,
    stringifier?: RollStringifier | ((result: NormalizedRollResult) => string),
  ): string {
    return this.engine.stringify('result' in result ? result.result : result, stringifier);
  }

  /**
   * Rolls an expression and returns a discriminated success or failure result.
   */
  tryRoll(expression: string, options?: SdkRollOptions): { ok: true; roll: SdkRollResponse } | { ok: false; error: Error } {
    try {
      return { ok: true, roll: this.roll(expression, options) };
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { error: normalized, expression });
      return { ok: false, error: normalized };
    }
  }

  /**
   * Most recent roll retained by the SDK log.
   */
  get lastResult(): NormalizedRollResult | null {
    return this.currentResult;
  }

  /** Current revision of each roll, in creation order. Updating a roll replaces its log entry. */
  get rollLog(): readonly NormalizedRollResult[] {
    return this.logOrder.map((rollId) => this.logById.get(rollId)).filter((result): result is NormalizedRollResult => Boolean(result));
  }

  /**
   * Returns a retained roll by logical ID.
   */
  getRoll(rollId: string): NormalizedRollResult | null {
    return this.logById.get(rollId) ?? null;
  }

  /** Immutable snapshots for revision 0 through the latest known revision. */
  getRollRevisions(rollId: string): readonly NormalizedRollResult[] {
    return this.revisionsById.get(rollId) ?? [];
  }


  /**
   * Clears retained roll history without clearing the renderer.
   */
  clearLog(): void {
    this.currentResult = null;
    this.logById.clear();
    this.revisionsById.clear();
    this.presentationDiceById.clear();
    this.logOrder.length = 0;
  }

  /**
   * Evaluates a roll request and optionally presents it.
   */
  roll(expression: string, options?: SdkRollOptions): SdkRollResponse;
  /**
   * Evaluates a roll request and optionally presents it.
   */
  roll(request: DraftrollRollRequest): SdkRollResponse;
  /**
   * Evaluates a roll request and optionally presents it.
   */
  roll(expressionOrRequest: string | DraftrollRollRequest, options: SdkRollOptions = {}): SdkRollResponse {
    const expression = typeof expressionOrRequest === 'string' ? expressionOrRequest : expressionOrRequest.expression;
    const resolved = typeof expressionOrRequest === 'string' ? options : expressionOrRequest;
    const { render = true, renderer, themes, ...engineOptions } = resolved;
    const evaluated = this.engine.roll(expression, engineOptions);
    const result = this.ensureRollIdentity(applyDiceThemes(evaluated, themes));
    return this.createResponse(result, render ? 'animate' : 'none', renderer, 'roll');
  }


  /** Roll a structured pool without requiring dice notation. */
  rollDice(request: DraftrollStructuredRequest): SdkRollResponse {
    const {
      render = true,
      renderer,
      themes,
      dice,
      operations,
      rng,
      instrumentation,
      resultOverrides,
      authority,
      ...input
    } = request;
    const evaluated = this.engine.evaluate({
      ...input,
      mode: 'evaluate',
      dice,
      operations,
    }, { rng, instrumentation, resultOverrides, authority });
    const result = this.ensureRollIdentity(applyDiceThemes(evaluated, themes));
    return this.createResponse(result, render ? 'animate' : 'none', renderer, 'roll');
  }

  /** Evaluate any normalized evaluate input; useful for adapters and game engines. */
  evaluate(input: Omit<EvaluateRollInput, 'mode'> | EvaluateRollInput, options: SdkRollOptions = {}): SdkRollResponse {
    const { render = true, renderer, themes, ...engineOptions } = options;
    const evaluated = this.engine.evaluate({ ...input, mode: 'evaluate' }, engineOptions);
    const result = this.ensureRollIdentity(applyDiceThemes(evaluated, themes));
    return this.createResponse(result, render ? 'animate' : 'none', renderer, 'roll');
  }

  /**
   * Normalizes and presents an external roll.
   */
  display(input: Omit<DisplayRollInput, 'mode'> | DisplayRollInput, rendererOptions?: RendererPlayOptions): SdkRollResponse {
    const result = this.ensureRollIdentity(normalizeExternalRoll({ ...input, mode: 'display' }));
    return this.createResponse(result, 'animate', rendererOptions, 'display');
  }

  /** Present an already-normalized local, server, or external result without changing its authority. */
  present(result: NormalizedRollResult, rendererOptions?: RendererPlayOptions): SdkRollResponse {
    return this.createResponse(result, 'animate', rendererOptions, 'display');
  }

  /** Replace the transient result display and SDK log without replaying physical dice. */
  presentUpdate(result: NormalizedRollResult): SdkRollResponse {
    return this.createResponse(result, 'log-only', undefined, 'update');
  }

  /** Dissolve the currently visible physical dice. */
  async dismiss(options: RendererDismissOptions = {}): Promise<void> {
    await this.renderer?.dismiss?.(options);
    this.presentationDiceById.clear();
  }

  /** Remove the currently visible physical dice immediately. */
  async clearDice(): Promise<void> {
    await this.renderer?.clear?.();
    this.presentationDiceById.clear();
  }

  /**
   * Pauses active renderer animation.
   */
  async pausePresentation(): Promise<void> {
    await this.requireRendererCapability('pause')();
  }

  /**
   * Resumes renderer animation.
   */
  async resumePresentation(): Promise<void> {
    await this.requireRendererCapability('resume')();
  }

  /**
   * Captures the attached renderer as an image blob.
   */
  async screenshot(): Promise<Blob | string> {
    return this.requireRendererCapability('screenshot')();
  }

  /**
   * Applies camera controls to the attached renderer.
   */
  async configureCamera(options: RendererCameraOptions): Promise<void> {
    await this.requireRendererCapability('configureCamera')(options);
  }

  /**
   * Restores the renderer camera defaults.
   */
  async resetCamera(): Promise<void> {
    await this.requireRendererCapability('resetCamera')();
  }

  /**
   * Displays a non-authoritative renderer preview.
   */
  async preview(options: RendererPreviewOptions = {}): Promise<RendererCompletion> {
    return this.requireRendererCapability('preview')(options);
  }

  /**
   * Limits visible table groups by participant.
   */
  setParticipantFilter(filter?: RendererParticipantFilter): void {
    this.currentRenderer?.setParticipantFilter?.(filter);
  }

  /**
   * Configures renderer pointer and drag interactions.
   */
  async configureInteractions(options: RendererInteractionOptions): Promise<void> {
    await this.requireRendererCapability('configureInteractions')(options);
  }

  /**
   * Revise a completed roll. Formula, dice, total, annotation, themes, and metadata
   * can change. The same rollId/log position is retained and revision increments.
   */
  updateRoll(resultOrId: NormalizedRollResult | string, update: RollUpdateInput, options: SdkUpdateOptions = {}): SdkRollResponse {
    const previous = this.resolveResult(resultOrId);
    const { mode = 'log-only', renderer, themes, animateDice = 'all', ...engineOptions } = options;
    const revised = applyDiceThemes(this.engine.update(previous, update, engineOptions), themes);
    const rendererOptions = mode === 'animate'
      ? { ...renderer, dieIds: resolveAnimatedDieIds(previous, revised, animateDice) }
      : renderer;
    return this.createResponse(revised, mode, rendererOptions, 'update');
  }

  /**
   * Updates the most recently retained roll.
   */
  updateLastRoll(update: RollUpdateInput, options: SdkUpdateOptions = {}): SdkRollResponse {
    if (!this.currentResult) throw new Error('There is no Draftroll result to update');
    return this.updateRoll(this.currentResult, update, options);
  }

  /**
   * Rerolls one die while retaining prior dice for presentation history.
   */
  rerollDie(result: NormalizedRollResult, dieId: string, options: SdkRerollOptions = {}): SdkRollResponse {
    return this.rerollDice(result, [dieId], options);
  }

  /**
   * Rerolls selected dice while retaining prior dice for presentation history.
   */
  rerollDice(result: NormalizedRollResult, dieIds: readonly string[], options: SdkRerollOptions = {}): SdkRollResponse {
    const { render = true, renderer, themes, ...engineOptions } = options;
    const rerolled = this.engine.reroll(result, dieIds, engineOptions);
    const revised = applyDiceThemes(asRevision(result, rerolled), themes);
    return this.createResponse(revised, render ? 'animate' : 'none', {
      ...renderer,
      dieIds: renderer?.dieIds ?? dieIds,
    }, 'reroll');
  }

  /**
   * Creates a revision with a new theme for one die.
   */
  setDieTheme(result: NormalizedRollResult, dieId: string, themeId: string): NormalizedRollResult {
    return this.updateRoll(result, { dice: [{ id: dieId, themeId }] }, { mode: 'log-only' }).result;
  }

  /**
   * Binds an existing room client to this SDK.
   */
  bindRoom(room: DiceRoom, options: Omit<RendererPlayOptions, 'startTime' | 'animationSeed'> = {}): () => void {
    if (!this.renderer) throw new Error('A renderer is required to bind a realtime room');
    const unbindStart = room.on('rollStart', (event) => this.renderSynchronized(event, options));
    const unbindUpdate = room.on('rollUpdate', (event) => this.applySynchronizedUpdate(event, options));
    return () => {
      unbindStart();
      unbindUpdate();
    };
  }

  /** Connect this SDK instance to a realtime room with automatic presentation and roll handles. */
  async connectRoom(options: DraftrollRoomSessionOptions): Promise<DraftrollRoomSession> {
    return DraftrollRoomSession.connect(this, options);
  }

  private observePresentation<T>(
    operation: () => Promise<T> | T,
    details: { rollId?: string; operation: string },
  ): Promise<T> {
    let started: Promise<T>;
    try {
      started = Promise.resolve(operation());
    } catch (error) {
      started = Promise.reject(error);
    }
    const normalizedPromise = started.catch((error) => {
      const normalized = error instanceof DraftrollError
        ? error
        : new DraftrollError(DRAFTROLL_ERROR_CODES.rendererOperationFailed, `Renderer operation '${details.operation}' failed`, {
            package: 'sdk',
            recoverable: true,
            details,
            cause: error,
          });
      this.emit('error', { error: normalized });
      throw normalized;
    });
    void normalizedPromise.catch(() => undefined);
    return normalizedPromise;
  }

  private requireRendererCapability<K extends keyof Pick<DiceRenderer, 'pause' | 'resume' | 'screenshot' | 'configureCamera' | 'resetCamera' | 'preview' | 'configureInteractions'>>(
    capability: K,
  ): NonNullable<DiceRenderer[K]> {
    const method = this.currentRenderer?.[capability];
    if (typeof method !== 'function') {
      throw new DraftrollError(DRAFTROLL_ERROR_CODES.rendererUnavailable, `The active renderer does not support ${capability}`, {
        package: 'sdk', recoverable: true, details: { capability },
      });
    }
    return method.bind(this.currentRenderer) as NonNullable<DiceRenderer[K]>;
  }

  private createResponse(
    result: NormalizedRollResult,
    mode: PresentationMode,
    rendererOptions?: RendererPlayOptions,
    eventName?: Exclude<DraftrollEventName, 'error'>,
  ): SdkRollResponse {
    result = assertNormalizedRollResult(result);
    const identified = this.ensureRollIdentity(result);
    const previous = identified.rollId ? this.logById.get(identified.rollId) : undefined;
    const rerolledDieIds = previous ? readRerolledDieIds(identified) : [];
    const previousPresentationDice = identified.rollId
      ? this.presentationDiceById.get(identified.rollId) ?? previous?.dice
      : previous?.dice;
    const rerollPresentation = mode === 'animate'
      && previous
      && previousPresentationDice
      && rerolledDieIds.length > 0
      && rendererOptions?.preservePreviousDice !== false
      ? createRerollPresentation(previous, previousPresentationDice, identified, rerolledDieIds)
      : null;
    const presentationResult = rerollPresentation?.result ?? identified;
    const effectiveRendererOptions = rerollPresentation ? {
      ...rendererOptions,
      dieIds: rerollPresentation.dieIds,
      stateDieIds: rerollPresentation.stateDieIds,
      preservePreviousDice: true,
      replaceFallbackResult: identified,
    } : rendererOptions;
    this.storeResult(identified);

    const rollId = identified.rollId;
    const previousPresentationEntry = rollId ? this.presentationDiceById.get(rollId) : undefined;
    const stagedPresentationEntry = mode === 'animate' && this.renderer && rollId
      ? clonePresentationDice(rerollPresentation?.result.dice ?? identified.dice)
      : undefined;
    if (rollId && stagedPresentationEntry) this.presentationDiceById.set(rollId, stagedPresentationEntry);

    let rendering: Promise<RendererCompletion> | undefined;
    let presentation: Promise<RendererCompletion | void> | undefined;
    if (this.renderer) {
      if (mode === 'animate') {
        rendering = this.observePresentation(
          () => this.renderer!.playRoll(presentationResult, effectiveRendererOptions),
          { rollId, operation: 'playRoll' },
        ).then(
          (completion) => {
            if (
              rollId
              && stagedPresentationEntry
              && this.presentationDiceById.get(rollId) === stagedPresentationEntry
              && completion.presentationMode === 'replace'
            ) {
              this.presentationDiceById.set(rollId, clonePresentationDice(identified.dice));
            }
            return rerollPresentation ? {
              ...completion,
              results: identified.dice.map((die) => die.result),
              total: identified.total,
            } : completion;
          },
          (error) => {
            if (rollId && stagedPresentationEntry && this.presentationDiceById.get(rollId) === stagedPresentationEntry) {
              if (previousPresentationEntry) this.presentationDiceById.set(rollId, previousPresentationEntry);
              else this.presentationDiceById.delete(rollId);
            }
            throw error;
          },
        );
        presentation = rendering;
      } else if (mode === 'log-only') {
        presentation = this.observePresentation(
          () => Promise.resolve(this.renderer?.updateResult?.(identified, { state: 'updated' })),
          { rollId: identified.rollId, operation: 'updateResult' },
        );
      }
    }

    const response: SdkRollResponse = {
      id: identified.rollId as string,
      result: identified,
      total: identified.total,
      dice: identified.dice,
      rendering,
      presentation,
      wait: () => presentation ?? Promise.resolve(),
      reroll: (options) => this.rerollDice(
        identified,
        identified.dice.filter((die) => die.generatedBy === 'initial' || die.generatedBy === 'external' || die.generatedBy === undefined).map((die) => die.id),
        options,
      ),
      rerollDie: (dieId, options) => this.rerollDie(identified, dieId, options),
      rerollDice: (dieIds, options) => this.rerollDice(identified, dieIds, options),
      update: (update, options) => this.updateRoll(identified, update, options),
      updateLog: (update, options) => this.updateRoll(identified, update, { ...options, mode: 'log-only' }),
      animateUpdate: (update, options) => this.updateRoll(identified, update, { ...options, mode: 'animate' }),
      setDieResult: (dieId, dieResult, options) => this.updateRoll(identified, { dice: [{ id: dieId, result: dieResult }] }, options),
      setFormula: (expression, options) => this.updateRoll(identified, { expression }, options),
    };
    if (eventName) this.emit(eventName, response);
    return response;
  }

  private renderSynchronized(event: SynchronizedRollStart, options: RendererPlayOptions): void {
    if (!event.result) return;
    const result = this.ensureRollIdentity(event.result);
    this.storeResult(result);
    if (this.renderer) {
      void this.observePresentation(() => this.renderer!.playRoll(result, {
        ...options,
        startTime: event.localStartTimeMs,
        animationSeed: event.animationSeed,
        elapsedMs: event.elapsedMs,
        animationDurationMs: event.animationDurationMs,
      }), { rollId: result.rollId, operation: 'synchronizedPlayRoll' });
    }
  }

  private applySynchronizedUpdate(event: SynchronizedRollUpdate, options: RendererPlayOptions): void {
    if (!event.result) return;
    const result = this.ensureRollIdentity(event.result);
    this.storeResult(result);
    if (event.animate) {
      if (this.renderer) {
        void this.observePresentation(() => this.renderer!.playRoll(result, {
          ...options,
          startTime: event.localStartTimeMs,
          animationSeed: event.animationSeed,
          elapsedMs: event.elapsedMs,
          animationDurationMs: event.animationDurationMs,
        }), { rollId: result.rollId, operation: 'synchronizedUpdatePlayRoll' });
      }
    } else {
      if (this.renderer?.updateResult) {
        void this.observePresentation(
          () => Promise.resolve(this.renderer!.updateResult!(result, { state: 'updated' })),
          { rollId: result.rollId, operation: 'synchronizedUpdateResult' },
        );
      }
    }
  }

  private emit<K extends DraftrollEventName>(event: K, payload: DraftrollEventMap[K]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        (handler as (value: DraftrollEventMap[K]) => void)(payload);
      } catch {
        // Observer failures cannot alter roll state or renderer orchestration.
      }
    }
  }

  private resolveResult(resultOrId: NormalizedRollResult | string): NormalizedRollResult {
    if (typeof resultOrId !== 'string') return resultOrId;
    const result = this.logById.get(resultOrId);
    if (!result) throw new DraftrollStateError(`Unknown Draftroll roll '${resultOrId}'`, { package: 'sdk' });
    return result;
  }

  private ensureRollIdentity(result: NormalizedRollResult): NormalizedRollResult {
    if (result.rollId) return { ...result, revision: result.revision ?? 0 };
    this.localRollCounter += 1;
    const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}_${this.localRollCounter.toString(36)}`;
    return { ...result, rollId: `local_${randomId}`, revision: result.revision ?? 0 };
  }

  private storeResult(result: NormalizedRollResult): void {
    const rollId = result.rollId;
    if (!rollId) throw new DraftrollStateError('Draftroll result identity was not assigned', { package: 'sdk' });
    if (!this.logById.has(rollId)) this.logOrder.push(rollId);
    this.logById.set(rollId, result);
    const revisions = this.revisionsById.get(rollId) ?? [];
    const last = revisions.at(-1);
    if (!last || last.revision !== result.revision || last.updatedAt !== result.updatedAt) {
      revisions.push(structuredClone(result));
      this.revisionsById.set(rollId, revisions);
    }
    this.currentResult = result;
  }
}


/**
 * Configures a realtime SDK room session.
 *
 * @public
 */
export interface DraftrollRoomSessionOptions extends DiceRoomOptions {
  /** Present authorized room events through this Draftroll renderer. Defaults to true. */
  autoPresent?: boolean;
  /** Merge nearby room rolls into one shared physical table throw. Defaults to true. */
  concurrentTableRolls?: boolean;
  /** Base renderer options merged with synchronized start timing and animation seeds. */
  renderer?: Omit<RendererPlayOptions, 'startTime' | 'animationSeed' | 'elapsedMs' | 'animationDurationMs'>;
}

/**
 * Controls one authoritative room-roll revision.
 *
 * @public
 */
export interface DraftrollRoomRollUpdateOptions {
  reroll?: boolean | string[];
  animate?: boolean;
  /** Defaults to the handle's current revision for optimistic concurrency safety. */
  expectedRevision?: number;
  signal?: AbortSignal;
  /** Retry once against the newest revision, or delegate merging to the caller. */
  conflictStrategy?: 'reject' | 'retry-latest' | ((context: { current: DraftrollRoomRoll; update: RollUpdateInput; error: Error }) => RollUpdateInput | null | Promise<RollUpdateInput | null>);
  audit?: RollAuditDetails;
}

/**
 * One roll revision inside an atomic room batch.
 *
 * @public
 */
export interface DraftrollRoomBulkUpdate {
  roll: DraftrollRoomRoll | string;
  update: RollUpdateInput;
  expectedRevision?: number;
  reroll?: boolean | string[];
  animate?: boolean;
  audit?: RollAuditDetails;
}

/**
 * Tracked roll handles returned from an atomic room batch.
 *
 * @public
 */
export interface DraftrollRoomBulkUpdateResult {
  acknowledgement: BulkRollUpdatedEvent;
  rolls: DraftrollRoomRoll[];
}

/**
 * Payload map for realtime SDK session events.
 *
 * @public
 */
export interface DraftrollRoomSessionEventMap {
  roll: DraftrollRoomRoll;
  hiddenRoll: DraftrollRoomRoll;
  sessionReady: import('../../protocol/src/index').SessionReadyEvent;
  roomState: import('../../protocol/src/index').RoomStateEvent;
  participantJoined: import('../../protocol/src/index').ParticipantJoinedEvent;
  participantUpdated: import('../../protocol/src/index').ParticipantUpdatedEvent;
  participantLeft: import('../../protocol/src/index').ParticipantLeftEvent;
  roomPolicyUpdated: SynchronizedRoomPolicyUpdate;
  roomTokenRevoked: SynchronizedRoomTokenRevocation;
  error: { error: Error };
}

/**
 * Event names emitted by a realtime SDK session.
 *
 * @public
 */
export type DraftrollRoomSessionEventName = keyof DraftrollRoomSessionEventMap;

/**
 * High-level realtime session. It keeps protocol concerns out of applications:
 * request correlation, reconnect cursors, permission-projected results, renderer
 * scheduling, and revision-safe roll mutations are handled here.
 *
 * @public
 */
export class DraftrollRoomSession {
  readonly room: DiceRoom;
  readonly draftroll: Draftroll;
  private readonly options: Required<Pick<DraftrollRoomSessionOptions, 'autoPresent' | 'concurrentTableRolls'>> & DraftrollRoomSessionOptions;
  private readonly rolls = new Map<string, DraftrollRoomRoll>();
  private readonly handlers = new Map<DraftrollRoomSessionEventName, Set<(payload: never) => void>>();
  private readonly unsubscribers: Array<() => void> = [];
  private replayPresentationEventSequence: number | null = null;

  private constructor(draftroll: Draftroll, room: DiceRoom, options: DraftrollRoomSessionOptions) {
    this.draftroll = draftroll;
    this.room = room;
    this.options = {
      ...options,
      autoPresent: options.autoPresent ?? true,
      concurrentTableRolls: options.concurrentTableRolls ?? true,
    };
    this.unsubscribers.push(
      room.on('rollStart', (event) => this.receive(event)),
      room.on('rollUpdate', (event) => this.receive(event)),
      room.on('rollVisibilityUpdate', (event) => this.receive(event)),
      room.on('sessionReady', (event) => this.emit('sessionReady', event)),
      room.on('roomState', (event) => {
        this.applyRendererPolicy(event.policy);
        this.replayPresentationEventSequence = findLatestAnimatedReplaySequence(event.recentEvents);
        this.emit('roomState', event);
      }),
      room.on('participantJoined', (event) => this.emit('participantJoined', event)),
      room.on('participantUpdated', (event) => this.emit('participantUpdated', event)),
      room.on('participantLeft', (event) => this.emit('participantLeft', event)),
      room.on('roomPolicyUpdated', (event) => {
        this.applyRendererPolicy(event.policy);
        this.emit('roomPolicyUpdated', event);
      }),
      room.on('roomTokenRevoked', (event) => this.emit('roomTokenRevoked', event)),
      room.on('error', (event) => this.emit('error', event)),
    );
    const existingEvents = room.rollEvents;
    this.replayPresentationEventSequence = findLatestAnimatedReplaySequence(existingEvents);
    existingEvents.forEach((event) => this.receive(event));
    if (room.policy) this.applyRendererPolicy(room.policy);
    room.markReady(Boolean(draftroll.renderer), true);
  }

  /**
   * Connects the underlying room client and returns this session.
   */
  static async connect(draftroll: Draftroll, options: DraftrollRoomSessionOptions): Promise<DraftrollRoomSession> {
    const room = await DiceRoom.connect(options);
    return new DraftrollRoomSession(draftroll, room, options);
  }

  /**
   * Subscribes to a room-session event and returns an unsubscribe function.
   */
  on<K extends DraftrollRoomSessionEventName>(
    event: K,
    handler: (payload: DraftrollRoomSessionEventMap[K]) => void,
  ): () => void {
    const set = this.handlers.get(event) ?? new Set<(payload: never) => void>();
    set.add(handler);
    this.handlers.set(event, set);
    return () => set.delete(handler);
  }

  /**
   * Requests, tracks, and optionally presents an authoritative room roll.
   */
  async roll(
    input: string | RollInput,
    options: { visibility?: RollVisibility; clientRollId?: string; signal?: AbortSignal } = {},
  ): Promise<DraftrollRoomRoll> {
    return this.upsert(await this.room.roll(input, options));
  }

  /**
   * Publishes and optionally presents an external room roll.
   */
  async display(
    input: Omit<DisplayRollInput, 'mode'> | DisplayRollInput,
    options: { visibility?: RollVisibility; clientRollId?: string; signal?: AbortSignal } = {},
  ): Promise<DraftrollRoomRoll> {
    return this.upsert(await this.room.displayRoll(input, options));
  }

  /**
   * Returns a tracked room roll by ID.
   */
  getRoll(rollId: string): DraftrollRoomRoll | null {
    return this.rolls.get(rollId) ?? null;
  }

  /**
   * Snapshot of tracked room-roll handles.
   */
  get rollLog(): readonly DraftrollRoomRoll[] {
    return [...this.rolls.values()];
  }

  /**
   * Current room identifier.
   */
  get roomId(): string {
    return this.room.roomId;
  }

  /**
   * Current room policy snapshot.
   */
  get policy(): RoomPolicy | null {
    return this.room.policy;
  }

  /**
   * Revision number for the current room policy.
   */
  get policyRevision(): number {
    return this.room.policyRevision;
  }

  /**
   * Creates, changes, or removes the room password.
   */
  setPassword(
    password: string | null,
    options: { expectedRevision?: number; signal?: AbortSignal } = {},
  ): Promise<SynchronizedRoomPolicyUpdate> {
    return this.room.setPassword(password, {
      expectedRevision: options.expectedRevision ?? this.room.policyRevision,
      signal: options.signal,
    });
  }

  /**
   * Applies a partial room-policy update.
   */
  setPolicy(
    policy: RoomPolicyPatch,
    options: { expectedRevision?: number; signal?: AbortSignal } = {},
  ): Promise<SynchronizedRoomPolicyUpdate> {
    return this.room.setPolicy(policy, {
      expectedRevision: options.expectedRevision ?? this.room.policyRevision,
      signal: options.signal,
    });
  }

  /**
   * Revokes a room capability token or participant token set.
   */
  revokeToken(
    target: RoomTokenRevocationTarget,
    options: { reason?: string; signal?: AbortSignal } = {},
  ): Promise<SynchronizedRoomTokenRevocation> {
    return this.room.revokeToken(target, options);
  }

  /**
   * Updates the current participant profile.
   */
  updateParticipant(update: { name?: string; metadata?: Record<string, unknown> }): void {
    this.room.updateParticipant(update);
  }

  /**
   * Closes the room and releases session subscriptions.
   */
  close(code = 1000, reason = 'Draftroll room session closed'): void {
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    this.room.close(code, reason);
  }

  /**
   * Applies and tracks one room-roll revision.
   */
  async updateRoll(
    roll: DraftrollRoomRoll,
    update: RollUpdateInput,
    options: DraftrollRoomRollUpdateOptions = {},
  ): Promise<DraftrollRoomRoll> {
    try {
      const event = await this.room.updateRoll(roll.id, update, {
        ...options,
        expectedRevision: options.expectedRevision ?? roll.revision,
      });
      return this.upsert(event);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const strategy = options.conflictStrategy ?? 'reject';
      const isConflict = 'code' in normalized && (normalized as { code?: unknown }).code === DRAFTROLL_ERROR_CODES.revisionConflict;
      if (!isConflict || strategy === 'reject') throw normalized;
      const latest = this.getRoll(roll.id) ?? roll;
      const merged = strategy === 'retry-latest'
        ? update
        : await strategy({ current: latest, update, error: normalized });
      if (!merged) throw normalized;
      const event = await this.room.updateRoll(roll.id, merged, {
        reroll: options.reroll,
        animate: options.animate,
        expectedRevision: latest.revision,
        signal: options.signal,
        audit: options.audit,
      });
      return this.upsert(event);
    }
  }

  /**
   * Applies and tracks an atomic batch of room-roll revisions.
   */
  async bulkUpdateRolls(
    updates: readonly DraftrollRoomBulkUpdate[],
    options: { signal?: AbortSignal } = {},
  ): Promise<DraftrollRoomBulkUpdateResult> {
    throwIfAborted(options.signal, 'Bulk room roll update');
    const items: BulkRollUpdateItem[] = updates.map((entry) => {
      const rollId = typeof entry.roll === 'string' ? entry.roll : entry.roll.id;
      const current = typeof entry.roll === 'string' ? this.getRoll(rollId) : entry.roll;
      return {
        rollId,
        update: entry.update,
        expectedRevision: entry.expectedRevision ?? current?.revision,
        reroll: entry.reroll,
        animate: entry.animate,
        audit: entry.audit,
      };
    });
    const acknowledgement = await this.room.bulkUpdateRolls(items, options);
    const rolls = items.map((item) => {
      const roll = this.getRoll(item.rollId);
      if (!roll) {
        throw new DraftrollStateError(`Bulk update completed but roll '${item.rollId}' is not present in the session log`, {
          details: { rollId: item.rollId, requestId: acknowledgement.requestId },
        });
      }
      return roll;
    });
    return { acknowledgement, rolls };
  }

  /**
   * Changes an existing room roll’s visibility.
   */
  async setRollVisibility(
    roll: DraftrollRoomRoll,
    visibility: RollVisibility,
    options: { expectedRevision?: number; signal?: AbortSignal; audit?: RollAuditDetails } = {},
  ): Promise<DraftrollRoomRoll> {
    const event = await this.room.setRollVisibility(roll.id, visibility, {
      expectedRevision: options.expectedRevision ?? roll.revision,
      signal: options.signal,
      audit: options.audit,
    });
    return this.upsert(event);
  }

  private applyRendererPolicy(policy: RoomPolicy): void {
    const rendererPolicy = policy.renderer;
    if (!rendererPolicy) return;
    const performance: RendererPerformanceOptions = { profile: rendererPolicy.performanceProfile };
    void Promise.resolve(this.draftroll.renderer?.configure?.(performance)).catch((error) => {
      this.emit('error', { error: error instanceof Error ? error : new Error(String(error)) });
    });
  }

  private receive(event: SynchronizedRollStart | SynchronizedRollUpdate | SynchronizedVisibilityUpdate): void {
    const roll = this.upsert(event);
    if (!event.result) {
      this.emit('hiddenRoll', roll);
      return;
    }

    if (this.options.autoPresent) {
      const animated = event.type === 'roll_start' || (event.type === 'roll_updated' && event.animate);
      const shouldPresentReplay = !event.replayed || event.eventSequence === this.replayPresentationEventSequence;
      if (animated && shouldPresentReplay) {
        const roomRenderer = this.room.policy?.renderer;
        roll.presentation = this.draftroll.present(event.result, {
          ...this.options.renderer,
          defaultThemeId: this.options.renderer?.defaultThemeId ?? roomRenderer?.defaultThemeId,
          autoClearMs: this.options.renderer?.autoClearMs ?? roomRenderer?.autoClearMs,
          reducedMotion: this.options.renderer?.reducedMotion ?? roomRenderer?.reducedMotion,
          forceFallback: this.options.renderer?.forceFallback ?? roomRenderer?.fallbackOnly,
          physicsPreset: this.options.renderer?.physicsPreset ?? roomRenderer?.physicsPreset,
          startTime: event.localStartTimeMs,
          animationSeed: event.animationSeed,
          elapsedMs: event.elapsedMs,
          animationDurationMs: event.animationDurationMs,
          lateEvent: this.options.renderer?.lateEvent ?? { mode: 'auto' },
          table: (this.options.concurrentTableRolls && (roomRenderer?.concurrentTableRolls ?? true))
            ? {
                mode: 'concurrent',
                groupId: event.rollId,
                actorLabel: event.actor.name,
                rollLabel: event.summary.name,
                maximumConcurrentVisuals: roomRenderer?.maximumConcurrentVisuals,
                ...this.options.renderer?.table,
              }
            : { mode: 'queue', ...this.options.renderer?.table },
        }).wait();
        if (event.replayed) this.replayPresentationEventSequence = null;
      } else {
        roll.presentation = this.draftroll.presentUpdate(event.result).wait();
      }
    }

    this.emit('roll', roll);
  }

  private upsert(event: SynchronizedRollStart | SynchronizedRollUpdate | SynchronizedVisibilityUpdate): DraftrollRoomRoll {
    const existing = this.rolls.get(event.rollId);
    if (existing) {
      existing.apply(event);
      return existing;
    }
    const created = new DraftrollRoomRoll(this, event);
    this.rolls.set(event.rollId, created);
    return created;
  }

  private emit<K extends DraftrollRoomSessionEventName>(event: K, payload: DraftrollRoomSessionEventMap[K]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        (handler as (value: DraftrollRoomSessionEventMap[K]) => void)(payload);
      } catch {
        // Observer failures cannot alter room state or request completion.
      }
    }
  }
}

/**
 * Stable handle for a logical room roll across rerolls, corrections, and reveals.
 *
 * @public
 */
export class DraftrollRoomRoll {
  presentation: Promise<RendererCompletion | void> = Promise.resolve();
  private event: SynchronizedRollStart | SynchronizedRollUpdate | SynchronizedVisibilityUpdate;

  /**
   * Creates a mutable handle around one room roll event.
   */
  constructor(
    private readonly session: DraftrollRoomSession,
    event: SynchronizedRollStart | SynchronizedRollUpdate | SynchronizedVisibilityUpdate,
  ) {
    this.event = event;
  }

  /**
   * Stable logical roll ID.
   */
  get id(): string { return this.event.rollId; }
  /**
   * Current normalized result, or `null` when hidden.
   */
  get result(): NormalizedRollResult | null { return this.event.result; }
  /**
   * Whether the current participant is denied the roll result.
   */
  get hidden(): boolean { return this.event.hidden; }
  /**
   * Participant that created the roll.
   */
  get actor(): RoomActor { return this.event.actor; }
  /**
   * Projected visibility available to the current participant.
   */
  get visibility(): ProjectedRollVisibility { return this.event.visibility; }
  /**
   * Current authoritative revision number.
   */
  get revision(): number { return this.event.summary.revision; }
  /**
   * Roll-local sequence number.
   */
  get sequence(): number { return this.event.sequence; }
  /**
   * Room-global event sequence number.
   */
  get eventSequence(): number { return this.event.eventSequence; }
  /**
   * Optional display name for the roll.
   */
  get name(): string | undefined { return this.event.summary.name; }
  /**
   * Waits for the current renderer presentation to settle.
   */
  wait(): Promise<RendererCompletion | void> { return this.presentation; }

  /**
   * Applies an authoritative revision to this roll.
   */
  update(update: RollUpdateInput, options: DraftrollRoomRollUpdateOptions = {}): Promise<DraftrollRoomRoll> {
    return this.session.updateRoll(this, update, options);
  }

  /**
   * Applies a revision without requesting renderer animation.
   */
  updateLog(update: RollUpdateInput, options: Omit<DraftrollRoomRollUpdateOptions, 'animate'> = {}): Promise<DraftrollRoomRoll> {
    return this.update(update, { ...options, animate: false });
  }

  /**
   * Applies a revision and animates selected dice.
   */
  animateUpdate(update: RollUpdateInput, options: Omit<DraftrollRoomRollUpdateOptions, 'animate'> = {}): Promise<DraftrollRoomRoll> {
    return this.update(update, { ...options, animate: true });
  }

  /**
   * Rerolls the complete room roll.
   */
  reroll(options: Omit<DraftrollRoomRollUpdateOptions, 'reroll' | 'animate'> = {}): Promise<DraftrollRoomRoll> {
    return this.update({}, { ...options, reroll: true, animate: true });
  }

  /**
   * Rerolls one die and retains previous table dice.
   */
  rerollDie(dieId: string, options: Omit<DraftrollRoomRollUpdateOptions, 'reroll' | 'animate'> = {}): Promise<DraftrollRoomRoll> {
    return this.update({}, { ...options, reroll: [dieId], animate: true });
  }

  /**
   * Corrects one die to an explicit result.
   */
  correctDie(
    dieId: string,
    result: number | string,
    options: DraftrollRoomRollUpdateOptions = {},
  ): Promise<DraftrollRoomRoll> {
    return this.update({ dice: [{ id: dieId, result }] }, options);
  }

  /**
   * Replaces the expression while preserving compatible dice when possible.
   */
  setFormula(expression: string, options: DraftrollRoomRollUpdateOptions = {}): Promise<DraftrollRoomRoll> {
    return this.update({ expression }, options);
  }

  /**
   * Changes this roll’s visibility policy.
   */
  setVisibility(visibility: RollVisibility, options: { expectedRevision?: number; signal?: AbortSignal; audit?: RollAuditDetails } = {}): Promise<DraftrollRoomRoll> {
    return this.session.setRollVisibility(this, visibility, options);
  }

  /**
   * Makes this roll public.
   */
  reveal(options: { expectedRevision?: number; signal?: AbortSignal; audit?: RollAuditDetails } = {}): Promise<DraftrollRoomRoll> {
    return this.setVisibility({ type: 'public' }, options);
  }

  /**
   * Restricts this roll to selected participants.
   */
  whisperToParticipants(participantIds: readonly string[], options: { expectedRevision?: number; signal?: AbortSignal; audit?: RollAuditDetails } = {}): Promise<DraftrollRoomRoll> {
    return this.setVisibility({ type: 'participants', participantIds: [...participantIds] }, options);
  }

  /**
   * Restricts this roll to selected roles.
   */
  whisperToRoles(roles: readonly string[], options: { expectedRevision?: number; signal?: AbortSignal; audit?: RollAuditDetails } = {}): Promise<DraftrollRoomRoll> {
    return this.setVisibility({ type: 'roles', roles: [...roles] }, options);
  }

  /** @internal */
  apply(event: SynchronizedRollStart | SynchronizedRollUpdate | SynchronizedVisibilityUpdate): void {
    this.event = event;
  }
}

/**
 * Whether a lifecycle session currently rolls locally or through a room.
 *
 * @public
 */
export type DraftrollSessionMode = 'local' | 'realtime';
/**
 * Connection and disposal state of a lifecycle session.
 *
 * @public
 */
export type DraftrollSessionStatus = 'local' | 'connecting' | 'realtime' | 'disposed';
/**
 * Local or realtime roll handle retained by a lifecycle session.
 *
 * @public
 */
export type DraftrollSessionRoll = SdkRollResponse | DraftrollRoomRoll;

/**
 * Immutable view of the current lifecycle-session state.
 *
 * @public
 */
export interface DraftrollSessionSnapshot {
  status: DraftrollSessionStatus;
  mode: DraftrollSessionMode;
  rendererEnabled: boolean;
  roomId?: string;
}

/**
 * Configures a lifecycle-managed Draftroll session.
 *
 * @public
 */
export interface DraftrollSessionOptions extends DraftrollOptions {}

/**
 * Controls a lifecycle-session roll and optional presentation.
 *
 * @public
 */
export interface DraftrollSessionRollOptions {
  /** Realtime visibility. Ignored in local mode. */
  visibility?: RollVisibility;
  /** Realtime idempotency/correlation identity. Ignored in local mode. */
  clientRollId?: string;
  /** Local engine and renderer options. Ignored in realtime mode. */
  local?: SdkRollOptions;
  signal?: AbortSignal;
}

/**
 * Controls renderer ownership when attaching it to a lifecycle session.
 *
 * @public
 */
export interface DraftrollSessionRendererOptions {
  /** The session destroys/disposes this renderer when replaced or disposed. Defaults to false. */
  owned?: boolean;
  /** Clear the previous renderer before detaching it. Defaults to true. */
  clearPrevious?: boolean;
  /** Destroy/dispose the previous renderer even when it was externally owned. */
  disposePrevious?: boolean;
}

/**
 * Controls cleanup when detaching a lifecycle-session renderer.
 *
 * @public
 */
export interface DraftrollSessionDisableRendererOptions {
  clear?: boolean;
  dispose?: boolean;
}

/**
 * Payload map for lifecycle-session events.
 *
 * @public
 */
export interface DraftrollSessionEventMap {
  state: DraftrollSessionSnapshot;
  rendererChanged: {
    renderer?: DiceRenderer;
    previous?: DiceRenderer;
    enabled: boolean;
  };
  roll: DraftrollSessionRoll;
  hiddenRoll: DraftrollRoomRoll;
  sessionReady: DraftrollRoomSessionEventMap['sessionReady'];
  roomState: DraftrollRoomSessionEventMap['roomState'];
  participantJoined: DraftrollRoomSessionEventMap['participantJoined'];
  participantUpdated: DraftrollRoomSessionEventMap['participantUpdated'];
  participantLeft: DraftrollRoomSessionEventMap['participantLeft'];
  roomPolicyUpdated: DraftrollRoomSessionEventMap['roomPolicyUpdated'];
  roomTokenRevoked: DraftrollRoomSessionEventMap['roomTokenRevoked'];
  error: { error: Error };
}

/**
 * Event names emitted by a lifecycle session.
 *
 * @public
 */
export type DraftrollSessionEventName = keyof DraftrollSessionEventMap;

type LifecycleDiceRenderer = DiceRenderer & {
  destroy?: () => void | Promise<void>;
  dispose?: () => void | Promise<void>;
};

/**
 * Stable application-facing lifecycle for local, realtime, and renderer state.
 *
 * @remarks
 * Subscriptions, custom dice, and roll history survive local-to-realtime transitions. Calling
 * `dispose()` is terminal and releases owned renderer and room resources.
 *
 * @example
 * ```ts
 * import { DraftrollSession } from '@draftroll/sdk';
 *
 * const session = new DraftrollSession();
 * const unsubscribe = session.on('roll', (roll) => console.log(roll.result.total));
 * await session.roll('1d20+5');
 * unsubscribe();
 * await session.dispose();
 * ```
 *
 * @public
 */
export class DraftrollSession {
  /**
   * Underlying high-level SDK retained across mode changes.
   */
  readonly draftroll: Draftroll;
  private activeRoom: DraftrollRoomSession | null = null;
  private statusValue: DraftrollSessionStatus = 'local';
  private rendererOwned = false;
  private transitionGeneration = 0;
  private readonly handlers = new Map<DraftrollSessionEventName, Set<(payload: never) => void>>();
  private readonly rolls = new Map<string, DraftrollSessionRoll>();
  private readonly rollOrder: string[] = [];
  private readonly localUnsubscribers: Array<() => void> = [];
  private roomUnsubscribers: Array<() => void> = [];

  /**
   * Creates a stable local lifecycle session.
   */
  constructor(options: DraftrollSessionOptions = {}) {
    this.draftroll = new Draftroll(options);
    this.localUnsubscribers.push(
      this.draftroll.on('roll', (roll) => this.observeLocalRoll(roll)),
      this.draftroll.on('display', (roll) => this.observeLocalRoll(roll)),
      this.draftroll.on('update', (roll) => this.observeLocalRoll(roll)),
      this.draftroll.on('reroll', (roll) => this.observeLocalRoll(roll)),
      this.draftroll.on('error', (event) => this.emit('error', event)),
    );
  }

  /** Browser convenience that creates a lifecycle session with an owned overlay renderer. */
  static async createOverlay(options: DraftrollEmbeddedOptions = {}): Promise<DraftrollSession> {
    const session = new DraftrollSession({ engine: options.engine, instrumentation: options.instrumentation });
    await session.enableOverlay(options.overlay, options.warmupThemes, options.signal);
    return session;
  }

  /**
   * Subscribes to a lifecycle-session event and returns an unsubscribe function.
   */
  on<K extends DraftrollSessionEventName>(
    event: K,
    handler: (payload: DraftrollSessionEventMap[K]) => void,
  ): () => void {
    const set = this.handlers.get(event) ?? new Set<(payload: never) => void>();
    set.add(handler);
    this.handlers.set(event, set);
    return () => set.delete(handler);
  }

  /**
   * Current connection and disposal status.
   */
  get status(): DraftrollSessionStatus { return this.statusValue; }
  /**
   * Current local or realtime operating mode.
   */
  get mode(): DraftrollSessionMode { return this.activeRoom ? 'realtime' : 'local'; }
  /**
   * Active realtime room session, if connected.
   */
  get room(): DraftrollRoomSession | null { return this.activeRoom; }
  /**
   * Currently attached renderer, if any.
   */
  get renderer(): DiceRenderer | undefined { return this.draftroll.renderer; }
  /**
   * Immutable current lifecycle snapshot.
   */
  get snapshot(): DraftrollSessionSnapshot {
    return {
      status: this.statusValue,
      mode: this.mode,
      rendererEnabled: Boolean(this.renderer),
      roomId: this.activeRoom?.roomId,
    };
  }

  /** Unified stable handles observed in local and realtime modes, in first-seen order. */
  get rollLog(): readonly DraftrollSessionRoll[] {
    return this.rollOrder.map((rollId) => this.rolls.get(rollId)).filter((roll): roll is DraftrollSessionRoll => Boolean(roll));
  }

  /**
   * Returns a roll from the unified session history.
   */
  getRoll(rollId: string): DraftrollSessionRoll | null {
    return this.rolls.get(rollId) ?? this.activeRoom?.getRoll(rollId) ?? null;
  }

  /** Roll locally or through the active room without changing the consumer-facing object. */
  async roll(input: string | RollInput, options: DraftrollSessionRollOptions = {}): Promise<DraftrollSessionRoll> {
    this.assertActive();
    if (this.activeRoom) {
      const roomOptions = { visibility: options.visibility, clientRollId: options.clientRollId, signal: options.signal };
      if (typeof input !== 'string' && input.mode === 'display') return this.activeRoom.display(input, roomOptions);
      return this.activeRoom.roll(input, roomOptions);
    }
    if (typeof input === 'string') return this.draftroll.roll(input, { ...options.local, renderer: { ...options.local?.renderer, signal: options.signal ?? options.local?.renderer?.signal } });
    if (input.mode === 'display') return this.draftroll.display(input, { ...options.local?.renderer, signal: options.signal ?? options.local?.renderer?.signal });
    return this.draftroll.evaluate(input, { ...options.local, renderer: { ...options.local?.renderer, signal: options.signal ?? options.local?.renderer?.signal } });
  }

  /**
   * Displays an external roll locally or through the active room.
   */
  async display(
    input: Omit<DisplayRollInput, 'mode'> | DisplayRollInput,
    options: DraftrollSessionRollOptions = {},
  ): Promise<DraftrollSessionRoll> {
    this.assertActive();
    if (this.activeRoom) {
      return this.activeRoom.display(input, {
        visibility: options.visibility,
        clientRollId: options.clientRollId,
        signal: options.signal,
      });
    }
    return this.draftroll.display(input, {
      ...options.local?.renderer,
      signal: options.signal ?? options.local?.renderer?.signal,
    });
  }

  /** Switch to realtime. Existing local engine, custom dice, logs, and subscriptions remain intact. */
  async bulkUpdateRolls(
    updates: readonly DraftrollRoomBulkUpdate[],
    options: { signal?: AbortSignal } = {},
  ): Promise<DraftrollRoomBulkUpdateResult> {
    this.assertActive();
    if (!this.activeRoom) throw new DraftrollStateError('Bulk roll updates require realtime mode');
    return this.activeRoom.bulkUpdateRolls(updates, options);
  }

  /**
   * Transitions from local mode to a realtime room.
   */
  async connectRoom(options: DraftrollRoomSessionOptions): Promise<DraftrollRoomSession> {
    this.assertActive();
    const generation = ++this.transitionGeneration;
    this.detachRoom('Switching Draftroll room');
    this.setStatus('connecting');
    try {
      const room = await DraftrollRoomSession.connect(this.draftroll, options);
      if (this.statusValue === 'disposed' || generation !== this.transitionGeneration) {
        room.close(1000, 'Draftroll session transition superseded');
        throw new DraftrollStateError('Draftroll room connection was superseded by a newer lifecycle transition', { package: 'sdk', recoverable: true });
      }
      this.activeRoom = room;
      this.bindRoom(room);
      this.setStatus('realtime');
      return room;
    } catch (error) {
      if (generation === this.transitionGeneration && this.statusValue !== 'disposed') this.setStatus('local');
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { error: normalized });
      throw normalized;
    }
  }

  /** Close realtime transport and resume local evaluation on the same object. */
  useLocal(code = 1000, reason = 'Draftroll session switched to local mode'): void {
    this.assertActive();
    this.transitionGeneration += 1;
    this.detachRoom(reason, code);
    this.setStatus('local');
  }

  /**
   * Closes the active room and returns to local mode.
   */
  disconnectRoom(code = 1000, reason = 'Draftroll room disconnected'): void {
    this.useLocal(code, reason);
  }

  /** Attach a renderer while retaining the engine, room, roll handles, and subscriptions. */
  async setRenderer(renderer?: DiceRenderer, options: DraftrollSessionRendererOptions = {}): Promise<void> {
    this.assertActive();
    const previous = this.renderer;
    const previousOwned = this.rendererOwned;
    if (previous === renderer) {
      this.rendererOwned = Boolean(renderer) && (options.owned ?? previousOwned);
      this.activeRoom?.room.markReady(Boolean(renderer), true);
      return;
    }

    // Commit the new renderer first. Cleanup of the old renderer is isolated so a
    // failing clear/destroy cannot leave the session detached or readiness stale.
    this.draftroll.setRenderer(renderer);
    this.rendererOwned = Boolean(renderer) && (options.owned ?? false);
    this.activeRoom?.room.markReady(Boolean(renderer), true);
    this.emit('rendererChanged', { renderer, previous, enabled: Boolean(renderer) });
    this.emit('state', this.snapshot);

    if (!previous) return;
    try {
      if (options.clearPrevious ?? true) await previous.clear?.();
      if (options.disposePrevious ?? previousOwned) await destroyRenderer(previous);
    } catch (error) {
      const normalized = error instanceof DraftrollError
        ? error
        : new DraftrollError(DRAFTROLL_ERROR_CODES.rendererOperationFailed, 'Previous renderer cleanup failed after replacement', {
            package: 'sdk',
            recoverable: true,
            details: { operation: 'replaceRendererCleanup' },
            cause: error,
          });
      this.emit('error', { error: normalized });
    }
  }

  /**
   * Creates and attaches an owned iframe overlay renderer.
   */
  async enableOverlay(
    options: DraftrollOverlayOptions = {},
    warmupThemes: readonly string[] = [],
    signal?: AbortSignal,
  ): Promise<DiceRenderer> {
    this.assertActive();
    const { DraftrollOverlayRenderer } = await import('../../overlay/src/index');
    const renderer = new DraftrollOverlayRenderer(options);
    try {
      await renderer.mount(signal);
      if (warmupThemes.length) await renderer.warmup([...warmupThemes], signal);
      await this.setRenderer(renderer, { owned: true });
      return renderer;
    } catch (error) {
      renderer.destroy();
      throw error;
    }
  }

  /**
   * Pauses the active renderer.
   */
  pausePresentation(): Promise<void> { this.assertActive(); return this.draftroll.pausePresentation(); }
  /**
   * Resumes the active renderer.
   */
  resumePresentation(): Promise<void> { this.assertActive(); return this.draftroll.resumePresentation(); }
  /**
   * Captures the active renderer.
   */
  screenshot(): Promise<Blob | string> { this.assertActive(); return this.draftroll.screenshot(); }
  /**
   * Configures the active renderer camera.
   */
  configureCamera(options: RendererCameraOptions): Promise<void> { this.assertActive(); return this.draftroll.configureCamera(options); }
  /**
   * Restores active renderer camera defaults.
   */
  resetCamera(): Promise<void> { this.assertActive(); return this.draftroll.resetCamera(); }
  /**
   * Displays a renderer preview.
   */
  preview(options: RendererPreviewOptions = {}): Promise<RendererCompletion> { this.assertActive(); return this.draftroll.preview(options); }
  /**
   * Filters visible participants in the active renderer.
   */
  setParticipantFilter(filter?: RendererParticipantFilter): void { this.assertActive(); this.draftroll.setParticipantFilter(filter); }
  /**
   * Configures active renderer interactions.
   */
  configureInteractions(options: RendererInteractionOptions): Promise<void> { this.assertActive(); return this.draftroll.configureInteractions(options); }

  /**
   * Detaches the active renderer and conditionally destroys owned resources.
   */
  async disableRenderer(options: DraftrollSessionDisableRendererOptions = {}): Promise<void> {
    await this.setRenderer(undefined, {
      clearPrevious: options.clear ?? true,
      disposePrevious: options.dispose,
    });
  }

  /** Close transport, detach/destroy owned presentation, and release subscriptions. */
  async dispose(): Promise<void> {
    if (this.statusValue === 'disposed') return;
    this.transitionGeneration += 1;
    this.detachRoom('Draftroll session disposed');
    const renderer = this.renderer;
    const owned = this.rendererOwned;
    this.draftroll.setRenderer(undefined);
    this.rendererOwned = false;
    let cleanupError: unknown;
    try {
      if (renderer) await renderer.clear?.();
      if (renderer && owned) await destroyRenderer(renderer);
    } catch (error) {
      cleanupError = error;
    } finally {
      this.localUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
      this.statusValue = 'disposed';
      this.emit('state', this.snapshot);
      this.handlers.clear();
    }
    // Rethrow the original failure verbatim when it is already an Error so callers keep
    // the stack and identity; non-Error throwables are wrapped to preserve `cause`.
    if (cleanupError !== undefined) {
      throw cleanupError instanceof Error
        ? cleanupError
        : new Error(`Renderer cleanup failed: ${describeThrowable(cleanupError)}`, { cause: cleanupError });
    }
  }

  private bindRoom(room: DraftrollRoomSession): void {
    this.roomUnsubscribers = [
      room.on('roll', (roll) => this.observeRoll(roll)),
      room.on('hiddenRoll', (roll) => {
        this.storeRoll(roll);
        this.emit('hiddenRoll', roll);
      }),
      room.on('sessionReady', (event) => this.emit('sessionReady', event)),
      room.on('roomState', (event) => this.emit('roomState', event)),
      room.on('participantJoined', (event) => this.emit('participantJoined', event)),
      room.on('participantUpdated', (event) => this.emit('participantUpdated', event)),
      room.on('participantLeft', (event) => this.emit('participantLeft', event)),
      room.on('roomPolicyUpdated', (event) => this.emit('roomPolicyUpdated', event)),
      room.on('roomTokenRevoked', (event) => this.emit('roomTokenRevoked', event)),
      room.on('error', (event) => this.emit('error', event)),
    ];
    room.rollLog.forEach((roll) => this.storeRoll(roll));
  }

  private observeLocalRoll(roll: SdkRollResponse): void {
    // Realtime auto-presentation mirrors the authoritative room result through
    // Draftroll. Keep the richer stable room handle as the top-level identity.
    if (this.activeRoom?.getRoll(roll.id)) return;
    this.observeRoll(roll);
  }

  private observeRoll(roll: DraftrollSessionRoll): void {
    this.storeRoll(roll);
    this.emit('roll', roll);
  }

  private storeRoll(roll: DraftrollSessionRoll): void {
    if (!this.rolls.has(roll.id)) this.rollOrder.push(roll.id);
    this.rolls.set(roll.id, roll);
  }

  private detachRoom(reason: string, code = 1000): void {
    this.roomUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    this.activeRoom?.close(code, reason);
    this.activeRoom = null;
  }

  private setStatus(status: DraftrollSessionStatus): void {
    if (this.statusValue === status) return;
    this.statusValue = status;
    this.emit('state', this.snapshot);
  }

  private assertActive(): void {
    if (this.statusValue === 'disposed') throw new DraftrollStateError('Draftroll session has been disposed', { package: 'sdk' });
  }

  private emit<K extends DraftrollSessionEventName>(event: K, payload: DraftrollSessionEventMap[K]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        (handler as (value: DraftrollSessionEventMap[K]) => void)(payload);
      } catch {
        // Observer failures cannot alter lifecycle transitions.
      }
    }
  }
}

async function destroyRenderer(renderer: DiceRenderer): Promise<void> {
  const lifecycle = renderer as LifecycleDiceRenderer;
  if (lifecycle.destroy) await lifecycle.destroy();
  else await lifecycle.dispose?.();
}

/**
 * Creates and mounts a browser overlay renderer.
 *
 * @public
 */
export async function mountDraftroll(options: DraftrollEmbeddedOptions = {}): Promise<Draftroll> {
  return Draftroll.createOverlay(options);
}

/**
 * Applies selected theme identifiers to a normalized roll without mutating the source result.
 *
 * @public
 */
export function applyDiceThemes(result: NormalizedRollResult, selection?: DiceThemeSelection): NormalizedRollResult {
  if (!selection) return result;
  return {
    ...result,
    dice: result.dice.map((die, index) => {
      let themeId: string | undefined;
      if (typeof selection === 'string') themeId = selection;
      else if (typeof selection === 'function') themeId = selection(die, index);
      else if (Array.isArray(selection)) themeId = selection[index];
      else themeId = (selection as Readonly<Record<string, string>>)[die.id];
      return themeId ? { ...die, themeId } : { ...die };
    }),
  };
}

function findLatestAnimatedReplaySequence(events: readonly import('../../protocol/src/index').RoomReplayEvent[] | readonly import('../../client/src/index').SynchronizedRoomRollEvent[]): number | null {
  let latest: number | null = null;
  for (const event of events) {
    if (!('result' in event) || !event.result) continue;
    if (event.type !== 'roll_start' && !(event.type === 'roll_updated' && event.animate)) continue;
    latest = latest === null ? event.eventSequence : Math.max(latest, event.eventSequence);
  }
  return latest;
}

function clonePresentationDice(dice: readonly NormalizedDieResult[]): NormalizedDieResult[] {
  return dice.map((die) => ({
    ...die,
    metadata: die.metadata ? { ...die.metadata } : undefined,
  }));
}

interface RerollPresentationProjection {
  result: NormalizedRollResult;
  dieIds: string[];
  stateDieIds: string[];
}

function readRerolledDieIds(result: NormalizedRollResult): string[] {
  if (result.metadata?.rerollRevision !== (result.revision ?? 0)) return [];
  const raw = result.metadata?.rerolledDice;
  if (!Array.isArray(raw)) return [];
  const available = new Set(result.dice.map((die) => die.id));
  return [...new Set(raw.filter((value): value is string => typeof value === 'string' && available.has(value)))];
}

function createRerollPresentation(
  previous: NormalizedRollResult,
  previousPresentationDice: readonly NormalizedDieResult[],
  revised: NormalizedRollResult,
  rerolledDieIds: readonly string[],
): RerollPresentationProjection {
  const rerolled = new Set(rerolledDieIds);
  const previousAffected = collectCausalDieIds(previous.dice, rerolled);
  const revisedAffected = collectCausalDieIds(revised.dice, rerolled);
  const revisedById = new Map(revised.dice.map((die) => [die.id, die] as const));
  const stateDice = previousPresentationDice.map((die) => {
    const logicalDieId = readLogicalPresentationDieId(die);
    const current = revisedById.get(logicalDieId);
    return {
      ...die,
      kept: previousAffected.has(logicalDieId) ? false : current?.kept ?? die.kept,
    };
  });

  const usedIds = new Set(stateDice.map((die) => die.id));
  const remappedIds = new Map<string, string>();
  const revision = revised.revision ?? (previous.revision ?? 0) + 1;
  const generated = revised.dice.flatMap((die) => {
    if (!revisedAffected.has(die.id)) return [];
    const id = allocatePresentationDieId(`${die.id}__reroll_${revision}`, usedIds);
    remappedIds.set(die.id, id);
    const isRerolledRoot = rerolled.has(die.id);
    const generatedFromDieId = isRerolledRoot
      ? die.id
      : die.generatedFromDieId
        ? remappedIds.get(die.generatedFromDieId) ?? die.generatedFromDieId
        : undefined;
    return [{
      ...die,
      id,
      generatedBy: isRerolledRoot ? 'reroll' as const : die.generatedBy,
      generatedFromDieId,
      metadata: {
        ...die.metadata,
        draftrollPresentationOnly: true,
        logicalDieId: die.id,
      },
    }];
  });

  return {
    result: {
      ...revised,
      dice: [...stateDice, ...generated],
      metadata: {
        ...revised.metadata,
        draftrollPresentation: 'reroll-history',
      },
    },
    dieIds: generated.map((die) => die.id),
    stateDieIds: stateDice.map((die) => die.id),
  };
}

function readLogicalPresentationDieId(die: NormalizedDieResult): string {
  const logical = die.metadata?.logicalDieId;
  return typeof logical === 'string' && logical.length > 0 ? logical : die.id;
}

function collectCausalDieIds(
  dice: readonly NormalizedDieResult[],
  roots: ReadonlySet<string>,
): Set<string> {
  const affected = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const die of dice) {
      if (!die.generatedFromDieId || !affected.has(die.generatedFromDieId) || affected.has(die.id)) continue;
      affected.add(die.id);
      changed = true;
    }
  }
  return affected;
}

/**
 * Renders an arbitrary thrown value for an error message.
 *
 * Plain `String(value)` collapses objects to a useless `[object Object]`, which
 * hides the very detail the message exists to convey.
 */
function describeThrowable(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value) ?? Object.prototype.toString.call(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  return String(value);
}

function allocatePresentationDieId(base: string, used: Set<string>): string {
  let candidate = base;
  let suffix = 1;
  while (used.has(candidate)) candidate = `${base}_${suffix++}`;
  used.add(candidate);
  return candidate;
}

function asRevision(previous: NormalizedRollResult, next: NormalizedRollResult): NormalizedRollResult {
  const updatedAt = new Date().toISOString();
  const revision = (previous.revision ?? 0) + 1;
  const rerolledDice = Array.isArray(next.metadata?.rerolledDice) ? next.metadata.rerolledDice : null;
  return {
    ...next,
    rollId: previous.rollId,
    sequence: previous.sequence,
    revision,
    updatedAt,
    createdAt: previous.createdAt,
    metadata: {
      ...previous.metadata,
      ...next.metadata,
      draftrollRevision: revision,
      revisedAt: updatedAt,
      ...(rerolledDice ? { rerollRevision: revision } : {}),
    },
  };
}

function resolveAnimatedDieIds(
  previous: NormalizedRollResult,
  next: NormalizedRollResult,
  selection: SdkUpdateOptions['animateDice'],
): readonly string[] | undefined {
  if (selection === 'all' || selection === undefined) return undefined;
  if (Array.isArray(selection)) return selection;
  const previousById = new Map(previous.dice.map((die) => [die.id, die]));
  return next.dice
    .filter((die) => {
      const old = previousById.get(die.id);
      return !old
        || old.result !== die.result
        || old.type !== die.type
        || old.themeId !== die.themeId;
    })
    .map((die) => die.id);
}

export * from '../../core/src/index';
export * from '../../errors/src/index';
export * from '../../client/src/index';
export * from '../../protocol/src/index';
export * from '../../themes/src/index';
export * from './builders';

export type {
  DiceRenderer,
  RendererCompletion,
  RendererDismissOptions,
  RendererPlayOptions,
  RendererCameraOptions,
  RendererInteractionOptions,
  RendererParticipantFilter,
  RendererPreviewOptions,
  RendererPerformanceOptions,
} from '../../renderer/src/index';
