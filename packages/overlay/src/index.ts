/**
 * Iframe overlay renderer and accessible result-panel components.
 *
 * @remarks
 * Provides the host-to-overlay transport used by embedded browser integrations.
 *
 * @packageDocumentation
 */

import type { NormalizedDieResult, NormalizedRollResult } from '../../protocol/src/index';
import {
  prepareRuntimeTheme,
  type RuntimeThemeBundle,
  type ThemeLoadEvent,
  type ThemeProvider,
} from '../../themes/src/index';
import type {
  DiceRenderer,
  DraftrollEffectOutcome,
  RendererCompletion,
  RendererPlayOptions,
  RendererResultUpdateOptions,
  RendererPerformanceOptions,
  RendererCameraOptions,
  RendererInteractionOptions,
  RendererLifecycleEventMap,
  RendererLifecycleEventName,
  RendererParticipantFilter,
  RendererPreviewOptions,
} from '../../renderer/src/index';
import {
  DRAFTROLL_ERROR_CODES,
  DraftrollAbortError,
  DraftrollError,
  DraftrollStateError,
  throwIfAborted,
} from '../../errors/src/index';

/**
 * Current host-to-overlay message protocol version.
 *
 * @public
 */
export const DRAFTROLL_OVERLAY_PROTOCOL_VERSION = 3 as const;
/**
 * Source marker placed on overlay-to-host messages.
 *
 * @public
 */
export const DRAFTROLL_OVERLAY_SOURCE = 'draftroll-overlay' as const;
/**
 * Source marker placed on host-to-overlay messages.
 *
 * @public
 */
export const DRAFTROLL_HOST_SOURCE = 'draftroll-host' as const;

/**
 * Renderer play options safe to clone across `postMessage`.
 *
 * @public
 */
export interface OverlaySerializablePlayOptions extends Omit<
  RendererPlayOptions,
  'outcomeResolver' | 'signal'
> {}

/**
 * Controls overlay dismissal timing and animation.
 *
 * @public
 */
export interface DraftrollDismissOptions {
  /** Length of the visual dissolve before the physical dice are removed. */
  durationMs?: number;
  /** Hide the SDK result panel with the dice. Defaults to true. */
  hideResult?: boolean;
  signal?: AbortSignal;
}

/**
 * Messages accepted by the iframe overlay.
 *
 * @public
 */
export type DraftrollHostMessage =
  | {
      source: typeof DRAFTROLL_HOST_SOURCE;
      version: typeof DRAFTROLL_OVERLAY_PROTOCOL_VERSION;
      type: 'warmup';
      requestId: string;
      themeIds?: string[];
    }
  | {
      source: typeof DRAFTROLL_HOST_SOURCE;
      version: typeof DRAFTROLL_OVERLAY_PROTOCOL_VERSION;
      type: 'install-theme';
      requestId: string;
      bundle: RuntimeThemeBundle;
    }
  | {
      source: typeof DRAFTROLL_HOST_SOURCE;
      version: typeof DRAFTROLL_OVERLAY_PROTOCOL_VERSION;
      type: 'unload-theme';
      requestId: string;
      themeId: string;
    }
  | {
      source: typeof DRAFTROLL_HOST_SOURCE;
      version: typeof DRAFTROLL_OVERLAY_PROTOCOL_VERSION;
      type: 'configure';
      requestId: string;
      options: RendererPerformanceOptions;
    }
  | {
      source: typeof DRAFTROLL_HOST_SOURCE;
      version: typeof DRAFTROLL_OVERLAY_PROTOCOL_VERSION;
      type: 'play';
      requestId: string;
      result: NormalizedRollResult;
      options: OverlaySerializablePlayOptions;
      outcomes?: DraftrollEffectOutcome[];
    }
  | {
      source: typeof DRAFTROLL_HOST_SOURCE;
      version: typeof DRAFTROLL_OVERLAY_PROTOCOL_VERSION;
      type: 'dismiss';
      requestId: string;
      options?: Omit<DraftrollDismissOptions, 'signal'>;
    }
  | {
      source: typeof DRAFTROLL_HOST_SOURCE;
      version: typeof DRAFTROLL_OVERLAY_PROTOCOL_VERSION;
      type: 'clear';
      requestId: string;
    }
  | {
      source: typeof DRAFTROLL_HOST_SOURCE;
      version: typeof DRAFTROLL_OVERLAY_PROTOCOL_VERSION;
      type: 'pause' | 'resume' | 'reset-camera' | 'screenshot';
      requestId: string;
    }
  | {
      source: typeof DRAFTROLL_HOST_SOURCE;
      version: typeof DRAFTROLL_OVERLAY_PROTOCOL_VERSION;
      type: 'configure-camera';
      requestId: string;
      options: RendererCameraOptions;
    }
  | {
      source: typeof DRAFTROLL_HOST_SOURCE;
      version: typeof DRAFTROLL_OVERLAY_PROTOCOL_VERSION;
      type: 'configure-interactions';
      requestId: string;
      options: RendererInteractionOptions;
    }
  | {
      source: typeof DRAFTROLL_HOST_SOURCE;
      version: typeof DRAFTROLL_OVERLAY_PROTOCOL_VERSION;
      type: 'preview';
      requestId: string;
      options: Omit<RendererPreviewOptions, 'signal'>;
    };

