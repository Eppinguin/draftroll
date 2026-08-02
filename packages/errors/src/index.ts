/**
 * Shared Draftroll error types and cancellation helpers.
 *
 * @remarks
 * Use these errors to handle failures consistently across headless, browser, realtime, and server packages.
 *
 * @packageDocumentation
 */

/**
 * Package identifier attached to a cross-package Draftroll error.
 *
 * @public
 */
export type DraftrollPackage =
  | 'core'
  | 'renderer'
  | 'overlay'
  | 'realtime'
  | 'sdk'
  | 'themes'
  | 'protocol'
  | 'server';

/**
 * Stable error-code registry shared by every Draftroll package.
 *
 * @public
 */
export const DRAFTROLL_ERROR_CODES = {
  aborted: 'operation_aborted',
  invalidState: 'invalid_state',
  invalidInput: 'invalid_input',
  unsupportedRoll: 'unsupported_roll',
  rendererUnavailable: 'renderer_unavailable',
  rendererOperationFailed: 'renderer_operation_failed',
  overlayUnavailable: 'overlay_unavailable',
  overlayTimeout: 'overlay_timeout',
  overlayProtocol: 'overlay_protocol_error',
  roomConnectionFailed: 'room_connection_failed',
  roomConnectionClosed: 'room_connection_closed',
  roomRequestTimeout: 'room_request_timeout',
  roomNotConnected: 'room_not_connected',
  invalidProtocolPayload: 'invalid_protocol_payload',
  revisionConflict: 'revision_conflict',
  disposed: 'disposed',
} as const;

/**
 * Error codes defined by the current Draftroll release.
 *
 * @public
 */
export type DraftrollKnownErrorCode =
  (typeof DRAFTROLL_ERROR_CODES)[keyof typeof DRAFTROLL_ERROR_CODES];
/**
 * Known or application-defined error code carried by a Draftroll error.
 *
 * @public
 */
export type DraftrollErrorCode = DraftrollKnownErrorCode | (string & {});

/**
 * Structured context attached to a Draftroll error.
 *
 * @public
 */
export interface DraftrollErrorOptions {
  package: DraftrollPackage;
  recoverable?: boolean;
  retryAfterMs?: number;
  details?: Readonly<Record<string, unknown>>;
  cause?: unknown;
}

/**
 * Stable base class for public Draftroll failures.
 *
 * @public
 */
export class DraftrollError extends Error {
  readonly code: DraftrollErrorCode;
  readonly package: DraftrollPackage;
  readonly recoverable: boolean;
  readonly retryAfterMs?: number;
  readonly details?: Readonly<Record<string, unknown>>;
  override readonly cause?: unknown;

  /**
   * Creates a DraftrollError instance.
   */
  constructor(code: DraftrollErrorCode, message: string, options: DraftrollErrorOptions) {
    super(message);
    this.name = 'DraftrollError';
    this.code = code;
    this.package = options.package;
    this.recoverable = options.recoverable ?? false;
    this.retryAfterMs = options.retryAfterMs;
    this.details = options.details;
    this.cause = options.cause;
  }
}

/**
 * Error used when an operation is cancelled through an abort signal.
 *
 * @public
 */
export class DraftrollAbortError extends DraftrollError {
  /**
   * Creates a DraftrollAbortError instance.
   */
  constructor(
    operation = 'Draftroll operation',
    cause?: unknown,
    packageName: DraftrollPackage = 'sdk',
  ) {
    super(DRAFTROLL_ERROR_CODES.aborted, `${operation} was aborted`, {
      package: packageName,
      recoverable: true,
      cause,
    });
    this.name = 'DraftrollAbortError';
  }
}

/**
 * Error used when an operation is invalid for the current lifecycle state.
 *
 * @public
 */
export class DraftrollStateError extends DraftrollError {
  /**
   * Creates a DraftrollStateError instance.
   */
  constructor(
    message: string,
    options: Omit<DraftrollErrorOptions, 'package'> & { package?: DraftrollPackage } = {},
  ) {
    super(DRAFTROLL_ERROR_CODES.invalidState, message, {
      ...options,
      package: options.package ?? 'sdk',
    });
    this.name = 'DraftrollStateError';
  }
}

/**
 * Determines whether an unknown value follows the Draftroll error contract.
 *
 * @public
 */
export function isDraftrollError(value: unknown): value is DraftrollError {
  return value instanceof DraftrollError || (isRecord(value) && typeof value.code === 'string');
}

/**
 * Determines whether an unknown value represents cancellation.
 *
 * @public
 */
export function isAbortError(value: unknown): boolean {
  return (
    value instanceof DraftrollAbortError ||
    (typeof DOMException !== 'undefined' &&
      value instanceof DOMException &&
      value.name === 'AbortError') ||
    (isRecord(value) && value.name === 'AbortError')
  );
}

/** Narrows an unknown value to an indexable object without asserting a shape. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Throws a Draftroll cancellation error when a signal is already aborted.
 *
 * @public
 */
export function throwIfAborted(signal: AbortSignal | undefined, operation?: string): void {
  if (!signal?.aborted) return;
  throw new DraftrollAbortError(operation, signal.reason);
}

/**
 * Creates a promise that rejects when an abort signal fires.
 *
 * @public
 */
export function abortPromise(
  signal: AbortSignal | undefined,
  operation?: string,
): Promise<never> | null {
  if (!signal) return null;
  if (signal.aborted) return Promise.reject(new DraftrollAbortError(operation, signal.reason));
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => reject(new DraftrollAbortError(operation, signal.reason)),
      { once: true },
    );
  });
}

/**
 * Waits for a promise while propagating cancellation and cleaning up listeners.
 *
 * @public
 */
export async function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  operation?: string,
  onAbort?: () => void | Promise<void>,
): Promise<T> {
  throwIfAborted(signal, operation);
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', handleAbort);
    const handleAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      void Promise.resolve(onAbort?.()).catch(() => undefined);
      reject(new DraftrollAbortError(operation, signal.reason));
    };
    signal.addEventListener('abort', handleAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}
