/**
 * Renderer contracts and the physical Draftroll renderer.
 *
 * @remarks
 * Provides lifecycle controls, late-event synchronization, table presentation, interactions, and fallback rendering contracts.
 *
 * @packageDocumentation
 */

export { DraftrollTextRenderer } from './text';
export type { DraftrollTextRendererOptions } from './text';
export { AdaptiveResolutionController, resolveRendererPerformanceBudget } from './performance';
export { resolveOrthographicViewport, resolveRendererViewport } from './viewport';
export type {
  OrthographicViewport,
  RendererViewport,
  RendererViewportCandidate,
  RendererViewportInput,
} from './viewport';
export type {
  AdaptiveResolutionOptions,
  RendererPerformanceBudget,
  RendererPerformanceBudgetInput,
} from './performance';
import type {
  CustomDiceDefinition,
  NormalizedDieResult,
  NormalizedRollResult,
  DicePhysicsProperties,
} from '../../protocol/src/index';
import {
  prepareRuntimeTheme,
  type DiceTheme,
  type RuntimeThemeBundle,
  type ThemeLoadEvent,
  type ThemeProvider,
} from '../../themes/src/index';
import {
  DRAFTROLL_ERROR_CODES,
  DraftrollAbortError,
  DraftrollError,
  DraftrollStateError,
  raceWithAbort,
  throwIfAborted,
} from '../../errors/src/index';

/**
 * Physical die kinds supported by the renderer.
 *
 * @public
 */
export type DraftrollDieKind = 'coin' | 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20';
/**
 * Non-polyhedral fallback visual kinds supported by the renderer.
 *
 * @public
 */
export type DraftrollFallbackKind = 'coin' | 'percentile' | 'fate' | 'spinner' | 'token' | 'card';
/**
 * Game-supplied semantic outcome used to choose a theme effect.
 *
 * @public
 */
export type DraftrollEffectOutcome = 'positive' | 'neutral' | 'negative' | 'none';
/**
 * Named renderer quality and battery profiles.
 *
 * @public
 */
export type RendererPerformanceProfile = 'auto' | 'battery' | 'quality';

/**
 * Sets the renderer quality profile and explicit frame or pixel-density caps.
 *
 * @public
 */
export interface RendererPerformanceOptions {
  profile?: RendererPerformanceProfile;
  maximumPixelRatio?: number;
  activeFramesPerSecond?: number;
  adaptiveQuality?: boolean;
}

/**
 * Serializable fallback representation for a non-physical die.
 *
 * @public
 */
export interface DraftrollFallbackVisual {
  id: string;
  /** Original normalized die type. */
  type: string;
  kind: DraftrollFallbackKind;
  result: number | string;
  numericValue?: number;
  sides?: number;
  title: string;
  label: string;
  /** Label painted on the reverse side when the fallback is a two-sided coin. */
  oppositeLabel?: string;
  theme: string;
  outcome: DraftrollEffectOutcome;
  metadata?: Record<string, unknown>;
}

/**
 * Stable order entry for a physical die or fallback visual.
 *
 * @public
 */
export type DraftrollVisualOrderEntry =
  | { kind: 'physical'; index: number; dieId: string }
  | { kind: 'fallback'; index: number; dieId: string };

/**
 * Late-event synchronization strategy.
 *
 * @public
 */
export type RendererLateEventMode = 'auto' | 'seek' | 'settled' | 'replay';

/**
 * Policy settings for renderer late event.
 *
 * @public
 */
export interface RendererLateEventPolicy {
  /** Auto seeks moderately late events and presents a settled result once most motion elapsed. */
  mode?: RendererLateEventMode;
  /** Auto mode switches to the settled presentation at this progress. Defaults to 0.78. */
  settleAfterProgress?: number;
}

/**
 * Controls whether a presentation replaces or appends to the current table.
 *
 * @public
 */
export interface RendererTableOptions {
  /** Queue is the traditional one-roll-at-a-time behavior. Concurrent batches nearby starts into one table throw. */
  mode?: 'queue' | 'concurrent';
  /** Stable logical group ID, normally the room roll ID. */
  groupId?: string;
  /** Human-readable roller label shown in the combined table result. */
  actorLabel?: string;
  /** Optional action/roll label shown beside the actor. */
  rollLabel?: string;
  /** Maximum arrival/start-time gap that may be merged into the same physical table throw. */
  batchWindowMs?: number;
  /** Maximum logical rolls merged into one physical throw. */
  maximumConcurrentRolls?: number;
  /** Maximum visual components merged into one physical throw. */
  maximumConcurrentVisuals?: number;
}

/**
 * Controls how one normalized roll is synchronized and presented.
 *
 * @public
 */
export interface RendererPlayOptions {
  startTime?: number;
  animationSeed?: string | number;
  /** Time already elapsed since the authoritative synchronized start. */
  elapsedMs?: number;
  /** Advertised synchronized animation duration used to map elapsed time to replay progress. */
  animationDurationMs?: number;
  lateEvent?: RendererLateEventPolicy;
  /** Optional multi-roller table batching. Room sessions enable this by default. */
  table?: RendererTableOptions;
  defaultThemeId?: string;
  /** Render only these normalized die IDs while retaining the full roll context. */
  dieIds?: readonly string[];
  /**
   * Keep the current table visible and append this presentation when the bridge
   * has an active compatible table. Used by individual rerolls and staged
   * modifier follow-ups. If no compatible table exists, the bridge starts a
   * normal replacement presentation.
   */
  preservePreviousDice?: boolean;
  /**
   * Additional normalized die states to merge into a persistent table without
   * rendering another visual. This lets a rerolled die remain visible while its
   * previous result is marked discarded.
   */
  stateDieIds?: readonly string[];
  /**
   * Complete logical result used when no compatible table is currently visible.
   * SDK rerolls provide this automatically so append semantics degrade safely to
   * a normal full replacement after clear, dismiss, or auto-clear.
   */
  replaceFallbackResult?: NormalizedRollResult;
  outcomeResolver?: (
    die: NormalizedDieResult,
    result: NormalizedRollResult,
  ) => DraftrollEffectOutcome;
  /** Cancels theme loading, queued work, and the caller's wait for a long presentation. */
  signal?: AbortSignal;
  /** Automatically dissolve and clear this presentation after the given delay. */
  autoClearMs?: number;
  /** Prefer a concise non-3D/final-state presentation for reduced-motion users. */
  reducedMotion?: boolean;
  /** Force all components through the synchronized fallback layer. */
  forceFallback?: boolean;
  /** Shared physical tuning selected by room policy or the host. */
  physicsPreset?: 'standard' | 'compact' | 'heavy' | 'low-gravity';
  /**
   * Present evaluator-generated rerolls and explosions as follow-up throws.
   * Defaults to staged; simultaneous preserves the legacy one-throw behavior.
   */
  modifierSequence?: 'staged' | 'simultaneous';
}

/**
 * Completion metadata returned after a presentation settles.
 *
 * @public
 */
export interface RendererCompletion {
  results: Array<number | string>;
  total: number;
  replay: unknown;
  /** How this presentation was committed to the visible table. */
  presentationMode?: 'replace' | 'add';
}

/**
 * Maps renderer lifecycle event names to their payloads.
 *
 * @public
 */
export interface RendererLifecycleEventMap {
  loading: { result: NormalizedRollResult; options: RendererPlayOptions };
  started: { result: NormalizedRollResult; options: RendererPlayOptions };
  settled: { result: NormalizedRollResult; completion: RendererCompletion };
  completed: { result: NormalizedRollResult; completion: RendererCompletion };
  dissolveStarted: { options: RendererDismissOptions };
  dissolveFinished: { options: RendererDismissOptions };
  paused: {};
  resumed: {};
  cleared: {};
  error: { error: Error; result?: NormalizedRollResult };
}

/**
 * Event names emitted by a renderer.
 *
 * @public
 */
