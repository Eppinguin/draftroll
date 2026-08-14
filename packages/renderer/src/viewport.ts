/**
 * Measured viewport candidate used to resolve the renderer canvas bounds.
 *
 * @public
 */
export interface RendererViewportCandidate {
  width?: number | null;
  height?: number | null;
}

/**
 * Input accepted by renderer viewport.
 *
 * @public
 */
export interface RendererViewportInput {
  canvas?: RendererViewportCandidate;
  document?: RendererViewportCandidate;
  window?: RendererViewportCandidate;
}

/**
 * Resolved CSS viewport occupied by the renderer canvas.
 *
 * @public
 */
export interface RendererViewport {
  width: number;
  height: number;
  aspect: number;
}

/**
 * Resolved viewport plus orthographic camera bounds.
 *
 * @public
 */
export interface OrthographicViewport extends RendererViewport {
  halfWidth: number;
  halfHeight: number;
}

/**
 * Resolve the CSS viewport that the canvas actually occupies. Browsers can
 * briefly report the default 300x150 canvas size while an iframe is starting,
 * so the largest valid layout candidate wins instead of trusting one source.
 *
 * @public
 */
export function resolveRendererViewport(input: RendererViewportInput): RendererViewport {
  const candidates = [input.canvas, input.document, input.window]
    .map(normalizeCandidate)
    .filter((candidate): candidate is { width: number; height: number } => candidate !== null)
    .toSorted((left, right) => right.width * right.height - left.width * left.height);
  const selected = candidates[0] ?? { width: 1, height: 1 };
  return {
    width: selected.width,
    height: selected.height,
    aspect: selected.width / selected.height,
  };
}

/**
 * Resolves orthographic viewport.
 *
 * @public
 */
export function resolveOrthographicViewport(
  viewport: RendererViewport,
  viewHeight: number,
  minimumAspect = 0.45,
): OrthographicViewport {
  const halfHeight = Math.max(0.5, viewHeight / 2);
  const aspect = Math.max(minimumAspect, viewport.aspect);
  return {
    ...viewport,
    aspect,
    halfWidth: halfHeight * aspect,
    halfHeight,
  };
}

function normalizeCandidate(
  candidate: RendererViewportCandidate | undefined,
): { width: number; height: number } | null {
  const width = candidate?.width;
  const height = candidate?.height;
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  if (width < 2 || height < 2) return null;
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

/** Narrowing counterpart to `Number.isFinite`, which does not narrow on its own. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