type DraftrollOverlayCommand = DraftrollHostMessage extends infer Message
  ? Message extends DraftrollHostMessage
    ? Omit<Message, 'source' | 'version' | 'requestId'>
    : never
  : never;

/**
 * Messages emitted by the iframe overlay.
 *
 * @public
 */
export type DraftrollOverlayMessage =
  | {
      source: typeof DRAFTROLL_OVERLAY_SOURCE;
      version: typeof DRAFTROLL_OVERLAY_PROTOCOL_VERSION;
      type: 'ready';
    }
  | {
      source: typeof DRAFTROLL_OVERLAY_SOURCE;
      version: typeof DRAFTROLL_OVERLAY_PROTOCOL_VERSION;
      type: 'complete';
      requestId: string;
      completion: RendererCompletion | null;
      dataUrl?: string;
    }
  | {
      source: typeof DRAFTROLL_OVERLAY_SOURCE;
      version: typeof DRAFTROLL_OVERLAY_PROTOCOL_VERSION;
      type: 'error';
      requestId?: string;
      message: string;
    };

/**
 * Configures the accessible overlay result panel.
 *
 * @public
 */
export interface DraftrollResultPanelOptions {
  enabled?: boolean;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  title?: string;
  showExpression?: boolean;
  showAuthority?: boolean;
  showThemes?: boolean;
  allowReroll?: boolean;
  zIndex?: number;
}

/**
 * Configures an iframe overlay renderer and optional result panel.
 *
 * @public
 */
export interface DraftrollOverlayOptions {
  /** URL of the production overlay.html output. */
  src?: string;
  container?: HTMLElement;
  className?: string;
  title?: string;
  zIndex?: number;
  targetOrigin?: string;
  /** Referrer policy applied to the renderer iframe. Defaults to no-referrer. */
  referrerPolicy?: ReferrerPolicy;
  /** Optional iframe sandbox tokens. Use false to omit the sandbox attribute. */
  sandbox?: false | string | readonly string[];
  /** Optional iframe Permissions Policy allow attribute. */
  allow?: string;
  readyTimeoutMs?: number;
  results?: boolean | DraftrollResultPanelOptions;
  /** Dissolve completed dice on the next pointer click anywhere in the host document. Defaults to true. */
  dismissOnPointer?: boolean;
  /** Host selector whose matching targets should not dismiss the current table. Useful for roll controls. */
  dismissIgnoreSelector?: string;
  /** Default dissolve duration used by pointer dismissal. */
  dismissDurationMs?: number;
  /** Hide the transient SDK result panel when dice are dismissed. Defaults to true. */
  dismissResultPanel?: boolean;
  /** Optional source for constrained runtime themes loaded by the host and installed in the iframe. */
  themeProvider?: ThemeProvider;
  fallbackThemeId?: string;
  maximumThemeAssetBytes?: number;
  maximumThemeTotalBytes?: number;
  onThemeLoad?: (event: ThemeLoadEvent) => void;
  strictThemes?: boolean;
  /** Renderer power/quality profile. Auto is the default and uses an idle-zero render loop. */
  performance?: RendererPerformanceOptions;
}

/**
 * Die and roll identity emitted by a result-panel reroll action.
 *
 * @public
 */
export interface RerollDieRequest {
  result: NormalizedRollResult;
  dieId: string;
}

/**
 * Callback invoked for a result-panel reroll action.
 *
 * @public
 */
export type RerollDieHandler = (request: RerollDieRequest) => void | Promise<void>;

type OverlayCompleteMessage = Extract<DraftrollOverlayMessage, { type: 'complete' }>;

interface PendingCommand {
  resolve: (message: OverlayCompleteMessage) => void;
  reject: (error: Error) => void;
  cleanupAbort?: () => void;
}

/**
 * Controls a Draftroll renderer hosted in an iframe overlay.
 *
 * @public
 */
export class DraftrollOverlayRenderer implements DiceRenderer {
  private readonly options: Required<
    Pick<
      DraftrollOverlayOptions,
      | 'src'
      | 'title'
      | 'zIndex'
      | 'readyTimeoutMs'
      | 'dismissOnPointer'
      | 'dismissDurationMs'
      | 'dismissResultPanel'
    >
  > &
    DraftrollOverlayOptions;
  private iframe: HTMLIFrameElement | null = null;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private readonly pending = new Map<string, PendingCommand>();
  private commandCounter = 0;
  private messageListener: ((event: MessageEvent) => void) | null = null;
  private pointerDismissListener: ((event: PointerEvent) => void) | null = null;
  private keyDismissListener: ((event: KeyboardEvent) => void) | null = null;
  private pointerDismissTimer: ReturnType<typeof setTimeout> | null = null;
  private dismissArmed = false;
  private presentationGeneration = 0;
  private panel: DraftrollResultPanel | null = null;
  private rerollHandler: RerollDieHandler | null = null;
  private targetOrigin = '*';
  private readonly installedThemes = new Set<string>();
  private readonly themeLoads = new Map<string, Promise<string>>();
  private performanceConfigurationPromise: Promise<void> | null = null;
  private readonly lifecycleHandlers = new Map<
    RendererLifecycleEventName,
    Set<(payload: never) => void>
  >();
  private participantFilter?: RendererParticipantFilter;