export type RendererLifecycleEventName = keyof RendererLifecycleEventMap;

/**
 * Controls the table camera orientation, zoom, and automatic rotation.
 *
 * @public
 */
export interface RendererCameraOptions {
  yaw?: number;
  pitch?: number;
  zoom?: number;
  autoRotate?: boolean;
}

/**
 * Enables pointer actions and settled-die dragging for an interactive table.
 *
 * @public
 */
export interface RendererInteractionOptions {
  click?: 'none' | 'reroll' | 'drop' | 'explode';
  draggable?: boolean;
}

/**
 * Selects the theme, die, and visible value used by a non-authoritative preview.
 *
 * @public
 */
export interface RendererPreviewOptions {
  themeId?: string;
  dieType?: string;
  value?: number | string;
  signal?: AbortSignal;
}

/**
 * Predicate or participant-ID set used to filter table groups.
 *
 * @public
 */
export type RendererParticipantFilter =
  | readonly string[]
  | ((context: { participantId?: string; result: NormalizedRollResult }) => boolean);

/**
 * Controls how completed dice dissolve and whether the result panel is retained.
 *
 * @public
 */
export interface RendererDismissOptions {
  durationMs?: number;
  hideResult?: boolean;
  signal?: AbortSignal;
}

/**
 * Selects the lifecycle state shown by a result-only presentation update.
 *
 * @public
 */
export interface RendererResultUpdateOptions {
  state?: 'complete' | 'updated';
}

/**
 * Common lifecycle contract implemented by physical, text, and overlay renderers.
 *
 * @public
 */
export interface DiceRenderer {
  warmup(themeIds?: string[], signal?: AbortSignal): Promise<void>;
  playRoll(
    result: NormalizedRollResult,
    options?: RendererPlayOptions,
  ): Promise<RendererCompletion>;
  /** Update the result UI/log without replaying the physical dice. */
  updateResult?(
    result: NormalizedRollResult,
    options?: RendererResultUpdateOptions,
  ): void | Promise<void>;
  /** Visually dissolve a completed throw and remove its physical dice. */
  dismiss?(options?: RendererDismissOptions): void | Promise<void>;
  /** Remove physical dice immediately. */
  clear?(): void | Promise<void>;
  on?<K extends RendererLifecycleEventName>(
    event: K,
    handler: (payload: RendererLifecycleEventMap[K]) => void,
  ): () => void;
  pause?(): void | Promise<void>;
  resume?(): void | Promise<void>;
  screenshot?(): Promise<Blob | string>;
  configureCamera?(options: RendererCameraOptions): void | Promise<void>;
  resetCamera?(): void | Promise<void>;
  preview?(options?: RendererPreviewOptions): Promise<RendererCompletion>;
  setParticipantFilter?(filter?: RendererParticipantFilter): void;
  configureInteractions?(options: RendererInteractionOptions): void | Promise<void>;
  configure?(options: RendererPerformanceOptions): void | Promise<void>;
}

/**
 * Theme data forwarded to a renderer bridge.
 *
 * @public
 */
export interface DraftrollThemeManifest {
  id: string;
  name: string;
  version?: string;
  previews?: Record<string, string>;
  availableDice?: string[];
  capabilities?: object;
}

/**
 * Bridge used by the physical renderer to control the browser-hosted dice scene.
 *
 * @public
 */
export interface DraftrollBridge {
  roll(
    request?:
      | {
          /** Results belonging only to physical dice. May be empty for fallback-only rolls. */
          results?: number[] | number;
          outcomes?: DraftrollEffectOutcome[] | DraftrollEffectOutcome;
          themes?: string[] | string;
          /** Physical die type for each physical result. A single value is repeated. */
          kinds?: DraftrollDieKind[] | DraftrollDieKind;
          /** Non-polyhedral or symbolic components animated alongside physical dice. */
          fallbacks?: DraftrollFallbackVisual[];
          /** Restores the normalized die order when physical and fallback visuals are mixed. */
          visualOrder?: DraftrollVisualOrderEntry[];
          context?: Record<string, unknown>;
          seed?: string | number;
          startAtMs?: number;
          /** Seek into the deterministic replay after planning rather than starting at frame zero. */
          seekToMs?: number;
          /** Duration used to translate authoritative elapsed time to local replay progress. */
          animationDurationMs?: number;
          /** Present the final settled state immediately. */
          settleImmediately?: boolean;
          lateMode?: RendererLateEventMode;
          settleAfterProgress?: number;
          /** Add to an active persistent table throw instead of waiting for it to clear. */
          tableMode?: 'replace' | 'add';
          signal?: AbortSignal;
          reducedMotion?: boolean;
          /** Per-physical-die size, mass, and inertia overrides aligned with results/kinds. */
          physics?: DicePhysicsProperties[];
          physicsPreset?: 'standard' | 'compact' | 'heavy' | 'low-gravity';
        }
      | number[]
      | number,
  ): Promise<RendererCompletion>;
  setDie(kind: DraftrollDieKind): void;
  setQuantity(count: number): void;
  setTheme(theme: string): void;
  getThemes(): DraftrollThemeManifest[];
  installTheme?(
    bundle: RuntimeThemeBundle,
  ): Promise<DraftrollThemeManifest> | DraftrollThemeManifest;
  unloadTheme?(themeId: string): void | Promise<void>;
  dismiss?(options?: RendererDismissOptions): void | Promise<void>;
  clear?(): void;
  configure?(options: RendererPerformanceOptions): void;
  pause?(): void | Promise<void>;
  resume?(): void | Promise<void>;
  screenshot?(): Promise<Blob | string>;
  configureCamera?(options: RendererCameraOptions): void | Promise<void>;
  resetCamera?(): void | Promise<void>;
  preview?(options?: RendererPreviewOptions): Promise<RendererCompletion>;
  configureInteractions?(options: RendererInteractionOptions): void | Promise<void>;
}

/**
 * Configures the physical renderer and its browser bridge.
 *
 * @public
 */
export interface DraftrollRendererOptions {
  bridge?: DraftrollBridge;
  themeProvider?: ThemeProvider;
  fallbackThemeId?: string;
  maximumDice?: number;
  maximumThemeAssetBytes?: number;
  maximumThemeTotalBytes?: number;
  onThemeLoad?: (event: ThemeLoadEvent) => void;
  /** Throw when a requested runtime theme cannot be loaded instead of using fallbackThemeId. */
  strictThemes?: boolean;
  performance?: RendererPerformanceOptions;
  /** Default table batching behavior. Individual play calls can override it. */
  table?: RendererTableOptions;
}

/**
 * Resolved timeline offset and settled/replay mode for a late event.
 *
 * @public
 */
export interface ResolvedLateEventPresentation {
  seekToMs: number;
  settleImmediately: boolean;
  mode: RendererLateEventMode;
}

/**
 * Resolves whether a late renderer event should seek, replay, or appear settled.
 *
 * @public
 */
export function resolveLateEventPresentation(
  options: RendererPlayOptions = {},
): ResolvedLateEventPresentation {
  const elapsedMs = Math.max(0, options.elapsedMs ?? 0);
  const durationMs = Math.max(1, options.animationDurationMs ?? 2_800);
  const requestedMode = options.lateEvent?.mode ?? 'auto';
  const settleAfterProgress = Math.min(
    1,
    Math.max(0, options.lateEvent?.settleAfterProgress ?? 0.78),
  );
  if (requestedMode === 'replay') {
    return { seekToMs: 0, settleImmediately: false, mode: 'replay' };
  }
  if (elapsedMs <= 16) {
    return {
      seekToMs: 0,
      settleImmediately: false,
      mode: requestedMode === 'seek' ? 'seek' : 'auto',
    };
  }
  if (requestedMode === 'settled') {
    return { seekToMs: durationMs, settleImmediately: true, mode: 'settled' };
  }
  const progress = elapsedMs / durationMs;
  if (requestedMode === 'auto' && progress >= settleAfterProgress) {
    return { seekToMs: durationMs, settleImmediately: true, mode: 'settled' };
  }
  return { seekToMs: Math.min(elapsedMs, durationMs), settleImmediately: false, mode: 'seek' };
}

