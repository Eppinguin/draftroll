import type { RendererPerformanceProfile } from './index';

/**
 * Input accepted by renderer performance budget.
 *
 * @public
 */
export interface RendererPerformanceBudgetInput {
  profile: RendererPerformanceProfile;
  overlay: boolean;
  reducedMotion: boolean;
  visualCount: number;
  devicePixelRatio: number;
  maximumPixelRatio?: number;
  activeFramesPerSecond?: number;
}

/**
 * Resolved frame, pixel-ratio, shadow, and pool limits used by a renderer.
 *
 * @public
 */
export interface RendererPerformanceBudget {
  maximumPixelRatio: number;
  activeFramesPerSecond: number;
}

/**
 * Resolves bounded frame-rate and pixel-density limits from runtime conditions.
 *
 * @param input - Device, accessibility, visual-count, and profile signals.
 * @returns A renderer-safe performance budget with clamped values.
 *
 * @public
 */
export function resolveRendererPerformanceBudget(
  input: RendererPerformanceBudgetInput,
): RendererPerformanceBudget {
  const configuredRatio = finiteRange(input.maximumPixelRatio, 0.65, 2);
  const profileRatio =
    input.profile === 'battery' ? 1 : input.profile === 'quality' ? 2 : input.overlay ? 1.35 : 1.5;
  const maximumPixelRatio = Math.min(
    Math.max(0.65, input.devicePixelRatio || 1),
    configuredRatio ?? profileRatio,
  );

  const configuredFps = finiteRange(input.activeFramesPerSecond, 15, 60, true);
  const activeFramesPerSecond =
    configuredFps ??
    (input.profile === 'battery' || input.reducedMotion || input.visualCount > 20 ? 30 : 60);

  return { maximumPixelRatio, activeFramesPerSecond };
}

/**
 * Configures hysteresis thresholds and scale bounds for adaptive resolution.
 *
 * @public
 */
export interface AdaptiveResolutionOptions {
  minimumScale?: number;
  maximumScale?: number;
  sampleFrames?: number;
  degradeThreshold?: number;
  recoverThreshold?: number;
  degradeStep?: number;
  recoverStep?: number;
}

/**
 * Hysteresis-based dynamic resolution controller. It changes scale only after a
 * complete sample window, preventing expensive renderer resizes from oscillating.
 *
 * @public
 */
export class AdaptiveResolutionController {
  private readonly minimumScale: number;
  private readonly maximumScale: number;
  private readonly sampleFrames: number;
  private readonly degradeThreshold: number;
  private readonly recoverThreshold: number;
  private readonly degradeStep: number;
  private readonly recoverStep: number;
  private frames = 0;
  private durationMs = 0;

  /**
   * Creates a frame-time driven resolution controller.
   */
  constructor(options: AdaptiveResolutionOptions = {}) {
    this.minimumScale = options.minimumScale ?? 0.7;
    this.maximumScale = options.maximumScale ?? 1;
    this.sampleFrames = Math.max(15, Math.round(options.sampleFrames ?? 90));
    this.degradeThreshold = options.degradeThreshold ?? 1.28;
    this.recoverThreshold = options.recoverThreshold ?? 0.82;
    this.degradeStep = options.degradeStep ?? 0.1;
    this.recoverStep = options.recoverStep ?? 0.05;
  }

  /**
   * Observe.
   */
  observe(
    frameDurationMs: number,
    targetFramesPerSecond: number,
    currentScale: number,
  ): number | null {
    if (!Number.isFinite(frameDurationMs) || frameDurationMs <= 0) return null;
    this.frames += 1;
    this.durationMs += frameDurationMs;
    if (this.frames < this.sampleFrames) return null;

    const average = this.durationMs / this.frames;
    const target = 1_000 / Math.max(1, targetFramesPerSecond);
    this.reset();
    if (average > target * this.degradeThreshold) {
      return Math.max(this.minimumScale, roundScale(currentScale - this.degradeStep));
    }
    if (average < target * this.recoverThreshold) {
      return Math.min(this.maximumScale, roundScale(currentScale + this.recoverStep));
    }
    return null;
  }

  /**
   * Restores the configured initial scale and clears hysteresis.
   */
  reset(): void {
    this.frames = 0;
    this.durationMs = 0;
  }
}

function finiteRange(
  value: number | undefined,
  minimum: number,
  maximum: number,
  integer = false,
): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const resolved = Math.min(maximum, Math.max(minimum, value));
  return integer ? Math.round(resolved) : resolved;
}

function roundScale(value: number): number {
  return Math.round(value * 100) / 100;
}