  /**
   * Creates an iframe-backed overlay renderer.
   */
  constructor(options: DraftrollOverlayOptions = {}) {
    this.options = {
      ...options,
      src: options.src ?? '/draftroll/overlay.html',
      title: options.title ?? 'Draftroll dice overlay',
      zIndex: options.zIndex ?? 2_147_483_000,
      readyTimeoutMs: options.readyTimeoutMs ?? 15_000,
      dismissOnPointer: options.dismissOnPointer ?? true,
      dismissDurationMs: options.dismissDurationMs ?? 320,
      dismissResultPanel: options.dismissResultPanel ?? true,
    };
  }

  /**
   * Underlying iframe element.
   */
  get element(): HTMLIFrameElement | null {
    return this.iframe;
  }

  /**
   * Attached accessible result panel, when enabled.
   */
  get resultPanel(): DraftrollResultPanel | null {
    return this.panel;
  }

  /**
   * Mounts and initializes the iframe overlay.
   */
  async mount(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal, 'Overlay mount');
    if (this.readyPromise) {
      if (!signal) return this.readyPromise;
      return new Promise<void>((resolve, reject) => {
        const handleAbort = () =>
          reject(new DraftrollAbortError('Overlay mount', signal.reason, 'overlay'));
        signal.addEventListener('abort', handleAbort, { once: true });
        this.readyPromise!.then(
          () => {
            signal.removeEventListener('abort', handleAbort);
            resolve();
          },
          (error) => {
            signal.removeEventListener('abort', handleAbort);
            reject(error);
          },
        );
      });
    }
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      throw new DraftrollError(
        DRAFTROLL_ERROR_CODES.overlayUnavailable,
        'DraftrollOverlayRenderer requires a browser DOM',
        {
          package: 'overlay',
          recoverable: false,
        },
      );
    }

    this.targetOrigin = this.options.targetOrigin ?? inferTargetOrigin(this.options.src);
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    this.messageListener = (event) => this.handleMessage(event);
    window.addEventListener('message', this.messageListener);
    if (this.options.dismissOnPointer) {
      this.pointerDismissListener = (event) => {
        if (!this.dismissArmed) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target && this.options.dismissIgnoreSelector) {
          try {
            if (target.closest(this.options.dismissIgnoreSelector)) return;
          } catch {
            // Invalid host selectors are ignored rather than breaking dismissal.
          }
        }
        const generation = this.presentationGeneration;
        if (this.pointerDismissTimer !== null) clearTimeout(this.pointerDismissTimer);
        // Defer until after the host click handler. A roll button can start a new
        // presentation during the same gesture, in which case clearing the table
        // would be surprising and would prevent additive table throws.
        this.pointerDismissTimer = setTimeout(() => {
          this.pointerDismissTimer = null;
          if (!this.dismissArmed || generation !== this.presentationGeneration) return;
          void this.dismiss().catch(() => undefined);
        }, 0);
      };
      document.addEventListener('pointerdown', this.pointerDismissListener, true);
    }
    this.keyDismissListener = (event) => {
      if (event.key !== 'Escape' || !this.dismissArmed || event.defaultPrevented) return;
      event.preventDefault();
      void this.dismiss().catch(() => undefined);
    };
    document.addEventListener('keydown', this.keyDismissListener);

    const iframe = document.createElement('iframe');
    iframe.src = this.options.src;
    iframe.title = this.options.title;
    iframe.className = this.options.className ?? '';
    iframe.referrerPolicy = this.options.referrerPolicy ?? 'no-referrer';
    const sandbox = normalizeSandbox(this.options.sandbox);
    if (sandbox) iframe.setAttribute('sandbox', sandbox);
    if (this.options.allow) iframe.setAttribute('allow', this.options.allow);
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('tabindex', '-1');
    Object.assign(iframe.style, {
      position: this.options.container ? 'absolute' : 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      border: '0',
      background: 'transparent',
      pointerEvents: 'none',
      zIndex: String(this.options.zIndex),
      display: 'block',
      visibility: 'hidden',
      opacity: '0',
      transition: 'opacity 80ms linear',
    });
    this.iframe = iframe;
    (this.options.container ?? document.body).append(iframe);

    const resultOptions = normalizeResultOptions(this.options.results, this.options.zIndex + 1);
    if (resultOptions.enabled) {
      this.panel = new DraftrollResultPanel(resultOptions, this.options.container ?? document.body);
      this.panel.setRerollHandler((request) => this.rerollHandler?.(request));
    }

    const timeout = window.setTimeout(() => {
      this.readyReject?.(
        new DraftrollError(
          DRAFTROLL_ERROR_CODES.overlayTimeout,
          `Draftroll overlay did not become ready within ${this.options.readyTimeoutMs}ms`,
          { package: 'overlay', recoverable: true },
        ),
      );
      this.readyReject = null;
      this.readyResolve = null;
    }, this.options.readyTimeoutMs);

    void this.readyPromise.then(
      () => window.clearTimeout(timeout),
      () => window.clearTimeout(timeout),
    );
    return this.readyPromise;
  }

  /**
   * Subscribes to an event and returns an unsubscribe function.
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
   * Prepares resources before the first presentation.
   */
  async warmup(themeIds?: string[], signal?: AbortSignal): Promise<void> {
    await this.mount(signal);
    await this.ensurePerformanceConfiguration();
    const requested = themeIds ?? [this.options.fallbackThemeId ?? 'dragon'];
    const resolved: string[] = [];
    for (const themeId of requested) resolved.push(await this.ensureTheme(themeId, signal));
    await this.command({ type: 'warmup', themeIds: resolved }, signal);
  }

  /**
   * Load theme.
   */
  async loadTheme(themeId: string, signal?: AbortSignal): Promise<string> {
    await this.mount();
    return this.ensureTheme(themeId, signal);
  }

  /**
   * Unload theme.
   */
  async unloadTheme(themeId: string): Promise<void> {
    if (!this.installedThemes.has(themeId)) return;
    await this.command({ type: 'unload-theme', themeId });
    this.installedThemes.delete(themeId);
    this.themeLoads.delete(themeId);
  }

  /**
   * Presents a normalized roll and waits for completion.
   */
  async playRoll(
    result: NormalizedRollResult,
    options: RendererPlayOptions = {},
  ): Promise<RendererCompletion> {
    throwIfAborted(options.signal, 'Overlay presentation');
    if (!this.shouldPresent(result))
      return { results: result.dice.map((die) => die.result), total: result.total, replay: null };

    // Claim the presentation synchronously. Pointer dismissal is deferred until
    // after host click handlers; incrementing only after mount/theme awaits let
    // that deferred dismissal clear the table before a reroll could append.
    const generation = ++this.presentationGeneration;
    this.dismissArmed = false;
    if (this.pointerDismissTimer !== null) {
      clearTimeout(this.pointerDismissTimer);
      this.pointerDismissTimer = null;
    }

    this.emitLifecycle('loading', { result, options });
    await this.mount(options.signal);
    await this.ensurePerformanceConfiguration();
    const themeIds = new Set<string>();
    if (result.themeId) themeIds.add(result.themeId);
    if (options.defaultThemeId) themeIds.add(options.defaultThemeId);
    result.dice.forEach((die) => {
      if (die.themeId) themeIds.add(die.themeId);
    });
    for (const themeId of themeIds) await this.ensureTheme(themeId, options.signal);
    this.setIframeActive(true);
    this.panel?.show(result, 'rolling', options.dieIds);

    const outcomes = options.outcomeResolver
      ? result.dice.map((die) => options.outcomeResolver?.(die, result) ?? 'neutral')
      : undefined;
    const serializableOptions: OverlaySerializablePlayOptions = {
      startTime: options.startTime,
      animationSeed: options.animationSeed,
      defaultThemeId: options.defaultThemeId,
      dieIds: options.dieIds ? [...options.dieIds] : undefined,
      preservePreviousDice: options.preservePreviousDice,
      stateDieIds: options.stateDieIds ? [...options.stateDieIds] : undefined,
      replaceFallbackResult: options.replaceFallbackResult,
      elapsedMs: options.elapsedMs,
      animationDurationMs: options.animationDurationMs,
      lateEvent: options.lateEvent ? { ...options.lateEvent } : undefined,
      table: options.table ? { ...options.table } : undefined,
      autoClearMs: options.autoClearMs,
      reducedMotion: options.reducedMotion,
      forceFallback: options.forceFallback,
      physicsPreset: options.physicsPreset,
      modifierSequence: options.modifierSequence,
    };

    try {
      this.emitLifecycle('started', { result, options });
      const response = await this.command(
        {
          type: 'play',
          result,
          options: serializableOptions,
          outcomes,
        },
        options.signal,
      );
      const completion = response.completion;
      if (generation !== this.presentationGeneration) {
        if (!completion)
          throw new DraftrollError(
            DRAFTROLL_ERROR_CODES.overlayProtocol,
            'Draftroll overlay returned no roll completion',
            { package: 'overlay', recoverable: true },
          );
        return completion;
      }
      this.panel?.show(result, 'complete');
      if (!completion)
        throw new DraftrollError(
          DRAFTROLL_ERROR_CODES.overlayProtocol,
          'Draftroll overlay returned no roll completion',
          { package: 'overlay', recoverable: true },
        );
      this.dismissArmed = true;
      this.emitLifecycle('settled', { result, completion });
      this.emitLifecycle('completed', { result, completion });
      if (
        typeof options.autoClearMs === 'number' &&
        Number.isFinite(options.autoClearMs) &&
        options.autoClearMs >= 0
      ) {
        setTimeout(() => {
          if (generation === this.presentationGeneration)
            void this.dismiss().catch(() => undefined);
        }, options.autoClearMs);
      }
      return completion;
    } catch (error) {
      if (generation === this.presentationGeneration) {
        this.setIframeActive(false);
        this.panel?.showError(asError(error).message);
      }
      const normalized = asError(error);
      this.emitLifecycle('error', { error: normalized, result });
      throw normalized;
    }
  }

  /**
   * Updates the displayed result without replaying the roll.
   */
  async updateResult(
    result: NormalizedRollResult,
    options: RendererResultUpdateOptions = {},
  ): Promise<void> {
    await this.mount();
    this.presentationGeneration += 1;
    this.panel?.show(result, options.state ?? 'updated');
  }

  /**
   * Dismisses one logical roll.
   */
  async dismiss(options: DraftrollDismissOptions = {}): Promise<void> {
    await this.mount();
    this.emitLifecycle('dissolveStarted', { options });
    const generation = this.presentationGeneration;
    this.dismissArmed = false;
    const resolved = {
      durationMs: options.durationMs ?? this.options.dismissDurationMs,
      hideResult: options.hideResult ?? this.options.dismissResultPanel,
    };
    await this.command({ type: 'dismiss', options: resolved }, options.signal);
    if (generation !== this.presentationGeneration) return;
    this.setIframeActive(false);
    if (resolved.hideResult) this.panel?.hide();
    this.emitLifecycle('dissolveFinished', { options });
  }

  /**
   * Clears retained state and visible output.
   */
  async clear(): Promise<void> {
    await this.mount();
    this.presentationGeneration += 1;
    this.dismissArmed = false;
    await this.command({ type: 'clear' });
    this.setIframeActive(false);
    this.panel?.hide();
    this.emitLifecycle('cleared', {});
  }

  /**
   * Pauses active presentation work.
   */
  async pause(): Promise<void> {
    await this.command({ type: 'pause' });
    this.emitLifecycle('paused', {});
  }

  /**
   * Resumes paused presentation work.
   */
  async resume(): Promise<void> {
    await this.command({ type: 'resume' });
    this.emitLifecycle('resumed', {});
  }

  /**
   * Screenshot.
   */
  async screenshot(): Promise<string> {
    const response = await this.command({ type: 'screenshot' });
    if (!response.dataUrl)
      throw new DraftrollError(
        'renderer_screenshot_unavailable',
        'Overlay screenshot data was unavailable',
        { package: 'overlay', recoverable: true },
      );
    return response.dataUrl;
  }

  /**
   * Applies runtime configuration changes.
   */
  async configure(options: RendererPerformanceOptions): Promise<void> {
    await this.command({ type: 'configure', options });
  }

  /**
   * Configure camera.
   */
  async configureCamera(options: RendererCameraOptions): Promise<void> {
    await this.command({ type: 'configure-camera', options });
  }

  /**
   * Reset camera.
   */
  async resetCamera(): Promise<void> {
    await this.command({ type: 'reset-camera' });
  }

  /**
   * Preview.
   */
  async preview(options: RendererPreviewOptions = {}): Promise<RendererCompletion> {
    const { signal, ...serializable } = options;
    const response = await this.command({ type: 'preview', options: serializable }, signal);
    if (!response.completion)
      throw new DraftrollError(
        DRAFTROLL_ERROR_CODES.overlayProtocol,
        'Overlay preview returned no completion',
        { package: 'overlay', recoverable: true },
      );
    return response.completion;
  }

  /**
   * Filters visible output by participant.
   */
  setParticipantFilter(filter?: RendererParticipantFilter): void {
    this.participantFilter = filter;
  }

  /**
   * Configure interactions.
   */
  async configureInteractions(options: RendererInteractionOptions): Promise<void> {
    await this.command({ type: 'configure-interactions', options });
  }

  /**
   * Registers the callback used by result-panel reroll controls.
   */
  setRerollHandler(handler: RerollDieHandler | null): void {
    this.rerollHandler = handler;
  }

  /**
   * Shows or hides the complete overlay.
   */
  setVisible(visible: boolean): void {
    if (!visible) this.dismissArmed = false;
    if (this.iframe) this.iframe.style.display = visible ? 'block' : 'none';
    if (visible) this.setIframeActive(true);
    this.panel?.setVisible(visible);
  }

  private async ensurePerformanceConfiguration(): Promise<void> {
    if (!this.options.performance) return;
    this.performanceConfigurationPromise ??= this.command({
      type: 'configure',
      options: { ...this.options.performance },
    })
      .then(() => undefined)
      .catch((error) => {
        this.performanceConfigurationPromise = null;
        throw error;
      });
    await this.performanceConfigurationPromise;
  }

  private async ensureTheme(themeId: string, signal?: AbortSignal): Promise<string> {
    if (this.installedThemes.has(themeId) || !this.options.themeProvider) return themeId;
    const existing = this.themeLoads.get(themeId);
    if (existing) return existing;
    const fallback = this.options.fallbackThemeId ?? 'dragon';
    const loading = (async () => {
      try {
        const bundle = await prepareRuntimeTheme(this.options.themeProvider!, themeId, {
          signal,
          maximumAssetBytes: this.options.maximumThemeAssetBytes,
          maximumTotalBytes: this.options.maximumThemeTotalBytes,
          onEvent: this.options.onThemeLoad,
        });
        await this.command({ type: 'install-theme', bundle });
        this.installedThemes.add(themeId);
        return themeId;
      } catch (error) {
        if (this.options.strictThemes) throw error;
        return fallback;
      } finally {
        this.themeLoads.delete(themeId);
      }
    })();
    this.themeLoads.set(themeId, loading);
    return loading;
  }

  private setIframeActive(active: boolean): void {
    if (!this.iframe) return;
    this.iframe.style.visibility = active ? 'visible' : 'hidden';
    this.iframe.style.opacity = active ? '1' : '0';
  }

  /**
   * Destroys iframe, panel, listeners, and pending requests.
   */
  destroy(): void {
    if (this.messageListener && typeof window !== 'undefined')
      window.removeEventListener('message', this.messageListener);
    if (this.pointerDismissListener && typeof document !== 'undefined')
      document.removeEventListener('pointerdown', this.pointerDismissListener, true);
    if (this.keyDismissListener && typeof document !== 'undefined')
      document.removeEventListener('keydown', this.keyDismissListener);
    this.messageListener = null;
    this.pointerDismissListener = null;
    this.keyDismissListener = null;
    if (this.pointerDismissTimer !== null) clearTimeout(this.pointerDismissTimer);
    this.pointerDismissTimer = null;
    this.dismissArmed = false;
    this.presentationGeneration += 1;
    this.iframe?.remove();
    this.iframe = null;
    this.panel?.destroy();
    this.panel = null;
    for (const pending of this.pending.values()) {
      pending.cleanupAbort?.();
      pending.reject(
        new DraftrollStateError('Draftroll overlay was destroyed', { package: 'overlay' }),
      );
    }
    this.pending.clear();
    this.readyPromise = null;
    this.performanceConfigurationPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
  }

  private command(
    command: DraftrollOverlayCommand,
    signal?: AbortSignal,
  ): Promise<OverlayCompleteMessage> {
    throwIfAborted(signal, `Overlay command '${command.type}'`);
    const target = this.iframe?.contentWindow;
    if (!target)
      return Promise.reject(
        new DraftrollError(
          DRAFTROLL_ERROR_CODES.overlayUnavailable,
          'Draftroll overlay iframe is unavailable',
          { package: 'overlay', recoverable: true },
        ),
      );
    const requestId = `overlay_${Date.now().toString(36)}_${(++this.commandCounter).toString(36)}`;
    const message = {
      ...command,
      source: DRAFTROLL_HOST_SOURCE,
      version: DRAFTROLL_OVERLAY_PROTOCOL_VERSION,
      requestId,
    } as DraftrollHostMessage;

    return new Promise<OverlayCompleteMessage>((resolve, reject) => {
      const handleAbort = () => {
        this.pending.delete(requestId);
        reject(
          new DraftrollAbortError(`Overlay command '${command.type}'`, signal?.reason, 'overlay'),
        );
      };
      const cleanupAbort = () => signal?.removeEventListener('abort', handleAbort);
      signal?.addEventListener('abort', handleAbort, { once: true });
      this.pending.set(requestId, {
        resolve: (value) => {
          cleanupAbort();
          resolve(value);
        },
        reject: (error) => {
          cleanupAbort();
          reject(error);
        },
        cleanupAbort,
      });
      target.postMessage(message, this.targetOrigin);
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
        /* observer isolation */
      }
    }
  }

  private handleMessage(event: MessageEvent): void {
    if (!this.iframe || event.source !== this.iframe.contentWindow) return;
    if (this.targetOrigin !== '*' && event.origin !== this.targetOrigin) return;
    if (!isOverlayMessage(event.data)) return;

    const message = event.data;
    if (message.type === 'ready') {
      this.readyResolve?.();
      this.readyResolve = null;
      this.readyReject = null;
      return;
    }

    if (!message.requestId) return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    if (message.type === 'error')
      pending.reject(
        new DraftrollError(DRAFTROLL_ERROR_CODES.overlayProtocol, message.message, {
          package: 'overlay',
          recoverable: true,
        }),
      );
    else pending.resolve(message);
  }
}