/**
 * Error raised for unsupported roll failures.
 *
 * @public
 */
export class UnsupportedRollError extends DraftrollError {
  /**
   * Creates a UnsupportedRollError instance.
   */
  constructor(
    message: string,
    public readonly result: NormalizedRollResult,
  ) {
    super(DRAFTROLL_ERROR_CODES.unsupportedRoll, message, {
      package: 'renderer',
      recoverable: true,
      details: { rollId: result.rollId },
    });
    this.name = 'UnsupportedRollError';
  }
}

interface PhysicalVisual {
  die: NormalizedDieResult;
  kind: DraftrollDieKind;
  value: number;
  theme: string;
  outcome: DraftrollEffectOutcome;
  physics?: DicePhysicsProperties;
}

interface PreparedRollPresentation {
  result: NormalizedRollResult;
  options: RendererPlayOptions;
  physical: PhysicalVisual[];
  fallbacks: DraftrollFallbackVisual[];
  visualOrder: DraftrollVisualOrderEntry[];
  renderedDieIds: string[];
  expectedResults: Array<number | string>;
  latePresentation: ResolvedLateEventPresentation;
  table: Required<
    Pick<
      RendererTableOptions,
      'mode' | 'batchWindowMs' | 'maximumConcurrentRolls' | 'maximumConcurrentVisuals'
    >
  > &
    RendererTableOptions;
  seed: string | number;
  enqueuedAt: number;
  tableMode?: 'replace' | 'add';
  sequence?: ModifierPresentationSequence;
}

interface ModifierPresentationStage {
  dieIds: string[];
  generatedBy: 'initial' | 'reroll' | 'reroll-add' | 'explosion' | 'external' | 'mixed';
}

interface ModifierPresentationSequence {
  id: string;
  stageIndex: number;
  stageCount: number;
  pending: boolean;
  generatedBy: ModifierPresentationStage['generatedBy'];
}

interface ExecutePreparedBatchOptions {
  emitStarted?: boolean;
  emitCompleted?: boolean;
  scheduleAutoClear?: boolean;
}

interface PendingTablePresentation {
  prepared: PreparedRollPresentation;
  resolve: (completion: RendererCompletion) => void;
  reject: (error: Error) => void;
  cleanupAbort?: () => void;
}

interface TableRollContextEntry {
  groupId: string;
  rollId?: string;
  actorLabel?: string;
  rollLabel?: string;
  total: number;
  expression?: string;
  physicalStart: number;
  physicalCount: number;
  fallbackStart: number;
  fallbackCount: number;
  visualCount: number;
}

/**
 * Presents normalized rolls using deterministic physical trajectories and visual fallbacks.
 *
 * @remarks
 * The renderer never changes authoritative die results. Additive modifier stages preserve prior
 * dice on the table, and per-die outcome effects are emitted once at first final settlement.
 *
 * @public
 */
export class DraftrollRenderer implements DiceRenderer {
  private readonly bridge: DraftrollBridge;
  private readonly themeProvider?: ThemeProvider;
  private readonly fallbackThemeId: string;
  private readonly maximumDice: number;
  private readonly themeCache = new Map<string, DiceTheme>();
  private readonly installedThemes = new Set<string>();
  private readonly themeLoads = new Map<string, Promise<string>>();
  private readonly maximumThemeAssetBytes: number;
  private readonly maximumThemeTotalBytes: number;
  private readonly onThemeLoad?: (event: ThemeLoadEvent) => void;
  private readonly strictThemes: boolean;
  private readonly tableDefaults: RendererTableOptions;
  private readonly pendingTablePresentations: PendingTablePresentation[] = [];
  private readonly lifecycleHandlers = new Map<
    RendererLifecycleEventName,
    Set<(payload: never) => void>
  >();
  private tableFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private autoClearTimer: ReturnType<typeof setTimeout> | null = null;
  private participantFilter?: RendererParticipantFilter;
  private readonly activeRollIds = new Set<string>();
  private hasActivePresentation = false;
  private paused = false;

  /**
   * Creates a physical renderer around a browser bridge.
   *
   * @param options - Bridge, theme, capacity, table, and performance defaults.
   * @throws {@link DraftrollError} when no browser bridge is available.
   */
  constructor(options: DraftrollRendererOptions = {}) {
    const bridge = options.bridge ?? getWindowBridge();
    if (!bridge) {
      throw new DraftrollError(
        DRAFTROLL_ERROR_CODES.rendererUnavailable,
        'Draftroll renderer bridge is unavailable. Load the Draftroll engine before creating the SDK renderer.',
        { package: 'renderer', recoverable: true },
      );
    }
    this.bridge = bridge;
    this.themeProvider = options.themeProvider;
    this.fallbackThemeId = options.fallbackThemeId ?? 'dragon';
    this.maximumDice = options.maximumDice ?? 30;
    this.maximumThemeAssetBytes = options.maximumThemeAssetBytes ?? 8 * 1024 * 1024;
    this.maximumThemeTotalBytes = options.maximumThemeTotalBytes ?? 24 * 1024 * 1024;
    this.onThemeLoad = options.onThemeLoad;
    this.strictThemes = options.strictThemes ?? false;
    this.tableDefaults = {
      mode: 'queue',
      batchWindowMs: 140,
      maximumConcurrentRolls: 6,
      maximumConcurrentVisuals: this.maximumDice,
      ...options.table,
    };
    if (options.performance) this.bridge.configure?.(options.performance);
    this.bridge.getThemes().forEach((theme) => this.installedThemes.add(theme.id));
  }

  /**
   * Subscribes to a renderer lifecycle event.
   */
  on<K extends RendererLifecycleEventName>(
    event: K,
    handler: (payload: RendererLifecycleEventMap[K]) => void,
  ): () => void {
    const handlers = this.lifecycleHandlers.get(event) ?? new Set<(payload: never) => void>();
    handlers.add(handler);
    this.lifecycleHandlers.set(event, handlers);
    return () => handlers.delete(handler);
  }

  /**
   * Applies performance and accessibility options.
   */
  configure(options: RendererPerformanceOptions): void {
    this.bridge.configure?.(options);
  }

