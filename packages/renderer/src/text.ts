import type { NormalizedRollResult } from '../../protocol/src/index';
import { DraftrollError, DRAFTROLL_ERROR_CODES, throwIfAborted } from '../../errors/src/index';
import type {
  DiceRenderer,
  RendererCompletion,
  RendererDismissOptions,
  RendererLifecycleEventMap,
  RendererLifecycleEventName,
  RendererParticipantFilter,
  RendererPerformanceOptions,
  RendererPlayOptions,
  RendererResultUpdateOptions,
} from './index';

/**
 * Configures accessible text presentation and optional retained history.
 *
 * @public
 */
export interface DraftrollTextRendererOptions {
  /** Existing host element. When omitted, the renderer remains headless. */
  container?: HTMLElement;
  /** Accessible label for the live result region. */
  label?: string;
  /** Keep previous result entries instead of replacing the current entry. */
  persistent?: boolean;
  /** Maximum retained entries when persistent. */
  maximumEntries?: number;
  /** Optional application-owned presenter for non-DOM environments. */
  present?: (result: NormalizedRollResult) => void | Promise<void>;
}

/**
 * Accessible non-WebGL renderer. It is suitable for reduced-motion users,
 * server-rendered shells, CSP-constrained embeds, and browsers without WebGL.
 *
 * @public
 */
export class DraftrollTextRenderer implements DiceRenderer {
  private readonly container?: HTMLElement;
  private readonly present?: (result: NormalizedRollResult) => void | Promise<void>;
  private readonly persistent: boolean;
  private readonly maximumEntries: number;
  private readonly handlers = new Map<RendererLifecycleEventName, Set<(payload: never) => void>>();
  private participantFilter?: RendererParticipantFilter;
  private paused = false;

  /**
   * Creates an accessible text renderer.
   */
  constructor(options: DraftrollTextRendererOptions = {}) {
    this.container = options.container;
    this.present = options.present;
    this.persistent = options.persistent ?? false;
    this.maximumEntries = clampInteger(options.maximumEntries, 1, 100, 20);
    if (this.container) {
      this.container.setAttribute('role', 'status');
      this.container.setAttribute('aria-live', 'polite');
      this.container.setAttribute('aria-atomic', this.persistent ? 'false' : 'true');
      this.container.setAttribute('aria-label', options.label ?? 'Dice results');
      this.container.dataset.draftrollRenderer = 'text';
    }
  }

  /**
   * Subscribes to an event and returns an unsubscribe function.
   */
  on<K extends RendererLifecycleEventName>(
    event: K,
    handler: (payload: RendererLifecycleEventMap[K]) => void,
  ): () => void {
    const handlers = this.handlers.get(event) ?? new Set<(payload: never) => void>();
    handlers.add(handler as (payload: never) => void);
    this.handlers.set(event, handlers);
    return () => handlers.delete(handler as (payload: never) => void);
  }