/**
 * Renders accessible roll status, results, and per-die reroll controls.
 *
 * @public
 */
export class DraftrollResultPanel {
  private readonly host: HTMLDivElement;
  private readonly root: ShadowRoot;
  private readonly content: HTMLDivElement;
  private readonly live: HTMLDivElement;
  private readonly options: Required<DraftrollResultPanelOptions>;
  private rerollHandler: RerollDieHandler | null = null;
  private currentResult: NormalizedRollResult | null = null;

  /**
   * Creates an accessible result panel.
   */
  constructor(options: DraftrollResultPanelOptions = {}, container: HTMLElement = document.body) {
    this.options = {
      enabled: options.enabled ?? true,
      position: options.position ?? 'top-right',
      title: options.title ?? 'Roll result',
      showExpression: options.showExpression ?? true,
      showAuthority: options.showAuthority ?? true,
      showThemes: options.showThemes ?? true,
      allowReroll: options.allowReroll ?? true,
      zIndex: options.zIndex ?? 2_147_483_001,
    };
    this.host = document.createElement('div');
    this.host.dataset.draftrollResultPanel = '';
    Object.assign(
      this.host.style,
      panelPosition(this.options.position, this.options.zIndex, container !== document.body),
    );
    this.host.hidden = true;
    this.root = this.host.attachShadow({ mode: 'open' });
    this.root.append(createPanelStyle());
    this.content = document.createElement('div');
    this.content.className = 'panel';
    this.content.setAttribute('role', 'region');
    this.content.setAttribute('aria-label', this.options.title);
    this.live = document.createElement('div');
    this.live.className = 'sr-only';
    this.live.setAttribute('role', 'status');
    this.live.setAttribute('aria-live', 'polite');
    this.live.setAttribute('aria-atomic', 'true');
    this.root.append(this.content, this.live);
    container.append(this.host);
  }