  /**
   * Prepares renderer resources before the first roll.
   */
  async warmup(themeIds: string[] = [this.fallbackThemeId], signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal, 'Renderer warmup');
    for (const themeId of themeIds) {
      const rendererTheme = await this.resolveRendererTheme(themeId, signal);
      throwIfAborted(signal, 'Renderer warmup');
      this.bridge.setTheme(rendererTheme);
    }
  }

  /**
   * Loads a theme manifest into the browser bridge.
   */
  async loadTheme(themeId: string, signal?: AbortSignal): Promise<string> {
    return this.resolveRendererTheme(themeId, signal);
  }

  /**
   * Unloads a theme from the browser bridge.
   */
  async unloadTheme(themeId: string): Promise<void> {
    if (themeId === this.fallbackThemeId) return;
    await this.bridge.unloadTheme?.(themeId);
    this.installedThemes.delete(themeId);
    this.themeCache.delete(themeId);
    this.themeLoads.delete(themeId);
  }

  /**
   * Presents a normalized roll and resolves after all physical and fallback stages settle.
   *
   * @param result - Authoritative normalized result; the renderer never changes its outcomes.
   * @param options - Timing, synchronization, theme, table, and cancellation controls.
   * @returns Completion data containing the authoritative total and optional replay payload.
   * @throws {@link DraftrollAbortError} when `options.signal` is aborted.
   * @throws {@link UnsupportedRollError} when the visual count exceeds renderer capacity.
   */
  async playRoll(
    result: NormalizedRollResult,
    options: RendererPlayOptions = {},
  ): Promise<RendererCompletion> {
    throwIfAborted(options.signal, 'Renderer presentation');
    if (
      options.preservePreviousDice === true &&
      options.replaceFallbackResult &&
      !this.canAppendToActivePresentation(result)
    ) {
      return this.playRoll(options.replaceFallbackResult, withoutPersistentTableOptions(options));
    }
    if (!this.shouldPresent(result)) {
      return {
        results: result.dice.map((die) => die.result),
        total: result.total,
        replay: null,
      };
    }
    this.emitLifecycle('loading', { result, options });
    try {
      const modifierStages = resolveModifierPresentationStages(result, options);
      const shouldUseModifierSequence =
        modifierStages.length > 1 ||
        (options.preservePreviousDice === true &&
          modifierStages.some(
            (stage) => stage.generatedBy !== 'initial' && stage.generatedBy !== 'external',
          ));
      if (shouldUseModifierSequence) {
        return await this.playModifierSequence(result, options, modifierStages);
      }
      const prepared = await this.prepareRoll(result, options);
      if (prepared.table.mode !== 'concurrent') {
        const [completion] = await raceWithAbort(
          this.executePreparedBatch([prepared]),
          options.signal,
          'Renderer presentation',
        );
        return completion;
      }
      return await new Promise<RendererCompletion>((resolve, reject) => {
        const entry: PendingTablePresentation = { prepared, resolve, reject };
        if (options.signal) {
          const handleAbort = () => {
            const index = this.pendingTablePresentations.indexOf(entry);
            if (index >= 0) this.pendingTablePresentations.splice(index, 1);
            entry.cleanupAbort?.();
            reject(
              new DraftrollAbortError('Renderer presentation', options.signal?.reason, 'renderer'),
            );
          };
          options.signal.addEventListener('abort', handleAbort, { once: true });
          entry.cleanupAbort = () => options.signal?.removeEventListener('abort', handleAbort);
        }
        this.pendingTablePresentations.push(entry);
        this.scheduleTableFlush(prepared);
      });
    } catch (caught) {
      let error = caught;
      if (
        options.preservePreviousDice === true &&
        options.replaceFallbackResult &&
        !options.signal?.aborted
      ) {
        try {
          return await this.playRoll(
            options.replaceFallbackResult,
            withoutPersistentTableOptions(options),
          );
        } catch (replacementError) {
          error = replacementError;
        }
      }
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.emitLifecycle('error', { error: normalized, result });
      throw normalized;
    }
  }

  private async playModifierSequence(
    result: NormalizedRollResult,
    options: RendererPlayOptions,
    stages: readonly ModifierPresentationStage[],
  ): Promise<RendererCompletion> {
    const visualCount = stages.reduce((sum, stage) => sum + stage.dieIds.length, 0);
    if (visualCount > this.maximumDice) {
      throw new UnsupportedRollError(
        `Draftroll supports at most ${this.maximumDice} visual components per staged throw`,
        result,
      );
    }
    const sequenceId =
      result.rollId ??
      `sequence:${result.createdAt}:${String(options.animationSeed ?? result.total)}`;
    const preparedStages: PreparedRollPresentation[] = [];
    for (let stageIndex = 0; stageIndex < stages.length; stageIndex += 1) {
      const stage = stages[stageIndex];
      const stageOptions: RendererPlayOptions =
        stageIndex === 0
          ? options
          : {
              ...options,
              startTime: undefined,
              elapsedMs: 0,
              animationSeed: `${String(options.animationSeed ?? result.rollId ?? `${result.createdAt}:${result.total}`)}:modifier:${stageIndex}`,
            };
      preparedStages.push(
        await this.prepareRoll(
          result,
          {
            ...stageOptions,
            table: { ...options.table, mode: 'queue' },
          },
          {
            dieIds: stage.dieIds,
            tableMode:
              stageIndex === 0
                ? options.preservePreviousDice === true || options.table?.mode === 'concurrent'
                  ? 'add'
                  : 'replace'
                : 'add',
            sequence: {
              id: sequenceId,
              stageIndex,
              stageCount: stages.length,
              pending: stageIndex < stages.length - 1,
              generatedBy: stages[Math.min(stageIndex + 1, stages.length - 1)].generatedBy,
            },
          },
        ),
      );
    }

    let replay: unknown = null;
    let presentationMode: RendererCompletion['presentationMode'];
    for (let stageIndex = 0; stageIndex < preparedStages.length; stageIndex += 1) {
      throwIfAborted(options.signal, 'Renderer modifier sequence');
      const [completion] = await this.executePreparedBatch([preparedStages[stageIndex]], {
        emitStarted: stageIndex === 0,
        emitCompleted: stageIndex === preparedStages.length - 1,
        scheduleAutoClear: stageIndex === preparedStages.length - 1,
      });
      replay = completion.replay;
      presentationMode = completion.presentationMode;
    }
    return {
      results: result.dice.map((die) => die.result),
      total: result.total,
      replay,
      presentationMode,
    };
  }

  private async prepareRoll(
    result: NormalizedRollResult,
    options: RendererPlayOptions,
    internal: {
      dieIds?: readonly string[];
      tableMode?: 'replace' | 'add';
      sequence?: ModifierPresentationSequence;
    } = {},
  ): Promise<PreparedRollPresentation> {
    const requestedIds = internal.dieIds ?? options.dieIds;
    const selectedIds = requestedIds ? new Set(requestedIds) : null;
    const dice = selectedIds ? result.dice.filter((die) => selectedIds.has(die.id)) : result.dice;
    if (selectedIds && dice.length !== selectedIds.size) {
      const missing = [...selectedIds].filter((id) => !result.dice.some((die) => die.id === id));
      throw new UnsupportedRollError(
        `Unknown die IDs requested for rendering: ${missing.join(', ')}`,
        result,
      );
    }
    if (dice.length > this.maximumDice)
      throw new UnsupportedRollError(
        `Draftroll supports at most ${this.maximumDice} visual components per throw`,
        result,
      );

    const definitions = new Map(
      (result.customDice ?? []).map((definition) => [definition.id, definition] as const),
    );
    const physical: PhysicalVisual[] = [];
    const fallbacks: DraftrollFallbackVisual[] = [];
    const visualOrder: DraftrollVisualOrderEntry[] = [];

    for (const die of dice) {
      const theme = await this.resolveRendererTheme(
        die.themeId ?? result.themeId ?? options.defaultThemeId ?? this.fallbackThemeId,
        options.signal,
      );
      const definition = definitions.get(die.customDiceId ?? '');
      const physicalFace = resolvePhysicalFace(die, definition);
      const physicalKind = physicalFace?.kind ?? normalizeKind(die.type, die.sides);
      const numericResult =
        physicalFace?.value ?? (typeof die.result === 'number' ? die.result : Number(die.result));
      const isPhysicalValue =
        options.forceFallback !== true &&
        physicalKind !== null &&
        Number.isInteger(numericResult) &&
        numericResult >= 1 &&
        numericResult <= maximumPhysicalValue(physicalKind) &&
        (physicalFace !== null || !isDistinctFallbackType(die.type));
      const outcome =
        options.outcomeResolver?.(die, result) ?? defaultOutcomeForDie(die, physicalKind);

      if (isPhysicalValue && physicalKind) {
        const index = physical.length;
        physical.push({
          die,
          kind: physicalKind,
          value: numericResult,
          theme,
          outcome,
          physics: die.physics,
        });
        visualOrder.push({ kind: 'physical', index, dieId: die.id });
        continue;
      }

      const index = fallbacks.length;
      fallbacks.push(createFallbackVisual(die, theme, outcome, definition));
      visualOrder.push({ kind: 'fallback', index, dieId: die.id });
    }

    if (visualOrder.length === 0) {
      const theme = await this.resolveRendererTheme(
        result.themeId ?? options.defaultThemeId ?? this.fallbackThemeId,
        options.signal,
      );
      fallbacks.push({
        id: result.rollId ? `${result.rollId}:total` : 'roll-total',
        type: 'total',
        kind: 'token',
        result: result.total,
        numericValue: result.total,
        title: result.name ?? result.expression ?? 'Result',
        label: String(result.total),
        theme,
        outcome: 'neutral',
        metadata: { synthetic: true, reason: 'roll-has-no-dice' },
      });
      visualOrder.push({ kind: 'fallback', index: 0, dieId: fallbacks[0].id });
    }

    const requestedTable = { ...this.tableDefaults, ...options.table };
    const table = {
      ...requestedTable,
      mode: requestedTable.mode === 'concurrent' ? ('concurrent' as const) : ('queue' as const),
      batchWindowMs: clampInteger(requestedTable.batchWindowMs, 0, 500, 140),
      maximumConcurrentRolls: clampInteger(requestedTable.maximumConcurrentRolls, 1, 12, 6),
      maximumConcurrentVisuals: clampInteger(
        requestedTable.maximumConcurrentVisuals,
        1,
        this.maximumDice,
        this.maximumDice,
      ),
    };
    const expectedResults = visualOrder.map((entry) =>
      entry.kind === 'physical'
        ? (physical[entry.index]?.value ?? 0)
        : (fallbacks[entry.index]?.result ?? ''),
    );
    return {
      result,
      options,
      physical,
      fallbacks,
      visualOrder,
      renderedDieIds: dice.map((die) => die.id),
      expectedResults,
      latePresentation: resolveLateEventPresentation(options),
      table,
      seed: options.animationSeed ?? result.rollId ?? `${result.createdAt}:${result.total}`,
      enqueuedAt: Date.now(),
      tableMode: internal.tableMode,
      sequence: internal.sequence,
    };
  }

  private scheduleTableFlush(prepared: PreparedRollPresentation): void {
    const totalPendingVisuals = this.pendingTablePresentations.reduce(
      (sum, entry) => sum + entry.prepared.visualOrder.length,
      0,
    );
    if (
      this.pendingTablePresentations.length >= prepared.table.maximumConcurrentRolls ||
      totalPendingVisuals >= prepared.table.maximumConcurrentVisuals
    ) {
      this.flushTablePresentations();
      return;
    }
    const startTime = prepared.options.startTime;
    const untilStart =
      typeof startTime === 'number' && Number.isFinite(startTime)
        ? Math.max(0, startTime - Date.now() - 24)
        : prepared.table.batchWindowMs;
    const delay = Math.min(prepared.table.batchWindowMs, untilStart);
    if (this.tableFlushTimer !== null) return;
    this.tableFlushTimer = setTimeout(() => {
      this.tableFlushTimer = null;
      this.flushTablePresentations();
    }, delay);
  }

  private flushTablePresentations(): void {
    if (this.tableFlushTimer !== null) {
      clearTimeout(this.tableFlushTimer);
      this.tableFlushTimer = null;
    }
    if (this.pendingTablePresentations.length === 0) return;
    const pending = this.pendingTablePresentations.splice(0);
    const batches: PendingTablePresentation[][] = [];
    for (const candidate of pending) {
      let batch = batches.at(-1);
      if (!batch || !this.canJoinTableBatch(batch, candidate)) {
        batch = [];
        batches.push(batch);
      }
      batch.push(candidate);
    }
    for (const batch of batches) {
      void this.executePreparedBatch(batch.map((entry) => entry.prepared)).then(
        (completions) =>
          batch.forEach((entry, index) => {
            entry.cleanupAbort?.();
            entry.resolve(completions[index]);
          }),
        (error) =>
          batch.forEach((entry) => {
            entry.cleanupAbort?.();
            entry.reject(error instanceof Error ? error : new Error(String(error)));
          }),
      );
    }
  }

  private canJoinTableBatch(
    batch: PendingTablePresentation[],
    candidate: PendingTablePresentation,
  ): boolean {
    const first = batch[0].prepared;
    const currentVisuals = batch.reduce((sum, entry) => sum + entry.prepared.visualOrder.length, 0);
    const maximumRolls = Math.min(
      first.table.maximumConcurrentRolls,
      candidate.prepared.table.maximumConcurrentRolls,
    );
    const maximumVisuals = Math.min(
      first.table.maximumConcurrentVisuals,
      candidate.prepared.table.maximumConcurrentVisuals,
    );
    if (
      batch.length >= maximumRolls ||
      currentVisuals + candidate.prepared.visualOrder.length > maximumVisuals
    )
      return false;
    if (
      first.latePresentation.settleImmediately !==
      candidate.prepared.latePresentation.settleImmediately
    )
      return false;
    if (first.latePresentation.mode !== candidate.prepared.latePresentation.mode) return false;
    const firstTime = finiteStartTime(first) ?? first.enqueuedAt;
    const candidateTime = finiteStartTime(candidate.prepared) ?? candidate.prepared.enqueuedAt;
    const windowMs = Math.min(first.table.batchWindowMs, candidate.prepared.table.batchWindowMs);
    return Math.abs(firstTime - candidateTime) <= windowMs;
  }

  private async executePreparedBatch(
    entries: PreparedRollPresentation[],
    execution: ExecutePreparedBatchOptions = {},
  ): Promise<RendererCompletion[]> {
    const numericResults: number[] = [];
    const physicalKinds: DraftrollDieKind[] = [];
    const themes: string[] = [];
    const outcomes: DraftrollEffectOutcome[] = [];
    const physics: DicePhysicsProperties[] = [];
    const fallbacks: DraftrollFallbackVisual[] = [];
    const visualOrder: DraftrollVisualOrderEntry[] = [];
    const tableRolls: TableRollContextEntry[] = [];

    for (const entry of entries) {
      const physicalStart = numericResults.length;
      const fallbackStart = fallbacks.length;
      entry.physical.forEach((visual) => {
        numericResults.push(visual.value);
        physicalKinds.push(visual.kind);
        themes.push(visual.theme);
        outcomes.push(visual.outcome);
        physics.push({ ...visual.physics });
      });
      entry.fallbacks.forEach((fallback) => fallbacks.push({ ...fallback }));
      entry.visualOrder.forEach((visual) =>
        visualOrder.push(
          visual.kind === 'physical'
            ? { ...visual, index: visual.index + physicalStart }
            : { ...visual, index: visual.index + fallbackStart },
        ),
      );
      tableRolls.push({
        groupId:
          entry.table.groupId ?? entry.result.rollId ?? `table-roll-${tableRolls.length + 1}`,
        rollId: entry.result.rollId,
        actorLabel: entry.table.actorLabel,
        rollLabel: entry.table.rollLabel ?? entry.result.name,
        total: entry.result.total,
        expression: entry.result.expression,
        physicalStart,
        physicalCount: entry.physical.length,
        fallbackStart,
        fallbackCount: entry.fallbacks.length,
        visualCount: entry.visualOrder.length,
      });
    }

    const presentationMode =
      entries[0].tableMode ??
      (entries[0].options.preservePreviousDice === true || entries[0].table.mode === 'concurrent'
        ? 'add'
        : 'replace');
    if (numericResults.length > 0 && presentationMode === 'replace') {
      // These legacy bridge setters rebuild the browser table. They are useful
      // for a replacement cast, but calling them before an additive modifier
      // stage would remove the settled dice that the new dice must join.
      this.bridge.setQuantity(numericResults.length);
      this.bridge.setTheme(themes[0] ?? this.fallbackThemeId);
    }
    const startTimes = entries
      .map((entry) => finiteStartTime(entry))
      .filter((value): value is number => value !== null);
    const animationDurations = entries
      .map((entry) => entry.options.animationDurationMs)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const combinedTotal = entries.reduce((sum, entry) => sum + entry.result.total, 0);
    const renderedDice = entries.flatMap((entry) =>
      resolvePresentationStateDice(entry).map((die) => ({
        id: die.id,
        type: die.type,
        result: die.result,
        kept: die.kept,
        generatedBy: die.generatedBy,
        generatedFromDieId: die.generatedFromDieId,
      })),
    );
    const persistentTable = entries.some((entry) => entry.table.mode === 'concurrent');
    const modifierSequence = entries.length === 1 ? entries[0].sequence : undefined;
    const context =
      entries.length === 1 && (!persistentTable || modifierSequence)
        ? {
            authority: entries[0].result.authority,
            name: entries[0].result.name,
            rollId: entries[0].result.rollId,
            sequence: entries[0].result.sequence,
            expression: entries[0].result.expression,
            normalizedTotal: modifierSequence?.pending ? undefined : entries[0].result.total,
            metadata: entries[0].result.metadata,
            renderedDieIds: entries[0].renderedDieIds,
            renderedDice,
            modifierSequenceId: modifierSequence?.id,
            modifierSequenceStage: modifierSequence ? modifierSequence.stageIndex + 1 : undefined,
            modifierSequenceStages: modifierSequence?.stageCount,
            modifierSequencePending: modifierSequence?.pending,
            modifierSequenceGeneratedBy: modifierSequence?.generatedBy,
          }
        : {
            authority: 'table',
            name: `${entries.length} table roll${entries.length === 1 ? '' : 's'}`,
            normalizedTotal: combinedTotal,
            tableRolls,
            renderedDieIds: entries.flatMap((entry) => entry.renderedDieIds),
            renderedDice,
          };
    if (execution.emitStarted ?? true) {
      entries.forEach((entry) =>
        this.emitLifecycle('started', { result: entry.result, options: entry.options }),
      );
    }
    const bridgePromise = this.bridge.roll({
      results: numericResults,
      outcomes,
      themes,
      kinds: physicalKinds,
      physics,
      physicsPreset: entries[0].options.physicsPreset,
      fallbacks,
      visualOrder,
      context,
      seed:
        entries.length === 1
          ? entries[0].seed
          : `table:${entries.map((entry) => String(entry.seed)).join('|')}`,
      startAtMs: startTimes.length > 0 ? Math.max(...startTimes) : undefined,
      seekToMs: Math.max(...entries.map((entry) => entry.latePresentation.seekToMs)),
      animationDurationMs:
        animationDurations.length > 0 ? Math.max(...animationDurations) : undefined,
      settleImmediately:
        entries.every((entry) => entry.latePresentation.settleImmediately) ||
        entries.every((entry) => entry.options.reducedMotion === true),
      lateMode: entries[0].latePresentation.mode,
      settleAfterProgress: entries[0].options.lateEvent?.settleAfterProgress,
      tableMode: presentationMode,
      signal: entries.length === 1 ? entries[0].options.signal : undefined,
      reducedMotion: entries.every((entry) => entry.options.reducedMotion === true),
    });
    const completion = await raceWithAbort(
      bridgePromise,
      entries.length === 1 ? entries[0].options.signal : undefined,
      'Renderer bridge presentation',
    );
    this.recordActivePresentations(entries);
    const completions = entries.map((entry) => ({
      results: entry.expectedResults.slice(),
      total: entry.result.total,
      replay: completion.replay,
      presentationMode,
    }));
    if (execution.emitCompleted ?? true) {
      entries.forEach((entry, index) => {
        const item = completions[index];
        this.emitLifecycle('settled', { result: entry.result, completion: item });
        this.emitLifecycle('completed', { result: entry.result, completion: item });
      });
    }
    if (execution.scheduleAutoClear ?? true) {
      entries.forEach((entry) => this.scheduleAutoClear(entry.options.autoClearMs));
    }
    return completions;
  }

  /**
   * Updates labels and totals without replaying the full roll.
   */
  updateResult(_result: NormalizedRollResult, _options: RendererResultUpdateOptions = {}): void {
    // The direct bridge has no host-side result UI. Overlay and custom renderers
    // can implement this hook to replace an existing log/result entry.
  }

  /**
   * Dismisses one logical roll from the table.
   */
  async dismiss(options: RendererDismissOptions = {}): Promise<void> {
    this.cancelAutoClear();
    this.emitLifecycle('dissolveStarted', { options });
    if (this.bridge.dismiss)
      await raceWithAbort(
        Promise.resolve(this.bridge.dismiss(options)),
        options.signal,
        'Renderer dismissal',
      );
    else this.bridge.clear?.();
    this.resetActivePresentations();
    this.emitLifecycle('dissolveFinished', { options });
  }

  /**
   * Clears all table groups and presentation history.
   */
  clear(): void {
    this.cancelAutoClear();
    this.cancelPendingTablePresentations(
      new DraftrollStateError('Draftroll table presentations were cleared', {
        package: 'renderer',
        recoverable: true,
      }),
    );
    this.bridge.clear?.();
    this.resetActivePresentations();
    this.emitLifecycle('cleared', {});
  }

  /**
   * Pauses active trajectories.
   */
  async pause(): Promise<void> {
    if (this.paused) return;
    await this.bridge.pause?.();
    this.paused = true;
    this.emitLifecycle('paused', {});
  }

  /**
   * Resumes active trajectories.
   */
  async resume(): Promise<void> {
    if (!this.paused) return;
    await this.bridge.resume?.();
    this.paused = false;
    this.emitLifecycle('resumed', {});
  }

  /**
   * Captures the renderer canvas.
   */
  async screenshot(): Promise<Blob | string> {
    if (!this.bridge.screenshot) {
      throw new DraftrollError(
        'renderer_screenshot_unavailable',
        'The active renderer does not support screenshots',
        {
          package: 'renderer',
          recoverable: true,
        },
      );
    }
    return this.bridge.screenshot();
  }

  /**
   * Applies camera position and projection controls.
   */
  async configureCamera(options: RendererCameraOptions): Promise<void> {
    if (!this.bridge.configureCamera) {
      throw new DraftrollError(
        'renderer_camera_unavailable',
        'The active renderer does not support camera controls',
        {
          package: 'renderer',
          recoverable: true,
        },
      );
    }
    await this.bridge.configureCamera(options);
  }

  /**
   * Restores the default camera.
   */
  async resetCamera(): Promise<void> {
    if (!this.bridge.resetCamera) {
      throw new DraftrollError(
        'renderer_camera_unavailable',
        'The active renderer does not support camera reset',
        {
          package: 'renderer',
          recoverable: true,
        },
      );
    }
    await this.bridge.resetCamera();
  }

  /**
   * Displays non-authoritative preview dice.
   */
  async preview(options: RendererPreviewOptions = {}): Promise<RendererCompletion> {
    throwIfAborted(options.signal, 'Renderer preview');
    if (this.bridge.preview) return this.bridge.preview(options);
    const type = options.dieType ?? 'd20';
    const sides = Number(type.toLowerCase().replace(/^d/, '')) || 20;
    const value = options.value ?? Math.max(1, Math.ceil(sides / 2));
    const result: NormalizedRollResult = {
      schemaVersion: 1,
      authority: 'external',
      total: typeof value === 'number' ? value : 0,
      dice: [
        {
          id: 'preview-die',
          type,
          sides,
          result: value,
          numericValue: typeof value === 'number' ? value : 0,
          kept: true,
          generatedBy: 'external',
          themeId: options.themeId,
        },
      ],
      operations: [],
      createdAt: new Date().toISOString(),
      themeId: options.themeId,
      name: 'Theme preview',
    };
    return this.playRoll(result, { signal: options.signal, defaultThemeId: options.themeId });
  }

  /**
   * Filters table groups by participant.
   */
  setParticipantFilter(filter?: RendererParticipantFilter): void {
    this.participantFilter = filter;
  }

  /**
   * Configures pointer selection and die dragging.
   */
  async configureInteractions(options: RendererInteractionOptions): Promise<void> {
    if (!this.bridge.configureInteractions) {
      throw new DraftrollError(
        'renderer_interactions_unavailable',
        'The active renderer does not support physical interactions',
        {
          package: 'renderer',
          recoverable: true,
        },
      );
    }
    await this.bridge.configureInteractions(options);
  }

  private canAppendToActivePresentation(result: NormalizedRollResult): boolean {
    if (!this.hasActivePresentation) return false;
    return (
      result.rollId === undefined ||
      this.activeRollIds.size === 0 ||
      this.activeRollIds.has(result.rollId)
    );
  }

  private recordActivePresentations(entries: readonly PreparedRollPresentation[]): void {
    const tableMode =
      entries[0]?.tableMode ??
      (entries[0]?.options.preservePreviousDice === true || entries[0]?.table.mode === 'concurrent'
        ? 'add'
        : 'replace');
    if (tableMode === 'replace') this.activeRollIds.clear();
    for (const entry of entries) {
      if (entry.result.rollId) this.activeRollIds.add(entry.result.rollId);
    }
    this.hasActivePresentation = true;
  }

  private resetActivePresentations(): void {
    this.activeRollIds.clear();
    this.hasActivePresentation = false;
  }

  private cancelPendingTablePresentations(error: Error): void {
    if (this.tableFlushTimer !== null) {
      clearTimeout(this.tableFlushTimer);
      this.tableFlushTimer = null;
    }
    this.pendingTablePresentations.splice(0).forEach((entry) => {
      entry.cleanupAbort?.();
      entry.reject(error);
    });
  }

  private shouldPresent(result: NormalizedRollResult): boolean {
    if (!this.participantFilter) return true;
    const participantId =
      typeof result.metadata?.participantId === 'string'
        ? result.metadata.participantId
        : typeof result.metadata?.actorParticipantId === 'string'
          ? result.metadata.actorParticipantId
          : undefined;
    if (typeof this.participantFilter !== 'function') {
      return participantId !== undefined && this.participantFilter.includes(participantId);
    }
    return this.participantFilter({ participantId, result });
  }

  private scheduleAutoClear(autoClearMs: number | undefined): void {
    this.cancelAutoClear();
    if (typeof autoClearMs !== 'number' || !Number.isFinite(autoClearMs) || autoClearMs < 0) return;
    this.autoClearTimer = setTimeout(() => {
      this.autoClearTimer = null;
      void this.dismiss({ durationMs: Math.min(320, autoClearMs), hideResult: true });
    }, autoClearMs);
  }

  private cancelAutoClear(): void {
    if (this.autoClearTimer === null) return;
    clearTimeout(this.autoClearTimer);
    this.autoClearTimer = null;
  }

  private emitLifecycle<K extends RendererLifecycleEventName>(
    event: K,
    payload: RendererLifecycleEventMap[K],
  ): void {
    for (const handler of this.lifecycleHandlers.get(event) ?? []) {
      try {
        // Handlers are stored contravariantly at `never` so one map can hold every event's
        // handler. `on` only ever files a handler under its own key, so widening back to this
        // key's payload type restores the signature the caller registered.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        (handler as (value: RendererLifecycleEventMap[K]) => void)(payload);
      } catch {
        // Lifecycle observers are informational and cannot break presentation.
      }
    }
  }

  private async resolveRendererTheme(themeId: string, signal?: AbortSignal): Promise<string> {
    if (this.installedThemes.has(themeId)) return themeId;
    if (!this.themeProvider || !this.bridge.installTheme) return this.fallbackThemeId;
    const existing = this.themeLoads.get(themeId);
    if (existing) return existing;

    const loading = (async () => {
      try {
        const bundle = await prepareRuntimeTheme(this.themeProvider!, themeId, {
          signal,
          maximumAssetBytes: this.maximumThemeAssetBytes,
          maximumTotalBytes: this.maximumThemeTotalBytes,
          onEvent: this.onThemeLoad,
        });
        this.themeCache.set(themeId, bundle.manifest);
        const installed = await this.bridge.installTheme!(bundle);
        this.installedThemes.add(installed.id);
        return installed.id;
      } catch (error) {
        if (this.strictThemes) throw error;
        return this.fallbackThemeId;
      } finally {
        this.themeLoads.delete(themeId);
      }
    })();
    this.themeLoads.set(themeId, loading);
    return loading;
  }
}

function clampInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function finiteStartTime(prepared: PreparedRollPresentation): number | null {
  const value = prepared.options.startTime;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getWindowBridge(): DraftrollBridge | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as Window & { draftrollDice?: DraftrollBridge }).draftrollDice;
  return candidate ?? null;
}

function normalizeKind(type: string, sides?: number): DraftrollDieKind | null {
  const normalized = type.toLowerCase();
  if (normalized === 'd2') return 'coin';
  if (
    normalized === 'd4' ||
    normalized === 'd6' ||
    normalized === 'd8' ||
    normalized === 'd10' ||
    normalized === 'd12' ||
    normalized === 'd20'
  ) {
    return normalized;
  }
  const inferred = sides ? `d${sides}` : '';
  if (inferred === 'd2') return 'coin';
  return inferred === 'd4' ||
    inferred === 'd6' ||
    inferred === 'd8' ||
    inferred === 'd10' ||
    inferred === 'd12' ||
    inferred === 'd20'
    ? inferred
    : null;
}

function maximumPhysicalValue(kind: DraftrollDieKind): number {
  return kind === 'coin' ? 2 : Number(kind.slice(1));
}

function resolvePhysicalFace(
  die: NormalizedDieResult,
  definition: CustomDiceDefinition | undefined,
): { kind: DraftrollDieKind; value: number } | null {
  const kind = normalizeKind(definition?.renderAs ?? '', undefined);
  if (!definition || !kind) return null;
  const maximum = maximumPhysicalValue(kind);
  let faceIndex = die.faceIndex;
  if (faceIndex === undefined) {
    const matches = definition.faces
      .map((face, index) => ({ face, index }))
      .filter(
        ({ face }) =>
          face.result === die.result &&
          (face.value ?? numericFaceValue(face.result)) ===
            (die.numericValue ?? numericFaceValue(die.result)),
      );
    if (matches.length === 1) faceIndex = matches[0].index;
  }
  if (faceIndex === undefined || !Number.isInteger(faceIndex) || faceIndex < 0) return null;
  return { kind, value: (faceIndex % maximum) + 1 };
}