  /**
   * Prepares resources before the first presentation.
   */
  async warmup(_themeIds: string[] = [], signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal, 'Text renderer warmup');
  }

  /**
   * Presents a normalized roll and waits for completion.
   */
  async playRoll(result: NormalizedRollResult, options: RendererPlayOptions = {}): Promise<RendererCompletion> {
    throwIfAborted(options.signal, 'Text renderer presentation');
    if (!this.shouldPresent(result)) return completionFor(result);
    if (this.paused) {
      throw new DraftrollError(DRAFTROLL_ERROR_CODES.invalidState, 'The text renderer is paused', {
        package: 'renderer',
        recoverable: true,
      });
    }
    this.emit('loading', { result, options });
    this.emit('started', { result, options });
    await this.render(result, options.signal);
    const completion = completionFor(result);
    this.emit('settled', { result, completion });
    this.emit('completed', { result, completion });
    if (typeof options.autoClearMs === 'number' && Number.isFinite(options.autoClearMs) && options.autoClearMs >= 0) {
      const timer = setTimeout(() => { void this.dismiss({ hideResult: true }); }, options.autoClearMs);
      options.signal?.addEventListener('abort', () => clearTimeout(timer), { once: true });
    }
    return completion;
  }

  /**
   * Updates the displayed result without replaying the roll.
   */
  async updateResult(result: NormalizedRollResult, _options: RendererResultUpdateOptions = {}): Promise<void> {
    await this.render(result);
  }

  /**
   * Dismisses one logical roll.
   */
  async dismiss(options: RendererDismissOptions = {}): Promise<void> {
    throwIfAborted(options.signal, 'Text renderer dismissal');
    this.emit('dissolveStarted', { options });
    if (options.hideResult !== false) this.clear();
    this.emit('dissolveFinished', { options });
  }

  /**
   * Clears retained state and visible output.
   */
  clear(): void {
    this.container?.replaceChildren();
    this.emit('cleared', {});
  }

  /**
   * Pauses active presentation work.
   */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.emit('paused', {});
  }

  /**
   * Resumes paused presentation work.
   */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.emit('resumed', {});
  }

  /**
   * Applies runtime configuration changes.
   */
  configure(_options: RendererPerformanceOptions): void {
    // Text presentation has no frame-rate or pixel-ratio settings.
  }

  /**
   * Filters visible output by participant.
   */
  setParticipantFilter(filter?: RendererParticipantFilter): void {
    this.participantFilter = filter;
  }

  private async render(result: NormalizedRollResult, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal, 'Text renderer presentation');
    try {
      await this.present?.(result);
      throwIfAborted(signal, 'Text renderer presentation');
      if (!this.container || typeof document === 'undefined') return;
      const entry = document.createElement('article');
      entry.dataset.rollId = result.rollId ?? '';
      entry.setAttribute('aria-label', describeResult(result));

      const heading = document.createElement('strong');
      heading.textContent = result.name ?? result.expression ?? 'Dice result';
      const total = document.createElement('span');
      total.textContent = ` ${result.total}`;
      const detail = document.createElement('span');
      detail.textContent = ` — ${result.dice.map((die) => `${die.kept ? '' : 'dropped '}${die.faceLabel ?? die.result}`).join(', ')}`;
      entry.append(heading, total, detail);

      if (!this.persistent) this.container.replaceChildren(entry);
      else {
        this.container.append(entry);
        while (this.container.childElementCount > this.maximumEntries) this.container.firstElementChild?.remove();
      }
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { error: normalized, result });
      throw normalized;
    }
  }

  private shouldPresent(result: NormalizedRollResult): boolean {
    if (!this.participantFilter) return true;
    const participantId = typeof result.metadata?.participantId === 'string'
      ? result.metadata.participantId
      : typeof result.metadata?.actorParticipantId === 'string'
        ? result.metadata.actorParticipantId
        : undefined;
    if (typeof this.participantFilter === 'function') return this.participantFilter({ participantId, result });
    return participantId !== undefined && this.participantFilter.includes(participantId);
  }

  private emit<K extends RendererLifecycleEventName>(event: K, payload: RendererLifecycleEventMap[K]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        (handler as (value: RendererLifecycleEventMap[K]) => void)(payload);
      } catch {
        // Observer failures cannot alter presentation behavior.
      }
    }
  }
}

function completionFor(result: NormalizedRollResult): RendererCompletion {
  return { results: result.dice.map((die) => die.result), total: result.total, replay: null };
}

function describeResult(result: NormalizedRollResult): string {
  const label = result.name ?? result.expression ?? 'Dice result';
  const dice = result.dice.map((die) => `${die.kept ? '' : 'dropped '}${die.faceLabel ?? die.result}`).join(', ');
  return `${label}: total ${result.total}${dice ? `. Dice: ${dice}` : ''}`;
}

function clampInteger(value: number | undefined, minimum: number, maximum: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