  /**
   * Registers the callback used by per-die reroll buttons.
   */
  setRerollHandler(handler: RerollDieHandler | null): void {
    this.rerollHandler = handler;
    if (this.currentResult) this.show(this.currentResult, 'complete');
  }

  /**
   * Shows a pending or completed roll result.
   */
  show(
    result: NormalizedRollResult,
    state: 'rolling' | 'complete' | 'updated' = 'complete',
    rollingDieIds?: readonly string[],
  ): void {
    this.currentResult = result;
    this.host.hidden = false;
    this.content.replaceChildren();

    const header = document.createElement('div');
    header.className = 'header';
    const heading = document.createElement('div');
    heading.className = 'heading';
    heading.textContent = result.name
      ? `${result.name} · ${this.options.title}`
      : this.options.title;
    const status = document.createElement('span');
    status.className = `status ${state}`;
    status.textContent =
      state === 'rolling'
        ? 'Rolling'
        : state === 'updated'
          ? `Updated r${result.revision ?? 1}`
          : result.authority;
    header.append(heading, status);

    const total = document.createElement('div');
    total.className = 'total';
    total.textContent = state === 'rolling' ? '…' : String(result.total);
    total.setAttribute(
      'aria-label',
      state === 'rolling' ? 'Dice rolling' : `Total ${result.total}`,
    );

    this.content.append(header, total);
    if (this.options.showExpression && result.expression) {
      const expression = document.createElement('div');
      expression.className = 'expression';
      expression.textContent = result.expression;
      this.content.append(expression);
    }

    if (state === 'rolling') {
      // The normalized result is known before animation begins, including every
      // future reroll/explosion descendant. Do not render one placeholder row
      // per final die: the row count itself would reveal how many follow-up dice
      // are coming before the physical sequence reaches those stages.
      const pending = document.createElement('div');
      pending.className = 'dice rolling-results-hidden';
      pending.textContent = 'Results hidden until all dice settle';
      this.content.append(pending);
    } else {
      const dice = document.createElement('div');
      dice.className = 'dice';
      const rollingIds = rollingDieIds ? new Set(rollingDieIds) : null;
      result.dice.forEach((die) => dice.append(this.createDieRow(result, die, state, rollingIds)));
      this.content.append(dice);
    }

    const actionName =
      typeof result.metadata?.actionName === 'string' ? result.metadata.actionName : undefined;
    if (this.options.showAuthority || result.annotation || actionName) {
      const footer = document.createElement('div');
      footer.className = 'footer';
      if (actionName) footer.append(textSpan(actionName));
      if (result.annotation) footer.append(textSpan(result.annotation));
      if (this.options.showAuthority) footer.append(textSpan(`Authority: ${result.authority}`));
      this.content.append(footer);
    }

    this.live.textContent =
      state === 'rolling'
        ? 'Dice rolling. Results hidden until all dice settle.'
        : `Roll total ${result.total}. ${result.dice.map((die) => `${die.type} ${String(die.result)}`).join(', ')}`;
  }