function numericFaceValue(value: number | string): number {
  return typeof value === 'number' ? value : Number(value) || 0;
}

function withoutPersistentTableOptions(options: RendererPlayOptions): RendererPlayOptions {
  const {
    preservePreviousDice: _preservePreviousDice,
    stateDieIds: _stateDieIds,
    replaceFallbackResult: _replaceFallbackResult,
    dieIds: _dieIds,
    ...replacementOptions
  } = options;
  return replacementOptions;
}

function resolvePresentationStateDice(entry: PreparedRollPresentation): NormalizedDieResult[] {
  const byId = new Map(entry.result.dice.map((die) => [die.id, die] as const));
  const requested = new Set<string>([
    ...entry.renderedDieIds,
    ...(entry.options.stateDieIds ?? []),
  ]);
  const queue = [...requested];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) break;
    const die = byId.get(next);
    const parentId = die?.generatedFromDieId;
    if (!parentId || requested.has(parentId) || !byId.has(parentId)) continue;
    requested.add(parentId);
    queue.push(parentId);
  }
  return entry.result.dice.filter((die) => requested.has(die.id));
}

function resolveModifierPresentationStages(
  result: NormalizedRollResult,
  options: RendererPlayOptions,
): ModifierPresentationStage[] {
  const allDice = options.dieIds
    ? result.dice.filter((die) => options.dieIds?.includes(die.id))
    : result.dice;
  const singleStage = (): ModifierPresentationStage[] =>
    allDice.length > 0
      ? [
          {
            dieIds: allDice.map((die) => die.id),
            generatedBy: stageGenerationSource(allDice),
          },
        ]
      : [];

  if (
    options.modifierSequence === 'simultaneous' ||
    options.reducedMotion === true ||
    resolveLateEventPresentation(options).settleImmediately
  ) {
    return singleStage();
  }

  const generated = allDice.filter(
    (die) =>
      die.generatedBy === 'reroll' ||
      die.generatedBy === 'reroll-add' ||
      die.generatedBy === 'explosion',
  );
  if (generated.length === 0) return singleStage();

  const byId = new Map(allDice.map((die) => [die.id, die] as const));
  const depthById = new Map<string, number>();
  const resolveDepth = (die: NormalizedDieResult, visiting = new Set<string>()): number => {
    const existing = depthById.get(die.id);
    if (existing !== undefined) return existing;
    if (
      die.generatedBy === undefined ||
      die.generatedBy === 'initial' ||
      die.generatedBy === 'external'
    ) {
      depthById.set(die.id, 0);
      return 0;
    }
    if (visiting.has(die.id)) {
      depthById.set(die.id, 1);
      return 1;
    }
    visiting.add(die.id);
    const parent = die.generatedFromDieId ? byId.get(die.generatedFromDieId) : undefined;
    const depth = parent ? resolveDepth(parent, visiting) + 1 : 1;
    visiting.delete(die.id);
    depthById.set(die.id, depth);
    return depth;
  };

  const grouped = new Map<number, NormalizedDieResult[]>();
  for (const die of allDice) {
    const depth = resolveDepth(die);
    const group = grouped.get(depth) ?? [];
    group.push(die);
    grouped.set(depth, group);
  }
  return [...grouped.entries()]
    .toSorted(([left], [right]) => left - right)
    .map(([, dice]) => ({
      dieIds: dice.map((die) => die.id),
      generatedBy: stageGenerationSource(dice),
    }));
}