  /**
   * Shows a presentation error without exposing stale results.
   */
  showError(message: string): void {
    this.host.hidden = false;
    this.content.replaceChildren();
    const error = document.createElement('div');
    error.className = 'error';
    error.textContent = message;
    this.content.append(error);
    this.live.textContent = `Draftroll error: ${message}`;
  }

  /**
   * Hides the result panel.
   */
  hide(): void {
    this.host.hidden = true;
    this.currentResult = null;
  }

  /**
   * Controls result-panel visibility.
   */
  setVisible(visible: boolean): void {
    this.host.style.display = visible ? 'block' : 'none';
  }

  /**
   * Removes the result panel and its event listeners.
   */
  destroy(): void {
    this.host.remove();
  }

  private createDieRow(
    result: NormalizedRollResult,
    die: NormalizedDieResult,
    state: 'rolling' | 'complete' | 'updated',
    rollingIds: ReadonlySet<string> | null,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = `die${die.kept ? '' : ' dropped'}`;

    const identity = document.createElement('div');
    identity.className = 'die-identity';
    const value = document.createElement('strong');
    const isRollingDie = state === 'rolling' && (!rollingIds || rollingIds.has(die.id));
    value.textContent = isRollingDie ? '·' : String(die.result);
    const label = document.createElement('span');
    label.textContent = `${die.type.toUpperCase()}${die.kept ? '' : ' · dropped'}`;
    identity.append(value, label);

    const meta = document.createElement('div');
    meta.className = 'die-meta';
    if (this.options.showThemes && (die.themeId ?? result.themeId)) {
      const theme = document.createElement('span');
      theme.className = 'theme';
      theme.textContent = die.themeId ?? result.themeId ?? '';
      meta.append(theme);
    }

    const canReroll =
      state !== 'rolling' &&
      this.options.allowReroll &&
      Boolean(this.rerollHandler) &&
      (die.generatedBy === 'initial' ||
        die.generatedBy === 'external' ||
        die.generatedBy === undefined);
    if (canReroll) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Reroll';
      button.setAttribute('aria-label', `Reroll ${die.type} showing ${String(die.result)}`);
      // The async body handles all of its own failures, so the listener deliberately
      // discards the resulting promise rather than surfacing it to the DOM.
      button.addEventListener('click', () => {
        void (async () => {
          if (!this.rerollHandler) return;
          button.disabled = true;
          button.textContent = 'Rolling…';
          try {
            await this.rerollHandler({ result, dieId: die.id });
          } catch (error) {
            this.showError(asError(error).message);
          } finally {
            if (button.isConnected) {
              button.disabled = false;
              button.textContent = 'Reroll';
            }
          }
        })();
      });
      meta.append(button);
    }

    row.append(identity, meta);
    return row;
  }
}

function normalizeResultOptions(
  input: boolean | DraftrollResultPanelOptions | undefined,
  zIndex: number,
): Required<DraftrollResultPanelOptions> {
  const options = typeof input === 'object' ? input : {};
  return {
    enabled: input === false ? false : (options.enabled ?? true),
    position: options.position ?? 'top-right',
    title: options.title ?? 'Roll result',
    showExpression: options.showExpression ?? true,
    showAuthority: options.showAuthority ?? true,
    showThemes: options.showThemes ?? true,
    allowReroll: options.allowReroll ?? true,
    zIndex: options.zIndex ?? zIndex,
  };
}

function panelPosition(
  position: DraftrollResultPanelOptions['position'],
  zIndex: number,
  absolute: boolean,
): Partial<CSSStyleDeclaration> {
  const style: Partial<CSSStyleDeclaration> = {
    position: absolute ? 'absolute' : 'fixed',
    zIndex: String(zIndex),
    maxWidth: 'min(360px, calc(100vw - 24px))',
    pointerEvents: 'auto',
  };
  if (position?.startsWith('bottom')) style.bottom = '12px';
  else style.top = '12px';
  if (position?.endsWith('left')) style.left = '12px';
  else style.right = '12px';
  return style;
}