function stageGenerationSource(
  dice: readonly NormalizedDieResult[],
): ModifierPresentationStage['generatedBy'] {
  const sources = new Set(dice.map((die) => die.generatedBy ?? 'initial'));
  return sources.size === 1 ? [...sources][0] : 'mixed';
}

function isDistinctFallbackType(type: string): boolean {
  const normalized = type.toLowerCase();
  return (
    normalized === 'coin' ||
    normalized === 'd10x' ||
    normalized === 'd%' ||
    normalized === 'd100' ||
    normalized === 'df' ||
    normalized === 'fate'
  );
}

function createFallbackVisual(
  die: NormalizedDieResult,
  theme: string,
  outcome: DraftrollEffectOutcome,
  definition?: CustomDiceDefinition,
): DraftrollFallbackVisual {
  const renderAs = definition?.renderAs?.toLowerCase();
  const normalizedType = die.type.toLowerCase();
  const kind = normalizeFallbackKind(renderAs, normalizedType, die);
  const title = readDisplayTitle(die, definition, kind);
  const label = readDisplayLabel(die, kind);
  return {
    id: die.id,
    type: die.type,
    kind,
    result: die.result,
    numericValue: die.numericValue ?? (typeof die.result === 'number' ? die.result : undefined),
    sides: die.sides,
    title,
    label,
    oppositeLabel: kind === 'coin' ? readOppositeCoinLabel(die, definition) : undefined,
    theme,
    outcome,
    metadata: {
      ...definition?.metadata,
      ...die.metadata,
      ...(die.faceMetadata ? { faceMetadata: die.faceMetadata } : {}),
      ...(die.faceIndex !== undefined ? { faceIndex: die.faceIndex } : {}),
    },
  };
}