function createPanelStyle(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = `
    :host { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    .panel { width: min(330px, calc(100vw - 24px)); box-sizing: border-box; border: 1px solid rgba(255,255,255,.16); border-radius: 16px; padding: 14px; color: #f7f4ff; background: rgba(12,14,24,.88); box-shadow: 0 18px 48px rgba(0,0,0,.28); backdrop-filter: blur(14px); }
    .header, .die, .footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .heading { font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .status, .theme { border: 1px solid rgba(255,255,255,.15); border-radius: 999px; padding: 3px 7px; font-size: 10px; color: #cbc5d9; text-transform: uppercase; }
    .status.rolling, .status.updated { color: #fff; }
    .total { margin: 8px 0 5px; font-size: 44px; line-height: 1; font-weight: 750; }
    .expression { margin-bottom: 10px; color: #cbc5d9; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
    .dice { display: grid; gap: 7px; }
    .rolling-results-hidden { color: #cbc5d9; font-size: 12px; font-style: italic; line-height: 1.45; }
    .die { border-top: 1px solid rgba(255,255,255,.1); padding-top: 7px; }
    .die.dropped { opacity: .55; }
    .die-identity { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    .die-identity strong { font-size: 21px; }
    .die-identity span { color: #cbc5d9; font-size: 11px; white-space: nowrap; }
    .die-meta { display: flex; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; }
    button { appearance: none; border: 1px solid rgba(255,255,255,.22); border-radius: 8px; padding: 5px 8px; color: #fff; background: rgba(255,255,255,.08); font: inherit; font-size: 11px; cursor: pointer; }
    button:hover { background: rgba(255,255,255,.15); }
    button:disabled { opacity: .55; cursor: wait; }
    .footer { margin-top: 10px; color: #aaa4b8; font-size: 10px; flex-wrap: wrap; }
    .error { color: #ffd9df; font-size: 13px; line-height: 1.45; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
  `;
  return style;
}

function textSpan(value: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.textContent = value;
  return span;
}

function normalizeSandbox(value: DraftrollOverlayOptions['sandbox']): string | null {
  if (value === false || value === undefined) return null;
  const tokens: readonly string[] = typeof value === 'string' ? value.split(/\s+/) : value;
  const normalized = [...new Set(tokens.map((token: string) => token.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized.join(' ') : null;
}

function inferTargetOrigin(src: string): string {
  try {
    const url = new URL(src, document.baseURI);
    return url.origin === 'null' ? '*' : url.origin;
  } catch {
    return '*';
  }
}

function isOverlayMessage(value: unknown): value is DraftrollOverlayMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DraftrollOverlayMessage>;
  return (
    candidate.source === DRAFTROLL_OVERLAY_SOURCE &&
    candidate.version === DRAFTROLL_OVERLAY_PROTOCOL_VERSION &&
    (candidate.type === 'ready' || candidate.type === 'complete' || candidate.type === 'error')
  );
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