function readOppositeCoinLabel(
  die: NormalizedDieResult,
  definition: CustomDiceDefinition | undefined,
): string | undefined {
  if (definition?.faces.length === 2) {
    const selectedIndex =
      die.faceIndex !== undefined
        ? die.faceIndex
        : definition.faces.findIndex((face) => face.result === die.result);
    if (selectedIndex === 0 || selectedIndex === 1) {
      const opposite = definition.faces[1 - selectedIndex];
      return opposite.label ?? String(opposite.result);
    }
  }

  const normalizedType = die.type.toLowerCase();
  if (typeof die.result === 'number') {
    if (normalizedType === 'd2' || (die.sides === 2 && die.result >= 1)) {
      if (die.result === 1 || die.result === 2) return String(3 - die.result);
    }
    if (normalizedType === 'coin' && (die.result === 0 || die.result === 1)) {
      return String(1 - die.result);
    }
  }

  const result = String(die.result).toLowerCase();
  if (result === 'heads') return 'Tails';
  if (result === 'tails') return 'Heads';
  return undefined;
}

function normalizeFallbackKind(
  renderAs: string | undefined,
  normalizedType: string,
  die: NormalizedDieResult,
): DraftrollFallbackKind {
  if (
    renderAs === 'coin' ||
    renderAs === 'percentile' ||
    renderAs === 'fate' ||
    renderAs === 'spinner' ||
    renderAs === 'token' ||
    renderAs === 'card'
  ) {
    return renderAs;
  }
  if (normalizedType === 'd2' || normalizedType === 'coin' || die.sides === 2) return 'coin';
  if (
    normalizedType === 'd10x' ||
    normalizedType === 'd%' ||
    normalizedType === 'd100' ||
    die.sides === 100
  )
    return 'percentile';
  if (normalizedType === 'df' || normalizedType === 'fate') return 'fate';
  if (die.customDiceId || typeof die.result === 'string') return 'card';
  if (typeof die.sides === 'number' && Number.isFinite(die.sides)) return 'spinner';
  return 'token';
}

function readDisplayTitle(
  die: NormalizedDieResult,
  definition: CustomDiceDefinition | undefined,
  kind: DraftrollFallbackKind,
): string {
  const metadataLabel = typeof die.metadata?.label === 'string' ? die.metadata.label : undefined;
  const definitionLabel =
    typeof definition?.metadata?.name === 'string' ? definition.metadata.name : undefined;
  if (metadataLabel) return metadataLabel;
  if (definitionLabel) return definitionLabel;
  if (kind === 'coin') return 'Coin';
  if (kind === 'percentile')
    return die.type.toLowerCase() === 'd10x' ? 'Percentile tens' : 'Percentile';
  if (kind === 'fate') return 'Fate die';
  if (kind === 'spinner' && die.sides) return `d${die.sides}`;
  return die.customDiceId ?? die.type;
}

function readDisplayLabel(die: NormalizedDieResult, kind: DraftrollFallbackKind): string {
  if (die.faceLabel) return die.faceLabel;
  if (kind === 'fate') {
    const numeric = typeof die.result === 'number' ? die.result : Number(die.numericValue);
    if (numeric === 1) return '+';
    if (numeric === -1) return '−';
    if (numeric === 0) return '0';
  }
  if (
    kind === 'percentile' &&
    die.type.toLowerCase() === 'd10x' &&
    typeof die.result === 'number'
  ) {
    return String(die.result === 10 ? 0 : die.result * 10).padStart(2, '0');
  }
  return String(die.result);
}

function defaultOutcomeForDie(
  die: NormalizedDieResult,
  physicalKind: DraftrollDieKind | null,
): DraftrollEffectOutcome {
  if (!die.kept) return 'none';
  const value =
    die.numericValue ?? (typeof die.result === 'number' ? die.result : Number(die.result));
  if (Number.isFinite(value)) {
    if (die.type.toLowerCase() === 'df' || die.type.toLowerCase() === 'fate') {
      if (value > 0) return 'positive';
      if (value < 0) return 'negative';
      return 'neutral';
    }
    const maximum = physicalKind ? maximumPhysicalValue(physicalKind) : die.sides;
    if (maximum !== undefined && value === maximum) return 'positive';
    if (value === 1 && maximum !== 2) return 'negative';
  }
  return 'neutral';
}
